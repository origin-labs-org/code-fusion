import type {
  OAuthCachedSessionRestoreResult,
  OAuthCallbackResult,
  OAuthProviderId,
  OAuthProviderMeta,
  OAuthSessionState,
  OAuthStartResponse,
  UserInfo,
} from "@origin-ai/cf-shared";
import { ServiceChannels } from "@origin-ai/cf-shared";
import type { Event } from "@origin-ai/cf-rpc";
import { createServiceDescriptor } from "../descriptors.js";

export interface IOAuthService {
  
  readonly onDidChangeSession: Event<OAuthSessionState>;

  
  getProviders(): Promise<OAuthProviderMeta[]>;

  
  getActiveProvider(): Promise<OAuthProviderId | null>;

  
  restoreCachedSession(): Promise<UserInfo | null>;

  
  restoreCachedSessionState(): Promise<OAuthCachedSessionRestoreResult>;

  
  restoreSession(): Promise<UserInfo | null>;

  
  startOAuth(provider: OAuthProviderId): Promise<OAuthStartResponse>;

  
  startOAuthWithPolling(provider: OAuthProviderId): Promise<OAuthStartResponse>;

  
  pollPendingOAuth(): Promise<OAuthCallbackResult | null>;

  
  handleCallback(url: string): Promise<OAuthCallbackResult | null>;

  
  refreshToken(provider?: OAuthProviderId): Promise<void>;

  
  logout(provider?: OAuthProviderId): Promise<void>;

  
  logoutAll(): Promise<void>;

  
  cancelPending(provider?: OAuthProviderId): Promise<void>;
}

export const IOAuthService = createServiceDescriptor<IOAuthService>(ServiceChannels.OAuth);
