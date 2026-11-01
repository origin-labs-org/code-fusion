import type { CfOffPeakTask, CfOffPeakTaskStatus } from "@origin-ai/cf-shared";
import { describe, expect, it } from "vitest";
import { sortOffPeakTasksByCreatedAt } from "@/settings/OffPeakTaskList.js";

function createTask(
  offPeakTaskId: string,
  status: CfOffPeakTaskStatus,
  createdAt: number,
): CfOffPeakTask {
  return {
    offPeakTaskId,
    title: offPeakTaskId,
    prompt: offPeakTaskId,
    permissionMode: "default",
    workspaceKey: "/workspace",
    workspacePath: "/workspace",
    status,
    queuedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("sortOffPeakTasksByCreatedAt", () => {
  it("Sort only in descending order of creation time; do not let status change card positions", () => {
    const tasks = [
      createTask("older-running", "running", 100),
      createTask("newer-completed", "completed", 300),
      createTask("middle-failed", "failed", 200),
    ];

    expect(sortOffPeakTasksByCreatedAt(tasks).map((task) => task.offPeakTaskId)).toEqual([
      "newer-completed",
      "middle-failed",
      "older-running",
    ]);
    expect(tasks.map((task) => task.offPeakTaskId)).toEqual([
      "older-running",
      "newer-completed",
      "middle-failed",
    ]);
  });
});
