// ============================================================
// ============================================================
//

import { WORKFLOW_RUNS_LIMITS, type WorkflowRunActor } from "./workflow-runs.js";

export function workflowActorEntry(
  ref: { siteId: string; ordinal: number },
  name: unknown,
  phaseName: string | undefined,
  sessionId: string | undefined,
  model: unknown,
): WorkflowRunActor {
  const bounded = boundedActorName(nonEmptyString(name));
  const canonical = boundedActorModel(nonEmptyString(model));
  return {
    siteId: ref.siteId,
    ordinal: ref.ordinal,
    ...(bounded === undefined ? {} : { name: bounded }),
    ...(sessionId ? { sessionId } : {}),
    ...(phaseName === undefined ? {} : { phaseName }),
    ...(canonical === undefined ? {} : { model: canonical }),
    status: "waiting",
  };
}

function boundedActorModel(model: string | undefined): string | undefined {
  return model === undefined || model.length > WORKFLOW_RUNS_LIMITS.maxSubagentModelLength
    ? undefined
    : model;
}

export function boundedActorName(name: string | undefined): string | undefined {
  return name === undefined ? undefined : name.slice(0, WORKFLOW_RUNS_LIMITS.maxActorNameLength);
}

export function boundedPhaseName(name: string | undefined): string | undefined {
  return name === undefined ? undefined : name.slice(0, WORKFLOW_RUNS_LIMITS.maxPhaseNameLength);
}

export function boundedSessionId(value: unknown): string | undefined {
  const text = nonEmptyString(value);
  return text !== undefined && text.length <= WORKFLOW_RUNS_LIMITS.maxSessionIdLength
    ? text
    : undefined;
}

export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function workflowInstanceRef(value: unknown): { siteId: string; ordinal: number } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const siteId = nonEmptyString(record.siteId);
  const ordinal = record.ordinal;
  if (siteId === undefined || typeof ordinal !== "number") return null;
  return { siteId, ordinal };
}
