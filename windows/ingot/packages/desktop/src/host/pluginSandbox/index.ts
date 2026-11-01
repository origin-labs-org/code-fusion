import { HostResponseTypes } from "@origin-ai/cf-shared";
import type {
  PluginSandboxHandle,
  PluginSandboxRegisterRequestPayload,
} from "@origin-ai/cf-shared/mcp-apps";
import { randomUUID } from "node:crypto";
import type { PluginSandboxRegistrationBridge } from "./contract.js";

export function createPluginSandboxRegistrationBridge(deps: {
  send(
    message: PluginSandboxRegisterRequestPayload & { type: "plugin-sandbox-register-request" },
  ): void;
  createRequestId?: () => string;
}): PluginSandboxRegistrationBridge {
  const pending = new Map<
    string,
    { resolve(handle: PluginSandboxHandle): void; reject(error: Error): void }
  >();
  let closed = false;
  return {
    register(input) {
      if (closed) return Promise.reject(new Error("Plugin sandbox registration bridge closed"));
      const requestId = (deps.createRequestId ?? randomUUID)();
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        try {
          deps.send({ type: HostResponseTypes.PluginSandboxRegisterRequest, requestId, ...input });
        } catch (error) {
          pending.delete(requestId);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    accept(result) {
      const request = pending.get(result.requestId);
      if (!request) return;
      pending.delete(result.requestId);
      if (
        result.ok &&
        result.instance &&
        result.sandboxId &&
        result.initId !== undefined &&
        result.shellUrl &&
        result.partition
      ) {
        request.resolve({
          instance: result.instance,
          sandboxId: result.sandboxId,
          initId: result.initId,
          shellUrl: result.shellUrl,
          partition: result.partition,
          ...(result.resourceMeta ? { resourceMeta: result.resourceMeta } : {}),
        });
      } else request.reject(new Error(result.error ?? "插件 UI 沙箱登记失败"));
    },
    dispose() {
      closed = true;
      for (const request of pending.values())
        request.reject(new Error("Plugin sandbox registration bridge closed"));
      pending.clear();
    },
  };
}
