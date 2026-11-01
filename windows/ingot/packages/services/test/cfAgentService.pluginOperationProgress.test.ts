import { describe, expect, it, vi } from "vitest";
import {
  cfProtocolMethods,
  cfProtocolNotifications,
  type CfPluginOperationProgressNotification,
} from "@origin-ai/cf-shared";

describe("cfAgentService Plugin operation progress", () => {
  it("projects a validated Agent progress notification by operationId", async () => {
    let notificationListener:
      | ((notification: { method: string; params?: unknown }) => void)
      | null = null;
    const request = vi.fn(async (method: string) => {
      if (method !== cfProtocolMethods.pluginsResolveSuggestedReference) {
        throw new Error(`Unexpected request method: ${method}`);
      }
      notificationListener?.({
        method: cfProtocolNotifications.pluginOperationProgress,
        params: { operationId: "suggested-progress", state: "refreshing" },
      });
      return {
        stableId: "document-skills@cf-plugins-official",
        status: "missing",
        marketplace: "cf-plugins-official",
        pluginName: "document-skills",
        sourceTrust: "official",
        diagnostics: [],
      };
    });

    vi.resetModules();
    vi.doMock("../src/cf-agent/cfAgentProcessManager.js", () => ({
      CfAgentProcessManager: class {
        onRuntimeLifecycle() {
          return { dispose() {} };
        }
        onRuntimeRestarted() {
          return { dispose() {} };
        }
        async getClient() {
          return {
            request,
            transportKind: "stdio",
            onNotification: (
              listener: (notification: { method: string; params?: unknown }) => void,
            ) => {
              notificationListener = listener;
              return { dispose() {} };
            },
            onRequest: () => ({ dispose() {} }),
            onClose: () => ({ dispose() {} }),
          };
        }
        disposeAll() {}
        async disposeAllAndWait() {}
      },
    }));
    const { createCfAgentService } = await import("../src/cf-agent/cfAgentService.js");
    const service = createCfAgentService();
    const received: CfPluginOperationProgressNotification[] = [];
    const subscription = service.onDynamicPluginOperationProgress("suggested-progress")((event) =>
      received.push(event),
    );

    try {
      await service.resolveSuggestedPluginReference({
        workspacePath: "/workspace",
        stableId: "document-skills@cf-plugins-official",
        operationId: "suggested-progress",
        clientMode: "desktop-continuous",
        deliveryKind: "desktop-continuous",
      });

      expect(received).toEqual([{ operationId: "suggested-progress", state: "refreshing" }]);

      notificationListener?.({
        method: cfProtocolNotifications.pluginOperationProgress,
        params: {
          operationId: "suggested-progress",
          state: "refreshing",
          unexpected: true,
        },
      });
      expect(received).toHaveLength(1);
    } finally {
      subscription.dispose();
      await service.disposeAllAndWait();
    }
  });
});
