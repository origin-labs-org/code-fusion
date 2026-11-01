import {
  buildConversationTurnNavigatorItems,
  type BuildConversationTurnNavigatorItemsOptions,
  type ConversationTurnNavigatorItem,
} from "@/v4/conversationTurnNavigatorHelpers.js";
import type { ConversationTurnRenderUnit } from "@/v4/conversationTurnRenderUnits.js";

export function buildConversationShareItems(
  units: readonly ConversationTurnRenderUnit[],
  options: BuildConversationTurnNavigatorItemsOptions,
): ConversationTurnNavigatorItem[] {
  const queries = buildConversationTurnNavigatorItems(units, options);
  return units.flatMap((unit, unitIndex) => {
    const existing = queries.filter((item) => item.unitIndex === unitIndex);
    if (existing.length) return existing;
    if (
      !unit.header ||
      unit.timelineOnly ||
      (!unit.assistantTextRows.length &&
        !unit.workflowLaunch &&
        !unit.header.originMeta?.workflowNotification)
    )
      return [];
    return [
      {
        key: `${unit.key}:share`,
        turnId: unit.turnId,
        unitIndex,
        rowId: unit.header.rowId,
        userPreview:
          unit.header.originMeta?.title ?? unit.workflowLaunch?.name ?? options.userFallbackPreview,
        assistantPreview:
          unit.assistantTextRows
            .map((row) => row.text)
            .join("\n")
            .slice(0, 320) || options.assistantEmptyPreview,
        assistantPreviewKind: "text" as const,
        isRunning: unit.isRunning,
      },
    ];
  });
}
