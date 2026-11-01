import type { CfEnv } from "./env.js";

export const DEFAULT_CF_ENDPOINT_ORIGIN = "https://cf.z.ai";
export const TEST_CF_ENDPOINT_ORIGIN = "https://cf.z.ai";
export const CODING_PLAN_LOCAL_WEBVIEW_ORIGIN = "http://localhost:3000";
export const DEFAULT_BIGMODEL_API_ORIGIN = "https://bigmodel.cn";
export const TEST_BIGMODEL_API_ORIGIN = "https://bigmodel.cn";
export const DEFAULT_ZAI_OAUTH_ORIGIN = "https://chat.z.ai";
export const TEST_ZAI_OAUTH_ORIGIN = "https://chat.z.ai";
export const DEFAULT_ZAI_BUSINESS_BASE_URL = "https://api.z.ai";
export const TEST_ZAI_BUSINESS_BASE_URL = "https://api.z.ai";
export const DEFAULT_ZAI_OAUTH_CLIENT_ID = "client_P8X5CMWmlaRO9gyO-KSqtg";
export const TEST_ZAI_OAUTH_CLIENT_ID = "client_P8X5CMWmlaRO9gyO-KSqtg";
export const DEFAULT_WEB_REMOTE_CONTROL_RELAY_WS_URL = "wss://cf.z.ai/api/v1/remote/ws2";
export const WEB_REMOTE_CONTROL_V4_MIN_APP_VERSION = "3.4.0";

export interface BuildCfEndpointUrlsOptions {
  appVersion?: string;
}

function isWebRemoteControlV4AppVersion(appVersion: string | undefined): boolean {
  if (!appVersion) {
    return false;
  }

  const normalizedVersion = appVersion.trim().replace(/^v/i, "");
  const match = normalizedVersion.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([^+]+))?(?:\+(.+))?$/,
  );
  if (!match) {
    return false;
  }

  const prereleaseIdentifiers = match[4]?.split(".");
  const hasValidPrerelease =
    prereleaseIdentifiers === undefined ||
    prereleaseIdentifiers.every(
      (identifier) =>
        /^[0-9A-Za-z-]+$/.test(identifier) &&
        (!/^\d+$/.test(identifier) || /^(0|[1-9]\d*)$/.test(identifier)),
    );
  const buildIdentifiers = match[5]?.split(".");
  const hasValidBuild =
    buildIdentifiers === undefined ||
    buildIdentifiers.every((identifier) => /^[0-9A-Za-z-]+$/.test(identifier));
  if (!hasValidPrerelease || !hasValidBuild) {
    return false;
  }

  const versionParts = [Number(match[1]), Number(match[2]), Number(match[3])];
  const floorParts = WEB_REMOTE_CONTROL_V4_MIN_APP_VERSION.split(".").map(Number);
  for (let index = 0; index < floorParts.length; index += 1) {
    if (versionParts[index]! !== floorParts[index]!) {
      return versionParts[index]! > floorParts[index]!;
    }
  }

  return prereleaseIdentifiers === undefined;
}

export interface CfEndpointUrls {
  origin: string;
  apiBaseUrl: string;
  remoteUrl: string;
  webRemoteCallbackUrl: string;
  webShareCallbackUrl: string;
  relayWsUrl: string;
  cfPlanOpenAiBaseUrl: string;
  cfPlanAnthropicBaseUrl: string;
  cfPlanBillingCurrentUrl: string;
  cfPlanBillingBalanceUrl: string;
}

export interface RuntimeCfEndpointEnv {
  [key: string]: string | undefined;
  CF_ENV?: string;
  CF_BASE_URL?: string;
  CF_ENDPOINT_ORIGIN?: string;
  CF_TEST_BASE_URL?: string;
  CF_PRODUCTION_BASE_URL?: string;
}

export interface RuntimeBigModelApiEnv {
  [key: string]: string | undefined;
  CF_ENV?: string;
  BIGMODEL_API_BASE_URL?: string;
  BIGMODEL_TEST_API_BASE_URL?: string;
  BIGMODEL_PRODUCTION_API_BASE_URL?: string;
}

export interface RuntimeZaiEndpointEnv {
  [key: string]: string | undefined;
  CF_ENV?: string;
  ZAI_OAUTH_ORIGIN?: string;
  ZAI_TEST_OAUTH_ORIGIN?: string;
  ZAI_PRODUCTION_OAUTH_ORIGIN?: string;
  ZAI_BUSINESS_BASE_URL?: string;
  ZAI_TEST_BUSINESS_BASE_URL?: string;
  ZAI_PRODUCTION_BUSINESS_BASE_URL?: string;
  ZAI_OAUTH_CLIENT_ID?: string;
  ZAI_TEST_OAUTH_CLIENT_ID?: string;
  ZAI_PRODUCTION_OAUTH_CLIENT_ID?: string;
  ZAI_OAUTH_APP_ID?: string;
}

export interface RuntimeProductEndpointEnv
  extends RuntimeCfEndpointEnv, RuntimeBigModelApiEnv, RuntimeZaiEndpointEnv {}

export interface RuntimeProductEndpointConfig {
  cfEnv: CfEnv;
  cfEndpointOrigin: string;
  cfEndpointUrls: CfEndpointUrls;
  zaiOAuthOrigin: string;
  zaiBusinessBaseUrl: string;
  zaiOAuthClientId: string;
  bigModelApiOrigin: string;
}

function readRuntimeEnvValue(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function readRuntimeCfEnvScopedValue(
  env: Record<string, string | undefined>,
  cfEnv: CfEnv,
  testKey: string,
  productionKey: string,
): string | undefined {
  return readRuntimeEnvValue(env, cfEnv === "production" ? productionKey : testKey);
}

export function normalizeCfEndpointOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("CodeFusion endpoint origin is empty");
  }

  const parsed = new URL(trimmed);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("CodeFusion endpoint origin must use http or https");
  }
  return parsed.origin;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function isTrustedCodingPlanWebviewOrigin(
  value: string | null | undefined,
  options?: {
    e2eStoreBridgeEnabled?: boolean;
  },
): boolean {
  if (!value) return false;
  try {
    const origin = normalizeCfEndpointOrigin(value);
    if (
      origin === DEFAULT_CF_ENDPOINT_ORIGIN ||
      origin === TEST_CF_ENDPOINT_ORIGIN ||
      origin === CODING_PLAN_LOCAL_WEBVIEW_ORIGIN
    ) {
      return true;
    }
    const parsed = new URL(origin);
    return options?.e2eStoreBridgeEnabled === true && isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
}

export function resolveCfEndpointOrigin(options?: {
  env?: CfEnv;
  envBaseOrigin?: string | null;
  overrideOrigin?: string | null;
}): string {
  const env = options?.env ?? "test";
  const envBaseOrigin = options?.envBaseOrigin?.trim();
  if (env === "production") {
    return envBaseOrigin
      ? normalizeCfEndpointOrigin(envBaseOrigin)
      : DEFAULT_CF_ENDPOINT_ORIGIN;
  }

  const overrideOrigin = options?.overrideOrigin?.trim();
  if (overrideOrigin) {
    return normalizeCfEndpointOrigin(overrideOrigin);
  }

  return envBaseOrigin ? normalizeCfEndpointOrigin(envBaseOrigin) : TEST_CF_ENDPOINT_ORIGIN;
}

export function resolveRuntimeCfEnv(env: RuntimeCfEndpointEnv = {}): CfEnv {
  return env.CF_ENV?.trim().toLowerCase() === "test" ? "test" : "production";
}

export function resolveRuntimeCfEndpointOrigin(
  env: RuntimeCfEndpointEnv = {},
  options?: { overrideOrigin?: string | null },
): string {
  const cfEnv = resolveRuntimeCfEnv(env);
  const scopedBaseOrigin =
    cfEnv === "production"
      ? readRuntimeEnvValue(env, "CF_PRODUCTION_BASE_URL")
      : readRuntimeEnvValue(env, "CF_TEST_BASE_URL");

  return resolveCfEndpointOrigin({
    env: cfEnv,
    envBaseOrigin:
      readRuntimeEnvValue(env, "CF_BASE_URL") ??
      readRuntimeEnvValue(env, "CF_ENDPOINT_ORIGIN") ??
      scopedBaseOrigin,
    overrideOrigin: options?.overrideOrigin,
  });
}

export function buildRuntimeCfEndpointUrls(
  env: RuntimeCfEndpointEnv = {},
): CfEndpointUrls {
  return buildCfEndpointUrls(resolveRuntimeCfEndpointOrigin(env));
}

export function buildRuntimeCfApiUrl(env: RuntimeCfEndpointEnv = {}, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${resolveRuntimeCfEndpointOrigin(env)}${normalizedPath}`;
}

export function resolveWebRemoteControlRelayWsUrl(options?: {
  endpointOrigin?: string | null | undefined;
  overrideUrl?: string | null | undefined;
}): string {
  const overrideUrl = options?.overrideUrl?.trim();
  if (overrideUrl) {
    return overrideUrl;
  }

  const origin = new URL(
    normalizeCfEndpointOrigin(options?.endpointOrigin?.trim() || DEFAULT_CF_ENDPOINT_ORIGIN),
  );
  origin.protocol = origin.protocol === "https:" ? "wss:" : "ws:";
  origin.pathname = "/api/v1/remote/ws2";
  return origin.toString();
}

export function resolveBigModelApiOrigin(env: RuntimeBigModelApiEnv = {}): string {
  const cfEnv = resolveRuntimeCfEnv(env);
  const scopedBaseOrigin =
    cfEnv === "production"
      ? readRuntimeEnvValue(env, "BIGMODEL_PRODUCTION_API_BASE_URL")
      : readRuntimeEnvValue(env, "BIGMODEL_TEST_API_BASE_URL");
  const fallbackOrigin =
    cfEnv === "production" ? DEFAULT_BIGMODEL_API_ORIGIN : TEST_BIGMODEL_API_ORIGIN;

  return normalizeCfEndpointOrigin(
    readRuntimeEnvValue(env, "BIGMODEL_API_BASE_URL") ?? scopedBaseOrigin ?? fallbackOrigin,
  );
}

export function buildBigModelApiUrl(env: RuntimeBigModelApiEnv = {}, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${resolveBigModelApiOrigin(env)}${normalizedPath}`;
}

export function buildBigModelCodingPlanPersonalManageUrl(env: RuntimeBigModelApiEnv = {}): string {
  return buildBigModelApiUrl(env, "/coding-plan/personal/overview");
}

export function buildBigModelCodingPlanTeamManageUrl(env: RuntimeBigModelApiEnv = {}): string {
  return buildBigModelApiUrl(env, "/coding-plan/team/plans");
}

export function resolveZaiOAuthOrigin(env: RuntimeZaiEndpointEnv = {}): string {
  const cfEnv = resolveRuntimeCfEnv(env);
  const scopedOrigin = readRuntimeCfEnvScopedValue(
    env,
    cfEnv,
    "ZAI_TEST_OAUTH_ORIGIN",
    "ZAI_PRODUCTION_OAUTH_ORIGIN",
  );
  const fallbackOrigin =
    cfEnv === "production" ? DEFAULT_ZAI_OAUTH_ORIGIN : TEST_ZAI_OAUTH_ORIGIN;

  return normalizeCfEndpointOrigin(
    readRuntimeEnvValue(env, "ZAI_OAUTH_ORIGIN") ?? scopedOrigin ?? fallbackOrigin,
  );
}

export function resolveZaiBusinessBaseUrl(env: RuntimeZaiEndpointEnv = {}): string {
  const cfEnv = resolveRuntimeCfEnv(env);
  const scopedOrigin = readRuntimeCfEnvScopedValue(
    env,
    cfEnv,
    "ZAI_TEST_BUSINESS_BASE_URL",
    "ZAI_PRODUCTION_BUSINESS_BASE_URL",
  );
  const fallbackOrigin =
    cfEnv === "production" ? DEFAULT_ZAI_BUSINESS_BASE_URL : TEST_ZAI_BUSINESS_BASE_URL;

  return normalizeCfEndpointOrigin(
    readRuntimeEnvValue(env, "ZAI_BUSINESS_BASE_URL") ?? scopedOrigin ?? fallbackOrigin,
  );
}

export function resolveZaiOAuthClientId(env: RuntimeZaiEndpointEnv = {}): string {
  const cfEnv = resolveRuntimeCfEnv(env);
  const scopedClientId = readRuntimeCfEnvScopedValue(
    env,
    cfEnv,
    "ZAI_TEST_OAUTH_CLIENT_ID",
    "ZAI_PRODUCTION_OAUTH_CLIENT_ID",
  );
  const fallbackClientId =
    cfEnv === "production" ? DEFAULT_ZAI_OAUTH_CLIENT_ID : TEST_ZAI_OAUTH_CLIENT_ID;

  return (
    readRuntimeEnvValue(env, "ZAI_OAUTH_CLIENT_ID") ??
    scopedClientId ??
    readRuntimeEnvValue(env, "ZAI_OAUTH_APP_ID") ??
    fallbackClientId
  );
}

export function buildZaiOAuthUrl(origin: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizeCfEndpointOrigin(origin)}${normalizedPath}`;
}

export function buildRuntimeZaiOAuthUrl(env: RuntimeZaiEndpointEnv = {}, path: string): string {
  return buildZaiOAuthUrl(resolveZaiOAuthOrigin(env), path);
}

export function buildRuntimeZaiBusinessUrl(env: RuntimeZaiEndpointEnv = {}, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${resolveZaiBusinessBaseUrl(env)}${normalizedPath}`;
}

export function resolveRuntimeProductEndpointConfig(
  env: RuntimeProductEndpointEnv = {},
): RuntimeProductEndpointConfig {
  const cfEnv = resolveRuntimeCfEnv(env);
  const cfEndpointOrigin = resolveRuntimeCfEndpointOrigin(env);

  return {
    cfEnv,
    cfEndpointOrigin,
    cfEndpointUrls: buildCfEndpointUrls(cfEndpointOrigin),
    zaiOAuthOrigin: resolveZaiOAuthOrigin(env),
    zaiBusinessBaseUrl: resolveZaiBusinessBaseUrl(env),
    zaiOAuthClientId: resolveZaiOAuthClientId(env),
    bigModelApiOrigin: resolveBigModelApiOrigin(env),
  };
}

export function buildCfEndpointUrls(
  origin: string,
  options: BuildCfEndpointUrlsOptions = {},
): CfEndpointUrls {
  const normalizedOrigin = normalizeCfEndpointOrigin(origin);
  const parsed = new URL(normalizedOrigin);
  const wsProtocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  const wsOrigin = `${wsProtocol}//${parsed.host}`;
  const remoteVersion = isWebRemoteControlV4AppVersion(options.appVersion) ? "v4" : "v3";

  return {
    origin: normalizedOrigin,
    apiBaseUrl: `${normalizedOrigin}/api/v1`,
    remoteUrl: `${normalizedOrigin}/remote/${remoteVersion}`,
    webRemoteCallbackUrl: `${normalizedOrigin}/remote/v4`,
    webShareCallbackUrl: `${normalizedOrigin}/cn/share/callback`,
    relayWsUrl: `${wsOrigin}/api/v1/remote/ws2`,
    cfPlanOpenAiBaseUrl: `${normalizedOrigin}/api/v1/cf-plan`,
    cfPlanAnthropicBaseUrl: `${normalizedOrigin}/api/v1/cf-plan/anthropic`,
    cfPlanBillingCurrentUrl: `${normalizedOrigin}/api/v1/cf-plan/billing/current`,
    cfPlanBillingBalanceUrl: `${normalizedOrigin}/api/v1/cf-plan/billing/balance`,
  };
}

export function rewriteCfEndpointUrl(input: string | URL, endpointOrigin: string): string | URL {
  const originalUrl = typeof input === "string" ? input : input.toString();
  let parsed: URL;
  try {
    parsed = new URL(originalUrl);
  } catch {
    return input;
  }
  const sourceOrigin = DEFAULT_CF_ENDPOINT_ORIGIN;
  if (parsed.origin !== sourceOrigin) {
    return input;
  }

  const targetOrigin = normalizeCfEndpointOrigin(endpointOrigin);
  if (targetOrigin === sourceOrigin) {
    return input;
  }

  const target = new URL(targetOrigin);
  target.pathname = parsed.pathname;
  target.search = parsed.search;
  target.hash = parsed.hash;
  return target.toString();
}
