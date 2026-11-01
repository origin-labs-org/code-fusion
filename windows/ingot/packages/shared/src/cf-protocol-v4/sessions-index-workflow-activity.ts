// ============================================================
// ============================================================

import { z } from "zod";
import { timestampSchema } from "./core.js";
import type { BackgroundWorkSummary } from "./snapshot.js";
import {
  WORKFLOW_RUNS_LIMITS,
  workflowRunSchema,
  type WorkflowRunNode,
  type WorkflowRunState,
  type WorkflowRunsState,
} from "./workflow-runs.js";

export const SESSION_WORKFLOW_ACTIVITY_MAX_RUNS = 4;

export const sessionWorkflowPhaseStatusSchema = z.enum(["pending", "running", "done", "failed"]);
export type SessionWorkflowPhaseStatus = z.infer<typeof sessionWorkflowPhaseStatusSchema>;

export const sessionWorkflowPhaseSummarySchema = z.object({
  name: z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxPhaseNameLength),
  status: sessionWorkflowPhaseStatusSchema,
  
  alongside: z.array(z.number().int().nonnegative()).max(WORKFLOW_RUNS_LIMITS.maxPhases).optional(),
  
  hole: z.enum(["open", "waiting"]).optional(),
});
export type SessionWorkflowPhaseSummary = z.infer<typeof sessionWorkflowPhaseSummarySchema>;

export const sessionWorkflowRunSummarySchema = z.object({
  runId: z.string().min(1),
  
  toolCallId: z.string().min(1).optional(),
  
  name: z.string().min(1).optional(),
  status: workflowRunSchema.shape.status,
  stopReason: workflowRunSchema.shape.stopReason,
  
  startedAt: timestampSchema.optional(),
  
  phases: z.array(sessionWorkflowPhaseSummarySchema).max(WORKFLOW_RUNS_LIMITS.maxPhases),
  currentPhase: z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxPhaseNameLength).optional(),
  
  agentsWorking: z.number().int().nonnegative(),
  
  waitingHole: z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxPhaseNameLength).optional(),
});
export type SessionWorkflowRunSummary = z.infer<typeof sessionWorkflowRunSummarySchema>;

export const sessionWorkflowActivitySchema = z.object({
  runs: z.array(sessionWorkflowRunSummarySchema).max(SESSION_WORKFLOW_ACTIVITY_MAX_RUNS),
});
export type SessionWorkflowActivity = z.infer<typeof sessionWorkflowActivitySchema>;

export function isSessionWorkflowRunLive(status: SessionWorkflowRunSummary["status"]): boolean {
  return status === "pending" || status === "running";
}

function isRunNodeRunning(node: WorkflowRunNode): boolean {
  return node.phase === "executing" || node.phase === "repairing" || node.phase === "nudged";
}

function phaseNameMatches(stationName: string, stamp: string): boolean {
  return (
    stationName === stamp ||
    (stationName.length >= WORKFLOW_RUNS_LIMITS.maxPhaseNameLength && stamp.startsWith(stationName))
  );
}

export function deriveSessionWorkflowPhases(run: WorkflowRunState): SessionWorkflowPhaseSummary[] {
  const entered = new Set((run.phases ?? []).map((phase) => phase.name));
  const current = run.currentPhase;
  let names: string[];
  let alongside: readonly (readonly number[])[] | undefined;
  let holeIndexes: ReadonlySet<number> = new Set();
  const waitingNames = new Set(
    (run.holes ?? []).filter((hole) => hole.state === "waiting").map((hole) => hole.name),
  );
  if (run.phaseNames !== undefined && run.phaseNames.length > 0) {
    names = run.phaseNames;
    alongside = run.phaseAlongside;
    holeIndexes = new Set(run.phaseHoles ?? []);
  } else {
    names = (run.phases ?? []).map((phase) => phase.name);
    if (current !== undefined && !entered.has(current)) names = [...names, current];
  }
  const live = isSessionWorkflowRunLive(run.status);
  const burning = live
    ? run.nodes.filter(isRunNodeRunning).flatMap((node) => node.phaseName ?? [])
    : [];
  const emitted = Math.min(names.length, WORKFLOW_RUNS_LIMITS.maxPhases);
  return names.slice(0, WORKFLOW_RUNS_LIMITS.maxPhases).map((name, index) => {
    const isCurrent = name === current;
    const wasEntered = entered.has(name) || isCurrent;
    const burningHere = burning.some((stamp) => phaseNameMatches(name, stamp));
    let status: SessionWorkflowPhaseStatus;
    if (live) {
      status = isCurrent || burningHere ? "running" : wasEntered ? "done" : "pending";
    } else if (run.status === "completed") {
      status = wasEntered ? "done" : "pending";
    } else if (run.status === "errored") {
      status = isCurrent ? "failed" : wasEntered ? "done" : "pending";
    } else {
      status = isCurrent ? "pending" : wasEntered ? "done" : "pending";
    }
    const beside = (alongside?.[index] ?? []).filter(
      (other) => Number.isInteger(other) && other >= 0 && other < emitted && other !== index,
    );
    const hole = waitingNames.has(name) ? "waiting" : holeIndexes.has(index) ? "open" : undefined;
    return {
      name,
      status,
      ...(beside.length === 0 ? {} : { alongside: beside }),
      ...(hole === undefined ? {} : { hole }),
    };
  });
}

function summarizeRun(
  run: WorkflowRunState,
  work: BackgroundWorkSummary | undefined,
): SessionWorkflowRunSummary {
  const name = work?.title.trim();
  const waitingHole = isSessionWorkflowRunLive(run.status)
    ? (run.holes ?? []).find((hole) => hole.state === "waiting")?.name
    : undefined;
  return {
    runId: run.runId,
    ...(run.toolCallId === undefined ? {} : { toolCallId: run.toolCallId }),
    ...(name === undefined || name.length === 0 ? {} : { name }),
    status: run.status,
    ...(run.stopReason === undefined ? {} : { stopReason: run.stopReason }),
    ...(work === undefined ? {} : { startedAt: work.startedAt }),
    phases: deriveSessionWorkflowPhases(run),
    ...(run.currentPhase === undefined ? {} : { currentPhase: run.currentPhase }),
    agentsWorking: run.actors.filter((actor) => actor.status === "running").length,
    ...(waitingHole === undefined ? {} : { waitingHole }),
  };
}

export function deriveSessionWorkflowActivity(input: {
  workflowRuns: WorkflowRunsState | undefined;
  backgroundWorks: readonly BackgroundWorkSummary[];
}): SessionWorkflowActivity | undefined {
  const runs = input.workflowRuns?.runs;
  if (runs === undefined || runs.length === 0) return undefined;
  const workByRunId = new Map<string, BackgroundWorkSummary>();
  for (const work of input.backgroundWorks) {
    if (work.kind === "workflow") workByRunId.set(work.workId, work);
  }
  const live: SessionWorkflowRunSummary[] = [];
  const settled: { summary: SessionWorkflowRunSummary; endedAt: number; index: number }[] = [];
  runs.forEach((run, index) => {
    const work = workByRunId.get(run.runId);
    const summary = summarizeRun(run, work);
    if (isSessionWorkflowRunLive(run.status)) live.push(summary);
    else settled.push({ summary, endedAt: work?.endedAt ?? 0, index });
  });
  settled.sort((a, b) => b.endedAt - a.endedAt || b.index - a.index);
  return {
    runs: [...live, ...settled.map((entry) => entry.summary)].slice(
      0,
      SESSION_WORKFLOW_ACTIVITY_MAX_RUNS,
    ),
  };
}
