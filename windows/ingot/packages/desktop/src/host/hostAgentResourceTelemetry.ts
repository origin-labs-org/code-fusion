import type { IDisposable } from "@origin-ai/cf-rpc";
import type { ICfAgentService } from "@origin-ai/cf-services";
import type { ProcessResourceRuntimeSurface } from "@origin-ai/cf-shared";
import { HostResponseTypes } from "@origin-ai/cf-shared";

interface RegisterHostAgentResourceTelemetryOptions {
  agentService: Pick<ICfAgentService, "onDynamicProcessResourceSample">;
  postMessage(message: unknown): void;
  runtimeSurface: ProcessResourceRuntimeSurface;
  environmentKey?: string;
}

export function registerHostAgentResourceTelemetry(
  options: RegisterHostAgentResourceTelemetryOptions,
): IDisposable {
  return options.agentService.onDynamicProcessResourceSample()((sample) => {
    try {
      options.postMessage({
        type: HostResponseTypes.AgentResourceSample,
        runtimeSurface: options.runtimeSurface,
        ...(options.environmentKey === undefined ? {} : { environmentKey: options.environmentKey }),
        sample,
      });
    } catch {
    }
  });
}
