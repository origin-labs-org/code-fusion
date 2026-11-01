
// CfStreamEvent / TraceId/InputId/QueryId / CfPersistedMessage(Part) / CfTaskSnapshot /

import type { CfBackgroundTaskControlItem } from "./background-task-controls.js";
import type { ToolCallDisplay } from "./cf-protocol-v4/toolDisplay.js";
import type {
  CfContextUsageBreakdownItem,
  CfInteractionRequestOrigin,
  CfPermissionResponse,
  CfSessionActiveTurnKind,
} from "./cf-protocol-legacy-types.js";
import type { ErrorAttribution } from "./cf-protocol-v4/snapshot.js";

export type TraceId = string;

export type InputId = string;

export type QueryId = string;
// ---- CodeFusion Provider ----

export type CfProvider = "glm";
export type CfGlmAgentModelStateUpdateReason =
  | "session_initialized"
  | "model_changed"
  | "thought_level_changed";
export interface CfGlmAgentModelStateOption {
  value: string;
  name: string;
}
export interface CfGlmAgentModelStateUpdatePayload {
  version: 1;
  sessionId: string;
  reason: CfGlmAgentModelStateUpdateReason;
  model: {
    currentValue: string;
  };
  thoughtLevel: {
    enabled: boolean;
    currentValue?: string;
    options: CfGlmAgentModelStateOption[];
  };
  contextWindow: {
    tokens: number;
  };
}

export type CfTaskMigrationSource = "claudeCode";
export type CfTaskGoalStatus = "active" | "paused" | "budget_limited" | "complete";
export type CfTaskTargetChangedAction =
  | "set"
  | "status_updated"
  | "cleared"
  | "usage_accounted"
  | "run_started"
  | "run_finished"
  | "summary_updated";
export type CfTaskTargetChangedSource = "command" | "tool" | "runtime";
export interface CfTaskGoal {
  sessionID: string;
  targetID: string;
  objective: string;
  summaryTitle: string | null;
  status: CfTaskGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  activeInputId?: string | null;
  activeRunStartedAtMs?: number | null;
  activeRunLastSeenAtMs?: number | null;
  time: {
    created: number;
    updated: number;
  };
}
export interface CfTaskGoalStats {
  
  timeUsedSeconds: number;
  
  tokensUsed: number;
  
  tokenBudget: number | null;
  
  contextUsed: number;
  
  contextWindow: number;
  
  toolCallCount: number;
  
  iterationCount: number;
}
export interface CfGoalVerification {
  nextAction?: string | null;
  passed: boolean;
  reason: string;
}
export type CfGoalVerificationTimelineStatus =
  | "started"
  | "completed"
  | "failed_closed"
  | "cancelled";
export interface CfGoalVerificationTimelineMeta {
  version: 1;
  kind: "synthetic";
  type: "goal_verification";
  display: "separator";
  targetId: string;
  verificationId: string;
  status: CfGoalVerificationTimelineStatus;
  verification?: CfGoalVerification;
  goalIteration?: number;
  
  anchorAssistantMessageId?: string;
  
  anchorTurnId?: string;
  startedAt?: number;
  updatedAt: number;
}
export interface CfTodoGroup {
  id: string;
  source: "goal_iteration" | "session";
  goalIteration?: number;
  targetId?: string;
  startedAt?: number;
  updatedAt?: number;
  todos: CfPlanStep[];
}
export interface CfTaskGoalChangedPatch {
  action: CfTaskTargetChangedAction;
  source: CfTaskTargetChangedSource;
  target: CfTaskGoal | null;
  previousTarget?: CfTaskGoal | null;
}

export type CfTaskMode =
  | "default"
  | "yolo"
  | "guarded"
  | "plan"
  | "edit"
  | "acceptEdits"
  | "auto"
  | "dontAsk"
  | "bypassPermissions"
  | "autoEdit"
  | "build";

export type CfOffPeakRunType = "init" | "resume";

export type CfBackgroundTurnAttribution =
  | { automationId: string; offPeakTaskId?: never; offPeakRunType?: never }
  | {
      offPeakTaskId: string;
      offPeakRunType?: CfOffPeakRunType;
      automationId?: never;
    }
  | { automationId?: undefined; offPeakTaskId?: undefined; offPeakRunType?: never };

export type CfTaskRuntimeStatus =
  | "idle"
  | "creating"
  | "notReady"
  | "restoring"
  | "ready"
  | "streaming"
  | "completed"
  | "failed";

export type CfTaskPersistStatus = "running" | "completed" | "error";
export interface CfTaskLastError {
  attribution?: ErrorAttribution;
  code?: string;
  message: string;
  traceId?: TraceId;
  taskId?: string;
}

export interface CfPromptImageAttachment {
  kind: "image";
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  
  dataBase64?: string;
  
  localPath?: string;
}
export interface CfPromptFileAttachment {
  kind: "file";
  filename: string;
  mimeType: string;
  sizeBytes: number;
  
  sourceKind?: "clipboard-text" | "topic-history";
  messageCount?: number;
  
  dataBase64?: string;
  
  textContent?: string;
  localPath?: string;
}
export interface CfPromptAudioAttachment {
  kind: "audio";
  filename: string;
  mimeType: string;
  
  dataBase64?: string;
  localPath?: string;
}

export interface CfPromptVideoAttachment {
  kind: "video";
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  
  dataBase64?: string;
  
  localPath?: string;
}
export interface CfPromptPdfAttachment {
  kind: "pdf";
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  dataBase64?: string;
  localPath?: string;
}
export type CfPromptAttachment =
  | CfPromptImageAttachment
  | CfPromptAudioAttachment
  | CfPromptVideoAttachment
  | CfPromptPdfAttachment
  | CfPromptFileAttachment;

export type CfTaskInteractionAutoResolution =
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

export interface CfTaskPendingInteraction {
  interactionId: string;
  kind: "permission" | "userInput";
  
  toolName?: string;
  autoResolution?: CfTaskInteractionAutoResolution;
}

export interface CfTaskMeta {
  
  taskId: string;
  
  traceId: TraceId;
  
  title: string;
  
  titleOverridden?: boolean;
  
  workspacePath: string;
  
  workspaceIdentity?: string;
  
  sourceServerId?: string;
  
  serverDisplayName?: string;
  
  workspacePurpose?: import("./workspacePurpose.js").WorkspacePurpose;
  createdAt: number;
  updatedAt: number;
  mode: CfTaskMode;
  model?: string;
  
  thoughtLevel?: string;
  
  runtimeEpoch?: number;
  
  provider?: CfProvider;
  
  migrationSource?: CfTaskMigrationSource;
  
  cronAutomationId?: string;
  
  offPeakTaskId?: string;
  
  forkedFromTaskId?: string;
  
  unreadAt?: number;
  
  status?: CfTaskPersistStatus;
  
  pendingInteraction?: CfTaskPendingInteraction;
  
  lastError?: CfTaskLastError;
  
  repairState?: CfTaskRepairState;
  
  changeSummary?: CfTaskChangeSummary;
  
  target?: CfTaskGoal | null;
}
export interface CfTaskRepairState {
  
  claudeNativeSnapshotAssistantContentVersion?: number;
  
  codexNativeSnapshotSubagentToolsVersion?: number;
}
export interface CfTaskChangeSummary {
  
  fileCount: number;
  
  added: number;
  
  removed: number;
  
  files: CfTaskChangedFileSummary[];
}
export interface CfTaskChangedFileSummary {
  path: string;
  added: number;
  removed: number;
  
  writeCount: number;
  
  lastTurnIndex: number;
}

export interface CfConfigOption {
  id: string;
  name: string;
  description?: string;
  
  category?: string;
  type: "select" | "boolean";
  currentValue: string | boolean;
  
  options?: CfConfigSelectValue[];
}
export interface CfConfigSelectValue {
  value: string;
  name: string;
  description?: string;
  
  origin?: "native" | "injected";
  
  modelProviderId?: string;
  
  modelProviderName?: string;
  
  modelThoughtLevels?: string[];
  
  modelDefaultThoughtLevel?: string;
}
export interface CfSlashCommand {
  name: string;
  description: string;
  inputHint?: string;
  
  source?: "builtin" | "custom";
}
export interface CfTaskModeInfo {
  id: string;
  name: string;
  description?: string;
}

export type TaskStreamMirrorableEvent = (
  | CfAgentMessageChunk
  | CfAgentThoughtChunk
  | CfToolCall
  | CfToolCallUpdate
  | CfPlan
  | CfPermissionRequest
  | CfTaskPermissionResponse
  | CfElicitationRequest
  | CfElicitationResponse
  | CfTaskComplete
  | CfTaskRunStarted
  | CfTaskWarning
  | CfTaskError
  | CfConfigOptionUpdate
  | CfAvailableCommandsUpdate
  | CfModeUpdate
  | CfSessionInfoUpdate
  | CfGoalVerificationUpdate
  | CfTaskTokenUsageDelta
  | CfTaskNetworkDebugStatus
  | CfUsageUpdate
  | CfBackgroundTaskControlItemsUpdate
) & { inputId?: InputId };
export type CfStreamEvent = (
  | TaskStreamMirrorableEvent
  | CfGlmAgentModelStateUpdate
  | CfGoalIterationStarted
  | CfTurnSteerQueued
  | CfTurnSteerStatus
  | TaskStreamMirrorBatch
  | CfTaskSnapshotUpdated
) & { inputId?: InputId };
export type CfTurnSteerSource = "plan_approval_feedback" | "workflow_refine_feedback";
export type CfTurnSteerCommandKind = "sendText" | "sendGoalCommand" | "compact";
export interface CfTurnSteerQueued {
  type: "turn_steer_queued";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  queryId?: QueryId;
  pendingInputId: string;
  messageId?: string;
  commandKind?: CfTurnSteerCommandKind;
  source?: CfTurnSteerSource;
  targetTurnId?: string;
  content: string;
  raw?: unknown;
}
export interface CfTurnSteerStatus {
  type: "turn_steer_status";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  queryIds?: QueryId[];
  status: "drained" | "discarded" | "rejected";
  pendingInputIds?: string[];
  injectedMessageIds?: string[];
  targetTurnId?: string;
  reason?: string;
  raw?: unknown;
}
export interface CfAgentMessageChunk {
  type: "agent_message_chunk";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  
  parentToolUseId?: string | null;
  
  messageId?: string;
  content: string;
  cfTimeline?: CfTimelineMeta;
}
export interface CfAgentThoughtChunk {
  type: "agent_thought_chunk";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  
  parentToolUseId?: string | null;
  content: string;
}
export type CfTimelineStatus =
  | "started"
  | "retrying"
  | "skipped"
  | "completed"
  | "failed"
  | "interrupted";
export type CfTimelineTrigger = "manual" | "auto" | "reactive" | "partial" | "session_memory";
export type CfContextCompactionTimelinePhase =
  | "standalone_turn"
  | "pre_request"
  | "mid_turn"
  | "reactive";
export type CfTimelineMeta =
  | CfContextCompactionTimelineMeta
  | CfGoalVerificationTimelineMeta
  | CfSessionForkTimelineMeta;
export interface CfContextCompactionTimelineMeta {
  version: 1;
  kind: "synthetic";
  type: "context_compaction";
  operationId: string;
  status: CfTimelineStatus;
  trigger: CfTimelineTrigger;
  display: "separator";
  
  inputId?: InputId;
  
  command?: string;
  replace?: boolean;
  reason?: string;
  boundaryId?: string;
  summaryMessageId?: string;
  preCompactTokenCount?: number;
  postCompactTokenCount?: number;
  truePostCompactTokenCount?: number;
  attempt?: number;
  maxAttempts?: number;
  
  phase?: CfContextCompactionTimelinePhase;
  startedAt?: number;
  endedAt?: number;
}
export interface CfSessionForkTimelineMeta {
  version: 1;
  kind: "synthetic";
  type: "session_fork";
  display: "separator";
  parentSessionId: string;
  targetMessageId: string;
  
  targetCheckpointId?: string;
  restoredFileCount?: number;
}
export interface CfToolCall {
  type: "tool_call";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  toolId: string;
  
  parentToolUseId?: string | null;
  input: unknown;
  
  toolName?: string;
  
  kind: string;
  
  title: string;
  
  raw: unknown;
  pluginMetadata?: { pluginId: string; component: "mcp" };
  
  skillMetadata?: {
    name?: string;
    qualifiedName?: string;
    pluginId?: string;
    source?: "agents" | "cf" | "bundled" | "plugin" | "remote";
  };
}
export interface CfToolCallUpdate {
  type: "tool_call_update";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  toolId: string;
  
  parentToolUseId?: string | null;
  status: "pending" | "in_progress" | "completed" | "failed" | "denied" | "stopped";
  
  title?: string;
  
  toolName?: string;
  
  kind?: string;
  input?: unknown;
  content?: unknown;
  error?: string;
  
  raw: unknown;
  pluginMetadata?: { pluginId: string; component: "mcp" };
  
  skillMetadata?: {
    name?: string;
    qualifiedName?: string;
    pluginId?: string;
    source?: "agents" | "cf" | "bundled" | "plugin" | "remote";
  };
}
export interface CfPlan {
  type: "plan";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  steps: CfPlanStep[];
}
export interface CfPlanStep {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed";
}
export interface CfPermissionRequest {
  type: "permission_request";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  requestId: string;
  description: string;
  kind: string;
  title?: string;
  options: CfPermissionOption[];
  
  freeText?: boolean;
  origin?: CfInteractionRequestOrigin;
  
  display?: ToolCallDisplay;
  
  raw: unknown;
}
export interface CfTaskPermissionResponse {
  type: "permission_response";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  requestId: string;
  optionId: string;
  response: CfPermissionResponse;
}
export interface CfPermissionOption {
  optionId: string;
  kind: string;
  name: string;
  description?: string;
  response: CfPermissionResponse;
}

export interface CfElicitationRequest {
  type: "elicitation_request";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  requestId: string;
  message: string;
  header?: string;
  options: CfElicitationOption[];
  multiSelect?: boolean;
  
  questions?: CfElicitationQuestion[];
  
  currentQuestionIndex?: number;
  
  answerDrafts?: Record<string, string[]>;
  origin?: CfInteractionRequestOrigin;
  
  schema?: unknown;
}

export interface CfElicitationQuestion {
  question: string;
  header: string;
  options: CfElicitationOption[];
  multiSelect?: boolean;
}

export interface CfElicitationOption {
  value: string;
  label: string;
  description?: string;
}

export interface CfElicitationResponse {
  type: "elicitation_response";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  requestId: string;
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
}
export interface CfTaskComplete {
  type: "task_complete";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  stopReason: string;
  usage?: CfUsage;
}
export interface CfTaskRunStarted {
  inputOrigin?: "desktop" | "mobile";
  type: "task_run_started";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  turnId?: string;
  startedAt: number;
}
export interface CfGoalIterationStarted {
  type: "goal_iteration_started";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  turnId?: string;
  targetId?: string;
  startedAt: number;
}
export interface CfTaskError {
  type: "task_error";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  error: string;
  code?: string;
  detail?: string;
  attribution?: ErrorAttribution;
}
export interface CfTaskWarning {
  type: "task_warning";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  warning: string;
  code?: string;
  detail?: string;
}
export interface CfUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  
  reasoningTokens?: number;
  
  cachedInputTokens?: number;
  
  cachedWriteInputTokens?: number;
}
export interface CfContextCacheUsage {
  
  inputTokens: number;
  
  cacheReadTokens: number;
  
  cacheWriteTokens: number;
  
  latestHitRate?: number | null;
  
  hitRateRequestCount?: number;
  
  totalInputTokens?: number;
  
  totalCacheReadTokens?: number;
  
  totalCacheWriteTokens?: number;
  
  hitRate: number | null;
}

export interface CfTaskTokenUsageDelta {
  type: "task_token_usage_delta";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  queryId?: QueryId;
  
  eventKey: string;
  eventId?: string;
  querySource?: string;
  usage: CfUsage;
}
export type CfTaskNetworkDebugStatusType =
  | "model_request_started"
  | "model_request_completed"
  | "model_request_failed"
  | "model_retry_scheduled"
  | "model_stream_stalled";

export interface CfTaskNetworkDebugStatus {
  type: "task_network_debug_status";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  queryId?: QueryId;
  eventKey: string;
  eventId?: string;
  statusType: CfTaskNetworkDebugStatusType;
  requestId?: string;
  providerId?: string;
  modelId?: string;
  providerKind?: string;
  transport?: string;
  baseURL?: string;
  querySource?: string;
  attempt?: number;
  maxAttempts?: number;
  nextAttempt?: number;
  retryable?: boolean;
  statusCode?: number;
  durationMs?: number;
  delayMs?: number;
  idleMs?: number;
  timeoutMs?: number;
  reason?: string;
  message?: string;
  timestamp?: string;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestHeaderCount: number;
  responseHeaderCount: number;
}

export interface CfConfigOptionUpdate {
  type: "config_option_update";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  configOptions: CfConfigOption[];
}

export interface CfGlmAgentModelStateUpdate extends CfGlmAgentModelStateUpdatePayload {
  type: "glm_agent_model_state_update";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
}

export interface CfAvailableCommandsUpdate {
  type: "available_commands_update";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  commands: CfSlashCommand[];
}

export interface CfModeUpdate {
  type: "mode_update";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  currentModeId: string;
  availableModes: CfTaskModeInfo[];
}

export interface CfApiRetryStatus {
  kind: "api_retry";
  attempt: number;
  maxRetries: number;
  retryDelayMs: number;
  errorStatus: number | null;
  error: string;
}

export interface CfSessionInfoUpdate {
  type: "session_info_update";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  title?: string | null;
  
  apiRetry?: CfApiRetryStatus | null;
  
  target?: CfTaskGoalChangedPatch;
}
export interface CfGoalVerificationUpdate {
  type: "goal_verification_update";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  verification: CfGoalVerification;
}

export interface CfUsageUpdate {
  type: "usage_update";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  
  size: number;
  
  used: number;
  
  cost?: { amount: number; currency: string } | null;
  
  cache?: CfContextCacheUsage;
  
  breakdown?: CfContextUsageBreakdownItem[];
}

export interface CfBackgroundTaskControlItemsUpdate {
  type: "background_bash_jobs_update";
  taskId: string;
  traceId: TraceId;
  inputId?: InputId;
  jobs: CfBackgroundTaskControlItem[];
}

export interface CfTaskSnapshotUpdated {
  type: "task_snapshot_updated";
  workspacePath: string;
  workspaceIdentity?: string;
  workspaceKey: string;
  taskId: string;
  traceId: TraceId;
  reason?: TaskRealtimeReason;
  eventId?: string;
  runId?: string;
  streamWatermark?: TaskStreamWatermark;
}
export type CfTaskClientMode = "desktop-continuous" | "web-remote-replayable";
export type CfTaskRuntimeCommandStatus = "accepted" | "running" | "failed";
export interface CfTaskRuntimeCommandBase {
  commandId: string;
  taskId: string;
  traceId: TraceId;
  queryId?: QueryId;
  workspacePath: string;
  workspaceIdentity?: string;
  workspaceKey: string;
  status: CfTaskRuntimeCommandStatus;
  createdAt: number;
  updatedAt: number;
  clientId?: string;
  clientLabel?: string;
  error?: string;
}
export interface CfTaskSendPromptCommand extends CfTaskRuntimeCommandBase {
  type: "send_prompt";
  content: string;
  attachments?: CfPromptAttachment[];
  
  automationId?: string;
}
export type CfTaskRuntimeCommand = CfTaskSendPromptCommand;
export interface TaskStreamMirrorBatch {
  type: "task_stream_mirror_batch";
  workspacePath: string;
  workspaceIdentity?: string;
  workspaceKey: string;
  taskId: string;
  traceId: TraceId;
  runId: string;
  ownerClientId?: string;
  ownerDeviceLabel?: string;
  batchSeq: number;
  fromSeq: number;
  toSeq: number;
  ops: TaskStreamMirrorOp[];
  terminal: boolean;
}

export interface CfSessionFile {
  meta: CfTaskMeta;
  messages: CfPersistedMessage[];
  
  fileChanges?: CfPersistedFileChange[];
  
  turnCheckpoints?: CfPersistedTurnCheckpoint[];
}
export interface CfSessionRuntimeSnapshot {
  pendingPermissions?: CfPermissionRequest[];
  pendingElicitations?: CfElicitationRequest[];
  
  activeTurnKind?: CfSessionActiveTurnKind;
  
  apiRetry?: CfApiRetryStatus | null;
  
  contextUsage?: {
    used: number;
    size: number;
    cost?: { amount: number; currency: string } | null;
    cache?: CfContextCacheUsage;
    breakdown?: CfContextUsageBreakdownItem[];
  };
  streamWatermark?: TaskStreamWatermark;
  pendingCommands?: CfTaskRuntimeCommand[];
  
  plan?: CfPlanStep[] | null;
  
  goalStats?: CfTaskGoalStats | null;
  goalVerifications?: CfGoalVerification[] | null;
  goalVerificationTimeline?: CfGoalVerificationTimelineMeta[] | null;
  
  todoGroups?: CfTodoGroup[] | null;
  
  backgroundBashJobs?: CfBackgroundTaskControlItem[];
}
export interface CfTaskSnapshotHistory {
  
  truncatedBefore: boolean;
  
  totalMessages: number;
}
export type CfTaskSnapshot = CfSessionFile & {
  
  runtime?: CfSessionRuntimeSnapshot;
  
  history?: CfTaskSnapshotHistory;
  
  slashCommands?: CfSlashCommand[];
  
  configOptions?: CfConfigOption[];
};
export type CfTurnFileState = "applied" | "reverted";

export interface CfPersistedFileChange {
  turnIndex: number;
  snapshots: CfPersistedFileSnapshot[];
  
  fileState?: CfTurnFileState;
}

export interface CfPersistedTurnCheckpoint {
  turnIndex: number;
  
  baseFileCheckpointId: string;
  
  resultFileCheckpointId?: string;
}

export interface CfPersistedFileSnapshot {
  path: string;
  beforeContent: string | null;
  afterContent: string;
  writeCount: number;
  
  contentRefs?: CfTaskSnapshotFileContentRef[];
}

export type CfPersistedMessagePart =
  | { type: "content"; content: string }
  | { type: "thought"; content: string }
  | { type: "tool-call"; toolIndex: number };
export type CfAssistantMessageFeedback = "like" | "dislike";
export type CfAssistantCheckpointState = "partial";
export type CfAssistantCheckpointReason = "tool_completed" | "part_boundary" | "periodic";
export interface CfPersistedMessage {
  
  id?: string;
  
  mergedMessageIds?: string[];
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  
  goalIteration?: number;
  
  model?: string;
  
  characterCount?: number;
  
  durationMs?: number;
  
  interrupted?: boolean;
  
  feedback?: CfAssistantMessageFeedback;
  attachments?: CfPromptAttachment[];
  tools?: CfPersistedToolCall[];
  thought?: string;
  
  parts?: CfPersistedMessagePart[];
  
  checkpointState?: CfAssistantCheckpointState;
  checkpointReason?: CfAssistantCheckpointReason;
  checkpointUpdatedAt?: number;
  
  turnIndex?: number;
  
  bodyRefs?: CfTaskSnapshotBodyRef[];
  
  toolSlice?: CfTaskSnapshotToolSlice;
  
  syntheticTimeline?: CfTimelineMeta;
}
export type CfTaskSnapshotBodyField = "content" | "thought";
export interface CfTaskSnapshotBodyRef {
  field: CfTaskSnapshotBodyField;
  refId: string;
  hash: string;
  fullBytes: number;
  previewBytes: number;
}
export type CfTaskSnapshotToolField = "input" | "output" | "raw";
export type CfTaskSnapshotFileContentField = "beforeContent" | "afterContent";
export interface CfTaskSnapshotToolFieldRef {
  field: CfTaskSnapshotToolField;
  refId: string;
  hash: string;
  fullBytes: number;
  previewBytes: number;
}
export interface CfTaskSnapshotFileContentRef {
  field: CfTaskSnapshotFileContentField;
  refId: string;
  hash: string;
  fullBytes: number;
  previewBytes: number;
}
export interface CfTaskSnapshotToolSlice {
  persistedMessageIndex: number;
  totalTools: number;
  startToolIndex: number;
  endToolIndexExclusive: number;
}
export interface CfPersistedToolCall {
  
  toolName?: string;
  title?: string;
  kind?: string;
  status?: "completed" | "failed" | "denied" | "stopped";
  input: unknown;
  output?: unknown;
  error?: string;
  raw?: unknown;
  
  snapshotRefs?: CfTaskSnapshotToolFieldRef[];
}
export type TaskRealtimeReason =
  | "task_created"
  | "user_message_saved"
  | "assistant_message_saved"
  | "task_status_changed"
  | "task_meta_changed"
  | "task_model_changed"
  | "task_title_changed"
  | "task_pinned"
  | "task_unpinned"
  | "task_archived"
  | "task_unarchived"
  | "task_deleted"
  | "stream_mirror_gap"
  | "stream_mirror_owner_lost";
export interface TaskStreamMirrorUserMessageOp {
  kind: "user_message";
  messageId: string;
  content: string;
  attachments?: CfPromptAttachment[];
  timestamp: number;
}
export interface TaskStreamMirrorStreamEventOp {
  kind: "stream_event";
  event: TaskStreamMirrorableEvent;
}
export type TaskStreamMirrorOp =
  | (TaskStreamMirrorUserMessageOp & { seq: number })
  | (TaskStreamMirrorStreamEventOp & { seq: number });
export interface TaskStreamWatermark {
  runId: string;
  opSeq: number;
}
