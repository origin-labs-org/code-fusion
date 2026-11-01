

import type { ProcessResourceRole } from "@origin-ai/cf-shared";
import type { AppResourceTotals } from "./processResourceAppTotals.js";
import type { DeviceResourceSample } from "./processResourceSystemWindowAggregator.js";
import type { ProcessRoleSample } from "./processResourceWindowAggregator.js";

export interface ProcessResourceSampleContext {
  
  now: number;
  addRoleSample: (sample: ProcessRoleSample) => void;
  
  addRoleHeapSample: (role: ProcessResourceRole, heapUsedKb: number) => void;
  
  addAppProcessTotals: (totals: AppResourceTotals) => void;
  onError?: (sourceId: string, error: unknown) => void;
}

export interface ProcessResourceDeviceSampleContext {
  now: number;
  
  appProcessTotals: AppResourceTotals | null;
  addDeviceSample: (sample: DeviceResourceSample) => void;
  onError?: (sourceId: string, error: unknown) => void;
}

export interface ProcessResourceSampleSource {
  
  readonly id: string;
  
  sample?: (context: ProcessResourceSampleContext) => void;
  
  sampleDevice?: (context: ProcessResourceDeviceSampleContext) => void;
  
  flushPending?: (context: ProcessResourceSampleContext) => void;
  
  reset?: () => void;
}

export function runProcessResourceSampleSources(
  sources: readonly ProcessResourceSampleSource[],
  context: ProcessResourceSampleContext,
): void {
  for (const source of sources) {
    try {
      source.sample?.(context);
    } catch (error) {
      context.onError?.(source.id, error);
    }
  }
}

export function runProcessResourceDeviceSampleSources(
  sources: readonly ProcessResourceSampleSource[],
  context: ProcessResourceDeviceSampleContext,
): void {
  for (const source of sources) {
    try {
      source.sampleDevice?.(context);
    } catch (error) {
      context.onError?.(source.id, error);
    }
  }
}

export function flushPendingProcessResourceSampleSources(
  sources: readonly ProcessResourceSampleSource[],
  context: ProcessResourceSampleContext,
): void {
  for (const source of sources) {
    try {
      source.flushPending?.(context);
    } catch (error) {
      context.onError?.(source.id, error);
    }
  }
}

export function resetProcessResourceSampleSources(
  sources: readonly ProcessResourceSampleSource[],
): void {
  for (const source of sources) {
    try {
      source.reset?.();
    } catch {
    }
  }
}
