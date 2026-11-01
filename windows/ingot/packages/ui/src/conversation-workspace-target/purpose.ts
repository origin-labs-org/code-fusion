import type { WorkspacePurpose } from "@origin-ai/cf-shared";

export function isRemoteConversationWorkspace(target: {
  workspacePurpose?: WorkspacePurpose;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  remoteTarget?: unknown;
  kind?: string;
}): boolean {
  return (
    target.workspacePurpose === "conversation" &&
    Boolean(
      target.kind === "remote" ||
      target.remoteTarget ||
      target.remoteSessionId ||
      target.workspaceIdentity?.trim(),
    )
  );
}
