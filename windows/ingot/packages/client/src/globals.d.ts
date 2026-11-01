import type {
  DesktopCommandId,
  DesktopZoomState,
  DesktopWindowChromeState,
  DesktopTitleBarTheme,
  CuaAccessibilitySettingsResult,
  OpenCuaPermissionOnboardingOptions,
  PrepareCuaHelperPermissionDragResult,
  AppSettings,
  BrowserViewOperationPayload,
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
  ChromeBrowserDataImportResult,
  DockerContainerInfo,
  EmbeddedBrowserOpenUrlRequest,
  EmbeddedBrowserPermissionPromptEvent,
  EmbeddedBrowserPermissionResolveRequest,
  EmbeddedBrowserSitePermissionUpdateRequest,
  EmbeddedBrowserSitePermissionResetRequest,
  EmbeddedBrowserSitePermissionsSnapshot,
  EditorInfo,
  ApplicationIconInfo,
  ApplicationIconRequest,
  Locale,
  WebRemoteControlContext,
  WebRemoteControlReconnectWorkspaceRequest,
  WebRemoteControlReconnectWorkspaceResult,
  WebRemoteControlStartOperationResult,
  WebRemoteControlStatus,
  WebRemoteControlWorkspaceTarget,
  OAuthStateRegistration,
  WebRemoteControlAuthStateChange,
  PostUpdateReleaseNotesPayload,
  RemoteConnectionRuntimeLog,
  RemoteSessionClosedEvent,
  RemoteTarget,
  SSHConfigAliasOption,
  RendererTelemetryEventPayload,
  RendererActionTraceBatchV1,
  RendererActionTraceConfigV1,
  RendererHeapSample,
  TelemetryRendererContext,
  TaskNotificationPayload,
  WindowScreenshotResult,
  EmbeddedBrowserDataClearResult,
  WSLDistro,
  UpdateCheckResultPayload,
  UpdateStatePayload,
  OpenInEditorOptions,
} from "@origin-ai/cf-shared";

declare global {
  interface Window {
    
    cfPluginSandbox?: {
      supportsRetainedMove?: boolean;
      setExecutionActive?(sandboxId: string, initId: number, active: boolean): Promise<void>;
      copyImage?(
        input: import("@origin-ai/cf-shared/mcp-apps").PluginSandboxCaptureRequest,
      ): Promise<void>;
      getOwnerWebContentsId(): Promise<number>;
      disposeSandbox(sandboxId: string, initId?: number): Promise<void>;
      consumeUserGesture(sandboxId: string): Promise<boolean>;
    };
    cf: {
      connectRemote(
        options: RemoteTarget,
        requestId?: string,
        context?: {
          workspacePath: string;
          workspaceIdentity?: string;
          connectTrigger?: import("@origin-ai/cf-shared").RemoteWorkspaceConnectTrigger;
        },
      ): Promise<{ success: boolean; error?: string; sessionId?: string }>;
      requestSourceSettingsAttachment?(sourceServerId: string): Promise<{ attachmentId: string }>;
      
      cancelPendingRemoteConnection?(requestId?: string): Promise<void>;
      
      bindRemoteWorkspaceSessionContext?(context: {
        remoteSessionId: string;
        workspacePath: string;
        workspaceIdentity?: string;
      }): Promise<import("@origin-ai/cf-shared").BindRemoteWorkspaceSessionContextResult>;
      
      startWebRemoteControl(
        context: WebRemoteControlContext,
      ): Promise<WebRemoteControlStartOperationResult>;
      
      stopWebRemoteControl(): Promise<void>;
      
      getWebRemoteControlStatus(): Promise<WebRemoteControlStatus>;
      
      onWebRemoteControlStatusChanged?(
        handler: (status: WebRemoteControlStatus) => void,
      ): () => void;
      
      disposeRemoteSession(sessionId: string): Promise<void>;
      
      isDockerAvailable(): Promise<boolean>;
      
      listWSLDistros(): Promise<WSLDistro[]>;
      
      listDockerContainers(): Promise<DockerContainerInfo[]>;
      
      listSSHConfigAliases(): Promise<SSHConfigAliasOption[]>;
      
      log(level: "info" | "warn" | "error", args: unknown[]): void;
      
      selectDirectory(): Promise<string | null>;
      
      selectDirectories(): Promise<string[]>;
      
      selectFile(): Promise<string | null>;
      
      selectFiles?(): Promise<string[]>;
      
      saveFile?(
        payload: import("@origin-ai/cf-shared").SaveFileRequest,
      ): Promise<import("@origin-ai/cf-shared").SaveFileResult>;
      
      printPageToPdf?(): Promise<import("@origin-ai/cf-shared").PrintPageToPdfResult>;
      
      getPathForFile?(file: File): string | null;
      
      materializeWorkflowArtifactFile(
        payload: import("@origin-ai/cf-shared").MaterializeWorkflowArtifactFileRequest,
      ): Promise<import("@origin-ai/cf-shared").MaterializeWorkflowArtifactFileResult>;
      
      onRemoteConnectionLog(handler: (entry: RemoteConnectionRuntimeLog) => void): () => void;
      
      onRemoteSessionClosed(handler: (event: RemoteSessionClosedEvent) => void): () => void;
      
      activateOrSetWorkspace?(path: string): Promise<{ activated: boolean }>;
      
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
      
      getCloseToTrayCapability?(): Promise<import("@origin-ai/cf-shared").DesktopCloseToTrayCapability>;
      
      onFocusTab(handler: (path: string) => void): () => void;
      
      onNewTab(handler: () => void): () => void;
      
      onOpenBrowserUrl?(handler: (request: EmbeddedBrowserOpenUrlRequest) => void): () => void;
      
      onEmbeddedBrowserPermissionPrompt?(
        handler: (event: EmbeddedBrowserPermissionPromptEvent) => void,
      ): () => void;
      
      resolveEmbeddedBrowserPermissionPrompt?(
        request: EmbeddedBrowserPermissionResolveRequest,
      ): void;
      
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
      onBrowserViewCloseTab?(
        handler: (payload: BrowserViewCloseTabNotification) => void,
      ): () => void;
      onBrowserViewSuspend?(
        handler: (payload: BrowserViewResidencyTransitionPayload) => void,
      ): () => void;
      onBrowserViewRestore?(
        handler: (payload: BrowserViewResidencyTransitionPayload) => void,
      ): () => void;
      
      onNewTask(handler: () => void): () => void;
      
      onOpenWorkspace?(handler: () => void): () => void;
      
      onOpenWorkspacePath?(handler: (path: string) => void): () => void;
      
      onWindowFullscreenChanged(handler: (isFullscreen: boolean) => void): () => void;
      
      getDesktopWindowChromeState?(): Promise<DesktopWindowChromeState>;
      
      onDesktopWindowChromeStateChanged?(
        handler: (state: DesktopWindowChromeState) => void,
      ): () => void;
      
      getDesktopZoomLevel?(): Promise<DesktopZoomState>;
      
      onDesktopZoomLevelChanged?(handler: (state: DesktopZoomState) => void): () => void;
      
      onTaskNotificationClick(handler: (taskId: string) => void): () => void;
      
      openExternal(url: string): void;
      
      canOpenCommunity(locale: Locale): Promise<boolean>;
      
      openInFileManager(path: string): Promise<{ success: boolean; error?: string }>;
      
      openExternalFile(path: string): Promise<{ success: boolean; error?: string }>;
      
      openCuaPermissionOnboarding?(
        options?: OpenCuaPermissionOnboardingOptions,
      ): Promise<CuaAccessibilitySettingsResult>;
      
      cancelCuaPermissionOnboarding?(operationId: string): void;
      
      prepareCuaHelperPermissionDrag?(): Promise<PrepareCuaHelperPermissionDragResult>;
      
      startCuaHelperPermissionDrag?(): void;
      
      registerOAuthState(payload: OAuthStateRegistration): void;
      notifyWebRemoteControlAuthStateChanged(change: WebRemoteControlAuthStateChange): void;
      
      onOAuthCallback(cb: (url: string) => void): () => void;
      
      onPaymentCallback(cb: (url: string) => void): () => void;
      
      notifyRendererReady(): void;
      
      syncTelemetryContext(context: TelemetryRendererContext): void;
      
      reportTelemetryEvent(payload: RendererTelemetryEventPayload): Promise<void>;
      
      getRendererActionTraceConfig?(): Promise<RendererActionTraceConfigV1>;
      
      onRendererActionTraceConfigChanged?(
        callback: (config: RendererActionTraceConfigV1) => void,
      ): () => void;
      
      reportRendererActionTraceBatch?(batch: RendererActionTraceBatchV1): void;
      
      reportRendererHeapSample?(sample: RendererHeapSample): void;
      
      showTaskNotification(payload: TaskNotificationPayload): void;
      
      exportLogs(): Promise<{
        success: boolean;
        path?: string;
        error?: string;
      }>;
      
      captureWindowScreenshot?(): Promise<WindowScreenshotResult | null>;
      browserViewAttachGuest?(payload: {
        key: string;
        webContentsId: number;
        active?: boolean;
        workspaceKey?: string;
        remoteSessionId?: string;
        sessionId?: string;
        residencyGeneration?: number;
      }): Promise<void>;
      
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
        options?: import("@origin-ai/cf-shared").ChromeBrowserDataImportOptions,
      ): Promise<ChromeBrowserDataImportResult>;
      
      clearEmbeddedBrowserData?(mode: "cache" | "all"): Promise<EmbeddedBrowserDataClearResult>;
      
      onUpdateReady(callback: (version: string) => void): () => void;
      
      onUpdateCheckResult(callback: (payload: UpdateCheckResultPayload) => void): () => void;
      
      onUpdateStateChanged?(callback: (payload: UpdateStatePayload) => void): () => void;
      
      getUpdateState?(): Promise<UpdateStatePayload>;
      
      downloadUpdate?(): Promise<void>;
      
      cancelUpdateDownload?(): Promise<void>;
      
      openUpdateStatusWindow?(): Promise<void>;
      
      getAutoUpdatePreferences?(): Promise<{
        autoDownloadAndInstallUpdates: boolean;
      }>;
      
      setAutoDownloadAndInstallUpdates?(enabled: boolean): Promise<void>;
      
      skipUpdateVersion?(version: string): Promise<void>;
      
      onApplicationLocaleChanged?(callback: (locale: Locale) => void): () => void;
      
      onSettingsChanged?(callback: () => void): () => void;
      
      getDesktopSessionActivity?(): Promise<{
        runningAgentSessionCount: number;
      }>;
      
      onPostUpdateReleaseNotes(
        callback: (payload: PostUpdateReleaseNotesPayload) => void,
      ): () => void;
      
      acknowledgePostUpdateReleaseNotes(version: string): Promise<void>;
      
      quitAndInstallUpdate(): Promise<void>;
      
      getInstalledEditors(filePath?: string): Promise<EditorInfo[]>;
      
      getApplicationIcon?(
        request: string | ApplicationIconRequest,
      ): Promise<ApplicationIconInfo | null>;
      
      openInEditor(
        editorId: string,
        path: string,
        options?: OpenInEditorOptions,
      ): Promise<{ success: boolean; error?: string }>;
      
      executeDesktopCommand(command: DesktopCommandId): Promise<void>;
      
      setApplicationLocale(locale: Locale): Promise<void>;
      
      getSystemLocale?(): Promise<Locale>;
      
      setTitleBarTheme(theme: DesktopTitleBarTheme): Promise<void>;
    };
  }
}
