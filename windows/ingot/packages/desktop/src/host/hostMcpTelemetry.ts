import type { IDisposable } from "@origin-ai/cf-rpc";
import type { ICfAgentService } from "@origin-ai/cf-services";
import type { ProcessResourceRuntimeSurface } from "@origin-ai/cf-shared";
import { HostResponseTypes } from "@origin-ai/cf-shared";

interface RegisterHostMcpTelemetryOptions {
  agentService: Pick<ICfAgentService, "onDynamicMcpTelemetry">;
  postMessage(message: unknown): void;
  runtimeSurface: ProcessResourceRuntimeSurface;
}

export function registerHostMcpTelemetry(options: RegisterHostMcpTelemetryOptions): IDisposable {
  return options.agentService.onDynamicMcpTelemetry()((event) => {
    try {
      options.postMessage({
        type: HostResponseTypes.McpTelemetry,
        runtimeSurface: options.runtimeSurface,
        event,
      });
    } catch {
    }
  });
}
