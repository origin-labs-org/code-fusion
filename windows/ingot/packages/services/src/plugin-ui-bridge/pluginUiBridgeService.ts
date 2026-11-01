import {
  collectTelemetryRendererContext,
  resolveWorkspaceTelemetryDetail,
  type RendererTelemetryEventPayload,
} from "@origin-ai/cf-shared";
import type {
  CfMcpReadResourceResult,
  CfMcpUiCallToolResult,
  CfMcpUiCancelCallResult,
  CfMcpUiListResourceTemplatesResult,
  CfMcpUiListResourcesResult,
  CfMcpUiReadResourceResult,
  CfPluginsListUiSurfacesResult,
} from "@origin-ai/cf-shared";
import type {
  McpAppResourceMeta,
  PluginSandboxHandle,
  PluginSandboxRegisterInput,
} from "@origin-ai/cf-shared/mcp-apps";
import {
  MCP_APPS_HTML_MAX_BYTES,
  MCP_APPS_HTML_MIME_TYPES,
  MCP_APPS_UI_READ_RESOURCE_MAX_BYTES,
  normalizeMcpAppResourceMeta,
} from "@origin-ai/cf-shared/mcp-apps";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type {
  IPluginUiBridgeService,
  PluginUiCallToolParams,
  PluginUiCancelToolCallParams,
  PluginUiListResourcesParams,
  PluginUiPrepareSandboxParams,
  PluginUiReadResourceParams,
  PluginUiResourceSubscriptionParams,
  PluginUiWorkspaceTarget,
} from "./contract.js";

export interface PluginUiBridgeServiceDependencies {
  reportTelemetryEvent?: (event: RendererTelemetryEventPayload) => void | Promise<void>;
  recycleInstance?: (params: import("./contract.js").PluginUiPluginScope) => Promise<boolean>;
  validateInstance?: (params: import("./contract.js").PluginUiPluginScope) => Promise<void>;
  openInstance?: (
    params: PluginUiPrepareSandboxParams,
  ) => Promise<import("@origin-ai/cf-shared/mcp-apps").McpAppInstance>;
  closeInstance?: (params: import("./contract.js").PluginUiPluginScope) => Promise<void>;

  readMcpResource?: (params: {
    workspacePath: string;
    workspaceIdentity?: string;
    sessionId: string;
    pluginId: string;
    serverName: string;
    uri: string;
    instance: import("@origin-ai/cf-shared/mcp-apps").McpAppInstance;
  }) => Promise<CfMcpReadResourceResult>;
  callMcpToolForUi?: (
    params: PluginUiCallToolParams,
    options?: { signal?: AbortSignal },
  ) => Promise<CfMcpUiCallToolResult>;
  
  cancelMcpToolCallForUi?: (
    params: PluginUiCancelToolCallParams,
  ) => Promise<CfMcpUiCancelCallResult>;
  
  readMcpResourceForUi?: (
    params: PluginUiReadResourceParams,
  ) => Promise<CfMcpUiReadResourceResult>;
  
  listMcpResourcesForUi?: (
    params: PluginUiListResourcesParams,
  ) => Promise<CfMcpUiListResourcesResult>;
  listMcpResourceTemplatesForUi?: (
    params: PluginUiListResourcesParams,
  ) => Promise<CfMcpUiListResourceTemplatesResult>;
  subscribeMcpResourceForUi?: (params: PluginUiResourceSubscriptionParams) => Promise<unknown>;
  unsubscribeMcpResourceForUi?: (params: PluginUiResourceSubscriptionParams) => Promise<unknown>;
  registerSandbox?: (input: PluginSandboxRegisterInput) => Promise<PluginSandboxHandle>;
  
  listPluginUiSurfaces?: (
    params: PluginUiWorkspaceTarget,
  ) => Promise<CfPluginsListUiSurfacesResult>;
  
}

export class PluginUiBridgeError extends Error {
  constructor(
    readonly code:
      | "unavailable"
      | "resource_not_found"
      | "resource_too_large"
      | "unsupported_mime_type"
      | "invalid_server_uri",
    message: string,
  ) {
    super(message);
    this.name = "PluginUiBridgeError";
  }
}

export function createPluginUiBridgeService(
  dependencies: PluginUiBridgeServiceDependencies = {},
): IPluginUiBridgeService {
  const log = createServiceLogger("plugin-ui-bridge");
  const preparing = new Map<string, Promise<PluginSandboxHandle>>();
  const prepareSandboxOnce = async (
    params: PluginUiPrepareSandboxParams,
    instance: import("@origin-ai/cf-shared/mcp-apps").McpAppInstance,
  ) => {
    if (
      !dependencies.readMcpResource ||
      !dependencies.registerSandbox ||
      !dependencies.openInstance
    ) {
      throw new PluginUiBridgeError(
        "unavailable",
        "Plugin UI sandbox is unavailable in this runtime",
      );
    }
    const bound = { ...params, instance };
    const startedAt = Date.now();
    log.info("prepareSandbox start", {
      sessionId: params.sessionId,
      pluginId: params.pluginId,
      scopeId: params.scopeId,
      resourceUri: params.resourceUri,
    });
    let result: CfMcpReadResourceResult;
    try {
      result = await dependencies.readMcpResource({ ...bound, uri: params.resourceUri });
    } catch (error) {
      log.warn("prepareSandbox readResource failed", {
        scopeId: params.scopeId,
        resourceUri: params.resourceUri,
        error: error instanceof Error ? error.message : String(error),
      });
      await dependencies.closeInstance?.(bound);
      throw error;
    }
    try {
      const picked = pickHtmlResource(result, params.resourceUri);
      const { html } = picked;
      const meta =
        picked.meta ?? (await readListLevelResourceMeta(dependencies.listMcpResourcesForUi, bound));
      const csp = meta?.csp ?? params.csp;
      const prefersBorder = meta?.prefersBorder ?? params.prefersBorder;
      log.info("prepareSandbox resource ready", {
        scopeId: params.scopeId,
        htmlBytes: Buffer.byteLength(html, "utf8"),
        hasResourceMeta: meta !== null,
        durationMs: Date.now() - startedAt,
      });
      const handle = await dependencies.registerSandbox({
        instance,
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
        ownerWebContentsId: params.ownerWebContentsId,
        sessionId: params.sessionId,
        pluginId: params.pluginId,
        serverName: params.serverName,
        scopeId: params.scopeId,
        html,
        ...(csp ? { csp } : {}),
        ...(meta?.cspRelaxations ? { cspRelaxations: meta.cspRelaxations } : {}),
        ...(meta?.permissions ? { permissions: meta.permissions } : {}),
        ...(prefersBorder !== undefined ? { prefersBorder } : {}),
        ...(meta?.heightHint !== undefined ? { heightHint: meta.heightHint } : {}),
        ...(meta?.minFrameHeight !== undefined ? { minFrameHeight: meta.minFrameHeight } : {}),
        ...(meta?.showInline !== undefined ? { showInline: meta.showInline } : {}),
      });
      log.info("prepareSandbox registered", {
        scopeId: params.scopeId,
        sandboxId: handle.sandboxId,
        initId: handle.initId,
        durationMs: Date.now() - startedAt,
      });
      return handle;
    } catch (error) {
      log.warn("prepareSandbox register failed", {
        scopeId: params.scopeId,
        error: error instanceof Error ? error.message : String(error),
      });
      await dependencies.closeInstance?.(bound);
      throw error;
    }
  };

  return {
    async recycleInstance(params) {
      return dependencies.recycleInstance ? dependencies.recycleInstance(params) : false;
    },
    async validateInstance(params) {
      await dependencies.validateInstance?.(params);
    },
    async closeInstance(params) {
      await dependencies.closeInstance?.(params);
    },
    async prepareSandbox(params) {
      if (!dependencies.openInstance) throw unavailable("instance identity");
      const instance = await dependencies.openInstance(params);
      const key = JSON.stringify([
        instance.runtimeId,
        instance.token,
        instance.generation,
        params.resourceUri,
      ]);
      const existing = preparing.get(key);
      if (existing) return existing;
      const pending = prepareSandboxOnce(params, instance).finally(() => {
        if (preparing.get(key) === pending) preparing.delete(key);
      });
      preparing.set(key, pending);
      return pending;
    },
    async callTool(params, options) {
      if (!dependencies.callMcpToolForUi) {
        throw new PluginUiBridgeError(
          "unavailable",
          "Plugin UI tool calls are unavailable in this runtime",
        );
      }
      const startedAt = Date.now();
      const report = (result: "success" | "failure" | "cancelled") => {
        try {
          void Promise.resolve(
            dependencies.reportTelemetryEvent?.({
              elementName: "plugin_usage",
              eventRegion: "app",
              eventType: "result",
              context: collectTelemetryRendererContext(),
              eventExtraDetail: {
                schema_version: "1",
                action: "ui_tool_call",
                result,
                plugin_id: params.pluginId,
                plugin_component: "ui",
                duration_ms: String(Math.max(0, Date.now() - startedAt)),
                ...resolveWorkspaceTelemetryDetail(params),
              },
            }),
          ).catch(() => {});
        } catch {
          
        }
      };
      try {
        const result = await dependencies.callMcpToolForUi(params, options);
        report(result.isError ? "failure" : "success");
        return result;
      } catch (error) {
        report(
          options?.signal?.aborted || (error instanceof Error && error.name === "AbortError")
            ? "cancelled"
            : "failure",
        );
        throw error;
      }
    },
    async cancelToolCall(params) {
      if (!dependencies.cancelMcpToolCallForUi) return { cancelled: false };
      return dependencies.cancelMcpToolCallForUi(params);
    },
    async readResource(params) {
      if (!dependencies.readMcpResourceForUi) {
        throw new PluginUiBridgeError(
          "unavailable",
          "Plugin UI resource reads are unavailable in this runtime",
        );
      }
      const result = await dependencies.readMcpResourceForUi(params);
      assertUiReadResourceSize(result, params.uri);
      return result;
    },
    async listResources(params) {
      if (!dependencies.listMcpResourcesForUi) throw unavailable("resource listing");
      return dependencies.listMcpResourcesForUi(params);
    },
    async listResourceTemplates(params) {
      if (!dependencies.listMcpResourceTemplatesForUi) throw unavailable("resource listing");
      return dependencies.listMcpResourceTemplatesForUi(params);
    },
    async subscribeResource(params) {
      if (!dependencies.subscribeMcpResourceForUi) throw unavailable("resource subscriptions");
      await dependencies.subscribeMcpResourceForUi(params);
    },
    async unsubscribeResource(params) {
      if (!dependencies.unsubscribeMcpResourceForUi) return;
      await dependencies.unsubscribeMcpResourceForUi(params);
    },
    async listSurfaces(params) {
      if (!dependencies.listPluginUiSurfaces) return [];
      return (await dependencies.listPluginUiSurfaces(params)).surfaces;
    },
  };
}

function unavailable(feature: string): PluginUiBridgeError {
  return new PluginUiBridgeError(
    "unavailable",
    `Plugin UI ${feature} are unavailable in this runtime`,
  );
}

export function assertUiReadResourceSize(result: CfMcpUiReadResourceResult, uri: string): void {
  let total = 0;
  for (const content of result.contents) {
    if (typeof content.text === "string") total += Buffer.byteLength(content.text, "utf8");
    if (typeof content.blob === "string") total += decodedBase64Length(content.blob);
  }
  if (total > MCP_APPS_UI_READ_RESOURCE_MAX_BYTES) {
    throw new PluginUiBridgeError(
      "resource_too_large",
      `MCP resource ${uri} decodes to ${total} bytes, exceeding the ${MCP_APPS_UI_READ_RESOURCE_MAX_BYTES} byte limit for resources/read`,
    );
  }
}

function decodedBase64Length(value: string): number {
  const trimmed = value.replace(/\s+/g, "");
  if (trimmed.length === 0) return 0;
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0;
  return Math.floor((trimmed.length * 3) / 4) - padding;
}

export function pickHtmlContent(result: CfMcpReadResourceResult, uri: string): string {
  return pickHtmlResource(result, uri).html;
}

const LIST_LEVEL_META_MAX_PAGES = 8;

async function readListLevelResourceMeta(
  list: PluginUiBridgeServiceDependencies["listMcpResourcesForUi"],
  params: PluginUiPrepareSandboxParams & {
    instance: import("@origin-ai/cf-shared/mcp-apps").McpAppInstance;
  },
): Promise<McpAppResourceMeta | null> {
  if (!list) return null;
  const scope = {
    instance: params.instance,
    workspacePath: params.workspacePath,
    ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
    sessionId: params.sessionId,
    pluginId: params.pluginId,
    serverName: params.serverName,
  };
  let cursor: string | undefined;
  try {
    for (let page = 0; page < LIST_LEVEL_META_MAX_PAGES; page += 1) {
      const result = await list({ ...scope, ...(cursor ? { cursor } : {}) });
      const entry = result.resources.find((item) => item.uri === params.resourceUri);
      if (entry) return normalizeMcpAppResourceMeta(entry._meta);
      if (!result.nextCursor) return null;
      cursor = result.nextCursor;
    }
  } catch {
    return null;
  }
  return null;
}

export function pickHtmlResource(
  result: CfMcpReadResourceResult,
  uri: string,
): { html: string; meta: McpAppResourceMeta | null } {
  if (result.contents.length === 0) {
    throw new PluginUiBridgeError("resource_not_found", `MCP resource has no contents: ${uri}`);
  }
  const isHtml = (mimeType: string | undefined) => {
    const normalized = normalizeMimeType(mimeType);
    return (
      normalized !== null && (MCP_APPS_HTML_MIME_TYPES as readonly string[]).includes(normalized)
    );
  };
  const content =
    result.contents.find((item) => item.uri === uri && isHtml(item.mimeType)) ??
    result.contents.find((item) => isHtml(item.mimeType));
  if (!content) {
    const first = result.contents[0]!;
    throw new PluginUiBridgeError(
      "unsupported_mime_type",
      `MCP resource mimeType is not HTML: ${first.mimeType ?? "(missing)"}`,
    );
  }
  if (typeof content.text !== "string") {
    throw new PluginUiBridgeError(
      "unsupported_mime_type",
      "MCP resource must return HTML as text, blob is not accepted",
    );
  }
  if (Buffer.byteLength(content.text, "utf8") > MCP_APPS_HTML_MAX_BYTES) {
    throw new PluginUiBridgeError(
      "resource_too_large",
      `MCP resource exceeds ${MCP_APPS_HTML_MAX_BYTES} bytes`,
    );
  }
  return { html: content.text, meta: normalizeMcpAppResourceMeta(content._meta) };
}

function normalizeMimeType(value: string | undefined): string | null {
  if (!value) return null;
  const parts = value
    .split(";")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part && !part.startsWith("charset="));
  return parts.join(";");
}
