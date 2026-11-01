import type { ExecutionOutputPreview } from "../interfaces/execution.port.js";
import type { RuntimeInputPresentation } from "../interfaces/runtime-input-presentation.js";

// ============================================================
// Session Events - All event types for the agent loop
// ============================================================

import type {
  CompactBoundaryPayload,
  CompactTimelinePayload,
  MicrocompactBoundaryPayload,
} from "../compact/index.js";
import type { HookRunLifecyclePayload } from "../hooks/index.js";
import type { HttpClientEgressInfo } from "../interfaces/http-client.port.js";
import type { PermissionOptionsPolicy, PermissionUpdate } from "../interfaces/permission.port.js";
import type {
  MessageVisibility,
  SessionTitleSource,
  SyntheticUserMessageSource,
} from "../interfaces/session-store.port.js";
import type {
  CollaborationMode,
  HighspeedMessageMetadata,
  RiskLevel,
  TurnInputIntentMetadata,
  TurnSteerCommandKind,
  TurnSteerDeliveryMode,
  TurnSteerRejectReason,
  TurnSteerSource,
} from "../interfaces/session.port.js";
import type {
  EventId,
  InteractionRequestOrigin,
  MessageId,
  PartId,
  QueryId,
  SessionId,
  ToolCallId,
  TraceId,
  TurnId,
} from "../interfaces/shared.js";
import type {
  ModelNetworkStatusEvent,
  ModelSelection,
  ModelUsage,
  ModelUsageSummary,
} from "../model/index.js";
import { createModelUsageSummary } from "../model/index.js";
import type { CheckpointCreatedPayload, RewindTriggeredPayload } from "../rewind/index.js";
import type { SkillTelemetryMetadata } from "../skills/index.js";
import type { ModelApiErrorPhase, ModelFailureExceptionKind } from "../telemetry/index.js";
import type { ToolSideEffectScope } from "../tools/contract.js";
import type { SavedWorkflowScope } from "../tools/saved-workflow.js";
import type { GoalCompletionVerificationOutput, SessionGoal } from "../tools/target.js";
import type { ToolResultDisplayPayload } from "../tools/tool-result-metadata.js";
import type {
  StreamRecoveryAnchorPayload,
  StreamRecoveryAnchorSelectedPayload,
  StreamRecoveryBlockedPayload,
  StreamRecoveryRetryStartedPayload,
  StreamRecoveryStartedPayload,
  StreamRecoveryTailDiscardedPayload,
  StreamingToolLedgerPayload,
} from "./stream-recovery.events.js";

// Re-export for convenience
export type { CollaborationMode, RiskLevel } from "../interfaces/session.port.js";

// Re-export ModelToolCall as ToolCall for core usage
export type { ModelToolCall as ToolCall } from "../model/index.js";

// Base Event
export interface SessionEvent {
  id: EventId;
  sessionId: SessionId;
  turnId?: TurnId;
  type: SessionEventType;
  timestamp: Date;
  traceId: TraceId;
  sequenceNumber: number;
  payload: unknown;
}

export const SessionEventType = {
  SessionCreated: "session_created",
  SessionResumed: "session_resumed",
  SessionForked: "session_forked",
  SessionCompacted: "session_compacted",
  SessionTitleUpdated: "session_title_updated",
  SessionModeChanged: "session_mode_changed",
  SessionEnded: "session_ended",
  TurnStarted: "turn_started",
  TurnInputReceived: "turn_input_received",
  TurnSteerQueued: "turn_steer_queued",
  TurnSteerDeliveryChanged: "turn_steer_delivery_changed",
  TurnSteerDispatchChanged: "turn_steer_dispatch_changed",
  TurnSteerDrained: "turn_steer_drained",
  TurnSteerRejected: "turn_steer_rejected",
  TurnSteerDiscarded: "turn_steer_discarded",
  SessionInputPromoted: "session_input_promoted",
  TurnSteerReordered: "turn_steer_reordered",
  QueueAutoDrainChanged: "queue_auto_drain_changed",
  FollowupModeChanged: "followup_mode_changed",
  TurnComplete: "turn_complete",
  TurnError: "turn_error",
  UserMessage: "user_message",
  AssistantMessage: "assistant_message",
  AssistantFeedbackUpdated: "assistant_feedback_updated",
  HighspeedMetricsUpdated: "highspeed_metrics_updated",
  SystemMessage: "system_message",
  ModelRequest: "model_request",
  ModelSelected: "model_selected",
  TurnExecutionModelFallback: "turn_execution_model_fallback",
  ModelStreaming: "model_streaming",
  StreamingToolLedgerUpdated: "streaming_tool_ledger_updated",
  StreamRecoveryAnchorCreated: "stream_recovery_anchor_created",
  StreamRecoveryStarted: "stream_recovery_started",
  StreamRecoveryAnchorSelected: "stream_recovery_anchor_selected",
  StreamRecoveryTailDiscarded: "stream_recovery_tail_discarded",
  StreamRecoveryRetryStarted: "stream_recovery_retry_started",
  StreamRecoveryBlocked: "stream_recovery_blocked",
  ModelNetworkStatus: "model_network_status",
  ModelAnomalyWarning: "model_anomaly_warning",
  NetworkRequestStatus: "network_request_status",
  ModelComplete: "model_complete",
  ModelError: "model_error",
  ToolCallScheduled: "tool_call_scheduled",
  ToolCallStarted: "tool_call_started",
  ToolCallProgress: "tool_call_progress",
  ToolCallResult: "tool_call_result",
  ToolCallError: "tool_call_error",
  ToolBatchComplete: "tool_batch_complete",
  BackgroundTaskStarted: "background_task_started",
  BackgroundTaskUpdated: "background_task_updated",
  BackgroundTaskCompleted: "background_task_completed",
  DynamicWorkflowRunProgress: "dynamic_workflow_run_progress",
  PermissionRequested: "permission_requested",
  PermissionResolved: "permission_resolved",
  PermissionDenied: "permission_denied",
  PluginUiResourceUpdated: "plugin_ui_resource_updated",
  PluginUiResourceListChanged: "plugin_ui_resource_list_changed",
  
  PluginUiInstanceClosed: "plugin_ui_instance_closed",
  PluginUiAppToolCallRequested: "plugin_ui_app_tool_call_requested",
  UserInputAutoResolutionUpdated: "user_input_auto_resolution_updated",
  WorkspaceHookReviewRequested: "workspace_hook_review_requested",
  WorkspaceHookReviewSettled: "workspace_hook_review_settled",
  WorkspaceHookReviewSuperseded: "workspace_hook_review_superseded",
  WorkspaceHookAdmissionUpdated: "workspace_hook_admission_updated",
  HookRunStarted: "hook_run_started",
  HookRunProgress: "hook_run_progress",
  HookRunCompleted: "hook_run_completed",
  HookRunFailed: "hook_run_failed",
  HookRunBlocked: "hook_run_blocked",
  CompactStarted: "compact_started",
  CompactCompleted: "compact_completed",
  CompactFailed: "compact_failed",
  CompactBoundary: "compact_boundary",
  MicrocompactBoundary: "microcompact_boundary",
  RewindTriggered: "rewind_triggered",
  CheckpointCreated: "checkpoint_created",
  TargetChanged: "target_changed",
  TargetCompletionVerification: "target_completion_verification",
  SubagentSpawned: "subagent_spawned",
  SubagentMessage: "subagent_message",
  SubagentStopped: "subagent_stopped",
  Interrupt: "interrupt",
  Cancel: "cancel",
  Resume: "resume",
  Error: "error",
} as const;

export type SessionEventType = (typeof SessionEventType)[keyof typeof SessionEventType];

// -----------------------------------------------
// Event Payloads
// -----------------------------------------------

export interface SessionCreatedPayload {
  planEnabled?: boolean;
  mode: CollaborationMode;
  contextWindow: number;
}

export interface SessionResumedPayload {
  directory: string;
  interruptedToolCount: number;
  messageCount: number;
  partCount: number;
  recoveredCompactTimelineCount?: number;
  recoveredSteerInputCount?: number;
  resumedTodoCount?: number;
}

export interface SessionForkedPayload {
  forkedSessionId?: SessionId;
  originalSessionId: SessionId;
  restoredFileCount?: number;
  restoredSnapshotRef?: string;
  strategy?: "fork_required";
  targetCheckpointId?: string;
  targetMessageId?: MessageId;
  /** @deprecated Use targetMessageId for message-level forks. */
  forkPoint: number;
}

export interface SessionCompactedPayload {
  compactBoundary: CompactBoundaryPayload;
  summary?: string;
  preservedEventCount?: number;
  removedEventCount?: number;
}

export type CompactLifecyclePayload = CompactTimelinePayload;

export type MicrocompactBoundaryEventPayload = MicrocompactBoundaryPayload;

export interface TurnAttachmentMeta {
  fileName: string;
  mime: string;
  bytes: number;
  
  ref?: string;
}

export type WorkflowNotificationMeta =
  | {
      kind: "terminal";
      status: "completed" | "errored" | "stopped";
      
      stopReason?: "user" | "model" | "provider" | "interrupted" | "superseded";
      summary: string;
      result?: string;
      resultForm?: "prose" | "json";
      resultTruncated?: true;
      error?: string;
      reports?: { count: number; shown: number; preview: string[] };
      
      artifacts?: {
        id: string;
        kind: "file" | "markdown" | "chart" | "table" | "metrics" | "board";
        title?: string;
        version: number;
        contentType?: string;
        
        primary?: true;
        description?: string;
      }[];
      artifactsTruncated?: true;
      durationMs?: number;
    }
  | {
      kind: "escalation";
      qid: string;
      actor: string;
      question: string;
      context?: string;
      askedAt?: number;
    }
  
  | {
      kind: "hole";
      siteId: string;
      ordinal: number;
      name: string;
      type: string;
      prompt?: string;
      draftPath?: string;
      line?: number;
      before?: string;
      after?: string;
      reachedAt?: number;
    }
  
  | {
      kind: "stall";
      sinceMs: number;
      reason?: string;
      cap?: number;
    };

export interface WorkflowBlockedMeta {
  questions: number;
  holes: number;
  sinceMs: number;
}

export interface BackgroundResultOriginMeta {
  
  backgroundSource: "bash" | "subagent" | "workflow";
  workId: string;
  title: string;
  
  workflowNotification?: WorkflowNotificationMeta;
  
  workflowBlocked?: WorkflowBlockedMeta;
}

export type TurnExecutionKind = "agent" | "controlOnly";

export type OffPeakRunType = "init" | "resume";

export type TurnBackgroundAttribution =
  | { automationId: string; offPeakTaskId?: never; offPeakRunType?: never }
  | {
      offPeakTaskId: string;
      offPeakRunType?: OffPeakRunType;
      automationId?: never;
    }
  | {
      automationId?: undefined;
      offPeakTaskId?: undefined;
      offPeakRunType?: never;
    };

export type WorkflowLaunchDisplay = Extract<ToolResultDisplayPayload, { kind: "create_workflow" }>;

export interface WorkflowSettingsAmendMeta {
  
  predecessorRunId?: string;
  subagentModel?: { from?: string; to?: string };
  maxConcurrency?: { from?: number; to?: number };
  ceiling?: number;
}

export interface WorkflowLaunchMeta {
  
  runId: string;
  
  toolCallId: string;
  
  name?: string;
  
  scope?: SavedWorkflowScope;
  
  path?: string;
  
  args?: Record<string, unknown>;
  
  description?: string;
  
  display?: WorkflowLaunchDisplay;
  
  script?: string;
  
  amend?: WorkflowSettingsAmendMeta;
}

export const WORKFLOW_LAUNCH_ARGS_MAX_BYTES = 4_096;

export const WORKFLOW_LAUNCH_DESCRIPTION_MAX_CHARS = 500;

export const WORKFLOW_LAUNCH_SCRIPT_MAX_CHARS = 256_000;

export const WORKFLOW_LAUNCH_ARGS_TRUNCATED_KEY = "…";

export function boundWorkflowLaunchMeta(input: WorkflowLaunchMeta): WorkflowLaunchMeta {
  const bounded: WorkflowLaunchMeta = {
    runId: input.runId,
    toolCallId: input.toolCallId,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    ...(input.path === undefined ? {} : { path: input.path }),
  };
  if (input.args !== undefined) {
    const serialized = JSON.stringify(input.args);
    const bytes = serialized === undefined ? 0 : Buffer.byteLength(serialized, "utf8");
    bounded.args =
      bytes > WORKFLOW_LAUNCH_ARGS_MAX_BYTES
        ? { [WORKFLOW_LAUNCH_ARGS_TRUNCATED_KEY]: `arguments omitted (${bytes} bytes)` }
        : input.args;
  }
  if (input.description !== undefined) {
    bounded.description =
      input.description.length > WORKFLOW_LAUNCH_DESCRIPTION_MAX_CHARS
        ? `${input.description.slice(0, WORKFLOW_LAUNCH_DESCRIPTION_MAX_CHARS - 1)}…`
        : input.description;
  }
  if (input.display !== undefined) bounded.display = input.display;
  if (input.script !== undefined && input.script.length <= WORKFLOW_LAUNCH_SCRIPT_MAX_CHARS) {
    bounded.script = input.script;
  }
  if (input.amend !== undefined) bounded.amend = input.amend;
  return bounded;
}

export interface TurnStartedPayloadBase {
  
  executionStartedAt?: number;
  turnNumber: number;
  input: string;
  
  messageId?: MessageId;
  inputId?: string;
  
  
  foregroundExecutionId?: string;
  queryId?: QueryId;
  inputSource?: SyntheticUserMessageSource;
  inputVisibility?: MessageVisibility;
  
  workflowLaunch?: WorkflowLaunchMeta;
  
  executionKind?: TurnExecutionKind;
  
  epilogueStart?: number;
  
  originMeta?: BackgroundResultOriginMeta;
  
  backgroundSource?: BackgroundResultOriginMeta["backgroundSource"];
  targetId?: string;
  
  attachments?: TurnAttachmentMeta[];
  
  intent?: TurnInputIntentMetadata;
}

export type TurnStartedPayload = TurnStartedPayloadBase & TurnBackgroundAttribution;

export interface TurnInputReceivedPayload {
  input: string;
  attachments?: Attachment[];
}

export interface TurnSteerQueuedPayload {
  pendingInputId: string;
  inputId?: string;
  queryId?: QueryId;
  input: string;
  inputPreview: string;
  inputSize: number;
  commandKind?: TurnSteerCommandKind;
  source?: TurnSteerSource;
  inputPresentation?: RuntimeInputPresentation;
  
  toolDisallowlist?: readonly string[];
  
  delivery?: TurnSteerDeliveryMode;
  targetTurnId: TurnId;
  queueLength: number;
  intent?: TurnInputIntentMetadata;
}

export interface TurnSteerDeliveryChangedPayload {
  pendingInputId: string;
  targetTurnId: TurnId;
  requestedDelivery: "guide";
  admittedDelivery: "queue";
  fallbackReasonCode: string;
  
  intent?: TurnInputIntentMetadata;
}

export interface TurnSteerReorderedPayload {
  orderedPendingInputIds: string[];
  targetTurnId: TurnId;
}

export interface TurnSteerDispatchChangedPayload {
  pendingInputId: string;
  reservationId?: string;
  state: "queued" | "reserved" | "promoting";
  targetTurnId: TurnId;
}

export interface QueueAutoDrainChangedPayload {
  autoDrain: boolean;
}

export interface FollowupModeChangedPayload {
  mode: "queue" | "guide";
}

export interface TurnSteerDrainedPayload {
  pendingInputIds: string[];
  queryIds?: QueryId[];
  targetTurnId: TurnId;
  injectedMessageIds: MessageId[];
  
  drainedInputs?: Array<{
    pendingInputId: string;
    messageId: MessageId;
    text: string;
    delivery?: TurnSteerDeliveryMode;
    intent?: TurnInputIntentMetadata;
    toolDisallowlist?: readonly string[];
  }>;
}

export interface TurnSteerRejectedPayload {
  reason: TurnSteerRejectReason;
  activeTurnId?: TurnId;
  expectedTurnId?: TurnId;
  inputPreview?: string;
  inputSize?: number;
}

export interface TurnSteerDiscardedPayload {
  pendingInputIds: string[];
  targetTurnId: TurnId;
  reason: "turn_cancelled" | "turn_failed" | "session_resumed" | "user_removed" | "promoted";
}

export interface SessionInputPromotedPayload {
  pendingInputId: string;
  sourceCommandId: string;
  messageId: MessageId;
}

export interface TurnCompletePayload {
  response: string;
  tokenCount: number;
  usage?: ModelUsageSummary;
  toolCallCount: number;
  
  historyRoundCount?: number;
  duration: number;
  inputId?: string;
  resultType: TurnResultType;
  
  backgroundSubagentResultConsumed?: boolean;
  
  workflowResultConsumed?: boolean;
  
  preserveQueueAutoDrainOnCancel?: boolean;
}

export interface TurnErrorPayload {
  error: ErrorPayload;
  turnPhase: string;
  inputId?: string;
  
  backgroundSubagentResultConsumed?: boolean;
  
  workflowResultConsumed?: boolean;
}

export type TurnResultType =
  | "success"
  | "cancelled"
  | "error_max_turns"
  | "error_max_budget"
  | "error_during_execution"
  | "error_max_tool_calls";

export interface UserMessagePayload {
  content: string;
  attachments?: Attachment[];
}

export interface AssistantMessagePayload {
  content: string;
  toolCalls?: ToolCallPayload[];
}

export interface AssistantFeedbackUpdatedPayload {
  entityId: string;
  feedback: "like" | "dislike" | null;
}

export interface HighspeedMetricsUpdatedPayload {
  entityId: string;
  highspeed: HighspeedMessageMetadata;
}

export interface SystemMessagePayload {
  type: "init" | "compact_boundary" | "interrupted";
  content: string;
  compactBoundary?: CompactBoundaryPayload;
}

export interface SessionTitleUpdatedPayload {
  messageID?: MessageId;
  previousTitle: string;
  source: SessionTitleSource;
  title: string;
}

export interface SessionModeChangedPayload {
  permissionGrant?: { interactionId: string; queueItemIds: string[] };
  planEnabled?: boolean;
  previousPlanEnabled?: boolean;
  mode: CollaborationMode;
  previousMode: CollaborationMode;
  source: "tool" | "command" | "system";
  toolCallId?: ToolCallId;
}

export type TargetCompletionVerificationStatus =
  | "started"
  | "completed"
  | "failed_closed"
  | "cancelled";

export interface TargetCompletionVerificationPayload {
  targetId: string;
  status: TargetCompletionVerificationStatus;
  verificationId: string;
  
  foregroundExecutionId?: string;
  
  preserveQueueAutoDrainOnCancel?: boolean;
  verification?: GoalCompletionVerificationOutput;
  goalIteration?: number;
  anchorAssistantMessageId?: MessageId;
  anchorTurnId?: TurnId;
}

export interface ModelRequestPayload {
  messages: ModelMessage[];
  providerId: string;
  modelId: string;
  querySource?: string;
  temperature?: number;
  maxTokens?: number;
}

export type ModelSelectionOrigin = "registryFallback";

export interface ModelSelectedPayload {
  modelSelection: ModelSelection;
  
  effectiveReasoningLevel?: string;
  
  previousModelSelection?: ModelSelection | null;
  
  origin?: ModelSelectionOrigin;
  
  supportedThoughtLevels?: string[];
  
  contextWindow?: number | null;
}

export type TurnExecutionModelFallbackReason =
  | "highspeed_card_expired"
  | "highspeed_request_failed"
  | "highspeed_selection_unavailable";

export interface TurnExecutionModelFallbackPayload {
  inputId?: string;
  reason: TurnExecutionModelFallbackReason;
  
  fromModelSelection: ModelSelection;
  toModelSelection: ModelSelection;
}

export type ModelStreamingKind =
  | "start"
  | "text_start"
  | "text_delta"
  | "text_end"
  | "reasoning_start"
  | "reasoning_delta"
  | "reasoning_end"
  | "tool_input_start"
  | "tool_input_delta"
  | "tool_input_end"
  | "tool_call"
  | "finish"
  | "error";

export interface ModelStreamingPayload {
  delta: string;
  done: boolean;
  kind?: ModelStreamingKind;
  assistantMessageId?: MessageId;
  partId?: PartId;
  toolCallId?: ToolCallId;
  toolName?: string;
  input?: unknown;
  providerExecuted?: boolean;
}

export type ModelNetworkStatusPayload = ModelNetworkStatusEvent;

export type ModelAnomalyWarningCategory =
  | "tool_call_budget"
  | "repeated_tool_call"
  | "provider_finish_mismatch"
  | "malformed_tool_call";

export type ModelAnomalyWarningSeverity = "info" | "warning";

export interface ModelAnomalyWarningPayload {
  category: ModelAnomalyWarningCategory;
  severity: ModelAnomalyWarningSeverity;
  observedCount?: number;
  threshold?: number;
  toolName?: string;
  toolCallId?: ToolCallId;
  warningInjected: boolean;
  modelVisibleMessageId?: MessageId;
}

export type NetworkRequestSource = "http_client" | "model" | "tool" | "mcp" | "plugin" | "unknown";

export type NetworkRequestLifecycleStatus = "pending" | "complete" | "error";

export interface NetworkRequestStatusPayload {
  requestId: string;
  source: NetworkRequestSource;
  status: NetworkRequestLifecycleStatus;
  method: string;
  url: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  statusCode?: number;
  error?: string;
  toolCallId?: ToolCallId | string;
  toolName?: string;
  attempt?: number;
  egress?: HttpClientEgressInfo;
}

export interface ModelCompletePayload {
  cacheHit?: {
    inputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    latestHitRate: number | null;
    hitRate: number | null;
    hitRateRequestCount: number;
    totalInputTokens: number;
    totalCacheReadTokens: number;
    totalCacheWriteTokens: number;
  };
  content: string;
  contextUsageBreakdown?: ContextUsageBreakdownItem[];
  contextWindow?: number;
  fileChanges?: TurnFileChangeSummary;
  querySource?: string;
  stopReason: string;
  
  toolCallCount?: number;
  usage: TokenUsage | ModelUsage;
}

export interface TurnFileChangeSummary {
  additions: number;
  deletions: number;
  files: number;
  items: TurnFileChangeSummaryItem[];
}

export interface TurnFileChangeSummaryItem {
  additions: number;
  deletions: number;
  path: string;
  toolNames?: string[];
  writeCount: number;
}

export type ContextUsageBreakdownSource =
  | "system_prompt"
  | "meta_user_context"
  | "skills"
  | "tool_prompt"
  | "system_tool_schemas"
  | "mcp_tool_schemas"
  | "messages";

export interface ContextUsageBreakdownItem {
  source: ContextUsageBreakdownSource;
  chars: number;
}

export interface ModelErrorPayload {
  error: ErrorPayload;
  retryable: boolean;
}

export interface ToolCallScheduledPayload {
  toolCallId: ToolCallId;
  assistantMessageId?: MessageId;
  toolName: string;
  input: unknown;
  dependencies?: ToolCallId[];
  parallelGroupIndex?: number;
  canRunParallel?: boolean;
  display?: ToolResultDisplayPayload;
  schedule: ToolSchedulePayload;
}

export interface ToolCallStartedPayload {
  toolCallId: ToolCallId;
  toolName?: string;
  startedAt: Date;
  display?: ToolResultDisplayPayload;
  
  readOnly?: boolean;
  sideEffectScope?: ToolSideEffectScope;
}

export interface ToolCallProgressPayload {
  toolCallId: ToolCallId;
  toolName?: string;
  elapsedMs?: number;
  
  progress?: number;
  total?: number;
  message?: string;
  pid?: number;
  stdoutBytes?: number;
  stderrBytes?: number;
  outputBytes?: number;
  outputPreview?: ExecutionOutputPreview;
  stdoutTail?: string;
  stderrTail?: string;
}

export interface ToolCallResultPayload {
  toolCallId: ToolCallId;
  result: ToolResultPayload;
  duration: number;
  
  skillMetadata?: SkillTelemetryMetadata;
  
  pluginId?: string;
}

export interface ToolCallErrorPayload {
  toolCallId: ToolCallId;
  error: ErrorPayload;
  
  skillMetadata?: SkillTelemetryMetadata;
  
  pluginId?: string;
}

export interface ToolBatchCompletePayload {
  toolCallIds: ToolCallId[];
  successCount: number;
  errorCount: number;
}

export type BackgroundTaskStatus =
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "spawn_error"
  | "lost";

export interface BackgroundTaskPayloadBase {
  taskId: string;
  toolCallId?: ToolCallId | string;
  toolName?: string;
  taskKind?: "bash" | "subagent" | "workflow";
  childSessionId?: SessionId | string;
  blocked?: boolean;
  blockedReason?: "interactive_prompt_detected" | "no_output_progress" | string;
  cancellable?: boolean;
  cancelRequestedAt?: Date;
  command?: string;
  description?: string;
  status: BackgroundTaskStatus;
  pid?: number;
  startedAt?: Date;
  completedAt?: Date;
  outputPath?: string;
  stderrPersistedOutputPath?: string;
  stdoutPersistedOutputPath?: string;
  outputBytes?: number;
  outputTruncated?: boolean;
  outputTail?: string;
  stderrBytes?: number;
  stderrTail?: string;
  stdoutBytes?: number;
  stdoutTail?: string;
  terminalId?: string;
}

export type BackgroundTaskStartedPayload = BackgroundTaskPayloadBase & {
  status: "running";
};

export type BackgroundTaskUpdatedPayload = BackgroundTaskPayloadBase;

export type BackgroundTaskCompletedPayload = BackgroundTaskPayloadBase & {
  status: Exclude<BackgroundTaskStatus, "running">;
};

export interface DynamicWorkflowRunProgressPayload {
  runId: string;
  
  toolCallId?: ToolCallId | string;
  
  sequence: number;
  
  eventType: string;
  payload: Record<string, unknown>;
  truncated?: boolean;
  
  actorSessionId?: string;
  
  launchInputId?: string;
}

export interface PermissionRequestedPayload {
  approvalMode?: "user-once";
  requestId?: string;
  toolCallId: ToolCallId;
  toolName: string;
  riskLevel: RiskLevel;
  reason: string;
  input: unknown;
  suggestedPermissionUpdates?: PermissionUpdate[];
  origin?: InteractionRequestOrigin;
  
  display?: ToolResultDisplayPayload;
  fullAccessSupported?: boolean;
  optionsPolicy?: PermissionOptionsPolicy;
}

export interface PluginUiResourceSubscriberRef {
  instance: import("@origin-ai/cf-shared/mcp-apps").McpAppInstance;
  scopeId: string;
  generation: number;
}
export interface PluginUiResourceUpdatedPayload {
  pluginId: string;
  serverName: string;
  uri: string;
  subscribers: PluginUiResourceSubscriberRef[];
}
export interface PluginUiResourceListChangedPayload {
  pluginId: string;
  serverName: string;
  subscribers: PluginUiResourceSubscriberRef[];
}

export interface PluginUiAppToolCallRequestedPayload {
  activity?: boolean;
  cancelled?: boolean;
  pluginId: string;
  serverName: string;
  subscribers: PluginUiResourceSubscriberRef[];
  callId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface PermissionResolvedPayload {
  requestId?: string;
  toolCallId: ToolCallId;
  decision: PermissionDecision;
  reason?: string;
  modifiedInput?: unknown;
}

export interface PermissionDeniedPayload {
  toolCallId: ToolCallId;
  toolName: string;
  reason: string;
  inputSummary?: unknown;
}

export type UserInputAutoResolutionState =
  | {
      state: "hiddenGrace" | "visibleCountdown";
      startedAt: number;
      visibleAt: number;
      deadlineAt: number;
    }
  | {
      state: "snoozed";
      startedAt: number;
      snoozedAt: number;
    };

export interface UserInputAutoResolutionUpdatedPayload {
  interactionId: string;
  toolCallId: ToolCallId;
  autoResolution: UserInputAutoResolutionState;
}

export interface WorkspaceHookReviewRequestedPayload {
  request: unknown;
}

export interface WorkspaceHookReviewSettledPayload {
  interactionId: string;
  state: "resolved" | "timed_out" | "configuration_error";
  reasonCode?: string;
}

export interface WorkspaceHookReviewSupersededPayload {
  interactionId: string;
  supersededByInteractionId: string;
}

export interface WorkspaceHookAdmissionUpdatedPayload {
  pendingCount: number;
  bundleDigest: string;
  workspaceIdentity?: string;
}

export type PermissionDecision = "allow" | "deny" | "escalate" | "modify";

export type TargetChangedAction =
  | "set"
  | "status_updated"
  | "cleared"
  | "usage_accounted"
  | "run_started"
  | "run_finished"
  | "summary_updated";

export type TargetChangedSource = "command" | "tool" | "runtime";

export interface TargetChangedPayload {
  action: TargetChangedAction;
  source: TargetChangedSource;
  target: SessionGoal | null;
  previousTarget?: SessionGoal | null;
}

// -----------------------------------------------
// Supporting Types
// -----------------------------------------------

export interface Attachment {
  type: "file" | "image" | "pdf" | "url";
  path?: string;
  content?: string;
  mimeType?: string;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCallPayload[];
  toolCallId?: string;
}

export interface ToolCallPayload {
  id: ToolCallId;
  name: string;
  input: unknown;
}

export interface ToolResultPayload {
  success: boolean;
  content: string;
  display?: ToolResultDisplayPayload;
  perf?: import("../tools/performance.js").ToolExecutionTelemetry;
  error?: ErrorPayload;
  truncated?: boolean;
  originalBytes?: number;
  returnedBytes?: number;
  budgetStrategy?: string;
  artifactPath?: string;
}

export interface ToolSchedulePayload {
  parallelGroups: ToolCallId[][];
  executionOrder: ToolCallId[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheTokens?: number;
}

export interface ErrorPayload {
  code?: string;
  detail?: string;
  
  underlyingErrorMessage?: string;
  
  underlyingErrorDetail?: string;
  type: string;
  message: string;
  attribution?: ErrorAttribution;
  retryable?: boolean;
  stack?: string;
  data?: unknown;
}

export interface ErrorAttribution {
  source?: "provider" | "runtime" | "tool" | "network";
  reason?: string;
  errorPhase?: ModelApiErrorPhase;
  exceptionKind?: ModelFailureExceptionKind;
  providerId?: string;
  modelId?: string;
  providerKind?: string;
  transport?: "http" | "sse" | "websocket";
  statusCode?: number;
  providerErrorCode?: string;
  retryable?: boolean;
  
  highspeedCardId?: string | null;
  
  highspeedFallbackUnavailable?: boolean;
}

// CollaborationMode and RiskLevel are re-exported from ports

// -----------------------------------------------
// Event Factory
// -----------------------------------------------

export function createSessionEvent<T>(
  type: SessionEventType,
  sessionId: SessionId,
  payload: T,
  options?: {
    turnId?: TurnId;
    traceId?: TraceId;
    sequenceNumber?: number;
  },
): SessionEvent {
  return {
    id: crypto.randomUUID() as EventId,
    sessionId,
    turnId: options?.turnId,
    type,
    timestamp: new Date(),
    traceId: options?.traceId ?? (crypto.randomUUID() as TraceId),
    sequenceNumber: options?.sequenceNumber ?? 0,
    payload,
  };
}

export function createModelUsageSummaryFromEvents(
  events: readonly SessionEvent[],
): ModelUsageSummary | undefined {
  const usages: ModelUsage[] = [];

  for (const event of events) {
    if (event.type === SessionEventType.ModelNetworkStatus) {
      const payload = event.payload as ModelNetworkStatusEvent;
      if (payload.type === "model_request_failed" && payload.usage) usages.push(payload.usage);
    }
    if (event.type !== SessionEventType.ModelComplete) continue;
    const payload = event.payload as Partial<ModelCompletePayload>;
    if (payload.usage) {
      usages.push(payload.usage as ModelUsage);
    }
  }

  return createModelUsageSummary(usages);
}

export type SessionEventPayload =
  | SessionCreatedPayload
  | SessionResumedPayload
  | SessionForkedPayload
  | SessionCompactedPayload
  | SessionTitleUpdatedPayload
  | SessionModeChangedPayload
  | TurnStartedPayload
  | TurnInputReceivedPayload
  | TurnSteerQueuedPayload
  | TurnSteerDeliveryChangedPayload
  | TurnSteerDispatchChangedPayload
  | TurnSteerDrainedPayload
  | TurnSteerReorderedPayload
  | QueueAutoDrainChangedPayload
  | FollowupModeChangedPayload
  | TurnSteerRejectedPayload
  | TurnSteerDiscardedPayload
  | SessionInputPromotedPayload
  | TurnCompletePayload
  | TurnErrorPayload
  | UserMessagePayload
  | AssistantMessagePayload
  | SystemMessagePayload
  | ModelRequestPayload
  | ModelSelectedPayload
  | TurnExecutionModelFallbackPayload
  | ModelStreamingPayload
  | StreamingToolLedgerPayload
  | StreamRecoveryAnchorPayload
  | StreamRecoveryStartedPayload
  | StreamRecoveryAnchorSelectedPayload
  | StreamRecoveryTailDiscardedPayload
  | StreamRecoveryRetryStartedPayload
  | StreamRecoveryBlockedPayload
  | ModelNetworkStatusPayload
  | ModelAnomalyWarningPayload
  | NetworkRequestStatusPayload
  | ModelCompletePayload
  | TargetCompletionVerificationPayload
  | ModelErrorPayload
  | ToolCallScheduledPayload
  | ToolCallStartedPayload
  | ToolCallProgressPayload
  | ToolCallResultPayload
  | ToolCallErrorPayload
  | ToolBatchCompletePayload
  | BackgroundTaskStartedPayload
  | BackgroundTaskUpdatedPayload
  | BackgroundTaskCompletedPayload
  | DynamicWorkflowRunProgressPayload
  | PermissionRequestedPayload
  | PermissionResolvedPayload
  | PermissionDeniedPayload
  | PluginUiResourceUpdatedPayload
  | PluginUiResourceListChangedPayload
  | PluginUiAppToolCallRequestedPayload
  | UserInputAutoResolutionUpdatedPayload
  | WorkspaceHookReviewRequestedPayload
  | WorkspaceHookReviewSettledPayload
  | WorkspaceHookReviewSupersededPayload
  | WorkspaceHookAdmissionUpdatedPayload
  | HookRunLifecyclePayload
  | CompactLifecyclePayload
  | MicrocompactBoundaryEventPayload
  | CheckpointCreatedPayload
  | RewindTriggeredPayload
  | CompactBoundaryPayload;
