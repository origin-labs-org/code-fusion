import {
  isSyntheticLaneId,
  type WorkflowCausalityGraphData,
} from "@/components/workflow-graph/types.js";
import { isPlainRecord } from "@/ToolCallBlocks/renderers/createWorkflowInput.js";

export interface WorkflowHoleTarget {
  runId: string | undefined;
  holeId: string | undefined;
  name: string | undefined;
  draftPath: string | undefined;
  line: number | undefined;
}

export interface WorkflowDisplayFill {
  siteId: string;
  name: string;
  draftPath?: string;
  line?: number;
}

function trimmed(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

export function readWorkflowHoleTarget(
  input: unknown,
  fill?: WorkflowDisplayFill,
): WorkflowHoleTarget | undefined {
  if (!isPlainRecord(input)) return undefined;
  const hole = isPlainRecord(input.hole) ? input.hole : undefined;
  const line = fill?.line ?? hole?.line;
  return {
    runId: trimmed(input.run_id),
    holeId: trimmed(input.hole_id) ?? trimmed(fill?.siteId),
    name: trimmed(fill?.name) ?? trimmed(hole?.name),
    draftPath: trimmed(fill?.draftPath) ?? trimmed(hole?.draft_path),
    line: typeof line === "number" && Number.isInteger(line) && line > 0 ? line : undefined,
  };
}

export function readWorkflowHoleBody(input: unknown): string | undefined {
  return isPlainRecord(input) && typeof input.script === "string" ? input.script : undefined;
}

export function workflowFillCounts(
  graph: WorkflowCausalityGraphData | undefined,
  holeId: string,
): { phases: number; agents: number } {
  if (graph === undefined) return { agents: 0, phases: 0 };
  const phases = (graph.phases ?? []).filter((phase) => phase.fill === holeId).length;
  const lanes = new Set<string>();
  for (const step of graph.steps) {
    if (step.fill === holeId && step.kind !== "hole" && !isSyntheticLaneId(step.lane)) {
      lanes.add(step.lane);
    }
  }
  return { agents: lanes.size, phases };
}
