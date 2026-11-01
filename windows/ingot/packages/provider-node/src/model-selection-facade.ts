import { ModelSelectionFacade, type ProviderRegistryFacadeSource } from "@origin-ai/cf-provider";
import {
  isBuiltinModelProviderId,
  isStartPlanModelProviderId,
  OFF_PEAK_PROVIDER_IDS,
} from "@origin-ai/cf-shared";
import { resolveLegacyReasoningLevel } from "./legacy-reasoning-level.js";

export function createNodeModelSelectionFacade(
  source: ProviderRegistryFacadeSource,
): ModelSelectionFacade {
  return new ModelSelectionFacade(
    source,
    (providerId) => {
      if (isStartPlanModelProviderId(providerId)) return "ordinary";
      if (isBuiltinModelProviderId(providerId)) return "account-plan";
      if (Object.values(OFF_PEAK_PROVIDER_IDS).some((id) => id === providerId))
        return "account-offpeak";
      return "ordinary";
    },
    resolveLegacyReasoningLevel,
  );
}
