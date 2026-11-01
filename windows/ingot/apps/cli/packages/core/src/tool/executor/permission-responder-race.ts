//
import type { PermissionBrokerResult } from "@origin-ai/cf-contracts";
import { linkAbortSignal } from "./timeout.js";

export interface PermissionResponderRaceInput {
  
  runHooks: (signal: AbortSignal) => Promise<PermissionBrokerResult | undefined>;
  
  requestBroker: (
    signal: AbortSignal,
    claimResponse: () => boolean,
  ) => Promise<PermissionBrokerResult>;
  
  signal?: AbortSignal;
  
  onHookFailure?: (error: unknown) => void;
}

export interface PermissionResponderRaceOutcome {
  result: PermissionBrokerResult;
  source: "hook" | "broker";
}

export async function racePermissionResponders(
  input: PermissionResponderRaceInput,
): Promise<PermissionResponderRaceOutcome> {
  const hookController = new AbortController();
  const brokerController = new AbortController();
  const unlinkHook = linkAbortSignal(input.signal, hookController);
  const unlinkBroker = linkAbortSignal(input.signal, brokerController);

  let settled = false;
  let brokerClaimed = false;
  try {
    return await new Promise<PermissionResponderRaceOutcome>((resolve, reject) => {
      const settle = (action: () => void, abortLoser: AbortController) => {
        if (settled) return;
        settled = true;
        action();
        abortLoser.abort();
      };

      input
        .requestBroker(brokerController.signal, () => {
          if (settled || brokerController.signal.aborted) return false;
          brokerClaimed = true;
          hookController.abort();
          return true;
        })
        .then(
          (result) => settle(() => resolve({ result, source: "broker" }), hookController),
          (error) => {
            settle(() => reject(error), hookController);
          },
        );

      input.runHooks(hookController.signal).then(
        (decision) => {
          if (decision === undefined || brokerClaimed) return;
          settle(() => resolve({ result: decision, source: "hook" }), brokerController);
        },
        (error) => {
          if (settled) return;
          input.onHookFailure?.(error);
        },
      );
    });
  } finally {
    unlinkHook();
    unlinkBroker();
  }
}
