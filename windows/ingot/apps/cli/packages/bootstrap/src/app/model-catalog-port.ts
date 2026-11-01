// ============================================================
// ============================================================
//

import type { ModelCatalogEntry, ModelCatalogPort } from "@origin-ai/cf-contracts";
import type { ModelSelection } from "@origin-ai/cf-shared/model-selection";
import type { ProviderRegistryModelSource } from "./provider-registry-model-runtime.js";

interface ModelCatalogPortDeps {
  
  registry: ProviderRegistryModelSource;
  
  currentSelection: () => ModelSelection | undefined;
}

export function createModelCatalogPort(deps: ModelCatalogPortDeps): ModelCatalogPort {
  return {
    listModels(): ModelCatalogEntry[] {
      const view = deps.registry.getView();
      const current = deps.currentSelection();
      return view.providers.flatMap((provider) =>
        provider.models.map((model): ModelCatalogEntry => {
          const reasoning = model.config.optionSpecs.reasoningLevel;
          const reasoningLevels = [...reasoning.values];
          const defaultReasoningLevel = reasoning.values.at(-1);
          const contextWindow = model.config.properties.contextWindow;
          const providerLabel = provider.providerName?.trim();
          return {
            providerId: provider.providerId,
            modelId: model.modelId,
            ...(providerLabel ? { providerLabel } : {}),
            reasoningLevels,
            ...(defaultReasoningLevel === undefined ? {} : { defaultReasoningLevel }),
            ...(contextWindow === undefined ? {} : { contextWindow }),
            current:
              current !== undefined &&
              current.providerId === provider.providerId &&
              current.modelId === model.modelId,
          };
        }),
      );
    },
  };
}
