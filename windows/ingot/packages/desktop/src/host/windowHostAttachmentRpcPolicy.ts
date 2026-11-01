import type { IChannelServer } from "@origin-ai/cf-rpc";
import {
  ServiceCollection,
  IProjectService,
  IRemoteProjectService,
  IBroadcastService,
  IWindowProjectService,
  IWindowRemoteProjectService,
  IWindowProjectChangesService,
  createWindowProjectChangesService,
  type ServiceExposurePolicy,
  type CfAgentV4ClientMode,
} from "@origin-ai/cf-services";
import { ServiceChannels } from "@origin-ai/cf-shared";

const WEB_REMOTE_REPLAYABLE_ALLOWED_CHANNELS = new Set<string>([
  ServiceChannels.File,
  ServiceChannels.MediaPreview,
  ServiceChannels.System,
  ServiceChannels.Git,
  ServiceChannels.GitCheckpoint,
  ServiceChannels.Setting,
  ServiceChannels.OnboardingRecord,
  ServiceChannels.Credential,
  ServiceChannels.CuaPermission,
  ServiceChannels.CuaPipSession,
  ServiceChannels.Broadcast,
  ServiceChannels.CfTask,
  ServiceChannels.WindowController,
  ServiceChannels.CfAgent,
  ServiceChannels.CfSession,
  ServiceChannels.Project,
  ServiceChannels.TaskGroups,
  ServiceChannels.RemoteProjects,
  ServiceChannels.WindowProject,
  ServiceChannels.WindowRemoteProjects,
  ServiceChannels.WindowProjectChanges,
  ServiceChannels.ConversationShare,
  ServiceChannels.FileWatcher,
  ServiceChannels.OAuth,
  ServiceChannels.ProviderSettings,
  ServiceChannels.ModelSelection,
  ServiceChannels.SourceServerWorkspace,
  ServiceChannels.UsageStats,
  ServiceChannels.CodingPlanSubscription,
  ServiceChannels.ClientScenes,
  ServiceChannels.Skills,
  ServiceChannels.SkillSync,
  ServiceChannels.McpSync,
  ServiceChannels.PluginSync,
  ServiceChannels.Plugins,
  ServiceChannels.PluginManagement,
  ServiceChannels.Subagents,
  ServiceChannels.Commands,
  ServiceChannels.Hooks,
  ServiceChannels.Memory,
  ServiceChannels.OutputStyle,
  ServiceChannels.SettingsSync,
  ServiceChannels.Bots,
  ServiceChannels.Feedback,
  ServiceChannels.PromptAttachmentTransfer,
  ServiceChannels.OffPeakTask,
]);

const WEB_REMOTE_REPLAYABLE_EXPOSURE_POLICY: ServiceExposurePolicy = {
  allowedChannels: WEB_REMOTE_REPLAYABLE_ALLOWED_CHANNELS,
};

export function resolveWindowHostServiceExposurePolicy(
  clientMode: CfAgentV4ClientMode,
): ServiceExposurePolicy | undefined {
  return clientMode === "web-remote-replayable" ? WEB_REMOTE_REPLAYABLE_EXPOSURE_POLICY : undefined;
}

export function exposeWindowHostAttachmentServices(params: {
  server: IChannelServer;
  services: ServiceCollection;
  clientMode: CfAgentV4ClientMode;
  overrides?: ReadonlyMap<string, unknown>;
  attachmentScope?: { kind: "local" | "remote" | "source-settings" };
  windowServices?: ServiceCollection;
}): void {
  if (params.clientMode === "web-remote-replayable" && params.attachmentScope?.kind === "remote") {
    if (!params.windowServices) throw new Error("window-project-directory.unavailable");
    const directory = new ServiceCollection()
      .register(IWindowProjectService, params.windowServices.get(IProjectService))
      .register(IWindowRemoteProjectService, params.windowServices.get(IRemoteProjectService))
      .register(
        IWindowProjectChangesService,
        createWindowProjectChangesService(params.windowServices.get(IBroadcastService)),
      );
    directory.exposeOnChannelServer(
      params.server,
      undefined,
      resolveWindowHostServiceExposurePolicy(params.clientMode),
    );
  }
  params.services.exposeOnChannelServer(
    params.server,
    params.overrides,
    resolveWindowHostServiceExposurePolicy(params.clientMode),
  );
}
