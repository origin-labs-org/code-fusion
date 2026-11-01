// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkflowCausalityGraphData } from "@/components/workflow-graph/types.js";
import { buildWorkflowTimeline } from "@/components/workflow-timeline/timeline-model.js";
import { arcTerminalOffsets, lampX } from "@/components/workflow-timeline/timeline-geometry.js";
import { WorkflowTimeline } from "@/components/workflow-timeline/WorkflowTimeline.js";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";

interface GraphSpec {
  names: readonly string[];
  
  alongside?: Record<number, readonly number[]>;
  edges: readonly (readonly [number, number])[];
}

function graphOf({ alongside = {}, edges, names }: GraphSpec): WorkflowCausalityGraphData {
  return {
    steps: names.map((name, i) => ({
      id: `ask#${i + 1}`,
      kind: "ask",
      label: name,
      line: i + 1,
      column: 1,
      lane: "actor#1",
      phase: `phase#${i + 1}`,
    })),
    lanes: [{ id: "actor#1", name: "worker", line: 1, column: 1 }],
    participants: names.map((_, i) => ({
      id: `phase#${i + 1}:actor#1`,
      phase: `phase#${i + 1}`,
      lane: "actor#1",
      steps: [`ask#${i + 1}`],
    })),
    handoffs: [],
    phases: names.map((name, i) => ({
      id: `phase#${i + 1}`,
      name,
      line: i + 1,
      column: 1,
      ...(alongside[i] === undefined
        ? {}
        : { alongside: alongside[i]!.map((j) => `phase#${j + 1}`) }),
    })),
    phaseEdges: edges.map(([from, to]) => ({ from: `phase#${from + 1}`, to: `phase#${to + 1}` })),
    exits: [`phase#${names.length}`],
  } as WorkflowCausalityGraphData;
}

const modelOf = (spec: GraphSpec) => buildWorkflowTimeline(graphOf(spec));

function offsetsOf(spec: GraphSpec): Record<string, { takeoff: number; landing: number }> {
  const model = modelOf(spec);
  const { landing, takeoff } = arcTerminalOffsets(model.arcs, model.bands, model.stations);
  return Object.fromEntries(
    model.arcs.map((arc, j) => [
      `${arc.from}>${arc.to}`,
      { landing: landing[j]! + 0, takeoff: takeoff[j]! + 0 },
    ]),
  );
}

const chain = (n: number): [number, number][] =>
  Array.from({ length: n - 1 }, (_, i) => [i, i + 1] as [number, number]);

const HOPS: GraphSpec = {
  edges: [...chain(5), [0, 2], [2, 4]],
  names: ["plan", "gather", "draft", "review", "publish"],
};

const TWO_CHOICES: GraphSpec = {
  edges: [
    [0, 1],
    [0, 2],
    [1, 2],
    [1, 3],
    [2, 1],
    [2, 3],
  ],
  names: ["choose", "left", "right", "next"],
};

const STRESS: GraphSpec = {
  alongside: { 9: [8] },
  edges: [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [3, 5],
    [4, 5],
    [4, 6],
    [5, 4],
    [5, 6],
    [6, 7],
    [7, 8],
    [7, 9],
    [8, 10],
    [9, 10],
  ],
  names: [
    "串行链：两步依赖",
    "并行扇出：四方同算",
    "回环门禁：修复到达Label为止",
    "条件分支：按阈Value选边",
    "支路A：High门限Summary",
    "支路乙：Low门限Summary",
    "Mixed扇出：逐项产出即Review",
    "ConcurrencyE位：双翼交叠探针",
    "ConcurrencyLeft翼：先行占位",
    "ConcurrencyRight翼：后行占位",
    "汇合Wrap-up：成Text与Publish",
  ],
};

afterEach(cleanup);

describe("arcTerminalOffsets", () => {
  it("a station with one terminal keeps the lamp's centre", () => {
    expect(offsetsOf({ edges: [...chain(4), [3, 0]], names: ["a", "b", "c", "d"] })).toEqual({
      "3>0": { landing: 0, takeoff: 0 },
    });
    expect(offsetsOf({ edges: [...chain(6), [0, 2], [5, 3]], names: "abcdef".split("") })).toEqual({
      "0>2": { landing: 0, takeoff: 0 },
      "5>3": { landing: 0, takeoff: 0 },
    });
  });

  it("an arc in from the left and an arc out to the right take the left and right slots", () => {
    const model = modelOf(HOPS);
    expect(model.arcs.map((arc) => [arc.from, arc.to, arc.lane])).toEqual([
      [0, 2, 0],
      [2, 4, 1],
    ]);
    expect(offsetsOf(HOPS)).toEqual({
      "0>2": { landing: -5, takeoff: 0 },
      "2>4": { landing: 0, takeoff: 5 },
    });
  });

  it("on one side the arc in the lowest lane stands outermost, landing or takeoff alike", () => {
    const model = modelOf(TWO_CHOICES);
    expect(model.arcs.map((arc) => [arc.from, arc.to, arc.lane])).toEqual([
      [2, 1, 0],
      [0, 2, 1],
      [1, 3, 2],
    ]);
    expect(offsetsOf(TWO_CHOICES)).toEqual({
      "0>2": { landing: 5, takeoff: 0 },
      "1>3": { landing: 0, takeoff: -5 },
      "2>1": { landing: 5, takeoff: -5 },
    });
  });

  it("a fan-out nests: three takeoffs to the right, lane 0 outermost", () => {
    const spec: GraphSpec = {
      edges: [...chain(5), [0, 2], [0, 3], [0, 4]],
      names: ["triage", "small", "medium", "large", "close"],
    };
    expect(offsetsOf(spec)).toEqual({
      "0>2": { landing: 0, takeoff: 10 },
      "0>3": { landing: 0, takeoff: 0 },
      "0>4": { landing: 0, takeoff: -10 },
    });
  });

  it("both sides at once: leftward terminals first, then rightward ones", () => {
    const spec: GraphSpec = {
      edges: [...chain(5), [0, 2], [2, 4], [3, 2], [2, 0]],
      names: ["a", "b", "c", "d", "e"],
    };
    const lanes = Object.fromEntries(
      modelOf(spec).arcs.map((arc) => [`${arc.from}>${arc.to}`, arc.lane]),
    );
    expect(lanes).toEqual({ "0>2": 1, "2>0": 3, "2>4": 2, "3>2": 0 });
    expect(offsetsOf(spec)).toEqual({
      "0>2": { landing: -15, takeoff: 5 },
      "2>0": { landing: -5, takeoff: -5 },
      "2>4": { landing: 0, takeoff: 5 },
      "3>2": { landing: 15, takeoff: 0 },
    });
  });

  it("a band's fork and merge points take no slot and do not count at the lamp", () => {
    const spec: GraphSpec = {
      alongside: { 4: [3], 5: [4] },
      edges: [
        [0, 1],
        [1, 2],
        [2, 3],
        [2, 4],
        [3, 5],
        [4, 6],
        [5, 6],
        [6, 7],
        [5, 3],
        [0, 3],
        [1, 4],
        [5, 7],
      ],
      names: ["S", "T", "P", "B", "C", "D", "J", "X"],
    };
    const model = modelOf(spec);
    expect(
      model.bands.map((band) => [
        band.from,
        band.to,
        band.pred,
        band.join,
        band.tracks.map((track) => track.stations),
      ]),
    ).toEqual([[3, 5, 2, 6, [[3, 5], [4]]]]);
    expect(model.arcs.map((arc) => [arc.from, arc.to, arc.air])).toEqual(
      expect.arrayContaining([
        [5, 3, 0],
        [0, 3, 1],
        [1, 3, 1],
        [5, 7, 1],
      ]),
    );
    expect(offsetsOf(spec)).toEqual({
      "0>3": { landing: 0, takeoff: 0 },
      "1>3": { landing: 0, takeoff: 0 },
      "5>3": { landing: 0, takeoff: 0 },
      "5>7": { landing: 0, takeoff: 0 },
    });
  });
});

describe("WorkflowTimeline arc terminals", () => {
  function terminalsOf(spec: GraphSpec) {
    const model = modelOf(spec);
    const view = render(
      createElement(
        CfIntlProvider,
        { initialLocale: "en-US" },
        createElement(WorkflowTimeline, { model }),
      ),
    );
    const byStation = new Map<number, number[]>();
    const add = (station: number, x: number) =>
      byStation.set(
        station,
        [...(byStation.get(station) ?? []), x].sort((l, r) => l - r),
      );
    for (const arc of view.getAllByTestId("workflow-timeline-arc")) {
      const d = arc.querySelector("path")!.getAttribute("d")!;
      // M xa,ya V … Q xa,ly … H … Q xb,ly xb,ly+8 V yb
      const xa = Number(/^M(-?[\d.]+),/u.exec(d)![1]);
      const xb = Number([...d.matchAll(/Q(-?[\d.]+),/gu)].at(-1)![1]);
      add(Number(arc.getAttribute("data-arc-from")), xa);
      add(Number(arc.getAttribute("data-arc-to")), xb);
    }
    return { byStation, model };
  }

  it("Workflow压力Tests: 支路A and 支路乙 each get two slots, no shared vertical", () => {
    const { byStation, model } = terminalsOf(STRESS);
    expect(model.arcs.map((arc) => [arc.from, arc.to, arc.lane])).toEqual([
      [5, 4, 0],
      [3, 5, 1],
      [4, 6, 2],
    ]);
    const lamp = (i: number) => lampX(i, 0);
    expect(Object.fromEntries(byStation)).toEqual({
      3: [lamp(3)],
      4: [lamp(4) - 5, lamp(4) + 5],
      5: [lamp(5) - 5, lamp(5) + 5],
      6: [lamp(6)],
    });
  });

  it("the two choices reusing phase names draw four distinct verticals", () => {
    const { byStation } = terminalsOf(TWO_CHOICES);
    for (const xs of byStation.values()) expect(new Set(xs).size).toBe(xs.length);
    expect(byStation.get(1)).toEqual([lampX(1) - 5, lampX(1) + 5]);
    expect(byStation.get(2)).toEqual([lampX(2) - 5, lampX(2) + 5]);
  });
});
