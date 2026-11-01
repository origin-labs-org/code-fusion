//
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  SessionEventType,
  WORKFLOW_DRAFTS_DIR,
  createSessionId,
  type CreateSessionInput,
  type DynamicWorkflowRunAmendRequest,
  type DynamicWorkflowRunRetuneRequest,
  type DynamicWorkflowRunRetuneResult,
  type DynamicWorkflowRunSnapshot,
  type MessageInfo,
  type MessagePart,
  type MessageWithParts,
  type ModelCatalogPort,
  type SessionEvent,
  type SessionInfo,
} from "@origin-ai/cf-contracts";
import { AgentRuntime } from "../src/index.js";
import { createRuntimeCommandId } from "../src/runtime/command-queue.js";
import { drainPendingRuntimeCommandsForActiveLoop } from "../src/runtime/methods/runtime-command-active-loop.js";
import { buildSettingsMessageText } from "../src/runtime/methods/dynamic-workflow-run-settings.js";
import { createTestSessionEventStore } from "./test-event-store.js";

const STORED_SCRIPT = [
  'phase("plan");',
  'const plan = await agent("planner").ask<string>("plan it");',
  "return plan;",
].join("\n");
const BROKEN_SCRIPT = 'const x: number = "nope";\nreturn x;';
const PREVIOUS = "dwfrun-prev";

interface RecordingStore {
  createdSessions: CreateSessionInput[];
  savedMessages: MessageInfo[];
  savedParts: MessagePart[];
}

function createRecordingStore(): RecordingStore & Record<string, unknown> {
  const createdSessions: CreateSessionInput[] = [];
  const savedMessages: MessageInfo[] = [];
  const savedParts: MessagePart[] = [];
  const sessions = new Map<string, SessionInfo>();
  return {
    createdSessions,
    savedMessages,
    savedParts,
    async createSession(input: CreateSessionInput) {
      createdSessions.push(input);
      const now = Date.now();
      const session = {
        ...input,
        taskType: input.taskType ?? "interactive",
        time: { created: now, updated: now },
      } as SessionInfo;
      sessions.set(input.id, session);
      return session;
    },
    async getSession(id: string) {
      return sessions.get(id) ?? null;
    },
    async listSessions() {
      return Array.from(sessions.values());
    },
    async updateSession(input: { id: string }) {
      return sessions.get(input.id) ?? null;
    },
    async saveMessage(input: MessageInfo) {
      savedMessages.push(input);
    },
    async savePart(input: MessagePart) {
      savedParts.push(input);
    },
    async messages(input: { sessionID: string }): Promise<MessageWithParts[]> {
      return savedMessages
        .filter((message) => message.sessionID === input.sessionID)
        .map((info) => ({
          info,
          parts: savedParts.filter((part) => part.messageID === info.id),
        }));
    },
  };
}

const CATALOG: ModelCatalogPort = {
  listModels: () => [
    { providerId: "bigmodel", modelId: "GLM-5.3", reasoningLevels: [], current: true },
    { providerId: "bigmodel", modelId: "GLM-5.3-Flash", reasoningLevels: [] },
  ],
};

const SETTINGS_CWD = mkdtempSync(join(tmpdir(), "dwf-settings-"));
afterAll(() => rmSync(SETTINGS_CWD, { recursive: true, force: true }));

function makeRuntime(options: {
  name: string;
  snapshot?: Partial<DynamicWorkflowRunSnapshot> | null;
  script?: string | null;
  defaultConcurrency?: number;
  catalog?: ModelCatalogPort | null;
  amend?: (
    request: DynamicWorkflowRunAmendRequest,
  ) =>
    | { ok: true; runId: string; supersededRunId?: string }
    | { ok: false; reason: "run_not_found" | "missing_boundaries" };
  
  retune?: DynamicWorkflowRunRetuneResult;
}): {
  runtime: AgentRuntime;
  events: SessionEvent[];
  store: RecordingStore;
  amends: DynamicWorkflowRunAmendRequest[];
  retunes: DynamicWorkflowRunRetuneRequest[];
  getScriptCalls: string[];
  sessionId: string;
} {
  const sessionId = createSessionId(options.name);
  const amends: DynamicWorkflowRunAmendRequest[] = [];
  const retunes: DynamicWorkflowRunRetuneRequest[] = [];
  const getScriptCalls: string[] = [];
  const store = createRecordingStore();
  const snapshot: DynamicWorkflowRunSnapshot | undefined =
    options.snapshot === null
      ? undefined
      : ({
          runId: PREVIOUS,
          taskId: PREVIOUS,
          startedAt: new Date(),
          status: "running",
          name: "triage",
          parentSessionId: sessionId,
          ...options.snapshot,
        } as DynamicWorkflowRunSnapshot);
  const runtime = new AgentRuntime(
    sessionId,
    { agentName: "dwf-settings-test", workingDirectory: SETTINGS_CWD },
    {
      eventStore: createTestSessionEventStore(),
      sessionStore: store as never,
      modelAdapter: {} as never,
      ...(options.catalog === null ? {} : { modelCatalogPort: options.catalog ?? CATALOG }),
      dynamicWorkflowRunPort: {
        async submit() {
          throw new Error("settings never submit");
        },
        async amend(request: DynamicWorkflowRunAmendRequest) {
          amends.push(request);
          return options.amend
            ? options.amend(request)
            : { ok: true, runId: "dwfrun-next", supersededRunId: PREVIOUS };
        },
        async getTask(runId: string) {
          if (runId === PREVIOUS) return snapshot;
          return {
            runId,
            taskId: runId,
            startedAt: new Date(),
            status: "running",
            parentSessionId: sessionId,
          } as DynamicWorkflowRunSnapshot;
        },
        async getScript(runId: string) {
          getScriptCalls.push(runId);
          if (runId !== PREVIOUS || options.script === null) return undefined;
          return options.script ?? STORED_SCRIPT;
        },
        ...(options.retune === undefined
          ? {}
          : {
              async retuneConcurrency(request: DynamicWorkflowRunRetuneRequest) {
                retunes.push(request);
                return options.retune as DynamicWorkflowRunRetuneResult;
              },
            }),
        defaultConcurrency: () => options.defaultConcurrency ?? 13,
        waitForTask: () => new Promise(() => {}),
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
  return { runtime, events, store, amends, retunes, getScriptCalls, sessionId };
}

async function settleQueue(events: SessionEvent[]): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (events.some((event) => event.type === SessionEventType.TurnComplete)) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("amendWorkflowRunSettings — 拒绝在 port.amend 之前", () => {
  it.each([
    ["not_found：没有这个 run", { snapshot: null }, { maxConcurrency: 4 }, "not_found"],
    [
      "not_found：run 属于别的会话",
      { snapshot: { parentSessionId: "sess_other" } },
      { maxConcurrency: 4 },
      "not_found",
    ],
    [
      "not_configurable：已完成",
      { snapshot: { runStatus: "completed", status: "completed" } },
      { maxConcurrency: 4 },
      "not_configurable",
    ],
    [
      "not_configurable：已被替代",
      { snapshot: { runStatus: "stopped", supersededBy: "dwfrun-x" } },
      { maxConcurrency: 4 },
      "not_configurable",
    ],
    ["script_missing：没有存下的脚本", { script: null }, { maxConcurrency: 4 }, "script_missing"],
    [
      "model_unavailable：目录里没有这个模型",
      {},
      { subagentModel: "bigmodel/GLM-9" },
      "model_unavailable",
    ],
    [
      "model_unavailable：没有目录却要换模型",
      { catalog: null },
      { subagentModel: "bigmodel/GLM-5.3-Flash" },
      "model_unavailable",
    ],
    ["unchanged：什么都没传", {}, {}, "unchanged"],
    [
      "unchanged：设成现在的值",
      { snapshot: { maxConcurrency: 4, subagentModel: "bigmodel/GLM-5.3-Flash" } },
      { maxConcurrency: 4, subagentModel: "bigmodel/GLM-5.3-Flash" },
      "unchanged",
    ],
    [
      "unchanged：停在默认并发上 = 本来就没有自己的界",
      { defaultConcurrency: 13 },
      { maxConcurrency: 13 },
      "unchanged",
    ],
    [
      "compile_failed：存下的脚本编不过",
      { script: BROKEN_SCRIPT },
      { maxConcurrency: 4 },
      "compile_failed",
    ],
  ] as const)("%s", async (_case, setup, change, reason) => {
    const { runtime, amends, store, events } = makeRuntime({
      name: `reject-${reason}`,
      ...(setup as Parameters<typeof makeRuntime>[0]),
    });

    const result = await runtime.amendWorkflowRunSettings({ runId: PREVIOUS, ...change });

    expect(result).toMatchObject({ ok: false, reason });
    expect(amends).toHaveLength(0);
    expect(store.savedMessages).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("编译诊断与模型解析诊断随 message 走", async () => {
    const broken = makeRuntime({ name: "diag-compile", script: BROKEN_SCRIPT });
    const compile = await broken.runtime.amendWorkflowRunSettings({
      runId: PREVIOUS,
      maxConcurrency: 4,
    });
    expect((compile as { message?: string }).message).toContain("not assignable");

    const unknown = makeRuntime({ name: "diag-model" });
    const model = await unknown.runtime.amendWorkflowRunSettings({
      runId: PREVIOUS,
      subagentModel: "bigmodel/GLM-9",
    });
    expect((model as { message?: string }).message).toBeTruthy();
  });

  it.each([
    ["run_not_found", "not_found"],
    ["missing_boundaries", "missing_boundaries"],
  ] as const)("端口拒绝 %s → %s，不记设置轮", async (portReason, reason) => {
    const { runtime, store, events } = makeRuntime({
      name: `port-${portReason}`,
      amend: () => ({ ok: false, reason: portReason }),
    });

    const result = await runtime.amendWorkflowRunSettings({ runId: PREVIOUS, maxConcurrency: 4 });

    expect(result).toEqual({ ok: false, reason });
    expect(store.savedMessages).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("端口抛错 → start_failed，message 是原因", async () => {
    const { runtime } = makeRuntime({
      name: "port-throw",
      amend: () => {
        throw new Error("journal locked");
      },
    });

    const result = await runtime.amendWorkflowRunSettings({ runId: PREVIOUS, maxConcurrency: 4 });

    expect(result).toEqual({ ok: false, reason: "start_failed", message: "journal locked" });
  });
});

describe("amendWorkflowRunSettings — 脚本点名的模型", () => {
  const JUDGED_SCRIPT = [
    'phase("judge");',
    'const verdict = await agent("评审员", { model: "GLM-5.3-Flash" }).ask<string>("judge");',
    "return verdict;",
  ].join("\n");

  it("Pass predecessor\'s binding to port.amend (not re-resolved by name)", async () => {
    const { runtime, amends } = makeRuntime({
      name: "models-kept",
      script: JUDGED_SCRIPT,
      snapshot: { modelBindings: { "GLM-5.3-Flash": "bigmodel/GLM-5.3" } },
    });
    const result = await runtime.amendWorkflowRunSettings({ runId: PREVIOUS, maxConcurrency: 4 });
    expect(result).toMatchObject({ ok: true });
    expect(amends[0]!.modelBindings).toEqual({
      "GLM-5.3-Flash": { providerId: "bigmodel", modelId: "GLM-5.3" },
    });
  });

  it("沿用的模型已不在目录里：model_unavailable，诊断随 message 走，零 amend", async () => {
    const { runtime, amends, store } = makeRuntime({
      name: "models-gone",
      script: JUDGED_SCRIPT,
      snapshot: { modelBindings: { "GLM-5.3-Flash": "retired/GLM-4" } },
    });
    const result = await runtime.amendWorkflowRunSettings({ runId: PREVIOUS, maxConcurrency: 4 });
    expect(result).toMatchObject({ ok: false, reason: "model_unavailable" });
    expect((result as { message?: string }).message).toContain("retired/GLM-4");
    expect(amends).toHaveLength(0);
    expect(store.savedMessages).toHaveLength(0);
  });
});

describe("amendWorkflowRunSettings — 成功路径", () => {
  it("沿用脚本与实参、带上新设置，登记合成 AmendWorkflow，并落一条设置轮", async () => {
    const { runtime, amends, store, events, sessionId } = makeRuntime({
      name: "ok",
      snapshot: { maxConcurrency: 8 },
    });

    const result = await runtime.amendWorkflowRunSettings({
      runId: PREVIOUS,
      subagentModel: "bigmodel/GLM-5.3-Flash",
      maxConcurrency: 4,
    });

    expect(result).toMatchObject({ ok: true, runId: "dwfrun-next", supersededRunId: PREVIOUS });
    const toolCallId = (result as { toolCallId: string }).toolCallId;
    expect(toolCallId).toMatch(/^settings-/);

    expect(amends).toHaveLength(1);
    expect(amends[0]).toMatchObject({
      scriptText: STORED_SCRIPT,
      predecessorRunId: PREVIOUS,
      parentSessionId: sessionId,
      toolCallId,
      maxConcurrency: 4,
      subagentModel: { providerId: "bigmodel", modelId: "GLM-5.3-Flash" },
      inheritArgs: true,
      phaseNames: ["plan"],
    });
    expect(amends[0]!.name).toBeUndefined();

    const started = events.find((event) => event.type === SessionEventType.BackgroundTaskStarted);
    expect(started?.payload).toMatchObject({
      cancellable: true,
      taskId: "dwfrun-next",
      taskKind: "workflow",
      toolCallId,
      toolName: "AmendWorkflow",
    });

    await settleQueue(events);
    const message = store.savedMessages.find((m) => m.source === "workflow_launch");
    expect(message).toMatchObject({ role: "user", synthetic: true, visibility: "user-visible" });
    const meta = message?.metadata?.workflowLaunch as Record<string, unknown> | undefined;
    expect(meta).toMatchObject({
      runId: "dwfrun-next",
      toolCallId,
      name: "triage",
      amend: {
        predecessorRunId: PREVIOUS,
        subagentModel: { to: "bigmodel/GLM-5.3-Flash" },
        maxConcurrency: { from: 8, to: 4 },
        ceiling: 13,
      },
    });
    expect(meta).not.toHaveProperty("scope");
    expect(meta).not.toHaveProperty("path");
    expect(meta).not.toHaveProperty("script");
    expect((meta?.display as { kind?: string } | undefined)?.kind).toBe("create_workflow");

    const turnStarted = events.find((event) => event.type === SessionEventType.TurnStarted);
    expect(turnStarted?.payload).toMatchObject({
      executionKind: "controlOnly",
      inputSource: "workflow_launch",
      workflowLaunch: { runId: "dwfrun-next", amend: { predecessorRunId: PREVIOUS } },
    });
    const part = store.savedParts.find(
      (candidate) => candidate.messageID === message?.id && candidate.type === "text",
    );
    expect((part as { text?: string } | undefined)?.text).toContain(
      `Changed the settings of workflow run ${PREVIOUS} ("triage") from the GUI`,
    );
  });

  it("null 回到默认：模型回会话模型、界回默认并发；端口两个键都缺席", async () => {
    const { runtime, amends, store, events } = makeRuntime({
      name: "reset",
      snapshot: { maxConcurrency: 4, subagentModel: "bigmodel/GLM-5.3-Flash" },
    });

    const result = await runtime.amendWorkflowRunSettings({
      runId: PREVIOUS,
      subagentModel: null,
      maxConcurrency: null,
    });

    expect(result.ok).toBe(true);
    expect(amends[0]).not.toHaveProperty("maxConcurrency");
    expect(amends[0]).not.toHaveProperty("subagentModel");
    await settleQueue(events);
    const meta = store.savedMessages.find((m) => m.source === "workflow_launch")?.metadata
      ?.workflowLaunch as { amend?: Record<string, unknown> } | undefined;
    expect(meta?.amend).toEqual({
      predecessorRunId: PREVIOUS,
      subagentModel: { from: "bigmodel/GLM-5.3-Flash" },
      maxConcurrency: { from: 4 },
      ceiling: 13,
    });
  });

  it("When changing only concurrency, retain predecessor\'s model (re-resolved), settings turn records only the changed item", async () => {
    const { runtime, amends, store, events } = makeRuntime({
      name: "keep-model",
      snapshot: { subagentModel: "bigmodel/GLM-5.3-Flash" },
    });

    await runtime.amendWorkflowRunSettings({ runId: PREVIOUS, maxConcurrency: 2 });

    expect(amends[0]).toMatchObject({
      maxConcurrency: 2,
      subagentModel: { providerId: "bigmodel", modelId: "GLM-5.3-Flash" },
    });
    await settleQueue(events);
    const meta = store.savedMessages.find((m) => m.source === "workflow_launch")?.metadata
      ?.workflowLaunch as { amend?: Record<string, unknown> } | undefined;
    expect(meta?.amend).not.toHaveProperty("subagentModel");
    expect(meta?.amend).toMatchObject({ maxConcurrency: { to: 2 } });
  });

  it("主代理在一轮里：设置轮排队，活动轮的吸收在它这里停下，后到的通知排在它后面", async () => {
    const { runtime, store } = makeRuntime({ name: "busy" });
    const internal = runtime as unknown as {
      runtimeCommandDrainActive: boolean;
      runtimeCommandQueue: { snapshot(): readonly { mode: string }[] };
      enqueueRuntimeCommand(command: unknown): void;
      branchGeneration: number;
      rootTraceContext: unknown;
    };
    internal.runtimeCommandDrainActive = true;

    const result = await runtime.amendWorkflowRunSettings({ runId: PREVIOUS, maxConcurrency: 4 });
    expect(result.ok).toBe(true);
    internal.enqueueRuntimeCommand({
      branchGeneration: internal.branchGeneration,
      createdAt: new Date(),
      id: createRuntimeCommandId(),
      mode: "task-notification",
      priority: "next",
      source: "background_task",
      taskId: "dwfrun-next",
      text: "run dwfrun-next completed",
      traceContext: internal.rootTraceContext,
    });

    expect(store.savedMessages).toHaveLength(0);
    expect(internal.runtimeCommandQueue.snapshot().map((command) => command.mode)).toEqual([
      "control-only-turn",
      "task-notification",
    ]);
    const drained = await drainPendingRuntimeCommandsForActiveLoop.call(runtime as never);
    expect(drained.drained).toBe(0);
    expect(internal.runtimeCommandQueue.snapshot()).toHaveLength(2);
  });
});

describe("amendWorkflowRunSettings — 新 run 的脚本文件", () => {
  it("Predecessor\'s script file matches these bytes: new run keeps referencing it without writing a new draft", async () => {
    const dir = join(SETTINGS_CWD, WORKFLOW_DRAFTS_DIR);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "kept-by-settings.dwf.ts");
    writeFileSync(file, STORED_SCRIPT, "utf8");
    const { runtime, amends } = makeRuntime({ name: "keep-file", snapshot: { scriptPath: file } });

    const result = await runtime.amendWorkflowRunSettings({ runId: PREVIOUS, maxConcurrency: 4 });

    expect(result).toMatchObject({ ok: true });
    expect(amends[0]!.scriptPath).toBe(file);
  });

  it("Predecessor\'s file was modified (or never recorded): write and record a new draft containing archived script", async () => {
    const dir = join(SETTINGS_CWD, WORKFLOW_DRAFTS_DIR);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "edited-since.dwf.ts");
    writeFileSync(file, `${STORED_SCRIPT}\n// edited\n`, "utf8");
    const { runtime, amends } = makeRuntime({
      name: "diverged-file",
      snapshot: { scriptPath: file, name: "settings diverged" },
    });

    const result = await runtime.amendWorkflowRunSettings({ runId: PREVIOUS, maxConcurrency: 4 });

    expect(result).toMatchObject({ ok: true });
    const recorded = amends[0]!.scriptPath;
    expect(recorded).toBe(join(dir, "settings-diverged.dwf.ts"));
    expect(readFileSync(recorded!, "utf8")).toBe(STORED_SCRIPT);
    expect(readFileSync(file, "utf8")).toContain("// edited");
  });

  it("拒绝的调用不落草稿：直到 port.amend 之前都是零副作用", async () => {
    const { runtime, amends } = makeRuntime({
      name: "unchanged-no-draft",
      snapshot: { name: "never written", maxConcurrency: 4 },
    });

    const result = await runtime.amendWorkflowRunSettings({ runId: PREVIOUS, maxConcurrency: 4 });

    expect(result).toMatchObject({ ok: false, reason: "unchanged" });
    expect(amends).toHaveLength(0);
    expect(() =>
      readFileSync(join(SETTINGS_CWD, WORKFLOW_DRAFTS_DIR, "never-written.dwf.ts")),
    ).toThrow();
  });
});

describe("amendWorkflowRunSettings — 无名 run", () => {
  it("前驱没有名字：设置轮元数据与合成追踪都不带名字，规范句也不编一个", async () => {
    const { runtime, store, events } = makeRuntime({
      name: "unnamed",
      snapshot: { name: undefined },
    });

    const result = await runtime.amendWorkflowRunSettings({ runId: PREVIOUS, maxConcurrency: 4 });
    expect(result.ok).toBe(true);

    const started = events.find((event) => event.type === SessionEventType.BackgroundTaskStarted);
    expect((started?.payload as { description?: string } | undefined)?.description).not.toContain(
      "run dwfrun",
    );
    await settleQueue(events);
    const message = store.savedMessages.find((m) => m.source === "workflow_launch");
    expect(message?.metadata?.workflowLaunch).not.toHaveProperty("name");
    const part = store.savedParts.find(
      (candidate) => candidate.messageID === message?.id && candidate.type === "text",
    );
    expect((part as { text?: string } | undefined)?.text).toContain(
      `Changed the settings of workflow run ${PREVIOUS} from the GUI`,
    );
  });
});

describe("amendWorkflowRunSettings — 只改并发即就地生效", () => {
  it("同一个 runId、无 supersededRunId、不 amend、不读脚本，设置轮记下这一手", async () => {
    const { runtime, amends, retunes, getScriptCalls, store, events } = makeRuntime({
      name: "retune-ok",
      snapshot: { maxConcurrency: 8 },
      retune: { ok: true, maxConcurrency: 4, previous: 8, defaultConcurrency: 13 },
    });

    const result = await runtime.amendWorkflowRunSettings({ runId: PREVIOUS, maxConcurrency: 4 });

    expect(result).toEqual({ ok: true, runId: PREVIOUS, toolCallId: expect.any(String) });
    expect((result as { toolCallId: string }).toolCallId).toMatch(/^settings-/);
    expect(retunes).toEqual([{ runId: PREVIOUS, maxConcurrency: 4 }]);
    expect(amends).toHaveLength(0);
    expect(getScriptCalls).toHaveLength(0);
    expect(events.find((event) => event.type === SessionEventType.BackgroundTaskStarted)).toBe(
      undefined,
    );

    await settleQueue(events);
    const message = store.savedMessages.find((m) => m.source === "workflow_launch");
    const meta = message?.metadata?.workflowLaunch as Record<string, unknown> | undefined;
    expect(meta).toMatchObject({
      runId: PREVIOUS,
      name: "triage",
      amend: { maxConcurrency: { from: 8, to: 4 }, ceiling: 13 },
    });
    expect(meta?.amend).not.toHaveProperty("predecessorRunId");
    expect(meta).not.toHaveProperty("display");
    const part = store.savedParts.find(
      (candidate) => candidate.messageID === message?.id && candidate.type === "text",
    );
    const text = (part as { text?: string } | undefined)?.text ?? "";
    expect(text).toContain(
      `Changed the settings of workflow run ${PREVIOUS} ("triage") from the GUI`,
    );
    expect(text).toContain("at most 4 of its subagents run at once");
    expect(text).toContain("keeps running under the new limit");
    expect(text).not.toContain("supersedes");
  });

  it("回到默认并发：等于默认的那一端缺席，文案说上限回到默认", async () => {
    const { runtime, retunes, store, events } = makeRuntime({
      name: "retune-default",
      snapshot: { maxConcurrency: 4 },
      retune: { ok: true, maxConcurrency: 13, previous: 4, defaultConcurrency: 13 },
    });

    const result = await runtime.amendWorkflowRunSettings({
      runId: PREVIOUS,
      maxConcurrency: null,
    });

    expect(result).toMatchObject({ ok: true, runId: PREVIOUS });
    expect(retunes).toEqual([{ runId: PREVIOUS, maxConcurrency: null }]);
    await settleQueue(events);
    const message = store.savedMessages.find((m) => m.source === "workflow_launch");
    const meta = message?.metadata?.workflowLaunch as { amend?: Record<string, unknown> };
    expect(meta.amend).toEqual({ maxConcurrency: { from: 4 }, ceiling: 13 });
    const part = store.savedParts.find(
      (candidate) => candidate.messageID === message?.id && candidate.type === "text",
    );
    expect((part as { text?: string } | undefined)?.text).toContain(
      "the limit on subagents at once is back to the default",
    );
  });

  it("调到默认并发之上：就地生效，两端都是数", async () => {
    const { runtime, retunes, store, events } = makeRuntime({
      name: "retune-raise",
      snapshot: {},
      retune: { ok: true, maxConcurrency: 40, previous: 13, defaultConcurrency: 13 },
    });

    const result = await runtime.amendWorkflowRunSettings({ runId: PREVIOUS, maxConcurrency: 40 });

    expect(result).toMatchObject({ ok: true, runId: PREVIOUS });
    expect(retunes).toEqual([{ runId: PREVIOUS, maxConcurrency: 40 }]);
    await settleQueue(events);
    const message = store.savedMessages.find((m) => m.source === "workflow_launch");
    const meta = message?.metadata?.workflowLaunch as { amend?: Record<string, unknown> };
    expect(meta.amend).toEqual({ maxConcurrency: { to: 40 }, ceiling: 13 });
  });

  it("端口答 unchanged（值在分叉之后被挪过）→ 既有的 unchanged 拒绝", async () => {
    const { runtime, amends, store, events } = makeRuntime({
      name: "retune-unchanged",
      snapshot: { maxConcurrency: 8 },
      retune: { ok: false, reason: "unchanged", current: 4 },
    });

    const result = await runtime.amendWorkflowRunSettings({ runId: PREVIOUS, maxConcurrency: 4 });

    expect(result).toMatchObject({ ok: false, reason: "unchanged" });
    expect(amends).toHaveLength(0);
    expect(store.savedMessages).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("Port answers not_live → cleanly falls back to today\'s revision", async () => {
    const { runtime, amends, retunes, getScriptCalls } = makeRuntime({
      name: "retune-not-live",
      snapshot: { maxConcurrency: 8 },
      retune: { ok: false, reason: "not_live" },
    });

    const result = await runtime.amendWorkflowRunSettings({ runId: PREVIOUS, maxConcurrency: 4 });

    expect(retunes).toHaveLength(1);
    expect(result).toMatchObject({ ok: true, runId: "dwfrun-next", supersededRunId: PREVIOUS });
    expect(getScriptCalls).toEqual([PREVIOUS]);
    expect(amends).toHaveLength(1);
    expect(amends[0]?.maxConcurrency).toBe(4);
  });

  it("Switch model simultaneously → remains a revision, port\'s retuneConcurrency untouched", async () => {
    const { runtime, amends, retunes } = makeRuntime({
      name: "retune-with-model",
      snapshot: { maxConcurrency: 8 },
      retune: { ok: true, maxConcurrency: 4, previous: 8, defaultConcurrency: 13 },
    });

    const result = await runtime.amendWorkflowRunSettings({
      runId: PREVIOUS,
      maxConcurrency: 4,
      subagentModel: "bigmodel/GLM-5.3-Flash",
    });

    expect(retunes).toHaveLength(0);
    expect(result).toMatchObject({ ok: true, runId: "dwfrun-next" });
    expect(amends).toHaveLength(1);
  });

  it("端口没有 retuneConcurrency（老宿主）→ 照旧一次修订", async () => {
    const { runtime, amends } = makeRuntime({
      name: "retune-old-host",
      snapshot: { maxConcurrency: 8 },
    });

    const result = await runtime.amendWorkflowRunSettings({ runId: PREVIOUS, maxConcurrency: 4 });

    expect(result).toMatchObject({ ok: true, runId: "dwfrun-next" });
    expect(amends).toHaveLength(1);
  });
});

describe("buildSettingsMessageText", () => {
  it("只说改过的设置；两个 null 各有一句；已结算的前驱读作 takes over from", () => {
    const text = buildSettingsMessageText({
      name: "triage",
      previous: "dwfrun-a",
      runId: "dwfrun-b",
      superseded: false,
      amend: {
        predecessorRunId: "dwfrun-a",
        subagentModel: { from: "bigmodel/GLM-5.3" },
        maxConcurrency: { from: 4 },
      },
    });
    expect(text).toContain("its subagents are back on the session model");
    expect(text).toContain("the limit on subagents at once is back to the default");
    expect(text).toContain("which takes over from run dwfrun-a");
    expect(text).toContain("do not amend, resume or restart it");
  });

  it("就地生效：只点名一个 run，说它继续在跑、没有新 run", () => {
    const text = buildSettingsMessageText({
      name: "triage",
      previous: "dwfrun-a",
      runId: "dwfrun-a",
      superseded: false,
      amend: { maxConcurrency: { from: 8, to: 2 }, ceiling: 13 },
    });
    expect(text).toContain('Changed the settings of workflow run dwfrun-a ("triage") from the GUI');
    expect(text).toContain("at most 2 of its subagents run at once");
    expect(text).toContain("Run dwfrun-a keeps running under the new limit");
    expect(text).toContain("nothing was stopped and no new run was started");
    expect(text).not.toContain("dwfrun-b");
    expect(text).not.toContain("takes over from");
    expect(text).toContain("do not amend, resume or restart it");
  });
});
