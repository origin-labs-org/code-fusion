

export const CF_OFFICIAL_MCP_AUTH_TYPE = "cf_official" as const;

export const CF_OFFICIAL_MCP_AUTH_PROVIDER_JWT_TOKEN = "jwt_token" as const;

export const OFFICIAL_MCP_AUTH_HEADER_NAMES = {
  authorization: "Authorization",
  codingPlanAuthorization: "X-Bigmodel-Authorization",
  targetType: "Bigmodel-Target-Type",
  organization: "Bigmodel-Organization",
  project: "Bigmodel-Project",
} as const;

export const OFFICIAL_MCP_AUTH_META_KEY = "com.cf/official-mcp-auth" as const;

export const OFFICIAL_MCP_RESERVED_HEADER_NAMES: readonly string[] = [
  ...Object.values(OFFICIAL_MCP_AUTH_HEADER_NAMES).map((name) => name.toLowerCase()),
  "x-coding-plan-api-key",
  "mcp-session-id",
  "mcp-protocol-version",
];

const RESERVED_HEADER_SET = new Set(OFFICIAL_MCP_RESERVED_HEADER_NAMES);

export function isOfficialMcpReservedHeaderName(name: string): boolean {
  return RESERVED_HEADER_SET.has(name.trim().toLowerCase());
}

export function findOfficialMcpReservedHeaders(
  headers: Record<string, string> | undefined,
): string[] {
  if (!headers) return [];
  const hits = new Set<string>();
  for (const name of Object.keys(headers)) {
    const normalized = name.trim().toLowerCase();
    if (RESERVED_HEADER_SET.has(normalized)) hits.add(normalized);
  }
  return [...hits].sort();
}

export type OfficialMcpTargetType = "PERSONAL" | "TEAM";

export const OFFICIAL_MCP_AUTH_FAILURE_REASONS = [
  "official_auth_unavailable",
  "official_auth_plan_required",
] as const;

export type OfficialMcpAuthFailureReason = (typeof OFFICIAL_MCP_AUTH_FAILURE_REASONS)[number];

export const OFFICIAL_MCP_AUTH_PORT_FAILURE_REASONS = [
  ...OFFICIAL_MCP_AUTH_FAILURE_REASONS,
  "official_mcp_origin_untrusted",
] as const;

export type OfficialMcpAuthPortFailureReason =
  (typeof OFFICIAL_MCP_AUTH_PORT_FAILURE_REASONS)[number];

export type OfficialMcpAuthFailureKind =
  | OfficialMcpAuthFailureReason
  | "official_mcp_origin_untrusted"
  | "official_auth_rejected"
  | "official_auth_forbidden"
  | "official_auth_redirect_blocked";

function normalizeHttpsOrigin(candidate: string): string | undefined {
  try {
    const url = new URL(candidate);
    if (url.username !== "" || url.password !== "") return undefined;
    return url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function normalizeLoopbackOrigin(candidate: string): string | undefined {
  try {
    const url = new URL(candidate);
    if (url.username !== "" || url.password !== "") return undefined;
    const loopback =
      url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
    return url.protocol === "http:" && loopback ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

export const OFFICIAL_MCP_DEV_TRUSTED_ORIGINS_ENV = "CF_OFFICIAL_MCP_DEV_TRUSTED_ORIGINS";

export const CF_WORKSPACE_IDENTITY_ENV = "CF_WORKSPACE_IDENTITY";

export function summarizeOfficialMcpIdentityHeaders(
  headers: Record<string, string>,
): Record<string, unknown> {
  const lower = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const organization = lower.has("bigmodel-organization");
  const project = lower.has("bigmodel-project");
  return {
    identityHeaderNames: [...lower.keys()].sort(),
    identityOrganizationPresent: organization,
    identityProjectPresent: project,
    identityTeamPaired: organization === project,
    ...(lower.get("bigmodel-target-type")
      ? { identityTargetType: lower.get("bigmodel-target-type") }
      : {}),
  };
}

export interface OfficialMcpTrustResult {
  trusted: boolean;
  
  detail: "ok" | "invalid_input" | "origin_mismatch" | "cf_origin_unresolved";
}

export interface IsOfficialMcpOriginTrustedInput {
  
  devTrustedOriginsRaw?: string | undefined;
  origin: string;
  
  pluginId: string;
  
  cfApiOrigin: string | undefined;
}

export function isOfficialMcpOriginTrusted(
  input: IsOfficialMcpOriginTrustedInput,
): OfficialMcpTrustResult {
  const origin = input.origin.trim();
  if (!origin) {
    return { detail: "invalid_input", trusted: false };
  }

  const loopbackOrigin = normalizeLoopbackOrigin(origin);
  if (loopbackOrigin) {
    for (const candidate of parseDevTrustedOrigins(input.devTrustedOriginsRaw)) {
      if (normalizeLoopbackOrigin(candidate) === loopbackOrigin) {
        return { detail: "ok", trusted: true };
      }
    }
  }

  const expected = input.cfApiOrigin ? normalizeHttpsOrigin(input.cfApiOrigin) : undefined;
  if (!expected) return { detail: "cf_origin_unresolved", trusted: false };
  if (normalizeHttpsOrigin(origin) !== expected) {
    return { detail: "origin_mismatch", trusted: false };
  }
  return { detail: "ok", trusted: true };
}

function parseDevTrustedOrigins(raw: string | undefined): string[] {
  const value = raw?.trim();
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export interface OfficialMcpTrustedOriginRegistry {
  isTrusted(input: {
    mcpKey: string;
    origin: string;
    pluginId: string;
  }): Promise<OfficialMcpTrustResult>;
}

export interface CreateOfficialMcpTrustedOriginRegistryOptions {
  
  devTrustedOriginsRaw?: string | undefined;
  
  resolveCfApiOrigin: () => string | undefined | Promise<string | undefined>;
}

export function createOfficialMcpTrustedOriginRegistry(
  options: CreateOfficialMcpTrustedOriginRegistryOptions,
): OfficialMcpTrustedOriginRegistry {
  return {
    async isTrusted({ origin, pluginId }) {
      let cfApiOrigin: string | undefined;
      try {
        cfApiOrigin = await options.resolveCfApiOrigin();
      } catch {
        return { detail: "cf_origin_unresolved", trusted: false };
      }
      return isOfficialMcpOriginTrusted({
        devTrustedOriginsRaw: options.devTrustedOriginsRaw,
        origin,
        pluginId,
        cfApiOrigin,
      });
    },
  };
}
