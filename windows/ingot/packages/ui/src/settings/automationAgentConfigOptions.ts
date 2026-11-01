import {
  getCfAgentModeSelectOptions,
  type ModelSelection,
  type CfConfigOption,
  type CfProvider,
} from "@origin-ai/cf-shared";
import type { ModelSelectionView } from "@origin-ai/cf-services";
import type { ModelSelectGroup, ModelSelectGroupItem } from "@/ModelConfigSelect.js";
import {
  buildRegistryModelSelectGroups,
  type ModelProviderGroupLabelOptions,
} from "@/lib/modelSelectionGroups.js";
import { decodeCustomModelValue, encodeCustomModelValue } from "@/lib/cfCustomModelValue.js";
import { resolveV4ModelTriggerLabel } from "@/v4/composer/modelTriggerDisplay.js";

export const AUTOMATION_DEFAULT_MODE = "build";

export function resolveAutomationPreferredModelValue(
  view: Pick<ModelSelectionView, "preferredSelection">,
): string | null {
  const preferred = view.preferredSelection;
  return preferred ? encodeCustomModelValue(preferred.providerId, preferred.modelId) : null;
}

export function buildAutomationModelSelectGroups(params: {
  selectedProvider: CfProvider;
  labels: ModelProviderGroupLabelOptions;
  registrySelectionView: ModelSelectionView;
}): ModelSelectGroup[] {
  return buildRegistryModelSelectGroups(
    params.selectedProvider,
    params.registrySelectionView,
    params.labels,
  );
}

export function buildAutomationModeOption(currentValue: string): CfConfigOption {
  return {
    id: "mode",
    name: "Mode",
    category: "mode",
    type: "select",
    currentValue,
    options: getCfAgentModeSelectOptions(),
  };
}

function findDirectModelItem(
  modelGroups: readonly ModelSelectGroup[],
  modelValue: string,
): ModelSelectGroupItem | null {
  for (const group of modelGroups) {
    const item = group.items.find((candidate) => candidate.value === modelValue);
    if (item) return item;
  }
  return null;
}

export function resolveAutomationModelItem(
  modelGroups: readonly ModelSelectGroup[],
  modelValue: string,
): ModelSelectGroupItem | null {
  const direct = findDirectModelItem(modelGroups, modelValue);
  if (direct) return direct;

  const separator = modelValue.indexOf("/");
  const qualifiedProviderId = separator > 0 ? modelValue.slice(0, separator) : null;
  const qualifiedModelId = separator > 0 ? modelValue.slice(separator + 1) : modelValue;
  const modelMatches = modelGroups.flatMap((group) =>
    group.items.filter((item) => {
      const decoded = decodeCustomModelValue(item.value);
      return decoded?.modelName === qualifiedModelId;
    }),
  );
  if (qualifiedProviderId) {
    const providerMatches = modelMatches.filter(
      (item) => decodeCustomModelValue(item.value)?.providerId === qualifiedProviderId,
    );
    if (providerMatches.length === 1) return providerMatches[0] ?? null;
  }
  return modelMatches.length === 1 ? (modelMatches[0] ?? null) : null;
}

export function resolveAutomationModelTriggerLabel(params: {
  modelGroups: readonly ModelSelectGroup[];
  modelSelectionView?: ModelSelectionView | null;
  modelValue: string;
  fallbackLabel: string;
}): string {
  const selectedItem = resolveAutomationModelItem(params.modelGroups, params.modelValue);
  if (!selectedItem) {
    const decodedModel = decodeCustomModelValue(params.modelValue);
    if (decodedModel?.modelName) {
      return decodedModel.modelName;
    }

    const separator = params.modelValue.indexOf("/");
    return separator > 0
      ? params.modelValue.slice(separator + 1)
      : params.modelValue.trim() || params.fallbackLabel;
  }

  const selectedModel = decodeCustomModelValue(selectedItem.value);
  const providerId = selectedModel?.providerId;
  const providerName =
    params.modelSelectionView?.providers.find((provider) => provider.providerId === providerId)
      ?.providerName ?? undefined;

  return resolveV4ModelTriggerLabel({
    modelGroups: params.modelGroups,
    normalizedValue: selectedItem.value,
    fallbackLabel: params.fallbackLabel,
    providerId,
    providerName,
  });
}

export function buildAutomationThoughtLevelOption(
  runtimeOption: CfConfigOption | undefined,
  currentValue: string,
): CfConfigOption | null {
  const options = runtimeOption?.options ?? [];
  if (options.length === 0) return null;
  const validCurrentValue = options.some((option) => option.value === currentValue);
  const resolvedValue = validCurrentValue ? currentValue : "";

  return {
    id: "thought_level",
    name: runtimeOption?.name ?? "Effort",
    category: "thought_level",
    type: "select",
    currentValue: resolvedValue,
    options: options.map((option) => ({ ...option })),
  };
}

export function resolveAutomationThoughtLevelUpdate(params: {
  editing: boolean;
  explicitlyChanged: boolean;
  modelChanged: boolean;
  persistedReasoningLevel?: string;
  resolvedThoughtLevel: string;
  thoughtLevel: string;
}): string | null | undefined {
  if (params.resolvedThoughtLevel) {
    if (params.explicitlyChanged) return params.thoughtLevel;
    if (params.editing && !params.modelChanged) {
      return params.persistedReasoningLevel?.trim() || params.resolvedThoughtLevel;
    }
    return params.resolvedThoughtLevel;
  }
  return params.editing ? null : undefined;
}

export function buildAutomationModelSelection(params: {
  selected: ModelSelection;
  reasoningLevel?: string | null;
  previous?: ModelSelection;
}): ModelSelection {
  const reasoningLevel = params.reasoningLevel?.trim();
  const options = reasoningLevel ? { reasoningLevel } : {};
  return {
    providerId: params.selected.providerId,
    modelId: params.selected.modelId,
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };
}
