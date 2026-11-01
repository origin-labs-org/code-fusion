

import {
  agentLaneResourceSampleSchema,
  resolveCliProcessResourceRole,
  CF_CLI_RESOURCE_SAMPLE_INTERVAL_MS,
  type AgentLaneResourceSample,
  type ProcessResourceRole,
  type ProcessResourceRuntimeSurface,
} from "@origin-ai/cf-shared";
import { recordExternalAppResourceSample } from "./processResourceExternalAppSamples.js";
import type {
  ProcessResourceSampleContext,
  ProcessResourceSampleSource,
} from "./processResourceSampleSources.js";
import {
  processResourceHardwareKey,
  type ProcessResourceHardwareOverride,
  type ProcessRoleSample,
} from "./processResourceWindowAggregator.js";
import { roundMetric } from "./resourceMetricsStats.js";

const PROCESS_RESOURCE_MAX_CLI_INSTANCES = 64;

const LEGACY_INSTANCE_KEY = "legacy";

interface StoredCliSample {
  role: ProcessResourceRole;
  runtimeSurface: ProcessResourceRuntimeSurface;
  environmentKey?: string;
  sample: AgentLaneResourceSample;
  
  receivedAt: number;
  
  delivered: boolean;
}

const latestSamplesByInstance = new Map<string, StoredCliSample>();

export function ingestCliResourceSample(
  raw: unknown,
  runtimeSurface: ProcessResourceRuntimeSurface,
  environmentKey?: string,
): void {
  const parsed = agentLaneResourceSampleSchema.safeParse(raw);
  if (!parsed.success) {
    return;
  }
  const sample = parsed.data;
  const role = resolveCliProcessResourceRole(sample.lane);
  const key = [
    role,
    runtimeSurface,
    environmentKey ?? "",
    sample.instanceToken ?? LEGACY_INSTANCE_KEY,
  ].join(":");
  if (
    !latestSamplesByInstance.has(key) &&
    latestSamplesByInstance.size >= PROCESS_RESOURCE_MAX_CLI_INSTANCES
  ) {
    return;
  }
  const receivedAt = Date.now();
  latestSamplesByInstance.set(key, {
    role,
    runtimeSurface,
    environmentKey,
    sample,
    receivedAt,
    delivered: false,
  });
  recordExternalAppResourceSample({
    sourceKey: `cli:${key}`,
    runtimeSurface,
    cpuPercent: sample.cpuPercent,
    rssKbTotal: sample.rssKb,
    processCount: 1,
    intervalMs: resolveSampleIntervalMs(sample),
    receivedAt,
  });
}

function resolveSampleIntervalMs(sample: AgentLaneResourceSample): number {
  return Math.max(CF_CLI_RESOURCE_SAMPLE_INTERVAL_MS, sample.intervalMs);
}

function resolveHardware(sample: AgentLaneResourceSample): ProcessResourceHardwareOverride {
  return {
    platform: sample.platform,
    arch: sample.arch,
    logicalCpuCount: sample.logicalCpuCount,
    ...(sample.totalMemoryGb === undefined ? {} : { totalMemoryGb: sample.totalMemoryGb }),
  };
}

function purgeExpired(now: number): void {
  for (const [key, entry] of latestSamplesByInstance) {
    if (now - entry.receivedAt > resolveSampleIntervalMs(entry.sample) * 2) {
      latestSamplesByInstance.delete(key);
    }
  }
}

interface CliRoleGroup {
  role: ProcessResourceRole;
  runtimeSurface: ProcessResourceRuntimeSurface;
  environmentKey?: string;
  
  hardware: ProcessResourceHardwareOverride;
  samples: AgentLaneResourceSample[];
  fresh: boolean;
}

function groupByRole(): CliRoleGroup[] {
  const groups = new Map<string, CliRoleGroup>();
  for (const entry of latestSamplesByInstance.values()) {
    const hardware = resolveHardware(entry.sample);
    const key = [
      entry.role,
      entry.runtimeSurface,
      entry.environmentKey ?? "",
      processResourceHardwareKey(hardware),
    ].join(":");
    const group = groups.get(key);
    if (group) {
      group.samples.push(entry.sample);
      group.fresh ||= !entry.delivered;
      continue;
    }
    groups.set(key, {
      role: entry.role,
      runtimeSurface: entry.runtimeSurface,
      environmentKey: entry.environmentKey,
      hardware,
      samples: [entry.sample],
      fresh: !entry.delivered,
    });
  }
  return [...groups.values()];
}

function projectRoleSample(group: CliRoleGroup): ProcessRoleSample {
  let cpuPercent = 0;
  let rssKbTotal = 0;
  let rssKbMaxProcess = 0;
  let uptimeMinutes = 0;
  let heapUsedKb: number | undefined;
  for (const sample of group.samples) {
    cpuPercent += sample.cpuPercent;
    rssKbTotal += sample.rssKb;
    rssKbMaxProcess = Math.max(rssKbMaxProcess, sample.rssKb);
    uptimeMinutes = Math.max(uptimeMinutes, sample.uptimeMinutes ?? 0);
    if (sample.heapUsedKb !== undefined) {
      heapUsedKb = Math.max(heapUsedKb ?? 0, sample.heapUsedKb);
    }
  }

  return {
    role: group.role,
    runtimeSurface: group.runtimeSurface,
    ...(group.environmentKey === undefined ? {} : { environmentKey: group.environmentKey }),
    cpuPercent: roundMetric(cpuPercent),
    rssKbTotal: roundMetric(rssKbTotal),
    rssKbMaxProcess: roundMetric(rssKbMaxProcess),
    processCount: group.samples.length,
    uptimeMinutes,
    ...(heapUsedKb === undefined ? {} : { heapUsedKb }),
    hardware: group.hardware,
  };
}

let lastDeliveredAt: number | null = null;

function hasUndeliveredReading(): boolean {
  for (const entry of latestSamplesByInstance.values()) {
    if (!entry.delivered) {
      return true;
    }
  }
  return false;
}

function deliverRoleSamples(context: ProcessResourceSampleContext): void {
  lastDeliveredAt = context.now;
  const groups = groupByRole();
  for (const entry of latestSamplesByInstance.values()) {
    entry.delivered = true;
  }
  for (const group of groups) {
    if (!group.fresh) continue;
    context.addRoleSample(projectRoleSample(group));
  }
}

export const cliProcessResourceSampleSource: ProcessResourceSampleSource = {
  id: "cli",
  sample(context) {
    purgeExpired(context.now);
    if (
      lastDeliveredAt !== null &&
      context.now - lastDeliveredAt < CF_CLI_RESOURCE_SAMPLE_INTERVAL_MS
    ) {
      return;
    }
    if (!hasUndeliveredReading()) {
      return;
    }
    deliverRoleSamples(context);
  },
  flushPending(context) {
    purgeExpired(context.now);
    if (!hasUndeliveredReading()) {
      return;
    }
    deliverRoleSamples(context);
  },
  reset() {
    latestSamplesByInstance.clear();
    lastDeliveredAt = null;
  },
};
