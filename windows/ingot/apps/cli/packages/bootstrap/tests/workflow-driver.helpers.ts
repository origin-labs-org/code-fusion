import { createTestAgentRuntime } from "./helpers/test-agent-runtime.js";

import { createInMemorySessionEventStore } from "@origin-ai/cf-adapters/storage";
import {
  SUBMIT_RESULT_TOOL_NAME,
  type ExecutionPort,
  type FileSystemPort,
  type SessionStorePort,
} from "@origin-ai/cf-contracts";
import { AgentRuntime } from "@origin-ai/cf-core";
import {
  InMemoryJournalStore,
  buildAskSpecs,
  collectSites,
  createWorkflowProgram,
  deriveActorSubmitProfilesFor,
  refToString,
  synthesizeAskSchemas,
  validate,
  type ActorSubmitProfile,
  type AskSpec,
  type Caps,
  type JsonSchema,
  type RunEvent,
  type RunSettlement,
  type ValidateFn,
} from "@origin-ai/cf-dynamic-workflow";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWorkflowScript } from "@origin-ai/cf-dynamic-workflow-runtime";
import { workflowActorToolPolicy } from "../src/app/workflow-actor-tools.js";
import {
  createWorkflowEscalationRegistry,
  type WorkflowEscalationRegistry,
} from "../src/app/workflow-escalation-registry.js";
import {
  createAgentRuntimeWorkflowDriver,
  type ActorRuntimeFactory,
} from "../src/app/workflow-driver.js";
import type { AgentRuntimeWorkflowDriverDeps } from "../src/app/workflow-driver-types.js";
import type { WorkflowConcurrencyPort } from "../src/app/workflow-concurrency-governor.js";

const TEST_CWD: string = mkdtempSync(join(tmpdir(), "dwf-bootstrap-test-cwd-"));

const validateFn: ValidateFn = (schema, value) => validate(schema as JsonSchema, value);

function askSpecsFor(scriptText: string): Map<string, AskSpec> {
  const workflow = createWorkflowProgram(scriptText);
  const table = collectSites(workflow);
  const { schemas } = synthesizeAskSchemas(workflow, table);
  return buildAskSpecs(table, schemas);
}

export function actorSubmitProfilesFor(scriptText: string): Map<string, ActorSubmitProfile> {
  const workflow = createWorkflowProgram(scriptText);
  const table = collectSites(workflow);
  const { schemas } = synthesizeAskSchemas(workflow, table);
  return deriveActorSubmitProfilesFor(workflow, table, buildAskSpecs(table, schemas));
}

export type PlannedResponse =
  | { kind: "submit"; result: unknown }
  | { kind: "text"; text: string }
  | { kind: "hang" };

interface ModelCallLog {
  calls: number;
  
  toolNames: string[][];
  
  prompts: string[];
  
  submitTools: ({ inputSchema: unknown; strict: boolean | undefined } | undefined)[];
}

function lastUserPrompt(request: unknown): string {
  const messages = (request as { messages?: unknown[] } | undefined)?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as { role?: unknown; content?: unknown };
    if (message?.role !== "user") continue;
    const content = message.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("");
    }
    return "";
  }
  return "";
}

function scriptedModelAdapter(responses: PlannedResponse[], log: ModelCallLog): unknown {
  let index = 0;
  return {
    async generateText(request?: {
      tools?: readonly { name: string; inputSchema?: unknown; strict?: boolean }[];
    }) {
      log.calls++;
      log.toolNames.push((request?.tools ?? []).map((tool) => tool.name));
      log.prompts.push(lastUserPrompt(request));
      const submit = (request?.tools ?? []).find((tool) => tool.name === SUBMIT_RESULT_TOOL_NAME);
      log.submitTools.push(
        submit === undefined
          ? undefined
          : { inputSchema: submit.inputSchema, strict: submit.strict },
      );
      const planned = responses[index++] ?? { kind: "text", text: "(no further scripted response)" };
      if (planned.kind === "hang") return new Promise(() => {});
      const usage = { inputTokens: 12, outputTokens: 8, totalTokens: 20 };
      if (planned.kind === "submit") {
        return {
          finishReason: "tool-calls",
          model: "scripted",
          providerMetadata: undefined,
          text: "",
          toolCalls: [
            { id: `submit-call-${index}`, name: SUBMIT_RESULT_TOOL_NAME, input: { result: planned.result } },
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

export function fakeFileSystemPort(files: {
  glob?: string[];
  read?: string;
}): FileSystemPort {
  const unsupported = (name: string) => () => {
    throw new Error(`fakeFileSystemPort.${name} 不应被 world-read 触及`);
  };
  return {
    async searchFiles(request: { path: string; pattern: string }) {
      const list = files.glob ?? [];
      return { path: request.path, pattern: request.pattern, durationMs: 0, files: list, numFiles: list.length, truncated: false };
    },
    async readTextFile(request: { path: string }) {
      return {
        path: request.path,
        content: files.read ?? "",
        encoding: "utf-8",
        bytesRead: (files.read ?? "").length,
        sizeBytes: (files.read ?? "").length,
        truncated: false,
      };
    },
    createDirectory: unsupported("createDirectory"),
    stat: unsupported("stat"),
    readBinaryFile: unsupported("readBinaryFile"),
    readTextFileRange: unsupported("readTextFileRange"),
    writeTextFile: unsupported("writeTextFile"),
    removeFile: unsupported("removeFile"),
    listDirectory: unsupported("listDirectory"),
    searchText: unsupported("searchText"),
  } as unknown as FileSystemPort;
}

interface RunDriverScriptOptions {
  
  actorScripts: Record<string, PlannedResponse[]>;
  caps?: Caps;
  timeoutMs?: number;
  journal?: InMemoryJournalStore;
  files?: { glob?: string[]; read?: string };
  runId?: string;
  
  runtimeFactory?: ActorRuntimeFactory;
  
  sessionStore?: SessionStorePort;
  
  escalationRegistry?: WorkflowEscalationRegistry;
  
  onRuntimeCreated?: (runtime: AgentRuntime, actorKey: string) => void;
  
  actorSubmitProfiles?: "derive" | ReadonlyMap<string, ActorSubmitProfile>;
  
  concurrency?: WorkflowConcurrencyPort;
  
  clock?: AgentRuntimeWorkflowDriverDeps["clock"];
}

interface RunDriverScriptResult {
  settlement: RunSettlement;
  journal: InMemoryJournalStore;
  events: RunEvent[];
  
  modelCalls: Record<string, ModelCallLog>;
  
  escalationRegistry: WorkflowEscalationRegistry;
}

const DEFAULT_CAPS: Caps = { maxConcurrency: 16 };

export function unsupportedExecutionPort(): ExecutionPort {
  return {
    run: () => {
      throw new Error("本用例不应触及 ExecutionPort（git.* world-read）");
    },
  };
}

export async function runDriverScript(
  scriptText: string,
  opts: RunDriverScriptOptions,
): Promise<RunDriverScriptResult> {
  const journal = opts.journal ?? new InMemoryJournalStore();
  const events: RunEvent[] = [];
  const modelCalls: Record<string, ModelCallLog> = {};
  const fileSystemPort = fakeFileSystemPort(opts.files ?? {});
  const escalationRegistry = opts.escalationRegistry ?? createWorkflowEscalationRegistry();

  const makeDriver = createAgentRuntimeWorkflowDriver({
    journal,
    emit: (event) => events.push(event),
    executionPort: unsupportedExecutionPort(),
    escalationRegistry,
    fileSystemPort,
    cwd: process.cwd(),
    runId: opts.runId ?? "run",
    ...(opts.sessionStore === undefined ? {} : { actorTranscriptStore: opts.sessionStore }),
    ...(opts.actorSubmitProfiles === undefined
      ? {}
      : {
          actorSubmitProfiles:
            opts.actorSubmitProfiles === "derive"
              ? actorSubmitProfilesFor(scriptText)
              : opts.actorSubmitProfiles,
        }),
    ...(opts.concurrency === undefined ? {} : { concurrency: opts.concurrency }),
    ...(opts.clock === undefined ? {} : { clock: opts.clock }),
    runtimeFactory:
      opts.runtimeFactory ??
      (async ({ sessionId, actor, persona, submitPort, submitProfile }) => {
      const key = refToString(actor);
      const log: ModelCallLog = { calls: 0, toolNames: [], prompts: [], submitTools: [] };
      modelCalls[key] = log;
      const responses = opts.actorScripts[key] ?? [];
      const runtime = createTestAgentRuntime(
        sessionId,
        {
          systemPrompt: persona.system ?? "You are a workflow actor.",
          mode: "yolo",
          taskType: "workflow_child",
          subagents: { enabled: false },
          ...workflowActorToolPolicy(),
        },
        {
          eventStore: createInMemorySessionEventStore(),
          modelAdapter: scriptedModelAdapter(responses, log) as never,
          ...(submitProfile.kind === "untyped" ? {} : { workflowSubmitPort: submitPort }),
          ...(submitProfile.kind === "mono" ? { workflowSubmitSchema: { ...submitProfile.schema } } : {}),
          fileSystemPort,
          ...(opts.sessionStore === undefined ? {} : { sessionStore: opts.sessionStore }),
        },
      );
      if (opts.sessionStore !== undefined) {
        await runtime.ensureSessionPersistedForExternalActivity(`workflow actor ${key}`);
      }
      opts.onRuntimeCreated?.(runtime, key);
      return runtime;
    }),
  });

  const settlement = await runWorkflowScript({
    scriptText,
    cwd: TEST_CWD,
    runId: opts.runId ?? "run",
    caps: opts.caps ?? DEFAULT_CAPS,
    askSpecs: askSpecsFor(scriptText),
    validate: validateFn,
    makeDriver,
    timeoutMs: opts.timeoutMs ?? 30000,
  });

  return { settlement, journal, events, modelCalls, escalationRegistry };
}
