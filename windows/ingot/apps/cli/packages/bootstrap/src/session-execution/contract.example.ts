import type { SessionExecutionContract, SessionResidencyFinalizationOwner } from "./contract.js";

export function finalizeSession<T>(
  contract: SessionExecutionContract,
  record: SessionResidencyFinalizationOwner,
  finalize: () => Promise<T>,
) {
  return contract.runWithSessionResidencyFinalization(record, finalize);
}
