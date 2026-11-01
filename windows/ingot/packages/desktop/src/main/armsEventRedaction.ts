import { redactTelemetryText, redactTelemetryUrl } from "@origin-ai/cf-shared";

const EXCEPTION_MESSAGE_MAX_LENGTH = 2_000;

const EXCEPTION_STACK_MAX_LENGTH = 4_000;

const CLICK_NAME_PATTERN = /^(click on [a-z0-9-]+)(?::[\s\S]*)?$/iu;

const CLICK_NAME_FALLBACK = "click";

function isClickEvent(event: Record<string, unknown>): boolean {
  return event.event_type === "click" || event.type === "click";
}

function isExceptionEvent(event: Record<string, unknown>): boolean {
  return event.event_type === "exception";
}

function isNativeDumpEvent(event: Record<string, unknown>): boolean {
  return event.type === "crash" && event.source === "crashReporter";
}

function isResourceEvent(event: Record<string, unknown>): boolean {
  const eventType = String(event.event_type ?? "").toLowerCase();
  return eventType === "api" || eventType === "resource" || eventType.includes("resource");
}

function redactTextField(event: Record<string, unknown>, key: string, maxLength: number): void {
  const value = event[key];
  if (typeof value !== "string" || !value) {
    return;
  }
  event[key] = redactTelemetryText(value, { maxLength });
}

function redactUrlField(event: Record<string, unknown>, key: string): void {
  const value = event[key];
  if (typeof value !== "string" || !value) {
    return;
  }
  event[key] = redactTelemetryUrl(value);
}

function redactClickEvent(event: Record<string, unknown>): void {
  const name = event.name;
  event.name =
    typeof name === "string"
      ? (CLICK_NAME_PATTERN.exec(name)?.[1] ?? CLICK_NAME_FALLBACK)
      : CLICK_NAME_FALLBACK;
  delete event.snapshots;
}

function redactExceptionEvent(event: Record<string, unknown>): void {
  if (isNativeDumpEvent(event)) {
    return;
  }
  redactTextField(event, "message", EXCEPTION_MESSAGE_MAX_LENGTH);
  redactTextField(event, "stack", EXCEPTION_STACK_MAX_LENGTH);
  redactTextField(event, "file", EXCEPTION_MESSAGE_MAX_LENGTH);
  redactTextField(event, "snapshots", EXCEPTION_STACK_MAX_LENGTH);
}

function redactResourceEvent(event: Record<string, unknown>): void {
  redactUrlField(event, "url");
  redactUrlField(event, "name");
  redactTextField(event, "message", EXCEPTION_MESSAGE_MAX_LENGTH);
}

export function redactArmsEventBatch(
  events: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  for (const event of events) {
    if (!event || typeof event !== "object") {
      continue;
    }
    if (isClickEvent(event)) {
      redactClickEvent(event);
      continue;
    }
    if (isExceptionEvent(event)) {
      redactExceptionEvent(event);
      continue;
    }
    if (isResourceEvent(event)) {
      redactResourceEvent(event);
    }
  }
  return events;
}
