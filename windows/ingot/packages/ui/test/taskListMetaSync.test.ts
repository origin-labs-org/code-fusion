import { beforeEach, describe, expect, it } from "vitest";
import type { CfTaskMeta } from "@origin-ai/cf-shared";
import { insertTaskIntoTaskCaches, syncTaskMetaToTaskCaches } from "@/lib/taskListMetaSync.js";
import { buildTaskListCacheDescriptor, buildTaskWorkspaceKey } from "@/lib/taskQueryCache.js";
import { getTaskMeta, useCfSessionStore } from "@/store/cfSessionStore.js";
import {
  upsertTaskQueryCacheTaskMeta,
  useTaskQueryCacheStore,
} from "@/store/taskQueryCacheStore.js";

const WORKSPACE_PATH = "/repo/goal-clear-cache";
const TASK_ID = "task-goal-clear-cache";

function createTaskMeta(overrides: Partial<CfTaskMeta> = {}): CfTaskMeta {
  return {
    createdAt: 1,
    mode: "default",
    provider: "glm",
    taskId: TASK_ID,
    title: "目标清理任务",
    traceId: "trace-goal-clear-cache",
    updatedAt: 1,
    workspacePath: WORKSPACE_PATH,
    ...overrides,
  };
}

beforeEach(() => {
  useCfSessionStore.setState((state) => ({
    ...state,
    workspaces: {},
  }));
  useTaskQueryCacheStore.getState().clearAll();
});

describe("syncTaskMetaToTaskCaches", () => {
  it("Increment collapsed workspace list total as a new member even when initial optimistic meta exists", () => {
    const existingTasks = Array.from({ length: 5 }, (_, index) =>
      createTaskMeta({
        taskId: `existing-${index}`,
        title: `已有Task ${index}`,
        updatedAt: 50 - index,
      }),
    );
    const firstSendTask = createTaskMeta({
      taskId: TASK_ID,
      title: "第六个首发任务",
      updatedAt: 100,
    });
    const descriptor = buildTaskListCacheDescriptor({
      kind: "workspace",
      workspaceScopes: [{ workspacePath: WORKSPACE_PATH }],
      sortBy: "updated",
      expanded: false,
      visibleLimit: 5,
    });
    const queryKey = "collapsed-workspace-query";
    const store = useCfSessionStore.getState();
    store.setTaskListCache(WORKSPACE_PATH, existingTasks);
    for (const task of existingTasks) {
      store.upsertOptimisticTaskListItem(WORKSPACE_PATH, task);
    }
    useTaskQueryCacheStore.getState().setQueryResult({
      queryKey,
      descriptor,
      items: existingTasks,
      total: 5,
      hasMore: false,
    });

    store.upsertOptimisticTaskListItem(WORKSPACE_PATH, firstSendTask);
    insertTaskIntoTaskCaches({
      workspacePath: WORKSPACE_PATH,
      task: firstSendTask,
      membership: { pinned: false, archived: false },
    });

    const cacheState = useTaskQueryCacheStore.getState();
    const result = cacheState.resultsByQueryKey[queryKey];
    const taskIds = result?.taskKeys.map(
      (taskKey) => cacheState.taskMetaByEntityKey[taskKey]?.taskId,
    );

    expect(taskIds).toEqual([TASK_ID, "existing-0", "existing-1", "existing-2", "existing-3"]);
    expect(result?.total).toBe(6);
    expect(result?.hasMore).toBe(true);
    expect(result?.stale).toBe(true);
  });

  it("Does not let stale snapshots overwrite updatedAt and title of initial optimistic tasks", () => {
    const optimisticTask = createTaskMeta({
      title: "Initial issue title",
      updatedAt: 100,
    });
    const staleSnapshotTask = createTaskMeta({
      title: "New session",
      updatedAt: 10,
    });
    const store = useCfSessionStore.getState();
    store.setTaskListCache(WORKSPACE_PATH, [optimisticTask]);
    store.upsertOptimisticTaskListItem(WORKSPACE_PATH, optimisticTask);
    upsertTaskQueryCacheTaskMeta(optimisticTask);

    syncTaskMetaToTaskCaches({
      workspacePath: WORKSPACE_PATH,
      task: staleSnapshotTask,
      membership: { pinned: false, archived: false },
    });

    const workspaceState = useCfSessionStore.getState().getWorkspaceState(WORKSPACE_PATH);
    const entityKey = `${buildTaskWorkspaceKey(WORKSPACE_PATH)}::${TASK_ID}`;

    expect(getTaskMeta(workspaceState, TASK_ID)?.title).toBe("Initial issue title");
    expect(getTaskMeta(workspaceState, TASK_ID)?.updatedAt).toBe(100);
    expect(workspaceState.taskListCache?.[0]?.title).toBe("Initial issue title");
    expect(useTaskQueryCacheStore.getState().taskMetaByEntityKey[entityKey]?.updatedAt).toBe(100);
  });

  it("Does not let raw snapshots overwrite manual titles in query cache even when workspace cache is empty", () => {
    const indexedRenamedTask = createTaskMeta({
      title: "airline-1",
      titleOverridden: true,
      updatedAt: 20,
    });
    const rawSnapshotTask = createTaskMeta({
      title: "Analyze airline import flow",
      status: "running",
      updatedAt: 30,
    });
    const entityKey = `${buildTaskWorkspaceKey(WORKSPACE_PATH)}::${TASK_ID}`;

    upsertTaskQueryCacheTaskMeta(indexedRenamedTask);

    syncTaskMetaToTaskCaches({
      workspacePath: WORKSPACE_PATH,
      task: rawSnapshotTask,
    });

    const workspaceState = useCfSessionStore.getState().getWorkspaceState(WORKSPACE_PATH);
    const workspaceTask = getTaskMeta(workspaceState, TASK_ID);
    const queryTask = useTaskQueryCacheStore.getState().taskMetaByEntityKey[entityKey];

    expect(workspaceTask?.title).toBe("airline-1");
    expect(workspaceTask?.titleOverridden).toBe(true);
    expect(workspaceTask?.status).toBe("running");
    expect(workspaceTask?.updatedAt).toBe(30);
    expect(queryTask?.title).toBe("airline-1");
    expect(queryTask?.titleOverridden).toBe(true);
    expect(queryTask?.status).toBe("running");
  });
});
