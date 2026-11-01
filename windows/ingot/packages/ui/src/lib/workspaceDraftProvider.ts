import type { CfProvider } from "@origin-ai/cf-shared";
import type { WorkspaceCfUIState } from "@/store/cfSessionStore.js";

interface ResolveWorkspaceSwitchDraftProviderOptions {
  currentSelectedProvider: CfProvider;
  targetWorkspacePath: string;
  targetWorkspaceIdentity?: string;
  workspaces: Record<string, WorkspaceCfUIState | undefined>;
}

export function resolveWorkspaceSwitchDraftProvider({
  currentSelectedProvider,
  targetWorkspacePath,
  targetWorkspaceIdentity,
  workspaces,
}: ResolveWorkspaceSwitchDraftProviderOptions): CfProvider {
  const workspaceKey = targetWorkspaceIdentity?.trim() || targetWorkspacePath;
  const targetWorkspaceState = workspaces[workspaceKey] ?? workspaces[targetWorkspacePath];

  return targetWorkspaceState?.selectedProvider ?? currentSelectedProvider;
}
