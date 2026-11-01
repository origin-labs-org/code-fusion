import type { CfSessionEvent } from "@origin-ai/cf-shared";
import type { CfAgentServiceEvent } from "#src/cf-agent/cfAgent.js";

const DEFAULT_BACKGROUND_SESSION_EVENT_COALESCE_MS = 1_500;
const DEFAULT_BACKGROUND_SESSION_EVENT_MAX_ITEMS = 96;
const SESSION_EVENT_KEY_SEPARATOR = "\u0000";
const COALESCIBLE_MODEL_STREAMING_KINDS = new Set([
  "text_delta",
  "reasoning_delta",
  "tool_input_delta",
]);

type SessionServiceEvent = Extract<CfAgentServiceEvent, { type: "session.event" }>;

interface PendingBackgroundSessionEvent {
  key: string;
  event: SessionServiceEvent;
}

export interface BackgroundSessionEventCoalescer {
  accept(event: CfAgentServiceEvent): void;
  flush(): void;
  dispose(): void;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function getBackgroundSessionEventCoalesceKey(event: CfSessionEvent): string | null {
  const payload = asRecord(event.payload);
  if (event.type === "model.streaming") {
    const kind = stringField(payload, "kind");
    if (!kind || !COALESCIBLE_MODEL_STREAMING_KINDS.has(kind)) {
      return null;
    }
    if (stringField(payload, "delta") === undefined) {
      return null;
    }
    return [
      event.type,
      event.sessionId,
      event.turnId ?? "",
      kind,
      stringField(payload, "inputId") ?? "",
      stringField(payload, "assistantMessageId") ?? "",
      stringField(payload, "toolCallId") ?? "",
      stringField(payload, "parentToolUseId") ?? "",
      stringField(payload, "parentToolCallId") ?? "",
    ].join(SESSION_EVENT_KEY_SEPARATOR);
  }

  if (event.type === "tool.updated" && stringField(payload, "kind") === "progress") {
    return [
      event.type,
      event.sessionId,
      event.turnId ?? "",
      stringField(payload, "inputId") ?? "",
      stringField(payload, "toolCallId") ?? "",
    ].join(SESSION_EVENT_KEY_SEPARATOR);
  }

  if (event.type === "streamRecovery.updated") {
    return [
      event.type,
      event.sessionId,
      event.turnId ?? "",
      stringField(payload, "inputId") ?? "",
      event.traceId ?? "",
    ].join(SESSION_EVENT_KEY_SEPARATOR);
  }

  return null;
}

function mergeBackgroundSessionEvents(
  current: CfSessionEvent,
  next: CfSessionEvent,
): CfSessionEvent {
  if (current.type === "model.streaming" && next.type === "model.streaming") {
    const currentPayload = asRecord(current.payload);
    const nextPayload = asRecord(next.payload);
    const currentDelta = stringField(currentPayload, "delta") ?? "";
    const nextDelta = stringField(nextPayload, "delta") ?? "";
    return {
      ...next,
      payload: {
        ...nextPayload,
        delta: `${currentDelta}${nextDelta}`,
      },
    } as CfSessionEvent;
  }

  return next;
}

export function createBackgroundSessionEventCoalescer(params: {
  emit: (event: CfAgentServiceEvent) => void;
  flushDelayMs?: number;
  maxItems?: number;
}): BackgroundSessionEventCoalescer {
  const flushDelayMs = params.flushDelayMs ?? DEFAULT_BACKGROUND_SESSION_EVENT_COALESCE_MS;
  const maxItems = params.maxItems ?? DEFAULT_BACKGROUND_SESSION_EVENT_MAX_ITEMS;
  let pendingEvents: PendingBackgroundSessionEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function clearFlushTimer(): void {
    if (!flushTimer) {
      return;
    }
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  function flushPending(): void {
    if (pendingEvents.length === 0) {
      clearFlushTimer();
      return;
    }
    const events = pendingEvents.map((item) => item.event);
    pendingEvents = [];
    clearFlushTimer();
    for (const event of events) {
      params.emit(event);
    }
  }

  function scheduleFlush(): void {
    if (disposed || flushTimer || flushDelayMs <= 0) {
      return;
    }
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (!disposed) {
        flushPending();
      }
    }, flushDelayMs);
  }

  function acceptSessionEvent(event: SessionServiceEvent): void {
    const key = getBackgroundSessionEventCoalesceKey(event.event);
    if (!key) {
      flushPending();
      params.emit(event);
      return;
    }

    const existing = pendingEvents.find((item) => item.key === key);
    if (existing) {
      existing.event = {
        type: "session.event",
        event: mergeBackgroundSessionEvents(existing.event.event, event.event),
      };
    } else {
      pendingEvents.push({ key, event });
    }

    if (pendingEvents.length >= maxItems || flushDelayMs <= 0) {
      flushPending();
      return;
    }
    scheduleFlush();
  }

  return {
    accept(event: CfAgentServiceEvent): void {
      if (disposed) {
        return;
      }
      if (event.type !== "session.event") {
        flushPending();
        params.emit(event);
        return;
      }
      acceptSessionEvent(event);
    },

    flush(): void {
      flushPending();
    },

    dispose(): void {
      flushPending();
      disposed = true;
      clearFlushTimer();
    },
  };
}
