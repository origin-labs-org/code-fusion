import { randomBytes } from "node:crypto";
import { availableParallelism, totalmem } from "node:os";
import {
  CF_CLI_RESOURCE_SAMPLE_INTERVAL_MS,
  type CfProcessResourceSample,
} from "@origin-ai/cf-shared";

export const CF_PROCESS_RESOURCE_SAMPLE_INTERVAL_MS = CF_CLI_RESOURCE_SAMPLE_INTERVAL_MS;

let processInstanceToken: string | undefined;

function resolveProcessInstanceToken(): string {
  processInstanceToken ??= randomBytes(8).toString("hex");
  return processInstanceToken;
}

interface CpuUsageSnapshot {
  user: number;
  system: number;
}

export interface ProcessMemoryUsageSnapshot {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

interface ResourceSamplerTimerHandle {
  unref?(): void;
}

interface ResourceSamplerTimer {
  setInterval(callback: () => void, intervalMs: number): ResourceSamplerTimerHandle;
  clearInterval(handle: ResourceSamplerTimerHandle): void;
}

interface CreateCfProcessResourceSamplerOptions {
  
  onSample(sample: CfProcessResourceSample, memoryUsage: ProcessMemoryUsageSnapshot): void;
  platform?: CfProcessResourceSample["platform"];
  arch?: CfProcessResourceSample["arch"];
  logicalCpuCount?: number;
  readCpuUsage?: () => CpuUsageSnapshot;
  readMonotonicTimeNs?: () => bigint;
  readMemoryUsage?: () => ProcessMemoryUsageSnapshot;
  
  readTotalMemoryBytes?: () => number;
  
  readUptimeSeconds?: () => number;
  
  instanceToken?: string;
  timer?: ResourceSamplerTimer;
}

export interface CfProcessResourceSampler {
  start(): void;
  stop(): void;
}

interface ResourceSamplerBaseline {
  cpu: CpuUsageSnapshot;
  monotonicTimeNs: bigint;
}

const defaultTimer: ResourceSamplerTimer = {
  setInterval(callback, intervalMs) {
    return setInterval(callback, intervalMs);
  },
  clearInterval(handle) {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
};

function roundResourceMetric(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function toRoundedUnit(value: number, divisor: number): number | undefined {
  return Number.isFinite(value) && value >= 0 ? Math.round(value / divisor) : undefined;
}

export function createCfProcessResourceSampler(
  options: CreateCfProcessResourceSamplerOptions,
): CfProcessResourceSampler {
  const platform = options.platform ?? (process.platform as CfProcessResourceSample["platform"]);
  const arch = options.arch ?? (process.arch as CfProcessResourceSample["arch"]);
  const logicalCpuCount = Math.max(
    1,
    Math.min(4_096, Math.trunc(options.logicalCpuCount ?? availableParallelism())),
  );
  const readCpuUsage = options.readCpuUsage ?? (() => process.cpuUsage());
  const readMonotonicTimeNs = options.readMonotonicTimeNs ?? (() => process.hrtime.bigint());
  const readMemoryUsage = options.readMemoryUsage ?? (() => process.memoryUsage());
  const readUptimeSeconds = options.readUptimeSeconds ?? (() => process.uptime());
  const instanceToken = options.instanceToken ?? resolveProcessInstanceToken();
  const totalMemoryGb = toRoundedUnit(
    (options.readTotalMemoryBytes ?? (() => totalmem()))(),
    1024 ** 3,
  );
  const timer = options.timer ?? defaultTimer;
  let baseline: ResourceSamplerBaseline | undefined;
  let timerHandle: ResourceSamplerTimerHandle | undefined;

  const readBaseline = (): ResourceSamplerBaseline => ({
    cpu: readCpuUsage(),
    monotonicTimeNs: readMonotonicTimeNs(),
  });

  const sample = (): void => {
    try {
      const nextBaseline = readBaseline();
      if (!baseline) {
        baseline = nextBaseline;
        return;
      }
      const elapsedNs = nextBaseline.monotonicTimeNs - baseline.monotonicTimeNs;
      const cpuDeltaUs =
        nextBaseline.cpu.user - baseline.cpu.user + (nextBaseline.cpu.system - baseline.cpu.system);
      if (elapsedNs <= 0n || cpuDeltaUs < 0) {
        baseline = nextBaseline;
        return;
      }
      const intervalMs = Math.round(Number(elapsedNs) / 1_000_000);
      if (intervalMs <= 0) {
        baseline = nextBaseline;
        return;
      }
      const cpuCores = cpuDeltaUs / (Number(elapsedNs) / 1_000);
      const memoryUsage = readMemoryUsage();
      const rssKb = memoryUsage.rss / 1_024;
      const uptimeMinutes = toRoundedUnit(readUptimeSeconds(), 60);
      baseline = nextBaseline;
      const resourceSample: CfProcessResourceSample = {
        platform,
        arch,
        logicalCpuCount,
        intervalMs,
        cpuCores: roundResourceMetric(cpuCores),
        cpuPercent: roundResourceMetric((cpuCores / logicalCpuCount) * 100),
        rssKb: roundResourceMetric(rssKb),
        heapUsedKb: roundResourceMetric(memoryUsage.heapUsed / 1_024),
        instanceToken,
        ...(uptimeMinutes === undefined ? {} : { uptimeMinutes }),
        ...(totalMemoryGb === undefined ? {} : { totalMemoryGb }),
      };
      try {
        options.onSample(resourceSample, memoryUsage);
      } catch {
      }
    } catch {
    }
  };

  return {
    start() {
      if (timerHandle) {
        return;
      }
      try {
        baseline = readBaseline();
      } catch {
        baseline = undefined;
      }
      try {
        timerHandle = timer.setInterval(sample, CF_PROCESS_RESOURCE_SAMPLE_INTERVAL_MS);
      } catch {
        timerHandle = undefined;
        return;
      }
      try {
        timerHandle.unref?.();
      } catch {
      }
    },
    stop() {
      if (!timerHandle) {
        return;
      }
      const handle = timerHandle;
      timerHandle = undefined;
      baseline = undefined;
      try {
        timer.clearInterval(handle);
      } catch {
      }
    },
  };
}
