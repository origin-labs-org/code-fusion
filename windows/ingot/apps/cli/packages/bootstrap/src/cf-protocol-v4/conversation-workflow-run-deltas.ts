// ============================================================
// ============================================================
//
//
//

import type { ConversationDelta, WorkflowRunsState } from "@origin-ai/cf-shared/cf-protocol-v4";
import { clampWorkflowRunsForLegacy, utf8JsonByteLength } from "@origin-ai/cf-shared/cf-protocol-v4";

function isWorkflowRunDelta(delta: ConversationDelta): boolean {
  return delta.op === "workflowRun.updated" || delta.op === "workflowRun.removed";
}

export function encodeConversationDeltasForLegacy(
  deltas: readonly ConversationDelta[],
  workflowRuns: WorkflowRunsState | undefined,
): readonly ConversationDelta[] {
  let lastIndex = -1;
  for (let index = deltas.length - 1; index >= 0; index -= 1) {
    if (isWorkflowRunDelta(deltas[index]!)) {
      lastIndex = index;
      break;
    }
  }
  if (lastIndex < 0) return deltas;

  const replacement: ConversationDelta | null =
    workflowRuns === undefined
      ? null
      : { op: "state.updated", patch: { workflowRuns: clampWorkflowRunsForLegacy(workflowRuns) } };
  const encoded: ConversationDelta[] = [];
  for (let index = 0; index < deltas.length; index += 1) {
    const delta = deltas[index]!;
    if (!isWorkflowRunDelta(delta)) {
      encoded.push(delta);
      continue;
    }
    if (index === lastIndex && replacement !== null) encoded.push(replacement);
  }
  return encoded;
}

//

const WORKFLOW_RUN_DELTA_ENVELOPE_SLACK_BYTES = 64;

export function workflowRunDeltaGrowthUpperBound(
  deltas: readonly ConversationDelta[],
): number | null {
  for (const delta of deltas) {
    if (delta.op !== "workflowRun.updated" && delta.op !== "workflowRun.removed") return null;
  }
  return utf8JsonByteLength(deltas) + WORKFLOW_RUN_DELTA_ENVELOPE_SLACK_BYTES;
}
