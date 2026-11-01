import { describe, expect, it } from "vitest";
import type { CfSavedWorkflowRun } from "@origin-ai/cf-shared";
import {
  formatSavedWorkflowRunArgs,
  formatSavedWorkflowTokens,
  lastRunByWorkflowName,
  savedWorkflowRunBadgeKind,
  savedWorkflowRunDurationMs,
} from "@/settings/saved-workflows/savedWorkflowRunHistory.js";

function run(overrides: Partial<CfSavedWorkflowRun> & { runId: string }): CfSavedWorkflowRun {
  return {
    status: "completed",
    createdAt: 1_000,
    updatedAt: 2_000,
    spentTokens: 0,
    ...overrides,
  };
}

describe("lastRunByWorkflowName", () => {
  it("Take row with latest updatedAt for each name; unnamed runs do not belong to any workflow", () => {
    const map = lastRunByWorkflowName([
      run({ runId: "a", name: "x", updatedAt: 10 }),
      run({ runId: "b", name: "x", updatedAt: 30 }),
      run({ runId: "c", name: "y", updatedAt: 20 }),
      run({ runId: "d", updatedAt: 99 }),
    ]);
    expect(map.get("x")?.runId).toBe("b");
    expect(map.get("y")?.runId).toBe("c");
    expect(map.size).toBe(2);
  });
});

describe("savedWorkflowRunBadgeKind", () => {
  it("status → badge state mapping; both pending and running are rendered as active states", () => {
    expect(savedWorkflowRunBadgeKind(undefined)).toBe("never");
    expect(savedWorkflowRunBadgeKind("pending")).toBe("running");
    expect(savedWorkflowRunBadgeKind("running")).toBe("running");
    expect(savedWorkflowRunBadgeKind("completed")).toBe("completed");
    expect(savedWorkflowRunBadgeKind("failed")).toBe("errored");
    expect(savedWorkflowRunBadgeKind("errored")).toBe("errored");
    expect(savedWorkflowRunBadgeKind("cancelled")).toBe("stopped");
    expect(savedWorkflowRunBadgeKind("stopped")).toBe("stopped");
  });
});

describe("呈现辅助", () => {
  it("Argument chip: output strings as raw, minify the rest as JSON", () => {
    expect(formatSavedWorkflowRunArgs({ branch: "main", dry: false, list: [1] })).toEqual([
      "branch=main",
      "dry=false",
      "list=[1]",
    ]);
    expect(formatSavedWorkflowRunArgs(undefined)).toEqual([]);
  });

  it("Duration: use updatedAt for terminal states, calculate by now for non-terminal states, non-negative", () => {
    expect(savedWorkflowRunDurationMs(run({ runId: "a" }), 9_999)).toBe(1_000);
    expect(savedWorkflowRunDurationMs(run({ runId: "b", status: "running" }), 5_000)).toBe(4_000);
    expect(savedWorkflowRunDurationMs(run({ runId: "c", createdAt: 5, updatedAt: 1 }), 0)).toBe(0);
  });

  it("Token count: abbreviated with k / M", () => {
    expect(formatSavedWorkflowTokens(999)).toBe("999");
    expect(formatSavedWorkflowTokens(12_345)).toBe("12.3k");
    expect(formatSavedWorkflowTokens(2_500_000)).toBe("2.5M");
    expect(formatSavedWorkflowTokens(Number.NaN)).toBe("—");
  });
});
