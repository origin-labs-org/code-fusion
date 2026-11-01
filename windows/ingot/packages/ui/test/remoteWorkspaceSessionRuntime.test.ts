import { describe, expect, it, vi } from "vitest";
import type { CfTaskMeta } from "@origin-ai/cf-shared";
import {
  DEFAULT_TASK_RUNTIME_STATE,
  getDefaultWorkspaceState,
} from "@/store/cfSessionStore.js";
import { markRemoteWorkspaceRunningTasksFailed } from "@/lib/remoteWorkspaceSessionRuntime.js";

function createTask(taskId: string, status: CfTaskMeta["status"]): CfTaskMeta {
  return {
    taskId,
    traceId: `trace-${taskId}`,
    title: taskId,
    workspacePath: "/workspace/demo",
    workspaceIdentity: "ssh://root@example.com/workspace/demo",
    createdAt: 1,
    updatedAt: 2,
    mode: "default",
    status,
  };
}

describe("markRemoteWorkspaceRunningTasksFailed", () => {
  it("Upon remote disconnection, running and persisted running tasks should be finalized as failed", () => {
    const workspaceState = {
      ...getDefaultWorkspaceState(),
      activeTaskId: "active-task",
      taskRuntimeByTaskId: {
        "active-task": {
          ...DEFAULT_TASK_RUNTIME_STATE,
          status: "streaming" as const,
        },
        "restoring-task": {
          ...DEFAULT_TASK_RUNTIME_STATE,
          status: "restoring" as const,
        },
        "ready-task": {
          ...DEFAULT_TASK_RUNTIME_STATE,
          status: "ready" as const,
        },
      },
      taskListCache: [
        createTask("persisted-running-task", "running"),
        createTask("persisted-completed-task", "completed"),
      ],
      optimisticTaskListByTaskId: {
        "optimistic-running-task": createTask("optimistic-running-task", "running"),
        "active-task": createTask("active-task", "running"),
      },
    };
    const setTaskRuntimeState = vi.fn();

    const count = markRemoteWorkspaceRunningTasksFailed({
      tabs: [
        {
          workspacePath: "/workspace/demo",
          workspaceIdentity: "ssh://root@example.com/workspace/demo",
        },
      ],
      getWorkspaceState: () => workspaceState,
      setTaskRuntimeState,
      reason: "远程连接已断开",
    });

    expect(count).toBe(4);
    expect(setTaskRuntimeState.mock.calls).toEqual([
      [
        "/workspace/demo",
        "active-task",
        "failed",
        "远程连接已断开",
        "ssh://root@example.com/workspace/demo",
      ],
      [
        "/workspace/demo",
        "restoring-task",
        "failed",
        "远程连接已断开",
        "ssh://root@example.com/workspace/demo",
      ],
      [
        "/workspace/demo",
        "persisted-running-task",
        "failed",
        "远程连接已断开",
        "ssh://root@example.com/workspace/demo",
      ],
      [
        "/workspace/demo",
        "optimistic-running-task",
        "failed",
        "远程连接已断开",
        "ssh://root@example.com/workspace/demo",
      ],
    ]);
  });

  it("Should not overwrite tasks that are already finalized or ready when remote disconnects", () => {
    const workspaceState = {
      ...getDefaultWorkspaceState(),
      activeTaskId: "ready-task",
      taskRuntimeByTaskId: {
        "ready-task": {
          ...DEFAULT_TASK_RUNTIME_STATE,
          status: "ready" as const,
        },
      },
      taskListCache: [createTask("completed-task", "completed")],
      optimisticTaskListByTaskId: {
        "error-task": createTask("error-task", "error"),
      },
    };
    const setTaskRuntimeState = vi.fn();

    const count = markRemoteWorkspaceRunningTasksFailed({
      tabs: [
        {
          workspacePath: "/workspace/demo",
          workspaceIdentity: "ssh://root@example.com/workspace/demo",
        },
      ],
      getWorkspaceState: () => workspaceState,
      setTaskRuntimeState,
      reason: "远程连接已断开",
    });

    expect(count).toBe(0);
    expect(setTaskRuntimeState).not.toHaveBeenCalled();
  });

  it("Local finalized runtime should not be overwritten by lagged running task meta when remote disconnects", () => {
    const workspaceState = {
      ...getDefaultWorkspaceState(),
      taskRuntimeByTaskId: {
        "completed-task": {
          ...DEFAULT_TASK_RUNTIME_STATE,
          status: "completed" as const,
        },
        "failed-task": {
          ...DEFAULT_TASK_RUNTIME_STATE,
          status: "failed" as const,
        },
      },
      taskListCache: [
        createTask("completed-task", "running"),
        createTask("failed-task", "running"),
      ],
      optimisticTaskListByTaskId: {},
    };
    const setTaskRuntimeState = vi.fn();

    const count = markRemoteWorkspaceRunningTasksFailed({
      tabs: [
        {
          workspacePath: "/workspace/demo",
          workspaceIdentity: "ssh://root@example.com/workspace/demo",
        },
      ],
      getWorkspaceState: () => workspaceState,
      setTaskRuntimeState,
      reason: "远程连接已断开",
    });

    expect(count).toBe(0);
    expect(setTaskRuntimeState).not.toHaveBeenCalled();
  });
});
