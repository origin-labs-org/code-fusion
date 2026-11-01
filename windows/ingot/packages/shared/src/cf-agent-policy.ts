import { z } from "zod";
import type { CommandAgentSource } from "./command-types.js";
import type { CfProvider } from "./cf-task-types-core.js";

export const CF_AGENT_PROVIDER = "glm" satisfies CfProvider;
export const CF_AGENT_PROVIDER_LABEL = "CodeFusion Agent";
export const CF_COMMAND_AGENT_SOURCE = "cfAgent" satisfies CommandAgentSource;

export const legacyCfProviderSchema = z
  .enum(["claude", "opencode", "gemini", "codex", "glm"])
  .transform((): typeof CF_AGENT_PROVIDER => CF_AGENT_PROVIDER);

export const CF_ENABLED_AGENT_PROVIDERS = [
  CF_AGENT_PROVIDER,
] as const satisfies readonly CfProvider[];

export const CF_COMMAND_AGENT_SOURCES = [
  CF_COMMAND_AGENT_SOURCE,
] as const satisfies readonly CommandAgentSource[];

export function normalizeAgentProviderToCfAgent(
  _provider?: CfProvider | null,
): CfProvider {
  return CF_AGENT_PROVIDER;
}

export function normalizeAgentProvidersToCfAgent(
  _providers?: ReadonlyArray<CfProvider> | null,
): CfProvider[] {
  return [...CF_ENABLED_AGENT_PROVIDERS];
}

export function normalizeCommandAgentSourceToCfAgent(
  _agentSource?: CommandAgentSource | null,
): CommandAgentSource {
  return CF_COMMAND_AGENT_SOURCE;
}

export function isCfAgentProvider(
  provider: CfProvider | null | undefined,
): provider is typeof CF_AGENT_PROVIDER {
  return provider === CF_AGENT_PROVIDER;
}
