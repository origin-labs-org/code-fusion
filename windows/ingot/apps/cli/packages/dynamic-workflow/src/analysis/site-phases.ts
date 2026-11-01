import type { AnalysisCore } from "./core.js";
import { UNPHASED_ID } from "./constants.js";
import type { ControlFlowGraph } from "./flow-graph.js";

export function collectPhaseNames(flow: Pick<ControlFlowGraph, "phases" | "holes"> | undefined): {
  phaseNames: string[];
  holes: number[];
} {
  const phaseNames: string[] = [];
  const holes: number[] = [];
  const open = new Set((flow?.holes ?? []).map((hole) => hole.siteId));
  for (const phase of flow?.phases ?? []) {
    if (phase.name === undefined) continue;
    if (open.has(phase.id)) holes.push(phaseNames.length);
    phaseNames.push(phase.name);
  }
  return { holes, phaseNames };
}

export function collectSitePhases(core: AnalysisCore): ReadonlyMap<string, string> {
  const nameOf = new Map<string, string>();
  for (const phase of core.trace.phases) nameOf.set(phase.id, phase.name);

  const claims = new Map<string, Set<string>>();
  const claim = (site: string, phase: string): void => {
    const set = claims.get(site);
    if (set === undefined) claims.set(site, new Set([phase]));
    else set.add(phase);
  };
  for (const event of core.trace.events) {
    if (event.at === "issue") claim(event.step, event.phase);
    else if (event.at === "actor") claim(event.actor, event.phase);
  }

  const table = new Map<string, string>();
  for (const [site, phases] of claims) {
    if (phases.size !== 1) continue;
    const [phase] = phases;
    if (phase === undefined || phase === UNPHASED_ID) continue;
    const name = nameOf.get(phase);
    if (name !== undefined) table.set(site, name);
  }
  return table;
}
