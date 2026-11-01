import {
  normalizeAgentProviderToCfAgent,
  normalizeAgentProvidersToCfAgent,
  type CfProvider,
  type AppSettings,
} from "@origin-ai/cf-shared";
const INSTALLABLE_AGENT_CLI_PROVIDERS: CfProvider[] = [];

export type BuiltinAgentCliStatus =
  | "enabled"
  | "enabling"
  | "disabling"
  | "disabled";

function normalizeEnabledBuiltinAgentCliProviders(
  providers?: ReadonlyArray<CfProvider>,
): CfProvider[] {
  return normalizeAgentProvidersToCfAgent(providers);
}

export function getEnabledBuiltinAgentCliProviders(
  settings: Pick<AppSettings, "enabledBuiltinAgentCliProviders"> | null | undefined,
): CfProvider[] {
  return normalizeEnabledBuiltinAgentCliProviders(
    settings?.enabledBuiltinAgentCliProviders,
  );
}

export function requiresBuiltinAgentCliInstall(provider: CfProvider): boolean {
  return INSTALLABLE_AGENT_CLI_PROVIDERS.includes(provider);
}

export function resolveBuiltinAgentCliStatus(params: {
  provider: CfProvider;
  enabledProviders: readonly CfProvider[];
  enablingProvider: CfProvider | null;
  disablingProvider: CfProvider | null;
}): BuiltinAgentCliStatus {
  if (!requiresBuiltinAgentCliInstall(params.provider)) {
    return "enabled";
  }

  if (params.enablingProvider === params.provider) {
    return "enabling";
  }

  if (params.disablingProvider === params.provider) {
    return "disabling";
  }

  return params.enabledProviders.includes(params.provider) ? "enabled" : "disabled";
}

export function getEffectiveBuiltinAgentCliProvider(
  _settings: Pick<AppSettings, "enabledBuiltinAgentCliProviders"> | null | undefined,
  provider: CfProvider,
): CfProvider {
  return normalizeAgentProviderToCfAgent(provider);
}
