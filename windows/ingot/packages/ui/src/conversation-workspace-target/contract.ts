
export interface ConversationWorkspaceTab {
  readonly kind: "workspace";
  readonly workspacePath: string;
  readonly workspaceIdentity?: string;
  readonly workspacePurpose?: "project" | "conversation";
  readonly remoteSessionId?: string;
  
  readonly remoteTarget?: unknown;
}

export interface ConversationWorkspaceTarget {
  workspacePath: string;
  
  workspaceIdentity?: string;
}

export interface ConversationWorkspaceTargetParams {
  getTabs: () => readonly (ConversationWorkspaceTab | { readonly kind: "settings" })[];
  activeWorkspacePath: string | null;
  activeWorkspaceIdentity: string | null;
  getRemoteSessionSourceServerId?: (remoteSessionId: string) => string | undefined;
  openRemoteConversation?: (remoteSessionId: string, sourceServerId?: string) => Promise<void>;
  resolveLocalConversationWorkspacePath: () => Promise<string>;
}

export type ResolveConversationWorkspaceTarget = (
  params: ConversationWorkspaceTargetParams,
) => Promise<ConversationWorkspaceTarget>;
