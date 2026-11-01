import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import { workflowRunOverlay } from "@/components/workflow-graph/run-status.js";
import type { WorkflowCausalityGraphData } from "@/components/workflow-graph/types.js";
import type { TimelinePill } from "./timeline-model.js";

export function pillActivity(
  graph: WorkflowCausalityGraphData,
  run: WorkflowRunState | undefined,
  pill: TimelinePill,
): { label: string; asks: number; reads: number } {
  const stepsById = new Map(graph.steps.map((step) => [step.id, step]));
  const statuses = run === undefined ? {} : workflowRunOverlay(run, graph).statuses;
  let asks = 0;
  let reads = 0;
  let running: string | undefined;
  let done: string | undefined;
  let first: string | undefined;
  for (const id of pill.stepIds) {
    const step = stepsById.get(id);
    if (step === undefined || step.kind === "hole") continue;
    if (step.kind === "world-read") reads += 1;
    else asks += 1;
    first ??= step.label;
    const status = statuses[id];
    if (status === "running") running ??= step.label;
    else if (status === "done" || status === "failed") done = step.label;
  }
  return { asks, label: running ?? done ?? first ?? "", reads };
}
