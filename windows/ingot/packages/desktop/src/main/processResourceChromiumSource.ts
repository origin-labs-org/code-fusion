

import { app, type ProcessMetric } from "electron";
import os from "node:os";
import { normalizeElectronCpuToMachinePercent } from "./electronCpuNormalization.js";
import {
  aggregateChromiumProcessRoles,
  sumChromiumRoleAggregates,
  type ChromiumProcessMetricSample,
} from "./processResourceRoleClassifier.js";
import { collectChromiumProcessRolePids } from "./resourceManagerWindow.js";
import type { ProcessResourceSampleSource } from "./processResourceSampleSources.js";

function toNormalizedSample(
  metric: ProcessMetric,
  logicalCpuCount: number,
): ChromiumProcessMetricSample {
  return {
    pid: metric.pid,
    type: metric.type,
    cpuPercent: normalizeElectronCpuToMachinePercent(metric.cpu.percentCPUUsage, {
      logicalCpuCount,
    }),
    rssKb: metric.memory.workingSetSize ?? 0,
    creationTime: metric.creationTime,
  };
}

export const chromiumProcessResourceSampleSource: ProcessResourceSampleSource = {
  id: "chromium",
  sample(context) {
    const metrics = app.getAppMetrics();
    const logicalCpuCount = os.cpus().length;
    const aggregates = aggregateChromiumProcessRoles({
      processes: metrics.map((metric) => toNormalizedSample(metric, logicalCpuCount)),
      pids: collectChromiumProcessRolePids(),
      now: context.now,
    });

    for (const aggregate of aggregates) {
      context.addRoleSample(aggregate);
    }
    context.addAppProcessTotals(sumChromiumRoleAggregates(aggregates));
  },
};
