import { isApiKeyAccess } from "@origin-ai/cf-provider";
import type {
  ConfigValidationIssue,
  AccountProviderState,
  ModelConfigObject,
  ProviderConfigObject,
  ProviderSettingsProviderView,
} from "@origin-ai/cf-provider";

export interface ProviderSettingsFormProvider extends Pick<
  ProviderSettingsProviderView,
  "providerName" | "templateId"
> {
  providerId: string;
  
  providerNameUpdate?: string | null;
  
  enabledUpdate?: boolean;
  enabled: boolean;
  
  executable: boolean;
  accountState?: AccountProviderState;
  issues?: readonly ConfigValidationIssue[];
  hasPersonalConfig: boolean;
  
  personalConfig: ProviderConfigObject;
  
  config: ProviderConfigObject;
  models: ProviderSettingsFormModel[];
}

export interface ProviderSettingsFormModel {
  kind: "candidate";
  modelId: string;
  builtin: boolean;
  
  inheritedConfig?: ModelConfigObject;
  personalConfig: ModelConfigObject;
  
  useRecommendedConfig?: boolean;
  config: ModelConfigObject;
  hasPersonalConfig: boolean;
  executable: boolean;
  selectable: boolean;
  issues?: readonly ConfigValidationIssue[];
}

export function getProviderFormLabel(
  provider: Pick<ProviderSettingsFormProvider, "providerId" | "providerName">,
): string {
  return provider.providerName?.trim() || provider.providerId;
}

export function getProviderFormApiKey(
  provider: Pick<ProviderSettingsFormProvider, "config">,
): string {
  return isApiKeyAccess(provider.config.access) ? (provider.config.access.apiKey ?? "") : "";
}

export function getProviderFormApiKeyManagementUrl(
  provider: Pick<ProviderSettingsFormProvider, "config">,
): string | undefined {
  return isApiKeyAccess(provider.config.access)
    ? (provider.config.access.apiKeyManagementUrl ?? undefined)
    : undefined;
}
