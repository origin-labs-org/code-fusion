import { describe, expect, it } from "vitest";
import type { CfTaskMeta } from "@origin-ai/cf-shared";
import { getTaskMeta, getTaskUnreadIndicator } from "@/store/cfSessionStore.js";
import { getDefaultWorkspaceState } from "@/store/cfSessionStoreTypes.js";

function createTaskMeta(overrides: Partial<CfTaskMeta> = {}): CfTaskMeta {
  return {
    taskId: "task-unread",
    traceId: "trace-unread",
    title: "Unread task",
    workspacePath: "/repo/workspace",
    createdAt: 1,
    updatedAt: 1,
    mode: "default",
    provider: "codex",
    ...overrides,
  };
}

describe("task unread source of truth", () => {
  it("Fall back to reading list task unreadAt when store is not yet hydrated after restart", () => {
    const workspaceState = getDefaultWorkspaceState();
    const persistedTask = createTaskMeta({ unreadAt: 100 });

    expect(getTaskUnreadIndicator(workspaceState, persistedTask.taskId, persistedTask)).toBe(true);
  });

  it("Do not let stale list unreadAt overwrite read status when optimistic task already exists", () => {
    const persistedTask = createTaskMeta({ unreadAt: 100 });
    const workspaceState = {
      ...getDefaultWorkspaceState(),
      optimisticTaskListByTaskId: {
        [persistedTask.taskId]: createTaskMeta({ unreadAt: undefined }),
      },
    };

    expect(getTaskUnreadIndicator(workspaceState, persistedTask.taskId, persistedTask)).toBe(false);
  });

  it("Prioritize reading unreadAt from optimistic task meta", () => {
    const workspaceState = {
      ...getDefaultWorkspaceState(),
      taskListCache: [
        createTaskMeta({
          taskId: "task-1",
          unreadAt: 100,
        }),
      ],
      optimisticTaskListByTaskId: {
        "task-1": createTaskMeta({
          taskId: "task-1",
          unreadAt: undefined,
        }),
      },
      taskUnreadByTaskId: {},
    };

    expect(getTaskMeta(workspaceState, "task-1")?.unreadAt).toBeUndefined();
    expect(getTaskUnreadIndicator(workspaceState, "task-1")).toBe(false);
  });
});
