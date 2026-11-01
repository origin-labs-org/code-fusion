import { Emitter } from "@origin-ai/cf-rpc";
import type {
  IWindowControllerService,
  WindowHostControllerFrame,
  WindowHostControllerTaskListResult,
} from "@origin-ai/cf-services";
import {
  CONTROLLER_TASKS_INDEX_TOPIC,
  CONTROLLER_WORKSPACES_TOPIC,
  type WindowHostControllerTaskRow,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { describe, expect, it, vi } from "vitest";
import { getWindowControllerTaskListRegistry } from "@/v4/windowControllerTaskListRegistry.js";

function taskRow(
  params: {
    pinned?: boolean;
    archived?: boolean;
    liveStatus?: WindowHostControllerTaskRow["liveStatus"];
  } = {},
): WindowHostControllerTaskRow {
  return {
    address: { taskId: "task-1", workspacePath: "/work/demo" },
    meta: {
      taskId: "task-1",
      traceId: "trace-task-1",
      title: "task-1",
      workspacePath: "/work/demo",
      createdAt: 1,
      updatedAt: 1,
      mode: "default",
    },
    membership: {
      pinned: params.pinned ?? false,
      archived: params.archived ?? false,
      active: !(params.archived ?? false),
    },
    sourceAvailability: "online",
    liveStatus: params.liveStatus ?? "idle",
  };
}

describe("windowControllerTaskListRegistry", () => {
  it("所有list消费者Shared两条 Controller 订阅，并按 revision/query single-flight", async () => {
    const frames = new Emitter<WindowHostControllerFrame>();
    const unsubscribeControllerV4 = vi.fn(async () => undefined);
    const listResult: WindowHostControllerTaskListResult = {
      items: [],
      total: 0,
      hasMore: false,
    };
    const listTaskList = vi.fn(async () => listResult);
    let subscriptionSerial = 0;
    const controller = {
      listTaskList,
      onDynamicControllerFrame: vi.fn(() => frames.event),
      subscribeControllerV4: vi.fn(async ({ topic }: { topic: string }) => ({
        ack: {
          subscriptionId: `${topic}-${++subscriptionSerial}`,
          mode: "snapshot" as const,
          logEpoch: "epoch-1",
        },
      })),
      unsubscribeControllerV4,
      resyncControllerV4: vi.fn(),
    } as unknown as IWindowControllerService;
    const registry = getWindowControllerTaskListRegistry(controller);
    expect(getWindowControllerTaskListRegistry(controller)).toBe(registry);
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const disposeA = registry.subscribe(listenerA);
    const disposeB = registry.subscribe(listenerB);
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.onDynamicControllerFrame).toHaveBeenCalledTimes(1);
    expect(controller.subscribeControllerV4).toHaveBeenCalledTimes(2);

    frames.fire({
      topic: CONTROLLER_TASKS_INDEX_TOPIC,
      subscriptionId: "controller/tasks-index-2",
      logEpoch: "epoch-1",
      fromSeq: 0,
      toSeq: 0,
      sentAt: 1,
      payload: {
        kind: "snapshot",
        snapshot: { protocolVersion: 1, logEpoch: "epoch-1", tasks: [] },
      },
    });
    frames.fire({
      topic: CONTROLLER_TASKS_INDEX_TOPIC,
      subscriptionId: "controller/tasks-index-2",
      logEpoch: "epoch-1",
      fromSeq: 0,
      toSeq: 1,
      sentAt: 2,
      payload: { kind: "deltas", deltas: [] },
    });
    await Promise.resolve();
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);

    const query = {
      kind: "active" as const,
      workspaceScopes: [{ workspacePath: "/work/demo" }],
      sortBy: "updated" as const,
    };
    const revision = registry.getRevision();
    const [first, second] = await Promise.all([
      registry.list(
        "active:/work/demo",
        { controllerRevision: revision, taskListVersionSignature: "1" },
        query,
      ),
      registry.list(
        "active:/work/demo",
        { controllerRevision: revision, taskListVersionSignature: "1" },
        query,
      ),
    ]);
    expect(first).toBe(listResult);
    expect(second).toBe(listResult);
    expect(listTaskList).toHaveBeenCalledTimes(1);
    await registry.list(
      "active:/work/demo",
      { controllerRevision: revision, taskListVersionSignature: "1" },
      query,
    );
    expect(listTaskList).toHaveBeenCalledTimes(1);
    await registry.list(
      "active:/work/demo",
      { controllerRevision: revision, taskListVersionSignature: "2" },
      query,
    );
    expect(listTaskList).toHaveBeenCalledTimes(2);

    disposeA();
    expect(unsubscribeControllerV4).not.toHaveBeenCalled();
    disposeB();
    await Promise.resolve();
    expect(unsubscribeControllerV4).toHaveBeenCalledTimes(2);
  });

  it("只Invalid task delta 的 scope 与Changes前后 membership Hit的Query", async () => {
    const frames = new Emitter<WindowHostControllerFrame>();
    const listTaskList = vi.fn(
      async (): Promise<WindowHostControllerTaskListResult> => ({
        items: [],
        total: 0,
        hasMore: false,
      }),
    );
    let subscriptionSerial = 0;
    const controller = {
      listTaskList,
      onDynamicControllerFrame: vi.fn(() => frames.event),
      subscribeControllerV4: vi.fn(async ({ topic }: { topic: string }) => ({
        ack: {
          subscriptionId: `${topic}-${++subscriptionSerial}`,
          mode: "snapshot" as const,
          logEpoch: "epoch-1",
        },
      })),
      unsubscribeControllerV4: vi.fn(async () => undefined),
      resyncControllerV4: vi.fn(),
    } as unknown as IWindowControllerService;
    const registry = getWindowControllerTaskListRegistry(controller);
    const dispose = registry.subscribe(vi.fn());
    await Promise.resolve();
    await Promise.resolve();

    const timelineQuery = {
      kind: "timeline" as const,
      workspaceScopes: [{ workspacePath: "/work/demo" }],
      sortBy: "updated" as const,
    };
    const pinnedQuery = { ...timelineQuery, kind: "pinned" as const };
    const archivedQuery = { ...timelineQuery, kind: "archived" as const };

    const beforeSnapshotRevision = registry.getRevision();
    await registry.list(
      "timeline:/work/demo",
      { controllerRevision: beforeSnapshotRevision, taskListVersionSignature: "1" },
      timelineQuery,
    );
    await registry.list(
      "pinned:/work/demo",
      { controllerRevision: beforeSnapshotRevision, taskListVersionSignature: "1" },
      pinnedQuery,
    );
    await registry.list(
      "archived:/work/demo",
      { controllerRevision: beforeSnapshotRevision, taskListVersionSignature: "1" },
      archivedQuery,
    );
    listTaskList.mockClear();
    frames.fire({
      topic: CONTROLLER_TASKS_INDEX_TOPIC,
      subscriptionId: "controller/tasks-index-2",
      logEpoch: "epoch-1",
      fromSeq: 0,
      toSeq: 1,
      sentAt: 0,
      payload: {
        kind: "deltas",
        deltas: [{ op: "task.upserted", task: taskRow({ pinned: true }) }],
      },
    });
    await Promise.resolve();
    const unknownPreviousRevision = registry.getRevision();
    await registry.list(
      "timeline:/work/demo",
      { controllerRevision: unknownPreviousRevision, taskListVersionSignature: "1" },
      timelineQuery,
    );
    await registry.list(
      "pinned:/work/demo",
      { controllerRevision: unknownPreviousRevision, taskListVersionSignature: "1" },
      pinnedQuery,
    );
    await registry.list(
      "archived:/work/demo",
      { controllerRevision: unknownPreviousRevision, taskListVersionSignature: "1" },
      archivedQuery,
    );
    expect(listTaskList).toHaveBeenCalledTimes(3);
    listTaskList.mockClear();

    frames.fire({
      topic: CONTROLLER_TASKS_INDEX_TOPIC,
      subscriptionId: "controller/tasks-index-2",
      logEpoch: "epoch-1",
      fromSeq: 0,
      toSeq: 0,
      sentAt: 1,
      payload: {
        kind: "snapshot",
        snapshot: { protocolVersion: 1, logEpoch: "epoch-1", tasks: [taskRow()] },
      },
    });
    await Promise.resolve();

    const initialRevision = registry.getRevision();
    await registry.list(
      "timeline:/work/demo",
      { controllerRevision: initialRevision, taskListVersionSignature: "1" },
      timelineQuery,
    );
    await registry.list(
      "pinned:/work/demo",
      { controllerRevision: initialRevision, taskListVersionSignature: "1" },
      pinnedQuery,
    );
    await registry.list(
      "archived:/work/demo",
      { controllerRevision: initialRevision, taskListVersionSignature: "1" },
      archivedQuery,
    );
    listTaskList.mockClear();

    frames.fire({
      topic: CONTROLLER_TASKS_INDEX_TOPIC,
      subscriptionId: "controller/tasks-index-2",
      logEpoch: "epoch-1",
      fromSeq: 0,
      toSeq: 1,
      sentAt: 2,
      payload: {
        kind: "deltas",
        deltas: [{ op: "task.upserted", task: taskRow({ liveStatus: "running" }) }],
      },
    });
    await Promise.resolve();

    const nextRevision = registry.getRevision();
    await registry.list(
      "timeline:/work/demo",
      { controllerRevision: nextRevision, taskListVersionSignature: "1" },
      timelineQuery,
    );
    await registry.list(
      "pinned:/work/demo",
      { controllerRevision: nextRevision, taskListVersionSignature: "1" },
      pinnedQuery,
    );
    await registry.list(
      "archived:/work/demo",
      { controllerRevision: nextRevision, taskListVersionSignature: "1" },
      archivedQuery,
    );

    expect(listTaskList).toHaveBeenCalledTimes(1);
    expect(listTaskList).toHaveBeenCalledWith(timelineQuery);

    listTaskList.mockClear();
    frames.fire({
      topic: CONTROLLER_TASKS_INDEX_TOPIC,
      subscriptionId: "controller/tasks-index-2",
      logEpoch: "epoch-1",
      fromSeq: 1,
      toSeq: 2,
      sentAt: 3,
      payload: {
        kind: "deltas",
        deltas: [{ op: "task.upserted", task: taskRow({ pinned: true, liveStatus: "running" }) }],
      },
    });
    await Promise.resolve();
    const pinnedRevision = registry.getRevision();
    await registry.list(
      "timeline:/work/demo",
      { controllerRevision: pinnedRevision, taskListVersionSignature: "1" },
      timelineQuery,
    );
    await registry.list(
      "pinned:/work/demo",
      { controllerRevision: pinnedRevision, taskListVersionSignature: "1" },
      pinnedQuery,
    );
    await registry.list(
      "archived:/work/demo",
      { controllerRevision: pinnedRevision, taskListVersionSignature: "1" },
      archivedQuery,
    );
    expect(listTaskList).toHaveBeenCalledTimes(2);
    expect(listTaskList).toHaveBeenCalledWith(timelineQuery);
    expect(listTaskList).toHaveBeenCalledWith(pinnedQuery);

    listTaskList.mockClear();
    frames.fire({
      topic: CONTROLLER_WORKSPACES_TOPIC,
      subscriptionId: "controller/workspaces-1",
      logEpoch: "epoch-1",
      fromSeq: 0,
      toSeq: 0,
      sentAt: 4,
      payload: {
        kind: "snapshot",
        snapshot: {
          protocolVersion: 1,
          logEpoch: "epoch-1",
          workspaces: [
            {
              workspacePath: "/work/demo",
              sourceAvailability: "online",
              connectionState: "online",
            },
          ],
        },
      },
    });
    await Promise.resolve();
    expect(registry.getRevision()).toBe(pinnedRevision + 1);
    expect(registry.getSourceRevision()).toBe(2);
    await registry.list(
      "timeline:/work/demo",
      { controllerRevision: pinnedRevision, taskListVersionSignature: "1" },
      timelineQuery,
    );
    await registry.list(
      "pinned:/work/demo",
      { controllerRevision: pinnedRevision, taskListVersionSignature: "1" },
      pinnedQuery,
    );
    await registry.list(
      "archived:/work/demo",
      { controllerRevision: pinnedRevision, taskListVersionSignature: "1" },
      archivedQuery,
    );
    expect(listTaskList).not.toHaveBeenCalled();
    dispose();
  });
});

it("ProjectEventsRead复用 Controller 快照，过滤OfflineSource且不OutputTask事实", async () => {
  const frames = new Emitter<WindowHostControllerFrame>();
  const controller = {
    onDynamicControllerFrame: () => frames.event,
    subscribeControllerV4: async ({ topic }: { topic: string }) => ({
      ack: { subscriptionId: topic, mode: "snapshot", logEpoch: "e" },
    }),
    unsubscribeControllerV4: async () => undefined,
  } as unknown as IWindowControllerService;
  const registry = getWindowControllerTaskListRegistry(controller);
  const stop = registry.subscribe(() => {});
  const live = {
    ...taskRow(),
    activity: { phase: "running" as const, lastActivityAt: 12, hasBackgroundWork: false },
  };
  const offline = {
    ...live,
    address: {
      taskId: "task-1",
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:server:other:/work/demo",
    },
    sourceAvailability: "offline" as const,
  };
  frames.fire({
    topic: CONTROLLER_TASKS_INDEX_TOPIC,
    subscriptionId: CONTROLLER_TASKS_INDEX_TOPIC,
    logEpoch: "e",
    fromSeq: 0,
    toSeq: 0,
    sentAt: 1,
    payload: {
      kind: "snapshot",
      snapshot: { protocolVersion: 1, logEpoch: "e", tasks: [live, offline] },
    },
  });
  expect(registry.readActivities()).toEqual([{ address: live.address, activity: live.activity }]);
  stop();
  expect(registry.readActivities()).toEqual([]);
});
