import type { Model, ModelOptions } from "@origin-ai/cf-contracts";

const AUXILIARY_MAX_OUTPUT_TOKENS = 5_000;

export function auxiliaryModelOptions(model: Model): Required<ModelOptions> {
  return {
    reasoningLevel: model.optionSpecs.reasoningLevel.values[0]!,
    maxOutputTokens: Math.min(AUXILIARY_MAX_OUTPUT_TOKENS, model.optionSpecs.maxOutputTokens.max),
  };
}
