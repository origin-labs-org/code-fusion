import type { ModelReasoningContentBlock } from "@origin-ai/cf-contracts";

type ReasoningTransformOptions = {
  providerKind?: "openai" | "anthropic" | "openai-compatible" | "gateway" | "custom";
};
type ReasoningProviderOptions =
  | { providerOptions: Record<string, unknown> }
  | Record<string, never>;

export function providerOptionsForReasoningBlock(
  block: ModelReasoningContentBlock,
  options: ReasoningTransformOptions,
): ReasoningProviderOptions {
  const providerOptions = objectProviderOptions(block.providerOptions);
  if (options.providerKind !== "anthropic") {
    return block.providerOptions ? { providerOptions: block.providerOptions } : {};
  }

  if (hasAnthropicReasoningMetadata(block.providerOptions)) {
    return { providerOptions: block.providerOptions };
  }

  return {
    providerOptions: {
      ...providerOptions,
      anthropic: {
        ...anthropicProviderOptions(block.providerOptions),
        signature: "",
      },
    },
  };
}

function hasAnthropicReasoningMetadata(
  providerOptions: unknown,
): providerOptions is Record<string, unknown> {
  const anthropicOptions = anthropicProviderOptions(providerOptions);
  return (
    typeof anthropicOptions.signature === "string" ||
    typeof anthropicOptions.redactedData === "string"
  );
}

function objectProviderOptions(providerOptions: unknown): Record<string, unknown> {
  if (!providerOptions || typeof providerOptions !== "object" || Array.isArray(providerOptions)) {
    return {};
  }

  return providerOptions as Record<string, unknown>;
}

function anthropicProviderOptions(providerOptions: unknown): Record<string, unknown> {
  if (!providerOptions || typeof providerOptions !== "object" || Array.isArray(providerOptions)) {
    return {};
  }

  const anthropicOptions = (providerOptions as Record<string, unknown>).anthropic;
  if (
    !anthropicOptions ||
    typeof anthropicOptions !== "object" ||
    Array.isArray(anthropicOptions)
  ) {
    return {};
  }

  return anthropicOptions as Record<string, unknown>;
}
