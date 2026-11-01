

import { HostResponseTypes } from "@origin-ai/cf-shared";
import {
  createNodeSelfResourceSampler,
  type NodeSelfResourceSamplerOptions,
} from "@origin-ai/cf-shared/node";
import {
  startHostMemoryDiagnosticsLog,
  type StartHostMemoryDiagnosticsLogOptions,
} from "./hostMemoryDiagnosticsLog.js";

export interface StartHostSelfResourceTelemetryOptions
  extends
    Omit<StartHostMemoryDiagnosticsLogOptions, "onMemoryUsage">,
    NodeSelfResourceSamplerOptions {
  
  postMessage?: ((message: unknown) => void) | undefined;
}

export interface HostSelfResourceTelemetry {
  
  sampleNow(): boolean;
  stop(): void;
}

export function startHostSelfResourceTelemetry(
  options: StartHostSelfResourceTelemetryOptions,
): HostSelfResourceTelemetry {
  const sampler = createNodeSelfResourceSampler(options);
  const postMessage = options.postMessage;

  return startHostMemoryDiagnosticsLog({
    logger: options.logger,
    collectCounters: options.collectCounters,
    readMemoryUsage: options.readMemoryUsage,
    now: options.now,
    intervalMs: options.intervalMs,
    timer: options.timer,
    onMemoryUsage: (memoryUsage) => {
      if (!postMessage) {
        return;
      }
      const sample = sampler.sample(memoryUsage);
      if (!sample) {
        return;
      }
      try {
        postMessage({ type: HostResponseTypes.HostResourceSample, sample });
      } catch {
      }
    },
  });
}
