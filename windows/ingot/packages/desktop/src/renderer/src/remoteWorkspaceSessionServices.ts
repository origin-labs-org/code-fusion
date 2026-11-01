import type { IServiceAccessor } from "@origin-ai/cf-services";
import type { RemoteTarget } from "@origin-ai/cf-shared";

export function buildRemoteWorkspaceSessionServices(
  baseServices: IServiceAccessor,
  remoteServices: IServiceAccessor,
): IServiceAccessor {
  return {
    ...baseServices,
    fileService: remoteServices.fileService,
    genUiService: remoteServices.genUiService,
    mediaPreviewService: remoteServices.mediaPreviewService,
    gitService: remoteServices.gitService,
    gitCheckpointService: remoteServices.gitCheckpointService,
    systemService: remoteServices.systemService,
    terminalService: remoteServices.terminalService,
    promptAttachmentTransferService: remoteServices.promptAttachmentTransferService,
    cfAgentService: remoteServices.cfAgentService,
    cfTaskService: remoteServices.cfTaskService,
    cfSessionService: remoteServices.cfSessionService,
    conversationShareService: remoteServices.conversationShareService,
    fileWatcherService: remoteServices.fileWatcherService,
    modelSelectionService: remoteServices.modelSelectionService,
    providerSettingsService: remoteServices.providerSettingsService,
    skillsService: remoteServices.skillsService,
    skillSyncService: remoteServices.skillSyncService,
    mcpSyncService: remoteServices.mcpSyncService,
    pluginSyncService: remoteServices.pluginSyncService,
    pluginsService: remoteServices.pluginsService,
    pluginManagementService: remoteServices.pluginManagementService,
    commandsService: remoteServices.commandsService,
    hooksService: remoteServices.hooksService,
  };
}

export function buildServerRemoteWorkspaceSessionServices(
  _baseServices: IServiceAccessor,
  remoteServices: IServiceAccessor,
): IServiceAccessor {
  return remoteServices;
}

export function buildRemoteWorkspaceSessionServicesForRegistration(params: {
  baseServices: IServiceAccessor;
  remoteServices: IServiceAccessor;
  targetKind: RemoteTarget["kind"];
  sourceServerId?: string;
}): IServiceAccessor {
  return params.targetKind === "server" || params.sourceServerId?.trim()
    ? buildServerRemoteWorkspaceSessionServices(params.baseServices, params.remoteServices)
    : buildRemoteWorkspaceSessionServices(params.baseServices, params.remoteServices);
}
