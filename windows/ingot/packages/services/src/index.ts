// Descriptors & collection (browser-safe)
export { type ServiceDescriptor, createServiceDescriptor } from "./descriptors.js";
export { ServiceCollection, type ServiceExposurePolicy } from "./collection.js";
export {
  IModelSelectionService,
  IProviderSettingsService,
  type ModelSelectionView,
  type ModelSelectionViewInput,
  type ProviderSettingsProviderView,
  type ProviderSettingsView,
} from "./model-provider/providerFacadeServices.js";
export {
  createAccountRequestAuthService,
  type IAccountRequestAuthService,
  type AccountRequestAuthInput,
  type AccountRequestAuthMaterial,
  type AccountRequestAuthResolver,
} from "./model-provider/accountRequestAuthService.js";
export { IProviderProvisioningTargetService } from "./model-provider/providerProvisioning.js";
export {
  collectServiceMemoryDiagnostics,
  memoryDiagnosticsRegistry,
  registerMemoryDiagnosticsProvider,
} from "./memoryDiagnostics.js";

// Accessor
export type { IServiceAccessor } from "./accessor.js";
export {
  ConversationShareServiceError,
  createUnsupportedConversationShareService,
  IConversationShareService,
} from "./conversation-share/conversationShare.js";
export type {
  ConversationShareSelection,
  ConversationSharePublishProgress,
  ConversationShareImportProgress,
  ImportConversationShareInput,
  ImportConversationShareResult,
  ImportedConversationShare,
  ConversationShareServiceErrorKind,
  ConversationShareFailureIssue,
  ConversationShareFailureIssueCode,
  ConversationSharePreflightInput,
  ConversationSharePreflightResult,
  ConversationShareAllowedArtifact,
  ConversationShareTurnPreflightResult,
  PublishTextConversationInput,
} from "./conversation-share/conversationShare.js";
export {
  createConversationTelemetryService,
  type ConversationTelemetryWorkspaceTarget,
  type IConversationTelemetryService,
} from "./conversation-telemetry/conversationTelemetry.js";

// File service — IFileService is both a type (interface) and value (descriptor)
export { IFileService } from "./file/file.js";
export { IMediaPreviewService } from "./media-preview/mediaPreview.js";
export { ICloudContentService } from "#src/cloud-content/cloudContent.js";
export { IMarketingTouchService } from "#src/marketing-touch/marketingTouch.js";
export type { MediaPreviewPreparation } from "./media-preview/mediaPreview.js";

// Git service — IGitService is both a type (interface) and value (descriptor)
export { IGitService } from "./git/git.js";
export { IGitCheckpointService } from "./git/gitCheckpoint.js";

// System service — ISystemService is both a type (interface) and value (descriptor)
export { ISystemService } from "./system/system.js";

// Terminal service — ITerminalService is both a type (interface) and value (descriptor)
export { ITerminalService } from "./terminal/terminal.js";

// Setting service — ISettingService is both a type (interface) and value (descriptor)
export { ISettingService } from "./setting/setting.js";

// Credential service — ICredentialService is both a type (interface) and value (descriptor)
export { ICredentialService } from "./credential/credential.js";
export { ISourceServerWorkspaceService } from "./source-server-workspace/sourceServerWorkspace.js";
export {
  ISourceServerManagementService,
  type UpdateConnectionProfileInput,
} from "./source-server-management/sourceServerManagement.js";

// Broadcast service — IBroadcastService is both a type (interface) and value (descriptor)
export { IBroadcastService } from "./broadcast/broadcast.js";

export { IOnboardingRecordService } from "./onboarding/onboardingRecord.js";
export type {
  CreateOnboardingRecordServiceOptions,
  OnboardingRecordServiceFactory,
} from "./onboarding/onboardingRecord.js";
export type {
  BroadcastClaimAcquireResult,
  BroadcastClaimLease,
  BroadcastMessage,
} from "./broadcast/broadcast.js";

export { ICfTaskService } from "./session/cfTaskService.js";
export type {
  CfArchivedTaskDeletionResult,
  CfModelTrajectory,
  CfModelTrajectoryCallSource,
  CfModelTrajectoryCallSourceKind,
  CfModelTrajectoryContentPart,
  CfModelTrajectoryMessage,
  CfModelTrajectoryRecord,
  CfModelTrajectoryUsage,
  CfTaskListKind,
  CfTaskListQuery,
  CfTaskListResult,
  CfTaskListSortBy,
  CfTaskListWorkspaceScope,
  CfTaskReadyOutcome,
} from "./session/cfTaskService.js";
export type { CfTaskListItem } from "./session/cfTaskListTypes.js";

export { IWindowControllerService } from "./window-controller/windowController.js";
export {
  IWindowProjectService,
  IWindowRemoteProjectService,
  IWindowProjectChangesService,
  type WindowProjectDirectoryServices,
} from "#src/window-project-directory/contract.js";
export { createWindowProjectChangesService } from "#src/window-project-directory/index.js";
export type {
  WindowHostControllerFrame,
  WindowHostControllerMutation,
  WindowHostControllerTaskListItem,
  WindowHostControllerTaskListResult,
  WindowHostTaskUnreadSignal,
} from "./window-controller/windowController.js";

// CodeFusion agent service — ICfAgentService is both a type (interface) and value (descriptor)
export {
  ICfAgentService,
  type CfAgentLocalRuntimeChildProcesses,
  CF_AGENT_RUNTIME_UNAVAILABLE_CODE,
} from "./cf-agent/cfAgent.js";
export {
  isCfAgentMcpStatusModeUnsupportedError,
  CF_AGENT_MCP_STATUS_MODE_UNSUPPORTED_ERROR_CODE,
  CfAgentMcpStatusModeUnsupportedError,
} from "./cf-agent/cfAgentErrors.js";
export {
  createCfAgentConnectionScope,
  readTrustedCfAgentV4Connection,
} from "./cf-agent/cfAgentConnectionScope.js";
export type {
  CfAgentConnectionScope,
  CfAgentV4ClientMode,
  CfAgentV4ConnectionContext,
} from "./cf-agent/cfAgentConnectionScope.js";
export type {
  CfAgentAttachmentBeginParams,
  CfAgentAttachmentChunkParams,
  CfAgentAttachmentTerminalParams,
  CfAgentCreateSessionParams,
  CfAgentCuaPermissionObservation,
  CfAgentInitializeResult,
  CfAgentStorageStartupSnapshot,
  CfAgentRuntimeLifecycleEvent,
  CfAgentRuntimePolicy,
  CfAgentReadSessionParams,
  CfAgentRespondProviderRuntimeHeadersParams,
  CfAgentResumeSessionParams,
  CfAgentRunAutomationNowResult,
  CfAgentSavedWorkflowTarget,
  CfAgentSendPromptParams,
  CfAgentServiceEvent,
  CfAgentSessionSubscribeParams,
  CfAgentSessionTarget,
  CfAgentSetModeParams,
  CfAgentSetModelParams,
  CfAgentSetThoughtLevelParams,
  CfAgentWorkspaceTarget,
} from "./cf-agent/cfAgent.js";

// CodeFusion session service — app-facing session facade without CodeFusion Agent naming.
export { ICfSessionService } from "./cf-session/cfSession.js";
export type {
  CfSessionCreateParams,
  CfSessionEventsParams,
  CfSessionInitializeResult,
  CfSessionListParams,
  CfSessionMessagesParams,
  CfSessionReadParams,
  CfSessionResumeParams,
  CfSessionServiceEvent,
  CfSessionSetModeParams,
  CfSessionSetModelParams,
  CfSessionSetThoughtLevelParams,
  CfSessionSubscribeParams,
  CfTaskTarget,
  CfSessionWorkspaceTarget,
} from "./cf-session/cfSession.js";

// Bots service — IBotsService is both a type (interface) and value (descriptor).
export { IBotsService } from "./bots/bots.js";
export type {
  BotRemoteWorkspaceResolver,
  BotRemoteWorkspaceResolution,
  BotBindCodeResult,
  BotCreateBindCodeParams,
  BotListWorkspaceRefsParams,
  BotSaveBotParams,
  BotTestResult,
} from "./bots/bots.js";

// Hooks service — IHooksService is both a type (interface) and value (descriptor).
export { IHooksService } from "./hooks/hooks.js";

// Memory service — IMemoryService is both a type (interface) and value (descriptor).
export {
  IMemoryService,
  PROJECT_MEMORY_FILE_CHANGED_ERROR_CODE,
  PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED_ERROR_CODE,
} from "./memory/memory.js";
export type { ProjectMemoryFileSummary, ProjectMemoryWorkspaceSummary } from "./memory/memory.js";

// OutputStyle service — IOutputStyleService is both a type (interface) and value (descriptor).
export { IOutputStyleService } from "./output-style/outputStyle.js";
export type { SessionRealtimePort } from "./session/sessionRealtimePort.js";

// FileWatcher service — IFileWatcherService is both a type (interface) and value (descriptor)
export { IFileWatcherService } from "./fileWatcher/fileWatcher.js";

// OAuth service — IOAuthService is both a type (interface) and value (descriptor)
export { IOAuthService } from "./oauth/oauth.js";

// UsageStats service — IUsageStatsService is both a type (interface) and value (descriptor)
export { IUsageStatsService } from "./usage-stats/usageStats.js";

// RepoWiki service — IRepoWikiService is both a type (interface) and value (descriptor)
export { IRepoWikiService } from "./repo-wiki/repoWiki.js";
export { createRepoWikiService } from "./repo-wiki/repoWikiService.js";
export type {
  CreateRepoWikiServiceOptions,
  RepoWikiModelViewLike,
  RepoWikiTextGenerator,
} from "./repo-wiki/repoWikiService.js";

export type { IStorageService, StorageRootSpec } from "./storage/contract.js";

// CodingPlanSubscription service — ICodingPlanSubscriptionService is both a type (interface) and value (descriptor)
export {
  ICodingPlanSubscriptionService,
  type OffPeakClientConfig,
} from "./coding-plan-subscription/codingPlanSubscription.js";
export {
  IClientScenesService,
  type ClientSceneConfig,
  type ClientSceneItem,
  type ClientSceneOption,
  type ClientSceneResponseBody,
  type ClientScenesResponse,
} from "./client-scenes/clientScenes.js";
export { isValidCronExpr } from "./session/automationCronValidation.js";
export { IOffPeakTaskService } from "./session/offPeakTask.js";
export type { OffPeakUpdateTaskParams } from "./session/offPeakTask.js";

// Skills service — ISkillsService is both a type (interface) and value (descriptor)
export { ISkillsService } from "./skills/skills.js";
export { ISkillSyncService } from "./skill-sync/skillSync.js";
export { IMcpSyncService } from "./mcp-sync/mcpSync.js";
export { IPluginSyncService } from "./plugin-sync/pluginSync.js";
export {
  ICuaPermissionService,
  type CuaPermissionState,
  type CuaPermissionRestartOptions,
  type CuaPermissionStatus,
  type CuaPermissionStatusQueryOptions,
  type CuaPermissionStatusResult,
  type CuaPermissionStatusUnavailable,
  isCuaPermissionStatusAvailable,
} from "./cua-permission-broker/cuaPermissionService.js";
export {
  ICuaPipSessionService,
  type CuaPipSessionService,
} from "./cua-permission-broker/cuaPipSession.js";

// Plugins service — IPluginsService is both a type (interface) and value (descriptor)
export { IPluginsService } from "./plugins/plugins.js";
export { IPluginManagementService, withPluginTelemetry } from "./plugins/pluginManagement.js";

// Subagents service — ISubagentsService is both a type (interface) and value (descriptor)
export { ISubagentsService } from "./subagents/subagents.js";

// Commands service — ICommandsService is both a type (interface) and value (descriptor)
export { ICommandsService } from "./commands/commands.js";

export { ISettingsSyncService } from "./settings-sync/settingsSync.js";

export { IFeedbackService } from "./feedback/feedback.js";
export type { FeedbackUploadProgress } from "./feedback/feedback.js";
export { IPromptAttachmentTransferService } from "./prompt-attachment-transfer/promptAttachmentTransfer.js";
export type {
  PromptAttachmentStageParams,
  PromptAttachmentStageResult,
  PromptAttachmentTransferPhase,
  PromptAttachmentTransferProgress,
} from "./prompt-attachment-transfer/promptAttachmentTransfer.js";
export type {
  CreateFeedbackTicketInput,
  FeedbackAttachment,
  FeedbackAttachmentKind,
  FeedbackComment,
  FeedbackDeviceInfo,
  FeedbackListQuery,
  FeedbackListResult,
  FeedbackReporter,
  FeedbackTicketDetail,
  FeedbackTicketFramework,
  FeedbackTicketModule,
  FeedbackTicketSeverity,
  FeedbackTicketStatus,
  FeedbackTicketSummary,
  FeedbackTicketType,
} from "@origin-ai/cf-shared";

export { IProjectService, LEGACY_SINGLE_ROOT_PROJECT_PREFIX } from "#src/project/contract.js";
export type {
  ProjectTree,
  ProjectTask,
  ProjectTaskRef,
  VirtualProject,
  ProjectRoot,
  SaveProjectInput,
  ProjectDirectories,
} from "#src/project/contract.js";

export { IRemoteProjectService } from "#src/remote-projects/contract.js";
export type {
  RemoteProjectHost,
  RemoteProjectEntry,
  RemoteProjectCache,
  RemoteProjectDirectory,
} from "#src/remote-projects/contract.js";

export { readProjectCatalog, projectSelectionId } from "#src/project-catalog/index.js";
export type { ProjectCatalogPort, ProjectCatalogSnapshot } from "#src/project-catalog/contract.js";

export {
  createPluginUiBridgeService,
  createPluginUiAppToolsService,
  createPluginUiSamplingService,
  IPluginUiSamplingService,
  type PluginUiSamplingParams,
  type PluginUiCancelSamplingParams,
  PluginUiBridgeError,
  IPluginUiAppToolsService,
  type PluginUiAppToolInstanceParams,
  type PluginUiAppToolCallParams,
  type PluginUiAppToolAcceptedResult,
  type PluginUiRegisterAppToolsParams,
  type PluginUiRegisterAppToolsResult,
  type PluginUiResolveAppToolCallParams,
} from "./plugin-ui-bridge/index.js";
export {
  IPluginUiBridgeService,
  type PluginUiCallToolParams,
  type PluginUiCallToolResult,
  type PluginUiPrepareSandboxParams,
  type PluginUiReadResourceParams,
  type PluginUiReadResourceResult,
  type PluginUiPluginScope,
  type PluginUiListResourcesParams,
  type PluginUiListResourcesResult,
  type PluginUiListResourceTemplatesResult,
  type PluginUiResourceSubscriptionParams,
  type PluginUiSurfaceEntry,
  type PluginUiWorkspaceTarget,
} from "./plugin-ui-bridge/contract.js";
export { IClientConfigService } from "./client-config/clientConfig.js";

export { IHighspeedCardService } from "./highspeed/highspeedCard.js";
export {
  HighspeedCardService,
  createHighspeedHttpTransport,
  buildHighspeedTurnExecution,
} from "./highspeed/highspeedCardService.js";
export { createHighspeedMockTransport } from "./highspeed/highspeedMockTransport.js";

export { IGenUiService } from "./gen-ui/contract.js";
export type { GenUiPrepareParams } from "./gen-ui/contract.js";

export { ITaskGroupService } from "#src/task-groups/contract.js";
export type {
  TaskGroup,
  TaskGroupColor,
  TaskGroupStructure,
  GroupTaskRef,
  GroupNode,
  MoveGroupNode,
} from "#src/task-groups/contract.js";
