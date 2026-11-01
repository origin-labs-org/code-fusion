import type { Logger, McpPort } from "@origin-ai/cf-contracts";
import type { McpConnectionPool, McpTelemetryTracker } from "@origin-ai/cf-adapters/mcp";
import type { SqliteSessionStore } from "@origin-ai/cf-adapters/storage";
import { shutdownPreparedModelTelemetry } from "@origin-ai/cf-telemetry";
import { closeSessionStore } from "../app/session-store.js";
import type { NodeReplBrowserBroker } from "../app/node-repl-browser-broker.js";
import type { CfProcessResourceSampler } from "../process-resource-sampler.js";
import type { CfProtocolAgentServer } from "./server.js";

const DEFAULT_CLEANUP_BUDGET_MS = 1_200;
const CLEANUP_STEP_BUDGET_MS = 400;

export async function cleanupProtocolRuntime(options: {
  logger: Logger;
  deadlineAt?: number;
  server?: Pick<CfProtocolAgentServer, "shutdown" | "disposeProjections">;
  processResourceSampler?: Pick<CfProcessResourceSampler, "stop">;
  mcpTelemetryTracker?: Pick<McpTelemetryTracker, "stop">;
  nodeReplBrowserBroker?: Pick<NodeReplBrowserBroker, "close">;
  mcpPort?: Pick<McpPort, "close">;
  mcpConnectionPool?: Pick<McpConnectionPool, "close">;
  sessionStore?: SqliteSessionStore;
  providerRegistryRuntime?: { dispose(): unknown };
}): Promise<void> {
  const deadline = options.deadlineAt ?? Date.now() + DEFAULT_CLEANUP_BUDGET_MS;
  const step = async (resource: string, cleanup: () => unknown | Promise<unknown>) => {
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(cleanup),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Protocol cleanup timed out")),
            Math.max(0, Math.min(CLEANUP_STEP_BUDGET_MS, deadline - Date.now())),
          );
        }),
      ]);
    } catch (error) {
      options.logger.warn(`CodeFusion Protocol ${resource} shutdown failed`, {
        errorType: error instanceof Error ? error.name : typeof error,
        event: `cf_protocol.${resource}.shutdown.failed`,
        module: "bootstrap.cf_protocol",
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
  await Promise.all([
    step("sampler", () => options.processResourceSampler?.stop()),
    step("mcp_telemetry", () => options.mcpTelemetryTracker?.stop()),
  ]);
  await step("sessions", () => options.server?.shutdown());
  await step("projections", () => options.server?.disposeProjections());
  await Promise.all([
    step("node_repl_browser_broker", () => options.nodeReplBrowserBroker?.close()),
    step("mcp", () => options.mcpPort?.close()),
    step("mcp_pool", () => options.mcpConnectionPool?.close()),
  ]);
  await Promise.all([
    step("session_store", () => {
      if (options.sessionStore) closeSessionStore(options.sessionStore);
    }),
    step("provider_registry", () => options.providerRegistryRuntime?.dispose()),
    step("telemetry", () => shutdownPreparedModelTelemetry()),
  ]);
}
