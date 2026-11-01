import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import { phaseNameMatches } from "./phase-name.js";
import type { WorkflowCausalityGraphData } from "./types.js";

export function runHasPhaseVocabulary(run: WorkflowRunState | undefined): boolean {
  if (run === undefined) return false;
  return (
    run.actors.some((actor) => actor.phaseName !== undefined) ||
    run.nodes.some((node) => node.phaseName !== undefined)
  );
}

export function phasesOf(
  phaseName: string | undefined,
  graph: WorkflowCausalityGraphData,
  runHasVocabulary: boolean,
): Set<string> {
  const phases = graph.phases ?? [];
  const all = () => new Set(phases.map((phase) => phase.id));
  if (phaseName === undefined && !runHasVocabulary) return all();
  const matched = phases.filter((phase) =>
    phaseName === undefined ? phase.name === undefined : phaseNameMatches(phase.name, phaseName),
  );
  return matched.length === 0 ? all() : new Set(matched.map((phase) => phase.id));
}

export interface PhaseBinder {
  phasesOf(phaseName: string | undefined): ReadonlySet<string>;
  
  has(phaseId: string, phaseName: string | undefined): boolean;
}

export function phaseBinder(
  graph: WorkflowCausalityGraphData,
  run: WorkflowRunState | undefined,
): PhaseBinder {
  const vocabulary = runHasPhaseVocabulary(run);
  const ungrouped = (graph.phases ?? []).length === 0;
  const cache = new Map<string | undefined, ReadonlySet<string>>();
  const resolve = (phaseName: string | undefined): ReadonlySet<string> => {
    const hit = cache.get(phaseName);
    if (hit !== undefined) return hit;
    const phases = phasesOf(phaseName, graph, vocabulary);
    cache.set(phaseName, phases);
    return phases;
  };
  return {
    has: (phaseId, phaseName) => ungrouped || resolve(phaseName).has(phaseId),
    phasesOf: resolve,
  };
}
