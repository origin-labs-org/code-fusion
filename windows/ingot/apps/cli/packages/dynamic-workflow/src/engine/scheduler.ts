

import { cachedAskFacts, headOfInstructions, type CachedAskFacts } from "./cached-ask-facts.js";
import { inputHash } from "./hash.js";
import { hashMismatch } from "./hash-mismatch.js";
import { importedAskRecord, type ImportedActorState } from "./imported-cache.js";
import { defer, type Actor, type AskNode, type Deferred, type SchedulerHost } from "./scheduler-types.js";
import { handleSubmitAttempted, handleTurnEnded, type SubmitSeam } from "./scheduler-submit.js";
import type {
  ActorId,
  ActorRef,
  AskMessage,
  AskSpec,
  AskStats,
  InstanceRef,
  JournalStorePort,
  NodeRecord,
  PersonaSpec,
  SessionRef,
} from "./types.js";
import {
  NUDGE_ATTEMPTS,
  refToString,
  REPAIR_ATTEMPTS,
  WorkflowError,
} from "./types.js";

export type { SchedulerHost } from "./scheduler-types.js";

export class AskScheduler {
  private readonly actors = new Map<ActorId, Actor>();
  private readonly actorOrder: Actor[] = [];
  private readonly liveNodes = new Map<string, AskNode>();
  
  private readonly priorTranscriptAsks = new Set<string>();
  
  private readonly recordedAsks = new Map<string, number>();
  private activeAsks = 0;

  
  private readonly submitSeam: SubmitSeam;

  constructor(private readonly host: SchedulerHost) {
    this.submitSeam = {
      host,
      liveNode: (instance) => this.liveNodes.get(refToString(instance)),
      settleOk: (node, artifact) => this.settleOk(node, artifact),
      settleFailed: (node, error) => this.settleFailed(node, error),
    };
  }

  private get journal(): JournalStorePort {
    return this.host.driver.journal;
  }

  
  seedRecordedAsks(askRows: readonly NodeRecord[]): void {
    for (const row of askRows) {
      if (row.kind !== "ask" || row.actorSiteId === undefined || row.actorOrdinal === undefined) {
        continue;
      }
      const actorKey = refToString({ siteId: row.actorSiteId, ordinal: row.actorOrdinal });
      this.recordedAsks.set(actorKey, (this.recordedAsks.get(actorKey) ?? 0) + 1);
    }
  }

  hasActor(id: ActorId): boolean {
    return this.actors.has(id);
  }

  
  registerActor(
    ref: ActorRef,
    id: ActorId,
    name: string | undefined,
    persona: PersonaSpec,
    imported?: ImportedActorState,
  ): Actor {
    const recordedCount = this.recordedAsks.get(refToString(ref)) ?? 0;
    const actor: Actor = {
      ref,
      id,
      persona,
      name,
      recordedCount,
      nextAdmitSeq: 0,
      pendingRecorded: new Map(),
      pendingLive: [],
      liveQueue: [],
      ...(imported === undefined ? {} : { imported }),
    };
    this.actors.set(id, actor);
    this.actorOrder.push(actor);
    return actor;
  }

  
  admitAsk(siteId: string, actorId: ActorId, instructions: string, spec: AskSpec): Promise<unknown> {
    const actor = this.actors.get(actorId)!;
    const ordinal = this.host.nextOrdinal(siteId);
    const instance: InstanceRef = { siteId, ordinal };
    const hash = inputHash(instructions);
    const deferred = defer<unknown>();

    const recorded = this.journal.getNode(this.host.runId, siteId, ordinal);
    if (recorded !== undefined) {
      if (recorded.inputHash !== hash) {
        const err = hashMismatch(instance, recorded.inputHash, hash);
        this.host.failRun(err);
        return Promise.reject(err);
      }
      const seq = recorded.actorSeq ?? 0;
      const reconcile = (): void =>
        actor.imported?.reconcileRecorded(
          seq,
          recorded.inputHash,
          this.host.wasLiveBeforeResume(instance),
          this.host.wasQueuedBeforeImportClose(instance),
        );
      if (recorded.status === "running") {
        actor.pendingRecorded.set(seq, () => {
          reconcile();
          this.admitLive(instance, actor, seq, instructions, hash, spec, deferred, true);
        });
      } else {
        actor.pendingRecorded.set(seq, () => {
          reconcile();
          this.releaseCachedAsk(instance, recorded, deferred, cachedAskFacts(actor.ref, seq, instructions, actor.imported));
        });
      }
      this.drainAdmission(actor);
      return deferred.promise;
    }

    actor.pendingLive.push(() => {
      const seq = actor.nextAdmitSeq++;
      if (this.tryImportedSettle(instance, actor, seq, hash, instructions, deferred)) return;
      const carried = actor.imported?.carriedAt(seq) === true;
      this.admitLive(instance, actor, seq, instructions, hash, spec, deferred, carried);
    });
    this.drainAdmission(actor);
    this.pumpAll();
    return deferred.promise;
  }

  
  private admitLive(
    instance: InstanceRef,
    actor: Actor,
    seq: number,
    instructions: string,
    hash: string,
    spec: AskSpec,
    deferred: Deferred<unknown>,
    priorTranscript = false,
  ): void {
    if (priorTranscript) this.priorTranscriptAsks.add(refToString(instance));
    const instructionsHead = headOfInstructions(instructions);
    const node: AskNode = {
      instance,
      actor,
      actorSeq: seq,
      instructions,
      hash,
      spec,
      deferred,
      repairsRemaining: REPAIR_ATTEMPTS,
      nudgesRemaining: NUDGE_ATTEMPTS,
      settled: false,
      dispatched: false,
      ...(instructionsHead === undefined ? {} : { instructionsHead }),
    };
    this.liveNodes.set(refToString(instance), node);
    this.journal.putNode({
      runId: this.host.runId,
      siteId: instance.siteId,
      ordinal: instance.ordinal,
      kind: "ask",
      actorSiteId: actor.ref.siteId,
      actorOrdinal: actor.ref.ordinal,
      actorSeq: seq,
      inputHash: hash,
      status: "running",
    });
    actor.liveQueue.push(node);
    this.host.record({
      type: "node-queued",
      instance,
      kind: "ask",
      actor: actor.ref,
      actorSeq: seq,
      ...(instructionsHead === undefined ? {} : { instructionsHead }),
    });
  }

  
  private tryImportedSettle(
    instance: InstanceRef,
    actor: Actor,
    seq: number,
    hash: string,
    instructions: string,
    deferred: Deferred<unknown>,
  ): boolean {
    const entry = this.host.importCacheClosed()
      ? actor.imported?.takeIfPure(seq, hash)
      : actor.imported?.take(seq, hash);
    if (entry === undefined) return false;
    this.journal.putNode(importedAskRecord(this.host.runId, instance, actor.ref, seq, hash, entry));
    const facts = cachedAskFacts(actor.ref, seq, instructions, actor.imported);
    this.host.record({ type: "node-settled", instance, outcome: "ok", cached: true, ...facts });
    deferred.resolve(entry.result);
    return true;
  }

  
  submitAttempted(instance: InstanceRef, payload: unknown): void {
    handleSubmitAttempted(this.submitSeam, instance, payload);
  }

  
  turnEnded(instance: InstanceRef, finalText: string): void {
    handleTurnEnded(this.submitSeam, instance, finalText);
  }

  noteStats(instance: InstanceRef, stats: AskStats): void {
    const node = this.liveNodes.get(refToString(instance));
    if (node !== undefined) {
      node.lastStats = stats;
      return;
    }
    const recorded = this.journal.getNode(this.host.runId, instance.siteId, instance.ordinal);
    if (recorded === undefined) return;
    this.journal.putNode({ ...recorded, stats: this.journaledStats(instance, stats) });
  }

  
  private journaledStats(instance: InstanceRef, stats: AskStats): AskStats {
    if (!this.priorTranscriptAsks.has(refToString(instance))) return stats;
    const { worldToolCalls: _unreliable, ...rest } = stats;
    return rest;
  }

  failed(instance: InstanceRef, error: WorkflowError): void {
    const node = this.liveNodes.get(refToString(instance));
    if (node === undefined || node.settled) return;
    this.settleFailed(node, error);
  }

  
  isLive(instance: InstanceRef): boolean {
    const node = this.liveNodes.get(refToString(instance));
    return node !== undefined && !node.settled;
  }

  
  liveActorName(instance: InstanceRef): string | undefined {
    const node = this.liveNodes.get(refToString(instance));
    return node === undefined || node.settled ? undefined : node.actor.persona.name;
  }

  
  abortInFlight(error: WorkflowError, emitCancelled: boolean): void {
    for (const node of this.liveNodes.values()) {
      if (node.settled) continue;
      node.settled = true;
      if (node.dispatched) this.host.driver.cancelAsk(node.instance);
      if (emitCancelled) {
        this.host.record({ type: "node-settled", instance: node.instance, outcome: "cancelled" });
      }
      node.deferred.reject(error);
    }
    this.liveNodes.clear();
    this.activeAsks = 0;
  }

  private drainAdmission(actor: Actor): void {
    let progressed = true;
    while (progressed) {
      progressed = false;
      const release = actor.pendingRecorded.get(actor.nextAdmitSeq);
      if (release !== undefined) {
        actor.pendingRecorded.delete(actor.nextAdmitSeq);
        actor.nextAdmitSeq++;
        release();
        progressed = true;
        continue;
      }
      if (actor.nextAdmitSeq >= actor.recordedCount && actor.pendingLive.length > 0) {
        const admit = actor.pendingLive.shift()!;
        admit();
        progressed = true;
      }
    }
    this.pumpActor(actor);
  }

  
  private releaseCachedAsk(instance: InstanceRef, recorded: NodeRecord, deferred: Deferred<unknown>, facts: CachedAskFacts): void {
    this.host.holdForReplay(instance, () => this.settleCachedAsk(instance, recorded, deferred, facts));
  }

  private settleCachedAsk(instance: InstanceRef, recorded: NodeRecord, deferred: Deferred<unknown>, facts: CachedAskFacts): void {
    if (recorded.status === "completed") {
      this.host.record({ type: "node-settled", instance, outcome: "ok", cached: true, ...facts });
      deferred.resolve(recorded.result);
    } else {
      this.host.record({ type: "node-settled", instance, outcome: "failed", cached: true, error: recorded.error, ...facts });
      deferred.reject(WorkflowError.fromJSON(recorded.error!));
    }
  }

  
  pumpAll(): void {
    for (const actor of this.actorOrder) this.pumpActor(actor);
  }

  private pumpActor(actor: Actor): void {
    if (this.host.isRunSettled()) return;
    if (actor.current !== undefined) return;
    if (actor.liveQueue.length === 0) return;
    if (this.activeAsks >= this.host.caps.maxConcurrency) return;
    const node = actor.liveQueue.shift()!;
    actor.current = node;
    this.activeAsks++;
    void this.dispatch(node);
  }

  private async dispatch(node: AskNode): Promise<void> {
    let session: SessionRef;
    try {
      session = await this.ensureSession(node.actor);
    } catch (cause) {
      if (this.host.isRunSettled() || node.settled) return;
      this.settleFailed(
        node,
        new WorkflowError(
          "DriverError",
          `Failed to create the subagent session: ${describeCause(cause)}`,
          { cause },
        ),
      );
      return;
    }
    if (this.host.isRunSettled() || node.settled) return;
    this.host.record({
      type: "node-dispatched",
      instance: node.instance,
      kind: "ask",
      actor: node.actor.ref,
      ...(node.actor.name === undefined ? {} : { actorName: node.actor.name }),
      ...(node.actor.persona.model === undefined
        ? {}
        : { actorPersonaModel: node.actor.persona.model }),
      ...(node.instructionsHead === undefined ? {} : { instructionsHead: node.instructionsHead }),
    });
    node.dispatched = true;
    const message: AskMessage = {
      instructions: node.instructions,
      typed: node.spec.typed,
      schema: node.spec.schema,
    };
    this.host.driver.startAsk(session, node.instance, message);
  }

  private ensureSession(actor: Actor): Promise<SessionRef> {
    if (actor.sessionPromise !== undefined) return actor.sessionPromise;
    const seed = actor.imported?.seed();
    const promise = this.host.driver.createActorSession(actor.ref, actor.persona, seed).then((session) => {
      actor.session = session;
      const resolvedModel = this.journal.getActor(
        this.host.runId,
        actor.ref.siteId,
        actor.ref.ordinal,
      )?.resolvedModel;
      this.journal.putActor({
        runId: this.host.runId,
        siteId: actor.ref.siteId,
        ordinal: actor.ref.ordinal,
        name: actor.name,
        persona: actor.persona,
        sessionId: session.id,
        resolvedModel,
      });
      return session;
    });
    actor.sessionPromise = promise;
    return promise;
  }

  private settleOk(node: AskNode, artifact: unknown): void {
    if (node.settled) return;
    node.settled = true;
    this.journal.putNode(this.nodeRecordFor(node, { status: "completed", result: artifact }));
    this.host.record({ type: "node-settled", instance: node.instance, outcome: "ok" });
    this.finishLiveNode(node);
    node.deferred.resolve(artifact);
  }

  private settleFailed(node: AskNode, error: WorkflowError): void {
    if (node.settled) return;
    node.settled = true;
    this.journal.putNode(this.nodeRecordFor(node, { status: "failed", error: error.toJSON() }));
    this.host.record({ type: "node-settled", instance: node.instance, outcome: "failed", error: error.toJSON() });
    this.finishLiveNode(node);
    node.deferred.reject(error);
  }

  private finishLiveNode(node: AskNode): void {
    this.liveNodes.delete(refToString(node.instance));
    if (node.actor.current === node) {
      node.actor.current = undefined;
      this.activeAsks--;
    }
    this.pumpAll();
  }

  private nodeRecordFor(
    node: AskNode,
    outcome: { status: "completed"; result: unknown } | { status: "failed"; error: NodeRecord["error"] },
  ): NodeRecord {
    const record: NodeRecord = {
      runId: this.host.runId,
      siteId: node.instance.siteId,
      ordinal: node.instance.ordinal,
      kind: "ask",
      actorSiteId: node.actor.ref.siteId,
      actorOrdinal: node.actor.ref.ordinal,
      actorSeq: node.actorSeq,
      inputHash: node.hash,
      status: outcome.status,
    };
    if (outcome.status === "completed") record.result = outcome.result;
    else record.error = outcome.error;
    if (node.lastStats !== undefined)
      record.stats = this.journaledStats(node.instance, node.lastStats);
    return record;
  }
}

function describeCause(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause);
  const trimmed = text.trim();
  if (trimmed.length === 0) return "unknown error";
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
}
