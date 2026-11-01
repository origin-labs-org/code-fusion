import type { CfBackgroundTaskControlItem } from "./background-task-controls.js";

export function mergeCfBackgroundTaskControlItems(
  current: readonly CfBackgroundTaskControlItem[],
  updates: readonly CfBackgroundTaskControlItem[],
): CfBackgroundTaskControlItem[] {
  const jobsById = new Map(current.map((job) => [job.jobId, job] as const));
  for (const job of updates) {
    jobsById.set(job.jobId, job);
  }
  return Array.from(jobsById.values());
}
