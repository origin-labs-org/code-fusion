//
//   17:26:44.395 [cua-product-helper] cua helper ready
//                → reconcileRecoveredHelper → recycleUntilStable → disposeWorkspace
//                Error: CodeFusion agent transport closed
//   17:26:44.96  CodeFusion agent process exited terminationReason='workspace-dispose'
//
//
import { Emitter } from "@origin-ai/cf-rpc";
import type { CommandEnvelope, ConversationTopicWireFrame } from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  createCfAgentConnectionScope,
  readTrustedCfAgentV4Connection,
  type ICfAgentService,
} from "@origin-ai/cf-services";
import { describe, expect, it, vi } from "vitest";
import { createAgentConversationTransport } from "@/v4/agentConversationTransport.js";
import { ConversationProjectionStore } from "@/v4/conversationProjectionStore.js";
import type { ConversationTransport } from "@/v4/transport.js";
import { ReplaceableConversationTransport } from "@/v4/replaceableConversationTransport.js";

const TOPIC = "conversation/s1";
const WORKSPACE_PATH = "/repo";

type LifecycleEvent = {
  workspaceKey: string;
  workspacePath: string;
  runtimeIdentity: { generation: number; identity: string; workspaceKey: string };
  state: "available" | "unavailable";
};

function lifecycleEvent(state: "available" | "unavailable", generation: number): LifecycleEvent {
  return {
    workspaceKey: WORKSPACE_PATH,
    workspacePath: WORKSPACE_PATH,
    runtimeIdentity: {
      generation,
      identity: `runtime-${generation}`,
      workspaceKey: WORKSPACE_PATH,
    },
    state,
  };
}

const TRANSPORT_CLOSED = "CodeFusion agent transport closed";

const RUNTIME_RECYCLE_RETRY_ATTEMPTS = 3;

function setupBase(options: { withLifecycle?: boolean } = {}) {
  const conversationFrames = new Emitter<ConversationTopicWireFrame>();
  const runtimeRestarts = new Emitter<{ workspaceKey: string }>();
  const runtimeLifecycle = new Emitter<LifecycleEvent>();
  const nextSerialByConnection = new Map<string, number>();
  const nextId = (params: unknown) => {
    const connection = readTrustedCfAgentV4Connection(params);
    if (!connection) throw new Error("missing trusted connection");
    const serial = (nextSerialByConnection.get(connection.connectionId) ?? 0) + 1;
    nextSerialByConnection.set(connection.connectionId, serial);
    return `sub-${connection.connectionId}-${serial}`;
  };
  
  const pendingFailures: Error[] = [];
  const mocks = {
    helloConversationV4: vi.fn(),
    initializeConversationV4: vi.fn(),
    subscribeConversationV4: vi.fn(async (params: unknown) => {
      const failure = pendingFailures.shift();
      if (failure) throw failure;
      return {
        ack: {
          subscriptionId: nextId(params),
          mode: "snapshot" as const,
          logEpoch: "epoch-1",
        },
      };
    }),
    unsubscribeConversationV4: vi.fn(async () => {}),
    resyncConversationV4: vi.fn(async (params: { subscriptionId: string }) => ({
      ack: {
        subscriptionId: params.subscriptionId,
        mode: "resume" as const,
        logEpoch: "epoch-1",
      },
    })),
    sendConversationCommandV4: vi.fn(async (params: { envelope: { commandId: string } }) => ({
      commandId: params.envelope.commandId,
      status: "accepted" as const,
      revisionAtDecision: 1,
    })),
    onDynamicConversationFrame: vi.fn(() => conversationFrames.event),
    onAgentRuntimeRestarted: vi.fn((listener: (event: { workspaceKey: string }) => void) =>
      runtimeRestarts.event(listener),
    ),
    setConnectionFlowStateV4: vi.fn(async () => {}),
    ...(options.withLifecycle
      ? {
          onAgentRuntimeLifecycle: vi.fn((listener: (event: LifecycleEvent) => void) =>
            runtimeLifecycle.event(listener),
          ),
        }
      : {}),
  };
  return {
    base: mocks as unknown as ICfAgentService,
    mocks,
    runtimeLifecycle,
    runtimeRestarts,
    pendingFailures,
  };
}

function createStore(
  base: ICfAgentService,
  connectionId: string,
  clientMode: "desktop-continuous" | "web-remote-replayable" = "desktop-continuous",
) {
  const scope = createCfAgentConnectionScope(base, {
    connectionId,
    clientMode,
  });
  const transport = createAgentConversationTransport(scope.service, {
    workspacePath: WORKSPACE_PATH,
  });
  return { transport, store: new ConversationProjectionStore(TOPIC, transport) };
}

describe("conversation projection 在 CUA Helper 回收 agent runtime 后自愈", () => {
  it.each(["desktop-continuous", "web-remote-replayable"] as const)(
    "%s 冷订阅期间收到 restart，Expired ACK 后Auto重New订阅",
    async (clientMode) => {
      vi.useFakeTimers();
      try {
        const { base, mocks, runtimeLifecycle, runtimeRestarts } = setupBase({
          withLifecycle: true,
        });
        const { store } = createStore(base, "cold-restart", clientMode);
        mocks.subscribeConversationV4.mockImplementationOnce(async () => {
          runtimeRestarts.fire({ workspaceKey: WORKSPACE_PATH });
          runtimeLifecycle.fire(lifecycleEvent("available", 2));
          return { ack: { subscriptionId: "stale", mode: "snapshot", logEpoch: "epoch-1" } };
        });
        await store.connect();
        expect(store.getState().status).toBe("connecting");
        await vi.advanceTimersByTimeAsync(250);
        expect(mocks.subscribeConversationV4).toHaveBeenCalledTimes(2);
        expect(store.getState().status).toBe("live");
        expect(store.getState().lastError).toBeNull();
        expect(mocks.unsubscribeConversationV4).not.toHaveBeenCalledWith(
          expect.objectContaining({ subscriptionId: "stale" }),
        );
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it("runtime available 到达时重New订阅（transport 暴露 lifecycle 时不能只依赖 onRuntimeRestart）", async () => {
    const { base, mocks, runtimeLifecycle } = setupBase({ withLifecycle: true });
    const { transport, store } = createStore(base, "conn-lifecycle");
    expect(transport.onRuntimeLifecycle).toBeTypeOf("function");

    await store.connect();
    expect(store.getState().status).toBe("live");
    expect(mocks.subscribeConversationV4).toHaveBeenCalledTimes(1);

    runtimeLifecycle.fire(lifecycleEvent("unavailable", 2));
    await Promise.resolve();
    expect(mocks.subscribeConversationV4).toHaveBeenCalledTimes(1);

    runtimeLifecycle.fire(lifecycleEvent("available", 2));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(mocks.subscribeConversationV4).toHaveBeenCalledTimes(2);
    expect(store.getState().status).toBe("live");
  });

  it("首次 subscribe 在途时 runtime available 不应再开Second item订阅", async () => {
    const { base, mocks, runtimeLifecycle } = setupBase({ withLifecycle: true });
    let resolveSubscribe:
      | ((value: { ack: { subscriptionId: string; mode: "snapshot"; logEpoch: string } }) => void)
      | null = null;
    mocks.subscribeConversationV4.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSubscribe = resolve;
        }),
    );
    const { store } = createStore(base, "conn-initial-available");

    const connectPromise = store.connect();
    await vi.waitFor(() => expect(mocks.subscribeConversationV4).toHaveBeenCalledTimes(1));

    runtimeLifecycle.fire(lifecycleEvent("available", 1));
    await Promise.resolve();
    expect(mocks.subscribeConversationV4).toHaveBeenCalledTimes(1);

    resolveSubscribe?.({
      ack: { subscriptionId: "sub-initial-available", mode: "snapshot", logEpoch: "epoch-1" },
    });
    await connectPromise;
    expect(store.getState().status).toBe("live");
    expect(store.getState().subscriptionId).toBe("sub-initial-available");
  });

  it("live 订阅被回收且 available 永不到达时，退避Reconnect自行拉From runtime", async () => {
    vi.useFakeTimers();
    try {
      const { base, mocks, runtimeLifecycle } = setupBase({ withLifecycle: true });
      const { store } = createStore(base, "conn-dormant");

      await store.connect();
      expect(store.getState().status).toBe("live");

      runtimeLifecycle.fire(lifecycleEvent("unavailable", 2));
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.subscribeConversationV4).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(mocks.subscribeConversationV4).toHaveBeenCalledTimes(2);
      expect(store.getState().status).toBe("live");
    } finally {
      vi.useRealTimers();
    }
  });

  it("退避耗尽后落 error 暴露「Reconnect」入口", async () => {
    vi.useFakeTimers();
    try {
      const { base, mocks, runtimeLifecycle, pendingFailures } = setupBase({
        withLifecycle: true,
      });
      const { store } = createStore(base, "conn-exhausted");

      await store.connect();
      expect(store.getState().status).toBe("live");

      for (let i = 0; i < 8; i += 1) pendingFailures.push(new Error(TRANSPORT_CLOSED));
      runtimeLifecycle.fire(lifecycleEvent("unavailable", 2));
      await vi.advanceTimersByTimeAsync(30_000);

      expect(store.getState().status).toBe("error");
      expect(store.getState().lastError).toContain(TRANSPORT_CLOSED);
      expect(mocks.subscribeConversationV4.mock.calls.length).toBeLessThanOrEqual(
        1 + RUNTIME_RECYCLE_RETRY_ATTEMPTS,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("runtime 反复回收（连续 unavailable）耗尽退避后落 error，不静默停在 connecting", async () => {
    vi.useFakeTimers();
    try {
      const { base, runtimeLifecycle } = setupBase({ withLifecycle: true });
      const { store } = createStore(base, "conn-flapping");

      await store.connect();
      expect(store.getState().status).toBe("live");

      for (let i = 0; i < RUNTIME_RECYCLE_RETRY_ATTEMPTS + 1; i += 1) {
        runtimeLifecycle.fire(lifecycleEvent("unavailable", i + 2));
        await vi.advanceTimersByTimeAsync(0);
      }

      expect(store.getState().status).toBe("error");
      expect(store.getState().lastError).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lifecycle Mode下仍接收 proxy 换代（transportReplaced），携原水位重订阅", async () => {
    const { base, mocks } = setupBase({ withLifecycle: true });
    const scope = createCfAgentConnectionScope(base, {
      connectionId: "conn-proxy-1",
      clientMode: "desktop-continuous",
    });
    const replaceable = new ReplaceableConversationTransport(
      createAgentConversationTransport(scope.service, { workspacePath: WORKSPACE_PATH }),
    );
    expect(replaceable.onRuntimeLifecycle).toBeTypeOf("function");
    const store = new ConversationProjectionStore(TOPIC, replaceable);

    await store.connect();
    expect(store.getState().status).toBe("live");
    expect(mocks.subscribeConversationV4).toHaveBeenCalledTimes(1);

    const nextScope = createCfAgentConnectionScope(base, {
      connectionId: "conn-proxy-2",
      clientMode: "desktop-continuous",
    });
    replaceable.replace(
      createAgentConversationTransport(nextScope.service, { workspacePath: WORKSPACE_PATH }),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(mocks.subscribeConversationV4).toHaveBeenCalledTimes(2);
    expect(store.getState().status).toBe("live");
  });

  it("runtime 换代同时到达两条通道时只重订阅One次", async () => {
    const { base, mocks, runtimeLifecycle, runtimeRestarts } = setupBase({ withLifecycle: true });
    const { store } = createStore(base, "conn-no-double");

    await store.connect();
    expect(mocks.subscribeConversationV4).toHaveBeenCalledTimes(1);

    runtimeRestarts.fire({ workspaceKey: WORKSPACE_PATH });
    runtimeLifecycle.fire(lifecycleEvent("available", 2));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(mocks.subscribeConversationV4).toHaveBeenCalledTimes(2);
    expect(store.getState().status).toBe("live");
  });

  it("在途 subscribe 被 workspace-dispose 打断后有Boundary退避Reconnect，不定格 error", async () => {
    vi.useFakeTimers();
    try {
      const { base, mocks, pendingFailures } = setupBase();
      pendingFailures.push(new Error(TRANSPORT_CLOSED));
      const { store } = createStore(base, "conn-retry");

      await store.connect();
      expect(store.getState().status).not.toBe("error");
      expect(mocks.subscribeConversationV4).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(mocks.subscribeConversationV4).toHaveBeenCalledTimes(2);
      expect(store.getState().status).toBe("live");
      expect(store.getState().lastError).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

it("forwards project creation context before and after a remote proxy replacement", async () => {
  const first = { sendCommand: vi.fn(async () => ({ status: "accepted" })) };
  const next = { sendCommand: vi.fn(async () => ({ status: "accepted" })) };
  const transport = new ReplaceableConversationTransport(first as unknown as ConversationTransport);
  const envelope = { type: "createSession", commandId: "create-project" } as CommandEnvelope;
  const context = { projectId: "project-a" };
  await transport.sendCommand(envelope, context);
  expect(first.sendCommand).toHaveBeenCalledWith(envelope, context);
  transport.replace(next as unknown as ConversationTransport);
  await transport.sendCommand(envelope, context);
  expect(next.sendCommand).toHaveBeenCalledWith(envelope, context);
  expect(first.sendCommand).toHaveBeenCalledOnce();
});

it("recovers when a new runtime appears while the first subscription ACK is pending", async () => {
  vi.useFakeTimers();
  try {
    const { base, mocks, runtimeLifecycle, runtimeRestarts } = setupBase({ withLifecycle: true });
    let resolveAck!: (value: {
      ack: { subscriptionId: string; mode: "snapshot"; logEpoch: string };
    }) => void;
    mocks.subscribeConversationV4.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAck = resolve;
        }),
    );
    const { store } = createStore(base, "cold-runtime");
    const connecting = store.connect();
    await vi.waitFor(() => expect(mocks.subscribeConversationV4).toHaveBeenCalledOnce());
    runtimeLifecycle.fire(lifecycleEvent("available", 2));
    runtimeRestarts.fire({ workspaceKey: WORKSPACE_PATH });
    expect(mocks.subscribeConversationV4).toHaveBeenCalledOnce();
    resolveAck({
      ack: { subscriptionId: "old-runtime-ack", mode: "snapshot", logEpoch: "old-epoch" },
    });
    await connecting;
    expect(store.getState().status).toBe("connecting");
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.subscribeConversationV4).toHaveBeenCalledTimes(2);
    expect(store.getState().status).toBe("live");
    expect(store.getState().subscriptionId).not.toBe("old-runtime-ack");
    expect(mocks.sendConversationCommandV4).not.toHaveBeenCalled();
    await store.close();
  } finally {
    vi.useRealTimers();
  }
});
