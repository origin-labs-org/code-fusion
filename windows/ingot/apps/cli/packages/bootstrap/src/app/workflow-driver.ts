// ============================================================
// AgentRuntime-backed WorkflowDriver（Boundary B）
// ============================================================
//
//
//
//
//
// workflow-driver-transcript.ts）：

import type { SessionId, WorkflowEscalatePort } from "@origin-ai/cf-contracts";
import type { TurnResult } from "@origin-ai/cf-core";
import {
  GENERIC_SUBMIT_PROFILE,
  refToString,
  WorkflowError,
  type ActorRef,
  type ActorSessionSeed,
  type ArtifactPublishRequest,
  type ArtifactVersionRecord,
  type AskMessage,
  type InstanceRef,
  type JournalStorePort,
  type PersonaSpec,
  type RunEvent,
  type SessionRef,
  type SubmitVerdict as EngineSubmitVerdict,
  type WorkflowDriver,
  type WorkflowReportSink,
  type WorldReadOp,
} from "@origin-ai/cf-dynamic-workflow";
import { executeArtifactPublish } from "./workflow-artifact-publish.js";
import { qualityEpilogue } from "./workflow-ask-epilogue.js";
import { ensureSubmitProfileFits } from "./workflow-driver-submit-profile.js";
import { executeWorldRead } from "./workflow-world-read.js";
import {
  createActorModelActivity,
  createRunStallClock,
  type RunStallClock,
} from "./workflow-driver-concurrency.js";
import { handleModelTurnFailure, type ModelFailureHost } from "./workflow-driver-model-failure.js";
import {
  createActorSessionQuiescence,
  releaseActorSessions,
  type ActorSessionQuiescenceLedger,
} from "./workflow-driver-quiescence.js";
import {
  makeSessionEscalatePort,
  respondToParkedEscalation,
  withdrawSessionEscalations,
  type EscalationHost,
} from "./workflow-driver-escalation.js";
import {
  NUDGE_PROMPT,
  TYPED_TOOL_EPILOGUE,
  effectiveActorName,
  isTurnCancelled,
  mapViolations,
  mintActorSessionId,
  reportTurnObservations,
  schemaEpilogue,
  toWorkflowError,
} from "./workflow-driver-helpers.js";
import {
  makeSessionSubmitPort,
  type SubmitBridgeHost,
} from "./workflow-driver-submit-bridge.js";
import {
  countSessionTranscript,
  journalAskMessageBoundary,
  seedActorSession,
} from "./workflow-driver-transcript.js";
import type { AgentRuntimeWorkflowDriverDeps, SessionState } from "./workflow-driver-types.js";

class AgentRuntimeWorkflowDriver implements WorkflowDriver {
  readonly journal: JournalStorePort;
  readonly emit: (event: RunEvent) => void;

  private readonly sink: WorkflowReportSink;
  private readonly deps: AgentRuntimeWorkflowDriverDeps;
  private readonly sessions = new Map<string, SessionState>();
  
  private readonly instanceToSession = new Map<string, SessionState>();
  
  private readonly qidToSession = new Map<string, SessionState>();
  
  private escalationSeq = 0;
  
  private disposed = false;
  
  private readonly concurrencyUnsubscribe?: () => void;
  
  private readonly escalationHost: EscalationHost;
  
  private readonly modelFailureHost: ModelFailureHost;
  
  private readonly submitHost: SubmitBridgeHost;
  
  private readonly stallClock: RunStallClock;
  
  private readonly quiescence: ActorSessionQuiescenceLedger;

  constructor(deps: AgentRuntimeWorkflowDriverDeps, sink: WorkflowReportSink) {
    this.deps = deps;
    this.sink = sink;
    this.journal = deps.journal;
    //
    //
    this.emit =
      deps.seatGate === undefined
        ? deps.emit
        : (event) => {
            if (event.type === "node-settled") deps.seatGate?.askSettled(event.instance);
            deps.emit(event);
          };
    this.escalationHost = {
      deps,
      sessions: this.sessions,
      qidToSession: this.qidToSession,
      nextEscalationSeq: () => ++this.escalationSeq,
      record: (event) => this.record(event),
    };
    this.submitHost = { sessions: this.sessions, sink };
    this.modelFailureHost = {
      deps,
      sink,
      isDisposed: () => this.disposed,
      runTurn: (state, instance, input, epilogueStart) =>
        this.runTurn(state, instance, input, epilogueStart),
    };
    this.stallClock = createRunStallClock({
      ...(deps.clock?.now === undefined ? {} : { now: deps.clock.now }),
      ...(deps.clock?.schedule === undefined ? {} : { schedule: deps.clock.schedule }),
      ...(deps.clock?.stallAfterMs === undefined ? {} : { afterMs: deps.clock.stallAfterMs }),
      onStalled: (info) => this.sink.runStalled(info),
    });
    this.quiescence = createActorSessionQuiescence({
      ...(deps.clock === undefined ? {} : { clock: deps.clock }),
      ...(deps.clock?.quiesceMs === undefined ? {} : { quiesceMs: deps.clock.quiesceMs }),
    });
    deps.onQuiescenceProbe?.(this.quiescence);
    if (deps.concurrency !== undefined) {
      this.concurrencyUnsubscribe = deps.concurrency.subscribe(deps.runId ?? "run", (change) => {
        this.stallClock.noteCap(change.next);
        this.sink.concurrencyChanged(change);
      });
    }
  }

  async createActorSession(
    actor: ActorRef,
    persona: PersonaSpec,
    seed?: ActorSessionSeed,
  ): Promise<SessionRef> {
    const sessionId = mintActorSessionId(this.deps.runId ?? "run", actor);
    const journaled = this.journal.getActor(
      this.deps.runId ?? "run",
      actor.siteId,
      actor.ordinal,
    )?.sessionId;
    if (journaled !== undefined && journaled !== sessionId) {
      throw new WorkflowError(
        "DriverError",
        `Subagent session identity mismatch for ${refToString(actor)}: the journaled session ` +
          `id and the minted one differ.`,
        { mismatch: { expected: journaled, got: sessionId } },
      );
    }
    const ref: SessionRef = { id: sessionId };
    const submitPort = makeSessionSubmitPort(this.submitHost, sessionId);
    const escalatePort = this.makeEscalatePort(sessionId, actor, persona);
    let state: SessionState | undefined;
    const live = (): InstanceRef | undefined =>
      state === undefined ||
      state.currentInstance === undefined ||
      state.accepted ||
      state.cancelled
        ? undefined
        : state.currentInstance;
    const modelActivity = createActorModelActivity({
      port: this.deps.concurrency,
      runId: this.deps.runId ?? "run",
      live,
      ...(this.deps.seatGate === undefined
        ? {}
        : { seat: { gate: this.deps.seatGate, key: refToString(actor) } }),
      handlers: {
        onMutating: (instance) => this.sink.askMutating(instance),
        onWaiting: (info) => {
          const instance = live();
          if (instance !== undefined) this.sink.askWaiting(instance, info);
        },
        onExecuting: () => {
          const instance = live();
          if (instance !== undefined) this.sink.askExecuting(instance);
        },
        onRequestCompleted: () => this.stallClock.noteSuccess(),
        onRetryScheduled: (reason) => this.stallClock.noteRetryScheduled(reason),
      },
    });
    const submitProfile =
      this.deps.actorSubmitProfiles?.get(actor.siteId) ?? GENERIC_SUBMIT_PROFILE;
    const runtime = await this.deps.runtimeFactory({
      sessionId,
      actor,
      persona,
      submitPort,
      submitProfile,
      escalatePort,
      ...(seed === undefined ? {} : { seed }),
      ...(modelActivity.admission === undefined
        ? {}
        : { modelRequestAdmission: modelActivity.admission }),
    });
    if (seed !== undefined) {
      await seedActorSession(this.deps, { journaledSessionId: journaled, runtime, seed, sessionId });
    }
    state = {
      ref,
      sessionId,
      runtime,
      submitProfile,
      currentTyped: false,
      accepted: false,
      cancelled: false,
      turnGeneration: 0,
      pendingEscalations: new Map(),
      escalationsUsed: 0,
      modelActivity,
      actor,
      actorName: effectiveActorName(persona),
      transientAttempts: 0,
    };
    modelActivity.observe(runtime, sessionId);
    this.sessions.set(sessionId, state);
    return ref;
  }

  startAsk(session: SessionRef, instance: InstanceRef, message: AskMessage): void {
    const state = this.sessions.get(session.id);
    if (state === undefined) {
      this.sink.askFailed(
        instance,
        new WorkflowError("DriverError", `Unknown subagent session: ${session.id}`),
      );
      return;
    }
    this.withdrawEscalations(state);
    state.currentInstance = instance;
    state.currentTyped = message.typed;
    state.accepted = false;
    state.cancelled = false;
    state.pendingSubmit = undefined;
    state.escalationsUsed = 0;
    state.abortController = new AbortController();
    state.modelActivity.reset();
    this.deps.seatGate?.askStarted(refToString(state.actor), instance);
    state.transientAttempts = 0;
    state.cancelRedrive?.();
    state.cancelRedrive = undefined;
    this.instanceToSession.set(refToString(instance), state);

    if (message.typed && !ensureSubmitProfileFits(this.deps, this.sink, state, instance, message)) {
      return;
    }
    const input = message.typed
      ? `${message.instructions}${qualityEpilogue(message.schema)}${
          state.submitProfile.kind === "mono" ? TYPED_TOOL_EPILOGUE : schemaEpilogue(message.schema)
        }`
      : `${message.instructions}${qualityEpilogue(undefined)}`;
    this.runTurn(state, instance, input, message.instructions.length);
  }

  respondToSubmit(instance: InstanceRef, verdict: EngineSubmitVerdict): void {
    const state = this.instanceToSession.get(refToString(instance));
    if (state === undefined) return;
    switch (verdict.kind) {
      case "accept": {
        state.accepted = true;
        const deferred = state.pendingSubmit;
        state.pendingSubmit = undefined;
        deferred?.resolve({ accept: true });
        return;
      }
      case "reject": {
        const deferred = state.pendingSubmit;
        state.pendingSubmit = undefined;
        deferred?.resolve({ accept: false, violations: mapViolations(verdict.violations) });
        return;
      }
      case "nudge": {
        this.runTurn(state, instance, NUDGE_PROMPT, 0);
        return;
      }
    }
  }

  cancelAsk(instance: InstanceRef): void {
    const state = this.instanceToSession.get(refToString(instance));
    if (state === undefined) return;
    state.cancelled = true;
    const deferred = state.pendingSubmit;
    state.pendingSubmit = undefined;
    deferred?.reject(new WorkflowError("Cancelled", "The ask was cancelled by the engine."));
    this.withdrawEscalations(state);
    state.cancelRedrive?.();
    state.cancelRedrive = undefined;
    state.abortController?.abort(new Error("workflow ask cancelled"));
  }

  
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stallClock.dispose();
    releaseActorSessions(this.deps, this.sessions.values(), this.quiescence);
    this.concurrencyUnsubscribe?.();
    this.sessions.clear();
    this.instanceToSession.clear();
    this.qidToSession.clear();
  }

  
  respondToEscalation(qid: string, answer: string): boolean {
    return respondToParkedEscalation(this.escalationHost, qid, answer);
  }

  
  private withdrawEscalations(state: SessionState): void {
    withdrawSessionEscalations(this.escalationHost, state);
  }

  
  async executeWorldRead(op: WorldReadOp, args: unknown[]): Promise<unknown> {
    return await executeWorldRead(this.deps, op, args);
  }

  
  async executeArtifactPublish(request: ArtifactPublishRequest): Promise<ArtifactVersionRecord> {
    return await executeArtifactPublish(this.deps, request);
  }

  private runTurn(
    state: SessionState,
    instance: InstanceRef,
    input: string,
    epilogueStart: number,
  ): void {
    const abortSignal = state.abortController?.signal;
    state.turnGeneration++;
    state.turn = state.runtime
      .executeTurn(input, undefined, {
        ...(abortSignal ? { abortSignal } : {}),
        epilogueStart,
      })
      .then(
        (result) => this.onTurnResolved(state, instance, result),
        (error) => this.onTurnRejected(state, instance, error),
      );
  }

  private onTurnResolved(state: SessionState, instance: InstanceRef, result: TurnResult): void {
    reportTurnObservations(this.sink, state, instance, result);
    if (this.deps.actorTranscriptStore === undefined) {
      this.reportTurnOutcome(state, instance, result);
      return;
    }
    void this.settleExchange(state, instance, result);
  }

  
  private reportTurnOutcome(
    state: SessionState,
    instance: InstanceRef,
    result: TurnResult,
  ): boolean {
    if (state.accepted) return true;
    const generation = state.turnGeneration;
    this.sink.askTurnEnded(instance, result.response);
    return state.turnGeneration === generation;
  }

  
  private async settleExchange(
    state: SessionState,
    instance: InstanceRef,
    result: TurnResult,
  ): Promise<void> {
    const boundary = await countSessionTranscript(this.deps, state, instance);
    const ended = this.reportTurnOutcome(state, instance, result);
    if (!ended || boundary === undefined) return;
    journalAskMessageBoundary(this.deps, state, instance, boundary);
  }

  private onTurnRejected(state: SessionState, instance: InstanceRef, error: unknown): void {
    this.withdrawEscalations(state);
    if (state.cancelled || isTurnCancelled(error)) {
      return;
    }
    if (handleModelTurnFailure(this.modelFailureHost, state, instance, error)) return;
    this.sink.askFailed(instance, toWorkflowError(error));
  }

  
  private makeEscalatePort(
    sessionId: SessionId,
    actor: ActorRef,
    persona: PersonaSpec,
  ): WorkflowEscalatePort {
    return makeSessionEscalatePort(this.escalationHost, sessionId, actor, persona);
  }

  
  private record(event: RunEvent): void {
    this.journal.appendEvent(this.deps.runId ?? "run", event);
    this.emit(event);
  }
}

export function createAgentRuntimeWorkflowDriver(
  deps: AgentRuntimeWorkflowDriverDeps,
): (sink: WorkflowReportSink) => WorkflowDriver {
  return (sink) => new AgentRuntimeWorkflowDriver(deps, sink);
}

export { mintActorSessionId } from "./workflow-driver-helpers.js";
export type { ActorRuntimeFactory } from "./workflow-driver-types.js";
