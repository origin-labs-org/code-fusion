// ============================================================
// ============================================================
//

import { submitResultToolEntry } from "@origin-ai/cf-core";
import {
  GENERIC_SUBMIT_PROFILE,
  canonicalJson,
  refToString,
  WorkflowError,
  type AskMessage,
  type InstanceRef,
  type WorkflowReportSink,
} from "@origin-ai/cf-dynamic-workflow";
import type { AgentRuntimeWorkflowDriverDeps, SessionState } from "./workflow-driver-types.js";

const SUBMIT_PROFILE_MISMATCH_EVENT = "dynamic_workflow.submit_profile.mismatch";

export function ensureSubmitProfileFits(
  deps: AgentRuntimeWorkflowDriverDeps,
  sink: WorkflowReportSink,
  state: SessionState,
  instance: InstanceRef,
  message: AskMessage,
): boolean {
  const profile = state.submitProfile;
  if (profile.kind === "generic") return true;
  if (profile.kind === "mono" && canonicalJson(profile.schema) === canonicalJson(message.schema)) {
    return true;
  }
  if (profile.kind === "untyped") {
    sink.askFailed(
      instance,
      new WorkflowError(
        "DriverError",
        `Typed ask ${refToString(instance)} reached subagent session ${state.sessionId} whose static ` +
          `submit profile is "untyped" (no submit_result registered): the ask→actor analysis missed this ask.`,
      ),
    );
    return false;
  }
  deps.logger?.warn?.(
    "Dynamic workflow submit profile mismatch: falling back to the generic submit_result",
    {
      event: SUBMIT_PROFILE_MISMATCH_EVENT,
      module: "bootstrap.app",
      instance: refToString(instance),
      runId: deps.runId ?? "run",
      sessionId: state.sessionId,
    },
  );
  state.runtime.getToolRegistry().register(submitResultToolEntry, { silentDuplicateWarning: true });
  state.runtime.invalidateToolCache();
  state.submitProfile = GENERIC_SUBMIT_PROFILE;
  return true;
}
