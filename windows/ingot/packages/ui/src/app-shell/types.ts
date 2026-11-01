import type { FileManagerTarget } from "@/lib/workspaceSidePane.js";
import type { ComposerDraftHandoff } from "@/v4/composer/composerDraftWorkspaceTransfer.js";
import type { RefObject } from "react";
import type {
  CfProvider,
  SessionCreateSource,
  CfTaskRuntimeStatus,
  CfTaskMeta,
  GitChangeSourceId,
  DesktopWindowChromeState,
  IPlatformService,
  RemoteTarget,
  SourceServerUpdateTarget,
  RemoteWorkspaceSessionEntry,
  UpdateStatePayload,
  UserInfo,
} from "@origin-ai/cf-shared";
import type { IFeedbackService, IServiceAccessor } from "@origin-ai/cf-services";
import type { SavedWorkflowsOpenTarget } from "@/settings/saved-workflows/SavedWorkflowsSection.js";
import type { SavedWorkflowHubTarget } from "@/v4/savedWorkflowHubContext.js";
import type { WebRemoteControlWorkspaceSwitcherApi } from "@/root/types.js";
import type { WebRemoteControlTerminalTransportState } from "@/root/types.js";
import type { BrowserNavigationRequest, RecentClosedSidePaneTab } from "@/hooks/useAppPanels.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import type { AssistantPreviewCardsAutoOpenRequest } from "@/lib/assistantPreviewCards.js";
import type {
  BrowserSidePaneMetadata,
  OpenScopedSubagentSideTabRequest,
  OpenBackgroundBashSideTabRequest,
  OpenSelectionSideChatRequest,
  OpenScopedPlanDetailSideTabRequest,
  OpenScopedWorkflowRunSideTabRequest,
  OpenScopedWorkflowActorSessionSideTabRequest,
  OpenScopedWorkflowArtifactSideTabRequest,
  OpenScopedWorkflowWorkspaceSideTabRequest,
  WorkspaceSidePaneState,
} from "@/lib/workspaceSidePane.js";
import type { WorkspaceCfUIState } from "@/store/cfSessionStore.js";
import type { RemoteConnectionLogEntry } from "@/hooks/useRemoteConnectionLogs.js";
import type { Theme } from "@/useTheme.js";
import type {
  ChatSearchResultHighlightRequest,
  ChatViewSummaryPanelVariant,
  ConversationFindMatchState,
} from "@/v4/legacyChatViewTypes.js";
import type { ComposerMentionPrefill } from "@/store/cfSessionStoreTypes.js";
import type { TaskFindDialogProps } from "@/quickpick/TaskFindDialog.js";
import type { AutomationsNavigationTab, OpenAutomationsMain } from "@/lib/taskNavigationHistory.js";
import type { SidePaneFullViewController } from "@/side-pane-full-view/contract.js";

export interface WorkspaceShellCfState {
  activeTaskId: WorkspaceCfUIState["activeTaskId"];
  draftFocusVersion: WorkspaceCfUIState["draftFocusVersion"];
  modelSwitchPending: WorkspaceCfUIState["modelSwitchPending"];
  modelSwitchStage: WorkspaceCfUIState["modelSwitchStage"];
  selectedProvider: WorkspaceCfUIState["selectedProvider"];
  optimisticTaskListByTaskId: WorkspaceCfUIState["optimisticTaskListByTaskId"];
  workspaceInit: WorkspaceCfUIState["workspaceInit"];
  taskStatus: CfTaskRuntimeStatus;
  taskError: string | null;
}

export interface CreateTaskOptions {
  
  isCurrent?: () => boolean;
  remoteProjectMembershipId?: string;
  
  onComplete?: () => void;
  onError?: (error: unknown) => void;
  
  expectedWorkspaceKey?: string;
  provider?: CfProvider;
  projectId?: string | null;
  
  draftId?: string;
  
  taskGroupId?: string | null;
  hostId?: string;
  createSource?: SessionCreateSource;
  
  initialPrompt?: string;
  
  initialComposerDraft?: ComposerDraftHandoff;
  
  initialPromptMention?: ComposerMentionPrefill;
  
  targetWorkspace?: {
    projectId?: string | null;
    hostId?: string;
    workspacePath: string;
    workspaceIdentity?: string;
  };
}

export type CreateTaskRequest = CfProvider | CreateTaskOptions;

export interface RemoteWorkspaceRecoveryStatus {
  mode: "automatic" | "manual";
  attempt?: number;
  limit?: number;
}

export interface RemoteConnectionFeedbackOptions {
  announceReusedConnection?: boolean;
}

export type DeviceAdditionResult =
  | { kind: "connected"; sourceServerId: string | undefined }
  | { kind: "cancelled"; background?: boolean };

export interface DeviceAdditionReturnTarget {
  
  kind: "connect-device" | "add-device";
  isCurrent(): boolean;
  
  onVisibilityChange?(visible: boolean): void;
  
  canFinish?(result: DeviceAdditionResult): Promise<boolean>;
  finish(result: DeviceAdditionResult): void | Promise<void>;
}

export interface RemoteConnectionOpenPreference {
  returnTarget?: DeviceAdditionReturnTarget;
  
  completion?: "device-management";
  
  initialFailure?: {
    code?: string;
    message: string;
    logs?: RemoteConnectionLogEntry[];
    profileId?: string;
    
    failedTarget?: SourceServerUpdateTarget;
    resolvedWslTarget?: Required<Extract<RemoteTarget, { kind: "wsl" }>>;
  };
  
  preferredDirectoryPath?: string;
  preferredWorkspaceTabId?: string;
  
  preferredProjectEntryId?: string;
  preferredTarget?: RemoteTarget;
  preferredKind?: RemoteTarget["kind"];
  preferredWslDistro?: string;
  preferredSourceServerId?: string;
  
  preferredProfileId?: string;
}

export interface AppProps {
  services: IServiceAccessor;
  baseFeedbackService: IFeedbackService;
  onConnectRemote: (options: RemoteTarget, requestId?: string) => Promise<string>;
  onSelectRemoteProject: (
    sessionId: string,
    path: string,
    localWorkspacePath?: string,
    preparedWorkspaceIdentity?: string,
    isCurrent?: () => boolean | Promise<boolean>,
  ) => Promise<void>;
  onCancelRemoteProject: (sessionId: string) => Promise<void>;
  onReconnectRemoteWorkspace: (workspaceKey: string) => Promise<void>;
  onLogout?: () => void;
  onLogin?: () => void;
  user?: UserInfo | null;
  reconnectingRemoteWorkspaceKeys: string[];
  remoteWorkspaceRecoveryByWorkspaceKey?: Record<string, RemoteWorkspaceRecoveryStatus>;
  remoteWorkspaceErrorByWorkspaceKey: Record<string, string>;

  remoteConnectionLogs?: RemoteConnectionLogEntry[];
  onCreateTask: (request?: CreateTaskRequest) => void;
  onCreateConversationTask?: () => void;
  onCreateConversationTaskOnSource?: (sourceServerId: string) => void;
  
  onResolveConversationWorkspace?: () => Promise<{
    workspacePath: string;
    workspaceIdentity?: string;
  }>;
  onOpenWorkspace: () => void;
  onOpenFolderFromWorkspaceMenu: () => void;
  onOpenRemoteWorkspace?: (preference?: RemoteConnectionOpenPreference) => void | boolean;
  remoteConnectionInProgress?: boolean;
  onReturnToWorkspace?: () => void;
  allowOpenWorkspace?: boolean;
  webRemoteControlWorkspaceSwitcher?: WebRemoteControlWorkspaceSwitcherApi;
  initialSidebarFileTreeOpen?: boolean;
  initialWebRemoteControlMobileNavigationIntent?: import("@origin-ai/cf-shared").WebRemoteControlMobileNavigationIntent;
  webRemoteControlTerminalTransportState?: WebRemoteControlTerminalTransportState;
  allowRemoteWorkspace?: boolean;
  remoteWorkspaceSessions?: RemoteWorkspaceSessionEntry[];
  workspaceAbsPath: string;
  workspaceRemoteSessionId?: string;
  workspaceIdentity?: string;
  isWorkspaceVisible?: boolean;
  isDesktop?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
  supportsEmbeddedBrowser?: boolean;
}

export interface GitChangeSummary {
  added: number;
  removed: number;
}

export type WorkspaceMainView = "chat" | "automations" | "plugin-store" | "repo-wiki";

export interface WorkspaceShellLayoutProps extends Omit<AppProps, "baseFeedbackService"> {
  workspaceReadOnlyReason?: string;
  workspaceMainView: WorkspaceMainView;
  pluginStoreOpenVersion: number;
  openAutomationId: string | null;
  openAutomationTab: AutomationsNavigationTab | null;
  
  openWorkflow: SavedWorkflowsOpenTarget | null;
  onOpenWorkflowConsumed: () => void;
  
  onOpenSavedWorkflowInHub: (target: SavedWorkflowHubTarget) => void;
  onWorkspaceMainViewChange: (view: WorkspaceMainView) => void;
  onOpenAutomationConsumed: () => void;
  handleOpenAutomations: OpenAutomationsMain;
  handleOpenPluginStore: () => void;
  onOpenRepoWiki?: () => void;
  repoWikiOpenVersion?: number;
  workspaceShellCfState: WorkspaceShellCfState;
  theme: Theme;
  isMacFullscreen: boolean;
  desktopWindowChromeState: DesktopWindowChromeState | null;
  macWindowControlsLeftPaddingPx: number;
  windowsWindowControlsRightPaddingPx: number;
  updateReadyVersion: string | null;
  updateState: UpdateStatePayload | null;
  sidebarContainerRef: RefObject<HTMLElement | null>;
  toggleSidebarShortcutLabel: string;
  newTaskShortcutLabel: string;
  goBackShortcutLabel: string;
  goForwardShortcutLabel: string;
  toggleSidePaneShortcutLabel: string;
  
  toggleSidePaneFullViewShortcutLabel?: string;
  canGoBack: boolean;
  canGoForward: boolean;
  canTaskNavBack: boolean;
  canTaskNavForward: boolean;
  isTerminalOpen: boolean;
  isSidebarVisible: boolean;
  isBrowserOpen: boolean;
  supportsEmbeddedBrowser: boolean;
  isGitOpen: boolean;
  isSidePaneOpen: boolean;
  
  sidePaneFullView?: SidePaneFullViewController;
  summaryPanelVariantOverride: ChatViewSummaryPanelVariant | null;
  onSummaryPanelVariantOverrideChange: (variant: ChatViewSummaryPanelVariant | null) => void;
  sidePaneState: WorkspaceSidePaneState | null;
  recentClosedSidePaneTabs: RecentClosedSidePaneTab[];
  shellPanelIds: string[];
  projectName: string;
  workspaceTabs: Array<{
    workspacePath: string;
    label: string;
    remoteSessionId?: string;
    remoteTarget?: import("@origin-ai/cf-shared").RemoteTarget;
    workspaceIdentity?: string;
    workspacePurpose?: import("@origin-ai/cf-shared").WorkspacePurpose;
    localWorkspacePath?: string;
    availability?: import("@/store/tabStore.js").WorkspaceAvailability;
  }>;
  activeTaskId: string | null;
  
  sidePaneOwnerId: string | null;
  activeTraceId: string | null;
  activeSessionId: string | null;
  activeTaskProvider: CfProvider | null;
  resolvedActiveTaskMeta?: CfTaskMeta | null;
  activeTaskTitle: string;
  activeTaskChangeSummary: ReturnType<
    typeof import("@/lib/taskChangeSummary.js").getTaskChangeSummary
  >;
  gitWorktreeReviewSourceId: GitChangeSourceId | null;
  gitWorktreeChangeSummary: GitChangeSummary;
  activeGitSourceId: GitChangeSourceId;
  gitState: ReturnType<typeof import("@/hooks/useGitRepository.js").useGitRepository>;
  browserNavigationRequest: BrowserNavigationRequest | null;
  browserRestoreUrls: Record<string, string>;
  providerConfigFile: ReturnType<
    typeof import("@/hooks/useWorkspaceProviderConfigFile.js").useWorkspaceProviderConfigFile
  >;
  taskNativeSessionLogFile: ReturnType<
    typeof import("@/hooks/useTaskNativeSessionLogFile.js").useTaskNativeSessionLogFile
  >;
  taskSessionFile: ReturnType<
    typeof import("@/hooks/useTaskSessionFilePath.js").useTaskSessionFilePath
  >;
  conversationFindActiveIndex: number;
  conversationFindNavigationRequestId: number;
  conversationFindQuery: string;
  onConversationFindMatchStateChange: (state: ConversationFindMatchState) => void;
  searchResultHighlightRequest?: ChatSearchResultHighlightRequest | null;
  onSearchResultHighlightDone?: (requestId: number) => void;
  fileChangeFindActiveIndex: number;
  fileChangeFindNavigationRequestId: number;
  fileChangeFindQuery: string;
  onFileChangeFindMatchCountChange: (count: number) => void;
  appLogoUrl: string;
  platform: IPlatformService;
  reloadSessionDisabled: boolean;
  reloadSessionPending: boolean;
  handleReloadSession: (options?: {
    resumeTaskId?: string | null;
    provider?: CfProvider | null;
  }) => Promise<void>;
  handleSelectTask: (
    targetWorkspacePath: string,
    taskId: string,
    targetWorkspaceIdentity?: string,
    expectedUnreadAt?: number,
  ) => void;
  handleTaskNavBack: () => void;
  handleTaskNavForward: () => void;
  handleStartDraftInWorkspace: (
    targetWorkspacePath: string,
    targetWorkspaceIdentity?: string,
    targetWorkspacePurpose?: import("@origin-ai/cf-shared").WorkspacePurpose,
    createSource?: SessionCreateSource,
  ) => void;
  handleOpenCommandCenter: () => void;
  handleRefreshGit: () => void;
  handleBrowserUrlChange: (tabId: string, url: string) => void;
  handleBrowserPageMetadataChange: (tabId: string, metadata: BrowserSidePaneMetadata) => void;
  handleToggleSidebar: () => void;
  handleToggleTerminal: () => void;
  handleToggleBrowser: () => void;
  handleOpenBrowserTab: () => void;
  handleOpenBrowserPermissionSettings: (origin: string) => void;
  handleOpenWhiteboard: () => void;
  handleOpenDeveloperTools: () => void;
  handleOpenFileManager: (target?: FileManagerTarget) => void;
  handleNavigateFileManager: (tabId: string, source: CodeViewerSource) => void;
  handleOpenPluginMarket: () => void;
  handleOpenTerminalTab: () => void;
  handleToggleGit: () => void;
  handleOpenGitReview: (sourceId?: GitChangeSourceId) => void;
  handleToggleSidePane: () => void;
  handleOpenBrowserUrl: (url: string) => void;
  handleOpenCodeViewer: (source: CodeViewerSource) => void;
  handleAutoOpenAssistantPptx: (request: AssistantPreviewCardsAutoOpenRequest) => void;
  handleOpenBackgroundBash: (request: OpenBackgroundBashSideTabRequest) => void;
  handleOpenSubagentSession: (request: OpenScopedSubagentSideTabRequest) => void;
  handleOpenSubagentDirectory: (
    request: import("@/lib/workspaceSidePane.js").OpenScopedSubagentDirectorySideTabRequest,
  ) => void;
  handleSyncSubagentSessionTabs: (
    request: import("@/lib/workspaceSidePane.js").SyncSubagentSessionTabsRequest,
  ) => void;
  handleOpenSelectionSideChat: (request: OpenSelectionSideChatRequest) => void;
  handleOpenPlanDetail: (request: OpenScopedPlanDetailSideTabRequest) => void;
  handleOpenWorkflowRun: (request: OpenScopedWorkflowRunSideTabRequest) => void;
  handleOpenWorkflowRunDirectory: (
    request: import("@/lib/workspaceSidePane.js").OpenScopedWorkflowRunDirectorySideTabRequest,
  ) => void;
  handleOpenWorkflowActorSession: (request: OpenScopedWorkflowActorSessionSideTabRequest) => void;
  handleOpenWorkflowWorkspace: (request: OpenScopedWorkflowWorkspaceSideTabRequest) => void;
  handleOpenWorkflowArtifact: (request: OpenScopedWorkflowArtifactSideTabRequest) => void;
  handleCloseCodeViewer: () => void;
  handleCloseGit: () => void;
  handleOpenNewSidePaneTab: () => void;
  handleActivateSidePaneTab: (tabId: string) => void;
  handleReorderSidePaneTab: (activeTabId: string, overTabId: string) => void;
  handleCloseSidePaneTab: (tabId: string) => void;
  handleCloseOtherSidePaneTabs: (tabId: string) => void;
  handleCloseAllSidePaneTabs: () => void;
  handleReopenClosedSidePaneTab: (tabId: string) => void;
  handleBrowserNavigationRequestHandled: (requestId: string) => void;
  setIsTerminalOpen: (open: boolean) => void;
  setGitSelectedSourceId: (value: GitChangeSourceId) => void;
  taskFindDialogProps: TaskFindDialogProps;
}
