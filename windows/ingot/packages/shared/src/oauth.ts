

export const BIGMODEL_PROVIDER_ID = "bigmodel" as const;

export const ZAI_PROVIDER_ID = "zai" as const;

export const CREDENTIAL_DECRYPT_ERROR_PREFIX = "凭据解密失败：" as const;

export const CREDENTIAL_DECRYPT_ERROR_CODE = "CF_CREDENTIAL_DECRYPT_FAILED" as const;

export function isCredentialDecryptError(error: unknown): boolean {
  const code = readCredentialErrorCode(error);
  if (code) {
    return code === CREDENTIAL_DECRYPT_ERROR_CODE;
  }

  if (readCredentialErrorMessage(error).startsWith(CREDENTIAL_DECRYPT_ERROR_PREFIX)) {
    return true;
  }

  return false;
}

function readCredentialErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code?: unknown }).code ?? "");
  }

  return "";
}

function readCredentialErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }

  return "";
}

export type OAuthProviderId =
  | typeof BIGMODEL_PROVIDER_ID
  | typeof ZAI_PROVIDER_ID
  | (string & { readonly __oauthProviderBrand?: never });

export interface OAuthProviderMeta {
  id: OAuthProviderId;
  displayName: string;
  enabled: boolean;
  order: number;
}

export interface OAuthStartRequest {
  provider: OAuthProviderId;
}

export interface OAuthStartResponse {
  provider: OAuthProviderId;
  authorizeUrl: string;
  state: string;
}

export interface OAuthSessionCallbackResult {
  kind: "session";
  provider: OAuthProviderId;
  userInfo: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl?: string;
  };
}

export interface OAuthAttributionCallbackResult {
  kind: "attribution";
  provider: OAuthProviderId;
  attribution: OAuthLoginAttribution;
}

export interface OAuthDuplicateCallbackResult {
  kind: "duplicate";
  provider: OAuthProviderId;
}

export type OAuthCallbackResult =
  | OAuthSessionCallbackResult
  | OAuthAttributionCallbackResult
  | OAuthDuplicateCallbackResult;

export interface OAuthStateRegistration {
  state: string;
  provider?: OAuthProviderId;
}

export interface OAuthCallbackParams {
  state: string;
  code: string;
  attribution?: OAuthLoginAttribution;
}

export interface OAuthLoginAttribution {
  channel_id?: string;
  utm_source?: string;
  utm_campaign?: string;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  cfJwtToken?: string;
}

export interface UserInfo {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
}

export type OAuthCachedSessionRestoreResult =
  | { status: "authenticated"; userInfo: UserInfo }
  | { status: "signed-out" }
  | { status: "reauthentication-required"; reason: "jwt-expired" };

export type OAuthSessionState = "signed-in" | "signed-out";

export const CF_JWT_INVALID_BROADCAST_CHANNEL = "auth:cf-jwt-invalid";

export type JwtExpirationResult =
  | { kind: "valid"; expiresAt: number }
  | { kind: "expired"; expiresAt: number }
  | { kind: "unknown" };

export function resolveJwtExpiration(
  token: string,
  now = Date.now(),
  clockSkewMs = 30_000,
): JwtExpirationResult {
  try {
    const payloadSegment = token.split(".")[1];
    if (!payloadSegment) {
      return { kind: "unknown" };
    }

    const normalized = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = globalThis.atob(padded);
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { exp?: unknown };
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= 0) {
      return { kind: "unknown" };
    }

    const expiresAt = payload.exp * 1_000;
    return now + Math.max(0, clockSkewMs) >= expiresAt
      ? { kind: "expired", expiresAt }
      : { kind: "valid", expiresAt };
  } catch {
    return { kind: "unknown" };
  }
}

export interface OAuthUserProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  rawProfile?: unknown;
}

export type OAuthLogoutScope = "active" | "all";
