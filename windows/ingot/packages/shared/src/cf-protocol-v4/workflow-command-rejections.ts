import { z } from "zod";

export const savedWorkflowStartRejectionReasonSchema = z.enum([
  "invalid_name",
  "not_found",
  "invalid_args",
  "compile_failed",
  "session_busy",
  "start_failed",
]);
export type SavedWorkflowStartRejectionReason = z.infer<
  typeof savedWorkflowStartRejectionReasonSchema
>;

export const SAVED_WORKFLOW_START_REJECTED_FAULT_PREFIX =
  "fault.command.savedWorkflowStartRejected." as const;

export const WORKFLOW_RUN_RESUME_REJECTED_FAULT_PREFIX =
  "fault.command.workflowRunResumeRejected." as const;
