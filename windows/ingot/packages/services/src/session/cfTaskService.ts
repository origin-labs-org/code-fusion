
import type { Event } from "@origin-ai/cf-rpc";
import { ServiceChannels } from "@origin-ai/cf-shared";
import type { CommandPayloadMap } from "@origin-ai/cf-shared/cf-protocol-v4";
import { createServiceDescriptor } from "#src/descriptors.js";
import type {
  CfImportSessionsResult,
  CfImportableSessionCandidate,
  CfSessionCompactResult,
  CfSessionGoalAction,
  CfSessionGoalResult,
  CfCodexConnectivityCheckResult,
  CfSwitchAgentResult,
  CfSyncTaskSessionBindingResult,
  CfTaskCreateResult,
  CfTaskMeta,
  CfStreamEvent,
  CfTaskMode,
  CfConfigOption,
  CfError,
  CfAssistantMessageFeedback,
  CfPromptAttachment,
  CfProvider,
  CfWorkspaceEvent,
  TraceId,
  CfSessionFile,
  CfAgentMcpServer,
  CfTaskSnapshot,
  CfTaskSnapshotBody,
  CfTaskSnapshotToolCallsSlice,
  CfTaskSnapshotRefContent,
  CfEnqueueTaskCommandResult,
  CfCancelTaskCommandResult,
  CfTaskClientMode,
  CfTaskTokenUsageResult,
  CfPermissionResponse,
  ModelSelection,
  CfBackgroundTurnAttribution,
  CfAutomationBotDeliveryTarget,
} from "@origin-ai/cf-shared";
import type {
  SessionMessageDeliveryResult,
  SessionMessageSendRequested,
} from "#src/session/sessionMailbox.js";
import type {
  CfTaskListQuery,
  CfTaskListResult,
  CfTaskListSortBy,
  CfTaskListWorkspaceScope,
  CfWorkspaceEventSubscriptionParams,
} from "#src/session/cfTaskListTypes.js";

export interface CfTaskSnapshotWithEtagResult {
  snapshot: CfTaskSnapshot | null;
  etag?: string;
  notModified?: boolean;
}

export interface CfArchivedTaskDeletionResult {
  deletedTaskIds: string[];
  skippedTaskIds: string[];
  failedTaskIds: string[];
}

export type CfModelTrajectoryContentPart =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "tool-call"; toolCallId?: string; toolName: string; input?: unknown }
  | { kind: "tool-result"; toolCallId?: string; toolName?: string; output?: unknown }
  | { kind: "image"; mediaType?: string }
  | { kind: "unknown"; raw: unknown };

export interface CfModelTrajectoryMessage {
  role: string;
  parts: CfModelTrajectoryContentPart[];
}

export interface CfModelTrajectoryUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  reasoningTokens?: number;
}

export type CfModelTrajectoryCallSourceKind =
  | "main"
  | "sidecar"
  | "subagent"
  | "compact"
  | "unknown";

export interface CfModelTrajectoryCallSource {
  kind: CfModelTrajectoryCallSourceKind;
  querySource?: string;
}

export interface CfModelTrajectoryRecord {
  requestId: string;
  attempt: number;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  turnId?: string;
  traceId?: string;
  callSource?: CfModelTrajectoryCallSource;
  model: {
    modelId?: string;
    providerId?: string;
    role?: string;
    source?: string;
  };
  request: {
    messages: CfModelTrajectoryMessage[];
    toolNames: string[];
  };
  response?: {
    finishReason?: string;
    text?: string;
    reasoningText?: string;
    toolCalls: CfModelTrajectoryContentPart[];
    usage?: CfModelTrajectoryUsage;
    responseId?: string;
    modelId?: string;
  };
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface CfModelTrajectory {
  taskId: string;
  
  available: boolean;
  records: CfModelTrajectoryRecord[];
  
  sourceFiles: string[];
  
  truncated: boolean;
}

export type {
  CfTaskListKind,
  CfTaskListQuery,
  CfTaskListResult,
  CfTaskListSortBy,
  CfTaskListWorkspaceScope,
  CfWorkspaceEventSubscriptionParams,
} from "#src/session/cfTaskListTypes.js";

export interface CfTaskTerminalOutcome {
  taskId: string;
  
  inputId?: string;
  outcome: "succeeded" | "failed" | "stopped";
  
  error?: string;
}

export interface CfTaskReadyOutcome {
  taskId: string;
  reason: "prompt_completed" | "prompt_failed";
}

export interface ICfTaskService {

  
  initialize(params: { workspacePath: string }): Promise<{ available: boolean; version?: string }>;

  
  releaseWorkspacePreparation(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    provider?: CfProvider;
  }): Promise<void>;

  
  checkCodexConnectivity(): Promise<CfCodexConnectivityCheckResult>;

  
  createTask(params: {
    projectId?: string | null;
    additionalDirectories?: string[];
    workspacePath: string;
    workspaceIdentity?: string;
    provider?: CfProvider;
    mode?: CfTaskMode;
    
    modelSelection?: ModelSelection;
    
    model?: string;
    
    thoughtLevel?: string;
    forkedFromTaskId?: string;
    mcpServers?: CfAgentMcpServer[];
    
    automationId?: string;
    
    offPeakTaskId?: string;
    
    deferPersistenceUntilFirstPrompt?: boolean;
    
    v4Create?: boolean;
    permissionScope?: "session";
  }): Promise<CfTaskCreateResult>;

  readBotTopicSummaries?(params: {
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
    remoteSessionId?: string;
  }): Promise<Array<{ checkpoint: string; text: string }>>;

  invalidateBotTopicInputs?(params: {
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
    remoteSessionId?: string;
  }): Promise<void>;
  readBotTopicExecution?(params: {
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
    remoteSessionId?: string;
  }): Promise<{ executionId: string; sourceCommandId?: string } | undefined>;
  stopBotTopicExecution?(params: {
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
    remoteSessionId?: string;
    executionId: string;
  }): Promise<void>;

  
  getBotGroupTaskBlockReason?(params: {
    taskId: string;
    remoteSessionId?: string;
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<"running" | "queued" | "interaction" | null>;
  cancelBotGroupInput?(params: {
    workspacePath?: string;
    workspaceIdentity?: string;
    taskId: string;
    remoteSessionId?: string;
    commandId: string;
    sourceCommandId: string;
    actorId: string;
    ownerId: string;
    botId: string;
    chatId: string;
  }): Promise<import("@origin-ai/cf-shared/cf-protocol-v4").CommandAck>;
  submitBotGroupInput?(params: {
    workspacePath?: string;
    workspaceIdentity?: string;
    taskId: string;
    remoteSessionId?: string;
    commandId: string;
    content: string;
    conversationQuotes?: import("@origin-ai/cf-shared").ConversationSelectionText[];
    attachments?: CfPromptAttachment[];
    source: import("@origin-ai/cf-shared").BotGroupInputSource;
  }): Promise<import("@origin-ai/cf-shared/cf-protocol-v4").CommandAck>;

  
  sendPrompt(
    params: {
      taskId: string;
      remoteSessionId?: string;
      traceId: TraceId;
      queryId?: string;
      messageId?: string;
      content: string;
      attachments?: CfPromptAttachment[];
      clientId?: string;
      clientLabel?: string;
      clientMode?: CfTaskClientMode;
      
      toolDenylist?: string[];
      
      botDeliveryTarget?: CfAutomationBotDeliveryTarget;
      
      modelSelection?: CommandPayloadMap["sendText"]["modelSelection"];
      
      modelExecution?: CommandPayloadMap["sendText"]["modelExecution"];
    } & CfBackgroundTurnAttribution,
  ): Promise<void>;

  deliverSessionMessage(
    request: SessionMessageSendRequested,
  ): Promise<SessionMessageDeliveryResult>;

  sendSessionMessageDeliveryResult(result: SessionMessageDeliveryResult): Promise<void>;

  
  enqueueTaskCommand(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    taskId: string;
    commandId: string;
    traceId: TraceId;
    queryId?: string;
    type: "send_prompt";
    content: string;
    attachments?: CfPromptAttachment[];
    clientId?: string;
    clientLabel?: string;
    
    automationId?: string;
    ownerRunId?: TraceId;
  }): Promise<CfEnqueueTaskCommandResult>;

  promoteTaskCommand(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    taskId: string;
    commandId: string;
    ownerRunId: TraceId;
    clientMode: CfTaskClientMode;
  }): Promise<CfEnqueueTaskCommandResult>;

  cancelTaskCommand(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    taskId: string;
    commandId: string;
    ownerRunId?: TraceId;
    clientMode: CfTaskClientMode;
  }): Promise<CfCancelTaskCommandResult>;

  
  stopGeneration(params: {
    taskId: string;
    workspacePath?: string;
    workspaceIdentity?: string;
    runId?: TraceId;
    
    expectedForegroundExecutionId?: string;
  }): Promise<void>;

  
  compactSession(params: {
    taskId: string;
    workspacePath?: string;
    workspaceIdentity?: string;
    inputId?: string;
    instructions?: string;
    expectedRevision?: number;
  }): Promise<CfSessionCompactResult>;

  
  goalSession(params: {
    taskId: string;
    workspacePath?: string;
    workspaceIdentity?: string;
    inputId?: string;
    action: CfSessionGoalAction;
    objective?: string;
    expectedRevision?: number;
  }): Promise<CfSessionGoalResult>;

  
  respondPermission(params: {
    taskId: string;
    workspacePath?: string;
    workspaceIdentity?: string;
    runId?: TraceId;
    requestId: string;
    optionId: string;
    response: CfPermissionResponse;
  }): Promise<boolean>;

  
  respondElicitation(params: {
    taskId: string;
    workspacePath?: string;
    workspaceIdentity?: string;
    runId?: TraceId;
    requestId: string;
    action: "accept" | "decline" | "cancel";
    content?: Record<string, unknown>;
    clientMode?: CfTaskClientMode;
  }): Promise<boolean>;

  
  resumeTask(params: {
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
    additionalDirectories?: string[];
    mode?: CfTaskMode;
    model?: string;
    thoughtLevel?: string;
    
    automationId?: string;
    
    offPeakTaskId?: string;
    mcpServers?: CfAgentMcpServer[];
  }): Promise<CfTaskMeta>;

  
  listTasks(params: {
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<CfTaskMeta[]>;

  
  listPinnedTaskIds(): Promise<string[]>;

  
  listPinnedTasks(params: {
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<CfTaskMeta[]>;

  
  listDeletedTaskIds(params: {
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<string[]>;

  
  listActiveTaskIds(params: {
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<string[]>;

  
  listTaskList(params: CfTaskListQuery): Promise<CfTaskListResult>;

  
  listArchivedTasks(params: {
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<CfTaskMeta[]>;

  
  getTaskSnapshot(params: {
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
    messageLimit?: number;
    byteBudget?: number;
    toolLimit?: number;
    clientMode?: CfTaskClientMode;
    resumeModelPolicy?: "task-index" | "ui-resolved-only";
    model?: string;
    thoughtLevel?: string;
  }): Promise<CfTaskSnapshot | null>;

  
  getTaskSnapshotWithEtag(params: {
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
    messageLimit?: number;
    ifNoneMatch?: string;
    byteBudget?: number;
    toolLimit?: number;
    clientMode?: CfTaskClientMode;
    resumeModelPolicy?: "task-index" | "ui-resolved-only";
    model?: string;
    thoughtLevel?: string;
  }): Promise<CfTaskSnapshotWithEtagResult>;

  
  getTaskSnapshotBody(params: {
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
    refId: string;
  }): Promise<CfTaskSnapshotBody | null>;

  
  getTaskSnapshotRef(params: {
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
    refId: string;
  }): Promise<CfTaskSnapshotRefContent | null>;

  
  getTaskSnapshotToolCallsSlice(params: {
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
    messageIndex: number;
    startToolIndex: number;
    limit: number;
  }): Promise<CfTaskSnapshotToolCallsSlice | null>;

  
  getTaskMeta(params: {
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<CfTaskMeta | null>;

  
  getTaskConfigOptions(params: { taskId: string }): Promise<CfConfigOption[]>;

  
  getTaskModelSelection(params: { taskId: string }): Promise<ModelSelection | null>;

  
  setAssistantMessageFeedback(params: {
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
    turnIndex: number;
    feedback: CfAssistantMessageFeedback | null;
  }): Promise<CfSessionFile>;

  
  syncTaskSessionBinding(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    taskId: string;
    provider: CfProvider;
    validate?: boolean;
  }): Promise<CfSyncTaskSessionBindingResult>;

  
  switchAgent(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    taskId: string;
    provider: CfProvider;
  }): Promise<CfSwitchAgentResult>;

  
  scanImportableClaudeSessions(params: {
    workspacePath?: string;
    workspaceIdentity?: string;
    modifiedSince?: number;
    limit?: number;
  }): Promise<CfImportableSessionCandidate[]>;

  
  importClaudeSessions(params: {
    workspacePath?: string;
    workspaceIdentity?: string;
    sessionIds: string[];
  }): Promise<CfImportSessionsResult>;

  
  setMode(params: { taskId: string; mode: CfTaskMode }): Promise<void>;

  
  setConfigOption(params: {
    taskId: string;
    traceId: TraceId;
    configId: string;
    value: string;
  }): Promise<CfConfigOption[]>;

  
  setModel(params: {
    taskId: string;
    traceId: TraceId;
    modelSelection: ModelSelection;
  }): Promise<CfConfigOption[]>;

  
  setAutomationSessionConfig(params: {
    taskId: string;
    traceId: TraceId;
    modelSelection: ModelSelection;
    thoughtLevel?: string;
    mode?: CfTaskMode;
  }): Promise<CfConfigOption[]>;

  
  getWorkspaceProviderConfigFile(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    provider?: CfProvider;
  }): Promise<{
    provider: CfProvider;
    path: string;
    exists: boolean;
  }>;

  
  getTaskNativeSessionLogFile(params: {
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<{
    provider: CfProvider | null;
    path: string | null;
    exists: boolean;
  }>;

  
  getModelTrajectory(params: {
    taskId: string;
    
    limit?: number;
  }): Promise<CfModelTrajectory>;

  
  getTaskTokenUsage(params: {
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<CfTaskTokenUsageResult>;

  
  getTaskSessionFilePath(params: {
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<{
    path: string;
    exists: boolean;
  }>;

  
  restartWorkspaceProcess(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    provider?: CfProvider;
    resumeTaskId?: string;
    bumpRuntimeEpoch?: boolean;
  }): Promise<void>;

  
  deleteTask(params: {
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<void>;

  
  deleteArchivedTask(params: {
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<boolean>;

  
  deleteArchivedTasks(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    taskIds: string[];
  }): Promise<CfArchivedTaskDeletionResult>;

  
  renameTask(params: {
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
    title: string;
  }): Promise<CfTaskMeta>;

  
  setTaskPinned(params: {
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
    pinned: boolean;
  }): Promise<CfTaskMeta>;

  
  setTaskUnread(params: {
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
    unread: boolean;
    
    expectedUnreadAt?: number;
  }): Promise<CfTaskMeta>;

  
  archiveTask(params: {
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<CfTaskMeta>;

  
  unarchiveTask(params: {
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<CfTaskMeta>;

  
  branchTaskFromPrompt(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    sourceTaskId: string;
  }): Promise<CfTaskCreateResult>;

  
  onDynamicStreamEvent(taskId: string): Event<CfStreamEvent>;

  
  onDynamicTaskTerminalOutcome(taskId: string): Event<CfTaskTerminalOutcome>;

  
  onDynamicTaskReady(taskId: string): Event<CfTaskReadyOutcome>;

  
  onDynamicTaskEvent(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    taskId: string;
    clientId?: string;
    deliveryKind?: "continuous" | "bot-channel-continuous" | "replayable" | "mixed";
  }): Event<CfStreamEvent>;

  
  onDynamicWorkspaceEvent(
    workspace: string | CfWorkspaceEventSubscriptionParams,
  ): Event<CfWorkspaceEvent>;

  
  onError: Event<CfError>;
}

export const ICfTaskService = createServiceDescriptor<ICfTaskService>(
  ServiceChannels.CfTask,
);
