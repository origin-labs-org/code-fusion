import { describe, expect, it } from "vitest";
import {
  IMPLICIT_PHASE_ID,
  participantsOfPhase,
  withImplicitPhase,
} from "../src/components/workflow-graph/participant-model.js";
import {
  collapsePhaseStatus,
  findPhase,
  hasPhaseVocabulary,
  phaseMembers,
} from "../src/components/workflow-graph/phase-model.js";
import { phaseDisplayName, phaseNameMatches } from "../src/components/workflow-graph/phase-name.js";
import type {
  StepRunStatus,
  WorkflowCausalityGraphData,
  WorkflowStepData,
} from "../src/components/workflow-graph/types.js";

function step(
  overrides: Partial<WorkflowStepData> & { id: string; lane: string },
): WorkflowStepData {
  return { kind: "ask", label: overrides.id, ...overrides };
}

const GRAPH: WorkflowCausalityGraphData = {
  exits: ["phase#2"],
  handoffs: [
    { from: "phase#1:workspace", to: "phase#1:actor#1" },
    { from: "phase#2:actor#1", to: "phase#2:actor#2", types: ["Plan"] },
  ],
  lanes: [
    { id: "actor#1", line: 3, name: "optimizer" },
    { id: "actor#2", line: 4, name: "referee" },
    { id: "workspace" },
  ],
  participants: [
    { id: "phase#1:workspace", lane: "workspace", phase: "phase#1", steps: ["world-read#1"] },
    { id: "phase#1:actor#1", lane: "actor#1", phase: "phase#1", steps: ["ask#1"] },
    { id: "phase#2:actor#1", lane: "actor#1", phase: "phase#2", steps: ["ask#2"] },
    { id: "phase#2:actor#2", lane: "actor#2", phase: "phase#2", steps: ["ask#3"] },
  ],
  phaseEdges: [{ from: "phase#1", to: "phase#2" }],
  phases: [
    { id: "phase#1", line: 2, name: "preflight" },
    { id: "phase#2", line: 9, name: "gate" },
  ],
  sink: ["ask#2", "ask#3"],
  steps: [
    step({ id: "world-read#1", kind: "world-read", lane: "workspace", phase: "phase#1" }),
    step({ id: "ask#1", lane: "actor#1", phase: "phase#1" }),
    step({ id: "ask#2", lane: "actor#1", phase: "phase#2" }),
    step({ id: "ask#3", lane: "actor#2", phase: "phase#2" }),
  ],
};

const MARKERLESS: WorkflowCausalityGraphData = {
  handoffs: [{ from: "unphased:actor#1", to: "unphased:actor#2" }],
  lanes: [
    { id: "actor#1", name: "planner" },
    { id: "actor#2", name: "reviewer" },
  ],
  participants: [
    { id: "unphased:actor#1", lane: "actor#1", phase: "unphased", steps: ["ask#1"] },
    { id: "unphased:actor#2", lane: "actor#2", phase: "unphased", steps: ["ask#2"] },
  ],
  sink: ["ask#2"],
  steps: [step({ id: "ask#1", lane: "actor#1" }), step({ id: "ask#2", lane: "actor#2" })],
};

const formatMessage = (descriptor: { id: string }): string => descriptor.id;

describe("phase vocabulary", () => {
  it("is absent when the payload carries no phases at all", () => {
    expect(hasPhaseVocabulary(MARKERLESS)).toBe(false);
  });

  it("is absent when the vocabulary is present but empty", () => {
    expect(hasPhaseVocabulary({ ...GRAPH, phaseEdges: [], phases: [] })).toBe(false);
  });

  it("is present as soon as the author said something", () => {
    expect(hasPhaseVocabulary(GRAPH)).toBe(true);
  });
});

describe("withImplicitPhase", () => {
  it("synthesizes a single `workflow` phase for a marker-less graph and rehomes everything into it", () => {
    const board = withImplicitPhase(MARKERLESS);

    expect(board.phases).toEqual([{ id: IMPLICIT_PHASE_ID }]);
    expect(board.phaseEdges).toEqual([]);
    expect(board.exits).toEqual([IMPLICIT_PHASE_ID]);
    expect(board.participants.map((participant) => participant.phase)).toEqual([
      IMPLICIT_PHASE_ID,
      IMPLICIT_PHASE_ID,
    ]);
    expect(board.participants.map((participant) => participant.id)).toEqual([
      "unphased:actor#1",
      "unphased:actor#2",
    ]);
    expect(board.steps.every((member) => member.phase === IMPLICIT_PHASE_ID)).toBe(true);
    expect(board.handoffs).toEqual(MARKERLESS.handoffs);
    expect(board.lanes).toBe(MARKERLESS.lanes);
    expect(board.sink).toEqual(["ask#2"]);
    expect(hasPhaseVocabulary(board)).toBe(true);
  });

  it("has no exit when the script returns nothing", () => {
    const { sink: _sink, ...noSink } = MARKERLESS;
    expect(withImplicitPhase(noSink).exits).toEqual([]);
    expect(withImplicitPhase({ ...MARKERLESS, sink: [] }).exits).toEqual([]);
  });

  it("returns a graph with vocabulary untouched — by reference, so memo holds", () => {
    expect(withImplicitPhase(GRAPH)).toBe(GRAPH);
    const empty = { ...GRAPH, phaseEdges: [], phases: [] };
    expect(withImplicitPhase(empty).phases).toEqual([{ id: IMPLICIT_PHASE_ID }]);
  });

  it("is idempotent", () => {
    const once = withImplicitPhase(MARKERLESS);
    expect(withImplicitPhase(once)).toBe(once);
  });

  it("names the implicit phase at render time, never in the payload", () => {
    expect(phaseDisplayName({ id: IMPLICIT_PHASE_ID }, formatMessage)).toBe(
      "chat.toolCall.workflow.graph.phase.workflow",
    );
  });
});

describe("participantsOfPhase", () => {
  it("buckets by phase, keeping the payload's hand-off order", () => {
    expect(participantsOfPhase(GRAPH, "phase#1").map((participant) => participant.id)).toEqual([
      "phase#1:workspace",
      "phase#1:actor#1",
    ]);
    expect(participantsOfPhase(GRAPH, "phase#2").map((participant) => participant.id)).toEqual([
      "phase#2:actor#1",
      "phase#2:actor#2",
    ]);
  });

  it("is empty for a phase with no cards, and for an unknown phase", () => {
    expect(participantsOfPhase(GRAPH, "phase#404")).toEqual([]);
    expect(participantsOfPhase(MARKERLESS, IMPLICIT_PHASE_ID)).toEqual([]);
    expect(participantsOfPhase(withImplicitPhase(MARKERLESS), IMPLICIT_PHASE_ID)).toHaveLength(2);
  });
});

describe("phase membership and naming", () => {
  it("buckets steps by their phase, keeping the phase table's order", () => {
    const members = phaseMembers(GRAPH);

    expect([...members.keys()]).toEqual(["phase#1", "phase#2"]);
    expect(members.get("phase#1")?.map((member) => member.id)).toEqual(["world-read#1", "ask#1"]);
    expect(members.get("phase#2")?.map((member) => member.id)).toEqual(["ask#2", "ask#3"]);
  });

  it("finds a phase by id for the inspector's naming material", () => {
    expect(findPhase(GRAPH, "phase#2")?.name).toBe("gate");
    expect(findPhase(GRAPH, "phase#404")).toBeUndefined();
    expect(findPhase(MARKERLESS, IMPLICIT_PHASE_ID)).toBeUndefined();
  });

  it("shows the author's word", () => {
    expect(phaseDisplayName(GRAPH.phases![1]!, formatMessage)).toBe("gate");
    expect(phaseDisplayName(GRAPH.phases![0]!, formatMessage)).toBe("preflight");
  });

  it("localizes the synthetic `unphased` phase, which has no name of its own", () => {
    expect(phaseDisplayName({ id: "unphased" }, formatMessage)).toBe(
      "chat.toolCall.workflow.graph.phase.unphased",
    );
  });
});

describe("phase status re-collapse", () => {
  const members = [step({ id: "a", lane: "actor#1" }), step({ id: "b", lane: "actor#1" })];
  const collapse = (a: StepRunStatus, b: StepRunStatus) => collapsePhaseStatus(members, { a, b });

  it("reports running first — the reader's first question is whether it still moves", () => {
    expect(collapse("failed", "running")).toBe("running");
    expect(collapse("done", "running")).toBe("running");
  });

  it("reports failed once nothing runs any more", () => {
    expect(collapse("done", "failed")).toBe("failed");
  });

  it("reports done only when every member settled cleanly; settled + queued is running", () => {
    expect(collapse("done", "done")).toBe("done");
    expect(collapse("done", "pending")).toBe("running");
  });

  it("ignores members without an entry: a branch the run did not take is absent, not pending", () => {
    expect(collapsePhaseStatus(members, { a: "done" })).toBe("done");
  });

  it("has no dot at all in the static view", () => {
    expect(collapsePhaseStatus(members, undefined)).toBeUndefined();
    expect(collapsePhaseStatus(members, {})).toBeUndefined();
  });
});

describe("phaseNameMatches", () => {
  const long = "x".repeat(128);

  it("matches the same word", () => {
    expect(phaseNameMatches("attempt", "attempt")).toBe(true);
    expect(phaseNameMatches("attempt", "gate")).toBe(false);
  });

  it("falls back to a prefix only when the display name really was truncated", () => {
    expect(phaseNameMatches(long, `${long}yyy`)).toBe(true);
    expect(phaseNameMatches("计划", "Plan修复")).toBe(false);
    expect(phaseNameMatches(`${long}yyy`, long)).toBe(false);
  });

  it("says no when either side has no name — matching needs two names", () => {
    expect(phaseNameMatches(undefined, "attempt")).toBe(false);
    expect(phaseNameMatches("attempt", undefined)).toBe(false);
    expect(phaseNameMatches(undefined, undefined)).toBe(false);
  });
});
