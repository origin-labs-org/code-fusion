import type { CfTaskPersistStatus, CfTaskRuntimeStatus } from "@origin-ai/cf-shared";

interface TaskRestoreTimestampedMessageLike {
  role: "user" | "assistant";
  timestamp: number;
}

interface ResolveTaskRuntimeStatusAfterRestoreOptions {
  persistedStatus?: CfTaskPersistStatus;
  persistedUpdatedAt?: number;
  latestUserMessageTimestamp?: number | null;
  runtimeMainActive?: boolean;
}

interface ShouldShowTaskConfigLoadingOnSwitchParams {
  previousTaskId: string | null;
  nextTaskId: string | null;
}

export function shouldKeepTaskStreamingDuringRestore(
  taskStatus: CfTaskRuntimeStatus,
): boolean {
  return taskStatus === "streaming";
}

export function shouldShowTaskConfigLoadingOnSwitch(
  params: ShouldShowTaskConfigLoadingOnSwitchParams,
): boolean {
  const nextTaskId = params.nextTaskId?.trim() ?? "";
  if (!nextTaskId) {
    return false;
  }

  const previousTaskId = params.previousTaskId?.trim() ?? "";
  return previousTaskId !== nextTaskId;
}

export function getLatestTaskUserMessageTimestamp(
  messages: readonly TaskRestoreTimestampedMessageLike[],
): number | null {
  let latestTimestamp: number | null = null;
  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }
    latestTimestamp =
      latestTimestamp === null ? message.timestamp : Math.max(latestTimestamp, message.timestamp);
  }
  return latestTimestamp;
}

function toTerminalRuntimeStatus(status: CfTaskPersistStatus): CfTaskRuntimeStatus {
  if (status === "running") {
    return "streaming";
  }
  return status === "error" ? "failed" : "completed";
}

export function resolveTaskRuntimeStatusAfterRestore(
  taskStatus: CfTaskRuntimeStatus,
  hasRestoredSession: boolean,
  options?: ResolveTaskRuntimeStatusAfterRestoreOptions,
): CfTaskRuntimeStatus {
  if (!hasRestoredSession) {
    return "notReady";
  }

  const persistedStatus = options?.persistedStatus;
  const persistedUpdatedAt = options?.persistedUpdatedAt;
  const latestUserMessageTimestamp = options?.latestUserMessageTimestamp ?? null;

  if (
    persistedStatus &&
    persistedStatus !== "running" &&
    typeof persistedUpdatedAt === "number" &&
    (
      latestUserMessageTimestamp === null ||
      persistedUpdatedAt >= latestUserMessageTimestamp
    )
  ) {
    return toTerminalRuntimeStatus(persistedStatus);
  }

  if (options?.runtimeMainActive === true) {
    return "streaming";
  }

  return shouldKeepTaskStreamingDuringRestore(taskStatus) ? "streaming" : "ready";
}
