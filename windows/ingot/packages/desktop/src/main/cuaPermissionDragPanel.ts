

import type { CuaPermissionKind, Locale } from "@origin-ai/cf-shared";
import { resolvePanelBounds, type PanelSize, type Rect } from "./cuaPermissionPanelPositioner.js";

export interface CuaPermissionPanelWindow {
  onceReadyToShow(callback: () => void): void;
  setBounds(bounds: Rect): void;
  showInactive(): void;
  hide(): void;
  destroy(): void;
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
}

export interface CreateCuaPermissionDragPanelOptions {
  createWindow: (initialBounds: Rect) => CuaPermissionPanelWindow;
  getDisplayWorkArea: () => Rect;
  
  getSettingsBounds?: () => Rect | null;
  
  stopSettingsBounds?: () => void;
  
  getIconDataUrl?: () => string | null;
  
  getLocale: () => Locale;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
  panelSize?: PanelSize;
  repositionIntervalMs?: number;
}

export interface CuaPermissionDragPanel {
  show(permission: CuaPermissionKind): void;
  
  freezePosition(): void;
  hide(): void;
  destroy(): void;
}

export const CUA_PERMISSION_PANEL_STATE_CHANNEL = "cf:cua-permission-panel-state";

const DEFAULT_PANEL_SIZE: PanelSize = { width: 560, height: 124 };
const DEFAULT_REPOSITION_INTERVAL_MS = 150;

export function createCuaPermissionDragPanel(
  options: CreateCuaPermissionDragPanelOptions,
): CuaPermissionDragPanel {
  const panelSize = options.panelSize ?? DEFAULT_PANEL_SIZE;
  const intervalMs = options.repositionIntervalMs ?? DEFAULT_REPOSITION_INTERVAL_MS;

  let window: CuaPermissionPanelWindow | null = null;
  let timer: NodeJS.Timeout | null = null;
  let lastBounds: Rect | null = null;
  let destroyed = false;

  function readSettingsBounds(): Rect | null {
    if (!options.getSettingsBounds) return null;
    try {
      return options.getSettingsBounds();
    } catch (error) {
      options.logger.warn(
        "[cua-permission-panel] settings bounds source failed; falling back to screen bottom",
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  function sameRect(a: Rect | null, b: Rect): boolean {
    return a !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  }

  function reposition(): void {
    if (!window || window.isDestroyed()) return;
    const bounds = resolvePanelBounds({
      settings: readSettingsBounds(),
      display: options.getDisplayWorkArea(),
      panel: panelSize,
    });
    if (sameRect(lastBounds, bounds)) return;
    lastBounds = bounds;
    window.setBounds(bounds);
  }

  function startTracking(): void {
    if (timer) return;
    timer = setInterval(reposition, intervalMs);
    timer.unref?.();
  }

  function stopTracking(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return {
    show(permission: CuaPermissionKind): void {
      if (destroyed) destroyed = false;
      const initialBounds = resolvePanelBounds({
        settings: readSettingsBounds(),
        display: options.getDisplayWorkArea(),
        panel: panelSize,
      });
      lastBounds = initialBounds;

      if (!window || window.isDestroyed()) {
        window = options.createWindow(initialBounds);
        window.onceReadyToShow(() => {
          if (!window || window.isDestroyed()) return;
          window.setBounds(lastBounds ?? initialBounds);
          window.send(CUA_PERMISSION_PANEL_STATE_CHANNEL, {
            permission,
            locale: options.getLocale(),
            iconDataUrl: options.getIconDataUrl?.() ?? null,
          });
          window.showInactive();
          startTracking();
        });
        return;
      }

      window.setBounds(initialBounds);
      window.send(CUA_PERMISSION_PANEL_STATE_CHANNEL, {
        permission,
        locale: options.getLocale(),
        iconDataUrl: options.getIconDataUrl?.() ?? null,
      });
      window.showInactive();
      startTracking();
    },

    hide(): void {
      stopTracking();
      if (window && !window.isDestroyed()) window.hide();
    },

    freezePosition(): void {
      stopTracking();
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stopTracking();
      if (window && !window.isDestroyed()) window.destroy();
      window = null;
      lastBounds = null;
      options.stopSettingsBounds?.();
    },
  };
}

export function createRealCuaPermissionPanelWindow(deps: {
  BrowserWindow: typeof import("electron").BrowserWindow;
  app: Pick<typeof import("electron").app, "isPackaged">;
  preloadPath: string;
  rendererDir: string;
  rendererDevUrl?: string | undefined;
}): (initialBounds: Rect) => CuaPermissionPanelWindow {
  return (initialBounds: Rect) => {
    const win = new deps.BrowserWindow({
      ...initialBounds,
      type: "panel",
      frame: false,
      transparent: true,
      hasShadow: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    if (!deps.app.isPackaged && deps.rendererDevUrl) {
      void win.loadURL(`${deps.rendererDevUrl}/cua-permission-panel.html`);
    } else {
      void win.loadFile(`${deps.rendererDir}/cua-permission-panel.html`);
    }

    return {
      onceReadyToShow(callback: () => void) {
        win.once("ready-to-show", callback);
      },
      setBounds(bounds: Rect) {
        win.setBounds(bounds);
      },
      showInactive() {
        win.showInactive();
        win.setAlwaysOnTop(true, "screen-saver");
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      },
      hide() {
        win.hide();
      },
      destroy() {
        win.destroy();
      },
      isDestroyed: () => win.isDestroyed(),
      send(channel: string, payload: unknown) {
        if (!win.isDestroyed()) win.webContents.send(channel, payload);
      },
    };
  };
}
