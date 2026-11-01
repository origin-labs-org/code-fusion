// ============================================================
// ============================================================

import {
  CoreErrorType,
  createSessionId,
  type SessionId,
  type SubmitVerdict as ContractsSubmitVerdict,
  type SubmitViolation,
} from "@origin-ai/cf-contracts";
import type { TurnResult } from "@origin-ai/cf-core";
import {
  refToString,
  WorkflowError,
  type ActorRef,
  type AskStats,
  type InstanceRef,
  type PersonaSpec,
  type Violation,
  type WorkflowReportSink,
} from "@origin-ai/cf-dynamic-workflow";
import type { ActorToolCounts } from "./workflow-driver-tool-activity.js";
import type { Deferred, SessionState } from "./workflow-driver-types.js";

export function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function mintActorSessionId(runId: string, actor: ActorRef): SessionId {
  return createSessionId(
    `dwf-${sanitizeIdSegment(runId)}-${sanitizeIdSegment(refToString(actor))}`,
  );
}

function sanitizeIdSegment(value: string): string {
  return value.replace(/_/g, "__").replace(/[^A-Za-z0-9.-]/g, "_");
}

export const MAX_ESCALATIONS_PER_ASK = 3;

export const ESCALATION_BUDGET_EXHAUSTED =
  `Escalation budget exhausted: at most ${MAX_ESCALATIONS_PER_ASK} escalations per task. ` +
  "Do not call escalate again. Proceed on your best judgement with the information you have, " +
  "and state in your final result the assumptions you relied on and the doubts that remain.";

export function questionIdFragments(runId: string): string[] {
  const body = runId.startsWith("dwfrun-") ? runId.slice("dwfrun-".length) : runId;
  const full = sanitizeIdSegment(body);
  const candidates = [full.slice(0, 8), full.slice(0, 16), full];
  return [...new Set(candidates)];
}

export function effectiveActorName(persona: PersonaSpec): string | undefined {
  const name = persona.name;
  return name === undefined || name === "" ? undefined : name;
}

export function normalizeEscalationContext(context: string | undefined): string | undefined {
  const trimmed = context?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

export const NUDGE_PROMPT =
  "You ended your turn without submitting a result. Call the submit_result tool now with a payload conforming to the required schema.";

export function schemaEpilogue(schema: unknown): string {
  const rendered = schema === undefined ? "(any JSON value)" : JSON.stringify(schema, null, 2);
  return [
    "",
    "",
    "---",
    "When you have finished, call the `submit_result` tool to submit your final result. Its `result` argument must be a JSON value conforming to this JSON Schema:",
    "",
    rendered,
    "",
    "Pass the conforming JSON as the `result` argument — do not wrap it or add commentary.",
  ].join("\n");
}

export const TYPED_TOOL_EPILOGUE = [
  "",
  "",
  "---",
  "When you have finished, call the `submit_result` tool to submit your final result. Its `result` argument must match the tool's declared schema — pass the conforming JSON directly, do not wrap it or add commentary.",
].join("\n");

export function mapViolations(violations: readonly Violation[]): SubmitViolation[] {
  return violations.map((v) => ({ path: v.path, expected: v.expected, got: v.got }));
}

export function rejectWith(message: string): ContractsSubmitVerdict {
  return {
    accept: false,
    violations: [{ path: "$", expected: message, got: "submit_result call" }],
  };
}

export function statsFromTurn(result: TurnResult, toolCounts: ActorToolCounts): AskStats {
  const usage = result.usage;
  return {
    tokens: usage?.totalTokens ?? 0,
    toolCalls: toolCounts.toolCalls,
    turns: usage?.modelRequestCount ?? 1,
    worldToolCalls: toolCounts.worldToolCalls,
  };
}

export function isTurnCancelled(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { type?: unknown }).type === CoreErrorType.TurnCancelled
  );
}

export function toWorkflowError(error: unknown): WorkflowError {
  if (error instanceof WorkflowError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new WorkflowError("DriverError", `Subagent turn failed: ${message}`, { cause: error });
}

export const PROVIDER_STOP_RAW_MESSAGE_MAX_CHARS = 2000;

export const TRANSIENT_CONTINUE_PROMPT =
  "The previous model request failed transiently and was abandoned; continue from where you left off.";

const TRANSIENT_BACKOFF_BASE_MS = 2_000;
const TRANSIENT_BACKOFF_MAX_MS = 60_000;

export function transientBackoffMs(attempt: number, random: () => number = Math.random): number {
  const raw = Math.min(TRANSIENT_BACKOFF_MAX_MS, TRANSIENT_BACKOFF_BASE_MS * 2 ** (attempt - 1));
  return Math.round(raw * (0.5 + 0.5 * random()));
}

export function readRetryAfterMs(error: unknown): number | undefined {
  for (const candidate of [error, (error as { cause?: unknown } | undefined)?.cause]) {
    const context = (candidate as { context?: { retryAfterMs?: unknown } } | undefined)?.context;
    const value = context?.retryAfterMs;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

export function subagentLabel(state: Pick<SessionState, "actor" | "actorName">): string {
  return state.actorName ?? refToString(state.actor);
}

export const defaultSchedule = (callback: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(callback, delayMs);
  if (typeof timer === "object" && timer !== null && "unref" in timer) timer.unref();
  return () => clearTimeout(timer);
};

export function reportTurnObservations(
  sink: WorkflowReportSink,
  state: SessionState,
  instance: InstanceRef,
  result: TurnResult,
): void {
  sink.askProgress(instance, state.modelActivity.noteTurnResolved());
  sink.askStats(instance, statsFromTurn(result, state.modelActivity.toolCounts()));
}
