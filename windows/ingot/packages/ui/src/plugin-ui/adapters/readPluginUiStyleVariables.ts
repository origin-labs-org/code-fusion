import type { McpAppsStyleVariables } from "@origin-ai/cf-shared/mcp-apps";
import { buildPluginUiStyleVariables } from "../domain/pluginUiStyleVariables.js";

export function readPluginUiStyleVariables(): McpAppsStyleVariables {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") {
    return buildPluginUiStyleVariables(() => undefined);
  }
  const style = getComputedStyle(document.documentElement);
  return buildPluginUiStyleVariables((token) => style.getPropertyValue(token));
}
