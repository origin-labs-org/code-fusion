
import type {
  DockerConnectOptions,
  RemoteTarget,
  SSHConnectOptions,
  WSLConnectOptions,
} from "./remoteTarget.js";
import type { PluginSandboxPlatformPort } from "./mcp-apps/contract.js";
import type {
  LoadCliMcpFromUserDirectoryRequest,
  LoadCliMcpFromUserDirectoryResult,
  MigrateLegacyCommonMcpRequest,
  MigrateLegacyCommonMcpResult,
  SaveCliMcpToUserDirectoryRequest,
} from "./mcp.js";
import type { OAuthStateRegistration } from "./oauth.js";
import type {
  WebRemoteControlAuthStateChange,
  WebRemoteControlContext,
  WebRemoteControlReconnectWorkspaceResult,
  WebRemoteControlStartOperationResult,
  WebRemoteControlStatus,
  WebRemoteControlReconnectWorkspaceRequest,
  WebRemoteControlWorkspaceTarget,
} from "./web-remote-control.js";
import type { AppSettings, Locale } from "./protocol.js";
import type { ArmsCustomEventPayload, RendererTelemetryEventPayload } from "./telemetry.js";
import type {
  RendererActionTraceBatchV1,
  RendererActionTraceConfigV1,
} from "./rendererActionTrace.js";
import type { RendererHeapSample } from "./validation.js";
import type {
  CuaAccessibilitySettingsResult,
  OpenCuaPermissionOnboardingOptions,
  PrepareCuaHelperPermissionDragResult,
} from "./cuaAccessibilitySettings.js";
import type { BrowserViewportSize } from "./browser-use/command-metadata.js";
import type {
  PostUpdateReleaseNotesPayload,
  UpdateCheckResultPayload,
  UpdateStatePayload,
} from "./update.js";
export type {
  PostUpdateReleaseNotesPayload,
  UpdateCheckResultPayload,
  UpdateStatePayload,
} from "./update.js";

export interface TaskNotificationPayload {
  taskId: string;
  status: "completed" | "failed" | "permission_request" | "elicitation_request" | "feedback_update";
  requestId?: string;
  title: string;
  body: string;
}

export interface BrowserViewOperationPayload {
  workspaceKey: string;
  remoteSessionId?: string;
  sessionId: string;
  tabId: string;
  browserId: string;
  browserGeneration: number;
  
  resetsResizeBaseline?: boolean;
}

export type BrowserTabResidencyState =
  | "live-visible"
  | "live-background"
  | "suspend-pending"
  | "suspended"
  | "restoring";

export const BROWSER_VIEW_RESTORE_BOOTSTRAP_URL = "cf-browser-restore://pending";

export interface BrowserViewResidencyReportPayload {
  tabId: string;
  workspaceKey: string;
  remoteSessionId?: string;
  sessionId: string;
  selected: boolean;
  visible: boolean;
  currentTask: boolean;
  loading: boolean;
  restoreUrl?: string | null;
  title?: string | null;
  faviconUrl?: string | null;
}

export interface BrowserViewResidencyTransitionPayload {
  tabId: string;
  workspaceKey: string;
  remoteSessionId: string | undefined;
  sessionId: string;
  browserId: string;
  browserGeneration: number;
  generation: number;
  residency: Extract<
    BrowserTabResidencyState,
    "live-visible" | "live-background" | "suspended" | "restoring"
  >;
}

export interface BrowserViewCloseTabRequest {
  tabId: string;
  workspaceKey: string;
  remoteSessionId?: string;
  sessionId: string;
}

export const LOCAL_MEDIA_PREVIEW_SCHEME = "cf-media";

export function buildLocalMediaPreviewUrl(path: string): string {
  const url = new URL(`${LOCAL_MEDIA_PREVIEW_SCHEME}://local/preview`);
  url.searchParams.set("path", path);
  return url.toString();
}

export interface BrowserViewCloseTabNotification {
  tabId: string;
  workspaceKey?: string;
  remoteSessionId?: string;
  sessionId?: string;
  reason?: "recovery-orphan";
}

export interface BrowserViewRestoredTabShell {
  tabId: string;
  workspaceKey: string;
  remoteSessionId?: string;
  sessionId: string;
  browserId: string;
  browserGeneration: number;
  origin: "agent" | "user";
  restoreUrl: string | null;
  title: string | null;
  faviconUrl: string | null;
  openedAt: number;
  lastSelectedAt: number | null;
}

export interface BrowserViewRestoreTabsRequest {
  workspaceKey: string;
  remoteSessionId?: string;
  sessionId?: string;
}

export interface BrowserViewViewportChangedPayload extends BrowserViewOperationPayload {
  viewport: BrowserViewportSize | null;
}

export const BROWSER_SCREENSHOT_SURFACE_PREPARE_TIMEOUT_MS = 3_000;

export type BrowserViewSurfaceScaleMode = "current" | "unscaled";

export interface BrowserViewScreenshotSurfacePreparePayload extends BrowserViewOperationPayload {
  requestId: string;
  webContentsId: number;
  viewport: BrowserViewportSize;
  
  viewportMode?: "natural" | "emulated";
  
  surfaceScaleMode?: BrowserViewSurfaceScaleMode;
  
  timeoutMs?: number;
}

export interface BrowserViewScreenshotSurfaceReadyPayload extends BrowserViewScreenshotSurfacePreparePayload {
  surfaceScale: number;
}

export type BrowserViewScreenshotSurfaceReleasePayload = Omit<
  BrowserViewScreenshotSurfacePreparePayload,
  "viewport" | "viewportMode" | "surfaceScaleMode" | "timeoutMs"
>;

export type BrowserGuestAttachRejectReason =
  | "not-found"
  | "destroyed"
  | "not-webview"
  | "closed"
  | "window-mismatch"
  | "workspace-mismatch"
  | "session-mismatch"
  | "remote-session-mismatch"
  | "residency-suspended"
  | "residency-generation-mismatch";

export type BrowserGuestAttachResult =
  | { ok: true; guestGeneration: number }
  | { ok: false; reason: BrowserGuestAttachRejectReason; recoveryRequested: boolean };

export interface EditorInfo {
  
  id: string;
  
  name: string;
  
  iconDataUrl: string;
}

export interface ApplicationIconInfo {
  iconDataUrl: string;
}

export type ApplicationIconLocator =
  | { kind: "darwin-bundle-id"; value: string }
  | { kind: "windows-executable-path"; value: string }
  | { kind: "windows-aumid"; value: string };

export interface ApplicationIconRequest {
  locators: ApplicationIconLocator[];
}

export type OpenInEditorRemoteTarget =
  | Pick<SSHConnectOptions, "kind" | "host" | "port" | "username" | "sshConfigAlias">
  | Pick<WSLConnectOptions, "kind" | "distro" | "user">
  | Pick<DockerConnectOptions, "kind" | "container">;

export interface OpenInEditorOptions {
  remoteTarget?: OpenInEditorRemoteTarget;
  workspaceIdentity?: string;
  pathKind?: "file" | "directory";
}

export interface CreateTempTextAttachmentRequest {
  text: string;
  filename?: string;
}

export interface CreateTempTextAttachmentResult {
  filename: string;
  localPath: string;
  mimeType: "text/plain";
  sizeBytes: number;
}

export interface MaterializeWorkflowArtifactFileRequest {
  runId: string;
  artifactId: string;
  
  version: number;
  
  fileName: string;
  bytes: Uint8Array;
}

export interface MaterializeWorkflowArtifactFileResult {
  
  localPath: string;
}

export type SaveFileRequest =
  | {
      data: ArrayBuffer;
      sourceUrl?: never;
      suggestedName: string;
    }
  | {
      data?: never;
      sourceUrl: string;
      suggestedName: string;
    };

export interface SaveFileResult {
  canceled?: boolean;
  error?: string;
  path?: string;
  success: boolean;
}

export interface PrintPageToPdfResult {
  success: boolean;
  
  data?: ArrayBuffer;
  /** "print_in_progress" | "print_failed" */
  error?: string;
}

export function createOpenInEditorRemoteTarget(
  target: RemoteTarget,
): OpenInEditorRemoteTarget | undefined {
  switch (target.kind) {
    case "ssh":
      return {
        kind: "ssh",
        host: target.host,
        port: target.port,
        username: target.username,
        ...(target.sshConfigAlias?.trim() ? { sshConfigAlias: target.sshConfigAlias.trim() } : {}),
      };
    case "wsl": {
      const user = target.user?.trim();
      return {
        kind: "wsl",
        distro: target.distro,
        ...(user ? { user } : {}),
      };
    }
    case "docker":
      return {
        kind: "docker",
        container: target.container,
      };
    case "server":
      return undefined;
  }
}

export interface WSLDistro {
  name: string;
  isDefault: boolean;
  state: string;
  version: 1 | 2 | null;
}

export interface DockerContainerInfo {
  id: string;
  image: string;
  name: string;
  state: string;
  status: string;
}

export interface SSHConfigAliasOption {
  alias: string;
  host?: string;
  port?: number;
  username?: string;
  privateKeyPath?: string;
  source?: string;
}

export interface CfStdioTapDevState {
  enabled: boolean;
  visible: boolean;
  logDir: string;
  statePath: string;
}

export type DesktopTitleBarTheme = "light" | "dark" | "system";

export interface WindowScreenshotResult {
  dataBase64: string;
  filename: string;
  contentType: string;
  size: number;
}

export type ChromeBrowserDataImportError =
  | "chrome_profile_not_found"
  | "chrome_profile_ambiguous"
  | "chrome_executable_not_found"
  | "chrome_cookie_access_denied"
  | "chrome_cookie_elevation_required"
  | "chrome_cookie_elevation_cancelled"
  | "chrome_cookie_helper_verification_failed"
  | "chrome_cookie_app_bound_decryption_failed"
  | "chrome_cookie_protection_unsupported"
  | "chrome_profile_locked"
  | "chrome_local_storage_import_failed"
  | "chrome_import_not_supported"
  | "chrome_browser_data_import_unavailable"
  | "chrome_data_import_failed"
  | "chrome_default_profile_not_found";

export interface ChromeBrowserDataImportOptions {
  
  allowElevatedChromeDecryption?: boolean;
}

export interface ChromeBrowserDataImportResult {
  success: boolean;
  cookies: {
    imported: number;
    skipped: number;
    failed: number;
  };
  localStorage: {
    originsImported: number;
    entriesImported: number;
    originsSkipped: number;
    originsFailed: number;
    error?: ChromeBrowserDataImportError;
  };
  
  issues?: ChromeBrowserDataImportError[];
  error?: ChromeBrowserDataImportError;
}

export interface EmbeddedBrowserDataClearResult {
  success: boolean;
  error?: string;
}

export interface WindowControlsOverlayMetrics {
  leftPaddingPx?: number;
  rightPaddingPx?: number;
  titleBarHeightPx?: number;
}

export interface WindowControlsOverlayReadyPayload {
  zoomLevel: number;
  metrics: WindowControlsOverlayMetrics;
}

export interface DesktopZoomState {
  zoomLevel: number;
}

export interface DesktopCloseToTrayCapability {
  
  supported: boolean;
  
  gnomeLikeWithoutTray: boolean;
}

export interface DesktopWindowChromeState {
  isMaximized: boolean;
  
  macOSMajorVersion?: number | null;
  supportsNativeRoundedCorners: boolean;
}

export interface RemoteServiceSession {
  sessionId: string;
}

export interface RemoteConnectionRuntimeLog {
  label: string;
  requestId?: string;
  sessionId?: string;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
  timestamp: string;
}

export interface RemoteSessionClosedEvent {
  sessionId: string;
  reason: "host-exit";
  exitCode: number | null;
  signal: string | null;
  error?: string;
  
  recoverable?: boolean;
  recoveryAttempt?: number;
  recoveryLimit?: number;
  recoveryBudgetExhausted?: boolean;
  reasonCode?: string;
  retryable?: boolean;
}

export interface RemoteSessionReconnectedEvent {
  previousSessionId: string;
  sessionId: string;
  workspacePath: string;
  workspaceIdentity: string;
}

export interface EmbeddedBrowserOpenUrlRequest {
  url: string;
  disposition: "default" | "foreground-tab" | "background-tab" | "new-window" | "other";
  
  workspaceKey?: string;
  remoteSessionId?: string;
  sessionId?: string;
  browserId?: string;
  browserGeneration?: number;
  sourceTabId?: string;
}

export interface EmbeddedBrowserPermissionDeviceOption {
  deviceId: string;
  name?: string;
  vendorId?: number;
  productId?: number;
  serialNumber?: string;
}

export interface EmbeddedBrowserPermissionScreenOption {
  sourceId: string;
  name: string;
  
  kind: "screen" | "window";
  thumbnailDataUrl?: string;
}

export type EmbeddedBrowserPermissionPromptEvent =
  | {
      requestId: string;
      kind: "permission";
      origin: string;
      permission: string;
      mediaTypes?: string[];
      
      guestWebContentsId?: number;
    }
  | {
      requestId: string;
      kind: "screen-share";
      origin: string;
      screens: EmbeddedBrowserPermissionScreenOption[];
      
      guestWebContentsId?: number;
    }
  | {
      requestId: string;
      kind: "device";
      origin: string;
      /** select-hid-device / select-usb-device / select-serial-port / select-bluetooth-device */
      permission: string;
      devices: EmbeddedBrowserPermissionDeviceOption[];
      
      guestWebContentsId?: number;
    };

export type EmbeddedBrowserPermissionResolution =
  | { action: "allow-always" }
  | { action: "allow-session" }
  | { action: "block-always" }
  | { action: "dismiss" }
  | { action: "share-screen"; sourceId: string }
  | { action: "select-device"; deviceId: string }
  | { action: "cancel" };

export interface EmbeddedBrowserPermissionResolveRequest {
  requestId: string;
  resolution: EmbeddedBrowserPermissionResolution;
}

export type EmbeddedBrowserSitePermissionsSnapshot = Record<
  string,
  Record<string, "allow" | "deny">
>;

export interface EmbeddedBrowserSitePermissionUpdateRequest {
  origin: string;
  permission: string;
  
  state: "allow" | "deny" | "ask";
}

export interface EmbeddedBrowserSitePermissionResetRequest {
  origin: string;
}

export interface ConnectRemoteRequest {
  target: RemoteTarget;
  requestId?: string;
  workspacePath?: string;
  workspaceIdentity?: string;
  connectTrigger?: import("./remoteUsageTelemetry.js").RemoteWorkspaceConnectTrigger;
  confirmSourceServerInstall?: boolean;
}

export interface CancelPendingRemoteConnectionRequest {
  requestId?: string;
}

export interface BindRemoteWorkspaceSessionContextRequest {
  remoteSessionId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  workspacePurpose?: import("./workspacePurpose.js").WorkspacePurpose;
}

export interface BindRemoteWorkspaceSessionContextResult {
  sourceServerId?: string;
  remoteSessionId: string;
  workspacePath: string;
  workspaceIdentity: string;
  workspacePurpose?: import("./workspacePurpose.js").WorkspacePurpose;
  
  previousWorkspaceIdentity?: string;
}

export type BindRemoteWorkspaceSessionContextIpcResult =
  | { success: true; result: BindRemoteWorkspaceSessionContextResult }
  | {
      success: false;
      error: string;
      reasonCode?: string;
      retryable?: boolean;
    };

export const DesktopCommandIds = {
  NewTask: "newTask",
  OpenWorkspace: "openWorkspace",
  CloseActiveContext: "closeActiveContext",
  CloseWindow: "closeWindow",
  MinimizeWindow: "minimizeWindow",
  ToggleMaximizeWindow: "toggleMaximizeWindow",
  ToggleFullScreen: "toggleFullScreen",
  ResetWindowSize: "resetWindowSize",
  ResetZoom: "resetZoom",
  ZoomIn: "zoomIn",
  ZoomOut: "zoomOut",
  ShowAbout: "showAbout",
  OpenChangelog: "openChangelog",
  CheckForUpdates: "checkForUpdates",
  RelaunchApp: "relaunchApp",
  OpenFeedback: "openFeedback",
  OpenCommunity: "openCommunity",
  ExportLogs: "exportLogs",
  ToggleDevTools: "toggleDevTools",
  OpenResourceManager: "openResourceManager",
  ToggleCfStdioTapDevProxy: "toggleCfStdioTapDevProxy",
  SetCfEndpointProduction: "setCfEndpointProduction",
  SetCfEndpointTest: "setCfEndpointTest",
  SetCfEndpointCustom: "setCfEndpointCustom",
  ResetCfEndpoint: "resetCfEndpoint",
  ClearAllData: "clearAllData",
  ClearCodingPlanWebviewStorage: "clearCodingPlanWebviewStorage",
  GetCuaOsSupport: "getCuaOsSupport",
} as const;

export type DesktopCommandId = (typeof DesktopCommandIds)[keyof typeof DesktopCommandIds];

export type CuaOsSupport =
  | { kind: "supported" }
  | { kind: "macos-below-minimum"; minimumMacOs: string; currentMacOs: string }
  | { kind: "not-applicable" };

export interface IPlatformService {
  
  canOpenLocalFiles?: boolean;

  
  canSelectFilePath?: boolean;

  
  pluginSandbox?: PluginSandboxPlatformPort;

  
  selectDirectory(): Promise<string | null>;

  
  selectDirectories?(): Promise<string[]>;

  
  selectFile(): Promise<string | null>;

  
  selectFiles?(): Promise<string[]>;

  
  saveFile?(payload: SaveFileRequest): Promise<SaveFileResult>;

  
  printPageToPdf?(): Promise<PrintPageToPdfResult>;

  
  getPathForFile?(file: unknown): string | null;

  
  createLocalMediaPreviewUrl?(path: string): string;

  
  createTempTextAttachment?(
    payload: CreateTempTextAttachmentRequest,
  ): Promise<CreateTempTextAttachmentResult>;

  
  materializeWorkflowArtifactFile?(
    payload: MaterializeWorkflowArtifactFileRequest,
  ): Promise<MaterializeWorkflowArtifactFileResult>;

  
  onRemoteConnectionLog(handler: (entry: RemoteConnectionRuntimeLog) => void): () => void;

  
  onRemoteSessionClosed(handler: (event: RemoteSessionClosedEvent) => void): () => void;

  
  onRemoteSessionReconnected?(handler: (event: RemoteSessionReconnectedEvent) => void): () => void;

  
  activateOrSetWorkspace(path: string): Promise<{ activated: boolean }>;

  
  connectRemote(
    options: RemoteTarget,
    requestId?: string,
    context?: {
      workspacePath?: string;
      workspaceIdentity?: string;
      connectTrigger?: import("./remoteUsageTelemetry.js").RemoteWorkspaceConnectTrigger;
      confirmSourceServerInstall?: boolean;
    },
  ): Promise<{
    success: boolean;
    error?: string;
    reasonCode?: string;
    retryable?: boolean;
    sessionId?: string;
    
    reusedConnectionTarget?: RemoteTarget;
    
    profileId?: string;
    
    resolvedWslTarget?: Required<WSLConnectOptions>;
  }>;

  
  requestSourceSettingsAttachment?(sourceServerId: string): Promise<{ attachmentId: string }>;

  
  cancelPendingRemoteConnection?(requestId?: string): Promise<void>;

  
  bindRemoteWorkspaceSessionContext?(
    context: BindRemoteWorkspaceSessionContextRequest,
  ): Promise<BindRemoteWorkspaceSessionContextResult>;

  
  startWebRemoteControl(
    context: WebRemoteControlContext,
  ): Promise<WebRemoteControlStartOperationResult>;

  
  stopWebRemoteControl(): Promise<void>;

  
  getWebRemoteControlStatus(): Promise<WebRemoteControlStatus>;

  
  notifyWebRemoteControlAuthStateChanged?(change: WebRemoteControlAuthStateChange): void;

  
  onWebRemoteControlStatusChanged?(handler: (status: WebRemoteControlStatus) => void): () => void;

  
  disposeRemoteSession(sessionId: string): Promise<void>;

  
  isDockerAvailable(): Promise<boolean>;

  
  listWSLDistros(): Promise<WSLDistro[]>;

  
  listDockerContainers(): Promise<DockerContainerInfo[]>;

  
  listSSHConfigAliases(): Promise<SSHConfigAliasOption[]>;

  
  loadMcpFromUserDirectory?(
    payload?: LoadCliMcpFromUserDirectoryRequest,
  ): Promise<LoadCliMcpFromUserDirectoryResult>;

  
  saveMcpToUserDirectory?(
    payload: SaveCliMcpToUserDirectoryRequest,
  ): Promise<{ success: boolean; error?: string }>;

  
  migrateLegacyCommonMcp?(
    payload?: MigrateLegacyCommonMcpRequest,
  ): Promise<MigrateLegacyCommonMcpResult>;

  
  openExternal(url: string): void;

  
  getApplicationIcon?(
    request: string | ApplicationIconRequest,
  ): Promise<ApplicationIconInfo | null>;

  
  openFeedback(): Promise<void>;

  
  onOpenFeedbackDialog?(handler: () => void): () => void;

  
  onOpenTicketsPanel?(handler: () => void): () => void;

  
  openCommunity(): Promise<void>;

  
  canOpenCommunity(locale: Locale): Promise<boolean>;

  
  openInFileManager(path: string): Promise<{ success: boolean; error?: string }>;

  
  openExternalFile?(path: string): Promise<{ success: boolean; error?: string }>;

  
  openCuaPermissionOnboarding?(
    options?: OpenCuaPermissionOnboardingOptions,
  ): Promise<CuaAccessibilitySettingsResult>;
  
  cancelCuaPermissionOnboarding?(operationId: string): void;
  
  prepareCuaHelperPermissionDrag?(): Promise<PrepareCuaHelperPermissionDragResult>;
  
  startCuaHelperPermissionDrag?(): void;

  
  registerOAuthState(payload: OAuthStateRegistration): void;

  
  onOAuthCallback(callback: (url: string) => void): () => void;

  
  onPaymentCallback(callback: (url: string) => void): () => void;

  
  onShareImport?(callback: (payload: { shareCode: string }) => void): () => void;

  
  notifyRendererReady(): void;

  
  showTaskNotification(payload: TaskNotificationPayload): void;

  
  reportTelemetryEvent(payload: RendererTelemetryEventPayload): Promise<void>;

  
  reportArmsCustomEvent(payload: ArmsCustomEventPayload): Promise<void>;

  
  getRendererActionTraceConfig?(): Promise<RendererActionTraceConfigV1>;
  
  onRendererActionTraceConfigChanged?(
    callback: (config: RendererActionTraceConfigV1) => void,
  ): () => void;
  
  reportRendererActionTraceBatch?(batch: RendererActionTraceBatchV1): void;
  reportLocalTtftBatch?(batch: import("./localTtft.js").LocalTtftBatch): void;

  
  reportRendererHeapSample?(sample: RendererHeapSample): void;

  
  syncWindowTabs(paths: string[]): void;

  
  syncWebRemoteControlWorkspaces?(workspaces: WebRemoteControlWorkspaceTarget[]): void;

  
  onWebRemoteControlReconnectWorkspace?(
    handler: (
      request: WebRemoteControlReconnectWorkspaceRequest,
    ) => Promise<WebRemoteControlReconnectWorkspaceResult>,
  ): () => void;

  
  syncWindowUnreadCount(count: number): void;
  
  syncActiveTaskSession(sessionId: string | null): void;

  
  syncAppSettings?(patch: Partial<AppSettings>): void;

  
  getCloseToTrayCapability?(): Promise<DesktopCloseToTrayCapability>;

  
  setShortcutRecordingActive?(active: boolean): void;

  
  onFocusTab(handler: (path: string) => void): () => void;

  
  onNewTab(handler: () => void): () => void;

  
  onCloseActiveContextRequest?(handler: () => void): () => void;

  
  onOpenBrowserUrl?(handler: (request: EmbeddedBrowserOpenUrlRequest) => void): () => void;
  
  onEmbeddedBrowserPermissionPrompt?(
    handler: (event: EmbeddedBrowserPermissionPromptEvent) => void,
  ): () => void;
  
  resolveEmbeddedBrowserPermissionPrompt?(request: EmbeddedBrowserPermissionResolveRequest): void;
  
  getEmbeddedBrowserSitePermissions?(): Promise<EmbeddedBrowserSitePermissionsSnapshot>;
  
  setEmbeddedBrowserSitePermission?(
    request: EmbeddedBrowserSitePermissionUpdateRequest,
  ): Promise<EmbeddedBrowserSitePermissionsSnapshot>;
  
  clearEmbeddedBrowserSitePermissions?(): Promise<EmbeddedBrowserSitePermissionsSnapshot>;
  
  resetEmbeddedBrowserSitePermission?(
    request: EmbeddedBrowserSitePermissionResetRequest,
  ): Promise<EmbeddedBrowserSitePermissionsSnapshot>;
  
  onBrowserViewReady?(
    handler: (payload: {
      workspaceKey: string;
      remoteSessionId?: string;
      sessionId: string;
      tabId: string;
      browserId: string;
      browserGeneration: number;
    }) => void,
  ): () => void;

  
  onBrowserViewOperation?(handler: (payload: BrowserViewOperationPayload) => void): () => void;

  
  onBrowserViewVisibility?(
    handler: (payload: {
      visible: boolean;
      workspaceKey: string;
      remoteSessionId: string | undefined;
      sessionId: string;
      tabId?: string;
      browserId: string;
      browserGeneration: number;
    }) => void,
  ): () => void;

  
  onBrowserViewViewportChanged?(
    handler: (payload: BrowserViewViewportChangedPayload) => void,
  ): () => void;

  
  onBrowserViewScreenshotSurfacePrepare?(
    handler: (payload: BrowserViewScreenshotSurfacePreparePayload) => void,
  ): () => void;

  
  onBrowserViewScreenshotSurfaceRelease?(
    handler: (payload: BrowserViewScreenshotSurfaceReleasePayload) => void,
  ): () => void;

  
  browserViewScreenshotSurfaceReady?(payload: BrowserViewScreenshotSurfaceReadyPayload): void;

  onBrowserViewCloseTab?(handler: (payload: BrowserViewCloseTabNotification) => void): () => void;

  
  onBrowserViewSuspend?(
    handler: (payload: BrowserViewResidencyTransitionPayload) => void,
  ): () => void;

  
  onBrowserViewRestore?(
    handler: (payload: BrowserViewResidencyTransitionPayload) => void,
  ): () => void;

  
  onNewTask(handler: () => void): () => void;

  
  onOpenWorkspace(handler: () => void): () => void;

  
  onOpenWorkspacePath?(handler: (path: string) => void): () => void;

  
  onWindowFullscreenChanged(handler: (isFullscreen: boolean) => void): () => void;

  
  getDesktopWindowChromeState?(): Promise<DesktopWindowChromeState>;

  
  onDesktopWindowChromeStateChanged?(
    handler: (state: DesktopWindowChromeState) => void,
  ): () => void;

  
  getWindowControlsOverlayMetrics?(): WindowControlsOverlayMetrics | null;

  
  onWindowControlsOverlayChanged?(
    handler: (metrics: WindowControlsOverlayMetrics) => void,
  ): () => void;

  
  getDesktopZoomLevel?(): Promise<DesktopZoomState>;

  
  onDesktopZoomLevelChanged?(handler: (state: DesktopZoomState) => void): () => void;

  
  onTaskNotificationClick(handler: (taskId: string) => void): () => void;

  
  exportLogs(): Promise<{ success: boolean; path?: string; error?: string }>;

  
  captureWindowScreenshot?(): Promise<WindowScreenshotResult | null>;

  
  browserViewAttachGuest?(payload: {
    key: string;
    webContentsId: number;
    active?: boolean;
    workspaceKey?: string;
    remoteSessionId?: string;
    
    sessionId?: string;
    residencyGeneration?: number;
  }): Promise<BrowserGuestAttachResult>;

  
  browserViewDetachGuest?(payload: { key: string; webContentsId: number }): Promise<boolean>;

  
  browserViewCloseTab?(payload: BrowserViewCloseTabRequest): Promise<void>;

  
  browserViewReportResidency?(payload: BrowserViewResidencyReportPayload): Promise<void>;

  
  browserViewSuspendReady?(payload: { tabId: string; generation: number }): Promise<void>;

  
  browserViewEnsureResident?(payload: BrowserViewCloseTabRequest): Promise<void>;

  
  browserViewRestoreTabs?(
    payload: BrowserViewRestoreTabsRequest,
  ): Promise<BrowserViewRestoredTabShell[]>;

  
  browserViewUpdateViewport?(payload: {
    tabId: string;
    viewport: BrowserViewportSize | null;
  }): Promise<void>;

  
  importChromeBrowserData?(
    options?: ChromeBrowserDataImportOptions,
  ): Promise<ChromeBrowserDataImportResult>;

  
  clearEmbeddedBrowserData?(mode: "cache" | "all"): Promise<EmbeddedBrowserDataClearResult>;

  
  onUpdateReady(callback: (version: string) => void): () => void;

  
  onUpdateCheckResult(callback: (payload: UpdateCheckResultPayload) => void): () => void;

  
  onUpdateStateChanged?(callback: (payload: UpdateStatePayload) => void): () => void;

  
  getUpdateState?(): Promise<UpdateStatePayload>;

  
  downloadUpdate(): Promise<void>;

  
  cancelUpdateDownload(): Promise<void>;

  
  openUpdateStatusWindow?(): Promise<void>;

  
  getAutoUpdatePreferences?(): Promise<{
    autoDownloadAndInstallUpdates: boolean;
  }>;

  
  setAutoDownloadAndInstallUpdates?(enabled: boolean): Promise<void>;

  
  skipUpdateVersion(version: string): Promise<void>;

  
  getDesktopSessionActivity?(): Promise<{
    runningAgentSessionCount: number;
  }>;

  
  getCfStdioTapDevState?(): Promise<CfStdioTapDevState>;

  
  isLocalDevelopmentRuntime?: boolean;

  
  onSettingsChanged?(callback: () => void): () => void;

  
  onApplicationLocaleChanged?(callback: (locale: Locale) => void): () => void;

  
  getSystemLocale?(): Promise<Locale>;

  
  onPostUpdateReleaseNotes(callback: (payload: PostUpdateReleaseNotesPayload) => void): () => void;

  
  acknowledgePostUpdateReleaseNotes(version: string): Promise<void>;

  
  quitAndInstallUpdate(): Promise<void>;

  
  getInstalledEditors(filePath?: string): Promise<EditorInfo[]>;

  
  openInEditor(
    editorId: string,
    path: string,
    options?: OpenInEditorOptions,
  ): Promise<{ success: boolean; error?: string }>;

  
  executeDesktopCommand(command: DesktopCommandId): Promise<unknown>;

  
  setApplicationLocale(locale: Locale): Promise<void>;

  
  setTitleBarTheme(theme: DesktopTitleBarTheme): Promise<void>;

  
  getDeviceId(): string;
}
