import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Emitter } from "@origin-ai/cf-rpc";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import type {
  ConversationRow,
  ConversationSnapshot,
  ConversationTopicFrame,
  ConversationTopicWireFrame,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  WORKSPACE_CONNECTION_KEEP_WARM_MS,
  acquireWorkspaceConnection,
  buildWorkspaceConnectionKey,
  workspaceConnectionRegistrySize,
  type WorkspaceConnectionAgentService,
} from "@/v4/workspaceConnectionRegistry.js";
import { createCommandEnvelope } from "@/v4/commandFactory.js";
import {
  registerRemoteWorkspaceSession,
  unregisterRemoteWorkspaceSession,
} from "@/store/remoteWorkspaceSessionStore.js";

function mockAgentService(): WorkspaceConnectionAgentService {
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
    subscribeConversationV4: vi.fn(async () => ({
      ack: {
        subscriptionId: "sub-1",
        mode: "snapshot" as const,
        logEpoch: "e1",
      },
    })),
    resyncConversationV4: vi.fn(async (params) => ({
      ack: {
        subscriptionId: params.subscriptionId,
        mode: "snapshot" as const,
        logEpoch: "e1",
      },
    })),
    unsubscribeConversationV4: vi.fn(async () => {}),
    sendConversationCommandV4: vi.fn(async () => ({}) as never),
    conversationRowsRangeV4: vi.fn(async () => ({}) as never),
    conversationPlansV4: vi.fn(async () => ({}) as never),
    attachmentBeginV4: vi.fn(async () => ({}) as never),
    attachmentChunkV4: vi.fn(async () => ({}) as never),
    attachmentCommitV4: vi.fn(async () => ({}) as never),
    attachmentAbortV4: vi.fn(async () => {}),
    attachmentReadV4: vi.fn(async () => ({}) as never),
    onDynamicConversationFrame: vi.fn(() => () => ({ dispose: () => {} })),
    onAgentRuntimeRestarted: runtimeRestarts.event,
  } as unknown as WorkspaceConnectionAgentService;
}

function makeSnapshot(sessionId: string, text: string): ConversationSnapshot {
  const row: ConversationRow = {
    rowId: 1,
    turnId: "turn-1",
    createdAt: 1,
    createdAtSeq: 1,
    kind: "assistantText",
    text,
    state: "complete",
  };
  return {
    protocolVersion: 1,
    sessionId,
    logEpoch: "epoch-1",
    seq: 1,
    revision: 1,
    control: {
      phase: "draft",
      sessionEnded: false,
      canStop: false,
      stopState: "idle",
      stopTargetKind: "unknown",
      activeWorks: [],
      lastError: null,
      apiRetry: null,
    },
    availability: {
      fork: { allowed: true },
      compact: { allowed: false, reasonCode: "idleCannotCompact" },
      switchModelConfig: { allowed: true },
      setFollowupMode: { allowed: true },
      queueEdit: { allowed: true },
      sendQueuedNow: { allowed: false, reasonCode: "sendQueuedNowRequiresRunning" },
      pauseGoal: { allowed: false, reasonCode: "noGoalToPause" },
      resumeGoal: { allowed: false, reasonCode: "noGoalToResume" },
    },
    inputRouting: { mode: "startNow" },
    config: { provider: "", model: "", thought: "", followupMode: "queue" },
    modelTransition: null,
    usage: {
      contextWindow: null,
      cumulative: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    },
    queue: { items: [], autoDrain: true },
    pendingInteractions: [],
    pendingCommands: [],
    backgroundWorks: [],
    goal: null,
    plan: null,
    rows: { window: [row], totalCount: 1, firstRowId: 1 },
  };
}

function createReplacingRemoteServices(clientMode: "desktop-continuous" | "web-remote-replayable") {
  let nextSubscription = 1;
  let nextLogicalFrame = 1;

  const createService = (
    serviceKey: string,
    snapshotText: string,
  ): WorkspaceConnectionAgentService => {
    const runtimeRestarts = new Emitter<{ workspaceKey: string }>();
    const frames = new Emitter<ConversationTopicWireFrame>();
    return {
      helloConversationV4: vi.fn(async () => ({
        kind: "hello" as const,
        protocolVersion: 3 as const,
        connectionId: "shared-remote-connection",
        clientMode,
        deliveryProfile:
          clientMode === "desktop-continuous" ? ("continuous" as const) : ("replayable" as const),
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
      subscribeConversationV4: vi.fn(async (params) => {
        const subscriptionId = `${serviceKey}-sub-${nextSubscription++}`;
        const frame: ConversationTopicFrame = {
          topic: `conversation/${params.sessionId}`,
          subscriptionId,
          fromSeq: 0,
          toSeq: 1,
          sentAt: 1,
          payload: {
            kind: "snapshot",
            snapshot: makeSnapshot(params.sessionId, snapshotText),
          },
        };
        frames.fire({
          wireVersion: 3,
          kind: "complete",
          deliveryKind: "initial",
          logicalFrameId: `logical-${nextLogicalFrame}`,
          logicalFrameOrdinal: nextLogicalFrame++,
          topic: frame.topic,
          subscriptionId,
          frame,
        });
        return {
          ack: {
            subscriptionId,
            mode: "snapshot" as const,
            logEpoch: "epoch-1",
          },
        };
      }),
      resyncConversationV4: vi.fn(async (params) => ({
        ack: {
          subscriptionId: params.subscriptionId,
          mode: "snapshot" as const,
          logEpoch: "epoch-1",
        },
      })),
      unsubscribeConversationV4: vi.fn(async () => {}),
      sendConversationCommandV4: vi.fn(async (params) => ({
        commandId: params.envelope.commandId,
        status: "accepted" as const,
        revisionAtDecision: 1,
      })),
      queryConversationCommandsV4: vi.fn(async () => ({ results: [] })),
      conversationRowsRangeV4: vi.fn(async () => ({
        rows: [],
        atSeq: 1,
        atLogEpoch: "epoch-1",
        hasMore: false,
      })),
      conversationPlansV4: vi.fn(async () => ({
        plans: [],
        atSeq: 1,
        atLogEpoch: "epoch-1",
      })),
      conversationFileChangesV4: vi.fn(async () => ({}) as never),
      conversationFileRewindPreviewV4: vi.fn(async () => ({}) as never),
      attachmentBeginV4: vi.fn(async () => ({}) as never),
      attachmentChunkV4: vi.fn(async () => ({}) as never),
      attachmentCommitV4: vi.fn(async () => ({}) as never),
      attachmentAbortV4: vi.fn(async () => {}),
      attachmentReadV4: vi.fn(async () => ({}) as never),
      onDynamicConversationFrame: vi.fn(() => frames.event),
      onAgentRuntimeRestarted: runtimeRestarts.event,
    } as unknown as WorkspaceConnectionAgentService;
  };

  return {
    oldService: createService("old", "old snapshot"),
    newService: createService("new", "new snapshot"),
  };
}

describe("workspaceConnectionRegistry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it("key = endpoint + workspaceKey（identity 优先，endpoint 缺省 __base__）", () => {
    expect(buildWorkspaceConnectionKey({ workspacePath: "/a" })).toBe("__base__ /a");
    expect(
      buildWorkspaceConnectionKey({
        workspacePath: "/mnt/b",
        workspaceIdentity: "ssh://host/mnt/b",
        remoteSessionId: "remote-1",
      }),
    ).toBe("remote-1 ssh://host/mnt/b");
  });

  it("引用计Count：同 scope 复用同One layer/transport（帧监听只挂One次）", () => {
    const service = mockAgentService();
    const scope = { workspacePath: "/ws/a" };
    const a = acquireWorkspaceConnection(scope, service);
    const b = acquireWorkspaceConnection(scope, service);
    expect(a.layer).toBe(b.layer);
    expect(a.transport).toBe(b.transport);
    expect(workspaceConnectionRegistrySize()).toBe(1);
    expect(service.onDynamicConversationFrame).toHaveBeenCalledTimes(1);
    a.release();
    b.release();
    vi.runAllTimers();
    expect(workspaceConnectionRegistrySize()).toBe(0);
  });

  it("keep-warm：归零后Window期inner re-acquire 复活同One条目，Window期满才移除", () => {
    const service = mockAgentService();
    const scope = { workspacePath: "/ws/a" };
    const a = acquireWorkspaceConnection(scope, service);
    const layer = a.layer;
    a.release();
    expect(workspaceConnectionRegistrySize()).toBe(1);
    vi.advanceTimersByTime(WORKSPACE_CONNECTION_KEEP_WARM_MS - 1);
    const b = acquireWorkspaceConnection(scope, service);
    expect(b.layer).toBe(layer);
    vi.advanceTimersByTime(WORKSPACE_CONNECTION_KEEP_WARM_MS * 2);
    expect(workspaceConnectionRegistrySize()).toBe(1);
    b.release();
    vi.advanceTimersByTime(WORKSPACE_CONNECTION_KEEP_WARM_MS);
    expect(workspaceConnectionRegistrySize()).toBe(0);
  });

  it("release 幂等：重复 release 不重复减计Count", () => {
    const service = mockAgentService();
    const scope = { workspacePath: "/ws/a" };
    const a = acquireWorkspaceConnection(scope, service);
    const b = acquireWorkspaceConnection(scope, service);
    a.release();
    a.release();
    a.release();
    vi.runAllTimers();
    expect(workspaceConnectionRegistrySize()).toBe(1);
    b.release();
    vi.runAllTimers();
    expect(workspaceConnectionRegistrySize()).toBe(0);
  });

  it("不同 endpoint / 不同 workspaceKey 各自独立条目", () => {
    const local = mockAgentService();
    const remote = mockAgentService();
    const a = acquireWorkspaceConnection({ workspacePath: "/ws" }, local);
    const b = acquireWorkspaceConnection(
      {
        workspacePath: "/ws",
        workspaceIdentity: "ssh://host/ws",
        remoteSessionId: "remote-1",
      },
      remote,
    );
    expect(a.layer).not.toBe(b.layer);
    expect(workspaceConnectionRegistrySize()).toBe(2);
    a.release();
    b.release();
    vi.runAllTimers();
    expect(workspaceConnectionRegistrySize()).toBe(0);
  });

  it("Remote agentService 换代：NewOld消费者复用同One layer/transport", () => {
    const oldService = mockAgentService();
    const newService = mockAgentService();
    const scope = {
      workspacePath: "/ws",
      workspaceIdentity: "ssh://host/ws",
      remoteSessionId: "remote-1",
    };
    const oldLease = acquireWorkspaceConnection(scope, oldService);
    const newLease = acquireWorkspaceConnection(scope, newService);
    try {
      expect(newLease.layer).toBe(oldLease.layer);
      expect(newLease.transport).toBe(oldLease.transport);
      expect(workspaceConnectionRegistrySize()).toBe(1);

      newLease.release();
      const sessionLease = oldLease.layer.acquire("sess-x");
      sessionLease.release();
      oldLease.release();
      vi.runAllTimers();
      expect(workspaceConnectionRegistrySize()).toBe(0);
    } finally {
      newLease.release();
      oldLease.release();
      vi.runAllTimers();
    }
  });

  it("Remote agentService 换代：所有存量 lease 的Command都Send到最New service", async () => {
    const oldService = mockAgentService();
    const newService = mockAgentService();
    const scope = {
      workspacePath: "/ws",
      workspaceIdentity: "ssh://host/ws",
      remoteSessionId: "remote-1",
    };
    const oldLease = acquireWorkspaceConnection(scope, oldService);
    const newLease = acquireWorkspaceConnection(scope, newService);
    try {
      newLease.activateRemoteService();
      const envelope = createCommandEnvelope({
        type: "sendText",
        sessionId: "sess-x",
        payload: { text: "hello" },
      });
      await oldLease.transport.sendCommand(envelope);

      expect(oldService.sendConversationCommandV4).not.toHaveBeenCalled();
      expect(newService.sendConversationCommandV4).toHaveBeenCalledWith({
        workspacePath: "/ws",
        workspaceIdentity: "ssh://host/ws",
        envelope,
      });
      expect(newLease.transport).toBe(oldLease.transport);
    } finally {
      newLease.release();
      oldLease.release();
      vi.runAllTimers();
    }
  });

  it("Remote agentService 换代：acquire 只登记候选，commit Phase激活后才切换 service", async () => {
    const oldService = mockAgentService();
    const newService = mockAgentService();
    const scope = {
      workspacePath: "/ws",
      workspaceIdentity: "ssh://host/ws",
      remoteSessionId: "remote-1",
    };
    const oldLease = acquireWorkspaceConnection(scope, oldService);
    const newLease = acquireWorkspaceConnection(scope, newService);
    try {
      const beforeCommit = createCommandEnvelope({
        type: "sendText",
        sessionId: "sess-x",
        payload: { text: "before commit" },
      });
      await oldLease.transport.sendCommand(beforeCommit);
      expect(oldService.sendConversationCommandV4).toHaveBeenCalledWith({
        workspacePath: "/ws",
        workspaceIdentity: "ssh://host/ws",
        envelope: beforeCommit,
      });
      expect(newService.sendConversationCommandV4).not.toHaveBeenCalled();

      newLease.activateRemoteService();

      const afterCommit = createCommandEnvelope({
        type: "sendText",
        sessionId: "sess-x",
        payload: { text: "after commit" },
      });
      await oldLease.transport.sendCommand(afterCommit);
      expect(newService.sendConversationCommandV4).toHaveBeenCalledWith({
        workspacePath: "/ws",
        workspaceIdentity: "ssh://host/ws",
        envelope: afterCommit,
      });
    } finally {
      newLease.release();
      oldLease.release();
      vi.runAllTimers();
    }
  });

  it.each(["desktop-continuous", "web-remote-replayable"] as const)(
    "Remote agentService 换代：存量 store 携Current水位从New proxy 恢复（%s）",
    async (clientMode) => {
      const scope = {
        workspacePath: "/ws",
        workspaceIdentity: "ssh://host/ws",
        remoteSessionId: "remote-1",
      };
      const { oldService, newService } = createReplacingRemoteServices(clientMode);
      const oldLease = acquireWorkspaceConnection(scope, oldService);
      const sessionLease = oldLease.layer.acquire("sess-x");
      let newLease: ReturnType<typeof acquireWorkspaceConnection> | null = null;
      try {
        await vi.waitFor(() =>
          expect(sessionLease.store.getState().snapshot?.rows.window[0]).toMatchObject({
            kind: "assistantText",
            text: "old snapshot",
          }),
        );

        newLease = acquireWorkspaceConnection(scope, newService);
        newLease.activateRemoteService();
        expect(newLease.layer).toBe(oldLease.layer);
        expect(newLease.transport).toBe(oldLease.transport);
        await vi.waitFor(() =>
          expect(sessionLease.store.getState().snapshot?.rows.window[0]).toMatchObject({
            kind: "assistantText",
            text: "new snapshot",
          }),
        );
        expect(sessionLease.store.getState()).toMatchObject({
          status: "live",
          lastError: null,
        });
        expect(oldService.unsubscribeConversationV4).toHaveBeenCalledTimes(1);
        expect(newService.subscribeConversationV4).toHaveBeenCalledTimes(1);
        expect(newService.subscribeConversationV4).toHaveBeenCalledWith({
          workspacePath: "/ws",
          workspaceIdentity: "ssh://host/ws",
          sessionId: "sess-x",
          base: { logEpoch: "epoch-1", seq: 1 },
        });
      } finally {
        sessionLease.release();
        newLease?.release();
        oldLease.release();
        vi.runAllTimers();
      }
    },
  );

  it("Remote service 连续换代时，迟到Old consumer 不能把 transport 切回去", async () => {
    const firstService = mockAgentService();
    const staleMiddleService = mockAgentService();
    const latestService = mockAgentService();
    const scope = {
      workspacePath: "/ws",
      workspaceIdentity: "ssh://host/ws",
      remoteSessionId: "remote-1",
    };
    const register = (agentService: WorkspaceConnectionAgentService) =>
      registerRemoteWorkspaceSession({
        sessionId: scope.remoteSessionId,
        services: { cfAgentService: agentService } as unknown as IServiceAccessor,
      });
    register(firstService);
    register(staleMiddleService);
    register(latestService);

    const firstLease = acquireWorkspaceConnection(scope, firstService);
    const latestLease = acquireWorkspaceConnection(scope, latestService);
    const staleLease = acquireWorkspaceConnection(scope, staleMiddleService);
    try {
      latestLease.activateRemoteService();
      staleLease.activateRemoteService();
      const envelope = createCommandEnvelope({
        type: "sendText",
        sessionId: "sess-x",
        payload: { text: "latest" },
      });
      await staleLease.transport.sendCommand(envelope);

      expect(staleMiddleService.sendConversationCommandV4).not.toHaveBeenCalled();
      expect(latestService.sendConversationCommandV4).toHaveBeenCalledTimes(1);
      expect(staleLease.layer).toBe(firstLease.layer);
      expect(latestLease.layer).toBe(firstLease.layer);
    } finally {
      staleLease.release();
      latestLease.release();
      firstLease.release();
      vi.runAllTimers();
      unregisterRemoteWorkspaceSession(scope.remoteSessionId);
    }
  });

  it("RemoteOld订阅One直未Completed时，New service 仍可立即接管 conversation store", async () => {
    const oldService = mockAgentService();
    const newService = mockAgentService();
    const scope = {
      workspacePath: "/ws",
      workspaceIdentity: "ssh://host/ws",
      remoteSessionId: "remote-1",
    };
    vi.mocked(oldService.subscribeConversationV4).mockImplementation(() => new Promise(() => {}));

    const oldLease = acquireWorkspaceConnection(scope, oldService);
    const sessionLease = oldLease.layer.acquire("sess-x");
    const newLease = acquireWorkspaceConnection(scope, newService);
    try {
      newLease.activateRemoteService();
      expect(newLease.layer).toBe(oldLease.layer);
      await vi.waitFor(() => expect(newService.subscribeConversationV4).toHaveBeenCalledTimes(1));
      expect(sessionLease.store.getState().status).toBe("live");
    } finally {
      sessionLease.release();
      newLease.release();
      oldLease.release();
      vi.runAllTimers();
    }
  });

  it("RemoteOld退订One直未Completed时，New service 的 snapshot 恢复不被阻塞", async () => {
    const scope = {
      workspacePath: "/ws",
      workspaceIdentity: "ssh://host/ws",
      remoteSessionId: "remote-1",
    };
    const { oldService, newService } = createReplacingRemoteServices("desktop-continuous");
    vi.mocked(oldService.unsubscribeConversationV4).mockImplementation(() => new Promise(() => {}));

    const oldLease = acquireWorkspaceConnection(scope, oldService);
    const sessionLease = oldLease.layer.acquire("sess-x");
    let newLease: ReturnType<typeof acquireWorkspaceConnection> | null = null;
    try {
      await vi.waitFor(() =>
        expect(sessionLease.store.getState().snapshot?.rows.window[0]).toMatchObject({
          text: "old snapshot",
        }),
      );
      newLease = acquireWorkspaceConnection(scope, newService);
      newLease.activateRemoteService();
      await vi.waitFor(() =>
        expect(sessionLease.store.getState().snapshot?.rows.window[0]).toMatchObject({
          text: "new snapshot",
        }),
      );
    } finally {
      sessionLease.release();
      newLease?.release();
      oldLease.release();
      vi.runAllTimers();
    }
  });

  it("agentService 换代：Old条目无人持有（keep-warm Medium）→ 立即清场", () => {
    const oldService = mockAgentService();
    const newService = mockAgentService();
    const scope = { workspacePath: "/ws/a" };
    const oldLease = acquireWorkspaceConnection(scope, oldService);
    const oldLayer = oldLease.layer;
    oldLease.release();
    const newLease = acquireWorkspaceConnection(scope, newService);
    expect(() => oldLayer.acquire("sess-x")).toThrow();
    expect(workspaceConnectionRegistrySize()).toBe(1);
    newLease.release();
    vi.runAllTimers();
    expect(workspaceConnectionRegistrySize()).toBe(0);
  });
});
