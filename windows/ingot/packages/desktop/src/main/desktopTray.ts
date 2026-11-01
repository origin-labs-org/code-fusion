import { app, Menu, nativeImage, Tray } from "electron";
import type { NativeImage } from "electron";
import { join } from "node:path";
import {
  DesktopCommandIds,
  desktopMenuMessageIds,
  getDesktopMenuMessage,
  CF_PRODUCT_FLAVOR,
  type DesktopCommandId,
  type Locale,
} from "@origin-ai/cf-shared";
import {
  blendBadgeIntoBitmap,
  renderAntialiasedStatusDotPixels,
  resolveBadgeOverlayLabel,
} from "./unreadBadge.js";

let desktopTray: Tray | null = null;
let rebuildDesktopTrayContextMenu: (() => void) | null = null;
let trayLogger: { warn: (...args: unknown[]) => void } | null = null;

const TRAY_LOGICAL_SIZE = 16;

let trayBaseImage: NativeImage | null = null;
const trayBadgeImageCache = new Map<string, NativeImage>();

export function resolveDesktopTrayIconPath(platform: NodeJS.Platform = process.platform) {
  if (platform === "linux") {
    return app.isPackaged
      ? join(process.resourcesPath, "icon.png")
      : join(import.meta.dirname, "../../build/icon.png");
  }
  return app.isPackaged
    ? join(process.resourcesPath, "tray_icon.ico")
    : join(import.meta.dirname, "../../build/icon.ico");
}

export function createDesktopTray(options: {
  platform?: NodeJS.Platform;
  getLocale: () => Locale;
  showCurrentWindow: () => Promise<void> | void;
  executeDesktopCommand: (command: DesktopCommandId) => Promise<unknown>;
  quitApp: () => void;
  logger: { warn: (...args: unknown[]) => void };
}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32" && platform !== "linux") {
    return null;
  }

  if (desktopTray) {
    return desktopTray;
  }

  try {
    desktopTray = new Tray(resolveDesktopTrayIconPath(platform));
  } catch (error) {
    options.logger.warn("[desktop-tray] failed to create tray icon", error);
    return null;
  }
  trayLogger = options.logger;

  const getLabel = (id: (typeof desktopMenuMessageIds)[keyof typeof desktopMenuMessageIds]) =>
    getDesktopMenuMessage(options.getLocale(), id);
  const showTrayWindow = () => {
    void Promise.resolve(options.showCurrentWindow()).catch((error) => {
      options.logger.warn("[desktop-tray] failed to show current window", error);
    });
  };
  const executeTrayCommand = (command: DesktopCommandId) => {
    void Promise.resolve(options.showCurrentWindow())
      .then(() => options.executeDesktopCommand(command))
      .catch((error) => {
        options.logger.warn(`[desktop-tray] failed to execute tray command ${command}`, error);
      });
  };
  const rebuildContextMenu = () => {
    desktopTray?.setToolTip(getLabel(desktopMenuMessageIds.trayTooltip));
    desktopTray?.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: getLabel(desktopMenuMessageIds.trayOpenCf),
          click: showTrayWindow,
        },
        { type: "separator" },
        {
          label: getLabel(desktopMenuMessageIds.fileNewTask),
          click: () => executeTrayCommand(DesktopCommandIds.NewTask),
        },
        {
          label: getLabel(desktopMenuMessageIds.fileOpenWorkspace),
          click: () => executeTrayCommand(DesktopCommandIds.OpenWorkspace),
        },
        { type: "separator" },
        ...(CF_PRODUCT_FLAVOR === "production"
          ? [
              {
                label: getLabel(desktopMenuMessageIds.helpCheckForUpdates),
                click: () => executeTrayCommand(DesktopCommandIds.CheckForUpdates),
              },
            ]
          : []),
        {
          label: getLabel(desktopMenuMessageIds.helpAbout),
          click: () => executeTrayCommand(DesktopCommandIds.ShowAbout),
        },
        {
          label: getLabel(desktopMenuMessageIds.helpExportLogs),
          click: () => executeTrayCommand(DesktopCommandIds.ExportLogs),
        },
        { type: "separator" },
        {
          label: getLabel(desktopMenuMessageIds.trayQuit),
          click: () => options.quitApp(),
        },
      ]),
    );
  };

  rebuildDesktopTrayContextMenu = rebuildContextMenu;
  desktopTray.on("click", showTrayWindow);
  desktopTray.on("double-click", showTrayWindow);
  rebuildContextMenu();

  return desktopTray;
}

export function updateWindowsDesktopTrayMenu() {
  rebuildDesktopTrayContextMenu?.();
}

function loadTrayBaseImage(): NativeImage | null {
  if (trayBaseImage && !trayBaseImage.isEmpty()) {
    return trayBaseImage;
  }

  try {
    trayBaseImage = nativeImage.createFromPath(resolveDesktopTrayIconPath());
  } catch (error) {
    trayLogger?.warn("[desktop-tray] failed to load tray base image for badge", error);
    return null;
  }
  return trayBaseImage.isEmpty() ? null : trayBaseImage;
}

function composeTrayBadgeRepresentation(
  label: string,
  baseImage: NativeImage,
  scale: 1 | 2,
): Buffer | null {
  const size = TRAY_LOGICAL_SIZE * scale;
  const resized = baseImage.resize({ width: size, height: size });
  const bitmap = resized.toBitmap();
  if (bitmap.length !== size * size * 4) {
    trayLogger?.warn(
      `[desktop-tray] unexpected tray bitmap size ${bitmap.length}, skip badge compose`,
    );
    return null;
  }

  const canvas = new Uint8Array(bitmap);
  const dotSize = 5 * scale;
  const badge = renderAntialiasedStatusDotPixels({
    size: dotSize,
    centerX: 2.75 * scale,
    centerY: 2.25 * scale,
    radius: 1.875 * scale,
  });
  blendBadgeIntoBitmap({
    base: canvas,
    size,
    badge,
    badgeSize: dotSize,
    originX: size - dotSize,
    originY: 0,
  });
  return Buffer.from(canvas);
}

function composeTrayBadgeImage(label: string, baseImage: NativeImage): NativeImage | null {
  const cached = trayBadgeImageCache.get(label);
  if (cached) return cached;

  const oneX = composeTrayBadgeRepresentation(label, baseImage, 1);
  const twoX = composeTrayBadgeRepresentation(label, baseImage, 2);
  if (!oneX || !twoX) return null;

  const image = nativeImage.createEmpty();
  image.addRepresentation({
    scaleFactor: 1,
    width: 16,
    height: 16,
    buffer: oneX,
  });
  image.addRepresentation({
    scaleFactor: 2,
    width: 32,
    height: 32,
    buffer: twoX,
  });
  trayBadgeImageCache.set(label, image);
  return image;
}

export function applyDesktopTrayUnreadBadge(totalUnreadCount: number): void {
  if (!desktopTray) {
    return;
  }

  const label = resolveBadgeOverlayLabel(totalUnreadCount);
  if (!label) {
    const base = loadTrayBaseImage();
    if (base) {
      desktopTray.setImage(base);
    }
    return;
  }

  const base = loadTrayBaseImage();
  if (!base) {
    return;
  }

  const image = composeTrayBadgeImage(label, base);
  if (image) {
    desktopTray.setImage(image);
  }
}
