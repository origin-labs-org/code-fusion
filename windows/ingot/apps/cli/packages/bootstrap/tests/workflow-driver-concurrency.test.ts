

import { describe, expect, it, vi } from "vitest";
import {
  SessionEventType,
  type ModelRequestAdmission,
  type ModelRequestAdmissionTicket,
  type SessionEvent,
  type SessionEventSink,
} from "@origin-ai/cf-contracts";
import {
  InMemoryJournalStore,
  type ActorRef,
  type AskWaitInfo,
  type ConcurrencyChange,
  type InstanceRef,
  type RunStallInfo,
  type WorkflowError,
  type WorkflowReportSink,
} from "@origin-ai/cf-dynamic-workflow";
import { createWorkflowEscalationRegistry } from "../src/app/workflow-escalation-registry.js";
import { createAgentRuntimeWorkflowDriver } from "../src/app/workflow-driver.js";
import {
  createRunStallClock,
  WORKFLOW_STALL_NOTIFY_AFTER_MS,
} from "../src/app/workflow-driver-concurrency.js";
import type { WorkflowConcurrencyPort } from "../src/app/workflow-concurrency-governor.js";
import { fakeFileSystemPort, unsupportedExecutionPort } from "./workflow-driver.helpers.js";

const RUN = "run-cc";
const ACTOR: ActorRef = { siteId: "actor#1", ordinal: 1 };
const INSTANCE: InstanceRef = { siteId: "ask#1", ordinal: 1 };
const INSTANCE_2: InstanceRef = { siteId: "ask#1", ordinal: 2 };
const MODEL = { providerId: "prov", modelId: "alpha" } as never;

function stubRuntime(executeTurn: () => Promise<unknown>) {
  const sinks = new Set<SessionEventSink>();
  let sessionIdOfRuntime = "";
  const runtime = {
    subscribeCalls: 0,
    unsubscribeCalls: 0,
    executeTurn,
    subscribeEvents(sink: SessionEventSink) {
      runtime.subscribeCalls++;
      sinks.add(sink);
      return () => {
        runtime.unsubscribeCalls++;
        sinks.delete(sink);
      };
    },
    getModelRef: () => MODEL,
    closeBrowserSession: async () => {},
    
    emitToolStarted(flags: Record<string, unknown>, sessionId = sessionIdOfRuntime) {
      const event = {
        id: "evt-tool",
        sessionId,
        type: SessionEventType.ToolCallStarted,
        timestamp: new Date(),
        traceId: "trace",
        sequenceNumber: 1,
        payload: { toolCallId: "tc", toolName: "Probe", startedAt: new Date(), ...flags },
      } as unknown as SessionEvent;
      for (const sink of sinks) void sink.onSessionEvent(event);
    },
    emitStatus(payload: Record<string, unknown>, sessionId = sessionIdOfRuntime) {
      const event = {
        id: "evt",
        sessionId,
        type: SessionEventType.ModelNetworkStatus,
        timestamp: new Date(),
        traceId: "trace",
        sequenceNumber: 1,
        payload: { model: MODEL, attempt: 1, maxAttempts: 0, ...payload },
      } as unknown as SessionEvent;
      for (const sink of sinks) void sink.onSessionEvent(event);
    },
    bind(sessionId: string) {
      sessionIdOfRuntime = sessionId;
    },
  };
  return runtime;
}

function recordingSink() {
  const calls = {
    waiting: [] as Array<{ instance: InstanceRef; info: AskWaitInfo }>,
    executing: [] as InstanceRef[],
    mutating: [] as InstanceRef[],
    failed: [] as Array<{ instance: InstanceRef; error: WorkflowError }>,
    concurrency: [] as ConcurrencyChange[],
    stopped: [] as WorkflowError[],
    stalled: [] as RunStallInfo[],
  };
  const sink: WorkflowReportSink = {
    askSubmitAttempted: () => {},
    askTurnEnded: () => {},
    askProgress: () => {},
    askStats: () => {},
    askFailed: (instance, error) => calls.failed.push({ instance, error }),
    askWaiting: (instance, info) => calls.waiting.push({ instance, info }),
    askExecuting: (instance) => calls.executing.push(instance),
    askMutating: (instance) => calls.mutating.push(instance),
    concurrencyChanged: (change) => calls.concurrency.push(change),
    stopRun: (error) => calls.stopped.push(error),
    runStalled: (info) => calls.stalled.push(info),
  };
  return { sink, calls };
}

function fakeClock() {
  const state = {
    now: 0,
    timers: [] as Array<{ callback: () => void; at: number; cancelled: boolean }>,
  };
  const clock = {
    now: () => state.now,
    schedule: (callback: () => void, delayMs: number) => {
      const timer = { callback, at: state.now + delayMs, cancelled: false };
      state.timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  };
  
  const advanceTo = (to: number): void => {
    state.now = to;
    for (const timer of [...state.timers].sort((a, b) => a.at - b.at)) {
      if (timer.cancelled || timer.at > to) continue;
      timer.cancelled = true;
      timer.callback();
    }
  };
  const pending = () => state.timers.filter((timer) => !timer.cancelled);
  return { clock, state, advanceTo, pending };
}

function fakeTicket(): ModelRequestAdmissionTicket {
  return { publish: () => {}, release: () => {} };
}

function fakePort() {
  const state = {
    fast: true,
    tryAdmits: [] as Array<{ runId: string; key: string }>,
    admits: [] as Array<{
      runId: string;
      key: string;
      signal: AbortSignal;
      resolve: (t: ModelRequestAdmissionTicket) => void;
    }>,
    subscribes: [] as Array<{ runId: string; listener: (change: ConcurrencyChange) => void }>,
    unsubscribe: vi.fn(),
  };
  const port: WorkflowConcurrencyPort = {
    tryAdmit: (runId, key) => {
      state.tryAdmits.push({ runId, key });
      return state.fast ? fakeTicket() : undefined;
    },
    admit: (runId, key, signal) =>
      new Promise((resolve, reject) => {
        state.admits.push({ runId, key, signal, resolve });
        if (signal.aborted) reject(signal.reason ?? new Error("aborted"));
        else
          signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), {
            once: true,
          });
      }),
    subscribe: (runId, listener) => {
      state.subscribes.push({ runId, listener });
      return state.unsubscribe;
    },
    setRunBound: () => {},
    clearRunBound: () => {},
  };
  return { port, state };
}

function makeDriver(input: {
  runtime: ReturnType<typeof stubRuntime>;
  concurrency?: WorkflowConcurrencyPort;
  clock?: ReturnType<typeof fakeClock>["clock"] & { stallAfterMs?: number; random?: () => number };
}) {
  const { sink, calls } = recordingSink();
  const journal = new InMemoryJournalStore();
  journal.createRun({
    runId: RUN,
    caps: { maxConcurrency: 16 },
    spentTokens: 0,
    status: "running",
  });
  const factoryInputs: Array<{ modelRequestAdmission?: ModelRequestAdmission }> = [];
  const driver = createAgentRuntimeWorkflowDriver({
    journal,
    emit: () => {},
    escalationRegistry: createWorkflowEscalationRegistry(),
    executionPort: unsupportedExecutionPort(),
    fileSystemPort: fakeFileSystemPort({}),
    cwd: process.cwd(),
    runId: RUN,
    ...(input.concurrency === undefined ? {} : { concurrency: input.concurrency }),
    ...(input.clock === undefined ? {} : { clock: input.clock }),
    runtimeFactory: ({ sessionId, modelRequestAdmission }) => {
      factoryInputs.push(modelRequestAdmission === undefined ? {} : { modelRequestAdmission });
      input.runtime.bind(sessionId);
      return input.runtime as never;
    },
  })(sink);
  return { driver, calls, factoryInputs };
}

const flush = async (rounds = 8) => {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
};

describe("workflow driver — waiting / executing 观察（§6，决策 38）", () => {
  it("首个 started → askExecuting；同一 ask 内再 started 不重发；completed 不改相位", async () => {
    const runtime = stubRuntime(() => new Promise(() => {}));
    const { driver, calls } = makeDriver({ runtime });
    const session = await driver.createActorSession(ACTOR, {});
    expect(runtime.subscribeCalls).toBe(2);
    driver.startAsk(session, INSTANCE, { instructions: "go", typed: false });

    runtime.emitStatus({ type: "model_request_started", attempt: 1 });
    expect(calls.executing).toEqual([INSTANCE]);
    runtime.emitStatus({ type: "model_request_completed", attempt: 1, durationMs: 10 });
    runtime.emitStatus({ type: "model_request_started", attempt: 1 });
    expect(calls.executing).toEqual([INSTANCE]);
    expect(calls.waiting).toEqual([]);
  });

  it("model_retry_scheduled → askWaiting(backoff)；其后的 started → askExecuting（退避后的重试真的发出了）", async () => {
    const runtime = stubRuntime(() => new Promise(() => {}));
    const { driver, calls } = makeDriver({ runtime });
    const session = await driver.createActorSession(ACTOR, {});
    driver.startAsk(session, INSTANCE, { instructions: "go", typed: false });
    runtime.emitStatus({ type: "model_request_started", attempt: 1 });

    runtime.emitStatus({
      type: "model_retry_scheduled",
      reason: "rate_limited",
      delayMs: 20_000,
      nextAttempt: 2,
      retryAfterMs: 20_000,
      message: "429",
    });
    expect(calls.waiting).toEqual([
      {
        instance: INSTANCE,
        info: {
          cause: "backoff",
          reason: "rate_limited",
          attempt: 2,
          delayMs: 20_000,
          retryAfterMs: 20_000,
        },
      },
    ]);
    runtime.emitStatus({ type: "model_request_started", attempt: 2 });
    expect(calls.executing).toEqual([INSTANCE, INSTANCE]);
    runtime.emitStatus({
      type: "model_retry_scheduled",
      reason: "server_error",
      delayMs: 3000,
      nextAttempt: 3,
      message: "500",
    });
    expect(calls.waiting).toHaveLength(2);
    expect(calls.waiting[1]!.info).toEqual({
      cause: "backoff",
      reason: "server_error",
      attempt: 3,
      delayMs: 3000,
    });
    runtime.emitStatus({ type: "model_request_started", attempt: 3 });
    expect(calls.executing).toHaveLength(3);
  });

  it("signature repair / auth_refresh 不报；别的会话的事件忽略", async () => {
    const runtime = stubRuntime(() => new Promise(() => {}));
    const { driver, calls } = makeDriver({ runtime });
    const session = await driver.createActorSession(ACTOR, {});
    driver.startAsk(session, INSTANCE, { instructions: "go", typed: false });

    runtime.emitStatus({
      type: "model_retry_scheduled",
      reason: "reasoning_signature_repair",
      delayMs: 0,
      nextAttempt: 2,
      message: "repair",
    });
    runtime.emitStatus({
      type: "model_retry_scheduled",
      reason: "auth_refresh",
      delayMs: 0,
      nextAttempt: 2,
      message: "refresh",
    });
    runtime.emitStatus(
      {
        type: "model_retry_scheduled",
        reason: "server_error",
        delayMs: 4000,
        nextAttempt: 3,
        message: "500",
      },
      "some-other-session",
    );
    runtime.emitStatus({ type: "model_request_started" }, "some-other-session");
    expect(calls.waiting).toEqual([]);
    expect(calls.executing).toEqual([]);
  });

  it("Resets per ask: executing from the previous ask does not carry over to the next ask\'s first request", async () => {
    const runtime = stubRuntime(() => new Promise(() => {}));
    const { driver, calls } = makeDriver({ runtime });
    const session = await driver.createActorSession(ACTOR, {});
    driver.startAsk(session, INSTANCE, { instructions: "go", typed: false });
    runtime.emitStatus({ type: "model_request_started" });
    driver.cancelAsk(INSTANCE);
    driver.startAsk(session, INSTANCE_2, { instructions: "again", typed: false });
    runtime.emitStatus({ type: "model_request_started" });
    expect(calls.executing).toEqual([INSTANCE, INSTANCE_2]);
  });

  it("没有在飞 ask 时不报；dispose 退订", async () => {
    const runtime = stubRuntime(() => new Promise(() => {}));
    const { driver, calls } = makeDriver({ runtime });
    await driver.createActorSession(ACTOR, {});
    runtime.emitStatus({ type: "model_request_started" });
    runtime.emitStatus({
      type: "model_retry_scheduled",
      reason: "rate_limited",
      delayMs: 2000,
      nextAttempt: 2,
      message: "429",
    });
    expect(calls.executing).toEqual([]);
    expect(calls.waiting).toEqual([]);
    driver.dispose?.();
    expect(runtime.unsubscribeCalls).toBe(2);
  });
});

describe("workflow driver — per-actor 准入（§4，决策 34/36）", () => {
  it("端口在场：runtimeFactory 收到 admission；tryAdmit 命中不发 waiting；订阅 run 级 cap 变化并扇出", async () => {
    const runtime = stubRuntime(() => new Promise(() => {}));
    const { port, state } = fakePort();
    const { driver, calls, factoryInputs } = makeDriver({ runtime, concurrency: port });
    expect(state.subscribes).toEqual([expect.objectContaining({ runId: RUN })]);
    const session = await driver.createActorSession(ACTOR, {});
    const admission = factoryInputs[0]!.modelRequestAdmission;
    expect(admission).toBeDefined();
    driver.startAsk(session, INSTANCE, { instructions: "go", typed: false });

    const ticket = await admission!.acquire({ model: MODEL });
    expect(ticket).toBeDefined();
    expect(state.tryAdmits).toEqual([{ runId: RUN, key: "prov/alpha" }]);
    expect(state.admits).toEqual([]);
    expect(calls.waiting).toEqual([]);

    const change: ConcurrencyChange = {
      key: "prov/alpha",
      previous: 8,
      next: 4,
      reason: "rate_limited",
      cooldownMs: 5000,
    };
    state.subscribes[0]!.listener(change);
    expect(calls.concurrency).toEqual([change]);

    driver.dispose?.();
    expect(state.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("tryAcquire = tryAdmit；未命中时 acquire 排队；waiting(slot) 由 runner 的 queued 事件报，不由包装发（决策 44）", async () => {
    const runtime = stubRuntime(() => new Promise(() => {}));
    const { port, state } = fakePort();
    state.fast = false;
    const { driver, calls, factoryInputs } = makeDriver({ runtime, concurrency: port });
    const session = await driver.createActorSession(ACTOR, {});
    driver.startAsk(session, INSTANCE, { instructions: "go", typed: false });
    const admission = factoryInputs[0]!.modelRequestAdmission!;

    expect(admission.tryAcquire!({ model: MODEL })).toBeUndefined();
    expect(state.tryAdmits).toEqual([{ runId: RUN, key: "prov/alpha" }]);
    expect(calls.waiting).toEqual([]);
    runtime.emitStatus({ type: "model_request_queued", toolCallId: "tc-1" });
    expect(calls.waiting).toEqual([{ instance: INSTANCE, info: { cause: "slot" } }]);

    const signal = new AbortController().signal;
    const pending = admission.acquire({ model: MODEL, signal });
    await flush();
    expect(state.admits).toHaveLength(1);
    expect(state.admits[0]).toMatchObject({ runId: RUN, key: "prov/alpha", signal });
    state.admits[0]!.resolve(fakeTicket());
    await pending;
    runtime.emitStatus({ type: "model_request_admitted", queuedMs: 5, toolCallId: "tc-1" });
    runtime.emitStatus({ type: "model_request_started", toolCallId: "tc-1" });
    expect(calls.executing).toEqual([INSTANCE]);

    state.fast = true;
    expect(admission.tryAcquire!({ model: MODEL })).toBeDefined();
  });

  it("等槽位中 signal abort → acquire reject", async () => {
    const runtime = stubRuntime(() => new Promise(() => {}));
    const { port, state } = fakePort();
    state.fast = false;
    const { driver, factoryInputs } = makeDriver({ runtime, concurrency: port });
    await driver.createActorSession(ACTOR, {});
    const controller = new AbortController();
    const pending = factoryInputs[0]!.modelRequestAdmission!.acquire({
      model: MODEL,
      signal: controller.signal,
    });
    await flush();
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
  });

  it("端口缺席：runtimeFactory 不收 admission", async () => {
    const runtime = stubRuntime(() => new Promise(() => {}));
    const { driver, factoryInputs } = makeDriver({ runtime });
    await driver.createActorSession(ACTOR, {});
    expect(factoryInputs).toEqual([{}]);
  });
});

describe("workflow driver — 按请求链聚合的子代理相位（v3 决策 46）", () => {
  const turn = (extra: Record<string, unknown> = {}) => ({
    queryId: "q-1",
    querySource: "workflow_child",
    ...extra,
  });
  const tool = (id: string, extra: Record<string, unknown> = {}) => ({
    queryId: "q-1",
    querySource: "web_search_tool",
    toolCallId: id,
    ...extra,
  });

  it("一条链在执行时另一条链排队不报 waiting；执行链结束、只剩等待者 → 报最新的等待", async () => {
    const runtime = stubRuntime(() => new Promise(() => {}));
    const { driver, calls } = makeDriver({ runtime });
    const session = await driver.createActorSession(ACTOR, {});
    driver.startAsk(session, INSTANCE, { instructions: "go", typed: false });

    runtime.emitStatus({ type: "model_request_started", ...turn() });
    expect(calls.executing).toEqual([INSTANCE]);
    runtime.emitStatus({ type: "model_request_queued", ...tool("tc-a") });
    expect(calls.waiting).toEqual([]);
    runtime.emitStatus({ type: "model_request_completed", ...turn({ durationMs: 10 }) });
    expect(calls.waiting).toEqual([{ instance: INSTANCE, info: { cause: "slot" } }]);
    runtime.emitStatus({ type: "model_request_admitted", queuedMs: 40, ...tool("tc-a") });
    expect(calls.executing).toEqual([INSTANCE, INSTANCE]);
  });

  it("重试换 requestId 仍是同一条链：backoff → 下一次尝试 started 不留幽灵等待者", async () => {
    const runtime = stubRuntime(() => new Promise(() => {}));
    const { driver, calls } = makeDriver({ runtime });
    const session = await driver.createActorSession(ACTOR, {});
    driver.startAsk(session, INSTANCE, { instructions: "go", typed: false });

    runtime.emitStatus({ type: "model_request_started", requestId: "r-1", ...turn() });
    runtime.emitStatus({
      type: "model_request_failed",
      requestId: "r-1",
      reason: "rate_limited",
      retryable: true,
      message: "429",
      ...turn(),
    });
    runtime.emitStatus({
      type: "model_retry_scheduled",
      requestId: "r-1",
      reason: "rate_limited",
      delayMs: 2000,
      nextAttempt: 2,
      message: "429",
      ...turn(),
    });
    expect(calls.waiting).toHaveLength(1);
    runtime.emitStatus({ type: "model_request_started", requestId: "r-2", attempt: 2, ...turn() });
    expect(calls.executing).toEqual([INSTANCE, INSTANCE]);
    runtime.emitStatus({
      type: "model_request_completed",
      requestId: "r-2",
      attempt: 2,
      durationMs: 5,
      ...turn(),
    });
    expect(calls.waiting).toHaveLength(1);
    runtime.emitStatus({ type: "model_request_queued", ...tool("tc-b") });
    expect(calls.waiting).toHaveLength(2);
    expect(calls.waiting[1]!.info).toEqual({ cause: "slot" });
  });

  it("两条工具链并行：一条 executing 另一条 backoff 不报；两条都在等才报，再 started 才 executing", async () => {
    const runtime = stubRuntime(() => new Promise(() => {}));
    const { driver, calls } = makeDriver({ runtime });
    const session = await driver.createActorSession(ACTOR, {});
    driver.startAsk(session, INSTANCE, { instructions: "go", typed: false });

    runtime.emitStatus({ type: "model_request_started", ...tool("tc-1") });
    runtime.emitStatus({ type: "model_request_started", ...tool("tc-2") });
    expect(calls.executing).toEqual([INSTANCE]);
    runtime.emitStatus({
      type: "model_retry_scheduled",
      reason: "rate_limited",
      delayMs: 1500,
      nextAttempt: 2,
      message: "429",
      ...tool("tc-2"),
    });
    expect(calls.waiting).toEqual([]);
    runtime.emitStatus({
      type: "model_retry_scheduled",
      reason: "rate_limited",
      delayMs: 3000,
      nextAttempt: 2,
      message: "429",
      ...tool("tc-1"),
    });
    expect(calls.waiting).toEqual([
      {
        instance: INSTANCE,
        info: { cause: "backoff", reason: "rate_limited", attempt: 2, delayMs: 3000 },
      },
    ]);
    runtime.emitStatus({ type: "model_request_started", attempt: 2, ...tool("tc-2") });
    expect(calls.executing).toEqual([INSTANCE, INSTANCE]);
    runtime.emitStatus({
      type: "model_request_failed",
      reason: "auth_failed",
      retryable: false,
      message: "401",
      ...tool("tc-1"),
    });
    expect(calls.waiting).toHaveLength(1);
  });

  it("同一段等待里内容相同的等待只报一次（决策 49）：四条并行工具链同时排队 → 一条 waiting(slot)", async () => {
    const runtime = stubRuntime(() => new Promise(() => {}));
    const { driver, calls } = makeDriver({ runtime });
    const session = await driver.createActorSession(ACTOR, {});
    driver.startAsk(session, INSTANCE, { instructions: "go", typed: false });

    for (const id of ["tc-1", "tc-2", "tc-3", "tc-4"]) {
      runtime.emitStatus({ type: "model_request_queued", ...tool(id) });
    }
    expect(calls.waiting).toEqual([{ instance: INSTANCE, info: { cause: "slot" } }]);
    runtime.emitStatus({
      type: "model_retry_scheduled",
      reason: "rate_limited",
      delayMs: 1500,
      nextAttempt: 2,
      message: "429",
      ...tool("tc-1"),
    });
    expect(calls.waiting).toHaveLength(2);
    runtime.emitStatus({ type: "model_request_admitted", queuedMs: 30, ...tool("tc-2") });
    expect(calls.executing).toEqual([INSTANCE]);
    runtime.emitStatus({ type: "model_request_completed", durationMs: 5, ...tool("tc-2") });
    expect(calls.waiting).toHaveLength(3);
    expect(calls.waiting[2]!.info).toMatchObject({ cause: "backoff" });
    runtime.emitStatus({ type: "model_request_queued", ...tool("tc-5") });
    runtime.emitStatus({ type: "model_request_queued", ...tool("tc-6") });
    expect(calls.waiting).toHaveLength(4);
    expect(calls.waiting[3]!.info).toEqual({ cause: "slot" });
  });
});

describe("workflow driver — 模型侧错误的收容（apps/cli/packages/dynamic-workflow/docs/execution-engine.md）", () => {
  const adapterError = (context: Record<string, unknown>, message = "Model request failed") =>
    Object.assign(new Error(message), {
      name: "AiSdkModelAdapterError",
      code: "model_request_failed",
      context,
    });

  it("确定性错误（auth_failed）→ stopRun(ProviderStop) 携结构化明细，不结算节点", async () => {
    const runtime = stubRuntime(() =>
      Promise.reject(
        adapterError(
          {
            reason: "auth_failed",
            providerId: "prov",
            modelId: "alpha",
            providerCode: "1006",
            retryable: false,
          },
          "[1006] token expired",
        ),
      ),
    );
    const { driver, calls } = makeDriver({ runtime });
    const session = await driver.createActorSession(ACTOR, { name: "verifier" });
    driver.startAsk(session, INSTANCE, { instructions: "go", typed: false });
    await flush();
    expect(calls.failed).toEqual([]);
    expect(calls.stopped).toHaveLength(1);
    const error = calls.stopped[0]!;
    expect(error.code).toBe("ProviderStop");
    expect(error.providerStop).toEqual({
      kind: "auth",
      reason: "auth_failed",
      subagent: "actor#1@1",
      subagentName: "verifier",
      providerId: "prov",
      modelId: "alpha",
      providerCode: "1006",
      rawMessage: "[1006] token expired",
    });
    expect(error.message).toContain("verifier");
    expect(error.message).toContain("[1006]");
    expect(error.toJSON().providerStop?.kind).toBe("auth");
  });

  it("配额码（1308）→ stop/quota；包了一层 cause 时仍能读到", async () => {
    const inner = adapterError(
      { reason: "rate_limited", providerCode: "1308", retryable: false },
      "[1308] usage cap reached",
    );
    const runtime = stubRuntime(() => Promise.reject(new Error("turn failed", { cause: inner })));
    const { driver, calls } = makeDriver({ runtime });
    const session = await driver.createActorSession(ACTOR, {});
    driver.startAsk(session, INSTANCE, { instructions: "go", typed: false });
    await flush();
    expect(calls.stopped[0]?.providerStop).toMatchObject({ kind: "quota", providerCode: "1308" });
    expect(calls.stopped[0]?.providerStop?.subagent).toBe("actor#1@1");
    expect("subagentName" in calls.stopped[0]!.providerStop!).toBe(false);
  });

  it("context_exceeded → askFailed(ContextLimit)（脚本可 catch，未 catch 则 errored）", async () => {
    const runtime = stubRuntime(() =>
      Promise.reject(adapterError({ reason: "context_exceeded", retryable: false })),
    );
    const { driver, calls } = makeDriver({ runtime });
    const session = await driver.createActorSession(ACTOR, {});
    driver.startAsk(session, INSTANCE, { instructions: "go", typed: false });
    await flush();
    expect(calls.stopped).toEqual([]);
    expect(calls.failed).toHaveLength(1);
    expect(calls.failed[0]!.error.code).toBe("ContextLimit");
    expect(calls.failed[0]!.error.message).toContain("context window");
  });

  it("非模型错误 → DriverError（不带任何模型归因字段）", async () => {
    const runtime = stubRuntime(() => Promise.reject(new Error("script bug")));
    const { driver, calls } = makeDriver({ runtime });
    const session = await driver.createActorSession(ACTOR, {});
    driver.startAsk(session, INSTANCE, { instructions: "go", typed: false });
    await flush();
    expect(calls.stopped).toEqual([]);
    expect(calls.failed).toHaveLength(1);
    expect(calls.failed[0]!.error.code).toBe("DriverError");
    expect(calls.failed[0]!.error.message).toBe("Subagent turn failed: script bug");
    expect("providerStop" in calls.failed[0]!.error.toJSON()).toBe(false);
  });

  it("瞬态错误（runner 放过来的残余路径）→ askWaiting(backoff) 后续跑，不结算节点", async () => {
    const { clock, pending, advanceTo } = fakeClock();
    let turns = 0;
    const inputs: string[] = [];
    const runtime = stubRuntime(() => {
      turns += 1;
      return turns === 1
        ? Promise.reject(adapterError({ reason: "network_error", retryable: true }, "ECONNRESET"))
        : Promise.resolve({ response: "done", events: [], usage: undefined });
    });
    const originalExecute = runtime.executeTurn;
    runtime.executeTurn = ((input: string, ...rest: unknown[]) => {
      inputs.push(input);
      return (originalExecute as (...args: unknown[]) => Promise<unknown>)(input, ...rest);
    }) as never;
    const { driver, calls } = makeDriver({ runtime, clock: { ...clock, random: () => 1 } });
    const session = await driver.createActorSession(ACTOR, {});
    driver.startAsk(session, INSTANCE, { instructions: "go", typed: false });
    await flush();
    expect(calls.failed).toEqual([]);
    expect(calls.stopped).toEqual([]);
    expect(calls.waiting).toEqual([
      {
        instance: INSTANCE,
        info: { cause: "backoff", reason: "network_error", attempt: 1, delayMs: 2000 },
      },
    ]);
    expect(pending()).toHaveLength(1);
    expect(turns).toBe(1);
    advanceTo(2000);
    await flush();
    expect(turns).toBe(2);
    expect(inputs[1]).toContain("continue from where you left off");
  });

  it("瞬态错误带 Retry-After 时等它；等待期间 ask 被取消则不再续跑", async () => {
    const { clock, pending, advanceTo } = fakeClock();
    let turns = 0;
    const runtime = stubRuntime(() => {
      turns += 1;
      return Promise.reject(
        adapterError({ reason: "rate_limited", retryable: true, retryAfterMs: 30_000 }, "429"),
      );
    });
    const { driver, calls } = makeDriver({ runtime, clock });
    const session = await driver.createActorSession(ACTOR, {});
    driver.startAsk(session, INSTANCE, { instructions: "go", typed: false });
    await flush();
    expect(calls.waiting[0]!.info).toEqual({
      cause: "backoff",
      reason: "rate_limited",
      attempt: 1,
      delayMs: 30_000,
      retryAfterMs: 30_000,
    });
    driver.cancelAsk(INSTANCE);
    expect(pending()).toHaveLength(0);
    advanceTo(60_000);
    await flush();
    expect(turns).toBe(1);
  });
});

describe("run 级 stall 时钟（决策 4）", () => {
  it("20 分钟内没有一次成功、且排定过重试 → onStalled 恰好一次，带占多数的 reason 与 cap", () => {
    const { clock, advanceTo } = fakeClock();
    const stalled: RunStallInfo[] = [];
    const stall = createRunStallClock({ ...clock, onStalled: (info) => stalled.push(info) });
    stall.noteCap(4);
    advanceTo(60_000);
    stall.noteRetryScheduled("rate_limited");
    stall.noteRetryScheduled("network_error");
    stall.noteRetryScheduled("rate_limited");
    advanceTo(WORKFLOW_STALL_NOTIFY_AFTER_MS - 1);
    expect(stalled).toEqual([]);
    advanceTo(WORKFLOW_STALL_NOTIFY_AFTER_MS);
    expect(stalled).toEqual([
      { sinceMs: WORKFLOW_STALL_NOTIFY_AFTER_MS, reason: "rate_limited", cap: 4 },
    ]);
    stall.noteRetryScheduled("rate_limited");
    advanceTo(WORKFLOW_STALL_NOTIFY_AFTER_MS * 3);
    expect(stalled).toHaveLength(1);
  });

  it("A single success resets and re-arms: the clock measures \"time since last success\", not \"time since first retry\"", () => {
    const { clock, advanceTo } = fakeClock();
    const stalled: RunStallInfo[] = [];
    const stall = createRunStallClock({ ...clock, onStalled: (info) => stalled.push(info) });
    stall.noteRetryScheduled("server_error");
    advanceTo(10 * 60_000);
    stall.noteSuccess();
    advanceTo(25 * 60_000);
    expect(stalled).toEqual([]);
    stall.noteRetryScheduled("server_error");
    advanceTo(30 * 60_000 - 1);
    expect(stalled).toEqual([]);
    advanceTo(30 * 60_000);
    expect(stalled).toEqual([{ sinceMs: WORKFLOW_STALL_NOTIFY_AFTER_MS, reason: "server_error" }]);
  });

  it("没有重试就没有 stall；dispose 撤闹钟", () => {
    const { clock, advanceTo, pending } = fakeClock();
    const stalled: RunStallInfo[] = [];
    const stall = createRunStallClock({ ...clock, onStalled: (info) => stalled.push(info) });
    advanceTo(WORKFLOW_STALL_NOTIFY_AFTER_MS * 2);
    expect(stalled).toEqual([]);
    stall.noteRetryScheduled("timeout");
    expect(pending()).toHaveLength(1);
    stall.dispose();
    expect(pending()).toHaveLength(0);
    advanceTo(WORKFLOW_STALL_NOTIFY_AFTER_MS * 4);
    expect(stalled).toEqual([]);
  });

  it("driver 接线：actor 的 retry_scheduled 上膛、completed 归零，到点经 sink.runStalled 报出", async () => {
    const { clock, advanceTo } = fakeClock();
    const runtime = stubRuntime(() => new Promise(() => {}));
    const { driver, calls } = makeDriver({ runtime, clock: { ...clock, stallAfterMs: 1_000 } });
    const session = await driver.createActorSession(ACTOR, {});
    driver.startAsk(session, INSTANCE, { instructions: "go", typed: false });
    runtime.emitStatus({ type: "model_request_started", attempt: 1 });
    runtime.emitStatus({
      type: "model_retry_scheduled",
      reason: "rate_limited",
      delayMs: 500,
      nextAttempt: 2,
      message: "429",
    });
    advanceTo(999);
    expect(calls.stalled).toEqual([]);
    advanceTo(1_000);
    expect(calls.stalled).toEqual([{ sinceMs: 1_000, reason: "rate_limited" }]);
    runtime.emitStatus({ type: "model_request_completed", attempt: 2, durationMs: 10 });
    runtime.emitStatus({
      type: "model_retry_scheduled",
      reason: "rate_limited",
      delayMs: 500,
      nextAttempt: 3,
      message: "429",
    });
    advanceTo(1_999);
    expect(calls.stalled).toHaveLength(1);
    advanceTo(2_000);
    expect(calls.stalled).toHaveLength(2);
    driver.dispose();
  });
});

describe("workflow driver — askMutating 观察（子代理的第一笔工作区写入）", () => {
  it("在飞 ask 的子代理发出会改写工作区的 ToolCallStarted → askMutating 一次；只读工具不算；换 ask 再报一次", async () => {
    const runtime = stubRuntime(() => new Promise(() => {}));
    const { driver, calls } = makeDriver({ runtime });
    const session = await driver.createActorSession(ACTOR, { name: "fixer" });
    driver.startAsk(session, INSTANCE, { instructions: "fix", typed: false });
    await flush();

    runtime.emitToolStarted({ toolName: "Read", readOnly: true, sideEffectScope: "none" });
    runtime.emitToolStarted({ toolName: "Bash", readOnly: true, sideEffectScope: "none" });
    expect(calls.mutating).toEqual([]);
    runtime.emitToolStarted({ toolName: "Write", readOnly: false, sideEffectScope: "workspace" });
    runtime.emitToolStarted({ toolName: "Edit", readOnly: false, sideEffectScope: "workspace" });
    expect(calls.mutating).toEqual([INSTANCE]);

    driver.cancelAsk(INSTANCE);
    driver.startAsk(session, INSTANCE_2, { instructions: "fix again", typed: false });
    await flush();
    runtime.emitToolStarted({ toolName: "Bash", readOnly: false, sideEffectScope: "system" });
    expect(calls.mutating).toEqual([INSTANCE, INSTANCE_2]);
  });

  it("没有在飞 ask（已取消 / 尚未开始）时的写入不上报——迟到的观察对结算过的 ask 没有意义", async () => {
    const runtime = stubRuntime(() => new Promise(() => {}));
    const { driver, calls } = makeDriver({ runtime });
    const session = await driver.createActorSession(ACTOR, { name: "fixer" });
    runtime.emitToolStarted({ toolName: "Write", readOnly: false, sideEffectScope: "workspace" });
    expect(calls.mutating).toEqual([]);
    driver.startAsk(session, INSTANCE, { instructions: "fix", typed: false });
    await flush();
    driver.cancelAsk(INSTANCE);
    runtime.emitToolStarted({ toolName: "Write", readOnly: false, sideEffectScope: "workspace" });
    expect(calls.mutating).toEqual([]);
  });
});
