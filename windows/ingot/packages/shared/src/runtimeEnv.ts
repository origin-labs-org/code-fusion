export const CF_RUNTIME_ENV_KEY = "CF_RUNTIME_ENV";
export const CF_HTTP_PROXY_ENV_KEY = "CF_HTTP_PROXY";
export const CF_NO_PROXY_ENV_KEY = "CF_NO_PROXY";

export const CF_REMOTE_RUNTIME_NETWORK_AUTHORITY_ENV_KEY =
  "CF_REMOTE_RUNTIME_NETWORK_AUTHORITY";
export const CF_REMOTE_HTTP_PROXY_ENV_KEY = "CF_REMOTE_HTTP_PROXY";
export const CF_REMOTE_NO_PROXY_ENV_KEY = "CF_REMOTE_NO_PROXY";
export const CF_AGENT_CA_CERT_ENV_KEY = "CF_AGENT_CA_CERT";
export const CF_TOOL_ENV_PASSTHROUGH_ENV_KEY = "CF_TOOL_ENV_PASSTHROUGH_JSON";

export const CF_DESKTOP_CONTEXT_PROMPT_ENABLED_ENV = "CF_DESKTOP_CONTEXT_PROMPT_ENABLED";
export const CF_CUA_PRODUCT_HELPER_ENV_KEY = "CF_CUA_PRODUCT_HELPER";
export const CF_CUA_BROKER_SOCKET_ENV_KEY = "CF_CUA_PERMISSION_BROKER_SOCKET";
/** Shared node_repl host marker; unlike the broker bearer values it is not a secret. */
export const CF_CUA_NODE_REPL_HOST_ENV_KEY = "CF_CUA_NODE_REPL_HOST";
// One-knob local-development bundle. Setting CF_CUA_DEV_MODE implies the internal feature
// flag (below) plus the local-helper relaxations wired in packages/services (unsigned/
// unauthenticated local helper, dev install variant, "Dev.app" naming). It exists so a developer
// can launch the full local CUA loop with a single env var instead of the historical four-var
export const CF_CUA_DEV_MODE_ENV_KEY = "CF_CUA_DEV_MODE";

export type CfRuntimeEnv = "development" | "production" | "test";

type EnvRecord = Record<string, string | undefined>;

export function isCuaDevModeRequested(env: EnvRecord = process.env): boolean {
  const explicit = env[CF_CUA_DEV_MODE_ENV_KEY]?.trim().toLowerCase();
  return explicit === "1" || explicit === "true" || explicit === "on";
}

export function isCfCuaInternalFeatureEnabled(env: EnvRecord = process.env): boolean {
  if (isCuaDevModeRequested(env)) return true;
  const explicit = env[CF_CUA_PRODUCT_HELPER_ENV_KEY]?.trim().toLowerCase();
  if (explicit === "0" || explicit === "false" || explicit === "off") return false;
  return true;
}

const SANITIZED_RUNTIME_ENV_KEYS = [
  "NODE_ENV",
  "ELECTRON_RUN_AS_NODE",
  "NODE_NO_WARNINGS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "GIT_SSL_CAINFO",
  CF_REMOTE_RUNTIME_NETWORK_AUTHORITY_ENV_KEY,
  CF_REMOTE_HTTP_PROXY_ENV_KEY,
  CF_REMOTE_NO_PROXY_ENV_KEY,
  CF_CUA_BROKER_SOCKET_ENV_KEY,
  "CF_CUA_PERMISSION_BROKER_TOKEN",
  "CF_CUA_PERMISSION_BROKER_REFRESH_MARKER",
  "CF_CUA_PLUGIN_AUTHORITY",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
  "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
  "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
  "OTEL_SERVICE_NAME",
  "OTEL_RESOURCE_ATTRIBUTES",
  "OTEL_EXPORTER_OTLP_COMPRESSION",
  "CF_MODEL_TELEMETRY_ENABLED",
  "CF_TELEMETRY_DEVICE_MID",
  "CF_TELEMETRY_USER_ID",
  "CF_TELEMETRY_USER_ID_HASH",
  "CF_TELEMETRY_USER_SUBJECT_ID",
  "CF_TELEMETRY_IDENTITY_STATE",
  "CF_TELEMETRY_RUNTIME_SURFACE",
  "CF_TELEMETRY_RUNTIME_DISTRIBUTION",
] as const;

const NON_TOOL_PASSTHROUGH_RUNTIME_ENV_KEYS = [
  "NODE_ENV",
  "ELECTRON_RUN_AS_NODE",
  "NODE_NO_WARNINGS",
  CF_CUA_BROKER_SOCKET_ENV_KEY,
  "CF_CUA_PERMISSION_BROKER_REFRESH_MARKER",
  "CF_CUA_PLUGIN_AUTHORITY",
  CF_REMOTE_RUNTIME_NETWORK_AUTHORITY_ENV_KEY,
  CF_REMOTE_HTTP_PROXY_ENV_KEY,
  CF_REMOTE_NO_PROXY_ENV_KEY,
] as const;

const SANITIZED_PACKAGE_MANAGER_ENV_PATTERN =
  /^(npm_config|yarn|pnpm)_(http_proxy|https_proxy|proxy|all_proxy|no_proxy|cafile|ca)$/i;

export function normalizeCfRuntimeEnv(value: string | undefined): CfRuntimeEnv | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "development" || normalized === "production" || normalized === "test") {
    return normalized;
  }
  return undefined;
}

export function resolveCfRuntimeEnv(
  env: Record<string, string | undefined>,
  fallback: CfRuntimeEnv = "production",
): CfRuntimeEnv {
  return normalizeCfRuntimeEnv(env[CF_RUNTIME_ENV_KEY]) ?? fallback;
}

// Exported so services/node.ts can inject the Helper's plugin authority into the agent spawn env
// (mirrors feat; the agent-side plugin host verifies the broker authority via this env var).
export const CF_CUA_PLUGIN_AUTHORITY_ENV_KEY = "CF_CUA_PLUGIN_AUTHORITY";

interface CapturedCuaBrokerCredentials {
  socket: string;
  pluginAuthority: string;
  refreshMarker?: string;
}

let capturedCuaBrokerCredentials: Readonly<CapturedCuaBrokerCredentials> | undefined;
const capturedCfAgentTelemetryEnv: Record<string, string> = {};

function captureCfCuaBrokerCredentials(env: Record<string, string | undefined>): void {
  const socket = env[CF_CUA_BROKER_SOCKET_ENV_KEY]?.trim();
  const pluginAuthority = env[CF_CUA_PLUGIN_AUTHORITY_ENV_KEY]?.trim();
  const refreshMarker = env["CF_CUA_PERMISSION_BROKER_REFRESH_MARKER"]?.trim();
  if (socket && pluginAuthority) {
    capturedCuaBrokerCredentials = Object.freeze({
      socket,
      pluginAuthority,
      ...(refreshMarker ? { refreshMarker } : {}),
    });
    return;
  }
  if (socket || pluginAuthority) {
    capturedCuaBrokerCredentials = undefined;
  }
}

function captureCfAgentTelemetryEnv(env: Record<string, string | undefined>): void {
  Object.assign(capturedCfAgentTelemetryEnv, readCfAgentTelemetryEnv(env));
}

export function readCfAgentTelemetryEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const telemetryEnv: Record<string, string> = {};
  for (const key of SANITIZED_RUNTIME_ENV_KEYS) {
    if (!isCfAgentTelemetryEnvKey(key)) continue;
    const value = env[key]?.trim();
    if (value) telemetryEnv[key] = value;
  }
  return telemetryEnv;
}

export function getCapturedCfAgentTelemetryEnv(): Record<string, string> {
  return { ...capturedCfAgentTelemetryEnv };
}

export function getCapturedCfCuaBrokerCredentials(): {
  socket: string | undefined;
  pluginAuthority: string | undefined;
  refreshMarker?: string;
} {
  return capturedCuaBrokerCredentials
    ? { ...capturedCuaBrokerCredentials }
    : { socket: undefined, pluginAuthority: undefined };
}

export function resetCapturedCfCuaBrokerCredentialsForTest(): void {
  capturedCuaBrokerCredentials = undefined;
}

export function resetCapturedCfAgentTelemetryEnvForTest(): void {
  for (const key of Object.keys(capturedCfAgentTelemetryEnv)) {
    delete capturedCfAgentTelemetryEnv[key];
  }
}

export function sanitizeCfRuntimeEnv<T extends Record<string, string | undefined>>(
  env: T,
): Record<string, string> {
  captureCfCuaBrokerCredentials(env);
  captureCfAgentTelemetryEnv(env);
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || shouldSanitizeCfRuntimeEnvKey(key)) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

export function buildCfToolEnvPassthroughEnv(env: EnvRecord): Record<string, string> {
  const captured = readCfToolEnvPassthroughEnv(env);

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || !shouldCaptureCfToolEnvPassthroughKey(key)) {
      continue;
    }
    captured[key] = value;
  }

  return stringifyCfToolEnvPassthroughEnv(captured);
}

export function readCfToolEnvPassthroughEnv(env: EnvRecord): Record<string, string> {
  const raw = env[CF_TOOL_ENV_PASSTHROUGH_ENV_KEY];
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const captured: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (
        typeof value === "string" &&
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) &&
        shouldCaptureCfToolEnvPassthroughKey(key)
      ) {
        captured[key] = value;
      }
    }
    return captured;
  } catch {
    return {};
  }
}

export function sanitizeCfRuntimeEnvInPlace(env: Record<string, string | undefined>): void {
  captureCfCuaBrokerCredentials(env);
  captureCfAgentTelemetryEnv(env);
  for (const key of Object.keys(env)) {
    if (shouldSanitizeCfRuntimeEnvKey(key)) {
      delete env[key];
    }
  }
}

function isCfAgentTelemetryEnvKey(key: string): boolean {
  return (
    key.startsWith("OTEL_") ||
    key.startsWith("CF_TELEMETRY_") ||
    key === "CF_MODEL_TELEMETRY_ENABLED"
  );
}

export function shouldSanitizeCfRuntimeEnvKey(key: string): boolean {
  const upperKey = key.toUpperCase();
  return (
    SANITIZED_RUNTIME_ENV_KEYS.some((candidate) => candidate === upperKey) ||
    SANITIZED_PACKAGE_MANAGER_ENV_PATTERN.test(key)
  );
}

export function shouldCaptureCfToolEnvPassthroughKey(key: string): boolean {
  const upperKey = key.toUpperCase();
  if (isCfAgentTelemetryEnvKey(upperKey)) {
    return false;
  }
  if (NON_TOOL_PASSTHROUGH_RUNTIME_ENV_KEYS.some((candidate) => candidate === upperKey)) {
    return false;
  }
  return shouldSanitizeCfRuntimeEnvKey(key);
}

function stringifyCfToolEnvPassthroughEnv(
  captured: Record<string, string>,
): Record<string, string> {
  const entries = Object.entries(captured).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return {};
  }
  return {
    [CF_TOOL_ENV_PASSTHROUGH_ENV_KEY]: JSON.stringify(Object.fromEntries(entries)),
  };
}
