import type { ServiceAuthorityMode } from "@origin-ai/cf-shared";

export type CfAgentPresentationSurface = "desktop";

export interface CfAgentPresentationHostFacts {
  runtimeSurface?: "desktop_local_host" | "remote_workspace_host";
  serviceAuthorityMode?: ServiceAuthorityMode;
  
  desktopContextPromptEnabled?: boolean;
}

export function resolveCfAgentPresentationSurface(
  facts: CfAgentPresentationHostFacts,
): CfAgentPresentationSurface | undefined {
  const isDesktopHost =
    facts.runtimeSurface === "desktop_local_host" ||
    facts.serviceAuthorityMode === "desktop-attached-remote";
  if (!isDesktopHost || facts.desktopContextPromptEnabled === false) {
    return undefined;
  }
  return "desktop";
}
