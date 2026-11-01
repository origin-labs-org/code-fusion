import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { PhaseBinder } from "@/components/workflow-graph/instance-phases.js";
import { phaseNameMatches } from "@/components/workflow-graph/phase-name.js";
import type { WorkflowCausalityGraphData } from "@/components/workflow-graph/types.js";

export interface ObservedPhase {
  visited: boolean;
  rounds: number;
  settled: number;
  observed: number;
  
  entered: boolean;
}

export interface StationUnlisted {
  actors: number;
  settled: number;
  failed: number;
  nodesSettled: number;
}

export function stationUnlisted(
  run: WorkflowRunState | undefined,
  binder: PhaseBinder,
  phaseId: string,
): StationUnlisted | undefined {
  const buckets = run?.unlistedByPhase;
  if (buckets === undefined) return undefined;
  const total: StationUnlisted = { actors: 0, failed: 0, nodesSettled: 0, settled: 0 };
  for (const bucket of buckets) {
    if (!binder.has(phaseId, bucket.phaseName)) continue;
    total.actors += bucket.actors;
    total.settled += bucket.actorsSettled ?? 0;
    total.failed += bucket.actorsFailed ?? 0;
    total.nodesSettled += bucket.settled;
  }
  return total.actors === 0 && total.settled === 0 && total.nodesSettled === 0 ? undefined : total;
}

type WorkflowRunPhaseEntry = NonNullable<WorkflowRunState["phases"]>[number];

export function phaseEntryFor(
  run: WorkflowRunState | undefined,
  name: string | undefined,
): WorkflowRunPhaseEntry | undefined {
  const entries = run?.phases;
  if (entries === undefined || name === undefined) return undefined;
  return (
    entries.find((entry) => entry.name === name) ??
    entries.find((entry) => phaseNameMatches(name, entry.name))
  );
}

export function siteIdsOf(
  steps: readonly WorkflowCausalityGraphData["steps"][number][],
): Set<string> {
  return new Set(steps.map((step) => step.source ?? step.id));
}

export function observePhase(
  run: WorkflowRunState | undefined,
  siteIds: ReadonlySet<string>,
  entry: WorkflowRunPhaseEntry | undefined,
  belongs: (node: WorkflowRunState["nodes"][number]) => boolean,
  unlisted: StationUnlisted | undefined,
): ObservedPhase {
  const result: ObservedPhase = {
    entered: false,
    observed: 0,
    rounds: 0,
    settled: 0,
    visited: false,
  };
  if (run === undefined) return result;
  for (const node of run.nodes) {
    if (!siteIds.has(node.siteId) || !belongs(node)) continue;
    result.visited = true;
    result.observed += 1;
    if (node.ordinal > result.rounds) result.rounds = node.ordinal;
    if (node.phase === "settled") result.settled += 1;
  }
  result.observed += unlisted?.nodesSettled ?? 0;
  result.settled += unlisted?.nodesSettled ?? 0;
  if (entry !== undefined) {
    result.entered = true;
    result.visited = true;
    if (entry.rounds > result.rounds) result.rounds = entry.rounds;
  }
  return result;
}
