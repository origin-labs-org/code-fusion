import {
  collectVisibleCfBackgroundTaskControlItems,
  getCfBackgroundTaskControlItemElapsedMs,
  isActiveCfBackgroundTaskControlItem,
  parseCfBackgroundTaskControlItems,
  type CfBackgroundTaskControlItem,
  type CfBackgroundTaskControlStatus,
} from "./background-task-controls.js";

export type CfBackgroundBashJobStatus = CfBackgroundTaskControlStatus;
export type CfBackgroundBashJob = CfBackgroundTaskControlItem & {
  taskKind: "bash";
};

export function parseCfBackgroundBashJobs(value: unknown): CfBackgroundBashJob[] {
  return parseCfBackgroundTaskControlItems(value).filter(isBackgroundBashJob);
}

export function isActiveCfBackgroundBashJob(job: CfBackgroundBashJob): boolean {
  return isActiveCfBackgroundTaskControlItem(job);
}

export function getCfBackgroundBashJobElapsedMs(
  job: CfBackgroundBashJob,
  now = Date.now(),
): number {
  return getCfBackgroundTaskControlItemElapsedMs(job, now);
}

export function collectVisibleCfBackgroundBashJobs(
  jobs: readonly CfBackgroundBashJob[],
  now = Date.now(),
  thresholdMs = 30_000,
): Array<CfBackgroundBashJob & { elapsedMs: number }> {
  return collectVisibleCfBackgroundTaskControlItems(jobs, now, thresholdMs) as Array<
    CfBackgroundBashJob & { elapsedMs: number }
  >;
}

function isBackgroundBashJob(job: CfBackgroundTaskControlItem): job is CfBackgroundBashJob {
  return job.taskKind === "bash";
}
