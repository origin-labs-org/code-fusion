// ============================================================
// ============================================================

import { reduceRunStartedConcurrency } from "./workflow-runs-concurrency.js";
import { workflowRunTablesForNewLife } from "./workflow-runs-eviction.js";
import { withoutWaitingHoles } from "./workflow-runs-holes.js";
import { readRunIdField } from "./workflow-runs-lineage.js";
import { WORKFLOW_RUNS_LIMITS, type WorkflowRunState } from "./workflow-runs.js";

function readSubagentModel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 && text.length <= WORKFLOW_RUNS_LIMITS.maxSubagentModelLength
    ? text
    : undefined;
}

export function reduceRunStarted(
  run: WorkflowRunState,
  payload: Record<string, unknown>,
): WorkflowRunState {
  const {
    error: staleError,
    resultPreview: staleResultPreview,
    pendingQuestions: staleQuestions,
    resumable: staleResumable,
    stopReason: staleStopReason,
    unlistedByPhase: staleUnlisted,
    ...rebased
  } = run;
  void [
    staleError,
    staleResultPreview,
    staleQuestions,
    staleResumable,
    staleStopReason,
    staleUnlisted,
  ];
  const resumedFrom = readRunIdField(payload.resumedFrom) ?? rebased.resumedFrom;
  const subagentModel = readSubagentModel(payload.subagentModel) ?? rebased.subagentModel;
  return reduceRunStartedConcurrency(
    {
      ...withoutWaitingHoles(rebased as WorkflowRunState),
      ...(resumedFrom === undefined ? {} : { resumedFrom }),
      ...(subagentModel === undefined ? {} : { subagentModel }),
      status: "running",
      usage: { spentTokens: 0, nodesUsed: 0 },
      ...workflowRunTablesForNewLife(run),
    },
    payload,
  );
}
