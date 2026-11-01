import { describe, expect, it } from "vitest";
import type {
  WorkflowRunNode,
  WorkflowRunState,
  WorkflowRunActor,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  isWorkflowRunCancellable,
  isWorkflowRunResumable,
  workflowActorStartState,
  type WorkflowActorSlotRef,
  workflowRunEventLines,
  workflowRunResultView,
} from "@/app-shell/workflowRunPanel.js";
import { workflowRunQuestionWaitedLabel } from "@/app-shell/workflowRunQuestions.js";

const format = (descriptor: { id: string }, values?: Record<string, string>) =>
  values ? `${descriptor.id}:${Object.values(values).join("/")}` : descriptor.id;

function run(overrides: Partial<WorkflowRunState> = {}): WorkflowRunState {
  return {
    runId: "dwfrun-1",
    status: "running",
    usage: { spentTokens: 0, nodesUsed: 0 },
    actors: [],
    nodes: [],
    lastEventSequence: 0,
    ...overrides,
  };
}

describe("isWorkflowRunCancellable", () => {
  it("只有 running 可Cancel", () => {
    expect(isWorkflowRunCancellable(run({ status: "running" }))).toBe(true);
    for (const status of ["pending", "completed", "errored", "stopped"] as const) {
      expect(isWorkflowRunCancellable(run({ status }))).toBe(false);
    }
  });

  it("run 不在投影里（被淘汰 / 冷Start）时不可Cancel", () => {
    expect(isWorkflowRunCancellable(undefined)).toBe(false);
  });
});

describe("workflowRunResultView", () => {
  it("pending / running 没有Result面板", () => {
    expect(workflowRunResultView(run({ status: "pending" })).kind).toBe("none");
    expect(workflowRunResultView(run({ status: "running" })).kind).toBe("none");
  });

  it("completed 且无 resultPreview 时只报Completed、绝不编造Result", () => {
    const view = workflowRunResultView(run({ status: "completed" }));
    expect(view).toEqual({ kind: "completed" });
  });

  it("completed 且真带 resultPreview 时如实展示（schema Allow，本Phase不可达）", () => {
    const view = workflowRunResultView(run({ status: "completed", resultPreview: "42 files" }));
    expect(view).toEqual({ kind: "completed", preview: "42 files" });
  });

  it("errored / stopped 报ErrorOriginal text；error 缺省时仍进Error面板；stopped 带原因词", () => {
    expect(workflowRunResultView(run({ status: "errored", error: "boom" }))).toEqual({
      kind: "error",
      status: "errored",
      message: "boom",
    });
    expect(workflowRunResultView(run({ status: "stopped" }))).toEqual({
      kind: "error",
      status: "stopped",
    });
    expect(
      workflowRunResultView(run({ status: "stopped", stopReason: "provider", error: "expired" })),
    ).toEqual({ kind: "error", status: "stopped", stopReason: "provider", message: "expired" });
  });

  it("run 缺席时Yes absent，而不Yes伪造One个 pending", () => {
    expect(workflowRunResultView(undefined)).toEqual({ kind: "absent" });
  });
});

describe("workflowRunQuestionWaitedLabel", () => {
  const NOW = 1_756_000_000_000;
  const MINUTE = 60_000;

  it("按分钟 / 小时 / 天分档，不足One分钟说「Just now」", () => {
    const at = (elapsedMs: number) => workflowRunQuestionWaitedLabel(NOW - elapsedMs, NOW, format);
    expect(at(0)).toBe("sidePane.time.justNow");
    expect(at(59_999)).toBe("sidePane.time.justNow");
    expect(at(MINUTE)).toBe("sidePane.time.minutesAgo:1");
    expect(at(42 * MINUTE)).toBe("sidePane.time.minutesAgo:42");
    expect(at(59 * MINUTE + 59_999)).toBe("sidePane.time.minutesAgo:59");
    expect(at(60 * MINUTE)).toBe("sidePane.time.hoursAgo:1");
    expect(at(23 * 60 * MINUTE)).toBe("sidePane.time.hoursAgo:23");
    expect(at(24 * 60 * MINUTE)).toBe("sidePane.time.daysAgo:1");
    expect(at(9 * 24 * 60 * MINUTE)).toBe("sidePane.time.daysAgo:9");
  });

  it("askedAt 缺席时整段不渲染，而不Yes编One个「Just now」出来", () => {
    expect(workflowRunQuestionWaitedLabel(undefined, NOW, format)).toBeUndefined();
    expect(workflowRunQuestionWaitedLabel(Number.NaN, NOW, format)).toBeUndefined();
  });

  it("时钟偏斜把 askedAt 推到未来时钳到「Just now」，绝不To出负CountDuration", () => {
    expect(workflowRunQuestionWaitedLabel(NOW + 5 * MINUTE, NOW, format)).toBe(
      "sidePane.time.justNow",
    );
  });
});

describe("workflowRunEventLines", () => {
  it("把引擎实际发出的每个种类摘成可读One行，而不Yes dump JSON", () => {
    const lines = workflowRunEventLines(
      [
        {
          sequence: 1,
          type: "run-started",
          payload: { runId: "dwfrun-1", caps: { maxConcurrency: 8 } },
        },
        {
          sequence: 2,
          type: "actor-created",
          payload: { actor: { siteId: "actor#1", ordinal: 1 }, name: "planner" },
        },
        {
          sequence: 3,
          type: "node-queued",
          payload: { instance: { siteId: "ask#1", ordinal: 1 }, kind: "ask" },
        },
        {
          sequence: 4,
          type: "node-dispatched",
          payload: { instance: { siteId: "ask#1", ordinal: 1 } },
        },
        {
          sequence: 5,
          type: "node-repairing",
          payload: { instance: { siteId: "ask#1", ordinal: 1 }, attempt: 2, violations: [{}, {}] },
        },
        {
          sequence: 6,
          type: "node-nudged",
          payload: { instance: { siteId: "ask#1", ordinal: 1 } },
        },
        {
          sequence: 7,
          type: "node-settled",
          payload: { instance: { siteId: "ask#1", ordinal: 1 }, outcome: "ok" },
        },
        { sequence: 8, type: "usage-updated", payload: { spentTokens: 1_234 } },
        { sequence: 9, type: "log", payload: { message: "scanning workspace" } },
        {
          sequence: 10,
          type: "import-cache-closed",
          payload: { instance: { siteId: "ask#2", ordinal: 1 }, cause: "mutating-tool", actorName: "fixer" },
        },
        { sequence: 11, type: "run-settled", payload: { status: "completed" } },
      ],
      format,
    );

    expect(lines.map((line) => line.label)).toEqual([
      "chat.toolCall.workflow.run.event.runStarted",
      "chat.toolCall.workflow.run.event.actorCreated",
      "chat.toolCall.workflow.run.event.nodeQueued",
      "chat.toolCall.workflow.run.event.nodeDispatched",
      "chat.toolCall.workflow.run.event.nodeRepairing:2",
      "chat.toolCall.workflow.run.event.nodeNudged",
      "chat.toolCall.workflow.run.event.nodeSettled:chat.toolCall.workflow.run.outcome.ok",
      "chat.toolCall.workflow.run.event.usageUpdated",
      "chat.toolCall.workflow.run.event.log",
      "chat.toolCall.workflow.run.event.importCacheClosed",
      "chat.toolCall.workflow.run.event.runSettled:chat.toolCall.workflow.run.status.completed",
    ]);
    expect(lines[1]!.detail).toBe("planner · actor#1@1");
    expect(lines[9]!.detail).toBe("fixer · ask#2@1");
    expect(lines[2]!.detail).toBe("ask#1@1 · ask");
    expect(lines[3]!.detail).toBe("ask#1@1");
    expect(lines[8]!.detail).toBe("scanning workspace");
    for (const line of lines) expect(line.detail ?? "").not.toContain("{");
  });

  it("cached Hit在 settled 行上明说，failed 行带ErrorOriginal text并Label成Failed色", () => {
    const [cached, failed] = workflowRunEventLines(
      [
        {
          sequence: 1,
          type: "node-settled",
          payload: { instance: { siteId: "ask#2", ordinal: 3 }, outcome: "ok", cached: true },
        },
        {
          sequence: 2,
          type: "node-settled",
          payload: {
            instance: { siteId: "ask#2", ordinal: 4 },
            outcome: "failed",
            error: { message: "schema mismatch" },
          },
        },
      ],
      format,
    );

    expect(cached!.label).toBe(
      "chat.toolCall.workflow.run.event.nodeSettledCached:chat.toolCall.workflow.run.outcome.ok",
    );
    expect(cached!.tone).toBe("default");
    expect(failed!.detail).toBe("ask#2@4 · schema mismatch");
    expect(failed!.tone).toBe("failed");
  });

  
  it("Upgrade两行自成One类：qid 打头（唯One的关联键），actor 名缺席时Returned站点Instance", () => {
    const [named, anonymous, answered] = workflowRunEventLines(
      [
        {
          sequence: 1,
          type: "escalation-raised",
          payload: {
            qid: "dwfq-dwfrun1-1",
            actor: { siteId: "actor#1", ordinal: 1 },
            actorName: "poet",
            question: "评分上限 95，门槛 96，Is this door broken?",
          },
        },
        {
          sequence: 2,
          type: "escalation-raised",
          payload: {
            qid: "dwfq-dwfrun1-2",
            actor: { siteId: "actor#2", ordinal: 3 },
            question: "用哪版风格指南？",
          },
        },
        {
          sequence: 3,
          type: "escalation-resolved",
          payload: { qid: "dwfq-dwfrun1-1", answer: "门确实Broken; approved with 95." },
        },
      ],
      format,
    );

    expect(named!.label).toBe("chat.toolCall.workflow.run.event.escalationRaised");
    expect(named!.detail).toBe("dwfq-dwfrun1-1 · poet · 评分上限 95，门槛 96，Is this door broken?");
    expect(named!.tone).toBe("default");
    expect(anonymous!.detail).toBe("dwfq-dwfrun1-2 · actor#2@3 · Which style guide version should be used?");

    expect(answered!.label).toBe("chat.toolCall.workflow.run.event.escalationResolved");
    expect(answered!.detail).toBe("dwfq-dwfrun1-1 · 门确实Broken; approved with 95.");
    expect(answered!.tone).toBe("default");
  });

  it("Upgrade行的LongBody按 detail 列的既有上限截断（CompleteBody归待AnswerIssue区）", () => {
    const long = "很Long的Issue".repeat(100);
    const [raised] = workflowRunEventLines(
      [
        {
          sequence: 1,
          type: "escalation-raised",
          payload: { qid: "dwfq-1", actor: { siteId: "a", ordinal: 1 }, question: long },
        },
      ],
      format,
    );
    expect(raised!.detail!.length).toBeLessThan(long.length);
    expect(raised!.detail!.endsWith("…")).toBe(true);
  });

  it("Upgrade行的Character段残缺时只丢那One截，不整行空白（有Boundary化可能削掉深层Character段）", () => {
    const [noActor, noAnswer] = workflowRunEventLines(
      [
        {
          sequence: 1,
          type: "escalation-raised",
          payload: { qid: "dwfq-1", question: "还在吗？" },
        },
        { sequence: 2, type: "escalation-resolved", payload: { qid: "dwfq-1" } },
      ],
      format,
    );
    expect(noActor!.detail).toBe("dwfq-1 · 还在吗？");
    expect(noAnswer!.detail).toBe("dwfq-1");
  });

  it("run-settled 的出Wrong/stop同样Label成Failed色", () => {
    const [failed, cancelled] = workflowRunEventLines(
      [
        {
          sequence: 1,
          type: "run-settled",
          payload: { status: "errored", error: { message: "aborted by cap" } },
        },
        { sequence: 2, type: "run-settled", payload: { status: "stopped", stopReason: "user" } },
      ],
      format,
    );
    expect(failed!.tone).toBe("failed");
    expect(failed!.detail).toBe("aborted by cap");
    expect(cancelled!.tone).toBe("failed");
  });

  
  it("report 自成One行：带Instance，条目只To短Summary（Complete预览归 Results 区）", () => {
    const [text, object, empty] = workflowRunEventLines(
      [
        {
          sequence: 1,
          type: "report",
          payload: { instance: { siteId: "report#1", ordinal: 1 }, item: "3 stale imports" },
        },
        {
          sequence: 2,
          type: "report",
          payload: { instance: { siteId: "report#2", ordinal: 4 }, item: { file: "a.ts" } },
        },
        { sequence: 3, type: "report", payload: { instance: { siteId: "report#3", ordinal: 1 } } },
      ],
      format,
    );

    expect(text!.label).toBe("chat.toolCall.workflow.run.event.report");
    expect(text!.detail).toBe("report#1@1 · 3 stale imports");
    expect(text!.tone).toBe("default");
    expect(object!.detail).toBe('report#2@4 · {"file":"a.ts"}');
    expect(empty!.detail).toBe("report#3@1");
  });

  it("phase-entered 自成One行：名Character，Second timeFrom带轮次", () => {
    const [first, second, bare] = workflowRunEventLines(
      [
        { sequence: 1, type: "phase-entered", payload: { name: "Verify", ordinal: 1 } },
        { sequence: 2, type: "phase-entered", payload: { name: "Verify", ordinal: 2 } },
        { sequence: 3, type: "phase-entered", payload: {} },
      ],
      format,
    );
    expect(first!.label).toBe("chat.toolCall.workflow.run.event.phaseEntered");
    expect(first!.detail).toBe("Verify");
    expect(second!.detail).toBe("Verify · 2");
    expect(bare!.detail).toBeUndefined();
    expect(bare!.tone).toBe("default");
  });

  it("Unknown种类退化成 type + 截断 JSON，既不崩也不假装认识它", () => {
    const [line] = workflowRunEventLines(
      [{ sequence: 1, type: "compaction", payload: { actor: { siteId: "actor#1", ordinal: 1 } } }],
      format,
    );
    expect(line!.label).toBe("chat.toolCall.workflow.run.event.unknown:compaction");
    expect(line!.detail).toContain("actor#1");
  });

  it("超LongUnknown载荷被截断，不把整条 journal 灌进 DOM", () => {
    const [line] = workflowRunEventLines(
      [{ sequence: 1, type: "mystery", payload: { blob: "x".repeat(5_000) } }],
      format,
    );
    expect(line!.detail!.length).toBeLessThanOrEqual(200);
    expect(line!.detail!.endsWith("…")).toBe(true);
  });

  it("载荷形状不符时不抛异常（有Boundary化可能已经削掉Character段）", () => {
    const lines = workflowRunEventLines(
      [
        { sequence: 1, type: "node-settled", payload: {} },
        { sequence: 2, type: "actor-created", payload: { actor: "not-a-ref" } },
        { sequence: 3, type: "log", payload: {} },
      ],
      format,
    );
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => typeof line.label === "string")).toBe(true);
  });

  it("truncated Events原样透出Label记，让读者知道Raw事实要去 journal 取", () => {
    const [line] = workflowRunEventLines(
      [{ sequence: 9, type: "log", payload: { message: "partial" }, truncated: true }],
      format,
    );
    expect(line!.truncated).toBe(true);
    expect(line!.sequence).toBe(9);
  });
});

function actor(overrides: Partial<WorkflowRunActor> = {}): WorkflowRunActor {
  return {
    siteId: "actor#1",
    ordinal: 1,
    sessionId: "dwf-run1-actor_1@1",
    status: "waiting",
    ...overrides,
  };
}

describe("workflowActorStartState", () => {
  const node = (overrides: Partial<WorkflowRunNode> = {}): WorkflowRunNode => ({
    siteId: "ask#1",
    ordinal: 1,
    phase: "queued",
    actorSiteId: "actor#1",
    actorOrdinal: 1,
    ...overrides,
  });
  const slot = (overrides: Partial<WorkflowActorSlotRef> = {}): WorkflowActorSlotRef => ({
    runId: "dwfrun-1",
    siteId: "actor#1",
    ordinal: 1,
    ...overrides,
  });

  it("actor 在投影里但One个节点都没有 → notStarted，Session id 取投影", () => {
    const runs = [run({ actors: [actor({ sessionId: "s-a" })] })];
    expect(workflowActorStartState(runs, slot())).toEqual({
      state: "notStarted",
      sessionId: "s-a",
    });
  });

  it("只有 queued 节点 → notStarted：Queue里的节点不构成Session已落库的Evidence", () => {
    const runs = [
      run({ actors: [actor({ sessionId: "s-a" })], nodes: [node(), node({ ordinal: 2 })] }),
    ];
    expect(workflowActorStartState(runs, slot()).state).toBe("notStarted");
  });

  it("dispatched / repairing / nudged / settled（含 cached）都算 started，订阅投影里的Session", () => {
    for (const phase of ["dispatched", "repairing", "nudged", "settled"] as const) {
      const runs = [
        run({
          actors: [actor({ sessionId: "s-a" })],
          nodes: [node(), node({ ordinal: 2, phase })],
        }),
      ];
      expect(workflowActorStartState(runs, slot())).toEqual({ state: "started", sessionId: "s-a" });
    }
    const cached = [
      run({
        actors: [actor({ sessionId: "s-a" })],
        nodes: [node({ phase: "settled", outcome: "ok", cached: true })],
      }),
    ];
    expect(workflowActorStartState(cached, slot()).state).toBe("started");
  });

  it("actor 不在投影里、tab 带Session id → unknown：run 被淘汰、冷恢复、投影整体缺席", () => {
    const expected = { state: "unknown", sessionId: "s-a" };
    const runs = [run({ actors: [actor({ ordinal: 2, sessionId: "s-other" })] })];
    expect(workflowActorStartState(runs, slot({ actorSessionId: "s-a" }))).toEqual(expected);
    expect(workflowActorStartState([], slot({ actorSessionId: "s-a" }))).toEqual(expected);
    expect(workflowActorStartState(undefined, slot({ actorSessionId: "s-a" }))).toEqual(expected);
    const other = [
      run({
        runId: "dwfrun-2",
        actors: [actor({ sessionId: "s-a" })],
        nodes: [node({ phase: "dispatched" })],
      }),
    ];
    expect(workflowActorStartState(other, slot({ actorSessionId: "s-a" }))).toEqual(expected);
  });

  it("actor 不在投影里、tab 没有Session id → notStarted：未Start药丸开的槽位，没有可订阅的东西", () => {
    expect(workflowActorStartState([run()], slot())).toEqual({ state: "notStarted" });
    expect(workflowActorStartState(undefined, slot())).toEqual({ state: "notStarted" });
  });

  it("投影里的Session id 优先于 tab 带的；投影没有时才用 tab 的；两边都没有就只有处Context", () => {
    const live = [
      run({ actors: [actor({ sessionId: "s-live" })], nodes: [node({ phase: "dispatched" })] }),
    ];
    expect(workflowActorStartState(live, slot({ actorSessionId: "s-stale" }))).toEqual({
      state: "started",
      sessionId: "s-live",
    });
    const bare = [
      run({ actors: [actor({ sessionId: undefined })], nodes: [node({ phase: "dispatched" })] }),
    ];
    expect(workflowActorStartState(bare, slot({ actorSessionId: "s-tab" }))).toEqual({
      state: "started",
      sessionId: "s-tab",
    });
    expect(workflowActorStartState(bare, slot())).toEqual({ state: "started" });
  });

  it("跨多 run 按 runId Hit正确的 actor，而不Yes同名同序Number的邻居", () => {
    const runs = [
      run({
        runId: "dwfrun-1",
        actors: [actor({ sessionId: "s-a" })],
        nodes: [node({ phase: "dispatched" })],
      }),
      run({
        runId: "dwfrun-2",
        actors: [actor({ sessionId: "s-b" })],
        nodes: [node()],
      }),
    ];
    expect(workflowActorStartState(runs, slot({ runId: "dwfrun-1" }))).toEqual({
      state: "started",
      sessionId: "s-a",
    });
    expect(workflowActorStartState(runs, slot({ runId: "dwfrun-2" }))).toEqual({
      state: "notStarted",
      sessionId: "s-b",
    });
  });

  it("别的 actor 的节点、以及无 actor 的 world-read 节点，都不算它Start了", () => {
    const runs = [
      run({
        actors: [actor({ sessionId: "s-a" }), actor({ ordinal: 2, sessionId: "s-b" })],
        nodes: [
          node({ phase: "dispatched", actorOrdinal: 2 }),
          node({
            siteId: "world-read#1",
            phase: "settled",
            actorSiteId: undefined,
            actorOrdinal: undefined,
          }),
        ],
      }),
    ];
    expect(workflowActorStartState(runs, slot()).state).toBe("notStarted");
    expect(workflowActorStartState(runs, slot({ ordinal: 2 })).state).toBe("started");
  });
});

describe("isWorkflowRunResumable", () => {
  it("Status位在场 → 可恢复，无论 stopped 的原因Yes什么", () => {
    expect(isWorkflowRunResumable(run({ status: "stopped", resumable: true }))).toBe(true);
    expect(
      isWorkflowRunResumable(
        run({ status: "stopped", stopReason: "interrupted", resumable: true }),
      ),
    ).toBe(true);
  });

  it("Status位缺席 → 不可恢复，哪怕 status Yes stopped（Old CLI 不发该位；宁可少One个按钮）", () => {
    for (const status of ["pending", "running", "completed", "errored", "stopped"] as const) {
      expect(isWorkflowRunResumable(run({ status }))).toBe(false);
    }
  });

  it("投影缺席（被淘汰）→ 不可恢复", () => {
    expect(isWorkflowRunResumable(undefined)).toBe(false);
  });
});
