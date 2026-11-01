
import { z } from "zod";
import {
  MCP_USAGE_QUOTA_LIMIT_TYPE,
  buildRuntimeCfApiUrl,
  type ApiClient,
  type UsageMcpQuotaScope,
  type UsageMcpQuotaSnapshot,
  type UsageQuotaLimit,
} from "@origin-ai/cf-shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import {
  buildOfficialMcpAuthHeaders,
  type OfficialMcpCredentialOutcome,
} from "#src/official-mcp/officialMcpCredentials.js";

const MCP_USAGE_PATH = "/api/v1/mcp/usage";
const REQUEST_TIMEOUT_MS = 15_000;
const log = createServiceLogger("usage-stats");

export interface OfficialMcpCredentialSource {
  resolve(): Promise<OfficialMcpCredentialOutcome>;
}

const mcpUsageTotalSchema = z.object({
  used: z.number().finite(),
  limit: z.number().finite(),
  remaining: z.number().finite(),
});

const mcpUsageDataSchema = z.object({
  server_time: z.number().finite(),
  next_refresh_at: z.number().finite().optional(),
  level: z.string().optional(),
  
  total_usage: mcpUsageTotalSchema.optional(),
});

const mcpUsageEnvelopeSchema = z.object({
  code: z.number(),
  msg: z.string().optional(),
  data: mcpUsageDataSchema.optional().nullable(),
});

export interface McpQuotaRequestScope {
  providerFamily: "zai" | "bigmodel";
  organizationId?: string | null;
  projectId?: string | null;
}

export function matchesMcpQuotaScope(
  scope: UsageMcpQuotaScope,
  request: McpQuotaRequestScope,
): boolean {
  if (scope.providerFamily !== request.providerFamily) {
    return false;
  }
  const requestOrganizationId = request.organizationId?.trim() ?? "";
  const requestProjectId = request.projectId?.trim() ?? "";
  const requestIsTeam = Boolean(requestOrganizationId && requestProjectId);
  if (!requestIsTeam) {
    return scope.targetType === "PERSONAL";
  }
  if (scope.targetType !== "TEAM") return false;
  return (
    (scope.organizationId?.trim() ?? "") === requestOrganizationId &&
    (scope.projectId?.trim() ?? "") === requestProjectId
  );
}

export function buildMcpQuotaAggregateLimit(params: {
  totalUsage: { used: number; limit: number; remaining: number };
  nextResetTime?: number;
}): UsageQuotaLimit | null {
  const limit = Math.max(0, params.totalUsage.limit);
  if (limit <= 0) {
    return null;
  }
  const remaining = Math.min(Math.max(0, params.totalUsage.remaining), limit);
  const used = Math.max(0, params.totalUsage.used);

  const usedPercentage = Math.max(0, Math.min(100, 100 - (remaining / limit) * 100));
  return {
    type: MCP_USAGE_QUOTA_LIMIT_TYPE,
    currentValue: used,
    usage: used,
    remaining,
    percentage: usedPercentage,
    ...(params.nextResetTime === undefined ? {} : { nextResetTime: params.nextResetTime }),
    usageDetails: [],
  };
}

function readScopeFromCredentialSnapshot(
  snapshot: Extract<OfficialMcpCredentialOutcome, { ok: true }>["snapshot"],
): UsageMcpQuotaScope | null {
  const scope = snapshot.planScope;
  if (!scope) return null;
  return scope.targetType === "TEAM"
    ? {
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        providerFamily: snapshot.providerFamily,
        targetType: "TEAM",
      }
    : { providerFamily: snapshot.providerFamily, targetType: "PERSONAL" };
}

function readRequestId(headers: Headers): string | null {
  return headers.get("x-request-id")?.trim() || null;
}

const MAX_LOGGED_BODY_CHARS = 512;

function truncateForLog(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_LOGGED_BODY_CHARS
    ? `${trimmed.slice(0, MAX_LOGGED_BODY_CHARS)}…(${trimmed.length} chars)`
    : trimmed;
}

export async function fetchMcpQuotaSnapshot(params: {
  apiClient: ApiClient;
  credentialSource: OfficialMcpCredentialSource;
  env: NodeJS.ProcessEnv;
  requestScope: McpQuotaRequestScope;
}): Promise<UsageMcpQuotaSnapshot | null> {
  let outcome: OfficialMcpCredentialOutcome;
  try {
    outcome = await params.credentialSource.resolve();
  } catch (error) {
    log.warn(undefined, "读取官方 MCP 额度凭证失败，跳过该额度", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (!outcome.ok) {
    log.info(undefined, "官方 MCP 额度不可用，跳过请求", { reason: outcome.reason });
    return null;
  }

  const scope = readScopeFromCredentialSnapshot(outcome.snapshot);
  if (!scope) {
    log.info(undefined, "官方 MCP 额度缺少可精确归属的套餐 scope，跳过请求", {
      credentialFamily: outcome.snapshot.providerFamily,
    });
    return null;
  }
  if (!matchesMcpQuotaScope(scope, params.requestScope)) {
    log.info(undefined, "官方 MCP 额度归属与本次查询不一致，跳过请求", {
      credentialFamily: scope.providerFamily,
      credentialTargetType: scope.targetType ?? null,
      requestFamily: params.requestScope.providerFamily,
      requestOrganizationId: params.requestScope.organizationId ?? null,
      requestProjectId: params.requestScope.projectId ?? null,
    });
    return null;
  }

  const url = buildRuntimeCfApiUrl(params.env, MCP_USAGE_PATH);
  const headers = buildOfficialMcpAuthHeaders(outcome.snapshot);
  let payload: unknown;
  let requestId: string | null = null;
  let body = "";
  log.info(undefined, "官方 MCP 额度请求", {
    credentialFamily: scope.providerFamily,
    credentialTargetType: scope.targetType ?? null,
    headerNames: Object.keys(headers).sort(),
    method: "GET",
    timeoutMs: REQUEST_TIMEOUT_MS,
    url,
  });
  const startedAt = Date.now();
  try {
    const response = await params.apiClient.request(url, {
      method: "GET",
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers,
    });
    requestId = readRequestId(response.headers);
    const text = await response.text();
    body = truncateForLog(text);
    log.info(undefined, "官方 MCP 额度响应", {
      body,
      durationMs: Date.now() - startedAt,
      status: response.status,
      url,
      "x-request-id": requestId,
    });
    if (!response.ok) {
      log.warn(undefined, "官方 MCP 额度请求失败", {
        body,
        status: response.status,
        url,
        "x-request-id": requestId,
      });
      return null;
    }
    payload = JSON.parse(text) as unknown;
  } catch (error) {
    log.warn(undefined, "官方 MCP 额度请求异常", {
      body,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      url,
      "x-request-id": requestId,
    });
    return null;
  }

  const envelope = mcpUsageEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    log.warn(undefined, "官方 MCP 额度响应结构不符合预期", {
      body,
      issues: envelope.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.code}`,
      ),
      url,
      "x-request-id": requestId,
    });
    return null;
  }
  if (envelope.data.code !== 0 || !envelope.data.data) {
    log.warn(undefined, "官方 MCP 额度业务失败", {
      code: envelope.data.code,
      msg: envelope.data.msg ?? null,
      "x-request-id": requestId,
    });
    return null;
  }

  const data = envelope.data.data;
  if (!data.total_usage) {
    log.warn(undefined, "官方 MCP 额度响应缺少 total_usage", {
      body,
      url,
      "x-request-id": requestId,
    });
    return null;
  }
  const aggregate = buildMcpQuotaAggregateLimit({
    totalUsage: data.total_usage,
    ...(data.next_refresh_at === undefined ? {} : { nextResetTime: data.next_refresh_at * 1000 }),
  });
  if (!aggregate) {
    return null;
  }

  return {
    aggregate,
    level: data.level?.trim() || null,
    scope,
    serverTime: data.server_time * 1000,
  };
}
