
import {
  readWorkflowRunStopReason,
  type WorkflowRunStopReason,
} from "@/components/workflow-graph/run-status-presentation.js";
import type { WorkflowRunActor, WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import { workflowRunConcurrencyEventLine } from "@/app-shell/workflowRunThrottle.js";

const UNKNOWN_PAYLOAD_MAX_LENGTH = 200;

export function isWorkflowRunCancellable(run: WorkflowRunState | undefined): boolean {
  return run?.status === "running";
}

export function isWorkflowRunResumable(run: WorkflowRunState | undefined): boolean {
  return run?.resumable === true;
}

type WorkflowRunResultView =
  
  | { kind: "absent" }
  
  | { kind: "none" }
  
  | { kind: "completed"; preview?: string }
  
  | {
      kind: "error";
      status: "errored" | "stopped";
      stopReason?: WorkflowRunStopReason;
      message?: string;
    };

export function workflowRunResultView(run: WorkflowRunState | undefined): WorkflowRunResultView {
  if (!run) return { kind: "absent" };
  if (run.status === "errored" || run.status === "stopped") {
    const stopReason = readWorkflowRunStopReason(run);
    return {
      kind: "error",
      status: run.status,
      ...(stopReason === undefined ? {} : { stopReason }),
      ...(run.error ? { message: run.error } : {}),
    };
  }
  if (run.status === "completed") {
    return { kind: "completed", ...(run.resultPreview ? { preview: run.resultPreview } : {}) };
  }
  return { kind: "none" };
}

export interface WorkflowRunEventItem {
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  truncated?: boolean;
}

export interface WorkflowRunEventLine {
  sequence: number;
  type: string;
  
  label: string;
  
  detail?: string;
  
  tone: "default" | "failed";
  truncated?: boolean;
}

type FormatMessage = (descriptor: { id: string }, values?: Record<string, string>) => string;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refText(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const { siteId, ordinal } = value;
  if (typeof siteId !== "string" || siteId.length === 0) return undefined;
  return typeof ordinal === "number" ? `${siteId}@${ordinal}` : siteId;
}

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function errorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.message === "string" && value.message.length > 0 ? value.message : undefined;
}

function joinDetail(...parts: (string | undefined)[]): string | undefined {
  const kept = parts.filter((part): part is string => part !== undefined && part.length > 0);
  return kept.length > 0 ? kept.join(" · ") : undefined;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function reportItemSummary(item: unknown): string | undefined {
  if (item === undefined) return undefined;
  if (typeof item === "string") {
    return item.length > 0 ? truncate(item, UNKNOWN_PAYLOAD_MAX_LENGTH) : undefined;
  }
  try {
    const serialized = JSON.stringify(item);
    return serialized === undefined ? undefined : truncate(serialized, UNKNOWN_PAYLOAD_MAX_LENGTH);
  } catch {
    return undefined;
  }
}

function unknownDetail(payload: Record<string, unknown>): string | undefined {
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return undefined;
  }
  if (serialized === undefined || serialized === "{}") return undefined;
  return truncate(serialized, UNKNOWN_PAYLOAD_MAX_LENGTH);
}

const EVENT_KEY_PREFIX = "chat.toolCall.workflow.run.event.";

export function workflowRunEventLines(
  events: readonly WorkflowRunEventItem[],
  formatMessage: FormatMessage,
): WorkflowRunEventLine[] {
  return events.map((event) => {
    const { payload } = event;
    const base = {
      sequence: event.sequence,
      type: event.type,
      ...(event.truncated ? { truncated: event.truncated as true } : {}),
    };
    const key = (suffix: string) => ({ id: `${EVENT_KEY_PREFIX}${suffix}` });

    switch (event.type) {
      case "run-started":
        return { ...base, label: formatMessage(key("runStarted")), tone: "default" };

      case "actor-created": {
        const name = typeof payload.name === "string" ? payload.name : undefined;
        return {
          ...base,
          label: formatMessage(key("actorCreated")),
          ...(joinDetail(name, refText(payload.actor)) === undefined
            ? {}
            : { detail: joinDetail(name, refText(payload.actor))! }),
          tone: "default",
        };
      }

      case "node-queued": {
        const kind = typeof payload.kind === "string" ? payload.kind : undefined;
        const detail = joinDetail(refText(payload.instance), kind);
        return {
          ...base,
          label: formatMessage(key("nodeQueued")),
          ...(detail === undefined ? {} : { detail }),
          tone: "default",
        };
      }

      case "node-dispatched":
      case "node-nudged": {
        const detail = refText(payload.instance);
        return {
          ...base,
          label: formatMessage(key(event.type === "node-nudged" ? "nodeNudged" : "nodeDispatched")),
          ...(detail === undefined ? {} : { detail }),
          tone: "default",
        };
      }

      case "node-repairing": {
        const attempt = typeof payload.attempt === "number" ? String(payload.attempt) : "?";
        const detail = refText(payload.instance);
        return {
          ...base,
          label: formatMessage(key("nodeRepairing"), { attempt }),
          ...(detail === undefined ? {} : { detail }),
          tone: "default",
        };
      }

      case "node-settled": {
        const outcome =
          payload.outcome === "ok" ||
          payload.outcome === "failed" ||
          payload.outcome === "cancelled"
            ? payload.outcome
            : undefined;
        const outcomeLabel = outcome
          ? formatMessage({ id: `chat.toolCall.workflow.run.outcome.${outcome}` })
          : "";
        const detail = joinDetail(refText(payload.instance), errorMessage(payload.error));
        return {
          ...base,
          label: formatMessage(key(payload.cached === true ? "nodeSettledCached" : "nodeSettled"), {
            outcome: outcomeLabel,
          }),
          ...(detail === undefined ? {} : { detail }),
          tone: outcome === "failed" || outcome === "cancelled" ? "failed" : "default",
        };
      }

      case "usage-updated": {
        const spentTokens =
          typeof payload.spentTokens === "number" ? payload.spentTokens : undefined;
        return {
          ...base,
          label: formatMessage(key("usageUpdated")),
          ...(spentTokens === undefined
            ? {}
            : { detail: `${spentTokens.toLocaleString()} tokens` }),
          tone: "default",
        };
      }

      case "log": {
        const message = typeof payload.message === "string" ? payload.message : undefined;
        return {
          ...base,
          label: formatMessage(key("log")),
          ...(message === undefined ? {} : { detail: message }),
          tone: "default",
        };
      }

      
      case "import-cache-closed": {
        const actorName = typeof payload.actorName === "string" ? payload.actorName : undefined;
        const detail = joinDetail(actorName, refText(payload.instance));
        return {
          ...base,
          label: formatMessage(key("importCacheClosed")),
          ...(detail === undefined ? {} : { detail }),
          tone: "default",
        };
      }

      case "phase-entered": {
        const name = typeof payload.name === "string" ? payload.name : undefined;
        const ordinal = typeof payload.ordinal === "number" ? payload.ordinal : 1;
        return {
          ...base,
          label: formatMessage(key("phaseEntered")),
          ...(name === undefined ? {} : { detail: ordinal >= 2 ? `${name} · ${ordinal}` : name }),
          tone: "default",
        };
      }

      
      case "report": {
        const detail = joinDetail(refText(payload.instance), reportItemSummary(payload.item));
        return {
          ...base,
          label: formatMessage(key("report")),
          ...(detail === undefined ? {} : { detail }),
          tone: "default",
        };
      }

      
      case "escalation-raised": {
        const question = typeof payload.question === "string" ? payload.question : undefined;
        const actorName = typeof payload.actorName === "string" ? payload.actorName : undefined;
        const detail = joinDetail(
          nonEmptyText(payload.qid),
          actorName ?? refText(payload.actor),
          question === undefined ? undefined : truncate(question, UNKNOWN_PAYLOAD_MAX_LENGTH),
        );
        return {
          ...base,
          label: formatMessage(key("escalationRaised")),
          ...(detail === undefined ? {} : { detail }),
          tone: "default",
        };
      }

      case "escalation-resolved": {
        const answer = typeof payload.answer === "string" ? payload.answer : undefined;
        const detail = joinDetail(
          nonEmptyText(payload.qid),
          answer === undefined ? undefined : truncate(answer, UNKNOWN_PAYLOAD_MAX_LENGTH),
        );
        return {
          ...base,
          label: formatMessage(key("escalationResolved")),
          ...(detail === undefined ? {} : { detail }),
          tone: "default",
        };
      }

      case "run-settled": {
        const status =
          typeof payload.status === "string" && payload.status.length > 0
            ? payload.status
            : undefined;
        const statusLabel = status
          ? formatMessage({ id: `chat.toolCall.workflow.run.status.${status}` })
          : "";
        const detail = errorMessage(payload.error);
        return {
          ...base,
          label: formatMessage(key("runSettled"), { status: statusLabel }),
          ...(detail === undefined ? {} : { detail }),
          tone: status === "errored" || status === "stopped" ? "failed" : "default",
        };
      }

      default: {
        const concurrencyLine = workflowRunConcurrencyEventLine(event, formatMessage);
        if (concurrencyLine !== undefined) return concurrencyLine;
        const detail = unknownDetail(payload);
        return {
          ...base,
          label: formatMessage(key("unknown"), { type: event.type }),
          ...(detail === undefined ? {} : { detail }),
          tone: "default",
        };
      }
    }
  });
}

export interface WorkflowActorInstance {
  siteId: string;
  ordinal: number;
  name?: string;
  sessionId?: string;
  status: WorkflowRunActor["status"];
}

type WorkflowActorStartState = "notStarted" | "started" | "unknown";

export interface WorkflowActorSlotRef {
  runId: string;
  siteId: string;
  ordinal: number;
  actorSessionId?: string;
}

interface WorkflowActorGate {
  state: WorkflowActorStartState;
  sessionId?: string;
}

export function workflowActorStartState(
  runs: readonly WorkflowRunState[] | undefined,
  slot: WorkflowActorSlotRef,
): WorkflowActorGate {
  const run = runs?.find((candidate) => candidate.runId === slot.runId);
  const actor = run?.actors.find(
    (candidate) => candidate.siteId === slot.siteId && candidate.ordinal === slot.ordinal,
  );
  const sessionId = actor?.sessionId ?? slot.actorSessionId;
  const withSession = sessionId === undefined ? {} : { sessionId };
  if (run === undefined || actor === undefined) {
    return { state: sessionId === undefined ? "notStarted" : "unknown", ...withSession };
  }
  const started = run.nodes.some(
    (node) =>
      node.actorSiteId === actor.siteId &&
      node.actorOrdinal === actor.ordinal &&
      node.phase !== "queued",
  );
  return { state: started ? "started" : "notStarted", ...withSession };
}
