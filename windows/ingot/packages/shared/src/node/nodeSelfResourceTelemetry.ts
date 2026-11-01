

import { availableParallelism } from "node:os";
import { bytesToKb } from "../memoryDiagnostics.js";
import type { NodeSelfResourceSample } from "../validation.js";

interface NodeCpuUsageSnapshot {
  user: number;
  system: number;
}

export const NODE_SELF_RESOURCE_SAMPLE_INTERVAL_MS = 60_000;

export interface NodeSelfResourceSamplerOptions {
  readCpuUsage?: () => NodeCpuUsageSnapshot;
  readMonotonicTimeNs?: () => bigint;
  logicalCpuCount?: number;
}

export interface NodeSelfResourceSampler {
  
  sample(memoryUsage: NodeJS.MemoryUsage): NodeSelfResourceSample | null;
}

interface SamplerBaseline {
  cpu: NodeCpuUsageSnapshot;
  monotonicTimeNs: bigint;
}

function roundResourceMetric(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function createNodeSelfResourceSampler(
  options: NodeSelfResourceSamplerOptions = {},
): NodeSelfResourceSampler {
  const readCpuUsage = options.readCpuUsage ?? (() => process.cpuUsage());
  const readMonotonicTimeNs = options.readMonotonicTimeNs ?? (() => process.hrtime.bigint());
  const logicalCpuCount = Math.max(
    1,
    Math.min(4_096, Math.trunc(options.logicalCpuCount ?? availableParallelism())),
  );

  const readBaseline = (): SamplerBaseline | null => {
    try {
      return { cpu: readCpuUsage(), monotonicTimeNs: readMonotonicTimeNs() };
    } catch {
      return null;
    }
  };

  let baseline = readBaseline();

  return {
    sample(memoryUsage) {
      const next = readBaseline();
      if (!next) {
        return null;
      }
      const previous = baseline;
      baseline = next;
      if (!previous) {
        return null;
      }

      const elapsedNs = next.monotonicTimeNs - previous.monotonicTimeNs;
      const cpuDeltaUs =
        next.cpu.user - previous.cpu.user + (next.cpu.system - previous.cpu.system);
      if (elapsedNs <= 0n || cpuDeltaUs < 0) {
        return null;
      }

      const cpuCores = cpuDeltaUs / (Number(elapsedNs) / 1_000);
      return {
        cpuPercent: roundResourceMetric((cpuCores / logicalCpuCount) * 100),
        rssKb: bytesToKb(memoryUsage.rss),
        heapUsedKb: bytesToKb(memoryUsage.heapUsed),
      };
    },
  };
}
