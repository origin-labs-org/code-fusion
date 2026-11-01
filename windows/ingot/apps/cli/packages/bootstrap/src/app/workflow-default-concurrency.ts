// ============================================================
// ============================================================
// docs/dynamic-workflow/concurrency.md「Two bounds on a run」：`max(4, min(16, availableParallelism() − 2))`
//

import { availableParallelism as osAvailableParallelism } from "node:os";

export const WORKFLOW_DEFAULT_CONCURRENCY_MAX = 16;

const WORKFLOW_DEFAULT_CONCURRENCY_FLOOR = 4;

const RESERVED_PARALLELISM = 2;

export const WORKFLOW_CONCURRENCY_AUTO_GROWTH_FACTOR = 2;

export function resolveWorkflowDefaultConcurrency(
  availableParallelism: () => number = osAvailableParallelism,
): number {
  return Math.max(
    WORKFLOW_DEFAULT_CONCURRENCY_FLOOR,
    Math.min(WORKFLOW_DEFAULT_CONCURRENCY_MAX, availableParallelism() - RESERVED_PARALLELISM),
  );
}

export function normalizeRunConcurrency(
  requested: number | undefined,
  defaultConcurrency: number,
): number {
  if (requested === undefined || !Number.isFinite(requested)) return defaultConcurrency;
  return Math.max(1, Math.floor(requested));
}
