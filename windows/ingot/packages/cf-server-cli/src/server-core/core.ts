import { hostname } from "node:os";
import {
  createServerHostServices,
  disposeServiceResourcesAndWait,
  materializeCfBuiltinProviderConfig,
  getAppConfigDir,
  CF_BUILTIN_PROVIDER_CONFIG_FILE_ENV,
  createTopicResourcePeers,
} from "@origin-ai/cf-services/node";
import { ICfAgentService } from "@origin-ai/cf-services";
import { CF_VERSION } from "@origin-ai/cf-shared";
import { createCoreHttpServer } from "./http.js";
import { createIngressToken } from "./ingressToken.js";
import { installParentDisconnectHandler } from "./parentDisconnect.js";
import { resolveCoreServerId } from "./serverIdentity.js";
import { createTaskActivityTracker } from "./taskActivityTracker.js";
import { resolveServerLayout } from "../runtime/paths.js";

declare const __CF_BUILTIN_PROVIDER_CONFIG_JSON__: string | undefined;

export async function runServerCore(generation: number): Promise<void> {
  let shutdown: ((reason: string) => Promise<void>) | undefined;
  let parentDisconnected = false;
  let disposeParentDisconnectHandler = (): void => undefined;
  disposeParentDisconnectHandler = installParentDisconnectHandler(() => {
    if (shutdown) void shutdown("parent-disconnected");
    else parentDisconnected = true;
  });
  const layout = resolveServerLayout(process.env.CF_SERVER_ROOT?.trim());
  const topicResourcePeers = createTopicResourcePeers();
  const explicitCfBuiltinProviderConfigFilePath =
    process.env[CF_BUILTIN_PROVIDER_CONFIG_FILE_ENV]?.trim();
  const cfBuiltinProviderConfigFilePath = explicitCfBuiltinProviderConfigFilePath
    ? explicitCfBuiltinProviderConfigFilePath
    : typeof __CF_BUILTIN_PROVIDER_CONFIG_JSON__ === "string"
      ? await materializeCfBuiltinProviderConfig({
          environmentConfigRoot: getAppConfigDir(),
          content: __CF_BUILTIN_PROVIDER_CONFIG_JSON__,
        })
      : undefined;
  if (!cfBuiltinProviderConfigFilePath) {
    throw new Error(
      `Current build does not embed CodeFusion Built-in Provider Config，且未Settings ${CF_BUILTIN_PROVIDER_CONFIG_FILE_ENV}`,
    );
  }
  const sourceServerId = (await resolveCoreServerId()) ?? hostname() ?? "cf-server";
  const { services, workspaceIdentityMapper, migrationFailedPathCount } =
    await createServerHostServices({
      sourceServerId,
      cfBuiltinProviderConfigFilePath,
      providerProvisioningTargetEnabled: true,
    topicResourceRelayChannel: (request) => topicResourcePeers.getChannel(request),
    });
  const taskActivityTracker = createTaskActivityTracker(services.getOptional(ICfAgentService));
  const ingressToken = await createIngressToken(layout);
  const http = await createCoreHttpServer(services, {
    serverId: sourceServerId,
    ingressToken,
    migrationFailedPathCount,
    workspaceIdentityMapper,
    topicResourcePeers,
  });
  const send = (message: unknown): Promise<void> => {
    if (typeof process.send !== "function" || process.connected === false) return Promise.resolve();
    return new Promise((resolve) => {
      try {
        process.send?.(message, () => resolve());
      } catch {
        resolve();
      }
    });
  };
  await send({
    type: "ready",
    host: http.host,
    port: http.port,
    version: CF_VERSION,
    ...(process.env.CF_SERVER_RELEASE_ID?.trim()
      ? { releaseId: process.env.CF_SERVER_RELEASE_ID.trim() }
      : {}),
    generation,
  });
  let shutdownStarted = false;
  let lastRunningTaskCount = taskActivityTracker.readRunningTaskCount();
  const activitySubscription = taskActivityTracker.onDidChangeRunningTaskCount(
    (runningTaskCount) => {
      lastRunningTaskCount = runningTaskCount;
      void send({
        type: "task-activity",
        runningTasks: taskActivityTracker.readRunningTasks(),
        runningTaskCount,
      });
    },
  );
  let heartbeatInFlight: Promise<void> | undefined;
  const heartbeat = setInterval(() => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = Promise.resolve(taskActivityTracker.readRunningTaskCount())
      .then((runningTaskCount) => {
        if (runningTaskCount !== lastRunningTaskCount) {
          lastRunningTaskCount = runningTaskCount;
          void send({
            type: "task-activity",
            runningTasks: taskActivityTracker.readRunningTasks(),
            runningTaskCount,
          });
        }
        void send({
          type: "heartbeat",
          runningTasks: taskActivityTracker.readRunningTasks(),
          at: Date.now(),
          runningTaskCount,
        });
      })
      .catch(() => {
        void send({
          type: "heartbeat",
          runningTasks: taskActivityTracker.readRunningTasks(),
          at: Date.now(),
          runningTaskCount: lastRunningTaskCount,
        });
      })
      .finally(() => {
        heartbeatInFlight = undefined;
      });
  }, 10_000);
  shutdown = async (reason: string): Promise<void> => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    disposeParentDisconnectHandler();
    clearInterval(heartbeat);
    activitySubscription.dispose();
    taskActivityTracker.dispose();
    await http.close().catch(() => undefined);
    await disposeServiceResourcesAndWait(services).catch(() => undefined);
    await send({ type: "shutdown-ack" });
    await send({ type: "exit", reason });
    try {
      process.disconnect?.();
    } catch {
    }
    process.exit(0);
  };
  if (parentDisconnected) void shutdown("parent-disconnected");
  process.on("message", (message: unknown) => {
    if (
      typeof message === "object" &&
      message !== null &&
      "command" in message &&
      message.command === "shutdown"
    ) {
      void shutdown("requested");
    }
  });
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}
