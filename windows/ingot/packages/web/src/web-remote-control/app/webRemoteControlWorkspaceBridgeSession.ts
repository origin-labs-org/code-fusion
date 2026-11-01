import type {
  WebRemoteControlExternalWorkspaceBridge,
  WebRemoteControlWorkspaceBridge,
} from "@origin-ai/cf-shared";
import {
  connectViaProtocol,
  type AcknowledgedWebRemoteControlRelayProtocolAdapter,
} from "@origin-ai/cf-client";
import {
  bindRemoteWorkspaceIdentity,
  bindRemoteWorkspacePath,
  getRemoteWorkspaceSession,
  registerRemoteWorkspaceSession,
  unregisterRemoteWorkspaceSession,
  type RemoteWorkspaceSession,
} from "@origin-ai/cf-ui/remote-workspace-session-store";

type WebRemoteControlBridgeWithRemoteSession =
  | WebRemoteControlExternalWorkspaceBridge
  | WebRemoteControlWorkspaceBridge;

export interface WebRemoteControlWorkspaceBridgeServiceRegistration {
  dispose: () => void;
}

export function replayWebRemoteControlWorkspaceBridgeFrames(params: {
  activeRelayProtocol?: AcknowledgedWebRemoteControlRelayProtocolAdapter;
  pendingRelayProtocol?: AcknowledgedWebRemoteControlRelayProtocolAdapter;
}): void {
  params.pendingRelayProtocol?.replayUnacknowledged();
  if (params.activeRelayProtocol?.isDegraded()) return;
  params.activeRelayProtocol?.replayUnacknowledged();
}

export async function connectWebRemoteControlWorkspaceBridgeServices(params: {
  relayProtocol: AcknowledgedWebRemoteControlRelayProtocolAdapter;
  windowProjectDirectory: boolean;
  activateTransport(): () => void;
  isCurrent(): boolean;
  signal?: AbortSignal;
}) {
  const superseded = () => new Error("Workspace bridge request was superseded.");
  if (params.signal?.aborted || !params.isCurrent()) {
    params.relayProtocol.dispose();
    throw superseded();
  }
  const releaseTransport = params.activateTransport();
  let interrupt!: (error: Error) => void;
  const interrupted = new Promise<never>((_, reject) => {
    interrupt = reject;
  });
  const onAbort = () => interrupt(superseded());
  params.signal?.addEventListener("abort", onAbort, { once: true });
  const degraded = params.relayProtocol.onDegraded(() =>
    interrupt(new Error("Workspace bridge degraded before directory readiness.")),
  );
  try {
    const services = connectViaProtocol(params.relayProtocol.protocol, {
      windowProjectDirectory: params.windowProjectDirectory,
    });
    const capability = services.windowProjectDirectory
      ? services.windowProjectDirectory.changesService.getCapabilities().then((result) => {
          if (result?.version !== 1) throw new Error("window-project-directory.unsupported");
        })
      : Promise.resolve();
    await Promise.race([capability, interrupted]);
    if (!params.isCurrent() || params.signal?.aborted) throw superseded();
    return services;
  } catch (error) {
    releaseTransport();
    params.relayProtocol.dispose();
    throw error;
  } finally {
    params.signal?.removeEventListener("abort", onAbort);
    degraded.dispose();
  }
}

export function registerWebRemoteControlWorkspaceBridgeServices(params: {
  bridge: WebRemoteControlBridgeWithRemoteSession;
  services: RemoteWorkspaceSession["services"];
}): WebRemoteControlWorkspaceBridgeServiceRegistration {
  const { bridge, services } = params;
  if (bridge.kind !== "remote") {
    return { dispose: () => {} };
  }

  registerRemoteWorkspaceSession({
    sessionId: bridge.remoteSessionId,
    services,
  });
  bindRemoteWorkspaceIdentity(bridge.workspaceIdentity, bridge.remoteSessionId);
  bindRemoteWorkspacePath(bridge.workspacePath, bridge.remoteSessionId);

  return {
    dispose: () => {
      if (getRemoteWorkspaceSession(bridge.remoteSessionId)?.services !== services) {
        return;
      }
      unregisterRemoteWorkspaceSession(bridge.remoteSessionId);
    },
  };
}
