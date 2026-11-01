import { ipcRenderer } from "electron";
import { PluginSandboxChannels } from "@origin-ai/cf-shared";

const PLUGIN_SANDBOX_SCHEME = "cf-sandbox:";

if (window.location.protocol === PLUGIN_SANDBOX_SCHEME && window.top === window) {
  ipcRenderer.on(
    PluginSandboxChannels.Init,
    (event, payload: { sandboxId?: unknown; initId?: unknown; allow?: unknown }) => {
      if (
        typeof payload?.sandboxId !== "string" ||
        typeof payload?.initId !== "number" ||
        event.ports.length !== 1
      ) {
        return;
      }
      window.postMessage(
        {
          type: "init",
          sandboxId: payload.sandboxId,
          initId: payload.initId,
          ...(typeof payload.allow === "string" ? { allow: payload.allow } : {}),
        },
        window.location.origin,
        event.ports,
      );
    },
  );
}
