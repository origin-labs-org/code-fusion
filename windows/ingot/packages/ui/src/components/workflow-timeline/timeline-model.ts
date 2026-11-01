import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import { laneRefsById, type LaneRef } from "@/components/workflow-graph/lane-name.js";
import {
  collapseStatuses,
  liveParticipantView,
  participantStatus,
  participantsOfPhase,
  withImplicitPhase,
} from "@/components/workflow-graph/participant-model.js";
import { phaseBinder } from "@/components/workflow-graph/instance-phases.js";
import type { PhaseNaming } from "@/components/workflow-graph/phase-name.js";
import { phaseMembers } from "@/components/workflow-graph/phase-model.js";
import { workflowRunOverlay } from "@/components/workflow-graph/run-status.js";
import {
  laneClassOf,
  type LaneClass,
  type StepRunStatus,
  type WorkflowCausalityGraphData,
} from "@/components/workflow-graph/types.js";
import { sharedTimelineModel } from "./timeline-cache.js";
import {
  isCurrentPhase,
  phaseStreamIndexes,
  stageStatuses,
  stationStatus,
  streamInk,
} from "./stage-lamps.js";
import {
  holeTable,
  railTouchesHole,
  stationFillOf,
  tailStubOf,
  timelineHoleGraph,
  type HoleLabels,
  type TimelineFill,
  type TimelineHole,
} from "./timeline-holes.js";
import {
  observePhase,
  phaseEntryFor,
  siteIdsOf,
  stationUnlisted,
  type StationUnlisted,
} from "./station-observation.js";
import {
  assignAirLanes,
  bandOf,
  foldPhaseBands,
  foldPhaseEdges,
  trackOf,
  type RailSpec,
  type TimelineRailKind,
} from "./timeline-bands.js";

export type TimelineInk = "faint" | "strong" | "march";
export type { TimelineRailKind } from "./timeline-bands.js";
export { arcLaneCount, assignArcLanes } from "./timeline-bands.js";

export interface TimelinePill {
  
  key: string;
  lane: LaneRef;
  laneClass: LaneClass;
  
  runtimeName?: string;
  
  avatarIndex?: number;
  
  status: StepRunStatus | undefined;
  
  instance?: { siteId: string; ordinal: number; sessionId?: string };
  
  slot?: { siteId: string; ordinal: number };
  
  workspace?: { phaseId: string };
  
  stepIds: string[];
  
  asking?: true;
}

export interface TimelineStation {
  id: string;
  naming: PhaseNaming;
  pills: TimelinePill[];
  
  status: StepRunStatus | undefined;
  
  visited: boolean;
  
  rounds: number;
  
  onLoop: boolean;
  
  track: number;
  
  fraction?: { settled: number; observed: number };
  
  unlisted?: StationUnlisted;
  
  typing?: true;
  
  hole?: TimelineHole;
  
  fill?: string;
  
  ghost?: true;
}

export interface TimelineRail {
  from: number;
  to: number;
  ink: TimelineInk;
  
  kind?: TimelineRailKind;
  
  dashed?: true;
}

export interface TimelineArc {
  from: number;
  to: number;
  lane: number;
  ink: TimelineInk;
  
  air: number;
  
  stream?: true;
}

export interface TimelineTrack {
  stations: number[];
  
  entry: TimelineInk;
  
  exit: TimelineInk;
}

export interface TimelineBand {
  from: number;
  to: number;
  
  pred?: number;
  
  join?: number;
  tracks: TimelineTrack[];
}

export interface WorkflowTimelineModel {
  stations: TimelineStation[];
  rails: TimelineRail[];
  arcs: TimelineArc[];
  
  bands: TimelineBand[];
  
  runningIndex: number | undefined;
  
  live: boolean;
  
  draft?: { agents: number };
  
  fills?: TimelineFill[];
  
  holeParents?: Readonly<Record<string, string>>;
  
  tailStub?: "open" | "filled";
}

export function buildWorkflowTimeline(
  input: WorkflowCausalityGraphData,
  run: WorkflowRunState | undefined,
  
  holeLabels?: HoleLabels,
): WorkflowTimelineModel {
  if (holeLabels !== undefined) return computeWorkflowTimeline(input, run, holeLabels);
  return sharedTimelineModel(input, run, () => computeWorkflowTimeline(input, run, undefined));
}

function computeWorkflowTimeline(
  input: WorkflowCausalityGraphData,
  run: WorkflowRunState | undefined,
  holeLabels: HoleLabels | undefined,
): WorkflowTimelineModel {
  const { graph, parents, phases } = timelineHoleGraph(withImplicitPhase(input));
  const index = new Map(phases.map((phase, i) => [phase.id, i]));
  const members = phaseMembers(graph);
  const holes = holeTable(graph, phases, run, holeLabels, parents);
  const overlay = workflowRunOverlay(run, graph);
  const live = liveParticipantView(graph, run);
  const binder = phaseBinder(graph, run);
  const laneRefs = laneRefsById(graph.lanes);
  const sessionByInstance = new Map(
    (run?.actors ?? []).map((actor) => [`${actor.siteId}@${actor.ordinal}`, actor.sessionId]),
  );
  const askingInstances = new Set(
    (run?.pendingQuestions ?? [])
      .filter(
        (question) => question.actorSiteId !== undefined && question.actorOrdinal !== undefined,
      )
      .map((question) => `${question.actorSiteId}@${question.actorOrdinal}`),
  );

  const edges: { from: number; to: number }[] = [];
  const seen = new Set<string>();
  for (const edge of graph.phaseEdges ?? []) {
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    const key = `${from}>${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from, to });
  }
  const streams = phaseStreamIndexes(graph.phaseStreams, index);
  const alongsideIndexes = phases.map((phase) =>
    (phase.alongside ?? []).flatMap((id) => {
      const at = index.get(id);
      return at === undefined ? [] : [at];
    }),
  );
  const folded = foldPhaseBands(phases.length, alongsideIndexes, streams);
  const fold = foldPhaseEdges(phases.length, folded, edges, streams);
  const arcPairs = [...fold.arcs].sort(
    (left, right) => Math.abs(left.from - left.to) - Math.abs(right.from - right.to),
  );
  const onLoop = new Set<number>();
  for (const arc of arcPairs) {
    if (arc.to >= arc.from || arc.stream) continue;
    for (const end of [arc.from, arc.to]) {
      const band = bandOf(folded, end);
      if (band === undefined) onLoop.add(end);
      else for (let i = band.from; i <= band.to; i += 1) onLoop.add(i);
    }
  }

  const avatarIndexes = new Map<string, number>();
  const nodeStatuses: (StepRunStatus | undefined)[] = [];
  const entered: boolean[] = [];
  const hasMembers: boolean[] = [];
  const stations: TimelineStation[] = phases.map((phase, i) => {
    const memberSteps = members.get(phase.id) ?? [];
    const unlisted = stationUnlisted(run, binder, phase.id);
    const observed = observePhase(
      run,
      siteIdsOf(memberSteps),
      phaseEntryFor(run, phase.name),
      (node) => binder.has(phase.id, node.phaseName),
      unlisted,
    );
    const pills: TimelinePill[] = participantsOfPhase(live.graph, phase.id).map((participant) => {
      const instance = live.instances[participant.id];
      const lane = laneRefs.get(participant.lane) ?? {
        id: participant.lane,
        laneClass: laneClassOf(participant.lane),
      };
      const status =
        run === undefined
          ? undefined
          : (participantStatus(participant, overlay.statuses, live.participantStatuses) ??
            "pending");
      const sessionId =
        instance === undefined
          ? undefined
          : sessionByInstance.get(`${participant.lane}@${instance.ordinal}`);
      const slot =
        run !== undefined && lane.laneClass === "agent"
          ? {
              ordinal: instance?.ordinal ?? (participant.member?.index ?? 0) + 1,
              siteId: participant.lane,
            }
          : undefined;
      const avatarKey = `${participant.lane}@${instance?.ordinal ?? (participant.member?.index ?? 0) + 1}`;
      if (lane.laneClass === "agent" && !avatarIndexes.has(avatarKey)) {
        avatarIndexes.set(avatarKey, avatarIndexes.size);
      }
      return {
        ...(lane.laneClass === "agent" ? { avatarIndex: avatarIndexes.get(avatarKey)! } : {}),
        key: participant.id,
        lane,
        laneClass: lane.laneClass,
        ...(instance?.name === undefined ? {} : { runtimeName: instance.name }),
        status,
        ...(instance === undefined
          ? {}
          : {
              instance: {
                ordinal: instance.ordinal,
                siteId: participant.lane,
                ...(sessionId === undefined ? {} : { sessionId }),
              },
            }),
        ...(slot === undefined ? {} : { slot }),
        ...(run !== undefined && lane.laneClass === "workspace"
          ? { workspace: { phaseId: phase.id } }
          : {}),
        stepIds: [...participant.steps],
        ...(instance !== undefined && askingInstances.has(`${participant.lane}@${instance.ordinal}`)
          ? { asking: true as const }
          : {}),
      };
    });
    const nodeStatus = collapseStatuses(
      memberSteps.map((step) => step.id),
      overlay.statuses,
    );
    nodeStatuses.push(nodeStatus);
    entered.push(observed.entered);
    hasMembers.push(memberSteps.length > 0);
    const hole = holes.byPhase.get(phase.id);
    const waiting = hole?.state === "waiting";
    return {
      id: phase.id,
      naming: { id: phase.id, ...(phase.name === undefined ? {} : { name: phase.name }) },
      pills,
      status: waiting
        ? "running"
        : stationStatus(run, nodeStatus, isCurrentPhase(run, phase.name), observed.entered),
      visited: observed.visited || waiting,
      rounds: observed.rounds,
      ...(hole === undefined ? {} : { hole }),
      ...stationFillOf(phase, hole),
      onLoop: onLoop.has(i),
      track: trackOf(folded, i),
      ...(observed.observed === 0
        ? {}
        : { fraction: { observed: observed.observed, settled: observed.settled } }),
      ...(unlisted === undefined ? {} : { unlisted }),
    };
  });

  const staged = stageStatuses({
    alongside: alongsideIndexes,
    entered,
    hasMembers,
    nodeStatuses,
    run,
    sequential: stations.map((station) => station.status),
    streams,
  });
  stations.forEach((station, i) => {
    if (station.hole?.state !== "waiting") station.status = staged[i];
  });

  const visited = (i: number): boolean => stations[i]?.visited === true;
  let runningIndex: number | undefined;
  for (let i = stations.length - 1; i >= 0; i -= 1) {
    if (stations[i]?.status === "running") {
      runningIndex = i;
      break;
    }
  }

  const rails: TimelineRail[] = fold.rails.map((rail: RailSpec) => ({
    from: rail.from,
    ink:
      rail.kind === "stream"
        ? streamInk(stations[rail.from]!, stations[rail.to]!)
        : visited(rail.from) && visited(rail.to)
          ? ("strong" as TimelineInk)
          : "faint",
    ...(rail.kind === undefined ? {} : { kind: rail.kind }),
    to: rail.to,
    ...(railTouchesHole(stations, rail) ? { dashed: true as const } : {}),
  }));
  const lanes = assignAirLanes(arcPairs);
  const arcs: TimelineArc[] = arcPairs.map((arc, at) => {
    const back = arc.to < arc.from;
    const strong = back
      ? visited(arc.from) && (stations[arc.to]?.rounds ?? 0) >= 2
      : visited(arc.from) && visited(arc.to);
    return {
      air: arc.air,
      from: arc.from,
      ink: arc.stream
        ? streamInk(stations[arc.from]!, stations[arc.to]!)
        : strong
          ? "strong"
          : "faint",
      lane: lanes[at] ?? 0,
      ...(arc.stream ? { stream: true as const } : {}),
      to: arc.to,
    };
  });

  for (let r = 0; r < stations.length; r += 1) {
    if (stations[r]?.status !== "running") continue;
    const entry = bandOf(folded, r)?.from ?? r;
    const reentry = arcs.find(
      (arc) =>
        !arc.stream &&
        arc.to === entry &&
        arc.from > arc.to &&
        visited(arc.from) &&
        stations[r]!.rounds >= 2,
    );
    if (reentry !== undefined) {
      reentry.ink = "march";
      continue;
    }
    const inbound = rails.filter(
      (rail) =>
        rail.to === r && rail.kind !== "twin" && rail.kind !== "stream" && visited(rail.from),
    );
    if (inbound.length > 0) {
      for (const rail of inbound) rail.ink = "march";
      continue;
    }
    const landing = arcs.find((arc) => !arc.stream && arc.to === r && visited(arc.from));
    if (landing !== undefined) landing.ink = "march";
  }

  const railInk = (from: number, to: number): TimelineInk =>
    rails.find((rail) => rail.from === from && rail.to === to && rail.kind !== "twin")?.ink ??
    "faint";
  const bands: TimelineBand[] = fold.bands.map((band) => ({
    from: band.from,
    ...(band.join === undefined ? {} : { join: band.join }),
    ...(band.pred === undefined ? {} : { pred: band.pred }),
    to: band.to,
    tracks: band.tracks.map((members) => {
      const head = members[0]!;
      const tail = members[members.length - 1]!;
      return {
        entry:
          band.pred === undefined
            ? ((visited(head) ? "strong" : "faint") as TimelineInk)
            : railInk(band.pred, head),
        exit:
          band.join === undefined
            ? ((visited(tail) ? "strong" : "faint") as TimelineInk)
            : railInk(tail, band.join),
        stations: [...members],
      };
    }),
  }));

  const tailStub = tailStubOf(stations);
  return {
    arcs,
    bands,
    fills: holes.fills,
    ...(Object.keys(holes.parents).length === 0 ? {} : { holeParents: holes.parents }),
    live: run !== undefined,
    rails,
    runningIndex,
    stations,
    ...(tailStub === undefined ? {} : { tailStub }),
  };
}
