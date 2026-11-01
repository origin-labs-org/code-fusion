import { recordArmsCustomEventForE2E } from "@origin-ai/cf-ui";
import { DesktopCommandIds, buildLocalMediaPreviewUrl, type IPlatformService } from "@origin-ai/cf-shared";

import { desktopBrowserPlatformBridge } from "./desktopBrowserPlatformBridge.js";
import { createDesktopPluginSandboxPlatform } from "./plugin-sandbox/desktopPluginSandboxPlatform.js";

export function createDesktopPlatform(options: {
  isLocalDevelopmentRuntime: boolean;
}): IPlatformService {
  return {
    canSelectFilePath: true,
    canOpenLocalFiles: true,
    pluginSandbox: createDesktopPluginSandboxPlatform(),
    createLocalMediaPreviewUrl: buildLocalMediaPreviewUrl,
    isLocalDevelopmentRuntime: options.isLocalDevelopmentRuntime,
    selectDirectory: () => window.cf.selectDirectory(),
    selectDirectories: () => window.cf.selectDirectories(),
    selectFile: () => window.cf.selectFile(),
    selectFiles: () => window.cf.selectFiles?.() ?? Promise.resolve([]),
    createTempTextAttachment: (payload) => window.cf.createTempTextAttachment(payload),
    materializeWorkflowArtifactFile: (payload) =>
      window.cf.materializeWorkflowArtifactFile(payload),
    onRemoteConnectionLog: (handler) => window.cf.onRemoteConnectionLog(handler),
    onRemoteSessionClosed: (handler) => window.cf.onRemoteSessionClosed(handler),
    onRemoteSessionReconnected: (handler) =>
      window.cf.onRemoteSessionReconnected?.(handler) ?? (() => {}),
    activateOrSetWorkspace: (path) =>
      window.cf.activateOrSetWorkspace?.(path) ?? Promise.resolve({ activated: false }),
    connectRemote: (remoteOptions, requestId, context) =>
      window.cf.connectRemote(remoteOptions, requestId, context),
    requestSourceSettingsAttachment: (sourceServerId) =>
      window.cf.requestSourceSettingsAttachment?.(sourceServerId) ??
      Promise.reject(new Error("Source settings attachment bridge unavailable")),
    cancelPendingRemoteConnection: (requestId) =>
      window.cf.cancelPendingRemoteConnection?.(requestId) ?? Promise.resolve(),
    bindRemoteWorkspaceSessionContext: (context) =>
      window.cf.bindRemoteWorkspaceSessionContext?.(context) ??
      Promise.reject(new Error("Desktop bindRemoteWorkspaceSessionContext bridge unavailable")),
    startWebRemoteControl: (context) => window.cf.startWebRemoteControl(context),
    stopWebRemoteControl: () => window.cf.stopWebRemoteControl(),
    getWebRemoteControlStatus: () => window.cf.getWebRemoteControlStatus(),
    onWebRemoteControlStatusChanged: (handler) =>
      window.cf.onWebRemoteControlStatusChanged?.(handler) ?? (() => {}),
    disposeRemoteSession: (sessionId) => window.cf.disposeRemoteSession(sessionId),
    isDockerAvailable: () => window.cf.isDockerAvailable(),
    listWSLDistros: () => window.cf.listWSLDistros(),
    listDockerContainers: () => window.cf.listDockerContainers(),
    listSSHConfigAliases: () => window.cf.listSSHConfigAliases(),
    loadMcpFromUserDirectory: (payload) => window.cf.loadMcpFromUserDirectory(payload),
    saveMcpToUserDirectory: (payload) => window.cf.saveMcpToUserDirectory(payload),
    migrateLegacyCommonMcp: (payload) => window.cf.migrateLegacyCommonMcp(payload),
    openExternal: (url) => window.cf.openExternal(url),
    openFeedback: () => window.cf.executeDesktopCommand(DesktopCommandIds.OpenFeedback),
    openCommunity: () => window.cf.executeDesktopCommand(DesktopCommandIds.OpenCommunity),
    canOpenCommunity: (locale) => window.cf.canOpenCommunity(locale),
    openInFileManager: (path) => window.cf.openInFileManager(path),
    openExternalFile: (path) => window.cf.openExternalFile(path),
    openCuaPermissionOnboarding: window.cf.openCuaPermissionOnboarding
      ? (permissionOptions) =>
          window.cf.openCuaPermissionOnboarding?.(permissionOptions) ??
          Promise.resolve({ success: false, error: "not_supported" })
      : undefined,
    prepareCuaHelperPermissionDrag: window.cf.prepareCuaHelperPermissionDrag
      ? () =>
          window.cf.prepareCuaHelperPermissionDrag?.() ??
          Promise.resolve({ success: false, error: "not_supported" })
      : undefined,
    startCuaHelperPermissionDrag: window.cf.startCuaHelperPermissionDrag
      ? () => window.cf.startCuaHelperPermissionDrag?.()
      : undefined,
    notifyWebRemoteControlAuthStateChanged: (change) =>
      window.cf.notifyWebRemoteControlAuthStateChanged(change),
    registerOAuthState: (payload) => window.cf.registerOAuthState(payload),
    onOAuthCallback: (callback) => window.cf.onOAuthCallback(callback),
    onPaymentCallback: (callback) => window.cf.onPaymentCallback(callback),
    onShareImport: (callback) => window.cf.onShareImport?.(callback) ?? (() => {}),
    notifyRendererReady: () => window.cf.notifyRendererReady(),
    reportTelemetryEvent: (payload) => window.cf.reportTelemetryEvent(payload),
    reportArmsCustomEvent: (payload) => {
      recordArmsCustomEventForE2E(payload);
      return window.cf.reportArmsCustomEvent(payload);
    },
    getRendererActionTraceConfig: window.cf.getRendererActionTraceConfig
      ? () => window.cf.getRendererActionTraceConfig!()
      : undefined,
    onRendererActionTraceConfigChanged: window.cf.onRendererActionTraceConfigChanged
      ? (callback) => window.cf.onRendererActionTraceConfigChanged!(callback)
      : undefined,
    reportLocalTtftBatch: (batch) => window.cf.reportLocalTtftBatch(batch),
    reportRendererActionTraceBatch: window.cf.reportRendererActionTraceBatch
      ? (batch) => window.cf.reportRendererActionTraceBatch!(batch)
      : undefined,
    reportRendererHeapSample: window.cf.reportRendererHeapSample
      ? (sample) => window.cf.reportRendererHeapSample!(sample)
      : undefined,
    showTaskNotification: (payload) => window.cf.showTaskNotification(payload),
    syncWindowTabs: (paths) => window.cf.syncWindowTabs(paths),
    syncWebRemoteControlWorkspaces: (workspaces) =>
      window.cf.syncWebRemoteControlWorkspaces?.(workspaces),
    onWebRemoteControlReconnectWorkspace: (handler) =>
      window.cf.onWebRemoteControlReconnectWorkspace?.(handler) ?? (() => {}),
    syncWindowUnreadCount: (count) => window.cf.syncWindowUnreadCount(count),
    syncActiveTaskSession: (sessionId) => window.cf.syncActiveTaskSession(sessionId),
    syncAppSettings: (patch) => window.cf.syncAppSettings?.(patch),
    getCloseToTrayCapability: () =>
      window.cf.getCloseToTrayCapability?.() ??
      Promise.resolve({ supported: true, gnomeLikeWithoutTray: false }),
    setShortcutRecordingActive: (active) => window.cf.setShortcutRecordingActive?.(active),
    onFocusTab: (handler) => window.cf.onFocusTab(handler),
    onNewTab: (handler) => window.cf.onNewTab(handler),
    onCloseActiveContextRequest: (handler) =>
      window.cf.onCloseActiveContextRequest?.(handler) ?? (() => {}),
    onOpenBrowserUrl: (handler) => window.cf.onOpenBrowserUrl?.(handler) ?? (() => {}),
    onEmbeddedBrowserPermissionPrompt: (handler) =>
      window.cf.onEmbeddedBrowserPermissionPrompt?.(handler) ?? (() => {}),
    resolveEmbeddedBrowserPermissionPrompt: (request) =>
      window.cf.resolveEmbeddedBrowserPermissionPrompt?.(request),
    getEmbeddedBrowserSitePermissions: () =>
      window.cf.getEmbeddedBrowserSitePermissions?.() ?? Promise.resolve({}),
    setEmbeddedBrowserSitePermission: (request) =>
      window.cf.setEmbeddedBrowserSitePermission?.(request) ?? Promise.resolve({}),
    clearEmbeddedBrowserSitePermissions: () =>
      window.cf.clearEmbeddedBrowserSitePermissions?.() ?? Promise.resolve({}),
    resetEmbeddedBrowserSitePermission: (request) =>
      window.cf.resetEmbeddedBrowserSitePermission?.(request) ?? Promise.resolve({}),
    onBrowserViewScreenshotSurfacePrepare: (handler) =>
      window.cf.onBrowserViewScreenshotSurfacePrepare?.(handler) ?? (() => {}),
    onBrowserViewScreenshotSurfaceRelease: (handler) =>
      window.cf.onBrowserViewScreenshotSurfaceRelease?.(handler) ?? (() => {}),
    browserViewScreenshotSurfaceReady: (payload) =>
      window.cf.browserViewScreenshotSurfaceReady?.(payload),
    ...desktopBrowserPlatformBridge,
    onNewTask: (handler) => window.cf.onNewTask(handler),
    onOpenWorkspace: (handler) => {
      return window.cf.onOpenWorkspace?.(handler) ?? (() => {});
    },
    onOpenWorkspacePath: (handler) => window.cf.onOpenWorkspacePath?.(handler) ?? (() => {}),
    onOpenFeedbackDialog: (handler) => window.cf.onOpenFeedbackDialog?.(handler) ?? (() => {}),
    onOpenTicketsPanel: (handler) => window.cf.onOpenTicketsPanel?.(handler) ?? (() => {}),
    onWindowFullscreenChanged: (handler) => window.cf.onWindowFullscreenChanged(handler),
    getDesktopWindowChromeState: window.cf.getDesktopWindowChromeState
      ? () => window.cf.getDesktopWindowChromeState!()
      : undefined,
    onDesktopWindowChromeStateChanged: window.cf.onDesktopWindowChromeStateChanged
      ? (handler) => window.cf.onDesktopWindowChromeStateChanged!(handler)
      : undefined,
    getWindowControlsOverlayMetrics: () => window.cf.getWindowControlsOverlayMetrics?.() ?? null,
    onWindowControlsOverlayChanged: (handler) =>
      window.cf.onWindowControlsOverlayChanged?.(handler) ?? (() => {}),
    getDesktopZoomLevel: () =>
      window.cf.getDesktopZoomLevel?.() ?? Promise.resolve({ zoomLevel: 0 }),
    onDesktopZoomLevelChanged: (handler) =>
      window.cf.onDesktopZoomLevelChanged?.(handler) ?? (() => {}),
    onTaskNotificationClick: (handler) => window.cf.onTaskNotificationClick(handler),
    exportLogs: () => window.cf.exportLogs(),
    captureWindowScreenshot: () =>
      window.cf.captureWindowScreenshot?.() ?? Promise.resolve(null),
    onUpdateReady: (callback) => window.cf.onUpdateReady(callback),
    onUpdateCheckResult: (callback) => window.cf.onUpdateCheckResult(callback),
    onUpdateStateChanged: (callback) => window.cf.onUpdateStateChanged?.(callback) ?? (() => {}),
    getUpdateState: () =>
      window.cf.getUpdateState?.() ?? Promise.resolve({ kind: "idle", enabled: true }),
    downloadUpdate: () => window.cf.downloadUpdate?.() ?? Promise.resolve(),
    cancelUpdateDownload: () => window.cf.cancelUpdateDownload?.() ?? Promise.resolve(),
    openUpdateStatusWindow: () => window.cf.openUpdateStatusWindow?.() ?? Promise.resolve(),
    getAutoUpdatePreferences: () =>
      window.cf.getAutoUpdatePreferences?.() ??
      Promise.resolve({ autoDownloadAndInstallUpdates: false }),
    setAutoDownloadAndInstallUpdates: (enabled) =>
      window.cf.setAutoDownloadAndInstallUpdates?.(enabled) ?? Promise.resolve(),
    getDesktopSessionActivity: () =>
      window.cf.getDesktopSessionActivity?.() ??
      Promise.resolve({ runningAgentSessionCount: 0 }),
    getCfStdioTapDevState: () =>
      window.cf.getCfStdioTapDevState?.() ??
      Promise.resolve({ enabled: false, visible: false, logDir: "", statePath: "" }),
    onSettingsChanged: (callback) => window.cf.onSettingsChanged?.(callback) ?? (() => {}),
    onApplicationLocaleChanged: (callback) =>
      window.cf.onApplicationLocaleChanged?.(callback) ?? (() => {}),
    onPostUpdateReleaseNotes: (callback) => window.cf.onPostUpdateReleaseNotes(callback),
    acknowledgePostUpdateReleaseNotes: (version) =>
      window.cf.acknowledgePostUpdateReleaseNotes(version),
    skipUpdateVersion: (version) => window.cf.skipUpdateVersion?.(version) ?? Promise.resolve(),
    quitAndInstallUpdate: () => window.cf.quitAndInstallUpdate(),
    getInstalledEditors: (filePath) => window.cf.getInstalledEditors(filePath),
    getApplicationIcon: (bundleId) =>
      window.cf.getApplicationIcon?.(bundleId) ?? Promise.resolve(null),
    openInEditor: (editorId, path, editorOptions) =>
      window.cf.openInEditor(editorId, path, editorOptions),
    executeDesktopCommand: (command) => window.cf.executeDesktopCommand(command),
    setApplicationLocale: (locale) => window.cf.setApplicationLocale(locale),
    getSystemLocale: () =>
      window.cf.getSystemLocale?.() ??
      Promise.resolve(navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US"),
    setTitleBarTheme: (theme) => window.cf.setTitleBarTheme(theme),
    getDeviceId: () =>
      (window as Window & { __CF_DEVICE_ID__?: string }).__CF_DEVICE_ID__ ?? "",
  };
}
