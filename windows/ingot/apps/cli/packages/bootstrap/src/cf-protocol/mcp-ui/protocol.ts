import { SessionEventType, createEventId } from "@origin-ai/cf-contracts";
import {
  cfMcpReadResourceParamsSchema,
  cfMcpUiCallToolParamsSchema,
  cfMcpUiCancelCallParamsSchema,
  cfMcpUiCloseInstanceParamsSchema,
  cfMcpUiListResourcesParamsSchema,
  cfMcpUiOpenInstanceParamsSchema,
  cfMcpUiReadResourceParamsSchema,
  cfMcpUiResourceSubscriptionParamsSchema,
  type CfMcpReadResourceResult,
  type CfMcpUiCallToolResult,
  type CfMcpUiCancelCallResult,
  type CfMcpUiListResourceTemplatesResult,
  type CfMcpUiListResourcesResult,
  type CfMcpUiReadResourceResult,
} from "@origin-ai/cf-shared";
import {
  ProtocolRequestError,
  parseParams,
  requireSession,
  type CfProtocolAgentServerContext,
} from "../server-types.js";
import { getMcpUiAppToolRegistry } from "./appToolsProtocol.js";
import {
  McpUiNotSupportedError,
  McpUiResourceRejectedError,
  McpUiServerScopeError,
  McpUiToolAccessError,
} from "./contract.js";
import { clearMcpUiInstanceCalls, createMcpUiHandlers } from "./handlers.js";
import { mcpUiInstances } from "./instances.js";
import { createMcpUiSessionAccess } from "./sessionAccess.js";

export async function readMcpUiResource(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
  signal?: AbortSignal,
): Promise<CfMcpReadResourceResult> {
  const params = parseParams(cfMcpReadResourceParamsSchema, rawParams);
  const record = requireSession(context, params.sessionId, { operation: "mcp/readResource" });
  const active = mcpUiInstances.validate(
    params.instance,
    params,
    record.app.getMcpAppConnectionSnapshot(params.serverName),
  );
  if (active.binding.resourceUri !== params.uri)
    throw new ProtocolRequestError(-32602, "MCP App resource binding mismatch");
  return translateScopeError(() =>
    createMcpUiHandlers({ logger: context.logger }).readResource(
      createMcpUiSessionAccess(record, params),
      params,
      { signal },
    ),
  );
}

export async function callMcpUiTool(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
  signal?: AbortSignal,
): Promise<CfMcpUiCallToolResult> {
  const params = parseParams(cfMcpUiCallToolParamsSchema, rawParams);
  const record = requireSession(context, params.sessionId, { operation: "mcp/uiCallTool" });
  return translateScopeError(() =>
    createMcpUiHandlers({ logger: context.logger }).callTool(
      createMcpUiSessionAccess(record, params),
      params,
      { signal },
    ),
  );
}

export async function cancelMcpUiToolCall(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfMcpUiCancelCallResult> {
  const params = parseParams(cfMcpUiCancelCallParamsSchema, rawParams);
  const record = requireSession(context, params.sessionId, { operation: "mcp/uiCancelCall" });
  return translateScopeError(async () =>
    createMcpUiHandlers({ logger: context.logger }).cancelToolCall(
      createMcpUiSessionAccess(record, params),
      params,
    ),
  );
}

export async function listMcpUiResources(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
  signal?: AbortSignal,
): Promise<CfMcpUiListResourcesResult> {
  const params = parseParams(cfMcpUiListResourcesParamsSchema, rawParams);
  const record = requireSession(context, params.sessionId, { operation: "mcp/uiListResources" });
  return translateScopeError(() =>
    createMcpUiHandlers({ logger: context.logger }).listResources(
      createMcpUiSessionAccess(record, params),
      params,
      { signal },
    ),
  );
}

export async function listMcpUiResourceTemplates(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
  signal?: AbortSignal,
): Promise<CfMcpUiListResourceTemplatesResult> {
  const params = parseParams(cfMcpUiListResourcesParamsSchema, rawParams);
  const record = requireSession(context, params.sessionId, {
    operation: "mcp/uiListResourceTemplates",
  });
  return translateScopeError(() =>
    createMcpUiHandlers({ logger: context.logger }).listResourceTemplates(
      createMcpUiSessionAccess(record, params),
      params,
      { signal },
    ),
  );
}

export async function subscribeMcpUiResource(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
  signal?: AbortSignal,
): Promise<Record<string, never>> {
  const params = parseParams(cfMcpUiResourceSubscriptionParamsSchema, rawParams);
  const record = requireSession(context, params.sessionId, {
    operation: "mcp/uiSubscribeResource",
  });
  await translateScopeError(() =>
    createMcpUiHandlers({ logger: context.logger }).subscribeResource(
      createMcpUiSessionAccess(record, params),
      params,
      { signal },
    ),
  );
  return {};
}

export async function unsubscribeMcpUiResource(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
  signal?: AbortSignal,
): Promise<Record<string, never>> {
  const params = parseParams(cfMcpUiResourceSubscriptionParamsSchema, rawParams);
  const record = requireSession(context, params.sessionId, {
    operation: "mcp/uiUnsubscribeResource",
  });
  await translateScopeError(() =>
    createMcpUiHandlers({ logger: context.logger }).unsubscribeResource(
      createMcpUiSessionAccess(record, params),
      params,
      { signal },
    ),
  );
  return {};
}

export async function readMcpUiResourceForUi(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
  signal?: AbortSignal,
): Promise<CfMcpUiReadResourceResult> {
  const params = parseParams(cfMcpUiReadResourceParamsSchema, rawParams);
  const record = requireSession(context, params.sessionId, { operation: "mcp/uiReadResource" });
  return translateScopeError(() =>
    createMcpUiHandlers({ logger: context.logger }).readResourceForUi(
      createMcpUiSessionAccess(record, params),
      params,
      { signal },
    ),
  );
}

async function translateScopeError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof McpUiServerScopeError) {
      throw new ProtocolRequestError(error.code, error.message, {
        serverName: error.serverName,
      });
    }
    if (error instanceof McpUiToolAccessError) {
      throw new ProtocolRequestError(error.code, error.message, {
        reason: error.reason,
        serverName: error.serverName,
        toolName: error.toolName,
      });
    }
    if (error instanceof McpUiNotSupportedError) {
      throw new ProtocolRequestError(error.code, error.message, {
        reason: error.reason,
        serverName: error.serverName,
        operation: error.operation,
      });
    }
    if (error instanceof McpUiResourceRejectedError) {
      throw new ProtocolRequestError(error.code, error.message, {
        reason: error.reason,
        uri: error.uri,
        ...error.detail,
      });
    }
    throw error;
  }
}

export async function openMcpUiInstance(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
) {
  const params = parseParams(cfMcpUiOpenInstanceParamsSchema, rawParams);
  const record = requireSession(context, params.sessionId, { operation: "mcp/uiOpenInstance" });
  const source = await record.app.waitForMcpAppConnection(params.serverName);
  const current = record.app.getMcpAppConnectionSnapshot(params.serverName);
  if (
    context.sessions.get(params.sessionId) !== record ||
    !source ||
    current?.identity !== source.identity ||
    current.generation !== source.generation
  )
    throw new ProtocolRequestError(-32001, "MCP App connection is unavailable");
  const lease = mcpUiInstances.open(
    {
      workspace: params.workspace.workspaceIdentity?.trim() || params.workspace.workspacePath,
      accountContext: params.accountContext,
      sessionId: params.sessionId,
      pluginId: params.pluginId,
      serverName: params.serverName,
      scopeId: params.scopeId,
      resourceUri: params.resourceUri,
      ownerWebContentsId: params.ownerWebContentsId,
    },
    source,
  );
  const active = mcpUiInstances.validate(lease, params, source);
  if (active.watched) return lease;
  active.watched = true;
  active.onActivity = (callId, activity) =>
    context.v4Gateway?.ingest(params.sessionId, {
      id: createEventId(),
      sessionId: params.sessionId as never,
      type: SessionEventType.PluginUiAppToolCallRequested,
      timestamp: new Date(),
      traceId: String(record.traceContext.traceId) as never,
      sequenceNumber: 0,
      payload: {
        pluginId: params.pluginId,
        serverName: params.serverName,
        subscribers: [{ scopeId: lease.token, generation: lease.generation, instance: lease }],
        callId,
        toolName: "",
        arguments: {},
        activity,
      },
    });
  const off = record.app.onMcpAppConnectionInvalidated(params.serverName, () =>
    mcpUiInstances.close(lease),
  );
  active.cancel.signal.addEventListener(
    "abort",
    () => {
      off();
      clearMcpUiInstanceCalls(params.sessionId, lease.token);
      getMcpUiAppToolRegistry(context).unregister(params.sessionId, {
        scopeId: lease.token,
        generation: lease.generation,
      });
      void record.app
        .unsubscribeMcpResourcesForUi(`${params.sessionId}|${lease.token}|`)
        .catch(() => undefined);
      context.v4Gateway?.ingest(params.sessionId, {
        id: createEventId(),
        sessionId: params.sessionId as never,
        type: SessionEventType.PluginUiInstanceClosed,
        timestamp: new Date(),
        traceId: String(record.traceContext.traceId) as never,
        sequenceNumber: 0,
        payload: {
          pluginId: params.pluginId,
          serverName: params.serverName,
          subscribers: [{ scopeId: lease.token, generation: lease.generation, instance: lease }],
        },
      });
    },
    { once: true },
  );
  return lease;
}
export async function closeMcpUiInstance(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
) {
  const params = parseParams(cfMcpUiCloseInstanceParamsSchema, rawParams);
  const active = mcpUiInstances.find(params.instance.token);
  if (active) mcpUiInstances.validate(params.instance, params, active.source);
  if (params.onlyIfIdle && mcpUiInstances.isBusy(params.instance)) return { closed: false };
  if (mcpUiInstances.close(params.instance)) {
    getMcpUiAppToolRegistry(context).unregister(params.sessionId, {
      scopeId: params.instance.token,
      generation: params.instance.generation,
    });
    await context.sessions
      .get(params.sessionId)
      ?.app.unsubscribeMcpResourcesForUi(`${params.sessionId}|${params.instance.token}|`);
  }
  return { closed: true };
}

export async function validateMcpUiInstance(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
) {
  const params = parseParams(cfMcpUiCloseInstanceParamsSchema, rawParams);
  const record = requireSession(context, params.sessionId, { operation: "mcp/uiValidateInstance" });
  mcpUiInstances.validate(
    params.instance,
    params,
    record.app.getMcpAppConnectionSnapshot(params.serverName),
  );
  return {};
}
