
import {
  findOfficialMcpReservedHeaders,
  isOfficialMcpReservedHeaderName,
  summarizeOfficialMcpIdentityHeaders,
  type McpServerFailureKind,
  type OfficialMcpAuthFailureKind,
} from "@origin-ai/cf-shared";
import type {
  Logger,
  McpOfficialProvenance,
  OfficialMcpAuthHeadersPort,
  OfficialMcpTrustedOriginRegistry,
} from "@origin-ai/cf-contracts";

export class OfficialMcpAuthError extends Error {
  constructor(
    readonly kind: OfficialMcpAuthFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "OfficialMcpAuthError";
  }
}

const REQUEST_ID_HEADER = "x-request-id";
const TRACE_ID_HEADER = "x-trace-id";

export interface CreateOfficialMcpAuthFetchInput {
  authHeadersPort?: OfficialMcpAuthHeadersPort;
  baseFetch: typeof globalThis.fetch;
  logger?: Logger;
  
  onAuthFailure?: (kind: OfficialMcpAuthFailureKind) => void;
  
  onServerResponse?: (response: OfficialMcpServerResponseInfo) => void;
  official: McpOfficialProvenance;
  serverName: string;
  trustedOrigins: OfficialMcpTrustedOriginRegistry;
  
  url: string;
  workspaceIdentity?: string;
  workspacePath?: string;
}

export interface OfficialMcpServerResponseInfo {
  failureKind?: McpServerFailureKind;
  httpStatus: number;
  rpcMethod?: string;
  rpcToolName?: string;
  
  serverRequestId?: string;
  
  spanId?: string;
  traceId?: string;
}

export function createOfficialMcpAuthFetch(
  input: CreateOfficialMcpAuthFetchInput,
): typeof globalThis.fetch {
  const expectedOrigin = safeOrigin(input.url);

  
  const failWith = (kind: OfficialMcpAuthFailureKind, message: string): OfficialMcpAuthError => {
    input.onAuthFailure?.(kind);
    return new OfficialMcpAuthError(kind, message);
  };

  const authFetch = async (
    resource: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ): Promise<Response> => {
    const requestUrl = resolveRequestUrl(resource);
    const origin = safeOrigin(requestUrl);
    if (!origin || !expectedOrigin || origin !== expectedOrigin) {
      throw failWith(
        "official_mcp_origin_untrusted",
        `official MCP request origin does not match the configured endpoint: ${input.serverName}`,
      );
    }
    const trust = await input.trustedOrigins.isTrusted({
      mcpKey: input.official.mcpKey,
      origin,
      pluginId: input.official.pluginId,
    });
    if (!trust.trusted) {
      throw failWith(
        "official_mcp_origin_untrusted",
        `official MCP origin is not trusted (${trust.detail ?? "unknown"}): ` +
          `${input.serverName} origin=${origin} pluginId=${input.official.pluginId}`,
      );
    }

    const rpc = describeJsonRpc(init?.body);
    const logBase = {
      event: "mcp.official_auth.request",
      mcpKey: input.official.mcpKey,
      mcpServerName: input.serverName,
      module: "adapters.mcp.official_auth",
      requestBodyBytes: byteLength(init?.body),
      urlPath: safePath(requestUrl),
      ...(rpc.method ? { rpcMethod: rpc.method } : {}),
      ...(rpc.id !== undefined ? { rpcId: rpc.id } : {}),
      ...(rpc.toolName ? { rpcToolName: rpc.toolName } : {}),
      ...(rpc.traceId ? { mcpTraceId: rpc.traceId } : {}),
    };

    const send = async (attempt: number): Promise<{ authApplied: boolean; response: Response }> => {
      let authHeaders: Record<string, string> = {};
      let resolveDurationMs: number | undefined;
      if (input.authHeadersPort) {
        const resolveStartedAt = Date.now();
        const resolved = await input.authHeadersPort.resolveHeaders({
          mcpKey: input.official.mcpKey,
          pluginId: input.official.pluginId,
          targetOrigin: origin,
          ...(input.workspaceIdentity ? { workspaceIdentity: input.workspaceIdentity } : {}),
          ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
          ...(init?.signal ? { signal: init.signal } : {}),
        });
        resolveDurationMs = Date.now() - resolveStartedAt;
        if (resolved.ok) {
          authHeaders = resolved.headers;
        } else {
          input.logger?.warn("Official MCP auth headers unavailable for request", {
            ...logBase,
            attempt,
            event: "mcp.official_auth.resolve",
            fallback: "anonymous",
            reason: resolved.reason,
            resolveDurationMs,
            status: "failed",
          });
        }
      } else {
        input.logger?.warn("Official MCP auth port unavailable for request", {
          ...logBase,
          attempt,
          event: "mcp.official_auth.resolve",
          fallback: "anonymous",
          reason: "official_auth_unavailable",
          status: "failed",
        });
      }
      const identity = summarizeOfficialMcpIdentityHeaders(authHeaders);
      const headers = mergeOfficialAuthHeaders(init?.headers, authHeaders);

      //
      //
      //
      headers.delete(REQUEST_ID_HEADER);
      headers.delete(TRACE_ID_HEADER);

      input.logger?.debug("Official MCP request sending", {
        ...logBase,
        attempt,
        resolveDurationMs,
        status: "started",
        timeoutHint: describeAbortSignal(init?.signal),
        ...identity,
      });

      const sendStartedAt = Date.now();
      try {
        const response = await input.baseFetch(resource, {
          ...init,
          headers,
          redirect: "manual",
        });
        const serverRequestId = readServerRequestId(response);
        const failureKind =
          rpc.method === "tools/call" ? undefined : await classifyOfficialMcpResponse(response);
        if (serverRequestId || failureKind) {
          input.onServerResponse?.({
            httpStatus: response.status,
            ...(failureKind ? { failureKind } : {}),
            ...(serverRequestId ? { serverRequestId } : {}),
            ...(rpc.method ? { rpcMethod: rpc.method } : {}),
            ...(rpc.toolName ? { rpcToolName: rpc.toolName } : {}),
            ...(rpc.spanId ? { spanId: rpc.spanId } : {}),
            ...(rpc.traceId ? { traceId: rpc.traceId } : {}),
          });
        }
        const outcome = {
          ...logBase,
          attempt,
          httpStatus: response.status,
          responseBodyBytes: numericHeader(response.headers.get("content-length")),
          sendDurationMs: Date.now() - sendStartedAt,
          ...(serverRequestId ? { serverRequestId } : {}),
        };
        if (response.ok) {
          input.logger?.debug("Official MCP response received", {
            ...outcome,
            status: "completed",
          });
        } else {
          //
          //
          input.logger?.warn("Official MCP response failed", {
            ...outcome,
            status: "failed",
          });
        }
        return { authApplied: Object.keys(authHeaders).length > 0, response };
      } catch (error) {
        const sendDurationMs = Date.now() - sendStartedAt;
        input.logger?.warn("Official MCP request did not complete", {
          ...logBase,
          aborted: isAbortError(error),
          attempt,
          error: error instanceof Error ? error.message : String(error),
          errorName: error instanceof Error ? error.name : "unknown",
          sendDurationMs,
          status: "failed",
        });
        throw error;
      }
    };

    let sent = await send(1);
    let response = sent.response;
    if (response.status === 401 && sent.authApplied) {
      input.logger?.info("Official MCP retrying once after 401", {
        ...logBase,
        attempt: 2,
        status: "started",
      });
      await discardBody(response);
      sent = await send(2);
      response = sent.response;
    }

    if (response.status === 401) {
      const baseMessage = "official MCP rejected the current credential";
      const message =
        rpc.method === "tools/call" ? withServerRequestId(baseMessage, response) : baseMessage;
      await discardBody(response);
      throw failWith("official_auth_rejected", message);
    }
    if (response.status === 403) {
      const baseMessage = "official MCP denied access for the current plan";
      const message =
        rpc.method === "tools/call" ? withServerRequestId(baseMessage, response) : baseMessage;
      await discardBody(response);
      throw failWith("official_auth_forbidden", message);
    }
    if (isRedirect(response.status)) {
      const baseMessage = `official MCP responded with a blocked redirect (${response.status})`;
      const message =
        rpc.method === "tools/call" ? withServerRequestId(baseMessage, response) : baseMessage;
      await discardBody(response);
      throw failWith("official_auth_redirect_blocked", message);
    }
    return response;
  };

  return authFetch as typeof globalThis.fetch;
}

const MAX_DIAGNOSTIC_RESPONSE_BYTES = 64 * 1024;

async function classifyOfficialMcpResponse(
  response: Response,
): Promise<McpServerFailureKind | undefined> {
  if (response.status === 429) return "rate_limited";
  if (response.status >= 500) return "server_internal_error";

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("json")) {
    return response.ok ? undefined : "connection_failed";
  }
  const text = await readBoundedResponseText(response, MAX_DIAGNOSTIC_RESPONSE_BYTES);
  if (!text) return response.ok ? undefined : "connection_failed";
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return response.ok ? undefined : "connection_failed";
    }
    const record = parsed as Record<string, unknown>;
    if (record["code"] === 3001) return "server_not_found";
    if (record["code"] === 1000) return "server_unavailable";
    if (record["jsonrpc"] === "2.0" && record["error"] !== undefined) {
      const rpcError = record["error"];
      if (rpcError && typeof rpcError === "object" && !Array.isArray(rpcError)) {
        const code = (rpcError as Record<string, unknown>)["code"];
        if (code === 1006) return "not_authenticated";
        if (code === 3101) return "coding_plan_required";
      }
      return "protocol_error";
    }
  } catch {
    return response.ok ? undefined : "connection_failed";
  }
  return response.ok ? undefined : "connection_failed";
}

async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string | undefined> {
  const declaredLength = numericHeader(response.headers.get("content-length"));
  if (declaredLength !== undefined && declaredLength > maxBytes) return undefined;
  const body = response.clone().body;
  if (!body) return undefined;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return undefined;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

export function mergeOfficialAuthHeaders(
  incoming: HeadersInit | undefined,
  authHeaders: Record<string, string>,
): Headers {
  const merged = new Headers();
  const authHeaderNames = new Set(Object.keys(authHeaders).map((name) => name.toLowerCase()));
  new Headers(incoming ?? {}).forEach((value, name) => {
    const normalized = name.toLowerCase();
    if (authHeaderNames.has(normalized)) return;
    if (
      isOfficialMcpReservedHeaderName(normalized) &&
      normalized !== "mcp-session-id" &&
      normalized !== "mcp-protocol-version"
    ) {
      return;
    }
    merged.set(name, value);
  });
  for (const [name, value] of Object.entries(authHeaders)) {
    merged.set(name, value);
  }
  return merged;
}

export { findOfficialMcpReservedHeaders };

function resolveRequestUrl(resource: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof resource === "string") return resource;
  if (resource instanceof URL) return resource.toString();
  return resource.url;
}

function safeOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.username !== "" || url.password !== "") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function readServerRequestId(response: Response): string | undefined {
  const value = response.headers.get(REQUEST_ID_HEADER)?.trim();
  return value ? value : undefined;
}

function withServerRequestId(message: string, response: Response): string {
  const requestId = readServerRequestId(response);
  return requestId ? `${message} - ${requestId}` : message;
}

function safePath(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return "(unparsable)";
  }
}

function byteLength(body: unknown): number | undefined {
  if (typeof body === "string") return Buffer.byteLength(body, "utf8");
  if (body instanceof Uint8Array) return body.byteLength;
  return undefined;
}

function numericHeader(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function describeJsonRpc(body: unknown): {
  id?: number | string;
  method?: string;
  spanId?: string;
  toolName?: string;
  traceId?: string;
} {
  if (typeof body !== "string" || body.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    const method = typeof record.method === "string" ? record.method : undefined;
    const id =
      typeof record.id === "number" || typeof record.id === "string" ? record.id : undefined;
    const params = isPlainRecord(record.params) ? record.params : undefined;
    const toolName = params && typeof params.name === "string" ? params.name : undefined;
    const meta = params && isPlainRecord(params._meta) ? params._meta : undefined;
    const traceId = meta && typeof meta.trace_id === "string" ? meta.trace_id : undefined;
    const spanId = meta && typeof meta.span_id === "string" ? meta.span_id : undefined;
    return {
      ...(id !== undefined ? { id } : {}),
      ...(method ? { method } : {}),
      ...(spanId ? { spanId } : {}),
      ...(toolName ? { toolName } : {}),
      ...(traceId ? { traceId } : {}),
    };
  } catch {
    return {};
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeAbortSignal(signal: AbortSignal | null | undefined): string {
  if (!signal) return "none";
  return signal.aborted ? "already-aborted" : "armed";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
  }
}
