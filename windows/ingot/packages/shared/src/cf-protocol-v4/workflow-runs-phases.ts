import {
  WORKFLOW_RUNS_LIMITS,
  type WorkflowRunPhase,
  type WorkflowRunState,
} from "./workflow-runs.js";
import { readPhaseHoles } from "./workflow-runs-holes.js";

export function reduceRunLaunched(
  run: WorkflowRunState,
  payload: Record<string, unknown>,
): WorkflowRunState {
  if (!Array.isArray(payload.phaseNames)) return run;
  const phaseNames: string[] = [];
  for (const raw of payload.phaseNames) {
    if (typeof raw !== "string") continue;
    const name = raw.slice(0, WORKFLOW_RUNS_LIMITS.maxPhaseNameLength);
    if (name.length === 0) continue;
    phaseNames.push(name);
    if (phaseNames.length >= WORKFLOW_RUNS_LIMITS.maxPhases) break;
  }
  if (phaseNames.length === 0) return run;
  const phaseAlongside = readPhaseAlongside(payload.phaseAlongside, phaseNames.length);
  const phaseHoles = readPhaseHoles(payload.holes, phaseNames.length);
  return {
    ...run,
    phaseNames,
    ...(phaseAlongside === undefined ? {} : { phaseAlongside }),
    ...(phaseHoles === undefined ? {} : { phaseHoles }),
  };
}

function readPhaseAlongside(raw: unknown, count: number): number[][] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: number[][] = [];
  let any = false;
  for (let index = 0; index < count; index += 1) {
    const entry: unknown = raw[index];
    const indexes: number[] = [];
    if (Array.isArray(entry)) {
      for (const value of entry) {
        if (typeof value !== "number" || !Number.isInteger(value)) continue;
        if (value < 0 || value >= count || value === index) continue;
        if (indexes.includes(value)) continue;
        indexes.push(value);
        if (indexes.length >= WORKFLOW_RUNS_LIMITS.maxPhases) break;
      }
    }
    if (indexes.length > 0) any = true;
    out.push(indexes);
  }
  return any ? out : undefined;
}

export function reducePhaseEntered(
  run: WorkflowRunState,
  payload: Record<string, unknown>,
): WorkflowRunState {
  const raw = typeof payload.name === "string" ? payload.name : undefined;
  const name = raw?.slice(0, WORKFLOW_RUNS_LIMITS.maxPhaseNameLength);
  if (name === undefined || name.length === 0) return run;
  const ordinal =
    typeof payload.ordinal === "number" && Number.isInteger(payload.ordinal) && payload.ordinal > 0
      ? payload.ordinal
      : 1;
  const existing = run.phases ?? [];
  const index = existing.findIndex((phase) => phase.name === name);
  let phases: WorkflowRunPhase[];
  let truncated = run.truncated === true;
  if (index >= 0) {
    const current = existing[index]!;
    phases =
      current.rounds >= ordinal
        ? existing
        : existing.map((phase, i) => (i === index ? { ...phase, rounds: ordinal } : phase));
  } else if (existing.length >= WORKFLOW_RUNS_LIMITS.maxPhases) {
    phases = existing;
    truncated = true;
  } else {
    phases = [...existing, { name, rounds: ordinal }];
  }
  return {
    ...run,
    phases,
    currentPhase: name,
    ...(truncated ? { truncated: true } : {}),
  };
}
