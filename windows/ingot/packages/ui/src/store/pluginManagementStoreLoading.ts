import type { IPluginManagementService } from "@origin-ai/cf-services";
import {
  remoteHostIdFromWorkspaceIdentity,
  parseRemoteWorkspaceIdentity,
  type CfPluginScope,
} from "@origin-ai/cf-shared";
import { logger } from "@/logger.js";
import type { PluginManagementState } from "@/store/pluginManagementStore.js";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildWorkspaceKey(
  workspacePath: string,
  workspaceIdentity: string | null,
  authorityKey: string | null,
): string {
  return `${authorityKey?.trim() || "workspace"}\0${workspaceIdentity?.trim() || workspacePath}`;
}

const loadsByService = new WeakMap<
  IPluginManagementService,
  Map<string, { task: Promise<Partial<PluginManagementState>>; revision: number }>
>();
export interface PluginManagementChange {
  owner?: () => PluginManagementState;
  workspacePath: string;
  workspaceIdentity: string | null;
  authorityKey: string | null;
  scope: CfPluginScope;
}
const changeListeners = new Set<(change: PluginManagementChange) => void | Promise<void>>();
let revision = 0;
export const getPluginManagementRevision = () => revision;
export function subscribePluginManagementChanges(
  listener: (change: PluginManagementChange) => void | Promise<void>,
) {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}
export function notifyPluginManagementChange(change: PluginManagementChange): void {
  revision += 1;
  for (const listener of changeListeners) {
    void Promise.resolve()
      .then(() => listener(change))
      .catch((error: unknown) => {
        logger.warn("[plugins] background projection refresh failed", {
          message: toMessage(error),
        });
      });
  }
}
export function isPluginManagementChangeRelevant(
  state: Pick<
    PluginManagementState,
    "workspacePath" | "workspaceIdentity" | "authorityKey" | "configScope"
  >,
  change: PluginManagementChange,
): boolean {
  if (!state.workspacePath) return false;
  if (change.scope === "workspace") {
    return (
      state.configScope !== "user" &&
      buildWorkspaceKey(state.workspacePath, state.workspaceIdentity, state.authorityKey) ===
        buildWorkspaceKey(change.workspacePath, change.workspaceIdentity, change.authorityKey)
    );
  }
  const hostKey = (target: { workspaceIdentity: string | null; authorityKey: string | null }) => {
    const identity = target.workspaceIdentity ?? "";
    const sourceServerId = parseRemoteWorkspaceIdentity(identity)?.sourceServerId;
    return (
      target.authorityKey ??
      (sourceServerId
        ? `source-settings:${sourceServerId}`
        : (remoteHostIdFromWorkspaceIdentity(identity) ?? "local"))
    );
  };
  return hostKey(state) === hostKey(change);
}

export function beginPluginOperation(
  set: (partial: Partial<PluginManagementState>) => void,
  get: () => PluginManagementState,
  id: string,
): () => void {
  const entry = { id };
  set({
    activeOperations: [...get().activeOperations, entry],
    operationVersion: get().operationVersion + 1,
    error: null,
    lastFailedPluginId: null,
  });
  return () => {
    set({ activeOperations: get().activeOperations.filter((operation) => operation !== entry) });
  };
}

export async function runWorkspaceOperation(
  set: (partial: Partial<PluginManagementState>) => void,
  get: () => PluginManagementState,
  pluginService: IPluginManagementService,
  operationId: string,
  operation: (workspace: { workspacePath: string; workspaceIdentity?: string }) => Promise<void>,
  scope: CfPluginScope = "user",
): Promise<boolean> {
  const { workspacePath, workspaceIdentity, authorityKey, configScope } = get();
  if (!workspacePath) return false;
  const finish = beginPluginOperation(set, get, operationId);
  const operationVersion = get().operationVersion;
  const isCurrentContext = (): boolean => {
    const current = get();
    return (
      current.workspacePath === workspacePath &&
      current.workspaceIdentity === workspaceIdentity &&
      current.authorityKey === authorityKey &&
      current.configScope === configScope
    );
  };
  const ownsVisibleOperation = (): boolean =>
    isCurrentContext() && get().operationVersion === operationVersion;
  try {
    await operation({
      workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
    });
    if (!isCurrentContext()) {
      await notifyPluginManagementChange({
        owner: get,
        workspacePath,
        workspaceIdentity,
        authorityKey,
        scope,
      });
      return false;
    }
    await loadInto(set, get, {
      workspacePath,
      workspaceIdentity,
      authorityKey,
      configScope,
      pluginService,
      fresh: true,
    });
    await notifyPluginManagementChange({
      owner: get,
      workspacePath,
      workspaceIdentity,
      authorityKey,
      scope,
    });
    return isCurrentContext();
  } catch (error) {
    logger.error("[plugins] operation failed", { operationId, error: toMessage(error) });
    if (ownsVisibleOperation()) {
      set({ error: toMessage(error), lastFailedPluginId: null });
    }
    return false;
  } finally {
    finish();
  }
}

interface PluginLoadParams {
  workspacePath: string;
  workspaceIdentity: string | null;
  authorityKey: string | null;
  configScope: CfPluginScope | null;
  pluginService: IPluginManagementService;
  fresh?: boolean;
  background?: boolean;
}
export async function loadInto(
  set: (partial: Partial<PluginManagementState>) => void,
  get: () => PluginManagementState,
  params: PluginLoadParams,
): Promise<void> {
  let inFlightLoads = loadsByService.get(params.pluginService);
  if (!inFlightLoads) {
    inFlightLoads = new Map();
    loadsByService.set(params.pluginService, inFlightLoads);
  }
  const workspaceKey = buildWorkspaceKey(
    params.workspacePath,
    params.workspaceIdentity,
    params.authorityKey,
  );
  const loadKey = `${workspaceKey}\0${params.configScope ?? "effective"}`;
  const existing = inFlightLoads.get(loadKey);
  if (existing && (params.fresh || (params.background && existing.revision < revision))) {
    await existing.task;
    return loadInto(set, get, { ...params, fresh: false });
  }
  const request = existing ?? { task: runLoadInto({ ...params, workspaceKey }), revision };
  inFlightLoads.set(loadKey, request);
  try {
    const result = await request.task;
    const current = get();
    if (
      current.workspacePath !== params.workspacePath ||
      current.workspaceIdentity !== params.workspaceIdentity ||
      current.authorityKey !== params.authorityKey ||
      current.configScope !== params.configScope
    )
      return;
    set(
      params.background && current.error
        ? { ...result, error: current.error, lastFailedPluginId: current.lastFailedPluginId }
        : result,
    );
  } finally {
    if (inFlightLoads.get(loadKey) === request) inFlightLoads.delete(loadKey);
  }
}

async function runLoadInto(
  params: PluginLoadParams & { workspaceKey: string },
): Promise<Partial<PluginManagementState>> {
  try {
    const [listResult, overviewResult] = await Promise.all([
      params.pluginService.listPlugins({
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
        ...(params.configScope ? { configScope: params.configScope } : {}),
      }),
      params.pluginService.getPluginsOverview({
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
        ...(params.configScope ? { configScope: params.configScope } : {}),
      }),
    ]);
    const diagnostics = [...listResult.diagnostics, ...overviewResult.diagnostics];
    return {
      plugins: listResult.plugins,
      marketplaces: overviewResult.marketplaces,
      marketplaceAvailabilityKnown: true,
      availablePlugins: overviewResult.availablePlugins,
      installedPlugins: overviewResult.installedPlugins,
      restorableBuiltins: overviewResult.restorableBuiltins,
      diagnostics,
      loading: false,
    };
  } catch (error) {
    logger.error("[plugins] overview/list failed", {
      workspacePath: params.workspacePath,
      workspaceKey: params.workspaceKey,
      lastFailedPluginId: null,
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      const result = await params.pluginService.listPlugins({
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
        ...(params.configScope ? { configScope: params.configScope } : {}),
      });
      return {
        plugins: result.plugins,
        marketplaces: [],
        marketplaceAvailabilityKnown: false,
        availablePlugins: [],
        installedPlugins: [],
        restorableBuiltins: [],
        diagnostics: result.diagnostics,
        loading: false,
      };
    } catch (listError) {
      logger.error("[plugins] list fallback failed", {
        workspacePath: params.workspacePath,
        workspaceKey: params.workspaceKey,
        lastFailedPluginId: null,
        error: listError instanceof Error ? listError.message : String(listError),
      });
      return {
        loading: false,
        marketplaceAvailabilityKnown: false,
        lastFailedPluginId: null,
        error: listError instanceof Error ? listError.message : String(listError),
      };
    }
  }
}
