import {
  SessionEventType,
  type DynamicWorkflowRunProgressPayload,
  type TraceContext,
} from "../deps.js";
import {
  formatWorkflowEscalationNotification,
  formatWorkflowStallNotification,
} from "../../runtime-task/notification.js";
import type { AgentRuntimeInternal } from "../internal.js";
import { noteWorkflowReminderRunEvent } from "./dynamic-workflow-blocked-reminder.js";
import { notifyHoleReached } from "./dynamic-workflow-run-hole-notification.js";

export async function recordDynamicWorkflowRunProgress(
  this: AgentRuntimeInternal,
  input: DynamicWorkflowRunProgressPayload & { traceContext?: TraceContext },
): Promise<void> {
  const { traceContext: provided, ...payload } = input;
  const traceContext = provided ?? this.rootTraceContext;
  await this.appendEvent(
    this.createEvent(
      SessionEventType.DynamicWorkflowRunProgress,
      payload satisfies DynamicWorkflowRunProgressPayload,
      traceContext,
    ),
    traceContext,
  );
  noteWorkflowReminderRunEvent(this, payload);
  notifyEscalationRaised.call(this, payload, traceContext);
  notifyRunStalled.call(this, payload, traceContext);
  await notifyHoleReached.call(this, payload, traceContext);
}

const RUN_STALLED_EVENT_TYPE = "run-stalled";

function notifyRunStalled(
  this: AgentRuntimeInternal,
  payload: DynamicWorkflowRunProgressPayload,
  traceContext: TraceContext,
): void {
  if (payload.eventType !== RUN_STALLED_EVENT_TYPE) return;
  const sinceMs = payload.payload.sinceMs;
  if (typeof sinceMs !== "number" || !Number.isFinite(sinceMs) || sinceMs < 0) {
    this.logger?.warn?.("Dynamic workflow stall notification skipped: malformed payload", {
      event: "dynamic_workflow.stall.notification_skipped",
      module: "core.runtime",
      runId: payload.runId,
      sequence: payload.sequence,
    });
    return;
  }
  const runLabel = this.runtimeTaskRegistry.get(payload.runId)?.description ?? payload.runId;
  const reason = stringField(payload.payload, "reason");
  const capValue = payload.payload.cap;
  const cap =
    typeof capValue === "number" && Number.isFinite(capValue) && capValue >= 0
      ? Math.floor(capValue)
      : undefined;
  this.enqueueBackgroundTaskNotification({
    originMeta: {
      backgroundSource: "workflow",
      title: runLabel,
      workId: payload.runId,
      workflowNotification: {
        kind: "stall",
        sinceMs: Math.floor(sinceMs),
        ...(reason === undefined ? {} : { reason: reason.slice(0, 64) }),
        ...(cap === undefined ? {} : { cap }),
      },
    },
    taskId: payload.runId,
    text: formatWorkflowStallNotification({
      runLabel,
      runId: payload.runId,
      sinceMs,
      ...(reason === undefined ? {} : { reason }),
      ...(cap === undefined ? {} : { cap }),
    }),
    traceContext,
  });
}

const ESCALATION_RAISED_EVENT_TYPE = "escalation-raised";

function notifyEscalationRaised(
  this: AgentRuntimeInternal,
  payload: DynamicWorkflowRunProgressPayload,
  traceContext: TraceContext,
): void {
  if (payload.eventType !== ESCALATION_RAISED_EVENT_TYPE) return;

  const qid = stringField(payload.payload, "qid");
  const question = stringField(payload.payload, "question");
  if (qid === undefined || question === undefined) {
    this.logger?.warn?.("Dynamic workflow escalation notification skipped: malformed payload", {
      event: "dynamic_workflow.escalation.notification_skipped",
      module: "core.runtime",
      runId: payload.runId,
      sequence: payload.sequence,
    });
    return;
  }

  const runLabel = this.runtimeTaskRegistry.get(payload.runId)?.description ?? payload.runId;
  const context = stringField(payload.payload, "context");
  const actor = stringField(payload.payload, "actorName") ?? actorRefLabel(payload.payload);
  const askedAt = payload.payload.askedAt;

  this.enqueueBackgroundTaskNotification({
    originMeta: {
      backgroundSource: "workflow",
      title: runLabel,
      workId: payload.runId,
      workflowNotification: {
        kind: "escalation",
        qid,
        actor,
        question: question.slice(0, WORKFLOW_ESCALATION_TEXT_MAX_CHARS),
        ...(context === undefined
          ? {}
          : { context: context.slice(0, WORKFLOW_ESCALATION_TEXT_MAX_CHARS) }),
        ...(typeof askedAt === "number" && Number.isFinite(askedAt) ? { askedAt } : {}),
      },
    },
    taskId: payload.runId,
    text: formatWorkflowEscalationNotification({
      runLabel,
      runId: payload.runId,
      qid,
      actor,
      question,
      ...(context === undefined ? {} : { context }),
    }),
    traceContext,
  });
}

const WORKFLOW_ESCALATION_TEXT_MAX_CHARS = 4_000;

function actorRefLabel(payload: Record<string, unknown>): string {
  const actor = payload.actor;
  if (typeof actor === "string") return actor;
  if (typeof actor !== "object" || actor === null) return "unknown actor";
  const siteId = stringField(actor as Record<string, unknown>, "siteId");
  const ordinal = (actor as Record<string, unknown>).ordinal;
  if (siteId === undefined || typeof ordinal !== "number") return "unknown actor";
  return `${siteId}@${ordinal}`;
}

function stringField(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
