import { describe, expect, it } from "vitest";
import type { CfTaskMeta } from "@origin-ai/cf-shared";
import { compareCfTaskListItems } from "@/lib/taskListOrdering.js";
import { attachTaskListRowActivity } from "@/v4/taskListRowActivity.js";

function task(id: string, overrides: Partial<CfTaskMeta> = {}): CfTaskMeta {
  return {
    taskId: id,
    traceId: `trace-${id}`,
    title: id,
    workspacePath: "/ws",
    createdAt: 0,
    updatedAt: 0,
    mode: "default",
    ...overrides,
  };
}

function liveTask(
  id: string,
  phase: "prewarming" | "running" | "completedSuccess",
  overrides: Partial<CfTaskMeta> = {},
): CfTaskMeta {
  const meta = task(id, overrides);
  return attachTaskListRowActivity(meta, {
    phase,
    lastActivityAt: meta.updatedAt,
    hasBackgroundWork: false,
  });
}

function sortedIds(tasks: CfTaskMeta[], sortBy: "created" | "updated"): string[] {
  return [...tasks]
    .sort((left, right) => compareCfTaskListItems(left, right, sortBy))
    .map((item) => item.taskId);
}

describe("taskListOrdering", () => {
  it("把 prewarming/running 放在非运行任务之前", () => {
    const tasks = [
      liveTask("completed-newest", "completedSuccess", {
        createdAt: 300,
        updatedAt: 1_000,
      }),
      liveTask("running", "running", { createdAt: 100, updatedAt: 1 }),
      liveTask("prewarming", "prewarming", { createdAt: 200, updatedAt: 2 }),
    ];

    expect(sortedIds(tasks, "updated")).toEqual(["prewarming", "running", "completed-newest"]);
    expect(sortedIds(tasks, "created")).toEqual(["prewarming", "running", "completed-newest"]);
  });

  it("Sort concurrent running tasks only by createdAt; fork position does not jitter when updatedAt alternates", () => {
    const before = [
      liveTask("parent", "running", { createdAt: 100, updatedAt: 900 }),
      liveTask("fork", "running", { createdAt: 200, updatedAt: 100 }),
    ];
    const after = [
      liveTask("parent", "running", { createdAt: 100, updatedAt: 100 }),
      liveTask("fork", "running", { createdAt: 200, updatedAt: 900 }),
    ];

    expect(sortedIds(before, "updated")).toEqual(["fork", "parent"]);
    expect(sortedIds(after, "updated")).toEqual(["fork", "parent"]);
  });

  it("Break ties with stable taskId when running createdAt matches, without reading updatedAt", () => {
    const before = [
      liveTask("task-a", "running", { createdAt: 100, updatedAt: 900 }),
      liveTask("task-b", "running", { createdAt: 100, updatedAt: 100 }),
    ];
    const after = [
      liveTask("task-a", "running", { createdAt: 100, updatedAt: 100 }),
      liveTask("task-b", "running", { createdAt: 100, updatedAt: 900 }),
    ];

    expect(sortedIds(before, "updated")).toEqual(["task-b", "task-a"]);
    expect(sortedIds(after, "updated")).toEqual(["task-b", "task-a"]);
  });

  it("Concluded sessions with background jobs (e.g. dwf run) enter the running layer, without reordering when updatedAt alternates", () => {
    const backgrounded = (id: string, createdAt: number, updatedAt: number) =>
      attachTaskListRowActivity(task(id, { createdAt, updatedAt }), {
        phase: "completedSuccess",
        lastActivityAt: updatedAt,
        hasBackgroundWork: true,
      });
    const before = [
      backgrounded("run-a", 100, 900),
      backgrounded("run-b", 200, 100),
      liveTask("idle-newest", "completedSuccess", { createdAt: 300, updatedAt: 5_000 }),
    ];
    const after = [
      backgrounded("run-a", 100, 100),
      backgrounded("run-b", 200, 900),
      liveTask("idle-newest", "completedSuccess", { createdAt: 300, updatedAt: 5_000 }),
    ];

    expect(sortedIds(before, "updated")).toEqual(["run-b", "run-a", "idle-newest"]);
    expect(sortedIds(after, "updated")).toEqual(["run-b", "run-a", "idle-newest"]);
    expect(sortedIds(after, "created")).toEqual(["run-b", "run-a", "idle-newest"]);
  });

  it("Sessions exit the running layer after background jobs finish, positioned by Updated preference", () => {
    const settled = attachTaskListRowActivity(task("settled", { createdAt: 100, updatedAt: 900 }), {
      phase: "completedSuccess",
      lastActivityAt: 900,
      hasBackgroundWork: false,
    });
    const running = liveTask("running", "running", { createdAt: 50, updatedAt: 1 });
    const older = liveTask("older", "completedSuccess", { createdAt: 300, updatedAt: 500 });

    expect(sortedIds([older, settled, running], "updated")).toEqual([
      "running",
      "settled",
      "older",
    ]);
  });

  it("Non-running tasks continue to respect Created/Updated preferences", () => {
    const tasks = [
      liveTask("newer-created", "completedSuccess", { createdAt: 20, updatedAt: 10 }),
      liveTask("newer-updated", "completedSuccess", { createdAt: 10, updatedAt: 20 }),
    ];

    expect(sortedIds(tasks, "created")).toEqual(["newer-created", "newer-updated"]);
    expect(sortedIds(tasks, "updated")).toEqual(["newer-updated", "newer-created"]);
  });

  it("不采信缺少 sessions-index activity 的历史 status=running", () => {
    const staleRunning = task("stale-running", {
      status: "running",
      createdAt: 10,
      updatedAt: 10,
    });
    const liveCompleted = liveTask("completed", "completedSuccess", {
      createdAt: 20,
      updatedAt: 20,
    });

    expect(sortedIds([staleRunning, liveCompleted], "updated")).toEqual([
      "completed",
      "stale-running",
    ]);
  });
});
