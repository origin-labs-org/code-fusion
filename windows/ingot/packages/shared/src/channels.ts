import type { WebRemoteControlAuthStateChange } from "./web-remote-control.js";

import type {
  ResourceUsageSnapshot,
  LoadCliMcpFromUserDirectoryRequest,
  LoadCliMcpFromUserDirectoryResult,
  MigrateLegacyCommonMcpRequest,
  MigrateLegacyCommonMcpResult,
  SaveCliMcpToUserDirectoryRequest,
} from "./index.js";
import type { OAuthStateRegistration } from "./oauth.js";
import type {
  WebRemoteControlContext,
  WebRemoteControlReconnectWorkspaceRequest,
  WebRemoteControlReconnectWorkspaceResult,
  WebRemoteControlStartOperationResult,
  WebRemoteControlStatus,
  WebRemoteControlWorkspaceTarget,
} from "./web-remote-control.js";
import type { AppSettings, Locale } from "./protocol.js";
import type { StorageCleanRequest, StorageCleanResult, StorageUsageSnapshot } from "./storage.js";
import type {
  ArmsCustomEventPayload,
  ConfigureFinalArmsCustomEventE2ERequest,
  FinalArmsCustomEventE2EEntry,
  RendererTelemetryEventPayload,
  TelemetryRendererContext,
} from "./telemetry.js";
import type {
  RendererActionTraceBatchV1,
  RendererActionTraceConfigV1,
} from "./rendererActionTrace.js";
import type { RendererHeapSample } from "./validation.js";
import type {
  CancelPendingRemoteConnectionRequest,
  BindRemoteWorkspaceSessionContextRequest,
  BrowserViewScreenshotSurfacePreparePayload,
  BrowserViewScreenshotSurfaceReadyPayload,
  BrowserViewScreenshotSurfaceReleasePayload,
  BrowserViewCloseTabNotification,
  BrowserViewCloseTabRequest,
  BrowserViewResidencyReportPayload,
  BrowserViewResidencyTransitionPayload,
  BrowserViewRestoredTabShell,
  BrowserViewRestoreTabsRequest,
  BrowserViewViewportChangedPayload,
  ConnectRemoteRequest,
  DesktopCommandId,
  DesktopTitleBarTheme,
  DockerContainerInfo,
  EmbeddedBrowserOpenUrlRequest,
  EmbeddedBrowserPermissionPromptEvent,
  EmbeddedBrowserPermissionResolveRequest,
  EmbeddedBrowserSitePermissionUpdateRequest,
  EmbeddedBrowserSitePermissionResetRequest,
  EmbeddedBrowserSitePermissionsSnapshot,
  EditorInfo,
  CreateTempTextAttachmentRequest,
  CreateTempTextAttachmentResult,
  MaterializeWorkflowArtifactFileRequest,
  MaterializeWorkflowArtifactFileResult,
  SaveFileRequest,
  SaveFileResult,
  PrintPageToPdfResult,
  OpenInEditorOptions,
  PostUpdateReleaseNotesPayload,
  RemoteSessionClosedEvent,
  RemoteSessionReconnectedEvent,
  SSHConfigAliasOption,
  TaskNotificationPayload,
  WSLDistro,
  UpdateCheckResultPayload,
  UpdateStatePayload,
  DesktopZoomState,
  DesktopWindowChromeState,
  WindowControlsOverlayMetrics,
  WindowControlsOverlayReadyPayload,
} from "./platform.js";
import type { BrowserViewportSize } from "./browser-use/command-metadata.js";
import type {
  CuaAccessibilitySettingsResult,
  OpenCuaPermissionOnboardingOptions,
  PrepareCuaHelperPermissionDragResult,
} from "./cuaAccessibilitySettings.js";

// ============================================================================
// ============================================================================

export const ServiceChannels = {
  File: "file",
  MediaPreview: "media-preview",
  System: "system",
  Terminal: "terminal",
  
  Git: "git",
  
  GitCheckpoint: "git-checkpoint",
  Setting: "setting",
  
  Credential: "credential",
  
  CuaPermission: "cua-permission",
  /** producer-owned PiP session presentation client */
  CuaPipSession: "cua-pip-session",
  
  Broadcast: "broadcast",
  
  CfTask: "cf-task",
  
  WindowController: "window-controller",
  
  CfAgent: "cf-agent",
  
  CfSession: "cf-session",
  Project: "project",
  TaskGroups: "task-groups",
  RemoteProjects: "remote-projects",
  
  WindowProject: "window-project",
  WindowRemoteProjects: "window-remote-projects",
  WindowProjectChanges: "window-project-changes",
  
  ConversationShare: "conversation-share",
  
  FileWatcher: "file-watcher",
  
  OAuth: "oauth",
  
  ProviderSettings: "provider-settings",
  
  ModelSelection: "model-selection",
  
  ProviderProvisioningTarget: "provider-provisioning-target",
  
  SourceServerWorkspace: "source-server-workspace",
  
  SourceServerManagement: "source-server-management",
  
  UsageStats: "usage-stats",
  
  CodingPlanSubscription: "coding-plan-subscription",
  ClientConfig: "client-config",
  
  ClientScenes: "client-scenes",
  CloudContent: "cloud-content",
  MarketingTouch: "marketing-touch",
  
  Skills: "skills",
  
  SkillSync: "skill-sync",
  
  McpSync: "mcp-sync",
  
  PluginSync: "plugin-sync",
  
  Plugins: "plugins",
  
  PluginManagement: "plugin-management",
  
  PluginUiBridge: "plugin-ui-bridge",
  PluginUiSampling: "plugin-ui-sampling",
  PluginUiAppTools: "plugin-ui-app-tools",
  
  Subagents: "subagents",
  
  Commands: "commands",
  
  Hooks: "hooks",
  
  Memory: "memory",

  RepoWiki: "repo-wiki",
    
  OutputStyle: "output-style",
  
  SettingsSync: "settings-sync",
  
  Bots: "bots",
  
  Feedback: "feedback",
  
  PromptAttachmentTransfer: "prompt-attachment-transfer",
  
  OffPeakTask: "off-peak-task",
  
  HighspeedCard: "highspeed-card",
  
  OnboardingRecord: "onboarding-record",
} as const;

export type ServiceChannelName = (typeof ServiceChannels)[keyof typeof ServiceChannels];

// ============================================================================
// ============================================================================

export const PlatformChannels = {
  
  PluginSandboxDispose: "cf:plugin-sandbox-dispose",
  PluginSandboxCopyImage: "cf:plugin-sandbox-copy-image",
  PluginSandboxExecutionActive: "cf:plugin-sandbox-execution-active",
  
  PluginSandboxConsumeUserGesture: "cf:plugin-sandbox-consume-user-gesture",
  
  PluginSandboxOwnerWebContentsId: "cf:plugin-sandbox-owner-web-contents-id",
  
  SelectDirectory: "cf:select-directory",
  
  SelectDirectories: "cf:select-directories",
  
  SelectFile: "cf:select-file",
  
  SelectFiles: "cf:select-files",
  
  CreateTempTextAttachment: "cf:create-temp-text-attachment",
  
  MaterializeWorkflowArtifactFile: "cf:materialize-workflow-artifact-file",
  
  SaveFile: "cf:save-file",
  
  PrintToPdf: "cf:print-to-pdf",
  
  RemoteConnectionLog: "cf:remote-connection-log",
  
  RemoteSessionClosed: "cf:remote-session-closed",
  
  RemoteSessionReconnected: "cf:remote-session-reconnected",
  
  ActivateOrSetWorkspace: "cf:activate-or-set-workspace",
  
  ConnectRemote: "cf:connect-remote",
  
  RequestSourceSettingsAttachment: "cf:request-source-settings-attachment",
  
  CancelPendingRemoteConnection: "cf:cancel-pending-remote-connection",
  
  BindRemoteWorkspaceSessionContext: "cf:bind-remote-workspace-session-context",
  
  StartWebRemoteControl: "cf:start-web-remote-control",
  
  StopWebRemoteControl: "cf:stop-web-remote-control",
  
  GetWebRemoteControlStatus: "cf:get-web-remote-control-status",
  
  WebRemoteControlAuthStateChanged: "cf:web-remote-control-auth-state-changed",
  
  WebRemoteControlStatusChanged: "cf:web-remote-control-status-changed",
  
  DisposeRemoteSession: "cf:dispose-remote-session",
  
  IsDockerAvailable: "cf:is-docker-available",
  
  ListWSLDistros: "cf:list-wsl-distros",
  
  ListDockerContainers: "cf:list-docker-containers",
  
  ListSSHConfigAliases: "cf:list-ssh-config-aliases",
  
  LoadMcpFromUserDirectory: "cf:load-mcp-from-user-directory",
  
  SaveMcpToUserDirectory: "cf:save-mcp-to-user-directory",
  
  GetCloseToTrayCapability: "cf:get-close-to-tray-capability",
  
  Log: "cf:log",
  
  SyncWindowTabs: "cf:sync-window-tabs",
  
  SyncWebRemoteControlWorkspaces: "cf:sync-web-remote-control-workspaces",
  
  WebRemoteControlReconnectWorkspace: "cf:web-remote-control-reconnect-workspace",
  
  SyncWindowUnreadCount: "cf:sync-window-unread-count",
  
  SyncActiveTaskSession: "cf:sync-active-task-session",
  
  SyncAppSettings: "cf:sync-app-settings",
  
  SetShortcutRecordingActive: "cf:set-shortcut-recording-active",
  
  FocusTab: "cf:focus-tab",
  
  NewTab: "cf:new-tab",
  
  CloseActiveContextRequest: "cf:close-active-context-request",
  
  OpenBrowserUrl: "cf:open-browser-url",
  
  EmbeddedBrowserPermissionPrompt: "cf:embedded-browser-permission-prompt",
  
  EmbeddedBrowserPermissionResolve: "cf:embedded-browser-permission-resolve",
  
  BrowserViewReady: "cf:browser-view-ready",
  
  BrowserViewOperation: "cf:browser-view-operation",
  
  BrowserViewVisibility: "cf:browser-view-visibility",
  
  BrowserViewViewportChanged: "cf:browser-view-viewport-changed",
  
  BrowserViewScreenshotSurfacePrepare: "cf:browser-view-screenshot-surface-prepare",
  
  BrowserViewScreenshotSurfaceReady: "cf:browser-view-screenshot-surface-ready",
  
  BrowserViewScreenshotSurfaceRelease: "cf:browser-view-screenshot-surface-release",
  
  BrowserViewCloseTab: "cf:browser-view-close-tab",
  
  BrowserViewSuspend: "cf:browser-view-suspend",
  
  BrowserViewRestore: "cf:browser-view-restore",
  
  NewTask: "cf:new-task",
  
  OpenWorkspace: "cf:open-workspace",
  
  OpenWorkspacePath: "cf:open-workspace-path",
  
  OpenFeedbackDialog: "cf:open-feedback-dialog",
  
  OpenTicketsPanel: "cf:open-tickets-panel",
  
  WindowFullscreenChanged: "cf:window-fullscreen-changed",
  
  GetDesktopWindowChromeState: "cf:get-desktop-window-chrome-state",
  
  DesktopWindowChromeStateChanged: "cf:desktop-window-chrome-state-changed",
  
  WindowControlsOverlayChanged: "cf:window-controls-overlay-changed",
  
  WindowControlsOverlayReady: "cf:window-controls-overlay-ready",
  
  GetResourceUsageSnapshot: "cf:get-resource-usage-snapshot",
  SetResourceUsageSamplingActive: "cf:set-resource-usage-sampling-active",
  GetNetworkCaptureSnapshot: "cf:get-network-capture-snapshot",
  ClearNetworkCapture: "cf:clear-network-capture",
  
  OpenResourceManager: "cf:open-resource-manager",
  
  StorageStartScan: "cf:storage-start-scan",
  
  StorageCancelScan: "cf:storage-cancel-scan",
  
  StorageGetSnapshot: "cf:storage-get-snapshot",
  
  StorageClean: "cf:storage-clean",
  
  StorageRevealPath: "cf:storage-reveal-path",
  
  StorageScanProgress: "cf:storage-scan-progress",
  
  OpenExternal: "cf:open-external",
  
  CanOpenCommunity: "cf:can-open-community",
  
  OpenInFileManager: "cf:open-in-file-manager",
  
  OpenExternalFile: "cf:open-external-file",
  
  OpenCuaPermissionOnboarding: "cf:open-cua-permission-onboarding",
  
  CancelCuaPermissionOnboarding: "cf:cancel-cua-permission-onboarding",
  
  PrepareCuaHelperPermissionDrag: "cf:prepare-cua-helper-permission-drag",
  
  StartCuaHelperPermissionDrag: "cf:start-cua-helper-permission-drag",
  
  NotifyCuaHelperPermissionDragEnded: "cf:notify-cua-helper-permission-drag-ended",
  
  OAuthRegisterState: "cf:oauth-register-state",
  
  OAuthCallback: "cf:oauth-callback",
  
  PaymentCallback: "cf:payment-callback",
  
  ShareImport: "cf:share-import",
  
  OAuthCallbackHandled: "cf:oauth-callback-handled",
  
  RendererReady: "cf:renderer-ready",
  
  SyncTelemetryContext: "cf:sync-telemetry-context",
  
  ReportTelemetryEvent: "cf:report-telemetry-event",
  
  ReportArmsCustomEvent: "cf:report-arms-custom-event",
  
  GetRendererActionTraceConfig: "cf:get-renderer-action-trace-config",
  
  RendererActionTraceConfigChanged: "cf:renderer-action-trace-config-changed",
  
  ReportRendererActionTraceBatch: "cf:report-renderer-action-trace-batch",
  
  ReportRendererHeapSample: "cf:report-renderer-heap-sample",
  ReportLocalTtftBatch: "cf:report-local-ttft-batch",
  
  ReadFinalArmsCustomEventsE2E: "cf:e2e:read-final-arms-custom-events",
  
  ClearFinalArmsCustomEventsE2E: "cf:e2e:clear-final-arms-custom-events",
  
  ConfigureFinalArmsCustomEventsE2E: "cf:e2e:configure-final-arms-custom-events",
  
  ShowTaskNotification: "cf:show-task-notification",
  
  TaskNotificationSound: "cf:task-notification-sound",
  
  TaskNotificationClick: "cf:task-notification-click",
  
  ExportLogs: "cf:export-logs",
  
  CaptureWindowScreenshot: "cf:capture-window-screenshot",
  
  BrowserViewAttachGuest: "cf:browser-view-attach-guest",
  
  BrowserViewDetachGuest: "cf:browser-view-detach-guest",
  
  BrowserViewCloseTabFromRenderer: "cf:browser-view-close-tab-from-renderer",
  
  BrowserViewReportResidency: "cf:browser-view-report-residency",
  
  BrowserViewSuspendReady: "cf:browser-view-suspend-ready",
  
  BrowserViewEnsureResident: "cf:browser-view-ensure-resident",
  
  BrowserViewRestoreTabs: "cf:browser-view-restore-tabs",
  
  BrowserViewUpdateViewport: "cf:browser-view-update-viewport",
  
  EmbeddedBrowserJavaScriptDialog: "cf:embedded-browser-javascript-dialog",
  
  ImportChromeBrowserData: "cf:import-chrome-browser-data",
  
  ClearEmbeddedBrowserData: "cf:clear-embedded-browser-data",
  
  GetEmbeddedBrowserSitePermissions: "cf:get-embedded-browser-site-permissions",
  
  SetEmbeddedBrowserSitePermission: "cf:set-embedded-browser-site-permission",
  
  ClearEmbeddedBrowserSitePermissions: "cf:clear-embedded-browser-site-permissions",
  
  ResetEmbeddedBrowserSitePermission: "cf:reset-embedded-browser-site-permission",
  
  UpdateReady: "cf:update-ready",
  
  UpdateCheckResult: "cf:update-check-result",
  
  UpdateStateChanged: "cf:update-state-changed",
  
  GetUpdateState: "cf:get-update-state",
  
  DownloadUpdate: "cf:download-update",
  
  CancelUpdateDownload: "cf:cancel-update-download",
  
  OpenUpdateStatusWindow: "cf:open-update-status-window",
  
  GetAutoUpdatePreferences: "cf:get-auto-update-preferences",
  
  SetAutoDownloadAndInstallUpdates: "cf:set-auto-download-and-install-updates",
  
  GetDesktopSessionActivity: "cf:get-desktop-session-activity",
  
  GetDesktopZoomLevel: "cf:get-desktop-zoom-level",
  
  DesktopZoomLevelChanged: "cf:desktop-zoom-level-changed",
  
  GetCfStdioTapDevState: "cf:get-cf-stdio-tap-dev-state",
  
  SettingsChanged: "cf:settings-changed",
  
  ApplicationLocaleChanged: "cf:application-locale-changed",
  
  GetSystemLocale: "cf:get-system-locale",
  
  PostUpdateReleaseNotes: "cf:post-update-release-notes",
  
  AcknowledgePostUpdateReleaseNotes: "cf:ack-post-update-release-notes",
  
  SkipUpdateVersion: "cf:skip-update-version",
  
  QuitAndInstallUpdate: "cf:quit-and-install-update",
  
  GetInstalledEditors: "cf:get-installed-editors",
  
  GetApplicationIcon: "cf:get-application-icon",
  
  OpenInEditor: "cf:open-in-editor",
  
  ExecuteDesktopCommand: "cf:execute-desktop-command",
  
  SetApplicationLocale: "cf:set-application-locale",
  
  SetTitleBarTheme: "cf:set-title-bar-theme",
  
  MigrateLegacyCommonMcp: "cf:migrate-legacy-common-mcp",
  
  GetDeviceId: "cf:get-device-id",
} as const;

export type PlatformChannelName = (typeof PlatformChannels)[keyof typeof PlatformChannels];

// ============================================================================
// ============================================================================

export const EmbeddedBrowserWebviewChannels = {
  
  WheelBoundary: "cf:embedded-browser-wheel-boundary",
} as const;

export interface EmbeddedBrowserWheelBoundaryPayload {
  deltaX: number;
  deltaY: number;
}

// ============================================================================
// ============================================================================

export const CodingPlanWebviewChannels = {
  
  PurchaseComplete: "cf:coding-plan-purchase-complete",
} as const;

export const PluginSandboxChannels = {
  
  Init: "cf:plugin-sandbox-init",
} as const;

export interface CodingPlanPurchaseCompletePayload {
  provider: "zai" | "bigmodel";
  
  timestamp: number;
}

export type CodingPlanWebviewLocale = "zh-CN" | "en-US";

export interface CodingPlanWebviewLangChangeDetail {
  locale: CodingPlanWebviewLocale;
}

// ============================================================================
// ============================================================================

export const InternalChannels = {
  DatabaseStartupState: "cf:database-startup-state",
  DatabaseStartupControl: "cf:database-startup-control",
  
  ServicePort: "cf:service-port",
  
  ScopedServicePort: "cf:scoped-service-port",
  
  ScopedServicePortReady: "cf:scoped-service-port-ready",
  
  SourceSettingsServicePort: "cf:source-settings-service-port",
  
  TaskNotificationSound: "cf:task-notification-sound",
  
  PluginSandboxPorts: "cf:plugin-sandbox-ports",
} as const;

export const CF_RPC_CLIENT_MODE_HEADER = "x-cf-rpc-client-mode";

export const CF_RPC_HOST_CAPABILITY_HEADER = "x-cf-rpc-host-capability";

// ============================================================================
// ============================================================================

export const HostMessageTypes = {
  
  PrepareProjectWorkspace: "prepare-project-workspace",
  DatabaseStartupControl: "database-startup-control",
  
  InitLocal: "init-local",
  
  ConnectRemoteWorkspace: "connect-remote-workspace",
  
  CancelRemoteWorkspaceConnect: "cancel-remote-workspace-connect",
  
  BindRemoteWorkspaceContext: "bind-remote-workspace-context",
  
  CancelRemoteWorkspaceBind: "cancel-remote-workspace-bind",
  
  DisposeRemoteWorkspaceSession: "dispose-remote-workspace-session",
  
  AttachServicePort: "attach-service-port",
  
  DetachServicePort: "detach-service-port",
  
  Dispose: "dispose",
  
  Broadcast: "broadcast",
  
  BroadcastClaimResult: "broadcast-claim-result",
  /** main → host：task realtime invalidation delivery */
  TaskRealtimeDeliver: "task-realtime-deliver",
  /** main → host：task run lease acquire result */
  TaskRunLeaseResult: "task-run-lease-result",
  /** main → host：deliver owner-only task command */
  TaskOwnerCommandDeliver: "task-owner-command-deliver",
  /** main → host：deliver owner command result to requester */
  TaskOwnerCommandResult: "task-owner-command-result",
  
  SessionMessageDeliver: "session-message-deliver",
  
  SessionMessageDeliveryResult: "session-message-delivery-result",
  
  FeedbackLogArchiveResult: "feedback-log-archive-result",
  
  CronRun: "cron-run",
  
  OffPeakRun: "off-peak-run",
  
  BrowserExecuteResult: "browser-execute-result",
  
  LocalMediaPreviewPathAuthorizeResult: "local-media-preview-path-authorize-result",
  
  PluginSandboxRegisterResult: "plugin-sandbox-register-result",
  
  CuaPipFocusChanged: "cua-pip-focus-changed",
  
  ProviderProvisioningExecute: "provider-provisioning-execute",
  
  ResourceUsageSnapshotRequest: "resource-usage-snapshot-request",
  ResourceUsageSnapshotCancel: "resource-usage-snapshot-cancel",
  NetworkCapture: "network-capture",
  
  ApplicationLocaleChanged: "application-locale-changed",
} as const;

export const HostResponseTypes = {
  
  ProjectWorkspacePrepared: "project-workspace-prepared",
  DatabaseStartupState: "database-startup-state",
  
  RemoteWorkspaceConnectionLog: "remote-workspace-connection-log",
  
  RemoteWorkspaceConnected: "remote-workspace-connected",
  
  RemoteWorkspaceContextBound: "remote-workspace-context-bound",
  
  RemoteWorkspaceContextBindFailed: "remote-workspace-context-bind-failed",
  
  RemoteWorkspaceReconnected: "remote-workspace-reconnected",
  
  RemoteWorkspaceConnectFailed: "remote-workspace-connect-failed",
  
  RemoteWorkspaceClosed: "remote-workspace-closed",
  
  Log: "log",
  
  AgentProcessSpawned: "agent-process-spawned",
  
  AgentProcessReady: "agent-process-ready",
  
  AgentProcessExited: "agent-process-exited",
  
  AgentProcessError: "agent-process-error",
  AgentProcessException: "agent-process-exception",
  
  AgentResourceSample: "agent-resource-sample",
  
  HostResourceSample: "host-resource-sample",
  
  McpTelemetry: "mcp-telemetry",
  McpResourceSamples: "mcp-resource-samples",
  ToolExecResource: "tool-exec-resource",
  
  SessionCreateTelemetry: "session-create-telemetry",
  PluginTelemetry: "plugin-telemetry",
  
  ResourceUsageSnapshotResult: "resource-usage-snapshot-result",
  NetworkCaptureBatch: "network-capture-batch",
  
  AgentRunningTaskCountChanged: "agent-running-task-count-changed",
  
  WorkspaceRunningTaskCountChanged: "workspace-running-task-count-changed",
  
  CuaOperationState: "cua-operation-state",
  
  RemoteWorkspaceAcquired: "remote-workspace-acquired",
  
  Broadcast: "broadcast",
  
  BroadcastClaimRequest: "broadcast-claim-request",
  
  BroadcastClaimCommit: "broadcast-claim-commit",
  
  BroadcastClaimRelease: "broadcast-claim-release",
  
  TaskRealtimePublish: "task-realtime-publish",
  
  TaskStreamOpPublish: "task-stream-op-publish",
  
  TaskRunLeaseAcquire: "task-run-lease-acquire",
  
  TaskRunLeaseRelease: "task-run-lease-release",
  
  TaskOwnerCommandRequest: "task-owner-command-request",
  
  TaskOwnerCommandResult: "task-owner-command-result",
  
  SessionMessageSendRequested: "session-message-send-requested",
  
  SessionRouteAnnounce: "session-route-announce",
  
  SessionMessageDeliverResult: "session-message-deliver-result",
  
  FeedbackLogArchiveRequest: "feedback-log-archive-request",
  
  CronRunResult: "cron-run-result",
  
  OffPeakRunResult: "off-peak-run-result",
  
  CronSchedulerWakeRequest: "cron-scheduler-wake-request",
  
  OffPeakSchedulerWakeRequest: "off-peak-scheduler-wake-request",
  
  BrowserExecuteRequest: "browser-execute-request",
  
  LocalMediaPreviewPathAuthorizeRequest: "local-media-preview-path-authorize-request",
  
  PluginSandboxRegisterRequest: "plugin-sandbox-register-request",
  
  NetworkTelemetryBatch: "network-telemetry-batch",
  
  ProviderProvisioningSourceChanged: "provider-provisioning-source-changed",
  
  ProviderProvisioningExecutionResult: "provider-provisioning-execution-result",
} as const;

// ============================================================================
// ============================================================================

export interface PlatformChannelMap {
  [PlatformChannels.SelectDirectory]: {
    request: void;
    response: string | null;
  };
  [PlatformChannels.SelectDirectories]: {
    request: void;
    response: string[];
  };
  [PlatformChannels.SelectFile]: {
    request: void;
    response: string | null;
  };
  [PlatformChannels.SelectFiles]: {
    request: void;
    response: string[];
  };
  [PlatformChannels.CreateTempTextAttachment]: {
    request: CreateTempTextAttachmentRequest;
    response: CreateTempTextAttachmentResult;
  };
  [PlatformChannels.MaterializeWorkflowArtifactFile]: {
    request: MaterializeWorkflowArtifactFileRequest;
    response: MaterializeWorkflowArtifactFileResult;
  };
  [PlatformChannels.SaveFile]: {
    request: SaveFileRequest;
    response: SaveFileResult;
  };
  [PlatformChannels.PrintToPdf]: {
    request: void;
    response: PrintPageToPdfResult;
  };
  [PlatformChannels.RemoteConnectionLog]: {
    request: {
      label: string;
      requestId?: string;
      sessionId?: string;
      level: "info" | "warn" | "error";
      source: string;
      message: string;
      timestamp: string;
    };
    response: void;
  };
  [PlatformChannels.RemoteSessionClosed]: {
    request: RemoteSessionClosedEvent;
    response: void;
  };
  [PlatformChannels.RemoteSessionReconnected]: {
    request: RemoteSessionReconnectedEvent;
    response: void;
  };
  [PlatformChannels.ActivateOrSetWorkspace]: {
    request: string;
    response: { activated: boolean };
  };
  [PlatformChannels.OpenWorkspacePath]: {
    request: string;
    response: void;
  };
  [PlatformChannels.ConnectRemote]: {
    request: ConnectRemoteRequest;
    response: {
      success: boolean;
      error?: string;
      reasonCode?: string;
      retryable?: boolean;
      sessionId?: string;
    };
  };
  [PlatformChannels.RequestSourceSettingsAttachment]: {
    request: { sourceServerId: string };
    response: { attachmentId: string };
  };
  [PlatformChannels.CancelPendingRemoteConnection]: {
    request: CancelPendingRemoteConnectionRequest;
    response: void;
  };
  [PlatformChannels.BindRemoteWorkspaceSessionContext]: {
    request: BindRemoteWorkspaceSessionContextRequest;
    response: import("./platform.js").BindRemoteWorkspaceSessionContextIpcResult;
  };
  [PlatformChannels.StartWebRemoteControl]: {
    request: WebRemoteControlContext;
    response: WebRemoteControlStartOperationResult;
  };
  [PlatformChannels.StopWebRemoteControl]: {
    request: void;
    response: void;
  };
  [PlatformChannels.WebRemoteControlAuthStateChanged]: {
    request: WebRemoteControlAuthStateChange;
    response: void;
  };
  [PlatformChannels.GetWebRemoteControlStatus]: {
    request: void;
    response: WebRemoteControlStatus;
  };
  [PlatformChannels.WebRemoteControlStatusChanged]: {
    request: WebRemoteControlStatus;
    response: void;
  };
  [PlatformChannels.DisposeRemoteSession]: {
    request: string;
    response: void;
  };
  [PlatformChannels.IsDockerAvailable]: {
    request: void;
    response: boolean;
  };
  [PlatformChannels.ListWSLDistros]: {
    request: void;
    response: WSLDistro[];
  };
  [PlatformChannels.ListDockerContainers]: {
    request: void;
    response: DockerContainerInfo[];
  };
  [PlatformChannels.ListSSHConfigAliases]: {
    request: void;
    response: SSHConfigAliasOption[];
  };
  [PlatformChannels.LoadMcpFromUserDirectory]: {
    request: LoadCliMcpFromUserDirectoryRequest;
    response: LoadCliMcpFromUserDirectoryResult;
  };
  [PlatformChannels.SaveMcpToUserDirectory]: {
    request: SaveCliMcpToUserDirectoryRequest;
    response: { success: boolean; error?: string };
  };
  [PlatformChannels.MigrateLegacyCommonMcp]: {
    request: MigrateLegacyCommonMcpRequest;
    response: MigrateLegacyCommonMcpResult;
  };
  [PlatformChannels.Log]: {
    request: { level: "info" | "warn" | "error"; args: unknown[] };
    response: void;
  };
  [PlatformChannels.SyncWebRemoteControlWorkspaces]: {
    request: WebRemoteControlWorkspaceTarget[];
    response: void;
  };
  [PlatformChannels.WebRemoteControlReconnectWorkspace]: {
    request: WebRemoteControlReconnectWorkspaceRequest;
    response: WebRemoteControlReconnectWorkspaceResult;
  };
  [PlatformChannels.SyncWindowUnreadCount]: {
    request: number;
    response: void;
  };
  [PlatformChannels.SyncAppSettings]: {
    request: Partial<AppSettings>;
    response: void;
  };
  [PlatformChannels.GetResourceUsageSnapshot]: {
    request: void;
    response: ResourceUsageSnapshot;
  };
  [PlatformChannels.SetResourceUsageSamplingActive]: {
    request: boolean;
    response: void;
  };
  [PlatformChannels.StorageStartScan]: {
    request: void;
    response: { jobId: string };
  };
  [PlatformChannels.StorageCancelScan]: {
    request: string;
    response: void;
  };
  [PlatformChannels.StorageGetSnapshot]: {
    request: void;
    response: StorageUsageSnapshot | null;
  };
  [PlatformChannels.StorageClean]: {
    request: StorageCleanRequest;
    response: StorageCleanResult;
  };
  [PlatformChannels.StorageRevealPath]: {
    request: string;
    response: void;
  };
  [PlatformChannels.OpenExternal]: {
    request: string;
    response: void;
  };
  [PlatformChannels.OpenBrowserUrl]: {
    request: EmbeddedBrowserOpenUrlRequest;
    response: void;
  };
  [PlatformChannels.EmbeddedBrowserPermissionPrompt]: {
    request: EmbeddedBrowserPermissionPromptEvent;
    response: void;
  };
  [PlatformChannels.EmbeddedBrowserPermissionResolve]: {
    request: EmbeddedBrowserPermissionResolveRequest;
    response: void;
  };
  [PlatformChannels.GetEmbeddedBrowserSitePermissions]: {
    request: void;
    response: EmbeddedBrowserSitePermissionsSnapshot;
  };
  [PlatformChannels.SetEmbeddedBrowserSitePermission]: {
    request: EmbeddedBrowserSitePermissionUpdateRequest;
    response: EmbeddedBrowserSitePermissionsSnapshot;
  };
  [PlatformChannels.ClearEmbeddedBrowserSitePermissions]: {
    request: void;
    response: EmbeddedBrowserSitePermissionsSnapshot;
  };
  [PlatformChannels.ResetEmbeddedBrowserSitePermission]: {
    request: EmbeddedBrowserSitePermissionResetRequest;
    response: EmbeddedBrowserSitePermissionsSnapshot;
  };
  [PlatformChannels.BrowserViewReady]: {
    request: {
      workspaceKey: string;
      remoteSessionId?: string;
      sessionId: string;
      tabId: string;
      browserId: string;
      browserGeneration: number;
    };
    response: void;
  };
  [PlatformChannels.BrowserViewVisibility]: {
    request: {
      visible: boolean;
      workspaceKey: string;
      remoteSessionId: string | undefined;
      sessionId: string;
      tabId?: string;
      browserId: string;
      browserGeneration: number;
    };
    response: void;
  };
  [PlatformChannels.BrowserViewViewportChanged]: {
    request: BrowserViewViewportChangedPayload;
    response: void;
  };
  [PlatformChannels.BrowserViewScreenshotSurfacePrepare]: {
    request: BrowserViewScreenshotSurfacePreparePayload;
    response: void;
  };
  [PlatformChannels.BrowserViewScreenshotSurfaceReady]: {
    request: BrowserViewScreenshotSurfaceReadyPayload;
    response: void;
  };
  [PlatformChannels.BrowserViewScreenshotSurfaceRelease]: {
    request: BrowserViewScreenshotSurfaceReleasePayload;
    response: void;
  };
  [PlatformChannels.BrowserViewCloseTab]: {
    request: BrowserViewCloseTabNotification;
    response: void;
  };
  [PlatformChannels.BrowserViewSuspend]: {
    request: BrowserViewResidencyTransitionPayload;
    response: void;
  };
  [PlatformChannels.BrowserViewRestore]: {
    request: BrowserViewResidencyTransitionPayload;
    response: void;
  };
  [PlatformChannels.CanOpenCommunity]: {
    request: Locale;
    response: boolean;
  };
  [PlatformChannels.OpenInFileManager]: {
    request: string;
    response: { success: boolean; error?: string };
  };
  [PlatformChannels.OpenExternalFile]: {
    request: string;
    response: { success: boolean; error?: string };
  };
  [PlatformChannels.OpenCuaPermissionOnboarding]: {
    request: OpenCuaPermissionOnboardingOptions | undefined;
    response: CuaAccessibilitySettingsResult;
  };
  [PlatformChannels.PrepareCuaHelperPermissionDrag]: {
    request: undefined;
    response: PrepareCuaHelperPermissionDragResult;
  };
  [PlatformChannels.StartCuaHelperPermissionDrag]: {
    request: undefined;
    response: void;
  };
  [PlatformChannels.NotifyCuaHelperPermissionDragEnded]: {
    request: undefined;
    response: void;
  };
  [PlatformChannels.CancelCuaPermissionOnboarding]: {
    request: { operationId: string };
    response: void;
  };
  [PlatformChannels.OAuthRegisterState]: {
    request: OAuthStateRegistration;
    response: void;
  };
  [PlatformChannels.OAuthCallback]: {
    request: string;
    response: void;
  };
  [PlatformChannels.PaymentCallback]: {
    request: string;
    response: void;
  };
  [PlatformChannels.ShareImport]: {
    request: { shareCode: string };
    response: void;
  };
  [PlatformChannels.OAuthCallbackHandled]: {
    request: void;
    response: void;
  };
  [PlatformChannels.RendererReady]: {
    request: void;
    response: void;
  };
  [PlatformChannels.SyncTelemetryContext]: {
    request: TelemetryRendererContext;
    response: void;
  };
  [PlatformChannels.ReportTelemetryEvent]: {
    request: RendererTelemetryEventPayload;
    response: void;
  };
  [PlatformChannels.ReportArmsCustomEvent]: {
    request: ArmsCustomEventPayload;
    response: void;
  };
  [PlatformChannels.GetRendererActionTraceConfig]: {
    request: void;
    response: RendererActionTraceConfigV1;
  };
  [PlatformChannels.RendererActionTraceConfigChanged]: {
    request: RendererActionTraceConfigV1;
    response: void;
  };
  [PlatformChannels.ReportRendererActionTraceBatch]: {
    request: RendererActionTraceBatchV1;
    response: void;
  };
  [PlatformChannels.ReportRendererHeapSample]: {
    request: RendererHeapSample;
    response: void;
  };
  [PlatformChannels.ReadFinalArmsCustomEventsE2E]: {
    request: void;
    response: FinalArmsCustomEventE2EEntry[];
  };
  [PlatformChannels.ClearFinalArmsCustomEventsE2E]: {
    request: void;
    response: void;
  };
  [PlatformChannels.ConfigureFinalArmsCustomEventsE2E]: {
    request: ConfigureFinalArmsCustomEventE2ERequest;
    response: void;
  };
  [PlatformChannels.ShowTaskNotification]: {
    request: TaskNotificationPayload;
    response: void;
  };
  [PlatformChannels.TaskNotificationSound]: {
    request: void;
    response: void;
  };
  [PlatformChannels.TaskNotificationClick]: {
    request: string;
    response: void;
  };
  [PlatformChannels.WindowFullscreenChanged]: {
    request: boolean;
    response: void;
  };
  [PlatformChannels.GetDesktopWindowChromeState]: {
    request: void;
    response: DesktopWindowChromeState;
  };
  [PlatformChannels.DesktopWindowChromeStateChanged]: {
    request: DesktopWindowChromeState;
    response: void;
  };
  [PlatformChannels.WindowControlsOverlayChanged]: {
    request: WindowControlsOverlayMetrics;
    response: void;
  };
  [PlatformChannels.WindowControlsOverlayReady]: {
    request: WindowControlsOverlayReadyPayload;
    response: void;
  };
  [PlatformChannels.ExportLogs]: {
    request: void;
    response: { success: boolean; path?: string; error?: string };
  };
  [PlatformChannels.CaptureWindowScreenshot]: {
    request: void;
    response: {
      dataBase64: string;
      filename: string;
      contentType: string;
      size: number;
    } | null;
  };
  [PlatformChannels.BrowserViewAttachGuest]: {
    request: {
      key: string;
      webContentsId: number;
      active?: boolean;
      workspaceKey?: string;
      remoteSessionId?: string;
      sessionId?: string;
      residencyGeneration?: number;
    };
    response: void;
  };
  [PlatformChannels.BrowserViewDetachGuest]: {
    request: { key: string; webContentsId: number };
    response: boolean;
  };
  [PlatformChannels.BrowserViewCloseTabFromRenderer]: {
    request: BrowserViewCloseTabRequest;
    response: void;
  };
  [PlatformChannels.BrowserViewReportResidency]: {
    request: BrowserViewResidencyReportPayload;
    response: void;
  };
  [PlatformChannels.BrowserViewSuspendReady]: {
    request: { tabId: string; generation: number };
    response: void;
  };
  [PlatformChannels.BrowserViewEnsureResident]: {
    request: BrowserViewCloseTabRequest;
    response: void;
  };
  [PlatformChannels.BrowserViewRestoreTabs]: {
    request: BrowserViewRestoreTabsRequest;
    response: BrowserViewRestoredTabShell[];
  };
  [PlatformChannels.BrowserViewUpdateViewport]: {
    request: { tabId: string; viewport: BrowserViewportSize | null };
    response: void;
  };
  [PlatformChannels.EmbeddedBrowserJavaScriptDialog]: {
    request: {
      type: "alert" | "confirm";
      message: string;
    };
    response: {
      handled: boolean;
      value?: boolean;
    };
  };
  [PlatformChannels.UpdateReady]: {
    request: string;
    response: void;
  };
  [PlatformChannels.UpdateCheckResult]: {
    request: UpdateCheckResultPayload;
    response: void;
  };
  [PlatformChannels.UpdateStateChanged]: {
    request: UpdateStatePayload;
    response: void;
  };
  [PlatformChannels.GetUpdateState]: {
    request: void;
    response: UpdateStatePayload;
  };
  [PlatformChannels.DownloadUpdate]: {
    request: void;
    response: void;
  };
  [PlatformChannels.CancelUpdateDownload]: {
    request: void;
    response: void;
  };
  [PlatformChannels.OpenUpdateStatusWindow]: {
    request: void;
    response: void;
  };
  [PlatformChannels.GetAutoUpdatePreferences]: {
    request: void;
    response: {
      autoDownloadAndInstallUpdates: boolean;
    };
  };
  [PlatformChannels.SetAutoDownloadAndInstallUpdates]: {
    request: boolean;
    response: void;
  };
  [PlatformChannels.SettingsChanged]: {
    request: void;
    response: void;
  };
  [PlatformChannels.ApplicationLocaleChanged]: {
    request: Locale;
    response: void;
  };
  [PlatformChannels.GetSystemLocale]: {
    request: void;
    response: Locale;
  };
  [PlatformChannels.GetDesktopSessionActivity]: {
    request: void;
    response: {
      runningAgentSessionCount: number;
    };
  };
  [PlatformChannels.GetDesktopZoomLevel]: {
    request: void;
    response: DesktopZoomState;
  };
  [PlatformChannels.DesktopZoomLevelChanged]: {
    request: DesktopZoomState;
    response: void;
  };
  [PlatformChannels.PostUpdateReleaseNotes]: {
    request: PostUpdateReleaseNotesPayload;
    response: void;
  };
  [PlatformChannels.AcknowledgePostUpdateReleaseNotes]: {
    request: string;
    response: void;
  };
  [PlatformChannels.SkipUpdateVersion]: {
    request: string;
    response: void;
  };
  [PlatformChannels.QuitAndInstallUpdate]: {
    request: void;
    response: void;
  };
  [PlatformChannels.GetInstalledEditors]: {
    request: string | undefined;
    response: EditorInfo[];
  };
  [PlatformChannels.GetApplicationIcon]: {
    request: string | import("./platform.js").ApplicationIconRequest;
    response: import("./platform.js").ApplicationIconInfo | null;
  };
  [PlatformChannels.OpenInEditor]: {
    request: { editorId: string; path: string; options?: OpenInEditorOptions };
    response: { success: boolean; error?: string };
  };
  [PlatformChannels.CloseActiveContextRequest]: {
    request: void;
    response: void;
  };
  [PlatformChannels.ExecuteDesktopCommand]: {
    request: DesktopCommandId;
    response: unknown;
  };
  [PlatformChannels.SetApplicationLocale]: {
    request: Locale;
    response: void;
  };
  [PlatformChannels.SetTitleBarTheme]: {
    request: DesktopTitleBarTheme;
    response: void;
  };
}
