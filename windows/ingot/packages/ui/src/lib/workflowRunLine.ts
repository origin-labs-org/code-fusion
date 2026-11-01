import type {
  SessionWorkflowActivity,
  SessionWorkflowPhaseSummary,
  SessionWorkflowRunSummary,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { isSessionWorkflowRunLive } from "@origin-ai/cf-shared/cf-protocol-v4";
import { bandOf, foldPhaseBands, trackOf } from "../components/workflow-timeline/timeline-bands.js";

export const WORKFLOW_RUN_LINE_MAX_LINES = 2;

const WORKFLOW_RUN_RAIL_MAX_STATIONS = 6;

const RAIL_FOLD_RADIUS = 2;

export interface WorkflowRunRailStation {
  name: string;
  status: SessionWorkflowPhaseSummary["status"];
  
  reached: boolean;
  
  twin?: true;
  
  hole?: "open" | "waiting";
}

export interface WorkflowRunRail {
  stations: WorkflowRunRailStation[];
  
  hidden: number;
  
  implicit: boolean;
}

function isWorkflowRunStationReached(
  status: SessionWorkflowPhaseSummary["status"],
): boolean {
  return status !== "pending";
}

export function foldWorkflowRunRail(
  phases: readonly SessionWorkflowPhaseSummary[],
): WorkflowRunRail {
  if (phases.length === 0) {
    return { stations: [], hidden: 0, implicit: true };
  }
  const bands = foldPhaseBands(
    phases.length,
    phases.map((phase) => phase.alongside ?? []),
  );
  const all: WorkflowRunRailStation[] = phases.map((phase, index) => {
    const band = index === 0 ? undefined : bandOf(bands, index);
    const twin =
      band !== undefined &&
      band === bandOf(bands, index - 1) &&
      trackOf(bands, index) !== trackOf(bands, index - 1);
    return {
      name: phase.name,
      status: phase.status,
      reached: isWorkflowRunStationReached(phase.status) || phase.hole === "waiting",
      ...(twin ? { twin: true as const } : {}),
      ...(phase.hole === undefined ? {} : { hole: phase.hole }),
    };
  });
  if (all.length <= WORKFLOW_RUN_RAIL_MAX_STATIONS) {
    return { stations: all, hidden: 0, implicit: false };
  }
  let anchor = all.findIndex(
    (station) => station.status === "running" || station.hole === "waiting",
  );
  if (anchor < 0) {
    for (let index = all.length - 1; index >= 0; index -= 1) {
      if (all[index]!.reached) {
        anchor = index;
        break;
      }
    }
  }
  if (anchor < 0) anchor = 0;
  const windowSize = RAIL_FOLD_RADIUS * 2 + 1;
  let start = Math.max(0, anchor - RAIL_FOLD_RADIUS);
  const end = Math.min(all.length, start + windowSize);
  start = Math.max(0, end - windowSize);
  const stations = all.slice(start, end);
  return { stations, hidden: all.length - stations.length, implicit: false };
}

export const WORKFLOW_RUN_PARALLEL_SEPARATOR = " ∥ ";

export function workflowRunParallelPhaseLabel(
  phases: readonly SessionWorkflowPhaseSummary[],
): string | undefined {
  const running = phases.filter((phase) => phase.status === "running");
  return running.length > 1
    ? running.map((phase) => phase.name).join(WORKFLOW_RUN_PARALLEL_SEPARATOR)
    : undefined;
}

interface WorkflowRunLineSelection {
  lines: SessionWorkflowRunSummary[];
  
  overflow: number;
}

export function selectWorkflowRunLines(
  activity: SessionWorkflowActivity | undefined,
  isAcknowledged: (runId: string) => boolean,
): WorkflowRunLineSelection {
  if (activity === undefined) return { lines: [], overflow: 0 };
  const visible = activity.runs.filter(
    (run) => isSessionWorkflowRunLive(run.status) || !isAcknowledged(run.runId),
  );
  return {
    lines: visible.slice(0, WORKFLOW_RUN_LINE_MAX_LINES),
    overflow: Math.max(0, visible.length - WORKFLOW_RUN_LINE_MAX_LINES),
  };
}

export function settledWorkflowRunIds(activity: SessionWorkflowActivity | undefined): string[] {
  if (activity === undefined) return [];
  return activity.runs
    .filter((run) => !isSessionWorkflowRunLive(run.status))
    .map((run) => run.runId);
}

export function countLiveWorkflowRuns(activity: SessionWorkflowActivity | undefined): number {
  if (activity === undefined) return 0;
  return activity.runs.filter((run) => isSessionWorkflowRunLive(run.status)).length;
}
