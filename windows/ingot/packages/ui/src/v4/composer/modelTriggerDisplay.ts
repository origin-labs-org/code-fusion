import {
  BUILTIN_MODEL_PROVIDER_IDS,
  resolveModelProviderFamilyIdByProviderId,
} from "@origin-ai/cf-shared";
import type { IntlInstance } from "@/i18n/IntlProvider.js";
import type { ModelSelectGroup } from "@/ModelConfigSelect.js";

export interface V4ModelTriggerDisplay {
  fullLabel: string;
  modelLabel: string;
  providerPrefix?: string;
}

export function formatModelChangeLabel(
  providerId: string | undefined,
  providerName: string | undefined,
  modelName: string,
  intl: Pick<IntlInstance, "formatMessage">,
): string {
  let planLabelId: string;
  switch (providerId) {
    case BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan:
    case BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan:
      planLabelId = "settings.modelProvider.connectionMode.codingPlan";
      break;
    case BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan:
    case BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan:
      planLabelId = "settings.modelProvider.connectionMode.startPlan";
      break;
    case BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan:
    case BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan:
      planLabelId = "settings.modelProvider.connectionMode.teamPlan";
      break;
    default:
      return formatProviderModelLabel(providerId, providerName, modelName);
  }
  return `${modelName}(${intl.formatMessage({ id: planLabelId })})`;
}

export function formatProviderModelLabel(
  providerId: string | undefined,
  providerName: string | undefined,
  modelName: string,
): string {
  if (providerId && resolveModelProviderFamilyIdByProviderId(providerId)) {
    return modelName;
  }

  const normalizedProviderName = providerName?.trim();
  return normalizedProviderName ? `${normalizedProviderName}/${modelName}` : modelName;
}

export function resolveV4ModelTriggerLabel({
  modelGroups,
  normalizedValue,
  fallbackLabel,
  providerId,
  providerName,
}: {
  modelGroups: readonly ModelSelectGroup[];
  normalizedValue: string;
  fallbackLabel: string;
  providerId: string | undefined;
  providerName?: string;
}): string {
  const selectedGroup = modelGroups.find((group) =>
    group.items.some((item) => item.value === normalizedValue),
  );
  const selectedItem = selectedGroup?.items.find((item) => item.value === normalizedValue);
  if (!selectedGroup || !selectedItem) {
    return fallbackLabel;
  }

  return formatProviderModelLabel(
    providerId,
    providerName?.trim() || providerId,
    selectedItem.name,
  );
}

export function resolveV4ModelTriggerDisplay({
  modelGroups,
  normalizedValue,
  fallbackLabel,
  providerId,
  providerName,
}: {
  modelGroups: readonly ModelSelectGroup[];
  normalizedValue: string;
  fallbackLabel: string;
  providerId: string | undefined;
  providerName?: string;
}): V4ModelTriggerDisplay {
  const fullLabel = resolveV4ModelTriggerLabel({
    modelGroups,
    normalizedValue,
    fallbackLabel,
    providerId,
    providerName,
  });
  const selectedGroup = modelGroups.find((group) =>
    group.items.some((item) => item.value === normalizedValue),
  );
  const selectedItem = selectedGroup?.items.find((item) => item.value === normalizedValue);
  if (!selectedGroup || !selectedItem) {
    return { fullLabel, modelLabel: fallbackLabel };
  }

  const modelLabel = selectedItem.name;
  const normalizedProviderName = providerName?.trim() || providerId;
  if (
    !normalizedProviderName ||
    (providerId && resolveModelProviderFamilyIdByProviderId(providerId))
  ) {
    return { fullLabel, modelLabel };
  }

  return {
    fullLabel,
    providerPrefix: `${normalizedProviderName}/`,
    modelLabel,
  };
}
