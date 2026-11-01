import { join } from "node:path";
import type { AgentRuntimeConfig } from "@origin-ai/cf-core";
import type { PluginLoadOutcome } from "@origin-ai/cf-contracts";
import {
  OFFICIAL_BROWSER_USE_PLUGIN_ID,
  OFFICIAL_CUA_PLUGIN_ID,
} from "./official-plugin-definitions.js";

export type RuntimeFeaturesConfig = NonNullable<AgentRuntimeConfig["runtimeFeatures"]>;

export function resolvePluginRuntimeFeatures(
  pluginOutcome: Pick<PluginLoadOutcome, "plugins">,
): RuntimeFeaturesConfig {
  const browserUsePlugin = pluginOutcome.plugins.find(
    (plugin) => plugin.id === OFFICIAL_BROWSER_USE_PLUGIN_ID && plugin.enabled,
  );
  const cuaPlugin = pluginOutcome.plugins.find(
    (plugin) => plugin.id === OFFICIAL_CUA_PLUGIN_ID && plugin.enabled,
  );
  if (!browserUsePlugin && !cuaPlugin) {
    return {};
  }
  return {
    ...(browserUsePlugin ? { browserUse: true } : {}),
    ...(browserUsePlugin
      ? { browserDocumentationRoot: join(browserUsePlugin.rootPath, "docs") }
      : {}),
    ...(cuaPlugin ? { computerUse: true } : {}),
  };
}
