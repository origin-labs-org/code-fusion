import { useEffect, useMemo } from "react";
import { create } from "zustand";
import type {
  CfAvailablePluginSummary,
  CfInstalledPluginSummary,
  CfPluginDiagnostic,
  CfPluginInfo,
  CfPluginMarketplaceSummary,
  CfPluginScope,
  CfPluginsDescribeResult,
} from "@origin-ai/cf-shared";
import { CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID } from "@origin-ai/cf-shared";
import type { IPluginManagementService } from "@origin-ai/cf-services";
import { logger } from "@/logger.js";
import {
  beginPluginOperation,
  loadInto,
  runWorkspaceOperation,
  subscribePluginManagementChanges,
  isPluginManagementChangeRelevant,
  notifyPluginManagementChange,
} from "@/store/pluginManagementStoreLoading.js";
import { setPluginEnabledOptimistically } from "@/store/pluginManagementStoreEnabled.js";

export interface PluginDescribeEntry {
  status: "loading" | "loaded" | "error";
  data?: CfPluginsDescribeResult;
  error?: string;
}

export interface PluginManagementState {
  workspacePath: string | null;
  workspaceIdentity: string | null;
  authorityKey: string | null;
  configScope: CfPluginScope | null;
  plugins: CfPluginInfo[];
  marketplaces: CfPluginMarketplaceSummary[];
  
  marketplaceAvailabilityKnown: boolean;
  availablePlugins: CfAvailablePluginSummary[];
  installedPlugins: CfInstalledPluginSummary[];
  restorableBuiltins: CfAvailablePluginSummary[];
  diagnostics: CfPluginDiagnostic[];
  loading: boolean;
  error: string | null;
  
  lastFailedPluginId: string | null;
  togglingPluginId: string | null;
  activeOperations: ReadonlyArray<{ id: string }>;
  operationVersion: number;
  describeCache: Record<string, PluginDescribeEntry>;
  initialize: (params: {
    workspacePath: string;
    workspaceIdentity?: string;
    authorityKey?: string;
    configScope?: CfPluginScope;
    pluginService: IPluginManagementService;
  }) => Promise<void>;
  refresh: (
    pluginService?: IPluginManagementService,
    options?: { background?: boolean },
  ) => Promise<void>;
  addMarketplace: (source: string, pluginService: IPluginManagementService) => Promise<boolean>;
  updateMarketplace: (
    marketplace: string | null,
    pluginService: IPluginManagementService,
  ) => Promise<boolean>;
  removeMarketplace: (
    marketplace: string,
    pluginService: IPluginManagementService,
  ) => Promise<void>;
  installPlugin: (
    pluginName: string,
    marketplace: string,
    pluginService: IPluginManagementService,
    scope?: CfPluginScope,
  ) => Promise<boolean>;
  uninstallPlugin: (
    pluginId: string,
    pluginService: IPluginManagementService,
    removeCache?: boolean,
  ) => Promise<void>;
  updatePlugin: (pluginId: string, pluginService: IPluginManagementService) => Promise<void>;
  restoreBuiltin: (pluginId: string, pluginService: IPluginManagementService) => Promise<boolean>;
  configurePlugin: (
    pluginId: string,
    options: Record<string, string | number | boolean>,
    pluginService: IPluginManagementService,
    scope?: CfPluginScope,
    clearOptionKeys?: string[],
  ) => Promise<boolean>;
  resetPluginConfig: (
    pluginId: string,
    pluginService: IPluginManagementService,
    scope?: CfPluginScope,
  ) => Promise<boolean>;
  validateSource: (source: string, pluginService: IPluginManagementService) => Promise<void>;
  setEnabled: (
    pluginId: string,
    enabled: boolean,
    pluginService: IPluginManagementService,
    scope?: CfPluginScope,
  ) => Promise<boolean>;
  describePlugin: (
    pluginId: string,
    pluginName: string,
    marketplace: string,
    pluginService: IPluginManagementService,
    force?: boolean,
  ) => Promise<void>;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwForErrorDiagnostic(diagnostics: CfPluginDiagnostic[]): void {
  const blockingDiagnostic = diagnostics.find((diagnostic) => diagnostic.severity === "error");
  if (blockingDiagnostic) {
    throw new Error(blockingDiagnostic.message);
  }
}

export const createPluginManagementStore = (initialService?: IPluginManagementService) => {
  let lastService = initialService;
  return create<PluginManagementState>((set, get) => ({
    workspacePath: null,
    workspaceIdentity: null,
    authorityKey: null,
    configScope: null,
    plugins: [],
    marketplaces: [],
    marketplaceAvailabilityKnown: false,
    availablePlugins: [],
    installedPlugins: [],
    restorableBuiltins: [],
    diagnostics: [],
    loading: false,
    error: null,
    lastFailedPluginId: null,
    togglingPluginId: null,
    activeOperations: [],
    operationVersion: 0,
    describeCache: {},

    async initialize({
      workspacePath,
      workspaceIdentity,
      authorityKey,
      configScope,
      pluginService,
    }) {
      lastService = pluginService;
      const normalizedIdentity = workspaceIdentity?.trim() || null;
      const normalizedAuthorityKey = authorityKey?.trim() || null;
      const normalizedConfigScope = configScope ?? null;
      const current = get();
      const contextChanged =
        current.workspacePath !== workspacePath ||
        current.workspaceIdentity !== normalizedIdentity ||
        current.authorityKey !== normalizedAuthorityKey ||
        current.configScope !== normalizedConfigScope;
      const hasCache =
        current.plugins.length > 0 &&
        current.workspacePath === workspacePath &&
        current.workspaceIdentity === normalizedIdentity &&
        current.authorityKey === normalizedAuthorityKey &&
        current.configScope === normalizedConfigScope;
      set({
        workspacePath,
        workspaceIdentity: normalizedIdentity,
        authorityKey: normalizedAuthorityKey,
        configScope: normalizedConfigScope,
        loading: !hasCache,
        marketplaceAvailabilityKnown: hasCache ? current.marketplaceAvailabilityKnown : false,
        error: null,
        lastFailedPluginId: null,
        ...(contextChanged
          ? {
              activeOperations: [],
              operationVersion: current.operationVersion + 1,
              togglingPluginId: null,
              plugins: [],
              marketplaces: [],
              availablePlugins: [],
              installedPlugins: [],
              restorableBuiltins: [],
              diagnostics: [],
              describeCache: {},
            }
          : {}),
      });
      await loadInto(set, get, {
        workspacePath,
        workspaceIdentity: normalizedIdentity,
        authorityKey: normalizedAuthorityKey,
        configScope: normalizedConfigScope,
        pluginService,
      });
    },

    async refresh(pluginService = lastService, options = {}) {
      const { workspacePath, workspaceIdentity, authorityKey, configScope } = get();
      if (!workspacePath || !pluginService) return;
      lastService = pluginService;
      if (!options.background) set({ error: null, lastFailedPluginId: null });
      await loadInto(set, get, {
        workspacePath,
        workspaceIdentity,
        authorityKey,
        configScope,
        pluginService,
        fresh: !options.background,
        background: options.background,
      });
      if (!options.background)
        notifyPluginManagementChange({
          owner: get,
          workspacePath,
          workspaceIdentity,
          authorityKey,
          scope: "user",
        });
    },

    async addMarketplace(source, pluginService) {
      return runWorkspaceOperation(
        set,
        get,
        pluginService,
        `marketplace:add:${source}`,
        async (workspace) => {
          await pluginService.addPluginMarketplace({
            ...workspace,
            source,
          });
        },
      );
    },

    async updateMarketplace(marketplace, pluginService) {
      let refreshError: string | null = null;
      const succeeded = await runWorkspaceOperation(
        set,
        get,
        pluginService,
        `marketplace:update:${marketplace ?? "__all__"}`,
        async (workspace) => {
          const result = await pluginService.updatePluginMarketplace({
            ...workspace,
            ...(marketplace ? { marketplace } : {}),
          });
          const blockingDiagnostic = result.diagnostics?.find(
            (diagnostic) =>
              diagnostic.severity === "error" &&
              diagnostic.pluginId !== CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
          );
          if (blockingDiagnostic) {
            refreshError = blockingDiagnostic.message;
            logger.warn("[plugins] marketplace refresh partially failed", {
              diagnostics: result.diagnostics,
            });
          }
        },
      );
      if (succeeded && refreshError) {
        set({ error: refreshError, lastFailedPluginId: null });
        return false;
      }
      return succeeded;
    },

    async removeMarketplace(marketplace, pluginService) {
      await runWorkspaceOperation(
        set,
        get,
        pluginService,
        `marketplace:remove:${marketplace}`,
        async (workspace) => {
          await pluginService.removePluginMarketplace({
            ...workspace,
            marketplace,
          });
        },
      );
    },

    async installPlugin(pluginName, marketplace, pluginService, scope = "user") {
      return runWorkspaceOperation(
        set,
        get,
        pluginService,
        `plugin:install:${pluginName}@${marketplace}`,
        async (workspace) => {
          const result = await pluginService.installPlugin({
            ...workspace,
            pluginName,
            marketplace,
            scope,
          });
          throwForErrorDiagnostic(result.diagnostics);
        },
      );
    },

    async uninstallPlugin(pluginId, pluginService, removeCache = true) {
      await runWorkspaceOperation(
        set,
        get,
        pluginService,
        `plugin:uninstall:${pluginId}`,
        async (workspace) => {
          await pluginService.uninstallPlugin({
            ...workspace,
            pluginId,
            removeCache,
          });
        },
      );
    },

    async updatePlugin(pluginId, pluginService) {
      await runWorkspaceOperation(
        set,
        get,
        pluginService,
        `plugin:update:${pluginId}`,
        async (workspace) => {
          const result = await pluginService.updatePlugin({ ...workspace, pluginId });
          throwForErrorDiagnostic(result.diagnostics);
        },
      );
    },

    async restoreBuiltin(pluginId, pluginService) {
      return runWorkspaceOperation(
        set,
        get,
        pluginService,
        `plugin:restore:${pluginId}`,
        async (workspace) => {
          const result = await pluginService.restoreBuiltinPlugin({ ...workspace, pluginId });
          throwForErrorDiagnostic(result.diagnostics);
        },
      );
    },

    async configurePlugin(pluginId, options, pluginService, scope = "user", clearOptionKeys = []) {
      return await runWorkspaceOperation(
        set,
        get,
        pluginService,
        `plugin:configure:${pluginId}`,
        async (workspace) => {
          await pluginService.configurePlugin({
            ...workspace,
            pluginId,
            options,
            scope,
            ...(clearOptionKeys.length > 0 ? { clearOptionKeys } : {}),
          });
        },
        scope,
      );
    },

    async resetPluginConfig(pluginId, pluginService, scope = "workspace") {
      return await runWorkspaceOperation(
        set,
        get,
        pluginService,
        `plugin:reset-config:${pluginId}`,
        async (workspace) => {
          await pluginService.resetPluginConfig({
            ...workspace,
            pluginId,
            scope,
          });
        },
        scope,
      );
    },

    async validateSource(source, pluginService) {
      const { workspacePath, workspaceIdentity } = get();
      if (!workspacePath) return;
      const finish = beginPluginOperation(set, get, `marketplace:validate:${source}`);
      const version = get().operationVersion;
      try {
        const result = await pluginService.validatePlugin({
          workspacePath,
          ...(workspaceIdentity ? { workspaceIdentity } : {}),
          source,
        });
        if (get().operationVersion === version) set({ diagnostics: result.diagnostics });
      } catch (error) {
        logger.error("[plugins] validate source failed", { source, error: toMessage(error) });
        if (get().operationVersion === version) {
          set({ error: toMessage(error), lastFailedPluginId: null });
        }
      } finally {
        finish();
      }
    },

    async setEnabled(pluginId, enabled, pluginService, scope = "user") {
      return setPluginEnabledOptimistically(set, get, pluginId, enabled, pluginService, scope);
    },

    async describePlugin(pluginId, pluginName, marketplace, pluginService, force = false) {
      const { workspacePath, workspaceIdentity, describeCache } = get();
      if (!workspacePath) return;
      const cached = describeCache[pluginId];
      if (!force && cached && cached.status !== "error") return;
      const request: PluginDescribeEntry = { status: "loading" };
      set({ describeCache: { ...get().describeCache, [pluginId]: request } });
      try {
        const data = await pluginService.describePlugin({
          workspacePath,
          ...(workspaceIdentity ? { workspaceIdentity } : {}),
          marketplace,
          pluginName,
        });
        if (get().describeCache[pluginId] !== request) return;
        const blockingDiagnostic = data.diagnostics?.find(
          (diagnostic) => diagnostic.severity === "error",
        );
        if (data.components.length === 0 && blockingDiagnostic) {
          set({
            describeCache: {
              ...get().describeCache,
              [pluginId]: { status: "error", error: blockingDiagnostic.message },
            },
          });
          return;
        }
        set({
          describeCache: {
            ...get().describeCache,
            [pluginId]: { status: "loaded", data },
          },
        });
      } catch (error) {
        if (get().describeCache[pluginId] !== request) return;
        logger.error("[plugins] describe failed", {
          pluginId,
          marketplace,
          error: toMessage(error),
        });
        set({
          describeCache: {
            ...get().describeCache,
            [pluginId]: { status: "error", error: toMessage(error) },
          },
        });
      }
    },
  }));
};

export const usePluginManagementStore = createPluginManagementStore();

function subscribeStore(store: ReturnType<typeof createPluginManagementStore>) {
  return subscribePluginManagementChanges((change) => {
    if (
      change.owner !== store.getState &&
      isPluginManagementChangeRelevant(store.getState(), change)
    ) {
      return store.getState().refresh(undefined, { background: true });
    }
  });
}
subscribeStore(usePluginManagementStore);

export function useScopedPluginManagementStore(pluginService: IPluginManagementService) {
  const store = useMemo(() => createPluginManagementStore(pluginService), [pluginService]);
  useEffect(() => subscribeStore(store), [store]);
  return store;
}
