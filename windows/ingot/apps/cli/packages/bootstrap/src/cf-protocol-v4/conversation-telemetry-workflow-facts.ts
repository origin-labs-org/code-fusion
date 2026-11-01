// ============================================================
// ============================================================

import type { DynamicWorkflowRunProgressPayload } from "@origin-ai/cf-contracts";
import {
  conversationTelemetryFactSchema,
  type ConversationTelemetryFact,
} from "@origin-ai/cf-shared/cf-protocol-v4";

const ACTOR_CREATED_EVENT_TYPE = "actor-created";
const RUN_SETTLED_EVENT_TYPE = "run-settled";
const RUN_STOPPED_ERROR_MESSAGE = "Workflow run stopped";

type WorkflowRunSettledStatus = "completed" | "errored" | "stopped";
type WorkflowRunStopReason = "user" | "model" | "provider" | "interrupted" | "superseded";

interface WorkflowProgressDerivedFields {
  actorSessionId?: unknown;
  launchInputId?: unknown;
}

export function workflowLifecycleFactFromProgress(
  base: Record<string, unknown>,
  progress: DynamicWorkflowRunProgressPayload,
): ConversationTelemetryFact | null {
  const derived = progress as DynamicWorkflowRunProgressPayload & WorkflowProgressDerivedFields;
  const launchInputId = optionalString(derived.launchInputId);
  if (launchInputId === undefined) return null;
  const toolCallId = optionalString(progress.toolCallId);

  if (progress.eventType === ACTOR_CREATED_EVENT_TYPE) {
    const childSessionId = optionalString(derived.actorSessionId);
    const agentId = actorRefString(progress.payload.actor);
    if (childSessionId === undefined || agentId === undefined) return null;
    return conversationTelemetryFactSchema.parse({
      ...base,
      kind: "workflow.lifecycle",
      phase: "actor-spawned",
      sourceCommandId: launchInputId,
      runId: progress.runId,
      ...(toolCallId === undefined ? {} : { toolCallId }),
      agentId,
      childSessionId,
    });
  }

  if (progress.eventType === RUN_SETTLED_EVENT_TYPE) {
    const status = settledStatus(progress.payload.status);
    if (status === undefined) return null;
    const stopReason =
      status === "stopped" ? settledStopReason(progress.payload.stopReason) : undefined;
    const engineMessage = optionalString(errorRecord(progress.payload.error)?.message);
    const errorMessage =
      status === "completed"
        ? undefined
        : (engineMessage ?? (status === "stopped" ? stoppedMessage(stopReason) : undefined));
    return conversationTelemetryFactSchema.parse({
      ...base,
      kind: "workflow.lifecycle",
      phase: "run-settled",
      sourceCommandId: launchInputId,
      runId: progress.runId,
      ...(toolCallId === undefined ? {} : { toolCallId }),
      status,
      ...(stopReason === undefined ? {} : { stopReason }),
      ...(errorMessage === undefined ? {} : { errorMessage }),
    });
  }

  return null;
}

function actorRefString(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const ref = value as { siteId?: unknown; ordinal?: unknown };
  const siteId = optionalString(ref.siteId);
  if (siteId === undefined || typeof ref.ordinal !== "number" || !Number.isFinite(ref.ordinal)) {
    return undefined;
  }
  return `${siteId}@${ref.ordinal}`;
}

function settledStatus(value: unknown): WorkflowRunSettledStatus | undefined {
  return value === "completed" || value === "errored" || value === "stopped" ? value : undefined;
}

function settledStopReason(value: unknown): WorkflowRunStopReason | undefined {
  return value === "user" ||
    value === "model" ||
    value === "provider" ||
    value === "interrupted" ||
    value === "superseded"
    ? value
    : undefined;
}

function stoppedMessage(reason: WorkflowRunStopReason | undefined): string {
  return reason === undefined
    ? RUN_STOPPED_ERROR_MESSAGE
    : `${RUN_STOPPED_ERROR_MESSAGE} (${reason})`;
}

function errorRecord(value: unknown): { message?: unknown } | undefined {
  return typeof value === "object" && value !== null ? (value as { message?: unknown }) : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
