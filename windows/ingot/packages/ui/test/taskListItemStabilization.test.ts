import { describe, expect, it } from "vitest";
import type { CfTaskMeta } from "@origin-ai/cf-shared";
import {
  areTaskListItemsEquivalent,
  buildTaskListItemIdentityKey,
  stabilizeTaskListItems,
} from "@/v4/taskListItemStabilization.js";
import { attachTaskListRowActivity } from "@/v4/taskListRowActivity.js";

function createTask(overrides: Partial<CfTaskMeta> = {}): CfTaskMeta {
  return {
    taskId: "task-1",
    workspacePath: "/repo",
    title: "Check today\'s weather in Nanjing",
    status: "running",
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  } as CfTaskMeta;
}

describe("stabilizeTaskListItems", () => {
  it("Consecutive empty snapshots reuse array; still updates on first task added and last task removed", () => {
    const empty: CfTaskMeta[] = [];
    expect(stabilizeTaskListItems(empty, [])).toBe(empty);
    const populated = [createTask()];
    expect(stabilizeTaskListItems(empty, populated)).toBe(populated);
    const removed = stabilizeTaskListItems(populated, []);
    expect(removed).toEqual([]);
    expect(stabilizeTaskListItems(removed, [])).toBe(removed);
  });
  it("Reuses entire old array and old element references during equivalent rebuild", () => {
    const previous = [createTask(), createTask({ taskId: "task-2" })];
    const next = [createTask(), createTask({ taskId: "task-2" })];

    const stabilized = stabilizeTaskListItems(previous, next);

    expect(stabilized).toBe(previous);
    expect(stabilized[0]).toBe(previous[0]);
  });

  it("Other rows retain old references when only one row changes", () => {
    const previous = [createTask(), createTask({ taskId: "task-2" })];
    const next = [createTask({ title: "新标题" }), createTask({ taskId: "task-2" })];

    const stabilized = stabilizeTaskListItems(previous, next);

    expect(stabilized).not.toBe(previous);
    expect(stabilized[0]).toBe(next[0]);
    expect(stabilized[1]).toBe(previous[1]);
  });

  it("Activity sidecar with equivalent content is also considered equal (nested objects compared by value)", () => {
    const activity = { phase: "running" as const, lastActivityAt: 5, hasBackgroundWork: false };
    const previous = [attachTaskListRowActivity(createTask(), activity)];
    const next = [attachTaskListRowActivity(createTask(), { ...activity })];

    expect(stabilizeTaskListItems(previous, next)).toBe(previous);
  });

  it("Row receives new reference when activity timestamp changes", () => {
    const activity = { phase: "running" as const, lastActivityAt: 5, hasBackgroundWork: false };
    const previous = [attachTaskListRowActivity(createTask(), activity)];
    const next = [attachTaskListRowActivity(createTask(), { ...activity, lastActivityAt: 6 })];

    const stabilized = stabilizeTaskListItems(previous, next);

    expect(stabilized).not.toBe(previous);
    expect(stabilized[0]).toBe(next[0]);
  });

  it("Does not reuse old array on reordering, but each row retains its old reference", () => {
    const previous = [createTask(), createTask({ taskId: "task-2" })];
    const next = [createTask({ taskId: "task-2" }), createTask()];

    const stabilized = stabilizeTaskListItems(previous, next);

    expect(stabilized).not.toBe(previous);
    expect(stabilized[0]).toBe(previous[1]);
    expect(stabilized[1]).toBe(previous[0]);
  });

  it("First frame (empty old array) adopts new array directly", () => {
    const next = [createTask()];
    expect(stabilizeTaskListItems([], next)).toBe(next);
  });
});

describe("buildTaskListItemIdentityKey", () => {
  it("同一 taskId 在不同 workspace identity 下不互相复用", () => {
    expect(buildTaskListItemIdentityKey(createTask())).not.toBe(
      buildTaskListItemIdentityKey(createTask({ workspaceIdentity: "remote-a" })),
    );
  });
});

describe("areTaskListItemsEquivalent", () => {
  it("Considered not equal if field counts differ", () => {
    expect(areTaskListItemsEquivalent(createTask(), createTask({ unreadAt: 7 }))).toBe(false);
  });

  it("Considered equal when nested sidecar key order differs but content is identical", () => {
    const previous = attachTaskListRowActivity(createTask(), {
      phase: "running",
      lastActivityAt: 5,
      hasBackgroundWork: false,
    });
    const next = attachTaskListRowActivity(createTask(), {
      hasBackgroundWork: false,
      lastActivityAt: 5,
      phase: "running",
    });

    expect(JSON.stringify(previous)).not.toBe(JSON.stringify(next));
    expect(areTaskListItemsEquivalent(previous, next)).toBe(true);
    expect(stabilizeTaskListItems([previous], [next])[0]).toBe(previous);
  });

  it("Considered equal when top-level key order differs but content is identical", () => {
    const left = { taskId: "t", workspacePath: "/repo", title: "a" } as CfTaskMeta;
    const right = { title: "a", workspacePath: "/repo", taskId: "t" } as CfTaskMeta;

    expect(areTaskListItemsEquivalent(left, right)).toBe(true);
  });

  it("Explicit undefined field is equivalent to omitted field (consistent with JSON semantics)", () => {
    const left = { ...createTask(), workspaceIdentity: undefined } as CfTaskMeta;

    expect(areTaskListItemsEquivalent(left, createTask())).toBe(true);
  });

  it("Reordered nested arrays are still considered not equal", () => {
    const left = { ...createTask(), tags: ["a", "b"] } as unknown as CfTaskMeta;
    const right = { ...createTask(), tags: ["b", "a"] } as unknown as CfTaskMeta;

    expect(areTaskListItemsEquivalent(left, right)).toBe(false);
  });
});
