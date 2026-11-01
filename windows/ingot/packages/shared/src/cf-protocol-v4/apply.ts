import type { StreamablePath } from "./core.js";
import type { ConversationDelta } from "./delta.js";
import type { ConversationRow } from "./rows.js";
import type { ConversationSnapshot } from "./snapshot.js";
import { applyWorkflowRunRemoved, applyWorkflowRunUpdated } from "./workflow-runs-delta.js";

export interface MutableConversationSnapshotAccumulator {
  snapshot: ConversationSnapshot;
  rowIndexById: Map<number, number>;
}

export function createMutableConversationSnapshotAccumulator(
  snapshot: ConversationSnapshot,
): MutableConversationSnapshotAccumulator {
  const window = [...snapshot.rows.window];
  return {
    snapshot: {
      ...snapshot,
      rows: { ...snapshot.rows, window },
    },
    rowIndexById: new Map(window.map((row, index) => [row.rowId, index])),
  };
}

function appendToRow(
  row: ConversationRow,
  path: StreamablePath,
  append: string,
): ConversationRow {
  switch (path) {
    case "text":
      if (row.kind === "assistantText" || row.kind === "reasoning") {
        return { ...row, text: row.text + append };
      }
      return row;
    case "inputText":
      if (row.kind === "toolCall") {
        return { ...row, inputText: row.inputText + append };
      }
      return row;
    case "output.text":
      if (row.kind === "toolCall" && row.output) {
        return {
          ...row,
          output: { ...row.output, text: row.output.text + append },
        };
      }
      return row;
    case "summaryText":
      if (row.kind === "subagent") {
        return { ...row, summaryText: row.summaryText + append };
      }
      return row;
  }
}

export function applyConversationDelta(
  snapshot: ConversationSnapshot,
  delta: ConversationDelta,
): ConversationSnapshot {
  switch (delta.op) {
    case "row.appended":
      return {
        ...snapshot,
        rows: {
          ...snapshot.rows,
          window: [...snapshot.rows.window, delta.row],
          totalCount: snapshot.rows.totalCount + 1,
          firstRowId: snapshot.rows.firstRowId ?? delta.row.rowId,
        },
      };
    case "row.upserted": {
      const index = snapshot.rows.window.findIndex(
        (row) => row.rowId === delta.row.rowId,
      );
      if (index === -1) return snapshot;
      const window = [...snapshot.rows.window];
      window[index] = delta.row;
      return { ...snapshot, rows: { ...snapshot.rows, window } };
    }
    case "row.removed": {
      const window = snapshot.rows.window.filter(
        (row) => row.rowId < delta.fromRowId,
      );
      const removed = snapshot.rows.window.length - window.length;
      const removesEntireActiveBranch =
        snapshot.rows.firstRowId !== null && delta.fromRowId <= snapshot.rows.firstRowId;
      return {
        ...snapshot,
        rows: {
          ...snapshot.rows,
          window,
          totalCount: removesEntireActiveBranch
            ? 0
            : Math.max(0, snapshot.rows.totalCount - removed),
          firstRowId: removesEntireActiveBranch ? null : snapshot.rows.firstRowId,
        },
      };
    }
    case "row.delta": {
      const index = snapshot.rows.window.findIndex(
        (row) => row.rowId === delta.rowId,
      );
      const target = snapshot.rows.window[index];
      if (index === -1 || target === undefined) return snapshot;
      const window = [...snapshot.rows.window];
      window[index] = appendToRow(target, delta.path, delta.append);
      return { ...snapshot, rows: { ...snapshot.rows, window } };
    }
    case "state.updated":
      return { ...snapshot, ...delta.patch };
    case "pluginUi.resourceUpdated":
    case "pluginUi.resourceListChanged":
    case "pluginUi.instanceClosed":
    case "pluginUi.appToolCall":
      return snapshot;
    case "workflowRun.updated":
      return {
        ...snapshot,
        workflowRuns: applyWorkflowRunUpdated(snapshot.workflowRuns, delta),
      };
    case "workflowRun.removed":
      return {
        ...snapshot,
        workflowRuns: applyWorkflowRunRemoved(snapshot.workflowRuns, delta),
      };
  }
}

export function applyConversationDeltas(
  snapshot: ConversationSnapshot,
  deltas: readonly ConversationDelta[],
): ConversationSnapshot {
  let current = snapshot;
  for (const delta of deltas) {
    current = applyConversationDelta(current, delta);
  }
  return current;
}

export function applyConversationDeltaMutable(
  accumulator: MutableConversationSnapshotAccumulator,
  delta: ConversationDelta,
): void {
  const snapshot = accumulator.snapshot;
  switch (delta.op) {
    case "row.appended":
      accumulator.rowIndexById.set(delta.row.rowId, snapshot.rows.window.length);
      snapshot.rows.window.push(delta.row);
      snapshot.rows.totalCount += 1;
      snapshot.rows.firstRowId ??= delta.row.rowId;
      return;
    case "row.upserted": {
      const index = accumulator.rowIndexById.get(delta.row.rowId);
      if (index === undefined) return;
      snapshot.rows.window[index] = delta.row;
      return;
    }
    case "row.removed": {
      const removesEntireActiveBranch =
        snapshot.rows.firstRowId !== null && delta.fromRowId <= snapshot.rows.firstRowId;
      let writeIndex = 0;
      for (const row of snapshot.rows.window) {
        if (row.rowId >= delta.fromRowId) continue;
        snapshot.rows.window[writeIndex] = row;
        writeIndex += 1;
      }
      const removed = snapshot.rows.window.length - writeIndex;
      snapshot.rows.window.length = writeIndex;
      snapshot.rows.totalCount = removesEntireActiveBranch
        ? 0
        : Math.max(0, snapshot.rows.totalCount - removed);
      snapshot.rows.firstRowId = removesEntireActiveBranch ? null : snapshot.rows.firstRowId;
      accumulator.rowIndexById.clear();
      snapshot.rows.window.forEach((row, index) => accumulator.rowIndexById.set(row.rowId, index));
      return;
    }
    case "row.delta": {
      const index = accumulator.rowIndexById.get(delta.rowId);
      if (index === undefined) return;
      const target = snapshot.rows.window[index];
      if (target === undefined) return;
      snapshot.rows.window[index] = appendToRow(target, delta.path, delta.append);
      return;
    }
    case "state.updated":
      Object.assign(snapshot, delta.patch);
      return;
    case "pluginUi.resourceUpdated":
    case "pluginUi.resourceListChanged":
      return;
    case "workflowRun.updated":
      snapshot.workflowRuns = applyWorkflowRunUpdated(snapshot.workflowRuns, delta);
      return;
    case "workflowRun.removed":
      snapshot.workflowRuns = applyWorkflowRunRemoved(snapshot.workflowRuns, delta);
  }
}

export function applyConversationDeltasMutable(
  accumulator: MutableConversationSnapshotAccumulator,
  deltas: readonly ConversationDelta[],
): void {
  for (const delta of deltas) applyConversationDeltaMutable(accumulator, delta);
}
