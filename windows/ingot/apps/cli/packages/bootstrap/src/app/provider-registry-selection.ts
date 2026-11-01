import { ModelErrorCode, ModelProtocolError } from "@origin-ai/cf-contracts";
import {
  normalizeModelSelection,
  type ModelSelection,
  type Provider,
  type ProviderModel,
} from "@origin-ai/cf-provider";
import type { CfModelOption } from "@origin-ai/cf-shared";
import type { ProviderRegistryModelSource } from "./provider-registry-model-runtime.js";

export interface ResolvedRegistrySelection {
  readonly provider: Provider;
  readonly model: ProviderModel;
  readonly selection: ModelSelection;
}

export function listRegistryBackedModels(
  registry: ProviderRegistryModelSource,
): CfModelOption[] {
  const view = registry.getView();
  return view.providers.flatMap((provider) =>
    provider.models.map((model) => toModelOption(provider, model)),
  );
}

export function getRegistryBackedModel(
  registry: ProviderRegistryModelSource,
  selection: ModelSelection,
): CfModelOption | undefined {
  const provider = registry.getProvider(selection.providerId);
  const model = registry.getModel(selection.providerId, selection.modelId);
  return provider && model ? toModelOption(provider, model) : undefined;
}

export function completeAuxiliaryRegistryModelSelection(
  registry: ProviderRegistryModelSource,
  selection: ModelSelection,
): ModelSelection {
  const model = registry.getModel(selection.providerId, selection.modelId);
  const reasoningLevel = model?.config.optionSpecs.reasoningLevel.values[0];
  if (!reasoningLevel) return selection;
  return {
    providerId: selection.providerId,
    modelId: selection.modelId,
    options: {
      ...selection.options,
      reasoningLevel,
    },
  };
}

export function resolveRegistryOwnedSelection(
  registry: ProviderRegistryModelSource,
  requested: string,
  configuredDefault?: ModelSelection,
  options?: { allowMissingReasoning?: boolean },
): ResolvedRegistrySelection | undefined {
  const parsed = parseRequestedModelSelection(requested, configuredDefault);
  const selection =
    parsed && requested.trim() !== "main"
      ? normalizeModelSelection(registry.getView(), parsed)
      : parsed;
  return selection ? resolveRegistryOwnedModelSelection(registry, selection, options) : undefined;
}

function parseRequestedModelSelection(
  requested: string,
  configuredDefault?: ModelSelection,
): ModelSelection | undefined {
  const normalized = requested.trim();
  if (normalized === "main") return configuredDefault;
  return parseProviderQualifiedModelSelection(normalized);
}

export function parseProviderQualifiedModelSelection(
  requested: string,
): ModelSelection | undefined {
  const normalized = requested.trim();
  const separator = normalized.indexOf("/");
  if (separator <= 0 || separator === normalized.length - 1) return undefined;
  const providerId = normalized.slice(0, separator).trim();
  const modelId = normalized.slice(separator + 1).trim();
  return providerId && modelId ? { providerId, modelId } : undefined;
}

export function resolveRegistryOwnedModelSelection(
  registry: ProviderRegistryModelSource,
  selection: ModelSelection,
  options?: { allowMissingReasoning?: boolean },
): ResolvedRegistrySelection | undefined {
  const validation = registry.validateSelection(selection);
  if (!validation.ok) {
    if (validation.code === "provider-not-found") return undefined;
    if (validation.code === "reasoning-level-missing" && options?.allowMissingReasoning) {
      return resolveRegistryModelSelection(registry, selection);
    }
    throw createRegistrySelectionProtocolError(validation);
  }
  const resolved = resolveRegistryModelSelection(registry, selection);
  if (!resolved) throw new Error("Registry Selection 校验与索引结果不一致");
  return resolved;
}

export function createRegistrySelectionProtocolError(
  validation: Exclude<ReturnType<ProviderRegistryModelSource["validateSelection"]>, { ok: true }>,
): ModelProtocolError {
  switch (validation.code) {
    case "provider-not-found":
      return new ModelProtocolError(
        ModelErrorCode.ProviderNotFound,
        `Provider Registry Medium不存在 Provider: ${validation.providerId}`,
      );
    case "model-not-found":
      return new ModelProtocolError(
        ModelErrorCode.ModelNotFound,
        `Model does not exist in Provider Registry: ${validation.providerId}/${validation.modelId}`,
      );
    case "reasoning-level-missing":
      return new ModelProtocolError(
        ModelErrorCode.InvalidModelRequest,
        `Reasoning level is required for ${validation.providerId}/${validation.modelId}`,
      );
    case "reasoning-level-not-supported":
      return new ModelProtocolError(
        ModelErrorCode.InvalidModelRequest,
        `Reasoning effort "${validation.reasoningLevel}" is not supported by ${validation.providerId}/${validation.modelId}`,
      );
  }
}

export function resolveRegistryModelSelection(
  registry: ProviderRegistryModelSource,
  selection: ModelSelection,
): ResolvedRegistrySelection | undefined {
  const provider = registry.getProvider(selection.providerId);
  const model = registry.getModel(selection.providerId, selection.modelId);
  if (!provider || !model) return undefined;
  return {
    provider,
    model,
    selection: {
      providerId: selection.providerId,
      modelId: selection.modelId,
      ...(selection.options ? { options: { ...selection.options } } : {}),
    },
  };
}

export function resolveRegistryThoughtLevel(
  selection: ResolvedRegistrySelection | undefined,
  requested?: string,
): string | undefined {
  const spec = selection?.model.config.optionSpecs.reasoningLevel;
  if (!spec) return undefined;
  return requested && spec.values.includes(requested) ? requested : undefined;
}

export function requireRegistryThoughtLevel(
  selection: ResolvedRegistrySelection,
  requested: string,
): string {
  const spec = selection.model.config.optionSpecs.reasoningLevel;
  if (!spec.values.includes(requested)) {
    throw new Error(`Unsupported reasoning effort: ${requested}`);
  }
  return requested;
}

function toModelOption(provider: Provider, model: ProviderModel): CfModelOption {
  const properties = model.config.properties;
  const optionSpecs = model.config.optionSpecs;
  const reasoning = optionSpecs.reasoningLevel;
  return {
    ref: { providerId: provider.providerId, modelId: model.modelId },
    label: model.modelId,
    providerLabel: provider.providerName ?? provider.providerId,
    contextWindow: properties.contextWindow,
    maxOutputTokens: optionSpecs.maxOutputTokens.max,
    reasoning: {
      levels: reasoning.values.map((level) => ({ value: level, label: level })),
      defaultLevel: reasoning.values.at(-1),
    },
    properties: {
      inputFormat: properties.inputFormat,
      outputFormat: properties.outputFormat,
    },
  };
}
