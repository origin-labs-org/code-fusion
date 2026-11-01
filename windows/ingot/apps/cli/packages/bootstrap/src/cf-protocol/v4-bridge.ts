import { isReadonlyAgentSessionKind } from "@origin-ai/cf-shared";
import { readBackgroundBashOutputFromOwner } from "./background-work-owner.js";
//
import {
  isConversationRealUserTurnStarter,
  parseRemoteWorkspaceIdentity,
  type CfSessionContextUsage,
  type CfWorkspaceRef,
} from "@origin-ai/cf-shared";
import { createExternalTurnFaultError } from "@origin-ai/cf-core";
import {
  V4_NOTIFICATIONS,
  conversationInputIntentSchema,
  type AttachmentRef,
  type CommandEnvelope,
  type ConversationInputIntent,
  type ConversationSnapshot,
  type V4ConversationFileChangesResult,
  type V4ConversationFileRewindPreviewResult,
  type SessionSummary,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { V4CommandExecutor } from "../cf-protocol-v4/commands/executor.js";
import { V4QueuePromotionLeaseUnavailableError } from "../cf-protocol-v4/commands/handlers/queue.js";
import { V4CapabilityUnsupportedError } from "../cf-protocol-v4/commands/handlers/interaction-background.js";
import {
  buildColdFileChangeSummaries,
  readConversationFileChangesFromEvents,
} from "../cf-protocol-v4/cold-file-change-summaries.js";
import {
  loadPersistedConversationMaterialization,
  mergeColdConversationEvents,
} from "../cf-protocol-v4/cold-event-merge.js";
import { lookupGlobalCreateSessionCommand } from "../cf-protocol-v4/create-session-command-fact.js";
import type {
  V4CommandCoreHost,
  V4QueuedTurnExecution,
} from "../cf-protocol-v4/commands/types.js";
import type {
  ConversationRowTargetResolution,
  SessionUsageSeed,
} from "../cf-protocol-v4/product-projection.js";
import { PersistentCommandIndex } from "../cf-protocol-v4/persistent-command-index.js";
import { queueItemIdForCommand } from "../cf-protocol-v4/command-inbox.js";
import { resolveStableForkTargetFromTranscript } from "../cf-protocol-v4/stable-fork-target.js";
import { shouldAutoDrainV4QueueHead } from "../cf-protocol-v4/queue-auto-drain.js";
import { persistAssistantFeedback } from "../cf-protocol-v4/assistant-feedback-persistence.js";
import {
  persistHighspeedMetrics,
  persistHighspeedTiming,
} from "../cf-protocol-v4/highspeed-metrics-persistence.js";
import {
  TASK_LIST_SESSION_TYPES,
  isTaskListSessionType,
} from "../cf-protocol-v4/task-list-session-membership.js";
import {
  loadPersistentCommandFacts,
  savePersistentCommandFact,
} from "../cf-protocol-v4/persistent-command-facts.js";
import {
  ConversationV4Gateway,
  V4CommandNotImplementedError,
} from "../cf-protocol-v4/v4-gateway.js";
import {
  SESSION_ENTRY_TARGET_COMPLETION_VERIFICATION,
  SessionEventType,
  createEventId,
  createSessionId,
} from "@origin-ai/cf-contracts";
import type {
  CollaborationMode,
  DynamicWorkflowRunProgressPayload,
  EventId,
  ForkCommitBundle,
  GoalStatus,
  MessageId,
  MessageWithParts,
  SessionEvent,
  SessionEventStorePort,
  SessionId,
  SessionStorePort,
  StableForkGoalBoundaryMetadata,
  TraceId,
  TurnId,
  WorkspaceId,
} from "@origin-ai/cf-contracts";
import { HYDRATION_TRACE_ID } from "../cf-protocol-v4/projection-state.js";
import { cloneModelSelection, derivedSessionModelSelection } from "./fork-model-selection.js";
import { resolveWorkspaceRefFromId } from "./mapper.js";
import { buildLiveWorkspaceConfigStateV4 } from "./v4-workspace-config.js";
import {
  hasSessionModelProvider,
  resolveSessionModelContextWindow,
} from "./workspace-model-runtime.js";
import {
  afterStateMutation,
  activateSessionForResume,
  discardFailedSessionResume,
  createSessionRecordForV4,
  ensureSessionModelAvailableForNextTurn,
  listSessionSubagents,
  registerForkedSession,
  readSessionContextUsage,
} from "./server-operations.js";
import type {
  CfProtocolAgentServerContext,
  CfProtocolSessionRecord,
} from "./server-types.js";
import { createProtocolLogger } from "./server-types.js";

function normalizeStoredTitleSource(
  source: string | undefined,
): NonNullable<SessionSummary["titleSource"]> {
  if (source === "custom") return "custom";
  if (source === "default") return "default";
  return "generated";
}

function sessionUsageSeedFromRuntimeContextUsage(
  contextUsage: CfSessionContextUsage | undefined,
  contextWindowOverride?: number,
): SessionUsageSeed | null {
  if (!contextUsage || contextUsage.used <= 0) {
    return null;
  }
  return {
    contextWindow: {
      usedTokens: contextUsage.used,
      maxTokens: contextWindowOverride ?? null,
      autoCompactThresholdTokens: null,
      ...(contextUsage.cache ? { cache: contextUsage.cache } : {}),
      ...(contextUsage.breakdown ? { breakdown: contextUsage.breakdown } : {}),
    },
  };
}

const STABLE_FORK_MODES = new Set<CollaborationMode>([
  "plan",
  "build",
  "edit",
  "yolo",
  "guarded",
  "auto",
]);

function stableForkMode(value: string, fallback: CollaborationMode): CollaborationMode {
  return STABLE_FORK_MODES.has(value as CollaborationMode)
    ? (value as CollaborationMode)
    : fallback;
}

async function readConversationFileChanges(
  record: CfProtocolSessionRecord,
  sessionId: string,
  messageIds: readonly string[],
  targetTurnId?: TurnId | null,
): Promise<V4ConversationFileChangesResult> {
  const events = await record.eventStore.getEvents(sessionId as SessionId);
  return readConversationFileChangesFromEvents({
    events,
    messageIds,
    readArtifact: async (snapshotRef) =>
      (await record.app.readToolResultArtifact(snapshotRef)).content,
    ...(targetTurnId ? { targetTurnId } : {}),
  });
}

async function replayDynamicWorkflowRunEvents(
  context: CfProtocolAgentServerContext,
  sessionId: string,
  record: CfProtocolSessionRecord,
  memoryEvents: readonly SessionEvent[],
): Promise<SessionEvent[]> {
  if (context.sessions.get(sessionId) !== record) return [];
  const replay = record.app.replayDynamicWorkflowRuns;
  if (!replay) return [];
  const excludeRunIds = new Set<string>();
  for (const event of memoryEvents) {
    if (event.type !== SessionEventType.DynamicWorkflowRunProgress) continue;
    const runId = (event.payload as { runId?: unknown } | undefined)?.runId;
    if (typeof runId === "string") excludeRunIds.add(runId);
  }
  let payloads: DynamicWorkflowRunProgressPayload[];
  try {
    payloads = await replay({ excludeRunIds });
  } catch (error) {
    context.logger?.warn("v4 hydrate dynamic workflow replay failed", {
      error: error instanceof Error ? error.message : String(error),
      event: "cf_protocol.v4.hydrate_workflow_replay_failed",
      module: "bootstrap.cf_protocol",
      sessionId,
    });
    return [];
  }
  return payloads.map((payload, index) => ({
    id: `dwf-replay-${index + 1}` as EventId,
    sessionId: sessionId as SessionId,
    type: SessionEventType.DynamicWorkflowRunProgress,
    timestamp: new Date(0),
    traceId: HYDRATION_TRACE_ID as TraceId,
    sequenceNumber: 0,
    payload,
  }));
}

async function resolveConversationBackingRecord(
  context: CfProtocolAgentServerContext,
  sessionId: string,
): Promise<CfProtocolSessionRecord | undefined> {
  const direct = context.sessions.get(sessionId);
  if (direct) return direct;

  const stored = await context.deps.sessionStore?.getSession(sessionId as SessionId);
  const parentSessionId = stored?.parentID ? String(stored.parentID) : null;
  return parentSessionId ? context.sessions.get(parentSessionId) : undefined;
}

async function previewConversationFileRewind(
  record: CfProtocolSessionRecord,
  messageIds: readonly string[],
  targetTurnId?: TurnId | null,
): Promise<V4ConversationFileRewindPreviewResult> {
  return record.app.runtime.previewWorkspaceFileRewind({
    targetMessageIds: messageIds as MessageId[],
    ...(targetTurnId ? { targetTurnId } : {}),
  });
}

interface InputCommandForAdmission {
  inputOrigin?: "desktop" | "mobile";
  conversationQuotes?: import("@origin-ai/cf-contracts").TurnInputIntentMetadata["conversationQuotes"];
  botGroupSource?: ConversationInputIntent["botGroupSource"];
  kind: ConversationInputIntent["kind"];
  text: string;
  attachments: readonly AttachmentRef[];
  sharedContextRefs?: ConversationInputIntent["sharedContextRefs"];
  requestedDelivery?: ConversationInputIntent["delivery"]["requested"];
  admittedDelivery?: ConversationInputIntent["delivery"]["admitted"];
  fallbackReasonCode?: string;
  highspeed?: ConversationInputIntent["highspeed"];
  provenance?: ConversationInputIntent["provenance"];
}

type ResolveAdmissionRowTarget = (
  sessionId: string,
  target: { rowId: number; entityId: string },
  action: "editUserQuery" | "retryTurn",
) => ConversationRowTargetResolution | null;

function admissionAttachmentRefs(
  attachments: NonNullable<
    Extract<ConversationRowTargetResolution, { ok: true }>["editTarget"]
  >["intent"]["attachments"],
): AttachmentRef[] {
  return (
    attachments?.flatMap((attachment) =>
      attachment.ref
        ? [
            {
              ...attachment,
              ref: attachment.ref,
            },
          ]
        : [],
    ) ?? []
  );
}

export function resolveInputCommandForAdmission(
  envelope: CommandEnvelope,
  admissionSessionId: string,
  resolveRowTarget: ResolveAdmissionRowTarget,
): InputCommandForAdmission | null {
  if (envelope.type === "createSession") {
    const firstInput = (
      envelope.payload as {
        firstInput?: { text: string; attachments?: AttachmentRef[] };
      }
    ).firstInput;
    return firstInput
      ? {
          kind: "sendText",
          text: firstInput.text,
          attachments: firstInput.attachments ?? [],
        }
      : null;
  }
  if (envelope.type === "createSelectionSideSession") {
    const firstInput = (
      envelope.payload as {
        firstInput?: { text: string };
      }
    ).firstInput;
    return firstInput
      ? {
          kind: "sendText",
          text: firstInput.text,
          attachments: [],
        }
      : null;
  }
  if (envelope.type === "sendText" || envelope.type === "sendGoalCommand") {
    const payload = envelope.payload as {
      text: string;
      attachments?: AttachmentRef[];
      context_refs?: ConversationInputIntent["sharedContextRefs"];
      highspeedMeta?: ConversationInputIntent["highspeed"];
      inputOrigin?: "desktop" | "mobile";
      conversationQuotes?: import("@origin-ai/cf-contracts").TurnInputIntentMetadata["conversationQuotes"];
      botGroupSource?: ConversationInputIntent["botGroupSource"];
    };
    return {
      kind: envelope.type,
      text: payload.text,
      attachments: payload.attachments ?? [],
      ...(payload.context_refs ? { sharedContextRefs: payload.context_refs } : {}),
      ...(payload.highspeedMeta ? { highspeed: payload.highspeedMeta } : {}),
      ...(payload.inputOrigin ? { inputOrigin: payload.inputOrigin } : {}),
      ...(payload.conversationQuotes ? { conversationQuotes: payload.conversationQuotes } : {}),
      ...(payload.botGroupSource ? { botGroupSource: payload.botGroupSource } : {}),
    };
  }
  if (envelope.type === "compact") {
    return { kind: "compact", text: "/compact", attachments: [] };
  }
  if (envelope.type !== "editUserQuery" && envelope.type !== "retryTurn") return null;
  if (!envelope.sessionId) return null;
  const payload = envelope.payload as {
    target: { rowId: number; entityId: string };
    newText?: string;
    conversationQuotes?: ConversationInputIntent["conversationQuotes"];
    attachments?: AttachmentRef[];
  };
  const resolution = resolveRowTarget(envelope.sessionId, payload.target, envelope.type);
  if (!resolution?.ok || !resolution.editTarget) return null;
  const canonical = resolution.editTarget;

  const originalSourceCommandId =
    canonical.intent.provenance?.sourceCommandId ?? canonical.intent.sourceCommandId;
  return {
    kind: canonical.intent.kind,
    ...(canonical.intent.inputOrigin ? { inputOrigin: canonical.intent.inputOrigin } : {}),
    ...((payload.conversationQuotes ?? canonical.intent.conversationQuotes)
      ? { conversationQuotes: payload.conversationQuotes ?? canonical.intent.conversationQuotes }
      : {}),
    ...(canonical.intent.botGroupSource ? { botGroupSource: canonical.intent.botGroupSource } : {}),
    text:
      envelope.type === "editUserQuery"
        ? (payload.newText ?? canonical.intent.text)
        : canonical.intent.text,
    attachments:
      envelope.type === "editUserQuery" && payload.attachments
        ? payload.attachments
        : admissionAttachmentRefs(canonical.intent.attachments),
    ...(canonical.intent.requestedDelivery
      ? { requestedDelivery: canonical.intent.requestedDelivery }
      : {}),
    ...(canonical.intent.admittedDelivery
      ? { admittedDelivery: canonical.intent.admittedDelivery }
      : {}),
    ...(canonical.intent.fallbackReasonCode
      ? { fallbackReasonCode: canonical.intent.fallbackReasonCode }
      : {}),
    ...(originalSourceCommandId
      ? {
          provenance: canonical.intent.provenance ?? {
            sourceCommandId: originalSourceCommandId,
            ...(canonical.intent.queueItemId ? { queueItemId: canonical.intent.queueItemId } : {}),
            ...(canonical.intent.clientId ? { clientId: canonical.intent.clientId } : {}),
          },
        }
      : {}),
  };
}

export function isConversationInputAdmissionCommand(type: CommandEnvelope["type"]): boolean {
  return (
    type === "sendText" ||
    type === "sendGoalCommand" ||
    type === "compact" ||
    type === "editUserQuery" ||
    type === "retryTurn"
  );
}

function buildForkInitialInput(
  envelope: CommandEnvelope,
  childSessionId: string,
  admission: { admissionSeq: number; admittedAt: number; queueItemId: string },
  input: InputCommandForAdmission,
): ForkCommitBundle["initialInput"] {
  const requested = input.requestedDelivery ?? "startNow";
  const fallbackReasonCode = input.fallbackReasonCode;
  const admitted =
    input.admittedDelivery ??
    (fallbackReasonCode ? "queue" : requested === "auto" ? "startNow" : requested);
  const intent = conversationInputIntentSchema.parse({
    sourceCommandId: envelope.commandId,
    queueItemId: admission.queueItemId,
    clientId: envelope.clientId || "cli",
    kind: input.kind,
    ...(input.inputOrigin ? { inputOrigin: input.inputOrigin } : {}),
    ...(input.conversationQuotes ? { conversationQuotes: input.conversationQuotes } : {}),
    ...(input.botGroupSource ? { botGroupSource: input.botGroupSource } : {}),
    text: input.text,
    attachments: input.attachments,
    delivery: {
      requested,
      admitted,
      ...(fallbackReasonCode ? { fallbackReasonCode } : {}),
    },
    order: { admissionSeq: admission.admissionSeq },
    steer: fallbackReasonCode
      ? { state: "fellBack", reasonCode: fallbackReasonCode }
      : { state: "notRequested" },
    dispatch: { state: "admitted" },
    admittedAt: admission.admittedAt,
    ...(input.highspeed ? { highspeed: input.highspeed } : {}),
    ...(input.provenance ? { provenance: input.provenance } : {}),
  });
  return {
    id: admission.queueItemId,
    sessionID: childSessionId as SessionId,
    kind: intent.kind,
    delivery: intent.delivery.admitted,
    payload: {
      text: intent.text,
      conversationInputIntent: intent,
      attachments: intent.attachments,
      sourceCommandType: envelope.type,
    },
  };
}

async function recordForkStartFailureBestEffort(
  context: CfProtocolAgentServerContext,
  sessionId: string,
  command: Pick<CommandEnvelope, "commandId">,
  error: unknown,
  details: { parentSessionId?: string; registrationRequired?: boolean } = {},
): Promise<void> {
  const store = context.deps.sessionStore;
  const record = context.sessions.get(sessionId);
  const now = Date.now();
  const message = error instanceof Error ? error.message : String(error);
  const warn = (stage: string, failure: unknown) => {
    try {
      context.logger?.warn("fork child post-commit failure recording degraded", {
        commandId: command.commandId,
        error: failure instanceof Error ? failure.message : String(failure),
        forkedSessionId: sessionId,
        parentSessionId: details.parentSessionId,
        stage,
      });
    } catch {
    }
  };

  try {
    await store?.settleSessionInput?.({
      id: queueItemIdForCommand(command.commandId),
      sessionID: sessionId as SessionId,
      status: "failed",
      reason: "fault.command.childStartFailed",
    });
  } catch (failure) {
    warn("ledger", failure);
  }
  try {
    await store?.saveSessionEntry?.({
      id: `v4_fork_start_failure:${command.commandId}`,
      sessionID: sessionId as SessionId,
      type: "v4/fork_start_failure",
      time: { created: now, updated: now },
      data: {
        commandId: command.commandId,
        forkedSessionId: sessionId,
        parentSessionId: details.parentSessionId,
        ...(details.registrationRequired ? { registrationRequired: true } : {}),
        retryable: true,
        status: "failed",
        reasonCode: "fault.command.childStartFailed",
        message,
      },
    });
  } catch (failure) {
    warn("entry", failure);
  }
  if (!record) return;
  try {
    const event: SessionEvent = {
      id: createEventId(),
      sessionId: sessionId as SessionId,
      type: SessionEventType.TurnError,
      timestamp: new Date(now),
      traceId: record.traceContext.traceId,
      sequenceNumber: (await record.eventStore.getLatestSequenceNumber(sessionId as SessionId)) + 1,
      payload: {
        inputId: command.commandId,
        turnPhase: "fork_child_start",
        error: {
          type: "fault.command.childStartFailed",
          message,
          retryable: true,
        },
      },
    };
    const persisted = await record.eventStore.append(event);
    context.v4Gateway?.ingest(sessionId, persisted);
  } catch (failure) {
    warn("event", failure);
  }
}

export async function registerCommittedForkBestEffort(
  context: CfProtocolAgentServerContext,
  record: CfProtocolSessionRecord,
  fork: Parameters<typeof registerForkedSession>[2],
  options: Parameters<typeof registerForkedSession>[3] & { commandId: string },
  register: typeof registerForkedSession = registerForkedSession,
): Promise<void> {
  const { commandId, ...registrationOptions } = options;
  try {
    await register(context, record, fork, registrationOptions);
  } catch (error) {
    const forkedSessionId = String(fork.forkedSessionId);
    const parentSessionId = String(fork.parentSessionId ?? record.app.sessionId);
    await recordForkStartFailureBestEffort(context, forkedSessionId, { commandId }, error, {
      parentSessionId,
      registrationRequired: true,
    });
    try {
      context.logger?.warn("fork child registration failed after durable commit", {
        commandId,
        error: error instanceof Error ? error.message : String(error),
        forkedSessionId,
        parentSessionId,
        retryable: true,
      });
    } catch {
    }
  }
}

export interface HighspeedTurnTerminalPersistenceContext {
  sessions: Map<
    string,
    { eventStore: SessionEventStorePort; traceContext: { traceId: string | number } }
  >;
  deps: { sessionStore?: SessionStorePort };
  v4Gateway?: { ingest(sessionId: string, event: SessionEvent): unknown };
  logger?: { warn(message: string, data?: Record<string, unknown>): void };
}

export function persistHighspeedTimingOnTurnTerminal(
  context: HighspeedTurnTerminalPersistenceContext,
  sessionId: string,
  event: SessionEvent,
  snapshot: ConversationSnapshot,
): void {
  const record = context.sessions.get(sessionId);
  const sessionStore = context.deps.sessionStore;
  const payload = event.payload as { inputId?: unknown; duration?: unknown };
  const inputId = typeof payload.inputId === "string" ? payload.inputId : undefined;
  const header = snapshot.rows.window
    .filter(
      (row): row is Extract<(typeof snapshot.rows.window)[number], { kind: "turnHeader" }> =>
        row.kind === "turnHeader" &&
        (inputId === undefined
          ? row.turnId === String(event.turnId)
          : row.sourceCommandId === inputId),
    )
    .at(-1);
  if (!record || !sessionStore || !header?.sourceCommandId) return;
  const user = snapshot.rows.window.find(
    (row) => row.kind === "userInput" && row.sourceCommandId === header.sourceCommandId,
  );
  if (!user || user.kind !== "userInput") return;
  if (!user.highspeed) return;
  if (header.modelDurationMs === undefined && header.toolDurationMs === undefined) {
    return;
  }
  void persistHighspeedTiming({
    sessionStore,
    eventStore: record.eventStore,
    sessionId,
    sourceCommandId: header.sourceCommandId,
    timing: {
      modelDurationMs: header.modelDurationMs ?? 0,
      toolDurationMs: header.toolDurationMs ?? 0,
      otherDurationMs: header.otherDurationMs ?? 0,
    },
    ...(header.outputTokens !== undefined ? { outputTokens: header.outputTokens } : {}),
    ...(header.activeMs !== undefined ? { durationMs: header.activeMs } : {}),
    ...(user.highspeed.fallbackAt !== undefined ? { fallbackAt: user.highspeed.fallbackAt } : {}),
    ...(user.highspeed.fallbackReason !== undefined
      ? { fallbackReason: user.highspeed.fallbackReason }
      : {}),
    traceId: String(record.traceContext.traceId),
    onPersistedEvent: (persisted) => context.v4Gateway?.ingest(sessionId, persisted),
    onLiveProjectionError: (error) =>
      context.logger?.warn("v4 highspeed timing live projection failed", {
        error: error instanceof Error ? error.message : String(error),
        sessionId,
      }),
  }).catch((error) => {
    context.logger?.warn("v4 highspeed timing persistence failed", {
      error: error instanceof Error ? error.message : String(error),
      sessionId,
    });
  });
}

export function createConversationV4Gateway(
  context: CfProtocolAgentServerContext,
): ConversationV4Gateway {
  const log = createProtocolLogger(context.deps)?.child({
    module: "bootstrap.cf_protocol_v4_gateway",
  });
  const persistentCommands = new PersistentCommandIndex({
    loadSession: async (sessionId) => {
      const live = context.sessions.get(sessionId);
      const stored = await context.deps.sessionStore?.getSession(sessionId as SessionId);
      if (!live && !stored) return null;
      const workspacePath = live?.workspace.workspacePath ?? stored?.directory;
      if (!workspacePath) return null;
      const workspaceIdentity = live?.workspace.workspaceIdentity ?? stored?.workspaceID;
      const facts = context.deps.sessionStore
        ? await loadPersistentCommandFacts(context.deps.sessionStore, sessionId as SessionId, {
            discardAdmittedOnLoad: !live,
          })
        : undefined;
      return {
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity: String(workspaceIdentity) } : {}),
        ...(facts ? { facts } : {}),
      };
    },
  });
  let nativeExecutor: V4CommandExecutor;
  const autoDrainRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const queuedTurnExecutions = new Map<string, Map<string, V4QueuedTurnExecution>>();
  const autoDrainV4QueueIfReady = async (record: CfProtocolSessionRecord): Promise<void> => {
    const head = context.v4Gateway?.getQueueHead(record.app.sessionId);
    if (!head) {
      record.app.completeExternalQueueDrain();
      return;
    }
    const coreForegroundBusy = record.app.runtime.getActiveForegroundExecutionId() !== undefined;
    if (
      head.autoDrain &&
      head.dispatchState === "queued" &&
      (record.activeAbortController !== undefined || coreForegroundBusy)
    ) {
      scheduleAutoDrainRetry(record);
      return;
    }
    let targetStatus: GoalStatus | null = null;
    if (head.autoDrain && head.dispatchState === "queued" && !record.activeAbortController) {
      try {
        targetStatus = (await record.app.readTarget())?.status ?? null;
      } catch (error) {
        context.logger?.warn("v4 auto-drain held because target state could not be read", {
          error: error instanceof Error ? error.message : String(error),
          queueItemId: head.queueItemId,
          sessionId: record.app.sessionId,
        });
        return;
      }
    }
    if (
      !shouldAutoDrainV4QueueHead({
        autoDrain: head.autoDrain,
        dispatchState: head.dispatchState,
        sessionBusy: Boolean(record.activeAbortController) || coreForegroundBusy,
        targetStatus,
      })
    ) {
      return;
    }
    try {
      await nativeExecutor.execute(
        {
          baseRevision: 0,
          clientId: "v4-auto-drain",
          commandId: `auto-${head.kind}-${Date.now()}-${head.queueItemId}`,
          issuedAt: Date.now(),
          payload: { queueItemId: head.queueItemId },
          sessionId: record.app.sessionId,
          type: "sendQueuedNow",
        },
        undefined,
        { autoDrainPromotion: true },
      );
    } catch (error) {
      if (error instanceof V4QueuePromotionLeaseUnavailableError) {
        scheduleAutoDrainRetry(record);
        return;
      }
      await record.app.setQueueAutoDrain(false);
      context.logger?.warn("v4 auto-drain failed and queue was paused", {
        error: error instanceof Error ? error.message : String(error),
        queueItemId: head.queueItemId,
        sessionId: record.app.sessionId,
      });
    }
  };
  const scheduleAutoDrainRetry = (record: CfProtocolSessionRecord): void => {
    const sessionId = record.app.sessionId;
    if (autoDrainRetryTimers.has(sessionId)) return;
    const timer = setTimeout(() => {
      autoDrainRetryTimers.delete(sessionId);
      if (context.sessions.get(sessionId) !== record) return;
      void autoDrainV4QueueIfReady(record).catch((error: unknown) => {
        context.logger?.warn("v4 auto-drain idle reevaluation failed", {
          error: error instanceof Error ? error.message : String(error),
          sessionId,
        });
      });
    }, 100);
    timer.unref?.();
    autoDrainRetryTimers.set(sessionId, timer);
  };
  const coreHost: V4CommandCoreHost = {
    getRecord: (sessionId) => context.sessions.get(sessionId),
    interactions: context.v4Interactions,
    logger: {
      info: (message, fields) => context.logger?.info(message, fields),
      warn: (message, fields) => context.logger?.warn(message, fields),
    },
    getQueueItem: (sessionId, queueItemId) =>
      context.v4Gateway?.getQueueItem(sessionId, queueItemId) ?? null,
    hasQueueItemKind: (sessionId, kind) =>
      context.v4Gateway?.hasQueueItemKind(sessionId, kind) ?? false,
    hasQueuedDelivery: (sessionId, delivery) =>
      context.v4Gateway?.hasQueuedDelivery(sessionId, delivery) ?? false,
    getQueueLength: (sessionId) => context.v4Gateway?.getQueueLength(sessionId) ?? 0,
    retainQueuedTurnExecution: (sessionId, sourceCommandId, execution) => {
      const sessionExecutions = queuedTurnExecutions.get(sessionId) ?? new Map();
      sessionExecutions.set(sourceCommandId, execution);
      queuedTurnExecutions.set(sessionId, sessionExecutions);
    },
    readQueuedTurnExecution: (sessionId, sourceCommandId) =>
      queuedTurnExecutions.get(sessionId)?.get(sourceCommandId),
    deleteQueuedTurnExecution: (sessionId, sourceCommandId) => {
      const sessionExecutions = queuedTurnExecutions.get(sessionId);
      sessionExecutions?.delete(sourceCommandId);
      if (sessionExecutions?.size === 0) queuedTurnExecutions.delete(sessionId);
    },
    clearQueuedTurnExecutions: (sessionId) => {
      queuedTurnExecutions.delete(sessionId);
    },
    waitForProjectionEventCommit: (sessionId, eventId, options) => {
      const gateway = context.v4Gateway;
      if (!gateway) {
        return Promise.reject(new Error("v4 gateway unavailable for projection commit wait"));
      }
      return gateway.waitForProjectionEventCommit(sessionId, eventId, options);
    },
    admitInputCommand: async (envelope, sessionId, admission) => {
      if (!context.deps.sessionStore?.saveSessionInput) return null;
      const input = resolveInputCommandForAdmission(
        envelope,
        sessionId,
        (sourceSessionId, target, action) =>
          context.v4Gateway?.resolveRowActionTarget(sourceSessionId, target, action) ?? null,
      );
      if (!input) return null;
      const kind = input.kind;
      const record = context.sessions.get(sessionId);
      if (record?.persistence === "deferred") {
        await record.app.runtime.ensureSessionPersistedForExternalActivity(input.text ?? "", {
          traceContext: record.traceContext,
        });
        record.persistence = "immediate";
      }
      const routingMode = context.v4Gateway?.getInputRoutingMode(sessionId) ?? null;
      const requestedDelivery =
        input.requestedDelivery ??
        (kind === "compact" && routingMode !== null && routingMode !== "startNow"
          ? "queue"
          : routingMode === "enqueue"
            ? "queue"
            : routingMode === "guide" && kind === "sendText"
              ? "guide"
              : "startNow");
      const attachmentRefs = input.attachments;
      const fallbackReasonCode =
        input.fallbackReasonCode ??
        (requestedDelivery === "guide" && attachmentRefs.length > 0
          ? "guide.attachmentsUnsupported"
          : undefined);
      const admittedDelivery =
        input.admittedDelivery ??
        (fallbackReasonCode
          ? "queue"
          : requestedDelivery === "auto"
            ? "startNow"
            : requestedDelivery);
      const conversationInputIntent = conversationInputIntentSchema.parse({
        ...(input.inputOrigin ? { inputOrigin: input.inputOrigin } : {}),
        ...(input.conversationQuotes ? { conversationQuotes: input.conversationQuotes } : {}),
        ...(input.botGroupSource ? { botGroupSource: input.botGroupSource } : {}),
        sourceCommandId: envelope.commandId,
        queueItemId: admission.queueItemId,
        clientId: envelope.clientId || "cli",
        kind,
        text: input.text ?? "",
        attachments: attachmentRefs,
        ...(input.sharedContextRefs ? { sharedContextRefs: input.sharedContextRefs } : {}),
        delivery: {
          requested: requestedDelivery,
          admitted: admittedDelivery,
          ...(fallbackReasonCode ? { fallbackReasonCode } : {}),
        },
        order: { admissionSeq: admission.admissionSeq },
        steer: fallbackReasonCode
          ? { state: "fellBack", reasonCode: fallbackReasonCode }
          : requestedDelivery === "guide"
            ? { state: "submitting" }
            : { state: "notRequested" },
        dispatch: { state: "admitted" },
        admittedAt: admission.admittedAt,
        ...(input.highspeed ? { highspeed: input.highspeed } : {}),
        ...(input.provenance ? { provenance: input.provenance } : {}),
      });
      await context.deps.sessionStore.saveSessionInput({
        id: admission.queueItemId,
        sessionID: sessionId as SessionId,
        kind,
        delivery: conversationInputIntent.delivery.admitted,
        payload: {
          text: conversationInputIntent.text,
          intent: {
            sourceCommandId: conversationInputIntent.sourceCommandId,
            queueItemId: conversationInputIntent.queueItemId,
            clientId: conversationInputIntent.clientId,
            kind: conversationInputIntent.kind,
            admissionSeq: admission.admissionSeq,
            admittedAt: admission.admittedAt,
            requestedDelivery: conversationInputIntent.delivery.requested,
            admittedDelivery: conversationInputIntent.delivery.admitted,
            ...(fallbackReasonCode ? { fallbackReasonCode } : {}),
            attachmentRefs,
            ...(conversationInputIntent.sharedContextRefs
              ? { sharedContextRefs: conversationInputIntent.sharedContextRefs }
              : {}),
          },
          conversationInputIntent,
          attachments: attachmentRefs,
          ...(conversationInputIntent.sharedContextRefs
            ? { sharedContextRefs: conversationInputIntent.sharedContextRefs }
            : {}),
          sourceCommandType: envelope.type,
        },
      });
      if (
        conversationInputIntent.sharedContextRefs?.length &&
        conversationInputIntent.delivery.admitted !== "startNow"
      ) {
        const reference = conversationInputIntent.sharedContextRefs[0]!;
        const reserved = await context.deps.sessionStore.transitionSharedContextImport?.({
          sessionID: sessionId as SessionId,
          contextId: reference.context_id,
          expectedStatus: "pending",
          status: "reserved",
          sourceId: admission.queueItemId,
        });
        if (!reserved) {
          await context.deps.sessionStore.settleSessionInput?.({
            id: admission.queueItemId,
            sessionID: sessionId as SessionId,
            status: "failed",
            reason: "shared_context_not_attachable",
          });
          throw new Error("fault.command.sharedContextNotAttachable");
        }
        const entry = (
          await context.deps.sessionStore.sessionEntries?.({
            sessionID: sessionId as SessionId,
            type: "v4/shared_context_import",
          })
        )?.find((candidate) => {
          const data = candidate.data;
          return Boolean(
            data &&
            typeof data === "object" &&
            !Array.isArray(data) &&
            (data as Record<string, unknown>).contextId === reference.context_id,
          );
        });
        const data = entry?.data;
        const session = await context.deps.sessionStore.getSession(sessionId as SessionId);
        if (
          data &&
          typeof data === "object" &&
          !Array.isArray(data) &&
          typeof (data as Record<string, unknown>).shareUrl === "string" &&
          session?.title
        ) {
          context.v4Gateway?.updateSharedContextImport(sessionId, {
            contextId: reference.context_id,
            title: session.title,
            shareUrl: String((data as Record<string, unknown>).shareUrl),
            status: "reserved",
          });
        }
      }
      return conversationInputIntent;
    },
    cancelInputCommand: async (sessionId, queueItemId, reason) => {
      await context.deps.sessionStore?.settleSessionInput?.({
        id: queueItemId,
        sessionID: sessionId as SessionId,
        status: "cancelled",
        reason,
      });
      const store = context.deps.sessionStore;
      const entries = await store?.sessionEntries?.({
        sessionID: sessionId as SessionId,
        type: "v4/shared_context_import",
      });
      const reserved = entries?.find((entry) => {
        const data = entry.data;
        return Boolean(
          data &&
          typeof data === "object" &&
          !Array.isArray(data) &&
          (data as Record<string, unknown>).status === "reserved" &&
          (data as Record<string, unknown>).sourceId === queueItemId,
        );
      });
      const contextId =
        reserved?.data && typeof reserved.data === "object"
          ? (reserved.data as Record<string, unknown>).contextId
          : undefined;
      if (typeof contextId === "string") {
        await store?.transitionSharedContextImport?.({
          sessionID: sessionId as SessionId,
          contextId,
          expectedStatus: "reserved",
          status: "pending",
          sourceId: queueItemId,
        });
      }
    },
    discardSharedContext: async (sessionId, contextId) => {
      const store = context.deps.sessionStore;
      if (!store?.transitionSharedContextImport) return false;
      const updated = await store.transitionSharedContextImport({
        sessionID: sessionId as SessionId,
        contextId,
        expectedStatus: "pending",
        status: "discarded",
      });
      if (updated) {
        const entry = (
          await store.sessionEntries?.({
            sessionID: sessionId as SessionId,
            type: "v4/shared_context_import",
          })
        )?.find((candidate) => {
          const data = candidate.data;
          return Boolean(
            data &&
            typeof data === "object" &&
            !Array.isArray(data) &&
            (data as Record<string, unknown>).contextId === contextId,
          );
        });
        const data = entry?.data;
        const session = await store.getSession(sessionId as SessionId);
        if (
          data &&
          typeof data === "object" &&
          !Array.isArray(data) &&
          typeof (data as Record<string, unknown>).shareUrl === "string" &&
          typeof (data as Record<string, unknown>).contextId === "string" &&
          session?.title
        ) {
          context.v4Gateway?.updateSharedContextImport(sessionId, {
            contextId: String((data as Record<string, unknown>).contextId),
            title: session.title,
            shareUrl: String((data as Record<string, unknown>).shareUrl),
            status: "discarded",
          });
        }
      }
      return updated;
    },
    recordPersistentCommandFact: async (sessionId, source, ack, metadata) => {
      const store = context.deps.sessionStore;
      const live = context.sessions.get(sessionId);
      const stored = await store?.getSession(sessionId as SessionId);
      if (!store || (!live && !stored)) {
        throw new Error("fault.command.persistentFactSessionNotFound");
      }
      await savePersistentCommandFact(store, sessionId as SessionId, source, ack, metadata);
      const workspacePath = live?.workspace.workspacePath ?? stored?.directory;
      if (!workspacePath) throw new Error("fault.command.persistentFactWorkspaceMissing");
      const workspaceIdentity = live?.workspace.workspaceIdentity ?? stored?.workspaceID;
      await persistentCommands.record(
        {
          workspacePath,
          ...(workspaceIdentity ? { workspaceIdentity: String(workspaceIdentity) } : {}),
        },
        sessionId,
        source,
        ack,
      );
    },
    getInputRoutingMode: (sessionId) => context.v4Gateway?.getInputRoutingMode(sessionId) ?? null,
    getMessageIdForRow: (sessionId, rowId) =>
      context.v4Gateway?.getMessageIdForRow(sessionId, rowId) ?? null,
    resolveRowActionTarget: (sessionId, target, action) =>
      context.v4Gateway?.resolveRowActionTarget(sessionId, target, action) ?? null,
    getMessageIdsForTurnRow: (sessionId, rowId) =>
      context.v4Gateway?.getMessageIdsForTurnRow(sessionId, rowId) ?? [],
    isLatestAssistantSegmentRow: (sessionId, rowId) =>
      context.v4Gateway?.isLatestAssistantSegmentRow(sessionId, rowId) ?? null,
    resolveStableForkTarget: async (sessionId, rowId) => {
      const candidate = context.v4Gateway?.resolveStableForkCandidate(sessionId, rowId) ?? null;
      if (!candidate) return { ok: false, reasonCode: "guard.forkTargetAmbiguous" };
      if (!candidate.ok) return candidate;
      const store = context.deps.sessionStore;
      if (!store) return { ok: false, reasonCode: "guard.forkTargetAmbiguous" };
      const messages = await store.messages({ sessionID: sessionId as SessionId });
      return await resolveStableForkTargetFromTranscript({
        candidate: candidate.candidate,
        messages,
        store,
      });
    },
    isLatestRetryAssistantRow: (sessionId, rowId) =>
      context.v4Gateway?.isLatestRetryAssistantRow(sessionId, rowId) ?? null,
    isLatestEditableUserRow: (sessionId, rowId) =>
      context.v4Gateway?.isLatestEditableUserRow(sessionId, rowId) ?? null,
    getTurnIdForRow: (sessionId, rowId) =>
      context.v4Gateway?.getTurnIdForRow(sessionId, rowId) ?? null,
    hasUsableRuntimeModelTarget: (record) => record.app.listModels().length > 0,
    getTurnRewindAnchor: (sessionId, rowId) =>
      context.v4Gateway?.getTurnRewindAnchor(sessionId, rowId) ?? null,
    resolveUserMessageIdForRow: async (sessionId, rowId) => {
      const turnId = context.v4Gateway?.getTurnIdForRow(sessionId, rowId) ?? null;
      const sessionStore = context.deps.sessionStore;
      if (!turnId || !sessionStore) return null;
      const messages = await sessionStore.messages({
        sessionID: sessionId as SessionId,
      });
      const user = messages
        .filter(
          (message) =>
            message.info.role === "user" &&
            String(message.info.anchor?.turnId ?? "") === turnId &&
            isConversationRealUserTurnStarter(message),
        )
        .at(-1);
      return user ? String(user.info.id) : null;
    },
    resolveTurnUserPrompt: async (sessionId, assistantMessageId) => {
      const sessionStore = context.deps.sessionStore;
      if (!sessionStore) return null;
      const messages = await sessionStore.messages({
        sessionID: sessionId as SessionId,
      });
      const assistantInfo = messages.find(
        (message) => message.info.id === assistantMessageId,
      )?.info;
      if (assistantInfo?.role !== "assistant") return null;
      const user = messages.find((message) => message.info.id === assistantInfo.parentID);
      if (!user || user.info.role !== "user") return null;
      const text = user.parts
        .filter(
          (part): part is Extract<(typeof user.parts)[number], { type: "text" }> =>
            part.type === "text" && part.ignored !== true,
        )
        .map((part) => part.text)
        .join("");
      return text.length > 0 ? text : null;
    },
    setAssistantFeedback: async (sessionId, input) => {
      const record = context.sessions.get(sessionId);
      const sessionStore = context.deps.sessionStore;
      if (!record || !sessionStore) throw new Error("proto.sessionNotFound");
      await persistAssistantFeedback({
        sessionStore,
        eventStore: record.eventStore,
        sessionId,
        messageId: input.messageId,
        entityId: input.entityId,
        feedback: input.feedback,
        traceId: String(record.traceContext.traceId),
        onPersistedEvent: (persisted) => context.v4Gateway?.ingest(sessionId, persisted),
        onLiveProjectionError: (error) =>
          context.logger?.warn("v4 assistant feedback live projection failed", {
            error: error instanceof Error ? error.message : String(error),
            sessionId,
          }),
      });
    },
    setHighspeedMetrics: async (sessionId, input) => {
      const record = context.sessions.get(sessionId);
      const sessionStore = context.deps.sessionStore;
      if (!record || !sessionStore) throw new Error("proto.sessionNotFound");
      await persistHighspeedMetrics({
        sessionStore,
        eventStore: record.eventStore,
        sessionId,
        messageId: input.messageId,
        entityId: input.entityId,
        metrics: input.metrics,
        traceId: String(record.traceContext.traceId),
        onPersistedEvent: (persisted) => context.v4Gateway?.ingest(sessionId, persisted),
        onLiveProjectionError: (error) =>
          context.logger?.warn("v4 highspeed metrics live projection failed", {
            error: error instanceof Error ? error.message : String(error),
            sessionId,
          }),
      });
    },
    ensureModelReady: (record) =>
      ensureSessionModelAvailableForNextTurn(context, record as CfProtocolSessionRecord),
    ensureProviderAvailable: async (sessionId, providerId) => {
      const record = context.sessions.get(sessionId);
      if (!record) return { available: false, reason: "session_not_found" };
      if (!hasSessionModelProvider(context, record, providerId)) {
        return { available: false, reason: "provider_not_in_registry" };
      }
      return { available: true };
    },
    afterLegacyStateMutation: async (record, reason) => {
      await afterStateMutation(context, record as CfProtocolSessionRecord, reason);
      await autoDrainV4QueueIfReady(record as CfProtocolSessionRecord);
    },
    deleteSession: async (sessionId) => {
      if (!context.deps.sessionStore?.softDeleteSession)
        throw new Error("Session soft deletion is unavailable");
      await context.deps.sessionStore.softDeleteSession(sessionId as SessionId);
      const record = context.sessions.get(sessionId);
      if (!record) {
        return;
      }
      record.unsubscribe?.();
      await record.app.close?.();
      context.v4Gateway?.disposeSession(sessionId, { deleted: true });
      queuedTurnExecutions.delete(sessionId);
      context.sessions.delete(sessionId);
    },
    createSessionRecord: async ({
      sessionId,
      additionalDirectories,
      workspaceId,
      mcpServers,
      offPeakToolEnabled,
      dynamicWorkflowEnabled,
      dynamicWorkflowMode,
      permissionScope,
    }) => {
      if (permissionScope && !context.deps.sessionStore)
        throw new Error("Group task permission scope requires persistence");
      const created = await createSessionRecordForV4(context, {
        sessionId,
        additionalDirectories,
        workspace: resolveWorkspaceRefFromId(workspaceId),
        persistence: "deferred",
        mcpServers,
        ...(offPeakToolEnabled === true ? { offPeakToolEnabled: true } : {}),
        ...(dynamicWorkflowEnabled === true ? { dynamicWorkflowEnabled: true } : {}),
        ...(dynamicWorkflowEnabled === true && dynamicWorkflowMode !== undefined
          ? { dynamicWorkflowMode }
          : {}),
      });
      if (permissionScope) {
        const record = context.sessions.get(created.sessionId);
        if (!record) throw new Error("Group task runtime is unavailable");
        await record.app.runtime.ensureSessionPersistedForExternalActivity("", {
          traceContext: record.traceContext,
        });
        await context.deps.sessionStore!.updateSession({
          id: created.sessionId as SessionId,
          permission: { version: 1, scope: "session", mode: "build" },
        });
        await record.app.runtime.setExecutionState({ mode: "build" }, record.traceContext);
        record.persistence = "immediate";
      }
      return { sessionId: created.sessionId };
    },
    createSelectionSideSession: async (sessionId, options) => {
      const record = context.sessions.get(sessionId);
      if (!record) throw new Error("proto.sessionNotFound");
      const modelSelection = cloneModelSelection(
        options.modelSelection ?? record.app.runtime.getSessionModelSelection(),
      );
      const fork = await record.app.runtime.createSelectionSideConversation({
        modelSelection,
        sourceCommandId: options.sourceCommandId,
        revisionAtDecision: options.revisionAtDecision,
        traceContext: record.traceContext,
      });
      await registerCommittedForkBestEffort(context, record, fork, {
        commandId: options.sourceCommandId,
        runtimeConfig: {
          mode: record.app.getMode(),
          model: modelSelection ? `${modelSelection.providerId}/${modelSelection.modelId}` : "",
          ...(modelSelection?.options?.reasoningLevel
            ? { thoughtLevel: modelSelection.options.reasoningLevel }
            : {}),
          followupMode: context.v4Gateway?.getSessionFollowupMode(sessionId) ?? "queue",
        },
        inheritLatestTarget: false,
      });
      return { sessionId: String(fork.forkedSessionId) };
    },
    forkStableConversation: async (sessionId, options) => {
      const { goalBoundary, revisionAtDecision, sourceCommandId, target } = options;
      const record = context.sessions.get(sessionId);
      if (!record) throw new Error("proto.sessionNotFound");
      const store = context.deps.sessionStore;
      if (!store) throw new Error("fault.command.stableForkStoreUnavailable");
      const messages = await store.messages({ sessionID: sessionId as SessionId });
      const boundary = messages.find(
        (message) => String(message.info.id) === target.boundaryMessageId,
      );
      if (boundary?.info.role !== "assistant") {
        throw new Error("guard.forkTargetAmbiguous");
      }
      const modelSelection = derivedSessionModelSelection(
        boundary.info.providerId && boundary.info.modelId
          ? {
              providerId: boundary.info.providerId,
              modelId: boundary.info.modelId,
              ...(boundary.info.reasoningLevel
                ? { options: { reasoningLevel: boundary.info.reasoningLevel } }
                : {}),
            }
          : undefined,
        record.app.runtime.getSessionModelSelection(),
      );
      const fork = await record.app.runtime.forkStableConversationAtMessage({
        modelSelection,
        target,
        goalBoundary,
        sourceCommandId,
        revisionAtDecision,
        traceContext: record.traceContext,
      });
      await registerCommittedForkBestEffort(context, record, fork, {
        commandId: sourceCommandId,
        runtimeConfig: {
          mode: stableForkMode(boundary.info.mode, record.app.getMode()),
          model: modelSelection ? `${modelSelection.providerId}/${modelSelection.modelId}` : "",
          ...(modelSelection?.options?.reasoningLevel
            ? { thoughtLevel: modelSelection.options.reasoningLevel }
            : {}),
        },
        inheritLatestTarget: false,
      });
      return { forkedSessionId: String(fork.forkedSessionId) };
    },
    forkConversationBeforeInput: async (sessionId, { editTarget, envelope, admission }) => {
      const record = context.sessions.get(sessionId);
      if (!record) throw new Error("proto.sessionNotFound");
      const store = context.deps.sessionStore;
      if (!store) throw new Error("fault.command.stableForkStoreUnavailable");
      const messages = await store.messages({
        sessionID: sessionId as SessionId,
      });
      const targetMessage = messages.find(
        (message) => String(message.info.id) === editTarget.transcriptMessageId,
      );
      if (targetMessage?.info.role !== "user") {
        throw new Error("guard.latestQueryEditOnly");
      }
      const modelSelection = derivedSessionModelSelection(
        targetMessage.info.modelSelection,
        record.app.runtime.getSessionModelSelection(),
      );
      const events = await record.eventStore.getEvents(sessionId as SessionId);
      const targetStarted = events.find(
        (event) =>
          event.type === SessionEventType.TurnStarted &&
          String((event.payload as { messageId?: unknown }).messageId ?? "") ===
            editTarget.transcriptMessageId,
      );
      const priorTargetChange = targetStarted
        ? events
            .filter(
              (event) =>
                event.sequenceNumber < targetStarted.sequenceNumber &&
                event.type === SessionEventType.TargetChanged,
            )
            .at(-1)
        : undefined;
      const forkedSessionId = String(createSessionId());
      const input = resolveInputCommandForAdmission(
        envelope,
        forkedSessionId,
        (sourceSessionId, target, action) =>
          context.v4Gateway?.resolveRowActionTarget(sourceSessionId, target, action) ?? null,
      );
      if (!input) throw new Error("fault.command.forkInputAdmissionMissing");
      const initialInput = buildForkInitialInput(envelope, forkedSessionId, admission, input);
      let goalBoundary: StableForkGoalBoundaryMetadata | null = priorTargetChange
        ? (() => {
            const target = (priorTargetChange.payload as { target?: unknown }).target;
            return target
              ? {
                  kind: "snapshot" as const,
                  target: target as Extract<
                    StableForkGoalBoundaryMetadata,
                    { kind: "snapshot" }
                  >["target"],
                  verificationEntryIds: [],
                }
              : { kind: "none" as const };
          })()
        : null;
      if (goalBoundary?.kind === "snapshot" && store.sessionEntries && targetStarted) {
        const targetId = goalBoundary.target.targetID;
        const boundaryTime = targetStarted.timestamp.getTime();
        const entries = await store.sessionEntries({
          sessionID: sessionId as SessionId,
          type: SESSION_ENTRY_TARGET_COMPLETION_VERIFICATION,
        });
        goalBoundary = {
          ...goalBoundary,
          verificationEntryIds: entries.flatMap((entry) => {
            const data = entry.data as { payload?: { targetId?: unknown } };
            return entry.time.updated <= boundaryTime && data.payload?.targetId === targetId
              ? [entry.id]
              : [];
          }),
        };
      }
      if (!goalBoundary) {
        const targetIndex = messages.indexOf(targetMessage);
        const previousAssistant = messages
          .slice(0, targetIndex)
          .reverse()
          .find((message) => message.info.role === "assistant");
        goalBoundary = previousAssistant?.info.anchor?.goalBoundary ?? null;
        if (!previousAssistant) goalBoundary = { kind: "none" };
      }
      if (!goalBoundary) {
        throw new Error("guard.forkTargetAmbiguous");
      }
      const fork = await record.app.runtime.forkConversationBeforeMessage({
        modelSelection,
        forkedSessionId: forkedSessionId as SessionId,
        targetMessageId: targetMessage.info.id,
        targetProductTurnId: editTarget.productTurnId,
        targetTranscriptTurnId: String(
          targetMessage.info.anchor?.turnId ?? editTarget.productTurnId,
        ),
        sourceCommandId: envelope.commandId,
        initialInput,
        commandFact: {
          parentSessionId: sessionId,
          sourceCommandId: envelope.commandId,
          ack: {
            commandId: envelope.commandId,
            status: "accepted",
            revisionAtDecision: envelope.baseRevision ?? 0,
            result: {
              type: "editUserQuery",
              disposition: "fork",
              sessionId: forkedSessionId,
            },
          },
          metadata: {
            parentSessionId: sessionId,
            sourceCommandId: envelope.commandId,
            editTarget,
          },
        },
        goalBoundary,
        traceContext: record.traceContext,
      });
      await registerCommittedForkBestEffort(context, record, fork, {
        commandId: envelope.commandId,
        runtimeConfig: {
          mode: record.app.getMode(),
          model: modelSelection ? `${modelSelection.providerId}/${modelSelection.modelId}` : "",
          ...(modelSelection?.options?.reasoningLevel
            ? { thoughtLevel: modelSelection.options.reasoningLevel }
            : {}),
        },
        inheritLatestTarget: false,
      });
      return { forkedSessionId: String(fork.forkedSessionId) };
    },
    recordForkStartFailure: async (sessionId, envelope, error) => {
      await recordForkStartFailureBestEffort(context, sessionId, envelope, error, {
        parentSessionId: String(envelope.sessionId ?? ""),
      });
    },
  };
  nativeExecutor = new V4CommandExecutor(coreHost);
  const loadStoredSessionSummaries = async (
    workspaceId: string,
    legacyTaskIds?: readonly string[],
  ) => {
    if (!context.deps.sessionStore) return [];
    try {
      const parsedRemote = parseRemoteWorkspaceIdentity(workspaceId);
      const persistedWorkspacePath = parsedRemote?.workspacePath ?? workspaceId;
      if (
        parsedRemote &&
        legacyTaskIds &&
        legacyTaskIds.length > 0 &&
        context.deps.sessionStore.claimLegacySessionWorkspace
      ) {
        try {
          const claimedCount = await context.deps.sessionStore.claimLegacySessionWorkspace({
            sessionIDs: legacyTaskIds as SessionId[],
            directory: persistedWorkspacePath,
            workspaceID: workspaceId as WorkspaceId,
          });
          if (claimedCount > 0) {
            context.logger?.info("legacy remote sessions claimed by task-index allowlist", {
              claimedCount,
              event: "cf_protocol.v4.sessions_index_legacy_remote_claimed",
              module: "bootstrap.cf_protocol",
              workspaceId,
            });
          }
        } catch (error) {
          context.logger?.warn("legacy remote sessions claim failed; continuing strict load", {
            error: error instanceof Error ? error.message : String(error),
            event: "cf_protocol.v4.sessions_index_legacy_remote_claim_failed",
            module: "bootstrap.cf_protocol",
            workspaceId,
          });
        }
      }
      const stored = await context.deps.sessionStore.listSessions({
        directory: persistedWorkspacePath,
        limit: 200,
        taskTypes: [...TASK_LIST_SESSION_TYPES],
        workspaceID: parsedRemote ? (workspaceId as WorkspaceId) : null,
      });
      return stored.map((session) => ({
        sessionId: String(session.id),
        workspaceId,
        ...(session.parentID ? { parentSessionId: String(session.parentID) } : {}),
        title: session.title ?? "",
        titleSource: normalizeStoredTitleSource(session.titleSource),
        phase:
          session.lastOutcome === "error"
            ? ("error" as const)
            : session.lastOutcome === "interrupted"
              ? ("completedInterrupted" as const)
              : ("completedSuccess" as const),
        ...(session.lastOutcome ? { lastOutcome: session.lastOutcome } : {}),
        sessionEnded: true,
        hasBackgroundWork: false,
        lastActivityAt: session.time?.updated ?? 0,
        createdAt: session.time?.created ?? 0,
      }));
    } catch (error) {
      context.logger?.warn("sessions-index stored summaries failed", {
        error: error instanceof Error ? error.message : String(error),
        event: "cf_protocol.v4.sessions_index_stored_failed",
        module: "bootstrap.cf_protocol",
      });
      return [];
    }
  };
  return new ConversationV4Gateway({
    cliVersion: context.deps.version,
    sessionExists: (sessionId) => context.sessions.has(sessionId),
    reconcileSessions: async ({ workspaceId, sessionIds }) => {
      const store = context.deps.sessionStore;
      if (!store) throw new Error("Session store is unavailable");
      const remote = parseRemoteWorkspaceIdentity(workspaceId);
      const directory = remote?.workspacePath ?? workspaceId;
      const sessions = await Promise.all(
        [...new Set(sessionIds)].map(async (sessionId) => {
          const session = await store.getSession(sessionId as SessionId);
          const sameWorkspace =
            session &&
            session.directory === directory &&
            (remote
              ? session.workspaceID === workspaceId
              : !session.workspaceID || session.workspaceID === workspaceId);
          if (!sameWorkspace) return { sessionId, exists: false as const, deleted: false as const };
          return {
            sessionId,
            exists: true as const,
            deleted: session.time.deleted !== undefined,
            title: session.title,
            titleSource: normalizeStoredTitleSource(session.titleSource),
            createdAt: session.time.created,
            updatedAt: session.time.updated,
            ...(session.lastOutcome ? { lastOutcome: session.lastOutcome } : {}),
          };
        }),
      );
      return { sessions };
    },
    onDebug: (message) => log?.debug(message),
    onTargetCompleted: (sessionId) => {
      const record = context.sessions.get(sessionId);
      if (!record) return;
      void Promise.resolve()
        .then(() => autoDrainV4QueueIfReady(record))
        .catch((error: unknown) => {
          context.logger?.warn("v4 auto-drain reevaluation after target completion failed", {
            error: error instanceof Error ? error.message : String(error),
            sessionId,
          });
        });
    },
    onHighspeedTurnTerminal: (sessionId, event, snapshot) => {
      persistHighspeedTimingOnTurnTerminal(context, sessionId, event, snapshot);
    },
    retainSessionRuntime: async (sessionId) =>
      (await context.sessionResidentPool?.acquireOperation(sessionId)) ?? (() => undefined),
    loadPersistedMessages: async (sessionId) => {
      const store = context.deps.sessionStore;
      if (!store || !(await store.getSession(sessionId as SessionId)))
        throw new Error("fault.subscribe.sessionNotFound");
      return store.messages({ sessionID: sessionId as SessionId });
    },
    resumePersistedSession: async (
      sessionId,
      resumeThoughtLevel,
      workspace?: CfWorkspaceRef,
      additionalDirectories?: string[],
      persistedMessages?: MessageWithParts[],
    ) => {
      const persisted = await context.deps.sessionStore?.getSession(sessionId as SessionId);
      if (!persisted || persisted.time.deleted !== undefined) {
        context.logger?.warn("CodeFusion Protocol v4 cold resume has no persisted session", {
          activeSessionCount: context.sessions.size,
          event: "cf_protocol.v4.resume_persisted_missing",
          module: "bootstrap.cf_protocol",
          sessionId,
        });
        return { status: "notFound" };
      }
      const existingRecord = context.sessions.get(sessionId);
      const activated = await activateSessionForResume(
        context,
        {
          sessionId,
          ...(workspace ? { workspace } : {}),
          ...(additionalDirectories !== undefined ? { additionalDirectories } : {}),
          ...(resumeThoughtLevel ? { thoughtLevel: resumeThoughtLevel } : {}),
        },
        { reusePersistedMessages: true, persistedMessages },
      );
      return {
        status: "resumed",
        persistedMessages: activated.persistedMessages,
        ...(!existingRecord
          ? {
              disposeOnFailure: () =>
                discardFailedSessionResume(context, sessionId, activated.record),
            }
          : {}),
      };
    },
    emitWireFrame: (wire) =>
      context.notify({
        method: V4_NOTIFICATIONS.conversationFrame,
        params: wire,
      }),
    emitLocalTtftFacts: (facts) =>
      context.notify({ method: V4_NOTIFICATIONS.localTtftFacts, params: facts }),
    emitConversationTelemetryFact: (fact) =>
      context.notify({
        method: V4_NOTIFICATIONS.conversationTelemetryFact,
        params: fact,
      }),
    emitPluginUiToolResult: (result) =>
      context.notify({ method: V4_NOTIFICATIONS.pluginUiToolResult, params: result }),
    emitCuaPermissionObservation: (observation) =>
      context.notify({
        method: V4_NOTIFICATIONS.cuaPermissionObservation,
        params: observation,
      }),
    getSessionMemoryEnabled: (sessionId) => context.sessions.get(sessionId)?.memoryEnabled,
    getSessionConfigSeed: (sessionId) => {
      const record = context.sessions.get(sessionId);
      if (!record) return null;
      const selection =
        record.app.runtime.getSessionModelSelection() ?? record.restoredModelSelection;
      return {
        modelSelection: cloneModelSelection(selection),
        provider: selection?.providerId ?? "",
        model: selection?.modelId ?? "",
        thought: selection?.options?.reasoningLevel ?? "",
        thoughtLevels: selection
          ? (record.app
              .listModels()
              .find(
                (model) =>
                  model.ref.providerId === selection.providerId &&
                  model.ref.modelId === selection.modelId,
              )
              ?.reasoning?.levels.map((level) => level.value) ?? [])
          : [],
        mode: record.app.getMode(),
        planEnabled: record.app.runtime.getPlanEnabled(),
        ...(record.app.runtime.lastPermissionGrantId
          ? { permissionGrant: { interactionId: record.app.runtime.lastPermissionGrantId } }
          : {}),
      };
    },
    getSessionUsageSeed: async (sessionId, persistedMessages) => {
      const record = context.sessions.get(sessionId);
      if (!record) return null;
      const contextUsage = await readSessionContextUsage(context, sessionId, persistedMessages);
      return sessionUsageSeedFromRuntimeContextUsage(
        contextUsage,
        resolveSessionModelContextWindow(context, record),
      );
    },
    getSessionWorkspaceId: (sessionId) => {
      const record = context.sessions.get(sessionId);
      return !record || !isTaskListSessionType(record.taskType)
        ? null
        : record.workspace.workspaceKey;
    },
    getSessionIndexMeta: (sessionId) => {
      const record = context.sessions.get(sessionId);
      if (!record) return null;
      return {
        createdAt: record.createdAt,
        lastActivityAt: record.updatedAt,
        ...(record.lastOutcome ? { lastOutcome: record.lastOutcome } : {}),
        ...(record.parentSessionId ? { parentSessionId: String(record.parentSessionId) } : {}),
      };
    },
    listWorkspaceSessionIds: (workspaceId) =>
      [...context.sessions.values()]
        .filter(
          (record) =>
            isTaskListSessionType(record.taskType) && record.workspace.workspaceKey === workspaceId,
        )
        .map((record) => record.app.sessionId),
    isDraftSession: (sessionId) => context.sessions.get(sessionId)?.persistence === "deferred",
    getWorkspaceConfig: (workspaceId) => buildLiveWorkspaceConfigStateV4(context, workspaceId),
    getStoredSessionSummaries: loadStoredSessionSummaries,
    refreshLegacySessionSummaries: (workspaceId, legacyTaskIds) =>
      parseRemoteWorkspaceIdentity(workspaceId)
        ? loadStoredSessionSummaries(workspaceId, legacyTaskIds)
        : null,
    // notImplemented → ACK failed fault.command.notImplemented。
    executeCommand: (envelope, admission) =>
      nativeExecutor.supports(envelope.type)
        ? nativeExecutor.execute(envelope, admission)
        : Promise.reject(new V4CommandNotImplementedError(envelope.type)),
    admitCommandInput: async (envelope, admission) => {
      if (
        envelope.sessionId &&
        (isConversationInputAdmissionCommand(envelope.type) ||
          envelope.type === "resumeGoal" ||
          envelope.type === "sendQueuedNow" ||
          envelope.type === "forkAssistant" ||
          envelope.type === "createSelectionSideSession")
      ) {
        const taskType =
          context.sessions.get(envelope.sessionId)?.taskType ??
          (await context.deps.sessionStore?.getSession(envelope.sessionId as SessionId))?.taskType;
        if (isReadonlyAgentSessionKind(taskType)) {
          throw Object.assign(new Error("Subagent sessions are read-only"), {
            reasonCode: "guard.subagentReadOnly",
          });
        }
      }
      if (!isConversationInputAdmissionCommand(envelope.type)) return null;
      if (!envelope.sessionId) return null;
      return (await coreHost.admitInputCommand?.(envelope, envelope.sessionId, admission)) ?? null;
    },
    cancelCommandInput: async (envelope, queueItemId, reason) => {
      if (!envelope.sessionId) return;
      await coreHost.cancelInputCommand?.(envelope.sessionId, queueItemId, reason);
    },
    terminateTurnForProjectionFault: (sessionId, reasonCode) => {
      const record = context.sessions.get(sessionId);
      const controller = record?.activeAbortController;
      if (!controller || controller.signal.aborted) return;
      controller.abort(createExternalTurnFaultError(reasonCode));
    },
    lookupTranscriptCommand: (key) =>
      key.sessionId === null
        ? lookupGlobalCreateSessionCommand(context.deps.sessionStore, key.commandId)
        : persistentCommands.lookup("transcript", key),
    lookupTimelineCommand: (key) => persistentCommands.lookup("timeline", key),
    lookupChildCommand: (key) => persistentCommands.lookup("child", key),
    lookupDiscardedCommand: (key) => persistentCommands.lookup("discarded", key),
    invalidatePersistentCommandFacts: (sessionId) => persistentCommands.invalidate(sessionId),
    putSessionAttachment: async (sessionId, input) => {
      const record = context.sessions.get(sessionId);
      if (!record) {
        throw new Error(`fault.attachment.sessionNotFound: ${sessionId}`);
      }
      return record.app.writePromptAttachment(input);
    },
    readBackgroundBashOutput: (sessionId, workId) =>
      readBackgroundBashOutputFromOwner(context, sessionId, workId),
    readSessionAttachment: async (sessionId, input) => {
      const record = context.sessions.get(sessionId);
      if (!record) {
        throw new Error(`fault.attachment.sessionNotFound: ${sessionId}`);
      }
      return record.app.readPromptAttachment(input);
    },
    statSessionAttachment: async (sessionId, input) => {
      const record = context.sessions.get(sessionId);
      if (!record) {
        throw new Error(`fault.attachment.sessionNotFound: ${sessionId}`);
      }
      if (!record.app.statPromptAttachment) {
        throw new Error("fault.attachment.statUnsupported");
      }
      return record.app.statPromptAttachment(input);
    },
    resolveSessionAttachmentPreviewSource: async (sessionId, input) => {
      const record = context.sessions.get(sessionId);
      if (!record) {
        throw new Error(`fault.attachment.sessionNotFound: ${sessionId}`);
      }
      return record.app.resolvePromptAttachmentPreviewSource(input);
    },
    getConversationFileChanges: async (sessionId, _targetRowId, messageIds, targetTurnId) => {
      const record = await resolveConversationBackingRecord(context, sessionId);
      if (!record) {
        throw new Error(`fault.fileChanges.sessionNotFound: ${sessionId}`);
      }
      return readConversationFileChanges(record, sessionId, messageIds, targetTurnId);
    },
    listDynamicWorkflowRunEvents: async (sessionId, input) => {
      const record = context.sessions.get(sessionId);
      if (!record) {
        throw new Error(`fault.workflowRunEvents.sessionNotFound: ${sessionId}`);
      }
      if (!record.app.listDynamicWorkflowRunEvents) {
        throw new V4CapabilityUnsupportedError("listDynamicWorkflowRunEvents", sessionId);
      }
      return record.app.listDynamicWorkflowRunEvents(input);
    },
    listDynamicWorkflowRuns: async (sessionId, input) => {
      const record = context.sessions.get(sessionId);
      if (!record) {
        throw new Error(`fault.workflowRuns.sessionNotFound: ${sessionId}`);
      }
      if (!record.app.listDynamicWorkflowRuns) {
        throw new V4CapabilityUnsupportedError("listDynamicWorkflowRuns", sessionId);
      }
      return record.app.listDynamicWorkflowRuns(input);
    },
    listDynamicWorkflowRunArtifacts: async (sessionId, input) => {
      const record = context.sessions.get(sessionId);
      if (!record) {
        throw new Error(`fault.workflowRunArtifacts.sessionNotFound: ${sessionId}`);
      }
      if (!record.app.listDynamicWorkflowRunArtifacts) {
        throw new V4CapabilityUnsupportedError("listDynamicWorkflowRunArtifacts", sessionId);
      }
      return record.app.listDynamicWorkflowRunArtifacts(input);
    },
    listDynamicWorkflowRunArtifactItems: async (sessionId, input) => {
      const record = context.sessions.get(sessionId);
      if (!record) {
        throw new Error(`fault.workflowRunArtifactData.sessionNotFound: ${sessionId}`);
      }
      if (!record.app.listDynamicWorkflowRunArtifactItems) {
        throw new V4CapabilityUnsupportedError("listDynamicWorkflowRunArtifactItems", sessionId);
      }
      return record.app.listDynamicWorkflowRunArtifactItems(input);
    },
    readDynamicWorkflowRunArtifact: async (sessionId, input) => {
      const record = context.sessions.get(sessionId);
      if (!record) {
        throw new Error(`fault.workflowRunArtifactRead.sessionNotFound: ${sessionId}`);
      }
      if (!record.app.readDynamicWorkflowRunArtifact) {
        throw new V4CapabilityUnsupportedError("readDynamicWorkflowRunArtifact", sessionId);
      }
      return record.app.readDynamicWorkflowRunArtifact(input);
    },
    listDynamicWorkflowRunWorkspaceNodes: async (sessionId, input) => {
      const record = context.sessions.get(sessionId);
      if (!record) {
        throw new Error(`fault.workflowRunWorkspace.sessionNotFound: ${sessionId}`);
      }
      if (!record.app.listDynamicWorkflowRunWorkspaceNodes) {
        throw new V4CapabilityUnsupportedError("listDynamicWorkflowRunWorkspaceNodes", sessionId);
      }
      return record.app.listDynamicWorkflowRunWorkspaceNodes(input);
    },
    readDynamicWorkflowRunNodeResult: async (sessionId, input) => {
      const record = context.sessions.get(sessionId);
      if (!record) {
        throw new Error(`fault.workflowRunNodeResult.sessionNotFound: ${sessionId}`);
      }
      if (!record.app.readDynamicWorkflowRunNodeResult) {
        throw new V4CapabilityUnsupportedError("readDynamicWorkflowRunNodeResult", sessionId);
      }
      return record.app.readDynamicWorkflowRunNodeResult(input);
    },
    previewConversationFileRewind: async (sessionId, _targetRowId, messageIds, targetTurnId) => {
      const record = context.sessions.get(sessionId);
      if (!record) {
        throw new Error(`fault.fileRewindPreview.sessionNotFound: ${sessionId}`);
      }
      return previewConversationFileRewind(record, messageIds, targetTurnId);
    },
    loadPersistedEvents: async (sessionId, persistedMessages) => {
      const record = await resolveConversationBackingRecord(context, sessionId);
      if (!record) {
        if (persistedMessages === undefined)
          return { events: [], synthesized: false, sourceEventSeq: 0 };
        const store = context.deps.sessionStore;
        if (!store) throw new Error("fault.subscribe.sessionNotFound");
        const source = await loadPersistedConversationMaterialization({
          sessionId,
          persistedMessages,
          memoryEvents: [],
          store,
        });
        const merged = mergeColdConversationEvents({ ...source, sessionId });
        return {
          events: merged.events,
          synthesized: true,
          sourceEventSeq: 0,
          ...(source.sharedContextImport
            ? { sharedContextImport: source.sharedContextImport }
            : {}),
        };
      }
      const [liveEvents, sourceEventSeq] = await Promise.all([
        record.eventStore.getEvents(sessionId as SessionId),
        record.eventStore.getLatestSequenceNumber(sessionId as SessionId),
      ]);
      const replayed = await replayDynamicWorkflowRunEvents(context, sessionId, record, liveEvents);
      const events = replayed.length === 0 ? liveEvents : [...replayed, ...liveEvents];
      const store = context.deps.sessionStore;
      const source = await loadPersistedConversationMaterialization({
        memoryEvents: events,
        persistedMessages,
        sessionId,
        ...(store
          ? {
              store: {
                getSession: (id) => store.getSession(id),
                messages: (input) => store.messages(input),
                readTarget: (input) => store.readTarget(input),
                ...(store.sessionEntries
                  ? {
                      sessionEntries: (input) =>
                        store.sessionEntries!(input).catch((error) => {
                          context.logger?.warn("v4 hydrate session entries read failed", {
                            error: error instanceof Error ? error.message : String(error),
                            event: "cf_protocol.v4.hydrate_session_entries_failed",
                            module: "bootstrap.cf_protocol",
                          });
                          return [];
                        }),
                    }
                  : {}),
              },
            }
          : {}),
      });
      const fileChangeSummariesByMessageId = await buildColdFileChangeSummaries({
        events: source.memoryEvents,
        messageIds: source.messages.map((message) => String(message.info.id)),
        readArtifact: async (snapshotRef) =>
          (await record.app.readToolResultArtifact(snapshotRef)).content,
        onArtifactError: (messageId, error) =>
          context.logger?.warn("v4 cold file change artifact read failed", {
            error: error instanceof Error ? error.message : String(error),
            event: "cf_protocol.v4.hydrate_file_changes_failed",
            messageId,
            module: "bootstrap.cf_protocol",
            sessionId,
          }),
      });
      const contextWindow = resolveSessionModelContextWindow(context, record);
      const usageSeed = sessionUsageSeedFromRuntimeContextUsage(
        await readSessionContextUsage(context, sessionId, source.messages),
        contextWindow,
      );
      const merged = mergeColdConversationEvents({
        contextWindow,
        fileChangeSummariesByMessageId,
        memoryEvents: source.memoryEvents,
        messages: source.messages,
        sessionId,
        goalVerificationEntries: source.goalVerificationEntries,
        ...(Object.prototype.hasOwnProperty.call(source, "target")
          ? { target: source.target }
          : {}),
      });
      for (const diagnostic of merged.diagnostics) {
        const fields = {
          ...diagnostic,
          event: "cf_protocol.v4.hydrate_three_source_merge",
          module: "bootstrap.cf_protocol",
          sessionId,
        };
        if (
          diagnostic.code === "cold_merge.ambiguous_legacy_turn_preserved" ||
          diagnostic.code === "cold_merge.memory_boundary_preserved" ||
          diagnostic.code === "cold_merge.unclassified_event_preserved"
        ) {
          context.logger?.warn("v4 hydrate preserved ambiguous cold fact", fields);
        } else {
          log?.debug("v4 hydrate merged duplicate cold facts", fields);
        }
      }
      const subagents = await listSessionSubagents(
        context,
        { sessionId, endedLimit: 1 },
        persistedMessages,
      );
      return {
        events: merged.events,
        usageSeed,
        synthesized: merged.usedDurableTranscript,
        subagentsSeed: {
          revision: subagents.revision,
          childSessionIds: subagents.childSessionIds,
          running: subagents.running,
        },
        ...(source.sharedContextImport ? { sharedContextImport: source.sharedContextImport } : {}),
        sourceEventSeq,
      };
    },
    onError: (scope, error, errorContext) =>
      context.logger?.warn("CodeFusion Protocol v4 gateway error", {
        ...errorContext,
        error: error instanceof Error ? error.message : String(error),
        event: "cf_protocol.v4.gateway_error",
        module: "bootstrap.cf_protocol",
        scope,
      }),
  });
}
