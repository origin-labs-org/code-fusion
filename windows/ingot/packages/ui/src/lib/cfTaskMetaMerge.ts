import type { CfTaskMeta } from "@origin-ai/cf-shared";

function hasOwnTaskMetaField<T extends keyof CfTaskMeta>(task: CfTaskMeta, key: T) {
  return Object.prototype.hasOwnProperty.call(task, key);
}

function isPlaceholderTaskTitle(title: string): boolean {
  const normalizedTitle = title.trim().toLocaleLowerCase();
  return normalizedTitle.length === 0 || normalizedTitle === "new session";
}

function resolveMergedTaskTitle(preferredTask: CfTaskMeta, fallbackTask: CfTaskMeta): string {
  if (fallbackTask.titleOverridden && !preferredTask.titleOverridden) {
    return fallbackTask.title;
  }
  if (isPlaceholderTaskTitle(preferredTask.title) && !isPlaceholderTaskTitle(fallbackTask.title)) {
    return fallbackTask.title;
  }
  return preferredTask.title;
}

export function mergeTaskWithOptimisticMeta(
  task: CfTaskMeta,
  optimisticTask: CfTaskMeta,
): CfTaskMeta {
  const shouldKeepOptimisticTask =
    optimisticTask.updatedAt > task.updatedAt ||
    (optimisticTask.updatedAt === task.updatedAt &&
      optimisticTask.title.length > task.title.length);
  const preferredTask = shouldKeepOptimisticTask ? optimisticTask : task;
  const fallbackTask = shouldKeepOptimisticTask ? task : optimisticTask;

  const unreadAt = hasOwnTaskMetaField(optimisticTask, "unreadAt")
    ? optimisticTask.unreadAt
    : (preferredTask.unreadAt ?? fallbackTask.unreadAt);

  return {
    ...preferredTask,
    changeSummary: preferredTask.changeSummary ?? fallbackTask.changeSummary,
    model: preferredTask.model ?? fallbackTask.model,
    provider: preferredTask.provider ?? fallbackTask.provider,
    title: resolveMergedTaskTitle(preferredTask, fallbackTask),
    titleOverridden:
      preferredTask.titleOverridden === true || fallbackTask.titleOverridden === true
        ? true
        : (preferredTask.titleOverridden ?? fallbackTask.titleOverridden),
    status: preferredTask.status ?? fallbackTask.status,
    unreadAt,
  };
}

export function mergeTaskMetaCandidates(
  ...candidates: Array<CfTaskMeta | null | undefined>
): CfTaskMeta | undefined {
  let merged: CfTaskMeta | undefined;
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    merged = merged ? mergeTaskWithOptimisticMeta(candidate, merged) : candidate;
  }
  return merged;
}
