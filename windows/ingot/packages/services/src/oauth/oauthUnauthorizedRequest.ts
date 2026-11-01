import {
  BIGMODEL_PROVIDER_ID,
  ZAI_PROVIDER_ID,
  buildBigModelApiUrl,
  buildRuntimeZaiBusinessUrl,
} from "@origin-ai/cf-shared";
import type { ICredentialService } from "#src/credential/credential.js";
import { resolveBigModelUserinfoUrl } from "#src/oauth/providers/bigmodelProviderConfig.js";
import { resolveZaiUserinfoUrl } from "#src/oauth/providers/zaiProviderConfig.js";

function tryResolveHttpUrl(resolve: () => string | URL): URL | null {
  try {
    const url = new URL(resolve());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

const OAUTH_BUSINESS_PREFIXES = ["/api/biz/", "/api/pay/"] as const;

async function isCurrentBusinessOAuthCredentialRequest(options: {
  input: string | URL;
  headers: Headers;
  credentialService: Pick<ICredentialService, "load">;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const authorization = options.headers.get("authorization")?.trim() ?? "";
  if (!authorization) return false;

  const provider = await options.credentialService.load("oauth:active_provider");
  if (!(await isOAuthBusinessRequest({ ...options, provider }))) return false;

  const accessToken = (
    await options.credentialService.load(`oauth:${provider}:access_token`)
  )?.trim();
  if (!accessToken || (authorization !== accessToken && authorization !== `Bearer ${accessToken}`))
    return false;
  return (await options.credentialService.load("oauth:active_provider")) === provider;
}

export async function isOAuthBusinessRequest(options: {
  input: string | URL;
  credentialService: Pick<ICredentialService, "load">;
  env?: NodeJS.ProcessEnv;
  provider?: string | null;
}): Promise<boolean> {
  const provider =
    options.provider ?? (await options.credentialService.load("oauth:active_provider"));
  if (provider !== BIGMODEL_PROVIDER_ID && provider !== ZAI_PROVIDER_ID) return false;
  const env = options.env ?? process.env;
  const requestUrl = tryResolveHttpUrl(() => options.input);
  if (!requestUrl) return false;
  const buildBusinessUrl = (path: string) =>
    provider === BIGMODEL_PROVIDER_ID
      ? buildBigModelApiUrl(env, path)
      : buildRuntimeZaiBusinessUrl(env, path);
  if (
    OAUTH_BUSINESS_PREFIXES.some((path) => {
      const expected = tryResolveHttpUrl(() => buildBusinessUrl(path));
      return (
        expected !== null &&
        requestUrl.origin === expected.origin &&
        requestUrl.pathname.startsWith(expected.pathname)
      );
    })
  )
    return true;
  const userinfo = tryResolveHttpUrl(() =>
    provider === BIGMODEL_PROVIDER_ID
      ? resolveBigModelUserinfoUrl(env)
      : resolveZaiUserinfoUrl(env),
  );
  return (
    userinfo !== null &&
    requestUrl.origin === userinfo.origin &&
    requestUrl.pathname === userinfo.pathname
  );
}

export async function resolveOAuthBusinessCredentialValidationRequest(options: {
  input: string | URL;
  headers: Headers;
  credentialService: Pick<ICredentialService, "load">;
  env?: NodeJS.ProcessEnv;
}): Promise<{ url: string; authorization: string; emptyBodyMeansInvalid: boolean } | null> {
  const provider = await options.credentialService.load("oauth:active_provider");
  if (provider !== BIGMODEL_PROVIDER_ID && provider !== ZAI_PROVIDER_ID) return null;
  if (!(await isCurrentBusinessOAuthCredentialRequest(options))) return null;
  if ((await options.credentialService.load("oauth:active_provider")) !== provider) return null;
  const env = options.env ?? process.env;
  const url = tryResolveHttpUrl(() =>
    provider === BIGMODEL_PROVIDER_ID
      ? buildBigModelApiUrl(env, "/api/biz/customer/getCustomerInfo")
      : buildRuntimeZaiBusinessUrl(env, "/api/biz/customer/getCustomerInfo"),
  );
  if (!url) return null;
  const token = options.headers
    .get("authorization")!
    .trim()
    .replace(/^Bearer\s+/i, "");
  return {
    url: url.toString(),
    authorization: token,
    emptyBodyMeansInvalid: provider === BIGMODEL_PROVIDER_ID,
  };
}

export async function isCurrentOAuthBusinessCredentialRequest(options: {
  input: string | URL;
  headers: Headers;
  credentialService: Pick<ICredentialService, "load">;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  return isCurrentBusinessOAuthCredentialRequest(options);
}

export async function isCurrentOAuthCredentialRequest(options: {
  input: string | URL;
  headers: Headers;
  credentialService: Pick<ICredentialService, "load">;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const authorization = options.headers.get("authorization")?.trim() ?? "";
  if (!authorization) return false;
  const currentJwt = (await options.credentialService.load("cfjwttoken"))?.trim() ?? "";
  if (currentJwt && authorization === `Bearer ${currentJwt}`) return true;
  return isCurrentBusinessOAuthCredentialRequest(options);
}
