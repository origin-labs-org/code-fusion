import { describe, expect, it } from "vitest";
import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  instanceCardId,
  liveParticipantView,
  type LiveParticipantView,
  type ParticipantInstance,
} from "@/components/workflow-graph/participant-model.js";
import { phaseBinder } from "@/components/workflow-graph/instance-phases.js";
import { aggregateRunStatuses, statusOfRunNode } from "@/components/workflow-graph/run-status.js";
import type {
  StepRunStatus,
  WorkflowCausalityGraphData,
  WorkflowHandoffData,
  WorkflowParticipantData,
} from "@/components/workflow-graph/types.js";
import { buildWorkflowTimeline } from "@/components/workflow-timeline/timeline-model.js";

// ============================================================
// ============================================================

function referenceBoundInstance(
  participantId: string,
  actor: WorkflowRunState["actors"][number],
): ParticipantInstance {
  return {
    bound: true,
    ordinal: actor.ordinal,
    participant: participantId,
    ...(actor.name === undefined ? {} : { name: actor.name }),
  };
}

function referenceLiveParticipantView(
  graph: WorkflowCausalityGraphData,
  run: WorkflowRunState | undefined,
): LiveParticipantView {
  if (run === undefined) return { graph, instances: {}, participantStatuses: {} };
  const siteOf = new Map(graph.steps.map((step) => [step.id, step.source ?? step.id]));
  const binder = phaseBinder(graph, run);
  const sitesOf = (participant: WorkflowParticipantData) =>
    new Set(participant.steps.map((id) => siteOf.get(id) ?? id));
  const instancesOfCard = (participant: WorkflowParticipantData) => {
    const sites = sitesOf(participant);
    const seen = new Set<number>();
    const here = new Set<number>();
    for (const node of run.nodes) {
      if (node.actorSiteId !== participant.lane || !sites.has(node.siteId)) continue;
      if (node.actorOrdinal === undefined) continue;
      seen.add(node.actorOrdinal);
      if (binder.has(participant.phase, node.phaseName)) here.add(node.actorOrdinal);
    }
    return run.actors
      .filter(
        (actor) =>
          actor.siteId === participant.lane &&
          (here.has(actor.ordinal) ||
            (!seen.has(actor.ordinal) && binder.has(participant.phase, actor.phaseName))),
      )
      .sort((a, b) => a.ordinal - b.ordinal);
  };
  const statusFor = (participant: WorkflowParticipantData, ordinal: number): StepRunStatus => {
    const sites = sitesOf(participant);
    const values = run.nodes
      .filter(
        (node) =>
          sites.has(node.siteId) &&
          node.actorSiteId === participant.lane &&
          node.actorOrdinal === ordinal &&
          binder.has(participant.phase, node.phaseName),
      )
      .map(statusOfRunNode);
    return aggregateRunStatuses(values) ?? "pending";
  };

  const participants: WorkflowParticipantData[] = [];
  const replacements = new Map<string, string[]>();
  const participantStatuses: Record<string, StepRunStatus> = {};
  const instances: Record<string, ParticipantInstance> = {};
  let changed = false;
  for (const participant of graph.participants) {
    const actors = instancesOfCard(participant);
    if (participant.member !== undefined) {
      const actor = actors[participant.member.index];
      participantStatuses[participant.id] =
        actor === undefined ? "pending" : statusFor(participant, actor.ordinal);
      if (actor !== undefined) {
        instances[participant.id] = referenceBoundInstance(participant.id, actor);
      }
      participants.push(participant);
      continue;
    }
    if (participant.many !== true && actors.length === 1) {
      instances[participant.id] = referenceBoundInstance(participant.id, actors[0]!);
      participants.push(participant);
      continue;
    }
    if (participant.many === true || actors.length > 1) {
      if (actors.length === 0) {
        participants.push(participant);
        continue;
      }
      changed = true;
      const ids: string[] = [];
      for (const actor of actors) {
        const id = instanceCardId(participant.id, actor.ordinal);
        const { many: _many, ...rest } = participant;
        participants.push({ ...rest, id });
        participantStatuses[id] = statusFor(participant, actor.ordinal);
        instances[id] = {
          ordinal: actor.ordinal,
          participant: participant.id,
          ...(actor.name === undefined ? {} : { name: actor.name }),
        };
        ids.push(id);
      }
      replacements.set(participant.id, ids);
      continue;
    }
    participants.push(participant);
  }
  if (!changed) return { graph, instances, participantStatuses };

  const handoffs: WorkflowHandoffData[] = [];
  for (const edge of graph.handoffs) {
    const froms = replacements.get(edge.from) ?? [edge.from];
    const tos = replacements.get(edge.to) ?? [edge.to];
    for (const from of froms) for (const to of tos) handoffs.push({ ...edge, from, to });
  }
  return { graph: { ...graph, handoffs, participants }, instances, participantStatuses };
}

// ============================================================
// ============================================================

const PHASE_ONE = "From草";
const PHASE_TWO = "校订";

const GRAPH: WorkflowCausalityGraphData = {
  steps: [
    { id: "ask#m1", kind: "ask", label: "写", lane: "actor#many", phase: "phase#1" },
    {
      id: "ask#m2",
      kind: "ask",
      label: "改",
      lane: "actor#many",
      phase: "phase#2",
      source: "ask#m1",
    },
    { id: "ask#t1", kind: "ask", label: "评审", lane: "actor#team", phase: "phase#1" },
    { id: "ask#s1", kind: "ask", label: "汇总", lane: "actor#solo", phase: "phase#2" },
    { id: "world-read#1", kind: "world-read", label: "读稿", lane: "workspace", phase: "phase#1" },
  ],
  lanes: [
    { id: "actor#many", name: "写手" },
    { id: "actor#team", name: "评审" },
    { id: "actor#solo" },
    { id: "workspace" },
  ],
  participants: [
    { id: "phase#1:many", phase: "phase#1", lane: "actor#many", steps: ["ask#m1"], many: true },
    { id: "phase#2:many", phase: "phase#2", lane: "actor#many", steps: ["ask#m2"], many: true },
    {
      id: "phase#1:team#0",
      phase: "phase#1",
      lane: "actor#team",
      steps: ["ask#t1"],
      member: { index: 0, of: 3 },
    },
    {
      id: "phase#1:team#1",
      phase: "phase#1",
      lane: "actor#team",
      steps: ["ask#t1"],
      member: { index: 1, of: 3 },
    },
    {
      id: "phase#1:team#2",
      phase: "phase#1",
      lane: "actor#team",
      steps: ["ask#t1"],
      member: { index: 2, of: 3 },
    },
    { id: "phase#2:solo", phase: "phase#2", lane: "actor#solo", steps: ["ask#s1"] },
    { id: "phase#1:workspace", phase: "phase#1", lane: "workspace", steps: ["world-read#1"] },
  ],
  handoffs: [
    { from: "phase#1:team#0", to: "phase#1:many" },
    { from: "phase#2:many", to: "phase#2:solo" },
  ],
  phases: [
    { id: "phase#1", name: PHASE_ONE },
    { id: "phase#2", name: PHASE_TWO },
  ],
  phaseEdges: [{ from: "phase#1", to: "phase#2" }],
  exits: ["phase#2"],
};

type Node = WorkflowRunState["nodes"][number];
type Actor = WorkflowRunState["actors"][number];

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const NODE_PHASES = ["queued", "dispatched", "executing", "waiting", "settled"] as const;

function wideRun(options: { solo: number; stamped: boolean; many?: number }): WorkflowRunState {
  const random = seeded(20260920);
  const many = options.many ?? 400;
  const stamp = (phaseName: string) => (options.stamped ? { phaseName } : {});
  const actors: Actor[] = [];
  const nodes: Node[] = [];
  for (let i = many; i >= 1; i -= 1) {
    const born = i <= many / 2 ? PHASE_ONE : PHASE_TWO;
    actors.push({
      siteId: "actor#many",
      ordinal: i,
      status: "running",
      ...(i % 7 === 0 ? {} : { name: `writer${i}` }),
      ...stamp(born),
    });
    if (i % 7 === 0) continue;
    const count = 1 + Math.floor(random() * 3);
    for (let k = 0; k < count; k += 1) {
      const phase = NODE_PHASES[Math.floor(random() * NODE_PHASES.length)]!;
      nodes.push({
        siteId: "ask#m1",
        ordinal: k + 1,
        phase,
        ...(phase === "settled"
          ? { outcome: k % 5 === 0 ? ("failed" as const) : ("ok" as const) }
          : {}),
        actorSiteId: "actor#many",
        actorOrdinal: i,
        ...stamp(born),
      });
    }
    if (i % 11 === 0) {
      nodes.push({
        siteId: "ask#gone",
        ordinal: 1,
        phase: "settled",
        outcome: "ok",
        actorSiteId: "actor#many",
        actorOrdinal: i,
        ...stamp(born),
      });
    }
  }
  for (let i = 1; i <= 4; i += 1) {
    actors.push({ siteId: "actor#team", ordinal: i, status: "completed", ...stamp(PHASE_ONE) });
    nodes.push({
      siteId: "ask#t1",
      ordinal: 1,
      phase: "settled",
      outcome: i === 2 ? "failed" : "ok",
      actorSiteId: "actor#team",
      actorOrdinal: i,
      ...stamp(PHASE_ONE),
    });
  }
  for (let i = 1; i <= options.solo; i += 1) {
    actors.push({ siteId: "actor#solo", ordinal: i, status: "waiting", ...stamp(PHASE_TWO) });
  }
  nodes.push({ siteId: "world-read#1", ordinal: 1, phase: "settled", outcome: "ok" });
  nodes.push({
    siteId: "ask#m1",
    ordinal: 1,
    phase: "executing",
    actorSiteId: "actor#many",
    ...stamp(PHASE_ONE),
  });
  return {
    runId: "dwfrun-wide",
    toolCallId: "tool-wide",
    status: "running",
    usage: { spentTokens: 0, nodesUsed: nodes.length },
    actors,
    nodes,
    lastEventSequence: nodes.length,
  };
}

function expectSameView(actual: LiveParticipantView, expected: LiveParticipantView): void {
  expect(actual.graph.participants.map((participant) => participant.id)).toEqual(
    expected.graph.participants.map((participant) => participant.id),
  );
  expect(actual.graph.handoffs).toEqual(expected.graph.handoffs);
  expect(Object.keys(actual.participantStatuses)).toEqual(
    Object.keys(expected.participantStatuses),
  );
  expect(Object.keys(actual.instances)).toEqual(Object.keys(expected.instances));
  expect(actual).toEqual(expected);
}

describe("liveParticipantView · 索引化与参照Implementation对拍", () => {
  for (const solo of [1, 2]) {
    for (const stamped of [true, false]) {
      it(`宽 run 逐Character节E同（solo=${solo}，${stamped ? "有" : "无"}Phase戳）`, () => {
        const run = wideRun({ solo, stamped });
        expectSameView(liveParticipantView(GRAPH, run), referenceLiveParticipantView(GRAPH, run));
      });
    }
  }

  it("拆分出的Instance卡按 ordinal 升序，与 run.actors 的到达序Irrelevant", () => {
    const run = wideRun({ solo: 2, stamped: true });
    const ids = liveParticipantView(GRAPH, run)
      .graph.participants.filter((participant) => participant.id.startsWith("phase#1:many@"))
      .map((participant) => Number(participant.id.split("@")[1]));
    expect(ids.length).toBeGreaterThan(100);
    expect(ids).toEqual([...ids].sort((left, right) => left - right));
  });

  it("Phase再入：Shared站点的两张 many 卡各认领自己那One半Instance", () => {
    const view = liveParticipantView(GRAPH, wideRun({ solo: 1, stamped: true }));
    const count = (prefix: string) =>
      view.graph.participants.filter((participant) => participant.id.startsWith(prefix)).length;
    expect(count("phase#1:many@")).toBe(200);
    expect(count("phase#2:many@")).toBe(200);
  });

  it("无 run 时原样BackInput图（引用E等）", () => {
    const view = liveParticipantView(GRAPH, undefined);
    expect(view.graph).toBe(GRAPH);
    expect(view.instances).toEqual({});
  });
});

describe("buildWorkflowTimeline · One对 (graph, run) 只建One次", () => {
  it("同One对对e两次调用Back同One个Model", () => {
    const run = wideRun({ solo: 1, stamped: true });
    expect(buildWorkflowTimeline(GRAPH, run)).toBe(buildWorkflowTimeline(GRAPH, run));
  });

  it("run 换了New对e就重建——投影每帧发New对e，身份Yes正确的键", () => {
    const first = wideRun({ solo: 1, stamped: true });
    const second = { ...first };
    const before = buildWorkflowTimeline(GRAPH, first);
    const after = buildWorkflowTimeline(GRAPH, second);
    expect(after).not.toBe(before);
    expect(after).toEqual(before);
  });

  it("同One条 run 配两张图各建各的", () => {
    const run = wideRun({ solo: 1, stamped: true });
    const other: WorkflowCausalityGraphData = { ...GRAPH, exits: [] };
    expect(buildWorkflowTimeline(other, run)).not.toBe(buildWorkflowTimeline(GRAPH, run));
  });

  it("无 run 的静态图同样只建One次", () => {
    expect(buildWorkflowTimeline(GRAPH, undefined)).toBe(buildWorkflowTimeline(GRAPH, undefined));
  });
});
