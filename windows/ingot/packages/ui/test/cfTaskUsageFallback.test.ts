import { beforeEach, describe, expect, it } from "vitest";
import {
  buildPromptCompletionUsageFallback,
  buildTaskContextUsageFromUsageUpdate,
  recordTaskContextUsageUpdate,
  resetTaskContextUsageUpdateRecordsForTest,
} from "../src/lib/cfTaskUsageFallback.js";

function createUsage(totalTokens: number) {
  return {
    inputTokens: totalTokens,
    outputTokens: 0,
    totalTokens,
  };
}

describe("cfTaskUsageFallback", () => {
  beforeEach(() => {
    resetTaskContextUsageUpdateRecordsForTest();
  });

  it("After receiving a positive usage_update, context used is no longer overwritten with task_complete usage", () => {
    recordTaskContextUsageUpdate({
      workspacePath: "/tmp/workspace-usage",
      taskId: "task-usage",
      used: 65_274,
      size: 200_000,
    });

    expect(
      buildPromptCompletionUsageFallback({
        workspacePath: "/tmp/workspace-usage",
        taskId: "task-usage",
        currentUsage: {
          used: 65_274,
          size: 200_000,
        },
        usage: createUsage(2_149_900),
      }),
    ).toBeNull();
  });

  it("没有 usage_update 的 provider 仍可用 task_complete usage 做弱 fallback", () => {
    expect(
      buildPromptCompletionUsageFallback({
        workspacePath: "/tmp/workspace-fallback",
        taskId: "task-fallback",
        currentUsage: {
          used: 0,
          size: 200_000,
        },
        usage: createUsage(38_000),
      }),
    ).toEqual({
      used: 38_000,
      size: 200_000,
    });

    expect(
      buildPromptCompletionUsageFallback({
        workspacePath: "/tmp/workspace-fallback",
        taskId: "task-fallback",
        currentUsage: {
          used: 38_000,
          size: 200_000,
        },
        usage: createUsage(42_000),
      }),
    ).toEqual({
      used: 42_000,
      size: 200_000,
    });
  });

  it("When only standalone contextWindow is present, task_complete usage can still be used as a soft fallback", () => {
    expect(
      buildPromptCompletionUsageFallback({
        workspacePath: "/tmp/workspace-window-only",
        taskId: "task-window-only",
        currentUsage: null,
        currentContextWindow: 1_000_000,
        usage: createUsage(12_000),
      }),
    ).toEqual({
      used: 12_000,
      size: 1_000_000,
    });
  });

  it("An initial usage_update with used=0 does not prevent completion fallback", () => {
    recordTaskContextUsageUpdate({
      workspacePath: "/tmp/workspace-zero",
      taskId: "task-zero",
      used: 0,
      size: 200_000,
    });

    expect(
      buildPromptCompletionUsageFallback({
        workspacePath: "/tmp/workspace-zero",
        taskId: "task-zero",
        currentUsage: {
          used: 0,
          size: 200_000,
        },
        usage: createUsage(1_024),
      }),
    ).toEqual({
      used: 1_024,
      size: 200_000,
    });
  });

  it("A usage_update with used=0 in normal turns does not overwrite existing positive context usage", () => {
    expect(
      buildTaskContextUsageFromUsageUpdate({
        currentUsage: {
          used: 25_483,
          size: 200_000,
          cost: { amount: 0.12, currency: "USD" },
        },
        incomingUsage: {
          used: 0,
          size: 200_000,
          cost: null,
        },
        latestUserPrompt: "继续分析代码",
      }),
    ).toEqual({
      used: 25_483,
      size: 200_000,
      cost: { amount: 0.12, currency: "USD" },
    });
  });

  it("压缩轮次允许 used=0 清空 context usage", () => {
    expect(
      buildTaskContextUsageFromUsageUpdate({
        currentUsage: {
          used: 25_483,
          size: 200_000,
          cost: null,
        },
        incomingUsage: {
          used: 0,
          size: 200_000,
          cost: null,
        },
        latestUserPrompt: "/compact",
      }),
    ).toEqual({
      used: 0,
      size: 200_000,
      cost: null,
    });
  });

  it("Duplicate usage_updates with identical used/size retain existing breakdown", () => {
    expect(
      buildTaskContextUsageFromUsageUpdate({
        currentUsage: {
          used: 25_483,
          size: 200_000,
          breakdown: [{ source: "messages", chars: 1200 }],
        },
        incomingUsage: {
          used: 25_483,
          size: 200_000,
          cost: null,
        },
        latestUserPrompt: "继续分析代码",
      }),
    ).toEqual({
      used: 25_483,
      size: 200_000,
      cost: null,
      breakdown: [{ source: "messages", chars: 1200 }],
    });
  });

  it("When new used/size has no breakdown, proportions from the previous turn are not carried over", () => {
    expect(
      buildTaskContextUsageFromUsageUpdate({
        currentUsage: {
          used: 25_483,
          size: 200_000,
          breakdown: [{ source: "messages", chars: 1200 }],
        },
        incomingUsage: {
          used: 30_000,
          size: 200_000,
          cost: null,
        },
        latestUserPrompt: "继续分析代码",
      }),
    ).toEqual({
      used: 30_000,
      size: 200_000,
      cost: null,
    });
  });
});
