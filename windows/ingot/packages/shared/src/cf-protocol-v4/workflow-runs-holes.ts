// ============================================================
// ============================================================
// apps/cli/packages/dynamic-workflow/docs/execution-engine.md「Holes」。

import {
  WORKFLOW_RUNS_LIMITS,
  type WorkflowRunHole,
  type WorkflowRunState,
} from "./workflow-runs.js";
import { boundedPhaseName, nonEmptyString } from "./workflow-runs-entries.js";

export const WORKFLOW_HOLE_SITE_ID_PATTERN = /^hole#[0-9a-f]{8}$/u;

function readEpoch(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

export function readPhaseHoles(raw: unknown, count: number): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: number[] = [];
  for (const value of raw) {
    if (typeof value !== "number" || !Number.isInteger(value)) continue;
    if (value < 0 || value >= count || out.includes(value)) continue;
    out.push(value);
    if (out.length >= WORKFLOW_RUNS_LIMITS.maxPhases) break;
  }
  return out.length === 0 ? undefined : out;
}

export function readPhaseNames(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const names: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const name = value.slice(0, WORKFLOW_RUNS_LIMITS.maxPhaseNameLength);
    if (name.length === 0) continue;
    names.push(name);
    if (names.length >= WORKFLOW_RUNS_LIMITS.maxPhases) break;
  }
  return names.length === 0 ? undefined : names;
}

function boundedHolePrompt(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const max = WORKFLOW_RUNS_LIMITS.maxHolePromptLength;
  return raw.length <= max ? raw : `${raw.slice(0, max - 1)}…`;
}

export function reduceHoleReached(
  run: WorkflowRunState,
  payload: Record<string, unknown>,
): WorkflowRunState {
  const instance = payload.instance;
  if (typeof instance !== "object" || instance === null) return run;
  const siteId = nonEmptyString((instance as Record<string, unknown>).siteId);
  const ordinalRaw = (instance as Record<string, unknown>).ordinal;
  const ordinal = typeof ordinalRaw === "number" && Number.isInteger(ordinalRaw) ? ordinalRaw : 0;
  const name = boundedPhaseName(nonEmptyString(payload.name));
  if (siteId === undefined || name === undefined) return run;
  const type = nonEmptyString(payload.type)?.slice(0, WORKFLOW_RUNS_LIMITS.maxHoleTypeLength);
  const prompt = boundedHolePrompt(nonEmptyString(payload.prompt));
  const since = readEpoch(payload.reachedAt) ?? readEpoch(payload.since);
  const entry: WorkflowRunHole = {
    siteId,
    ordinal,
    name,
    ...(type === undefined ? {} : { type }),
    ...(prompt === undefined ? {} : { prompt }),
    state: "waiting",
    ...(since === undefined ? {} : { since }),
  };
  const existing = run.holes ?? [];
  const index = existing.findIndex((hole) => hole.siteId === siteId);
  if (index >= 0) {
    const previous = existing[index]!;
    const merged: WorkflowRunHole = {
      ...entry,
      ...(entry.type === undefined && previous.type !== undefined ? { type: previous.type } : {}),
      ...(entry.prompt === undefined && previous.prompt !== undefined
        ? { prompt: previous.prompt }
        : {}),
    };
    return { ...run, holes: existing.map((hole, i) => (i === index ? merged : hole)) };
  }
  if (existing.length >= WORKFLOW_RUNS_LIMITS.maxHoles) return { ...run, truncated: true };
  return { ...run, holes: [...existing, entry] };
}

export function reduceHoleFilled(
  run: WorkflowRunState,
  payload: Record<string, unknown>,
): WorkflowRunState {
  const siteId = nonEmptyString(payload.siteId);
  if (siteId === undefined) return run;
  const filledAt = readEpoch(payload.filledAt);
  const filledBy = nonEmptyString(payload.filledBy)?.slice(0, 128);
  let next: WorkflowRunState = run;

  const existing = run.holes ?? [];
  const index = existing.findIndex((hole) => hole.siteId === siteId);
  if (index >= 0) {
    const { prompt: _prompt, ...reached } = existing[index]!;
    void _prompt;
    const filled: WorkflowRunHole = {
      ...reached,
      state: "filled",
      ...(filledAt === undefined ? {} : { filledAt }),
      ...(filledBy === undefined ? {} : { filledBy }),
    };
    next = { ...next, holes: existing.map((hole, i) => (i === index ? filled : hole)) };
  }

  const phaseNames = readPhaseNames(payload.phaseNames);
  if (phaseNames === undefined) return next;
  const phaseHoles = readPhaseHoles(payload.holes, phaseNames.length);
  const phaseAlongside = shiftPhaseAlongside(run, phaseNames);
  const { phaseAlongside: _stale, phaseHoles: _staleHoles, ...rest } = next;
  void [_stale, _staleHoles];
  return {
    ...rest,
    phaseNames,
    ...(phaseAlongside === undefined ? {} : { phaseAlongside }),
    ...(phaseHoles === undefined ? {} : { phaseHoles }),
  };
}

function shiftPhaseAlongside(
  run: WorkflowRunState,
  names: readonly string[],
): number[][] | undefined {
  const old = run.phaseNames;
  const alongside = run.phaseAlongside;
  if (old === undefined || alongside === undefined) return undefined;
  const inserted = names.length - old.length;
  if (inserted < 0) return undefined;
  let h = -1;
  for (let i = 0; i < old.length; i += 1) {
    if (old[i] !== names[i]) break;
    h = i;
  }
  if (h < 0) return undefined;
  for (let i = h + 1; i < old.length; i += 1) {
    if (old[i] !== names[i + inserted]) return undefined;
  }
  const shift = (i: number): number => (i <= h ? i : i + inserted);
  const out: number[][] = [];
  for (let i = 0; i < names.length; i += 1) {
    const source = i <= h ? i : i - inserted;
    const entry = i > h && i <= h + inserted ? [] : (alongside[source] ?? []);
    out.push(entry.map(shift));
  }
  return out.some((entry) => entry.length > 0) ? out : undefined;
}

export function withoutWaitingHoles(run: WorkflowRunState): WorkflowRunState {
  if (run.holes === undefined) return run;
  const kept = run.holes.filter((hole) => hole.state === "filled");
  if (kept.length === run.holes.length) return run;
  const { holes: _dropped, ...rest } = run;
  void _dropped;
  return kept.length === 0 ? rest : { ...rest, holes: kept };
}
