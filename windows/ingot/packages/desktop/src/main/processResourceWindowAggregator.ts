

import type { ProcessResourceRole, ProcessResourceRuntimeSurface } from "@origin-ai/cf-shared";
import {
  appendBoundedSamples,
  computeAggregateStats,
  roundMetric,
} from "./resourceMetricsStats.js";

export const PROCESS_RESOURCE_MAX_SAMPLES_PER_WINDOW = 32;

const PROCESS_RESOURCE_MAX_WINDOWS = 64;

export type ProcessResourceScene = "foreground" | "background";

export interface ProcessResourceHardware {
  platform: NodeJS.Platform;
  arch: string;
  logicalCpuCount: number;
  totalMemoryGb: number;
}

export type ProcessResourceHardwareOverride = Partial<ProcessResourceHardware>;

export interface ProcessRoleSample {
  role: ProcessResourceRole;
  
  environmentKey?: string;
  
  cpuPercent: number;
  rssKbTotal: number;
  rssKbMaxProcess: number;
  processCount: number;
  uptimeMinutes: number;
  
  heapUsedKb?: number;
  runtimeSurface?: ProcessResourceRuntimeSurface;
  
  mcpId?: string;
  hardware?: ProcessResourceHardwareOverride;
}

export interface ProcessRoleWindowReport {
  role: ProcessResourceRole;
  runtimeSurface: ProcessResourceRuntimeSurface;
  mcpId?: string;
  hardware?: ProcessResourceHardwareOverride;
  backgroundRatio: number;
  uptimeMinutes: number;
  cpuPercentMean: number;
  cpuPercentP95: number;
  cpuPercentPeak: number;
  rssKbTotalMean: number;
  rssKbTotalPeak: number;
  rssKbMaxProcessPeak: number;
  heapUsedKbMean?: number;
  heapUsedKbPeak?: number;
  processCountPeak: number;
  sampleCount: number;
}

interface ProcessRoleWindow {
  role: ProcessResourceRole;
  runtimeSurface: ProcessResourceRuntimeSurface;
  mcpId?: string;
  hardware?: ProcessResourceHardwareOverride;
  cpuPercent: number[];
  rssKbTotal: number[];
  rssKbMaxProcess: number[];
  heapUsedKb: number[];
  processCountPeak: number;
  uptimeMinutes: number;
}

export function processResourceHardwareKey(hardware?: ProcessResourceHardwareOverride): string {
  if (!hardware) {
    return "";
  }
  return [
    hardware.platform ?? "",
    hardware.arch ?? "",
    hardware.logicalCpuCount ?? "",
    hardware.totalMemoryGb ?? "",
  ].join("/");
}

function windowKey(sample: ProcessRoleSample): string {
  return [
    sample.role,
    sample.runtimeSurface ?? "local",
    sample.environmentKey ?? "",
    sample.mcpId ?? "",
    processResourceHardwareKey(sample.hardware),
  ].join(":");
}

export class ProcessResourceWindowAggregator {
  private readonly windows = new Map<string, ProcessRoleWindow>();
  private sceneTicks = 0;
  private backgroundTicks = 0;

  
  recordScene(scene: ProcessResourceScene): void {
    this.sceneTicks += 1;
    if (scene === "background") {
      this.backgroundTicks += 1;
    }
  }

  add(sample: ProcessRoleSample): void {
    const key = windowKey(sample);
    let window = this.windows.get(key);
    if (!window) {
      if (this.windows.size >= PROCESS_RESOURCE_MAX_WINDOWS) {
        return;
      }
      window = {
        role: sample.role,
        runtimeSurface: sample.runtimeSurface ?? "local",
        mcpId: sample.mcpId,
        hardware: sample.hardware,
        cpuPercent: [],
        rssKbTotal: [],
        rssKbMaxProcess: [],
        heapUsedKb: [],
        processCountPeak: 0,
        uptimeMinutes: 0,
      };
      this.windows.set(key, window);
    }

    window.cpuPercent = appendBounded(window.cpuPercent, sample.cpuPercent);
    window.rssKbTotal = appendBounded(window.rssKbTotal, sample.rssKbTotal);
    window.rssKbMaxProcess = appendBounded(window.rssKbMaxProcess, sample.rssKbMaxProcess);
    if (typeof sample.heapUsedKb === "number" && Number.isFinite(sample.heapUsedKb)) {
      window.heapUsedKb = appendBounded(window.heapUsedKb, sample.heapUsedKb);
    }
    window.processCountPeak = Math.max(window.processCountPeak, sample.processCount);
    window.uptimeMinutes = Math.max(window.uptimeMinutes, sample.uptimeMinutes);
  }

  
  get backgroundRatio(): number {
    return this.sceneTicks > 0 ? roundMetric(this.backgroundTicks / this.sceneTicks) : 0;
  }

  
  drain(): ProcessRoleWindowReport[] {
    const backgroundRatio = this.backgroundRatio;
    const reports = [...this.windows.values()]
      .filter((window) => window.cpuPercent.length > 0)
      .map((window) => projectWindow(window, backgroundRatio));
    this.clear();
    return reports;
  }

  clear(): void {
    this.windows.clear();
    this.sceneTicks = 0;
    this.backgroundTicks = 0;
  }
}

function appendBounded(bucket: number[], value: number): number[] {
  return appendBoundedSamples(bucket, value, PROCESS_RESOURCE_MAX_SAMPLES_PER_WINDOW);
}

function projectWindow(
  window: ProcessRoleWindow,
  backgroundRatio: number,
): ProcessRoleWindowReport {
  const cpu = computeAggregateStats(window.cpuPercent);
  const rssTotal = computeAggregateStats(window.rssKbTotal);
  const rssMaxProcess = computeAggregateStats(window.rssKbMaxProcess);
  const heap = window.heapUsedKb.length > 0 ? computeAggregateStats(window.heapUsedKb) : null;

  return {
    role: window.role,
    runtimeSurface: window.runtimeSurface,
    mcpId: window.mcpId,
    hardware: window.hardware,
    backgroundRatio,
    uptimeMinutes: window.uptimeMinutes,
    cpuPercentMean: cpu.mean,
    cpuPercentP95: cpu.p95,
    cpuPercentPeak: cpu.peak,
    rssKbTotalMean: rssTotal.mean,
    rssKbTotalPeak: rssTotal.peak,
    rssKbMaxProcessPeak: rssMaxProcess.peak,
    heapUsedKbMean: heap?.mean,
    heapUsedKbPeak: heap?.peak,
    processCountPeak: window.processCountPeak,
    sampleCount: cpu.sample_count,
  };
}
