
import {
  cfMcpResourceSamplesSchema,
  CF_MCP_RESOURCE_SAMPLE_INTERVAL_MS,
  type CfMcpResourceSample,
  type ProcessResourceRuntimeSurface,
} from "@origin-ai/cf-shared";
import { logger } from "./logger.js";
import { recordExternalAppResourceSample } from "./processResourceExternalAppSamples.js";
import type {
  ProcessResourceSampleContext,
  ProcessResourceSampleSource,
} from "./processResourceSampleSources.js";
import {
  processResourceHardwareKey,
  type ProcessRoleSample,
} from "./processResourceWindowAggregator.js";

const MAX_MCP_GROUPS_PER_WINDOW = 32;
const MAX_MCP_INSTANCE_SAMPLES = 256;
interface StoredSample {
  sample: CfMcpResourceSample;
  runtimeSurface: ProcessResourceRuntimeSurface;
  environmentKey?: string;
  receivedAt: number;
  delivered: boolean;
}
const latest = new Map<string, StoredSample>();

function purgeExpired(now: number): void {
  for (const [key, entry] of latest) {
    if (now - entry.receivedAt > CF_MCP_RESOURCE_SAMPLE_INTERVAL_MS * 2) latest.delete(key);
  }
}

export function ingestMcpResourceSamples(
  raw: unknown,
  runtimeSurface: ProcessResourceRuntimeSurface,
  environmentKey?: string,
): void {
  const parsed = cfMcpResourceSamplesSchema.safeParse(raw);
  if (!parsed.success) return;
  const receivedAt = Date.now();
  purgeExpired(receivedAt);
  for (const sample of parsed.data) {
    const key = JSON.stringify([
      runtimeSurface,
      environmentKey ?? "",
      sample.instanceToken,
      sample.mcpId,
    ]);
    const previous = latest.get(key);
    if (previous && previous.sample.sampledAt >= sample.sampledAt) continue;
    if (!previous && latest.size >= MAX_MCP_INSTANCE_SAMPLES) {
      logger.debug("[resource] MCP instance samples reached limit; discarding new samples");
      continue;
    }
    latest.set(key, { sample, runtimeSurface, environmentKey, receivedAt, delivered: false });
  }
}

function groupSamples(): Map<
  string,
  { role: ProcessRoleSample; fresh: boolean; receivedAt: number }
> {
  const groups = new Map<string, { role: ProcessRoleSample; fresh: boolean; receivedAt: number }>();
  for (const entry of latest.values()) {
    const { sample, runtimeSurface, environmentKey } = entry;
    const hardware = {
      platform: sample.platform,
      arch: sample.arch,
      logicalCpuCount: sample.logicalCpuCount,
      totalMemoryGb: sample.totalMemoryGb,
    };
    const key = JSON.stringify([
      runtimeSurface,
      environmentKey ?? "",
      sample.mcpId,
      processResourceHardwareKey(hardware),
    ]);
    let group = groups.get(key);
    if (!group) {
      group = {
        role: {
          role: "mcp",
          mcpId: sample.mcpId,
          runtimeSurface,
          ...(environmentKey === undefined ? {} : { environmentKey }),
          hardware,
          cpuPercent: 0,
          rssKbTotal: 0,
          rssKbMaxProcess: 0,
          processCount: 0,
          uptimeMinutes: 0,
        },
        fresh: false,
        receivedAt: 0,
      };
      groups.set(key, group);
    }
    group.fresh ||= !entry.delivered;
    group.receivedAt = Math.max(group.receivedAt, entry.receivedAt);
    group.role.cpuPercent +=
      (sample.cpuTimeMsDelta / sample.intervalMs / sample.logicalCpuCount) * 100;
    group.role.rssKbTotal += sample.rssKbTotal;
    group.role.rssKbMaxProcess = Math.max(group.role.rssKbMaxProcess, sample.rssKbMaxProcess);
    group.role.processCount += sample.processCount;
    group.role.uptimeMinutes = Math.max(group.role.uptimeMinutes, sample.uptimeMinutes);
  }
  return groups;
}

export const mcpProcessResourceSampleSource: ProcessResourceSampleSource = {
  id: "mcp",
  sample(context) {
    purgeExpired(context.now);
    for (const [key, group] of groupSamples()) {
      recordExternalAppResourceSample({
        sourceKey: `mcp:${key}`,
        runtimeSurface: group.role.runtimeSurface ?? "local",
        cpuPercent: group.role.cpuPercent,
        rssKbTotal: group.role.rssKbTotal,
        processCount: group.role.processCount,
        intervalMs: CF_MCP_RESOURCE_SAMPLE_INTERVAL_MS,
        receivedAt: group.receivedAt,
      });
    }
  },
  flushPending(context: ProcessResourceSampleContext) {
    purgeExpired(context.now);
    let reported = 0;
    for (const group of groupSamples().values()) {
      if (!group.fresh) continue;
      if (reported >= MAX_MCP_GROUPS_PER_WINDOW) {
        logger.debug("[resource] MCP allows up to 32 groups per window; discarding excess samples");
        continue;
      }
      context.addRoleSample(group.role);
      reported += 1;
    }
    for (const entry of latest.values()) entry.delivered = true;
  },
  reset() {
    latest.clear();
  },
};
