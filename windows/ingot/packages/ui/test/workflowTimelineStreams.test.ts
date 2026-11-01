// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowCausalityGraphData } from "@/components/workflow-graph/types.js";
import { foldPhaseBands, foldPhaseEdges } from "@/components/workflow-timeline/timeline-bands.js";
import { buildWorkflowTimeline } from "@/components/workflow-timeline/timeline-model.js";
import { WorkflowTimeline } from "@/components/workflow-timeline/WorkflowTimeline.js";
import { spineLayout } from "@/app-shell/workflowRunSpine.js";
import { WorkflowRunPhaseList } from "@/app-shell/WorkflowRunPhaseList.js";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";

interface Spec {
  names: readonly string[];
  
  alongside?: Record<number, readonly number[]>;
  edges?: readonly (readonly [number, number])[];
  streams?: readonly (readonly [number, number])[];
  
  markerOnly?: readonly number[];
}

function graphOf({
  alongside = {},
  edges = [],
  markerOnly = [],
  names,
  streams = [],
}: Spec): WorkflowCausalityGraphData {
  const members = names.flatMap((_, i) => (markerOnly.includes(i) ? [] : [i]));
  return {
    steps: members.map((i) => ({
      id: `ask#${i + 1}`,
      kind: "ask" as const,
      label: names[i]!,
      lane: `actor#${i + 1}`,
      phase: `phase#${i + 1}`,
    })),
    lanes: members.map((i) => ({ id: `actor#${i + 1}`, name: `agent ${i + 1}` })),
    participants: members.map((i) => ({
      id: `phase#${i + 1}:actor#${i + 1}`,
      phase: `phase#${i + 1}`,
      lane: `actor#${i + 1}`,
      steps: [`ask#${i + 1}`],
    })),
    handoffs: [],
    phases: names.map((name, i) => ({
      id: `phase#${i + 1}`,
      name,
      ...(alongside[i] === undefined
        ? {}
        : { alongside: alongside[i]!.map((j) => `phase#${j + 1}`) }),
    })),
    phaseEdges: edges.map(([from, to]) => ({ from: `phase#${from + 1}`, to: `phase#${to + 1}` })),
    ...(streams.length === 0
      ? {}
      : {
          phaseStreams: streams.map(([from, to]) => ({
            from: `phase#${from + 1}`,
            to: `phase#${to + 1}`,
          })),
        }),
    exits: [`phase#${names.length}`],
  };
}

const PIPELINE: Spec = {
  alongside: { 1: [0], 2: [0, 1], 3: [0, 1, 2], 4: [0, 1, 2, 3] },
  names: ["Invent", "Post", "Tell", "Roast", "Bind"],
  streams: [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
  ],
};

type Node = WorkflowRunState["nodes"][number];
type Status = "done" | "running" | "queued" | "failed";
const node = (station: number, ordinal: number, status: Status): Node =>
  ({
    siteId: `ask#${station + 1}`,
    ordinal,
    actorSiteId: `actor#${station + 1}`,
    actorOrdinal: ordinal,
    phaseName: PIPELINE.names[station],
    ...(status === "done"
      ? { phase: "settled", outcome: "ok" }
      : status === "failed"
        ? { phase: "settled", outcome: "cancelled" }
        : status === "running"
          ? { phase: "executing" }
          : { phase: "queued" }),
  }) as Node;

function runOf(
  stages: readonly (readonly Status[])[],
  status: WorkflowRunState["status"] = "running",
): WorkflowRunState {
  return {
    runId: "dwfrun-1",
    toolCallId: "tool-wf-1",
    status,
    usage: { spentTokens: 0, nodesUsed: 0 },
    actors: [],
    nodes: stages.flatMap((list, station) => list.map((s, k) => node(station, k + 1, s))),
    phases: PIPELINE.names.map((name) => ({ name, rounds: 1 })),
    currentPhase: PIPELINE.names[4],
    lastEventSequence: 0,
  };
}

const lamps = (model: ReturnType<typeof buildWorkflowTimeline>) =>
  model.stations.map((station) => station.status);
const streamInks = (model: ReturnType<typeof buildWorkflowTimeline>) =>
  model.rails.filter((rail) => rail.kind === "stream").map((rail) => rail.ink);

afterEach(cleanup);

describe("foldPhaseBands · 流把 strand 从带里拿出来", () => {
  it("流水线的五站落在同One条轨道上，带整个解散", () => {
    const near = [[], [0], [0, 1], [0, 1, 2], [0, 1, 2, 3]];
    const streams = PIPELINE.streams!.map(([from, to]) => ({ from, to }));
    expect(foldPhaseBands(5, near, streams)).toEqual([]);
    expect(foldPhaseBands(5, near)).toEqual([
      { from: 0, to: 4, tracks: [[0], [1], [2], [3], [4]] },
    ]);
  });

  it("流够不着的 strand（旁路 future）仍占自己的轨道，带还Yes带", () => {
    const near = [[], [0], [0, 1], [0, 1, 2]];
    expect(
      foldPhaseBands(4, near, [
        { from: 0, to: 1 },
        { from: 1, to: 2 },
      ]),
    ).toEqual([{ from: 0, to: 3, tracks: [[0, 1, 2], [3]] }]);
  });

  it("汇入：两个互不可达的生产者，消费者跟着先声明的那个", () => {
    expect(
      foldPhaseBands(
        3,
        [[], [0], [0, 1]],
        [
          { from: 0, to: 2 },
          { from: 1, to: 2 },
        ],
      ),
    ).toEqual([{ from: 0, to: 2, tracks: [[0, 2], [1]] }]);
  });
});

describe("foldPhaseEdges · 流轨与流弧", () => {
  it("解散的带：E邻两站之间Yes流轨，没有分叉、汇合与双线段", () => {
    const streams = PIPELINE.streams!.map(([from, to]) => ({ from, to }));
    const fold = foldPhaseEdges(5, [], [], streams);
    expect(fold.bands).toEqual([]);
    expect(fold.rails).toEqual([
      { from: 0, kind: "stream", to: 1 },
      { from: 1, kind: "stream", to: 2 },
      { from: 2, kind: "stream", to: 3 },
      { from: 3, kind: "stream", to: 4 },
    ]);
    expect(fold.arcs).toEqual([]);
  });

  it("流轨顶替同One对站的普通轨道段；带inner同轨道E邻的One对也Yes流轨", () => {
    const bands = foldPhaseBands(
      5,
      [[], [0], [0, 1], [0, 1, 2], []],
      [
        { from: 0, to: 1 },
        { from: 1, to: 2 },
      ],
    );
    const fold = foldPhaseEdges(
      5,
      bands,
      [
        [0, 1],
        [2, 4],
        [3, 4],
      ].map(([from, to]) => ({ from: from!, to: to! })),
      [
        { from: 0, to: 1 },
        { from: 1, to: 2 },
      ],
    );
    expect(fold.rails.filter((rail) => rail.from === 0 && rail.to === 1)).toEqual([
      { from: 0, kind: "stream", to: 1 },
    ]);
    expect(fold.rails).toContainEqual({ from: 1, kind: "stream", to: 2 });
  });

  it("不E邻的流YesOne条流弧：同轨道的在那条轨道的空里，它不Yes回环", () => {
    const fold = foldPhaseEdges(3, [], [{ from: 0, to: 1 }], [{ from: 0, to: 2 }]);
    expect(fold.arcs).toEqual([{ air: 0, from: 0, stream: true, to: 2 }]);
  });
});

describe("buildWorkflowTimeline · 流水线", () => {
  it("五站One条线：没有带，四段流轨，全在主线上", () => {
    const model = buildWorkflowTimeline(graphOf(PIPELINE), undefined);
    expect(model.bands).toEqual([]);
    expect(model.stations.map((station) => station.track)).toEqual([0, 0, 0, 0, 0]);
    expect(model.rails.map((rail) => [rail.from, rail.to, rail.kind])).toEqual([
      [0, 1, "stream"],
      [1, 2, "stream"],
      [2, 3, "stream"],
      [3, 4, "stream"],
    ]);
    expect(streamInks(model)).toEqual(["faint", "faint", "faint", "faint"]);
  });

  it("t≈10s：还没收到活的站Yes pending，不因为Label记进入过就绿，也不替 currentPhase 背灯", () => {
    const model = buildWorkflowTimeline(
      graphOf(PIPELINE),
      runOf([
        ["done", "done", "running", "queued"],
        ["done", "running", "queued"],
        ["running"],
        [],
        [],
      ]),
    );
    expect(lamps(model)).toEqual(["running", "running", "running", "pending", "pending"]);
    expect(streamInks(model)).toEqual(["march", "march", "faint", "faint"]);
  });

  it("t≈40s：上游Run完的流轨Yes strong；全在Queued的站Yes pending，它的入口流轨也 strong", () => {
    const model = buildWorkflowTimeline(
      graphOf(PIPELINE),
      runOf([
        ["done", "done", "done"],
        ["done", "running", "queued"],
        ["done", "running"],
        ["running"],
        ["queued"],
      ]),
    );
    expect(lamps(model)).toEqual(["done", "running", "running", "running", "pending"]);
    expect(streamInks(model)).toEqual(["strong", "march", "march", "strong"]);
  });

  it("自己的节点都结算了、上游还开着的站仍Yes running：还会有活进来", () => {
    const model = buildWorkflowTimeline(
      graphOf(PIPELINE),
      runOf([["done", "running"], ["done"], ["done"], [], []]),
    );
    expect(lamps(model)).toEqual(["running", "running", "running", "pending", "pending"]);
  });

  it("Stop的 run：从没收到活的站Yes pending，不Yes done 也不Yes failed", () => {
    const model = buildWorkflowTimeline(
      graphOf(PIPELINE),
      runOf([["done", "done"], ["done", "done"], ["failed", "failed"], [], []], "stopped"),
    );
    expect(lamps(model)).toEqual(["done", "done", "failed", "pending", "pending"]);
    expect(streamInks(model)).toEqual(["strong", "strong", "faint", "faint"]);
  });

  it("Completed的 run：进入过却One件活都没收到的站Yes done", () => {
    const model = buildWorkflowTimeline(
      graphOf(PIPELINE),
      runOf([["done"], ["done"], ["done"], ["done"], []], "completed"),
    );
    expect(lamps(model)).toEqual(["done", "done", "done", "done", "done"]);
  });

  it("流轨与流弧都不行进：它们的墨说的Yes有没有东西在过，不Yes控制从哪来", () => {
    const model = buildWorkflowTimeline(
      graphOf(PIPELINE),
      runOf([["done"], ["running"], [], [], []]),
    );
    expect(model.rails.every((rail) => rail.kind === "stream")).toBe(true);
    expect(model.rails[0]!.ink).toBe("strong");
    expect(model.stations.every((station) => !station.onLoop)).toBe(true);
  });
});

describe("buildWorkflowTimeline · 并行但没有流的站", () => {
  it("两个互不E干的 future：没Start的那条Yes pending，不Yes done", () => {
    const spec: Spec = { alongside: { 1: [0] }, edges: [[1, 2]], names: ["A", "B", "C"] };
    const state = {
      ...runOf([[], ["running"], []]),
      phases: [
        { name: "A", rounds: 1 },
        { name: "B", rounds: 1 },
      ],
      currentPhase: "B",
      nodes: [{ siteId: "ask#2", ordinal: 1, phase: "executing" } as Node],
    };
    const model = buildWorkflowTimeline(graphOf(spec), state);
    expect(lamps(model)).toEqual(["pending", "running", "pending"]);
    expect(model.bands).toHaveLength(1);
  });

  it("只有Label记、没有Members step 的Phase照Old按进入记录点灯", () => {
    const spec: Spec = { ...PIPELINE, markerOnly: [3] };
    const model = buildWorkflowTimeline(
      graphOf(spec),
      runOf([["done"], ["done"], ["running"], [], []]),
    );
    expect(model.stations[3]!.status).toBe("done");
  });
});

function renderCard(spec: Spec, state?: WorkflowRunState) {
  const model = buildWorkflowTimeline(graphOf(spec), state);
  return render(
    createElement(
      CfIntlProvider,
      { initialLocale: "en-US" },
      createElement(WorkflowTimeline, { model }),
    ),
  );
}

describe("WorkflowTimeline · 流轨", () => {
  it("流水线画在站头行上：轨道段带Three枚 chevron，墨与ModelOne致", () => {
    const view = renderCard(PIPELINE, runOf([["done", "running"], ["running"], [], [], []]));
    expect(view.queryAllByTestId("workflow-timeline-leader")).toHaveLength(0);
    const rails = view.getAllByTestId("workflow-timeline-rail");
    expect(rails.map((rail) => rail.getAttribute("data-rail-kind"))).toEqual([
      "stream",
      "stream",
      "stream",
      "stream",
    ]);
    expect(rails[0]!.className).toContain("wf-rail-stream");
    const chevrons = rails.map((rail) => within(rail).getByTestId("workflow-stream-chevrons"));
    expect(chevrons.map((group) => group.getAttribute("data-stream-ink"))).toEqual([
      "march",
      "faint",
      "faint",
      "faint",
    ]);
    expect(chevrons[0]!.querySelectorAll("path")).toHaveLength(3);
  });

  it("带inner同轨道E邻的流也画 chevron：SVG 里轨道段DisconnectOne截，chevron 站在缺口里", () => {
    const view = renderCard({
      alongside: { 1: [0], 2: [0, 1], 3: [0, 1, 2] },
      names: ["Crawl", "Clean", "Index", "Monitor"],
      streams: [
        [0, 1],
        [1, 2],
      ],
    });
    const stream = view
      .getAllByTestId("workflow-timeline-rail")
      .filter((rail) => rail.getAttribute("data-rail-kind") === "stream");
    expect(stream.map((rail) => rail.getAttribute("data-rail-from"))).toEqual(["0", "1"]);
    for (const rail of stream) {
      expect(within(rail as HTMLElement).getByTestId("workflow-stream-chevrons")).toBeDefined();
      expect(rail.querySelector("path")!.getAttribute("d")!.match(/M/g)).toHaveLength(2);
    }
  });
});

describe("脊线 · 流轨", () => {
  it("解散的带没有接头行；流轨的两截在节Boundaries让出缺口，两枚 chevron 朝下站在里面", () => {
    const graph = graphOf(PIPELINE);
    const state = runOf([["done", "running"], ["running"], [], [], []]);
    const model = buildWorkflowTimeline(graph, state);
    const layout = spineLayout(model);
    expect(layout.gutter).toBe(0);
    expect(layout.sections.every((section) => !section.fork && !section.merge)).toBe(true);
    expect(layout.sections[0]!.rails).toEqual([
      { ink: "march", position: "below", stream: true, track: 0 },
    ]);
    const view = render(
      createElement(
        CfIntlProvider,
        { initialLocale: "en-US" },
        createElement(WorkflowRunPhaseList, { graph, model, pendingQuestions: [], run: state }),
      ),
    );
    expect(view.queryAllByTestId("workflow-run-spine-joint")).toHaveLength(0);
    const groups = view.getAllByTestId("workflow-stream-chevrons");
    expect(groups.map((group) => group.getAttribute("data-stream-ink"))).toEqual([
      "march",
      "faint",
      "faint",
      "faint",
    ]);
    expect(groups[0]!.querySelectorAll("path")).toHaveLength(2);
  });
});
