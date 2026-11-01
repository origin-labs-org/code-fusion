import type { IBotsService, ServiceCollection } from "@origin-ai/cf-services";
import type { DynamicWorkflowMode, WindowHostAttachmentScope } from "@origin-ai/cf-shared";
import {
  connectServerRemoteOverDuplex,
  type ServerRemoteConnection,
  type ServerRemoteDuplexConnectionOptions,
} from "./serverRemoteConnection.js";
import { createWindowTopicResourceRelay } from "./windowTopicResourceRelay.js";

export async function connectDesktopSourceServer(
  options: ServerRemoteDuplexConnectionOptions,
  deps: {
    connectServer?: typeof connectServerRemoteOverDuplex;
    resolveServices(scope: WindowHostAttachmentScope): ServiceCollection;
    getBots(): IBotsService | undefined;
    readDynamicWorkflowMode(): Promise<DynamicWorkflowMode | undefined>;
    onModeSyncError(error: unknown): void;
  },
): Promise<ServerRemoteConnection> {
  let connection: ServerRemoteConnection | undefined;
  const relay = createWindowTopicResourceRelay({
    getPeerAgentService: () => connection?.services.cfAgentService,
    resolveServices: deps.resolveServices,
    getBots: deps.getBots,
  });
  try {
    connection = await (deps.connectServer ?? connectServerRemoteOverDuplex)({
      ...options,
      topicResourceChannel: relay.channel,
      onClose(event) {
        relay.dispose();
        options.onClose?.(event);
      },
    });
    try {
      const mode = await deps.readDynamicWorkflowMode().catch(() => undefined);
      await connection.services.cfAgentService.syncDynamicWorkflowUserMode(mode ? { mode } : {});
    } catch (error) {
      deps.onModeSyncError(error);
    }
    const connected = connection;
    return {
      serverInfo: connected.serverInfo,
      services: connected.services,
      dispose() {
        relay.dispose();
        connected.dispose();
      },
    };
  } catch (error) {
    relay.dispose();
    connection?.dispose();
    throw error;
  }
}
