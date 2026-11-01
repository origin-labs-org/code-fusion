import type { ConfigResult } from "@origin-ai/cf-adapters/config";
import { discoverNodePluginsSync } from "@origin-ai/cf-adapters/plugins";
import type { AgentRuntimeConfig } from "@origin-ai/cf-core";
import type { Logger, McpServerConfig, PluginLoadOutcome } from "@origin-ai/cf-contracts";
import type { StartupTimer } from "../startup-logging.js";
import { resolveOfficialPluginRoots } from "./bundled-plugins.js";
import { DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS } from "./official-plugin-definitions.js";
import { getPluginStorageRoot } from "./paths.js";
import type { CfAppOptions } from "./types.js";
import { filterVisualizeSkillRoots } from "./visualize-skill-gate.js";

export function resolveStartupPlugins(input: {
  cliStorageRoot: string;
  configResult: ConfigResult;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
  options: Pick<CfAppOptions, "officialPluginRoots" | "pluginStorageRoot" | "includeVisualize">;
  startupTimer: StartupTimer;
  workingDirectory: string;
}): PluginLoadOutcome {
  const pluginStorageRoot =
    input.options.pluginStorageRoot ?? getPluginStorageRoot(input.cliStorageRoot);
  const pluginOutcome = discoverNodePluginsSync({
    config: input.configResult.config.plugins,
    env: input.env ?? process.env,
    officialPluginRoots: resolveOfficialPluginRoots({
      extraRoots: input.options.officialPluginRoots,
      logger: input.logger,
      storageRoot: pluginStorageRoot,
      suppressedBuiltins: new Set(input.configResult.config.plugins.suppressedBuiltins),
    }),
    officialPluginsEnabledByDefault: DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS,
    storageRoot: pluginStorageRoot,
    workingDirectory: input.workingDirectory,
  });
  pluginOutcome.skillRoots = filterVisualizeSkillRoots(
    pluginOutcome.skillRoots,
    input.options.includeVisualize,
  );
  input.startupTimer.mark("CodeFusion plugins resolved", {
    context: {
      commandRootCount: pluginOutcome.commandRoots.length,
      diagnosticCount: pluginOutcome.diagnostics.length,
      enabledPluginCount: pluginOutcome.plugins.filter((plugin) => plugin.enabled).length,
      hookCount: Object.values(pluginOutcome.hooks ?? {}).reduce(
        (sum, matchers) =>
          sum + (matchers ?? []).reduce((inner, matcher) => inner + matcher.hooks.length, 0),
        0,
      ),
      mcpServerCount: Object.keys(pluginOutcome.mcpServers).length,
      pluginCount: pluginOutcome.plugins.length,
      pluginStorageRoot,
      skillRootCount: pluginOutcome.skillRoots.length,
    },
    event: "bootstrap.app.startup.plugins.completed",
    stage: "resolve_plugins",
  });
  return pluginOutcome;
}

export function startAppStartup(input: {
  hasInjectedModelAdapter: boolean;
  resume: boolean;
  startupTimer: StartupTimer;
}): void {
  input.startupTimer.start("CodeFusion app startup started", {
    context: {
      hasInjectedModelAdapter: input.hasInjectedModelAdapter,
      resume: input.resume,
    },
    event: "bootstrap.app.startup.started",
    stage: "start",
  });
}

export function markConfigurationLoaded(input: {
  configResult: ConfigResult;
  startupTimer: StartupTimer;
}): void {
  input.startupTimer.mark("CodeFusion app configuration loaded", {
    context: {
      configSourceEnv: input.configResult.sources.env,
      configSourceProject: input.configResult.sources.project.loaded,
      configSourceUser: input.configResult.sources.user.loaded,
    },
    event: "bootstrap.app.startup.config.completed",
    stage: "load_config",
  });
}

export function markStorageAdaptersInitialized(input: {
  cliStorageRoot: string;
  hasInjectedArtifactStore: boolean;
  hasInjectedSessionStore: boolean;
  startupTimer: StartupTimer;
  storageRoot: string;
}): void {
  input.startupTimer.mark("CodeFusion storage adapters initialized", {
    context: {
      hasInjectedArtifactStore: input.hasInjectedArtifactStore,
      hasInjectedSessionStore: input.hasInjectedSessionStore,
      cliStorageRoot: input.cliStorageRoot,
      storageRoot: input.storageRoot,
    },
    event: "bootstrap.app.startup.storage.completed",
    stage: "initialize_storage",
  });
}

export function markMcpAdapterInitialized(input: {
  configuredMcpServers: Record<string, McpServerConfig>;
  hasInjectedMcpPort: boolean;
  mcpEnabled: boolean;
  startupTimer: StartupTimer;
  trustedMcpServerCount: number;
}): void {
  input.startupTimer.mark("CodeFusion MCP adapter initialized", {
    context: {
      hasInjectedMcpPort: input.hasInjectedMcpPort,
      mcpEnabled: input.mcpEnabled,
      mcpServerCount: Object.keys(input.configuredMcpServers).length,
      trustedMcpServerCount: input.trustedMcpServerCount,
    },
    event: "bootstrap.app.startup.mcp.completed",
    stage: "initialize_mcp",
  });
}

export function markRuntimeConstructed(input: {
  hasInjectedModelAdapter: boolean;
  sessionId: string;
  startupTimer: StartupTimer;
}): void {
  input.startupTimer.mark("CodeFusion runtime constructed", {
    context: {
      hasInjectedModelAdapter: input.hasInjectedModelAdapter,
      sessionId: input.sessionId,
    },
    event: "bootstrap.app.startup.runtime.completed",
    stage: "create_runtime",
  });
}

export function completeAppStartup(input: {
  sessionId: string;
  startupTimer: StartupTimer;
  workingDirectory: string;
}): void {
  input.startupTimer.complete("CodeFusion app startup completed", {
    context: {
      sessionId: input.sessionId,
      workingDirectory: input.workingDirectory,
    },
    event: "bootstrap.app.startup.completed",
    stage: "total",
  });
}

export function debugRuntimeConfigResolved(input: {
  configResult: ConfigResult;
  logger: Logger;
  runtimeConfig: AgentRuntimeConfig;
}): void {
  input.logger.debug("Runtime config resolved", {
    mode: input.runtimeConfig.mode,
    module: "bootstrap",
    permissionAllowedToolCount: input.configResult.config.permission.allowedTools.length,
    permissionDisallowedToolCount: input.configResult.config.permission.disallowedTools.length,
    permissionSourceEnv: input.configResult.sources.env,
    permissionSourceUserConfig: input.configResult.sources.user.loaded,
  });
}
