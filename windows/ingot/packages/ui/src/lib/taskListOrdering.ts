import type { CfTaskMeta } from "@origin-ai/cf-shared";
import { isTaskListRowActive } from "@/v4/taskListRowActivity.js";

export type TaskListTimeSortBy = "created" | "updated";

interface TaskListSortableItem {
  taskId: string;
  createdAt: number;
  updatedAt: number;
}

export function compareTaskListItemsByTime(
  left: TaskListSortableItem,
  right: TaskListSortableItem,
  sortBy: TaskListTimeSortBy,
): number {
  if (sortBy === "created") {
    if (right.createdAt !== left.createdAt) {
      return right.createdAt - left.createdAt;
    }
    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }
    return right.taskId.localeCompare(left.taskId);
  }

  if (right.updatedAt !== left.updatedAt) {
    return right.updatedAt - left.updatedAt;
  }
  if (right.createdAt !== left.createdAt) {
    return right.createdAt - left.createdAt;
  }
  return right.taskId.localeCompare(left.taskId);
}

export function compareTaskListItemsWithRunningFirst<T extends TaskListSortableItem>(
  left: T,
  right: T,
  sortBy: TaskListTimeSortBy,
  isRunning: (task: T) => boolean,
): number {
  const leftRunning = isRunning(left);
  const rightRunning = isRunning(right);
  if (leftRunning !== rightRunning) {
    return leftRunning ? -1 : 1;
  }
  if (leftRunning) {
    if (right.createdAt !== left.createdAt) {
      return right.createdAt - left.createdAt;
    }
    return right.taskId.localeCompare(left.taskId);
  }
  return compareTaskListItemsByTime(left, right, sortBy);
}

export function compareCfTaskListItems(
  left: CfTaskMeta,
  right: CfTaskMeta,
  sortBy: TaskListTimeSortBy,
): number {
  return compareTaskListItemsWithRunningFirst(left, right, sortBy, isTaskListRowActive);
}
