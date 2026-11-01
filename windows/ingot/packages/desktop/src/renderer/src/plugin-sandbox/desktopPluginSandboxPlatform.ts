import { InternalChannels } from "@origin-ai/cf-shared";
import type {
  PluginSandboxPlatformPort,
  PluginSandboxPortsEvent,
  PluginSandboxTransportPort,
} from "@origin-ai/cf-shared/mcp-apps";

export function createDesktopPluginSandboxPlatform(): PluginSandboxPlatformPort | undefined {
  const bridge = window.cfPluginSandbox;
  if (!bridge) return undefined;
  return {
    supportsRetainedMove: bridge.supportsRetainedMove,
    ...(bridge.setExecutionActive ? { setExecutionActive: bridge.setExecutionActive } : {}),
    ...(bridge.copyImage
      ? {
          copyImage: (input: import("@origin-ai/cf-shared/mcp-apps").PluginSandboxCaptureRequest) =>
            bridge.copyImage!(input),
        }
      : {}),
    getOwnerWebContentsId: () => bridge.getOwnerWebContentsId(),
    disposeSandbox: (sandboxId, initId) => bridge.disposeSandbox(sandboxId, initId),
    consumeUserGesture: (sandboxId) => bridge.consumeUserGesture(sandboxId),
    onPorts(handler) {
      const listener = (event: MessageEvent) => {
        const parsed = parsePluginSandboxPortsMessage(event);
        if (parsed) handler(parsed);
      };
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    },
  };
}

export function parsePluginSandboxPortsMessage(event: {
  source?: unknown;
  data: unknown;
  ports: readonly MessagePort[];
}): PluginSandboxPortsEvent | null {
  if (event.source !== undefined && event.source !== window) return null;
  const data = event.data as { type?: unknown; sandboxId?: unknown; initId?: unknown };
  const port = event.ports[0];
  if (
    typeof data !== "object" ||
    data === null ||
    data.type !== InternalChannels.PluginSandboxPorts ||
    typeof data.sandboxId !== "string" ||
    typeof data.initId !== "number" ||
    !port ||
    event.ports.length !== 1
  ) {
    return null;
  }
  return {
    sandboxId: data.sandboxId,
    initId: data.initId,
    port: port as PluginSandboxTransportPort,
  };
}
