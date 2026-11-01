// ============================================================
// ============================================================
//
//
//

import type { WorkflowRunState, WorkflowRunUnlistedPhase } from "./workflow-runs.js";

export interface WorkflowRunUnlistedDelta {
  actors?: number;
  actorsSettled?: number;
  actorsFailed?: number;
  settled?: number;
}

export function addToUnlistedBucket(
  buckets: readonly WorkflowRunUnlistedPhase[] | undefined,
  phaseName: string | undefined,
  delta: WorkflowRunUnlistedDelta,
  maxPhases: number,
): WorkflowRunUnlistedPhase[] | undefined {
  const current = buckets ?? [];
  const index = current.findIndex((bucket) => bucket.phaseName === phaseName);
  if (index < 0 && current.length >= maxPhases + 1) {
    return buckets === undefined ? undefined : [...buckets];
  }
  const base = index < 0 ? undefined : current[index]!;
  const actors = atLeastZero((base?.actors ?? 0) + (delta.actors ?? 0));
  const actorsSettled = Math.min(
    atLeastZero((base?.actorsSettled ?? 0) + (delta.actorsSettled ?? 0)),
    actors,
  );
  const actorsFailed = Math.min(
    atLeastZero((base?.actorsFailed ?? 0) + (delta.actorsFailed ?? 0)),
    actorsSettled,
  );
  const settled = atLeastZero((base?.settled ?? 0) + (delta.settled ?? 0));
  if (actors === 0 && actorsSettled === 0 && actorsFailed === 0 && settled === 0) {
    if (index < 0) return buckets === undefined ? undefined : [...buckets];
    const remaining = current.filter((_, position) => position !== index);
    return remaining.length > 0 ? remaining : undefined;
  }
  const merged: WorkflowRunUnlistedPhase = {
    ...(phaseName === undefined ? {} : { phaseName }),
    actors,
    ...(actorsSettled > 0 ? { actorsSettled } : {}),
    ...(actorsFailed > 0 ? { actorsFailed } : {}),
    settled,
  };
  if (index < 0) return [...current, merged];
  const next = [...current];
  next[index] = merged;
  return next;
}

export function withUnlistedBuckets(
  run: WorkflowRunState,
  buckets: readonly WorkflowRunUnlistedPhase[] | undefined,
): WorkflowRunState {
  if (buckets === run.unlistedByPhase) return run;
  if (buckets === undefined || buckets.length === 0) {
    if (run.unlistedByPhase === undefined) return run;
    const { unlistedByPhase: _emptied, ...withoutKey } = run;
    return withoutKey;
  }
  return { ...run, unlistedByPhase: [...buckets] };
}

function atLeastZero(value: number): number {
  return value > 0 ? value : 0;
}
