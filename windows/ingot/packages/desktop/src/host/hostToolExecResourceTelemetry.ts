import type { IDisposable } from "@origin-ai/cf-rpc";
import type { ICfAgentService } from "@origin-ai/cf-services";
import { HostResponseTypes, type ProcessResourceRuntimeSurface } from "@origin-ai/cf-shared";

export function registerHostToolExecResourceTelemetry(options: {
  agentService: Pick<ICfAgentService, "onDynamicToolExecResource">;
  postMessage(message: unknown): void;
  runtimeSurface: ProcessResourceRuntimeSurface;
}): IDisposable {
  return options.agentService.onDynamicToolExecResource()((sample) => {
    try {
      options.postMessage({
        type: HostResponseTypes.ToolExecResource,
        runtimeSurface: options.runtimeSurface,
        sample,
      });
    } catch {
    }
  });
}
