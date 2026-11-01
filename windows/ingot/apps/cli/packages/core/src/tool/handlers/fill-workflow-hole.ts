// ============================================================
// FillWorkflowHole Tool Handler
// ============================================================
// apps/cli/packages/dynamic-workflow/docs/execution-engine.md「Holes」。
//

import path from "node:path";
import {
  FILL_WORKFLOW_HOLE_TOOL_NAME,
  FillWorkflowHoleInputJsonSchema,
  FillWorkflowHoleInputSchema,
  FillWorkflowHoleOutputJsonSchema,
  FillWorkflowHoleOutputSchema,
  SAVED_WORKFLOW_FILE_EXTENSION,
  type CreateWorkflowDiagnostic,
  type CreateWorkflowOutput,
  type DynamicWorkflowRunFillHoleDiagnostic,
  type DynamicWorkflowRunPort,
  type FillWorkflowHoleInput,
  type ModelMessageContent,
} from "@origin-ai/cf-contracts";
import type {
  ToolApprovalGate,
  ToolEntry,
  ToolExecutionContext,
  ToolHandler,
  ToolHandlerFailure,
} from "../types.js";
import { resolveTraceContext } from "./create-workflow.js";
import { FILL_WORKFLOW_HOLE_TOOL_DESCRIPTION } from "./fill-workflow-hole-description.js";
import {
  FILL_WORKFLOW_HOLE_ERROR_CODE,
  rememberRejectedFill,
  resolveFillWorkflowHoleInput,
  takeFillPreview,
  validateFillWorkflowHoleSource,
} from "./fill-workflow-hole-resolve.js";
import { boundGraphOfAnalysis, displayOfAnalysis } from "./workflow-analysis-display.js";
import { recordAuthoredWorkflowDraft } from "./workflow-draft-read-state.js";
import { workflowDraftSlug, writeWorkflowDraft } from "./workflow-drafts.js";
import { workflowRunNotFoundFailure } from "./workflow-run-introspection.js";
import { analyzeScript } from "./workflow-script-analysis.js";
import { allScriptModelsBound } from "./workflow-script-models.js";
import { describeWorkflowScriptPath } from "./workflow-script-path.js";
import { requireDynamicWorkflowSkill } from "./workflow-skill-gate.js";

export { FILL_WORKFLOW_HOLE_ERROR_CODE } from "./fill-workflow-hole-resolve.js";

const FILL_WORKFLOW_HOLE_TIMEOUT_MS = 15_000;
const FILL_WORKFLOW_HOLE_MODEL_BYTES = 24_000;

function fillUnavailableFailure(): ToolHandlerFailure {
  return {
    result: false,
    errorCode: FILL_WORKFLOW_HOLE_ERROR_CODE.FILL_UNAVAILABLE,
    message:
      "workflow_fill_unavailable: this session cannot fill workflow holes — workflow execution is not available here. This is a capability gap, not a bad hole id.",
  };
}

function fillRefusalFor(reason: string, message: string, runId: string): ToolHandlerFailure {
  switch (reason) {
    case "run_not_found":
      return workflowRunNotFoundFailure(runId);
    case "hole_not_waiting":
      return {
        result: false,
        errorCode: FILL_WORKFLOW_HOLE_ERROR_CODE.HOLE_NOT_WAITING,
        message: `hole_not_waiting: ${message}`,
      };
    case "fill_ids_unstable":
      return {
        result: false,
        errorCode: FILL_WORKFLOW_HOLE_ERROR_CODE.IDS_UNSTABLE,
        message: `fill_ids_unstable: ${message} This is a host fault, not a problem with your body: the hole is still waiting. Report it to the user rather than rewriting the body.`,
      };
    default:
      return {
        result: false,
        errorCode: FILL_WORKFLOW_HOLE_ERROR_CODE.HOLE_NOT_WAITING,
        message: `workflow_fill_refused: ${message} (reason: ${reason})`,
      };
  }
}

interface FillFileLocation {
  kind: "draft" | "path";
  described: string;
}

async function writeFillFile(
  parsed: FillWorkflowHoleInput,
  body: string,
  port: DynamicWorkflowRunPort,
  cwd: string | undefined,
): Promise<string | undefined> {
  const draftPath = parsed.hole?.draft_path;
  let runSlug: string;
  if (draftPath !== undefined) {
    runSlug = path.basename(draftPath, SAVED_WORKFLOW_FILE_EXTENSION);
  } else {
    const snapshot = await port.getTask(parsed.run_id).catch(() => undefined);
    runSlug = workflowDraftSlug(snapshot?.name ?? snapshot?.description ?? "workflow");
  }
  const holeSlug = workflowDraftSlug(parsed.hole?.name ?? parsed.hole_id);
  const written = await writeWorkflowDraft({ cwd, name: `${runSlug}.${holeSlug}`, source: body });
  return written?.path;
}

function formatFillDiagnosticLines(
  diagnostics: readonly DynamicWorkflowRunFillHoleDiagnostic[],
  fillFile: string | undefined,
  draftFile: string | undefined,
): string[] {
  return diagnostics.map((diagnostic) => {
    const anchor = diagnostic.inFill ? fillFile : draftFile;
    const where = `L${diagnostic.line}:C${diagnostic.column}`;
    return `${anchor === undefined ? where : `${anchor}:${where}`} ${diagnostic.message}`;
  });
}

function fillBlock(parsed: FillWorkflowHoleInput): NonNullable<CreateWorkflowOutput["fill"]> {
  const hole = parsed.hole;
  return {
    siteId: parsed.hole_id,
    name: hole?.name ?? parsed.hole_id,
    ...(hole?.draft_path === undefined ? {} : { draftPath: hole.draft_path }),
    ...(hole?.line === undefined ? {} : { line: hole.line }),
  };
}

function compileFailureResponse(
  parsed: FillWorkflowHoleInput,
  diagnostics: readonly DynamicWorkflowRunFillHoleDiagnostic[],
  fillFile: FillFileLocation | undefined,
  cwd: string | undefined,
): string {
  const lead =
    fillFile === undefined
      ? "The fill could not be saved to a file; fix the body below and resubmit it inline."
      : fillFile.kind === "draft"
        ? `The fill is saved at ${fillFile.described}. Edit that file in place and resubmit with \`path\`; do not paste it inline again.`
        : `The fill file is ${fillFile.described}. Edit that file in place and resubmit with \`path\`.`;
  const draftFile =
    parsed.hole?.draft_path === undefined
      ? undefined
      : describeWorkflowScriptPath(parsed.hole.draft_path, cwd ?? "");
  const outsideFill = diagnostics.some((diagnostic) => diagnostic.inFill !== true);
  const recordedScriptNote = outsideFill
    ? `The lines outside the fill are in the run's recorded script${draftFile === undefined ? "" : ` (${draftFile} as the run launched it)`}: this tool cannot change them, and editing the draft on disk does not change what the fill is compiled into. Fix them with AmendWorkflow (pass the corrected script, or its \`path\`); the revised run will reach the hole and ask again.`
    : undefined;
  return [
    lead,
    "The effective script does not compile:",
    ...formatFillDiagnosticLines(diagnostics, fillFile?.described, draftFile),
    ...(recordedScriptNote === undefined ? [] : [recordedScriptNote]),
    "",
    `NOTE: Nothing was spliced or journaled — hole ${parsed.hole_id} of run ${parsed.run_id} is still waiting for its body.`,
  ].join("\n");
}

const fillWorkflowHoleHandler: ToolHandler = async (input, context: ToolExecutionContext) => {
  const parsed = FillWorkflowHoleInputSchema.parse(input) as FillWorkflowHoleInput;
  const port = context.dynamicWorkflowRunPort;
  if (port === undefined || typeof port.fillHole !== "function") return fillUnavailableFailure();
  const body = parsed.script;
  if (body === undefined) {
    return {
      result: false,
      errorCode: FILL_WORKFLOW_HOLE_ERROR_CODE.BODY_UNAVAILABLE,
      message:
        "workflow_fill_body_unavailable: the call reached the handler without a resolved body. Pass `script` or `path`. Nothing was filled.",
    } satisfies ToolHandlerFailure;
  }
  const cwd = context.workingDirectory;

  let fillFile: FillFileLocation | undefined;
  if (parsed.path === undefined) {
    const written = await writeFillFile(parsed, body, port, cwd);
    if (written !== undefined) {
      fillFile = { kind: "draft", described: describeWorkflowScriptPath(written, cwd ?? "") };
      await recordAuthoredWorkflowDraft(context, {
        path: written,
        source: body,
        toolName: "FillWorkflowHole",
      });
    }
  } else {
    fillFile = { kind: "path", described: describeWorkflowScriptPath(parsed.path, cwd ?? "") };
  }

  const result = await port.fillHole({
    runId: parsed.run_id,
    holeId: parsed.hole_id,
    body,
    parentSessionId: context.sessionId,
    toolCallId: context.toolCallId,
    trace: resolveTraceContext(context),
  });

  if (!result.ok) {
    if (result.reason !== "compile_failed") {
      return fillRefusalFor(result.reason, result.message, parsed.run_id);
    }
    rememberRejectedFill(context.sessionId, parsed.run_id, parsed.hole_id, body);
    const diagnostics = result.diagnostics ?? [];
    return {
      fill: fillBlock(parsed),
      diagnostics: diagnostics.map(
        (diagnostic): CreateWorkflowDiagnostic => ({
          code: diagnostic.code,
          column: diagnostic.column,
          line: diagnostic.line,
          message: diagnostic.message,
        }),
      ),
      ok: false,
      response: compileFailureResponse(parsed, diagnostics, fillFile, cwd),
    } satisfies CreateWorkflowOutput;
  }

  const analysis = analyzeScript(result.scriptText);
  const causalityGraph = boundGraphOfAnalysis(analysis);
  const holeName = parsed.hole?.name ?? parsed.hole_id;
  const phases =
    result.phasesAdded.length === 0
      ? "It added no phases."
      : `It added the phase${result.phasesAdded.length === 1 ? "" : "s"} ${result.phasesAdded.join(", ")}.`;
  const draft =
    result.scriptPath === undefined
      ? "The run has no draft file, so a later revision must pass the whole script to AmendWorkflow."
      : `The run's draft ${describeWorkflowScriptPath(result.scriptPath, cwd ?? "")} now holds the effective script: edit that file and pass \`path\` to AmendWorkflow for any later revision.`;
  return {
    fill: fillBlock(parsed),
    diagnostics: [],
    ok: true,
    response: `The fill joined run ${parsed.run_id} at hole "${holeName}" (${parsed.hole_id}); the branch parked there has resumed and the run keeps going in the background. ${phases} ${draft} Do not wait for the run or poll it with TaskOutput; you will be notified when it completes.`,
    ...(causalityGraph === undefined ? {} : { causalityGraph }),
  } satisfies CreateWorkflowOutput;
};

function prepareFillWorkflowHoleApproval(input: unknown): ToolApprovalGate {
  const parsed = FillWorkflowHoleInputSchema.safeParse(input);
  if (!parsed.success || parsed.data.script === undefined) return { gate: "ask" };
  const preview = takeFillPreview(parsed.data.run_id, parsed.data.hole_id, parsed.data.script);
  if (preview === undefined) return { gate: "ask" };
  const analysis = analyzeScript(preview.effectiveScript);
  if (!analysis.ok || !allScriptModelsBound(analysis, preview.modelBindings)) {
    return { gate: "proceed" };
  }
  const display = displayOfAnalysis(analysis, FILL_WORKFLOW_HOLE_TOOL_NAME);
  return { gate: "ask", ...(display ? { display } : {}) };
}

export const fillWorkflowHoleToolEntry: ToolEntry = {
  capability:
    "Supply the body of a hole a running dynamic-workflow run is waiting at, so the parked branch resumes",
  metadata: {
    shouldDefer: true,
    name: FILL_WORKFLOW_HOLE_TOOL_NAME,
    description: FILL_WORKFLOW_HOLE_TOOL_DESCRIPTION,
    readOnly: false,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: FILL_WORKFLOW_HOLE_TIMEOUT_MS,
    maxOutputBytes: FILL_WORKFLOW_HOLE_MODEL_BYTES,
    sideEffectScope: "none",
    riskLevel: "low",
    needsApproval: true,
  },
  handler: fillWorkflowHoleHandler,
  validateInput: (input) => validateFillWorkflowHoleSource(input),
  resolveInput: async (input, context) => {
    const refused = requireDynamicWorkflowSkill(context, FILL_WORKFLOW_HOLE_TOOL_NAME);
    if (refused) return refused;
    return resolveFillWorkflowHoleInput(input, context);
  },
  prepareApproval: prepareFillWorkflowHoleApproval,
  inputSchema: FillWorkflowHoleInputJsonSchema,
  outputSchema: FillWorkflowHoleOutputJsonSchema,
  runtimeInputSchema: FillWorkflowHoleInputSchema,
  runtimeOutputSchema: FillWorkflowHoleOutputSchema,
  formatModelContent: formatFillWorkflowHoleModelContent,
  permission: {
    permission: "createWorkflow",
    reason:
      "fillWorkflowHole.runConfirmation: user must confirm the body that joins the running script",
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
    maxInlineBytes: FILL_WORKFLOW_HOLE_MODEL_BYTES,
    maxModelBytes: FILL_WORKFLOW_HOLE_MODEL_BYTES,
    strategy: "truncate",
    preview: { maxBytes: FILL_WORKFLOW_HOLE_MODEL_BYTES, direction: "head" },
  },
  timeout: {
    defaultMs: FILL_WORKFLOW_HOLE_TIMEOUT_MS,
    maxMs: FILL_WORKFLOW_HOLE_TIMEOUT_MS,
    allowCallOverride: false,
  },
  cancellation: {
    supported: false,
    cleanup: "none",
    userVisibleMessage:
      "FillWorkflowHole compiles the effective script synchronously and cannot be cancelled",
  },
  trace: {
    required: true,
    propagateToAdapters: true,
    recordInput: "summary",
    recordOutput: "summary",
  },
};

function formatFillWorkflowHoleModelContent(output: unknown): ModelMessageContent {
  const parsed = FillWorkflowHoleOutputSchema.safeParse(output);
  if (!parsed.success) return "FillWorkflowHole returned an invalid result.";
  return parsed.data.response;
}
