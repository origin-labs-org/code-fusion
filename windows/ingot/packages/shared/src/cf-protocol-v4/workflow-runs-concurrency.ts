// ============================================================
// ============================================================

import {
  WORKFLOW_RUNS_LIMITS,
  type WorkflowRunConcurrency,
  type WorkflowRunState,
} from "./workflow-runs.js";

const CONCURRENCY_IDLE_RESET_REASON = "idle_reset";

export function reduceConcurrencyChanged(
  run: WorkflowRunState,
  payload: Record<string, unknown>,
): WorkflowRunState {
  const next = positiveInteger(payload.next);
  if (next === undefined) return run;
  const previous = positiveInteger(payload.previous) ?? next;
  const ceiling = run.concurrencyCeiling ?? Math.max(run.concurrency?.ceiling ?? 0, previous, next);
  const key = nonEmptyString(payload.key);
  const limit = run.concurrency?.limit;
  const cooldownMs =
    payload.reason === CONCURRENCY_IDLE_RESET_REASON
      ? undefined
      : nonNegativeInteger(payload.cooldownMs);
  const concurrency: WorkflowRunConcurrency = {
    ...(key === undefined || key.length > WORKFLOW_RUNS_LIMITS.maxConcurrencyKeyLength
      ? {}
      : { key }),
    cap: next,
    ceiling,
    ...(limit === undefined ? {} : { limit }),
    ...(cooldownMs === undefined ? {} : { cooldownMs }),
  };
  return { ...run, concurrency };
}

export function reduceRunStartedConcurrency(
  run: WorkflowRunState,
  payload: Record<string, unknown>,
): WorkflowRunState {
  const limit = positiveInteger(plainRecord(payload.caps)?.maxConcurrency);
  const readCeiling = positiveInteger(payload.concurrencyCeiling);
  const ceiling =
    readCeiling !== undefined && readCeiling <= WORKFLOW_RUNS_LIMITS.maxConcurrencyCeiling
      ? readCeiling
      : undefined;
  const withCeiling =
    ceiling === undefined || run.concurrencyCeiling === ceiling
      ? run
      : { ...run, concurrencyCeiling: ceiling };
  if (limit === undefined || ceiling === undefined || limit === ceiling) return withCeiling;
  const existing = withCeiling.concurrency;
  const concurrency: WorkflowRunConcurrency = {
    ...(existing ?? { cap: ceiling }),
    ceiling,
    limit,
  };
  return { ...withCeiling, concurrency };
}

export function reduceRunCapsChanged(
  run: WorkflowRunState,
  payload: Record<string, unknown>,
): WorkflowRunState {
  const maxConcurrency = positiveInteger(plainRecord(payload.caps)?.maxConcurrency);
  const readCeiling = positiveInteger(payload.concurrencyCeiling);
  const payloadCeiling =
    readCeiling !== undefined && readCeiling <= WORKFLOW_RUNS_LIMITS.maxConcurrencyCeiling
      ? readCeiling
      : undefined;
  const withCeiling =
    payloadCeiling === undefined || run.concurrencyCeiling === payloadCeiling
      ? run
      : { ...run, concurrencyCeiling: payloadCeiling };
  const ceiling = payloadCeiling ?? withCeiling.concurrencyCeiling;
  if (maxConcurrency === undefined || ceiling === undefined) return withCeiling;
  const existing = withCeiling.concurrency;
  if (maxConcurrency !== ceiling) {
    const concurrency: WorkflowRunConcurrency = {
      ...(existing ?? { cap: ceiling }),
      ceiling,
      limit: maxConcurrency,
    };
    return { ...withCeiling, concurrency };
  }
  if (existing?.limit === undefined) return withCeiling;
  const { limit: _lifted, ...rest } = existing;
  const shared: WorkflowRunConcurrency = { ...rest, ceiling };
  return shared.cooldownMs === undefined && shared.cap >= shared.ceiling
    ? withoutConcurrency(withCeiling)
    : { ...withCeiling, concurrency: shared };
}

function withoutConcurrency(run: WorkflowRunState): WorkflowRunState {
  const { concurrency: _cleared, ...rest } = run;
  return rest;
}

export function withoutCooldown(run: WorkflowRunState): WorkflowRunState {
  if (run.concurrency?.cooldownMs === undefined) return run;
  const { cooldownMs: _expired, ...rest } = run.concurrency;
  return { ...run, concurrency: rest };
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
