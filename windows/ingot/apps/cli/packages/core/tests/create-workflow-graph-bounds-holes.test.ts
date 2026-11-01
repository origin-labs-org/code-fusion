import { describe, expect, it } from "vitest";
import { CreateWorkflowCausalityGraphSchema } from "@origin-ai/cf-contracts";
import {
  MAIN_LANE,
  type CausalityGraph,
  type ControlFlowGraph,
  type FlowHole,
} from "@origin-ai/cf-dynamic-workflow/projections";
import { boundCausalityGraph } from "../src/tool/handlers/create-workflow-graph-bounds.js";

function step(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    kind: "ask" as const,
    label: id,
    loc: { line: 1, column: 1 },
    lane: "actor#1",
    region: "root",
    certainty: "always" as const,
    ...extra,
  };
}

function graphWith(holes: FlowHole[] | undefined, stepsExtra: Record<string, unknown> = {}) {
  const causality = {
    steps: [
      step("ask#1", { phase: "phase#1" }),
      step("hole#1/ask#1", { phase: "hole#1", ...stepsExtra }),
      step("hole#2", { kind: "hole", label: "收尾", lane: MAIN_LANE, phase: "phase#1" }),
    ],
    regions: [],
    lanes: [{ id: "actor#1", name: "a" }, { id: MAIN_LANE }],
    edges: [],
    phases: [
      { id: "phase#1", name: "A" },
      { id: "hole#1", name: "决定分组" },
    ],
  } as unknown as CausalityGraph;
  const flow = {
    nodes: [],
    edges: [],
    phases: [
      { id: "phase#1", name: "A" },
      { id: "hole#1", name: "决定分组", fill: "hole#1" },
    ],
    ...(holes === undefined ? {} : { holes }),
  } as unknown as ControlFlowGraph;
  return { causality, flow };
}

describe("boundCausalityGraph — holes and fills", () => {
  it("copies the open holes from the flow graph in order and the fill marks on phases and steps", () => {
    const { causality, flow } = graphWith(
      [{ siteId: "hole#2", name: "收尾", type: "string[]", phase: "phase#1", tail: true }],
      { fill: "hole#1" },
    );
    const bound = boundCausalityGraph(causality, flow);
    expect(bound.holes).toEqual([
      { siteId: "hole#2", name: "收尾", type: "string[]", phase: "phase#1", tail: true },
    ]);
    expect(bound.steps.find((s) => s.id === "hole#1/ask#1")?.fill).toBe("hole#1");
    expect(bound.steps.find((s) => s.id === "ask#1")?.fill).toBeUndefined();
    expect(bound.phases?.find((p) => p.id === "hole#1")?.fill).toBe("hole#1");
    expect(bound.phases?.find((p) => p.id === "phase#1")?.fill).toBeUndefined();
    expect(bound.steps.find((s) => s.id === "hole#2")).toMatchObject({
      kind: "hole",
      lane: MAIN_LANE,
    });
    expect(bound.lanes.map((lane) => lane.id)).toContain(MAIN_LANE);
    expect(bound.truncated).toBeUndefined();
    expect(CreateWorkflowCausalityGraphSchema.parse(bound)).toEqual(bound);
  });

  it("leaves holes absent when the script has none, and drops a phase reference the vocabulary lost", () => {
    const { causality, flow } = graphWith(undefined);
    expect("holes" in boundCausalityGraph(causality, flow)).toBe(false);

    const unlisted = graphWith([{ siteId: "hole#2", name: "收尾", type: "T", phase: "phase#9" }]);
    const bound = boundCausalityGraph(unlisted.causality, unlisted.flow);
    expect(bound.holes).toEqual([{ siteId: "hole#2", name: "收尾", type: "T" }]);
  });

  it("caps the holes at 32 and flags truncation", () => {
    const many: FlowHole[] = Array.from({ length: 40 }, (_, i) => ({
      siteId: `hole#${i + 2}`,
      name: `h${i}`,
      type: "T",
    }));
    const { causality, flow } = graphWith(many);
    const bound = boundCausalityGraph(causality, flow);
    expect(bound.holes).toHaveLength(32);
    expect(bound.holes?.[0]?.siteId).toBe("hole#2");
    expect(bound.truncated).toBe(true);
    expect(CreateWorkflowCausalityGraphSchema.safeParse(bound).success).toBe(true);
  });
});

describe("boundCausalityGraph — nested holes", () => {
  it("keeps nested fill marks and nested open holes", () => {
    const { causality, flow } = graphWith(
      [{ siteId: "hole#1/hole#1/hole#2", name: "更深", type: "Deep", phase: "phase#1" }],
      { fill: "hole#1/hole#1" },
    );
    (flow.phases as { fill?: string }[])[1]!.fill = "hole#1/hole#1";
    const bound = boundCausalityGraph(causality, flow);
    expect(bound.steps.find((s) => s.id === "hole#1/ask#1")?.fill).toBe("hole#1/hole#1");
    expect(bound.phases?.find((p) => p.id === "hole#1")?.fill).toBe("hole#1/hole#1");
    expect(bound.holes).toEqual([
      { siteId: "hole#1/hole#1/hole#2", name: "更深", type: "Deep", phase: "phase#1" },
    ]);
    expect(CreateWorkflowCausalityGraphSchema.parse(bound)).toEqual(bound);
  });
});
