import { contextBridge, ipcRenderer } from "electron";
import { InternalChannels, PlatformChannels } from "@origin-ai/cf-shared";
import type { PluginSandboxCaptureRequest } from "@origin-ai/cf-shared/mcp-apps";
import { enableSandboxRetainedMoves } from "./retainedMoves.js";

export function installPluginSandboxHostBridge(): void {
  const supportsRetainedMove =
    contextBridge.executeInMainWorld({ func: enableSandboxRetainedMoves }) === true;
  
  contextBridge.exposeInMainWorld("cfPluginSandbox", {
    supportsRetainedMove,
    setExecutionActive: (sandboxId: string, initId: number, active: boolean) =>
      ipcRenderer.invoke(
        PlatformChannels.PluginSandboxExecutionActive,
        sandboxId,
        initId,
        active,
      ) as Promise<void>,
    copyImage: (input: PluginSandboxCaptureRequest) =>
      ipcRenderer.invoke(PlatformChannels.PluginSandboxCopyImage, input) as Promise<void>,
    getOwnerWebContentsId: () =>
      ipcRenderer.invoke(PlatformChannels.PluginSandboxOwnerWebContentsId) as Promise<number>,
    disposeSandbox: (sandboxId: string, initId?: number) =>
      ipcRenderer.invoke(PlatformChannels.PluginSandboxDispose, sandboxId, initId) as Promise<void>,
    consumeUserGesture: (sandboxId: string) =>
      ipcRenderer.invoke(
        PlatformChannels.PluginSandboxConsumeUserGesture,
        sandboxId,
      ) as Promise<boolean>,
  });

  ipcRenderer.on(
    InternalChannels.PluginSandboxPorts,
    (event, payload: { sandboxId?: unknown; initId?: unknown }) => {
      if (typeof payload?.sandboxId !== "string" || typeof payload?.initId !== "number") {
        return;
      }
      window.postMessage(
        {
          type: InternalChannels.PluginSandboxPorts,
          sandboxId: payload.sandboxId,
          initId: payload.initId,
        },
        "*",
        event.ports,
      );
    },
  );
}
