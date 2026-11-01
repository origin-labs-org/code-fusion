import { getPluginSandboxHost } from "./pluginSandbox/index.js";

import { readCfStdioTapDevState, setCfStdioTapDevEnabled } from "@origin-ai/cf-services/node";
import {
  buildCfEndpointUrls,
  DEFAULT_CF_ENDPOINT_ORIGIN,
  DesktopCommandIds,
  REWARDS_PARTITION,
  TEST_CF_ENDPOINT_ORIGIN,
  getCommunityUrlFromConfigs,
  getFeedbackUrlFromConfig,
  normalizeCfEndpointOrigin,
  PlatformChannels,
  resolveHelpAppConfig,
  resolveCfEndpointOrigin,
  CF_ENV,
  CF_PRODUCT_FLAVOR,
  type AppSettings,
  type DesktopCommandId,
  type Locale,
} from "@origin-ai/cf-shared";
import type { MessageBoxOptions } from "electron";
import { app, BrowserWindow, dialog, session, shell } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { showAboutDialog } from "./about.js";
import { checkForUpdateMenuClick } from "./autoUpdater.js";
import { resolveCuaOsSupport } from "./cuaOsSupport.js";
import { syncWindowControlsOverlayForZoomLevel } from "./desktopWindowButtonPosition.js";
import {
  DEFAULT_DESKTOP_WINDOW_HEIGHT,
  DEFAULT_DESKTOP_WINDOW_WIDTH,
} from "./desktopWindowSize.js";
import {
  clampDesktopZoomLevel,
  resolveDesktopZoomFactorForLevel,
  resolveDesktopZoomLevelFromFactor,
} from "./desktopZoom.js";
import { exportLogs } from "./exportLogs.js";
import { openResourceManager } from "./resourceManagerWindow.js";

export const HELP_TOGGLE_DEV_TOOLS_MENU_ID = "help.toggle-dev-tools";
export const HELP_TOGGLE_CF_STDIO_TAP_MENU_ID = "help.toggle-cf-stdio-tap";
const CF_ENDPOINT_PROMPT_WIDTH = 460;
const CF_ENDPOINT_PROMPT_HEIGHT = 210;
const CODING_PLAN_WEBVIEW_PARTITION = "persist:cf-coding-plan";

function resolveTargetWindow(senderWindow?: BrowserWindow | null) {
  if (senderWindow && !senderWindow.isDestroyed()) {
    return senderWindow;
  }

  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}
export function updateDesktopZoomLevel(
  targetWindow: BrowserWindow | null | undefined,
  action: "reset" | "in" | "out",
) {
  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  const currentLevel = resolveDesktopZoomLevelFromFactor(targetWindow.webContents.getZoomFactor());
  const nextLevel =
    action === "reset" ? 0 : clampDesktopZoomLevel(currentLevel + (action === "in" ? 1 : -1));

  targetWindow.webContents.setZoomFactor(resolveDesktopZoomFactorForLevel(nextLevel));
  syncWindowControlsOverlayForZoomLevel(targetWindow, nextLevel);
  targetWindow.webContents.send(PlatformChannels.DesktopZoomLevelChanged, { zoomLevel: nextLevel });
  return nextLevel;
}

function showMessageBoxWithOptionalParent(
  parentWindow: BrowserWindow | null | undefined,
  options: MessageBoxOptions,
) {
  return parentWindow
    ? dialog.showMessageBox(parentWindow, options)
    : dialog.showMessageBox(options);
}
async function clearAllDataAndRelaunch(options: {
  credentialsDir: string;
  logger: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}) {
  const { response } = await dialog.showMessageBox({
    type: "warning",
    buttons: ["Cancel", "Clear All"],
    defaultId: 0,
    cancelId: 0,
    title: "Clear All Data",
    message: "确定要清除所有数据吗？",
    detail:
      "This will delete ~/.cf/v2 (configurations, credentials, logs) and browser cache (localStorage). This action cannot be undone, and the application will automatically restart afterward.",
  });
  if (response !== 1) {
    return;
  }

  await getPluginSandboxHost()?.clearBrowserData();
  const { rm } = await import("node:fs/promises");
  try {
    await rm(options.credentialsDir, { recursive: true, force: true });
    options.logger.info("[clear-all-data] deleted ~/.cf/v2");
  } catch (error) {
    options.logger.error("[clear-all-data] failed to delete ~/.cf/v2:", error);
  }

  for (const win of BrowserWindow.getAllWindows()) {
    try {
      await win.webContents.executeJavaScript("localStorage.clear()");
    } catch {
    }
  }

  try {
    const session = BrowserWindow.getAllWindows()[0]?.webContents.session;
    if (session) {
      await session.clearStorageData();
      options.logger.info("[clear-all-data] cleared session storage data");
    }
  } catch (error) {
    options.logger.error("[clear-all-data] failed to clear session data:", error);
  }

  app.relaunch();
  app.exit(0);
}

export async function clearCodingPlanWebviewStorage(options: {
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
}) {
  try {
    await session.fromPartition(CODING_PLAN_WEBVIEW_PARTITION).clearStorageData();
    await session.fromPartition(REWARDS_PARTITION).clearStorageData();
    options.logger.info("[coding-plan-webview] cleared persistent partition storage");
  } catch (error) {
    options.logger.warn(
      "[coding-plan-webview] failed to clear persistent partition storage:",
      error,
    );
  }
}

async function fetchRemoteAppConfig(fetchRemoteConfig?: () => Promise<unknown>): Promise<unknown> {
  if (!fetchRemoteConfig) throw new Error("Help config reader is unavailable");
  return fetchRemoteConfig();
}

export function resolveLocalAppConfigPath(options?: {
  appPath?: string;
  isPackaged?: boolean;
  resourcesPath?: string;
}): string {
  const isPackaged = options?.isPackaged ?? app.isPackaged;
  if (isPackaged) {
    return join(options?.resourcesPath ?? process.resourcesPath, "config/default.json");
  }
  return join(options?.appPath ?? app.getAppPath(), "../../config/default.json");
}

async function readLocalAppConfig(readLocalConfig?: () => unknown): Promise<unknown> {
  const localConfigPath = resolveLocalAppConfigPath();
  return readLocalConfig?.() ?? JSON.parse(await readFile(localConfigPath, "utf-8"));
}

async function resolveRemoteAppConfigValue(options: {
  fetchRemoteConfig?: () => Promise<unknown>;
  readLocalConfig?: () => unknown;
  resolveFromConfig: (config: unknown) => string | undefined;
  logPrefix: "feedback" | "community";
  logger: {
    warn: (...args: unknown[]) => void;
  };
}): Promise<string | undefined> {
  try {
    const remoteConfig = await fetchRemoteAppConfig(options.fetchRemoteConfig);
    const remoteResolvedValue = options.resolveFromConfig(remoteConfig);
    if (remoteResolvedValue) {
      return remoteResolvedValue;
    }
  } catch (error) {
    options.logger.warn(`[${options.logPrefix}] failed to fetch remote config:`, error);
  }

  try {
    const localConfig = await readLocalAppConfig(options.readLocalConfig);
    const localResolvedValue = options.resolveFromConfig(localConfig);
    if (localResolvedValue) {
      return localResolvedValue;
    }
  } catch (error) {
    options.logger.warn(`[${options.logPrefix}] failed to read local config:`, error);
  }

  return undefined;
}

export async function resolveFeedbackUrl(options: {
  fetchRemoteConfig?: () => Promise<unknown>;
  readLocalConfig?: () => unknown;
  logger: {
    warn: (...args: unknown[]) => void;
  };
}): Promise<string | undefined> {
  return resolveRemoteAppConfigValue({
    ...options,
    logPrefix: "feedback",
    resolveFromConfig: getFeedbackUrlFromConfig,
  });
}

export async function resolveCommunityUrl(options: {
  locale: Locale;
  fetchRemoteConfig?: () => Promise<unknown>;
  readLocalConfig?: () => unknown;
  logger: {
    warn: (...args: unknown[]) => void;
  };
}): Promise<string | undefined> {
  let remoteConfig: unknown;
  try {
    remoteConfig = await fetchRemoteAppConfig(options.fetchRemoteConfig);
  } catch (error) {
    options.logger.warn("[community] failed to fetch remote config:", error);
  }

  let localConfig: unknown;
  try {
    localConfig = await readLocalAppConfig(options.readLocalConfig);
  } catch (error) {
    options.logger.warn("[community] failed to read local config:", error);
  }

  return getCommunityUrlFromConfigs(remoteConfig, localConfig, options.locale);
}

async function openFeedback(
  logger: { warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void },
  targetWindow?: BrowserWindow | null,
  fetchRemoteConfig?: () => Promise<unknown>,
) {
  let remoteConfig: unknown;
  let localConfig: unknown;
  try {
    remoteConfig = await fetchRemoteAppConfig(fetchRemoteConfig);
  } catch (error) {
    logger.warn("[feedback] failed to fetch remote config:", error);
  }
  try {
    localConfig = await readLocalAppConfig();
  } catch (error) {
    logger.warn("[feedback] failed to read local config:", error);
  }
  const config = resolveHelpAppConfig(remoteConfig, localConfig);
  if (!config.feedback_use_external_form) {
    resolveTargetWindow(targetWindow)?.webContents.send(PlatformChannels.OpenFeedbackDialog);
    return;
  }
  if (config.feedback_url) await shell.openExternal(config.feedback_url);
}

async function openCommunity(
  locale: Locale,
  logger: {
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  },
  fetchRemoteConfig?: () => Promise<unknown>,
) {
  const communityUrl = await resolveCommunityUrl({ locale, logger, fetchRemoteConfig });
  if (!communityUrl) {
    logger.warn("[community] community_urls is missing from both remote and local config");
    return;
  }
  await shell.openExternal(communityUrl);
}

async function promptCustomCfEndpoint(
  targetWindow: BrowserWindow | null | undefined,
  currentValue: string,
): Promise<string | undefined> {
  return showCfEndpointPromptWindow({
    currentValue,
    parentWindow: targetWindow && !targetWindow.isDestroyed() ? targetWindow : undefined,
  });
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildCfEndpointPromptHtml(currentValue: string): string {
  const value = escapeHtmlAttribute(currentValue);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>CodeFusion Endpoint</title>
    <style>
      :root { color-scheme: light dark; }
      body { margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      label { display: block; margin-bottom: 8px; font-size: 13px; font-weight: 600; }
      input { box-sizing: border-box; width: 100%; height: 34px; padding: 6px 8px; font: inherit; }
      .hint { margin-top: 8px; color: #6b7280; font-size: 12px; }
      .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
      button { min-width: 78px; height: 30px; font: inherit; }
    </style>
  </head>
  <body>
    <form id="form">
      <label for="endpoint">CodeFusion endpoint origin</label>
      <input id="endpoint" value="${value}" placeholder="https://cf.z.ai" spellcheck="false" />
      <div class="hint">Use an http or https origin, for example https://cf.z.ai.</div>
      <div class="actions">
        <button id="cancel" type="button">Cancel</button>
        <button type="submit">Save</button>
      </div>
    </form>
    <script>
      const input = document.getElementById("endpoint");
      const submit = (value) => { document.title = "cf-endpoint-submit:" + encodeURIComponent(value); };
      document.getElementById("form").addEventListener("submit", (event) => {
        event.preventDefault();
        submit(input.value);
      });
      document.getElementById("cancel").addEventListener("click", () => {
        document.title = "cf-endpoint-cancel";
      });
      input.focus();
      input.select();
    </script>
  </body>
</html>`;
}

function showCfEndpointPromptWindow(options: {
  currentValue: string;
  parentWindow?: BrowserWindow;
}): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const promptWindow = new BrowserWindow({
      width: CF_ENDPOINT_PROMPT_WIDTH,
      height: CF_ENDPOINT_PROMPT_HEIGHT,
      parent: options.parentWindow,
      modal: Boolean(options.parentWindow),
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: "CodeFusion Endpoint",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const finish = (value: string | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
      if (!promptWindow.isDestroyed()) {
        promptWindow.close();
      }
    };

    promptWindow.on("closed", () => finish(undefined));
    promptWindow.on("page-title-updated", (event, title) => {
      if (title === "cf-endpoint-cancel") {
        event.preventDefault();
        finish(undefined);
        return;
      }
      if (!title.startsWith("cf-endpoint-submit:")) {
        return;
      }
      event.preventDefault();
      finish(decodeURIComponent(title.slice("cf-endpoint-submit:".length)));
    });

    void promptWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        buildCfEndpointPromptHtml(options.currentValue),
      )}`,
    );
  });
}

async function setCfEndpointOverride(options: {
  value: string | undefined;
  settingService: { update(patch: { cfEndpointOrigin?: string | undefined }): Promise<void> };
  onCfEndpointChanged: () => Promise<void> | void;
  logger: { warn: (...args: unknown[]) => void };
}) {
  if (CF_ENV === "production") {
    return;
  }
  const normalized = options.value ? normalizeCfEndpointOrigin(options.value) : undefined;
  await options.settingService.update({ cfEndpointOrigin: normalized });
  await options.onCfEndpointChanged();
}

async function persistDesktopZoomLevel(options: {
  zoomLevel: number;
  logger: { warn: (...args: unknown[]) => void };
  settingService: { update(patch: Pick<AppSettings, "desktopZoomLevel">): Promise<void> };
}) {
  try {
    await options.settingService.update({ desktopZoomLevel: options.zoomLevel });
  } catch (error) {
    options.logger.warn("[desktop-zoom] persist zoom level failed:", error);
  }
}

function toggleCfStdioTapDevProxy(options: {
  logger: { info: (...args: unknown[]) => void };
  updateCfStdioTapDevMenuState: () => void;
}) {
  const current = readCfStdioTapDevState();
  const next = setCfStdioTapDevEnabled(!current.enabled);
  options.updateCfStdioTapDevMenuState();
  options.logger.info("[stdio-tap] dev proxy toggled", {
    enabled: next.enabled,
    visible: next.visible,
    logDir: next.logDir,
  });
}

function resolveChangelogUrl(
  locale: Locale,
  endpointOrigin = DEFAULT_CF_ENDPOINT_ORIGIN,
): string {
  const origin = buildCfEndpointUrls(endpointOrigin).origin;
  return locale === "zh-CN" ? `${origin}/cn/changelog` : `${origin}/en/changelog`;
}

export async function openChangelog(
  locale: Locale,
  endpointOrigin = DEFAULT_CF_ENDPOINT_ORIGIN,
) {
  await shell.openExternal(resolveChangelogUrl(locale, endpointOrigin));
}

async function resolveCurrentCfEndpointOrigin(settingService: {
  get(): Promise<{ cfEndpointOrigin?: string }>;
  envBaseOrigin?: string | null;
}): Promise<string> {
  const settings = await settingService.get();
  return resolveCfEndpointOrigin({
    env: CF_ENV,
    envBaseOrigin: settingService.envBaseOrigin,
    overrideOrigin: settings.cfEndpointOrigin,
  });
}

export async function executeDesktopCommand(options: {
  command: DesktopCommandId;
  fetchHelpConfig?: () => Promise<unknown>;
  senderWindow?: BrowserWindow | null;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  updateCfStdioTapDevMenuState: () => void;
  onDesktopZoomChanged?: (zoomLevel: number) => Promise<void> | void;
  onCfEndpointChanged: () => Promise<void> | void;
  onRelaunchApp: () => Promise<void>;
  settingService: {
    get(): Promise<Pick<AppSettings, "cfEndpointOrigin" | "desktopZoomLevel">>;
    update(
      patch: Partial<Pick<AppSettings, "cfEndpointOrigin" | "desktopZoomLevel">>,
    ): Promise<void>;
  };
  cfEndpointEnvBaseOrigin?: string | null;
  credentialsDir: string;
  currentApplicationLocale: Locale;
}) {
  const targetWindow = resolveTargetWindow(options.senderWindow);
  options.logger.info(
    `[desktop-command] execute ${options.command} windowId=${targetWindow?.id ?? "<none>"}`,
  );

  switch (options.command) {
    case DesktopCommandIds.NewTask:
      targetWindow?.webContents.send(PlatformChannels.NewTask);
      return;
    case DesktopCommandIds.OpenWorkspace:
      targetWindow?.webContents.send(PlatformChannels.OpenWorkspace);
      return;
    case DesktopCommandIds.CloseActiveContext:
      targetWindow?.webContents.send(PlatformChannels.CloseActiveContextRequest);
      return;
    case DesktopCommandIds.CloseWindow:
      targetWindow?.close();
      return;
    case DesktopCommandIds.MinimizeWindow:
      targetWindow?.minimize();
      return;
    case DesktopCommandIds.ToggleMaximizeWindow:
      if (targetWindow?.isMaximized()) {
        targetWindow.unmaximize();
      } else {
        targetWindow?.maximize();
      }
      return;
    case DesktopCommandIds.ToggleFullScreen:
      if (targetWindow) {
        targetWindow.setFullScreen(!targetWindow.isFullScreen());
      }
      return;
    case DesktopCommandIds.ResetWindowSize:
      if (targetWindow) {
        if (targetWindow.isFullScreen()) targetWindow.setFullScreen(false);
        if (targetWindow.isMaximized()) targetWindow.unmaximize();
        targetWindow.setSize(DEFAULT_DESKTOP_WINDOW_WIDTH, DEFAULT_DESKTOP_WINDOW_HEIGHT, true);
      }
      return;
    case DesktopCommandIds.ResetZoom:
      {
        const nextZoomLevel = updateDesktopZoomLevel(targetWindow, "reset");
        if (nextZoomLevel !== undefined) {
          await persistDesktopZoomLevel({
            zoomLevel: nextZoomLevel,
            logger: options.logger,
            settingService: options.settingService,
          });
          await options.onDesktopZoomChanged?.(nextZoomLevel);
        }
      }
      return;
    case DesktopCommandIds.ZoomIn:
      {
        const nextZoomLevel = updateDesktopZoomLevel(targetWindow, "in");
        if (nextZoomLevel !== undefined) {
          await persistDesktopZoomLevel({
            zoomLevel: nextZoomLevel,
            logger: options.logger,
            settingService: options.settingService,
          });
          await options.onDesktopZoomChanged?.(nextZoomLevel);
        }
      }
      return;
    case DesktopCommandIds.ZoomOut:
      {
        const nextZoomLevel = updateDesktopZoomLevel(targetWindow, "out");
        if (nextZoomLevel !== undefined) {
          await persistDesktopZoomLevel({
            zoomLevel: nextZoomLevel,
            logger: options.logger,
            settingService: options.settingService,
          });
          await options.onDesktopZoomChanged?.(nextZoomLevel);
        }
      }
      return;
    case DesktopCommandIds.ShowAbout:
      await showAboutDialog(targetWindow ?? undefined, options.currentApplicationLocale);
      return;
    case DesktopCommandIds.OpenChangelog:
      await openChangelog(
        options.currentApplicationLocale,
        await resolveCurrentCfEndpointOrigin({
          ...options.settingService,
          envBaseOrigin: options.cfEndpointEnvBaseOrigin,
        }),
      );
      return;
    case DesktopCommandIds.CheckForUpdates:
      if (CF_PRODUCT_FLAVOR === "production") {
        checkForUpdateMenuClick(targetWindow);
      } else {
        options.logger.info("[auto-update] Preview 已禁用手动更新检查");
      }
      return;
    case DesktopCommandIds.RelaunchApp:
      await options.onRelaunchApp();
      return;
    case DesktopCommandIds.OpenFeedback:
      await openFeedback(options.logger, targetWindow, options.fetchHelpConfig);
      return;
    case DesktopCommandIds.OpenCommunity:
      await openCommunity(
        options.currentApplicationLocale,
        options.logger,
        options.fetchHelpConfig,
      );
      return;
    case DesktopCommandIds.ExportLogs:
      await exportLogs();
      return;
    case DesktopCommandIds.ToggleDevTools:
      targetWindow?.webContents.toggleDevTools();
      return;
    case DesktopCommandIds.OpenResourceManager:
      openResourceManager();
      return;
    case DesktopCommandIds.ToggleCfStdioTapDevProxy:
      toggleCfStdioTapDevProxy({
        logger: options.logger,
        updateCfStdioTapDevMenuState: options.updateCfStdioTapDevMenuState,
      });
      return;
    case DesktopCommandIds.SetCfEndpointProduction:
      await setCfEndpointOverride({
        value: DEFAULT_CF_ENDPOINT_ORIGIN,
        settingService: options.settingService,
        onCfEndpointChanged: options.onCfEndpointChanged,
        logger: options.logger,
      });
      return;
    case DesktopCommandIds.SetCfEndpointTest:
      await setCfEndpointOverride({
        value: TEST_CF_ENDPOINT_ORIGIN,
        settingService: options.settingService,
        onCfEndpointChanged: options.onCfEndpointChanged,
        logger: options.logger,
      });
      return;
    case DesktopCommandIds.SetCfEndpointCustom: {
      const current =
        (await options.settingService.get()).cfEndpointOrigin ?? DEFAULT_CF_ENDPOINT_ORIGIN;
      const value = await promptCustomCfEndpoint(targetWindow, current);
      if (!value) {
        return;
      }
      try {
        await setCfEndpointOverride({
          value,
          settingService: options.settingService,
          onCfEndpointChanged: options.onCfEndpointChanged,
          logger: options.logger,
        });
      } catch (error) {
        await showMessageBoxWithOptionalParent(targetWindow, {
          type: "error",
          title: "CodeFusion Endpoint",
          message: "Invalid Endpoint",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    case DesktopCommandIds.ResetCfEndpoint:
      await setCfEndpointOverride({
        value: undefined,
        settingService: options.settingService,
        onCfEndpointChanged: options.onCfEndpointChanged,
        logger: options.logger,
      });
      return;
    case DesktopCommandIds.ClearAllData:
      await clearCodingPlanWebviewStorage({ logger: options.logger });
      await clearAllDataAndRelaunch({
        credentialsDir: options.credentialsDir,
        logger: options.logger,
      });
      return;
    case DesktopCommandIds.ClearCodingPlanWebviewStorage:
      await clearCodingPlanWebviewStorage({ logger: options.logger });
      return;
    case DesktopCommandIds.GetCuaOsSupport:
      return resolveCuaOsSupport();
  }
}
