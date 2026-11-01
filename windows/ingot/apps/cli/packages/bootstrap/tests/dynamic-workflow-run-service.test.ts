

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestAgentRuntime, createTestModelSelection } from "./helpers/test-agent-runtime.js";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemorySessionEventStore, createSqliteSessionStore } from "@origin-ai/cf-adapters/storage";
import type {
  DwfArtifactItem,
  DwfRunIntrospectionQueries,
  DwfRunLifeSpan,
  DwfRunSessionListItem,
} from "@origin-ai/cf-adapters/storage";
import {
  CoreErrorType,
  ESCALATE_TOOL_NAME,
  RESOLVE_WORKFLOW_QUESTION_TOOL_NAME,
  SUBMIT_RESULT_TOOL_NAME,
  createRootTraceContext,
  createSessionId,
  createToolCallId,
  createTurnId,
  DYNAMIC_WORKFLOW_RUN_EVENT_PAYLOAD_LIMITS,
  LIST_WORKFLOW_RUNS_MAX_LIMIT,
  type CollaborationMode,
  type CreateSessionTaskLinkInput,
  type DynamicWorkflowRunDetail,
  type DynamicWorkflowRunListQuery,
  type DynamicWorkflowRunListResult,
  type DynamicWorkflowRunProgressPayload,
  type MessageWithParts,
  type ModelSelection,
  type SessionEventStorePort,
  type SessionId,
  type SessionStorePort,
  type ToolArtifactStorePort,
  type ToolArtifactWriteRequest,
  type WorkflowEscalatePort,
} from "@origin-ai/cf-contracts";
import {
  AgentRuntime,
  PermissionService,
  builtInTools,
  createToolExecutor,
  createToolRegistry,
  defaultPermissionConfig,
} from "@origin-ai/cf-core";
import {
  reduceWorkflowRunsState,
  WORKFLOW_RUN_EVENTS_PAGE_LIMITS,
  workflowRunsStateSchema,
  type WorkflowRunProgressEnvelope,
  type WorkflowRunsState,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  holeSiteId,
  InMemoryJournalStore,
  refToString,
  type JournalStorePort,
  type NodeRecord,
  type RunEvent,
  type RunRecord,
  type RunStatus,
  type RunStopReason,
} from "@origin-ai/cf-dynamic-workflow";

import {
  createDynamicWorkflowRunService,
  resolveDynamicWorkflowJournalStore,
  type DynamicWorkflowActorRuntimeInput,
} from "../src/app/dynamic-workflow-run-service.js";
import {
  createWorkflowConcurrencyGovernor,
  type WorkflowConcurrencyPort,
} from "../src/app/workflow-concurrency-governor.js";
import { resolveWorkflowDefaultConcurrency } from "../src/app/workflow-default-concurrency.js";
import { replayRunProgress } from "../src/app/dynamic-workflow-run-replay.js";
import { workflowActorModelPolicy } from "../src/app/workflow-actor-model.js";
import { workflowActorToolPolicy } from "../src/app/workflow-actor-tools.js";
import {
  fakeFileSystemPort,
  unsupportedExecutionPort,
  type PlannedResponse,
} from "./workflow-driver.helpers.js";
import type { ExecutionPort } from "@origin-ai/cf-contracts";
import { mkdtempSync, readFileSync } from "node:fs";

const TEST_CWD: string = mkdtempSync(join(tmpdir(), "dwf-bootstrap-test-cwd-"));

const { compiledScripts } = vi.hoisted(() => ({ compiledScripts: [] as string[] }));

vi.mock("@origin-ai/cf-dynamic-workflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@origin-ai/cf-dynamic-workflow")>();
  return {
    ...actual,
    createWorkflowProgram: (scriptText: string) => {
      compiledScripts.push(scriptText);
      return actual.createWorkflowProgram(scriptText);
    },
  };
});

const TYPED_SCRIPT = [
  "interface Answer { text: string }",
  'const a = await agent("worker").ask<Answer>("do the thing");',
  "return a.text;",
].join("\n");

const BROKEN_SCRIPT = 'const x: number = "definitely not a number";';

const ARTIFACT_SCRIPT = ['artifact.markdown("summary", "# 结论");', 'return "done";'].join("\n");

function traceFor(name: string) {
  const sessionId = createSessionId(name);
  return createRootTraceContext({ sessionId, turnId: createTurnId(name) });
}

type ActorPlan =
  | PlannedResponse
  | { kind: "escalate"; question: string; context?: string }
  | { kind: "write"; path: string; content: string }
  //
  | { kind: "hang-until-cancelled" }
  | { kind: "throw"; error: unknown };

interface ModelRequestLog {
  requests: { messages?: unknown; tools?: readonly { name: string }[] }[];
}

function scriptedModelAdapter(
  responses: ActorPlan[],
  onCall?: () => void,
  log?: ModelRequestLog,
): unknown {
  let index = 0;
  return {
    async generateText(request?: {
      abortSignal?: AbortSignal;
      messages?: unknown;
      tools?: readonly { name: string }[];
    }) {
      onCall?.();
      log?.requests.push({ messages: request?.messages, tools: request?.tools });
      const planned: ActorPlan = responses[index++] ?? {
        kind: "text",
        text: "(no further scripted response)",
      };
      if (planned.kind === "hang") return new Promise(() => {});
      if (planned.kind === "hang-until-cancelled") {
        const signal = request?.abortSignal;
        if (signal === undefined) return new Promise(() => {});
        return new Promise((_resolve, reject) => {
          const fail = (): void => reject(new Error("model request aborted"));
          if (signal.aborted) fail();
          else signal.addEventListener("abort", fail, { once: true });
        });
      }
      if (planned.kind === "throw") throw planned.error;
      const usage = { inputTokens: 12, outputTokens: 8, totalTokens: 20 };
      if (planned.kind === "submit") {
        return {
          finishReason: "tool-calls",
          model: "scripted",
          providerMetadata: undefined,
          text: "",
          toolCalls: [
            {
              id: `submit-call-${index}`,
              name: SUBMIT_RESULT_TOOL_NAME,
              input: { result: planned.result },
            },
          ],
          usage,
        };
      }
      if (planned.kind === "write") {
        return {
          finishReason: "tool-calls",
          model: "scripted",
          providerMetadata: undefined,
          text: "",
          toolCalls: [
            {
              id: `write-call-${index}`,
              name: "Write",
              input: { file_path: planned.path, content: planned.content },
            },
          ],
          usage,
        };
      }
      if (planned.kind === "escalate") {
        return {
          finishReason: "tool-calls",
          model: "scripted",
          providerMetadata: undefined,
          text: "",
          toolCalls: [
            {
              id: `escalate-call-${index}`,
              name: ESCALATE_TOOL_NAME,
              input: {
                question: planned.question,
                ...(planned.context === undefined ? {} : { context: planned.context }),
              },
            },
          ],
          usage,
        };
      }
      return {
        finishReason: "stop",
        model: "scripted",
        providerMetadata: undefined,
        text: planned.text,
        usage,
      };
    },
  };
}

interface HarnessOptions {
  actorScripts?: Record<string, ActorPlan[]>;
  availableParallelism?: () => number;
  
  concurrency?: WorkflowConcurrencyPort;
  journal?: JournalStorePort;
  
  hangActors?: boolean;
  
  quiesceMs?: number;
  onRunEvent?: (progress: DynamicWorkflowRunProgressPayload) => void;
  
  permissionMode?: () => CollaborationMode;
  
  parentSessionId?: string;
  
  registerResidencyBlockingWork?: (work: Promise<unknown>) => void;
  
  resolveLaunchInputId?: (trace: { turnId?: string }) => string | undefined;
  
  resumeSessionMissing?: boolean;
  
  sessionStore?: SessionStorePort;
  
  artifactStore?: ToolArtifactStorePort;
  taskLinkStore?: { createSessionTaskLink(input: CreateSessionTaskLinkInput): Promise<unknown> };
  
  writeWorkflowDraft?: Parameters<typeof createDynamicWorkflowRunService>[0]["writeWorkflowDraft"];
  
  executionPort?: ExecutionPort;
}

interface Harness {
  
  actorEventStore: SessionEventStorePort;
  
  actorModelRequests: Record<string, ModelRequestLog>;
  actorRuntimeInputs: DynamicWorkflowActorRuntimeInput[];
  
  actorSubscribeCalls: SessionId[];
  journal: JournalStorePort;
  
  logs: { level: string; message: string; context?: Record<string, unknown> }[];
  
  order: string[];
  persistedTitles: string[];
  
  resumeCalls: SessionId[];
  runEvents: DynamicWorkflowRunProgressPayload[];
  runEventRoutings: { parentSessionId?: string }[];
  service: ReturnType<typeof createDynamicWorkflowRunService>;
  sessionEvents: unknown[];
  taskLinks: CreateSessionTaskLinkInput[];
}

const HARNESS_PARENT_SESSION = createSessionId("harness-parent");

const HARNESS_PARENT_MODEL = createTestModelSelection("test/default-runtime-model");

class SweepableJournalStore extends InMemoryJournalStore {
  private readonly createdRunIds: string[] = [];
  
  private readonly rowTimes = new Map<string, number>();
  private clock = 1_700_000_000_000;

  override createRun(record: RunRecord): void {
    super.createRun(record);
    this.createdRunIds.push(record.runId);
    this.clock += 1;
    this.rowTimes.set(record.runId, this.clock);
  }

  
  rowTimeOf(runId: string): number {
    const time = this.rowTimes.get(runId);
    if (time === undefined) throw new Error(`no row time for ${runId}`);
    return time;
  }

  listNonTerminalRuns(parentSessionId: string): RunRecord[] {
    return this.createdRunIds
      .map((runId) => this.getRun(runId))
      .filter(
        (run): run is RunRecord =>
          run !== undefined &&
          run.parentSessionId === parentSessionId &&
          !["completed", "errored", "stopped"].includes(run.status),
      );
  }

  
  listRunsByParentSession(parentSessionId: string, limit: number): DwfRunSessionListItem[] {
    return this.createdRunIds
      .map((runId) => this.getRun(runId))
      .filter(
        (run): run is RunRecord => run !== undefined && run.parentSessionId === parentSessionId,
      )
      .reverse()
      .slice(0, Math.max(0, limit))
      .map((run) => {
        const { result: _result, ...rest } = run;
        return {
          ...rest,
          timeCreated: this.rowTimeOf(run.runId),
          timeUpdated: this.rowTimeOf(run.runId),
        };
      });
  }

  
  listArtifactRows(runId: string): NodeRecord[] {
    return this.listNodes(runId, { kinds: "all", withResult: true }).filter(
      (node) => node.kind === "artifact",
    );
  }

  
  listArtifactItems(
    runId: string,
    artifactId: string,
    query: { afterSequence?: number; limit: number; maxBytes: number },
  ): { items: DwfArtifactItem[]; hasMore: boolean } {
    if (query.limit <= 0) return { items: [], hasMore: false };
    const after = query.afterSequence ?? -1;
    const items: DwfArtifactItem[] = [];
    for (const stored of this.listEvents(runId, { types: "all", reportItems: "all" })) {
      if (stored.sequence <= after) continue;
      const event = stored.event as {
        type?: string;
        instance?: unknown;
        item?: unknown;
        artifactId?: unknown;
      };
      if (event.type !== "report" || event.artifactId !== artifactId) continue;
      if (items.length >= query.limit) return { items, hasMore: true };
      const instance = event.instance as { siteId?: string; ordinal?: number } | undefined;
      items.push({
        item: event.item,
        ordinal: instance?.ordinal ?? 0,
        sequence: stored.sequence,
        siteId: instance?.siteId ?? "report#1",
      });
    }
    return { items, hasMore: false };
  }
}

function preloadRun(
  journal: JournalStorePort,
  input: {
    spentTokens?: number;
    caps?: { maxConcurrency: number };
    cwd?: string;
    failure?: { code: string; message: string };
    name?: string;
    parentSessionId?: string;
    result?: unknown;
    runId: string;
    scriptText?: string;
    status: RunStatus;
    stopReason?: RunStopReason;
  },
): void {
  journal.createRun({
    runId: input.runId,
    ...(input.stopReason === undefined ? {} : { stopReason: input.stopReason }),
    ...(input.parentSessionId === undefined ? {} : { parentSessionId: input.parentSessionId }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.scriptText === undefined ? {} : { scriptText: input.scriptText }),
    ...(input.failure === undefined ? {} : { failure: input.failure as never }),
    ...("result" in input ? { result: input.result } : {}),
    caps: input.caps ?? { maxConcurrency: 4 },
    spentTokens: input.spentTokens ?? 0,
    status: input.status,
  });
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const journal = options.journal ?? new SweepableJournalStore();
  const actorRuntimeInputs: DynamicWorkflowActorRuntimeInput[] = [];
  const logs: { level: string; message: string; context?: Record<string, unknown> }[] = [];
  const persistedTitles: string[] = [];
  const runEvents: DynamicWorkflowRunProgressPayload[] = [];
  const runEventRoutings: { parentSessionId?: string }[] = [];
  const sessionEvents: unknown[] = [];
  const actorSubscribeCalls: SessionId[] = [];
  const resumeCalls: SessionId[] = [];
  const actorEventStore = createInMemorySessionEventStore();
  const taskLinks: CreateSessionTaskLinkInput[] = [];
  const order: string[] = [];
  const actorModelRequests: Record<string, ModelRequestLog> = {};

  const fileSystemPort = fakeFileSystemPort({});
  const logger = {
    debug: (message: string, context?: Record<string, unknown>) =>
      logs.push({ level: "debug", message, context }),
    error: (message: string, context?: Record<string, unknown>) =>
      logs.push({ level: "error", message, context }),
    info: (message: string, context?: Record<string, unknown>) =>
      logs.push({ level: "info", message, context }),
    warn: (message: string, context?: Record<string, unknown>) =>
      logs.push({ level: "warn", message, context }),
  };

  const service = createDynamicWorkflowRunService({
    ...(options.availableParallelism ? { availableParallelism: options.availableParallelism } : {}),
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    ...(options.resolveLaunchInputId === undefined
      ? {}
      : { resolveLaunchInputId: options.resolveLaunchInputId }),
    ...(options.sessionStore === undefined ? {} : { actorTranscriptStore: options.sessionStore }),
    ...(options.artifactStore === undefined ? {} : { artifactStore: options.artifactStore }),
    ...(options.quiesceMs === undefined ? {} : { driverClock: { quiesceMs: options.quiesceMs } }),
    createActorRuntime: (input) => {
      actorRuntimeInputs.push(input);
      const key = refToString(input.actor);
      const responses: ActorPlan[] = options.hangActors
        ? []
        : (options.actorScripts?.[key] ?? [{ kind: "submit", result: { text: "done" } }]);
      order.push(`construct:${key}`);
      const modelRequests: ModelRequestLog = { requests: [] };
      actorModelRequests[key] = modelRequests;
      const runtime = createTestAgentRuntime(
        input.sessionId,
        {
          systemPrompt: input.persona.system ?? "You are a workflow actor.",
          mode: "yolo",
          taskType: "workflow_child",
          subagents: { enabled: false },
          ...workflowActorToolPolicy(input.persona),
          ...workflowActorModelPolicy(
            {
              parentSelection: HARNESS_PARENT_MODEL,
              ...(input.runSubagentModel === undefined
                ? {}
                : { runSelection: input.runSubagentModel }),
              ...(input.actorModel === undefined ? {} : { actorSelection: input.actorModel }),
            },
            input.pinnedModel,
          ).configOverrides,
        },
        {
          eventStore: actorEventStore,
          eventSink: {
            onSessionEvent: (event) => {
              if (sessionEvents.length === 0) order.push("sink");
              sessionEvents.push(event);
            },
          },
          modelAdapter: (options.hangActors
            ? {
                generateText: () => new Promise(() => {}),
              }
            : scriptedModelAdapter(
                responses,
                () => order.push(`turn:${refToString(input.actor)}`),
                modelRequests,
              )) as never,
          workflowSubmitPort: input.submitPort,
          workflowEscalatePort: input.escalatePort,
          fileSystemPort,
          ...(options.sessionStore === undefined ? {} : { sessionStore: options.sessionStore }),
        },
      );
      const originalSubscribe = runtime.subscribeEvents.bind(runtime);
      runtime.subscribeEvents = (sink) => {
        actorSubscribeCalls.push(input.sessionId);
        return originalSubscribe(sink);
      };
      const original = runtime.ensureSessionPersistedForExternalActivity.bind(runtime);
      runtime.ensureSessionPersistedForExternalActivity = async (title, opts) => {
        persistedTitles.push(title);
        order.push(`persist:${key}`);
        return original(title, opts);
      };
      runtime.resumeFromStore = async () => {
        order.push(`resume:${key}`);
        resumeCalls.push(input.sessionId);
        if (options.resumeSessionMissing) {
          const gone = new Error("session not found (harness)");
          (gone as unknown as { type: unknown }).type = CoreErrorType.SessionNotFound;
          throw gone;
        }
        return { resumed: true } as never;
      };
      return runtime;
    },
    executionPort: options.executionPort ?? unsupportedExecutionPort(),
    fileSystemPort,
    journal,
    logger: logger as never,
    onRunEvent: (progress, routing) => {
      runEvents.push(progress);
      runEventRoutings.push(routing);
      options.onRunEvent?.(progress);
    },
    parentSessionId: options.parentSessionId ?? HARNESS_PARENT_SESSION,
    ...(options.writeWorkflowDraft === undefined
      ? {}
      : { writeWorkflowDraft: options.writeWorkflowDraft }),
    ...(options.permissionMode === undefined ? {} : { permissionMode: options.permissionMode }),
    ...(options.registerResidencyBlockingWork === undefined
      ? {}
      : { registerResidencyBlockingWork: options.registerResidencyBlockingWork }),
    ...(options.taskLinkStore
      ? { taskLinkStore: options.taskLinkStore }
      : {
          taskLinkStore: {
            async createSessionTaskLink(input) {
              order.push(`link:${input.childSessionId}`);
              taskLinks.push(input);
              return input;
            },
          },
        }),
  });

  return {
    actorEventStore,
    actorModelRequests,
    actorRuntimeInputs,
    actorSubscribeCalls,
    journal,
    logs,
    order,
    persistedTitles,
    resumeCalls,
    runEventRoutings,
    runEvents,
    service,
    sessionEvents,
    taskLinks,
  };
}

async function submitRun(
  harness: Harness,
  request: Parameters<Harness["service"]["submit"]>[0],
): Promise<string> {
  const result = await harness.service.submit(request);
  return result.runId;
}

async function amendRun(
  harness: Harness,
  request: Parameters<NonNullable<Harness["service"]["amend"]>>[0],
): Promise<{ runId: string; supersededRunId?: string }> {
  const result = await harness.service.amend!(request);
  if (!result.ok) throw new Error(`amend refused unexpectedly: ${result.reason}`);
  return result;
}

async function settle(harness: Harness, runId: string): Promise<void> {
  await harness.service.waitForTask(runId);
}

describe("dynamic workflow run service — 在飞计数与结算订阅（registry 安全边界的读面）", () => {
  it("submit 后 countLiveRuns 为 1；结算后归零，监听器恰好收到一次、计数已扣掉本 run", async () => {
    const harness = makeHarness();
    const notices: { runId: string; liveRunCount: number }[] = [];
    const unsubscribe = harness.service.subscribeRunSettled((notice) => {
      notices.push(notice);
    });

    expect(harness.service.countLiveRuns()).toBe(0);
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: createSessionId("live-count-parent"),
      scriptText: TYPED_SCRIPT,
      toolCallId: createToolCallId("live-count-call"),
      trace: traceFor("live-count"),
    });
    expect(harness.service.countLiveRuns()).toBe(1);
    expect(notices).toEqual([]);

    await settle(harness, runId);

    expect(harness.service.countLiveRuns()).toBe(0);
    expect(notices).toEqual([{ runId, liveRunCount: 0 }]);

    unsubscribe();
    const second = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: createSessionId("live-count-parent"),
      scriptText: TYPED_SCRIPT,
      toolCallId: createToolCallId("live-count-call-2"),
      trace: traceFor("live-count-2"),
    });
    await settle(harness, second);
    expect(notices).toHaveLength(1);
    expect(harness.service.countLiveRuns()).toBe(0);
  });

  it("监听器抛错只记日志，不影响结算与其他监听器", async () => {
    const harness = makeHarness();
    const seen: string[] = [];
    harness.service.subscribeRunSettled(() => {
      throw new Error("listener boom");
    });
    harness.service.subscribeRunSettled((notice) => {
      seen.push(notice.runId);
    });

    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: createSessionId("listener-throw-parent"),
      scriptText: TYPED_SCRIPT,
      toolCallId: createToolCallId("listener-throw-call"),
      trace: traceFor("listener-throw"),
    });
    await settle(harness, runId);

    expect((await harness.service.getTask(runId))?.status).toBe("completed");
    expect(seen).toEqual([runId]);
    expect(
      harness.logs.some(
        (log) =>
          log.level === "warn" &&
          log.context?.event === "dynamic_workflow.run.settled_listener_failed",
      ),
    ).toBe(true);
  });
});

describe("dynamic workflow run service — 常驻登记（Engine ownership 规则一）", () => {
  
  function recorder(): {
    register: (work: Promise<unknown>) => void;
    settled: boolean[];
    works: Promise<unknown>[];
  } {
    const works: Promise<unknown>[] = [];
    const settled: boolean[] = [];
    return {
      settled,
      works,
      register: (work: Promise<unknown>) => {
        const index = works.push(work) - 1;
        settled[index] = false;
        void work.then(() => {
          settled[index] = true;
        });
      },
    };
  }

  it("submit 在同一同步片登记恰好一次，登记的 promise 随 run 结算解除", async () => {
    const hook = recorder();
    const harness = makeHarness({ registerResidencyBlockingWork: hook.register });

    const submitted = harness.service.submit({
      cwd: TEST_CWD,
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("residency-submit"),
    });
    expect(hook.works).toHaveLength(1);

    const runId = (await submitted).runId;
    expect(hook.settled[0]).toBe(false);
    expect(harness.service.countLiveRuns()).toBe(1);

    await settle(harness, runId);
    await hook.works[0];
    expect(hook.settled[0]).toBe(true);
    expect(hook.works).toHaveLength(1);
    expect(harness.journal.getRun(runId)?.status).toBe("completed");
  });

  it("resume 同样在同一同步片登记一次（登记的是新起的那条结算）", async () => {
    const hook = recorder();
    const journal = new SweepableJournalStore();
    const runId = "dwfrun-residency-resume";
    preloadRun(journal, {
      cwd: TEST_CWD,
      parentSessionId: HARNESS_PARENT_SESSION,
      runId,
      scriptText: TYPED_SCRIPT,
      status: "stopped",
      stopReason: "user",
    });
    const harness = makeHarness({
      journal,
      registerResidencyBlockingWork: hook.register,
    });

    const resumed = harness.service.resume!(runId);
    expect(hook.works).toHaveLength(1);

    expect(await resumed).toMatchObject({ ok: true, runId });
    expect(hook.settled[0]).toBe(false);

    await settle(harness, runId);
    await hook.works[0];
    expect(hook.settled[0]).toBe(true);
    expect(hook.works).toHaveLength(1);
    expect(harness.journal.getRun(runId)?.status).toBe("completed");
  });
});

describe("dynamic workflow run service — submit", () => {
  it("返回 runId 并把 run 跑到 completed", async () => {
    const harness = makeHarness();

    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: createSessionId("submit-parent"),
      scriptText: TYPED_SCRIPT,
      toolCallId: createToolCallId("submit-call"),
      trace: traceFor("submit-ok"),
    });

    expect(runId).toBeTruthy();
    await settle(harness, runId);

    const snapshot = await harness.service.getTask(runId);
    expect(snapshot?.status).toBe("completed");
    expect(snapshot?.output).toBe("done");
  });

  it("runId 字符集安全：无 # @ /", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("submit-charset"),
    });
    await settle(harness, runId);

    expect(runId).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("一次 submit 只建一个 ts.Program", async () => {
    const harness = makeHarness();
    compiledScripts.length = 0;

    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("submit-compile-once"),
    });
    await settle(harness, runId);

    expect(compiledScripts.filter((script) => script === TYPED_SCRIPT)).toHaveLength(1);
  });

  it("submit 不预插 dwf_run 行，run 由引擎创建", async () => {
    const journal = new InMemoryJournalStore();
    const createRun = vi.spyOn(journal, "createRun");
    const getRun = vi.spyOn(journal, "getRun");
    const harness = makeHarness({ journal });

    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("submit-create-run"),
    });
    await settle(harness, runId);

    expect(createRun).toHaveBeenCalledTimes(1);
    const firstGetRunResult = getRun.mock.results[0];
    expect(firstGetRunResult?.value).toBeUndefined();
  });

  it("scriptText / scriptHash / parentSessionId / cwd 落库", async () => {
    const harness = makeHarness();
    const parentSessionId = createSessionId("meta-parent");

    const runId = await submitRun(harness, {
      cwd: "/tmp/dwf-meta",
      parentSessionId,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("submit-meta"),
    });
    await settle(harness, runId);

    const record = harness.journal.getRun(runId);
    expect(record?.scriptText).toBe(TYPED_SCRIPT);
    expect(record?.parentSessionId).toBe(parentSessionId);
    expect(record?.cwd).toBe("/tmp/dwf-meta");
    const { createHash } = await import("node:crypto");
    expect(record?.scriptHash).toBe(
      createHash("sha256").update(TYPED_SCRIPT, "utf8").digest("hex"),
    );
  });

  it("脏脚本硬失败且不建 run", async () => {
    const journal = new InMemoryJournalStore();
    const createRun = vi.spyOn(journal, "createRun");
    const harness = makeHarness({ journal });

    await expect(
      harness.service.submit({
        cwd: TEST_CWD,
        scriptText: BROKEN_SCRIPT,
        trace: traceFor("submit-broken"),
      }),
    ).rejects.toThrow(/does not typecheck/);

    expect(createRun).not.toHaveBeenCalled();
    expect(harness.actorRuntimeInputs).toEqual([]);
  });

  it("caps 只剩并发上界；双核机器的默认并发地板为 4", async () => {
    const harness = makeHarness({ availableParallelism: () => 2 });
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("submit-caps"),
    });
    await settle(harness, runId);

    const record = harness.journal.getRun(runId);
    expect(record?.caps).toEqual({ maxConcurrency: 4 });
  });

  it("默认并发的硬顶为 16", async () => {
    const harness = makeHarness({ availableParallelism: () => 64 });
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("submit-caps-ceiling"),
    });
    await settle(harness, runId);

    expect(harness.journal.getRun(runId)?.caps.maxConcurrency).toBe(16);
  });
});

describe("dynamic workflow run service — 请求的并发上界", () => {
  
  const TEN_CORES = () => 10;
  const DEFAULT_OF_TEN_CORES = 8;

  async function submitWithLimit(
    harness: Harness,
    name: string,
    maxConcurrency?: number,
  ): Promise<string> {
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      ...(maxConcurrency === undefined ? {} : { maxConcurrency }),
      trace: traceFor(name),
    });
    await settle(harness, runId);
    return runId;
  }

  it("请求低于默认并发 → 原样落 dwf_run.caps_max_concurrency", async () => {
    const harness = makeHarness({ availableParallelism: TEN_CORES });
    const runId = await submitWithLimit(harness, "limit-3", 3);
    expect(harness.journal.getRun(runId)?.caps).toEqual({ maxConcurrency: 3 });
  });

  it("请求高于默认并发 → 原样照用（没有上限：默认是起点不是天花板）", async () => {
    const harness = makeHarness({ availableParallelism: TEN_CORES });
    const runId = await submitWithLimit(harness, "limit-99", 99);
    expect(harness.journal.getRun(runId)?.caps.maxConcurrency).toBe(99);
  });

  it("缺席 → 默认并发", async () => {
    const harness = makeHarness({ availableParallelism: TEN_CORES });
    const runId = await submitWithLimit(harness, "limit-absent");
    expect(harness.journal.getRun(runId)?.caps.maxConcurrency).toBe(DEFAULT_OF_TEN_CORES);
  });

  it("0 / 负数 → 地板 1；非整数向下取整（绝不偷偷越过用户说的数）", async () => {
    const harness = makeHarness({ availableParallelism: TEN_CORES });
    const zero = await submitWithLimit(harness, "limit-zero", 0);
    expect(harness.journal.getRun(zero)?.caps.maxConcurrency).toBe(1);
    const negative = await submitWithLimit(harness, "limit-negative", -5);
    expect(harness.journal.getRun(negative)?.caps.maxConcurrency).toBe(1);
    const fractional = await submitWithLimit(harness, "limit-fractional", 3.7);
    expect(harness.journal.getRun(fractional)?.caps.maxConcurrency).toBe(3);
  });

  it("amend 把上界带到后继 run（前驱的值不被继承——三态归一在工具层）", async () => {
    const harness = makeHarness({ availableParallelism: TEN_CORES, hangActors: true });
    const predecessor = await submitRun(harness, {
      cwd: TEST_CWD,
      maxConcurrency: 2,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("amend-limit-a"),
    });
    await vi.waitFor(() => {
      expect(harness.journal.getRun(predecessor)?.caps.maxConcurrency).toBe(2);
    });

    const amended = await amendRun(harness, {
      cwd: TEST_CWD,
      maxConcurrency: 5,
      predecessorRunId: predecessor,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("amend-limit-b"),
    });
    await vi.waitFor(() => {
      expect(harness.journal.getRun(amended.runId)?.caps.maxConcurrency).toBe(5);
    });
    expect(await harness.service.cancel(amended.runId)).toBe(true);
    await settle(harness, amended.runId);

    const inherited = await amendRun(harness, {
      cwd: TEST_CWD,
      predecessorRunId: predecessor,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("amend-limit-c"),
    });
    await vi.waitFor(() => {
      expect(harness.journal.getRun(inherited.runId)?.caps.maxConcurrency).toBe(
        DEFAULT_OF_TEN_CORES,
      );
    });
    expect(await harness.service.cancel(inherited.runId)).toBe(true);
    await settle(harness, inherited.runId);
  });

  it("defaultConcurrency() 与默认并发的唯一实现同值（必须与缺省落库的那个数对得上）", () => {
    const harness = makeHarness({ availableParallelism: TEN_CORES });
    expect(harness.service.defaultConcurrency!()).toBe(
      resolveWorkflowDefaultConcurrency(TEN_CORES),
    );
    expect(harness.service.defaultConcurrency!()).toBe(DEFAULT_OF_TEN_CORES);
  });

  it("快照只在不等于默认并发时带 maxConcurrency（高于、低于都带）", async () => {
    const harness = makeHarness({ availableParallelism: TEN_CORES });
    const limited = await submitWithLimit(harness, "snapshot-limited", 2);
    expect(await harness.service.getTask(limited)).toMatchObject({ maxConcurrency: 2 });
    const raised = await submitWithLimit(harness, "snapshot-raised", 20);
    expect(await harness.service.getTask(raised)).toMatchObject({ maxConcurrency: 20 });

    const unlimited = await submitWithLimit(harness, "snapshot-unlimited");
    const snapshot = await harness.service.getTask(unlimited);
    expect("maxConcurrency" in snapshot!).toBe(false);
    const explicitDefault = await submitWithLimit(
      harness,
      "snapshot-default",
      DEFAULT_OF_TEN_CORES,
    );
    expect("maxConcurrency" in (await harness.service.getTask(explicitDefault))!).toBe(false);
  });

  it("间隙里的快照与详情读注册表副本，答案与落行后一致", async () => {
    await withSqliteJournal(async (real) => {
      const hidden = new Set<string>();
      const journal = hideRunsFromReads(real, hidden);
      const harness = makeHarness({
        availableParallelism: TEN_CORES,
        hangActors: true,
        journal,
      });

      const runId = await submitRun(harness, {
        cwd: projectCwd,
        maxConcurrency: 2,
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: TYPED_SCRIPT,
        trace: traceFor("limit-gap"),
      });
      hidden.add(runId);

      expect(await harness.service.getTask(runId)).toMatchObject({ maxConcurrency: 2 });
      expect(await introspectionOf(harness).getRunDetail(runId)).toMatchObject({
        maxConcurrency: 2,
      });

      hidden.delete(runId);
      await vi.waitFor(async () => {
        expect(await introspectionOf(harness).getRunDetail(runId)).toMatchObject({
          maxConcurrency: 2,
        });
      });

      await harness.service.cancel(runId);
      await settle(harness, runId);
    });
  });

  it("getRunDetail includes maxConcurrency, while list rows do not (rarely-set fields shouldn\'t widen every row)", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ availableParallelism: TEN_CORES, journal });
      const limited = await submitRun(harness, {
        cwd: projectCwd,
        maxConcurrency: 2,
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: TYPED_SCRIPT,
        trace: traceFor("detail-limited"),
      });
      await settle(harness, limited);
      const unlimited = await submitRun(harness, {
        cwd: projectCwd,
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: TYPED_SCRIPT,
        trace: traceFor("detail-unlimited"),
      });
      await settle(harness, unlimited);

      const introspection = introspectionOf(harness);
      expect(await introspection.getRunDetail(limited)).toMatchObject({ maxConcurrency: 2 });
      const plain = await introspection.getRunDetail(unlimited);
      expect("maxConcurrency" in plain!).toBe(false);

      const { runs } = await introspection.listRuns({ cwd: projectCwd, limit: 20 });
      expect(runs).toHaveLength(2);
      for (const row of runs) expect("maxConcurrency" in row).toBe(false);
    });
  });

  it("run-started 载荷带 concurrencyCeiling，与引擎的 caps 并列", async () => {
    const harness = makeHarness({ availableParallelism: TEN_CORES });
    const runId = await submitWithLimit(harness, "payload-ceiling", 2);

    const started = harness.runEvents.find(
      (event) => event.runId === runId && event.eventType === "run-started",
    );
    expect(started?.payload).toMatchObject({
      caps: { maxConcurrency: 2 },
      concurrencyCeiling: DEFAULT_OF_TEN_CORES,
    });
  });
});

describe("dynamic workflow run service — retuneConcurrency", () => {
  const TEN_CORES = () => 10;
  const DEFAULT_OF_TEN_CORES = 8;

  
  async function liveRun(harness: Harness, name: string, maxConcurrency?: number): Promise<string> {
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      ...(maxConcurrency === undefined ? {} : { maxConcurrency }),
      trace: traceFor(name),
    });
    await vi.waitFor(() => {
      expect(harness.journal.getRun(runId)?.caps).toBeDefined();
    });
    return runId;
  }

  function retune(harness: Harness, runId: string, maxConcurrency: number | null) {
    return harness.service.retuneConcurrency!({ maxConcurrency, runId });
  }

  async function stop(harness: Harness, runId: string): Promise<void> {
    await harness.service.cancel(runId);
    await settle(harness, runId);
  }

  it("在飞 run：行、注册表副本与事件三处同时挪动，同一个 runId、没有后继", async () => {
    const harness = makeHarness({ availableParallelism: TEN_CORES, hangActors: true });
    const runId = await liveRun(harness, "retune-ok", 4);

    expect(await retune(harness, runId, 2)).toEqual({
      ok: true,
      maxConcurrency: 2,
      previous: 4,
      defaultConcurrency: DEFAULT_OF_TEN_CORES,
    });
    expect(harness.journal.getRun(runId)?.caps).toEqual({ maxConcurrency: 2 });
    expect(await harness.service.getTask(runId)).toMatchObject({ maxConcurrency: 2 });

    const changed = harness.runEvents.filter(
      (event) => event.runId === runId && event.eventType === "run-caps-changed",
    );
    expect(changed).toHaveLength(1);
    expect(changed[0]?.payload).toMatchObject({
      runId,
      caps: { maxConcurrency: 2 },
      previous: { maxConcurrency: 4 },
      concurrencyCeiling: DEFAULT_OF_TEN_CORES,
    });
    await stop(harness, runId);
  });

  it("同一个值 ⇒ unchanged，点名此刻生效的上界；什么都不写、什么都不发", async () => {
    const harness = makeHarness({ availableParallelism: TEN_CORES, hangActors: true });
    const runId = await liveRun(harness, "retune-unchanged", 3);

    expect(await retune(harness, runId, 3)).toEqual({ ok: false, reason: "unchanged", current: 3 });
    expect(harness.journal.getRun(runId)?.caps).toEqual({ maxConcurrency: 3 });
    expect(
      harness.runEvents.filter((event) => event.eventType === "run-caps-changed"),
    ).toHaveLength(0);
    await stop(harness, runId);
  });

  it("高于默认并发照用、没有上限；等于默认时读面把字段整个撤掉", async () => {
    const harness = makeHarness({ availableParallelism: TEN_CORES, hangActors: true });
    const runId = await liveRun(harness, "retune-clamp", 2);

    expect(await retune(harness, runId, 99)).toEqual({
      ok: true,
      maxConcurrency: 99,
      previous: 2,
      defaultConcurrency: DEFAULT_OF_TEN_CORES,
    });
    expect(await harness.service.getTask(runId)).toMatchObject({ maxConcurrency: 99 });
    expect(await retune(harness, runId, DEFAULT_OF_TEN_CORES)).toMatchObject({ ok: true });
    const snapshot = await harness.service.getTask(runId);
    expect("maxConcurrency" in snapshot!).toBe(false);
    expect(await retune(harness, runId, 0)).toMatchObject({ ok: true, maxConcurrency: 1 });
    await stop(harness, runId);
  });

  it("null = default concurrency = remove this run\'s own limit", async () => {
    const harness = makeHarness({ availableParallelism: TEN_CORES, hangActors: true });
    const runId = await liveRun(harness, "retune-null", 2);

    expect(await retune(harness, runId, null)).toEqual({
      ok: true,
      maxConcurrency: DEFAULT_OF_TEN_CORES,
      previous: 2,
      defaultConcurrency: DEFAULT_OF_TEN_CORES,
    });
    expect(harness.journal.getRun(runId)?.caps.maxConcurrency).toBe(DEFAULT_OF_TEN_CORES);
    expect(await retune(harness, runId, null)).toMatchObject({ ok: false, reason: "unchanged" });
    await stop(harness, runId);
  });

  it("launch 登记上界、retune 覆盖、结算清掉：治理器上的增长上限跟着 run 走", async () => {
    const governor = createWorkflowConcurrencyGovernor({
      defaultConcurrency: DEFAULT_OF_TEN_CORES,
    });
    const calls: string[] = [];
    const concurrency: WorkflowConcurrencyPort = {
      tryAdmit: (runId, key) => governor.tryAdmit(runId, key),
      admit: (runId, key, signal) => governor.admit(runId, key, signal),
      subscribe: (runId, listener) => governor.subscribe(runId, listener),
      setRunBound: (runId, bound) => {
        calls.push(`set:${runId}:${bound}`);
        governor.setRunBound(runId, bound);
      },
      clearRunBound: (runId) => {
        calls.push(`clear:${runId}`);
        governor.clearRunBound(runId);
      },
    };
    const harness = makeHarness({ availableParallelism: TEN_CORES, hangActors: true, concurrency });
    const runId = await liveRun(harness, "retune-governor", 30);
    await vi.waitFor(() => {
      expect(calls).toContain(`set:${runId}:30`);
    });
    expect(await retune(harness, runId, 40)).toMatchObject({ ok: true, maxConcurrency: 40 });
    expect(calls).toContain(`set:${runId}:40`);
    await stop(harness, runId);
    await vi.waitFor(() => {
      expect(calls.at(-1)).toBe(`clear:${runId}`);
    });
  });

  it("结算之后与未知 run 都是 not_live（调用方回落到一次真正的修订）", async () => {
    const harness = makeHarness({ availableParallelism: TEN_CORES, hangActors: true });
    const runId = await liveRun(harness, "retune-settled", 4);
    await stop(harness, runId);

    expect(await retune(harness, runId, 2)).toEqual({ ok: false, reason: "not_live" });
    expect(await retune(harness, "dwfrun-nobody", 2)).toEqual({ ok: false, reason: "not_live" });
    expect(harness.journal.getRun(runId)?.caps).toEqual({ maxConcurrency: 4 });
  });

  it("resume 从 retune 之后的上界起跑（行是 caps 的权威，条目抄的也是它）", async () => {
    const harness = makeHarness({ availableParallelism: TEN_CORES, hangActors: true });
    const runId = await liveRun(harness, "retune-resume", 4);
    expect(await retune(harness, runId, 2)).toMatchObject({ ok: true, maxConcurrency: 2 });
    await stop(harness, runId);

    const resumed = await harness.service.resume!(runId);
    expect(resumed).toMatchObject({ ok: true, runId });
    await vi.waitFor(() => {
      expect(harness.journal.getRun(runId)?.caps).toEqual({ maxConcurrency: 2 });
    });
    expect(await harness.service.getTask(runId)).toMatchObject({ maxConcurrency: 2 });
    expect(await retune(harness, runId, 5)).toMatchObject({ ok: true, previous: 2 });
    await stop(harness, runId);
  });

  it("live 与冷回放为同一条 run-caps-changed 铸出逐字节相同的载荷", async () => {
    const journal = new SweepableJournalStore();
    const harness = makeHarness({
      availableParallelism: TEN_CORES,
      hangActors: true,
      journal,
    });
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      maxConcurrency: 4,
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("retune-live-vs-cold"),
    });
    await vi.waitFor(() => {
      expect(harness.journal.getRun(runId)?.caps).toBeDefined();
    });
    expect(await retune(harness, runId, 2)).toMatchObject({ ok: true });
    await stop(harness, runId);

    const live = harness.runEvents.find(
      (event) => event.runId === runId && event.eventType === "run-caps-changed",
    );
    const cold = makeHarness({ availableParallelism: TEN_CORES, journal });
    const replayed = await cold.service.replayProgressForSession!({ excludeRunIds: new Set() });
    const coldEvent = replayed.find(
      (event) => event.runId === runId && event.eventType === "run-caps-changed",
    );

    expect(live).toBeDefined();
    expect(coldEvent).toEqual(live);
  });

  it("冷回放给 run-caps-changed 铸上同一个 concurrencyCeiling", async () => {
    const journal = new SweepableJournalStore();
    preloadRun(journal, {
      runId: "dwfrun-retuned",
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: TYPED_SCRIPT,
      status: "stopped",
      stopReason: "user",
      caps: { maxConcurrency: 2 },
    });
    journal.appendEvent("dwfrun-retuned", {
      type: "run-started",
      caps: { maxConcurrency: 4 },
    } as never);
    journal.appendEvent("dwfrun-retuned", {
      type: "run-caps-changed",
      runId: "dwfrun-retuned",
      caps: { maxConcurrency: 2 },
      previous: { maxConcurrency: 4 },
    } as never);

    const harness = makeHarness({ availableParallelism: TEN_CORES, journal });
    const replayed = await harness.service.replayProgressForSession!({ excludeRunIds: new Set() });
    const changed = replayed.find((event) => event.eventType === "run-caps-changed");
    expect(changed?.payload).toEqual({
      runId: "dwfrun-retuned",
      caps: { maxConcurrency: 2 },
      previous: { maxConcurrency: 4 },
      concurrencyCeiling: DEFAULT_OF_TEN_CORES,
    });
  });
});

//
//
describe("dynamic workflow run service — AmendWorkflow 就地 retune（端到端）", () => {
  const TEN_CORES = () => 10;
  const DEFAULT_OF_TEN_CORES = 8;

  
  const THREE_PARALLEL_SCRIPT = [
    "interface Answer { text: string }",
    'const one = agent("one");',
    'const two = agent("two");',
    'const three = agent("three");',
    "const [a, b, c] = await Promise.all([",
    '  one.ask<Answer>("first"),',
    '  two.ask<Answer>("second"),',
    '  three.ask<Answer>("third"),',
    "]);",
    "return `${a.text}|${b.text}|${c.text}`;",
  ].join("\n");

  interface AmendOutcome {
    success: boolean;
    message: string;
    output: { response: string; diagnostics?: unknown[]; retuned?: Record<string, unknown> };
  }

  it("只带 max_concurrency 的一次调用：同一个 run 被就地改低，在飞 ask 一个不停", async () => {
    const journal = new SweepableJournalStore();
    const sessionId = createSessionId("retune-e2e");
    const harness = makeHarness({
      availableParallelism: TEN_CORES,
      hangActors: true,
      journal,
      parentSessionId: sessionId,
    });
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: sessionId,
      scriptText: THREE_PARALLEL_SCRIPT,
      trace: traceFor("retune-e2e"),
    });
    await vi.waitFor(() => {
      expect(
        journal
          .listNodes(runId, { kinds: "all", withResult: true })
          .filter((node) => node.status === "running"),
      ).toHaveLength(3);
    });
    expect(journal.getRun(runId)?.caps.maxConcurrency).toBe(DEFAULT_OF_TEN_CORES);
    const runsBefore = journal.listRunsByParentSession(sessionId, 50).length;

    const registry = createToolRegistry();
    const amendEntry = builtInTools.find((entry) => entry.metadata.name === "AmendWorkflow");
    expect(amendEntry).toBeDefined();
    registry.register(amendEntry!);
    const turnId = createTurnId("retune-e2e");
    const traceContext = createRootTraceContext({ sessionId, turnId });
    const permissionAsks: unknown[] = [];
    const executor = createToolExecutor({
      emitEvent: async () => {},
      dynamicWorkflowRunPort: harness.service,
      mode: "build",
      permissionBroker: {
        async requestPermission(request) {
          permissionAsks.push(request);
          return { decision: "allow" as const };
        },
      },
      permissionService: new PermissionService(defaultPermissionConfig),
      registry,
      sessionId,
      turnId,
      traceContext,
      workingDirectory: TEST_CWD,
    });
    const amend = async (maxConcurrency: number | null): Promise<AmendOutcome> => {
      const result = await executor.execute(
        {
          id: createToolCallId(`retune-e2e-${String(maxConcurrency)}`),
          input: { max_concurrency: maxConcurrency, run_id: runId },
          name: "AmendWorkflow",
        },
        { traceContext },
      );
      return {
        success: result.success,
        message: String(result.error?.message ?? ""),
        output: result.output as AmendOutcome["output"],
      };
    };

    const lowered = await amend(1);
    expect(lowered.success).toBe(true);
    expect(lowered.output.response).toBe(
      `Applied to the running run ${runId}; at most 1 subagent runs at once. ` +
        `Run ${runId} keeps running under it: nothing was stopped and no new run was started.`,
    );
    expect(lowered.output.retuned).toEqual({
      runId,
      maxConcurrency: 1,
      previous: DEFAULT_OF_TEN_CORES,
      defaultConcurrency: DEFAULT_OF_TEN_CORES,
    });
    expect(lowered.output).not.toHaveProperty("backgroundTaskId");
    expect(lowered.output).not.toHaveProperty("status");
    expect(lowered.output).not.toHaveProperty("causalityGraph");
    expect(lowered.output.diagnostics).toEqual([]);
    expect(permissionAsks).toEqual([]);

    expect(journal.listRunsByParentSession(sessionId, 50)).toHaveLength(runsBefore);
    const row = journal.getRun(runId);
    expect(row?.status).toBe("running");
    expect(row?.supersededBy).toBeUndefined();
    expect(row?.caps.maxConcurrency).toBe(1);
    expect(harness.runEvents.filter((event) => event.eventType === "run-settled")).toEqual([]);

    const changed = harness.runEvents.filter(
      (event) => event.runId === runId && event.eventType === "run-caps-changed",
    );
    expect(changed).toHaveLength(1);
    expect(changed[0]?.payload).toEqual({
      runId,
      caps: { maxConcurrency: 1 },
      previous: { maxConcurrency: DEFAULT_OF_TEN_CORES },
      concurrencyCeiling: DEFAULT_OF_TEN_CORES,
    });

    expect(await harness.service.getTask(runId)).toMatchObject({ maxConcurrency: 1 });

    expect(
      journal
        .listNodes(runId, { kinds: "all", withResult: true })
        .filter((node) => node.status === "running"),
    ).toHaveLength(3);
    expect(
      harness.runEvents.filter(
        (event) => event.runId === runId && event.eventType === "node-settled",
      ),
    ).toEqual([]);

    const again = await amend(1);
    expect(again.success).toBe(false);
    expect(again.message.startsWith("workflow_retune_unchanged:")).toBe(true);
    expect(again.message).toContain(runId);
    expect(journal.getRun(runId)?.caps.maxConcurrency).toBe(1);
    expect(
      harness.runEvents.filter(
        (event) => event.runId === runId && event.eventType === "run-caps-changed",
      ),
    ).toHaveLength(1);

    const raised = await amend(null);
    expect(raised.success).toBe(true);
    expect(raised.output.response).toBe(
      `Applied to the running run ${runId}; at most ${DEFAULT_OF_TEN_CORES} subagents run at once ` +
        `(the default). ` +
        `Run ${runId} keeps running under it: nothing was stopped and no new run was started.`,
    );
    expect(journal.getRun(runId)?.caps.maxConcurrency).toBe(DEFAULT_OF_TEN_CORES);
    const snapshot = await harness.service.getTask(runId);
    expect("maxConcurrency" in snapshot!).toBe(false);
    expect(
      harness.runEvents.filter(
        (event) => event.runId === runId && event.eventType === "run-caps-changed",
      ),
    ).toHaveLength(2);

    expect(
      journal
        .listNodes(runId, { kinds: "all", withResult: true })
        .filter((node) => node.status === "running"),
    ).toHaveLength(3);
    expect(await harness.service.cancel(runId)).toBe(true);
    await settle(harness, runId);
    expect(journal.getRun(runId)).toMatchObject({ status: "stopped", stopReason: "user" });
    expect(journal.listRunsByParentSession(sessionId, 50)).toHaveLength(runsBefore);
  });
});

//
describe("dynamic workflow run service — 本 run 的子代理模型", () => {
  
  const FLASH: ModelSelection = {
    providerId: "zhipu",
    modelId: "glm-5.3-flash",
    options: { reasoningLevel: "high" },
  };
  const FLASH_CANONICAL = "zhipu/glm-5.3-flash$high";
  
  const HAIKU: ModelSelection = { providerId: "anthropic", modelId: "haiku" };

  
  const launchedOf = (harness: Harness, runId: string): RunEvent | undefined =>
    harness.journal
      .listEvents(runId, { types: "all", reportItems: "all" })
      .map((stored) => stored.event)
      .find((event) => event.type === "run-launched");

  const subagentModelOf = (harness: Harness, runId: string): string | undefined => {
    const launched = launchedOf(harness, runId);
    return launched?.type === "run-launched" ? launched.subagentModel : undefined;
  };

  it("submit 把规范 picker 串记进 run-launched（含 reasoning 档位），行上没有这条事实", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      subagentModel: FLASH,
      trace: traceFor("subagent-model-submit"),
    });
    await settle(harness, runId);

    expect(subagentModelOf(harness, runId)).toBe(FLASH_CANONICAL);
    expect("subagentModel" in harness.journal.getRun(runId)!).toBe(false);
  });

  it("没有档位的选择记成两段；不设即整个键缺席（不是 undefined）", async () => {
    const harness = makeHarness();
    const levelled = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      subagentModel: HAIKU,
      trace: traceFor("subagent-model-two-part"),
    });
    await settle(harness, levelled);
    expect(subagentModelOf(harness, levelled)).toBe("anthropic/haiku");

    const plain = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("subagent-model-absent"),
    });
    await settle(harness, plain);
    expect("subagentModel" in launchedOf(harness, plain)!).toBe(false);
  });

  it("快照与详情给出同一个规范串；不设时两条读面都不带这个键", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      const chosen = await submitRun(harness, {
        cwd: projectCwd,
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: TYPED_SCRIPT,
        subagentModel: FLASH,
        trace: traceFor("subagent-model-read-set"),
      });
      await settle(harness, chosen);
      const plain = await submitRun(harness, {
        cwd: projectCwd,
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: TYPED_SCRIPT,
        trace: traceFor("subagent-model-read-absent"),
      });
      await settle(harness, plain);

      const introspection = introspectionOf(harness);
      expect(await harness.service.getTask(chosen)).toMatchObject({
        subagentModel: FLASH_CANONICAL,
      });
      expect(await introspection.getRunDetail(chosen)).toMatchObject({
        subagentModel: FLASH_CANONICAL,
      });

      const snapshot = await harness.service.getTask(plain);
      expect("subagentModel" in snapshot!).toBe(false);
      const detail = await introspection.getRunDetail(plain);
      expect("subagentModel" in detail!).toBe(false);

      const { runs } = await introspection.listRuns({ cwd: projectCwd, limit: 20 });
      expect(runs).toHaveLength(2);
      for (const row of runs) expect("subagentModel" in row).toBe(false);

      const cold = makeHarness({ journal });
      const coldIntrospection = introspectionOf(cold);
      expect(await cold.service.getTask(chosen)).toMatchObject({
        subagentModel: FLASH_CANONICAL,
      });
      expect(await coldIntrospection.getRunDetail(chosen)).toMatchObject({
        subagentModel: FLASH_CANONICAL,
      });
      expect("subagentModel" in (await cold.service.getTask(plain))!).toBe(false);
      expect("subagentModel" in (await coldIntrospection.getRunDetail(plain))!).toBe(false);
    });
  });

  it("间隙里的快照与详情读注册表副本，答案与落行后一致", async () => {
    await withSqliteJournal(async (real) => {
      const hidden = new Set<string>();
      const journal = hideRunsFromReads(real, hidden);
      const harness = makeHarness({ hangActors: true, journal });

      const runId = await submitRun(harness, {
        cwd: projectCwd,
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: TYPED_SCRIPT,
        subagentModel: FLASH,
        trace: traceFor("subagent-model-gap"),
      });
      hidden.add(runId);

      expect(await harness.service.getTask(runId)).toMatchObject({
        subagentModel: FLASH_CANONICAL,
      });
      expect(await introspectionOf(harness).getRunDetail(runId)).toMatchObject({
        subagentModel: FLASH_CANONICAL,
      });

      hidden.delete(runId);
      await vi.waitFor(async () => {
        expect(await introspectionOf(harness).getRunDetail(runId)).toMatchObject({
          subagentModel: FLASH_CANONICAL,
        });
      });

      await harness.service.cancel(runId);
      await settle(harness, runId);
    });
  });

  it("amend uses the value from the request, never inheriting predecessor\'s (tri-state normalization in tool layer)", async () => {
    const harness = makeHarness({ hangActors: true });
    const predecessor = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      subagentModel: FLASH,
      trace: traceFor("subagent-model-amend-a"),
    });
    await vi.waitFor(() => {
      expect(subagentModelOf(harness, predecessor)).toBe(FLASH_CANONICAL);
    });

    const amended = await amendRun(harness, {
      cwd: TEST_CWD,
      predecessorRunId: predecessor,
      scriptText: TYPED_SCRIPT,
      subagentModel: HAIKU,
      trace: traceFor("subagent-model-amend-b"),
    });
    await vi.waitFor(() => {
      expect(subagentModelOf(harness, amended.runId)).toBe("anthropic/haiku");
    });
    expect(await harness.service.cancel(amended.runId)).toBe(true);
    await settle(harness, amended.runId);

    const cleared = await amendRun(harness, {
      cwd: TEST_CWD,
      predecessorRunId: predecessor,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("subagent-model-amend-c"),
    });
    await vi.waitFor(() => {
      expect(launchedOf(harness, cleared.runId)).toBeDefined();
    });
    expect("subagentModel" in launchedOf(harness, cleared.runId)!).toBe(false);
    expect(await harness.service.cancel(cleared.runId)).toBe(true);
    await settle(harness, cleared.runId);
  });

  it("run-started 载荷带 subagentModel，与 concurrencyCeiling 并列；不设即不出", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      subagentModel: FLASH,
      trace: traceFor("subagent-model-payload"),
    });
    await settle(harness, runId);

    const started = harness.runEvents.find(
      (event) => event.runId === runId && event.eventType === "run-started",
    );
    expect(started?.payload).toMatchObject({ subagentModel: FLASH_CANONICAL });

    const plain = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("subagent-model-payload-absent"),
    });
    await settle(harness, plain);
    const plainStarted = harness.runEvents.find(
      (event) => event.runId === plain && event.eventType === "run-started",
    );
    expect("subagentModel" in plainStarted!.payload).toBe(false);
  });

  it("actor runtime 工厂拿到解析回来的整条选择（含档位），不设时缺席", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      subagentModel: FLASH,
      trace: traceFor("subagent-model-factory"),
    });
    await settle(harness, runId);

    expect(harness.actorRuntimeInputs.at(-1)?.runSubagentModel).toEqual(FLASH);

    const plain = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("subagent-model-factory-absent"),
    });
    await settle(harness, plain);
    expect("runSubagentModel" in harness.actorRuntimeInputs.at(-1)!).toBe(false);
  });

  it("resume 从 run-launched 事件读回选择，交给工厂并抄进注册表条目", async () => {
    const harness = makeHarness({ hangActors: true });
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      subagentModel: FLASH,
      trace: traceFor("subagent-model-resume"),
    });
    await vi.waitFor(() => {
      expect(harness.actorRuntimeInputs).toHaveLength(1);
    });
    expect(await harness.service.cancel(runId)).toBe(true);
    await settle(harness, runId);

    const resumed = await harness.service.resume!(runId);
    expect(resumed).toMatchObject({ ok: true, runId });
    await vi.waitFor(() => {
      expect(harness.actorRuntimeInputs.length).toBeGreaterThan(1);
    });
    expect(harness.actorRuntimeInputs.at(-1)?.runSubagentModel).toEqual(FLASH);

    const listEvents = vi.spyOn(harness.journal, "listEvents");
    expect(await harness.service.getTask(runId)).toMatchObject({
      subagentModel: FLASH_CANONICAL,
    });
    expect(listEvents).not.toHaveBeenCalled();
    listEvents.mockRestore();

    expect(await harness.service.cancel(runId)).toBe(true);
    await settle(harness, runId);
  });

  it("amend with subagentModel: run selection overrides predecessor\'s inherited pin, new run\'s resolved_model records the new selection", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "cf-dwf-amend-model-"));
    const store = await createSqliteSessionStore({ dbPath: join(tempRoot, "session.sqlite") });
    const journal = new SweepableJournalStore();
    try {
      const before = makeHarness({
        actorScripts: {
          "actor#1@1": [
            { kind: "submit", result: { text: "one" } },
            { kind: "submit", result: { text: "two" } },
          ],
        },
        journal,
        sessionStore: store as never,
      });
      const runA = await submitRun(before, {
        cwd: TEST_CWD,
        scriptText: amendScript("second question"),
        trace: traceFor("subagent-model-over-pin-a"),
      });
      await settle(before, runA);

      const workerRow = journal.getActor(runA, "actor#1", 1)!;
      expect(workerRow.resolvedModel).toBe("test/default-runtime-model");
      journal.putActor({ ...workerRow, resolvedModel: "pinned/from-predecessor" });

      const after = makeHarness({
        actorScripts: { "actor#1@1": [{ kind: "submit", result: { text: "revised" } }] },
        journal,
        sessionStore: store as never,
      });
      const amended = await amendRun(after, {
        cwd: TEST_CWD,
        predecessorRunId: runA,
        scriptText: amendScript("second question, revised"),
        subagentModel: HAIKU,
        trace: traceFor("subagent-model-over-pin-b"),
      });
      await settle(after, amended.runId);
      expect((await after.service.getTask(amended.runId))?.output).toBe("one|revised|0");

      expect(after.actorRuntimeInputs).toHaveLength(1);
      expect(after.actorRuntimeInputs[0]).toMatchObject({
        pinnedModel: "pinned/from-predecessor",
        runSubagentModel: HAIKU,
      });
      expect(journal.getActor(amended.runId, "actor#1", 1)?.resolvedModel).toBe("anthropic/haiku");
      expect(journal.getActor(runA, "actor#1", 1)?.resolvedModel).toBe("pinned/from-predecessor");
    } finally {
      store.close();
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
});

describe("dynamic workflow run service — 脚本点名的模型", () => {
  const LIGHT: ModelSelection = { providerId: "zhipu", modelId: "GLM-5.3-Flash" };
  const STRONG: ModelSelection = {
    providerId: "zhipu",
    modelId: "GLM-5.3",
    options: { reasoningLevel: "high" },
  };
  const RUN_DEFAULT: ModelSelection = { providerId: "anthropic", modelId: "haiku" };
  const ROUTED_SCRIPT = [
    "interface Answer { text: string }",
    'const MODELS = { light: model("GLM-5.3-Flash"), strong: model("GLM-5.3$high") };',
    'const judge = await agent("评审员", { model: MODELS.light }).ask<Answer>("judge");',
    'const writer = await agent("写手", { model: MODELS.strong }).ask<Answer>("write");',
    'const plain = await agent("旁观者").ask<Answer>("watch");',
    'return [judge.text, writer.text, plain.text].join(",");',
  ].join("\n");

  const launchedOf = (harness: Harness, runId: string): RunEvent | undefined =>
    harness.journal
      .listEvents(runId, { types: "all", reportItems: "all" })
      .map((stored) => stored.event)
      .find((event) => event.type === "run-launched");

  it("Each subagent runs on its persona-specified model, overriding the run\'s subagent model; unspecified ones fall back to the run\'s", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: ROUTED_SCRIPT,
      subagentModel: RUN_DEFAULT,
      modelBindings: { "GLM-5.3-Flash": LIGHT, "GLM-5.3$high": STRONG },
      trace: traceFor("script-models-routed"),
    });
    await settle(harness, runId);
    expect((await harness.service.getTask(runId))?.runStatus).toBe("completed");

    const launched = launchedOf(harness, runId);
    expect(launched).toMatchObject({
      modelBindings: {
        "GLM-5.3-Flash": "zhipu/GLM-5.3-Flash",
        "GLM-5.3$high": "zhipu/GLM-5.3$high",
      },
    });
    const byActor = new Map(
      harness.actorRuntimeInputs.map((input) => [refToString(input.actor), input]),
    );
    expect(byActor.get("actor#1@1")?.actorModel).toEqual(LIGHT);
    expect(byActor.get("actor#2@1")?.actorModel).toEqual(STRONG);
    expect("actorModel" in byActor.get("actor#3@1")!).toBe(false);
    expect(harness.journal.getActor(runId, "actor#1", 1)?.resolvedModel).toBe(
      "zhipu/GLM-5.3-Flash",
    );
    expect(harness.journal.getActor(runId, "actor#2", 1)?.resolvedModel).toBe("zhipu/GLM-5.3");
    expect(harness.journal.getActor(runId, "actor#3", 1)?.resolvedModel).toBe("anthropic/haiku");
    expect(harness.journal.getActor(runId, "actor#2", 1)?.persona).toMatchObject({
      model: "GLM-5.3$high",
    });
  });

  it("actor-created payload derives subagent\'s canonical model string; omitted if no model specified", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: ROUTED_SCRIPT,
      modelBindings: { "GLM-5.3-Flash": LIGHT, "GLM-5.3$high": STRONG },
      trace: traceFor("script-models-payload"),
    });
    await settle(harness, runId);
    const created = harness.runEvents.filter(
      (event) => event.runId === runId && event.eventType === "actor-created",
    );
    expect(created.map((event) => event.payload.model)).toEqual([
      "zhipu/GLM-5.3-Flash",
      "zhipu/GLM-5.3$high",
      undefined,
    ]);
    expect("model" in created[2]!.payload).toBe(false);
    const dispatched = harness.runEvents.filter(
      (event) =>
        event.runId === runId &&
        event.eventType === "node-dispatched" &&
        event.payload.kind === "ask",
    );
    expect(
      dispatched.map((event) => [event.payload.actorPersonaModel, event.payload.actorModel]),
    ).toEqual([
      ["GLM-5.3-Flash", "zhipu/GLM-5.3-Flash"],
      ["GLM-5.3$high", "zhipu/GLM-5.3$high"],
      [undefined, undefined],
    ]);
  });

  it("绑定表里没有的名字（只有绕过 9010 的断言做得到）让那一问以 DriverError 失败，不退回别的模型", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: [
        "interface Answer { text: string }",
        'const name = "GLM-9" as unknown as ModelRef;',
        'const a = await agent("评审员", { model: name }).ask<Answer>("judge");',
        "return a.text;",
      ].join("\n"),
      subagentModel: RUN_DEFAULT,
      trace: traceFor("script-models-unbound"),
    });
    await settle(harness, runId);
    const snapshot = await harness.service.getTask(runId);
    expect(snapshot?.runStatus).toBe("errored");
    expect(JSON.stringify(snapshot)).toContain('\\"GLM-9\\"');
    expect(harness.actorRuntimeInputs).toHaveLength(0);
  });

  const TABLE = { "GLM-5.3-Flash": "zhipu/GLM-5.3-Flash", "GLM-5.3$high": "zhipu/GLM-5.3$high" };

  it("快照与详情带出绑定表：热路径读条目，冷行扫事件头", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      const runId = await submitRun(harness, {
        cwd: projectCwd,
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: ROUTED_SCRIPT,
        modelBindings: { "GLM-5.3-Flash": LIGHT, "GLM-5.3$high": STRONG },
        trace: traceFor("script-models-read"),
      });
      await settle(harness, runId);
      expect(await harness.service.getTask(runId)).toMatchObject({ modelBindings: TABLE });
      expect(await introspectionOf(harness).getRunDetail(runId)).toMatchObject({
        modelBindings: TABLE,
      });
      const cold = makeHarness({ journal });
      expect(await cold.service.getTask(runId)).toMatchObject({ modelBindings: TABLE });
      expect(await introspectionOf(cold).getRunDetail(runId)).toMatchObject({
        modelBindings: TABLE,
      });
    });
  });

  it("resume 从 run-launched 读回同一张表交给工厂，并抄进注册表条目", async () => {
    const harness = makeHarness({ hangActors: true });
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: ROUTED_SCRIPT,
      modelBindings: { "GLM-5.3-Flash": LIGHT, "GLM-5.3$high": STRONG },
      trace: traceFor("script-models-resume"),
    });
    await vi.waitFor(() => {
      expect(harness.actorRuntimeInputs).toHaveLength(1);
    });
    expect(await harness.service.cancel(runId)).toBe(true);
    await settle(harness, runId);

    const resumed = await harness.service.resume!(runId);
    expect(resumed).toMatchObject({ ok: true, runId });
    await vi.waitFor(() => {
      expect(harness.actorRuntimeInputs.length).toBeGreaterThan(1);
    });
    expect(harness.actorRuntimeInputs.at(-1)?.actorModel).toEqual(LIGHT);
    expect(await harness.service.getTask(runId)).toMatchObject({ modelBindings: TABLE });
    expect(await harness.service.cancel(runId)).toBe(true);
    await settle(harness, runId);
  });

  it("不点名模型的 run：事件、快照、载荷与工厂输入里都没有这些键", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("script-models-absent"),
    });
    await settle(harness, runId);
    expect("modelBindings" in launchedOf(harness, runId)!).toBe(false);
    expect("modelBindings" in (await harness.service.getTask(runId))!).toBe(false);
    expect("actorModel" in harness.actorRuntimeInputs.at(-1)!).toBe(false);
  });
});

describe("dynamic workflow run service — 本 run 子代理的权限模式", () => {
  const launchedOf = (harness: Harness, runId: string): RunEvent | undefined =>
    harness.journal
      .listEvents(runId, { types: "all", reportItems: "all" })
      .map((stored) => stored.event)
      .find((event) => event.type === "run-launched");

  it("The initiating session\'s mode is recorded as-is and passed to the actor factory; legacy plan value recorded as build", async () => {
    let mode: CollaborationMode = "guarded";
    const harness = makeHarness({ permissionMode: () => mode });
    const cases: ReadonlyArray<readonly [CollaborationMode, string]> = [
      ["guarded", "guarded"],
      ["build", "build"],
      ["edit", "edit"],
      ["yolo", "yolo"],
      ["auto", "auto"],
      ["plan", "build"],
    ];
    for (const [sessionMode, recorded] of cases) {
      mode = sessionMode;
      const runId = await submitRun(harness, {
        cwd: TEST_CWD,
        scriptText: TYPED_SCRIPT,
        trace: traceFor(`permission-mode-${sessionMode}`),
      });
      await settle(harness, runId);
      expect(launchedOf(harness, runId)).toMatchObject({ subagentPermissionMode: recorded });
      expect(harness.actorRuntimeInputs.at(-1)?.subagentPermissionMode).toBe(recorded);
      expect("subagentPermissionMode" in harness.journal.getRun(runId)!).toBe(false);
    }
  });

  it("没接模式读取的宿主（CLI、测试装配）照旧 YOLO：键缺席", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("permission-mode-unwired"),
    });
    await settle(harness, runId);
    expect("subagentPermissionMode" in launchedOf(harness, runId)!).toBe(false);
    expect("subagentPermissionMode" in harness.actorRuntimeInputs.at(-1)!).toBe(false);
  });

  it("resume 以 run-launched 为准：会话已换到 yolo，续跑的子代理仍是 guarded", async () => {
    let mode: CollaborationMode = "guarded";
    const harness = makeHarness({ hangActors: true, permissionMode: () => mode });
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("permission-mode-resume"),
    });
    await vi.waitFor(() => {
      expect(harness.actorRuntimeInputs).toHaveLength(1);
    });
    expect(await harness.service.cancel(runId)).toBe(true);
    await settle(harness, runId);

    mode = "yolo";
    const resumed = await harness.service.resume!(runId);
    expect(resumed).toMatchObject({ ok: true, runId });
    await vi.waitFor(() => {
      expect(harness.actorRuntimeInputs.length).toBeGreaterThan(1);
    });
    expect(harness.actorRuntimeInputs.at(-1)?.subagentPermissionMode).toBe("guarded");
    expect(await harness.service.cancel(runId)).toBe(true);
    await settle(harness, runId);
  });

  it("amend creates a new run: takes session mode at the moment of revision, not inheriting predecessor\'s", async () => {
    let mode: CollaborationMode = "yolo";
    const harness = makeHarness({ hangActors: true, permissionMode: () => mode });
    const predecessor = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("permission-mode-amend-a"),
    });
    await vi.waitFor(() => {
      expect(launchedOf(harness, predecessor)).toBeDefined();
    });
    expect(launchedOf(harness, predecessor)).toMatchObject({ subagentPermissionMode: "yolo" });

    mode = "guarded";
    const guarded = await amendRun(harness, {
      cwd: TEST_CWD,
      predecessorRunId: predecessor,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("permission-mode-amend-b"),
    });
    await vi.waitFor(() => {
      expect(launchedOf(harness, guarded.runId)).toMatchObject({
        subagentPermissionMode: "guarded",
      });
    });

    mode = "build";
    const relaxed = await amendRun(harness, {
      cwd: TEST_CWD,
      predecessorRunId: guarded.runId,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("permission-mode-amend-c"),
    });
    await vi.waitFor(() => {
      expect(launchedOf(harness, relaxed.runId)).toBeDefined();
    });
    expect(launchedOf(harness, relaxed.runId)).toMatchObject({ subagentPermissionMode: "build" });
    expect(await harness.service.cancel(relaxed.runId)).toBe(true);
    await settle(harness, relaxed.runId);
  });
});

describe("dynamic workflow run service — 本 run 的脚本文件", () => {
  const DRAFT = "/repo/.cf/workflow-drafts/audit.dwf.ts";
  const REVISED = "/repo/.cf/workflow-drafts/audit-2.dwf.ts";

  const launchedOf = (harness: Harness, runId: string): RunEvent | undefined =>
    harness.journal
      .listEvents(runId, { types: "all", reportItems: "all" })
      .map((stored) => stored.event)
      .find((event) => event.type === "run-launched");

  const scriptPathOf = (harness: Harness, runId: string): string | undefined => {
    const launched = launchedOf(harness, runId);
    return launched?.type === "run-launched" ? launched.scriptPath : undefined;
  };

  it("submit 把绝对路径记进 run-launched，行上没有这条事实；不给即整个键缺席", async () => {
    const harness = makeHarness();
    const withFile = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      scriptPath: DRAFT,
      trace: traceFor("script-path-submit"),
    });
    await settle(harness, withFile);
    expect(scriptPathOf(harness, withFile)).toBe(DRAFT);
    expect("scriptPath" in harness.journal.getRun(withFile)!).toBe(false);

    const without = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("script-path-submit-absent"),
    });
    await settle(harness, without);
    expect("scriptPath" in launchedOf(harness, without)!).toBe(false);
  });

  it("快照与详情给出同一个绝对路径；不给时两条读面都不带这个键（冷重启后照样）", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      const withFile = await submitRun(harness, {
        cwd: projectCwd,
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: TYPED_SCRIPT,
        scriptPath: DRAFT,
        trace: traceFor("script-path-read-set"),
      });
      await settle(harness, withFile);
      const without = await submitRun(harness, {
        cwd: projectCwd,
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: TYPED_SCRIPT,
        trace: traceFor("script-path-read-absent"),
      });
      await settle(harness, without);

      const introspection = introspectionOf(harness);
      expect(await harness.service.getTask(withFile)).toMatchObject({ scriptPath: DRAFT });
      expect(await introspection.getRunDetail(withFile)).toMatchObject({ scriptPath: DRAFT });
      expect("scriptPath" in (await harness.service.getTask(without))!).toBe(false);
      expect("scriptPath" in (await introspection.getRunDetail(without))!).toBe(false);

      const { runs } = await introspection.listRuns({ cwd: projectCwd, limit: 20 });
      expect(runs).toHaveLength(2);
      for (const row of runs) expect("scriptPath" in row).toBe(false);

      const cold = makeHarness({ journal });
      const coldIntrospection = introspectionOf(cold);
      expect(await cold.service.getTask(withFile)).toMatchObject({ scriptPath: DRAFT });
      expect(await coldIntrospection.getRunDetail(withFile)).toMatchObject({ scriptPath: DRAFT });
      expect("scriptPath" in (await cold.service.getTask(without))!).toBe(false);
      expect("scriptPath" in (await coldIntrospection.getRunDetail(without))!).toBe(false);
    });
  });

  it("间隙里的快照与详情读注册表副本，答案与落行后一致", async () => {
    await withSqliteJournal(async (real) => {
      const hidden = new Set<string>();
      const journal = hideRunsFromReads(real, hidden);
      const harness = makeHarness({ hangActors: true, journal });

      const runId = await submitRun(harness, {
        cwd: projectCwd,
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: TYPED_SCRIPT,
        scriptPath: DRAFT,
        trace: traceFor("script-path-gap"),
      });
      hidden.add(runId);

      expect(await harness.service.getTask(runId)).toMatchObject({ scriptPath: DRAFT });
      expect(await introspectionOf(harness).getRunDetail(runId)).toMatchObject({
        scriptPath: DRAFT,
      });

      hidden.delete(runId);
      await vi.waitFor(async () => {
        expect(await introspectionOf(harness).getRunDetail(runId)).toMatchObject({
          scriptPath: DRAFT,
        });
      });

      await harness.service.cancel(runId);
      await settle(harness, runId);
    });
  });

  it("amend uses path from the request, never inheriting predecessor\'s (absent if not provided, not reused)", async () => {
    const harness = makeHarness({ hangActors: true });
    const predecessor = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      scriptPath: DRAFT,
      trace: traceFor("script-path-amend-a"),
    });
    await vi.waitFor(() => {
      expect(scriptPathOf(harness, predecessor)).toBe(DRAFT);
    });

    const amended = await amendRun(harness, {
      cwd: TEST_CWD,
      predecessorRunId: predecessor,
      scriptText: TYPED_SCRIPT,
      scriptPath: REVISED,
      trace: traceFor("script-path-amend-b"),
    });
    await vi.waitFor(() => {
      expect(scriptPathOf(harness, amended.runId)).toBe(REVISED);
    });
    expect(await harness.service.cancel(amended.runId)).toBe(true);
    await settle(harness, amended.runId);

    const cleared = await amendRun(harness, {
      cwd: TEST_CWD,
      predecessorRunId: predecessor,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("script-path-amend-c"),
    });
    await vi.waitFor(() => {
      expect(launchedOf(harness, cleared.runId)).toBeDefined();
    });
    expect("scriptPath" in launchedOf(harness, cleared.runId)!).toBe(false);
    expect(await harness.service.cancel(cleared.runId)).toBe(true);
    await settle(harness, cleared.runId);
  });

  it("resume copies path read back from run-launched event into entry: read surface remains \"read entry if present\"", async () => {
    const harness = makeHarness({ hangActors: true });
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      scriptPath: DRAFT,
      trace: traceFor("script-path-resume"),
    });
    await vi.waitFor(() => {
      expect(harness.actorRuntimeInputs).toHaveLength(1);
    });
    expect(await harness.service.cancel(runId)).toBe(true);
    await settle(harness, runId);

    expect(await harness.service.resume!(runId)).toMatchObject({ ok: true, runId });
    await vi.waitFor(() => {
      expect(harness.actorRuntimeInputs.length).toBeGreaterThan(1);
    });

    const listEvents = vi.spyOn(harness.journal, "listEvents");
    expect(await harness.service.getTask(runId)).toMatchObject({ scriptPath: DRAFT });
    expect(listEvents).not.toHaveBeenCalled();
    listEvents.mockRestore();

    expect(await harness.service.cancel(runId)).toBe(true);
    await settle(harness, runId);
  });
});

describe("dynamic workflow run service — launch anchor (apps/cli/packages/dynamic-workflow/docs/execution-engine.md \"Token telemetry for subagents\")", () => {
  const anchoredEvents = (harness: Harness) =>
    harness.runEvents.filter(
      (event) => event.eventType === "actor-created" || event.eventType === "run-settled",
    );

  it("活动轮命中 → journal 首条 run-launched 与 actor-created / run-settled 载荷带同一锚点", async () => {
    const trace = traceFor("anchor-active");
    const harness = makeHarness({
      resolveLaunchInputId: (candidate) =>
        candidate.turnId === trace.turnId ? "launch-input-active" : undefined,
    });
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: createSessionId("anchor-parent"),
      scriptText: TYPED_SCRIPT,
      toolCallId: "tool-anchor",
      trace,
    });
    await settle(harness, runId);

    const events = harness.journal.listEvents(runId, { types: "all", reportItems: "all" });
    expect(events.slice(0, 2).map((stored) => stored.event.type)).toEqual([
      "run-started",
      "run-launched",
    ]);
    expect(events[1]?.event).toMatchObject({
      inputId: "launch-input-active",
      toolCallId: "tool-anchor",
    });
    const anchored = anchoredEvents(harness);
    expect(anchored.map((event) => event.eventType)).toEqual(["actor-created", "run-settled"]);
    expect(anchored.every((event) => event.launchInputId === "launch-input-active")).toBe(true);
    expect(
      harness.runEvents
        .filter((event) => event.eventType === "node-queued")
        .every((event) => event.launchInputId === undefined),
    ).toBe(true);
  });

  it("submit 的 phaseNames 落进 run-launched（journal 是唯一副本，冷重放免费重建）", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      launchInputId: "launch-input-phases",
      phaseNames: ["Research", "Write"],
      scriptText: TYPED_SCRIPT,
      trace: traceFor("anchor-phases"),
    });
    await settle(harness, runId);
    expect(
      harness.journal.listEvents(runId, { types: "all", reportItems: "all" })[1]?.event,
    ).toEqual({
      type: "run-launched",
      inputId: "launch-input-phases",
      phaseNames: ["Research", "Write"],
    });
  });

  it("submit 的 phaseAlongside 与阶段表同车落 journal（service 只转发，不加工）", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      launchInputId: "launch-input-alongside",
      phaseNames: ["A", "B", "C"],
      phaseAlongside: [[], [0], []],
      scriptText: TYPED_SCRIPT,
      trace: traceFor("anchor-alongside"),
    });
    await settle(harness, runId);
    expect(
      harness.journal.listEvents(runId, { types: "all", reportItems: "all" })[1]?.event,
    ).toEqual({
      type: "run-launched",
      inputId: "launch-input-alongside",
      phaseNames: ["A", "B", "C"],
      phaseAlongside: [[], [0], []],
    });
  });

  it("显式 launchInputId（中枢直接启动）优先于活动轮解析", async () => {
    const harness = makeHarness({ resolveLaunchInputId: () => "active-should-lose" });
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      launchInputId: "launch-input-direct",
      scriptText: TYPED_SCRIPT,
      trace: traceFor("anchor-direct"),
    });
    await settle(harness, runId);
    expect(
      harness.journal.listEvents(runId, { types: "all", reportItems: "all" })[1]?.event,
    ).toMatchObject({
      inputId: "launch-input-direct",
    });
    expect(
      anchoredEvents(harness).every((event) => event.launchInputId === "launch-input-direct"),
    ).toBe(true);
  });

  it("没有解析器也没有显式值 → 铸 UUID v7 锚点", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("anchor-minted"),
    });
    await settle(harness, runId);
    const launched = harness.journal.listEvents(runId, { types: "all", reportItems: "all" })[1]
      ?.event;
    expect(launched?.type).toBe("run-launched");
    const inputId = launched?.type === "run-launched" ? launched.inputId : "";
    expect(inputId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(anchoredEvents(harness).every((event) => event.launchInputId === inputId)).toBe(true);
  });
});

describe("dynamic workflow run service — 产物存储的接线", () => {
  
  function recordingArtifactStore(): {
    store: ToolArtifactStorePort;
    writes: ToolArtifactWriteRequest[];
  } {
    const writes: ToolArtifactWriteRequest[] = [];
    return {
      writes,
      store: {
        writeToolResultArtifact: async (request) => {
          writes.push(request);
          return {
            id: "artifact-1",
            uri: "cf-artifact://harness/artifact-1",
            bytes: Buffer.byteLength(request.content, "utf8"),
            contentType: request.contentType ?? "text/plain",
            createdAt: new Date(0),
          };
        },
        readToolResultArtifact: async () => {
          throw new Error("readToolResultArtifact 不应被本用例触及");
        },
      },
    };
  }

  it("store is delivered via service → launch → driver, with session scope being this service\'s parent session", async () => {
    const { store, writes } = recordingArtifactStore();
    const harness = makeHarness({ artifactStore: store });

    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: createSessionId("some-other-session"),
      scriptText: ARTIFACT_SCRIPT,
      trace: traceFor("artifact-wiring"),
    });
    await settle(harness, runId);

    expect(harness.journal.getRun(runId)?.status).toBe("completed");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      sessionId: HARNESS_PARENT_SESSION,
      toolName: "CreateWorkflow",
      retention: "project",
      contentType: "text/markdown",
    });
    expect(String(writes[0]?.toolCallId)).toBe(`${runId}:artifact#1@1`);
  });

  it("不接 store 的装配里，发布以 ArtifactStoreUnavailable 拒绝而 run 照常结算", async () => {
    const harness = makeHarness();

    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: [
        "let code = 'none';",
        'try { await artifact.markdown("summary", "# 结论"); }',
        "catch (error) { code = (error as { code?: string }).code ?? 'unknown'; }",
        "return code;",
      ].join("\n"),
      trace: traceFor("artifact-no-store"),
    });
    await settle(harness, runId);

    const snapshot = await harness.service.getTask(runId);
    expect(snapshot?.status).toBe("completed");
    expect(snapshot?.output).toBe("ArtifactStoreUnavailable");
  });
});

//
describe("dynamic workflow run service — 用户面产物的读面", () => {
  
  function readableArtifactStore(): {
    store: ToolArtifactStorePort;
    reads: string[];
  } {
    const bytesByUri = new Map<string, Uint8Array>();
    const reads: string[] = [];
    let next = 0;
    return {
      reads,
      store: {
        writeToolResultArtifact: async (request) => {
          next += 1;
          const uri = `cf-artifact://harness/artifact-${next}`;
          bytesByUri.set(uri, new TextEncoder().encode(request.content));
          return {
            id: `artifact-${next}`,
            uri,
            bytes: Buffer.byteLength(request.content, "utf8"),
            contentType: request.contentType ?? "text/plain",
            createdAt: new Date(0),
          };
        },
        readToolResultArtifact: async () => {
          throw new Error(
            "字节读回必须走 readToolResultBinaryArtifact（文本读会毁掉 office 文件）",
          );
        },
        readToolResultBinaryArtifact: async (request) => {
          reads.push(request.uri);
          const bytes = bytesByUri.get(request.uri);
          if (bytes === undefined) throw new Error(`unknown uri: ${request.uri}`);
          return { uri: request.uri, bytes, contentType: "application/json" };
        },
      },
    };
  }

  
  const MIXED_SCRIPT = [
    'artifact.chart("perf", { x: { field: "round" }, y: { field: "ms" } });',
    'report({ round: 1, ms: 40 }, "perf");',
    'report({ round: 2, ms: 31 }, "perf");',
    "report({ untagged: true });",
    'await artifact.markdown("summary", "# 第一版");',
    'await artifact.markdown("summary", "# 第二版");',
    'return "done";',
  ].join("\n");

  async function runMixed(overrides: { parentSessionId?: SessionId } = {}) {
    const { store, reads } = readableArtifactStore();
    const harness = makeHarness({ artifactStore: store });
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: overrides.parentSessionId ?? HARNESS_PARENT_SESSION,
      scriptText: MIXED_SCRIPT,
      trace: traceFor("artifact-reads"),
    });
    await settle(harness, runId);
    expect(harness.journal.getRun(runId)?.status).toBe("completed");
    return { harness, runId, reads };
  }

  it("listArtifacts 按 id 分组、版本升序，顶层取最新版；看板带 itemCount、内容产物恒 0", async () => {
    const { harness, runId } = await runMixed();
    const artifacts = await harness.service.listArtifacts!(runId);

    expect(artifacts).toHaveLength(2);
    const [chart, summary] = artifacts!;
    expect(chart).toMatchObject({ id: "perf", kind: "chart", version: 1, itemCount: 2 });
    expect(chart?.versions).toHaveLength(1);
    expect(summary).toMatchObject({
      id: "summary",
      kind: "markdown",
      version: 2,
      contentType: "text/markdown",
      itemCount: 0,
    });
    expect(summary?.versions.map((entry) => entry.version)).toEqual([1, 2]);
  });

  it("listArtifactItems 按 sequence 升序分页，afterSequence 严格大于，hasMore 由存储层判定", async () => {
    const { harness, runId } = await runMixed();
    const read = (page: { afterSequence?: number; limit: number }, artifactId = "perf") =>
      harness.service.listArtifactItems!(runId, artifactId, { ...page, maxBytes: 1 << 30 });
    const all = await read({ limit: 10 });
    expect(all.items.map((entry) => entry.item)).toEqual([
      { round: 1, ms: 40 },
      { round: 2, ms: 31 },
    ]);
    expect(all.items[0]?.siteId).toBe("report#1");
    expect(all.hasMore).toBe(false);

    const firstPage = await read({ limit: 1 });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.hasMore).toBe(true);
    const secondPage = await read({ afterSequence: firstPage.items[0]!.sequence, limit: 10 });
    expect(secondPage.items.map((entry) => entry.item)).toEqual([{ round: 2, ms: 31 }]);
    expect(await read({ afterSequence: 9_999, limit: 10 })).toEqual({ items: [], hasMore: false });
    expect(await read({ limit: 10 }, "ghost")).toEqual({ items: [], hasMore: false });
  });

  it("readArtifact 回字节 + **journal 记录上的** contentType（不是 store 再推的那份）", async () => {
    const { harness, runId, reads } = await runMixed();
    const first = await harness.service.readArtifact!(runId, "summary", 1);
    const second = await harness.service.readArtifact!(runId, "summary", 2);

    expect(new TextDecoder().decode(first!.bytes)).toBe("# 第一版");
    expect(new TextDecoder().decode(second!.bytes)).toBe("# 第二版");
    expect(first!.contentType).toBe("text/markdown");
    expect(new Set(reads).size).toBe(2);
  });

  it("Authorization negative case: run\'s parent session does not belong to this service ⇒ rejected, and store is never touched", async () => {
    const { harness, runId, reads } = await runMixed({
      parentSessionId: createSessionId("some-other-session"),
    });
    expect(await harness.service.readArtifact!(runId, "summary", 1)).toBeUndefined();
    expect(reads).toEqual([]);
  });

  it("授权负例：未知 runId / 未知 artifactId / 未知版本 ⇒ 拒绝，store 未被碰", async () => {
    const { harness, runId, reads } = await runMixed();
    expect(await harness.service.readArtifact!("dwfrun-nope", "summary", 1)).toBeUndefined();
    expect(await harness.service.readArtifact!(runId, "ghost", 1)).toBeUndefined();
    expect(await harness.service.readArtifact!(runId, "summary", 3)).toBeUndefined();
    expect(reads).toEqual([]);
  });

  it("授权负例：预置看板没有字节 ⇒ 拒绝（它的数据是 journal 里的标签 report 行）", async () => {
    const { harness, runId, reads } = await runMixed();
    expect(await harness.service.readArtifact!(runId, "perf", 1)).toBeUndefined();
    expect(reads).toEqual([]);
  });

  it("store 缺席 / 不带二进制读回 ⇒ 整条读回缺席，绝不退回文本读再解码", async () => {
    const textOnly: ToolArtifactStorePort = {
      writeToolResultArtifact: async (request) => ({
        id: "a1",
        uri: "cf-artifact://harness/a1",
        bytes: Buffer.byteLength(request.content, "utf8"),
        contentType: request.contentType ?? "text/plain",
        createdAt: new Date(0),
      }),
      readToolResultArtifact: async () => {
        throw new Error("不带二进制能力的 store 不得被退回文本读");
      },
    };
    const harness = makeHarness({ artifactStore: textOnly });
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: ARTIFACT_SCRIPT,
      trace: traceFor("artifact-read-textonly"),
    });
    await settle(harness, runId);
    expect(await harness.service.readArtifact!(runId, "summary", 1)).toBeUndefined();
  });

  it("引擎发出的事件真的能被共享 reducer 归约成 workflowRuns.artifacts（两半的接缝）", async () => {
    const { harness, runId } = await runMixed();

    const published = harness.runEvents.filter((event) => event.eventType === "artifact-published");
    expect(published).toHaveLength(3);
    expect(harness.runEvents.some((event) => event.eventType === "artifact-failed")).toBe(false);
    expect(
      published.every((event) => (event.payload as { instance?: unknown }).instance !== undefined),
    ).toBe(true);

    let state: WorkflowRunsState | undefined;
    for (const event of harness.runEvents) {
      state = reduceWorkflowRunsState(state, event as WorkflowRunProgressEnvelope) ?? state;
    }
    expect(state?.runs[0]?.artifacts).toEqual([
      { id: "perf", kind: "chart", version: 1, itemCount: 2 },
      { id: "summary", kind: "markdown", version: 2, contentType: "text/markdown", bytes: 11 },
    ]);
    expect(workflowRunsStateSchema.parse(state)).toEqual(state);
    expect(state?.runs[0]?.reports?.map((report) => report.artifactId)).toEqual([
      "perf",
      "perf",
      undefined,
    ]);
  });

  it("零产物的 run：listArtifacts 整个缺席（不是空数组）", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("artifact-none"),
    });
    await settle(harness, runId);
    expect(await harness.service.listArtifacts!(runId)).toBeUndefined();
  });
});

describe("dynamic workflow run service — actor sessions", () => {
  it("两个持久化调用都发生，且 task link 在会话落库之后", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: createSessionId("actor-parent"),
      scriptText: TYPED_SCRIPT,
      trace: traceFor("actor-persist"),
    });
    await settle(harness, runId);

    // 1. ensureSessionPersistedForExternalActivity
    expect(harness.persistedTitles).toHaveLength(1);
    expect(harness.persistedTitles[0]).toContain("actor#1@1");
    // 2. createSessionTaskLink
    expect(harness.taskLinks).toHaveLength(1);
    const link = harness.taskLinks[0]!;
    expect(link.role).toBe("workflow_actor");
    expect(link.parentSessionId).toBe(createSessionId("actor-parent"));
    expect(link.rootWorkflowRunId).toBeUndefined();
    expect(link.path).toContain(runId);
  });

  
  it("接上会话存储后，ask 节点带上消息数边界（service → launch → driver 的透传）", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "cf-dwf-boundary-"));
    const store = await createSqliteSessionStore({ dbPath: join(tempRoot, "session.sqlite") });
    try {
      const harness = makeHarness({ sessionStore: store as never });
      const runId = await submitRun(harness, {
        cwd: TEST_CWD,
        scriptText: TYPED_SCRIPT,
        trace: traceFor("actor-boundary"),
      });
      await settle(harness, runId);

      const node = harness.journal.getNode(runId, "ask#1", 1);
      const actorSessionId = harness.actorRuntimeInputs[0]!.sessionId;
      const persisted = await store.messages({ sessionID: actorSessionId });
      expect(persisted.length).toBeGreaterThan(0);
      expect(node?.messageBoundary).toBe(persisted.length);
      expect(node?.status).toBe("completed");
      expect(node?.actorSeq).toBe(0);
      expect(node?.stats?.tokens).toBeGreaterThan(0);
    } finally {
      store.close();
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("Actor events are only streamed via construction-time sink; subscribeEvents has only driver\'s two observation surfaces (once per actor)", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("actor-live-channel"),
    });
    await settle(harness, runId);

    const actorSessionId = harness.actorRuntimeInputs[0]!.sessionId;
    expect(harness.sessionEvents.length).toBeGreaterThan(0);
    expect(
      harness.sessionEvents.every(
        (event) => (event as { sessionId: string }).sessionId === actorSessionId,
      ),
    ).toBe(true);
    expect(harness.actorSubscribeCalls).toEqual([actorSessionId, actorSessionId]);
    const stored = await harness.actorEventStore.getEvents(actorSessionId);
    expect(stored.length).toBe(harness.sessionEvents.length);
  });

  it("actor 会话 id 含 runId 且字符集安全", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("actor-session-id"),
    });
    await settle(harness, runId);

    expect(harness.actorRuntimeInputs).toHaveLength(1);
    const sessionId = harness.actorRuntimeInputs[0]!.sessionId;
    expect(sessionId).toContain(runId);
    expect(sessionId).not.toMatch(/[#@/]/);
  });

  it("Persistence completes before the actor\'s first turn (not fire-and-forget)", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: createSessionId("order-parent"),
      scriptText: TYPED_SCRIPT,
      trace: traceFor("actor-order"),
    });
    await settle(harness, runId);

    const persistIndex = harness.order.findIndex((entry) => entry.startsWith("persist:"));
    const linkIndex = harness.order.findIndex((entry) => entry.startsWith("link:"));
    const turnIndex = harness.order.findIndex((entry) => entry.startsWith("turn:"));
    const constructIndex = harness.order.findIndex((entry) => entry.startsWith("construct:"));

    expect(persistIndex).toBeGreaterThanOrEqual(0);
    expect(linkIndex).toBeGreaterThanOrEqual(0);
    expect(turnIndex).toBeGreaterThanOrEqual(0);
    expect(constructIndex).toBeGreaterThanOrEqual(0);
    expect(constructIndex).toBeLessThan(persistIndex);
    expect(persistIndex).toBeLessThan(linkIndex);
    expect(linkIndex).toBeLessThan(turnIndex);
  });

  it("dwf_actor.session_id 收到 driver 铸的会话 id", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("actor-journal"),
    });
    await settle(harness, runId);

    const actors = harness.journal.listActors(runId, { withPersona: true });
    expect(actors).toHaveLength(1);
    expect(actors[0]!.sessionId).toBe(harness.actorRuntimeInputs[0]!.sessionId);
  });

  it("并发两个 run 的同 site×ordinal actor 不撞会话 id", async () => {
    const harness = makeHarness();
    const [first, second] = await Promise.all([
      submitRun(harness, {
        cwd: TEST_CWD,
        scriptText: TYPED_SCRIPT,
        trace: traceFor("collide-a"),
      }),
      submitRun(harness, {
        cwd: TEST_CWD,
        scriptText: TYPED_SCRIPT,
        trace: traceFor("collide-b"),
      }),
    ]);
    await Promise.all([settle(harness, first), settle(harness, second)]);

    expect(first).not.toBe(second);
    const sessionIds = harness.actorRuntimeInputs.map((input) => input.sessionId);
    expect(sessionIds).toHaveLength(2);
    expect(new Set(sessionIds).size).toBe(2);
  });
});

describe("dynamic workflow run service — cancellation", () => {
  it("cancel 使 run 结算为 cancelled 而不是 failed，且保留已完结 journal 条目", async () => {
    const harness = makeHarness({ hangActors: true });
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("cancel-run"),
    });

    await vi.waitFor(() => {
      expect(harness.actorRuntimeInputs.length).toBeGreaterThan(0);
    });

    expect(await harness.service.cancel(runId)).toBe(true);
    await settle(harness, runId);

    const snapshot = await harness.service.getTask(runId);
    expect(snapshot?.status).toBe("cancelled");
    expect(snapshot?.runStatus).toBe("stopped");
    expect(snapshot?.stopReason).toBe("user");
    expect(harness.journal.getRun(runId)?.status).toBe("stopped");
    expect(harness.journal.getRun(runId)?.stopReason).toBe("user");

    expect(harness.journal.listActors(runId, { withPersona: true })).toHaveLength(1);
  });

  it("未知 run 的 cancel 返回 false", async () => {
    const harness = makeHarness();
    expect(await harness.service.cancel("dwfrun-does-not-exist")).toBe(false);
  });

  it("已结算 run 的 cancel 返回 false", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("cancel-settled"),
    });
    await settle(harness, runId);

    expect(await harness.service.cancel(runId)).toBe(false);
  });
});

describe("dynamic workflow run service — close（Engine ownership 规则二）", () => {
  
  function maxSequence(harness: Harness, runId: string): number {
    return harness.journal
      .listEvents(runId, { types: "all", reportItems: "all" })
      .reduce((max, entry) => Math.max(max, entry.sequence), 0);
  }

  it("close 停下在飞 run：行为 stopped(interrupted) + Interrupted，且由引擎写下", async () => {
    const harness = makeHarness({ hangActors: true });
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("close-live"),
    });
    await vi.waitFor(() => {
      expect(harness.actorRuntimeInputs.length).toBeGreaterThan(0);
    });
    expect(harness.service.countLiveRuns()).toBe(1);

    await harness.service.close();

    expect(harness.service.countLiveRuns()).toBe(0);
    const record = harness.journal.getRun(runId);
    expect(record?.status).toBe("stopped");
    expect(record?.stopReason).toBe("interrupted");
    expect(record?.failure?.code).toBe("Interrupted");
    expect(record?.failure?.message).toContain("the owning session closed");
    expect(record?.failure?.message).toContain(runId);

    const snapshot = await harness.service.getTask(runId);
    expect(snapshot?.runStatus).toBe("stopped");
    expect(snapshot?.stopReason).toBe("interrupted");

    const settled = harness.journal
      .listEvents(runId, { types: "all", reportItems: "all" })
      .filter(({ event }) => event.type === "run-settled");
    expect(settled).toHaveLength(1);

    const sequenceAtClose = maxSequence(harness, runId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(maxSequence(harness, runId)).toBe(sequenceAtClose);
  });

  it("close 等结算：在飞 run 未结算前 close 不解析", async () => {
    const harness = makeHarness({ hangActors: true });
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("close-awaits"),
    });
    await vi.waitFor(() => {
      expect(harness.actorRuntimeInputs.length).toBeGreaterThan(0);
    });

    let settledFirst: string | undefined;
    const unsubscribe = harness.service.subscribeRunSettled((notice) => {
      settledFirst ??= `settled:${notice.runId}`;
    });
    let resolved = false;
    const closing = harness.service.close().then(() => {
      resolved = true;
    });
    expect(resolved).toBe(false);
    await closing;
    expect(resolved).toBe(true);
    expect(settledFirst).toBe(`settled:${runId}`);
    unsubscribe();
  });

  it("关闭之后 submit / amend / resume 抛接线错误（而不是结构化拒绝）", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("close-refuses"),
    });
    await settle(harness, runId);
    await harness.service.close();

    await expect(
      harness.service.submit({
        cwd: TEST_CWD,
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: TYPED_SCRIPT,
        trace: traceFor("close-refuses-submit"),
      }),
    ).rejects.toThrow(/service is closed/);
    await expect(harness.service.resume!(runId)).rejects.toThrow(/service is closed/);
    await expect(
      harness.service.amend!({
        cwd: TEST_CWD,
        parentSessionId: HARNESS_PARENT_SESSION,
        predecessorRunId: runId,
        scriptText: TYPED_SCRIPT,
        trace: traceFor("close-refuses-amend"),
      }),
    ).rejects.toThrow(/service is closed/);
  });

  it("零在飞 run 时 close 直接解析；第二次 close 返回同一个 promise，不再 abort", async () => {
    const harness = makeHarness();
    const first = harness.service.close();
    const second = harness.service.close();
    expect(second).toBe(first);
    await first;
    const closing = harness.logs.filter(
      (entry) => entry.context?.event === "dynamic_workflow.service.closing",
    );
    expect(closing).toHaveLength(1);
    expect(closing[0]?.context?.liveRunCount).toBe(0);
  });
});

describe("dynamic workflow run service — 外来终态行（Engine ownership 规则三）", () => {
  const FOREIGN_FAILURE = { code: "Interrupted" as const, message: "owning process exited" };

  
  async function parkedRun(
    harness: Harness,
    name: string,
  ): Promise<{ runId: string; qid: string }> {
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: TYPED_SCRIPT,
      trace: traceFor(name),
    });
    await vi.waitFor(async () => {
      expect((await harness.service.getTask(runId))?.pendingQuestions).toHaveLength(1);
    });
    const qid = (await harness.service.getTask(runId))?.pendingQuestions?.[0]?.qid;
    if (qid === undefined) throw new Error("停驻的问题没有出现在快照里");
    return { runId, qid };
  }

  function parkedHarness(answer: string, journal?: JournalStorePort): Harness {
    return makeHarness({
      actorScripts: {
        "actor#1@1": [
          { kind: "escalate", question: "外来写入期间先停在这里" },
          { kind: "submit", result: { text: answer } },
        ],
      },
      ...(journal === undefined ? {} : { journal }),
    });
  }

  it("四条读面都忽略活条目下的外来终态行，警告每个条目只记一次", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = parkedHarness("真正的结果", journal);
      const { runId } = await parkedRun(harness, "foreign-row");

      harness.journal.updateRunStatus(runId, "stopped", {
        stopReason: "interrupted",
        failure: FOREIGN_FAILURE,
      });
      expect(harness.journal.getRun(runId)?.status).toBe("stopped");

      const snapshot = await harness.service.getTask(runId);
      expect(snapshot?.status).toBe("running");
      expect(snapshot).not.toHaveProperty("runStatus");
      expect(snapshot).not.toHaveProperty("stopReason");
      expect(snapshot).not.toHaveProperty("failure");
      expect(snapshot).not.toHaveProperty("error");

      const introspection = introspectionOf(harness);
      const { runs: listed } = await introspection.listRuns({ cwd: TEST_CWD, limit: 20 });
      const row = listed.find((item) => item.runId === runId);
      expect(row?.status).toBe("running");
      expect(row).not.toHaveProperty("stopReason");
      const detail = await introspection.getRunDetail(runId);
      expect(detail?.status).toBe("running");
      expect(detail).not.toHaveProperty("stopReason");
      expect(detail).not.toHaveProperty("error");
      expect(detail).not.toHaveProperty("result");

      const sessionRows = await harness.service.listRunsForSession(20);
      const sessionRow = sessionRows.find((item) => item.runId === runId);
      expect(sessionRow?.status).toBe("running");
      expect(sessionRow).not.toHaveProperty("stopReason");
      expect(sessionRow).not.toHaveProperty("failureCode");
      expect(sessionRow?.resumable).toBe(false);

      await harness.service.getTask(runId);
      await harness.service.getTask(runId);
      const warns = harness.logs.filter(
        (entry) => entry.context?.event === "dynamic_workflow.run.foreign_terminal_row",
      );
      expect(warns).toHaveLength(1);
      expect(warns[0]?.context).toMatchObject({
        journalStatus: "stopped",
        runId,
        stopReason: "interrupted",
      });

      await harness.service.cancel(runId);
      await settle(harness, runId);
    });
  });

  it("Engine\'s own settlement overwrites that row: completed without stale failures", async () => {
    const harness = parkedHarness("真正的结果");
    const { runId, qid } = await parkedRun(harness, "foreign-row-then-settle");
    harness.journal.updateRunStatus(runId, "stopped", {
      stopReason: "interrupted",
      failure: FOREIGN_FAILURE,
    });

    expect(await harness.service.resolveQuestion(qid, "继续")).toMatchObject({ ok: true });
    await settle(harness, runId);

    const snapshot = await harness.service.getTask(runId);
    expect(snapshot?.status).toBe("completed");
    expect(snapshot?.runStatus).toBe("completed");
    expect(snapshot?.output).toBe("真正的结果");
    expect(snapshot).not.toHaveProperty("failure");
    const record = harness.journal.getRun(runId);
    expect(record?.status).toBe("completed");
    expect(record?.failure).toBeUndefined();
    expect(record?.stopReason).toBeUndefined();
  });

  it("外来终态行期间 waitForTask 仍然等真正的结算", async () => {
    const harness = parkedHarness("等到了");
    const { runId, qid } = await parkedRun(harness, "foreign-row-wait");
    harness.journal.updateRunStatus(runId, "stopped", {
      stopReason: "interrupted",
      failure: FOREIGN_FAILURE,
    });

    let resolved = false;
    const waiting = harness.service.waitForTask(runId).then((snapshot) => {
      resolved = true;
      return snapshot;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    expect(await harness.service.resolveQuestion(qid, "继续")).toMatchObject({ ok: true });
    expect((await waiting)?.status).toBe("completed");
    expect(resolved).toBe(true);
  });
});

describe("dynamic workflow run service — observation", () => {
  it("未知 run 的 getTask 返回 undefined", async () => {
    const harness = makeHarness();
    expect(await harness.service.getTask("dwfrun-unknown")).toBeUndefined();
  });

  it("submit 刚返回时快照已是 running", async () => {
    const harness = makeHarness({ hangActors: true });
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("snapshot-immediate"),
    });

    const snapshot = await harness.service.getTask(runId);
    expect(snapshot?.status).toBe("running");
    expect(snapshot?.runId).toBe(runId);

    await harness.service.cancel(runId);
    await settle(harness, runId);
  });

  it("重启恢复：注册表为空时 completed 记录的 result 作为 output 回出", async () => {
    const journal = new SweepableJournalStore();
    preloadRun(journal, { runId: "dwfrun-restart", status: "running" });
    journal.updateRunStatus("dwfrun-restart", "completed", {
      result: { report: "final answer", steps: 3 },
    });
    const harness = makeHarness({ journal });

    const snapshot = await harness.service.getTask("dwfrun-restart");
    expect(snapshot?.status).toBe("completed");
    expect(snapshot?.output).toEqual({ report: "final answer", steps: 3 });
  });

  it("重启恢复：非 record 产物（字符串）同样回出", async () => {
    const journal = new SweepableJournalStore();
    preloadRun(journal, { runId: "dwfrun-restart-string", status: "running" });
    journal.updateRunStatus("dwfrun-restart-string", "completed", { result: "plain answer" });
    const harness = makeHarness({ journal });

    expect((await harness.service.getTask("dwfrun-restart-string"))?.output).toBe("plain answer");
  });

  it("重启恢复：completed 但记录无 result 时 output 缺席", async () => {
    const journal = new SweepableJournalStore();
    preloadRun(journal, { runId: "dwfrun-restart-empty", status: "running" });
    journal.updateRunStatus("dwfrun-restart-empty", "completed");
    const harness = makeHarness({ journal });

    const snapshot = await harness.service.getTask("dwfrun-restart-empty");
    expect(snapshot?.status).toBe("completed");
    expect(snapshot && "output" in snapshot).toBe(false);
  });

  it("重启恢复：failed 记录不回 output", async () => {
    const journal = new SweepableJournalStore();
    preloadRun(journal, { runId: "dwfrun-restart-failed", status: "running" });
    journal.updateRunStatus("dwfrun-restart-failed", "errored", {
      failure: { code: "DriverError", message: "script threw" },
    });
    const harness = makeHarness({ journal });

    const snapshot = await harness.service.getTask("dwfrun-restart-failed");
    expect(snapshot?.status).toBe("failed");
    expect(snapshot?.runStatus).toBe("errored");
    expect(snapshot && "output" in snapshot).toBe(false);
    expect(snapshot?.error).toBe("script threw");
  });

  //

  function preloadReports(journal: JournalStorePort, runId: string, items: unknown[]): void {
    items.forEach((item, index) => {
      journal.putNode({
        runId,
        siteId: "report#1",
        ordinal: index + 1,
        kind: "report",
        inputHash: `hash-${index}`,
        status: "completed",
        result: item,
      });
    });
  }

  it("终态快照带 journal 里的 report 条目，按报告顺序", async () => {
    const journal = new SweepableJournalStore();
    preloadRun(journal, { runId: "dwfrun-reports", status: "running" });
    preloadReports(journal, "dwfrun-reports", ["first finding", { file: "a.ts" }]);
    journal.updateRunStatus("dwfrun-reports", "completed", { result: "done" });
    const harness = makeHarness({ journal });

    const snapshot = await harness.service.getTask("dwfrun-reports");
    expect(snapshot?.reports).toEqual(["first finding", { file: "a.ts" }]);
    expect(snapshot?.output).toBe("done");
  });

  it("失败与取消的 run 一样带 reports（这条是 report 特性的目的）", async () => {
    for (const [status, taskStatus] of [
      ["errored", "failed"],
      ["stopped", "cancelled"],
    ] as const) {
      const journal = new SweepableJournalStore();
      const runId = `dwfrun-reports-${status}`;
      preloadRun(journal, { runId, status: "running" });
      preloadReports(journal, runId, ["finding before the end"]);
      journal.updateRunStatus(journal.getRun(runId)!.runId, status, {
        ...(status === "stopped" ? { stopReason: "user" as const } : {}),
        failure: { code: "DriverError", message: "boom" },
      });
      const harness = makeHarness({ journal });

      const snapshot = await harness.service.getTask(runId);
      expect(snapshot?.status).toBe(taskStatus);
      expect(snapshot?.runStatus).toBe(status);
      expect(snapshot?.reports).toEqual(["finding before the end"]);
    }
  });

  it("ask / world-read 节点不混进 reports；零条时字段整个缺席", async () => {
    const journal = new SweepableJournalStore();
    preloadRun(journal, { runId: "dwfrun-reports-mixed", status: "running" });
    journal.putNode({
      runId: "dwfrun-reports-mixed",
      siteId: "ask#1",
      ordinal: 1,
      kind: "ask",
      inputHash: "hash-ask",
      status: "completed",
      result: "an ask result, not a report",
    });
    journal.updateRunStatus("dwfrun-reports-mixed", "completed");
    const harness = makeHarness({ journal });

    const snapshot = await harness.service.getTask("dwfrun-reports-mixed");
    expect(snapshot?.status).toBe("completed");
    expect(snapshot && "reports" in snapshot).toBe(false);
  });

  
  it("running 的快照不读 report 节点（避免每次轮询扫全表）", async () => {
    const journal = new SweepableJournalStore();
    preloadRun(journal, { runId: "dwfrun-reports-running", status: "running" });
    preloadReports(journal, "dwfrun-reports-running", ["mid-run finding"]);
    const harness = makeHarness({ journal });
    const listNodes = vi.spyOn(journal, "listNodes");

    const snapshot = await harness.service.getTask("dwfrun-reports-running");
    expect(snapshot?.status).toBe("running");
    expect(snapshot && "reports" in snapshot).toBe(false);
    expect(listNodes).not.toHaveBeenCalled();
  });

  it("内存终态的 artifact 优先于 journal 记录的 result", async () => {
    const journal = new SweepableJournalStore();
    const harness = makeHarness({ journal });
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("in-memory-wins"),
    });
    await settle(harness, runId);
    journal.updateRunStatus(runId, "completed", { result: "journal-side value" });

    const snapshot = await harness.service.getTask(runId);
    expect(snapshot?.status).toBe("completed");
    expect(snapshot?.output).toBe("done");
  });

  it("listEvents 按 cursor 分页且越界返回空页", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("list-events"),
    });
    await settle(harness, runId);

    const { events: all, hasMore: allHasMore } = await harness.service.listEvents(runId, {});
    expect(allHasMore).toBe(false);
    expect(all.length).toBeGreaterThan(0);
    expect(all[0]!.type).toBe("run-started");
    expect(all[0]!.payload).toMatchObject({ runId });
    expect(all.map((event) => event.sequence)).toEqual(
      [...all.map((event) => event.sequence)].sort((a, b) => a - b),
    );

    const { events: firstPage, hasMore } = await harness.service.listEvents(runId, { limit: 2 });
    expect(firstPage).toHaveLength(2);
    expect(hasMore).toBe(true);
    const { events: secondPage } = await harness.service.listEvents(runId, {
      afterSequence: firstPage[1]!.sequence,
      limit: 2,
    });
    expect(secondPage[0]!.sequence).toBeGreaterThan(firstPage[1]!.sequence);

    const beyond = await harness.service.listEvents(runId, {
      afterSequence: all[all.length - 1]!.sequence + 1000,
    });
    expect(beyond).toEqual({ events: [], hasMore: false });
  });

  it("listEvents 不给 limit 时一页 500 条（事件日志从不一次读完）", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("list-events-page-cap"),
    });
    await settle(harness, runId);
    for (let i = 0; i < 600; i += 1) {
      harness.journal.appendEvent(runId, { type: "log", message: `line ${i}` });
    }

    const page = await harness.service.listEvents(runId, {});
    expect(page.events).toHaveLength(500);
    expect(page.hasMore).toBe(true);
    const asked = await harness.service.listEvents(runId, { limit: 501 });
    expect(asked.events).toHaveLength(501);
    const small = await harness.service.listEvents(runId, { limit: 3 });
    expect(small.events).toHaveLength(3);
  });

  it("When journal supports byte-based pagination, listEvents uses it with protocol\'s two default boundaries", async () => {
    const calls: Array<{ afterSequence?: number; limit: number; maxBytes: number }> = [];
    class PagingJournal extends SweepableJournalStore {
      listEventPage(
        runId: string,
        query: { afterSequence?: number; limit: number; maxBytes: number },
      ) {
        calls.push(query);
        const events = this.listEvents(runId, { types: "all", reportItems: "all" }).slice(0, 1);
        return { events, hasMore: true };
      }
    }
    const harness = makeHarness({ journal: new PagingJournal() });
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("list-events-byte-pages"),
    });
    await settle(harness, runId);

    const page = await harness.service.listEvents(runId, {});
    expect(calls).toEqual([
      {
        limit: WORKFLOW_RUN_EVENTS_PAGE_LIMITS.maxEvents,
        maxBytes: WORKFLOW_RUN_EVENTS_PAGE_LIMITS.maxBytes,
      },
    ]);
    expect(page.events).toHaveLength(1);
    expect(page.hasMore).toBe(true);
  });

  it("run 事件经 onRunEvent 钩子扇出", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("run-events"),
    });
    await settle(harness, runId);

    expect(harness.runEvents.every((event) => event.runId === runId)).toBe(true);
    const types = harness.runEvents.map((event) => event.eventType);
    expect(types).toContain("run-started");
    expect(types).toContain("run-settled");
  });

  it("钩子携带的 sequence 就是 journal sequence（与 listEvents 同一把尺）", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      toolCallId: createToolCallId(),
      trace: traceFor("run-progress-sequence"),
    });
    await settle(harness, runId);

    const { events: journalPage } = await harness.service.listEvents(runId, {});
    expect(harness.runEvents.map((event) => [event.sequence, event.eventType])).toEqual(
      journalPage.map((event) => [event.sequence, event.type]),
    );
    expect(harness.runEvents.map((event) => event.sequence)).toEqual(
      harness.runEvents.map((_, index) => index),
    );
  });

  it("actor-created 携带 actor 会话 id，且与 driver 真正使用的那个一致", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("run-progress-actor"),
    });
    await settle(harness, runId);

    const created = harness.runEvents.find((event) => event.eventType === "actor-created");
    expect(created?.actorSessionId).toBe(harness.actorRuntimeInputs[0]?.sessionId);
    expect(created?.actorSessionId).toContain(runId);
  });

  it("usage-updated 载荷自带已花 token，且等于 journal 列值（同一同步步骤产生）", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("run-progress-usage"),
    });
    await settle(harness, runId);

    const usage = harness.runEvents.filter((event) => event.eventType === "usage-updated");
    expect(usage.length).toBeGreaterThan(0);
    const last = usage.at(-1)!;
    expect(last.payload.spentTokens).toBe(harness.journal.getRun(runId)?.spentTokens);
    expect(last.payload.spentTokens).toBeGreaterThan(0);
    expect("spentTokens" in last).toBe(false);
  });

  it("载荷有界：超长 persona system prompt 被截断并置 truncated", async () => {
    const harness = makeHarness();
    const longPrompt = "x".repeat(5_000);
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: [
        "interface Answer { text: string }",
        `const a = await agent("worker", ${JSON.stringify(longPrompt)}).ask<Answer>("go");`,
        "return a.text;",
      ].join("\n"),
      trace: traceFor("run-progress-bounds"),
    });
    await settle(harness, runId);

    const created = harness.runEvents.find((event) => event.eventType === "actor-created");
    const persona = created?.payload.persona as { system?: string } | undefined;
    expect(created?.truncated).toBe(true);
    expect(persona?.system?.length).toBe(DYNAMIC_WORKFLOW_RUN_EVENT_PAYLOAD_LIMITS.maxStringLength);
    const { events: page } = await harness.service.listEvents(runId, {});
    const pageCreated = page.find((event) => event.type === "actor-created");
    expect((pageCreated?.payload.persona as { system?: string }).system?.length).toBe(
      DYNAMIC_WORKFLOW_RUN_EVENT_PAYLOAD_LIMITS.maxStringLength,
    );
    expect(pageCreated?.truncated).toBe(true);
  });

  it("终态事件永远落地：run-settled 是权威收口", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("run-progress-terminal"),
    });
    await settle(harness, runId);

    const settled = harness.runEvents.at(-1);
    expect(settled?.eventType).toBe("run-settled");
    expect(settled?.payload.status).toBe("completed");
  });

  it("钩子的 routing 携带 parentSessionId：事件必须落在发起该 run 的会话里", async () => {
    const harness = makeHarness();
    const parentSessionId = createSessionId("run-progress-routing-parent");
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("run-progress-routing"),
    });
    await settle(harness, runId);

    expect(harness.runEventRoutings.length).toBe(harness.runEvents.length);
    expect(new Set(harness.runEventRoutings.map((routing) => routing.parentSessionId))).toEqual(
      new Set([parentSessionId]),
    );
  });

  it("submit 未带 parentSessionId 时 routing 里就没有它（缺席，不是空串）", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("run-progress-routing-absent"),
    });
    await settle(harness, runId);

    expect(harness.runEventRoutings.every((routing) => !("parentSessionId" in routing))).toBe(true);
  });

  it("钩子抛错不打挂 run（观察者边界吞异常）", async () => {
    const harness = makeHarness({
      onRunEvent: () => {
        throw new Error("hook blew up");
      },
    });
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("run-progress-hook-throws"),
    });
    await settle(harness, runId);
    expect((await harness.service.getTask(runId))?.status).toBe("completed");
  });
});

describe("dynamic workflow run service — 孤儿 run 收敛", () => {
  it("构造时把本会话的非终态 run 收敛成 failed（interrupted 编码）", () => {
    const journal = new SweepableJournalStore();
    preloadRun(journal, {
      parentSessionId: HARNESS_PARENT_SESSION,
      runId: "dwfrun-orphan-running",
      status: "running",
    });
    preloadRun(journal, {
      parentSessionId: HARNESS_PARENT_SESSION,
      runId: "dwfrun-orphan-pending",
      status: "pending",
    });

    makeHarness({ journal });

    for (const runId of ["dwfrun-orphan-running", "dwfrun-orphan-pending"]) {
      const record = journal.getRun(runId);
      expect(record?.status).toBe("stopped");
      expect(record?.stopReason).toBe("interrupted");
      expect(record?.failure?.code).toBe("Interrupted");
      expect(record?.failure?.message).toContain(runId);
    }
  });

  it("每个被收敛的 run 记一条 warn（带 runId）", () => {
    const journal = new SweepableJournalStore();
    preloadRun(journal, {
      parentSessionId: HARNESS_PARENT_SESSION,
      runId: "dwfrun-orphan-logged",
      status: "running",
    });

    const harness = makeHarness({ journal });

    const warnings = harness.logs.filter(
      (entry) => entry.level === "warn" && entry.context?.runId === "dwfrun-orphan-logged",
    );
    expect(warnings).toHaveLength(1);
  });

  it("本会话的终态 run 一律不动", () => {
    const journal = new SweepableJournalStore();
    for (const status of ["completed", "errored", "stopped"] as const) {
      preloadRun(journal, {
        parentSessionId: HARNESS_PARENT_SESSION,
        runId: `dwfrun-terminal-${status}`,
        status,
      });
    }

    makeHarness({ journal });

    for (const status of ["completed", "errored", "stopped"] as const) {
      const record = journal.getRun(`dwfrun-terminal-${status}`);
      expect(record?.status).toBe(status);
      expect(record?.failure).toBeUndefined();
    }
  });

  it("别的会话（以及无父会话）的非终态 run 不动", () => {
    const journal = new SweepableJournalStore();
    preloadRun(journal, {
      parentSessionId: createSessionId("sibling-session"),
      runId: "dwfrun-sibling-live",
      status: "running",
    });
    preloadRun(journal, { runId: "dwfrun-orphaned-parentless", status: "running" });

    makeHarness({ journal });

    expect(journal.getRun("dwfrun-sibling-live")?.status).toBe("running");
    expect(journal.getRun("dwfrun-orphaned-parentless")?.status).toBe("running");
  });

  it("构造后 submit 的 run 不受收敛影响", async () => {
    const journal = new SweepableJournalStore();
    preloadRun(journal, {
      parentSessionId: HARNESS_PARENT_SESSION,
      runId: "dwfrun-orphan-before-submit",
      status: "running",
    });
    const harness = makeHarness({ journal });

    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("sweep-then-submit"),
    });
    await settle(harness, runId);

    expect((await harness.service.getTask(runId))?.status).toBe("completed");
    expect(journal.getRun(runId)?.failure).toBeUndefined();
    expect(journal.getRun("dwfrun-orphan-before-submit")?.status).toBe("stopped");
  });

  it("getTask 对被收敛的 run 回 stopped(interrupted) 并带失败原因", async () => {
    const journal = new SweepableJournalStore();
    preloadRun(journal, {
      parentSessionId: HARNESS_PARENT_SESSION,
      runId: "dwfrun-orphan-snapshot",
      status: "running",
    });
    const harness = makeHarness({ journal });

    const snapshot = await harness.service.getTask("dwfrun-orphan-snapshot");
    expect(snapshot?.status).toBe("cancelled");
    expect(snapshot?.runStatus).toBe("stopped");
    expect(snapshot?.stopReason).toBe("interrupted");
    expect(snapshot?.failure?.code).toBe("Interrupted");
    expect(snapshot?.error).toContain("dwfrun-orphan-snapshot");
  });

  it("收敛不给事件日志添任何一条事件", async () => {
    const journal = new SweepableJournalStore();
    preloadRun(journal, {
      parentSessionId: HARNESS_PARENT_SESSION,
      runId: "dwfrun-orphan-events",
      status: "running",
    });
    journal.appendEvent("dwfrun-orphan-events", {
      caps: { maxConcurrency: 4 },
      runId: "dwfrun-orphan-events",
      type: "run-started",
    });

    const harness = makeHarness({ journal });

    const { events } = await harness.service.listEvents("dwfrun-orphan-events", {});
    expect(events.map((event) => event.type)).toEqual(["run-started"]);
  });

  it("二次构造幂等：没有可收敛项时一次写入都没有", () => {
    const journal = new SweepableJournalStore();
    preloadRun(journal, {
      parentSessionId: HARNESS_PARENT_SESSION,
      runId: "dwfrun-orphan-idempotent",
      status: "running",
    });

    makeHarness({ journal });
    expect(journal.getRun("dwfrun-orphan-idempotent")?.status).toBe("stopped");

    const updateRunStatus = vi.spyOn(journal, "updateRunStatus");
    makeHarness({ journal });
    expect(updateRunStatus).not.toHaveBeenCalled();
  });

  it("journal 不带窄查询时跳过收敛并记原因", () => {
    const journal = new InMemoryJournalStore();
    preloadRun(journal, {
      parentSessionId: HARNESS_PARENT_SESSION,
      runId: "dwfrun-no-query",
      status: "running",
    });

    const harness = makeHarness({ journal });

    expect(journal.getRun("dwfrun-no-query")?.status).toBe("running");
    expect(
      harness.logs.some((entry) => JSON.stringify(entry.context ?? {}).includes("non_terminal")),
    ).toBe(true);
  });

  it("真实 sqlite journal 上收敛生效，且只碰本会话", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "cf-dwf-sweep-"));
    const store = await createSqliteSessionStore({ dbPath: join(tempRoot, "session.sqlite") });
    try {
      const journal = resolveDynamicWorkflowJournalStore(store as never);
      expect(journal).toBeDefined();

      preloadRun(journal!, {
        parentSessionId: HARNESS_PARENT_SESSION,
        runId: "dwfrun-sqlite-orphan",
        status: "running",
      });
      preloadRun(journal!, {
        parentSessionId: createSessionId("sqlite-sibling"),
        runId: "dwfrun-sqlite-sibling",
        status: "running",
      });
      journal!.appendEvent("dwfrun-sqlite-orphan", {
        caps: { maxConcurrency: 4 },
        runId: "dwfrun-sqlite-orphan",
        type: "run-started",
      });

      const harness = makeHarness({ journal: journal! });

      const reconciled = journal!.getRun("dwfrun-sqlite-orphan");
      expect(reconciled?.status).toBe("stopped");
      expect(reconciled?.stopReason).toBe("interrupted");
      expect(reconciled?.failure?.code).toBe("Interrupted");
      expect(journal!.getRun("dwfrun-sqlite-sibling")?.status).toBe("running");
      expect((await harness.service.listEvents("dwfrun-sqlite-orphan", {})).events).toHaveLength(1);
    } finally {
      store.close();
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
});

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

let projectCwd = "";
let otherCwd = "";
let introspectCwdRoot = "";

beforeAll(async () => {
  introspectCwdRoot = await mkdtemp(join(tmpdir(), "cf-dwf-cwd-"));
  projectCwd = join(introspectCwdRoot, "project");
  otherCwd = join(introspectCwdRoot, "other");
  await mkdir(projectCwd, { recursive: true });
  await mkdir(otherCwd, { recursive: true });
});

afterAll(async () => {
  await rm(introspectCwdRoot, { force: true, recursive: true });
});

async function withSqliteJournal(
  run: (journal: JournalStorePort & DwfRunIntrospectionQueries) => Promise<void>,
): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "cf-dwf-introspect-"));
  const store = await createSqliteSessionStore({ dbPath: join(tempRoot, "session.sqlite") });
  try {
    const journal = resolveDynamicWorkflowJournalStore(store as never);
    expect(journal).toBeDefined();
    await run(journal as JournalStorePort & DwfRunIntrospectionQueries);
  } finally {
    store.close();
    await rm(tempRoot, { force: true, recursive: true });
  }
}

function introspectionOf(harness: Harness): {
  getRunDetail: (runId: string) => Promise<DynamicWorkflowRunDetail | undefined>;
  listRuns: (query: DynamicWorkflowRunListQuery) => Promise<DynamicWorkflowRunListResult>;
} {
  const { getRunDetail, listRuns } = harness.service;
  return { getRunDetail: getRunDetail!, listRuns: listRuns! };
}

function hideRunsFromReads(
  journal: JournalStorePort & DwfRunIntrospectionQueries,
  hidden: ReadonlySet<string>,
): JournalStorePort & DwfRunIntrospectionQueries {
  return {
    createRun: (record) => journal.createRun(record),
    getRun: (runId) => (hidden.has(runId) ? undefined : journal.getRun(runId)),
    updateRunStatus: (runId, status, settlement) =>
      journal.updateRunStatus(runId, status, settlement),
    updateRunUsage: (runId, spentTokens) => journal.updateRunUsage(runId, spentTokens),
    updateRunCaps: (runId, caps) => journal.updateRunCaps(runId, caps),
    putActor: (record) => journal.putActor(record),
    getActor: (runId, siteId, ordinal) => journal.getActor(runId, siteId, ordinal),
    listActors: (runId, opts) => journal.listActors(runId, opts),
    putNode: (record) => journal.putNode(record),
    getNode: (runId, siteId, ordinal, opts) => journal.getNode(runId, siteId, ordinal, opts),
    listNodes: (runId, opts) => journal.listNodes(runId, opts),
    countNodes: (runId, kind) => journal.countNodes(runId, kind),
    appendEvent: (runId, event) => journal.appendEvent(runId, event),
    listEvents: (runId, opts) => journal.listEvents(runId, opts),
    countNodesByStatus: (runId) => journal.countNodesByStatus(runId),
    getRunRow: (runId) => (hidden.has(runId) ? undefined : journal.getRunRow(runId)),
    listRecentLogEvents: (runId, limit) => journal.listRecentLogEvents(runId, limit),
    listRuns: (query) => journal.listRuns(query).filter((row) => !hidden.has(row.runId)),
    listArtifactRows: (runId) => journal.listArtifactRows(runId),
    countTaggedReports: (runId) => journal.countTaggedReports(runId),
    listArtifactItems: (runId, artifactId, query) =>
      journal.listArtifactItems(runId, artifactId, query),
    listEventPage: (runId, query) => journal.listEventPage(runId, query),
  };
}

describe("dynamic workflow run service — run name 落库", () => {
  it("submit 带 name → dwf_run.name 落库", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      name: "nightly triage",
      scriptText: TYPED_SCRIPT,
      trace: traceFor("submit-name"),
    });
    await settle(harness, runId);

    expect(harness.journal.getRun(runId)?.name).toBe("nightly triage");
  });

  it("未命名的 submit 不写 name（键缺席，读侧走脚本首行兜底）", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("submit-no-name"),
    });
    await settle(harness, runId);

    expect("name" in harness.journal.getRun(runId)!).toBe(false);
  });
});

describe("dynamic workflow run service — 内省能力探测", () => {
  it("journal 不带内省查询时两个可选成员缺席", () => {
    const harness = makeHarness({ journal: new InMemoryJournalStore() });
    expect(harness.service.listRuns).toBeUndefined();
    expect(harness.service.getRunDetail).toBeUndefined();
  });
});

describe("dynamic workflow run service — listRuns 真相合成", () => {
  it("本会话在飞的 run：running、归本会话、不标 possiblyInterrupted", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ hangActors: true, journal });
      const runId = await submitRun(harness, {
        cwd: projectCwd,
        name: "in flight",
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: TYPED_SCRIPT,
        trace: traceFor("list-in-flight"),
      });
      await vi.waitFor(() => {
        expect(harness.actorRuntimeInputs.length).toBeGreaterThan(0);
      });

      const { runs } = await introspectionOf(harness).listRuns({ cwd: projectCwd, limit: 20 });
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        label: "in flight",
        labelSource: "name",
        ownedByThisSession: true,
        runId,
        status: "running",
      });
      expect("possiblyInterrupted" in runs[0]!).toBe(false);

      await harness.service.cancel(runId);
      await settle(harness, runId);
    });
  });

  it("注册表命中即归本会话，即使 journal 行记的是别的会话", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ hangActors: true, journal });
      const runId = await submitRun(harness, {
        cwd: projectCwd,
        parentSessionId: createSessionId("some-other-session"),
        scriptText: TYPED_SCRIPT,
        trace: traceFor("list-registry-owned"),
      });
      await vi.waitFor(() => {
        expect(harness.actorRuntimeInputs.length).toBeGreaterThan(0);
      });

      const { runs } = await introspectionOf(harness).listRuns({ cwd: projectCwd, limit: 20 });
      expect(runs[0]).toMatchObject({ ownedByThisSession: true, runId, status: "running" });
      expect("possiblyInterrupted" in runs[0]!).toBe(false);

      await harness.service.cancel(runId);
      await settle(harness, runId);
    });
  });

  it("内存终态优先于 journal 状态", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      const runId = await submitRun(harness, {
        cwd: projectCwd,
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: TYPED_SCRIPT,
        trace: traceFor("list-memory-wins"),
      });
      await settle(harness, runId);
      journal.updateRunStatus(runId, "running");

      const { runs } = await introspectionOf(harness).listRuns({ cwd: projectCwd, limit: 20 });
      expect(runs[0]).toMatchObject({ runId, status: "completed" });
      expect("possiblyInterrupted" in runs[0]!).toBe(false);
    });
  });

  it("他会话的非终态 run 标 possiblyInterrupted 且不归本会话", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      preloadRun(journal, {
        cwd: projectCwd,
        parentSessionId: createSessionId("sibling-session"),
        runId: "dwfrun-sibling-running",
        status: "running",
      });

      const { runs } = await introspectionOf(harness).listRuns({ cwd: projectCwd, limit: 20 });
      expect(runs[0]).toMatchObject({
        ownedByThisSession: false,
        possiblyInterrupted: true,
        runId: "dwfrun-sibling-running",
        status: "running",
      });
      expect(journal.getRun("dwfrun-sibling-running")?.status).toBe("running");
    });
  });

  it("他会话的终态 run 不标 possiblyInterrupted", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      for (const status of ["completed", "errored", "stopped"] as const) {
        preloadRun(journal, {
          cwd: projectCwd,
          parentSessionId: createSessionId("sibling-session"),
          runId: `dwfrun-sibling-${status}`,
          status,
          ...(status === "stopped" ? { stopReason: "user" as const } : {}),
        });
      }

      const { runs } = await introspectionOf(harness).listRuns({ cwd: projectCwd, limit: 20 });
      expect(runs).toHaveLength(3);
      for (const item of runs) {
        expect(item.ownedByThisSession).toBe(false);
        expect("possiblyInterrupted" in item).toBe(false);
      }
    });
  });

  it("别的项目的 run 不可见（cwd 是字面等值的项目键）", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      preloadRun(journal, {
        cwd: projectCwd,
        runId: "dwfrun-here",
        status: "completed",
      });
      preloadRun(journal, {
        cwd: otherCwd,
        runId: "dwfrun-elsewhere",
        status: "completed",
      });

      const { runs } = await introspectionOf(harness).listRuns({ cwd: projectCwd, limit: 20 });
      expect(runs.map((item) => item.runId)).toEqual(["dwfrun-here"]);
    });
  });

  it("statuses 过滤与 limit 都下推到查询", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      for (const status of ["completed", "errored"] as const) {
        preloadRun(journal, { cwd: projectCwd, runId: `dwfrun-${status}`, status });
      }
      const introspection = introspectionOf(harness);

      const filtered = await introspection.listRuns({
        cwd: projectCwd,
        limit: 20,
        statuses: ["errored"],
      });
      expect(filtered.runs.map((item) => item.runId)).toEqual(["dwfrun-errored"]);

      const limited = await introspection.listRuns({ cwd: projectCwd, limit: 1 });
      expect(limited.runs).toHaveLength(1);
    });
  });

  describe("truncated", () => {
    it("为真当且仅当还有 run 没进这一页", async () => {
      await withSqliteJournal(async (journal) => {
        const harness = makeHarness({ journal });
        for (const index of [1, 2, 3]) {
          preloadRun(journal, {
            cwd: projectCwd,
            runId: `dwfrun-page-${index}`,
            status: "completed",
          });
        }
        const introspection = introspectionOf(harness);

        const firstPage = await introspection.listRuns({ cwd: projectCwd, limit: 2 });
        expect(firstPage.runs).toHaveLength(2);
        expect(firstPage.truncated).toBe(true);

        const exactPage = await introspection.listRuns({ cwd: projectCwd, limit: 3 });
        expect(exactPage.runs).toHaveLength(3);
        expect("truncated" in exactPage).toBe(false);

        const roomyPage = await introspection.listRuns({ cwd: projectCwd, limit: 20 });
        expect("truncated" in roomyPage).toBe(false);
      });
    });

    
    it("在钳制上限那一页仍然标 truncated（探测行必须能过存储层）", async () => {
      await withSqliteJournal(async (journal) => {
        const harness = makeHarness({ journal });
        const overflow = LIST_WORKFLOW_RUNS_MAX_LIMIT + 1;
        for (let index = 0; index < overflow; index += 1) {
          preloadRun(journal, {
            cwd: projectCwd,
            runId: `dwfrun-max-${String(index).padStart(3, "0")}`,
            status: "completed",
          });
        }

        const page = await introspectionOf(harness).listRuns({
          cwd: projectCwd,
          limit: LIST_WORKFLOW_RUNS_MAX_LIMIT,
        });
        expect(page.runs).toHaveLength(LIST_WORKFLOW_RUNS_MAX_LIMIT);
        expect(page.truncated).toBe(true);
      });
    });

    it("空项目与被 statuses 过滤空的页都不标 truncated", async () => {
      await withSqliteJournal(async (journal) => {
        const harness = makeHarness({ journal });
        preloadRun(journal, { cwd: projectCwd, runId: "dwfrun-only", status: "completed" });
        const introspection = introspectionOf(harness);

        expect(await introspection.listRuns({ cwd: otherCwd, limit: 20 })).toEqual({ runs: [] });
        expect(
          await introspection.listRuns({ cwd: projectCwd, limit: 20, statuses: ["errored"] }),
        ).toEqual({ runs: [] });
      });
    });

    it("注册表补集把 journal 行挤出页时标 truncated", async () => {
      await withSqliteJournal(async (real) => {
        const hidden = new Set<string>();
        const journal = hideRunsFromReads(real, hidden);
        const harness = makeHarness({ hangActors: true, journal });
        preloadRun(real, { cwd: projectCwd, runId: "dwfrun-older", status: "completed" });

        const runId = await submitRun(harness, {
          cwd: projectCwd,
          parentSessionId: HARNESS_PARENT_SESSION,
          scriptText: TYPED_SCRIPT,
          trace: traceFor("gap-truncates"),
        });
        hidden.add(runId);

        const page = await introspectionOf(harness).listRuns({ cwd: projectCwd, limit: 1 });
        expect(page.runs.map((item) => item.runId)).toEqual([runId]);
        expect(page.truncated).toBe(true);

        await harness.service.cancel(runId);
        await settle(harness, runId);
      });
    });
  });

  it("label fallback: legacy rows without name use script\'s first non-empty line", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      preloadRun(journal, {
        cwd: projectCwd,
        runId: "dwfrun-unnamed",
        scriptText: "\n  // triage the failing tests\nreturn 1;",
        status: "completed",
      });

      const { runs } = await introspectionOf(harness).listRuns({ cwd: projectCwd, limit: 20 });
      expect(runs[0]).toMatchObject({
        label: "// triage the failing tests",
        labelSource: "script",
      });
      expect("name" in journal.getRun("dwfrun-unnamed")!).toBe(false);
    });
  });

  it("合成过程不写 journal（写入面零调用、行逐字段不变）", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      preloadRun(journal, {
        cwd: projectCwd,
        parentSessionId: createSessionId("sibling-session"),
        runId: "dwfrun-readonly",
        status: "running",
      });
      const before = journal.getRun("dwfrun-readonly");

      const createRun = vi.spyOn(journal, "createRun");
      const updateRunStatus = vi.spyOn(journal, "updateRunStatus");
      const updateRunUsage = vi.spyOn(journal, "updateRunUsage");
      const appendEvent = vi.spyOn(journal, "appendEvent");
      const putNode = vi.spyOn(journal, "putNode");
      const putActor = vi.spyOn(journal, "putActor");

      const introspection = introspectionOf(harness);
      await introspection.listRuns({ cwd: projectCwd, limit: 20 });
      await introspection.getRunDetail("dwfrun-readonly");

      for (const spy of [
        createRun,
        updateRunStatus,
        updateRunUsage,
        appendEvent,
        putNode,
        putActor,
      ]) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(journal.getRun("dwfrun-readonly")).toEqual(before);
    });
  });
});

describe("dynamic workflow run service — submit → createRun 的间隙", () => {
  it("注册表-only 的 run 以 pending 附加，且排在 journal 行之前", async () => {
    await withSqliteJournal(async (real) => {
      const hidden = new Set<string>();
      const journal = hideRunsFromReads(real, hidden);
      const harness = makeHarness({ hangActors: true, journal });
      preloadRun(real, {
        cwd: projectCwd,
        parentSessionId: createSessionId("sibling-session"),
        runId: "dwfrun-already-journaled",
        status: "completed",
      });

      const runId = await submitRun(harness, {
        cwd: projectCwd,
        name: "just submitted",
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: TYPED_SCRIPT,
        trace: traceFor("list-gap"),
      });
      hidden.add(runId);

      const { runs } = await introspectionOf(harness).listRuns({ cwd: projectCwd, limit: 20 });
      expect(runs.map((item) => item.runId)).toEqual([runId, "dwfrun-already-journaled"]);
      expect(runs[0]).toMatchObject({
        label: "just submitted",
        labelSource: "name",
        ownedByThisSession: true,
        spentTokens: 0,
        status: "pending",
      });
      expect("possiblyInterrupted" in runs[0]!).toBe(false);

      await harness.service.cancel(runId);
      await settle(harness, runId);
    });
  });

  it("间隙里的 run 不受 cwd 与 statuses 过滤的豁免", async () => {
    await withSqliteJournal(async (real) => {
      const hidden = new Set<string>();
      const journal = hideRunsFromReads(real, hidden);
      const harness = makeHarness({ hangActors: true, journal });

      const runId = await submitRun(harness, {
        cwd: projectCwd,
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: TYPED_SCRIPT,
        trace: traceFor("list-gap-filters"),
      });
      hidden.add(runId);
      const introspection = introspectionOf(harness);

      expect((await introspection.listRuns({ cwd: otherCwd, limit: 20 })).runs).toEqual([]);
      expect(
        (await introspection.listRuns({ cwd: projectCwd, limit: 20, statuses: ["completed"] }))
          .runs,
      ).toEqual([]);

      await harness.service.cancel(runId);
      await settle(harness, runId);
    });
  });

  it("getRunDetail 对间隙里的 run 回 pending 详情而不是 not_found", async () => {
    await withSqliteJournal(async (real) => {
      const hidden = new Set<string>();
      const journal = hideRunsFromReads(real, hidden);
      const harness = makeHarness({ hangActors: true, journal });

      const runId = await submitRun(harness, {
        cwd: projectCwd,
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: TYPED_SCRIPT,
        trace: traceFor("detail-gap"),
      });
      hidden.add(runId);

      const detail = await introspectionOf(harness).getRunDetail(runId);
      expect(detail).toMatchObject({
        actors: [],
        logTail: [],
        ownedByThisSession: true,
        runId,
        status: "pending",
      });
      expect(detail?.usage).toEqual({
        nodesCompleted: 0,
        nodesFailed: 0,
        nodesObserved: 0,
        nodesRunning: 0,
        spentTokens: 0,
      });
      expect("result" in detail!).toBe(false);
      expect("error" in detail!).toBe(false);

      await harness.service.cancel(runId);
      await settle(harness, runId);
    });
  });
});

describe("dynamic workflow run service — getRunDetail 组合", () => {
  //
  const DETAIL_ARTIFACT_SCRIPT = [
    'artifact.chart("perf", { x: { field: "round" }, y: { field: "ms" } });',
    'report({ round: 1, ms: 40 }, "perf");',
    'await artifact.markdown("summary", "# 结论");',
    'return "done";',
  ].join("\n");

  
  function detailArtifactStore(): ToolArtifactStorePort {
    return {
      writeToolResultArtifact: async (request) => ({
        id: "artifact-1",
        uri: "cf-artifact://harness/artifact-1",
        bytes: Buffer.byteLength(request.content, "utf8"),
        contentType: request.contentType ?? "text/plain",
        createdAt: new Date(0),
      }),
      readToolResultArtifact: async () => {
        throw new Error("本用例不读字节");
      },
    };
  }

  it("journal 行分支带 artifacts 截面（看板 + 内容产物，版本与 itemCount 齐全）", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ artifactStore: detailArtifactStore(), journal });
      const runId = await submitRun(harness, {
        cwd: projectCwd,
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: DETAIL_ARTIFACT_SCRIPT,
        trace: traceFor("detail-artifacts"),
      });
      await settle(harness, runId);

      const detail = await introspectionOf(harness).getRunDetail(runId);
      expect(detail?.artifacts).toHaveLength(2);
      expect(detail?.artifacts?.[0]).toMatchObject({
        id: "perf",
        kind: "chart",
        version: 1,
        itemCount: 1,
      });
      expect(detail?.artifacts?.[1]).toMatchObject({
        id: "summary",
        kind: "markdown",
        version: 1,
        contentType: "text/markdown",
        itemCount: 0,
      });
      expect(detail?.artifacts).toEqual(await harness.service.listArtifacts!(runId));
    });
  });

  it("间隙分支也带 artifacts：dwf_run 行还没落，节点行却可能已经落了", async () => {
    await withSqliteJournal(async (real) => {
      const hidden = new Set<string>();
      const journal = hideRunsFromReads(real, hidden);
      const harness = makeHarness({ artifactStore: detailArtifactStore(), journal });
      const runId = await submitRun(harness, {
        cwd: projectCwd,
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: DETAIL_ARTIFACT_SCRIPT,
        trace: traceFor("detail-artifacts-gap"),
      });
      await settle(harness, runId);
      hidden.add(runId);

      const detail = await introspectionOf(harness).getRunDetail(runId);
      expect(detail?.usage).toMatchObject({ nodesObserved: 0, spentTokens: 0 });
      expect(detail?.actors).toEqual([]);
      expect(detail?.artifacts?.map((entry) => entry.id)).toEqual(["perf", "summary"]);
    });
  });

  it("零产物的 run：两条分支都让 artifacts 整个字段缺席（不是空数组）", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      const runId = await submitRun(harness, {
        cwd: projectCwd,
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: TYPED_SCRIPT,
        trace: traceFor("detail-artifacts-none"),
      });
      await settle(harness, runId);

      const detail = await introspectionOf(harness).getRunDetail(runId);
      expect(detail).toBeDefined();
      expect("artifacts" in detail!).toBe(false);
    });
  });

  it("未知 runId 回 undefined（工具层归一成 run_not_found）", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      expect(await introspectionOf(harness).getRunDetail("dwfrun-nope")).toBeUndefined();
    });
  });

  it("节点三态计数、nodesObserved 为三者之和、用量直读 journal 行", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      preloadRun(journal, {
        spentTokens: 4_321,
        caps: { maxConcurrency: 4 },
        cwd: projectCwd,
        parentSessionId: HARNESS_PARENT_SESSION,
        runId: "dwfrun-counts",
        status: "completed",
      });
      const nodes: { ordinal: number; status: "completed" | "failed" | "running" }[] = [
        { ordinal: 1, status: "completed" },
        { ordinal: 2, status: "completed" },
        { ordinal: 3, status: "failed" },
        { ordinal: 4, status: "running" },
      ];
      for (const node of nodes) {
        journal.putNode({
          runId: "dwfrun-counts",
          siteId: "ask#1",
          ordinal: node.ordinal,
          kind: "ask",
          inputHash: `hash-${node.ordinal}`,
          status: node.status,
        });
      }

      const detail = await introspectionOf(harness).getRunDetail("dwfrun-counts");
      expect(detail?.usage).toEqual({
        nodesCompleted: 2,
        nodesFailed: 1,
        nodesObserved: 4,
        nodesRunning: 1,
        spentTokens: 4_321,
      });
    });
  });

  it("Journal row branch includes situation cross-section: sub-agent\'s current ask includes task summary and progress reading, phase table in declaration order", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      const runId = "dwfrun-roster-wired";
      preloadRun(journal, {
        cwd: projectCwd,
        parentSessionId: HARNESS_PARENT_SESSION,
        runId,
        status: "running",
      });
      journal.putActor({ runId, siteId: "agent#1", ordinal: 1, name: "scout" });
      journal.putNode({
        runId,
        siteId: "ask#1",
        ordinal: 1,
        kind: "ask",
        actorSiteId: "agent#1",
        actorOrdinal: 1,
        actorSeq: 1,
        inputHash: "hash-ask-1",
        status: "running",
      });
      for (const event of [
        { type: "run-started", runId, caps: { maxConcurrency: 4 } },
        { type: "run-launched", inputId: "in-wired", phaseNames: ["collect", "verify"] },
        { type: "phase-entered", name: "collect", ordinal: 1 },
        { type: "actor-created", actor: { siteId: "agent#1", ordinal: 1 }, name: "scout" },
        {
          type: "node-queued",
          instance: { siteId: "ask#1", ordinal: 1 },
          kind: "ask",
          actor: { siteId: "agent#1", ordinal: 1 },
          actorSeq: 1,
          phaseName: "collect",
          instructionsHead: "Collect every regression named in the release notes.",
        },
        { type: "node-dispatched", instance: { siteId: "ask#1", ordinal: 1 } },
        { type: "node-executing", instance: { siteId: "ask#1", ordinal: 1 } },
        {
          type: "node-progress",
          instance: { siteId: "ask#1", ordinal: 1 },
          turn: 2,
          toolCalls: 7,
          lastTool: { name: "Read", target: "docs/release.md" },
        },
      ] as RunEvent[]) {
        journal.appendEvent(runId, event);
      }

      const detail = await introspectionOf(harness).getRunDetail(runId);
      expect(detail?.subagents).toHaveLength(1);
      expect(detail?.subagents[0]).toMatchObject({
        siteId: "agent#1",
        name: "scout",
        state: "executing",
        phaseName: "collect",
        currentAsk: {
          siteId: "ask#1",
          ordinal: 1,
          actorSeq: 1,
          instructionsHead: "Collect every regression named in the release notes.",
          turn: 2,
          toolCalls: 7,
          lastTool: { name: "Read", target: "docs/release.md" },
        },
      });
      expect(detail?.subagents[0]?.currentAsk?.startedAt).toBeGreaterThan(0);
      expect(detail?.phases).toMatchObject([
        { name: "collect", state: "current", rounds: 1, nodesRunning: 1 },
        { name: "verify", state: "ahead", rounds: 0 },
      ]);
      expect(detail?.ownedByThisSession).toBe(true);
      expect(detail?.health).toMatchObject({
        consecutiveFailures: 0,
        cachedSteps: 0,
        pendingQuestionsKnown: false,
      });
    });
  });

  it("终态 run：pendingQuestionsKnown 为真（没有人还在听），遗留的 running 行被数出来", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      const runId = "dwfrun-roster-terminal";
      preloadRun(journal, {
        cwd: projectCwd,
        parentSessionId: HARNESS_PARENT_SESSION,
        runId,
        status: "stopped",
        stopReason: "interrupted",
      });
      journal.putActor({ runId, siteId: "agent#1", ordinal: 1, name: "worker" });
      journal.putNode({
        runId,
        siteId: "ask#1",
        ordinal: 1,
        kind: "ask",
        actorSiteId: "agent#1",
        actorOrdinal: 1,
        actorSeq: 1,
        inputHash: "hash-ask-1",
        status: "running",
      });
      for (const event of [
        { type: "run-started", runId, caps: { maxConcurrency: 4 } },
        { type: "actor-created", actor: { siteId: "agent#1", ordinal: 1 }, name: "worker" },
        {
          type: "node-queued",
          instance: { siteId: "ask#1", ordinal: 1 },
          kind: "ask",
          actor: { siteId: "agent#1", ordinal: 1 },
          actorSeq: 1,
        },
        { type: "node-dispatched", instance: { siteId: "ask#1", ordinal: 1 } },
      ] as RunEvent[]) {
        journal.appendEvent(runId, event);
      }

      const detail = await introspectionOf(harness).getRunDetail(runId);
      expect(detail?.health).toMatchObject({ pendingQuestionsKnown: true, leftoverRunning: 1 });
      expect(detail?.subagents[0]).toMatchObject({ name: "worker", state: "unfinished" });
      expect("phases" in detail!).toBe(false);
    });
  });

  it("actors 全列出（siteId / ordinal / name），persona 不出", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      preloadRun(journal, { cwd: projectCwd, runId: "dwfrun-actors", status: "completed" });
      journal.putActor({
        runId: "dwfrun-actors",
        siteId: "actor#1",
        ordinal: 1,
        name: "worker",
        persona: { system: "a very long system prompt" },
      });
      journal.putActor({ runId: "dwfrun-actors", siteId: "actor#2", ordinal: 3 });

      const detail = await introspectionOf(harness).getRunDetail("dwfrun-actors");
      expect(detail?.actors).toEqual([
        { siteId: "actor#1", ordinal: 1, name: "worker" },
        { siteId: "actor#2", ordinal: 3 },
      ]);
    });
  });

  it("logTail：只取 log 事件、末 20 条、按时序、逐条 2048 字符界", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      preloadRun(journal, { cwd: projectCwd, runId: "dwfrun-logs", status: "completed" });
      journal.appendEvent("dwfrun-logs", {
        caps: { maxConcurrency: 4 },
        runId: "dwfrun-logs",
        type: "run-started",
      });
      for (let index = 1; index <= 25; index += 1) {
        journal.appendEvent("dwfrun-logs", { message: `step ${index}`, type: "log" });
      }
      const overlong = "x".repeat(5_000);
      journal.appendEvent("dwfrun-logs", { message: overlong, type: "log" });

      const detail = await introspectionOf(harness).getRunDetail("dwfrun-logs");
      const logTail = detail!.logTail;
      expect(logTail).toHaveLength(20);
      expect(logTail.map((entry) => entry.sequence)).toEqual(
        [...logTail].sort((left, right) => left.sequence - right.sequence).map((e) => e.sequence),
      );
      expect(logTail[0]?.message).toBe("step 7");
      expect(logTail.at(-1)?.message).toHaveLength(
        DYNAMIC_WORKFLOW_RUN_EVENT_PAYLOAD_LIMITS.maxStringLength,
      );
      expect(logTail.some((entry) => entry.message.includes("run-started"))).toBe(false);
      for (const entry of logTail) {
        expect(typeof entry.at).toBe("number");
        expect(entry.at).toBeLessThanOrEqual(Date.now());
      }
    });
  });

  it("没有 log 事件时 logTail 是空数组", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      preloadRun(journal, { cwd: projectCwd, runId: "dwfrun-nologs", status: "completed" });

      expect((await introspectionOf(harness).getRunDetail("dwfrun-nologs"))?.logTail).toEqual([]);
    });
  });

  it("createdAt / updatedAt 来自 journal 行", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      const before = Date.now();
      preloadRun(journal, { cwd: projectCwd, runId: "dwfrun-times", status: "running" });
      journal.updateRunStatus("dwfrun-times", "completed");
      const after = Date.now();

      const detail = await introspectionOf(harness).getRunDetail("dwfrun-times");
      expect(detail!.createdAt).toBeGreaterThanOrEqual(before);
      expect(detail!.updatedAt).toBeGreaterThanOrEqual(detail!.createdAt);
      expect(detail!.updatedAt).toBeLessThanOrEqual(after);
    });
  });

  it("running 的 run 既无 result 也无 error", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      preloadRun(journal, {
        cwd: projectCwd,
        parentSessionId: createSessionId("sibling-session"),
        runId: "dwfrun-running",
        status: "running",
      });

      const detail = await introspectionOf(harness).getRunDetail("dwfrun-running");
      expect("result" in detail!).toBe(false);
      expect("error" in detail!).toBe(false);
    });
  });

  it("completed：内存终态的产物原样交出（不序列化）", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({
        actorScripts: { "actor#1@1": [{ kind: "submit", result: { text: "the answer" } }] },
        journal,
      });
      const runId = await submitRun(harness, {
        cwd: projectCwd,
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: TYPED_SCRIPT,
        trace: traceFor("detail-result-memory"),
      });
      await settle(harness, runId);

      const detail = await introspectionOf(harness).getRunDetail(runId);
      expect(detail?.status).toBe("completed");
      expect(detail?.result).toBe("the answer");
      expect("error" in detail!).toBe(false);
    });
  });

  it("completed: falls back to journal\'s result_json once registry evaporates", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      preloadRun(journal, { cwd: projectCwd, runId: "dwfrun-result-json", status: "running" });
      journal.updateRunStatus("dwfrun-result-json", "completed", {
        result: { report: "final answer", steps: 3 },
      });

      const detail = await introspectionOf(harness).getRunDetail("dwfrun-result-json");
      expect(detail?.result).toEqual({ report: "final answer", steps: 3 });
    });
  });

  it("completed 但产物是 undefined → result 整字段缺席", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      preloadRun(journal, { cwd: projectCwd, runId: "dwfrun-void", status: "completed" });

      expect("result" in (await introspectionOf(harness).getRunDetail("dwfrun-void"))!).toBe(false);
    });
  });

  it("errored / stopped(interrupted)：failure_json 的 code 原样透出（含 Interrupted）", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      for (const code of ["Interrupted", "DriverError"] as const) {
        preloadRun(journal, {
          cwd: projectCwd,
          failure: { code, message: `failed with ${code}` },
          runId: `dwfrun-failed-${code}`,
          ...(code === "Interrupted"
            ? { status: "stopped" as const, stopReason: "interrupted" as const }
            : { status: "errored" as const }),
        });
      }
      const introspection = introspectionOf(harness);

      expect((await introspection.getRunDetail("dwfrun-failed-Interrupted"))?.error).toEqual({
        code: "Interrupted",
        message: "failed with Interrupted",
      });
      expect((await introspection.getRunDetail("dwfrun-failed-DriverError"))?.error).toEqual({
        code: "DriverError",
        message: "failed with DriverError",
      });
    });
  });

  it("cancelled：带 error（失败编码在场时）", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      preloadRun(journal, {
        cwd: projectCwd,
        failure: { code: "Cancelled", message: "cancelled by user" },
        runId: "dwfrun-cancelled",
        status: "stopped",
        stopReason: "user",
      });

      expect((await introspectionOf(harness).getRunDetail("dwfrun-cancelled"))?.error).toEqual({
        code: "Cancelled",
        message: "cancelled by user",
      });
    });
  });
});

describe("resolveDynamicWorkflowJournalStore", () => {
  it("store 缺少 workflowJournalStore 时返回 undefined 并记原因", () => {
    const messages: string[] = [];
    const resolved = resolveDynamicWorkflowJournalStore(
      {} as never,
      {
        info: (message: string) => {
          messages.push(message);
        },
      } as never,
    );

    expect(resolved).toBeUndefined();
    expect(messages.join(" ")).toContain("dwf journal");
  });

  it("store 提供 workflowJournalStore 时透出该 journal", () => {
    const journal = new InMemoryJournalStore();
    const resolved = resolveDynamicWorkflowJournalStore({
      workflowJournalStore: () => journal,
    } as never);

    expect(resolved).toBe(journal);
  });
});

describe("dynamic workflow run service — resume", () => {
  const TWO_ASK_SCRIPT = [
    "interface Answer { text: string }",
    'const worker = agent("worker");',
    'const first = await worker.ask<Answer>("step one");',
    "const second = await worker.ask(`step two after ${first.text}`);",
    "return `${first.text}+${second}`;",
  ].join("\n");

  const RESUME_TOOL_CALL = createToolCallId("resume-origin");

  
  async function cancelledMidFlight(options: HarnessOptions = {}) {
    options.actorScripts = {
      "actor#1@1": [{ kind: "submit", result: { text: "one" } }, { kind: "hang" }],
    };
    const harness = makeHarness(options);
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: TWO_ASK_SCRIPT,
      toolCallId: RESUME_TOOL_CALL,
      trace: traceFor("resume-phase1"),
    });
    await vi.waitFor(() => {
      expect(harness.journal.getNode(runId, "ask#2", 1)?.status).toBe("running");
    });
    expect(await harness.service.cancel(runId)).toBe(true);
    await settle(harness, runId);
    expect(harness.journal.getRun(runId)?.status).toBe("stopped");
    expect(harness.journal.getNode(runId, "ask#1", 1)?.status).toBe("completed");
    expect(harness.journal.getActor(runId, "actor#1", 1)?.sessionId).toBeDefined();
    return { harness, runId };
  }

  it("恢复被取消的 run：完结节点短路、在飞节点重派发、run 跑到 completed", async () => {
    const options: HarnessOptions = {};
    const { harness, runId } = await cancelledMidFlight(options);
    const linksAfterPhaseOne = harness.taskLinks.length;
    const persistsAfterPhaseOne = harness.persistedTitles.length;

    options.actorScripts = { "actor#1@1": [{ kind: "text", text: "two" }] };
    const result = await harness.service.resume?.(runId);
    expect(result).toMatchObject({ ok: true, runId, toolCallId: RESUME_TOOL_CALL });

    await settle(harness, runId);
    const snapshot = await harness.service.getTask(runId);
    expect(snapshot?.status).toBe("completed");
    expect(snapshot?.output).toBe("one+two");
    expect(harness.journal.getRun(runId)?.status).toBe("completed");

    expect(harness.order.filter((entry) => entry.startsWith("turn:")).length).toBe(3);
    expect(harness.order.filter((entry) => entry.startsWith("construct:")).length).toBe(2);
    expect(harness.resumeCalls).toHaveLength(1);
    expect(harness.taskLinks.length).toBe(linksAfterPhaseOne);
    expect(harness.persistedTitles.length).toBe(persistsAfterPhaseOne);

    const sequences = harness.runEvents.map((event) => event.sequence);
    for (let i = 1; i < sequences.length; i++) {
      expect(sequences[i]!).toBeGreaterThan(sequences[i - 1]!);
    }
    expect(harness.runEvents.filter((event) => event.eventType === "run-started")).toHaveLength(2);
    const cachedSettles = harness.runEvents.filter(
      (event) =>
        event.eventType === "node-settled" &&
        (event.payload as { cached?: boolean }).cached === true,
    );
    expect(cachedSettles.length).toBeGreaterThanOrEqual(1);
  });

  it("恢复后 cancel 依然可用（注册表条目被替换成新的 AbortController）", async () => {
    const options: HarnessOptions = {};
    const { harness, runId } = await cancelledMidFlight(options);

    options.actorScripts = { "actor#1@1": [{ kind: "hang" }] };
    const result = await harness.service.resume?.(runId);
    expect(result).toMatchObject({ ok: true });

    await vi.waitFor(() => {
      expect(harness.order.filter((entry) => entry.startsWith("turn:")).length).toBe(3);
    });
    expect(await harness.service.cancel(runId)).toBe(true);
    await settle(harness, runId);
    expect((await harness.service.getTask(runId))?.status).toBe("cancelled");
    expect(harness.journal.getRun(runId)?.status).toBe("stopped");
  });

  it("resume 返回后 getTask 立即报 running（journal 状态已翻回）", async () => {
    const options: HarnessOptions = {};
    const { harness, runId } = await cancelledMidFlight(options);

    options.actorScripts = { "actor#1@1": [{ kind: "hang" }] };
    await harness.service.resume?.(runId);
    expect((await harness.service.getTask(runId))?.status).toBe("running");

    await harness.service.cancel(runId);
    await settle(harness, runId);
  });

  it("孤儿收敛出的 stopped(interrupted) run 可恢复，且恢复清掉陈旧 failure", async () => {
    const { createHash } = await import("node:crypto");
    const journal = new SweepableJournalStore();
    const runId = "dwfrun-interrupted";
    journal.createRun({
      runId,
      parentSessionId: HARNESS_PARENT_SESSION,
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      scriptHash: createHash("sha256").update(TYPED_SCRIPT, "utf8").digest("hex"),
      toolCallId: "call-interrupted",
      caps: { maxConcurrency: 4 },
      spentTokens: 0,
      status: "stopped",
      stopReason: "interrupted",
      failure: { code: "Interrupted", message: "owning process exited" },
    });

    const harness = makeHarness({
      journal,
      actorScripts: { "actor#1@1": [{ kind: "submit", result: { text: "revived" } }] },
    });
    const result = await harness.service.resume?.(runId);
    expect(result).toMatchObject({ ok: true, runId, toolCallId: "call-interrupted" });

    await settle(harness, runId);
    const record = harness.journal.getRun(runId);
    expect(record?.status).toBe("completed");
    expect(record?.failure).toBeUndefined();
    expect(record?.stopReason).toBeUndefined();
    expect((await harness.service.getTask(runId))?.output).toBe("revived");
    expect(harness.resumeCalls).toHaveLength(0);
    expect(harness.persistedTitles).toHaveLength(1);
  });

  it("回退：resumeFromStore 抛 SessionNotFound 时退回全新持久化路径", async () => {
    const options: HarnessOptions = { resumeSessionMissing: true };
    const { harness, runId } = await cancelledMidFlight(options);
    const persistsAfterPhaseOne = harness.persistedTitles.length;

    options.actorScripts = { "actor#1@1": [{ kind: "text", text: "two" }] };
    const result = await harness.service.resume?.(runId);
    expect(result).toMatchObject({ ok: true });

    await settle(harness, runId);
    expect((await harness.service.getTask(runId))?.status).toBe("completed");
    expect(harness.resumeCalls).toHaveLength(1);
    expect(harness.persistedTitles.length).toBe(persistsAfterPhaseOne + 1);
    expect(
      harness.logs.some(
        (log) =>
          log.level === "warn" &&
          log.context?.event === "dynamic_workflow.actor.rehydrate_fallback",
      ),
    ).toBe(true);
  });
});

describe("dynamic workflow run service — run args", () => {
  const ARGS_SCRIPT = [
    "interface Answer { text: string }",
    'const a = await agent("worker").ask<Answer>(`work on ${String(args.target)}`);',
    "return `${String(args.target)}:${a.text}`;",
  ].join("\n");

  it("落库 submit 收到的实参，并把它注入沙箱", async () => {
    const harness = makeHarness({
      actorScripts: { "actor#1@1": [{ kind: "submit", result: { text: "done" } }] },
    });

    const runId = await submitRun(harness, {
      args: { target: "packages/core" },
      cwd: TEST_CWD,
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: ARGS_SCRIPT,
      trace: traceFor("args-submit"),
    });
    await settle(harness, runId);

    expect(harness.journal.getRun(runId)?.args).toEqual({ target: "packages/core" });
    const snapshot = await harness.service.getTask(runId);
    expect(snapshot?.status).toBe("completed");
    expect(snapshot?.output).toBe("packages/core:done");
  });

  it("内联 run 不落实参列（老行与无参 run 走同一条缺席路径）", async () => {
    const harness = makeHarness({
      actorScripts: { "actor#1@1": [{ kind: "submit", result: { text: "x" } }] },
    });

    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("args-absent"),
    });
    await settle(harness, runId);

    expect(harness.journal.getRun(runId)?.args).toBeUndefined();
  });

  it("resume 重放持久化的实参，且 resume 入口根本收不下新实参", async () => {
    const options: HarnessOptions = {
      actorScripts: { "actor#1@1": [{ kind: "hang" }] },
    };
    const harness = makeHarness(options);
    const runId = await submitRun(harness, {
      args: { target: "original-target" },
      cwd: TEST_CWD,
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: ARGS_SCRIPT,
      trace: traceFor("args-resume"),
    });
    await vi.waitFor(() => {
      expect(harness.journal.getNode(runId, "ask#1", 1)?.status).toBe("running");
    });
    expect(await harness.service.cancel(runId)).toBe(true);
    await settle(harness, runId);

    options.actorScripts = { "actor#1@1": [{ kind: "submit", result: { text: "resumed" } }] };
    expect(await harness.service.resume?.(runId)).toMatchObject({ ok: true, runId });
    await settle(harness, runId);

    expect(harness.journal.getRun(runId)?.args).toEqual({ target: "original-target" });
    const resumed = await harness.service.getTask(runId);
    expect(resumed?.status).toBe("completed");
    expect(resumed?.output).toBe("original-target:resumed");
  });

  it("amend has no args by default; inheritArgs reuses predecessor\'s persisted copy and injects it into sandbox", async () => {
    const options: HarnessOptions = {
      actorScripts: { "actor#1@1": [{ kind: "hang" }] },
    };
    const harness = makeHarness(options);
    const runA = await submitRun(harness, {
      args: { target: "packages/core" },
      cwd: TEST_CWD,
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: ARGS_SCRIPT,
      trace: traceFor("args-amend-a"),
    });
    await vi.waitFor(() => {
      expect(harness.journal.getNode(runA, "ask#1", 1)?.status).toBe("running");
    });

    options.actorScripts = { "actor#1@1": [{ kind: "submit", result: { text: "kept" } }] };
    const inherited = await amendRun(harness, {
      cwd: TEST_CWD,
      inheritArgs: true,
      parentSessionId: HARNESS_PARENT_SESSION,
      predecessorRunId: runA,
      scriptText: ARGS_SCRIPT,
      trace: traceFor("args-amend-b"),
    });
    await settle(harness, inherited.runId);
    expect(harness.journal.getRun(inherited.runId)?.args).toEqual({ target: "packages/core" });
    expect((await harness.service.getTask(inherited.runId))?.output).toBe("packages/core:kept");

    const plain = await amendRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: HARNESS_PARENT_SESSION,
      predecessorRunId: runA,
      scriptText: ARGS_SCRIPT,
      trace: traceFor("args-amend-c"),
    });
    await settle(harness, plain.runId);
    expect(harness.journal.getRun(plain.runId)?.args).toBeUndefined();
  });
});

describe("dynamic workflow run service — resume 门", () => {
  it("未知 runId → not_found", async () => {
    const harness = makeHarness();
    await expect(harness.service.resume?.("dwfrun-nope")).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("completed run → not_resumable", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("gate-completed"),
    });
    await settle(harness, runId);
    await expect(harness.service.resume?.(runId)).resolves.toEqual({
      ok: false,
      reason: "not_resumable",
    });
  });

  it("errored → not_resumable（脚本真失败 replay 只会逐字复现）", async () => {
    const journal = new SweepableJournalStore();
    journal.createRun({
      runId: "dwfrun-script-failed",
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: TYPED_SCRIPT,
      caps: { maxConcurrency: 4 },
      spentTokens: 0,
      status: "errored",
      failure: { code: "DriverError", message: "script threw" },
    });
    const harness = makeHarness({ journal });
    await expect(harness.service.resume?.("dwfrun-script-failed")).resolves.toEqual({
      ok: false,
      reason: "not_resumable",
    });
  });

  it("记录缺 scriptText → script_missing", async () => {
    const journal = new SweepableJournalStore();
    journal.createRun({
      runId: "dwfrun-old",
      parentSessionId: HARNESS_PARENT_SESSION,
      caps: { maxConcurrency: 4 },
      spentTokens: 0,
      status: "stopped",
      stopReason: "user",
    });
    const harness = makeHarness({ journal });
    await expect(harness.service.resume?.("dwfrun-old")).resolves.toEqual({
      ok: false,
      reason: "script_missing",
    });
  });

  it("scriptHash 与原文不自洽 → script_mismatch，journal 状态不被触碰", async () => {
    const journal = new SweepableJournalStore();
    journal.createRun({
      runId: "dwfrun-tampered",
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: TYPED_SCRIPT,
      scriptHash: "bogus-hash",
      caps: { maxConcurrency: 4 },
      spentTokens: 0,
      status: "stopped",
      stopReason: "user",
    });
    const harness = makeHarness({ journal });
    await expect(harness.service.resume?.("dwfrun-tampered")).resolves.toEqual({
      ok: false,
      reason: "script_mismatch",
    });
    expect(harness.journal.getRun("dwfrun-tampered")?.status).toBe("stopped");
  });

  it("原文在当前 facade 下编不过 → compile_failed 携有界诊断，journal 状态不被触碰", async () => {
    const journal = new SweepableJournalStore();
    const legacyScript =
      "const planner = agent('planner');\nawait planner.askWithOldFacade('x');\n";
    journal.createRun({
      runId: "dwfrun-legacy-facade",
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: legacyScript,
      caps: { maxConcurrency: 4 },
      spentTokens: 0,
      status: "stopped",
      stopReason: "interrupted",
    });
    const harness = makeHarness({ journal });
    const result = await harness.service.resume?.("dwfrun-legacy-facade");
    expect(result).toMatchObject({ ok: false, reason: "compile_failed" });
    expect((result as { message?: string }).message).toMatch(/no longer compiles/);
    expect((result as { message?: string }).message).toMatch(/L\d+:C\d+/);
    expect(harness.journal.getRun("dwfrun-legacy-facade")?.status).toBe("stopped");
  });

  it("同 runId 在飞 → already_running", async () => {
    const harness = makeHarness({
      actorScripts: { "actor#1@1": [{ kind: "hang" }] },
    });
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("gate-inflight"),
    });
    await vi.waitFor(() => {
      expect(harness.actorRuntimeInputs.length).toBeGreaterThan(0);
    });
    await expect(harness.service.resume?.(runId)).resolves.toEqual({
      ok: false,
      reason: "already_running",
    });
    await harness.service.cancel(runId);
    await settle(harness, runId);
  });
});

describe("dynamic workflow run service — replayProgressForSession（冷回放）", () => {
  const REPLAY_SCRIPT = [
    "interface Answer { text: string }",
    'const a = await agent("worker").ask<Answer>("do the thing");',
    'await artifact.markdown("summary", a.text);',
    "return a.text;",
  ].join("\n");

  
  function artifactStore(): ToolArtifactStorePort {
    let next = 0;
    return {
      writeToolResultArtifact: async (request) => {
        next += 1;
        return {
          id: `artifact-${next}`,
          uri: `cf-artifact://replay/artifact-${next}`,
          bytes: Buffer.byteLength(request.content, "utf8"),
          contentType: request.contentType ?? "text/plain",
          createdAt: new Date(0),
        };
      },
      readToolResultArtifact: async () => {
        throw new Error("not read in replay tests");
      },
      readToolResultBinaryArtifact: async () => {
        throw new Error("not read in replay tests");
      },
    };
  }

  function reduceAll(payloads: readonly DynamicWorkflowRunProgressPayload[]) {
    let state: WorkflowRunsState | undefined;
    for (const payload of payloads) {
      state = reduceWorkflowRunsState(state, payload as WorkflowRunProgressEnvelope) ?? state;
    }
    return state;
  }

  it("跑完一个 run 后，新实例的回放载荷与 live 载荷逐字节相等，归约态深等且过 strict schema", async () => {
    await withSqliteJournal(async (journal) => {
      const live = makeHarness({ artifactStore: artifactStore(), journal });
      const toolCallId = createToolCallId("call-replay");
      const runId = await submitRun(live, {
        cwd: projectCwd,
        name: "replay me",
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: REPLAY_SCRIPT,
        toolCallId,
        trace: traceFor("replay-live"),
      });
      await settle(live, runId);
      expect(journal.getRun(runId)?.status).toBe("completed");
      const kinds = new Set(live.runEvents.map((event) => event.eventType));
      for (const kind of [
        "run-started",
        "actor-created",
        "node-settled",
        "usage-updated",
        "artifact-published",
        "run-settled",
      ]) {
        expect(kinds.has(kind)).toBe(true);
      }

      const cold = makeHarness({ artifactStore: artifactStore(), journal });
      const replayed = await cold.service.replayProgressForSession!({ excludeRunIds: new Set() });

      expect(replayed).toEqual(live.runEvents);
      const startedCeiling = (event: DynamicWorkflowRunProgressPayload | undefined) =>
        (event?.payload as { concurrencyCeiling?: number } | undefined)?.concurrencyCeiling;
      const liveStarted = live.runEvents.find((event) => event.eventType === "run-started");
      const coldStarted = replayed.find((event) => event.eventType === "run-started");
      expect(startedCeiling(liveStarted)).toBe(resolveWorkflowDefaultConcurrency());
      expect(startedCeiling(coldStarted)).toBe(startedCeiling(liveStarted));
      const liveState = reduceAll(live.runEvents);
      const coldState = reduceAll(replayed);
      expect(coldState).toEqual(liveState);
      expect(coldState?.runs[0]).toMatchObject({
        runId,
        status: "completed",
        toolCallId: String(toolCallId),
      });
      expect(coldState?.runs[0]?.actors.length).toBeGreaterThan(0);
      expect(coldState?.runs[0]?.nodes.length).toBeGreaterThan(0);
      expect(coldState?.runs[0]?.usage.spentTokens).toBeGreaterThan(0);
      expect(workflowRunsStateSchema.parse(coldState)).toEqual(coldState);
    });
  });

  it("被打断的 run（行 stopped/interrupted、事件流没有 run-settled）：追加内存态合成 settle，携 resumable；journal 不动", async () => {
    const journal = new SweepableJournalStore();
    preloadRun(journal, {
      runId: "dwfrun-interrupted",
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: TYPED_SCRIPT,
      status: "running",
    });
    journal.appendEvent("dwfrun-interrupted", {
      type: "run-started",
      caps: { maxConcurrency: 4 },
    } as never);
    journal.appendEvent("dwfrun-interrupted", {
      type: "actor-created",
      actor: { siteId: "actor#1", ordinal: 1 },
      name: "worker",
    } as never);
    journal.appendEvent("dwfrun-interrupted", {
      type: "node-queued",
      instance: { siteId: "ask#1", ordinal: 1 },
      kind: "ask",
      actor: { siteId: "actor#1", ordinal: 1 },
    } as never);
    journal.appendEvent("dwfrun-interrupted", {
      type: "escalation-raised",
      qid: "dwfq-1",
      actor: { siteId: "actor#1", ordinal: 1 },
      question: "which branch?",
      askedAt: 1,
    } as never);
    const before = journal.listEvents("dwfrun-interrupted", {
      types: "all",
      reportItems: "all",
    }).length;

    const harness = makeHarness({ journal });
    expect(journal.getRun("dwfrun-interrupted")).toMatchObject({
      status: "stopped",
      stopReason: "interrupted",
      failure: { code: "Interrupted" },
    });
    const replayed = await harness.service.replayProgressForSession!({ excludeRunIds: new Set() });

    expect(
      journal.listEvents("dwfrun-interrupted", { types: "all", reportItems: "all" }),
    ).toHaveLength(before);
    const last = replayed.at(-1);
    expect(last).toMatchObject({
      runId: "dwfrun-interrupted",
      sequence: before,
      eventType: "run-settled",
      payload: {
        status: "stopped",
        stopReason: "interrupted",
        error: { code: "Interrupted" },
        resumable: true,
      },
    });
    expect(replayed.filter((event) => event.eventType === "run-settled")).toHaveLength(1);
    const state = reduceAll(replayed);
    expect(state?.runs[0]).toMatchObject({ status: "stopped", resumable: true });
    expect(state?.runs[0]?.error).toContain("exited");
    expect(state?.runs[0]?.pendingQuestions).toBeUndefined();
    expect(state?.runs[0]?.actors[0]?.status).toBe("completed");
  });

  it("cancelled 行同样携 resumable；行终态且事件流已含 run-settled 时不再合成第二条", async () => {
    const journal = new SweepableJournalStore();
    preloadRun(journal, {
      runId: "dwfrun-cancelled",
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: TYPED_SCRIPT,
      status: "stopped",
      stopReason: "user",
    });
    journal.appendEvent("dwfrun-cancelled", {
      type: "run-started",
      caps: { maxConcurrency: 4 },
    } as never);
    journal.appendEvent("dwfrun-cancelled", {
      type: "run-settled",
      status: "stopped",
      stopReason: "user",
    } as never);
    preloadRun(journal, {
      runId: "dwfrun-crashed",
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: TYPED_SCRIPT,
      status: "errored",
      failure: { code: "DriverError", message: "script threw" },
    });
    journal.appendEvent("dwfrun-crashed", {
      type: "run-started",
      caps: { maxConcurrency: 4 },
    } as never);

    const harness = makeHarness({ journal });
    const replayed = await harness.service.replayProgressForSession!({ excludeRunIds: new Set() });
    const byRun = new Map<string, DynamicWorkflowRunProgressPayload[]>();
    for (const event of replayed) {
      byRun.set(event.runId, [...(byRun.get(event.runId) ?? []), event]);
    }
    const cancelled = byRun.get("dwfrun-cancelled") ?? [];
    expect(cancelled.filter((event) => event.eventType === "run-settled")).toHaveLength(1);
    expect(cancelled.at(-1)?.payload).toMatchObject({
      status: "stopped",
      stopReason: "user",
      resumable: true,
    });
    const crashed = byRun.get("dwfrun-crashed") ?? [];
    expect(crashed.at(-1)?.payload).toEqual({
      status: "errored",
      error: { code: "DriverError", message: "script threw" },
    });
  });

  it("排除集：内存里已有的 runId 与注册表在飞的 run 不回放；兄弟会话的 run 不进；上界 8 且最旧优先", async () => {
    const journal = new SweepableJournalStore();
    for (let index = 1; index <= 10; index += 1) {
      preloadRun(journal, {
        runId: `dwfrun-old-${index}`,
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: TYPED_SCRIPT,
        status: "completed",
      });
      journal.appendEvent(`dwfrun-old-${index}`, {
        type: "run-started",
        caps: { maxConcurrency: 4 },
      } as never);
      journal.appendEvent(`dwfrun-old-${index}`, {
        type: "run-settled",
        status: "completed",
      } as never);
    }
    preloadRun(journal, {
      runId: "dwfrun-sibling",
      parentSessionId: "ses_other",
      scriptText: TYPED_SCRIPT,
      status: "completed",
    });
    journal.appendEvent("dwfrun-sibling", {
      type: "run-started",
      caps: { maxConcurrency: 4 },
    } as never);

    const harness = makeHarness({ hangActors: true, journal });
    const inFlight = await submitRun(harness, {
      cwd: projectCwd,
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("replay-in-flight"),
    });
    await vi.waitFor(() => {
      expect(harness.actorRuntimeInputs.length).toBeGreaterThan(0);
    });

    const replayed = await harness.service.replayProgressForSession!({
      excludeRunIds: new Set(["dwfrun-old-10"]),
    });
    const order: string[] = [];
    for (const event of replayed) {
      if (order.at(-1) !== event.runId) order.push(event.runId);
    }
    expect(order).not.toContain(inFlight);
    expect(order).not.toContain("dwfrun-old-10");
    expect(order).not.toContain("dwfrun-sibling");
    expect(order).toEqual([
      "dwfrun-old-4",
      "dwfrun-old-5",
      "dwfrun-old-6",
      "dwfrun-old-7",
      "dwfrun-old-8",
      "dwfrun-old-9",
    ]);

    expect(await harness.service.cancel(inFlight)).toBe(true);
    await settle(harness, inFlight);
  });

  it("内存 journal（无枚举面）：回放回空", async () => {
    const harness = makeHarness({ journal: new InMemoryJournalStore() });
    await expect(
      harness.service.replayProgressForSession!({ excludeRunIds: new Set() }),
    ).resolves.toEqual([]);
  });
});

describe("dynamic workflow run service — listRunsForSession", () => {
  it("回本会话的 run 摘要，resumable 与 resume 门同源", async () => {
    const journal = new SweepableJournalStore();
    const seed = (input: {
      runId: string;
      status: RunStatus;
      failure?: { code: string; message: string };
      stopReason?: RunStopReason;
      toolCallId?: string;
      parentSessionId?: string;
    }): void => {
      journal.createRun({
        runId: input.runId,
        parentSessionId: input.parentSessionId ?? HARNESS_PARENT_SESSION,
        scriptText: TYPED_SCRIPT,
        caps: { maxConcurrency: 4 },
        spentTokens: 0,
        status: input.status,
        ...(input.stopReason === undefined ? {} : { stopReason: input.stopReason }),
        ...(input.failure === undefined ? {} : { failure: input.failure as never }),
        ...(input.toolCallId === undefined ? {} : { toolCallId: input.toolCallId }),
      });
    };
    seed({ runId: "dwfrun-done", status: "completed", toolCallId: "call-done" });
    seed({
      runId: "dwfrun-stopped",
      status: "stopped",
      stopReason: "user",
      toolCallId: "call-stopped",
    });
    seed({
      runId: "dwfrun-interrupted",
      status: "stopped",
      stopReason: "interrupted",
      failure: { code: "Interrupted", message: "owning process exited" },
    });
    seed({
      runId: "dwfrun-crashed",
      status: "errored",
      failure: { code: "DriverError", message: "script threw" },
    });
    seed({
      runId: "dwfrun-other",
      status: "stopped",
      stopReason: "user",
      parentSessionId: "ses_other",
    });

    const harness = makeHarness({ journal });
    const summaries = await harness.service.listRunsForSession?.();

    expect(summaries?.map((summary) => summary.runId).sort()).toEqual([
      "dwfrun-crashed",
      "dwfrun-done",
      "dwfrun-interrupted",
      "dwfrun-stopped",
    ]);
    const byId = new Map(summaries?.map((summary) => [summary.runId, summary]));
    expect(byId.get("dwfrun-stopped")).toMatchObject({
      resumable: true,
      status: "stopped",
      stopReason: "user",
      toolCallId: "call-stopped",
    });
    expect(byId.get("dwfrun-interrupted")).toMatchObject({
      failureCode: "Interrupted",
      resumable: true,
      status: "stopped",
      stopReason: "interrupted",
    });
    expect(byId.get("dwfrun-done")).toMatchObject({ resumable: false, status: "completed" });
    expect(byId.get("dwfrun-crashed")).toMatchObject({
      failureCode: "DriverError",
      resumable: false,
    });
  });

  it("journal 无枚举能力（内存实现）时回空列表而不是抛错", async () => {
    const harness = makeHarness({ journal: new InMemoryJournalStore() });
    await expect(harness.service.listRunsForSession?.()).resolves.toEqual([]);
  });

  it("label 走 name → 脚本首行 → runId 的同一条派生链", async () => {
    const journal = new SweepableJournalStore();
    const seed = (input: { runId: string; name?: string; scriptText?: string }): void => {
      journal.createRun({
        runId: input.runId,
        parentSessionId: HARNESS_PARENT_SESSION,
        ...(input.scriptText === undefined ? {} : { scriptText: input.scriptText }),
        ...(input.name === undefined ? {} : { name: input.name }),
        caps: { maxConcurrency: 4 },
        spentTokens: 0,
        status: "completed",
      });
    };
    seed({ runId: "dwfrun-named", name: "nightly audit", scriptText: TYPED_SCRIPT });
    seed({ runId: "dwfrun-unnamed", scriptText: TYPED_SCRIPT });
    seed({ runId: "dwfrun-blank", name: "   ", scriptText: TYPED_SCRIPT });
    seed({ runId: "dwfrun-bare" });

    const harness = makeHarness({ journal });
    const byId = new Map(
      (await harness.service.listRunsForSession?.())?.map((summary) => [summary.runId, summary]),
    );

    expect(byId.get("dwfrun-named")?.label).toBe("nightly audit");
    expect(byId.get("dwfrun-unnamed")?.label).toBe("interface Answer { text: string }");
    expect(byId.get("dwfrun-blank")?.label).toBe("interface Answer { text: string }");
    expect(byId.get("dwfrun-bare")?.label).toBe("dwfrun-bare");
  });

  it("updatedAt 透传 journal 行的 time_updated", async () => {
    const journal = new SweepableJournalStore();
    preloadRun(journal, {
      runId: "dwfrun-timed",
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: TYPED_SCRIPT,
      status: "completed",
    });

    const harness = makeHarness({ journal });
    const [summary] = (await harness.service.listRunsForSession?.()) ?? [];

    expect(summary?.updatedAt).toBe(journal.rowTimeOf("dwfrun-timed"));
  });

  it("窄投影仍带 failure，stopped(interrupted) 判可恢复", async () => {
    const journal = new SweepableJournalStore();
    preloadRun(journal, {
      runId: "dwfrun-interrupted",
      failure: { code: "Interrupted", message: "owning process exited" },
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: TYPED_SCRIPT,
      status: "stopped",
      stopReason: "interrupted",
    });

    const harness = makeHarness({ journal });
    const [summary] = (await harness.service.listRunsForSession?.()) ?? [];

    expect(summary).toMatchObject({
      failureCode: "Interrupted",
      failureMessage: "owning process exited",
      resumable: true,
      status: "stopped",
      stopReason: "interrupted",
    });
  });
});

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

function amendScript(tail: string): string {
  return [
    "interface Answer { text: string }",
    'const w = agent("worker");',
    'const paths = await files.glob("src/**/*.ts");',
    'const first = await w.ask<Answer>("first question");',
    `const last = await w.ask<Answer>(${JSON.stringify(tail)});`,
    "return `${first.text}|${last.text}|${paths.length}`;",
  ].join("\n");
}

const TWO_ACTOR_SCRIPT = [
  "interface Answer { text: string }",
  'const alpha = agent("alpha");',
  'const beta = agent("beta");',
  'const a = await alpha.ask<Answer>("alpha question");',
  'const b = await beta.ask<Answer>("beta question");',
  "return `${a.text}|${b.text}`;",
].join("\n");

function settledEvents(
  harness: Harness,
  runId: string,
): { siteId: string; ordinal: number; cached: boolean }[] {
  return harness.runEvents
    .filter((event) => event.runId === runId && event.eventType === "node-settled")
    .map((event) => {
      const instance = event.payload.instance as { siteId: string; ordinal: number };
      return { ...instance, cached: event.payload.cached === true };
    });
}

function turnCount(harness: Harness): number {
  return harness.order.filter((entry) => entry.startsWith("turn:")).length;
}

function withHiddenRun(journal: JournalStorePort, hiddenRunId: string): JournalStorePort {
  return new Proxy(journal, {
    get(target, prop) {
      if (prop === "getRun") {
        return (runId: string) => (runId === hiddenRunId ? undefined : journal.getRun(runId));
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as () => unknown).bind(target) : value;
    },
  }) as JournalStorePort;
}

describe("dynamic workflow run service — getScript（修订沿用前驱的脚本）", () => {
  it("回 journal 行上逐字节的 script_text（不 trim、不改换行）", async () => {
    const journal = new SweepableJournalStore();
    const harness = makeHarness({ journal });
    const script = `${TYPED_SCRIPT}\r\n// 尾注：逐Character节\n\n`;
    preloadRun(journal, { runId: "dwfrun-stored", scriptText: script, status: "errored" });

    expect(await harness.service.getScript!("dwfrun-stored")).toBe(script);
  });

  it("行上没有脚本（落库之前的老 run）与未知 run 都回 undefined", async () => {
    const journal = new SweepableJournalStore();
    const harness = makeHarness({ journal });
    preloadRun(journal, { runId: "dwfrun-scriptless", status: "completed" });

    expect(await harness.service.getScript!("dwfrun-scriptless")).toBeUndefined();
    expect(await harness.service.getScript!("dwfrun-nope")).toBeUndefined();
  });

  it("submit → createRun 的间隙里读注册表条目上的脚本", async () => {
    await withSqliteJournal(async (real) => {
      const hidden = new Set<string>();
      const harness = makeHarness({ hangActors: true, journal: hideRunsFromReads(real, hidden) });
      const runId = await submitRun(harness, {
        cwd: TEST_CWD,
        scriptText: TYPED_SCRIPT,
        trace: traceFor("get-script-gap"),
      });
      hidden.add(runId);

      expect(await harness.service.getScript!(runId)).toBe(TYPED_SCRIPT);

      await harness.service.cancel(runId);
      await settle(harness, runId);
    });
  });

  it("关闭之后仍可读：它是只读面，不是启动入口", async () => {
    const journal = new SweepableJournalStore();
    const harness = makeHarness({ journal });
    preloadRun(journal, { runId: "dwfrun-closed", scriptText: TYPED_SCRIPT, status: "completed" });
    await harness.service.close();

    expect(await harness.service.getScript!("dwfrun-closed")).toBe(TYPED_SCRIPT);
  });
});

describe("dynamic workflow run service — amend 的门", () => {
  it("前驱不存在 → run_not_found，且不建任何 run", async () => {
    const journal = new SweepableJournalStore();
    const createRun = vi.spyOn(journal, "createRun");
    const harness = makeHarness({ journal });

    const result = await harness.service.amend!({
      cwd: TEST_CWD,
      predecessorRunId: "dwfrun-nope",
      scriptText: TYPED_SCRIPT,
      trace: traceFor("amend-missing"),
    });

    expect(result).toEqual({ ok: false, reason: "run_not_found" });
    expect(createRun).not.toHaveBeenCalled();
    expect(harness.actorRuntimeInputs).toEqual([]);
  });

  it("前驱仍在飞 → 停下成 stopped(superseded, supersededBy)、等结算、再启动后继", async () => {
    const harness = makeHarness({ hangActors: true });
    const runA = await submitRun(harness, {
      cwd: TEST_CWD,
      name: "triage",
      scriptText: TYPED_SCRIPT,
      trace: traceFor("amend-live-a"),
    });
    await vi.waitFor(() => {
      expect(harness.actorRuntimeInputs.length).toBeGreaterThan(0);
    });

    const amended = await amendRun(harness, {
      cwd: TEST_CWD,
      predecessorRunId: runA,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("amend-live-b"),
    });
    const runB = amended.runId;
    expect(runB).not.toBe(runA);
    expect(amended.supersededRunId).toBe(runA);

    const a = harness.journal.getRun(runA);
    expect(a).toMatchObject({ status: "stopped", stopReason: "superseded", supersededBy: runB });
    expect(a?.failure).toBeUndefined();
    const snapshotA = await harness.service.getTask(runA);
    expect(snapshotA).toMatchObject({
      runStatus: "stopped",
      stopReason: "superseded",
      supersededBy: runB,
    });
    expect(await harness.service.resume(runA)).toEqual({ ok: false, reason: "superseded" });
    expect((await harness.service.getTask(runB))?.resumedFrom).toBe(runA);
    await vi.waitFor(() => {
      expect(harness.journal.getRun(runB)).toMatchObject({ resumedFrom: runA, name: "triage" });
    });

    const settledA = harness.runEvents.find(
      (event) => event.runId === runA && event.eventType === "run-settled",
    );
    expect(settledA?.payload).toMatchObject({ stopReason: "superseded", supersededBy: runB });
    expect(settledA?.payload).not.toHaveProperty("resumable");
    const startedB = harness.runEvents.find(
      (event) => event.runId === runB && event.eventType === "run-started",
    );
    expect(startedB?.payload).toMatchObject({ resumedFrom: runA });

    expect(await harness.service.cancel(runB)).toBe(true);
    await settle(harness, runB);
  });

  it("预检失败时在飞前驱不被停下", async () => {
    const harness = makeHarness({ hangActors: true });
    const runA = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("amend-preflight-a"),
    });
    await vi.waitFor(() => {
      expect(harness.actorRuntimeInputs.length).toBeGreaterThan(0);
    });
    harness.journal.putNode({
      runId: runA,
      siteId: "ask#99",
      ordinal: 99,
      kind: "ask",
      actorSiteId: "actor#1",
      actorOrdinal: 1,
      actorSeq: 7,
      inputHash: "h99",
      status: "completed",
      result: { text: "done" },
    });

    const result = await harness.service.amend!({
      cwd: TEST_CWD,
      predecessorRunId: runA,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("amend-preflight-b"),
    });
    expect(result).toEqual({ ok: false, reason: "missing_boundaries" });
    expect(harness.journal.getRun(runA)?.status).toBe("running");
    expect(harness.service.countLiveRuns()).toBe(1);

    expect(await harness.service.cancel(runA)).toBe(true);
    await settle(harness, runA);
  });

  it("Predecessor\'s settled ask is missing boundary marker → missing_boundaries", async () => {
    const journal = new SweepableJournalStore();
    const harness = makeHarness({ journal });
    preloadRun(journal, { runId: "dwfrun-old", scriptText: TYPED_SCRIPT, status: "completed" });
    journal.putActor({
      runId: "dwfrun-old",
      siteId: "actor#1",
      ordinal: 1,
      name: "worker",
      persona: { name: "worker" },
      sessionId: "sess-old",
    });
    journal.putNode({
      runId: "dwfrun-old",
      siteId: "ask#1",
      ordinal: 1,
      kind: "ask",
      actorSiteId: "actor#1",
      actorOrdinal: 1,
      actorSeq: 0,
      inputHash: "h0",
      status: "completed",
      result: { text: "done" },
    });

    const result = await harness.service.amend!({
      cwd: TEST_CWD,
      predecessorRunId: "dwfrun-old",
      scriptText: TYPED_SCRIPT,
      trace: traceFor("amend-no-marker"),
    });

    expect(result).toEqual({ ok: false, reason: "missing_boundaries" });
  });

  it.each(["completed", "errored", "stopped"] as const)("终态 %s 的前驱通过门", async (status) => {
    const journal = new SweepableJournalStore();
    const harness = makeHarness({ journal });
    preloadRun(journal, { runId: `dwfrun-${status}`, scriptText: TYPED_SCRIPT, status });

    const result = await harness.service.amend!({
      cwd: TEST_CWD,
      predecessorRunId: `dwfrun-${status}`,
      scriptText: TYPED_SCRIPT,
      trace: traceFor(`amend-${status}`),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.supersededRunId).toBeUndefined();
    await settle(harness, result.runId);
    expect(harness.journal.getRun(result.runId)?.resumedFrom).toBe(`dwfrun-${status}`);
  });
});

describe("dynamic workflow run service — amend-resume 的温启动", () => {
  it("AmendWorkflow 省略 script：工具经 getScript 沿用前驱脚本，全部命中缓存、只换上界", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "cf-dwf-amend-keep-"));
    const store = await createSqliteSessionStore({ dbPath: join(tempRoot, "session.sqlite") });
    const journal = new SweepableJournalStore();
    try {
      const script = amendScript("second question");
      const before = makeHarness({
        actorScripts: {
          "actor#1@1": [
            { kind: "submit", result: { text: "one" } },
            { kind: "submit", result: { text: "two" } },
          ],
        },
        journal,
        sessionStore: store as never,
      });
      const runA = await submitRun(before, {
        cwd: TEST_CWD,
        scriptText: script,
        trace: traceFor("amend-keep-predecessor"),
      });
      await settle(before, runA);
      expect(journal.getRun(runA)?.caps.maxConcurrency).not.toBe(1);

      const after = makeHarness({ journal, sessionStore: store as never });
      const registry = createToolRegistry();
      const amendEntry = builtInTools.find((entry) => entry.metadata.name === "AmendWorkflow");
      expect(amendEntry).toBeDefined();
      registry.register(amendEntry!);
      const sessionId = createSessionId("amend-keep-tool");
      const turnId = createTurnId("amend-keep-tool");
      const traceContext = createRootTraceContext({ sessionId, turnId });
      const permissionAsks: string[] = [];
      const executor = createToolExecutor({
        emitEvent: async () => {},
        dynamicWorkflowRunPort: after.service,
        mode: "build",
        permissionBroker: {
          async requestPermission(request) {
            permissionAsks.push(JSON.stringify(request));
            return { decision: "allow" as const };
          },
        },
        permissionService: new PermissionService(defaultPermissionConfig),
        registry,
        sessionId,
        turnId,
        traceContext,
        workingDirectory: TEST_CWD,
      });

      const result = await executor.execute(
        {
          id: createToolCallId("amend-keep-tool"),
          input: { run_id: runA, max_concurrency: 1 },
          name: "AmendWorkflow",
        },
        { traceContext },
      );

      expect(result.success).toBe(true);
      expect(permissionAsks).toHaveLength(1);
      expect(permissionAsks[0]).toContain('"script_inherited":true');
      const output = result.output as { backgroundTaskId?: string; response: string };
      const runB = output.backgroundTaskId;
      expect(runB).toBeDefined();
      expect(output.response).toContain(`The script of run ${runA} started unchanged`);
      await settle(after, runB!);

      const rowB = journal.getRun(runB!);
      expect(rowB?.scriptText).toBe(script);
      expect(rowB?.caps.maxConcurrency).toBe(1);
      expect(rowB?.resumedFrom).toBe(runA);
      const recordedScriptPath = (await after.service.getTask(runB!))?.scriptPath;
      expect(recordedScriptPath).toBeDefined();
      expect(readFileSync(recordedScriptPath!, "utf8")).toBe(script);
      expect((await after.service.getTask(runB!))?.output).toBe("one|two|0");
      expect(turnCount(after)).toBe(0);
      expect(settledEvents(after, runB!)).toEqual([
        { siteId: "world-read#1", ordinal: 1, cached: true },
        { siteId: "ask#1", ordinal: 1, cached: true },
        { siteId: "ask#2", ordinal: 1, cached: true },
      ]);
    } finally {
      store.close();
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("Cache hits of amended run are attributed to subagents, transcript points to the predecessor session with actual messages; switches back to current run\'s after divergence", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "cf-dwf-amend-attrib-"));
    const store = await createSqliteSessionStore({ dbPath: join(tempRoot, "session.sqlite") });
    const journal = new SweepableJournalStore();
    try {
      const before = makeHarness({
        actorScripts: {
          "actor#1@1": [
            { kind: "submit", result: { text: "one" } },
            { kind: "submit", result: { text: "two" } },
          ],
        },
        journal,
        sessionStore: store as never,
      });
      const runA = await submitRun(before, {
        cwd: TEST_CWD,
        scriptText: amendScript("second question"),
        trace: traceFor("amend-attrib-predecessor"),
      });
      await settle(before, runA);
      const predecessorSession = before.runEvents.find(
        (event) => event.runId === runA && event.eventType === "actor-created",
      )?.actorSessionId;
      expect(predecessorSession).toBeDefined();
      expect((await store.messages({ sessionID: predecessorSession! })).length).toBeGreaterThan(0);

      const same = makeHarness({ journal, sessionStore: store as never });
      const unchanged = await amendRun(same, {
        cwd: TEST_CWD,
        predecessorRunId: runA,
        scriptText: amendScript("second question"),
        trace: traceFor("amend-attrib-same"),
      });
      await settle(same, unchanged.runId);
      expect(turnCount(same)).toBe(0);
      const ownSession = same.runEvents.find(
        (event) => event.runId === unchanged.runId && event.eventType === "actor-created",
      )?.actorSessionId;
      expect(ownSession).toBeDefined();
      expect(ownSession).not.toBe(predecessorSession);

      const cachedRun = reduceAll(same)?.runs.find((run) => run.runId === unchanged.runId);
      expect(
        cachedRun?.nodes.map((node) => [
          node.siteId,
          node.cached === true,
          node.actorSiteId === undefined ? null : `${node.actorSiteId}@${node.actorOrdinal}`,
        ]),
      ).toEqual([
        ["world-read#1", true, null],
        ["ask#1", true, "actor#1@1"],
        ["ask#2", true, "actor#1@1"],
      ]);
      expect(cachedRun?.nodes.find((node) => node.siteId === "ask#2")?.instructionsHead).toBe(
        "second question",
      );
      expect(cachedRun?.actors).toMatchObject([
        { siteId: "actor#1", ordinal: 1, status: "completed", sessionId: predecessorSession },
      ]);

      const diverged = makeHarness({
        actorScripts: { "actor#1@1": [{ kind: "submit", result: { text: "revised" } }] },
        journal,
        sessionStore: store as never,
      });
      const revised = await amendRun(diverged, {
        cwd: TEST_CWD,
        predecessorRunId: runA,
        scriptText: amendScript("second question, revised"),
        trace: traceFor("amend-attrib-revised"),
      });
      await settle(diverged, revised.runId);
      const revisedSession = diverged.runEvents.find(
        (event) => event.runId === revised.runId && event.eventType === "actor-created",
      )?.actorSessionId;
      const firstSettle = diverged.runEvents.find(
        (event) =>
          event.runId === revised.runId &&
          event.eventType === "node-settled" &&
          (event.payload.instance as { siteId: string }).siteId === "ask#1",
      );
      expect(firstSettle?.payload).toMatchObject({
        cached: true,
        kind: "ask",
        actor: { siteId: "actor#1", ordinal: 1 },
        sourceSessionId: predecessorSession,
      });
      const revisedRun = reduceAll(diverged)?.runs.find((run) => run.runId === revised.runId);
      expect(revisedRun?.actors).toMatchObject([
        { siteId: "actor#1", status: "completed", sessionId: revisedSession },
      ]);
      expect((await store.messages({ sessionID: revisedSession! })).length).toBeGreaterThan(0);
    } finally {
      store.close();
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("前缀零派发命中、分歧点起 live、边界与 lineage 落库", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "cf-dwf-amend-"));
    const store = await createSqliteSessionStore({ dbPath: join(tempRoot, "session.sqlite") });
    const journal = new SweepableJournalStore();
    try {
      const before = makeHarness({
        actorScripts: {
          "actor#1@1": [
            { kind: "submit", result: { text: "one" } },
            { kind: "submit", result: { text: "two" } },
          ],
        },
        journal,
        sessionStore: store as never,
      });
      const runA = await submitRun(before, {
        cwd: TEST_CWD,
        scriptText: amendScript("second question"),
        trace: traceFor("amend-predecessor"),
      });
      await settle(before, runA);
      expect((await before.service.getTask(runA))?.output).toBe("one|two|0");
      expect(turnCount(before)).toBe(2);

      const after = makeHarness({
        actorScripts: { "actor#1@1": [{ kind: "submit", result: { text: "revised" } }] },
        journal,
        sessionStore: store as never,
      });
      const submitted = await after.service.amend!({
        cwd: TEST_CWD,
        predecessorRunId: runA,
        scriptText: amendScript("second question, revised"),
        trace: traceFor("amend-run"),
      });
      expect(submitted.ok).toBe(true);
      if (!submitted.ok) return;
      const runB = submitted.runId;
      await settle(after, runB);

      expect((await after.service.getTask(runB))?.output).toBe("one|revised|0");
      expect(turnCount(after)).toBe(1);

      const settledB = settledEvents(after, runB);
      expect(settledB).toEqual([
        { siteId: "world-read#1", ordinal: 1, cached: true },
        { siteId: "ask#1", ordinal: 1, cached: true },
        { siteId: "ask#2", ordinal: 1, cached: false },
      ]);

      const cachedNode = journal.getNode(runB, "ask#1", 1);
      const sourceNode = journal.getNode(runA, "ask#1", 1);
      expect(cachedNode?.status).toBe("completed");
      expect(cachedNode?.result).toEqual({ text: "one" });
      expect(cachedNode?.messageBoundary).toBe(sourceNode?.messageBoundary);
      expect(cachedNode?.actorSeq).toBe(0);

      expect(journal.getRun(runB)?.resumedFrom).toBe(runA);
      expect(journal.getRun(runA)?.status).toBe("completed");
      expect(journal.getRun(runA)?.resumedFrom).toBeUndefined();

      const sourceSession = journal.getActor(runA, "actor#1", 1)?.sessionId;
      const amendedSession = after.actorRuntimeInputs[0]!.sessionId;
      expect(amendedSession).not.toBe(sourceSession);
      const seeded = await store.messages({ sessionID: amendedSession });
      expect(seeded.length).toBeGreaterThan(sourceNode!.messageBoundary!);
      expect(journal.getNode(runB, "ask#2", 1)?.messageBoundary).toBe(seeded.length);
      expect(after.resumeCalls).toContain(amendedSession);

      expect(after.actorRuntimeInputs[0]!.pinnedModel).toBe(
        journal.getActor(runA, "actor#1", 1)?.resolvedModel,
      );
    } finally {
      store.close();
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  // ————————————————————————————————————————————————————————————————
  // 「What is imported」「How the engine consumes the cache」）
  // ————————————————————————————————————————————————————————————————

  
  async function transcriptOf(
    store: { messages(input: { sessionID: SessionId }): Promise<MessageWithParts[]> },
    sessionId: SessionId,
  ): Promise<string[]> {
    const messages = await store.messages({ sessionID: sessionId });
    return messages.map((message) => {
      const text = message.parts
        .map((part) => (part.type === "text" ? part.text : `<${part.type}>`))
        .join("");
      return `${message.info.role}:${text}`;
    });
  }

  
  
  async function liveMidAskPredecessor(input: {
    journal: SweepableJournalStore;
    label: string;
    quiesceMs?: number;
    script: string;
    
    stall: "hang-until-cancelled" | "hang";
    store: Awaited<ReturnType<typeof createSqliteSessionStore>>;
  }): Promise<{ harness: Harness; plan: ActorPlan[]; prefixBoundary: number; runA: string }> {
    const { journal, label, script, stall, store } = input;
    const plan: ActorPlan[] = [{ kind: "submit", result: { text: "one" } }, { kind: stall }];
    const harness = makeHarness({
      actorScripts: { "actor#1@1": plan },
      journal,
      ...(input.quiesceMs === undefined ? {} : { quiesceMs: input.quiesceMs }),
      sessionStore: store as never,
    });
    const runA = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: script,
      trace: traceFor(`${label}-a`),
    });
    await vi.waitFor(() => {
      expect(turnCount(harness)).toBe(2);
      expect(journal.getNode(runA, "ask#1", 1)?.messageBoundary).toBeDefined();
    });
    expect(journal.getNode(runA, "ask#2", 1)).toMatchObject({ status: "running", actorSeq: 1 });
    expect(journal.getNode(runA, "ask#2", 1)?.messageBoundary).toBeUndefined();
    plan.length = 0;
    plan.push({ kind: "submit", result: { text: "revised" } });
    return {
      harness,
      plan,
      prefixBoundary: journal.getNode(runA, "ask#1", 1)!.messageBoundary!,
      runA,
    };
  }

  it("Predecessor\'s in-flight ask continued by same instruction: new session opens with predecessor\'s **entire** transcript", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "cf-dwf-amend-inflight-"));
    const store = await createSqliteSessionStore({ dbPath: join(tempRoot, "session.sqlite") });
    const journal = new SweepableJournalStore();
    const script = amendScript("second question");
    try {
      const { harness, prefixBoundary, runA } = await liveMidAskPredecessor({
        journal,
        label: "amend-inflight",
        script,
        stall: "hang-until-cancelled",
        store,
      });

      const amended = await amendRun(harness, {
        cwd: TEST_CWD,
        predecessorRunId: runA,
        scriptText: script,
        trace: traceFor("amend-inflight-b"),
      });
      const runB = amended.runId;
      expect(amended.supersededRunId).toBe(runA);
      await settle(harness, runB);

      const sourceSession = journal.getActor(runA, "actor#1", 1)!.sessionId! as SessionId;
      const predecessorTranscript = await transcriptOf(store, sourceSession);
      expect(predecessorTranscript.length).toBeGreaterThan(prefixBoundary);

      expect((await harness.service.getTask(runB))?.output).toBe("one|revised|0");
      expect(settledEvents(harness, runB)).toEqual([
        { siteId: "world-read#1", ordinal: 1, cached: true },
        { siteId: "ask#1", ordinal: 1, cached: true },
        { siteId: "ask#2", ordinal: 1, cached: false },
      ]);

      const amendedSession = journal.getActor(runB, "actor#1", 1)!.sessionId! as SessionId;
      expect(amendedSession).not.toBe(sourceSession);
      const amendedTranscript = await transcriptOf(store, amendedSession);
      expect(amendedTranscript.slice(0, predecessorTranscript.length)).toEqual(
        predecessorTranscript,
      );
      expect(amendedTranscript.length).toBeGreaterThan(predecessorTranscript.length);

      const carried = journal.getNode(runB, "ask#2", 1);
      expect(carried?.status).toBe("completed");
      expect(carried?.stats?.worldToolCalls).toBeUndefined();
      expect(carried?.messageBoundary).toBe(amendedTranscript.length);
    } finally {
      store.close();
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  
  it("修订改掉了在飞的那条指令：不接续，新会话只到完结前缀的边界", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "cf-dwf-amend-inflight-miss-"));
    const store = await createSqliteSessionStore({ dbPath: join(tempRoot, "session.sqlite") });
    const journal = new SweepableJournalStore();
    try {
      const { harness, prefixBoundary, runA } = await liveMidAskPredecessor({
        journal,
        label: "amend-inflight-miss",
        script: amendScript("second question"),
        stall: "hang-until-cancelled",
        store,
      });

      const amended = await amendRun(harness, {
        cwd: TEST_CWD,
        predecessorRunId: runA,
        scriptText: amendScript("second question, revised"),
        trace: traceFor("amend-inflight-miss-b"),
      });
      await settle(harness, amended.runId);

      const sourceSession = journal.getActor(runA, "actor#1", 1)!.sessionId! as SessionId;
      const predecessorTranscript = await transcriptOf(store, sourceSession);
      expect(predecessorTranscript.length).toBeGreaterThan(prefixBoundary);

      const amendedSession = journal.getActor(amended.runId, "actor#1", 1)!.sessionId! as SessionId;
      const amendedTranscript = await transcriptOf(store, amendedSession);
      expect(amendedTranscript.slice(0, prefixBoundary)).toEqual(
        predecessorTranscript.slice(0, prefixBoundary),
      );
      expect(amendedTranscript.slice(0, predecessorTranscript.length)).not.toEqual(
        predecessorTranscript,
      );
      expect(amendedTranscript).not.toContain(predecessorTranscript[prefixBoundary]);
    } finally {
      store.close();
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  
  it("前驱会话到点仍在被写 → 不接续，完结前缀照旧导入", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "cf-dwf-amend-inflight-noisy-"));
    const store = await createSqliteSessionStore({ dbPath: join(tempRoot, "session.sqlite") });
    const journal = new SweepableJournalStore();
    const script = amendScript("second question");
    try {
      const { harness, prefixBoundary, runA } = await liveMidAskPredecessor({
        journal,
        label: "amend-inflight-noisy",
        quiesceMs: 5,
        script,
        stall: "hang",
        store,
      });

      const amended = await amendRun(harness, {
        cwd: TEST_CWD,
        predecessorRunId: runA,
        scriptText: script,
        trace: traceFor("amend-inflight-noisy-b"),
      });
      await settle(harness, amended.runId);

      expect(settledEvents(harness, amended.runId)).toEqual([
        { siteId: "world-read#1", ordinal: 1, cached: true },
        { siteId: "ask#1", ordinal: 1, cached: true },
        { siteId: "ask#2", ordinal: 1, cached: false },
      ]);
      const sourceSession = journal.getActor(runA, "actor#1", 1)!.sessionId! as SessionId;
      const predecessorTranscript = await transcriptOf(store, sourceSession);
      expect(predecessorTranscript.length).toBeGreaterThan(prefixBoundary);
      const amendedSession = journal.getActor(amended.runId, "actor#1", 1)!.sessionId! as SessionId;
      const amendedTranscript = await transcriptOf(store, amendedSession);
      expect(amendedTranscript.slice(0, prefixBoundary)).toEqual(
        predecessorTranscript.slice(0, prefixBoundary),
      );
      expect(amendedTranscript.slice(0, predecessorTranscript.length)).not.toEqual(
        predecessorTranscript,
      );
    } finally {
      store.close();
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
});

describe("dynamic workflow run service — 用量沿 lineage 累计", () => {
  
  const TOKENS_PER_TURN = 20;

  it("后继 run 从前驱总量起账：命中不加钱、live turn 才加，前驱行分文不动；链式修订按构造求和", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "cf-dwf-lineage-tokens-"));
    const store = await createSqliteSessionStore({ dbPath: join(tempRoot, "session.sqlite") });
    const journal = new SweepableJournalStore();
    try {
      const before = makeHarness({
        actorScripts: {
          "actor#1@1": [
            { kind: "submit", result: { text: "one" } },
            { kind: "submit", result: { text: "two" } },
          ],
        },
        journal,
        sessionStore: store as never,
      });
      const runA = await submitRun(before, {
        cwd: TEST_CWD,
        scriptText: amendScript("second question"),
        trace: traceFor("lineage-tokens-a"),
      });
      await settle(before, runA);
      expect(turnCount(before)).toBe(2);
      const totalA = 2 * TOKENS_PER_TURN;
      expect(journal.getRun(runA)?.spentTokens).toBe(totalA);

      const after = makeHarness({
        actorScripts: { "actor#1@1": [{ kind: "submit", result: { text: "revised" } }] },
        journal,
        sessionStore: store as never,
      });
      const runB = await amendRun(after, {
        cwd: TEST_CWD,
        predecessorRunId: runA,
        scriptText: amendScript("second question, revised"),
        trace: traceFor("lineage-tokens-b"),
      });
      await settle(after, runB.runId);
      expect(turnCount(after)).toBe(1);

      const totalB = totalA + TOKENS_PER_TURN;
      expect(journal.getRun(runB.runId)?.spentTokens).toBe(totalB);
      expect(settledEvents(after, runB.runId)).toEqual([
        { siteId: "world-read#1", ordinal: 1, cached: true },
        { siteId: "ask#1", ordinal: 1, cached: true },
        { siteId: "ask#2", ordinal: 1, cached: false },
      ]);

      expect(journal.getRun(runA)?.spentTokens).toBe(totalA);

      const usageB = after.runEvents.filter(
        (event) => event.runId === runB.runId && event.eventType === "usage-updated",
      );
      expect(usageB[0]?.payload.spentTokens).toBe(totalA);
      expect(usageB.at(-1)?.payload.spentTokens).toBe(totalB);
      const typesB = after.runEvents
        .filter((event) => event.runId === runB.runId)
        .map((event) => event.eventType);
      expect(typesB.slice(0, typesB.indexOf("usage-updated"))).toEqual([
        "run-started",
        "run-launched",
      ]);

      const third = makeHarness({
        actorScripts: { "actor#1@1": [{ kind: "submit", result: { text: "revised twice" } }] },
        journal,
        sessionStore: store as never,
      });
      const runC = await amendRun(third, {
        cwd: TEST_CWD,
        predecessorRunId: runB.runId,
        scriptText: amendScript("second question, revised twice"),
        trace: traceFor("lineage-tokens-c"),
      });
      await settle(third, runC.runId);
      expect(turnCount(third)).toBe(1);
      expect(journal.getRun(runC.runId)?.spentTokens).toBe(totalB + TOKENS_PER_TURN);
      expect(journal.getRun(runB.runId)?.spentTokens).toBe(totalB);
    } finally {
      store.close();
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("全新 submit 从零起账（继承只发生在 amend 路上）", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("lineage-tokens-fresh"),
    });
    await settle(harness, runId);
    const usage = harness.runEvents.filter(
      (event) => event.runId === runId && event.eventType === "usage-updated",
    );
    expect(usage[0]?.payload.spentTokens).toBe(TOKENS_PER_TURN);
    expect(harness.journal.getRun(runId)?.spentTokens).toBe(turnCount(harness) * TOKENS_PER_TURN);
  });

  it("间隙读面（dwf_run 行藏起来）报继承值而不是 0", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "cf-dwf-lineage-gap-"));
    const store = await createSqliteSessionStore({ dbPath: join(tempRoot, "session.sqlite") });
    try {
      const real = resolveDynamicWorkflowJournalStore(store as never) as JournalStorePort &
        DwfRunIntrospectionQueries;
      const hidden = new Set<string>();
      const journal = hideRunsFromReads(real, hidden);
      const harness = makeHarness({
        actorScripts: {
          "actor#1@1": [{ kind: "submit", result: { text: "one" } }, { kind: "hang" }],
        },
        journal,
        quiesceMs: 5,
        sessionStore: store as never,
      });
      const predecessor = await submitRun(harness, {
        cwd: TEST_CWD,
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: amendScript("second question"),
        trace: traceFor("lineage-gap-a"),
      });
      await vi.waitFor(() => {
        expect(real.getRun(predecessor)?.spentTokens).toBe(TOKENS_PER_TURN);
      });
      expect(await harness.service.cancel(predecessor)).toBe(true);
      await settle(harness, predecessor);
      const inherited = real.getRun(predecessor)!.spentTokens;
      expect(inherited).toBe(TOKENS_PER_TURN);

      const amended = await amendRun(harness, {
        cwd: TEST_CWD,
        predecessorRunId: predecessor,
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: amendScript("second question, revised"),
        trace: traceFor("lineage-gap-b"),
      });
      await settle(harness, amended.runId);
      expect(real.getRun(amended.runId)?.spentTokens).toBe(inherited + TOKENS_PER_TURN);

      hidden.add(amended.runId);
      const gap = await introspectionOf(harness).getRunDetail(amended.runId);
      expect(gap?.usage).toMatchObject({ nodesObserved: 0, spentTokens: inherited });
      const listed = await introspectionOf(harness).listRuns({ cwd: TEST_CWD, limit: 8 });
      const gapRow = listed.runs.find((row) => row.runId === amended.runId);
      expect(gapRow?.spentTokens).toBe(inherited);

      const fresh = await submitRun(harness, {
        cwd: TEST_CWD,
        parentSessionId: HARNESS_PARENT_SESSION,
        scriptText: TYPED_SCRIPT,
        trace: traceFor("lineage-gap-fresh"),
      });
      hidden.add(fresh);
      expect((await introspectionOf(harness).getRunDetail(fresh))?.usage.spentTokens).toBe(0);
      hidden.delete(fresh);
      await harness.service.cancel(fresh);
      await settle(harness, fresh);
    } finally {
      store.close();
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
});

describe("dynamic workflow run service — amend-resume 的崩溃后重建", () => {
  it("崩溃后 resume：alpha 曾 live 但没写过工作区 ⇒ 门没关，beta 仍从导入表结算；journal pin 压过承袭的 seed pin", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "cf-dwf-amend-resume-"));
    const store = await createSqliteSessionStore({ dbPath: join(tempRoot, "session.sqlite") });
    const journal = new SweepableJournalStore();
    try {
      const before = makeHarness({
        actorScripts: {
          "actor#1@1": [{ kind: "submit", result: { text: "alpha-1" } }],
          "actor#2@1": [{ kind: "submit", result: { text: "beta-1" } }],
        },
        journal,
        sessionStore: store as never,
      });
      const runA = await submitRun(before, {
        cwd: TEST_CWD,
        scriptText: TWO_ACTOR_SCRIPT,
        trace: traceFor("amend-two-actor"),
      });
      await settle(before, runA);

      const crashed = makeHarness({ hangActors: true, journal, sessionStore: store as never });
      const submitted = await crashed.service.amend!({
        cwd: TEST_CWD,
        predecessorRunId: runA,
        scriptText: TWO_ACTOR_SCRIPT.replace("alpha question", "alpha question, revised"),
        trace: traceFor("amend-crash"),
      });
      expect(submitted.ok).toBe(true);
      if (!submitted.ok) return;
      const runB = submitted.runId;
      await vi.waitFor(() => {
        expect(crashed.actorRuntimeInputs.length).toBeGreaterThan(0);
      });
      expect(await crashed.service.cancel(runB)).toBe(true);
      await settle(crashed, runB);
      expect(
        journal
          .listNodes(runB, { kinds: "all", withResult: true })
          .some((node) => node.actorSiteId === "actor#2"),
      ).toBe(false);
      expect(
        journal
          .listEvents(runB, { types: "all", reportItems: "all" })
          .some(({ event }) => event.type === "import-cache-closed"),
      ).toBe(false);

      const alphaRow = journal.getActor(runB, "actor#1", 1)!;
      journal.putActor({ ...alphaRow, resolvedModel: "sentinel/from-journal" });

      const resumed = makeHarness({
        actorScripts: {
          "actor#1@1": [{ kind: "submit", result: { text: "alpha-2" } }],
          "actor#2@1": [{ kind: "submit", result: { text: "beta-2" } }],
        },
        journal,
        sessionStore: store as never,
      });
      const outcome = await resumed.service.resume?.(runB);
      expect(outcome?.ok).toBe(true);
      await settle(resumed, runB);

      expect((await resumed.service.getTask(runB))?.output).toBe("alpha-2|beta-1");
      expect(turnCount(resumed)).toBe(1);
      expect(resumed.actorRuntimeInputs.map((input) => refToString(input.actor))).toEqual([
        "actor#1@1",
      ]);
      expect(settledEvents(resumed, runB)).toContainEqual({
        siteId: "ask#2",
        ordinal: 1,
        cached: true,
      });
      expect(journal.getNode(runB, "ask#2", 1)?.result).toEqual({ text: "beta-1" });

      expect(resumed.actorRuntimeInputs[0]!.pinnedModel).toBe("sentinel/from-journal");
    } finally {
      store.close();
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("崩溃后 resume：alpha 真的写了文件 ⇒ 执行器 → driver → 引擎关门；beta live 重跑（关门判定从 import-cache-closed 恢复）", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "cf-dwf-amend-resume-write-"));
    const store = await createSqliteSessionStore({ dbPath: join(tempRoot, "session.sqlite") });
    const journal = new SweepableJournalStore();
    try {
      const before = makeHarness({
        actorScripts: {
          "actor#1@1": [{ kind: "submit", result: { text: "alpha-1" } }],
          "actor#2@1": [
            { kind: "write", path: join(TEST_CWD, "beta-notes.md"), content: "beta was here" },
            { kind: "submit", result: { text: "beta-1" } },
          ],
        },
        journal,
        sessionStore: store as never,
      });
      const runA = await submitRun(before, {
        cwd: TEST_CWD,
        scriptText: TWO_ACTOR_SCRIPT,
        trace: traceFor("amend-two-actor-write"),
      });
      await settle(before, runA);
      expect(journal.getNode(runA, "ask#2", 1)?.stats?.worldToolCalls ?? 0).toBeGreaterThan(0);
      expect(journal.getNode(runA, "ask#1", 1)?.stats?.worldToolCalls).toBe(0);

      const crashed = makeHarness({
        actorScripts: {
          "actor#1@1": [
            { kind: "write", path: join(TEST_CWD, "notes.md"), content: "alpha was here" },
            { kind: "hang" },
          ],
        },
        journal,
        sessionStore: store as never,
      });
      const submitted = await crashed.service.amend!({
        cwd: TEST_CWD,
        predecessorRunId: runA,
        scriptText: TWO_ACTOR_SCRIPT.replace("alpha question", "alpha question, revised"),
        trace: traceFor("amend-crash-write"),
      });
      expect(submitted.ok).toBe(true);
      if (!submitted.ok) return;
      const runB = submitted.runId;
      await vi.waitFor(() => {
        expect(
          journal
            .listEvents(runB, { types: "all", reportItems: "all" })
            .some(({ event }) => event.type === "import-cache-closed"),
        ).toBe(true);
      });
      const closed = journal
        .listEvents(runB, { types: "all", reportItems: "all" })
        .find(({ event }) => event.type === "import-cache-closed")!.event;
      expect(closed).toMatchObject({
        type: "import-cache-closed",
        instance: { siteId: "ask#1", ordinal: 1 },
        cause: "mutating-tool",
        actorName: "alpha",
      });
      expect(await crashed.service.cancel(runB)).toBe(true);
      await settle(crashed, runB);
      expect(
        journal
          .listNodes(runB, { kinds: "all", withResult: true })
          .some((node) => node.actorSiteId === "actor#2"),
      ).toBe(false);

      const resumed = makeHarness({
        actorScripts: {
          "actor#1@1": [{ kind: "submit", result: { text: "alpha-2" } }],
          "actor#2@1": [{ kind: "submit", result: { text: "beta-2" } }],
        },
        journal,
        sessionStore: store as never,
      });
      const outcome = await resumed.service.resume?.(runB);
      expect(outcome?.ok).toBe(true);
      await settle(resumed, runB);

      expect((await resumed.service.getTask(runB))?.output).toBe("alpha-2|beta-2");
      expect(turnCount(resumed)).toBe(2);
      expect(resumed.actorRuntimeInputs.map((input) => refToString(input.actor))).toEqual([
        "actor#1@1",
        "actor#2@1",
      ]);
      expect(settledEvents(resumed, runB)).toContainEqual({
        siteId: "ask#2",
        ordinal: 1,
        cached: false,
      });
      expect(journal.getNode(runB, "ask#2", 1)?.result).toEqual({ text: "beta-2" });
      expect(
        resumed.runEvents.filter(
          (event) => event.runId === runB && event.eventType === "import-cache-closed",
        ),
      ).toHaveLength(0);
    } finally {
      store.close();
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("前驱被清理 → resume 仍成功，未消费的导入降级为 live 重跑", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "cf-dwf-amend-lost-"));
    const store = await createSqliteSessionStore({ dbPath: join(tempRoot, "session.sqlite") });
    const journal = new SweepableJournalStore();
    try {
      const before = makeHarness({
        actorScripts: {
          "actor#1@1": [{ kind: "submit", result: { text: "alpha-1" } }],
          "actor#2@1": [{ kind: "submit", result: { text: "beta-1" } }],
        },
        journal,
        sessionStore: store as never,
      });
      const runA = await submitRun(before, {
        cwd: TEST_CWD,
        scriptText: TWO_ACTOR_SCRIPT,
        trace: traceFor("amend-lost-predecessor"),
      });
      await settle(before, runA);

      const crashed = makeHarness({ hangActors: true, journal, sessionStore: store as never });
      const submitted = await crashed.service.amend!({
        cwd: TEST_CWD,
        predecessorRunId: runA,
        scriptText: TWO_ACTOR_SCRIPT.replace("alpha question", "alpha question, revised"),
        trace: traceFor("amend-lost-crash"),
      });
      expect(submitted.ok).toBe(true);
      if (!submitted.ok) return;
      const runB = submitted.runId;
      await vi.waitFor(() => {
        expect(crashed.actorRuntimeInputs.length).toBeGreaterThan(0);
      });
      await crashed.service.cancel(runB);
      await settle(crashed, runB);

      const resumed = makeHarness({
        actorScripts: {
          "actor#1@1": [{ kind: "submit", result: { text: "alpha-2" } }],
          "actor#2@1": [{ kind: "submit", result: { text: "beta-live" } }],
        },
        journal: withHiddenRun(journal, runA),
        sessionStore: store as never,
      });
      const outcome = await resumed.service.resume?.(runB);
      expect(outcome?.ok).toBe(true);
      await settle(resumed, runB);

      expect((await resumed.service.getTask(runB))?.output).toBe("alpha-2|beta-live");
      expect(turnCount(resumed)).toBe(2);
      expect(
        resumed.logs.some(
          (entry) => entry.context?.event === "dynamic_workflow.amend.rebuild_skipped",
        ),
      ).toBe(true);
    } finally {
      store.close();
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
});

describe("dynamic workflow run service — 升级问答（escalation）", () => {
  
  async function inflightEscalatePort(
    harness: Harness,
    name: string,
  ): Promise<{ runId: string; port: WorkflowEscalatePort }> {
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor(name),
    });
    await vi.waitFor(() => {
      expect(harness.actorRuntimeInputs.length).toBeGreaterThan(0);
    });
    await vi.waitFor(() => {
      expect(harness.runEvents.some((event) => event.eventType === "node-dispatched")).toBe(true);
    });
    const port = harness.actorRuntimeInputs[0]?.escalatePort;
    if (port === undefined) throw new Error("actor runtime 输入里没有 escalatePort");
    return { runId, port };
  }

  it("Parked questions appear in snapshot\'s pendingQuestions and are cleared in place upon answer", async () => {
    const harness = makeHarness({ hangActors: true });
    const { runId, port } = await inflightEscalatePort(harness, "escalation-snapshot");

    const answered = port.escalate({
      toolCallId: createToolCallId("escalate-1"),
      question: "评分上限 95 而通过门槛 96，这个门是不是坏了？",
      trace: traceFor("escalation-snapshot"),
    });

    const blocked = await harness.service.getTask(runId);
    expect(blocked?.pendingQuestions).toHaveLength(1);
    const question = blocked?.pendingQuestions?.[0];
    expect(question).toMatchObject({
      actor: "actor#1@1",
      actorName: "worker",
      question: "评分上限 95 而通过门槛 96，这个门是不是坏了？",
    });
    expect(blocked?.status).toBe("running");
    const raisedPayload = harness.runEvents.find(
      (event) => event.eventType === "escalation-raised",
    )?.payload;
    expect(raisedPayload?.askedAt).toBe(question?.askedAt);

    const outcome = await harness.service.resolveQuestion?.(question!.qid, "门坏了，按 95 通过。");
    expect(outcome).toEqual({ ok: true, qid: question!.qid });
    await expect(answered).resolves.toMatchObject({
      kind: "answered",
      answer: "门坏了，按 95 通过。",
    });

    const after = await harness.service.getTask(runId);
    expect(after).not.toHaveProperty("pendingQuestions");
    expect(after?.status).toBe("running");
  });

  it("停驻的问题同样出现在 getRunDetail 里（GetWorkflowRun 的取数面）", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ hangActors: true, journal });
      const { runId, port } = await inflightEscalatePort(harness, "escalation-detail");

      const answered = port.escalate({
        toolCallId: createToolCallId("escalate-detail"),
        question: "两条指令互相矛盾，先满足哪一条？",
        context: "第 3 步要求保留原文，第 5 步要求改写。",
        trace: traceFor("escalation-detail"),
      });

      const detail = await introspectionOf(harness).getRunDetail(runId);
      expect(detail?.pendingQuestions).toHaveLength(1);
      const question = detail?.pendingQuestions?.[0];
      expect(question).toMatchObject({
        actor: "actor#1@1",
        actorName: "worker",
        question: "两条指令互相矛盾，先满足哪一条？",
        context: "第 3 步要求保留原文，第 5 步要求改写。",
      });
      const snapshotQuestion = (await harness.service.getTask(runId))?.pendingQuestions?.[0];
      expect(question?.qid).toBe(snapshotQuestion?.qid);
      expect(question?.askedAt).toBe(snapshotQuestion?.askedAt);
      expect(detail?.status).toBe("running");

      await harness.service.resolveQuestion?.(question!.qid, "以第 5 步为准。");
      await expect(answered).resolves.toMatchObject({ kind: "answered" });

      expect(await introspectionOf(harness).getRunDetail(runId)).not.toHaveProperty(
        "pendingQuestions",
      );

      await harness.service.cancel(runId);
      await settle(harness, runId);
    });
  });

  it("raised / resolved 两类事件都进了实时轨与事件分页", async () => {
    const harness = makeHarness({ hangActors: true });
    const { runId, port } = await inflightEscalatePort(harness, "escalation-events");

    const answered = port.escalate({
      toolCallId: createToolCallId("escalate-2"),
      question: "这个门坏了吗？",
      trace: traceFor("escalation-events"),
    });
    const qid = (await harness.service.getTask(runId))?.pendingQuestions?.[0]?.qid;
    await harness.service.resolveQuestion?.(qid!, "It\'s broken.");
    await answered;

    const raised = harness.runEvents.find((event) => event.eventType === "escalation-raised");
    expect(raised?.payload).toMatchObject({
      qid,
      actorName: "worker",
      question: "这个门坏了吗？",
    });
    expect(typeof raised?.payload.askedAt).toBe("number");
    expect(
      harness.runEvents.find((event) => event.eventType === "escalation-resolved")?.payload,
    ).toMatchObject({ answer: "It\'s broken.", qid });

    const { events: page } = await harness.service.listEvents(runId, {});
    expect(
      page.filter((event) => event.type.startsWith("escalation-")).map((one) => one.type),
    ).toEqual(["escalation-raised", "escalation-resolved"]);
    expect(page.find((one) => one.type === "escalation-raised")?.sequence).toBe(raised?.sequence);
  });

  it("三类结构化拒绝：未知 id / 已回答 / 不在飞", async () => {
    const harness = makeHarness({ hangActors: true });
    const { runId, port } = await inflightEscalatePort(harness, "escalation-refusals");

    expect(await harness.service.resolveQuestion?.("dwfq-nonesuch-1", "答案")).toMatchObject({
      ok: false,
      reason: "unknown_question",
    });

    const answered = port.escalate({
      toolCallId: createToolCallId("escalate-3"),
      question: "第一个问题",
      trace: traceFor("escalation-refusals"),
    });
    const firstQid = (await harness.service.getTask(runId))?.pendingQuestions?.[0]?.qid;
    await harness.service.resolveQuestion?.(firstQid!, "答案一");
    await answered;
    expect(await harness.service.resolveQuestion?.(firstQid!, "答案二")).toMatchObject({
      ok: false,
      reason: "already_resolved",
    });

    const cancelled = port.escalate({
      toolCallId: createToolCallId("escalate-4"),
      question: "第二个问题",
      trace: traceFor("escalation-refusals"),
    });
    const secondQid = (await harness.service.getTask(runId))?.pendingQuestions?.[0]?.qid;
    expect(await harness.service.cancel(runId)).toBe(true);
    await expect(cancelled).rejects.toMatchObject({ code: "Cancelled" });
    await settle(harness, runId);

    expect(await harness.service.resolveQuestion?.(secondQid!, "答案三")).toMatchObject({
      ok: false,
      reason: "run_not_in_flight",
    });
    expect((await harness.service.getTask(runId))?.status).toBe("cancelled");
  });

  it("一张停驻表跨本服务的多个在飞 run，qid 互不碰撞且 pendingQuestions 按 run 隔离", async () => {
    const harness = makeHarness({ hangActors: true });
    const first = await inflightEscalatePort(harness, "escalation-multi-a");
    const secondRunId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("escalation-multi-b"),
    });
    await vi.waitFor(() => {
      expect(harness.actorRuntimeInputs.length).toBe(2);
    });
    await vi.waitFor(() => {
      expect(
        harness.runEvents.filter((event) => event.eventType === "node-dispatched").length,
      ).toBe(2);
    });
    const secondPort = harness.actorRuntimeInputs[1]!.escalatePort;

    void first.port
      .escalate({
        toolCallId: createToolCallId("escalate-a"),
        question: "A\'s question",
        trace: traceFor("escalation-multi-a"),
      })
      .catch(() => {});
    void secondPort
      .escalate({
        toolCallId: createToolCallId("escalate-b"),
        question: "B\'s question",
        trace: traceFor("escalation-multi-b"),
      })
      .catch(() => {});

    const left = (await harness.service.getTask(first.runId))?.pendingQuestions;
    const right = (await harness.service.getTask(secondRunId))?.pendingQuestions;
    expect(left?.map((one) => one.question)).toEqual(["A\'s question"]);
    expect(right?.map((one) => one.question)).toEqual(["B\'s question"]);
    expect(left?.[0]?.qid).not.toBe(right?.[0]?.qid);
  });
});

// ————————————————————————————————————————————————
//
//
// ————————————————————————————————————————————————
describe("dynamic workflow run service — 升级问答的端到端闭环", () => {
  
  function mainSessionRuntime(
    service: Harness["service"],
    call: () => { question_id: string; answer: string },
  ): { runtime: AgentRuntime; log: ModelRequestLog } {
    const log: ModelRequestLog = { requests: [] };
    let index = 0;
    const usage = { inputTokens: 9, outputTokens: 4, totalTokens: 13 };
    const runtime = createTestAgentRuntime(
      createSessionId("escalation-main"),
      {
        systemPrompt: "You created this workflow.",
        mode: "yolo",
        subagents: { enabled: false },
        workingDirectory: TEST_CWD,
      },
      {
        dynamicWorkflowRunPort: service,
        eventStore: createInMemorySessionEventStore(),
        fileSystemPort: fakeFileSystemPort({}),
        modelAdapter: {
          async generateText(request?: {
            messages?: unknown;
            tools?: readonly { name: string }[];
          }) {
            log.requests.push({ messages: request?.messages, tools: request?.tools });
            if (index++ > 0) {
              return {
                finishReason: "stop",
                model: "scripted",
                providerMetadata: undefined,
                text: "answered.",
                usage,
              };
            }
            return {
              finishReason: "tool-calls",
              model: "scripted",
              providerMetadata: undefined,
              text: "",
              toolCalls: [
                {
                  id: "resolve-question-call-1",
                  name: RESOLVE_WORKFLOW_QUESTION_TOOL_NAME,
                  input: call(),
                },
              ],
              usage,
            };
          },
        } as never,
      },
    );
    return { runtime, log };
  }

  
  async function runUntilParked(
    harness: Harness,
    name: string,
  ): Promise<{
    runId: string;
    question: NonNullable<DynamicWorkflowRunDetail["pendingQuestions"]>[number];
  }> {
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor(name),
    });
    await vi.waitFor(async () => {
      expect((await harness.service.getTask(runId))?.pendingQuestions).toHaveLength(1);
    });
    const question = (await harness.service.getTask(runId))?.pendingQuestions?.[0];
    if (question === undefined) throw new Error("停驻的问题没有出现在快照里");
    return { runId, question };
  }

  const QUESTION = "评分上限 95 而通过门槛 96，这个门是不是坏了？";
  const CONTEXT = "每一项都已拉满，总分仍然是 95。";
  const ANSWER = "门确实坏了：按 95 分通过即可，不要为了凑 96 去改评分口径。";

  it("Actor\'s model asks → main agent\'s model answers → answer returns verbatim to actor → ask settles as usual", async () => {
    const harness = makeHarness({
      actorScripts: {
        "actor#1@1": [
          { kind: "escalate", question: QUESTION, context: CONTEXT },
          { kind: "submit", result: { text: "按 95 通过" } },
        ],
      },
    });

    const { runId, question } = await runUntilParked(harness, "escalation-loop");
    expect(question).toMatchObject({
      actor: "actor#1@1",
      actorName: "worker",
      question: QUESTION,
      context: CONTEXT,
    });
    expect(question.qid).toMatch(/^dwfq-/);

    const actorRequests = harness.actorModelRequests["actor#1@1"];
    expect(actorRequests?.requests[0]?.tools?.map((tool) => tool.name)).toContain(
      ESCALATE_TOOL_NAME,
    );

    const main = mainSessionRuntime(harness.service, () => ({
      question_id: question.qid,
      answer: ANSWER,
    }));
    await main.runtime.executeTurn(
      `Workflow run ${runId} 有One个待AnswerIssue ${question.qid}，去Answer它。`,
    );

    await settle(harness, runId);
    const snapshot = await harness.service.getTask(runId);
    expect(snapshot?.status).toBe("completed");
    expect(snapshot?.output).toBe("按 95 通过");
    expect(snapshot).not.toHaveProperty("pendingQuestions");

    expect(actorRequests?.requests.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(actorRequests?.requests[1]?.messages)).toContain(ANSWER);

    expect(JSON.stringify(main.log.requests[1]?.messages)).toContain(question.qid);

    expect(
      harness.runEvents
        .filter((event) => event.eventType.startsWith("escalation-"))
        .map((event) => event.eventType),
    ).toEqual(["escalation-raised", "escalation-resolved"]);
  });

  it("Cancel run during park: actor\'s escalate call is interrupted, subsequent answers return run_not_in_flight", async () => {
    const harness = makeHarness({
      actorScripts: {
        "actor#1@1": [
          { kind: "escalate", question: "要不要干脆跳过这个检查？" },
          { kind: "submit", result: { text: "不该走到这里" } },
        ],
      },
    });

    const { runId, question } = await runUntilParked(harness, "escalation-loop-cancel");
    expect(await harness.service.cancel(runId)).toBe(true);
    await settle(harness, runId);

    const snapshot = await harness.service.getTask(runId);
    expect(snapshot?.status).toBe("cancelled");
    expect(snapshot).not.toHaveProperty("pendingQuestions");
    expect(await harness.service.resolveQuestion?.(question.qid, "太晚了")).toMatchObject({
      ok: false,
      reason: "run_not_in_flight",
    });
  });
});

describe("dynamic workflow run service · phase-entered", () => {
  it("引擎发出的 phase-entered 经进度管线归约成 workflowRuns.phases 与 currentPhase", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: [
        'phase("Prepare");',
        'log("start");',
        "for (let i = 0; i < 2; i++) {",
        '  phase("Work");',
        "  report({ round: i });",
        "}",
        'phase("Wrap up");',
        'return "done";',
      ].join("\n"),
      trace: traceFor("phase-entered"),
    });
    await settle(harness, runId);
    expect(harness.journal.getRun(runId)).toMatchObject({ status: "completed" });

    const entered = harness.runEvents.filter((event) => event.eventType === "phase-entered");
    expect(entered.map((event) => event.payload)).toEqual([
      { name: "Prepare", ordinal: 1 },
      { name: "Work", ordinal: 1 },
      { name: "Work", ordinal: 2 },
      { name: "Wrap up", ordinal: 1 },
    ]);

    let state: WorkflowRunsState | undefined;
    for (const event of harness.runEvents) {
      state = reduceWorkflowRunsState(state, event as WorkflowRunProgressEnvelope) ?? state;
    }
    expect(state?.runs[0]?.phases).toEqual([
      { name: "Prepare", rounds: 1 },
      { name: "Work", rounds: 2 },
      { name: "Wrap up", rounds: 1 },
    ]);
    expect(state?.runs[0]?.currentPhase).toBe("Wrap up");
    expect(workflowRunsStateSchema.parse(state)).toEqual(state);
  });
});

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

const BIRTH_PHASE_SCRIPT = [
  "interface Answer { text: string }",
  'const solo = agent("solo");',
  'const s = await solo.ask<Answer>("before any marker");',
  'phase("Prepare");',
  'const prep = agent("prep");',
  'const p = await prep.ask<Answer>("prepare question");',
  'const paths = await files.glob("src/**/*.ts");',
  'phase("Work");',
  'const worker = agent("worker");',
  'const w = await worker.ask<Answer>("work question");',
  "return `${s.text}|${p.text}|${w.text}|${paths.length}`;",
].join("\n");

function birthStamps(harness: Harness): { type: string; ref: string; phaseName?: string }[] {
  return harness.runEvents
    .filter(
      (event) =>
        event.eventType === "actor-created" ||
        event.eventType === "node-queued" ||
        event.eventType === "node-settled",
    )
    .map((event) => {
      const payload = event.payload as {
        actor?: { siteId: string; ordinal: number };
        instance?: { siteId: string; ordinal: number };
        phaseName?: string;
      };
      const ref = payload.instance ?? payload.actor;
      return {
        type: `${event.eventType}${event.payload.cached === true ? "(cached)" : ""}`,
        ref: `${ref?.siteId}@${ref?.ordinal}`,
        ...("phaseName" in payload ? { phaseName: payload.phaseName } : {}),
      };
    });
}

function refOfPayload(payload: Record<string, unknown>): string {
  const ref = (payload.instance ?? payload.actor) as
    | { siteId: string; ordinal: number }
    | undefined;
  return `${ref?.siteId}@${ref?.ordinal}`;
}

function reducedPhaseNames(state: WorkflowRunsState | undefined): {
  actors: [string, string | undefined][];
  nodes: [string, string | undefined][];
} {
  const run = state?.runs[0];
  return {
    actors: (run?.actors ?? []).map((actor) => [
      `${actor.siteId}@${actor.ordinal}`,
      actor.phaseName,
    ]),
    nodes: (run?.nodes ?? []).map((node) => [`${node.siteId}@${node.ordinal}`, node.phaseName]),
  };
}

function reduceAll(harness: Harness): WorkflowRunsState | undefined {
  let state: WorkflowRunsState | undefined;
  for (const event of harness.runEvents) {
    state = reduceWorkflowRunsState(state, event as WorkflowRunProgressEnvelope) ?? state;
  }
  return state;
}

describe("dynamic workflow run service · 出生阶段（phaseName）", () => {
  it("标记前出生的实例不带戳、Prepare / Work 各带各的；派发与 live 结算不带，且归约后落到 actors / nodes 上", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: BIRTH_PHASE_SCRIPT,
      trace: traceFor("birth-phase"),
    });
    await settle(harness, runId);
    expect(harness.journal.getRun(runId)).toMatchObject({ status: "completed" });

    expect(birthStamps(harness)).toStrictEqual([
      { type: "actor-created", ref: "actor#1@1" },
      { type: "node-queued", ref: "ask#1@1" },
      { type: "node-settled", ref: "ask#1@1" },
      { type: "actor-created", ref: "actor#2@1", phaseName: "Prepare" },
      { type: "node-queued", ref: "ask#2@1", phaseName: "Prepare" },
      { type: "node-settled", ref: "ask#2@1" },
      { type: "node-queued", ref: "world-read#1@1", phaseName: "Prepare" },
      { type: "node-settled", ref: "world-read#1@1" },
      { type: "actor-created", ref: "actor#3@1", phaseName: "Work" },
      { type: "node-queued", ref: "ask#3@1", phaseName: "Work" },
      { type: "node-settled", ref: "ask#3@1" },
    ]);

    const dispatched = harness.runEvents.filter((event) => event.eventType === "node-dispatched");
    expect(
      dispatched.map((event) => ({
        ref: refOfPayload(event.payload),
        ...("phaseName" in event.payload ? { phaseName: event.payload.phaseName } : {}),
        ...("actorPhaseName" in event.payload
          ? { actorPhaseName: event.payload.actorPhaseName }
          : {}),
      })),
    ).toStrictEqual([
      { ref: "ask#1@1" },
      { ref: "ask#2@1", phaseName: "Prepare", actorPhaseName: "Prepare" },
      { ref: "world-read#1@1" },
      { ref: "ask#3@1", phaseName: "Work", actorPhaseName: "Work" },
    ]);
    const askDispatch = dispatched.find((event) => refOfPayload(event.payload) === "ask#3@1");
    expect(askDispatch).toMatchObject({
      actorSessionId: expect.any(String),
      payload: { kind: "ask", actorName: "worker", instructionsHead: "work question" },
    });
    expect(askDispatch?.actorSessionId).toBe(
      harness.runEvents.find(
        (event) =>
          event.eventType === "actor-created" && refOfPayload(event.payload) === "actor#3@1",
      )?.actorSessionId,
    );
    expect(
      dispatched.find((event) => refOfPayload(event.payload) === "world-read#1@1"),
    ).not.toHaveProperty("actorSessionId");

    const state = reduceAll(harness);
    expect(reducedPhaseNames(state)).toEqual({
      actors: [
        ["actor#1@1", undefined],
        ["actor#2@1", "Prepare"],
        ["actor#3@1", "Work"],
      ],
      nodes: [
        ["ask#1@1", undefined],
        ["ask#2@1", "Prepare"],
        ["world-read#1@1", "Prepare"],
        ["ask#3@1", "Work"],
      ],
    });
    expect(state?.runs[0]?.nodes.every((node) => node.phase === "settled")).toBe(true);
    expect(workflowRunsStateSchema.parse(state)).toEqual(state);
  });

  it("resume 时 cached 的 node-settled 带回与前一世相同的出生阶段", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "cf-dwf-birth-phase-"));
    const store = await createSqliteSessionStore({ dbPath: join(tempRoot, "session.sqlite") });
    const journal = new SweepableJournalStore();
    try {
      const before = makeHarness({ journal, sessionStore: store as never });
      const runA = await submitRun(before, {
        cwd: TEST_CWD,
        scriptText: BIRTH_PHASE_SCRIPT,
        trace: traceFor("birth-phase-predecessor"),
      });
      await settle(before, runA);
      expect(before.journal.getRun(runA)).toMatchObject({ status: "completed" });

      const after = makeHarness({ journal, sessionStore: store as never });
      const submitted = await after.service.amend!({
        cwd: TEST_CWD,
        predecessorRunId: runA,
        scriptText: BIRTH_PHASE_SCRIPT,
        trace: traceFor("birth-phase-resume"),
      });
      expect(submitted.ok).toBe(true);
      if (!submitted.ok) return;
      await settle(after, submitted.runId);
      expect(turnCount(after)).toBe(0);

      expect(birthStamps(after)).toStrictEqual([
        { type: "actor-created", ref: "actor#1@1" },
        { type: "node-settled(cached)", ref: "ask#1@1" },
        { type: "actor-created", ref: "actor#2@1", phaseName: "Prepare" },
        { type: "node-settled(cached)", ref: "ask#2@1", phaseName: "Prepare" },
        { type: "node-settled(cached)", ref: "world-read#1@1", phaseName: "Prepare" },
        { type: "actor-created", ref: "actor#3@1", phaseName: "Work" },
        { type: "node-settled(cached)", ref: "ask#3@1", phaseName: "Work" },
      ]);

      const state = reduceAll(after);
      expect(reducedPhaseNames(state)).toEqual({
        actors: [
          ["actor#1@1", undefined],
          ["actor#2@1", "Prepare"],
          ["actor#3@1", "Work"],
        ],
        nodes: [
          ["ask#1@1", undefined],
          ["ask#2@1", "Prepare"],
          ["world-read#1@1", "Prepare"],
          ["ask#3@1", "Work"],
        ],
      });
      expect(workflowRunsStateSchema.parse(state)).toEqual(state);
    } finally {
      store.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("dynamic workflow run service — 模型侧错误的收容（apps/cli/packages/dynamic-workflow/docs/execution-engine.md）", () => {
  const PARALLEL_SCRIPT = [
    "interface Answer { text: string }",
    'const alpha = agent("alpha");',
    'const beta = agent("beta");',
    "const [a, b] = await Promise.all([",
    '  alpha.ask<Answer>("first"),',
    '  beta.ask<Answer>("second"),',
    "]);",
    "return a.text + b.text;",
  ].join("\n");

  const adapterError = (context: Record<string, unknown>, message: string) =>
    Object.assign(new Error(message), {
      name: "AiSdkModelAdapterError",
      code: "model_request_failed",
      context,
    });

  it("一个子代理撞上确定性模型错误 → run stopped(provider)，兄弟在飞 ask 被 abort，可恢复", async () => {
    const harness = makeHarness({
      actorScripts: {
        "actor#1@1": [
          {
            kind: "throw",
            error: adapterError(
              {
                reason: "auth_failed",
                providerId: "prov",
                modelId: "alpha",
                providerCode: "1006",
                retryable: false,
              },
              "[1006] token expired",
            ),
          },
        ],
        "actor#2@1": [{ kind: "hang" }],
      },
    });
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: HARNESS_PARENT_SESSION,
      scriptText: PARALLEL_SCRIPT,
      trace: traceFor("provider-stop"),
    });
    await settle(harness, runId);

    const record = harness.journal.getRun(runId);
    expect(record?.status).toBe("stopped");
    expect(record?.stopReason).toBe("provider");
    expect(record?.failure?.code).toBe("ProviderStop");
    expect(record?.failure?.providerStop).toMatchObject({
      kind: "auth",
      reason: "auth_failed",
      providerCode: "1006",
      subagent: "actor#1@1",
      subagentName: "alpha",
      rawMessage: "[1006] token expired",
    });
    const settledNodes = harness.runEvents.filter(
      (event) => event.runId === runId && event.eventType === "node-settled",
    );
    expect(settledNodes.map((event) => event.payload.outcome)).toEqual(["cancelled", "cancelled"]);
    const nodes = harness.journal
      .listNodes(runId, { kinds: "all", withResult: true })
      .filter((node) => node.kind === "ask");
    expect(nodes.map((node) => node.status)).toEqual(["running", "running"]);

    const snapshot = await harness.service.getTask(runId);
    expect(snapshot?.status).toBe("cancelled");
    expect(snapshot?.runStatus).toBe("stopped");
    expect(snapshot?.stopReason).toBe("provider");
    expect(snapshot?.failure?.code).toBe("ProviderStop");
    expect(snapshot?.failure?.providerStop?.kind).toBe("auth");

    const settled = harness.runEvents.find((event) => event.eventType === "run-settled");
    expect(settled?.payload).toMatchObject({
      status: "stopped",
      stopReason: "provider",
      resumable: true,
      error: { code: "ProviderStop" },
    });
    expect((await harness.service.listRunsForSession?.())?.[0]).toMatchObject({
      runId,
      status: "stopped",
      stopReason: "provider",
      failureCode: "ProviderStop",
      resumable: true,
    });
  });

  it('cancel(runId, "model")（TaskStop）→ stopped(model)；缺省 initiator 是 user', async () => {
    const harness = makeHarness({ hangActors: true });
    const byModel = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("stop-by-model"),
    });
    expect(await harness.service.cancel(byModel, "model")).toBe(true);
    await settle(harness, byModel);
    expect(harness.journal.getRun(byModel)).toMatchObject({
      status: "stopped",
      stopReason: "model",
    });
    expect((await harness.service.getTask(byModel))?.stopReason).toBe("model");
    const settled = harness.runEvents.find(
      (event) => event.runId === byModel && event.eventType === "run-settled",
    );
    expect(settled?.payload).toMatchObject({
      status: "stopped",
      stopReason: "model",
      resumable: true,
    });

    const byUser = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("stop-by-user"),
    });
    expect(await harness.service.cancel(byUser)).toBe(true);
    await settle(harness, byUser);
    expect(harness.journal.getRun(byUser)).toMatchObject({ status: "stopped", stopReason: "user" });
  });
});

class LifeSpanJournalStore extends SweepableJournalStore {
  
  readonly lifeSpans = new Map<string, DwfRunLifeSpan[]>();

  listRunLifeSpans(runId: string): DwfRunLifeSpan[] {
    return this.lifeSpans.get(runId) ?? [];
  }
}

describe("dynamic workflow run service — 快照上的 lineage 活动时长", () => {
  it("终态快照带 activeDurationMs（逐世求和），运行中不带", async () => {
    const journal = new LifeSpanJournalStore();
    const harness = makeHarness({ hangActors: true, journal });
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("lifespan-terminal"),
    });
    journal.lifeSpans.set(runId, [
      { startedAt: 0, lastActivityAt: 3_600_000 },
      { startedAt: 200_000_000, lastActivityAt: 200_120_000 },
    ]);

    const running = await harness.service.getTask(runId);
    expect(running?.status).toBe("running");
    expect(running?.activeDurationMs).toBeUndefined();

    expect(await harness.service.cancel(runId)).toBe(true);
    await settle(harness, runId);

    expect((await harness.service.getTask(runId))?.activeDurationMs).toBe(3_600_000 + 120_000);
  });

  it("修订链：快照报的是整条 lineage 的活动时长，不只是这一次修订的那一世", async () => {
    const journal = new LifeSpanJournalStore();
    const harness = makeHarness({ hangActors: true, journal });
    const predecessor = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("lifespan-predecessor"),
    });
    journal.lifeSpans.set(predecessor, [{ startedAt: 0, lastActivityAt: 4 * 3_600_000 }]);

    const amended = await amendRun(harness, {
      cwd: TEST_CWD,
      predecessorRunId: predecessor,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("lifespan-amendment"),
    });
    journal.lifeSpans.set(amended.runId, [
      { startedAt: 10 * 3_600_000, lastActivityAt: 10 * 3_600_000 + 12_000 },
    ]);
    expect(await harness.service.cancel(amended.runId)).toBe(true);
    await settle(harness, amended.runId);

    expect(journal.getRun(amended.runId)?.resumedFrom).toBe(predecessor);
    expect((await harness.service.getTask(amended.runId))?.activeDurationMs).toBe(
      4 * 3_600_000 + 12_000,
    );
    expect((await harness.service.getTask(predecessor))?.activeDurationMs).toBe(4 * 3_600_000);
  });

  it("journal 没有这条读面（引擎的内存实现）：字段整个缺席，通知退回本世", async () => {
    const harness = makeHarness();
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      scriptText: TYPED_SCRIPT,
      trace: traceFor("lifespan-absent"),
    });
    await settle(harness, runId);

    const snapshot = await harness.service.getTask(runId);
    expect(snapshot?.status).toBe("completed");
    expect(snapshot?.activeDurationMs).toBeUndefined();
    expect("activeDurationMs" in (snapshot ?? {})).toBe(false);
  });
});

describe("dynamic workflow run service — 留白（FillWorkflowHole）", () => {
  
  const HOLE_SCRIPT = [
    'phase("准备");',
    'const a = await agent("worker").ask<{ text: string }>("do the thing");',
    'const v = await hole<string>("裁决", `decide on ${a.text}`);',
    "return v;",
  ].join("\n");
  const HOLE_PHASES = ["准备", "裁决"];
  const VERDICT = holeSiteId("裁决");
  const LEFT = holeSiteId("左");
  const RIGHT = holeSiteId("右");
  const DECIDE = holeSiteId("决定");
  const REFINE = holeSiteId("细化");

  
  async function submitAndReachHole(
    harness: Harness,
    name: string,
    extra: Partial<Parameters<Harness["service"]["submit"]>[0]> = {},
  ): Promise<string> {
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: HARNESS_PARENT_SESSION,
      phaseNames: HOLE_PHASES,
      scriptText: HOLE_SCRIPT,
      trace: traceFor(name),
      ...extra,
    });
    await vi.waitFor(() => {
      expect(
        harness.runEvents.some(
          (event) => event.runId === runId && event.eventType === "hole-reached",
        ),
      ).toBe(true);
    });
    return runId;
  }

  function fill(harness: Harness, runId: string, body: string, holeId = VERDICT) {
    return harness.service.fillHole!({
      runId,
      holeId,
      body,
      parentSessionId: HARNESS_PARENT_SESSION,
      trace: traceFor("fill"),
    });
  }

  it("停在留白处：run-launched 的 holes 下标、快照的 waiting 条目、hole-reached 载荷的 type / reachedAt", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      const runId = await submitAndReachHole(harness, "hole-wait");

      const launched = harness.journal.listEvents(runId, {
        types: ["run-launched"],
        reportItems: { limit: 0 },
      })[0]?.event;
      expect(launched).toMatchObject({ type: "run-launched", phaseNames: HOLE_PHASES, holes: [1] });

      const reached = harness.runEvents.find((event) => event.eventType === "hole-reached");
      expect(reached?.payload).toMatchObject({
        instance: { siteId: VERDICT, ordinal: 1 },
        name: "裁决",
        prompt: "decide on done",
        type: "string",
      });
      expect(typeof reached?.payload.reachedAt).toBe("number");

      const waiting = await harness.service.getTask(runId);
      expect(waiting?.status).toBe("running");
      expect(waiting?.holes).toEqual([
        {
          siteId: VERDICT,
          ordinal: 1,
          name: "裁决",
          type: "string",
          state: "waiting",
          since: reached?.payload.reachedAt,
          line: 3,
          before: "准备",
        },
      ]);
      const detail = await harness.service.getRunDetail?.(runId);
      expect(detail?.holes).toEqual(waiting?.holes);

      const result = await fill(harness, runId, 'return "verdict";');
      expect(result).toMatchObject({ ok: true, phasesAdded: [] });
      if (!result.ok) throw new Error(result.message);
      expect(result.scriptText).toContain(
        'hole<string>("裁决", `decide on ${a.text}`, async () => {',
      );
      expect(result.scriptText).toContain('  return "verdict";\n})');

      await settle(harness, runId);
      const done = await harness.service.getTask(runId);
      expect(done?.status).toBe("completed");
      expect(done?.output).toBe("verdict");
      expect(done?.holes).toEqual([
        {
          before: "准备",
          siteId: VERDICT,
          ordinal: 1,
          name: "裁决",
          type: "string",
          state: "filled",
          filledAt: expect.any(Number),
          filledBy: HARNESS_PARENT_SESSION,
          line: 3,
        },
      ]);
      const record = harness.journal.getRun(runId);
      expect(record?.scriptText).toBe(result.scriptText);
      expect(record?.scriptHash).toBe(
        createHash("sha256").update(result.scriptText, "utf8").digest("hex"),
      );
      expect(await harness.service.getScript(runId)).toBe(result.scriptText);
      const filledEvent = harness.runEvents.find((event) => event.eventType === "hole-filled");
      expect(filledEvent?.payload).toMatchObject({
        siteId: VERDICT,
        filledBy: HARNESS_PARENT_SESSION,
        phaseNames: ["准备", "裁决"],
      });
    });
  });

  it("Function body can include phases and subagents: new stations carry hole\'s own prefix layer, phasesAdded lists function body phases", async () => {
    const harness = makeHarness({
      actorScripts: { [`${VERDICT}/actor#1@1`]: [{ kind: "submit", result: { text: "judged" } }] },
    });
    const runId = await submitAndReachHole(harness, "hole-body-phases");
    const result = await fill(
      harness,
      runId,
      [
        'phase("复核");',
        'const j = await agent("judge").ask<{ text: string }>("judge it");',
        "return j.text;",
      ].join("\n"),
    );
    expect(result).toMatchObject({ ok: true, phasesAdded: ["复核"] });
    await settle(harness, runId);
    const done = await harness.service.getTask(runId);
    expect(done?.output).toBe("judged");
    expect(
      harness.runEvents.find((event) => event.eventType === "actor-created")?.payload,
    ).toMatchObject({ actor: { siteId: "actor#1", ordinal: 1 } });
    expect(
      harness.runEvents
        .filter((event) => event.eventType === "actor-created")
        .map((event) => (event.payload.actor as { siteId: string }).siteId),
    ).toEqual(["actor#1", `${VERDICT}/actor#1`]);
    expect(
      harness.runEvents.find((event) => event.eventType === "hole-filled")?.payload,
    ).toMatchObject({ phaseNames: ["准备", "裁决", "复核"] });
  });

  it("函数体里可以跑种子脚本没有的命令：world.run 的授权只在编译期，driver 没有第二份名单", async () => {
    const ran: string[] = [];
    const stream = (text: string) => ({
      text,
      bytes: Buffer.byteLength(text, "utf8"),
      truncated: false,
    });
    const executionPort: ExecutionPort = {
      run: async (request) => {
        ran.push(request.command.mode === "argv" ? request.command.file : request.command.command);
        return {
          status: "completed",
          exitCode: 0,
          stdout: stream("hi\n"),
          stderr: stream(""),
          durationMs: 1,
          timedOut: false,
          cancelled: false,
          startedAt: new Date(0),
          completedAt: new Date(1),
        } as never;
      },
    };
    const harness = makeHarness({ executionPort });
    const runId = await submitAndReachHole(harness, "hole-body-new-command");
    const result = await fill(
      harness,
      runId,
      ['const r = await world.run("echo", ["hi"]);', "return r.stdout.trim();"].join("\n"),
    );
    expect(result).toMatchObject({ ok: true });
    await settle(harness, runId);
    const done = await harness.service.getTask(runId);
    expect(done?.status).toBe("completed");
    expect(done?.output).toBe("hi");
    expect(ran).toEqual(["echo"]);
  });

  it("编不过的函数体是拒绝：诊断落在函数体坐标上，什么都没写，留白照旧在等", async () => {
    const harness = makeHarness();
    const runId = await submitAndReachHole(harness, "hole-diagnostics");
    const before = harness.journal.getRun(runId)?.scriptText;
    const refused = await fill(
      harness,
      runId,
      ['const x: number = "no";', 'return "v";'].join("\n"),
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("expected compile_failed");
    expect(refused.reason).toBe("compile_failed");
    expect(refused.diagnostics).toEqual([
      expect.objectContaining({ inFill: true, line: 1, column: 7, code: 2322 }),
    ]);
    expect(harness.journal.getRun(runId)?.scriptText).toBe(before);
    expect((await harness.service.getTask(runId))?.holes?.[0]?.state).toBe("waiting");
    expect(harness.runEvents.some((event) => event.eventType === "hole-filled")).toBe(false);

    expect(await fill(harness, runId, 'return "v";')).toMatchObject({ ok: true });
    await settle(harness, runId);
  });

  describe("Models named in function body can only come from current run\'s binding table (MR !2837 review CR-01)", () => {
    const LIGHT: ModelSelection = { providerId: "zhipu", modelId: "GLM-5.3-Flash" };
    const judgeBody = (name: string) =>
      [
        `const j = await agent("judge", { model: model(${JSON.stringify(name)}) }).ask<{ text: string }>("judge it");`,
        "return j.text;",
      ].join("\n");

    it("表外的名字是 9011 拒绝：落在函数体坐标上，什么都没写，留白照旧在等", async () => {
      const harness = makeHarness();
      const runId = await submitAndReachHole(harness, "hole-model-unbound", {
        modelBindings: { "GLM-5.3-Flash": LIGHT },
      });
      const before = harness.journal.getRun(runId)?.scriptText;
      const refused = await fill(harness, runId, judgeBody("GLM-5.3$high"));
      if (refused.ok) throw new Error("expected compile_failed");
      expect(refused.reason).toBe("compile_failed");
      expect(refused.diagnostics).toEqual([
        expect.objectContaining({ inFill: true, line: 1, code: 9011 }),
      ]);
      expect(refused.diagnostics?.[0]?.message).toContain('"GLM-5.3$high"');
      expect(refused.diagnostics?.[0]?.message).toContain('"GLM-5.3-Flash" = zhipu/GLM-5.3-Flash');
      expect(harness.journal.getRun(runId)?.scriptText).toBe(before);
      expect((await harness.service.getTask(runId))?.holes?.[0]?.state).toBe("waiting");
      expect(harness.runEvents.some((event) => event.eventType === "hole-filled")).toBe(false);
      expect(harness.actorRuntimeInputs.some((input) => "actorModel" in input)).toBe(false);
    });

    it("run 没点名过任何模型时，函数体点名模型同样被拒", async () => {
      const harness = makeHarness();
      const runId = await submitAndReachHole(harness, "hole-model-no-table");
      const refused = await fill(harness, runId, judgeBody("GLM-5.3-Flash"));
      if (refused.ok) throw new Error("expected compile_failed");
      expect(refused.diagnostics).toEqual([expect.objectContaining({ inFill: true, code: 9011 })]);
      expect(refused.diagnostics?.[0]?.message).toContain("without naming any model");
      expect((await harness.service.getTask(runId))?.holes?.[0]?.state).toBe("waiting");
    });

    it("表里的名字照常接受，子代理跑在绑定的模型上", async () => {
      const harness = makeHarness({
        actorScripts: {
          [`${VERDICT}/actor#1@1`]: [{ kind: "submit", result: { text: "judged" } }],
        },
      });
      const runId = await submitAndReachHole(harness, "hole-model-bound", {
        modelBindings: { "GLM-5.3-Flash": LIGHT },
      });
      expect(await fill(harness, runId, judgeBody("GLM-5.3-Flash"))).toMatchObject({ ok: true });
      await settle(harness, runId);
      expect((await harness.service.getTask(runId))?.output).toBe("judged");
      const judge = harness.actorRuntimeInputs.find(
        (input) => refToString(input.actor) === `${VERDICT}/actor#1@1`,
      );
      expect(judge?.actorModel).toEqual(LIGHT);
    });
  });

  it("不在等的种种：未知 run、未知留白、还没到达、已补过、已停下（指向 ResumeWorkflowRun）", async () => {
    expect(await fill(makeHarness(), "dwfrun-nope", "return 1;")).toMatchObject({
      ok: false,
      reason: "run_not_found",
    });

    const hanging = makeHarness({ hangActors: true });
    const pending = await submitRun(hanging, {
      cwd: TEST_CWD,
      phaseNames: HOLE_PHASES,
      scriptText: HOLE_SCRIPT,
      trace: traceFor("hole-not-reached"),
    });
    await vi.waitFor(() => {
      expect(hanging.runEvents.some((event) => event.eventType === "node-dispatched")).toBe(true);
    });
    const notReached = await fill(hanging, pending, 'return "v";');
    expect(notReached).toMatchObject({ ok: false, reason: "hole_not_waiting" });
    expect((await hanging.service.getTask(pending))?.holes).toBeUndefined();
    await hanging.service.cancel(pending);
    await settle(hanging, pending);

    const harness = makeHarness();
    const runId = await submitAndReachHole(harness, "hole-refusals");
    const unknownHole = await fill(harness, runId, "return 1;", "hole#9");
    expect(unknownHole).toMatchObject({ ok: false, reason: "hole_not_waiting" });
    if (unknownHole.ok) throw new Error("unreachable");
    expect(unknownHole.message).toContain("hole#9");

    expect(await fill(harness, runId, 'return "v";')).toMatchObject({ ok: true });
    const again = await fill(harness, runId, 'return "w";');
    expect(again).toMatchObject({ ok: false, reason: "hole_not_waiting" });
    if (again.ok) throw new Error("unreachable");
    expect(again.message).toContain("already filled");
    await settle(harness, runId);

    const stopped = makeHarness();
    const stoppedRun = await submitAndReachHole(stopped, "hole-stopped");
    await stopped.service.cancel(stoppedRun);
    await settle(stopped, stoppedRun);
    expect((await stopped.service.getTask(stoppedRun))?.status).toBe("cancelled");
    const afterStop = await fill(stopped, stoppedRun, 'return "v";');
    expect(afterStop).toMatchObject({ ok: false, reason: "hole_not_waiting" });
    if (afterStop.ok) throw new Error("unreachable");
    expect(afterStop.message).toContain("ResumeWorkflowRun");
    expect((await stopped.service.getTask(stoppedRun))?.holes).toBeUndefined();
  });

  it("草稿就地改写成有效脚本、路径不变；没有草稿的 run 由注入的铸造器补一份", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dwf-hole-draft-"));
    const draftPath = join(dir, "裁决.dwf.ts");
    await writeFile(draftPath, HOLE_SCRIPT, "utf8");
    const harness = makeHarness();
    const runId = await submitAndReachHole(harness, "hole-draft", { scriptPath: draftPath });
    const result = await fill(harness, runId, 'return "v";');
    if (!result.ok) throw new Error(result.message);
    expect(result.scriptPath).toBe(draftPath);
    expect(await readFile(draftPath, "utf8")).toBe(result.scriptText);
    expect((await harness.service.getTask(runId))?.scriptPath).toBe(draftPath);
    await settle(harness, runId);

    await withSqliteJournal(async (journal) => {
      const minted: { cwd: string; name: string; source: string }[] = [];
      const mintPath = join(dir, "minted.dwf.ts");
      const minting = makeHarness({
        journal,
        writeWorkflowDraft: async (input) => {
          minted.push(input);
          return { path: mintPath };
        },
      });
      const draftless = await submitAndReachHole(minting, "hole-mint", { name: "夜间审阅" });
      const mintedResult = await fill(minting, draftless, 'return "v";');
      if (!mintedResult.ok) throw new Error(mintedResult.message);
      expect(mintedResult.scriptPath).toBe(mintPath);
      expect(minted).toEqual([
        { cwd: TEST_CWD, name: "夜间审阅", source: mintedResult.scriptText },
      ]);
      expect((await minting.service.getTask(draftless))?.scriptPath).toBe(mintPath);
      expect(
        minting.runEvents.find((event) => event.eventType === "hole-filled")?.payload,
      ).toMatchObject({ siteId: VERDICT, scriptPath: mintPath });
      await settle(minting, draftless);
      const cold = makeHarness({ journal });
      expect((await cold.service.getTask(draftless))?.scriptPath).toBe(mintPath);
      expect((await cold.service.getRunDetail?.(draftless))?.scriptPath).toBe(mintPath);
    });
    await rm(dir, { recursive: true, force: true });
  });

  
  const TWO_HOLES_SCRIPT = [
    'phase("准备");',
    "const left = future(async () => {",
    '  const a = await agent("l").ask<{ text: string }>("left");',
    '  return await hole<string>("左", `l ${a.text}`);',
    "});",
    "const right = future(async () => {",
    '  const b = await agent("r").ask<{ text: string }>("right");',
    '  return await hole<string>("右", `r ${b.text}`);',
    "});",
    "const [x, y] = await Promise.all([left, right]);",
    'return x + "+" + y;',
  ].join("\n");

  async function submitAndReachBothHoles(harness: Harness, name: string): Promise<string> {
    const runId = await submitRun(harness, {
      cwd: TEST_CWD,
      parentSessionId: HARNESS_PARENT_SESSION,
      phaseNames: ["准备", "左", "右"],
      scriptText: TWO_HOLES_SCRIPT,
      trace: traceFor(name),
    });
    await vi.waitFor(() => {
      expect(
        harness.runEvents.filter(
          (event) => event.runId === runId && event.eventType === "hole-reached",
        ),
      ).toHaveLength(2);
    });
    return runId;
  }

  it("Two concurrent completions for the same run execute serially: the journal\'s valid script carries both function bodies simultaneously, and both branches complete", async () => {
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({ journal });
      const runId = await submitAndReachBothHoles(harness, "hole-concurrent");
      expect((await harness.service.getTask(runId))?.holes?.map((hole) => hole.state)).toEqual([
        "waiting",
        "waiting",
      ]);
      const [first, second] = await Promise.all([
        fill(harness, runId, 'return "L";', LEFT),
        fill(harness, runId, 'return "R";', RIGHT),
      ]);
      expect(first).toMatchObject({ ok: true });
      expect(second).toMatchObject({ ok: true });
      if (!second.ok || !first.ok) throw new Error("unreachable");
      expect(second.scriptText).toContain('hole<string>("左", `l ${a.text}`, async () => {');
      expect(second.scriptText).toContain('hole<string>("右", `r ${b.text}`, async () => {');
      expect(second.scriptText).toContain('return "L";');
      expect(second.scriptText).toContain('return "R";');
      const record = journal.getRun(runId);
      expect(record?.scriptText).toBe(second.scriptText);
      expect(record?.scriptHash).toBe(
        createHash("sha256").update(second.scriptText, "utf8").digest("hex"),
      );
      await settle(harness, runId);
      const done = await harness.service.getTask(runId);
      expect(done?.status).toBe("completed");
      expect(done?.output).toBe("L+R");
      expect(done?.holes?.map((hole) => [hole.siteId, hole.state])).toEqual([
        [LEFT, "filled"],
        [RIGHT, "filled"],
      ]);
      expect(
        harness.runEvents
          .filter((event) => event.eventType === "hole-filled")
          .map((event) => event.payload.siteId),
      ).toEqual([LEFT, RIGHT]);
    });
  });

  it("被拒绝的第一次补全不阻塞排在它后面的第二次", async () => {
    const harness = makeHarness();
    const runId = await submitAndReachBothHoles(harness, "hole-refused-first");
    const [refused, accepted] = await Promise.all([
      fill(harness, runId, "return 1;", LEFT),
      fill(harness, runId, 'return "R";', RIGHT),
    ]);
    expect(refused).toMatchObject({ ok: false, reason: "compile_failed" });
    expect(accepted).toMatchObject({ ok: true });
    if (!accepted.ok) throw new Error("unreachable");
    expect(accepted.scriptText).not.toContain("return 1;");
    expect(accepted.scriptText).toContain('return "R";');
    expect(
      (await harness.service.getTask(runId))?.holes?.map((hole) => [hole.siteId, hole.state]),
    ).toEqual([
      [LEFT, "waiting"],
      [RIGHT, "filled"],
    ]);
    const retried = await fill(harness, runId, 'return "L";', LEFT);
    expect(retried).toMatchObject({ ok: true });
    if (!retried.ok) throw new Error("unreachable");
    expect(retried.scriptText).toContain('return "R";');
    await settle(harness, runId);
    expect((await harness.service.getTask(runId))?.output).toBe("L+R");
  });

  it("递归补全：外层函数体里再开一处留白，内层体读到外层体与留白之前的绑定；两次补全都就地改写草稿；停下后 resume 不再请求任何留白", async () => {
    const NESTED_SCRIPT = [
      "interface Plan { step: string }",
      'phase("探索");',
      'const seed = await agent("scout").ask<{ text: string }>("scout it");',
      'const plan = await hole<Plan>("决定", `plan for ${seed.text}`);',
      'phase("执行");',
      'const done = await agent("worker").ask<{ text: string }>(`execute ${plan.step}`);',
      "return done.text;",
    ].join("\n");
    const dir = await mkdtemp(join(tmpdir(), "dwf-hole-nested-"));
    const draftPath = join(dir, "决定.dwf.ts");
    await writeFile(draftPath, NESTED_SCRIPT, "utf8");
    const workerPlan: ActorPlan[] = [{ kind: "hang-until-cancelled" }];
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({
        journal,
        actorScripts: {
          "actor#1@1": [{ kind: "submit", result: { text: "seed" } }],
          [`${DECIDE}/actor#1@1`]: [{ kind: "submit", result: { text: "draft" } }],
          "actor#2@1": workerPlan,
        },
      });
      const runId = await submitRun(harness, {
        cwd: TEST_CWD,
        parentSessionId: HARNESS_PARENT_SESSION,
        phaseNames: ["探索", "决定", "执行"],
        scriptPath: draftPath,
        scriptText: NESTED_SCRIPT,
        trace: traceFor("hole-nested"),
      });
      const reachedIds = () =>
        harness.runEvents
          .filter((event) => event.runId === runId && event.eventType === "hole-reached")
          .map((event) => (event.payload.instance as { siteId: string }).siteId);
      await vi.waitFor(() => expect(reachedIds()).toEqual([DECIDE]));

      const outer = await fill(
        harness,
        runId,
        [
          'phase("初步");',
          'const draft = await agent("drafter").ask<{ text: string }>("draft it");',
          "const x = draft.text;",
          'return await hole<Plan>("细化", `refine ${x}`);',
        ].join("\n"),
        DECIDE,
      );
      if (!outer.ok) throw new Error(outer.message);
      expect(outer.phasesAdded).toEqual(["初步", "细化"]);
      expect(outer.scriptPath).toBe(draftPath);
      expect(await readFile(draftPath, "utf8")).toBe(outer.scriptText);

      await vi.waitFor(() => expect(reachedIds()).toEqual([DECIDE, REFINE]));
      const nestedReached = harness.runEvents.find(
        (event) =>
          event.eventType === "hole-reached" &&
          reachedIds().length === 2 &&
          (event.payload.instance as { siteId: string }).siteId === REFINE,
      );
      expect(nestedReached?.payload).toMatchObject({
        name: "细化",
        prompt: "refine draft",
        type: "Plan",
        reachedAt: expect.any(Number),
      });
      const parked = await harness.service.getTask(runId);
      expect(parked?.holes).toEqual([
        expect.objectContaining({
          siteId: DECIDE,
          state: "filled",
          filledBy: HARNESS_PARENT_SESSION,
        }),
        expect.objectContaining({
          siteId: REFINE,
          ordinal: 1,
          name: "细化",
          type: "Plan",
          state: "waiting",
          before: "初步",
          after: "执行",
        }),
      ]);
      expect(
        harness.runEvents.find((event) => event.eventType === "hole-filled")?.payload,
      ).toMatchObject({
        siteId: DECIDE,
        phaseNames: ["探索", "决定", "初步", "细化", "执行"],
        holes: [3],
      });

      const inner = await fill(harness, runId, "return { step: `${seed.text}/${x}` };", REFINE);
      if (!inner.ok) throw new Error(inner.message);
      expect(inner.phasesAdded).toEqual([]);
      expect(inner.scriptPath).toBe(draftPath);
      expect(await readFile(draftPath, "utf8")).toBe(inner.scriptText);
      expect(inner.scriptText).toContain('hole<Plan>("细化", `refine ${x}`, async () => {');
      expect(inner.scriptText).toContain("return { step: `${seed.text}/${x}` };");
      const record = journal.getRun(runId);
      expect(record?.scriptText).toBe(inner.scriptText);
      expect(record?.scriptHash).toBe(
        createHash("sha256").update(inner.scriptText, "utf8").digest("hex"),
      );
      expect((await harness.service.getTask(runId))?.holes?.map((hole) => hole.state)).toEqual([
        "filled",
        "filled",
      ]);

      await vi.waitFor(() => {
        expect(harness.actorModelRequests["actor#2@1"]?.requests.length ?? 0).toBeGreaterThan(0);
      });
      expect(
        JSON.stringify(harness.actorModelRequests["actor#2@1"]?.requests[0]?.messages),
      ).toContain("execute seed/draft");

      await harness.service.cancel(runId);
      await settle(harness, runId);
      expect((await harness.service.getTask(runId))?.status).toBe("cancelled");
      workerPlan.splice(0, workerPlan.length, { kind: "submit", result: { text: "shipped" } });
      const eventsBeforeResume = harness.runEvents.length;
      const resumed = await harness.service.resume(runId);
      expect(resumed).toMatchObject({ ok: true, runId });
      await settle(harness, runId);
      const secondLife = harness.runEvents.slice(eventsBeforeResume);
      expect(secondLife.some((event) => event.eventType === "hole-reached")).toBe(false);
      const finished = await harness.service.getTask(runId);
      expect(finished?.status).toBe("completed");
      expect(finished?.output).toBe("shipped");
      expect(finished?.scriptPath).toBe(draftPath);
      expect(
        JSON.stringify(harness.actorModelRequests["actor#2@1"]?.requests.at(-1)?.messages),
      ).toContain("execute seed/draft");
    });
    await rm(dir, { recursive: true, force: true });
  });

  it("十步的尾巴留白接龙跑到完成：每一步一个名字键 id，深度不进 id，所有 id 都在 64 字符以内", async () => {
    const STEPS = 10;
    const stepName = (k: number) => `第${k}步`;
    const SEED = [
      'phase("起步");',
      'const seed = await agent("勘察员").ask<{ text: string }>("look");',
      `return await hole<string>("${stepName(1)}", \`from \${seed.text}\`);`,
    ].join("\n");
    const last = holeSiteId(stepName(STEPS));
    await withSqliteJournal(async (journal) => {
      const harness = makeHarness({
        journal,
        actorScripts: {
          "actor#1@1": [{ kind: "submit", result: { text: "seed" } }],
          [`${last}/actor#1@1`]: [{ kind: "submit", result: { text: "shipped" } }],
        },
      });
      const runId = await submitRun(harness, {
        cwd: TEST_CWD,
        parentSessionId: HARNESS_PARENT_SESSION,
        phaseNames: ["起步", stepName(1)],
        scriptText: SEED,
        trace: traceFor("hole-chain-ten"),
      });
      const reached = () =>
        harness.runEvents
          .filter((event) => event.runId === runId && event.eventType === "hole-reached")
          .map((event) => (event.payload.instance as { siteId: string }).siteId);
      for (let k = 1; k <= STEPS; k += 1) {
        const id = holeSiteId(stepName(k));
        await vi.waitFor(() => expect(reached()).toContain(id));
        const body =
          k === STEPS
            ? 'const done = await agent("收尾").ask<{ text: string }>(`finish ${seed.text}`);\nreturn done.text;'
            : `return await hole<string>("${stepName(k + 1)}", "progress ${k}");`;
        const result = await fill(harness, runId, body, id);
        if (!result.ok) throw new Error(`step ${k}: ${result.message}`);
      }
      await settle(harness, runId);
      const done = await harness.service.getTask(runId);
      expect(done?.status).toBe("completed");
      expect(done?.output).toBe("shipped");

      expect(reached()).toEqual(
        Array.from({ length: STEPS }, (_, i) => holeSiteId(stepName(i + 1))),
      );
      const actorIds = harness.runEvents
        .filter((event) => event.eventType === "actor-created")
        .map((event) => (event.payload.actor as { siteId: string }).siteId);
      expect(actorIds).toEqual(["actor#1", `${last}/actor#1`]);
      for (const id of [...reached(), ...actorIds]) expect(id.length, id).toBeLessThanOrEqual(64);
      expect(Math.max(...[...reached(), ...actorIds].map((id) => id.length))).toBe(
        `${last}/actor#1`.length,
      );
      expect(done?.holes?.map((hole) => [hole.siteId, hole.state])).toEqual(
        Array.from({ length: STEPS }, (_, i) => [holeSiteId(stepName(i + 1)), "filled"]),
      );
      const lastFilled = harness.runEvents
        .filter((event) => event.eventType === "hole-filled")
        .at(-1);
      expect(lastFilled?.payload.phaseNames).toEqual([
        "起步",
        ...Array.from({ length: STEPS }, (_, i) => stepName(i + 1)),
      ]);
    });
  });

  it("冷回放为 hole-reached 铸出与 live 逐字节相同的载荷（type 从行里的有效脚本重建）", async () => {
    const harness = makeHarness();
    const runId = await submitAndReachHole(harness, "hole-replay");
    expect(await fill(harness, runId, 'return "v";')).toMatchObject({ ok: true });
    await settle(harness, runId);
    const live = harness.runEvents.filter(
      (event) => event.eventType === "hole-reached" || event.eventType === "hole-filled",
    );
    const row = (harness.journal as SweepableJournalStore)
      .listRunsByParentSession(HARNESS_PARENT_SESSION, 16)
      .find((item) => item.runId === runId);
    const replayed = replayRunProgress(
      row!,
      harness.journal,
      resolveWorkflowDefaultConcurrency(),
    ).filter((event) => event.eventType === "hole-reached" || event.eventType === "hole-filled");
    expect(replayed).toEqual(live);
  });
});
