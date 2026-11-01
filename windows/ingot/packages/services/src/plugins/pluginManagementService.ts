import {
  collectTelemetryRendererContext,
  resolveWorkspaceTelemetryDetail,
  type RendererTelemetryEventPayload,
} from "@origin-ai/cf-shared";
import type { ICfAgentService } from "../cf-agent/cfAgent.js";
import type { IPluginManagementService } from "./pluginManagement.js";

interface PluginOperationTelemetry {
  entry?: string;
  client_kind?: string;
}

type Params = {
  workspacePath?: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  dryRun?: boolean;
  pluginId?: string;
  pluginName?: string;
  marketplace?: string;
  telemetry?: PluginOperationTelemetry;
};

type Result = unknown;

interface PluginRecord {
  id?: unknown;
  version?: unknown;
  marketplace?: unknown;
}

type TelemetryOutcome =
  | { result: "success" }
  | { result: "failure"; errorCategory: string }
  | { result: "cancelled" }
  | { result: "noop" }
  | { result: "partial"; errorCategory?: string };

export interface CreatePluginManagementServiceOptions {
  cfAgentService: ICfAgentService;
  reportTelemetryEvent?: (
    event: RendererTelemetryEventPayload,
  ) => void | Promise<void>;
  now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readArrayField(result: unknown, field: string): unknown[] {
  if (!isRecord(result)) return [];
  const value = result[field];
  return Array.isArray(value) ? value : [];
}

function readPlugins(result: unknown, field: string): PluginRecord[] {
  return readArrayField(result, field).filter(isRecord);
}

function readDiagnostics(result: unknown): Record<string, unknown>[] {
  return readArrayField(result, "diagnostics").filter(isRecord);
}

function hasErrorDiagnostic(diagnostics: readonly Record<string, unknown>[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function isAbortError(error: unknown): boolean {
  if (!isRecord(error) && typeof error !== "object") return false;
  const candidate = error as { name?: unknown; data?: unknown };
  if (candidate.name === "AbortError") return true;
  return isRecord(candidate.data) && candidate.data.name === "AbortError";
}

function resolveOutcome(
  action: string,
  result: unknown,
  error: unknown,
): TelemetryOutcome {
  if (error !== undefined) {
    return isAbortError(error)
      ? { result: "cancelled" }
      : { result: "failure", errorCategory: "exception" };
  }
  const diagnostics = readDiagnostics(result);
  const installed = readPlugins(result, "installedPlugins");
  if (hasErrorDiagnostic(diagnostics)) {
    return installed.length > 0
      ? { result: "partial", errorCategory: "diagnostic" }
      : { result: "failure", errorCategory: "diagnostic" };
  }
  if (diagnostics.length > 0) return { result: "partial" };
  if (action === "uninstall" && installed.length === 0) return { result: "noop" };
  return { result: "success" };
}

function resolvePluginFromResult(result: unknown): PluginRecord | undefined {
  return (
    readPlugins(result, "installedPlugins")[0] ??
    readPlugins(result, "plugins")[0] ??
    undefined
  );
}

function resolvePluginId(
  plugin: PluginRecord | undefined,
  params: Params,
): string | undefined {
  if (typeof plugin?.id === "string" && plugin.id) return plugin.id;
  if (typeof params.pluginId === "string" && params.pluginId) return params.pluginId;
  if (typeof params.pluginName === "string" && params.pluginName) {
    return typeof params.marketplace === "string" && params.marketplace
      ? `${params.pluginName}@${params.marketplace}`
      : params.pluginName;
  }
  return undefined;
}

export function createPluginManagementService(
  options: CreatePluginManagementServiceOptions,
): IPluginManagementService {
  const agent = options.cfAgentService;
  const now = options.now ?? Date.now;
  const report = (
    action: string,
    params: Params,
    startedAt: number,
    result?: Result,
    error?: unknown,
  ): void => {
    if (params.dryRun === true) return;
    const outcome = resolveOutcome(action, result, error);
    const plugin = resolvePluginFromResult(result);
    const pluginId = resolvePluginId(plugin, params);
    const versionAfter =
      typeof plugin?.version === "string" && plugin.version ? plugin.version : undefined;
    const telemetry = params.telemetry;
    try {
      void Promise.resolve(
        options.reportTelemetryEvent?.({
          elementName: "plugin_lifecycle",
          eventRegion: "app",
          eventType: "result",
          context: collectTelemetryRendererContext(),
          eventExtraDetail: {
            schema_version: "1",
            action,
            result: outcome.result,
            ...(pluginId ? { plugin_id: pluginId } : {}),
            ...(versionAfter ? { version_after: versionAfter } : {}),
            ...("errorCategory" in outcome && outcome.errorCategory
              ? { error_category: outcome.errorCategory }
              : {}),
            ...(telemetry?.entry ? { entry: telemetry.entry } : {}),
            ...(telemetry?.client_kind ? { client_kind: telemetry.client_kind } : {}),
            duration_ms: String(Math.max(0, now() - startedAt)),
            ...resolveWorkspaceTelemetryDetail(params),
          },
        }),
      ).catch(() => {});
    } catch {
      // Telemetry must never change the plugin operation result.
    }
  };
  const observe = async <T extends Result>(
    action: string,
    params: Params,
    invoke: (clean: Params) => Promise<T>,
  ): Promise<T> => {
    const startedAt = now();
    const { telemetry: _telemetry, ...clean } = params;
    try {
      const result = await invoke(clean);
      report(action, params, startedAt, result);
      return result;
    } catch (error) {
      report(action, params, startedAt, undefined, error);
      throw error;
    }
  };
  return {
    listPlugins: (params) => agent.listPlugins(params),
    getPluginReferenceCatalog: (params) => agent.getPluginReferenceCatalog(params),
    resolveSuggestedPluginReference: (params) => agent.resolveSuggestedPluginReference(params),
    onDynamicPluginOperationProgress: (operationId) =>
      agent.onDynamicPluginOperationProgress(operationId),
    getPluginsOverview: (params) => agent.getPluginsOverview(params),
    addPluginMarketplace: (params) =>
      observe("source_add", params, (clean) => agent.addPluginMarketplace(clean as unknown as typeof params)),
    removePluginMarketplace: (params) =>
      observe("source_remove", params, (clean) =>
        agent.removePluginMarketplace(clean as unknown as typeof params),
      ),
    updatePluginMarketplace: (params) =>
      observe("source_refresh", params, (clean) =>
        agent.updatePluginMarketplace(clean as unknown as typeof params),
      ),
    installPlugin: (params) =>
      observe("install", params, (clean) => agent.installPlugin(clean as unknown as typeof params)),
    cancelPluginOperation: (params) => agent.cancelPluginOperation(params),
    uninstallPlugin: (params) =>
      observe("uninstall", params, (clean) => agent.uninstallPlugin(clean as unknown as typeof params)),
    updatePlugin: (params) =>
      observe("update", params, (clean) => agent.updatePlugin(clean as unknown as typeof params)),
    restoreBuiltinPlugin: (params) =>
      observe("restore", params, (clean) => agent.restoreBuiltinPlugin(clean as unknown as typeof params)),
    configurePlugin: (params) =>
      observe("configure", params, (clean) => agent.configurePlugin(clean as unknown as typeof params)),
    resetPluginConfig: (params) =>
      observe("reset_config", params, (clean) => agent.resetPluginConfig(clean as unknown as typeof params)),
    validatePlugin: (params) => agent.validatePlugin(params),
    describePlugin: (params) => agent.describePlugin(params),
    setPluginEnabled: (params) =>
      observe(params.enabled ? "enable" : "disable", params, (clean) =>
        agent.setPluginEnabled(clean as unknown as typeof params),
      ),
  };
}
