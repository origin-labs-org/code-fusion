import { describe, expect, it } from "vitest";
import {
  shouldShowTaskConfigLoadingOnSwitch,
  resolveTaskRuntimeStatusAfterRestore,
  shouldKeepTaskStreamingDuringRestore,
} from "../src/lib/taskRestoreRuntime.js";

describe("shouldKeepTaskStreamingDuringRestore", () => {
  it("Maintain running state while task is still streaming", () => {
    expect(shouldKeepTaskStreamingDuringRestore("streaming")).toBe(true);
  });

  it("Does not misidentify non-streaming states as in-flight recovery", () => {
    expect(shouldKeepTaskStreamingDuringRestore("ready")).toBe(false);
    expect(shouldKeepTaskStreamingDuringRestore("completed")).toBe(false);
  });
});

describe("resolveTaskRuntimeStatusAfterRestore", () => {
  it("Recovering streaming tasks continue to stay streaming", () => {
    expect(resolveTaskRuntimeStatusAfterRestore("streaming", true)).toBe("streaming");
  });

  it("Normal historical tasks return to ready after successful recovery", () => {
    expect(resolveTaskRuntimeStatusAfterRestore("completed", true)).toBe("ready");
  });

  it("Recover to streaming when snapshot declares main turn active", () => {
    expect(
      resolveTaskRuntimeStatusAfterRestore("ready", true, {
        persistedStatus: "running",
        runtimeMainActive: true,
      }),
    ).toBe("streaming");
  });

  it("Close out stale streaming with final state when persisted final state already covers latest user message", () => {
    expect(
      resolveTaskRuntimeStatusAfterRestore("streaming", true, {
        persistedStatus: "completed",
        persistedUpdatedAt: 200,
        latestUserMessageTimestamp: 100,
      }),
    ).toBe("completed");

    expect(
      resolveTaskRuntimeStatusAfterRestore("streaming", true, {
        persistedStatus: "error",
        persistedUpdatedAt: 200,
        latestUserMessageTimestamp: 100,
      }),
    ).toBe("failed");
  });

  it("Stale final snapshot from previous turn will not prematurely close out new turn\'s running task", () => {
    expect(
      resolveTaskRuntimeStatusAfterRestore("streaming", true, {
        persistedStatus: "completed",
        persistedUpdatedAt: 100,
        latestUserMessageTimestamp: 200,
      }),
    ).toBe("streaming");
  });

  it("Explicitly fall back to notReady when no session is recovered", () => {
    expect(resolveTaskRuntimeStatusAfterRestore("streaming", false)).toBe("notReady");
  });
});

describe("shouldShowTaskConfigLoadingOnSwitch", () => {
  it("Switching to another task should enter loading placeholder to avoid echoing previous task model", () => {
    expect(
      shouldShowTaskConfigLoadingOnSwitch({
        previousTaskId: "task-a",
        nextTaskId: "task-b",
      }),
    ).toBe(true);
  });

  it("Entering a task for the first time should also enter loading placeholder", () => {
    expect(
      shouldShowTaskConfigLoadingOnSwitch({
        previousTaskId: null,
        nextTaskId: "task-a",
      }),
    ).toBe(true);
  });

  it("Re-entering the same task does not retrigger loading placeholder", () => {
    expect(
      shouldShowTaskConfigLoadingOnSwitch({
        previousTaskId: "task-a",
        nextTaskId: "task-a",
      }),
    ).toBe(false);
  });

  it("Switching back to draft state does not trigger task loading placeholder", () => {
    expect(
      shouldShowTaskConfigLoadingOnSwitch({
        previousTaskId: "task-a",
        nextTaskId: null,
      }),
    ).toBe(false);
  });
});
