import {
  ApiError,
  BIGMODEL_PROVIDER_ID,
  type ApiClient,
  type OAuthCallbackParams,
  type OAuthProviderMeta,
  type OAuthTokenSet,
  type OAuthUserProfile,
} from "@origin-ai/cf-shared";
import { readApiJson } from "../../providers/api/apiJson.js";
import { createServiceLogger } from "../../logger/serviceLogger.js";
import { parseOAuthLoginAttribution } from "../callbackAttribution.js";
import type { OAuthProviderRuntimeConfig } from "../runtimeConfig.js";
import type { OAuthProviderAdapter, OAuthProviderContext } from "./providerAdapter.js";

interface BigModelCfTokenEnvelope {
  code?: number;
  msg?: string;
  data?: {
    token?: string | null;
    access_token?: string | null;
    accessToken?: string | null;
    bigmodel?: {
      access_token?: string | null;
      accessToken?: string | null;
      refresh_token?: string | null;
      refreshToken?: string | null;
    } | null;
  } | null;
}

interface BigModelCustomerInfo {
  customerNumber?: unknown;
  customerName?: unknown;
  nickName?: unknown;
  avatar?: unknown;
}

const OAUTH_USERINFO_TIMEOUT_MS = 60_000;
const log = createServiceLogger("bigmodelOAuth");

function maskOAuthCode(code: string): string {
  if (code.length <= 8) {
    return "*".repeat(code.length);
  }

  return `${code.slice(0, 4)}...${code.slice(-4)}`;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readTrimmedString(value: unknown): string {
  return readOptionalString(value)?.trim() || "";
}

function resolveBigModelDisplayName(customer: BigModelCustomerInfo): string {
  const customerName = readTrimmedString(customer.customerName);
  const nickName = readTrimmedString(customer.nickName);
  return customerName || nickName || "user";
}

export class BigModelProviderAdapter implements OAuthProviderAdapter {
  readonly providerId = BIGMODEL_PROVIDER_ID;
  readonly meta: OAuthProviderMeta;
  readonly redirectUri: string;
  readonly apiClient: ApiClient;

  constructor(
    private config: OAuthProviderRuntimeConfig,
    apiClient: ApiClient,
  ) {
    this.meta = {
      id: config.id,
      displayName: config.displayName,
      enabled: config.enabled,
      order: config.order,
    };
    this.redirectUri = config.redirectUri;
    this.apiClient = apiClient;
  }

  async normalizePolledTokenSet(tokenSet: OAuthTokenSet): Promise<OAuthTokenSet> {
    return tokenSet;
  }

  parseCallbackParams(url: string): OAuthCallbackParams {
    const parsed = new URL(url);
    const code = parsed.searchParams.get("authCode") ?? parsed.searchParams.get("code");
    const state = parsed.searchParams.get("state");

    if (!code || !state) {
      throw new Error("OAuth 回调缺少 authCode/code 或 state 参数");
    }

    const attribution = parseOAuthLoginAttribution(parsed.searchParams);

    return { code, state, ...(attribution ? { attribution } : {}) };
  }

  buildAuthorizeUrl(context: OAuthProviderContext): string {
    const query = new URLSearchParams({
      redirect: context.redirectUri,
      appId: this.config.appId,
      state: context.state,
    });

    return `${this.config.authorizeUrl}?${query.toString()}`;
  }

  async exchangeToken(
    params: OAuthCallbackParams,
    _context: OAuthProviderContext,
  ): Promise<OAuthTokenSet> {
    const tokenSet = await this.exchangeCfJwtToken(params, _context);

    return {
      ...tokenSet,
    };
  }

  private async exchangeCfJwtToken(
    params: OAuthCallbackParams,
    context: OAuthProviderContext,
  ): Promise<OAuthTokenSet> {
    log.info(undefined, "cf token request", {
      method: "POST",
      url: this.config.tokenUrl,
      headers: { "Content-Type": "application/json" },
      body: {
        provider: BIGMODEL_PROVIDER_ID,
        code: maskOAuthCode(params.code),
        codeLength: params.code.length,
        redirect_uri: context.redirectUri,
        state: context.state,
      },
    });

    try {
      const payload = await readApiJson<BigModelCfTokenEnvelope>(
        this.apiClient,
        this.config.tokenUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: BIGMODEL_PROVIDER_ID,
            code: params.code,
            redirect_uri: context.redirectUri,
            state: context.state,
          }),
        },
      );
      if (payload.code !== undefined && payload.code !== 0) {
        log.warn(undefined, "cf token business response rejected", {
          code: payload.code,
          msg: payload.msg,
        });
        throw new Error(
          payload.msg?.trim() || `BigModel cf token 交换Failed（code: ${payload.code}）`,
        );
      }
      const cfJwtToken = payload.data?.token?.trim() || "";
      if (!cfJwtToken) {
        log.warn(undefined, "cf token response missing data.token", {
          code: payload.code,
          msg: payload.msg,
        });
        throw new Error("BigModel cf token 交换失败：响应缺少 data.token");
      }
      const accessToken = resolveBigModelBusinessAccessToken(payload);
      if (!accessToken) {
        log.warn(undefined, "cf token response missing bigmodel access token", {
          code: payload.code,
          msg: payload.msg,
        });
        throw new Error("BigModel cf token 交换失败：响应缺少 data.bigmodel.access_token");
      }

      const refreshToken =
        payload.data?.bigmodel?.refresh_token?.trim() ??
        payload.data?.bigmodel?.refreshToken?.trim() ??
        "";
      return {
        accessToken,
        ...(refreshToken ? { refreshToken } : {}),
        cfJwtToken,
      };
    } catch (error) {
      log.warn(undefined, "cf token request failed", {
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof ApiError
          ? {
              method: error.method,
              status: error.status,
              url: error.url,
              responseHeaders: error.responseHeaders ?? {},
            }
          : {}),
      });
      throw error;
    }
  }

  async fetchUserInfo(
    tokenSet: OAuthTokenSet,
    _context: OAuthProviderContext,
  ): Promise<OAuthUserProfile> {
    if (tokenSet.cfJwtToken && tokenSet.accessToken === tokenSet.cfJwtToken) {
      return {
        id: "unknown",
        username: "user",
        displayName: "User",
      };
    }

    const userinfoPayload = await readApiJson<{
      data?: BigModelCustomerInfo;
    }>(this.apiClient, this.config.userinfoUrl, {
      method: "GET",
      timeoutMs: OAUTH_USERINFO_TIMEOUT_MS,
      headers: {
        Authorization: tokenSet.accessToken,
        "Content-Type": "application/json",
      },
    });
    const customer = userinfoPayload.data;

    if (!customer) {
      return {
        id: "unknown",
        username: "user",
        displayName: "User",
      };
    }

    const username = resolveBigModelDisplayName(customer);

    return {
      id: readOptionalString(customer.customerNumber) ?? "unknown",
      username,
      displayName: username,
      avatarUrl: readOptionalString(customer.avatar),
    };
  }

  async loadLegacyTokenSet(
    loadCredential: (key: string) => Promise<string | null>,
  ): Promise<OAuthTokenSet | null> {
    const accessToken = await loadCredential("auth_token");
    if (!accessToken) {
      return null;
    }

    const refreshToken = await loadCredential("refresh_token");

    return {
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
    };
  }

  normalizeError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }

    return new Error(`BigModel OAuth 异常: ${String(error)}`);
  }
}

function resolveBigModelBusinessAccessToken(payload: BigModelCfTokenEnvelope): string {
  return (
    payload.data?.bigmodel?.access_token?.trim() ??
    payload.data?.bigmodel?.accessToken?.trim() ??
    payload.data?.access_token?.trim() ??
    payload.data?.accessToken?.trim() ??
    ""
  );
}
