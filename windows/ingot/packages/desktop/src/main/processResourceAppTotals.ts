

import { roundMetric } from "./resourceMetricsStats.js";

export interface AppResourceTotals {
  
  cpuPercent: number;
  rssKbTotal: number;
  processCount: number;
}

export function createEmptyAppResourceTotals(): AppResourceTotals {
  return { cpuPercent: 0, rssKbTotal: 0, processCount: 0 };
}

export function addAppResourceTotals(
  base: AppResourceTotals,
  extra: AppResourceTotals,
): AppResourceTotals {
  return {
    cpuPercent: roundMetric(base.cpuPercent + extra.cpuPercent),
    rssKbTotal: base.rssKbTotal + extra.rssKbTotal,
    processCount: base.processCount + extra.processCount,
  };
}
