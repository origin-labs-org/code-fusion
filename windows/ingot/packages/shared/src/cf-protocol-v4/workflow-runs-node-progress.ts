// ============================================================
// ============================================================
//
//

import {
  WORKFLOW_RUNS_LIMITS,
  type WorkflowRunNode,
  type WorkflowRunNodeLastTool,
  type WorkflowRunState,
} from "./workflow-runs.js";

type NodeProgressFields = Pick<
  WorkflowRunNode,
  "instructionsHead" | "turn" | "toolCalls" | "lastTool"
>;

export function carryNodeProgress(
  eventType: string,
  payload: Record<string, unknown>,
  previousNode: WorkflowRunNode | undefined,
): Partial<NodeProgressFields> {
  const requeued = eventType === "node-queued";
  const born = requeued || (eventType === "node-settled" && payload.cached === true);
  const carried = born ? undefined : previousNode;
  const head = boundedText(
    payload.instructionsHead,
    WORKFLOW_RUNS_LIMITS.maxInstructionsHeadLength,
  );
  const instructionsHead = requeued ? head : (head ?? previousNode?.instructionsHead);
  return {
    ...(instructionsHead === undefined ? {} : { instructionsHead }),
    ...(carried?.turn === undefined ? {} : { turn: carried.turn }),
    ...(carried?.toolCalls === undefined ? {} : { toolCalls: carried.toolCalls }),
    ...(carried?.lastTool === undefined ? {} : { lastTool: carried.lastTool }),
  };
}

export function reduceNodeProgress(
  run: WorkflowRunState,
  ref: { siteId: string; ordinal: number },
  payload: Record<string, unknown>,
): WorkflowRunState {
  const index = run.nodes.findIndex(
    (node) => node.siteId === ref.siteId && node.ordinal === ref.ordinal,
  );
  if (index < 0) return run;
  const node = run.nodes[index]!;
  const turn = readPositiveInt(payload.turn) ?? node.turn;
  const toolCalls = readNonNegativeInt(payload.toolCalls) ?? node.toolCalls;
  const lastTool = readLastTool(payload.lastTool) ?? node.lastTool;
  const nodes = [...run.nodes];
  nodes[index] = {
    ...node,
    ...(turn === undefined ? {} : { turn }),
    ...(toolCalls === undefined ? {} : { toolCalls }),
    ...(lastTool === undefined ? {} : { lastTool }),
  };
  return { ...run, nodes };
}

function readPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readNonNegativeInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function readLastTool(value: unknown): WorkflowRunNodeLastTool | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const name = boundedText(record.name, WORKFLOW_RUNS_LIMITS.maxLastToolNameLength);
  if (name === undefined) return undefined;
  const target = boundedText(record.target, WORKFLOW_RUNS_LIMITS.maxLastToolTargetLength);
  return { name, ...(target === undefined ? {} : { target }) };
}

function boundedText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.slice(0, limit);
  return text.length > 0 ? text : undefined;
}
