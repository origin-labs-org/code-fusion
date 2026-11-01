import {
  createRemoteProjectService,
  IRemoteProjectService,
  projectWorkspaceSettings,
  readRemoteProjectDirectory,
} from "#src/remote-projects/index.js";
export {
  createRemoteProjectConnectionAdmission,
  remoteProjectHostIdForProfile,
  remoteProjectHostIdForTarget,
  prepareRemoteServerConnection,
} from "#src/remote-projects/index.js";
import {
  createProjectService,
  createTaskAutoArchiveScheduler,
  IProjectService,
  shouldRescanTaskAutoArchive,
} from "#src/project/index.js";
export { createLegacySingleRootProjectService } from "#src/project/index.js";
export { createRemoteProjectService } from "#src/remote-projects/index.js";
import { getCfDataRootDir as projectDataRoot } from "#src/paths.js";
import { createTaskGroupService, ITaskGroupService, groupTaskKey } from "#src/task-groups/index.js";
import { IGenUiService } from "./gen-ui/contract.js";
import { createGenUiService } from "./gen-ui/node.js";
import { channelReplyHostRequestSchema, channelReplyResultSchema } from "@origin-ai/cf-shared";

// Node.js service implementations — NOT safe to import in browser code
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createNodeProviderRuntimePathEnv,
  NodeModelSelectionConfigRepository,
  PERSONAL_PROVIDER_CONFIG_FILE_NAME,
} from "@origin-ai/cf-provider-node";
import { getAppConfigDir as resolveAppConfigDir } from "./paths.js";
import {
  createHasExistingLocalTask,
  hasAnyAgentSessionRow,
  resolveAgentSessionDbPath,
} from "./onboarding/localUsageEvidence.js";
import {
  buildLocalMediaPreviewUrl,
  type DynamicWorkflowMode,
  type ProviderProvisioningTrigger,
} from "@origin-ai/cf-shared";

export {
  materializeCfBuiltinProviderConfig,
  CF_BUILTIN_PROVIDER_CONFIG_FILE_ENV,
} from "@origin-ai/cf-provider-node";
import { randomUUID } from "node:crypto";
import { getAppConfigDir as getContentAppConfigDir } from "#src/paths.js";
import { ICloudContentService } from "#src/cloud-content/cloudContent.js";
import { createCloudContentService } from "#src/cloud-content/cloudContentService.js";
import { IMarketingTouchService } from "#src/marketing-touch/marketingTouch.js";
import { createMarketingTouchService } from "#src/marketing-touch/marketingTouchService.js";
import { createMarketingAssetRegistry } from "#src/marketing-touch/marketingAssetRegistry.js";
import type { IChannel } from "@origin-ai/cf-rpc";
import {
  readTopicResourceFromRelay,
  validateTopicResourceFromRelay,
} from "./cf-agent/topicResourceRelayClient.js";
export {
  createTopicResourcePeers,
  type TopicResourcePeers,
} from "./cf-agent/topicResourcePeers.js";
export { createTopicResourceRelayChannel } from "./cf-agent/topicResourceRelayChannel.js";

export { createFileService } from "./file/fileService.js";
export {
  attributeHostProcessTree,
  createProcessResourceSampler,
  createProcessResourceTableReader,
  type HostResourceUsageAgent,
  type ProcessResourceSample,
  type ProcessResourceSampler,
} from "./process/processResourceSampler.js";
export { createMediaPreviewService } from "./media-preview/mediaPreview.js";
export { createContentBundleCache } from "#src/cloud-content/contentBundleCache.js";
export type { ContentBundle } from "#src/cloud-content/contentBundleCache.js";
export type { CreateFileServiceOptions } from "./file/fileService.js";
export {
  defaultWorkspaceFileSearchFilter,
  type WorkspaceFileSearchDecision,
  type WorkspaceFileSearchEntry,
  type WorkspaceFileSearchFilter,
} from "./file/workspaceFileMentionFilter.js";
export {
  createFsFaultInjector,
  getProcessFsFaultInjector,
  maybeThrowInjectedFsFault,
  parseFsFaultRulesFromEnvValue,
  resetProcessFsFaultInjectorForTests,
  setFsFaultInjectorForTests,
  CF_E2E_FS_FAULTS_ALLOW_ENV,
  CF_E2E_FS_FAULTS_ENV,
} from "./fs/fsFaultInjection.js";
export type {
  FsFaultCheckInput,
  FsFaultHit,
  FsFaultInjector,
  FsFaultOperation,
  FsFaultRuleConfig,
  InjectedFsFaultError,
} from "./fs/fsFaultInjection.js";
export {
  setDataBaseDir,
  getDataBaseDir,
  getCfDataRootDir,
  getConversationWorkspaceDir,
  getAppConfigDir,
  getExportLogStageDir,
  getExportLogDir,
  getFeedbackRootDir,
  getFeedbackAttachmentDir,
  getFeedbackLogArchiveDir,
  getGitCheckpointIndexRootDir,
  copyDataDirectory,
  validateDataBaseDirTarget,
  CF_WINDOWS_APP_INSTALL_DIR_ENV,
} from "./paths.js";
export { createGitService } from "./git/gitService.js";
export { GitCommitMessageGenerator } from "./git/gitCommitMessageGenerator.js";
export { createGitCheckpointService } from "./git/gitCheckpointService.js";
export { createSystemService } from "./system/systemService.js";
export { listSSHConfigAliasesFromLocalConfig } from "./system/sshConfigAlias.js";
export { createTerminalService } from "./terminal/terminalService.js";
export {
  createSettingService,
  createSettingServiceWithMigrations,
} from "./setting/settingService.js";
export { createCredentialService } from "./credential/credentialService.js";
export { createBroadcastService } from "./broadcast/broadcastService.js";
export { createCfAgentService } from "./cf-agent/cfAgentService.js";
export { createCfTaskServiceAdapter } from "./cf-agent/cfTaskServiceAdapter.js";
export { createCfSessionService } from "./cf-session/cfSessionService.js";
export {
  resolveDefaultCfAgentCommand,
  CfAgentProcessManager,
} from "./cf-agent/cfAgentProcessManager.js";
export type {
  CfAgentCommand,
  CfAgentCommandResolver,
  CfAgentCommandResolverContext,
  CfAgentProcessManagerOptions,
} from "./cf-agent/cfAgentProcessManager.js";
export { CfProtocolClient } from "./cf-agent/cfProtocolClient.js";
export type { CfProtocolTransport } from "./cf-agent/cfProtocolTransport.js";
export { CfStdioTransport } from "./cf-agent/cfStdioTransport.js";
export {
  getCfStdioTapDevLogDir,
  readCfStdioTapDevState,
  setCfStdioTapDevEnabled,
} from "./cf-agent/cfStdioTapDevConfig.js";
export type { CfStdioTapDevState } from "@origin-ai/cf-shared";
export {
  createCuaHelperInstaller,
  requestHelperAccessibilityPermissionViaLaunchServices,
  requestHelperScreenRecordingPermissionViaLaunchServices,
} from "./cua-permission-broker/index.js";
export {
  canonicalizeCuaHelperInstallerOptions,
  createCanonicalCuaHelperInstaller,
  normalizeCuaHelperArch,
  normalizeCuaHelperArchs,
} from "./cua-permission-broker/cuaHelperInstaller.js";
export type {
  CuaHelperInstaller,
  CuaHelperInstallerOptions,
} from "./cua-permission-broker/index.js";
export { createProjectWorkspaceNavigation } from "#src/project-workspace-navigation/index.js";
export { createBotsService } from "./bots/botsService.js";
export { createFileWatcherService } from "./fileWatcher/fileWatcherService.js";
export { createOAuthService } from "./oauth/oauthService.js";
export { createOAuthProviderLogoutHandler } from "./oauth/oauthProviderLogout.js";
export { OAuthCredentialRepo } from "./oauth/repo/oauthCredentialRepo.js";
export { createTelemetryCore, ensureTelemetryDeviceMid } from "./telemetry/telemetryCore.js";
export type { EnsureTelemetryDeviceMidOptions } from "./telemetry/telemetryCore.js";
export type { AccountRequestAuthResolver } from "./model-provider/accountProviderRequestAuthService.js";
export { createAccountProviderCredentialStore } from "./model-provider/accountProviderCredentialStore.js";
export type {
  AccountProviderCredentialStore,
  AccountProviderCredentialStoreOptions,
} from "./model-provider/accountProviderCredentialStore.js";
export { importLegacyPersonalProviderConfig } from "./model-provider/legacyPersonalProviderConfigImporter.js";
export {
  createAccountProviderConfigSource,
  createAccountProviderConnectionResolver,
  createCodingPlanFamilyAvailabilityResolver,
  resolveCurrentAccountAccess,
} from "./model-provider/accountProviderConnectionResolver.js";
export { bindAccountProviderInvalidation } from "./model-provider/accountProviderInvalidation.js";
export type {
  AccountProviderConfigSourceOptions,
  AccountProviderConnectionResolverOptions,
  AccountProviderConnectionSettings,
  AccountProviderFamilyAvailabilityInput,
  AccountProviderFamilyAvailabilityResolver,
  CodingPlanFamilyAvailabilityResolverOptions,
} from "./model-provider/accountProviderConnectionResolver.js";
export {
  createProviderConfigRuntime,
  ProviderConfigRuntime,
} from "./model-provider/providerConfigRuntime.js";
export type { ProviderConfigRuntimeOptions } from "./model-provider/providerConfigRuntime.js";
export {
  createProviderRuntime,
  createProviderRuntimeFromConfigRuntime,
  EmptyAccountProviderConfigSource,
  ProviderRuntime,
} from "./model-provider/providerRuntime.js";
export type {
  ProviderRuntimeDependencies,
  ProviderRuntimeOptions,
} from "./model-provider/providerRuntime.js";
export {
  createProviderProvisioningSource,
  listProviderProvisioningCredentialKeys,
  resolveCredentialFilePath,
  type ProviderProvisioningSource,
  type ProviderProvisioningSourceOptions,
} from "./model-provider/providerProvisioningSource.js";
export {
  createProviderProvisioningTarget,
  type ProviderProvisioningTargetOptions,
} from "./model-provider/providerProvisioningTarget.js";
export {
  createModelSelectionService,
  createProviderSettingsService,
  IModelSelectionService,
  IProviderSettingsService,
} from "./model-provider/providerFacadeServices.js";
export { createAccountRequestAuthService } from "./model-provider/accountRequestAuthService.js";
export type { IAccountRequestAuthService } from "./model-provider/accountRequestAuthService.js";
export { createAccountProviderRequestAuthService } from "./model-provider/accountProviderRequestAuthService.js";
export {
  resolveAccountTeamPlanRuntimeApiKey,
  resolveAccountTeamPlanRuntimeMaterial,
} from "./model-provider/accountProviderTeamPlanRequestKey.js";
export { createAccountProjectTokenClient } from "./model-provider/accountProjectTokenClient.js";
export { createAccountProviderCredentialService } from "./model-provider/accountProviderCredentialService.js";
export { createSourceServerWorkspaceService } from "./source-server-workspace/sourceServerWorkspaceService.js";
export {
  SourceServerWorkspaceIdentityChannelServer,
  SourceServerWorkspaceIdentityMapper,
} from "./source-server-workspace/sourceServerWorkspaceIdentityChannelServer.js";
export {
  SourceServerWorkspaceAliasRepo,
  SourceServerWorkspaceIdentityConflictError,
} from "./session/sourceServerWorkspaceAliasRepo.js";
export { migrateControllerRemoteWorkspaceIdentity } from "./session/controllerRemoteIdentityMigration.js";
export type {
  ControllerRemoteIdentityMigrationOptions,
  ControllerRemoteIdentityMigrationReport,
} from "./session/controllerRemoteIdentityMigration.js";
export { createUsageStatsService } from "./usage-stats/usageStatsService.js";
export { createStorageService } from "./storage/app/storageService.js";
export type { IStorageService } from "./storage/contract.js";
export type {
  FsCleanerPort as StorageFsCleanerPort,
  RootsResolverPort as StorageRootsResolverPort,
  ScanRunnerPort as StorageScanRunnerPort,
  StorageScanProgress,
  StorageScanRunRequest,
} from "./storage/app/ports.js";
export { createFsStorageCleaner } from "./storage/adapters/fsCleaner.js";
export {
  createStorageRootsResolver,
  resolveStorageRoots,
} from "./storage/adapters/rootsResolver.js";
export { createFsVolumeProbe } from "./storage/adapters/volumeProbe.js";
export { runStorageScan } from "./storage/adapters/inProcessScanRunner.js";
export { createCodingPlanSubscriptionService } from "./coding-plan-subscription/codingPlanSubscriptionService.js";
export { createClientConfigService } from "./client-config/clientConfigService.js";
export { createClientScenesService } from "./client-scenes/clientScenesService.js";
export { createSkillsService } from "./skills/skillsService.js";
export { createSkillSyncService } from "./skill-sync/skillSyncService.js";
export { createMcpSyncService } from "./mcp-sync/mcpSyncService.js";
export { createPluginSyncService } from "./plugin-sync/pluginSyncService.js";
export { createPluginsService } from "./plugins/pluginsService.js";
export { createPluginManagementService } from "./plugins/pluginManagementService.js";
export { createSubagentsService } from "./subagents/subagentsService.js";
export { createCommandsService } from "./commands/commandsService.js";
export { createHooksService } from "./hooks/hooksService.js";
export { createMemoryService } from "./memory/memoryService.js";
export { createRepoWikiService } from "./repo-wiki/repoWikiService.js";
export { createOutputStyleService } from "./output-style/outputStyleService.js";
export { createSettingsSyncService } from "./settings-sync/settingsSyncService.js";
export { createFeedbackDiagnosticArchive } from "./feedback/feedbackLogArchive.js";
export { createFeedbackService } from "./feedback/feedbackService.js";
export type { CreateFeedbackServiceOptions } from "./feedback/feedbackService.js";
export { createLocalPromptAttachmentTransferService } from "./prompt-attachment-transfer/promptAttachmentTransferService.js";
export {
  createLocalConversationShareArtifactSource,
  createRemoteConversationShareArtifactSource,
} from "./conversation-share/conversationShareArtifactSource.js";
export { createNodeApiClient, NodeApiClient } from "./providers/api/nodeApiClient.js";
export {
  createHostApiNetworkTransport,
  type HostApiNetworkTransport,
} from "./providers/api/nodeApiNetwork.js";
export {
  buildRuntimeProcessEnvPatch,
  captureLoginShellEnvSnapshot,
  normalizeRuntimeProcessEnv,
  prepareRuntimeProcessEnvPatch,
} from "./runtime-tools/runtimeCommandEnv.js";

export {
  AutomationRepo,
  DISPATCH_RETRY_BASE_MS,
  DISPATCH_RETRY_CAP_MS,
  DISPATCH_MAX_ATTEMPTS,
  CLAIM_STALE_MS,
  computeRetryAt,
} from "./session/automationRepo.js";
export { AutomationService, InvalidCronExprError } from "./session/automationService.js";
export { OffPeakTaskRepo, OFF_PEAK_CLAIM_STALE_MS } from "./session/offPeakTaskRepo.js";
export { buildTaskChangeSummary } from "./session/taskChangeSummary.js";
export { OffPeakTaskService } from "./session/offPeakTaskService.js";
export { IOffPeakTaskService } from "./session/offPeakTask.js";
export { IHighspeedCardService } from "./highspeed/highspeedCard.js";
export { createOffPeakServerClient, OffPeakServerError } from "./session/offPeakServerClient.js";
export { isOffPeakMockEnabled, startOffPeakMockGateway } from "./session/offPeakMockGateway.js";
export {
  buildOffPeakRequestAuth,
  createOffPeakOriginResolver,
  resolveOffPeakCredentials,
  resolveOffPeakCodingPlanSupport,
  resolveOffPeakMockUpstream,
  OffPeakCodingPlanUnavailableError,
  OffPeakCredentialsUnavailableError,
  OffPeakModelUnavailableError,
  OffPeakPermanentDispatchError,
} from "./session/offPeakRuntimeModel.js";
export { createServiceLogger } from "./logger/serviceLogger.js";
export {
  buildOfficialMcpAuthHeaders,
  createOfficialMcpAuthHeadersResolver,
  resolveOfficialMcpCredentials,
} from "./official-mcp/officialMcpCredentials.js";
export {
  computeAutomationNextRunAt,
  computeNextRunAt,
  computeScheduleRuleNextRunAt,
  isOneShotAutomation,
  isValidCronExpr,
} from "./session/automationCron.js";

import {
  buildServerRemoteWorkspaceIdentity,
  remoteHostIdFromWorkspaceIdentity,
} from "@origin-ai/cf-shared";
import { SourceServerWorkspaceAliasRepo } from "./session/sourceServerWorkspaceAliasRepo.js";
import { SourceServerWorkspaceIdentityMapper } from "./source-server-workspace/sourceServerWorkspaceIdentityChannelServer.js";
import { ServiceCollection } from "./collection.js";
import { IFileService } from "./file/file.js";
import { IMediaPreviewService } from "./media-preview/mediaPreview.js";
import { IGitService } from "./git/git.js";
import { IGitCheckpointService } from "./git/gitCheckpoint.js";
import { ISystemService } from "./system/system.js";
import { ITerminalService } from "./terminal/terminal.js";
import { ISettingService } from "./setting/setting.js";
import { IOnboardingRecordService } from "./onboarding/onboardingRecord.js";
import { ICredentialService } from "./credential/credential.js";
import { IBroadcastService } from "./broadcast/broadcast.js";
import { ICfTaskService } from "./session/cfTaskService.js";
import { ICfAgentService } from "./cf-agent/cfAgent.js";
import type { CuaOperationStateReporter } from "./cf-agent/cuaOperationTurnTracker.js";
import { ICfSessionService } from "./cf-session/cfSession.js";
import {
  createUnsupportedConversationShareService,
  IConversationShareService,
  type IConversationShareService as IConversationShareServiceType,
} from "./conversation-share/conversationShare.js";
import {
  ConversationShareService,
  conversationShareConnectionScopeFactory,
} from "./conversation-share/conversationShareService.js";
import { createLocalConversationShareArtifactSource } from "./conversation-share/conversationShareArtifactSource.js";
import { ConversationShareHttpClient } from "./conversation-share/conversationShareHttpClient.js";
import { IBotsService } from "./bots/bots.js";
import { IFileWatcherService } from "./fileWatcher/fileWatcher.js";
import { IOAuthService } from "./oauth/oauth.js";
import { ISourceServerWorkspaceService } from "./source-server-workspace/sourceServerWorkspace.js";
import { IUsageStatsService } from "./usage-stats/usageStats.js";
import { ICodingPlanSubscriptionService } from "./coding-plan-subscription/codingPlanSubscription.js";
import { IClientScenesService } from "./client-scenes/clientScenes.js";
import { ISkillsService } from "./skills/skills.js";
import { ISkillSyncService } from "./skill-sync/skillSync.js";
import { IMcpSyncService } from "./mcp-sync/mcpSync.js";
import { IPluginSyncService } from "./plugin-sync/pluginSync.js";
import { IPluginsService } from "./plugins/plugins.js";
import { IPluginManagementService } from "./plugins/pluginManagement.js";
import { ISubagentsService } from "./subagents/subagents.js";
import { ICommandsService } from "./commands/commands.js";
import { IHooksService } from "./hooks/hooks.js";
import { IMemoryService } from "./memory/memory.js";
import { IRepoWikiService } from "./repo-wiki/repoWiki.js";
import { IOutputStyleService } from "./output-style/outputStyle.js";
import { ISettingsSyncService } from "./settings-sync/settingsSync.js";
import { IFeedbackService } from "./feedback/feedback.js";
import { IPromptAttachmentTransferService } from "./prompt-attachment-transfer/promptAttachmentTransfer.js";
import { createFileService } from "./file/fileService.js";
import { createMediaPreviewService } from "./media-preview/mediaPreview.js";
import type { WorkspaceFileSearchFilter } from "./file/workspaceFileMentionFilter.js";
import { createGitService } from "./git/gitService.js";
import { GitCommitMessageGenerator } from "./git/gitCommitMessageGenerator.js";
import { createGitCheckpointService } from "./git/gitCheckpointService.js";
import { createSystemService } from "./system/systemService.js";
import { createTerminalService } from "./terminal/terminalService.js";
import {
  createSettingService,
  createSettingServiceWithMigrations,
} from "./setting/settingService.js";
import { createOnboardingRecordService } from "./onboarding/onboardingRecordService.js";
import { createLegacyTeamOrganizationResolver } from "./model-provider/legacyTeamOrganizationResolver.js";
import { createObservableSettingService } from "./setting/observableSettingService.js";
import { createCredentialService } from "./credential/credentialService.js";
import { createBroadcastService } from "./broadcast/broadcastService.js";
import { createCfAgentService } from "./cf-agent/cfAgentService.js";
import type { CfAgentCommandResolver } from "./cf-agent/cfAgentProcessManager.js";
import { buildAgentTelemetrySpawnEnv } from "./cf-agent/agentTelemetryEnv.js";
import { resolveCfAgentPresentationSurface } from "./cf-agent/cfAgentPresentationSurface.js";
import { createCfTaskServiceAdapter } from "./cf-agent/cfTaskServiceAdapter.js";
import { createCfSessionService } from "./cf-session/cfSessionService.js";
import { createCfTaskIndexSyncer } from "./cf-agent/cfTaskIndexSyncer.js";
import { TaskIndexRepo } from "./session/taskIndexRepo.js";
import { AutomationRepo } from "#src/session/automationRepo.js";
import type { AppSettings } from "@origin-ai/cf-shared";
import { createBotsService } from "./bots/botsService.js";
import { BotsRepo } from "#src/bots/repo.js";
import {
  createBotProjectRuntime,
  type BotProjectConnection,
} from "#src/bot-project-runtime/index.js";
export type { BotProjectConnection } from "#src/bot-project-runtime/contract.js";
import type { SessionMessageSendRequested } from "#src/session/sessionMailbox.js";
import { createFileWatcherService } from "./fileWatcher/fileWatcherService.js";
import { createOAuthService } from "./oauth/oauthService.js";
import {
  isOAuthBusinessRequest,
  resolveOAuthBusinessCredentialValidationRequest,
  isCurrentOAuthCredentialRequest,
} from "#src/oauth/oauthUnauthorizedRequest.js";
import { createOAuthProviderLogoutHandler } from "./oauth/oauthProviderLogout.js";
import { OAuthCredentialRepo } from "./oauth/repo/oauthCredentialRepo.js";
import { readLegacyCfConfigProviders } from "./model-provider/legacyCfConfigProviderReader.js";
import { resolveAccountTeamPlanRuntimeMaterial } from "./model-provider/accountProviderTeamPlanRequestKey.js";
import { createAccountProviderCredentialStore } from "./model-provider/accountProviderCredentialStore.js";
import { createAccountProviderCredentialService } from "./model-provider/accountProviderCredentialService.js";
import { createAccountProviderRequestAuthService } from "./model-provider/accountProviderRequestAuthService.js";
import {
  createAccountProviderConfigSource,
  createCodingPlanFamilyAvailabilityResolver,
  resolveCurrentAccountAccess,
} from "./model-provider/accountProviderConnectionResolver.js";
import { bindAccountProviderInvalidation } from "./model-provider/accountProviderInvalidation.js";
import { AccountProviderApiClient } from "./model-provider/accountProviderApiClient.js";
import { createAccountProjectTokenClient } from "./model-provider/accountProjectTokenClient.js";
import { AccountProviderApiKeyResolver } from "./model-provider/accountProviderApiKeyResolver.js";
import { createProviderConfigRuntime } from "./model-provider/providerConfigRuntime.js";
import { fetchCfBuiltinRemoteRelease } from "./model-provider/cfBuiltinRemoteConfig.js";
import {
  createProviderRuntimeFromConfigRuntime,
  type ProviderRuntime,
} from "./model-provider/providerRuntime.js";
import {
  IModelSelectionService,
  IProviderSettingsService,
} from "./model-provider/providerFacadeServices.js";
import { createProviderSettingsConnectivityTester } from "./model-provider/providerSettingsConnectivity.js";
import {
  createProviderProvisioningSource,
  listProviderProvisioningCredentialKeys,
  PROVIDER_PROVISIONING_OAUTH_CREDENTIAL_KEYS,
  resolveCredentialFilePath,
  type ProviderProvisioningSource,
} from "./model-provider/providerProvisioningSource.js";
import { createProviderProvisioningTarget } from "./model-provider/providerProvisioningTarget.js";
import { IProviderProvisioningTargetService } from "./model-provider/providerProvisioning.js";
import { buildOffPeakModelSelectionView } from "./model-provider/offPeakModelSelectionView.js";
import { resolveClientConfigPlatform } from "./runtime-tools/clientPlatform.js";
import {
  createAccountRequestAuthService,
  type IAccountRequestAuthService,
} from "./model-provider/accountRequestAuthService.js";
import { createSourceServerWorkspaceService } from "./source-server-workspace/sourceServerWorkspaceService.js";
import { createUsageStatsService } from "./usage-stats/usageStatsService.js";
import { createCodingPlanSubscriptionService } from "./coding-plan-subscription/codingPlanSubscriptionService.js";
import { createClientConfigService } from "./client-config/clientConfigService.js";
import { IClientConfigService } from "./client-config/clientConfig.js";
import { createClientScenesService } from "./client-scenes/clientScenesService.js";
import { createSkillsService } from "./skills/skillsService.js";
import { createSkillSyncService } from "./skill-sync/skillSyncService.js";
import { createMcpSyncService } from "./mcp-sync/mcpSyncService.js";
import {
  IPluginUiAppToolsService,
  IPluginUiSamplingService,
  createPluginUiSamplingService,
  IPluginUiBridgeService,
  createPluginUiAppToolsService,
  createPluginUiBridgeService,
} from "./plugin-ui-bridge/index.js";
import type { PluginSandboxHandle, PluginSandboxRegisterInput } from "@origin-ai/cf-shared/mcp-apps";
import { createPluginSyncService } from "./plugin-sync/pluginSyncService.js";
import { createPluginsService } from "./plugins/pluginsService.js";
import { createPluginManagementService } from "./plugins/pluginManagementService.js";
import { createSubagentsService } from "./subagents/subagentsService.js";
import { createCommandsService } from "./commands/commandsService.js";
import { createHooksService } from "./hooks/hooksService.js";
import { createMemoryService } from "./memory/memoryService.js";
import {
  createRepoWikiService,
  type RepoWikiModelViewLike,
} from "./repo-wiki/repoWikiService.js";
import { createOutputStyleService } from "./output-style/outputStyleService.js";
import { createSettingsSyncService } from "./settings-sync/settingsSyncService.js";
import {
  createFeedbackService,
  type CreateFeedbackServiceOptions,
} from "./feedback/feedbackService.js";
import { createLocalPromptAttachmentTransferService } from "./prompt-attachment-transfer/promptAttachmentTransferService.js";
import { createNodeApiClient } from "./providers/api/nodeApiClient.js";
import {
  createHostApiNetworkTransport,
  type HostApiNetworkTransport,
} from "./providers/api/nodeApiNetwork.js";
import type {
  RuntimeProcessLifecycleReporter,
  RuntimeTaskReporter,
} from "#src/process/runtimeProcessLifecycle.js";
import { initializeRuntimeProcessEnv } from "./runtime-tools/runtimeCommandEnv.js";
import {
  buildAgentEndpointOriginEnv,
  buildAgentRuntimeEnv,
} from "./runtime-tools/agentProxyEnv.js";
import { ensureAppCaCert } from "./runtime-tools/appCaCert.js";
import { buildHelperOpenArgs, isCuaLocalDevelopmentRuntime } from "@origin-ai/cf-cua/broker/server";
import { createServiceLogger, type ServiceLogger } from "#src/logger/serviceLogger.js";
import { IOffPeakTaskService } from "./session/offPeakTask.js";
import type { HighspeedMockScenario } from "@origin-ai/cf-shared";
import { IHighspeedCardService } from "./highspeed/highspeedCard.js";
import {
  buildHighspeedCodingPlanAuthHeaders,
  HighspeedCardService,
  createHighspeedHttpTransport,
} from "./highspeed/highspeedCardService.js";
import { createHighspeedMockTransport } from "./highspeed/highspeedMockTransport.js";
import { OffPeakTaskService } from "./session/offPeakTaskService.js";
import { OffPeakTaskRepo } from "./session/offPeakTaskRepo.js";
import { createOffPeakServerClient } from "./session/offPeakServerClient.js";
import {
  buildOffPeakRequestAuth,
  createOffPeakOriginResolver,
  resolveOffPeakCredentials,
  resolveOffPeakCodingPlanSupport,
  resolveOffPeakMockUpstream,
} from "./session/offPeakRuntimeModel.js";
import {
  createOfficialMcpAuthHeadersResolver,
  resolveOfficialMcpCredentials,
} from "./official-mcp/officialMcpCredentials.js";
import {
  createOfficialMcpTrustedOriginRegistry,
  OFFICIAL_MCP_DEV_TRUSTED_ORIGINS_ENV,
} from "@origin-ai/cf-shared";
import {
  BROKER_SOCKET_ENV,
  BROKER_UNAVAILABLE_ENV,
  createCuaPipSessionService,
  createCuaProductMcpServerResolver,
  createProductCuaHelperHost,
  CuaHelperLifecycleManager,
  ICuaPermissionService,
  ICuaPipSessionService,
  isOfficialCuaPluginEnabledForWorkspace,
  isPotentialCfCuaAgentMcpServer,
  isScreenCaptureProbeSuccess,
  reapOrphanedHelpers,
  resolveStandaloneStatusLaunchAppPath,
  shouldRunCuaScreenCaptureProbe,
  type CuaHelperHost,
  type CuaHelperTransportRestartOptions,
  type CuaHelperTransportRestartResult,
  type ManagedCuaProductHelperHost,
  type CuaProductMcpServerResolver,
  type CuaProductMcpServerResolverContext,
  type CuaPermissionRestartOptions,
  type CuaPermissionRestartResult,
  type CuaPermissionState,
  type CuaPermissionStatusQueryOptions,
  type CuaPermissionStatusResult,
} from "#src/cua-permission-broker/index.js";
import {
  resolveWindowsCuaRuntime,
  WindowsCuaDevRuntimeResolutionError,
  type WindowsCuaRuntime,
} from "#src/cua-permission-broker/windowsCuaDevRuntime.js";
import { createCanonicalCuaHelperInstaller } from "./cua-permission-broker/cuaHelperInstaller.js";
import { WindowsCuaHelperHost } from "#src/cua-permission-broker/windowsCuaDevHelperHost.js";
import {
  getStableCuaPipeName,
  resolveStableCuaWinRecipe,
} from "#src/cua-permission-broker/stableCuaTransport.js";
import { HELPER_APP_NAME } from "@origin-ai/cf-cua/broker/helperConstants";
import { resolveBrokerSocketPath } from "@origin-ai/cf-cua/broker/socketPath";
import {
  DEFAULT_CF_MODEL_CONTEXT_BUDGET_STRATEGY,
  CF_JWT_INVALID_BROADCAST_CHANNEL,
  formatLogPrefix,
  isCredentialDecryptError,
  isStartPlanModelProviderId,
  OFF_PEAK_PROVIDER_IDS,
  BIGMODEL_PROVIDER_ID,
  type ProviderFamilyDomain,
  type ServiceAuthorityMode,
  resolveRuntimeCfEndpointOrigin,
  resolveSafeTelemetryHostname,
  type BrowserBackendDescriptor,
  type BrowserClientMode,
  type BrowserCommand,
  isCfCuaMcpCommand,
  isCfCuaMcpPackageArg,
  isCfCuaInternalFeatureEnabled,
  CF_CUA_PLUGIN_AUTHORITY_ENV_KEY,
  type CfAutomation,
  type CfAutomationRun,
  getCapturedCfAgentTelemetryEnv,
  CF_DESKTOP_CONTEXT_PROMPT_ENABLED_ENV,
  ZAI_PROVIDER_ID,
  cfAccountAccessSchema,
  cfProviderAccountAccessSchema,
  CF_VERSION,
  CF_ENV,
  buildRuntimeCfApiUrl,
} from "@origin-ai/cf-shared";

export {
  ConversationShareService,
  ConversationShareHttpClient,
  conversationShareConnectionScopeFactory,
};

import { createPluginUiAccountBindings } from "./plugin-ui-bridge/instanceAccounts.js";
interface ServiceWithDisposeAll {
  disposeAll: () => void;
}

interface ServiceWithDisposeAllAndWait {
  disposeAllAndWait: () => Promise<void>;
}

// Bug A: the Helper's first cold launch (large Node SEA + first-time Gatekeeper/notarization
// assessment) routinely exceeds the old 5s health budget; warm it is <1s. Give the cold path
// plenty of headroom.
const CUA_HELPER_HEALTH_TIMEOUT_MS = 30_000;

type DefaultCuaProductHelper = {
  host: ManagedCuaProductHelperHost;
  macPermissionHost?: CuaHelperHost;
  resolver: CuaProductMcpServerResolver;
};

type ManagedDefaultCuaProductHelper = {
  helper: DefaultCuaProductHelper;
  seedContext?: CuaProductMcpServerResolverContext;
};

function hasDisposeAll(instance: unknown): instance is ServiceWithDisposeAll {
  return (
    typeof instance === "object" &&
    instance !== null &&
    "disposeAll" in instance &&
    typeof (instance as { disposeAll?: unknown }).disposeAll === "function"
  );
}

function hasDisposeAllAndWait(instance: unknown): instance is ServiceWithDisposeAllAndWait {
  return (
    typeof instance === "object" &&
    instance !== null &&
    typeof (instance as { disposeAllAndWait?: unknown }).disposeAllAndWait === "function"
  );
}

interface ManagedCuaHelperHostDispose {
  stop(): Promise<void>;
}

const managedCuaHelperHosts = new WeakMap<ServiceCollection, ManagedCuaHelperHostDispose>();
const providerRuntimes = new WeakMap<ServiceCollection, ProviderRuntime>();
const providerProvisioningSources = new WeakMap<ServiceCollection, ProviderProvisioningSource>();
const providerProvisioningTriggerDisposers = new WeakMap<
  ServiceCollection,
  readonly (() => void)[]
>();
const taskAutoArchiveDisposers = new WeakMap<ServiceCollection, () => void>();
const sharedSqliteRepos = new WeakMap<ServiceCollection, ReadonlyArray<{ close(): void }>>();
const accountRequestAuthServices = new WeakMap<ServiceCollection, IAccountRequestAuthService>();
export type OffPeakRequestAuthBuilder = (
  ticketId: string,
) => Promise<{ apiKey: string; headers: Record<string, string>; accountScope?: string }>;
const offPeakRequestAuthBuilders = new WeakMap<ServiceCollection, OffPeakRequestAuthBuilder>();

export function getAccountRequestAuthService(
  services: ServiceCollection,
): IAccountRequestAuthService | undefined {
  return accountRequestAuthServices.get(services);
}

export function getProviderProvisioningSource(
  services: ServiceCollection,
): ProviderProvisioningSource | undefined {
  return providerProvisioningSources.get(services);
}

export function getOffPeakRequestAuthBuilder(
  services: ServiceCollection,
): OffPeakRequestAuthBuilder | undefined {
  return offPeakRequestAuthBuilders.get(services);
}
const managedHostApiNetworkTransports = new WeakMap<ServiceCollection, HostApiNetworkTransport>();

export function registerManagedCuaHelperHostForDispose(
  services: ServiceCollection,
  host: ManagedCuaHelperHostDispose,
): void {
  managedCuaHelperHosts.set(services, host);
}

export function registerHostApiNetworkTransportForDispose(
  services: ServiceCollection,
  transport: HostApiNetworkTransport,
): void {
  managedHostApiNetworkTransports.set(services, transport);
}

export function shouldEnableDefaultCuaProductHelper(
  options: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
  } = {},
): boolean {
  const env = options.env ?? process.env;
  if (!isCfCuaInternalFeatureEnabled(env)) return false;
  const platform = options.platform ?? process.platform;
  return platform === "darwin" || platform === "win32";
}

export function shouldCreateDefaultCuaProductHelper(opts: {
  serviceAuthorityMode?: ServiceAuthorityMode;
  hasRemoteWorkspaceIdentity?: boolean;
  hasInjectedResolver: boolean;
  hasBuiltInCuaPlugin: boolean;
}): boolean {
  return (
    opts.hasBuiltInCuaPlugin &&
    opts.serviceAuthorityMode === "desktop-local" &&
    !opts.hasRemoteWorkspaceIdentity &&
    !opts.hasInjectedResolver
  );
}

export function shouldUseCuaPermissionService(opts: {
  platform?: NodeJS.Platform;
  cuaEnabled: boolean;
}): boolean {
  const platform = opts.platform ?? process.platform;
  return (platform === "darwin" || platform === "win32") && opts.cuaEnabled;
}

export function shouldRetainDefaultCuaProductHelper(): boolean {
  return true;
}

export function shouldEnableCuaOperationStateReporter(opts: {
  serviceAuthorityMode?: ServiceAuthorityMode;
  hasReporter: boolean;
}): boolean {
  return opts.hasReporter && opts.serviceAuthorityMode === "desktop-local";
}

export async function runCuaScreenCaptureReadinessProbe(
  host: Pick<CuaHelperHost, "queryScreenCaptureProbe">,
  screenRecording: "granted" | "denied" | "unknown",
  queryOptions?: CuaPermissionStatusQueryOptions,
): Promise<boolean> {
  if (!shouldRunCuaScreenCaptureProbe(screenRecording, queryOptions)) {
    return false;
  }
  try {
    return isScreenCaptureProbeSuccess(await host.queryScreenCaptureProbe());
  } catch {
    return false;
  }
}

export async function resolveCuaScreenRecordingState(
  host: Pick<CuaHelperHost, "queryScreenRecordingPreflight">,
  reported: "granted" | "denied" | "unknown",
): Promise<"granted" | "denied" | "unknown"> {
  if (reported === "unknown") return reported;
  try {
    return (await host.queryScreenRecordingPreflight()) ?? reported;
  } catch {
    return reported;
  }
}

export function createDynamicCuaProductMcpServerResolver(options: {
  isPluginEnabled: (context?: CuaProductMcpServerResolverContext) => boolean;
  getResolver: (
    context?: CuaProductMcpServerResolverContext,
  ) => CuaProductMcpServerResolver | undefined | Promise<CuaProductMcpServerResolver | undefined>;
  isResolverCurrent?: (
    resolver: CuaProductMcpServerResolver,
    context?: CuaProductMcpServerResolverContext,
  ) => boolean;
}): CuaProductMcpServerResolver {
  return {
    async resolveMcpServers(servers, context) {
      if (!options.isPluginEnabled(context)) return servers;
      const resolver = await options.getResolver(context);
      if (!resolver) return servers;
      const resolved = await resolver.resolveMcpServers(servers, context);
      return options.isResolverCurrent?.(resolver, context) === false
        ? servers?.filter((server) => !isPotentialCfCuaAgentMcpServer(server))
        : resolved;
    },
    async restart() {
      const resolver = await options.getResolver();
      if (!resolver) {
        throw new Error("CodeFusion Computer Use is not enabled (plugin off or not product mode).");
      }
      await resolver.restart();
    },
    async restartAfterPermissionGrant(onboardingSessionId) {
      const resolver = await options.getResolver();
      if (!resolver) {
        throw new Error("CodeFusion Computer Use is not enabled (plugin off or not product mode).");
      }
      await resolver.restartAfterPermissionGrant(onboardingSessionId);
    },
  };
}

let orphanHelperReaperHasRun = false;

type CreateDefaultCuaProductHelperOptions = {
  hasActiveTurn?: () => boolean;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  resourcesPath?: string;
  arch?: NodeJS.Architecture;
  electronVersion?: string;
  resolveWindowsRuntime?: () => Promise<WindowsCuaRuntime>;
  createMacHost?: () => CuaHelperHost;
  createWindowsHost?: (runtime: WindowsCuaRuntime) => ManagedCuaProductHelperHost;
};

export function createWindowsCuaHelperHost(options: {
  resolveRuntime: () => Promise<WindowsCuaRuntime>;
  createHost: (runtime: WindowsCuaRuntime) => ManagedCuaProductHelperHost;
  logger?: ServiceLogger;
}): ManagedCuaProductHelperHost {
  let host: ManagedCuaProductHelperHost | undefined;
  let resolving: Promise<ManagedCuaProductHelperHost> | undefined;
  let stopped = false;
  let lifecycleEpoch = 0;
  let stopDrain: Promise<void> | undefined;
  const logResolutionFailure = (error: unknown): void => {
    if (!options.logger) return;
    const resolutionError =
      error instanceof WindowsCuaDevRuntimeResolutionError ? error : undefined;
    const artifact = resolutionError?.artifact;
    options.logger.error(undefined, "Windows CUA Helper runtime resolution failed", {
      reason: resolutionError?.reason ?? "unknown",
      ...(artifact ? { artifact } : {}),
      errorName: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    });
  };
  const assertActive = (epoch: number): void => {
    if (stopped || epoch !== lifecycleEpoch) {
      throw new Error("Windows Computer Use Helper startup stopped");
    }
  };
  const getHost = async (epoch: number): Promise<ManagedCuaProductHelperHost> => {
    assertActive(epoch);
    if (host) return host;
    resolving ??= options
      .resolveRuntime()
      .catch((error: unknown) => {
        logResolutionFailure(error);
        throw error;
      })
      .then((runtime) => {
        assertActive(epoch);
        const nextHost = options.createHost(runtime);
        assertActive(epoch);
        host = nextHost;
        return nextHost;
      });
    const resolvedHost = await resolving;
    assertActive(epoch);
    return resolvedHost;
  };
  const withActiveHost = async <T>(
    operation: (activeHost: ManagedCuaProductHelperHost) => Promise<T>,
  ): Promise<T> => {
    const epoch = lifecycleEpoch;
    const activeHost = await getHost(epoch);
    assertActive(epoch);
    return operation(activeHost);
  };
  return {
    get running() {
      return host?.running ?? false;
    },
    get socketPath() {
      return host?.socketPath ?? null;
    },
    get pluginAuthority() {
      return host?.pluginAuthority ?? null;
    },
    async start() {
      return withActiveHost((activeHost) => activeHost.start());
    },
    async checkHealth(timeoutMs?: number) {
      return withActiveHost((activeHost) => activeHost.checkHealth(timeoutMs));
    },
    async waitForTransport(timeoutMs?: number) {
      return withActiveHost((activeHost) => {
        if (!activeHost.waitForTransport) {
          return activeHost.start().then((handle) => ({
            socketPath: handle.socketPath,
            pluginAuthority: handle.pluginAuthority,
          }));
        }
        return activeHost.waitForTransport(timeoutMs);
      });
    },
    async restart() {
      return withActiveHost((activeHost) => activeHost.restart());
    },
    async restartAfterCurrentStart() {
      return withActiveHost((activeHost) => activeHost.restartAfterCurrentStart());
    },
    async restartAfterCurrentStartPreservingTransport(
      restartOptions?: CuaHelperTransportRestartOptions,
    ): Promise<CuaHelperTransportRestartResult> {
      return withActiveHost((activeHost) => {
        if (activeHost.restartAfterCurrentStartPreservingTransport) {
          return activeHost.restartAfterCurrentStartPreservingTransport(restartOptions);
        }
        restartOptions?.beforeFreshStart?.();
        return activeHost.restartAfterCurrentStart().then((handle) => ({ handle, reused: false }));
      });
    },
    async stop() {
      if (stopDrain) return stopDrain;
      stopped = true;
      lifecycleEpoch += 1;
      const pendingResolution = resolving;
      stopDrain = (async () => {
        await pendingResolution?.catch(() => undefined);
        await host?.stop();
      })();
      return stopDrain;
    },
  };
}

export function createDefaultCuaProductHelper(
  options: CreateDefaultCuaProductHelperOptions,
): DefaultCuaProductHelper | undefined {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (!shouldEnableDefaultCuaProductHelper({ platform, env })) {
    return undefined;
  }
  const logger = createServiceLogger("cua-product-helper");
  // Best-effort, once per process: reap Helpers orphaned by prior sessions before minting a
  // fresh one. Complements the per-Helper launcher-pid watchdog (helperMain); the reaper never
  // throws, so it cannot block startup.
  if (platform === "darwin" && !orphanHelperReaperHasRun) {
    orphanHelperReaperHasRun = true;
    reapOrphanedHelpers({ logger, env });
  }
  let macPermissionHost: CuaHelperHost | undefined;
  let host: ManagedCuaProductHelperHost;
  if (platform === "darwin") {
    const bundledHelperAppPath = resolveBundledCuaHelperAppPath();
    if (!bundledHelperAppPath) {
      logger.error(
        undefined,
        "CUA product Helper is unavailable: packaged Resources path was not resolved",
      );
      return undefined;
    }
    macPermissionHost =
      options.createMacHost?.() ??
      createProductCuaHelperHost({
        logger,
        env: process.env,
        helperInstaller: createCanonicalCuaHelperInstaller({
          logger,
          env: process.env,
          bundledAppPath: bundledHelperAppPath,
        }),
        bundledHelperAppPath,
        // tolerate the Helper's cold first-launch instead of the 5s default.
        healthTimeoutMs: CUA_HELPER_HEALTH_TIMEOUT_MS,
      });
    host = macPermissionHost;
  } else {
    host = createWindowsCuaHelperHost({
      resolveRuntime:
        options.resolveWindowsRuntime ??
        (() =>
          resolveWindowsCuaRuntime({
            platform,
            env,
            resourcesPath: options.resourcesPath,
            arch: options.arch,
            electronVersion: options.electronVersion,
          })),
      createHost:
        options.createWindowsHost ??
        ((runtime) =>
          new WindowsCuaHelperHost({
            runtime,
            logger,
            mintSocketPath: () => getStableCuaPipeName(),
          })),
      logger,
    });
  }
  const resolver = createCuaProductMcpServerResolver(host, {
    hasActiveTurn: options.hasActiveTurn,
  });
  return {
    host,
    ...(macPermissionHost ? { macPermissionHost } : {}),
    resolver,
  };
}

export const CF_CUA_BUNDLED_HELPER_APP_PATH_ENV = "CF_CUA_BUNDLED_HELPER_APP_PATH";

export function resolveBundledCuaHelperAppPath(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const injectedPath = env[CF_CUA_BUNDLED_HELPER_APP_PATH_ENV]?.trim();
  if (injectedPath) {
    return injectedPath;
  }
  const resourcesPath = (
    process as NodeJS.Process & { resourcesPath?: string }
  ).resourcesPath?.trim();
  return resourcesPath ? join(resourcesPath, "cua-helper", HELPER_APP_NAME) : undefined;
}

export { isOfficialCuaPluginEnabledForWorkspace };

export function hasGlobalCliCfCuaServer(env: NodeJS.ProcessEnv = process.env): boolean {
  const home = env.HOME?.trim() || homedir();
  const configPath = join(home, ".cf", "cli", "config.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return false;
  }
  if (!isRecord(parsed)) return false;
  if (isRecord(parsed.features) && parsed.features.mcp === false) return false;
  if (!isRecord(parsed.mcp) || !isRecord(parsed.mcp.servers)) return false;
  return Object.entries(parsed.mcp.servers).some(([name, config]) =>
    isGlobalCliCfCuaServer(name, config),
  );
}

function isGlobalCliCfCuaServer(name: string, config: unknown): boolean {
  if (!isRecord(config)) return false;
  if (config.enabled === false) return false;
  if (typeof config.type === "string" && config.type !== "stdio") return false;
  if (name === "computer-use") return true;
  if (typeof config.command === "string" && isCfCuaMcpCommand(config.command)) {
    return true;
  }
  return (
    Array.isArray(config.args) &&
    config.args.some((arg) => typeof arg === "string" && isCfCuaMcpPackageArg(arg))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createLocalServices(options: {
  
  topicResourceRelayChannel?: (request: unknown) => IChannel;
  parentPort?: Parameters<typeof createBroadcastService>[0];
  
  resolveBotRemoteWorkspace?: (target: {
    workspacePath: string;
    workspaceIdentity: string;
  }) => Promise<{ workspacePath: string; workspaceIdentity: string } | null>;
  
  settingService?: ISettingService;
  setWorkspaceProjection?: ReturnType<
    typeof createSettingServiceWithMigrations
  >["setWorkspaceProjection"];
  
  prepareLegacyAccountConnections?: ReturnType<
    typeof createSettingServiceWithMigrations
  >["prepareLegacyAccountConnections"];
  
  hostApiNetworkTransport?: HostApiNetworkTransport;
  
  resolveClientLanguage?: () => string | undefined;
  
  authorizeLocalMediaPreviewPath?: (path: string) => Promise<string>;
  
  forwardDynamicWorkflowUserMode?: (mode: DynamicWorkflowMode | undefined) => void;
  
  registerPluginSandbox?: (input: PluginSandboxRegisterInput) => Promise<PluginSandboxHandle>;
  feedback?: Partial<
    Omit<CreateFeedbackServiceOptions, "apiClient" | "credentialService" | "oauthService">
  >;
  reportPluginTelemetryEvent?: (
    event: import("@origin-ai/cf-shared").RendererTelemetryEventPayload,
  ) => void | Promise<void>;
  processLifecycleReporter?: RuntimeProcessLifecycleReporter;
  taskRuntimeReporter?: RuntimeTaskReporter;
  
  workspaceFileSearchFilter?: WorkspaceFileSearchFilter;
  forwardSessionMessageSendRequested?: (
    request: SessionMessageSendRequested,
  ) => Promise<void> | void;
  
  onAutomationManualRunRequested?: (params: {
    automation: CfAutomation;
    run: CfAutomationRun;
  }) => Promise<void>;
  
  onOffPeakSchedulerWakeRequested?: () => void;
  cfAgentCommandResolver?: CfAgentCommandResolver;
  
  runtimeProcessEnvPatch?: Record<string, string>;
  
  cfAgentSpawnFallbackCwd?: string;
  
  remoteAgentNetwork?: {
    httpProxy?: string;
    noProxy?: string;
  };
  
  cfBuiltinProviderConfigFilePath: string;
  
  providerProvisioningTargetEnabled?: boolean;
  
  onProviderProvisioningSourceChanged?: (
    trigger: Exclude<ProviderProvisioningTrigger, "environment-online">,
  ) => void;
  serviceAuthorityMode?: ServiceAuthorityMode;
  
  projectStorageHostId?: string;
  sourceServerWorkspaceService?: ISourceServerWorkspaceService;
  resolveProjectHostService?: (hostId: string) => Promise<IProjectService>;
  
  resolveBotProjectConnection?: (hostId: string) => BotProjectConnection | undefined;
  remoteProjectConnection?: Pick<
    Parameters<typeof createRemoteProjectService>[0],
    "connectHost" | "readConnectionStates"
  >;
  cuaProductMcpServerResolver?: CuaProductMcpServerResolver;
  agentTelemetry?: {
    getDeviceMid?: () => string | undefined;
    runtimeSurface?: "desktop_local_host" | "remote_workspace_host";
  };
  
  browserControlExecutor?: {
    list(input: {
      requestId: string;
      sessionId: string;
      turnId?: string;
      workspaceKey: string;
      workspacePath: string;
      workspaceIdentity?: string;
      remoteSessionId?: string;
      clientMode: BrowserClientMode;
      sessionContext: "live" | "cached";
    }): Promise<BrowserBackendDescriptor[]>;
    execute(input: {
      requestId: string;
      browserId?: string;
      browserGeneration?: number;
      sessionId: string;
      turnId?: string;
      workspaceKey: string;
      workspacePath: string;
      workspaceIdentity?: string;
      remoteSessionId?: string;
      clientMode: BrowserClientMode;
      sessionContext: "live" | "cached";
      command: BrowserCommand;
    }): Promise<{ ok: boolean; [k: string]: unknown }>;
  };
  
  cuaOperationStateReporter?: CuaOperationStateReporter;
}): ServiceCollection {
  const isDesktopAttachedRemote = options?.serviceAuthorityMode === "desktop-attached-remote";
  initializeRuntimeProcessEnv(options?.runtimeProcessEnvPatch);

  const desktopContextPromptEnabledRaw =
    process.env[CF_DESKTOP_CONTEXT_PROMPT_ENABLED_ENV]?.trim();
  const desktopContextPromptEnabled =
    desktopContextPromptEnabledRaw === "1"
      ? true
      : desktopContextPromptEnabledRaw === "0"
        ? false
        : undefined;

  try {
    ensureAppCaCert();
  } catch (error) {
    console.error(formatLogPrefix("appCaCert", process.pid), "ensure app CA cert failed:", error);
  }

  const localSettings = options?.settingService ? null : createSettingServiceWithMigrations();
  const settingService = createObservableSettingService(
    options?.settingService ?? localSettings!.service,
  );
  const resolveCurrentCfEndpointOrigin = async () =>
    resolveRuntimeCfEndpointOrigin(process.env, {
      overrideOrigin: (await settingService.get()).cfEndpointOrigin,
    });
  let invalidateProjectTokens = () => {};
  let invalidatePluginUiAccounts: (() => void) | undefined;
  const provisioningOAuthKeys = new Set<string>(PROVIDER_PROVISIONING_OAUTH_CREDENTIAL_KEYS);
  const credentialService = createCredentialService({
    onDidMutate: ({ key }) => {
      if (key === "oauth:active_provider" || /^oauth:[^:]+:user_info$/.test(key))
        invalidatePluginUiAccounts?.();
      if (provisioningOAuthKeys.has(key)) invalidateProjectTokens();
      if (provisioningOAuthKeys.has(key)) {
        options.onProviderProvisioningSourceChanged?.("credential");
      }
    },
  });
  const accountProviderCredentialStore = createAccountProviderCredentialStore({
    credentialService,
  });
  const broadcastService = createBroadcastService(options?.parentPort ?? null);
  const gitCheckpointService = createGitCheckpointService();
  const hostApiNetworkTransport =
    options?.hostApiNetworkTransport ??
    createHostApiNetworkTransport(async () => {
      const settings = await settingService.get();
      return {
        httpProxy: settings.httpProxy,
        noProxy: settings.httpProxyNoProxy,
        caCertPath: settings.httpProxyCaCertPath,
      };
    });
  const cfJwtLogoutHandlerRef: {
    current: ((input: string | URL, headers: Headers) => void) | null;
  } = { current: null };
  const apiClient = createNodeApiClient({
    fetchImpl: hostApiNetworkTransport.fetch,
    onCfJwtInvalid: (input, headers) => cfJwtLogoutHandlerRef.current?.(input, headers),
    isCfJwtRequest: (input, headers) =>
      isCurrentOAuthCredentialRequest({ input, headers, credentialService }),
    isBusinessUnauthorizedRequest: (input, _headers) =>
      isOAuthBusinessRequest({ input, credentialService }),
    resolveBusinessCredentialValidationRequest: (input, headers) =>
      resolveOAuthBusinessCredentialValidationRequest({ input, headers, credentialService }),
    resolveCfEndpointOrigin: resolveCurrentCfEndpointOrigin,
    resolveClientLanguage: options?.resolveClientLanguage,
  });
  const systemService = createSystemService();
  const taskIndexRepo = new TaskIndexRepo(undefined, options?.projectStorageHostId);
  const onboardingEvidenceLogger = createServiceLogger("onboardingRecordService");
  const onboardingRecordService = createOnboardingRecordService({
    loadUserId: async () => (await oauthCredentialRepo.loadActiveUserProfile())?.id ?? null,
    hasExistingLocalTask: createHasExistingLocalTask({
      listIndexTasks: () => taskIndexRepo.listTaskMetas({ includeDeleted: true }),
      hasAgentSessionRow: async () => {
        const sessionDbPath = await resolveAgentSessionDbPath();
        if (sessionDbPath === null) {
          onboardingEvidenceLogger.debug(
            "Onboarding session evidence source skipped: session library path cannot be mirrored (relative path or project-level override)",
          );
          return false;
        }
        const hasRow = await hasAnyAgentSessionRow(sessionDbPath);
        onboardingEvidenceLogger.debug("Onboarding session evidence source queried", { hasRow });
        return hasRow;
      },
      resolveLegacyTaskSessionsDir: () => join(resolveAppConfigDir(), "sessions"),
    }),
  });
  let handleOAuthProviderLogout: ReturnType<typeof createOAuthProviderLogoutHandler> | null = null;
  const oauthCredentialRepo = new OAuthCredentialRepo(credentialService, {
    onCorruptOAuthSessionCleared: async (providers) => {
      void Promise.all(
        providers.map((provider) => handleOAuthProviderLogout?.(provider) ?? Promise.resolve()),
      ).catch((error: unknown) => {
        createServiceLogger("oauth-credential-recovery").warn(
          "refresh derived providers after corrupt OAuth cleanup failed",
          { error },
        );
      });
    },
  });
  const projectTokenClient = createAccountProjectTokenClient(apiClient, credentialService);
  invalidateProjectTokens = () => projectTokenClient.clear();
  const accountProviderApiKeyRemoteClient = new AccountProviderApiClient(apiClient);
  const accountProviderApiKeyResolver = new AccountProviderApiKeyResolver(
    accountProviderApiKeyRemoteClient.fetchRemoteData.bind(accountProviderApiKeyRemoteClient),
    projectTokenClient,
  );
  const accountProviderCredentialService = createAccountProviderCredentialService({
    async loadOAuthAccessToken(family) {
      const oauthProviderId = family === "zai" ? ZAI_PROVIDER_ID : BIGMODEL_PROVIDER_ID;
      return (await oauthCredentialRepo.loadTokenSet(oauthProviderId))?.accessToken ?? null;
    },
    resolveProviderMaterial: (
      family,
      accessToken,
      accountIdentity,
      rejectedProjectTokenFingerprint,
    ) =>
      accountProviderApiKeyResolver.resolveProviderMaterial(
        family === "zai" ? ZAI_PROVIDER_ID : BIGMODEL_PROVIDER_ID,
        accessToken,
        accountIdentity,
        rejectedProjectTokenFingerprint,
      ),
  });
  const resolveLegacyTeamOrganization = createLegacyTeamOrganizationResolver({
    apiClient,
    loadOAuthTokenSet: (family) =>
      oauthCredentialRepo.loadTokenSet(family === "zai" ? ZAI_PROVIDER_ID : BIGMODEL_PROVIDER_ID),
  });
  const readAccountProviderSettings = async () => {
    const prepare =
      options?.prepareLegacyAccountConnections ?? localSettings?.prepareLegacyAccountConnections;
    const unresolvedFamilies = (await prepare?.(resolveLegacyTeamOrganization)) ?? [];
    const settings = await settingService.get();
    return {
      providerFamilyDomain: settings.providerFamilyDomain ?? null,
      selections: settings.providerFamilyConnectionSelections ?? {},
      unresolvedFamilies,
    };
  };
  const loadAccountIdentity = async (family: ProviderFamilyDomain) => {
    const oauthProviderId = family === "zai" ? ZAI_PROVIDER_ID : BIGMODEL_PROVIDER_ID;
    return (await oauthCredentialRepo.loadUserProfile(oauthProviderId))?.id ?? null;
  };
  const accountRequestAuthService = createAccountRequestAuthService(
    createAccountProviderRequestAuthService({
      resolveCurrentAccountAccess: (access) =>
        resolveCurrentAccountAccess({
          access,
          readSettings: readAccountProviderSettings,
          loadAccountIdentity,
        }),
      loadOAuthTokenSet: (providerId) => oauthCredentialRepo.loadTokenSet(providerId),
      async loadIndividualPlanMaterial(providerId, family, rejectedProjectTokenFingerprint) {
        const oauthProviderId = family === "zai" ? ZAI_PROVIDER_ID : BIGMODEL_PROVIDER_ID;
        const accountIdentity = (await oauthCredentialRepo.loadUserProfile(oauthProviderId))?.id;
        if (!accountIdentity) return null;
        return accountProviderCredentialService.loadCodingPlanMaterial({
          providerId,
          family,
          accountIdentity,
          rejectedProjectTokenFingerprint,
        });
      },
      resolveTeamPlanMaterial: async (access, rejectedProjectTokenFingerprint) => {
        const accountIdentity = await loadAccountIdentity(access.family);
        if (!accountIdentity) return null;
        return resolveAccountTeamPlanRuntimeMaterial({
          apiClient,
          credentialService,
          access,
          accountIdentity,
          tokenClient: projectTokenClient,
          rejectedProjectTokenFingerprint,
        });
      },
    }),
  );
  const providerConfigLog = createServiceLogger("provider-config");
  const clientConfigPlatform = resolveClientConfigPlatform();
  const providerConfigRuntime = createProviderConfigRuntime({
    cfBuiltinFilePath: options.cfBuiltinProviderConfigFilePath,
    cfBuiltinEnvironment: {
      environmentConfigRoot: resolveAppConfigDir(),
      platform: clientConfigPlatform,
      appVersion: CF_VERSION,
      resolveEndpointOrigin: resolveCurrentCfEndpointOrigin,
      onRefreshResult: (event) => {
        if (event.result === "updated")
          providerConfigLog.info(undefined, "CodeFusion Built-in CDN configuration updated", event);
        else providerConfigLog.debug(undefined, "CodeFusion Built-in refresh check", event);
      },
      fetchRelease: (endpointOrigin, signal) =>
        fetchCfBuiltinRemoteRelease({
          apiClient,
          endpointOrigin,
          signal,
          appVersion: CF_VERSION,
          platform: clientConfigPlatform,
        }),
    },
    onCfBuiltinRefreshError: (error) => {
      providerConfigLog.warn(undefined, "CodeFusion Built-in Config remote refresh failed", { error });
    },
    onPersonalConfigRecovery: (event) => {
      providerConfigLog.warn(
        undefined,
        "Failed to load Personal Provider Config; disk state retained and degraded with in-memory empty config",
        {
          error: event.error,
        },
      );
    },
    onPersonalConfigPollingError: (error) => {
      providerConfigLog.warn(undefined, "Personal Provider Config polling temporarily failed; will retry", {
        error,
      });
    },
    readLegacyProviders: () => readLegacyCfConfigProviders(),
  });
  const accountProviderConfigSource = createAccountProviderConfigSource({
    configSource: providerConfigRuntime.configService,
    readSettings: readAccountProviderSettings,
    async loadCodingPlanApiKey(providerId, family, accountIdentity, forceRefresh) {
      if (isStartPlanModelProviderId(providerId)) return null;
      return accountProviderCredentialService.loadCodingPlanApiKey({
        providerId,
        family,
        accountIdentity,
        forceRefresh,
      });
    },
    loadAccountIdentity,
    resolveFamilyAvailability: createCodingPlanFamilyAvailabilityResolver({
      apiClient,
      credentialService,
    }),
  });
  const accountProviderRuntimeLog = createServiceLogger("account-provider-runtime");
  const modelSelectionConfiguredDefaultSource = new NodeModelSelectionConfigRepository({
    personalRepository: providerConfigRuntime.personalRepository,
  });
  const providerProvisioningSource = createProviderProvisioningSource({
    personalRepository: providerConfigRuntime.personalRepository,
    settingService,
    credentialFilePath: resolveCredentialFilePath(resolveAppConfigDir()),
    personalConfigFilePath: join(resolveAppConfigDir(), PERSONAL_PROVIDER_CONFIG_FILE_NAME),
  });
  const providerProvisioningDisposers = [
    providerConfigRuntime.configService.onDidChange((reason) => {
      if (reason === "personal:updated") {
        options.onProviderProvisioningSourceChanged?.("personal-config");
      }
    }),
    settingService.onDidUpdate((event) => {
      if (
        event.keys.includes("providerFamilyDomain") ||
        event.keys.includes("providerFamilyConnectionSelections")
      ) {
        options.onProviderProvisioningSourceChanged?.("account-settings");
      }
    }),
  ];
  const disposeAccountProviderInvalidation = bindAccountProviderInvalidation({
    onDidUpdateSetting: (listener) => settingService.onDidUpdate(listener),
    refresh: (reason) => accountProviderConfigSource.refresh(reason),
  });
  const accountProviderRefreshErrorDispose = accountProviderConfigSource.onDidRefreshError(
    (event) => {
      accountProviderRuntimeLog.warn(undefined, "account provider source refresh failed", {
        error: event.error,
        reasons: event.reasons,
      });
    },
  );
  let providerConnectivityAgentService:
    | Pick<ICfAgentService, "testModelConnectivity">
    | undefined;
  const providerRuntime = createProviderRuntimeFromConfigRuntime({
    configRuntime: providerConfigRuntime,
    accountSource: accountProviderConfigSource,
    modelSelectionConfiguredDefaultSource,
    disposeModelSelectionConfiguredDefaultSource: () =>
      modelSelectionConfiguredDefaultSource.dispose(),
    testConnectivity: createProviderSettingsConnectivityTester({
      testModelConnectivity: async (input) => {
        if (!providerConnectivityAgentService) {
          throw new Error("Agent Service has not completed model connectivity test assembly");
        }
        return providerConnectivityAgentService.testModelConnectivity(input);
      },
    }),
    disposeAccountSource: () => {
      disposeAccountProviderInvalidation();
      accountProviderRefreshErrorDispose();
      accountProviderConfigSource.dispose();
    },
  });
  handleOAuthProviderLogout = createOAuthProviderLogoutHandler({
    accountProviderCredentialStore,
    refreshAccountProviders: (reason: string) => accountProviderConfigSource.refresh(reason),
  });
  const sourceServerWorkspaceService =
    options.sourceServerWorkspaceService ?? createSourceServerWorkspaceService();
  const officialMcpCredentialSource = {
    resolve: () =>
      resolveOfficialMcpCredentials({
        accountRequestAuthService,
        credentialService,
        modelSelectionService: providerRuntime.modelSelection,
      }),
  };
  const skillsService = createSkillsService({ isDesktopRuntime: true });
  const mcpSyncService = createMcpSyncService({
    listMcpServerStatuses: (params) => cfAgentService.listMcpServerStatuses(params),
  });
  const pluginSyncService = createPluginSyncService();
  const pluginUiAccounts = createPluginUiAccountBindings({
    async readAccount() {
      const provider = await oauthCredentialRepo.loadActiveProvider();
      const profile = provider ? await oauthCredentialRepo.loadUserProfile(provider) : null;
      return [provider, profile?.id ?? null];
    },
    open: (params) => cfAgentService.openMcpUiInstance(params),
    close: (params) => cfAgentService.closeMcpUiInstance(params),
  });
  invalidatePluginUiAccounts = () => pluginUiAccounts.invalidate();
  const pluginUiBridgeService = createPluginUiBridgeService({
    reportTelemetryEvent: options?.reportPluginTelemetryEvent,
    openInstance: (params) => pluginUiAccounts.open(params),
    closeInstance: (params) => pluginUiAccounts.close(params),
    validateInstance: (params) => cfAgentService.validateMcpUiInstance(params),
    recycleInstance: (params) => cfAgentService.recycleMcpUiInstance(params),
    readMcpResource: (params) => cfAgentService.readMcpResource(params),
    callMcpToolForUi: (params) => cfAgentService.callMcpToolForUi(params),
    cancelMcpToolCallForUi: (params) => cfAgentService.cancelMcpToolCallForUi(params),
    readMcpResourceForUi: (params) => cfAgentService.readMcpResourceForUi(params),
    listMcpResourcesForUi: (params) => cfAgentService.listMcpResourcesForUi(params),
    listMcpResourceTemplatesForUi: (params) =>
      cfAgentService.listMcpResourceTemplatesForUi(params),
    subscribeMcpResourceForUi: (params) => cfAgentService.subscribeMcpResourceForUi(params),
    unsubscribeMcpResourceForUi: (params) => cfAgentService.unsubscribeMcpResourceForUi(params),
    listPluginUiSurfaces: (params) => cfAgentService.listPluginUiSurfaces(params),
    registerSandbox: options?.registerPluginSandbox,
  });
  const pluginUiSamplingService = createPluginUiSamplingService({
    sample: (params) => cfAgentService.sampleMcpApp(params),
    cancelSampling: (params) => cfAgentService.cancelMcpAppSampling(params),
  });
  const pluginUiAppToolsService = createPluginUiAppToolsService({
    registerAppToolsForUi: (params) => cfAgentService.registerAppToolsForUi(params),
    unregisterAppToolsForUi: (params) => cfAgentService.unregisterAppToolsForUi(params),
    claimAppToolCallForUi: (params) => cfAgentService.claimAppToolCallForUi(params),
    resolveAppToolCallForUi: (params) => cfAgentService.resolveAppToolCallForUi(params),
  });
  const subagentsService = createSubagentsService({
    isDesktopRuntime: true,
  });
  const commandsService = createCommandsService({ isDesktopRuntime: true });
  const hooksService = createHooksService({
    grantWorkspaceHookTrust: (params) => cfAgentService.grantWorkspaceHookTrust(params),
  });
  const memoryService = createMemoryService();
  const modelSelectionReadinessSource = providerRuntime.modelSelection;
  const agentAccountProviderConfigSource = accountProviderConfigSource;
  let hasActiveTurnRef: (() => boolean) | undefined;
  const isCuaEnabledForContext = (context?: CuaProductMcpServerResolverContext): boolean =>
    isCfCuaInternalFeatureEnabled(process.env) ||
    isOfficialCuaPluginEnabledForWorkspace({
      env: process.env,
      workingDirectory: context?.workspacePath,
    });
  const defaultCuaProductHelperLifecycle =
    new CuaHelperLifecycleManager<ManagedDefaultCuaProductHelper>(async (managed) => {
      await managed.helper.host.stop();
    });
  const createManagedDefaultCuaProductHelper = (
    context?: CuaProductMcpServerResolverContext,
  ): ManagedDefaultCuaProductHelper | undefined => {
    const helper = createDefaultCuaProductHelper({
      hasActiveTurn: () => hasActiveTurnRef?.() ?? false,
    });
    if (!helper) return undefined;

    return {
      helper,
      ...(context ? { seedContext: context } : {}),
    };
  };
  const getOrCreateDefaultCuaProductHelper = async (
    context?: CuaProductMcpServerResolverContext,
  ): Promise<DefaultCuaProductHelper | undefined> => {
    const managed = await defaultCuaProductHelperLifecycle.acquire({
      isAdmitted: () =>
        shouldCreateDefaultCuaProductHelper({
          serviceAuthorityMode: options?.serviceAuthorityMode,
          hasRemoteWorkspaceIdentity: Boolean(context?.workspaceIdentity?.trim()),
          hasInjectedResolver: Boolean(options?.cuaProductMcpServerResolver),
          hasBuiltInCuaPlugin: isCuaEnabledForContext(context),
        }),
      shouldRetainCurrent: shouldRetainDefaultCuaProductHelper,
      create: () => createManagedDefaultCuaProductHelper(context),
    });
    return managed?.helper;
  };
  const isDefaultCuaProductHelperCurrent = (helper: DefaultCuaProductHelper): boolean =>
    defaultCuaProductHelperLifecycle.peek()?.helper === helper;
  const probeStableCuaHelperSocket = async (): Promise<string | null> => {
    const socketPath =
      process.platform === "win32" ? getStableCuaPipeName() : resolveBrokerSocketPath();
    try {
      const { createConnection } = await import("node:net");
      return await new Promise<string | null>((resolve) => {
        const socket = createConnection(socketPath);
        const finish = (value: string | null): void => {
          socket.destroy();
          resolve(value);
        };
        const timer = setTimeout(() => finish(null), 300);
        socket.on("connect", () => {
          clearTimeout(timer);
          socket.write(`{"id":0,"method":"ping","params":{}}\n`);
          let buffer = "";
          socket.on("data", (chunk: Buffer) => {
            buffer += chunk.toString("utf8");
            if (buffer.includes("\n")) {
              try {
                const nl = buffer.indexOf("\n");
                const reply = JSON.parse(buffer.slice(0, nl)) as { ok?: boolean };
                finish(reply.ok === true ? socketPath : null);
              } catch {
                finish(null);
              }
            }
          });
        });
        socket.on("error", () => {
          clearTimeout(timer);
          finish(null);
        });
      });
    } catch {
      return null;
    }
  };

  //
  //
  //

  const cuaStatusLaunchLog = createServiceLogger("cua-status-launch");
  const launchStandaloneCuaHelperForStatus = async (): Promise<string | null> => {
    if (process.platform !== "darwin") return null;
    const { existsSync } = await import("node:fs");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const socketPath = resolveBrokerSocketPath();
    let appPath: string | null;
    try {
      appPath = await resolveStandaloneStatusLaunchAppPath({
        env: process.env,
        bundledAppPath: resolveBundledCuaHelperAppPath(),
        exists: existsSync,
        ensureInstalled: (bundledAppPath) =>
          createCanonicalCuaHelperInstaller({
            logger: cuaStatusLaunchLog,
            env: process.env,
            bundledAppPath,
          }).ensureInstalled(),
      });
    } catch (error) {
      cuaStatusLaunchLog.warn(undefined, "CUA Helper install before status launch failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
    if (!appPath) return null;
    const args = buildHelperOpenArgs({
      appPath,
      socketPath,
      exitLogPath: `${socketPath}.settings.exit.log`,
      ...(isCuaLocalDevelopmentRuntime(process.env)
        ? { allowUnsignedLauncherLocalDev: true, allowExternalBrokerClientLocalDev: true }
        : {}),
    });
    try {
      await promisify(execFile)("/usr/bin/open", args, { timeout: 5_000 });
    } catch {
    }
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const ready = await probeStableCuaHelperSocket();
      if (ready) return ready;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  };

  const launchWindowsCuaHelperForStatus = async (): Promise<string | null> => {
    try {
      const managed = await getOrCreateDefaultCuaProductHelper(undefined);
      if (managed) void managed.host.start().catch(() => {});
    } catch {}
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const ready = await probeStableCuaHelperSocket();
      if (ready) return ready;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  };

  const cuaPipSessionEnabled =
    process.platform === "darwin" && options?.serviceAuthorityMode === "desktop-local";
  const cuaPipSessionService = createCuaPipSessionService({
    enabled: cuaPipSessionEnabled,
    resolveCredentials: async () => {
      const host = defaultCuaProductHelperLifecycle.peek()?.helper.macPermissionHost;
      if (host?.running && host.socketPath) {
        return {
          socketPath: host.socketPath,
        };
      }
      const stable = await probeStableCuaHelperSocket();
      return stable ? { socketPath: stable } : undefined;
    },
  });
  createServiceLogger("cua-pip-session").info(undefined, "[cua-pip-session] wiring resolved", {
    enabled: cuaPipSessionEnabled,
    platform: process.platform,
    serviceAuthorityMode: options?.serviceAuthorityMode ?? null,
    lifecycleWired: options?.serviceAuthorityMode === "desktop-local",
  });
  const cuaPermissionService: ICuaPermissionService = {
    async getStatus(
      workspacePath: string,
      workspaceIdentity?: string,
      queryOptions?: CuaPermissionStatusQueryOptions,
    ): Promise<CuaPermissionStatusResult> {
      if (process.platform !== "darwin" && process.platform !== "win32") {
        return {
          available: false,
          reason: "CUA permissions are only available on macOS and Windows.",
        };
      }
      const context = workspacePath ? { workspacePath, workspaceIdentity } : undefined;
      if (
        !shouldUseCuaPermissionService({
          cuaEnabled: isCuaEnabledForContext(context),
        })
      ) {
        return {
          available: false,
          reason: "CodeFusion Computer Use is not enabled (plugin off or not product mode).",
        };
      }
      const peeked = defaultCuaProductHelperLifecycle.peek()?.helper;
      const helper = peeked && isDefaultCuaProductHelperCurrent(peeked) ? peeked : undefined;
      const host = helper ? helper.macPermissionHost : undefined;
      if (!host || !host.running) {
        let stable = await probeStableCuaHelperSocket();
        if (!stable) {
          stable =
            process.platform === "darwin"
              ? await launchStandaloneCuaHelperForStatus()
              : await launchWindowsCuaHelperForStatus();
        }
        if (!stable) {
          return {
            available: false,
            reason:
              "CodeFusion Computer Use is not running; it will start automatically on first Computer Use use.",
            idle: true,
          } satisfies { available: false; reason: string; idle: true };
        }
        try {
          const { callBrokerMethod } = await import("@origin-ai/cf-cua/broker/helperHealth");
          const report = await callBrokerMethod<{
            grant_owner: string;
            owner?: { display_name?: string };
            accessibility: CuaPermissionState;
            accessibility_probe_ok?: boolean;
            screen_recording: CuaPermissionState;
          }>({
            socketPath: stable,
            method: "permission_status",
            timeoutMs: 3000,
          });
          return {
            grantOwner: report.grant_owner,
            grantOwnerDisplayName: report.owner?.display_name ?? report.grant_owner,
            accessibility: report.accessibility,
            accessibilityProbeOk: report.accessibility_probe_ok === true,
            screenRecording: report.screen_recording,
            screenCaptureProbeOk: false,
          };
        } catch {
          return {
            available: false,
            reason: "CodeFusion Computer Use is starting up; retry in a moment.",
            idle: true,
          } satisfies { available: false; reason: string; idle: true };
        }
      }
      try {
        const report = await host.queryPermissionStatus();
        if (!helper || !isDefaultCuaProductHelperCurrent(helper)) {
          return {
            available: false,
            reason: "CodeFusion Computer Use lifecycle is disposed.",
          };
        }
        const screenRecording = await resolveCuaScreenRecordingState(host, report.screen_recording);
        if (!isDefaultCuaProductHelperCurrent(helper)) {
          return {
            available: false,
            reason: "CodeFusion Computer Use lifecycle is disposed.",
          };
        }
        const screenCaptureProbeOk = await runCuaScreenCaptureReadinessProbe(
          host,
          screenRecording,
          queryOptions,
        );
        if (!isDefaultCuaProductHelperCurrent(helper)) {
          return {
            available: false,
            reason: "CodeFusion Computer Use lifecycle is disposed.",
          };
        }
        const reportedOwnerDisplayName =
          typeof report.owner?.display_name === "string" ? report.owner.display_name : undefined;
        return {
          grantOwner: report.grant_owner,
          grantOwnerDisplayName: reportedOwnerDisplayName ?? report.grant_owner,
          accessibility: report.accessibility,
          accessibilityProbeOk:
            report.accessibility_probe?.ok === true &&
            report.accessibility_probe?.classification === "functional",
          screenRecording,
          screenCaptureProbeOk,
        };
      } catch (error) {
        return {
          available: false,
          reason: `Could not read Computer Use Helper permission status: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    },
    async restartHelper(
      workspacePath: string,
      workspaceIdentity?: string,
      restartOptions?: CuaPermissionRestartOptions,
    ): Promise<CuaPermissionRestartResult> {
      if (process.platform !== "darwin") {
        return {
          ok: false,
          reason: "CUA permissions are only available on macOS.",
        };
      }
      const context = workspacePath ? { workspacePath, workspaceIdentity } : undefined;
      if (
        !shouldUseCuaPermissionService({
          cuaEnabled: isCuaEnabledForContext(context),
        })
      ) {
        return {
          ok: false,
          reason: "CodeFusion Computer Use is not enabled (plugin off or not product mode).",
        };
      }
      const helper = await getOrCreateDefaultCuaProductHelper(context);
      const resolver =
        helper && helper.macPermissionHost && isDefaultCuaProductHelperCurrent(helper)
          ? helper.resolver
          : undefined;
      if (!resolver) {
        return {
          ok: false,
          reason: "CodeFusion Computer Use is not enabled (plugin off or not product mode).",
        };
      }
      try {
        if (restartOptions?.reason === "permission_granted") {
          await resolver.restartAfterPermissionGrant(restartOptions.onboardingSessionId);
        } else {
          await resolver.restart();
        }
        if (!helper || !isDefaultCuaProductHelperCurrent(helper)) {
          return {
            ok: false,
            reason: "CodeFusion Computer Use lifecycle is disposed.",
          };
        }
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          reason: `Failed to restart CodeFusion Computer Use: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    },
  };
  const resolveDynamicWorkflowUserMode = isDesktopAttachedRemote
    ? undefined
    : async () => (await settingService.get()).dynamicWorkflowMode;
  const codingPlanSubscriptionService = createCodingPlanSubscriptionService({
    apiClient,
    credentialService,
    ...(resolveDynamicWorkflowUserMode ? { resolveDynamicWorkflowUserMode } : {}),
    resolveOffPeakModelSelectionView: async () => {
      await providerRuntime.start();
      return buildOffPeakModelSelectionView(providerRuntime.registryService.getView());
    },
  });
  let offPeakTaskServiceForAgent: OffPeakTaskService | undefined;
  const offPeakToolWiring =
    options?.serviceAuthorityMode === "desktop-attached-remote"
      ? {}
      : {
          resolveOffPeakClientConfig: () => codingPlanSubscriptionService.getOffPeakClientConfig(),
          resolveOffPeakTaskService: () => offPeakTaskServiceForAgent,
        };
  const setWorkspaceProjection =
    options?.setWorkspaceProjection ?? localSettings?.setWorkspaceProjection;
  setWorkspaceProjection?.(async (settings) => {
    const db = await taskIndexRepo.getOrganizationDatabase();
    const repository = await taskIndexRepo.getProjectRepository();
    db.exec("BEGIN");
    try {
      const directory =
        !options?.projectStorageHostId || options.projectStorageHostId === "local"
          ? readRemoteProjectDirectory(db)
          : { hosts: [], entries: [] };
      const projection = projectWorkspaceSettings(
        repository.readTree({ includeTasks: false }).projects,
        directory,
        settings,
      );
      db.exec("COMMIT");
      return projection;
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  });
  const publishProjectChange = async () => {
    if (setWorkspaceProjection) await settingService.update({});
    await broadcastService.send({ channel: "state:projects", payload: {} });
  };
  const remoteProjectService = createRemoteProjectService({
    ...options?.remoteProjectConnection,
    controller: !options?.projectStorageHostId || options.projectStorageHostId === "local",
    database: () => taskIndexRepo.getOrganizationDatabase(),
    afterChange: publishProjectChange,
  });
  const projectService = createProjectService({
    directories: {
      home: async () => (await systemService.info()).homedir,
      read: (params) => fileService.readdir(params),
    },
    ownerHostId: options?.projectStorageHostId,
    resolveHost: options?.resolveProjectHostService,
    repository: () => taskIndexRepo.getProjectRepository(),
    workspaceDirectory: join(projectDataRoot(), "workspace"),
    afterChange: publishProjectChange,
  });
  const taskGroupService = createTaskGroupService({
    database: () => taskIndexRepo.getOrganizationDatabase(),
    resolveTasks: async (refs) => {
      const hostIds = [...new Set(refs.map((task) => task.hostId))];
      const results = await Promise.all(
        hostIds.map(async (hostId) => {
          const tree = await projectService.readTree({ hostId, includeDeletedTasks: true });
          const facts = new Map(
            [
              ...tree.tasks,
              ...(tree.deletedTasks ?? []).map((task) => ({ ...task, deleted: true })),
            ].map((task) => [groupTaskKey(task), task]),
          );
          return refs
            .filter((ref) => ref.hostId === hostId)
            .flatMap((ref) => {
              const fact = facts.get(groupTaskKey(ref));
              return fact && fact.hostId === ref.hostId && fact.workspacePath === ref.workspacePath
                ? [{ ...fact, ...ref }]
                : [];
            });
        }),
      );
      return results.flat();
    },
    afterChange: () => broadcastService.send({ channel: "state:task-groups", payload: {} }),
  });
  const prepareProjectExecution = async (projectId: string) => ({
    ...(await projectService.prepareSession({ projectId })),
    hostId: options?.projectStorageHostId ?? "local",
    workspaceIdentity: undefined,
  });
  const cfAgentService = createCfAgentService({
    prepareProjectExecution,
    prepareSessionCreation: async (target) =>
      (await taskIndexRepo.getProjectRepository()).reserveCreatedTask({
        task: { ...target, taskId: target.sessionId },
        projectId: target.projectId,
        additionalDirectories: target.additionalDirectories,
      }).additionalDirectories,
    resolveSessionDirectories: async (target) =>
      (await projectService.resolveSessionDirectories({ ...target, taskId: target.sessionId }))
        .additionalDirectories,
    ...(agentAccountProviderConfigSource
      ? { accountProviderConfigSource: agentAccountProviderConfigSource }
      : {}),
    accountRequestAuthService,
    ...(modelSelectionReadinessSource ? { modelSelectionReadinessSource } : {}),
    authorizeLocalMediaPreviewPath: options?.authorizeLocalMediaPreviewPath,
    ...offPeakToolWiring,
    resolveDynamicWorkflowClientConfig: () =>
      codingPlanSubscriptionService.getDynamicWorkflowClientConfig(),
    ...(resolveDynamicWorkflowUserMode ? { resolveDynamicWorkflowUserMode } : {}),
    forwardDynamicWorkflowUserMode: options?.forwardDynamicWorkflowUserMode,
    commandResolver: options?.cfAgentCommandResolver,
    presentationSurface: resolveCfAgentPresentationSurface({
      runtimeSurface: options?.agentTelemetry?.runtimeSurface,
      serviceAuthorityMode: options?.serviceAuthorityMode,
      desktopContextPromptEnabled,
    }),
    onAutomationManualRunRequested: options?.onAutomationManualRunRequested,
    processLifecycleReporter: options?.processLifecycleReporter,
    spawnFallbackCwd: options?.cfAgentSpawnFallbackCwd,
    browserControlExecutor: options?.browserControlExecutor,
    channelReplyExecutor: async (value) => {
      const request = channelReplyHostRequestSchema.parse(value);
      if (
        options?.topicResourceRelayChannel &&
        (isDesktopAttachedRemote || request.remoteSessionId)
      )
        return channelReplyResultSchema.parse(
          await options.topicResourceRelayChannel(request).call("reply", request),
        );
      if (isDesktopAttachedRemote) throw new Error("Desktop channel reply peer unavailable");
      const bots = services.getOptional(IBotsService);
      if (!bots?.replyToChannel) throw new Error("Bot channel reply unavailable");
      return bots.replyToChannel(request);
    },
    topicResourceExecutor: async (request, signal) => {
      if (
        options?.topicResourceRelayChannel &&
        (isDesktopAttachedRemote || request.remoteSessionId)
      )
        return readTopicResourceFromRelay(
          options.topicResourceRelayChannel(request),
          request,
          signal,
        );
      if (isDesktopAttachedRemote) throw new Error("Desktop topic resource peer unavailable");
      const bots = services.getOptional(IBotsService);
      if (!bots?.readTopicResource) throw new Error("Topic resource service is unavailable");
      return bots.readTopicResource({ ...request, signal });
    },
    topicResourceValidator: async (request, signal) => {
      if (
        options?.topicResourceRelayChannel &&
        (isDesktopAttachedRemote || request.remoteSessionId)
      )
        return validateTopicResourceFromRelay(
          options.topicResourceRelayChannel(request),
          request,
          signal,
        );
      if (isDesktopAttachedRemote) throw new Error("Desktop topic resource peer unavailable");
      const bots = services.getOptional(IBotsService);
      if (!bots?.validateTopicResource)
        throw new Error("Topic resource authorization is unavailable");
      return bots.validateTopicResource({ ...request, signal });
    },
    officialMcpAuthHeadersResolver: createOfficialMcpAuthHeadersResolver({
      accountRequestAuthService,
      credentialService,
      modelSelectionService: providerRuntime.modelSelection,
    }),
    officialMcpTrustedOrigins: createOfficialMcpTrustedOriginRegistry({
      devTrustedOriginsRaw: process.env[OFFICIAL_MCP_DEV_TRUSTED_ORIGINS_ENV],
      resolveCfApiOrigin: resolveCurrentCfEndpointOrigin,
    }),
    cuaOperationStateReporter: shouldEnableCuaOperationStateReporter({
      serviceAuthorityMode: options?.serviceAuthorityMode,
      hasReporter: Boolean(options?.cuaOperationStateReporter),
    })
      ? options?.cuaOperationStateReporter
      : undefined,
    ...(options?.serviceAuthorityMode === "desktop-local"
      ? {
          onCuaPipSessionLifecycle: (_workspace, event) => {
            void cuaPipSessionService.publishLifecycle(event);
          },
        }
      : {}),
    resolveSpawnEnv: async (context) => {
      const [settings] = await Promise.all([settingService.get(), providerRuntime.start()]);
      if (!isDesktopAttachedRemote) await subagentsService.prepareRuntimeState(context);
      const agentNetwork =
        isDesktopAttachedRemote && options?.remoteAgentNetwork
          ? options.remoteAgentNetwork
          : {
              httpProxy: settings.httpProxy,
              noProxy: settings.httpProxyNoProxy,
            };
      const cuaPluginEnabled = isCuaEnabledForContext(context);
      let cuaProductHelperEnv: Record<string, string> = {};
      if (cuaPluginEnabled && (process.platform === "darwin" || process.platform === "win32")) {
        const brokerSocket =
          process.platform === "win32" ? getStableCuaPipeName() : resolveBrokerSocketPath();
        cuaProductHelperEnv = {
          [BROKER_SOCKET_ENV]: brokerSocket,
          [CF_CUA_PLUGIN_AUTHORITY_ENV_KEY]: randomBytes(16).toString("hex"),
        };
        if (process.platform === "win32") {
          const recipe = await resolveStableCuaWinRecipe();
          if (recipe) {
            cuaProductHelperEnv["CF_CUA_WIN_HELPER_RECIPE"] = JSON.stringify({
              ...recipe,
              hostPid: process.pid,
            });
          } else {
            cuaProductHelperEnv = {
              [BROKER_UNAVAILABLE_ENV]:
                "broker_unavailable: windows helper recipe could not be resolved",
            };
          }
        }
      }
      const telemetryEnv = getCapturedCfAgentTelemetryEnv();
      const telemetryConfigured = Boolean(
        telemetryEnv.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || telemetryEnv.OTEL_EXPORTER_OTLP_ENDPOINT,
      );
      const telemetryProfile = telemetryConfigured
        ? await oauthCredentialRepo.loadActiveUserProfile().catch(() => null)
        : null;
      const telemetryDeviceMid = telemetryConfigured
        ? options?.agentTelemetry?.getDeviceMid?.()?.trim()
        : undefined;
      await providerConfigRuntime.start();
      return {
        ...buildAgentRuntimeEnv({
          httpProxy: agentNetwork.httpProxy,
          noProxy: agentNetwork.noProxy,
          caCertPath: settings.httpProxyCaCertPath,
        }),
        ...buildAgentEndpointOriginEnv(await resolveCurrentCfEndpointOrigin()),
        ...cuaProductHelperEnv,
        ...buildAgentTelemetrySpawnEnv({
          deviceMid: telemetryDeviceMid,
          runtimeSurface: options?.agentTelemetry?.runtimeSurface ?? "remote_workspace_host",
          telemetryEnv,
          userId: telemetryProfile?.id,
        }),
        ...createNodeProviderRuntimePathEnv({
          cfBuiltinFilePath: await providerConfigRuntime.resolveCfBuiltinActiveFilePath(),
          personalFilePath: join(resolveAppConfigDir(), PERSONAL_PROVIDER_CONFIG_FILE_NAME),
        }),
      };
    },
    ...(!isDesktopAttachedRemote
      ? { readSubagentRuntimeConfig: subagentsService.readRuntimeConfig }
      : {}),
    ...(isDesktopAttachedRemote
      ? { sessionRuntimePreferencesAuthority: "external" as const }
      : {
          sessionRuntimePreferencesAuthority: "local" as const,
          resolveSessionRuntimePreferences: async (scope) => {
            const settings = await settingService.get();
            const modelContextBudgetStrategy = DEFAULT_CF_MODEL_CONTEXT_BUDGET_STRATEGY;
            return {
              askUserQuestionAutoResolutionEnabled:
                settings.askUserQuestionAutoResolutionEnabled !== false,
              nativeSearchEnhancementsEnabled: settings.nativeSearchEnhancementsEnabled !== false,
              toolSearchMode: settings.toolSearchMode ?? "off",
              memoryEnabled: settings.memoryEnabled === true,
              modelContextBudgetStrategy,
              ...(scope === "user-execution" && settings.integratedTerminalShell
                ? { integratedTerminalShell: settings.integratedTerminalShell }
                : {}),
            };
          },
        }),
  });
  providerConnectivityAgentService = cfAgentService;
  hasActiveTurnRef = () => cfAgentService.hasActiveCuaOperationTurn();
  const cfTaskIndexSyncer = createCfTaskIndexSyncer({
    agentService: cfAgentService,
    taskIndexRepo,
  });
  const taskAutoArchiveScheduler = createTaskAutoArchiveScheduler({
    readPolicy: async () => {
      const settings = await settingService.get();
      if (!settings.taskAutoArchiveEnabled) return null;
      const days = Math.max(1, Math.floor(settings.taskAutoArchiveOlderThanDays ?? 30));
      return {
        cutoff: Date.now() - days * 86_400_000,
        activeTasks: cfTaskIndexSyncer.activeTaskRefs(),
      };
    },
    repository: () => taskIndexRepo.getProjectRepository(),
    afterChange: publishProjectChange,
  });
  // The plugin can be toggled at runtime. Do not let a previously created resolver continue
  // health-checking/restarting Helper after disable, and create it lazily after enable.
  const defaultCuaProductMcpServerResolver = createDynamicCuaProductMcpServerResolver({
    isPluginEnabled: (context) => isCuaEnabledForContext(context),
    getResolver: async () => {
      const helper = defaultCuaProductHelperLifecycle.peek()?.helper;
      return helper && isDefaultCuaProductHelperCurrent(helper) ? helper.resolver : undefined;
    },
    isResolverCurrent: (resolver) =>
      defaultCuaProductHelperLifecycle.peek()?.helper.resolver === resolver,
  });
  const cuaProductMcpServerResolver =
    options?.cuaProductMcpServerResolver ?? defaultCuaProductMcpServerResolver;
  const cfSessionService = createCfSessionService({
    agentService: cfAgentService,
    taskIndexSyncer: cfTaskIndexSyncer,
    cuaProductMcpServerResolver,
  });
  const gitCommitMessageGenerator = new GitCommitMessageGenerator({
    currentModelProvider: {
      async readCurrentModel() {
        return (await providerRuntime.modelSelection.getView()).preferredSelection ?? null;
      },
    },
    textGenerator: {
      async generateText(params) {
        return await cfAgentService.generateWorkspaceText({
          workspacePath: params.workspacePath,
          ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
          selection: params.selection,
          prompt: params.prompt,
          querySource: params.querySource,
        });
      },
    },
    logger: createServiceLogger("git-commit-message"),
  });
  const gitService = createGitService({
    commitMessageGenerator: gitCommitMessageGenerator,
  });
  const cfTaskService = createCfTaskServiceAdapter({
    cfAgentService,
    taskIndexRepo,
    taskIndexSyncer: cfTaskIndexSyncer,
    settingService,
    cuaProductMcpServerResolver,
  });
  const botsRepo = new BotsRepo();
  const botLog = createServiceLogger("bots");
  const botRemoteWorkspaceService = options.resolveBotProjectConnection
    ? createBotProjectRuntime({
        remoteProjectService,
        resolveOnline: options.resolveBotProjectConnection,
        onConnectionsChanged: (listener) =>
          broadcastService.onMessage((event) => {
            if (event.channel === "state:projects") listener();
          }),
        readBoundTargets: async () =>
          Object.values((await botsRepo.readState()).bots).flatMap((context) =>
            context.workspaceIdentity
              ? [
                  {
                    workspacePath: context.workspacePath,
                    workspaceIdentity: context.workspaceIdentity,
                    hostId: context.hostId,
                  },
                ]
              : [],
          ),
        readRuntimePreferences: async () => {
          const settings = await settingService.get();
          return {
            askUserQuestionAutoResolutionEnabled:
              settings.askUserQuestionAutoResolutionEnabled !== false,
            modelIoFullRetentionEnabled: settings.modelIoFullRetentionEnabled === true,
          };
        },
        warn: (message) => botLog.warn(message),
      })
    : undefined;
  const oauthService = createOAuthService(credentialService, {
    apiClient,
    onProviderLogout: handleOAuthProviderLogout,
  });
  const cfJwtLogoutLogger = createServiceLogger("cf-jwt-logout");
  cfJwtLogoutHandlerRef.current = (input, headers) => {
    void oauthService
      .logoutIfCurrentCredentialRequest(input, headers)
      .then((invalidated) => {
        if (invalidated) {
          void broadcastService.send({
            channel: CF_JWT_INVALID_BROADCAST_CHANNEL,
            payload: {},
          });
        }
      })
      .catch((error) => {
        cfJwtLogoutLogger.warn("CodeFusion JWT logout failed", { error });
      });
  };
  const offPeakCredentialResolverDeps = {
    credentialService,
    accountRequestAuthService,
    resolveAccountProvider: async () => {
      await providerRuntime.start();
      const snapshot = providerRuntime.registryService.getSnapshot()!;
      const providers = snapshot.resolution.registryProviders.filter(
        (candidate) =>
          candidate.config.access.type === "zhipu-account" &&
          (candidate.config.access.mode === "individual-coding-plan" ||
            candidate.config.access.mode === "team-coding-plan"),
      );
      if (providers.length !== 1) return null;
      const provider = providers[0]!;
      const config = provider.config;
      const staticAccess = cfProviderAccountAccessSchema.parse(config.access.toJSON());
      const access = await accountRequestAuthService.resolveAccessCurrent(staticAccess);
      if (!access) return null;
      return {
        providerId: provider.providerId,
        access: cfAccountAccessSchema.parse(access),
        ...(config.api?.baseUrl ? { baseURL: config.api.baseUrl } : {}),
      };
    },
  };
  const buildOffPeakRequestAuthForTicket: OffPeakRequestAuthBuilder = async (ticketId) =>
    buildOffPeakRequestAuth({
      credentials: await resolveOffPeakCredentials(offPeakCredentialResolverDeps),
      ticketId,
    });
  const fileService = createFileService({
    workspaceFileSearchFilter: options?.workspaceFileSearchFilter,
  });
  const mediaPreviewService = createMediaPreviewService({
    fileService,
    authorizeLocalMediaPreviewPath: options?.authorizeLocalMediaPreviewPath,
    createLocalMediaPreviewUrl: buildLocalMediaPreviewUrl,
  });
  const conversationShareClient = new ConversationShareHttpClient({
    apiClient,
    baseUrl: buildRuntimeCfApiUrl(process.env, "/api/v1"),
    tokenProvider: async (): Promise<string | null> => {
      const activeProvider = await oauthCredentialRepo.getActiveProvider();
      if (!activeProvider) {
        return null;
      }
      const tokenSet = await oauthCredentialRepo.loadTokenSet(activeProvider);
      return tokenSet?.cfJwtToken ?? tokenSet?.accessToken ?? null;
    },
  });
  const conversationShareService: IConversationShareServiceType = isDesktopAttachedRemote
    ? createUnsupportedConversationShareService({
        message: "Conversation publishing is not available for remote workspaces",
      })
    : new ConversationShareService({
        cfAgentService,
        cfSessionService,
        client: conversationShareClient,
        artifactSource: createLocalConversationShareArtifactSource(),
      });
  const sqliteReposToClose: Array<{ close(): void }> = [];
  const marketingAssets = createMarketingAssetRegistry({
    allowLoopback: CF_ENV === "test" || process.env.NODE_ENV === "development",
  });
  const services = new ServiceCollection()
    .register(
      IMarketingTouchService,
      createMarketingTouchService({
        apiClient,
        getToken: () => credentialService.load("cfjwttoken"),
        getDeviceMid: () => options?.agentTelemetry?.getDeviceMid?.(),
        baseUrl: buildRuntimeCfApiUrl(process.env, "/"),
        appVersion: CF_VERSION,
        onSnapshot: (snapshot) => marketingAssets.accept(snapshot),
      }),
    )
    .register(IFileService, fileService)
    .register(IMediaPreviewService, mediaPreviewService)
    .register(
      ICloudContentService,
      createCloudContentService({
        publishedAssets: marketingAssets,
        cacheRoot: join(getContentAppConfigDir(), "cache", "content-bundles", randomUUID()),
      }),
    )
    .register(IGitService, gitService)
    .register(IGitCheckpointService, gitCheckpointService)
    .register(ISystemService, systemService)
    .register(ITerminalService, createTerminalService({ settingService }))
    .register(ISettingService, settingService)
    .register(IOnboardingRecordService, onboardingRecordService)
    .register(ICredentialService, credentialService)
    .register(IBroadcastService, broadcastService)
    .register(ICfTaskService, cfTaskService)
    .register(ICfAgentService, cfAgentService)
    .register(ICfSessionService, cfSessionService)
    .register(IProjectService, projectService)
    .register(ITaskGroupService, taskGroupService)
    .register(IRemoteProjectService, remoteProjectService)
    .register(ICuaPermissionService, cuaPermissionService)
    .register(ICuaPipSessionService, cuaPipSessionService)
    .register(IConversationShareService, conversationShareService)
    .register(
      IBotsService,
      createBotsService({
        repo: botsRepo,
        projectService,
        remoteProjectService,
        ownerHostId: options?.projectStorageHostId ?? "local",
        credentialService,
        cfTaskService,
        broadcastService,
        settingService,
        modelSelectionService: providerRuntime.modelSelection,
        remoteWorkspaceService: botRemoteWorkspaceService
          ? { ...botRemoteWorkspaceService, resolveWorkspace: options?.resolveBotRemoteWorkspace }
          : undefined,
        runStartupBackgroundTasks: !isDesktopAttachedRemote,
      }),
    )
    .register(IFileWatcherService, createFileWatcherService())
    .register(IOAuthService, oauthService)
    .register(ISourceServerWorkspaceService, sourceServerWorkspaceService)
    .register(
      IUsageStatsService,
      createUsageStatsService({
        apiClient,
        accountRequestAuthService,
        credentialService,
        cfAgentService,
        officialMcpCredentialSource,
      }),
    )
    .register(ICodingPlanSubscriptionService, codingPlanSubscriptionService)
    .register(
      IClientConfigService,
      createClientConfigService({
        apiClient,
        resolveRequestContext: async () => ({
          endpointOrigin: await resolveCurrentCfEndpointOrigin(),
          appVersion: CF_VERSION,
          platform: `${process.platform}-${process.arch}`,
        }),
      }),
    )
    .register(IClientScenesService, createClientScenesService({ apiClient }))
    .register(
      IOffPeakTaskService,
      (() => {
        const offPeakLogger = createServiceLogger("off-peak");
        const resolveCredentials = () => resolveOffPeakCredentials(offPeakCredentialResolverDeps);
        const originResolver = createOffPeakOriginResolver({
          logger: offPeakLogger,
          resolveUpstream: () => resolveOffPeakMockUpstream(offPeakCredentialResolverDeps),
        });
        const offPeakTaskRepo = new OffPeakTaskRepo();
        sqliteReposToClose.push(offPeakTaskRepo);
        const offPeakTaskService = new OffPeakTaskService({
          prepareProjectExecution,
          repo: offPeakTaskRepo,
          client: createOffPeakServerClient({
            resolveOrigin: originResolver.resolveOrigin,
            resolveCredentials,
            logger: offPeakLogger,
          }),
          resolveCodingPlanSupport: () =>
            resolveOffPeakCodingPlanSupport(offPeakCredentialResolverDeps),
          resolveTelemetryProviderName: async () =>
            resolveSafeTelemetryHostname(await originResolver.resolveOrigin()),
          resolveModelSelection: async (input) => {
            await providerRuntime.start();
            const support = await resolveOffPeakCodingPlanSupport(offPeakCredentialResolverDeps);
            const providerId = support.supported
              ? OFF_PEAK_PROVIDER_IDS[support.providerFamily]
              : undefined;
            const provider = providerId
              ? providerRuntime.registryService
                  .getView()
                  .providers.find((candidate) => candidate.providerId === providerId)
              : undefined;
            const modelId = input.modelId ?? provider?.models[0]?.modelId;
            if (!provider || !modelId) {
              return {
                ok: false as const,
                validation: {
                  ok: false as const,
                  code: "provider-not-found" as const,
                  providerId: OFF_PEAK_PROVIDER_IDS.zai,
                },
              };
            }
            const selection = {
              providerId: provider.providerId,
              modelId,
              ...(input.reasoningLevel
                ? { options: { reasoningLevel: input.reasoningLevel } }
                : {}),
            };
            const validation = providerRuntime.registryService.validateSelection(selection);
            return validation.ok
              ? { ok: true as const, selection }
              : { ok: false as const, validation };
          },
          logger: offPeakLogger,
          requestSchedulerWake: options?.onOffPeakSchedulerWakeRequested,
          stopRunningTask: async (params) => {
            await cfTaskService.stopGeneration({
              taskId: params.conversationId,
              workspacePath: params.workspacePath,
              ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
            });
          },
          onDispose: () => {
            void originResolver.close().catch(() => undefined);
          },
        });
        offPeakTaskService.startSync();
        offPeakTaskServiceForAgent = offPeakTaskService;
        return offPeakTaskService;
      })(),
    )
    .register(
      IHighspeedCardService,
      (() => {
        const origin = resolveRuntimeCfEndpointOrigin(process.env);
        const rawMockScenario = process.env.CF_HIGHSPEED_MOCK_SCENARIO;
        const mockScenarios = new Set<HighspeedMockScenario>([
          "hit-fast",
          "miss",
          "hit-after-timeout",
          "hit-invalid-model",
          "hit-queue-edit",
          "existing-foreign-task-card",
          "expired-card",
        ]);
        const mockScenario = mockScenarios.has(rawMockScenario as HighspeedMockScenario)
          ? (rawMockScenario as HighspeedMockScenario)
          : null;
        const resolveHighspeedLoginHeaders = async (): Promise<Record<string, string>> => {
          const jwt = (await credentialService.load("cfjwttoken"))?.trim() ?? "";
          if (!jwt) throw new Error("highspeed request requires cf jwt");
          return { Authorization: /^Bearer\s/i.test(jwt) ? jwt : `Bearer ${jwt}` };
        };
        const transport = mockScenario
          ? createHighspeedMockTransport({ scenario: mockScenario })
          : createHighspeedHttpTransport({
              drawUrl: `${origin}/api/v1/highspeed/draw`,
              healthyBaseUrl: `${origin}/api/v1/highspeed/`,
              logger: createServiceLogger("highspeed"),
              drawHeaders: async () => {
                const credentials = await resolveOffPeakCredentials(offPeakCredentialResolverDeps, {
                  allowMockCredentials: false,
                });
                const codingPlanAuthorization =
                  (
                    await credentialService.load(`oauth:${credentials.providerFamily}:access_token`)
                  )?.trim() ?? "";
                return buildHighspeedCodingPlanAuthHeaders({
                  cfJwt: credentials.jwt,
                  codingPlanAuthorization,
                  targetType:
                    credentials.organizationId && credentials.projectId ? "TEAM" : "PERSONAL",
                  ...(credentials.organizationId
                    ? { organizationId: credentials.organizationId }
                    : {}),
                  ...(credentials.projectId ? { projectId: credentials.projectId } : {}),
                });
              },
              healthyHeaders: resolveHighspeedLoginHeaders,
            });
        return new HighspeedCardService({
          transport,
          inferenceMode:
            mockScenario &&
            mockScenario !== "hit-invalid-model" &&
            mockScenario !== "hit-queue-edit"
              ? "session-default"
              : "highspeed",
          resolveCodingPlanSupported: mockScenario
            ? async () => true
            : async () =>
                (await resolveOffPeakCodingPlanSupport(offPeakCredentialResolverDeps)).supported,
          resolveModelCovered: mockScenario
            ? async () => true
            : async (providerId, modelId) => {
                const view = await providerRuntime.modelSelection.getView();
                const provider = view.providers.find((item) => item.providerId === providerId);
                return provider?.models.some((model) => model.modelId === modelId) ?? false;
              },
          resolveInferenceAuth: async () => {
            const credentials = await resolveOffPeakCredentials(offPeakCredentialResolverDeps, {
              allowMockCredentials: false,
            });
            const codingPlanAuthorization =
              (
                await credentialService.load(`oauth:${credentials.providerFamily}:access_token`)
              )?.trim() ?? "";
            return {
              cfJwt: credentials.jwt,
              family: credentials.providerFamily,
              codingPlanAuthorization,
              targetType: credentials.organizationId && credentials.projectId ? "TEAM" : "PERSONAL",
              ...(credentials.organizationId ? { organizationId: credentials.organizationId } : {}),
              ...(credentials.projectId ? { projectId: credentials.projectId } : {}),
            };
          },
        });
      })(),
    )
    .register(ISkillsService, skillsService)
    .register(ISkillSyncService, createSkillSyncService())
    .register(IMcpSyncService, mcpSyncService)
    .register(
      IGenUiService,
      createGenUiService({ registerSandbox: options?.registerPluginSandbox }),
    )
    .register(IPluginUiBridgeService, pluginUiBridgeService)
    .register(IPluginUiSamplingService, pluginUiSamplingService)
    .register(IPluginUiAppToolsService, pluginUiAppToolsService)
    .register(IPluginSyncService, pluginSyncService)
    .register(IPluginsService, createPluginsService({ isDesktopRuntime: true }))
    .register(
      IPluginManagementService,
      createPluginManagementService({
        cfAgentService,
        reportTelemetryEvent: options?.reportPluginTelemetryEvent,
      }),
    )
    .register(
      IRepoWikiService,
      createRepoWikiService({
        textGenerator: {
          generateText: async (params) => {
            const result = await cfAgentService.generateWorkspaceText(params);
            return { text: result.text };
          },
        },
        readModelView: async () =>
          (await providerRuntime.modelSelection.getView()) as unknown as RepoWikiModelViewLike,
        logger: createServiceLogger("repo-wiki"),
      }),
    );

  return services;
}

export function createTelemetryAuthorizationLoader(
  credentialService: Pick<ICredentialService, "load">,
): (userId: string) => Promise<string | null> {
  return async (userId) => {
    if (!userId) return null;
    try {
      const provider = (await credentialService.load("oauth:active_provider"))?.trim();
      if (provider !== "zai" && provider !== "bigmodel") return null;
      const readUserId = async () =>
        readTelemetryOAuthUserId(await credentialService.load(`oauth:${provider}:user_info`));
      if ((await readUserId()) !== userId) return null;
      const jwt = (await credentialService.load("cfjwttoken"))?.trim();
      if (
        (await credentialService.load("oauth:active_provider"))?.trim() !== provider ||
        (await readUserId()) !== userId
      )
        return null;
      return jwt && /^[\x21-\x7e]+$/.test(jwt) ? `Bearer ${jwt}` : null;
    } catch {
      return null;
    }
  };
}

export function createTelemetryMarketingParamsLoader(
  credentialService: ICredentialService,
): () => Promise<import("@origin-ai/cf-shared").OAuthLoginAttribution | null> {
  const repo = new OAuthCredentialRepo(credentialService);
  return () => repo.loadLoginAttribution();
}

function readTelemetryOAuthUserId(rawUserInfo: string | null): string {
  if (!rawUserInfo) {
    return "";
  }

  try {
    const parsed = JSON.parse(rawUserInfo) as {
      id?: unknown;
      user_id?: unknown;
    };
    const id = typeof parsed.id === "string" ? parsed.id : "";
    const userId = typeof parsed.user_id === "string" ? parsed.user_id : "";
    return id.trim() || userId.trim();
  } catch {
    return "";
  }
}

/**
 * Best-effort telemetry user id lookup. Telemetry must never fail a host startup, and a
 * credential that cannot be decrypted must not be deleted or retried destructively.
 */
export function createTelemetryUserIdLoader(
  credentialService: Pick<ICredentialService, "load">,
): () => Promise<string> {
  return async () => {
    try {
      const provider = (await credentialService.load("oauth:active_provider"))?.trim();
      if (provider !== "zai" && provider !== "bigmodel") return "";
      return readTelemetryOAuthUserId(await credentialService.load(`oauth:${provider}:user_info`));
    } catch (error) {
      if (isCredentialDecryptError(error)) {
        console.warn(
          formatLogPrefix("telemetry", process.pid),
          "telemetry user id unavailable: encrypted credential could not be read",
        );
      }
      return "";
    }
  };
}

export function disposeServiceResources(services: ServiceCollection): void {
  const content = services.getOptional(ICloudContentService);
  if (content && hasDisposeAllAndWait(content)) void content.disposeAllAndWait().catch(() => {});
  (
    services.getOptional(IGenUiService) as (IGenUiService & { dispose?(): void }) | undefined
  )?.dispose?.();
  const disposableServices = [
    services.getOptional(ITerminalService),
    services.getOptional(ICfTaskService),
    services.getOptional(ICfAgentService),
    services.getOptional(ICfSessionService),
    services.getOptional(IBotsService),
    services.getOptional(IFileWatcherService),
    services.getOptional(ISubagentsService),
    services.getOptional(IOffPeakTaskService),
  ].filter((service) => service !== undefined);

  for (const service of disposableServices) {
    if (hasDisposeAll(service)) {
      service.disposeAll();
    }
  }

  const managedCuaHelperHost = managedCuaHelperHosts.get(services);
  if (managedCuaHelperHost) {
    void managedCuaHelperHost.stop().catch(() => {});
  }
  for (const repo of sharedSqliteRepos.get(services) ?? []) repo.close();
  sharedSqliteRepos.delete(services);
  providerRuntimes.get(services)?.dispose();
  for (const dispose of providerProvisioningTriggerDisposers.get(services) ?? []) dispose();
  providerProvisioningTriggerDisposers.delete(services);
  providerProvisioningSources.delete(services);
  taskAutoArchiveDisposers.get(services)?.();
  taskAutoArchiveDisposers.delete(services);
  managedHostApiNetworkTransports.get(services)?.dispose();
}

export async function disposeServiceResourcesAndWait(services: ServiceCollection): Promise<void> {
  (
    services.getOptional(IGenUiService) as (IGenUiService & { dispose?(): void }) | undefined
  )?.dispose?.();
  const disposableServices = [
    services.getOptional(ICloudContentService),
    services.getOptional(ITerminalService),
    services.getOptional(ICfTaskService),
    services.getOptional(ICfAgentService),
    services.getOptional(ICfSessionService),
    services.getOptional(IBotsService),
    services.getOptional(IFileWatcherService),
    services.getOptional(ISubagentsService),
    services.getOptional(IOffPeakTaskService),
  ].filter((service) => service !== undefined);

  for (const service of disposableServices) {
    if (hasDisposeAllAndWait(service)) {
      await service.disposeAllAndWait();
    } else if (hasDisposeAll(service)) {
      service.disposeAll();
    }
  }

  const managedCuaHelperHost = managedCuaHelperHosts.get(services);
  if (managedCuaHelperHost) {
    await managedCuaHelperHost.stop().catch(() => {});
  }
  for (const repo of sharedSqliteRepos.get(services) ?? []) repo.close();
  sharedSqliteRepos.delete(services);
  providerRuntimes.get(services)?.dispose();
  for (const dispose of providerProvisioningTriggerDisposers.get(services) ?? []) dispose();
  providerProvisioningTriggerDisposers.delete(services);
  providerProvisioningSources.delete(services);
  taskAutoArchiveDisposers.get(services)?.();
  taskAutoArchiveDisposers.delete(services);
  await managedHostApiNetworkTransports
    .get(services)
    ?.disposeAndWait()
    .catch(() => {});
}

export async function migrateApplicationStorage(
  settings?: Pick<AppSettings, "lastWorkspaceSession" | "recentProjects">,
  hostId?: string,
): Promise<{ backupSkipped: boolean }> {
  const automations = new AutomationRepo();
  const offPeak = new OffPeakTaskRepo();
  const tasks = new TaskIndexRepo(settings, hostId);
  try {
    await automations.ensureReady();
    await offPeak.ensureReady();
    await tasks.ensureReady();
    return {
      backupSkipped:
        tasks.migrationBackupSkipped ||
        automations.migrationBackupSkipped ||
        offPeak.migrationBackupSkipped,
    };
  } finally {
    tasks.close();
    offPeak.close();
    automations.close();
  }
}

export { bindRemoteProjectIdentities } from "#src/project/index.js";

export { startupStorage } from "#src/startup-storage/index.js";

export async function createServerHostServices(options: {
  topicResourceRelayChannel?: NonNullable<
    Parameters<typeof createLocalServices>[0]
  >["topicResourceRelayChannel"];
  sourceServerId: string;
  cfBuiltinProviderConfigFilePath: string;
  providerProvisioningTargetEnabled?: boolean;
}) {
  const projectStorageHostId = remoteHostIdFromWorkspaceIdentity(
    buildServerRemoteWorkspaceIdentity({ serverId: options.sourceServerId, workspacePath: "/" }),
  );
  if (!projectStorageHostId) throw new Error("Invalid Source Server storage identity");
  await migrateApplicationStorage(await createSettingService().get(), projectStorageHostId);
  const workspaceAliasRepo = new SourceServerWorkspaceAliasRepo();
  const workspaceIdentityMapper = new SourceServerWorkspaceIdentityMapper();
  const sourceServerWorkspaceService = createSourceServerWorkspaceService(workspaceAliasRepo, {
    defaultWorkspaceIdentity: (workspacePath) =>
      buildServerRemoteWorkspaceIdentity({ serverId: options.sourceServerId, workspacePath }),
    onResolved: ({ workspacePath, canonicalWorkspaceKey }) => {
      workspaceIdentityMapper.register({
        stableIdentity: buildServerRemoteWorkspaceIdentity({
          serverId: options.sourceServerId,
          workspacePath,
        }),
        canonicalIdentity: canonicalWorkspaceKey,
      });
    },
  });
  const migrationFailedPathCount = await workspaceAliasRepo.getFailedPathCount();
  const services = createLocalServices({
    cfBuiltinProviderConfigFilePath: options.cfBuiltinProviderConfigFilePath,
    providerProvisioningTargetEnabled: options.providerProvisioningTargetEnabled,
    serviceAuthorityMode: "standalone-server",
    topicResourceRelayChannel: options.topicResourceRelayChannel,
    projectStorageHostId,
    sourceServerWorkspaceService,
  });
  return { services, workspaceIdentityMapper, migrationFailedPathCount };
}

export { scopeConversationShareServiceForAttachment } from "./conversation-share/conversationShareConnectionScope.js";
export { localRuntimeNetworkCapture } from "./cf-agent/localRuntimeNetworkCapture.js";
