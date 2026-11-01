import { collapseStatuses, hasPhaseVocabulary } from "./participant-model.js";
import type {
  StepRunStatus,
  StepStatusTable,
  WorkflowCausalityGraphData,
  WorkflowPhaseData,
  WorkflowStepData,
} from "./types.js";

export { hasPhaseVocabulary };

export function phaseMembers(graph: WorkflowCausalityGraphData): Map<string, WorkflowStepData[]> {
  const members = new Map<string, WorkflowStepData[]>(
    (graph.phases ?? []).map((phase) => [phase.id, []]),
  );
  for (const step of graph.steps) {
    if (step.phase === undefined) continue;
    members.get(step.phase)?.push(step);
  }
  return members;
}

export function collapsePhaseStatus(
  members: readonly WorkflowStepData[],
  statuses: StepStatusTable | undefined,
): StepRunStatus | undefined {
  return collapseStatuses(
    members.map((step) => step.id),
    statuses,
  );
}

export function findPhase(
  graph: WorkflowCausalityGraphData,
  phaseId: string,
): WorkflowPhaseData | undefined {
  return (graph.phases ?? []).find((phase) => phase.id === phaseId);
}
