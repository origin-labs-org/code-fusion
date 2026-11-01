import { BUILTIN_PROVIDER_TEMPLATE_IDS } from "@origin-ai/cf-shared";
import {
  ApiKeyAccessConfig,
  ModelConfig,
  ModelConfigRules,
  ModelPropertiesConfig,
  ProviderApiConfig,
  ProviderConfig,
  ProviderConfigMap,
  type ProviderConfigLayerUpdate,
} from "@origin-ai/cf-provider";
import {
  isModelProviderModelConfig,
  normalizeModelProviderConfiguredBaseUrl,
  resolveModelProviderApiFormat,
  resolveModelProviderRuntimeBaseUrl,
  type ModelProviderConfig,
  type ModelProviderModelEntry,
} from "./legacyModelProviderSerialized.js";

interface LegacyPersonalProviderConfigImportInput {
  readonly legacyProviders: readonly ModelProviderConfig[];
}

interface LegacyPersonalModelMember {
  readonly modelId: string;
  readonly contextWindow?: number;
}

export function importLegacyPersonalProviderConfig(
  input: LegacyPersonalProviderConfigImportInput,
): ProviderConfigLayerUpdate {
  let providers = ProviderConfigMap.empty();
  let models = ModelConfigRules.empty();

  for (const legacy of input.legacyProviders) {
    const providerId = legacy.id.trim();
    if (!providerId) continue;
    const apiTemplateId =
      providerId === "builtin:bigmodel"
        ? BUILTIN_PROVIDER_TEMPLATE_IDS.bigmodel
        : providerId === "builtin:zai"
          ? BUILTIN_PROVIDER_TEMPLATE_IDS.zai
          : undefined;
    if (apiTemplateId) {
      const apiKey = legacy.apiKey.trim();
      if (apiKey)
        providers = providers.setRule({
          providerId: apiTemplateId,
          templateId: apiTemplateId,
          config: new ProviderConfig({
            group: "standard-personal",
            access: new ApiKeyAccessConfig({ apiKey }),
          }),
        });
      continue;
    }
    if (providerId.startsWith("builtin:") || providerId.startsWith("account:")) continue;
    if (legacy.source !== undefined && legacy.source !== "custom") continue;

    const members = collectLegacyPersonalModelMembers(legacy.models);
    const modelIds = members.map((member) => member.modelId);
    const providerName = legacy.name.trim();
    providers = providers.setRule({
      providerId,
      ...(legacy.enabled !== undefined ? { enabled: legacy.enabled } : {}),
      ...(providerName && providerName !== providerId ? { providerName } : {}),
      config: createPersonalProviderConfig(legacy, modelIds),
    });

    for (const member of members) {
      if (member.contextWindow === undefined) continue;
      models = models.setExact(
        providerId,
        member.modelId,
        new ModelConfig({
          properties: new ModelPropertiesConfig({
            contextWindow: member.contextWindow,
          }),
        }),
      );
    }
  }

  return Object.freeze({ providers, models });
}

function createPersonalProviderConfig(
  legacy: ModelProviderConfig,
  modelIds: readonly string[],
): ProviderConfig {
  return new ProviderConfig({
    group: "standard-personal",
    access: new ApiKeyAccessConfig({
      apiKey: legacy.apiKey.trim() || undefined,
      apiKeyManagementUrl: legacy.apiKeyUrl,
    }),
    api: new ProviderApiConfig({
      type: resolveModelProviderApiFormat(legacy),
      baseUrl:
        resolveModelProviderRuntimeBaseUrl(legacy) ||
        normalizeModelProviderConfiguredBaseUrl(legacy.endpoints.baseURL ?? ""),
      headers: legacy.headers,
    }),
    ...(modelIds.length > 0 ? { personalModelIds: modelIds, modelOrder: modelIds } : {}),
  });
}

function collectLegacyPersonalModelMembers(
  entries: readonly ModelProviderModelEntry[],
): readonly LegacyPersonalModelMember[] {
  const seen = new Set<string>();
  const members: LegacyPersonalModelMember[] = [];

  for (const entry of entries) {
    const modelId = (typeof entry === "string" ? entry : entry.id).trim();
    if (!modelId || seen.has(modelId)) continue;
    if (isModelProviderModelConfig(entry) && entry.deleted === true) continue;
    seen.add(modelId);
    members.push({
      modelId,
      ...(isModelProviderModelConfig(entry) && isPositiveInteger(entry.contextWindow)
        ? { contextWindow: entry.contextWindow }
        : {}),
    });
  }

  return members;
}

function isPositiveInteger(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0
  );
}
