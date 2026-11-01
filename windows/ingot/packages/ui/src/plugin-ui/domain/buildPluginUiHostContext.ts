import type {
  McpUiAppCapabilities,
  McpUiDisplayMode,
  McpUiHostContext,
  McpUiStyles,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { McpAppsHostTitleBar, McpAppsStyleVariables } from "@origin-ai/cf-shared/mcp-apps";
import { PLUGIN_UI_CARD_MAX_HEIGHT_PX } from "../contract.js";

export interface PluginUiHostContextInput {
  theme: "light" | "dark";
  locale: string;
  displayMode: McpUiDisplayMode;
  
  width: number;
  
  maxHeight?: number;
  timeZone?: string;
  
  titleBar?: McpAppsHostTitleBar;
  
  availableDisplayModes?: readonly McpUiDisplayMode[];
  
  styleVariables?: McpAppsStyleVariables;
}

export function buildPluginUiHostContext(input: PluginUiHostContextInput): McpUiHostContext {
  return {
    theme: input.theme,
    locale: input.locale,
    displayMode: input.displayMode,
    availableDisplayModes: [...(input.availableDisplayModes ?? ["inline", "fullscreen"])],
    containerDimensions: {
      width: Math.max(0, Math.round(input.width)),
      maxHeight: input.maxHeight ?? PLUGIN_UI_CARD_MAX_HEIGHT_PX,
    },
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    platform: "desktop",
    userAgent: "cf",
    timeZone: input.timeZone ?? resolveTimeZone(),
    deviceCapabilities: { hover: true, touch: false },
    ...(input.styleVariables ? { styles: { variables: input.styleVariables as McpUiStyles } } : {}),
    ...(input.titleBar ? { titleBar: input.titleBar } : {}),
  };
}

function resolveTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function appAllowsDisplayMode(
  capabilities: McpUiAppCapabilities | undefined,
  mode: McpUiDisplayMode,
): boolean {
  const declared = capabilities?.availableDisplayModes;
  return !declared || declared.includes(mode);
}

export function resolveRequestedDisplayMode(
  requested: McpUiDisplayMode,
  current: McpUiDisplayMode,
  available: readonly McpUiDisplayMode[],
): McpUiDisplayMode {
  return requested !== "pip" && available.includes(requested) ? requested : current;
}

export function resolveSidePaneDisplayModeRequest(
  requested: McpUiDisplayMode,
  canReturnInline: boolean,
): McpUiDisplayMode {
  return requested === "inline" && canReturnInline ? "inline" : "fullscreen";
}
