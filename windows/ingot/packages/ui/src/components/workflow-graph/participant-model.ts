import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import { phaseBinder } from "./instance-phases.js";
import { aggregateRunStatuses, statusOfRunNode } from "./run-status.js";
import {
  IMPLICIT_PHASE_ID,
  MAIN_LANE_ID,
  type StepRunStatus,
  type StepStatusTable,
  type WorkflowCausalityGraphData,
  type WorkflowHandoffData,
  type WorkflowParticipantData,
  type WorkflowPhaseData,
} from "./types.js";

export { IMPLICIT_PHASE_ID };

export function hasPhaseVocabulary(graph: WorkflowCausalityGraphData): boolean {
  return graph.phases !== undefined && graph.phases.length > 0;
}

export function withImplicitPhase(graph: WorkflowCausalityGraphData): WorkflowCausalityGraphData {
  if (hasPhaseVocabulary(graph)) return graph;
  return {
    ...graph,
    exits: graph.sink !== undefined && graph.sink.length > 0 ? [IMPLICIT_PHASE_ID] : [],
    participants: graph.participants.map((participant) => ({
      ...participant,
      phase: IMPLICIT_PHASE_ID,
    })),
    phaseEdges: [],
    phases: [{ id: IMPLICIT_PHASE_ID }],
    steps: graph.steps.map((step) => ({ ...step, phase: IMPLICIT_PHASE_ID })),
  };
}

export function participantsOfPhase(
  graph: WorkflowCausalityGraphData,
  phaseId: string,
): WorkflowParticipantData[] {
  return graph.participants.filter(
    (participant) => participant.phase === phaseId && participant.lane !== MAIN_LANE_ID,
  );
}

export function participantById(
  graph: WorkflowCausalityGraphData,
  id: string,
): WorkflowParticipantData | undefined {
  return graph.participants.find((participant) => participant.id === id);
}

export function handoffsWithin(
  graph: WorkflowCausalityGraphData,
  ids: ReadonlySet<string>,
): WorkflowHandoffData[] {
  return graph.handoffs.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
}

export function handoffsAround(
  graph: WorkflowCausalityGraphData,
  id: string,
): { incoming: WorkflowHandoffData[]; outgoing: WorkflowHandoffData[] } {
  return {
    incoming: graph.handoffs.filter((edge) => edge.to === id),
    outgoing: graph.handoffs.filter((edge) => edge.from === id),
  };
}

export interface ParticipantCounts {
  asks: number;
  reads: number;
}

export function participantCounts(
  graph: WorkflowCausalityGraphData,
  participant: WorkflowParticipantData,
): ParticipantCounts {
  const kinds = new Map(graph.steps.map((step) => [step.id, step.kind]));
  let asks = 0;
  let reads = 0;
  for (const id of participant.steps) {
    const kind = kinds.get(id);
    if (kind === "hole") continue;
    if (kind === "world-read") reads += 1;
    else asks += 1;
  }
  return { asks, reads };
}

export function participantRepeats(
  graph: WorkflowCausalityGraphData,
  participant: WorkflowParticipantData,
): boolean {
  const repeating = new Set(
    graph.steps.filter((step) => step.repeat !== undefined).map((step) => step.id),
  );
  return participant.steps.some((id) => repeating.has(id));
}

export function collapseStatuses(
  stepIds: readonly string[],
  statuses: StepStatusTable | undefined,
): StepRunStatus | undefined {
  if (statuses === undefined) return undefined;
  const values: StepRunStatus[] = [];
  for (const id of stepIds) {
    const status = statuses[id];
    if (status !== undefined) values.push(status);
  }
  return aggregateRunStatuses(values);
}

export function participantStatus(
  participant: WorkflowParticipantData,
  statuses: StepStatusTable | undefined,
  participantStatuses?: Record<string, StepRunStatus>,
): StepRunStatus | undefined {
  return participantStatuses?.[participant.id] ?? collapseStatuses(participant.steps, statuses);
}

export function participantAlsoIn(
  graph: WorkflowCausalityGraphData,
  participant: WorkflowParticipantData,
): WorkflowPhaseData[] {
  const phases = new Set(
    graph.participants
      .filter((other) => other.lane === participant.lane && other.phase !== participant.phase)
      .map((other) => other.phase),
  );
  return (graph.phases ?? []).filter((phase) => phases.has(phase.id));
}

export function instanceCardId(participantId: string, ordinal: number): string {
  return `${participantId}@${ordinal}`;
}

export interface ParticipantInstance {
  
  participant: string;
  ordinal: number;
  name?: string;
  
  bound?: true;
}

export interface LiveParticipantView {
  
  graph: WorkflowCausalityGraphData;
  
  participantStatuses: Record<string, StepRunStatus>;
  
  instances: Record<string, ParticipantInstance>;
}

export function liveParticipantView(
  graph: WorkflowCausalityGraphData,
  run: WorkflowRunState | undefined,
): LiveParticipantView {
  if (run === undefined) return { graph, instances: {}, participantStatuses: {} };
  const siteOf = new Map(graph.steps.map((step) => [step.id, step.source ?? step.id]));
  const binder = phaseBinder(graph, run);
  const sitesOf = (participant: WorkflowParticipantData) =>
    new Set(participant.steps.map((id) => siteOf.get(id) ?? id));
  const index = runIndex(run);
  
  const instancesOfCard = (participant: WorkflowParticipantData, sites: ReadonlySet<string>) => {
    const claimed: WorkflowRunState["actors"][number][] = [];
    for (const actor of index.actorsBySite.get(participant.lane) ?? []) {
      let seen = false;
      let here = false;
      for (const node of index.nodesByActor.get(actorKey(participant.lane, actor.ordinal)) ?? []) {
        if (!sites.has(node.siteId)) continue;
        seen = true;
        if (binder.has(participant.phase, node.phaseName)) {
          here = true;
          break;
        }
      }
      if (here || (!seen && binder.has(participant.phase, actor.phaseName))) claimed.push(actor);
    }
    return claimed;
  };
  const statusFor = (
    participant: WorkflowParticipantData,
    ordinal: number,
    sites: ReadonlySet<string>,
  ): StepRunStatus => {
    const values: StepRunStatus[] = [];
    for (const node of index.nodesByActor.get(actorKey(participant.lane, ordinal)) ?? []) {
      if (!sites.has(node.siteId) || !binder.has(participant.phase, node.phaseName)) continue;
      values.push(statusOfRunNode(node));
    }
    return aggregateRunStatuses(values) ?? "pending";
  };

  const participants: WorkflowParticipantData[] = [];
  const replacements = new Map<string, string[]>();
  const participantStatuses: Record<string, StepRunStatus> = {};
  const instances: Record<string, ParticipantInstance> = {};
  let changed = false;
  for (const participant of graph.participants) {
    const sites = sitesOf(participant);
    const actors = instancesOfCard(participant, sites);
    if (participant.member !== undefined) {
      const actor = actors[participant.member.index];
      participantStatuses[participant.id] =
        actor === undefined ? "pending" : statusFor(participant, actor.ordinal, sites);
      if (actor !== undefined) instances[participant.id] = boundInstance(participant.id, actor);
      participants.push(participant);
      continue;
    }
    if (participant.many !== true && actors.length === 1) {
      instances[participant.id] = boundInstance(participant.id, actors[0]!);
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
        participantStatuses[id] = statusFor(participant, actor.ordinal, sites);
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

function actorKey(siteId: string, ordinal: number): string {
  return `${siteId}\0${ordinal}`;
}

interface RunIndex {
  
  nodesByActor: ReadonlyMap<string, WorkflowRunState["nodes"][number][]>;
  
  actorsBySite: ReadonlyMap<string, WorkflowRunState["actors"][number][]>;
}

function runIndex(run: WorkflowRunState): RunIndex {
  const nodesByActor = new Map<string, WorkflowRunState["nodes"][number][]>();
  for (const node of run.nodes) {
    if (node.actorSiteId === undefined || node.actorOrdinal === undefined) continue;
    const key = actorKey(node.actorSiteId, node.actorOrdinal);
    const bucket = nodesByActor.get(key);
    if (bucket === undefined) nodesByActor.set(key, [node]);
    else bucket.push(node);
  }
  const actorsBySite = new Map<string, WorkflowRunState["actors"][number][]>();
  for (const actor of run.actors) {
    const bucket = actorsBySite.get(actor.siteId);
    if (bucket === undefined) actorsBySite.set(actor.siteId, [actor]);
    else bucket.push(actor);
  }
  for (const actors of actorsBySite.values()) actors.sort((a, b) => a.ordinal - b.ordinal);
  return { actorsBySite, nodesByActor };
}

function boundInstance(
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
