import { registerHostToolExecResourceTelemetry } from "./hostToolExecResourceTelemetry.js";
import { registerHostMcpResourceTelemetry } from "./hostMcpResourceTelemetry.js";
import type { IDisposable } from "@origin-ai/cf-rpc";
import { ICfAgentService, type ServiceCollection } from "@origin-ai/cf-services";
import type { ProcessResourceRuntimeSurface } from "@origin-ai/cf-shared";
import { registerHostAgentResourceTelemetry } from "./hostAgentResourceTelemetry.js";
import { registerHostMcpTelemetry } from "./hostMcpTelemetry.js";

interface RegisterHostServiceResourceTelemetryOptions {
  services: Pick<ServiceCollection, "getOptional">;
  postMessage(message: unknown): void;
  runtimeSurface: ProcessResourceRuntimeSurface;
  
  telemetrySupported?: boolean;
  
  environmentKey?: string;
  onError?(error: unknown): void;
}

const NO_TELEMETRY: IDisposable = { dispose() {} };

function disposeAll(registrations: IDisposable[]): void {
  while (registrations.length > 0) {
    try {
      registrations.pop()?.dispose();
    } catch {
    }
  }
}

export function registerHostServiceResourceTelemetry(
  options: RegisterHostServiceResourceTelemetryOptions,
): IDisposable {
  if (options.telemetrySupported === false) {
    return NO_TELEMETRY;
  }
  const agentService = options.services.getOptional(ICfAgentService);
  if (!agentService) {
    return NO_TELEMETRY;
  }
  const registrations: IDisposable[] = [];
  try {
    registrations.push(
      registerHostAgentResourceTelemetry({
        agentService,
        postMessage: options.postMessage,
        runtimeSurface: options.runtimeSurface,
        environmentKey: options.environmentKey,
      }),
    );
    registrations.push(
      registerHostMcpTelemetry({
        agentService,
        postMessage: options.postMessage,
        runtimeSurface: options.runtimeSurface,
      }),
    );
    registrations.push(
      registerHostMcpResourceTelemetry({
        agentService,
        postMessage: options.postMessage,
        runtimeSurface: options.runtimeSurface,
        environmentKey: options.environmentKey,
      }),
    );
    registrations.push(
      registerHostToolExecResourceTelemetry({
        agentService,
        postMessage: options.postMessage,
        runtimeSurface: options.runtimeSurface,
      }),
    );
  } catch (error) {
    disposeAll(registrations);
    options.onError?.(error);
    return NO_TELEMETRY;
  }
  let disposed = false;
  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      disposeAll(registrations);
    },
  };
}
