

import type { ProcessResourceRuntimeSurface } from "@origin-ai/cf-shared";
import {
  addAppResourceTotals,
  createEmptyAppResourceTotals,
  type AppResourceTotals,
} from "./processResourceAppTotals.js";

export const EXTERNAL_APP_RESOURCE_SAMPLE_DEFAULT_INTERVAL_MS = 60_000;

export const PROCESS_RESOURCE_MAX_EXTERNAL_SAMPLE_SOURCES = 128;

export interface ExternalAppResourceSample extends AppResourceTotals {
  
  sourceKey: string;
  
  runtimeSurface: ProcessResourceRuntimeSurface;
  
  intervalMs?: number;
  
  receivedAt: number;
}

interface StoredExternalSample extends AppResourceTotals {
  receivedAt: number;
  expiresAfterMs: number;
}

const latestSamplesBySource = new Map<string, StoredExternalSample>();

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function recordExternalAppResourceSample(sample: ExternalAppResourceSample): void {
  if (sample.runtimeSurface !== "local" || !sample.sourceKey) {
    return;
  }
  if (
    !isNonNegativeFinite(sample.cpuPercent) ||
    !isNonNegativeFinite(sample.rssKbTotal) ||
    !isNonNegativeFinite(sample.processCount) ||
    !Number.isFinite(sample.receivedAt)
  ) {
    return;
  }
  if (
    !latestSamplesBySource.has(sample.sourceKey) &&
    latestSamplesBySource.size >= PROCESS_RESOURCE_MAX_EXTERNAL_SAMPLE_SOURCES
  ) {
    return;
  }

  const intervalMs =
    typeof sample.intervalMs === "number" &&
    Number.isFinite(sample.intervalMs) &&
    sample.intervalMs > 0
      ? sample.intervalMs
      : EXTERNAL_APP_RESOURCE_SAMPLE_DEFAULT_INTERVAL_MS;

  latestSamplesBySource.set(sample.sourceKey, {
    cpuPercent: sample.cpuPercent,
    rssKbTotal: sample.rssKbTotal,
    processCount: sample.processCount,
    receivedAt: sample.receivedAt,
    expiresAfterMs: intervalMs * 2,
  });
}

export function collectExternalAppResourceTotals(now: number): AppResourceTotals {
  let totals = createEmptyAppResourceTotals();
  for (const [sourceKey, sample] of latestSamplesBySource) {
    if (now - sample.receivedAt > sample.expiresAfterMs) {
      latestSamplesBySource.delete(sourceKey);
      continue;
    }
    totals = addAppResourceTotals(totals, sample);
  }
  return totals;
}

export function resetExternalAppResourceSamples(): void {
  latestSamplesBySource.clear();
}
