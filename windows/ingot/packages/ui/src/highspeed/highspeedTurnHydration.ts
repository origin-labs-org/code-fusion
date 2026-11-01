import type { HighspeedMessageMeta } from "@origin-ai/cf-shared";
import type {
  HighspeedTranscriptRow,
  HighspeedTurnMetrics,
  HighspeedTurnRecord,
} from "@/highspeed/highspeedTurnStore.js";

const METRIC_KEYS = [
  "outputTokens",
  "durationMs",
  "modelDurationMs",
  "toolDurationMs",
  "otherDurationMs",
  "regularTps",
  "highspeedTps",
  "savedDurationMs",
] as const satisfies readonly (keyof HighspeedTurnMetrics)[];

export interface HighspeedHydrationPlan {
  
  records: Array<{ record: HighspeedTurnRecord; existed: boolean }>;
  
  cardTps: Array<[cardId: string, highspeedTps: number]>;
  
  changedRows: number;
}

export interface HighspeedHydrationContext {
  sessionId: string;
  now: number;
  findRecord(sourceCommandId: string): HighspeedTurnRecord | null;
  getCardTps(cardId: string): number | undefined;
}

type HydratableRow = HighspeedTranscriptRow & {
  sourceCommandId: string;
  highspeed: HighspeedMessageMeta;
};

function sameMetrics(a: HighspeedTurnMetrics | undefined, b: HighspeedTurnMetrics | undefined) {
  if (!a || !b) return a === b;
  return METRIC_KEYS.every((key) => a[key] === b[key]);
}

function mergeTranscriptRow(
  existing: HighspeedTurnRecord | null,
  sessionId: string,
  row: HydratableRow,
  now: number,
  highspeedTpsOfCard: number | undefined,
): HighspeedTurnRecord | null {
  const meta = row.highspeed;
  const base: HighspeedTurnRecord = existing ?? {
    sessionId,
    sourceCommandId: row.sourceCommandId,
    card: {
      cardId: meta.cardId,
      taskId: meta.taskId,
      provider: meta.provider,
      model: meta.model,
      issuedAt: meta.issuedAt,
      expiresAt: meta.expiresAt,
      ...(meta.regularTps !== undefined ? { regularTps: meta.regularTps } : {}),
    },
    createdAt: row.createdAt,
  };
  let next = base;
  if (meta.regularTps !== undefined && next.card.regularTps !== meta.regularTps) {
    next = { ...next, card: { ...next.card, regularTps: meta.regularTps } };
  }
  if (meta.outputTokens !== undefined && meta.durationMs !== undefined) {
    const metrics: HighspeedTurnMetrics = {
      ...next.metrics,
      outputTokens: Math.max(0, Math.floor(meta.outputTokens)),
      durationMs: Math.max(0, meta.durationMs),
      ...(meta.modelDurationMs !== undefined
        ? { modelDurationMs: Math.max(0, meta.modelDurationMs) }
        : {}),
      ...(meta.toolDurationMs !== undefined
        ? { toolDurationMs: Math.max(0, meta.toolDurationMs) }
        : {}),
      ...(meta.otherDurationMs !== undefined
        ? { otherDurationMs: Math.max(0, meta.otherDurationMs) }
        : {}),
      regularTps: meta.regularTps ?? next.metrics?.regularTps ?? next.card.regularTps ?? 0,
    };
    if (!sameMetrics(next.metrics, metrics)) {
      next = { ...next, completedAt: next.completedAt ?? now, metrics };
    }
  }
  const highspeedTps = meta.highspeedTps ?? highspeedTpsOfCard;
  if (
    meta.savedDurationMs !== undefined &&
    next.metrics &&
    highspeedTps &&
    next.metricsPersistedAt === undefined
  ) {
    next = {
      ...next,
      metricsPersistedAt: now,
      metrics: {
        ...next.metrics,
        highspeedTps,
        savedDurationMs: Math.max(0, meta.savedDurationMs),
      },
    };
  }
  return existing && next === base ? null : next;
}

export function planHighspeedTranscriptHydration(
  rows: readonly HighspeedTranscriptRow[],
  context: HighspeedHydrationContext,
): HighspeedHydrationPlan {
  const plan: HighspeedHydrationPlan = { records: [], cardTps: [], changedRows: 0 };
  const stagedByCommandId = new Map<string, number>();
  const stagedCardTps = new Map<string, number>();
  for (const row of rows) {
    const meta = row.highspeed;
    if (!meta || !row.sourceCommandId) continue;
    const sourceCommandId = row.sourceCommandId;
    const stagedIndex = stagedByCommandId.get(sourceCommandId);
    const staged = stagedIndex === undefined ? undefined : plan.records[stagedIndex];
    const existing = staged?.record ?? context.findRecord(sourceCommandId);
    let changed = false;
    let cardTps = stagedCardTps.get(meta.cardId) ?? context.getCardTps(meta.cardId);
    if (
      meta.highspeedTps !== undefined &&
      Number.isFinite(meta.highspeedTps) &&
      meta.highspeedTps > 0 &&
      cardTps !== meta.highspeedTps
    ) {
      stagedCardTps.set(meta.cardId, meta.highspeedTps);
      plan.cardTps.push([meta.cardId, meta.highspeedTps]);
      cardTps = meta.highspeedTps;
      changed = true;
    }
    const merged = mergeTranscriptRow(
      existing,
      context.sessionId,
      { ...row, sourceCommandId, highspeed: meta },
      context.now,
      cardTps,
    );
    if (merged) {
      if (stagedIndex !== undefined && staged) {
        plan.records[stagedIndex] = { record: merged, existed: staged.existed };
      } else {
        stagedByCommandId.set(sourceCommandId, plan.records.length);
        plan.records.push({ record: merged, existed: existing !== null });
      }
      changed = true;
    }
    if (changed) plan.changedRows += 1;
  }
  return plan;
}
