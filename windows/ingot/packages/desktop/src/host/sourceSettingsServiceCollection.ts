import {
  ServiceCollection,
  ICredentialService,
  IOAuthService,
  ICodingPlanSubscriptionService,
  ISettingService,
  ISystemService,
  ISourceServerWorkspaceService,
  ISkillsService,
  ISkillSyncService,
  IMcpSyncService,
  IPluginSyncService,
  IPluginsService,
  IPluginManagementService,
  ICommandsService,
  IHooksService,
  ISubagentsService,
  IMemoryService,
  IOutputStyleService,
  ISettingsSyncService,
  type IServiceAccessor,
  type ServiceDescriptor,
} from "@origin-ai/cf-services";
import type { SourceServerConnectionState } from "@origin-ai/cf-shared";

export function shouldDetachSourceSettingsAttachment(state: SourceServerConnectionState): boolean {
  return state !== "online";
}

export function createSourceSettingsServiceCollection(
  services: IServiceAccessor | ServiceCollection,
): ServiceCollection {
  const read = <T>(descriptor: ServiceDescriptor<T>, get: (accessor: IServiceAccessor) => T): T =>
    services instanceof ServiceCollection ? services.get(descriptor) : get(services);
  return new ServiceCollection()
    .register(
      ICredentialService,
      read(ICredentialService, (accessor) => accessor.credentialService),
    )
    .register(
      IOAuthService,
      read(IOAuthService, (accessor) => accessor.oauthService),
    )
    .register(
      ICodingPlanSubscriptionService,
      read(ICodingPlanSubscriptionService, (accessor) => accessor.codingPlanSubscriptionService),
    )
    .register(
      ISettingService,
      read(ISettingService, (accessor) => accessor.settingService),
    )
    .register(
      ISystemService,
      read(ISystemService, (accessor) => accessor.systemService),
    )
    .register(
      ISourceServerWorkspaceService,
      read(ISourceServerWorkspaceService, (accessor) => accessor.sourceServerWorkspaceService),
    )
    .register(
      ISkillsService,
      read(ISkillsService, (accessor) => accessor.skillsService),
    )
    .register(
      ISkillSyncService,
      read(ISkillSyncService, (accessor) => accessor.skillSyncService),
    )
    .register(
      IMcpSyncService,
      read(IMcpSyncService, (accessor) => accessor.mcpSyncService),
    )
    .register(
      IPluginSyncService,
      read(IPluginSyncService, (accessor) => accessor.pluginSyncService),
    )
    .register(
      IPluginsService,
      read(IPluginsService, (accessor) => accessor.pluginsService),
    )
    .register(
      IPluginManagementService,
      read(IPluginManagementService, (accessor) => accessor.pluginManagementService),
    )
    .register(
      ICommandsService,
      read(ICommandsService, (accessor) => accessor.commandsService),
    )
    .register(
      IHooksService,
      read(IHooksService, (accessor) => accessor.hooksService),
    )
    .register(
      ISubagentsService,
      read(ISubagentsService, (accessor) => accessor.subagentsService),
    )
    .register(
      IMemoryService,
      read(IMemoryService, (accessor) => accessor.memoryService),
    )
    .register(
      IOutputStyleService,
      read(IOutputStyleService, (accessor) => accessor.outputStyleService),
    )
    .register(
      ISettingsSyncService,
      read(ISettingsSyncService, (accessor) => accessor.settingsSyncService),
    );
}
