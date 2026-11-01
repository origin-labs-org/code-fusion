import { useMemo } from "react";
import type { CfConfigOption } from "@origin-ai/cf-shared";
import { selectWorkspaceCfState, useCfSessionStore } from "@/store/cfSessionStore.js";

function workflowSubagentProviderNameLookup(
  configOptions: readonly CfConfigOption[] | null | undefined,
): ((providerId: string) => string | undefined) | undefined {
  const entries = configOptions?.find((option) => option.category === "model")?.options;
  if (entries === undefined) {
    return undefined;
  }
  const names = new Map<string, string>();
  for (const entry of entries) {
    const providerId = entry.modelProviderId?.trim();
    const providerName = entry.modelProviderName?.trim();
    if (!providerId || !providerName || providerName === providerId) {
      continue;
    }
    if (!names.has(providerId)) {
      names.set(providerId, providerName);
    }
  }
  return names.size === 0 ? undefined : (providerId: string) => names.get(providerId);
}

export function useWorkflowSubagentModelProviderName(
  workspacePath: string | undefined,
  workspaceIdentity?: string,
): ((providerId: string) => string | undefined) | undefined {
  const configOptions = useCfSessionStore((state) =>
    workspacePath === undefined
      ? undefined
      : selectWorkspaceCfState(state, workspacePath, workspaceIdentity).configOptions,
  );
  return useMemo(() => workflowSubagentProviderNameLookup(configOptions), [configOptions]);
}
