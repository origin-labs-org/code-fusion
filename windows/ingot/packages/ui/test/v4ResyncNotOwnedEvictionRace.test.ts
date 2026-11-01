//
//
//   renderer(store/transport)          host(connectionScope)             CLI(base)
//   ──────────────────────────         ─────────────────────             ─────────
//   connect() → subscribe ────────────▶ remember(S1) ◀──────────────────  ACK S1
//   [S1 live]
//   [S2 live]
//
import { Emitter } from "@origin-ai/cf-rpc";
import type { LocalTtftFacts } from "@origin-ai/cf-shared";
import type {
  ConversationTopicFrame,
  ConversationTopicWireFrame,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  createCfAgentConnectionScope,
  readTrustedCfAgentV4Connection,
  type ICfAgentService,
} from "@origin-ai/cf-services";
import { describe, expect, it, vi } from "vitest";
import { createAgentConversationTransport } from "@/v4/agentConversationTransport.js";
import { ConversationProjectionStore } from "@/v4/conversationProjectionStore.js";
import { createCommandEnvelope } from "@/v4/commandFactory.js";

const TOPIC = "conversation/s1";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setupBase() {
  const conversationFrames = new Emitter<ConversationTopicWireFrame>();
  const localTtftFacts = new Emitter<LocalTtftFacts>();
  const runtimeRestarts = new Emitter<{ workspaceKey: string }>();
  const nextSerialByConnection = new Map<string, number>();
  const nextId = (params: unknown) => {
    const connection = readTrustedCfAgentV4Connection(params);
    if (!connection) throw new Error("missing trusted connection");
    const serial = (nextSerialByConnection.get(connection.connectionId) ?? 0) + 1;
    nextSerialByConnection.set(connection.connectionId, serial);
    return `sub-${connection.connectionId}-${serial}`;
  };
  const mocks = {
    helloConversationV4: vi.fn(),
    initializeConversationV4: vi.fn(),
    subscribeConversationV4: vi.fn(async (params: unknown) => ({
      ack: {
        subscriptionId: nextId(params),
        mode: "snapshot" as const,
        logEpoch: "epoch-1",
      },
    })),
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
    onDynamicLocalTtftFacts: vi.fn(() => localTtftFacts.event),
    onAgentRuntimeRestarted: vi.fn((listener: (event: { workspaceKey: string }) => void) =>
      runtimeRestarts.event(listener),
    ),
    setConnectionFlowStateV4: vi.fn(async () => {}),
  };
  return {
    base: mocks as unknown as ICfAgentService,
    mocks,
    conversationFrames,
  };
}

function createRpcGate(service: ICfAgentService) {
  const holding = new Set<string>();
  const held = new Map<string, Array<() => void>>();
  const proxy = new Proxy(service as unknown as Record<string, unknown>, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      const method = String(property);
      return (...args: unknown[]) => {
        if (!holding.has(method)) return (value as (...a: unknown[]) => unknown)(...args);
        return new Promise((resolve, reject) => {
          const queue = held.get(method) ?? [];
          queue.push(() => {
            Promise.resolve()
              .then(() => (value as (...a: unknown[]) => unknown)(...args))
              .then(resolve, reject);
          });
          held.set(method, queue);
        });
      };
    },
  }) as unknown as ICfAgentService;
  return {
    service: proxy,
    hold(method: string) {
      holding.add(method);
    },
    heldCount(method: string) {
      return held.get(method)?.length ?? 0;
    },
    async release(method: string) {
      holding.delete(method);
      const queue = held.get(method) ?? [];
      held.delete(method);
      for (const run of queue) run();
      await flush();
    },
  };
}

function onlineDeltasWire(
  subscriptionId: string,
  ordinal: number,
  fromSeq: number,
  toSeq: number,
): ConversationTopicWireFrame {
  const frame: ConversationTopicFrame = {
    topic: TOPIC,
    subscriptionId,
    fromSeq,
    toSeq,
    sentAt: 1,
    payload: { kind: "deltas", deltas: [] },
  };
  return {
    wireVersion: 3,
    kind: "complete",
    deliveryKind: "online",
    logicalFrameId: `logical-${subscriptionId}-${ordinal}`,
    logicalFrameOrdinal: ordinal,
    topic: TOPIC,
    subscriptionId,
    frame,
  };
}

describe("v4 resync notOwned eviction race（真实 store + transport + connectionScope）", () => {
  it("换代 subscribe ACK 静默驱逐Old ownership 后，迟到 resync 的 notOwned 被静默Ignore，S2 保持 live", async () => {
    const { base, mocks, conversationFrames } = setupBase();
    const scope = createCfAgentConnectionScope(base, {
      connectionId: "conn-1",
      clientMode: "desktop-continuous",
    });
    const gate = createRpcGate(scope.service);
    const transport = createAgentConversationTransport(gate.service, {
      workspacePath: "/repo",
    });
    const store = new ConversationProjectionStore(TOPIC, transport);
    const offFrame = transport.onFrame((frame, context) => store.handleFrame(frame, context));

    await store.connect();
    expect(store.getState().status).toBe("live");
    expect(store.getState().subscriptionId).toBe("sub-conn-1-1");

    gate.hold("subscribeConversationV4");
    const reconnect = store.connect();
    await flush();
    expect(gate.heldCount("subscribeConversationV4")).toBe(1);

    gate.hold("resyncConversationV4");
    conversationFrames.fire(onlineDeltasWire("sub-conn-1-1", 1, 7, 8));
    await flush();
    expect(gate.heldCount("resyncConversationV4")).toBe(1);

    const ack = await transport.sendCommand(
      createCommandEnvelope({ type: "sendText", payload: { text: "hi" }, sessionId: "s1" }),
    );
    expect(ack.status).toBe("accepted");

    await gate.release("subscribeConversationV4");
    await reconnect;
    expect(store.getState().status).toBe("live");
    expect(store.getState().subscriptionId).toBe("sub-conn-1-2");
    expect(mocks.unsubscribeConversationV4).not.toHaveBeenCalled();

    await gate.release("resyncConversationV4");
    await flush();

    expect(mocks.resyncConversationV4).not.toHaveBeenCalled();
    expect(store.getState().status).toBe("live");
    expect(store.getState().subscriptionId).toBe("sub-conn-1-2");
    expect(store.getState().lastError).toBeNull();
    expect(mocks.subscribeConversationV4).toHaveBeenCalledTimes(2);

    offFrame();
  });

  it("Wrong位 unsubscribe 造成 ownership 分歧时，resync notOwned Auto携水位重订阅自愈", async () => {
    const { base, mocks, conversationFrames } = setupBase();
    const scope = createCfAgentConnectionScope(base, {
      connectionId: "conn-3",
      clientMode: "desktop-continuous",
    });
    const gate = createRpcGate(scope.service);
    const transport = createAgentConversationTransport(gate.service, {
      workspacePath: "/repo",
    });
    const store = new ConversationProjectionStore(TOPIC, transport);
    const offFrame = transport.onFrame((frame, context) => store.handleFrame(frame, context));

    await store.connect();
    expect(store.getState().subscriptionId).toBe("sub-conn-3-1");

    gate.hold("resyncConversationV4");
    conversationFrames.fire(onlineDeltasWire("sub-conn-3-1", 1, 7, 8));
    await flush();
    expect(gate.heldCount("resyncConversationV4")).toBe(1);

    await scope.service.unsubscribeConversationV4({
      workspacePath: "/repo",
      subscriptionId: "sub-conn-3-1",
    });

    await gate.release("resyncConversationV4");
    await vi.waitFor(() => {
      expect(store.getState().subscriptionId).toBe("sub-conn-3-2");
    });
    expect(store.getState().status).toBe("live");
    expect(store.getState().lastError).toBeNull();
    expect(mocks.subscribeConversationV4).toHaveBeenCalledTimes(2);

    offFrame();
  });

  it("对照：resync(S1) 先于 subscribe(S2) ACK 抵达 host 时不触发 notOwned", async () => {
    const { base, mocks, conversationFrames } = setupBase();
    const scope = createCfAgentConnectionScope(base, {
      connectionId: "conn-2",
      clientMode: "desktop-continuous",
    });
    const gate = createRpcGate(scope.service);
    const transport = createAgentConversationTransport(gate.service, {
      workspacePath: "/repo",
    });
    const store = new ConversationProjectionStore(TOPIC, transport);
    const offFrame = transport.onFrame((frame, context) => store.handleFrame(frame, context));

    await store.connect();
    expect(store.getState().subscriptionId).toBe("sub-conn-2-1");

    gate.hold("subscribeConversationV4");
    const reconnect = store.connect();
    await flush();

    gate.hold("resyncConversationV4");
    conversationFrames.fire(onlineDeltasWire("sub-conn-2-1", 1, 7, 8));
    await flush();
    expect(gate.heldCount("resyncConversationV4")).toBe(1);

    await gate.release("resyncConversationV4");
    expect(mocks.resyncConversationV4).toHaveBeenCalledTimes(1);
    expect(store.getState().status).not.toBe("error");

    await gate.release("subscribeConversationV4");
    await reconnect;
    expect(store.getState().status).toBe("live");
    expect(store.getState().subscriptionId).toBe("sub-conn-2-2");
    expect(store.getState().lastError).toBeNull();

    offFrame();
  });
});
