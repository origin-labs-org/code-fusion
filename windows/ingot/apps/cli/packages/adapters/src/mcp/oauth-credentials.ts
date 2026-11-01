import { createHash, randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/client";
import type { SharedCfCredentialStore } from "../auth/shared-credentials.js";

export const MCP_OAUTH_CANONICAL_CREDENTIALS_KEY = "authorization_credentials";
export const MCP_OAUTH_LEGACY_CLIENT_KEY = "client_information";
export const MCP_OAUTH_LEGACY_TOKENS_KEY = "tokens";
export const MCP_OAUTH_CREDENTIALS_VERSION = 2;
export const MCP_OAUTH_SUPPORTED_CREDENTIAL_VERSIONS = new Set([1, MCP_OAUTH_CREDENTIALS_VERSION]);

export interface McpOAuthCanonicalCredentials {
  client_information: OAuthClientInformationMixed;
  
  expires_at?: number;
  
  generation?: string;
  
  issuer?: string;
  
  obtained_at?: number;
  published_by: string;
  tokens: OAuthTokens;
  version: 1 | typeof MCP_OAUTH_CREDENTIALS_VERSION;
}

export interface CanonicalCredentialSnapshot {
  clientInformation: OAuthClientInformationMixed;
  expiresAt?: number;
  generation: string;
  issuer?: string;
  obtainedAt?: number;
  
  raw: string;
  tokens: OAuthTokens;
}

export function mcpOAuthCredentialKey(keyPrefix: string, name: string): string {
  return `${keyPrefix}:${name}`;
}

export function createCredentialGeneration(): string {
  return randomBytes(16).toString("hex");
}

export function resolveCredentialGeneration(
  canonical: McpOAuthCanonicalCredentials,
  raw: string,
): string {
  if (typeof canonical.generation === "string" && canonical.generation.length > 0) {
    return canonical.generation;
  }
  return `legacy-${createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
}

export function isCanonicalCredentials(value: unknown): value is McpOAuthCanonicalCredentials {
  if (
    !isRecord(value) ||
    typeof value.version !== "number" ||
    !MCP_OAUTH_SUPPORTED_CREDENTIAL_VERSIONS.has(value.version)
  ) {
    return false;
  }
  if (typeof value.published_by !== "string" || value.published_by.length === 0) return false;
  if (!isRecord(value.client_information) || !isRecord(value.tokens)) return false;
  return (
    typeof value.client_information.client_id === "string" &&
    typeof value.tokens.access_token === "string" &&
    typeof value.tokens.token_type === "string"
  );
}

export async function loadCanonicalCredentials(
  credentialStore: SharedCfCredentialStore,
  keyPrefix: string,
): Promise<CanonicalCredentialSnapshot | undefined> {
  const key = mcpOAuthCredentialKey(keyPrefix, MCP_OAUTH_CANONICAL_CREDENTIALS_KEY);
  const raw = await credentialStore.load(key);
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isCanonicalCredentials(parsed)) return undefined;
  return {
    clientInformation: parsed.client_information,
    ...(parsed.expires_at === undefined ? {} : { expiresAt: parsed.expires_at }),
    generation: resolveCredentialGeneration(parsed, raw),
    ...(parsed.issuer === undefined ? {} : { issuer: parsed.issuer }),
    ...(parsed.obtained_at === undefined ? {} : { obtainedAt: parsed.obtained_at }),
    raw,
    tokens: parsed.tokens,
  };
}

export interface PublishCanonicalCredentialsInput {
  clientInformation: OAuthClientInformationMixed;
  issuer?: string;
  obtainedAt?: number;
  publishedBy: string;
  tokens: OAuthTokens;
}

export interface PublishedCanonicalCredentials {
  canonical: McpOAuthCanonicalCredentials;
  generation: string;
  legacyClientRaw: string;
  legacyTokensRaw: string;
  raw: string;
}

export async function publishCanonicalCredentials(
  credentialStore: SharedCfCredentialStore,
  keyPrefix: string,
  input: PublishCanonicalCredentialsInput,
): Promise<PublishedCanonicalCredentials> {
  const obtainedAt = input.obtainedAt ?? Date.now();
  const expiresAt =
    typeof input.tokens.expires_in === "number" && Number.isFinite(input.tokens.expires_in)
      ? obtainedAt + input.tokens.expires_in * 1000
      : undefined;
  const generation = createCredentialGeneration();
  const canonical: McpOAuthCanonicalCredentials = {
    client_information: input.clientInformation,
    ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
    generation,
    ...(input.issuer === undefined ? {} : { issuer: input.issuer }),
    obtained_at: obtainedAt,
    published_by: input.publishedBy,
    tokens: input.tokens,
    version: MCP_OAUTH_CREDENTIALS_VERSION,
  };
  const raw = JSON.stringify(canonical);
  const legacyClientRaw = JSON.stringify(input.clientInformation);
  const legacyTokensRaw = JSON.stringify(input.tokens);
  await credentialStore.saveMany({
    [mcpOAuthCredentialKey(keyPrefix, MCP_OAUTH_CANONICAL_CREDENTIALS_KEY)]: raw,
    [mcpOAuthCredentialKey(keyPrefix, MCP_OAUTH_LEGACY_CLIENT_KEY)]: legacyClientRaw,
    [mcpOAuthCredentialKey(keyPrefix, MCP_OAUTH_LEGACY_TOKENS_KEY)]: legacyTokensRaw,
  });
  return { canonical, generation, legacyClientRaw, legacyTokensRaw, raw };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const MCP_OAUTH_EXPIRY_SKEW_MS = 30_000;

export function isCanonicalTokenNearExpiry(
  snapshot: Pick<CanonicalCredentialSnapshot, "expiresAt">,
  now = Date.now(),
  skewMs = MCP_OAUTH_EXPIRY_SKEW_MS,
): boolean {
  if (snapshot.expiresAt === undefined) return true;
  return now >= snapshot.expiresAt - skewMs;
}

export type CanonicalInvalidationScope = "tokens" | "all";

export async function invalidateCanonicalCredentials(
  credentialStore: SharedCfCredentialStore,
  keyPrefix: string,
  expectedRaw: string,
  scope: CanonicalInvalidationScope,
): Promise<boolean> {
  const canonicalKey = mcpOAuthCredentialKey(keyPrefix, MCP_OAUTH_CANONICAL_CREDENTIALS_KEY);
  const keysToDelete = [
    canonicalKey,
    mcpOAuthCredentialKey(keyPrefix, MCP_OAUTH_LEGACY_TOKENS_KEY),
  ];
  if (scope === "all") {
    keysToDelete.push(mcpOAuthCredentialKey(keyPrefix, MCP_OAUTH_LEGACY_CLIENT_KEY));
  }
  return await credentialStore.deleteManyIfValue(canonicalKey, expectedRaw, keysToDelete);
}

export interface CredentialPairSnapshot {
  clientInformation?: OAuthClientInformationMixed;
  expiresAt?: number;
  
  generation?: string;
  issuer?: string;
  obtainedAt?: number;
  
  raw?: string;
  source: "canonical" | "legacy";
  tokens?: OAuthTokens;
}

export async function loadCredentialPair(
  credentialStore: SharedCfCredentialStore,
  keyPrefix: string,
): Promise<CredentialPairSnapshot | undefined> {
  const canonicalKey = mcpOAuthCredentialKey(keyPrefix, MCP_OAUTH_CANONICAL_CREDENTIALS_KEY);
  const legacyClientKey = mcpOAuthCredentialKey(keyPrefix, MCP_OAUTH_LEGACY_CLIENT_KEY);
  const legacyTokensKey = mcpOAuthCredentialKey(keyPrefix, MCP_OAUTH_LEGACY_TOKENS_KEY);
  const values = await credentialStore.loadMany([canonicalKey, legacyClientKey, legacyTokensKey]);
  return deriveCredentialPair({
    canonicalRaw: values[canonicalKey] ?? undefined,
    legacyClientRaw: values[legacyClientKey] ?? undefined,
    legacyTokensRaw: values[legacyTokensKey] ?? undefined,
  });
}

export function deriveCredentialPair(input: {
  canonicalRaw?: string;
  legacyClientRaw?: string;
  legacyTokensRaw?: string;
}): CredentialPairSnapshot | undefined {
  const canonicalParsed = parseJson<unknown>(input.canonicalRaw);
  const canonical =
    canonicalParsed !== undefined && isCanonicalCredentials(canonicalParsed)
      ? canonicalParsed
      : undefined;
  const legacyClient = parseJson<OAuthClientInformationMixed>(input.legacyClientRaw);
  const legacyTokens = parseJson<OAuthTokens>(input.legacyTokensRaw);

  if (canonical && input.canonicalRaw) {
    const canonicalSnapshot: CredentialPairSnapshot = {
      clientInformation: canonical.client_information,
      ...(canonical.expires_at === undefined ? {} : { expiresAt: canonical.expires_at }),
      generation: resolveCredentialGeneration(canonical, input.canonicalRaw),
      ...(canonical.issuer === undefined ? {} : { issuer: canonical.issuer }),
      ...(canonical.obtained_at === undefined ? {} : { obtainedAt: canonical.obtained_at }),
      raw: input.canonicalRaw,
      source: "canonical",
      tokens: canonical.tokens,
    };
    if (canonical.version === 1) {
      const canAdoptLegacyTokens =
        legacyTokens !== undefined &&
        (!legacyClient || isDeepStrictEqual(legacyClient, canonical.client_information));
      if (canAdoptLegacyTokens) {
        return {
          clientInformation: legacyClient ?? canonical.client_information,
          source: "legacy",
          tokens: legacyTokens,
        };
      }
      return canonicalSnapshot;
    }
    if (!legacyTokens) {
      return { clientInformation: legacyClient, source: "legacy" };
    }
    if (isDeepStrictEqual(legacyTokens, canonical.tokens)) {
      return legacyClient ? canonicalSnapshot : { source: "legacy", tokens: legacyTokens };
    }
    if (legacyClient && isDeepStrictEqual(legacyClient, canonical.client_information)) {
      return { clientInformation: legacyClient, source: "legacy", tokens: legacyTokens };
    }
    return { clientInformation: legacyClient, source: "legacy" };
  }

  if (!legacyClient && !legacyTokens) return undefined;
  return {
    clientInformation: legacyClient,
    source: "legacy",
    ...(legacyTokens ? { tokens: legacyTokens } : {}),
  };
}

function parseJson<T>(raw: string | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}
