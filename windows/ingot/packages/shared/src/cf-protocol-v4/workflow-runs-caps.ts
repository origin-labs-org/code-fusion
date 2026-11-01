// ============================================================
// ============================================================
//

import {
  WORKFLOW_RUNS_LIMITS,
  type WorkflowRunState,
  type WorkflowRunUsage,
} from "./workflow-runs.js";

export interface UnlistedInstanceEvent {
  
  rejected: boolean;
  
  advancesWaterMark: boolean;
  eventType: string;
  
  cached: boolean;
}

export function countUnlistedInstance(
  usage: WorkflowRunUsage,
  event: UnlistedInstanceEvent,
): WorkflowRunUsage {
  if (!event.rejected || !event.advancesWaterMark) return usage;
  const settled = event.eventType === "node-settled";
  const born = event.eventType === "node-queued" || (settled && event.cached);
  if (!born && !settled) return usage;
  const nodesUnlisted = (usage.nodesUnlisted ?? 0) + (born ? 1 : 0);
  const nodesUnlistedSettled = (usage.nodesUnlistedSettled ?? 0) + (settled ? 1 : 0);
  return {
    ...usage,
    ...(nodesUnlisted > 0 ? { nodesUnlisted } : {}),
    ...(nodesUnlistedSettled > 0 ? { nodesUnlistedSettled } : {}),
  };
}

export function discountUnlistedInstance(usage: WorkflowRunUsage): WorkflowRunUsage {
  const current = usage.nodesUnlisted ?? 0;
  if (current === 0) return usage;
  const { nodesUnlisted: _returned, nodesUnlistedSettled: settled, ...head } = usage;
  return {
    ...head,
    ...(current > 1 ? { nodesUnlisted: current - 1 } : {}),
    ...(settled === undefined ? {} : { nodesUnlistedSettled: settled }),
  };
}

export function evictForEntryBudget(
  runs: WorkflowRunState[],
  eventRunId: string,
): WorkflowRunState[] {
  let total = 0;
  for (const run of runs) total += run.nodes.length + run.actors.length;
  if (total <= WORKFLOW_RUNS_LIMITS.maxTotalEntries) return runs;
  let remaining = runs;
  while (total > WORKFLOW_RUNS_LIMITS.maxTotalEntries) {
    const index = remaining.findIndex(
      (run) => run.runId !== eventRunId && run.status !== "pending" && run.status !== "running",
    );
    if (index < 0) break;
    total -= remaining[index]!.nodes.length + remaining[index]!.actors.length;
    remaining = [...remaining.slice(0, index), ...remaining.slice(index + 1)];
  }
  return remaining;
}

export function workflowRunStepCounts(run: WorkflowRunState): { total: number; settled: number } {
  let settledInList = 0;
  for (const node of run.nodes) if (node.phase === "settled") settledInList += 1;
  return {
    total: run.nodes.length + (run.usage.nodesUnlisted ?? 0),
    settled: settledInList + (run.usage.nodesUnlistedSettled ?? 0),
  };
}
