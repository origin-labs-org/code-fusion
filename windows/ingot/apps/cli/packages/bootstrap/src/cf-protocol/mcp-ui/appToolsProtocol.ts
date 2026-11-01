import {
  SessionEventType,
  createEventId,
  type PluginUiAppToolCallRequestedPayload,
  type SessionEvent,
} from "@origin-ai/cf-contracts";
import {
  cfMcpUiClaimAppToolCallParamsSchema,
  cfMcpUiRegisterAppToolsParamsSchema,
  cfMcpUiResolveAppToolCallParamsSchema,
  cfMcpUiUnregisterAppToolsParamsSchema,
  type CfMcpUiAppToolAcceptedResult,
  type CfMcpUiRegisterAppToolsResult,
  type CfMcpUiUnregisterAppToolsResult,
} from "@origin-ai/cf-shared";
import {
  ProtocolRequestError,
  parseParams,
  requireSession,
  type CfProtocolAgentServerContext,
} from "../server-types.js";
import { McpUiAppToolRegistry } from "./appTools.js";
import { McpUiServerScopeError } from "./contract.js";
import { assertMcpUiServerScope } from "./handlers.js";
import { mcpUiInstances } from "./instances.js";
import { createMcpUiSessionAccess } from "./sessionAccess.js";

const registries = new WeakMap<CfProtocolAgentServerContext, McpUiAppToolRegistry>();

export function getMcpUiAppToolRegistry(
  context: CfProtocolAgentServerContext,
): McpUiAppToolRegistry {
  let registry = registries.get(context);
  if (!registry) {
    registry = new McpUiAppToolRegistry({
      applyTools: (sessionId, definitions, execute) => {
        const record = context.sessions.get(sessionId);
        return record
          ? record.app.replaceMcpAppProvidedTools(
              definitions.map((definition) => ({
                ...definition,
                retainExecution: (callId: string) =>
                  mcpUiInstances.retain(definition.scopeId, callId),
              })),
              execute,
            )
          : null;
      },
      publishCall: (sessionId, target, call) => {
        const record = context.sessions.get(sessionId);
        if (!record || !context.v4Gateway) return;
        const payload: PluginUiAppToolCallRequestedPayload = {
          pluginId: target.pluginId,
          serverName: target.serverName,
          subscribers: [{ ...target.instance, instance: target.credential }],
          cancelled: call.cancelled,
          callId: call.callId,
          toolName: call.toolName,
          arguments: call.arguments,
        };
        const event: SessionEvent = {
          id: createEventId(),
          sessionId: sessionId as never,
          type: SessionEventType.PluginUiAppToolCallRequested,
          timestamp: new Date(),
          traceId: String(record.traceContext.traceId) as never,
          sequenceNumber: 0,
          payload,
        };
        context.v4Gateway.ingest(sessionId, event);
      },
      ...(context.logger ? { logger: context.logger } : {}),
    });
    registries.set(context, registry);
  }
  return registry;
}

async function withScopeError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof McpUiServerScopeError) {
      throw new ProtocolRequestError(error.code, error.message, { serverName: error.serverName });
    }
    throw error;
  }
}

export async function registerMcpUiAppTools(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfMcpUiRegisterAppToolsResult> {
  const params = parseParams(cfMcpUiRegisterAppToolsParamsSchema, rawParams);
  const record = requireSession(context, params.sessionId, {
    operation: "mcp/uiRegisterAppTools",
  });
  return withScopeError(async () => {
    await assertMcpUiServerScope(createMcpUiSessionAccess(record, params), params);
    if (
      params.scopeId !== params.instance.token ||
      params.generation !== params.instance.generation
    )
      throw new Error("Invalid MCP App registration binding");
    return getMcpUiAppToolRegistry(context).register(params);
  });
}

export async function unregisterMcpUiAppTools(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfMcpUiUnregisterAppToolsResult> {
  const params = parseParams(cfMcpUiUnregisterAppToolsParamsSchema, rawParams);
  if (params.scopeId !== params.instance.token || params.generation !== params.instance.generation)
    throw new Error("Invalid MCP App binding");
  if (!context.sessions.has(params.sessionId)) return { removed: 0 };
  return { removed: getMcpUiAppToolRegistry(context).unregister(params.sessionId, params) };
}

export async function claimMcpUiAppToolCall(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfMcpUiAppToolAcceptedResult> {
  const params = parseParams(cfMcpUiClaimAppToolCallParamsSchema, rawParams);
  const record = requireSession(context, params.sessionId, { operation: "mcp/uiClaimAppToolCall" });
  mcpUiInstances.validate(
    params.instance,
    params,
    record.app.getMcpAppConnectionSnapshot(params.serverName),
  );
  if (params.scopeId !== params.instance.token || params.generation !== params.instance.generation)
    throw new Error("Invalid MCP App binding");
  return { accepted: getMcpUiAppToolRegistry(context).claim(params) };
}

export async function resolveMcpUiAppToolCall(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfMcpUiAppToolAcceptedResult> {
  const params = parseParams(cfMcpUiResolveAppToolCallParamsSchema, rawParams);
  const record = requireSession(context, params.sessionId, {
    operation: "mcp/uiResolveAppToolCall",
  });
  mcpUiInstances.validate(
    params.instance,
    params,
    record.app.getMcpAppConnectionSnapshot(params.serverName),
  );
  if (params.scopeId !== params.instance.token || params.generation !== params.instance.generation)
    throw new Error("Invalid MCP App binding");
  return { accepted: getMcpUiAppToolRegistry(context).resolve(params) };
}

export function clearMcpUiAppToolsForSession(
  context: CfProtocolAgentServerContext,
  sessionId: string,
): void {
  mcpUiInstances.closeSession(sessionId);
  registries.get(context)?.clearSession(sessionId);
}
