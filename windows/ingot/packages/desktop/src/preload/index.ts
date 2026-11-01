import { installPluginSandboxHostBridge } from "./pluginSandbox/hostBridge.js";
import {
  databaseStartupControlSchema,
  databaseStartupStateSchema,
  databaseStartupPortPayloadSchema,
} from "@origin-ai/cf-shared";

import { contextBridge, ipcRenderer, webFrame, webUtils } from "electron";
import {
  installArmsRumBridgeIpcForward,
  scheduleArmsEventBridgePatch,
} from "../shared/armsRumBridgeForward.js";

installArmsRumBridgeIpcForward(ipcRenderer);
scheduleArmsEventBridgePatch();

function parseDeviceIdFromArgs(): string {
  for (const arg of process.argv) {
    if (arg.startsWith("--device-id=")) {
      return arg.slice("--device-id=".length);
    }
  }
  return "";
}

contextBridge.exposeInMainWorld("__CF_DEVICE_ID__", parseDeviceIdFromArgs());

import type {
  AppSettings,
  ApplicationIconRequest,
  BindRemoteWorkspaceSessionContextResult,
  BindRemoteWorkspaceSessionContextIpcResult,
  BrowserViewOperationPayload,
  BrowserGuestAttachResult,
  BrowserViewScreenshotSurfacePreparePayload,
  BrowserViewScreenshotSurfaceReadyPayload,
  BrowserViewScreenshotSurfaceReleasePayload,
  BrowserViewViewportChangedPayload,
  BrowserViewCloseTabNotification,
  BrowserViewCloseTabRequest,
  BrowserViewResidencyReportPayload,
  BrowserViewResidencyTransitionPayload,
  BrowserViewRestoredTabShell,
  BrowserViewRestoreTabsRequest,
  BrowserViewportSize,
  DesktopZoomState,
  DesktopWindowChromeState,
  DesktopCommandId,
  DesktopTitleBarTheme,
  EmbeddedBrowserOpenUrlRequest,
  EmbeddedBrowserPermissionPromptEvent,
  EmbeddedBrowserPermissionResolveRequest,
  EmbeddedBrowserSitePermissionUpdateRequest,
  EmbeddedBrowserSitePermissionResetRequest,
  EmbeddedBrowserSitePermissionsSnapshot,
  Locale,
  OAuthStateRegistration,
  WebRemoteControlAuthStateChange,
  OpenInEditorOptions,
  RemoteTarget,
  TaskNotificationPayload,
  TelemetryRendererContext,
  RendererActionTraceBatchV1,
  RendererActionTraceConfigV1,
  RendererHeapSample,
  PostUpdateReleaseNotesPayload,
  RemoteSessionClosedEvent,
  RemoteSessionReconnectedEvent,
  UpdateCheckResultPayload,
  UpdateStatePayload,
  CfStdioTapDevState,
  LoadCliMcpFromUserDirectoryRequest,
  MigrateLegacyCommonMcpRequest,
  SaveCliMcpToUserDirectoryRequest,
  SaveFileRequest,
  SaveFileResult,
  PrintPageToPdfResult,
  SSHConfigAliasOption,
  WebRemoteControlContext,
  WebRemoteControlReconnectWorkspaceRequest,
  WebRemoteControlReconnectWorkspaceResult,
  WebRemoteControlStatus,
  WebRemoteControlWorkspaceTarget,
  RemoteConnectionRuntimeLog,
  WindowControlsOverlayMetrics,
  WindowControlsOverlayReadyPayload,
  CreateTempTextAttachmentRequest,
  MaterializeWorkflowArtifactFileRequest,
  OpenCuaPermissionOnboardingOptions,
  ConfigureFinalArmsCustomEventE2ERequest,
  FinalArmsCustomEventE2EEntry,
} from "@origin-ai/cf-shared";
import { unwrapRemoteWorkspaceBindResult } from "./remoteWorkspaceBindBridge.js";
import {
  InternalChannels,
  PlatformChannels,
  formatCfRendererProcessName,
  scopedServicePortPayloadSchema,
  shouldEnableE2ETestBridge,
} from "@origin-ai/cf-shared";
import { createOAuthCallbackHandler } from "./oauthCallbackBridge.js";

if (shouldEnableE2ETestBridge(process.env)) {
  contextBridge.exposeInMainWorld("__cfFinalArmsCustomEventsE2E", {
    read: (): Promise<FinalArmsCustomEventE2EEntry[]> =>
      ipcRenderer.invoke(PlatformChannels.ReadFinalArmsCustomEventsE2E),
    clear: (): Promise<void> => ipcRenderer.invoke(PlatformChannels.ClearFinalArmsCustomEventsE2E),
    configure: (request: ConfigureFinalArmsCustomEventE2ERequest): Promise<void> =>
      ipcRenderer.invoke(PlatformChannels.ConfigureFinalArmsCustomEventsE2E, request),
  });
}

const updateReadyCallbacks = new Set<(version: string) => void>();
const updateStateCallbacks = new Set<(payload: UpdateStatePayload) => void>();
const postUpdateReleaseNotesCallbacks = new Set<(payload: PostUpdateReleaseNotesPayload) => void>();
const openWorkspacePathCallbacks = new Set<(path: string) => void>();
let latestReadyUpdateVersion: string | null = null;
let latestUpdateState: UpdateStatePayload | null = null;
let latestPostUpdateReleaseNotes: PostUpdateReleaseNotesPayload | null = null;
const pendingOpenWorkspacePaths: string[] = [];
const shareImportCallbacks = new Set<(payload: { shareCode: string }) => void>();
const pendingShareImports: { shareCode: string }[] = [];
const MACOS_WINDOW_CONTROLS_BASE_LEFT_PADDING_PX = 96;
const WINDOWS_WINDOW_CONTROLS_BASE_RIGHT_PADDING_PX = 136;
const WINDOWS_TITLE_BAR_HEIGHT_PX = 48;
const DESKTOP_ZOOM_FACTOR_STEP = 1.1;
const DESKTOP_ZOOM_MIN_LEVEL = -3;
const DESKTOP_ZOOM_MAX_LEVEL = 5;
let latestWindowControlsOverlayMetrics: WindowControlsOverlayMetrics | null = null;
let latestDesktopZoomLevel = 0;

function clampDesktopZoomLevel(level: number) {
  return Math.min(DESKTOP_ZOOM_MAX_LEVEL, Math.max(DESKTOP_ZOOM_MIN_LEVEL, level));
}

function resolveDesktopZoomLevelFromFactor(zoomFactor: number) {
  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) {
    return 0;
  }

  return clampDesktopZoomLevel(
    Math.round(Math.log(zoomFactor) / Math.log(DESKTOP_ZOOM_FACTOR_STEP)),
  );
}

function resolveDesktopZoomFactorForLevel(level: number) {
  return Math.pow(DESKTOP_ZOOM_FACTOR_STEP, clampDesktopZoomLevel(level));
}

function readCurrentWindowControlsOverlayReadyPayload(): WindowControlsOverlayReadyPayload {
  const zoomLevel = resolveDesktopZoomLevelFromFactor(webFrame.getZoomFactor());
  const zoomFactor = resolveDesktopZoomFactorForLevel(zoomLevel);
  const metrics: WindowControlsOverlayMetrics =
    process.platform === "darwin"
      ? {
          leftPaddingPx: Math.round(MACOS_WINDOW_CONTROLS_BASE_LEFT_PADDING_PX / zoomFactor),
        }
      : process.platform === "win32"
        ? {
            rightPaddingPx: Math.round(WINDOWS_WINDOW_CONTROLS_BASE_RIGHT_PADDING_PX / zoomFactor),
            titleBarHeightPx: Math.round(WINDOWS_TITLE_BAR_HEIGHT_PX * zoomFactor),
          }
        : {};
  return {
    zoomLevel,
    metrics,
  };
}

function readCurrentWindowControlsOverlayMetrics(): WindowControlsOverlayMetrics {
  return readCurrentWindowControlsOverlayReadyPayload().metrics;
}

const initialWindowControlsOverlayPayload = readCurrentWindowControlsOverlayReadyPayload();
latestDesktopZoomLevel = initialWindowControlsOverlayPayload.zoomLevel;
latestWindowControlsOverlayMetrics = initialWindowControlsOverlayPayload.metrics;
ipcRenderer.send(PlatformChannels.WindowControlsOverlayReady, initialWindowControlsOverlayPayload);

ipcRenderer.on(
  PlatformChannels.WindowControlsOverlayChanged,
  (_event: unknown, metrics: WindowControlsOverlayMetrics) => {
    latestWindowControlsOverlayMetrics = metrics;
  },
);

ipcRenderer.on(
  PlatformChannels.DesktopZoomLevelChanged,
  (_event: unknown, state: DesktopZoomState) => {
    if (Number.isFinite(state.zoomLevel)) {
      latestDesktopZoomLevel = clampDesktopZoomLevel(state.zoomLevel);
    }
  },
);

ipcRenderer.on(PlatformChannels.OpenWorkspacePath, (_event: unknown, path: string) => {
  if (openWorkspacePathCallbacks.size === 0) {
    pendingOpenWorkspacePaths.push(path);
    return;
  }

  for (const callback of openWorkspacePathCallbacks) {
    callback(path);
  }
});

ipcRenderer.on(PlatformChannels.ShareImport, (_event: unknown, payload: { shareCode: string }) => {
  if (shareImportCallbacks.size === 0) {
    pendingShareImports.push(payload);
    return;
  }
  for (const callback of shareImportCallbacks) callback(payload);
});

function updateRendererProcessTitle(): void {
  process.title = formatCfRendererProcessName(document.title);
}

function notifyUpdateReadyCallbacks(version: string): void {
  latestReadyUpdateVersion = version;
  for (const callback of updateReadyCallbacks) {
    callback(version);
  }
}

function notifyPostUpdateReleaseNotesCallbacks(payload: PostUpdateReleaseNotesPayload): void {
  latestPostUpdateReleaseNotes = payload;
  for (const callback of postUpdateReleaseNotesCallbacks) {
    callback(payload);
  }
}

function notifyUpdateStateCallbacks(payload: UpdateStatePayload): void {
  latestUpdateState = payload;
  latestReadyUpdateVersion = payload.kind === "update-downloaded" ? payload.version : null;
  for (const callback of updateStateCallbacks) {
    callback(payload);
  }
}

updateRendererProcessTitle();
window.addEventListener("DOMContentLoaded", updateRendererProcessTitle, {
  once: true,
});

contextBridge.exposeInMainWorld("cf", {
  connectRemote: (
    options: RemoteTarget,
    requestId?: string,
    context?: {
      workspacePath?: string;
      workspaceIdentity?: string;
      connectTrigger?: import("@origin-ai/cf-shared").RemoteWorkspaceConnectTrigger;
      confirmSourceServerInstall?: boolean;
    },
  ) =>
    ipcRenderer.invoke(PlatformChannels.ConnectRemote, {
      target: options,
      requestId,
      ...(context ? context : {}),
    }),
  requestSourceSettingsAttachment: (sourceServerId: string) =>
    ipcRenderer.invoke(PlatformChannels.RequestSourceSettingsAttachment, {
      sourceServerId,
    }),
  cancelPendingRemoteConnection: (requestId?: string): Promise<void> =>
    ipcRenderer.invoke(PlatformChannels.CancelPendingRemoteConnection, {
      requestId,
    }),
  bindRemoteWorkspaceSessionContext: (context: {
    remoteSessionId: string;
    workspacePath: string;
    workspaceIdentity?: string;
    workspacePurpose?: import("@origin-ai/cf-shared").WorkspacePurpose;
  }): Promise<BindRemoteWorkspaceSessionContextResult> =>
    ipcRenderer
      .invoke(PlatformChannels.BindRemoteWorkspaceSessionContext, context)
      .then((result: BindRemoteWorkspaceSessionContextIpcResult) =>
        unwrapRemoteWorkspaceBindResult(result),
      ),
  startWebRemoteControl: (context: WebRemoteControlContext) =>
    ipcRenderer.invoke(PlatformChannels.StartWebRemoteControl, context),
  stopWebRemoteControl: (): Promise<void> =>
    ipcRenderer.invoke(PlatformChannels.StopWebRemoteControl),
  getWebRemoteControlStatus: () => ipcRenderer.invoke(PlatformChannels.GetWebRemoteControlStatus),
  onWebRemoteControlStatusChanged: (
    callback: (status: WebRemoteControlStatus) => void,
  ): (() => void) => {
    const handler = (_event: unknown, payload: WebRemoteControlStatus) => callback(payload);
    ipcRenderer.on(PlatformChannels.WebRemoteControlStatusChanged, handler);
    return () =>
      ipcRenderer.removeListener(PlatformChannels.WebRemoteControlStatusChanged, handler);
  },
  disposeRemoteSession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(PlatformChannels.DisposeRemoteSession, sessionId),
  isDockerAvailable: (): Promise<boolean> => ipcRenderer.invoke(PlatformChannels.IsDockerAvailable),
  listWSLDistros: () => ipcRenderer.invoke(PlatformChannels.ListWSLDistros),
  listDockerContainers: () => ipcRenderer.invoke(PlatformChannels.ListDockerContainers),
  listSSHConfigAliases: (): Promise<SSHConfigAliasOption[]> =>
    ipcRenderer.invoke(PlatformChannels.ListSSHConfigAliases),
  loadMcpFromUserDirectory: (payload?: LoadCliMcpFromUserDirectoryRequest) =>
    ipcRenderer.invoke(PlatformChannels.LoadMcpFromUserDirectory, payload ?? {}),
  saveMcpToUserDirectory: (payload: SaveCliMcpToUserDirectoryRequest) =>
    ipcRenderer.invoke(PlatformChannels.SaveMcpToUserDirectory, payload),
  migrateLegacyCommonMcp: (payload?: MigrateLegacyCommonMcpRequest) =>
    ipcRenderer.invoke(PlatformChannels.MigrateLegacyCommonMcp, payload ?? {}),
  
  log: (level: "info" | "warn" | "error", args: unknown[]) =>
    ipcRenderer.send(PlatformChannels.Log, { level, args }),
  
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke(PlatformChannels.SelectDirectory),
  
  selectDirectories: (): Promise<string[]> =>
    ipcRenderer.invoke(PlatformChannels.SelectDirectories),
  
  selectFile: (): Promise<string | null> => ipcRenderer.invoke(PlatformChannels.SelectFile),
  
  selectFiles: (): Promise<string[]> => ipcRenderer.invoke(PlatformChannels.SelectFiles),
  
  saveFile: (payload: SaveFileRequest): Promise<SaveFileResult> =>
    ipcRenderer.invoke(PlatformChannels.SaveFile, payload),
  
  printPageToPdf: (): Promise<PrintPageToPdfResult> =>
    ipcRenderer.invoke(PlatformChannels.PrintToPdf),
  
  getPathForFile: (file: File): string | null => {
    const path = webUtils.getPathForFile(file).trim();
    return path.length > 0 ? path : null;
  },
  
  createTempTextAttachment: (payload: CreateTempTextAttachmentRequest) =>
    ipcRenderer.invoke(PlatformChannels.CreateTempTextAttachment, payload),
  
  materializeWorkflowArtifactFile: (payload: MaterializeWorkflowArtifactFileRequest) =>
    ipcRenderer.invoke(PlatformChannels.MaterializeWorkflowArtifactFile, payload),
  
  onRemoteConnectionLog: (callback: (entry: RemoteConnectionRuntimeLog) => void) => {
    const handler = (_event: unknown, payload: unknown) =>
      callback(payload as RemoteConnectionRuntimeLog);
    ipcRenderer.on(PlatformChannels.RemoteConnectionLog, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.RemoteConnectionLog, handler);
  },
  
  onRemoteSessionClosed: (callback: (event: RemoteSessionClosedEvent) => void) => {
    const handler = (_event: unknown, payload: unknown) =>
      callback(payload as RemoteSessionClosedEvent);
    ipcRenderer.on(PlatformChannels.RemoteSessionClosed, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.RemoteSessionClosed, handler);
  },
  
  onRemoteSessionReconnected: (callback: (event: RemoteSessionReconnectedEvent) => void) => {
    const handler = (_event: unknown, payload: unknown) =>
      callback(payload as RemoteSessionReconnectedEvent);
    ipcRenderer.on(PlatformChannels.RemoteSessionReconnected, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.RemoteSessionReconnected, handler);
  },
  
  activateOrSetWorkspace: (path: string): Promise<{ activated: boolean }> =>
    ipcRenderer.invoke(PlatformChannels.ActivateOrSetWorkspace, path),
  
  syncWindowTabs: (paths: string[]) => ipcRenderer.send(PlatformChannels.SyncWindowTabs, paths),
  
  syncWebRemoteControlWorkspaces: (workspaces: WebRemoteControlWorkspaceTarget[]) =>
    ipcRenderer.send(PlatformChannels.SyncWebRemoteControlWorkspaces, workspaces),
  onWebRemoteControlReconnectWorkspace: (
    callback: (
      request: WebRemoteControlReconnectWorkspaceRequest,
    ) => Promise<WebRemoteControlReconnectWorkspaceResult>,
  ) => {
    const handler = async (event: Electron.IpcRendererEvent, payload: unknown) => {
      const request = payload as WebRemoteControlReconnectWorkspaceRequest;
      try {
        const result = await callback(request);
        event.sender.send(PlatformChannels.WebRemoteControlReconnectWorkspace, result);
      } catch (error) {
        event.sender.send(PlatformChannels.WebRemoteControlReconnectWorkspace, {
          requestId: request.requestId,
          workspaceKey: request.workspaceKey,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        } satisfies WebRemoteControlReconnectWorkspaceResult);
      }
    };
    ipcRenderer.on(PlatformChannels.WebRemoteControlReconnectWorkspace, handler);
    return () =>
      ipcRenderer.removeListener(PlatformChannels.WebRemoteControlReconnectWorkspace, handler);
  },
  
  syncWindowUnreadCount: (count: number) =>
    ipcRenderer.send(PlatformChannels.SyncWindowUnreadCount, count),
  syncActiveTaskSession: (sessionId: string | null) =>
    ipcRenderer.send(PlatformChannels.SyncActiveTaskSession, sessionId),
  
  syncAppSettings: (patch: Partial<AppSettings>) =>
    ipcRenderer.send(PlatformChannels.SyncAppSettings, patch),
  
  getCloseToTrayCapability: () => ipcRenderer.invoke(PlatformChannels.GetCloseToTrayCapability),
  
  setShortcutRecordingActive: (active: boolean) =>
    ipcRenderer.send(PlatformChannels.SetShortcutRecordingActive, active),
  
  onFocusTab: (callback: (path: string) => void): (() => void) => {
    const handler = (_event: unknown, path: string) => callback(path);
    ipcRenderer.on(PlatformChannels.FocusTab, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.FocusTab, handler);
  },
  
  onNewTab: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on(PlatformChannels.NewTab, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.NewTab, handler);
  },
  
  onCloseActiveContextRequest: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on(PlatformChannels.CloseActiveContextRequest, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.CloseActiveContextRequest, handler);
  },
  
  onOpenBrowserUrl: (callback: (request: EmbeddedBrowserOpenUrlRequest) => void): (() => void) => {
    const handler = (_event: unknown, request: EmbeddedBrowserOpenUrlRequest) => callback(request);
    ipcRenderer.on(PlatformChannels.OpenBrowserUrl, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.OpenBrowserUrl, handler);
  },
  
  onEmbeddedBrowserPermissionPrompt: (
    callback: (event: EmbeddedBrowserPermissionPromptEvent) => void,
  ): (() => void) => {
    const handler = (_event: unknown, payload: EmbeddedBrowserPermissionPromptEvent) =>
      callback(payload);
    ipcRenderer.on(PlatformChannels.EmbeddedBrowserPermissionPrompt, handler);
    return () =>
      ipcRenderer.removeListener(PlatformChannels.EmbeddedBrowserPermissionPrompt, handler);
  },
  
  resolveEmbeddedBrowserPermissionPrompt: (
    request: EmbeddedBrowserPermissionResolveRequest,
  ): void => {
    ipcRenderer.send(PlatformChannels.EmbeddedBrowserPermissionResolve, request);
  },
  
  getEmbeddedBrowserSitePermissions: (): Promise<EmbeddedBrowserSitePermissionsSnapshot> =>
    ipcRenderer.invoke(PlatformChannels.GetEmbeddedBrowserSitePermissions),
  
  setEmbeddedBrowserSitePermission: (
    request: EmbeddedBrowserSitePermissionUpdateRequest,
  ): Promise<EmbeddedBrowserSitePermissionsSnapshot> =>
    ipcRenderer.invoke(PlatformChannels.SetEmbeddedBrowserSitePermission, request),
  
  clearEmbeddedBrowserSitePermissions: (): Promise<EmbeddedBrowserSitePermissionsSnapshot> =>
    ipcRenderer.invoke(PlatformChannels.ClearEmbeddedBrowserSitePermissions),
  
  resetEmbeddedBrowserSitePermission: (
    request: EmbeddedBrowserSitePermissionResetRequest,
  ): Promise<EmbeddedBrowserSitePermissionsSnapshot> =>
    ipcRenderer.invoke(PlatformChannels.ResetEmbeddedBrowserSitePermission, request),
  
  onBrowserViewReady: (
    callback: (payload: {
      workspaceKey: string;
      remoteSessionId?: string;
      sessionId: string;
      tabId: string;
      browserId: string;
      browserGeneration: number;
    }) => void,
  ): (() => void) => {
    const handler = (
      _event: unknown,
      payload: {
        workspaceKey: string;
        remoteSessionId?: string;
        sessionId: string;
        tabId: string;
        browserId: string;
        browserGeneration: number;
      },
    ) => callback(payload);
    ipcRenderer.on(PlatformChannels.BrowserViewReady, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.BrowserViewReady, handler);
  },
  
  onBrowserViewOperation: (
    callback: (payload: BrowserViewOperationPayload) => void,
  ): (() => void) => {
    const handler = (_event: unknown, payload: BrowserViewOperationPayload) => callback(payload);
    ipcRenderer.on(PlatformChannels.BrowserViewOperation, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.BrowserViewOperation, handler);
  },
  
  onBrowserViewViewportChanged: (
    callback: (payload: BrowserViewViewportChangedPayload) => void,
  ): (() => void) => {
    const handler = (_event: unknown, payload: BrowserViewViewportChangedPayload) =>
      callback(payload);
    ipcRenderer.on(PlatformChannels.BrowserViewViewportChanged, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.BrowserViewViewportChanged, handler);
  },
  onBrowserViewScreenshotSurfacePrepare: (
    callback: (payload: BrowserViewScreenshotSurfacePreparePayload) => void,
  ): (() => void) => {
    const handler = (_event: unknown, payload: BrowserViewScreenshotSurfacePreparePayload) =>
      callback(payload);
    ipcRenderer.on(PlatformChannels.BrowserViewScreenshotSurfacePrepare, handler);
    return () =>
      ipcRenderer.removeListener(PlatformChannels.BrowserViewScreenshotSurfacePrepare, handler);
  },
  onBrowserViewScreenshotSurfaceRelease: (
    callback: (payload: BrowserViewScreenshotSurfaceReleasePayload) => void,
  ): (() => void) => {
    const handler = (_event: unknown, payload: BrowserViewScreenshotSurfaceReleasePayload) =>
      callback(payload);
    ipcRenderer.on(PlatformChannels.BrowserViewScreenshotSurfaceRelease, handler);
    return () =>
      ipcRenderer.removeListener(PlatformChannels.BrowserViewScreenshotSurfaceRelease, handler);
  },
  browserViewScreenshotSurfaceReady: (payload: BrowserViewScreenshotSurfaceReadyPayload): void => {
    ipcRenderer.send(PlatformChannels.BrowserViewScreenshotSurfaceReady, payload);
  },
  onBrowserViewVisibility: (
    callback: (payload: {
      visible: boolean;
      workspaceKey: string;
      remoteSessionId: string | undefined;
      sessionId: string;
      tabId?: string;
      browserId: string;
      browserGeneration: number;
    }) => void,
  ): (() => void) => {
    const handler = (
      _event: unknown,
      payload: {
        visible: boolean;
        workspaceKey: string;
        remoteSessionId: string | undefined;
        sessionId: string;
        tabId?: string;
        browserId: string;
        browserGeneration: number;
      },
    ) => callback(payload);
    ipcRenderer.on(PlatformChannels.BrowserViewVisibility, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.BrowserViewVisibility, handler);
  },
  
  onBrowserViewCloseTab: (
    callback: (payload: BrowserViewCloseTabNotification) => void,
  ): (() => void) => {
    const handler = (_event: unknown, payload: BrowserViewCloseTabNotification) =>
      callback(payload);
    ipcRenderer.on(PlatformChannels.BrowserViewCloseTab, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.BrowserViewCloseTab, handler);
  },
  onBrowserViewSuspend: (
    callback: (payload: BrowserViewResidencyTransitionPayload) => void,
  ): (() => void) => {
    const handler = (_event: unknown, payload: BrowserViewResidencyTransitionPayload) =>
      callback(payload);
    ipcRenderer.on(PlatformChannels.BrowserViewSuspend, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.BrowserViewSuspend, handler);
  },
  onBrowserViewRestore: (
    callback: (payload: BrowserViewResidencyTransitionPayload) => void,
  ): (() => void) => {
    const handler = (_event: unknown, payload: BrowserViewResidencyTransitionPayload) =>
      callback(payload);
    ipcRenderer.on(PlatformChannels.BrowserViewRestore, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.BrowserViewRestore, handler);
  },
  
  onNewTask: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on(PlatformChannels.NewTask, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.NewTask, handler);
  },
  
  onOpenWorkspace: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on(PlatformChannels.OpenWorkspace, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.OpenWorkspace, handler);
  },
  
  onOpenWorkspacePath: (callback: (path: string) => void): (() => void) => {
    openWorkspacePathCallbacks.add(callback);
    while (pendingOpenWorkspacePaths.length > 0) {
      const path = pendingOpenWorkspacePaths.shift();
      if (path) {
        callback(path);
      }
    }
    return () => openWorkspacePathCallbacks.delete(callback);
  },
  onOpenFeedbackDialog: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on(PlatformChannels.OpenFeedbackDialog, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.OpenFeedbackDialog, handler);
  },
  onOpenTicketsPanel: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on(PlatformChannels.OpenTicketsPanel, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.OpenTicketsPanel, handler);
  },
  
  onWindowFullscreenChanged: (callback: (isFullscreen: boolean) => void): (() => void) => {
    const handler = (_event: unknown, isFullscreen: boolean) => callback(isFullscreen);
    ipcRenderer.on(PlatformChannels.WindowFullscreenChanged, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.WindowFullscreenChanged, handler);
  },
  
  getDesktopWindowChromeState: (): Promise<DesktopWindowChromeState> =>
    ipcRenderer.invoke(PlatformChannels.GetDesktopWindowChromeState),
  
  onDesktopWindowChromeStateChanged: (
    callback: (state: DesktopWindowChromeState) => void,
  ): (() => void) => {
    const handler = (_event: unknown, state: DesktopWindowChromeState) => callback(state);
    ipcRenderer.on(PlatformChannels.DesktopWindowChromeStateChanged, handler);
    return () =>
      ipcRenderer.removeListener(PlatformChannels.DesktopWindowChromeStateChanged, handler);
  },
  
  getWindowControlsOverlayMetrics: (): WindowControlsOverlayMetrics =>
    latestWindowControlsOverlayMetrics ?? readCurrentWindowControlsOverlayMetrics(),
  
  onWindowControlsOverlayChanged: (
    callback: (metrics: WindowControlsOverlayMetrics) => void,
  ): (() => void) => {
    const handler = (_event: unknown, metrics: WindowControlsOverlayMetrics) => callback(metrics);
    callback(latestWindowControlsOverlayMetrics ?? readCurrentWindowControlsOverlayMetrics());
    ipcRenderer.on(PlatformChannels.WindowControlsOverlayChanged, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.WindowControlsOverlayChanged, handler);
  },
  
  getDesktopZoomLevel: async (): Promise<DesktopZoomState> => {
    const state = await ipcRenderer.invoke(PlatformChannels.GetDesktopZoomLevel);
    if (Number.isFinite(state?.zoomLevel)) {
      latestDesktopZoomLevel = clampDesktopZoomLevel(state.zoomLevel);
    }
    return { zoomLevel: latestDesktopZoomLevel };
  },
  
  onDesktopZoomLevelChanged: (callback: (state: DesktopZoomState) => void): (() => void) => {
    const handler = (_event: unknown, state: DesktopZoomState) => {
      if (!Number.isFinite(state.zoomLevel)) {
        return;
      }
      latestDesktopZoomLevel = clampDesktopZoomLevel(state.zoomLevel);
      callback({ zoomLevel: latestDesktopZoomLevel });
    };
    callback({ zoomLevel: latestDesktopZoomLevel });
    ipcRenderer.on(PlatformChannels.DesktopZoomLevelChanged, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.DesktopZoomLevelChanged, handler);
  },
  
  onTaskNotificationClick: (callback: (taskId: string) => void): (() => void) => {
    const handler = (_event: unknown, taskId: string) => callback(taskId);
    ipcRenderer.on(PlatformChannels.TaskNotificationClick, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.TaskNotificationClick, handler);
  },
  
  openExternal: (url: string) => ipcRenderer.send(PlatformChannels.OpenExternal, url),
  
  canOpenCommunity: (locale: Locale): Promise<boolean> =>
    ipcRenderer.invoke(PlatformChannels.CanOpenCommunity, locale),
  
  openInFileManager: (path: string) => ipcRenderer.invoke(PlatformChannels.OpenInFileManager, path),
  
  openExternalFile: (path: string) => ipcRenderer.invoke(PlatformChannels.OpenExternalFile, path),
  
  openCuaPermissionOnboarding: (options?: OpenCuaPermissionOnboardingOptions) =>
    ipcRenderer.invoke(PlatformChannels.OpenCuaPermissionOnboarding, options),
  
  cancelCuaPermissionOnboarding: (operationId: string) =>
    ipcRenderer.send(PlatformChannels.CancelCuaPermissionOnboarding, {
      operationId,
    }),
  
  prepareCuaHelperPermissionDrag: () =>
    ipcRenderer.invoke(PlatformChannels.PrepareCuaHelperPermissionDrag),
  
  startCuaHelperPermissionDrag: () =>
    ipcRenderer.send(PlatformChannels.StartCuaHelperPermissionDrag),
  notifyWebRemoteControlAuthStateChanged: (change: WebRemoteControlAuthStateChange) =>
    ipcRenderer.send(PlatformChannels.WebRemoteControlAuthStateChanged, change),
  
  registerOAuthState: (payload: OAuthStateRegistration) =>
    ipcRenderer.send(PlatformChannels.OAuthRegisterState, payload),
  
  onOAuthCallback: (cb: (url: string) => void): (() => void) => {
    const handler = createOAuthCallbackHandler(cb, () => {
      ipcRenderer.send(PlatformChannels.OAuthCallbackHandled);
    });
    ipcRenderer.on(PlatformChannels.OAuthCallback, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.OAuthCallback, handler);
  },
  
  onPaymentCallback: (callback: (url: string) => void): (() => void) => {
    const handler = (_event: unknown, url: string) => callback(url);
    ipcRenderer.on(PlatformChannels.PaymentCallback, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.PaymentCallback, handler);
  },
  onShareImport: (callback: (payload: { shareCode: string }) => void): (() => void) => {
    shareImportCallbacks.add(callback);
    while (pendingShareImports.length > 0) {
      const payload = pendingShareImports.shift();
      if (payload) callback(payload);
    }
    return () => shareImportCallbacks.delete(callback);
  },
  
  notifyRendererReady: () => ipcRenderer.send(PlatformChannels.RendererReady),
  
  syncTelemetryContext: (context: TelemetryRendererContext) =>
    ipcRenderer.send(PlatformChannels.SyncTelemetryContext, context),
  
  reportTelemetryEvent: (payload: {
    context: TelemetryRendererContext;
    elementName: string;
    eventRegion: string;
    eventType: string;
    eventText?: string;
    eventExtraDetail: Record<string, string>;
    userId?: string;
    talkId?: string;
    messageId?: string;
  }) => ipcRenderer.invoke(PlatformChannels.ReportTelemetryEvent, payload),
  
  reportArmsCustomEvent: (payload: {
    name: string;
    group: string;
    value?: number;
    properties?: Record<string, string | number | boolean | undefined>;
  }) => ipcRenderer.invoke(PlatformChannels.ReportArmsCustomEvent, payload),
  
  getRendererActionTraceConfig: (): Promise<RendererActionTraceConfigV1> =>
    ipcRenderer.invoke(PlatformChannels.GetRendererActionTraceConfig),
  
  onRendererActionTraceConfigChanged: (
    callback: (config: RendererActionTraceConfigV1) => void,
  ): (() => void) => {
    const handler = (_event: unknown, config: RendererActionTraceConfigV1) => callback(config);
    ipcRenderer.on(PlatformChannels.RendererActionTraceConfigChanged, handler);
    return () =>
      ipcRenderer.removeListener(PlatformChannels.RendererActionTraceConfigChanged, handler);
  },
  
  reportLocalTtftBatch: (batch: import("@origin-ai/cf-shared").LocalTtftBatch): void =>
    ipcRenderer.send(PlatformChannels.ReportLocalTtftBatch, batch),
  reportRendererActionTraceBatch: (batch: RendererActionTraceBatchV1): void =>
    ipcRenderer.send(PlatformChannels.ReportRendererActionTraceBatch, batch),
  
  reportRendererHeapSample: (sample: RendererHeapSample): void =>
    ipcRenderer.send(PlatformChannels.ReportRendererHeapSample, sample),
  
  showTaskNotification: (payload: TaskNotificationPayload) =>
    ipcRenderer.send(PlatformChannels.ShowTaskNotification, payload),
  
  exportLogs: (): Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }> => ipcRenderer.invoke(PlatformChannels.ExportLogs),
  
  captureWindowScreenshot: () => ipcRenderer.invoke(PlatformChannels.CaptureWindowScreenshot),
  browserViewAttachGuest: (payload: {
    key: string;
    webContentsId: number;
    active?: boolean;
    workspaceKey?: string;
    remoteSessionId?: string;
    sessionId?: string;
    residencyGeneration?: number;
  }): Promise<BrowserGuestAttachResult> =>
    ipcRenderer.invoke(PlatformChannels.BrowserViewAttachGuest, payload),
  
  browserViewDetachGuest: (payload: { key: string; webContentsId: number }): Promise<boolean> =>
    ipcRenderer.invoke(PlatformChannels.BrowserViewDetachGuest, payload),
  browserViewCloseTab: (payload: BrowserViewCloseTabRequest): Promise<void> =>
    ipcRenderer.invoke(PlatformChannels.BrowserViewCloseTabFromRenderer, payload),
  browserViewReportResidency: (payload: BrowserViewResidencyReportPayload): Promise<void> =>
    ipcRenderer.invoke(PlatformChannels.BrowserViewReportResidency, payload),
  browserViewSuspendReady: (payload: { tabId: string; generation: number }): Promise<void> =>
    ipcRenderer.invoke(PlatformChannels.BrowserViewSuspendReady, payload),
  browserViewEnsureResident: (payload: BrowserViewCloseTabRequest): Promise<void> =>
    ipcRenderer.invoke(PlatformChannels.BrowserViewEnsureResident, payload),
  browserViewRestoreTabs: (
    payload: BrowserViewRestoreTabsRequest,
  ): Promise<BrowserViewRestoredTabShell[]> =>
    ipcRenderer.invoke(PlatformChannels.BrowserViewRestoreTabs, payload),
  
  browserViewUpdateViewport: (payload: { tabId: string; viewport: BrowserViewportSize | null }) =>
    ipcRenderer.invoke(PlatformChannels.BrowserViewUpdateViewport, payload),
  
  importChromeBrowserData: (options?: import("@origin-ai/cf-shared").ChromeBrowserDataImportOptions) =>
    ipcRenderer.invoke(PlatformChannels.ImportChromeBrowserData, options),
  
  clearEmbeddedBrowserData: (mode: "cache" | "all") =>
    ipcRenderer.invoke(PlatformChannels.ClearEmbeddedBrowserData, mode),
  
  getCfStdioTapDevState: (): Promise<CfStdioTapDevState> =>
    ipcRenderer.invoke(PlatformChannels.GetCfStdioTapDevState),
  
  onSettingsChanged: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on(PlatformChannels.SettingsChanged, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.SettingsChanged, handler);
  },
  
  onApplicationLocaleChanged: (callback: (locale: Locale) => void): (() => void) => {
    const handler = (_event: unknown, locale: Locale) => callback(locale);
    ipcRenderer.on(PlatformChannels.ApplicationLocaleChanged, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.ApplicationLocaleChanged, handler);
  },
  
  onUpdateCheckResult: (callback: (payload: UpdateCheckResultPayload) => void): (() => void) => {
    const handler = (_event: unknown, payload: UpdateCheckResultPayload) => callback(payload);
    ipcRenderer.on(PlatformChannels.UpdateCheckResult, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.UpdateCheckResult, handler);
  },
  getUpdateState: (): Promise<UpdateStatePayload> =>
    ipcRenderer.invoke(PlatformChannels.GetUpdateState),
  
  downloadUpdate: () => ipcRenderer.invoke(PlatformChannels.DownloadUpdate),
  
  cancelUpdateDownload: () => ipcRenderer.invoke(PlatformChannels.CancelUpdateDownload),
  
  openUpdateStatusWindow: () => ipcRenderer.invoke(PlatformChannels.OpenUpdateStatusWindow),
  
  getAutoUpdatePreferences: () => ipcRenderer.invoke(PlatformChannels.GetAutoUpdatePreferences),
  
  setAutoDownloadAndInstallUpdates: (enabled: boolean) =>
    ipcRenderer.invoke(PlatformChannels.SetAutoDownloadAndInstallUpdates, enabled),
  getDesktopSessionActivity: () => ipcRenderer.invoke(PlatformChannels.GetDesktopSessionActivity),
  
  onUpdateStateChanged: (callback: (payload: UpdateStatePayload) => void): (() => void) => {
    updateStateCallbacks.add(callback);
    if (latestUpdateState) {
      callback(latestUpdateState);
    }
    return () => {
      updateStateCallbacks.delete(callback);
    };
  },
  
  onUpdateReady: (callback: (version: string) => void): (() => void) => {
    updateReadyCallbacks.add(callback);
    if (latestReadyUpdateVersion) {
      callback(latestReadyUpdateVersion);
    }
    return () => {
      updateReadyCallbacks.delete(callback);
    };
  },
  
  onPostUpdateReleaseNotes: (
    callback: (payload: PostUpdateReleaseNotesPayload) => void,
  ): (() => void) => {
    postUpdateReleaseNotesCallbacks.add(callback);
    if (latestPostUpdateReleaseNotes) {
      callback(latestPostUpdateReleaseNotes);
    }
    return () => {
      postUpdateReleaseNotesCallbacks.delete(callback);
    };
  },
  
  acknowledgePostUpdateReleaseNotes: (version: string) =>
    ipcRenderer.invoke(PlatformChannels.AcknowledgePostUpdateReleaseNotes, version),
  
  skipUpdateVersion: (version: string) =>
    ipcRenderer.invoke(PlatformChannels.SkipUpdateVersion, version),
  
  quitAndInstallUpdate: () => ipcRenderer.invoke(PlatformChannels.QuitAndInstallUpdate),
  
  getInstalledEditors: (filePath?: string) =>
    ipcRenderer.invoke(PlatformChannels.GetInstalledEditors, filePath),
  getApplicationIcon: (request: string | ApplicationIconRequest) =>
    ipcRenderer.invoke(PlatformChannels.GetApplicationIcon, request),
  
  openInEditor: (editorId: string, path: string, options?: OpenInEditorOptions) =>
    ipcRenderer.invoke(PlatformChannels.OpenInEditor, {
      editorId,
      path,
      options,
    }),
  
  executeDesktopCommand: (command: DesktopCommandId) =>
    ipcRenderer.invoke(PlatformChannels.ExecuteDesktopCommand, command),
  
  setApplicationLocale: (locale: Locale) =>
    ipcRenderer.invoke(PlatformChannels.SetApplicationLocale, locale),
  
  getSystemLocale: (): Promise<Locale> => ipcRenderer.invoke(PlatformChannels.GetSystemLocale),
  
  setTitleBarTheme: (theme: DesktopTitleBarTheme) =>
    ipcRenderer.invoke(PlatformChannels.SetTitleBarTheme, theme),
  
  getDeviceId: () => ipcRenderer.invoke(PlatformChannels.GetDeviceId),
});

installPluginSandboxHostBridge();

ipcRenderer.on(InternalChannels.ServicePort, (event, payload: unknown) => {
  const [port] = event.ports;
  const parsed = databaseStartupPortPayloadSchema.safeParse(payload);
  if (port && parsed.success)
    window.postMessage({ type: InternalChannels.ServicePort, ...parsed.data }, "*", [port]);
  else port?.close();
});

ipcRenderer.on(InternalChannels.ScopedServicePort, (event, payload: unknown) => {
  const [port] = event.ports;
  const parsed = scopedServicePortPayloadSchema.safeParse(payload);
  if (!port || !parsed.success) return;
  window.postMessage(
    {
      type: InternalChannels.ScopedServicePort,
      ...parsed.data,
    },
    "*",
    [port],
  );
});

ipcRenderer.on(
  InternalChannels.SourceSettingsServicePort,
  (
    event,
    payload: {
      attachmentId?: string;
      sourceServerId?: string;
    },
  ) => {
    const [port] = event.ports;
    if (!port) return;
    window.postMessage(
      {
        type: InternalChannels.SourceSettingsServicePort,
        attachmentId: payload.attachmentId,
        sourceServerId: payload.sourceServerId,
      },
      "*",
      [port],
    );
  },
);

window.addEventListener("message", (event) => {
  if (event.source !== window || typeof event.data !== "object" || event.data === null) {
    return;
  }
  const payload = event.data as {
    type?: unknown;
    attachmentId?: unknown;
    sessionId?: unknown;
  };
  if (
    payload.type !== InternalChannels.ScopedServicePortReady ||
    typeof payload.attachmentId !== "string" ||
    !payload.attachmentId ||
    typeof payload.sessionId !== "string" ||
    !payload.sessionId
  ) {
    return;
  }
  ipcRenderer.send(InternalChannels.ScopedServicePortReady, {
    attachmentId: payload.attachmentId,
    sessionId: payload.sessionId,
  });
});

ipcRenderer.on(PlatformChannels.TaskNotificationSound, () => {
  window.postMessage(InternalChannels.TaskNotificationSound, "*");
});

ipcRenderer.on(PlatformChannels.UpdateReady, (_event, version: string) => {
  notifyUpdateReadyCallbacks(version);
});

ipcRenderer.on(PlatformChannels.UpdateStateChanged, (_event, payload: UpdateStatePayload) => {
  notifyUpdateStateCallbacks(payload);
});

ipcRenderer.on(
  PlatformChannels.PostUpdateReleaseNotes,
  (_event, payload: PostUpdateReleaseNotesPayload) => {
    notifyPostUpdateReleaseNotesCallbacks(payload);
  },
);

scheduleArmsEventBridgePatch();

ipcRenderer.on(InternalChannels.DatabaseStartupState, (_event, raw: unknown) => {
  const parsed = databaseStartupStateSchema.safeParse(raw);
  if (parsed.success)
    window.postMessage({ type: InternalChannels.DatabaseStartupState, state: parsed.data }, "*");
});
window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.type !== InternalChannels.DatabaseStartupControl)
    return;
  const parsed = databaseStartupControlSchema.safeParse(event.data.control);
  if (parsed.success) ipcRenderer.send(InternalChannels.DatabaseStartupControl, parsed.data);
});
