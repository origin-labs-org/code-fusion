import { mobilePluginDiscoveryTelemetrySchema } from "@origin-ai/cf-shared";
import {
  sessionCreateTelemetrySchema,
  type RendererTelemetryEventPayload,
  WEB_REMOTE_CONTROL_WORKSPACE_RECONNECT_TIMEOUT_MS,
  createWebRemoteControlConnectionRecoveryTimeoutFailure,
  resolveWebRemoteControlRelayWsUrl,
  matchesWebRemoteControlRoutePath,
  resolveWebRemoteControlInitialWorkspaceSelection,
  resolveWebRemoteControlWorkspaceKey,
} from "@origin-ai/cf-shared";

import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import {
  AppErrorBoundary,
  ensurePendingTaskDraft,
  Root,
  CfIntlProvider,
  generateMobileDeviceFingerprint,
  installDocumentHiddenMotionPause,
  playTaskNotificationSound,
  setStreamClientId,
  setWebRemoteControlTerminalTransportState,
  type Theme,
  type WebRemoteControlTerminalTransportState as UiWebRemoteControlTerminalTransportState,
} from "@origin-ai/cf-ui";
import "./styles.css";
import {
  connectViaProtocol,
  connectViaWebSocket,
  createAcknowledgedWebRemoteControlRelayProtocol,
} from "@origin-ai/cf-client";

import { WebCallbackPage } from "./auth/WebCallbackPage.js";
import { WebLoginPage } from "./auth/WebLoginPage.js";
import { createWebAuthService } from "./auth/webAuthService.js";
import { WEB_ZAI_OAUTH_CONFIG, resolveWebAuthDevReturnTo } from "./auth/webZaiOAuthConfig.js";
import { parseOAuthState, resolveSafeAppReturnTo } from "./auth/oauthStateCodec.js";
import { resolveWebCommunityUrl, resolveWebHelpConfig } from "./communityUrl.js";
import {
  ConversationShareLandingLoader,
  ConversationShareLandingStatus,
} from "./share/ConversationShareLandingPage.js";
import {
  ConversationSharePreviewClient,
  resolveConversationShareRouteLocale,
} from "./share/conversationSharePreviewClient.js";
import {
  isConversationSharePath,
  resolveConversationShareCodeFromPath,
} from "./share/conversationShareRoute.js";
import type {
  IPlatformService,
  WebRemoteControlFailure,
  WebRemoteControlFailureReason,
  WebRemoteControlPlatformMethod,
  WebRemoteControlPlatformMethodArgsMap,
  WebRemoteControlPlatformMethodResultMap,
  WebRemoteControlPlatformRequestPayload,
  WebRemoteControlPlatformResponsePayload,
  WebRemoteControlWindowBootstrapResult,
  WebRemoteControlWorkspaceBridge,
  WebRemoteControlWorkspaceListResult,
  WebRemoteControlMobileNavigationIntent,
  WebRemoteControlTaskTarget,
  WebRemoteControlWorkspaceSwitchOptions,
  WebRemoteControlStatus,
  WebRemoteControlAppPayload,
  WebRemoteControlExternalWorkspaceBridge,
  RemoteTarget,
  ServerRemoteInfo,
} from "@origin-ai/cf-shared";

import {
  WebRemoteControlEntry,
  isWebRemoteControlOAuthCallback,
  type WebRemoteControlEntryConnection,
  createWebRemoteControlV2TokenClient,
  readKnownDevices,
  createWebRemoteControlDeviceClient,
  createWebRemoteControlBridgeRecoveryRunner,
  getWebRemoteControlBridgeRecoveryRetryDelay,
  WebRemoteControlTerminalTransport,
  type WebRemoteControlTerminalTransportDiagnostic,
  type WebRemoteControlTerminalTransportState,
  createWebRemoteControlAppPayloadRequester,
  createWebRemoteControlRelayRequestRecovery,
  createWebRemoteControlLifecycleRecovery,
  WEB_REMOTE_CONTROL_DEFAULT_THEME,
  resolveWebRemoteControlInitialTheme,
  collectWebRemoteControlMobileDeviceInfo,
  createWebRemoteControlVersionGuard,
  resolveWebRemoteControlRoutePath,
  registerWebRemoteControlWorkspaceBridgeServices,
  connectWebRemoteControlWorkspaceBridgeServices,
  replayWebRemoteControlWorkspaceBridgeFrames,
  createWebRemoteControlTaskViewPublisher,
  type WebRemoteControlWorkspaceBridgeServiceRegistration,
  markWebRemoteControlBridgeTaskRead,
  markWebRemoteControlTaskRead,
} from "#src/web-remote-control/index.js";

import {
  WebRemoteControlDeviceListPage,
  WebRemoteControlLoadingScreen,
  type WebRemoteControlConnectingDevice,
  WebRemoteControlFailureScreen,
  resolveWebRemoteControlScreenLocale,
  showWebRemoteControlVersionNotice,
} from "#src/web-remote-control/views.js";

type RootServices = Parameters<typeof Root>[0]["services"];
type ServiceMethod = (...args: any[]) => unknown;

function logWebRemoteControlTaskReadFailure(
  error: unknown,
  context: { taskId: string; workspaceKey: string },
): void {
  console.warn("[web-remote-control] Label记手机端 task 已读Failed", {
    error: error instanceof Error ? error.message : String(error),
    taskId: context.taskId,
    workspaceKey: context.workspaceKey,
  });
}

async function markCurrentWebRemoteControlBridgeTaskRead({
  bridge,
  services,
  task,
}: {
  bridge: WebRemoteControlExternalWorkspaceBridge | WebRemoteControlWorkspaceBridge;
  services: RootServices;
  task: WebRemoteControlTaskTarget;
}): Promise<void> {
  const taskWorkspaceKey = resolveWebRemoteControlWorkspaceKey(task);
  if (taskWorkspaceKey !== bridge.workspaceKey) {
    console.warn("[web-remote-control] Skip跨 workspace 的 task 已读Write", {
      taskId: task.taskId,
      taskWorkspaceKey,
      bridgeWorkspaceKey: bridge.workspaceKey,
    });
    return;
  }
  if (typeof task.unreadAt !== "number") {
    return;
  }

  const result = await markWebRemoteControlTaskRead({
    service: services.cfTaskService,
    target: {
      taskId: task.taskId,
      workspacePath: task.workspacePath,
      ...(task.workspaceIdentity ? { workspaceIdentity: task.workspaceIdentity } : {}),
      expectedUnreadAt: task.unreadAt,
    },
  });
  if (!result.ok) {
    logWebRemoteControlTaskReadFailure(result.error, {
      taskId: task.taskId,
      workspaceKey: taskWorkspaceKey,
    });
  }
}

async function markOpenedWebRemoteControlBridgeTaskRead({
  bridge,
  expectedUnreadAt,
  services,
}: {
  bridge: WebRemoteControlExternalWorkspaceBridge | WebRemoteControlWorkspaceBridge;
  expectedUnreadAt?: number;
  services: RootServices;
}): Promise<void> {
  const result = await markWebRemoteControlBridgeTaskRead({
    bridge,
    expectedUnreadAt,
    service: services.cfTaskService,
  });
  if (!result.ok) {
    logWebRemoteControlTaskReadFailure(result.error, {
      taskId: bridge.initialTaskId ?? "unknown",
      workspaceKey: bridge.workspaceKey,
    });
  }
}

function resolveWebThemePreference(defaultTheme: Theme = WEB_REMOTE_CONTROL_DEFAULT_THEME): Theme {
  const saved = localStorage.getItem("cf-theme");
  return resolveWebRemoteControlInitialTheme({ storedTheme: saved, defaultTheme });
}

{
  const saved = resolveWebThemePreference(
    isConversationSharePath(window.location.pathname) ? "cf-light" : undefined,
  );
  const resolved =
    saved === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : saved === "dark" || saved === "cf-dark"
        ? "dark"
        : "light";
  const appliedTheme =
    saved === "system"
      ? resolved === "dark"
        ? "cf-dark"
        : "cf-light"
      : saved === "dark"
        ? "cf-dark"
        : saved === "light"
          ? "cf-light"
          : saved;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.classList.toggle("theme-cf-light", appliedTheme === "cf-light");
  document.documentElement.classList.toggle("theme-cf-dark", appliedTheme === "cf-dark");
}

async function resolveFeedbackUrl(): Promise<string | undefined> {
  return (await resolveWebHelpConfig()).feedback_url;
}

installDocumentHiddenMotionPause();
const root = createRoot(document.getElementById("root")!);
const webAuthService = createWebAuthService();
let isPageUnloading = false;

{
  setStreamClientId(generateMobileDeviceFingerprint());
}

window.addEventListener("beforeunload", () => {
  isPageUnloading = true;
});

interface WebRemoteControlPlatformProxy {
  reportTelemetryEvent?: (event: RendererTelemetryEventPayload) => void;
  requestPlatformMethod<K extends WebRemoteControlPlatformMethod>(
    method: K,
    args?: WebRemoteControlPlatformMethodArgsMap[K],
  ): Promise<WebRemoteControlPlatformMethodResultMap[K]>;
}

interface WebBootstrapResult {
  wsUrl: string;
  initialWorkspaceAbsPath?: string;
  initialWorkspaceIdentity?: string;
  initialTaskId?: string;
  restoreSession?: boolean;
  allowOpenWorkspace?: boolean;
}

type WebRemoteControlWorkspaceListUpdateListener = (
  result: WebRemoteControlWorkspaceListResult,
) => void;

function renderWebRemoteControlFailure(failure: WebRemoteControlFailure): void {
  root.render(
    <WebRemoteControlFailureScreen
      failure={failure}
      locale={resolveWebRemoteControlScreenLocale(navigator.language)}
      primaryActionLabel={
        failure.reason === "device-not-owned"
          ? isZhLocale()
            ? "切换账Number"
            : "Switch account"
          : undefined
      }
      secondaryAction={
        isWebRemoteControlRoute()
          ? {
              label: isZhLocale() ? "选择OtherDevice" : "Choose another device",
              onClick: () => {
                void remoteEntry.chooseOtherDevice();
              },
            }
          : undefined
      }
      onReload={() => {
        if (failure.reason === "device-not-owned") void remoteEntry.switchAccount();
        else window.location.reload();
      }}
    />,
  );
}

function isWebOAuthCallback(params: URLSearchParams): boolean {
  return (
    isWebRemoteControlOAuthCallback(new URL(window.location.href)) ||
    (["/cn/share/callback", "/share/callback"].includes(window.location.pathname) &&
      params.has("state") &&
      (params.has("code") || params.has("authCode") || params.has("error")))
  );
}

function renderWebAuthCallbackPage(): void {
  document.title = "CodeFusion - Web Remote Control Sign In";
  const callbackState = parseOAuthState(
    new URLSearchParams(window.location.search).get("state") ?? "",
  );
  const safeRetryTarget = resolveSafeAppReturnTo(callbackState?.app_return_to);
  root.render(
    <WebCallbackPage
      authService={webAuthService}
      onSuccess={({ appReturnTo }) => {
        window.location.replace(appReturnTo ?? "/remote/v4");
      }}
      onRetry={() => {
        window.location.replace(safeRetryTarget ?? "/remote/v4");
      }}
    />,
  );
}

async function renderConversationSharePage(): Promise<void> {
  const routeLocale = resolveConversationShareRouteLocale(window.location.pathname);
  document.documentElement.lang = routeLocale;
  document.title = routeLocale === "zh-CN" ? "CodeFusion Session Sharing" : "CodeFusion Conversation Share";
  const shareCode = resolveConversationShareCodeFromPath(window.location.pathname);
  if (!shareCode) {
    root.render(
      <ConversationShareLandingStatus
        state={{ kind: "error", error: "invalid_contract" }}
        locale={routeLocale}
      />,
    );
    return;
  }

  const endpointOrigin =
    import.meta.env.VITE_CF_BASE_URL?.trim().replace(/\/+$/u, "") || window.location.origin;
  const mockMode =
    import.meta.env.DEV && import.meta.env.VITE_CONVERSATION_SHARE_PREVIEW_MOCK === "true";
  console.info("[conversation-share-web]", "preview_runtime_initialized", {
    browserOrigin: window.location.origin,
    routeKind: "canonical",
    endpointOrigin,
    transport: mockMode ? "mock" : "fetch",
  });
  const client = mockMode
    ? new (
        await import("./share/mockConversationSharePreviewClient.js")
      ).MockConversationSharePreviewClient()
    : new ConversationSharePreviewClient({ baseUrl: `${endpointOrigin}/api/v1` });
  const getMockToken = () =>
    mockMode && window.sessionStorage.getItem("cf:share:mock-auth") === "owner"
      ? "mock-owner-token"
      : null;
  const onLogout = () => {
    if (mockMode) {
      window.sessionStorage.removeItem("cf:share:mock-auth");
      window.location.reload();
      return;
    }
    void webAuthService.logout();
  };
  root.render(
    <ConversationShareLandingLoader
      shareCode={shareCode}
      client={client}
      getAccessToken={() => getMockToken() ?? webAuthService.getCfJwtToken()}
      onLogin={(provider) => {
        if (mockMode) {
          window.sessionStorage.setItem("cf:share:mock-auth", "owner");
          window.location.reload();
          return;
        }
        webAuthService.startLogin({
          provider,
          appReturnTo: window.location.href,
          redirectUri: WEB_ZAI_OAUTH_CONFIG.shareRedirectUri,
          devReturnTo: resolveWebAuthDevReturnTo(WEB_ZAI_OAUTH_CONFIG, "share"),
        });
      }}
      onLogout={onLogout}
      locale={routeLocale}
      theme={resolveWebThemePreference("cf-light")}
    />,
  );
}

function renderWebLoginPage(): void {
  document.title = "CodeFusion - Web Remote Control Sign In";
  root.render(<WebLoginPage onLogin={(provider) => remoteEntry.startLogin(provider)} />);
}

const webRemoteControlStorage: Pick<Storage, "getItem" | "setItem"> = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};

const remoteEntry = new WebRemoteControlEntry({
  auth: webAuthService,
  getHref: () => window.location.href,
  replaceHref: (href) => window.history.replaceState(window.history.state, "", href),
  storage: webRemoteControlStorage,
  locale: resolveWebRemoteControlScreenLocale(navigator.language),
  devices: createWebRemoteControlDeviceClient(window.location.origin),
  subscribeVisible: (listener) => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") listener();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  },
  loginOptions: { devReturnTo: resolveWebAuthDevReturnTo(WEB_ZAI_OAUTH_CONFIG) },
  token: createWebRemoteControlV2TokenClient(window.location.origin),
  connect: (connection) => {
    void bootstrapExternalRelayWebRemoteControl(connection);
  },
  onView: (view) => {
    if (view.kind === "callback") renderWebAuthCallbackPage();
    else if (view.kind === "login") renderWebLoginPage();
    else if (view.kind === "devices") {
      document.title = "CodeFusion - Web Remote Control";
      root.render(
        <WebRemoteControlDeviceListPage
          view={view}
          onSelect={(sid) => remoteEntry.selectDevice(sid)}
          onRefresh={() => {
            void remoteEntry.refreshDevices();
          }}
          onSwitchAccount={() => {
            void remoteEntry.switchAccount();
          }}
          locale={resolveWebRemoteControlScreenLocale(navigator.language)}
        />,
      );
    } else if (view.kind === "failure") renderWebRemoteControlFailure(view.failure);
  },
});

function toWebRemoteControlFailure(
  reason: WebRemoteControlFailureReason,
  message?: string,
): WebRemoteControlFailure {
  return { reason, message };
}

function createWebPlatform(options?: {
  externalWebRemoteControlProxy?: WebRemoteControlPlatformProxy;
}): IPlatformService {
  const platformProxy = options?.externalWebRemoteControlProxy;

  return {
    canSelectFilePath: false,
    canOpenLocalFiles: false,
    selectDirectory: () => Promise.resolve(null),
    selectFile: () => Promise.resolve(null),
    selectFiles: () => Promise.resolve([]),
    getPathForFile: () => null,
    createTempTextAttachment: (payload) =>
      platformProxy
        ? platformProxy.requestPlatformMethod("createTempTextAttachment", payload)
        : Promise.reject(new Error("Temporary text attachments require a desktop host")),
    onRemoteConnectionLog: () => () => {},
    onRemoteSessionClosed: () => () => {},
    activateOrSetWorkspace: () => Promise.resolve({ activated: false }),
    async connectRemote(
      options: RemoteTarget,
      _requestId?: string,
      _context?: {
        workspacePath: string;
        workspaceIdentity?: string;
        connectTrigger?: import("@origin-ai/cf-shared").RemoteWorkspaceConnectTrigger;
      },
    ) {
      if (platformProxy) {
        return {
          success: false,
          error: `Remote connect is not supported in Web remote control mode yet: ${options.kind}`,
        };
      }

      return {
        success: false,
        error: `Remote connect is not supported in Web mode yet: ${options.kind}`,
      };
    },
    cancelPendingRemoteConnection: (_requestId?: string) => Promise.resolve(),
    startWebRemoteControl: () =>
      Promise.reject(new Error("Web remote control can only be started from desktop")),
    stopWebRemoteControl: () => Promise.resolve(),
    getWebRemoteControlStatus: () =>
      Promise.resolve<WebRemoteControlStatus>({
        status: "idle",
      }),
    disposeRemoteSession: () => Promise.resolve(),
    isDockerAvailable: () =>
      platformProxy
        ? platformProxy.requestPlatformMethod("isDockerAvailable")
        : Promise.resolve(false),
    listWSLDistros: () =>
      platformProxy ? platformProxy.requestPlatformMethod("listWSLDistros") : Promise.resolve([]),
    listDockerContainers: () =>
      platformProxy
        ? platformProxy.requestPlatformMethod("listDockerContainers")
        : Promise.resolve([]),
    listSSHConfigAliases: () =>
      platformProxy
        ? platformProxy.requestPlatformMethod("listSSHConfigAliases")
        : Promise.resolve([]),
    loadMcpFromUserDirectory: (payload) =>
      platformProxy
        ? platformProxy.requestPlatformMethod("loadMcpFromUserDirectory", payload)
        : Promise.resolve({ servers: [] }),
    saveMcpToUserDirectory: (payload) =>
      platformProxy
        ? platformProxy.requestPlatformMethod("saveMcpToUserDirectory", payload)
        : Promise.resolve({
            success: false,
            error: "MCP native directory management requires a desktop attachment",
          }),
    migrateLegacyCommonMcp: (payload) =>
      platformProxy
        ? platformProxy.requestPlatformMethod("migrateLegacyCommonMcp", payload)
        : Promise.resolve({
            servers: {},
            totalCount: 0,
            importedCount: 0,
            skippedCount: 0,
          }),
    openExternal: (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    openFeedback: async () => {
      const feedbackUrl = await resolveFeedbackUrl();
      if (!feedbackUrl) {
        return;
      }
      window.open(feedbackUrl, "_blank", "noopener,noreferrer");
    },
    openCommunity: async () => {
      const locale = document.documentElement.lang === "en-US" ? "en-US" : "zh-CN";
      const communityUrl = await resolveWebCommunityUrl(locale);
      if (!communityUrl) {
        return;
      }
      window.open(communityUrl, "_blank", "noopener,noreferrer");
    },
    canOpenCommunity: async (locale) => {
      const communityUrl = await resolveWebCommunityUrl(locale);
      return typeof communityUrl === "string" && communityUrl.length > 0;
    },
    openInFileManager: () =>
      Promise.resolve({ success: false, error: "Not supported in web mode" }),
    openExternalFile: () => Promise.resolve({ success: false, error: "Not supported in web mode" }),
    registerOAuthState: (_payload) => {},
    onOAuthCallback: () => () => {},
    onPaymentCallback: () => () => {},
    onShareImport: () => () => {},
    notifyRendererReady: () => {},
    reportTelemetryEvent: async (event) => {
      const parsed = sessionCreateTelemetrySchema
        .or(mobilePluginDiscoveryTelemetrySchema)
        .safeParse(event);
      if (parsed.success) platformProxy?.reportTelemetryEvent?.(parsed.data);
    },
    reportArmsCustomEvent: () => Promise.resolve(),
    showTaskNotification: (payload) => {
      if (document.hasFocus()) {
        return;
      }

      if (
        typeof window.Notification === "undefined" ||
        window.Notification.permission !== "granted"
      ) {
        return;
      }

      try {
        new window.Notification(payload.title, {
          body: payload.body,
          silent: true,
        });
        void playTaskNotificationSound();
      } catch {
      }
    },
    syncWindowTabs: () => {},
    syncWindowUnreadCount: () => {},
    syncActiveTaskSession: () => {},
    onFocusTab: () => () => {},
    onNewTab: () => () => {},
    onCloseActiveContextRequest: () => () => {},
    onOpenBrowserUrl: () => () => {},
    onNewTask: () => () => {},
    onOpenWorkspace: () => () => {},
    onWindowFullscreenChanged: () => () => {},
    onTaskNotificationClick: () => () => {},
    exportLogs: () => Promise.resolve({ success: false, error: "Not supported in web mode" }),
    captureWindowScreenshot: () => Promise.resolve(null),
    importChromeBrowserData: (_options) =>
      Promise.resolve({
        success: false,
        cookies: { imported: 0, skipped: 0, failed: 0 },
        localStorage: {
          originsImported: 0,
          entriesImported: 0,
          originsSkipped: 0,
          originsFailed: 0,
        },
        error: "chrome_import_not_supported" as const,
      }),
    clearEmbeddedBrowserData: () =>
      Promise.resolve({ success: false, error: "Not supported in web mode" }),
    onUpdateReady: () => () => {},
    onUpdateCheckResult: () => () => {},
    onUpdateStateChanged: () => () => {},
    getUpdateState: () => Promise.resolve({ kind: "idle", enabled: true }),
    downloadUpdate: () => Promise.resolve(),
    cancelUpdateDownload: () => Promise.resolve(),
    getDesktopSessionActivity: () => Promise.resolve({ runningAgentSessionCount: 0 }),
    getDesktopZoomLevel: () => Promise.resolve({ zoomLevel: 0 }),
    onDesktopZoomLevelChanged: () => () => {},
    onPostUpdateReleaseNotes: () => () => {},
    acknowledgePostUpdateReleaseNotes: () => Promise.resolve(),
    skipUpdateVersion: () => Promise.resolve(),
    quitAndInstallUpdate: () => Promise.resolve(),
    getInstalledEditors: () => Promise.resolve([]),
    openInEditor: () => Promise.resolve({ success: false, error: "Not supported in web mode" }),
    executeDesktopCommand: () => Promise.resolve(),
    setApplicationLocale: (_locale) => Promise.resolve(),
    setTitleBarTheme: () => Promise.resolve(),
    getDeviceId: () => {
      const nav = globalThis.navigator as Navigator & { platform?: string };
      const platform = nav?.platform ?? "";
      const screenWidth = globalThis.screen?.width;
      const screenHeight = globalThis.screen?.height;
      const colorDepth = globalThis.screen?.colorDepth;
      const parts = [
        platform,
        screenWidth !== undefined ? String(screenWidth) : "",
        screenHeight !== undefined ? String(screenHeight) : "",
        colorDepth !== undefined ? String(colorDepth) : "",
      ];
      return parts.filter(Boolean).join("|");
    },
  };
}

function resolveDefaultWsOrigin(): string {
  return `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
}

async function resolveWebBootstrap(): Promise<WebBootstrapResult> {
  const params = new URLSearchParams(window.location.search);
  const remoteId = params.get("remote");
  const wsUrl = remoteId
    ? `${resolveDefaultWsOrigin()}/ws/remote/${remoteId}`
    : `${resolveDefaultWsOrigin()}/ws`;

  if (remoteId) {
    return { wsUrl };
  }

  try {
    const response = await fetch("/api/server-info", {
      cache: "no-store",
    });
    if (!response.ok) {
      return { wsUrl };
    }
    const serverInfo = (await response.json()) as Partial<ServerRemoteInfo>;
    const workspace = Array.isArray(serverInfo.workspaces) ? serverInfo.workspaces[0] : undefined;
    return {
      wsUrl,
      ...(workspace?.path ? { initialWorkspaceAbsPath: workspace.path } : {}),
      ...(workspace?.workspaceIdentity
        ? { initialWorkspaceIdentity: workspace.workspaceIdentity }
        : {}),
    };
  } catch {
    return { wsUrl };
  }
}

function selectInitialWebRemoteControlWorkspace(
  snapshot: WebRemoteControlWindowBootstrapResult,
): ReturnType<typeof resolveWebRemoteControlInitialWorkspaceSelection> {
  return resolveWebRemoteControlInitialWorkspaceSelection(snapshot);
}

function isWebRemoteControlRoute(): boolean {
  return (
    matchesWebRemoteControlRoutePath(window.location.pathname, "/remote/v4") ||
    matchesWebRemoteControlRoutePath(
      window.location.pathname,
      resolveWebRemoteControlRoutePath(import.meta.env),
    )
  );
}

function createWebRemoteControlRequestId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

function seedStableWebRemoteControlClientId(deviceSid: string): void {
  const storageKey = `cf-web-remote-client-id:${deviceSid}`;
  try {
    const existing = globalThis.localStorage?.getItem(storageKey)?.trim();
    if (existing) {
      setStreamClientId(existing);
      return;
    }
    const nextId = globalThis.crypto?.randomUUID?.() ?? generateMobileDeviceFingerprint();
    globalThis.localStorage?.setItem(storageKey, nextId);
    setStreamClientId(nextId);
  } catch {
    setStreamClientId(generateMobileDeviceFingerprint());
  }
}

function createUnsupportedHomeOnlyService<T extends object>(serviceName: string): T {
  return new Proxy(
    {},
    {
      get: (_target, property) => async () => {
        throw new Error(
          `${serviceName}.${String(property)} is not available before a Web remote control workspace bridge is connected.`,
        );
      },
    },
  ) as T;
}

const emptyHomeOnlyEvent = () => ({ dispose() {} });

function createEmptyHomeOnlyService<T extends object>(handlers: Record<string, ServiceMethod>): T {
  return new Proxy(handlers, {
    get: (target, property) => {
      if (typeof property !== "string") {
        return undefined;
      }
      if (target[property]) return target[property];
      if (/^onDynamic[A-Z]/.test(property)) return () => emptyHomeOnlyEvent;
      if (/^on[A-Z]/.test(property)) return emptyHomeOnlyEvent;
      return async () => undefined;
    },
  }) as T;
}

export function createHomeOnlyWebRemoteControlServices(): RootServices {
  const unsupported = (channel: string) => async () => {
    throw new Error(
      `${channel} is not available before a Web remote control workspace bridge is connected.`,
    );
  };
  const settingService: RootServices["settingService"] = {
    get: async () => ({
      recentProjects: [],
      locale: resolveWebRemoteControlScreenLocale(navigator.language),
    }),
    update: async () => {},
    updateDataBaseDir: async () => {},
  };

  const emptyGitSummary = (workspacePath: string) => ({
    workspacePath,
    repoRoot: workspacePath,
    workspaceInRepoPath: ".",
    autoRefreshWatchPaths: [],
    branchName: null,
    trackingBranchName: null,
    headRefType: "branch" as const,
    ahead: 0,
    behind: 0,
    isDirty: false,
    isGitAvailable: false,
    isRepository: false,
  });
  const homeOnlyCfTaskService = createEmptyHomeOnlyService<RootServices["cfTaskService"]>({
    initialize: async () => ({ available: false }),
    releaseWorkspacePreparation: async () => {},
    checkCodexConnectivity: async () => ({ ok: true }),
    listTasks: async () => [],
    listPinnedTaskIds: async () => [],
    listPinnedTasks: async () => [],
    listTaskList: async () => ({ items: [], total: 0, hasMore: false }),
    getTaskTokenUsage: async (params: { taskId: string }) => ({
      sessionId: params.taskId,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      modelRequestCount: 0,
      modelErrorCount: 0,
      inputBaselineBySource: {},
    }),
    listArchivedTasks: async () => [],
    getTaskSnapshot: async () => null,
    getTaskSnapshotWithEtag: async () => ({ snapshot: null }),
    getTaskSnapshotBody: async () => null,
    getTaskSnapshotRef: async () => null,
    getTaskSnapshotToolCallsSlice: async () => null,
    getTaskMeta: async () => null,
  });
  return {
    fileService: {
      readdir: unsupported("fileService.readdir"),
      stat: unsupported("fileService.stat"),
      checkFilesExist: unsupported("fileService.checkFilesExist"),
      resolvePath: unsupported("fileService.resolvePath"),
      createDefaultWorkspace: unsupported("fileService.createDefaultWorkspace"),
      ensureConversationWorkspace: unsupported("fileService.ensureConversationWorkspace"),
      createScratchWorkspace: unsupported("fileService.createScratchWorkspace"),
      readTextFile: unsupported("fileService.readTextFile"),
      readMediaPreview: unsupported("fileService.readMediaPreview"),
      readFileRange: unsupported("fileService.readFileRange"),
      readBinaryPreview: unsupported("fileService.readBinaryPreview"),
      searchWorkspaceFiles: unsupported("fileService.searchWorkspaceFiles"),
      listWorkspaceFilesLength: unsupported("fileService.listWorkspaceFilesLength"),
      listWorkspaceFilesRange: unsupported("fileService.listWorkspaceFilesRange"),
      readWorkspaceFileSearchIgnore: unsupported("fileService.readWorkspaceFileSearchIgnore"),
      applyWorkspaceFileSearchIgnoreTransform: unsupported(
        "fileService.applyWorkspaceFileSearchIgnoreTransform",
      ),
      writeWorkspaceFileSearchIgnore: unsupported("fileService.writeWorkspaceFileSearchIgnore"),
    },
    mediaPreviewService:
      createUnsupportedHomeOnlyService<NonNullable<RootServices["mediaPreviewService"]>>(
        "mediaPreviewService",
      ),
    gitService: createEmptyHomeOnlyService<RootServices["gitService"]>({
      getRepositorySummary: async (params: { workspacePath: string }) =>
        emptyGitSummary(params.workspacePath),
      getWorkspaceRepositoryInfo: async () => ({ repositories: [] }),
      getLocalBranches: async () => ({ branches: [], currentBranch: null }),
      getChanges: async () => [],
      getIgnoredPaths: async () => [],
      getDiff: async () => ({ sections: [], files: [] }),
      getBranchComparison: async () => ({
        baseRef: null,
        headRef: null,
        comparisonLabel: null,
        changes: [],
      }),
      getIdentity: async () => ({
        userName: null,
        userEmail: null,
        nameSource: null,
        emailSource: null,
        scopeLabel: null,
      }),
      refresh: async () => ({ ok: true }),
    }),
    gitCheckpointService:
      createUnsupportedHomeOnlyService<RootServices["gitCheckpointService"]>(
        "gitCheckpointService",
      ),
    systemService: createUnsupportedHomeOnlyService<RootServices["systemService"]>("systemService"),
    terminalService:
      createUnsupportedHomeOnlyService<RootServices["terminalService"]>("terminalService"),
    settingService,
    credentialService: createEmptyHomeOnlyService<RootServices["credentialService"]>({
      load: async () => null,
    }),
    broadcastService: createEmptyHomeOnlyService<RootServices["broadcastService"]>({
      send: async () => {},
    }),
    cfTaskService: homeOnlyCfTaskService,
    cfAgentService: createEmptyHomeOnlyService<RootServices["cfAgentService"]>({
      initialize: async (params: { workspacePath: string; workspaceIdentity?: string }) => ({
        available: false,
        workspaceKey: params.workspaceIdentity?.trim() || params.workspacePath,
        reason: "CodeFusion agent service is not available before workspace bridge is connected.",
      }),
      disposeAll: () => {},
    }),
    cfSessionService: createEmptyHomeOnlyService<RootServices["cfSessionService"]>({
      initializeWorkspace: async (params: {
        workspacePath: string;
        workspaceIdentity?: string;
      }) => ({
        available: false,
        workspaceKey: params.workspaceIdentity?.trim() || params.workspacePath,
        reason: "CodeFusion session service is not available before workspace bridge is connected.",
      }),
    }),
    conversationShareService: createUnsupportedHomeOnlyService<
      RootServices["conversationShareService"]
    >("conversationShareService"),
    promptAttachmentTransferService: createEmptyHomeOnlyService<
      RootServices["promptAttachmentTransferService"]
    >({
      stage: unsupported("promptAttachmentTransferService.stage"),
      adopt: async () => {},
      cancel: async () => {},
      cleanup: async () => {},
    }),
    botsService: createUnsupportedHomeOnlyService<RootServices["botsService"]>("botsService"),
    fileWatcherService: createEmptyHomeOnlyService<RootServices["fileWatcherService"]>({
      watch: async () => ({ dispose: () => {} }),
    }),
    oauthService: createEmptyHomeOnlyService<RootServices["oauthService"]>({
      getProviders: async () => [],
      getActiveProvider: async () => null,
      restoreCachedSession: async () => null,
      restoreCachedSessionState: async () => ({ status: "signed-out" }),
      restoreSession: async () => null,
      refreshToken: async () => {},
      logout: async () => {},
      logoutAll: async () => {},
      cancelPending: async () => {},
    }),
    providerSettingsService: createEmptyHomeOnlyService<RootServices["providerSettingsService"]>({
      getView: async () => ({ revision: 0, providers: [] }),
      refresh: async () => ({ revision: 0, providers: [] }),
      testModelConnectivity: async () => ({ results: [] }),
    }),
    modelSelectionService: createEmptyHomeOnlyService<RootServices["modelSelectionService"]>({
      getView: async () => ({ revision: 0, providers: [] }),
    }),
    sourceServerWorkspaceService: createUnsupportedHomeOnlyService<
      RootServices["sourceServerWorkspaceService"]
    >("sourceServerWorkspaceService"),
    usageStatsService:
      createUnsupportedHomeOnlyService<RootServices["usageStatsService"]>("usageStatsService"),
    codingPlanSubscriptionService: createUnsupportedHomeOnlyService<
      RootServices["codingPlanSubscriptionService"]
    >("codingPlanSubscriptionService"),
    clientConfigService: createEmptyHomeOnlyService<RootServices["clientConfigService"]>({
      getSnapshot: async () => ({
        pluginStoreOrder: null,
        zsrcUrl: null,
        uiPluginRecommendations: [],
      }),
    }),
    clientScenesService: createEmptyHomeOnlyService<RootServices["clientScenesService"]>({
      list: async () => ({ code: 0, msg: "", data: [] }),
    }),
    offPeakTaskService:
      createUnsupportedHomeOnlyService<RootServices["offPeakTaskService"]>("offPeakTaskService"),
    highspeedCardService:
      createUnsupportedHomeOnlyService<RootServices["highspeedCardService"]>(
        "highspeedCardService",
      ),
    skillsService: createEmptyHomeOnlyService<RootServices["skillsService"]>({
      list: async () => ({
        skills: [],
        capability: { userScopeAvailable: false, userScopeReason: "desktop_only" },
        diagnostics: [],
      }),
      buildPromptContext: async ({ prompt }: { prompt: string }) => ({
        prompt,
        activatedSkillNames: [],
      }),
    }),
    skillSyncService:
      createUnsupportedHomeOnlyService<RootServices["skillSyncService"]>("skillSyncService"),
    mcpSyncService:
      createUnsupportedHomeOnlyService<RootServices["mcpSyncService"]>("mcpSyncService"),
    pluginSyncService:
      createUnsupportedHomeOnlyService<RootServices["pluginSyncService"]>("pluginSyncService"),
    pluginsService: createEmptyHomeOnlyService<RootServices["pluginsService"]>({
      list: async () => [],
    }),
    pluginManagementService:
      createUnsupportedHomeOnlyService<RootServices["pluginManagementService"]>(
        "pluginManagementService",
      ),
    subagentsService: createEmptyHomeOnlyService<RootServices["subagentsService"]>({
      list: async () => ({ agents: [], capability: { supported: false } }),
    }),
    commandsService: createEmptyHomeOnlyService<RootServices["commandsService"]>({
      list: async () => ({
        commands: [],
        userCommands: [],
        pluginCommands: [],
        capability: { userScopeAvailable: false, userScopeReason: "desktop_only" },
      }),
      setCommandEnabled: async () => undefined,
    }),
    hooksService: createEmptyHomeOnlyService<RootServices["hooksService"]>({
      loadHooks: async () => ({ hooks: [], hooksEnabled: false }),
      saveHooks: async () => undefined,
    }),
    memoryService: createEmptyHomeOnlyService<RootServices["memoryService"]>({
      loadMemory: async () => ({ memory: null }),
      listProjectMemories: async () => [],
    }),
    repoWikiService:
      createUnsupportedHomeOnlyService<RootServices["repoWikiService"]>("repoWikiService"),
    outputStyleService: createEmptyHomeOnlyService<RootServices["outputStyleService"]>({
      listStyles: async () => ({ styles: [] }),
      getUserStylesDirectory: async () => ({ path: "" }),
    }),
    feedbackService:
      createUnsupportedHomeOnlyService<RootServices["feedbackService"]>("feedbackService"),
    settingsSyncService:
      createUnsupportedHomeOnlyService<RootServices["settingsSyncService"]>("settingsSyncService"),
  };
}

function resolveExternalRelayWsUrl(): string {
  return resolveWebRemoteControlRelayWsUrl({ endpointOrigin: window.location.origin });
}

function isZhLocale(): boolean {
  return /^zh\b/i.test(navigator.language);
}

function renderWebRemoteControlLoading(
  state: WebRemoteControlTerminalTransportState,
  device: WebRemoteControlConnectingDevice,
): void {
  document.title = "CodeFusion - Web Remote Control";
  root.render(
    <WebRemoteControlLoadingScreen
      state={state}
      locale={resolveWebRemoteControlScreenLocale(navigator.language)}
      device={device}
    />,
  );
}

async function bootstrapExternalRelayWebRemoteControl(
  connection: WebRemoteControlEntryConnection,
): Promise<void> {
  if (connection.signal.aborted) return;
  const { params: relayParams, getToken } = connection;
  seedStableWebRemoteControlClientId(relayParams.deviceSid);
  const connectingDevice: WebRemoteControlConnectingDevice = {
    name: relayParams.deviceName,
    platform: relayParams.deviceMid
      ? readKnownDevices(webRemoteControlStorage).get(relayParams.deviceMid)?.platform
      : undefined,
  };
  const deviceNavigation = {
    deviceName: relayParams.deviceName,
    devicePlatform: connectingDevice.platform,
    chooseOtherDevice: () => {
      if (!connection.signal.aborted) void remoteEntry.chooseOtherDevice();
    },
  };

  let bootstrapping = false;
  let ready = false;
  let terminated = false;
  let terminalTransportState: UiWebRemoteControlTerminalTransportState = "idle";
  let currentWorkspaceKey: string | undefined;
  let currentTaskId: string | undefined;
  let currentRecoveryId: string | undefined;
  let bridgeRecoveryRetryAttempt = 0;
  let bridgeRecoveryRetryTimer: ReturnType<typeof setTimeout> | undefined;
  let nextBridgeGeneration = 0;
  const checkVersionOnRecovery = window.location.pathname.replace(/\/+$/, "") === "/remote/v4";
  let disposeVersionNotice: (() => void) | undefined;
  const versionGuard = createWebRemoteControlVersionGuard({
    requestBootstrap: () => requestBootstrap(),
    onAccepted: (result) => {
      if (terminalTransportState === "paired") taskViewPublisher.seed(result.mobileTaskViewEpoch);
    },
    getUrl: () => window.location.href,
    isPageReady: () => ready,
    navigate: (url) => window.location.replace(url),
    onMismatch: (version) => {
      disposeVersionNotice = showWebRemoteControlVersionNotice(version, () =>
        versionGuard.confirm(),
      );
    },
  });
  const blockVersionMismatchShortcuts = (event: KeyboardEvent) => {
    if (versionGuard.isBlocked()) event.stopImmediatePropagation();
  };
  window.addEventListener("keydown", blockVersionMismatchShortcuts, true);
  const disposeVersionInputGuard = () =>
    window.removeEventListener("keydown", blockVersionMismatchShortcuts, true);
  let activeRelayProtocol:
    | ReturnType<typeof createAcknowledgedWebRemoteControlRelayProtocol>
    | undefined;
  let pendingRelayProtocol: typeof activeRelayProtocol;
  let pendingBridgeAbort: AbortController | undefined;
  let activeBridgeServiceRegistration:
    | WebRemoteControlWorkspaceBridgeServiceRegistration
    | undefined;
  let sendMobileDiagnosticPayload:
    | ((payload: WebRemoteControlAppPayload & { cf_type: "mobile-diagnostic" }) => void)
    | undefined;
  const workspaceListUpdateListeners = new Set<WebRemoteControlWorkspaceListUpdateListener>();

  const subscribeWorkspaceListUpdates = (listener: WebRemoteControlWorkspaceListUpdateListener) => {
    workspaceListUpdateListeners.add(listener);
    return () => {
      workspaceListUpdateListeners.delete(listener);
    };
  };

  const normalizeWorkspaceListResult = (
    result: WebRemoteControlWorkspaceListResult,
  ): WebRemoteControlWorkspaceListResult => ({
    ...result,
    activeWorkspaceKey: result.activeWorkspaceKey ?? currentWorkspaceKey,
    activeTaskId: result.activeTaskId ?? currentTaskId,
  });

  const applyWorkspaceListUpdated = (result: WebRemoteControlWorkspaceListResult) => {
    const normalized = normalizeWorkspaceListResult(result);
    for (const listener of workspaceListUpdateListeners) {
      listener(normalized);
    }
  };

  const sendMobileDiagnostic = (diagnostic: WebRemoteControlTerminalTransportDiagnostic) => {
    if (diagnostic.type === "socket-extensions") {
      return;
    }
    sendMobileDiagnosticPayload?.({
      cf_type: "mobile-diagnostic",
      event: diagnostic.type,
      timestamp: diagnostic.timestamp,
      state: diagnostic.state,
      previousState: "previousState" in diagnostic ? diagnostic.previousState : undefined,
      pairStatus: "pairStatus" in diagnostic ? diagnostic.pairStatus : undefined,
      closeCode: "code" in diagnostic ? diagnostic.code : undefined,
      closeReason: "reason" in diagnostic ? diagnostic.reason : undefined,
      wasClean: "wasClean" in diagnostic ? diagnostic.wasClean : undefined,
      wasPaired: "wasPaired" in diagnostic ? diagnostic.wasPaired : undefined,
      visibilityState: diagnostic.visibilityState,
      online: diagnostic.online,
      hiddenDurationMs: diagnostic.hiddenDurationMs,
    });
  };

  const sendMobileFailureDiagnostic = (failure: WebRemoteControlFailure) => {
    sendMobileDiagnosticPayload?.({
      cf_type: "mobile-diagnostic",
      event: "failure",
      timestamp: Date.now(),
      state: terminalTransportState,
      failureReason: failure.reason,
      failureMessage: failure.message,
      visibilityState: document.visibilityState,
      online: navigator.onLine,
    });
  };

  const mapBootstrapUnknownErrorToFailure = (error: unknown): WebRemoteControlFailure => {
    if (error && typeof error === "object" && "reason" in error) {
      return error as WebRemoteControlFailure;
    }
    if (
      error instanceof Error &&
      error.message === "Web remote control relay did not recover before timeout."
    ) {
      return toWebRemoteControlFailure(
        "desktop-disconnected",
        "Desktop did not recover the Web remote control session in time.",
      );
    }
    return toWebRemoteControlFailure(
      "unexpected-error",
      error instanceof Error ? error.message : String(error),
    );
  };

  const disposeConnection = () => {
    if (terminated) return;
    terminated = true;
    if (bridgeRecoveryRetryTimer) clearTimeout(bridgeRecoveryRetryTimer);
    bridgeRecoveryRetryTimer = undefined;
    versionGuard.dispose();
    disposeVersionInputGuard();
    disposeVersionNotice?.();
    activeBridgeServiceRegistration?.dispose();
    activeBridgeServiceRegistration = undefined;
    activeRelayProtocol?.dispose();
    activeRelayProtocol = undefined;
    pendingBridgeAbort?.abort();
    pendingBridgeAbort = undefined;
    pendingRelayProtocol?.dispose();
    pendingRelayProtocol = undefined;
    requester.dispose();
    transport.dispose();
    lifecycle.dispose();
    window.removeEventListener("beforeunload", disposeConnection);
    connection.signal.removeEventListener("abort", disposeConnection);
  };

  const renderBootstrapFailure = (failure: WebRemoteControlFailure) => {
    if (terminated || versionGuard.isBlocked()) return;
    sendMobileFailureDiagnostic(failure);
    disposeConnection();
    connection.onFailure(failure);
  };

  const renderBootstrapError = (error: unknown) => {
    renderBootstrapFailure(mapBootstrapUnknownErrorToFailure(error));
  };

  let bootstrapPairedSession:
    | ((options?: { preferredWorkspaceKey?: string; preferredTaskId?: string }) => Promise<void>)
    | undefined;

  const isLifecycleRecoveryReason = (reason: string): boolean =>
    reason === "visible" || reason === "pageshow" || reason === "online" || reason === "resume";

  const clearBridgeRecoveryRetry = (): void => {
    if (bridgeRecoveryRetryTimer) clearTimeout(bridgeRecoveryRetryTimer);
    bridgeRecoveryRetryTimer = undefined;
    bridgeRecoveryRetryAttempt = 0;
  };

  const scheduleBridgeRecoveryRetry = (): void => {
    if (bridgeRecoveryRetryTimer || terminated || isPageUnloading || versionGuard.isBlocked())
      return;
    const delay = getWebRemoteControlBridgeRecoveryRetryDelay(bridgeRecoveryRetryAttempt);
    if (delay === null) {
      renderBootstrapFailure(
        createWebRemoteControlConnectionRecoveryTimeoutFailure(
          "Mobile connection did not rebuild the workspace bridge within the retry budget.",
        ),
      );
      return;
    }
    bridgeRecoveryRetryAttempt += 1;
    bridgeRecoveryRetryTimer = setTimeout(() => {
      bridgeRecoveryRetryTimer = undefined;
      void recoverVisibleSession("bridge-rebuild-retry");
    }, delay);
  };

  const recoverVisibleSession = createWebRemoteControlBridgeRecoveryRunner(async (reason) => {
    if (isPageUnloading || terminated || versionGuard.isBlocked()) {
      return;
    }
    const preferredWorkspaceKey = currentWorkspaceKey;
    const preferredTaskId = currentTaskId;
    const isBridgeRebuildRetry = reason === "bridge-rebuild-retry";
    if (!isBridgeRebuildRetry) {
      bridgeRecoveryRetryAttempt = 0;
      currentRecoveryId = createWebRemoteControlRequestId("recovery");
    } else {
      currentRecoveryId ??= createWebRemoteControlRequestId("recovery");
    }
    const requiresBridgeRebuild =
      !isLifecycleRecoveryReason(reason) || activeRelayProtocol?.isDegraded() === true;
    if (requiresBridgeRebuild) {
      activeRelayProtocol?.markDegraded();
    }
    bootstrapping = true;
    let transportRecovered = false;
    try {
      if (!import.meta.env.PROD) {
        console.info("[web-remote-control] recover terminal session", {
          reason,
          recoveryId: currentRecoveryId,
          currentWorkspaceKey: preferredWorkspaceKey,
          currentTaskId: preferredTaskId,
        });
      }
      await transport.recoverConnection();
      transportRecovered = true;
      if (!requiresBridgeRebuild && activeRelayProtocol && !activeRelayProtocol.isDegraded()) {
        if (checkVersionOnRecovery) {
          try {
            await checkDesktopVersion();
          } catch (error) {
            if (!activeRelayProtocol.isDegraded()) throw error;
          }
        }
        if (!activeRelayProtocol.isDegraded()) {
          currentRecoveryId = undefined;
          return;
        }
      }
      await bootstrapPairedSession?.({
        preferredWorkspaceKey,
        preferredTaskId,
      });
      clearBridgeRecoveryRetry();
    } catch (error) {
      if (!import.meta.env.PROD) {
        console.warn(
          "[web-remote-control] terminal recover timed out, keeping current page for retry",
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!terminated && !isPageUnloading && transportRecovered && requiresBridgeRebuild) {
        scheduleBridgeRecoveryRetry();
      } else if (!terminated && !isPageUnloading) {
        transport.recoverInBackground();
      }
    } finally {
      bootstrapping = false;
    }
  });

  renderWebRemoteControlLoading("connecting", connectingDevice);

  const taskViewPublisher = createWebRemoteControlTaskViewPublisher(
    (payload) => !terminated && !versionGuard.isBlocked() && transport.sendPayload(payload),
  );
  const transport = new WebRemoteControlTerminalTransport({
    relayWsUrl: resolveExternalRelayWsUrl(),
    deviceSid: relayParams.deviceSid,
    deviceMid: relayParams.deviceMid,
    appVersion: relayParams.appVersion,
    getToken,
    onRawTransportPayload: (payload) =>
      pendingRelayProtocol?.acceptPayload(payload) ||
      activeRelayProtocol?.acceptPayload(payload) ||
      false,
    onRawTransportFault: (reasonCode) => {
      pendingRelayProtocol?.markDegraded(reasonCode);
      activeRelayProtocol?.markDegraded(reasonCode);
    },
    onPayload: (payload) => {
      if (terminated) {
        return;
      }
      if (payload.cf_type === "mobile-task-view-request") {
        taskViewPublisher.request(payload.epoch);
        return;
      }
      if (payload.cf_type === "rpc-frame" || payload.cf_type === "rpc-frame-ack") {
        if (!pendingRelayProtocol?.acceptPayload(payload))
          activeRelayProtocol?.acceptPayload(payload);
        return;
      }
      if (requester.acceptPayload(payload)) {
        return;
      }
      if (payload.cf_type === "workspace-list-updated") {
        applyWorkspaceListUpdated(payload.result);
        return;
      }
      if (payload.cf_type === "bridge-degraded") {
        if (
          pendingRelayProtocol &&
          payload.bridgeSessionId === pendingRelayProtocol.getBridgeSessionId()
        )
          pendingRelayProtocol.markDegraded(payload.reason);
        if (payload.bridgeSessionId === activeRelayProtocol?.getBridgeSessionId()) {
          activeRelayProtocol?.markDegraded();
          void recoverVisibleSession(payload.reason);
        }
        return;
      }
      if (payload.cf_type === "workspace-bridge-error") {
        if (
          pendingRelayProtocol &&
          payload.bridgeSessionId === pendingRelayProtocol.getBridgeSessionId()
        )
          pendingRelayProtocol.markDegraded(payload.reason);
        if (payload.bridgeSessionId === activeRelayProtocol?.getBridgeSessionId()) {
          activeBridgeServiceRegistration?.dispose();
          activeBridgeServiceRegistration = undefined;
          activeRelayProtocol?.markDegraded();
          void recoverVisibleSession(payload.reason);
        }
        return;
      }
      if (payload.cf_type === "app-error") {
        renderBootstrapFailure(toWebRemoteControlFailure(payload.reason, payload.error));
      }
    },
    onStateChange: (state) => {
      if (terminated || versionGuard.isBlocked()) {
        return;
      }
      taskViewPublisher.transportStateChanged(state, terminalTransportState);
      terminalTransportState = state;
      if (state !== "paired") versionGuard.invalidate();
      setWebRemoteControlTerminalTransportState(state);
      if (!ready) {
        renderWebRemoteControlLoading(state, connectingDevice);
      }
      if (state !== "paired") {
        return;
      }
      connection.onPaired();
      if (bootstrapping && pendingVersionCheck) return;
      if ((activeRelayProtocol && !activeRelayProtocol.isDegraded()) || bootstrapping) {
        if (!checkVersionOnRecovery) return;
        void checkDesktopVersion().catch((error) => {
          if (!terminated && !versionGuard.isBlocked()) {
            void recoverVisibleSession("visible");
            if (!import.meta.env.PROD)
              console.warn("[web-remote-control] version check failed", error);
          }
        });
        return;
      }
      if (!bootstrapPairedSession) {
        return;
      }
      bootstrapping = true;
      void bootstrapPairedSession()
        .catch((error) => {
          renderBootstrapError(error);
        })
        .finally(() => {
          bootstrapping = false;
        });
    },
    onFailure: (failure) => {
      renderBootstrapFailure(failure);
    },
    onError: (error) => {
      if (!import.meta.env.PROD) {
        console.warn("[web-remote-control] terminal transport error", error.message);
      }
    },
    onDiagnostic: (diagnostic) => {
      if (!import.meta.env.PROD) {
        console.info("[web-remote-control] terminal diagnostic", diagnostic);
      }
      sendMobileDiagnostic(diagnostic);
    },
    onSendReady: () => {
      if (versionGuard.isBlocked()) return;
      taskViewPublisher.flush();
      replayWebRemoteControlWorkspaceBridgeFrames({ activeRelayProtocol, pendingRelayProtocol });
    },
    reloadPage: () => {
      window.location.reload();
    },
  });
  sendMobileDiagnosticPayload = (payload) => transport.sendPayload(payload);
  const requester = createWebRemoteControlAppPayloadRequester({
    sendPayload: (payload) => !versionGuard.isBlocked() && transport.sendPayload(payload),
  });

  const requestAppPayload = requester.requestAppPayload;
  const requestWithRelayRecovery = createWebRemoteControlRelayRequestRecovery(() =>
    transport.recoverConnection(),
  );

  const requestBootstrap = async (): Promise<WebRemoteControlWindowBootstrapResult> => {
    const requestId = createWebRemoteControlRequestId("bootstrap");
    const response = await requestAppPayload(
      { cf_type: "bootstrap-request", requestId },
      (
        payload,
      ): payload is Extract<WebRemoteControlAppPayload, { cf_type: "bootstrap-response" }> =>
        payload.cf_type === "bootstrap-response" && payload.requestId === requestId,
    );
    return response.result;
  };

  let pendingVersionCheck: Promise<WebRemoteControlWindowBootstrapResult | undefined> | undefined;
  const checkDesktopVersion = (): Promise<WebRemoteControlWindowBootstrapResult | undefined> => {
    if (pendingVersionCheck) return pendingVersionCheck;
    const readCurrentVersion = async () => {
      let result = await versionGuard.check();
      while (
        !result &&
        !terminated &&
        !versionGuard.isBlocked() &&
        terminalTransportState === "paired"
      ) {
        result = await versionGuard.check();
      }
      return result;
    };
    const request = requestWithRelayRecovery(readCurrentVersion, { recoverTimeout: true }).finally(
      () => {
        if (pendingVersionCheck === request) pendingVersionCheck = undefined;
      },
    );
    pendingVersionCheck = request;
    return request;
  };

  const requestPlatformMethod = async <K extends WebRemoteControlPlatformMethod>(
    method: K,
    args?: WebRemoteControlPlatformMethodArgsMap[K],
  ): Promise<WebRemoteControlPlatformMethodResultMap[K]> => {
    const response = await requestWithRelayRecovery(() => {
      const requestId = createWebRemoteControlRequestId("platform");
      const request = {
        cf_type: "platform-request",
        requestId,
        method,
        args,
      } as WebRemoteControlPlatformRequestPayload;
      return requestAppPayload(
        request,
        (
          payload,
        ): payload is Extract<
          WebRemoteControlPlatformResponsePayload,
          { cf_type: "platform-response" }
        > =>
          payload.cf_type === "platform-response" &&
          payload.requestId === requestId &&
          payload.method === method,
      );
    });
    const platformResponse = response as WebRemoteControlPlatformResponsePayload;
    if (!platformResponse.success) {
      throw new Error(platformResponse.error);
    }
    return platformResponse.result as WebRemoteControlPlatformMethodResultMap[K];
  };
  const listWorkspaces = async (): Promise<WebRemoteControlWorkspaceListResult> => {
    const requestWorkspaceList = async () => {
      const requestId = createWebRemoteControlRequestId("workspace-list");
      return requestAppPayload(
        { cf_type: "workspace-list-request", requestId },
        (
          payload,
        ): payload is Extract<
          WebRemoteControlAppPayload,
          { cf_type: "workspace-list-response" }
        > => payload.cf_type === "workspace-list-response" && payload.requestId === requestId,
      );
    };
    const response = await requestWithRelayRecovery(() => requestWorkspaceList(), {
      recoverTimeout: true,
    });
    return normalizeWorkspaceListResult(response.result);
  };

  const updateMobileViewState = async (workspaceKey: string, taskId?: string): Promise<void> => {
    currentWorkspaceKey = workspaceKey;
    currentTaskId = taskId;
    transport.sendPayload({
      cf_type: "mobile-view-state-update",
      viewState: {
        activeWorkspaceKey: workspaceKey,
        ...(taskId ? { activeTaskId: taskId } : {}),
        updatedAt: Date.now(),
      },
      deviceInfo: collectWebRemoteControlMobileDeviceInfo({
        appVersion: relayParams.appVersion,
      }),
    });
  };

  const reconnectWorkspace = async (workspaceKey: string): Promise<void> => {
    const response = await requestWithRelayRecovery(() => {
      const requestId = createWebRemoteControlRequestId("workspace-reconnect");
      return requestAppPayload(
        {
          cf_type: "workspace-reconnect-request",
          requestId,
          workspaceKey,
        },
        (
          payload,
        ): payload is Extract<
          WebRemoteControlAppPayload,
          { cf_type: "workspace-reconnect-response" }
        > =>
          payload.cf_type === "workspace-reconnect-response" &&
          payload.requestId === requestId &&
          payload.workspaceKey === workspaceKey,
        {
          timeoutMs: WEB_REMOTE_CONTROL_WORKSPACE_RECONNECT_TIMEOUT_MS,
        },
      );
    });
    if (!response.success) {
      throw new Error(response.error);
    }
    if (workspaceKey === currentWorkspaceKey && activeRelayProtocol?.isDegraded()) {
      await recoverVisibleSession(
        "workspace-reconnected",
        () => workspaceKey === currentWorkspaceKey && activeRelayProtocol?.isDegraded() === true,
      );
    }
  };

  const openWorkspaceBridge = async (
    workspaceKey: string,
    options?: WebRemoteControlWorkspaceSwitchOptions & {
      project?: Extract<
        WebRemoteControlAppPayload,
        { cf_type: "workspace-bridge-open" }
      >["project"];
    },
  ): Promise<{
    bridge: WebRemoteControlExternalWorkspaceBridge;
    services: Awaited<ReturnType<typeof connectViaProtocol>>;
    relayProtocol: ReturnType<typeof createAcknowledgedWebRemoteControlRelayProtocol>;
  }> => {
    const bridgeSessionId = createWebRemoteControlRequestId("bridge");
    const bridgeGeneration = ++nextBridgeGeneration;
    pendingBridgeAbort?.abort();
    const bridgeAbort = new AbortController();
    pendingBridgeAbort = bridgeAbort;
    const isCurrent = () =>
      !terminated && !versionGuard.isBlocked() && bridgeGeneration === nextBridgeGeneration;
    const response = await requestWithRelayRecovery(() =>
      requestAppPayload(
        {
          cf_type: "workspace-bridge-open",
          requestId: createWebRemoteControlRequestId("workspace-bridge"),
          bridgeSessionId,
          bridgeGeneration,
          ...(currentRecoveryId ? { recoveryId: currentRecoveryId } : {}),
          workspaceKey,
          ...(options?.taskId ? { taskId: options.taskId } : {}),
          ...(options?.taskHostId ? { taskHostId: options.taskHostId } : {}),
          ...(options?.fileTreeTaskId ? { fileTreeTaskId: options.fileTreeTaskId } : {}),
          ...(options?.project ? { project: options.project } : {}),
        },
        (
          payload,
        ): payload is Extract<
          WebRemoteControlAppPayload,
          { cf_type: "workspace-bridge-ready" }
        > =>
          payload.cf_type === "workspace-bridge-ready" &&
          payload.bridgeSessionId === bridgeSessionId,
      ),
    );
    if (!isCurrent() || bridgeAbort.signal.aborted) {
      throw new Error("Web remote control version changed before the workspace bridge was ready.");
    }
    currentRecoveryId = undefined;
    const relayProtocol = createAcknowledgedWebRemoteControlRelayProtocol({
      bridgeSessionId: response.bridge.bridgeSessionId,
      bridgeGeneration: response.bridge.bridgeGeneration,
      recoveryId: response.bridge.recoveryId,
      measureFrameBytes: (frame) => transport.measurePayloadBytes(frame),
      sendFrame: (frame) => {
        if (versionGuard.isBlocked()) return false;
        const result = transport.sendPayloadResult(frame);
        if (result.kind === "oversize") {
          throw new Error("remote.rpcFrame.envelopeTooLarge");
        }
        return result.kind === "sent";
      },
    });
    relayProtocol.onDegraded((fault) => {
      if (activeRelayProtocol !== relayProtocol) return;
      if (!import.meta.env.PROD) {
        console.warn("[web-remote-control] raw relay bridge degraded", {
          bridgeSessionId: relayProtocol.getBridgeSessionId(),
          reasonCode: fault.reasonCode,
        });
      }
      void recoverVisibleSession(fault.reasonCode);
    });
    const services = await connectWebRemoteControlWorkspaceBridgeServices({
      relayProtocol,
      windowProjectDirectory:
        response.bridge.kind === "remote" &&
        response.bridge.capabilities?.windowProjectDirectory === true,
      activateTransport: () => {
        pendingRelayProtocol = relayProtocol;
        return () => {
          if (pendingRelayProtocol === relayProtocol) pendingRelayProtocol = undefined;
        };
      },
      isCurrent,
      signal: bridgeAbort.signal,
    });
    const bridgeServiceRegistration = registerWebRemoteControlWorkspaceBridgeServices({
      bridge: response.bridge,
      services,
    });
    void markOpenedWebRemoteControlBridgeTaskRead({
      bridge: response.bridge,
      expectedUnreadAt: options?.markTaskReadExpectedUnreadAt,
      services,
    });
    const previousRelayProtocol = activeRelayProtocol;
    const previousBridgeServiceRegistration = activeBridgeServiceRegistration;
    activeRelayProtocol = relayProtocol;
    taskViewPublisher.setBridge(response.bridge);
    if (pendingRelayProtocol === relayProtocol) pendingRelayProtocol = undefined;
    if (pendingBridgeAbort === bridgeAbort) pendingBridgeAbort = undefined;
    activeBridgeServiceRegistration = bridgeServiceRegistration;
    previousRelayProtocol?.dispose();
    previousBridgeServiceRegistration?.dispose();
    currentWorkspaceKey = response.bridge.workspaceKey;
    currentTaskId = response.bridge.initialTaskId;
    await updateMobileViewState(response.bridge.workspaceKey, response.bridge.initialTaskId);
    if (!isCurrent()) throw new Error("Workspace bridge request was superseded.");
    return { bridge: response.bridge, services, relayProtocol };
  };

  const renderExternalRelayRoot = (
    services: Awaited<ReturnType<typeof connectViaProtocol>>,
    bridge: WebRemoteControlExternalWorkspaceBridge,
    initialNavigationIntent?: WebRemoteControlMobileNavigationIntent,
    initialTaskDraft?: ComponentProps<typeof Root>["initialTaskDraft"],
    initialSidebarFileTreeOpen = false,
  ) => {
    if (terminated || versionGuard.isBlocked()) return;
    ready = true;
    document.title = "CodeFusion - Web Remote Control";
    root.render(
      <AppErrorBoundary key={bridge.bridgeSessionId}>
        <CfIntlProvider
          settingService={services.settingService}
          broadcastService={services.broadcastService}
          preferSettingServiceLocale
        >
          <Root
            services={services}
            platform={createWebPlatform({
              externalWebRemoteControlProxy: {
                requestPlatformMethod,
                reportTelemetryEvent: (event) => {
                  const parsed = sessionCreateTelemetrySchema
                    .or(mobilePluginDiscoveryTelemetrySchema)
                    .safeParse(event);
                  if (parsed.success)
                    transport.sendPayload({ cf_type: "telemetry-report", event: parsed.data });
                },
              },
            })}
            assistantCodeCommentCardsEnabled
            initialWorkspaceAbsPath={bridge.workspacePath}
            initialWorkspaceIdentity={
              bridge.kind === "remote" ? bridge.workspaceIdentity : undefined
            }
            initialTaskId={bridge.initialTaskId}
            initialTaskDraft={initialTaskDraft}
            composerClientNamespace={`mobile:${relayParams.deviceMid ?? relayParams.deviceSid}`}
            initialSidebarFileTreeOpen={initialSidebarFileTreeOpen}
            initialWebRemoteControlMobileNavigationIntent={initialNavigationIntent}
            webRemoteControlTerminalTransportState={terminalTransportState}
            initialWorkspaceLoadingFallback={
              <WebRemoteControlLoadingScreen
                state="paired"
                locale={resolveWebRemoteControlScreenLocale(navigator.language)}
                device={connectingDevice}
              />
            }
            restoreSession={false}
            allowOpenWorkspace={false}
            webRemoteControlWorkspaceSwitcher={{
              deviceNavigation,
              listWorkspaces,
              onWorkspaceListUpdated: subscribeWorkspaceListUpdates,
              openProjectDraft,
              switchWorkspace: async (workspaceKey, options) => {
                const initialNavigationIntent = options?.mobileNavigationIntent;
                const result = await openWorkspaceBridge(workspaceKey, options);
                renderExternalRelayRoot(
                  result.services,
                  result.bridge,
                  initialNavigationIntent,
                  undefined,
                  Boolean(options?.fileTreeTaskId || options?.openFileManager),
                );
              },
              markTaskRead: (task) =>
                markCurrentWebRemoteControlBridgeTaskRead({
                  bridge,
                  services,
                  task,
                }),
              startDraft: async (workspaceKey, options) => {
                const initialNavigationIntent = options?.mobileNavigationIntent;
                const result = await openWorkspaceBridge(workspaceKey, undefined);
                await updateMobileViewState(result.bridge.workspaceKey);
                renderExternalRelayRoot(result.services, result.bridge, initialNavigationIntent);
              },
              reconnectWorkspace,
              updateMobileViewState,
              updateMobileTaskView: async (view) => {
                taskViewPublisher.update(bridge, view);
              },
            }}
            preferDirectoryBrowser
            supportsEmbeddedBrowser={false}
            allowRemoteWorkspace={false}
          />
        </CfIntlProvider>
      </AppErrorBoundary>,
    );
  };

  const openProjectDraft = async (
    request: NonNullable<ComponentProps<typeof Root>["initialTaskDraft"]>,
  ) => {
    const projectId = request.projectId ?? null;
    const pendingDraft =
      !projectId && (!request.hostId || request.hostId === "local")
        ? ensurePendingTaskDraft({
            clientNamespace: `mobile:${relayParams.deviceMid ?? relayParams.deviceSid}`,
            hostId: "local",
            projectId: null,
          })
        : null;
    const result = await openWorkspaceBridge(currentWorkspaceKey ?? "project-navigation", {
      project: {
        projectId,
        ...(request.hostId ? { hostId: request.hostId } : {}),
        ...(pendingDraft
          ? { draftId: pendingDraft.draftId, reuseDraft: Boolean(pendingDraft.workspacePath) }
          : {}),
      },
    });
    renderExternalRelayRoot(result.services, result.bridge, "chat", {
      ...request,
      projectId,
      ...(pendingDraft ? { draftId: pendingDraft.draftId } : {}),
    });
  };

  const renderExternalRelayHomeOnlyRoot = async (
    workspaceKey: string,
    taskId?: string,
  ): Promise<void> => {
    if (terminated || versionGuard.isBlocked()) return;
    currentWorkspaceKey = workspaceKey;
    currentTaskId = taskId;
    await updateMobileViewState(workspaceKey, taskId);
    document.title = "CodeFusion - Web Remote Control";
    if (terminated || versionGuard.isBlocked()) return;
    ready = true;
    root.render(
      <AppErrorBoundary key={`home-only-${workspaceKey}`}>
        <CfIntlProvider>
          <Root
            composerClientNamespace={`mobile:${relayParams.deviceMid ?? relayParams.deviceSid}`}
            services={createHomeOnlyWebRemoteControlServices()}
            platform={createWebPlatform({
              externalWebRemoteControlProxy: {
                requestPlatformMethod,
                reportTelemetryEvent: (event) => {
                  const parsed = sessionCreateTelemetrySchema
                    .or(mobilePluginDiscoveryTelemetrySchema)
                    .safeParse(event);
                  if (parsed.success)
                    transport.sendPayload({ cf_type: "telemetry-report", event: parsed.data });
                },
              },
            })}
            initialWorkspaceAbsPath={workspaceKey}
            initialTaskId={taskId}
            initialWebRemoteControlMobileNavigationIntent={undefined}
            webRemoteControlTerminalTransportState={terminalTransportState}
            initialWorkspaceLoadingFallback={
              <WebRemoteControlLoadingScreen
                state="paired"
                locale={resolveWebRemoteControlScreenLocale(navigator.language)}
                device={connectingDevice}
              />
            }
            restoreSession={false}
            allowOpenWorkspace={false}
            webRemoteControlWorkspaceSwitcher={{
              deviceNavigation,
              listWorkspaces: async () => ({
                ...(await listWorkspaces()),
                activeWorkspaceKey: currentWorkspaceKey,
                activeTaskId: currentTaskId,
              }),
              onWorkspaceListUpdated: subscribeWorkspaceListUpdates,
              openProjectDraft,
              switchWorkspace: async (nextWorkspaceKey, options) => {
                const initialNavigationIntent = options?.mobileNavigationIntent;
                const result = await openWorkspaceBridge(nextWorkspaceKey, options);
                renderExternalRelayRoot(
                  result.services,
                  result.bridge,
                  initialNavigationIntent,
                  undefined,
                  Boolean(options?.fileTreeTaskId || options?.openFileManager),
                );
              },
              startDraft: async (nextWorkspaceKey, options) => {
                const initialNavigationIntent = options?.mobileNavigationIntent;
                const result = await openWorkspaceBridge(nextWorkspaceKey, undefined);
                await updateMobileViewState(result.bridge.workspaceKey);
                renderExternalRelayRoot(result.services, result.bridge, initialNavigationIntent);
              },
              reconnectWorkspace,
              updateMobileViewState,
            }}
            preferDirectoryBrowser
            supportsEmbeddedBrowser={false}
            allowRemoteWorkspace={false}
          />
        </CfIntlProvider>
      </AppErrorBoundary>,
    );
  };

  bootstrapPairedSession = async (options?: {
    preferredWorkspaceKey?: string;
    preferredTaskId?: string;
  }) => {
    const bootstrapResult = await checkDesktopVersion();
    if (!bootstrapResult || terminated || versionGuard.isBlocked()) return;
    const preferredWorkspace = options?.preferredWorkspaceKey
      ? bootstrapResult.workspaces.find(
          (workspace) =>
            resolveWebRemoteControlWorkspaceKey(workspace) === options.preferredWorkspaceKey,
        )
      : undefined;
    const selectedWorkspace = preferredWorkspace
      ? {
          workspaceKey: resolveWebRemoteControlWorkspaceKey(preferredWorkspace),
          taskId: options?.preferredTaskId,
          canBridge:
            preferredWorkspace.kind !== "remote" ||
            Boolean(preferredWorkspace.workspaceIdentity && preferredWorkspace.remoteSessionId),
        }
      : selectInitialWebRemoteControlWorkspace(bootstrapResult);
    if (!selectedWorkspace) {
      throw toWebRemoteControlFailure(
        "workspace-closed",
        "No opened desktop workspace is available for Web remote control.",
      );
    }
    if (!selectedWorkspace.canBridge) {
      if (activeRelayProtocol && selectedWorkspace.workspaceKey === currentWorkspaceKey) {
        activeBridgeServiceRegistration?.dispose();
        activeBridgeServiceRegistration = undefined;
        return;
      }
      await renderExternalRelayHomeOnlyRoot(
        selectedWorkspace.workspaceKey,
        selectedWorkspace.taskId,
      );
      return;
    }

    const result = await openWorkspaceBridge(selectedWorkspace.workspaceKey, {
      taskId: selectedWorkspace.taskId,
    });
    renderExternalRelayRoot(result.services, result.bridge);
  };

  const lifecycle = createWebRemoteControlLifecycleRecovery({
    documentTarget: document,
    windowTarget: window,
    onSuspend: () => {
      taskViewPublisher.suspend();
      transport.suspend();
    },
    onRecover: (reason) => {
      void recoverVisibleSession(reason);
    },
  });
  window.addEventListener("beforeunload", disposeConnection, { once: true });
  connection.signal.addEventListener("abort", disposeConnection, { once: true });
  transport.start();
}

async function bootstrapWebApp() {
  const params = new URLSearchParams(window.location.search);
  if (isWebRemoteControlRoute() || isWebRemoteControlOAuthCallback(new URL(window.location.href))) {
    document.documentElement.lang = resolveWebRemoteControlScreenLocale(navigator.language);
  }
  if (isWebOAuthCallback(params)) {
    renderWebAuthCallbackPage();
    return;
  }

  if (isConversationSharePath(window.location.pathname)) {
    await renderConversationSharePage();
    return;
  }

  if (isWebRemoteControlRoute()) {
    await remoteEntry.start();
    return;
  }

  let bootstrap: WebBootstrapResult;
  try {
    bootstrap = await resolveWebBootstrap();
  } catch (error) {
    renderWebRemoteControlFailure(
      error && typeof error === "object" && "reason" in error
        ? (error as WebRemoteControlFailure)
        : toWebRemoteControlFailure(
            "unexpected-error",
            error instanceof Error ? error.message : String(error),
          ),
    );
    return;
  }

  try {
    const services = await connectViaWebSocket(bootstrap.wsUrl, {
      onClose: () => {},
    });
    const platform = createWebPlatform();
    document.title = "CodeFusion - Web + Server";

    root.render(
      <AppErrorBoundary>
        <CfIntlProvider
          settingService={services.settingService}
          broadcastService={services.broadcastService}
        >
          <Root
            services={services}
            platform={platform}
            initialWorkspaceAbsPath={bootstrap.initialWorkspaceAbsPath}
            initialWorkspaceIdentity={bootstrap.initialWorkspaceIdentity}
            initialTaskId={bootstrap.initialTaskId}
            restoreSession={bootstrap.restoreSession}
            allowOpenWorkspace={bootstrap.allowOpenWorkspace}
            preferDirectoryBrowser
            supportsEmbeddedBrowser={false}
            allowRemoteWorkspace={false}
          />
        </CfIntlProvider>
      </AppErrorBoundary>,
    );
  } catch (error) {
    renderWebRemoteControlFailure(
      error && typeof error === "object" && "reason" in error
        ? (error as WebRemoteControlFailure)
        : toWebRemoteControlFailure(
            "unexpected-error",
            error instanceof Error ? error.message : String(error),
          ),
    );
  }
}

void bootstrapWebApp();
