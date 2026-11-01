// ============================================================
// ============================================================
//
//

import type {
  DynamicWorkflowRunRetuneRequest,
  DynamicWorkflowRunRetuneResult,
} from "@origin-ai/cf-contracts";
import type { JournalStorePort } from "@origin-ai/cf-dynamic-workflow";
import type { RunRegistryEntry } from "./dynamic-workflow-run-observation.js";
import { normalizeRunConcurrency } from "./workflow-default-concurrency.js";

export interface DynamicWorkflowRunRetuneContext {
  runs: Map<string, RunRegistryEntry>;
  journal: JournalStorePort;
  
  defaultConcurrency: () => number;
}

export function retuneRunConcurrency(
  ctx: DynamicWorkflowRunRetuneContext,
  request: DynamicWorkflowRunRetuneRequest,
): DynamicWorkflowRunRetuneResult {
  const defaultConcurrency = ctx.defaultConcurrency();
  const next = normalizeRunConcurrency(request.maxConcurrency ?? undefined, defaultConcurrency);

  const entry = ctx.runs.get(request.runId);
  if (entry === undefined || entry.terminal !== undefined || entry.control === undefined) {
    return { ok: false, reason: "not_live" };
  }

  const current =
    entry.maxConcurrency ??
    ctx.journal.getRun(request.runId)?.caps.maxConcurrency ??
    defaultConcurrency;
  if (current === next) return { ok: false, reason: "unchanged", current };

  if (!entry.control.setMaxConcurrency(next)) {
    return { ok: false, reason: "not_live", current };
  }
  entry.maxConcurrency = next;
  return { ok: true, maxConcurrency: next, previous: current, defaultConcurrency };
}
