import { describe, expect, it, vi } from "vitest";
import { Emitter } from "@origin-ai/cf-rpc";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import type {
  SessionSummary,
  SessionsIndexTopicFrame,
  SessionsIndexTopicWireFrame,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  acquireSessionsIndex,
  buildSessionsIndexEntryKey,
  releaseSessionsIndex,
  sessionsIndexRegistrySize,
  type SessionsIndexAgentService,
} from "@/v4/sessionsIndexRegistry.js";
import { SessionsIndexStore } from "@/v4/sessionsIndexStore.js";
import {
  registerRemoteWorkspaceSession,
  unregisterRemoteWorkspaceSession,
} from "@/store/remoteWorkspaceSessionStore.js";

function mockAgentService(): SessionsIndexAgentService {
  const runtimeRestarts = new Emitter<{ workspaceKey: string }>();
  return {
    helloConversationV4: vi.fn(async () => ({
      kind: "hello" as const,
      protocolVersion: 3 as const,
      connectionId: "test-connection",
      clientMode: "desktop-continuous" as const,
      deliveryProfile: "continuous" as const,
      serverTime: 1,
      capabilities: {
        nativeDialogs: true,
        localTerminal: true,
        binaryFrames: false,
        compression: "none" as const,
      },
      auth: {},
    })),
    initializeConversationV4: vi.fn(async () => {}),
    subscribeSessionsIndexV4: vi.fn(async () => ({
      ack: {
        subscriptionId: "sub-1",
        mode: "snapshot" as const,
        logEpoch: "e1",
      },
    })),
    unsubscribeSessionsIndexV4: vi.fn(async () => {}),
    resyncSessionsIndexV4: vi.fn(async (params) => ({
      ack: {
        subscriptionId: params.subscriptionId,
        mode: "snapshot" as const,
        logEpoch: "e1",
      },
    })),
    onDynamicSessionsIndexFrame: vi.fn(() => () => ({ dispose: () => {} })),
    onAgentRuntimeRestarted: runtimeRestarts.event,
  } as unknown as SessionsIndexAgentService;
}

function createReplacingRemoteServices(
  workspaceKey: string,
  clientMode: "desktop-continuous" | "web-remote-replayable",
) {
  let nextSubscription = 1;
  let nextLogicalFrame = 1;
  let currentSeq = 1;
  let active: { serviceKey: string; subscriptionId: string } | null = null;
  const listenersByService = new Map<string, Set<(frame: SessionsIndexTopicWireFrame) => void>>();

  const physicalFrame = (
    frame: SessionsIndexTopicFrame,
    deliveryKind: "initial" | "online",
  ): SessionsIndexTopicWireFrame => ({
    wireVersion: 3,
    kind: "complete",
    deliveryKind,
    logicalFrameId: `logical-${nextLogicalFrame}`,
    logicalFrameOrdinal: nextLogicalFrame++,
    topic: frame.topic,
    subscriptionId: frame.subscriptionId,
    frame,
  });
  const snapshotFrame = (subscriptionId: string): SessionsIndexTopicFrame => ({
    topic: `sessions-index/${workspaceKey}`,
    subscriptionId,
    fromSeq: 0,
    toSeq: 1,
    sentAt: 1,
    payload: {
      kind: "snapshot",
      snapshot: {
        protocolVersion: 1,
        workspaceId: workspaceKey,
        logEpoch: "epoch-1",
        sessions: [],
      },
    },
  });

  const createService = (serviceKey: string): SessionsIndexAgentService => {
    const runtimeRestarts = new Emitter<{ workspaceKey: string }>();
    const listeners = new Set<(frame: SessionsIndexTopicWireFrame) => void>();
    listenersByService.set(serviceKey, listeners);
    return {
      helloConversationV4: vi.fn(async () => ({
        kind: "hello" as const,
        protocolVersion: 3 as const,
        connectionId: "shared-remote-connection",
        clientMode,
        deliveryProfile: clientMode === "desktop-continuous" ? "continuous" : "replayable",
        serverTime: 1,
        capabilities: {
          nativeDialogs: true,
          localTerminal: true,
          binaryFrames: false,
          compression: "none" as const,
        },
        auth: {},
      })),
      initializeConversationV4: vi.fn(async () => {}),
      subscribeSessionsIndexV4: vi.fn(async () => {
        const subscriptionId = `sub-${nextSubscription++}`;
        active = { serviceKey, subscriptionId };
        const initial = physicalFrame(snapshotFrame(subscriptionId), "initial");
        for (const listener of listeners) listener(initial);
        return {
          ack: {
            subscriptionId,
            mode: "snapshot" as const,
            logEpoch: "epoch-1",
          },
        };
      }),
      unsubscribeSessionsIndexV4: vi.fn(async (params) => {
        if (active?.subscriptionId === params.subscriptionId) active = null;
      }),
      resyncSessionsIndexV4: vi.fn(async (params) => ({
        ack: {
          subscriptionId: params.subscriptionId,
          mode: "snapshot" as const,
          logEpoch: "epoch-1",
        },
      })),
      onDynamicSessionsIndexFrame: vi.fn(
        () => (listener: (frame: SessionsIndexTopicWireFrame) => void) => {
          listeners.add(listener);
          return { dispose: () => listeners.delete(listener) };
        },
      ),
      onAgentRuntimeRestarted: runtimeRestarts.event,
    } as unknown as SessionsIndexAgentService;
  };

  return {
    oldService: createService("old"),
    newService: createService("new"),
    emitUpsert(session: SessionSummary) {
      if (!active) return;
      const frame: SessionsIndexTopicFrame = {
        topic: `sessions-index/${workspaceKey}`,
        subscriptionId: active.subscriptionId,
        fromSeq: currentSeq,
        toSeq: currentSeq + 1,
        sentAt: 2,
        payload: {
          kind: "deltas",
          deltas: [{ op: "session.upserted", session }],
        },
      };
      for (const listener of listenersByService.get(active.serviceKey) ?? []) {
        listener(physicalFrame(frame, "online"));
      }
      currentSeq += 1;
    },
  };
}

describe("sessionsIndexRegistry", () => {
  it("Reference count: same endpoint and workspaceKey reuse store, removed only when count reaches zero", async () => {
    const service = mockAgentService();
    const scope = { workspaceKey: "ws-1", workspacePath: "/ws" };

    const a = acquireSessionsIndex(scope, service);
    const b = acquireSessionsIndex(scope, service);
    expect(a).toBe(b);
    expect(sessionsIndexRegistrySize()).toBe(1);
    await vi.waitFor(() => expect(service.subscribeSessionsIndexV4).toHaveBeenCalledTimes(1));

    releaseSessionsIndex(scope, a);
    expect(sessionsIndexRegistrySize()).toBe(1);
    releaseSessionsIndex(scope, b);
    expect(sessionsIndexRegistrySize()).toBe(0);
  });

  it("不同 workspace 各自独立 store", async () => {
    const service = mockAgentService();
    const s1 = acquireSessionsIndex({ workspaceKey: "ws-a", workspacePath: "/a" }, service);
    const s2 = acquireSessionsIndex({ workspaceKey: "ws-b", workspacePath: "/b" }, service);
    expect(s1).not.toBe(s2);
    expect(sessionsIndexRegistrySize()).toBe(2);
    await vi.waitFor(() => expect(service.subscribeSessionsIndexV4).toHaveBeenCalledTimes(2));
    releaseSessionsIndex({ workspaceKey: "ws-a" }, s1);
    releaseSessionsIndex({ workspaceKey: "ws-b" }, s2);
    expect(sessionsIndexRegistrySize()).toBe(0);
  });

  it("M5 ③: Same workspaceKey with different endpoints do not share store, each running its own agentService subscription", async () => {
    const localService = mockAgentService();
    const remoteService = mockAgentService();
    const localScope = { workspaceKey: "ws-1", workspacePath: "/ws" };
    const remoteScope = {
      workspaceKey: "ws-1",
      workspacePath: "/ws",
      endpointKey: "remote-session-1",
    };

    const localStore = acquireSessionsIndex(localScope, localService);
    const remoteStore = acquireSessionsIndex(remoteScope, remoteService);
    expect(localStore).not.toBe(remoteStore);
    expect(sessionsIndexRegistrySize()).toBe(2);
    await vi.waitFor(() => {
      expect(localService.subscribeSessionsIndexV4).toHaveBeenCalledTimes(1);
      expect(remoteService.subscribeSessionsIndexV4).toHaveBeenCalledTimes(1);
    });

    const remoteStoreAgain = acquireSessionsIndex(remoteScope, remoteService);
    expect(remoteStoreAgain).toBe(remoteStore);
    expect(remoteService.subscribeSessionsIndexV4).toHaveBeenCalledTimes(1);

    releaseSessionsIndex(localScope, localStore);
    releaseSessionsIndex(remoteScope, remoteStore);
    releaseSessionsIndex(remoteScope, remoteStoreAgain);
    expect(sessionsIndexRegistrySize()).toBe(0);
  });

  it.each(["desktop-continuous", "web-remote-replayable"] as const)(
    "When remote agentService upgrades generation, legacy consumers continue receiving subsequent tasks from the same store (%s)",
    async (clientMode) => {
      const scope = {
        workspaceKey: "ssh:repo",
        workspacePath: "/repo",
        workspaceIdentity: "ssh:repo",
        endpointKey: "remote-1",
      };
      const { oldService, newService, emitUpsert } = createReplacingRemoteServices(
        scope.workspaceKey,
        clientMode,
      );

      const oldStore = acquireSessionsIndex(scope, oldService);
      await vi.waitFor(() => expect(oldStore.getState().workspaceId).toBe(scope.workspaceKey));
      const newStore = acquireSessionsIndex(scope, newService);
      await vi.waitFor(() => expect(newService.subscribeSessionsIndexV4).toHaveBeenCalledTimes(1));
      expect(
        vi.mocked(oldService.unsubscribeSessionsIndexV4).mock.invocationCallOrder[0],
      ).toBeLessThan(vi.mocked(newService.subscribeSessionsIndexV4).mock.invocationCallOrder[0]!);

      const staleOldStore = acquireSessionsIndex(scope, oldService);
      expect(staleOldStore).toBe(oldStore);
      expect(oldService.subscribeSessionsIndexV4).toHaveBeenCalledTimes(1);
      expect(newService.subscribeSessionsIndexV4).toHaveBeenCalledTimes(1);

      emitUpsert({
        sessionId: "root-task",
        workspaceId: scope.workspaceKey,
        title: "root task",
        phase: "completedSuccess",
        sessionEnded: true,
        hasBackgroundWork: false,
        lastActivityAt: 2,
        createdAt: 1,
      });

      expect(newStore).toBe(oldStore);
      await vi.waitFor(() =>
        expect(oldStore.getSessions().map((session) => session.sessionId)).toEqual(["root-task"]),
      );
      expect(sessionsIndexRegistrySize()).toBe(1);

      releaseSessionsIndex(scope, newStore);
      expect(sessionsIndexRegistrySize()).toBe(1);
      expect(newService.unsubscribeSessionsIndexV4).not.toHaveBeenCalled();
      emitUpsert({
        sessionId: "root-task-after-cleanup",
        workspaceId: scope.workspaceKey,
        title: "root task after cleanup",
        phase: "completedSuccess",
        sessionEnded: true,
        hasBackgroundWork: false,
        lastActivityAt: 3,
        createdAt: 1,
      });
      await vi.waitFor(() =>
        expect(oldStore.getSessions().map((session) => session.sessionId)).toEqual([
          "root-task-after-cleanup",
          "root-task",
        ]),
      );

      releaseSessionsIndex(scope, staleOldStore);
      releaseSessionsIndex(scope, oldStore);
      expect(sessionsIndexRegistrySize()).toBe(0);
    },
  );

  it("When remote legacy subscription remains incomplete, new service can still take over transport immediately", async () => {
    const oldService = mockAgentService();
    const newService = mockAgentService();
    const scope = {
      workspaceKey: "ssh:repo",
      workspacePath: "/repo",
      workspaceIdentity: "ssh:repo",
      endpointKey: "remote-1",
    };
    vi.mocked(oldService.subscribeSessionsIndexV4).mockImplementation(() => new Promise(() => {}));

    const oldStore = acquireSessionsIndex(scope, oldService);
    const newStore = acquireSessionsIndex(scope, newService);

    try {
      expect(newStore).toBe(oldStore);
      await vi.waitFor(() => expect(newService.subscribeSessionsIndexV4).toHaveBeenCalledTimes(1));
    } finally {
      releaseSessionsIndex(scope, newStore);
      releaseSessionsIndex(scope, oldStore);
    }
  });

  it("When remote legacy unsubscription remains incomplete, new service can still take over transport immediately", async () => {
    const oldService = mockAgentService();
    const newService = mockAgentService();
    const scope = {
      workspaceKey: "ssh:repo",
      workspacePath: "/repo",
      workspaceIdentity: "ssh:repo",
      endpointKey: "remote-1",
    };
    vi.mocked(oldService.unsubscribeSessionsIndexV4).mockImplementation(
      () => new Promise(() => {}),
    );

    const oldStore = acquireSessionsIndex(scope, oldService);
    await vi.waitFor(() => expect(oldService.subscribeSessionsIndexV4).toHaveBeenCalledTimes(1));
    const newStore = acquireSessionsIndex(scope, newService);

    try {
      expect(newStore).toBe(oldStore);
      await vi.waitFor(() => expect(newService.subscribeSessionsIndexV4).toHaveBeenCalledTimes(1));
    } finally {
      releaseSessionsIndex(scope, newStore);
      releaseSessionsIndex(scope, oldStore);
    }
  });

  it("When remote intermediate-generation subscription remains incomplete, newer service can still take over transport immediately", async () => {
    const firstService = mockAgentService();
    const pendingMiddleService = mockAgentService();
    const latestService = mockAgentService();
    const scope = {
      workspaceKey: "ssh:repo",
      workspacePath: "/repo",
      workspaceIdentity: "ssh:repo",
      endpointKey: "remote-1",
    };
    vi.mocked(pendingMiddleService.subscribeSessionsIndexV4).mockImplementation(
      () => new Promise(() => {}),
    );

    const firstStore = acquireSessionsIndex(scope, firstService);
    await vi.waitFor(() => expect(firstService.subscribeSessionsIndexV4).toHaveBeenCalledTimes(1));
    const pendingStore = acquireSessionsIndex(scope, pendingMiddleService);
    await vi.waitFor(() =>
      expect(pendingMiddleService.subscribeSessionsIndexV4).toHaveBeenCalledTimes(1),
    );
    const latestStore = acquireSessionsIndex(scope, latestService);

    try {
      expect(pendingStore).toBe(firstStore);
      expect(latestStore).toBe(firstStore);
      await vi.waitFor(() =>
        expect(latestService.subscribeSessionsIndexV4).toHaveBeenCalledTimes(1),
      );
    } finally {
      releaseSessionsIndex(scope, latestStore);
      releaseSessionsIndex(scope, pendingStore);
      releaseSessionsIndex(scope, firstStore);
    }
  });

  it("During consecutive remote service generational transitions, late intermediate generations cannot switch transport back", async () => {
    const firstService = mockAgentService();
    const staleMiddleService = mockAgentService();
    const latestService = mockAgentService();
    const scope = {
      workspaceKey: "ssh:repo",
      workspacePath: "/repo",
      workspaceIdentity: "ssh:repo",
      endpointKey: "remote-1",
    };
    const register = (agentService: SessionsIndexAgentService) =>
      registerRemoteWorkspaceSession({
        sessionId: scope.endpointKey,
        services: { cfAgentService: agentService } as unknown as IServiceAccessor,
      });
    register(firstService);
    register(staleMiddleService);
    register(latestService);

    const firstStore = acquireSessionsIndex(scope, firstService);
    const latestStore = acquireSessionsIndex(scope, latestService);
    await vi.waitFor(() => expect(latestService.subscribeSessionsIndexV4).toHaveBeenCalledTimes(1));
    const staleStore = acquireSessionsIndex(scope, staleMiddleService);

    try {
      expect(latestStore).toBe(firstStore);
      expect(staleStore).toBe(firstStore);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(staleMiddleService.subscribeSessionsIndexV4).not.toHaveBeenCalled();
    } finally {
      releaseSessionsIndex(scope, staleStore);
      releaseSessionsIndex(scope, latestStore);
      releaseSessionsIndex(scope, firstStore);
      unregisterRemoteWorkspaceSession(scope.endpointKey);
    }
  });

  it("Local __base__ service generational transition still creates independent store without altering original lifecycle", async () => {
    const oldService = mockAgentService();
    const newService = mockAgentService();
    const scope = { workspaceKey: "/repo", workspacePath: "/repo" };

    const oldStore = acquireSessionsIndex(scope, oldService);
    const newStore = acquireSessionsIndex(scope, newService);
    expect(newStore).not.toBe(oldStore);
    expect(sessionsIndexRegistrySize()).toBe(1);

    releaseSessionsIndex(scope, oldStore);
    expect(sessionsIndexRegistrySize()).toBe(1);
    expect(newService.unsubscribeSessionsIndexV4).not.toHaveBeenCalled();

    releaseSessionsIndex(scope, newStore);
    expect(sessionsIndexRegistrySize()).toBe(0);
  });

  it("Entry key used by hook signature is sensitive to service generation and reference-stable", () => {
    const scope = { workspaceKey: "ws-1", endpointKey: "remote-1" };
    const first = mockAgentService();
    const second = mockAgentService();
    const signatureFor = (service: SessionsIndexAgentService) =>
      Reflect.apply(buildSessionsIndexEntryKey, undefined, [scope, service]) as string;

    expect(signatureFor(first)).toBe(signatureFor(first));
    expect(signatureFor(first)).not.toBe(signatureFor(second));
  });

  it("release 未注册 key 为 no-op", () => {
    releaseSessionsIndex({ workspaceKey: "ws-unknown" }, new SessionsIndexStore());
    expect(sessionsIndexRegistrySize()).toBe(0);
  });
});
