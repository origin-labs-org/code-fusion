import type { IDisposable } from "@origin-ai/cf-rpc";
import type { ICfAgentService } from "@origin-ai/cf-services";
import { HostResponseTypes, type ProcessResourceRuntimeSurface } from "@origin-ai/cf-shared";

export function registerHostMcpResourceTelemetry(options: {
  agentService: Pick<ICfAgentService, "onDynamicMcpResourceSamples">;
  postMessage(message: unknown): void;
  runtimeSurface: ProcessResourceRuntimeSurface;
  environmentKey?: string;
}): IDisposable {
  return options.agentService.onDynamicMcpResourceSamples()((samples) => {
    try {
      options.postMessage({
        type: HostResponseTypes.McpResourceSamples,
        runtimeSurface: options.runtimeSurface,
        ...(options.environmentKey === undefined ? {} : { environmentKey: options.environmentKey }),
        samples,
      });
    } catch {
    }
  });
}
