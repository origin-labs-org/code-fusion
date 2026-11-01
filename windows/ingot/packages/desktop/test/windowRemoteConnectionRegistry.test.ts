import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteTarget } from "@origin-ai/cf-shared";
import {
  WindowRemoteConnectionUnavailableError,
  createWindowRemoteConnectionRegistry,
  type WindowRemoteConnectionHandle,
} from "../src/host/windowRemoteConnectionRegistry.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createHandle<TCapabilities = never>(services: string, capabilities?: TCapabilities) {
  const closeListeners = new Set<
    (event: { exitCode: number | null; signal: string | null; recoverable?: boolean }) => void
  >();
  const reconnectListeners = new Set<() => void>();
  let currentServices = services;
  const dispose = vi.fn(async () => undefined);
  const handle: WindowRemoteConnectionHandle<string, TCapabilities> = {
    get services() {
      return currentServices;
    },
    ...(capabilities === undefined ? {} : { capabilities }),
    dispose,
    onDidClose(listener) {
      closeListeners.add(listener);
      return { dispose: () => closeListeners.delete(listener) };
    },
    onDidReconnect(listener) {
      reconnectListeners.add(listener);
      return { dispose: () => reconnectListeners.delete(listener) };
    },
  };
  return {
    handle,
    dispose,
    close(event = { exitCode: 255, signal: null }) {
      for (const listener of closeListeners) {
        listener(event);
      }
    },
    reconnect(nextServices: string) {
      currentServices = nextServices;
      for (const listener of reconnectListeners) listener();
    },
    listenerCounts() {
      return { close: closeListeners.size, reconnect: reconnectListeners.size };
    },
  };
}

const sshTarget: RemoteTarget = {
  kind: "ssh",
  host: "dev.internal",
  username: "developer",
};

describe("WindowRemoteConnectionRegistry", () => {
  afterEach(() => vi.useRealTimers());
  it("URL Host connection does not allocate workspace; subsequent tasks reuse the same physical connection", async () => {
    const physical = createHandle("url-services", { sourceServerId: "s", persistent: true });
    const connect = vi.fn(async (_request: unknown) => physical.handle);
    const prepareWorkspaceIdentity = vi.fn(async () => undefined);
    const registry = createWindowRemoteConnectionRegistry({
      connect,
      createId: () => "task-tab",
      prepareWorkspaceIdentity,
      resolveSourceServerId: (handle) => handle.capabilities?.sourceServerId,
      shouldKeepConnectionAlive: (handle) => handle.capabilities?.persistent === true,
    });
    const target: RemoteTarget = { kind: "server", url: "https://example.test", serverId: "s" };
    const [first, second] = await Promise.all([
      registry.connectSource({ target, remoteAssets: {}, membershipIntent: "retain" }),
      registry.connectSource({ target, remoteAssets: {}, membershipIntent: "retain" }),
    ]);
    expect(first.handle).toBe(second.handle);
    expect(first.sourceServerId).toBe("s");
    expect(registry.getOnlineSource("s")?.services).toBe("url-services");
    expect(registry.getStats()).toEqual({ connectionCount: 1, logicalSessionCount: 0 });
    expect(prepareWorkspaceIdentity).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect.mock.calls[0]?.[0]).toMatchObject({ membershipIntent: "retain" });
    await registry.connect({ requestId: "open", target, remoteAssets: {}, workspacePath: "/repo" });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(prepareWorkspaceIdentity).toHaveBeenCalledTimes(1);
    physical.close();
    expect(registry.getOnlineSource("s")).toBeUndefined();
    expect(registry.listConnections()[0]).toMatchObject({
      sourceServerId: "s",
      state: "disconnected",
    });
    await registry.dispose();
    expect(physical.dispose).toHaveBeenCalledTimes(1);
  });
  it("Late workspace-less connections during Host shutdown must not publish online", async () => {
    const pending = deferred<WindowRemoteConnectionHandle<string, { sourceServerId: string }>>();
    const physical = createHandle("late", { sourceServerId: "s" });
    const registry = createWindowRemoteConnectionRegistry({
      connect: () => pending.promise,
      createId: () => "unused",
      resolveSourceServerId: (handle) => handle.capabilities?.sourceServerId,
      shouldKeepConnectionAlive: () => true,
    });
    const result = registry.connectSource({
      target: { kind: "server", url: "https://example.test" },
      remoteAssets: {},
    });
    const rejected = expect(result).rejects.toThrow();
    const disposed = registry.dispose();
    pending.resolve(physical.handle);
    await disposed;
    await rejected;
    expect(registry.getOnlineSource("s")).toBeUndefined();
    expect(physical.dispose).toHaveBeenCalledTimes(1);
  });
  it("Online connections return the actual reused target and do not use newly entered passwords", async () => {
    const connection = createHandle("ssh-services");
    const connect = vi.fn(async () => connection.handle);
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect,
      createId: () => `reuse-${++id}`,
    });
    const first = await registry.connect({
      requestId: "first",
      target: { ...sshTarget, password: "accepted" },
      remoteAssets: {},
    });
    const second = await registry.connect({
      requestId: "second",
      target: { ...sshTarget, password: "unverified" },
      remoteAssets: {},
    });
    expect(first.reusedConnectionTarget).toBeUndefined();
    expect(second.reusedConnectionTarget).toEqual(sshTarget);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(second)).not.toMatch(/accepted|unverified/u);
    await registry.dispose();
  });

  it("Joining an ongoing connection uses the target from the first request and rejects a second password", async () => {
    const connection = createHandle("ssh-services");
    const ready = deferred<typeof connection.handle>();
    const connect = vi.fn(() => ready.promise);
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect,
      createId: () => `joining-${++id}`,
    });
    const first = registry.connect({
      requestId: "first",
      target: { ...sshTarget, password: "accepted" },
      remoteAssets: {},
    });
    const second = registry.connect({
      requestId: "second",
      target: { ...sshTarget, password: "ignored" },
      remoteAssets: {},
    });
    ready.resolve(connection.handle);
    expect((await first).reusedConnectionTarget).toBeUndefined();
    expect((await second).reusedConnectionTarget).toEqual(sshTarget);
    expect(connect).toHaveBeenCalledTimes(1);
    await registry.dispose();
  });

  it("Pass through reused target of physical Manager when window has no entry", async () => {
    const connection = createHandle("ssh-services");
    const actualTarget: RemoteTarget = { kind: "wsl", distro: "Ubuntu" };
    connection.handle.reusedConnectionTarget = actualTarget;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => "managed-reuse",
    });
    const result = await registry.connect({
      requestId: "new-wrapper",
      target: { ...sshTarget, password: "ignored" },
      remoteAssets: {},
    });
    expect(result.reusedConnectionTarget).toEqual(actualTarget);
    expect(result.target).toEqual(actualTarget);
    await registry.dispose();
  });

  it("Reuse connection for identical SSH target in the same window, but allocate independent logical session", async () => {
    const connection = createHandle("ssh-services");
    const connect = vi.fn(async () => connection.handle);
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect,
      createId: () => `remote-session-${++id}`,
    });

    const [first, second] = await Promise.all([
      registry.connect({ requestId: "request-1", target: sshTarget, remoteAssets: {} }),
      registry.connect({ requestId: "request-2", target: sshTarget, remoteAssets: {} }),
    ]);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(first.remoteSessionId).not.toBe(second.remoteSessionId);
    expect(registry.getStats()).toEqual({ connectionCount: 1, logicalSessionCount: 2 });
    registry.bindWorkspaceContext({
      remoteSessionId: first.remoteSessionId,
      workspacePath: "/work/a",
      workspaceIdentity: "remote:ssh:a",
    });
    registry.bindWorkspaceContext({
      remoteSessionId: second.remoteSessionId,
      workspacePath: "/work/b",
      workspaceIdentity: "remote:ssh:b",
    });
    expect(
      registry.resolveScopedServices({
        kind: "remote",
        remoteSessionId: first.remoteSessionId,
        workspacePath: "/work/a",
        workspaceIdentity: "remote:ssh:a",
      }),
    ).toBe("ssh-services");

    await registry.disposeSession(first.remoteSessionId);
    expect(connection.dispose).not.toHaveBeenCalled();
    await registry.disposeSession(second.remoteSessionId);
    expect(connection.dispose).not.toHaveBeenCalled();
    expect(registry.getStats()).toEqual({ connectionCount: 1, logicalSessionCount: 0 });
    await registry.dispose();
    expect(connection.dispose).toHaveBeenCalledTimes(1);
    expect(registry.getStats()).toEqual({ connectionCount: 0, logicalSessionCount: 0 });
  });

  it("Reuse the same workspace logical owner when different Profiles handshake with the same Source", async () => {
    const firstConnection = createHandle("source-services", {
      persistent: true,
      sourceServerId: "source-1",
    });
    const secondConnection = createHandle("source-services", {
      persistent: true,
      sourceServerId: "source-1",
    });
    const handles = [firstConnection.handle, secondConnection.handle];
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => handles.shift()!,
      createId: () => `remote-session-${++id}`,
      resolveSourceServerId: (handle) => handle.capabilities?.sourceServerId,
      shouldKeepConnectionAlive: (handle) => handle.capabilities?.persistent === true,
    });
    const workspace = {
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:server:source-1:/work/demo",
    };
    const firstTarget: RemoteTarget = {
      kind: "ssh",
      host: "route-a.internal",
      username: "developer",
    };
    const secondTarget: RemoteTarget = {
      kind: "ssh",
      host: "route-b.internal",
      username: "developer",
    };

    const first = await registry.connect({
      requestId: "profile-a",
      target: firstTarget,
      remoteAssets: {},
      ...workspace,
    });
    const second = await registry.connect({
      requestId: "profile-b",
      target: secondTarget,
      remoteAssets: {},
      ...workspace,
    });

    expect(second).toMatchObject({
      remoteSessionId: first.remoteSessionId,
      target: firstTarget,
    });
    expect(registry.getStats()).toEqual({
      connectionCount: 1,
      logicalSessionCount: 1,
    });
    expect(registry.findSessionForWorkspace(workspace)).toMatchObject({
      remoteSessionId: first.remoteSessionId,
      target: firstTarget,
    });
    expect(secondConnection.dispose).toHaveBeenCalledTimes(1);
    expect(firstConnection.dispose).not.toHaveBeenCalled();

    await registry.dispose();
  });

  it("在线 Source 上以 legacy identity join 时复用唯一 owner 并返回 stable identity", async () => {
    const connection = createHandle("source-services", {
      persistent: true,
      sourceServerId: "source-1",
    });
    const prepareCalls: Array<{ stableWorkspaceIdentity: string; legacyRouteHint?: string }> = [];
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => `remote-session-${++id}`,
      resolveSourceServerId: (handle) => handle.capabilities?.sourceServerId,
      shouldKeepConnectionAlive: (handle) => handle.capabilities?.persistent === true,
      prepareWorkspaceIdentity: async (_handle, input) => {
        prepareCalls.push({
          stableWorkspaceIdentity: input.stableWorkspaceIdentity,
          ...(input.legacyRouteHint ? { legacyRouteHint: input.legacyRouteHint } : {}),
        });
      },
    });
    const stableIdentity = "remote:server:source-1:/work/demo";
    const legacyIdentity = "remote:ssh:dev.internal:22:developer:/work/demo";

    const owner = await registry.connect({
      requestId: "request-owner",
      target: sshTarget,
      remoteAssets: {},
      workspacePath: "/work/demo",
      workspaceIdentity: stableIdentity,
    });
    const joined = await registry.connect({
      requestId: "request-legacy-join",
      target: sshTarget,
      remoteAssets: {},
      workspacePath: "/work/demo",
      workspaceIdentity: legacyIdentity,
    });

    expect(joined).toMatchObject({
      remoteSessionId: owner.remoteSessionId,
      sourceServerId: "source-1",
      workspaceIdentity: stableIdentity,
    });
    expect(registry.getStats()).toEqual({ connectionCount: 1, logicalSessionCount: 1 });
    expect(
      registry.findSessionForWorkspace({
        workspacePath: "/work/demo",
        workspaceIdentity: stableIdentity,
      })?.remoteSessionId,
    ).toBe(owner.remoteSessionId);
    expect(prepareCalls).toEqual([
      { stableWorkspaceIdentity: stableIdentity, legacyRouteHint: stableIdentity },
      { stableWorkspaceIdentity: stableIdentity, legacyRouteHint: legacyIdentity },
    ]);

    await registry.dispose();
  });

  it("在线 Source 上以 legacy identity 打开新 workspace 时立即归一为 stable identity", async () => {
    const connection = createHandle("source-services", {
      persistent: true,
      sourceServerId: "source-1",
    });
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => `remote-session-${++id}`,
      resolveSourceServerId: (handle) => handle.capabilities?.sourceServerId,
      shouldKeepConnectionAlive: (handle) => handle.capabilities?.persistent === true,
    });
    await registry.connect({
      requestId: "request-a",
      target: sshTarget,
      remoteAssets: {},
      workspacePath: "/work/a",
      workspaceIdentity: "remote:server:source-1:/work/a",
    });

    const second = await registry.connect({
      requestId: "request-b",
      target: sshTarget,
      remoteAssets: {},
      workspacePath: "/work/b",
      workspaceIdentity: "remote:ssh:dev.internal:22:developer:/work/b",
    });

    expect(second).toMatchObject({
      remoteSessionId: "remote-session-2",
      sourceServerId: "source-1",
      workspaceIdentity: "remote:server:source-1:/work/b",
    });
    expect(registry.getStats()).toEqual({ connectionCount: 1, logicalSessionCount: 2 });
    expect(
      registry.findSessionForWorkspace({
        workspacePath: "/work/b",
        workspaceIdentity: "remote:server:source-1:/work/b",
      })?.remoteSessionId,
    ).toBe("remote-session-2");

    await registry.dispose();
  });

  it("Converge different workspaces into one Source entry when different Profiles handshake with the same Source", async () => {
    const firstConnection = createHandle("source-owner-services", {
      persistent: true,
      sourceServerId: "source-1",
    });
    const secondConnection = createHandle("provisional-services", {
      persistent: true,
      sourceServerId: "source-1",
    });
    const handles = [firstConnection.handle, secondConnection.handle];
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => handles.shift()!,
      createId: () => `remote-session-${++id}`,
      resolveSourceServerId: (handle) => handle.capabilities?.sourceServerId,
      shouldKeepConnectionAlive: (handle) => handle.capabilities?.persistent === true,
    });
    const firstTarget: RemoteTarget = {
      kind: "ssh",
      host: "route-a.internal",
      username: "developer",
    };
    const secondTarget: RemoteTarget = {
      kind: "ssh",
      host: "route-b.internal",
      username: "developer",
    };
    const firstWorkspace = {
      workspacePath: "/work/a",
      workspaceIdentity: "remote:server:source-1:/work/a",
    };
    const secondWorkspace = {
      workspacePath: "/work/b",
      workspaceIdentity: "remote:server:source-1:/work/b",
    };

    const first = await registry.connect({
      requestId: "profile-a",
      target: firstTarget,
      remoteAssets: {},
      ...firstWorkspace,
    });
    const second = await registry.connect({
      requestId: "profile-b",
      target: secondTarget,
      remoteAssets: {},
      ...secondWorkspace,
    });

    expect(first.remoteSessionId).not.toBe(second.remoteSessionId);
    expect(second.target).toEqual(firstTarget);
    expect(registry.getStats()).toEqual({
      connectionCount: 1,
      logicalSessionCount: 2,
    });
    expect(
      registry.resolveScopedServices({
        kind: "remote",
        remoteSessionId: second.remoteSessionId,
        ...secondWorkspace,
      }),
    ).toBe("source-owner-services");
    expect(secondConnection.dispose).toHaveBeenCalledTimes(1);
    expect(firstConnection.dispose).not.toHaveBeenCalled();

    await registry.dispose();
  });

  it("Replace canonical entry with new handle when recovering Source reconnects via another Profile", async () => {
    const firstConnection = createHandle("old-services", {
      persistent: true,
      sourceServerId: "source-1",
    });
    const secondConnection = createHandle("new-services", {
      persistent: true,
      sourceServerId: "source-1",
    });
    const handles = [firstConnection.handle, secondConnection.handle];
    const replacements: Array<{
      previous: { remoteSessionId: string };
      current: { remoteSessionId: string };
    }> = [];
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => handles.shift()!,
      createId: () => `remote-session-${++id}`,
      resolveSourceServerId: (handle) => handle.capabilities?.sourceServerId,
      shouldKeepConnectionAlive: (handle) => handle.capabilities?.persistent === true,
      onSessionReconnected: ({ previous, current, commit }) => {
        commit();
        replacements.push({ previous, current });
      },
    });
    const workspace = {
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:server:source-1:/work/demo",
    };
    const firstTarget: RemoteTarget = {
      kind: "ssh",
      host: "route-a.internal",
      username: "developer",
    };
    const secondTarget: RemoteTarget = {
      kind: "ssh",
      host: "route-b.internal",
      username: "developer",
    };
    const first = await registry.connect({
      requestId: "profile-a",
      target: firstTarget,
      remoteAssets: {},
      ...workspace,
    });
    firstConnection.close({
      exitCode: 255,
      signal: null,
      recoverable: true,
    });

    const reconnecting = registry.connect({
      requestId: "profile-b",
      target: secondTarget,
      remoteAssets: {},
      ...workspace,
    });
    const outcome = await Promise.race([
      reconnecting.then(() => "resolved" as const),
      new Promise<"pending">((resolve) => setImmediate(() => resolve("pending"))),
    ]);
    if (outcome === "pending") {
      await registry.dispose();
      await reconnecting.catch(() => undefined);
    }

    expect(outcome).toBe("resolved");
    const reconnected = await reconnecting;
    expect(reconnected).toMatchObject({
      target: secondTarget,
      workspaceIdentity: workspace.workspaceIdentity,
    });
    expect(reconnected.remoteSessionId).not.toBe(first.remoteSessionId);
    expect(replacements).toEqual([
      {
        previous: expect.objectContaining({
          remoteSessionId: first.remoteSessionId,
        }),
        current: expect.objectContaining({
          remoteSessionId: reconnected.remoteSessionId,
          target: secondTarget,
        }),
      },
    ]);
    expect(registry.getStats()).toEqual({
      connectionCount: 1,
      logicalSessionCount: 1,
    });
    expect(
      registry.resolveScopedServices({
        kind: "remote",
        remoteSessionId: reconnected.remoteSessionId,
        ...workspace,
      }),
    ).toBe("new-services");
    expect(firstConnection.dispose).toHaveBeenCalledTimes(1);
    expect(secondConnection.dispose).not.toHaveBeenCalled();

    await registry.dispose();
  });

  it("Publish only the first-claimed Source owner when concurrent Profile handshakes complete out of order", async () => {
    const firstConnection = createHandle("route-a-services", {
      persistent: true,
      sourceServerId: "source-1",
    });
    const secondConnection = createHandle("route-b-services", {
      persistent: true,
      sourceServerId: "source-1",
    });
    const firstReady = deferred<typeof firstConnection.handle>();
    const secondReady = deferred<typeof secondConnection.handle>();
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async ({ target }) => {
        if (target.kind === "ssh" && target.host === "route-a.internal") {
          return await firstReady.promise;
        }
        return await secondReady.promise;
      },
      createId: () => `remote-session-${++id}`,
      resolveSourceServerId: (handle) => handle.capabilities?.sourceServerId,
      shouldKeepConnectionAlive: (handle) => handle.capabilities?.persistent === true,
    });
    const workspace = {
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:server:source-1:/work/demo",
    };
    const firstTarget: RemoteTarget = {
      kind: "ssh",
      host: "route-a.internal",
      username: "developer",
    };
    const secondTarget: RemoteTarget = {
      kind: "ssh",
      host: "route-b.internal",
      username: "developer",
    };
    const first = registry.connect({
      requestId: "profile-a",
      target: firstTarget,
      remoteAssets: {},
      ...workspace,
    });
    const second = registry.connect({
      requestId: "profile-b",
      target: secondTarget,
      remoteAssets: {},
      ...workspace,
    });

    secondReady.resolve(secondConnection.handle);
    await Promise.resolve();
    firstReady.resolve(firstConnection.handle);
    const [firstDescriptor, secondDescriptor] = await Promise.all([first, second]);

    expect(firstDescriptor.remoteSessionId).toBe(secondDescriptor.remoteSessionId);
    expect(firstDescriptor.target).toEqual(secondTarget);
    expect(secondDescriptor.target).toEqual(secondTarget);
    expect(registry.getStats()).toEqual({
      connectionCount: 1,
      logicalSessionCount: 1,
    });
    expect(firstConnection.dispose).toHaveBeenCalledTimes(1);
    expect(secondConnection.dispose).not.toHaveBeenCalled();

    await registry.dispose();
  });

  it("Ability to resolve the connection for each logical session via full remote scope", async () => {
    const dockerCapability = { recordingUploader: "docker-uploader" };
    const otherDockerCapability = { recordingUploader: "other-docker-uploader" };
    const dockerConnection = createHandle("docker-services", dockerCapability);
    const otherDockerConnection = createHandle("other-docker-services", otherDockerCapability);
    const connect = vi
      .fn()
      .mockResolvedValueOnce(dockerConnection.handle)
      .mockResolvedValueOnce(otherDockerConnection.handle);
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect,
      createId: () => `remote-session-${++id}`,
    });

    const dockerSession = await registry.connect({
      requestId: "docker-request",
      target: { kind: "docker", container: "demo" },
      remoteAssets: {},
      workspacePath: "/work/docker",
      workspaceIdentity: "remote:docker:demo:/work/docker",
    });
    const otherDockerSession = await registry.connect({
      requestId: "other-docker-request",
      target: { kind: "docker", container: "other-demo" },
      remoteAssets: {},
      workspacePath: "/work/other-docker",
      workspaceIdentity: "remote:docker:other-demo:/work/other-docker",
    });

    expect(
      registry.resolveScopedCapabilities({
        kind: "remote",
        remoteSessionId: dockerSession.remoteSessionId,
        workspacePath: "/work/docker",
        workspaceIdentity: "remote:docker:demo:/work/docker",
      }),
    ).toBe(dockerCapability);
    expect(
      registry.resolveScopedCapabilities({
        kind: "remote",
        remoteSessionId: otherDockerSession.remoteSessionId,
        workspacePath: "/work/other-docker",
        workspaceIdentity: "remote:docker:other-demo:/work/other-docker",
      }),
    ).toBe(otherDockerCapability);

    await registry.dispose();
  });

  it("Docker and Server reuse Source connection by the same target within the window", async () => {
    let connectionId = 0;
    const connect = vi.fn(async () => createHandle(`services-${++connectionId}`).handle);
    let sessionId = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect,
      createId: () => `remote-session-${++sessionId}`,
    });

    await registry.connect({
      requestId: "docker-1",
      target: { kind: "docker", container: "demo" },
      remoteAssets: {},
    });
    await registry.connect({
      requestId: "docker-2",
      target: { kind: "docker", container: "demo" },
      remoteAssets: {},
    });
    await registry.connect({
      requestId: "server-1",
      target: { kind: "server", url: "https://server.example.com" },
      remoteAssets: {},
    });
    await registry.connect({
      requestId: "server-2",
      target: { kind: "server", url: "https://server.example.com/ws" },
      remoteAssets: {},
    });

    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("listReadyConnections 按连接去重列出已就绪连接及其 target", async () => {
    const ssh = createHandle("ssh-services");
    const pendingDocker = deferred<WindowRemoteConnectionHandle<string>>();
    const connect = vi.fn(async (request: { target: RemoteTarget }) =>
      request.target.kind === "docker" ? pendingDocker.promise : ssh.handle,
    );
    let sessionId = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect,
      createId: () => `remote-session-${++sessionId}`,
    });

    await registry.connect({ requestId: "ssh-1", target: sshTarget, remoteAssets: {} });
    await registry.connect({ requestId: "ssh-2", target: sshTarget, remoteAssets: {} });
    const dockerConnect = registry.connect({
      requestId: "docker-1",
      target: { kind: "docker", container: "demo" },
      remoteAssets: {},
    });

    expect(registry.listReadyConnections()).toEqual([
      { target: sshTarget, services: "ssh-services" },
    ]);

    pendingDocker.resolve(createHandle("docker-services").handle);
    await dockerConnect;
    expect(
      registry
        .listReadyConnections()
        .map((entry) => entry.services)
        .sort(),
    ).toEqual(["docker-services", "ssh-services"]);

    await registry.dispose();
    expect(registry.listReadyConnections()).toEqual([]);
  });

  it("Ignore late completion after cancelling pending connect, and release connection when there is no owner", async () => {
    const pending = deferred<WindowRemoteConnectionHandle<string>>();
    const connection = createHandle("late-services");
    const registry = createWindowRemoteConnectionRegistry({
      connect: () => pending.promise,
      createId: () => "remote-session-late",
    });

    const result = registry.connect({
      requestId: "request-late",
      target: sshTarget,
      remoteAssets: {},
    });
    registry.cancelConnect("request-late");

    await expect(result).rejects.toThrow("Remote connection canceled.");
    pending.resolve(connection.handle);
    await Promise.resolve();
    await Promise.resolve();

    expect(connection.dispose).toHaveBeenCalledTimes(1);
    expect(registry.getSession("remote-session-late")).toBeNull();
  });

  it("After cancelling the last pending connect, reconnecting with the same key creates a new connection using current credentials", async () => {
    const firstPending = deferred<WindowRemoteConnectionHandle<string>>();
    const secondPending = deferred<WindowRemoteConnectionHandle<string>>();
    const firstConnection = createHandle("first-services");
    const secondConnection = createHandle("second-services");
    const observedRequests: Array<{ password?: string; signal: AbortSignal }> = [];
    let connectionId = 0;
    let sessionId = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: (request) => {
        observedRequests.push({
          password: request.target.kind === "ssh" ? request.target.password : undefined,
          signal: request.signal,
        });
        connectionId += 1;
        return connectionId === 1 ? firstPending.promise : secondPending.promise;
      },
      createId: () => `remote-session-${++sessionId}`,
    });

    const first = registry.connect({
      requestId: "request-first",
      target: { ...sshTarget, password: "old-password" },
      remoteAssets: {},
    });
    registry.cancelConnect("request-first");
    await expect(first).rejects.toThrow("Remote connection canceled.");

    const second = registry.connect({
      requestId: "request-second",
      target: { ...sshTarget, password: "new-password" },
      remoteAssets: {},
    });

    expect(observedRequests).toHaveLength(2);
    expect(observedRequests[0]).toMatchObject({
      password: "old-password",
      signal: expect.objectContaining({ aborted: true }),
    });
    expect(observedRequests[1]).toMatchObject({
      password: "new-password",
      signal: expect.objectContaining({ aborted: false }),
    });

    firstPending.resolve(firstConnection.handle);
    secondPending.resolve(secondConnection.handle);
    await expect(second).resolves.toMatchObject({
      remoteSessionId: "remote-session-2",
    });
    await Promise.resolve();

    expect(firstConnection.dispose).toHaveBeenCalledTimes(1);
    expect(secondConnection.dispose).not.toHaveBeenCalled();
    await registry.dispose();
  });

  it("Cancelling one waiter does not abort the connection while the shared connecting entry still has other waiters", async () => {
    const pending = deferred<WindowRemoteConnectionHandle<string>>();
    const connection = createHandle("shared-services");
    const observedSignals: AbortSignal[] = [];
    let sessionId = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: (request) => {
        observedSignals.push(request.signal);
        return pending.promise;
      },
      createId: () => `remote-session-${++sessionId}`,
    });

    const first = registry.connect({
      requestId: "request-first",
      target: sshTarget,
      remoteAssets: {},
    });
    const second = registry.connect({
      requestId: "request-second",
      target: sshTarget,
      remoteAssets: {},
    });

    registry.cancelConnect("request-first");
    await expect(first).rejects.toThrow("Remote connection canceled.");
    expect(observedSignals).toHaveLength(1);
    expect(observedSignals[0]?.aborted).toBe(false);

    pending.resolve(connection.handle);
    await expect(second).resolves.toMatchObject({
      remoteSessionId: "remote-session-2",
    });
    await registry.dispose();
  });

  it("Cancelling WSL pending connect only ends logical waiter without aborting or replacing transport", async () => {
    const pending = deferred<WindowRemoteConnectionHandle<string>>();
    const connection = createHandle("wsl-services");
    const observedSignals: AbortSignal[] = [];
    let sessionId = 0;
    const connect = vi.fn((request: { signal: AbortSignal }) => {
      observedSignals.push(request.signal);
      return pending.promise;
    });
    const registry = createWindowRemoteConnectionRegistry({
      connect,
      createId: () => `remote-session-${++sessionId}`,
    });
    const target: RemoteTarget = { kind: "wsl", distro: "Ubuntu", user: "developer" };

    const first = registry.connect({
      requestId: "request-first",
      target,
      remoteAssets: {},
    });
    registry.cancelConnect("request-first");
    await expect(first).rejects.toThrow("Remote connection canceled.");

    expect(observedSignals[0]?.aborted).toBe(false);
    const second = registry.connect({
      requestId: "request-second",
      target,
      remoteAssets: {},
    });
    expect(connect).toHaveBeenCalledTimes(1);

    pending.resolve(connection.handle);
    await expect(second).resolves.toMatchObject({
      remoteSessionId: "remote-session-2",
    });
    await registry.dispose();
  });

  it("Cancelling Docker pending connect does not trigger underlying abort, keeping subsequent requests dedicated", async () => {
    const firstPending = deferred<WindowRemoteConnectionHandle<string>>();
    const secondPending = deferred<WindowRemoteConnectionHandle<string>>();
    const firstConnection = createHandle("docker-first");
    const secondConnection = createHandle("docker-second");
    const observedSignals: AbortSignal[] = [];
    let connectId = 0;
    let sessionId = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: (request) => {
        observedSignals.push(request.signal);
        connectId += 1;
        return connectId === 1 ? firstPending.promise : secondPending.promise;
      },
      createId: () => `remote-session-${++sessionId}`,
    });
    const target: RemoteTarget = { kind: "docker", container: "demo" };

    const first = registry.connect({
      requestId: "request-first",
      target,
      remoteAssets: {},
    });
    registry.cancelConnect("request-first");
    await expect(first).rejects.toThrow("Remote connection canceled.");
    expect(observedSignals[0]?.aborted).toBe(false);

    const second = registry.connect({
      requestId: "request-second",
      target,
      remoteAssets: {},
    });
    expect(observedSignals).toHaveLength(2);

    firstPending.resolve(firstConnection.handle);
    secondPending.resolve(secondConnection.handle);
    await expect(second).resolves.toMatchObject({
      remoteSessionId: "remote-session-2",
    });
    await Promise.resolve();

    expect(firstConnection.dispose).toHaveBeenCalledTimes(1);
    expect(secondConnection.dispose).not.toHaveBeenCalled();
    await registry.dispose();
  });

  it("Cancelling logical connect reusing ready SSH cache does not destroy window connection", async () => {
    const connection = createHandle("ssh-services");
    const connect = vi.fn(async () => connection.handle);
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect,
      createId: () => `remote-session-${++id}`,
    });
    const first = await registry.connect({
      requestId: "request-first",
      target: sshTarget,
      remoteAssets: {},
    });
    await registry.disposeSession(first.remoteSessionId);

    const cancelled = registry.connect({
      requestId: "request-cancelled",
      target: sshTarget,
      remoteAssets: {},
    });
    registry.cancelConnect("request-cancelled");
    await expect(cancelled).rejects.toThrow("Remote connection canceled.");

    expect(connection.dispose).not.toHaveBeenCalled();
    await registry.connect({
      requestId: "request-after-cancel",
      target: sshTarget,
      remoteAssets: {},
    });
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("Scope must strictly match path and identity in registry", async () => {
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => createHandle("remote-services").handle,
      createId: () => "remote-session-1",
    });
    await registry.connect({
      requestId: "request-1",
      target: sshTarget,
      remoteAssets: {},
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:ssh:dev:/work/demo",
    });

    expect(
      registry.resolveScopedServices({
        kind: "remote",
        remoteSessionId: "remote-session-1",
        workspacePath: "/work/demo",
        workspaceIdentity: "remote:ssh:dev:/work/demo",
      }),
    ).toBe("remote-services");
    expect(() =>
      registry.resolveScopedServices({
        kind: "remote",
        remoteSessionId: "remote-session-1",
        workspacePath: "/work/demo",
        workspaceIdentity: "remote:ssh:other:/work/demo",
      }),
    ).toThrow("远程 attachment scope 与 logical session 不匹配");
    expect(() =>
      registry.resolveScopedServices({
        kind: "remote",
        remoteSessionId: "remote-session-1",
        workspacePath: "/other",
        workspaceIdentity: "remote:ssh:dev:/work/demo",
      }),
    ).toThrow("远程 attachment scope 与 logical session 不匹配");
  });

  it("Retain logical session offline state after disconnect, but fail-closed for all scoped IO", async () => {
    const connection = createHandle("remote-services");
    const closed = vi.fn();
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => "remote-session-1",
      onSessionClosed: closed,
    });
    await registry.connect({
      requestId: "request-1",
      target: sshTarget,
      remoteAssets: {},
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:ssh:dev:/work/demo",
    });

    connection.close();
    connection.close();

    expect(registry.getSession("remote-session-1")).toMatchObject({
      sourceAvailability: "offline",
      state: "disconnected",
    });
    expect(() =>
      registry.resolveScopedServices({
        kind: "remote",
        remoteSessionId: "remote-session-1",
        workspacePath: "/work/demo",
        workspaceIdentity: "remote:ssh:dev:/work/demo",
      }),
    ).toThrow(WindowRemoteConnectionUnavailableError);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledWith(
      expect.objectContaining({ remoteSessionId: "remote-session-1" }),
    );
  });

  it("emits one recovering close and one terminal close while suppressing repeated offline probes", async () => {
    const connection = createHandle("remote-services");
    const closed = vi.fn();
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => "remote-session-1",
      onSessionClosed: closed,
    });
    await registry.connect({ requestId: "request-1", target: sshTarget, remoteAssets: {} });

    connection.close({ exitCode: 255, signal: null, recoverable: true });
    connection.close({ exitCode: null, signal: null, recoverable: false });
    connection.close({ exitCode: null, signal: null, recoverable: false });

    expect(closed).toHaveBeenCalledTimes(2);
    expect(closed.mock.calls.map(([event]) => event.recoverable)).toEqual([true, false]);
  });

  it("forwards each new recovery attempt while suppressing duplicate attempt snapshots", async () => {
    const connection = createHandle("remote-services");
    const closed = vi.fn();
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => "remote-session-1",
      onSessionClosed: closed,
    });
    await registry.connect({ requestId: "request-1", target: sshTarget, remoteAssets: {} });

    connection.close({
      exitCode: 255,
      signal: null,
      recoverable: true,
      recoveryAttempt: 1,
      recoveryLimit: 3,
    });
    connection.close({
      exitCode: 255,
      signal: null,
      recoverable: true,
      recoveryAttempt: 2,
      recoveryLimit: 3,
    });
    connection.close({
      exitCode: 255,
      signal: null,
      recoverable: true,
      recoveryAttempt: 2,
      recoveryLimit: 3,
    });
    connection.close({
      exitCode: null,
      signal: null,
      recoverable: false,
      recoveryAttempt: 3,
      recoveryLimit: 3,
      recoveryBudgetExhausted: true,
    });

    expect(closed.mock.calls.map(([event]) => event.recoveryAttempt)).toEqual([1, 2, 3]);
    expect(closed.mock.calls[2]?.[0]).toMatchObject({ recoveryBudgetExhausted: true });
  });

  it("joins a manual reconnect to the persistent Source entry instead of creating a second connection", async () => {
    const connection = createHandle("old-services", { persistent: true });
    const connect = vi.fn(async () => connection.handle);
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect,
      createId: () => `remote-session-${++id}`,
      shouldKeepConnectionAlive: (handle) => handle.capabilities?.persistent === true,
    });
    await registry.connect({
      requestId: "request-1",
      target: sshTarget,
      remoteAssets: {},
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:server:source-1:/work/demo",
    });
    connection.close({ exitCode: 255, signal: null, recoverable: true });

    let manualResolved = false;
    const manual = registry
      .connect({
        requestId: "request-2",
        target: sshTarget,
        remoteAssets: {},
        workspacePath: "/work/demo",
        workspaceIdentity: "remote:server:source-1:/work/demo",
      })
      .then((descriptor) => {
        manualResolved = true;
        return descriptor;
      });
    await Promise.resolve();
    expect(manualResolved).toBe(false);
    expect(connect).toHaveBeenCalledTimes(1);

    connection.reconnect("new-services");
    const descriptor = await manual;

    expect(descriptor.remoteSessionId).not.toBe("remote-session-1");
    expect(connect).toHaveBeenCalledTimes(1);
    expect(registry.getStats().connectionCount).toBe(1);
    expect(() =>
      registry.findSessionForWorkspace({
        workspacePath: "/work/demo",
        workspaceIdentity: "remote:server:source-1:/work/demo",
      }),
    ).not.toThrow();
    expect(
      registry.findSessionForWorkspace({
        workspacePath: "/work/demo",
        workspaceIdentity: "remote:server:source-1:/work/demo",
      })?.remoteSessionId,
    ).toBe(descriptor.remoteSessionId);
  });

  it("Wait for new recovery when new route reuses same Source, without inheriting terminal failure from old installation", async () => {
    const old = createHandle("old-services", { persistent: true, sourceServerId: "source-1" });
    const fresh = createHandle("new-services", { persistent: true, sourceServerId: "source-1" });
    const preparing = deferred<void>();
    let connections = 0;
    let preparations = 0;
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => {
        connections++;
        if (connections === 1) return old.handle;
        old.reconnect("new-services");
        return fresh.handle;
      },
      createId: () => `terminal-${++id}`,
      resolveSourceServerId: (handle) => handle.capabilities?.sourceServerId,
      shouldKeepConnectionAlive: () => true,
      prepareWorkspaceIdentity: async () => {
        if (++preparations > 1) await preparing.promise;
      },
    });
    const initial = await registry.connect({
      requestId: "initial",
      target: sshTarget,
      remoteAssets: {},
      workspacePath: "/repo",
    });
    old.close({ exitCode: 255, signal: null, recoverable: true });
    old.close({
      exitCode: null,
      signal: null,
      recoverable: false,
      reasonCode: "source-server-install-required",
      retryable: false,
    });
    const confirmed = registry.connect({
      requestId: "confirmed",
      target: { ...sshTarget, password: "fixture-password" },
      remoteAssets: {},
      workspacePath: "/repo",
      confirmSourceServerInstall: true,
    });
    const settled = vi.fn();
    void confirmed.then(settled, settled);
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(connections).toBe(2);
      expect(settled).not.toHaveBeenCalled();
      preparing.resolve();
      const current = await confirmed;
      expect(current.remoteSessionId).not.toBe(initial.remoteSessionId);
      expect(registry.resolveScopedServices({ kind: "remote", ...current })).toBe("new-services");
      expect(registry.getStats()).toEqual({ connectionCount: 1, logicalSessionCount: 1 });
    } finally {
      preparing.resolve();
      await confirmed.catch(() => {});
      await registry.dispose();
    }
  });

  it("preserves terminal recovery reasonCode for a joined reconnect", async () => {
    const connection = createHandle("old-services", { persistent: true });
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => `remote-session-${++id}`,
      shouldKeepConnectionAlive: () => true,
    });
    await registry.connect({ requestId: "one", target: sshTarget, remoteAssets: {} });
    connection.close({ exitCode: 255, signal: null, recoverable: true });
    const reconnect = registry.connect({ requestId: "two", target: sshTarget, remoteAssets: {} });
    const rejection = expect(reconnect).rejects.toMatchObject({
      message: "recovery exhausted",
      code: "source-server-upgrade-required",
      retryable: false,
    });
    connection.close({
      exitCode: null,
      signal: null,
      recoverable: false,
      error: "recovery exhausted",
      reasonCode: "source-server-upgrade-required",
      retryable: false,
    });
    await rejection;
  });

  it("does not publish online when a terminal close arrives during workspace preparation", async () => {
    const connection = createHandle("old-services", {
      persistent: true,
      sourceServerId: "source-1",
    });
    const recoveryPreparation = deferred<void>();
    let prepareCount = 0;
    const closed = vi.fn();
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => `remote-session-${++id}`,
      resolveSourceServerId: () => "source-1",
      shouldKeepConnectionAlive: (handle) => handle.capabilities?.persistent === true,
      prepareWorkspaceIdentity: async () => {
        prepareCount += 1;
        if (prepareCount > 1) await recoveryPreparation.promise;
      },
      onSessionClosed: closed,
    });
    await registry.connect({
      requestId: "request-1",
      target: sshTarget,
      remoteAssets: {},
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:server:source-1:/work/demo",
    });
    connection.close({ exitCode: 255, signal: null, recoverable: true });
    connection.reconnect("new-services");
    await vi.waitFor(() => expect(prepareCount).toBe(2));

    connection.close({ exitCode: null, signal: null, recoverable: false });
    recoveryPreparation.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(registry.listSessions()).toEqual([
      expect.objectContaining({ state: "disconnected", sourceAvailability: "offline" }),
    ]);
    expect(closed.mock.calls.map(([event]) => event.recoverable)).toEqual([true, false]);
  });

  it("rejects recovery join and reports the rolled-back session after a terminal close", async () => {
    const connection = createHandle("old-services", {
      persistent: true,
      sourceServerId: "source-1",
    });
    const recoveryPreparation = deferred<void>();
    let prepareCount = 0;
    const closed = vi.fn();
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => `remote-session-${++id}`,
      resolveSourceServerId: () => "source-1",
      shouldKeepConnectionAlive: (handle) => handle.capabilities?.persistent === true,
      prepareWorkspaceIdentity: async () => {
        prepareCount += 1;
        if (prepareCount > 1) await recoveryPreparation.promise;
      },
      onSessionClosed: closed,
    });
    await registry.connect({
      requestId: "request-1",
      target: sshTarget,
      remoteAssets: {},
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:server:source-1:/work/demo",
    });
    connection.close({ exitCode: 255, signal: null, recoverable: true });
    connection.reconnect("new-services");
    await vi.waitFor(() => expect(prepareCount).toBe(2));

    const joined = registry.connect({
      requestId: "request-join",
      target: sshTarget,
      remoteAssets: {},
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:server:source-1:/work/demo",
    });
    connection.close({ exitCode: null, signal: null, recoverable: false });
    recoveryPreparation.resolve();
    const outcome = await Promise.race([
      joined.then(
        () => "resolved" as const,
        () => "rejected" as const,
      ),
      new Promise<"pending">((resolve) => setImmediate(() => resolve("pending"))),
    ]);

    await registry.dispose();
    await joined.catch(() => undefined);
    expect(outcome).toBe("rejected");
    expect(closed.mock.calls.map(([event]) => event.remoteSessionId)).toEqual([
      "remote-session-1",
      "remote-session-1",
    ]);
  });

  it("does not join a logical session whose workspace preparation is still pending", async () => {
    const connection = createHandle("services", { sourceServerId: "source-1" });
    const firstPreparation = deferred<void>();
    let prepareCount = 0;
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => `remote-session-${++id}`,
      resolveSourceServerId: () => "source-1",
      prepareWorkspaceIdentity: async () => {
        prepareCount += 1;
        if (prepareCount === 1) await firstPreparation.promise;
      },
    });
    const context = {
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:server:source-1:/work/demo",
    };
    const first = registry.connect({
      requestId: "request-1",
      target: sshTarget,
      remoteAssets: {},
      ...context,
    });
    await vi.waitFor(() => expect(prepareCount).toBe(1));

    const second = await registry.connect({
      requestId: "request-2",
      target: sshTarget,
      remoteAssets: {},
      ...context,
    });
    firstPreparation.resolve();
    const firstDescriptor = await first;

    expect(second.remoteSessionId).toBe("remote-session-2");
    expect(firstDescriptor.remoteSessionId).toBe(second.remoteSessionId);
    expect(registry.getStats()).toEqual({ connectionCount: 1, logicalSessionCount: 1 });
    await registry.dispose();
  });

  it("fails a connect whose entry closes while its workspace is preparing", async () => {
    const connection = createHandle("services", { sourceServerId: "source-1" });
    const secondPreparation = deferred<void>();
    let prepareCount = 0;
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => `remote-session-${++id}`,
      resolveSourceServerId: () => "source-1",
      prepareWorkspaceIdentity: async () => {
        prepareCount += 1;
        if (prepareCount > 1) await secondPreparation.promise;
      },
    });
    await registry.connect({
      requestId: "request-1",
      target: sshTarget,
      remoteAssets: {},
      workspacePath: "/work/a",
      workspaceIdentity: "remote:server:source-1:/work/a",
    });
    const connecting = registry.connect({
      requestId: "request-2",
      target: sshTarget,
      remoteAssets: {},
      workspacePath: "/work/b",
      workspaceIdentity: "remote:server:source-1:/work/b",
    });
    await vi.waitFor(() => expect(prepareCount).toBe(2));

    connection.close({ exitCode: null, signal: null, recoverable: false });
    secondPreparation.resolve();

    await expect(connecting).rejects.toBeInstanceOf(WindowRemoteConnectionUnavailableError);
  });

  it("disposes a terminal entry wrapper when a manual connection supersedes it", async () => {
    const stale = createHandle("stale-services", { persistent: true });
    const manual = createHandle("manual-services", { persistent: true });
    const handles = [stale.handle, manual.handle];
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => handles.shift()!,
      createId: () => `remote-session-${++id}`,
      shouldKeepConnectionAlive: (handle) => handle.capabilities?.persistent === true,
    });
    await registry.connect({ requestId: "request-1", target: sshTarget, remoteAssets: {} });
    stale.close({ exitCode: null, signal: null, recoverable: false });

    await registry.connect({ requestId: "request-2", target: sshTarget, remoteAssets: {} });

    expect(stale.dispose).toHaveBeenCalledTimes(1);
    expect(stale.listenerCounts()).toEqual({ close: 0, reconnect: 0 });
    expect(manual.listenerCounts()).toEqual({ close: 1, reconnect: 1 });
  });

  it("Reject recovery waiters and retain new owner when non-persistent entry is preempted", async () => {
    vi.useFakeTimers();
    const stale = createHandle("stale-services");
    const manual = createHandle("manual-services");
    const handles = [stale.handle, manual.handle];
    const connect = vi.fn(async () => handles.shift()!);
    const onSessionReconnected = vi.fn(async () => {
      throw new Error("attachment temporarily unavailable");
    });
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect,
      createId: () => `remote-session-${++id}`,
      shouldKeepConnectionAlive: () => false,
      onSessionReconnected,
    });
    const params = {
      target: { kind: "ssh", host: "remote.example.com", username: "dev" } satisfies RemoteTarget,
      remoteAssets: {},
    };
    try {
      await registry.connect({ ...params, requestId: "initial" });
      stale.close({ exitCode: 255, signal: null, recoverable: true });
      stale.reconnect("recovered-services");
      await vi.advanceTimersByTimeAsync(0);
      expect(onSessionReconnected).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);

      const settled = vi.fn();
      const waiter = registry.connect({ ...params, requestId: "waiter" });
      void waiter.then(settled, settled);
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).not.toHaveBeenCalled();

      stale.close({ exitCode: 255, signal: null, recoverable: true });
      expect(vi.getTimerCount()).toBe(0);
      const current = await registry.connect({ ...params, requestId: "manual" });
      stale.reconnect("late-services");
      await vi.advanceTimersByTimeAsync(0);

      expect(settled).toHaveBeenCalledTimes(1);
      expect(settled).toHaveBeenCalledWith(
        expect.objectContaining({ name: "WindowRemoteConnectCancelledError" }),
      );
      expect(stale.dispose).toHaveBeenCalledTimes(1);
      expect(stale.listenerCounts()).toEqual({ close: 0, reconnect: 0 });
      expect(manual.dispose).not.toHaveBeenCalled();
      expect(connect).toHaveBeenCalledTimes(2);
      expect(registry.getStats()).toEqual({ connectionCount: 1, logicalSessionCount: 1 });
      expect(registry.resolveScopedServices({ kind: "remote", ...current })).toBe(
        "manual-services",
      );
    } finally {
      await registry.dispose();
    }
  });

  it("retires disconnected logical sessions across repeated manual reconnects", async () => {
    const first = createHandle("first-services", { persistent: true });
    const second = createHandle("second-services", { persistent: true });
    const third = createHandle("third-services", { persistent: true });
    const handles = [first.handle, second.handle, third.handle];
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => handles.shift()!,
      createId: () => `remote-session-${++id}`,
      shouldKeepConnectionAlive: (handle) => handle.capabilities?.persistent === true,
    });
    const workspace = {
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:server:source-1:/work/demo",
    };
    const connect = (requestId: string) =>
      registry.connect({
        requestId,
        target: sshTarget,
        remoteAssets: {},
        ...workspace,
      });

    const initial = await connect("request-1");
    first.close({ exitCode: null, signal: null, recoverable: false });
    const reconnected = await connect("request-2");

    expect(registry.getSession(initial.remoteSessionId)).toBeNull();
    expect(registry.getStats()).toEqual({
      connectionCount: 1,
      logicalSessionCount: 1,
    });

    second.close({ exitCode: null, signal: null, recoverable: false });
    expect(() => registry.findSessionForWorkspace(workspace)).not.toThrow();
    expect(registry.findSessionForWorkspace(workspace)).toMatchObject({
      remoteSessionId: reconnected.remoteSessionId,
      state: "disconnected",
    });

    const reconnectedAgain = await connect("request-3");
    expect(registry.getSession(reconnected.remoteSessionId)).toBeNull();
    expect(registry.getStats()).toEqual({
      connectionCount: 1,
      logicalSessionCount: 1,
    });
    expect(registry.findSessionForWorkspace(workspace)).toMatchObject({
      remoteSessionId: reconnectedAgain.remoteSessionId,
      state: "online",
    });
  });

  it("releases a persistent Source wrapper after its last logical session closes", async () => {
    const connection = createHandle("managed-services", { persistent: true });
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => "remote-session-1",
      shouldKeepConnectionAlive: (handle) => handle.capabilities?.persistent === true,
    });
    const descriptor = await registry.connect({
      requestId: "request-1",
      target: sshTarget,
      remoteAssets: {},
    });

    await registry.disposeSession(descriptor.remoteSessionId);

    expect(connection.dispose).toHaveBeenCalledTimes(1);
    expect(connection.listenerCounts()).toEqual({ close: 0, reconnect: 0 });
    expect(registry.getStats()).toEqual({ connectionCount: 0, logicalSessionCount: 0 });
  });

  it("retries logical replacement after the transport is already online", async () => {
    vi.useFakeTimers();
    const connection = createHandle("old-services");
    let replacementAttempts = 0;
    const onSessionReconnected = vi.fn(async ({ commit }: { commit: () => boolean }) => {
      if (replacementAttempts++ === 0) {
        throw new Error("attachment temporarily unavailable");
      }
      commit();
    });
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => `remote-session-${++id}`,
      onSessionReconnected,
      logicalReplacementRetryDelaysMs: [10],
    });
    await registry.connect({
      requestId: "request-1",
      target: sshTarget,
      remoteAssets: {},
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:ssh:dev:/work/demo",
    });
    connection.close();
    connection.reconnect("new-services");
    await vi.waitFor(() => expect(onSessionReconnected).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(10);

    expect(onSessionReconnected).toHaveBeenCalledTimes(2);
    expect(registry.listSessions()).toEqual([
      expect.objectContaining({ state: "online", sourceAvailability: "online" }),
    ]);
  });

  it("Disconnecting again during logical retry wait cancels old retry; waiters resume only after real reconnect", async () => {
    vi.useFakeTimers();
    const connection = createHandle("old-services", { persistent: true });
    let physicalOnline = true;
    let id = 0;
    const prepareWorkspaceIdentity = vi.fn(async () => {
      if (!physicalOnline) throw new Error("transport is closed");
    });
    const closed = vi.fn();
    const onSessionReconnected = vi.fn(async ({ commit }: { commit: () => boolean }) => {
      expect(commit()).toBe(true);
    });
    onSessionReconnected.mockRejectedValueOnce(new Error("attachment temporarily unavailable"));
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => `remote-session-${++id}`,
      shouldKeepConnectionAlive: () => true,
      resolveSourceServerId: () => "source-1",
      prepareWorkspaceIdentity,
      onSessionClosed: closed,
      onSessionReconnected,
    });
    const workspace = {
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:server:source-1:/work/demo",
    };
    try {
      const first = await registry.connect({
        requestId: "initial",
        target: sshTarget,
        remoteAssets: {},
        ...workspace,
      });
      connection.close({ exitCode: 255, signal: null, recoverable: true });
      connection.reconnect("recovered-services");
      await vi.advanceTimersByTimeAsync(0);
      expect(onSessionReconnected).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);

      physicalOnline = false;
      connection.close({ exitCode: 255, signal: null, recoverable: true });
      expect(vi.getTimerCount()).toBe(0);
      let joined = false;
      const waiter = registry.connect({
        requestId: "waiter",
        target: sshTarget,
        remoteAssets: {},
        ...workspace,
      });
      void waiter.then(
        () => {
          joined = true;
        },
        () => undefined,
      );

      await vi.advanceTimersByTimeAsync(3_500);
      expect(joined).toBe(false);
      expect(prepareWorkspaceIdentity).toHaveBeenCalledTimes(2);
      expect(onSessionReconnected).toHaveBeenCalledTimes(1);
      expect(closed.mock.calls.map(([event]) => event.recoverable)).toEqual([true, true]);
      expect(registry.getSession(first.remoteSessionId)).toMatchObject({
        state: "disconnected",
        sourceAvailability: "offline",
      });

      physicalOnline = true;
      connection.reconnect("latest-services");
      const recovered = await waiter;
      expect(joined).toBe(true);
      expect(recovered.remoteSessionId).not.toBe(first.remoteSessionId);
      expect(registry.resolveScopedServices({ kind: "remote", ...recovered })).toBe(
        "latest-services",
      );
      expect(registry.listSessions()).toEqual([
        expect.objectContaining({ state: "online", sourceAvailability: "online" }),
      ]);
    } finally {
      await registry.dispose();
    }
  });

  it("逻辑重试等待期间收到终态关闭会拒绝等待者且不复活旧 session", async () => {
    vi.useFakeTimers();
    const connection = createHandle("old-services", { persistent: true });
    let id = 0;
    const closed = vi.fn();
    const onSessionReconnected = vi.fn(async () => {
      throw new Error("attachment temporarily unavailable");
    });
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => `remote-session-${++id}`,
      shouldKeepConnectionAlive: () => true,
      onSessionClosed: closed,
      onSessionReconnected,
    });
    try {
      const first = await registry.connect({
        requestId: "initial",
        target: sshTarget,
        remoteAssets: {},
      });
      connection.close({ exitCode: 255, signal: null, recoverable: true });
      connection.reconnect("recovered-services");
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(1);
      const waiter = registry.connect({ requestId: "waiter", target: sshTarget, remoteAssets: {} });
      const rejection = expect(waiter).rejects.toThrow("Remote connection recovery exhausted");

      connection.close({ exitCode: 255, signal: null, recoverable: false });
      await rejection;
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(3_500);
      expect(onSessionReconnected).toHaveBeenCalledTimes(1);
      expect(closed.mock.calls.map(([event]) => event.recoverable)).toEqual([true, false]);
      expect(registry.getSession(first.remoteSessionId)).toMatchObject({
        state: "disconnected",
        sourceAvailability: "offline",
      });
    } finally {
      await registry.dispose();
    }
  });

  it("旧逻辑重试回调不能跨 transport epoch 重试或清除新定时器", async () => {
    vi.useFakeTimers();
    const timerSpy = vi.spyOn(globalThis, "setTimeout");
    const connection = createHandle("old-services");
    let id = 0;
    const onSessionReconnected = vi.fn(async () => {
      throw new Error("attachment temporarily unavailable");
    });
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => `remote-session-${++id}`,
      onSessionReconnected,
    });
    try {
      await registry.connect({ requestId: "initial", target: sshTarget, remoteAssets: {} });
      connection.close({ exitCode: 255, signal: null, recoverable: true });
      connection.reconnect("recovered-services");
      await vi.advanceTimersByTimeAsync(0);
      const staleRetry = timerSpy.mock.calls.find(([, delay]) => delay === 500)?.[0];
      if (typeof staleRetry !== "function") throw new Error("missing logical retry");

      connection.close({ exitCode: 255, signal: null, recoverable: true });
      staleRetry();
      await vi.advanceTimersByTimeAsync(0);
      expect(onSessionReconnected).toHaveBeenCalledTimes(1);

      connection.reconnect("latest-services");
      await vi.advanceTimersByTimeAsync(0);
      expect(onSessionReconnected).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(1);
      staleRetry();
      await vi.advanceTimersByTimeAsync(0);
      expect(onSessionReconnected).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(1);
      connection.close({ exitCode: 255, signal: null, recoverable: true });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await registry.dispose();
      timerSpy.mockRestore();
    }
  });

  it("commit 后的通知异常不会回滚已发布 generation", async () => {
    const connection = createHandle("old-services");
    const reconnectError = vi.fn();
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => `remote-session-${++id}`,
      onSessionReconnectError: reconnectError,
      onSessionReconnected: async ({ commit }) => {
        expect(commit()).toBe(true);
        throw new Error("post-commit notification failed");
      },
    });
    const workspace = {
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:ssh:dev:/work/demo",
    };
    const first = await registry.connect({
      requestId: "request-1",
      target: sshTarget,
      remoteAssets: {},
      ...workspace,
    });

    connection.close({ exitCode: 255, signal: null, recoverable: true });
    connection.reconnect("new-services");
    await vi.waitFor(() => expect(reconnectError).toHaveBeenCalledTimes(1));

    expect(registry.getSession(first.remoteSessionId)).toBeNull();
    expect(registry.findSessionForWorkspace(workspace)).toMatchObject({
      remoteSessionId: "remote-session-2",
      generation: 2,
      state: "online",
      sourceAvailability: "online",
    });
  });

  it("Failure of the second workspace replacement does not roll back the committed first workspace", async () => {
    const connection = createHandle("old-services");
    const closed = vi.fn();
    const onSessionReconnected = vi.fn(
      async ({
        current,
        commit,
      }: {
        current: { workspacePath?: string };
        commit: () => boolean;
      }) => {
        if (current.workspacePath === "/work/b") {
          throw new Error("workspace b attachment unavailable");
        }
        commit();
      },
    );
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => `remote-session-${++id}`,
      onSessionClosed: closed,
      onSessionReconnected,
      logicalReplacementRetryDelaysMs: [],
    });
    const workspaceA = {
      workspacePath: "/work/a",
      workspaceIdentity: "remote:ssh:dev:/work/a",
    };
    const workspaceB = {
      workspacePath: "/work/b",
      workspaceIdentity: "remote:ssh:dev:/work/b",
    };
    const workspaceC = {
      workspacePath: "/work/c",
      workspaceIdentity: "remote:ssh:dev:/work/c",
    };
    const first = await registry.connect({
      requestId: "request-a",
      target: sshTarget,
      remoteAssets: {},
      ...workspaceA,
    });
    const second = await registry.connect({
      requestId: "request-b",
      target: sshTarget,
      remoteAssets: {},
      ...workspaceB,
    });
    const third = await registry.connect({
      requestId: "request-c",
      target: sshTarget,
      remoteAssets: {},
      ...workspaceC,
    });

    connection.close({ exitCode: 255, signal: null, recoverable: true });
    connection.reconnect("new-services");
    await vi.waitFor(() => expect(onSessionReconnected).toHaveBeenCalledTimes(3));
    await vi.waitFor(() =>
      expect(closed.mock.calls.filter(([event]) => event.recoverable === false)).toHaveLength(1),
    );

    expect(registry.getSession(first.remoteSessionId)).toBeNull();
    expect(registry.findSessionForWorkspace(workspaceA)).toMatchObject({
      remoteSessionId: "remote-session-4",
      generation: 2,
      state: "online",
      sourceAvailability: "online",
    });
    expect(registry.findSessionForWorkspace(workspaceB)).toMatchObject({
      remoteSessionId: second.remoteSessionId,
      generation: 1,
      state: "disconnected",
      sourceAvailability: "offline",
    });
    expect(registry.getSession("remote-session-5")).toBeNull();
    expect(registry.getSession(third.remoteSessionId)).toBeNull();
    expect(registry.findSessionForWorkspace(workspaceC)).toMatchObject({
      remoteSessionId: "remote-session-6",
      generation: 2,
      state: "online",
      sourceAvailability: "online",
    });
    expect(
      registry.resolveScopedServices({
        kind: "remote",
        remoteSessionId: "remote-session-4",
        ...workspaceA,
      }),
    ).toBe("new-services");
    expect(
      closed.mock.calls
        .filter(([event]) => event.recoverable === false)
        .map(([event]) => event.remoteSessionId),
    ).toEqual([second.remoteSessionId]);

    const fourth = await registry.connect({
      requestId: "request-d",
      target: sshTarget,
      remoteAssets: {},
      workspacePath: "/work/d",
      workspaceIdentity: "remote:ssh:dev:/work/d",
    });
    expect(fourth).toMatchObject({
      remoteSessionId: "remote-session-7",
      generation: 1,
    });
    expect(registry.findSessionForWorkspace(workspaceA)).toMatchObject({
      remoteSessionId: "remote-session-4",
      state: "online",
    });
  });

  it("只重试尚未提交的 workspace replacement", async () => {
    vi.useFakeTimers();
    const connection = createHandle("old-services");
    const replacementCalls: string[] = [];
    let workspaceBAttempts = 0;
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => `remote-session-${++id}`,
      onSessionReconnected: async ({ current, commit }) => {
        replacementCalls.push(current.workspacePath!);
        if (current.workspacePath === "/work/b" && workspaceBAttempts++ === 0) {
          throw new Error("workspace b attachment temporarily unavailable");
        }
        commit();
      },
      logicalReplacementRetryDelaysMs: [10],
    });
    const workspaceA = {
      workspacePath: "/work/a",
      workspaceIdentity: "remote:ssh:dev:/work/a",
    };
    const workspaceB = {
      workspacePath: "/work/b",
      workspaceIdentity: "remote:ssh:dev:/work/b",
    };
    await registry.connect({
      requestId: "request-a",
      target: sshTarget,
      remoteAssets: {},
      ...workspaceA,
    });
    await registry.connect({
      requestId: "request-b",
      target: sshTarget,
      remoteAssets: {},
      ...workspaceB,
    });

    connection.close({ exitCode: 255, signal: null, recoverable: true });
    connection.reconnect("new-services");
    await vi.waitFor(() => expect(replacementCalls).toEqual(["/work/a", "/work/b"]));
    expect(registry.findSessionForWorkspace(workspaceA)).toMatchObject({
      remoteSessionId: "remote-session-3",
      generation: 2,
      state: "online",
    });

    await vi.advanceTimersByTimeAsync(10);
    await vi.waitFor(() => expect(replacementCalls).toEqual(["/work/a", "/work/b", "/work/b"]));

    expect(registry.findSessionForWorkspace(workspaceA)).toMatchObject({
      remoteSessionId: "remote-session-3",
      generation: 2,
      state: "online",
    });
    expect(registry.findSessionForWorkspace(workspaceB)).toMatchObject({
      remoteSessionId: "remote-session-5",
      generation: 2,
      state: "online",
    });
  });

  it("Do not publish in-flight replacement if physical connection closes again after sibling is committed", async () => {
    const connection = createHandle("old-services");
    const workspaceBReplacement = deferred<void>();
    const workspaceBStarted = deferred<void>();
    const closed = vi.fn();
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => `remote-session-${++id}`,
      onSessionClosed: closed,
      onSessionReconnected: async ({ current, commit }) => {
        if (current.workspacePath !== "/work/b") {
          commit();
          return;
        }
        workspaceBStarted.resolve();
        await workspaceBReplacement.promise;
        commit();
      },
    });
    const workspaceA = {
      workspacePath: "/work/a",
      workspaceIdentity: "remote:ssh:dev:/work/a",
    };
    const workspaceB = {
      workspacePath: "/work/b",
      workspaceIdentity: "remote:ssh:dev:/work/b",
    };
    const first = await registry.connect({
      requestId: "request-a",
      target: sshTarget,
      remoteAssets: {},
      ...workspaceA,
    });
    const second = await registry.connect({
      requestId: "request-b",
      target: sshTarget,
      remoteAssets: {},
      ...workspaceB,
    });
    connection.close({ exitCode: 255, signal: null, recoverable: true });
    connection.reconnect("new-services");
    await workspaceBStarted.promise;

    connection.close({ exitCode: null, signal: null, recoverable: false });
    workspaceBReplacement.resolve();
    await vi.waitFor(() =>
      expect(closed.mock.calls.filter(([event]) => event.recoverable === false)).toHaveLength(2),
    );

    expect(registry.getSession(first.remoteSessionId)).toBeNull();
    expect(registry.getSession("remote-session-4")).toBeNull();
    expect(registry.findSessionForWorkspace(workspaceA)).toMatchObject({
      remoteSessionId: "remote-session-3",
      state: "disconnected",
      sourceAvailability: "offline",
    });
    expect(registry.findSessionForWorkspace(workspaceB)).toMatchObject({
      remoteSessionId: second.remoteSessionId,
      state: "disconnected",
      sourceAvailability: "offline",
    });
    expect(
      closed.mock.calls
        .filter(([event]) => event.recoverable === false)
        .map(([event]) => event.remoteSessionId),
    ).toEqual(["remote-session-3", second.remoteSessionId]);
  });

  it("emits a terminal close when logical replacement exhausts its retry budget", async () => {
    const connection = createHandle("old-services");
    const closed = vi.fn();
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: (() => {
        let id = 0;
        return () => `remote-session-${++id}`;
      })(),
      onSessionClosed: closed,
      onSessionReconnected: async () => {
        throw new Error("attachment permanently unavailable");
      },
      logicalReplacementRetryDelaysMs: [],
    });
    await registry.connect({
      requestId: "request-1",
      target: sshTarget,
      remoteAssets: {},
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:ssh:dev:/work/demo",
    });
    connection.close({ exitCode: 255, signal: null, recoverable: true });
    connection.reconnect("new-services");

    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(2));
    expect(closed.mock.calls[1]?.[0]).toMatchObject({
      recoverable: false,
      error: "attachment permanently unavailable",
    });
  });

  it("replaces disconnected logical sessions with a new id and the reconnected services", async () => {
    const connection = createHandle("old-services");
    const replacements: Array<{
      previous: { remoteSessionId: string };
      current: { remoteSessionId: string };
    }> = [];
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => `remote-session-${++id}`,
      onSessionReconnected: async ({ previous, current, commit }) => {
        commit();
        replacements.push({ previous, current });
      },
    });
    const first = await registry.connect({
      requestId: "request-1",
      target: sshTarget,
      remoteAssets: {},
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:ssh:dev:/work/demo",
    });
    connection.close();

    connection.reconnect("new-services");
    await vi.waitFor(() => expect(replacements).toHaveLength(1));

    const replacement = replacements[0]!;
    expect(replacement.previous.remoteSessionId).toBe(first.remoteSessionId);
    expect(replacement.current.remoteSessionId).toBe("remote-session-2");
    expect(registry.getSession(first.remoteSessionId)).toBeNull();
    expect(registry.getSession(replacement.current.remoteSessionId)).toMatchObject({
      state: "online",
      sourceAvailability: "online",
    });
    expect(
      registry.resolveScopedServices({
        kind: "remote",
        remoteSessionId: replacement.current.remoteSessionId,
        workspacePath: "/work/demo",
        workspaceIdentity: "remote:ssh:dev:/work/demo",
      }),
    ).toBe("new-services");
  });

  it("does not let a stale automatic reconnect overwrite a newer manual connection entry", async () => {
    const stale = createHandle("stale-services");
    const manual = createHandle("manual-services");
    const handles = [stale.handle, manual.handle];
    let id = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => handles.shift()!,
      createId: () => `remote-session-${++id}`,
    });
    const workspacePath = "/work/demo";
    const workspaceIdentity = "remote:server:source-1:/work/demo";
    const first = await registry.connect({
      requestId: "request-1",
      target: sshTarget,
      remoteAssets: {},
      workspacePath,
      workspaceIdentity,
    });
    stale.close();
    const second = await registry.connect({
      requestId: "request-2",
      target: sshTarget,
      remoteAssets: {},
      workspacePath,
      workspaceIdentity,
    });

    stale.reconnect("stale-recovered-services");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(first.remoteSessionId).not.toBe(second.remoteSessionId);
    expect(() =>
      registry.findSessionForWorkspace({ workspacePath, workspaceIdentity }),
    ).not.toThrow();
    expect(registry.findSessionForWorkspace({ workspacePath, workspaceIdentity })).toMatchObject({
      remoteSessionId: second.remoteSessionId,
      state: "online",
    });
    expect(stale.dispose).toHaveBeenCalledTimes(1);
    expect(manual.dispose).not.toHaveBeenCalled();
  });

  it("disposeSession 与 registry dispose 都是幂等的", async () => {
    const connection = createHandle("remote-services");
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => "remote-session-1",
    });
    await registry.connect({ requestId: "request-1", target: sshTarget, remoteAssets: {} });

    await registry.disposeSession("remote-session-1");
    await registry.disposeSession("remote-session-1");
    await registry.dispose();
    await registry.dispose();

    expect(connection.dispose).toHaveBeenCalledTimes(1);
  });

  it("WSL retains 60-second idle TTL, with release deferred by running task protection", async () => {
    vi.useFakeTimers();
    const connection = createHandle("wsl-services");
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => "remote-session-wsl",
      wslIdleTtlMs: 60_000,
    });
    await registry.connect({
      requestId: "request-wsl",
      target: { kind: "wsl", distro: "Ubuntu" },
      remoteAssets: {},
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:wsl:Ubuntu:/work/demo",
    });
    registry.setWorkspaceRunningTaskCount({
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:wsl:Ubuntu:/work/demo",
      runningTaskCount: 1,
    });
    await registry.disposeSession("remote-session-wsl");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connection.dispose).not.toHaveBeenCalled();

    registry.setWorkspaceRunningTaskCount({
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:wsl:Ubuntu:/work/demo",
      runningTaskCount: 0,
    });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(connection.dispose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(connection.dispose).toHaveBeenCalledTimes(1);
  });

  it("WSL shared connection releases runtime by workspace without affecting other logical sessions", async () => {
    const connection = createHandle("wsl-services");
    const releaseWorkspace = vi.fn(async () => undefined);
    let sessionId = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => `remote-session-${++sessionId}`,
      releaseWorkspace,
    });
    const first = await registry.connect({
      requestId: "request-a",
      target: { kind: "wsl", distro: "Ubuntu" },
      remoteAssets: {},
      workspacePath: "/work/a",
      workspaceIdentity: "remote:wsl:Ubuntu:/work/a",
    });
    const second = await registry.connect({
      requestId: "request-b",
      target: { kind: "wsl", distro: "Ubuntu" },
      remoteAssets: {},
      workspacePath: "/work/b",
      workspaceIdentity: "remote:wsl:Ubuntu:/work/b",
    });

    await registry.disposeSession(first.remoteSessionId);

    expect(releaseWorkspace).toHaveBeenCalledWith("wsl-services", {
      workspacePath: "/work/a",
      workspaceIdentity: "remote:wsl:Ubuntu:/work/a",
    });
    expect(connection.dispose).not.toHaveBeenCalled();
    expect(registry.getSession(second.remoteSessionId)).toMatchObject({ state: "online" });
  });

  it("WSL workspace 有运行中 task 时延迟 runtime release，归零后再释放", async () => {
    const connection = createHandle("wsl-services");
    const releaseWorkspace = vi.fn(async () => undefined);
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => "remote-session-wsl",
      releaseWorkspace,
    });
    const descriptor = await registry.connect({
      requestId: "request-wsl",
      target: { kind: "wsl", distro: "Ubuntu" },
      remoteAssets: {},
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:wsl:Ubuntu:/work/demo",
    });
    registry.setWorkspaceRunningTaskCount({
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:wsl:Ubuntu:/work/demo",
      runningTaskCount: 1,
    });

    await registry.disposeSession(descriptor.remoteSessionId);
    expect(releaseWorkspace).not.toHaveBeenCalled();

    registry.setWorkspaceRunningTaskCount({
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:wsl:Ubuntu:/work/demo",
      runningTaskCount: 0,
    });
    await vi.waitFor(() => expect(releaseWorkspace).toHaveBeenCalledTimes(1));
  });

  it("Quick reopening of WSL workspace invalidates unstarted old generation release", async () => {
    const connection = createHandle("wsl-services");
    const releaseWorkspace = vi.fn(async () => undefined);
    let sessionId = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => `remote-session-${++sessionId}`,
      releaseWorkspace,
    });
    const context = {
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:wsl:Ubuntu:/work/demo",
    };
    const first = await registry.connect({
      requestId: "request-1",
      target: { kind: "wsl", distro: "Ubuntu" },
      remoteAssets: {},
      ...context,
    });
    registry.setWorkspaceRunningTaskCount({ ...context, runningTaskCount: 1 });
    await registry.disposeSession(first.remoteSessionId);

    await registry.connect({
      requestId: "request-2",
      target: { kind: "wsl", distro: "Ubuntu" },
      remoteAssets: {},
      ...context,
    });
    registry.setWorkspaceRunningTaskCount({ ...context, runningTaskCount: 0 });
    await Promise.resolve();

    expect(releaseWorkspace).not.toHaveBeenCalled();
  });

  it("WSL workspace 重开会等待上一代 in-flight release 完成", async () => {
    const connection = createHandle("wsl-services");
    const release = deferred<void>();
    const releaseWorkspace = vi.fn(() => release.promise);
    let sessionId = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => `remote-session-${++sessionId}`,
      releaseWorkspace,
    });
    const context = {
      workspacePath: "/work/demo",
      workspaceIdentity: "remote:wsl:Ubuntu:/work/demo",
    };
    const first = await registry.connect({
      requestId: "request-1",
      target: { kind: "wsl", distro: "Ubuntu" },
      remoteAssets: {},
      ...context,
    });

    const dispose = registry.disposeSession(first.remoteSessionId);
    await vi.waitFor(() => expect(releaseWorkspace).toHaveBeenCalledTimes(1));
    let connected = false;
    const reconnect = registry
      .connect({
        requestId: "request-2",
        target: { kind: "wsl", distro: "Ubuntu" },
        remoteAssets: {},
        ...context,
      })
      .then(() => {
        connected = true;
      });
    await Promise.resolve();
    expect(connected).toBe(false);

    release.resolve();
    await Promise.all([dispose, reconnect]);
    expect(connected).toBe(true);
  });

  it("WSL target-only session rebinds context and waits for generation barrier before exposing scoped services", async () => {
    const connection = createHandle("wsl-services");
    const release = deferred<void>();
    const releaseWorkspace = vi.fn(() => release.promise);
    let sessionId = 0;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => `remote-session-${++sessionId}`,
      releaseWorkspace,
    });
    const target = { kind: "wsl", distro: "Ubuntu", user: "ai" } as const;
    const context = {
      workspacePath: "/home/ai/projects",
      workspaceIdentity: "remote:wsl:Ubuntu:ai:/home/ai/projects",
    };
    const first = await registry.connect({
      requestId: "request-first",
      target,
      remoteAssets: {},
      ...context,
    });
    const disposeFirst = registry.disposeSession(first.remoteSessionId);
    await vi.waitFor(() => expect(releaseWorkspace).toHaveBeenCalledOnce());

    const targetOnly = await registry.connect({
      requestId: "request-target-only",
      target,
      remoteAssets: {},
    });
    const bind = registry.bindWorkspaceContext({
      remoteSessionId: targetOnly.remoteSessionId,
      ...context,
    });
    const attach = registry.waitForScopedServices({
      kind: "remote",
      remoteSessionId: targetOnly.remoteSessionId,
      ...context,
    });

    const attachmentState = await Promise.race([
      attach.then(
        () => "ready" as const,
        () => "failed" as const,
      ),
      new Promise<"pending">((resolve) => setImmediate(() => resolve("pending"))),
    ]);

    release.resolve();
    await expect(attach).resolves.toBe("wsl-services");
    await Promise.all([disposeFirst, bind]);
    expect(attachmentState).toBe("pending");
  });

  it("rolls back a workspace re-scope when preparation is aborted", async () => {
    const connection = createHandle("remote-services", {
      persistent: true,
      sourceServerId: "source-1",
    });
    const preparation = deferred<void>();
    let prepareCount = 0;
    let receivedSignal: AbortSignal | undefined;
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => connection.handle,
      createId: () => "remote-session-1",
      resolveSourceServerId: () => "source-1",
      shouldKeepConnectionAlive: () => true,
      prepareWorkspaceIdentity: async (_handle, input) => {
        if (++prepareCount > 1) {
          receivedSignal = input.signal;
          await preparation.promise;
        }
      },
    });
    const descriptor = await registry.connect({
      requestId: "one",
      target: sshTarget,
      remoteAssets: {},
      workspacePath: "/old",
      workspaceIdentity: "remote:server:source-1:/old",
    });
    const before = registry.getSession(descriptor.remoteSessionId);
    const controller = new AbortController();
    const binding = registry.bindWorkspaceContext({
      remoteSessionId: descriptor.remoteSessionId,
      workspacePath: "/new",
      workspaceIdentity: "remote:server:source-1:/new",
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(receivedSignal).toBe(controller.signal));
    controller.abort();
    await expect(binding).rejects.toMatchObject({ name: "AbortError" });
    expect(registry.getSession(descriptor.remoteSessionId)).toMatchObject({
      workspacePath: before?.workspacePath,
      workspaceIdentity: before?.workspaceIdentity,
      generation: before?.generation,
    });
    preparation.resolve();
  });
});

describe("项目导航只复用在线 Source scope", () => {
  function setup() {
    let sequence = 0;
    const physical = createHandle("services", { sourceServerId: "source", persistent: true });
    const connect = vi.fn(async () => physical.handle);
    const registry = createWindowRemoteConnectionRegistry({
      connect,
      createId: () => `scope-${++sequence}`,
      resolveSourceServerId: (handle) => handle.capabilities?.sourceServerId,
      shouldKeepConnectionAlive: (handle) => handle.capabilities?.persistent === true,
      prepareWorkspaceIdentity: vi.fn(async () => undefined),
    });
    const open = (assertCurrent = async () => undefined) =>
      registry.openWorkspaceOnSource({
        requestId: `request-${++sequence}`,
        sourceServerId: "source",
        workspacePath: "/new",
        assertCurrent,
      });
    return { physical, connect, registry, open };
  }
  it("Unknown or offline Source does not trigger connector; online tabless Source creates only one directory scope", async () => {
    const f = setup();
    try {
      await expect(f.open()).rejects.toThrow();
      expect(f.connect).not.toHaveBeenCalled();
      await f.registry.connectSource({
        target: { kind: "server", url: "http://source", serverId: "source" },
        remoteAssets: {},
      });
      const first = await f.open();
      const next = await f.open();
      expect(first.remoteSessionId).toBe(next.remoteSessionId);
      expect(first.workspaceIdentity).toBe("remote:server:source:/new");
      expect(f.registry.getStats()).toEqual({ connectionCount: 1, logicalSessionCount: 1 });
      expect(f.connect).toHaveBeenCalledTimes(1);
      f.physical.close();
      await expect(f.open()).rejects.toThrow();
      expect(f.connect).toHaveBeenCalledTimes(1);
    } finally {
      await f.registry.dispose();
    }
  });
  it("admission 失败只撤销自己的 provisional scope，保留已存在的桌面 owner", async () => {
    const f = setup();
    try {
      await f.registry.connectSource({
        target: { kind: "server", url: "http://source", serverId: "source" },
        remoteAssets: {},
      });
      const desktop = await f.open();
      await expect(
        f.open(async () => {
          throw new Error("removed");
        }),
      ).rejects.toThrow("removed");
      expect(f.registry.getSession(desktop.remoteSessionId)?.state).toBe("online");
      expect(f.registry.getStats()).toEqual({ connectionCount: 1, logicalSessionCount: 1 });
      expect(f.physical.dispose).not.toHaveBeenCalled();
    } finally {
      await f.registry.dispose();
    }
  });
});

it("Preserve reuse-only flag and reject mismatched identity returns when registering Manager online connection as Source", async () => {
  const physical = createHandle("services", { sourceServerId: "actual", persistent: true });
  const connect = vi.fn(async () => physical.handle);
  const registry = createWindowRemoteConnectionRegistry({
    connect,
    createId: () => "unused",
    resolveSourceServerId: (handle) => handle.capabilities?.sourceServerId,
    shouldKeepConnectionAlive: (handle) => handle.capabilities?.persistent === true,
  });
  try {
    await expect(
      registry.connectSource({
        target: sshTarget,
        remoteAssets: {},
        membershipIntent: "retain",
        existingSourceServerId: "expected",
      }),
    ).rejects.toThrow();
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({ existingSourceServerId: "expected", membershipIntent: "retain" }),
    );
  } finally {
    await registry.dispose();
  }
});
