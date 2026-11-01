import * as executionAdapters from "@origin-ai/cf-adapters/exec";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeFileSystemAdapter } from "@origin-ai/cf-adapters/fs";
import { createInMemorySessionEventStore, createSqliteSessionStore } from "@origin-ai/cf-adapters/storage";
import { type AgentRuntime, PermissionService, defaultPermissionConfig } from "@origin-ai/cf-core";
import { createModelTelemetry } from "@origin-ai/cf-telemetry";
import {
  createRootTraceContext,
  createSessionId,
  createToolCallId,
  createTraceId,
  CREATE_WORKFLOW_TOOL_NAME,
  ESCALATE_TOOL_NAME,
  EVAL_WORKFLOW_SNIPPET_TOOL_NAME,
  LIST_WORKFLOW_RUNS_TOOL_NAME,
  type Model,
  type ModelResult,
  type ModelSelection,
  type PermissionBrokerRequest,
  SessionEventType,
  SUBMIT_RESULT_TOOL_NAME,
  type SessionEvent,
  type SessionEventStorePort,
  type SessionStorePort,
  type SkillRoot,
  type WorkflowEscalatePort,
  type WorkflowSubmitPort,
} from "@origin-ai/cf-contracts";
import {
  createScriptWorkflowAgentRuntime,
  createWorkflowChildSkillPort,
  type ScriptWorkflowAgentRuntimeDeps,
} from "../src/app/script-workflow-child-runtime.js";
import { createProtocolBrowserControlBroker } from "../src/cf-protocol/browser-control-broker.js";
import type { CfProtocolAgentServerContext } from "../src/cf-protocol/server-types.js";
import {
  parseWorkflowSubagentPermissionMode,
  workflowActorInteractionDescription,
  workflowActorPermissionPolicy,
  type WorkflowSubagentPermissionMode,
} from "../src/app/workflow-actor-permission.js";
import { workflowActorToolPolicy } from "../src/app/workflow-actor-tools.js";
import {
  createTestAgentRuntime,
  createTestModelFactory,
  createTestModelFactoryFromAdapter,
} from "./helpers/test-agent-runtime.js";

describe("script workflow child runtime — actor transcript 直播通道", () => {
  const parentSessionId = createSessionId("dwf-parent");
  const actorSessionId = createSessionId("dwf-actor-a-1");

  let tempRoot: string;
  let parentStore: SessionEventStorePort;
  let sessionStore: SessionStorePort;
  let parentRuntime: AgentRuntime;
  let forwarded: SessionEvent[];

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "cf-actor-transcript-"));
    parentStore = createInMemorySessionEventStore();
    sessionStore = await createSqliteSessionStore({ dbPath: ":memory:" });
    forwarded = [];
    parentRuntime = createTestAgentRuntime(
      parentSessionId,
      { workingDirectory: tempRoot },
      {
        eventStore: parentStore,
        fileSystemPort: createNodeFileSystemAdapter(),
        modelFactory: scriptedModelFactory,
      },
    );
    parentRuntime.subscribeEvents({
      onSessionEvent: (event) => {
        forwarded.push(event);
      },
    });
  });

  afterEach(async () => {
    await rm(tempRoot, { force: true, recursive: true });
  });

  const scriptedModelFactory = createTestModelFactoryFromAdapter({
    async generateText() {
      return {
        finishReason: "stop",
        providerMetadata: undefined,
        text: "actor done",
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      } as unknown as ModelResult;
    },
  });

  function makeDeps(): ScriptWorkflowAgentRuntimeDeps {
    return {
      agentTelemetry: createModelTelemetry().agentExecution,
      appOptions: { env: process.env },
      appVersion: "0.0.0-test",
      configResult: {
        config: {
          features: { skill: false },
          modelStream: { idleTimeoutMs: 0 },
          network: {},
          skillOverrides: {},
          skills: { enabled: false, roots: [] },
        },
      },
      fileSystemPort: createNodeFileSystemAdapter(),
      imageProcessorPort: {},
      logger: undefined,
      modelFactory: scriptedModelFactory,
      permissionService: new PermissionService(defaultPermissionConfig),
      runtime: parentRuntime,
      runtimeConfig: { workingDirectory: tempRoot },
      sessionId: parentSessionId,
      sessionStore,
      storageRoot: tempRoot,
      workingDirectory: tempRoot,
    } as unknown as ScriptWorkflowAgentRuntimeDeps;
  }

  async function makeActorRuntime(): Promise<AgentRuntime> {
    return createScriptWorkflowAgentRuntime({
      childSessionId: actorSessionId,
      deps: makeDeps(),
      request: { opts: {} } as never,
      traceContext: createRootTraceContext({ sessionId: parentSessionId }),
    });
  }

  it("actor runtime 与父 runtime 共享 event store", async () => {
    const execution = vi.spyOn(executionAdapters, "createNodeExecutionAdapter");
    const actorRuntime = await makeActorRuntime();
    expect(execution).toHaveBeenCalledWith(
      expect.objectContaining({
        bashOutputTempDir: tmpdir(),
        outputRootDir: join(tempRoot, "cli", "exec"),
      }),
    );
    execution.mockRestore();
    expect(actorRuntime.getSessionEventStore()).toBe(parentStore);

    await actorRuntime.ensureSessionPersistedForExternalActivity("workflow actor a#1@1");
    await actorRuntime.executeTurn("go");

    const stored = await parentStore.getEvents(actorSessionId);
    expect(stored.length).toBeGreaterThan(1);
    expect(await sessionStore.getSession(actorSessionId)).toBeDefined();
  });

  it("转发流从 sequenceNumber 1（SessionTitleUpdated）起，保留 actor 的 sessionId", async () => {
    const actorRuntime = await makeActorRuntime();

    await actorRuntime.ensureSessionPersistedForExternalActivity("workflow actor a#1@1");
    await actorRuntime.executeTurn("go");

    expect(forwarded.length).toBeGreaterThan(1);
    expect(forwarded[0]!.type).toBe(SessionEventType.SessionTitleUpdated);
    expect(forwarded[0]!.sequenceNumber).toBe(1);
    expect(forwarded.every((event) => event.sessionId === actorSessionId)).toBe(true);
    expect(forwarded.map((event) => event.sequenceNumber)).toEqual(
      forwarded.map((_event, index) => index + 1),
    );
  });

  it("恰好一次：每条 actor 事件在共享 store 里只有一份，父会话不被污染", async () => {
    const actorRuntime = await makeActorRuntime();

    await actorRuntime.ensureSessionPersistedForExternalActivity("workflow actor a#1@1");
    await actorRuntime.executeTurn("go");

    const stored = await parentStore.getEvents(actorSessionId);
    expect(stored.length).toBeGreaterThan(1);
    const idCounts = new Map<string, number>();
    for (const event of stored) idCounts.set(event.id, (idCounts.get(event.id) ?? 0) + 1);
    expect([...idCounts.values()].filter((count) => count !== 1)).toEqual([]);

    expect(forwarded.map((event) => event.id)).toEqual(stored.map((event) => event.id));
    expect(await parentStore.getEvents(parentSessionId)).toEqual([]);
  });

  
  describe("script workflow child runtime — actor 的控制工具面", () => {
    const submitPort: WorkflowSubmitPort = { respond: async () => ({ accept: true }) };
    const escalatePort: WorkflowEscalatePort = {
      escalate: async () => ({ kind: "answered", answer: "ok", qid: "dwfq-x-1" }),
    };

    function actorRuntimeWith(ports: {
      workflowSubmitPort?: WorkflowSubmitPort;
      workflowEscalatePort?: WorkflowEscalatePort;
    }): AgentRuntime {
      return createScriptWorkflowAgentRuntime({
        childSessionId: createSessionId("dwf-actor-tools"),
        deps: makeDeps(),
        request: { opts: {} } as never,
        traceContext: createRootTraceContext({ sessionId: parentSessionId }),
        ...ports,
      });
    }

    it("注入 escalatePort 即为该会话注册 escalate", () => {
      const registry = actorRuntimeWith({
        workflowSubmitPort: submitPort,
        workflowEscalatePort: escalatePort,
      }).getToolRegistry();
      expect(registry.has(ESCALATE_TOOL_NAME)).toBe(true);
      expect(registry.has(SUBMIT_RESULT_TOOL_NAME)).toBe(true);
    });

    it("两个端口各自独立成门：只给 submitPort 时 escalate 不注册", () => {
      const registry = actorRuntimeWith({ workflowSubmitPort: submitPort }).getToolRegistry();
      expect(registry.has(SUBMIT_RESULT_TOOL_NAME)).toBe(true);
      expect(registry.has(ESCALATE_TOOL_NAME)).toBe(false);
    });

    it("两个端口都缺席时两个工具都不注册（非 actor 会话的形状）", () => {
      const registry = actorRuntimeWith({}).getToolRegistry();
      expect(registry.has(SUBMIT_RESULT_TOOL_NAME)).toBe(false);
      expect(registry.has(ESCALATE_TOOL_NAME)).toBe(false);
    });
  });

  describe("script workflow child runtime — persona 走 workflowActor 而非 systemPrompt", () => {
    function configOf(runtime: AgentRuntime): Record<string, unknown> {
      return (runtime as unknown as { config: Record<string, unknown> }).config;
    }

    it("workflowActor 落到 child config，systemPrompt 不被父会话的 custom prompt 污染", () => {
      const deps = makeDeps();
      const runtime = createScriptWorkflowAgentRuntime({
        childSessionId: createSessionId("dwf-actor-persona"),
        configOverrides: { workflowActor: { name: "reviewer", persona: "You review." } },
        deps: {
          ...deps,
          runtimeConfig: { ...deps.runtimeConfig, systemPrompt: "parent custom prompt" },
        },
        request: { opts: {} } as never,
        traceContext: createRootTraceContext({ sessionId: parentSessionId }),
      });
      const config = configOf(runtime);
      expect(config.workflowActor).toEqual({ name: "reviewer", persona: "You review." });
      expect(config.systemPrompt).toBeUndefined();
    });

    it("没有 workflowActor 时 systemPrompt 照旧回落到父会话配置", () => {
      const deps = makeDeps();
      const runtime = createScriptWorkflowAgentRuntime({
        childSessionId: createSessionId("dwf-actor-legacy"),
        deps: {
          ...deps,
          runtimeConfig: { ...deps.runtimeConfig, systemPrompt: "parent custom prompt" },
        },
        request: { opts: {} } as never,
        traceContext: createRootTraceContext({ sessionId: parentSessionId }),
      });
      expect(configOf(runtime).systemPrompt).toBe("parent custom prompt");
    });
  });

  
  describe("script workflow child runtime — 灰度门整体继承父会话", () => {
    function childRuntimeForParent(parentFlag: boolean | undefined): AgentRuntime {
      const deps = makeDeps();
      return createScriptWorkflowAgentRuntime({
        childSessionId: createSessionId(`dwf-actor-gray-${String(parentFlag)}`),
        deps: {
          ...deps,
          runtimeConfig: {
            ...deps.runtimeConfig,
            ...(parentFlag === undefined ? {} : { dynamicWorkflowEnabled: parentFlag }),
          },
        },
        request: { opts: {} } as never,
        traceContext: createRootTraceContext({ sessionId: parentSessionId }),
      });
    }

    it.each([
      { parentFlag: true, available: true },
      { parentFlag: undefined, available: true },
      { parentFlag: false, available: false },
    ])("父会话 dynamicWorkflowEnabled=%j", ({ parentFlag, available }) => {
      const runtime = childRuntimeForParent(parentFlag);
      expect(
        (runtime as unknown as { config: { dynamicWorkflowEnabled?: boolean } }).config
          .dynamicWorkflowEnabled,
      ).toBe(parentFlag);
      const registry = runtime.getToolRegistry();
      expect(registry.has(LIST_WORKFLOW_RUNS_TOOL_NAME)).toBe(available);
      expect(registry.has(EVAL_WORKFLOW_SNIPPET_TOOL_NAME)).toBe(available);
      expect(registry.has("Read")).toBe(true);
      expect(registry.has(CREATE_WORKFLOW_TOOL_NAME)).toBe(false);
    });
  });
});

describe("script workflow child runtime — 与父会话共享 model factory", () => {
  const parentSessionId = createSessionId("dwf-parent-model");
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "cf-actor-model-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { force: true, recursive: true });
  });

  async function baseDeps(parentRuntime: AgentRuntime): Promise<ScriptWorkflowAgentRuntimeDeps> {
    return {
      agentTelemetry: createModelTelemetry().agentExecution,
      appOptions: { env: {} },
      appVersion: "0.0.0-test",
      configResult: {
        config: {
          features: { skill: false },
          modelStream: { idleTimeoutMs: 0 },
          network: {},
          skillOverrides: {},
          skills: { enabled: false, roots: [] },
        },
      },
      fileSystemPort: createNodeFileSystemAdapter(),
      imageProcessorPort: {},
      logger: undefined,
      permissionService: new PermissionService(defaultPermissionConfig),
      runtime: parentRuntime,
      runtimeConfig: { workingDirectory: tempRoot },
      sessionId: parentSessionId,
      sessionStore: await createSqliteSessionStore({ dbPath: ":memory:" }),
      storageRoot: tempRoot,
      workingDirectory: tempRoot,
    } as unknown as ScriptWorkflowAgentRuntimeDeps;
  }

  it("child 用 deps 里父会话的 factory 造 Model，并以父会话当前的选择为基线", async () => {
    const parentModelFactory = vi.fn(
      (target: { selection: ModelSelection }): Model => ({
        providerId: target.selection.providerId as Model["providerId"],
        modelId: target.selection.modelId as Model["modelId"],
        properties: {
          contextWindow: 200_000,
          inputFormat: {
            supportsText: true,
            supportsImage: false,
            supportsVideo: false,
            supportsAudio: false,
            supportsPdf: false,
          },
          outputFormat: { supportsText: true },
          supportsMidConversationSystem: false,
          supportsNativeWebSearch: false,
          supportsJsonSchemaOutput: true,
          supportsToolCall: true,
        } as unknown as Model["properties"],
        optionSpecs: { maxOutputTokens: { max: 4096 } },
        options: { maxOutputTokens: 4096 },
        bind() {
          return this;
        },
        async generateText() {
          return {
            finishReason: "stop",
            providerMetadata: undefined,
            text: "actor done",
            usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
          } as unknown as ModelResult;
        },
        streamText(): never {
          throw new Error("streamText is not part of this fixture");
        },
      }),
    );
    const parentRuntime = createTestAgentRuntime(
      parentSessionId,
      {
        modelSelection: { providerId: "glm", modelId: "GLM-5.3-Highspeed" },
        workingDirectory: tempRoot,
      },
      {
        eventStore: createInMemorySessionEventStore(),
        fileSystemPort: createNodeFileSystemAdapter(),
        modelFactory:
          parentModelFactory as unknown as ScriptWorkflowAgentRuntimeDeps["modelFactory"],
      },
    );
    const deps = await baseDeps(parentRuntime);
    deps.modelFactory =
      parentModelFactory as unknown as ScriptWorkflowAgentRuntimeDeps["modelFactory"];

    const actorRuntime = createScriptWorkflowAgentRuntime({
      childSessionId: createSessionId("dwf-actor-model-wiring"),
      deps,
      request: { opts: {} } as never,
      traceContext: createRootTraceContext({ sessionId: parentSessionId }),
    });
    expect(actorRuntime.getSessionModelSelection()).toEqual({
      providerId: "glm",
      modelId: "GLM-5.3-Highspeed",
    });
    await actorRuntime.ensureSessionPersistedForExternalActivity("workflow actor a#1@1");
    await actorRuntime.executeTurn("go");

    expect(
      parentModelFactory.mock.calls.some(
        ([target]) =>
          target.selection.providerId === "glm" && target.selection.modelId === "GLM-5.3-Highspeed",
      ),
    ).toBe(true);
  });

  it("request.opts.model 必须带 provider 段：裸模型名不再借父会话的 provider 补全", async () => {
    const parentRuntime = createTestAgentRuntime(
      parentSessionId,
      {
        modelSelection: { providerId: "glm", modelId: "GLM-5.3-Highspeed" },
        workingDirectory: tempRoot,
      },
      {
        eventStore: createInMemorySessionEventStore(),
        fileSystemPort: createNodeFileSystemAdapter(),
      },
    );
    const deps = await baseDeps(parentRuntime);
    deps.modelFactory = createTestModelFactoryFromAdapter({
      async generateText() {
        throw new Error("not called");
      },
    });
    expect(() =>
      createScriptWorkflowAgentRuntime({
        childSessionId: createSessionId("dwf-actor-model-bare"),
        deps,
        request: { opts: { model: "GLM-5.3-Highspeed" } } as never,
        traceContext: createRootTraceContext({ sessionId: parentSessionId }),
      }),
    ).toThrow(/provider-qualified/);
  });
});

describe("script workflow child runtime — 对外交互端口由父 runtime 铸造", () => {
  const parentSessionId = createSessionId("dwf-parent-routing");
  const actorSessionId = createSessionId("dwf-actor-routing-1");

  let tempRoot: string;
  let parentRuntime: AgentRuntime;
  let refreshes: Array<{ providerId: string; routedSessionId?: string }>;
  let permissionRequests: Array<{ sessionId: string; origin?: unknown }>;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "cf-actor-routing-"));
    refreshes = [];
    permissionRequests = [];
    parentRuntime = createTestAgentRuntime(parentSessionId, { workingDirectory: tempRoot }, {
      eventStore: createInMemorySessionEventStore(),
      fileSystemPort: createNodeFileSystemAdapter(),
      providerRuntimeHeadersPort: {
        shouldRefreshBeforeModelRequest: () => true,
        async refreshBeforeModelRequest(input) {
          refreshes.push({ providerId: input.providerId, routedSessionId: input.sessionId });
          return { headersApplied: true };
        },
      },
      modelFactory: routingModelFactory,
      permissionBroker: {
        async requestPermission(request) {
          permissionRequests.push({ sessionId: request.sessionId, origin: request.origin });
          return { decision: "allow" };
        },
      },
    } as never);
  });

  afterEach(async () => {
    await rm(tempRoot, { force: true, recursive: true });
  });

  const routingModelFactory = createTestModelFactory({
    async generateText(_request, observation) {
      await observation.invocationContext?.refreshRuntimeHeadersBeforeAttempt?.({ attempt: 1 });
      return {
        finishReason: "stop",
        providerMetadata: undefined,
        text: "actor done",
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      } as unknown as ModelResult;
    },
  });

  async function makeActorRuntime(): Promise<AgentRuntime> {
    const deps = {
      agentTelemetry: createModelTelemetry().agentExecution,
      appOptions: { env: process.env },
      appVersion: "0.0.0-test",
      configResult: {
        config: {
          features: { skill: false },
          modelStream: { idleTimeoutMs: 0 },
          network: {},
          skillOverrides: {},
          skills: { enabled: false, roots: [] },
        },
      },
      fileSystemPort: createNodeFileSystemAdapter(),
      imageProcessorPort: {},
      logger: undefined,
      modelFactory: routingModelFactory,
      permissionService: new PermissionService(defaultPermissionConfig),
      runtime: parentRuntime,
      runtimeConfig: { workingDirectory: tempRoot },
      sessionId: parentSessionId,
      sessionStore: await createSqliteSessionStore({ dbPath: ":memory:" }),
      storageRoot: tempRoot,
      workingDirectory: tempRoot,
    } as unknown as ScriptWorkflowAgentRuntimeDeps;
    return createScriptWorkflowAgentRuntime({
      childSessionId: actorSessionId,
      deps,
      request: { opts: { agentType: "reviewer", label: "复核员" }, prompt: "go" } as never,
      traceContext: createRootTraceContext({ sessionId: parentSessionId }),
    });
  }

  it("actor 的 provider runtime headers 刷新以父会话为路由身份", async () => {
    const actorRuntime = await makeActorRuntime();
    await actorRuntime.executeTurn("go");

    expect(refreshes.length).toBeGreaterThan(0);
    expect(refreshes.every((entry) => entry.routedSessionId === parentSessionId)).toBe(true);
  });

  it("父 runtime 铸造的 permission broker 带父会话身份与子代理 origin", async () => {
    // `...deps.runtime.createChildClientPorts(...)`）。
    const ports = parentRuntime.createChildClientPorts({
      agentId: actorSessionId,
      agentType: "reviewer",
      childSessionId: actorSessionId,
      description: "复核员",
    });

    await ports.permissionBroker!.requestPermission({
      requestId: "req-actor",
      sessionId: actorSessionId,
      traceId: createTraceId(),
      toolCallId: createToolCallId(),
      toolName: "Bash",
      input: {},
      mode: "yolo",
      ruleId: "rule",
      reason: "test",
      riskLevel: "low",
      requestedAt: new Date(0),
    } as never);

    expect(permissionRequests).toHaveLength(1);
    expect(permissionRequests[0]!.sessionId).toBe(parentSessionId);
    expect(permissionRequests[0]!.origin).toMatchObject({
      kind: "subagent",
      childSessionId: actorSessionId,
      parentSessionId,
    });
  });
});

describe("script workflow child runtime — 子代理经父 broker 请求权限与提问", () => {
  const parentSessionId = createSessionId("dwf-parent-guarded");
  const actorSessionId = createSessionId("dwf-actor-guarded-1");

  let tempRoot: string;
  let parentRuntime: AgentRuntime;
  let requests: PermissionBrokerRequest[];
  let modelRequests: string[];
  let execute: ReturnType<typeof vi.fn>;
  
  let firstToolCall: { id: string; name: string; input: Record<string, unknown> };

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "cf-actor-guarded-"));
    requests = [];
    modelRequests = [];
    firstToolCall = {
      id: "actor-guarded-rm",
      name: "Bash",
      input: { command: "rm -rf fixture-only" },
    };
    execute = vi.fn(async () => ({
      status: "completed" as const,
      stdout: { text: "executed", bytes: 8, truncated: false },
      stderr: { text: "", bytes: 0, truncated: false },
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
      cancelled: false,
      startedAt: new Date(),
      completedAt: new Date(),
    }));
    parentRuntime = createTestAgentRuntime(
      parentSessionId,
      { workingDirectory: tempRoot, mode: "guarded" },
      {
        eventStore: createInMemorySessionEventStore(),
        fileSystemPort: createNodeFileSystemAdapter(),
        modelFactory: guardedModelFactory,
        permissionBroker: {
          async requestPermission(request: PermissionBrokerRequest) {
            requests.push(request);
            return { decision: "deny", reason: "guarded actor fixture denial" };
          },
        },
      } as never,
    );
  });

  afterEach(async () => {
    await rm(tempRoot, { force: true, recursive: true });
  });

  const guardedModelFactory = createTestModelFactoryFromAdapter({
    async generateText(request) {
      modelRequests.push(JSON.stringify(request));
      const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
      if (modelRequests.length === 1) {
        return {
          finishReason: "tool-calls",
          text: "",
          usage,
          toolCalls: [firstToolCall],
        } as unknown as ModelResult;
      }
      return { finishReason: "stop", text: "actor done", usage } as unknown as ModelResult;
    },
  });

  async function makeActorRuntime(
    subagentPermissionMode: WorkflowSubagentPermissionMode | undefined,
  ): Promise<AgentRuntime> {
    const deps = {
      agentTelemetry: createModelTelemetry().agentExecution,
      appOptions: { env: process.env, executionPort: { run: execute } },
      appVersion: "0.0.0-test",
      configResult: {
        config: {
          features: { skill: false },
          modelStream: { idleTimeoutMs: 0 },
          network: {},
          skillOverrides: {},
          skills: { enabled: false, roots: [] },
        },
      },
      fileSystemPort: createNodeFileSystemAdapter(),
      imageProcessorPort: {},
      logger: undefined,
      modelFactory: guardedModelFactory,
      permissionService: new PermissionService(defaultPermissionConfig),
      runtime: parentRuntime,
      runtimeConfig: { workingDirectory: tempRoot, mcp: { enabled: false } },
      sessionId: parentSessionId,
      sessionStore: await createSqliteSessionStore({ dbPath: ":memory:" }),
      storageRoot: tempRoot,
      workingDirectory: tempRoot,
    } as unknown as ScriptWorkflowAgentRuntimeDeps;
    return createScriptWorkflowAgentRuntime({
      childSessionId: actorSessionId,
      configOverrides: {
        ...workflowActorToolPolicy(),
        ...workflowActorPermissionPolicy(subagentPermissionMode),
      },
      deps,
      interactionDescription: workflowActorInteractionDescription({
        actor: { siteId: "agent#1", ordinal: 0 },
        persona: { name: "reviewer" },
      }),
      request: { opts: {} } as never,
      traceContext: createRootTraceContext({ sessionId: parentSessionId }),
    });
  }

  it("guarded：一次 user-once 请求，父会话路由、子代理 origin；拒绝后不执行且结果回到子代理", async () => {
    const actorRuntime = await makeActorRuntime("guarded");
    expect(actorRuntime.getMode()).toBe("guarded");
    await actorRuntime.executeTurn("go");

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      approvalMode: "user-once",
      sessionId: parentSessionId,
      toolName: "Bash",
      origin: {
        kind: "subagent",
        agentId: actorSessionId,
        childSessionId: actorSessionId,
        description: "reviewer (agent#1@0)",
        parentSessionId,
      },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(modelRequests.some((request) => request.includes("guarded actor fixture denial"))).toBe(
      true,
    );
    expect(parentRuntime.getMode()).toBe("guarded");
  });

  it("交互事件镜像到父会话：父流里看到 PermissionRequested（带 origin）与随后的终态", async () => {
    const parentEvents: SessionEvent[] = [];
    parentRuntime.subscribeEvents({
      onSessionEvent: (event) => {
        if (event.sessionId === parentSessionId) parentEvents.push(event);
      },
    });
    const actorRuntime = await makeActorRuntime("guarded");
    await actorRuntime.executeTurn("go");

    const requested = parentEvents.filter(
      (event) => event.type === SessionEventType.PermissionRequested,
    );
    expect(requested).toHaveLength(1);
    const payload = requested[0]!.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      requestId: requests[0]!.requestId,
      toolName: "Bash",
      approvalMode: "user-once",
      childSessionId: actorSessionId,
      origin: {
        kind: "subagent",
        childSessionId: actorSessionId,
        description: "reviewer (agent#1@0)",
        parentSessionId,
      },
    });
    const settled = parentEvents.filter(
      (event) =>
        event.type === SessionEventType.PermissionResolved ||
        event.type === SessionEventType.PermissionDenied,
    );
    expect(settled.length).toBeGreaterThan(0);
    expect(
      settled.every(
        (event) => (event.payload as { toolCallId?: unknown }).toolCallId === payload.toolCallId,
      ),
    ).toBe(true);
    expect(
      parentEvents.some(
        (event) =>
          event.type === SessionEventType.ToolCallStarted ||
          event.type === SessionEventType.ToolCallResult,
      ),
    ).toBe(false);
  });

  it("停止 run（actor turn 被 abort）撤销挂起的请求：broker 收到 abort，命令不执行", async () => {
    const aborted = Promise.withResolvers<void>();
    const registered = Promise.withResolvers<void>();
    parentRuntime = createTestAgentRuntime(
      parentSessionId,
      { workingDirectory: tempRoot, mode: "guarded" },
      {
        eventStore: createInMemorySessionEventStore(),
        fileSystemPort: createNodeFileSystemAdapter(),
        modelFactory: guardedModelFactory,
        permissionBroker: {
          requestPermission(request: PermissionBrokerRequest, options?: { signal?: AbortSignal }) {
            requests.push(request);
            registered.resolve();
            return new Promise((_resolve, reject) => {
              options?.signal?.addEventListener(
                "abort",
                () => {
                  aborted.resolve();
                  reject(new Error("aborted"));
                },
                { once: true },
              );
            });
          },
        },
      } as never,
    );
    const actorRuntime = await makeActorRuntime("guarded");
    const controller = new AbortController();
    const turn = actorRuntime.executeTurn("go", undefined, { abortSignal: controller.signal });
    await registered.promise;
    controller.abort();
    await aborted.promise;
    await turn.catch(() => undefined);

    expect(requests).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it("YOLO run（键缺席）：子代理不问，命令照常执行", async () => {
    const actorRuntime = await makeActorRuntime(undefined);
    expect(actorRuntime.getMode()).toBe("yolo");
    await actorRuntime.executeTurn("go");

    expect(requests).toHaveLength(0);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("build run：子代理的普通 Bash 也经父会话请求（非 user-once），并镜像到父会话", async () => {
    const parentEvents: SessionEvent[] = [];
    parentRuntime.subscribeEvents({
      onSessionEvent: (event) => {
        if (event.sessionId === parentSessionId) parentEvents.push(event);
      },
    });
    const actorRuntime = await makeActorRuntime("build");
    expect(actorRuntime.getMode()).toBe("build");
    await actorRuntime.executeTurn("go");

    expect(requests).toHaveLength(1);
    expect(requests[0]!.approvalMode).not.toBe("user-once");
    expect(requests[0]).toMatchObject({
      sessionId: parentSessionId,
      toolName: "Bash",
      origin: { kind: "subagent", description: "reviewer (agent#1@0)" },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(parentEvents.some((event) => event.type === SessionEventType.PermissionRequested)).toBe(
      true,
    );
  });

  it("AskUserQuestion：子代理的提问经父会话送达，父流里有带 origin 的 PermissionRequested", async () => {
    firstToolCall = {
      id: "actor-question",
      name: "AskUserQuestion",
      input: {
        questions: [
          {
            question: "Which file should I review first?",
            header: "Order",
            multiSelect: false,
            options: [
              { label: "a.ts", description: "The entry point" },
              { label: "b.ts", description: "The helper" },
            ],
          },
        ],
      },
    };
    const parentEvents: SessionEvent[] = [];
    parentRuntime.subscribeEvents({
      onSessionEvent: (event) => {
        if (event.sessionId === parentSessionId) parentEvents.push(event);
      },
    });
    const actorRuntime = await makeActorRuntime("yolo");
    await actorRuntime.executeTurn("go");

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      sessionId: parentSessionId,
      toolName: "AskUserQuestion",
      origin: { kind: "subagent", childSessionId: actorSessionId },
    });
    const requested = parentEvents.filter(
      (event) => event.type === SessionEventType.PermissionRequested,
    );
    expect(requested).toHaveLength(1);
    expect(requested[0]!.payload).toMatchObject({
      toolName: "AskUserQuestion",
      origin: { kind: "subagent", description: "reviewer (agent#1@0)" },
    });
  });
});

describe("workflow actor permission — run 记下的模式读回", () => {
  it("认识的模式原样读回；缺席、未知值与 plan 读成缺席（= YOLO）", () => {
    for (const mode of ["build", "edit", "yolo", "guarded", "auto"] as const) {
      expect(parseWorkflowSubagentPermissionMode(mode)).toBe(mode);
      expect(workflowActorPermissionPolicy(mode)).toEqual({ mode });
    }
    for (const raw of [undefined, "plan", "full-auto-2027", 42]) {
      expect(parseWorkflowSubagentPermissionMode(raw)).toBeUndefined();
    }
    expect(workflowActorPermissionPolicy(undefined)).toEqual({ mode: "yolo" });
  });
});

describe("script workflow child runtime — 子代理的 Browser Use", () => {
  const parentSessionId = createSessionId("dwf-parent-browser");
  const actorSessionId = createSessionId("dwf-dwfrun-b-actor_1_1");

  let tempRoot: string;
  let parentRuntime: AgentRuntime;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "cf-actor-browser-"));
    parentRuntime = createTestAgentRuntime(
      parentSessionId,
      { workingDirectory: tempRoot },
      {
        eventStore: createInMemorySessionEventStore(),
        fileSystemPort: createNodeFileSystemAdapter(),
        modelFactory: browserModelFactory,
      },
    );
  });

  afterEach(async () => {
    await rm(tempRoot, { force: true, recursive: true });
  });

  const browserModelFactory = createTestModelFactoryFromAdapter({
    async generateText() {
      return {
        finishReason: "stop",
        providerMetadata: undefined,
        text: "actor done",
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      } as unknown as ModelResult;
    },
  });

  
  function makeProtocolContext(requestClient: ReturnType<typeof vi.fn>) {
    return {
      requestClient,
      sessions: new Map([
        [
          parentSessionId,
          {
            deliveryKind: "desktop-continuous",
            workspace: { workspaceKey: "/repo", workspacePath: "/repo" },
          },
        ],
      ]),
    } as unknown as CfProtocolAgentServerContext;
  }

  async function makeActorRuntime(
    browserControlPort: Parameters<
      typeof createScriptWorkflowAgentRuntime
    >[0]["browserControlPort"],
  ): Promise<AgentRuntime> {
    const deps = {
      agentTelemetry: createModelTelemetry().agentExecution,
      appOptions: { env: process.env },
      appVersion: "0.0.0-test",
      configResult: {
        config: {
          features: { skill: false },
          modelStream: { idleTimeoutMs: 0 },
          network: {},
          skillOverrides: {},
          skills: { enabled: false, roots: [] },
        },
      },
      fileSystemPort: createNodeFileSystemAdapter(),
      imageProcessorPort: {},
      logger: undefined,
      modelFactory: browserModelFactory,
      permissionService: new PermissionService(defaultPermissionConfig),
      pluginSkillRoots: [],
      runtime: parentRuntime,
      runtimeConfig: {
        workingDirectory: tempRoot,
        runtimeFeatures: { browserUse: true },
      },
      sessionId: parentSessionId,
      sessionStore: await createSqliteSessionStore({ dbPath: ":memory:" }),
      storageRoot: tempRoot,
      workingDirectory: tempRoot,
    } as unknown as ScriptWorkflowAgentRuntimeDeps;
    return createScriptWorkflowAgentRuntime({
      childSessionId: actorSessionId,
      deps,
      request: { opts: {} } as never,
      traceContext: createRootTraceContext({ sessionId: parentSessionId }),
      ...(browserControlPort === undefined ? {} : { browserControlPort }),
    });
  }

  function sentCommands(requestClient: ReturnType<typeof vi.fn>) {
    return requestClient.mock.calls.map((call) => {
      const params = call[1] as {
        command?: Record<string, unknown>;
        sessionId: string;
        workspaceKey: string;
      };
      return {
        command: params.command,
        sessionId: params.sessionId,
        workspaceKey: params.workspaceKey,
      };
    });
  }

  it("actor 经 node_repl 的浏览器请求用自己的 sessionId，workspace 取父会话；turn end 与关闭都到达桌面", async () => {
    const requestClient = vi.fn(async () => ({ ok: true, elapsedMs: 0 }));
    const context = makeProtocolContext(requestClient);
    const appPort = createProtocolBrowserControlBroker(context);
    const nodeReplPort = createProtocolBrowserControlBroker(context);
    const actorRuntime = await makeActorRuntime(appPort);

    await expect(
      nodeReplPort.execute({
        browserId: "iab-1",
        browserGeneration: 7,
        sessionId: actorSessionId,
        command: { method: "newTab" },
      }),
    ).resolves.toMatchObject({ ok: true });
    await actorRuntime.executeTurn("go");
    await actorRuntime.closeBrowserSession();

    expect(sentCommands(requestClient)).toEqual([
      { command: { method: "newTab" }, sessionId: actorSessionId, workspaceKey: "/repo" },
      {
        command: expect.objectContaining({ method: "turnEnded" }),
        sessionId: actorSessionId,
        workspaceKey: "/repo",
      },
      {
        command: { method: "closeSession", closeTabs: true },
        sessionId: actorSessionId,
        workspaceKey: "/repo",
      },
    ]);
    await expect(nodeReplPort.list({ sessionId: actorSessionId })).rejects.toThrow(
      `Session is not active: ${actorSessionId}`,
    );
  });

  it("不传父端口（legacy Workflow child）：actor 没有 Browser 登记，关闭不发任何浏览器请求", async () => {
    const requestClient = vi.fn(async () => ({ ok: true, elapsedMs: 0 }));
    const nodeReplPort = createProtocolBrowserControlBroker(makeProtocolContext(requestClient));
    const actorRuntime = await makeActorRuntime(undefined);

    await expect(nodeReplPort.list({ sessionId: actorSessionId })).rejects.toThrow(
      `Session is not active: ${actorSessionId}`,
    );
    await actorRuntime.executeTurn("go");
    await actorRuntime.closeBrowserSession();
    expect(requestClient).not.toHaveBeenCalled();
  });

  it("端口没有 forChildSession（CLI headless CDP）：actor 直接用父端口，关闭时关自己的 session", async () => {
    const closed: string[] = [];
    const port = {
      list: vi.fn(async () => []),
      execute: vi.fn(async () => ({ ok: true, elapsedMs: 0 })),
      closeSession: vi.fn(async (input: { sessionId: string }) => {
        closed.push(input.sessionId);
      }),
    };
    const actorRuntime = await makeActorRuntime(port);
    await actorRuntime.closeBrowserSession();
    expect(closed).toEqual([actorSessionId]);
  });
});

describe("script workflow child runtime — 子代理的技能清单", () => {
  const PACKAGES_ROOT = fileURLToPath(new URL("../../", import.meta.url));
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "cf-actor-skills-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { force: true, recursive: true });
  });

  function skillDeps(input: { pluginSkillRoots: SkillRoot[] }) {
    return {
      appOptions: { env: process.env },
      configResult: {
        config: {
          features: { skill: true },
          skillOverrides: {},
          skills: { enabled: true, roots: [join(tempRoot, "configured")] },
        },
      },
      pluginSkillRoots: input.pluginSkillRoots,
    } as unknown as ScriptWorkflowAgentRuntimeDeps;
  }

  it("插件技能根与用户配置根都在：actor 看得见 browser-use 的 control-browser", async () => {
    await mkdir(join(tempRoot, "configured", "house-style"), { recursive: true });
    await writeFile(
      join(tempRoot, "configured", "house-style", "SKILL.md"),
      "---\nname: house-style\ndescription: House style.\n---\n\nBody.\n",
    );
    const port = createWorkflowChildSkillPort(
      skillDeps({
        pluginSkillRoots: [
          {
            path: join(PACKAGES_ROOT, "browser-use-plugin", "skills"),
            priority: 1_000,
            scope: "system",
            source: "plugin",
            pluginId: "browser-use@cf-plugins-official",
          },
        ],
      }),
    );

    const outcome = await port!.discoverSkills({ workingDirectory: tempRoot });
    const names = outcome.skills.map((skill) => skill.name);
    expect(names).toEqual(expect.arrayContaining(["control-browser", "house-style"]));
    expect(names).not.toContain("dynamic-workflows");
  });

  it("技能总开关关闭时没有 skill 端口", () => {
    const deps = skillDeps({ pluginSkillRoots: [] });
    (deps.configResult.config.features as { skill: boolean }).skill = false;
    expect(createWorkflowChildSkillPort(deps)).toBeUndefined();
  });
});
