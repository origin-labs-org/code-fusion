import {
  WORKFLOW_HOLE_SITE_ID_PATTERN,
  type WorkflowRunState,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowCausalityGraphData } from "@/components/workflow-graph/types.js";
import type { TimelineRail, TimelineStation, WorkflowTimelineModel } from "./timeline-model.js";

export type TimelineHoleState = "open" | "waiting" | "filled";

export interface TimelineHole {
  siteId: string;
  state: TimelineHoleState;
  
  prompt?: string;
  
  tail?: true;
  
  since?: number;
  filledAt?: number;
  filledBy?: string;
}

export interface TimelineFill {
  holeId: string;
  name: string;
  from: number;
  to: number;
  filledAt?: number;
}

export type HoleLabels = ReadonlyMap<string, { name: string }>;

export function isHoleSiteId(id: string): boolean {
  return WORKFLOW_HOLE_SITE_ID_PATTERN.test(id);
}

export type HoleParents = Readonly<Record<string, string>>;

function holeAncestors(id: string, parents: HoleParents): string[] {
  const out: string[] = [];
  for (
    let cur: string | undefined = id;
    cur !== undefined && !out.includes(cur);
    cur = parents[cur]
  ) {
    if (isHoleSiteId(cur)) out.push(cur);
  }
  return out;
}

export function fillContains(holeId: string, id: string, parents: HoleParents): boolean {
  return holeAncestors(id, parents).includes(holeId);
}

export function holeParentsOf(
  graph: Pick<WorkflowCausalityGraphData, "steps">,
  phases: readonly { id: string; fill?: string }[],
): HoleParents {
  const parents: Record<string, string> = {};
  for (const step of graph.steps) {
    if (step.kind === "hole" && step.fill !== undefined && step.fill !== step.id)
      parents[step.id] = step.fill;
  }
  for (const phase of phases) {
    if (isHoleSiteId(phase.id) && phase.fill !== undefined && phase.fill !== phase.id)
      parents[phase.id] = phase.fill;
  }
  return parents;
}

export function withoutHeadedHolePhases(
  graph: WorkflowCausalityGraphData,
): WorkflowCausalityGraphData {
  const phases = graph.phases ?? [];
  const open = new Set((graph.holes ?? []).map((hole) => hole.siteId));
  const withMembers = new Set(
    graph.steps.flatMap((step) => (step.phase === undefined ? [] : [step.phase])),
  );
  const parents = holeParentsOf(graph, phases);
  const hidden = new Set(
    phases
      .filter(
        (phase) => isHoleSiteId(phase.id) && !open.has(phase.id) && !withMembers.has(phase.id),
      )
      .filter((hole) =>
        phases.some(
          (phase) =>
            phase.id !== hole.id &&
            phase.fill !== undefined &&
            fillContains(hole.id, phase.fill, parents),
        ),
      )
      .map((phase) => phase.id),
  );
  if (hidden.size === 0) return graph;
  let edges = [...(graph.phaseEdges ?? [])];
  for (const id of hidden) {
    const into = edges.filter((edge) => edge.to === id && edge.from !== id);
    const out = edges.filter((edge) => edge.from === id && edge.to !== id);
    edges = edges.filter((edge) => edge.from !== id && edge.to !== id);
    for (const a of into)
      for (const b of out)
        edges.push({ from: a.from, to: b.to, ...(b.back === true ? { back: true } : {}) });
  }
  const seen = new Set<string>();
  const phaseEdges = edges.filter((edge) => {
    const key = `${edge.from}>${edge.to}>${edge.back === true ? 1 : 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    ...graph,
    phaseEdges,
    phases: phases
      .filter((phase) => !hidden.has(phase.id))
      .map((phase) =>
        phase.alongside === undefined
          ? phase
          : { ...phase, alongside: phase.alongside.filter((id) => !hidden.has(id)) },
      ),
  };
}

export function timelineHoleGraph(full: WorkflowCausalityGraphData): {
  graph: WorkflowCausalityGraphData;
  phases: NonNullable<WorkflowCausalityGraphData["phases"]>;
  parents: HoleParents;
} {
  const graph = withoutHeadedHolePhases(full);
  return { graph, parents: holeParentsOf(full, full.phases ?? []), phases: graph.phases ?? [] };
}

export function stationFillOf(
  phase: { id: string; fill?: string },
  hole: TimelineHole | undefined,
): { fill?: string } {
  const fill = hole?.state === "filled" ? phase.id : phase.fill;
  return fill === undefined ? {} : { fill };
}

export interface HoleTable {
  
  byPhase: ReadonlyMap<string, TimelineHole>;
  
  fills: TimelineFill[];
  
  parents: HoleParents;
}

export function holeTable(
  graph: WorkflowCausalityGraphData,
  phases: readonly NonNullable<WorkflowCausalityGraphData["phases"]>[number][],
  run: WorkflowRunState | undefined,
  labels: HoleLabels | undefined,
  
  parents: HoleParents = holeParentsOf(graph, phases),
): HoleTable {
  const runHoles = new Map((run?.holes ?? []).map((hole) => [hole.siteId, hole]));
  const index = new Map(phases.map((phase, i) => [phase.id, i]));
  const byPhase = new Map<string, TimelineHole>();
  const open = new Set<string>();
  for (const hole of graph.holes ?? []) {
    open.add(hole.siteId);
    const live = runHoles.get(hole.siteId);
    const waiting = live?.state === "waiting";
    byPhase.set(hole.siteId, {
      siteId: hole.siteId,
      state: waiting ? "waiting" : "open",
      ...(hole.tail === true ? { tail: true as const } : {}),
      ...(waiting && live.since !== undefined ? { since: live.since } : {}),
      ...(waiting && live.prompt !== undefined ? { prompt: live.prompt } : {}),
    });
  }
  const filled = new Set<string>();
  for (const hole of runHoles.values()) if (hole.state === "filled") filled.add(hole.siteId);
  for (const phase of phases) {
    if (phase.fill !== undefined)
      for (const id of holeAncestors(phase.fill, parents)) filled.add(id);
    if (isHoleSiteId(phase.id)) filled.add(phase.id);
  }
  for (const step of graph.steps) {
    if (step.fill !== undefined) for (const id of holeAncestors(step.fill, parents)) filled.add(id);
  }
  for (const id of open) filled.delete(id);

  const fills: TimelineFill[] = [];
  const last = phases.length - 1;
  for (const holeId of filled) {
    const live = runHoles.get(holeId);
    const label = labels?.get(holeId);
    const own = index.get(holeId);
    const body = phases.flatMap((phase, i) =>
      phase.fill !== undefined && fillContains(holeId, phase.fill, parents) ? [i] : [],
    );
    if (own !== undefined) {
      byPhase.set(holeId, {
        siteId: holeId,
        state: "filled",
        ...(own === last && body.length === 0 ? { tail: true as const } : {}),
        ...(live?.filledAt === undefined ? {} : { filledAt: live.filledAt }),
        ...(live?.filledBy === undefined ? {} : { filledBy: live.filledBy }),
      });
    }
    if (body.length === 0) continue;
    const from = own !== undefined && own === Math.min(...body) - 1 ? own : Math.min(...body);
    fills.push({
      holeId,
      name: live?.name ?? label?.name ?? holeId,
      from,
      to: Math.max(...body),
      ...(live?.filledAt === undefined ? {} : { filledAt: live.filledAt }),
    });
  }
  const depth = (id: string): number => holeAncestors(id, parents).length;
  fills.sort(
    (left, right) =>
      left.from - right.from || right.to - left.to || depth(left.holeId) - depth(right.holeId),
  );
  return { byPhase, fills, parents };
}

export function tailStubOf(stations: readonly TimelineStation[]): "open" | "filled" | undefined {
  const hole = stations[stations.length - 1]?.hole;
  if (hole === undefined || hole.tail !== true) return undefined;
  return hole.state === "filled" ? "filled" : "open";
}

export function railTouchesHole(
  stations: readonly TimelineStation[],
  rail: Pick<TimelineRail, "from" | "to">,
): boolean {
  const at = (i: number): boolean => {
    const state = stations[i]?.hole?.state;
    return state === "open" || state === "waiting";
  };
  return at(rail.from) || at(rail.to);
}

export function narrowTimelineToFill(
  model: WorkflowTimelineModel,
  holeId: string,
): WorkflowTimelineModel | undefined {
  const fill = model.fills?.find((candidate) => candidate.holeId === holeId);
  let from: number;
  let to: number;
  if (fill !== undefined) {
    from = fill.from;
    to = fill.to;
  } else {
    const own = model.stations.findIndex(
      (station) => station.hole?.siteId === holeId && station.hole.state === "filled",
    );
    if (own < 0) return undefined;
    from = own;
    to = own;
  }
  const start = Math.max(0, from - 1);
  const end = Math.min(model.stations.length - 1, to + 1);
  const stations = model.stations.slice(start, end + 1).map((station, i) => {
    const at = start + i;
    const ghost = at < from || at > to;
    const { typing: _typing, ...rest } = station;
    void _typing;
    return ghost ? { ...rest, ghost: true as const } : rest;
  });
  const rails = model.rails.flatMap((rail) =>
    rail.kind === undefined && rail.from >= start && rail.to <= end && rail.to === rail.from + 1
      ? [{ ...rail, from: rail.from - start, to: rail.to - start }]
      : [],
  );
  const includesLast = end === model.stations.length - 1;
  return {
    arcs: [],
    bands: [],
    fills: fill === undefined ? [] : [{ ...fill, from: from - start, to: to - start }],
    live: false,
    rails,
    runningIndex: undefined,
    stations,
    ...(includesLast && model.tailStub !== undefined ? { tailStub: model.tailStub } : {}),
  };
}
