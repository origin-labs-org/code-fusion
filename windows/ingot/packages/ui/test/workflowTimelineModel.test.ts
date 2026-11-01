import { describe, expect, it } from "vitest";
import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowCausalityGraphData } from "@/components/workflow-graph/types.js";
import {
  arcLaneCount,
  assignArcLanes,
  buildWorkflowTimeline,
} from "@/components/workflow-timeline/timeline-model.js";
import { pillActivity } from "@/components/workflow-timeline/timeline-pill-activity.js";

const STEPS: WorkflowCausalityGraphData["steps"] = [
  { id: "ask#1", kind: "ask", label: "plan", lane: "actor#1", phase: "phase#a" },
  {
    id: "world-read#1",
    kind: "world-read",
    label: "read files",
    lane: "workspace",
    phase: "phase#a",
  },
  { id: "ask#2", kind: "ask", label: "draft", lane: "actor#2", phase: "phase#b" },
  { id: "ask#3", kind: "ask", label: "verify", lane: "actor#3", phase: "phase#c" },
  { id: "ask#4", kind: "ask", label: "polish", lane: "actor#2", phase: "phase#c" },
];

function participantsOf(steps: readonly WorkflowCausalityGraphData["steps"][number][]) {
  const byId = new Map<string, { id: string; phase: string; lane: string; steps: string[] }>();
  for (const step of steps) {
    const phase = step.phase ?? "unphased";
    const id = `${phase}:${step.lane}`;
    const existing = byId.get(id);
    if (existing) existing.steps.push(step.id);
    else byId.set(id, { id, lane: step.lane, phase, steps: [step.id] });
  }
  return [...byId.values()];
}

const GRAPH: WorkflowCausalityGraphData = {
  steps: STEPS,
  lanes: [
    { id: "actor#1", name: "planner" },
    { id: "actor#2", name: "writer" },
    { id: "actor#3" },
    { id: "workspace" },
  ],
  participants: participantsOf(STEPS),
  handoffs: [],
  phases: [
    { id: "phase#a", name: "plan" },
    { id: "phase#b", name: "draft" },
    { id: "phase#c", name: "verify" },
  ],
  phaseEdges: [
    { from: "phase#a", to: "phase#b" },
    { from: "phase#b", to: "phase#c" },
    { from: "phase#c", to: "phase#a" },
    { from: "phase#a", to: "phase#c" },
  ],
  exits: ["phase#c"],
};

function run(overrides: Partial<WorkflowRunState> = {}): WorkflowRunState {
  return {
    runId: "dwfrun-1",
    toolCallId: "tool-wf-1",
    status: "running",
    usage: { spentTokens: 0, nodesUsed: 0 },
    actors: [],
    nodes: [],
    lastEventSequence: 0,
    ...overrides,
  };
}

type Node = WorkflowRunState["nodes"][number];
function settled(siteId: string, ordinal = 1, extra: Partial<Node> = {}): Node {
  return { siteId, ordinal, phase: "settled", outcome: "ok", ...extra } as Node;
}
function executing(siteId: string, ordinal = 1, extra: Partial<Node> = {}): Node {
  return { siteId, ordinal, phase: "executing", ...extra } as Node;
}

describe("buildWorkflowTimeline · 站与边", () => {
  it("站按声明序（phases[] 顺序）OnePhaseOne站，不再分秩", () => {
    const model = buildWorkflowTimeline(GRAPH, undefined);
    expect(model.stations.map((station) => station.id)).toEqual(["phase#a", "phase#b", "phase#c"]);
    expect(model.stations.map((station) => station.naming.name)).toEqual([
      "plan",
      "draft",
      "verify",
    ]);
  });

  it("无Label记脚本合成One个隐式站，所有参与者都在它下面", () => {
    const flat: WorkflowCausalityGraphData = {
      steps: STEPS.map(({ phase: _phase, ...step }) => step),
      lanes: GRAPH.lanes,
      participants: participantsOf(STEPS.map(({ phase: _phase, ...step }) => step)),
      handoffs: [],
    };
    const model = buildWorkflowTimeline(flat, undefined);
    expect(model.stations).toHaveLength(1);
    expect(model.stations[0]!.naming.name).toBeUndefined();
    expect(model.stations[0]!.pills.map((pill) => pill.lane.id)).toEqual([
      "actor#1",
      "workspace",
      "actor#2",
      "actor#3",
    ]);
    expect(model.rails).toEqual([]);
    expect(model.arcs).toEqual([]);
  });

  it("E邻且有边的两站之间Yes轨道段；非E邻的边Yes弧，按方向分回边与跳段", () => {
    const model = buildWorkflowTimeline(GRAPH, undefined);
    expect(model.rails).toEqual([
      { from: 0, ink: "faint", to: 1 },
      { from: 1, ink: "faint", to: 2 },
    ]);
    expect(model.arcs).toEqual([
      { air: 0, from: 2, ink: "faint", lane: 0, to: 0 },
      { air: 0, from: 0, ink: "faint", lane: 1, to: 2 },
    ]);
  });

  it("弧的分道Yes区间着色：互不E干的同High，嵌套的里矮outerHigh，共用端点的也分开", () => {
    expect(
      assignArcLanes([
        { from: 3, to: 1 },
        { from: 5, to: 4 },
      ]).map((arc) => arc.lane),
    ).toEqual([0, 0]);
    expect(
      assignArcLanes([
        { from: 3, to: 2 },
        { from: 5, to: 0 },
      ]).map((arc) => arc.lane),
    ).toEqual([0, 1]);
    expect(
      assignArcLanes([
        { from: 3, to: 1 },
        { from: 5, to: 3 },
      ]).map((arc) => arc.lane),
    ).toEqual([0, 1]);
    const lanes = assignArcLanes([
      { from: 1, to: 0 },
      { from: 4, to: 3 },
      { from: 4, to: 0 },
    ]);
    expect(lanes.map((arc) => arc.lane)).toEqual([0, 0, 1]);
    expect(arcLaneCount(lanes)).toBe(2);
    expect(arcLaneCount([])).toBe(0);
  });

  it("只有回边（向Left的弧）的两端才Yes onLoop：跳段两端不Show轮次", () => {
    const skipOnly: WorkflowCausalityGraphData = {
      ...GRAPH,
      phaseEdges: [
        { from: "phase#a", to: "phase#b" },
        { from: "phase#a", to: "phase#c" },
      ],
    };
    expect(buildWorkflowTimeline(GRAPH, undefined).stations.map((s) => s.onLoop)).toEqual([
      true,
      false,
      true,
    ]);
    expect(buildWorkflowTimeline(skipOnly, undefined).stations.map((s) => s.onLoop)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("没有E邻边的两站之间没有轨道段（画面上留空，不Yes淡墨）", () => {
    const gapped: WorkflowCausalityGraphData = {
      ...GRAPH,
      phaseEdges: [{ from: "phase#a", to: "phase#c" }],
    };
    expect(buildWorkflowTimeline(gapped, undefined).rails).toEqual([]);
  });

  it("自环与Point to向未列出Phase的边在这One粒度上被Ignore；重复边只算One次", () => {
    const noisy: WorkflowCausalityGraphData = {
      ...GRAPH,
      phaseEdges: [
        { from: "phase#a", to: "phase#a" },
        { from: "phase#a", to: "phase#zz" },
        { from: "phase#a", to: "phase#b" },
        { from: "phase#a", to: "phase#b", back: true },
      ],
    };
    const model = buildWorkflowTimeline(noisy, undefined);
    expect(model.rails).toEqual([{ from: 0, ink: "faint", to: 1 }]);
    expect(model.arcs).toEqual([]);
  });

  it("无 run：站与药丸Status undefined、墨迹全淡、没有Run站、live=false", () => {
    const model = buildWorkflowTimeline(GRAPH, undefined);
    expect(model.live).toBe(false);
    expect(model.runningIndex).toBeUndefined();
    for (const station of model.stations) {
      expect(station.status).toBeUndefined();
      expect(station.visited).toBe(false);
      expect(station.rounds).toBe(0);
      expect(station.fraction).toBeUndefined();
      for (const pill of station.pills) expect(pill.status).toBeUndefined();
      for (const pill of station.pills) expect(pill.workspace).toBeUndefined();
    }
  });
});

describe("buildWorkflowTimeline · 投影叠加", () => {
  it("visited / rounds / fraction 从落在该站站点上的节点派生", () => {
    const model = buildWorkflowTimeline(
      GRAPH,
      run({
        nodes: [settled("ask#1"), settled("world-read#1"), settled("ask#1", 2), executing("ask#2")],
      }),
    );
    const [plan, draft, verify] = model.stations;
    expect(plan).toMatchObject({ visited: true, rounds: 2, fraction: { observed: 3, settled: 3 } });
    expect(draft).toMatchObject({
      visited: true,
      rounds: 1,
      fraction: { observed: 1, settled: 0 },
      status: "running",
    });
    expect(verify).toMatchObject({ visited: false, rounds: 0 });
    expect(verify!.fraction).toBeUndefined();
    expect(model.live).toBe(true);
  });

  it("may-set 拷贝按 source 关联：拷贝站上报的Yes站点 id，漏掉 source 会让它永远「未到」", () => {
    const copied: WorkflowCausalityGraphData = {
      ...GRAPH,
      steps: [
        ...STEPS,
        {
          id: "ask#2~copy",
          kind: "ask",
          label: "draft",
          lane: "actor#3",
          phase: "phase#b",
          source: "ask#2",
        },
      ],
      participants: participantsOf([
        ...STEPS,
        {
          id: "ask#2~copy",
          kind: "ask",
          label: "draft",
          lane: "actor#3",
          phase: "phase#b",
          source: "ask#2",
        },
      ]),
    };
    const model = buildWorkflowTimeline(copied, run({ nodes: [settled("ask#2")] }));
    expect(model.stations[1]).toMatchObject({ visited: true, rounds: 1 });
  });

  it("Run站取最Right边的 running 站", () => {
    const model = buildWorkflowTimeline(
      GRAPH,
      run({ nodes: [executing("ask#1"), executing("ask#3")] }),
    );
    expect(model.runningIndex).toBe(2);
  });

  it("轨道段：两端都到过才Yes浓墨", () => {
    const model = buildWorkflowTimeline(
      GRAPH,
      run({ nodes: [settled("ask#1"), settled("ask#2")] }),
    );
    expect(model.rails.map((rail) => rail.ink)).toEqual(["strong", "faint"]);
  });

  it("回边：源到过且Target rounds ≥ 2 才Yes浓墨——走过One遍还没回头时仍Yes淡墨", () => {
    const once = buildWorkflowTimeline(
      GRAPH,
      run({ nodes: [settled("ask#1"), settled("ask#2"), settled("ask#3")] }),
    );
    expect(once.arcs.find((arc) => arc.to === 0)?.ink).toBe("faint");

    const twice = buildWorkflowTimeline(
      GRAPH,
      run({ nodes: [settled("ask#1"), settled("ask#2"), settled("ask#3"), settled("ask#1", 2)] }),
    );
    expect(twice.arcs.find((arc) => arc.to === 0)?.ink).toBe("strong");
  });

  it("跳段：两端都到过才Yes浓墨", () => {
    const model = buildWorkflowTimeline(
      GRAPH,
      run({ nodes: [settled("ask#1"), settled("ask#3")] }),
    );
    expect(model.arcs.find((arc) => arc.from === 0 && arc.to === 2)?.ink).toBe("strong");
    expect(model.arcs.find((arc) => arc.to === 0)?.ink).toBe("faint");
  });

  it("行进边：进入Run站的E邻轨道段", () => {
    const model = buildWorkflowTimeline(
      GRAPH,
      run({ nodes: [settled("ask#1"), executing("ask#2")] }),
    );
    expect(model.rails.map((rail) => rail.ink)).toEqual(["march", "faint"]);
    expect(model.arcs.every((arc) => arc.ink !== "march")).toBe(true);
  });

  it("行进边：再入的回边优先于轨道段——Round 2的 plan In progressRun时，脉冲走回边而不Yes凭空从Left边来", () => {
    const model = buildWorkflowTimeline(
      GRAPH,
      run({
        nodes: [settled("ask#1"), settled("ask#2"), settled("ask#3"), executing("ask#1", 2)],
      }),
    );
    expect(model.runningIndex).toBe(0);
    expect(model.arcs.find((arc) => arc.to === 0)?.ink).toBe("march");
    expect(model.rails.every((rail) => rail.ink !== "march")).toBe(true);
  });

  it("行进边：没有轨道段时落在任One到过源的弧上（跳段直达）", () => {
    const gapped: WorkflowCausalityGraphData = {
      ...GRAPH,
      phaseEdges: [
        { from: "phase#a", to: "phase#b" },
        { from: "phase#a", to: "phase#c" },
      ],
    };
    const model = buildWorkflowTimeline(
      gapped,
      run({ nodes: [settled("ask#1"), executing("ask#3")] }),
    );
    expect(model.arcs.find((arc) => arc.from === 0 && arc.to === 2)?.ink).toBe("march");
  });

  it("第One站In progressRun而没有任何进入它的边时没有行进边", () => {
    const model = buildWorkflowTimeline(GRAPH, run({ nodes: [executing("ask#1")] }));
    expect(model.rails.every((rail) => rail.ink === "faint")).toBe(true);
    expect(model.arcs.every((arc) => arc.ink === "faint")).toBe(true);
  });
});

describe("buildWorkflowTimeline · 药丸", () => {
  it("药丸Yes该站的参与者：R道引用、Run时名、Instance与Session、折叠后的Status", () => {
    const model = buildWorkflowTimeline(
      GRAPH,
      run({
        actors: [
          {
            siteId: "actor#1",
            ordinal: 1,
            name: "Ada the planner",
            sessionId: "s-1",
            status: "running",
          },
          { siteId: "actor#2", ordinal: 1, status: "waiting" },
        ],
        nodes: [executing("ask#1", 1, { actorSiteId: "actor#1", actorOrdinal: 1 })],
      }),
    );
    const [plan] = model.stations;
    const planner = plan!.pills.find((pill) => pill.lane.id === "actor#1")!;
    expect(planner).toMatchObject({
      laneClass: "agent",
      runtimeName: "Ada the planner",
      status: "running",
      instance: { siteId: "actor#1", ordinal: 1, sessionId: "s-1" },
      slot: { siteId: "actor#1", ordinal: 1 },
      stepIds: ["ask#1"],
    });
    const workspace = plan!.pills.find((pill) => pill.lane.id === "workspace")!;
    expect(workspace.laneClass).toBe("workspace");
    expect(workspace.instance).toBeUndefined();
    expect(workspace.slot).toBeUndefined();
    expect(workspace.workspace).toEqual({ phaseId: "phase#a" });
    expect(planner.workspace).toBeUndefined();
    const writer = model.stations[1]!.pills[0]!;
    expect(writer.instance).toEqual({ siteId: "actor#2", ordinal: 1 });
    expect(writer.slot).toEqual({ siteId: "actor#2", ordinal: 1 });
    expect(writer.runtimeName).toBeUndefined();
    expect(writer.status).toBe("pending");
    const verifier = model.stations[2]!.pills.find((pill) => pill.lane.id === "actor#3")!;
    expect(verifier.instance).toBeUndefined();
    expect(verifier.slot).toEqual({ siteId: "actor#3", ordinal: 1 });
  });

  it("槽位（追记「点击语法修订」）：无 run 没有槽位；Members卡的期望序NumberYes member.index + 1", () => {
    const cold = buildWorkflowTimeline(GRAPH, undefined);
    expect(
      cold.stations.flatMap((station) => station.pills).every((pill) => pill.slot === undefined),
    ).toBe(true);

    const members: WorkflowCausalityGraphData = {
      ...GRAPH,
      participants: GRAPH.participants.flatMap((participant) =>
        participant.lane === "actor#2" && participant.phase === "phase#b"
          ? [0, 1, 2].map((index) => ({
              ...participant,
              id: `${participant.id}#${index}`,
              member: { index, of: 3 },
            }))
          : [participant],
      ),
    };
    const model = buildWorkflowTimeline(
      members,
      run({ actors: [{ siteId: "actor#2", ordinal: 1, sessionId: "s-2", status: "waiting" }] }),
    );
    const draft = model.stations[1]!;
    expect(draft.pills.map((pill) => pill.slot)).toEqual([
      { siteId: "actor#2", ordinal: 1 },
      { siteId: "actor#2", ordinal: 2 },
      { siteId: "actor#2", ordinal: 3 },
    ]);
    expect(draft.pills[0]!.instance).toEqual({ siteId: "actor#2", ordinal: 1, sessionId: "s-2" });
    expect(draft.pills[1]!.instance).toBeUndefined();
  });

  it("同OneR道在两个站各有One枚药丸：verify 站的 writer 与 draft 站的 writer 不Yes同One枚", () => {
    const model = buildWorkflowTimeline(GRAPH, undefined);
    const keys = model.stations.flatMap((station) => station.pills.map((pill) => pill.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(model.stations[2]!.pills.map((pill) => pill.lane.id)).toEqual(["actor#3", "actor#2"]);
  });
});

describe("pillActivity", () => {
  const model = (state: WorkflowRunState | undefined) => buildWorkflowTimeline(GRAPH, state);

  it("In progressRun的 step 的 label 优先，其次最后One个已结算的，再次第One个", () => {
    const verifyStation = (state: WorkflowRunState | undefined) =>
      model(state).stations[2]!.pills.find((pill) => pill.lane.id === "actor#2")!;
    const graph = GRAPH;
    expect(pillActivity(graph, undefined, verifyStation(undefined)).label).toBe("polish");

    const running = run({ nodes: [executing("ask#4")] });
    expect(pillActivity(graph, running, verifyStation(running)).label).toBe("polish");

    const planStation = (state: WorkflowRunState) =>
      model(state).stations[0]!.pills.find((pill) => pill.lane.id === "actor#1")!;
    const done = run({ nodes: [settled("ask#1")] });
    expect(pillActivity(graph, done, planStation(done)).label).toBe("plan");
  });

  it("asks / reads 按 step 种类计Count", () => {
    const state = run({ nodes: [settled("ask#1"), settled("world-read#1")] });
    const [plan] = model(state).stations;
    const planner = plan!.pills.find((pill) => pill.lane.id === "actor#1")!;
    const workspace = plan!.pills.find((pill) => pill.lane.id === "workspace")!;
    expect(pillActivity(GRAPH, state, planner)).toEqual({ asks: 1, label: "plan", reads: 0 });
    expect(pillActivity(GRAPH, state, workspace)).toEqual({
      asks: 0,
      label: "read files",
      reads: 1,
    });
  });
});

describe("buildWorkflowTimeline · 进入记录", () => {
  const EMPTY_TAIL: WorkflowCausalityGraphData = {
    ...GRAPH,
    phases: [...GRAPH.phases!, { id: "phase#d", name: "wrap up" }],
    phaseEdges: [...GRAPH.phaseEdges!, { from: "phase#c", to: "phase#d" }],
    exits: ["phase#d"],
  };
  const byName = (model: ReturnType<typeof buildWorkflowTimeline>, name: string) =>
    model.stations.find((station) => station.naming.name === name)!;

  it("零Members站：进入即 running，下One站进入后 done，run Completed后 done，FailedTo failed", () => {
    const entered = buildWorkflowTimeline(
      EMPTY_TAIL,
      run({
        nodes: [settled("ask#1"), settled("ask#2"), settled("ask#3")],
        phases: [
          { name: "plan", rounds: 1 },
          { name: "draft", rounds: 1 },
          { name: "verify", rounds: 1 },
          { name: "wrap up", rounds: 1 },
        ],
        currentPhase: "wrap up",
      }),
    );
    expect(byName(entered, "wrap up").status).toBe("running");
    expect(byName(entered, "wrap up").visited).toBe(true);
    expect(entered.runningIndex).toBe(3);
    expect(entered.rails.find((rail) => rail.to === 3)?.ink).toBe("march");

    const completed = buildWorkflowTimeline(
      EMPTY_TAIL,
      run({
        status: "completed",
        nodes: [settled("ask#1"), settled("ask#2"), settled("ask#3")],
        phases: [
          { name: "plan", rounds: 1 },
          { name: "draft", rounds: 1 },
          { name: "verify", rounds: 1 },
          { name: "wrap up", rounds: 1 },
        ],
        currentPhase: "wrap up",
      }),
    );
    expect(byName(completed, "wrap up").status).toBe("done");

    const failed = buildWorkflowTimeline(
      EMPTY_TAIL,
      run({
        status: "failed",
        phases: [{ name: "plan", rounds: 1 }],
        currentPhase: "plan",
      }),
    );
    expect(byName(failed, "plan").status).toBe("failed");
    expect(byName(failed, "wrap up").status).toBe("pending");

    const passed = buildWorkflowTimeline(
      {
        ...EMPTY_TAIL,
        phases: [{ id: "phase#0", name: "setup" }, ...EMPTY_TAIL.phases!],
        phaseEdges: [{ from: "phase#0", to: "phase#a" }, ...EMPTY_TAIL.phaseEdges!],
      },
      run({
        nodes: [executing("ask#1")],
        phases: [
          { name: "setup", rounds: 1 },
          { name: "plan", rounds: 1 },
        ],
        currentPhase: "plan",
      }),
    );
    expect(byName(passed, "setup").status).toBe("done");
    expect(byName(passed, "plan").status).toBe("running");
    expect(passed.rails[0]?.ink).toBe("march");
  });

  it("有Members的站在第One个 ask 派发之前就 running；节点One running / failed 就按节点说", () => {
    const beforeDispatch = buildWorkflowTimeline(
      GRAPH,
      run({ phases: [{ name: "plan", rounds: 1 }], currentPhase: "plan" }),
    );
    expect(byName(beforeDispatch, "plan").status).toBe("running");
    expect(byName(beforeDispatch, "plan").visited).toBe(true);
    expect(byName(beforeDispatch, "draft").status).toBe("pending");

    const between = buildWorkflowTimeline(
      GRAPH,
      run({
        nodes: [settled("ask#1"), settled("world-read#1")],
        phases: [{ name: "plan", rounds: 1 }],
        currentPhase: "plan",
      }),
    );
    expect(byName(between, "plan").status).toBe("running");

    const failedNode = buildWorkflowTimeline(
      GRAPH,
      run({
        nodes: [settled("ask#1", 1, { outcome: "failed" })],
        phases: [{ name: "plan", rounds: 1 }],
        currentPhase: "plan",
      }),
    );
    expect(byName(failedNode, "plan").status).toBe("failed");
  });

  it("rounds 取进入次Count与节点 ordinal 之大；display 名被截断时按Prefix关联", () => {
    const model = buildWorkflowTimeline(
      GRAPH,
      run({
        nodes: [settled("ask#1", 1), settled("ask#1", 2)],
        phases: [
          { name: "plan", rounds: 3 },
          { name: "draft", rounds: 1 },
        ],
        currentPhase: "plan",
      }),
    );
    expect(byName(model, "plan").rounds).toBe(3);
    expect(byName(model, "draft").rounds).toBe(1);
    expect(byName(model, "draft").visited).toBe(true);

    const long = "x".repeat(128);
    const truncated = buildWorkflowTimeline(
      { ...GRAPH, phases: [{ id: "phase#a", name: long }, ...GRAPH.phases!.slice(1)] },
      run({ phases: [{ name: `${long}yyy`, rounds: 2 }], currentPhase: `${long}yyy` }),
    );
    expect(byName(truncated, long).rounds).toBe(2);
    expect(byName(truncated, long).status).toBe("running");
    const short = buildWorkflowTimeline(
      GRAPH,
      run({ phases: [{ name: "plan the fix", rounds: 1 }], currentPhase: "plan the fix" }),
    );
    expect(byName(short, "plan").visited).toBe(false);
    expect(byName(short, "plan").status).toBe("pending");
  });

  it("无Label记脚本（隐式站）不读进入记录：仍按节点点灯", () => {
    const model = buildWorkflowTimeline(
      { ...GRAPH, phases: undefined, phaseEdges: undefined, exits: undefined },
      run({ phases: [{ name: "plan", rounds: 1 }], currentPhase: "plan" }),
    );
    expect(model.stations).toHaveLength(1);
    expect(model.stations[0]?.status).toBe("pending");
  });
});

describe("buildWorkflowTimeline · 分支站（追记「缺席不YesStatus」）", () => {
  const BRANCH_STEPS: WorkflowCausalityGraphData["steps"] = [
    { id: "ask#1", kind: "ask", label: "poet", lane: "actor#1", phase: "phase#a" },
    { id: "ask#2", kind: "ask", label: "poet", lane: "actor#1", phase: "phase#a" },
    { id: "ask#3", kind: "ask", label: "critic", lane: "actor#2", phase: "phase#b" },
  ];
  const BRANCH: WorkflowCausalityGraphData = {
    steps: BRANCH_STEPS,
    lanes: [
      { id: "actor#1", name: "poet" },
      { id: "actor#2", name: "critic" },
    ],
    participants: participantsOf(BRANCH_STEPS),
    handoffs: [],
    phases: [
      { id: "phase#a", name: "draft" },
      { id: "phase#b", name: "review" },
    ],
    phaseEdges: [
      { from: "phase#a", to: "phase#b" },
      { from: "phase#b", to: "phase#a" },
    ],
    exits: ["phase#b"],
  };
  const actors: WorkflowRunState["actors"] = [
    { siteId: "actor#1", ordinal: 1, name: "poet", sessionId: "s-1", status: "waiting" },
    { siteId: "actor#2", ordinal: 1, name: "critic", sessionId: "s-2", status: "running" },
  ];
  const draftOf = (model: ReturnType<typeof buildWorkflowTimeline>) => model.stations[0]!;

  it("只观察到One支且已结算、控制流在下One站：站 done、药丸 done——没走的那支不把它们拖成 pending", () => {
    const model = buildWorkflowTimeline(
      BRANCH,
      run({
        actors,
        nodes: [
          settled("ask#1", 1, { actorSiteId: "actor#1", actorOrdinal: 1 }),
          executing("ask#3", 1, { actorSiteId: "actor#2", actorOrdinal: 1 }),
        ],
        phases: [
          { name: "draft", rounds: 1 },
          { name: "review", rounds: 1 },
        ],
        currentPhase: "review",
      }),
    );
    expect(draftOf(model).status).toBe("done");
    expect(draftOf(model).pills[0]!.status).toBe("done");
    expect(model.stations[1]!.status).toBe("running");
    expect(model.runningIndex).toBe(1);
  });

  it("评审Round 1就Passed、revision 那支永远不Run：run Completed后站与药丸仍Yes done", () => {
    const model = buildWorkflowTimeline(
      BRANCH,
      run({
        status: "completed",
        actors,
        nodes: [
          settled("ask#1", 1, { actorSiteId: "actor#1", actorOrdinal: 1 }),
          settled("ask#3", 1, { actorSiteId: "actor#2", actorOrdinal: 1 }),
        ],
        phases: [
          { name: "draft", rounds: 1 },
          { name: "review", rounds: 1 },
        ],
        currentPhase: "review",
      }),
    );
    expect(draftOf(model).status).toBe("done");
    expect(draftOf(model).pills[0]!.status).toBe("done");
    expect(model.stations[1]!.status).toBe("done");
  });

  it("观察到的那支In progressRun：站与药丸 running；另One支的缺席不改变任何东西", () => {
    const model = buildWorkflowTimeline(
      BRANCH,
      run({
        actors,
        nodes: [executing("ask#2", 1, { actorSiteId: "actor#1", actorOrdinal: 1 })],
        phases: [{ name: "draft", rounds: 2 }],
        currentPhase: "draft",
      }),
    );
    expect(draftOf(model).status).toBe("running");
    expect(draftOf(model).pills[0]!.status).toBe("running");
  });

  it("One支Failed：站与药丸 failed", () => {
    const model = buildWorkflowTimeline(
      BRANCH,
      run({
        status: "failed",
        actors,
        nodes: [
          settled("ask#1", 1, { actorSiteId: "actor#1", actorOrdinal: 1, outcome: "failed" }),
        ],
        phases: [{ name: "draft", rounds: 1 }],
        currentPhase: "draft",
      }),
    );
    expect(draftOf(model).status).toBe("failed");
    expect(draftOf(model).pills[0]!.status).toBe("failed");
  });

  it("One个节点都没观察到的站仍按控制流点灯：进入过 → done，没进入过 → pending；药丸 pending", () => {
    const model = buildWorkflowTimeline(
      BRANCH,
      run({
        actors,
        nodes: [executing("ask#3", 1, { actorSiteId: "actor#2", actorOrdinal: 1 })],
        phases: [
          { name: "draft", rounds: 1 },
          { name: "review", rounds: 1 },
        ],
        currentPhase: "review",
      }),
    );
    expect(draftOf(model).status).toBe("done");
    expect(draftOf(model).pills[0]!.status).toBe("pending");
    const untouched = buildWorkflowTimeline(BRANCH, run({ actors, nodes: [] }));
    expect(draftOf(untouched).status).toBe("pending");
    expect(draftOf(untouched).pills[0]!.status).toBe("pending");
  });
});

describe("buildWorkflowTimeline · asking", () => {
  it("run.pendingQuestions 里有该Instance的Issue时药丸带 asking（名册钉位规则读它）", () => {
    const model = buildWorkflowTimeline(
      GRAPH,
      run({
        actors: [
          { siteId: "actor#1", ordinal: 1, name: "Ada", sessionId: "s-1", status: "waiting" },
          { siteId: "actor#2", ordinal: 1, name: "Bob", sessionId: "s-2", status: "running" },
        ],
        nodes: [
          {
            siteId: "ask#1",
            ordinal: 1,
            phase: "executing",
            actorSiteId: "actor#1",
            actorOrdinal: 1,
          },
          {
            siteId: "ask#2",
            ordinal: 1,
            phase: "executing",
            actorSiteId: "actor#2",
            actorOrdinal: 1,
          },
        ] as WorkflowRunState["nodes"],
        pendingQuestions: [
          { qid: "q-1", actorSiteId: "actor#1", actorOrdinal: 1, question: "Which branch?" },
          { qid: "q-2", question: "orphan" },
        ],
      }),
    );
    const [plan, draft] = model.stations;
    expect(plan!.pills.find((pill) => pill.lane.id === "actor#1")!.asking).toBe(true);
    expect(draft!.pills.find((pill) => pill.lane.id === "actor#2")!.asking).toBeUndefined();
  });
});

describe("buildWorkflowTimeline · Instance按出生Phase划分", () => {
  const NAMES = ["调研", "From草", "校对", "复核", "收尾"];
  const FAN_OUT: WorkflowCausalityGraphData = {
    exits: ["phase#5"],
    handoffs: [],
    lanes: [{ id: "actor#1", name: "worker" }],
    participants: NAMES.map((_, i) => ({
      id: `phase#${i + 1}:actor#1`,
      lane: "actor#1",
      many: true,
      phase: `phase#${i + 1}`,
      steps: [`ask#1~phase#${i + 1}`],
    })),
    phaseEdges: NAMES.slice(1).map((_, i) => ({ from: `phase#${i + 1}`, to: `phase#${i + 2}` })),
    phases: NAMES.map((name, i) => ({ id: `phase#${i + 1}`, name })),
    steps: NAMES.map((_, i) => ({
      id: `ask#1~phase#${i + 1}`,
      kind: "ask" as const,
      label: "review",
      lane: "actor#1",
      phase: `phase#${i + 1}`,
      source: "ask#1",
    })),
  };

  function fanOutRun(stamped: boolean): WorkflowRunState {
    const stamp = (name: string) => (stamped ? { phaseName: name } : {});
    return run({
      actors: NAMES.flatMap((name, i) =>
        Array.from({ length: 20 }, (_, k) => ({
          ordinal: i * 20 + k + 1,
          siteId: "actor#1",
          status: "waiting" as const,
          ...stamp(name),
        })),
      ),
      nodes: NAMES.flatMap((name, i) =>
        Array.from({ length: 20 }, (_, k) =>
          settled("ask#1", i * 20 + k + 1, {
            actorOrdinal: i * 20 + k + 1,
            actorSiteId: "actor#1",
            ...stamp(name),
          }),
        ),
      ),
    });
  }

  it("每站只Count自己Phase的Instance：药丸 20/20/20/20/20、fraction 20/20，而不Yes 100", () => {
    const model = buildWorkflowTimeline(FAN_OUT, fanOutRun(true));
    expect(model.stations.map((station) => station.pills.length)).toEqual([20, 20, 20, 20, 20]);
    expect(model.stations.map((station) => station.fraction)).toEqual(
      NAMES.map(() => ({ observed: 20, settled: 20 })),
    );
    expect(model.stations[2]!.pills.map((pill) => pill.instance?.ordinal)).toEqual(
      Array.from({ length: 20 }, (_, k) => 41 + k),
    );
  });

  it("无戳的 run Returned按R道Bind：每站 100 个——bug 的画面，Old run 保持不变", () => {
    const model = buildWorkflowTimeline(FAN_OUT, fanOutRun(false));
    expect(model.stations.map((station) => station.pills.length)).toEqual([
      100, 100, 100, 100, 100,
    ]);
    expect(model.stations[0]!.fraction).toEqual({ observed: 100, settled: 100 });
  });
  
  function midRun(p: number, stamped = true): WorkflowRunState {
    const stamp = (name: string) => (stamped ? { phaseName: name } : {});
    return run({
      currentPhase: NAMES[p - 1],
      nodes: NAMES.slice(0, p).flatMap((name, i) =>
        Array.from({ length: 20 }, (_, k) =>
          (i + 1 < p ? settled : executing)("ask#1", i * 20 + k + 1, {
            actorOrdinal: i * 20 + k + 1,
            actorSiteId: "actor#1",
            ...stamp(name),
          }),
        ),
      ),
      phases: NAMES.slice(0, p).map((name) => ({ name, rounds: 1 })),
    });
  }

  it("灯只Letter自己Phase的节点：第 1 Phase在Run时 running/pending×4，第 2 Phase在Run时 done/running/pending×3", () => {
    expect(buildWorkflowTimeline(FAN_OUT, midRun(1)).stations.map((s) => s.status)).toEqual([
      "running",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    const second = buildWorkflowTimeline(FAN_OUT, midRun(2));
    expect(second.stations.map((s) => s.status)).toEqual([
      "done",
      "running",
      "pending",
      "pending",
      "pending",
    ]);
    expect(second.runningIndex).toBe(1);
    expect(second.stations[1]!.pills.every((pill) => pill.status === "running")).toBe(true);
    expect(second.stations[2]!.pills.every((pill) => pill.status === "pending")).toBe(true);
  });

  it("无戳的 run 保持五灯齐亮的Old画面：叠加Returned按站点广播", () => {
    expect(buildWorkflowTimeline(FAN_OUT, midRun(1, false)).stations.map((s) => s.status)).toEqual([
      "running",
      "running",
      "running",
      "running",
      "running",
    ]);
  });
});

describe("buildWorkflowTimeline · 表outer条目", () => {
  function truncated(
    unlistedByPhase: NonNullable<WorkflowRunState["unlistedByPhase"]>,
    nodes: WorkflowRunState["nodes"] = [],
  ): WorkflowRunState {
    return run({
      actors: [{ siteId: "actor#1", ordinal: 1, status: "completed", phaseName: "plan" }],
      nodes,
      truncated: true,
      unlistedByPhase,
      usage: { spentTokens: 0, nodesUsed: 0, nodesUnlisted: 300, nodesUnlistedSettled: 300 },
    });
  }

  it("按出生Phase的戳归位；fraction 的分子与分母OneFrom抬，One条都没少的站不带这One格", () => {
    const model = buildWorkflowTimeline(
      GRAPH,
      truncated(
        [
          { phaseName: "plan", actors: 300, actorsSettled: 100, actorsFailed: 2, settled: 300 },
          { phaseName: "draft", actors: 1, settled: 0 },
        ],
        [settled("ask#1", 1, { phaseName: "plan" })],
      ),
    );
    const [plan, draft, verify] = model.stations;
    expect(plan!.unlisted).toEqual({ actors: 300, failed: 2, nodesSettled: 300, settled: 100 });
    expect(plan!.fraction).toEqual({ observed: 301, settled: 301 });
    expect(draft!.unlisted).toEqual({ actors: 1, failed: 0, nodesSettled: 0, settled: 0 });
    expect(draft!.fraction).toBeUndefined();
    expect(verify!.unlisted).toBeUndefined();
    expect(model.stations.map((station) => station.status)).toEqual(["done", "pending", "pending"]);
  });

  it("无Phase那One格落在无名的站上——与无戳Instance同One条Bind规则", () => {
    const mixed: WorkflowCausalityGraphData = {
      steps: [
        { id: "ask#0", kind: "ask", label: "warm up", lane: "actor#1", phase: "unphased" },
        { id: "ask#1", kind: "ask", label: "plan", lane: "actor#1", phase: "phase#a" },
      ],
      lanes: [{ id: "actor#1" }],
      participants: [
        { id: "unphased:actor#1", phase: "unphased", lane: "actor#1", steps: ["ask#0"] },
        { id: "phase#a:actor#1", phase: "phase#a", lane: "actor#1", steps: ["ask#1"] },
      ],
      handoffs: [],
      phases: [{ id: "unphased" }, { id: "phase#a", name: "plan" }],
      phaseEdges: [{ from: "unphased", to: "phase#a" }],
    };
    const model = buildWorkflowTimeline(
      mixed,
      truncated([
        { actors: 4, actorsSettled: 4, settled: 7 },
        { phaseName: "plan", actors: 2, actorsSettled: 1, actorsFailed: 1, settled: 0 },
      ]),
    );
    expect(model.stations.map((station) => station.unlisted)).toEqual([
      { actors: 4, failed: 0, nodesSettled: 7, settled: 4 },
      { actors: 2, failed: 1, nodesSettled: 0, settled: 1 },
    ]);
    expect(model.stations[0]!.fraction).toEqual({ observed: 7, settled: 7 });
  });
});

describe("buildWorkflowTimeline · 带", () => {
  
  function bandGraph(
    near: (number[] | undefined)[],
    edges: [number, number][],
  ): WorkflowCausalityGraphData {
    const steps: WorkflowCausalityGraphData["steps"] = near.map((_, i) => ({
      id: `ask#${i}`,
      kind: "ask",
      label: `step ${i}`,
      lane: `actor#${i}`,
      phase: `phase#${i}`,
    }));
    return {
      steps,
      lanes: near.map((_, i) => ({ id: `actor#${i}` })),
      participants: participantsOf(steps),
      handoffs: [],
      phases: near.map((alongside, i) => ({
        id: `phase#${i}`,
        name: `P${i}`,
        ...(alongside === undefined ? {} : { alongside: alongside.map((j) => `phase#${j}`) }),
      })),
      phaseEdges: edges.map(([from, to]) => ({ from: `phase#${from}`, to: `phase#${to}` })),
      exits: [`phase#${near.length - 1}`],
    };
  }

  const TESTFIELD = bandGraph(
    [undefined, [0], undefined],
    [
      [0, 1],
      [1, 2],
    ],
  );

  it("没有 alongside 时没有带：站都在主线上，弧都在最下面那层空里", () => {
    const model = buildWorkflowTimeline(GRAPH, undefined);
    expect(model.bands).toEqual([]);
    expect(model.stations.map((station) => station.track)).toEqual([0, 0, 0]);
    expect(model.arcs.every((arc) => arc.air === 0)).toBe(true);
    expect(model.rails.every((rail) => rail.kind === undefined)).toBe(true);
  });

  it("A ∥ B → C：One条带两条轨道，没有Predecessor、汇合到 C", () => {
    const model = buildWorkflowTimeline(TESTFIELD, undefined);
    expect(model.stations.map((station) => station.track)).toEqual([0, 1, 0]);
    expect(model.bands).toEqual([
      {
        from: 0,
        join: 2,
        to: 1,
        tracks: [
          { entry: "faint", exit: "faint", stations: [0] },
          { entry: "faint", exit: "faint", stations: [1] },
        ],
      },
    ]);
  });

  it("带inner跨轨道的前向边被丢掉（分叉已经说过控制经过了两边），E邻两站改画双线段", () => {
    const model = buildWorkflowTimeline(TESTFIELD, undefined);
    expect(model.rails).toEqual([
      { from: 0, ink: "faint", kind: "twin", to: 1 },
      { from: 0, ink: "faint", to: 2 },
      { from: 1, ink: "faint", kind: "merge", to: 2 },
    ]);
    expect(model.arcs).toEqual([]);
  });

  it("轨道的进出墨：没有Predecessor时按首站到没到过，汇合段的墨就Yes那条轨道的出墨", () => {
    const model = buildWorkflowTimeline(
      TESTFIELD,
      run({ nodes: [settled("ask#0"), settled("ask#1"), settled("ask#2")] }),
    );
    expect(model.bands[0]!.tracks.map((track) => [track.entry, track.exit])).toEqual([
      ["strong", "strong"],
      ["strong", "strong"],
    ]);
    const half = buildWorkflowTimeline(TESTFIELD, run({ nodes: [settled("ask#0")] }));
    expect(half.bands[0]!.tracks.map((track) => [track.entry, track.exit])).toEqual([
      ["strong", "faint"],
      ["faint", "faint"],
    ]);
  });

  it("行进边：汇合站在Run时，主线那One段与每One条汇合段都行进", () => {
    const model = buildWorkflowTimeline(
      TESTFIELD,
      run({ nodes: [settled("ask#0"), settled("ask#1"), executing("ask#2")] }),
    );
    expect(model.runningIndex).toBe(2);
    expect(model.rails.filter((rail) => rail.ink === "march")).toEqual([
      { from: 0, ink: "march", to: 2 },
      { from: 1, ink: "march", kind: "merge", to: 2 },
    ]);
    expect(model.bands[0]!.tracks.map((track) => track.exit)).toEqual(["march", "march"]);
  });

  it("行进边：带的两条轨道同时在Run而没有Predecessor时什么都不行进——双线段不Yes控制流走的路", () => {
    const model = buildWorkflowTimeline(
      TESTFIELD,
      run({ nodes: [executing("ask#0"), executing("ask#1")] }),
    );
    expect(model.runningIndex).toBe(1);
    expect(model.rails.every((rail) => rail.ink !== "march")).toBe(true);
    expect(model.arcs).toEqual([]);
  });

  it("有Predecessor时分叉出去：主线One条平轨、每条分支One条分叉段，同时在Run就OneFrom行进", () => {
    const withPred = bandGraph(
      [undefined, undefined, [1], undefined],
      [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
    );
    const model = buildWorkflowTimeline(withPred, undefined);
    expect(model.bands[0]).toMatchObject({ from: 1, join: 3, pred: 0, to: 2 });
    expect(model.rails).toEqual([
      { from: 0, ink: "faint", to: 1 },
      { from: 0, ink: "faint", kind: "fork", to: 2 },
      { from: 1, ink: "faint", kind: "twin", to: 2 },
      { from: 1, ink: "faint", to: 3 },
      { from: 2, ink: "faint", kind: "merge", to: 3 },
    ]);

    const live = buildWorkflowTimeline(
      withPred,
      run({ nodes: [settled("ask#0"), executing("ask#1"), executing("ask#2")] }),
    );
    expect(live.rails.filter((rail) => rail.ink === "march")).toEqual([
      { from: 0, ink: "march", to: 1 },
      { from: 0, ink: "march", kind: "fork", to: 2 },
    ]);
    expect(live.bands[0]!.tracks.map((track) => track.entry)).toEqual(["march", "march"]);
  });

  it("重叠链：A 与 C 在主线上前后E接，即使它们之间的边已经被About简掉", () => {
    const chain = bandGraph(
      [undefined, [0], [1], undefined],
      [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
    );
    const model = buildWorkflowTimeline(chain, undefined);
    expect(model.stations.map((station) => station.track)).toEqual([0, 1, 0, 0]);
    expect(model.bands[0]!.tracks.map((track) => track.stations)).toEqual([[0, 2], [1]]);
    expect(model.rails).toEqual([
      { from: 0, ink: "faint", kind: "twin", to: 1 },
      { from: 0, ink: "faint", to: 2 },
      { from: 1, ink: "faint", kind: "twin", to: 2 },
      { from: 1, ink: "faint", kind: "merge", to: 3 },
      { from: 2, ink: "faint", to: 3 },
    ]);
  });

  it("绕整条带的循环落在带的Left端：整条带都上环", () => {
    const loop = bandGraph(
      [undefined, [0], undefined],
      [
        [0, 2],
        [1, 2],
        [2, 0],
      ],
    );
    const model = buildWorkflowTimeline(loop, undefined);
    expect(model.arcs).toEqual([{ air: 1, from: 2, ink: "faint", lane: 0, to: 0 }]);
    expect(model.stations.map((station) => station.onLoop)).toEqual([true, true, true]);
  });

  it("带inner闭合的循环从带的Right端出发（没有汇合站的带也有One个汇合点）", () => {
    const loop = bandGraph(
      [undefined, undefined, [1]],
      [
        [0, 1],
        [0, 2],
        [2, 0],
      ],
    );
    const model = buildWorkflowTimeline(loop, undefined);
    expect(model.bands[0]).toMatchObject({ from: 1, pred: 0, to: 2 });
    expect(model.bands[0]!.join).toBeUndefined();
    expect(model.arcs).toEqual([{ air: 1, from: 2, ink: "faint", lane: 0, to: 0 }]);
    expect(model.rails).toEqual([
      { from: 0, ink: "faint", to: 1 },
      { from: 0, ink: "faint", kind: "fork", to: 2 },
      { from: 1, ink: "faint", kind: "twin", to: 2 },
    ]);
  });

  it("One条轨道inner部的循环用那条轨道自己的空", () => {
    const inside = bandGraph(
      [undefined, undefined, [1], [1], undefined],
      [
        [0, 1],
        [0, 2],
        [2, 3],
        [3, 2],
        [1, 4],
        [3, 4],
      ],
    );
    const model = buildWorkflowTimeline(inside, undefined);
    expect(model.bands[0]!.tracks.map((track) => track.stations)).toEqual([[1], [2, 3]]);
    expect(model.arcs).toEqual([{ air: 1, from: 3, ink: "faint", lane: 0, to: 2 }]);
    expect(model.rails).toEqual([
      { from: 0, ink: "faint", to: 1 },
      { from: 0, ink: "faint", kind: "fork", to: 2 },
      { from: 1, ink: "faint", kind: "twin", to: 2 },
      { from: 1, ink: "faint", to: 4 },
      { from: 2, ink: "faint", to: 3 },
      { from: 3, ink: "faint", kind: "merge", to: 4 },
    ]);
    expect(model.stations.map((station) => station.onLoop)).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
  });

  it("分道按空各算各的：两条轨道各有One个循环时，两条弧都贴着自己的轨道", () => {
    const twoLoops = bandGraph(
      [undefined, undefined, [1], [2], [3], undefined],
      [
        [0, 1],
        [3, 1],
        [4, 2],
        [3, 5],
        [4, 5],
      ],
    );
    const model = buildWorkflowTimeline(twoLoops, undefined);
    expect(model.bands[0]!.tracks.map((track) => track.stations)).toEqual([
      [1, 3],
      [2, 4],
    ]);
    expect(model.arcs).toEqual([
      { air: 0, from: 3, ink: "faint", lane: 0, to: 1 },
      { air: 1, from: 4, ink: "faint", lane: 0, to: 2 },
    ]);
    expect(arcLaneCount(model.arcs.filter((arc) => arc.air === 0))).toBe(1);
  });
});
