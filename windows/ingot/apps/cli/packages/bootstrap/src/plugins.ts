import { rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep, win32 } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  addSuppressedBuiltinInFileConfig,
  createConfig,
  resolvePath,
  enablePluginsByDefaultInFileConfig,
  removePluginEnabledFromFileConfig,
  removePluginFromFileConfig,
  removeSuppressedBuiltinInFileConfig,
  updatePluginEnabledInFileConfig,
  updatePluginOptionsInFileConfig,
  type ConfigResult,
} from "@origin-ai/cf-adapters/config";
import {
  addMarketplace,
  comparePluginUpdate,
  describeMarketplacePlugin,
  enrichCachedClaudeMarketplaceIcons,
  ensureDefaultPluginMarketplaces,
  discoverNodePluginsSync,
  ensureMarketplaceManifestAvailable,
  getPluginSourceDiagnosticCode,
  getPluginDataDir,
  installMarketplacePlugin,
  listInstalledPluginRecords,
  loadKnownMarketplacesSync,
  loadMarketplaceManifestSync,
  parseMarketplaceSourceInput,
  parseEntryStoreListing,
  readPluginSourceIdentityPin,
  removeMarketplace,
  uninstallMarketplacePlugin,
  updateMarketplace,
  validateLocalPluginPath,
  validateMarketplacePlugin,
  validateMarketplaceSource,
  type DescribeMarketplacePluginResult,
  type InstalledPluginRecord,
  type KnownMarketplaceRecord,
  type MarketplaceSource,
  type PluginMarketplaceEntry,
} from "@origin-ai/cf-adapters/plugins";
import type {
  Logger,
  PluginHookDetail,
  PluginLoadOutcome,
  PluginMetadata,
  PluginStoreListing,
} from "@origin-ai/cf-contracts";
import { CF_OFFICIAL_PLUGIN_MARKETPLACE, isOfficialMarketplaceId } from "@origin-ai/cf-contracts";
import { CF_CUA_OFFICIAL_PLUGIN_ID, isCfCuaInternalFeatureEnabled } from "@origin-ai/cf-shared";
import { resolveOfficialPluginRoots } from "./app/bundled-plugins.js";
import {
  DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS,
  OFFICIAL_NODE_REPL_HOST_PLUGIN_NAME,
  OFFICIAL_PLUGIN_DEFINITIONS,
} from "./app/official-plugin-definitions.js";
import { getCliStorageRoot, getPluginStorageRoot } from "./app/paths.js";
import { withPluginStorageLock } from "./lib/plugin-storage-lock.js";

export interface ResolveCfPluginsOptions {
  configResult?: ConfigResult;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
  officialPluginRoots?: string[];
  pluginStorageRoot?: string;
  projectConfigPath?: string;
  skipUserConfig?: boolean;
  userConfigPath?: string;
  workingDirectory?: string;
}

export interface ListCfPluginsOptions extends ResolveCfPluginsOptions {}

export interface SetCfPluginEnabledOptions extends ResolveCfPluginsOptions {
  enabled: boolean;
  plugin: string;
  scope?: "user" | "workspace";
}

export interface SetCfPluginEnabledResult {
  enabled: boolean;
  path: string;
  plugin: PluginMetadata;
}

export interface CfMarketplaceSummaryData {
  id: string;
  name: string;
  source: Record<string, unknown>;
  description?: string;
  lastUpdated?: string;
  pluginCount: number;
  isOfficial: boolean;
  refreshFailure?: {
    code: string;
    failedAt: string;
    message: string;
  };
  featured?: string[];
}

export interface CfAvailablePluginData {
  id: string;
  name: string;
  marketplace: string;
  description?: string;
  version?: string;
  installed: boolean;
  componentTypes?: string[];
  hookDetails?: PluginHookDetail[];
  listing?: PluginStoreListing;
}

export interface CfInstalledPluginData {
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
  hookDetails?: PluginHookDetail[];
  updateStatus?: "none" | "update-available" | "version-changed";
  latestVersion?: string;
  listing?: PluginStoreListing;
}

export interface CfPluginsOverviewData {
  marketplaces: CfMarketplaceSummaryData[];
  availablePlugins: CfAvailablePluginData[];
  installedPlugins: CfInstalledPluginData[];
  restorableBuiltins: CfAvailablePluginData[];
  diagnostics: PluginLoadOutcome["diagnostics"];
}

export interface CfMarketplaceUpdateData {
  diagnostics: PluginLoadOutcome["diagnostics"];
  marketplaces: CfMarketplaceSummaryData[];
}

export interface AddCfMarketplaceOptions extends ResolveCfPluginsOptions {
  abortSignal?: AbortSignal;
  dryRun?: boolean;
  source: string;
  
  sparsePaths?: string[];
}

export interface RemoveCfMarketplaceOptions extends ResolveCfPluginsOptions {
  marketplace: string;
}

export interface UpdateCfMarketplaceOptions extends ResolveCfPluginsOptions {
  abortSignal?: AbortSignal;
  marketplace?: string;
}

export interface InstallCfMarketplacePluginOptions extends ResolveCfPluginsOptions {
  abortSignal?: AbortSignal;
  dryRun?: boolean;
  marketplace: string;
  pluginName: string;
  scope?: "user" | "workspace";
}

export interface UninstallCfMarketplacePluginOptions extends ResolveCfPluginsOptions {
  pluginId?: string;
  pluginName?: string;
  marketplace?: string;
  removeCache?: boolean;
  
  keepData?: boolean;
}

export interface UpdateCfMarketplacePluginOptions extends ResolveCfPluginsOptions {
  abortSignal?: AbortSignal;
  pluginId: string;
}

export interface ValidateCfPluginPathOptions extends ResolveCfPluginsOptions {
  abortSignal?: AbortSignal;
  path: string;
}

export interface CfPluginUpdateData extends CfPluginInstallData {
  previousVersion: string;
}

export interface RestoreBuiltinPluginOptions extends ResolveCfPluginsOptions {
  pluginId: string;
}

export interface ConfigureCfPluginOptions extends ResolveCfPluginsOptions {
  clearOptionKeys?: string[];
  dryRun?: boolean;
  options: Record<string, unknown>;
  pluginId: string;
  scope?: "user" | "workspace";
}

export interface ResetCfPluginConfigOptions extends ResolveCfPluginsOptions {
  pluginId: string;
  scope?: "user" | "workspace";
}

export interface ValidateCfPluginOptions extends ResolveCfPluginsOptions {
  marketplace?: string;
  pluginName?: string;
  source?: string;
}

export interface DescribeCfPluginOptions extends ResolveCfPluginsOptions {
  marketplace: string;
  pluginName: string;
  withWriteLock?: <T>(write: () => Promise<T>) => Promise<T>;
}

export interface CfPluginInstallData {
  dependencyClosure: string[];
  installedPlugins: CfInstalledPluginData[];
  diagnostics: PluginLoadOutcome["diagnostics"];
}

function countVisibleMarketplacePlugins(
  marketplaceId: string,
  plugins: readonly { name: string }[] | undefined,
): number | undefined {
  if (!plugins) return undefined;
  if (marketplaceId !== CF_OFFICIAL_PLUGIN_MARKETPLACE) return plugins.length;
  return plugins.filter((entry) => entry.name !== OFFICIAL_NODE_REPL_HOST_PLUGIN_NAME).length;
}

export function resolveCfPlugins(options: ResolveCfPluginsOptions = {}): PluginLoadOutcome {
  const { configResult, pluginStorageRoot, workingDirectory } = resolvePluginContext(options);

  return discoverNodePluginsSync({
    config: configResult.config.plugins,
    env: options.env ?? process.env,
    officialPluginRoots: resolveOfficialPluginRoots({
      extraRoots: options.officialPluginRoots,
      logger: options.logger,
      storageRoot: pluginStorageRoot,
      suppressedBuiltins: new Set(configResult.config.plugins.suppressedBuiltins),
    }),
    officialPluginsEnabledByDefault: DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS,
    storageRoot: pluginStorageRoot,
    workingDirectory,
  });
}

export function getCfPluginsOverview(
  options: ResolveCfPluginsOptions = {},
): CfPluginsOverviewData {
  const { configResult, pluginStorageRoot, workingDirectory } = resolvePluginContext(options);
  ensureDefaultPluginMarketplaces(pluginStorageRoot);
  const outcome = resolveCfPlugins({
    ...options,
    configResult,
    pluginStorageRoot,
  });
  const known = loadKnownMarketplacesSync(pluginStorageRoot);
  const effectiveMarketplaces = resolveEffectiveMarketplaceRecords({
    configResult,
    known,
    workingDirectory,
  });
  const marketplaceDeclarationDiagnostics = resolveMarketplaceDeclarationDiagnostics({
    configResult,
    known,
    workingDirectory,
  });
  const installed = listInstalledPluginRecords(pluginStorageRoot);
  const installedIds = new Set(installed.map((record) => record.id));

  const catalogs: Array<{
    summary: CfMarketplaceSummaryData;
    entries: PluginMarketplaceEntry[];
  }> = [];
  for (const { record, useCachedManifest } of effectiveMarketplaces) {
    const manifest = useCachedManifest
      ? loadMarketplaceManifestSync(pluginStorageRoot, record.id)
      : null;
    catalogs.push({
      summary: toMarketplaceSummaryData(
        record,
        manifest?.featured,
        countVisibleMarketplacePlugins(record.id, manifest?.plugins),
      ),
      entries: manifest?.plugins ?? [],
    });
  }

  const latestPinByPluginId = new Map<string, { version?: string; sha?: string }>();
  const listingByPluginId = new Map<string, PluginStoreListing>();
  const availablePlugins = catalogs.flatMap((catalog) =>
    catalog.entries.map((entry) => {
      const data = toAvailablePluginData(entry, catalog.summary.id, installedIds);
      latestPinByPluginId.set(data.id, {
        ...(entry.version ? { version: entry.version } : {}),
        ...(readPluginSourceIdentityPin(entry.source)
          ? { sha: readPluginSourceIdentityPin(entry.source) }
          : {}),
      });
      if (entry.listing) listingByPluginId.set(data.id, entry.listing);
      return data;
    }),
  );
  const loadedById = new Map(outcome.plugins.map((plugin) => [plugin.id, plugin]));

  const suppressed = new Set(configResult.config.plugins.suppressedBuiltins);
  const restorableBuiltins: CfAvailablePluginData[] = OFFICIAL_PLUGIN_DEFINITIONS.filter(
    (def) =>
      suppressed.has(`${def.name}@${CF_OFFICIAL_PLUGIN_MARKETPLACE}`) &&
      (def.name !== "computer-use" || isCfCuaInternalFeatureEnabled(options.env ?? process.env)),
  ).map((def) => {
    const listing = def.listing
      ? parseEntryStoreListing({ name: def.name, ...def.listing })
      : undefined;
    return {
      id: `${def.name}@${CF_OFFICIAL_PLUGIN_MARKETPLACE}`,
      name: def.name,
      marketplace: CF_OFFICIAL_PLUGIN_MARKETPLACE,
      version: def.version,
      installed: false,
      ...(def.componentTypes ? { componentTypes: [...def.componentTypes] } : {}),
      ...(listing ? { listing } : {}),
    };
  });

  return {
    marketplaces: catalogs.map((catalog) => catalog.summary),
    availablePlugins,
    installedPlugins: installed.map((record) => {
      const enabled = configResult.config.plugins.enabledPlugins[record.id] ?? false;
      const data = toInstalledPluginData(record, enabled, loadedById.get(record.id));
      const pin = latestPinByPluginId.get(record.id);
      const installedSha = readPluginSourceIdentityPin(record.source);
      const updateStatus = comparePluginUpdate({
        installedVersion: data.version,
        installedSha,
        latestVersion: pin?.version,
        latestSha: pin?.sha,
      });
      const latestLabel = pin?.version ?? (pin?.sha ? pin.sha.slice(0, 7) : undefined);
      const listing = listingByPluginId.get(record.id);
      return {
        ...data,
        updateStatus,
        ...(latestLabel ? { latestVersion: latestLabel } : {}),
        ...(listing ? { listing } : {}),
      };
    }),
    restorableBuiltins,
    diagnostics: [
      ...outcome.diagnostics,
      ...marketplaceDeclarationDiagnostics,
      ...known.flatMap((record): PluginLoadOutcome["diagnostics"] =>
        record.lastRefreshFailure
          ? [
              {
                code: record.lastRefreshFailure.code,
                message: record.lastRefreshFailure.message,
                pluginId: record.id,
                severity: "error",
              },
            ]
          : [],
      ),
    ],
  };
}

export function enrichCachedClaudeMarketplaceIconsForOverview(
  options: ResolveCfPluginsOptions = {},
): void {
  const { pluginStorageRoot } = resolvePluginContext(options);
  void enrichCachedClaudeMarketplaceIcons(pluginStorageRoot, (write) =>
    withPluginStorageLock(pluginStorageRoot, write),
  );
}

export function listCfPlugins(options: ListCfPluginsOptions = {}): PluginLoadOutcome {
  const outcome = resolveCfPlugins(options);
  const { pluginStorageRoot } = resolvePluginContext(options);
  return {
    ...outcome,
    pluginListingsById: loadPluginListingsById(pluginStorageRoot),
  };
}

function loadPluginListingsById(storageRoot: string): Record<string, PluginStoreListing> {
  const listings = new Map<string, PluginStoreListing>();

  for (const definition of OFFICIAL_PLUGIN_DEFINITIONS) {
    if (!definition.listing) continue;
    const listing = parseEntryStoreListing({ name: definition.name, ...definition.listing });
    if (listing) {
      listings.set(`${definition.name}@${CF_OFFICIAL_PLUGIN_MARKETPLACE}`, listing);
    }
  }

  for (const marketplace of loadKnownMarketplacesSync(storageRoot)) {
    const manifest = loadMarketplaceManifestSync(storageRoot, marketplace.id);
    for (const entry of manifest?.plugins ?? []) {
      if (entry.listing) listings.set(`${entry.name}@${marketplace.id}`, entry.listing);
    }
  }

  return Object.fromEntries(listings);
}

export async function setCfPluginEnabled(
  options: SetCfPluginEnabledOptions,
): Promise<SetCfPluginEnabledResult> {
  const workingDirectory = resolve(options.workingDirectory ?? process.cwd());
  const configResult =
    options.configResult ??
    createConfig({
      env: options.env,
      projectConfigPath: options.projectConfigPath,
      workingDirectory,
      skipUserConfig: options.skipUserConfig,
      userConfigPath: options.userConfigPath,
    });
  const outcome = resolveCfPlugins({
    ...options,
    configResult,
    workingDirectory,
  });
  const plugin = resolvePluginSelector(options.plugin, outcome.plugins);
  const patch = await updatePluginEnabledInFileConfig(
    resolvePluginConfigPath(options, configResult, workingDirectory),
    plugin.id,
    options.enabled,
  );

  return {
    enabled: patch.enabled,
    path: patch.path,
    plugin: {
      ...plugin,
      enabled: patch.enabled,
    },
  };
}

export async function addCfPluginMarketplace(
  options: AddCfMarketplaceOptions,
): Promise<CfMarketplaceSummaryData> {
  const { pluginStorageRoot } = resolvePluginContext(options);
  const source = applySparsePaths(
    await parseMarketplaceSourceInput(options.source),
    options.sparsePaths,
  );
  if (options.dryRun === true) {
    return {
      id: "dry-run",
      name: "dry-run",
      source: source as unknown as Record<string, unknown>,
      pluginCount: 0,
      isOfficial: false,
    };
  }
  const record = await addMarketplace({
    signal: options.abortSignal,
    source,
    storageRoot: pluginStorageRoot,
  });
  return toMarketplaceSummaryData(record);
}

export async function removeCfPluginMarketplace(
  options: RemoveCfMarketplaceOptions,
): Promise<void> {
  const { pluginStorageRoot } = resolvePluginContext(options);
  await removeMarketplace({
    marketplace: options.marketplace,
    storageRoot: pluginStorageRoot,
  });
}

export async function updateCfPluginMarketplace(
  options: UpdateCfMarketplaceOptions,
): Promise<CfMarketplaceUpdateData> {
  const { configResult, pluginStorageRoot, workingDirectory } = resolvePluginContext(options);
  ensureDefaultPluginMarketplaces(pluginStorageRoot);
  const declared = resolveDeclaredMarketplaceSources({
    configResult,
  });
  const known = loadKnownMarketplacesSync(pluginStorageRoot);
  const knownById = new Map(known.map((record) => [record.id, record]));
  const targetIds = resolveMarketplaceRefreshTargetIds({
    declaredIds: declared.keys(),
    knownIds: knownById.keys(),
    marketplace: options.marketplace,
  });
  if (
    options.marketplace &&
    !knownById.has(options.marketplace) &&
    !declared.has(options.marketplace)
  ) {
    throw new Error(`Marketplace not found: ${options.marketplace}`);
  }

  const updated: KnownMarketplaceRecord[] = [];
  const declarationDiagnostics: PluginLoadOutcome["diagnostics"] = [];
  for (const marketplaceId of targetIds) {
    const declarationSource = declared.get(marketplaceId);
    const knownRecord = knownById.get(marketplaceId);
    if (
      options.marketplace &&
      declarationSource &&
      knownRecord &&
      !isDeepStrictEqual(knownRecord.source, declarationSource)
    ) {
      declarationDiagnostics.push(createMarketplaceSourceRepointDiagnostic(marketplaceId));
      continue;
    }
    if (declarationSource && !knownRecord) {
      try {
        updated.push(
          await addMarketplace({
            expectedId: marketplaceId,
            signal: options.abortSignal,
            source: declarationSource,
            storageRoot: pluginStorageRoot,
          }),
        );
      } catch (error) {
        declarationDiagnostics.push(toMarketplaceRefreshDiagnostic(error, marketplaceId));
      }
      continue;
    }
    updated.push(
      ...(await updateMarketplace({
        marketplace: marketplaceId,
        signal: options.abortSignal,
        storageRoot: pluginStorageRoot,
      })),
    );
  }

  const records = loadKnownMarketplacesSync(pluginStorageRoot);
  const selectedFailures = records.flatMap((record): PluginLoadOutcome["diagnostics"] => {
    if (options.marketplace && record.id !== options.marketplace) return [];
    if (!record.lastRefreshFailure) return [];
    return [
      {
        code: record.lastRefreshFailure.code,
        message: record.lastRefreshFailure.message,
        pluginId: record.id,
        severity: "error",
      },
    ];
  });
  return {
    marketplaces: updated.map((record) => toMarketplaceSummaryData(record)),
    diagnostics: [...declarationDiagnostics, ...selectedFailures],
  };
}

export async function installCfMarketplacePlugin(
  options: InstallCfMarketplacePluginOptions,
): Promise<CfPluginInstallData> {
  const { configResult, pluginStorageRoot, workingDirectory } = resolvePluginContext(options);
  ensureDefaultPluginMarketplaces(pluginStorageRoot);
  if (options.dryRun === true) {
    const declarationSource = resolveDeclaredMarketplaceSources({
      configResult,
    }).get(options.marketplace);
    const known = loadKnownMarketplacesSync(pluginStorageRoot).find(
      (record) => record.id === options.marketplace,
    );
    if (declarationSource && known && !isDeepStrictEqual(known.source, declarationSource)) {
      return {
        dependencyClosure: [],
        installedPlugins: [],
        diagnostics: [createMarketplaceSourceRepointDiagnostic(options.marketplace)],
      };
    }
    if (
      declarationSource &&
      (!known || !loadMarketplaceManifestSync(pluginStorageRoot, options.marketplace))
    ) {
      return {
        dependencyClosure: [],
        installedPlugins: [],
        diagnostics: (
          await validateMarketplaceSource({
            expectedId: options.marketplace,
            pluginName: options.pluginName,
            signal: options.abortSignal,
            source: declarationSource,
            storageRoot: pluginStorageRoot,
          })
        ).map(toPluginDiagnostic),
      };
    }
    return {
      dependencyClosure: [],
      installedPlugins: [],
      diagnostics: (
        await validateMarketplacePlugin({
          marketplace: options.marketplace,
          name: options.pluginName,
          storageRoot: pluginStorageRoot,
        })
      ).map(toPluginDiagnostic),
    };
  }
  const pluginId = `${options.pluginName}@${options.marketplace}`;
  const bundledEntry = loadMarketplaceManifestSync(
    pluginStorageRoot,
    options.marketplace,
  )?.plugins.find((entry) => entry.name === options.pluginName);
  const isSuppressedBundledOfficial =
    options.marketplace === CF_OFFICIAL_PLUGIN_MARKETPLACE &&
    configResult.config.plugins.suppressedBuiltins.includes(pluginId) &&
    (bundledEntry?.source === "filesystem" || bundledEntry?.source === "sea");
  if (isSuppressedBundledOfficial) {
    await restoreBuiltinPluginCore({ ...options, configResult, pluginId });
    const fresh = resolvePluginContext({ ...options, configResult: undefined });
    const outcome = resolveCfPlugins({
      ...options,
      configResult: fresh.configResult,
      pluginStorageRoot: fresh.pluginStorageRoot,
    });
    const restored = outcome.plugins.find((plugin) => plugin.id === pluginId);
    if (!restored) {
      return {
        dependencyClosure: [],
        installedPlugins: [],
        diagnostics: [
          toPluginDiagnostic({
            code: "plugin_not_found",
            message: `Bundled plugin could not be restored: ${pluginId}`,
            pluginId,
            severity: "error",
          }),
        ],
      };
    }
    const now = new Date().toISOString();
    return {
      dependencyClosure: [pluginId],
      installedPlugins: [
        toInstalledPluginData(
          {
            id: restored.id,
            name: restored.name,
            marketplace: restored.marketplace,
            version: restored.version ?? "",
            installPath: restored.rootPath,
            installedAt: now,
            updatedAt: now,
            scope: "user",
          },
          restored.enabled,
          restored,
        ),
      ],
      diagnostics: [],
    };
  }
  let installed: Awaited<ReturnType<typeof installMarketplacePlugin>>;
  try {
    await materializeDeclaredMarketplaceForExplicitAction({
      configResult,
      marketplaceId: options.marketplace,
      pluginStorageRoot,
      abortSignal: options.abortSignal,
      workingDirectory,
    });
    installed = await installMarketplacePlugin({
      signal: options.abortSignal,
      marketplace: options.marketplace,
      name: options.pluginName,
      scope: "user",
      storageRoot: pluginStorageRoot,
    });
  } catch (error) {
    return {
      dependencyClosure: [],
      installedPlugins: [],
      diagnostics: [
        toMarketplaceInstallDiagnostic(error, `${options.pluginName}@${options.marketplace}`),
      ],
    };
  }
  if (options.marketplace === CF_OFFICIAL_PLUGIN_MARKETPLACE) {
    for (const record of installed.installed) {
      await removeSuppressedBuiltinInFileConfig(configResult.sources.user.path, record.id);
    }
  }
  const { enabledIds } = await enablePluginsByDefaultInFileConfig(
    configResult.sources.user.path,
    installed.installed.map((record) => record.id),
  );
  const enabledIdSet = new Set(enabledIds);
  const enabledById = (id: string): boolean =>
    enabledIdSet.has(id) || (configResult.config.plugins.enabledPlugins[id] ?? false);
  return {
    dependencyClosure: installed.closure,
    installedPlugins: installed.installed.map((record) =>
      toInstalledPluginData(record, enabledById(record.id)),
    ),
    diagnostics: [],
  };
}

export async function uninstallCfMarketplacePlugin(
  options: UninstallCfMarketplacePluginOptions,
): Promise<CfInstalledPluginData | null> {
  const { configResult, pluginStorageRoot, workingDirectory } = resolvePluginContext(options);
  return withPluginStorageLock(pluginStorageRoot, async () => {
    const pluginId = resolvePluginIdForMutation(options);

    const installedRecord = listInstalledPluginRecords(pluginStorageRoot).find(
      (record) => record.id === pluginId,
    );
    if (installedRecord) {
      const removed = await uninstallMarketplacePlugin({
        pluginId,
        removeCache: options.removeCache ?? true,
        keepData: options.keepData,
        storageRoot: pluginStorageRoot,
      });
      if (!removed) return null;
      await removePluginFromFileConfig(configResult.sources.user.path, removed.id);
      await removeSuppressedBuiltinInFileConfig(configResult.sources.user.path, removed.id);
      return toInstalledPluginData(removed, false);
    }

    const outcome = resolveCfPlugins({
      ...options,
      configResult,
      pluginStorageRoot,
      workingDirectory,
    });
    const builtin = outcome.plugins.find(
      (plugin) => plugin.id === pluginId && plugin.source === "official",
    );
    if (builtin) {
      await addSuppressedBuiltinInFileConfig(configResult.sources.user.path, pluginId);
      await removePluginFromFileConfig(configResult.sources.user.path, pluginId);
      if (options.keepData !== true) {
        await rm(getPluginDataDir(pluginStorageRoot, pluginId), { force: true, recursive: true });
      }
      const now = new Date().toISOString();
      return toInstalledPluginData(
        {
          id: builtin.id,
          name: builtin.name,
          marketplace: builtin.marketplace,
          version: builtin.version ?? "",
          installPath: builtin.rootPath,
          installedAt: now,
          updatedAt: now,
          scope: "user",
        },
        false,
      );
    }

    return null;
  });
}

export async function updateCfMarketplacePlugin(
  options: UpdateCfMarketplacePluginOptions,
): Promise<CfPluginUpdateData> {
  const { pluginStorageRoot } = resolvePluginContext(options);
  const record = listInstalledPluginRecords(pluginStorageRoot).find(
    (installed) => installed.id === options.pluginId,
  );
  if (!record) throw new Error(`Plugin not installed: ${options.pluginId}`);
  const refreshed = await updateCfPluginMarketplace({
    ...options,
    marketplace: record.marketplace,
  });
  const refreshErrors = refreshed.diagnostics.filter((item) => item.severity === "error");
  if (refreshErrors.length > 0) {
    return {
      dependencyClosure: [],
      installedPlugins: [],
      diagnostics: refreshErrors,
      previousVersion: record.version,
    };
  }
  const installed = await installCfMarketplacePlugin({
    ...options,
    marketplace: record.marketplace,
    pluginName: record.name,
    scope: record.scope,
  });
  return { ...installed, previousVersion: record.version };
}

export async function validateCfPluginPath(
  options: ValidateCfPluginPathOptions,
): Promise<PluginLoadOutcome["diagnostics"]> {
  const { pluginStorageRoot } = resolvePluginContext(options);
  return (
    await validateLocalPluginPath({
      path: options.path,
      signal: options.abortSignal,
      storageRoot: pluginStorageRoot,
    })
  ).map(toPluginDiagnostic);
}

function applySparsePaths(
  source: MarketplaceSource,
  sparsePaths: string[] | undefined,
): MarketplaceSource {
  const paths = (sparsePaths ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
  if (paths.length === 0) return source;
  if (source.source !== "git" && source.source !== "github") {
    throw new Error("--sparse only applies to git or GitHub marketplace sources");
  }
  return { ...source, sparsePaths: paths };
}

async function restoreBuiltinPluginCore(options: RestoreBuiltinPluginOptions): Promise<void> {
  const cfCuaPluginId = CF_CUA_OFFICIAL_PLUGIN_ID;
  if (
    options.pluginId === cfCuaPluginId &&
    !isCfCuaInternalFeatureEnabled(options.env ?? process.env)
  ) {
    throw new Error("computer-use built-in plugin requires CF_CUA_PRODUCT_HELPER to be enabled");
  }
  const { configResult } = resolvePluginContext(options);
  await removeSuppressedBuiltinInFileConfig(configResult.sources.user.path, options.pluginId);
  const fresh = resolvePluginContext({ ...options, configResult: undefined });
  resolveOfficialPluginRoots({
    storageRoot: fresh.pluginStorageRoot,
    suppressedBuiltins: new Set(fresh.configResult.config.plugins.suppressedBuiltins),
  });
}

export async function restoreBuiltinPlugin(options: RestoreBuiltinPluginOptions): Promise<void> {
  const { pluginStorageRoot } = resolvePluginContext(options);
  await withPluginStorageLock(pluginStorageRoot, () => restoreBuiltinPluginCore(options));
}

export async function configureCfPlugin(options: ConfigureCfPluginOptions): Promise<void> {
  const normalizedOptions = normalizePluginOptions(options.options);
  const clearOptionKeys = normalizePluginOptionKeys(options.clearOptionKeys);
  const { configResult, pluginStorageRoot, workingDirectory } = resolvePluginContext(options);
  const outcome = resolveCfPlugins({
    ...options,
    configResult,
    pluginStorageRoot,
    workingDirectory,
  });
  const plugin = resolvePluginSelector(options.pluginId, outcome.plugins);
  if (options.dryRun === true) return;
  await updatePluginOptionsInFileConfig(
    resolvePluginConfigPath(options, configResult, workingDirectory),
    plugin.id,
    normalizedOptions,
    clearOptionKeys,
  );
}

export async function resetCfPluginConfig(
  options: ResetCfPluginConfigOptions,
): Promise<{ path: string; pluginId: string }> {
  const { configResult, workingDirectory } = resolvePluginContext(options);
  const path = resolvePluginConfigPath(options, configResult, workingDirectory);
  if (options.scope === "workspace") {
    await removePluginEnabledFromFileConfig(path, options.pluginId);
  } else {
    await removePluginFromFileConfig(path, options.pluginId);
  }
  return { path, pluginId: options.pluginId };
}

export async function validateCfPlugin(
  options: ValidateCfPluginOptions,
): Promise<PluginLoadOutcome["diagnostics"]> {
  const { pluginStorageRoot } = resolvePluginContext(options);
  ensureDefaultPluginMarketplaces(pluginStorageRoot);
  if (options.source) {
    try {
      const source = await parseMarketplaceSourceInput(options.source);
      return (
        await validateMarketplaceSource({
          source,
          storageRoot: pluginStorageRoot,
        })
      ).map(toPluginDiagnostic);
    } catch (error) {
      return [
        {
          code: "plugin_marketplace_invalid",
          message: error instanceof Error ? error.message : String(error),
          severity: "error",
        },
      ];
    }
  }
  if (options.marketplace && options.pluginName) {
    try {
      await ensureMarketplaceManifestAvailable({
        marketplace: options.marketplace,
        storageRoot: pluginStorageRoot,
      });
    } catch (error) {
      return [
        {
          code: "plugin_marketplace_invalid",
          message: error instanceof Error ? error.message : String(error),
          pluginId: `${options.pluginName}@${options.marketplace}`,
          severity: "error",
        },
      ];
    }
    return (
      await validateMarketplacePlugin({
        marketplace: options.marketplace,
        name: options.pluginName,
        storageRoot: pluginStorageRoot,
      })
    ).map(toPluginDiagnostic);
  }
  return [];
}

export async function describeCfPlugin(
  options: DescribeCfPluginOptions,
): Promise<DescribeMarketplacePluginResult> {
  const { pluginStorageRoot } = resolvePluginContext(options);
  return describeMarketplacePlugin({
    marketplace: options.marketplace,
    name: options.pluginName,
    storageRoot: pluginStorageRoot,
    ...(options.withWriteLock ? { withWriteLock: options.withWriteLock } : {}),
  });
}

function resolvePluginContext(options: ResolveCfPluginsOptions): {
  configResult: ConfigResult;
  pluginStorageRoot: string;
  workingDirectory: string;
} {
  const workingDirectory = resolve(options.workingDirectory ?? process.cwd());
  const configResult =
    options.configResult ??
    createConfig({
      env: options.env,
      projectConfigPath: options.projectConfigPath,
      workingDirectory,
      skipUserConfig: options.skipUserConfig,
      userConfigPath: options.userConfigPath,
    });
  const storageRoot = resolvePath(configResult.config.storage.dir);
  return {
    configResult,
    pluginStorageRoot:
      options.pluginStorageRoot ?? getPluginStorageRoot(getCliStorageRoot(storageRoot)),
    workingDirectory,
  };
}

function resolveDeclaredMarketplaceSources(input: {
  configResult: ConfigResult;
}): Map<string, MarketplaceSource> {
  return new Map(
    Object.entries(input.configResult.config.plugins.extraKnownMarketplaces ?? {}).map(
      ([marketplaceId, declaration]) => {
        const baseDirectory = dirname(input.configResult.sources.plugins.paths.user);
        return [marketplaceId, resolveDeclaredMarketplaceSource(declaration.source, baseDirectory)];
      },
    ),
  );
}

function resolveDeclaredMarketplaceSource(
  source: ConfigResult["config"]["plugins"]["extraKnownMarketplaces"][string]["source"],
  baseDirectory: string,
): MarketplaceSource {
  if (source.source === "file" || source.source === "directory") {
    return {
      ...source,
      path: isAbsolute(source.path) ? resolve(source.path) : resolve(baseDirectory, source.path),
    };
  }
  return source;
}

function resolveEffectiveMarketplaceRecords(input: {
  configResult: ConfigResult;
  known: KnownMarketplaceRecord[];
  workingDirectory: string;
}): Array<{ record: KnownMarketplaceRecord; useCachedManifest: boolean }> {
  const declared = resolveDeclaredMarketplaceSources(input);
  const knownIds = new Set(input.known.map((record) => record.id));
  const records = input.known.map((record) => {
    const declarationSource = declared.get(record.id);
    if (!declarationSource) return { record, useCachedManifest: true };
    if (isDeepStrictEqual(record.source, declarationSource)) {
      return { record, useCachedManifest: true };
    }
    if (isOfficialMarketplaceId(record.id)) {
      return { record, useCachedManifest: true };
    }
    return {
      record: createDeclaredMarketplaceRecord(record.id, declarationSource),
      useCachedManifest: false,
    };
  });
  for (const [marketplaceId, source] of declared) {
    if (knownIds.has(marketplaceId)) continue;
    if (isOfficialMarketplaceId(marketplaceId)) continue;
    records.push({
      record: createDeclaredMarketplaceRecord(marketplaceId, source),
      useCachedManifest: false,
    });
  }
  return records;
}

function resolveMarketplaceDeclarationDiagnostics(input: {
  configResult: ConfigResult;
  known: KnownMarketplaceRecord[];
  workingDirectory: string;
}): PluginLoadOutcome["diagnostics"] {
  const declared = resolveDeclaredMarketplaceSources(input);
  const knownById = new Map(input.known.map((record) => [record.id, record]));
  return [...declared.entries()].flatMap(([marketplaceId, source]) => {
    if (!isOfficialMarketplaceId(marketplaceId)) return [];
    const known = knownById.get(marketplaceId);
    if (known && isDeepStrictEqual(known.source, source)) return [];
    return [createReservedMarketplaceDeclarationDiagnostic(marketplaceId)];
  });
}

function createDeclaredMarketplaceRecord(
  marketplaceId: string,
  source: MarketplaceSource,
): KnownMarketplaceRecord {
  return {
    id: marketplaceId,
    source,
    name: marketplaceId,
    addedAt: "",
    pluginCount: 0,
  };
}

async function materializeDeclaredMarketplaceForExplicitAction(input: {
  abortSignal?: AbortSignal;
  configResult: ConfigResult;
  marketplaceId: string;
  pluginStorageRoot: string;
  workingDirectory: string;
}): Promise<void> {
  const source = resolveDeclaredMarketplaceSources(input).get(input.marketplaceId);
  if (!source) return;
  const known = loadKnownMarketplacesSync(input.pluginStorageRoot).find(
    (record) => record.id === input.marketplaceId,
  );
  if (known && !isDeepStrictEqual(known.source, source)) {
    throw new MarketplaceSourceRepointError(
      createMarketplaceSourceRepointDiagnostic(input.marketplaceId).message,
    );
  }
  if (known && loadMarketplaceManifestSync(input.pluginStorageRoot, input.marketplaceId)) {
    return;
  }
  await addMarketplace({
    expectedId: input.marketplaceId,
    signal: input.abortSignal,
    source,
    storageRoot: input.pluginStorageRoot,
  });
}

function resolvePluginSelector(selector: string, plugins: PluginMetadata[]): PluginMetadata {
  const normalized = selector.trim();
  const exact = plugins.find((plugin) => plugin.id === normalized);
  if (exact) return exact;

  const nameMatches = plugins.filter((plugin) => plugin.name === normalized);
  if (nameMatches.length === 1 && nameMatches[0]) return nameMatches[0];
  if (nameMatches.length > 1) {
    throw new Error(`Plugin name is ambiguous, use full plugin id: ${normalized}`);
  }
  throw new Error(`Plugin not found: ${normalized}`);
}

function toMarketplaceSummaryData(
  record: KnownMarketplaceRecord,
  featured?: string[],
  pluginCount?: number,
): CfMarketplaceSummaryData {
  return {
    id: record.id,
    name: record.name,
    source: record.source as unknown as Record<string, unknown>,
    ...(record.description ? { description: record.description } : {}),
    ...(record.lastUpdated ? { lastUpdated: record.lastUpdated } : {}),
    pluginCount: pluginCount ?? record.pluginCount,
    isOfficial: isOfficialMarketplaceId(record.id),
    ...(record.lastRefreshFailure
      ? {
          refreshFailure: {
            code: record.lastRefreshFailure.code,
            failedAt: record.lastRefreshFailure.failedAt,
            message: record.lastRefreshFailure.message,
          },
        }
      : {}),
    ...(featured && featured.length > 0 ? { featured } : {}),
  };
}

function toAvailablePluginData(
  entry: PluginMarketplaceEntry,
  marketplace: string,
  installedIds: ReadonlySet<string>,
): CfAvailablePluginData {
  const id = `${entry.name}@${marketplace}`;
  return {
    id,
    name: entry.name,
    marketplace,
    ...(entry.description ? { description: entry.description } : {}),
    ...(entry.version ? { version: entry.version } : {}),
    installed: installedIds.has(id),
    componentTypes: inferComponentTypes(entry.raw),
    ...(entry.listing ? { listing: entry.listing } : {}),
  };
}

function toInstalledPluginData(
  record: InstalledPluginRecord,
  enabled: boolean,
  loaded?: PluginMetadata,
): CfInstalledPluginData {
  return {
    id: record.id,
    name: record.name,
    marketplace: record.marketplace,
    ...((loaded?.description ?? undefined) ? { description: loaded?.description } : {}),
    version: loaded?.version ?? record.version,
    enabled,
    scope: record.scope,
    installPath: record.installPath,
    installedAt: record.installedAt,
    componentTypes: loaded ? inferComponentTypesFromMetadata(loaded) : undefined,
    ...(loaded ? { hookDetails: loaded.hookDetails } : {}),
  };
}

function inferComponentTypes(raw: Record<string, unknown>): string[] {
  const types: string[] = [];
  if ("agents" in raw) types.push("agent");
  if ("commands" in raw) types.push("command");
  if ("skills" in raw) types.push("skill");
  if ("hooks" in raw) types.push("hook");
  if ("mcpServers" in raw) types.push("mcp");
  if ("lspServers" in raw) types.push("lsp");
  if (Array.isArray(raw.componentTypes) && raw.componentTypes.includes("ui")) types.push("ui");
  return types;
}

function inferComponentTypesFromMetadata(plugin: PluginMetadata): string[] {
  const types: string[] = [];
  if (plugin.components.some((group) => group.kind === "agent" && group.items.length > 0)) {
    types.push("agent");
  }
  if (plugin.commandRootCount > 0) types.push("command");
  if (plugin.skillRootCount > 0 || plugin.skillCount > 0) types.push("skill");
  if (plugin.declaredMcpServerNames.length > 0 || plugin.mcpServerNames.length > 0) {
    types.push("mcp");
  }
  if (plugin.hookDetails.length > 0) types.push("hook");
  if (plugin.uiSurfaces?.length) types.push("ui");
  return types;
}

function resolvePluginIdForMutation(options: UninstallCfMarketplacePluginOptions): string {
  if (options.pluginId) return options.pluginId;
  if (options.pluginName && options.marketplace) {
    return `${options.pluginName}@${options.marketplace}`;
  }
  throw new Error("pluginId or pluginName + marketplace is required");
}

function normalizePluginOptions(
  options: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(options)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    }
  }
  return result;
}

function normalizePluginOptionKeys(keys: string[] | undefined): string[] {
  return [...new Set((keys ?? []).map((key) => key.trim()).filter((key) => key.length > 0))];
}

function resolvePluginConfigPath(
  options: ResolveCfPluginsOptions & { scope?: "user" | "workspace" },
  configResult: ConfigResult,
  workingDirectory: string,
): string {
  if (options.scope !== "workspace") {
    return configResult.sources.user.path;
  }

  const workspaceConfigPath = join(workingDirectory, ".cf", "config.json");
  const projectConfigPaths = [
    ...(options.projectConfigPath ? [options.projectConfigPath] : []),
    ...configResult.sources.project.paths,
  ];
  const existingWorkspaceConfig = projectConfigPaths.find(
    (path) =>
      normalizePluginConfigPathForComparison(path) ===
      normalizePluginConfigPathForComparison(workspaceConfigPath),
  );
  if (existingWorkspaceConfig) return existingWorkspaceConfig;
  return workspaceConfigPath;
}

function normalizePluginConfigPathForComparison(
  path: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const resolvedPath = platform === "win32" ? win32.resolve(path) : resolve(path);
  return platform === "win32" ? resolvedPath.replaceAll("\\", "/").toLowerCase() : resolvedPath;
}

export function isWorkspacePluginConfigPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform === "win32") {
    return (
      win32.basename(path).toLowerCase() === "config.json" &&
      win32.basename(win32.dirname(path)).toLowerCase() === ".cf"
    );
  }
  return basename(path) === "config.json" && basename(dirname(path)) === ".cf";
}

export function resolveMarketplaceRefreshTargetIds(input: {
  declaredIds: Iterable<string>;
  knownIds: Iterable<string>;
  marketplace?: string;
}): string[] {
  if (input.marketplace) return [input.marketplace];
  return [...new Set(input.knownIds)];
}

function createMarketplaceSourceRepointDiagnostic(
  marketplaceId: string,
): PluginLoadOutcome["diagnostics"][number] {
  return {
    code: "plugin_marketplace_invalid",
    message:
      `Workspace marketplace declaration "${marketplaceId}" conflicts with an existing Host source. ` +
      "Remove the existing marketplace or use a different marketplace id before materializing it.",
    pluginId: marketplaceId,
    severity: "error",
  };
}

function createReservedMarketplaceDeclarationDiagnostic(
  marketplaceId: string,
): PluginLoadOutcome["diagnostics"][number] {
  return {
    code: "plugin_marketplace_declaration_reserved",
    message:
      `Workspace marketplace declaration "${marketplaceId}" uses a reserved official id and was ignored. ` +
      "Use a different marketplace id for project declarations.",
    pluginId: marketplaceId,
    severity: "warning",
  };
}

class MarketplaceSourceRepointError extends Error {}

function toPluginDiagnostic(diagnostic: {
  code: string;
  message: string;
  pluginId?: string;
  severity: "warning" | "error";
}): PluginLoadOutcome["diagnostics"][number] {
  return {
    code: diagnostic.code as PluginLoadOutcome["diagnostics"][number]["code"],
    message: diagnostic.message,
    ...(diagnostic.pluginId ? { pluginId: diagnostic.pluginId } : {}),
    severity: diagnostic.severity,
  };
}

function toMarketplaceInstallDiagnostic(
  error: unknown,
  pluginId: string,
): PluginLoadOutcome["diagnostics"][number] {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof MarketplaceSourceRepointError) {
    return toPluginDiagnostic({
      code: "plugin_marketplace_invalid",
      message,
      pluginId,
      severity: "error",
    });
  }
  const sourceCode = getPluginSourceDiagnosticCode(error);
  if (sourceCode) {
    return toPluginDiagnostic({
      code: sourceCode,
      message,
      pluginId,
      severity: "error",
    });
  }
  if (message.startsWith("Plugin not found:")) {
    return toPluginDiagnostic({
      code: "plugin_not_found",
      message,
      pluginId,
      severity: "error",
    });
  }
  if (message.includes("Cross-marketplace dependency")) {
    return toPluginDiagnostic({
      code: "plugin_dependency_cross_marketplace",
      message,
      pluginId,
      severity: "error",
    });
  }
  if (message.includes("dependency cycle")) {
    return toPluginDiagnostic({
      code: "plugin_dependency_cycle",
      message,
      pluginId,
      severity: "error",
    });
  }
  if (
    message.includes("Dependency not found") ||
    message.includes("Marketplace not found for dependency")
  ) {
    return toPluginDiagnostic({
      code: "plugin_dependency_missing",
      message,
      pluginId,
      severity: "error",
    });
  }
  if (message.includes("source is recognized but not supported")) {
    return toPluginDiagnostic({
      code: "plugin_marketplace_source_unsupported",
      message,
      pluginId,
      severity: "error",
    });
  }
  return toPluginDiagnostic({
    code: "plugin_marketplace_invalid",
    message,
    pluginId,
    severity: "error",
  });
}

function toMarketplaceRefreshDiagnostic(
  error: unknown,
  marketplaceId: string,
): PluginLoadOutcome["diagnostics"][number] {
  const message = error instanceof Error ? error.message : String(error);
  return toPluginDiagnostic({
    code: getPluginSourceDiagnosticCode(error) ?? "plugin_marketplace_invalid",
    message,
    pluginId: marketplaceId,
    severity: "error",
  });
}
