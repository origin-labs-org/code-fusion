import type {
  ConversationWorkspaceTargetParams,
  ResolveConversationWorkspaceTarget,
} from "@/conversation-workspace-target/contract.js";

export function exampleConversationWorkspaceTarget(
  resolve: ResolveConversationWorkspaceTarget,
  ports: ConversationWorkspaceTargetParams,
) {
  return resolve(ports);
}
