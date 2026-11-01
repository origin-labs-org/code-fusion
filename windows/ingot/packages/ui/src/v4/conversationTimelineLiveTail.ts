import type { ConversationTurnRenderUnit } from "@/v4/conversationTurnRenderUnits.js";

export interface ConversationTimelineLiveTailSplit {
  virtualizedUnits: readonly ConversationTurnRenderUnit[];
  liveUnit: ConversationTurnRenderUnit | null;
  liveUnitIndex: number | null;
}

export function splitConversationTimelineLiveTail(
  units: readonly ConversationTurnRenderUnit[],
): ConversationTimelineLiveTailSplit {
  const liveUnitIndex = units.length - 1;
  const liveUnit = units[liveUnitIndex];
  if (!liveUnit?.isRunning) {
    return { virtualizedUnits: units, liveUnit: null, liveUnitIndex: null };
  }
  return {
    virtualizedUnits: units.slice(0, liveUnitIndex),
    liveUnit,
    liveUnitIndex,
  };
}

export interface ConversationLatestTurnSummary {
  
  readonly turnKey: string | null;
  readonly running: boolean;
  
  readonly workDurationMs: number | undefined;
  
  readonly answer: { readonly rowId: number; readonly text: string } | null;
}

export function resolveConversationLatestTurnSummary(
  units: readonly ConversationTurnRenderUnit[],
): ConversationLatestTurnSummary {
  const unit = units.at(-1);
  if (!unit) return { turnKey: null, running: false, workDurationMs: undefined, answer: null };
  const running = unit.isRunning;
  const row = unit.latestAssistantTextRow;
  return {
    turnKey: unit.key,
    running,
    workDurationMs: running ? unit.workSegments?.at(-1)?.workStatus?.durationMs : undefined,
    answer:
      !running && row?.state === "complete" && row.text.trim()
        ? { rowId: row.rowId, text: row.text }
        : null,
  };
}

export function isSameConversationLatestTurnSummary(
  a: ConversationLatestTurnSummary,
  b: ConversationLatestTurnSummary,
): boolean {
  return (
    a.turnKey === b.turnKey &&
    a.running === b.running &&
    a.workDurationMs === b.workDurationMs &&
    a.answer?.rowId === b.answer?.rowId &&
    a.answer?.text === b.answer?.text
  );
}
