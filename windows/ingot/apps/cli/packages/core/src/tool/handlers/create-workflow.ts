// ============================================================
// CreateWorkflow Tool Handler
// ============================================================
// Typechecks a dynamic-workflow script against the facade, and — once the user has
// confirmed at the gate — starts the run in the background through
// `DynamicWorkflowRunPort`.
//
//

import {
  CreateWorkflowInputJsonSchema,
  CreateWorkflowInputSchema,
  CreateWorkflowOutputJsonSchema,
  CreateWorkflowOutputSchema,
  type CreateWorkflowInput,
  type CreateWorkflowOutput,
  type ModelMessageContent,
  type TraceContext,
  createWorkflowPhaseAlongside,
  createWorkflowPhaseNames,
} from "@origin-ai/cf-contracts";
import type {
  ToolApprovalGate,
  ToolEntry,
  ToolExecutionContext,
  ToolHandler,
} from "../types.js";
import { CREATE_WORKFLOW_TOOL_DESCRIPTION } from "./create-workflow-description.js";
import {
  CREATE_WORKFLOW_FAILURE_CODE,
  resolveCreateWorkflowInput,
  validateCreateWorkflowSource,
} from "./create-workflow-source.js";
import {
  describeWorkflowSubagentModel,
  parseWorkflowSubagentModel,
} from "./model-reference.js";
import { boundGraphOfAnalysis, displayOfAnalysis } from "./workflow-analysis-display.js";
import { recordAuthoredWorkflowDraft } from "./workflow-draft-read-state.js";
import { resolveWorkflowDraftName, writeWorkflowDraft } from "./workflow-drafts.js";
import {
  formatWorkflowDiagnosticLines,
  workflowLaunchedScriptSentence,
  workflowSavedDraftNote,
  workflowScriptFileNote,
  type WorkflowScriptLocation,
} from "./workflow-script-notes.js";
import { analyzeScript } from "./workflow-script-analysis.js";
import { describeWorkflowScriptPath } from "./workflow-script-path.js";
import { createWorkflowNeedsSkill, requireDynamicWorkflowSkill } from "./workflow-skill-gate.js";
import {
  allScriptModelsBound,
  describeScriptModelBindings,
  readScriptModelBindings,
  scriptModelSelections,
  unresolvedScriptModelDiagnostics,
  withScriptModelBindingsResolved,
} from "./workflow-script-models.js";
import {
  applyWorkflowSettingsAdjustments,
  describeWorkflowRunSettings,
  readAppliedWorkflowSettings,
  withWorkflowAdjustableSettings,
} from "./workflow-settings-adjustment.js";

const CREATE_WORKFLOW_TOOL_NAME = "CreateWorkflow";
const CREATE_WORKFLOW_TIMEOUT_MS = 15_000;
const CREATE_WORKFLOW_MODEL_BYTES = 24_000;

export const DIAGNOSTICS_NOT_EXECUTED_NOTE =
  "NOTE: The workflow was NOT executed — fix the errors above and resubmit.";
export const EXECUTION_UNAVAILABLE_NOTE =
  "NOTE: The workflow was NOT executed — workflow execution is not available in this session, so the script was only typechecked.";

const createWorkflowHandler: ToolHandler = async (input, context) => {
  const parsed = CreateWorkflowInputSchema.parse(input) as CreateWorkflowInput;
  const script = parsed.script;
  if (script === undefined) {
    throw new Error("CreateWorkflow handler received input without a resolved script");
  }
  const saved = parsed.saved;
  const cwd = context.workingDirectory;

  const analysis = analyzeScript(script);
  const modelBindings = readScriptModelBindings(parsed);
  const modelDiagnostics = analysis.ok
    ? unresolvedScriptModelDiagnostics(analysis, modelBindings, context.modelCatalogPort)
    : [];
  const diagnostics = [...analysis.diagnostics, ...modelDiagnostics];
  const ok = analysis.ok && modelDiagnostics.length === 0;
  const causalityGraph = boundGraphOfAnalysis(analysis);

  const inlineDraft =
    saved === undefined && parsed.path === undefined
      ? await writeWorkflowDraft({
          cwd,
          name: resolveWorkflowDraftName(parsed.name, causalityGraph),
          source: script,
        })
      : undefined;
  if (inlineDraft !== undefined) {
    await recordAuthoredWorkflowDraft(context, {
      path: inlineDraft.path,
      source: script,
      toolName: "CreateWorkflow",
    });
  }
  const location = describeScriptLocation(parsed, inlineDraft?.path, cwd);

  if (!ok) {
    return {
      diagnostics,
      ok,
      response: [
        saved === undefined
          ? "The workflow script has errors:"
          : `The saved workflow '${saved.name}'${saved.path === undefined ? "" : ` (${saved.path})`} has errors:`,
        ...formatWorkflowDiagnosticLines(diagnostics, location),
        "",
        diagnosticsNote(parsed, location, cwd),
      ].join("\n"),
      ...(causalityGraph === undefined ? {} : { causalityGraph }),
    } satisfies CreateWorkflowOutput;
  }

  const port = context.dynamicWorkflowRunPort;
  if (port === undefined) {
    return {
      diagnostics,
      ok,
      response: `The workflow script compiled cleanly.\n\n${EXECUTION_UNAVAILABLE_NOTE}`,
      ...(causalityGraph === undefined ? {} : { causalityGraph }),
    } satisfies CreateWorkflowOutput;
  }

  const scriptPath = resolveSubmittedScriptPath(parsed, inlineDraft?.path);

  const submitted = await port.submit(
    {
      scriptText: script,
      cwd: context.workingDirectory,
      ...(parsed.name === undefined ? {} : { name: parsed.name }),
      ...(() => {
        const args = parsed.args ?? saved?.args;
        return args === undefined ? {} : { args };
      })(),
      parentSessionId: context.sessionId,
      toolCallId: context.toolCallId,
      ...(() => {
        const phaseNames = createWorkflowPhaseNames(causalityGraph);
        if (phaseNames === undefined) return {};
        const phaseAlongside = createWorkflowPhaseAlongside(causalityGraph);
        return { phaseNames, ...(phaseAlongside === undefined ? {} : { phaseAlongside }) };
      })(),
      ...(parsed.max_concurrency === undefined ? {} : { maxConcurrency: parsed.max_concurrency }),
      ...(() => {
        const subagentModel = parseWorkflowSubagentModel(parsed.subagent_model);
        return subagentModel === undefined ? {} : { subagentModel };
      })(),
      ...(() => {
        const selections = scriptModelSelections(modelBindings);
        return selections === undefined ? {} : { modelBindings: selections };
      })(),
      ...(scriptPath === undefined ? {} : { scriptPath }),
      trace: resolveTraceContext(context),
    },
    { signal: context.abortSignal },
  );

  const { runId } = submitted;
  const defaultConcurrency = port.defaultConcurrency?.();
  const settingsSentences = describeWorkflowRunSettings({
    applied: readAppliedWorkflowSettings(context.inputAdjustments),
    defaultConcurrency,
    describeLimit: () =>
      describeWorkflowConcurrencyLimit(parsed.max_concurrency, defaultConcurrency),
    describeModel: () => describeWorkflowSubagentModel(parsed.subagent_model),
    describeScriptModels: () => describeScriptModelBindings(modelBindings),
  });

  return {
    diagnostics,
    ok,
    response: `The workflow script compiled cleanly and the run started in the background with ID: ${runId}. It is still running — you will be notified with the final output when it completes. Do not wait for it or poll it with TaskOutput; continue with other work unless the user asked you to wait.${settingsSentences}${location === undefined ? "" : workflowLaunchedScriptSentence(location)}`,
    status: "backgrounded",
    backgroundTaskId: runId,
    ...(causalityGraph === undefined ? {} : { causalityGraph }),
  } satisfies CreateWorkflowOutput;
};

function resolveSubmittedScriptPath(
  parsed: CreateWorkflowInput,
  inlineDraft: string | undefined,
): string | undefined {
  if (parsed.path !== undefined) return parsed.path;
  if (parsed.saved !== undefined) return parsed.saved.draft;
  return inlineDraft;
}

function describeScriptLocation(
  parsed: CreateWorkflowInput,
  inlineDraft: string | undefined,
  cwd: string,
): WorkflowScriptLocation | undefined {
  const absolute = resolveSubmittedScriptPath(parsed, inlineDraft);
  if (absolute === undefined) return undefined;
  return {
    kind: parsed.path === undefined ? "draft" : "path",
    described: describeWorkflowScriptPath(absolute, cwd),
    lineOffset: parsed.script_line_offset ?? 0,
  };
}

function diagnosticsNote(
  parsed: CreateWorkflowInput,
  location: WorkflowScriptLocation | undefined,
  cwd: string,
): string {
  const saved = parsed.saved;
  if (location === undefined) {
    return saved === undefined
      ? DIAGNOSTICS_NOT_EXECUTED_NOTE
      : "NOTE: The workflow was NOT executed — the saved file needs fixing (edit it, or save a corrected version).";
  }
  if (saved !== undefined) {
    return workflowSavedDraftNote({
      savedName: saved.name,
      savedPath:
        saved.path === undefined
          ? location.described
          : describeWorkflowScriptPath(saved.path, cwd),
      draft: location.described,
    });
  }
  return workflowScriptFileNote(location);
}

export function describeWorkflowConcurrencyLimit(
  limit: number | undefined,
  defaultConcurrency: number | undefined,
): string {
  if (limit === undefined) return "";
  const subject = limit === 1 ? "1 subagent runs" : `${limit} subagents run`;
  return ` At most ${subject} at once${limit === defaultConcurrency ? " (the default)" : ""}.`;
}

export function resolveTraceContext(context: ToolExecutionContext): TraceContext {
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

function prepareCreateWorkflowApproval(input: unknown): ToolApprovalGate {
  const parsed = CreateWorkflowInputSchema.safeParse(input);
  if (!parsed.success || parsed.data.script === undefined) return { gate: "proceed" };

  const analysis = analyzeScript(parsed.data.script);
  if (!analysis.ok) return { gate: "proceed" };
  if (!allScriptModelsBound(analysis, readScriptModelBindings(parsed.data))) {
    return { gate: "proceed" };
  }

  const display = displayOfAnalysis(analysis);
  return { gate: "ask", ...(display ? { display } : {}) };
}

export const createWorkflowToolEntry: ToolEntry = {
  capability:
    "Typecheck a dynamic-workflow TypeScript script against the facade and, once confirmed, start the run in the background",
  metadata: {
    shouldDefer: true,
    name: CREATE_WORKFLOW_TOOL_NAME,
    description: CREATE_WORKFLOW_TOOL_DESCRIPTION,
    readOnly: false,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: CREATE_WORKFLOW_TIMEOUT_MS,
    maxOutputBytes: CREATE_WORKFLOW_MODEL_BYTES,
    sideEffectScope: "none",
    riskLevel: "low",
    needsApproval: true,
  },
  handler: createWorkflowHandler,
  validateInput: (input) => validateCreateWorkflowSource(input),
  resolveInput: async (input, context) => {
    if (createWorkflowNeedsSkill(input)) {
      const refused = requireDynamicWorkflowSkill(context, CREATE_WORKFLOW_TOOL_NAME);
      if (refused) return refused;
    }
    const resolved = await resolveCreateWorkflowInput(
      input,
      context.workingDirectory ?? ".",
      context.modelCatalogPort,
    );
    const resolution = withScriptModelBindingsResolved(resolved, context.modelCatalogPort);
    return withWorkflowAdjustableSettings(resolution, context);
  },
  applyInputAdjustments: (input, adjustments, context) =>
    applyWorkflowSettingsAdjustments(input, adjustments, context, {
      errorCode: CREATE_WORKFLOW_FAILURE_CODE,
      schema: CreateWorkflowInputSchema,
    }),
  prepareApproval: prepareCreateWorkflowApproval,
  inputSchema: CreateWorkflowInputJsonSchema,
  outputSchema: CreateWorkflowOutputJsonSchema,
  runtimeInputSchema: CreateWorkflowInputSchema,
  runtimeOutputSchema: CreateWorkflowOutputSchema,
  formatModelContent: formatCreateWorkflowModelContent,
  permission: {
    permission: "createWorkflow",
    reason: "createWorkflow.runConfirmation: user must confirm running the analyzed script",
    riskLevel: "low",
    sideEffectScope: "none",
    needsApproval: true,
    patternSources: ["toolName"],
    alwaysAllowPatternSources: ["toolName"],
    denyPriority: "beforeAsk",
    alwaysAsk: true,
    //
    askOptions: { allowAlways: "session" },
  },
  resultBudget: {
    maxInlineBytes: CREATE_WORKFLOW_MODEL_BYTES,
    maxModelBytes: CREATE_WORKFLOW_MODEL_BYTES,
    strategy: "truncate",
    preview: {
      maxBytes: CREATE_WORKFLOW_MODEL_BYTES,
      direction: "head",
    },
  },
  timeout: {
    defaultMs: CREATE_WORKFLOW_TIMEOUT_MS,
    maxMs: CREATE_WORKFLOW_TIMEOUT_MS,
    allowCallOverride: false,
  },
  cancellation: {
    supported: false,
    cleanup: "none",
    userVisibleMessage: "CreateWorkflow typechecks synchronously and cannot be cancelled",
  },
  trace: {
    required: true,
    propagateToAdapters: true,
    recordInput: "summary",
    recordOutput: "summary",
  },
};

function formatCreateWorkflowModelContent(output: unknown): ModelMessageContent {
  const parsed = CreateWorkflowOutputSchema.safeParse(output);
  if (!parsed.success) return "CreateWorkflow returned an invalid result.";
  return parsed.data.response;
}
