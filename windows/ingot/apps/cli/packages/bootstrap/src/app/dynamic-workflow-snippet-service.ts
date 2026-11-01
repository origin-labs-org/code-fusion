// ============================================================
// ============================================================
//

import { randomUUID } from "node:crypto";
import type {
  DynamicWorkflowSnippetEvalOptions,
  DynamicWorkflowSnippetEvalRequest,
  DynamicWorkflowSnippetEvalResult,
  DynamicWorkflowSnippetPort,
  ExecutionPort,
  FileSystemPort,
  Logger,
} from "@origin-ai/cf-contracts";
import {
  buildAskSpecs,
  collectDiagnostics,
  collectSites,
  collectWorldRunCommands,
  createWorkflowProgram,
  InMemoryJournalStore,
  lowerWorkflow,
  SNIPPET_FACADE_DTS,
  validate,
  WorkflowError,
  type Caps,
  type JsonSchema,
  type RunEvent,
  type ValidateFn,
  type WorkflowDriver,
} from "@origin-ai/cf-dynamic-workflow";
import { runWorkflowScript } from "@origin-ai/cf-dynamic-workflow-runtime";
import { dynamicWorkflowChildSpawn } from "./dynamic-workflow-run-launch.js";
import { resolveWorkflowDefaultConcurrency } from "./workflow-default-concurrency.js";
import { executeWorldRead, type WorldReadDeps } from "./workflow-world-read.js";

const MAX_LOGS = 100;
const MAX_LOG_CHARS = 2_048;

const MAX_ARTIFACT_BYTES = 256 * 1024;

const validateFn: ValidateFn = (schema, value) => validate(schema as JsonSchema, value);

interface DynamicWorkflowSnippetServiceDeps {
  
  fileSystemPort: FileSystemPort;
  
  executionPort: ExecutionPort;
  logger?: Logger;
  
  availableParallelism?: () => number;
}

export function createDynamicWorkflowSnippetService(
  deps: DynamicWorkflowSnippetServiceDeps,
): DynamicWorkflowSnippetPort {
  const caps = (): Caps => {
    return {
      maxConcurrency: resolveWorkflowDefaultConcurrency(deps.availableParallelism),
    };
  };

  return {
    async evalSnippet(
      request: DynamicWorkflowSnippetEvalRequest,
      options?: DynamicWorkflowSnippetEvalOptions,
    ): Promise<DynamicWorkflowSnippetEvalResult> {
      const workflow = createWorkflowProgram(request.code, { facadeDts: SNIPPET_FACADE_DTS });
      const diagnostics = collectDiagnostics(workflow.program);
      if (diagnostics.length > 0) {
        return { kind: "diagnostics", diagnostics };
      }

      const table = collectSites(workflow);
      const worldRun = collectWorldRunCommands(workflow, table);
      if (worldRun.diagnostics.length > 0) {
        return { kind: "diagnostics", diagnostics: worldRun.diagnostics };
      }
      const lowered = lowerWorkflow(workflow, table);
      const askSpecs = buildAskSpecs(table, {});

      const logs: string[] = [];
      let logsTruncated = false;
      const captureLog = (event: RunEvent): void => {
        if (event.type !== "log") return;
        if (logs.length >= MAX_LOGS) {
          logsTruncated = true;
          return;
        }
        const message = event.message;
        if (message.length > MAX_LOG_CHARS) {
          logs.push(message.slice(0, MAX_LOG_CHARS));
          logsTruncated = true;
          return;
        }
        logs.push(message);
      };

      const worldReadDeps: WorldReadDeps = {
        fileSystemPort: deps.fileSystemPort,
        executionPort: deps.executionPort,
        cwd: request.cwd,
      };
      const runId = `dwfeval-${randomUUID()}`;
      const childSpawn = dynamicWorkflowChildSpawn();

      const settlement = await runWorkflowScript({
        askSpecs,
        caps: caps(),
        ...(childSpawn === undefined ? {} : { childSpawn }),
        cwd: request.cwd,
        lowered: lowered.code,
        makeDriver: () => createSnippetDriver(worldReadDeps, captureLog),
        onWarning: (warning) => {
          deps.logger?.warn?.("Dynamic workflow entry file fell back to the OS temp dir", {
            event: "dynamic_workflow.entry_file.fallback",
            module: "bootstrap.app",
            runId,
            ...warning,
          });
        },
        runId,
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
        timeoutMs: request.timeoutMs,
        validate: validateFn,
      });

      deps.logger?.debug?.("Dynamic workflow snippet settled", {
        event: "dynamic_workflow.snippet.settled",
        module: "bootstrap.app",
        runId,
        runStatus: settlement.status,
        traceId: request.trace.traceId,
      });

      if (settlement.status === "completed") {
        const oversize = artifactOversize(settlement.artifact);
        if (oversize !== undefined) {
          return {
            kind: "failed",
            error: {
              code: "ArtifactTooLarge",
              message:
                `The snippet's return value serializes to ${oversize} bytes, over the cap of ` +
                `${MAX_ARTIFACT_BYTES} bytes. Return a summary (a count, the first few items) and ` +
                `leave the full data to log() or to the real run.`,
            },
            logs,
            logsTruncated,
          };
        }
        return {
          kind: "completed",
          ...(settlement.artifact === undefined ? {} : { artifact: settlement.artifact }),
          logs,
          logsTruncated,
        };
      }

      if (settlement.status === "errored") {
        return {
          kind: "failed",
          error: { code: settlement.error.code, message: settlement.error.message },
          logs,
          logsTruncated,
        };
      }

      return {
        kind: "failed",
        error:
          settlement.error === undefined
            ? { code: "Cancelled", message: "snippet evaluation was cancelled" }
            : { code: settlement.error.code, message: settlement.error.message },
        logs,
        logsTruncated,
      };
    },
  };
}

function artifactOversize(artifact: unknown): number | undefined {
  if (artifact === undefined) return undefined;
  const bytes = Buffer.byteLength(JSON.stringify(artifact), "utf8");
  return bytes > MAX_ARTIFACT_BYTES ? bytes : undefined;
}

function createSnippetDriver(
  worldReadDeps: WorldReadDeps,
  onEvent: (event: RunEvent) => void,
): WorkflowDriver {
  const askUnreachable = (member: string): WorkflowError =>
    new WorkflowError(
      "DriverError",
      `Snippet driver received ${member}, but the scratch facade has no agent(), so the ask ` +
        `path must be unreachable. This is a wiring bug.`,
    );
  return {
    createActorSession: () => Promise.reject(askUnreachable("createActorSession")),
    startAsk: () => {
      throw askUnreachable("startAsk");
    },
    respondToSubmit: () => {
      throw askUnreachable("respondToSubmit");
    },
    cancelAsk: () => {
    },
    executeWorldRead: (op, args) => executeWorldRead(worldReadDeps, op, args),
    journal: new InMemoryJournalStore(),
    emit: onEvent,
  };
}
