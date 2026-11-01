import { resolveWorkspaceKey } from "@origin-ai/cf-shared";
import type {
  ConversationWorkspaceTab,
  ConversationWorkspaceTarget,
  ConversationWorkspaceTargetParams,
} from "@/conversation-workspace-target/contract.js";

export async function resolveConversationWorkspaceTarget(
  params: ConversationWorkspaceTargetParams,
): Promise<ConversationWorkspaceTarget> {
  const activeWorkspaceKey = resolveWorkspaceKey({
    workspacePath: params.activeWorkspacePath ?? "",
    workspaceIdentity: params.activeWorkspaceIdentity ?? undefined,
  });
  const activeTab = params
    .getTabs()
    .find(
      (tab): tab is ConversationWorkspaceTab =>
        tab.kind === "workspace" && resolveWorkspaceKey(tab) === activeWorkspaceKey,
    );
  if (
    activeTab &&
    (activeTab.remoteTarget || activeTab.remoteSessionId || activeTab.workspaceIdentity)
  ) {
    throw new Error("Remote projects require a project workspace");
  }
  if (activeTab?.workspacePurpose === "conversation")
    return { workspacePath: activeTab.workspacePath };
  return { workspacePath: await params.resolveLocalConversationWorkspacePath() };
}
