import {
  cfPluginsConfigureParamsSchema,
  cfPluginsResetConfigParamsSchema,
  cfPluginsInstallParamsSchema,
  cfPluginsMarketplaceAddParamsSchema,
  cfPluginsMarketplaceRemoveParamsSchema,
  cfPluginsMarketplaceUpdateParamsSchema,
  cfPluginsOverviewParamsSchema,
  cfPluginsListParamsSchema,
  cfPluginsSetEnabledParamsSchema,
  cfPluginsUninstallParamsSchema,
  cfPluginsUpdateParamsSchema,
  cfPluginsValidateParamsSchema,
  cfPluginsDescribeParamsSchema,
  cfPluginsRestoreBuiltinParamsSchema,
  type CfAvailablePluginSummary,
  type CfInstalledPluginSummary,
  type CfPluginComponentGroup,
  type CfPluginDiagnostic,
  type CfPluginInfo,
  type CfPluginMarketplaceSummary,
  type CfPluginsConfigureResult,
  type CfPluginsDescribeResult,
  type CfPluginsInstallResult,
  type CfPluginsListResult,
  type CfPluginsMarketplaceMutationResult,
  type CfPluginsOverviewResult,
  type CfPluginsRestoreBuiltinResult,
  type CfPluginsSetEnabledResult,
  type CfPluginsUninstallResult,
  type CfPluginsValidateResult,
} from "@origin-ai/cf-shared";
import type { PluginDiagnostic, PluginMetadata } from "@origin-ai/cf-contracts";
import {
  addCfPluginMarketplace,
  configureCfPlugin,
  describeCfPlugin,
  enrichCachedClaudeMarketplaceIconsForOverview,
  getCfPluginsOverview,
  installCfMarketplacePlugin,
  removeCfPluginMarketplace,
  resolveCfPlugins,
  resetCfPluginConfig,
  restoreBuiltinPlugin as restoreBuiltinPluginCore,
  setCfPluginEnabled,
  uninstallCfMarketplacePlugin,
  updateCfPluginMarketplace,
  validateCfPlugin,
} from "../plugins.js";
import { listInstalledPluginRecords } from "@origin-ai/cf-adapters/plugins";
import { withPluginStorageLock } from "../lib/plugin-storage-lock.js";
import { getCliStorageRoot, getPluginStorageRoot } from "../app/paths.js";
import { resolveOfficialPluginHostMcpServerNames } from "../app/official-plugin-definitions.js";
import { createConfig, resolvePath, type ConfigResult } from "@origin-ai/cf-adapters/config";
import { parseParams, type CfProtocolAgentServerContext } from "./server-types.js";

function toPluginInfo(plugin: PluginMetadata, configResult?: ConfigResult): CfPluginInfo {
  const hostMcpServerNames = resolveOfficialPluginHostMcpServerNames(plugin.id);
  const configuredOptions = Object.fromEntries(
    Object.entries(plugin.configuredOptions ?? {}).filter(
      ([key]) => plugin.userConfig?.[key]?.sensitive !== true,
    ),
  );
  const enabledSource = configResult?.sources.plugins.enabled[plugin.id];
  const optionSources = configResult?.sources.plugins.options[plugin.id];
  const rootSource =
    plugin.source === "inline" && configResult
      ? resolveInlinePluginRootSource(plugin.rootPath, configResult)
      : undefined;
  return {
    id: plugin.id,
    name: plugin.name,
    ...(plugin.description !== undefined ? { description: plugin.description } : {}),
    ...(plugin.version !== undefined ? { version: plugin.version } : {}),
    enabled: plugin.enabled,
    source: plugin.source,
    marketplace: plugin.marketplace,
    ...(plugin.author !== undefined ? { author: plugin.author } : {}),
    ...(plugin.authorUrl !== undefined ? { authorUrl: plugin.authorUrl } : {}),
    ...(plugin.homepage !== undefined ? { homepage: plugin.homepage } : {}),
    skillCount: plugin.skillCount,
    skillRootCount: plugin.skillRootCount,
    commandRootCount: plugin.commandRootCount,
    components: plugin.components.map((group) => ({
      kind: group.kind,
      items: group.items.map((item) => ({
        name: item.name,
        ...(item.description ? { description: item.description } : {}),
      })),
    })),
    declaredMcpServerNames: plugin.declaredMcpServerNames,
    ...(plugin.uiSurfaces?.length ? { uiSurfaces: plugin.uiSurfaces.map((surface) => ({
      pluginId: plugin.id, pluginName: plugin.name, id: surface.id, title: surface.title,
      ...(surface.icon ? { icon: surface.icon } : {}), server: surface.server,
      resourceUri: surface.resourceUri, availability: surface.availability,
    })) } : {}),
    mcpServerNames: plugin.mcpServerNames,
    ...(hostMcpServerNames.length > 0 ? { hostMcpServerNames } : {}),
    hookDetails: plugin.hookDetails,
    rootPath: plugin.rootPath,
    ...(plugin.userConfig ? { userConfig: plugin.userConfig } : {}),
    ...(Object.keys(configuredOptions).length > 0 ? { configuredOptions } : {}),
    ...(rootSource ? { rootSource } : {}),
    ...(enabledSource ? { enabledSource } : {}),
    ...(optionSources && Object.keys(optionSources).length > 0 ? { optionSources } : {}),
  };
}

function resolveInlinePluginRootSource(
  pluginRootPath: string,
  configResult: ConfigResult,
): "user" | "workspace" | undefined {
  const resolvedPluginRoot = normalizePluginRootForComparison(pluginRootPath);
  if (
    configResult.sources.plugins.dirs.workspace.some(
      (rootPath) => normalizePluginRootForComparison(rootPath) === resolvedPluginRoot,
    )
  ) {
    return "workspace";
  }
  if (
    configResult.sources.plugins.dirs.user.some(
      (rootPath) => normalizePluginRootForComparison(rootPath) === resolvedPluginRoot,
    )
  ) {
    return "user";
  }
  return undefined;
}

function createPluginConfigView(
  context: CfProtocolAgentServerContext,
  workspacePath: string,
  configScope: "user" | "workspace" | undefined,
): ConfigResult {
  return createConfig({
    env: context.deps?.env,
    ...(configScope === "user" ? {} : { workingDirectory: workspacePath }),
  });
}

function createMissingConfiguredPluginInfos(
  configResult: ConfigResult,
  discoveredPluginIds: ReadonlySet<string>,
): CfPluginInfo[] {
  const configuredPluginIds = new Set([
    ...Object.keys(configResult.config.plugins.enabledPlugins),
    ...Object.keys(configResult.config.plugins.options),
  ]);
  return [...configuredPluginIds].flatMap((pluginId) => {
    if (discoveredPluginIds.has(pluginId)) return [];
    const separatorIndex = pluginId.lastIndexOf("@");
    if (separatorIndex <= 0 || separatorIndex === pluginId.length - 1) {
      return [];
    }
    const enabledSource = configResult.sources.plugins.enabled[pluginId];
    const optionSources = configResult.sources.plugins.options[pluginId];
    return [
      {
        id: pluginId,
        name: pluginId.slice(0, separatorIndex),
        enabled: configResult.config.plugins.enabledPlugins[pluginId] ?? false,
        source: "missing",
        marketplace: pluginId.slice(separatorIndex + 1),
        skillCount: 0,
        skillRootCount: 0,
        commandRootCount: 0,
        components: [],
        declaredMcpServerNames: [],
        mcpServerNames: [],
        rootPath: "",
        packageStatus: "missing",
        ...(enabledSource ? { enabledSource } : {}),
        ...(optionSources && Object.keys(optionSources).length > 0
          ? { optionSources }
          : {}),
      },
    ];
  });
}

export function normalizePluginRootForComparison(
  rootPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const resolvedRoot = resolvePath(rootPath);
  return platform === "win32"
    ? resolvedRoot.replaceAll("\\", "/").toLowerCase()
    : resolvedRoot;
}

function toPluginDiagnostic(diagnostic: PluginDiagnostic): CfPluginDiagnostic {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    severity: diagnostic.severity,
    ...(diagnostic.pluginId !== undefined ? { pluginId: diagnostic.pluginId } : {}),
  };
}

export async function listPlugins(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfPluginsListResult> {
  const params = parseParams(cfPluginsListParamsSchema, rawParams);
  const configResult = createPluginConfigView(
    context,
    params.workspace.workspacePath,
    params.configScope,
  );
  const outcome = resolveCfPlugins({
    configResult,
    logger: context.logger,
    workingDirectory: params.workspace.workspacePath,
  });
  const plugins = outcome.plugins.map((plugin) =>
    toPluginInfo(plugin, configResult),
  );
  return {
    plugins: [
      ...plugins,
      ...createMissingConfiguredPluginInfos(
        configResult,
        new Set(plugins.map((plugin) => plugin.id)),
      ),
    ],
    diagnostics: outcome.diagnostics.map(toPluginDiagnostic),
  };
}

export async function setPluginEnabled(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
  abortSignal?: AbortSignal,
): Promise<CfPluginsSetEnabledResult> {
  const params = parseParams(cfPluginsSetEnabledParamsSchema, rawParams);
  abortSignal?.throwIfAborted();
  const result = await setCfPluginEnabled({
    enabled: params.enabled,
    logger: context.logger,
    plugin: params.pluginId,
    scope: params.scope,
    workingDirectory: params.workspace.workspacePath,
  });
  abortSignal?.throwIfAborted();
  return {
    plugin: {
      ...toPluginInfo(result.plugin),
      enabledSource: params.scope ?? "user",
    },
    enabled: result.enabled,
  };
}

export async function getPluginsOverview(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfPluginsOverviewResult> {
  const params = parseParams(cfPluginsOverviewParamsSchema, rawParams);
  enrichCachedClaudeMarketplaceIconsForOverview({
    logger: context.logger,
    workingDirectory: params.workspace.workspacePath,
  });
  const overview = getCfPluginsOverview({
    configResult: createPluginConfigView(
      context,
      params.workspace.workspacePath,
      params.configScope,
    ),
    logger: context.logger,
    workingDirectory: params.workspace.workspacePath,
  });
  return {
    marketplaces: overview.marketplaces.map(toMarketplaceSummary),
    availablePlugins: overview.availablePlugins.map(toAvailablePluginSummary),
    installedPlugins: overview.installedPlugins.map(toInstalledPluginSummary),
    restorableBuiltins: overview.restorableBuiltins.map(toAvailablePluginSummary),
    diagnostics: overview.diagnostics.map(toPluginDiagnostic),
    capability: { supported: true },
  };
}

export async function addPluginMarketplace(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
  abortSignal?: AbortSignal,
): Promise<CfPluginsMarketplaceMutationResult> {
  const params = parseParams(cfPluginsMarketplaceAddParamsSchema, rawParams);
  const pluginStorageRoot = resolvePluginStorageRoot(params.workspace.workspacePath);
  const marketplace = await withPluginStorageLock(pluginStorageRoot, async () =>
    addCfPluginMarketplace({
      abortSignal,
      dryRun: params.dryRun,
      logger: context.logger,
      source: params.source,
      workingDirectory: params.workspace.workspacePath,
    }),
  );
  return { marketplace: toMarketplaceSummary(marketplace), diagnostics: [] };
}

export async function removePluginMarketplace(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfPluginsMarketplaceMutationResult> {
  const params = parseParams(cfPluginsMarketplaceRemoveParamsSchema, rawParams);
  const pluginStorageRoot = resolvePluginStorageRoot(params.workspace.workspacePath);
  await withPluginStorageLock(pluginStorageRoot, async () =>
    removeCfPluginMarketplace({
      logger: context.logger,
      marketplace: params.marketplace,
      workingDirectory: params.workspace.workspacePath,
    }),
  );
  return { diagnostics: [] };
}

export async function updatePluginMarketplace(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
  abortSignal?: AbortSignal,
): Promise<CfPluginsMarketplaceMutationResult> {
  const params = parseParams(cfPluginsMarketplaceUpdateParamsSchema, rawParams);
  const pluginStorageRoot = resolvePluginStorageRoot(params.workspace.workspacePath);
  const result = await withPluginStorageLock(pluginStorageRoot, async () =>
    updateCfPluginMarketplace({
      abortSignal,
      logger: context.logger,
      marketplace: params.marketplace,
      workingDirectory: params.workspace.workspacePath,
    }),
  );
  return {
    marketplaces: result.marketplaces.map(toMarketplaceSummary),
    diagnostics: result.diagnostics.map(toPluginDiagnostic),
  };
}

export async function installPlugin(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
  abortSignal?: AbortSignal,
): Promise<CfPluginsInstallResult> {
  const params = parseParams(cfPluginsInstallParamsSchema, rawParams);
  const pluginStorageRoot = resolvePluginStorageRoot(params.workspace.workspacePath);
  const result = await withPluginStorageLock(pluginStorageRoot, async () =>
    installCfMarketplacePlugin({
      abortSignal,
      dryRun: params.dryRun,
      logger: context.logger,
      marketplace: params.marketplace,
      pluginName: params.pluginName,
      scope: params.scope,
      workingDirectory: params.workspace.workspacePath,
    }),
  );
  return {
    dependencyClosure: result.dependencyClosure,
    installedPlugins: result.installedPlugins.map(toInstalledPluginSummary),
    diagnostics: result.diagnostics.map(toPluginDiagnostic),
  };
}

export async function uninstallPlugin(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfPluginsUninstallResult> {
  const params = parseParams(cfPluginsUninstallParamsSchema, rawParams);
  const removed = await uninstallCfMarketplacePlugin({
    logger: context.logger,
    marketplace: params.marketplace,
    pluginId: params.pluginId,
    pluginName: params.pluginName,
    removeCache: params.removeCache,
    workingDirectory: params.workspace.workspacePath,
  });
  return {
    ...(removed ? { removedPlugin: toInstalledPluginSummary(removed) } : {}),
    diagnostics: [],
  };
}

export async function updatePlugin(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfPluginsInstallResult> {
  const params = parseParams(cfPluginsUpdateParamsSchema, rawParams);
  const pluginStorageRoot = resolvePluginStorageRoot(params.workspace.workspacePath);
  const installed = listInstalledPluginRecords(pluginStorageRoot).filter((record) => {
    if (params.pluginId) return record.id === params.pluginId;
    if (params.marketplace) return record.marketplace === params.marketplace;
    return true;
  });
  return withPluginStorageLock(pluginStorageRoot, async () => {
    const installedPlugins: CfInstalledPluginSummary[] = [];
    const dependencyClosure: string[] = [];
    const diagnostics: CfPluginDiagnostic[] = [];
    for (const record of installed) {
      const result = await installCfMarketplacePlugin({
        logger: context.logger,
        marketplace: record.marketplace,
        pluginName: record.name,
        scope: record.scope,
        workingDirectory: params.workspace.workspacePath,
      });
      installedPlugins.push(...result.installedPlugins.map(toInstalledPluginSummary));
      dependencyClosure.push(...result.dependencyClosure);
      diagnostics.push(...result.diagnostics.map(toPluginDiagnostic));
    }
    return { dependencyClosure, installedPlugins, diagnostics };
  });
}

export async function restoreBuiltinPlugin(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfPluginsRestoreBuiltinResult> {
  const params = parseParams(cfPluginsRestoreBuiltinParamsSchema, rawParams);
  await restoreBuiltinPluginCore({
    logger: context.logger,
    pluginId: params.pluginId,
    workingDirectory: params.workspace.workspacePath,
  });
  return { pluginId: params.pluginId, diagnostics: [] };
}

export async function configurePlugin(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfPluginsConfigureResult> {
  const params = parseParams(cfPluginsConfigureParamsSchema, rawParams);
  await configureCfPlugin({
    clearOptionKeys: params.clearOptionKeys,
    dryRun: params.dryRun,
    logger: context.logger,
    options: params.options,
    pluginId: params.pluginId,
    scope: params.scope,
    workingDirectory: params.workspace.workspacePath,
  });
  return { pluginId: params.pluginId, diagnostics: [] };
}

export async function resetPluginConfig(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfPluginsConfigureResult> {
  const params = parseParams(cfPluginsResetConfigParamsSchema, rawParams);
  await resetCfPluginConfig({
    logger: context.logger,
    pluginId: params.pluginId,
    scope: params.scope,
    workingDirectory: params.workspace.workspacePath,
  });
  return { pluginId: params.pluginId, diagnostics: [] };
}

export async function validatePlugin(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfPluginsValidateResult> {
  const params = parseParams(cfPluginsValidateParamsSchema, rawParams);
  const pluginStorageRoot = resolvePluginStorageRoot(params.workspace.workspacePath);
  const diagnostics = await withPluginStorageLock(pluginStorageRoot, async () =>
    validateCfPlugin({
      logger: context.logger,
      marketplace: params.marketplace,
      pluginName: params.pluginName,
      source: params.source,
      workingDirectory: params.workspace.workspacePath,
    }),
  );
  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    diagnostics: diagnostics.map(toPluginDiagnostic),
    compatibility: {
      runnable: ["skills", "commands", "hooks", "mcpServers", "userConfig"],
      diagnosticOnly: ["agents", "lspServers", "outputStyles", "channels", "settings"],
      unsupported: ["mcpb", "dxt", "npm", "hostPattern", "pathPattern"],
    },
  };
}

export async function describePlugin(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfPluginsDescribeResult> {
  const params = parseParams(cfPluginsDescribeParamsSchema, rawParams);
  const pluginStorageRoot = resolvePluginStorageRoot(params.workspace.workspacePath);
  const result = await describeCfPlugin({
    logger: context.logger,
    marketplace: params.marketplace,
    pluginName: params.pluginName,
    withWriteLock: (write) => withPluginStorageLock(pluginStorageRoot, write),
    workingDirectory: params.workspace.workspacePath,
  });
  const components: CfPluginComponentGroup[] = result.components.map((group) => ({
    kind: group.kind,
    items: group.items.map((item) => ({
      name: item.name,
      ...(item.description ? { description: item.description } : {}),
    })),
  }));
  const diagnostics = result.diagnostics.map(toPluginDiagnostic);
  return {
    components,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    ...(result.metadata ? { metadata: result.metadata } : {}),
  };
}

function toMarketplaceSummary(input: {
  id: string;
  name: string;
  source: Record<string, unknown>;
  description?: string;
  lastUpdated?: string;
  pluginCount: number;
  isOfficial?: boolean;
  featured?: string[];
  refreshFailure?: CfPluginMarketplaceSummary["refreshFailure"];
}): CfPluginMarketplaceSummary {
  return {
    id: input.id,
    name: input.name,
    source: input.source,
    ...(input.description ? { description: input.description } : {}),
    ...(input.lastUpdated ? { lastUpdated: input.lastUpdated } : {}),
    pluginCount: input.pluginCount,
    ...(input.isOfficial !== undefined ? { isOfficial: input.isOfficial } : {}),
    ...(input.featured ? { featured: input.featured } : {}),
    ...(input.refreshFailure ? { refreshFailure: input.refreshFailure } : {}),
  };
}

function toAvailablePluginSummary(input: {
  id: string;
  name: string;
  marketplace: string;
  description?: string;
  version?: string;
  installed: boolean;
  componentTypes?: string[];
  listing?: CfAvailablePluginSummary["listing"];
}): CfAvailablePluginSummary {
  return {
    id: input.id,
    name: input.name,
    marketplace: input.marketplace,
    ...(input.description ? { description: input.description } : {}),
    ...(input.version ? { version: input.version } : {}),
    installed: input.installed,
    ...(input.componentTypes ? { componentTypes: input.componentTypes } : {}),
    ...(input.listing ? { listing: input.listing } : {}),
  };
}

function toInstalledPluginSummary(input: {
  id: string;
  name: string;
  marketplace: string;
  description?: string;
  version?: string;
  enabled: boolean;
  scope: "user" | "workspace";
  installPath?: string;
  installedAt?: string;
  componentTypes?: string[];
  hookDetails?: CfInstalledPluginSummary["hookDetails"];
  updateStatus?: "none" | "update-available" | "version-changed";
  latestVersion?: string;
  listing?: CfInstalledPluginSummary["listing"];
}): CfInstalledPluginSummary {
  return {
    id: input.id,
    name: input.name,
    marketplace: input.marketplace,
    ...(input.description ? { description: input.description } : {}),
    ...(input.version ? { version: input.version } : {}),
    enabled: input.enabled,
    scope: input.scope,
    ...(input.installPath ? { installPath: input.installPath } : {}),
    ...(input.installedAt ? { installedAt: input.installedAt } : {}),
    ...(input.componentTypes ? { componentTypes: input.componentTypes } : {}),
    ...(input.hookDetails ? { hookDetails: input.hookDetails } : {}),
    ...(input.updateStatus ? { updateStatus: input.updateStatus } : {}),
    ...(input.latestVersion ? { latestVersion: input.latestVersion } : {}),
    ...(input.listing ? { listing: input.listing } : {}),
  };
}

function resolvePluginStorageRoot(workingDirectory: string): string {
  const config = createConfig({ workingDirectory });
  const storageRoot = resolvePath(config.config.storage.dir);
  return getPluginStorageRoot(getCliStorageRoot(storageRoot));
}
