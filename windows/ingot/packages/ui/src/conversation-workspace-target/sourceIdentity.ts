import {
  parseRemoteWorkspaceIdentity,
  type SourceServerWorkspaceHistoryEntry,
} from "@origin-ai/cf-shared";
import type { WorkspaceTabState } from "@/store/tabStore.js";

interface WorkspaceSourceResolutionOptions {
  workspaceHistory?: readonly SourceServerWorkspaceHistoryEntry[];
}

export function getWorkspaceSourceServerId(
  tab: Pick<WorkspaceTabState, "workspaceIdentity" | "workspacePath" | "remoteTarget">,
  options: WorkspaceSourceResolutionOptions = {},
): string | null {
  if (tab.remoteTarget?.kind === "server") return null;
  const parsed = tab.workspaceIdentity ? parseRemoteWorkspaceIdentity(tab.workspaceIdentity) : null;
  if (parsed?.kind === "server") return parsed.sourceServerId ?? null;

  const legacyWorkspaceIdentity = tab.workspaceIdentity?.trim();
  if (!legacyWorkspaceIdentity) return null;
  const matchingSourceServerIds = new Set(
    options.workspaceHistory
      ?.filter(
        (entry) =>
          entry.workspacePath === tab.workspacePath &&
          entry.legacyWorkspaceIdentity?.trim() === legacyWorkspaceIdentity &&
          Boolean(entry.sourceServerId?.trim()),
      )
      .map((entry) => entry.sourceServerId!.trim()) ?? [],
  );
  return matchingSourceServerIds.size === 1
    ? (matchingSourceServerIds.values().next().value ?? null)
    : null;
}
