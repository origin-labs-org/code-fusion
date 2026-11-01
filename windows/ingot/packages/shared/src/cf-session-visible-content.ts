import type { CfSessionGoal } from "./cf-protocol/index.js";
import { getConversationMessageProjectionPolicy } from "./conversation-message-projection-policy.js";
import {
  type CfMessageWithParts,
  textFromCfMessageParts,
} from "./cf-protocol-legacy-types.js";

const GOAL_CONTINUATION_REMINDER_PREFIX = '<system-reminder source="goal-continuation">';
const GOAL_CONTINUATION_TEXT_MARKER = "Continue working toward the active session goal.";
const GOAL_STATE_TEXT_MARKER = "Current session goal state";
const SUBAGENT_MESSAGE_SOURCE = "subagent_message";

export function isCfGoalContinuationReminderText(text: string): boolean {
  const normalized = text.trimStart();
  if (normalized.startsWith(GOAL_CONTINUATION_REMINDER_PREFIX)) {
    return true;
  }
  return (
    normalized.startsWith("<system-reminder>") && normalized.includes(GOAL_CONTINUATION_TEXT_MARKER)
  );
}

export function isCfGoalContinuationReminderMessage(message: CfMessageWithParts): boolean {
  return (
    message.info.role === "user" &&
    (message.info.source === "goal-continuation" ||
      String(message.info.metadata?.["source"] ?? "") === "goal-continuation" ||
      isCfGoalContinuationReminderText(textFromCfMessageParts(message.parts)))
  );
}

export function isCfGoalStateReminderText(text: string): boolean {
  const normalized = text.trimStart();
  return normalized.startsWith("<system-reminder>") && normalized.includes(GOAL_STATE_TEXT_MARKER);
}

export function isCfGoalModelOnlyReminderMessage(message: CfMessageWithParts): boolean {
  return (
    message.info.role === "user" &&
    (isCfGoalContinuationReminderMessage(message) ||
      isCfGoalStateReminderText(textFromCfMessageParts(message.parts)))
  );
}

export function isCfModelOnlySyntheticUserMessage(message: CfMessageWithParts): boolean {
  if (
    message.info.role === "user" &&
    (String(message.info.source ?? "") === SUBAGENT_MESSAGE_SOURCE ||
      String(message.info.metadata?.["source"] ?? "") === SUBAGENT_MESSAGE_SOURCE ||
      message.parts.some(
        (part) =>
          part.type === "text" &&
          String(part.metadata?.["source"] ?? "") === SUBAGENT_MESSAGE_SOURCE,
      ))
  ) {
    return true;
  }
  const policy = getConversationMessageProjectionPolicy(message);
  return policy === "providerContextOnly" || policy === "hiddenSynthetic";
}

export function isCfCompactSummaryMessage(message: CfMessageWithParts): boolean {
  return (
    message.info.role === "user" &&
    message.parts.some((part) => {
      if (part.type !== "compaction") {
        return false;
      }
      const timelineStatus = part.metadata?.["timelineStatus"];
      return typeof timelineStatus !== "string";
    })
  );
}

export function getCfUserVisibleMessages(
  messages: readonly CfMessageWithParts[],
  _options: { target?: CfSessionGoal | null } = {},
): CfMessageWithParts[] {
  const visibleMessages: CfMessageWithParts[] = [];
  for (const message of messages) {
    if (isCfModelOnlySyntheticUserMessage(message) || isCfCompactSummaryMessage(message)) {
      continue;
    }
    visibleMessages.push(message);
  }
  return visibleMessages;
}

export function getCfGoalIterationByAssistantMessageId(
  messages: readonly CfMessageWithParts[],
  options: { maxGoalIteration?: number; target?: CfSessionGoal | null } = {},
): Map<string, number> {
  const target = options.target ?? null;
  if (!target) {
    return new Map();
  }

  const iterationByAssistantId = new Map<string, number>();
  const sortedMessages = [...messages].sort(compareCfMessagesByCreatedTime);
  const inactiveAt = target.status === "active" ? null : target.updatedAt;
  let currentIteration = 0;
  let pendingVisibleGoalUserIteration = false;

  for (const message of sortedMessages) {
    if (message.info.role === "user") {
      if (isCfGoalContinuationReminderMessage(message)) {
        currentIteration += 1;
        pendingVisibleGoalUserIteration = false;
        continue;
      }
      if (isVisibleRealGoalUserMessage(message, target)) {
        pendingVisibleGoalUserIteration = true;
      }
      continue;
    }

    if (message.info.role !== "assistant") {
      continue;
    }
    if (inactiveAt !== null && message.info.time.created > inactiveAt) {
      continue;
    }
    if (pendingVisibleGoalUserIteration) {
      currentIteration += 1;
      pendingVisibleGoalUserIteration = false;
    }
    if (currentIteration === 0 && message.info.time.created >= target.createdAt) {
      currentIteration = 1;
    }
    if (currentIteration > 0) {
      const boundedIteration =
        options.maxGoalIteration && options.maxGoalIteration > 0
          ? Math.min(currentIteration, options.maxGoalIteration)
          : currentIteration;
      iterationByAssistantId.set(message.info.messageId, boundedIteration);
    }
  }

  return iterationByAssistantId;
}

export interface CfGoalIterationCountTimelineItem {
  goalIteration?: number;
  status: "started" | "completed" | "failed_closed" | "cancelled";
  verification?: { passed?: boolean | null } | null;
}

export function getCfGoalActiveIterationCount(input: {
  targetStatus?: string | null;
  timeline?: readonly CfGoalIterationCountTimelineItem[] | null;
}): number {
  if (!input.targetStatus) {
    return 0;
  }
  const timeline = input.timeline ?? [];
  if (timeline.length === 0) {
    return 1;
  }
  const latest = timeline[timeline.length - 1];
  if (!latest) {
    return 1;
  }
  const latestIteration = latest.goalIteration ?? timeline.length;
  if (latest.status === "started") {
    return latestIteration;
  }
  if (
    (latest.status === "completed" && latest.verification?.passed === true) ||
    input.targetStatus === "complete"
  ) {
    return latestIteration;
  }
  if (input.targetStatus !== "active") {
    return latestIteration;
  }
  return latestIteration + 1;
}

function compareCfMessagesByCreatedTime(
  left: CfMessageWithParts,
  right: CfMessageWithParts,
) {
  const diff = left.info.time.created - right.info.time.created;
  if (diff !== 0) {
    return diff;
  }
  return left.info.messageId.localeCompare(right.info.messageId);
}

function isVisibleRealGoalUserMessage(message: CfMessageWithParts, target: CfSessionGoal) {
  if (
    message.info.role !== "user" ||
    getConversationMessageProjectionPolicy(message) !== "realUserInput"
  ) {
    return false;
  }

  const createdAt = message.info.time.created;
  const nearGoalStart = createdAt >= target.createdAt - 30_000;
  if (!nearGoalStart) {
    return false;
  }

  return true;
}

export function resolveCfVisibleSessionTitle(input: {
  title?: string;
  messages: readonly CfMessageWithParts[];
  target?: CfSessionGoal | null;
  fallback?: string;
}): string {
  const normalizedTitle = input.title?.trim() ?? "";
  if (
    normalizedTitle &&
    !isCfGoalContinuationReminderText(normalizedTitle) &&
    !isCfGoalStateReminderText(normalizedTitle)
  ) {
    return normalizedTitle;
  }

  const firstUser = input.messages.find(
    (message) =>
      message.info.role === "user" &&
      getConversationMessageProjectionPolicy(message) === "realUserInput" &&
      !isCfGoalModelOnlyReminderMessage(message),
  );
  const firstUserText = textFromCfMessageParts(firstUser?.parts ?? []).trim();
  if (firstUserText) {
    return firstUserText.slice(0, 80);
  }

  const objective = input.target?.objective.trim() ?? "";
  if (objective) {
    return objective.slice(0, 80);
  }

  return input.fallback ?? "New session";
}
