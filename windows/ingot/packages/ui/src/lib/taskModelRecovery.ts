import type { CfConfigOption, CfTaskMeta } from "@origin-ai/cf-shared";
import { getCfAgentModeSelectOptions } from "@origin-ai/cf-shared";
import {
  decodeCustomModelValue,
  encodeCustomModelValue,
} from "@/lib/cfCustomModelValue.js";

function parseProviderQualifiedModel(
  model: string,
): { providerId: string; modelName: string } | null {
  const normalizedModel = model.trim();
  const separatorIndex = normalizedModel.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex >= normalizedModel.length - 1) {
    return null;
  }

  const providerId = normalizedModel.slice(0, separatorIndex).trim();
  const modelName = normalizedModel.slice(separatorIndex + 1).trim();
  if (!providerId || !modelName) {
    return null;
  }

  return { providerId, modelName };
}

function isSyntheticModelPlaceholder(model: string): boolean {
  return model.trim().toLocaleLowerCase() === "<synthetic>";
}

export function resolveGlmRecoveredTaskModelValue(
  taskModel: string | undefined,
): string | null {
  const normalizedTaskModel = taskModel?.trim();
  if (!normalizedTaskModel || isSyntheticModelPlaceholder(normalizedTaskModel)) {
    return null;
  }

  const customModel = decodeCustomModelValue(normalizedTaskModel);
  if (customModel?.providerId && customModel.modelName) {
    return normalizedTaskModel;
  }

  const providerQualifiedModel = parseProviderQualifiedModel(normalizedTaskModel);
  if (providerQualifiedModel) {
    return encodeCustomModelValue(
      providerQualifiedModel.providerId,
      providerQualifiedModel.modelName,
    );
  }

  return normalizedTaskModel;
}

export function resolveRecoveredTaskModelValue(
  taskMeta: Pick<CfTaskMeta, "provider" | "model">,
): string | null {
  const normalizedTaskModel = taskMeta.model?.trim();
  if (!normalizedTaskModel || isSyntheticModelPlaceholder(normalizedTaskModel)) {
    return null;
  }

  if (taskMeta.provider === "glm") {
    return resolveGlmRecoveredTaskModelValue(normalizedTaskModel);
  }

  return normalizedTaskModel;
}

function resolveModelOptionName(modelValue: string): string {
  const customModel = decodeCustomModelValue(modelValue);
  const providerQualifiedModel = parseProviderQualifiedModel(modelValue);
  return customModel?.modelName?.trim() || providerQualifiedModel?.modelName || modelValue;
}

function ensureModelOptionValue(
  option: CfConfigOption,
  modelValue: string,
): CfConfigOption {
  const options = option.options ?? [];
  const hasOption = options.some((candidate) => candidate.value === modelValue);
  if (hasOption && option.currentValue === modelValue) {
    return option;
  }

  return {
    ...option,
    currentValue: modelValue,
    options: hasOption
      ? options
      : [
          ...options,
          {
            name: resolveModelOptionName(modelValue),
            value: modelValue,
          },
        ],
  };
}

function createRecoveredModelOption(modelValue: string): CfConfigOption {
  return {
    category: "model",
    currentValue: modelValue,
    id: "model",
    name: "Model",
    options: [
      {
        name: resolveModelOptionName(modelValue),
        value: modelValue,
      },
    ],
    type: "select",
  };
}

function createRecoveredModeOption(modeValue: string): CfConfigOption {
  return {
    category: "mode",
    currentValue: modeValue,
    id: "mode",
    name: "Mode",
    options: getCfAgentModeSelectOptions(),
    type: "select",
  };
}

function createRecoveredThoughtLevelOption(thoughtLevel: string): CfConfigOption {
  return {
    category: "thought_level",
    currentValue: thoughtLevel,
    id: "thought_level",
    name: "Effort",
    options: [
      {
        name: thoughtLevel,
        value: thoughtLevel,
      },
    ],
    type: "select",
  };
}

function ensureSelectOptionCurrentValue(
  option: CfConfigOption,
  value: string,
): CfConfigOption {
  const options = option.options ?? [];
  const hasOption = options.some((candidate) => candidate.value === value);
  if (hasOption && option.currentValue === value) {
    return option;
  }

  return {
    ...option,
    currentValue: value,
    options: hasOption
      ? options
      : [
          ...options,
          {
            name: value,
            value,
          },
        ],
  };
}

export function mergeRecoveredTaskModelConfigOptions({
  taskMeta,
  configOptions,
}: {
  taskMeta: Pick<CfTaskMeta, "provider" | "model">;
  configOptions: readonly CfConfigOption[];
}): CfConfigOption[] | null {
  const recoveredModelValue = resolveRecoveredTaskModelValue(taskMeta);
  if (!recoveredModelValue) {
    return null;
  }

  let hasModelOption = false;
  let changed = false;
  const nextConfigOptions = configOptions.map((option) => {
    if (option.category !== "model" || option.type !== "select") {
      return option;
    }

    hasModelOption = true;
    const nextOption = ensureModelOptionValue(option, recoveredModelValue);
    changed = changed || nextOption !== option;
    return nextOption;
  });

  if (!hasModelOption) {
    return [createRecoveredModelOption(recoveredModelValue), ...nextConfigOptions];
  }

  return changed ? nextConfigOptions : null;
}

export function resolveTaskRestorePreloadConfigOptions({
  taskMeta,
  cachedTaskConfigOptions,
}: {
  taskMeta: Pick<CfTaskMeta, "provider" | "model"> &
    Partial<Pick<CfTaskMeta, "mode" | "thoughtLevel">>;
  cachedTaskConfigOptions?: readonly CfConfigOption[];
}): CfConfigOption[] {
  let cachedOptions = [...(cachedTaskConfigOptions ?? [])];
  const recoveredOptions = mergeRecoveredTaskModelConfigOptions({
    taskMeta,
    configOptions: cachedOptions,
  });

  if (recoveredOptions) {
    cachedOptions = recoveredOptions;
  }

  const mode = taskMeta.mode?.trim();
  if (taskMeta.provider === "glm" && mode) {
    let hasModeOption = false;
    cachedOptions = cachedOptions.map((option) => {
      if (option.category !== "mode" || option.type !== "select") {
        return option;
      }
      hasModeOption = true;
      return ensureSelectOptionCurrentValue(option, mode);
    });
    if (!hasModeOption) {
      cachedOptions = [createRecoveredModeOption(mode), ...cachedOptions];
    }
  }

  const thoughtLevel = taskMeta.thoughtLevel?.trim();
  if (taskMeta.provider === "glm" && thoughtLevel) {
    let hasThoughtOption = false;
    cachedOptions = cachedOptions.map((option) => {
      if (option.category !== "thought_level" || option.type !== "select") {
        return option;
      }
      hasThoughtOption = true;
      return ensureSelectOptionCurrentValue(option, thoughtLevel);
    });
    if (!hasThoughtOption) {
      cachedOptions = [...cachedOptions, createRecoveredThoughtLevelOption(thoughtLevel)];
    }
  }

  return cachedOptions;
}

export function mergeGlmRecoveredTaskModelConfigOptions({
  taskMeta,
  configOptions,
}: {
  taskMeta: Pick<CfTaskMeta, "provider" | "model">;
  configOptions: readonly CfConfigOption[];
}): CfConfigOption[] | null {
  if (taskMeta.provider !== "glm") {
    return null;
  }

  return mergeRecoveredTaskModelConfigOptions({ taskMeta, configOptions });
}
