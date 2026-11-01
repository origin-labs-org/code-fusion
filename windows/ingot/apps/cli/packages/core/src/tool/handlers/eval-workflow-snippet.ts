// ============================================================
// EvalWorkflowSnippet Tool Handler
// ============================================================
// （prepareApproval）。
//

import {
  EVAL_WORKFLOW_SNIPPET_DEFAULT_TIMEOUT_MS,
  EVAL_WORKFLOW_SNIPPET_SOURCE_ERROR,
  EVAL_WORKFLOW_SNIPPET_TOOL_NAME,
  EvalWorkflowSnippetInputJsonSchema,
  EvalWorkflowSnippetInputSchema,
  EvalWorkflowSnippetOutputJsonSchema,
  EvalWorkflowSnippetOutputSchema,
  serializeWorkflowArtifact,
  type EvalWorkflowSnippetInput,
  type EvalWorkflowSnippetOutput,
  type ModelMessageContent,
  type TraceContext,
} from "@origin-ai/cf-contracts";
import {
  collectDiagnostics,
  collectSites,
  collectWorldRunCommands,
  createWorkflowProgram,
  SNIPPET_FACADE_DTS,
} from "@origin-ai/cf-dynamic-workflow";
import type {
  ToolApprovalGate,
  ToolEntry,
  ToolExecutionContext,
  ToolHandler,
  ToolInputResolutionResult,
  ToolInputValidationResult,
} from "../types.js";
import { EVAL_WORKFLOW_SNIPPET_TOOL_DESCRIPTION } from "./eval-workflow-snippet-description.js";
import { readWorkflowScriptFile } from "./workflow-path-source.js";
import { formatWorkflowDiagnosticLines } from "./workflow-script-notes.js";
import { describeWorkflowScriptPath } from "./workflow-script-path.js";
import { requireDynamicWorkflowSkill } from "./workflow-skill-gate.js";

const EVAL_WORKFLOW_SNIPPET_TOOL_TIMEOUT_MS = 660_000;
const EVAL_WORKFLOW_SNIPPET_MODEL_BYTES = 24_000;

const NOT_EXECUTED_NOTE = "NOTE: The snippet was NOT executed — fix the errors above and call the tool again.";
const UNAVAILABLE_NOTE =
  "NOTE: The snippet was NOT executed — snippet evaluation is not available in this session.";

const EVAL_WORKFLOW_SNIPPET_FAILURE_CODE = 400;

function validateEvalWorkflowSnippetInput(input: unknown): ToolInputValidationResult {
  const parsed = EvalWorkflowSnippetInputSchema.safeParse(input);
  if (!parsed.success) return { result: true };
  const hasCode = parsed.data.code !== undefined;
  const hasPath = parsed.data.path !== undefined;
  if (hasCode === hasPath) {
    return {
      result: false,
      errorCode: EVAL_WORKFLOW_SNIPPET_FAILURE_CODE,
      message: EVAL_WORKFLOW_SNIPPET_SOURCE_ERROR,
    };
  }
  return { result: true };
}

async function resolveEvalWorkflowSnippetInput(
  input: unknown,
  cwd: string,
): Promise<ToolInputResolutionResult> {
  const parsed = EvalWorkflowSnippetInputSchema.safeParse(input);
  if (!parsed.success || parsed.data.path === undefined) return { result: true, input };
  const read = await readWorkflowScriptFile({
    cwd,
    inputPath: parsed.data.path,
    parseFrontmatter: false,
  });
  if (!read.ok) {
    return { result: false, errorCode: EVAL_WORKFLOW_SNIPPET_FAILURE_CODE, message: read.message };
  }
  return {
    result: true,
    input: {
      ...parsed.data,
      code: read.file.source,
      path: read.file.path,
    } satisfies EvalWorkflowSnippetInput,
  };
}

const evalWorkflowSnippetHandler: ToolHandler = async (input, context) => {
  const parsed = EvalWorkflowSnippetInputSchema.parse(input) as EvalWorkflowSnippetInput;
  const code = parsed.code;
  if (code === undefined) {
    throw new Error("EvalWorkflowSnippet handler received input without resolved code");
  }
  const location =
    parsed.path === undefined
      ? undefined
      : {
          kind: "path" as const,
          described: describeWorkflowScriptPath(parsed.path, context.workingDirectory),
          lineOffset: 0,
        };
  const startedAt = Date.now();

  const port = context.dynamicWorkflowSnippetPort;
  if (port === undefined) {
    return {
      ok: false,
      diagnostics: [],
      logs: [],
      response: UNAVAILABLE_NOTE,
      durationMs: 0,
    } satisfies EvalWorkflowSnippetOutput;
  }

  const result = await port.evalSnippet(
    {
      code,
      cwd: context.workingDirectory,
      timeoutMs: parsed.timeoutMs ?? EVAL_WORKFLOW_SNIPPET_DEFAULT_TIMEOUT_MS,
      trace: resolveTraceContext(context),
    },
    { signal: context.abortSignal },
  );
  const durationMs = Math.max(0, Date.now() - startedAt);

  if (result.kind === "diagnostics") {
    return {
      ok: false,
      diagnostics: result.diagnostics,
      logs: [],
      response: [
        "The snippet has errors:",
        ...formatWorkflowDiagnosticLines(result.diagnostics, location),
        "",
        NOT_EXECUTED_NOTE,
      ].join("\n"),
      durationMs,
    } satisfies EvalWorkflowSnippetOutput;
  }

  const logsSection = renderLogs(result.logs, result.logsTruncated);

  if (result.kind === "failed") {
    return {
      ok: false,
      diagnostics: [],
      logs: result.logs,
      response: [
        `The snippet failed (${result.error.code}): ${result.error.message}`,
        ...logsSection,
      ].join("\n"),
      durationMs,
    } satisfies EvalWorkflowSnippetOutput;
  }

  const serialized = serializeWorkflowArtifact(result.artifact);
  return {
    ok: true,
    diagnostics: [],
    logs: result.logs,
    response: [
      `The snippet completed in ${durationMs}ms.`,
      serialized === undefined ? "It returned no value." : `Return value:\n${serialized}`,
      ...logsSection,
    ].join("\n"),
    durationMs,
  } satisfies EvalWorkflowSnippetOutput;
};

function renderLogs(logs: string[], truncated: boolean): string[] {
  if (logs.length === 0) return [];
  return [
    "",
    "Logs:",
    ...logs.map((message) => `- ${message}`),
    ...(truncated ? ["- … (logs truncated)"] : []),
  ];
}

function resolveTraceContext(context: ToolExecutionContext): TraceContext {
  return (
    context.traceContext ??
    ({
      traceId: context.traceId,
      spanId: context.spanId,
      parentSpanId: context.parentSpanId,
      sessionId: context.sessionId,
      turnId: context.turnId,
    } as TraceContext)
  );
}

function prepareEvalWorkflowSnippetApproval(input: unknown): ToolApprovalGate {
  const parsed = EvalWorkflowSnippetInputSchema.safeParse(input);
  if (!parsed.success || parsed.data.code === undefined) return { gate: "proceed" };
  const workflow = createWorkflowProgram(parsed.data.code, { facadeDts: SNIPPET_FACADE_DTS });
  if (collectDiagnostics(workflow.program).length > 0) return { gate: "proceed" };
  const { commands, diagnostics } = collectWorldRunCommands(workflow, collectSites(workflow));
  if (diagnostics.length > 0) return { gate: "proceed" };
  return commands.length > 0 ? { gate: "ask" } : { gate: "proceed" };
}

export const evalWorkflowSnippetToolEntry: ToolEntry = {
  capability:
    "Compile and synchronously run a small dynamic-workflow TypeScript snippet (world reads + pure logic) against the real workflow execution path, fully ephemerally",
  metadata: {
    shouldDefer: true,
    name: EVAL_WORKFLOW_SNIPPET_TOOL_NAME,
    description: EVAL_WORKFLOW_SNIPPET_TOOL_DESCRIPTION,
    readOnly: false,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: EVAL_WORKFLOW_SNIPPET_TOOL_TIMEOUT_MS,
    maxOutputBytes: EVAL_WORKFLOW_SNIPPET_MODEL_BYTES,
    sideEffectScope: "workspace",
    riskLevel: "low",
    needsApproval: true,
  },
  prepareApproval: prepareEvalWorkflowSnippetApproval,
  handler: evalWorkflowSnippetHandler,
  validateInput: (input) => validateEvalWorkflowSnippetInput(input),
  resolveInput: (input, context) =>
    requireDynamicWorkflowSkill(context, EVAL_WORKFLOW_SNIPPET_TOOL_NAME) ??
    resolveEvalWorkflowSnippetInput(input, context.workingDirectory ?? "."),
  inputSchema: EvalWorkflowSnippetInputJsonSchema,
  outputSchema: EvalWorkflowSnippetOutputJsonSchema,
  runtimeInputSchema: EvalWorkflowSnippetInputSchema,
  runtimeOutputSchema: EvalWorkflowSnippetOutputSchema,
  formatModelContent: formatEvalWorkflowSnippetModelContent,
  permission: {
    permission: "evalWorkflowSnippet",
    reason:
      "evalWorkflowSnippet.runConfirmation: snippets carrying world.run commands must be confirmed",
    riskLevel: "low",
    sideEffectScope: "workspace",
    needsApproval: true,
    patternSources: ["toolName"],
    alwaysAllowPatternSources: ["toolName"],
    denyPriority: "beforeAsk",
  },
  resultBudget: {
    maxInlineBytes: EVAL_WORKFLOW_SNIPPET_MODEL_BYTES,
    maxModelBytes: EVAL_WORKFLOW_SNIPPET_MODEL_BYTES,
    strategy: "truncate",
    preview: {
      maxBytes: EVAL_WORKFLOW_SNIPPET_MODEL_BYTES,
      direction: "head",
    },
  },
  timeout: {
    defaultMs: EVAL_WORKFLOW_SNIPPET_TOOL_TIMEOUT_MS,
    maxMs: EVAL_WORKFLOW_SNIPPET_TOOL_TIMEOUT_MS,
    allowCallOverride: false,
  },
  cancellation: {
    supported: true,
    cleanup: "bestEffort",
    userVisibleMessage: "Snippet evaluation cancelled",
  },
  trace: {
    required: true,
    propagateToAdapters: true,
    recordInput: "summary",
    recordOutput: "summary",
  },
};

function formatEvalWorkflowSnippetModelContent(output: unknown): ModelMessageContent {
  const parsed = EvalWorkflowSnippetOutputSchema.safeParse(output);
  if (!parsed.success) return "EvalWorkflowSnippet returned an invalid result.";
  return parsed.data.response;
}
