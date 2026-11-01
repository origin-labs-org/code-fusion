import { MessagePortProtocol, ChannelClient } from "@origin-ai/cf-rpc";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import { RemoteServiceAccess } from "./remoteServiceAccess.js";
import { isRendererProductionBuild } from "./rendererLoggingEnv.js";

function logMessagePortDebug(message: string): void {
  if (isRendererProductionBuild()) {
    return;
  }
  console.log(message);
}

export interface MessagePortServiceConnection {
  services: IServiceAccessor;
  dispose: (reason?: Error) => void;
}

export function createMessagePortServiceConnection(
  port: MessagePort,
  options: { sourceServerManagementService?: boolean } = {},
): MessagePortServiceConnection {
  logMessagePortDebug("[messageport] creating protocol and client...");
  const protocol = new MessagePortProtocol(port);
  const client = new ChannelClient(protocol);
  client.onDidInitialize(() => {
    logMessagePortDebug("[messageport] ChannelClient received Initialize from server");
  });
  logMessagePortDebug("[messageport] client created, waiting for Initialize...");

  const services = new RemoteServiceAccess(client, options);
  let disposed = false;
  return {
    services,
    dispose: (reason?: Error) => {
      if (disposed) {
        return;
      }
      disposed = true;
      client.dispose(reason);
      protocol.disconnect();
    },
  };
}

export function connectViaMessagePort(
  port: MessagePort,
  options: { sourceServerManagementService?: boolean } = {},
): IServiceAccessor {
  return createMessagePortServiceConnection(port, options).services;
}
