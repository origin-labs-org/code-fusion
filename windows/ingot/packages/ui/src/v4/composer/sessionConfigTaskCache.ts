import type { CfConfigOption } from "@origin-ai/cf-shared";
import type { SessionConfigState } from "@origin-ai/cf-shared/cf-protocol-v4";
import { parseModelPickerValue } from "@/lib/cfSessionProjection.js";

function resolveModelDisplayValue(
  options: readonly CfConfigOption[],
  config: Pick<SessionConfigState, "provider" | "model">,
): string {
  const provider = config.provider.trim();
  const rawModel = config.model.trim();
  const model =
    provider && rawModel.startsWith(`${provider}/`)
      ? rawModel.slice(provider.length + 1)
      : rawModel;
  if (!provider || !model) {
    return "";
  }

  const modelOption = options.find(
    (option) => option.category === "model" && option.type === "select",
  );
  const catalogValue = modelOption?.options?.find((candidate) => {
    const ref = parseModelPickerValue(candidate.value);
    return ref.providerId === provider && ref.modelId === model;
  })?.value;
  return catalogValue ?? `${provider}/${model}`;
}

export function projectSessionConfigToTaskConfigOptions(
  options: readonly CfConfigOption[],
  config: Pick<SessionConfigState, "provider" | "model" | "mode" | "thought">,
): CfConfigOption[] {
  const modelValue = resolveModelDisplayValue(options, config);
  return options.map((option) => {
    if (option.type !== "select") {
      return option;
    }
    if (option.category === "model" && modelValue) {
      return { ...option, currentValue: modelValue };
    }
    if (option.category === "mode" && config.mode.trim()) {
      return { ...option, currentValue: config.mode.trim() };
    }
    if (option.category === "thought_level") {
      return { ...option, currentValue: config.thought.trim() };
    }
    return option;
  });
}
