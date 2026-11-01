// ============================================================
// ============================================================
//
//

import type { GetWorkflowRunOutput } from "@origin-ai/cf-contracts";
import { GET_WORKFLOW_RUN_SUMMARY_MAX_CHARS } from "@origin-ai/cf-contracts";
import {
  formatRelativeAge,
  formatWorkflowRunCount,
  formatWorkflowRunDuration,
} from "./workflow-run-introspection.js";

export type WorkflowRunSummaryFacts = Omit<GetWorkflowRunOutput, "summary">;

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["completed", "errored", "stopped"]);

const SUMMARY_ELLIPSIS = "…";

export function buildWorkflowRunSummary(run: WorkflowRunSummaryFacts): string {
  const now = run.generatedAt;
  const terminal = TERMINAL_STATUSES.has(run.status);

  const required = [
    `${statusClause(run, now, terminal)}${phaseClause(run)}.`,
    `${stepsClause(run, terminal)}.`,
  ];
  const optional = [
    failureClause(run),
    questionsClause(run),
    holesClause(run),
    progressClause(run, now, terminal),
    deliverableClause(run),
    ownershipClause(run),
  ].filter((clause): clause is string => clause !== undefined);

  const sentences = [...required, ...optional];
  while (
    sentences.length > required.length &&
    sentences.join(" ").length > GET_WORKFLOW_RUN_SUMMARY_MAX_CHARS
  ) {
    sentences.pop();
  }
  const text = sentences.join(" ");
  if (text.length <= GET_WORKFLOW_RUN_SUMMARY_MAX_CHARS) return text;
  return `${text.slice(0, GET_WORKFLOW_RUN_SUMMARY_MAX_CHARS - SUMMARY_ELLIPSIS.length)}${SUMMARY_ELLIPSIS}`;
}

function statusClause(run: WorkflowRunSummaryFacts, now: number, terminal: boolean): string {
  const elapsed = formatWorkflowRunDuration(run.updatedAt - run.createdAt);
  if (!terminal) {
    return run.status === "pending"
      ? "Pending, not dispatched yet"
      : `Running for ${formatWorkflowRunDuration(now - run.createdAt)}`;
  }
  if (run.status === "completed") return `Completed in ${elapsed}`;
  if (run.status === "errored") return `Errored after ${elapsed}`;
  const reason = run.stopReason === undefined ? "stopped" : run.stopReason;
  const endedAge = formatRelativeAge(now, run.updatedAt);
  const ended = endedAge === undefined ? "" : ` ${endedAge}`;
  return `Stopped (${reason})${ended} after ${elapsed}`;
}

function phaseClause(run: WorkflowRunSummaryFacts): string {
  const phases = run.phases;
  if (phases === undefined || phases.length === 0) return "";
  const index = phases.findIndex(
    (phase) => phase.state === "current" || phase.state === "unfinished",
  );
  if (index < 0) return `, across ${phases.length} phase${phases.length === 1 ? "" : "s"}`;
  return `, in phase ${index + 1} of ${phases.length} (${phases[index]!.name})`;
}

function stepsClause(run: WorkflowRunSummaryFacts, terminal: boolean): string {
  const settled = run.usage.nodesCompleted + run.usage.nodesFailed;
  const leftover = run.health.leftoverRunning;
  if (terminal && leftover !== undefined && leftover > 0) {
    return `${settled} of ${run.usage.nodesObserved} dispatched steps settled; ${leftover} ${
      leftover === 1 ? "was" : "were"
    } still running when the owning process exited and will be re-dispatched on resume`;
  }
  if (terminal) {
    const failed = run.usage.nodesFailed > 0 ? `, ${run.usage.nodesFailed} failed` : "";
    return `${settled} step${settled === 1 ? "" : "s"} settled${failed}, ${formatWorkflowRunCount(
      run.usage.spentTokens,
    )} tokens`;
  }
  const running =
    run.usage.nodesRunning > 0 ? `, ${run.usage.nodesRunning} running${runningBreakdown(run)}` : "";
  return `${settled} of ${run.usage.nodesObserved} dispatched steps settled${running}`;
}

function runningBreakdown(run: WorkflowRunSummaryFacts): string {
  const counts = { executing: 0, waiting: 0, parked: 0 };
  for (const subagent of run.subagents) {
    if (subagent.state === "executing") counts.executing += 1;
    else if (subagent.state === "waiting") counts.waiting += 1;
    else if (subagent.state === "parked") counts.parked += 1;
  }
  const parts = (Object.keys(counts) as (keyof typeof counts)[])
    .filter((key) => counts[key] > 0)
    .map((key) => `${counts[key]} ${key}`);
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

function questionsClause(run: WorkflowRunSummaryFacts): string | undefined {
  if (!run.health.pendingQuestionsKnown) return "Pending questions are unknown from this session.";
  const count = run.pendingQuestions?.length ?? 0;
  if (count === 0) return undefined;
  return `${count} question${count === 1 ? "" : "s"} awaiting your answer.`;
}

function holesClause(run: WorkflowRunSummaryFacts): string | undefined {
  const count = (run.holes ?? []).filter((hole) => hole.state === "waiting").length;
  if (count === 0) return undefined;
  return `${count} hole${count === 1 ? "" : "s"} awaiting your code.`;
}

function progressClause(
  run: WorkflowRunSummaryFacts,
  now: number,
  terminal: boolean,
): string | undefined {
  if (terminal) return undefined;
  const age = formatRelativeAge(now, run.health.lastProgressAt);
  if (age === undefined) return undefined;
  return run.health.stalledSince === undefined
    ? `Last progress ${age}.`
    : `Stalled, last progress ${age}.`;
}

function failureClause(run: WorkflowRunSummaryFacts): string | undefined {
  if (run.error === undefined) return undefined;
  if (run.status !== "errored" && run.stopReason !== "provider") return undefined;
  return `Failure: ${run.error.code}.`;
}

function deliverableClause(run: WorkflowRunSummaryFacts): string | undefined {
  if (run.status !== "completed") return undefined;
  const primary = run.artifacts?.find((artifact) => artifact.primary === true);
  if (primary === undefined) return undefined;
  return `Deliverable: ${primary.title ?? primary.id} (${primary.kind}, primary).`;
}

function ownershipClause(run: WorkflowRunSummaryFacts): string | undefined {
  return run.ownedByThisSession ? undefined : "Owned by another session.";
}
