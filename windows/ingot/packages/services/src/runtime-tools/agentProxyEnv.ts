import {
  CF_AGENT_CA_CERT_ENV_KEY,
  CF_HTTP_PROXY_ENV_KEY,
  CF_NO_PROXY_ENV_KEY,
  CF_WORKSPACE_IDENTITY_ENV,
} from "@origin-ai/cf-shared";

//
//
//

const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  CF_HTTP_PROXY_ENV_KEY,
] as const;
const NO_PROXY_ENV_KEYS = ["NO_PROXY", "no_proxy", CF_NO_PROXY_ENV_KEY] as const;

export function buildAgentProxyEnv(httpProxy: string | undefined): Record<string, string> {
  const normalized = normalizeProxyValue(httpProxy);
  if (!normalized) {
    return {};
  }
  const env: Record<string, string> = {};
  for (const key of PROXY_ENV_KEYS) {
    env[key] = normalized;
  }
  return env;
}

export function buildAgentCaCertEnv(caCertPath: string | undefined): Record<string, string> {
  const trimmed = caCertPath?.trim();
  if (!trimmed) {
    return {};
  }
  return {
    NODE_EXTRA_CA_CERTS: trimmed,
    [CF_AGENT_CA_CERT_ENV_KEY]: trimmed,
  };
}

export function buildAgentNoProxyEnv(noProxy: string | undefined): Record<string, string> {
  const normalized = normalizeNoProxyValue(noProxy);
  if (!normalized) {
    return {};
  }
  const env: Record<string, string> = {};
  for (const key of NO_PROXY_ENV_KEYS) {
    env[key] = normalized;
  }
  return env;
}

export function buildAgentRuntimeEnv(input: {
  httpProxy: string | undefined;
  noProxy?: string | undefined;
  caCertPath?: string | undefined;
}): Record<string, string> {
  const proxyEnv = buildAgentProxyEnv(input.httpProxy);
  return {
    ...proxyEnv,
    ...buildAgentNoProxyEnv(input.noProxy),
    ...buildAgentCaCertEnv(input.caCertPath),
  };
}

export function buildAgentEndpointOriginEnv(
  endpointOrigin: string | undefined,
): Record<string, string> {
  const trimmed = endpointOrigin?.trim();
  if (!trimmed) {
    return {};
  }
  return { CF_BASE_URL: trimmed };
}

export function buildAgentWorkspaceIdentityEnv(
  workspaceIdentity: string | undefined,
): Record<string, string> {
  const trimmed = workspaceIdentity?.trim();
  return trimmed ? { [CF_WORKSPACE_IDENTITY_ENV]: trimmed } : {};
}

function normalizeProxyValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `http://${trimmed}`;
}

function normalizeNoProxyValue(value: string | undefined): string | undefined {
  const tokens = value
    ?.split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  return tokens && tokens.length > 0 ? tokens.join(",") : undefined;
}
