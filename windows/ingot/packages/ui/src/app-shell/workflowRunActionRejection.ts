// ============================================================
// ============================================================

import {
  BACKGROUND_WORK_CANCEL_REJECTED_FAULT_PREFIX,
  WORKFLOW_RUN_RESUME_REJECTED_FAULT_PREFIX,
  type CommandAck,
} from "@origin-ai/cf-shared/cf-protocol-v4";

export type WorkflowRunAction = "cancel" | "resume";

const CAPABILITY_UNSUPPORTED_FAULT = "fault.command.capabilityUnsupported";

const CANCEL_REASONS: ReadonlySet<string> = new Set([
  "not_found",
  "not_running",
  "cancel_not_supported",
]);

const RESUME_REASONS: ReadonlySet<string> = new Set([
  "not_found",
  "not_resumable",
  "superseded",
  "already_running",
  "script_missing",
  "script_mismatch",
  "compile_failed",
]);

export interface WorkflowRunActionRejection {
  action: WorkflowRunAction;
  
  reason: string;
  
  code: string;
  
  message?: string;
}

export function describeWorkflowRunActionRejection(
  action: WorkflowRunAction,
  ack: Pick<CommandAck, "status" | "reasonCode" | "message">,
): WorkflowRunActionRejection | undefined {
  if (ack.status === "accepted" || ack.status === "noop") return undefined;
  const code = ack.reasonCode ?? ack.status;
  const prefix =
    action === "cancel"
      ? BACKGROUND_WORK_CANCEL_REJECTED_FAULT_PREFIX
      : WORKFLOW_RUN_RESUME_REJECTED_FAULT_PREFIX;
  const known = action === "cancel" ? CANCEL_REASONS : RESUME_REASONS;
  let reason = "generic";
  if (ack.reasonCode === CAPABILITY_UNSUPPORTED_FAULT) reason = "unsupported";
  else if (ack.reasonCode?.startsWith(prefix)) {
    const suffix = ack.reasonCode.slice(prefix.length);
    if (known.has(suffix)) reason = suffix;
  }
  return { action, reason, code, ...(ack.message ? { message: ack.message } : {}) };
}

export function workflowRunActionRejectionMessageId(rejection: WorkflowRunActionRejection): string {
  return `chat.toolCall.workflow.run.rejection.${rejection.action}.${rejection.reason}`;
}
