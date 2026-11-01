//
//
import { describe, expect, it } from "vitest";
import {
  WORKFLOW_RUNS_LIMITS,
  applyConversationDeltas,
  coalesceConversationDeltas,
  conversationDeltaSchema,
  diffWorkflowRunsState,
  reduceWorkflowRunsState,
  workflowRunStepCounts,
  workflowRunsStateSchema,
  type ConversationDelta,
  type ConversationSnapshot,
  type WorkflowRunEntryLimits,
  type WorkflowRunProgressEnvelope,
  type WorkflowRunState,
  type WorkflowRunsState,
} from "../src/cf-protocol-v4/index.js";

const RUN_ID = "dwfrun-1";

const LIMITS: WorkflowRunEntryLimits = { maxActors: 3, maxNodes: 3, maxPhases: 2 };

function snapshotWith(workflowRuns: WorkflowRunsState | undefined): ConversationSnapshot {
  const base = {
    protocolVersion: 1,
    sessionId: "s-1",
    logEpoch: "epoch-1",
    seq: 0,
    revision: 0,
    rows: { window: [], totalCount: 0, firstRowId: null },
  };
  return (workflowRuns === undefined
    ? base
    : { ...base, workflowRuns }) as unknown as ConversationSnapshot;
}

function driver(limits: WorkflowRunEntryLimits = LIMITS, runId = RUN_ID) {
  let sequence = -1;
  let state: WorkflowRunsState | undefined;
  return {
    send(
      eventType: string,
      payload: Record<string, unknown> = {},
      extra: Partial<WorkflowRunProgressEnvelope> = {},
    ): WorkflowRunProgressEnvelope {
      sequence += 1;
      const envelope: WorkflowRunProgressEnvelope = {
        runId,
        toolCallId: "tc-1",
        sequence,
        eventType,
        payload,
        ...extra,
      };
      state = reduceWorkflowRunsState(state, envelope, limits) ?? state;
      return envelope;
    },
    
    replay(envelope: WorkflowRunProgressEnvelope): WorkflowRunsState | null {
      return reduceWorkflowRunsState(state, envelope, limits);
    },
    get run(): WorkflowRunState {
      return state!.runs[0]!;
    },
    get state(): WorkflowRunsState {
      return state!;
    },
  };
}

const actorRef = (index: number) => ({ siteId: `actor#${index}`, ordinal: 1 });
const askRef = (index: number) => ({ siteId: `ask#${index}`, ordinal: 1 });
const worldRef = (index: number) => ({ siteId: `world#${index}`, ordinal: 1 });

const nodeKeys = (run: WorkflowRunState) => run.nodes.map((node) => node.siteId);
const actorKeys = (run: WorkflowRunState) => run.actors.map((actor) => actor.siteId);

function runOneAsk(
  driven: ReturnType<typeof driver>,
  index: number,
  options: { outcome?: "ok" | "failed" | "cancelled"; phaseName?: string; settle?: boolean } = {},
): void {
  const phase = options.phaseName === undefined ? {} : { phaseName: options.phaseName };
  driven.send("actor-created", { actor: actorRef(index), name: `a${index}`, ...phase });
  driven.send("node-queued", {
    instance: askRef(index),
    kind: "ask",
    actor: actorRef(index),
    ...phase,
  });
  driven.send("node-dispatched", { instance: askRef(index) });
  driven.send("node-executing", { instance: askRef(index) });
  if (options.settle === false) return;
  driven.send("node-settled", { instance: askRef(index), outcome: options.outcome ?? "ok" });
}

function dispatchWithFacts(
  driven: ReturnType<typeof driver>,
  index: number,
  options: {
    phaseName?: string;
    instructionsHead?: string;
    instance?: { siteId: string; ordinal: number };
  } = {},
): WorkflowRunProgressEnvelope {
  return driven.send(
    "node-dispatched",
    {
      instance: options.instance ?? askRef(index),
      kind: "ask",
      actor: actorRef(index),
      actorName: `a${index}`,
      ...(options.phaseName === undefined
        ? {}
        : { actorPhaseName: options.phaseName, phaseName: options.phaseName }),
      ...(options.instructionsHead === undefined
        ? {}
        : { instructionsHead: options.instructionsHead }),
    },
    { actorSessionId: `sess-${index}` },
  );
}

describe("2.1 什么时候淘汰", () => {
  it("actor 表满 + 活的新人：淘汰一个已完成组，新人入座", () => {
    const driven = driver({ maxActors: 3, maxNodes: 6, maxPhases: 2 });
    runOneAsk(driven, 1);
    runOneAsk(driven, 2);
    runOneAsk(driven, 3, { settle: false });
    expect(actorKeys(driven.run)).toEqual(["actor#1", "actor#2", "actor#3"]);

    driven.send("actor-created", { actor: actorRef(4), name: "a4" });
    expect(actorKeys(driven.run)).toEqual(["actor#2", "actor#3", "actor#4"]);
    expect(nodeKeys(driven.run)).toEqual(["ask#2", "ask#3"]);
    expect(driven.run.usage).toMatchObject({ nodesUnlisted: 1, nodesUnlistedSettled: 1 });
    expect(driven.run.truncated).toBe(true);
  });

  it("node 表满 + 活的新人：先淘汰已结算的游离节点（world-read 不是任何人的组）", () => {
    const driven = driver({ maxActors: 4, maxNodes: 3, maxPhases: 2 });
    driven.send("node-queued", { instance: worldRef(1), kind: "world-read" });
    driven.send("node-settled", { instance: worldRef(1), outcome: "ok" });
    runOneAsk(driven, 1);
    runOneAsk(driven, 2, { settle: false });
    expect(nodeKeys(driven.run)).toEqual(["world#1", "ask#1", "ask#2"]);

    driven.send("node-queued", { instance: askRef(3), kind: "ask", actor: actorRef(2) });
    expect(nodeKeys(driven.run)).toEqual(["ask#1", "ask#2", "ask#3"]);
    expect(actorKeys(driven.run)).toEqual(["actor#1", "actor#2"]);
    expect(driven.run.truncated).toBe(true);
  });

  it("没有游离节点时淘汰一个已完成组（actor 与它的节点一起走）", () => {
    const driven = driver({ maxActors: 4, maxNodes: 3, maxPhases: 2 });
    runOneAsk(driven, 1);
    runOneAsk(driven, 2, { settle: false });
    driven.send("node-queued", { instance: askRef(9), kind: "ask", actor: actorRef(2) });
    expect(nodeKeys(driven.run)).toEqual(["ask#1", "ask#2", "ask#9"]);

    driven.send("actor-created", { actor: actorRef(3), name: "a3" });
    driven.send("node-queued", { instance: askRef(3), kind: "ask", actor: actorRef(3) });
    expect(nodeKeys(driven.run)).toEqual(["ask#2", "ask#9", "ask#3"]);
    expect(actorKeys(driven.run)).toEqual(["actor#2", "actor#3"]);
  });

  it("重放的事件永不淘汰：水位没抬过，表照旧拒新", () => {
    const driven = driver({ maxActors: 4, maxNodes: 3, maxPhases: 2 });
    runOneAsk(driven, 1);
    runOneAsk(driven, 2, { settle: false });
    const queued = driven.send("node-queued", {
      instance: askRef(9),
      kind: "ask",
      actor: actorRef(2),
    });
    expect(driven.replay(queued)).toBeNull();
  });

  it("缓存命中的 node-settled 出生即结算，永不淘汰：它被拒，只进计数", () => {
    const driven = driver({ maxActors: 4, maxNodes: 3, maxPhases: 2 });
    runOneAsk(driven, 1);
    runOneAsk(driven, 2, { settle: false });
    driven.send("node-queued", { instance: askRef(9), kind: "ask", actor: actorRef(2) });
    const before = nodeKeys(driven.run);

    driven.send("actor-created", { actor: actorRef(3), name: "a3" });
    driven.send("node-settled", {
      instance: askRef(3),
      actor: actorRef(3),
      outcome: "ok",
      cached: true,
    });
    expect(nodeKeys(driven.run)).toEqual(before);
    expect(driven.run.usage).toMatchObject({ nodesUnlisted: 1, nodesUnlistedSettled: 1 });
  });

  it("一个可淘汰的受害者都没有时，照旧拒新并置 truncated", () => {
    const driven = driver({ maxActors: 4, maxNodes: 2, maxPhases: 2 });
    runOneAsk(driven, 1, { settle: false });
    runOneAsk(driven, 2, { settle: false });
    const before = nodeKeys(driven.run);

    driven.send("node-queued", { instance: askRef(3), kind: "ask", actor: actorRef(1) });
    expect(nodeKeys(driven.run)).toEqual(before);
    expect(driven.run.truncated).toBe(true);
    expect(driven.run.usage).toMatchObject({ nodesUnlisted: 1 });
    expect(driven.run.usage.nodesUnlistedSettled).toBeUndefined();
  });
});

describe("2.2 受害者顺序", () => {
  it("未失败的先走：失败是读者唯一还想找回来的已结算事实", () => {
    const driven = driver({ maxActors: 2, maxNodes: 6, maxPhases: 2 });
    runOneAsk(driven, 1, { outcome: "failed" });
    runOneAsk(driven, 2, { outcome: "ok" });
    driven.send("actor-created", { actor: actorRef(3), name: "a3" });
    expect(actorKeys(driven.run)).toEqual(["actor#1", "actor#3"]);
    expect(nodeKeys(driven.run)).toEqual(["ask#1"]);
  });

  it("cancelled 与 failed 同类：都算这个组失败了", () => {
    const driven = driver({ maxActors: 2, maxNodes: 6, maxPhases: 2 });
    runOneAsk(driven, 1, { outcome: "cancelled" });
    runOneAsk(driven, 2, { outcome: "ok" });
    driven.send("actor-created", { actor: actorRef(3), name: "a3" });
    expect(actorKeys(driven.run)).toEqual(["actor#1", "actor#3"]);
  });

  it("取候选最多的那个阶段：界花在条目拥挤的地方", () => {
    const driven = driver({ maxActors: 3, maxNodes: 8, maxPhases: 4 });
    runOneAsk(driven, 1, { phaseName: "p1" });
    runOneAsk(driven, 2, { phaseName: "p2" });
    runOneAsk(driven, 3, { phaseName: "p2" });
    driven.send("actor-created", { actor: actorRef(4), name: "a4", phaseName: "p3" });
    expect(actorKeys(driven.run)).toEqual(["actor#1", "actor#3", "actor#4"]);
  });

  it("A group\'s phase is its actor\'s birth phase (node timestamps do not participate)", () => {
    const driven = driver({ maxActors: 3, maxNodes: 8, maxPhases: 4 });
    driven.send("actor-created", { actor: actorRef(1), name: "a1", phaseName: "p1" });
    driven.send("node-queued", {
      instance: askRef(1),
      kind: "ask",
      actor: actorRef(1),
      phaseName: "p2",
    });
    driven.send("node-settled", { instance: askRef(1), outcome: "ok" });
    runOneAsk(driven, 2, { phaseName: "p2" });
    runOneAsk(driven, 3, { phaseName: "p2" });
    driven.send("actor-created", { actor: actorRef(4), name: "a4" });
    expect(actorKeys(driven.run)).toEqual(["actor#1", "actor#3", "actor#4"]);
  });

  it("The group of the new node\'s own actor is never a victim (otherwise it becomes an active node without a badge)", () => {
    const driven = driver({ maxActors: 4, maxNodes: 3, maxPhases: 2 });
    driven.send("actor-created", { actor: actorRef(1), name: "a1" });
    driven.send("node-queued", { instance: askRef(1), kind: "ask", actor: actorRef(1) });
    driven.send("node-settled", { instance: askRef(1), outcome: "ok" });
    driven.send("node-queued", { instance: askRef(2), kind: "ask", actor: actorRef(1) });
    driven.send("node-settled", { instance: askRef(2), outcome: "ok" });
    runOneAsk(driven, 3);
    expect(nodeKeys(driven.run)).toEqual(["ask#1", "ask#2", "ask#3"]);

    driven.send("node-queued", { instance: askRef(4), kind: "ask", actor: actorRef(1) });
    expect(nodeKeys(driven.run)).toEqual(["ask#1", "ask#2", "ask#4"]);
    expect(actorKeys(driven.run)).toEqual(["actor#1"]);
  });

  it("未结算的节点与带着未结算节点的 actor 永远不是受害者", () => {
    const driven = driver({ maxActors: 4, maxNodes: 3, maxPhases: 2 });
    driven.send("actor-created", { actor: actorRef(1), name: "a1" });
    driven.send("node-queued", { instance: askRef(1), kind: "ask", actor: actorRef(1) });
    driven.send("node-settled", { instance: askRef(1), outcome: "ok" });
    driven.send("node-queued", { instance: askRef(2), kind: "ask", actor: actorRef(1) });
    driven.send("node-executing", { instance: askRef(2) });
    driven.send("node-queued", { instance: worldRef(1), kind: "world-read" });
    const before = nodeKeys(driven.run);

    driven.send("node-queued", { instance: askRef(3), kind: "ask", actor: actorRef(1) });
    expect(nodeKeys(driven.run)).toEqual(before);
    expect(driven.run.truncated).toBe(true);
  });
});

describe("2.3 孤儿规则", () => {
  it("出生即结算的节点被拒时，名下一个已列节点都没有的 actor 一起摘掉", () => {
    const driven = driver({ maxActors: 4, maxNodes: 2, maxPhases: 2 });
    runOneAsk(driven, 1, { settle: false });
    runOneAsk(driven, 2, { settle: false });
    driven.send("actor-created", { actor: actorRef(3), name: "a3", phaseName: "p1" });
    expect(actorKeys(driven.run)).toEqual(["actor#1", "actor#2", "actor#3"]);

    driven.send("node-settled", {
      instance: askRef(3),
      actor: actorRef(3),
      outcome: "ok",
      cached: true,
      phaseName: "p1",
    });
    expect(actorKeys(driven.run)).toEqual(["actor#1", "actor#2"]);
    expect(driven.run.unlistedByPhase).toEqual([
      { phaseName: "p1", actors: 1, actorsSettled: 1, settled: 1 },
    ]);
  });

  it("actor 还有别的已列节点时不摘（它不是孤儿）", () => {
    const driven = driver({ maxActors: 4, maxNodes: 2, maxPhases: 2 });
    runOneAsk(driven, 1, { settle: false });
    driven.send("actor-created", { actor: actorRef(2), name: "a2" });
    driven.send("node-queued", { instance: askRef(2), kind: "ask", actor: actorRef(2) });
    driven.send("node-executing", { instance: askRef(2) });

    driven.send("node-settled", {
      instance: askRef(9),
      actor: actorRef(2),
      outcome: "ok",
      cached: true,
    });
    expect(actorKeys(driven.run)).toEqual(["actor#1", "actor#2"]);
  });

  it("失败的孤儿进 actorsFailed", () => {
    const driven = driver({ maxActors: 4, maxNodes: 2, maxPhases: 2 });
    runOneAsk(driven, 1, { settle: false });
    runOneAsk(driven, 2, { settle: false });
    driven.send("actor-created", { actor: actorRef(3), name: "a3", phaseName: "p1" });
    driven.send("node-settled", {
      instance: askRef(3),
      actor: actorRef(3),
      outcome: "failed",
      cached: true,
      phaseName: "p1",
    });
    expect(driven.run.unlistedByPhase).toEqual([
      { phaseName: "p1", actors: 1, actorsSettled: 1, actorsFailed: 1, settled: 1 },
    ]);
  });
});

describe("2.4 计数", () => {
  it("被淘汰的节点进 run 级两个计数器，步数读法照旧算得对", () => {
    const driven = driver({ maxActors: 2, maxNodes: 6, maxPhases: 2 });
    runOneAsk(driven, 1);
    runOneAsk(driven, 2, { settle: false });
    driven.send("actor-created", { actor: actorRef(3), name: "a3" });
    expect(driven.run.usage).toMatchObject({ nodesUnlisted: 1, nodesUnlistedSettled: 1 });
    expect(workflowRunStepCounts(driven.run)).toEqual({ total: 2, settled: 1 });
  });

  it("unlistedByPhase 按**出生阶段**分格，失败的另计一格子键", () => {
    const driven = driver({ maxActors: 2, maxNodes: 6, maxPhases: 4 });
    runOneAsk(driven, 1, { phaseName: "p1", outcome: "failed" });
    runOneAsk(driven, 2, { phaseName: "p2" });
    driven.send("actor-created", { actor: actorRef(3), name: "a3" });
    expect(driven.run.unlistedByPhase).toEqual([
      { phaseName: "p2", actors: 1, actorsSettled: 1, settled: 1 },
    ]);
    driven.send("actor-created", { actor: actorRef(4), name: "a4" });
    expect(driven.run.unlistedByPhase).toEqual([
      { phaseName: "p2", actors: 1, actorsSettled: 1, settled: 1 },
      { phaseName: "p1", actors: 1, actorsSettled: 1, actorsFailed: 1, settled: 1 },
    ]);
    expect(driven.run.usage).toMatchObject({ nodesUnlisted: 2, nodesUnlistedSettled: 2 });
  });

  it("没有阶段戳的实例进**无阶段**那一格", () => {
    const driven = driver({ maxActors: 2, maxNodes: 6, maxPhases: 2 });
    runOneAsk(driven, 1);
    runOneAsk(driven, 2, { settle: false });
    driven.send("actor-created", { actor: actorRef(3), name: "a3" });
    expect(driven.run.unlistedByPhase).toEqual([{ actors: 1, actorsSettled: 1, settled: 1 }]);
  });

  it("阶段格满了丢归属，run 级计数照旧准", () => {
    const driven = driver({ maxActors: 2, maxNodes: 8, maxPhases: 1 });
    runOneAsk(driven, 1, { phaseName: "p1" });
    runOneAsk(driven, 2, { phaseName: "p2" });
    driven.send("actor-created", { actor: actorRef(3), name: "a3" });
    runOneAsk(driven, 4, { phaseName: "p3" });
    driven.send("actor-created", { actor: actorRef(5), name: "a5" });
    driven.send("actor-created", { actor: actorRef(6), name: "a6" });
    const buckets = driven.run.unlistedByPhase!;
    expect(buckets).toHaveLength(2);
    const attributed = buckets.reduce((sum, bucket) => sum + bucket.settled, 0);
    expect(attributed).toBeLessThan(driven.run.usage.nodesUnlistedSettled!);
    expect(driven.run.usage).toMatchObject({ nodesUnlisted: 3, nodesUnlistedSettled: 3 });
  });

  it("一条都没被拒 / 淘汰过的 run 一个新键都不多", () => {
    const driven = driver({ maxActors: 6, maxNodes: 6, maxPhases: 2 });
    runOneAsk(driven, 1, { phaseName: "p1" });
    expect(driven.run).not.toHaveProperty("unlistedByPhase");
    expect(driven.run.usage).not.toHaveProperty("nodesUnlisted");
    expect(driven.run).not.toHaveProperty("truncated");
  });

  it("产出始终过 schema（unlistedByPhase 是协议线上的键）", () => {
    const driven = driver({ maxActors: 2, maxNodes: 4, maxPhases: 2 });
    runOneAsk(driven, 1, { phaseName: "p1" });
    runOneAsk(driven, 2, { phaseName: "p2", outcome: "failed" });
    driven.send("actor-created", { actor: actorRef(3), name: "a3" });
    expect(workflowRunsStateSchema.safeParse(driven.state).success).toBe(true);
  });
});

describe("2.5 resume：溢出过的 run 从空表重开", () => {
  it("truncated 的 run 在 run-started 后清空两张表并摘掉 unlistedByPhase", () => {
    const driven = driver({ maxActors: 2, maxNodes: 4, maxPhases: 2 });
    driven.send("run-started", {});
    runOneAsk(driven, 1, { phaseName: "p1" });
    runOneAsk(driven, 2, { phaseName: "p1", settle: false });
    driven.send("actor-created", { actor: actorRef(3), name: "a3" });
    expect(driven.run.truncated).toBe(true);
    expect(driven.run.unlistedByPhase).toBeDefined();

    driven.send("run-started", {});
    expect(driven.run.actors).toEqual([]);
    expect(driven.run.nodes).toEqual([]);
    expect(driven.run).not.toHaveProperty("unlistedByPhase");
    expect(driven.run.usage).toEqual({ spentTokens: 0, nodesUsed: 0 });
  });

  it("没溢出过的 run 照旧留着两张表（普通 resume 的历史不该被抹掉）", () => {
    const driven = driver({ maxActors: 6, maxNodes: 6, maxPhases: 2 });
    driven.send("run-started", {});
    runOneAsk(driven, 1);
    const actors = driven.run.actors;
    const nodes = driven.run.nodes;
    driven.send("run-started", {});
    expect(driven.run.actors).toBe(actors);
    expect(driven.run.nodes).toBe(nodes);
  });

  it("两世之后总数不翻倍：新一世每条实例只被列或只被计一次", () => {
    const driven = driver({ maxActors: 2, maxNodes: 2, maxPhases: 2 });
    driven.send("run-started", {});
    runOneAsk(driven, 1);
    runOneAsk(driven, 2);
    runOneAsk(driven, 3, { settle: false });
    const firstLife = workflowRunStepCounts(driven.run);
    expect(firstLife.total).toBe(3);

    driven.send("run-started", {});
    driven.send("actor-created", { actor: actorRef(1), name: "a1" });
    driven.send("node-settled", {
      instance: askRef(1),
      actor: actorRef(1),
      outcome: "ok",
      cached: true,
    });
    driven.send("actor-created", { actor: actorRef(2), name: "a2" });
    driven.send("node-settled", {
      instance: askRef(2),
      actor: actorRef(2),
      outcome: "ok",
      cached: true,
    });
    runOneAsk(driven, 3, { settle: false });
    expect(workflowRunStepCounts(driven.run).total).toBe(3);
    expect(workflowRunStepCounts(driven.run).settled).toBe(2);
  });
});

describe("B2 溢出之后，认不出主人的 queued 不上表", () => {
  it("truncated 的 run 里 actor 不在表上的 node-queued 被拒——哪怕节点表还空着", () => {
    const driven = driver({ maxActors: 1, maxNodes: 6, maxPhases: 2 });
    runOneAsk(driven, 1, { settle: false });
    driven.send("actor-created", { actor: actorRef(2), name: "a2" });
    expect(driven.run.truncated).toBe(true);
    const before = nodeKeys(driven.run);

    driven.send("node-queued", { instance: askRef(2), kind: "ask", actor: actorRef(2) });
    expect(nodeKeys(driven.run)).toEqual(before);
    expect(driven.run.usage).toMatchObject({ nodesUnlisted: 1 });
  });

  it("游离节点不受这条规则约束（world-read 本来就没有主人）", () => {
    const driven = driver({ maxActors: 1, maxNodes: 6, maxPhases: 2 });
    runOneAsk(driven, 1, { settle: false });
    driven.send("actor-created", { actor: actorRef(2), name: "a2" });
    driven.send("node-queued", { instance: worldRef(1), kind: "world-read" });
    expect(nodeKeys(driven.run)).toContain("world#1");
  });

  it("界之下照旧：没溢出过的 run 里这条 queued 正常上表", () => {
    const driven = driver({ maxActors: 6, maxNodes: 6, maxPhases: 2 });
    driven.send("node-queued", { instance: askRef(2), kind: "ask", actor: actorRef(2) });
    expect(nodeKeys(driven.run)).toEqual(["ask#2"]);
    expect(driven.run).not.toHaveProperty("truncated");
  });
});

describe("B3 派发即入座", () => {
  
  function incident(driven: ReturnType<typeof driver>, agents: number): void {
    for (let index = 1; index <= agents; index += 1) {
      driven.send(
        "actor-created",
        { actor: actorRef(index), name: `a${index}`, phaseName: "p1" },
        { actorSessionId: `sess-${index}` },
      );
    }
    for (let index = 1; index <= agents; index += 1) {
      driven.send("node-queued", {
        instance: askRef(index),
        kind: "ask",
        actor: actorRef(index),
        phaseName: "p1",
        instructionsHead: `do ${index}`,
      });
    }
  }

  it("被拒的子代理在**被派活的那一刻**连人带活回到表上", () => {
    const driven = driver({ maxActors: 2, maxNodes: 2, maxPhases: 2 });
    incident(driven, 3);
    expect(actorKeys(driven.run)).toEqual(["actor#1", "actor#2"]);
    expect(nodeKeys(driven.run)).toEqual(["ask#1", "ask#2"]);
    expect(driven.run.usage).toMatchObject({ nodesUnlisted: 1 });

    dispatchWithFacts(driven, 1, { phaseName: "p1", instructionsHead: "do 1" });
    driven.send("node-settled", { instance: askRef(1), outcome: "ok" });
    dispatchWithFacts(driven, 2, { phaseName: "p1", instructionsHead: "do 2" });
    driven.send("node-settled", { instance: askRef(2), outcome: "ok" });

    dispatchWithFacts(driven, 3, { phaseName: "p1", instructionsHead: "do 3" });
    expect(actorKeys(driven.run)).toEqual(["actor#2", "actor#3"]);
    expect(driven.run.actors.at(-1)).toEqual({
      siteId: "actor#3",
      ordinal: 1,
      name: "a3",
      sessionId: "sess-3",
      status: "waiting",
      phaseName: "p1",
    });
    expect(driven.run.nodes.at(-1)).toMatchObject({
      siteId: "ask#3",
      kind: "ask",
      phase: "dispatched",
      actorSiteId: "actor#3",
      actorOrdinal: 1,
      phaseName: "p1",
      instructionsHead: "do 3",
    });
    expect(workflowRunStepCounts(driven.run)).toEqual({ total: 3, settled: 2 });
  });

  it("只缺 actor 位时已完成组先于空闲组让位", () => {
    const driven = driver({ maxActors: 3, maxNodes: 4, maxPhases: 2 });
    incident(driven, 4);
    dispatchWithFacts(driven, 1, { phaseName: "p1", instructionsHead: "do 1" });
    driven.send("node-settled", { instance: askRef(1), outcome: "ok" });

    dispatchWithFacts(driven, 4, { phaseName: "p1", instructionsHead: "do 4" });
    expect(actorKeys(driven.run)).toEqual(["actor#2", "actor#3", "actor#4"]);
  });

  it("只剩空闲组时让位的是**表内最靠后**的那个（FIFO 下它最后才轮到）", () => {
    const driven = driver({ maxActors: 3, maxNodes: 6, maxPhases: 2 });
    incident(driven, 4);
    expect(actorKeys(driven.run)).toEqual(["actor#1", "actor#2", "actor#3"]);

    dispatchWithFacts(driven, 4, { phaseName: "p1", instructionsHead: "do 4" });
    expect(actorKeys(driven.run)).toEqual(["actor#1", "actor#2", "actor#4"]);
    expect(nodeKeys(driven.run)).toEqual(["ask#1", "ask#2", "ask#4"]);
    expect(driven.run.usage.nodesUnlisted).toBe(1);
    expect(driven.run.usage.nodesUnlistedSettled).toBeUndefined();
  });

  it("只缺节点位时先淘汰已结算的游离节点", () => {
    const driven = driver({ maxActors: 2, maxNodes: 2, maxPhases: 2 });
    driven.send("actor-created", { actor: actorRef(1), name: "a1" });
    driven.send("actor-created", { actor: actorRef(2), name: "a2" });
    driven.send("node-queued", { instance: worldRef(1), kind: "world-read" });
    driven.send("node-queued", { instance: askRef(1), kind: "ask", actor: actorRef(1) });
    driven.send("node-queued", { instance: askRef(2), kind: "ask", actor: actorRef(2) });
    expect(nodeKeys(driven.run)).toEqual(["world#1", "ask#1"]);
    driven.send("node-settled", { instance: worldRef(1), outcome: "ok" });

    dispatchWithFacts(driven, 2);
    expect(nodeKeys(driven.run)).toEqual(["ask#1", "ask#2"]);
    expect(actorKeys(driven.run)).toEqual(["actor#1", "actor#2"]);
    expect(driven.run.usage).toMatchObject({ nodesUnlisted: 1, nodesUnlistedSettled: 1 });
  });

  it("只缺节点位时，先丢自己名下最老的那条已结算节点（actor 留着，徽章就留着）", () => {
    const driven = driver({ maxActors: 2, maxNodes: 2, maxPhases: 2 });
    driven.send("actor-created", { actor: actorRef(1), name: "a1" });
    driven.send("actor-created", { actor: actorRef(2), name: "a2" });
    driven.send("node-queued", { instance: askRef(1), kind: "ask", actor: actorRef(1) });
    driven.send("node-settled", { instance: askRef(1), outcome: "ok" });
    driven.send("node-queued", { instance: askRef(2), kind: "ask", actor: actorRef(2) });
    const second = { siteId: "ask#1", ordinal: 2 };
    driven.send("node-queued", { instance: second, kind: "ask", actor: actorRef(1) });
    expect(nodeKeys(driven.run)).toEqual(["ask#1", "ask#2"]);

    dispatchWithFacts(driven, 1, { instance: second });
    expect(actorKeys(driven.run)).toEqual(["actor#1", "actor#2"]);
    expect(driven.run.nodes.map((node) => `${node.siteId}#${node.ordinal}`)).toEqual([
      "ask#2#1",
      "ask#1#2",
    ]);
    expect(driven.run.usage).toMatchObject({ nodesUnlisted: 1, nodesUnlistedSettled: 1 });
    expect(driven.run.unlistedByPhase).toEqual([{ actors: 0, settled: 1 }]);
  });

  it("自己那个**组**仍然绝不当受害者：没有自己的已结算节点可丢时才动别人", () => {
    const driven = driver({ maxActors: 2, maxNodes: 2, maxPhases: 2 });
    driven.send("actor-created", { actor: actorRef(1), name: "a1" });
    driven.send("actor-created", { actor: actorRef(2), name: "a2" });
    driven.send("node-queued", { instance: askRef(1), kind: "ask", actor: actorRef(1) });
    driven.send("node-queued", { instance: askRef(2), kind: "ask", actor: actorRef(2) });
    const second = { siteId: "ask#1", ordinal: 2 };
    driven.send("node-queued", { instance: second, kind: "ask", actor: actorRef(1) });

    dispatchWithFacts(driven, 1, { instance: second });
    expect(actorKeys(driven.run)).toEqual(["actor#1"]);
    expect(driven.run.nodes.map((node) => `${node.siteId}#${node.ordinal}`)).toEqual([
      "ask#1#1",
      "ask#1#2",
    ]);
  });

  it("在跑的组永远不是受害者：腾不出位就照旧拒新", () => {
    const driven = driver({ maxActors: 1, maxNodes: 1, maxPhases: 2 });
    runOneAsk(driven, 1, { settle: false });
    driven.send("actor-created", { actor: actorRef(2), name: "a2" });
    driven.send("node-queued", { instance: askRef(2), kind: "ask", actor: actorRef(2) });
    const before = driven.run.usage.nodesUnlisted;

    dispatchWithFacts(driven, 2);
    expect(actorKeys(driven.run)).toEqual(["actor#1"]);
    expect(nodeKeys(driven.run)).toEqual(["ask#1"]);
    expect(driven.run.usage.nodesUnlisted).toBe(before);
  });

  it("最后一档：一张全是零节点 actor 的表也腾得出位（resume 的形状）", () => {
    const driven = driver({ maxActors: 3, maxNodes: 2, maxPhases: 2 });
    driven.send("node-queued", { instance: worldRef(1), kind: "world-read", phaseName: "p1" });
    driven.send("node-queued", { instance: worldRef(2), kind: "world-read", phaseName: "p1" });
    driven.send("node-queued", { instance: worldRef(3), kind: "world-read", phaseName: "p1" });
    expect(driven.run.truncated).toBe(true);
    driven.send("node-settled", { instance: worldRef(1), outcome: "ok" });

    for (const index of [1, 2, 3]) {
      driven.send(
        "actor-created",
        { actor: actorRef(index), name: `a${index}`, phaseName: "p1" },
        { actorSessionId: `sess-${index}` },
      );
    }
    expect(actorKeys(driven.run)).toEqual(["actor#1", "actor#2", "actor#3"]);
    for (const actor of driven.run.actors) expect(nodesOfActor(driven.run, actor)).toEqual([]);

    driven.send(
      "actor-created",
      { actor: actorRef(4), name: "a4", phaseName: "p1" },
      { actorSessionId: "sess-4" },
    );
    expect(driven.run.unlistedByPhase).toEqual([{ phaseName: "p1", actors: 1, settled: 0 }]);

    dispatchWithFacts(driven, 4, { phaseName: "p1", instructionsHead: "do 4" });
    expect(actorKeys(driven.run)).toEqual(["actor#1", "actor#2", "actor#4"]);
    expect(driven.run.nodes.at(-1)).toMatchObject({
      siteId: "ask#4",
      phase: "dispatched",
      actorSiteId: "actor#4",
    });
    expect(driven.run.unlistedByPhase).toEqual([{ phaseName: "p1", actors: 1, settled: 1 }]);

    driven.send("node-settled", { instance: askRef(4), outcome: "ok" });
    dispatchWithFacts(driven, 3, { phaseName: "p1", instructionsHead: "do 3" });
    expect(actorKeys(driven.run)).toContain("actor#3");
  });

  it("不带事实的 dispatch 照老样子（旧 journal、world-read 的派发）", () => {
    const driven = driver({ maxActors: 2, maxNodes: 2, maxPhases: 2 });
    incident(driven, 3);
    driven.send("node-dispatched", { instance: askRef(3) });
    expect(actorKeys(driven.run)).toEqual(["actor#1", "actor#2"]);
    expect(nodeKeys(driven.run)).toEqual(["ask#1", "ask#2"]);
  });

  it("重放的 dispatch 不入座：水位没抬过", () => {
    const driven = driver({ maxActors: 2, maxNodes: 2, maxPhases: 2 });
    incident(driven, 3);
    const stale: WorkflowRunProgressEnvelope = {
      runId: RUN_ID,
      toolCallId: "tc-1",
      sequence: 0,
      eventType: "node-dispatched",
      payload: { instance: askRef(3), kind: "ask", actor: actorRef(3), actorName: "a3" },
      actorSessionId: "sess-3",
    };
    expect(driven.replay(stale)).toBeNull();
  });

  it("界之下不凭空造 actor：没溢出过的 run 照旧只落节点", () => {
    const driven = driver({ maxActors: 6, maxNodes: 6, maxPhases: 2 });
    dispatchWithFacts(driven, 1, { phaseName: "p1" });
    expect(driven.run.actors).toEqual([]);
    expect(nodeKeys(driven.run)).toEqual(["ask#1"]);
  });

  it("两次 ask 之间被淘汰的子代理，在下一次派发时拿回自己的徽章", () => {
    const driven = driver({ maxActors: 2, maxNodes: 3, maxPhases: 2 });
    driven.send(
      "actor-created",
      { actor: actorRef(1), name: "a1", phaseName: "p1" },
      { actorSessionId: "sess-1" },
    );
    driven.send("node-queued", { instance: askRef(1), kind: "ask", actor: actorRef(1) });
    driven.send("node-dispatched", { instance: askRef(1) });
    driven.send("node-settled", { instance: askRef(1), outcome: "ok" });
    driven.send("actor-created", { actor: actorRef(2), name: "a2" });
    driven.send("node-queued", { instance: askRef(2), kind: "ask", actor: actorRef(2) });
    driven.send("node-dispatched", { instance: askRef(2) });
    driven.send("actor-created", { actor: actorRef(3), name: "a3" });
    driven.send("node-queued", { instance: askRef(3), kind: "ask", actor: actorRef(3) });
    expect(actorKeys(driven.run)).toEqual(["actor#2", "actor#3"]);

    const second = { siteId: "ask#1", ordinal: 2 };
    driven.send("node-queued", { instance: second, kind: "ask", actor: actorRef(1) });
    dispatchWithFacts(driven, 1, { instance: second, phaseName: "p1" });
    expect(driven.run.actors.at(-1)).toEqual({
      siteId: "actor#1",
      ordinal: 1,
      name: "a1",
      sessionId: "sess-1",
      status: "waiting",
      phaseName: "p1",
    });
  });
});

describe("B4 表外的子代理也按出生阶段可数", () => {
  it("被拒的 actor-created 记一格 actors", () => {
    const driven = driver({ maxActors: 1, maxNodes: 4, maxPhases: 2 });
    runOneAsk(driven, 1, { phaseName: "p1", settle: false });
    driven.send("actor-created", { actor: actorRef(2), name: "a2", phaseName: "p2" });
    expect(driven.run.unlistedByPhase).toEqual([{ phaseName: "p2", actors: 1, settled: 0 }]);
  });

  it("空闲组让位只加 actors；回表的子代理把自己那一格减回去，归零即摘格", () => {
    const driven = driver({ maxActors: 2, maxNodes: 6, maxPhases: 4 });
    for (const index of [1, 2, 3]) {
      driven.send(
        "actor-created",
        { actor: actorRef(index), name: `a${index}`, phaseName: `p${index}` },
        { actorSessionId: `sess-${index}` },
      );
    }
    for (const index of [1, 2, 3]) {
      driven.send("node-queued", {
        instance: askRef(index),
        kind: "ask",
        actor: actorRef(index),
        phaseName: `p${index}`,
      });
    }
    expect(driven.run.unlistedByPhase).toEqual([{ phaseName: "p3", actors: 1, settled: 0 }]);

    dispatchWithFacts(driven, 3, { phaseName: "p3" });
    expect(driven.run.unlistedByPhase).toEqual([{ phaseName: "p2", actors: 1, settled: 0 }]);
    expect(driven.run.usage.nodesUnlistedSettled).toBeUndefined();
  });

  it("被拒的出生即结算节点：actor 不在表上时**只**记节点那一格", () => {
    const driven = driver({ maxActors: 1, maxNodes: 1, maxPhases: 4 });
    runOneAsk(driven, 1, { phaseName: "p1", settle: false });
    driven.send("actor-created", { actor: actorRef(2), name: "a2", phaseName: "p2" });
    driven.send("node-settled", {
      instance: askRef(2),
      actor: actorRef(2),
      outcome: "failed",
      cached: true,
      phaseName: "p2",
    });
    expect(driven.run.unlistedByPhase).toEqual([{ phaseName: "p2", actors: 1, settled: 1 }]);
  });

  it("每一格恒满足 actorsFailed ≤ actorsSettled ≤ actors（夹取是这一格的法律）", () => {
    const driven = driver({ maxActors: 1, maxNodes: 2, maxPhases: 4 });
    runOneAsk(driven, 1, { phaseName: "p1", outcome: "failed" });
    driven.send("actor-created", { actor: actorRef(2), name: "a2", phaseName: "p2" });
    expect(driven.run.unlistedByPhase).toEqual([
      { phaseName: "p1", actors: 1, actorsSettled: 1, actorsFailed: 1, settled: 1 },
    ]);

    driven.send("node-queued", { instance: askRef(2), kind: "ask", actor: actorRef(2) });
    const second = { siteId: "ask#1", ordinal: 2 };
    driven.send("node-queued", { instance: second, kind: "ask", actor: actorRef(1) });
    dispatchWithFacts(driven, 1, { phaseName: "p1", instance: second });
    expect(actorKeys(driven.run)).toEqual(["actor#1"]);

    expect(driven.run.unlistedByPhase).toEqual([
      { phaseName: "p1", actors: 0, settled: 1 },
      { phaseName: "p2", actors: 1, settled: 0 },
    ]);
    for (const bucket of driven.run.unlistedByPhase ?? []) {
      expect(bucket.actorsFailed ?? 0).toBeLessThanOrEqual(bucket.actorsSettled ?? 0);
      expect(bucket.actorsSettled ?? 0).toBeLessThanOrEqual(bucket.actors);
    }
  });
});

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

interface GeneratedStream {
  envelopes: WorkflowRunProgressEnvelope[];
  
  born: Set<string>;
  
  settled: Set<string>;
}

function generateLife(seed: number, agents: number): GeneratedStream {
  const random = rng(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const envelopes: WorkflowRunProgressEnvelope[] = [];
  const born = new Set<string>();
  const settled = new Set<string>();
  let sequence = -1;
  const emit = (eventType: string, payload: Record<string, unknown>) => {
    sequence += 1;
    const envelope: WorkflowRunProgressEnvelope = {
      runId: RUN_ID,
      toolCallId: "tc-1",
      sequence,
      eventType,
      payload,
    };
    envelopes.push(envelope);
    return envelope;
  };
  const phases = ["p1", "p2", "p3", "p4"];
  emit("run-started", {});
  for (let index = 1; index <= agents; index += 1) {
    const phaseName = pick(phases);
    if (random() < 0.2) emit("phase-entered", { name: phaseName, ordinal: 1 });
    if (random() < 0.25) {
      const world = worldRef(index);
      const worldKey = `${world.siteId}\u0000${world.ordinal}`;
      if (random() < 0.5) {
        emit("node-settled", { instance: world, outcome: "ok", cached: true, phaseName });
      } else {
        emit("node-queued", { instance: world, kind: "world-read", phaseName });
        emit("node-settled", { instance: world, outcome: "ok" });
      }
      born.add(worldKey);
      settled.add(worldKey);
    }
    emit("actor-created", { actor: actorRef(index), name: `a${index}`, phaseName });
    const asks = 1 + Math.floor(random() * 3);
    for (let ask = 0; ask < asks; ask += 1) {
      const instance = { siteId: `ask#${index}`, ordinal: ask };
      const key = `${instance.siteId}\u0000${instance.ordinal}`;
      if (random() < 0.2) {
        emit("node-settled", {
          instance,
          actor: actorRef(index),
          outcome: "ok",
          cached: true,
          phaseName,
        });
        born.add(key);
        settled.add(key);
        continue;
      }
      const queued = emit("node-queued", {
        instance,
        kind: "ask",
        actor: actorRef(index),
        phaseName,
      });
      born.add(key);
      emit("node-dispatched", { instance });
      emit("node-executing", { instance });
      if (random() < 0.15) envelopes.push(queued);
      if (random() < 0.85) {
        emit("node-settled", { instance, outcome: pick(["ok", "ok", "failed", "cancelled"]) });
        settled.add(key);
      }
    }
  }
  return { envelopes, born, settled };
}

const entryKey = (entry: { siteId: string; ordinal: number }) =>
  `${entry.siteId}\u0000${entry.ordinal}`;
const nodeKeySet = (run: WorkflowRunState) => new Set(run.nodes.map(entryKey));
const actorKeySet = (run: WorkflowRunState) => new Set(run.actors.map(entryKey));
const nodesOfActor = (run: WorkflowRunState, actor: { siteId: string; ordinal: number }) =>
  run.nodes.filter(
    (node) => node.actorSiteId === actor.siteId && node.actorOrdinal === actor.ordinal,
  );

interface ReducedStep {
  prior: WorkflowRunsState | undefined;
  deltas: ConversationDelta[];
}

function expectCoalesceEquivalence(steps: readonly ReducedStep[], seed: number): void {
  const random = rng(seed + 99);
  const tight = { maxActors: 1, maxNodes: 1 };
  let declined = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const from = Math.floor(random() * steps.length);
    const to = Math.min(steps.length, from + 1 + Math.floor(random() * 20));
    const window = steps.slice(from, to).flatMap((step) => step.deltas);
    const base = snapshotWith(steps[from]!.prior);
    const direct = applyConversationDeltas(base, window);
    for (const bounds of [undefined, tight]) {
      const merged = coalesceConversationDeltas(window, bounds);
      expect(JSON.stringify(applyConversationDeltas(base, merged).workflowRuns)).toBe(
        JSON.stringify(direct.workflowRuns),
      );
      if (bounds !== undefined && merged.length > 1) declined += 1;
    }
  }
  expect(declined).toBeGreaterThan(0);
}

describe("不变量 I1–I6（生成的单世事件流）", () => {
  for (const seed of [1, 7, 42, 1_337]) {
    it(`seed ${seed}：Boundary、淘汰对e、孤儿、总Count、幂等、归属都成立`, () => {
      const limits: WorkflowRunEntryLimits = { maxActors: 5, maxNodes: 7, maxPhases: 3 };
      const { envelopes, born, settled } = generateLife(seed, 24);
      let state: WorkflowRunsState | undefined;
      const everListed = new Set<string>();
      const steps: ReducedStep[] = [];

      for (const envelope of envelopes) {
        const next = reduceWorkflowRunsState(state, envelope, limits);
        if (next !== null) {
          expect(reduceWorkflowRunsState(next, envelope, limits)).toBeNull();
        }
        if (next === null) continue;
        const prior = state;
        const run = next.runs[0]!;

        expect(run.actors.length).toBeLessThanOrEqual(limits.maxActors);
        expect(run.nodes.length).toBeLessThanOrEqual(limits.maxNodes);

        if (prior !== undefined) {
          const priorRun = prior.runs[0]!;
          const keptNodes = nodeKeySet(run);
          const keptActors = actorKeySet(run);
          for (const node of priorRun.nodes) {
            if (keptNodes.has(entryKey(node))) continue;
            expect(node.phase).toBe("settled");
          }
          for (const actor of priorRun.actors) {
            if (keptActors.has(entryKey(actor))) continue;
            for (const node of nodesOfActor(priorRun, actor)) expect(node.phase).toBe("settled");
          }
        }

        for (const actor of run.actors) {
          const key = entryKey(actor);
          if (nodesOfActor(run, actor).length > 0) {
            everListed.add(key);
            continue;
          }
          expect(everListed.has(key)).toBe(false);
        }

        // actorsFailed ≤ actorsSettled ≤ actors。
        const attributed = (run.unlistedByPhase ?? []).reduce(
          (sum, bucket) => sum + bucket.settled,
          0,
        );
        expect(attributed).toBeLessThanOrEqual(run.usage.nodesUnlistedSettled ?? 0);
        for (const bucket of run.unlistedByPhase ?? []) {
          expect(bucket.actorsFailed ?? 0).toBeLessThanOrEqual(bucket.actorsSettled ?? 0);
          expect(bucket.actorsSettled ?? 0).toBeLessThanOrEqual(bucket.actors);
        }

        const deltas = diffWorkflowRunsState(prior, next);
        expect(deltas.some((delta) => delta.op === "state.updated")).toBe(false);
        for (const delta of deltas) {
          expect(conversationDeltaSchema.safeParse(delta).success).toBe(true);
        }
        const applied = applyConversationDeltas(snapshotWith(prior), deltas);
        expect(JSON.stringify(applied.workflowRuns)).toBe(JSON.stringify(next));
        expect(workflowRunsStateSchema.safeParse(next).success).toBe(true);
        steps.push({ prior, deltas });
        state = next;
      }

      const run = state!.runs[0]!;
      expect(run.nodes.length + (run.usage.nodesUnlisted ?? 0)).toBe(born.size);
      expect(workflowRunStepCounts(run)).toEqual({ total: born.size, settled: settled.size });

      let replayed: WorkflowRunsState | undefined;
      for (const envelope of envelopes) {
        replayed = reduceWorkflowRunsState(replayed, envelope, limits) ?? replayed;
      }
      expect(JSON.stringify(replayed)).toBe(JSON.stringify(state));

      expectCoalesceEquivalence(steps, seed);
    });
  }

  it("界之下的乱序投递一条都不丢：在线事件先开头、journal 前缀随后补齐", () => {
    const limits: WorkflowRunEntryLimits = { maxActors: 64, maxNodes: 64, maxPhases: 8 };
    const { envelopes, born } = generateLife(11, 10);
    const reduceSeq = (stream: readonly WorkflowRunProgressEnvelope[]) => {
      let state: WorkflowRunsState | undefined;
      for (const envelope of stream)
        state = reduceWorkflowRunsState(state, envelope, limits) ?? state;
      return state!.runs[0]!;
    };
    const inOrder = reduceSeq(envelopes);
    const seeded = reduceSeq([envelopes.at(-1)!, ...envelopes]);
    expect(inOrder.nodes).toHaveLength(born.size);
    expect(new Set(seeded.nodes.map(entryKey))).toEqual(new Set(inOrder.nodes.map(entryKey)));
    expect(new Set(seeded.actors.map(entryKey))).toEqual(new Set(inOrder.actors.map(entryKey)));
    expect(seeded).not.toHaveProperty("truncated");
    expect(seeded.usage).not.toHaveProperty("nodesUnlisted");
  });

  it("真实的界（1024）下也照样跑：小界不是规则的前提", () => {
    const { envelopes } = generateLife(3, 12);
    let state: WorkflowRunsState | undefined;
    for (const envelope of envelopes) {
      state = reduceWorkflowRunsState(state, envelope) ?? state;
    }
    const run = state!.runs[0]!;
    expect(run.actors.length).toBeLessThanOrEqual(WORKFLOW_RUNS_LIMITS.maxActors);
    expect(run).not.toHaveProperty("unlistedByPhase");
    expect(run).not.toHaveProperty("truncated");
  });
});

//
//

interface EngineAgent {
  index: number;
  phaseName: string;
  asks: number;
  
  done: number;
}

interface EngineShape {
  phases: number;
  agentsPerPhase: number;
  concurrency: number;
  
  cachedRate: number;
  
  cachedNamesActor: boolean;
  
  interruptAfter: number;
  
  maxAsks: number;
}

function generateEngineLife(seed: number, shape: EngineShape): WorkflowRunProgressEnvelope[] {
  const random = rng(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const envelopes: WorkflowRunProgressEnvelope[] = [];
  let sequence = -1;
  let worldNumber = 0;
  const emit = (
    eventType: string,
    payload: Record<string, unknown>,
    extra: Partial<WorkflowRunProgressEnvelope> = {},
  ): WorkflowRunProgressEnvelope => {
    sequence += 1;
    const envelope: WorkflowRunProgressEnvelope = {
      runId: RUN_ID,
      toolCallId: "tc-1",
      sequence,
      eventType,
      payload,
      ...extra,
    };
    envelopes.push(envelope);
    return envelope;
  };
  
  const maybeReplay = (envelope: WorkflowRunProgressEnvelope): void => {
    if (random() < 0.12) envelopes.push(envelope);
  };
  const askInstance = (agent: EngineAgent) => ({
    siteId: `ask#${agent.index}`,
    ordinal: agent.done,
  });
  const instructionsHead = (agent: EngineAgent) => `task ${agent.index}.${agent.done}`;
  
  const settleCached = (agent: EngineAgent, phaseName: string, imported: boolean): void => {
    const facts = shape.cachedNamesActor
      ? {
          kind: "ask",
          actor: actorRef(agent.index),
          actorSeq: agent.done,
          instructionsHead: instructionsHead(agent),
          ...(imported ? { sourceSessionId: `sess-a-${agent.index}` } : {}),
        }
      : {};
    maybeReplay(
      emit(
        "node-settled",
        { instance: askInstance(agent), outcome: "ok", cached: true, phaseName, ...facts },
        shape.cachedNamesActor ? { actorSessionId: `sess-${agent.index}` } : {},
      ),
    );
  };
  const queueAsk = (agent: EngineAgent): void => {
    maybeReplay(
      emit("node-queued", {
        instance: askInstance(agent),
        kind: "ask",
        actor: actorRef(agent.index),
        actorSeq: agent.done,
        phaseName: agent.phaseName,
        instructionsHead: instructionsHead(agent),
      }),
    );
  };
  const dispatchAsk = (agent: EngineAgent): void => {
    maybeReplay(
      emit(
        "node-dispatched",
        {
          instance: askInstance(agent),
          kind: "ask",
          actor: actorRef(agent.index),
          actorName: `a${agent.index}`,
          actorPhaseName: agent.phaseName,
          phaseName: agent.phaseName,
          instructionsHead: instructionsHead(agent),
        },
        { actorSessionId: `sess-${agent.index}` },
      ),
    );
    emit("node-executing", { instance: askInstance(agent) });
    if (random() < 0.4) {
      emit("node-progress", {
        instance: askInstance(agent),
        turn: 1,
        toolCalls: 1,
        lastTool: { name: "submit_result" },
      });
    }
  };
  const worldRead = (phaseName: string): void => {
    worldNumber += 1;
    const instance = worldRef(worldNumber);
    emit("node-queued", { instance, kind: "world-read", phaseName });
    emit("node-dispatched", { instance });
    emit("node-settled", { instance, outcome: "ok" });
  };
  
  const beginNextAsk = (agent: EngineAgent, queue: EngineAgent[]): void => {
    while (agent.done < agent.asks) {
      if (random() < shape.cachedRate) {
        settleCached(agent, agent.phaseName, true);
        agent.done += 1;
        continue;
      }
      queueAsk(agent);
      queue.push(agent);
      return;
    }
  };

  emit("run-started", {});
  let agentNumber = 0;
  let settles = 0;
  let interrupted = false;
  
  const roster: EngineAgent[][] = [];
  for (let phase = 1; phase <= shape.phases; phase += 1) {
    const phaseName = `p${phase}`;
    emit("phase-entered", { name: phaseName, ordinal: 1 });
    const agents: EngineAgent[] = [];
    roster.push(agents);
    for (let index = 0; index < shape.agentsPerPhase; index += 1) {
      agentNumber += 1;
      const agent: EngineAgent = {
        index: agentNumber,
        phaseName,
        asks: 1 + Math.floor(random() * shape.maxAsks),
        done: 0,
      };
      agents.push(agent);
      maybeReplay(
        emit(
          "actor-created",
          { actor: actorRef(agent.index), name: `a${agent.index}`, phaseName },
          { actorSessionId: `sess-${agent.index}` },
        ),
      );
    }
    const queue: EngineAgent[] = [];
    for (const agent of agents) beginNextAsk(agent, queue);
    const running: EngineAgent[] = [];
    while (queue.length > 0 || running.length > 0) {
      while (running.length < shape.concurrency && queue.length > 0) {
        const agent = queue.shift()!;
        dispatchAsk(agent);
        running.push(agent);
      }
      if (random() < 0.2) worldRead(phaseName);
      const agent = running.splice(Math.floor(random() * running.length), 1)[0]!;
      emit("node-settled", {
        instance: askInstance(agent),
        outcome: pick(["ok", "ok", "ok", "failed", "cancelled"]),
      });
      agent.done += 1;
      settles += 1;
      if (shape.interruptAfter > 0 && settles >= shape.interruptAfter) {
        interrupted = true;
        break;
      }
      beginNextAsk(agent, queue);
    }
    if (interrupted) break;
  }
  if (!interrupted) return envelopes;

  emit("run-started", {});
  for (const agents of roster) {
    const phaseName = agents[0]!.phaseName;
    emit("phase-entered", { name: phaseName, ordinal: 1 });
    for (const agent of agents) {
      maybeReplay(
        emit(
          "actor-created",
          { actor: actorRef(agent.index), name: `a${agent.index}`, phaseName },
          { actorSessionId: `sess-${agent.index}` },
        ),
      );
    }
    const queue: EngineAgent[] = [];
    for (const agent of agents) {
      const replayed = agent.done;
      agent.done = 0;
      for (; agent.done < replayed; agent.done += 1) settleCached(agent, phaseName, false);
      beginNextAsk(agent, queue);
    }
    const running: EngineAgent[] = [];
    while (queue.length > 0 || running.length > 0) {
      while (running.length < shape.concurrency && queue.length > 0) {
        const agent = queue.shift()!;
        dispatchAsk(agent);
        running.push(agent);
      }
      if (random() < 0.2) worldRead(phaseName);
      const agent = running.splice(Math.floor(random() * running.length), 1)[0]!;
      emit("node-settled", {
        instance: askInstance(agent),
        outcome: pick(["ok", "ok", "ok", "failed", "cancelled"]),
      });
      agent.done += 1;
      beginNextAsk(agent, queue);
    }
  }
  return envelopes;
}

function spareRoomFor(
  run: WorkflowRunState,
  instance: { siteId: string; ordinal: number },
  owner: { siteId: string; ordinal: number },
  limits: WorkflowRunEntryLimits,
): number {
  const ownerKey = entryKey(owner);
  let groups = 0;
  let zeroNode = 0;
  for (const actor of run.actors) {
    if (entryKey(actor) === ownerKey) continue;
    const owned = nodesOfActor(run, actor);
    if (owned.length === 0) {
      zeroNode += 1;
      continue;
    }
    if (owned.every((node) => node.phase === "settled" || node.phase === "queued")) groups += 1;
  }
  const needsActorSlot = !actorKeySet(run).has(ownerKey) && run.actors.length >= limits.maxActors;
  if (needsActorSlot) return groups + zeroNode;
  if (nodeKeySet(run).has(entryKey(instance)) || run.nodes.length < limits.maxNodes) return 1;
  let rows = 0;
  for (const node of run.nodes) {
    if (node.phase !== "settled") continue;
    const loose = node.actorSiteId === undefined;
    const own = node.actorSiteId === owner.siteId && node.actorOrdinal === owner.ordinal;
    if (loose || own) rows += 1;
  }
  return groups + rows;
}

interface EngineCase extends Omit<EngineShape, "cachedNamesActor"> {
  seed: number;
  limits: WorkflowRunEntryLimits;
}

const ENGINE_CASES: readonly EngineCase[] = [
  {
    seed: 2,
    phases: 2,
    agentsPerPhase: 12,
    concurrency: 3,
    cachedRate: 0,
    interruptAfter: 0,
    maxAsks: 3,
    limits: { maxActors: 6, maxNodes: 12, maxPhases: 3 },
  },
  {
    seed: 13,
    phases: 3,
    agentsPerPhase: 10,
    concurrency: 5,
    cachedRate: 0,
    interruptAfter: 0,
    maxAsks: 3,
    limits: { maxActors: 7, maxNodes: 9, maxPhases: 4 },
  },
  {
    seed: 71,
    phases: 2,
    agentsPerPhase: 30,
    concurrency: 13,
    cachedRate: 0,
    interruptAfter: 0,
    maxAsks: 3,
    limits: { maxActors: 20, maxNodes: 45, maxPhases: 3 },
  },
  {
    seed: 404,
    phases: 2,
    agentsPerPhase: 14,
    concurrency: 9,
    cachedRate: 0,
    interruptAfter: 0,
    maxAsks: 3,
    limits: { maxActors: 5, maxNodes: 7, maxPhases: 2 },
  },
  {
    seed: 909,
    phases: 3,
    agentsPerPhase: 9,
    concurrency: 6,
    cachedRate: 0.25,
    interruptAfter: 0,
    maxAsks: 3,
    limits: { maxActors: 8, maxNodes: 10, maxPhases: 4 },
  },
  {
    seed: 5_150,
    phases: 2,
    agentsPerPhase: 12,
    concurrency: 4,
    cachedRate: 0,
    interruptAfter: 8,
    maxAsks: 1,
    limits: { maxActors: 6, maxNodes: 8, maxPhases: 3 },
  },
];

describe("不变量 I1–I9（引擎形状：先建全部 actor、再入队、FIFO 派活）", () => {
  const CACHE_SHAPES = [
    { cachedNamesActor: true, label: "缓存结算带出生事实" },
    { cachedNamesActor: false, label: "老 journal：缓存结算不带 actor" },
  ] as const;
  const CASES = ENGINE_CASES.flatMap((engineCase) => {
    const cacheShapes =
      engineCase.cachedRate > 0 || engineCase.interruptAfter > 0
        ? CACHE_SHAPES
        : CACHE_SHAPES.slice(0, 1);
    return cacheShapes.map(({ cachedNamesActor, label }) => ({
      shape: { ...engineCase, cachedNamesActor },
      label,
    }));
  });
  for (const { shape, label } of CASES) {
    const { seed, limits } = shape;
    it(`seed ${seed}（Concurrency ${shape.concurrency} / actor Boundary ${limits.maxActors}，${label}）：两张账都对得上`, () => {
      const envelopes = generateEngineLife(seed, shape);
      let state: WorkflowRunsState | undefined;
      const bornNodes = new Set<string>();
      const settledNodes = new Set<string>();
      const bornAgents = new Set<string>();
      const everListed = new Set<string>();
      
      const live = new Map<string, string | null>();
      
      const homeless = new Set<string>();
      const steps: ReducedStep[] = [];
      let activations = 0;
      let truncatedAt = -1;

      for (const [step, envelope] of envelopes.entries()) {
        const priorRun = state?.runs[0];
        const advanced = envelope.sequence! > (priorRun?.lastEventSequence ?? -1);
        const payload = envelope.payload as Record<string, unknown>;
        const instance = payload.instance as { siteId: string; ordinal: number } | undefined;
        const actor = payload.actor as { siteId: string; ordinal: number } | undefined;

        const next = reduceWorkflowRunsState(state, envelope, limits);
        if (next !== null) {
          expect(reduceWorkflowRunsState(next, envelope, limits)).toBeNull();
        }
        const run = (next ?? state)!.runs[0]!;

        if (envelope.eventType === "run-started" && advanced) {
          bornNodes.clear();
          settledNodes.clear();
          bornAgents.clear();
          everListed.clear();
          live.clear();
          homeless.clear();
        }

        if (envelope.eventType === "actor-created" && actor !== undefined) {
          bornAgents.add(entryKey(actor));
        }
        if (instance !== undefined) {
          const key = entryKey(instance);
          if (envelope.eventType === "node-queued" || payload.cached === true) bornNodes.add(key);
          if (envelope.eventType === "node-settled") {
            settledNodes.add(key);
            live.delete(key);
          }
          if (envelope.eventType === "node-dispatched" && actor !== undefined) {
            live.set(key, entryKey(actor));
          }
        }

        expect(run.actors.length).toBeLessThanOrEqual(limits.maxActors);
        expect(run.nodes.length).toBeLessThanOrEqual(limits.maxNodes);

        if (priorRun !== undefined && envelope.eventType !== "run-started") {
          const keptNodes = nodeKeySet(run);
          const keptActors = actorKeySet(run);
          for (const node of priorRun.nodes) {
            if (keptNodes.has(entryKey(node))) continue;
            expect(["settled", "queued"]).toContain(node.phase);
          }
          for (const actor_ of priorRun.actors) {
            if (keptActors.has(entryKey(actor_))) continue;
            for (const node of nodesOfActor(priorRun, actor_)) {
              expect(["settled", "queued"]).toContain(node.phase);
            }
          }
        }

        for (const actor_ of run.actors) {
          const key = entryKey(actor_);
          if (nodesOfActor(run, actor_).length > 0) {
            everListed.add(key);
            continue;
          }
          expect(everListed.has(key)).toBe(false);
        }

        if (
          envelope.eventType === "node-dispatched" &&
          advanced &&
          instance !== undefined &&
          actor !== undefined
        ) {
          const nodeListed = nodeKeySet(run).has(entryKey(instance));
          const actorListed = actorKeySet(run).has(entryKey(actor));
          if (nodeListed && actorListed) {
            if (!nodeKeySet(priorRun ?? run).has(entryKey(instance))) activations += 1;
          } else {
            expect(spareRoomFor(priorRun!, instance, actor, limits)).toBe(0);
            homeless.add(entryKey(instance));
          }
        }

        for (const node of run.nodes) {
          if (node.actorSiteId === undefined || node.actorOrdinal === undefined) continue;
          expect(
            actorKeySet(run).has(
              entryKey({ siteId: node.actorSiteId, ordinal: node.actorOrdinal }),
            ),
          ).toBe(true);
        }

        const listedNodes = nodeKeySet(run);
        const listedActors = actorKeySet(run);
        for (const [key, owner] of live) {
          if (homeless.has(key)) continue;
          expect(listedNodes.has(key)).toBe(true);
          expect(listedActors.has(owner)).toBe(true);
        }

        for (const bucket of run.unlistedByPhase ?? []) {
          expect(bucket.actorsFailed ?? 0).toBeLessThanOrEqual(bucket.actorsSettled ?? 0);
          expect(bucket.actorsSettled ?? 0).toBeLessThanOrEqual(bucket.actors);
        }
        if (run.truncated === true && truncatedAt < 0) truncatedAt = step;
        const attributedActors = (run.unlistedByPhase ?? []).reduce(
          (sum, bucket) => sum + bucket.actors,
          0,
        );
        let unlistedAgents = 0;
        for (const key of bornAgents) if (!listedActors.has(key)) unlistedAgents += 1;
        expect(attributedActors).toBe(unlistedAgents);

        if (next === null) continue;
        const deltas = diffWorkflowRunsState(state, next);
        for (const delta of deltas) {
          expect(conversationDeltaSchema.safeParse(delta).success).toBe(true);
        }
        const applied = applyConversationDeltas(snapshotWith(state), deltas);
        expect(JSON.stringify(applied.workflowRuns)).toBe(JSON.stringify(next));
        expect(workflowRunsStateSchema.safeParse(next).success).toBe(true);
        steps.push({ prior: state, deltas });
        state = next;
      }

      const run = state!.runs[0]!;
      expect(truncatedAt).toBeGreaterThan(0);
      expect(activations).toBeGreaterThan(0);
      expect(run.nodes.length + (run.usage.nodesUnlisted ?? 0)).toBe(bornNodes.size);
      expect(workflowRunStepCounts(run)).toEqual({
        total: bornNodes.size,
        settled: settledNodes.size,
      });

      let replayed: WorkflowRunsState | undefined;
      for (const envelope of envelopes) {
        replayed = reduceWorkflowRunsState(replayed, envelope, limits) ?? replayed;
      }
      expect(JSON.stringify(replayed)).toBe(JSON.stringify(state));

      expectCoalesceEquivalence(steps, seed);
    });
  }
});

describe("子代理的模型", () => {
  it("actor-created 带 model 即落进条目；超界整个丢掉，不截断", () => {
    const driven = driver({ maxActors: 3, maxNodes: 3, maxPhases: 2 });
    driven.send("actor-created", { actor: actorRef(1), name: "a1", model: "zhipu/GLM-5.3$high" });
    driven.send("actor-created", {
      actor: actorRef(2),
      name: "a2",
      model: "x".repeat(WORKFLOW_RUNS_LIMITS.maxSubagentModelLength + 1),
    });
    driven.send("actor-created", { actor: actorRef(3), name: "a3" });
    expect(driven.run.actors.map((actor) => actor.model)).toEqual([
      "zhipu/GLM-5.3$high",
      undefined,
      undefined,
    ]);
    expect(workflowRunsStateSchema.safeParse(driven.state).success).toBe(true);
  });

  it("被拒的子代理在派发时回到表上，带着 actorModel", () => {
    const driven = driver({ maxActors: 2, maxNodes: 2, maxPhases: 2 });
    for (let index = 1; index <= 3; index += 1) {
      driven.send(
        "actor-created",
        {
          actor: actorRef(index),
          name: `a${index}`,
          phaseName: "p1",
          model: "zhipu/GLM-5.3-Flash",
        },
        { actorSessionId: `sess-${index}` },
      );
      driven.send("node-queued", {
        instance: askRef(index),
        kind: "ask",
        actor: actorRef(index),
        phaseName: "p1",
      });
    }
    expect(actorKeys(driven.run)).toEqual(["actor#1", "actor#2"]);
    dispatchWithFacts(driven, 1, { phaseName: "p1" });
    driven.send("node-settled", { instance: askRef(1), outcome: "ok" });
    dispatchWithFacts(driven, 2, { phaseName: "p1" });
    driven.send("node-settled", { instance: askRef(2), outcome: "ok" });

    driven.send(
      "node-dispatched",
      {
        instance: askRef(3),
        kind: "ask",
        actor: actorRef(3),
        actorName: "a3",
        actorPhaseName: "p1",
        actorPersonaModel: "GLM-5.3-Flash",
        actorModel: "zhipu/GLM-5.3-Flash",
        phaseName: "p1",
      },
      { actorSessionId: "sess-3" },
    );
    expect(driven.run.actors.at(-1)).toMatchObject({
      siteId: "actor#3",
      name: "a3",
      model: "zhipu/GLM-5.3-Flash",
    });
  });

  it("已在表上的子代理：派发不改写它的条目", () => {
    const driven = driver({ maxActors: 3, maxNodes: 3, maxPhases: 2 });
    driven.send("actor-created", { actor: actorRef(1), name: "a1", model: "zhipu/GLM-5.3" });
    driven.send("node-queued", { instance: askRef(1), kind: "ask", actor: actorRef(1) });
    driven.send("node-dispatched", {
      instance: askRef(1),
      kind: "ask",
      actor: actorRef(1),
      actorName: "a1",
    });
    expect(driven.run.actors[0]?.model).toBe("zhipu/GLM-5.3");
  });
});
