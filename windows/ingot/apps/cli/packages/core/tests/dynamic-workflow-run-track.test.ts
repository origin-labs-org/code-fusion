//
import { describe, expect, it, vi } from "vitest";
import {
  CREATE_WORKFLOW_TOOL_NAME,
  RESUME_WORKFLOW_RUN_TOOL_NAME,
  SessionEventType,
  createRootTraceContext,
  createSessionId,
  type DynamicWorkflowRunSnapshot,
  type SessionEvent,
} from "@origin-ai/cf-contracts";
import { workflowNotificationMetaSchema } from "@origin-ai/cf-shared/cf-protocol-v4";
import { AgentRuntime } from "../src/index.js";
import { InMemoryRuntimeTaskRegistry } from "../src/runtime-task/registry.js";
import { BackgroundTaskTracker } from "../src/tool/executor/background-tasks.js";
import type { ToolExecutorDeps } from "../src/tool/executor/types.js";
import type { ExecutableToolCall } from "../src/tool/types.js";
import { createTestSessionEventStore } from "./test-event-store.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface TerminalQueue {
  resolve(value: DynamicWorkflowRunSnapshot): void;
}

function makeTerminalQueue(): TerminalQueue & {
  waitForTask(): Promise<DynamicWorkflowRunSnapshot>;
} {
  const pending: Deferred<DynamicWorkflowRunSnapshot>[] = [];
  return {
    waitForTask() {
      const deferred = defer<DynamicWorkflowRunSnapshot>();
      pending.push(deferred);
      return deferred.promise;
    },
    resolve(value) {
      pending.shift()?.resolve(value);
    },
  };
}

function makeRuntime(name: string): {
  runtime: AgentRuntime;
  events: SessionEvent[];
  terminal: TerminalQueue;
} {
  const terminal = makeTerminalQueue();
  const runtime = new AgentRuntime(
    createSessionId(name),
    { agentName: "dwf-track-test", workingDirectory: "/tmp/cf-dwf-track" },
    {
      eventStore: createTestSessionEventStore(),
      modelAdapter: {} as never,
      dynamicWorkflowRunPort: {
        async submit() {
          throw new Error("resume 重臂不应触发 submit");
        },
        async getTask() {
          return {
            runId: "dwfrun-1",
            taskId: "dwfrun-1",
            startedAt: new Date(),
            status: "running",
          };
        },
        waitForTask: () => terminal.waitForTask(),
        async cancel() {
          return true;
        },
        async listEvents() {
          return [];
        },
      } as never,
    },
  );
  const events: SessionEvent[] = [];
  runtime.subscribeEvents({ onSessionEvent: (event) => events.push(event) });
  return { runtime, events, terminal };
}

describe("trackResumedDynamicWorkflowRun", () => {
  it("登记 registry（回收护栏）并发出可取消的 workflow started 事件", async () => {
    const { runtime, events } = makeRuntime("dwf-track-started");

    await runtime.trackResumedDynamicWorkflowRun({
      runId: "dwfrun-1",
      toolCallId: "call-origin",
      name: "Nightly audit",
    });

    expect(runtime.hasRunningBackgroundTasks()).toBe(true);

    const started = events.find((event) => event.type === SessionEventType.BackgroundTaskStarted);
    expect(started?.payload).toMatchObject({
      cancellable: true,
      description: "Nightly audit",
      status: "running",
      taskId: "dwfrun-1",
      taskKind: "workflow",
      toolCallId: "call-origin",
      toolName: "CreateWorkflow",
    });
    expect(started?.turnId).toBeUndefined();
  });

  it("终态经 waiter 收口：resolve 后发出 completed 事件并退出 registry", async () => {
    const { runtime, events, terminal } = makeRuntime("dwf-track-settle");
    await runtime.trackResumedDynamicWorkflowRun({ runId: "dwfrun-1" });

    terminal.resolve({
      runId: "dwfrun-1",
      taskId: "dwfrun-1",
      startedAt: new Date(),
      status: "completed",
      output: "revived artifact",
    });
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === SessionEventType.BackgroundTaskCompleted)).toBe(
        true,
      );
    });
    expect(runtime.hasRunningBackgroundTasks()).toBe(false);
  });

  it("同 runId 重复重臂是幂等的（poller 去重，不发第二个 started）", async () => {
    const { runtime, events } = makeRuntime("dwf-track-dedupe");
    await runtime.trackResumedDynamicWorkflowRun({ runId: "dwfrun-1", toolCallId: "call-1" });
    await runtime.trackResumedDynamicWorkflowRun({ runId: "dwfrun-1", toolCallId: "call-1" });

    const started = events.filter((event) => event.type === SessionEventType.BackgroundTaskStarted);
    expect(started).toHaveLength(1);
  });

  it("老 run 缺 toolCallId 时合成可观测的 resume 前缀 id，不冒充真实工具行", async () => {
    const { runtime, events } = makeRuntime("dwf-track-no-anchor");
    await runtime.trackResumedDynamicWorkflowRun({ runId: "dwfrun-old" });

    const started = events.find((event) => event.type === SessionEventType.BackgroundTaskStarted);
    expect((started?.payload as { toolCallId?: string }).toolCallId).toBe("resume-dwfrun-old");
    expect((started?.payload as { description?: string }).description).toBe("dwfrun-old");
  });
});

// ————————————————————————————————————————————————
//
// ————————————————————————————————————————————————

function makeUnitFixture(runId = "dwfrun-relive"): {
  deps: ToolExecutorDeps;
  events: SessionEvent[];
  notifications: { text: string; taskId?: string; originMeta?: unknown }[];
  registry: InMemoryRuntimeTaskRegistry;
  settleTerminal(value: DynamicWorkflowRunSnapshot): void;
} {
  const registry = new InMemoryRuntimeTaskRegistry();
  const events: SessionEvent[] = [];
  const notifications: { text: string; taskId?: string; originMeta?: unknown }[] = [];
  const terminal = makeTerminalQueue();
  const deps = {
    emitEvent: async (event: SessionEvent) => {
      events.push(event);
    },
    enqueueBackgroundTaskNotification: (notification: {
      text: string;
      taskId?: string;
      originMeta?: unknown;
    }) => {
      notifications.push(notification);
    },
    runtimeTaskRegistry: registry,
    dynamicWorkflowRunPort: {
      async getTask() {
        return { runId, taskId: runId, startedAt: new Date(), status: "running" };
      },
      waitForTask: () => terminal.waitForTask(),
      async cancel() {
        return true;
      },
    },
    sessionId: createSessionId("dwf-relive-unit"),
  } as unknown as ToolExecutorDeps;
  return {
    deps,
    events,
    notifications,
    registry,
    settleTerminal: (value) => terminal.resolve(value),
  };
}

describe("trackBackgroundTask 终态残留复位（单元级）", () => {
  it("重臂终态条目按新生命重盖 branchGeneration（cancel → rewind → resume 不被 stale-branch fencing 拦下）", async () => {
    const { deps, registry } = makeUnitFixture();
    registry.setActiveBranchGeneration(3);
    registry.register({
      taskId: "dwfrun-relive",
      agentId: "dwfrun-relive",
      agentType: "local_dynamic_workflow",
      description: "nightly audit",
      startedAt: new Date(0),
      status: "killed",
      type: "local_dynamic_workflow",
      isBackgrounded: true,
      notified: true,
    });
    expect(registry.get("dwfrun-relive")?.branchGeneration).toBe(3);
    registry.setActiveBranchGeneration(7);

    const tracker = new BackgroundTaskTracker(deps);
    await tracker.trackBackgroundTask(
      { id: "call-resume-new", name: CREATE_WORKFLOW_TOOL_NAME, input: {} },
      { status: "backgrounded", backgroundTaskId: "dwfrun-relive" },
      createRootTraceContext({ sessionId: createSessionId("dwf-relive-unit") }),
      undefined,
    );
    expect(registry.get("dwfrun-relive")?.branchGeneration).toBe(7);
    expect(registry.get("dwfrun-relive")?.status).toBe("running");
  });

  it("仍在 running 的既有条目重臂保持自己的 branchGeneration（不是新生命）", async () => {
    const { deps, registry } = makeUnitFixture();
    registry.setActiveBranchGeneration(3);
    registry.register({
      taskId: "dwfrun-relive",
      agentId: "dwfrun-relive",
      agentType: "local_dynamic_workflow",
      description: "nightly audit",
      startedAt: new Date(0),
      status: "running",
      type: "local_dynamic_workflow",
      isBackgrounded: true,
    });
    registry.setActiveBranchGeneration(7);
    const tracker = new BackgroundTaskTracker(deps);
    await tracker.trackBackgroundTask(
      { id: "call-resume-new", name: CREATE_WORKFLOW_TOOL_NAME, input: {} },
      { status: "backgrounded", backgroundTaskId: "dwfrun-relive" },
      createRootTraceContext({ sessionId: createSessionId("dwf-relive-unit") }),
      undefined,
    );
    expect(registry.get("dwfrun-relive")?.branchGeneration).toBe(3);
  });

  it("Re-arm existing final entries: reset settlement, retain identity, ensure second settlement notification isn\'t swallowed by old claim", async () => {
    const { deps, notifications, registry, settleTerminal } = makeUnitFixture();
    const startedAt = new Date(Date.UTC(2026, 7, 1, 8, 0, 0));
    registry.register({
      taskId: "dwfrun-relive",
      agentId: "dwfrun-relive",
      agentType: "local_dynamic_workflow",
      description: "nightly audit",
      startedAt,
      status: "killed",
      type: "local_dynamic_workflow",
      isBackgrounded: true,
      notified: true,
      error: "cancelled by user",
      completedAt: new Date(Date.UTC(2026, 7, 1, 9, 0, 0)),
      resultText: "旧产物",
      parentToolCallId: "call-create-origin",
    });

    const tracker = new BackgroundTaskTracker(deps);
    const toolCall: ExecutableToolCall = {
      id: "call-resume-new",
      name: CREATE_WORKFLOW_TOOL_NAME,
      input: {},
    };
    await tracker.trackBackgroundTask(
      toolCall,
      { status: "backgrounded", backgroundTaskId: "dwfrun-relive" },
      createRootTraceContext({ sessionId: createSessionId("dwf-relive-unit") }),
      undefined,
    );

    const rearmed = registry.get("dwfrun-relive");
    expect(rearmed?.status).toBe("running");
    expect(rearmed?.notified).toBe(false);
    expect(rearmed?.error).toBeUndefined();
    expect(rearmed?.completedAt).toBeUndefined();
    expect(rearmed?.resultText).toBeUndefined();
    expect(rearmed?.parentToolCallId).toBe("call-create-origin");
    expect(rearmed?.startedAt).toBe(startedAt);

    settleTerminal({
      runId: "dwfrun-relive",
      taskId: "dwfrun-relive",
      startedAt: new Date(),
      status: "completed",
      output: "revived artifact",
    });
    await vi.waitFor(() => {
      expect(notifications).toHaveLength(1);
    });
    expect(notifications[0]!.text).toContain("revived artifact");
  });
});

// ————————————————————————————————————————————————
// ————————————————————————————————————————————————
interface TerminalNotificationMeta {
  kind: "terminal";
  status: "completed" | "failed" | "cancelled";
  summary: string;
  result?: string;
  resultForm?: "prose" | "json";
  resultTruncated?: true;
  error?: string;
  reports?: { count: number; shown: number; preview: string[] };
  artifacts?: { id: string; kind: string; title?: string; version: number; contentType?: string }[];
  artifactsTruncated?: true;
  durationMs?: number;
}

function terminalMetaOf(
  notification: { originMeta?: unknown } | undefined,
): TerminalNotificationMeta | undefined {
  const originMeta = notification?.originMeta as
    | { workflowNotification?: TerminalNotificationMeta }
    | undefined;
  const meta = originMeta?.workflowNotification;
  return meta?.kind === "terminal" ? meta : undefined;
}

describe("终态通知的 manifest 载荷", () => {
  it("completed：status/summary/result(prose)/reports/durationMs 齐备", async () => {
    const { deps, notifications, settleTerminal } = makeUnitFixture("dwfrun-manifest");
    const tracker = new BackgroundTaskTracker(deps);
    await tracker.trackBackgroundTask(
      { id: "call-m1", name: CREATE_WORKFLOW_TOOL_NAME, input: { name: "nightly audit" } },
      { status: "backgrounded", backgroundTaskId: "dwfrun-manifest" },
      createRootTraceContext({ sessionId: createSessionId("dwf-manifest") }),
      undefined,
    );
    const startedAt = new Date(Date.UTC(2026, 8, 1, 8, 0, 0));
    const completedAt = new Date(Date.UTC(2026, 8, 1, 8, 0, 5));
    settleTerminal({
      runId: "dwfrun-manifest",
      taskId: "dwfrun-manifest",
      startedAt,
      completedAt,
      status: "completed",
      output: "final prose artifact",
      reports: [{ title: "第一步" }, "第二步"],
    });
    await vi.waitFor(() => {
      expect(notifications).toHaveLength(1);
    });
    const meta = terminalMetaOf(notifications[0]);
    expect(notifications[0]!.originMeta).toMatchObject({ title: "nightly audit" });
    expect(meta).toMatchObject({
      kind: "terminal",
      status: "completed",
      summary: "nightly audit",
      result: "final prose artifact",
      resultForm: "prose",
      durationMs: 5_000,
    });
    expect(meta?.resultTruncated).toBeUndefined();
    expect(meta?.reports).toEqual({
      count: 2,
      shown: 2,
      preview: [JSON.stringify({ title: "第一步" }, null, 2), "第二步"],
    });
  });

  it("reports.count reads snapshot\'s reportCount (snapshot includes only the first 256 items)", async () => {
    const meta = await terminalMetaAfterSettle("dwfrun-manifest-count", {
      startedAt: new Date(Date.UTC(2026, 8, 1, 8, 0, 0)),
      completedAt: new Date(Date.UTC(2026, 8, 1, 8, 0, 5)),
      status: "completed",
      output: "done",
      reports: Array.from({ length: 256 }, (_, index) => `f${index + 1}`),
      reportCount: 65_536,
    });
    expect(meta?.reports?.count).toBe(65_536);
    expect(meta?.reports?.shown).toBe(8);
    expect(meta?.reports?.preview[0]).toBe("f1");
  });

  // ————————————————————————————————————————————————
  // ————————————————————————————————————————————————

  
  async function terminalMetaAfterSettle(
    runId: string,
    snapshot: Omit<DynamicWorkflowRunSnapshot, "runId" | "taskId">,
  ): Promise<TerminalNotificationMeta | undefined> {
    const { deps, notifications, settleTerminal } = makeUnitFixture(runId);
    const tracker = new BackgroundTaskTracker(deps);
    await tracker.trackBackgroundTask(
      { id: `call-${runId}`, name: CREATE_WORKFLOW_TOOL_NAME, input: {} },
      { status: "backgrounded", backgroundTaskId: runId },
      createRootTraceContext({ sessionId: createSessionId(runId) }),
      undefined,
    );
    settleTerminal({ runId, taskId: runId, ...snapshot } as DynamicWorkflowRunSnapshot);
    await vi.waitFor(() => {
      expect(notifications).toHaveLength(1);
    });
    return terminalMetaOf(notifications[0]);
  }

  
  const AMENDED_LIFE = {
    startedAt: new Date(Date.UTC(2026, 8, 1, 12, 0, 0)),
    completedAt: new Date(Date.UTC(2026, 8, 1, 12, 0, 12)),
    status: "completed" as const,
  };

  it("Report lineage active duration if present, instead of the current process\'s duration", async () => {
    const meta = await terminalMetaAfterSettle("dwfrun-lineage", {
      ...AMENDED_LIFE,
      activeDurationMs: 4 * 3_600_000,
    });

    expect(meta?.durationMs).toBe(4 * 3_600_000);
    expect(workflowNotificationMetaSchema.safeParse(meta).success).toBe(true);
  });

  it("端口不带 activeDurationMs（老端口 / 内存 journal）：退回本世，行为逐字不变", async () => {
    const meta = await terminalMetaAfterSettle("dwfrun-own-life", AMENDED_LIFE);

    expect(meta?.durationMs).toBe(12_000);
  });

  it("取大：lineage 值小于本世（老 run 的事件不全）时不少报本进程亲眼所见的那一段", async () => {
    const meta = await terminalMetaAfterSettle("dwfrun-floor", {
      ...AMENDED_LIFE,
      activeDurationMs: 3_000,
    });

    expect(meta?.durationMs).toBe(12_000);
  });

  it("只有 lineage 值、没有 completedAt 时也报得出", async () => {
    const meta = await terminalMetaAfterSettle("dwfrun-no-completed", {
      startedAt: new Date(Date.UTC(2026, 8, 1, 12, 0, 0)),
      status: "completed",
      activeDurationMs: 90_000,
    });

    expect(meta?.durationMs).toBe(90_000);
  });

  it("脏的 lineage 值（负数 / 非有限）读作说不出，不污染时长", async () => {
    const negative = await terminalMetaAfterSettle("dwfrun-negative", {
      ...AMENDED_LIFE,
      activeDurationMs: -1,
    });
    expect(negative?.durationMs).toBe(12_000);

    const notFinite = await terminalMetaAfterSettle("dwfrun-nan", {
      ...AMENDED_LIFE,
      activeDurationMs: Number.NaN,
    });
    expect(notFinite?.durationMs).toBe(12_000);

    const neither = await terminalMetaAfterSettle("dwfrun-neither", {
      startedAt: new Date(Date.UTC(2026, 8, 1, 12, 0, 0)),
      status: "completed",
      activeDurationMs: Number.POSITIVE_INFINITY,
    });
    expect(neither?.durationMs).toBeUndefined();
  });

  it("非字符串产物 → resultForm=json；>4000 产物截断且置 resultTruncated", async () => {
    const { deps, notifications, settleTerminal } = makeUnitFixture("dwfrun-json");
    const tracker = new BackgroundTaskTracker(deps);
    await tracker.trackBackgroundTask(
      { id: "call-m2", name: CREATE_WORKFLOW_TOOL_NAME, input: {} },
      { status: "backgrounded", backgroundTaskId: "dwfrun-json" },
      createRootTraceContext({ sessionId: createSessionId("dwf-json") }),
      undefined,
    );
    const big = "x".repeat(5_000);
    settleTerminal({
      runId: "dwfrun-json",
      taskId: "dwfrun-json",
      startedAt: new Date(),
      status: "completed",
      output: { blob: big },
    });
    await vi.waitFor(() => {
      expect(notifications).toHaveLength(1);
    });
    const meta = terminalMetaOf(notifications[0]);
    expect(meta?.resultForm).toBe("json");
    expect(meta?.resultTruncated).toBe(true);
    expect(meta?.result?.length).toBe(4_000);
  });

  it("failed：error 落载荷；无产物则无 result/resultForm", async () => {
    const { deps, notifications, settleTerminal } = makeUnitFixture("dwfrun-failed");
    const tracker = new BackgroundTaskTracker(deps);
    await tracker.trackBackgroundTask(
      { id: "call-m3", name: CREATE_WORKFLOW_TOOL_NAME, input: {} },
      { status: "backgrounded", backgroundTaskId: "dwfrun-failed" },
      createRootTraceContext({ sessionId: createSessionId("dwf-failed") }),
      undefined,
    );
    settleTerminal({
      runId: "dwfrun-failed",
      taskId: "dwfrun-failed",
      startedAt: new Date(),
      status: "failed",
      runStatus: "errored",
      error: "ask #12 exhausted budget",
    });
    await vi.waitFor(() => {
      expect(notifications).toHaveLength(1);
    });
    const meta = terminalMetaOf(notifications[0]);
    expect(meta).toMatchObject({
      kind: "terminal",
      status: "errored",
      error: "ask #12 exhausted budget",
    });
    expect(meta?.result).toBeUndefined();
    expect(meta?.resultForm).toBeUndefined();
  });

  it("lost（快照缺失）→ 无 manifest 载荷，仅保留三基字段", async () => {
    const notifications: { text: string; originMeta?: unknown }[] = [];
    const deps = {
      emitEvent: async () => {},
      enqueueBackgroundTaskNotification: (n: { text: string; originMeta?: unknown }) => {
        notifications.push(n);
      },
      runtimeTaskRegistry: new InMemoryRuntimeTaskRegistry(),
      sessionId: createSessionId("dwf-lost-unit"),
    } as unknown as ToolExecutorDeps;
    const tracker = new BackgroundTaskTracker(deps);
    await tracker.trackBackgroundTask(
      { id: "call-m4", name: CREATE_WORKFLOW_TOOL_NAME, input: { name: "orphan" } },
      { status: "backgrounded", backgroundTaskId: "dwfrun-lost" },
      createRootTraceContext({ sessionId: createSessionId("dwf-lost") }),
      undefined,
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.originMeta).toEqual({
      backgroundSource: "workflow",
      title: "orphan",
      workId: "dwfrun-lost",
    });
  });

  //
  it("artifacts：只带 chip 画得下的字段，与 result 并列且互不影响", async () => {
    const { deps, notifications, settleTerminal } = makeUnitFixture("dwfrun-artifacts");
    const tracker = new BackgroundTaskTracker(deps);
    await tracker.trackBackgroundTask(
      { id: "call-a1", name: CREATE_WORKFLOW_TOOL_NAME, input: { name: "audit" } },
      { status: "backgrounded", backgroundTaskId: "dwfrun-artifacts" },
      createRootTraceContext({ sessionId: createSessionId("dwf-artifacts") }),
      undefined,
    );
    settleTerminal({
      runId: "dwfrun-artifacts",
      taskId: "dwfrun-artifacts",
      startedAt: new Date(),
      status: "completed",
      output: "the script's return value",
      artifacts: [
        {
          id: "report",
          kind: "file",
          title: "审计报告",
          contentType: "application/pdf",
          sourcePath: "out/report.pdf",
          version: 2,
          itemCount: 0,
          versions: [
            { version: 1, publishedAt: 1, bytes: 10 },
            { version: 2, publishedAt: 2, bytes: 4096 },
          ],
        },
        {
          id: "perf",
          kind: "chart",
          version: 1,
          itemCount: 7,
          versions: [{ version: 1, publishedAt: 3 }],
        },
      ],
    });
    await vi.waitFor(() => {
      expect(notifications).toHaveLength(1);
    });
    const meta = terminalMetaOf(notifications[0]);
    expect(meta?.artifacts).toEqual([
      { id: "report", kind: "file", title: "审计报告", version: 2, contentType: "application/pdf" },
      { id: "perf", kind: "chart", version: 1 },
    ]);
    expect(meta?.artifactsTruncated).toBeUndefined();
    expect(meta?.result).toBe("the script's return value");
  });

  it("artifacts: primary leads the list (9th item won\'t be cut by the limit of 8), description is present only on it", async () => {
    const { deps, notifications, settleTerminal } = makeUnitFixture("dwfrun-artifacts-primary");
    const tracker = new BackgroundTaskTracker(deps);
    await tracker.trackBackgroundTask(
      { id: "call-a5", name: CREATE_WORKFLOW_TOOL_NAME, input: {} },
      { status: "backgrounded", backgroundTaskId: "dwfrun-artifacts-primary" },
      createRootTraceContext({ sessionId: createSessionId("dwf-artifacts-primary") }),
      undefined,
    );
    settleTerminal({
      runId: "dwfrun-artifacts-primary",
      taskId: "dwfrun-artifacts-primary",
      startedAt: new Date(),
      status: "completed",
      artifacts: [
        ...Array.from({ length: 8 }, (_, index) => ({
          id: `a${index + 1}`,
          kind: "markdown",
          version: 1,
          itemCount: 0,
          description: "intermediate note",
          versions: [{ version: 1, publishedAt: 1, bytes: 8 }],
        })),
        {
          id: "report",
          kind: "markdown",
          title: "审计报告",
          description: "结论与修复建议",
          version: 2,
          itemCount: 0,
          primary: true,
          versions: [
            { version: 1, publishedAt: 9, bytes: 8, primary: true },
            { version: 2, publishedAt: 10, bytes: 9, primary: true },
          ],
        },
      ],
    });
    await vi.waitFor(() => {
      expect(notifications).toHaveLength(1);
    });
    const meta = terminalMetaOf(notifications[0]);
    expect(meta?.artifacts).toHaveLength(8);
    expect(meta?.artifacts?.[0]).toEqual({
      id: "report",
      kind: "markdown",
      title: "审计报告",
      version: 2,
      primary: true,
      description: "结论与修复建议",
    });
    expect(meta?.artifacts?.slice(1).map((artifact) => artifact.id)).toEqual([
      "a1",
      "a2",
      "a3",
      "a4",
      "a5",
      "a6",
      "a7",
    ]);
    expect(meta?.artifacts?.slice(1).some((artifact) => "description" in artifact)).toBe(false);
    expect(meta?.artifactsTruncated).toBe(true);
    const text = notifications[0]!.text;
    const primaryLine = text.indexOf("- report (markdown, primary, v2");
    expect(primaryLine).toBeGreaterThan(-1);
    expect(primaryLine).toBeLessThan(text.indexOf("- a1 (markdown, v1"));
    expect(text).toContain("The one marked primary is the deliverable");
  });

  it("artifacts：超过 8 件截断并置 artifactsTruncated；零件时两个键一起缺席", async () => {
    const { deps, notifications, settleTerminal } = makeUnitFixture("dwfrun-artifacts-many");
    const tracker = new BackgroundTaskTracker(deps);
    await tracker.trackBackgroundTask(
      { id: "call-a2", name: CREATE_WORKFLOW_TOOL_NAME, input: {} },
      { status: "backgrounded", backgroundTaskId: "dwfrun-artifacts-many" },
      createRootTraceContext({ sessionId: createSessionId("dwf-artifacts-many") }),
      undefined,
    );
    settleTerminal({
      runId: "dwfrun-artifacts-many",
      taskId: "dwfrun-artifacts-many",
      startedAt: new Date(),
      status: "completed",
      artifacts: Array.from({ length: 10 }, (_, index) => ({
        id: `a${index + 1}`,
        kind: "markdown",
        version: 1,
        itemCount: 0,
        versions: [{ version: 1, publishedAt: 1, bytes: 8 }],
      })),
    });
    await vi.waitFor(() => {
      expect(notifications).toHaveLength(1);
    });
    const meta = terminalMetaOf(notifications[0]);
    expect(meta?.artifacts).toHaveLength(8);
    expect(meta?.artifacts?.[7]?.id).toBe("a8");
    expect(meta?.artifactsTruncated).toBe(true);

    const empty = makeUnitFixture("dwfrun-artifacts-none");
    const emptyTracker = new BackgroundTaskTracker(empty.deps);
    await emptyTracker.trackBackgroundTask(
      { id: "call-a3", name: CREATE_WORKFLOW_TOOL_NAME, input: {} },
      { status: "backgrounded", backgroundTaskId: "dwfrun-artifacts-none" },
      createRootTraceContext({ sessionId: createSessionId("dwf-artifacts-none") }),
      undefined,
    );
    empty.settleTerminal({
      runId: "dwfrun-artifacts-none",
      taskId: "dwfrun-artifacts-none",
      startedAt: new Date(),
      status: "completed",
    });
    await vi.waitFor(() => {
      expect(empty.notifications).toHaveLength(1);
    });
    const emptyMeta = terminalMetaOf(empty.notifications[0]);
    expect(emptyMeta?.artifacts).toBeUndefined();
    expect(emptyMeta?.artifactsTruncated).toBeUndefined();
  });

  it("artifacts：未知 kind 的条目整条丢弃，其余 chip 不受牵连", async () => {
    const { deps, notifications, settleTerminal } = makeUnitFixture("dwfrun-artifacts-kind");
    const tracker = new BackgroundTaskTracker(deps);
    await tracker.trackBackgroundTask(
      { id: "call-a4", name: CREATE_WORKFLOW_TOOL_NAME, input: {} },
      { status: "backgrounded", backgroundTaskId: "dwfrun-artifacts-kind" },
      createRootTraceContext({ sessionId: createSessionId("dwf-artifacts-kind") }),
      undefined,
    );
    settleTerminal({
      runId: "dwfrun-artifacts-kind",
      taskId: "dwfrun-artifacts-kind",
      startedAt: new Date(),
      status: "completed",
      artifacts: [
        {
          id: "future",
          kind: "hologram",
          version: 1,
          itemCount: 0,
          versions: [{ version: 1, publishedAt: 1 }],
        },
        {
          id: "notes",
          kind: "markdown",
          version: 1,
          itemCount: 0,
          versions: [{ version: 1, publishedAt: 2 }],
        },
      ],
    });
    await vi.waitFor(() => {
      expect(notifications).toHaveLength(1);
    });
    const meta = terminalMetaOf(notifications[0]);
    expect(meta?.artifacts).toEqual([{ id: "notes", kind: "markdown", version: 1 }]);
    expect(meta?.artifactsTruncated).toBe(true);
  });

  it("artifacts：越界的 id / version / contentType 整条或整键丢弃，产物恒可被 shared 的 zod 接受", async () => {
    const { deps, notifications, settleTerminal } = makeUnitFixture("dwfrun-artifacts-bounds");
    const tracker = new BackgroundTaskTracker(deps);
    await tracker.trackBackgroundTask(
      { id: "call-a5", name: CREATE_WORKFLOW_TOOL_NAME, input: {} },
      { status: "backgrounded", backgroundTaskId: "dwfrun-artifacts-bounds" },
      createRootTraceContext({ sessionId: createSessionId("dwf-artifacts-bounds") }),
      undefined,
    );
    settleTerminal({
      runId: "dwfrun-artifacts-bounds",
      taskId: "dwfrun-artifacts-bounds",
      startedAt: new Date(),
      status: "completed",
      artifacts: [
        { id: "x".repeat(65), kind: "file", version: 1, itemCount: 0, versions: [] },
        { id: "half", kind: "file", version: 1.5, itemCount: 0, versions: [] },
        {
          id: "ok",
          kind: "file",
          version: 1,
          contentType: "a/".repeat(200),
          itemCount: 0,
          versions: [],
        },
        {
          id: "long",
          kind: "markdown",
          version: 1,
          title: "标".repeat(200),
          itemCount: 0,
          versions: [],
        },
      ],
    });
    await vi.waitFor(() => {
      expect(notifications).toHaveLength(1);
    });
    const meta = terminalMetaOf(notifications[0]);
    expect(meta?.artifacts?.map((artifact) => artifact.id)).toEqual(["ok", "long"]);
    expect(meta?.artifacts?.[0]).not.toHaveProperty("contentType");
    expect(meta?.artifacts?.[1]?.title).toHaveLength(120);
    expect(meta?.artifactsTruncated).toBe(true);
    expect(workflowNotificationMetaSchema.safeParse(meta).success).toBe(true);
  });

  it("Bash 后台通知不带 manifest 载荷（v1 只改 workflow 源）", async () => {
    const notifications: { text: string; originMeta?: unknown }[] = [];
    let resolveTerminal!: (snapshot: { status: string; result?: { exitCode?: number } }) => void;
    const terminalPromise = new Promise<{ status: string; result?: { exitCode?: number } }>(
      (resolve) => {
        resolveTerminal = resolve;
      },
    );
    const deps = {
      emitEvent: async () => {},
      enqueueBackgroundTaskNotification: (n: { text: string; originMeta?: unknown }) => {
        notifications.push(n);
      },
      runtimeTaskRegistry: new InMemoryRuntimeTaskRegistry(),
      executionPort: {
        waitForBackgroundTask: () => terminalPromise,
      },
      sessionId: createSessionId("dwf-bash-unit"),
    } as unknown as ToolExecutorDeps;
    const tracker = new BackgroundTaskTracker(deps);
    await tracker.trackBackgroundTask(
      { id: "call-bash", name: "Bash", input: { command: "sleep 1", description: "wait" } },
      { status: "backgrounded", backgroundTaskId: "bash-bg" },
      createRootTraceContext({ sessionId: createSessionId("dwf-bash") }),
      undefined,
    );
    resolveTerminal({ status: "completed", result: { exitCode: 0 } });
    await vi.waitFor(() => {
      expect(notifications).toHaveLength(1);
    });
    expect(notifications[0]!.originMeta).toEqual({
      backgroundSource: "bash",
      title: "wait",
      workId: "bash-bg",
    });
  });
});

describe("trackResumedDynamicWorkflowRun 终态残留复位（v4 路径回归）", () => {
  it("cancel 结算后再重臂同 runId：两轮终态各送达一次通知且内容可分辨", async () => {
    const { runtime, events, terminal } = makeRuntime("dwf-track-relive");
    const recorded: string[] = [];
    vi.spyOn(runtime, "enqueueBackgroundTaskNotification").mockImplementation(
      (notification: { text: string }) => {
        recorded.push(notification.text);
      },
    );

    await runtime.trackResumedDynamicWorkflowRun({ runId: "dwfrun-1", toolCallId: "call-origin" });
    terminal.resolve({
      runId: "dwfrun-1",
      taskId: "dwfrun-1",
      startedAt: new Date(),
      status: "cancelled",
    });
    await vi.waitFor(() => {
      expect(recorded).toHaveLength(1);
    });
    expect(recorded[0]).toMatch(/stopped/i);

    await runtime.trackResumedDynamicWorkflowRun({ runId: "dwfrun-1", toolCallId: "call-origin" });
    terminal.resolve({
      runId: "dwfrun-1",
      taskId: "dwfrun-1",
      startedAt: new Date(),
      status: "completed",
      output: "second life",
    });
    await vi.waitFor(() => {
      expect(recorded).toHaveLength(2);
    });
    expect(recorded[1]).toMatch(/completed/i);
    expect(recorded[1]).toContain("second life");

    const completions = events.filter(
      (event) => event.type === SessionEventType.BackgroundTaskCompleted,
    );
    expect(completions).toHaveLength(2);
  });
});

// ————————————————————————————————————————————————
// ————————————————————————————————————————————————
describe("ResumeWorkflowRun 的追踪分派", () => {
  
  function resumeOutput(runId: string): Record<string, unknown> {
    return {
      ok: true,
      runId,
      response: "resumed in the background",
      status: "backgrounded",
      backgroundTaskId: runId,
    };
  }

  it("走 dwf 生命周期：registry 在册、workflow 面板条目可取消、终态通知携产物与 reports", async () => {
    const { deps, events, notifications, registry, settleTerminal } =
      makeUnitFixture("dwfrun-feat");
    const tracker = new BackgroundTaskTracker(deps);
    await tracker.trackBackgroundTask(
      {
        id: "call-resume-1",
        name: RESUME_WORKFLOW_RUN_TOOL_NAME,
        input: { run_id: "dwfrun-feat" },
      },
      resumeOutput("dwfrun-feat"),
      createRootTraceContext({ sessionId: createSessionId("dwf-feat") }),
      undefined,
    );

    expect(registry.get("dwfrun-feat")).toMatchObject({
      taskType: "local_dynamic_workflow",
      type: "local_dynamic_workflow",
      status: "running",
      parentToolCallId: "call-resume-1",
    });
    const started = events.find((event) => event.type === SessionEventType.BackgroundTaskStarted);
    expect(started?.payload).toMatchObject({
      cancellable: true,
      status: "running",
      taskId: "dwfrun-feat",
      taskKind: "workflow",
      toolCallId: "call-resume-1",
      toolName: RESUME_WORKFLOW_RUN_TOOL_NAME,
    });
    expect(
      events.some(
        (event) =>
          event.type === SessionEventType.BackgroundTaskCompleted &&
          (event.payload as { status?: string }).status === "lost",
      ),
    ).toBe(false);

    settleTerminal({
      runId: "dwfrun-feat",
      taskId: "dwfrun-feat",
      startedAt: new Date(),
      status: "completed",
      output: "resumed artifact",
      reports: [{ title: "中途产物" }],
    });
    await vi.waitFor(() => {
      expect(notifications).toHaveLength(1);
    });
    expect(notifications[0]!.text).toContain("resumed artifact");
    expect(notifications[0]!.text).toContain("中途产物");
    expect(notifications[0]!.originMeta).toMatchObject({
      backgroundSource: "workflow",
      workId: "dwfrun-feat",
    });
  });

  it("parentToolCallId 首次登记为 resume 工具行 id，二次重臂按 existing 合并语义保持", async () => {
    const { deps, notifications, registry, settleTerminal } = makeUnitFixture("dwfrun-again");
    const tracker = new BackgroundTaskTracker(deps);
    await tracker.trackBackgroundTask(
      {
        id: "call-resume-a",
        name: RESUME_WORKFLOW_RUN_TOOL_NAME,
        input: { run_id: "dwfrun-again" },
      },
      resumeOutput("dwfrun-again"),
      createRootTraceContext({ sessionId: createSessionId("dwf-again") }),
      undefined,
    );
    expect(registry.get("dwfrun-again")?.parentToolCallId).toBe("call-resume-a");

    settleTerminal({
      runId: "dwfrun-again",
      taskId: "dwfrun-again",
      startedAt: new Date(),
      status: "cancelled",
    });
    await vi.waitFor(() => {
      expect(notifications).toHaveLength(1);
    });

    await tracker.trackBackgroundTask(
      {
        id: "call-resume-b",
        name: RESUME_WORKFLOW_RUN_TOOL_NAME,
        input: { run_id: "dwfrun-again" },
      },
      resumeOutput("dwfrun-again"),
      createRootTraceContext({ sessionId: createSessionId("dwf-again") }),
      undefined,
    );
    expect(registry.get("dwfrun-again")?.parentToolCallId).toBe("call-resume-a");
    expect(registry.get("dwfrun-again")?.status).toBe("running");
  });

  it("混合场景：CreateWorkflow 首链条目被 ResumeWorkflowRun 重臂后 join 键不断链", async () => {
    const { deps, registry } = makeUnitFixture("dwfrun-mixed");
    registry.register({
      taskId: "dwfrun-mixed",
      agentId: "dwfrun-mixed",
      agentType: "local_dynamic_workflow",
      description: "first life",
      startedAt: new Date(),
      status: "killed",
      type: "local_dynamic_workflow",
      isBackgrounded: true,
      notified: true,
      parentToolCallId: "call-create-origin",
    });

    const tracker = new BackgroundTaskTracker(deps);
    await tracker.trackBackgroundTask(
      {
        id: "call-resume-mixed",
        name: RESUME_WORKFLOW_RUN_TOOL_NAME,
        input: { run_id: "dwfrun-mixed" },
      },
      resumeOutput("dwfrun-mixed"),
      createRootTraceContext({ sessionId: createSessionId("dwf-mixed") }),
      undefined,
    );

    expect(registry.get("dwfrun-mixed")?.parentToolCallId).toBe("call-create-origin");
  });

  it("终态结算后再经 ResumeWorkflowRun 重臂同 runId：通知不被吞（fix 档行为的名字面）", async () => {
    const { deps, notifications, registry, settleTerminal } = makeUnitFixture("dwfrun-cycle");
    const tracker = new BackgroundTaskTracker(deps);
    const toolCall = {
      id: "call-resume-cycle",
      name: RESUME_WORKFLOW_RUN_TOOL_NAME,
      input: { run_id: "dwfrun-cycle" },
    };
    const traceContext = createRootTraceContext({ sessionId: createSessionId("dwf-cycle") });

    await tracker.trackBackgroundTask(
      toolCall,
      resumeOutput("dwfrun-cycle"),
      traceContext,
      undefined,
    );
    settleTerminal({
      runId: "dwfrun-cycle",
      taskId: "dwfrun-cycle",
      startedAt: new Date(),
      status: "cancelled",
    });
    await vi.waitFor(() => {
      expect(notifications).toHaveLength(1);
    });

    await tracker.trackBackgroundTask(
      toolCall,
      resumeOutput("dwfrun-cycle"),
      traceContext,
      undefined,
    );
    settleTerminal({
      runId: "dwfrun-cycle",
      taskId: "dwfrun-cycle",
      startedAt: new Date(),
      status: "completed",
      output: "third life",
    });
    await vi.waitFor(() => {
      expect(notifications).toHaveLength(2);
    });
    expect(notifications[1]!.text).toContain("third life");
    expect(registry.get("dwfrun-cycle")?.status).toBe("completed");
  });
});

// ————————————————————————————————————————————————
// ————————————————————————————————————————————————
describe("直接启动合成 toolCall 的通知同形", () => {
  it("launch- 描述子（含 saved 袋）与工具路径产出同一 subject / originMeta", async () => {
    const tool = makeUnitFixture("dwfrun-parity");
    const toolTracker = new BackgroundTaskTracker(tool.deps);
    await toolTracker.trackBackgroundTask(
      { id: "tool_abc", name: CREATE_WORKFLOW_TOOL_NAME, input: { name: "reporter" } },
      { status: "backgrounded", backgroundTaskId: "dwfrun-parity" },
      createRootTraceContext({ sessionId: createSessionId("dwf-parity-tool") }),
      undefined,
    );
    tool.settleTerminal({
      runId: "dwfrun-parity",
      taskId: "dwfrun-parity",
      startedAt: new Date(),
      status: "completed",
      output: "same artifact",
    });
    await vi.waitFor(() => {
      expect(tool.notifications).toHaveLength(1);
    });

    const launch = makeUnitFixture("dwfrun-parity-2");
    const launchTracker = new BackgroundTaskTracker(launch.deps);
    const launchCall: ExecutableToolCall = {
      id: "launch-uuid-1",
      name: CREATE_WORKFLOW_TOOL_NAME,
      input: {
        name: "reporter",
        saved: { name: "reporter", scope: "project", args: { pr: "42" } },
      },
    };
    await launchTracker.trackBackgroundTask(
      launchCall,
      { status: "backgrounded", backgroundTaskId: "dwfrun-parity-2" },
      createRootTraceContext({ sessionId: createSessionId("dwf-parity-launch") }),
      undefined,
    );
    launch.settleTerminal({
      runId: "dwfrun-parity-2",
      taskId: "dwfrun-parity-2",
      startedAt: new Date(),
      status: "completed",
      output: "same artifact",
    });
    await vi.waitFor(() => {
      expect(launch.notifications).toHaveLength(1);
    });

    const toolMeta = tool.notifications[0]!.originMeta as {
      title?: string;
      backgroundSource?: string;
    };
    const launchMeta = launch.notifications[0]!.originMeta as {
      title?: string;
      backgroundSource?: string;
    };
    expect(launchMeta.title).toBe("reporter");
    expect(launchMeta.title).toBe(toolMeta.title);
    expect(launchMeta.backgroundSource).toBe("workflow");
    expect(launchMeta.backgroundSource).toBe(toolMeta.backgroundSource);
    expect(terminalMetaOf(launch.notifications[0])).toMatchObject({
      kind: "terminal",
      status: "completed",
      summary: "reporter",
    });
    expect(terminalMetaOf(tool.notifications[0])?.summary).toBe(
      terminalMetaOf(launch.notifications[0])?.summary,
    );
  });
});

describe("用户取消的 run：终态通知说清是谁停的", () => {
  function recordNotifications(runtime: AgentRuntime): string[] {
    const recorded: string[] = [];
    vi.spyOn(runtime, "enqueueBackgroundTaskNotification").mockImplementation(
      (notification: { text: string }) => {
        recorded.push(notification.text);
      },
    );
    return recorded;
  }

  it("GUI cancel (cancelBackgroundTask) → summary \"stopped by the user\" + <stop-reason>user</stop-reason> + instructions not to resume", async () => {
    const { runtime, terminal } = makeRuntime("dwf-track-user-cancel");
    const recorded = recordNotifications(runtime);
    await runtime.trackResumedDynamicWorkflowRun({ runId: "dwfrun-1", toolCallId: "call-origin" });

    await runtime.cancelBackgroundTask("dwfrun-1");
    terminal.resolve({
      runId: "dwfrun-1",
      taskId: "dwfrun-1",
      startedAt: new Date(),
      status: "cancelled",
      runStatus: "stopped",
      stopReason: "user",
    });
    await vi.waitFor(() => {
      expect(recorded).toHaveLength(1);
    });
    const text = recorded[0]!;
    expect(text).toContain("was stopped by the user.");
    expect(text).toContain("<status>stopped</status>");
    expect(text).toContain("<stop-reason>user</stop-reason>");
    expect(text).toContain("The user stopped this workflow on purpose.");
    expect(text).toMatch(/Do not resume it with ResumeWorkflowRun/);
    expect(text).not.toContain("resumable as-is");
  });

  it("Model TaskStop (initiator model) → \"stopped by you\"; neutral phrasing for stops without initiator", async () => {
    const stoppedByModel = makeRuntime("dwf-track-model-stop");
    const recordedModel = recordNotifications(stoppedByModel.runtime);
    await stoppedByModel.runtime.trackResumedDynamicWorkflowRun({ runId: "dwfrun-1" });
    await stoppedByModel.runtime.stopBackgroundTask("dwfrun-1", { initiator: "model" });
    stoppedByModel.terminal.resolve({
      runId: "dwfrun-1",
      taskId: "dwfrun-1",
      startedAt: new Date(),
      status: "cancelled",
    });
    await vi.waitFor(() => {
      expect(recordedModel).toHaveLength(1);
    });
    expect(recordedModel[0]).toContain("was stopped by you (TaskStop).");
    expect(recordedModel[0]).toContain("<stop-reason>model</stop-reason>");
    expect(recordedModel[0]).toContain("If you stopped it to fix the script");
    expect(recordedModel[0]).not.toContain("resumable as-is");

    const neutral = makeRuntime("dwf-track-neutral-stop");
    const recordedNeutral = recordNotifications(neutral.runtime);
    await neutral.runtime.trackResumedDynamicWorkflowRun({ runId: "dwfrun-1" });
    neutral.terminal.resolve({
      runId: "dwfrun-1",
      taskId: "dwfrun-1",
      startedAt: new Date(),
      status: "cancelled",
    });
    await vi.waitFor(() => {
      expect(recordedNeutral).toHaveLength(1);
    });
    expect(recordedNeutral[0]).toContain("was stopped.");
    expect(recordedNeutral[0]).not.toContain("<stop-reason>");
  });

  it("重臂（resume 新生命）复位 stopInitiator：上一轮是谁停的与新生命无关", async () => {
    const { runtime, terminal } = makeRuntime("dwf-track-rearm-initiator");
    recordNotifications(runtime);
    const registry = (runtime as unknown as { runtimeTaskRegistry: InMemoryRuntimeTaskRegistry })
      .runtimeTaskRegistry;
    await runtime.trackResumedDynamicWorkflowRun({ runId: "dwfrun-1", toolCallId: "call-origin" });
    await runtime.cancelBackgroundTask("dwfrun-1");
    expect(registry.get("dwfrun-1")?.stopInitiator).toBe("user");
    terminal.resolve({
      runId: "dwfrun-1",
      taskId: "dwfrun-1",
      startedAt: new Date(),
      status: "cancelled",
    });
    await vi.waitFor(() => {
      expect(registry.get("dwfrun-1")?.status).toBe("killed");
    });

    await runtime.trackResumedDynamicWorkflowRun({ runId: "dwfrun-1", toolCallId: "call-origin" });
    expect(registry.get("dwfrun-1")?.status).toBe("running");
    expect(registry.get("dwfrun-1")?.stopInitiator).toBeUndefined();
  });
});
