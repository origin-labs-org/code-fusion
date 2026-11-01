import type { CfProvider } from "@origin-ai/cf-shared";

export function resolveWorkspaceHeaderProvider(
  activeTaskProvider: CfProvider | null,
  selectedProvider: CfProvider,
): CfProvider {
  return activeTaskProvider ?? selectedProvider;
}
