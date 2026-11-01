//
import { describe, expect, it } from "vitest";
import {
  reduceWorkflowRunsState,
  type WorkflowRunProgressEnvelope,
  type WorkflowRunsState,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowCausalityGraphData } from "@/components/workflow-graph/types.js";
import { buildWorkflowTimeline } from "@/components/workflow-timeline/timeline-model.js";
import { workflowActorStartState } from "@/app-shell/workflowRunPanel.js";

const RUN_ID = "dwfrun-b";

const FAN_OUT: WorkflowCausalityGraphData = {
  exits: ["phase#1"],
  handoffs: [],
  lanes: [{ id: "actor#1", name: "worker" }],
  participants: [
    { id: "phase#1:actor#1", lane: "actor#1", many: true, phase: "phase#1", steps: ["ask#1"] },
  ],
  phases: [{ id: "phase#1", name: "work" }],
  steps: [{ id: "ask#1", kind: "ask", label: "ask#1", lane: "actor#1", phase: "phase#1" }],
};

const actorRef = (ordinal: number) => ({ siteId: "actor#1", ordinal });
const askRef = (ordinal: number) => ({ siteId: "ask#1", ordinal });
const ownSession = (ordinal: number) => `sess-b-${ordinal}`;
const predecessorSession = (ordinal: number) => `sess-a-${ordinal}`;

function reduce(events: Array<[string, Record<string, unknown>, string?]>): WorkflowRunsState {
  let state: WorkflowRunsState | undefined;
  events.forEach(([eventType, payload, actorSessionId], sequence) => {
    const envelope: WorkflowRunProgressEnvelope = {
      runId: RUN_ID,
      toolCallId: "tc-1",
      sequence,
      eventType,
      payload,
      ...(actorSessionId === undefined ? {} : { actorSessionId }),
    };
    state = reduceWorkflowRunsState(state, envelope) ?? state;
  });
  return state!;
}

function amendedRun(options: { namesActor: boolean; settled: boolean }): WorkflowRunsState {
  const cachedSettle = (ordinal: number): [string, Record<string, unknown>, string?] =>
    options.namesActor
      ? [
          "node-settled",
          {
            instance: askRef(ordinal),
            outcome: "ok",
            cached: true,
            kind: "ask",
            actor: actorRef(ordinal),
            actorSeq: 0,
            sourceSessionId: predecessorSession(ordinal),
          },
          ownSession(ordinal),
        ]
      : ["node-settled", { instance: askRef(ordinal), outcome: "ok", cached: true }];
  return reduce([
    ["run-started", { caps: { maxConcurrency: 4 } }],
    ["phase-entered", { name: "work", ordinal: 1 }],
    ...[1, 2, 3].map((ordinal): [string, Record<string, unknown>, string?] => [
      "actor-created",
      { actor: actorRef(ordinal), name: `w${ordinal}`, phaseName: "work" },
      ownSession(ordinal),
    ]),
    cachedSettle(1),
    cachedSettle(2),
    ["node-queued", { instance: askRef(3), kind: "ask", actor: actorRef(3), actorSeq: 0 }],
    [
      "node-dispatched",
      { instance: askRef(3), kind: "ask", actor: actorRef(3), actorName: "w3" },
      ownSession(3),
    ],
    ["node-executing", { instance: askRef(3) }],
    ...(options.settled
      ? ([
          ["node-settled", { instance: askRef(3), outcome: "ok" }],
          ["run-settled", { status: "completed" }],
        ] as Array<[string, Record<string, unknown>, string?]>)
      : []),
  ]);
}

function pillsOf(state: WorkflowRunsState) {
  const run = state.runs[0]!;
  return buildWorkflowTimeline(FAN_OUT, run).stations[0]!.pills.map((pill) => ({
    key: pill.key,
    status: pill.status,
    sessionId: pill.instance?.sessionId,
  }));
}

describe("修订 run 的CacheHit：拆开的Instance卡", () => {
  it("Hit的两个 worker Yes done，不Yes待Start（run 还在Run时也One样）", () => {
    expect(pillsOf(amendedRun({ namesActor: true, settled: false }))).toEqual([
      { key: "phase#1:actor#1@1", status: "done", sessionId: predecessorSession(1) },
      { key: "phase#1:actor#1@2", status: "done", sessionId: predecessorSession(2) },
      { key: "phase#1:actor#1@3", status: "running", sessionId: ownSession(3) },
    ]);
  });

  it("run Completed之后仍Yes done（Report里的形状：待StartOne直停到最后）", () => {
    expect(
      pillsOf(amendedRun({ namesActor: true, settled: true })).map((pill) => pill.status),
    ).toEqual(["done", "done", "done"]);
  });

  it("老 journal（Hit不点名Sub-agent）：归属不上，卡停在 pending——记录在案的限制，不Yes回归", () => {
    expect(
      pillsOf(amendedRun({ namesActor: false, settled: true })).map((pill) => pill.status),
    ).toEqual(["pending", "pending", "done"]);
  });
});

describe("修订 run 的CacheHit：transcript 门", () => {
  const slot = (ordinal: number) => ({ runId: RUN_ID, siteId: "actor#1", ordinal });

  it("AllHit的Sub-agentStarted，订阅Predecessor里持有交换的那条Session", () => {
    const runs = amendedRun({ namesActor: true, settled: true }).runs;
    expect(workflowActorStartState(runs, slot(1))).toEqual({
      state: "started",
      sessionId: predecessorSession(1),
    });
    expect(workflowActorStartState(runs, slot(3))).toEqual({
      state: "started",
      sessionId: ownSession(3),
    });
  });

  it("tab 打开时带的Yes本 run 铸的 id：门以投影为准，不去订阅那条从未建过的Session", () => {
    const runs = amendedRun({ namesActor: true, settled: true }).runs;
    expect(
      workflowActorStartState(runs, { ...slot(2), actorSessionId: ownSession(2) }).sessionId,
    ).toBe(predecessorSession(2));
  });

  it("老 journal：门仍说未Start（归属不上的Hit证明不了任何Session）", () => {
    const runs = amendedRun({ namesActor: false, settled: true }).runs;
    expect(workflowActorStartState(runs, slot(1)).state).toBe("notStarted");
  });
});
