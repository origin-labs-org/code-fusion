import {
  CF_VERSION,
  buildRuntimeCfApiUrl,
  buildRuntimeCfEndpointUrls,
} from "@origin-ai/cf-shared";

const DESKTOP_OAUTH_CALLBACK_URI = "cf://oauth/callback";

export function readEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function readBoolean(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = readEnv(env, key);
  if (raw == null) {
    return fallback;
  }

  return raw !== "0" && raw.toLowerCase() !== "false";
}

export function buildCfApiUrlFromEnv(env: NodeJS.ProcessEnv, path: string): string {
  return buildRuntimeCfApiUrl(env, path);
}

export function buildDesktopOAuthRedirectUriFromEnv(env: NodeJS.ProcessEnv): string {
  const url = new URL("/app/oauth/login", buildRuntimeCfEndpointUrls(env).origin);
  url.searchParams.set("redirect", DESKTOP_OAUTH_CALLBACK_URI);
  url.searchParams.set("app_version", CF_VERSION);
  return url.toString();
}
