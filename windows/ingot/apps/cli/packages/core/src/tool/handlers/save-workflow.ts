// ============================================================
// SaveWorkflow Tool Handler
// ============================================================
//
//

import {
  SAVE_WORKFLOW_SENTINEL_IN_SCRIPT_ERROR,
  SAVE_WORKFLOW_SOURCE_ERROR,
  SAVE_WORKFLOW_TOOL_NAME,
  SAVED_WORKFLOW_MAX_NAME_CHARS,
  SaveWorkflowInputJsonSchema,
  SaveWorkflowInputSchema,
  SaveWorkflowOutputJsonSchema,
  SaveWorkflowOutputSchema,
  isValidSavedWorkflowName,
  type ModelMessageContent,
  type SaveWorkflowInput,
  type SaveWorkflowOutput,
  type SavedWorkflowMeta,
} from "@origin-ai/cf-contracts";
import type {
  ToolApprovalGate,
  ToolEntry,
  ToolHandler,
  ToolInputResolutionResult,
  ToolInputValidationResult,
} from "../types.js";
import { SAVE_WORKFLOW_TOOL_DESCRIPTION } from "./save-workflow-description.js";
import {
  SAVED_WORKFLOW_SENTINEL,
  findSavedWorkflowShadowing,
  savedWorkflowExists,
  savedWorkflowPath,
  savedWorkflowRoot,
  saveSavedWorkflow,
} from "./saved-workflows/index.js";
import { readWorkflowScriptFile } from "./workflow-path-source.js";
import { analyzeScript } from "./workflow-script-analysis.js";
import { requireDynamicWorkflowSkill } from "./workflow-skill-gate.js";

const SAVE_WORKFLOW_TIMEOUT_MS = 15_000;
const SAVE_WORKFLOW_MODEL_BYTES = 24_000;
const SAVE_WORKFLOW_FAILURE_CODE = 400;

const DIAGNOSTICS_NOT_SAVED_NOTE =
  "NOTE: Nothing was saved — fix the errors above and call the tool again.";

function toMeta(parsed: SaveWorkflowInput): SavedWorkflowMeta {
  return {
    description: parsed.description,
    ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
    ...(parsed.args === undefined ? {} : { args: parsed.args }),
  };
}

function validateSaveWorkflowInput(input: unknown): ToolInputValidationResult {
  const parsed = SaveWorkflowInputSchema.safeParse(input);
  if (!parsed.success) return { result: true };

  if (!isValidSavedWorkflowName(parsed.data.name)) {
    return {
      result: false,
      errorCode: SAVE_WORKFLOW_FAILURE_CODE,
      message: `'${parsed.data.name}' is not a usable workflow name: names may only contain letters, digits, '.', '-' and '_', and must be 1-${SAVED_WORKFLOW_MAX_NAME_CHARS} characters.`,
    };
  }

  const hasScript = parsed.data.script !== undefined;
  const hasScriptPath = parsed.data.script_path !== undefined;
  if (hasScript === hasScriptPath) {
    return {
      result: false,
      errorCode: SAVE_WORKFLOW_FAILURE_CODE,
      message: SAVE_WORKFLOW_SOURCE_ERROR,
    };
  }

  if (parsed.data.script?.trimStart().startsWith(SAVED_WORKFLOW_SENTINEL) === true) {
    return {
      result: false,
      errorCode: SAVE_WORKFLOW_FAILURE_CODE,
      message: SAVE_WORKFLOW_SENTINEL_IN_SCRIPT_ERROR,
    };
  }

  return { result: true };
}

async function resolveSaveWorkflowInput(
  input: unknown,
  cwd: string,
): Promise<ToolInputResolutionResult> {
  const parsed = SaveWorkflowInputSchema.safeParse(input);
  if (!parsed.success) return { result: true, input };

  let script = parsed.data.script;
  if (parsed.data.script_path !== undefined) {
    const read = await readWorkflowScriptFile({ cwd, inputPath: parsed.data.script_path });
    if (!read.ok) {
      return { result: false, errorCode: SAVE_WORKFLOW_FAILURE_CODE, message: read.message };
    }
    script = read.file.script;
  }

  const { scope, name } = parsed.data;
  const shadowing = findSavedWorkflowShadowing({ cwd, name, scope });
  return {
    result: true,
    input: {
      ...parsed.data,
      ...(script === undefined ? {} : { script }),
      path: savedWorkflowPath(savedWorkflowRoot(cwd, scope), name),
      overwrite: savedWorkflowExists({ cwd, name, scope }),
      ...(shadowing === undefined ? {} : { shadowing }),
    } satisfies SaveWorkflowInput,
  };
}

const saveWorkflowHandler: ToolHandler = async (input, context) => {
  const parsed = SaveWorkflowInputSchema.parse(input) as SaveWorkflowInput;
  const cwd = context.workingDirectory ?? ".";
  const scope = parsed.scope;
  const path = parsed.path ?? savedWorkflowPath(savedWorkflowRoot(cwd, scope), parsed.name);
  const script = parsed.script;
  if (script === undefined) {
    throw new Error("SaveWorkflow handler received input without a resolved script");
  }

  const { diagnostics, ok } = analyzeScript(script);
  if (!ok) {
    return {
      name: parsed.name,
      scope,
      path,
      diagnostics,
      ok,
      response: [
        "The workflow script has errors:",
        ...diagnostics.map(
          (diagnostic) => `L${diagnostic.line}:C${diagnostic.column} ${diagnostic.message}`,
        ),
        "",
        DIAGNOSTICS_NOT_SAVED_NOTE,
      ].join("\n"),
    } satisfies SaveWorkflowOutput;
  }

  //
  const written = saveSavedWorkflow({
    cwd,
    name: parsed.name,
    meta: toMeta(parsed),
    script,
    scope,
  });

  const isGlobal = written.scope === "global";
  return {
    name: parsed.name,
    scope: written.scope,
    path: written.path,
    diagnostics,
    ok,
    overwritten: written.overwritten,
    response: [
      written.overwritten
        ? isGlobal
          ? `Replaced the saved global workflow '${parsed.name}' at ${written.path}.`
          : `Replaced the saved workflow '${parsed.name}' at ${written.path}.`
        : isGlobal
          ? `Saved global workflow '${parsed.name}' to ${written.path}.`
          : `Saved the workflow '${parsed.name}' to ${written.path}.`,
      `Run it with CreateWorkflow using \`saved: { name: "${parsed.name}" }\`.`,
    ].join(" "),
  } satisfies SaveWorkflowOutput;
};

function prepareSaveWorkflowApproval(input: unknown): ToolApprovalGate {
  const parsed = SaveWorkflowInputSchema.safeParse(input);
  if (!parsed.success || parsed.data.script === undefined) return { gate: "proceed" };
  return analyzeScript(parsed.data.script).ok ? { gate: "ask" } : { gate: "proceed" };
}

function formatSaveWorkflowModelContent(output: unknown): ModelMessageContent {
  const parsed = SaveWorkflowOutputSchema.safeParse(output);
  if (!parsed.success) return "SaveWorkflow returned an invalid result.";
  return parsed.data.response;
}

export const saveWorkflowToolEntry: ToolEntry = {
  capability:
    "Typecheck a dynamic-workflow script and, once confirmed, save it into the project as a reusable definition",
  metadata: {
    shouldDefer: true,
    name: SAVE_WORKFLOW_TOOL_NAME,
    description: SAVE_WORKFLOW_TOOL_DESCRIPTION,
    readOnly: false,
    destructive: false,
    concurrentSafe: false,
    timeoutMs: SAVE_WORKFLOW_TIMEOUT_MS,
    maxOutputBytes: SAVE_WORKFLOW_MODEL_BYTES,
    sideEffectScope: "workspace",
    riskLevel: "medium",
    needsApproval: true,
  },
  handler: saveWorkflowHandler,
  validateInput: (input) => validateSaveWorkflowInput(input),
  resolveInput: (input, context) =>
    requireDynamicWorkflowSkill(context, SAVE_WORKFLOW_TOOL_NAME) ??
    resolveSaveWorkflowInput(input, context.workingDirectory ?? "."),
  prepareApproval: prepareSaveWorkflowApproval,
  inputSchema: SaveWorkflowInputJsonSchema,
  outputSchema: SaveWorkflowOutputJsonSchema,
  runtimeInputSchema: SaveWorkflowInputSchema,
  runtimeOutputSchema: SaveWorkflowOutputSchema,
  formatModelContent: formatSaveWorkflowModelContent,
  permission: {
    permission: "saveWorkflow",
    reason: "saveWorkflow.confirmation: user must confirm writing the workflow into the project",
    riskLevel: "medium",
    sideEffectScope: "workspace",
    needsApproval: true,
    patternSources: ["toolName"],
    alwaysAllowPatternSources: ["toolName"],
    denyPriority: "beforeAsk",
    alwaysAsk: true,
    askOptions: { allowAlways: false },
  },
  resultBudget: {
    maxInlineBytes: SAVE_WORKFLOW_MODEL_BYTES,
    maxModelBytes: SAVE_WORKFLOW_MODEL_BYTES,
    strategy: "truncate",
    preview: {
      maxBytes: SAVE_WORKFLOW_MODEL_BYTES,
      direction: "head",
    },
  },
  timeout: {
    defaultMs: SAVE_WORKFLOW_TIMEOUT_MS,
    maxMs: SAVE_WORKFLOW_TIMEOUT_MS,
    allowCallOverride: false,
  },
  cancellation: {
    supported: false,
    cleanup: "none",
    userVisibleMessage: "SaveWorkflow typechecks and writes synchronously and cannot be cancelled",
  },
  trace: {
    required: true,
    propagateToAdapters: true,
    recordInput: "summary",
    recordOutput: "summary",
  },
};
