import {
  ServiceCollection,
  IFileService,
  IGenUiService,
  IMediaPreviewService,
  IGitService,
  IGitCheckpointService,
  ISystemService,
  ITerminalService,
  ISettingService,
  IOnboardingRecordService,
  ICredentialService,
  IBroadcastService,
  ICfTaskService,
  ICfAgentService,
  ICfSessionService,
  IConversationShareService,
  createUnsupportedConversationShareService,
  IBotsService,
  IFileWatcherService,
  IOAuthService,
  IModelSelectionService,
  IProviderSettingsService,
  ISourceServerWorkspaceService,
  IUsageStatsService,
  ICodingPlanSubscriptionService,
  IClientConfigService,
  IClientScenesService,
  ISkillsService,
  ISkillSyncService,
  IMcpSyncService,
  IPluginSyncService,
  IPluginsService,
  IPluginManagementService,
  ISubagentsService,
  ICommandsService,
  IHooksService,
  IMemoryService,
  IOutputStyleService,
  ISettingsSyncService,
  IProjectService,
  ITaskGroupService,
  IRemoteProjectService,
  IPromptAttachmentTransferService,
  type ServiceDescriptor,
  type IServiceAccessor,
} from "@origin-ai/cf-services";
import {
  REMOTE_WORKSPACE_RPC_CHANNELS,
  assertRemoteWorkspaceRpcContract,
} from "./remoteWorkspaceRpcContract.js";
import {
  createServiceLogger,
  createLegacySingleRootProjectService,
  createRemoteProjectService,
} from "@origin-ai/cf-services/node";
import {
  buildServerRemoteWorkspaceIdentity,
  remoteHostIdFromWorkspaceIdentity,
} from "@origin-ai/cf-shared";
import type { RemoteTarget } from "@origin-ai/cf-shared";
import {
  createRemoteProviderProvisioningExecutorFromWorkspace,
  registerRemoteProviderProvisioningExecutor,
} from "./remoteProviderProvisioningService.js";

export const REMOTE_WORKSPACE_RPC_REGISTRATIONS = [
  ["fileService", IFileService],
  ["genUiService", IGenUiService],
  ["mediaPreviewService", IMediaPreviewService],
  ["gitService", IGitService],
  ["gitCheckpointService", IGitCheckpointService],
  ["systemService", ISystemService],
  ["terminalService", ITerminalService],
  ["settingService", ISettingService],
  ["onboardingRecordService", IOnboardingRecordService],
  ["credentialService", ICredentialService],
  ["broadcastService", IBroadcastService],
  ["cfTaskService", ICfTaskService],
  ["cfAgentService", ICfAgentService],
  ["cfSessionService", ICfSessionService],
  ["conversationShareService", IConversationShareService],
  ["botsService", IBotsService],
  ["fileWatcherService", IFileWatcherService],
  ["oauthService", IOAuthService],
  ["providerSettingsService", IProviderSettingsService],
  ["modelSelectionService", IModelSelectionService],
  ["sourceServerWorkspaceService", ISourceServerWorkspaceService],
  ["usageStatsService", IUsageStatsService],
  ["codingPlanSubscriptionService", ICodingPlanSubscriptionService],
  ["clientScenesService", IClientScenesService],
  ["skillsService", ISkillsService],
  ["skillSyncService", ISkillSyncService],
  ["mcpSyncService", IMcpSyncService],
  ["pluginSyncService", IPluginSyncService],
  ["pluginsService", IPluginsService],
  ["pluginManagementService", IPluginManagementService],
  ["subagentsService", ISubagentsService],
  ["commandsService", ICommandsService],
  ["hooksService", IHooksService],
  ["memoryService", IMemoryService],
  ["outputStyleService", IOutputStyleService],
  ["settingsSyncService", ISettingsSyncService],
  ["promptAttachmentTransferService", IPromptAttachmentTransferService],
] as const satisfies readonly [keyof IServiceAccessor, ServiceDescriptor<unknown>][];

const conversationShareLog = createServiceLogger("conversation-share");

function createUnsupportedRemoteConversationShareService(): IConversationShareService {
  return createUnsupportedConversationShareService({
    message: "Conversation sharing is not available for this client or remote target",
    onRejected: (action) => {
      conversationShareLog.warn(undefined, "conversation share action rejected", {
        action,
        kind: "feature_disabled",
        reason: "server_remote_unsupported",
      });
    },
  });
}

export function resolveServerProjectService(params: {
  connectionServices: IServiceAccessor;
  serverId: string;
  virtualProjects?: boolean;
  sourceServices?: ServiceCollection;
}): IProjectService {
  if (params.virtualProjects) {
    if (!params.connectionServices.projectService)
      throw new Error("Remote virtual-project RPC registration incomplete");
    return params.connectionServices.projectService;
  }
  const hostId = remoteHostIdFromWorkspaceIdentity(
    buildServerRemoteWorkspaceIdentity({ serverId: params.serverId, workspacePath: "/" }),
  )!;
  return createLegacySingleRootProjectService({
    hostId,
    directories: {
      info: () => params.connectionServices.systemService.info(),
      read: (input) => params.connectionServices.fileService.readdir(input),
    },
    readSettings: () => params.connectionServices.settingService.get(),
    readKnownWorkspaces: async () => {
      const directory = await params.sourceServices
        ?.getOptional(IRemoteProjectService)
        ?.readDirectory();
      return (directory?.entries ?? [])
        .filter((entry) => entry.hostId === hostId)
        .flatMap((entry) =>
          entry.roots.length
            ? entry.roots.map((root) => ({ workspacePath: root.rootPath }))
            : entry.legacyWorkspace
              ? [
                  {
                    workspacePath: entry.legacyWorkspace.workspacePath,
                    workspacePurpose: entry.legacyWorkspace.workspacePurpose,
                  },
                ]
              : [],
        );
    },
    readTasks: ({ workspacePath, kind }) => {
      const tasks = params.connectionServices.cfTaskService;
      const scope = { workspacePath };
      return kind === "pinned"
        ? tasks.listPinnedTasks(scope)
        : kind === "archived"
          ? tasks.listArchivedTasks(scope)
          : tasks.listTasks(scope);
    },
    ensureConversation: async () =>
      (await params.connectionServices.fileService.ensureConversationWorkspace()).path,
  });
}

export function createServerRemoteWorkspaceServiceCollection(params: {
  clientConfigService: IClientConfigService;
  connectionServices: IServiceAccessor;
  virtualProjects?: boolean;
  serverId?: string;
  targetKind: RemoteTarget["kind"];
  
  sourceServices?: ServiceCollection;
}): ServiceCollection {
  assertRemoteWorkspaceRpcContract(params.connectionServices);
  const remoteProviderProvisioningExecutor =
    createRemoteProviderProvisioningExecutorFromWorkspace(params);
  const services = new ServiceCollection()
    .register(IFileService, params.connectionServices.fileService)
    .register(IGenUiService, params.connectionServices.genUiService)
    .register(IMediaPreviewService, params.connectionServices.mediaPreviewService)
    .register(IGitService, params.connectionServices.gitService)
    .register(IGitCheckpointService, params.connectionServices.gitCheckpointService)
    .register(ISystemService, params.connectionServices.systemService)
    .register(ITerminalService, params.connectionServices.terminalService)
    .register(ISettingService, params.connectionServices.settingService)
    .register(IOnboardingRecordService, params.connectionServices.onboardingRecordService)
    .register(ICredentialService, params.connectionServices.credentialService)
    .register(IBroadcastService, params.connectionServices.broadcastService)
    .register(ICfTaskService, params.connectionServices.cfTaskService)
    .register(ICfAgentService, params.connectionServices.cfAgentService)
    .register(ICfSessionService, params.connectionServices.cfSessionService)
    .register(
      IConversationShareService,
      params.targetKind === "server"
        ? createUnsupportedRemoteConversationShareService()
        : params.connectionServices.conversationShareService,
    )
    .register(IBotsService, params.connectionServices.botsService)
    .register(IFileWatcherService, params.connectionServices.fileWatcherService)
    .register(IOAuthService, params.connectionServices.oauthService)
    .register(IProviderSettingsService, params.connectionServices.providerSettingsService)
    .register(IModelSelectionService, params.connectionServices.modelSelectionService)
    .register(ISourceServerWorkspaceService, params.connectionServices.sourceServerWorkspaceService)
    .register(IUsageStatsService, params.connectionServices.usageStatsService)
    .register(
      ICodingPlanSubscriptionService,
      params.connectionServices.codingPlanSubscriptionService,
    )
    .register(IClientConfigService, params.clientConfigService)
    .register(IClientScenesService, params.connectionServices.clientScenesService)
    .register(ISkillsService, params.connectionServices.skillsService)
    .register(ISkillSyncService, params.connectionServices.skillSyncService)
    .register(IMcpSyncService, params.connectionServices.mcpSyncService)
    .register(IPluginSyncService, params.connectionServices.pluginSyncService)
    .register(IPluginsService, params.connectionServices.pluginsService)
    .register(IPluginManagementService, params.connectionServices.pluginManagementService)
    .register(ISubagentsService, params.connectionServices.subagentsService)
    .register(ICommandsService, params.connectionServices.commandsService)
    .register(IHooksService, params.connectionServices.hooksService)
    .register(IMemoryService, params.connectionServices.memoryService)
    .register(IOutputStyleService, params.connectionServices.outputStyleService)
    .register(ISettingsSyncService, params.connectionServices.settingsSyncService)
    .register(
      IPromptAttachmentTransferService,
      params.connectionServices.promptAttachmentTransferService,
    );
  if (params.virtualProjects) {
    if (
      !params.connectionServices.projectService ||
      !params.connectionServices.remoteProjectService
    )
      throw new Error("Remote virtual-project RPC registration incomplete");
    services.register(IProjectService, params.connectionServices.projectService);
    services.register(IRemoteProjectService, params.connectionServices.remoteProjectService);
  } else if (params.serverId) {
    services.register(
      IProjectService,
      resolveServerProjectService({ ...params, serverId: params.serverId }),
    );
    services.register(
      IRemoteProjectService,
      createRemoteProjectService({
        controller: false,
        database: async () => {
          throw new Error("remote-project.controller-only");
        },
      }),
    );
  }
  const controllerGroups = params.sourceServices?.getOptional(ITaskGroupService);
  const controllerBroadcast = params.sourceServices?.getOptional(IBroadcastService);
  if (controllerGroups) services.register(ITaskGroupService, controllerGroups);
  if (controllerGroups && controllerBroadcast) {
    const remoteBroadcast = params.connectionServices.broadcastService;
    services.register(IBroadcastService, {
      send: (message) =>
        (message.channel === "state:task-groups" ? controllerBroadcast : remoteBroadcast).send(
          message,
        ),
      acquireClaim: (key) => remoteBroadcast.acquireClaim(key),
      commitClaim: (lease) => remoteBroadcast.commitClaim(lease),
      releaseClaim: (lease) => remoteBroadcast.releaseClaim(lease),
      tryClaim: (key) => remoteBroadcast.tryClaim(key),
      onMessage: (listener) => {
        const remote = remoteBroadcast.onMessage((event) => {
          if (event.channel !== "state:task-groups") listener(event);
        });
        const local = controllerBroadcast.onMessage((event) => {
          if (event.channel === "state:task-groups") listener(event);
        });
        return {
          dispose: () => {
            remote.dispose();
            local.dispose();
          },
        };
      },
    });
  }
  const registrationKeys = new Set(REMOTE_WORKSPACE_RPC_REGISTRATIONS.map(([key]) => key));
  const missing = [
    ...REMOTE_WORKSPACE_RPC_CHANNELS.filter((key) => !registrationKeys.has(key)),
    ...REMOTE_WORKSPACE_RPC_REGISTRATIONS.filter(
      ([, descriptor]) =>
        services.getOptional(descriptor as ServiceDescriptor<unknown>) === undefined,
    ).map(([key]) => key),
  ];
  if (missing.length > 0) {
    throw new Error(`Remote workspace RPC registration incomplete: ${missing.join(", ")}`);
  }
  registerRemoteProviderProvisioningExecutor(services, remoteProviderProvisioningExecutor);
  return services;
}
