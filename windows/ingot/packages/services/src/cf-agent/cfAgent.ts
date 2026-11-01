import type { PluginUiToolResultNotification } from "@origin-ai/cf-shared/mcp-apps";
import type {
  BackgroundBashOutputResult,
  SessionDebugSnapshot,
  CfSessionContentProfile,
} from "@origin-ai/cf-shared";

import type { Event, IDisposable } from "@origin-ai/cf-rpc";
import { ServiceChannels } from "@origin-ai/cf-shared";
import type { AppUsageRange, AppUsageSnapshot, CfTaskTokenUsageResult } from "@origin-ai/cf-shared";
import type { DynamicWorkflowMode } from "@origin-ai/cf-shared";
import type { CfAutomation, CfAutomationRun } from "@origin-ai/cf-shared";
import type {
  CfStorageStartupState,
  CfDeliveryKind,
  CfAgentMcpServer,
  CfBackgroundTurnAttribution,
  TraceId,
  CfSessionCompactResult,
  CfSessionGoalAction,
  CfSessionGoalResult,
  CfMessageWithParts,
  ModelSelection,
  CfSessionImportHistory,
  CfPermissionRequestParams,
  AgentLaneResourceSample,
  CfMcpTelemetryEvent,
  CfMcpResourceSample,
  CfToolExecResource,
  CfProcessChildProcess,
  CfMcpListResult,
  CfPluginsListResult,
  CfPluginsOverviewResult,
  CfPluginsMarketplaceMutationResult,
  CfPluginsInstallResult,
  CfPluginsReferenceCatalogResult,
  CfSkillsReferenceCatalogResult,
  CfMcpReadResourceResult,
  CfMcpUiCallToolResult,
  CfMcpUiCancelCallResult,
  CfMcpUiReadResourceResult,
  CfMcpUiListResourcesResult,
  CfMcpUiAppToolAcceptedResult,
  CfMcpUiRegisterAppToolsResult,
  CfMcpUiUnregisterAppToolsResult,
  CfMcpUiListResourceTemplatesResult,
  CfPluginsListUiSurfacesResult,
  CfWorkflowsDeleteResult,
  CfWorkflowsForRunResult,
  CfWorkflowsGetResult,
  CfWorkflowsListResult,
  CfWorkflowsMoveResult,
  CfWorkflowsRunsResult,
  CfWorkflowsSaveResult,
  CfWorkflowsUpdateMetaResult,
  CfPluginsUninstallResult,
  CfPluginsRestoreBuiltinResult,
  CfPluginsConfigureResult,
  CfPluginsDescribeResult,
  CfPluginsValidateResult,
  CfPluginsSetEnabledResult,
  CfPluginsCancelOperationResult,
  CfPluginOperationProgressNotification,
  CfProviderRuntimeHeadersRequestParams,
  CfProviderRuntimeHeadersCancelled,
  CfProviderTestModelConnectivityParams,
  CfProviderTestModelConnectivityResult,
  CfUserInputRequestParams,
  CfUserInputResponse,
  CfSessionEvent,
  CfSessionInfo,
  CfSessionMode,
  CfSessionPersistence,
  CfSessionSendResult,
  CfSessionRequestRuntimePreferencesParams,
  CfSessionRuntimePreferencesResult,
  CfSessionStateSnapshot,
  CfSessionSubagentsResult,
  CfStateUpdatedNotification,
  CfTaskClientMode,
  CfBrowserAmbientContext,
  CfWorkspacePresentation,
  CfWorkspaceGenerateTextResult,
  CfWorkspaceGenerateTextParams,
  CfWorkspaceHookTrustGrantResult,
  CfAutomationBotDeliveryTarget,
} from "@origin-ai/cf-shared";
import type {
  ClientHello,
  CommandAck,
  CommandEnvelope,
  CommandKey,
  CommandsQueryResult,
  ConversationTopicWireCandidate,
  ConversationTelemetryFact,
  CuaPermissionObservation,
  ConversationRowTarget,
  HelloMessage,
  SessionsIndexTopicWireCandidate,
  SessionsIndexReconcileResult,
  V4AttachmentBeginResult,
  V4AttachmentChunkResult,
  V4AttachmentCommitResult,
  V4AttachmentPreviewSourceResult,
  V4AttachmentReadResult,
  V4ConversationAttachmentReadResult,
  V4ConversationAttachmentStatResult,
  V4ConnectionFlowState,
  V4ConversationFileChangesResult,
  V4ConversationFileRewindPreviewResult,
  V4ConversationPlansResult,
  V4ConversationWorkflowRunEventsResult,
  V4ConversationWorkflowRunArtifactDataResult,
  V4ConversationWorkflowRunArtifactReadResult,
  V4ConversationWorkflowRunArtifactsResult,
  V4ConversationWorkflowRunNodeResultResult,
  V4ConversationWorkflowRunWorkspaceResult,
  V4ConversationWorkflowRunsResult,
  V4ConversationRowsRangeResult,
  V4ConversationResyncResult,
  V4ConversationSubscribeResult,
  V4SessionsIndexSubscribeResult,
  V4WorkspaceConfigSubscribeResult,
  WorkspaceConfigTopicWireCandidate,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { createServiceDescriptor } from "../descriptors.js";

export * from "./cfAgentPluginParams.js";
export * from "./cfAgentWorkflowParams.js";
import type {
  CfAgentAddPluginMarketplaceParams,
  CfAgentAutomationIdParams,
  CfAgentCancelPluginOperationParams,
  CfAgentConfigurePluginParams,
  CfAgentResetPluginConfigParams,
  CfAgentCreateAutomationParams,
  CfAgentDeleteAutomationRunParams,
  CfAgentDescribePluginParams,
  CfAgentInstallPluginParams,
  CfAgentListMcpServerStatusesParams,
  CfAgentPluginViewParams,
  CfAgentPluginReferenceCatalogParams,
  CfAgentSkillReferenceCatalogParams,
  CfAgentReadMcpResourceParams,
  CfAgentReadMcpResourceForUiParams,
  CfAgentListMcpResourcesForUiParams,
  CfAgentAppToolCallForUiParams,
  CfAgentAppToolInstanceForUiParams,
  CfAgentRegisterAppToolsForUiParams,
  CfAgentResolveAppToolCallForUiParams,
  CfAgentMcpResourceSubscriptionForUiParams,
  CfAgentCallMcpToolForUiParams,
  CfAgentCancelMcpToolCallForUiParams,
  CfAgentResolveSuggestedPluginReferenceParams,
  CfAgentRemovePluginMarketplaceParams,
  CfAgentRestoreBuiltinPluginParams,
  CfAgentSetPluginEnabledParams,
  CfAgentSetAutomationEnabledParams,
  CfAgentUninstallPluginParams,
  CfAgentUpdatePluginMarketplaceParams,
  CfAgentUpdatePluginParams,
  CfAgentUpdateAutomationParams,
  CfAgentValidatePluginParams,
  CfAgentWorkspaceTarget,
} from "./cfAgentPluginParams.js";
import type {
  CfAgentDeleteSavedWorkflowParams,
  CfAgentFindSavedWorkflowForRunParams,
  CfAgentGetSavedWorkflowParams,
  CfAgentListSavedWorkflowRunsParams,
  CfAgentListSavedWorkflowsParams,
  CfAgentMoveSavedWorkflowParams,
  CfAgentSaveSavedWorkflowFromRunParams,
  CfAgentUpdateSavedWorkflowMetaParams,
} from "./cfAgentWorkflowParams.js";

export interface CfAgentSessionTarget extends CfAgentWorkspaceTarget {
  sessionId: string;
}

export interface CfAgentResumeSessionParams extends CfAgentSessionTarget {
  additionalDirectories?: string[];
  model?: ModelSelection;
  thoughtLevel?: string;
  mcpServers?: CfAgentMcpServer[];
  toolAllowlist?: string[];
  toolDenylist?: string[];
}

export interface CfAgentInitializeResult {
  available: boolean;
  workspaceKey: string;
  protocolName?: string;
  protocolVersion?: number;
  transportKind?: "stdio" | "websocket";
  reason?: string;
  reasonCode?: "provider_not_ready";
}

export interface CfAgentRunAutomationNowResult {
  status: "queued" | "duplicate";
}

export interface CfAgentWorkspaceRuntimeIdentity {
  generation: number;
  identity: string;
  processId?: number;
  workspaceKey: string;
}

export const CF_AGENT_RUNTIME_UNAVAILABLE_CODE = "CF_AGENT_RUNTIME_UNAVAILABLE";

export type CfAgentRuntimePolicy = "start-if-needed" | "existing-only";

export interface CfAgentRuntimeLifecycleEvent extends CfAgentWorkspaceTarget {
  workspaceKey: string;
  runtimeIdentity: CfAgentWorkspaceRuntimeIdentity;
  state: "available" | "unavailable";
}

export type CfAgentCuaPermissionObservation = CuaPermissionObservation &
  CfAgentWorkspaceTarget;

export interface CfAgentCreateSessionParams extends CfAgentWorkspaceTarget {
  projectId?: string | null;
  additionalDirectories?: string[];
  sessionId?: string;
  sessionTraceId?: TraceId;
  parentSessionId?: string;
  mode?: CfSessionMode;
  model?: ModelSelection;
  persistence?: CfSessionPersistence;
  thoughtLevel?: string;
  
  titleGenerationEnabled?: boolean;
  mcpServers?: CfAgentMcpServer[];
  toolAllowlist?: string[];
  toolDenylist?: string[];
  importedHistory?: CfSessionImportHistory;
}

export interface CfAgentListSessionsParams extends CfAgentWorkspaceTarget {
  sessionIds?: string[];
  runtimePolicy?: CfAgentRuntimePolicy;
  limit?: number;
}

export interface CfAgentListSessionSubagentsParams extends CfAgentSessionTarget {
  endedCursor?: string;
  endedLimit?: number;
  
  remoteSessionId?: string;
}

export interface CfAgentAppUsageParams {
  range: AppUsageRange;
  timeZone?: string;
}

export interface CfAgentTaskTokenUsageParams extends CfAgentSessionTarget {}

export interface CfAgentReadSessionParams extends CfAgentSessionTarget {
  deliveryKind?: CfDeliveryKind;
  messageLimit?: number;
  afterSeq?: number;
  
  runtimePolicy?: CfAgentRuntimePolicy;
  
  contentProfile?: CfSessionContentProfile;
}

export interface CfAgentReadSessionMessagesParams extends CfAgentSessionTarget {
  afterMessageId?: string;
  limit?: number;
}

export interface CfAgentReadSessionEventsParams extends CfAgentSessionTarget {
  afterSeq?: number;
  limit?: number;
}

export type CfAgentReadWorkspacePresentationParams = CfAgentWorkspaceTarget;

export interface CfAgentGrantWorkspaceHookTrustParams extends CfAgentWorkspaceTarget {
  bundleDigest: string;
  hookDeclarationDigest: string;
}

export interface CfAgentSendPromptParamsBase extends CfAgentSessionTarget {
  modelSelection?: ModelSelection;
  modelExecution?: import("@origin-ai/cf-shared/cf-protocol-v4").CommandPayloadMap["sendText"]["modelExecution"];
  inputId?: string;
  queryId?: string;
  messageId?: string;
  sessionTraceId?: TraceId;
  content: string;
  attachments?: Record<string, unknown>[];
  
  browserAmbientContext?: CfBrowserAmbientContext;
  clientMode?: CfTaskClientMode;
  expectedRevision?: number;
  expectedProviderRevision?: string;
  runtimeProviderHeaders?: Record<string, string>;
  toolDenylist?: string[];
  
  botDeliveryTarget?: CfAutomationBotDeliveryTarget;
}

export type CfAgentSendPromptParams = CfAgentSendPromptParamsBase &
  CfBackgroundTurnAttribution;

export interface CfAgentCompactParams extends CfAgentSessionTarget {
  inputId?: string;
  instructions?: string;
  expectedRevision?: number;
}

export interface CfAgentGoalParams extends CfAgentSessionTarget {
  inputId?: string;
  action: CfSessionGoalAction;
  objective?: string;
  expectedRevision?: number;
}

export interface CfAgentSetModelParams extends CfAgentSessionTarget {
  model: ModelSelection;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface CfAgentSetThoughtLevelParams extends CfAgentSessionTarget {
  thoughtLevel?: string;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface CfAgentSetModeParams extends CfAgentSessionTarget {
  mode: CfSessionMode;
  expectedRevision?: number;
}

export interface CfAgentGenerateWorkspaceTextParams extends CfAgentWorkspaceTarget {
  selection: CfWorkspaceGenerateTextParams["selection"];
  prompt?: string;
  messages?: CfWorkspaceGenerateTextParams["messages"];
  tools?: CfWorkspaceGenerateTextParams["tools"];
  querySource: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  
  requestTimeoutMs?: number;
}

export interface CfAgentTestModelConnectivityParams extends CfAgentWorkspaceTarget {
  selection: CfProviderTestModelConnectivityParams["selection"];
  signal?: AbortSignal;
}

export type ProviderRuntimeHeadersUiResponse =
  | { headersApplied: true; runtimeProviderHeaders: Record<string, string>; errorMessage?: string }
  | { headersApplied: false; errorMessage?: string };

export interface CfAgentRespondProviderRuntimeHeadersParams extends CfAgentSessionTarget {
  requestId: string;
  response: ProviderRuntimeHeadersUiResponse;
}

export interface CfAgentSessionRuntimePreferencesRequest extends CfSessionRequestRuntimePreferencesParams {
  requestId: string;
}

export interface CfAgentRespondSessionRuntimePreferencesParams {
  requestId: string;
  resolution:
    | { status: "resolved"; preferences: CfSessionRuntimePreferencesResult }
    | { status: "failed"; message: string };
}

export interface CfAgentSessionSubscribeParams extends CfAgentSessionTarget {
  deliveryKind: CfDeliveryKind;
  afterSeq?: number;
  includeSnapshot?: boolean;
  eventCoalescing?: {
    mode: "background-summary";
    intervalMs?: number;
  };
}

export interface CfAgentConversationSubscribeParams extends CfAgentSessionTarget {
  retryInitialization?: string;
  
  base?: { logEpoch: string; seq: number };
  visibility?: "foreground" | "background";
}

export interface CfAgentConversationUnsubscribeParams extends CfAgentWorkspaceTarget {
  subscriptionId: string;
  runtimePolicy?: CfAgentRuntimePolicy;
}

export interface CfAgentConversationResyncParams extends CfAgentWorkspaceTarget {
  subscriptionId: string;
  base: { logEpoch: string; seq: number } | null;
  forceSnapshot?: boolean;
  runtimePolicy?: CfAgentRuntimePolicy;
}

export interface CfAgentConversationRowsRangeParams extends CfAgentSessionTarget {
  
  beforeRowId?: number;
  /** 1..rowsRangeMaxLimit（200）。 */
  limit: number;
}

export type CfAgentConversationPlansParams = CfAgentSessionTarget;

export interface CfAgentConversationWorkflowRunEventsParams extends CfAgentSessionTarget {
  runId: string;
  afterSequence?: number;
  limit?: number;
}

export interface CfAgentConversationWorkflowRunsParams extends CfAgentSessionTarget {
  limit?: number;
}

export interface CfAgentConversationWorkflowRunArtifactsParams extends CfAgentSessionTarget {
  runId: string;
}

export interface CfAgentConversationWorkflowRunArtifactDataParams extends CfAgentSessionTarget {
  runId: string;
  artifactId: string;
  afterSequence?: number;
  limit?: number;
}

export interface CfAgentConversationWorkflowRunArtifactReadParams extends CfAgentSessionTarget {
  runId: string;
  artifactId: string;
  version: number;
  offset: number;
  limit: number;
}

export interface CfAgentConversationWorkflowRunWorkspaceParams extends CfAgentSessionTarget {
  runId: string;
}

export interface CfAgentConversationWorkflowRunNodeResultParams extends CfAgentSessionTarget {
  runId: string;
  siteId: string;
  ordinal: number;
  maxBytes?: number;
}

export interface CfAgentBackgroundBashOutputParams extends CfAgentSessionTarget {
  workId: string;
}

export interface CfAgentConversationFileChangesParams extends CfAgentSessionTarget {
  target: ConversationRowTarget;
  baseRevision: number;
  baseLogEpoch: string;
}

export interface CfAgentConversationFileRewindPreviewParams extends CfAgentSessionTarget {
  target: ConversationRowTarget;
  baseRevision: number;
  baseLogEpoch: string;
}

export interface CfAgentConversationCommandParams extends CfAgentWorkspaceTarget {
  
  projectId?: string | null;
  envelope: CommandEnvelope;
  
  clientMode?: CfTaskClientMode;
}

export interface CfAgentCommandsQueryParams extends CfAgentWorkspaceTarget {
  clock?: true;
  commands: CommandKey[];
}

export interface CfAgentAttachmentBeginParams extends CfAgentSessionTarget {
  uploadId: string;
  fileName: string;
  mime: string;
  totalBytes: number;
  totalChunks: number;
  checksum: string;
}

export interface CfAgentAttachmentChunkParams extends CfAgentSessionTarget {
  uploadId: string;
  chunkIndex: number;
  dataBase64: string;
}

export interface CfAgentAttachmentTerminalParams extends CfAgentSessionTarget {
  uploadId: string;
}

export interface CfAgentAttachmentReadParams extends CfAgentSessionTarget {
  ref: string;
  target?: ConversationRowTarget;
  attachmentIndex?: number;
  offset: number;
  limit: number;
}

export interface CfAgentConversationAttachmentReadParams extends CfAgentSessionTarget {
  ref: string;
  target: ConversationRowTarget;
  attachmentIndex: number;
  offset: number;
  limit: number;
}

export interface CfAgentConversationAttachmentStatParams extends CfAgentSessionTarget {
  ref: string;
  target: ConversationRowTarget;
  attachmentIndex: number;
}

export interface CfAgentAttachmentPreviewSourceParams extends CfAgentSessionTarget {
  ref: string;
  target?: ConversationRowTarget;
  attachmentIndex?: number;
}

export interface CfAgentConnectionFlowParams extends CfAgentWorkspaceTarget {
  state: V4ConnectionFlowState;
}

export interface CfAgentSessionsIndexSubscribeParams extends CfAgentWorkspaceTarget {
  base?: { logEpoch: string; seq: number };
  visibility?: "foreground" | "background";
  
  subscriberScope?: string;
  
  runtimePolicy?: CfAgentRuntimePolicy;
}

export interface CfAgentWorkspaceConfigSubscribeParams extends CfAgentWorkspaceTarget {
  base?: { logEpoch: string; seq: number };
  visibility?: "foreground" | "background";
  subscriberScope?: string;
  runtimePolicy?: CfAgentRuntimePolicy;
}

export type CfAgentServiceEvent =
  | { type: "session.event"; event: CfSessionEvent }
  | { type: "state.updated"; notification: CfStateUpdatedNotification }
  | { type: "permission.request"; request: CfPermissionRequestParams }
  | { type: "userInput.request"; request: CfUserInputRequestParams }
  | {
      type: "userInput.response";
      requestId: string;
      response: CfUserInputResponse;
    }
  | { type: "providerRuntimeHeaders.request"; request: CfProviderRuntimeHeadersRequestParams }
  | { type: "snapshot"; snapshot: CfSessionStateSnapshot };

export interface CfAgentAppRuntimePreferences {
  askUserQuestionAutoResolutionEnabled: boolean;
  modelIoFullRetentionEnabled?: boolean;
}

export interface CfAgentLocalRuntimeChildProcesses {
  pid: number;
  provider: string;
  workspacePath: string;
  lane?: string;
  children: CfProcessChildProcess[];
}

export interface CfAgentStorageStartupSnapshot {
  generation: number;
  state: CfStorageStartupState | null;
}

export interface ICfAgentService {
  
  prepareStorage(params: CfAgentWorkspaceTarget): Promise<void>;
  getStorageStartupState(
    params: CfAgentWorkspaceTarget,
  ): Promise<CfAgentStorageStartupSnapshot | null>;
  onDynamicStorageStartupState(
    params: CfAgentWorkspaceTarget,
  ): Event<CfAgentStorageStartupSnapshot>;
  initialize(params: CfAgentWorkspaceTarget): Promise<CfAgentInitializeResult>;
  
  syncAppRuntimePreferences(preferences: CfAgentAppRuntimePreferences): Promise<void>;
  
  syncDynamicWorkflowUserMode(params: { mode?: DynamicWorkflowMode }): Promise<void>;
  getWorkspaceRuntimeIdentity(
    params: CfAgentWorkspaceTarget,
  ): Promise<CfAgentWorkspaceRuntimeIdentity>;
  createSession(params: CfAgentCreateSessionParams): Promise<CfSessionStateSnapshot>;
  resumeSession(params: CfAgentResumeSessionParams): Promise<CfSessionStateSnapshot>;
  listSessions(params: CfAgentListSessionsParams): Promise<CfSessionInfo[]>;
  listSessionSubagents(
    params: CfAgentListSessionSubagentsParams,
  ): Promise<CfSessionSubagentsResult>;
  getAppUsageStats(params: CfAgentAppUsageParams): Promise<AppUsageSnapshot>;
  getTaskTokenUsage(params: CfAgentTaskTokenUsageParams): Promise<CfTaskTokenUsageResult>;
  readSession(params: CfAgentReadSessionParams): Promise<CfSessionStateSnapshot>;
  readSessionMessages(
    params: CfAgentReadSessionMessagesParams,
  ): Promise<CfMessageWithParts[]>;
  readSessionDebug(params: CfAgentSessionTarget): Promise<SessionDebugSnapshot>;
  readSessionEvents(params: CfAgentReadSessionEventsParams): Promise<CfSessionEvent[]>;
  readWorkspacePresentation(
    params: CfAgentReadWorkspacePresentationParams,
  ): Promise<CfWorkspacePresentation>;
  
  grantWorkspaceHookTrust(
    params: CfAgentGrantWorkspaceHookTrustParams,
  ): Promise<CfWorkspaceHookTrustGrantResult>;
  listMcpServerStatuses(params: CfAgentListMcpServerStatusesParams): Promise<CfMcpListResult>;
  listPlugins(params: CfAgentPluginViewParams): Promise<CfPluginsListResult>;
  
  getPluginReferenceCatalog(
    params: CfAgentPluginReferenceCatalogParams,
  ): Promise<CfPluginsReferenceCatalogResult>;
  
  getSkillReferenceCatalog(
    params: CfAgentSkillReferenceCatalogParams,
  ): Promise<CfSkillsReferenceCatalogResult>;
  
  openMcpUiInstance(
    params: import("../plugin-ui-bridge/contract.js").PluginUiPrepareSandboxParams & {
      accountContext?: string;
    },
  ): Promise<import("@origin-ai/cf-shared/mcp-apps").McpAppInstance>;
  validateMcpUiInstance(
    params: import("../plugin-ui-bridge/contract.js").PluginUiPluginScope,
  ): Promise<void>;
  recycleMcpUiInstance(
    params: import("../plugin-ui-bridge/contract.js").PluginUiPluginScope,
  ): Promise<boolean>;
  closeMcpUiInstance(
    params: import("../plugin-ui-bridge/contract.js").PluginUiPluginScope,
  ): Promise<void>;
  readMcpResource(params: CfAgentReadMcpResourceParams): Promise<CfMcpReadResourceResult>;
  
  sampleMcpApp(
    params: import("../plugin-ui-bridge/samplingContract.js").PluginUiSamplingParams,
  ): Promise<import("@origin-ai/cf-shared/mcp-apps").McpAppsSamplingResult>;
  cancelMcpAppSampling(
    params: import("../plugin-ui-bridge/samplingContract.js").PluginUiCancelSamplingParams,
  ): Promise<{ cancelled: boolean }>;
  callMcpToolForUi(params: CfAgentCallMcpToolForUiParams): Promise<CfMcpUiCallToolResult>;
  
  cancelMcpToolCallForUi(
    params: CfAgentCancelMcpToolCallForUiParams,
  ): Promise<CfMcpUiCancelCallResult>;
  
  readMcpResourceForUi(
    params: CfAgentReadMcpResourceForUiParams,
  ): Promise<CfMcpUiReadResourceResult>;
  
  listMcpResourcesForUi(
    params: CfAgentListMcpResourcesForUiParams,
  ): Promise<CfMcpUiListResourcesResult>;
  listMcpResourceTemplatesForUi(
    params: CfAgentListMcpResourcesForUiParams,
  ): Promise<CfMcpUiListResourceTemplatesResult>;
  subscribeMcpResourceForUi(params: CfAgentMcpResourceSubscriptionForUiParams): Promise<void>;
  unsubscribeMcpResourceForUi(params: CfAgentMcpResourceSubscriptionForUiParams): Promise<void>;
  
  registerAppToolsForUi(
    params: CfAgentRegisterAppToolsForUiParams,
  ): Promise<CfMcpUiRegisterAppToolsResult>;
  unregisterAppToolsForUi(
    params: CfAgentAppToolInstanceForUiParams,
  ): Promise<CfMcpUiUnregisterAppToolsResult>;
  claimAppToolCallForUi(
    params: CfAgentAppToolCallForUiParams,
  ): Promise<CfMcpUiAppToolAcceptedResult>;
  resolveAppToolCallForUi(
    params: CfAgentResolveAppToolCallForUiParams,
  ): Promise<CfMcpUiAppToolAcceptedResult>;
  
  listPluginUiSurfaces(
    params: CfAgentWorkspaceTarget,
  ): Promise<CfPluginsListUiSurfacesResult>;
  listSavedWorkflows(params: CfAgentListSavedWorkflowsParams): Promise<CfWorkflowsListResult>;
  getSavedWorkflow(params: CfAgentGetSavedWorkflowParams): Promise<CfWorkflowsGetResult>;
  updateSavedWorkflowMeta(
    params: CfAgentUpdateSavedWorkflowMetaParams,
  ): Promise<CfWorkflowsUpdateMetaResult>;
  deleteSavedWorkflow(
    params: CfAgentDeleteSavedWorkflowParams,
  ): Promise<CfWorkflowsDeleteResult>;
  listSavedWorkflowRuns(
    params: CfAgentListSavedWorkflowRunsParams,
  ): Promise<CfWorkflowsRunsResult>;
  moveSavedWorkflow(params: CfAgentMoveSavedWorkflowParams): Promise<CfWorkflowsMoveResult>;
  saveSavedWorkflowFromRun(
    params: CfAgentSaveSavedWorkflowFromRunParams,
  ): Promise<CfWorkflowsSaveResult>;
  
  findSavedWorkflowForRun(
    params: CfAgentFindSavedWorkflowForRunParams,
  ): Promise<CfWorkflowsForRunResult>;
  resolveSuggestedPluginReference(
    params: CfAgentResolveSuggestedPluginReferenceParams,
  ): Promise<import("@origin-ai/cf-shared").CfPluginsResolveSuggestedReferenceResult>;
  
  onDynamicPluginOperationProgress(
    operationId: string,
  ): Event<CfPluginOperationProgressNotification>;
  getPluginsOverview(params: CfAgentPluginViewParams): Promise<CfPluginsOverviewResult>;
  
  collectLocalRuntimeChildProcesses(
    signal?: AbortSignal,
  ): Promise<CfAgentLocalRuntimeChildProcesses[]>;
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
  listAutomations(params: CfAgentWorkspaceTarget): Promise<CfAutomation[]>;
  listAllAutomations(): Promise<CfAutomation[]>;
  createAutomation(params: CfAgentCreateAutomationParams): Promise<CfAutomation>;
  updateAutomation(params: CfAgentUpdateAutomationParams): Promise<CfAutomation | null>;
  deleteAutomation(params: CfAgentAutomationIdParams): Promise<void>;
  setAutomationEnabled(params: CfAgentSetAutomationEnabledParams): Promise<void>;
  restartAutomation(params: CfAgentAutomationIdParams): Promise<void>;
  runAutomationNow(params: CfAgentAutomationIdParams): Promise<CfAgentRunAutomationNowResult>;
  listAutomationRuns(params: CfAgentAutomationIdParams): Promise<CfAutomationRun[]>;
  deleteAutomationRun(params: CfAgentDeleteAutomationRunParams): Promise<void>;
  generateWorkspaceText(
    params: CfAgentGenerateWorkspaceTextParams,
  ): Promise<CfWorkspaceGenerateTextResult>;
  testModelConnectivity(
    params: CfAgentTestModelConnectivityParams,
  ): Promise<CfProviderTestModelConnectivityResult>;
  
  sendPrompt(params: CfAgentSendPromptParams): Promise<CfSessionSendResult>;
  compactSession(params: CfAgentCompactParams): Promise<CfSessionCompactResult>;
  goalSession(params: CfAgentGoalParams): Promise<CfSessionGoalResult>;
  closeSession(
    params: CfAgentSessionTarget & { expectedPersistence?: "deferred" | "immediate" },
  ): Promise<boolean>;
  setModel(params: CfAgentSetModelParams): Promise<CfSessionStateSnapshot>;
  setThoughtLevel(params: CfAgentSetThoughtLevelParams): Promise<CfSessionStateSnapshot>;
  setMode(params: CfAgentSetModeParams): Promise<CfSessionStateSnapshot>;
  respondProviderRuntimeHeaders(
    params: CfAgentRespondProviderRuntimeHeadersParams,
  ): Promise<void>;
  respondSessionRuntimePreferences(
    params: CfAgentRespondSessionRuntimePreferencesParams,
  ): Promise<void>;
  
  onDynamicProviderRuntimeHeadersRequest(
    params: CfAgentSessionTarget,
  ): Event<CfProviderRuntimeHeadersRequestParams>;
  
  onDynamicWorkspaceProviderRuntimeHeadersRequest(
    params: CfAgentWorkspaceTarget,
  ): Event<CfProviderRuntimeHeadersRequestParams>;
  
  onDynamicWorkspaceProviderRuntimeHeadersCancelled(
    params: CfAgentWorkspaceTarget,
  ): Event<CfProviderRuntimeHeadersCancelled>;
  onDynamicSessionRuntimePreferencesRequest(): Event<CfAgentSessionRuntimePreferencesRequest>;
  
  onDynamicProcessResourceSample(): Event<AgentLaneResourceSample>;
  
  onDynamicMcpTelemetry(): Event<CfMcpTelemetryEvent>;
  
  onDynamicMcpResourceSamples(): Event<CfMcpResourceSample[]>;
  
  onDynamicToolExecResource(): Event<CfToolExecResource>;
  
  onDynamicSessionEvent(params: CfAgentSessionSubscribeParams): Event<CfAgentServiceEvent>;
  
  helloConversationV4(): Promise<HelloMessage>;
  
  initializeConversationV4(clientHello: ClientHello): Promise<void>;
  
  setConnectionFlowStateV4(params: CfAgentConnectionFlowParams): Promise<void>;
  subscribeConversationV4(
    params: CfAgentConversationSubscribeParams,
  ): Promise<V4ConversationSubscribeResult>;
  resyncConversationV4(
    params: CfAgentConversationResyncParams,
  ): Promise<V4ConversationResyncResult>;
  unsubscribeConversationV4(params: CfAgentConversationUnsubscribeParams): Promise<void>;
  
  conversationRowsRangeV4(
    params: CfAgentConversationRowsRangeParams,
  ): Promise<V4ConversationRowsRangeResult>;
  conversationPlansV4(
    params: CfAgentConversationPlansParams,
  ): Promise<V4ConversationPlansResult>;
  
  conversationWorkflowRunEventsV4(
    params: CfAgentConversationWorkflowRunEventsParams,
  ): Promise<V4ConversationWorkflowRunEventsResult>;
  
  conversationWorkflowRunsV4(
    params: CfAgentConversationWorkflowRunsParams,
  ): Promise<V4ConversationWorkflowRunsResult>;
  
  conversationWorkflowRunArtifactsV4(
    params: CfAgentConversationWorkflowRunArtifactsParams,
  ): Promise<V4ConversationWorkflowRunArtifactsResult>;
  
  conversationWorkflowRunArtifactDataV4(
    params: CfAgentConversationWorkflowRunArtifactDataParams,
  ): Promise<V4ConversationWorkflowRunArtifactDataResult>;
  
  conversationWorkflowRunArtifactReadV4(
    params: CfAgentConversationWorkflowRunArtifactReadParams,
  ): Promise<V4ConversationWorkflowRunArtifactReadResult>;
  
  conversationWorkflowRunWorkspaceV4(
    params: CfAgentConversationWorkflowRunWorkspaceParams,
  ): Promise<V4ConversationWorkflowRunWorkspaceResult>;
  
  conversationWorkflowRunNodeResultV4(
    params: CfAgentConversationWorkflowRunNodeResultParams,
  ): Promise<V4ConversationWorkflowRunNodeResultResult>;
  backgroundBashOutputV4(
    params: CfAgentBackgroundBashOutputParams,
  ): Promise<BackgroundBashOutputResult>;
  conversationFileChangesV4(
    params: CfAgentConversationFileChangesParams,
  ): Promise<V4ConversationFileChangesResult>;
  conversationFileRewindPreviewV4(
    params: CfAgentConversationFileRewindPreviewParams,
  ): Promise<V4ConversationFileRewindPreviewResult>;
  sendConversationCommandV4(params: CfAgentConversationCommandParams): Promise<CommandAck>;
  queryConversationCommandsV4(params: CfAgentCommandsQueryParams): Promise<CommandsQueryResult>;
  attachmentBeginV4(params: CfAgentAttachmentBeginParams): Promise<V4AttachmentBeginResult>;
  attachmentChunkV4(params: CfAgentAttachmentChunkParams): Promise<V4AttachmentChunkResult>;
  attachmentCommitV4(params: CfAgentAttachmentTerminalParams): Promise<V4AttachmentCommitResult>;
  attachmentAbortV4(params: CfAgentAttachmentTerminalParams): Promise<void>;
  
  attachmentPreviewSourceV4(
    params: CfAgentAttachmentPreviewSourceParams,
  ): Promise<V4AttachmentPreviewSourceResult>;
  
  attachmentReadV4(params: CfAgentAttachmentReadParams): Promise<V4AttachmentReadResult>;
  
  conversationAttachmentReadV4(
    params: CfAgentConversationAttachmentReadParams,
  ): Promise<V4ConversationAttachmentReadResult>;
  
  conversationAttachmentStatV4(
    params: CfAgentConversationAttachmentStatParams,
  ): Promise<V4ConversationAttachmentStatResult>;
  
  onDynamicConversationFrame(
    params: CfAgentWorkspaceTarget,
  ): Event<ConversationTopicWireCandidate>;
  
  onDynamicLocalTtftFacts(
    params: CfAgentWorkspaceTarget,
  ): Event<import("@origin-ai/cf-shared").LocalTtftFacts>;
  onDynamicConversationTelemetryFact(
    params: CfAgentWorkspaceTarget,
  ): Event<ConversationTelemetryFact>;
  
  onDynamicOffPeakLifecycle(
    params: CfAgentWorkspaceTarget,
  ): Event<import("@origin-ai/cf-shared").OffPeakLifecycleNotification>;
  controlOffPeakExecutionV4(
    params: CfAgentWorkspaceTarget & { control: import("@origin-ai/cf-shared").OffPeakControlParams },
  ): Promise<import("@origin-ai/cf-shared").OffPeakControlResult>;
  
  onDynamicCuaPermissionObservation(): Event<CfAgentCuaPermissionObservation>;
  
  onDynamicPluginUiToolResult(): Event<
    PluginUiToolResultNotification & { workspacePath: string; workspaceIdentity?: string }
  >;

  
  reconcileSessionsIndexV4?(
    params: CfAgentWorkspaceTarget & { sessionIds: string[] },
  ): Promise<SessionsIndexReconcileResult>;
  subscribeSessionsIndexV4(
    params: CfAgentSessionsIndexSubscribeParams,
  ): Promise<V4SessionsIndexSubscribeResult>;
  resyncSessionsIndexV4(
    params: CfAgentConversationResyncParams,
  ): Promise<V4ConversationResyncResult>;
  unsubscribeSessionsIndexV4(params: CfAgentConversationUnsubscribeParams): Promise<void>;
  
  onDynamicSessionsIndexFrame(
    params: CfAgentWorkspaceTarget,
  ): Event<SessionsIndexTopicWireCandidate>;
  subscribeWorkspaceConfigV4(
    params: CfAgentWorkspaceConfigSubscribeParams,
  ): Promise<V4WorkspaceConfigSubscribeResult>;
  resyncWorkspaceConfigV4(
    params: CfAgentConversationResyncParams,
  ): Promise<V4ConversationResyncResult>;
  unsubscribeWorkspaceConfigV4(params: CfAgentConversationUnsubscribeParams): Promise<void>;
  
  onDynamicWorkspaceConfigFrame(
    params: CfAgentWorkspaceTarget,
  ): Event<WorkspaceConfigTopicWireCandidate>;
  
  onAgentRuntimeRestarted(listener: (event: { workspaceKey: string }) => void): IDisposable;
  
  onAgentRuntimeLifecycle?: (
    listener: (event: CfAgentRuntimeLifecycleEvent) => void,
  ) => IDisposable;
  
  hasActiveCuaOperationTurn(): boolean;
  disposeWorkspace(params: CfAgentWorkspaceTarget): Promise<void>;
  disposeAll(): void;
}

export const ICfAgentService = createServiceDescriptor<ICfAgentService>(
  ServiceChannels.CfAgent,
);
