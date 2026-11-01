import {
  BIGMODEL_PROVIDER_ID,
  ZAI_PROVIDER_ID,
  type OAuthProviderId,
  type OAuthTokenSet,
  type OAuthCachedSessionRestoreResult,
  type UserInfo,
  resolveJwtExpiration,
} from "@origin-ai/cf-shared";
import { toUserInfo } from "./zaiWebOAuthProvider.js";

const ACTIVE_PROVIDER_KEY = "oauth:active_provider";
const CF_JWT_TOKEN_KEY = "cfjwttoken";
const ZAI_ACCESS_TOKEN_KEY = "oauth:zai:access_token";
const ZAI_USER_INFO_KEY = "oauth:zai:user_info";
const BIGMODEL_ACCESS_TOKEN_KEY = "oauth:bigmodel:access_token";
const BIGMODEL_USER_INFO_KEY = "oauth:bigmodel:user_info";
const OAUTH_PENDING_LOGINS_KEY = "oauth_pending_logins";
const MAX_PENDING_LOGINS = 5;

export type WebOAuthProviderId = typeof ZAI_PROVIDER_ID | typeof BIGMODEL_PROVIDER_ID;

export function isWebOAuthProviderId(value: unknown): value is WebOAuthProviderId {
  return value === ZAI_PROVIDER_ID || value === BIGMODEL_PROVIDER_ID;
}

function providerKeys(provider: WebOAuthProviderId): { accessToken: string; userInfo: string } {
  return provider === BIGMODEL_PROVIDER_ID
    ? { accessToken: BIGMODEL_ACCESS_TOKEN_KEY, userInfo: BIGMODEL_USER_INFO_KEY }
    : { accessToken: ZAI_ACCESS_TOKEN_KEY, userInfo: ZAI_USER_INFO_KEY };
}

interface BrowserOAuthCredentialRepoStorage {
  localStorage: Storage;
}

export interface PendingOAuthLogin {
  nonce: string;
  provider: WebOAuthProviderId;
  redirectUri: string;
}

function isPendingOAuthLogin(value: unknown): value is PendingOAuthLogin {
  if (!value || typeof value !== "object") return false;
  const login = value as Partial<Record<keyof PendingOAuthLogin, unknown>>;
  return (
    typeof login.nonce === "string" &&
    hasText(login.nonce) &&
    isWebOAuthProviderId(login.provider) &&
    typeof login.redirectUri === "string" &&
    hasText(login.redirectUri)
  );
}

interface BrowserOAuthCredentialRepoOptions {
  now?: () => number;
}

interface WebZaiTokenSet {
  cfJwtToken: string;
  zaiAccessToken: string;
  expiresAt?: number;
}

function getBrowserStorage(): BrowserOAuthCredentialRepoStorage {
  return { localStorage: window.localStorage };
}

function hasText(value: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export class BrowserOAuthCredentialRepo {
  private readonly localStorage: Storage;
  private readonly now: () => number;

  constructor(
    storage: BrowserOAuthCredentialRepoStorage = getBrowserStorage(),
    options: BrowserOAuthCredentialRepoOptions = {},
  ) {
    this.localStorage = storage.localStorage;
    this.now = options.now ?? Date.now;
  }

  saveTokenSet(tokenSet: WebZaiTokenSet | OAuthTokenSet, provider: WebOAuthProviderId): void {
    const accessToken =
      "zaiAccessToken" in tokenSet ? tokenSet.zaiAccessToken : tokenSet.accessToken;
    const cfJwtToken = tokenSet.cfJwtToken;

    this.localStorage.setItem(providerKeys(provider).accessToken, accessToken);
    if (cfJwtToken) {
      this.localStorage.setItem(CF_JWT_TOKEN_KEY, cfJwtToken);
    } else {
      this.localStorage.removeItem(CF_JWT_TOKEN_KEY);
    }
  }

  saveUserInfo(user: unknown, provider: WebOAuthProviderId): void {
    const rawUserInfo = JSON.stringify(user);
    this.localStorage.setItem(providerKeys(provider).userInfo, rawUserInfo);
  }

  setActiveProvider(provider: WebOAuthProviderId | null): void {
    if (!provider) {
      this.localStorage.removeItem(ACTIVE_PROVIDER_KEY);
      return;
    }

    this.localStorage.setItem(ACTIVE_PROVIDER_KEY, provider);
  }

  getActiveProvider(): OAuthProviderId | null {
    return this.localStorage.getItem(ACTIVE_PROVIDER_KEY);
  }

  loadCachedSession(): UserInfo | null {
    const result = this.loadCachedSessionState();
    return result.status === "authenticated" ? result.userInfo : null;
  }

  
  loadActiveAccount(): { provider: WebOAuthProviderId; userInfo: UserInfo } | null {
    try {
      const provider = this.localStorage.getItem(ACTIVE_PROVIDER_KEY);
      if (!isWebOAuthProviderId(provider)) return null;
      const rawUserInfo = this.localStorage.getItem(providerKeys(provider).userInfo);
      if (!hasText(rawUserInfo)) return null;
      const userInfo = toUserInfo(JSON.parse(rawUserInfo));
      return userInfo ? { provider, userInfo } : null;
    } catch {
      return null;
    }
  }

  loadCachedSessionState(): OAuthCachedSessionRestoreResult {
    const activeProvider = this.localStorage.getItem(ACTIVE_PROVIDER_KEY);
    const cfJwtToken = this.localStorage.getItem(CF_JWT_TOKEN_KEY);
    const keys = isWebOAuthProviderId(activeProvider) ? providerKeys(activeProvider) : null;
    const accessToken = keys ? this.localStorage.getItem(keys.accessToken) : null;
    const rawUserInfo = keys ? this.localStorage.getItem(keys.userInfo) : null;

    if (!keys || !hasText(cfJwtToken) || !hasText(accessToken) || !hasText(rawUserInfo)) {
      if (this.hasAnyStoredCredential()) {
        this.clearAll();
      }
      return { status: "signed-out" };
    }

    if (resolveJwtExpiration(cfJwtToken, this.now()).kind === "expired") {
      this.clearAll();
      return { status: "reauthentication-required", reason: "jwt-expired" };
    }

    try {
      const userInfo = toUserInfo(JSON.parse(rawUserInfo));
      if (userInfo) {
        return { status: "authenticated", userInfo };
      }
    } catch {
    }

    this.clearAll();
    return { status: "signed-out" };
  }

  loadCfJwtToken(): string | null {
    const session = this.loadCachedSessionState();
    if (session.status !== "authenticated") return null;
    return this.localStorage.getItem(CF_JWT_TOKEN_KEY)?.trim() || null;
  }

  private hasAnyStoredCredential(): boolean {
    return Boolean(
      this.localStorage.getItem(ACTIVE_PROVIDER_KEY) ||
      this.localStorage.getItem(CF_JWT_TOKEN_KEY) ||
      this.localStorage.getItem(ZAI_ACCESS_TOKEN_KEY) ||
      this.localStorage.getItem(ZAI_USER_INFO_KEY) ||
      this.localStorage.getItem(BIGMODEL_ACCESS_TOKEN_KEY) ||
      this.localStorage.getItem(BIGMODEL_USER_INFO_KEY),
    );
  }

  clearAll(): void {
    this.localStorage.removeItem(ACTIVE_PROVIDER_KEY);
    this.localStorage.removeItem(CF_JWT_TOKEN_KEY);
    this.localStorage.removeItem(ZAI_ACCESS_TOKEN_KEY);
    this.localStorage.removeItem(ZAI_USER_INFO_KEY);
    this.localStorage.removeItem(BIGMODEL_ACCESS_TOKEN_KEY);
    this.localStorage.removeItem(BIGMODEL_USER_INFO_KEY);
  }

  
  savePendingLogin(login: PendingOAuthLogin): void {
    const logins = this.readPendingLogins().filter((pending) => pending.nonce !== login.nonce);
    this.writePendingLogins([...logins, login].slice(-MAX_PENDING_LOGINS));
  }

  
  takePendingLogin(nonce: string): PendingOAuthLogin | null {
    const logins = this.readPendingLogins();
    const login = logins.find((pending) => pending.nonce === nonce);
    if (!login) return null;
    this.writePendingLogins(logins.filter((pending) => pending !== login));
    return login;
  }

  private readPendingLogins(): PendingOAuthLogin[] {
    const raw = this.localStorage.getItem(OAUTH_PENDING_LOGINS_KEY);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isPendingOAuthLogin) : [];
    } catch {
      return [];
    }
  }

  private writePendingLogins(logins: PendingOAuthLogin[]): void {
    if (logins.length > 0) {
      this.localStorage.setItem(OAUTH_PENDING_LOGINS_KEY, JSON.stringify(logins));
    } else {
      this.localStorage.removeItem(OAUTH_PENDING_LOGINS_KEY);
    }
  }
}
