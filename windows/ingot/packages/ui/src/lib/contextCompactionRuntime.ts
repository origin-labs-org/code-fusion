import type { CfContextCompactionTimelineMeta } from "@origin-ai/cf-shared";

const RUNNING_CONTEXT_COMPACTION_STATUSES = new Set(["started", "retrying"]);

export function isRunningContextCompactionTimeline(
  timeline: CfContextCompactionTimelineMeta,
): boolean {
  return RUNNING_CONTEXT_COMPACTION_STATUSES.has(timeline.status);
}

export function shouldContextCompactionTimelineCompleteTask(
  timeline: CfContextCompactionTimelineMeta,
): boolean {
  if (isRunningContextCompactionTimeline(timeline)) {
    return false;
  }

  if (timeline.phase === "standalone_turn") {
    return true;
  }

  return timeline.trigger === "manual" && timeline.phase === undefined;
}
