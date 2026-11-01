

import {
  buildNativeSupplierKey,
  CF_AGENT_PROVIDER,
  type CfApiRetryStatus,
  type ModelSelectionGhostReason,
  type ModelSelectionResolution,
  type CfWorkspaceInitStatus,
  type CfTaskRuntimeStatus,
  type CfProvider,
  type CfTaskMeta,
  type CfContextCacheUsage,
  type CfConfigOption,
  type CfSlashCommand,
  type CfPermissionRequest,
  type CfElicitationRequest,
  type CfBackgroundTaskControlItem,
  type CfSessionActiveTurnKind,
  type CfContextUsageBreakdownItem,
  type InputId,
  type SessionCreateSource,
} from "@origin-ai/cf-shared";
import type { SessionConfigState, SubmissionMode } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { CfUiError } from "@/lib/cfUiError.js";
import type {
  AutomationsNavigationTab,
  TaskNavigationHistory,
  WorkspaceNavEntry,
} from "@/lib/taskNavigationHistory.js";
import type { MentionCategory, MentionItemData } from "@/mentions/mentionTypes.js";

// ────────────────────────────────────────────
// Interfaces
// ────────────────────────────────────────────

export interface WorkspaceInitState {
  status: CfWorkspaceInitStatus;
  error: string | null;
  attempts: number;
}

export interface TaskRuntimeState {
  status: CfTaskRuntimeStatus;
  error: string | null;
  
  provider?: CfProvider;
  
  contextWindow: number | null;
  usage: TaskUsageState | null;
  apiRetry: CfApiRetryStatus | null;
  
  backgroundTaskControls: CfBackgroundTaskControlItem[];
  
  activeTurnKind?: CfSessionActiveTurnKind;
  activeInputId?: InputId;
  activeInputOwnerClientId?: string;
}

export interface DraftRuntimeState {
  status: CfTaskRuntimeStatus;
  error: string | null;
}

export interface TaskUsageState {
  
  used: number;
  
  size: number;
  
  cost?: { amount: number; currency: string } | null;
  
  cache?: CfContextCacheUsage;
  
  breakdown?: CfContextUsageBreakdownItem[];
}

export interface ElicitationAnswerDraft {
  selectedValues: string[];
  customAnswer: string;
}

export interface ElicitationFormDraft {
  questionIndex: number;
  drafts: Record<string, ElicitationAnswerDraft>;
}

export interface TaskUiState {
  permissionRequest: CfPermissionRequest | null;
  pendingPermissionRequests: CfPermissionRequest[];
  elicitationRequest: CfElicitationRequest | null;
  pendingElicitationRequests: CfElicitationRequest[];
  elicitationFormDraftsByRequestId: Record<string, ElicitationFormDraft>;
  error: CfUiError | null;
}

export type ModelSwitchStage =
  | "idle"
  | "settingModel"
  | "fallbackConfigOption"
  | "applyingCustomProvider"
  | "restartingRuntime"
  | "syncingSession"
  | "persistingWorkspace";

export type ConfigOptionsStatus = "idle" | "loading" | "ready" | "error";

export interface ComposerMentionPrefill {
  id: string;
  category: MentionCategory;
  label: string;
  value: string;
  markdown: string;
  description?: string;
  data?: MentionItemData;
}

export interface ComposerTextInsertRequest {
  requestId: number;
  text: string;
  mention?: ComposerMentionPrefill;
  mode?: "replace" | "prepend-if-missing";
}

export interface TimelineBottomRequest {
  requestId: number;
  taskId: string;
}

export type ComposerInitialConfig = Pick<
  Partial<SessionConfigState>,
  "planEnabled" | "modelSelection"
> & { mode?: SubmissionMode };
export interface ComposerInitialization {
  taskId: string;
  config: ComposerInitialConfig;
}

export interface WorkspaceCfUIState {
  
  composerInitialization?: ComposerInitialization;
  
  activeTaskId: string | null;
  
  workspaceInit: WorkspaceInitState;
  
  draftRuntime: DraftRuntimeState;
  
  draftProjectId?: string | null;
  
  draftTaskGroupId?: string | null;
  
  draftRuntimeInvalidationVersion: number;
  composerTextInsertVersion: number;
  composerTextInsertRequest: ComposerTextInsertRequest | null;
  timelineBottomRequestVersion: number;
  timelineBottomRequest: TimelineBottomRequest | null;
  
  draftError: CfUiError | null;
  
  modelSwitchRequestId: string | null;
  
  modelSwitchPending: boolean;
  
  modelSwitchStage: ModelSwitchStage;
  
  taskRuntimeByTaskId: Record<string, TaskRuntimeState>;
  
  taskUiByTaskId: Record<string, TaskUiState>;
  taskConfigOptionsByTaskId: Record<string, CfConfigOption[]>;
  taskConfigOptionsStatusByTaskId: Record<string, ConfigOptionsStatus>;
  
  taskUnreadByTaskId: Record<string, boolean>;
  
  optimisticTaskListByTaskId: Record<string, CfTaskMeta>;
  draftCreateSource: SessionCreateSource;
  
  selectedProvider: CfProvider;
  
  selectedSupplierKey: string;
  
  isGhostSupplier: boolean;
  
  supplierMismatchReason: ModelSelectionGhostReason | null;
  
  configOptions: CfConfigOption[] | null;
  
  configOptionsStatus: ConfigOptionsStatus;
  
  slashCommands: CfSlashCommand[];
  
  taskListVersion: number;
  
  taskListCache: CfTaskMeta[] | null;
  
  draftFocusVersion: number;
}

export interface CfSessionStoreState {
  
  workspaces: Record<string, WorkspaceCfUIState>;
  getWorkspaceState: (workspacePath: string, workspaceIdentity?: string) => WorkspaceCfUIState;

  setActiveTaskId: (
    workspacePath: string,
    id: string | null,
    workspaceIdentity?: string,
    composerConfig?: ComposerInitialConfig,
  ) => void;
  consumeComposerInitialization: (
    workspacePath: string,
    initialization: ComposerInitialization,
    workspaceIdentity?: string,
  ) => void;
  invalidateDraftRuntime: (workspacePath: string, workspaceIdentity?: string) => void;
  requestComposerTextInsert: (
    workspacePath: string,
    text: string,
    workspaceIdentity?: string,
    mention?: ComposerMentionPrefill,
    mode?: "replace" | "prepend-if-missing",
  ) => number;
  clearComposerTextInsertRequest: (
    workspacePath: string,
    requestId: number,
    workspaceIdentity?: string,
  ) => void;
  requestTimelineBottom: (
    workspacePath: string,
    taskId: string,
    workspaceIdentity?: string,
  ) => number;
  clearTimelineBottomRequest: (
    workspacePath: string,
    requestId: number,
    workspaceIdentity?: string,
  ) => void;
  clearDraftTaskGroup: (workspacePath: string, workspaceIdentity?: string) => void;
  startDraft: (
    workspacePath: string,
    provider?: CfProvider,
    workspaceIdentity?: string,
    options?: {
      projectId?: string | null;
      taskGroupId?: string | null;
      createSource?: SessionCreateSource;
    },
  ) => void;
  bindRuntimeProvider: (
    workspacePath: string,
    provider: CfProvider,
    workspaceIdentity?: string,
  ) => void;
  setModelSelectionResolution: (
    workspacePath: string,
    resolution: Pick<
      ModelSelectionResolution,
      "selectedSupplierKey" | "isGhostSupplier" | "supplierMismatchReason"
    >,
    workspaceIdentity?: string,
  ) => void;
  setWorkspaceInitState: (
    workspacePath: string,
    status: CfWorkspaceInitStatus,
    error?: string | null,
    workspaceIdentity?: string,
  ) => void;
  setWorkspaceInitAttempts: (
    workspacePath: string,
    attempts: number,
    workspaceIdentity?: string,
  ) => void;
  setTaskState: (
    workspacePath: string,
    status: CfTaskRuntimeStatus,
    error?: string | null,
    workspaceIdentity?: string,
  ) => void;
  setTaskRuntimeState: (
    workspacePath: string,
    taskId: string,
    status: CfTaskRuntimeStatus,
    error?: string | null,
    workspaceIdentity?: string,
    provider?: CfProvider,
  ) => void;
  setTaskUsage: (
    workspacePath: string,
    taskId: string,
    usage: TaskUsageState | null,
    workspaceIdentity?: string,
  ) => void;
  setTaskContextWindow: (
    workspacePath: string,
    taskId: string,
    contextWindow: number | null,
    workspaceIdentity?: string,
  ) => void;
  setTaskApiRetryStatus: (
    workspacePath: string,
    taskId: string,
    apiRetry: CfApiRetryStatus | null,
    workspaceIdentity?: string,
  ) => void;
  setTaskPermissionRequest: (
    workspacePath: string,
    taskId: string,
    request: CfPermissionRequest | null,
    workspaceIdentity?: string,
  ) => void;
  removeTaskPermissionRequest: (
    workspacePath: string,
    taskId: string,
    requestId: string,
    workspaceIdentity?: string,
  ) => void;
  setTaskElicitationRequest: (
    workspacePath: string,
    taskId: string,
    request: CfElicitationRequest | null,
    workspaceIdentity?: string,
  ) => void;
  removeTaskElicitationRequest: (
    workspacePath: string,
    taskId: string,
    requestId: string,
    workspaceIdentity?: string,
  ) => void;
  setTaskElicitationFormDraft: (
    workspacePath: string,
    taskId: string,
    requestId: string,
    draft: ElicitationFormDraft,
    workspaceIdentity?: string,
  ) => void;
  removeTaskElicitationFormDraft: (
    workspacePath: string,
    taskId: string,
    requestId: string,
    workspaceIdentity?: string,
  ) => void;
  setTaskError: (
    workspacePath: string,
    taskId: string,
    error: CfUiError | null,
    workspaceIdentity?: string,
  ) => void;
  setDraftError: (
    workspacePath: string,
    error: CfUiError | null,
    workspaceIdentity?: string,
  ) => void;
  startModelSwitch: (
    workspacePath: string,
    requestId: string,
    stage?: ModelSwitchStage,
    workspaceIdentity?: string,
    options?: { pending?: boolean },
  ) => void;
  updateModelSwitchStage: (
    workspacePath: string,
    requestId: string,
    stage: ModelSwitchStage,
    workspaceIdentity?: string,
  ) => void;
  finishModelSwitch: (workspacePath: string, requestId: string, workspaceIdentity?: string) => void;
  setTaskConfigOptions: (
    workspacePath: string,
    taskId: string,
    options: CfConfigOption[],
    workspaceIdentity?: string,
    status?: ConfigOptionsStatus,
  ) => void;
  initializeBackgroundTaskRuntime: (
    workspacePath: string,
    params: {
      task: CfTaskMeta;
      provider: CfProvider;
      activeInputId: InputId;
      workspaceIdentity?: string;
    },
  ) => void;
  upsertOptimisticTaskListItem: (
    workspacePath: string,
    task: CfTaskMeta,
    workspaceIdentity?: string,
  ) => void;
  removeOptimisticTaskListItem: (
    workspacePath: string,
    taskId: string,
    workspaceIdentity?: string,
  ) => void;
  
  removeTaskState: (workspacePath: string, taskId: string, workspaceIdentity?: string) => void;

  setConfigOptions: (
    workspacePath: string,
    options: CfConfigOption[],
    workspaceIdentity?: string,
  ) => void;
  setConfigOptionsStatus: (
    workspacePath: string,
    status: "idle" | "loading" | "ready" | "error",
    workspaceIdentity?: string,
  ) => void;
  setSlashCommands: (
    workspacePath: string,
    commands: CfSlashCommand[],
    workspaceIdentity?: string,
  ) => void;
  setCurrentModeId: (
    workspacePath: string,
    modeId: string | null,
    workspaceIdentity?: string,
  ) => void;
  
  bumpTaskListVersion: (workspacePath: string, workspaceIdentity?: string) => void;
  
  setTaskListCache: (
    workspacePath: string,
    tasks: CfTaskMeta[],
    workspaceIdentity?: string,
  ) => void;
  
  setTaskUnreadIndicator: (
    workspacePath: string,
    taskId: string,
    hasUnread: boolean,
    workspaceIdentity?: string,
  ) => void;

  
  taskNavHistory: TaskNavigationHistory;
  
  taskNavPushAutomations: (
    workspacePath: string,
    workspaceIdentity?: string,
    automationId?: string,
    automationTab?: AutomationsNavigationTab,
  ) => void;
  
  taskNavPushPluginStore: (workspacePath: string, workspaceIdentity?: string) => void;
  
  taskNavGoBack: () => WorkspaceNavEntry | null;
  
  taskNavGoForward: () => WorkspaceNavEntry | null;
  
  removeTaskFromNavHistory: (taskId: string) => void;
}

// ────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────

export const DEFAULT_WORKSPACE_INIT_STATE: WorkspaceInitState = {
  status: "idle",
  error: null,
  attempts: 0,
};

export const FALLBACK_PROVIDER: CfProvider = CF_AGENT_PROVIDER;

export const DEFAULT_TASK_UI_STATE: TaskUiState = {
  permissionRequest: null,
  pendingPermissionRequests: [],
  elicitationRequest: null,
  pendingElicitationRequests: [],
  elicitationFormDraftsByRequestId: {},
  error: null,
};

export const DEFAULT_TASK_RUNTIME_STATE: TaskRuntimeState = {
  status: "notReady",
  error: null,
  provider: undefined,
  contextWindow: null,
  usage: null,
  apiRetry: null,
  backgroundTaskControls: [],
  activeTurnKind: undefined,
  activeInputId: undefined,
  activeInputOwnerClientId: undefined,
};

// ────────────────────────────────────────────
// Factory functions
// ────────────────────────────────────────────

export function createDefaultWorkspaceState(
  selectedProvider: CfProvider,
): WorkspaceCfUIState {
  return {
    activeTaskId: null,
    workspaceInit: { ...DEFAULT_WORKSPACE_INIT_STATE },
    draftRuntime: { status: "idle", error: null },
    draftRuntimeInvalidationVersion: 0,
    composerTextInsertVersion: 0,
    composerTextInsertRequest: null,
    timelineBottomRequestVersion: 0,
    timelineBottomRequest: null,
    draftError: null,
    modelSwitchRequestId: null,
    modelSwitchPending: false,
    modelSwitchStage: "idle",
    taskRuntimeByTaskId: {},
    taskUiByTaskId: {},
    taskConfigOptionsByTaskId: {},
    taskConfigOptionsStatusByTaskId: {},
    taskUnreadByTaskId: {},
    optimisticTaskListByTaskId: {},
    draftCreateSource: "session",
    selectedProvider,
    selectedSupplierKey: buildNativeSupplierKey(selectedProvider),
    isGhostSupplier: false,
    supplierMismatchReason: null,
    configOptions: null,
    configOptionsStatus: "idle",
    slashCommands: [],
    taskListVersion: 0,
    taskListCache: null,
    draftFocusVersion: 0,
  };
}

const DEFAULT_WORKSPACE_STATE = createDefaultWorkspaceState(FALLBACK_PROVIDER);

export function getDefaultWorkspaceState(): WorkspaceCfUIState {
  return DEFAULT_WORKSPACE_STATE;
}
