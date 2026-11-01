

import type { EngineState } from "./engine-state.js";
import type { RunSettlementRecord, RunStatus, RunStopReason } from "./types.js";
import { WorkflowError } from "./types.js";

export function settleCompleted(state: EngineState, artifact: unknown): void {
  if (state.isRunSettled()) return;
  state.markSettled();
  state.abortInFlight(
    new WorkflowError("Cancelled", "Run completed; in-flight subagent tasks were abandoned."),
    true,
  );
  finishRun(state, "completed", { result: artifact });
  state.resolveSettled({ status: "completed", artifact });
}

export function settleStopped(
  state: EngineState,
  reason: RunStopReason,
  error?: WorkflowError,
  supersededBy?: string,
): void {
  if (state.isRunSettled()) return;
  state.markSettled();
  state.abortInFlight(new WorkflowError("Cancelled", "Run stopped."), true);
  finishRun(state, "stopped", {
    stopReason: reason,
    ...(supersededBy === undefined ? {} : { supersededBy }),
    ...(error === undefined ? {} : { failure: error.toJSON() }),
  });
  state.resolveSettled({
    status: "stopped",
    reason,
    ...(supersededBy === undefined ? {} : { supersededBy }),
    ...(error === undefined ? {} : { error }),
  });
}

export function settleFailed(state: EngineState, error: WorkflowError): void {
  if (state.isRunSettled()) return;
  state.markSettled(error);
  state.abortInFlight(error, false);
  finishRun(state, "errored", { failure: error.toJSON() });
  state.resolveSettled({ status: "errored", error });
}

function finishRun(state: EngineState, status: RunStatus, settlement?: RunSettlementRecord): void {
  state.journal.updateRunStatus(state.runId, status, settlement);
  state.record({
    type: "run-settled",
    status,
    ...(settlement?.stopReason === undefined ? {} : { stopReason: settlement.stopReason }),
    ...(settlement?.supersededBy === undefined ? {} : { supersededBy: settlement.supersededBy }),
    ...(settlement?.failure === undefined ? {} : { error: settlement.failure }),
  });
  state.driver.dispose?.();
}
