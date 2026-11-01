//
import { describe, expect, it } from "vitest";
import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowCausalityGraphData } from "@/components/workflow-graph/types.js";
import { laneRefsById } from "@/components/workflow-graph/lane-name.js";
import { buildWorkflowTimeline } from "@/components/workflow-timeline/timeline-model.js";
import {
  fillContains,
  holeParentsOf,
  narrowTimelineToFill,
  withoutHeadedHolePhases,
} from "@/components/workflow-timeline/timeline-holes.js";

const H1 = "hole#a0000001";
const H2 = "hole#a0000002";
const H11 = "hole#a0000011";
const H7 = "hole#a0000007";
const H10 = "hole#a0000010";

type Step = WorkflowCausalityGraphData["steps"][number];
function participantsOf(steps: readonly Step[]) {
  const byId = new Map<string, { id: string; phase: string; lane: string; steps: string[] }>();
  for (const step of steps) {
    if (step.kind === "hole") continue;
    const phase = step.phase ?? "unphased";
    const id = `${phase}:${step.lane}`;
    const existing = byId.get(id);
    if (existing) existing.steps.push(step.id);
    else byId.set(id, { id, lane: step.lane, phase, steps: [step.id] });
  }
  return [...byId.values()];
}

const OPEN_STEPS: Step[] = [
  { id: "ask#1", kind: "ask", label: "scout", lane: "actor#1", phase: "phase#1" },
  { id: H1, kind: "hole", label: "决定分组", lane: "main", phase: H1 },
  { id: "ask#2", kind: "ask", label: "member", lane: "actor#2", phase: "phase#2" },
  { id: H2, kind: "hole", label: "评判", lane: "main", phase: H2 },
];
const OPEN: WorkflowCausalityGraphData = {
  steps: OPEN_STEPS,
  lanes: [
    { id: "actor#1", name: "侦察Member" },
    { id: "actor#2", name: "组Member" },
  ],
  participants: participantsOf(OPEN_STEPS),
  handoffs: [],
  phases: [
    { id: "phase#1", name: "探索" },
    { id: H1, name: "决定分组" },
    { id: "phase#2", name: "执行" },
    { id: H2, name: "评判" },
  ],
  phaseEdges: [
    { from: "phase#1", to: H1 },
    { from: H1, to: "phase#2" },
    { from: "phase#2", to: H2 },
  ],
  holes: [
    { siteId: H1, name: "决定分组", type: "Plan" },
    { siteId: H2, name: "评判", type: "Verdict", tail: true },
  ],
};

const FILLED_STEPS: Step[] = [
  { id: "ask#1", kind: "ask", label: "scout", lane: "actor#1", phase: "phase#1" },
  {
    id: `${H1}/ask#1`,
    kind: "ask",
    label: "smoke",
    lane: `${H1}/actor#1`,
    phase: `${H1}/phase#1`,
    fill: H1,
  },
  {
    id: `${H1}/ask#2`,
    kind: "ask",
    label: "group",
    lane: `${H1}/actor#2`,
    phase: `${H1}/phase#2`,
    fill: H1,
  },
  { id: "ask#2", kind: "ask", label: "member", lane: "actor#2", phase: "phase#2" },
];
const FILLED: WorkflowCausalityGraphData = {
  steps: FILLED_STEPS,
  lanes: [
    { id: "actor#1", name: "侦察Member" },
    { id: `${H1}/actor#1`, name: "冒烟Member" },
    { id: `${H1}/actor#2`, name: "分组员" },
    { id: "actor#2", name: "组Member" },
  ],
  participants: participantsOf(FILLED_STEPS),
  handoffs: [],
  phases: [
    { id: "phase#1", name: "探索" },
    { id: H1, name: "决定分组" },
    { id: `${H1}/phase#1`, name: "冒烟测试", fill: H1 },
    { id: `${H1}/phase#2`, name: "分组", fill: H1 },
    { id: "phase#2", name: "执行" },
    { id: H2, name: "评判" },
  ],
  phaseEdges: [
    { from: "phase#1", to: H1 },
    { from: H1, to: `${H1}/phase#1` },
    { from: `${H1}/phase#1`, to: `${H1}/phase#2` },
    { from: `${H1}/phase#2`, to: "phase#2" },
    { from: "phase#2", to: H2 },
  ],
  holes: [{ siteId: H2, name: "评判", type: "Verdict", tail: true }],
};

const TAIL_FILLED_STEPS: Step[] = [
  ...FILLED_STEPS,
  { id: `${H2}/ask#1`, kind: "ask", label: "judge", lane: `${H2}/actor#1`, phase: H2, fill: H2 },
];
const TAIL_FILLED: WorkflowCausalityGraphData = {
  ...FILLED,
  steps: TAIL_FILLED_STEPS,
  lanes: [...FILLED.lanes, { id: `${H2}/actor#1`, name: "评委" }],
  participants: participantsOf(TAIL_FILLED_STEPS),
  holes: [],
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

describe("留白站（静态）", () => {
  it("开着的留白YesOne站：hole.state open、类型Original text、Tail留白带 tail；两侧轨道段Yes虚线", () => {
    const model = buildWorkflowTimeline(OPEN, undefined);
    expect(model.stations.map((station) => station.id)).toEqual(["phase#1", H1, "phase#2", H2]);
    expect(model.stations[1]!.hole).toEqual({ siteId: H1, state: "open" });
    expect(model.stations[3]!.hole).toEqual({ siteId: H2, state: "open", tail: true });
    expect(model.stations[0]!.hole).toBeUndefined();
    expect(model.rails.map((rail) => rail.dashed)).toEqual([true, true, true]);
    expect(model.tailStub).toBe("open");
    expect(model.fills).toEqual([]);
  });

  it("留白自己的 kind hole 站点不算 ask：留白站没有药丸、Summary不计它", () => {
    const model = buildWorkflowTimeline(OPEN, undefined);
    expect(model.stations[1]!.pills).toEqual([]);
    expect(model.stations[0]!.pills.map((pill) => pill.lane.id)).toEqual(["actor#1"]);
  });

  it("没有留白的图：tailStub 缺席、fills 为空、轨道段不带 dashed", () => {
    const model = buildWorkflowTimeline(
      { ...OPEN, phases: OPEN.phases!.slice(0, 1), phaseEdges: [], holes: [] },
      undefined,
    );
    expect(model.tailStub).toBeUndefined();
    expect(model.fills).toEqual([]);
  });
});

describe("留白站（活）", () => {
  it("run 停在留白：hole.state waiting、站算作Current站（进入它的段行进、runningIndex 落在它上）", () => {
    const model = buildWorkflowTimeline(
      OPEN,
      run({
        phases: [{ name: "探索", rounds: 1 }],
        currentPhase: "探索",
        nodes: [
          { siteId: "ask#1", ordinal: 1, phase: "settled", outcome: "ok", phaseName: "探索" },
        ],
        holes: [
          { siteId: H1, ordinal: 1, name: "决定分组", type: "Plan", state: "waiting", since: 5 },
        ],
      }),
    );
    const hole = model.stations[1]!;
    expect(hole.hole).toEqual({ siteId: H1, state: "waiting", since: 5 });
    expect(hole.status).toBe("running");
    expect(hole.visited).toBe(true);
    expect(model.runningIndex).toBe(1);
    expect(model.rails[0]!.ink).toBe("march");
    expect(model.stations[3]!.hole?.state).toBe("open");
    expect(model.stations[3]!.status).toBe("pending");
  });

  it("Waiting的站带上 run.holes 记的Notice语（侧板的Waiting体画它）；Complete后不带", () => {
    const waiting = buildWorkflowTimeline(
      OPEN,
      run({
        holes: [
          {
            siteId: H1,
            ordinal: 1,
            name: "决定分组",
            type: "Plan",
            prompt: "Reconnaissance results are as follows，请Complete。",
            state: "waiting",
          },
        ],
      }),
    );
    expect(waiting.stations[1]!.hole?.prompt).toBe("Reconnaissance results are as follows，请Complete。");
    const filled = buildWorkflowTimeline(
      TAIL_FILLED,
      run({
        holes: [
          { siteId: H2, ordinal: 1, name: "评判", type: "Verdict", prompt: "p", state: "filled" },
        ],
      }),
    );
    expect(filled.stations[4]!.hole?.prompt).toBeUndefined();
  });
});

describe("Complete后的Timeline", () => {
  const filledRun = run({
    holes: [
      {
        siteId: H1,
        ordinal: 1,
        name: "决定分组",
        type: "Plan",
        state: "filled",
        filledAt: 99,
        filledBy: "main",
      },
    ],
    phases: [
      { name: "探索", rounds: 1 },
      { name: "冒烟测试", rounds: 1 },
    ],
    currentPhase: "冒烟测试",
  });

  it("有Phase的Complete：体的两站站在留白的Location，头覆盖它们（from/to）、带名与类型；留白自己没有站", () => {
    const model = buildWorkflowTimeline(FILLED, filledRun);
    expect(model.stations.map((station) => station.id)).toEqual([
      "phase#1",
      `${H1}/phase#1`,
      `${H1}/phase#2`,
      "phase#2",
      H2,
    ]);
    expect(model.fills).toEqual([{ holeId: H1, name: "决定分组", from: 1, to: 2, filledAt: 99 }]);
    expect(model.stations[1]!.hole).toBeUndefined();
    expect(model.stations[1]!.fill).toBe(H1);
    expect(model.rails[0]!.dashed).toBeUndefined();
    expect(model.stations[1]!.status).toBe("running");
  });

  it("没有 run（确认窗）时头的名Character取自 holeLabels，缺席则Returned站点 id", () => {
    const labelled = buildWorkflowTimeline(
      FILLED,
      undefined,
      new Map([[H1, { name: "决定分组" }]]),
    );
    expect(labelled.fills[0]).toMatchObject({ name: "决定分组" });
    const bare = buildWorkflowTimeline(FILLED, undefined);
    expect(bare.fills[0]).toMatchObject({ holeId: H1, name: H1 });
  });

  it("无Phase的Complete：站Retain留白的名与徽Label（state filled），不抬头；Tail留白Complete后 tailStub 变成 filled", () => {
    const model = buildWorkflowTimeline(
      TAIL_FILLED,
      run({
        holes: [
          { siteId: H1, ordinal: 1, name: "决定分组", type: "Plan", state: "filled", filledAt: 1 },
          { siteId: H2, ordinal: 1, name: "评判", type: "Verdict", state: "filled", filledAt: 2 },
        ],
      }),
    );
    const judge = model.stations[4]!;
    expect(judge.hole).toEqual({ siteId: H2, state: "filled", tail: true, filledAt: 2 });
    expect(judge.pills.map((pill) => pill.lane.id)).toEqual([`${H2}/actor#1`]);
    expect(model.fills.map((fill) => fill.holeId)).toEqual([H1]);
    expect(model.tailStub).toBe("filled");
    expect(model.rails[3]!.dashed).toBeUndefined();
  });
});

describe("narrowTimelineToFill · Complete行的DraftPhase线", () => {
  it("只留Complete的站与它们两侧的邻站，邻站 ghost；轨道段与头的下Label随之重排", () => {
    const model = buildWorkflowTimeline(FILLED, undefined, new Map([[H1, { name: "决定分组" }]]));
    const narrowed = narrowTimelineToFill(model, H1);
    expect(narrowed).toBeDefined();
    expect(narrowed!.stations.map((station) => station.id)).toEqual([
      "phase#1",
      `${H1}/phase#1`,
      `${H1}/phase#2`,
      "phase#2",
    ]);
    expect(narrowed!.stations.map((station) => station.ghost)).toEqual([
      true,
      undefined,
      undefined,
      true,
    ]);
    expect(narrowed!.fills).toEqual([{ holeId: H1, name: "决定分组", from: 1, to: 2 }]);
    expect(narrowed!.rails.map((rail) => [rail.from, rail.to])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(narrowed!.arcs).toEqual([]);
    expect(narrowed!.tailStub).toBeUndefined();
  });

  it("无Phase的Complete：WindowYes留白自己的站加邻站；不认识的留白Return undefined", () => {
    const model = buildWorkflowTimeline(TAIL_FILLED, undefined, new Map([[H2, { name: "评判" }]]));
    const narrowed = narrowTimelineToFill(model, H2);
    expect(narrowed!.stations.map((station) => station.id)).toEqual(["phase#2", H2]);
    expect(narrowed!.stations[1]!.hole?.state).toBe("filled");
    expect(narrowed!.tailStub).toBe("filled");
    expect(narrowTimelineToFill(model, H7)).toBeUndefined();
  });
});

const INNER_OPEN_STEPS: Step[] = [
  { id: "ask#1", kind: "ask", label: "scout", lane: "actor#1", phase: "phase#1" },
  {
    id: `${H1}/ask#1`,
    kind: "ask",
    label: "smoke",
    lane: `${H1}/actor#1`,
    phase: `${H1}/phase#1`,
    fill: H1,
  },
  { id: H11, kind: "hole", label: "挑选", lane: "main", phase: H11, fill: H1 },
  {
    id: `${H1}/ask#2`,
    kind: "ask",
    label: "group",
    lane: `${H1}/actor#2`,
    phase: `${H1}/phase#2`,
    fill: H1,
  },
  { id: "ask#2", kind: "ask", label: "member", lane: "actor#2", phase: "phase#2" },
  { id: H2, kind: "hole", label: "评判", lane: "main", phase: H2 },
];
const INNER_OPEN: WorkflowCausalityGraphData = {
  steps: INNER_OPEN_STEPS,
  lanes: FILLED.lanes,
  participants: participantsOf(INNER_OPEN_STEPS),
  handoffs: [],
  phases: [
    { id: "phase#1", name: "探索" },
    { id: H1, name: "决定分组" },
    { id: `${H1}/phase#1`, name: "冒烟测试", fill: H1 },
    { id: H11, name: "挑选", fill: H1 },
    { id: `${H1}/phase#2`, name: "分组", fill: H1 },
    { id: "phase#2", name: "执行" },
    { id: H2, name: "评判" },
  ],
  phaseEdges: [
    { from: "phase#1", to: H1 },
    { from: H1, to: `${H1}/phase#1` },
    { from: `${H1}/phase#1`, to: H11 },
    { from: H11, to: `${H1}/phase#2` },
    { from: `${H1}/phase#2`, to: "phase#2" },
    { from: "phase#2", to: H2 },
  ],
  holes: [
    { siteId: H11, name: "挑选", type: "Pick" },
    { siteId: H2, name: "评判", type: "Verdict", tail: true },
  ],
};
const BOTH_STEPS: Step[] = [
  ...INNER_OPEN_STEPS.filter((step) => step.kind !== "hole" || step.id === H2),
  {
    id: `${H11}/ask#1`,
    kind: "ask",
    label: "pick",
    lane: `${H11}/actor#1`,
    phase: `${H11}/phase#1`,
    fill: H11,
  },
];
const BOTH: WorkflowCausalityGraphData = {
  ...INNER_OPEN,
  steps: BOTH_STEPS,
  lanes: [...FILLED.lanes, { id: `${H11}/actor#1`, name: "挑选Member" }],
  participants: participantsOf(BOTH_STEPS),
  phases: [
    { id: "phase#1", name: "探索" },
    { id: H1, name: "决定分组" },
    { id: `${H1}/phase#1`, name: "冒烟测试", fill: H1 },
    { id: H11, name: "挑选", fill: H1 },
    { id: `${H11}/phase#1`, name: "挑出候选", fill: H11 },
    { id: `${H1}/phase#2`, name: "分组", fill: H1 },
    { id: "phase#2", name: "执行" },
    { id: H2, name: "评判" },
  ],
  phaseEdges: [
    { from: "phase#1", to: H1 },
    { from: H1, to: `${H1}/phase#1` },
    { from: `${H1}/phase#1`, to: H11 },
    { from: H11, to: `${H11}/phase#1` },
    { from: `${H11}/phase#1`, to: `${H1}/phase#2` },
    { from: `${H1}/phase#2`, to: "phase#2" },
    { from: "phase#2", to: H2 },
  ],
  holes: [{ siteId: H2, name: "评判", type: "Verdict", tail: true }],
};
const OUTER_FILLED = {
  siteId: H1,
  ordinal: 1,
  name: "决定分组",
  type: "Plan",
  state: "filled" as const,
  filledAt: 10,
};

describe("嵌套的留白", () => {
  it("父表从留白自己的Phase与站读出；fillContains 沿父表向outer走，不看 id 的形状拼接", () => {
    const parents = holeParentsOf(BOTH, BOTH.phases!);
    expect(parents).toEqual({ [H11]: H1 });
    expect(holeParentsOf(INNER_OPEN, INNER_OPEN.phases!)).toEqual({ [H11]: H1 });
    expect(fillContains(H1, H1, parents)).toBe(true);
    expect(fillContains(H1, H11, parents)).toBe(true);
    expect(fillContains(H11, H1, parents)).toBe(false);
    expect(fillContains(H1, H10, parents)).toBe(false);
    expect(fillContains(H1, `${H1}/phase#2`, parents)).toBe(false);
    expect(fillContains(H2, H1, { [H1]: H11, [H11]: H1 })).toBe(false);
  });

  it("头已代表的留白Phase不成站，进它与出它的边接From来；开着的、有Members的、体里没有站的留白都留着", () => {
    const hidden = withoutHeadedHolePhases(BOTH);
    expect(hidden.phases!.map((phase) => phase.id)).toEqual([
      "phase#1",
      `${H1}/phase#1`,
      `${H11}/phase#1`,
      `${H1}/phase#2`,
      "phase#2",
      H2,
    ]);
    const edgeKeys = (edges: readonly { from: string; to: string }[] | undefined) =>
      (edges ?? []).map((edge) => `${edge.from} > ${edge.to}`).sort();
    expect(edgeKeys(hidden.phaseEdges)).toEqual(
      edgeKeys([
        { from: "phase#1", to: `${H1}/phase#1` },
        { from: `${H1}/phase#1`, to: `${H11}/phase#1` },
        { from: `${H11}/phase#1`, to: `${H1}/phase#2` },
        { from: `${H1}/phase#2`, to: "phase#2" },
        { from: "phase#2", to: H2 },
      ]),
    );
    expect(withoutHeadedHolePhases(INNER_OPEN).phases!.map((phase) => phase.id)).toEqual([
      "phase#1",
      `${H1}/phase#1`,
      H11,
      `${H1}/phase#2`,
      "phase#2",
      H2,
    ]);
    expect(withoutHeadedHolePhases(TAIL_FILLED).phases!.map((phase) => phase.id)).toEqual([
      "phase#1",
      `${H1}/phase#1`,
      `${H1}/phase#2`,
      "phase#2",
      H2,
    ]);
    expect(withoutHeadedHolePhases(OPEN)).toBe(OPEN);
  });

  it(`Status 1 · outer层开着：只有 ${H1} One站，没有头`, () => {
    const model = buildWorkflowTimeline(OPEN, undefined);
    expect(model.stations.map((station) => station.hole?.siteId)).toEqual([
      undefined,
      H1,
      undefined,
      H2,
    ]);
    expect(model.fills).toEqual([]);
  });

  it("Status 2 · outer层Complete、Inner开着：InnerYesouter层体里的普通留白站，outer层的头盖住含它的Three站；run 停在Inner时 waiting", () => {
    const live = run({
      holes: [
        OUTER_FILLED,
        { siteId: H11, ordinal: 1, name: "挑选", type: "Pick", state: "waiting", since: 20 },
      ],
    });
    const model = buildWorkflowTimeline(INNER_OPEN, live);
    expect(model.stations.map((station) => station.id)).toEqual([
      "phase#1",
      `${H1}/phase#1`,
      H11,
      `${H1}/phase#2`,
      "phase#2",
      H2,
    ]);
    const inner = model.stations[2]!;
    expect(inner.hole).toEqual({ siteId: H11, state: "waiting", since: 20 });
    expect(inner.fill).toBe(H1);
    expect(inner.pills).toEqual([]);
    expect(model.runningIndex).toBe(2);
    expect(model.rails.filter((rail) => rail.dashed).map((rail) => [rail.from, rail.to])).toEqual([
      [1, 2],
      [2, 3],
      [4, 5],
    ]);
    expect(model.fills).toEqual([{ holeId: H1, name: "决定分组", from: 1, to: 3, filledAt: 10 }]);
    const stat = buildWorkflowTimeline(
      INNER_OPEN,
      undefined,
      new Map([[H1, { name: "决定分组" }]]),
    );
    expect(stat.stations[2]!.hole?.state).toBe("open");
    expect(stat.fills.map((fill) => fill.holeId)).toEqual([H1]);
  });

  it("Status 3 · 两层都Complete：Inner的头在outer层的跨度里，按 from 升序、同From点outer层在前；窄化到Inner只留它与两侧邻站", () => {
    const live = run({
      holes: [
        OUTER_FILLED,
        { siteId: H11, ordinal: 1, name: "挑选", type: "Pick", state: "filled", filledAt: 30 },
      ],
    });
    const model = buildWorkflowTimeline(BOTH, live);
    expect(model.stations[2]!.hole).toBeUndefined();
    expect(model.stations[2]!.fill).toBe(H11);
    expect(model.fills).toEqual([
      { holeId: H1, name: "决定分组", from: 1, to: 3, filledAt: 10 },
      { holeId: H11, name: "挑选", from: 2, to: 2, filledAt: 30 },
    ]);
    const narrowed = narrowTimelineToFill(model, H11)!;
    expect(narrowed.stations.map((station) => [station.id, station.ghost ?? false])).toEqual([
      [`${H1}/phase#1`, true],
      [`${H11}/phase#1`, false],
      [`${H1}/phase#2`, true],
    ]);
    expect(narrowed.fills).toEqual([{ holeId: H11, name: "挑选", from: 1, to: 1, filledAt: 30 }]);
    const onlyInner: WorkflowCausalityGraphData = {
      ...BOTH,
      steps: BOTH_STEPS.filter((step) => step.fill !== H1),
      participants: participantsOf(BOTH_STEPS.filter((step) => step.fill !== H1)),
      phases: BOTH.phases!.filter((phase) => phase.fill !== H1 || phase.id === H11),
      phaseEdges: [
        { from: "phase#1", to: H1 },
        { from: H1, to: H11 },
        { from: H11, to: `${H11}/phase#1` },
        { from: `${H11}/phase#1`, to: "phase#2" },
        { from: "phase#2", to: H2 },
      ],
    };
    expect(
      buildWorkflowTimeline(onlyInner, undefined).fills.map((fill) => [
        fill.holeId,
        fill.from,
        fill.to,
      ]),
    ).toEqual([
      [H1, 1, 1],
      [H11, 1, 1],
    ]);
  });
});

describe("the main agent's lane on the timeline", () => {
  const REAL: WorkflowCausalityGraphData = {
    steps: [
      {
        id: "ask#1",
        kind: "ask",
        label: "ask",
        labelPattern: { head: "点子大王·" },
        lane: "actor#1",
        phase: "phase#1",
        repeat: "serial",
      },
      {
        id: "hole#be89c200",
        kind: "hole",
        label: "Step two：把脑洞变成菜单",
        lane: "main",
        phase: "phase#1",
      },
    ],
    lanes: [{ id: "main" }, { id: "actor#1", namePattern: { head: "点子大王·" } }],
    participants: [
      {
        id: "phase#1:actor#1[0]",
        phase: "phase#1",
        lane: "actor#1",
        steps: ["ask#1"],
        member: { index: 0, of: 3 },
      },
      {
        id: "phase#1:actor#1[1]",
        phase: "phase#1",
        lane: "actor#1",
        steps: ["ask#1"],
        member: { index: 1, of: 3 },
      },
      {
        id: "phase#1:actor#1[2]",
        phase: "phase#1",
        lane: "actor#1",
        steps: ["ask#1"],
        member: { index: 2, of: 3 },
      },
      { id: "phase#1:main", phase: "phase#1", lane: "main", steps: ["hole#be89c200"] },
    ],
    handoffs: [
      { from: "phase#1:actor#1[0]", to: "phase#1:main", types: ["Pitch"] },
      { from: "phase#1:actor#1[1]", to: "phase#1:main", types: ["Pitch"] },
      { from: "phase#1:actor#1[2]", to: "phase#1:main", types: ["Pitch"] },
    ],
    phases: [
      { id: "phase#1", name: "第One幕：Three位点子大王各抛One个Milk Tea店脑洞" },
      { id: "hole#be89c200", name: "Step two：把脑洞变成菜单" },
    ],
    phaseEdges: [{ from: "phase#1", to: "hole#be89c200" }],
    exits: ["hole#be89c200"],
    sink: ["hole#be89c200"],
    holes: [
      {
        siteId: "hole#be89c200",
        name: "Step two：把脑洞变成菜单",
        type: "HandbookReport",
        phase: "phase#1",
        tail: true,
      },
    ],
  };

  it("draws no pill for the lane an open hole waits on", () => {
    const model = buildWorkflowTimeline(REAL, undefined);
    const lanes = model.stations.map((station) => station.pills.map((pill) => pill.lane.id));
    expect(lanes).toEqual([["actor#1", "actor#1", "actor#1"], []]);
  });

  it("leaves the main lane out of a live run's pills too", () => {
    const run = {
      runId: "dwfrun-1",
      toolCallId: "call-1",
      status: "running",
      phases: [{ name: "第One幕：Three位点子大王各抛One个Milk Tea店脑洞", ordinal: 1 }],
      nodes: [],
      actors: [],
    } as unknown as WorkflowRunState;
    const pills = buildWorkflowTimeline(REAL, run).stations[0]!.pills;
    expect(pills.map((pill) => pill.lane.id)).toEqual(["actor#1", "actor#1", "actor#1"]);
  });

  it("does not count the main lane when numbering anonymous subagents", () => {
    const refs = laneRefsById([{ id: "main" }, { id: "actor#1" }]);
    expect(refs.get("actor#1")?.anonymousIndex).toBeUndefined();
  });
});
