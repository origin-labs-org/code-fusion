import { createConfig } from "@origin-ai/cf-adapters/config";
import type { McpElicitationPort, McpNotificationPort } from "@origin-ai/cf-contracts";
import { createNodeModelSelectionFacade } from "@origin-ai/cf-provider-node";
import { createNodeLoggerFactory } from "@origin-ai/cf-adapters/logging";
import {
  createMcpAdapterConnectionPool,
  createMcpTelemetryTracker,
  type McpConnectionPool,
  type McpTelemetryTracker,
} from "@origin-ai/cf-adapters/mcp";
import {
  cfProtocolNotifications,
  type CfMcpResourceSample,
  type CfMcpTelemetryEvent,
} from "@origin-ai/cf-shared";
import type { SqliteSessionStore } from "@origin-ai/cf-adapters/storage";
import { traceContextToLogContext, createRootTraceContext } from "@origin-ai/cf-contracts";
import type { McpPort, ModelSelection } from "@origin-ai/cf-contracts";
import type { PresentationSurface } from "@origin-ai/cf-core";
import type { RunCfProtocolAgentOptions, CfAppOptions } from "./app/types.js";
import { createCfApp } from "./app/create-app.js";
import {
  createNodeReplBrowserBroker,
  type NodeReplBrowserBroker,
} from "./app/node-repl-browser-broker.js";
import {
  openProtocolStartupStorage,
  prepareProtocolStartupStorage,
} from "./cf-protocol/storage-startup.js";
import { closeSessionStore, getSessionDbPath } from "./app/session-store.js";
import { startProcessProviderRegistryRuntime } from "./app/process-provider-registry-runtime.js";
import { scheduleStartupLogRetentionCleanup } from "./log-retention.js";
import { resolveProcessProviderEndpointRoutingPort } from "./provider-endpoint-routing.js";
import { StartupTimer, startupNow } from "./startup-logging.js";
import { installCfProtocolAiSdkWarningLogger } from "./cf-protocol/ai-sdk-warning-logger.js";
import {
  createOfficialMcpAuthHeadersPort,
  type OfficialMcpAuthRequestContext,
} from "./cf-protocol/official-mcp-auth-port.js";
import {
  createOfficialMcpTrustedOriginRegistry,
  OFFICIAL_MCP_DEV_TRUSTED_ORIGINS_ENV,
  CF_WORKSPACE_IDENTITY_ENV,
  resolveRuntimeCfEndpointOrigin,
} from "@origin-ai/cf-shared";
import { CfProtocolAgentServer } from "./cf-protocol/server.js";
import { CfProtocolNdjsonConnection } from "./cf-protocol/transport.js";
import { cleanupProtocolRuntime } from "./cf-protocol/runtime-cleanup.js";
import { startProtocolResourceSampler } from "./cf-protocol/resource-sampler.js";
import { acquireProtocolStartupResource } from "./cf-protocol/startup-resource.js";
import { prepareCfTelemetryEnv, shutdownCfTelemetry } from "./telemetry-bootstrap.js";
import type { CfProcessResourceSampler } from "./process-resource-sampler.js";

export function applyProtocolPresentationSurface(
  options: Omit<CfAppOptions, "providerRegistry">,
  presentationSurface: PresentationSurface,
): Omit<CfAppOptions, "providerRegistry"> {
  return {
    ...options,
    runtimeConfig: {
      ...options.runtimeConfig,
      presentationSurface,
    },
  };
}

export function applyProtocolProviderRegistry(
  options: Omit<CfAppOptions, "providerRegistry">,
  providerRegistry: CfAppOptions["providerRegistry"],
  configuredDefaultModelSelection?: ModelSelection,
): CfAppOptions {
  return {
    ...options,
    providerRegistry,
    ...(configuredDefaultModelSelection ? { configuredDefaultModelSelection } : {}),
  };
}

export async function runCfProtocolAgent(
  options: RunCfProtocolAgentOptions = {},
): Promise<void> {
  if (options.prepareStorageOnly) {
    const config = createConfig({ env: options.env });
    await prepareProtocolStartupStorage({
      dbPath: getSessionDbPath(config, options.cwd),
      input: options.input ?? process.stdin,
      output: options.output ?? process.stdout,
    });
    return;
  }
  const startupStartedAt = startupNow();
  const presentationSurface = options.presentationSurface ?? "terminal";
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const loggerFactory = createNodeLoggerFactory({ env: options.env });
  const traceContext = createRootTraceContext({
    attributes: {
      entrypoint: "cf_protocol",
    },
  });
  const logger = loggerFactory.createLogger("cf").child({
    ...traceContextToLogContext(traceContext),
    module: "bootstrap.cf_protocol",
  });
  installCfProtocolAiSdkWarningLogger(logger);
  const startupTimer = new StartupTimer(
    logger,
    {
      ...traceContextToLogContext(traceContext),
      module: "bootstrap.cf_protocol",
      startupKind: "cf_protocol_agent",
    },
    startupStartedAt,
  );
  startupTimer.start("CodeFusion Protocol agent startup started", {
    context: { version: options.version },
    event: "cf_protocol.startup.started",
    stage: "start",
  });

  let sessionStore: SqliteSessionStore | undefined;
  let serverForCleanup: CfProtocolAgentServer | undefined;
  let nodeReplBrowserBroker: NodeReplBrowserBroker | undefined;
  let mcpConnectionPool: McpConnectionPool | undefined;
  let mcpPort: McpPort | undefined;
  let mcpTelemetryTracker: McpTelemetryTracker | undefined;
  let mcpResourceSink: ((samples: CfMcpResourceSample[]) => void) | undefined;
  let mcpTelemetrySink: ((event: CfMcpTelemetryEvent) => void) | undefined;
  let processResourceSampler: CfProcessResourceSampler | undefined;
  let providerRegistryRuntime:
    | Awaited<ReturnType<typeof startProcessProviderRegistryRuntime>>
    | undefined;
  try {
    const configResult = createConfig({ env: options.env });
    sessionStore = await acquireProtocolStartupResource({
      signal: options.lifecycle?.signal,
      logger,
      disposeLate: (store) => closeSessionStore(store),
      create: () =>
        openProtocolStartupStorage({
          dbPath: getSessionDbPath(configResult),
          output,
          onProgress: (progress) =>
            logger.info("SQLite startup state", {
              event: "cf_protocol.startup.storage_state",
              ...progress,
            }),
        }),
    });
    const runtimeEnv = options.env ?? process.env;
    options.lifecycle?.signal.throwIfAborted();
    providerRegistryRuntime = await acquireProtocolStartupResource({
      signal: options.lifecycle?.signal,
      logger,
      create: () => startProcessProviderRegistryRuntime(runtimeEnv),
      disposeLate: (runtime) => runtime.dispose(),
    });
    options.lifecycle?.signal.throwIfAborted();
    logger.info("Worker Provider Registry 已就绪", {
      accountRevision: providerRegistryRuntime.snapshot.sourceRevisions.account,
      configRevision: providerRegistryRuntime.snapshot.sourceRevisions.config,
      event: "cf_protocol.provider_registry.ready",
      module: "bootstrap.cf_protocol",
      providerCount: providerRegistryRuntime.snapshot.registry.providers.length,
    });
    const runtimeSurface = resolveProtocolRuntimeSurface(runtimeEnv);
    const telemetryEnv = await acquireProtocolStartupResource({
      signal: options.lifecycle?.signal,
      logger,
      disposeLate: () => shutdownCfTelemetry(),
      create: () =>
        prepareCfTelemetryEnv(runtimeEnv, {
          cliVersion: options.version,
          productVersion: options.env?.CF_APP_VERSION,
          runtimeSurface,
        }),
    });
    const telemetryDeviceMid = telemetryEnv.CF_TELEMETRY_DEVICE_MID;
    mcpTelemetryTracker =
      configResult.config.features.mcp === false
        ? undefined
        : createMcpTelemetryTracker({
            idSalt: telemetryDeviceMid ?? traceContext.traceId,
            onEvent: (event) => mcpTelemetrySink?.(event),
            onResourceSamples: (samples) => mcpResourceSink?.(samples),
          });
    const providerEndpointRoutingPort =
      options.providerEndpointRoutingPort ??
      resolveProcessProviderEndpointRoutingPort({
        appVersion: options.version,
        env: options.env,
        logger,
        network: configResult.config.network,
        sourceTitle: "electron",
      });
    let officialMcpAuthContext: OfficialMcpAuthRequestContext | undefined;
    const resolveCfApiOrigin = (): string =>
      resolveRuntimeCfEndpointOrigin(options.env ?? process.env);
    const workspaceIdentity = (options.env ?? process.env)[CF_WORKSPACE_IDENTITY_ENV]?.trim();
    const officialMcpAuth = {
      authHeadersPort: createOfficialMcpAuthHeadersPort({
        resolveContext: () => officialMcpAuthContext,
        resolveWorkspace: ({ workspaceIdentity, workspacePath }) => {
          const path = workspacePath ?? options.cwd;
          if (!path) return undefined;
          const identity = workspaceIdentity?.trim();
          return {
            ...(identity ? { workspaceIdentity: identity } : {}),
            workspaceKey: identity || path,
            workspacePath: path,
          };
        },
      }),
      resolveCfApiOrigin,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
      trustedOrigins: createOfficialMcpTrustedOriginRegistry({
        devTrustedOriginsRaw: (options.env ?? process.env)[OFFICIAL_MCP_DEV_TRUSTED_ORIGINS_ENV],
        resolveCfApiOrigin,
      }),
    };
    let elicitationServer: {
      requestMcpElicitation: McpElicitationPort["requestElicitation"];
      handleMcpNotification: McpNotificationPort["onNotification"];
    } | null = null;
    mcpConnectionPool =
      configResult.config.features.mcp === false
        ? undefined
        : createMcpAdapterConnectionPool({
            elicitation: {
              requestElicitation: (request, elicitationOptions) =>
                elicitationServer
                  ? elicitationServer.requestMcpElicitation(request, elicitationOptions)
                  : Promise.resolve({ action: "decline" as const }),
            },
            notifications: {
              onNotification: (notification) =>
                elicitationServer?.handleMcpNotification(notification),
            },
            clientVersion: options.version ?? "0.0.0",
            env: options.env,
            logger,
            network: {
              httpProxy: configResult.config.network.httpProxy,
              noProxy: configResult.config.network.noProxy,
              caCertFile: configResult.config.network.caCertFile,
            },
            officialMcpAuth,
            telemetry: mcpTelemetryTracker,
            workingDirectory: options.cwd,
          });
    mcpPort = mcpConnectionPool?.acquireLease({ leaseId: "protocol-settings" });
    const activeProviderRegistryRuntime = providerRegistryRuntime;
    const modelSelectionFacade = createNodeModelSelectionFacade(
      activeProviderRegistryRuntime.runtime.registryService,
    );
    options.lifecycle?.signal.throwIfAborted();
    const server = (serverForCleanup = new CfProtocolAgentServer({
      createCfApp: (appOptions = {}) =>
        createCfApp({
          ...applyProtocolProviderRegistry(
            applyProtocolPresentationSurface(appOptions, presentationSurface),
            activeProviderRegistryRuntime.runtime.registryService,
            activeProviderRegistryRuntime.configuredDefaultModelSelection,
          ),
          resolveEffectiveModelSelection: (selection) => {
            const view = modelSelectionFacade.getView(undefined, undefined, { selection });
            return {
              effectiveSelection: view.effectiveSelection ?? null,
              selectionIssue: view.selectionIssue,
            };
          },
          env: {
            ...telemetryEnv,
            ...appOptions.env,
            ...(telemetryDeviceMid ? { CF_TELEMETRY_DEVICE_MID: telemetryDeviceMid } : {}),
          },
          ...(nodeReplBrowserBroker ? { nodeReplBrowserBroker } : {}),
          ...(mcpConnectionPool
            ? {
                mcpPortFactory: () =>
                  mcpConnectionPool!.acquireLease({
                    leaseId: appOptions.sessionId,
                    sessionId: appOptions.sessionId,
                  }),
              }
            : {}),
          providerEndpointRoutingPort,
          sourceTitle: "electron",
          onToolExecResource: (params) =>
            connection.send({ method: cfProtocolNotifications.toolExecResource, params }),
        }),
      cwd: options.cwd,
      env: options.env,
      loggerFactory,
      mcpPort,
      mcpTelemetry: mcpTelemetryTracker,
      sessionStore,
      syncAccountProviderConfig: activeProviderRegistryRuntime.syncAccountProviderConfig,
      refreshProviderRegistry: async (reason) => {
        await activeProviderRegistryRuntime.runtime.registryService.refresh(reason);
      },
      version: options.version,
    }));
    officialMcpAuthContext = server.officialMcpAuthRequestContext;
    elicitationServer = server;
    if (configResult.config.features.mcp !== false) {
      nodeReplBrowserBroker = createNodeReplBrowserBroker({
        browserControlPort: server.browserControlPort,
        logger,
        platform: process.platform,
      });
      const broker = nodeReplBrowserBroker;
      await acquireProtocolStartupResource({
        signal: options.lifecycle?.signal,
        logger,
        create: () => broker.ready,
      });
    }
    const connection = new CfProtocolNdjsonConnection({
      signal: options.lifecycle?.signal,
      clearPostResponseMessages: () => server.clearPostResponseMessages(),
      handleMessage: (message) => server.handleMessage(message),
      input,
      logger,
      onTransportClosed: (error) => server.disconnectClient(error),
      output,
      takePostResponseBatch: (requestId) => server.takePostResponseBatch(requestId),
    });
    server.setNotificationSink((notification) => connection.send(notification));
    mcpResourceSink = (samples) =>
      connection.send({
        method: cfProtocolNotifications.mcpResourceSamples,
        params: samples,
      });
    mcpTelemetrySink = (event) => {
      if (event.kind === "memory") return;
      connection.send({
        method: cfProtocolNotifications.mcpTelemetry,
        params: event,
      });
    };
    connection.start();
    mcpTelemetryTracker?.start();
    processResourceSampler = startProtocolResourceSampler(
      server,
      (message) => connection.send(message),
      logger,
    );
    startupTimer.complete("CodeFusion Protocol agent startup completed", {
      event: "cf_protocol.startup.completed",
      stage: "total",
    });
    scheduleStartupLogRetentionCleanup(loggerFactory, logger);
    await connection.waitForClose();
  } catch (error) {
    options.lifecycle?.requestShutdown(
      error instanceof Error ? error : new Error("Protocol runtime failed", { cause: error }),
    );
    startupTimer.fail("CodeFusion Protocol agent startup failed", error, {
      event: "cf_protocol.startup.failed",
      stage: "total",
    });
    throw error;
  } finally {
    options.lifecycle?.requestShutdown();
    await cleanupProtocolRuntime({
      logger,
      deadlineAt: options.lifecycle?.deadlineAt,
      server: serverForCleanup,
      processResourceSampler,
      mcpTelemetryTracker,
      nodeReplBrowserBroker,
      mcpPort,
      mcpConnectionPool,
      sessionStore,
      providerRegistryRuntime,
    });
    logger.info("CodeFusion Protocol agent shutdown completed", {
      ...traceContextToLogContext(traceContext),
      event: "cf_protocol.shutdown.completed",
      module: "bootstrap.cf_protocol",
      status: "completed",
    });
  }
}

function resolveProtocolRuntimeSurface(
  env: NodeJS.ProcessEnv,
): "desktop_local_host" | "remote_workspace_host" {
  return env.CF_TELEMETRY_RUNTIME_SURFACE?.trim() === "remote_workspace_host"
    ? "remote_workspace_host"
    : "desktop_local_host";
}
