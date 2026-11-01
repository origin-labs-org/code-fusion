import { scopeConversationShareServiceForAttachment } from "@origin-ai/cf-services/node";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { hostname, userInfo } from "node:os";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import type { WebSocket } from "ws";
import type { WebSocketServer } from "ws";
import {
  Emitter,
  Event,
  VSBuffer,
  SocketProtocol,
  ChannelServer,
  ChannelClient,
  LoggingChannelServer,
  type ISocket,
  type IChannel,
  type CancellationToken,
} from "@origin-ai/cf-rpc";
import {
  createCfAgentConnectionScope,
  IProviderProvisioningTargetService,
  ICfAgentService,
  IConversationShareService,
  ServiceCollection,
} from "@origin-ai/cf-services";
import {
  createServiceLogger,
  type TopicResourcePeers,
  SourceServerWorkspaceIdentityChannelServer,
  type SourceServerWorkspaceIdentityMapper,
} from "@origin-ai/cf-services/node";
import {
  SERVER_REMOTE_PROTOCOL_VERSION,
  TOPIC_RESOURCE_RELAY_CHANNEL,
  serverRemoteInfoOutputSchema,
  CF_COMPATIBILITY_MANIFEST,
  CF_RPC_HOST_CAPABILITY_HEADER,
  CF_VERSION,
  type ServerRemoteInfo,
} from "@origin-ai/cf-shared";
import { createHostCapabilityStore, type HostCapabilityStore } from "./hostCapability.js";

export interface CoreHttpServer {
  host: string;
  port: number;
  close: () => Promise<void>;
}

const WEBSOCKET_DRAIN_TIMEOUT_MS = 250;
const log = createServiceLogger("server-core");

async function closeWebSocketServer(wss: WebSocketServer): Promise<void> {
  for (const client of wss.clients) {
    client.close(1001, "Server shutting down");
  }
  const deadline = Date.now() + WEBSOCKET_DRAIN_TIMEOUT_MS;
  while (wss.clients.size > 0 && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  for (const client of wss.clients) client.terminate();
  await new Promise<void>((resolve, reject) => {
    wss.close((error?: Error) => (error ? reject(error) : resolve()));
  });
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

function wrapWebSocket(ws: WebSocket): ISocket {
  const data = new Emitter<VSBuffer>();
  const close = new Emitter<void>();
  ws.on("message", (raw) =>
    data.fire(VSBuffer.wrap(Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer))),
  );
  ws.on("close", () => close.fire());
  ws.on("error", () => close.fire());
  return {
    onData: data.event,
    onClose: close.event,
    onEnd: close.event,
    write(buffer) {
      if (ws.readyState === ws.OPEN) ws.send(buffer.buffer);
    },
    end() {
      ws.close();
    },
    drain() {
      return Promise.resolve();
    },
    dispose() {
      ws.close();
    },
  };
}

function exposeWebSocket(
  ws: WebSocket,
  services: ServiceCollection,
  clientMode: "desktop-continuous" | "web-remote-replayable",
  workspaceIdentityMapper?: SourceServerWorkspaceIdentityMapper,
  resourcePeers?: TopicResourcePeers,
): void {
  const socket = wrapWebSocket(ws);
  const protocol = new SocketProtocol(socket);
  const rawServer = new ChannelServer(protocol, "server");
  const loggedServer = new LoggingChannelServer(rawServer, (...args) =>
    log.debug(undefined, ...args),
  );
  const server = workspaceIdentityMapper
    ? new SourceServerWorkspaceIdentityChannelServer(loggedServer, workspaceIdentityMapper)
    : loggedServer;
  const agentService = services.getOptional(ICfAgentService);
  const reverseClient =
    clientMode === "desktop-continuous" && resourcePeers ? new ChannelClient(protocol) : undefined;
  const rawResourceChannel = reverseClient?.getChannel(TOPIC_RESOURCE_RELAY_CHANNEL);
  const resourceChannel: IChannel | undefined =
    rawResourceChannel && workspaceIdentityMapper
      ? {
          async call<T>(command: string, args?: unknown, token?: CancellationToken) {
            const result = await rawResourceChannel.call<T>(
              command,
              workspaceIdentityMapper.mapOutgoing(args),
              token,
            );
            return workspaceIdentityMapper.mapIncoming(result);
          },
          listen<T>(event: string, args?: unknown) {
            return Event.map(
              rawResourceChannel.listen<T>(event, workspaceIdentityMapper.mapOutgoing(args)),
              (value) => workspaceIdentityMapper.mapIncoming(value),
            );
          },
        }
      : rawResourceChannel;
  const peer = resourceChannel ? resourcePeers?.attach(resourceChannel) : undefined;
  const connectionContext = {
    connectionId: `server-core-ws-${randomUUID()}`,
    clientMode,
    role:
      clientMode === "desktop-continuous"
        ? ("trusted-host-relay" as const)
        : ("terminal-client" as const),
  };
  const scope = agentService
    ? createCfAgentConnectionScope(
        peer ? peer.wrapAgent(agentService) : agentService,
        connectionContext,
      )
    : undefined;
  const overrides = new Map<string, unknown>();
  if (scope) {
    overrides.set(ICfAgentService.channelName, scope.service);
  }
  const shareService = services.getOptional(IConversationShareService);
  if (shareService) {
    overrides.set(
      IConversationShareService.channelName,
      scopeConversationShareServiceForAttachment(
        shareService,
        clientMode,
        scope?.service,
        connectionContext,
      ),
    );
  }
  if (
    clientMode !== "desktop-continuous" &&
    services.getOptional(IProviderProvisioningTargetService)
  ) {
    overrides.set(IProviderProvisioningTargetService.channelName, {
      apply: async () => {
        throw new Error("Provider Provisioning only supported for trusted Desktop Hosts.");
      },
    });
  }
  services.exposeOnChannelServer(server, overrides);
  socket.onClose(() => {
    peer?.dispose();
    reverseClient?.dispose();
    void scope?.dispose();
    rawServer.dispose();
  });
}

export async function createCoreHttpServer(
  services: ServiceCollection,
  options: {
    host?: string;
    port?: number;
    serverId?: string;
    ingressToken?: string;
    migrationFailedPathCount?: number;
    hostCapabilityStore?: HostCapabilityStore;
    workspaceIdentityMapper?: SourceServerWorkspaceIdentityMapper;
    topicResourcePeers?: TopicResourcePeers;
  } = {},
): Promise<CoreHttpServer> {
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket, wss } = createNodeWebSocket({ app });
  const host = options.host ?? "127.0.0.1";
  if (!isLoopbackHost(host)) {
    throw new Error(
      `Non-loopback host ${host} requires authentication before the server can listen`,
    );
  }
  const ingressToken = options.ingressToken?.trim();
  const info: ServerRemoteInfo = serverRemoteInfoOutputSchema.parse({
    serverId: options.serverId ?? hostname() ?? "cf-server",
    version: CF_VERSION,
    protocolVersion: SERVER_REMOTE_PROTOCOL_VERSION,
    authRequired: Boolean(ingressToken),
    workspaces: [],
    compatibility: CF_COMPATIBILITY_MANIFEST,
    migration: { failedPathCount: options.migrationFailedPathCount ?? 0 },
    identity: { osUser: userInfo().username, hostname: hostname() },
    capabilities: {
      desktopContinuous: true,
      websocketRpc: true,
      virtualProjects: true,
      processResourceTelemetry: true,
    },
  });
  const capabilities = options.hostCapabilityStore ?? createHostCapabilityStore();
  app.use("*", async (context, next) => {
    if (!ingressToken) {
      await next();
      return;
    }
    const authorization = context.req.header("authorization");
    const bearerToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : undefined;
    const queryToken = new URL(context.req.url).searchParams.get("token")?.trim();
    const candidate = bearerToken || queryToken;
    const authenticated = candidate
      ? (() => {
          const expected = Buffer.from(ingressToken);
          const received = Buffer.from(candidate);
          return expected.length === received.length && timingSafeEqual(expected, received);
        })()
      : false;
    if (authenticated) {
      await next();
      return;
    }
    if (context.req.path === "/api/server-info") {
      return context.json({
        version: info.version,
        protocolVersion: info.protocolVersion,
        authRequired: true,
        compatibility: info.compatibility,
      });
    }
    return context.json({ error: "Ingress authentication required" }, 401);
  });
  app.get("/api/server-info", (context) => context.json(info));
  app.get(
    "/ws",
    upgradeWebSocket(() => ({
      onOpen(_event, socket) {
        exposeWebSocket(
          socket.raw as WebSocket,
          services,
          "web-remote-replayable",
          options.workspaceIdentityMapper,
        );
      },
    })),
  );
  app.use("/ws/host", async (context, next) => {
    const capability = context.req.header(CF_RPC_HOST_CAPABILITY_HEADER);
    if (!capabilities.consume(capability)) {
      return context.json({ error: "Invalid or expired host capability" }, 401);
    }
    await next();
  });
  app.get(
    "/ws/host",
    upgradeWebSocket(() => ({
      onOpen(_event, socket) {
        exposeWebSocket(
          socket.raw as WebSocket,
          services,
          "desktop-continuous",
          options.workspaceIdentityMapper,
          options.topicResourcePeers,
        );
      },
    })),
  );
  app.post("/api/rpc-host-capability", (context) => context.json(capabilities.issue()));
  let resolveListening: (value: { port: number }) => void = () => undefined;
  const listening = new Promise<{ port: number }>((resolve) => {
    resolveListening = resolve;
  });
  const server = serve({ fetch: app.fetch, hostname: host, port: options.port ?? 0 }, () => {
    const address = server.address();
    resolveListening({
      port: typeof address === "object" && address ? address.port : (options.port ?? 0),
    });
  });
  injectWebSocket(server);
  const { port } = await listening;
  return {
    host,
    port,
    close: async () => {
      await closeWebSocketServer(wss);
      await new Promise<void>((resolve, reject) =>
        server.close((error?: Error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
