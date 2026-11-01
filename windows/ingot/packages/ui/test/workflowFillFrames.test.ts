// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowCausalityGraphData } from "@/components/workflow-graph/types.js";
import {
  FRAME_OUTSET,
  fillDepthOf,
  fillMarksOf,
  framePath,
  legendGaps,
  spineFrameBox,
  timelineFrames,
} from "@/components/workflow-timeline/timeline-frames.js";
import {
  HEAD_ROW,
  STATION_PITCH,
  STATION_WIDTH,
  timelineLayout,
} from "@/components/workflow-timeline/timeline-geometry.js";
import { buildWorkflowTimeline } from "@/components/workflow-timeline/timeline-model.js";
import { WorkflowTimeline } from "@/components/workflow-timeline/WorkflowTimeline.js";
import { WorkflowRunPhaseList } from "@/app-shell/WorkflowRunPhaseList.js";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";

const H1 = "hole#a0000001";
const H2 = "hole#a0000002";

type Step = WorkflowCausalityGraphData["steps"][number];
const STEPS: Step[] = [
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
  { id: `${H2}/ask#1`, kind: "ask", label: "judge", lane: `${H2}/actor#1`, phase: H2, fill: H2 },
];

const GRAPH: WorkflowCausalityGraphData = {
  steps: STEPS,
  lanes: [
    { id: "actor#1", name: "侦察Member" },
    { id: `${H1}/actor#1`, name: "冒烟Member" },
    { id: `${H1}/actor#2`, name: "分组员" },
    { id: "actor#2", name: "组Member" },
    { id: `${H2}/actor#1`, name: "评委" },
  ],
  participants: STEPS.map((step) => ({
    id: `${step.phase}:${step.lane}`,
    lane: step.lane,
    phase: step.phase!,
    steps: [step.id],
  })),
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
  holes: [],
};

function run(filledAt = 1): WorkflowRunState {
  return {
    runId: "dwfrun-1",
    toolCallId: "tool-wf-1",
    status: "running",
    usage: { spentTokens: 0, nodesUsed: 0 },
    actors: [],
    nodes: [],
    lastEventSequence: 0,
    holes: [
      { siteId: H1, ordinal: 1, name: "决定分组", state: "filled", filledAt },
      { siteId: H2, ordinal: 1, name: "评判", state: "filled", filledAt },
    ],
  };
}

function wrap(node: ReturnType<typeof createElement>) {
  return render(createElement(CfIntlProvider, { initialLocale: "zh-CN" }, node));
}

afterEach(cleanup);

describe("框的几何", () => {
  it("One笔：从上缘的笔 x 出发、顺时针、回到笔 x；1px 线落在半像素上；没有笔 x 时从Left上角圆角之后From", () => {
    const d = framePath({ x0: 184, y0: 12, x1: 560, y1: 100, start: 209 });
    expect(d.startsWith("M209,12.5 H551.5")).toBe(true);
    expect(d.endsWith("H209")).toBe(true);
    expect(d).toContain("Q559.5,12.5 559.5,20.5");
    expect(d).toContain("V91.5");
    expect(d).toContain("H192.5");
    const corner = framePath({ x0: 0, y0: 0, x1: 100, y1: 50 });
    expect(corner.startsWith("M8.5,0.5")).toBe(true);
    expect(corner.endsWith("H8.5")).toBe(true);
  });

  it("有头的Complete：首列Left缘 − 8 到末列Right缘 + 8，头那One行的Medium线到Max那One列药丸之下 8px，From笔在第One盏灯", () => {
    const model = buildWorkflowTimeline(GRAPH, run());
    expect(model.fills?.map((fill) => [fill.holeId, fill.from, fill.to])).toEqual([[H1, 1, 2]]);
    const layout = timelineLayout(model.arcs, model.bands, true);
    const frames = timelineFrames({
      columnHeight: (i) => (i === 2 ? 70 : 32),
      fills: model.fills!,
      height: 400,
      inset: 0,
      layout,
      parents: model.holeParents ?? {},
      stations: model.stations,
      width: 5 * STATION_PITCH,
    });
    const h1 = frames.find((frame) => frame.holeId === H1)!;
    expect(h1.box).toEqual({
      x0: STATION_PITCH - FRAME_OUTSET,
      x1: 2 * STATION_PITCH + STATION_WIDTH + FRAME_OUTSET,
      y0: HEAD_ROW / 2,
      y1: layout.pillsTop + 70 + 8,
      start: STATION_PITCH + 17,
    });
    const h2 = frames.find((frame) => frame.holeId === H2)!;
    expect(h2.box).toEqual({
      x0: 4 * STATION_PITCH - FRAME_OUTSET,
      x1: 4 * STATION_PITCH + STATION_WIDTH + FRAME_OUTSET,
      y0: layout.rowY[0]! - 12 - 4,
      y1: layout.pillsTop + 32 + 8,
    });
  });

  it("那几列没有药丸（卡Collapse）时框只到轨道行之下 4px；首列与末列的框夹在画布里", () => {
    const model = buildWorkflowTimeline(GRAPH, run());
    const layout = timelineLayout(model.arcs, model.bands, true);
    const fills = [{ holeId: H1, name: "决定分组", from: 0, to: 4 }];
    const [frame] = timelineFrames({
      columnHeight: () => 0,
      fills,
      height: 90,
      inset: 0,
      layout,
      parents: {},
      stations: model.stations.map(({ track }) => ({ track })),
      width: 4 * STATION_PITCH + STATION_WIDTH,
    });
    expect(frame!.box.y1).toBe(layout.pillsTop - 4);
    expect(frame!.box.x0).toBe(0);
    expect(frame!.box.x1).toBe(4 * STATION_PITCH + STATION_WIDTH);
  });

  it("与outer层同From于One列的嵌套框每层Left、Right、下各收 4px；From点不同的不收", () => {
    const layout = timelineLayout([], [], true);
    const fills = [
      { holeId: H1, name: "外", from: 1, to: 3 },
      { holeId: H2, name: "内", from: 1, to: 2 },
    ];
    const base = {
      columnHeight: () => 32,
      height: 400,
      inset: 0,
      layout,
      stations: [],
      width: 2000,
    };
    const [outer, inner] = timelineFrames({ ...base, fills, parents: { [H2]: H1 } });
    expect(inner!.box.x0 - outer!.box.x0).toBe(4);
    expect(inner!.box.y1).toBe(outer!.box.y1 - 4);
    expect(inner!.box.y0).toBe(outer!.box.y0);
    const [, unrelated] = timelineFrames({ ...base, fills, parents: {} });
    expect(unrelated!.box.x0).toBe(outer!.box.x0);
  });

  it("笔Label：只收Filled全、又不在 fills 里的留白站；图例按头那One行两侧各让 4px 挖空，量不到宽度不挖", () => {
    const model = buildWorkflowTimeline(GRAPH, run());
    expect(fillMarksOf(model.stations, model.fills ?? [])).toEqual([
      { holeId: H2, index: 4, filledAt: 1 },
    ]);
    expect(
      legendGaps([
        { left: 203, width: 120 },
        { left: 395, width: 0 },
      ]),
    ).toEqual([{ x: 199, width: 128 }]);
    expect(fillDepthOf(H2, [{ holeId: H1 }], { [H2]: H1 })).toBe(1);
  });

  it("侧板：x 8 → Right缘 − 12，嵌套每层各收 4px；有头的从TitleMedium线到最后One节之下 4px，From笔在轨道 x；无头的上下各收 2px", () => {
    expect(spineFrameBox({ top: 100, bottom: 300, width: 440, depth: 0, headed: true })).toEqual({
      x0: 8,
      x1: 428,
      y0: 112,
      y1: 304,
      start: 21,
    });
    expect(spineFrameBox({ top: 100, bottom: 300, width: 440, depth: 1, headed: false })).toEqual({
      x0: 12,
      x1: 424,
      y0: 102,
      y1: 298,
    });
  });
});

describe("卡：只有头点亮框", () => {
  it("Point to针在站or药丸上什么都不亮；在头上只亮这One个框、头换前景色；离开时熄", () => {
    const view = wrap(
      createElement(WorkflowTimeline, { model: buildWorkflowTimeline(GRAPH, run()) }),
    );
    const frameOf = (id: string) => view.container.querySelector(`[data-fill-frame="${id}"]`)!;
    expect(
      view.container.querySelectorAll('[data-testid="workflow-timeline-fill-frame"]'),
    ).toHaveLength(2);
    const station = view.container.querySelector(
      `[data-testid="workflow-timeline-station"][data-fill="${H1}"]`,
    )!;
    fireEvent.pointerOver(station);
    expect(view.container.querySelector('[data-fill-on="true"]')).toBeNull();
    const pill = view.container.querySelector(
      `[data-testid="workflow-timeline-pills"][data-fill="${H1}"]`,
    )!;
    fireEvent.pointerOver(pill);
    expect(view.container.querySelector('[data-fill-on="true"]')).toBeNull();

    const head = view.getByTestId("workflow-timeline-fill-head");
    fireEvent.pointerOver(head.querySelector("svg")!);
    expect(frameOf(H1).getAttribute("data-fill-on")).toBe("true");
    expect(frameOf(H2).getAttribute("data-fill-on")).toBeNull();
    expect(head.getAttribute("data-fill-on")).toBe("true");
    expect(head.className).toContain("text-foreground");
    fireEvent.pointerLeave(view.getByTestId("workflow-timeline"));
    expect(view.container.querySelector('[data-fill-on="true"]')).toBeNull();
  });

  it("弧那One层 SVG 不接Point to针：它铺满整张Timeline、画在头之后，接了就吞掉头的悬停与点击", () => {
    const graph: WorkflowCausalityGraphData = {
      ...GRAPH,
      phaseEdges: [
        ...(GRAPH.phaseEdges ?? []),
        { from: "phase#2", to: `${H1}/phase#1`, back: true },
      ],
    };
    const view = wrap(
      createElement(WorkflowTimeline, { model: buildWorkflowTimeline(graph, run()) }),
    );
    const layers = [...view.container.querySelectorAll("svg")].filter(
      (svg) => svg.querySelector("marker") !== null,
    );
    expect(layers.length).toBeGreaterThan(0);
    for (const layer of layers)
      expect(layer.getAttribute("class")).toContain("pointer-events-none");
  });

  it("无Phase的Complete：Point to针落在站头的笔Label上，框住这One列", () => {
    const view = wrap(
      createElement(WorkflowTimeline, { model: buildWorkflowTimeline(GRAPH, run()) }),
    );
    const mark = view.getByTestId("workflow-hole-fill-mark");
    expect(mark.getAttribute("data-fill-head")).toBe(H2);
    fireEvent.pointerOver(mark.querySelector("svg")!);
    expect(
      view.container.querySelector(`[data-fill-frame="${H2}"]`)!.getAttribute("data-fill-on"),
    ).toBe("true");
    expect(
      view.container.querySelector(`[data-fill-frame="${H1}"]`)!.getAttribute("data-fill-on"),
    ).toBeNull();
  });

  it("Complete刚接进 run：两个框都带New鲜态、没有Point to针也亮", () => {
    const view = wrap(
      createElement(WorkflowTimeline, { model: buildWorkflowTimeline(GRAPH, run(Date.now())) }),
    );
    const fresh = view.container.querySelectorAll(
      '[data-testid="workflow-timeline-fill-frame"][data-fill-fresh="true"]',
    );
    expect(fresh).toHaveLength(2);
    for (const frame of fresh) expect(frame.getAttribute("class")).toContain("wf-fill-frame-fresh");
  });
});

describe("侧板：同One个框竖着画，不缩进", () => {
  function pane(filledAt = 1) {
    const model = buildWorkflowTimeline(GRAPH, run(filledAt));
    return wrap(
      createElement(WorkflowRunPhaseList, {
        graph: GRAPH,
        model,
        pendingQuestions: [],
        run: run(filledAt),
      }),
    );
  }

  it("Complete写下的节与别的节同One条TextCharacter列：Title行与节头都不再多缩 12px", () => {
    const view = pane();
    const sections = view.getAllByTestId("workflow-run-phase");
    const inFill = sections.filter((section) => section.getAttribute("data-phase-fill") === H1);
    expect(inFill).toHaveLength(2);
    const plain = sections.find((section) => section.getAttribute("data-phase-id") === "phase#1")!;
    const pad = (section: HTMLElement) =>
      within(section).getByTestId("workflow-run-phase-toggle").style.paddingLeft;
    for (const section of inFill) expect(pad(section)).toBe(pad(plain));
    expect(view.getByTestId("workflow-run-fill-heading").style.paddingLeft).toBe("");
  });

  it("Title行Yes头：Point to针落在它上面画出这次Complete的框；落在节头上不画；笔Label框住它那One节", () => {
    const view = pane();
    const frames = view.container.querySelectorAll('[data-testid="workflow-run-fill-frame"]');
    expect([...frames].map((frame) => frame.getAttribute("data-fill-frame"))).toEqual([H1, H2]);
    const frameOf = (id: string) =>
      view.container.querySelector(
        `[data-testid="workflow-run-fill-frame"][data-fill-frame="${id}"]`,
      )!;
    const toggle = within(view.getAllByTestId("workflow-run-phase")[1]!).getByTestId(
      "workflow-run-phase-toggle",
    );
    fireEvent.pointerOver(toggle);
    expect(view.container.querySelector('[data-fill-on="true"]')).toBeNull();
    const heading = view.getByTestId("workflow-run-fill-heading");
    expect(heading.getAttribute("data-fill-head")).toBe(H1);
    fireEvent.pointerOver(heading);
    expect(frameOf(H1).getAttribute("data-fill-on")).toBe("true");
    expect(heading.getAttribute("data-fill-on")).toBe("true");
    expect(frameOf(H2).getAttribute("data-fill-on")).toBeNull();
    fireEvent.pointerOver(view.getByTestId("workflow-hole-fill-mark").querySelector("svg")!);
    expect(frameOf(H2).getAttribute("data-fill-on")).toBe("true");
    expect(frameOf(H1).getAttribute("data-fill-on")).toBeNull();
    fireEvent.pointerLeave(view.getByTestId("workflow-run-phases"));
    expect(view.container.querySelector('[data-fill-on="true"]')).toBeNull();
  });

  it("New鲜的两秒：侧板的框也自己画One遍，Title染警示色", () => {
    const view = pane(Date.now());
    const frame = view.container.querySelector(
      `[data-testid="workflow-run-fill-frame"][data-fill-frame="${H1}"]`,
    )!;
    expect(frame.getAttribute("data-fill-fresh")).toBe("true");
    expect(view.getByTestId("workflow-run-fill-heading").className).toContain("text-warning");
  });
});
