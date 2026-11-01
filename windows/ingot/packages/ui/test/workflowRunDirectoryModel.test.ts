//
import { describe, expect, it } from "vitest";
import type {
  V4ConversationWorkflowRunSummary,
  WorkflowRunState,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  WORKFLOW_RUN_DIRECTORY_LIMIT,
  buildWorkflowRunDirectory,
  countEndedWorkflowRuns,
  workflowRunDirectoryRefreshKey,
} from "@/v4/workflowRunDirectoryModel.js";

function summary(
  overrides: Partial<V4ConversationWorkflowRunSummary> &
    Pick<V4ConversationWorkflowRunSummary, "runId">,
): V4ConversationWorkflowRunSummary {
  return {
    toolCallId: `call-${overrides.runId}`,
    status: "completed",
    resumable: false,
    ...overrides,
  };
}

describe("buildWorkflowRunDirectory", () => {
  it("按五ValueStatus分桶：pending/running 归Running，completed/errored/stopped 归已结束", () => {
    const directory = buildWorkflowRunDirectory([
      summary({ runId: "r-pending", status: "pending" }),
      summary({ runId: "r-running", status: "running" }),
      summary({ runId: "r-completed", status: "completed" }),
      summary({ runId: "r-failed", status: "errored" }),
      summary({ runId: "r-cancelled", status: "stopped" }),
    ]);

    expect(directory.running.map((row) => row.runId)).toEqual(["r-pending", "r-running"]);
    expect(directory.ended.map((row) => row.runId)).toEqual([
      "r-completed",
      "r-failed",
      "r-cancelled",
    ]);
  });

  it("缺 toolCallId 的老 run 从list与计CountOne并剔除（过滤只有One处，不可能只剔One半）", () => {
    const summaries = [
      summary({ runId: "r-new" }),
      { runId: "r-old", status: "completed", resumable: false } as V4ConversationWorkflowRunSummary,
      {
        runId: "r-old-running",
        status: "running",
        resumable: false,
      } as V4ConversationWorkflowRunSummary,
    ];
    const directory = buildWorkflowRunDirectory(summaries);

    expect(directory.ended.map((row) => row.runId)).toEqual(["r-new"]);
    expect(directory.running).toEqual([]);
    expect(countEndedWorkflowRuns(summaries)).toBe(1);
  });

  it("计Count恒等于已结束listLong度——这就Yes「岛上的 N 与Pages上的行One致」那条Invariants", () => {
    const summaries = [
      summary({ runId: "r-1", status: "errored" }),
      summary({ runId: "r-2", status: "running" }),
      { runId: "r-3", status: "stopped", resumable: true } as V4ConversationWorkflowRunSummary,
      summary({ runId: "r-4", status: "stopped" }),
      summary({ runId: "r-5", status: "pending" }),
    ];

    expect(countEndedWorkflowRuns(summaries)).toBe(
      buildWorkflowRunDirectory(summaries).ended.length,
    );
    expect(countEndedWorkflowRuns(summaries)).toBe(2);
  });

  it("不重排：顺序就YesQueryTo的顺序（Recently Updated在前，Sort在 CLI Storage层）", () => {
    const directory = buildWorkflowRunDirectory([
      summary({ runId: "r-newest", updatedAt: 300 }),
      summary({ runId: "r-middle", updatedAt: 200 }),
      summary({ runId: "r-oldest", updatedAt: 100 }),
    ]);

    expect(directory.ended.map((row) => row.runId)).toEqual(["r-newest", "r-middle", "r-oldest"]);
  });

  it("原样带Inbound要渲染的Character段：label / updatedAt / stopReason / failureCode / resumable", () => {
    const directory = buildWorkflowRunDirectory([
      summary({
        runId: "r-1",
        label: "review-changes",
        status: "stopped",
        stopReason: "interrupted",
        failureCode: "Interrupted",
        failureMessage: "host restarted",
        updatedAt: 1_700_000_000_000,
        resumable: true,
      } as never),
    ]);

    expect(directory.ended[0]).toEqual({
      runId: "r-1",
      toolCallId: "call-r-1",
      label: "review-changes",
      status: "stopped",
      stopReason: "interrupted",
      failureCode: "Interrupted",
      failureMessage: "host restarted",
      updatedAt: 1_700_000_000_000,
      resumable: true,
    });
  });

  it("取满 limit 即判截断（Notice要出现），差One条就不判", () => {
    const full = Array.from({ length: WORKFLOW_RUN_DIRECTORY_LIMIT }, (_unused, index) =>
      summary({ runId: `r-${index}` }),
    );

    expect(buildWorkflowRunDirectory(full).truncated).toBe(true);
    expect(buildWorkflowRunDirectory(full.slice(1)).truncated).toBe(false);
  });

  it("截断按**QueryBack的**条Count判，而不Yes过滤后的行Count（否则满页老 run 会Show成「就这些」）", () => {
    const full = Array.from(
      { length: WORKFLOW_RUN_DIRECTORY_LIMIT },
      (_unused, index) =>
        ({
          runId: `r-old-${index}`,
          status: "completed",
          resumable: false,
        }) as V4ConversationWorkflowRunSummary,
    );
    const directory = buildWorkflowRunDirectory(full);

    expect(directory.ended).toEqual([]);
    expect(directory.truncated).toBe(true);
  });

  it("Summary缺席（还没查到 / Capabilities缺席）与空ArrayOne样Yes空Table of Contents，不抛", () => {
    for (const input of [null, undefined, []] as const) {
      const directory = buildWorkflowRunDirectory(input);
      expect(directory.running).toEqual([]);
      expect(directory.ended).toEqual([]);
      expect(directory.truncated).toBe(false);
      expect(countEndedWorkflowRuns(input)).toBe(0);
    }
  });
});

//
describe("workflowRunDirectoryRefreshKey", () => {
  function run(
    overrides: Partial<WorkflowRunState> & Pick<WorkflowRunState, "runId">,
  ): WorkflowRunState {
    return {
      toolCallId: `call-${overrides.runId}`,
      status: "running",
      usage: { spentTokens: 0, nodesUsed: 0 },
      actors: [],
      nodes: [],
      lastEventSequence: 0,
      ...overrides,
    };
  }

  it("Three种Final state都算Run完（errored / stopped 与 completed 同样要挪段）", () => {
    const running = workflowRunDirectoryRefreshKey([run({ runId: "r-1" })]);
    for (const status of ["completed", "errored", "stopped"] as const) {
      expect(workflowRunDirectoryRefreshKey([run({ runId: "r-1", status })])).not.toBe(running);
    }
  });

  it("NewFromOne个 run 时变化：开着Pages时它要出现在「Running」", () => {
    const one = workflowRunDirectoryRefreshKey([run({ runId: "r-1" })]);
    const two = workflowRunDirectoryRefreshKey([run({ runId: "r-1" }), run({ runId: "r-2" })]);

    expect(two).not.toBe(one);
  });

  it("节点级进度**不**变化——否则One次分页读会变成One条随引擎Events走的流", () => {
    const idle = run({ runId: "r-1" });
    const busy = run({
      runId: "r-1",
      nodes: [
        { siteId: "ask#1", ordinal: 1, phase: "settled", outcome: "ok" },
        { siteId: "ask#2", ordinal: 2, phase: "dispatched" },
      ],
      lastEventSequence: 42,
      usage: { spentTokens: 9_000, nodesUsed: 2 },
    });

    expect(workflowRunDirectoryRefreshKey([busy])).toBe(workflowRunDirectoryRefreshKey([idle]));
  });

  it("投影缺席（冷开首帧）有稳定的键，且与「One个 run 都没有」同Value", () => {
    expect(workflowRunDirectoryRefreshKey(undefined)).toBe(workflowRunDirectoryRefreshKey([]));
  });
});
