
import { createUuid } from "./uuid.js";
import type {
  TaskRealtimeReason,
  TraceId,
  InputId,
  QueryId,
  CfTaskGoal,
  CfProvider,
  CfConfigOption,
  CfSlashCommand,
  CfTaskMeta,
  CfTaskRuntimeCommand,
  CfTaskRuntimeCommandStatus,
  CfTaskSnapshotBodyField,
  CfTaskSnapshotToolField,
  CfTaskSnapshotFileContentField,
  CfPersistedToolCall,
} from "./cf-task-types-core.js";

export function generateTraceId(_taskId: string): TraceId {
  return createUuid();
}

export function createSessionTraceId(): TraceId {
  return createUuid();
}

export function createInputId(): InputId {
  return createUuid();
}

export function createQueryId(): QueryId {
  return createUuid();
}

export const CRON_DEFAULT_GROUP_ID = "cf-default-group-cron";

export const OFF_PEAK_DEFAULT_GROUP_ID = "cf-default-group-off-peak";

type CronTaskIdentity = Pick<CfTaskMeta, "cronAutomationId"> & {
  automationId?: string;
};

export function isCronTask(task: CronTaskIdentity): boolean {
  return Boolean(task.cronAutomationId || task.automationId);
}

export function isOffPeakTask(task: Pick<CfTaskMeta, "offPeakTaskId">): boolean {
  return Boolean(task.offPeakTaskId);
}

// ---- CodeFusion Provider ----
export type CfTaskTarget = CfTaskGoal;

export type CfWorkspaceInitStatus = "idle" | "initializing" | "ready" | "failed";

export interface CfWorkspacePrepareResult {
  workspacePath: string;
  preparedSessionId: string;
  version?: string;
  provider: CfProvider;
  
  configOptions?: CfConfigOption[];
  
  slashCommands?: CfSlashCommand[];
}

export interface CfCodexConnectivityCheckResult {
  
  target: string;
  
  reachable: boolean;
  
  error?: string;
}

export interface CfTaskCreateResult extends CfTaskMeta {
  
  initialSlashCommands?: CfSlashCommand[];
}

export interface CfSyncTaskSessionBindingResult {
  provider: CfProvider;
  sessionId: string;
  lastSyncedTurnIndex: number;
  updated: boolean;
}

export interface CfSwitchAgentResult {
  meta: CfTaskMeta;
  provider: CfProvider;
  sessionId: string;
  reusedBinding: boolean;
}

export type CfImportSessionSourceProvider = "claude";

export interface CfImportableSessionCandidate {
  provider: CfImportSessionSourceProvider;
  sessionId: string;
  workspacePath: string;
  sourcePath: string;
  updatedAt: number;
  createdAt?: number;
  previewTitle?: string;
}

export interface CfImportedSessionResultItem {
  provider: CfImportSessionSourceProvider;
  sessionId: string;
  taskId: string;
  workspacePath: string;
}

export interface CfImportedSessionSkippedItem {
  provider: CfImportSessionSourceProvider;
  sessionId: string;
  reason: string;
  workspacePath?: string;
}

export interface CfImportSessionsResult {
  imported: CfImportedSessionResultItem[];
  skipped: CfImportedSessionSkippedItem[];
  failed: CfImportedSessionSkippedItem[];
}

export interface CfEnqueueTaskCommandResult {
  accepted: true;
  command: CfTaskRuntimeCommand;
}

export interface CfCancelTaskCommandResult {
  canceled: boolean;
  commandId: string;
  status?: CfTaskRuntimeCommandStatus;
  reason?: "not_found" | "already_running";
}

export type CfWorkspaceEvent =
  | CfWorkspaceSlashCommandsUpdate
  | CfWorkspaceConfigOptionsUpdate
  | CfWorkspaceTaskListChanged
  | CfWorkspaceSessionMessageSendRequested;

export interface CfWorkspaceSlashCommandsUpdate {
  type: "workspace_slash_commands_update";
  workspacePath: string;
  
  workspaceIdentity?: string;
  commands: CfSlashCommand[];
}

export interface CfWorkspaceConfigOptionsUpdate {
  type: "workspace_config_options_update";
  workspacePath: string;
  
  workspaceIdentity?: string;
  configOptions: CfConfigOption[];
}

export interface CfWorkspaceTaskListChanged {
  type: "workspace_task_list_changed";
  workspacePath: string;
  workspaceIdentity?: string;
  taskId?: string;
  reason: TaskRealtimeReason;
  taskMeta?: CfTaskMeta;
  
  unreadSignal?: "background_terminal";
}

export interface CfWorkspaceSessionMessageSendRequested {
  type: "workspace_session_message_send_requested";
  workspacePath: string;
  workspaceIdentity?: string;
  request: {
    content: string;
    createdAt: string;
    fromSessionId: string;
    messageId: string;
    requestId: string;
    toSessionId: string;
  };
}

export interface CfError {
  code: string;
  message: string;
  traceId?: TraceId;
  taskId?: string;
}

export interface CfTaskSnapshotBody {
  refId: string;
  field: CfTaskSnapshotBodyField;
  content: string;
  hash: string;
  fullBytes: number;
}

export type CfTaskSnapshotRefKind = "tool_field" | "file_change_field";

export interface CfTaskSnapshotRefContent {
  kind: CfTaskSnapshotRefKind;
  refId: string;
  field: CfTaskSnapshotToolField | CfTaskSnapshotFileContentField;
  content: unknown;
  hash: string;
  fullBytes: number;
}

export interface CfTaskSnapshotToolCallsSlice {
  taskId: string;
  messageIndex: number;
  totalTools: number;
  startToolIndex: number;
  endToolIndexExclusive: number;
  tools: CfPersistedToolCall[];
}
