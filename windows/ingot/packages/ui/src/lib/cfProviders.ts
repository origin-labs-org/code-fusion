import {
  CF_AGENT_PROVIDER,
  CF_AGENT_PROVIDER_LABEL,
  type CfProvider,
} from "@origin-ai/cf-shared";

export const CF_AGENT_PROVIDERS: CfProvider[] = [CF_AGENT_PROVIDER];

export const CF_AGENT_PROVIDER_LABELS: Record<CfProvider, string> = {
  glm: CF_AGENT_PROVIDER_LABEL,
};

export function supportsCfSessionFork(provider: CfProvider): boolean {
  void provider;
  return true;
}

export function shouldHideCfSessionForkAction(provider: CfProvider): boolean {
  return !supportsCfSessionFork(provider);
}
