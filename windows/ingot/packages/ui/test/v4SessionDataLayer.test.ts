import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CommandAck,
  CommandEnvelope,
  CommandsQueryParams,
  CommandsQueryResult,
  ConversationRow,
  ConversationSnapshot,
  ConversationTopicFrame,
  SubscribeParams,
  TopicFrameDeliveryKind,
  ToolCallRow,
  V4ConversationPlansParams,
  V4ConversationPlansResult,
  V4ConversationRowsRangeParams,
  V4ConversationRowsRangeResult,
  V4ConversationResyncResult,
  V4ConversationSubscribeResult,
  WorkflowRunState,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { PROTOCOL_V4_LIMITS, conversationTopicFrameSchema } from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  E2E_SESSION_DATA_LAYER_KEEP_WARM_MS,
  resolveSessionDataLayerKeepWarmMs,
  SESSION_DATA_LAYER_KEEP_WARM_MS,
  SessionDataLayer,
} from "@/v4/sessionDataLayer.js";
import {
  ACCEPTED_INPUT_PROJECTION_GRACE_MS,
  ConversationProjectionStore,
  hasOlderRows,
  mergeOlderRows,
  shouldAutoLoadIncompleteLeadingTurn,
} from "@/v4/conversationProjectionStore.js";
import type { ConversationTransport } from "@/v4/transport.js";
import {
  SUBSCRIPTION_CONTENT_REJECTED,
  WIRE_FAULT_INVALID_PAYLOAD,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { logger } from "@/logger.js";

function makeSnapshot(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    protocolVersion: 1,
    sessionId: "s1",
    logEpoch: "epoch-1",
    seq: 0,
    revision: 0,
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
    rows: { window: [], totalCount: 0, firstRowId: null },
    ...overrides,
  };
}

function assistantRow(rowId: number, text: string): ConversationRow {
  return {
    rowId,
    turnId: "t1",
    createdAt: 1,
    createdAtSeq: rowId,
    kind: "assistantText",
    text,
    state: "streaming",
  };
}

function realUserRow(rowId: number, turnId: string): ConversationRow {
  return {
    rowId,
    turnId,
    createdAt: 1,
    createdAtSeq: rowId,
    kind: "userInput",
    origin: "realUser",
    text: `Issue ${rowId}`,
  };
}

function turnHeaderRow(rowId: number, turnId = "t1"): ConversationRow {
  return {
    rowId,
    turnId,
    createdAt: 1,
    createdAtSeq: rowId,
    kind: "turnHeader",
    origin: "userInput",
    state: "completedSuccess",
    startedAt: 1,
    activeMs: 1,
  };
}

function planRow(rowId: number, status: ToolCallRow["status"] = "success"): ToolCallRow {
  return {
    rowId,
    turnId: "t1",
    createdAt: 1,
    createdAtSeq: rowId,
    kind: "toolCall",
    toolCallId: `plan-${rowId}`,
    toolName: "ExitPlanMode",
    status,
    input: { plan: `# Plan ${rowId}` },
    inputText: JSON.stringify({ plan: `# Plan ${rowId}` }),
  };
}

function makeFrame(
  subscriptionId: string,
  fromSeq: number,
  toSeq: number,
  payload: ConversationTopicFrame["payload"],
  topic = "conversation/s1",
): ConversationTopicFrame {
  return { topic, subscriptionId, fromSeq, toSeq, sentAt: 1, payload };
}

function workflowRun(runId: string, nodes: number): WorkflowRunState {
  return {
    runId,
    status: "running",
    usage: { spentTokens: 0, nodesUsed: nodes },
    actors: [],
    nodes: Array.from({ length: nodes }, (_, index) => ({
      siteId: "node",
      ordinal: index + 1,
      phase: "queued" as const,
    })),
    lastEventSequence: nodes,
  };
}

class FakeTransport implements ConversationTransport {
  subscribeCalls: SubscribeParams[] = [];
  unsubscribeCalls: string[] = [];
  activateCalls: string[] = [];
  private frameListeners = new Set<
    (frame: ConversationTopicFrame, context?: { deliveryKind: TopicFrameDeliveryKind }) => void
  >();
  private faultListeners = new Set<
    (fault: {
      topic: string;
      subscriptionId: string;
      reasonCode?: string;
      deliveryKind?: TopicFrameDeliveryKind;
    }) => void
  >();
  private restartListeners = new Set<Parameters<ConversationTransport["onRuntimeRestart"]>[0]>();
  private initialFrames = new Map<string, ConversationTopicFrame>();
  private subCounter = 0;
  
  subscribeImpl: (
    params: SubscribeParams,
    subscriptionId: string,
  ) =>
    | (V4ConversationSubscribeResult & { initialFrame?: ConversationTopicFrame })
    | Promise<V4ConversationSubscribeResult & { initialFrame?: ConversationTopicFrame }> = (
    params,
    subscriptionId,
  ) => ({
    ack: { subscriptionId, mode: "snapshot", logEpoch: "epoch-1" },
    initialFrame: makeFrame(
      subscriptionId,
      0,
      5,
      {
        kind: "snapshot",
        snapshot: makeSnapshot({ seq: 5 }),
      },
      params.topic,
    ),
  });

  async subscribe(params: SubscribeParams): Promise<V4ConversationSubscribeResult> {
    this.subscribeCalls.push(params);
    const subscriptionId = `sub-${++this.subCounter}`;
    const dispatch = await this.subscribeImpl(params, subscriptionId);
    if (dispatch.initialFrame) {
      this.initialFrames.set(subscriptionId, dispatch.initialFrame);
    }
    return { ack: dispatch.ack };
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    this.unsubscribeCalls.push(subscriptionId);
    this.initialFrames.delete(subscriptionId);
  }

  resyncCalls: Array<{
    subscriptionId: string;
    base: { logEpoch: string; seq: number } | null;
    forceSnapshot?: boolean;
  }> = [];
  resyncImpl: (params: {
    subscriptionId: string;
    base: { logEpoch: string; seq: number } | null;
    forceSnapshot?: boolean;
  }) => V4ConversationResyncResult | Promise<V4ConversationResyncResult> = (params) => ({
    ack: {
      subscriptionId: params.subscriptionId,
      mode: params.forceSnapshot ? "snapshot" : "resume",
      logEpoch: "epoch-1",
    },
  });

  async resync(params: {
    subscriptionId: string;
    base: { logEpoch: string; seq: number } | null;
    forceSnapshot?: boolean;
  }): Promise<V4ConversationResyncResult> {
    this.resyncCalls.push(params);
    return this.resyncImpl(params);
  }

  activate(subscriptionId: string): void {
    this.activateCalls.push(subscriptionId);
    const initialFrame = this.initialFrames.get(subscriptionId);
    this.initialFrames.delete(subscriptionId);
    if (initialFrame) this.emitKind(initialFrame, "initial");
  }

  async sendCommand(_envelope: CommandEnvelope): Promise<CommandAck> {
    throw new Error("not used in this suite");
  }

  async queryCommands(_params: CommandsQueryParams): Promise<CommandsQueryResult> {
    throw new Error("not used in this suite");
  }

  rowsRangeCalls: V4ConversationRowsRangeParams[] = [];
  
  rowsRangeImpl: (
    params: V4ConversationRowsRangeParams,
  ) => V4ConversationRowsRangeResult | Promise<V4ConversationRowsRangeResult> = () => ({
    rows: [],
    atSeq: 0,
    atRevision: 0,
    atLogEpoch: "epoch-1",
    hasMore: false,
  });

  async rowsRange(params: V4ConversationRowsRangeParams): Promise<V4ConversationRowsRangeResult> {
    this.rowsRangeCalls.push(params);
    return this.rowsRangeImpl(params);
  }

  plansCalls: V4ConversationPlansParams[] = [];
  plansImpl: (
    params: V4ConversationPlansParams,
  ) => V4ConversationPlansResult | Promise<V4ConversationPlansResult> = () => ({
    plans: [],
    atSeq: 0,
    atLogEpoch: "epoch-1",
  });

  async plans(params: V4ConversationPlansParams): Promise<V4ConversationPlansResult> {
    this.plansCalls.push(params);
    return this.plansImpl(params);
  }

  onFrame(
    listener: (
      frame: ConversationTopicFrame,
      context?: { deliveryKind: TopicFrameDeliveryKind },
    ) => void,
  ): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onAssemblyFault(
    listener: (fault: { topic: string; subscriptionId: string; reasonCode?: string }) => void,
  ): () => void {
    this.faultListeners.add(listener);
    return () => this.faultListeners.delete(listener);
  }

  onRuntimeRestart(listener: Parameters<ConversationTransport["onRuntimeRestart"]>[0]): () => void {
    this.restartListeners.add(listener);
    return () => this.restartListeners.delete(listener);
  }

  emit(frame: ConversationTopicFrame): void {
    this.emitKind(frame, "online");
  }

  emitRecovery(frame: ConversationTopicFrame): void {
    this.emitKind(frame, "recovery");
  }

  emitKind(frame: ConversationTopicFrame, deliveryKind: TopicFrameDeliveryKind): void {
    for (const listener of this.frameListeners) listener(frame, { deliveryKind });
  }

  emitFault(
    topic = "conversation/s1",
    subscriptionId = "sub-1",
    deliveryKind: TopicFrameDeliveryKind = "online",
    reasonCode?: string,
  ): void {
    for (const listener of this.faultListeners) {
      listener({ topic, subscriptionId, deliveryKind, ...(reasonCode ? { reasonCode } : {}) });
    }
  }

  restart(): void {
    for (const listener of this.restartListeners) listener();
  }

  replaceTransport(): void {
    for (const listener of this.restartListeners) listener("transportReplaced");
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// ── ConversationProjectionStore ──

describe("ConversationProjectionStore", () => {
  let transport: FakeTransport;
  let store: ConversationProjectionStore;

  beforeEach(() => {
    transport = new FakeTransport();
    store = new ConversationProjectionStore("conversation/s1", transport);
    transport.onFrame((frame, context) => store.handleFrame(frame, context));
  });

  it("Retain subscribe ACK timing，并记录首帧到 projection apply 的 Renderer timing", async () => {
    transport.subscribeImpl = (params, subscriptionId) => ({
      ack: {
        subscriptionId,
        mode: "snapshot",
        logEpoch: "epoch-1",
        openTiming: {
          version: 1,
          cliSessionRestoreMs: 120,
          initialFrameEncodeMs: 4,
          sessionRuntimeState: "cold",
          snapshotRowCount: 1,
        },
      },
      initialFrame: makeFrame(
        subscriptionId,
        0,
        5,
        { kind: "snapshot", snapshot: makeSnapshot({ seq: 5 }) },
        params.topic,
      ),
    });

    await store.connect();

    expect(store.getState().openTiming).toMatchObject({
      cliSessionRestoreMs: 120,
      initialFrameEncodeMs: 4,
    });
    expect(store.getState().rendererTiming).toMatchObject({
      initialFrameTransportMs: expect.any(Number),
      rendererSnapshotApplyMs: expect.any(Number),
      snapshotAppliedAt: expect.any(Number),
    });
    expect(store.getSessionOpenRendererTiming()).toMatchObject({
      rendererPrepareMs: expect.any(Number),
      initialFrameTransportMs: expect.any(Number),
      rendererSnapshotApplyMs: expect.any(Number),
      snapshotAppliedAt: expect.any(Number),
    });
    await store.close();
  });

  it("从 Renderer acquire From点计算 prepare timing", async () => {
    await store.connect({ rendererPrepareStartedAt: performance.now() - 100 });

    expect(store.getSessionOpenRendererTiming().rendererPrepareMs).toBeGreaterThanOrEqual(90);
    await store.close();
  });

  it("首连 base=none，snapshot 帧整体替换", async () => {
    await store.connect();
    expect(transport.subscribeCalls[0].base).toBeUndefined();
    const state = store.getState();
    expect(state.status).toBe("live");
    expect(state.snapshot?.seq).toBe(5);
    expect(state.subscriptionId).toBe("sub-1");
    expect(transport.activateCalls).toEqual(["sub-1"]);
  });

  it("proxy handoff 携Current水位重订阅，由Service端Adjudication resume/snapshot", async () => {
    await store.connect();

    transport.replaceTransport();
    await flushMicrotasks();

    expect(transport.subscribeCalls).toHaveLength(2);
    expect(transport.subscribeCalls[1]?.base).toEqual({ logEpoch: "epoch-1", seq: 5 });
  });

  it("I56：只通知首次应用的 online fallback，initial/recovery/duplicate 只更New基线", async () => {
    transport.subscribeImpl = (params, subscriptionId) => ({
      ack: { subscriptionId, mode: "snapshot", logEpoch: "epoch-1" },
      initialFrame: makeFrame(
        subscriptionId,
        0,
        5,
        {
          kind: "snapshot",
          snapshot: makeSnapshot({
            seq: 5,
            modelTransition: {
              eventId: "event-initial",
              origin: "registryFallback",
              from: { provider: "provider-a", model: "model-a" },
              to: { provider: "provider-b", model: "model-b" },
            },
          }),
        },
        params.topic,
      ),
    });
    const listener = vi.fn();
    store.onOnlineModelTransition(listener);

    await store.connect();
    expect(listener).not.toHaveBeenCalled();

    const onlineFrame = makeFrame("sub-1", 5, 6, {
      kind: "deltas",
      deltas: [
        {
          op: "state.updated",
          patch: {
            modelTransition: {
              eventId: "event-online-1",
              origin: "registryFallback",
              from: { provider: "provider-b", model: "model-b" },
              to: { provider: "provider-c", model: "model-c" },
            },
          },
        },
      ],
    });
    transport.emit(onlineFrame);
    transport.emit(onlineFrame);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({
      eventId: "event-online-1",
      origin: "registryFallback",
      from: { provider: "provider-b", model: "model-b" },
      to: { provider: "provider-c", model: "model-c" },
    });

    transport.emitRecovery(
      makeFrame("sub-1", 6, 7, {
        kind: "deltas",
        deltas: [
          {
            op: "state.updated",
            patch: {
              modelTransition: {
                eventId: "event-recovery",
                origin: "registryFallback",
                from: { provider: "provider-c", model: "model-c" },
                to: { provider: "provider-d", model: "model-d" },
              },
            },
          },
        ],
      }),
    );
    transport.emit(
      makeFrame("sub-1", 7, 8, {
        kind: "deltas",
        deltas: [{ op: "state.updated", patch: { revision: 8 } }],
      }),
    );
    expect(listener).toHaveBeenCalledTimes(1);

    transport.emit(
      makeFrame("sub-1", 8, 9, {
        kind: "deltas",
        deltas: [
          {
            op: "state.updated",
            patch: {
              modelTransition: {
                eventId: "event-online-2",
                origin: "registryFallback",
                from: { provider: "provider-d", model: "model-d" },
                to: { provider: "provider-e", model: "model-e" },
              },
            },
          },
        ],
      }),
    );
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("QueryCompleteFinal statePlanTable of Contents并RetainService端顺序", async () => {
    transport.plansImpl = () => ({
      plans: [planRow(9), planRow(4, "cancelled")],
      atSeq: 5,
      atLogEpoch: "epoch-1",
    });

    await store.connect();
    await store.refreshPlans();

    expect(transport.plansCalls).toEqual([{ sessionId: "s1" }]);
    expect(store.getState().sessionPlans.map((row) => row.rowId)).toEqual([9, 4]);
    expect(store.getState().plansLoading).toBe(false);
  });

  it("只在 snapshot、Final state ExitPlanMode and分支裁剪时InvalidPlanTable of Contents", async () => {
    transport.plansImpl = () => ({
      plans: [planRow(1)],
      atSeq: 5,
      atLogEpoch: "epoch-1",
    });
    await store.connect();
    await store.refreshPlans();
    const afterSnapshot = store.getState().planDirectoryRevision;

    transport.emit(
      makeFrame("sub-1", 5, 6, {
        kind: "deltas",
        deltas: [{ op: "row.appended", row: planRow(1, "running") }],
      }),
    );
    expect(store.getState().planDirectoryRevision).toBe(afterSnapshot);

    transport.emit(
      makeFrame("sub-1", 6, 7, {
        kind: "deltas",
        deltas: [{ op: "row.upserted", row: planRow(1, "success") }],
      }),
    );
    expect(store.getState().planDirectoryRevision).toBe(afterSnapshot + 1);

    transport.emit(
      makeFrame("sub-1", 7, 8, {
        kind: "deltas",
        deltas: [{ op: "row.removed", fromRowId: 1 }],
      }),
    );
    expect(store.getState().planDirectoryRevision).toBe(afterSnapshot + 2);
    expect(store.getState().sessionPlans).toEqual([]);
  });

  it("合并ConcurrencyQuery并丢弃分支修订前的迟到Table of Contents", async () => {
    let resolveFirst!: (result: V4ConversationPlansResult) => void;
    let requestCount = 0;
    transport.plansImpl = () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Promise<V4ConversationPlansResult>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return {
        plans: [planRow(7)],
        atSeq: 6,
        atLogEpoch: "epoch-1",
      };
    };
    await store.connect();

    const first = store.refreshPlans();
    await flushMicrotasks();
    transport.emit(
      makeFrame("sub-1", 5, 6, {
        kind: "deltas",
        deltas: [{ op: "row.appended", row: planRow(7) }],
      }),
    );
    await store.refreshPlans();
    resolveFirst({ plans: [planRow(3)], atSeq: 5, atLogEpoch: "epoch-1" });
    await first;
    await vi.waitFor(() => expect(transport.plansCalls).toHaveLength(2));
    await vi.waitFor(() =>
      expect(store.getState().sessionPlans.map((row) => row.rowId)).toEqual([7]),
    );
  });

  it("Run时重启后丢弃Old generation 的迟到PlanQuery", async () => {
    let resolvePlans!: (result: V4ConversationPlansResult) => void;
    transport.plansImpl = () =>
      new Promise<V4ConversationPlansResult>((resolve) => {
        resolvePlans = resolve;
      });
    await store.connect();

    const pending = store.refreshPlans();
    await flushMicrotasks();
    transport.restart();
    resolvePlans({ plans: [planRow(3)], atSeq: 5, atLogEpoch: "epoch-1" });
    await pending;
    await flushMicrotasks();

    expect(store.getState().sessionPlans).toEqual([]);
    expect(transport.subscribeCalls).toHaveLength(2);
  });

  it("delta 帧区间衔接时 apply，seq 推进到 toSeq", async () => {
    await store.connect();
    transport.emit(
      makeFrame("sub-1", 5, 7, {
        kind: "deltas",
        deltas: [
          { op: "row.appended", row: assistantRow(1, "he") },
          { op: "row.delta", rowId: 1, path: "text", append: "llo" },
        ],
      }),
    );
    const snapshot = store.getState().snapshot!;
    expect(snapshot.seq).toBe(7);
    expect(snapshot.rows.window).toHaveLength(1);
    expect(snapshot.rows.window[0]).toMatchObject({ rowId: 1, text: "hello" });
  });

  it("workflowRun.updated 帧经严格 zod 与 apply 落库，只让被改的 run 换身份", async () => {
    await store.connect();
    transport.emit(
      makeFrame("sub-1", 5, 6, {
        kind: "deltas",
        deltas: [
          {
            op: "state.updated",
            patch: {
              workflowRuns: {
                revision: 1,
                runs: [workflowRun("run-a", 3), workflowRun("run-b", 1)],
              },
            },
          },
          { op: "row.appended", row: assistantRow(1, "hi") },
        ],
      }),
    );
    const seeded = store.getState().snapshot!;
    const untouched = seeded.workflowRuns!.runs[1]!;
    const rows = seeded.rows;

    const frame = makeFrame("sub-1", 6, 7, {
      kind: "deltas",
      deltas: [
        {
          op: "workflowRun.updated",
          runId: "run-a",
          revision: 2,
          run: { status: "completed", lastEventSequence: 9 },
          nodes: [{ siteId: "node", ordinal: 3, phase: "settled", outcome: "ok" }],
        },
      ],
    });
    expect(conversationTopicFrameSchema.safeParse(frame).success).toBe(true);
    transport.emit(frame);

    const next = store.getState().snapshot!;
    expect(next.workflowRuns).not.toBe(seeded.workflowRuns);
    expect(next.workflowRuns).toMatchObject({ revision: 2 });
    expect(next.workflowRuns!.runs[0]).toMatchObject({
      runId: "run-a",
      status: "completed",
      lastEventSequence: 9,
    });
    expect(next.workflowRuns!.runs[0]!.nodes).toHaveLength(3);
    expect(next.workflowRuns!.runs[0]!.nodes[2]).toMatchObject({ ordinal: 3, phase: "settled" });
    expect(next.workflowRuns!.runs[1]).toBe(untouched);
    expect(next.rows).toBe(rows);
  });

  it("首轮 rewind 后New分支的 rowId 空洞不触发加载更早", async () => {
    await store.connect();
    transport.emit(
      makeFrame("sub-1", 5, 6, {
        kind: "deltas",
        deltas: [
          { op: "row.appended", row: assistantRow(1, "old-1") },
          { op: "row.appended", row: assistantRow(2, "old-2") },
        ],
      }),
    );
    transport.emit(
      makeFrame("sub-1", 6, 7, {
        kind: "deltas",
        deltas: [
          { op: "row.removed", fromRowId: 1 },
          { op: "row.appended", row: assistantRow(5, "edited") },
        ],
      }),
    );

    const snapshot = store.getState().snapshot!;
    expect(snapshot.rows.window.map((row) => row.rowId)).toEqual([5]);
    expect(snapshot.rows.totalCount).toBe(1);
    expect(snapshot.rows.firstRowId).toBe(5);
    expect(hasOlderRows(snapshot)).toBe(false);
  });

  it("late duplicate toSeq<=localSeq 静默丢弃且不触发 resync", async () => {
    await store.connect();
    transport.emit(makeFrame("sub-1", 0, 5, { kind: "deltas", deltas: [] }));
    expect(transport.resyncCalls).toEqual([]);
    expect(store.getState().snapshot?.seq).toBe(5);
  });

  it("Three个同步 gap 共用One次 same-sub flight；resume ACK 后再 gap Upgrade force snapshot", async () => {
    await store.connect();
    for (let index = 0; index < 3; index += 1) {
      transport.emit(makeFrame("sub-1", 99 + index, 100 + index, { kind: "deltas", deltas: [] }));
    }
    expect(transport.resyncCalls).toEqual([
      {
        subscriptionId: "sub-1",
        base: { logEpoch: "epoch-1", seq: 5 },
      },
    ]);
    await flushMicrotasks();
    transport.emitRecovery(makeFrame("sub-1", 120, 121, { kind: "deltas", deltas: [] }));
    await flushMicrotasks();
    expect(transport.resyncCalls[1]).toEqual({
      subscriptionId: "sub-1",
      base: { logEpoch: "epoch-1", seq: 5 },
      forceSnapshot: true,
    });
    transport.emitRecovery(
      makeFrame("sub-1", 0, 121, {
        kind: "snapshot",
        snapshot: makeSnapshot({ seq: 121 }),
      }),
    );
    expect(store.getState().snapshot?.seq).toBe(121);
  });

  it("assembly fault Retain可见 snapshot，并且 burst fault 只触发One次恢复", async () => {
    await store.connect();
    const before = store.getState().snapshot;
    transport.emitFault();
    transport.emitFault();
    transport.emitFault();
    expect(store.getState().snapshot).toBe(before);
    expect(transport.resyncCalls).toHaveLength(1);
  });

  it("original initial assembly fault 无合法 base，首个 same-sub recovery 直接强制 snapshot", async () => {
    transport.subscribeImpl = (_params, subscriptionId) => ({
      ack: { subscriptionId, mode: "snapshot", logEpoch: "epoch-1" },
    });
    await store.connect();
    transport.emitFault("conversation/s1", "sub-1", "initial");
    await flushMicrotasks();

    expect(transport.subscribeCalls).toHaveLength(1);
    expect(transport.resyncCalls).toEqual([
      { subscriptionId: "sub-1", base: null, forceSnapshot: true },
    ]);
  });

  it("resync ACK 前迟到 online duplicate 不消费 recovery；真实 recovery gap 仍Upgrade force", async () => {
    await store.connect();
    let resolveFirst!: (result: V4ConversationResyncResult) => void;
    transport.resyncImpl = (params) => {
      if (params.forceSnapshot) {
        return {
          ack: { subscriptionId: params.subscriptionId, mode: "snapshot", logEpoch: "epoch-1" },
        };
      }
      return new Promise<V4ConversationResyncResult>((resolve) => {
        resolveFirst = resolve;
      });
    };

    transport.emit(makeFrame("sub-1", 80, 81, { kind: "deltas", deltas: [] }));
    expect(transport.resyncCalls).toHaveLength(1);
    transport.emit(makeFrame("sub-1", 5, 5, { kind: "deltas", deltas: [] }));
    resolveFirst({
      ack: { subscriptionId: "sub-1", mode: "resume", logEpoch: "epoch-1" },
    });
    await flushMicrotasks();
    transport.emitRecovery(makeFrame("sub-1", 99, 100, { kind: "deltas", deltas: [] }));
    await flushMicrotasks();

    expect(transport.resyncCalls).toHaveLength(2);
    expect(transport.resyncCalls[1]?.forceSnapshot).toBe(true);
  });

  it("aligned recovery frame 早于 resync Promise continuation 仍与 ACK 共同收口 flight", async () => {
    await store.connect();
    transport.resyncImpl = (params) => {
      transport.emitRecovery(
        makeFrame(params.subscriptionId, 5, 5, { kind: "deltas", deltas: [] }),
      );
      return {
        ack: {
          subscriptionId: params.subscriptionId,
          mode: "resume",
          logEpoch: "epoch-1",
        },
      };
    };
    transport.emit(makeFrame("sub-1", 99, 100, { kind: "deltas", deltas: [] }));
    await flushMicrotasks();
    expect(transport.resyncCalls).toHaveLength(1);

    transport.emit(makeFrame("sub-1", 101, 102, { kind: "deltas", deltas: [] }));
    expect(transport.resyncCalls).toHaveLength(2);
    expect(transport.resyncCalls[1]).not.toHaveProperty("forceSnapshot");
  });

  it("recovery 已 apply 后同 read residual online gap 会在 ACK 后Start successor flight", async () => {
    await store.connect();
    let attempt = 0;
    transport.resyncImpl = (params) => {
      attempt += 1;
      if (attempt === 1) {
        transport.emitRecovery(
          makeFrame(params.subscriptionId, 5, 6, { kind: "deltas", deltas: [] }),
        );
        transport.emit(makeFrame(params.subscriptionId, 8, 9, { kind: "deltas", deltas: [] }));
      } else {
        transport.emitRecovery(
          makeFrame(params.subscriptionId, 6, 6, { kind: "deltas", deltas: [] }),
        );
      }
      return {
        ack: { subscriptionId: params.subscriptionId, mode: "resume", logEpoch: "epoch-1" },
      };
    };

    transport.emit(makeFrame("sub-1", 99, 100, { kind: "deltas", deltas: [] }));
    await flushMicrotasks();
    await flushMicrotasks();
    expect(transport.resyncCalls).toHaveLength(2);
    expect(transport.resyncCalls[1]).toEqual({
      subscriptionId: "sub-1",
      base: { logEpoch: "epoch-1", seq: 6 },
    });
    expect(store.getState().snapshot?.seq).toBe(6);
  });

  it("ACK(snapshot) 无 applied base 时Deny online delta，但接受Complete online snapshot", async () => {
    transport.subscribeImpl = (_params, subscriptionId) => ({
      ack: { subscriptionId, mode: "snapshot", logEpoch: "epoch-2" },
    });
    const listener = vi.fn();
    store.onOnlineModelTransition(listener);
    await store.connect();
    transport.emit(
      makeFrame("sub-1", 0, 1, {
        kind: "deltas",
        deltas: [{ op: "row.appended", row: assistantRow(1, "must-not-apply") }],
      }),
    );
    expect(store.getState().snapshot).toBeNull();
    expect(transport.resyncCalls[0]).toEqual({
      subscriptionId: "sub-1",
      base: null,
      forceSnapshot: true,
    });

    transport.emitKind(
      makeFrame("sub-1", 0, 1, {
        kind: "snapshot",
        snapshot: makeSnapshot({
          logEpoch: "epoch-2",
          seq: 1,
          modelTransition: {
            eventId: "event-before-applied-base",
            origin: "registryFallback",
            from: { provider: "provider-a", model: "model-a" },
            to: { provider: "provider-b", model: "model-b" },
          },
        }),
      }),
      "online",
    );
    transport.emitRecovery(makeFrame("sub-1", 0, 1, { kind: "deltas", deltas: [] }));
    await flushMicrotasks();
    expect(store.getState().snapshot?.logEpoch).toBe("epoch-2");
    expect(store.getState().snapshot?.rows.window).toEqual([]);
    expect(listener).not.toHaveBeenCalled();

    transport.emit(
      makeFrame("sub-1", 1, 2, {
        kind: "deltas",
        deltas: [
          {
            op: "state.updated",
            patch: {
              modelTransition: {
                eventId: "event-after-applied-base",
                origin: "registryFallback",
                from: { provider: "provider-b", model: "model-b" },
                to: { provider: "provider-c", model: "model-c" },
              },
            },
          },
        ],
      }),
    );
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      eventId: "event-after-applied-base",
      origin: "registryFallback",
      from: { provider: "provider-b", model: "model-b" },
      to: { provider: "provider-c", model: "model-c" },
    });
  });

  it("resync ACK 后整批 recovery 缺失会在 30s UpgradeOne次并Final fail closed", async () => {
    vi.useFakeTimers();
    try {
      await store.connect();
      transport.emit(makeFrame("sub-1", 99, 100, { kind: "deltas", deltas: [] }));
      await flushMicrotasks();
      expect(transport.resyncCalls).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(PROTOCOL_V4_LIMITS.logicalFrameAssemblyTimeoutMs);
      expect(transport.resyncCalls).toHaveLength(2);
      expect(transport.resyncCalls[1]?.forceSnapshot).toBe(true);
      await vi.advanceTimersByTimeAsync(PROTOCOL_V4_LIMITS.logicalFrameAssemblyTimeoutMs);
      expect(store.getState().status).toBe("error");
      expect(transport.resyncCalls).toHaveLength(2);
    } finally {
      await store.close();
      vi.useRealTimers();
    }
  });

  it("resume recovery gap 早于 ACK continuation 会在 ACK 后立即Upgrade force snapshot", async () => {
    await store.connect();
    transport.resyncImpl = (params) => {
      if (!params.forceSnapshot) {
        transport.emitRecovery(
          makeFrame(params.subscriptionId, 99, 100, { kind: "deltas", deltas: [] }),
        );
      } else {
        transport.emitRecovery(
          makeFrame(params.subscriptionId, 0, 100, {
            kind: "snapshot",
            snapshot: makeSnapshot({ seq: 100 }),
          }),
        );
      }
      return {
        ack: {
          subscriptionId: params.subscriptionId,
          mode: params.forceSnapshot ? "snapshot" : "resume",
          logEpoch: "epoch-1",
        },
      };
    };
    transport.emit(makeFrame("sub-1", 80, 81, { kind: "deltas", deltas: [] }));
    await flushMicrotasks();
    await flushMicrotasks();
    expect(transport.resyncCalls).toHaveLength(2);
    expect(transport.resyncCalls[1]?.forceSnapshot).toBe(true);
    expect(store.getState().snapshot?.seq).toBe(100);
  });

  it("force snapshot recovery 再 fault 时 fail closed，不无限重发", async () => {
    await store.connect();
    transport.emit(makeFrame("sub-1", 80, 81, { kind: "deltas", deltas: [] }));
    await flushMicrotasks();
    transport.emitRecovery(makeFrame("sub-1", 99, 100, { kind: "deltas", deltas: [] }));
    await flushMicrotasks();
    expect(transport.resyncCalls[1]?.forceSnapshot).toBe(true);
    transport.emitFault("conversation/s1", "sub-1", "recovery");
    await flushMicrotasks();
    expect(transport.resyncCalls).toHaveLength(2);
    expect(store.getState().status).toBe("error");
    expect(store.getState().snapshot?.seq).toBe(5);
  });

  it("inner容 fault 直接强制 snapshot，Skip必然Failed的 resume 档", async () => {
    await store.connect();
    transport.emitFault("conversation/s1", "sub-1", "online", WIRE_FAULT_INVALID_PAYLOAD);
    await flushMicrotasks();
    expect(transport.resyncCalls).toHaveLength(1);
    expect(transport.resyncCalls[0]?.forceSnapshot).toBe(true);
    expect(store.getState().snapshot?.seq).toBe(5);
  });

  it("强制 snapshot 再次被inner容Deny → contentRejected Final state，只烧One次 resync", async () => {
    await store.connect();
    const before = store.getState().snapshot;
    transport.emitFault("conversation/s1", "sub-1", "online", WIRE_FAULT_INVALID_PAYLOAD);
    await flushMicrotasks();
    transport.emitFault("conversation/s1", "sub-1", "recovery", WIRE_FAULT_INVALID_PAYLOAD);
    await flushMicrotasks();

    expect(store.getState().status).toBe("error");
    expect(store.getState().lastError).toBe(SUBSCRIPTION_CONTENT_REJECTED);
    expect(transport.resyncCalls).toHaveLength(1);
    expect(store.getState().snapshot).toBe(before);
  });

  it("inner容 fault 的强制 snapshot 若读得懂，照常收口，不落 error", async () => {
    await store.connect();
    transport.resyncImpl = (params) => {
      transport.emitRecovery(
        makeFrame(params.subscriptionId, 0, 9, {
          kind: "snapshot",
          snapshot: makeSnapshot({ seq: 9 }),
        }),
      );
      return {
        ack: { subscriptionId: params.subscriptionId, mode: "snapshot", logEpoch: "epoch-1" },
      };
    };
    transport.emitFault("conversation/s1", "sub-1", "online", WIRE_FAULT_INVALID_PAYLOAD);
    await flushMicrotasks();
    await flushMicrotasks();
    expect(store.getState().status).toBe("live");
    expect(store.getState().lastError).toBeNull();
    expect(store.getState().snapshot?.seq).toBe(9);
  });

  it("inner容 flight 上的 deadline 超时仍报 recoveryFrameTimedOut，不被inner容 code 顶替", async () => {
    vi.useFakeTimers();
    try {
      await store.connect();
      transport.emitFault("conversation/s1", "sub-1", "online", WIRE_FAULT_INVALID_PAYLOAD);
      await flushMicrotasks();
      expect(transport.resyncCalls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(PROTOCOL_V4_LIMITS.logicalFrameAssemblyTimeoutMs);
      expect(store.getState().status).toBe("error");
      expect(store.getState().lastError).toBe("fault.subscription.recoveryFrameTimedOut");
    } finally {
      vi.useRealTimers();
    }
  });

  it("瞬态 fault 不被inner容分类吞掉：无 reasonCode 仍先试 resume", async () => {
    await store.connect();
    transport.emitFault();
    await flushMicrotasks();
    expect(transport.resyncCalls).toHaveLength(1);
    expect(transport.resyncCalls[0]?.forceSnapshot).toBeUndefined();
  });

  it("瞬态 fault 走到 fail closed 时仍报 recoveryFailed，不被inner容 code 顶替", async () => {
    await store.connect();
    transport.emit(makeFrame("sub-1", 80, 81, { kind: "deltas", deltas: [] }));
    await flushMicrotasks();
    transport.emitRecovery(makeFrame("sub-1", 99, 100, { kind: "deltas", deltas: [] }));
    await flushMicrotasks();
    transport.emitFault("conversation/s1", "sub-1", "recovery");
    await flushMicrotasks();
    expect(store.getState().status).toBe("error");
    expect(store.getState().lastError).toBe("fault.subscription.recoveryFailed");
  });

  it("规则 2：断档帧不 apply，携Current水位 same-sub resync", async () => {
    await store.connect();
    transport.resyncImpl = (params) => {
      transport.emitRecovery(
        makeFrame(params.subscriptionId, 5, 9, {
          kind: "deltas",
          deltas: [{ op: "row.appended", row: assistantRow(1, "resumed") }],
        }),
      );
      return {
        ack: { subscriptionId: params.subscriptionId, mode: "resume", logEpoch: "epoch-1" },
      };
    };
    transport.emit(
      makeFrame("sub-1", 7, 8, {
        kind: "deltas",
        deltas: [{ op: "row.appended", row: assistantRow(2, "gap") }],
      }),
    );
    await flushMicrotasks();
    expect(transport.subscribeCalls).toHaveLength(1);
    expect(transport.resyncCalls).toEqual([
      { subscriptionId: "sub-1", base: { logEpoch: "epoch-1", seq: 5 } },
    ]);
    const snapshot = store.getState().snapshot!;
    expect(snapshot.seq).toBe(9);
    expect(snapshot.rows.window[0]).toMatchObject({ text: "resumed" });
  });

  it("same-sub resume recovery 仍断档 → Upgrade force snapshot（防循环）", async () => {
    await store.connect();
    transport.resyncImpl = (params) => {
      if (params.forceSnapshot) {
        transport.emitRecovery(
          makeFrame(params.subscriptionId, 0, 100, {
            kind: "snapshot",
            snapshot: makeSnapshot({ seq: 100 }),
          }),
        );
      }
      return {
        ack: {
          subscriptionId: params.subscriptionId,
          mode: params.forceSnapshot ? "snapshot" : "resume",
          logEpoch: "epoch-1",
        },
      };
    };
    transport.emit(makeFrame("sub-1", 7, 8, { kind: "deltas", deltas: [] }));
    await flushMicrotasks();
    transport.emitRecovery(makeFrame("sub-1", 99, 100, { kind: "deltas", deltas: [] }));
    await flushMicrotasks();
    expect(transport.subscribeCalls).toHaveLength(1);
    expect(transport.resyncCalls).toHaveLength(2);
    expect(transport.resyncCalls[1]?.forceSnapshot).toBe(true);
    expect(store.getState().snapshot?.seq).toBe(100);
  });

  it("subscribe ACK 后异步到达的 resume initial gap 仍按持久 ACK mode 强制 fresh snapshot", async () => {
    await store.connect();
    transport.subscribeImpl = (_params, subscriptionId) => ({
      ack: { subscriptionId, mode: "resume", logEpoch: "epoch-1" },
    });
    await store.connect();
    expect(store.getState().subscriptionId).toBe("sub-2");

    transport.emitKind(makeFrame("sub-2", 99, 100, { kind: "deltas", deltas: [] }), "initial");
    await flushMicrotasks();
    expect(transport.subscribeCalls).toHaveLength(3);
    expect(transport.subscribeCalls[2]?.base).toBeUndefined();
    expect(transport.resyncCalls).toEqual([]);
  });

  it("R-01 代际防护：Old subscriptionId 的迟到帧丢弃", async () => {
    await store.connect();
    transport.emit(
      makeFrame("sub-stale", 5, 6, {
        kind: "deltas",
        deltas: [{ op: "row.appended", row: assistantRow(1, "stale") }],
      }),
    );
    expect(store.getState().snapshot?.rows.window).toHaveLength(0);
    expect(transport.subscribeCalls).toHaveLength(1);
  });

  it("subscribe Failed → status=error，retry 可恢复", async () => {
    transport.subscribeImpl = () => {
      throw new Error("boom");
    };
    await store.connect();
    expect(store.getState().status).toBe("error");
    expect(store.getState().lastError).toContain("boom");
    transport.subscribeImpl = (params, subscriptionId) => ({
      ack: { subscriptionId, mode: "snapshot", logEpoch: "epoch-1" },
      initialFrame: makeFrame(
        subscriptionId,
        0,
        1,
        {
          kind: "snapshot",
          snapshot: makeSnapshot({ seq: 1 }),
        },
        params.topic,
      ),
    });
    await store.retry();
    expect(store.getState().status).toBe("live");
  });

  it("initial pre-ACK staging overflow Auto fresh subscribe One次，仍Failed才 error", async () => {
    let attempts = 0;
    transport.subscribeImpl = (params, subscriptionId) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("fault.subscription.initialFrameStagingOverflow");
      }
      return {
        ack: { subscriptionId, mode: "snapshot", logEpoch: "epoch-1" },
        initialFrame: makeFrame(
          subscriptionId,
          0,
          3,
          { kind: "snapshot", snapshot: makeSnapshot({ seq: 3 }) },
          params.topic,
        ),
      };
    };
    await store.connect();
    expect(transport.subscribeCalls).toHaveLength(2);
    expect(transport.subscribeCalls[1]?.base).toBeUndefined();
    expect(store.getState().status).toBe("live");
    expect(store.getState().snapshot?.seq).toBe(3);

    const failed = new ConversationProjectionStore("conversation/s1", transport);
    transport.subscribeImpl = () => {
      throw new Error("fault.subscription.initialFrameStagingOverflow");
    };
    await failed.connect();
    expect(failed.getState().status).toBe("error");
    await failed.close();
  });

  it("optimistic overlay：权威投影出现同 commandId 即退场", async () => {
    await store.connect();
    store.markCommandPending({ commandId: "c1", type: "sendText", issuedAt: 1 });
    store.markCommandPending({ commandId: "c2", type: "stop", issuedAt: 2 });
    expect(store.getState().optimisticCommands).toHaveLength(2);
    transport.emit(
      makeFrame("sub-1", 5, 6, {
        kind: "deltas",
        deltas: [
          {
            op: "row.appended",
            row: {
              rowId: 1,
              turnId: "t1",
              createdAt: 1,
              createdAtSeq: 1,
              kind: "userInput",
              text: "hi",
              origin: "realUser",
              sourceCommandId: "c1",
            },
          },
        ],
      }),
    );
    expect(store.getState().optimisticCommands.map((c) => c.commandId)).toEqual(["c2"]);
    transport.emit(
      makeFrame("sub-1", 6, 7, {
        kind: "deltas",
        deltas: [
          {
            op: "state.updated",
            patch: {
              pendingCommands: [
                {
                  commandId: "c2",
                  clientId: "client-1",
                  type: "stop",
                  state: "accepted",
                  at: 3,
                },
              ],
            },
          },
        ],
      }),
    );
    expect(store.getState().optimisticCommands).toHaveLength(0);
  });

  it.each(["sendText", "editUserQuery"] as const)(
    "A12：%s accepted Input投影完全静默时只触发One次 same-sub recovery",
    async (type) => {
      vi.useFakeTimers();
      try {
        await store.connect();
        store.markCommandPending({ commandId: "silent-input", type, issuedAt: 1 });

        store.expectAcceptedInputProjection("silent-input");
        store.expectAcceptedInputProjection("silent-input");
        await vi.advanceTimersByTimeAsync(ACCEPTED_INPUT_PROJECTION_GRACE_MS - 1);
        expect(transport.resyncCalls).toEqual([]);

        await vi.advanceTimersByTimeAsync(1);
        expect(transport.resyncCalls).toEqual([
          {
            subscriptionId: "sub-1",
            base: { logEpoch: "epoch-1", seq: 5 },
          },
        ]);

        await vi.advanceTimersByTimeAsync(ACCEPTED_INPUT_PROJECTION_GRACE_MS);
        expect(transport.resyncCalls).toHaveLength(1);
      } finally {
        await store.close();
        vi.useRealTimers();
      }
    },
  );

  it("A12：及时 user row or queue authority 会Cancel accepted-input recovery", async () => {
    vi.useFakeTimers();
    try {
      await store.connect();
      store.markCommandPending({ commandId: "row-input", type: "editUserQuery", issuedAt: 1 });

      transport.emit(
        makeFrame("sub-1", 5, 6, {
          kind: "deltas",
          deltas: [
            {
              op: "row.appended",
              row: {
                rowId: 1,
                turnId: "turn-row",
                createdAt: 1,
                createdAtSeq: 1,
                kind: "userInput",
                text: "row authority",
                origin: "realUser",
                sourceCommandId: "row-input",
              },
            },
          ],
        }),
      );
      store.expectAcceptedInputProjection("row-input");

      store.markCommandPending({ commandId: "queue-input", type: "sendText", issuedAt: 2 });
      store.expectAcceptedInputProjection("queue-input");
      transport.emit(
        makeFrame("sub-1", 6, 7, {
          kind: "deltas",
          deltas: [
            {
              op: "state.updated",
              patch: {
                queue: {
                  autoDrain: true,
                  items: [
                    {
                      queueItemId: "queue-1",
                      kind: "sendText",
                      text: "queue authority",
                      sourceCommandId: "queue-input",
                      clientId: "client-1",
                      attachments: [],
                      delivery: { requested: "queue", admitted: "queue" },
                      order: { admissionSeq: 1, queuePosition: 0 },
                      steer: { state: "notRequested" },
                      dispatch: { state: "queued" },
                      admittedAt: 2,
                    },
                  ],
                },
              },
            },
          ],
        }),
      );

      await vi.advanceTimersByTimeAsync(ACCEPTED_INPUT_PROJECTION_GRACE_MS);
      expect(transport.resyncCalls).toEqual([]);
      expect(store.getState().optimisticCommands).toEqual([]);
    } finally {
      await store.close();
      vi.useRealTimers();
    }
  });

  it("A12：LocalFailed结算or store close 会Cancel accepted-input timer", async () => {
    vi.useFakeTimers();
    try {
      await store.connect();
      store.markCommandPending({ commandId: "failed-input", type: "sendText", issuedAt: 1 });
      store.expectAcceptedInputProjection("failed-input");
      store.settleCommand("failed-input");
      await vi.advanceTimersByTimeAsync(ACCEPTED_INPUT_PROJECTION_GRACE_MS);
      expect(transport.resyncCalls).toEqual([]);

      store.markCommandPending({ commandId: "closed-input", type: "sendText", issuedAt: 2 });
      store.expectAcceptedInputProjection("closed-input");
      await store.close();
      await vi.advanceTimersByTimeAsync(ACCEPTED_INPUT_PROJECTION_GRACE_MS);
      expect(transport.resyncCalls).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("close 退订且Deny后续帧", async () => {
    await store.connect();
    await store.close();
    expect(transport.unsubscribeCalls).toEqual(["sub-1"]);
    expect(store.getState().status).toBe("closed");
    transport.emit(
      makeFrame("sub-1", 5, 6, {
        kind: "deltas",
        deltas: [{ op: "row.appended", row: assistantRow(1, "late") }],
      }),
    );
    expect(store.getState().snapshot?.rows.window).toHaveLength(0);
  });

  it("Concurrency connect 只认最New代际，Expired订阅立即退订", async () => {
    const gate: Array<() => void> = [];
    transport.subscribeImpl = (params, subscriptionId) =>
      new Promise((resolve) => {
        gate.push(() =>
          resolve({
            ack: { subscriptionId, mode: "snapshot", logEpoch: "epoch-1" },
            initialFrame: makeFrame(
              subscriptionId,
              0,
              1,
              {
                kind: "snapshot",
                snapshot: makeSnapshot({ seq: 1 }),
              },
              params.topic,
            ),
          }),
        );
      });
    const first = store.connect();
    const second = store.connect();
    gate[0]();
    gate[1]();
    await Promise.all([first, second]);
    await flushMicrotasks();
    expect(store.getState().subscriptionId).toBe("sub-2");
    expect(transport.unsubscribeCalls).toEqual(["sub-1"]);
  });
});

// ── SessionDataLayer ──

describe("SessionDataLayer", () => {
  let transport: FakeTransport;
  let layer: SessionDataLayer;

  beforeEach(() => {
    vi.useFakeTimers();
    transport = new FakeTransport();
    layer = new SessionDataLayer({ transport, keepWarmMs: 30_000 });
  });

  it("只在 E2E store bridge build MediumZoom keep-warm 时间", () => {
    expect(resolveSessionDataLayerKeepWarmMs(false)).toBe(SESSION_DATA_LAYER_KEEP_WARM_MS);
    expect(resolveSessionDataLayerKeepWarmMs(true)).toBe(E2E_SESSION_DATA_LAYER_KEEP_WARM_MS);
  });

  afterEach(() => {
    layer.dispose();
    vi.useRealTimers();
  });

  it("首个 acquire 触发 subscribe，帧按 topic 路由到 store", async () => {
    const lease = layer.acquire("s1");
    await flushMicrotasks();
    expect(transport.subscribeCalls).toHaveLength(1);
    expect(transport.subscribeCalls[0].topic).toBe("conversation/s1");
    expect(lease.store.getState().snapshot?.seq).toBe(5);
    transport.emit(
      makeFrame("sub-1", 5, 6, {
        kind: "deltas",
        deltas: [{ op: "row.appended", row: assistantRow(1, "hi") }],
      }),
    );
    expect(lease.store.getState().snapshot?.rows.window).toHaveLength(1);
  });

  describe("行StructuresShared（docs/performance/conversation-row-structural-sharing.md）", () => {
    function rowsSnapshot(rows: ConversationRow[], seq = 5): ConversationSnapshot {
      return makeSnapshot({
        seq,
        rows: {
          window: JSON.parse(JSON.stringify(rows)) as ConversationRow[],
          totalCount: rows.length,
          firstRowId: rows[0]?.rowId ?? null,
        },
      });
    }

    function subscribeWithRows(rows: ConversationRow[]): void {
      transport.subscribeImpl = (params, subscriptionId) => ({
        ack: { subscriptionId, mode: "snapshot", logEpoch: "epoch-1" },
        initialFrame: makeFrame(
          subscriptionId,
          0,
          5,
          { kind: "snapshot", snapshot: rowsSnapshot(rows) },
          params.topic,
        ),
      });
    }

    it("整份 snapshot 重New下发时，inner容未变的行与 window 保持引用", async () => {
      const rows = [planRow(1), assistantRow(2, "hello")];
      subscribeWithRows(rows);
      const lease = layer.acquire("s1");
      await flushMicrotasks();
      const before = lease.store.getState().snapshot!.rows.window;
      transport.emit(
        makeFrame("sub-1", 0, 6, { kind: "snapshot", snapshot: rowsSnapshot(rows, 6) }),
      );
      const after = lease.store.getState().snapshot!;
      expect(after.seq).toBe(6);
      expect(after.rows.window).toBe(before);

      const changed = [planRow(1), assistantRow(2, "hello world")];
      transport.emit(
        makeFrame("sub-1", 0, 7, { kind: "snapshot", snapshot: rowsSnapshot(changed, 7) }),
      );
      const window = lease.store.getState().snapshot!.rows.window;
      expect(window).not.toBe(before);
      expect(window[0]).toBe(before[0]);
      expect(window[1]).toEqual(changed[1]);
    });

    it("row.upserted 只改Status时复用未变的 input，inner容E同则整行复用", async () => {
      subscribeWithRows([planRow(1, "running")]);
      const lease = layer.acquire("s1");
      await flushMicrotasks();
      const before = lease.store.getState().snapshot!.rows.window[0] as ToolCallRow;
      transport.emit(
        makeFrame("sub-1", 5, 6, {
          kind: "deltas",
          deltas: [{ op: "row.upserted", row: JSON.parse(JSON.stringify(before)) }],
        }),
      );
      expect(lease.store.getState().snapshot!.rows.window[0]).toBe(before);
      transport.emit(
        makeFrame("sub-1", 6, 7, {
          kind: "deltas",
          deltas: [{ op: "row.upserted", row: planRow(1, "success") }],
        }),
      );
      const after = lease.store.getState().snapshot!.rows.window[0] as ToolCallRow;
      expect(after.status).toBe("success");
      expect(after.input).toBe(before.input);
    });

    it("keep-warm Expired冷打开后，仍存活的Old行被New store 复用", async () => {
      const rows = [planRow(1), assistantRow(2, "hello")];
      subscribeWithRows(rows);
      const first = layer.acquire("s1");
      await flushMicrotasks();
      const retained = first.store.getState().snapshot!.rows.window;
      first.release();
      vi.advanceTimersByTime(30_000);
      await flushMicrotasks();

      const second = layer.acquire("s1");
      await flushMicrotasks();
      expect(second.openKind).toBe("cold");
      expect(second.store).not.toBe(first.store);
      const window = second.store.getState().snapshot!.rows.window;
      expect(window[0]).toBe(retained[0]);
      expect(window[1]).toBe(retained[1]);
    });

    it("不同 session 的同 rowId 行不Shared", async () => {
      subscribeWithRows([planRow(1)]);
      const a = layer.acquire("s1");
      const b = layer.acquire("s2");
      await flushMicrotasks();
      const rowA = a.store.getState().snapshot!.rows.window[0];
      const rowB = b.store.getState().snapshot!.rows.window[0];
      expect(rowA).toEqual(rowB);
      expect(rowA).not.toBe(rowB);
    });
  });

  it("同 session 重复 acquire Shared store，不再订阅", async () => {
    const a = layer.acquire("s1");
    const b = layer.acquire("s1");
    await flushMicrotasks();
    expect(a.store).toBe(b.store);
    expect(a.openKind).toBe("cold");
    expect(b.openKind).toBe("warm");
    expect(transport.subscribeCalls).toHaveLength(1);
  });

  it("记录 lease 引用计Count与 keep-warm Lifecycle", async () => {
    const info = vi.spyOn(logger.lifecycle, "info").mockImplementation(() => {});
    try {
      const lease = layer.acquire("s1");
      await flushMicrotasks();
      lease.release();
      vi.advanceTimersByTime(30_000);
      await flushMicrotasks();

      const events = info.mock.calls
        .map(([, context]) => (context as { event?: string } | undefined)?.event)
        .filter((event): event is string => Boolean(event));
      expect(events).toEqual(
        expect.arrayContaining([
          "v4.session_data.acquire",
          "v4.session_data.release",
          "v4.session_data.keep_warm_expired",
        ]),
      );
      expect(info.mock.calls).toEqual(
        expect.arrayContaining([
          expect.arrayContaining([
            "v4 session data lease acquired",
            expect.objectContaining({ openKind: "cold", refCount: 1, sessionId: "s1" }),
          ]),
        ]),
      );
    } finally {
      info.mockRestore();
    }
  });

  it("归零后 keep-warm Windowinner re-acquire 复用；超时后退订", async () => {
    const a = layer.acquire("s1");
    await flushMicrotasks();
    const storeA = a.store;
    a.release();
    vi.advanceTimersByTime(10_000);
    const b = layer.acquire("s1");
    expect(b.store).toBe(storeA);
    expect(b.openKind).toBe("keep_warm");
    expect(transport.unsubscribeCalls).toHaveLength(0);
    b.release();
    vi.advanceTimersByTime(30_000);
    await flushMicrotasks();
    expect(transport.unsubscribeCalls).toEqual(["sub-1"]);
    expect(layer.size).toBe(0);
    layer.acquire("s1");
    await flushMicrotasks();
    expect(transport.subscribeCalls).toHaveLength(2);
  });

  it("release 幂等：重复 release 不影响Other租About", async () => {
    const a = layer.acquire("s1");
    const b = layer.acquire("s1");
    await flushMicrotasks();
    a.release();
    a.release();
    vi.advanceTimersByTime(60_000);
    await flushMicrotasks();
    expect(transport.unsubscribeCalls).toHaveLength(0);
    expect(b.store.getState().status).toBe("live");
  });

  it("dispose 清场：Cancel keep-warm、CloseAll store", async () => {
    const a = layer.acquire("s1");
    layer.acquire("s2");
    await flushMicrotasks();
    a.release();
    layer.dispose();
    await flushMicrotasks();
    expect(transport.unsubscribeCalls.sort()).toEqual(["sub-1", "sub-2"]);
    expect(() => layer.acquire("s3")).toThrow();
  });

  it("runtime restart 让 active 与 keep-warm stores 各 full subscribe One次", async () => {
    layer.acquire("s1");
    const keepWarm = layer.acquire("s2");
    await flushMicrotasks();
    keepWarm.release();
    expect(transport.subscribeCalls).toHaveLength(2);

    transport.restart();
    await flushMicrotasks();
    expect(transport.subscribeCalls).toHaveLength(4);
    expect(transport.subscribeCalls.slice(2).every((call) => call.base === undefined)).toBe(true);
  });
});

describe("ConversationProjectionStore.loadOlder", () => {
  let transport: FakeTransport;
  let store: ConversationProjectionStore;

  
  function truncatedSnapshot(): ConversationSnapshot {
    const window: ConversationRow[] = [];
    for (let rowId = 41; rowId <= 100; rowId++) {
      window.push(assistantRow(rowId, `行 ${rowId}`));
    }
    return makeSnapshot({
      seq: 5,
      rows: { window, totalCount: 100, firstRowId: 1 },
    });
  }

  function olderRows(from: number, to: number): ConversationRow[] {
    const rows: ConversationRow[] = [];
    for (let rowId = from; rowId <= to; rowId++) {
      rows.push(assistantRow(rowId, `行 ${rowId}`));
    }
    return rows;
  }

  beforeEach(async () => {
    transport = new FakeTransport();
    store = new ConversationProjectionStore("conversation/s1", transport);
    transport.onFrame((frame) => store.handleFrame(frame));
    transport.subscribeImpl = (params, subscriptionId) => ({
      ack: { subscriptionId, mode: "snapshot", logEpoch: "epoch-1" },
      initialFrame: makeFrame(
        subscriptionId,
        0,
        5,
        {
          kind: "snapshot",
          snapshot: truncatedSnapshot(),
        },
        params.topic,
      ),
    });
    await store.connect();
  });

  it("hasOlderRows：Window首行 > 全序首行 → true；到顶/空/Unknown → false", () => {
    expect(hasOlderRows(store.getState().snapshot)).toBe(true);
    expect(hasOlderRows(null)).toBe(false);
    expect(hasOlderRows(makeSnapshot())).toBe(false);
    expect(
      hasOlderRows(
        makeSnapshot({
          rows: { window: [assistantRow(1, "a")], totalCount: 1, firstRowId: 1 },
        }),
      ),
    ).toBe(false);
  });

  it("HLP01：尾窗首 turn 缺 header 时Auto补页，Complete/在途/到顶时不补", () => {
    const partial = makeSnapshot({
      rows: {
        window: [assistantRow(41, "仅有 assistant")],
        totalCount: 41,
        firstRowId: 1,
      },
    });
    const complete = makeSnapshot({
      rows: {
        window: [turnHeaderRow(40), assistantRow(41, "Complete turn")],
        totalCount: 41,
        firstRowId: 1,
      },
    });

    expect(shouldAutoLoadIncompleteLeadingTurn(partial, false)).toBe(true);
    expect(shouldAutoLoadIncompleteLeadingTurn(partial, true)).toBe(false);
    expect(shouldAutoLoadIncompleteLeadingTurn(complete, false)).toBe(false);
    expect(
      shouldAutoLoadIncompleteLeadingTurn(
        makeSnapshot({
          rows: {
            window: [assistantRow(1, "已到全序首行")],
            totalCount: 1,
            firstRowId: 1,
          },
        }),
        false,
      ),
    ).toBe(false);
  });

  it("以Window首行为游Label拉取并前插；到顶后 hasOlderRows=false", async () => {
    transport.rowsRangeImpl = (params) => {
      expect(params.sessionId).toBe("s1");
      expect(params.beforeRowId).toBe(41);
      return {
        rows: olderRows(1, 40),
        atSeq: 5,
        atRevision: 5,
        atLogEpoch: "epoch-1",
        hasMore: false,
      };
    };
    await store.loadOlder();
    const state = store.getState();
    expect(state.loadingOlder).toBe(false);
    expect(state.snapshot!.rows.window).toHaveLength(100);
    expect(state.snapshot!.rows.window[0]!.rowId).toBe(1);
    const ids = state.snapshot!.rows.window.map((row) => row.rowId);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(hasOlderRows(state.snapshot)).toBe(false);
  });

  it("TN07：CompleteTable of Contents按Protocol上限分页，All成功后只SubmitOne次 projection", async () => {
    transport.rowsRangeImpl = (params) => {
      if (params.beforeRowId === 41) {
        return {
          rows: [realUserRow(21, "turn-2"), ...olderRows(22, 40)],
          atSeq: 5,
          atRevision: 5,
          atLogEpoch: "epoch-1",
          hasMore: true,
        };
      }
      expect(params.beforeRowId).toBe(21);
      return {
        rows: [realUserRow(1, "turn-1"), ...olderRows(2, 20)],
        atSeq: 5,
        atRevision: 5,
        atLogEpoch: "epoch-1",
        hasMore: false,
      };
    };
    const snapshotChanges: ConversationSnapshot[] = [];
    let previousSnapshot = store.getState().snapshot;
    const unsubscribe = store.subscribe(() => {
      const nextSnapshot = store.getState().snapshot;
      if (nextSnapshot && nextSnapshot !== previousSnapshot) {
        snapshotChanges.push(nextSnapshot);
        previousSnapshot = nextSnapshot;
      }
    });

    const result = await store.loadAllOlder();
    unsubscribe();

    expect(transport.rowsRangeCalls).toEqual([
      { sessionId: "s1", beforeRowId: 41, limit: 200 },
      { sessionId: "s1", beforeRowId: 21, limit: 200 },
    ]);
    expect(snapshotChanges).toHaveLength(1);
    expect(store.getState().snapshot!.rows.window).toHaveLength(100);
    expect(store.getState().snapshot!.rows.window[0]!.rowId).toBe(1);
    expect(hasOlderRows(store.getState().snapshot)).toBe(false);
    expect(result.status).toBe("hydrated");
  });

  it("TN07：CompleteTable of Contents后续页Failed时整批丢弃，不暴露半份Table of Contents", async () => {
    transport.rowsRangeImpl = (params) => {
      if (params.beforeRowId === 41) {
        return {
          rows: olderRows(21, 40),
          atSeq: 5,
          atRevision: 5,
          atLogEpoch: "epoch-1",
          hasMore: true,
        };
      }
      throw new Error("range unavailable");
    };
    const before = store.getState().snapshot!.rows.window;

    const result = await store.loadAllOlder();

    expect(store.getState().loadingOlder).toBe(false);
    expect(store.getState().snapshot!.rows.window).toBe(before);
    expect(result.status).toBe("retryable-failure");
  });

  it("TN07：tail 只有One个 query 时仍向前探测，发现第Two个后SubmitCompleteTable of Contents", async () => {
    const tail = store.getState().snapshot!;
    store.handleFrame(
      makeFrame("sub-1", 5, 6, {
        kind: "snapshot",
        snapshot: {
          ...tail,
          seq: 6,
          rows: {
            ...tail.rows,
            window: [...tail.rows.window.slice(0, -1), realUserRow(100, "tail")],
          },
        },
      }),
    );
    transport.rowsRangeImpl = () => ({
      rows: [realUserRow(20, "older"), ...olderRows(21, 40)],
      atSeq: 6,
      atLogEpoch: "epoch-1",
      hasMore: false,
    });

    const result = await store.loadAllOlder();

    expect(transport.rowsRangeCalls).toHaveLength(1);
    expect(store.getState().snapshot!.rows.window.some((row) => row.rowId === 20)).toBe(true);
    expect(result.status).toBe("hydrated");
  });

  it("TN01：Complete历史只有One个 query 时扫描到From点但不常驻探测 rows", async () => {
    const tail = store.getState().snapshot!;
    store.handleFrame(
      makeFrame("sub-1", 5, 6, {
        kind: "snapshot",
        snapshot: {
          ...tail,
          seq: 6,
          rows: {
            ...tail.rows,
            window: [turnHeaderRow(41), ...tail.rows.window.slice(1, -1), realUserRow(100, "t1")],
          },
        },
      }),
    );
    const before = store.getState().snapshot!.rows.window;
    transport.rowsRangeImpl = () => ({
      rows: olderRows(1, 40),
      atSeq: 6,
      atLogEpoch: "epoch-1",
      hasMore: false,
    });

    const result = await store.loadAllOlder();

    expect(transport.rowsRangeCalls).toHaveLength(1);
    expect(store.getState().snapshot!.rows.window).toBe(before);
    expect(result.status).toBe("not-enough-queries");

    transport.rowsRangeImpl = () => ({
      rows: olderRows(31, 40),
      atSeq: 6,
      atLogEpoch: "epoch-1",
      hasMore: true,
    });
    await store.loadOlder(10);
    expect(store.getState().snapshot!.rows.window[0]?.rowId).toBe(31);
    const repeated = await store.loadAllOlder();
    expect(repeated.status).toBe("not-enough-queries");
    expect(transport.rowsRangeCalls).toHaveLength(2);
  });

  it("HLP01/TN01：navigator 先取得 single-flight 时仍Retain单 query 首轮补齐 rows", async () => {
    const tail = store.getState().snapshot!;
    store.handleFrame(
      makeFrame("sub-1", 5, 6, {
        kind: "snapshot",
        snapshot: {
          ...tail,
          seq: 6,
          rows: {
            ...tail.rows,
            window: olderRows(41, 100),
          },
        },
      }),
    );
    transport.rowsRangeImpl = () => ({
      rows: [turnHeaderRow(1), realUserRow(2, "t1"), ...olderRows(3, 40)],
      atSeq: 6,
      atLogEpoch: "epoch-1",
      hasMore: false,
    });

    const result = await store.loadAllOlder();

    expect(result.status).toBe("not-enough-queries");
    expect(store.getState().snapshot!.rows.window).toHaveLength(100);
    expect(store.getState().snapshot!.rows.window[0]).toMatchObject({
      kind: "turnHeader",
      rowId: 1,
      turnId: "t1",
    });
  });

  it("TN09：not-enough-queries 后AppendSecond item realUser query → revision 递增 → 重New探测得 hydrated", async () => {
    const tail = store.getState().snapshot!;
    store.handleFrame(
      makeFrame("sub-1", 5, 6, {
        kind: "snapshot",
        snapshot: {
          ...tail,
          seq: 6,
          rows: {
            ...tail.rows,
            window: [turnHeaderRow(41), ...tail.rows.window.slice(1, -1), realUserRow(100, "t1")],
          },
        },
      }),
    );
    transport.rowsRangeImpl = () => ({
      rows: olderRows(1, 40),
      atSeq: 6,
      atLogEpoch: "epoch-1",
      hasMore: false,
    });

    const firstResult = await store.loadAllOlder();
    expect(firstResult.status).toBe("not-enough-queries");
    expect(transport.rowsRangeCalls).toHaveLength(1);
    const revisionAfterProbe = store.getState().turnNavigatorDirectoryRevision;

    transport.emit(
      makeFrame("sub-1", 6, 7, {
        kind: "deltas",
        deltas: [{ op: "row.appended", row: realUserRow(101, "tail-2") }],
      }),
    );

    expect(store.getState().turnNavigatorDirectoryRevision).toBe(revisionAfterProbe + 1);

    const secondResult = await store.loadAllOlder();
    expect(secondResult.status).toBe("hydrated");
    expect(transport.rowsRangeCalls).toHaveLength(2);
  });

  it("TN09：row.removed 截断分支后 turnNavigatorDirectoryRevision 递增", async () => {
    const beforeRevision = store.getState().turnNavigatorDirectoryRevision;
    transport.emit(
      makeFrame("sub-1", 5, 6, {
        kind: "deltas",
        deltas: [{ op: "row.removed", fromRowId: 50 }],
      }),
    );
    expect(store.getState().turnNavigatorDirectoryRevision).toBe(beforeRevision + 1);
  });

  it("TN09：普通 assistant delta 不递增 turnNavigatorDirectoryRevision", async () => {
    const beforeRevision = store.getState().turnNavigatorDirectoryRevision;
    transport.emit(
      makeFrame("sub-1", 5, 6, {
        kind: "deltas",
        deltas: [{ op: "row.appended", row: assistantRow(101, "Streaming assistant") }],
      }),
    );
    expect(store.getState().turnNavigatorDirectoryRevision).toBe(beforeRevision);
  });

  it("单飞：在途期间重复调用不发Second timeRequest", async () => {
    let resolveFetch: (result: V4ConversationRowsRangeResult) => void;
    transport.rowsRangeImpl = () =>
      new Promise<V4ConversationRowsRangeResult>((resolve) => {
        resolveFetch = resolve;
      });
    const first = store.loadOlder();
    const second = store.loadOlder();
    expect(store.getState().loadingOlder).toBe(true);
    resolveFetch!({
      rows: olderRows(31, 40),
      atSeq: 5,
      atRevision: 5,
      atLogEpoch: "epoch-1",
      hasMore: true,
    });
    await Promise.all([first, second]);
    expect(transport.rowsRangeCalls).toHaveLength(1);
    expect(store.getState().snapshot!.rows.window[0]!.rowId).toBe(31);
  });

  it("陈Old读（atLogEpoch 不匹配）→ 整体丢弃，Window不变", async () => {
    transport.rowsRangeImpl = () => ({
      rows: olderRows(1, 40),
      atSeq: 99,
      atRevision: 5,
      atLogEpoch: "epoch-0",
      hasMore: false,
    });
    const before = store.getState().snapshot!.rows.window;
    await store.loadOlder();
    expect(store.getState().snapshot!.rows.window).toBe(before);
  });

  it("在途期间游LabelInvalid（snapshot 整体替换）→ Result作废，不复活Old行", async () => {
    let resolveFetch: (result: V4ConversationRowsRangeResult) => void;
    transport.rowsRangeImpl = () =>
      new Promise<V4ConversationRowsRangeResult>((resolve) => {
        resolveFetch = resolve;
      });
    const inflight = store.loadOlder();
    store.handleFrame(
      makeFrame(store.getState().subscriptionId!, 0, 9, {
        kind: "snapshot",
        snapshot: makeSnapshot({
          seq: 9,
          rows: {
            window: olderRows(90, 100),
            totalCount: 100,
            firstRowId: 1,
          },
        }),
      }),
    );
    resolveFetch!({
      rows: olderRows(1, 40),
      atSeq: 5,
      atRevision: 5,
      atLogEpoch: "epoch-1",
      hasMore: false,
    });
    await inflight;
    expect(store.getState().snapshot!.rows.window[0]!.rowId).toBe(90);
  });

  it("到顶/无快照时 no-op（不发Request）", async () => {
    transport.rowsRangeImpl = () => ({
      rows: olderRows(1, 40),
      atSeq: 5,
      atRevision: 5,
      atLogEpoch: "epoch-1",
      hasMore: false,
    });
    await store.loadOlder();
    expect(transport.rowsRangeCalls).toHaveLength(1);
    await store.loadOlder();
    expect(transport.rowsRangeCalls).toHaveLength(1);
  });

  it("mergeOlderRows：按 rowId 键控，只收Window首行之前的行", () => {
    const window = olderRows(41, 45);
    const merged = mergeOlderRows(window, [...olderRows(39, 42), assistantRow(50, "越Boundary")]);
    expect(merged!.map((row) => row.rowId)).toEqual([39, 40, 41, 42, 43, 44, 45]);
    expect(mergeOlderRows(window, olderRows(41, 45))).toBeNull();
    expect(mergeOlderRows(window, [])).toBeNull();
  });
});
