

import {
  createNodeSelfResourceSampler,
  NODE_SELF_RESOURCE_SAMPLE_INTERVAL_MS,
  type NodeSelfResourceSamplerOptions,
} from "@origin-ai/cf-shared/node";
import type { SchedulerToMainMessage } from "./schedulerProtocol.js";

interface SchedulerResourceTelemetryTimerHandle {
  unref?(): void;
}

export interface StartSchedulerResourceTelemetryOptions extends NodeSelfResourceSamplerOptions {
  
  postMessage: (message: SchedulerToMainMessage) => void;
  readMemoryUsage?: () => NodeJS.MemoryUsage;
  intervalMs?: number;
  timer?: {
    setInterval(callback: () => void, intervalMs: number): SchedulerResourceTelemetryTimerHandle;
    clearInterval(handle: SchedulerResourceTelemetryTimerHandle): void;
  };
}

export interface SchedulerResourceTelemetry {
  stop(): void;
}

export function startSchedulerResourceTelemetry(
  options: StartSchedulerResourceTelemetryOptions,
): SchedulerResourceTelemetry {
  const sampler = createNodeSelfResourceSampler(options);
  const readMemoryUsage = options.readMemoryUsage ?? (() => process.memoryUsage());
  const timer = options.timer ?? {
    setInterval: (callback: () => void, intervalMs: number) => setInterval(callback, intervalMs),
    clearInterval: (handle: SchedulerResourceTelemetryTimerHandle) =>
      clearInterval(handle as ReturnType<typeof setInterval>),
  };

  const sampleNow = (): void => {
    try {
      const sample = sampler.sample(readMemoryUsage());
      if (!sample) {
        return;
      }
      options.postMessage({ type: "scheduler-resource-sample", sample });
    } catch {
    }
  };

  let handle: SchedulerResourceTelemetryTimerHandle | undefined = timer.setInterval(
    sampleNow,
    options.intervalMs ?? NODE_SELF_RESOURCE_SAMPLE_INTERVAL_MS,
  );
  try {
    handle.unref?.();
  } catch {
  }

  return {
    stop() {
      if (!handle) {
        return;
      }
      const current = handle;
      handle = undefined;
      try {
        timer.clearInterval(current);
      } catch {
      }
    },
  };
}
