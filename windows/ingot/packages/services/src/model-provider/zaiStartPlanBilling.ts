import type { ApiClient } from "@origin-ai/cf-shared";
import {
  buildRuntimeCfEndpointUrls,
  normalizeOfficialGlmModelId,
  CF_VERSION,
} from "@origin-ai/cf-shared";
import { readApiJson } from "../providers/api/apiJson.js";

const REQUEST_TIMEOUT_MS = 15_000;
const ZAI_START_PLAN_BALANCE_URL = buildRuntimeCfEndpointUrls(
  process.env,
).cfPlanBillingBalanceUrl;

export interface ZaiStartPlanPlan {
  user_plan_id?: string;
  plan_id?: string;
  name?: string;
  status?: string;
  starts_at?: number | string | null;
  ends_at?: number | string | null;
  entitlements?: Array<{
    entitlement_id?: string | null;
    show_name?: string | null;
    period?: string | null;
    effective_at?: number | string | null;
  }>;
}

export interface ZaiStartPlanBalanceEnvelope {
  code?: number;
  success?: boolean;
  msg?: string;
  data?: {
    server_time?: number;
    plans?: ZaiStartPlanPlan[];
    balances?: Array<{
      bucket_id?: string;
      user_plan_id?: string;
      plan_id?: string;
      entitlement_id?: string;
      show_name?: string;
      meter?: string;
      unit_type?: string;
      capabilities?: string[];
      total_units?: number | string | null;
      used_units?: number | string | null;
      reserved_units?: number | string | null;
      remaining_units?: number | string | null;
      available_units?: number | string | null;
      period_start?: number | string | null;
      period_end?: number | string | null;
      expires_at?: number | string | null;
    }>;
  };
}

const inflightBalanceRequests = new WeakMap<
  ApiClient,
  Map<string, Promise<ZaiStartPlanBalanceEnvelope>>
>();

export function buildZaiStartPlanBalanceUrl(): string {
  const url = new URL(ZAI_START_PLAN_BALANCE_URL);
  url.searchParams.set("app_version", CF_VERSION);
  return url.toString();
}

export async function fetchZaiStartPlanBalanceEnvelope(
  apiClient: ApiClient,
  authorization: string,
  invalidateCache = false,
): Promise<ZaiStartPlanBalanceEnvelope> {
  const requestKey = JSON.stringify({
    authorization: authorization.trim(),
    url: buildZaiStartPlanBalanceUrl(),
  });

  let requests = inflightBalanceRequests.get(apiClient);
  if (!requests) {
    requests = new Map();
    inflightBalanceRequests.set(apiClient, requests);
  }

  if (invalidateCache) requests.delete(requestKey);
  const inflight = requests.get(requestKey);
  if (inflight) {
    return inflight;
  }

  const url = buildZaiStartPlanBalanceUrl();
  const startedAt = Date.now();
  let responseTime: number | undefined;
  const observedApi: ApiClient = {
    request: async (input, init) => {
      const response = await apiClient.request(input, init);
      const date = Date.parse(response.headers.get("date") ?? "");
      if (Number.isFinite(date)) responseTime = date / 1000;
      return response;
    },
  };
  const request = readApiJson<ZaiStartPlanBalanceEnvelope>(observedApi, url, {
    method: "GET",
    timeoutMs: REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: authorization,
    },
  })
    .then((payload) => normalizeStartPlanExpiry(payload, responseTime))
    .finally(() => {
      const evict = () => {
        if (requests?.get(requestKey) !== request) return;
        requests.delete(requestKey);
        if (requests.size === 0) inflightBalanceRequests.delete(apiClient);
      };
      const remainingMs = 1000 - (Date.now() - startedAt);
      if (remainingMs > 0) setTimeout(evict, remainingMs);
      else evict();
    });

  requests.set(requestKey, request);
  return request;
}

export function resolveZaiStartPlanBalanceModelIds(payload: ZaiStartPlanBalanceEnvelope): string[] {
  const seen = new Set<string>();
  const modelIds: string[] = [];

  for (const balance of payload.data?.balances ?? []) {
    const fromCapabilities = (balance.capabilities ?? [])
      .map((capability) => {
        const normalized = capability.trim();
        return normalized.toLowerCase().startsWith("model:")
          ? normalized.slice("model:".length).trim()
          : "";
      })
      .filter(Boolean);
    const candidates = fromCapabilities.length > 0 ? fromCapabilities : [balance.show_name ?? ""];
    for (const candidate of candidates) {
      const modelId = normalizeOfficialGlmModelId(candidate.trim());
      const key = modelId.toLowerCase();
      if (!modelId || seen.has(key)) {
        continue;
      }
      seen.add(key);
      modelIds.push(modelId);
    }
  }

  return modelIds;
}

function normalizeStartPlanExpiry(
  payload: ZaiStartPlanBalanceEnvelope,
  responseTime?: number,
): ZaiStartPlanBalanceEnvelope {
  if (!payload.data) return payload;
  const serverTime = payload.data.server_time;
  const now =
    responseTime ??
    (typeof serverTime === "number" && Number.isFinite(serverTime) && serverTime >= 0
      ? serverTime
      : Date.now() / 1000);
  const plans = (payload.data.plans ?? []).map((plan) => {
    const end = Number(plan.ends_at);
    return plan.status?.trim().toLowerCase() === "active" &&
      Number.isFinite(end) &&
      end > 0 &&
      end <= now
      ? { ...plan, status: "expired" }
      : plan;
  });
  const balances = payload.data.balances?.filter((balance) => {
    const owners = plans.filter((plan) =>
      balance.user_plan_id && plan.user_plan_id
        ? plan.user_plan_id === balance.user_plan_id
        : plan.plan_id === balance.plan_id,
    );
    return !owners.length || owners.some((plan) => plan.status?.trim().toLowerCase() !== "expired");
  });
  return { ...payload, data: { ...payload.data, plans, balances } };
}
