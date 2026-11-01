// ============================================================
// ============================================================
//
//

import type {
  ConversationDelta,
  WorkflowRunEntryRef,
  WorkflowRunHeaderKey,
  WorkflowRunRemovedDelta,
  WorkflowRunUpdatedDelta,
} from "./delta.js";
import {
  WORKFLOW_RUNS_LIMITS,
  workflowRunSchema,
  type WorkflowRunActor,
  type WorkflowRunNode,
  type WorkflowRunState,
  type WorkflowRunsState,
} from "./workflow-runs.js";

const WORKFLOW_RUN_KEYS = Object.keys(workflowRunSchema.shape) as (keyof WorkflowRunState)[];
const WORKFLOW_RUN_KEY_SET: ReadonlySet<string> = new Set<string>(WORKFLOW_RUN_KEYS);

export const WORKFLOW_RUN_HEADER_KEYS: readonly WorkflowRunHeaderKey[] = WORKFLOW_RUN_KEYS.filter(
  (key): key is WorkflowRunHeaderKey => key !== "actors" && key !== "nodes",
);

const runShape = workflowRunSchema.shape as unknown as Record<
  string,
  { safeParse: (value: unknown) => { success: boolean } }
>;
const WORKFLOW_RUN_REQUIRED_HEADER_KEYS: readonly WorkflowRunHeaderKey[] =
  WORKFLOW_RUN_HEADER_KEYS.filter((key) => !runShape[key]!.safeParse(undefined).success);

export function workflowRunEntryKey(entry: { siteId: string; ordinal: number }): string {
  return `${entry.siteId}\0${entry.ordinal}`;
}

export function canonicalWorkflowRun(run: WorkflowRunState): WorkflowRunState {
  const source = run as unknown as Record<string, unknown>;
  const canonical: Record<string, unknown> = {};
  for (const key of WORKFLOW_RUN_KEYS) {
    const value = source[key];
    if (value !== undefined) canonical[key] = value;
  }
  for (const key of Object.keys(source)) {
    if (WORKFLOW_RUN_KEY_SET.has(key)) continue;
    const value = source[key];
    if (value !== undefined) canonical[key] = value;
  }
  return canonical as unknown as WorkflowRunState;
}

export function jsonValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => jsonValueEqual(item, b[index]));
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  let present = 0;
  for (const key of Object.keys(left)) {
    const value = left[key];
    if (value === undefined) continue;
    present += 1;
    if (!jsonValueEqual(value, right[key])) return false;
  }
  let expected = 0;
  for (const key of Object.keys(right)) if (right[key] !== undefined) expected += 1;
  return present === expected;
}

export function workflowRunUnchanged(previous: WorkflowRunState, next: WorkflowRunState): boolean {
  return jsonValueEqual(previous, next);
}

export function isCompleteWorkflowRunHeader(header: unknown): boolean {
  if (typeof header !== "object" || header === null) return false;
  const record = header as Record<string, unknown>;
  return WORKFLOW_RUN_REQUIRED_HEADER_KEYS.every((key) => record[key] !== undefined);
}

export function diffWorkflowRunsState(
  prior: WorkflowRunsState | undefined,
  next: WorkflowRunsState,
): ConversationDelta[] {
  const priorRuns = prior?.runs ?? [];
  const nextIds = new Set(next.runs.map((run) => run.runId));
  const ops: ConversationDelta[] = [];
  for (const run of priorRuns) {
    if (nextIds.has(run.runId)) continue;
    ops.push({ op: "workflowRun.removed", runId: run.runId, revision: next.revision });
  }
  const priorById = new Map(priorRuns.map((run) => [run.runId, run]));
  for (const run of next.runs) {
    const before = priorById.get(run.runId);
    if (before === run) continue;
    const op = diffWorkflowRun(before, run, next.revision);
    if (op === null) return [{ op: "state.updated", patch: { workflowRuns: next } }];
    if (op !== undefined) ops.push(op);
  }
  if (ops.length === 0 && (prior?.revision ?? -1) !== next.revision) {
    return [{ op: "state.updated", patch: { workflowRuns: next } }];
  }
  return ops;
}

function diffWorkflowRun(
  before: WorkflowRunState | undefined,
  run: WorkflowRunState,
  revision: number,
): WorkflowRunUpdatedDelta | undefined | null {
  const source = run as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  const cleared: WorkflowRunHeaderKey[] = [];
  if (before === undefined) {
    for (const key of WORKFLOW_RUN_HEADER_KEYS) {
      const value = source[key];
      if (value !== undefined) patch[key] = value;
    }
    return {
      op: "workflowRun.updated",
      runId: run.runId,
      revision,
      run: patch as WorkflowRunUpdatedDelta["run"],
      ...(run.actors.length > 0 ? { actors: [...run.actors] } : {}),
      ...(run.nodes.length > 0 ? { nodes: [...run.nodes] } : {}),
    };
  }
  const previous = before as unknown as Record<string, unknown>;
  for (const key of WORKFLOW_RUN_HEADER_KEYS) {
    const left = previous[key];
    const right = source[key];
    if (left === right) continue;
    if (right === undefined) {
      cleared.push(key);
      continue;
    }
    if (left !== undefined && jsonValueEqual(left, right)) continue;
    patch[key] = right;
  }
  const actors = diffWorkflowRunEntries(before.actors, run.actors);
  const nodes = diffWorkflowRunEntries(before.nodes, run.nodes);
  if (actors === null || nodes === null) return null;
  const changedHeader = Object.keys(patch).length > 0 || cleared.length > 0;
  if (!changedHeader && actors === undefined && nodes === undefined) return undefined;
  return {
    op: "workflowRun.updated",
    runId: run.runId,
    revision,
    ...(Object.keys(patch).length > 0 ? { run: patch as WorkflowRunUpdatedDelta["run"] } : {}),
    ...(cleared.length > 0 ? { cleared } : {}),
    ...(actors?.removed.length ? { removedActors: actors.removed } : {}),
    ...(nodes?.removed.length ? { removedNodes: nodes.removed } : {}),
    ...(actors?.changed.length ? { actors: actors.changed } : {}),
    ...(nodes?.changed.length ? { nodes: nodes.changed } : {}),
  };
}

interface EntryDiff<T> {
  removed: WorkflowRunEntryRef[];
  changed: T[];
}

function diffWorkflowRunEntries<T extends { siteId: string; ordinal: number }>(
  before: readonly T[],
  after: readonly T[],
): EntryDiff<T> | undefined | null {
  if (before === after) return undefined;
  if (before.length <= after.length) {
    const changed: T[] = [];
    let aligned = true;
    for (let index = 0; index < after.length && aligned; index += 1) {
      const entry = after[index]!;
      const previous = before[index];
      if (previous === undefined) {
        changed.push(entry);
        continue;
      }
      if (previous === entry) continue;
      if (previous.siteId !== entry.siteId || previous.ordinal !== entry.ordinal) aligned = false;
      else if (!jsonValueEqual(previous, entry)) changed.push(entry);
    }
    if (aligned) return changed.length > 0 ? { removed: [], changed } : undefined;
  }
  return diffWorkflowRunEntriesByKey(before, after);
}

function diffWorkflowRunEntriesByKey<T extends { siteId: string; ordinal: number }>(
  before: readonly T[],
  after: readonly T[],
): EntryDiff<T> | undefined | null {
  const survives = new Set(after.map(workflowRunEntryKey));
  const removed: WorkflowRunEntryRef[] = [];
  const survivors: T[] = [];
  for (const entry of before) {
    if (survives.has(workflowRunEntryKey(entry))) survivors.push(entry);
    else removed.push({ siteId: entry.siteId, ordinal: entry.ordinal });
  }
  if (survivors.length > after.length) return null;
  const changed: T[] = [];
  for (let index = 0; index < after.length; index += 1) {
    const entry = after[index]!;
    const previous = survivors[index];
    if (previous === undefined) {
      changed.push(entry);
      continue;
    }
    if (previous.siteId !== entry.siteId || previous.ordinal !== entry.ordinal) return null;
    if (previous === entry || jsonValueEqual(previous, entry)) continue;
    changed.push(entry);
  }
  if (removed.length === 0 && changed.length === 0) return undefined;
  return { removed, changed };
}

export function applyWorkflowRunUpdated(
  state: WorkflowRunsState | undefined,
  delta: WorkflowRunUpdatedDelta,
): WorkflowRunsState {
  const runs = state?.runs ?? [];
  const revision = Math.max(state?.revision ?? 0, delta.revision);
  const index = runs.findIndex((run) => run.runId === delta.runId);
  if (index < 0) {
    if (!isCompleteWorkflowRunHeader(delta.run)) {
      return state !== undefined && state.revision === revision ? state : { revision, runs };
    }
    const born = canonicalWorkflowRun({
      ...(delta.run as Partial<WorkflowRunState>),
      actors: delta.actors === undefined ? [] : [...delta.actors],
      nodes: delta.nodes === undefined ? [] : [...delta.nodes],
    } as WorkflowRunState);
    return { revision, runs: [...runs, born] };
  }
  const existing = runs[index]!;
  const merged: Record<string, unknown> = { ...existing, ...delta.run };
  for (const key of delta.cleared ?? []) delete merged[key];
  const actors = removeWorkflowRunEntries(existing.actors, delta.removedActors);
  const nodes = removeWorkflowRunEntries(existing.nodes, delta.removedNodes);
  if (actors !== existing.actors) merged.actors = actors;
  if (nodes !== existing.nodes) merged.nodes = nodes;
  if (delta.actors !== undefined && delta.actors.length > 0) {
    merged.actors = upsertWorkflowRunEntries(actors, delta.actors);
  }
  if (delta.nodes !== undefined && delta.nodes.length > 0) {
    merged.nodes = upsertWorkflowRunEntries(nodes, delta.nodes);
  }
  const next = [...runs];
  next[index] = canonicalWorkflowRun(merged as unknown as WorkflowRunState);
  return { revision, runs: next };
}

export function applyWorkflowRunRemoved(
  state: WorkflowRunsState | undefined,
  delta: WorkflowRunRemovedDelta,
): WorkflowRunsState {
  const runs = state?.runs ?? [];
  const revision = Math.max(state?.revision ?? 0, delta.revision);
  const remaining = runs.filter((run) => run.runId !== delta.runId);
  if (remaining.length === runs.length) {
    return state !== undefined && state.revision === revision ? state : { revision, runs };
  }
  return { revision, runs: remaining };
}

function removeWorkflowRunEntries<T extends { siteId: string; ordinal: number }>(
  current: readonly T[],
  removed: readonly { siteId: string; ordinal: number }[] | undefined,
): T[] {
  if (removed === undefined || removed.length === 0) return current as T[];
  const dropped = new Set(removed.map(workflowRunEntryKey));
  const next = current.filter((entry) => !dropped.has(workflowRunEntryKey(entry)));
  return next.length === current.length ? (current as T[]) : next;
}

function upsertWorkflowRunEntries<T extends { siteId: string; ordinal: number }>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const next = [...current];
  const indexByKey = new Map<string, number>();
  next.forEach((entry, index) => indexByKey.set(workflowRunEntryKey(entry), index));
  for (const entry of incoming) {
    const key = workflowRunEntryKey(entry);
    const index = indexByKey.get(key);
    if (index === undefined) {
      indexByKey.set(key, next.length);
      next.push(entry);
      continue;
    }
    next[index] = entry;
  }
  return next;
}

export function workflowRunUpdateWithinWireBounds(
  delta: WorkflowRunUpdatedDelta,
  limits: WorkflowRunWireBounds = WORKFLOW_RUNS_LIMITS,
): boolean {
  return (
    (delta.actors?.length ?? 0) <= limits.maxActors &&
    (delta.removedActors?.length ?? 0) <= limits.maxActors &&
    (delta.nodes?.length ?? 0) <= limits.maxNodes &&
    (delta.removedNodes?.length ?? 0) <= limits.maxNodes
  );
}

export interface WorkflowRunWireBounds {
  readonly maxActors: number;
  readonly maxNodes: number;
}

export function mergeWorkflowRunUpdates(
  earlier: WorkflowRunUpdatedDelta,
  later: WorkflowRunUpdatedDelta,
): WorkflowRunUpdatedDelta {
  const run: Record<string, unknown> = { ...earlier.run, ...later.run };
  const laterCleared = new Set<string>(later.cleared ?? []);
  for (const key of laterCleared) delete run[key];
  const cleared: WorkflowRunHeaderKey[] = [];
  for (const key of earlier.cleared ?? []) {
    if (run[key] === undefined && !cleared.includes(key)) cleared.push(key);
  }
  for (const key of later.cleared ?? []) {
    if (!cleared.includes(key)) cleared.push(key);
  }
  const removedActors = mergeRemovedRefs(earlier.removedActors, later.removedActors);
  const removedNodes = mergeRemovedRefs(earlier.removedNodes, later.removedNodes);
  const actors = mergeEntryLists<WorkflowRunActor>(
    earlier.actors,
    later.actors,
    later.removedActors,
  );
  const nodes = mergeEntryLists<WorkflowRunNode>(earlier.nodes, later.nodes, later.removedNodes);
  return {
    op: "workflowRun.updated",
    runId: later.runId,
    revision: Math.max(earlier.revision, later.revision),
    ...(Object.keys(run).length > 0 ? { run: run as WorkflowRunUpdatedDelta["run"] } : {}),
    ...(cleared.length > 0 ? { cleared } : {}),
    ...(removedActors === undefined ? {} : { removedActors }),
    ...(removedNodes === undefined ? {} : { removedNodes }),
    ...(actors === undefined ? {} : { actors }),
    ...(nodes === undefined ? {} : { nodes }),
  };
}

function mergeRemovedRefs(
  earlier: readonly WorkflowRunEntryRef[] | undefined,
  later: readonly WorkflowRunEntryRef[] | undefined,
): WorkflowRunEntryRef[] | undefined {
  if (earlier === undefined && later === undefined) return undefined;
  const merged: WorkflowRunEntryRef[] = [];
  const seen = new Set<string>();
  for (const ref of [...(earlier ?? []), ...(later ?? [])]) {
    const key = workflowRunEntryKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(ref);
  }
  return merged.length > 0 ? merged : undefined;
}

function mergeEntryLists<T extends { siteId: string; ordinal: number }>(
  earlier: readonly T[] | undefined,
  later: readonly T[] | undefined,
  laterRemoved: readonly WorkflowRunEntryRef[] | undefined,
): T[] | undefined {
  if (earlier === undefined && later === undefined) return undefined;
  const dropped = new Set((laterRemoved ?? []).map(workflowRunEntryKey));
  const kept =
    dropped.size === 0
      ? (earlier ?? [])
      : (earlier ?? []).filter((entry) => !dropped.has(workflowRunEntryKey(entry)));
  const merged = upsertWorkflowRunEntries(kept, later ?? []);
  return merged.length > 0 ? merged : undefined;
}
