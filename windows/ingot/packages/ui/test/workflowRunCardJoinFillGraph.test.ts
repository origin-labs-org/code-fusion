import { describe, expect, it } from "vitest";
import type { ConversationRow, WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  buildWorkflowFillGraphByRunId,
  buildWorkflowGraphByToolCallId,
  resolveWorkflowRunGraphForRun,
} from "@/v4/workflowRunCardJoin.js";
import { resolveWorkflowTurnDigests } from "@/v4/workflowTurnDigests.js";

let seq = 0;

const GRAPH_A = {
  steps: [{ id: "ask#1", kind: "ask", label: "a", lane: "actor#1", phase: "phase#1" }],
  lanes: [{ id: "actor#1" }],
  participants: [{ id: "p", phase: "phase#1", lane: "actor#1", steps: ["ask#1"] }],
  handoffs: [],
  phases: [
    { id: "phase#1", name: "探索" },
    { id: "hole#1", name: "决定分组" },
  ],
  holes: [{ siteId: "hole#1", name: "决定分组", type: "Plan" }],
};
const GRAPH_B = {
  ...GRAPH_A,
  steps: [
    ...GRAPH_A.steps,
    {
      id: "hole#1/ask#1",
      kind: "ask",
      label: "b",
      lane: "hole#1/actor#1",
      phase: "hole#1/phase#1",
      fill: "hole#1",
    },
  ],
  phases: [
    { id: "phase#1", name: "探索" },
    { id: "hole#1/phase#1", name: "冒烟测试", fill: "hole#1" },
  ],
  holes: [],
};

function row(options: {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  status?: string;
  graph?: unknown;
  ok?: boolean;
  
  fill?: { siteId: string; name: string };
}): ConversationRow {
  seq += 1;
  return {
    rowId: seq,
    turnId: "turn-1",
    createdAt: 1_700_000_000_000 + seq,
    createdAtSeq: seq,
    kind: "toolCall",
    toolCallId: options.toolCallId,
    toolName: options.toolName,
    status: options.status ?? "success",
    inputText: "{}",
    input: options.input,
    ...(options.graph === undefined
      ? {}
      : {
          display: {
            kind: "create_workflow",
            ok: options.ok ?? true,
            errorCount: 0,
            diagnostics: [],
            causalityGraph: options.graph,
            ...(options.fill === undefined ? {} : { fill: options.fill }),
          },
        }),
  } as unknown as ConversationRow;
}

const LAUNCH = row({
  toolCallId: "tc-create",
  toolName: "CreateWorkflow",
  input: { script: "…" },
  graph: GRAPH_A,
});
const FILL = row({
  toolCallId: "tc-fill",
  toolName: "FillWorkflowHole",
  input: { run_id: "run-1", hole_id: "hole#1", script: "…" },
  graph: GRAPH_B,
  fill: { siteId: "hole#1", name: "决定分组" },
});

function run(overrides: Partial<WorkflowRunState> = {}): WorkflowRunState {
  return {
    runId: "run-1",
    toolCallId: "tc-create",
    status: "running",
    usage: { spentTokens: 0, nodesUsed: 0 },
    actors: [],
    nodes: [],
    lastEventSequence: 0,
    ...overrides,
  };
}

describe("buildWorkflowFillGraphByRunId", () => {
  it("成功且编过的 FillWorkflowHole 行按 run_id 入表，名Character来自 display 的 fill 块而不Yes入参", () => {
    const fills = buildWorkflowFillGraphByRunId([LAUNCH, FILL]);
    expect(fills.get("run-1")?.graph).toBe(GRAPH_B);
    expect(fills.get("run-1")?.holeLabels.get("hole#1")).toEqual({ name: "决定分组" });
  });

  it("编不过 / Failed / 没有图的Complete行不入表；后来的覆盖先来的、Tags累积", () => {
    const rejected = row({
      toolCallId: "tc-x",
      toolName: "FillWorkflowHole",
      input: { run_id: "run-1", hole_id: "hole#1" },
      graph: GRAPH_B,
      ok: false,
    });
    const failed = row({
      toolCallId: "tc-y",
      toolName: "FillWorkflowHole",
      input: { run_id: "run-1", hole_id: "hole#1" },
      graph: GRAPH_B,
      status: "error",
    });
    expect(buildWorkflowFillGraphByRunId([rejected, failed]).size).toBe(0);
    const second = row({
      toolCallId: "tc-fill-2",
      toolName: "FillWorkflowHole",
      input: { run_id: "run-1", hole_id: "hole#2" },
      graph: GRAPH_A,
      fill: { siteId: "hole#2", name: "评判" },
    });
    const fills = buildWorkflowFillGraphByRunId([FILL, second]);
    expect(fills.get("run-1")?.graph).toBe(GRAPH_A);
    expect([...fills.get("run-1")!.holeLabels.keys()]).toEqual(["hole#1", "hole#2"]);
  });
});

describe("resolveWorkflowRunGraphForRun / 尾Summary", () => {
  it("Complete过就取Complete行的图，否则Returned发From行的图", () => {
    const graphs = buildWorkflowGraphByToolCallId([LAUNCH, FILL]);
    const fills = buildWorkflowFillGraphByRunId([LAUNCH, FILL]);
    expect(resolveWorkflowRunGraphForRun(graphs, fills, "tc-create", "run-1", [run()])).toBe(
      GRAPH_B,
    );
    expect(resolveWorkflowRunGraphForRun(graphs, fills, "tc-create", "run-2", [run()])).toBe(
      GRAPH_A,
    );
    expect(resolveWorkflowRunGraphForRun(graphs, undefined, "tc-create", "run-1", [run()])).toBe(
      GRAPH_A,
    );
  });

  it("轮尾Summary的卡按 runId 换上Complete后的图，并带上留白的名Character与类型", () => {
    const summary = {
      runId: "run-1",
      status: "running" as const,
      nodesSettled: 0,
      nodesTotal: 0,
      agents: 0,
      run: run(),
    };
    const digests = resolveWorkflowTurnDigests(
      { assistantWorkRows: [LAUNCH as never] },
      {
        byToolCallId: new Map([["tc-create", summary]]),
        byRunId: new Map([["run-1", summary]]),
        graphByToolCallId: buildWorkflowGraphByToolCallId([LAUNCH, FILL]),
        fillGraphByRunId: buildWorkflowFillGraphByRunId([LAUNCH, FILL]),
      },
    );
    expect(digests).toHaveLength(1);
    expect(digests[0]!.graph).toBe(GRAPH_B);
    expect(digests[0]!.holeLabels?.get("hole#1")?.name).toBe("决定分组");
  });
});
