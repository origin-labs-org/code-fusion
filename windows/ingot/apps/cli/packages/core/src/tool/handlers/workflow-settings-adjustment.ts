// ============================================================
// ============================================================
// docs/dynamic-workflow/launch.md「Adjusting the settings in the window」。
//
//

import {
  parseWorkflowSettingsAdjustment,
  type WorkflowAdjustableSettings,
  type WorkflowSettingsAdjustment,
} from "@origin-ai/cf-contracts";
import type {
  ToolHandlerFailure,
  ToolInputAdjustmentResult,
  ToolInputResolutionContext,
  ToolInputResolutionResult,
} from "../types.js";
import { normalizeWorkflowMaxConcurrency } from "./create-workflow-source.js";
import { resolveModelReference } from "./model-reference.js";

interface WorkflowInputSchemaLike {
  safeParse(value: unknown): { success: boolean };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function workflowAdjustableSettings(
  context: ToolInputResolutionContext,
): WorkflowAdjustableSettings | undefined {
  const port = context.dynamicWorkflowRunPort;
  if (port === undefined) return undefined;
  const defaultConcurrency = port.defaultConcurrency?.();
  return {
    subagent_model: context.modelCatalogPort !== undefined,
    ...(defaultConcurrency === undefined ? {} : { concurrency_ceiling: defaultConcurrency }),
  };
}

export function withWorkflowAdjustableSettings(
  resolution: ToolInputResolutionResult,
  context: ToolInputResolutionContext,
  includeWhen: (input: Record<string, unknown>) => boolean = () => true,
): ToolInputResolutionResult {
  if (!resolution.result || !isPlainRecord(resolution.input)) return resolution;
  const { adjustable_settings: _forged, ...rest } = resolution.input;
  void _forged;
  const block = includeWhen(rest) ? workflowAdjustableSettings(context) : undefined;
  return {
    result: true,
    input: block === undefined ? rest : { ...rest, adjustable_settings: block },
  };
}

function adjustedModelFailure(errorCode: number, detail: string): ToolHandlerFailure {
  return {
    result: false,
    errorCode,
    message: `workflow_subagent_model_unresolved: the subagent model the user chose in the confirmation window cannot be used now. ${detail} Nothing was started; ask the user which model to use.`,
  };
}

const ADJUSTED_MODEL_WITHOUT_CATALOG = "This host cannot choose a subagent model.";

export function applyWorkflowSettingsAdjustments(
  input: unknown,
  adjustments: Readonly<Record<string, unknown>>,
  context: ToolInputResolutionContext,
  options: { errorCode: number; schema: WorkflowInputSchemaLike },
): ToolInputAdjustmentResult {
  const adjustment = parseWorkflowSettingsAdjustment(adjustments);
  if (adjustment === undefined || !isPlainRecord(input)) return { result: true, input };
  const next: Record<string, unknown> = { ...input };
  const applied: WorkflowSettingsAdjustment = {};

  if (adjustment.subagent_model === null) {
    if (next.subagent_model !== undefined) applied.subagent_model = null;
    delete next.subagent_model;
  } else if (adjustment.subagent_model !== undefined) {
    const catalog = context.modelCatalogPort;
    if (catalog === undefined) {
      return adjustedModelFailure(options.errorCode, ADJUSTED_MODEL_WITHOUT_CATALOG);
    }
    const resolution = resolveModelReference(adjustment.subagent_model, catalog.listModels());
    if (!resolution.ok) return adjustedModelFailure(options.errorCode, resolution.message);
    if (next.subagent_model !== resolution.canonical) applied.subagent_model = resolution.canonical;
    next.subagent_model = resolution.canonical;
  }

  if (adjustment.max_concurrency === null) {
    if (next.max_concurrency !== undefined) applied.max_concurrency = null;
    delete next.max_concurrency;
  } else if (adjustment.max_concurrency !== undefined) {
    const bound = normalizeWorkflowMaxConcurrency(adjustment.max_concurrency);
    if (next.max_concurrency !== bound) applied.max_concurrency = bound;
    next.max_concurrency = bound;
  }

  if (!options.schema.safeParse(next).success) {
    return {
      result: false,
      errorCode: options.errorCode,
      message:
        "workflow_settings_adjustment_invalid: the settings adjusted in the confirmation window did not produce a valid call. Nothing was started.",
    };
  }
  return Object.keys(applied).length === 0
    ? { result: true, input: next }
    : { result: true, input: next, applied };
}

export function readAppliedWorkflowSettings(
  inputAdjustments: Readonly<Record<string, unknown>> | undefined,
): WorkflowSettingsAdjustment {
  return parseWorkflowSettingsAdjustment(inputAdjustments) ?? {};
}

export function describeWorkflowSettingsAdjustment(
  applied: WorkflowSettingsAdjustment,
  defaultConcurrency: number | undefined,
): string {
  const halves: string[] = [];
  if (applied.subagent_model === null) {
    halves.push("subagents are back on the session model");
  } else if (applied.subagent_model !== undefined) {
    halves.push(
      `subagents run on ${applied.subagent_model} (the main agent stays on the session model)`,
    );
  }
  if (applied.max_concurrency === null) {
    halves.push("the limit on subagents at once is back to the default");
  } else if (applied.max_concurrency !== undefined) {
    const subject =
      applied.max_concurrency === 1
        ? "1 subagent runs"
        : `${applied.max_concurrency} subagents run`;
    halves.push(
      `at most ${subject} at once${defaultConcurrency === undefined ? "" : ` (the default is ${defaultConcurrency})`}`,
    );
  }
  if (halves.length === 0) return "";
  return ` Before approving, the user adjusted the settings in the confirmation window: ${halves.join("; ")}.`;
}

export function describeWorkflowRunSettings(options: {
  applied: WorkflowSettingsAdjustment;
  defaultConcurrency: number | undefined;
  describeLimit: () => string;
  describeModel: () => string;
  
  describeScriptModels?: () => string;
}): string {
  const { applied, defaultConcurrency } = options;
  return [
    describeWorkflowSettingsAdjustment(applied, defaultConcurrency),
    applied.max_concurrency === undefined ? options.describeLimit() : "",
    applied.subagent_model === undefined ? options.describeModel() : "",
    options.describeScriptModels?.() ?? "",
  ].join("");
}
