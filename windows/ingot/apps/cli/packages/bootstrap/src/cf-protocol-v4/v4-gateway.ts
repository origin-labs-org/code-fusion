import {
  pluginUiToolResultNotificationSchema,
  type PluginUiToolResultNotification,
} from "@origin-ai/cf-shared/mcp-apps";
import { randomUUID } from "node:crypto";
import { LocalTtftRecorder } from "./local-ttft.js";
import { localTtftNow, localTtftFactsSchema } from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  backgroundBashOutputResultSchema,
  v4BackgroundBashOutputParamsSchema,
  type BackgroundBashOutputResult,
} from "@origin-ai/cf-shared/cf-protocol-v4";
//
import type {
  DynamicWorkflowRunArtifact,
  DynamicWorkflowRunArtifactBytes,
  DynamicWorkflowRunArtifactItemsResult,
  DynamicWorkflowRunWorkspaceNode,
  DynamicWorkflowRunWorkspaceNodeResult,
  DynamicWorkflowRunEventsResult,
  DynamicWorkflowRunSessionSummary,
  MessageWithParts,
  SessionEvent,
  TargetChangedPayload,
  TurnId,
  FileSystemErrorCode,
} from "@origin-ai/cf-contracts";
import type { ConversationSnapshot } from "@origin-ai/cf-shared/cf-protocol-v4";
import { SessionEventType, isFileSystemPortError } from "@origin-ai/cf-contracts";
import type { CfWorkspaceRef } from "@origin-ai/cf-shared";
import { extractMarkdownArtifactImageRefs } from "@origin-ai/cf-shared";
import type {
  CommandAck,
  AttachmentRef,
  CommandEnvelope,
  CommandKey,
  CommandResult,
  ConversationRowTarget,
  CommandsQueryResult,
  ConversationInputIntent,
  ConversationTopicFrame,
  QueueItem,
  RoutedTopicFrame,
  RoutedTopicWireFrame,
  SessionSummary,
  SessionsIndexReconcileParams,
  SessionsIndexReconcileResult,
  SessionsIndexTopicFrame,
  SubscribeAck,
  V4AttachmentBeginResult,
  V4AttachmentChunkResult,
  V4AttachmentCommitResult,
  V4AttachmentPreviewSourceResult,
  V4AttachmentReadResult,
  V4ConversationAttachmentReadResult,
  V4ConversationAttachmentStatResult,
  V4ConversationFileChangesResult,
  V4ConversationFileRewindPreviewResult,
  V4ConversationPlansResult,
  V4ConversationWorkflowRunArtifactDataResult,
  V4ConversationWorkflowRunArtifactReadResult,
  V4ConversationWorkflowRunArtifactsResult,
  V4ConversationWorkflowRunNodeResultResult,
  V4ConversationWorkflowRunWorkspaceResult,
  V4ConversationWorkflowRunEventsResult,
  V4ConversationWorkflowRunsResult,
  V4ConversationRowsRangeResult,
  WorkspaceConfigState,
  WorkspaceConfigTopicFrame,
  ConversationTelemetryFact,
  CuaPermissionObservation,
  ConversationOpenTiming,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  DELIVERY_PROFILES,
  PROTOCOL_V4_LIMITS,
  CF_ATTACHMENT_FAULT_CODES,
  CfAttachmentFaultError,
  readCfAttachmentFaultCode,
  encodeTopicWireFrames,
  commandsQueryParamsSchema,
  commandsQueryResultSchema,
  parseCommandEnvelope,
  measureTopicNotificationEnvelopeBytes,
  parseConversationTopic,
  parseSessionsIndexTopic,
  sessionsIndexReconcileParamsSchema,
  sessionsIndexReconcileResultSchema,
  parseWorkspaceConfigTopic,
  v4AttachmentAbortParamsSchema,
  v4AttachmentBeginParamsSchema,
  v4AttachmentChunkParamsSchema,
  v4AttachmentCommitParamsSchema,
  v4AttachmentPreviewSourceParamsSchema,
  v4AttachmentPreviewSourceResultSchema,
  v4AttachmentReadParamsSchema,
  v4ConversationAttachmentReadParamsSchema,
  v4ConversationAttachmentReadResultSchema,
  v4ConversationAttachmentStatParamsSchema,
  v4ConversationAttachmentStatResultSchema,
  v4ConnectionFlowParamsSchema,
  v4ConversationFileChangesParamsSchema,
  v4ConversationFileRewindPreviewParamsSchema,
  v4ConversationPlansParamsSchema,
  WORKFLOW_ARTIFACT_LIMITS,
  v4ConversationWorkflowRunArtifactDataParamsSchema,
  v4ConversationWorkflowRunArtifactDataResultSchema,
  v4ConversationWorkflowRunArtifactReadParamsSchema,
  v4ConversationWorkflowRunArtifactReadResultSchema,
  v4ConversationWorkflowRunArtifactsParamsSchema,
  v4ConversationWorkflowRunArtifactsResultSchema,
  v4ConversationWorkflowRunNodeResultParamsSchema,
  v4ConversationWorkflowRunNodeResultResultSchema,
  v4ConversationWorkflowRunWorkspaceParamsSchema,
  v4ConversationWorkflowRunWorkspaceResultSchema,
  WORKFLOW_WORKSPACE_LIMITS,
  WORKFLOW_RUN_EVENTS_PAGE_LIMITS,
  v4ConversationWorkflowRunEventsParamsSchema,
  v4ConversationWorkflowRunEventsResultSchema,
  v4ConversationWorkflowRunsParamsSchema,
  v4ConversationWorkflowRunsResultSchema,
  v4ConversationRowsRangeParamsSchema,
  v4ConversationResyncParamsSchema,
  v4ConversationSubscribeParamsSchema,
  v4ConversationUnsubscribeParamsSchema,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { AttachmentUploadRegistry } from "./attachment-upload-registry.js";
import {
  ColdSessionResumeCoordinator,
  V4SubscribeSessionUnavailableError,
  type ColdSessionResumeOutcome,
} from "./cold-session-resume.js";
import { CommandInbox } from "./command-inbox.js";
import {
  ConversationTopicPublisher,
  ProjectionPayloadTooLargeError,
} from "./conversation-topic-publisher.js";
import type {
  SessionConfigSeed,
  SessionSubagentsSeed,
  SessionUsageSeed,
} from "./product-projection.js";
import type { ConversationRowTargetAction } from "./product-projection.js";
import { SessionsIndexFanoutThrottle } from "./sessions-index-fanout-throttle.js";
import { SessionsIndexPublisher } from "./sessions-index-publisher.js";
import { SessionsIndexPublisherRegistry } from "./sessions-index-publisher-registry.js";
import { WorkspaceConfigPublisher } from "./workspace-config-publisher.js";
import type { TopicFrameReservation } from "./topic-frame-reservation.js";
import { ConversationTelemetryFactNormalizer } from "./conversation-telemetry-facts.js";
import { CuaPermissionObservationNormalizer } from "./cua-permission-observation.js";
import { V4CapabilityUnsupportedError } from "./commands/handlers/interaction-background.js";

function toRuntimeTurnId(turnId: string | null): TurnId | null {
  return turnId as TurnId | null;
}

function rowTargetActionForCommand(
  type: CommandEnvelope["type"],
): ConversationRowTargetAction | null {
  switch (type) {
    case "forkAssistant":
    case "editUserQuery":
    case "retryTurn":
    case "applyFileRewind":
    case "setAssistantFeedback":
    case "setHighspeedMetrics":
      return type;
    default:
      return null;
  }
}

interface PersistedEventsLoadResult {
  events: SessionEvent[];
  synthesized: boolean;
  
  subagentsSeed?: SessionSubagentsSeed;
  
  sharedContextImport?: ConversationSnapshot["sharedContextImport"];
  
  sourceEventSeq?: number;
  
  usageSeed?: SessionUsageSeed | null;
}

export type V4GatewayErrorContext = Record<string, unknown>;

interface BinaryReadCacheEntry {
  sessionId: string;
  accessedAt: number;
  bytes: number | null;
  payload: Promise<{ bytes: Uint8Array; mediaType: string }>;
}

export interface V4GatewayHost {
  cliVersion?: string;
  
  sessionExists(sessionId: string): boolean;
  
  loadPersistedMessages?(sessionId: string): Promise<MessageWithParts[]>;
  retainSessionRuntime?(sessionId: string): Promise<() => void>;
  resumePersistedSession?(
    sessionId: string,
    resumeThoughtLevel?: string,
    workspace?: CfWorkspaceRef,
    additionalDirectories?: string[],
    persistedMessages?: MessageWithParts[],
  ): Promise<ColdSessionResumeOutcome>;
  
  emitWireFrame(frame: RoutedTopicWireFrame): void;
  
  emitConversationTelemetryFact?(fact: ConversationTelemetryFact): void;
  emitLocalTtftFacts?(facts: import("@origin-ai/cf-shared").LocalTtftFacts): void;
  
  emitCuaPermissionObservation?(observation: CuaPermissionObservation): void;
  
  emitPluginUiToolResult?(result: PluginUiToolResultNotification): void;
  
  getSessionWorkspaceId?(sessionId: string): string | null;
  
  getSessionIndexMeta?(sessionId: string): {
    createdAt: number;
    lastActivityAt: number;
    lastOutcome?: SessionSummary["lastOutcome"];
    parentSessionId?: string;
  } | null;
  
  getSessionConfigSeed?(sessionId: string): SessionConfigSeed | null;
  
  getSessionMemoryEnabled?(sessionId: string): boolean | undefined;
  
  getSessionUsageSeed?(
    sessionId: string,
    persistedMessages?: MessageWithParts[],
  ): Promise<SessionUsageSeed | null> | SessionUsageSeed | null;
  
  listWorkspaceSessionIds?(workspaceId: string): string[];
  
  isDraftSession?(sessionId: string): boolean;
  
  getStoredSessionSummaries?(workspaceId: string): Promise<SessionSummary[]> | SessionSummary[];
  reconcileSessions?(params: SessionsIndexReconcileParams): Promise<SessionsIndexReconcileResult>;
  
  refreshLegacySessionSummaries?(
    workspaceId: string,
    legacyTaskIds: readonly string[],
  ): Promise<SessionSummary[] | null> | SessionSummary[] | null;
  
  getWorkspaceConfig?(
    workspaceId: string,
  ): Promise<WorkspaceConfigState | null> | WorkspaceConfigState | null;
  readBackgroundBashOutput?(sessionId: string, workId: string): Promise<BackgroundBashOutputResult>;
  
  executeCommand(
    envelope: CommandEnvelope,
    admission?: { admissionSeq: number; admittedAt: number; queueItemId: string },
  ): Promise<CommandResult | undefined>;
  
  admitCommandInput?(
    envelope: CommandEnvelope,
    admission: { admissionSeq: number; admittedAt: number; queueItemId: string },
  ): Promise<ConversationInputIntent | null>;
  cancelCommandInput?(
    envelope: CommandEnvelope,
    queueItemId: string,
    reason: string,
  ): Promise<void>;
  
  terminateTurnForProjectionFault?(
    sessionId: string,
    reasonCode: "proto.payloadTooLarge",
  ): Promise<void> | void;
  
  lookupTranscriptCommand?(key: CommandKey): Promise<CommandAck | null> | CommandAck | null;
  lookupTimelineCommand?(key: CommandKey): Promise<CommandAck | null> | CommandAck | null;
  lookupChildCommand?(key: CommandKey): Promise<CommandAck | null> | CommandAck | null;
  lookupDiscardedCommand?(key: CommandKey): Promise<CommandAck | null> | CommandAck | null;
  
  invalidatePersistentCommandFacts?(sessionId: string): void;
  
  onTargetCompleted?(sessionId: string, event: SessionEvent): void;
  
  onHighspeedTurnTerminal?(
    sessionId: string,
    event: SessionEvent,
    snapshot: ConversationSnapshot,
  ): void;
  
  putSessionAttachment?(
    sessionId: string,
    input: { fileName: string; mime: string; bytes: Uint8Array },
  ): Promise<{ ref: string }>;
  
  readSessionAttachment?(
    sessionId: string,
    input: {
      ref: string;
      mime: string;
      maxBytes: number;
      messageId?: string;
      attachmentIndex?: number;
    },
  ): Promise<{ bytes: Uint8Array; mediaType: string }>;
  
  statSessionAttachment?(
    sessionId: string,
    input: {
      ref: string;
      mime: string;
      messageId?: string;
      attachmentIndex?: number;
    },
  ): Promise<{ totalBytes: number; mediaType: string; mtimeMs?: number }>;
  
  resolveSessionAttachmentPreviewSource?(
    sessionId: string,
    input: {
      ref: string;
      mime: string;
      messageId?: string;
      attachmentIndex?: number;
    },
  ): Promise<V4AttachmentPreviewSourceResult>;
  getConversationFileChanges?(
    sessionId: string,
    targetRowId: number,
    messageIds: string[],
    targetTurnId: TurnId | null,
  ): Promise<V4ConversationFileChangesResult>;
  previewConversationFileRewind?(
    sessionId: string,
    targetRowId: number,
    messageIds: string[],
    targetTurnId: TurnId | null,
  ): Promise<V4ConversationFileRewindPreviewResult>;
  
  listDynamicWorkflowRunEvents?(
    sessionId: string,
    input: { runId: string; afterSequence?: number; limit?: number; maxBytes?: number },
  ): Promise<DynamicWorkflowRunEventsResult>;
  
  listDynamicWorkflowRuns?(
    sessionId: string,
    input: { limit?: number },
  ): Promise<DynamicWorkflowRunSessionSummary[]>;
  
  listDynamicWorkflowRunArtifacts?(
    sessionId: string,
    input: { runId: string },
  ): Promise<readonly DynamicWorkflowRunArtifact[] | undefined>;
  listDynamicWorkflowRunArtifactItems?(
    sessionId: string,
    input: {
      runId: string;
      artifactId: string;
      afterSequence?: number;
      limit: number;
      maxBytes: number;
      fields?: readonly string[];
    },
  ): Promise<DynamicWorkflowRunArtifactItemsResult>;
  readDynamicWorkflowRunArtifact?(
    sessionId: string,
    input: { runId: string; artifactId: string; version: number },
  ): Promise<DynamicWorkflowRunArtifactBytes | undefined>;
  
  listDynamicWorkflowRunWorkspaceNodes?(
    sessionId: string,
    input: { runId: string },
  ): Promise<readonly DynamicWorkflowRunWorkspaceNode[] | undefined>;
  readDynamicWorkflowRunNodeResult?(
    sessionId: string,
    input: { runId: string; siteId: string; ordinal: number; maxBytes: number },
  ): Promise<DynamicWorkflowRunWorkspaceNodeResult | undefined>;
  
  loadPersistedEvents?(
    sessionId: string,
    persistedMessages?: MessageWithParts[],
  ): Promise<PersistedEventsLoadResult>;
  
  onDebug?(message: string): void;
  onError?(scope: string, error: unknown, context?: V4GatewayErrorContext): void;
}

export interface ConversationV4GatewayOptions {
  now?: () => number;
  
  createLogEpoch?: (sessionId: string) => string;
}

interface FlushState {
  sessionId: string;
  topic: string;
  subscriptionId: string;
  connectionId: string;
  deliveryProfile: "continuous" | "replayable";
  flushWindowMs: number;
  timer: ReturnType<typeof setTimeout> | null;
}

interface HydrationBuffer {
  cancelled: boolean;
  eventIds: Set<string>;
  rawEvents: SessionEvent[];
}

interface RawSequenceState {
  
  sourceEventSeq: number;
  
  offset: number;
  lastTransportSeq: number;
  seenEventIds: Set<string>;
  
  appliedEventIds: Set<string>;
  
  failedEventById: Map<string, Error>;
  
  pendingByRawSeq: Map<number, SessionEvent>;
  
  recentRawEventsById: Map<string, SessionEvent>;
}

interface ProjectionEventCommitWaiter {
  resolve(): void;
  reject(error: Error): void;
}

const PROJECTION_EVENT_COMMIT_TIMEOUT_MS = 25_000;
const MAX_TELEMETRY_EVENT_IDS = 2_000;

export const DETACHED_CHILD_PUBLISHER_GRACE_MS = 120_000;

class ProjectionEventCommitWaitError extends Error {
  constructor(
    readonly reasonCode:
      | "fault.projectionEventCommit.aborted"
      | "fault.projectionEventCommit.applyFailed"
      | "fault.projectionEventCommit.disposed"
      | "fault.projectionEventCommit.gatewayDisposed"
      | "fault.projectionEventCommit.rehydrated"
      | "fault.projectionEventCommit.timeout",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProjectionEventCommitWaitError";
  }
}

export interface V4SubscribeDispatchResult<TFrame> {
  ack: SubscribeAck & { openTiming?: ConversationOpenTiming };
  initialFrame: TFrame | null;
  initialWires: RoutedTopicWireFrame[];
  commit(): boolean;
}

export function encodeReservedTopicFrame(
  reservation: TopicFrameReservation<RoutedTopicFrame>,
): RoutedTopicWireFrame[] {
  return encodeTopicWireFrames(reservation.frame, {
    deliveryKind: reservation.deliveryKind,
    topic: reservation.frame.topic,
    subscriptionId: reservation.frame.subscriptionId,
    logicalFrameId: reservation.logicalFrameId,
    logicalFrameOrdinal: reservation.logicalFrameOrdinal,
    measurePhysicalFrameBytes: (wire) => measureTopicNotificationEnvelopeBytes(wire).maxBytes,
  }) as RoutedTopicWireFrame[];
}

export function emitReservedTopicFrame<F extends RoutedTopicFrame>(
  reservation: TopicFrameReservation<F>,
  emit: (wire: RoutedTopicWireFrame) => unknown,
): boolean {
  const wires = encodeReservedTopicFrame(reservation as TopicFrameReservation<RoutedTopicFrame>);
  for (const wire of wires) emit(wire);
  return reservation.commit();
}

function subscriptionRouteKey(topic: string, subscriptionId: string, connectionId: string): string {
  return `${topic}\0${subscriptionId}\0${connectionId}`;
}

function defaultLogEpoch(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function artifactRefBelongsToSession(ref: string, sessionId: string): boolean {
  return ref.startsWith(`cf-artifact://${encodeURIComponent(sessionId)}/`);
}

const MISSING_ATTACHMENT_FS_CODES = new Set<FileSystemErrorCode>([
  "not_found",
  "is_directory",
  "not_file",
]);

function toShareStatFault(error: unknown): unknown {
  if (readCfAttachmentFaultCode(error)) return error;
  if (isFileSystemPortError(error) && MISSING_ATTACHMENT_FS_CODES.has(error.code)) {
    return new CfAttachmentFaultError(CF_ATTACHMENT_FAULT_CODES.shareStatNotFound, {
      cause: error,
    });
  }
  return error;
}

export class ConversationV4Gateway {
  private readonly publishers = new Map<string, ConversationTopicPublisher>();
  
  private readonly indexPublishers = new SessionsIndexPublisherRegistry();
  
  private readonly configPublishers = new Map<string, WorkspaceConfigPublisher>();
  
  private readonly hydratedSessions = new Set<string>();
  
  private readonly hydrationInFlight = new Map<string, Promise<ConversationTopicPublisher>>();
  
  private readonly historyOpenings = new Map<
    string,
    {
      history: Promise<ConversationTopicPublisher>;
      start: () => void;
      cancel: () => void;
    }
  >();
  private readonly readyFlights = new Map<string, Promise<ConversationTopicPublisher>>();
  
  private readonly hydrationBuffers = new Map<string, HydrationBuffer>();
  
  private readonly rawSequenceStates = new Map<string, RawSequenceState>();
  
  private readonly projectionEventCommitWaiters = new Map<
    string,
    Map<string, Set<ProjectionEventCommitWaiter>>
  >();
  
  private readonly detachedLiveSessions = new Set<string>();
  
  private readonly detachedChildParent = new Map<string, string>();
  private readonly detachedChildrenByParent = new Map<string, Set<string>>();
  private readonly detachedTerminalAt = new Map<string, number>();
  
  private readonly coldResume: ColdSessionResumeCoordinator;
  
  private readonly flushStates = new Map<string, FlushState>();
  
  private readonly controlReservations = new WeakSet<object>();
  
  private readonly pausedConnections = new Set<string>();
  
  private readonly projectionFaultedSessions = new Set<string>();
  private readonly inbox: CommandInbox;
  private readonly attachmentUploads: AttachmentUploadRegistry;
  private readonly binaryReadCache = new Map<string, BinaryReadCacheEntry>();
  private binaryReadCacheBytes = 0;
  private readonly localTtft = new LocalTtftRecorder(
    localTtftNow,
    () => {
      this.host.onError?.(
        "v4.localTtft.completedCapacity",
        new Error("TTFT completed record capacity exceeded"),
      );
    },
    (facts) => {
      const parsed = localTtftFactsSchema.safeParse(facts);
      if (parsed.success) this.host.emitLocalTtftFacts?.(parsed.data);
    },
  );
  
  private readonly indexFanoutThrottle = new SessionsIndexFanoutThrottle({
    publish: (sessionId) => this.publishCurrentSummaryToIndex(sessionId),
  });
  private readonly attachmentPruneTimer: ReturnType<typeof setInterval>;
  private readonly now: () => number;
  private readonly createLogEpoch: (sessionId: string) => string;
  private readonly telemetryNormalizer = new ConversationTelemetryFactNormalizer();
  private readonly cuaPermissionNormalizer = new CuaPermissionObservationNormalizer();
  private readonly telemetryEventIds = new Set<string>();
  private disposed = false;

  
  updateSharedContextImport(
    sessionId: string,
    source: ConversationSnapshot["sharedContextImport"],
  ): void {
    const publisher = this.publishers.get(sessionId);
    if (!publisher) return;
    publisher.seedSharedContextImport(source);
    for (const [routeKey, state] of this.flushStates) {
      if (state.sessionId === sessionId) this.scheduleFlush(routeKey, state, publisher);
    }
  }

  constructor(
    private readonly host: V4GatewayHost,
    options: ConversationV4GatewayOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.createLogEpoch = options.createLogEpoch ?? defaultLogEpoch;
    this.coldResume = new ColdSessionResumeCoordinator(host);
    this.inbox = new CommandInbox({
      prepareDecision: async (envelope) => {
        if (
          envelope.sessionId &&
          (envelope.type === "renameSession" || envelope.type === "deleteSession") &&
          !this.host.sessionExists(envelope.sessionId)
        ) {
          await this.ensureColdReadyPublisher(envelope.sessionId);
        }
      },
      getRevision: (sessionId) => {
        if (
          !this.host.sessionExists(sessionId) &&
          !this.publishers.get(sessionId)?.getSnapshot().runtimeInitialization
        )
          return null;
        return this.publishers.get(sessionId)?.getSnapshot().revision ?? 0;
      },
      getLogEpoch: (sessionId) => this.publishers.get(sessionId)?.getSnapshot().logEpoch ?? null,
      validateRowTarget: (envelope) => {
        const action = rowTargetActionForCommand(envelope.type);
        if (!action || envelope.sessionId === null) return { verdict: "allow" };
        const target = (envelope.payload as { target?: ConversationRowTarget }).target;
        if (!target) return { verdict: "reject", reasonCode: "proto.invalidPayload" };
        const resolution = this.publishers
          .get(envelope.sessionId)
          ?.resolveRowActionTarget(target, action);
        if (!resolution) return { verdict: "stale", reasonCode: "proto.staleTarget" };
        if (resolution.ok) return { verdict: "allow" };
        return resolution.status === "stale"
          ? { verdict: "stale", reasonCode: resolution.reasonCode }
          : { verdict: "reject", reasonCode: resolution.reasonCode };
      },
      guard: (envelope) => {
        const initialization =
          envelope.sessionId === null
            ? undefined
            : this.publishers.get(envelope.sessionId)?.getSnapshot().runtimeInitialization;
        return initialization && initialization.status !== "ready"
          ? {
              verdict: "reject",
              reasonCode:
                initialization.status === "failed"
                  ? "guard.runtimeInitializationFailed"
                  : "guard.runtimeInitializing",
            }
          : { verdict: "allow" };
      },
      lookupTranscriptCommand: (key) => this.host.lookupTranscriptCommand?.(key) ?? null,
      lookupTimelineCommand: (key) => this.host.lookupTimelineCommand?.(key) ?? null,
      lookupChildCommand: (key) => this.host.lookupChildCommand?.(key) ?? null,
      lookupDiscardedCommand: (key) => this.host.lookupDiscardedCommand?.(key) ?? null,
      now: this.now,
    });
    this.attachmentUploads = new AttachmentUploadRegistry({
      now: this.now,
      putSessionAttachment: async (sessionId, input) => {
        if (!this.host.putSessionAttachment) {
          throw new Error("fault.attachment.putUnsupported");
        }
        return this.host.putSessionAttachment(sessionId, input);
      },
    });
    this.attachmentPruneTimer = setInterval(
      () => this.attachmentUploads.pruneExpired(),
      Math.min(30_000, PROTOCOL_V4_LIMITS.attachmentUploadTtlMs),
    );
    (
      this.attachmentPruneTimer as ReturnType<typeof setInterval> & { unref?: () => void }
    ).unref?.();
  }

  setConnectionFlowState(rawParams: unknown): void {
    const params = v4ConnectionFlowParamsSchema.parse(rawParams);
    if (params.state === "closed") {
      this.pausedConnections.delete(params.connectionId);
      this.clearConnectionFlushTimers(params.connectionId);
      this.attachmentUploads.clearConnection(params.connectionId);
      return;
    }
    if (params.state === "saturated") {
      if (this.pausedConnections.has(params.connectionId)) return;
      this.pausedConnections.add(params.connectionId);
      this.clearConnectionFlushTimers(params.connectionId);
      return;
    }
    if (!this.pausedConnections.delete(params.connectionId)) return;
    this.flushConnection(params.connectionId);
  }

  private clearConnectionFlushTimers(connectionId: string): void {
    for (const state of this.flushStates.values()) {
      if (state.connectionId !== connectionId || state.timer === null) continue;
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  private flushConnection(connectionId: string): void {
    for (const [routeKey, state] of this.flushStates) {
      if (state.connectionId !== connectionId) continue;
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
      const publisher = this.publishers.get(state.sessionId);
      if (!publisher?.hasSubscription(state.subscriptionId, connectionId)) {
        this.flushStates.delete(routeKey);
        continue;
      }
      const reservation = publisher.reserveFlush(state.subscriptionId);
      if (!reservation) continue;
      try {
        this.emitReservation(reservation);
      } catch (error) {
        this.host.onError?.("v4.frame.emit", error);
      }
    }
    for (const workspaceId of this.indexPublishers.keys()) {
      this.flushIndex(workspaceId, connectionId);
    }
    for (const workspaceId of this.configPublishers.keys()) {
      this.flushConfig(workspaceId, connectionId);
    }
  }

  
  ingest(sessionId: string, event: SessionEvent): void {
    if (this.disposed) return;
    const hydrationBuffer = this.hydrationBuffers.get(sessionId);
    if (hydrationBuffer) {
      const eventId = String(event.id);
      if (hydrationBuffer.eventIds.has(eventId)) return;
      hydrationBuffer.eventIds.add(eventId);
      hydrationBuffer.rawEvents.push(event);
    }
    this.emitLiveTelemetryFact(sessionId, event);
    for (const normalizedEvent of this.normalizeRuntimeEventSequence(sessionId, event)) {
      try {
        this.localTtft.event(sessionId, normalizedEvent);
      } catch (error) {
        try {
          this.host.onError?.("v4.localTtft.observe", error);
        } catch {
          
        }
      }
      this.ingestNormalizedEvent(sessionId, normalizedEvent);
    }
  }

  private emitLiveTelemetryFact(sessionId: string, event: SessionEvent): void {
    const eventId = String(event.id);
    const telemetryEventKey = `${sessionId}\0${eventId}`;
    if (this.telemetryEventIds.has(telemetryEventKey)) return;
    this.telemetryEventIds.add(telemetryEventKey);
    if (this.telemetryEventIds.size > MAX_TELEMETRY_EVENT_IDS) {
      const oldest = this.telemetryEventIds.values().next().value;
      if (typeof oldest === "string") this.telemetryEventIds.delete(oldest);
    }
    try {
      const config =
        this.publishers.get(sessionId)?.getSnapshot().config ??
        this.host.getSessionConfigSeed?.(sessionId) ??
        undefined;
      const fact = this.telemetryNormalizer.normalize(sessionId, event, {
        memoryEnabled: this.host.getSessionMemoryEnabled?.(sessionId),
        modelName: config?.model,
        modelProvider: config?.provider,
      });
      if (fact) {
        this.host.emitConversationTelemetryFact?.(fact);
      }
    } catch (error) {
      this.host.onError?.("v4.telemetry.normalize", error);
    }
    try {
      const observation = this.cuaPermissionNormalizer.normalize(sessionId, event);
      if (observation) this.host.emitCuaPermissionObservation?.(observation);
    } catch (error) {
      this.host.onError?.("v4.cuaPermissionObservation.normalize", error);
    }
  }

  
  waitForProjectionEventCommit(
    sessionId: string,
    eventId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    if (this.disposed) {
      return Promise.reject(
        new ProjectionEventCommitWaitError(
          "fault.projectionEventCommit.gatewayDisposed",
          "conversation gateway is disposed",
        ),
      );
    }
    const state = this.getOrCreateRawSequenceState(sessionId);
    if (state.appliedEventIds.has(eventId)) return Promise.resolve();
    const failed = state.failedEventById.get(eventId);
    if (failed) return Promise.reject(failed);
    if (options.signal?.aborted) {
      return Promise.reject(
        new ProjectionEventCommitWaitError(
          "fault.projectionEventCommit.aborted",
          `projection event commit wait aborted: ${eventId}`,
          { cause: options.signal.reason },
        ),
      );
    }
    return new Promise<void>((resolve, reject) => {
      const byEvent = this.projectionEventCommitWaiters.get(sessionId) ?? new Map();
      this.projectionEventCommitWaiters.set(sessionId, byEvent);
      const waiters = byEvent.get(eventId) ?? new Set();
      byEvent.set(eventId, waiters);
      let settled = false;
      const cleanup = () => {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", onAbort);
        waiters.delete(waiter);
        if (waiters.size === 0) byEvent.delete(eventId);
        if (byEvent.size === 0) this.projectionEventCommitWaiters.delete(sessionId);
      };
      const waiter: ProjectionEventCommitWaiter = {
        resolve: () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        },
        reject: (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        },
      };
      const onAbort = () => {
        this.rejectProjectionEventCommit(
          sessionId,
          eventId,
          new ProjectionEventCommitWaitError(
            "fault.projectionEventCommit.aborted",
            `projection event commit wait aborted: ${eventId}`,
            { cause: options.signal?.reason },
          ),
        );
      };
      const timeout = setTimeout(() => {
        this.rejectProjectionEventCommit(
          sessionId,
          eventId,
          new ProjectionEventCommitWaitError(
            "fault.projectionEventCommit.timeout",
            `projection event commit wait timed out: ${eventId}`,
          ),
        );
      }, PROJECTION_EVENT_COMMIT_TIMEOUT_MS);
      timeout.unref?.();
      waiters.add(waiter);
      options.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  
  async waitForPermissionGrantCommit(sessionId: string, eventId: string): Promise<void> {
    const state = this.getOrCreateRawSequenceState(sessionId);
    if (state.failedEventById.has(eventId)) {
      const event = state.recentRawEventsById.get(eventId);
      if (
        event?.type !== SessionEventType.SessionModeChanged ||
        !(event.payload as { permissionGrant?: unknown }).permissionGrant
      ) {
        throw new Error("Permission grant event unavailable for recovery");
      }
      await this.hydrationInFlight.get(sessionId);
      this.hydratedSessions.delete(sessionId);
      await this.hydratePublisher(sessionId, undefined, true);
    }
    await this.waitForProjectionEventCommit(sessionId, eventId);
  }

  private ingestNormalizedEvent(sessionId: string, event: SessionEvent): void {
    const publisher = this.ensurePublisher(sessionId);
    const promotedQueueRemoval =
      event.type === SessionEventType.TurnSteerDiscarded &&
      (event.payload as { reason?: string }).reason === "promoted";
    const removedQueueItems =
      event.type === SessionEventType.TurnSteerDrained ||
      event.type === SessionEventType.TurnSteerDiscarded
        ? ((event.payload as { pendingInputIds?: string[] }).pendingInputIds ?? []).flatMap(
            (queueItemId) => {
              const item = publisher
                .getSnapshot()
                .queue.items.find((candidate) => candidate.queueItemId === queueItemId);
              return item ? [item] : [];
            },
          )
        : [];
    try {
      publisher.ingest(event);
    } catch (error) {
      const commitError =
        error instanceof ProjectionEventCommitWaitError
          ? error
          : new ProjectionEventCommitWaitError(
              "fault.projectionEventCommit.applyFailed",
              `projection failed to apply event ${String(event.id)}`,
              { cause: error },
            );
      this.rejectProjectionEventCommit(sessionId, String(event.id), commitError);
      if (!(error instanceof ProjectionPayloadTooLargeError)) throw error;
      this.host.onError?.("v4.projection.payloadTooLarge", error);
      if (!this.projectionFaultedSessions.has(sessionId)) {
        this.projectionFaultedSessions.add(sessionId);
        void Promise.resolve(
          this.host.terminateTurnForProjectionFault?.(sessionId, error.reasonCode),
        ).catch((terminateError) => {
          this.host.onError?.("v4.projection.terminate", terminateError);
        });
      }
      return;
    }
    this.resolveProjectionEventCommit(sessionId, String(event.id));
    if (event.type === SessionEventType.ToolCallResult && this.host.emitPluginUiToolResult) {
      const toolCallId = (event.payload as { toolCallId: string }).toolCallId;
      const row = publisher
        .getSnapshot()
        .rows.window.find((row) => row.kind === "toolCall" && row.toolCallId === toolCallId);
      if (
        row?.kind === "toolCall" &&
        row.status === "success" &&
        row.display?.kind === "mcp_tool"
      ) {
        const result = pluginUiToolResultNotificationSchema.safeParse({
          sessionId,
          toolCallId,
          serverName: row.display.serverName,
          ui: row.display.ui,
          ...(row.input && typeof row.input === "object" && !Array.isArray(row.input)
            ? { input: row.input }
            : {}),
        });
        if (result.success) this.host.emitPluginUiToolResult(result.data);
      }
    }
    if (
      !this.hydrationBuffers.has(sessionId) &&
      (event.type === SessionEventType.TurnComplete || event.type === SessionEventType.TurnError)
    ) {
      try {
        this.host.onHighspeedTurnTerminal?.(sessionId, event, publisher.getSnapshot());
      } catch (error) {
        this.host.onError?.("v4.projection.highspeedMetrics", error);
      }
    }
    if (
      event.type === SessionEventType.TargetChanged &&
      (event.payload as TargetChangedPayload).target?.status === "complete"
    ) {
      try {
        this.host.onTargetCompleted?.(sessionId, event);
      } catch (error) {
        this.host.onError?.("v4.projection.targetCompleted", error);
      }
    }
    if (event.type === SessionEventType.TurnComplete || event.type === SessionEventType.TurnError) {
      this.projectionFaultedSessions.delete(sessionId);
    }
    if (event.type === SessionEventType.TurnSteerQueued) {
      const queueItemId = (event.payload as { pendingInputId?: string }).pendingInputId;
      const item = queueItemId
        ? publisher
            .getSnapshot()
            .queue.items.find((candidate) => candidate.queueItemId === queueItemId)
        : undefined;
      if (item) this.inbox.pinLiveInput(sessionId, item);
    }
    if (!promotedQueueRemoval) {
      if (removedQueueItems.length > 0) {
        this.host.invalidatePersistentCommandFacts?.(sessionId);
      }
      for (const item of removedQueueItems) {
        this.inbox.releaseLiveInput({
          sessionId,
          commandId: item.sourceCommandId,
        });
      }
    }
    if (event.type === SessionEventType.SessionInputPromoted) {
      const sourceCommandId = (event.payload as { sourceCommandId?: string }).sourceCommandId;
      if (sourceCommandId) {
        this.host.invalidatePersistentCommandFacts?.(sessionId);
        this.inbox.releaseLiveInput({ sessionId, commandId: sourceCommandId });
      }
    }
    if (publisher.getDroppedContentStreamEventCount() > 0 && this.hydratedSessions.has(sessionId)) {
      this.hydratedSessions.delete(sessionId);
      this.host.onError?.(
        "v4.assistantConservation",
        new Error(
          `projection dropped content stream events for session ${sessionId}; scheduling re-hydration`,
        ),
      );
    }
    for (const [routeKey, state] of this.flushStates) {
      if (state.sessionId !== sessionId) continue;
      this.scheduleFlush(routeKey, state, publisher);
    }
    this.fanOutToIndex(sessionId, event);
  }

  
  ingestDetachedLiveSession(
    sessionId: string,
    event: SessionEvent,
    parentSessionId?: string,
  ): void {
    if (!this.detachedLiveSessions.has(sessionId)) {
      this.host.onDebug?.(`register detached live child publisher session=${sessionId}`);
    }
    this.detachedLiveSessions.add(sessionId);
    if (parentSessionId && parentSessionId !== sessionId) {
      this.detachedChildParent.set(sessionId, parentSessionId);
      let children = this.detachedChildrenByParent.get(parentSessionId);
      if (!children) {
        children = new Set();
        this.detachedChildrenByParent.set(parentSessionId, children);
      }
      children.add(sessionId);
    }
    if (event.type === SessionEventType.TurnComplete || event.type === SessionEventType.TurnError) {
      this.detachedTerminalAt.set(sessionId, Date.now());
    } else if (event.type === SessionEventType.TurnStarted) {
      this.detachedTerminalAt.delete(sessionId);
    }
    this.ingest(sessionId, event);
  }

  
  pruneDetachedChildPublishers(
    nowMs: number = Date.now(),
    graceMs: number = DETACHED_CHILD_PUBLISHER_GRACE_MS,
  ): number {
    let released = 0;
    for (const [childId, terminalAt] of [...this.detachedTerminalAt]) {
      if (nowMs - terminalAt < graceMs) continue;
      if (this.host.sessionExists(childId)) continue;
      if (this.publishers.get(childId)?.hasSubscribers()) continue;
      this.releaseDetachedChild(childId);
      released += 1;
    }
    return released;
  }

  private releaseDetachedChild(childId: string): void {
    this.host.onDebug?.(`release detached live child publisher session=${childId}`);
    this.cleanupSessionRuntime(childId, { clearCommandInbox: false, notifyIndexRemoved: false });
  }

  
  private fanOutToIndex(sessionId: string, event: SessionEvent): void {
    if (event.type === SessionEventType.ModelStreaming) return;
    if (event.type === SessionEventType.DynamicWorkflowRunProgress) {
      this.indexFanoutThrottle.request(sessionId);
      return;
    }
    this.publishCurrentSummaryToIndex(sessionId);
  }

  
  private publishCurrentSummaryToIndex(sessionId: string): void {
    this.indexFanoutThrottle.notePublished(sessionId);
    const getWorkspaceId = this.host.getSessionWorkspaceId;
    if (!getWorkspaceId) return;
    try {
      const workspaceId = getWorkspaceId.call(this.host, sessionId);
      if (!workspaceId) return;
      if (this.host.isDraftSession?.(sessionId)) return;
      const indexPublisher = this.indexPublishers.get(workspaceId);
      if (!indexPublisher) return;
      const conversationPublisher = this.publishers.get(sessionId);
      if (!conversationPublisher) return;
      const changed = indexPublisher.ingestConversation(
        conversationPublisher.getSnapshot(),
        this.resolveIndexMeta(sessionId),
      );
      if (changed) this.flushIndex(workspaceId);
    } catch (error) {
      this.host.onError?.("v4.sessionsIndex.ingest", error);
    }
  }

  
  private resolveIndexMeta(sessionId: string): {
    createdAt: number;
    lastActivityAt: number;
    lastOutcome?: SessionSummary["lastOutcome"];
    parentSessionId?: string;
  } {
    const meta = this.host.getSessionIndexMeta?.(sessionId);
    return {
      createdAt: meta?.createdAt ?? 0,
      lastActivityAt: meta?.lastActivityAt ?? this.now(),
      ...(meta?.lastOutcome ? { lastOutcome: meta.lastOutcome } : {}),
      ...(meta?.parentSessionId ? { parentSessionId: meta.parentSessionId } : {}),
    };
  }

  
  private flushIndex(workspaceId: string, onlyConnectionId?: string): void {
    const publisher = this.indexPublishers.get(workspaceId);
    if (!publisher) return;
    for (const subscriptionId of publisher.subscriptionIds()) {
      const connectionId = publisher.connectionIdForSubscription(subscriptionId);
      if (
        connectionId === null ||
        this.pausedConnections.has(connectionId) ||
        (onlyConnectionId !== undefined && connectionId !== onlyConnectionId)
      ) {
        continue;
      }
      const reservation = publisher.reserveFlush(subscriptionId);
      if (!reservation) continue;
      try {
        this.emitReservation(reservation);
      } catch (error) {
        this.host.onError?.("v4.sessionsIndex.emit", error);
      }
    }
  }

  
  async subscribeSessionsIndex(
    rawParams: unknown,
  ): Promise<V4SubscribeDispatchResult<SessionsIndexTopicFrame>> {
    const dispatch = await this.subscribeSessionsIndexReserved(rawParams);
    dispatch.commit();
    return dispatch;
  }

  async reconcileSessions(rawParams: unknown): Promise<SessionsIndexReconcileResult> {
    const params = sessionsIndexReconcileParamsSchema.parse(rawParams);
    if (!this.host.reconcileSessions) throw new Error("sessionsIndex/reconcile is unavailable");
    return sessionsIndexReconcileResultSchema.parse(await this.host.reconcileSessions(params));
  }

  async subscribeSessionsIndexReserved(
    rawParams: unknown,
  ): Promise<V4SubscribeDispatchResult<SessionsIndexTopicFrame>> {
    const params = v4ConversationSubscribeParamsSchema.parse(rawParams);
    const workspaceId = parseSessionsIndexTopic(params.topic);
    if (workspaceId === null) {
      throw new Error(`Not a sessions-index topic: ${params.topic}`);
    }
    const publisher = await this.ensureIndexPublisher(workspaceId, params.legacyTaskIds);
    this.indexPublishers.ensureActive();
    const result = publisher.subscribeReserved(params.connectionId, params.base);
    try {
      return this.subscribeDispatch(
        {
          subscriptionId: result.subscriptionId,
          mode: result.mode,
          logEpoch: publisher.logEpoch,
        },
        result.reservation,
        () => this.flushIndex(workspaceId),
      );
    } catch (error) {
      result.rollback();
      throw error;
    }
  }

  
  private async ensureIndexPublisher(
    workspaceId: string,
    legacyTaskIds?: readonly string[],
  ): Promise<SessionsIndexPublisher> {
    const existing = this.indexPublishers.get(workspaceId);
    const shouldRefreshLegacy =
      Boolean(legacyTaskIds?.length) && Boolean(this.host.refreshLegacySessionSummaries);
    if (existing && !shouldRefreshLegacy) return existing;

    return this.indexPublishers.runExclusive(workspaceId, () =>
      this.ensureIndexPublisherExclusive(workspaceId, legacyTaskIds),
    );
  }

  
  private async ensureIndexPublisherExclusive(
    workspaceId: string,
    legacyTaskIds?: readonly string[],
  ): Promise<SessionsIndexPublisher> {
    const refreshed =
      legacyTaskIds && legacyTaskIds.length > 0
        ? ((await this.host.refreshLegacySessionSummaries?.(workspaceId, legacyTaskIds)) ?? null)
        : null;
    const existing = this.indexPublishers.get(workspaceId);
    if (existing) {
      if (refreshed && existing.mergeMissingStoredSummaries(refreshed)) {
        this.flushIndex(workspaceId);
      }
      return existing;
    }
    const publisher = new SessionsIndexPublisher(
      workspaceId,
      this.createLogEpoch(`sessions-index/${workspaceId}`),
      this.now,
    );
    const stored = refreshed ?? (await this.host.getStoredSessionSummaries?.(workspaceId)) ?? [];
    for (const summary of stored) publisher.seed(summary);
    const liveIds = this.host.listWorkspaceSessionIds?.(workspaceId) ?? [...this.publishers.keys()];
    for (const sessionId of liveIds) {
      const conversationPublisher = this.publishers.get(sessionId);
      if (!conversationPublisher) continue;
      if (this.host.isDraftSession?.(sessionId)) continue;
      publisher.ingestConversation(
        conversationPublisher.getSnapshot(),
        this.resolveIndexMeta(sessionId),
      );
    }
    this.indexPublishers.set(workspaceId, publisher);
    return publisher;
  }

  
  async subscribeWorkspaceConfig(
    rawParams: unknown,
  ): Promise<V4SubscribeDispatchResult<WorkspaceConfigTopicFrame>> {
    const dispatch = await this.subscribeWorkspaceConfigReserved(rawParams);
    dispatch.commit();
    return dispatch;
  }

  async subscribeWorkspaceConfigReserved(
    rawParams: unknown,
  ): Promise<V4SubscribeDispatchResult<WorkspaceConfigTopicFrame>> {
    const params = v4ConversationSubscribeParamsSchema.parse(rawParams);
    const workspaceId = parseWorkspaceConfigTopic(params.topic);
    if (workspaceId === null) {
      throw new Error(`Not a workspace-config topic: ${params.topic}`);
    }
    const publisher = await this.ensureConfigPublisher(workspaceId);
    const result = publisher.subscribeReserved(params.connectionId, params.base);
    try {
      return this.subscribeDispatch(
        {
          subscriptionId: result.subscriptionId,
          mode: result.mode,
          logEpoch: publisher.logEpoch,
        },
        result.reservation,
        () => this.flushConfig(workspaceId),
      );
    } catch (error) {
      result.rollback();
      throw error;
    }
  }

  
  publishWorkspaceConfig(workspaceId: string, state: WorkspaceConfigState): void {
    if (this.disposed) return;
    let publisher = this.configPublishers.get(workspaceId);
    if (!publisher) {
      publisher = new WorkspaceConfigPublisher(
        workspaceId,
        this.createLogEpoch(`workspace-config/${workspaceId}`),
        this.now,
      );
      this.configPublishers.set(workspaceId, publisher);
    }
    try {
      if (publisher.publish(state)) this.flushConfig(workspaceId);
    } catch (error) {
      this.host.onError?.("v4.workspaceConfig.publish", error);
    }
  }

  private async pullWorkspaceConfig(workspaceId: string): Promise<WorkspaceConfigState | null> {
    if (!this.host.getWorkspaceConfig) return null;
    return (await this.host.getWorkspaceConfig(workspaceId)) ?? null;
  }

  
  private async ensureConfigPublisher(workspaceId: string): Promise<WorkspaceConfigPublisher> {
    const existing = this.configPublishers.get(workspaceId);
    if (existing) return existing;
    const publisher = new WorkspaceConfigPublisher(
      workspaceId,
      this.createLogEpoch(`workspace-config/${workspaceId}`),
      this.now,
    );
    const seed = await this.pullWorkspaceConfig(workspaceId).catch((error) => {
      this.host.onError?.("v4.workspaceConfig.seed", error);
      return null;
    });
    if (seed) publisher.publish(seed);
    const raced = this.configPublishers.get(workspaceId);
    if (raced) return raced;
    this.configPublishers.set(workspaceId, publisher);
    return publisher;
  }

  
  private flushConfig(workspaceId: string, onlyConnectionId?: string): void {
    const publisher = this.configPublishers.get(workspaceId);
    if (!publisher) return;
    for (const subscriptionId of publisher.subscriptionIds()) {
      const connectionId = publisher.connectionIdForSubscription(subscriptionId);
      if (
        connectionId === null ||
        this.pausedConnections.has(connectionId) ||
        (onlyConnectionId !== undefined && connectionId !== onlyConnectionId)
      ) {
        continue;
      }
      const reservation = publisher.reserveFlush(subscriptionId);
      if (!reservation) continue;
      try {
        this.emitReservation(reservation);
      } catch (error) {
        this.host.onError?.("v4.workspaceConfig.emit", error);
      }
    }
  }

  
  async subscribe(rawParams: unknown): Promise<V4SubscribeDispatchResult<ConversationTopicFrame>> {
    const dispatch = await this.subscribeReserved(rawParams);
    dispatch.commit();
    return dispatch;
  }

  async subscribeReserved(
    rawParams: unknown,
  ): Promise<V4SubscribeDispatchResult<ConversationTopicFrame>> {
    const params = v4ConversationSubscribeParamsSchema.parse(rawParams);
    const sessionId = parseConversationTopic(params.topic);
    if (sessionId === null) {
      throw new Error(`Unsupported topic: ${params.topic}`);
    }
    const isLiveConversation = this.hasLiveConversation(sessionId);
    this.host.onDebug?.(
      `subscribe conversation session=${sessionId} coldResume=${String(!isLiveConversation)}`,
    );
    const restoreStartedAt = performance.now();
    const existingReady = this.readyFlights.get(sessionId);
    const historyFirst = params.historyFirst === true && Boolean(this.host.loadPersistedMessages);
    const initialState = this.publishers.get(sessionId)?.getSnapshot().runtimeInitialization;
    if (!historyFirst && initialState?.status === "failed") {
      throw new V4SubscribeSessionUnavailableError(
        sessionId,
        "fault.subscribe.resumeFailed",
        initialState.message,
      );
    }
    const publisher =
      historyFirst &&
      (this.historyOpenings.has(sessionId) ||
        initialState?.status === "failed" ||
        (!isLiveConversation && !existingReady))
        ? await this.ensureHistoryReadyPublisher(
            sessionId,
            params.resumeThoughtLevel,
            params.workspace,
            params.additionalDirectories,
            params.retryInitialization,
          )
        : existingReady
          ? await existingReady
          : !isLiveConversation
            ? await this.ensureColdReadyPublisher(
                sessionId,
                params.resumeThoughtLevel,
                params.workspace,
                params.additionalDirectories,
              )
            : await this.hydratePublisher(sessionId);
    const cliSessionRestoreMs = !isLiveConversation
      ? Math.max(0, Math.round(performance.now() - restoreStartedAt))
      : undefined;
    const profileName = params.clientMode === "desktop-continuous" ? "continuous" : "replayable";
    const initialFrameEncodeStartedAt = performance.now();
    const result = publisher.subscribeReserved({
      connectionId: params.connectionId,
      base: params.base,
      deliveryProfile: profileName,
      workflowRunDeltas: params.workflowRunDeltas === true,
    });
    const routeKey = subscriptionRouteKey(
      params.topic,
      result.ack.subscriptionId,
      params.connectionId,
    );
    let dispatch: V4SubscribeDispatchResult<ConversationTopicFrame>;
    try {
      dispatch = this.subscribeDispatch(result.ack, result.reservation, () => {
        const state = this.flushStates.get(routeKey);
        if (state) this.scheduleFlush(routeKey, state, publisher);
        this.historyOpenings.get(sessionId)?.start();
      });
      dispatch.ack = {
        ...dispatch.ack,
        openTiming: {
          version: 1,
          ...(cliSessionRestoreMs !== undefined
            ? historyFirst
              ? { historyReadyMs: cliSessionRestoreMs }
              : { cliSessionRestoreMs }
            : {}),
          initialFrameEncodeMs: Math.max(
            0,
            Math.round(performance.now() - initialFrameEncodeStartedAt),
          ),
          sessionRuntimeState: isLiveConversation ? "warm" : "cold",
          snapshotRowCount: publisher.getSnapshot().rows.window.length,
        },
      };
    } catch (error) {
      result.rollback();
      throw error;
    }
    for (const [staleRouteKey, staleState] of this.flushStates) {
      if (staleState.sessionId !== sessionId) continue;
      if (publisher.hasSubscription(staleState.subscriptionId, staleState.connectionId)) {
        continue;
      }
      if (staleState.timer) clearTimeout(staleState.timer);
      this.flushStates.delete(staleRouteKey);
    }
    this.flushStates.set(routeKey, {
      sessionId,
      topic: params.topic,
      subscriptionId: result.ack.subscriptionId,
      connectionId: params.connectionId,
      deliveryProfile: profileName,
      flushWindowMs: DELIVERY_PROFILES[profileName].flushWindowMs,
      timer: null,
    });
    return dispatch;
  }

  
  resyncReserved(rawParams: unknown): V4SubscribeDispatchResult<RoutedTopicFrame> {
    const params = v4ConversationResyncParamsSchema.parse(rawParams);
    const request = {
      base: params.base,
      ...(params.forceSnapshot !== undefined ? { forceSnapshot: params.forceSnapshot } : {}),
    };
    const sessionId = parseConversationTopic(params.topic);
    if (sessionId !== null) {
      const publisher = this.publishers.get(sessionId);
      if (!publisher?.hasSubscription(params.subscriptionId, params.connectionId)) {
        throw new Error("fault.subscription.notOwned");
      }
      const routeKey = subscriptionRouteKey(
        params.topic,
        params.subscriptionId,
        params.connectionId,
      );
      const flushState = this.flushStates.get(routeKey);
      if (flushState?.timer) {
        clearTimeout(flushState.timer);
        flushState.timer = null;
      }
      const result = publisher.resyncReserved(params.subscriptionId, request);
      if (!result) throw new Error("fault.subscription.notOwned");
      try {
        return this.subscribeDispatch(result.ack, result.reservation, () => {
          const state = this.flushStates.get(routeKey);
          if (state) this.scheduleFlush(routeKey, state, publisher);
        });
      } catch (error) {
        result.rollback();
        if (flushState) this.scheduleFlush(routeKey, flushState, publisher);
        throw error;
      }
    }

    const indexWorkspaceId = parseSessionsIndexTopic(params.topic);
    if (indexWorkspaceId !== null) {
      const publisher = this.indexPublishers.get(indexWorkspaceId);
      if (!publisher?.hasSubscription(params.subscriptionId, params.connectionId)) {
        throw new Error("fault.subscription.notOwned");
      }
      const result = publisher.resyncReserved(params.subscriptionId, request);
      if (!result) throw new Error("fault.subscription.notOwned");
      try {
        return this.subscribeDispatch(
          {
            subscriptionId: result.subscriptionId,
            mode: result.mode,
            logEpoch: publisher.logEpoch,
          },
          result.reservation,
          () => this.flushIndex(indexWorkspaceId),
        );
      } catch (error) {
        result.rollback();
        throw error;
      }
    }

    const configWorkspaceId = parseWorkspaceConfigTopic(params.topic);
    if (configWorkspaceId !== null) {
      const publisher = this.configPublishers.get(configWorkspaceId);
      if (!publisher?.hasSubscription(params.subscriptionId, params.connectionId)) {
        throw new Error("fault.subscription.notOwned");
      }
      const result = publisher.resyncReserved(params.subscriptionId, request);
      if (!result) throw new Error("fault.subscription.notOwned");
      try {
        return this.subscribeDispatch(
          {
            subscriptionId: result.subscriptionId,
            mode: result.mode,
            logEpoch: publisher.logEpoch,
          },
          result.reservation,
          () => this.flushConfig(configWorkspaceId),
        );
      } catch (error) {
        result.rollback();
        throw error;
      }
    }
    throw new Error(`Unsupported topic: ${params.topic}`);
  }

  
  async rowsRange(rawParams: unknown): Promise<V4ConversationRowsRangeResult> {
    const params = v4ConversationRowsRangeParamsSchema.parse(rawParams);
    const existingReady = this.readyFlights.get(params.sessionId);
    const publisher = this.historyOpenings.has(params.sessionId)
      ? await this.historyOpenings.get(params.sessionId)!.history
      : this.publishers.get(params.sessionId)?.getSnapshot().runtimeInitialization?.status ===
          "failed"
        ? this.publishers.get(params.sessionId)!
        : existingReady
          ? await existingReady
          : !this.hasLiveConversation(params.sessionId)
            ? await this.ensureColdReadyPublisher(params.sessionId)
            : await this.hydratePublisher(params.sessionId);
    return publisher.getRowsRange(
      {
        ...(params.beforeRowId !== undefined ? { beforeRowId: params.beforeRowId } : {}),
        limit: params.limit,
      },
      params.clientMode === "desktop-continuous" ? "continuous" : "replayable",
    );
  }

  
  async plans(rawParams: unknown): Promise<V4ConversationPlansResult> {
    const params = v4ConversationPlansParamsSchema.parse(rawParams);
    const existingReady = this.readyFlights.get(params.sessionId);
    const publisher = existingReady
      ? await existingReady
      : !this.hasLiveConversation(params.sessionId)
        ? await this.ensureColdReadyPublisher(params.sessionId)
        : await this.hydratePublisher(params.sessionId);
    return publisher.getPlans();
  }

  
  async workflowRunEvents(rawParams: unknown): Promise<V4ConversationWorkflowRunEventsResult> {
    const params = v4ConversationWorkflowRunEventsParamsSchema.parse(rawParams);
    if (!this.host.listDynamicWorkflowRunEvents) {
      throw new V4CapabilityUnsupportedError("listDynamicWorkflowRunEvents", params.sessionId);
    }
    await this.ensureHostRecordForJournalRead(params.sessionId);
    const page = await this.host.listDynamicWorkflowRunEvents(params.sessionId, {
      runId: params.runId,
      ...(params.afterSequence === undefined ? {} : { afterSequence: params.afterSequence }),
      limit: params.limit ?? WORKFLOW_RUN_EVENTS_PAGE_LIMITS.maxEvents,
      maxBytes: WORKFLOW_RUN_EVENTS_PAGE_LIMITS.maxBytes,
    });
    return v4ConversationWorkflowRunEventsResultSchema.parse(page);
  }

  
  async workflowRuns(rawParams: unknown): Promise<V4ConversationWorkflowRunsResult> {
    const params = v4ConversationWorkflowRunsParamsSchema.parse(rawParams);
    if (!this.host.listDynamicWorkflowRuns) {
      throw new V4CapabilityUnsupportedError("listDynamicWorkflowRuns", params.sessionId);
    }
    await this.ensureHostRecordForJournalRead(params.sessionId);
    const runs = await this.host.listDynamicWorkflowRuns(params.sessionId, {
      ...(params.limit === undefined ? {} : { limit: params.limit }),
    });
    return v4ConversationWorkflowRunsResultSchema.parse({ runs });
  }

  
  async workflowRunArtifacts(
    rawParams: unknown,
  ): Promise<V4ConversationWorkflowRunArtifactsResult> {
    const params = v4ConversationWorkflowRunArtifactsParamsSchema.parse(rawParams);
    if (!this.host.listDynamicWorkflowRunArtifacts) {
      throw new V4CapabilityUnsupportedError("listDynamicWorkflowRunArtifacts", params.sessionId);
    }
    await this.ensureHostRecordForJournalRead(params.sessionId);
    const artifacts = await this.host.listDynamicWorkflowRunArtifacts(params.sessionId, {
      runId: params.runId,
    });
    return v4ConversationWorkflowRunArtifactsResultSchema.parse({ artifacts: artifacts ?? [] });
  }

  
  async workflowRunArtifactData(
    rawParams: unknown,
  ): Promise<V4ConversationWorkflowRunArtifactDataResult> {
    const params = v4ConversationWorkflowRunArtifactDataParamsSchema.parse(rawParams);
    if (!this.host.listDynamicWorkflowRunArtifactItems) {
      throw new V4CapabilityUnsupportedError(
        "listDynamicWorkflowRunArtifactItems",
        params.sessionId,
      );
    }
    await this.ensureHostRecordForJournalRead(params.sessionId);
    const limit = Math.max(
      1,
      Math.min(
        params.limit ?? WORKFLOW_ARTIFACT_LIMITS.defaultItemsPerPage,
        WORKFLOW_ARTIFACT_LIMITS.maxItemsPerPage,
      ),
    );
    const page = await this.host.listDynamicWorkflowRunArtifactItems(params.sessionId, {
      runId: params.runId,
      artifactId: params.artifactId,
      ...(params.afterSequence === undefined ? {} : { afterSequence: params.afterSequence }),
      limit,
      maxBytes: WORKFLOW_ARTIFACT_LIMITS.maxPageBytes,
      ...(params.fields === undefined ? {} : { fields: params.fields }),
    });
    return v4ConversationWorkflowRunArtifactDataResultSchema.parse(page);
  }

  
  async workflowRunArtifactRead(
    rawParams: unknown,
  ): Promise<V4ConversationWorkflowRunArtifactReadResult> {
    const params = v4ConversationWorkflowRunArtifactReadParamsSchema.parse(rawParams);
    if (!this.host.readDynamicWorkflowRunArtifact) {
      throw new V4CapabilityUnsupportedError("readDynamicWorkflowRunArtifact", params.sessionId);
    }
    await this.ensureHostRecordForJournalRead(params.sessionId);
    const artifact = await this.readWorkflowArtifactPayload(params);
    const totalBytes = artifact.bytes.byteLength;
    const start = Math.min(params.offset, totalBytes);
    const end = Math.min(start + params.limit, totalBytes);
    const chunk = artifact.bytes.subarray(start, end);
    return v4ConversationWorkflowRunArtifactReadResultSchema.parse({
      dataBase64: Buffer.from(chunk).toString("base64"),
      mediaType: artifact.mediaType,
      totalBytes,
      nextOffset: end < totalBytes ? end : null,
    });
  }

  
  async workflowRunWorkspace(
    rawParams: unknown,
  ): Promise<V4ConversationWorkflowRunWorkspaceResult> {
    const params = v4ConversationWorkflowRunWorkspaceParamsSchema.parse(rawParams);
    if (!this.host.listDynamicWorkflowRunWorkspaceNodes) {
      throw new V4CapabilityUnsupportedError(
        "listDynamicWorkflowRunWorkspaceNodes",
        params.sessionId,
      );
    }
    await this.ensureHostRecordForJournalRead(params.sessionId);
    const nodes =
      (await this.host.listDynamicWorkflowRunWorkspaceNodes(params.sessionId, {
        runId: params.runId,
      })) ?? [];
    const truncated = nodes.length > WORKFLOW_WORKSPACE_LIMITS.maxNodes;
    return v4ConversationWorkflowRunWorkspaceResultSchema.parse({
      nodes: truncated ? nodes.slice(0, WORKFLOW_WORKSPACE_LIMITS.maxNodes) : nodes,
      ...(truncated ? { truncated: true } : {}),
    });
  }

  
  async workflowRunNodeResult(
    rawParams: unknown,
  ): Promise<V4ConversationWorkflowRunNodeResultResult> {
    const params = v4ConversationWorkflowRunNodeResultParamsSchema.parse(rawParams);
    if (!this.host.readDynamicWorkflowRunNodeResult) {
      throw new V4CapabilityUnsupportedError("readDynamicWorkflowRunNodeResult", params.sessionId);
    }
    await this.ensureHostRecordForJournalRead(params.sessionId);
    const maxBytes = Math.max(
      1,
      Math.min(
        params.maxBytes ?? WORKFLOW_WORKSPACE_LIMITS.resultMaxBytes,
        WORKFLOW_WORKSPACE_LIMITS.resultMaxBytes,
      ),
    );
    const result = await this.host.readDynamicWorkflowRunNodeResult(params.sessionId, {
      runId: params.runId,
      siteId: params.siteId,
      ordinal: params.ordinal,
      maxBytes,
    });
    if (result === undefined) {
      throw new Error(
        `fault.workflowRunNodeResult.notFound: ${params.runId}/${params.siteId}@${params.ordinal}`,
      );
    }
    return v4ConversationWorkflowRunNodeResultResultSchema.parse(result);
  }

  
  private readWorkflowArtifactPayload(params: {
    sessionId: string;
    runId: string;
    artifactId: string;
    version: number;
  }): Promise<{ bytes: Uint8Array; mediaType: string }> {
    const now = this.now();
    this.pruneBinaryReadCache(now);
    const key = `dwfart\u0000${params.sessionId}\u0000${params.runId}\u0000${params.artifactId}\u0000${params.version}`;
    const cached = this.binaryReadCache.get(key);
    if (cached) {
      cached.accessedAt = now;
      return cached.payload;
    }

    const payload = this.host.readDynamicWorkflowRunArtifact!(params.sessionId, {
      runId: params.runId,
      artifactId: params.artifactId,
      version: params.version,
    })
      .then((artifact) => {
        if (artifact === undefined) {
          throw new Error(
            `fault.workflowRunArtifactRead.notFound: ${params.runId}/${params.artifactId}@${params.version}`,
          );
        }
        const current = this.binaryReadCache.get(key);
        if (current) {
          current.bytes = artifact.bytes.byteLength;
          this.binaryReadCacheBytes += artifact.bytes.byteLength;
          this.pruneBinaryReadCache(this.now());
        }
        return { bytes: artifact.bytes, mediaType: artifact.contentType };
      })
      .catch((error: unknown) => {
        this.deleteBinaryReadCacheEntry(key);
        throw error;
      });
    this.binaryReadCache.set(key, {
      sessionId: params.sessionId,
      accessedAt: now,
      bytes: null,
      payload,
    });
    return payload;
  }

  
  private async ensureHostRecordForJournalRead(sessionId: string): Promise<void> {
    const ready = this.readyFlights.get(sessionId);
    if (ready) await ready;
    if (this.publishers.get(sessionId)?.getSnapshot().runtimeInitialization?.status === "failed")
      throw new Error("fault.subscribe.resumeFailed");
    if (this.hasLiveConversation(sessionId)) return;
    await this.coldResume.ensureResumed(sessionId);
  }

  async fileChanges(rawParams: unknown): Promise<V4ConversationFileChangesResult> {
    const params = v4ConversationFileChangesParamsSchema.parse(rawParams);
    if (!this.host.getConversationFileChanges) {
      throw new Error("fault.fileChanges.unsupported");
    }
    const existingReady = this.readyFlights.get(params.sessionId);
    const publisher = existingReady
      ? await existingReady
      : !this.hasLiveConversation(params.sessionId)
        ? await this.ensureColdReadyPublisher(params.sessionId)
        : await this.hydratePublisher(params.sessionId);
    const resolution = this.resolveQueryRowTarget(publisher, params, "fileChanges");
    const messageIds = resolution.messageIds ?? [];
    const targetTurnId = toRuntimeTurnId(resolution.row.turnId);
    return this.host.getConversationFileChanges(
      params.sessionId,
      params.target.rowId,
      messageIds,
      targetTurnId,
    );
  }

  async backgroundBashOutput(rawParams: unknown): Promise<BackgroundBashOutputResult> {
    const { sessionId, workId } = v4BackgroundBashOutputParamsSchema.parse(rawParams);
    if (!this.host.readBackgroundBashOutput) return { kind: "unsupported", workId };
    return backgroundBashOutputResultSchema.parse(
      await this.host.readBackgroundBashOutput(sessionId, workId),
    );
  }

  async fileRewindPreview(rawParams: unknown): Promise<V4ConversationFileRewindPreviewResult> {
    const params = v4ConversationFileRewindPreviewParamsSchema.parse(rawParams);
    if (!this.host.previewConversationFileRewind) {
      throw new Error("fault.fileRewindPreview.unsupported");
    }
    const existingReady = this.readyFlights.get(params.sessionId);
    const publisher = existingReady
      ? await existingReady
      : !this.host.sessionExists(params.sessionId)
        ? await this.ensureColdReadyPublisher(params.sessionId)
        : await this.hydratePublisher(params.sessionId);
    const resolution = this.resolveQueryRowTarget(publisher, params, "fileRewindPreview");
    const messageIds = resolution.messageIds ?? [];
    const targetTurnId = toRuntimeTurnId(resolution.row.turnId);
    return this.host.previewConversationFileRewind(
      params.sessionId,
      params.target.rowId,
      messageIds,
      targetTurnId,
    );
  }

  private resolveQueryRowTarget(
    publisher: ConversationTopicPublisher,
    params: {
      target: ConversationRowTarget;
      baseRevision: number;
      baseLogEpoch: string;
    },
    action: "fileChanges" | "fileRewindPreview",
  ): Extract<ReturnType<ConversationTopicPublisher["resolveRowActionTarget"]>, { ok: true }> {
    const snapshot = publisher.getSnapshot();
    if (params.baseLogEpoch !== snapshot.logEpoch) throw new Error("proto.staleLogEpoch");
    if (params.baseRevision !== snapshot.revision) throw new Error("proto.staleRevision");
    const resolution = publisher.resolveRowActionTarget(params.target, action);
    if (!resolution.ok) throw new Error(resolution.reasonCode);
    return resolution;
  }

  
  async attachmentBegin(rawParams: unknown): Promise<V4AttachmentBeginResult> {
    const params = v4AttachmentBeginParamsSchema.parse(rawParams);
    if (!this.host.putSessionAttachment) {
      throw new Error("fault.attachment.putUnsupported");
    }
    if (!this.host.sessionExists(params.sessionId)) {
      await this.coldResume.ensureResumed(params.sessionId);
    }
    return this.attachmentUploads.begin(params);
  }

  async attachmentChunk(rawParams: unknown): Promise<V4AttachmentChunkResult> {
    return this.attachmentUploads.chunk(v4AttachmentChunkParamsSchema.parse(rawParams));
  }

  attachmentCommit(rawParams: unknown): Promise<V4AttachmentCommitResult> {
    return this.attachmentUploads.commit(v4AttachmentCommitParamsSchema.parse(rawParams));
  }

  async attachmentAbort(rawParams: unknown): Promise<void> {
    await this.attachmentUploads.abort(v4AttachmentAbortParamsSchema.parse(rawParams));
  }

  async attachmentRead(rawParams: unknown): Promise<V4AttachmentReadResult> {
    const params = v4AttachmentReadParamsSchema.parse(rawParams);
    if (!this.host.readSessionAttachment) {
      throw new Error("fault.attachment.readUnsupported");
    }
    const existingReady = this.readyFlights.get(params.sessionId);
    const publisher = existingReady
      ? await existingReady
      : !this.host.sessionExists(params.sessionId)
        ? await this.ensureColdReadyPublisher(params.sessionId)
        : await this.hydratePublisher(params.sessionId);
    const resolution = this.resolveReadableMediaAttachment(
      publisher,
      params.sessionId,
      params.ref,
      params.target,
      params.attachmentIndex,
    );
    if (!resolution) {
      throw new Error("fault.attachment.previewRefNotAuthorized");
    }

    const payload = await this.readAttachmentPayload(
      params.sessionId,
      params.ref,
      resolution.attachment.mime,
      resolution.messageId,
      resolution.attachmentIndex,
    );
    if (params.offset > payload.bytes.byteLength) {
      throw new Error("fault.attachment.previewRangeInvalid");
    }
    const end = Math.min(payload.bytes.byteLength, params.offset + params.limit);
    const chunk = payload.bytes.subarray(params.offset, end);
    return {
      dataBase64: Buffer.from(chunk).toString("base64"),
      mediaType: payload.mediaType,
      totalBytes: payload.bytes.byteLength,
      nextOffset: end < payload.bytes.byteLength ? end : null,
    };
  }

  async conversationAttachmentRead(
    rawParams: unknown,
  ): Promise<V4ConversationAttachmentReadResult> {
    const params = v4ConversationAttachmentReadParamsSchema.parse(rawParams);
    if (!this.host.readSessionAttachment) {
      throw new CfAttachmentFaultError(CF_ATTACHMENT_FAULT_CODES.readUnsupported);
    }
    const existingReady = this.readyFlights.get(params.sessionId);
    const publisher = existingReady
      ? await existingReady
      : !this.host.sessionExists(params.sessionId)
        ? await this.ensureColdReadyPublisher(params.sessionId)
        : await this.hydratePublisher(params.sessionId);
    const row = publisher
      .getSnapshot()
      .rows.window.find(
        (candidate) =>
          candidate.rowId === params.target.rowId && candidate.entityId === params.target.entityId,
      );
    if (row?.kind !== "userInput") {
      throw new CfAttachmentFaultError(CF_ATTACHMENT_FAULT_CODES.shareReadNotAuthorized);
    }
    const attachment = row.attachments?.[params.attachmentIndex];
    if (!attachment || (attachment.ref !== params.ref && attachment.previewRef !== params.ref)) {
      throw new CfAttachmentFaultError(CF_ATTACHMENT_FAULT_CODES.shareReadNotAuthorized);
    }
    const messageId = publisher.getMessageIdForRow(row.rowId) ?? undefined;
    let payload: { bytes: Uint8Array; mediaType: string };
    try {
      payload = await this.readAttachmentPayload(
        params.sessionId,
        params.ref,
        attachment.mime,
        messageId,
        params.attachmentIndex,
        true,
      );
    } catch (error) {
      throw toShareStatFault(error);
    }
    if (params.offset > payload.bytes.byteLength) {
      throw new Error("fault.attachment.previewRangeInvalid");
    }
    const end = Math.min(payload.bytes.byteLength, params.offset + params.limit);
    const chunk = payload.bytes.subarray(params.offset, end);
    return v4ConversationAttachmentReadResultSchema.parse({
      dataBase64: Buffer.from(chunk).toString("base64"),
      mediaType: payload.mediaType,
      totalBytes: payload.bytes.byteLength,
      nextOffset: end < payload.bytes.byteLength ? end : null,
    });
  }

  async conversationAttachmentStat(
    rawParams: unknown,
  ): Promise<V4ConversationAttachmentStatResult> {
    const params = v4ConversationAttachmentStatParamsSchema.parse(rawParams);
    if (!this.host.statSessionAttachment) {
      throw new CfAttachmentFaultError(CF_ATTACHMENT_FAULT_CODES.statUnsupported);
    }
    const existingReady = this.readyFlights.get(params.sessionId);
    const publisher = existingReady
      ? await existingReady
      : !this.host.sessionExists(params.sessionId)
        ? await this.ensureColdReadyPublisher(params.sessionId)
        : await this.hydratePublisher(params.sessionId);
    const row = publisher
      .getSnapshot()
      .rows.window.find(
        (candidate) =>
          candidate.rowId === params.target.rowId && candidate.entityId === params.target.entityId,
      );
    if (row?.kind !== "userInput") {
      throw new CfAttachmentFaultError(CF_ATTACHMENT_FAULT_CODES.shareStatNotAuthorized);
    }
    const attachment = row.attachments?.[params.attachmentIndex];
    if (!attachment || (attachment.ref !== params.ref && attachment.previewRef !== params.ref)) {
      throw new CfAttachmentFaultError(CF_ATTACHMENT_FAULT_CODES.shareStatNotAuthorized);
    }
    const messageId = publisher.getMessageIdForRow(row.rowId) ?? undefined;
    let result: { totalBytes: number; mediaType: string; mtimeMs?: number };
    try {
      result = await this.host.statSessionAttachment(params.sessionId, {
        ref: params.ref,
        mime: attachment.mime,
        ...(messageId ? { messageId } : {}),
        attachmentIndex: params.attachmentIndex,
      });
    } catch (error) {
      throw toShareStatFault(error);
    }
    if (result.totalBytes > PROTOCOL_V4_LIMITS.attachmentStatMaxBytes) {
      throw new CfAttachmentFaultError(CF_ATTACHMENT_FAULT_CODES.shareStatTooLarge);
    }
    return v4ConversationAttachmentStatResultSchema.parse(result);
  }

  async attachmentPreviewSource(rawParams: unknown): Promise<V4AttachmentPreviewSourceResult> {
    const params = v4AttachmentPreviewSourceParamsSchema.parse(rawParams);
    const existingReady = this.readyFlights.get(params.sessionId);
    const publisher = existingReady
      ? await existingReady
      : !this.host.sessionExists(params.sessionId)
        ? await this.ensureColdReadyPublisher(params.sessionId)
        : await this.hydratePublisher(params.sessionId);
    const resolution = this.resolveReadableMediaAttachment(
      publisher,
      params.sessionId,
      params.ref,
      params.target,
      params.attachmentIndex,
    );
    if (!resolution) {
      throw new Error("fault.attachment.previewRefNotAuthorized");
    }
    if (
      params.clientMode !== "desktop-continuous" ||
      !resolution.attachment.mime.startsWith("video/") ||
      !this.host.resolveSessionAttachmentPreviewSource
    ) {
      return { kind: "chunked" };
    }
    const result = await this.host.resolveSessionAttachmentPreviewSource(params.sessionId, {
      ref: params.ref,
      mime: resolution.attachment.mime,
      ...(resolution.messageId ? { messageId: resolution.messageId } : {}),
      ...(resolution.attachmentIndex !== undefined
        ? { attachmentIndex: resolution.attachmentIndex }
        : {}),
    });
    return v4AttachmentPreviewSourceResultSchema.parse(result);
  }

  private resolveReadableMediaAttachment(
    publisher: ConversationTopicPublisher,
    sessionId: string,
    ref: string,
    target?: { rowId: number; entityId: string },
    attachmentIndex?: number,
  ): { attachment: AttachmentRef; messageId?: string; attachmentIndex?: number } | null {
    const isPreviewable = (attachment: AttachmentRef) => {
      const mime = attachment.mime.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      return (
        mime.startsWith("image/") ||
        mime.startsWith("video/") ||
        mime === "application/pdf" ||
        (mime === "text/plain" &&
          (attachment.sourceKind === "topic-history" || attachment.sourceKind === "clipboard-text"))
      );
    };
    const matchesRef = (attachment: AttachmentRef) =>
      attachment.ref === ref || attachment.previewRef === ref;
    if (target && attachmentIndex !== undefined) {
      const row = publisher
        .getSnapshot()
        .rows.window.find(
          (candidate) => candidate.rowId === target.rowId && candidate.entityId === target.entityId,
        );
      if (row?.kind !== "userInput") return null;
      const attachment = row.attachments?.[attachmentIndex];
      if (!attachment || !isPreviewable(attachment) || !matchesRef(attachment)) {
        return null;
      }
      const messageId = publisher.getMessageIdForRow(row.rowId);
      return {
        attachment,
        attachmentIndex,
        ...(messageId ? { messageId } : {}),
      };
    }

    for (const row of publisher.getSnapshot().rows.window) {
      if (row.kind === "userInput") {
        for (const attachment of row.attachments ?? []) {
          if (!isPreviewable(attachment)) continue;
          if ((attachment.previewRef ?? attachment.ref) === ref) return { attachment };
        }
      }
      if (
        row.kind === "assistantText" &&
        artifactRefBelongsToSession(ref, sessionId) &&
        extractMarkdownArtifactImageRefs(row.text).includes(ref)
      ) {
        return {
          attachment: {
            ref,
            fileName: "assistant-image",
            mime: "image/png",
            sourceKind: "assistant-image",
          },
        };
      }
    }
    return null;
  }

  private readAttachmentPayload(
    sessionId: string,
    ref: string,
    mime: string,
    messageId?: string,
    attachmentIndex?: number,
    allowGeneric = false,
  ): Promise<{ bytes: Uint8Array; mediaType: string }> {
    const now = this.now();
    this.pruneBinaryReadCache(now);
    const key = `att\u0000${sessionId}\u0000${messageId ?? "legacy"}\u0000${attachmentIndex ?? -1}\u0000${ref}`;
    const cached = this.binaryReadCache.get(key);
    if (cached) {
      cached.accessedAt = now;
      return cached.payload;
    }

    const maxBytes = allowGeneric
      ? PROTOCOL_V4_LIMITS.attachmentPreviewMaxBytes
      : mime.startsWith("video/")
        ? PROTOCOL_V4_LIMITS.attachmentPreviewMaxBytes
        : PROTOCOL_V4_LIMITS.attachmentMaxBytes;
    const payload = this.host.readSessionAttachment!(sessionId, {
      ref,
      mime,
      maxBytes,
      ...(messageId ? { messageId } : {}),
      ...(attachmentIndex !== undefined ? { attachmentIndex } : {}),
    })
      .then((result) => {
        const resultMime = result.mediaType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
        if (
          !allowGeneric &&
          !resultMime.startsWith("image/") &&
          !resultMime.startsWith("video/") &&
          resultMime !== "application/pdf" &&
          !(
            resultMime === "text/plain" &&
            mime.split(";", 1)[0]?.trim().toLowerCase() === "text/plain"
          )
        ) {
          throw new CfAttachmentFaultError(CF_ATTACHMENT_FAULT_CODES.previewNotMedia);
        }
        if (result.bytes.byteLength > maxBytes) {
          throw new CfAttachmentFaultError(CF_ATTACHMENT_FAULT_CODES.previewTooLarge);
        }
        const current = this.binaryReadCache.get(key);
        if (current) {
          current.bytes = result.bytes.byteLength;
          this.binaryReadCacheBytes += result.bytes.byteLength;
          this.pruneBinaryReadCache(this.now());
        }
        return result;
      })
      .catch((error) => {
        this.deleteBinaryReadCacheEntry(key);
        throw error;
      });
    this.binaryReadCache.set(key, { sessionId, accessedAt: now, bytes: null, payload });
    return payload;
  }

  private pruneBinaryReadCache(now = this.now()): void {
    for (const [key, entry] of this.binaryReadCache) {
      if (now - entry.accessedAt > PROTOCOL_V4_LIMITS.attachmentReadCacheTtlMs) {
        this.deleteBinaryReadCacheEntry(key);
      }
    }
    if (this.binaryReadCacheBytes <= PROTOCOL_V4_LIMITS.attachmentReadCacheMaxBytes) return;
    const oldest = [...this.binaryReadCache.entries()]
      .filter(([, entry]) => entry.bytes !== null)
      .sort((left, right) => left[1].accessedAt - right[1].accessedAt);
    for (const [key] of oldest) {
      this.deleteBinaryReadCacheEntry(key);
      if (this.binaryReadCacheBytes <= PROTOCOL_V4_LIMITS.attachmentReadCacheMaxBytes) break;
    }
  }

  private deleteBinaryReadCacheEntry(key: string): void {
    const entry = this.binaryReadCache.get(key);
    if (!entry) return;
    this.binaryReadCache.delete(key);
    this.binaryReadCacheBytes = Math.max(0, this.binaryReadCacheBytes - (entry.bytes ?? 0));
  }

  /** v4/conversation/unsubscribe。 */
  unsubscribe(rawParams: unknown): void {
    const params = v4ConversationUnsubscribeParamsSchema.parse(rawParams);
    const sessionId = parseConversationTopic(params.topic);
    if (sessionId === null) {
      const workspaceId = parseSessionsIndexTopic(params.topic);
      if (workspaceId !== null) {
        this.indexPublishers
          .get(workspaceId)
          ?.unsubscribe(params.subscriptionId, params.connectionId);
        return;
      }
      const configWorkspaceId = parseWorkspaceConfigTopic(params.topic);
      if (configWorkspaceId !== null) {
        this.configPublishers
          .get(configWorkspaceId)
          ?.unsubscribe(params.subscriptionId, params.connectionId);
      }
      return;
    }
    const routeKey = subscriptionRouteKey(params.topic, params.subscriptionId, params.connectionId);
    const state = this.flushStates.get(routeKey);
    if (!state) return;
    if (state?.timer) clearTimeout(state.timer);
    this.flushStates.delete(routeKey);
    this.publishers.get(sessionId)?.unsubscribe(params.subscriptionId, params.connectionId);
  }

  
  async handleCommand(rawParams: unknown): Promise<CommandAck> {
    let ttftCapacityRejected = false;
    const ttftCommand =
      typeof rawParams === "object" && rawParams !== null && "ttft" in rawParams
        ? parseCommandEnvelope(rawParams)
        : undefined;
    if (ttftCommand?.ok && ttftCommand.envelope.ttft) {
      const sessionId = ttftCommand.envelope.sessionId;
      const control = sessionId ? this.publishers.get(sessionId)?.getSnapshot().control : undefined;
      ttftCapacityRejected = !this.localTtft.receive(
        ttftCommand.envelope,
        control?.canStop === true,
      );
    }
    if (this.readyFlights.size > 0) {
      const parsed = parseCommandEnvelope(rawParams);
      const sessionId = parsed.ok ? parsed.envelope.sessionId : null;
      const ready = sessionId === null ? undefined : this.readyFlights.get(sessionId);
      if (ready && sessionId !== null && !this.historyOpenings.has(sessionId)) await ready;
    }

    const outcome = await this.inbox.handle(rawParams);
    if (outcome.kind === "ack")
      return {
        ...outcome.ack,
        ...(ttftCapacityRejected ? { ttftExcluded: "capacity" as const } : {}),
      };
    this.localTtft.admitted(outcome.envelope.commandId);
    let durableInputIntent: ConversationInputIntent | null = null;
    let settledAck: CommandAck | null = null;
    type CommandFinal = Parameters<typeof outcome.settle>[0];
    const reportError = (scope: string, error: unknown): void => {
      try {
        this.host.onError?.(scope, error);
      } catch {
      }
    };
    const settleOnce = (final: CommandFinal): CommandAck => {
      if (settledAck) return settledAck;
      const ack = {
        ...outcome.ack,
        ...final,
        ...(ttftCapacityRejected ? { ttftExcluded: "capacity" as const } : {}),
      };
      outcome.settle(final);
      settledAck = ack;
      return ack;
    };
    const cancelDurableInput = async (reason: string): Promise<void> => {
      if (!durableInputIntent) return;
      try {
        await this.host.cancelCommandInput?.(outcome.envelope, outcome.queueItemId, reason);
      } catch (cancelError) {
        reportError("v4.command.input.cancel", cancelError);
      }
    };
    const releaseDurableInput = (
      final: Pick<CommandAck, "status" | "reasonCode" | "message" | "result">,
    ) => {
      if (!durableInputIntent || outcome.envelope.sessionId === null) return;
      try {
        this.inbox.releaseLiveInput(
          {
            sessionId: outcome.envelope.sessionId,
            commandId: durableInputIntent.sourceCommandId,
          },
          { ...outcome.ack, ...final },
        );
      } catch (releaseError) {
        reportError("v4.command.input.release", releaseError);
      }
    };
    try {
      const admission = {
        admissionSeq: outcome.admissionSeq,
        admittedAt: outcome.admittedAt,
        queueItemId: outcome.queueItemId,
      };
      const admissionPublisher =
        outcome.envelope.type === "createSession"
          ? new ConversationTopicPublisher(`pending-${outcome.envelope.commandId}`, "admission", {
              now: this.now,
            })
          : outcome.envelope.sessionId === null
            ? null
            : this.ensurePublisher(outcome.envelope.sessionId);
      const admissionProjectionBytes = admissionPublisher?.measureInputAdmissionProjectionBytes(
        outcome.envelope,
        admission,
      );
      if (
        admissionProjectionBytes !== null &&
        admissionProjectionBytes !== undefined &&
        admissionProjectionBytes > PROTOCOL_V4_LIMITS.logicalFrameAssemblyMaxBytes
      ) {
        return settleOnce({
          status: "failed",
          reasonCode: "proto.payloadTooLarge",
          message: `conversation projection would exceed ${PROTOCOL_V4_LIMITS.logicalFrameAssemblyMaxBytes} bytes`,
        });
      }
      durableInputIntent =
        (await this.host.admitCommandInput?.(outcome.envelope, admission)) ?? null;
      if (durableInputIntent && outcome.envelope.sessionId !== null) {
        this.inbox.pinLiveInput(outcome.envelope.sessionId, durableInputIntent);
      }
      const result = await this.host.executeCommand(outcome.envelope, admission);
      const admittedSessionId =
        result?.type === "createSession" ? result.sessionId : outcome.envelope.sessionId;
      if (admittedSessionId) this.publishCurrentSummaryToIndex(admittedSessionId);
      const telemetrySessionId =
        result?.type === "createSession" || result?.type === "createSelectionSideSession"
          ? result.sessionId
          : outcome.envelope.sessionId;
      const memoryEnabled = telemetrySessionId
        ? this.host.getSessionMemoryEnabled?.(telemetrySessionId)
        : undefined;
      const final = {
        status: "accepted" as const,
        ...(result ? { result } : {}),
        ...(memoryEnabled !== undefined ? { memoryEnabled } : {}),
      };
      return settleOnce(final);
    } catch (error) {
      if (error instanceof V4CommandNoopError) {
        await cancelDurableInput(error.reasonCode);
        const final = {
          status: "noop" as const,
          reasonCode: error.reasonCode,
        };
        releaseDurableInput(final);
        return settleOnce(final);
      }
      reportError("v4.command.execute", error);
      const domainReasonCode =
        typeof (error as { reasonCode?: unknown } | null)?.reasonCode === "string"
          ? String((error as { reasonCode: string }).reasonCode)
          : null;
      const final = {
        status: "failed" as const,
        reasonCode:
          error instanceof V4CommandNotImplementedError
            ? "fault.command.notImplemented"
            : (domainReasonCode ?? "fault.command.executionFailed"),
        message: error instanceof Error ? error.message : String(error),
      };
      await cancelDurableInput(final.reasonCode);
      releaseDurableInput(final);
      return settleOnce(final);
    } finally {
      if (!settledAck) {
        const final = {
          status: "failed" as const,
          reasonCode: "fault.command.executionFailed",
          message: "command admission terminated before a durable final was recorded",
        };
        releaseDurableInput(final);
        settleOnce(final);
      }
    }
  }

  
  async queryCommands(rawParams: unknown): Promise<CommandsQueryResult> {
    const receivedAt = localTtftNow();
    const params = commandsQueryParamsSchema.parse(rawParams);
    if (params.clock)
      return {
        results: params.commands.map((key) => ({ key, result: "unknown" as const })),
        clock: { instanceId: this.localTtft.instanceId, receivedAt, sentAt: localTtftNow() },
      };
    await Promise.all(
      params.commands.map((key) => {
        const ready = key.sessionId === null ? undefined : this.readyFlights.get(key.sessionId);
        return ready;
      }),
    );
    return commandsQueryResultSchema.parse({
      results: await this.inbox.query(params.commands),
    });
  }

  getQueueItem(sessionId: string, queueItemId: string): QueueItem | null {
    const snapshot = this.publishers.get(sessionId)?.getSnapshot();
    const item = snapshot?.queue.items.find((candidate) => candidate.queueItemId === queueItemId);
    return item ?? null;
  }

  hasQueueItemKind(sessionId: string, kind: QueueItem["kind"]): boolean {
    return Boolean(
      this.publishers
        .get(sessionId)
        ?.getSnapshot()
        .queue.items.some((candidate) => candidate.kind === kind),
    );
  }

  hasQueuedDelivery(sessionId: string, delivery: "guide" | "queue"): boolean {
    return Boolean(
      this.publishers
        .get(sessionId)
        ?.getSnapshot()
        .queue.items.some((candidate) => candidate.delivery.admitted === delivery),
    );
  }

  getQueueLength(sessionId: string): number {
    return this.publishers.get(sessionId)?.getSnapshot().queue.items.length ?? 0;
  }

  
  hasResidencyBlockingCommands(sessionId: string): boolean {
    return this.getQueueLength(sessionId) > 0 || this.inbox.hasPinnedSessionState(sessionId);
  }

  getQueueHead(sessionId: string): {
    autoDrain: boolean;
    dispatchState: QueueItem["dispatch"]["state"];
    kind: QueueItem["kind"];
    queueItemId: string;
    text: string;
  } | null {
    const snapshot = this.publishers.get(sessionId)?.getSnapshot();
    const item = snapshot?.queue.items[0];
    if (!snapshot || !item) return null;
    return {
      autoDrain: snapshot.queue.autoDrain,
      dispatchState: item.dispatch.state,
      kind: item.kind,
      queueItemId: item.queueItemId,
      text: item.text,
    };
  }

  
  getInputRoutingMode(
    sessionId: string,
  ): "startNow" | "enqueue" | "guide" | "reject" | "choice" | null {
    return this.publishers.get(sessionId)?.getSnapshot().inputRouting.mode ?? null;
  }

  getSessionFollowupMode(sessionId: string): "queue" | "guide" | null {
    return this.publishers.get(sessionId)?.getSnapshot().config.followupMode ?? null;
  }

  
  getMessageIdForRow(sessionId: string, rowId: number): string | null {
    return this.publishers.get(sessionId)?.getMessageIdForRow(rowId) ?? null;
  }

  resolveRowActionTarget(
    sessionId: string,
    target: ConversationRowTarget,
    action: ConversationRowTargetAction,
  ) {
    return this.publishers.get(sessionId)?.resolveRowActionTarget(target, action) ?? null;
  }

  
  getMessageIdsForTurnRow(sessionId: string, rowId: number): string[] {
    return this.publishers.get(sessionId)?.getMessageIdsForTurnRow(rowId) ?? [];
  }

  
  isLatestAssistantSegmentRow(sessionId: string, rowId: number): boolean | null {
    return this.publishers.get(sessionId)?.isLatestAssistantSegmentRow(rowId) ?? null;
  }

  resolveStableForkCandidate(sessionId: string, rowId: number) {
    return this.publishers.get(sessionId)?.resolveStableForkCandidate(rowId) ?? null;
  }

  
  isLatestRetryAssistantRow(sessionId: string, rowId: number): boolean | null {
    return this.publishers.get(sessionId)?.isLatestRetryAssistantRow(rowId) ?? null;
  }

  
  isLatestEditableUserRow(sessionId: string, rowId: number): boolean | null {
    return this.publishers.get(sessionId)?.isLatestEditableUserRow(rowId) ?? null;
  }

  
  getTurnIdForRow(sessionId: string, rowId: number): string | null {
    return this.publishers.get(sessionId)?.getTurnIdForRow(rowId) ?? null;
  }

  
  getTurnRewindAnchor(sessionId: string, rowId: number): string | null {
    return this.publishers.get(sessionId)?.getTurnRewindAnchor(rowId) ?? null;
  }

  
  disposeSession(sessionId: string, options: { deleted?: boolean } = {}): void {
    this.cleanupSessionRuntime(sessionId, {
      clearCommandInbox: false,
      notifyIndexRemoved: options.deleted === true,
    });
  }

  
  deactivateSession(sessionId: string): void {
    this.cleanupSessionRuntime(sessionId, {
      clearCommandInbox: true,
      notifyIndexRemoved: false,
    });
  }

  
  assertSessionRuntimeDeactivatable(sessionId: string): void {
    if (!this.inbox.hasPinnedSessionState(sessionId)) return;
    throw new Error(`Session command inbox is still pinned: ${sessionId}`);
  }

  
  hasConversationSubscribers(sessionId: string): boolean {
    return this.publishers.get(sessionId)?.hasSubscribers() ?? false;
  }

  
  collectMemoryDiagnostics(): Record<string, number> {
    return {
      publishers: this.publishers.size,
      detachedLive: this.detachedLiveSessions.size,
      detachedTerminal: this.detachedTerminalAt.size,
      rawSeqStates: this.rawSequenceStates.size,
    };
  }

  private cleanupSessionRuntime(
    sessionId: string,
    options: { clearCommandInbox: boolean; notifyIndexRemoved: boolean },
  ): void {
    if (options.clearCommandInbox) {
      this.assertSessionRuntimeDeactivatable(sessionId);
    }
    this.rejectProjectionEventWaiters(
      sessionId,
      new ProjectionEventCommitWaitError(
        "fault.projectionEventCommit.disposed",
        `conversation session disposed while waiting for projection event commit: ${sessionId}`,
      ),
    );
    this.attachmentUploads.clearSession(sessionId);
    for (const [key, entry] of this.binaryReadCache) {
      if (entry.sessionId === sessionId) this.deleteBinaryReadCacheEntry(key);
    }
    if (options.notifyIndexRemoved) {
      try {
        const workspaceId = this.host.getSessionWorkspaceId?.(sessionId) ?? null;
        if (workspaceId !== null) {
          const indexPublisher = this.indexPublishers.get(workspaceId);
          if (indexPublisher?.removeSession(sessionId)) {
            this.flushIndex(workspaceId);
          }
        }
      } catch (error) {
        this.host.onError?.("v4.sessionsIndex.remove", error);
      }
    }
    this.indexFanoutThrottle.clearSession(sessionId);
    for (const [routeKey, state] of this.flushStates) {
      if (state.sessionId !== sessionId) continue;
      if (state.timer) clearTimeout(state.timer);
      this.flushStates.delete(routeKey);
    }
    this.publishers.delete(sessionId);
    this.hydratedSessions.delete(sessionId);
    const hydrationBuffer = this.hydrationBuffers.get(sessionId);
    if (hydrationBuffer) hydrationBuffer.cancelled = true;
    this.hydrationBuffers.delete(sessionId);
    this.hydrationInFlight.delete(sessionId);
    this.readyFlights.delete(sessionId);
    this.historyOpenings.get(sessionId)?.cancel();
    this.rawSequenceStates.delete(sessionId);
    if (options.clearCommandInbox) this.inbox.clearSession(sessionId);
    this.telemetryNormalizer.clearSession(sessionId);
    this.detachedLiveSessions.delete(sessionId);
    this.projectionFaultedSessions.delete(sessionId);
    this.detachedTerminalAt.delete(sessionId);
    const parentId = this.detachedChildParent.get(sessionId);
    if (parentId !== undefined) {
      this.detachedChildParent.delete(sessionId);
      const siblings = this.detachedChildrenByParent.get(parentId);
      siblings?.delete(sessionId);
      if (siblings && siblings.size === 0) this.detachedChildrenByParent.delete(parentId);
    }
    const children = this.detachedChildrenByParent.get(sessionId);
    if (children) {
      this.detachedChildrenByParent.delete(sessionId);
      for (const childId of children) {
        this.detachedChildParent.delete(childId);
        if (this.host.sessionExists(childId)) continue;
        this.releaseDetachedChild(childId);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.localTtft.clear();
    for (const sessionId of this.projectionEventCommitWaiters.keys()) {
      this.rejectProjectionEventWaiters(
        sessionId,
        new ProjectionEventCommitWaitError(
          "fault.projectionEventCommit.gatewayDisposed",
          "conversation gateway disposed while waiting for projection event commit",
        ),
      );
    }
    clearInterval(this.attachmentPruneTimer);
    this.indexFanoutThrottle.clear();
    this.attachmentUploads.clear();
    this.binaryReadCache.clear();
    this.binaryReadCacheBytes = 0;
    for (const state of this.flushStates.values()) {
      if (state.timer) clearTimeout(state.timer);
    }
    this.flushStates.clear();
    this.publishers.clear();
    this.hydratedSessions.clear();
    for (const buffer of this.hydrationBuffers.values()) buffer.cancelled = true;
    this.hydrationBuffers.clear();
    this.hydrationInFlight.clear();
    this.readyFlights.clear();
    for (const opening of this.historyOpenings.values()) opening.cancel();
    this.historyOpenings.clear();
    this.rawSequenceStates.clear();
    this.telemetryEventIds.clear();
    this.detachedLiveSessions.clear();
    this.detachedChildParent.clear();
    this.detachedChildrenByParent.clear();
    this.detachedTerminalAt.clear();
    this.projectionFaultedSessions.clear();
    this.coldResume.clear();
    this.indexPublishers.dispose();
    this.configPublishers.clear();
    this.pausedConnections.clear();
  }

  
  flushNow(subscriptionId: string): ConversationTopicFrame | null {
    const match = [...this.flushStates.entries()].find(
      ([, state]) => state.subscriptionId === subscriptionId,
    );
    const state = match?.[1];
    if (!state) return null;
    if (this.pausedConnections.has(state.connectionId)) return null;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    const publisher = this.publishers.get(state.sessionId);
    if (!publisher) return null;
    const reservation = publisher.reserveFlush(state.subscriptionId);
    if (!reservation || !reservation.commit()) return null;
    return reservation.frame;
  }

  private ensurePublisher(sessionId: string): ConversationTopicPublisher {
    let publisher = this.publishers.get(sessionId);
    if (!publisher) {
      publisher = new ConversationTopicPublisher(sessionId, this.createLogEpoch(sessionId), {
        now: this.now,
      });
      this.publishers.set(sessionId, publisher);
      this.seedPublisherConfig(sessionId, publisher);
    }
    return publisher;
  }

  
  private seedPublisherConfig(sessionId: string, publisher: ConversationTopicPublisher): void {
    const getSeed = this.host.getSessionConfigSeed;
    if (!getSeed) return;
    try {
      const seed = getSeed.call(this.host, sessionId);
      if (seed) publisher.seedConfig(seed);
    } catch (error) {
      this.host.onError?.("v4.configSeed", error);
    }
  }

  
  private ensureHistoryReadyPublisher(
    sessionId: string,
    thought?: string,
    workspace?: CfWorkspaceRef,
    additionalDirectories?: string[],
    retryAttempt?: string,
  ): Promise<ConversationTopicPublisher> {
    const existing = this.historyOpenings.get(sessionId);
    if (existing) return existing.history;
    const publisher = this.publishers.get(sessionId);
    const failed = publisher?.getSnapshot().runtimeInitialization;
    if (failed?.status === "failed" && failed.attemptId !== retryAttempt)
      return Promise.resolve(publisher!);
    if (failed?.status === "failed") this.rawSequenceStates.delete(sessionId);
    const attemptId = randomUUID();
    const initializationStartedAt = performance.now();
    let resolveReady!: (publisher: ConversationTopicPublisher) => void;
    let rejectReady!: (error: unknown) => void;
    const ready = new Promise<ConversationTopicPublisher>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    void ready.catch(() => undefined);
    this.readyFlights.set(sessionId, ready);
    let messages: MessageWithParts[] | undefined;
    let started = false;
    const clear = () => {
      messages = undefined;
      if (this.readyFlights.get(sessionId) === ready) this.readyFlights.delete(sessionId);
      if (this.historyOpenings.get(sessionId) === opening) this.historyOpenings.delete(sessionId);
    };
    const opening = {
      cancel: () => {
        rejectReady(new Error("cold opening disposed"));
        clear();
      },
      history: Promise.resolve()
        .then(async () => {
          messages = await this.host.loadPersistedMessages!(sessionId);
          if (this.disposed || this.historyOpenings.get(sessionId) !== opening)
            throw new Error("cold opening disposed");
          const result = await this.hydratePublisher(sessionId, messages, true);
          this.setInitialization(sessionId, result, { status: "initializing", attemptId });
          return result;
        })
        .catch((error: unknown) => {
          rejectReady(error);
          clear();
          throw error;
        }),
      start: () => {
        if (started) return;
        started = true;
        setImmediate(() => {
          let disposeOnFailure: (() => Promise<void>) | undefined;
          let releaseRuntime: (() => void) | undefined;
          void (async () => {
            if (this.disposed || this.historyOpenings.get(sessionId) !== opening)
              throw new Error("cold opening disposed");
            releaseRuntime = await this.host.retainSessionRuntime?.(sessionId);
            if (this.disposed || this.historyOpenings.get(sessionId) !== opening)
              throw new Error("cold opening disposed");
            const restored = await this.coldResume.ensureResumed(
              sessionId,
              thought,
              workspace,
              additionalDirectories,
              messages,
              (outcome) => {
                disposeOnFailure = outcome.disposeOnFailure;
              },
            );
            if (this.disposed || this.historyOpenings.get(sessionId) !== opening)
              throw new Error("cold opening disposed");
            const result = await this.hydratePublisher(sessionId, restored ?? messages, true);
            this.setInitialization(sessionId, result, { status: "ready", attemptId });
            this.host.onDebug?.(
              `v4 runtime ready session=${sessionId} attempt=${attemptId} runtimeReadyMs=${Math.round(performance.now() - initializationStartedAt)}`,
            );
            resolveReady(result);
          })()
            .catch(async (error: unknown) => {
              await disposeOnFailure?.();
              if (!this.disposed && this.historyOpenings.get(sessionId) === opening) {
                const result = this.publishers.get(sessionId);
                if (result)
                  this.setInitialization(sessionId, result, {
                    status: "failed",
                    attemptId,
                    reasonCode: "fault.subscribe.resumeFailed",
                    message: error instanceof Error ? error.message : String(error),
                  });
                this.host.onError?.("v4.initialize", error, { sessionId, attemptId });
              }
              rejectReady(error);
            })
            .finally(() => {
              releaseRuntime?.();
              clear();
            });
        });
      },
    };
    this.historyOpenings.set(sessionId, opening);
    return opening.history;
  }

  private setInitialization(
    sessionId: string,
    publisher: ConversationTopicPublisher,
    state: NonNullable<ConversationSnapshot["runtimeInitialization"]>,
  ): void {
    publisher.setRuntimeInitialization(state);
    const sequence = this.rawSequenceStates.get(sessionId);
    if (sequence) {
      sequence.lastTransportSeq = publisher.getSnapshot().seq;
      sequence.offset = sequence.lastTransportSeq - sequence.sourceEventSeq;
    }
    for (const connectionId of new Set(
      [...this.flushStates.values()]
        .filter((entry) => entry.sessionId === sessionId)
        .map((entry) => entry.connectionId),
    )) {
      if (!this.pausedConnections.has(connectionId)) this.flushConnection(connectionId);
    }
  }

  
  private ensureColdReadyPublisher(
    sessionId: string,
    resumeThoughtLevel?: string,
    workspace?: CfWorkspaceRef,
    additionalDirectories?: string[],
  ): Promise<ConversationTopicPublisher> {
    const existingFlight = this.readyFlights.get(sessionId);
    if (existingFlight) return existingFlight;
    const operation = Promise.resolve().then(async () => {
      const persistedMessages = await this.coldResume.ensureResumed(
        sessionId,
        resumeThoughtLevel,
        workspace,
        additionalDirectories,
      );
      return this.hydratePublisher(sessionId, persistedMessages);
    });
    this.readyFlights.set(sessionId, operation);
    const clear = () => {
      if (this.readyFlights.get(sessionId) === operation) this.readyFlights.delete(sessionId);
    };
    void operation.then(clear, clear);
    return operation;
  }

  
  private hydratePublisher(
    sessionId: string,
    persistedMessages?: MessageWithParts[],
    forceRebuild = false,
  ): Promise<ConversationTopicPublisher> {
    const existing = this.publishers.get(sessionId);
    if (!forceRebuild && existing && this.hydratedSessions.has(sessionId))
      return Promise.resolve(existing);

    const inFlight = this.hydrationInFlight.get(sessionId);
    if (inFlight) return inFlight;
    const buffer: HydrationBuffer = {
      cancelled: false,
      eventIds: new Set<string>(),
      rawEvents: [],
    };
    this.hydrationBuffers.set(sessionId, buffer);
    const hydration = this.performHydration(
      sessionId,
      buffer,
      persistedMessages,
      forceRebuild,
    ).finally(() => {
      if (this.hydrationBuffers.get(sessionId) === buffer) {
        this.hydrationBuffers.delete(sessionId);
      }
      if (this.hydrationInFlight.get(sessionId) === hydration) {
        this.hydrationInFlight.delete(sessionId);
      }
    });
    this.hydrationInFlight.set(sessionId, hydration);
    return hydration;
  }

  private async performHydration(
    sessionId: string,
    buffer: HydrationBuffer,
    persistedMessages?: MessageWithParts[],
    forceRebuild = false,
  ): Promise<ConversationTopicPublisher> {
    const existingAtStart = this.publishers.get(sessionId);
    const liveSessionAtStart = this.host.sessionExists(sessionId);
    const hydrationStartedAt = performance.now();
    this.host.onDebug?.(
      `v4 hydrate started session=${sessionId} liveSessionAtStart=${String(liveSessionAtStart)} ` +
        `existingPublisherAtStart=${String(existingAtStart !== undefined)} ` +
        `persistedMessages=${String(persistedMessages?.length ?? 0)}`,
    );
    const loaded: PersistedEventsLoadResult = this.host.loadPersistedEvents
      ? await this.host.loadPersistedEvents(sessionId, persistedMessages).catch((error) => {
          this.host.onError?.("v4.hydrate", error, {
            durationMs: Math.max(0, Math.round(performance.now() - hydrationStartedAt)),
            existingPublisherAtStart: existingAtStart !== undefined,
            liveSessionAtStart,
            phase: "loadPersistedEvents",
            persistedMessages: persistedMessages?.length ?? 0,
            sessionId,
          });
          if (this.historyOpenings.has(sessionId)) throw error;
          return { events: [] as SessionEvent[], synthesized: false, sourceEventSeq: 0 };
        })
      : { events: [] as SessionEvent[], synthesized: false, sourceEventSeq: 0 };

    this.host.onDebug?.(
      `v4 hydrate loaded session=${sessionId} events=${loaded.events.length} ` +
        `synthesized=${String(loaded.synthesized)} sourceEventSeq=${String(loaded.sourceEventSeq ?? 0)} ` +
        `durationMs=${String(Math.max(0, Math.round(performance.now() - hydrationStartedAt)))}`,
    );

    if (this.disposed || buffer.cancelled) {
      throw new Error(`v4 hydration cancelled for session ${sessionId}`);
    }

    const latestPublisher = this.publishers.get(sessionId);
    const existingDroppedContent =
      latestPublisher !== undefined && latestPublisher.getDroppedContentStreamEventCount() > 0;
    if (
      existingAtStart &&
      latestPublisher === existingAtStart &&
      !loaded.synthesized &&
      !forceRebuild &&
      !existingDroppedContent
    ) {
      this.hydrationBuffers.delete(sessionId);
      this.seedPublisherConfig(sessionId, latestPublisher);
      if (loaded.sharedContextImport) {
        latestPublisher.seedSharedContextImport(loaded.sharedContextImport);
      }
      await this.seedPublisherUsage(
        sessionId,
        latestPublisher,
        persistedMessages,
        loaded.usageSeed,
      );
      this.hydratedSessions.add(sessionId);
      this.publishCurrentSummaryToIndex(sessionId);
      return latestPublisher;
    }

    const publisher = latestPublisher ?? existingAtStart ?? this.ensurePublisher(sessionId);
    this.rejectProjectionEventWaiters(
      sessionId,
      new ProjectionEventCommitWaitError(
        "fault.projectionEventCommit.rehydrated",
        `conversation projection rehydrated while waiting for event commit: ${sessionId}`,
      ),
    );
    publisher.rehydrate(loaded.events, {
      onPayloadTooLarge: (error) =>
        this.host.onError?.("v4.hydrate.payloadTooLarge", error, {
          phase: "publisher.rehydrate",
          sessionId,
        }),
    });
    if (loaded.sharedContextImport) {
      publisher.seedSharedContextImport(loaded.sharedContextImport);
    }
    if (loaded.subagentsSeed) publisher.seedSubagents(loaded.subagentsSeed);
    if (loaded.usageSeed) publisher.seedUsage(loaded.usageSeed);
    const sourceEventSeq = Math.max(
      0,
      loaded.sourceEventSeq ??
        (loaded.synthesized
          ? 0
          : loaded.events.reduce((maximum, event) => Math.max(maximum, event.sequenceNumber), 0)),
    );
    const previousSequenceState = this.rawSequenceStates.get(sessionId);
    const sequenceState: RawSequenceState = {
      sourceEventSeq,
      offset: publisher.getSnapshot().seq - sourceEventSeq,
      lastTransportSeq: publisher.getSnapshot().seq,
      seenEventIds: new Set(loaded.events.map((event) => String(event.id))),
      appliedEventIds: new Set(loaded.events.map((event) => String(event.id))),
      failedEventById: new Map(previousSequenceState?.failedEventById),
      pendingByRawSeq: new Map(),
      recentRawEventsById: new Map(),
    };
    this.rawSequenceStates.set(sessionId, sequenceState);
    const replayByEventId = new Map<string, SessionEvent>();
    for (const rawEvent of previousSequenceState?.recentRawEventsById.values() ?? []) {
      if (rawEvent.sequenceNumber <= 0 || rawEvent.sequenceNumber > sourceEventSeq) {
        replayByEventId.set(String(rawEvent.id), rawEvent);
      }
    }
    for (const rawEvent of buffer.rawEvents) {
      if (rawEvent.sequenceNumber <= 0 || rawEvent.sequenceNumber > sourceEventSeq) {
        replayByEventId.set(String(rawEvent.id), rawEvent);
      }
    }
    const replayEvents = [...replayByEventId.values()].sort((left, right) => {
      if (left.sequenceNumber > 0 && right.sequenceNumber > 0) {
        return left.sequenceNumber - right.sequenceNumber;
      }
      if (left.sequenceNumber > 0) return -1;
      if (right.sequenceNumber > 0) return 1;
      return 0;
    });
    for (const rawEvent of replayEvents) {
      for (const normalized of this.normalizeRuntimeEventSequence(sessionId, rawEvent)) {
        try {
          publisher.ingest(normalized);
          this.resolveProjectionEventCommit(sessionId, String(normalized.id));
        } catch (error) {
          this.rejectProjectionEventCommit(
            sessionId,
            String(normalized.id),
            new ProjectionEventCommitWaitError(
              "fault.projectionEventCommit.applyFailed",
              `projection failed to apply hydrated event ${String(normalized.id)}`,
              { cause: error },
            ),
          );
          if (!(error instanceof ProjectionPayloadTooLargeError)) throw error;
          this.host.onError?.("v4.hydrate.payloadTooLarge", error, {
            phase: "replayBufferedEvents",
            sessionId,
          });
        }
      }
    }
    if (this.hydrationBuffers.get(sessionId) === buffer) {
      this.hydrationBuffers.delete(sessionId);
    }
    this.seedPublisherConfig(sessionId, publisher);
    if (loaded.usageSeed === undefined) {
      await this.seedPublisherUsage(sessionId, publisher, persistedMessages);
    }
    for (const [routeKey, state] of this.flushStates) {
      if (state.sessionId !== sessionId) continue;
      if (!publisher.hasSubscription(state.subscriptionId, state.connectionId)) continue;
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      if (this.pausedConnections.has(state.connectionId)) continue;
      const reservation = publisher.reserveFlush(state.subscriptionId);
      if (!reservation) continue;
      try {
        this.emitReservation(reservation);
      } catch (error) {
        this.host.onError?.("v4.hydrate.subscriptionResync", error, {
          phase: "subscriptionResync",
          sessionId,
        });
        this.scheduleFlush(routeKey, state, publisher);
      }
    }
    this.hydratedSessions.add(sessionId);
    this.publishCurrentSummaryToIndex(sessionId);
    return publisher;
  }

  
  private normalizeRuntimeEventSequence(sessionId: string, event: SessionEvent): SessionEvent[] {
    const state = this.getOrCreateRawSequenceState(sessionId);
    const eventId = String(event.id);
    if (state.seenEventIds.has(eventId)) return [];

    const rawSeq = event.sequenceNumber;
    state.recentRawEventsById.set(eventId, event);
    while (state.recentRawEventsById.size > PROTOCOL_V4_LIMITS.eventRetentionPerSession) {
      const oldestEventId = state.recentRawEventsById.keys().next().value;
      if (oldestEventId === undefined) break;
      state.recentRawEventsById.delete(oldestEventId);
    }
    if (rawSeq <= 0) {
      state.seenEventIds.add(eventId);
      state.lastTransportSeq += 1;
      return [{ ...event, sequenceNumber: state.lastTransportSeq }];
    }
    if (event.type === SessionEventType.SessionResumed) {
      for (const pendingSeq of state.pendingByRawSeq.keys()) {
        if (pendingSeq <= rawSeq) state.pendingByRawSeq.delete(pendingSeq);
      }
      state.sourceEventSeq = rawSeq - 1;
      state.offset = state.lastTransportSeq - state.sourceEventSeq;
    }
    if (rawSeq <= state.sourceEventSeq) {
      state.seenEventIds.add(eventId);
      this.resolveProjectionEventCommit(sessionId, eventId);
      return [];
    }

    state.seenEventIds.add(eventId);
    if (!state.pendingByRawSeq.has(rawSeq)) state.pendingByRawSeq.set(rawSeq, event);
    const ready: SessionEvent[] = [];
    for (;;) {
      const nextRawSeq = state.sourceEventSeq + 1;
      const next = state.pendingByRawSeq.get(nextRawSeq);
      if (!next) break;
      state.pendingByRawSeq.delete(nextRawSeq);
      let transportSeq = nextRawSeq + state.offset;
      if (transportSeq <= state.lastTransportSeq) {
        transportSeq = state.lastTransportSeq + 1;
        state.offset = transportSeq - nextRawSeq;
      }
      state.sourceEventSeq = nextRawSeq;
      state.lastTransportSeq = transportSeq;
      if (state.failedEventById.has(String(next.id))) {
        continue;
      }
      ready.push(
        transportSeq === next.sequenceNumber ? next : { ...next, sequenceNumber: transportSeq },
      );
    }
    return ready;
  }

  private getOrCreateRawSequenceState(sessionId: string): RawSequenceState {
    const existing = this.rawSequenceStates.get(sessionId);
    if (existing) return existing;
    const created: RawSequenceState = {
      sourceEventSeq: 0,
      offset: 0,
      lastTransportSeq: 0,
      seenEventIds: new Set(),
      appliedEventIds: new Set(),
      failedEventById: new Map(),
      pendingByRawSeq: new Map(),
      recentRawEventsById: new Map(),
    };
    this.rawSequenceStates.set(sessionId, created);
    return created;
  }

  private resolveProjectionEventCommit(sessionId: string, eventId: string): void {
    const state = this.getOrCreateRawSequenceState(sessionId);
    state.failedEventById.delete(eventId);
    state.appliedEventIds.add(eventId);
    const waiters = this.projectionEventCommitWaiters.get(sessionId)?.get(eventId);
    if (!waiters) return;
    for (const waiter of [...waiters]) waiter.resolve();
  }

  private rejectProjectionEventCommit(sessionId: string, eventId: string, error: Error): void {
    const state = this.getOrCreateRawSequenceState(sessionId);
    state.failedEventById.set(eventId, error);
    const waiters = this.projectionEventCommitWaiters.get(sessionId)?.get(eventId);
    if (!waiters) return;
    for (const waiter of [...waiters]) waiter.reject(error);
  }

  private rejectProjectionEventWaiters(sessionId: string, error: Error): void {
    const byEvent = this.projectionEventCommitWaiters.get(sessionId);
    if (!byEvent) return;
    for (const waiters of byEvent.values()) {
      for (const waiter of [...waiters]) waiter.reject(error);
    }
    this.projectionEventCommitWaiters.delete(sessionId);
  }

  
  private hasLiveConversation(sessionId: string): boolean {
    return this.host.sessionExists(sessionId) || this.detachedLiveSessions.has(sessionId);
  }

  private async seedPublisherUsage(
    sessionId: string,
    publisher: ConversationTopicPublisher,
    persistedMessages?: MessageWithParts[],
    loadedSeed?: SessionUsageSeed | null,
  ): Promise<void> {
    if (loadedSeed !== undefined) {
      if (loadedSeed) publisher.seedUsage(loadedSeed);
      return;
    }
    const getSeed = this.host.getSessionUsageSeed;
    if (!getSeed) return;
    try {
      const seed = await getSeed.call(this.host, sessionId, persistedMessages);
      if (seed) publisher.seedUsage(seed);
    } catch (error) {
      this.host.onError?.("v4.usageSeed", error);
    }
  }

  private scheduleFlush(
    routeKey: string,
    state: FlushState,
    publisher: ConversationTopicPublisher,
  ): void {
    if (this.pausedConnections.has(state.connectionId)) return;
    if (state.timer !== null) return;
    const timer = setTimeout(() => {
      state.timer = null;
      if (this.pausedConnections.has(state.connectionId)) return;
      if (!publisher.hasSubscription(state.subscriptionId, state.connectionId)) {
        this.flushStates.delete(routeKey);
        return;
      }
      const reservation = publisher.reserveFlush(state.subscriptionId);
      if (!reservation) return;
      try {
        this.emitReservation(reservation);
      } catch (error) {
        this.host.onError?.("v4.frame.emit", error);
      }
    }, state.flushWindowMs);
    timer.unref?.();
    state.timer = timer;
  }

  private emitReservation<F extends RoutedTopicFrame>(
    reservation: TopicFrameReservation<F>,
  ): boolean {
    if (this.controlReservations.has(reservation)) return false;
    const sessionId = parseConversationTopic(reservation.frame.topic);
    const route = this.flushStates.get(
      subscriptionRouteKey(
        reservation.frame.topic,
        reservation.frame.subscriptionId,
        sessionId
          ? (this.publishers
              .get(sessionId)
              ?.connectionIdForSubscription(reservation.frame.subscriptionId) ?? "")
          : "",
      ),
    );
    if (
      sessionId &&
      route?.deliveryProfile === "continuous" &&
      reservation.deliveryKind === "online" &&
      reservation.frame.payload.kind === "deltas" &&
      this.localTtft.forSession(sessionId)
    ) {
      const rows = this.publishers.get(sessionId)?.getSnapshot().rows.window ?? [];
      const turns = new Set<string>();
      for (const delta of reservation.frame.payload.deltas) {
        if (delta.op === "row.appended" || delta.op === "row.upserted") turns.add(delta.row.turnId);
        else if (delta.op === "row.delta") {
          const row = rows.find((item) => item.rowId === delta.rowId);
          if (row) turns.add(row.turnId);
        }
      }
      const related = rows
        .filter((row) => row.kind === "turnHeader" && turns.has(row.turnId))
        .flatMap((header) =>
          header.kind === "turnHeader" && header.sourceCommandId
            ? [this.localTtft.forSession(sessionId, header.sourceCommandId)]
            : [],
        )
        .filter((facts) => facts !== undefined);
      const candidates = related.length ? related : [this.localTtft.forSession(sessionId)];
      const observations: import("@origin-ai/cf-shared").LocalTtftFacts[] = [];
      for (const facts of candidates) {
        if (!facts || observations.some((item) => item.observationId === facts.observationId))
          continue;
        const header = rows.find(
          (row) => row.kind === "turnHeader" && row.sourceCommandId === facts.commandId,
        );
        const observation = localTtftFactsSchema.safeParse({
          ...facts,
          ...(this.host.cliVersion ? { cliVersion: this.host.cliVersion } : {}),
          ...(header ? { productTurnId: header.turnId } : {}),
        });
        if (observation.success) observations.push(observation.data);
      }
      if (observations.length) {
        (reservation.frame as ConversationTopicFrame).ttft = observations[0];
        if (observations.length > 1)
          (reservation.frame as ConversationTopicFrame).ttftRelated = observations.slice(1, 17);
      }
    }
    const wires = encodeReservedTopicFrame(reservation as TopicFrameReservation<RoutedTopicFrame>);
    for (const wire of wires) this.host.emitWireFrame(wire);
    return reservation.commit();
  }

  private subscribeDispatch<F extends RoutedTopicFrame>(
    ack: SubscribeAck,
    reservation: TopicFrameReservation<F> | null,
    afterCommit?: () => void,
  ): V4SubscribeDispatchResult<F> {
    const initialWires = reservation
      ? encodeReservedTopicFrame(reservation as TopicFrameReservation<RoutedTopicFrame>)
      : [];
    if (reservation) this.controlReservations.add(reservation);
    let afterCommitRan = false;
    return {
      ack,
      initialFrame: reservation?.frame ?? null,
      initialWires,
      commit: () => {
        if (!reservation) return true;
        this.controlReservations.delete(reservation);
        const committed = reservation.commit();
        if (committed && !afterCommitRan) {
          afterCommitRan = true;
          afterCommit?.();
        }
        return committed;
      },
    };
  }
}

export class V4CommandNotImplementedError extends Error {
  constructor(type: string) {
    super(`v4 command not implemented in M3: ${type}`);
    this.name = "V4CommandNotImplementedError";
  }
}

export class V4CommandNoopError extends Error {
  constructor(
    readonly reasonCode: string,
    message?: string,
  ) {
    super(message ?? `v4 command is a no-op (${reasonCode})`);
    this.name = "V4CommandNoopError";
  }
}
