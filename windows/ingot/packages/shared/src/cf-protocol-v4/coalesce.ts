//
import type { ConversationDelta, WorkflowRunUpdatedDelta } from "./delta.js";
import {
  mergeWorkflowRunUpdates,
  workflowRunUpdateWithinWireBounds,
  type WorkflowRunWireBounds,
} from "./workflow-runs-delta.js";

function isBarrier(delta: ConversationDelta): boolean {
  return delta.op === "row.removed";
}

function isWorkflowRunBarrier(delta: ConversationDelta, runId: string): boolean {
  if (delta.op === "state.updated") return delta.patch.workflowRuns !== undefined;
  return delta.op === "workflowRun.removed" && delta.runId === runId;
}

function mergeWorkflowRunUpdate(
  result: ConversationDelta[],
  delta: WorkflowRunUpdatedDelta,
  bounds: WorkflowRunWireBounds | undefined,
): boolean {
  let target = -1;
  for (let i = result.length - 1; i >= 0; i--) {
    const prev = result[i];
    if (prev === undefined || isWorkflowRunBarrier(prev, delta.runId)) break;
    if (prev.op === "workflowRun.updated" && prev.runId === delta.runId) {
      target = i;
      break;
    }
  }
  if (target < 0) return false;
  const merged = mergeWorkflowRunUpdates(result[target] as WorkflowRunUpdatedDelta, delta);
  if (!workflowRunUpdateWithinWireBounds(merged, bounds)) return false;
  result[target] = merged;
  return true;
}

export function coalesceConversationDeltas(
  deltas: readonly ConversationDelta[],
  bounds?: WorkflowRunWireBounds,
): ConversationDelta[] {
  const result: ConversationDelta[] = [];

  for (const delta of deltas) {
    if (delta.op === "row.upserted") {
      for (let i = result.length - 1; i >= 0; i--) {
        const prev = result[i];
        if (prev === undefined || isBarrier(prev)) break;
        if (prev.op === "row.delta" && prev.rowId === delta.row.rowId) {
          result.splice(i, 1);
          continue;
        }
        if (
          (prev.op === "row.upserted" || prev.op === "row.appended") &&
          prev.row.rowId === delta.row.rowId
        ) {
          break;
        }
      }
    }

    if (delta.op === "workflowRun.removed") {
      for (let i = result.length - 1; i >= 0; i--) {
        const prev = result[i];
        if (prev === undefined || isWorkflowRunBarrier(prev, delta.runId)) break;
        if (prev.op === "workflowRun.updated" && prev.runId === delta.runId) result.splice(i, 1);
      }
    }

    if (delta.op === "workflowRun.updated" && mergeWorkflowRunUpdate(result, delta, bounds))
      continue;

    const last = result[result.length - 1];

    if (
      delta.op === "row.delta" &&
      last?.op === "row.delta" &&
      last.rowId === delta.rowId &&
      last.path === delta.path
    ) {
      result[result.length - 1] = {
        op: "row.delta",
        rowId: delta.rowId,
        path: delta.path,
        append: last.append + delta.append,
      };
      continue;
    }

    if (delta.op === "state.updated" && last?.op === "state.updated") {
      result[result.length - 1] = {
        op: "state.updated",
        patch: { ...last.patch, ...delta.patch },
      };
      continue;
    }

    if (
      delta.op === "row.upserted" &&
      last?.op === "row.upserted" &&
      last.row.rowId === delta.row.rowId
    ) {
      result[result.length - 1] = delta;
      continue;
    }

    result.push(delta);
  }

  return result;
}

export function conflateByKey<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): T[] {
  const lastIndexByKey = new Map<string, number>();
  items.forEach((item, index) => {
    lastIndexByKey.set(keyOf(item), index);
  });
  return items.filter((item, index) => lastIndexByKey.get(keyOf(item)) === index);
}
