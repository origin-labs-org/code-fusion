import { describe, expect, it } from "vitest";
import {
  createTaskNavigationHistory,
  goBack,
  goForward,
  pushAutomationsNavEntry,
  pushPluginStoreNavEntry,
  pushNavEntry,
  removeTaskFromHistory,
} from "@/lib/taskNavigationHistory.js";

describe("workspace navigation history", () => {
  it("kPlugin Marketplace作为独立 workspace Target记录", () => {
    const history = pushPluginStoreNavEntry(
      createTaskNavigationHistory(),
      "/repo",
      "ssh://dev/repo",
    );
    expect(history.entries).toEqual([
      { kind: "plugin-store", workspacePath: "/repo", workspaceIdentity: "ssh://dev/repo" },
    ]);
  });

  it("k Automations 作为独立Target记录，并支持BackSession后再次前进", () => {
    const taskHistory = pushNavEntry(
      createTaskNavigationHistory(),
      "/workspace",
      "task-a",
      "local:/workspace",
    );
    const automationsHistory = pushAutomationsNavEntry(
      taskHistory,
      "/workspace",
      "local:/workspace",
      "automation-a",
      "idle",
    );

    const back = goBack(automationsHistory);
    expect(back?.entry).toMatchObject({
      kind: "task",
      taskId: "task-a",
      workspaceIdentity: "local:/workspace",
    });

    const forward = back ? goForward(back.history) : null;
    expect(forward?.entry).toEqual({
      kind: "automations",
      workspacePath: "/workspace",
      workspaceIdentity: "local:/workspace",
      automationId: "automation-a",
      automationTab: "idle",
    });
  });

  it("k Automations tab intent 纳入E邻去重and前进恢复", () => {
    const scheduled = pushAutomationsNavEntry(
      createTaskNavigationHistory(),
      "/workspace",
    );
    const idle = pushAutomationsNavEntry(
      scheduled,
      "/workspace",
      undefined,
      undefined,
      "idle",
    );

    expect(idle.entries).toEqual([
      { kind: "automations", workspacePath: "/workspace" },
      { kind: "automations", workspacePath: "/workspace", automationTab: "idle" },
    ]);
    expect(
      pushAutomationsNavEntry(idle, "/workspace", undefined, undefined, "idle"),
    ).toBe(idle);
  });

  it("回放同One Automations Target不会重复入栈，Delete task 也不会误删 Automations", () => {
    const taskHistory = pushNavEntry(
      createTaskNavigationHistory(),
      "/workspace",
      "task-a",
    );
    const automationsHistory = pushAutomationsNavEntry(
      taskHistory,
      "/workspace",
      undefined,
      "automation-a",
    );

    expect(
      pushAutomationsNavEntry(
        automationsHistory,
        "/workspace",
        undefined,
        "automation-a",
      ),
    ).toBe(automationsHistory);

    expect(removeTaskFromHistory(automationsHistory, "task-a")).toEqual({
      entries: [
        {
          kind: "automations",
          workspacePath: "/workspace",
          automationId: "automation-a",
        },
      ],
      cursor: 0,
    });
  });
});
