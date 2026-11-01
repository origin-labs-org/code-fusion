import { describe, expect, it, vi } from "vitest";
import type { CfTaskMeta } from "@origin-ai/cf-shared";
import {
  CONTROLLER_TASKS_INDEX_TOPIC,
  CONTROLLER_WORKSPACES_TOPIC,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { createWindowHostControllerProjection } from "../src/host/windowHostControllerProjection.js";

function taskMeta(params: {
  taskId: string;
  workspacePath?: string;
  workspaceIdentity?: string;
  title?: string;
  updatedAt?: number;
}): CfTaskMeta {
  return {
    taskId: params.taskId,
    traceId: `trace-${params.taskId}`,
    title: params.title ?? params.taskId,
    workspacePath: params.workspacePath ?? "/work/demo",
    ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
    createdAt: 1,
    updatedAt: params.updatedAt ?? 2,
    mode: "default",
  };
}

const localScope = {
  kind: "local" as const,
  workspacePath: "/work/demo",
};

const remoteScope = {
  kind: "remote" as const,
  remoteSessionId: "remote-session-1",
  workspacePath: "/work/demo",
  workspaceIdentity: "remote:ssh:dev:/work/demo",
};

describe("WindowHostControllerProjection", () => {
  it("task-index is the left table for membership; sessions-index can only overlay live facts of existing tasks", () => {
    const projection = createWindowHostControllerProjection({ createId: () => "id-1" });
    projection.registerSource({ scope: localScope, mutate: vi.fn() });

    projection.replaceSourceSnapshot({
      scope: localScope,
      taskIndex: [
        {
          meta: taskMeta({ taskId: "task-indexed" }),
          membership: { pinned: false, archived: false, active: true },
        },
      ],
      sessionsIndex: [
        { taskId: "task-indexed", liveStatus: "waiting" },
        { taskId: "session-only", liveStatus: "running" },
      ],
    });

    expect(projection.getTasks()).toEqual([
      expect.objectContaining({
        address: expect.objectContaining({ taskId: "task-indexed" }),
        liveStatus: "waiting",
      }),
    ]);
  });

  it("Do not treat persisted running/blocked residue as current runtime facts when there is no live overlay", () => {
    const projection = createWindowHostControllerProjection({ createId: () => "id-1" });
    projection.registerSource({ scope: localScope, mutate: vi.fn() });
    projection.replaceSourceSnapshot({
      scope: localScope,
      taskIndex: [
        {
          meta: {
            ...taskMeta({ taskId: "waiting-task" }),
            status: "running",
            pendingInteraction: { interactionId: "ask-1", kind: "userInput" },
          },
          membership: { pinned: false, archived: false, active: true },
        },
      ],
      sessionsIndex: [],
    });

    expect(projection.getTasks()[0]?.liveStatus).toBe("idle");
  });

  it("Runtime overlay can independently update activity/blocked interactions without writing live facts back to membership", () => {
    const projection = createWindowHostControllerProjection({ createId: () => "id-1" });
    const frames: unknown[] = [];
    projection.registerSource({ scope: localScope, mutate: vi.fn() });
    projection.replaceSourceSnapshot({
      scope: localScope,
      taskIndex: [
        {
          meta: taskMeta({ taskId: "live-task", title: "Persistent title", updatedAt: 2 }),
          membership: { pinned: false, archived: false, active: true },
        },
      ],
      sessionsIndex: [
        {
          taskId: "live-task",
          title: "Running title",
          updatedAt: 8,
          liveStatus: "waiting",
          pendingInteraction: {
            interactionId: "permission-1",
            kind: "permission",
            toolName: "Bash",
          },
          activity: {
            phase: "running",
            lastActivityAt: 8,
            hasBackgroundWork: true,
            pendingInteractions: { permissionCount: 1, userInputCount: 0 },
          },
        },
      ],
    });
    projection.subscribe({
      topic: CONTROLLER_TASKS_INDEX_TOPIC,
      onFrame: (frame) => frames.push(frame),
    });
    frames.length = 0;

    expect(projection.getTasks()[0]).toMatchObject({
      liveStatus: "waiting",
      activity: {
        phase: "running",
        lastActivityAt: 8,
        pendingInteractions: { permissionCount: 1, userInputCount: 0 },
      },
      meta: {
        title: "Running title",
        updatedAt: 8,
        pendingInteraction: { interactionId: "permission-1", kind: "permission" },
      },
    });

    projection.replaceSourceSessionOverlays(localScope, [
      {
        taskId: "live-task",
        title: "Completed title",
        updatedAt: 12,
        liveStatus: "completed",
        activity: {
          phase: "completedSuccess",
          lastActivityAt: 12,
          hasBackgroundWork: false,
        },
      },
    ]);

    expect(projection.getTasks()[0]).toMatchObject({
      liveStatus: "completed",
      activity: {
        phase: "completedSuccess",
        lastActivityAt: 12,
        hasBackgroundWork: false,
      },
      meta: { title: "Completed title", updatedAt: 12 },
    });
    expect(projection.getTasks()[0]?.meta.pendingInteraction).toBeUndefined();
    expect(frames).toHaveLength(1);
  });

  it("Tasks with local and remote identities on the same path do not run sequentially", () => {
    const projection = createWindowHostControllerProjection({ createId: () => "id-1" });
    projection.registerSource({ scope: localScope, mutate: vi.fn() });
    projection.registerSource({ scope: remoteScope, mutate: vi.fn() });
    projection.replaceSourceSnapshot({
      scope: localScope,
      taskIndex: [
        {
          meta: taskMeta({ taskId: "same-task" }),
          membership: { pinned: false, archived: false, active: true },
        },
      ],
      sessionsIndex: [],
    });
    projection.replaceSourceSnapshot({
      scope: remoteScope,
      taskIndex: [
        {
          meta: taskMeta({
            taskId: "same-task",
            workspaceIdentity: remoteScope.workspaceIdentity,
          }),
          membership: { pinned: true, archived: false, active: true },
        },
      ],
      sessionsIndex: [{ taskId: "same-task", liveStatus: "running" }],
    });

    expect(projection.getTasks()).toHaveLength(2);
    expect(
      projection.getTasks().find((task) => task.address.remoteSessionId)?.membership.pinned,
    ).toBe(true);
    expect(projection.getTasks().find((task) => !task.address.remoteSessionId)?.liveStatus).toBe(
      "idle",
    );
  });

  it("Disconnect preserves last trusted rows and marks them offline; all mutations fail-closed", async () => {
    const localMutate = vi.fn();
    const remoteMutate = vi.fn();
    const projection = createWindowHostControllerProjection({ createId: () => "id-1" });
    projection.registerSource({ scope: localScope, mutate: localMutate });
    projection.registerSource({ scope: remoteScope, mutate: remoteMutate });
    projection.replaceSourceSnapshot({
      scope: remoteScope,
      taskIndex: [
        {
          meta: taskMeta({
            taskId: "remote-task",
            workspaceIdentity: remoteScope.workspaceIdentity,
          }),
          membership: { pinned: false, archived: false, active: true },
        },
      ],
      sessionsIndex: [{ taskId: "remote-task", liveStatus: "running" }],
    });

    projection.disconnectSource(remoteScope);
    const row = projection.getTasks()[0]!;

    expect(row).toMatchObject({ sourceAvailability: "offline", liveStatus: "running" });
    await expect(projection.mutate(row.address, { kind: "pin", pinned: true })).rejects.toThrow(
      "远程 source 当前离线",
    );
    expect(remoteMutate).not.toHaveBeenCalled();
    expect(localMutate).not.toHaveBeenCalled();
  });

  it("重连 snapshot 原子替换离线投影，不混入旧 task", () => {
    const projection = createWindowHostControllerProjection({ createId: () => "id-1" });
    projection.registerSource({ scope: remoteScope, mutate: vi.fn() });
    projection.replaceSourceSnapshot({
      scope: remoteScope,
      taskIndex: [
        {
          meta: taskMeta({ taskId: "old-task", workspaceIdentity: remoteScope.workspaceIdentity }),
          membership: { pinned: false, archived: false, active: true },
        },
      ],
      sessionsIndex: [],
    });
    projection.disconnectSource(remoteScope);

    projection.replaceSourceSnapshot({
      scope: remoteScope,
      taskIndex: [
        {
          meta: taskMeta({ taskId: "new-task", workspaceIdentity: remoteScope.workspaceIdentity }),
          membership: { pinned: false, archived: false, active: true },
        },
      ],
      sessionsIndex: [],
    });

    expect(projection.getTasks().map((task) => task.address.taskId)).toEqual(["new-task"]);
    expect(projection.getTasks()[0]?.sourceAvailability).toBe("online");
  });

  it("Remove old address and write new snapshot in the same delta frame upon remoteSessionId rollover", () => {
    const projection = createWindowHostControllerProjection({ createId: () => "id-1" });
    const nextScope = { ...remoteScope, remoteSessionId: "remote-session-2" };
    const frames: Array<{ payload: { kind: string; deltas?: Array<{ op: string }> } }> = [];
    projection.registerSource({ scope: remoteScope, mutate: vi.fn() });
    projection.replaceSourceSnapshot({
      scope: remoteScope,
      taskIndex: [
        {
          meta: taskMeta({ taskId: "old-task", workspaceIdentity: remoteScope.workspaceIdentity }),
          membership: { pinned: false, archived: false, active: true },
        },
      ],
      sessionsIndex: [],
    });
    projection.disconnectSource(remoteScope);
    projection.registerSource({ scope: nextScope, mutate: vi.fn() });
    projection.subscribe({
      topic: CONTROLLER_TASKS_INDEX_TOPIC,
      onFrame: (frame) => frames.push(frame as (typeof frames)[number]),
    });
    frames.length = 0;

    projection.replaceSourceSnapshot({
      scope: nextScope,
      replacesScope: remoteScope,
      taskIndex: [
        {
          meta: taskMeta({ taskId: "new-task", workspaceIdentity: remoteScope.workspaceIdentity }),
          membership: { pinned: false, archived: false, active: true },
        },
      ],
      sessionsIndex: [],
    });

    expect(frames).toHaveLength(1);
    expect(frames[0]?.payload.deltas?.map((delta) => delta.op)).toEqual([
      "task.removed",
      "task.upserted",
    ]);
    expect(projection.getTasks()).toEqual([
      expect.objectContaining({
        address: expect.objectContaining({
          remoteSessionId: "remote-session-2",
          taskId: "new-task",
        }),
      }),
    ]);
  });

  it("Closing remote scope cleans up only its in-memory projection, preserving local rows", () => {
    const projection = createWindowHostControllerProjection({ createId: () => "id-1" });
    projection.registerSource({ scope: localScope, mutate: vi.fn() });
    projection.registerSource({ scope: remoteScope, mutate: vi.fn() });
    projection.replaceSourceSnapshot({
      scope: localScope,
      taskIndex: [
        {
          meta: taskMeta({ taskId: "local-task" }),
          membership: { pinned: false, archived: false, active: true },
        },
      ],
      sessionsIndex: [],
    });
    projection.replaceSourceSnapshot({
      scope: remoteScope,
      taskIndex: [
        {
          meta: taskMeta({
            taskId: "remote-task",
            workspaceIdentity: remoteScope.workspaceIdentity,
          }),
          membership: { pinned: false, archived: false, active: true },
        },
      ],
      sessionsIndex: [],
    });

    projection.removeSource(remoteScope);
    expect(projection.getTasks().map((task) => task.address.taskId)).toEqual(["local-task"]);
  });

  it("List mutations route to unique source by full address; identity mismatch does not fall back", async () => {
    const localMutate = vi.fn(async () => undefined);
    const remoteMutate = vi.fn(async () => undefined);
    const projection = createWindowHostControllerProjection({ createId: () => "id-1" });
    projection.registerSource({ scope: localScope, mutate: localMutate });
    projection.registerSource({ scope: remoteScope, mutate: remoteMutate });
    projection.replaceSourceSnapshot({
      scope: remoteScope,
      taskIndex: [
        {
          meta: taskMeta({
            taskId: "remote-task",
            workspaceIdentity: remoteScope.workspaceIdentity,
          }),
          membership: { pinned: false, archived: false, active: true },
        },
      ],
      sessionsIndex: [],
    });
    const address = projection.getTasks()[0]!.address;

    await projection.mutate(address, { kind: "archive", archived: true });
    expect(remoteMutate).toHaveBeenCalledWith(address, { kind: "archive", archived: true });
    expect(localMutate).not.toHaveBeenCalled();
    await expect(
      projection.mutate(
        { ...address, workspaceIdentity: "remote:ssh:wrong:/work/demo" },
        { kind: "archive", archived: true },
      ),
    ).rejects.toThrow("No source matching task address.");
    expect(localMutate).not.toHaveBeenCalled();
  });

  it("Both topics generate snapshot/delta seq + logEpoch; subscriptions are mutually independent", () => {
    let id = 0;
    const projection = createWindowHostControllerProjection({ createId: () => `id-${++id}` });
    const taskFrames: unknown[] = [];
    const workspaceFrames: unknown[] = [];
    const tasksSubscription = projection.subscribe({
      topic: CONTROLLER_TASKS_INDEX_TOPIC,
      onFrame: (frame) => taskFrames.push(frame),
    });
    projection.subscribe({
      topic: CONTROLLER_WORKSPACES_TOPIC,
      onFrame: (frame) => workspaceFrames.push(frame),
    });

    projection.registerSource({ scope: localScope, mutate: vi.fn() });
    projection.replaceSourceSnapshot({
      scope: localScope,
      taskIndex: [
        {
          meta: taskMeta({ taskId: "local-task" }),
          membership: { pinned: false, archived: false, active: true },
        },
      ],
      sessionsIndex: [],
    });

    expect(taskFrames).toEqual([
      expect.objectContaining({
        topic: CONTROLLER_TASKS_INDEX_TOPIC,
        fromSeq: 0,
        logEpoch: expect.any(String),
        payload: expect.objectContaining({ kind: "snapshot" }),
      }),
      expect.objectContaining({
        topic: CONTROLLER_TASKS_INDEX_TOPIC,
        fromSeq: 0,
        toSeq: 1,
        payload: expect.objectContaining({ kind: "deltas" }),
      }),
    ]);
    expect(workspaceFrames).toHaveLength(2);
    expect(tasksSubscription.ack.subscriptionId).not.toBe(
      (workspaceFrames[0] as { subscriptionId: string }).subscriptionId,
    );

    projection.replaceSourceSnapshot({
      scope: localScope,
      taskIndex: [
        {
          meta: taskMeta({ taskId: "local-task" }),
          membership: { pinned: false, archived: false, active: true },
        },
      ],
      sessionsIndex: [],
    });
    expect(taskFrames).toHaveLength(2);
    expect(workspaceFrames).toHaveLength(2);
  });
});
