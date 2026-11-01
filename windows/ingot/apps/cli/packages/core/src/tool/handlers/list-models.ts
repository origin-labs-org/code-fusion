// ============================================================
// ListModels Tool Handler
// ============================================================
//
//

import {
  LIST_MODELS_TOOL_NAME,
  ListModelsInputJsonSchema,
  ListModelsInputSchema,
  ListModelsOutputJsonSchema,
  ListModelsOutputSchema,
  type ListModelsOutput,
  type ModelMessageContent,
} from "@origin-ai/cf-contracts";
import type { ToolEntry, ToolHandler, ToolHandlerFailure } from "../types.js";
import { formatModelCatalogId } from "./model-reference.js";

const LIST_MODELS_TIMEOUT_MS = 10_000;

const LIST_MODELS_MODEL_BYTES = 24_000;

const LIST_MODELS_ERROR_CODE = { CATALOG_UNAVAILABLE: 31 } as const;

const LIST_MODELS_DESCRIPTION = [
  "Lists the models this host has configured, so a dynamic workflow's subagents can be pointed at one.",
  "",
  "- Each row's `id` (`providerId/modelId`) pastes verbatim into the `subagent_model` field of CreateWorkflow or AmendWorkflow. Append `$<level>` to pick a reasoning level from that row's `reasoningLevels`.",
  "- This tool does NOT change the model you are running on. The session model is the user's choice and only the user changes it; `subagent_model` only moves the workflow's subagents.",
  "- The model the session is on right now is marked `[current]` — setting the subagents to that one is the same as omitting the field.",
  "- A row marked `disabled` cannot be used (no API key, disabled by policy). Resolve that with the user rather than picking around it silently.",
].join("\n");

function modelCatalogUnavailableFailure(): ToolHandlerFailure {
  return {
    result: false,
    errorCode: LIST_MODELS_ERROR_CODE.CATALOG_UNAVAILABLE,
    message:
      "model_catalog_unavailable: this session cannot list models — the host did not provide a model catalog. This is a capability gap, not an empty configuration. Omit `subagent_model` on CreateWorkflow and AmendWorkflow; the workflow's subagents will run on the session model.",
  };
}

const listModelsHandler: ToolHandler = async (input, context) => {
  ListModelsInputSchema.parse(input);

  const port = context.modelCatalogPort;
  if (port === undefined) return modelCatalogUnavailableFailure();

  const entries = port.listModels();
  const current = entries.find((entry) => entry.current);

  return {
    ...(current === undefined ? {} : { current: formatModelCatalogId(current) }),
    models: entries.map((entry) => ({
      id: formatModelCatalogId(entry),
      providerId: entry.providerId,
      modelId: entry.modelId,
      ...(entry.providerLabel === undefined ? {} : { providerLabel: entry.providerLabel }),
      reasoningLevels: [...entry.reasoningLevels],
      ...(entry.defaultReasoningLevel === undefined
        ? {}
        : { defaultReasoningLevel: entry.defaultReasoningLevel }),
      ...(entry.contextWindow === undefined ? {} : { contextWindow: entry.contextWindow }),
      ...(entry.disabledReason === undefined ? {} : { disabledReason: entry.disabledReason }),
    })),
  } satisfies ListModelsOutput;
};

function formatListModelsModelContent(output: unknown): ModelMessageContent {
  const parsed = ListModelsOutputSchema.safeParse(output);
  if (!parsed.success) return "ListModels returned an invalid result.";
  const { current, models } = parsed.data;

  if (models.length === 0) {
    return [
      '<models count="0">',
      "No models are configured on this host. Omit `subagent_model`: the workflow's subagents run on the session model.",
      "</models>",
    ].join("\n");
  }

  const lines = models.map((model) => {
    const parts = [model.id];
    if (model.providerLabel !== undefined) parts.push(` — ${model.providerLabel}`);
    if (model.reasoningLevels.length > 0) {
      const levels = model.reasoningLevels.join(",");
      const fallback =
        model.defaultReasoningLevel === undefined ? "" : ` (default ${model.defaultReasoningLevel})`;
      parts.push(`; levels: ${levels}${fallback}`);
    }
    if (model.id === current) parts.push(" [current]");
    if (model.disabledReason !== undefined) parts.push(` [disabled: ${model.disabledReason}]`);
    return parts.join("");
  });

  return [`<models count="${models.length}">`, ...lines, "</models>"].join("\n");
}

export const listModelsToolEntry: ToolEntry = {
  capability: "List the models this host has configured, for choosing a workflow's subagent model",
  metadata: {
    shouldDefer: true,
    name: LIST_MODELS_TOOL_NAME,
    description: LIST_MODELS_DESCRIPTION,
    readOnly: true,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: LIST_MODELS_TIMEOUT_MS,
    maxOutputBytes: LIST_MODELS_MODEL_BYTES,
    sideEffectScope: "none",
    riskLevel: "low",
    needsApproval: false,
  },
  handler: listModelsHandler,
  inputSchema: ListModelsInputJsonSchema,
  outputSchema: ListModelsOutputJsonSchema,
  runtimeInputSchema: ListModelsInputSchema,
  runtimeOutputSchema: ListModelsOutputSchema,
  formatModelContent: formatListModelsModelContent,
  permission: {
    permission: "listModels",
    reason: "ListModels reads the host's configured model catalog",
    riskLevel: "low",
    sideEffectScope: "none",
    needsApproval: false,
    patternSources: ["toolName"],
    alwaysAllowPatternSources: ["toolName"],
    denyPriority: "beforeAsk",
  },
  resultBudget: {
    maxInlineBytes: LIST_MODELS_MODEL_BYTES,
    maxModelBytes: LIST_MODELS_MODEL_BYTES,
    strategy: "truncate",
    preview: {
      maxBytes: LIST_MODELS_MODEL_BYTES,
      direction: "head",
    },
  },
  timeout: {
    kind: "timed",
    defaultMs: LIST_MODELS_TIMEOUT_MS,
    maxMs: LIST_MODELS_TIMEOUT_MS,
    allowCallOverride: false,
  },
  cancellation: {
    supported: false,
    cleanup: "none",
    userVisibleMessage: "ListModels reads the in-memory model catalog and cannot be cancelled",
  },
  trace: {
    required: true,
    propagateToAdapters: false,
    recordInput: "summary",
    recordOutput: "summary",
  },
};
