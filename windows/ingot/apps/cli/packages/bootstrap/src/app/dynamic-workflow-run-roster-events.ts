// ============================================================
// ============================================================
//

import type { StoredEvent } from "@origin-ai/cf-dynamic-workflow";

const PROGRESS_EVENT_TYPES: ReadonlySet<string> = new Set([
  "node-queued",
  "node-dispatched",
  "node-executing",
  "node-settled",
  "node-progress",
  "phase-entered",
  "log",
  "report",
  "artifact-published",
  "usage-updated",
]);

const NODE_LIFECYCLE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "node-queued",
  "node-dispatched",
  "node-executing",
  "node-waiting",
  "node-repairing",
  "node-nudged",
  "node-settled",
]);

export function instanceKey(siteId: string, ordinal: number): string {
  return `${siteId}@${ordinal}`;
}

export interface RosterWaitTrace {
  cause: "slot" | "backoff";
  reason?: string;
  retryAfterMs?: number;
  since?: number;
}

export interface RosterNodeTrace {
  
  dispatchedAt?: number;
  
  lastLifecycleType?: string;
  
  wait?: RosterWaitTrace;
  
  lastToolAt?: number;
  
  lastActivityAt?: number;
}

export interface RosterPhaseTrace {
  enteredAt?: number;
  exitedAt?: number;
}

export interface RosterSettlement {
  key: string;
  outcome: string;
  cached: boolean;
}

export interface RosterEventIndex {
  nodes: ReadonlyMap<string, RosterNodeTrace>;
  phases: ReadonlyMap<string, RosterPhaseTrace>;
  settlements: readonly RosterSettlement[];
  
  lastProgressAt?: number;
  
  stalledSince?: number;
  
  concurrencyReason?: string;
  concurrencySince?: number;
}

export function indexRosterEvents(events: readonly StoredEvent[], now: number): RosterEventIndex {
  const nodes = new Map<string, RosterNodeTrace>();
  const phases = new Map<string, RosterPhaseTrace>();
  const settlements: RosterSettlement[] = [];
  let lastProgressAt: number | undefined;
  let stalledAt: number | undefined;
  let stalledPending = false;
  let concurrencyReason: string | undefined;
  let concurrencySince: number | undefined;
  let lastPhaseName: string | undefined;

  for (const stored of events) {
    const { event } = stored;
    const at = timeOf(stored, now);

    if (PROGRESS_EVENT_TYPES.has(event.type)) {
      lastProgressAt = laterOf(lastProgressAt, at);
      stalledPending = false;
    }

    if (event.type === "run-stalled") {
      stalledAt = at;
      stalledPending = true;
      continue;
    }
    if (event.type === "concurrency-changed") {
      concurrencyReason = event.reason;
      concurrencySince = at;
      continue;
    }
    if (event.type === "phase-entered") {
      lastPhaseName = trackPhase(phases, event.name, lastPhaseName, at);
      continue;
    }
    if (!("instance" in event)) continue;

    const key = instanceKey(event.instance.siteId, event.instance.ordinal);
    const trace = nodes.get(key) ?? {};
    if (PROGRESS_EVENT_TYPES.has(event.type)) {
      trace.lastActivityAt = laterOf(trace.lastActivityAt, at);
    }
    if (NODE_LIFECYCLE_EVENT_TYPES.has(event.type)) {
      trackLifecycle(trace, event.type, at);
    }
    if (event.type === "node-waiting") {
      const since = trace.wait?.since ?? at;
      trace.wait = {
        cause: event.cause,
        ...(event.reason === undefined ? {} : { reason: event.reason }),
        ...(event.retryAfterMs === undefined ? {} : { retryAfterMs: event.retryAfterMs }),
        ...(since === undefined ? {} : { since }),
      };
    }
    if (event.type === "node-progress" && event.lastTool !== undefined && at !== undefined) {
      trace.lastToolAt = at;
    }
    if (event.type === "node-settled") {
      settlements.push({ key, outcome: event.outcome, cached: event.cached === true });
    }
    nodes.set(key, trace);
  }

  return {
    nodes,
    phases,
    settlements,
    ...(lastProgressAt === undefined ? {} : { lastProgressAt }),
    ...(stalledPending && stalledAt !== undefined ? { stalledSince: stalledAt } : {}),
    ...(concurrencyReason === undefined ? {} : { concurrencyReason }),
    ...(concurrencySince === undefined ? {} : { concurrencySince }),
  };
}

function trackPhase(
  phases: Map<string, RosterPhaseTrace>,
  name: string,
  lastPhaseName: string | undefined,
  at: number | undefined,
): string {
  if (lastPhaseName !== undefined && lastPhaseName !== name && at !== undefined) {
    const previous = phases.get(lastPhaseName);
    if (previous !== undefined) previous.exitedAt = at;
  }
  phases.set(name, at === undefined ? {} : { enteredAt: at });
  return name;
}

function trackLifecycle(trace: RosterNodeTrace, type: string, at: number | undefined): void {
  trace.lastLifecycleType = type;
  if (type !== "node-waiting") trace.wait = undefined;
  if (type === "node-queued") trace.dispatchedAt = undefined;
  if (type === "node-dispatched" && at !== undefined) trace.dispatchedAt = at;
}

function timeOf(stored: StoredEvent, now: number): number | undefined {
  const time = stored.timeCreated;
  if (typeof time !== "number" || !Number.isFinite(time) || time <= 0) return undefined;
  return Math.min(time, now);
}

export function laterOf(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.max(left, right);
}
