import { describe, expect, it } from "vitest";
import type { TurnHeaderRow } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowRunCardSummary } from "@/ToolCallBlocks/shared.js";
import { resolveWorkflowTurnCompletion } from "@/v4/workflowTurnCompletion.js";

function header(overrides: Partial<TurnHeaderRow> = {}): TurnHeaderRow {
  return {
    rowId: 1,
    turnId: "turn",
    createdAt: 1_700_000_000_000,
    createdAtSeq: 1,
    kind: "turnHeader",
    origin: "backgroundResult",
    state: "completedSuccess",
    startedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function terminal(
  status: "completed" | "errored" | "stopped",
  extra: Record<string, unknown> = {},
) {
  return header({
    originMeta: {
      backgroundSource: "workflow",
      title: " deep-research ",
      workId: "run-1",
      workflowNotification: {
        kind: "terminal",
        status,
        summary: "done",
        durationMs: 708_000,
        artifacts: [{ id: "brief", kind: "markdown", title: "research-brief.md", version: 1 }],
        ...extra,
      },
    },
  });
}

const summary: WorkflowRunCardSummary = {
  runId: "run-1",
  toolCallId: "tool-1",
  status: "completed",
  nodesSettled: 16,
  nodesTotal: 16,
};

describe("resolveWorkflowTurnCompletion", () => {
  it("completed 的Final state通知轮解析出卡：名Character去空白、时间、产物、联接到的 run", () => {
    const completion = resolveWorkflowTurnCompletion(terminal("completed"), {
      byRunId: new Map([["run-1", summary]]),
    });
    expect(completion).toMatchObject({
      runId: "run-1",
      name: "deep-research",
      durationMs: 708_000,
      artifactsTruncated: false,
      summary: { toolCallId: "tool-1" },
    });
    expect(completion?.artifacts).toHaveLength(1);
  });

  it("联接不到 run（冷恢复）仍解析出卡，只Yes summary 缺席；砍过的载荷置 truncated", () => {
    const completion = resolveWorkflowTurnCompletion(
      terminal("completed", { artifactsTruncated: true, durationMs: undefined }),
      {},
    );
    expect(completion?.summary).toBeUndefined();
    expect(completion?.artifactsTruncated).toBe(true);
    expect(completion?.durationMs).toBeUndefined();
  });

  it("产物载荷缺席 ⇒ 空清单（卡仍画：run Completed了、有代价）", () => {
    const completion = resolveWorkflowTurnCompletion(
      terminal("completed", { artifacts: undefined }),
      {},
    );
    expect(completion?.artifacts).toEqual([]);
  });

  it.each(["errored", "stopped"] as const)("%s 不画卡", (status) => {
    expect(resolveWorkflowTurnCompletion(terminal(status), {})).toBeUndefined();
  });

  it("Upgrade通知、载荷缺席、bash 通知、普通User轮and缺失轮头都不Yes", () => {
    expect(
      resolveWorkflowTurnCompletion(
        header({
          originMeta: {
            backgroundSource: "workflow",
            title: "x",
            workId: "run-1",
            workflowNotification: { kind: "escalation", qid: "q", actor: "a", question: "?" },
          },
        }),
        {},
      ),
    ).toBeUndefined();
    expect(
      resolveWorkflowTurnCompletion(
        header({ originMeta: { backgroundSource: "workflow", title: "x", workId: "run-1" } }),
        {},
      ),
    ).toBeUndefined();
    expect(
      resolveWorkflowTurnCompletion(
        header({ originMeta: { backgroundSource: "bash", title: "x", workId: "b" } }),
        {},
      ),
    ).toBeUndefined();
    expect(resolveWorkflowTurnCompletion(header({ origin: "userInput" }), {})).toBeUndefined();
    expect(resolveWorkflowTurnCompletion(undefined, {})).toBeUndefined();
  });
});
