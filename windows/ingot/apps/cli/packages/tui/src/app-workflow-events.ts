//
import type { DynamicWorkflowRunProgressPayload } from "@origin-ai/cf-contracts";
import type { WorkflowRunProgressEnvelope } from "@origin-ai/cf-shared/cf-protocol-v4";
import { applyWorkflowProgressToMirror, type TuiWorkflowMirror } from "./app-workflow-mirror.js";

export type WorkflowMirrorSetter = (
  updater: (current: TuiWorkflowMirror) => TuiWorkflowMirror,
) => void;

export function applyWorkflowProgressEvent(
  payload: unknown,
  setWorkflowMirror?: WorkflowMirrorSetter,
): void {
  if (!setWorkflowMirror) return;
  const envelope: WorkflowRunProgressEnvelope = payload as DynamicWorkflowRunProgressPayload;
  setWorkflowMirror((current) => applyWorkflowProgressToMirror(current, envelope));
}
