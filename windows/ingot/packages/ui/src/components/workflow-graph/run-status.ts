import type {
  WorkflowRunActor,
  WorkflowRunNode,
  WorkflowRunState,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { phaseBinder } from "./instance-phases.js";
import {
  isSyntheticLaneId,
  type StepRunStatus,
  type StepStatusTable,
  type WorkflowCausalityGraphData,
} from "./types.js";

export interface WorkflowRunOverlay {
  
  statuses: StepStatusTable;
  
  animatedEdges: boolean;
}

export function statusOfRunNode(node: WorkflowRunNode): StepRunStatus {
  switch (node.phase) {
    case "executing":
    case "repairing":
    case "nudged":
      return "running";
    case "settled":
      return node.outcome === "failed" || node.outcome === "cancelled" ? "failed" : "done";
    default:
      return "pending";
  }
}

export function aggregateRunStatuses(
  statuses: readonly StepRunStatus[],
): StepRunStatus | undefined {
  if (statuses.length === 0) return undefined;
  if (statuses.includes("running")) return "running";
  const queued = statuses.includes("pending");
  const settled = statuses.some((status) => status === "done" || status === "failed");
  if (queued) return settled ? "running" : "pending";
  return statuses.includes("failed") ? "failed" : "done";
}

interface OverlayTarget {
  instances: StepRunStatus[];
  lane?: string;
  phase?: string;
}

export function workflowRunOverlay(
  run: WorkflowRunState | undefined,
  graph: WorkflowCausalityGraphData,
): WorkflowRunOverlay {
  if (!run) return { statuses: {}, animatedEdges: false };

  const byStepId = new Map<string, StepRunStatus[]>();
  const targetsBySiteId = new Map<string, OverlayTarget[]>();
  for (const step of graph.steps) {
    const instances: StepRunStatus[] = [];
    byStepId.set(step.id, instances);
    const target: OverlayTarget = {
      instances,
      ...(step.source === undefined ? {} : { lane: step.lane }),
      ...(step.phase === undefined ? {} : { phase: step.phase }),
    };
    const siteId = step.source ?? step.id;
    const targets = targetsBySiteId.get(siteId);
    if (targets === undefined) targetsBySiteId.set(siteId, [target]);
    else targets.push(target);
  }

  const binder = phaseBinder(graph, run);
  for (const node of run.nodes) {
    const targets = targetsBySiteId.get(node.siteId);
    if (targets === undefined) continue;
    const status = statusOfRunNode(node);
    for (const target of targets) {
      const belongsToOtherLane =
        target.lane !== undefined &&
        node.actorSiteId !== undefined &&
        node.actorSiteId !== target.lane;
      if (belongsToOtherLane) continue;
      const belongsToOtherPhase =
        target.phase !== undefined && !binder.has(target.phase, node.phaseName);
      if (belongsToOtherPhase) continue;
      target.instances.push(status);
    }
  }

  const statuses: StepStatusTable = {};
  let anyRunning = false;
  for (const [stepId, instanceStatuses] of byStepId) {
    const status = aggregateRunStatuses(instanceStatuses);
    if (status === undefined) continue;
    statuses[stepId] = status;
    if (status === "running") anyRunning = true;
  }

  return { statuses, animatedEdges: anyRunning };
}

export function workflowRunActorsForLane(
  run: WorkflowRunState | undefined,
  laneId: string,
): WorkflowRunActor[] {
  if (!run || isSyntheticLaneId(laneId)) return [];
  return run.actors
    .filter((actor) => actor.siteId === laneId)
    .sort((left, right) => left.ordinal - right.ordinal);
}
