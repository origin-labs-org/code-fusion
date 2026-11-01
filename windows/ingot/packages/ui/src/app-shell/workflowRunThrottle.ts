
import type { WorkflowRunConcurrency, WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import { isWorkflowRunConfigurable } from "@/components/workflow-timeline/workflowRunSettings.js";
import type { WorkflowRunEventItem, WorkflowRunEventLine } from "./workflowRunPanel.js";

const MS_PER_SECOND = 1_000;
const I18N_PREFIX = "chat.toolCall.workflow.run.";
const EVENT_KEY_PREFIX = `${I18N_PREFIX}event.`;

type FormatMessage = (descriptor: { id: string }, values?: Record<string, string>) => string;

const REASON_LABEL_KEY: Readonly<Record<string, string>> = {
  rate_limited: "throttle.reason.rateLimited",
  provider_overloaded: "throttle.reason.overloaded",
  offpeak_queued: "throttle.reason.offpeak",
  server_error: "throttle.reason.transient",
  network_error: "throttle.reason.transient",
  timeout: "throttle.reason.transient",
  stream_idle_timeout: "throttle.reason.transient",
  stale_connection: "throttle.reason.transient",
  proxy_error: "throttle.reason.transient",
};

export function throttleReasonLabel(reason: string, formatMessage: FormatMessage): string {
  const key = REASON_LABEL_KEY[reason];
  return key === undefined ? reason : formatMessage({ id: `${I18N_PREFIX}${key}` });
}

const concurrencyReceivedAt = new WeakMap<WorkflowRunConcurrency, number>();

function stamp<T extends object>(registry: WeakMap<T, number>, subject: T, now: number): number {
  const seen = registry.get(subject);
  if (seen !== undefined) return seen;
  registry.set(subject, now);
  return now;
}

interface WorkflowRunConcurrencyView {
  
  cap: number;
  ceiling: number;
  
  cooldownUntil?: number;
}

export function workflowRunConcurrencyView(
  concurrency: WorkflowRunConcurrency | undefined,
  now: number,
): WorkflowRunConcurrencyView | undefined {
  if (concurrency === undefined) return undefined;
  const bound = concurrency.limit ?? concurrency.ceiling;
  const effective = Math.min(concurrency.cap, bound);
  if (effective >= bound && bound === concurrency.ceiling) return undefined;
  const view: WorkflowRunConcurrencyView = { cap: effective, ceiling: concurrency.ceiling };
  if (concurrency.cooldownMs !== undefined) {
    const until = stamp(concurrencyReceivedAt, concurrency, now) + concurrency.cooldownMs;
    if (until > now) view.cooldownUntil = until;
  }
  return view;
}

export function workflowRunConcurrencyChip(
  run: WorkflowRunState | undefined,
  now: number,
): WorkflowRunConcurrencyView | undefined {
  if (!isWorkflowRunConfigurable(run)) return undefined;
  return workflowRunConcurrencyView(run?.concurrency, now);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refText(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const { siteId, ordinal } = value;
  if (typeof siteId !== "string" || siteId.length === 0) return undefined;
  return typeof ordinal === "number" ? `${siteId}@${ordinal}` : siteId;
}

function capsMaxConcurrency(value: unknown): string {
  if (!isRecord(value)) return "?";
  return typeof value.maxConcurrency === "number" ? String(value.maxConcurrency) : "?";
}

export function workflowRunConcurrencyEventLine(
  event: WorkflowRunEventItem,
  formatMessage: FormatMessage,
): WorkflowRunEventLine | undefined {
  const { payload } = event;
  const base = {
    sequence: event.sequence,
    type: event.type,
    ...(event.truncated ? { truncated: event.truncated as true } : {}),
    tone: "default" as const,
  };
  const withDetail = (label: string, detail: string | undefined): WorkflowRunEventLine => ({
    ...base,
    label,
    ...(detail === undefined ? {} : { detail }),
  });
  switch (event.type) {
    case "node-waiting": {
      if (payload.cause !== "backoff") {
        return withDetail(
          formatMessage({ id: `${EVENT_KEY_PREFIX}nodeWaitingSlot` }),
          refText(payload.instance),
        );
      }
      const reason =
        typeof payload.reason === "string" ? throttleReasonLabel(payload.reason, formatMessage) : "?";
      const seconds =
        typeof payload.delayMs === "number"
          ? String(Math.ceil(payload.delayMs / MS_PER_SECOND))
          : "?";
      return withDetail(
        formatMessage({ id: `${EVENT_KEY_PREFIX}nodeWaitingBackoff` }, { reason, seconds }),
        refText(payload.instance),
      );
    }
    case "node-executing":
      return withDetail(
        formatMessage({ id: `${EVENT_KEY_PREFIX}nodeExecuting` }),
        refText(payload.instance),
      );
    case "concurrency-changed": {
      const previous = typeof payload.previous === "number" ? String(payload.previous) : "?";
      const next = typeof payload.next === "number" ? String(payload.next) : "?";
      const key = typeof payload.key === "string" && payload.key.length > 0 ? payload.key : undefined;
      return withDetail(
        formatMessage({ id: `${EVENT_KEY_PREFIX}concurrencyChanged` }, { previous, next }),
        key,
      );
    }
    case "run-caps-changed":
      return withDetail(
        formatMessage(
          { id: `${EVENT_KEY_PREFIX}runCapsChanged` },
          {
            previous: capsMaxConcurrency(payload.previous),
            next: capsMaxConcurrency(payload.caps),
          },
        ),
        undefined,
      );
    default:
      return undefined;
  }
}
