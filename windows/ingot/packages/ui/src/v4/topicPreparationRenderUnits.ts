import type { BotTopicPreparation as Preparation } from "@origin-ai/cf-shared";
import type { ConversationRow } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { ConversationTurnRenderUnit } from "@/v4/conversationTurnRenderUnits.js";

export function pendingTopicPreparations(
  items: readonly Preparation[],
  rows: readonly ConversationRow[],
) {
  const acceptedIds = new Set<string>();
  for (const row of rows) {
    if (row.kind !== "userInput" || !row.botGroupSource) continue;
    acceptedIds.add(row.botGroupSource.messageId);
    for (const message of row.botGroupSource.messages ?? []) acceptedIds.add(message.messageId);
  }
  return items.filter((item) => item.status !== "failed" && !acceptedIds.has(item.messageId));
}

export function withTopicPreparationMessages(
  units: ConversationTurnRenderUnit[],
  rows: readonly ConversationRow[],
  items: readonly Preparation[],
): ConversationTurnRenderUnit[] {
  const pending = pendingTopicPreparations(items, rows);
  if (!pending.length) return units;
  const last = units.at(-1);
  if (last) return [...units.slice(0, -1), { ...last, topicPreparations: pending }];
  return [
    {
      key: "topic-preparation",
      turnId: "topic-preparation",
      topicPreparations: pending,
      visibleUserInputs: [],
      assistantWorkRows: [],
      assistantHistoryRows: [],
      assistantFollowingRows: [],
      assistantTailRows: [],
      browserTurnEndRows: [],
      hookInvocations: [],
      assistantTextRows: [],
      leadingBoundaryRows: [],
      flowItems: [],
      renderRows: [],
      isLastTurn: true,
      isRunning: false,
      assistantHistoryDefaultOpen: false,
      timelineOnly: true,
    },
  ];
}
