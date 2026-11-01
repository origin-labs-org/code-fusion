import { describe, expect, it } from "vitest";
import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  workflowRunActorsForLane,
  workflowRunOverlay,
} from "../src/components/workflow-graph/run-status.js";
import type { WorkflowCausalityGraphData } from "../src/components/workflow-graph/types.js";

const graph: WorkflowCausalityGraphData = {
  steps: [
    { id: "ask#1", kind: "ask", label: "plan", lane: "actor#1" },
    { id: "ask#2", kind: "ask", label: "write", lane: "actor#2" },
    { id: "world-read#1", kind: "world-read", label: "glob", lane: "workspace" },
  ],
  lanes: [{ id: "actor#1", name: "planner" }, { id: "actor#2" }, { id: "workspace" }],
  edges: [{ from: "ask#1", to: "ask#2" }],
};

function runWith(
  nodes: WorkflowRunState["nodes"],
  overrides: Partial<WorkflowRunState> = {},
): WorkflowRunState {
  return {
    runId: "dwfrun-1",
    status: "running",
    usage: { spentTokens: 0, nodesUsed: nodes.length },
    actors: [],
    nodes,
    lastEventSequence: nodes.length,
    ...overrides,
  };
}

describe("workflowRunOverlay E位映射", () => {
  it("executing / repairing / nudged All映射成 running", () => {
    for (const phase of ["executing", "repairing", "nudged"] as const) {
      const { statuses } = workflowRunOverlay(
        runWith([{ siteId: "ask#1", ordinal: 1, phase }]),
        graph,
      );
      expect(statuses["ask#1"]).toBe("running");
    }
  });

  it("queued / dispatched / waiting Yes pending：还没有Request在 provider 那里Run", () => {
    for (const phase of ["queued", "dispatched", "waiting"] as const) {
      const { statuses } = workflowRunOverlay(
        runWith([{ siteId: "ask#1", ordinal: 1, phase }]),
        graph,
      );
      expect(statuses["ask#1"]).toBe("pending");
    }
  });

  it("settled ok Yes done，cached Hit同样Yes done", () => {
    expect(
      workflowRunOverlay(
        runWith([{ siteId: "ask#1", ordinal: 1, phase: "settled", outcome: "ok" }]),
        graph,
      ).statuses["ask#1"],
    ).toBe("done");
    expect(
      workflowRunOverlay(
        runWith([{ siteId: "ask#1", ordinal: 1, phase: "settled", outcome: "ok", cached: true }]),
        graph,
      ).statuses["ask#1"],
    ).toBe("done");
  });

  it("settled failed 与 settled cancelled 都Yes failed", () => {
    for (const outcome of ["failed", "cancelled"] as const) {
      const { statuses } = workflowRunOverlay(
        runWith([{ siteId: "ask#1", ordinal: 1, phase: "settled", outcome }]),
        graph,
      );
      expect(statuses["ask#1"]).toBe("failed");
    }
  });

  it("没有Instance的 step 没有条目：缺席不YesStatus，不写成 pending", () => {
    const { statuses } = workflowRunOverlay(runWith([]), graph);
    expect(statuses).toEqual({});
    expect(
      workflowRunOverlay(
        runWith([{ siteId: "ask#1", ordinal: 1, phase: "settled", outcome: "ok" }]),
        graph,
      ).statuses,
    ).toEqual({ "ask#1": "done" });
  });

  it("无 run（静态渲染）时不产出任何Status", () => {
    expect(workflowRunOverlay(undefined, graph)).toEqual({ statuses: {}, animatedEdges: false });
  });
});

describe("workflowRunOverlay Instance聚合（叠加View必须坍缩）", () => {
  it("running 优先于 failed：读者First questionYes「还在动吗」", () => {
    const { statuses } = workflowRunOverlay(
      runWith([
        { siteId: "ask#2", ordinal: 3, phase: "settled", outcome: "failed" },
        { siteId: "ask#2", ordinal: 4, phase: "executing" },
      ]),
      graph,
    );
    expect(statuses["ask#2"]).toBe("running");
  });

  it("无 running 时任One failed 即 failed", () => {
    const { statuses } = workflowRunOverlay(
      runWith([
        { siteId: "ask#2", ordinal: 1, phase: "settled", outcome: "ok" },
        { siteId: "ask#2", ordinal: 2, phase: "settled", outcome: "failed" },
      ]),
      graph,
    );
    expect(statuses["ask#2"]).toBe("failed");
  });

  it("All结算且All ok 才Yes done", () => {
    const { statuses } = workflowRunOverlay(
      runWith([
        { siteId: "ask#2", ordinal: 1, phase: "settled", outcome: "ok" },
        { siteId: "ask#2", ordinal: 2, phase: "settled", outcome: "ok", cached: true },
      ]),
      graph,
    );
    expect(statuses["ask#2"]).toBe("done");
  });

  it("既有已结算又有Queued的InstanceYes running：Start了、没结束，既不谎报 done 也不谎报没Start", () => {
    const { statuses } = workflowRunOverlay(
      runWith([
        { siteId: "ask#2", ordinal: 1, phase: "settled", outcome: "ok" },
        { siteId: "ask#2", ordinal: 2, phase: "queued" },
      ]),
      graph,
    );
    expect(statuses["ask#2"]).toBe("running");
    expect(
      workflowRunOverlay(
        runWith([
          { siteId: "ask#2", ordinal: 1, phase: "settled", outcome: "failed" },
          { siteId: "ask#2", ordinal: 2, phase: "queued" },
        ]),
        graph,
      ).statuses["ask#2"],
    ).toBe("running");
  });

  it("All在Queued时才Yes pending", () => {
    const { statuses } = workflowRunOverlay(
      runWith([
        { siteId: "ask#2", ordinal: 1, phase: "queued" },
        { siteId: "ask#2", ordinal: 2, phase: "dispatched" },
      ]),
      graph,
    );
    expect(statuses["ask#2"]).toBe("pending");
  });

  it("不认识的 site id 被Ignore（Run期图的节点集合绝不变化）", () => {
    const { statuses } = workflowRunOverlay(
      runWith([{ siteId: "ask#99", ordinal: 1, phase: "executing" }]),
      graph,
    );
    expect(statuses).toEqual({});
  });
});

describe("workflowRunOverlay animatedEdges", () => {
  it("有 step 在Run时开启边动画", () => {
    expect(
      workflowRunOverlay(runWith([{ siteId: "ask#1", ordinal: 1, phase: "executing" }]), graph)
        .animatedEdges,
    ).toBe(true);
  });

  it("只有 settled 节点时Close边动画", () => {
    expect(
      workflowRunOverlay(
        runWith([{ siteId: "ask#1", ordinal: 1, phase: "settled", outcome: "ok" }], {
          status: "completed",
        }),
        graph,
      ).animatedEdges,
    ).toBe(false);
  });
});

const expandedGraph: WorkflowCausalityGraphData = {
  steps: [
    {
      id: "ask#1~actor#1",
      source: "ask#1",
      kind: "ask",
      label: "ask",
      lane: "actor#1",
      lanes: ["actor#1", "actor#2"],
      repeat: "serial",
    },
    {
      id: "ask#1~actor#2",
      source: "ask#1",
      kind: "ask",
      label: "ask",
      lane: "actor#2",
      lanes: ["actor#1", "actor#2"],
      repeat: "serial",
    },
    { id: "ask#2", kind: "ask", label: "judge", lane: "actor#3" },
  ],
  lanes: [{ id: "actor#1", name: "black" }, { id: "actor#2", name: "white" }, { id: "actor#3" }],
  edges: [{ from: "ask#1~actor#1", to: "ask#1~actor#2", back: true }],
};

describe("workflowRunOverlay 展开拷贝的R道路由", () => {
  it("某One候选R道上的Instance只点亮该候选的拷贝", () => {
    const { statuses } = workflowRunOverlay(
      runWith([{ siteId: "ask#1", ordinal: 1, phase: "executing", actorSiteId: "actor#1" }]),
      expandedGraph,
    );
    expect(statuses["ask#1~actor#1"]).toBe("running");
    expect(statuses["ask#1~actor#2"]).toBeUndefined();
  });

  it("同One站点的两条R道各自聚合，互不串味", () => {
    const { statuses } = workflowRunOverlay(
      runWith([
        {
          siteId: "ask#1",
          ordinal: 1,
          phase: "settled",
          outcome: "failed",
          actorSiteId: "actor#1",
        },
        { siteId: "ask#1", ordinal: 2, phase: "executing", actorSiteId: "actor#2" },
      ]),
      expandedGraph,
    );
    expect(statuses["ask#1~actor#1"]).toBe("failed");
    expect(statuses["ask#1~actor#2"]).toBe("running");
  });

  it("actorSiteId 缺席的Instance聚合进该 source 的All拷贝（退化成Old单卡的过度点亮，不Yes死图）", () => {
    const { statuses } = workflowRunOverlay(
      runWith([{ siteId: "ask#1", ordinal: 1, phase: "executing" }]),
      expandedGraph,
    );
    expect(statuses["ask#1~actor#1"]).toBe("running");
    expect(statuses["ask#1~actor#2"]).toBe("running");
  });

  it("落在候选之outerR道的Instance不点亮任何拷贝（拷贝的R道就Yes它的All主张）", () => {
    const { statuses } = workflowRunOverlay(
      runWith([{ siteId: "ask#1", ordinal: 1, phase: "executing", actorSiteId: "actor#9" }]),
      expandedGraph,
    );
    expect(statuses["ask#1~actor#1"]).toBeUndefined();
    expect(statuses["ask#1~actor#2"]).toBeUndefined();
  });

  it("孤儿拷贝：Run时从未选Medium的候选在 run End局后仍无条目（画面上空心，Model上Yes缺席）", () => {
    const { animatedEdges, statuses } = workflowRunOverlay(
      runWith(
        [{ siteId: "ask#1", ordinal: 1, phase: "settled", outcome: "ok", actorSiteId: "actor#1" }],
        {
          status: "completed",
        },
      ),
      expandedGraph,
    );
    expect(statuses).toEqual({ "ask#1~actor#1": "done" });
    expect(animatedEdges).toBe(false);
  });

  it("拷贝 id 不Yes站点 id：按拷贝 id 关联的InstanceOne个也收不到", () => {
    const { statuses } = workflowRunOverlay(
      runWith([
        { siteId: "ask#1~actor#1", ordinal: 1, phase: "executing", actorSiteId: "actor#1" },
      ]),
      expandedGraph,
    );
    expect(statuses["ask#1~actor#1"]).toBeUndefined();
  });
});

describe("workflowRunOverlay Phase拷贝的Phase路由", () => {
  const NAMES = ["调研", "From草", "校对", "复核", "收尾"];
  const phasedGraph: WorkflowCausalityGraphData = {
    steps: NAMES.map((_, i) => ({
      id: `ask#1~phase#${i + 1}`,
      kind: "ask" as const,
      label: "review",
      lane: "actor#1",
      phase: `phase#${i + 1}`,
      source: "ask#1",
    })),
    lanes: [{ id: "actor#1", name: "worker" }],
    edges: [],
    phases: NAMES.map((name, i) => ({ id: `phase#${i + 1}`, name })),
  };
  const copies = (statuses: Record<string, string | undefined>) =>
    NAMES.map((_, i) => statuses[`ask#1~phase#${i + 1}`]);

  it("带戳的Instance只点亮出生Phase那份拷贝：第 1 Phase在Run、第 2 Phase已结算，其余无条目", () => {
    const { statuses } = workflowRunOverlay(
      runWith([
        {
          siteId: "ask#1",
          ordinal: 1,
          phase: "executing",
          actorSiteId: "actor#1",
          phaseName: "调研",
        },
        {
          siteId: "ask#1",
          ordinal: 2,
          phase: "executing",
          actorSiteId: "actor#1",
          phaseName: "调研",
        },
        {
          siteId: "ask#1",
          ordinal: 21,
          phase: "settled",
          outcome: "ok",
          actorSiteId: "actor#1",
          phaseName: "From草",
        },
      ]),
      phasedGraph,
    );
    expect(copies(statuses)).toEqual(["running", "done", undefined, undefined, undefined]);
  });

  it("无戳的 run 点亮All拷贝：Old CLI / Old run 的过度点亮逐Character节保持", () => {
    const { statuses } = workflowRunOverlay(
      runWith([{ siteId: "ask#1", ordinal: 1, phase: "executing", actorSiteId: "actor#1" }]),
      phasedGraph,
    );
    expect(copies(statuses)).toEqual(["running", "running", "running", "running", "running"]);
  });

  it("戳匹配不到任何 display Phase → All拷贝：宁可多亮也不把One个在Run的Instance藏From来", () => {
    const { statuses } = workflowRunOverlay(
      runWith([
        {
          siteId: "ask#1",
          ordinal: 1,
          phase: "executing",
          actorSiteId: "actor#1",
          phaseName: "别处",
        },
      ]),
      phasedGraph,
    );
    expect(copies(statuses)).toEqual(["running", "running", "running", "running", "running"]);
  });

  it("run 有词汇而Instance无戳 → 只落无名Phase；这张图没有无名Phase，于YesReturnedAll", () => {
    const { statuses } = workflowRunOverlay(
      runWith([
        {
          siteId: "ask#1",
          ordinal: 1,
          phase: "executing",
          actorSiteId: "actor#1",
          phaseName: "调研",
        },
        {
          siteId: "ask#1",
          ordinal: 2,
          phase: "settled",
          outcome: "failed",
          actorSiteId: "actor#1",
        },
      ]),
      phasedGraph,
    );
    expect(copies(statuses)).toEqual(["running", "failed", "failed", "failed", "failed"]);
  });
});

describe("workflowRunOverlay 不带 source 的 step 关联行为不变", () => {
  it("不做R道收窄：>4 候选回退的单卡在别的R道上Run也照常点亮", () => {
    const { statuses } = workflowRunOverlay(
      runWith([{ siteId: "ask#2", ordinal: 1, phase: "executing", actorSiteId: "actor#7" }]),
      expandedGraph,
    );
    expect(statuses["ask#2"]).toBe("running");
  });

  it("全无 source 的图上，带 actorSiteId 的Instance与Old行为逐Character节One致", () => {
    const nodes: WorkflowRunState["nodes"] = [
      { siteId: "ask#1", ordinal: 1, phase: "executing", actorSiteId: "actor#1" },
      { siteId: "ask#2", ordinal: 1, phase: "settled", outcome: "failed", actorSiteId: "actor#2" },
      { siteId: "world-read#1", ordinal: 1, phase: "settled", outcome: "ok" },
    ];
    expect(workflowRunOverlay(runWith(nodes), graph)).toEqual(
      workflowRunOverlay(
        runWith(nodes.map(({ actorSiteId: _actorSiteId, ...node }) => node)),
        graph,
      ),
    );
  });
});

describe("workflowRunActorsForLane", () => {
  const actors: WorkflowRunState["actors"] = [
    { siteId: "actor#2", ordinal: 2, status: "running", sessionId: "sess-b" },
    { siteId: "actor#2", ordinal: 1, status: "waiting", sessionId: "sess-a" },
    { siteId: "actor#1", ordinal: 1, status: "running", name: "planner", sessionId: "sess-p" },
  ];
  const run = runWith([], { actors });

  it("按R道 site id 过滤并按 ordinal 升序（fan-out R道族的选择器顺序稳定）", () => {
    expect(workflowRunActorsForLane(run, "actor#2").map((actor) => actor.ordinal)).toEqual([1, 2]);
  });

  it("单InstanceR道BackOne个 actor，其Session id 即 transcript 下钻的入口", () => {
    const resolved = workflowRunActorsForLane(run, "actor#1");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.sessionId).toBe("sess-p");
  });

  it("workspace / unknown 合成R道上没有Session，Back空", () => {
    expect(workflowRunActorsForLane(run, "workspace")).toEqual([]);
    expect(workflowRunActorsForLane(run, "unknown")).toEqual([]);
    expect(workflowRunActorsForLane(undefined, "actor#1")).toEqual([]);
  });
});
