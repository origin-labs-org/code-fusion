import { describe, expect, it } from "vitest";
import type { CfTaskMeta } from "@origin-ai/cf-shared";
import type { TaskListRowActivity } from "@/v4/taskListRowActivity.js";
import { deriveTaskLeadingIndicator } from "../src/TaskList.js";

function createTaskMeta(overrides: Partial<CfTaskMeta> = {}): CfTaskMeta {
  return {
    taskId: "task-1",
    traceId: "trace-1",
    title: "Inspect unread status",
    workspacePath: "/tmp/workspace-task-list",
    createdAt: 1,
    updatedAt: 1,
    mode: "default",
    provider: "codex",
    ...overrides,
  };
}

function activity(phase: TaskListRowActivity["phase"]): TaskListRowActivity {
  return {
    phase,
    lastActivityAt: 10,
    hasBackgroundWork: false,
  };
}

describe("deriveTaskLeadingIndicator", () => {
  it("sessions-index error has highest priority, displaying a red dot", () => {
    expect(
      deriveTaskLeadingIndicator(
        createTaskMeta({ unreadAt: 123 }),
        activity("error"),
      ),
    ).toBe("error");
  });

  it("Historical failed tasks without activity sidecar fall back to displaying a red dot", () => {
    expect(
      deriveTaskLeadingIndicator(createTaskMeta({ status: "error" }), null),
    ).toBe("error");
  });

  it("新的 running activity 可以替换旧 persisted error", () => {
    expect(
      deriveTaskLeadingIndicator(
        createTaskMeta({ status: "error" }),
        activity("running"),
      ),
    ).toBe("loading");
  });

  it("Display blue dot when task meta itself includes unreadAt", () => {
    expect(
      deriveTaskLeadingIndicator(
        createTaskMeta({ unreadAt: 123 }),
        activity("completedSuccess"),
      ),
    ).toBe("unread");
  });

  it("蓝点优先级高于 running", () => {
    expect(
      deriveTaskLeadingIndicator(
        createTaskMeta({ unreadAt: 123 }),
        activity("running"),
      ),
    ).toBe("unread");
  });

  it.each(["prewarming", "running"] as const)(
    "%s 任务显示 loading",
    (phase) => {
      expect(
        deriveTaskLeadingIndicator(createTaskMeta(), activity(phase)),
      ).toBe("loading");
    },
  );

  it("仅持久化为 running 的历史任务不显示 loading", () => {
    expect(
      deriveTaskLeadingIndicator(createTaskMeta({ status: "running" }), null),
    ).toBe("none");
  });

  it("Final activity shows no prefix indicator when neither unread nor running", () => {
    expect(
      deriveTaskLeadingIndicator(
        createTaskMeta(),
        activity("completedInterrupted"),
      ),
    ).toBe("none");
  });
});
