// ============================================================
// ============================================================
//

import {
  reduceWorkflowRunsState,
  workflowRunStepCounts as sharedWorkflowRunStepCounts,
  type WorkflowRunActor,
  type WorkflowRunUsage,
  type WorkflowRunProgressEnvelope,
  type WorkflowRunState,
  type WorkflowRunsState,
} from "@origin-ai/cf-shared/cf-protocol-v4";

const TUI_WORKFLOW_LOG_TAIL_LIMITS = {
  maxEntries: 10,
  maxEntryLength: 200,
} as const;

export type TuiWorkflowRunSeed = {
  runId: string;
  label?: string;
  updatedAt?: number;
};

export type TuiWorkflowMirror = {
  
  state: WorkflowRunsState;
  logTailByRunId: Readonly<Record<string, readonly string[]>>;
  seedByRunId: Readonly<Record<string, TuiWorkflowRunSeed>>;
};

export const EMPTY_TUI_WORKFLOW_MIRROR: TuiWorkflowMirror = {
  state: { revision: 0, runs: [] },
  logTailByRunId: {},
  seedByRunId: {},
};

export function applyWorkflowProgressToMirror(
  mirror: TuiWorkflowMirror,
  envelope: WorkflowRunProgressEnvelope,
): TuiWorkflowMirror {
  const state = reduceWorkflowRunsState(mirror.state, envelope);
  const logTailByRunId = appendWorkflowLogTail(mirror.logTailByRunId, envelope);
  if (state === null && logTailByRunId === mirror.logTailByRunId) return mirror;
  return {
    ...mirror,
    ...(state === null ? {} : { state }),
    logTailByRunId,
  };
}

export function seedWorkflowMirror(
  mirror: TuiWorkflowMirror,
  seeds: readonly TuiWorkflowRunSeed[],
): TuiWorkflowMirror {
  if (seeds.length === 0) return mirror;
  const seedByRunId = { ...mirror.seedByRunId };
  let changed = false;
  for (const seed of seeds) {
    if (!seed.runId) continue;
    const existing = seedByRunId[seed.runId];
    if (existing && sameSeed(existing, seed)) continue;
    seedByRunId[seed.runId] = seed;
    changed = true;
  }
  return changed ? { ...mirror, seedByRunId } : mirror;
}

export function workflowRunStepCounts(run: WorkflowRunState): {
  nodesSettled: number;
  nodesTotal: number;
} {
  const { total, settled } = sharedWorkflowRunStepCounts(run);
  return { nodesSettled: settled, nodesTotal: total };
}

export type TuiWorkflowCard = {
  runId: string;
  status: WorkflowRunState["status"];
  
  stopReason?: WorkflowRunState["stopReason"];
  nodesSettled: number;
  nodesTotal: number;
  label?: string;
  resumable?: boolean;
  usage?: WorkflowRunUsage;
  actors: readonly WorkflowRunActor[];
  logTail: readonly string[];
  error?: string;
  resultPreview?: string;
  truncated?: boolean;
};

export function buildTuiWorkflowCardIndex(
  mirror: TuiWorkflowMirror,
): ReadonlyMap<string, TuiWorkflowCard> {
  const byToolCallId = new Map<string, TuiWorkflowCard>();
  for (const run of mirror.state.runs) {
    if (!run.toolCallId) continue;
    byToolCallId.set(run.toolCallId, cardFromRun(run, mirror));
  }
  return byToolCallId;
}

function cardFromRun(run: WorkflowRunState, mirror: TuiWorkflowMirror): TuiWorkflowCard {
  const { nodesSettled, nodesTotal } = workflowRunStepCounts(run);
  const seed = mirror.seedByRunId[run.runId];
  return {
    runId: run.runId,
    status: run.status,
    ...(run.stopReason === undefined ? {} : { stopReason: run.stopReason }),
    nodesSettled,
    nodesTotal,
    ...(seed?.label === undefined ? {} : { label: seed.label }),
    ...(run.resumable === undefined ? {} : { resumable: run.resumable }),
    usage: run.usage,
    actors: run.actors,
    logTail: mirror.logTailByRunId[run.runId] ?? [],
    ...(run.error === undefined ? {} : { error: run.error }),
    ...(run.resultPreview === undefined ? {} : { resultPreview: run.resultPreview }),
    ...(run.truncated === undefined ? {} : { truncated: run.truncated }),
  };
}

function appendWorkflowLogTail(
  current: Readonly<Record<string, readonly string[]>>,
  envelope: WorkflowRunProgressEnvelope,
): Readonly<Record<string, readonly string[]>> {
  if (envelope.eventType !== "log" || !envelope.runId) return current;
  const message = logMessage(envelope.payload);
  if (message === undefined) return current;
  const previous = current[envelope.runId] ?? [];
  const appended = [...previous, message].slice(-TUI_WORKFLOW_LOG_TAIL_LIMITS.maxEntries);
  return { ...current, [envelope.runId]: appended };
}

function logMessage(payload: Record<string, unknown> | undefined): string | undefined {
  if (!payload) return undefined;
  const raw = payload.message;
  if (typeof raw !== "string") return undefined;
  const collapsed = raw.replace(/\s+/gu, " ").trim();
  if (collapsed.length === 0) return undefined;
  return collapsed.slice(0, TUI_WORKFLOW_LOG_TAIL_LIMITS.maxEntryLength);
}

function sameSeed(left: TuiWorkflowRunSeed, right: TuiWorkflowRunSeed): boolean {
  return left.label === right.label && left.updatedAt === right.updatedAt;
}
