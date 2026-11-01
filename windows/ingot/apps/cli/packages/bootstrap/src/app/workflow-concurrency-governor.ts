// ============================================================
// ============================================================
//
//

import { resolveWorkflowModelFailurePolicy } from "@origin-ai/cf-adapters/model";
import {
  ModelErrorCode,
  type ModelNetworkStatusEvent,
  type ModelRequestAdmission,
  type ModelRequestAdmissionTicket,
  type ModelRequestFailedStatusEvent,
  type ModelRequestTarget,
} from "@origin-ai/cf-contracts";
import {
  ConcurrencyController,
  type ConcurrencyChange,
  type ConcurrencyControllerSnapshot,
  type ConcurrencyThrottleReason,
} from "@origin-ai/cf-dynamic-workflow";
import {
  resolveWorkflowDefaultConcurrency,
  WORKFLOW_CONCURRENCY_AUTO_GROWTH_FACTOR,
} from "./workflow-default-concurrency.js";

export function workflowConcurrencyKey(model: ModelRequestTarget): string {
  return `${String(model.providerId)}/${String(model.modelId)}`;
}

export interface WorkflowConcurrencyPort {
  tryAdmit(runId: string, key: string): ModelRequestAdmissionTicket | undefined;
  admit(runId: string, key: string, signal: AbortSignal): Promise<ModelRequestAdmissionTicket>;
  subscribe(runId: string, listener: (change: ConcurrencyChange) => void): () => void;
  setRunBound(runId: string, bound: number): void;
  clearRunBound(runId: string): void;
}

interface WorkflowConcurrencyGovernor extends WorkflowConcurrencyPort {
  
  observer(): ModelRequestAdmission;
  
  snapshot(key: string): ConcurrencyControllerSnapshot | undefined;
}

interface WorkflowConcurrencyGovernorOptions {
  
  defaultConcurrency: number;
  
  now?: () => number;
  
  schedule?: (callback: () => void, delayMs: number) => () => void;
}

const THROTTLE_REASONS: ReadonlySet<string> = new Set<ConcurrencyThrottleReason>([
  "rate_limited",
  "provider_overloaded",
  "offpeak_queued",
]);

const NON_FAILURE_RETRY_REASONS: ReadonlySet<string> = new Set([
  "reasoning_signature_repair",
  "auth_refresh",
]);

interface Waiter {
  runId: string;
  resolve: (ticket: ModelRequestAdmissionTicket) => void;
  reject: (reason: unknown) => void;
  signal: AbortSignal;
  onAbort: () => void;
}

interface Bucket {
  readonly key: string;
  readonly controller: ConcurrencyController;
  
  readonly inFlightByRun: Map<string, number>;
  
  readonly queues: Map<string, Waiter[]>;
  
  lastGrantedRun?: string;
  
  readonly runs: Set<string>;
  cancelCooldownWake?: () => void;
}

const OBSERVER_RUN_ID = "\0observer";

const defaultSchedule = (callback: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(callback, delayMs);
  if (typeof timer === "object" && timer !== null && "unref" in timer) timer.unref();
  return () => clearTimeout(timer);
};

export function createWorkflowConcurrencyGovernor(
  options: WorkflowConcurrencyGovernorOptions,
): WorkflowConcurrencyGovernor {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? defaultSchedule;
  const buckets = new Map<string, Bucket>();
  
  const listeners = new Map<string, Set<(change: ConcurrencyChange) => void>>();
  const baseGrowthLimit = WORKFLOW_CONCURRENCY_AUTO_GROWTH_FACTOR * options.defaultConcurrency;
  
  const runBounds = new Map<string, number>();

  const bucketFor = (key: string): Bucket => {
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = {
        key,
        controller: new ConcurrencyController(key, options.defaultConcurrency, baseGrowthLimit),
        inFlightByRun: new Map(),
        queues: new Map(),
        runs: new Set(),
      };
      buckets.set(key, bucket);
    }
    return bucket;
  };

  const waiterCount = (bucket: Bucket): number => {
    let total = 0;
    for (const queue of bucket.queues.values()) total += queue.length;
    return total;
  };

  
  const fanOut = (
    bucket: Bucket,
    changes: ConcurrencyChange[],
    alsoTo?: ReadonlySet<string>,
  ): void => {
    if (changes.length === 0) return;
    for (const [runId, set] of listeners) {
      const engaged =
        (bucket.inFlightByRun.get(runId) ?? 0) > 0 ||
        (bucket.queues.get(runId)?.length ?? 0) > 0 ||
        alsoTo?.has(runId) === true;
      if (!engaged) continue;
      for (const change of changes) {
        for (const listener of set) listener(change);
      }
    }
  };

  
  const refreshGrowthLimit = (bucket: Bucket): void => {
    let largestBound: number | undefined;
    for (const runId of bucket.runs) {
      const bound = runBounds.get(runId);
      if (bound !== undefined && (largestBound === undefined || bound > largestBound)) {
        largestBound = bound;
      }
    }
    const limit = Math.max(baseGrowthLimit, largestBound ?? 0);
    const changes =
      limit === bucket.controller.snapshot().growthLimit
        ? []
        : bucket.controller.setGrowthLimit(now(), limit);
    if (largestBound !== undefined) changes.push(...bucket.controller.seed(now(), largestBound));
    fanOut(bucket, changes, bucket.runs);
  };

  
  const noteRunUsed = (bucket: Bucket, runId: string): void => {
    if (bucket.runs.has(runId)) return;
    bucket.runs.add(runId);
    if (runBounds.has(runId)) refreshGrowthLimit(bucket);
  };

  const bumpInFlight = (bucket: Bucket, runId: string, delta: number): void => {
    const next = (bucket.inFlightByRun.get(runId) ?? 0) + delta;
    if (next <= 0) bucket.inFlightByRun.delete(runId);
    else bucket.inFlightByRun.set(runId, next);
  };

  
  const mintTicket = (bucket: Bucket, runId: string, epoch: number): ModelRequestAdmissionTicket => {
    let settled = false;
    const settle = (signal: (at: number) => ConcurrencyChange[]): void => {
      if (settled) return;
      settled = true;
      const changes = signal(now());
      fanOut(bucket, changes);
      bumpInFlight(bucket, runId, -1);
      drain(bucket);
    };
    return {
      publish(event: ModelNetworkStatusEvent) {
        if (settled) return;
        switch (event.type) {
          case "model_request_started":
            return;
          case "model_request_completed":
            settle((at) => bucket.controller.succeeded(at, epoch));
            return;
          case "model_retry_scheduled": {
            const reason: string = event.reason;
            if (NON_FAILURE_RETRY_REASONS.has(reason)) {
              settle((at) => bucket.controller.ended(at));
              return;
            }
            if (THROTTLE_REASONS.has(reason)) {
              settle((at) =>
                bucket.controller.throttled(
                  at,
                  epoch,
                  reason as ConcurrencyThrottleReason,
                  event.retryAfterMs,
                ),
              );
              return;
            }
            settle((at) => bucket.controller.failedTransient(at));
            return;
          }
          case "model_request_failed":
            if (event.retryable) return;
            if (isWorkflowStopFailure(event)) {
              settle((at) => bucket.controller.ended(at));
              return;
            }
            if (event.reason === "rate_limited") {
              settle((at) =>
                bucket.controller.throttled(at, epoch, "rate_limited", event.retryAfterMs),
              );
              return;
            }
            settle((at) => bucket.controller.ended(at));
            return;
          default:
            return;
        }
      },
      release() {
        settle((at) => bucket.controller.ended(at));
      },
    };
  };

  
  const grant = (bucket: Bucket, runId: string): ModelRequestAdmissionTicket => {
    fanOut(bucket, bucket.controller.observe(now()));
    const epoch = bucket.controller.admitted(now());
    bumpInFlight(bucket, runId, 1);
    bucket.lastGrantedRun = runId;
    return mintTicket(bucket, runId, epoch);
  };

  
  const nextRunWithWaiters = (bucket: Bucket): string | undefined => {
    const runs = [...bucket.queues.keys()].filter((runId) => (bucket.queues.get(runId)?.length ?? 0) > 0);
    if (runs.length === 0) return undefined;
    const last = bucket.lastGrantedRun;
    const lastIndex = last === undefined ? -1 : runs.indexOf(last);
    return runs[(lastIndex + 1) % runs.length];
  };

  const armCooldownWake = (bucket: Bucket): void => {
    bucket.cancelCooldownWake?.();
    bucket.cancelCooldownWake = undefined;
    if (waiterCount(bucket) === 0) return;
    const until = bucket.controller.snapshot().cooldownUntil;
    if (until === undefined) return;
    const delay = Math.max(0, until - now());
    bucket.cancelCooldownWake = schedule(() => {
      bucket.cancelCooldownWake = undefined;
      drain(bucket);
    }, delay);
  };

  
  const drain = (bucket: Bucket): void => {
    fanOut(bucket, bucket.controller.observe(now()));
    for (;;) {
      fanOut(bucket, bucket.controller.waiters(now(), waiterCount(bucket)));
      if (!bucket.controller.canAdmit(now())) break;
      const runId = nextRunWithWaiters(bucket);
      if (runId === undefined) break;
      const queue = bucket.queues.get(runId)!;
      const waiter = queue.shift()!;
      if (queue.length === 0) bucket.queues.delete(runId);
      waiter.signal.removeEventListener("abort", waiter.onAbort);
      waiter.resolve(grant(bucket, runId));
    }
    fanOut(bucket, bucket.controller.waiters(now(), waiterCount(bucket)));
    armCooldownWake(bucket);
  };

  const tryAdmit: WorkflowConcurrencyPort["tryAdmit"] = (runId, key) => {
    const bucket = bucketFor(key);
    noteRunUsed(bucket, runId);
    fanOut(bucket, bucket.controller.observe(now()));
    if (waiterCount(bucket) > 0 || !bucket.controller.canAdmit(now())) return undefined;
    return grant(bucket, runId);
  };

  const admit: WorkflowConcurrencyPort["admit"] = (runId, key, signal) => {
    const bucket = bucketFor(key);
    if (signal.aborted) return Promise.reject(abortedError(signal));
    noteRunUsed(bucket, runId);
    return new Promise<ModelRequestAdmissionTicket>((resolve, reject) => {
      const waiter: Waiter = { runId, resolve, reject, signal, onAbort: () => {} };
      waiter.onAbort = () => {
        const queue = bucket.queues.get(runId);
        if (queue !== undefined) {
          const index = queue.indexOf(waiter);
          if (index >= 0) queue.splice(index, 1);
          if (queue.length === 0) bucket.queues.delete(runId);
        }
        reject(abortedError(signal));
        fanOut(bucket, bucket.controller.waiters(now(), waiterCount(bucket)));
        armCooldownWake(bucket);
      };
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      const queue = bucket.queues.get(runId) ?? [];
      queue.push(waiter);
      bucket.queues.set(runId, queue);
      drain(bucket);
    });
  };

  const subscribe: WorkflowConcurrencyPort["subscribe"] = (runId, listener) => {
    const set = listeners.get(runId) ?? new Set();
    set.add(listener);
    listeners.set(runId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) listeners.delete(runId);
    };
  };

  const setRunBound: WorkflowConcurrencyPort["setRunBound"] = (runId, bound) => {
    runBounds.set(runId, bound);
    for (const bucket of buckets.values()) {
      if (bucket.runs.has(runId)) refreshGrowthLimit(bucket);
    }
  };

  const clearRunBound: WorkflowConcurrencyPort["clearRunBound"] = (runId) => {
    runBounds.delete(runId);
    for (const bucket of buckets.values()) {
      if (bucket.runs.delete(runId)) refreshGrowthLimit(bucket);
    }
  };

  const observerAdmission: ModelRequestAdmission = {
    tryAcquire: ({ model }) => grant(bucketFor(workflowConcurrencyKey(model)), OBSERVER_RUN_ID),
    acquire: ({ model }) =>
      Promise.resolve(grant(bucketFor(workflowConcurrencyKey(model)), OBSERVER_RUN_ID)),
  };

  return {
    tryAdmit,
    admit,
    subscribe,
    setRunBound,
    clearRunBound,
    observer: () => observerAdmission,
    snapshot(key) {
      return buckets.get(key)?.controller.snapshot();
    },
  };
}

function isWorkflowStopFailure(event: ModelRequestFailedStatusEvent): boolean {
  return (
    resolveWorkflowModelFailurePolicy(
      {
        code: event.errorCode ?? ModelErrorCode.ModelRequestFailed,
        reason: event.reason,
        retryable: event.retryable,
      },
      event.providerErrorCode,
    ).decision === "stop"
  );
}

function abortedError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  return new Error("workflow request admission aborted");
}

let processGovernor: WorkflowConcurrencyGovernor | undefined;

export function getWorkflowConcurrencyGovernor(): WorkflowConcurrencyGovernor {
  processGovernor ??= createWorkflowConcurrencyGovernor({
    defaultConcurrency: resolveWorkflowDefaultConcurrency(),
  });
  return processGovernor;
}
