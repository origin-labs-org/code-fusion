
import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { app, BrowserWindow, dialog } from "electron";
import type { WebContents } from "electron";
import {
  type Locale,
  type OAuthProviderId,
  type OAuthStateRegistration,
  PlatformChannels,
} from "@origin-ai/cf-shared";
import {
  extractWorkspaceOpenPath,
  extractShareImportCode,
  isOAuthCallbackUrl,
  isPaymentCallbackUrl,
  isWorkspaceOpenUrl,
  isShareImportUrl,
} from "./desktopDeepLinkUrl.js";
import { registerLinuxDeepLinkProtocol } from "./desktopLinuxDeepLinkRegistration.js";

interface DeepLinkWorkspaceGateOptions {
  canOpenWorkspace?: (workspacePath: string) => boolean;
  confirmationCopy?: ExternalWorkspaceOpenDialogCopy;
  onWorkspaceOpenBlocked?: (workspacePath: string) => void;
  
  resolveApplicationWindow?: () => BrowserWindow | null;
}

export interface ExternalWorkspaceOpenDialogCopy {
  buttons: [string, string];
  title: string;
  message: string;
  detail: (path: string) => string;
}

interface OAuthRouteTarget {
  windowId: number;
  provider?: OAuthProviderId;
}

const oauthStateToWindow = new Map<string, OAuthRouteTarget>();
const rendererReadyWebContentsIds = new Set<number>();
let pendingDeepLinkUrl: string | null = null;
let pendingPaymentDeepLinkUrl: string | null = null;
let pendingOpenWorkspaceRequest: {
  path: string;
  targetWebContentsId?: number;
} | null = null;
const pendingShareImports: { shareCode: string; targetWebContentsId?: number }[] = [];
const MAX_PENDING_SHARE_IMPORTS = 8;

function enqueuePendingShareImport(
  payload: { shareCode: string },
  targetWebContentsId?: number,
): void {
  if (
    pendingShareImports.some(
      (item) =>
        item.shareCode === payload.shareCode && item.targetWebContentsId === targetWebContentsId,
    )
  ) {
    return;
  }
  pendingShareImports.push(
    targetWebContentsId === undefined ? { ...payload } : { ...payload, targetWebContentsId },
  );
  if (pendingShareImports.length > MAX_PENDING_SHARE_IMPORTS) {
    pendingShareImports.shift();
  }
}

export function parseOAuthStateRegistration(payload: unknown): OAuthStateRegistration | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as {
    state?: unknown;
    provider?: unknown;
  };

  if (typeof candidate.state !== "string" || candidate.state.trim() === "") {
    return null;
  }

  if (candidate.provider != null && typeof candidate.provider !== "string") {
    return null;
  }

  return {
    state: candidate.state.trim(),
    ...(typeof candidate.provider === "string" ? { provider: candidate.provider } : {}),
  };
}

function focusDeepLinkTargetWindow(targetWindow: BrowserWindow): void {
  if (targetWindow.isMinimized()) {
    targetWindow.restore();
  }

  if (!targetWindow.isVisible()) {
    targetWindow.show();
  }

  if (process.platform === "darwin") {
    app.show();
  }

  targetWindow.focus();
}

function hasOAuthAuthorizationCode(parsedUrl: URL): boolean {
  return parsedUrl.searchParams.has("code") || parsedUrl.searchParams.has("authCode");
}

export function isValidLocalWorkspaceDirectory(path: string): boolean {
  if (!path || path.includes("\0") || isNetworkWorkspacePath(path) || !isAbsolute(path)) {
    return false;
  }

  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function isNetworkWorkspacePath(path: string): boolean {
  const normalized = path.replace(/\//gu, "\\");
  return normalized.startsWith("\\\\") || /^\\\\\?\\UNC\\/iu.test(normalized);
}

export function resolveExternalWorkspaceOpenDialogCopy(
  locale: Locale,
): ExternalWorkspaceOpenDialogCopy {
  if (locale === "zh-CN") {
    return {
      buttons: ["打开文件夹", "取消"],
      title: "打开外部 CodeFusion 链接？",
      message: "是否在 CodeFusion 中打开此文件夹？",
      detail: (path) => `${path}\n\n只打开你TrustSource的Folder。ProjectSettings可能影响 agent runtime。`,
    };
  }

  return {
    buttons: ["Open folder", "Cancel"],
    title: "Open external CodeFusion link?",
    message: "Open this folder in CodeFusion?",
    detail: (path) =>
      `${path}\n\nOnly open folders from sources you trust. Project settings may affect the agent runtime.`,
  };
}

export function confirmExternalWorkspaceOpen(
  path: string,
  logger: { warn: (...args: unknown[]) => void },
  parentWindow: BrowserWindow | null,
  copy: ExternalWorkspaceOpenDialogCopy = resolveExternalWorkspaceOpenDialogCopy("en-US"),
): boolean {
  const options = {
    type: "warning" as const,
    buttons: copy.buttons,
    defaultId: 1,
    cancelId: 1,
    title: copy.title,
    message: copy.message,
    detail: copy.detail(path),
    noLink: true,
  };
  const response = parentWindow
    ? dialog.showMessageBoxSync(parentWindow, options)
    : dialog.showMessageBoxSync(options);
  const confirmed = response === 0;
  if (!confirmed) {
    logger.warn("[deep-link] 用户取消打开外部链接工作区", { path });
  }
  return confirmed;
}

export function handleOpenWorkspacePath(
  path: string,
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void },
  options: {
    allowWithoutReadyWindow?: boolean;
    resolveApplicationWindow?: () => BrowserWindow | null;
  } = {},
): boolean {
  if (!isValidLocalWorkspaceDirectory(path)) {
    logger.warn("[deep-link] Invalid workspace path to open, ignored", { path });
    return false;
  }

  const targetWindow = options.resolveApplicationWindow
    ? options.resolveApplicationWindow()
    : (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null);
  if (targetWindow) {
    const targetWebContentsId = targetWindow.webContents.id;
    if (!rendererReadyWebContentsIds.has(targetWebContentsId)) {
      pendingOpenWorkspaceRequest = {
        path,
        targetWebContentsId,
      };
      focusDeepLinkTargetWindow(targetWindow);
      logger.warn("[deep-link] Workspace open request hit unready window; caching and waiting for renderer ready", {
        windowId: targetWebContentsId,
        path,
      });
      return true;
    }

    targetWindow.webContents.send(PlatformChannels.OpenWorkspacePath, path);
    focusDeepLinkTargetWindow(targetWindow);
    logger.info("[deep-link] 工作区打开请求路由成功", {
      windowId: targetWebContentsId,
      path,
    });
    return true;
  }

  if (!options.allowWithoutReadyWindow) {
    logger.warn("[deep-link] Workspace open request did not match any window, ignored", { path });
    return false;
  }

  pendingOpenWorkspaceRequest = { path };
  logger.warn("[deep-link] Workspace open request did not match any window yet; caching and waiting for renderer ready", { path });
  return false;
}

export function handleDeepLink(
  url: string,
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void },
  options: DeepLinkWorkspaceGateOptions = {},
): boolean {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    logger.warn("[deep-link] 无法解析 URL:", url);
    return false;
  }

  if (isWorkspaceOpenUrl(parsedUrl)) {
    const workspacePath = extractWorkspaceOpenPath(parsedUrl);
    if (!workspacePath) {
      logger.warn("[deep-link] Workspace open request missing path, ignored", {
        host: parsedUrl.hostname,
        path: parsedUrl.pathname,
      });
      return false;
    }

    if (isNetworkWorkspacePath(workspacePath)) {
      logger.warn("[deep-link] 网络工作区路径Rejected", { path: workspacePath });
      return false;
    }

    if (options.canOpenWorkspace && !options.canOpenWorkspace(workspacePath)) {
      logger.warn("[deep-link] Workspace open request blocked by current startup gate", { path: workspacePath });
      options.onWorkspaceOpenBlocked?.(workspacePath);
      return true;
    }

    const targetWindow = options.resolveApplicationWindow
      ? options.resolveApplicationWindow()
      : (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null);
    if (
      !confirmExternalWorkspaceOpen(workspacePath, logger, targetWindow, options.confirmationCopy)
    ) {
      return true;
    }

    return handleOpenWorkspacePath(workspacePath, logger, {
      allowWithoutReadyWindow: true,
      resolveApplicationWindow: options.resolveApplicationWindow,
    });
  }

  if (isPaymentCallbackUrl(parsedUrl)) {
    const targetWindow = options.resolveApplicationWindow
      ? options.resolveApplicationWindow()
      : (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null);
    if (targetWindow) {
      targetWindow.webContents.send(PlatformChannels.PaymentCallback, url);
      focusDeepLinkTargetWindow(targetWindow);
      logger.info("[deep-link] 支付回调路由成功", {
        windowId: targetWindow.webContents.id,
        host: parsedUrl.hostname,
        path: parsedUrl.pathname,
      });
      return true;
    }

    pendingPaymentDeepLinkUrl = url;
    logger.warn("[deep-link] Payment callback did not match any window yet; caching and waiting for renderer ready", {
      host: parsedUrl.hostname,
      path: parsedUrl.pathname,
    });
    return false;
  }

  if (isShareImportUrl(parsedUrl)) {
    const shareCode = extractShareImportCode(parsedUrl);
    if (!shareCode) {
      logger.warn("[deep-link] Invalid share import code, ignored", {
        host: parsedUrl.hostname,
        path: parsedUrl.pathname,
      });
      return false;
    }
    const payload = { shareCode };
    const targetWindow = options.resolveApplicationWindow
      ? options.resolveApplicationWindow()
      : (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null);
    if (targetWindow) {
      if (!rendererReadyWebContentsIds.has(targetWindow.webContents.id)) {
        enqueuePendingShareImport(payload, targetWindow.webContents.id);
        focusDeepLinkTargetWindow(targetWindow);
        logger.info("[deep-link] share import waiting for renderer ready", {
          windowId: targetWindow.webContents.id,
        });
        return true;
      }
      targetWindow.webContents.send(PlatformChannels.ShareImport, payload);
      focusDeepLinkTargetWindow(targetWindow);
      logger.info("[deep-link] share import routed successfully", {
        windowId: targetWindow.webContents.id,
      });
      return true;
    }
    enqueuePendingShareImport(payload);
    logger.info("[deep-link] share import waiting for main window");
    return false;
  }

  if (!isOAuthCallbackUrl(parsedUrl)) {
    return false;
  }

  const state = parsedUrl.searchParams.get("state");
  if (!state) {
    logger.warn("[deep-link] OAuth callback missing state, callback ignored", {
      protocol: parsedUrl.protocol,
      host: parsedUrl.hostname,
      path: parsedUrl.pathname,
    });
    return false;
  }

  const routeTarget = oauthStateToWindow.get(state);
  const targetWindow = routeTarget
    ? BrowserWindow.getAllWindows().find((window) => window.webContents.id === routeTarget.windowId)
    : null;
  const shouldCompleteOAuthRoute = hasOAuthAuthorizationCode(parsedUrl);

  if (targetWindow) {
    targetWindow.webContents.send(PlatformChannels.OAuthCallback, url);
    if (shouldCompleteOAuthRoute) {
      oauthStateToWindow.delete(state);
    }
    focusDeepLinkTargetWindow(targetWindow);
    logger.info("[deep-link] OAuth 回调路由成功", {
      state,
      windowId: targetWindow.webContents.id,
      provider: routeTarget?.provider,
      completed: shouldCompleteOAuthRoute,
    });
    return true;
  }

  pendingDeepLinkUrl = url;
  logger.warn("[deep-link] OAuth callback did not hit target window; caching and waiting for renderer ready", {
    state,
    hasRouteTarget: Boolean(routeTarget),
  });
  return false;
}

export function registerDeepLinkProtocol(
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  },
  options: { iconPath?: string } = {},
) {
  const scheme = "cf";

  if (process.defaultApp && process.argv.length >= 2) {
    const entry = resolve(process.argv[1]!);
    const args = process.platform === "win32" ? [entry, "--"] : [entry];
    const ok = app.setAsDefaultProtocolClient(scheme, process.execPath, args);
    if (!ok) {
      logger.warn("[deep-link] 注册协议失败（defaultApp）", {
        scheme,
        execPath: process.execPath,
        entry: process.argv[1],
      });
    } else {
      logger.info("[deep-link] Protocol registered successfully (defaultApp)", {
        scheme,
        execPath: process.execPath,
        entry: process.argv[1],
      });
    }
    return;
  }

  const ok =
    process.platform === "win32"
      ? app.setAsDefaultProtocolClient(scheme, process.execPath, ["--"])
      : app.setAsDefaultProtocolClient(scheme);
  if (!ok) {
    logger.warn("[deep-link] 注册协议失败", { scheme });
  } else {
    logger.info("[deep-link] Protocol registered successfully", { scheme });
  }

  if (process.platform === "linux" && app.isPackaged) {
    registerLinuxDeepLinkProtocol({
      executablePath: process.execPath,
      homeDir: app.getPath("home"),
      productName: app.name,
      iconSourcePath: options.iconPath,
      env: process.env,
      argv: process.argv,
      logger,
    });
  }
}

export function registerOAuthState(windowId: number, registration: OAuthStateRegistration): void {
  oauthStateToWindow.set(registration.state, {
    windowId,
    provider: registration.provider,
  });

  setTimeout(() => oauthStateToWindow.delete(registration.state), 5 * 60 * 1000);
}

export function deliverPendingDeepLink(webContents: WebContents): boolean {
  rendererReadyWebContentsIds.add(webContents.id);

  const hasPendingOAuthCallback = pendingDeepLinkUrl != null;
  const undeliveredShareImports: typeof pendingShareImports = [];
  for (const pending of pendingShareImports.splice(0)) {
    if (pending.targetWebContentsId == null || pending.targetWebContentsId === webContents.id) {
      webContents.send(PlatformChannels.ShareImport, { shareCode: pending.shareCode });
    } else {
      undeliveredShareImports.push(pending);
    }
  }
  pendingShareImports.push(...undeliveredShareImports);
  if (hasPendingOAuthCallback) {
    webContents.send(PlatformChannels.OAuthCallback, pendingDeepLinkUrl);
    pendingDeepLinkUrl = null;
  }
  if (pendingPaymentDeepLinkUrl) {
    webContents.send(PlatformChannels.PaymentCallback, pendingPaymentDeepLinkUrl);
    pendingPaymentDeepLinkUrl = null;
  }
  if (
    pendingOpenWorkspaceRequest &&
    (pendingOpenWorkspaceRequest.targetWebContentsId == null ||
      pendingOpenWorkspaceRequest.targetWebContentsId === webContents.id)
  ) {
    webContents.send(PlatformChannels.OpenWorkspacePath, pendingOpenWorkspaceRequest.path);
    pendingOpenWorkspaceRequest = null;
  }
  return hasPendingOAuthCallback;
}

export function clearOAuthRoutesForWindow(windowId: number): void {
  rendererReadyWebContentsIds.delete(windowId);
  if (pendingOpenWorkspaceRequest?.targetWebContentsId === windowId) {
    pendingOpenWorkspaceRequest = null;
  }
  for (let index = pendingShareImports.length - 1; index >= 0; index -= 1) {
    if (pendingShareImports[index]!.targetWebContentsId === windowId) {
      pendingShareImports.splice(index, 1);
    }
  }

  for (const [state, routeTarget] of oauthStateToWindow) {
    if (routeTarget.windowId === windowId) {
      oauthStateToWindow.delete(state);
    }
  }
}
