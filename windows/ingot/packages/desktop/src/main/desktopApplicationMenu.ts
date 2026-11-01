import { app, BrowserWindow, Menu } from "electron";
import {
  DesktopCommandIds,
  desktopMenuMessageIds,
  getDesktopMenuMessage,
  isValidShortcutBinding,
  CF_ENV,
  CF_PRODUCT_FLAVOR,
  type DesktopCommandId,
  type Locale,
} from "@origin-ai/cf-shared";
import { readCfStdioTapDevState } from "@origin-ai/cf-services/node";
import { CHECK_FOR_UPDATE_MENU_ID, setAutoUpdaterMenuLocale } from "./autoUpdater.js";
import {
  DESKTOP_ZOOM_MAX_LEVEL,
  DESKTOP_ZOOM_MIN_LEVEL,
  clampDesktopZoomLevel,
} from "./desktopZoom.js";
import {
  HELP_TOGGLE_CF_STDIO_TAP_MENU_ID,
  HELP_TOGGLE_DEV_TOOLS_MENU_ID,
} from "./desktopCommandHandlers.js";

export const HELP_CF_ENDPOINT_PRODUCTION_MENU_ID = "help.cf-endpoint.production";
export const HELP_CF_ENDPOINT_TEST_MENU_ID = "help.cf-endpoint.test";

export function getDesktopMenuLabel(
  locale: Locale,
  id: (typeof desktopMenuMessageIds)[keyof typeof desktopMenuMessageIds],
) {
  return getDesktopMenuMessage(locale, id);
}

export function resolveSystemApplicationLocale(): Locale {
  const systemLocale = app.getPreferredSystemLanguages?.()[0] ?? app.getLocale();
  return systemLocale.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function updateCfStdioTapDevMenuState() {
  const menu = Menu.getApplicationMenu();
  const item = menu?.getMenuItemById(HELP_TOGGLE_CF_STDIO_TAP_MENU_ID);
  if (!item) {
    return;
  }
  const state = readCfStdioTapDevState();
  item.checked = state.enabled;
  item.visible = state.visible;
}

interface ApplicationMenuShortcutOptions {
  shortcutBindings?: Record<string, string[]>;
}

function resolveMenuAccelerator(
  options: ApplicationMenuShortcutOptions & { disableShortcutAccelerators?: boolean },
  commandId: string,
  fallback: string,
): string | undefined {
  if (options.disableShortcutAccelerators) {
    return undefined;
  }
  const overrideList = options?.shortcutBindings?.[commandId];
  if (overrideList !== undefined) {
    if (overrideList.length === 0) {
      return undefined;
    }
    return overrideList.find((binding) => isValidShortcutBinding(binding)) ?? fallback;
  }
  return fallback;
}

function buildApplicationMenuTemplate(options: {
  currentApplicationLocale: Locale;
  cfEndpointSelection?: "production" | "test" | "custom";
  executeDesktopCommand: (
    command: DesktopCommandId,
    senderWindow?: BrowserWindow | null,
  ) => Promise<unknown>;
  currentZoomLevel?: number;
  shortcutBindings?: Record<string, string[]>;
  
  disableShortcutAccelerators?: boolean;
}): Electron.MenuItemConstructorOptions[] {
  const getLabel = (id: (typeof desktopMenuMessageIds)[keyof typeof desktopMenuMessageIds]) =>
    getDesktopMenuLabel(options.currentApplicationLocale, id);
  const getAppLabel = (id: (typeof desktopMenuMessageIds)[keyof typeof desktopMenuMessageIds]) =>
    getLabel(id).replaceAll("{appName}", app.name);
  const stdioTapState = readCfStdioTapDevState();
  const isLocalDevelopmentRuntime = !app.isPackaged;
  const currentZoomLevel = clampDesktopZoomLevel(options.currentZoomLevel ?? 0);
  const canResetZoom = currentZoomLevel !== 0;
  const canZoomIn = currentZoomLevel < DESKTOP_ZOOM_MAX_LEVEL;
  const canZoomOut = currentZoomLevel > DESKTOP_ZOOM_MIN_LEVEL;
  const zoomInBinding = resolveMenuAccelerator(options, "zoomIn", "CmdOrCtrl+=");
  const zoomInVisibleAccelerator = zoomInBinding?.replace("=", "Plus");

  return [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              {
                label: getLabel(desktopMenuMessageIds.helpAbout),
                click: () => void options.executeDesktopCommand(DesktopCommandIds.ShowAbout),
              },
              ...(CF_PRODUCT_FLAVOR === "production"
                ? [
                    {
                      id: CHECK_FOR_UPDATE_MENU_ID,
                      label: getLabel(desktopMenuMessageIds.helpCheckForUpdates),
                      click: () =>
                        void options.executeDesktopCommand(DesktopCommandIds.CheckForUpdates),
                    },
                  ]
                : []),
              { type: "separator" as const },
              {
                label: getLabel(desktopMenuMessageIds.appServices),
                role: "services" as const,
              },
              { type: "separator" as const },
              {
                label: getAppLabel(desktopMenuMessageIds.appHide),
                role: "hide" as const,
              },
              {
                label: getLabel(desktopMenuMessageIds.appHideOthers),
                role: "hideOthers" as const,
              },
              {
                label: getLabel(desktopMenuMessageIds.appShowAll),
                role: "unhide" as const,
              },
              { type: "separator" as const },
              {
                label: getAppLabel(desktopMenuMessageIds.appQuit),
                role: "quit" as const,
              },
            ],
          },
        ]
      : []),
    {
      label: getLabel(desktopMenuMessageIds.file),
      submenu: [
        {
          label: getLabel(desktopMenuMessageIds.fileNewTask),
          accelerator: resolveMenuAccelerator(options, "newTask", "CmdOrCtrl+N"),
          click: () => void options.executeDesktopCommand(DesktopCommandIds.NewTask),
        },
        {
          label: getLabel(desktopMenuMessageIds.fileOpenWorkspace),
          accelerator: resolveMenuAccelerator(options, "openWorkspace", "CmdOrCtrl+O"),
          click: () => void options.executeDesktopCommand(DesktopCommandIds.OpenWorkspace),
        },
        { type: "separator" as const },
        {
          label: getLabel(desktopMenuMessageIds.fileCloseWindow),
          accelerator: resolveMenuAccelerator(options, "closeActiveContext", "CmdOrCtrl+W"),
          click: () => void options.executeDesktopCommand(DesktopCommandIds.CloseActiveContext),
        },
      ],
    },
    {
      label: getLabel(desktopMenuMessageIds.edit),
      submenu: [
        { label: getLabel(desktopMenuMessageIds.editUndo), role: "undo" as const },
        { label: getLabel(desktopMenuMessageIds.editRedo), role: "redo" as const },
        { type: "separator" as const },
        { label: getLabel(desktopMenuMessageIds.editCut), role: "cut" as const },
        { label: getLabel(desktopMenuMessageIds.editCopy), role: "copy" as const },
        { label: getLabel(desktopMenuMessageIds.editPaste), role: "paste" as const },
        { type: "separator" as const },
        { label: getLabel(desktopMenuMessageIds.editSelectAll), role: "selectAll" as const },
      ],
    },
    {
      label: getLabel(desktopMenuMessageIds.view),
      submenu: [
        {
          label: getLabel(desktopMenuMessageIds.viewToggleFullScreen),
          role: "togglefullscreen" as const,
          click: () => void options.executeDesktopCommand(DesktopCommandIds.ToggleFullScreen),
        },
        { type: "separator" as const },
        {
          label: getLabel(desktopMenuMessageIds.viewZoomIn),
          accelerator: zoomInVisibleAccelerator,
          enabled: canZoomIn,
          click: () => void options.executeDesktopCommand(DesktopCommandIds.ZoomIn),
        },
        ...(zoomInVisibleAccelerator !== undefined && zoomInVisibleAccelerator !== zoomInBinding
          ? [
              {
                label: getLabel(desktopMenuMessageIds.viewZoomIn),
                accelerator: zoomInBinding,
                visible: false,
                enabled: canZoomIn,
                click: () => void options.executeDesktopCommand(DesktopCommandIds.ZoomIn),
              },
            ]
          : []),
        {
          label: getLabel(desktopMenuMessageIds.viewZoomOut),
          accelerator: resolveMenuAccelerator(options, "zoomOut", "CmdOrCtrl+-"),
          enabled: canZoomOut,
          click: () => void options.executeDesktopCommand(DesktopCommandIds.ZoomOut),
        },
        {
          label: getLabel(desktopMenuMessageIds.viewActualSize),
          accelerator: resolveMenuAccelerator(options, "resetZoom", "CmdOrCtrl+0"),
          enabled: canResetZoom,
          click: () => void options.executeDesktopCommand(DesktopCommandIds.ResetZoom),
        },
      ],
    },
    {
      label: getLabel(desktopMenuMessageIds.window),
      submenu: [
        { label: getLabel(desktopMenuMessageIds.windowMinimize), role: "minimize" as const },
        ...(process.platform === "darwin"
          ? [
              { label: getLabel(desktopMenuMessageIds.windowZoom), role: "zoom" as const },
              { type: "separator" as const },
              {
                label: getLabel(desktopMenuMessageIds.windowBringAllToFront),
                role: "front" as const,
              },
            ]
          : []),
      ],
    },
    {
      label: getLabel(desktopMenuMessageIds.help),
      submenu: [
        ...(process.platform !== "darwin"
          ? [
              {
                label: getLabel(desktopMenuMessageIds.helpAbout),
                click: () => void options.executeDesktopCommand(DesktopCommandIds.ShowAbout),
              },
              ...(CF_PRODUCT_FLAVOR === "production"
                ? [
                    {
                      id: CHECK_FOR_UPDATE_MENU_ID,
                      label: getLabel(desktopMenuMessageIds.helpCheckForUpdates),
                      click: () =>
                        void options.executeDesktopCommand(DesktopCommandIds.CheckForUpdates),
                    },
                  ]
                : []),
              { type: "separator" as const },
            ]
          : []),
        {
          label: getLabel(desktopMenuMessageIds.helpWhatsNew),
          click: () => void options.executeDesktopCommand(DesktopCommandIds.OpenChangelog),
        },
        { type: "separator" as const },
        ...(isLocalDevelopmentRuntime && stdioTapState.visible
          ? [
              {
                id: HELP_TOGGLE_CF_STDIO_TAP_MENU_ID,
                label: getLabel(desktopMenuMessageIds.helpToggleCfStdioTap),
                type: "checkbox" as const,
                checked: stdioTapState.enabled,
                click: () =>
                  void options.executeDesktopCommand(DesktopCommandIds.ToggleCfStdioTapDevProxy),
              },
              { type: "separator" as const },
            ]
          : []),
        ...(CF_ENV === "test"
          ? [
              {
                label: getLabel(desktopMenuMessageIds.helpCfEndpoint),
                submenu: [
                  {
                    id: HELP_CF_ENDPOINT_PRODUCTION_MENU_ID,
                    label: getLabel(desktopMenuMessageIds.helpCfEndpointProduction),
                    type: "radio" as const,
                    checked: (options.cfEndpointSelection ?? "production") === "production",
                    click: () =>
                      void options.executeDesktopCommand(
                        DesktopCommandIds.SetCfEndpointProduction,
                      ),
                  },
                  {
                    id: HELP_CF_ENDPOINT_TEST_MENU_ID,
                    label: getLabel(desktopMenuMessageIds.helpCfEndpointTest),
                    type: "radio" as const,
                    checked: options.cfEndpointSelection === "test",
                    click: () =>
                      void options.executeDesktopCommand(DesktopCommandIds.SetCfEndpointTest),
                  },
                  { type: "separator" as const },
                  {
                    label: getLabel(desktopMenuMessageIds.helpCfEndpointCustom),
                    click: () =>
                      void options.executeDesktopCommand(DesktopCommandIds.SetCfEndpointCustom),
                  },
                  {
                    label: getLabel(desktopMenuMessageIds.helpCfEndpointReset),
                    click: () =>
                      void options.executeDesktopCommand(DesktopCommandIds.ResetCfEndpoint),
                  },
                ],
              },
              { type: "separator" as const },
            ]
          : []),
        {
          id: HELP_TOGGLE_DEV_TOOLS_MENU_ID,
          label: getLabel(desktopMenuMessageIds.helpToggleDevTools),
          role: "toggleDevTools" as const,
          click: () => void options.executeDesktopCommand(DesktopCommandIds.ToggleDevTools),
        },
        { type: "separator" as const },
        {
          label: getLabel(desktopMenuMessageIds.helpResourceManager),
          click: () => void options.executeDesktopCommand(DesktopCommandIds.OpenResourceManager),
        },
        { type: "separator" as const },
        {
          label: getLabel(desktopMenuMessageIds.helpFeedback),
          click: () => void options.executeDesktopCommand(DesktopCommandIds.OpenFeedback),
        },
        {
          label: getLabel(desktopMenuMessageIds.helpExportLogs),
          click: () => void options.executeDesktopCommand(DesktopCommandIds.ExportLogs),
        },
        { type: "separator" as const },
        {
          label: getLabel(desktopMenuMessageIds.helpClearAllData),
          click: () => void options.executeDesktopCommand(DesktopCommandIds.ClearAllData),
        },
      ],
    },
  ];
}

export function rebuildApplicationMenu(options: {
  currentApplicationLocale: Locale;
  cfEndpointSelection?: "production" | "test" | "custom";
  executeDesktopCommand: (
    command: DesktopCommandId,
    senderWindow?: BrowserWindow | null,
  ) => Promise<unknown>;
  currentZoomLevel?: number;
  shortcutBindings?: Record<string, string[]>;
  
  disableShortcutAccelerators?: boolean;
}) {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildApplicationMenuTemplate({
        currentApplicationLocale: options.currentApplicationLocale,
        cfEndpointSelection: options.cfEndpointSelection,
        executeDesktopCommand: options.executeDesktopCommand,
        currentZoomLevel: options.currentZoomLevel,
        shortcutBindings: options.shortcutBindings,
        disableShortcutAccelerators: options.disableShortcutAccelerators,
      }),
    ),
  );
  setAutoUpdaterMenuLocale(options.currentApplicationLocale);
  if (!app.isPackaged) {
    updateCfStdioTapDevMenuState();
  }
}
