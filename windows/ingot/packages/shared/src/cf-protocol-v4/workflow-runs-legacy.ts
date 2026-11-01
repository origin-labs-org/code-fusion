// ============================================================
// ============================================================
//

import { canonicalWorkflowRun } from "./workflow-runs-delta.js";
import {
  WORKFLOW_RUNS_LEGACY_LIMITS,
  type WorkflowRunActor,
  type WorkflowRunNode,
  type WorkflowRunsState,
} from "./workflow-runs.js";

export function clampWorkflowRunsForLegacy(state: WorkflowRunsState): WorkflowRunsState {
  let clamped = false;
  const runs = state.runs.map((run) => {
    const actors = clampKeepingLive(
      run.actors,
      WORKFLOW_RUNS_LEGACY_LIMITS.maxActors,
      (actor: WorkflowRunActor) => actor.status !== "completed",
    );
    const nodes = clampKeepingLive(
      run.nodes,
      WORKFLOW_RUNS_LEGACY_LIMITS.maxNodes,
      (node: WorkflowRunNode) => node.phase !== "settled",
    );
    if (actors === run.actors && nodes === run.nodes) return run;
    clamped = true;
    return canonicalWorkflowRun({ ...run, actors, nodes, truncated: true });
  });
  return clamped ? { revision: state.revision, runs } : state;
}

function clampKeepingLive<T>(
  list: readonly T[],
  limit: number,
  isLive: (entry: T) => boolean,
): T[] {
  if (list.length <= limit) return list as T[];
  const kept = new Set<number>();
  for (let index = 0; index < list.length && kept.size < limit; index += 1) {
    if (isLive(list[index]!)) kept.add(index);
  }
  for (let index = 0; index < list.length && kept.size < limit; index += 1) {
    kept.add(index);
  }
  return list.filter((_, index) => kept.has(index));
}
