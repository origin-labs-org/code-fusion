// ============================================================
// ============================================================
//

import type {
  SessionId,
  SubmitResultRequest,
  SubmitVerdict as ContractsSubmitVerdict,
  WorkflowSubmitPort,
} from "@origin-ai/cf-contracts";
import { WorkflowError, type WorkflowReportSink } from "@origin-ai/cf-dynamic-workflow";
import { defer, rejectWith } from "./workflow-driver-helpers.js";
import type { SessionState } from "./workflow-driver-types.js";

export interface SubmitBridgeHost {
  readonly sessions: ReadonlyMap<string, SessionState>;
  readonly sink: WorkflowReportSink;
}

export function makeSessionSubmitPort(
  host: SubmitBridgeHost,
  sessionId: SessionId,
): WorkflowSubmitPort {
  return {
    respond: (request: SubmitResultRequest): Promise<ContractsSubmitVerdict> => {
      const state = host.sessions.get(sessionId);
      const instance = state?.currentInstance;
      if (state === undefined || instance === undefined) {
        return Promise.resolve(rejectWith("no active ask is awaiting a submitted result"));
      }
      if (!state.currentTyped) {
        return Promise.resolve(
          rejectWith(
            "this ask does not accept submit_result; provide your answer as your final message",
          ),
        );
      }
      state.pendingSubmit?.reject(
        new WorkflowError("DriverError", "This submit was superseded by a newer submit."),
      );
      const deferred = defer<ContractsSubmitVerdict>();
      state.pendingSubmit = deferred;
      host.sink.askSubmitAttempted(instance, request.result);
      return deferred.promise;
    },
  };
}
