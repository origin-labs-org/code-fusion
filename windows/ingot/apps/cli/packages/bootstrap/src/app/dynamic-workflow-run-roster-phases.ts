// ============================================================
// ============================================================
//

import type { DynamicWorkflowRunPhaseView } from "@origin-ai/cf-contracts";
import type { WorkflowRunNode, WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { RosterEventIndex } from "./dynamic-workflow-run-roster-events.js";

const WORLD_NODE_KIND = "world-read";

export function buildPhaseViews(input: {
  run: WorkflowRunState | undefined;
  index: RosterEventIndex;
  terminal: boolean;
}): DynamicWorkflowRunPhaseView[] | undefined {
  const { run, index, terminal } = input;
  const declared = run?.phaseNames ?? [];
  const entered = run?.phases ?? [];
  if (declared.length === 0 && entered.length === 0) return undefined;

  const names = [...declared];
  const seen = new Set(declared);
  for (const phase of entered) {
    if (seen.has(phase.name)) continue;
    seen.add(phase.name);
    names.push(phase.name);
  }

  const nodes = run?.nodes ?? [];
  return names.map((name) => {
    const rounds = entered.find((phase) => phase.name === name)?.rounds ?? 0;
    const owned = nodes.filter((node) => node.phaseName === name);
    const settled = owned.filter((node) => node.phase === "settled").length;
    const running = owned.length - settled;
    const trace = index.phases.get(name);
    return {
      name,
      state: phaseStateOf({ rounds, terminal, owned, isCurrent: run?.currentPhase === name }),
      rounds,
      nodesSettled: settled,
      nodesRunning: running,
      ...(trace?.enteredAt === undefined ? {} : { enteredAt: trace.enteredAt }),
      ...(trace?.exitedAt === undefined ? {} : { exitedAt: trace.exitedAt }),
    };
  });
}

function phaseStateOf(input: {
  rounds: number;
  terminal: boolean;
  owned: readonly WorkflowRunNode[];
  isCurrent: boolean;
}): DynamicWorkflowRunPhaseView["state"] {
  const { rounds, terminal, owned, isCurrent } = input;
  if (rounds === 0) return "ahead";
  if (terminal) {
    const leftover = owned.some(
      (node) => node.phase !== "settled" && node.kind !== WORLD_NODE_KIND,
    );
    return leftover ? "unfinished" : "done";
  }
  return isCurrent ? "current" : "done";
}
