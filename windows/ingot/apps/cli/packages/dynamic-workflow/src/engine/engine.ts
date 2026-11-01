

import { ImportedWorldQueue, matchImportedActor } from "./imported-cache.js";
import type { ArtifactContentOp, ArtifactPresetOp } from "../facade/registry.js";
import { AskScheduler, type SchedulerHost } from "./scheduler.js";
import type { ArtifactIdState, EngineState, ReportTally, RunSettlement } from "./engine-state.js";
import { declarePresetArtifact, publishContentArtifact } from "./engine-artifacts.js";
import { publishReport } from "./engine-report.js";
import { closeImportCache, readWorld, recoverImportClosure } from "./engine-world.js";
import { ReplaySettleOrder } from "./replay-order.js";
import { restoreFromJournal } from "./engine-resume.js";
import { settleCompleted, settleFailed, settleStopped } from "./engine-settlement.js";
import type { EngineConfig } from "./engine-config.js";
import {
  HoleRegistry,
  fillHole as fillHoleBody,
  reachHole,
  type FilledHole,
  type FillHoleResult,
  type HoleFill,
  type OpenHole,
} from "./engine-holes.js";
import type {
  ActorId,
  ArtifactRef,
  AskProgress,
  AskSpec,
  AskStats,
  AskWaitInfo,
  Caps,
  ConcurrencyChange,
  ImportedRunCache,
  InstanceRef,
  JournalStorePort,
  PersonaSpec,
  RunEvent,
  RunStallInfo,
  RunStatus,
  RunStopReason,
  ValidateFn,
  WorkflowDriver,
  WorkflowHostApi,
  WorkflowReportSink,
  WorldReadOp,
} from "./types.js";
import { refToString, WorkflowError } from "./types.js";
import { runLaunchedEvent } from "./engine-launch.js";
import { normalizePersona } from "./persona.js";
import { enrichProviderStopPhase, stampBirthPhase } from "./engine-phase-stamp.js";

export type { EngineConfig } from "./engine-config.js";

export type { RunSettlement } from "./engine-state.js";

interface SettledDeferred {
  promise: Promise<RunSettlement>;
  resolve: (value: RunSettlement) => void;
}

export class WorkflowEngine implements WorkflowHostApi, WorkflowReportSink {
  private readonly runId: string;
  private readonly driver: WorkflowDriver;
  private readonly journal: JournalStorePort;
  
  private caps: Caps;
  
  private askSpecs: ReadonlyMap<string, AskSpec>;
  private readonly validate: ValidateFn;
  private readonly scheduler: AskScheduler;

  
  private readonly ordinals = new Map<string, number>();
  
  private readonly phaseOrdinals = new Map<string, number>();
  
  private currentPhase: string | undefined;
  
  private sitePhases: ReadonlyMap<string, string>;
  
  private readonly holes: HoleRegistry;
  
  private readonly instancePhases = new Map<string, string>();

  
  private readonly actorNames = new Map<string, string>();

  
  private readonly importedCache?: ImportedRunCache;
  
  private readonly importedWorld: ImportedWorldQueue;
  
  private importClosed = false;
  
  private replaySettleOrder = ReplaySettleOrder.empty();
  
  private liveAskInstances: ReadonlySet<string> = new Set();
  
  private queuedBeforeImportClose: ReadonlySet<string> = new Set();

  
  private reportTally: ReportTally = { count: 0, bytes: 0 };
  
  private readonly artifacts = new Map<string, ArtifactIdState>();
  
  private spentTokens = 0;
  private runSettled = false;
  private runFailure?: WorkflowError;

  private readonly settledDeferred: SettledDeferred;
  
  private readonly state: EngineState;

  constructor(config: EngineConfig) {
    this.runId = config.runId;
    this.driver = config.driver;
    this.journal = config.driver.journal;
    this.caps = { maxConcurrency: config.caps.maxConcurrency };
    this.askSpecs = config.askSpecs;
    this.validate = config.validate;
    this.sitePhases = config.sitePhases ?? new Map();
    this.holes = new HoleRegistry(config.now ?? Date.now);
    this.importedCache = config.importedCache;
    this.importedWorld = new ImportedWorldQueue(config.importedCache?.world ?? new Map());

    let resolve!: (value: RunSettlement) => void;
    const promise = new Promise<RunSettlement>((res) => {
      resolve = res;
    });
    this.settledDeferred = { promise, resolve };

    this.state = {
      runId: this.runId,
      driver: this.driver,
      journal: this.journal,
      artifacts: this.artifacts,
      importedCache: this.importedCache,
      importedWorld: this.importedWorld,
      isRunSettled: () => this.runSettled,
      runError: () => this.runError(),
      failRun: (error) => this.failRun(error),
      record: (event) => this.record(event),
      nextOrdinal: (siteId) => this.nextOrdinal(siteId),
      holdForReplay: (instance, release) => {
        this.replaySettleOrder.hold(instance, release);
      },
      reportTally: () => this.reportTally,
      countReport: (bytes) => {
        this.reportTally = {
          count: this.reportTally.count + 1,
          bytes: this.reportTally.bytes + bytes,
        };
      },
      importClosed: () => this.importClosed,
      closeImport: () => {
        this.importClosed = true;
      },
      markSettled: (failure) => {
        this.runSettled = true;
        if (failure !== undefined) this.runFailure = failure;
        this.replaySettleOrder.open();
      },
      abortInFlight: (error, emitCancelled) => {
        this.scheduler.abortInFlight(error, emitCancelled);
        this.holes.rejectAll(error);
      },
      resolveSettled: (settlement) => this.settledDeferred.resolve(settlement),
    };

    const readCaps = (): Caps => this.caps;
    const host: SchedulerHost = {
      runId: this.runId,
      get caps(): Caps {
        return readCaps();
      },
      driver: this.driver,
      validate: this.validate,
      nextOrdinal: (siteId) => this.nextOrdinal(siteId),
      holdForReplay: (instance, release) => {
        this.replaySettleOrder.hold(instance, release);
      },
      record: (event) => this.record(event),
      isRunSettled: () => this.runSettled,
      runError: () => this.runError(),
      failRun: (error) => this.failRun(error),
      importCacheClosed: () => this.importClosed,
      wasLiveBeforeResume: (instance) => this.liveAskInstances.has(refToString(instance)),
      wasQueuedBeforeImportClose: (instance) =>
        this.queuedBeforeImportClose.has(refToString(instance)),
    };
    this.scheduler = new AskScheduler(host);

    const existing = this.journal.getRun(this.runId);
    if (existing === undefined) {
      const inherited = config.inheritedTokens ?? 0;
      this.spentTokens = Number.isFinite(inherited) ? Math.max(0, Math.floor(inherited)) : 0;
      this.journal.createRun({
        runId: this.runId,
        caps: this.caps,
        spentTokens: this.spentTokens,
        status: "running",
        ...(config.scriptText === undefined ? {} : { scriptText: config.scriptText }),
        ...(config.args === undefined ? {} : { args: config.args }),
        ...(config.name === undefined ? {} : { name: config.name }),
        ...(config.scriptHash === undefined ? {} : { scriptHash: config.scriptHash }),
        ...(config.parentSessionId === undefined
          ? {}
          : { parentSessionId: config.parentSessionId }),
        ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
        ...(config.toolCallId === undefined ? {} : { toolCallId: config.toolCallId }),
        ...(config.resumedFrom === undefined ? {} : { resumedFrom: config.resumedFrom }),
      });
    } else {
      if (
        existing.scriptHash !== undefined &&
        config.scriptHash !== undefined &&
        existing.scriptHash !== config.scriptHash
      ) {
        throw new WorkflowError(
          "ScriptHashMismatch",
          `Cannot resume run ${this.runId}: its script changed (recorded hash ${existing.scriptHash}, ` +
            `got ${config.scriptHash}). Resume needs the byte-identical script; to run a revised ` +
            `script, start a new run with resume_from instead.`,
          { mismatch: { expected: existing.scriptHash, got: config.scriptHash } },
        );
      }
      ({ replaySettleOrder: this.replaySettleOrder, reportTally: this.reportTally } =
        restoreFromJournal(this.state, this.scheduler));
      this.spentTokens = existing.spentTokens;
      if (this.importedCache !== undefined) {
        const recovered = recoverImportClosure(this.journal, this.runId);
        this.liveAskInstances = recovered.live;
        this.queuedBeforeImportClose = recovered.queuedBeforeClose;
        this.importClosed = recovered.closed;
      }
      this.journal.updateRunStatus(this.runId, "running");
    }
    this.record({ type: "run-started", runId: this.runId, caps: this.caps });
    if (existing === undefined && config.launch !== undefined) {
      this.record(runLaunchedEvent(config.launch, config));
    }
    if (this.spentTokens > 0) this.record({ type: "usage-updated", spentTokens: this.spentTokens });
  }

  
  get settled(): Promise<RunSettlement> {
    return this.settledDeferred.promise;
  }

  
  status(): RunStatus {
    return this.journal.getRun(this.runId)?.status ?? "running";
  }

  // ——————————————————————————————— Boundary A ———————————————————————————————

  
  createActor(siteId: string, name?: string, persona?: string | PersonaSpec): ActorId {
    this.assertRunning("createActor");
    const ordinal = this.nextOrdinal(siteId);
    const ref = { siteId, ordinal };
    const id = refToString(ref);
    const spec = normalizePersona(name, persona);
    const effectiveName = spec.name;
    if (effectiveName !== undefined && effectiveName !== "") {
      const claimed = this.actorNames.get(effectiveName);
      if (claimed !== undefined) {
        const err = new WorkflowError(
          "DuplicateActorName",
          `Subagent name "${effectiveName}" is used twice in this run (${claimed} and ${id}). ` +
            `A named subagent is the identity an amended re-run matches its cache by, so names must ` +
            `be unique; give this one its own name or drop the name to make it anonymous.`,
        );
        this.failRun(err);
        throw err;
      }
      this.actorNames.set(effectiveName, id);
    }
    this.scheduler.registerActor(ref, id, name, spec, matchImportedActor(this.importedCache, spec));
    const existing = this.journal.getActor(this.runId, siteId, ordinal);
    this.journal.putActor({
      runId: this.runId,
      siteId,
      ordinal,
      name,
      persona: spec,
      sessionId: existing?.sessionId,
      resolvedModel: existing?.resolvedModel,
    });
    this.record({ type: "actor-created", actor: ref, name, persona: spec });
    return id;
  }

  ask(siteId: string, actorId: ActorId, instructions: string): Promise<unknown> {
    if (this.runSettled) return Promise.reject(this.runError());
    if (!this.scheduler.hasActor(actorId)) {
      const err = new WorkflowError("UnknownActor", `Unknown subagent handle: ${actorId}.`);
      this.failRun(err);
      return Promise.reject(err);
    }
    const spec = this.askSpecs.get(siteId);
    if (spec === undefined) {
      const err = new WorkflowError(
        "MissingAskSpec",
        `Ask site ${siteId} has no spec: askSpecs is incomplete (compile output mismatch).`,
      );
      this.failRun(err);
      return Promise.reject(err);
    }
    return this.scheduler.admitAsk(siteId, actorId, instructions, spec);
  }

  
  worldRead(siteId: string, op: WorldReadOp, args: unknown[]): Promise<unknown> {
    return readWorld(this.state, siteId, op, args);
  }

  log(message: string): void {
    if (this.runSettled) return;
    this.record({ type: "log", message });
  }

  
  enterPhase(name: string): void {
    if (this.runSettled) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    const ordinal = (this.phaseOrdinals.get(trimmed) ?? 0) + 1;
    this.phaseOrdinals.set(trimmed, ordinal);
    this.currentPhase = trimmed;
    this.record({ type: "phase-entered", name: trimmed, ordinal });
  }

  
  hole(siteId: string, name: string, prompt?: string): Promise<{ code: string }> {
    return reachHole(this.state, this.holes, siteId, name, prompt);
  }

  
  fillHole(fill: HoleFill): FillHoleResult {
    return fillHoleBody(this.state, this.holes, fill, (askSpecs, sitePhases) => {
      this.askSpecs = askSpecs;
      this.sitePhases = sitePhases;
    });
  }

  
  openHoles(): OpenHole[] {
    return this.holes.open();
  }

  
  filledHoles(): FilledHole[] {
    return this.holes.filledList();
  }

  
  report(siteId: string, item: unknown, artifactId?: string): void {
    publishReport(this.state, siteId, item, artifactId);
  }

  
  publishArtifact(siteId: string, op: ArtifactContentOp, args: unknown[]): Promise<ArtifactRef> {
    return publishContentArtifact(this.state, siteId, op, args);
  }

  
  declareArtifact(siteId: string, op: ArtifactPresetOp, args: unknown[]): void {
    declarePresetArtifact(this.state, siteId, op, args);
  }

  
  complete(artifact: unknown): void {
    settleCompleted(this.state, artifact);
  }

  
  stop(reason: RunStopReason, error?: WorkflowError, supersededBy?: string): void {
    settleStopped(this.state, reason, error, supersededBy);
  }

  
  fail(error: WorkflowError): void {
    this.failRun(error);
  }

  
  setMaxConcurrency(maxConcurrency: number): boolean {
    if (this.runSettled) return false;
    if (!Number.isFinite(maxConcurrency)) return false;
    const previous = this.caps;
    const next = Math.max(1, Math.floor(maxConcurrency));
    if (next === previous.maxConcurrency) return false;
    const caps: Caps = { maxConcurrency: next };
    this.caps = caps;
    this.journal.updateRunCaps(this.runId, caps);
    this.record({ type: "run-caps-changed", runId: this.runId, caps, previous });
    if (next > previous.maxConcurrency) this.scheduler.pumpAll();
    return true;
  }

  askSubmitAttempted(instance: InstanceRef, payload: unknown): void {
    this.scheduler.submitAttempted(instance, payload);
  }

  askTurnEnded(instance: InstanceRef, finalText: string): void {
    this.scheduler.turnEnded(instance, finalText);
  }

  
  askProgress(instance: InstanceRef, progress: AskProgress): void {
    if (this.runSettled) return;
    this.record({ type: "node-progress", instance, ...progress });
  }

  askStats(instance: InstanceRef, stats: AskStats): void {
    this.scheduler.noteStats(instance, stats);
    this.spentTokens += stats.tokens;
    this.journal.updateRunUsage(this.runId, this.spentTokens);
    if (this.runSettled) return;
    this.record({ type: "usage-updated", spentTokens: this.spentTokens });
  }

  askFailed(instance: InstanceRef, error: WorkflowError): void {
    this.scheduler.failed(instance, error);
  }

  
  stopRun(error: WorkflowError): void {
    this.stop("provider", enrichProviderStopPhase(error, this.instancePhases));
  }

  
  runStalled(info: RunStallInfo): void {
    if (this.runSettled) return;
    this.record({ type: "run-stalled", ...info });
  }

  askWaiting(instance: InstanceRef, info: AskWaitInfo): void {
    if (this.runSettled || !this.scheduler.isLive(instance)) return;
    this.record({ type: "node-waiting", instance, ...info });
  }

  askExecuting(instance: InstanceRef): void {
    if (this.runSettled || !this.scheduler.isLive(instance)) return;
    this.record({ type: "node-executing", instance });
  }

  
  askMutating(instance: InstanceRef): void {
    if (this.runSettled || !this.scheduler.isLive(instance)) return;
    closeImportCache(this.state, instance, "mutating-tool", this.scheduler.liveActorName(instance));
  }

  concurrencyChanged(change: ConcurrencyChange): void {
    if (this.runSettled) return;
    this.record({ type: "concurrency-changed", ...change });
  }

  
  private failRun(error: WorkflowError): void {
    settleFailed(this.state, error);
  }

  
  private nextOrdinal(siteId: string): number {
    const next = (this.ordinals.get(siteId) ?? 0) + 1;
    this.ordinals.set(siteId, next);
    const phase = this.sitePhases.get(siteId) ?? this.currentPhase;
    if (phase !== undefined) this.instancePhases.set(refToString({ siteId, ordinal: next }), phase);
    return next;
  }

  private assertRunning(op: string): void {
    if (this.runSettled)
      throw (
        this.runFailure ??
        new WorkflowError("Cancelled", `Run already settled; ${op} is no longer accepted.`)
      );
  }

  private runError(): WorkflowError {
    return this.runFailure ?? new WorkflowError("Cancelled", "Run already settled.");
  }

  
  private record(event: RunEvent): void {
    const stamped = stampBirthPhase(event, this.instancePhases);
    this.journal.appendEvent(this.runId, stamped);
    this.driver.emit(stamped);
  }
}
