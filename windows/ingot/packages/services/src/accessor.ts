import type { IRemoteProjectService } from "#src/remote-projects/contract.js";
import type { ITaskGroupService } from "#src/task-groups/contract.js";
import type { WindowProjectDirectoryServices } from "#src/window-project-directory/contract.js";
import type { IProjectService } from "#src/project/contract.js";
import type { IGenUiService } from "./gen-ui/contract.js";
import { IOffPeakTaskService } from "./session/offPeakTask.js";
import type { IHighspeedCardService } from "./highspeed/highspeedCard.js";
import type { IPluginUiBridgeService } from "./plugin-ui-bridge/contract.js";
import type { IPluginUiSamplingService } from "./plugin-ui-bridge/samplingContract.js";
import type { IPluginUiAppToolsService } from "./plugin-ui-bridge/appToolsContract.js";
import type { IFileService } from "./file/file.js";
import type { IMediaPreviewService } from "./media-preview/mediaPreview.js";
import type { ICloudContentService } from "#src/cloud-content/cloudContent.js";
import type { IMarketingTouchService } from "#src/marketing-touch/marketingTouch.js";
import type { IGitService } from "./git/git.js";
import type { IGitCheckpointService } from "./git/gitCheckpoint.js";
import type { ISystemService } from "./system/system.js";
import type { ITerminalService } from "./terminal/terminal.js";
import type { ISettingService } from "./setting/setting.js";
import type { ICredentialService } from "./credential/credential.js";
import type { IBroadcastService } from "./broadcast/broadcast.js";
import type { ICfTaskService } from "./session/cfTaskService.js";
import type { ICfAgentService } from "./cf-agent/cfAgent.js";
import type { ICfSessionService } from "./cf-session/cfSession.js";
import type { ICuaPermissionService } from "./cua-permission-broker/cuaPermissionService.js";
import type { IBotsService } from "./bots/bots.js";
import type { IFileWatcherService } from "./fileWatcher/fileWatcher.js";
import type { IOAuthService } from "./oauth/oauth.js";
import type {
  IModelSelectionService,
  IProviderSettingsService,
} from "./model-provider/providerFacadeServices.js";
import type { IUsageStatsService } from "./usage-stats/usageStats.js";
import type { IRepoWikiService } from "./repo-wiki/repoWiki.js";
import type { ICodingPlanSubscriptionService } from "./coding-plan-subscription/codingPlanSubscription.js";
import type { IClientConfigService } from "./client-config/clientConfig.js";
import type { IClientScenesService } from "./client-scenes/clientScenes.js";
import type { ISkillsService } from "./skills/skills.js";
import type { ISkillSyncService } from "./skill-sync/skillSync.js";
import type { IMcpSyncService } from "./mcp-sync/mcpSync.js";
import type { IPluginSyncService } from "./plugin-sync/pluginSync.js";
import type { IPluginsService } from "./plugins/plugins.js";
import type { IPluginManagementService } from "./plugins/pluginManagement.js";
import type { ISubagentsService } from "./subagents/subagents.js";
import type { ICommandsService } from "./commands/commands.js";
import type { IHooksService } from "./hooks/hooks.js";
import type { IMemoryService } from "./memory/memory.js";
import type { IOutputStyleService } from "./output-style/outputStyle.js";
import type { ISettingsSyncService } from "./settings-sync/settingsSync.js";
import type { IFeedbackService } from "./feedback/feedback.js";
import type { IPromptAttachmentTransferService } from "./prompt-attachment-transfer/promptAttachmentTransfer.js";
import type { IWindowControllerService } from "./window-controller/windowController.js";
import type { ISourceServerWorkspaceService } from "./source-server-workspace/sourceServerWorkspace.js";
import type { ISourceServerManagementService } from "./source-server-management/sourceServerManagement.js";
import type { IOnboardingRecordService } from "./onboarding/onboardingRecord.js";
import type { IConversationShareService } from "./conversation-share/conversationShare.js";

export interface IServiceAccessor {
  readonly taskGroupService?: ITaskGroupService;
  readonly projectService?: IProjectService;
  readonly remoteProjectService?: IRemoteProjectService;
  readonly windowProjectDirectory?: WindowProjectDirectoryServices;
  readonly fileService: IFileService;
  readonly mediaPreviewService?: IMediaPreviewService;
  readonly cloudContentService?: ICloudContentService;
  readonly marketingTouchService?: IMarketingTouchService;
  readonly gitService: IGitService;
  readonly gitCheckpointService: IGitCheckpointService;
  readonly systemService: ISystemService;
  readonly terminalService: ITerminalService;
  readonly settingService: ISettingService;
  
  readonly onboardingRecordService?: IOnboardingRecordService;
  readonly credentialService: ICredentialService;
  readonly broadcastService: IBroadcastService;
  readonly cfTaskService: ICfTaskService;
  
  readonly windowControllerService?: IWindowControllerService;
  readonly cfAgentService: ICfAgentService;
  readonly cfSessionService: ICfSessionService;
  readonly cuaPermissionService?: ICuaPermissionService;
  readonly conversationShareService: IConversationShareService;
  readonly botsService: IBotsService;
  readonly fileWatcherService: IFileWatcherService;
  readonly oauthService: IOAuthService;
  
  readonly providerSettingsService: IProviderSettingsService;
  
  readonly modelSelectionService: IModelSelectionService;
  
  readonly sourceServerWorkspaceService: ISourceServerWorkspaceService;
  
  readonly sourceServerManagementService?: ISourceServerManagementService;
  readonly usageStatsService: IUsageStatsService;
  readonly codingPlanSubscriptionService: ICodingPlanSubscriptionService;
  readonly clientConfigService: IClientConfigService;
  readonly clientScenesService: IClientScenesService;
  
  readonly offPeakTaskService: IOffPeakTaskService;
  readonly highspeedCardService: IHighspeedCardService;
  readonly skillsService: ISkillsService;
  readonly skillSyncService: ISkillSyncService;
  readonly mcpSyncService: IMcpSyncService;
  
  readonly genUiService?: IGenUiService;
  readonly pluginUiBridgeService?: IPluginUiBridgeService;
  
  readonly pluginUiSamplingService?: IPluginUiSamplingService;
  
  readonly pluginUiAppToolsService?: IPluginUiAppToolsService;
  readonly pluginSyncService: IPluginSyncService;
  readonly pluginsService: IPluginsService;
  
  readonly pluginManagementService: IPluginManagementService;
  readonly subagentsService: ISubagentsService;
  readonly commandsService: ICommandsService;
  readonly hooksService: IHooksService;
  readonly memoryService: IMemoryService;
  readonly repoWikiService: IRepoWikiService;
  readonly outputStyleService: IOutputStyleService;
  readonly settingsSyncService: ISettingsSyncService;
  readonly feedbackService: IFeedbackService;
  readonly promptAttachmentTransferService: IPromptAttachmentTransferService;
}
