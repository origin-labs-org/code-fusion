// ============================================================
// ============================================================
//
//
//

import {
  WORKFLOW_RUNS_LIMITS,
  type WorkflowRunActor,
  type WorkflowRunNode,
  type WorkflowRunState,
} from "./workflow-runs.js";
import { addToUnlistedBucket, withUnlistedBuckets } from "./workflow-runs-unlisted.js";

export interface WorkflowRunEntryLimits {
  readonly maxActors: number;
  readonly maxNodes: number;
  readonly maxPhases: number;
}

interface InstanceRef {
  siteId: string;
  ordinal: number;
}

interface Candidate {
  index: number;
  phaseName: string | undefined;
  failed: boolean;
}

interface Group extends Candidate {
  nodeIndexes: number[];
  
  finished: boolean;
  
  idle: boolean;
  
  zeroNode: boolean;
}

interface EvictedAgent {
  phaseName: string | undefined;
  actors: number;
  actorsSettled?: number;
  actorsFailed?: number;
}

export interface WorkflowNodeSeating {
  
  run: WorkflowRunState;
  
  admitNew: boolean;
  
  activated: boolean;
}

function sameInstance(left: InstanceRef, right: InstanceRef): boolean {
  return left.siteId === right.siteId && left.ordinal === right.ordinal;
}

function isFailed(node: WorkflowRunNode): boolean {
  return node.outcome === "failed" || node.outcome === "cancelled";
}

export function admitsNewEntry(run: WorkflowRunState, live: boolean): boolean {
  return run.truncated !== true || live;
}

export function withRoomForActor(
  run: WorkflowRunState,
  ref: InstanceRef,
  limits: WorkflowRunEntryLimits = WORKFLOW_RUNS_LIMITS,
): WorkflowRunState {
  if (run.actors.length < limits.maxActors) return run;
  if (run.actors.some((actor) => sameInstance(actor, ref))) return run;
  const victim = pickVictim(listedGroups(run).filter((group) => group.finished));
  return victim === undefined ? run : evictGroup(run, victim, limits);
}

export function seatWorkflowNode(
  run: WorkflowRunState,
  seat: {
    eventType: string;
    ref: InstanceRef;
    actorRef: InstanceRef | null;
    
    actor: WorkflowRunActor | null;
    
    born: boolean;
    advancesWaterMark: boolean;
  },
  limits: WorkflowRunEntryLimits = WORKFLOW_RUNS_LIMITS,
): WorkflowNodeSeating {
  const byBirth = admitsNewEntry(run, seat.born && seat.advancesWaterMark);
  if (!seat.advancesWaterMark) return { run, admitNew: byBirth, activated: false };
  if (seat.eventType === "node-dispatched" && seat.actor !== null && run.truncated === true) {
    return activateInstance(run, seat.ref, seat.actor, limits);
  }
  if (
    seat.born &&
    run.truncated === true &&
    seat.actorRef !== null &&
    !run.actors.some((actor) => sameInstance(actor, seat.actorRef!))
  ) {
    return { run, admitNew: false, activated: false };
  }
  if (seat.eventType !== "node-queued") return { run, admitNew: byBirth, activated: false };
  return {
    run: withRoomForNode(run, seat.ref, seat.actorRef, limits),
    admitNew: byBirth,
    activated: false,
  };
}

function withRoomForNode(
  run: WorkflowRunState,
  ref: InstanceRef,
  owner: InstanceRef | null,
  limits: WorkflowRunEntryLimits,
): WorkflowRunState {
  if (run.nodes.length < limits.maxNodes) return run;
  if (run.nodes.some((node) => sameInstance(node, ref))) return run;
  const loose = pickVictim(looseSettledNodes(run));
  if (loose !== undefined) return evictSingleNode(run, loose, limits);
  const victim = pickVictim(spareGroups(run, owner).filter((group) => group.finished));
  return victim === undefined ? run : evictGroup(run, victim, limits);
}

function activateInstance(
  run: WorkflowRunState,
  ref: InstanceRef,
  actor: WorkflowRunActor,
  limits: WorkflowRunEntryLimits,
): WorkflowNodeSeating {
  const nodeListed = run.nodes.some((node) => sameInstance(node, ref));
  const actorListed = run.actors.some((listed) => sameInstance(listed, actor));
  if (nodeListed && actorListed) return { run, admitNew: true, activated: false };
  let next = run;
  if (!actorListed && next.actors.length >= limits.maxActors) {
    const victim = pickGroupVictim(next, null, true);
    if (victim === undefined) return { run, admitNew: false, activated: false };
    next = evictGroup(next, victim, limits);
  }
  if (!nodeListed && next.nodes.length >= limits.maxNodes) {
    const own = ownSettledNodes(next, actor)[0];
    if (own !== undefined) next = evictSingleNode(next, own, limits);
    else {
      const loose = pickVictim(looseSettledNodes(next));
      if (loose !== undefined) next = evictSingleNode(next, loose, limits);
      else {
        const victim = pickGroupVictim(next, actor, false);
        if (victim === undefined) return { run, admitNew: false, activated: false };
        next = evictGroup(next, victim, limits);
      }
    }
  }
  if (!actorListed) {
    next = withUnlistedBuckets(
      { ...next, actors: [...next.actors, actor] },
      addToUnlistedBucket(next.unlistedByPhase, actor.phaseName, { actors: -1 }, limits.maxPhases),
    );
  }
  return { run: next, admitNew: true, activated: !nodeListed };
}

export function absorbRefusedActor(
  run: WorkflowRunState,
  phaseName: string | undefined,
  limits: WorkflowRunEntryLimits = WORKFLOW_RUNS_LIMITS,
): WorkflowRunState {
  return withUnlistedBuckets(
    run,
    addToUnlistedBucket(run.unlistedByPhase, phaseName, { actors: 1 }, limits.maxPhases),
  );
}

export function absorbRefusedSettledNode(
  run: WorkflowRunState,
  node: WorkflowRunNode,
  limits: WorkflowRunEntryLimits = WORKFLOW_RUNS_LIMITS,
): WorkflowRunState {
  let buckets = addToUnlistedBucket(
    run.unlistedByPhase,
    node.phaseName,
    { settled: 1 },
    limits.maxPhases,
  );
  const owner =
    node.actorSiteId === undefined || node.actorOrdinal === undefined
      ? null
      : { siteId: node.actorSiteId, ordinal: node.actorOrdinal };
  const index = owner === null ? -1 : run.actors.findIndex((actor) => sameInstance(actor, owner));
  const actor = index < 0 ? undefined : run.actors[index]!;
  const orphan = actor !== undefined && !ownsListedNode(run, actor);
  if (orphan) {
    buckets = addToUnlistedBucket(
      buckets,
      actor.phaseName,
      { actors: 1, actorsSettled: 1, actorsFailed: isFailed(node) ? 1 : 0 },
      limits.maxPhases,
    );
  }
  return withUnlistedBuckets(
    orphan ? { ...run, actors: run.actors.filter((_, position) => position !== index) } : run,
    buckets,
  );
}

export function workflowRunTablesForNewLife(run: WorkflowRunState): {
  actors: WorkflowRunActor[];
  nodes: WorkflowRunNode[];
} {
  if (run.truncated !== true) return { actors: run.actors, nodes: run.nodes };
  return { actors: [], nodes: [] };
}

function pickGroupVictim(
  run: WorkflowRunState,
  owner: InstanceRef | null,
  allowZeroNode: boolean,
): Group | undefined {
  const groups = spareGroups(run, owner);
  return (
    pickVictim(groups.filter((group) => group.finished)) ??
    groups.filter((group) => group.idle).at(-1) ??
    (allowZeroNode ? groups.filter((group) => group.zeroNode).at(-1) : undefined)
  );
}

function spareGroups(run: WorkflowRunState, owner: InstanceRef | null): Group[] {
  const groups = listedGroups(run);
  if (owner === null) return groups;
  return groups.filter((group) => !sameInstance(run.actors[group.index]!, owner));
}

function pickVictim<T extends Candidate>(candidates: readonly T[]): T | undefined {
  if (candidates.length === 0) return undefined;
  const unfailed = candidates.filter((candidate) => !candidate.failed);
  const pool = unfailed.length > 0 ? unfailed : candidates;
  const crowd = new Map<string, number>();
  for (const candidate of pool) {
    const key = candidate.phaseName ?? "";
    crowd.set(key, (crowd.get(key) ?? 0) + 1);
  }
  let best = pool[0]!;
  let bestCrowd = crowd.get(best.phaseName ?? "") ?? 0;
  for (const candidate of pool) {
    const size = crowd.get(candidate.phaseName ?? "") ?? 0;
    if (size > bestCrowd) {
      best = candidate;
      bestCrowd = size;
    }
  }
  return best;
}

function listedGroups(run: WorkflowRunState): Group[] {
  const owned = new Map<
    string,
    { nodeIndexes: number[]; live: boolean; queued: boolean; failed: boolean }
  >();
  run.nodes.forEach((node, index) => {
    if (node.actorSiteId === undefined || node.actorOrdinal === undefined) return;
    const key = instanceKey({ siteId: node.actorSiteId, ordinal: node.actorOrdinal });
    const bucket = owned.get(key) ?? { nodeIndexes: [], live: false, queued: false, failed: false };
    bucket.nodeIndexes.push(index);
    if (node.phase === "queued") bucket.queued = true;
    else if (node.phase !== "settled") bucket.live = true;
    if (isFailed(node)) bucket.failed = true;
    owned.set(key, bucket);
  });
  const groups: Group[] = [];
  run.actors.forEach((actor, index) => {
    const bucket = owned.get(instanceKey(actor));
    if (bucket?.live === true) return;
    groups.push({
      index,
      phaseName: actor.phaseName,
      failed: bucket?.failed ?? false,
      nodeIndexes: bucket?.nodeIndexes ?? [],
      finished: bucket !== undefined && !bucket.queued,
      idle: bucket?.queued === true,
      zeroNode: bucket === undefined,
    });
  });
  return groups;
}

function looseSettledNodes(run: WorkflowRunState): Candidate[] {
  const candidates: Candidate[] = [];
  run.nodes.forEach((node, index) => {
    if (node.actorSiteId !== undefined || node.phase !== "settled") return;
    candidates.push({ index, phaseName: node.phaseName, failed: isFailed(node) });
  });
  return candidates;
}

function ownSettledNodes(run: WorkflowRunState, owner: InstanceRef): Candidate[] {
  const candidates: Candidate[] = [];
  run.nodes.forEach((node, index) => {
    if (node.actorSiteId !== owner.siteId || node.actorOrdinal !== owner.ordinal) return;
    if (node.phase !== "settled") return;
    candidates.push({ index, phaseName: node.phaseName, failed: isFailed(node) });
  });
  return candidates;
}

function ownsListedNode(run: WorkflowRunState, actor: WorkflowRunActor): boolean {
  return run.nodes.some(
    (node) => node.actorSiteId === actor.siteId && node.actorOrdinal === actor.ordinal,
  );
}

function instanceKey(ref: InstanceRef): string {
  return `${ref.siteId}\0${ref.ordinal}`;
}

function evictGroup(
  run: WorkflowRunState,
  group: Group,
  limits: WorkflowRunEntryLimits,
): WorkflowRunState {
  const actor = run.actors[group.index]!;
  const dropped = new Set(group.nodeIndexes);
  const evicted = group.nodeIndexes.map((index) => run.nodes[index]!);
  return {
    ...withUnlistedEvictions(
      run,
      evicted,
      {
        phaseName: actor.phaseName,
        actors: 1,
        ...(group.finished ? { actorsSettled: 1, actorsFailed: group.failed ? 1 : 0 } : {}),
      },
      limits,
    ),
    actors: run.actors.filter((_, index) => index !== group.index),
    nodes: run.nodes.filter((_, index) => !dropped.has(index)),
    truncated: true,
  };
}

function evictSingleNode(
  run: WorkflowRunState,
  candidate: Candidate,
  limits: WorkflowRunEntryLimits,
): WorkflowRunState {
  const node = run.nodes[candidate.index]!;
  return {
    ...withUnlistedEvictions(run, [node], undefined, limits),
    nodes: run.nodes.filter((_, index) => index !== candidate.index),
    truncated: true,
  };
}

function withUnlistedEvictions(
  run: WorkflowRunState,
  nodes: readonly WorkflowRunNode[],
  agent: EvictedAgent | undefined,
  limits: WorkflowRunEntryLimits,
): WorkflowRunState {
  let buckets = run.unlistedByPhase;
  if (agent !== undefined) {
    const { phaseName, ...delta } = agent;
    buckets = addToUnlistedBucket(buckets, phaseName, delta, limits.maxPhases);
  }
  let settledCount = 0;
  for (const node of nodes) {
    if (node.phase !== "settled") continue;
    settledCount += 1;
    buckets = addToUnlistedBucket(buckets, node.phaseName, { settled: 1 }, limits.maxPhases);
  }
  const settledTotal = (run.usage.nodesUnlistedSettled ?? 0) + settledCount;
  return withUnlistedBuckets(
    {
      ...run,
      usage: {
        ...run.usage,
        nodesUnlisted: (run.usage.nodesUnlisted ?? 0) + nodes.length,
        ...(settledTotal > 0 ? { nodesUnlistedSettled: settledTotal } : {}),
      },
    },
    buckets,
  );
}
