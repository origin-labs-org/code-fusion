import type { ConfigResult } from "@origin-ai/cf-adapters/config";
import type { PluginLoadOutcome } from "@origin-ai/cf-contracts";
import { CF_OFFICIAL_PLUGIN_MARKETPLACE } from "@origin-ai/cf-contracts";
import {
  listCfPlugins,
  setCfPluginEnabled,
  uninstallCfMarketplacePlugin,
} from "../plugins.js";
import type {
  CfApp,
  CfAppOptions,
  CfPluginSetResult,
  CfPluginUninstallResult,
} from "./types.js";

type PluginFacade = Pick<
  CfApp,
  "listPlugins" | "setPluginEnabled" | "uninstallPlugin"
>;

interface CreatePluginFacadeOptions {
  configResult: ConfigResult;
  env?: NodeJS.ProcessEnv;
  officialPluginRoots?: string[];
  pluginStorageRoot?: string;
  workingDirectory: string;
}

function createPluginFacade(options: CreatePluginFacadeOptions): PluginFacade {
  let enabledPlugins = { ...options.configResult.config.plugins.enabledPlugins };
  let suppressedBuiltins = [...options.configResult.config.plugins.suppressedBuiltins];
  const commonOptions = () => ({
    configResult: currentConfigResult(options.configResult, enabledPlugins, suppressedBuiltins),
    env: options.env,
    officialPluginRoots: options.officialPluginRoots,
    pluginStorageRoot: options.pluginStorageRoot,
    workingDirectory: options.workingDirectory,
  });

  return {
    listPlugins: async (): Promise<PluginLoadOutcome> => listCfPlugins(commonOptions()),
    setPluginEnabled: async (
      plugin: string,
      enabled: boolean,
    ): Promise<CfPluginSetResult> => {
      const result = await setCfPluginEnabled({
        ...commonOptions(),
        enabled,
        plugin,
      });
      enabledPlugins = {
        ...enabledPlugins,
        [result.plugin.id]: result.enabled,
      };
      return result;
    },
    uninstallPlugin: async (plugin: string): Promise<CfPluginUninstallResult> => {
      const removed = await uninstallCfMarketplacePlugin({
        ...commonOptions(),
        pluginId: plugin,
      });
      if (removed) {
        const next = { ...enabledPlugins };
        delete next[removed.id];
        enabledPlugins = next;
        if (removed.marketplace === CF_OFFICIAL_PLUGIN_MARKETPLACE) {
          if (!suppressedBuiltins.includes(removed.id)) {
            suppressedBuiltins = [...suppressedBuiltins, removed.id];
          }
        }
      }
      return { removed };
    },
  };
}

export function createPluginFacadeForApp(input: {
  configResult: ConfigResult;
  options: CfAppOptions;
  workingDirectory: string;
}): PluginFacade {
  return createPluginFacade({
    configResult: input.configResult,
    env: input.options.env,
    officialPluginRoots: input.options.officialPluginRoots,
    pluginStorageRoot: input.options.pluginStorageRoot,
    workingDirectory: input.workingDirectory,
  });
}

function currentConfigResult(
  configResult: ConfigResult,
  enabledPlugins: Record<string, boolean>,
  suppressedBuiltins: string[],
): ConfigResult {
  return {
    ...configResult,
    config: {
      ...configResult.config,
      plugins: {
        ...configResult.config.plugins,
        enabledPlugins,
        suppressedBuiltins,
      },
    },
  };
}
