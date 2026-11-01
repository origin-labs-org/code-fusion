

import {
  appendBoundedSamples,
  computeAggregateStats,
  roundMetric,
} from "./resourceMetricsStats.js";
import { PROCESS_RESOURCE_MAX_SAMPLES_PER_WINDOW } from "./processResourceWindowAggregator.js";

export interface DeviceResourceSample {
  
  systemCpuPercent: number;
  systemFreeMemoryKb: number;
  
  appCpuPercent: number;
  appRssKbTotal: number;
  appProcessCount: number;
}

export interface SystemResourceWindowReport {
  backgroundRatio: number;
  appUptimeMinutes: number;
  systemCpuPercentP95: number;
  systemFreeMemoryKbMin: number;
  
  appCpuPercentMean: number;
  appCpuPercentP95: number;
  appRssKbTotalMean: number;
  appRssKbTotalPeak: number;
  processCountTotalPeak: number;
  sampleCount: number;
  telemetrySelfMs: number;
}

export class ProcessResourceSystemWindowAggregator {
  private systemCpuPercent: number[] = [];
  private systemFreeMemoryKb: number[] = [];
  private appCpuPercent: number[] = [];
  private appRssKbTotal: number[] = [];
  private processCountTotalPeak = 0;
  private telemetrySelfMs = 0;

  add(sample: DeviceResourceSample): void {
    this.systemCpuPercent = appendSample(this.systemCpuPercent, sample.systemCpuPercent);
    this.systemFreeMemoryKb = appendSample(this.systemFreeMemoryKb, sample.systemFreeMemoryKb);
    this.appCpuPercent = appendSample(this.appCpuPercent, sample.appCpuPercent);
    this.appRssKbTotal = appendSample(this.appRssKbTotal, sample.appRssKbTotal);
    this.processCountTotalPeak = Math.max(this.processCountTotalPeak, sample.appProcessCount);
  }

  
  addTelemetrySelfMs(elapsedMs: number): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
      return;
    }
    this.telemetrySelfMs += elapsedMs;
  }

  
  drain(input: {
    backgroundRatio: number;
    appUptimeMinutes: number;
  }): SystemResourceWindowReport | null {
    if (this.appCpuPercent.length === 0) {
      this.clearSamples();
      return null;
    }

    const systemCpu = computeAggregateStats(this.systemCpuPercent);
    const appCpu = computeAggregateStats(this.appCpuPercent);
    const appRss = computeAggregateStats(this.appRssKbTotal);
    const report: SystemResourceWindowReport = {
      backgroundRatio: input.backgroundRatio,
      appUptimeMinutes: input.appUptimeMinutes,
      systemCpuPercentP95: systemCpu.p95,
      systemFreeMemoryKbMin: Math.min(...this.systemFreeMemoryKb),
      appCpuPercentMean: appCpu.mean,
      appCpuPercentP95: appCpu.p95,
      appRssKbTotalMean: appRss.mean,
      appRssKbTotalPeak: appRss.peak,
      processCountTotalPeak: this.processCountTotalPeak,
      sampleCount: appCpu.sample_count,
      telemetrySelfMs: roundMetric(this.telemetrySelfMs),
    };
    this.clear();
    return report;
  }

  clear(): void {
    this.clearSamples();
    this.telemetrySelfMs = 0;
  }

  private clearSamples(): void {
    this.systemCpuPercent = [];
    this.systemFreeMemoryKb = [];
    this.appCpuPercent = [];
    this.appRssKbTotal = [];
    this.processCountTotalPeak = 0;
  }
}

function appendSample(bucket: number[], value: number): number[] {
  return appendBoundedSamples(bucket, value, PROCESS_RESOURCE_MAX_SAMPLES_PER_WINDOW);
}
