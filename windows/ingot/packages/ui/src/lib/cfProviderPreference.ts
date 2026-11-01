import {
  normalizeAgentProviderToCfAgent,
  CF_AGENT_PROVIDER,
  type CfProvider,
} from "@origin-ai/cf-shared";
import { CF_AGENT_PROVIDERS } from "./cfProviders.js";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const LAST_SELECTED_AGENT_PROVIDER_STORAGE_KEY = "cf-last-agent-provider";

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isAgentProvider(value: unknown): value is CfProvider {
  return typeof value === "string" && CF_AGENT_PROVIDERS.includes(value as CfProvider);
}

export function readLastSelectedAgentProvider(storage: StorageLike | null = getBrowserStorage()): CfProvider | null {
  const rawValue = storage?.getItem(LAST_SELECTED_AGENT_PROVIDER_STORAGE_KEY);
  if (!isAgentProvider(rawValue)) {
    return CF_AGENT_PROVIDER;
  }

  return normalizeAgentProviderToCfAgent(rawValue);
}

export function persistLastSelectedAgentProvider(
  provider: CfProvider,
  storage: StorageLike | null = getBrowserStorage(),
) {
  storage?.setItem(
    LAST_SELECTED_AGENT_PROVIDER_STORAGE_KEY,
    normalizeAgentProviderToCfAgent(provider),
  );
}
