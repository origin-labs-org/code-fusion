import { describe, expect, it } from "vitest";
import type { CfOffPeakTask, CfOffPeakTaskStatus } from "@origin-ai/cf-shared";
import {
  filterAutomationsByStatus,
  filterOffPeakTasksByStatus,
  resolveAutomationStatusFilterKind,
  resolveAutomationTabState,
  resolveOffPeakStatusFilterKind,
} from "@/settings/automationStatusFilter.js";

function offPeakTask(status: CfOffPeakTaskStatus): CfOffPeakTask {
  return { offPeakTaskId: `task-${status}`, status } as unknown as CfOffPeakTask;
}

describe("automation status filter", () => {
  it("Idle tasks: queued/paused/running grouped as in-progress; failed/cancelled grouped as failed", () => {
    expect(resolveOffPeakStatusFilterKind(offPeakTask("queued"))).toBe("inProgress");
    expect(resolveOffPeakStatusFilterKind(offPeakTask("paused"))).toBe("inProgress");
    expect(resolveOffPeakStatusFilterKind(offPeakTask("running"))).toBe("inProgress");
    expect(resolveOffPeakStatusFilterKind(offPeakTask("completed"))).toBe("completed");
    expect(resolveOffPeakStatusFilterKind(offPeakTask("failed"))).toBe("failed");
    expect(resolveOffPeakStatusFilterKind(offPeakTask("cancelled"))).toBe("failed");
  });

  it("Idle tasks: return all as-is; filter others by group without changing order", () => {
    const tasks = [
      offPeakTask("failed"),
      offPeakTask("queued"),
      offPeakTask("cancelled"),
      offPeakTask("completed"),
    ];
    expect(filterOffPeakTasksByStatus(tasks, "all")).toBe(tasks);
    expect(filterOffPeakTasksByStatus(tasks, "failed").map((t) => t.status)).toEqual([
      "failed",
      "cancelled",
    ]);
    expect(filterOffPeakTasksByStatus(tasks, "inProgress").map((t) => t.status)).toEqual([
      "queued",
    ]);
    expect(filterOffPeakTasksByStatus(tasks, "completed")).toHaveLength(1);
  });

  it("Scheduled tasks: group cards with failure badges as failed; group the rest by lifecycle", () => {
    const active = { lifecycleStatus: "active" as const, enabled: true };
    const disabled = { lifecycleStatus: "active" as const, enabled: false };
    const paused = { lifecycleStatus: "paused" as const, enabled: true };
    const completed = { lifecycleStatus: "completed" as const, enabled: true };
    const failedLifecycle = { lifecycleStatus: "failed" as const, enabled: true };
    const activeWithLastError = { ...active, lastError: "boom" };
    const activeDispatchFailed = { ...active, dispatchStatus: "failed_to_dispatch" as const };

    expect(resolveAutomationStatusFilterKind(active)).toBe("inProgress");
    expect(resolveAutomationStatusFilterKind(disabled)).toBe("inProgress");
    expect(resolveAutomationStatusFilterKind(paused)).toBe("inProgress");
    expect(resolveAutomationStatusFilterKind(completed)).toBe("completed");
    expect(resolveAutomationStatusFilterKind(failedLifecycle)).toBe("failed");
    expect(resolveAutomationStatusFilterKind(activeWithLastError)).toBe("failed");
    expect(resolveAutomationStatusFilterKind(activeDispatchFailed)).toBe("failed");

    const all = [active, activeWithLastError, completed, paused];
    expect(filterAutomationsByStatus(all, "all")).toBe(all);
    expect(filterAutomationsByStatus(all, "inProgress")).toEqual([active, paused]);
    expect(filterAutomationsByStatus(all, "failed")).toEqual([activeWithLastError]);
  });

  it("Switching top bar tabs resets filters; previous filters are not restored upon switching back (MR !2615 CR-01)", () => {
    const scheduledFailed = { tab: "scheduled" as const, filter: "failed" as const };
    expect(resolveAutomationTabState(scheduledFailed, "scheduled")).toBe(scheduledFailed);
    const idle = resolveAutomationTabState(scheduledFailed, "idle");
    expect(idle).toEqual({ tab: "idle", filter: "all" });
    expect(resolveAutomationTabState(idle, "scheduled")).toEqual({
      tab: "scheduled",
      filter: "all",
    });
  });
});
