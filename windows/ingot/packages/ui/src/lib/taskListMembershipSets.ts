import type { ICfTaskService } from "@origin-ai/cf-services";
import type { CfTaskMeta } from "@origin-ai/cf-shared";
import { buildTaskEntityKey } from "@/lib/taskQueryCache.js";

export interface TaskListMembershipScope {
  workspacePath: string;
  workspaceIdentity?: string;
}

export type TaskListMembershipService = Pick<
  ICfTaskService,
  "listPinnedTaskIds" | "listArchivedTasks" | "listTasks" | "listPinnedTasks"
> &
  Partial<Pick<ICfTaskService, "listDeletedTaskIds">>;

export interface TaskListMembershipSets {
  
  taskIndexItems: CfTaskMeta[];
  pinnedIds: Set<string>;
  archivedIds: Set<string>;
  
  deletedIds: Set<string>;
  
  unreadAtByTaskId: Map<string, number>;
  
  terminalStatusByTaskId: Map<string, Extract<CfTaskMeta["status"], "completed" | "error">>;
  
  titleOverrideByTaskId: Map<string, string>;
  
  cronAutomationIdByTaskId: Map<string, string>;
}

export interface TaskListMembershipRefreshHoldState {
  armed: boolean;
  enteredCallCount: number;
  released: boolean;
}

interface ActiveTaskListMembershipRefreshHold {
  released: Promise<void>;
  release: () => void;
}

let activeTaskListMembershipRefreshHold: ActiveTaskListMembershipRefreshHold | null = null;
let taskListMembershipRefreshHoldState: TaskListMembershipRefreshHoldState = {
  armed: false,
  enteredCallCount: 0,
  released: true,
};

export function armTaskListMembershipRefreshHoldForE2E(): void {
  if (activeTaskListMembershipRefreshHold) {
    throw new Error("task list membership refresh hold already started");
  }
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  activeTaskListMembershipRefreshHold = { released, release };
  taskListMembershipRefreshHoldState = {
    armed: true,
    enteredCallCount: 0,
    released: false,
  };
  clearTaskListMembershipCache();
}

export function releaseTaskListMembershipRefreshHoldForE2E(): void {
  const hold = activeTaskListMembershipRefreshHold;
  if (!hold) {
    return;
  }
  activeTaskListMembershipRefreshHold = null;
  taskListMembershipRefreshHoldState = {
    ...taskListMembershipRefreshHoldState,
    armed: false,
    released: true,
  };
  hold.release();
}

export function getTaskListMembershipRefreshHoldStateForE2E(): TaskListMembershipRefreshHoldState {
  return { ...taskListMembershipRefreshHoldState };
}

async function holdTaskListMembershipRefreshResultForE2E(): Promise<void> {
  const hold = activeTaskListMembershipRefreshHold;
  if (!hold) {
    return;
  }
  taskListMembershipRefreshHoldState = {
    ...taskListMembershipRefreshHoldState,
    enteredCallCount: taskListMembershipRefreshHoldState.enteredCallCount + 1,
  };
  await hold.released;
}

export interface TaskListMembershipEndpoint {
  service: TaskListMembershipService;
  scopes: TaskListMembershipScope[];
}

function scopeParams(scope: TaskListMembershipScope): {
  workspacePath: string;
  workspaceIdentity?: string;
} {
  return {
    workspacePath: scope.workspacePath,
    ...(scope.workspaceIdentity ? { workspaceIdentity: scope.workspaceIdentity } : {}),
  };
}

async function listOrEmpty<T>(list: () => Promise<T[]>): Promise<T[]> {
  try {
    return await list();
  } catch {
    return [];
  }
}

async function listWithAvailability<T>(
  list: () => Promise<T[]>,
): Promise<{ items: T[]; available: boolean }> {
  try {
    return { items: await list(), available: true };
  } catch {
    return { items: [], available: false };
  }
}

function collectUnreadAt(unreadAtByTaskId: Map<string, number>, tasks: CfTaskMeta[]): void {
  for (const task of tasks) {
    if (typeof task.unreadAt === "number") {
      unreadAtByTaskId.set(task.taskId, task.unreadAt);
    }
  }
}

function collectTerminalStatuses(
  terminalStatusByTaskId: TaskListMembershipSets["terminalStatusByTaskId"],
  tasks: CfTaskMeta[],
): void {
  for (const task of tasks) {
    if (task.status === "completed" || task.status === "error") {
      terminalStatusByTaskId.set(task.taskId, task.status);
    }
  }
}

function collectTitleOverrides(
  titleOverrideByTaskId: Map<string, string>,
  tasks: CfTaskMeta[],
): void {
  for (const task of tasks) {
    if (task.titleOverridden === true && task.title.trim().length > 0) {
      titleOverrideByTaskId.set(task.taskId, task.title);
    }
  }
}

function collectCronAutomationIds(
  cronAutomationIdByTaskId: Map<string, string>,
  tasks: CfTaskMeta[],
): void {
  for (const task of tasks) {
    if (task.cronAutomationId) {
      cronAutomationIdByTaskId.set(task.taskId, task.cronAutomationId);
    }
  }
}

function mergeTaskIndexItems(lists: CfTaskMeta[][]): CfTaskMeta[] {
  const itemByEntityKey = new Map<string, CfTaskMeta>();
  for (const task of lists.flat()) {
    itemByEntityKey.set(buildTaskEntityKey(task), task);
  }
  return [...itemByEntityKey.values()];
}

export async function fetchTaskListMembershipSets(params: {
  service: TaskListMembershipService;
  scopes: TaskListMembershipScope[];
}): Promise<TaskListMembershipSets> {
  const [
    pinnedList,
    archivedListResults,
    activeListResults,
    pinnedMetaListResults,
    deletedIdLists,
  ] = await Promise.all([
    listOrEmpty(() => params.service.listPinnedTaskIds()),
    Promise.all(
      params.scopes.map((scope) =>
        listWithAvailability(() => params.service.listArchivedTasks(scopeParams(scope))),
      ),
    ),
    Promise.all(
      params.scopes.map((scope) =>
        listWithAvailability(() => params.service.listTasks(scopeParams(scope))),
      ),
    ),
    Promise.all(
      params.scopes.map((scope) =>
        listWithAvailability(() => params.service.listPinnedTasks(scopeParams(scope))),
      ),
    ),
    Promise.all(
      params.scopes.map((scope) =>
        params.service.listDeletedTaskIds
          ? listOrEmpty(() => params.service.listDeletedTaskIds!(scopeParams(scope)))
          : Promise.resolve([]),
      ),
    ),
  ]);
  await holdTaskListMembershipRefreshResultForE2E();
  if (
    activeListResults.some((result) => !result.available) ||
    archivedListResults.some((result) => !result.available) ||
    pinnedMetaListResults.some((result) => !result.available)
  ) {
    throw new Error("tasks-index task 行读取不完整");
  }
  const archivedLists = archivedListResults.map((result) => result.items);
  const activeLists = activeListResults.map((result) => result.items);
  const pinnedMetaLists = pinnedMetaListResults.map((result) => result.items);
  const unreadAtByTaskId = new Map<string, number>();
  const terminalStatusByTaskId: TaskListMembershipSets["terminalStatusByTaskId"] = new Map();
  const titleOverrideByTaskId = new Map<string, string>();
  const cronAutomationIdByTaskId = new Map<string, string>();
  collectUnreadAt(unreadAtByTaskId, archivedLists.flat());
  collectUnreadAt(unreadAtByTaskId, activeLists.flat());
  collectUnreadAt(unreadAtByTaskId, pinnedMetaLists.flat());
  collectTerminalStatuses(terminalStatusByTaskId, archivedLists.flat());
  collectTerminalStatuses(terminalStatusByTaskId, activeLists.flat());
  collectTerminalStatuses(terminalStatusByTaskId, pinnedMetaLists.flat());
  collectTitleOverrides(titleOverrideByTaskId, archivedLists.flat());
  collectTitleOverrides(titleOverrideByTaskId, activeLists.flat());
  collectTitleOverrides(titleOverrideByTaskId, pinnedMetaLists.flat());
  collectCronAutomationIds(cronAutomationIdByTaskId, archivedLists.flat());
  collectCronAutomationIds(cronAutomationIdByTaskId, activeLists.flat());
  collectCronAutomationIds(cronAutomationIdByTaskId, pinnedMetaLists.flat());
  return {
    taskIndexItems: mergeTaskIndexItems([
      activeLists.flat(),
      pinnedMetaLists.flat(),
      archivedLists.flat(),
    ]),
    pinnedIds: new Set([...pinnedList, ...pinnedMetaLists.flat().map((task) => task.taskId)]),
    archivedIds: new Set(archivedLists.flat().map((task) => task.taskId)),
    deletedIds: new Set(deletedIdLists.flat()),
    unreadAtByTaskId,
    terminalStatusByTaskId,
    titleOverrideByTaskId,
    cronAutomationIdByTaskId,
  };
}

const membershipPromiseByCacheKey = new Map<string, Promise<TaskListMembershipSets>>();
const MEMBERSHIP_CACHE_MAX_KEYS = 8;
const membershipServiceIds = new WeakMap<TaskListMembershipService, number>();
let nextMembershipServiceId = 1;

function membershipServiceIdOf(service: TaskListMembershipService): number {
  let id = membershipServiceIds.get(service);
  if (id === undefined) {
    id = nextMembershipServiceId++;
    membershipServiceIds.set(service, id);
  }
  return id;
}

export function fetchTaskListMembershipSetsForEndpointsCached(params: {
  
  cacheKey: string;
  endpoints: TaskListMembershipEndpoint[];
}): Promise<TaskListMembershipSets> {
  const fullCacheKey = `${params.cacheKey}::svc=${params.endpoints
    .map((endpoint) => membershipServiceIdOf(endpoint.service))
    .join(",")}`;
  const cached = membershipPromiseByCacheKey.get(fullCacheKey);
  if (cached) {
    return cached;
  }
  const promise = fetchTaskListMembershipSetsForEndpoints(params.endpoints);
  membershipPromiseByCacheKey.set(fullCacheKey, promise);
  promise.catch(() => membershipPromiseByCacheKey.delete(fullCacheKey));
  while (membershipPromiseByCacheKey.size > MEMBERSHIP_CACHE_MAX_KEYS) {
    const oldestKey = membershipPromiseByCacheKey.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    membershipPromiseByCacheKey.delete(oldestKey);
  }
  return promise;
}

export function clearTaskListMembershipCache(): void {
  membershipPromiseByCacheKey.clear();
}

export async function fetchTaskListMembershipSetsForEndpoints(
  endpoints: TaskListMembershipEndpoint[],
): Promise<TaskListMembershipSets> {
  const results = await Promise.all(
    endpoints
      .filter((endpoint) => endpoint.scopes.length > 0)
      .map((endpoint) =>
        fetchTaskListMembershipSets({
          service: endpoint.service,
          scopes: endpoint.scopes,
        }),
      ),
  );
  const merged: TaskListMembershipSets = {
    taskIndexItems: [],
    pinnedIds: new Set<string>(),
    archivedIds: new Set<string>(),
    deletedIds: new Set<string>(),
    unreadAtByTaskId: new Map<string, number>(),
    terminalStatusByTaskId: new Map(),
    titleOverrideByTaskId: new Map<string, string>(),
    cronAutomationIdByTaskId: new Map<string, string>(),
  };
  const taskIndexItemByEntityKey = new Map<string, CfTaskMeta>();
  for (const result of results) {
    for (const task of result.taskIndexItems) {
      taskIndexItemByEntityKey.set(buildTaskEntityKey(task), task);
    }
    for (const taskId of result.pinnedIds) merged.pinnedIds.add(taskId);
    for (const taskId of result.archivedIds) merged.archivedIds.add(taskId);
    for (const taskId of result.deletedIds) merged.deletedIds.add(taskId);
    for (const [taskId, unreadAt] of result.unreadAtByTaskId) {
      merged.unreadAtByTaskId.set(taskId, unreadAt);
    }
    for (const [taskId, status] of result.terminalStatusByTaskId) {
      merged.terminalStatusByTaskId.set(taskId, status);
    }
    for (const [taskId, title] of result.titleOverrideByTaskId) {
      merged.titleOverrideByTaskId.set(taskId, title);
    }
    for (const [taskId, automationId] of result.cronAutomationIdByTaskId) {
      merged.cronAutomationIdByTaskId.set(taskId, automationId);
    }
  }
  merged.taskIndexItems = [...taskIndexItemByEntityKey.values()];
  return merged;
}
