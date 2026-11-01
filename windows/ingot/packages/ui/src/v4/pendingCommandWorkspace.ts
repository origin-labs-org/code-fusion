import type { SessionCreateSource } from "@origin-ai/cf-shared";
import type { ComposerRecentReceipt } from "@/lib/composerRecent.js";
export interface PendingCommandClientContext {
  composer?: ComposerRecentReceipt & { draftId?: string; submittedText?: string };
  workspace?: {
    workspacePath: string;
    workspaceIdentity?: string;
  };
  projectId?: string | null;
  taskGroupId?: string | null;
  sessionCreateSource?: SessionCreateSource;
}

interface WorkspaceScopedPendingCommand {
  clientContext?: PendingCommandClientContext;
  replay: {
    kind: "input" | "sensitiveDigest";
    type: string;
    payload?: Record<string, unknown>;
  };
}

export function resolvePendingCommandWorkspaceKey(
  entry: WorkspaceScopedPendingCommand,
): string | null {
  const workspace = entry.clientContext?.workspace;
  if (workspace) {
    return workspace.workspaceIdentity?.trim() || workspace.workspacePath;
  }
  if (entry.replay.kind !== "input" || entry.replay.type !== "createSession") {
    return null;
  }
  const workspaceId = entry.replay.payload?.workspaceId;
  return typeof workspaceId === "string" && workspaceId.trim() ? workspaceId.trim() : null;
}

export function isPendingCommandForWorkspace(
  entry: WorkspaceScopedPendingCommand,
  workspacePath: string,
  workspaceIdentity?: string,
): boolean {
  return resolvePendingCommandWorkspaceKey(entry) === (workspaceIdentity?.trim() || workspacePath);
}
