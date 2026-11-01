import type { CfPersistedMessage, CfPersistedMessagePart } from "./cf-task-types-core.js";

//
export function coalesceConsecutiveCfAssistants(
  messages: readonly CfPersistedMessage[],
): CfPersistedMessage[] {
  const merged: CfPersistedMessage[] = [];
  for (const message of messages) {
    const last = merged[merged.length - 1];
    if (
      message.role === "assistant" &&
      last?.role === "assistant" &&
      !last.syntheticTimeline &&
      !message.syntheticTimeline &&
      last.goalIteration === message.goalIteration
    ) {
      merged[merged.length - 1] = mergeAssistantPair(last, message);
      continue;
    }
    merged.push(message);
  }

  let turn = -1;
  return merged.map((message) => {
    if (message.role === "user") {
      turn += 1;
    }
    const effectiveTurn = turn < 0 ? 0 : turn;
    return message.turnIndex === effectiveTurn ? message : { ...message, turnIndex: effectiveTurn };
  });
}

function mergeAssistantPair(
  first: CfPersistedMessage,
  next: CfPersistedMessage,
): CfPersistedMessage {
  const firstTools = first.tools ?? [];
  const nextTools = next.tools ?? [];
  const mergedTools =
    firstTools.length + nextTools.length > 0 ? [...firstTools, ...nextTools] : undefined;

  const toolIndexOffset = firstTools.length;
  const firstParts = first.parts ?? [];
  const shiftedNextParts: CfPersistedMessagePart[] = (next.parts ?? []).map((part) =>
    part.type === "tool-call"
      ? { type: "tool-call", toolIndex: part.toolIndex + toolIndexOffset }
      : part,
  );
  const mergedParts =
    firstParts.length + shiftedNextParts.length > 0
      ? [...firstParts, ...shiftedNextParts]
      : undefined;

  const mergedContent = first.content + next.content;
  const mergedThought =
    first.thought === undefined && next.thought === undefined
      ? undefined
      : (first.thought ?? "") + (next.thought ?? "");

  const durationMs =
    first.durationMs === undefined || next.durationMs === undefined
      ? undefined
      : Math.max(next.timestamp + next.durationMs - first.timestamp, 0);

  const characterCount =
    first.characterCount === undefined && next.characterCount === undefined
      ? undefined
      : mergedContent.length;
  const mergedMessageIds = collectMergedMessageIds(first, next);

  return {
    ...first,
    content: mergedContent,
    timestamp: first.timestamp,
    model: next.model ?? first.model,
    durationMs,
    characterCount,
    interrupted: next.interrupted ?? first.interrupted,
    feedback: next.feedback ?? first.feedback,
    mergedMessageIds: mergedMessageIds.length > 0 ? mergedMessageIds : undefined,
    goalIteration: next.goalIteration ?? first.goalIteration,
    attachments: next.attachments ?? first.attachments,
    tools: mergedTools,
    thought: mergedThought,
    parts: mergedParts,
    checkpointState: next.checkpointState ?? first.checkpointState,
    checkpointReason: next.checkpointReason ?? first.checkpointReason,
    checkpointUpdatedAt: next.checkpointUpdatedAt ?? first.checkpointUpdatedAt,
    bodyRefs: next.bodyRefs ?? first.bodyRefs,
    toolSlice: next.toolSlice ?? first.toolSlice,
  };
}

function collectMergedMessageIds(
  first: CfPersistedMessage,
  next: CfPersistedMessage,
): string[] {
  const ids = [
    first.id,
    ...(first.mergedMessageIds ?? []),
    next.id,
    ...(next.mergedMessageIds ?? []),
  ].filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}
