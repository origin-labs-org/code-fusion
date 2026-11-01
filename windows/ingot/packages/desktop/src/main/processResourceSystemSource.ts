

import os from "node:os";
import { addAppResourceTotals } from "./processResourceAppTotals.js";
import {
  collectExternalAppResourceTotals,
  resetExternalAppResourceSamples,
} from "./processResourceExternalAppSamples.js";
import type { ProcessResourceSampleSource } from "./processResourceSampleSources.js";
import { roundMetric } from "./resourceMetricsStats.js";

interface SystemCpuTimesSnapshot {
  busyMs: number;
  totalMs: number;
}

function summarizeSystemCpuTimes(cpus: readonly os.CpuInfo[]): SystemCpuTimesSnapshot {
  let busyMs = 0;
  let idleMs = 0;
  for (const cpu of cpus) {
    const times = cpu.times;
    busyMs += (times?.user ?? 0) + (times?.nice ?? 0) + (times?.sys ?? 0) + (times?.irq ?? 0);
    idleMs += times?.idle ?? 0;
  }
  return { busyMs, totalMs: busyMs + idleMs };
}

function diffSystemCpuPercent(
  previous: SystemCpuTimesSnapshot,
  next: SystemCpuTimesSnapshot,
): number | null {
  const totalDeltaMs = next.totalMs - previous.totalMs;
  const busyDeltaMs = next.busyMs - previous.busyMs;
  if (!(totalDeltaMs > 0) || busyDeltaMs < 0) {
    return null;
  }
  return roundMetric(Math.min(100, (busyDeltaMs / totalDeltaMs) * 100));
}

let previousCpuTimes: SystemCpuTimesSnapshot | null = null;

export const systemProcessResourceSampleSource: ProcessResourceSampleSource = {
  id: "system",
  sampleDevice(context) {
    const snapshot = summarizeSystemCpuTimes(os.cpus());
    const baseline = previousCpuTimes;
    previousCpuTimes = snapshot;

    if (!baseline || !context.appProcessTotals) {
      return;
    }
    const systemCpuPercent = diffSystemCpuPercent(baseline, snapshot);
    if (systemCpuPercent === null) {
      return;
    }

    const appTotals = addAppResourceTotals(
      context.appProcessTotals,
      collectExternalAppResourceTotals(context.now),
    );
    context.addDeviceSample({
      systemCpuPercent,
      systemFreeMemoryKb: Math.round(os.freemem() / 1024),
      appCpuPercent: appTotals.cpuPercent,
      appRssKbTotal: appTotals.rssKbTotal,
      appProcessCount: appTotals.processCount,
    });
  },
  reset() {
    previousCpuTimes = null;
    resetExternalAppResourceSamples();
  },
};
