import type {
  CfTaskListKind,
  CfTaskListSortBy,
  CfTaskListWorkspaceScope,
} from "@origin-ai/cf-services";
import type { CfTaskMeta } from "@origin-ai/cf-shared";
import { resolveWorkspaceStateKey } from "@/store/cfSessionStoreSelectors.js";

export type TaskEntityKey = string;
export type TaskListCacheKey = string;
export type TaskListQueryKind = CfTaskListKind | "workspace";

export interface TaskListCacheDescriptor {
  kind: TaskListQueryKind;
  sortBy: CfTaskListSortBy;
  search: string;
  expanded: boolean;
  visibleLimit: number | null;
  workspaceKeys: string[];
}

export interface CachedTaskListResult {
  taskKeys: TaskEntityKey[];
  
  unreadTaskKeys?: TaskEntityKey[];
  searchSnippetsByTaskKey?: Record<TaskEntityKey, string>;
  searchSnippetListsByTaskKey?: Record<TaskEntityKey, string[]>;
  total: number;
  hasMore: boolean;
  fetchedAt: number;
  
  invalidationVersion: number;
  stale: boolean;
  partial: boolean;
  loadingShardKeys: string[];
  failedShardKeys: string[];
  descriptor: TaskListCacheDescriptor;
}

export function buildTaskWorkspaceKey(workspacePath: string, workspaceIdentity?: string): string {
  return resolveWorkspaceStateKey(workspacePath, workspaceIdentity);
}

export function buildTaskEntityKey(task: Pick<CfTaskMeta, "taskId" | "workspacePath" | "workspaceIdentity">): TaskEntityKey {
  return `${buildTaskWorkspaceKey(task.workspacePath, task.workspaceIdentity)}::${task.taskId}`;
}

export function normalizeTaskListWorkspaceScopes(
  scopes: CfTaskListWorkspaceScope[],
): CfTaskListWorkspaceScope[] {
  const uniqueScopes = new Map<string, CfTaskListWorkspaceScope>();

  for (const scope of scopes) {
    const workspaceKey = buildTaskWorkspaceKey(scope.workspacePath, scope.workspaceIdentity);
    if (!workspaceKey.trim()) {
      continue;
    }
    uniqueScopes.set(workspaceKey, scope);
  }

  return [...uniqueScopes.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, scope]) => scope);
}

function normalizeTaskListSearch(search?: string): string {
  return search?.trim().toLocaleLowerCase() ?? "";
}

export function buildTaskListCacheDescriptor(params: {
  kind: TaskListQueryKind;
  workspaceScopes: CfTaskListWorkspaceScope[];
  sortBy: CfTaskListSortBy;
  search?: string;
  expanded: boolean;
  visibleLimit?: number | null;
}): TaskListCacheDescriptor {
  const normalizedScopes = normalizeTaskListWorkspaceScopes(params.workspaceScopes);
  const workspaceKeys = normalizedScopes.map((scope) =>
    buildTaskWorkspaceKey(scope.workspacePath, scope.workspaceIdentity),
  );

  return {
    kind: params.kind,
    sortBy: params.sortBy,
    search: normalizeTaskListSearch(params.search),
    expanded: params.expanded,
    visibleLimit:
      params.expanded || params.visibleLimit === undefined ? null : params.visibleLimit,
    workspaceKeys,
  };
}

export function buildTaskListCacheKeyFromDescriptor(
  descriptor: TaskListCacheDescriptor,
): TaskListCacheKey {
  const workspaceSegment = descriptor.workspaceKeys.join("|");

  return [
    descriptor.kind,
    descriptor.sortBy,
    descriptor.expanded ? "expanded" : "collapsed",
    `limit=${descriptor.visibleLimit ?? "all"}`,
    `search=${descriptor.search}`,
    `workspaces=${workspaceSegment}`,
  ].join("::");
}
