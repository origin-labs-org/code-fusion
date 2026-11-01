import { describe, expect, it, vi } from "vitest";
import { CF_FILE_LOCK_TIMEOUT_ERROR_CODE } from "@origin-ai/cf-shared";
import type {
  SessionSummary,
  SessionsIndexTopicFrame,
  TopicFrameDeliveryKind,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  PROTOCOL_V4_LIMITS,
  SUBSCRIPTION_CONTENT_REJECTED,
  WIRE_FAULT_INVALID_PAYLOAD,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import type { SessionsIndexTransport } from "@/v4/agentSessionsIndexTransport.js";
import { logger } from "@/logger.js";
import {
  EMPTY_SESSIONS_INDEX_STATE,
  SessionsIndexStore,
  applySessionsIndexFrame,
} from "@/v4/sessionsIndexStore.js";

function summary(sessionId: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId,
    workspaceId: "ws-1",
    title: sessionId,
    phase: "draft",
    sessionEnded: false,
    hasBackgroundWork: false,
    lastActivityAt: 100,
    createdAt: 1,
    ...overrides,
  };
}

function snapshotFrame(sessions: SessionSummary[], toSeq: number): SessionsIndexTopicFrame {
  return {
    topic: "sessions-index/ws-1",
    subscriptionId: "sub-1",
    fromSeq: 0,
    toSeq,
    sentAt: 1,
    payload: {
      kind: "snapshot",
      snapshot: {
        protocolVersion: 1,
        workspaceId: "ws-1",
        logEpoch: "epoch-1",
        sessions,
      },
    },
  };
}

type IndexDeltas = Extract<SessionsIndexTopicFrame["payload"], { kind: "deltas" }>["deltas"];

function deltaFrame(deltas: IndexDeltas, fromSeq: number, toSeq: number): SessionsIndexTopicFrame {
  return {
    topic: "sessions-index/ws-1",
    subscriptionId: "sub-1",
    fromSeq,
    toSeq,
    sentAt: 1,
    payload: { kind: "deltas", deltas },
  };
}

describe("applySessionsIndexFrame", () => {
  it("snapshot full replace + watermark=toSeq", () => {
    const { state, gap } = applySessionsIndexFrame(
      EMPTY_SESSIONS_INDEX_STATE,
      snapshotFrame([summary("a"), summary("b")], 5),
    );
    expect(gap).toBe(false);
    expect(state.seq).toBe(5);
    expect(state.workspaceId).toBe("ws-1");
    expect([...state.sessions.keys()].sort()).toEqual(["a", "b"]);
  });

  it("delta continuity (fromSeq===watermark) → apply upsert/remove", () => {
    const seeded = applySessionsIndexFrame(
      EMPTY_SESSIONS_INDEX_STATE,
      snapshotFrame([summary("a")], 5),
    ).state;
    const { state, gap } = applySessionsIndexFrame(
      seeded,
      deltaFrame(
        [
          { op: "session.upserted", session: summary("b", { title: "B" }) },
          { op: "session.removed", sessionId: "a" },
        ],
        5,
        7,
      ),
    );
    expect(gap).toBe(false);
    expect(state.seq).toBe(7);
    expect([...state.sessions.keys()]).toEqual(["b"]);
    expect(state.sessions.get("b")?.title).toBe("B");
  });

  it("delta gap (fromSeq !== watermark) → gap=true, state unchanged", () => {
    const seeded = applySessionsIndexFrame(
      EMPTY_SESSIONS_INDEX_STATE,
      snapshotFrame([summary("a")], 5),
    ).state;
    const { state, gap } = applySessionsIndexFrame(
      seeded,
      deltaFrame([{ op: "session.removed", sessionId: "a" }], 6, 7),
    );
    expect(gap).toBe(true);
    expect(state).toBe(seeded);
  });

  it("silently discard late duplicate toSeq<=watermark, no gap detected", () => {
    const seeded = applySessionsIndexFrame(
      EMPTY_SESSIONS_INDEX_STATE,
      snapshotFrame([summary("a")], 5),
    ).state;
    const { state, gap } = applySessionsIndexFrame(
      seeded,
      deltaFrame([{ op: "session.removed", sessionId: "a" }], 0, 5),
    );
    expect(gap).toBe(false);
    expect(state).toBe(seeded);
  });
});

describe("SessionsIndexStore", () => {
  it("applyFrame notifies listener; getSessions desc by lastActivityAt + stable reference", () => {
    const store = new SessionsIndexStore();
    let notified = 0;
    const unsub = store.subscribe(() => (notified += 1));

    const gap = store.applyFrame(
      snapshotFrame(
        [summary("old", { lastActivityAt: 10 }), summary("new", { lastActivityAt: 20 })],
        3,
      ),
    );
    expect(gap).toBe(false);
    expect(notified).toBe(1);
    const list1 = store.getSessions();
    expect(list1.map((s) => s.sessionId)).toEqual(["new", "old"]);
    expect(store.getSessions()).toBe(list1);

    unsub();
  });

  it("gap frame → applyFrame returns true, state unchanged", () => {
    const store = new SessionsIndexStore();
    store.applyFrame(snapshotFrame([summary("a")], 5));
    const before = store.getState();
    const gap = store.applyFrame(deltaFrame([{ op: "session.removed", sessionId: "a" }], 99, 100));
    expect(gap).toBe(true);
    expect(store.getState()).toBe(before);
  });

  function mockTransport(
    overrides: Partial<SessionsIndexTransport> = {},
    options: { runtimeLifecycle?: boolean } = {},
  ) {
    let frameListener:
      | ((
          frame: SessionsIndexTopicFrame,
          context?: { deliveryKind: TopicFrameDeliveryKind },
        ) => void)
      | null = null;
    let faultListener:
      | ((fault: {
          topic: string;
          subscriptionId: string;
          reasonCode?: string;
          deliveryKind?: TopicFrameDeliveryKind;
        }) => void)
      | null = null;
    let restartListener: (() => void) | null = null;
    let lifecycleListener: ((state: "available" | "unavailable") => void) | null = null;
    const transport: SessionsIndexTransport = {
      subscribe: vi.fn(async () => ({
        ack: {
          subscriptionId: "sub-1",
          mode: "snapshot" as const,
          logEpoch: "epoch-1",
        },
      })),
      unsubscribe: vi.fn(async () => {}),
      resync: vi.fn(async (params) => ({
        ack: {
          subscriptionId: params.subscriptionId,
          mode: params.forceSnapshot ? ("snapshot" as const) : ("resume" as const),
          logEpoch: "epoch-1",
        },
      })),
      activate: vi.fn(() =>
        frameListener?.(snapshotFrame([summary("a")], 2), { deliveryKind: "initial" }),
      ),
      onFrame: vi.fn(
        (
          listener: (
            frame: SessionsIndexTopicFrame,
            context?: { deliveryKind: TopicFrameDeliveryKind },
          ) => void,
        ) => {
          frameListener = listener;
          return () => {
            frameListener = null;
          };
        },
      ),
      onAssemblyFault: vi.fn((listener) => {
        faultListener = listener;
        return () => {
          faultListener = null;
        };
      }),
      onRuntimeRestart: vi.fn((listener) => {
        restartListener = listener;
        return () => {
          restartListener = null;
        };
      }),
      ...(options.runtimeLifecycle
        ? {
            onRuntimeLifecycle: vi.fn((listener) => {
              lifecycleListener = listener;
              return () => {
                lifecycleListener = null;
              };
            }),
          }
        : {}),
      ...overrides,
    };
    return {
      transport,
      pushFrame: (frame: SessionsIndexTopicFrame) =>
        frameListener?.(frame, { deliveryKind: "online" }),
      pushRecoveryFrame: (frame: SessionsIndexTopicFrame) =>
        frameListener?.(frame, { deliveryKind: "recovery" }),
      pushFault: (deliveryKind: TopicFrameDeliveryKind = "online", reasonCode?: string) =>
        faultListener?.({
          topic: "sessions-index/ws-1",
          subscriptionId: "sub-1",
          deliveryKind,
          ...(reasonCode === undefined ? {} : { reasonCode }),
        }),
      restart: () => restartListener?.(),
      runtimeLifecycle: (state: "available" | "unavailable") => lifecycleListener?.(state),
    };
  }

  it("connect: activate after ACK releases initial notification, status→live", async () => {
    const store = new SessionsIndexStore();
    const { transport, pushFrame } = mockTransport();
    await store.connect(transport, { forceSnapshot: true });
    expect(store.getStatus()).toBe("live");
    expect([...store.getState().sessions.keys()]).toEqual(["a"]);
    expect(transport.activate).toHaveBeenCalledWith("sub-1");
    pushFrame(deltaFrame([{ op: "session.upserted", session: summary("b") }], 2, 3));
    expect([...store.getState().sessions.keys()].sort()).toEqual(["a", "b"]);
  });

  it("gap burst → same-sub single-flight resync; recovery gap escalates to force snapshot", async () => {
    const store = new SessionsIndexStore();
    const { transport, pushFrame, pushRecoveryFrame } = mockTransport();
    await store.connect(transport, { forceSnapshot: true });
    expect(transport.subscribe).toHaveBeenCalledTimes(1);
    pushFrame(deltaFrame([{ op: "session.removed", sessionId: "a" }], 99, 100));
    pushFrame(deltaFrame([], 100, 101));
    pushFrame(deltaFrame([], 101, 102));
    await vi.waitFor(() => {
      expect(transport.resync).toHaveBeenCalledTimes(1);
    });
    expect(transport.subscribe).toHaveBeenCalledTimes(1);
    expect(vi.mocked(transport.resync).mock.calls[0]?.[0]).toEqual({
      subscriptionId: "sub-1",
      base: { logEpoch: "epoch-1", seq: 2 },
    });
    pushRecoveryFrame(deltaFrame([], 103, 104));
    await vi.waitFor(() => expect(transport.resync).toHaveBeenCalledTimes(2));
    expect(vi.mocked(transport.resync).mock.calls[1]?.[0]).toMatchObject({
      subscriptionId: "sub-1",
      forceSnapshot: true,
    });
  });

  it("residual online gap after recovery apply starts normal successor after ACK", async () => {
    const store = new SessionsIndexStore();
    let pushFrame!: (frame: SessionsIndexTopicFrame) => void;
    let pushRecoveryFrame!: (frame: SessionsIndexTopicFrame) => void;
    let attempt = 0;
    const kit = mockTransport({
      resync: vi.fn(async (params) => {
        attempt += 1;
        if (attempt === 1) {
          pushRecoveryFrame(deltaFrame([], 2, 3));
          pushFrame(deltaFrame([], 8, 9));
        } else {
          pushRecoveryFrame(deltaFrame([], 3, 3));
        }
        return {
          ack: {
            subscriptionId: params.subscriptionId,
            mode: "resume" as const,
            logEpoch: "epoch-1",
          },
        };
      }),
    });
    pushFrame = kit.pushFrame;
    pushRecoveryFrame = kit.pushRecoveryFrame;
    await store.connect(kit.transport, { forceSnapshot: true });
    pushFrame(deltaFrame([], 99, 100));

    await vi.waitFor(() => expect(kit.transport.resync).toHaveBeenCalledTimes(2));
    expect(vi.mocked(kit.transport.resync).mock.calls[1]?.[0]).toEqual({
      subscriptionId: "sub-1",
      base: { logEpoch: "epoch-1", seq: 3 },
    });
    expect(store.getState().seq).toBe(3);
    store.close();
  });

  it("online delta cannot establish baseline without applied base; online snapshot can", async () => {
    const store = new SessionsIndexStore();
    const kit = mockTransport({ activate: vi.fn() });
    await store.connect(kit.transport, { forceSnapshot: true });
    kit.pushFrame(deltaFrame([{ op: "session.upserted", session: summary("bad") }], 0, 1));
    expect(store.getState().sessions.size).toBe(0);
    expect(vi.mocked(kit.transport.resync).mock.calls[0]?.[0]).toEqual({
      subscriptionId: "sub-1",
      base: null,
      forceSnapshot: true,
    });
    kit.pushFrame(snapshotFrame([summary("good")], 1));
    kit.pushRecoveryFrame(deltaFrame([], 0, 1));
    await Promise.resolve();
    expect([...store.getState().sessions.keys()]).toEqual(["good"]);
    store.close();
  });

  it("zero recovery frames after resync ACK escalates once at deadline and fails closed", async () => {
    vi.useFakeTimers();
    try {
      const store = new SessionsIndexStore();
      const kit = mockTransport();
      await store.connect(kit.transport, { forceSnapshot: true });
      kit.pushFrame(deltaFrame([], 99, 100));
      await Promise.resolve();
      await Promise.resolve();
      expect(kit.transport.resync).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(PROTOCOL_V4_LIMITS.logicalFrameAssemblyTimeoutMs);
      expect(kit.transport.resync).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(PROTOCOL_V4_LIMITS.logicalFrameAssemblyTimeoutMs);
      expect(store.getStatus()).toBe("error");
      store.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("content fault directly forces snapshot without trying inevitably failing resume", async () => {
    const store = new SessionsIndexStore();
    const kit = mockTransport();
    await store.connect(kit.transport, { forceSnapshot: true });
    kit.pushFault("online", WIRE_FAULT_INVALID_PAYLOAD);
    await vi.waitFor(() => expect(kit.transport.resync).toHaveBeenCalledTimes(1));
    expect(vi.mocked(kit.transport.resync).mock.calls[0]?.[0]).toMatchObject({
      subscriptionId: "sub-1",
      forceSnapshot: true,
    });
    store.close();
  });

  it("forced snapshot rejected again by content → terminal contentRejected, no backoff resubscription scheduled", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const store = new SessionsIndexStore();
      const kit = mockTransport();
      await store.connect(kit.transport, { forceSnapshot: true });
      expect(store.getState().sessions.size).toBe(1);

      kit.pushFault("online", WIRE_FAULT_INVALID_PAYLOAD);
      await vi.advanceTimersByTimeAsync(0);
      expect(kit.transport.resync).toHaveBeenCalledTimes(1);

      kit.pushFault("recovery", WIRE_FAULT_INVALID_PAYLOAD);
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getStatus()).toBe("error");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(SUBSCRIPTION_CONTENT_REJECTED));

      await vi.advanceTimersByTimeAsync(60_000);
      expect(kit.transport.subscribe).toHaveBeenCalledTimes(1);
      expect(kit.transport.resync).toHaveBeenCalledTimes(1);
      store.close();
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("forced snapshot after content fault recovers to live if readable (not fail-dead)", async () => {
    const store = new SessionsIndexStore();
    const kit = mockTransport();
    await store.connect(kit.transport, { forceSnapshot: true });
    kit.pushFault("online", WIRE_FAULT_INVALID_PAYLOAD);
    await vi.waitFor(() => expect(kit.transport.resync).toHaveBeenCalledTimes(1));
    kit.pushRecoveryFrame(snapshotFrame([summary("b")], 9));
    await vi.waitFor(() => expect(store.getStatus()).toBe("live"));
    expect([...store.getState().sessions.keys()]).toEqual(["b"]);
    store.close();
  });

  it("deadline timeout during content in-flight still reports timeout terminal state with backoff resubscription retained", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const store = new SessionsIndexStore();
      const kit = mockTransport();
      await store.connect(kit.transport, { forceSnapshot: true });
      kit.pushFault("online", WIRE_FAULT_INVALID_PAYLOAD);
      await vi.advanceTimersByTimeAsync(0);
      expect(kit.transport.resync).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(PROTOCOL_V4_LIMITS.logicalFrameAssemblyTimeoutMs);
      expect(store.getStatus()).toBe("error");
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("fault.subscription.recoveryFrameTimedOut"),
      );
      await vi.advanceTimersByTimeAsync(5_000);
      await Promise.resolve();
      expect(kit.transport.subscribe).toHaveBeenCalledTimes(2);
      store.close();
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("transient faults not swallowed by content classification: no reasonCode still uses original backoff ladder", async () => {
    const store = new SessionsIndexStore();
    const kit = mockTransport();
    await store.connect(kit.transport, { forceSnapshot: true });
    kit.pushFault("online");
    await vi.waitFor(() => expect(kit.transport.resync).toHaveBeenCalledTimes(1));
    expect(vi.mocked(kit.transport.resync).mock.calls[0]?.[0]).not.toMatchObject({
      forceSnapshot: true,
    });
    store.close();
  });

  it("recovery fail-closed clears old projection and performs fresh subscribe after bounded backoff", async () => {
    vi.useFakeTimers();
    try {
      const store = new SessionsIndexStore();
      let subscribeSerial = 0;
      const kit = mockTransport({
        subscribe: vi.fn(async () => ({
          ack: {
            subscriptionId: `sub-${++subscribeSerial}`,
            mode: "snapshot" as const,
            logEpoch: "epoch-1",
          },
        })),
        resync: vi.fn(async (params) => ({
          ack: {
            subscriptionId: params.subscriptionId,
            mode: params.forceSnapshot ? ("snapshot" as const) : ("resume" as const),
            logEpoch: "epoch-1",
          },
        })),
      });

      await store.connect(kit.transport, { forceSnapshot: true });
      kit.pushFrame({
        ...snapshotFrame([summary("a", { phase: "running" })], 3),
        subscriptionId: "sub-1",
      });
      expect(store.getState().sessions.get("a")?.phase).toBe("running");

      kit.pushFrame({
        ...deltaFrame([], 99, 100),
        subscriptionId: "sub-1",
      });
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(PROTOCOL_V4_LIMITS.logicalFrameAssemblyTimeoutMs);
      await vi.advanceTimersByTimeAsync(PROTOCOL_V4_LIMITS.logicalFrameAssemblyTimeoutMs);

      expect(store.getStatus()).toBe("error");
      expect(store.getState().sessions.size).toBe(0);
      expect(kit.transport.unsubscribe).toHaveBeenCalledWith("sub-1");

      await vi.advanceTimersByTimeAsync(4_999);
      expect(kit.transport.subscribe).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
      expect(kit.transport.subscribe).toHaveBeenCalledTimes(2);
      expect(store.getStatus()).toBe("live");

      kit.pushFrame({
        ...snapshotFrame([summary("a", { phase: "completedSuccess" })], 4),
        subscriptionId: "sub-2",
      });
      expect(store.getState().sessions.get("a")?.phase).toBe("completedSuccess");
      store.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("non-transient connect failure clears old projection and retries with 5s/15s backoff", async () => {
    vi.useFakeTimers();
    try {
      const store = new SessionsIndexStore();
      store.applyFrame(snapshotFrame([summary("a", { phase: "running" })], 3));
      let subscribeAttempts = 0;
      const kit = mockTransport({
        subscribe: vi.fn(async () => {
          subscribeAttempts += 1;
          if (subscribeAttempts < 3) throw new Error("bridge disconnected");
          return {
            ack: {
              subscriptionId: "sub-1",
              mode: "snapshot" as const,
              logEpoch: "epoch-1",
            },
          };
        }),
      });

      await store.connect(kit.transport, { forceSnapshot: true });
      expect(store.getStatus()).toBe("error");
      expect(store.getState().sessions.size).toBe(0);

      await vi.advanceTimersByTimeAsync(4_999);
      expect(subscribeAttempts).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
      expect(subscribeAttempts).toBe(2);
      expect(store.getStatus()).toBe("error");

      await vi.advanceTimersByTimeAsync(14_999);
      expect(subscribeAttempts).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
      expect(subscribeAttempts).toBe(3);
      expect(store.getStatus()).toBe("live");
      store.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resync notOwned → auto self-heals via fresh subscribe without entering error", async () => {
    const store = new SessionsIndexStore();
    let sub = 0;
    const kit = mockTransport({
      subscribe: vi.fn(async () => ({
        ack: {
          subscriptionId: `sub-${++sub}`,
          mode: "snapshot" as const,
          logEpoch: "epoch-1",
        },
      })),
      activate: vi.fn(),
      resync: vi.fn(async () => {
        throw new Error("fault.subscription.notOwned");
      }),
    });
    await store.connect(kit.transport, { forceSnapshot: true });
    expect(store.getStatus()).toBe("live");
    kit.pushFrame(deltaFrame([], 99, 100));
    await vi.waitFor(() => expect(kit.transport.subscribe).toHaveBeenCalledTimes(2));
    expect(store.getStatus()).toBe("live");
    store.close();
  });

  it("generation-shift subscribe ACK drops old recovery created in await window; late resync failure does not taint new subscription", async () => {
    const store = new SessionsIndexStore();
    let sub = 0;
    const subscribeGates: Array<() => void> = [];
    let rejectResync!: (error: Error) => void;
    const kit = mockTransport({
      subscribe: vi.fn(async () => {
        if (sub >= 1) await new Promise<void>((release) => subscribeGates.push(release));
        return {
          ack: {
            subscriptionId: `sub-${++sub}`,
            mode: "snapshot" as const,
            logEpoch: "epoch-1",
          },
        };
      }),
      activate: vi.fn(),
      resync: vi.fn(
        () =>
          new Promise((_resolve, reject) => {
            rejectResync = reject;
          }),
      ),
    });
    await store.connect(kit.transport, { forceSnapshot: true });
    const reconnect = store.connect(kit.transport, { forceSnapshot: true });
    kit.pushFrame(deltaFrame([], 99, 100));
    await vi.waitFor(() => expect(kit.transport.resync).toHaveBeenCalledTimes(1));
    subscribeGates.shift()?.();
    await reconnect;
    expect(store.getStatus()).toBe("live");
    rejectResync(new Error("fault.subscription.notOwned"));
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getStatus()).toBe("live");
    expect(kit.transport.subscribe).toHaveBeenCalledTimes(2);
    store.close();
  });

  it("runtime restart clears old generation and performs a fresh subscribe once", async () => {
    const store = new SessionsIndexStore();
    const { transport, restart } = mockTransport();
    await store.connect(transport, { forceSnapshot: true });
    restart();
    await vi.waitFor(() => expect(transport.subscribe).toHaveBeenCalledTimes(2));
    expect(vi.mocked(transport.subscribe).mock.calls[1]?.[0]).toEqual({});
  });

  it("runtime restart burst coalesces with exponential backoff, executing fresh subscribe only once", async () => {
    vi.useFakeTimers();
    try {
      const store = new SessionsIndexStore();
      const { transport, restart } = mockTransport();
      await store.connect(transport, { forceSnapshot: true });

      restart();
      restart();
      restart();
      await vi.advanceTimersByTimeAsync(199);
      expect(transport.subscribe).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(transport.subscribe).toHaveBeenCalledTimes(2);
      expect(vi.mocked(transport.subscribe).mock.calls[1]?.[0]).toEqual({});
      store.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("missing runtime enters dormant without polling; recovers on available, clears live projection on unavailable", async () => {
    vi.useFakeTimers();
    try {
      const store = new SessionsIndexStore();
      store.applyFrame(snapshotFrame([summary("stale", { phase: "running" })], 1));
      let attempts = 0;
      const kit = mockTransport(
        {
          subscribe: vi.fn(async () => {
            attempts += 1;
            if (attempts === 1) {
              throw Object.assign(new Error("agent runtime is unavailable"), {
                code: "CF_AGENT_RUNTIME_UNAVAILABLE",
              });
            }
            return {
              ack: { subscriptionId: "sub-1", mode: "snapshot", logEpoch: "epoch-1" },
            };
          }),
        },
        { runtimeLifecycle: true },
      );

      await store.connect(kit.transport, { forceSnapshot: true });
      expect(store.getStatus()).toBe("dormant");
      await vi.advanceTimersByTimeAsync(30_000);
      expect(kit.transport.subscribe).toHaveBeenCalledTimes(1);

      kit.runtimeLifecycle("available");
      await vi.advanceTimersByTimeAsync(0);
      expect(kit.transport.subscribe).toHaveBeenCalledTimes(2);
      expect(store.getStatus()).toBe("live");
      expect([...store.getState().sessions.keys()]).toEqual(["a"]);

      kit.runtimeLifecycle("unavailable");
      expect(store.getStatus()).toBe("dormant");
      expect(store.getState()).toBe(EMPTY_SESSIONS_INDEX_STATE);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(kit.transport.subscribe).toHaveBeenCalledTimes(2);
      store.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when resync ACK subscriptionId mismatches", async () => {
    const store = new SessionsIndexStore();
    const { transport, pushFrame } = mockTransport({
      resync: vi.fn(async () => ({
        ack: { subscriptionId: "foreign-sub", mode: "resume", logEpoch: "epoch-1" },
      })),
    });
    await store.connect(transport, { forceSnapshot: true });
    pushFrame(deltaFrame([], 99, 100));
    await vi.waitFor(() => expect(store.getStatus()).toBe("error"));
    expect(transport.resync).toHaveBeenCalledTimes(1);
  });

  it("initial staging overflow triggers one fresh retry", async () => {
    const store = new SessionsIndexStore();
    let attempts = 0;
    const { transport } = mockTransport({
      subscribe: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("fault.subscription.initialFrameStagingOverflow");
        return {
          ack: { subscriptionId: "sub-1", mode: "snapshot", logEpoch: "epoch-1" },
        };
      }),
    });
    await store.connect(transport, { forceSnapshot: true });
    expect(transport.subscribe).toHaveBeenCalledTimes(2);
    expect(store.getStatus()).toBe("live");
  });

  it("config lock causing initial subscribe transient failure keeps hydrating and recovers automatically", async () => {
    vi.useFakeTimers();
    try {
      const store = new SessionsIndexStore();
      let attempts = 0;
      const { transport } = mockTransport({
        subscribe: vi.fn(async () => {
          attempts += 1;
          if (attempts === 1) {
            throw Object.assign(
              new Error("EEXIST: file already exists, open '/tmp/config.json.lock'"),
              { code: "EEXIST" },
            );
          }
          return {
            ack: { subscriptionId: "sub-1", mode: "snapshot", logEpoch: "epoch-1" },
          };
        }),
      });

      await store.connect(transport, { forceSnapshot: true });
      expect(store.getStatus()).toBe("connecting");
      expect(store.getState().workspaceId).toBeNull();
      expect(transport.subscribe).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(250);

      expect(transport.subscribe).toHaveBeenCalledTimes(2);
      expect(store.getStatus()).toBe("live");
      expect([...store.getState().sessions.keys()]).toEqual(["a"]);
      store.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("config lock timeout error code causing initial subscribe transient failure recovers automatically", async () => {
    vi.useFakeTimers();
    try {
      const store = new SessionsIndexStore();
      let attempts = 0;
      const { transport } = mockTransport({
        subscribe: vi.fn(async () => {
          attempts += 1;
          if (attempts === 1) {
            throw Object.assign(new Error("lock timeout without a path"), {
              code: CF_FILE_LOCK_TIMEOUT_ERROR_CODE,
            });
          }
          return {
            ack: { subscriptionId: "sub-1", mode: "snapshot", logEpoch: "epoch-1" },
          };
        }),
      });

      await store.connect(transport, { forceSnapshot: true });
      expect(store.getStatus()).toBe("connecting");
      await vi.advanceTimersByTimeAsync(250);

      expect(transport.subscribe).toHaveBeenCalledTimes(2);
      expect(store.getStatus()).toBe("live");
      store.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("瞬时失败退避期间 close 会取消重订阅", async () => {
    vi.useFakeTimers();
    try {
      const store = new SessionsIndexStore();
      const { transport } = mockTransport({
        subscribe: vi.fn(async () => {
          throw Object.assign(new Error("EBUSY: config.json.lock"), { code: "EBUSY" });
        }),
      });

      await store.connect(transport, { forceSnapshot: true });
      expect(store.getStatus()).toBe("connecting");

      store.close();
      await vi.advanceTimersByTimeAsync(3_000);

      expect(transport.subscribe).toHaveBeenCalledTimes(1);
      expect(store.getStatus()).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("enters error after transient failure retries exhausted, will not hang in hydrating", async () => {
    vi.useFakeTimers();
    try {
      const store = new SessionsIndexStore();
      const { transport } = mockTransport({
        subscribe: vi.fn(async () => {
          throw Object.assign(new Error("EBUSY: config.json.lock"), { code: "EBUSY" });
        }),
      });

      await store.connect(transport, { forceSnapshot: true });
      await vi.advanceTimersByTimeAsync(250 + 1_000 + 3_000);

      expect(transport.subscribe).toHaveBeenCalledTimes(4);
      expect(store.getStatus()).toBe("error");
      store.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("non-config-lock EEXIST is not retried as a transient failure", async () => {
    const store = new SessionsIndexStore();
    const { transport } = mockTransport({
      subscribe: vi.fn(async () => {
        throw Object.assign(new Error("EEXIST: workspace path is a file"), { code: "EEXIST" });
      }),
    });

    await store.connect(transport, { forceSnapshot: true });

    expect(transport.subscribe).toHaveBeenCalledTimes(1);
    expect(store.getStatus()).toBe("error");
    store.close();
  });

  it("ignore frames from other subscription generations (R-01: syncer permanent subscription shares topic with sidebar, must not misdetect gaps)", async () => {
    const store = new SessionsIndexStore();
    const { transport, pushFrame } = mockTransport();
    await store.connect(transport, { forceSnapshot: true });
    expect(transport.subscribe).toHaveBeenCalledTimes(1);
    pushFrame({
      ...deltaFrame([{ op: "session.removed", sessionId: "a" }], 99, 100),
      subscriptionId: "six-task-index-1",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(transport.subscribe).toHaveBeenCalledTimes(1);
    expect(store.getState().sessions.has("a")).toBe(true);
  });

  it("close: unsubscribe + block incoming frames; reconnect revives (StrictMode double invoke)", async () => {
    const store = new SessionsIndexStore();
    const { transport, pushFrame } = mockTransport();
    await store.connect(transport, { forceSnapshot: true });
    store.close();
    expect(transport.unsubscribe).toHaveBeenCalledWith("sub-1");
    pushFrame(deltaFrame([{ op: "session.upserted", session: summary("b") }], 2, 3));
    expect(store.getState().sessions.has("b")).toBe(false);
    await store.connect(transport, { forceSnapshot: true });
    expect(store.getStatus()).toBe("live");
  });

  it("close: old service proxy unsubscribe failure is caught and logged without unhandled rejection", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const store = new SessionsIndexStore();
    const { transport } = mockTransport({
      unsubscribe: vi.fn(async () => {
        throw new Error("old proxy disconnected");
      }),
    });
    await store.connect(transport, { forceSnapshot: true });

    store.close();

    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("failed to unsubscribe sub-1 (ignored)")),
    );
    expect(store.getStatus()).toBe("idle");
    warn.mockRestore();
  });
});
