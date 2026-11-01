export type LoafInvokerType = "user-callback" | "event-listener" | "script" | "unknown";

export interface LongTaskAttributionSummary {
  loaf_script_count: number;
  loaf_top_duration_ms: number;
  loaf_top_invoker_type: LoafInvokerType;
  loaf_top_share_pct: number;
}

interface RawAttribution {
  duration?: unknown;
  invokerType?: unknown;
}

function classifyInvokerType(raw: RawAttribution): LoafInvokerType {
  if (raw.invokerType === undefined || raw.invokerType === null) {
    return "script";
  }
  if (raw.invokerType === "user-callback" || raw.invokerType === "event-listener") {
    return raw.invokerType;
  }
  return "unknown";
}

export function summarizeLongTaskAttribution(
  snapshotsRaw: unknown,
  totalDurationMs: unknown,
): LongTaskAttributionSummary | null {
  if (typeof snapshotsRaw !== "string" || snapshotsRaw.length === 0) {
    return null;
  }
  let attributions: unknown;
  try {
    attributions = JSON.parse(snapshotsRaw);
  } catch {
    return null;
  }
  if (!Array.isArray(attributions) || attributions.length === 0) {
    return null;
  }

  let top: RawAttribution | null = null;
  let topDuration = -Infinity;
  for (const item of attributions) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const candidate = item as RawAttribution;
    const duration = typeof candidate.duration === "number" ? candidate.duration : 0;
    if (duration > topDuration) {
      topDuration = duration;
      top = candidate;
    }
  }
  if (!top) {
    return null;
  }

  const total = typeof totalDurationMs === "number" ? totalDurationMs : Number.NaN;
  const sharePct =
    Number.isFinite(total) && total > 0
      ? Math.round((Math.max(0, topDuration) / total) * 100)
      : 0;

  return {
    loaf_script_count: attributions.length,
    loaf_top_duration_ms: Math.round(Math.max(0, topDuration)),
    loaf_top_invoker_type: classifyInvokerType(top),
    loaf_top_share_pct: sharePct,
  };
}
