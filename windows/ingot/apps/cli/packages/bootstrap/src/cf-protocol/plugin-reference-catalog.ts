import {
  CF_OFFICIAL_PLUGIN_MARKETPLACE_ID,
  cfProtocolNotifications,
  cfPluginsReferenceCatalogParamsSchema,
  cfPluginsResolveSuggestedReferenceParamsSchema,
  type CfPluginReferenceCatalogEntry,
  type CfPluginDiagnostic as SharedPluginDiagnostic,
  type CfPluginsReferenceCatalogResult,
  type CfPluginsResolveSuggestedReferenceResult,
} from "@origin-ai/cf-shared";
import type { PluginReferenceCatalogEntry } from "@origin-ai/cf-contracts";
import { buildPluginReferenceCatalog } from "@origin-ai/cf-core";
import {
  enrichCachedClaudeMarketplaceIconsForOverview,
  getCfPluginsOverview,
  resolveCfPlugins,
  updateCfPluginMarketplace,
} from "../plugins.js";
import {
  parseParams,
  requireSession,
  type CfProtocolAgentServerContext,
} from "./server-types.js";

export async function getPluginReferenceCatalog(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
  includeCategory = false,
): Promise<CfPluginsReferenceCatalogResult> {
  const params = parseParams(cfPluginsReferenceCatalogParamsSchema, rawParams);
  if (params.sessionId) {
    const record = requireSession(context, params.sessionId);
    const displayByPluginId = resolveReferenceListingDisplayByPluginId(
      params.workspace.workspacePath,
    );
    return {
      authority: "session",
      plugins: record.app
        .getPluginReferenceCatalog()
        .plugins.map((entry) => toReferenceCatalogEntry(entry, displayByPluginId, includeCategory)),
    };
  }
  const outcome = resolveCfPlugins({
    workingDirectory: params.workspace.workspacePath,
  });
  const displayByPluginId = resolveReferenceListingDisplayByPluginId(
    params.workspace.workspacePath,
  );
  return {
    authority: "workspace",
    plugins: buildPluginReferenceCatalog(outcome.plugins).plugins.map((entry) =>
      toReferenceCatalogEntry(entry, displayByPluginId, includeCategory),
    ),
  };
}

const SUGGESTED_PLUGIN_MARKETPLACE = CF_OFFICIAL_PLUGIN_MARKETPLACE_ID;
const SUGGESTED_PLUGIN_MARKETPLACE_REFRESH_TIMEOUT_MS = 10_000;

export async function resolveSuggestedPluginReference(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
  signal?: AbortSignal,
): Promise<CfPluginsResolveSuggestedReferenceResult> {
  const params = parseParams(cfPluginsResolveSuggestedReferenceParamsSchema, rawParams);
  const stableId = params.stableId.trim();
  const at = stableId.lastIndexOf("@");
  const pluginName = at > 0 ? stableId.slice(0, at) : "";
  const marketplace = at > 0 ? stableId.slice(at + 1) : "";
  const diagnostic = (code: string, message: string): SharedPluginDiagnostic => ({
    code,
    message,
    severity: "error",
    pluginId: stableId,
  });
  const unavailable = (code: string, message: string) => ({
    stableId,
    status: "unavailable" as const,
    diagnostics: [diagnostic(code, message)],
  });

  if (
    !pluginName ||
    marketplace !== SUGGESTED_PLUGIN_MARKETPLACE ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(stableId)
  ) {
    return unavailable(
      "plugin_suggested_reference_untrusted_source",
      "推荐插件不是受信任的官方 cf-plugins-official 来源",
    );
  }

  const workingDirectory = params.workspace.workspacePath;
  const readState = () => {
    const outcome = resolveCfPlugins({ logger: context.logger, workingDirectory });
    const entry = buildPluginReferenceCatalog(outcome.plugins).plugins.find(
      (candidate) => candidate.pluginId === stableId,
    );
    return { outcome, entry };
  };
  let displayByPluginId: Map<string, PluginReferenceListingDisplay> | undefined;
  const resolveIcon = () => {
    displayByPluginId ??= resolveReferenceListingDisplayByPluginId(workingDirectory);
    return displayByPluginId.get(stableId)?.icon;
  };
  const toResult = (entry: PluginReferenceCatalogEntry) => {
    const icon = resolveIcon();
    return {
      stableId,
      status: (entry.conflictingPluginIds.length > 0
        ? "conflict"
        : entry.enabled
          ? "ready"
          : "disabled") as "conflict" | "ready" | "disabled",
      marketplace,
      pluginName,
      sourceTrust: "official" as const,
      ...(icon ? { icon } : {}),
      diagnostics:
        entry.conflictingPluginIds.length > 0
          ? [
              diagnostic(
                "plugin_suggested_reference_conflict",
                "推荐插件存在同名冲突，不能自动安装或引用",
              ),
            ]
          : [],
    };
  };

  const initial = readState();
  if (initial.entry) return toResult(initial.entry);

  context.notify({
    method: cfProtocolNotifications.pluginOperationProgress,
    params: { operationId: params.operationId, state: "refreshing" },
  });

  const refreshController = new AbortController();
  const abortRefresh = () => refreshController.abort(signal?.reason);
  if (signal?.aborted) abortRefresh();
  else signal?.addEventListener("abort", abortRefresh, { once: true });
  let refreshTimedOut = false;
  let refreshTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const refreshRequest = updateCfPluginMarketplace({
      abortSignal: refreshController.signal,
      logger: context.logger,
      marketplace: SUGGESTED_PLUGIN_MARKETPLACE,
      workingDirectory,
    });
    const refreshTimeoutRequest = new Promise<never>((_, reject) => {
      refreshTimeout = setTimeout(() => {
        refreshTimedOut = true;
        const timeoutError = new Error("刷新 cf-plugins-official 超时（10000 ms）");
        timeoutError.name = "TimeoutError";
        refreshController.abort(timeoutError);
        reject(timeoutError);
      }, SUGGESTED_PLUGIN_MARKETPLACE_REFRESH_TIMEOUT_MS);
    });
    const refreshed = await Promise.race([refreshRequest, refreshTimeoutRequest]);
    if (signal?.aborted) return unavailable("plugin_operation_cancelled", "插件操作已取消");
    const failure = refreshed.diagnostics.find(
      (item) => item.pluginId === SUGGESTED_PLUGIN_MARKETPLACE,
    );
    if (failure) return unavailable("marketplace_refresh_failed", failure.message);
  } catch (error) {
    if (refreshTimedOut) {
      return unavailable(
        "marketplace_refresh_failed",
        error instanceof Error ? error.message : String(error),
      );
    }
    if (signal?.aborted) {
      return unavailable("plugin_operation_cancelled", "插件操作已取消");
    }
    return unavailable(
      "marketplace_refresh_failed",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (refreshTimeout !== undefined) clearTimeout(refreshTimeout);
    signal?.removeEventListener("abort", abortRefresh);
  }

  const afterRefresh = readState();
  if (afterRefresh.entry) return toResult(afterRefresh.entry);
  const overview = getCfPluginsOverview({ logger: context.logger, workingDirectory });
  const candidate = overview.availablePlugins.find((item) => item.id === stableId);
  if (
    !candidate ||
    candidate.name !== pluginName ||
    candidate.marketplace !== SUGGESTED_PLUGIN_MARKETPLACE
  ) {
    return unavailable("plugin_suggested_reference_not_listed", "刷新后的官方目录中未找到该插件");
  }
  const icon = candidate.listing?.icon?.trim();
  return {
    stableId,
    status: "missing",
    marketplace: SUGGESTED_PLUGIN_MARKETPLACE,
    pluginName: candidate.name,
    sourceTrust: "official",
    ...(icon ? { icon } : {}),
    ...(candidate.listing ? { listing: candidate.listing } : {}),
    diagnostics: [],
  };
}

interface PluginReferenceListingDisplay {
  category?: string;
  icon?: string;
  displayName?: string;
  displayNameI18n?: Record<string, string>;
  description?: string;
  descriptionI18n?: Record<string, string>;
}

function resolveReferenceListingDisplayByPluginId(
  workspacePath: string,
): Map<string, PluginReferenceListingDisplay> {
  enrichCachedClaudeMarketplaceIconsForOverview({ workingDirectory: workspacePath });
  const overview = getCfPluginsOverview({ workingDirectory: workspacePath });
  const displayByPluginId = new Map<string, PluginReferenceListingDisplay>();
  for (const plugin of [
    ...overview.availablePlugins,
    ...overview.installedPlugins,
    ...overview.restorableBuiltins,
  ]) {
    const category = plugin.listing?.category?.trim();
    const icon = plugin.listing?.icon?.trim();
    const displayName = plugin.listing?.displayName?.trim();
    const displayNameI18n = plugin.listing?.displayNameI18n;
    const description = plugin.description?.trim();
    const descriptionI18n = plugin.listing?.descriptionI18n;
    if (!category && !icon && !displayName && !displayNameI18n && !description && !descriptionI18n)
      continue;
    displayByPluginId.set(plugin.id, {
      ...displayByPluginId.get(plugin.id),
      ...(category ? { category } : {}),
      ...(icon ? { icon } : {}),
      ...(displayName ? { displayName } : {}),
      ...(displayNameI18n ? { displayNameI18n } : {}),
      ...(description ? { description } : {}),
      ...(descriptionI18n ? { descriptionI18n } : {}),
    });
  }
  return displayByPluginId;
}

function toReferenceCatalogEntry(
  entry: PluginReferenceCatalogEntry,
  displayByPluginId: ReadonlyMap<string, PluginReferenceListingDisplay>,
  includeCategory = false,
): CfPluginReferenceCatalogEntry {
  const display = displayByPluginId.get(entry.pluginId);
  return {
    ...(includeCategory ? { category: display?.category ?? "other" } : {}),
    pluginId: entry.pluginId,
    name: entry.name,
    marketplace: entry.marketplace,
    ...(display?.icon ? { icon: display.icon } : {}),
    ...(display?.displayName ? { displayName: display.displayName } : {}),
    ...(display?.displayNameI18n ? { displayNameI18n: display.displayNameI18n } : {}),
    ...(display?.description ? { description: display.description } : {}),
    ...(display?.descriptionI18n ? { descriptionI18n: display.descriptionI18n } : {}),
    enabled: entry.enabled,
    conflictingPluginIds: entry.conflictingPluginIds,
    skillQualifiedNames: entry.skillQualifiedNames,
    mcpServerNames: entry.mcpServerNames,
    subagentNames: entry.subagentNames ?? [],
  };
}
