

import { rememberArtifactRow } from "./engine-artifacts.js";
import type { EngineState, ReportTally } from "./engine-state.js";
import { readReplayRows, recoverSettleOrder, type ReplaySettleOrder } from "./replay-order.js";
import type { AskScheduler } from "./scheduler.js";

export function restoreFromJournal(
  state: EngineState,
  scheduler: AskScheduler,
): { replaySettleOrder: ReplaySettleOrder; reportTally: ReportTally } {
  const { workRows, artifactRows } = readReplayRows(state.journal, state.runId);
  const replaySettleOrder = recoverSettleOrder(state.journal, state.runId, [
    ...workRows,
    ...artifactRows,
  ]);
  scheduler.seedRecordedAsks(workRows);
  for (const node of artifactRows) {
    if (node.status !== "completed") continue;
    rememberArtifactRow(state, node.artifactId, node.result);
  }
  return {
    replaySettleOrder,
    reportTally: {
      count: state.journal.countNodes(state.runId, "report"),
      bytes: state.journal.sumResultBytes(state.runId, "report"),
    },
  };
}
