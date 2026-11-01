

import type { ProcessResourceRole } from "@origin-ai/cf-shared";
import {
  addAppResourceTotals,
  createEmptyAppResourceTotals,
  type AppResourceTotals,
} from "./processResourceAppTotals.js";
import { roundMetric } from "./resourceMetricsStats.js";

export const CHROMIUM_PROCESS_RESOURCE_ROLES = [
  "main",
  "renderer_main",
  "renderer_guest",
  "gpu",
  "chromium_other",
  "host",
  "scheduler",
] as const satisfies readonly ProcessResourceRole[];

export type ChromiumProcessResourceRole = (typeof CHROMIUM_PROCESS_RESOURCE_ROLES)[number];

export interface ChromiumProcessMetricSample {
  pid: number;
  type: string;
  cpuPercent: number;
  rssKb: number;
  
  creationTime?: number;
}

export interface ChromiumProcessRolePids {
  mainPid: number;
  mainWindowRendererPids: ReadonlySet<number>;
  guestRendererPids: ReadonlySet<number>;
  hostPids: ReadonlySet<number>;
  schedulerPids: ReadonlySet<number>;
}

export interface ChromiumRoleAggregate {
  role: ChromiumProcessResourceRole;
  
  cpuPercent: number;
  rssKbTotal: number;
  rssKbMaxProcess: number;
  processCount: number;
  
  uptimeMinutes: number;
}

export function sumChromiumRoleAggregates(
  aggregates: readonly ChromiumRoleAggregate[],
): AppResourceTotals {
  let totals = createEmptyAppResourceTotals();
  for (const aggregate of aggregates) {
    totals = addAppResourceTotals(totals, {
      cpuPercent: aggregate.cpuPercent,
      rssKbTotal: aggregate.rssKbTotal,
      processCount: aggregate.processCount,
    });
  }
  return totals;
}

export function classifyChromiumProcessRole(
  sample: Pick<ChromiumProcessMetricSample, "pid" | "type">,
  pids: ChromiumProcessRolePids,
): ChromiumProcessResourceRole {
  if (sample.pid === pids.mainPid) {
    return "main";
  }
  if (sample.type === "GPU") {
    return "gpu";
  }
  if (pids.mainWindowRendererPids.has(sample.pid)) {
    return "renderer_main";
  }
  if (pids.guestRendererPids.has(sample.pid)) {
    return "renderer_guest";
  }
  if (pids.hostPids.has(sample.pid)) {
    return "host";
  }
  if (pids.schedulerPids.has(sample.pid)) {
    return "scheduler";
  }
  return "chromium_other";
}

function uptimeMinutesOf(sample: ChromiumProcessMetricSample, now: number): number {
  const creationTime = sample.creationTime;
  if (typeof creationTime !== "number" || !Number.isFinite(creationTime) || creationTime <= 0) {
    return 0;
  }
  return Math.max(0, Math.round((now - creationTime) / 60_000));
}

export function aggregateChromiumProcessRoles(input: {
  processes: readonly ChromiumProcessMetricSample[];
  pids: ChromiumProcessRolePids;
  now: number;
}): ChromiumRoleAggregate[] {
  const byRole = new Map<ChromiumProcessResourceRole, ChromiumRoleAggregate>();

  for (const sample of input.processes) {
    const role = classifyChromiumProcessRole(sample, input.pids);
    const existing = byRole.get(role);
    const uptimeMinutes = uptimeMinutesOf(sample, input.now);
    if (!existing) {
      byRole.set(role, {
        role,
        cpuPercent: sample.cpuPercent,
        rssKbTotal: sample.rssKb,
        rssKbMaxProcess: sample.rssKb,
        processCount: 1,
        uptimeMinutes,
      });
      continue;
    }
    existing.cpuPercent += sample.cpuPercent;
    existing.rssKbTotal += sample.rssKb;
    existing.rssKbMaxProcess = Math.max(existing.rssKbMaxProcess, sample.rssKb);
    existing.processCount += 1;
    existing.uptimeMinutes = Math.max(existing.uptimeMinutes, uptimeMinutes);
  }

  return CHROMIUM_PROCESS_RESOURCE_ROLES.map((role) => byRole.get(role))
    .filter((aggregate): aggregate is ChromiumRoleAggregate => aggregate !== undefined)
    .map((aggregate) => ({ ...aggregate, cpuPercent: roundMetric(aggregate.cpuPercent) }));
}
