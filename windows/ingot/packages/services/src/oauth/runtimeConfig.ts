import type { OAuthProviderId } from "@origin-ai/cf-shared";
import { createBigModelProviderRuntimeConfig } from "./providers/bigmodelProviderConfig.js";
import { createZaiProviderRuntimeConfig } from "./providers/zaiProviderConfig.js";

export interface OAuthProviderRuntimeConfig {
  id: OAuthProviderId;
  displayName: string;
  enabled: boolean;
  order: number;
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  appId: string;
  redirectUri: string;
  businessLoginUrl?: string;
  appSecret?: string;
}

export interface OAuthRuntimeConfig {
  providers: OAuthProviderRuntimeConfig[];
}

export function createOAuthRuntimeConfig(env: NodeJS.ProcessEnv = process.env): OAuthRuntimeConfig {
  return {
    providers: [createBigModelProviderRuntimeConfig(env), createZaiProviderRuntimeConfig(env)],
  };
}
