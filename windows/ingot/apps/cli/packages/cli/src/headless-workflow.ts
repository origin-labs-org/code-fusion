import {
  AMEND_WORKFLOW_TOOL_NAME,
  CREATE_WORKFLOW_TOOL_NAME,
  SessionEventType,
  type DynamicWorkflowRunProgressPayload,
  type SessionEvent,
} from "@origin-ai/cf-contracts";
import { createDenyPermissionBroker } from "@origin-ai/cf-core";
import type { GlobalOptions } from "@origin-ai/cf-shared-types";
import type { CfAppOptions } from "@origin-ai/cf-bootstrap";
import { readRuntimeFunction } from "./runtime-event-subscriber.js";

export const createHeadlessPermissionBroker = (): NonNullable<
  CfAppOptions["permissionBroker"]
> => {
  const denyBroker = createDenyPermissionBroker();
  return {
    requestPermission: async (request, options) => {
      if (
        request.toolName !== CREATE_WORKFLOW_TOOL_NAME &&
        request.toolName !== AMEND_WORKFLOW_TOOL_NAME
      ) {
        return await denyBroker.requestPermission(request, options);
      }
      return {
        decision: "allow",
        reason: `Headless CLI auto-approves ${request.toolName}: no interactive gate exists in -p mode.`,
        resolvedAt: new Date(),
      };
    },
  };
};

export const WORKFLOW_RUN_PROGRESS_STREAM_TYPE = "workflow.run.progress";

interface WorkflowRunProgressStreamLine {
  type: typeof WORKFLOW_RUN_PROGRESS_STREAM_TYPE;
  eventId: string;
  sessionId: string;
  seq: number;
  timestamp: number;
  traceId: string;
  payload: DynamicWorkflowRunProgressPayload;
}

export const isDynamicWorkflowRunProgressEvent = (event: SessionEvent): boolean =>
  event.type === SessionEventType.DynamicWorkflowRunProgress;

const progressPayloadOf = (event: SessionEvent): DynamicWorkflowRunProgressPayload =>
  event.payload as DynamicWorkflowRunProgressPayload;

export const mapWorkflowRunProgressStreamLine = (
  event: SessionEvent,
): WorkflowRunProgressStreamLine => ({
  type: WORKFLOW_RUN_PROGRESS_STREAM_TYPE,
  eventId: String(event.id),
  sessionId: String(event.sessionId),
  seq: event.sequenceNumber,
  timestamp: event.timestamp.getTime(),
  traceId: String(event.traceId),
  payload: progressPayloadOf(event),
});

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const instanceLabel = (payload: Record<string, unknown>): string | undefined => {
  const instance = asRecord(payload.instance);
  const siteId = instance.siteId;
  if (typeof siteId !== "string") return undefined;
  const ordinal = instance.ordinal;
  return typeof ordinal === "number" ? `${siteId}@${ordinal}` : siteId;
};

const describeProgress = (payload: DynamicWorkflowRunProgressPayload): string | undefined => {
  const inner = asRecord(payload.payload);
  switch (payload.eventType) {
    case "run-started":
      return "started";
    case "run-settled": {
      const rawStatus = typeof inner.status === "string" ? inner.status : "settled";
      const status =
        typeof inner.stopReason === "string" ? `${rawStatus}/${inner.stopReason}` : rawStatus;
      const error = asRecord(inner.error).message;
      return typeof error === "string" ? `${status}: ${error}` : status;
    }
    case "log":
      return typeof inner.message === "string" ? `log: ${inner.message}` : undefined;
    case "node-queued":
    case "node-dispatched":
    case "node-repairing":
    case "node-nudged": {
      const label = instanceLabel(inner);
      return label ? `${payload.eventType.slice("node-".length)} ${label}` : undefined;
    }
    case "node-settled": {
      const label = instanceLabel(inner);
      const outcome = typeof inner.outcome === "string" ? inner.outcome : "settled";
      return label ? `settled ${label} (${outcome})` : undefined;
    }
    default:
      return undefined;
  }
};

const isUnthrottledProgress = (eventType: string): boolean =>
  eventType === "run-started" || eventType === "run-settled" || eventType === "log";

interface WorkflowProgressReporterInput {
  
  write: (line: string) => void;
  
  now?: () => number;
  
  throttleMs?: number;
}

const DEFAULT_WORKFLOW_PROGRESS_THROTTLE_MS = 400;

export const createWorkflowProgressReporter = (
  input: WorkflowProgressReporterInput,
): ((event: SessionEvent) => void) => {
  const now = input.now ?? Date.now;
  const throttleMs = input.throttleMs ?? DEFAULT_WORKFLOW_PROGRESS_THROTTLE_MS;
  let lastThrottledAt: number | undefined;
  return (event) => {
    if (!isDynamicWorkflowRunProgressEvent(event)) return;
    const payload = progressPayloadOf(event);
    const description = describeProgress(payload);
    if (description === undefined) return;
    if (!isUnthrottledProgress(payload.eventType)) {
      const at = now();
      if (lastThrottledAt !== undefined && at - lastThrottledAt < throttleMs) return;
      lastThrottledAt = at;
    }
    input.write(`workflow ${payload.runId}: ${description}\n`);
  };
};

interface HeadlessWriteStream {
  write: (chunk: string) => unknown;
}

interface HeadlessSessionObserverInput {
  options: Pick<GlobalOptions, "json" | "outputFormat">;
  stderr: HeadlessWriteStream;
  stdout: HeadlessWriteStream;
  
  mapSessionEvent?: (event: SessionEvent) => unknown;
}

interface HeadlessSessionObserver {
  
  observe: (event: SessionEvent) => void;
  
  hasWorkflowActivity: () => boolean;
  
  beginWaitPhase: (excludeTurnId?: string) => void;
  
  waitPhaseTurnResponses: () => readonly string[];
}

export const createHeadlessSessionObserver = (
  input: HeadlessSessionObserverInput,
): HeadlessSessionObserver => {
  const { mapSessionEvent, options, stderr, stdout } = input;
  const writeStreamEvent = mapSessionEvent
    ? (event: SessionEvent) => {
        // One event per line, written as it happens. Deliberately not formatJson:
        // that pretty-prints with an indent, which would spread a single event
        // over several lines and break every line-oriented reader downstream.
        //
        const line = isDynamicWorkflowRunProgressEvent(event)
          ? mapWorkflowRunProgressStreamLine(event)
          : mapSessionEvent(event);
        stdout.write(`${JSON.stringify(line)}\n`);
      }
    : undefined;
  const reportProgress =
    mapSessionEvent === undefined && wantsWorkflowProgress(options)
      ? createWorkflowProgressReporter({ write: (line) => void stderr.write(line) })
      : undefined;

  let workflowActivity = false;
  let waiting = false;
  let excludedTurnId: string | undefined;
  const turnResponses: string[] = [];

  return {
    hasWorkflowActivity: () => workflowActivity,
    beginWaitPhase: (excludeTurnId) => {
      waiting = true;
      excludedTurnId = excludeTurnId;
    },
    waitPhaseTurnResponses: () => turnResponses,
    observe: (event) => {
      writeStreamEvent?.(event);
      reportProgress?.(event);
      if (isWorkflowActivityEvent(event)) workflowActivity = true;
      if (!waiting || event.type !== SessionEventType.TurnComplete) return;
      if (event.turnId !== undefined && String(event.turnId) === excludedTurnId) return;
      const response = (event.payload as { response?: unknown }).response;
      if (typeof response === "string" && response.trim().length > 0) turnResponses.push(response);
    },
  };
};

const isWorkflowActivityEvent = (event: SessionEvent): boolean => {
  if (isDynamicWorkflowRunProgressEvent(event)) return true;
  return (
    event.type === SessionEventType.BackgroundTaskStarted &&
    (event.payload as { taskKind?: unknown }).taskKind === "workflow"
  );
};

interface HeadlessWorkflowRuntimeFacts {
  hasActiveOrQueuedTurnWork: () => boolean;
  hasRunningBackgroundTasks: () => boolean;
}

const HEADLESS_WORKFLOW_POLL_INTERVAL_MS = 100;

export const waitForHeadlessWorkflowSettle = async (input: {
  intervalMs?: number;
  runtime: HeadlessWorkflowRuntimeFacts;
  signal: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
}): Promise<void> => {
  const intervalMs = input.intervalMs ?? HEADLESS_WORKFLOW_POLL_INTERVAL_MS;
  const sleep =
    input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  while (!input.signal.aborted) {
    if (!input.runtime.hasRunningBackgroundTasks() && !input.runtime.hasActiveOrQueuedTurnWork()) {
      return;
    }
    await sleep(intervalMs);
  }
};

export const readHeadlessRuntimeFacts = (
  runtime: unknown,
): HeadlessWorkflowRuntimeFacts | undefined => {
  const turnWork = readRuntimeFunction(runtime, "hasActiveOrQueuedTurnWork");
  const backgroundTasks = readRuntimeFunction(runtime, "hasRunningBackgroundTasks");
  if (!turnWork || !backgroundTasks) return undefined;
  return {
    hasActiveOrQueuedTurnWork: () => turnWork.call(runtime) === true,
    hasRunningBackgroundTasks: () => backgroundTasks.call(runtime) === true,
  };
};

const wantsWorkflowProgress = (options: Pick<GlobalOptions, "json" | "outputFormat">): boolean =>
  options.outputFormat === undefined ? !options.json : options.outputFormat === "text";
