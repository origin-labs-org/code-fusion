// ============================================================
// AmendWorkflow Tool Handler
// ============================================================
//

import {
  AMEND_WORKFLOW_TOOL_NAME,
  AmendWorkflowInputJsonSchema,
  AmendWorkflowInputSchema,
  CreateWorkflowOutputJsonSchema,
  CreateWorkflowOutputSchema,
  type AmendWorkflowInput,
  type CreateWorkflowOutput,
  type ModelMessageContent,
  createWorkflowPhaseAlongside,
  createWorkflowPhaseNames,
} from "@origin-ai/cf-contracts";
import type {
  ToolApprovalGate,
  ToolEntry,
  ToolExecutionContext,
  ToolHandler,
  ToolHandlerFailure,
} from "../types.js";
import { AMEND_WORKFLOW_TOOL_DESCRIPTION } from "./amend-workflow-description.js";
import {
  AMEND_WORKFLOW_ERROR_CODE,
  predecessorNotFoundFailure,
  resolveAmendWorkflowInput,
  scriptUnavailableFailure,
  validateAmendWorkflowSource,
} from "./amend-workflow-resolve.js";
import {
  isConcurrencyOnlyAmend,
  resolveRetuneFallbackAmend,
  runConcurrencyRetune,
} from "./amend-workflow-retune.js";
import {
  DIAGNOSTICS_NOT_EXECUTED_NOTE,
  EXECUTION_UNAVAILABLE_NOTE,
  describeWorkflowConcurrencyLimit,
  resolveTraceContext,
} from "./create-workflow.js";
import { describeWorkflowSubagentModel, parseWorkflowSubagentModel } from "./model-reference.js";
import { boundGraphOfAnalysis, displayOfAnalysis } from "./workflow-analysis-display.js";
import { recordAuthoredWorkflowDraft } from "./workflow-draft-read-state.js";
import { resolveWorkflowDraftName, writeWorkflowDraft } from "./workflow-drafts.js";
import {
  formatWorkflowDiagnosticLines,
  workflowAmendedScriptSentence,
  workflowScriptFileNote,
  type WorkflowScriptLocation,
} from "./workflow-script-notes.js";
import { analyzeScript } from "./workflow-script-analysis.js";
import {
  allScriptModelsBound,
  describeScriptModelBindings,
  readScriptModelBindings,
  scriptModelSelections,
  unresolvedScriptModelDiagnostics,
} from "./workflow-script-models.js";
import { describeWorkflowScriptPath } from "./workflow-script-path.js";
import { amendWorkflowNeedsSkill, requireDynamicWorkflowSkill } from "./workflow-skill-gate.js";
import {
  applyWorkflowSettingsAdjustments,
  describeWorkflowRunSettings,
  readAppliedWorkflowSettings,
  withWorkflowAdjustableSettings,
} from "./workflow-settings-adjustment.js";

const AMEND_WORKFLOW_TIMEOUT_MS = 15_000;
const AMEND_WORKFLOW_MODEL_BYTES = 24_000;

function amendUnavailableFailure(): ToolHandlerFailure {
  return {
    result: false,
    errorCode: AMEND_WORKFLOW_ERROR_CODE.AMEND_UNAVAILABLE,
    message:
      "workflow_amend_unavailable: this session cannot amend workflow runs — workflow execution is not available here. This is a capability gap, not a status problem.",
  };
}

function amendRefusalFor(reason: string, runId: string): ToolHandlerFailure {
  switch (reason) {
    case "run_not_found":
      return predecessorNotFoundFailure(runId);
    case "missing_boundaries":
      return {
        result: false,
        errorCode: AMEND_WORKFLOW_ERROR_CODE.MISSING_BOUNDARIES,
        message: `workflow_amend_missing_boundaries: run ${runId}'s journal predates transcript-boundary bookkeeping (or its boundaries were never recorded), so its finished asks cannot seed an amended run — there is no fallback. Submit this script as a fresh CreateWorkflow instead. Nothing was stopped or created.`,
      };
    default:
      return {
        result: false,
        errorCode: AMEND_WORKFLOW_ERROR_CODE.MISSING_BOUNDARIES,
        message: `workflow_amend_refused: the workflow runtime refused to amend run ${runId} (reason: ${reason}). Nothing was stopped or created.`,
      };
  }
}

function compileFailureResponse(
  input: AmendWorkflowInput,
  diagnostics: CreateWorkflowOutput["diagnostics"],
  location: WorkflowScriptLocation | undefined,
): string {
  const inherited = input.predecessor?.script_inherited === true;
  const note =
    location !== undefined
      ? workflowScriptFileNote(location)
      : inherited
        ? "NOTE: Nothing ran — pass a rewritten `script` that compiles."
        : DIAGNOSTICS_NOT_EXECUTED_NOTE;
  return [
    inherited
      ? `This amend kept run ${input.run_id}'s script, inherited because you omitted both \`script\` and \`path\`, and that script no longer compiles against the current workflow facade:`
      : "The revised workflow script has errors:",
    ...formatWorkflowDiagnosticLines(diagnostics, location),
    "",
    `${note} Run ${input.run_id} was not touched.`,
  ].join("\n");
}

const amendWorkflowHandler: ToolHandler = async (input, context) => {
  const parsed = AmendWorkflowInputSchema.parse(input) as AmendWorkflowInput;
  if (isConcurrencyOnlyAmend(parsed)) {
    const retuned = await runConcurrencyRetune(parsed, context);
    if (retuned !== undefined) return retuned;
    const fallback = await resolveRetuneFallbackAmend(parsed, context);
    if (!fallback.result) return fallback;
    return await amendResolvedWorkflow(fallback.input, context);
  }
  return await amendResolvedWorkflow(parsed, context);
};

async function amendResolvedWorkflow(
  parsed: AmendWorkflowInput,
  context: ToolExecutionContext,
): Promise<CreateWorkflowOutput | ToolHandlerFailure> {
  const script = parsed.script;
  if (script === undefined) return scriptUnavailableFailure(parsed.run_id, "host");
  const cwd = context.workingDirectory;

  const analysis = analyzeScript(script);
  const modelBindings = readScriptModelBindings(parsed);
  const modelDiagnostics =
    analysis.ok && !allScriptModelsBound(analysis, modelBindings)
      ? unresolvedScriptModelDiagnostics(
          analysis,
          modelBindings,
          context.modelCatalogPort,
          (await context.dynamicWorkflowRunPort?.getTask(parsed.run_id))?.modelBindings,
        )
      : [];
  const diagnostics = [...analysis.diagnostics, ...modelDiagnostics];
  const ok = analysis.ok && modelDiagnostics.length === 0;
  const causalityGraph = boundGraphOfAnalysis(analysis);

  const inlineDraft =
    parsed.path === undefined
      ? await writeWorkflowDraft({
          cwd,
          name: resolveWorkflowDraftName(parsed.name ?? parsed.predecessor?.name, causalityGraph),
          source: script,
        })
      : undefined;
  if (inlineDraft !== undefined && parsed.predecessor?.script_inherited !== true) {
    await recordAuthoredWorkflowDraft(context, {
      path: inlineDraft.path,
      source: script,
      toolName: "AmendWorkflow",
    });
  }
  const scriptPath = parsed.path ?? inlineDraft?.path;
  const location: WorkflowScriptLocation | undefined =
    scriptPath === undefined
      ? undefined
      : {
          kind: parsed.path === undefined ? "draft" : "path",
          described: describeWorkflowScriptPath(scriptPath, cwd),
          lineOffset: parsed.script_line_offset ?? 0,
        };

  if (!ok) {
    return {
      diagnostics,
      ok,
      response: compileFailureResponse(parsed, diagnostics, location),
      ...(causalityGraph === undefined ? {} : { causalityGraph }),
    } satisfies CreateWorkflowOutput;
  }

  const port = context.dynamicWorkflowRunPort;
  if (port === undefined) {
    return {
      diagnostics,
      ok,
      response: `The revised workflow script compiled cleanly.\n\n${EXECUTION_UNAVAILABLE_NOTE}`,
      ...(causalityGraph === undefined ? {} : { causalityGraph }),
    } satisfies CreateWorkflowOutput;
  }
  if (typeof port.amend !== "function") return amendUnavailableFailure();

  const amended = await port.amend(
    {
      scriptText: script,
      cwd: context.workingDirectory,
      predecessorRunId: parsed.run_id,
      ...(parsed.name === undefined ? {} : { name: parsed.name }),
      parentSessionId: context.sessionId,
      toolCallId: context.toolCallId,
      ...(() => {
        const phaseNames = createWorkflowPhaseNames(causalityGraph);
        if (phaseNames === undefined) return {};
        const phaseAlongside = createWorkflowPhaseAlongside(causalityGraph);
        return { phaseNames, ...(phaseAlongside === undefined ? {} : { phaseAlongside }) };
      })(),
      ...(typeof parsed.max_concurrency === "number"
        ? { maxConcurrency: parsed.max_concurrency }
        : {}),
      ...(() => {
        const subagentModel = parseWorkflowSubagentModel(parsed.subagent_model ?? undefined);
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
  if (!amended.ok) return amendRefusalFor(amended.reason, parsed.run_id);

  const superseded =
    amended.supersededRunId === undefined
      ? `Run ${parsed.run_id} had already settled; its finished work is imported as cache.`
      : `Run ${amended.supersededRunId} was still running: it has been stopped and superseded, and everything it finished before the stop is imported as cache. It will not send a notification of its own.`;
  const started =
    parsed.predecessor?.script_inherited === true
      ? `The script of run ${parsed.run_id} started unchanged in the background as run ${amended.runId}.`
      : `The revised script started in the background as run ${amended.runId}.`;
  const defaultConcurrency = port.defaultConcurrency?.();
  const settingsSentences = describeWorkflowRunSettings({
    applied: readAppliedWorkflowSettings(context.inputAdjustments),
    defaultConcurrency,
    describeLimit: () =>
      describeWorkflowConcurrencyLimit(parsed.max_concurrency ?? undefined, defaultConcurrency),
    describeModel: () => describeWorkflowSubagentModel(parsed.subagent_model ?? undefined),
    describeScriptModels: () => describeScriptModelBindings(modelBindings),
  });
  return {
    diagnostics,
    ok,
    response: `${superseded} ${started} It is still running — you will be notified with the final output when it completes. Do not wait for it or poll it with TaskOutput; continue with other work unless the user asked you to wait.${settingsSentences}${location === undefined ? "" : workflowAmendedScriptSentence(location)}`,
    status: "backgrounded",
    backgroundTaskId: amended.runId,
    ...(causalityGraph === undefined ? {} : { causalityGraph }),
  } satisfies CreateWorkflowOutput;
}

function prepareAmendWorkflowApproval(input: unknown): ToolApprovalGate {
  const parsed = AmendWorkflowInputSchema.safeParse(input);
  if (!parsed.success || parsed.data.script === undefined) return { gate: "proceed" };
  const analysis = analyzeScript(parsed.data.script);
  if (!analysis.ok) return { gate: "proceed" };
  if (!allScriptModelsBound(analysis, readScriptModelBindings(parsed.data))) {
    return { gate: "proceed" };
  }
  const display = displayOfAnalysis(analysis, AMEND_WORKFLOW_TOOL_NAME);
  return { gate: "ask", ...(display ? { display } : {}) };
}

export const amendWorkflowToolEntry: ToolEntry = {
  capability:
    "Revise an existing dynamic-workflow run with a new script: stop it if it is still running, import its finished work, and start the revision in the background",
  metadata: {
    shouldDefer: true,
    name: AMEND_WORKFLOW_TOOL_NAME,
    description: AMEND_WORKFLOW_TOOL_DESCRIPTION,
    readOnly: false,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: AMEND_WORKFLOW_TIMEOUT_MS,
    maxOutputBytes: AMEND_WORKFLOW_MODEL_BYTES,
    sideEffectScope: "none",
    riskLevel: "low",
    needsApproval: true,
  },
  handler: amendWorkflowHandler,
  validateInput: (input) => validateAmendWorkflowSource(input),
  resolveInput: async (input, context) => {
    if (amendWorkflowNeedsSkill(input)) {
      const refused = requireDynamicWorkflowSkill(context, AMEND_WORKFLOW_TOOL_NAME);
      if (refused) return refused;
    }
    return withWorkflowAdjustableSettings(
      await resolveAmendWorkflowInput(input, context),
      context,
      (resolved) => resolved.script !== undefined,
    );
  },
  applyInputAdjustments: (input, adjustments, context) =>
    applyWorkflowSettingsAdjustments(input, adjustments, context, {
      errorCode: AMEND_WORKFLOW_ERROR_CODE.SUBAGENT_MODEL,
      schema: AmendWorkflowInputSchema,
    }),
  prepareApproval: prepareAmendWorkflowApproval,
  inputSchema: AmendWorkflowInputJsonSchema,
  outputSchema: CreateWorkflowOutputJsonSchema,
  runtimeInputSchema: AmendWorkflowInputSchema,
  runtimeOutputSchema: CreateWorkflowOutputSchema,
  formatModelContent: formatAmendWorkflowModelContent,
  permission: {
    permission: "createWorkflow",
    reason: "amendWorkflow.runConfirmation: user must confirm running the revised script",
    riskLevel: "low",
    sideEffectScope: "none",
    needsApproval: true,
    patternSources: ["toolName"],
    alwaysAllowPatternSources: ["toolName"],
    denyPriority: "beforeAsk",
    alwaysAsk: true,
    askOptions: { allowAlways: "session" },
  },
  resultBudget: {
    maxInlineBytes: AMEND_WORKFLOW_MODEL_BYTES,
    maxModelBytes: AMEND_WORKFLOW_MODEL_BYTES,
    strategy: "truncate",
    preview: { maxBytes: AMEND_WORKFLOW_MODEL_BYTES, direction: "head" },
  },
  timeout: {
    defaultMs: AMEND_WORKFLOW_TIMEOUT_MS,
    maxMs: AMEND_WORKFLOW_TIMEOUT_MS,
    allowCallOverride: false,
  },
  cancellation: {
    supported: false,
    cleanup: "none",
    userVisibleMessage: "AmendWorkflow typechecks synchronously and cannot be cancelled",
  },
  trace: {
    required: true,
    propagateToAdapters: true,
    recordInput: "summary",
    recordOutput: "summary",
  },
};

function formatAmendWorkflowModelContent(output: unknown): ModelMessageContent {
  const parsed = CreateWorkflowOutputSchema.safeParse(output);
  if (!parsed.success) return "AmendWorkflow returned an invalid result.";
  return parsed.data.response;
}
