import type { AgentRuntimeInternal } from "../internal.js";
import { getOffPeakExecution } from "../off-peak/runtime.js";

export function trackResidencyBlockingWork<T>(
  this: AgentRuntimeInternal,
  work: Promise<T>,
): Promise<T> {
  this.residencyBlockingWorkCount += 1;
  return work.finally(() => {
    this.residencyBlockingWorkCount = Math.max(0, this.residencyBlockingWorkCount - 1);
  });
}

export function hasResidencyBlockingWork(this: AgentRuntimeInternal): boolean {
  return (
    getOffPeakExecution(this)?.lifecycle.terminal === false ||
    this.hasActiveOrQueuedTurnWork() ||
    this.hasRunningBackgroundTasks() ||
    this.residencyBlockingWorkCount > 0 ||
    (this.memoryExtractionScheduler?.hasPendingWork() ?? false) ||
    (this.memoryRecallPrefetch !== undefined && !this.memoryRecallPrefetch.settled)
  );
}
