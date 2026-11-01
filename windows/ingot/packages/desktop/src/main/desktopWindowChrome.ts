
import { app, BrowserWindow, Menu, nativeImage, nativeTheme, screen, shell } from "electron";
import { join } from "node:path";
import type {
  ContextMenuParams,
  Input,
  MenuItemConstructorOptions,
  WebContents,
  WindowOpenHandlerResponse,
} from "electron";
import type { DesktopTitleBarTheme, Locale } from "@origin-ai/cf-shared";
import {
  DEFAULT_LOCALE,
  desktopMenuMessageIds,
  getDesktopMenuMessage,
  isTrustedCodingPlanWebviewOrigin,
  isTrustedRewardsUrl,
  PlatformChannels,
} from "@origin-ai/cf-shared";
import { loadWindow, type WindowBootstrapOptions } from "./desktopHostProcess.js";
import {
  buildWindowsTitleBarOverlayForZoomLevel,
  hasCustomWindowsControls,
  registerCustomWindowsControls,
  MACOS_TRAFFIC_LIGHT_BASE_POSITION,
  syncWindowControlsOverlayForZoomLevel,
} from "./desktopWindowButtonPosition.js";
import {
  clampDesktopZoomLevel,
  resolveDesktopZoomFactorForLevel,
  resolveDesktopZoomLevelFromFactor,
} from "./desktopZoom.js";
import { resolveDesktopWindowChromeState } from "./desktopWindowChromeState.js";
import {
  MIN_DESKTOP_WINDOW_HEIGHT,
  MIN_DESKTOP_WINDOW_WIDTH,
  resolveDesktopWindowSize,
  type DesktopWindowSize,
} from "./desktopWindowSize.js";
import { getPluginSandboxHost, isPluginSandboxSrc } from "./pluginSandbox/index.js";
import { installEmbeddedBrowserBluetoothDeviceGuard } from "./embeddedBrowserBluetoothGuard.js";
import { getEmbeddedBrowserDevicePicker } from "./embeddedBrowserPermissionUiBridge.js";
const ALLOWED_EMBEDDED_BROWSER_PROTOCOLS = new Set([
  "about:",
  "data:",
  "http:",
  "https:",
  "cf-browser-restore:",
]);
const ALLOWED_EMBEDDED_BROWSER_NEW_WINDOW_PROTOCOLS = new Set(["http:", "https:"]);
const EXTERNAL_BROWSER_DISPOSITIONS = new Set(["background-tab"]);
const CODING_PLAN_ZAI_PAYPAL_RELAY_HOSTS = new Set(["api.z.ai", "api.z.ai"]);
const embeddedBrowserJavaScriptDialogPreloadPath = join(
  import.meta.dirname,
  "../preload/embeddedBrowserJavaScriptDialog.cjs",
);
const codingPlanWebviewPreloadPath = join(import.meta.dirname, "../preload/codingPlanWebview.cjs");

function isCodingPlanEmbeddedWebviewSrc(src: string | undefined): boolean {
  if (!src) return false;
  try {
    const url = new URL(src);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (
      !isTrustedCodingPlanWebviewOrigin(url.origin, {
        e2eStoreBridgeEnabled: process.env.VITE_CF_E2E_STORE_BRIDGE === "1",
      })
    ) {
      return false;
    }
    if (url.pathname !== "/coding-plan") return false;
    const embedded = url.searchParams.get("embedded");
    return embedded === "app";
  } catch {
    return false;
  }
}

function isCodingPlanWebviewUrl(src: string | undefined): boolean {
  if (!src) return false;
  try {
    const url = new URL(src);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (
      !isTrustedCodingPlanWebviewOrigin(url.origin, {
        e2eStoreBridgeEnabled: process.env.VITE_CF_E2E_STORE_BRIDGE === "1",
      })
    ) {
      return false;
    }
    if (!url.pathname.includes("coding-plan")) return false;
    return url.searchParams.get("embedded") === "app";
  } catch {
    return false;
  }
}

function isCodingPlanPaymentCallbackUrl(src: string | undefined): boolean {
  if (!src) return false;
  try {
    const url = new URL(src);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (
      !isTrustedCodingPlanWebviewOrigin(url.origin, {
        e2eStoreBridgeEnabled: process.env.VITE_CF_E2E_STORE_BRIDGE === "1",
      })
    ) {
      return false;
    }
    if (!url.pathname.endsWith("/coding-plan/payment/callback")) return false;
    const returnTo = url.searchParams.get("returnTo");
    if (!returnTo) return false;
    const target = new URL(returnTo, url.origin);
    return target.origin === url.origin && isCodingPlanWebviewUrl(target.toString());
  } catch {
    return false;
  }
}

function isLinuxDesktopWindow() {
  return process.platform === "linux";
}

function buildDesktopWindowVisualOptions() {
  if (process.platform === "darwin") {
    return {
      backgroundColor: "#00000000",
      titleBarStyle: "hidden" as const,
      trafficLightPosition: MACOS_TRAFFIC_LIGHT_BASE_POSITION,
      vibrancy: "under-window" as const,
      visualEffectState: "active" as const,
    };
  }

  if (process.platform === "win32") {
    return {
      backgroundColor: "#00000000",
      frame: false,
      backgroundMaterial: "acrylic" as const,
    };
  }

  return {
    backgroundColor: "#00000000",
    transparent: true,
    frame: false,
    hasShadow: false,
  };
}

export function applyAppIcon(iconPath: string) {
  if (process.platform !== "darwin" || app.dock == null) {
    return;
  }

  const dockIcon = nativeImage.createFromPath(iconPath);
  if (!dockIcon.isEmpty()) {
    app.dock.setIcon(dockIcon);
  }
}

function syncWindowFullscreenState(targetWindow: BrowserWindow) {
  if (targetWindow.isDestroyed()) {
    return;
  }

  targetWindow.webContents.send(
    PlatformChannels.WindowFullscreenChanged,
    targetWindow.isFullScreen(),
  );
}

function syncDesktopWindowChromeState(targetWindow: BrowserWindow) {
  if (targetWindow.isDestroyed()) return;

  targetWindow.webContents.send(
    PlatformChannels.DesktopWindowChromeStateChanged,
    resolveDesktopWindowChromeState(targetWindow.isMaximized()),
  );
}

export function getWindowOverlayTheme(): Exclude<DesktopTitleBarTheme, "system"> {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

export function applyWindowsTitleBarTheme(
  targetWindow: BrowserWindow,
  theme: DesktopTitleBarTheme,
) {
  if (
    process.platform !== "win32" ||
    targetWindow.isDestroyed() ||
    hasCustomWindowsControls(targetWindow)
  ) {
    return;
  }

  const resolvedTheme = theme === "system" ? getWindowOverlayTheme() : theme;
  const zoomLevel = resolveDesktopZoomLevelFromFactor(targetWindow.webContents.getZoomFactor());
  targetWindow.setTitleBarOverlay(
    buildWindowsTitleBarOverlayForZoomLevel(zoomLevel, resolvedTheme),
  );
}

function attachWindowsWindowRepaint(targetWindow: BrowserWindow) {
  if (process.platform !== "win32") {
    return;
  }

  let pendingRepaintTimer: ReturnType<typeof setTimeout> | null = null;
  const repaint = () => {
    if (targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) {
      return;
    }

    targetWindow.webContents.invalidate();
  };

  const scheduleRepaint = () => {
    repaint();
    if (pendingRepaintTimer !== null) {
      clearTimeout(pendingRepaintTimer);
    }
    pendingRepaintTimer = setTimeout(() => {
      pendingRepaintTimer = null;
      repaint();
    }, 32);
  };

  targetWindow.on("resized", () => {
    scheduleRepaint();
  });
  targetWindow.on("show", () => {
    scheduleRepaint();
  });
}

function isAllowedEmbeddedBrowserUrl(url: string): boolean {
  try {
    return ALLOWED_EMBEDDED_BROWSER_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

function isAllowedEmbeddedBrowserNewWindowUrl(url: string): boolean {
  try {
    return ALLOWED_EMBEDDED_BROWSER_NEW_WINDOW_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

function isPaypalHostname(hostname: string): boolean {
  return hostname === "paypal.com" || hostname.endsWith(".paypal.com");
}

function isCodingPlanPaypalNavigationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (isPaypalHostname(parsed.hostname)) return true;
    return (
      CODING_PLAN_ZAI_PAYPAL_RELAY_HOSTS.has(parsed.hostname) &&
      parsed.pathname.startsWith("/api/pay/paypal/")
    );
  } catch {
    return false;
  }
}

function isAllowedCodingPlanEmbeddedNavigationUrl(url: string): boolean {
  return (
    isCodingPlanWebviewUrl(url) ||
    isCodingPlanPaypalNavigationUrl(url) ||
    isCodingPlanPaymentCallbackUrl(url)
  );
}

function hasExternalBrowserModifier(input: Input): boolean {
  const modifiers = new Set(input.modifiers ?? []);
  return (
    input.meta === true ||
    input.control === true ||
    modifiers.has("meta") ||
    modifiers.has("command") ||
    modifiers.has("cmd") ||
    modifiers.has("control") ||
    modifiers.has("ctrl")
  );
}

function isExternalBrowserModifierKey(input: Input): boolean {
  const key = input.key.toLowerCase();
  const code = input.code.toLowerCase();
  return (
    key === "meta" ||
    key === "control" ||
    code === "metaleft" ||
    code === "metaright" ||
    code === "controlleft" ||
    code === "controlright"
  );
}

function shouldOpenEmbeddedBrowserRequestExternally(input: {
  disposition: string;
  externalBrowserModifierActive: boolean;
}): boolean {
  return (
    input.externalBrowserModifierActive || EXTERNAL_BROWSER_DISPOSITIONS.has(input.disposition)
  );
}

function attachEmbeddedBrowserWindowOpenHandler(options: {
  hostWebContents: WebContents;
  guestWebContents: WebContents;
  isCodingPlanGuest: boolean;
  isRewardsGuest: boolean;
  resolveBrowserViewOwner?: (webContentsId: number) =>
    | {
        workspaceKey: string;
        remoteSessionId?: string;
        sessionId: string;
        browserId: string;
        browserGeneration: number;
        tabId: string;
      }
    | undefined;
  logger: { warn: (...args: unknown[]) => void };
}) {
  let externalBrowserModifierActive = false;

  options.guestWebContents.on("before-input-event", (_event, input) => {
    if (input.type === "keyUp" && isExternalBrowserModifierKey(input)) {
      externalBrowserModifierActive = false;
      return;
    }

    externalBrowserModifierActive = hasExternalBrowserModifier(input);
  });

  options.guestWebContents.setWindowOpenHandler((details): WindowOpenHandlerResponse => {
    const { url, disposition } = details;
    if (!isAllowedEmbeddedBrowserNewWindowUrl(url)) {
      options.logger.warn(`[browser-pane] blocked unsupported webview popup url: ${url}`);
      return { action: "deny" };
    }

    const guestUrl =
      typeof options.guestWebContents.getURL === "function"
        ? options.guestWebContents.getURL()
        : "";
    const shouldRouteCodingPlanPopup =
      options.isCodingPlanGuest ||
      isCodingPlanWebviewUrl(guestUrl) ||
      isCodingPlanPaypalNavigationUrl(guestUrl);
    if (shouldRouteCodingPlanPopup) {
      if (isAllowedCodingPlanEmbeddedNavigationUrl(url)) {
        void options.guestWebContents.loadURL(url).catch((error: unknown) => {
          options.logger.warn(
            "[browser-pane] failed to load coding-plan embedded popup in webview",
            {
              error: error instanceof Error ? error.message : String(error),
              url,
            },
          );
        });
        return { action: "deny" };
      }
      void shell.openExternal(url).catch((error: unknown) => {
        options.logger.warn("[browser-pane] failed to open coding-plan popup externally", {
          error: error instanceof Error ? error.message : String(error),
          url,
        });
      });
      return { action: "deny" };
    }

    if (
      shouldOpenEmbeddedBrowserRequestExternally({
        disposition,
        externalBrowserModifierActive,
      })
    ) {
      void shell.openExternal(url).catch((error: unknown) => {
        options.logger.warn("[browser-pane] failed to open webview popup externally", {
          error: error instanceof Error ? error.message : String(error),
          url,
        });
      });
      return { action: "deny" };
    }

    const owner = options.resolveBrowserViewOwner?.(options.guestWebContents.id);
    options.hostWebContents.send(PlatformChannels.OpenBrowserUrl, {
      disposition,
      url,
      ...(owner
        ? {
            workspaceKey: owner.workspaceKey,
            ...(owner.remoteSessionId ? { remoteSessionId: owner.remoteSessionId } : {}),
            sessionId: owner.sessionId,
            browserId: owner.browserId,
            browserGeneration: owner.browserGeneration,
            sourceTabId: owner.tabId,
          }
        : {}),
    });
    return { action: "deny" };
  });

  options.guestWebContents.on("will-navigate", (event, url) => {
    if (options.isRewardsGuest) {
      if (
        isTrustedRewardsUrl(url, {
          dev: !app.isPackaged,
          e2e: process.env.VITE_CF_E2E_STORE_BRIDGE === "1",
        })
      )
        return;
      event.preventDefault();
      if (isAllowedEmbeddedBrowserNewWindowUrl(url))
        void shell
          .openExternal(url)
          .catch(() => options.logger.warn("[rewards] external navigation failed"));
      return;
    }
    const guestUrl =
      typeof options.guestWebContents.getURL === "function"
        ? options.guestWebContents.getURL()
        : "";
    const shouldGuardCodingPlanNavigation =
      options.isCodingPlanGuest ||
      isCodingPlanWebviewUrl(guestUrl) ||
      isCodingPlanPaypalNavigationUrl(guestUrl);
    if (!shouldGuardCodingPlanNavigation || isCodingPlanWebviewUrl(url)) {
      return;
    }
    if (!isAllowedEmbeddedBrowserNewWindowUrl(url)) {
      options.logger.warn(`[browser-pane] blocked unsupported coding-plan navigation url: ${url}`);
      event.preventDefault();
      return;
    }
    if (isAllowedCodingPlanEmbeddedNavigationUrl(url)) {
      return;
    }

    event.preventDefault();
    void shell.openExternal(url).catch((error: unknown) => {
      options.logger.warn("[browser-pane] failed to open coding-plan navigation externally", {
        error: error instanceof Error ? error.message : String(error),
        url,
      });
    });
  });
}

function buildTextContextMenuTemplate(
  params: ContextMenuParams,
  locale: Locale,
): MenuItemConstructorOptions[] {
  if (params.isEditable) {
    const getLabel = (id: (typeof desktopMenuMessageIds)[keyof typeof desktopMenuMessageIds]) =>
      getDesktopMenuMessage(locale, id);

    return [
      {
        label: getLabel(desktopMenuMessageIds.editUndo),
        role: "undo",
        enabled: params.editFlags.canUndo,
      },
      {
        label: getLabel(desktopMenuMessageIds.editRedo),
        role: "redo",
        enabled: params.editFlags.canRedo,
      },
      { type: "separator" },
      {
        label: getLabel(desktopMenuMessageIds.editCut),
        role: "cut",
        enabled: params.editFlags.canCut,
      },
      {
        label: getLabel(desktopMenuMessageIds.editCopy),
        role: "copy",
        enabled: params.editFlags.canCopy,
      },
      {
        label: getLabel(desktopMenuMessageIds.editPaste),
        role: "paste",
        enabled: params.editFlags.canPaste,
      },
      {
        label: getLabel(desktopMenuMessageIds.editDelete),
        role: "delete",
        enabled: params.editFlags.canDelete,
      },
      { type: "separator" },
      {
        label: getLabel(desktopMenuMessageIds.editSelectAll),
        role: "selectAll",
        enabled: params.editFlags.canSelectAll,
      },
    ];
  }

  if (params.selectionText.trim().length > 0) {
    return [{ role: "copy", enabled: params.editFlags.canCopy }];
  }

  return [];
}

export function createBrowserWindow(options: {
  iconPath: string;
  preloadPath: string;
  title?: string;
  bootstrap?: WindowBootstrapOptions;
  logger: { warn: (...args: unknown[]) => void };
  
  deviceMid?: string;
  
  initialDesktopZoomLevel?: number;
  
  initialWindowSize?: DesktopWindowSize;
  
  currentApplicationLocale?: () => Locale;
  resolveBrowserViewOwner?: (webContentsId: number) =>
    | {
        workspaceKey: string;
        remoteSessionId?: string;
        sessionId: string;
        browserId: string;
        browserGeneration: number;
        tabId: string;
      }
    | undefined;
}): BrowserWindow {
  const initialDesktopZoomLevel = clampDesktopZoomLevel(options.initialDesktopZoomLevel ?? 0);
  const initialDesktopZoomFactor = resolveDesktopZoomFactorForLevel(initialDesktopZoomLevel);
  const initialWindowSize = resolveDesktopWindowSize(
    options.initialWindowSize,
    screen.getPrimaryDisplay().workAreaSize,
  );
  const win = new BrowserWindow({
    width: initialWindowSize.width,
    height: initialWindowSize.height,
    minWidth: MIN_DESKTOP_WINDOW_WIDTH,
    minHeight: MIN_DESKTOP_WINDOW_HEIGHT,
    title: options.title,
    icon: options.iconPath,
    autoHideMenuBar: isLinuxDesktopWindow(),
    ...buildDesktopWindowVisualOptions(),
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      zoomFactor: initialDesktopZoomFactor,
      additionalArguments: [`--device-id=${options.deviceMid ?? ""}`],
    },
  });

  win.webContents.setZoomFactor(initialDesktopZoomFactor);
  if (process.platform === "win32") registerCustomWindowsControls(win);
  syncWindowControlsOverlayForZoomLevel(win, initialDesktopZoomLevel);

  if (initialWindowSize.maximized) {
    win.maximize();
  }

  win.on("enter-full-screen", () => {
    syncWindowFullscreenState(win);
  });
  win.on("leave-full-screen", () => {
    syncWindowFullscreenState(win);
  });
  win.on("maximize", () => syncDesktopWindowChromeState(win));
  win.on("unmaximize", () => syncDesktopWindowChromeState(win));
  attachWindowsWindowRepaint(win);
  const pendingWebviewGuestKinds: Array<
    | { kind: "browser" | "codingPlan"; isRewards: boolean }
    | { kind: "pluginSandbox"; sandboxId: string }
  > = [];

  win.webContents.once("did-finish-load", () => {
    win.webContents.setZoomFactor(initialDesktopZoomFactor);
    syncWindowControlsOverlayForZoomLevel(win, initialDesktopZoomLevel);
    syncWindowFullscreenState(win);
  });
  win.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      options.logger.warn("[desktop-window] renderer did-fail-load", {
        errorCode,
        errorDescription,
        validatedURL,
        webContentsId: win.webContents.id,
      });
    },
  );

  win.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    //
    const targetUrl = params.src ?? "about:blank";
    if (isPluginSandboxSrc(targetUrl)) {
      const host = getPluginSandboxHost();
      const decision = host?.configureGuest({
        webPreferences,
        params,
        ownerWebContentsId: win.webContents.id,
      });
      if (!decision?.ok) {
        options.logger.warn(
          `[plugin-sandbox] blocked webview attach: ${decision ? decision.reason : "host-not-installed"}`,
        );
        event.preventDefault();
        return;
      }
      pendingWebviewGuestKinds.push({ kind: "pluginSandbox", sandboxId: decision.sandboxId });
      return;
    }
    const isCodingPlanWebview = isCodingPlanEmbeddedWebviewSrc(targetUrl);
    webPreferences.preload = isCodingPlanWebview
      ? codingPlanWebviewPreloadPath
      : embeddedBrowserJavaScriptDialogPreloadPath;
    const isRewardsWebview = isTrustedRewardsUrl(targetUrl, {
      dev: !app.isPackaged,
      e2e: process.env.VITE_CF_E2E_STORE_BRIDGE === "1",
    });
    if (isRewardsWebview) {
      webPreferences.preload = join(import.meta.dirname, "../preload/rewardsWebview.cjs");
      if (!app.isPackaged)
        webPreferences.additionalArguments = [
          ...(webPreferences.additionalArguments ?? []),
          "--cf-rewards-dev",
        ];
    }
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = true;
    webPreferences.sandbox = true;

    delete params.preload;
    delete params.nodeintegration;
    params.nodeintegrationinsubframes = "true";
    delete params.disablewebsecurity;
    delete params.allowpopups;

    params.allowpopups = "true";

    if (!isAllowedEmbeddedBrowserUrl(targetUrl)) {
      options.logger.warn(`[browser-pane] blocked unsupported webview url: ${targetUrl}`);
      event.preventDefault();
      return;
    }

    pendingWebviewGuestKinds.push({
      kind: isCodingPlanWebview ? "codingPlan" : "browser",
      isRewards: isRewardsWebview,
    });
  });

  win.webContents.on("did-attach-webview", (_event, guestWebContents) => {
    const guestKind = pendingWebviewGuestKinds.shift() ?? {
      kind: "browser" as const,
      isRewards: false,
    };
    if (guestKind.kind === "pluginSandbox") {
      getPluginSandboxHost()?.attachGuest({
        guest: guestWebContents,
        hostWebContents: win.webContents,
        sandboxId: guestKind.sandboxId,
      });
      return;
    }
    attachEmbeddedBrowserWindowOpenHandler({
      guestWebContents,
      hostWebContents: win.webContents,
      resolveBrowserViewOwner: options.resolveBrowserViewOwner,
      isCodingPlanGuest: guestKind.kind === "codingPlan",
      isRewardsGuest: guestKind.isRewards,
      logger: options.logger,
    });
    if (guestKind.kind === "browser") {
      installEmbeddedBrowserBluetoothDeviceGuard(guestWebContents, options.logger.warn, {
        devicePicker: getEmbeddedBrowserDevicePicker(),
        hostWebContentsId: win.webContents.id,
      });
    }
  });

  win.webContents.on("context-menu", (_event, params) => {
    const template = buildTextContextMenuTemplate(
      params,
      options.currentApplicationLocale?.() ?? DEFAULT_LOCALE,
    );

    if (!app.isPackaged) {
      if (template.length > 0) {
        template.push({ type: "separator" });
      }
      template.push({
        label: "Inspect Element",
        click: () => {
          win.webContents.inspectElement(params.x, params.y);
        },
      });
    }

    if (template.length === 0) {
      return;
    }

    Menu.buildFromTemplate(template).popup({ window: win });
  });

  void Promise.resolve(loadWindow(win, "index", options.bootstrap)).catch((error: unknown) => {
    options.logger.warn("[desktop-window] renderer navigation rejected", error);
  });
  return win;
}
