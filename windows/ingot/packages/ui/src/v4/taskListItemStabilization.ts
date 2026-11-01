//
import type { CfTaskMeta } from "@origin-ai/cf-shared";

export function buildTaskListItemIdentityKey(meta: CfTaskMeta): string {
  return `${meta.workspaceIdentity?.trim() || meta.workspacePath}::${meta.taskId}`;
}

export function areStabilizedValuesEquivalent(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => areStabilizedValuesEquivalent(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined);
  const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => areStabilizedValuesEquivalent(leftRecord[key], rightRecord[key]));
}

export function areTaskListItemsEquivalent(left: CfTaskMeta, right: CfTaskMeta): boolean {
  return areStabilizedValuesEquivalent(left, right);
}

export function stabilizeTaskListItems<T extends CfTaskMeta>(previous: T[], next: T[]): T[] {
  if (previous.length === 0) {
    return next.length === 0 ? previous : next;
  }
  const previousByKey = new Map(
    previous.map((meta) => [buildTaskListItemIdentityKey(meta), meta] as const),
  );
  let identical = previous.length === next.length;
  const stabilized = next.map((meta, index) => {
    const previousMeta = previousByKey.get(buildTaskListItemIdentityKey(meta));
    if (previousMeta && areTaskListItemsEquivalent(previousMeta, meta)) {
      if (identical && previous[index] !== previousMeta) {
        identical = false;
      }
      return previousMeta;
    }
    identical = false;
    return meta;
  });
  return identical ? previous : stabilized;
}
