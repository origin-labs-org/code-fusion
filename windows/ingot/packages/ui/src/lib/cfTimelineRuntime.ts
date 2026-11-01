import type { CfTimelineMeta } from "@origin-ai/cf-shared";
import type { TaskChatMessage } from "@/lib/taskChatMessageTypes.js";

const RUNNING_CONTEXT_COMPACTION_STATUSES = new Set(["started", "retrying"]);
const RUNNING_GOAL_VERIFICATION_STATUSES = new Set(["started"]);

export function isRunningGoalVerificationTimeline(
  timeline: CfTimelineMeta | undefined,
): boolean {
  return (
    timeline?.type === "goal_verification" &&
    RUNNING_GOAL_VERIFICATION_STATUSES.has(timeline.status) &&
    timeline.verification === undefined
  );
}

export function isRunningCfTimeline(timeline: CfTimelineMeta | undefined): boolean {
  if (!timeline) {
    return false;
  }
  if (timeline.type === "context_compaction") {
    return RUNNING_CONTEXT_COMPACTION_STATUSES.has(timeline.status);
  }
  if (timeline.type === "goal_verification") {
    return isRunningGoalVerificationTimeline(timeline);
  }
  return false;
}

export function hasRunningCfTimeline(messages: readonly TaskChatMessage[]): boolean {
  return messages.some((message) => isRunningCfTimeline(message.syntheticTimeline));
}

export function hasRunningContextCompactionTimeline(
  messages: readonly TaskChatMessage[],
): boolean {
  return messages.some((message) => {
    const timeline = message.syntheticTimeline;
    return (
      timeline?.type === "context_compaction" &&
      RUNNING_CONTEXT_COMPACTION_STATUSES.has(timeline.status)
    );
  });
}

export function hasRunningGoalVerificationTimeline(
  messages: readonly TaskChatMessage[],
): boolean {
  return messages.some((message) =>
    isRunningGoalVerificationTimeline(message.syntheticTimeline),
  );
}

export function hasRunningGoalContinuationMessage(messages: readonly TaskChatMessage[]): boolean {
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      message.streaming === true &&
      !message.syntheticTimeline &&
      !message.uiTimeline &&
      typeof message.streamGroupId === "string" &&
      message.streamGroupId.length > 0,
  );
}

export function hasRunningGoalRuntimeSignal(messages: readonly TaskChatMessage[]): boolean {
  return (
    hasRunningGoalVerificationTimeline(messages) ||
    hasRunningGoalContinuationMessage(messages)
  );
}
