import type { WorkspacePurpose, CfTaskMeta } from "@origin-ai/cf-shared";

export type CfTaskListKind = "pinned" | "archived" | "timeline" | "active";
export type CfTaskListSortBy = "created" | "updated";

export interface CfTaskListWorkspaceScope {
  workspacePath: string;
  workspaceIdentity?: string;
  workspacePurpose?: WorkspacePurpose;
}

export interface CfTaskListQuery {
  kind: CfTaskListKind;
  workspaceScopes: CfTaskListWorkspaceScope[];
  sortBy: CfTaskListSortBy;
  search?: string;
  limit?: number;
}

export type CfTaskListItem = CfTaskMeta & {
  searchSnippet?: string;
  searchSnippets?: string[];
};

export interface CfTaskListResult {
  items: CfTaskListItem[];
  total: number;
  hasMore: boolean;
}

export interface CfWorkspaceEventSubscriptionParams {
  workspacePath: string;
  workspaceIdentity?: string;
}
