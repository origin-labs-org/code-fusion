// ============================================================
// ============================================================
//
// workflow-runs-eviction.ts。

import type { WorkflowRunPendingQuestion } from "./workflow-runs.js";

export interface BoundedUpsert<T> {
  list: T[];
  truncated: boolean;
}

export function upsertBoundedByInstance<T extends { siteId: string; ordinal: number }>(
  list: readonly T[],
  entry: T,
  limit: number,
  options: { admitNew?: boolean } = {},
): BoundedUpsert<T> {
  const index = list.findIndex(
    (item) => item.siteId === entry.siteId && item.ordinal === entry.ordinal,
  );
  if (index >= 0) {
    const next = [...list];
    next[index] = entry;
    return { list: next, truncated: false };
  }
  if (options.admitNew === false || list.length >= limit) {
    return { list: [...list], truncated: true };
  }
  return { list: [...list, entry], truncated: false };
}

export function upsertBoundedByQid(
  list: readonly WorkflowRunPendingQuestion[],
  entry: WorkflowRunPendingQuestion,
  limit: number,
): BoundedUpsert<WorkflowRunPendingQuestion> {
  const index = list.findIndex((item) => item.qid === entry.qid);
  if (index >= 0) {
    const next = [...list];
    next[index] = entry;
    return { list: next, truncated: false };
  }
  if (list.length >= limit) return { list: [...list], truncated: true };
  return { list: [...list, entry], truncated: false };
}
