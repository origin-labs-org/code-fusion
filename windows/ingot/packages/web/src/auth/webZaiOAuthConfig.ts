import type { WebZaiOAuthProviderConfig } from "./zaiWebOAuthProvider.js";
import {
  buildCfEndpointUrls,
  DEFAULT_CF_ENDPOINT_ORIGIN,
  resolveBigModelApiOrigin,
} from "@origin-ai/cf-shared";

interface WebImportMetaEnv {
  VITE_DEV_ORIGIN?: string;
  VITE_ZAI_OAUTH_CLIENT_ID?: string;
  VITE_ZAI_OAUTH_ORIGIN?: string;
  VITE_BIGMODEL_OAUTH_ORIGIN?: string;
  VITE_BIGMODEL_OAUTH_APP_ID?: string;
  VITE_CF_BASE_URL?: string;
  VITE_CF_ENDPOINT_ORIGIN?: string;
  VITE_WEB_REMOTE_ALLOW_DEV_RETURN_TO?: string;
}

export interface WebZaiOAuthConfig extends WebZaiOAuthProviderConfig {
  devOrigin?: string;
  shareRedirectUri: string;
  allowDevReturnToRedirect: boolean;
}

function normalizeZaiOAuthOrigin(value: string): string {
  return new URL(value.trim()).origin;
}

function buildZaiOAuthAuthorizeUrl(origin: string | undefined): string {
  return `${normalizeZaiOAuthOrigin(origin?.trim() || "https://chat.z.ai")}/api/oauth/authorize`;
}

function buildBigModelAuthorizeUrl(origin: string | undefined): string {
  const trimmed = origin?.trim();
  return `${trimmed ? new URL(trimmed).origin : resolveBigModelApiOrigin({})}/login`;
}

export function createWebZaiOAuthConfig(env: WebImportMetaEnv = {}): WebZaiOAuthConfig {
  const devOrigin = env.VITE_DEV_ORIGIN?.trim().replace(/\/$/, "");
  const cfEndpointUrls = buildCfEndpointUrls(
    env.VITE_CF_BASE_URL?.trim() ||
      env.VITE_CF_ENDPOINT_ORIGIN?.trim() ||
      DEFAULT_CF_ENDPOINT_ORIGIN,
  );

  return {
    authorizeUrl: buildZaiOAuthAuthorizeUrl(env.VITE_ZAI_OAUTH_ORIGIN),
    tokenUrl: "/api/v1/oauth/token",
    clientId: env.VITE_ZAI_OAUTH_CLIENT_ID?.trim() || "client_P8X5CMWmlaRO9gyO-KSqtg",
    bigmodelAuthorizeUrl: buildBigModelAuthorizeUrl(env.VITE_BIGMODEL_OAUTH_ORIGIN),
    bigmodelAppId: env.VITE_BIGMODEL_OAUTH_APP_ID?.trim() || "cf",
    redirectUri: cfEndpointUrls.webRemoteCallbackUrl,
    shareRedirectUri: cfEndpointUrls.webShareCallbackUrl,
    ...(devOrigin ? { devOrigin } : {}),
    allowDevReturnToRedirect: env.VITE_WEB_REMOTE_ALLOW_DEV_RETURN_TO === "true",
  };
}

const env = ((import.meta as ImportMeta & { env?: WebImportMetaEnv }).env ??
  {}) as WebImportMetaEnv;

export const WEB_ZAI_OAUTH_CONFIG: WebZaiOAuthConfig = createWebZaiOAuthConfig(env);

export function resolveWebAuthDevReturnTo(
  config: WebZaiOAuthConfig,
  surface: "remote" | "share" = "remote",
): string | undefined {
  return config.devOrigin
    ? `${config.devOrigin}/${surface === "share" ? "share/callback" : "remote/v4"}`
    : undefined;
}
