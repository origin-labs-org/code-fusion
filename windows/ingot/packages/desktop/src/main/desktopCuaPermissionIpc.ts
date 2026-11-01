
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { app, BrowserWindow, ipcMain, nativeImage, screen } from "electron";
import { PlatformChannels, type CuaPermissionKind, type Locale } from "@origin-ai/cf-shared";
import {
  cuaHelperBundleFingerprintUnchanged,
  openCuaPermissionOnboarding,
  prepareCuaHelperPermissionDrag,
} from "./cuaAccessibilitySettings.js";
import {
  createCuaPermissionDragPanel,
  createRealCuaPermissionPanelWindow,
  type CuaPermissionDragPanel,
} from "./cuaPermissionDragPanel.js";
import { createSystemSettingsWindowWatcher } from "./cuaSystemSettingsWindowWatcher.js";

const execFileAsync = promisify(execFile);
const MACOS_SYSTEM_SETTINGS_BUNDLE_ID = "com.apple.systempreferences";
const CUA_HELPER_DRAG_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const CUA_DRAG_ICON_SIZE = 64;

let cachedCfIcon: Electron.NativeImage | null = null;

function resolveCfIcon(): Electron.NativeImage {
  if (cachedCfIcon && !cachedCfIcon.isEmpty()) return cachedCfIcon;
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, "icon.png")
    : join(import.meta.dirname, "..", "..", "build", "icon.png");
  const image = nativeImage.createFromPath(iconPath);
  cachedCfIcon = image.isEmpty()
    ? nativeImage.createFromDataURL(CUA_HELPER_DRAG_ICON_DATA_URL)
    : image;
  return cachedCfIcon;
}

interface CuaApplicationReturnOptions {
  openSettings: () => Promise<void>;
  timeoutMs: number;
  signal: AbortSignal;
  resolveFrontmostBundleId?: () => Promise<string | null>;
}

async function resolveFrontmostBundleId(): Promise<string | null> {
  const { stdout: front } = await execFileAsync("/usr/bin/lsappinfo", ["front"], {
    encoding: "utf8",
    timeout: 2_000,
  });
  const asn = front.trim();
  if (!asn) return null;
  const { stdout: info } = await execFileAsync(
    "/usr/bin/lsappinfo",
    ["info", "-only", "bundleid", asn],
    { encoding: "utf8", timeout: 2_000 },
  );
  return info.match(/"CFBundleIdentifier"="([^"]+)"/)?.[1] ?? null;
}

function waitForCuaApplicationReturn({
  openSettings,
  timeoutMs,
  signal,
  resolveFrontmostBundleId: readFrontmostBundleId = resolveFrontmostBundleId,
}: CuaApplicationReturnOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let settingsOpened = false;
    let applicationEventSequence = 0;
    let latestBlurSequence = 0;
    let latestCfReturnSequence = 0;
    let observedSystemSettingsAfterSequence: number | null = null;
    let activeInspections = 0;
    let inspectionTimer: ReturnType<typeof setTimeout> | undefined;
    let observationTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (observationTimer) clearTimeout(observationTimer);
      if (inspectionTimer) clearTimeout(inspectionTimer);
      app.removeListener("browser-window-blur", onBlur);
      app.removeListener("browser-window-focus", onFocus);
      app.removeListener("activate", onFocus);
      app.removeListener("before-quit", onQuit);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error !== undefined) reject(error);
      else resolve();
    };
    const maybeFinishReturn = () => {
      if (
        settingsOpened &&
        observedSystemSettingsAfterSequence !== null &&
        latestCfReturnSequence > observedSystemSettingsAfterSequence
      )
        finish();
    };
    const scheduleInspection = () => {
      if (settled || activeInspections > 0 || observedSystemSettingsAfterSequence !== null) return;
      if (inspectionTimer) clearTimeout(inspectionTimer);
      inspectionTimer = setTimeout(inspectFrontmost, 150);
    };
    const inspectFrontmost = (forceAtEventBoundary = false) => {
      if (
        settled ||
        observedSystemSettingsAfterSequence !== null ||
        (!forceAtEventBoundary && activeInspections > 0)
      )
        return;
      if (inspectionTimer) {
        clearTimeout(inspectionTimer);
        inspectionTimer = undefined;
      }
      const inspectionStartedAtSequence = applicationEventSequence;
      const inspectionStartedWhileAway = latestBlurSequence > latestCfReturnSequence;
      activeInspections += 1;
      void readFrontmostBundleId().then(
        (bundleId) => {
          activeInspections -= 1;
          if (settled) return;
          if (
            bundleId === MACOS_SYSTEM_SETTINGS_BUNDLE_ID &&
            inspectionStartedWhileAway &&
            inspectionStartedAtSequence >= latestBlurSequence
          ) {
            observedSystemSettingsAfterSequence = Math.max(
              inspectionStartedAtSequence,
              latestBlurSequence,
            );
            if (observationTimer) {
              clearTimeout(observationTimer);
              observationTimer = undefined;
            }
            maybeFinishReturn();
            return;
          }
          scheduleInspection();
        },
        () => {
          activeInspections -= 1;
          scheduleInspection();
        },
      );
    };
    const onBlur = () => {
      latestBlurSequence = ++applicationEventSequence;
      inspectFrontmost(true);
    };
    const onFocus = () => {
      latestCfReturnSequence = ++applicationEventSequence;
      inspectFrontmost();
      maybeFinishReturn();
    };
    const onQuit = () => finish(new Error("CodeFusion quit during CUA permission onboarding"));
    const onAbort = () =>
      finish(signal.reason ?? new Error("CUA permission onboarding origin window closed"));
    observationTimer = setTimeout(
      () =>
        finish(
          new Error(`System Settings did not return to CodeFusion within ${Math.max(1, timeoutMs)}ms`),
        ),
      Math.max(1, timeoutMs),
    );

    app.on("browser-window-blur", onBlur);
    app.on("browser-window-focus", onFocus);
    app.on("activate", onFocus);
    app.on("before-quit", onQuit);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    inspectFrontmost();
    void openSettings().then(
      () => {
        settingsOpened = true;
        maybeFinishReturn();
      },
      (error) => finish(error),
    );
  });
}

function normalizePermissionList(value: unknown): CuaPermissionKind[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const set = new Set<CuaPermissionKind>();
  for (const permission of value) {
    if (permission === "accessibility" || permission === "screen_recording") {
      set.add(permission);
    }
  }
  return [...set];
}

function normalizeOnboardingOperationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 128 ? normalized : null;
}

function createDragPanelForSession(
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  },
  getLocale: () => Locale,
): CuaPermissionDragPanel {
  const watcher = createSystemSettingsWindowWatcher({
    binaryPath: resolveWindowBoundsBinaryPath(),
    logger,
  });
  watcher.start();

  return createCuaPermissionDragPanel({
    createWindow: createRealCuaPermissionPanelWindow({
      BrowserWindow,
      app,
      preloadPath: join(import.meta.dirname, "../preload/cuaPermissionPanel.cjs"),
      rendererDir: join(import.meta.dirname, "../renderer"),
      rendererDevUrl: process.env["ELECTRON_RENDERER_URL"],
    }),
    getDisplayWorkArea: () => screen.getPrimaryDisplay().workArea,
    getSettingsBounds: () => watcher.latest(),
    stopSettingsBounds: () => watcher.stop(),
    getLocale,
    getIconDataUrl: () =>
      resolveCfIcon()
        .resize({ width: CUA_DRAG_ICON_SIZE, height: CUA_DRAG_ICON_SIZE })
        .toDataURL(),
    logger,
  });
}

function resolveWindowBoundsBinaryPath(): string {
  const relative = join("macos-window-bounds", "cf-window-bounds");
  return app.isPackaged
    ? join(process.resourcesPath, relative)
    : join(import.meta.dirname, "..", "..", "resources", relative);
}

export function registerCuaPermissionIpcHandlers(options: {
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
  currentApplicationLocale: () => Locale;
}) {
  const onboardingControllers = new Map<string, AbortController>();
  const operationKey = (senderId: number, operationId: string) => `${senderId}\0${operationId}`;

  let verifiedHelperAppPath: string | null = null;
  let verifiedHelperFingerprint: string | null = null;
  let verifiedHelperDisplayName: string | null = null;
  let activeDragPanel: CuaPermissionDragPanel | null = null;

  function cacheVerifiedHelper(
    helperAppPath: string,
    verifiedFingerprint: string,
    displayName: string | null,
  ): void {
    verifiedHelperAppPath = helperAppPath;
    verifiedHelperFingerprint = verifiedFingerprint;
    verifiedHelperDisplayName = displayName;
  }

  function clearVerifiedHelper(): void {
    verifiedHelperAppPath = null;
    verifiedHelperFingerprint = null;
    verifiedHelperDisplayName = null;
  }

  async function refreshVerifiedHelperAppPath(): Promise<void> {
    const result = await prepareCuaHelperPermissionDrag({ logger: options.logger });
    if (result.success && result.helperAppPath && result.helperBundleFingerprint) {
      cacheVerifiedHelper(
        result.helperAppPath,
        result.helperBundleFingerprint,
        result.helperDisplayName ?? null,
      );
    } else {
      clearVerifiedHelper();
      options.logger.warn("[cua-permission-onboarding] prepare helper drag failed", result.error);
    }
  }

  ipcMain.handle(PlatformChannels.PrepareCuaHelperPermissionDrag, async () => {
    await refreshVerifiedHelperAppPath();
    return {
      success: verifiedHelperAppPath !== null,
      ...(verifiedHelperAppPath !== null ? { helperAppPath: verifiedHelperAppPath } : {}),
      ...(verifiedHelperDisplayName !== null
        ? { helperDisplayName: verifiedHelperDisplayName }
        : {}),
      ...(verifiedHelperAppPath === null ? { error: "helper drag preparation failed" } : {}),
    };
  });

  ipcMain.on(PlatformChannels.StartCuaHelperPermissionDrag, (event) => {
    const helperAppPath = verifiedHelperAppPath;
    const fingerprint = verifiedHelperFingerprint;
    if (!helperAppPath || !fingerprint) {
      options.logger.warn(
        "[cua-permission-onboarding] helper drag not prepared yet; verifying in background for next drag",
      );
      void refreshVerifiedHelperAppPath();
      return;
    }
    if (!cuaHelperBundleFingerprintUnchanged(helperAppPath, fingerprint)) {
      options.logger.warn(
        "[cua-permission-onboarding] cached helper changed since verification; refusing to drag a possibly-tampered bundle",
      );
      clearVerifiedHelper();
      void refreshVerifiedHelperAppPath();
      return;
    }
    const icon = resolveCfIcon().resize({
      width: CUA_DRAG_ICON_SIZE,
      height: CUA_DRAG_ICON_SIZE,
    });
    try {
      event.sender.startDrag({ file: helperAppPath, icon });
    } catch (error) {
      options.logger.warn(
        "[cua-permission-onboarding] helper drag failed",
        error instanceof Error ? error.message : String(error),
      );
    }
    activeDragPanel?.freezePosition();
    void refreshVerifiedHelperAppPath();
  });

  ipcMain.on(PlatformChannels.NotifyCuaHelperPermissionDragEnded, () => {
    activeDragPanel?.hide();
  });

  ipcMain.on(PlatformChannels.CancelCuaPermissionOnboarding, (event, payload) => {
    const senderId = event.sender?.id;
    const operationId = normalizeOnboardingOperationId(
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>).operationId
        : undefined,
    );
    if (!Number.isInteger(senderId) || !operationId) return;
    onboardingControllers
      .get(operationKey(senderId, operationId))
      ?.abort(new Error("CUA permission onboarding surface closed"));
  });

  ipcMain.handle(PlatformChannels.OpenCuaPermissionOnboarding, async (event, payload) => {
    const payloadRecord =
      payload && typeof payload === "object" ? (payload as Record<string, unknown>) : undefined;
    const operationId = normalizeOnboardingOperationId(payloadRecord?.operationId);
    const requiredPermissions = normalizePermissionList(payloadRecord?.requiredPermissions);
    const originController = new AbortController();
    const sender = event.sender as {
      id?: number;
      isDestroyed?: () => boolean;
      once?: (event: "destroyed", listener: () => void) => void;
      removeListener?: (event: "destroyed", listener: () => void) => void;
    };
    const senderId =
      typeof sender.id === "number" && Number.isInteger(sender.id) ? sender.id : null;
    const participantOperationKey =
      senderId !== null && operationId ? operationKey(senderId, operationId) : null;
    if (participantOperationKey && onboardingControllers.has(participantOperationKey)) {
      return {
        success: false,
        canceled: true,
        error: "duplicate CUA permission onboarding operation id",
      };
    }
    if (participantOperationKey) {
      onboardingControllers.set(participantOperationKey, originController);
    }
    const abortForDestroyedOrigin = () =>
      originController.abort(new Error("CUA permission onboarding origin window closed"));
    if (sender.isDestroyed?.()) abortForDestroyedOrigin();
    else sender.once?.("destroyed", abortForDestroyedOrigin);

    //
    let dragPanel: CuaPermissionDragPanel | null = null;
    if (process.platform === "darwin") {
      try {
        dragPanel = createDragPanelForSession(options.logger, options.currentApplicationLocale);
      } catch (error) {
        options.logger.warn(
          "[cua-permission-onboarding] drag panel unavailable; continuing with settings pane only",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    activeDragPanel = dragPanel;

    let result: Awaited<ReturnType<typeof openCuaPermissionOnboarding>>;
    try {
      result = await openCuaPermissionOnboarding({
        initialPermission:
          payloadRecord?.initialPermission === "screen_recording"
            ? "screen_recording"
            : "accessibility",
        ...(requiredPermissions !== undefined ? { requiredPermissions } : {}),
        ...(typeof sender.id === "number" && Number.isInteger(sender.id)
          ? { participantKey: `webContents:${sender.id}` }
          : {}),
        signal: originController.signal,
        openSettingsAndWaitForReturn: async (stage) => {
          try {
            await waitForCuaApplicationReturn({
              ...stage,
              openSettings: async () => {
                await stage.openSettings();
                dragPanel?.show(stage.permission);
              },
            });
          } finally {
            dragPanel?.hide();
          }
        },
        logger: options.logger,
      });
    } finally {
      dragPanel?.destroy();
      if (activeDragPanel === dragPanel) activeDragPanel = null;
      sender.removeListener?.("destroyed", abortForDestroyedOrigin);
      if (
        participantOperationKey &&
        onboardingControllers.get(participantOperationKey) === originController
      ) {
        onboardingControllers.delete(participantOperationKey);
      }
    }
    if (result.success) void refreshVerifiedHelperAppPath();
    return result;
  });

}
