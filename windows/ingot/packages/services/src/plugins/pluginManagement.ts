import type {
  CfPluginOperationProgressNotification,
  CfPluginsCancelOperationResult,
  CfPluginsConfigureResult,
  CfPluginsDescribeResult,
  CfPluginsInstallResult,
  CfPluginsListResult,
  CfPluginsMarketplaceMutationResult,
  CfPluginsOverviewResult,
  CfPluginsReferenceCatalogResult,
  CfPluginsResolveSuggestedReferenceResult,
  CfPluginsRestoreBuiltinResult,
  CfPluginsSetEnabledResult,
  CfPluginsUninstallResult,
  CfPluginsValidateResult,
} from "@origin-ai/cf-shared";
import { ServiceChannels } from "@origin-ai/cf-shared";
import type { Event } from "@origin-ai/cf-rpc";
import { createServiceDescriptor } from "../descriptors.js";
import type {
  CfAgentAddPluginMarketplaceParams,
  CfAgentCancelPluginOperationParams,
  CfAgentConfigurePluginParams,
  CfAgentDescribePluginParams,
  CfAgentInstallPluginParams,
  CfAgentPluginReferenceCatalogParams,
  CfAgentPluginViewParams,
  CfAgentRemovePluginMarketplaceParams,
  CfAgentResetPluginConfigParams,
  CfAgentResolveSuggestedPluginReferenceParams,
  CfAgentRestoreBuiltinPluginParams,
  CfAgentSetPluginEnabledParams,
  CfAgentUninstallPluginParams,
  CfAgentUpdatePluginMarketplaceParams,
  CfAgentUpdatePluginParams,
  CfAgentValidatePluginParams,
} from "../cf-agent/cfAgentPluginParams.js";

export interface IPluginManagementService {
  listPlugins(params: CfAgentPluginViewParams): Promise<CfPluginsListResult>;
  getPluginReferenceCatalog(
    params: CfAgentPluginReferenceCatalogParams,
  ): Promise<CfPluginsReferenceCatalogResult>;
  resolveSuggestedPluginReference(
    params: CfAgentResolveSuggestedPluginReferenceParams,
  ): Promise<CfPluginsResolveSuggestedReferenceResult>;
  onDynamicPluginOperationProgress(
    operationId: string,
  ): Event<CfPluginOperationProgressNotification>;
  getPluginsOverview(params: CfAgentPluginViewParams): Promise<CfPluginsOverviewResult>;
  addPluginMarketplace(
    params: CfAgentAddPluginMarketplaceParams,
  ): Promise<CfPluginsMarketplaceMutationResult>;
  removePluginMarketplace(
    params: CfAgentRemovePluginMarketplaceParams,
  ): Promise<CfPluginsMarketplaceMutationResult>;
  updatePluginMarketplace(
    params: CfAgentUpdatePluginMarketplaceParams,
  ): Promise<CfPluginsMarketplaceMutationResult>;
  installPlugin(params: CfAgentInstallPluginParams): Promise<CfPluginsInstallResult>;
  cancelPluginOperation(
    params: CfAgentCancelPluginOperationParams,
  ): Promise<CfPluginsCancelOperationResult>;
  uninstallPlugin(params: CfAgentUninstallPluginParams): Promise<CfPluginsUninstallResult>;
  updatePlugin(params: CfAgentUpdatePluginParams): Promise<CfPluginsInstallResult>;
  restoreBuiltinPlugin(
    params: CfAgentRestoreBuiltinPluginParams,
  ): Promise<CfPluginsRestoreBuiltinResult>;
  configurePlugin(params: CfAgentConfigurePluginParams): Promise<CfPluginsConfigureResult>;
  resetPluginConfig(
    params: CfAgentResetPluginConfigParams,
  ): Promise<CfPluginsConfigureResult>;
  validatePlugin(params: CfAgentValidatePluginParams): Promise<CfPluginsValidateResult>;
  describePlugin(params: CfAgentDescribePluginParams): Promise<CfPluginsDescribeResult>;
  setPluginEnabled(params: CfAgentSetPluginEnabledParams): Promise<CfPluginsSetEnabledResult>;
}

export const IPluginManagementService = createServiceDescriptor<IPluginManagementService>(
  ServiceChannels.PluginManagement,
);

export function withPluginTelemetry(
  service: IPluginManagementService,
  telemetry: NonNullable<CfAgentInstallPluginParams["telemetry"]>,
): IPluginManagementService {
  const mutations = new Set<PropertyKey>([
    "addPluginMarketplace",
    "removePluginMarketplace",
    "updatePluginMarketplace",
    "installPlugin",
    "uninstallPlugin",
    "updatePlugin",
    "restoreBuiltinPlugin",
    "configurePlugin",
    "resetPluginConfig",
    "setPluginEnabled",
  ]);
  return new Proxy(service, {
    get(target, property) {
      const method = Reflect.get(target, property, target);
      if (typeof method !== "function") return method;
      if (!mutations.has(property)) return method.bind(target);
      return (params: CfAgentInstallPluginParams) =>
        method.call(target, { ...params, telemetry });
    },
  });
}
