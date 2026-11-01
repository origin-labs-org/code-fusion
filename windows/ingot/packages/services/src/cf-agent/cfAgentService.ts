import { isAuxiliarySessionKind } from "@origin-ai/cf-shared";
import {
  pluginUiToolResultNotificationSchema,
  type PluginUiToolResultNotification,
} from "@origin-ai/cf-shared/mcp-apps";
import { supportsHistoryFirst } from "./independentPlanSupport.js";
import {
  offPeakControlParamsSchema,
  offPeakControlResultSchema,
  offPeakLifecycleNotificationSchema,
  type OffPeakLifecycleNotification,
  type OffPeakControlParams,
} from "@origin-ai/cf-shared";
import {
  requiresRequestVerification,
  allowRequestVerificationHeaders,
  requestVerificationInteractionAvailable,
} from "@origin-ai/cf-shared";
import { cfMcpUiSamplingResultSchema } from "@origin-ai/cf-shared";
import { MCP_APPS_SAMPLING_TRANSPORT_TIMEOUT_MS } from "@origin-ai/cf-shared/mcp-apps";
import {
  channelReplyRequestSchema,
  type ChannelReplyHostRequest,
  type ChannelReplyResult,
} from "@origin-ai/cf-shared";
import { requestPluginReferenceCatalog } from "#src/cf-agent/pluginReferenceCatalogRequest.js";
import {
  localTtftFactsSchema,
  sessionDebugSnapshotSchema,
  type LocalTtftFacts,
} from "@origin-ai/cf-shared";

import { ensureIndependentPlanSupport } from "./independentPlanSupport.js";
import { createHash, randomUUID } from "node:crypto";
import { createTopicResourceBridge } from "./topicResourceBridge.js";
import { uploadTopicResourceToClient } from "./topicResourceUpload.js";
import {
  cfTopicResourceCancelParamsSchema,
  type CfTopicResourceReadParams,
  type CfProtocolTrace,
  type CfPromptAttachment,
} from "@origin-ai/cf-shared";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Emitter } from "@origin-ai/cf-rpc";
import type { IDisposable } from "@origin-ai/cf-rpc";
import type {
  AccountProviderConfigSnapshot,
  ModelSelectionView,
  ProviderSource,
} from "@origin-ai/cf-provider";
import { completeNewModelSelection } from "@origin-ai/cf-provider";
import type { OffPeakClientConfig } from "#src/coding-plan-subscription/codingPlanSubscription.js";
import {
  subagentRuntimeConfigSchema,
  cfSubagentsReadRuntimeConfigParamsSchema,
  type SubagentRuntimeConfig,
  CF_SESSION_RUNTIME_PREFERENCES_REQUEST_TIMEOUT_MS,
  formatLogPrefix,
  resolveWorkspaceKey,
  type TraceId,
  CF_AGENT_PROVIDER,
  CF_AGENT_PROVIDER_NOT_READY_CODE,
  CF_AGENT_PROVIDER_NOT_READY_REASON,
  CF_MODEL_REASONING_SEPARATOR,
  isRemoteWorkspaceIdentity,
  CF_PROTOCOL_NAME,
  CF_PROTOCOL_VERSION,
  cfMcpListResultSchema,
  cfPermissionRequestParamsSchema,
  cfBrowserListParamsSchema,
  cfBrowserExecuteParamsSchema,
  cfPluginsConfigureResultSchema,
  cfPluginsInstallResultSchema,
  cfPluginsListResultSchema,
  cfPluginsMarketplaceMutationResultSchema,
  cfPluginsOverviewResultSchema,
  cfProcessChildProcessesResultSchema,
  type CfProcessChildProcess,
  cfSkillsReferenceCatalogResultSchema,
  cfMcpReadResourceResultSchema,
  cfMcpUiCallToolResultSchema,
  cfMcpUiCancelCallResultSchema,
  cfMcpUiReadResourceResultSchema,
  cfMcpUiListResourcesResultSchema,
  cfMcpUiAppToolAcceptedResultSchema,
  cfMcpUiRegisterAppToolsResultSchema,
  cfMcpUiUnregisterAppToolsResultSchema,
  cfMcpUiListResourceTemplatesResultSchema,
  cfMcpUiResourceSubscriptionResultSchema,
  cfPluginsListUiSurfacesResultSchema,
  cfWorkflowsDeleteResultSchema,
  cfWorkflowsForRunResultSchema,
  cfWorkflowsGetResultSchema,
  cfWorkflowsListResultSchema,
  cfWorkflowsMoveResultSchema,
  cfWorkflowsRunsResultSchema,
  cfWorkflowsSaveResultSchema,
  cfWorkflowsUpdateMetaResultSchema,
  cfPluginsResolveSuggestedReferenceResultSchema,
  cfPluginOperationProgressNotificationSchema,
  cfPluginsRestoreBuiltinResultSchema,
  cfPluginsSetEnabledResultSchema,
  cfPluginsCancelOperationResultSchema,
  cfPluginsUninstallResultSchema,
  cfPluginsValidateResultSchema,
  cfPluginsDescribeResultSchema,
  cfAutomationCheckTaskBindingParamsSchema,
  cfAutomationCreateParamsSchema,
  cfAutomationDeleteParamsSchema,
  cfAutomationListParamsSchema,
  cfAutomationUpdateParamsSchema,
  cfOffPeakCreateParamsSchema,
  cfOffPeakListParamsSchema,
  OFF_PEAK_PROVIDER_IDS,
  cfComputerUseOperationEventSchema,
  cfProviderRuntimeHeadersCancelledSchema,
  cfProviderRuntimeHeadersRequestParamsSchema,
  cfProviderRefreshRegistryResultSchema,
  cfProviderTestModelConnectivityResultSchema,
  cfOfficialMcpAuthHeadersRequestParamsSchema,
  summarizeOfficialMcpIdentityHeaders,
  cfProtocolEmptyResultSchema,
  cfProtocolMethods,
  cfProtocolNotifications,
  cfMcpTelemetryEventSchema,
  cfMcpResourceSamplesSchema,
  cfToolExecResourceSchema,
  cfProcessResourceSampleSchema,
  cfSessionCloseResultSchema,
  cfSessionCompactResultSchema,
  cfSessionEventsResultSchema,
  cfSessionGoalResultSchema,
  cfSessionListResultSchema,
  cfSessionSubagentsResultSchema,
  cfSessionMessagesResultSchema,
  cfSessionEventSchema,
  cfSessionSendResultSchema,
  cfSessionRequestRuntimePreferencesParamsSchema,
  cfSessionRuntimePreferencesResultSchema,
  cfSessionStateSnapshotSchema,
  cfSessionSubscribeResultSchema,
  cfStateUpdatedNotificationSchema,
  cfUserInputRequestParamsSchema,
  cfWorkspacePresentationSchema,
  cfWorkspaceCancelGenerateTextResultSchema,
  cfWorkspaceGenerateTextResultSchema,
  cfWorkspaceHookTrustGrantResultSchema,
  cfWorkspaceUpdateInteractionPreferencesResultSchema,
  cfWorkspaceUpdateModelIoPreferencesResultSchema,
  cfProviderUpdateAccountConfigResultSchema,
  type CfSessionStateSnapshot,
  type CfAutomation,
  type CfAutomationRun,
  cfWorkspaceUpdateOffPeakToolPolicyResultSchema,
  cfWorkspaceUpdateDynamicWorkflowPolicyResultSchema,
  type DynamicWorkflowClientConfig,
  type DynamicWorkflowMode,
  applyDynamicWorkflowUserMode,
  createDynamicWorkflowClientConfig,
  DEFAULT_DYNAMIC_WORKFLOW_MODE,
  isDynamicWorkflowModeEnabled,
  normalizeDynamicWorkflowMode,
  type AgentLaneResourceSample,
  type ProcessResourceCliLane,
  type CfMcpTelemetryEvent,
  type CfMcpResourceSample,
  type CfToolExecResource,
  type CfPluginOperationProgressNotification,
  type CfTaskMode,
} from "@origin-ai/cf-shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { createOfficialMcpIssuanceAudit } from "#src/official-mcp/officialMcpIssuanceAudit.js";
import type {
  AccountRequestAuthMaterial,
  IAccountRequestAuthService,
} from "#src/model-provider/accountRequestAuthService.js";
import {
  mergeAutomationMutationToolDenylist,
  mergeOffPeakMutationToolDenylist,
} from "#src/cf-agent/automationToolPolicy.js";
import { CF_AGENT_RUNTIME_UNAVAILABLE_CODE } from "./cfAgent.js";
import type {
  CfProtocolRequestId,
  ModelSelection,
  CfProviderRuntimeHeadersRequestParams,
  CfProviderRuntimeHeadersCancelled,
  CfSessionEvent,
  CfSessionRuntimePreferencesScope,
  CfSavedWorkflowScope,
  CfStateUpdatedNotification,
  CfWorkspacePresentation,
  CfWorkspaceRef,
  CfSessionRuntimePreferencesResult,
} from "@origin-ai/cf-shared";
import type {
  ICfAgentService,
  CfAgentBackgroundBashOutputParams,
  CfAgentAppRuntimePreferences,
  CfAgentRuntimeLifecycleEvent,
  CfAgentAddPluginMarketplaceParams,
  CfAgentAppUsageParams,
  CfAgentCancelPluginOperationParams,
  CfAgentCompactParams,
  CfAgentConfigurePluginParams,
  CfAgentResetPluginConfigParams,
  CfAgentCreateSessionParams,
  CfAgentInstallPluginParams,
  CfAgentGenerateWorkspaceTextParams,
  CfAgentTestModelConnectivityParams,
  CfAgentGoalParams,
  CfAgentGrantWorkspaceHookTrustParams,
  CfAgentInitializeResult,
  CfAgentListSessionsParams,
  CfAgentListSessionSubagentsParams,
  CfAgentReadWorkspacePresentationParams,
  CfAgentReadSessionEventsParams,
  CfAgentReadSessionMessagesParams,
  CfAgentReadSessionParams,
  CfAgentRemovePluginMarketplaceParams,
  CfAgentRespondProviderRuntimeHeadersParams,
  CfAgentRespondSessionRuntimePreferencesParams,
  CfAgentResumeSessionParams,
  CfAgentSendPromptParams,
  CfAgentServiceEvent,
  CfAgentSessionSubscribeParams,
  CfAgentSessionTarget,
  CfAgentSessionRuntimePreferencesRequest,
  CfAgentTaskTokenUsageParams,
  CfAgentSetModeParams,
  CfAgentSetModelParams,
  CfAgentSetPluginEnabledParams,
  CfAgentSetThoughtLevelParams,
  CfAgentPluginReferenceCatalogParams,
  CfAgentSkillReferenceCatalogParams,
  CfAgentReadMcpResourceParams,
  CfAgentCallMcpToolForUiParams,
  CfAgentCancelMcpToolCallForUiParams,
  CfAgentReadMcpResourceForUiParams,
  CfAgentListMcpResourcesForUiParams,
  CfAgentAppToolCallForUiParams,
  CfAgentAppToolInstanceForUiParams,
  CfAgentRegisterAppToolsForUiParams,
  CfAgentResolveAppToolCallForUiParams,
  CfAgentMcpResourceSubscriptionForUiParams,
  CfAgentDeleteSavedWorkflowParams,
  CfAgentFindSavedWorkflowForRunParams,
  CfAgentGetSavedWorkflowParams,
  CfAgentListSavedWorkflowRunsParams,
  CfAgentListSavedWorkflowsParams,
  CfAgentMoveSavedWorkflowParams,
  CfAgentSaveSavedWorkflowFromRunParams,
  CfAgentSavedWorkflowTarget,
  CfAgentUpdateSavedWorkflowMetaParams,
  CfAgentResolveSuggestedPluginReferenceParams,
  CfAgentPluginViewParams,
  CfAgentUninstallPluginParams,
  CfAgentUpdatePluginParams,
  CfAgentRestoreBuiltinPluginParams,
  CfAgentUpdatePluginMarketplaceParams,
  CfAgentValidatePluginParams,
  CfAgentDescribePluginParams,
  CfAgentListMcpServerStatusesParams,
  CfAgentWorkspaceTarget,
  CfAgentCuaPermissionObservation,
  CfAgentCreateAutomationParams,
  CfAgentUpdateAutomationParams,
  CfAgentAutomationIdParams,
  CfAgentSetAutomationEnabledParams,
  CfAgentDeleteAutomationRunParams,
  CfAgentAttachmentBeginParams,
  CfAgentAttachmentChunkParams,
  CfAgentAttachmentReadParams,
  CfAgentConversationAttachmentReadParams,
  CfAgentConversationAttachmentStatParams,
  CfAgentAttachmentPreviewSourceParams,
  CfAgentAttachmentTerminalParams,
  CfAgentConversationCommandParams,
  CfAgentCommandsQueryParams,
  CfAgentConversationFileChangesParams,
  CfAgentConversationFileRewindPreviewParams,
  CfAgentConversationRowsRangeParams,
  CfAgentConversationPlansParams,
  CfAgentConversationWorkflowRunEventsParams,
  CfAgentConversationWorkflowRunArtifactDataParams,
  CfAgentConversationWorkflowRunArtifactReadParams,
  CfAgentConversationWorkflowRunArtifactsParams,
  CfAgentConversationWorkflowRunNodeResultParams,
  CfAgentConversationWorkflowRunWorkspaceParams,
  CfAgentConversationWorkflowRunsParams,
  CfAgentConversationResyncParams,
  CfAgentConversationSubscribeParams,
  CfAgentConversationUnsubscribeParams,
  CfAgentConnectionFlowParams,
  CfAgentSessionsIndexSubscribeParams,
  CfAgentWorkspaceConfigSubscribeParams,
} from "./cfAgent.js";
import {
  backgroundBashOutputResultSchema,
  v4BackgroundBashOutputParamsSchema,
  V4_WIRE_PROTOCOL_VERSION,
  PROTOCOL_V4_LIMITS,
  clientHelloSchema,
  commandAckSchema,
  commandPayloadSchemas,
  commandsQueryParamsSchema,
  commandsQueryResultSchema,
  conversationTopic,
  conversationTopicWireCandidateSchema,
  conversationTelemetryFactSchema,
  cuaPermissionObservationSchema,
  sessionsIndexTopic,
  sessionsIndexReconcileResultSchema,
  sessionsIndexTopicWireCandidateSchema,
  MAX_LEGACY_TASK_IDS_PER_SUBSCRIBE,
  V4_METHODS,
  V4_NOTIFICATIONS,
  v4AttachmentAbortResultSchema,
  v4AttachmentBeginResultSchema,
  v4AttachmentChunkResultSchema,
  v4AttachmentCommitResultSchema,
  v4AttachmentPreviewSourceParamsSchema,
  v4AttachmentPreviewSourceResultSchema,
  v4AttachmentReadParamsSchema,
  v4AttachmentReadResultSchema,
  v4ConversationAttachmentReadParamsSchema,
  v4ConversationAttachmentReadResultSchema,
  v4ConversationAttachmentStatParamsSchema,
  v4ConversationAttachmentStatResultSchema,
  v4ConnectionFlowResultSchema,
  v4ConversationFileChangesResultSchema,
  v4ConversationFileRewindPreviewResultSchema,
  v4ConversationRowsRangeResultSchema,
  v4ConversationPlansResultSchema,
  v4ConversationWorkflowRunEventsResultSchema,
  v4ConversationWorkflowRunArtifactDataResultSchema,
  v4ConversationWorkflowRunArtifactReadResultSchema,
  v4ConversationWorkflowRunArtifactsResultSchema,
  v4ConversationWorkflowRunNodeResultResultSchema,
  v4ConversationWorkflowRunWorkspaceResultSchema,
  v4ConversationWorkflowRunsResultSchema,
  v4ConversationResyncResultSchema,
  v4ConversationSubscribeResultSchema,
  v4ConversationUsageResultSchema,
  v4SessionsIndexSubscribeResultSchema,
  v4UsageStatsResultSchema,
  v4WorkspaceConfigSubscribeResultSchema,
  workspaceConfigTopic,
  workspaceConfigTopicWireCandidateSchema,
  utf8JsonByteLength,
  CF_ATTACHMENT_FAULT_CODES,
  CfAttachmentFaultError,
  type CommandAck,
  type ConversationTopicWireCandidate,
  type ConversationTelemetryFact,
  type SessionsIndexTopicWireCandidate,
  type WorkspaceConfigTopicWireCandidate,
  type CommandEnvelope,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  readTrustedCfAgentV4Connection,
  readTrustedCfAgentV4UnsubscribeRoute,
  type CfAgentV4ConnectionContext,
} from "./cfAgentConnectionScope.js";
import { createBackgroundSessionEventCoalescer } from "#src/cf-agent/cfSessionEventCoalescer.js";
import { AutomationService } from "#src/session/automationService.js";
import { AutomationRepo } from "#src/session/automationRepo.js";
import { TaskIndexRepo } from "#src/session/taskIndexRepo.js";
import { CfAgentMcpStatusModeUnsupportedError } from "#src/cf-agent/cfAgentErrors.js";
import { CfAgentProcessManager } from "./cfAgentProcessManager.js";
import type { CfAgentProcessManagerOptions } from "./cfAgentProcessManager.js";
import type { IOffPeakTaskService } from "#src/session/offPeakTask.js";
import {
  CfProtocolRequestTimeoutError,
  type CfProtocolClient,
} from "./cfProtocolClient.js";
import { getDataBaseDir } from "../paths.js";
import {
  collectBrowserAmbientContext,
  type BrowserAmbientContextExecutor,
} from "./cfAgentBrowserAmbientContext.js";
import {
  createCuaOperationTurnTracker,
  type CuaOperationWorkspaceTarget,
  type CuaOperationStateReporter,
} from "./cuaOperationTurnTracker.js";
import type { PipSessionEvent } from "@origin-ai/cf-cua/pip-session";
import { registerMemoryDiagnosticsProvider } from "#src/memoryDiagnostics.js";

import {
  cfMcpUiResourceSubscriptionResultSchema as mcpUiEmptyResultSchema,
  cfMcpUiCloseInstanceResultSchema,
  cfMcpUiOpenInstanceResultSchema,
} from "@origin-ai/cf-shared";
const logger = createServiceLogger("cf-agent-service");
const cuaOperationLogger = createServiceLogger("cua-operation-turn");
const PLUGIN_MANAGEMENT_WORKSPACE_DIR_NAME = "plugin-workspace";
const MCP_STATUS_WORKSPACE_DIR_NAME = "mcp-status-workspace";
const MCP_STATUS_LANE_IDLE_TIMEOUT_MS = 5 * 60_000;
const PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS = 5 * 60_000;

const CHILD_PROCESSES_REQUEST_TIMEOUT_MS = 800;
const PLUGIN_OPERATION_CANCEL_REQUEST_TIMEOUT_MS = 5_000;
const SESSION_COMPACT_REQUEST_TIMEOUT_MS = 5 * 60_000;

interface PendingPermissionRequest {
  client: CfProtocolClient;
  protocolRequestId: CfProtocolRequestId;
}

interface PendingProviderRuntimeHeadersRequest extends PendingPermissionRequest {
  request: CfProviderRuntimeHeadersRequestParams;
  responding?: boolean;
}

interface PendingSessionRuntimePreferencesRequest extends PendingPermissionRequest {
  workspace: CfAgentWorkspaceTarget;
  request: CfAgentSessionRuntimePreferencesRequest;
  timeout: ReturnType<typeof setTimeout>;
  workspaceKey: string;
}

type SessionCreateCompatField =
  | "persistence"
  | "thoughtLevel"
  | "mcpServers"
  | "toolAllowlist"
  | "toolDenylist"
  | "offPeakToolEnabled"
  | "dynamicWorkflowEnabled"
  | "dynamicWorkflowMode";
type SessionResumeCompatField =
  | "thoughtLevel"
  | "mcpServers"
  | "toolAllowlist"
  | "toolDenylist"
  | "offPeakToolEnabled"
  | "dynamicWorkflowEnabled"
  | "dynamicWorkflowMode";
type SessionSendCompatField =
  | "browserAmbientContext"
  | "automationId"
  | "offPeakTaskId"
  | "offPeakRunType"
  | "botDeliveryTarget"
  | "toolDenylist";

const SESSION_CREATE_OPTIONAL_COMPAT_FIELDS = new Set<SessionCreateCompatField>([
  "persistence",
  "thoughtLevel",
  "mcpServers",
  "toolAllowlist",
  "toolDenylist",
  "offPeakToolEnabled",
  "dynamicWorkflowEnabled",
  "dynamicWorkflowMode",
]);
const SESSION_RESUME_OPTIONAL_COMPAT_FIELDS = new Set<SessionResumeCompatField>([
  "thoughtLevel",
  "mcpServers",
  "toolAllowlist",
  "toolDenylist",
  "offPeakToolEnabled",
  "dynamicWorkflowEnabled",
  "dynamicWorkflowMode",
]);
const SESSION_SEND_OPTIONAL_COMPAT_FIELDS = new Set<SessionSendCompatField>([
  "browserAmbientContext",
  "automationId",
  "offPeakTaskId",
  "offPeakRunType",
  "botDeliveryTarget",
  "toolDenylist",
]);
const SESSION_SUBSCRIBE_RETRY_BASE_DELAY_MS = 500;
const SESSION_SUBSCRIBE_RETRY_MAX_DELAY_MS = 5_000;
const SESSION_SUBSCRIBE_MAX_ATTEMPTS = 8;
const MAX_TRACKED_SESSION_EVENT_IDS = 10_000;
const SSH_REMOTE_WORKSPACE_IDENTITY_PREFIX = "remote:ssh:";
const WSL_REMOTE_WORKSPACE_IDENTITY_PREFIX = "remote:wsl:";

export function supportsLegacyRemoteTaskAllowlist(workspaceIdentity: string | undefined): boolean {
  return Boolean(
    workspaceIdentity?.startsWith(SSH_REMOTE_WORKSPACE_IDENTITY_PREFIX) ||
    workspaceIdentity?.startsWith(WSL_REMOTE_WORKSPACE_IDENTITY_PREFIX),
  );
}

function isClosedStdioTransportError(error: unknown): boolean {
  return error instanceof Error && error.message === "CodeFusion agent stdio transport is closed";
}

interface SessionEventSequenceState {
  assignedSeqByEventId: Map<string, number>;
  assignedSeqEventIds: string[];
  liveEventIds: Set<string>;
  liveEventIdOrder: string[];
  lastAssignedSeq: number;
}

function isProtocolMethodNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === -32601
  );
}

function buildWorkspaceRef(params: CfAgentWorkspaceTarget): CfWorkspaceRef {
  return {
    workspacePath: params.workspacePath,
    workspaceIdentity: params.workspaceIdentity,
    remoteSessionId: params.remoteSessionId,
    workspaceKey: resolveWorkspaceKey(params),
  };
}

function savedWorkflowTargetHasWorkspace(
  params: CfAgentSavedWorkflowTarget,
): params is CfAgentWorkspaceTarget & { scope?: CfSavedWorkflowScope } {
  return typeof (params as Partial<CfAgentWorkspaceTarget>).workspacePath === "string";
}

function savedWorkflowScopeParam(params: CfAgentSavedWorkflowTarget): {
  scope?: CfSavedWorkflowScope;
} {
  return params.scope === undefined ? {} : { scope: params.scope };
}

function ensurePluginManagementWorkspacePath(): string {
  const workspacePath = join(getDataBaseDir(), ".cf", PLUGIN_MANAGEMENT_WORKSPACE_DIR_NAME);
  mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}

function ensureMcpStatusWorkspacePath(): string {
  const workspacePath = join(getDataBaseDir(), ".cf", MCP_STATUS_WORKSPACE_DIR_NAME);
  mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}

// NOTE: this counts ONLY the per-session MCP servers passed through the CodeFusion Protocol
// session/create params (the app→protocol channel). It is deliberately independent of the
// CLI/bootstrap MCP servers configured in ~/.cf/cli/config.json (mcp.servers), which the agent
// runtime connects separately and reports via the `mcp.server.connected`/toolCount events. So a
// createSession log line with mcpServerCount:0 is EXPECTED when cf-cua is a CLI-config MCP server
// (e.g. the product Helper broker path injected through the gated bootstrap env): the model still receives those
// tools — the two numbers describe different channels, not a missing tool set. Verified on-machine:
// real kimi-k2.6 turns call mcp__cf-cua__* tools (get_app_state/type/open_application, status
// completed) in sessions whose createSession logged mcpServerCount:0.
function getMcpServerCount(params: { mcpServers?: readonly unknown[] }): number {
  return params.mcpServers?.length ?? 0;
}

function getMcpServerNames(params: { mcpServers?: readonly { name: string }[] }): string[] {
  return params.mcpServers?.map((server) => server.name) ?? [];
}

function parseInvalidParamsIssues(error: unknown): unknown[] {
  const errorLike = error as {
    code?: unknown;
    data?: unknown;
    message?: unknown;
  };
  const message = errorLike.message;
  if (
    errorLike.code !== -32602 ||
    typeof message !== "string" ||
    (message !== "Invalid params" && !message.startsWith("Invalid params — "))
  ) {
    return [];
  }
  const data = errorLike.data;
  if (!data || typeof data !== "object") {
    return [];
  }
  const serializedIssues = (data as { message?: unknown }).message;
  if (typeof serializedIssues !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(serializedIssues) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getUnrecognizedTopLevelKeys(error: unknown): string[] {
  const keys = new Set<string>();
  for (const issue of parseInvalidParamsIssues(error)) {
    if (!issue || typeof issue !== "object") {
      continue;
    }
    const issueLike = issue as {
      code?: unknown;
      keys?: unknown;
      path?: unknown;
    };
    if (
      issueLike.code !== "unrecognized_keys" ||
      (Array.isArray(issueLike.path) && issueLike.path.length > 0) ||
      !Array.isArray(issueLike.keys)
    ) {
      continue;
    }
    for (const key of issueLike.keys) {
      if (typeof key === "string") {
        keys.add(key);
      }
    }
  }
  return [...keys];
}

function getSessionCreateCompatFields(error: unknown): SessionCreateCompatField[] {
  const keys = getUnrecognizedTopLevelKeys(error);
  if (keys.length === 0) {
    return [];
  }
  if (
    !keys.every((key): key is SessionCreateCompatField =>
      SESSION_CREATE_OPTIONAL_COMPAT_FIELDS.has(key as SessionCreateCompatField),
    )
  ) {
    return [];
  }
  return keys;
}

function getSessionResumeCompatFields(error: unknown): SessionResumeCompatField[] {
  const keys = getUnrecognizedTopLevelKeys(error);
  if (keys.length === 0) {
    return [];
  }
  if (
    !keys.every((key): key is SessionResumeCompatField =>
      SESSION_RESUME_OPTIONAL_COMPAT_FIELDS.has(key as SessionResumeCompatField),
    )
  ) {
    return [];
  }
  return keys;
}

function getSessionSendCompatFields(error: unknown): SessionSendCompatField[] {
  const keys = getUnrecognizedTopLevelKeys(error);
  if (keys.length === 0) {
    return [];
  }
  if (
    !keys.every((key): key is SessionSendCompatField =>
      SESSION_SEND_OPTIONAL_COMPAT_FIELDS.has(key as SessionSendCompatField),
    )
  ) {
    return [];
  }
  return keys;
}

function isProtocolRequestTimeout(error: unknown, method: string): boolean {
  if (error instanceof CfProtocolRequestTimeoutError) {
    return error.method === method;
  }
  return error instanceof Error && error.message === `CodeFusion Protocol request timed out: ${method}`;
}

function assertV4AttachmentNdjsonEnvelope(method: string, params: unknown): void {
  const bytes = utf8JsonByteLength({ id: "9".repeat(32), method, params }) + 1; // NDJSON newline
  if (bytes > PROTOCOL_V4_LIMITS.maxFrameBytes) {
    throw new Error("proto.frameTooLarge");
  }
}

function buildSessionCreateParams(
  params: CfAgentCreateSessionParams & {
    offPeakToolEnabled?: boolean;
    dynamicWorkflowEnabled?: boolean;
    dynamicWorkflowMode?: DynamicWorkflowMode;
  },
  omittedFields: ReadonlySet<SessionCreateCompatField> = new Set(),
) {
  return {
    sessionId: params.sessionId,
    additionalDirectories: params.additionalDirectories,
    workspace: buildWorkspaceRef(params),
    parentSessionId: params.parentSessionId,
    mode: params.mode,
    model: params.model,
    ...(params.persistence !== undefined && !omittedFields.has("persistence")
      ? { persistence: params.persistence }
      : {}),
    ...(params.thoughtLevel !== undefined && !omittedFields.has("thoughtLevel")
      ? { thoughtLevel: params.thoughtLevel }
      : {}),
    ...(params.titleGenerationEnabled !== undefined
      ? { titleGenerationEnabled: params.titleGenerationEnabled }
      : {}),
    ...(params.mcpServers !== undefined && !omittedFields.has("mcpServers")
      ? { mcpServers: params.mcpServers }
      : {}),
    ...(params.toolAllowlist !== undefined && !omittedFields.has("toolAllowlist")
      ? { toolAllowlist: params.toolAllowlist }
      : {}),
    ...(params.toolDenylist !== undefined && !omittedFields.has("toolDenylist")
      ? { toolDenylist: params.toolDenylist }
      : {}),
    ...(params.importedHistory !== undefined ? { importedHistory: params.importedHistory } : {}),
    ...(params.offPeakToolEnabled === true && !omittedFields.has("offPeakToolEnabled")
      ? { offPeakToolEnabled: true }
      : {}),
    ...(params.dynamicWorkflowEnabled === true && !omittedFields.has("dynamicWorkflowEnabled")
      ? { dynamicWorkflowEnabled: true }
      : {}),
    ...buildDynamicWorkflowModeField(params, omittedFields),
  };
}

function buildDynamicWorkflowModeField(
  params: { dynamicWorkflowEnabled?: boolean; dynamicWorkflowMode?: DynamicWorkflowMode },
  omittedFields: ReadonlySet<SessionCreateCompatField | SessionResumeCompatField>,
): { dynamicWorkflowMode?: DynamicWorkflowMode } {
  return params.dynamicWorkflowEnabled === true &&
    params.dynamicWorkflowMode !== undefined &&
    !omittedFields.has("dynamicWorkflowEnabled") &&
    !omittedFields.has("dynamicWorkflowMode")
    ? { dynamicWorkflowMode: params.dynamicWorkflowMode }
    : {};
}

function buildSessionResumeParams(
  params: CfAgentResumeSessionParams & {
    offPeakToolEnabled?: boolean;
    dynamicWorkflowEnabled?: boolean;
    dynamicWorkflowMode?: DynamicWorkflowMode;
  },
  omittedFields: ReadonlySet<SessionResumeCompatField> = new Set(),
) {
  return {
    sessionId: params.sessionId,
    additionalDirectories: params.additionalDirectories,
    workspace: buildWorkspaceRef(params),
    ...(params.thoughtLevel !== undefined && !omittedFields.has("thoughtLevel")
      ? { thoughtLevel: params.thoughtLevel }
      : {}),
    ...(params.mcpServers !== undefined && !omittedFields.has("mcpServers")
      ? { mcpServers: params.mcpServers }
      : {}),
    ...(params.toolAllowlist !== undefined && !omittedFields.has("toolAllowlist")
      ? { toolAllowlist: params.toolAllowlist }
      : {}),
    ...(params.toolDenylist !== undefined && !omittedFields.has("toolDenylist")
      ? { toolDenylist: params.toolDenylist }
      : {}),
    ...(params.offPeakToolEnabled === true && !omittedFields.has("offPeakToolEnabled")
      ? { offPeakToolEnabled: true }
      : {}),
    ...(params.dynamicWorkflowEnabled === true && !omittedFields.has("dynamicWorkflowEnabled")
      ? { dynamicWorkflowEnabled: true }
      : {}),
    ...buildDynamicWorkflowModeField(params, omittedFields),
  };
}

function buildSessionSendParams(
  params: CfAgentSendPromptParams,
  omittedFields: ReadonlySet<SessionSendCompatField> = new Set(),
) {
  return {
    sessionId: params.sessionId,
    ...(params.modelSelection ? { modelSelection: params.modelSelection } : {}),
    ...(params.modelExecution ? { modelExecution: params.modelExecution } : {}),
    inputId: params.inputId,
    queryId: params.queryId,
    content: params.content,
    attachments: params.attachments,
    ...(params.browserAmbientContext !== undefined && !omittedFields.has("browserAmbientContext")
      ? { browserAmbientContext: params.browserAmbientContext }
      : {}),
    expectedRevision: params.expectedRevision,
    expectedProviderRevision: params.expectedProviderRevision,
    ...(params.automationId !== undefined && !omittedFields.has("automationId")
      ? { automationId: params.automationId }
      : {}),
    ...(params.offPeakTaskId !== undefined && !omittedFields.has("offPeakTaskId")
      ? { offPeakTaskId: params.offPeakTaskId }
      : {}),
    ...(params.offPeakRunType !== undefined && !omittedFields.has("offPeakRunType")
      ? { offPeakRunType: params.offPeakRunType }
      : {}),
    ...(params.botDeliveryTarget !== undefined && !omittedFields.has("botDeliveryTarget")
      ? { botDeliveryTarget: params.botDeliveryTarget }
      : {}),
    ...(params.toolDenylist !== undefined && !omittedFields.has("toolDenylist")
      ? { toolDenylist: params.toolDenylist }
      : {}),
  };
}

function buildSessionCompactParams(params: CfAgentCompactParams) {
  return {
    sessionId: params.sessionId,
    inputId: params.inputId,
    instructions: params.instructions,
    expectedRevision: params.expectedRevision,
  };
}

function formatModelSelectionForLog(ref: ModelSelection | undefined): string | null {
  if (!ref) {
    return null;
  }

  const base = `${ref.providerId}/${ref.modelId}`;
  const reasoningLevel = ref.options?.reasoningLevel;
  return reasoningLevel ? `${base}${CF_MODEL_REASONING_SEPARATOR}${reasoningLevel}` : base;
}

function sessionEventKey(params: CfAgentSessionTarget): string {
  return `${resolveWorkspaceKey(params)}\u0000${params.sessionId}`;
}

function rememberBoundedEventId(ids: Set<string>, order: string[], eventId: string): boolean {
  if (ids.has(eventId)) {
    return false;
  }
  ids.add(eventId);
  order.push(eventId);
  while (order.length > MAX_TRACKED_SESSION_EVENT_IDS) {
    const removed = order.shift();
    if (removed) {
      ids.delete(removed);
    }
  }
  return true;
}

function permissionRequestKey(params: CfAgentSessionTarget & { requestId: string }): string {
  return `${sessionEventKey(params)}\u0000${params.requestId}`;
}

function userInputRequestKey(params: CfAgentSessionTarget & { requestId: string }): string {
  return `${sessionEventKey(params)}\u0000${params.requestId}`;
}

function providerRuntimeHeadersRequestKey(
  params: CfAgentSessionTarget & { requestId: string },
): string {
  return `${sessionEventKey(params)}\u0000${params.requestId}`;
}

interface ModelSelectionReadinessSource {
  getView(): Promise<ModelSelectionView>;
  onDidChange?: (listener: (view: ModelSelectionView) => void) => IDisposable;
}

interface CfAgentProviderReadinessSnapshot {
  readonly providerCount: number;
  readonly revision: string;
  readonly readiness: {
    readonly ready: boolean;
    readonly providerId?: string;
    readonly modelId?: string;
  };
}

function createProviderReadinessSnapshotFromSelectionView(
  view: ModelSelectionView,
): CfAgentProviderReadinessSnapshot {
  for (const provider of view.providers) {
    const model = provider.models[0];
    if (!model) continue;
    return {
      providerCount: view.providers.length,
      revision: `model-selection:${view.revision}`,
      readiness: {
        ready: true,
        providerId: provider.providerId,
        modelId: model.modelId,
      },
    };
  }
  return {
    providerCount: view.providers.length,
    revision: `model-selection:${view.revision}`,
    readiness: { ready: false },
  };
}

interface WaitingWorkspaceStartup {
  cancelled: boolean;
  lastLoggedRevision?: string;
  starting?: Promise<CfProtocolClient>;
  workspace: CfAgentWorkspaceTarget;
}

interface ActiveWorkspaceClient {
  client: CfProtocolClient;
  interactionPreferencesReady?: Promise<void>;
  
  modelExecutionEnabled: boolean;
  workspace: CfAgentWorkspaceTarget;
  
  dynamicWorkflowPolicyMode: DynamicWorkflowMode;
}

function requiresProviderRegistryRefresh(commandType: string): boolean {
  switch (commandType) {
    case "createSession":
    case "createSelectionSideSession":
    case "sendText":
    case "sendGoalCommand":
    case "compact":
    case "forkAssistant":
    case "editUserQuery":
    case "retryTurn":
    case "sendQueuedNow":
    case "switchModelConfig":
      return true;
    default:
      return false;
  }
}

function createRuntimeUnavailableError(params: CfAgentWorkspaceTarget): Error & {
  code: typeof CF_AGENT_RUNTIME_UNAVAILABLE_CODE;
  workspaceKey: string;
} {
  const error = new Error("CodeFusion Agent runtime is not running.") as Error & {
    code: typeof CF_AGENT_RUNTIME_UNAVAILABLE_CODE;
    workspaceKey: string;
  };
  error.code = CF_AGENT_RUNTIME_UNAVAILABLE_CODE;
  error.workspaceKey = resolveWorkspaceKey(params);
  return error;
}

interface CreateCfAgentServiceOptions extends Omit<
  CfAgentProcessManagerOptions,
  "idleTimeoutMs"
> {
  
  mcpStatusIdleTimeoutMs?: number;
  accountProviderConfigSource?: ProviderSource<AccountProviderConfigSnapshot>;
  accountRequestAuthService?: IAccountRequestAuthService;
  
  authorizeLocalMediaPreviewPath?: (path: string) => Promise<string>;
  modelSelectionReadinessSource?: ModelSelectionReadinessSource;
  readSubagentRuntimeConfig?: (workspace: {
    workspacePath: string;
    workspaceIdentity?: string;
  }) => Promise<SubagentRuntimeConfig>;
  sessionRuntimePreferencesAuthority?: "local" | "external";
  prepareProjectExecution?: (
    projectId: string,
  ) => Promise<import("@origin-ai/cf-shared").ProjectExecutionSnapshot>;
  prepareSessionCreation?: (
    target: CfAgentSessionTarget & {
      projectId: string | null;
      additionalDirectories?: string[];
    },
  ) => Promise<string[]>;
  resolveSessionDirectories?: (target: CfAgentSessionTarget) => Promise<string[]>;
  resolveSessionRuntimePreferences?: (
    scope: CfSessionRuntimePreferencesScope,
  ) => Promise<CfSessionRuntimePreferencesResult>;
  
  onAutomationManualRunRequested?: (params: {
    automation: CfAutomation;
    run: CfAutomationRun;
  }) => Promise<void>;
  
  resolveOffPeakClientConfig?: () => Promise<OffPeakClientConfig | undefined>;
  
  resolveDynamicWorkflowClientConfig?: () => Promise<DynamicWorkflowClientConfig | undefined>;
  
  resolveDynamicWorkflowUserMode?: () => Promise<DynamicWorkflowMode | undefined>;
  
  forwardDynamicWorkflowUserMode?: (mode: DynamicWorkflowMode | undefined) => void;
  resolveOffPeakTaskService?: () =>
    | Pick<IOffPeakTaskService, "createTask" | "list" | "getCodingPlanSupport">
    | undefined;
  
  browserControlExecutor?: BrowserAmbientContextExecutor;
  channelReplyExecutor?: (request: ChannelReplyHostRequest) => Promise<ChannelReplyResult>;
  topicResourceExecutor?: (
    request: CfTopicResourceReadParams &
      CfAgentWorkspaceTarget & { trace?: CfProtocolTrace },
    signal: AbortSignal,
  ) => Promise<CfPromptAttachment>;
  topicResourceValidator?: (
    request: CfTopicResourceReadParams &
      CfAgentWorkspaceTarget & { trace?: CfProtocolTrace },
    signal: AbortSignal,
  ) => Promise<void>;
  
  officialMcpAuthHeadersResolver?: {
    resolveHeaders(request: {
      mcpKey: string;
      pluginId: string;
      targetOrigin: string;
      workspace: { workspaceIdentity?: string; workspaceKey: string; workspacePath: string };
    }): Promise<
      | { ok: true; headers: Record<string, string> }
      | { ok: false; reason: "official_auth_unavailable" | "official_auth_plan_required" }
    >;
  };
  
  officialMcpTrustedOrigins?: {
    isTrusted(input: { pluginId: string; mcpKey: string; origin: string }): Promise<{
      detail?: string;
      trusted: boolean;
    }>;
  };
  
  cuaOperationStateReporter?: CuaOperationStateReporter;
  onCuaPipSessionLifecycle?: (
    workspace: CuaOperationWorkspaceTarget,
    event: Exclude<PipSessionEvent, { kind: "focus-changed" }>,
  ) => void;
}

function toProtocolAutomation(automation: CfAutomation) {
  return {
    automationId: automation.automationId,
    title: automation.title,
    cronExpr: automation.cronExpr,
    prompt: automation.prompt,
    modelSelection: automation.modelSelection,
    mode: automation.mode,
    targetTaskId: automation.targetTaskId,
    enabled: automation.enabled,
    lifecycleStatus: automation.lifecycleStatus,
    nextRunAt: automation.nextRunAt,
    lastRunAt: automation.lastRunAt,
    runCount: automation.runCount,
    recurring: automation.recurring,
    maxRuns: automation.maxRuns,
    scheduleRule: automation.scheduleRule,
  };
}

export function toProtocolOffPeakTaskSnapshot(task: {
  offPeakTaskId: string;
  title: string;
  status: "queued" | "paused" | "running" | "completed" | "failed" | "cancelled";
  queuePosition?: number;
  sessionId?: string;
  createdAt: number;
}) {
  return {
    offPeakTaskId: task.offPeakTaskId,
    title: task.title,
    status: task.status,
    ...(typeof task.queuePosition === "number" && task.queuePosition > 0
      ? { queuePosition: task.queuePosition }
      : {}),
    ...(task.sessionId ? { sessionId: task.sessionId } : {}),
    createdAt: task.createdAt,
  };
}

export const OFF_PEAK_INTERNAL_ERROR_CODE = "offpeak_internal_error";
export const OFF_PEAK_INTERNAL_ERROR_MESSAGE = "Internal off-peak service error";

async function respondOffPeakInternalError(
  client: Pick<CfProtocolClient, "respondError">,
  request: { id: CfProtocolRequestId; method: string },
  workspace: CfAgentWorkspaceTarget,
  error: unknown,
): Promise<void> {
  logger.warn(undefined, "Failed to process Off-peak protocol request", {
    method: request.method,
    workspaceKey: resolveWorkspaceKey(workspace),
    errorName: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  });
  await client.respondError(request.id, {
    code: -32603,
    message: OFF_PEAK_INTERNAL_ERROR_MESSAGE,
    data: { errorCode: OFF_PEAK_INTERNAL_ERROR_CODE },
  });
}

export function resolveOffPeakAllowedModels(
  grayConfig: OffPeakClientConfig | undefined,
  providerId?: string,
): readonly string[] {
  if (grayConfig?.enabled !== true) return [];
  return grayConfig.modelSelectionView.providers
    .filter((provider) => providerId === undefined || provider.providerId === providerId)
    .flatMap((provider) => provider.models.map((model) => model.modelId));
}

export function resolveOffPeakCreateModel(
  allowedModels: readonly string[],
  requested: string | undefined,
): string | null {
  const wanted = requested?.trim();
  if (!wanted) return allowedModels[allowedModels.length - 1] ?? null;
  const lower = wanted.toLowerCase();
  return allowedModels.find((model) => model.trim().toLowerCase() === lower) ?? null;
}

export function resolveOffPeakToolSelection(
  view: ModelSelectionView,
  providerId: string,
  modelId: string,
  thoughtLevel?: string,
): ModelSelection | undefined {
  const selection = completeNewModelSelection(view, { providerId, modelId });
  if (!selection) return undefined;
  return thoughtLevel === undefined
    ? selection
    : { ...selection, options: { reasoningLevel: thoughtLevel } };
}
export function createCfAgentService(
  options?: CreateCfAgentServiceOptions,
): ICfAgentService & { disposeAllAndWait(): Promise<void> } {
  const processManager = new CfAgentProcessManager(options);
  const cuaOperationTurnTracker =
    options?.cuaOperationStateReporter || options?.onCuaPipSessionLifecycle
      ? createCuaOperationTurnTracker({
          ...(options?.cuaOperationStateReporter
            ? { reporter: options.cuaOperationStateReporter }
            : {}),
          ...(options?.onCuaPipSessionLifecycle
            ? { onPipSessionLifecycle: options.onCuaPipSessionLifecycle }
            : {}),
          logger: {
            debug: (message) => cuaOperationLogger.debug(undefined, message),
            info: (message) => cuaOperationLogger.info(undefined, message),
            warn: (message) => cuaOperationLogger.warn(undefined, message),
          },
        })
      : undefined;
  const automationRepo = new AutomationRepo();
  const automationService = new AutomationService(automationRepo, options?.prepareProjectExecution);
  const automationTaskIndexRepo = new TaskIndexRepo();
  const pluginProcessManager = new CfAgentProcessManager({
    commandResolver: options?.commandResolver,
    presentationSurface: options?.presentationSurface,
    requestTimeoutMs: options?.requestTimeoutMs,
    resolveSpawnEnv: options?.resolveSpawnEnv,
    waitForSpawnAdmission: options?.waitForSpawnAdmission,
  });
  const mcpStatusProcessManager = new CfAgentProcessManager({
    commandResolver: options?.commandResolver,
    presentationSurface: options?.presentationSurface,
    processLifecycleReporter: options?.processLifecycleReporter,
    requestTimeoutMs: options?.requestTimeoutMs,
    resolveSpawnEnv: options?.resolveSpawnEnv,
    waitForSpawnAdmission: options?.waitForSpawnAdmission,
    lane: "mcp-status",
    idleTimeoutMs: options?.mcpStatusIdleTimeoutMs ?? MCP_STATUS_LANE_IDLE_TIMEOUT_MS,
  });
  const sessionEmitters = new Map<string, Emitter<CfAgentServiceEvent>>();
  
  const officialMcpIssuanceAudit = createOfficialMcpIssuanceAudit();
  const providerRuntimeHeadersWorkspaceEmitters = new Map<
    string,
    Emitter<CfProviderRuntimeHeadersRequestParams>
  >();
  const providerRuntimeHeadersCancelledEmitters = new Map<
    string,
    Emitter<CfProviderRuntimeHeadersCancelled>
  >();
  function cancelProviderRuntimeHeaders(
    key: string,
    pending: PendingProviderRuntimeHeadersRequest,
  ): void {
    pendingProviderRuntimeHeaders.delete(key);
    const { requestId, sessionId, workspace } = pending.request;
    providerRuntimeHeadersCancelledEmitters
      .get(resolveWorkspaceKey(workspace))
      ?.fire({ requestId, sessionId, workspace });
    logger.info(undefined, "Request validation cancelled", {
      requestId,
      sessionId,
      workspaceKey: resolveWorkspaceKey(workspace),
    });
  }
  const sessionRuntimePreferencesRequestEmitter =
    new Emitter<CfAgentSessionRuntimePreferencesRequest>();
  const processResourceSampleEmitter = new Emitter<AgentLaneResourceSample>();
  const toolExecResourceEmitter = new Emitter<CfToolExecResource>();
  const mcpResourceSamplesEmitter = new Emitter<CfMcpResourceSample[]>();
  const mcpTelemetryEmitter = new Emitter<CfMcpTelemetryEvent>();
  const pluginOperationProgressEmitters = new Map<
    string,
    Emitter<CfPluginOperationProgressNotification>
  >();
  const conversationFrameEmitters = new Map<string, Emitter<ConversationTopicWireCandidate>>();
  const localTtftFactsEmitter = new Emitter<{ workspaceKey: string; facts: LocalTtftFacts }>();
  const conversationTelemetryFactEmitters = new Map<string, Emitter<ConversationTelemetryFact>>();
  const offPeakLifecycleEmitters = new Map<string, Emitter<OffPeakLifecycleNotification>>();
  const pluginUiToolResultEmitter = new Emitter<
    PluginUiToolResultNotification & CfAgentWorkspaceTarget
  >();
  const cuaPermissionObservationEmitter = new Emitter<CfAgentCuaPermissionObservation>();
  const sessionsIndexFrameEmitters = new Map<string, Emitter<SessionsIndexTopicWireCandidate>>();
  const workspaceConfigFrameEmitters = new Map<
    string,
    Emitter<WorkspaceConfigTopicWireCandidate>
  >();
  const v4ConnectionId = `host-${randomUUID()}`;
  interface V4SubscriptionRoute {
    workspaceKey: string;
    topic: string;
    subscriptionId: string;
    connectionId: string;
  }
  const v4SubscriptionRoutes = new Map<string, V4SubscriptionRoute>();
  const v4RouteKeyByOwnership = new Map<string, string>();
  const v4RouteRuntimeRestartDisposable = processManager.onRuntimeRestarted(({ workspaceKey }) => {
    clearV4SubscriptionRoutes(workspaceKey);
    cuaOperationTurnTracker?.clearWorkspaceKey(workspaceKey);
  });
  const sessionEventSequenceStates = new Map<string, SessionEventSequenceState>();
  const wiredClients = new WeakSet<CfProtocolClient>();
  const clientDisposables = new WeakMap<CfProtocolClient, IDisposable[]>();
  const pendingPermissions = new Map<string, PendingPermissionRequest>();
  const pendingUserInputs = new Map<string, PendingPermissionRequest>();
  const memoryDiagnostics = registerMemoryDiagnosticsProvider("agent", () => ({
    sessionEmitters: sessionEmitters.size,
    seqStates: sessionEventSequenceStates.size,
    pendingPermissions: pendingPermissions.size,
    pendingUserInputs: pendingUserInputs.size,
  }));
  const pendingProviderRuntimeHeaders = new Map<string, PendingProviderRuntimeHeadersRequest>();
  const pendingSessionRuntimePreferences = new Map<
    string,
    PendingSessionRuntimePreferencesRequest
  >();
  const activeClientsByWorkspaceKey = new Map<string, ActiveWorkspaceClient>();
  const interactionPreferenceSyncByWorkspaceKey = new Map<string, Promise<void>>();
  let latestAppRuntimePreferences: CfAgentAppRuntimePreferences | undefined;
  
  let dynamicWorkflowOffer: Promise<DynamicWorkflowClientConfig | undefined> | undefined;
  
  let pushedDynamicWorkflowUserMode: DynamicWorkflowMode | undefined;
  
  const dynamicWorkflowPolicySyncByWorkspaceKey = new Map<string, Promise<void>>();
  const waitingWorkspaceStartups = new Map<string, WaitingWorkspaceStartup>();
  function cancelWaitingWorkspaceStartup(workspaceKey: string): void {
    const waiting = waitingWorkspaceStartups.get(workspaceKey);
    if (waiting) {
      waiting.cancelled = true;
      waitingWorkspaceStartups.delete(workspaceKey);
    }
  }
  function cancelAllWaitingWorkspaceStartups(): void {
    for (const waiting of waitingWorkspaceStartups.values()) {
      waiting.cancelled = true;
    }
    waitingWorkspaceStartups.clear();
  }
  const accountConfigSyncByClient = new WeakMap<CfProtocolClient, Promise<void>>();
  const accountConfigReceivedRevisionByClient = new WeakMap<CfProtocolClient, string>();
  const sessionTraceIdBySessionKey = new Map<string, TraceId>();
  const accountRequestAuthService = options?.accountRequestAuthService;
  const accountProviderConfigSource = options?.accountProviderConfigSource;
  const modelSelectionReadinessSource = options?.modelSelectionReadinessSource;
  const sessionRuntimePreferencesAuthority = options?.sessionRuntimePreferencesAuthority ?? "local";
  const resolveSessionRuntimePreferences = options?.resolveSessionRuntimePreferences;

  function invalidateWorkspaceClient(workspaceKey: string, client: CfProtocolClient): void {
    for (const [key, pending] of pendingPermissions) {
      if (pending.client === client) {
        pendingPermissions.delete(key);
      }
    }
    for (const [key, pending] of pendingUserInputs) {
      if (pending.client === client) {
        pendingUserInputs.delete(key);
      }
    }
    for (const [key, pending] of pendingProviderRuntimeHeaders) {
      if (pending.client === client) {
        cancelProviderRuntimeHeaders(key, pending);
      }
    }
    for (const [key, pending] of pendingSessionRuntimePreferences) {
      if (pending.client === client) {
        clearTimeout(pending.timeout);
        pendingSessionRuntimePreferences.delete(key);
      }
    }
    for (const disposable of clientDisposables.get(client) ?? []) {
      disposable.dispose();
    }
    clientDisposables.delete(client);

    const active = activeClientsByWorkspaceKey.get(workspaceKey);
    if (active?.client !== client) {
      return;
    }
    activeClientsByWorkspaceKey.delete(workspaceKey);
    interactionPreferenceSyncByWorkspaceKey.delete(workspaceKey);
  }

  const runtimeLifecycleDisposable = processManager.onRuntimeLifecycle((event) => {
    if (event.state !== "unavailable") return;
    cuaOperationTurnTracker?.clearWorkspaceKey(event.workspaceKey);
    const active = activeClientsByWorkspaceKey.get(event.workspaceKey);
    if (!active) return;
    invalidateWorkspaceClient(event.workspaceKey, active.client);
  });

  async function resolveAccountRequestAuth(
    request: CfProviderRuntimeHeadersRequestParams,
  ): Promise<AccountRequestAuthMaterial | undefined> {
    if (!request.accountAccess || !accountRequestAuthService) {
      return undefined;
    }
    return accountRequestAuthService.resolveCurrent({
      providerId: request.providerId,
      modelId: request.modelSelection.modelId,
      accountAccess: request.accountAccess,
      expectedAccountScope: request.expectedAccountScope,
      rejectedProjectTokenFingerprint: request.rejectedProjectTokenFingerprint,
      reason: request.reason,
    });
  }

  async function respondAccountRequestAuthWithoutInteraction(params: {
    key: string;
    pending: PendingProviderRuntimeHeadersRequest;
  }): Promise<void> {
    params.pending.responding = true;
    try {
      const requestAuth = await resolveAccountRequestAuth(params.pending.request);
      if (pendingProviderRuntimeHeaders.get(params.key) !== params.pending) return;
      if (!requestAuth) {
        throw new Error("Account request auth resolver returned no material");
      }
      await params.pending.client.respond(params.pending.protocolRequestId, {
        headersApplied: true,
        requestAuth,
      });
      logger.info(undefined, "CodeFusion provider runtime headers applied", {
        modelId: params.pending.request.modelSelection.modelId,
        providerId: params.pending.request.providerId,
        requestId: params.pending.request.requestId,
        sessionId: params.pending.request.sessionId,
        workspaceKey: resolveWorkspaceKey(params.pending.request.workspace),
      });
    } catch (error) {
      if (pendingProviderRuntimeHeaders.get(params.key) !== params.pending) return;
      logger.warn(undefined, "Failed to apply CodeFusion provider runtime headers", {
        modelId: params.pending.request.modelSelection.modelId,
        providerId: params.pending.request.providerId,
        requestId: params.pending.request.requestId,
        sessionId: params.pending.request.sessionId,
        error: error instanceof Error ? error.message : String(error),
        workspaceKey: resolveWorkspaceKey(params.pending.request.workspace),
      });
      await params.pending.client.respond(params.pending.protocolRequestId, {
        headersApplied: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (pendingProviderRuntimeHeaders.get(params.key) === params.pending) {
        pendingProviderRuntimeHeaders.delete(params.key);
      }
    }
  }

  function takePendingSessionRuntimePreferences(
    requestId: string,
  ): PendingSessionRuntimePreferencesRequest | undefined {
    const pending = pendingSessionRuntimePreferences.get(requestId);
    if (!pending) {
      return undefined;
    }
    pendingSessionRuntimePreferences.delete(requestId);
    clearTimeout(pending.timeout);
    return pending;
  }

  function expireSessionRuntimePreferencesRequest(requestId: string): void {
    const pending = takePendingSessionRuntimePreferences(requestId);
    if (!pending) {
      return;
    }
    logger.warn(undefined, "Timed out waiting for Host response to runtime preference request", {
      event: "cf_agent.runtime_preferences.host_response_timeout",
      module: "services.cf_agent",
      requestId,
      scope: pending.request.scope,
      sessionId: pending.request.sessionId,
      timeoutMs: CF_SESSION_RUNTIME_PREFERENCES_REQUEST_TIMEOUT_MS,
      workspaceKey: pending.workspaceKey,
    });
    void pending.client
      .respondError(pending.protocolRequestId, {
        code: -32022,
        message: "Session runtime preferences request timed out",
        data: {
          timeoutMs: CF_SESSION_RUNTIME_PREFERENCES_REQUEST_TIMEOUT_MS,
        },
      })
      .catch((error: unknown) => {
        logger.debug(undefined, "Failed to send runtime preference timeout response", {
          error: error instanceof Error ? error.message : String(error),
          requestId,
          scope: pending.request.scope,
          sessionId: pending.request.sessionId,
        });
      });
  }

  let modelSelectionSubscription = modelSelectionReadinessSource?.onDidChange?.((view) => {
    void handleProviderReadinessChanged({
      reason: "model_selection_changed",
      snapshot: createProviderReadinessSnapshotFromSelectionView(view),
    }).catch((error) => {
      logger.warn(undefined, "Failed to hot-sync model selection readiness", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });
  let accountProviderConfigUnsubscribe = accountProviderConfigSource?.onDidChange((reason) => {
    void handleAccountProviderConfigChanged(reason).catch((error) => {
      logger.warn(undefined, "Failed to hot-sync account provider config", {
        message: error instanceof Error ? error.message : String(error),
        reason,
      });
    });
  });

  async function syncAccountProviderConfigToClient(params: {
    client: CfProtocolClient;
    reason: string;
    refreshRegistry?: boolean;
  }): Promise<void> {
    if (!accountProviderConfigSource) return;
    const previous = accountConfigSyncByClient.get(params.client) ?? Promise.resolve();
    const current = previous
      .catch(() => {
      })
      .then(async () => {
        const snapshot = await accountProviderConfigSource.read();
        if (accountConfigReceivedRevisionByClient.get(params.client) !== snapshot.revision) {
          const result = await params.client.request(
            cfProtocolMethods.providerUpdateAccountConfig,
            {
              revision: snapshot.revision,
              basedOnCfBuiltinRevision: snapshot.basedOnCfBuiltinRevision,
              providers: Object.fromEntries(
                [...snapshot.providers.entries()].map(([providerId, config]) => [
                  providerId,
                  config.toJSON(),
                ]),
              ),
              states: snapshot.states ?? {},
            },
            cfProviderUpdateAccountConfigResultSchema,
          );
          if (result.receivedRevision !== snapshot.revision) {
            throw new Error("Account Config received receipt version does not match delivered version");
          }
          accountConfigReceivedRevisionByClient.set(params.client, result.receivedRevision);
          logger.info(undefined, "account provider config delivered to CodeFusion agent", {
            providerCount: result.providerCount,
            reason: params.reason,
            receivedRevision: result.receivedRevision,
            status: result.status,
          });
        }
        if (params.refreshRegistry) {
          await params.client.request(
            cfProtocolMethods.providerRefreshRegistry,
            { reason: params.reason },
            cfProviderRefreshRegistryResultSchema,
          );
        }
      });
    accountConfigSyncByClient.set(params.client, current);
    try {
      await current;
    } finally {
      if (accountConfigSyncByClient.get(params.client) === current) {
        accountConfigSyncByClient.delete(params.client);
      }
    }
  }

  async function ensureAccountProviderConfigSynced(params: {
    client: CfProtocolClient;
    reason: string;
    workspace: CfAgentWorkspaceTarget;
    refreshRegistry?: boolean;
  }): Promise<void> {
    await syncAccountProviderConfigToClient({
      client: params.client,
      reason: params.reason,
      refreshRegistry: params.refreshRegistry,
    });
  }

  async function handleAccountProviderConfigChanged(reason: string): Promise<void> {
    await Promise.all(
      Array.from(activeClientsByWorkspaceKey.values()).map(async (active) => {
        await syncAccountProviderConfigToClient({
          client: active.client,
          reason,
        });
      }),
    );
  }

  function enqueueInteractionPreferenceSync(params: {
    client: CfProtocolClient;
    preferences: CfAgentAppRuntimePreferences;
    workspace: CfAgentWorkspaceTarget;
  }): Promise<void> {
    const workspaceKey = resolveWorkspaceKey(params.workspace);
    const previous = interactionPreferenceSyncByWorkspaceKey.get(workspaceKey) ?? Promise.resolve();
    const current = previous
      .catch(() => {
      })
      .then(async () => {
        await params.client.request(
          cfProtocolMethods.workspaceUpdateInteractionPreferences,
          {
            workspace: buildWorkspaceRef(params.workspace),
            preferences: {
              askUserQuestionAutoResolutionEnabled:
                params.preferences.askUserQuestionAutoResolutionEnabled,
            },
          },
          cfWorkspaceUpdateInteractionPreferencesResultSchema,
        );
        try {
          await params.client.request(
            cfProtocolMethods.workspaceUpdateModelIoPreferences,
            {
              workspace: buildWorkspaceRef(params.workspace),
              preferences: {
                fullRetentionEnabled: params.preferences.modelIoFullRetentionEnabled === true,
              },
            },
            cfWorkspaceUpdateModelIoPreferencesResultSchema,
          );
        } catch (error) {
          if (!isProtocolMethodNotFoundError(error)) throw error;
        }
      });
    interactionPreferenceSyncByWorkspaceKey.set(workspaceKey, current);
    void current.then(
      () => {
        if (interactionPreferenceSyncByWorkspaceKey.get(workspaceKey) === current) {
          interactionPreferenceSyncByWorkspaceKey.delete(workspaceKey);
        }
      },
      () => {
        if (interactionPreferenceSyncByWorkspaceKey.get(workspaceKey) === current) {
          interactionPreferenceSyncByWorkspaceKey.delete(workspaceKey);
        }
      },
    );
    return current;
  }

  async function handleProviderReadinessChanged(event: {
    reason: string;
    snapshot: CfAgentProviderReadinessSnapshot;
  }): Promise<void> {
    if (event.snapshot.readiness.ready) {
      await Promise.allSettled(
        Array.from(waitingWorkspaceStartups.entries()).map(async ([workspaceKey, waiting]) => {
          try {
            await waiting.starting;
          } catch (error) {
            if (!isProviderNotReadyError(error)) throw error;
          }
          if (waiting.cancelled || waitingWorkspaceStartups.get(workspaceKey) !== waiting) {
            return;
          }
          const { workspace } = waiting;
          const client = await getClient(workspace);
          await ensureAccountProviderConfigSynced({
            client,
            reason: `startup_ready:${event.reason}`,
            workspace,
            refreshRegistry: true,
          });
          logger.info(undefined, "Started waiting CodeFusion agent after provider/model became ready", {
            providerCount: event.snapshot.providerCount,
            reason: event.reason,
            revision: event.snapshot.revision,
            workspaceKey: resolveWorkspaceKey(workspace),
            workspacePath: workspace.workspacePath,
          });
        }),
      );
    }
  }

  function getSessionEmitter(params: CfAgentSessionTarget) {
    const key = sessionEventKey(params);
    const existing = sessionEmitters.get(key);
    if (existing) {
      return existing;
    }
    const created = new Emitter<CfAgentServiceEvent>();
    sessionEmitters.set(key, created);
    return created;
  }

  function getPluginOperationProgressEmitter(operationId: string) {
    const existing = pluginOperationProgressEmitters.get(operationId);
    if (existing) return existing;
    let created: Emitter<CfPluginOperationProgressNotification>;
    created = new Emitter({
      onDidRemoveLastListener: () => {
        if (pluginOperationProgressEmitters.get(operationId) !== created) return;
        pluginOperationProgressEmitters.delete(operationId);
        created.dispose();
      },
    });
    pluginOperationProgressEmitters.set(operationId, created);
    return created;
  }

  function getConversationFrameEmitter(workspace: CfAgentWorkspaceTarget) {
    const key = resolveWorkspaceKey(workspace);
    const existing = conversationFrameEmitters.get(key);
    if (existing) {
      return existing;
    }
    const created = new Emitter<ConversationTopicWireCandidate>();
    conversationFrameEmitters.set(key, created);
    return created;
  }

  function getProviderRuntimeHeadersWorkspaceEmitter(workspace: CfAgentWorkspaceTarget) {
    const key = resolveWorkspaceKey(workspace);
    const existing = providerRuntimeHeadersWorkspaceEmitters.get(key);
    if (existing) {
      return existing;
    }
    const created = new Emitter<CfProviderRuntimeHeadersRequestParams>();
    providerRuntimeHeadersWorkspaceEmitters.set(key, created);
    return created;
  }

  function getConversationTelemetryFactEmitter(workspace: CfAgentWorkspaceTarget) {
    const key = resolveWorkspaceKey(workspace);
    const existing = conversationTelemetryFactEmitters.get(key);
    if (existing) return existing;
    const created = new Emitter<ConversationTelemetryFact>();
    conversationTelemetryFactEmitters.set(key, created);
    return created;
  }

  function getOffPeakLifecycleEmitter(workspace: CfAgentWorkspaceTarget) {
    const key = resolveWorkspaceKey(workspace);
    let emitter = offPeakLifecycleEmitters.get(key);
    if (!emitter) {
      emitter = new Emitter<OffPeakLifecycleNotification>();
      offPeakLifecycleEmitters.set(key, emitter);
    }
    return emitter;
  }

  function getSessionsIndexFrameEmitter(workspace: CfAgentWorkspaceTarget) {
    const key = resolveWorkspaceKey(workspace);
    const existing = sessionsIndexFrameEmitters.get(key);
    if (existing) {
      return existing;
    }
    const created = new Emitter<SessionsIndexTopicWireCandidate>();
    sessionsIndexFrameEmitters.set(key, created);
    return created;
  }

  function getWorkspaceConfigFrameEmitter(workspace: CfAgentWorkspaceTarget) {
    const key = resolveWorkspaceKey(workspace);
    const existing = workspaceConfigFrameEmitters.get(key);
    if (existing) {
      return existing;
    }
    const created = new Emitter<WorkspaceConfigTopicWireCandidate>();
    workspaceConfigFrameEmitters.set(key, created);
    return created;
  }

  
  function v4ConnectionIdFor(subscriberScope?: string): string {
    return subscriberScope ? `${v4ConnectionId}#${subscriberScope}` : v4ConnectionId;
  }

  function resolveV4Connection(
    params: unknown,
    fallbackConnectionId: string = v4ConnectionId,
  ): CfAgentV4ConnectionContext {
    return (
      readTrustedCfAgentV4Connection(params) ?? {
        connectionId: fallbackConnectionId,
        clientMode: "desktop-continuous" as const,
      }
    );
  }

  function v4SubscriptionRouteKey(route: V4SubscriptionRoute): string {
    return `${route.workspaceKey}\0${route.topic}\0${route.subscriptionId}\0${route.connectionId}`;
  }

  function v4SubscriptionOwnershipKey(route: V4SubscriptionRoute): string {
    return `${route.workspaceKey}\0${route.topic}\0${route.connectionId}`;
  }

  function rememberV4SubscriptionRoute(
    workspace: CfAgentWorkspaceTarget,
    topic: string,
    subscriptionId: string,
    connectionId: string,
  ): void {
    const route: V4SubscriptionRoute = {
      workspaceKey: resolveWorkspaceKey(workspace),
      topic,
      subscriptionId,
      connectionId,
    };
    const ownershipKey = v4SubscriptionOwnershipKey(route);
    const previous = v4RouteKeyByOwnership.get(ownershipKey);
    if (previous) v4SubscriptionRoutes.delete(previous);
    const routeKey = v4SubscriptionRouteKey(route);
    v4RouteKeyByOwnership.set(ownershipKey, routeKey);
    v4SubscriptionRoutes.set(routeKey, route);
  }

  function forgetV4SubscriptionRoute(route: V4SubscriptionRoute): void {
    const routeKey = v4SubscriptionRouteKey(route);
    v4SubscriptionRoutes.delete(routeKey);
    const ownershipKey = v4SubscriptionOwnershipKey(route);
    if (v4RouteKeyByOwnership.get(ownershipKey) === routeKey) {
      v4RouteKeyByOwnership.delete(ownershipKey);
    }
  }

  function isCurrentV4SubscriptionRoute(route: V4SubscriptionRoute): boolean {
    return v4SubscriptionRoutes.get(v4SubscriptionRouteKey(route)) === route;
  }

  function clearV4SubscriptionRoutes(workspaceKey?: string): void {
    for (const route of v4SubscriptionRoutes.values()) {
      if (workspaceKey !== undefined && route.workspaceKey !== workspaceKey) {
        continue;
      }
      forgetV4SubscriptionRoute(route);
    }
  }

  function resolveV4UnsubscribeRoute(
    params: CfAgentConversationUnsubscribeParams | CfAgentConversationResyncParams,
    topicPrefix: string,
  ): V4SubscriptionRoute | null {
    const expectedWorkspaceKey = resolveWorkspaceKey(params);
    const trusted = readTrustedCfAgentV4UnsubscribeRoute(params);
    if (trusted) {
      if (!trusted.topic.startsWith(topicPrefix)) return null;
      const route: V4SubscriptionRoute = {
        workspaceKey: expectedWorkspaceKey,
        topic: trusted.topic,
        subscriptionId: params.subscriptionId,
        connectionId: trusted.connectionId,
      };
      return v4SubscriptionRoutes.get(v4SubscriptionRouteKey(route)) ?? null;
    }
    const matches = [...v4SubscriptionRoutes.values()].filter(
      (route) =>
        route.workspaceKey === expectedWorkspaceKey &&
        route.subscriptionId === params.subscriptionId &&
        route.topic.startsWith(topicPrefix),
    );
    return matches.length === 1 ? matches[0]! : null;
  }

  async function unsubscribeV4Route(
    params: CfAgentConversationUnsubscribeParams,
    topicPrefix: string,
  ): Promise<void> {
    const route = resolveV4UnsubscribeRoute(params, topicPrefix);
    if (!route) return;
    const client = await getReadOnlyClient(params, params.runtimePolicy);
    if (!isCurrentV4SubscriptionRoute(route)) return;
    await client.request(
      V4_METHODS.conversationUnsubscribe,
      {
        topic: route.topic,
        subscriptionId: route.subscriptionId,
        connectionId: route.connectionId,
      },
      cfProtocolEmptyResultSchema,
    );
    if (isCurrentV4SubscriptionRoute(route)) forgetV4SubscriptionRoute(route);
  }

  async function resyncV4Route(params: CfAgentConversationResyncParams, topicPrefix: string) {
    const route = resolveV4UnsubscribeRoute(params, topicPrefix);
    if (!route) throw new Error("fault.subscription.notOwned");
    const client = await getReadOnlyClient(params, params.runtimePolicy);
    if (!isCurrentV4SubscriptionRoute(route)) {
      throw new Error("fault.subscription.notOwned");
    }
    const result = await client.request(
      V4_METHODS.conversationResync,
      {
        topic: route.topic,
        connectionId: route.connectionId,
        subscriptionId: route.subscriptionId,
        base: params.base,
        ...(params.forceSnapshot !== undefined ? { forceSnapshot: params.forceSnapshot } : {}),
      },
      v4ConversationResyncResultSchema,
    );
    if (!isCurrentV4SubscriptionRoute(route)) {
      throw new Error("fault.subscription.notOwned");
    }
    return result;
  }

  function emitSessionEvent(
    workspace: CfAgentWorkspaceTarget,
    sessionId: string,
    event: CfAgentServiceEvent,
  ): void {
    sessionEmitters.get(sessionEventKey({ ...workspace, sessionId }))?.fire(event);
  }

  function emitWorkspaceEvent(
    workspace: CfAgentWorkspaceTarget,
    event: CfAgentServiceEvent,
  ): void {
    const workspaceKey = resolveWorkspaceKey(workspace);
    for (const [key, emitter] of sessionEmitters) {
      if (key.startsWith(`${workspaceKey}\u0000`)) {
        emitter.fire(event);
      }
    }
  }

  function getSessionEventSequenceState(
    workspace: CfAgentWorkspaceTarget,
    sessionId: string,
  ): SessionEventSequenceState {
    const key = sessionEventKey({ ...workspace, sessionId });
    const existing = sessionEventSequenceStates.get(key);
    if (existing) {
      return existing;
    }
    const created: SessionEventSequenceState = {
      assignedSeqByEventId: new Map<string, number>(),
      assignedSeqEventIds: [],
      liveEventIds: new Set<string>(),
      liveEventIdOrder: [],
      lastAssignedSeq: 0,
    };
    sessionEventSequenceStates.set(key, created);
    return created;
  }

  function normalizeSessionEventSeq(
    workspace: CfAgentWorkspaceTarget,
    event: CfSessionEvent,
  ): CfSessionEvent {
    const state = getSessionEventSequenceState(workspace, event.sessionId);
    if (event.seq > 0) {
      state.lastAssignedSeq = Math.max(state.lastAssignedSeq, event.seq);
      return event;
    }

    const assignedSeq = state.assignedSeqByEventId.get(event.eventId);
    if (assignedSeq !== undefined) {
      return { ...event, seq: assignedSeq };
    }

    const nextSeq = state.lastAssignedSeq + 1;
    state.lastAssignedSeq = nextSeq;
    state.assignedSeqByEventId.set(event.eventId, nextSeq);
    state.assignedSeqEventIds.push(event.eventId);
    while (state.assignedSeqEventIds.length > MAX_TRACKED_SESSION_EVENT_IDS) {
      const removed = state.assignedSeqEventIds.shift();
      if (removed) {
        state.assignedSeqByEventId.delete(removed);
      }
    }
    return { ...event, seq: nextSeq };
  }

  function shouldDeliverLiveSessionEvent(
    workspace: CfAgentWorkspaceTarget,
    event: CfSessionEvent,
  ): boolean {
    const state = getSessionEventSequenceState(workspace, event.sessionId);
    return rememberBoundedEventId(state.liveEventIds, state.liveEventIdOrder, event.eventId);
  }

  function handleSessionEvent(
    workspace: CfAgentWorkspaceTarget,
    event: CfSessionEvent,
  ): void {
    const normalizedEvent = normalizeSessionEventSeq(workspace, event);
    if (!shouldDeliverLiveSessionEvent(workspace, normalizedEvent)) {
      return;
    }
    emitSessionEvent(workspace, normalizedEvent.sessionId, {
      type: "session.event",
      event: normalizedEvent,
    });
  }

  function handleStateUpdated(
    workspace: CfAgentWorkspaceTarget,
    notification: CfStateUpdatedNotification,
  ): void {
    if (notification.sessionId) {
      emitSessionEvent(workspace, notification.sessionId, {
        type: "state.updated",
        notification,
      });
      return;
    }
    emitWorkspaceEvent(workspace, { type: "state.updated", notification });
  }

  function wireClient(
    client: CfProtocolClient,
    workspace: CfAgentWorkspaceTarget,
    
    lane: ProcessResourceCliLane,
  ): void {
    if (wiredClients.has(client)) {
      return;
    }
    wiredClients.add(client);
    const topicResources = createTopicResourceBridge(() => {
      const active = activeClientsByWorkspaceKey.get(resolveWorkspaceKey(workspace));
      const resourceWorkspace =
        active?.client === client ? { ...active.workspace } : { ...workspace };
      return {
        validate: (request, signal, trace) => {
          if (!options?.topicResourceValidator)
            throw new Error("Topic resource authorization is unavailable");
          return options.topicResourceValidator(
            { ...request, ...resourceWorkspace, trace },
            signal,
          );
        },
        read: (request, signal, trace) => {
          if (!options?.topicResourceExecutor)
            throw new Error("Topic attachment retrieval is unavailable on this host");
          return options.topicResourceExecutor({ ...request, ...resourceWorkspace, trace }, signal);
        },
        upload: (request, attachment, signal, trace) =>
          uploadTopicResourceToClient(
            client,
            v4ConnectionId,
            { ...resourceWorkspace, sessionId: request.taskId },
            attachment,
            signal,
            trace,
          ),
      };
    });
    const disposables = [
      topicResources,
      client.onNotification((message) => {
        if (message.method === cfProtocolNotifications.providerRuntimeHeadersCancelled) {
          const parsed = cfProviderRuntimeHeadersCancelledSchema.safeParse(message.params);
          if (
            !parsed.success ||
            resolveWorkspaceKey(parsed.data.workspace) !== resolveWorkspaceKey(workspace)
          )
            return;
          const key = providerRuntimeHeadersRequestKey({
            ...workspace,
            sessionId: parsed.data.sessionId,
            requestId: parsed.data.requestId,
          });
          const pending = pendingProviderRuntimeHeaders.get(key);
          if (pending?.client === client) cancelProviderRuntimeHeaders(key, pending);
          return;
        }
        if (message.method === cfProtocolNotifications.processResourceSample) {
          const parsed = cfProcessResourceSampleSchema.safeParse(message.params);
          if (parsed.success) {
            processResourceSampleEmitter.fire({ ...parsed.data, lane });
          } else {
            logger.debug(undefined, "Discarding invalid CodeFusion CLI resource sample", {
              issues: parsed.error.issues.map((issue) => ({
                code: issue.code,
                path: issue.path.join("."),
              })),
            });
          }
          return;
        }

        if (message.method === cfProtocolNotifications.toolExecResource) {
          const parsed = cfToolExecResourceSchema.safeParse(message.params);
          if (parsed.success) toolExecResourceEmitter.fire(parsed.data);
          return;
        }
        if (message.method === cfProtocolNotifications.mcpResourceSamples) {
          const parsed = cfMcpResourceSamplesSchema.safeParse(message.params);
          if (parsed.success) mcpResourceSamplesEmitter.fire(parsed.data);
          else logger.debug(undefined, "Discarding invalid MCP resource sample");
          return;
        }

        if (message.method === cfProtocolNotifications.mcpTelemetry) {
          const parsed = cfMcpTelemetryEventSchema.safeParse(message.params);
          if (parsed.success) {
            mcpTelemetryEmitter.fire(parsed.data);
          } else {
            logger.debug(undefined, "Discarding invalid CodeFusion CLI MCP telemetry event", {
              issues: parsed.error.issues.map((issue) => ({
                code: issue.code,
                path: issue.path.join("."),
              })),
            });
          }
          return;
        }

        if (message.method === cfProtocolNotifications.pluginOperationProgress) {
          const parsed = cfPluginOperationProgressNotificationSchema.safeParse(message.params);
          if (parsed.success) {
            pluginOperationProgressEmitters.get(parsed.data.operationId)?.fire(parsed.data);
          } else {
            logger.warn(undefined, "Discarding invalid CodeFusion Protocol plugin operation progress", {
              issues: parsed.error.issues.map((issue) => ({
                code: issue.code,
                message: issue.message,
                path: issue.path.join("."),
              })),
            });
          }
          return;
        }

        if (message.method === cfProtocolMethods.computerUseOperationEvent) {
          const parsed = cfComputerUseOperationEventSchema.safeParse(message.params);
          if (parsed.success) {
            cuaOperationTurnTracker?.accept(workspace, parsed.data);
          } else {
            logger.warn(undefined, "Discarding invalid CodeFusion Protocol Computer Use operation event", {
              issues: parsed.error.issues.map((issue) => ({
                code: issue.code,
                message: issue.message,
                path: issue.path.join("."),
              })),
              workspaceKey: resolveWorkspaceKey(workspace),
            });
          }
          return;
        }

        if (message.method === "session/event") {
          const parsed = cfSessionEventSchema.safeParse(message.params);
          if (parsed.success) {
            handleSessionEvent(workspace, parsed.data);
          } else {
            const rawParams =
              typeof message.params === "object" && message.params !== null
                ? (message.params as Record<string, unknown>)
                : {};
            logger.warn(
              typeof rawParams.traceId === "string" ? rawParams.traceId : undefined,
              "Discarded invalid CodeFusion Protocol session event",
              {
                eventId: rawParams.eventId,
                issues: parsed.error.issues.map((issue) => ({
                  code: issue.code,
                  message: issue.message,
                  path: issue.path.join("."),
                })),
                sessionId: rawParams.sessionId,
                type: rawParams.type,
              },
            );
          }
          return;
        }

        if (message.method === "state.updated") {
          const parsed = cfStateUpdatedNotificationSchema.safeParse(message.params);
          if (parsed.success) {
            handleStateUpdated(workspace, parsed.data);
          }
          return;
        }

        if (message.method === V4_NOTIFICATIONS.localTtftFacts) {
          const parsed = localTtftFactsSchema.safeParse(message.params);
          if (parsed.success && !workspace.remoteSessionId && !workspace.workspaceIdentity?.trim())
            localTtftFactsEmitter.fire({
              workspaceKey: resolveWorkspaceKey(workspace),
              facts: parsed.data,
            });
          return;
        }
        if (message.method === V4_NOTIFICATIONS.conversationTelemetryFact) {
          const parsed = conversationTelemetryFactSchema.safeParse(message.params);
          if (parsed.success) {
            getConversationTelemetryFactEmitter(workspace).fire(parsed.data);
          } else {
            logger.warn(undefined, "Discarded invalid v4 conversation telemetry fact", {
              issues: parsed.error.issues.map((issue) => ({
                code: issue.code,
                message: issue.message,
                path: issue.path.join("."),
              })),
              workspaceKey: resolveWorkspaceKey(workspace),
            });
          }
          return;
        }
        if (message.method === V4_NOTIFICATIONS.offPeakLifecycle) {
          const parsed = offPeakLifecycleNotificationSchema.safeParse(message.params);
          if (parsed.success) getOffPeakLifecycleEmitter(workspace).fire(parsed.data);
          else
            logger.warn(undefined, "Discarded invalid idle lifecycle notification", {
              workspaceKey: resolveWorkspaceKey(workspace),
            });
          return;
        }

        if (message.method === V4_NOTIFICATIONS.pluginUiToolResult) {
          const parsed = pluginUiToolResultNotificationSchema.safeParse(message.params);
          if (
            parsed.success &&
            !workspace.remoteSessionId &&
            !isRemoteWorkspaceIdentity(workspace.workspaceIdentity ?? "") &&
            activeClientsByWorkspaceKey.get(resolveWorkspaceKey(workspace))?.client === client
          ) {
            pluginUiToolResultEmitter.fire({
              ...parsed.data,
              workspacePath: workspace.workspacePath,
              ...(workspace.workspaceIdentity
                ? { workspaceIdentity: workspace.workspaceIdentity }
                : {}),
            });
          }
          return;
        }
        if (message.method === V4_NOTIFICATIONS.cuaPermissionObservation) {
          const parsed = cuaPermissionObservationSchema.safeParse(message.params);
          if (
            parsed.success &&
            !workspace.remoteSessionId &&
            !(workspace.workspaceIdentity && isRemoteWorkspaceIdentity(workspace.workspaceIdentity))
          ) {
            cuaPermissionObservationEmitter.fire({
              ...parsed.data,
              workspacePath: workspace.workspacePath,
              ...(workspace.workspaceIdentity
                ? { workspaceIdentity: workspace.workspaceIdentity }
                : {}),
            });
          } else if (!parsed.success) {
            logger.warn(undefined, "Discarded invalid v4 CUA permission observation", {
              issues: parsed.error.issues.map((issue) => ({
                code: issue.code,
                message: issue.message,
                path: issue.path.join("."),
              })),
              workspaceKey: resolveWorkspaceKey(workspace),
            });
          }
          return;
        }

        if (message.method === V4_NOTIFICATIONS.conversationFrame) {
          const topic = (message.params as { topic?: unknown } | null)?.topic;
          if (typeof topic === "string" && topic.startsWith("sessions-index/")) {
            const indexParsed = sessionsIndexTopicWireCandidateSchema.safeParse(message.params);
            if (indexParsed.success) {
              getSessionsIndexFrameEmitter(workspace).fire(indexParsed.data);
            } else {
              logger.warn(undefined, "Discarded invalid v4 sessions-index frame", {
                issues: indexParsed.error.issues.map((issue) => ({
                  code: issue.code,
                  message: issue.message,
                  path: issue.path.join("."),
                })),
                workspaceKey: resolveWorkspaceKey(workspace),
              });
            }
            return;
          }
          if (typeof topic === "string" && topic.startsWith("workspace-config/")) {
            const configParsed = workspaceConfigTopicWireCandidateSchema.safeParse(message.params);
            if (configParsed.success) {
              getWorkspaceConfigFrameEmitter(workspace).fire(configParsed.data);
            } else {
              logger.warn(undefined, "Discarded invalid v4 workspace-config frame", {
                issues: configParsed.error.issues.map((issue) => ({
                  code: issue.code,
                  message: issue.message,
                  path: issue.path.join("."),
                })),
                workspaceKey: resolveWorkspaceKey(workspace),
              });
            }
            return;
          }
          const parsed = conversationTopicWireCandidateSchema.safeParse(message.params);
          if (parsed.success) {
            getConversationFrameEmitter(workspace).fire(parsed.data);
          } else {
            logger.warn(undefined, "Discarded invalid v4 conversation frame", {
              issues: parsed.error.issues.map((issue) => ({
                code: issue.code,
                message: issue.message,
                path: issue.path.join("."),
              })),
              workspaceKey: resolveWorkspaceKey(workspace),
            });
          }
          return;
        }
      }),
      client.onRequest((request) => {
        if (request.method === cfProtocolMethods.subagentsReadRuntimeConfig) {
          void (async () => {
            const parsed = cfSubagentsReadRuntimeConfigParamsSchema.safeParse(request.params);
            if (!parsed.success) {
              await client.respondError(request.id, {
                code: -32602,
                message: "Invalid subagent runtime config request",
              });
              return;
            }
            let configuration: SubagentRuntimeConfig;
            try {
              if (!options?.readSubagentRuntimeConfig)
                throw new Error("Subagent runtime config is unavailable on this Host");
              configuration = subagentRuntimeConfigSchema.parse(
                await options.readSubagentRuntimeConfig(workspace),
              );
            } catch (error) {
              await client.respondError(request.id, {
                code: -32603,
                message: error instanceof Error ? error.message : String(error),
              });
              return;
            }
            await client.respond(request.id, configuration);
          })().catch((error) =>
            logger.debug(undefined, "Failed to send Subagent configuration response", { error: String(error) }),
          );
          return;
        }
        if (request.method === cfProtocolMethods.channelReply) {
          void (async () => {
            const params = channelReplyRequestSchema.parse(request.params);
            if (!options?.channelReplyExecutor) throw new Error("Channel reply unavailable");
            const active = activeClientsByWorkspaceKey.get(resolveWorkspaceKey(workspace));
            if (active?.client !== client)
              throw new Error("Channel reply client is no longer active");
            const currentWorkspace = active.workspace;
            const result = await options.channelReplyExecutor({
              ...params,
              workspacePath: currentWorkspace.workspacePath,
              workspaceIdentity: currentWorkspace.workspaceIdentity,
              remoteSessionId: currentWorkspace.remoteSessionId,
              trace: request.trace,
            });
            await client.respond(request.id, result);
          })().catch((error: unknown) =>
            client.respondError(request.id, {
              code: -32603,
              message: error instanceof Error ? error.message : "Channel reply failed",
            }),
          );
          return;
        }
        if (request.method === cfProtocolMethods.topicResourceRead) {
          void topicResources
            .read(request.params, request.trace)
            .then((result) => client.respond(request.id, result))
            .catch((error: unknown) =>
              client.respondError(request.id, {
                code: -32603,
                message: error instanceof Error ? error.message : "Topic resource read failed",
              }),
            );
          return;
        }
        if (request.method === cfProtocolMethods.topicResourceCancel) {
          const parsed = cfTopicResourceCancelParamsSchema.safeParse(request.params);
          void client.respond(request.id, {
            cancelled: parsed.success && topicResources.cancel(parsed.data),
          });
          return;
        }
        if (request.method === cfProtocolMethods.sessionRequestRuntimePreferences) {
          const reportResponseFailure = (error: unknown): void => {
            logger.debug(undefined, "Failed to send runtime preferences response", {
              error: error instanceof Error ? error.message : String(error),
              workspaceKey: resolveWorkspaceKey(workspace),
            });
          };
          const parsed = cfSessionRequestRuntimePreferencesParamsSchema.safeParse(
            request.params,
          );
          if (!parsed.success) {
            void client
              .respondError(request.id, {
                code: -32602,
                message: "Invalid session runtime preferences request params",
                data: parsed.error.flatten(),
              })
              .catch(reportResponseFailure);
            return;
          }
          if (sessionRuntimePreferencesAuthority === "local") {
            void (async () => {
              let preferences: CfSessionRuntimePreferencesResult;
              try {
                preferences = cfSessionRuntimePreferencesResultSchema.parse(
                  (await resolveSessionRuntimePreferences?.(parsed.data.scope)) ?? {
                    askUserQuestionAutoResolutionEnabled: true,
                    nativeSearchEnhancementsEnabled: true,
                    memoryEnabled: false,
                  },
                );
                if (
                  parsed.data.scope === "runtime-materialization" &&
                  options?.resolveSessionDirectories
                ) {
                  preferences.additionalDirectories = await options.resolveSessionDirectories({
                    ...workspace,
                    sessionId: parsed.data.sessionId,
                  });
                }
                preferences.subagentRuntimeConfigEnabled =
                  Boolean(options?.readSubagentRuntimeConfig) &&
                  !(
                    workspace.workspaceIdentity &&
                    isRemoteWorkspaceIdentity(workspace.workspaceIdentity)
                  );
              } catch (error) {
                await client.respondError(request.id, {
                  code: -32603,
                  message: error instanceof Error ? error.message : String(error),
                });
                return;
              }
              await client.respond(request.id, preferences);
            })().catch(reportResponseFailure);
            return;
          }

          const requestId = randomUUID();
          const dynamicRequest: CfAgentSessionRuntimePreferencesRequest = {
            ...parsed.data,
            requestId,
          };
          pendingSessionRuntimePreferences.set(requestId, {
            client,
            protocolRequestId: request.id,
            request: dynamicRequest,
            workspace,
            timeout: setTimeout(
              () => expireSessionRuntimePreferencesRequest(requestId),
              CF_SESSION_RUNTIME_PREFERENCES_REQUEST_TIMEOUT_MS,
            ),
            workspaceKey: resolveWorkspaceKey(workspace),
          });
          logger.info(undefined, "Runtime preferences request forwarded to Host", {
            event: "cf_agent.runtime_preferences.host_request_dispatched",
            module: "services.cf_agent",
            requestId,
            scope: dynamicRequest.scope,
            sessionId: dynamicRequest.sessionId,
            workspaceKey: resolveWorkspaceKey(workspace),
          });
          sessionRuntimePreferencesRequestEmitter.fire(dynamicRequest);
          return;
        }

        if (request.method === cfProtocolMethods.interactionRequestPermission) {
          const parsed = cfPermissionRequestParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid permission request params",
              data: parsed.error.flatten(),
            });
            return;
          }
          const key = permissionRequestKey({
            ...workspace,
            sessionId: parsed.data.sessionId,
            requestId: parsed.data.requestId,
          });
          const wasPending = pendingPermissions.has(key);
          pendingPermissions.set(key, {
            client,
            protocolRequestId: request.id,
          });
          if (!wasPending) {
            emitSessionEvent(workspace, parsed.data.sessionId, {
              type: "permission.request",
              request: parsed.data,
            });
          }
          return;
        }

        if (request.method === cfProtocolMethods.interactionRequestUserInput) {
          const parsed = cfUserInputRequestParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid user input request params",
              data: parsed.error.flatten(),
            });
            return;
          }
          const key = userInputRequestKey({
            ...workspace,
            sessionId: parsed.data.sessionId,
            requestId: parsed.data.requestId,
          });
          const wasPending = pendingUserInputs.has(key);
          pendingUserInputs.set(key, { client, protocolRequestId: request.id });
          if (!wasPending) {
            emitSessionEvent(workspace, parsed.data.sessionId, {
              type: "userInput.request",
              request: parsed.data,
            });
          }
          return;
        }

        if (request.method === cfProtocolMethods.interactionRequestProviderRuntimeHeaders) {
          const parsed = cfProviderRuntimeHeadersRequestParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid provider runtime headers request params",
              data: parsed.error.flatten(),
            });
            return;
          }
          const pendingKey = providerRuntimeHeadersRequestKey({
            ...workspace,
            sessionId: parsed.data.sessionId,
            requestId: parsed.data.requestId,
          });
          const pending = {
            client,
            protocolRequestId: request.id,
            request: parsed.data,
          };
          pendingProviderRuntimeHeaders.set(pendingKey, pending);
          logger.info(request.trace?.traceId, "Received CodeFusion provider runtime headers request", {
            modelId: parsed.data.modelSelection.modelId,
            providerId: parsed.data.providerId,
            requestId: parsed.data.requestId,
            sessionId: parsed.data.sessionId,
            turnId: parsed.data.turnId ?? null,
            workspaceKey: resolveWorkspaceKey(workspace),
            workspacePath: workspace.workspacePath,
          });
          const accountAccess = parsed.data.accountAccess;
          if (
            accountRequestAuthService &&
            accountAccess &&
            !requiresRequestVerification(accountAccess)
          ) {
            void respondAccountRequestAuthWithoutInteraction({
              key: pendingKey,
              pending,
            });
            return;
          }
          if (!requestVerificationInteractionAvailable) {
            pendingProviderRuntimeHeaders.delete(pendingKey);
            void pending.client.respond(pending.protocolRequestId, {
              headersApplied: false,
              errorMessage: "Provider request auth is unavailable",
            });
            return;
          }
          emitSessionEvent(workspace, parsed.data.sessionId, {
            type: "providerRuntimeHeaders.request",
            request: parsed.data,
          });
          providerRuntimeHeadersWorkspaceEmitters
            .get(resolveWorkspaceKey(workspace))
            ?.fire(parsed.data);
          return;
        }

        if (request.method === cfProtocolMethods.interactionRequestOfficialMcpAuthHeaders) {
          const parsed = cfOfficialMcpAuthHeadersRequestParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid interaction/requestOfficialMcpAuthHeaders params",
              data: parsed.error.flatten(),
            });
            return;
          }
          void (async () => {
            const trustedOrigins = options?.officialMcpTrustedOrigins;
            const trust = trustedOrigins
              ? await trustedOrigins
                  .isTrusted({
                    mcpKey: parsed.data.mcpKey,
                    origin: parsed.data.targetOrigin,
                    pluginId: parsed.data.pluginId,
                  })
                  .catch(() => ({ detail: "validator_error", trusted: false }))
              : { detail: "validator_missing", trusted: false };
            if (!trust.trusted) {
              logger.warn(request.trace?.traceId, "Official MCP identity headers request failed host-side trust verification", {
                detail: trust.detail ?? "unknown",
                mcpKey: parsed.data.mcpKey,
                pluginId: parsed.data.pluginId,
                requestId: parsed.data.requestId,
                targetOrigin: parsed.data.targetOrigin,
                workspaceKey: parsed.data.workspace.workspaceKey,
              });
              void client.respond(request.id, {
                ok: false,
                reason: "official_mcp_origin_untrusted",
              });
              return;
            }
            const resolver = options?.officialMcpAuthHeadersResolver;
            if (!resolver) {
              void client.respond(request.id, {
                ok: false,
                reason: "official_auth_unavailable",
              });
              return;
            }
            try {
              const resolveStartedAt = Date.now();
              const result = await resolver.resolveHeaders({
                mcpKey: parsed.data.mcpKey,
                pluginId: parsed.data.pluginId,
                targetOrigin: parsed.data.targetOrigin,
                workspace: parsed.data.workspace,
              });
              if (result.ok) {
                const firstIssuance = officialMcpIssuanceAudit.markFirst(
                  parsed.data.pluginId,
                  parsed.data.mcpKey,
                  parsed.data.workspace.workspaceKey,
                );
                const logIssuance = firstIssuance ? logger.info : logger.debug;
                logIssuance(request.trace?.traceId, "Official MCP identity headers resolved", {
                  firstIssuance,
                  ...summarizeOfficialMcpIdentityHeaders(result.headers),
                  mcpKey: parsed.data.mcpKey,
                  pluginId: parsed.data.pluginId,
                  requestId: parsed.data.requestId,
                  resolveDurationMs: Date.now() - resolveStartedAt,
                  targetOrigin: parsed.data.targetOrigin,
                });
              } else {
                logger.info(request.trace?.traceId, "Official MCP identity headers unavailable", {
                  mcpKey: parsed.data.mcpKey,
                  pluginId: parsed.data.pluginId,
                  reason: result.reason,
                  requestId: parsed.data.requestId,
                  resolveDurationMs: Date.now() - resolveStartedAt,
                  targetOrigin: parsed.data.targetOrigin,
                });
              }
              void client.respond(request.id, result);
            } catch (error: unknown) {
              logger.warn(request.trace?.traceId, "Failed to resolve official MCP identity headers", {
                error: error instanceof Error ? error.message : String(error),
                mcpKey: parsed.data.mcpKey,
                pluginId: parsed.data.pluginId,
                requestId: parsed.data.requestId,
                targetOrigin: parsed.data.targetOrigin,
              });
              void client.respond(request.id, {
                ok: false,
                reason: "official_auth_unavailable",
              });
            }
          })();
          return;
        }

        if (request.method === cfProtocolMethods.interactionBrowserList) {
          const parsed = cfBrowserListParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid interaction/browserList params",
              data: parsed.error.flatten(),
            });
            return;
          }
          const executor = options?.browserControlExecutor;
          if (!executor) {
            void client.respond(request.id, { browsers: [] });
            return;
          }
          void executor
            .list(parsed.data)
            .then((browsers) => client.respond(request.id, { browsers }))
            .catch((error: unknown) => {
              void client.respondError(request.id, {
                code: -32603,
                message: error instanceof Error ? error.message : String(error),
              });
            });
          return;
        }

        if (request.method === cfProtocolMethods.interactionBrowserExecute) {
          const parsed = cfBrowserExecuteParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid interaction/browserExecute params",
              data: parsed.error.flatten(),
            });
            return;
          }
          const executor = options?.browserControlExecutor;
          if (!executor) {
            void client.respond(request.id, {
              ok: false,
              error: {
                code: "backend_unavailable",
                message: "browser control not available",
              },
              elapsedMs: 0,
            });
            return;
          }
          void executor
            .execute({
              requestId: parsed.data.requestId,
              ...(parsed.data.browserId ? { browserId: parsed.data.browserId } : {}),
              ...(parsed.data.browserGeneration !== undefined
                ? { browserGeneration: parsed.data.browserGeneration }
                : {}),
              sessionId: parsed.data.sessionId,
              ...(parsed.data.turnId ? { turnId: parsed.data.turnId } : {}),
              workspaceKey: parsed.data.workspaceKey ?? resolveWorkspaceKey(workspace),
              workspacePath: parsed.data.workspacePath ?? workspace.workspacePath,
              ...((parsed.data.workspaceIdentity ?? workspace.workspaceIdentity)
                ? {
                    workspaceIdentity: parsed.data.workspaceIdentity ?? workspace.workspaceIdentity,
                  }
                : {}),
              ...(parsed.data.remoteSessionId
                ? { remoteSessionId: parsed.data.remoteSessionId }
                : {}),
              clientMode: parsed.data.clientMode ?? "desktop-continuous",
              sessionContext: parsed.data.sessionContext ?? "live",
              command: parsed.data.command,
            })
            .then((result) => client.respond(request.id, result))
            .catch((error: unknown) => {
              void client.respond(request.id, {
                ok: false,
                error: {
                  code: "execution_error",
                  message: error instanceof Error ? error.message : String(error),
                },
                elapsedMs: 0,
              });
            });
          return;
        }

        if (request.method === cfProtocolMethods.automationCreate) {
          const parsed = cfAutomationCreateParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid automation create params",
              data: parsed.error.flatten(),
            });
            return;
          }
          void (async () => {
            try {
              const automation = await automationService.create({
                title: parsed.data.title ?? "",
                cronExpr: parsed.data.cronExpr,
                relativeDelayMinutes: parsed.data.relativeDelayMinutes,
                intervalUnit: parsed.data.intervalUnit,
                interval: parsed.data.interval,
                prompt: parsed.data.prompt,
                modelSelection: parsed.data.modelSelection,
                mode: parsed.data.mode,
                targetTaskId: parsed.data.targetTaskId,
                botDeliveryTarget: parsed.data.botDeliveryTarget,
                workspacePath: workspace.workspacePath,
                workspaceIdentity: workspace.workspaceIdentity,
                recurring: parsed.data.recurring ?? true,
                maxRuns: parsed.data.maxRuns,
              });
              if (automation.targetTaskId) {
                const taskMeta = await automationTaskIndexRepo
                  .getTaskMeta({
                    workspacePath: automation.workspacePath,
                    workspaceIdentity: automation.workspaceIdentity,
                    taskId: automation.targetTaskId,
                  })
                  .catch(() => null);
                if (taskMeta) {
                  await automationTaskIndexRepo.updateTaskPresentation({
                    ...taskMeta,
                    presentation: {
                      cronAutomationId: automation.automationId,
                    },
                  });
                }
              }
              await client.respond(request.id, {
                automation: toProtocolAutomation(automation),
              });
            } catch (error) {
              await client.respondError(request.id, {
                code: -32603,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          })();
          return;
        }

        if (request.method === cfProtocolMethods.offPeakCreate) {
          const parsed = cfOffPeakCreateParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid off-peak create params",
              data: parsed.error.flatten(),
            });
            return;
          }
          void (async () => {
            try {
              const offPeakTaskService = options?.resolveOffPeakTaskService?.();
              if (!offPeakTaskService) {
                await client.respondError(request.id, {
                  code: -32601,
                  message: "Off-peak task service is unavailable on this host",
                });
                return;
              }
              const grayConfig = await options
                ?.resolveOffPeakClientConfig?.()
                .catch(() => undefined);
              const support =
                resolveOffPeakAllowedModels(grayConfig).length > 0
                  ? await offPeakTaskService.getCodingPlanSupport()
                  : undefined;
              const providerId = support?.supported
                ? OFF_PEAK_PROVIDER_IDS[support.providerFamily]
                : undefined;
              const allowedModels = providerId
                ? resolveOffPeakAllowedModels(grayConfig, providerId)
                : [];
              if (allowedModels.length === 0) {
                await client.respond(request.id, {
                  ok: false,
                  failureStage: "client_validation",
                  errorCategory: "client_validation",
                  errorCode: "offpeak_disabled",
                });
                return;
              }
              const model = resolveOffPeakCreateModel(allowedModels, parsed.data.model);
              if (model === null) {
                await client.respond(request.id, {
                  ok: false,
                  failureStage: "client_validation",
                  errorCategory: "client_validation",
                  errorCode: "model_not_allowed",
                });
                return;
              }
              const modelSelection =
                grayConfig && providerId
                  ? resolveOffPeakToolSelection(
                      grayConfig.modelSelectionView,
                      providerId,
                      model,
                      parsed.data.thoughtLevel,
                    )
                  : undefined;
              if (!modelSelection) {
                await client.respond(request.id, {
                  ok: false,
                  failureStage: "client_validation",
                  errorCategory: "client_validation",
                  errorCode: "model_not_allowed",
                });
                return;
              }
              const result = await offPeakTaskService.createTask({
                title: parsed.data.title,
                prompt: parsed.data.prompt,
                permissionMode: parsed.data.permissionMode ?? "yolo",
                modelSelection,
                ...(parsed.data.boundSessionId
                  ? { boundSessionId: parsed.data.boundSessionId }
                  : {}),
                workspacePath: workspace.workspacePath,
                ...(workspace.workspaceIdentity
                  ? { workspaceIdentity: workspace.workspaceIdentity }
                  : {}),
              });
              if (!result.ok) {
                await client.respond(request.id, {
                  ok: false,
                  failureStage: result.failureStage,
                  errorCategory: result.errorCategory,
                  errorCode: result.errorCode,
                });
                return;
              }
              await client.respond(request.id, {
                ok: true,
                task: toProtocolOffPeakTaskSnapshot(result.task),
              });
            } catch (error) {
              await respondOffPeakInternalError(client, request, workspace, error);
            }
          })();
          return;
        }

        if (request.method === cfProtocolMethods.offPeakList) {
          const parsed = cfOffPeakListParamsSchema.safeParse(request.params ?? {});
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid off-peak list params",
              data: parsed.error.flatten(),
            });
            return;
          }
          void (async () => {
            try {
              const offPeakTaskService = options?.resolveOffPeakTaskService?.();
              if (!offPeakTaskService) {
                await client.respondError(request.id, {
                  code: -32601,
                  message: "Off-peak task service is unavailable on this host",
                });
                return;
              }
              const workspaceKey = resolveWorkspaceKey(workspace);
              const tasks = (await offPeakTaskService.list())
                .filter((task) => task.workspaceKey === workspaceKey)
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, 20);
              await client.respond(request.id, {
                tasks: tasks.map(toProtocolOffPeakTaskSnapshot),
              });
            } catch (error) {
              await respondOffPeakInternalError(client, request, workspace, error);
            }
          })();
          return;
        }

        if (request.method === cfProtocolMethods.automationList) {
          const parsed = cfAutomationListParamsSchema.safeParse(request.params ?? {});
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid automation list params",
              data: parsed.error.flatten(),
            });
            return;
          }
          void (async () => {
            try {
              const automations = await automationService.list(workspace);
              await client.respond(request.id, {
                automations: automations.map(toProtocolAutomation),
              });
            } catch (error) {
              await client.respondError(request.id, {
                code: -32603,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          })();
          return;
        }

        if (request.method === cfProtocolMethods.automationCheckTaskBinding) {
          const parsed = cfAutomationCheckTaskBindingParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid automation task binding params",
              data: parsed.error.flatten(),
            });
            return;
          }
          void (async () => {
            try {
              const bound = await automationService.hasTaskBinding({
                workspacePath: workspace.workspacePath,
                workspaceIdentity: workspace.workspaceIdentity,
                targetTaskId: parsed.data.targetTaskId,
              });
              await client.respond(request.id, { bound });
            } catch (error) {
              await client.respondError(request.id, {
                code: -32603,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          })();
          return;
        }

        if (request.method === cfProtocolMethods.automationUpdate) {
          const parsed = cfAutomationUpdateParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid automation update params",
              data: parsed.error.flatten(),
            });
            return;
          }
          void (async () => {
            try {
              const automation = await automationService.update(
                parsed.data.automationId,
                {
                  title: parsed.data.title,
                  cronExpr: parsed.data.cronExpr,
                  prompt: parsed.data.prompt,
                  recurring: parsed.data.recurring,
                  maxRuns: parsed.data.maxRuns,
                  intervalUnit: parsed.data.intervalUnit,
                  interval: parsed.data.interval,
                },
                workspace,
              );
              if (!automation) {
                throw new Error("Scheduled task not found in the current workspace.");
              }
              await client.respond(request.id, {
                automation: toProtocolAutomation(automation),
              });
            } catch (error) {
              await client.respondError(request.id, {
                code: -32603,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          })();
          return;
        }

        if (request.method === cfProtocolMethods.automationDelete) {
          const parsed = cfAutomationDeleteParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid automation delete params",
              data: parsed.error.flatten(),
            });
            return;
          }
          void (async () => {
            try {
              const deleted = await automationService.delete(parsed.data.automationId, workspace);
              await client.respond(request.id, { deleted });
            } catch (error) {
              await client.respondError(request.id, {
                code: -32603,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          })();
          return;
        }

        void client.respondError(request.id, {
          code: -32601,
          message: `Unsupported CodeFusion Protocol request: ${request.method}`,
        });
      }),
      client.onClose(() => {
        invalidateWorkspaceClient(resolveWorkspaceKey(workspace), client);
      }),
    ];
    clientDisposables.set(client, disposables);
  }

  function rememberSessionTrace(
    target: CfAgentSessionTarget,
    snapshot: CfSessionStateSnapshot,
  ): TraceId | undefined {
    const traceId = snapshot.session.traceId as TraceId | undefined;
    if (traceId) {
      sessionTraceIdBySessionKey.set(sessionEventKey(target), traceId);
    }
    return traceId;
  }

  function getSessionTraceId(target: CfAgentSessionTarget): TraceId | undefined {
    return sessionTraceIdBySessionKey.get(sessionEventKey(target));
  }

  function createProviderNotReadyError(params: {
    snapshot?: CfAgentProviderReadinessSnapshot;
    workspace: CfAgentWorkspaceTarget;
  }): Error & {
    code: typeof CF_AGENT_PROVIDER_NOT_READY_CODE;
    data: {
      providerCount: number;
      reason: typeof CF_AGENT_PROVIDER_NOT_READY_REASON;
      revision: string | null;
      workspaceKey: string;
      workspacePath: string;
    };
  } {
    const workspaceKey = resolveWorkspaceKey(params.workspace);
    const error = new Error("No model provider or model is currently available. Please sign in or configure an API key first.") as Error & {
      code: typeof CF_AGENT_PROVIDER_NOT_READY_CODE;
      data: {
        providerCount: number;
        reason: typeof CF_AGENT_PROVIDER_NOT_READY_REASON;
        revision: string | null;
        workspaceKey: string;
        workspacePath: string;
      };
    };
    error.code = CF_AGENT_PROVIDER_NOT_READY_CODE;
    error.data = {
      providerCount: params.snapshot?.providerCount ?? 0,
      reason: CF_AGENT_PROVIDER_NOT_READY_REASON,
      revision: params.snapshot?.revision ?? null,
      workspaceKey,
      workspacePath: params.workspace.workspacePath,
    };
    return error;
  }

  function isProviderNotReadyError(
    error: unknown,
  ): error is Error & { code: typeof CF_AGENT_PROVIDER_NOT_READY_CODE } {
    return (
      error instanceof Error &&
      (error as { code?: unknown }).code === CF_AGENT_PROVIDER_NOT_READY_CODE
    );
  }

  async function resolveStartupReadiness(): Promise<
    CfAgentProviderReadinessSnapshot | undefined
  > {
    if (modelSelectionReadinessSource) {
      return createProviderReadinessSnapshotFromSelectionView(
        await modelSelectionReadinessSource.getView(),
      );
    }
    return undefined;
  }

  
  function isReusableActiveClientEntry(
    params: CfAgentWorkspaceTarget,
    active: ActiveWorkspaceClient | undefined,
  ): boolean {
    if (!active) {
      return false;
    }
    if (!active.client.isDisposed) {
      return true;
    }
    const workspaceKey = resolveWorkspaceKey(params);
    activeClientsByWorkspaceKey.delete(workspaceKey);
    interactionPreferenceSyncByWorkspaceKey.delete(workspaceKey);
    logger.warn(undefined, "Reused CodeFusion Protocol client has been disposed; cleaning up stale entry", {
      workspaceKey,
      workspacePath: params.workspacePath,
    });
    return false;
  }

  async function getOrStartReadOnlyClient(
    params: CfAgentWorkspaceTarget,
  ): Promise<ActiveWorkspaceClient> {
    const workspaceKey = resolveWorkspaceKey(params);
    const active = activeClientsByWorkspaceKey.get(workspaceKey);
    if (active && isReusableActiveClientEntry(params, active)) {
      active.workspace = params;
      await active.interactionPreferencesReady;
      return active;
    }

    const client = await processManager.getClient(params);
    wireClient(client, params, "chat");

    const concurrent = activeClientsByWorkspaceKey.get(workspaceKey);
    if (concurrent && isReusableActiveClientEntry(params, concurrent)) {
      concurrent.workspace = params;
      await concurrent.interactionPreferencesReady;
      return concurrent;
    }

    const entry: ActiveWorkspaceClient = {
      client,
      modelExecutionEnabled: false,
      workspace: params,
      dynamicWorkflowPolicyMode: "disabled",
    };
    activeClientsByWorkspaceKey.set(workspaceKey, entry);
    const interactionPreferencesReady = (async () => {
      let appliedSnapshot: CfAgentAppRuntimePreferences | undefined;
      while (latestAppRuntimePreferences && latestAppRuntimePreferences !== appliedSnapshot) {
        const snapshot = latestAppRuntimePreferences;
        await enqueueInteractionPreferenceSync({
          client,
          preferences: { ...snapshot },
          workspace: params,
        });
        appliedSnapshot = snapshot;
      }
    })();
    const offPeakToolPolicyReady = (async () => {
      if (!isOffPeakToolSupported(params)) return;
      try {
        await client.request(
          cfProtocolMethods.workspaceUpdateOffPeakToolPolicy,
          { workspace: buildWorkspaceRef(params), enabled: true },
          cfWorkspaceUpdateOffPeakToolPolicyResultSchema,
        );
      } catch (error) {
        if (!isProtocolMethodNotFoundError(error)) {
          logger.warn(undefined, "Failed to sync Off-Peak tool policy; CLI remains disabled by default", {
            workspaceKey,
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    const dynamicWorkflowPolicyReady = enqueueDynamicWorkflowPolicySync(entry);
    entry.interactionPreferencesReady = Promise.all([
      interactionPreferencesReady,
      offPeakToolPolicyReady,
      dynamicWorkflowPolicyReady,
    ]).then(() => undefined);
    try {
      await entry.interactionPreferencesReady;
    } catch (error) {
      if (activeClientsByWorkspaceKey.get(workspaceKey) === entry) {
        activeClientsByWorkspaceKey.delete(workspaceKey);
      }
      throw error;
    } finally {
      delete entry.interactionPreferencesReady;
    }
    logger.info(undefined, "Starting CodeFusion agent for read-only session control plane", {
      workspaceKey,
      workspacePath: params.workspacePath,
    });
    return entry;
  }

  async function getClient(params: CfAgentWorkspaceTarget) {
    const workspaceKey = resolveWorkspaceKey(params);
    const active = activeClientsByWorkspaceKey.get(workspaceKey);
    if (active?.modelExecutionEnabled && isReusableActiveClientEntry(params, active)) {
      active.workspace = params;
      return active.client;
    }

    const waiting: WaitingWorkspaceStartup = waitingWorkspaceStartups.get(workspaceKey) ?? {
      cancelled: false,
      workspace: params,
    };
    waiting.workspace = params;
    waitingWorkspaceStartups.set(workspaceKey, waiting);

    const starting = (waiting.starting ??= startModelExecutionClient(params, waiting));
    try {
      return await starting;
    } finally {
      if (waiting.starting === starting) delete waiting.starting;
    }
  }

  async function startModelExecutionClient(
    params: CfAgentWorkspaceTarget,
    waiting: WaitingWorkspaceStartup,
  ): Promise<CfProtocolClient> {
    const workspaceKey = resolveWorkspaceKey(params);
    const active = activeClientsByWorkspaceKey.get(workspaceKey);

    const readinessSnapshot = await resolveStartupReadiness();
    if (waiting.cancelled || waitingWorkspaceStartups.get(workspaceKey) !== waiting) {
      throw createRuntimeUnavailableError(params);
    }
    const readiness = readinessSnapshot?.readiness;
    if (!readinessSnapshot || !readiness?.ready) {
      const revision = readinessSnapshot?.revision ?? "missing";
      if (waiting.lastLoggedRevision !== revision) {
        waiting.lastLoggedRevision = revision;
        logger.info(
          undefined,
          active
            ? "provider/model is not ready; CodeFusion agent remains read-only"
            : "provider/model is not ready; CodeFusion agent remains unstarted",
          {
            providerCount: readinessSnapshot?.providerCount ?? 0,
            revision: readinessSnapshot?.revision ?? null,
            workspaceKey,
            workspacePath: params.workspacePath,
          },
        );
      }
      throw createProviderNotReadyError({ snapshot: readinessSnapshot, workspace: params });
    }

    const entry = await getOrStartReadOnlyClient(params);
    if (waiting.cancelled) {
      throw createRuntimeUnavailableError(params);
    }
    entry.modelExecutionEnabled = true;
    processManager.markReady(params, entry.client);
    entry.workspace = params;
    waitingWorkspaceStartups.delete(workspaceKey);
    logger.info(undefined, "provider/model is ready; allowing CodeFusion agent model execution", {
      modelId: readiness.modelId,
      providerId: readiness.providerId,
      revision: readinessSnapshot.revision,
      workspaceKey,
      workspacePath: params.workspacePath,
    });
    return entry.client;
  }

  async function getReadOnlyClient(
    params: CfAgentWorkspaceTarget,
    runtimePolicy: "start-if-needed" | "existing-only" = "start-if-needed",
  ) {
    if (runtimePolicy === "existing-only") {
      const workspaceKey = resolveWorkspaceKey(params);
      const active = activeClientsByWorkspaceKey.get(workspaceKey);
      if (active && isReusableActiveClientEntry(params, active)) {
        active.workspace = params;
        return active.client;
      }
      const existingClient = processManager.getExistingClient(params);
      if (!existingClient) {
        throw createRuntimeUnavailableError(params);
      }
      wireClient(existingClient, params, "chat");
      activeClientsByWorkspaceKey.set(workspaceKey, {
        client: existingClient,
        modelExecutionEnabled: false,
        workspace: params,
        dynamicWorkflowPolicyMode: "disabled",
      });
      return existingClient;
    }
    return (await getOrStartReadOnlyClient(params)).client;
  }

  async function getPluginManagementClient(): Promise<CfProtocolClient> {
    const workspace = { workspacePath: ensurePluginManagementWorkspacePath() };
    const client = await pluginProcessManager.getClient(workspace);
    wireClient(client, workspace, "plugin");
    return client;
  }

  async function getMcpStatusClient(): Promise<CfProtocolClient> {
    const workspace = { workspacePath: ensureMcpStatusWorkspacePath() };
    const client = await mcpStatusProcessManager.getClient(workspace);
    wireClient(client, workspace, "mcp-status");
    return client;
  }

  async function resolveSavedWorkflowCarrier(
    params: CfAgentSavedWorkflowTarget,
  ): Promise<{ client: CfProtocolClient; workspace: ReturnType<typeof buildWorkspaceRef> }> {
    if (savedWorkflowTargetHasWorkspace(params)) {
      return {
        client: await getReadOnlyClient(params),
        workspace: buildWorkspaceRef(params),
      };
    }
    const workspace = { workspacePath: ensurePluginManagementWorkspacePath() };
    return {
      client: await getPluginManagementClient(),
      workspace: buildWorkspaceRef(workspace),
    };
  }

  function isOffPeakToolSupported(params: CfAgentWorkspaceTarget): boolean {
    if (!options?.resolveOffPeakClientConfig || !options?.resolveOffPeakTaskService) return false;
    if (params.remoteSessionId) return false;
    if (params.workspaceIdentity) return false;
    return true;
  }

  function disposeLocalState(): void {
    activeClientsByWorkspaceKey.clear();
    interactionPreferenceSyncByWorkspaceKey.clear();
    dynamicWorkflowPolicySyncByWorkspaceKey.clear();
    waitingWorkspaceStartups.clear();
    sessionTraceIdBySessionKey.clear();
    sessionEventSequenceStates.clear();
    pendingPermissions.clear();
    pendingUserInputs.clear();
    pendingProviderRuntimeHeaders.clear();
    pendingSessionRuntimePreferences.clear();
    sessionEmitters.clear();
    providerRuntimeHeadersWorkspaceEmitters.clear();
    providerRuntimeHeadersCancelledEmitters.clear();
    pluginOperationProgressEmitters.clear();
    conversationFrameEmitters.clear();
    conversationTelemetryFactEmitters.clear();
    offPeakLifecycleEmitters.clear();
    sessionsIndexFrameEmitters.clear();
    workspaceConfigFrameEmitters.clear();
    v4SubscriptionRoutes.clear();
    v4RouteKeyByOwnership.clear();
  }

  function resolveDynamicWorkflowOffer(): Promise<DynamicWorkflowClientConfig | undefined> {
    const resolve = options?.resolveDynamicWorkflowClientConfig;
    if (!resolve) return Promise.resolve(undefined);
    dynamicWorkflowOffer ??= (async () => {
      try {
        return await resolve();
      } catch (error) {
        logger.warn(undefined, "Failed to read dynamic workflow canary status; treating as disabled", {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      }
    })();
    return dynamicWorkflowOffer;
  }

  
  async function resolveDynamicWorkflowUserMode(): Promise<DynamicWorkflowMode | undefined> {
    const read = options?.resolveDynamicWorkflowUserMode;
    if (!read) return pushedDynamicWorkflowUserMode;
    try {
      return normalizeDynamicWorkflowMode(await read());
    } catch (error) {
      logger.warn(undefined, "Failed to read dynamic workflow user selection; treating as follow server", {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  
  async function resolveDynamicWorkflowGate(): Promise<DynamicWorkflowMode> {
    if (!options?.resolveDynamicWorkflowClientConfig) return "disabled";
    const offer =
      (await resolveDynamicWorkflowOffer()) ??
      createDynamicWorkflowClientConfig(DEFAULT_DYNAMIC_WORKFLOW_MODE, "default");
    return applyDynamicWorkflowUserMode(offer, await resolveDynamicWorkflowUserMode()).mode;
  }

  
  function enqueueDynamicWorkflowPolicySync(entry: ActiveWorkspaceClient): Promise<void> {
    const workspaceKey = resolveWorkspaceKey(entry.workspace);
    const previous = dynamicWorkflowPolicySyncByWorkspaceKey.get(workspaceKey) ?? Promise.resolve();
    const current = previous.then(async () => {
      const mode = await resolveDynamicWorkflowGate();
      if (mode === entry.dynamicWorkflowPolicyMode) return;
      const enabled = isDynamicWorkflowModeEnabled(mode);
      try {
        await entry.client.request(
          cfProtocolMethods.workspaceUpdateDynamicWorkflowPolicy,
          { workspace: buildWorkspaceRef(entry.workspace), enabled, ...(enabled ? { mode } : {}) },
          cfWorkspaceUpdateDynamicWorkflowPolicyResultSchema,
        );
        entry.dynamicWorkflowPolicyMode = mode;
      } catch (error) {
        if (!isProtocolMethodNotFoundError(error)) {
          logger.warn(undefined, "Failed to sync dynamic workflow policy; CLI retains existing policy", {
            workspaceKey,
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });
    dynamicWorkflowPolicySyncByWorkspaceKey.set(workspaceKey, current);
    return current;
  }

  
  async function resolveDynamicWorkflowSessionFlags(): Promise<{
    dynamicWorkflowEnabled: boolean;
    dynamicWorkflowMode?: DynamicWorkflowMode;
  }> {
    const mode = await resolveDynamicWorkflowGate();
    return isDynamicWorkflowModeEnabled(mode)
      ? { dynamicWorkflowEnabled: true, dynamicWorkflowMode: mode }
      : { dynamicWorkflowEnabled: false };
  }

  async function buildConversationCommandEnvelope(
    params: CfAgentConversationCommandParams,
  ): Promise<CommandEnvelope> {
    const envelope = params.envelope;
    if (envelope.type === "createSession") {
      const { dynamicWorkflowEnabled, dynamicWorkflowMode } =
        await resolveDynamicWorkflowSessionFlags();
      const payload = commandPayloadSchemas.createSession.parse(envelope.payload);
      const sessionId =
        params.projectId !== undefined || options?.prepareSessionCreation
          ? `session_${createHash("sha256")
              .update(
                JSON.stringify([
                  resolveWorkspaceKey(params),
                  envelope.clientId,
                  envelope.commandId,
                ]),
              )
              .digest("hex")
              .slice(0, 32)}`
          : payload.sessionId;
      const additionalDirectories =
        params.projectId !== undefined || options?.prepareSessionCreation
          ? await options?.prepareSessionCreation?.({
              ...params,
              sessionId: sessionId!,
              projectId: params.projectId ?? null,
              additionalDirectories: payload.additionalDirectories,
            })
          : payload.additionalDirectories;
      if (params.projectId !== undefined && !options?.prepareSessionCreation)
        throw new Error("project.creation-unavailable");
      const offPeakToolEnabled = isOffPeakToolSupported(params);
      return {
        ...envelope,
        payload: {
          ...payload,
          ...(dynamicWorkflowEnabled ? { dynamicWorkflowEnabled: true, dynamicWorkflowMode } : {}),
          ...(sessionId ? { sessionId } : {}),
          ...(additionalDirectories !== undefined ? { additionalDirectories } : {}),
          ...(offPeakToolEnabled ? { offPeakToolEnabled: true } : {}),
        },
      };
    }
    if (envelope.type !== "sendText") return envelope;

    const payload = commandPayloadSchemas.sendText.parse(envelope.payload);
    if (payload.automationId) {
      return {
        ...envelope,
        payload: {
          ...payload,
          toolDisallowlist: mergeAutomationMutationToolDenylist(payload.toolDisallowlist ?? []),
        },
      };
    }
    if (payload.offPeakTaskId) {
      return {
        ...envelope,
        payload: {
          ...payload,
          toolDisallowlist: mergeOffPeakMutationToolDenylist(payload.toolDisallowlist ?? []),
        },
      };
    }
    return envelope;
  }

  return {
    async prepareStorage(params) {
      const client = await processManager.getClient(params);
      wireClient(client, params, "chat");
      await client.storageStartup.wait();
    },
    async getStorageStartupState(params) {
      return processManager.getStorageStartupState(params);
    },
    onDynamicStorageStartupState(params) {
      const workspaceKey = resolveWorkspaceKey(params);
      return (listener) =>
        processManager.onStorageStartupChanged((event) => {
          if (event.workspaceKey === workspaceKey) listener(event.snapshot);
        });
    },
    hasActiveCuaOperationTurn(): boolean {
      return cuaOperationTurnTracker?.hasActiveTurn() ?? false;
    },
    async initialize(params: CfAgentWorkspaceTarget): Promise<CfAgentInitializeResult> {
      const workspaceKey = resolveWorkspaceKey(params);
      const startedAt = Date.now();
      logger.info(undefined, "Starting CodeFusion agent initialization", {
        workspaceKey,
        workspacePath: params.workspacePath,
      });
      try {
        const client = await getClient(params);
        logger.info(undefined, "CodeFusion agent initialization completed", {
          durationMs: Date.now() - startedAt,
          transportKind: client.transportKind === "websocket" ? "websocket" : "stdio",
          workspaceKey,
          workspacePath: params.workspacePath,
        });
        return {
          available: true,
          workspaceKey,
          protocolName: CF_PROTOCOL_NAME,
          protocolVersion: CF_PROTOCOL_VERSION,
          transportKind: client.transportKind === "websocket" ? "websocket" : "stdio",
        };
      } catch (error) {
        const providerNotReady = isProviderNotReadyError(error);
        logger[providerNotReady ? "info" : "warn"](
          undefined,
          providerNotReady ? "CodeFusion agent waiting for provider/model to be ready" : "Failed to initialize CodeFusion agent",
          {
            durationMs: Date.now() - startedAt,
            message: error instanceof Error ? error.message : String(error),
            workspaceKey,
            workspacePath: params.workspacePath,
          },
        );
        return {
          available: false,
          workspaceKey,
          protocolName: CF_PROTOCOL_NAME,
          protocolVersion: CF_PROTOCOL_VERSION,
          reason: error instanceof Error ? error.message : String(error),
          ...(providerNotReady ? { reasonCode: CF_AGENT_PROVIDER_NOT_READY_REASON } : {}),
        };
      }
    },

    async syncDynamicWorkflowUserMode(params: { mode?: DynamicWorkflowMode }): Promise<void> {
      pushedDynamicWorkflowUserMode = normalizeDynamicWorkflowMode(params.mode);
      options?.forwardDynamicWorkflowUserMode?.(await resolveDynamicWorkflowUserMode());
      await Promise.all(
        [...activeClientsByWorkspaceKey.values()].map((entry) =>
          enqueueDynamicWorkflowPolicySync(entry),
        ),
      );
    },

    async syncAppRuntimePreferences(preferences: CfAgentAppRuntimePreferences): Promise<void> {
      const normalizedPreferences: CfAgentAppRuntimePreferences = {
        ...preferences,
        modelIoFullRetentionEnabled: preferences.modelIoFullRetentionEnabled === true,
      };
      latestAppRuntimePreferences = normalizedPreferences;
      const activeClients = [...activeClientsByWorkspaceKey.values()];
      await Promise.all(
        activeClients.map((entry) =>
          enqueueInteractionPreferenceSync({
            client: entry.client,
            preferences: { ...normalizedPreferences },
            workspace: entry.workspace,
          }),
        ),
      );
    },

    async getWorkspaceRuntimeIdentity(params: CfAgentWorkspaceTarget) {
      await getReadOnlyClient(params, "existing-only");
      return await processManager.getRuntimeIdentity(params);
    },

    async createSession(params: CfAgentCreateSessionParams) {
      if (options?.prepareSessionCreation) {
        const sessionId = params.sessionId ?? `session_${randomUUID()}`;
        const directories = await options.prepareSessionCreation({
          ...params,
          sessionId,
          projectId: params.projectId ?? null,
        });
        params = {
          ...params,
          sessionId,
          additionalDirectories: params.additionalDirectories ?? directories,
        };
      } else if (params.projectId !== undefined) {
        throw new Error("project.creation-unavailable");
      }
      const startedAt = Date.now();
      const client = await getClient(params);
      await ensureAccountProviderConfigSynced({
        client,
        reason: "session_create",
        workspace: params,
        refreshRegistry: true,
      });
      const sessionTraceId = params.sessionTraceId;
      logger.info(sessionTraceId, "Starting CodeFusion Protocol session/create request", {
        hasInitialModel: params.model !== undefined,
        hasInitialThoughtLevel: params.thoughtLevel !== undefined,
        initialModel: formatModelSelectionForLog(params.model),
        mcpServerCount: getMcpServerCount(params),
        mcpServerNames: getMcpServerNames(params),
        persistence: params.persistence,
        workspaceKey: resolveWorkspaceKey(params),
        workspacePath: params.workspacePath,
      });
      const offPeakToolEnabled = isOffPeakToolSupported(params);
      const dynamicWorkflowFlags = await resolveDynamicWorkflowSessionFlags();
      try {
        const snapshot = await client.request(
          cfProtocolMethods.sessionCreate,
          buildSessionCreateParams({ ...params, offPeakToolEnabled, ...dynamicWorkflowFlags }),
          cfSessionStateSnapshotSchema,
          sessionTraceId ? { trace: { traceId: sessionTraceId } } : undefined,
        );
        rememberSessionTrace({ ...params, sessionId: snapshot.session.sessionId }, snapshot);
        logger.info(sessionTraceId, "CodeFusion Protocol session/create completed", {
          durationMs: Date.now() - startedAt,
          messageCount: snapshot.messages.length,
          modelCurrent: formatModelSelectionForLog(snapshot.settings.model.current),
          mcpServerCount: getMcpServerCount(params),
          persistence: params.persistence,
          sessionId: snapshot.session.sessionId,
          snapshotTraceId: snapshot.session.traceId ?? null,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        return snapshot;
      } catch (error) {
        const compatFields = getSessionCreateCompatFields(error);
        if (compatFields.length === 0) {
          logger.warn(sessionTraceId, "CodeFusion Protocol session/create failed", {
            durationMs: Date.now() - startedAt,
            message: error instanceof Error ? error.message : String(error),
            persistence: params.persistence,
            workspaceKey: resolveWorkspaceKey(params),
            workspacePath: params.workspacePath,
          });
          throw error;
        }
        logger.warn(sessionTraceId, "CodeFusion Protocol session/create triggered legacy protocol compatibility retry", {
          compatFields,
          durationMs: Date.now() - startedAt,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        const snapshot = await client.request(
          cfProtocolMethods.sessionCreate,
          buildSessionCreateParams(
            { ...params, offPeakToolEnabled, ...dynamicWorkflowFlags },
            new Set(compatFields),
          ),
          cfSessionStateSnapshotSchema,
          sessionTraceId ? { trace: { traceId: sessionTraceId } } : undefined,
        );
        rememberSessionTrace({ ...params, sessionId: snapshot.session.sessionId }, snapshot);
        if (!compatFields.includes("thoughtLevel") || !params.thoughtLevel) {
          logger.info(sessionTraceId, "CodeFusion Protocol session/create compatibility retry completed", {
            durationMs: Date.now() - startedAt,
            sessionId: snapshot.session.sessionId,
            snapshotTraceId: snapshot.session.traceId ?? null,
            workspaceKey: resolveWorkspaceKey(params),
            workspacePath: params.workspacePath,
          });
          return snapshot;
        }
        const snapshotWithThoughtLevel = await client.request(
          cfProtocolMethods.sessionSetThoughtLevel,
          {
            sessionId: snapshot.session.sessionId,
            thoughtLevel: params.thoughtLevel,
            persistAsWorkspaceLastUsed: true,
          },
          cfSessionStateSnapshotSchema,
          sessionTraceId ? { trace: { traceId: sessionTraceId } } : undefined,
        );
        rememberSessionTrace(
          { ...params, sessionId: snapshotWithThoughtLevel.session.sessionId },
          snapshotWithThoughtLevel,
        );
        logger.info(
          sessionTraceId,
          "Setting thoughtLevel completed after CodeFusion Protocol session/create compatibility retry",
          {
            durationMs: Date.now() - startedAt,
            sessionId: snapshot.session.sessionId,
            snapshotTraceId: snapshotWithThoughtLevel.session.traceId ?? null,
            workspaceKey: resolveWorkspaceKey(params),
            workspacePath: params.workspacePath,
          },
        );
        return snapshotWithThoughtLevel;
      }
    },

    async resumeSession(params: CfAgentResumeSessionParams) {
      params = {
        ...params,
        additionalDirectories:
          params.additionalDirectories ?? (await options?.resolveSessionDirectories?.(params)),
      };
      const startedAt = Date.now();
      const client = await getClient(params);
      await ensureAccountProviderConfigSynced({
        client,
        reason: "session_resume",
        workspace: params,
        refreshRegistry: true,
      });
      const cachedTraceId = getSessionTraceId(params);
      const offPeakToolEnabled = isOffPeakToolSupported(params);
      const dynamicWorkflowFlags = await resolveDynamicWorkflowSessionFlags();
      logger.info(cachedTraceId, "Starting CodeFusion Protocol session/resume request", {
        mcpServerCount: getMcpServerCount(params),
        mcpServerNames: getMcpServerNames(params),
        modelHint: params.model ?? null,
        sessionId: params.sessionId,
        workspaceKey: resolveWorkspaceKey(params),
        workspacePath: params.workspacePath,
      });
      try {
        const snapshot = await client.request(
          cfProtocolMethods.sessionResume,
          buildSessionResumeParams({ ...params, offPeakToolEnabled, ...dynamicWorkflowFlags }),
          cfSessionStateSnapshotSchema,
        );
        const sessionTraceId = rememberSessionTrace(params, snapshot) ?? cachedTraceId;
        logger.info(sessionTraceId, "CodeFusion Protocol session/resume completed", {
          durationMs: Date.now() - startedAt,
          messageCount: snapshot.messages.length,
          modelCurrent: formatModelSelectionForLog(snapshot.settings.model.current),
          mcpServerCount: getMcpServerCount(params),
          sessionId: params.sessionId,
          snapshotTraceId: snapshot.session.traceId ?? null,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        return snapshot;
      } catch (error) {
        const compatFields = getSessionResumeCompatFields(error);
        if (compatFields.length === 0) {
          logger.warn(cachedTraceId, "CodeFusion Protocol session/resume failed", {
            durationMs: Date.now() - startedAt,
            message: error instanceof Error ? error.message : String(error),
            sessionId: params.sessionId,
            workspaceKey: resolveWorkspaceKey(params),
            workspacePath: params.workspacePath,
          });
          throw error;
        }
        logger.warn(cachedTraceId, "CodeFusion Protocol session/resume triggered legacy protocol compatibility retry", {
          compatFields,
          durationMs: Date.now() - startedAt,
          sessionId: params.sessionId,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        const snapshot = await client.request(
          cfProtocolMethods.sessionResume,
          buildSessionResumeParams(
            { ...params, offPeakToolEnabled, ...dynamicWorkflowFlags },
            new Set(compatFields),
          ),
          cfSessionStateSnapshotSchema,
        );
        const sessionTraceId = rememberSessionTrace(params, snapshot) ?? cachedTraceId;
        logger.info(sessionTraceId, "CodeFusion Protocol session/resume compatibility retry completed", {
          durationMs: Date.now() - startedAt,
          sessionId: params.sessionId,
          snapshotTraceId: snapshot.session.traceId ?? null,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        return snapshot;
      }
    },

    async listSessions(params: CfAgentListSessionsParams) {
      const client = await getReadOnlyClient(params, params.runtimePolicy);
      const result = await client.request(
        cfProtocolMethods.sessionList,
        {
          workspace: buildWorkspaceRef(params),
          limit: params.limit,
          ...(params.sessionIds ? { sessionIds: params.sessionIds } : {}),
        },
        cfSessionListResultSchema,
      );
      for (const session of result.sessions) {
        if (session.traceId) {
          sessionTraceIdBySessionKey.set(
            sessionEventKey({ ...params, sessionId: session.sessionId }),
            session.traceId as TraceId,
          );
        }
      }
      return result.sessions;
    },

    async listSessionSubagents(params: CfAgentListSessionSubagentsParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        cfProtocolMethods.sessionSubagents,
        {
          sessionId: params.sessionId,
          endedCursor: params.endedCursor,
          endedLimit: params.endedLimit ?? 20,
        },
        cfSessionSubagentsResultSchema,
      );
    },

    async getAppUsageStats(params: CfAgentAppUsageParams) {
      const active = activeClientsByWorkspaceKey.values().next().value;
      if (!active) {
        throw new Error("no_active_workspace");
      }
      return active.client.request(
        V4_METHODS.usageStats,
        { range: params.range, timeZone: params.timeZone },
        v4UsageStatsResultSchema,
      );
    },

    async getTaskTokenUsage(params: CfAgentTaskTokenUsageParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationUsage,
        { sessionId: params.sessionId },
        v4ConversationUsageResultSchema,
      );
    },

    async readSession(params: CfAgentReadSessionParams) {
      const client = await getReadOnlyClient(params, params.runtimePolicy);
      if (params.runtimePolicy !== "existing-only") {
        await ensureAccountProviderConfigSynced({
          client,
          reason: "session_read",
          workspace: params,
        });
      }
      const snapshot = await client.request(
        cfProtocolMethods.sessionRead,
        {
          sessionId: params.sessionId,
          deliveryKind: params.deliveryKind,
          messageLimit: params.messageLimit,
          afterSeq: params.afterSeq,
          contentProfile: params.contentProfile,
        },
        cfSessionStateSnapshotSchema,
      );
      rememberSessionTrace(params, snapshot);
      return snapshot;
    },

    async readSessionMessages(params: CfAgentReadSessionMessagesParams) {
      const client = await getReadOnlyClient(params);
      const result = await client.request(
        cfProtocolMethods.sessionMessages,
        {
          sessionId: params.sessionId,
          afterMessageId: params.afterMessageId,
          limit: params.limit,
        },
        cfSessionMessagesResultSchema,
      );
      return result.messages;
    },

    async readSessionDebug(params) {
      const client = await getReadOnlyClient(params, "existing-only");
      return client.request(
        cfProtocolMethods.sessionDebug,
        { sessionId: params.sessionId },
        sessionDebugSnapshotSchema,
      );
    },

    async readSessionEvents(params: CfAgentReadSessionEventsParams) {
      const client = await getReadOnlyClient(params);
      const result = await client.request(
        cfProtocolMethods.sessionEvents,
        {
          sessionId: params.sessionId,
          afterSeq: params.afterSeq,
          limit: params.limit,
        },
        cfSessionEventsResultSchema,
      );
      return result.events;
    },

    async readWorkspacePresentation(params: CfAgentReadWorkspacePresentationParams) {
      const startedAt = Date.now();
      logger.info(undefined, "Starting CodeFusion Protocol workspace/readPresentation request", {
        workspaceKey: resolveWorkspaceKey(params),
        workspacePath: params.workspacePath,
      });
      try {
        let presentation: CfWorkspacePresentation | undefined;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const client = await getReadOnlyClient(params);
          try {
            await ensureAccountProviderConfigSynced({
              client,
              reason: "workspace_read_presentation",
              workspace: params,
            });
            presentation = await client.request(
              cfProtocolMethods.workspaceReadPresentation,
              { workspace: buildWorkspaceRef(params) },
              cfWorkspacePresentationSchema,
            );
            break;
          } catch (error) {
            if (attempt > 0 || !isClosedStdioTransportError(error)) {
              throw error;
            }
            logger.warn(
              undefined,
              "workspace/readPresentation encountered closed transport; re-acquiring Agent",
              {
                workspaceKey: resolveWorkspaceKey(params),
                workspacePath: params.workspacePath,
              },
            );
            const workspaceKey = resolveWorkspaceKey(params);
            if (activeClientsByWorkspaceKey.get(workspaceKey)?.client === client) {
              invalidateWorkspaceClient(workspaceKey, client);
            }
          }
        }
        if (!presentation) {
          throw new Error("CodeFusion Protocol workspace/readPresentation did not return a result");
        }
        logger.info(undefined, "CodeFusion Protocol workspace/readPresentation completed", {
          durationMs: Date.now() - startedAt,
          slashCommandCount: presentation.slashCommands.length,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        return presentation;
      } catch (error) {
        logger.warn(undefined, "CodeFusion Protocol workspace/readPresentation failed", {
          durationMs: Date.now() - startedAt,
          message: error instanceof Error ? error.message : String(error),
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        throw error;
      }
    },

    async grantWorkspaceHookTrust(params: CfAgentGrantWorkspaceHookTrustParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        cfProtocolMethods.workspaceHookTrustGrant,
        {
          workspace: buildWorkspaceRef(params),
          bundleDigest: params.bundleDigest,
          hookDeclarationDigest: params.hookDeclarationDigest,
        },
        cfWorkspaceHookTrustGrantResultSchema,
      );
    },

    async listMcpServerStatuses(params: CfAgentListMcpServerStatusesParams) {
      const requestMcpList = async (options?: { omitMcpServers?: boolean; omitMode?: boolean }) => {
        const client = await getMcpStatusClient();
        return client.request(
          cfProtocolMethods.mcpList,
          {
            workspace: buildWorkspaceRef(params),
            ...(params.mcpServers !== undefined && !options?.omitMcpServers
              ? { mcpServers: params.mcpServers }
              : {}),
            ...(params.mode !== undefined && !options?.omitMode ? { mode: params.mode } : {}),
          },
          cfMcpListResultSchema,
        );
      };
      try {
        return await requestMcpList();
      } catch (error) {
        const unrecognizedKeys = getUnrecognizedTopLevelKeys(error);
        if (params.mode === "status" && unrecognizedKeys.includes("mode")) {
          logger.warn(undefined, "Legacy Agent does not support MCP status-only; skipping compatibility retry that would alter connection set", {
            workspaceKey: resolveWorkspaceKey(params),
            workspacePath: params.workspacePath,
          });
          throw new CfAgentMcpStatusModeUnsupportedError();
        }
        if (
          (params.mode !== undefined && unrecognizedKeys.includes("mode")) ||
          (params.mcpServers !== undefined && unrecognizedKeys.includes("mcpServers"))
        ) {
          const omitMode = unrecognizedKeys.includes("mode");
          const omitMcpServers = unrecognizedKeys.includes("mcpServers");
          logger.warn(undefined, "MCP status list triggered legacy protocol compatibility retry", {
            omittedKeys: [...(omitMode ? ["mode"] : []), ...(omitMcpServers ? ["mcpServers"] : [])],
            workspaceKey: resolveWorkspaceKey(params),
            workspacePath: params.workspacePath,
          });
          return await requestMcpList({
            omitMcpServers,
            omitMode,
          });
        }
        if (!isProtocolRequestTimeout(error, cfProtocolMethods.mcpList)) {
          throw error;
        }
        logger.warn(undefined, "MCP status list request timed out; restarting unresponsive agent and retrying once", {
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
          message: error instanceof Error ? error.message : String(error),
        });
        return await requestMcpList();
      }
    },

    async listPlugins(params: CfAgentPluginViewParams) {
      const requestPluginsList = async () => {
        const client = await getPluginManagementClient();
        return client.request(
          cfProtocolMethods.pluginsList,
          {
            workspace: buildWorkspaceRef(params),
            ...(params.configScope ? { configScope: params.configScope } : {}),
          },
          cfPluginsListResultSchema,
        );
      };
      try {
        return await requestPluginsList();
      } catch (error) {
        if (!isProtocolRequestTimeout(error, cfProtocolMethods.pluginsList)) {
          throw error;
        }
        logger.warn(undefined, "Plugin list request timed out; restarting unresponsive agent and retrying once", {
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
          message: error instanceof Error ? error.message : String(error),
        });
        return await requestPluginsList();
      }
    },

    async getPluginReferenceCatalog(params: CfAgentPluginReferenceCatalogParams) {
      const client = await getReadOnlyClient(params);
      return requestPluginReferenceCatalog(client, {
        workspace: buildWorkspaceRef(params),
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      });
    },

    async getSkillReferenceCatalog(params: CfAgentSkillReferenceCatalogParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        cfProtocolMethods.skillsReferenceCatalog,
        {
          workspace: buildWorkspaceRef(params),
          ...(params.sessionId ? { sessionId: params.sessionId } : {}),
        },
        cfSkillsReferenceCatalogResultSchema,
      );
    },

    async openMcpUiInstance(params) {
      const client = await getReadOnlyClient(params);
      return client.request(
        cfProtocolMethods.mcpUiOpenInstance,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          pluginId: params.pluginId,
          serverName: params.serverName,
          scopeId: params.scopeId,
          accountContext: params.accountContext,
          resourceUri: params.resourceUri,
          ownerWebContentsId: params.ownerWebContentsId,
        },
        cfMcpUiOpenInstanceResultSchema,
      );
    },
    async validateMcpUiInstance(params) {
      const client = await getReadOnlyClient(params);
      await client.request(
        cfProtocolMethods.mcpUiValidateInstance,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          pluginId: params.pluginId,
          serverName: params.serverName,
          instance: params.instance,
        },
        mcpUiEmptyResultSchema,
      );
    },
    async recycleMcpUiInstance(params) {
      const client = await getReadOnlyClient(params);
      const result = await client.request(
        cfProtocolMethods.mcpUiCloseInstance,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          pluginId: params.pluginId,
          serverName: params.serverName,
          instance: params.instance,
          onlyIfIdle: true,
        },
        cfMcpUiCloseInstanceResultSchema,
      );
      return result.closed;
    },
    async closeMcpUiInstance(params) {
      const client = await getReadOnlyClient(params);
      await client.request(
        cfProtocolMethods.mcpUiCloseInstance,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          pluginId: params.pluginId,
          serverName: params.serverName,
          instance: params.instance,
        },
        cfMcpUiCloseInstanceResultSchema,
      );
    },
    async readMcpResource(params: CfAgentReadMcpResourceParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        cfProtocolMethods.mcpReadResource,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          uri: params.uri,
        },
        cfMcpReadResourceResultSchema,
      );
    },

    async sampleMcpApp(params) {
      const client = await getReadOnlyClient(params, "existing-only");
      const { workspacePath: _path, workspaceIdentity: _identity, ...bound } = params;
      const wire = { ...bound, workspace: buildWorkspaceRef(params) };
      try {
        return await client.request(
          cfProtocolMethods.mcpUiSampling,
          wire,
          cfMcpUiSamplingResultSchema,
          { timeoutMs: MCP_APPS_SAMPLING_TRANSPORT_TIMEOUT_MS },
        );
      } catch (error) {
        const { request: _request, ...cancelParams } = wire;
        void client
          .request(
            cfProtocolMethods.mcpUiCancelSampling,
            cancelParams,
            cfMcpUiCancelCallResultSchema,
          )
          .catch(() => undefined);
        throw error;
      }
    },
    async cancelMcpAppSampling(params) {
      const client = await getReadOnlyClient(params, "existing-only");
      const { workspacePath: _path, workspaceIdentity: _identity, ...bound } = params;
      return client.request(
        cfProtocolMethods.mcpUiCancelSampling,
        { ...bound, workspace: buildWorkspaceRef(params) },
        cfMcpUiCancelCallResultSchema,
      );
    },
    async callMcpToolForUi(params: CfAgentCallMcpToolForUiParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        cfProtocolMethods.mcpUiCallTool,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          toolName: params.toolName,
          ...(params.arguments ? { arguments: params.arguments } : {}),
          callId: params.callId,
        },
        cfMcpUiCallToolResultSchema,
      );
    },

    async cancelMcpToolCallForUi(params: CfAgentCancelMcpToolCallForUiParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        cfProtocolMethods.mcpUiCancelCall,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          callId: params.callId,
        },
        cfMcpUiCancelCallResultSchema,
      );
    },

    async readMcpResourceForUi(params: CfAgentReadMcpResourceForUiParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        cfProtocolMethods.mcpUiReadResource,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          uri: params.uri,
        },
        cfMcpUiReadResourceResultSchema,
      );
    },

    async listMcpResourcesForUi(params: CfAgentListMcpResourcesForUiParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        cfProtocolMethods.mcpUiListResources,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          ...(params.cursor ? { cursor: params.cursor } : {}),
        },
        cfMcpUiListResourcesResultSchema,
      );
    },

    async listMcpResourceTemplatesForUi(params: CfAgentListMcpResourcesForUiParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        cfProtocolMethods.mcpUiListResourceTemplates,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          ...(params.cursor ? { cursor: params.cursor } : {}),
        },
        cfMcpUiListResourceTemplatesResultSchema,
      );
    },

    async subscribeMcpResourceForUi(params: CfAgentMcpResourceSubscriptionForUiParams) {
      const client = await getReadOnlyClient(params);
      await client.request(
        cfProtocolMethods.mcpUiSubscribeResource,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          scopeId: params.scopeId,
          generation: params.generation,
          uri: params.uri,
        },
        cfMcpUiResourceSubscriptionResultSchema,
      );
    },

    async unsubscribeMcpResourceForUi(params: CfAgentMcpResourceSubscriptionForUiParams) {
      const client = await getReadOnlyClient(params);
      await client.request(
        cfProtocolMethods.mcpUiUnsubscribeResource,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          scopeId: params.scopeId,
          generation: params.generation,
          uri: params.uri,
        },
        cfMcpUiResourceSubscriptionResultSchema,
      );
    },

    async registerAppToolsForUi(params: CfAgentRegisterAppToolsForUiParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        cfProtocolMethods.mcpUiRegisterAppTools,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          scopeId: params.scopeId,
          generation: params.generation,
          tools: params.tools,
        },
        cfMcpUiRegisterAppToolsResultSchema,
      );
    },

    async unregisterAppToolsForUi(params: CfAgentAppToolInstanceForUiParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        cfProtocolMethods.mcpUiUnregisterAppTools,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          scopeId: params.scopeId,
          generation: params.generation,
        },
        cfMcpUiUnregisterAppToolsResultSchema,
      );
    },

    async claimAppToolCallForUi(params: CfAgentAppToolCallForUiParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        cfProtocolMethods.mcpUiClaimAppToolCall,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          scopeId: params.scopeId,
          generation: params.generation,
          callId: params.callId,
        },
        cfMcpUiAppToolAcceptedResultSchema,
      );
    },

    async resolveAppToolCallForUi(params: CfAgentResolveAppToolCallForUiParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        cfProtocolMethods.mcpUiResolveAppToolCall,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          scopeId: params.scopeId,
          generation: params.generation,
          callId: params.callId,
          ...(params.result ? { result: params.result } : {}),
          ...(params.error ? { error: params.error } : {}),
        },
        cfMcpUiAppToolAcceptedResultSchema,
      );
    },

    async listPluginUiSurfaces(params: CfAgentWorkspaceTarget) {
      const client = await getReadOnlyClient(params);
      return client.request(
        cfProtocolMethods.pluginsListUiSurfaces,
        { workspace: buildWorkspaceRef(params) },
        cfPluginsListUiSurfacesResultSchema,
      );
    },

    async listSavedWorkflows(params: CfAgentListSavedWorkflowsParams) {
      const { client, workspace } = await resolveSavedWorkflowCarrier(params);
      return client.request(
        cfProtocolMethods.workflowsList,
        { workspace, ...savedWorkflowScopeParam(params) },
        cfWorkflowsListResultSchema,
      );
    },

    async getSavedWorkflow(params: CfAgentGetSavedWorkflowParams) {
      const { client, workspace } = await resolveSavedWorkflowCarrier(params);
      return client.request(
        cfProtocolMethods.workflowsGet,
        { workspace, name: params.name, ...savedWorkflowScopeParam(params) },
        cfWorkflowsGetResultSchema,
      );
    },

    async updateSavedWorkflowMeta(params: CfAgentUpdateSavedWorkflowMetaParams) {
      const { client, workspace } = await resolveSavedWorkflowCarrier(params);
      return client.request(
        cfProtocolMethods.workflowsUpdateMeta,
        { workspace, name: params.name, meta: params.meta, ...savedWorkflowScopeParam(params) },
        cfWorkflowsUpdateMetaResultSchema,
      );
    },

    async deleteSavedWorkflow(params: CfAgentDeleteSavedWorkflowParams) {
      const { client, workspace } = await resolveSavedWorkflowCarrier(params);
      return client.request(
        cfProtocolMethods.workflowsDelete,
        { workspace, name: params.name, ...savedWorkflowScopeParam(params) },
        cfWorkflowsDeleteResultSchema,
      );
    },

    async listSavedWorkflowRuns(params: CfAgentListSavedWorkflowRunsParams) {
      const { client, workspace } = await resolveSavedWorkflowCarrier(params);
      return client.request(
        cfProtocolMethods.workflowsRuns,
        {
          workspace,
          ...(params.name === undefined ? {} : { name: params.name }),
          limit: params.limit,
          ...savedWorkflowScopeParam(params),
        },
        cfWorkflowsRunsResultSchema,
      );
    },

    async moveSavedWorkflow(params: CfAgentMoveSavedWorkflowParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        cfProtocolMethods.workflowsMove,
        { workspace: buildWorkspaceRef(params), name: params.name },
        cfWorkflowsMoveResultSchema,
      );
    },

    async saveSavedWorkflowFromRun(params: CfAgentSaveSavedWorkflowFromRunParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        cfProtocolMethods.workflowsSave,
        {
          workspace: buildWorkspaceRef(params),
          runId: params.runId,
          name: params.name,
          meta: params.meta,
          ...(params.scope === undefined ? {} : { scope: params.scope }),
          ...(params.overwrite === undefined ? {} : { overwrite: params.overwrite }),
        },
        cfWorkflowsSaveResultSchema,
      );
    },

    async findSavedWorkflowForRun(params: CfAgentFindSavedWorkflowForRunParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        cfProtocolMethods.workflowsForRun,
        {
          workspace: buildWorkspaceRef(params),
          runId: params.runId,
          ...(params.candidates === undefined ? {} : { candidates: [...params.candidates] }),
        },
        cfWorkflowsForRunResultSchema,
      );
    },

    async resolveSuggestedPluginReference(params: CfAgentResolveSuggestedPluginReferenceParams) {
      const client = await getPluginManagementClient();
      return client.request(
        cfProtocolMethods.pluginsResolveSuggestedReference,
        {
          workspace: buildWorkspaceRef(params),
          stableId: params.stableId,
          operationId: params.operationId,
          clientMode: params.clientMode,
          deliveryKind: params.deliveryKind,
        },
        cfPluginsResolveSuggestedReferenceResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    onDynamicPluginOperationProgress(operationId: string) {
      return getPluginOperationProgressEmitter(operationId).event;
    },

    async collectLocalRuntimeChildProcesses(signal?: AbortSignal) {
      const managed = [processManager, pluginProcessManager, mcpStatusProcessManager]
        .flatMap((manager) => manager.listManagedProcesses())
        .filter(
          (runtime) => !runtime.client.isDisposed && !runtime.client.storageStartup.isWaiting,
        );
      return Promise.all(
        managed.map(async (runtime) => {
          let children: CfProcessChildProcess[] = [];
          try {
            const result = await runtime.client.request(
              cfProtocolMethods.processChildProcesses,
              {},
              cfProcessChildProcessesResultSchema,
              { timeoutMs: CHILD_PROCESSES_REQUEST_TIMEOUT_MS, lifecycle: "observation", signal },
            );
            children = result.processes;
          } catch {
          }
          return {
            pid: runtime.pid,
            provider: CF_AGENT_PROVIDER,
            workspacePath: runtime.workspacePath,
            ...(runtime.lane ? { lane: runtime.lane } : {}),
            children,
          };
        }),
      );
    },

    async getPluginsOverview(params: CfAgentPluginViewParams) {
      const client = await getPluginManagementClient();
      return client.request(
        cfProtocolMethods.pluginsOverview,
        {
          workspace: buildWorkspaceRef(params),
          ...(params.configScope ? { configScope: params.configScope } : {}),
        },
        cfPluginsOverviewResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async addPluginMarketplace(params: CfAgentAddPluginMarketplaceParams) {
      const client = await getPluginManagementClient();
      return client.request(
        cfProtocolMethods.pluginsMarketplaceAdd,
        {
          workspace: buildWorkspaceRef(params),
          source: params.source,
          ...(params.dryRun !== undefined ? { dryRun: params.dryRun } : {}),
          ...(params.operationId ? { operationId: params.operationId } : {}),
        },
        cfPluginsMarketplaceMutationResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async removePluginMarketplace(params: CfAgentRemovePluginMarketplaceParams) {
      const client = await getPluginManagementClient();
      return client.request(
        cfProtocolMethods.pluginsMarketplaceRemove,
        {
          workspace: buildWorkspaceRef(params),
          marketplace: params.marketplace,
        },
        cfPluginsMarketplaceMutationResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async updatePluginMarketplace(params: CfAgentUpdatePluginMarketplaceParams) {
      const client = await getPluginManagementClient();
      return client.request(
        cfProtocolMethods.pluginsMarketplaceUpdate,
        {
          workspace: buildWorkspaceRef(params),
          ...(params.marketplace ? { marketplace: params.marketplace } : {}),
          ...(params.operationId ? { operationId: params.operationId } : {}),
        },
        cfPluginsMarketplaceMutationResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async installPlugin(params: CfAgentInstallPluginParams) {
      const client = await getPluginManagementClient();
      return client.request(
        cfProtocolMethods.pluginsInstall,
        {
          workspace: buildWorkspaceRef(params),
          pluginName: params.pluginName,
          marketplace: params.marketplace,
          ...(params.scope ? { scope: params.scope } : {}),
          ...(params.dryRun !== undefined ? { dryRun: params.dryRun } : {}),
          ...(params.operationId ? { operationId: params.operationId } : {}),
        },
        cfPluginsInstallResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async cancelPluginOperation(params: CfAgentCancelPluginOperationParams) {
      const client = await getPluginManagementClient();
      return client.request(
        cfProtocolMethods.pluginsCancelOperation,
        { operationId: params.operationId },
        cfPluginsCancelOperationResultSchema,
        { timeoutMs: PLUGIN_OPERATION_CANCEL_REQUEST_TIMEOUT_MS },
      );
    },

    async uninstallPlugin(params: CfAgentUninstallPluginParams) {
      const client = await getPluginManagementClient();
      return client.request(
        cfProtocolMethods.pluginsUninstall,
        {
          workspace: buildWorkspaceRef(params),
          ...(params.pluginId ? { pluginId: params.pluginId } : {}),
          ...(params.pluginName ? { pluginName: params.pluginName } : {}),
          ...(params.marketplace ? { marketplace: params.marketplace } : {}),
          ...(params.removeCache !== undefined ? { removeCache: params.removeCache } : {}),
        },
        cfPluginsUninstallResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async updatePlugin(params: CfAgentUpdatePluginParams) {
      const client = await getPluginManagementClient();
      return client.request(
        cfProtocolMethods.pluginsUpdate,
        {
          workspace: buildWorkspaceRef(params),
          ...(params.pluginId ? { pluginId: params.pluginId } : {}),
          ...(params.marketplace ? { marketplace: params.marketplace } : {}),
        },
        cfPluginsInstallResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async restoreBuiltinPlugin(params: CfAgentRestoreBuiltinPluginParams) {
      const client = await getPluginManagementClient();
      return client.request(
        cfProtocolMethods.pluginsRestoreBuiltin,
        {
          workspace: buildWorkspaceRef(params),
          pluginId: params.pluginId,
        },
        cfPluginsRestoreBuiltinResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async configurePlugin(params: CfAgentConfigurePluginParams) {
      const client = await getPluginManagementClient();
      return client.request(
        cfProtocolMethods.pluginsConfigure,
        {
          workspace: buildWorkspaceRef(params),
          pluginId: params.pluginId,
          options: params.options,
          ...(params.clearOptionKeys?.length ? { clearOptionKeys: params.clearOptionKeys } : {}),
          ...(params.scope ? { scope: params.scope } : {}),
          ...(params.dryRun !== undefined ? { dryRun: params.dryRun } : {}),
        },
        cfPluginsConfigureResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async resetPluginConfig(params: CfAgentResetPluginConfigParams) {
      const client = await getPluginManagementClient();
      return client.request(
        cfProtocolMethods.pluginsResetConfig,
        {
          workspace: buildWorkspaceRef(params),
          pluginId: params.pluginId,
          ...(params.scope ? { scope: params.scope } : {}),
        },
        cfPluginsConfigureResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async validatePlugin(params: CfAgentValidatePluginParams) {
      const client = await getPluginManagementClient();
      return client.request(
        cfProtocolMethods.pluginsValidate,
        {
          workspace: buildWorkspaceRef(params),
          ...(params.pluginName ? { pluginName: params.pluginName } : {}),
          ...(params.marketplace ? { marketplace: params.marketplace } : {}),
          ...(params.source ? { source: params.source } : {}),
        },
        cfPluginsValidateResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async describePlugin(params: CfAgentDescribePluginParams) {
      const client = await getPluginManagementClient();
      return client.request(
        cfProtocolMethods.pluginsDescribe,
        {
          workspace: buildWorkspaceRef(params),
          marketplace: params.marketplace,
          pluginName: params.pluginName,
        },
        cfPluginsDescribeResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async setPluginEnabled(params: CfAgentSetPluginEnabledParams) {
      const client = await getPluginManagementClient();
      return client.request(
        cfProtocolMethods.pluginsSetEnabled,
        {
          workspace: buildWorkspaceRef(params),
          pluginId: params.pluginId,
          enabled: params.enabled,
          ...(params.operationId ? { operationId: params.operationId } : {}),
          ...(params.scope ? { scope: params.scope } : {}),
        },
        cfPluginsSetEnabledResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async listAutomations(params: CfAgentWorkspaceTarget) {
      return automationService.list(params);
    },

    async listAllAutomations() {
      return automationService.list();
    },

    async createAutomation(params: CfAgentCreateAutomationParams) {
      return automationService.create({
        projectId: params.projectId,
        title: params.title,
        cronExpr: params.cronExpr,
        relativeDelayMinutes: params.relativeDelayMinutes,
        prompt: params.prompt,
        modelSelection: params.modelSelection,
        mode: params.mode as CfTaskMode | undefined,
        workspacePath: params.workspacePath,
        workspaceIdentity: params.workspaceIdentity,
        recurring: params.recurring ?? true,
        maxRuns: params.maxRuns,
        endAt: params.endAt,
        scheduleRule: params.scheduleRule,
      });
    },

    async updateAutomation(params: CfAgentUpdateAutomationParams) {
      return automationService.update(
        params.automationId,
        {
          title: params.title,
          cronExpr: params.cronExpr,
          prompt: params.prompt,
          modelSelection: params.modelSelection,
          mode: params.mode === null ? null : (params.mode as CfTaskMode | undefined),
          recurring: params.recurring,
          maxRuns: params.maxRuns,
          endAt: params.endAt,
          scheduleRule: params.scheduleRule,
          scheduleEditedByUser: params.scheduleEditedByUser,
        },
        {
          workspacePath: params.workspacePath,
          workspaceIdentity: params.workspaceIdentity,
        },
      );
    },

    async deleteAutomation(params: CfAgentAutomationIdParams) {
      await automationService.delete(params.automationId, {
        workspacePath: params.workspacePath,
        workspaceIdentity: params.workspaceIdentity,
      });
    },

    async setAutomationEnabled(params: CfAgentSetAutomationEnabledParams) {
      return automationService.setEnabled(params.automationId, params.enabled, {
        workspacePath: params.workspacePath,
        workspaceIdentity: params.workspaceIdentity,
      });
    },

    async restartAutomation(params: CfAgentAutomationIdParams) {
      return automationService.restart(params.automationId, {
        workspacePath: params.workspacePath,
        workspaceIdentity: params.workspaceIdentity,
      });
    },

    async runAutomationNow(params: CfAgentAutomationIdParams) {
      const dispatch = options?.onAutomationManualRunRequested;
      if (!dispatch) {
        throw new Error("Automation immediate dispatcher is unavailable.");
      }
      const claimed = await automationService.runNow(params.automationId, {
        workspacePath: params.workspacePath,
        workspaceIdentity: params.workspaceIdentity,
      });
      if (!claimed) {
        return { status: "duplicate" as const };
      }
      await dispatch(claimed);
      return { status: "queued" as const };
    },

    async listAutomationRuns(params: CfAgentAutomationIdParams) {
      return automationService.listRuns(params.automationId, {
        workspacePath: params.workspacePath,
        workspaceIdentity: params.workspaceIdentity,
      });
    },

    async deleteAutomationRun(params: CfAgentDeleteAutomationRunParams) {
      return automationService.deleteRun(params.runId, {
        workspacePath: params.workspacePath,
        workspaceIdentity: params.workspaceIdentity,
      });
    },

    async generateWorkspaceText(params: CfAgentGenerateWorkspaceTextParams) {
      const client = await getClient(params);
      await ensureAccountProviderConfigSynced({
        client,
        reason: "workspace_generate_text",
        workspace: params,
        refreshRegistry: true,
      });
      const operationId = params.signal ? randomUUID() : undefined;
      const cancel = () => {
        if (!operationId) return;
        void client
          .request(
            cfProtocolMethods.workspaceCancelGenerateText,
            { operationId },
            cfWorkspaceCancelGenerateTextResultSchema,
            { timeoutMs: 5_000 },
          )
          .catch((error: unknown) => {
            logger.debug(undefined, "Failed to send workspace model request cancellation notification", {
              operationId,
              workspaceKey: resolveWorkspaceKey(params),
              error: error instanceof Error ? error.message : String(error),
            });
          });
      };
      params.signal?.addEventListener("abort", cancel, { once: true });
      try {
        return await client.request(
          cfProtocolMethods.workspaceGenerateText,
          {
            workspace: buildWorkspaceRef(params),
            selection: params.selection,
            ...(params.prompt ? { prompt: params.prompt } : {}),
            ...(params.messages ? { messages: params.messages } : {}),
            ...(params.tools ? { tools: params.tools } : {}),
            querySource: params.querySource,
            ...(params.maxOutputTokens ? { maxOutputTokens: params.maxOutputTokens } : {}),
            ...(operationId ? { operationId } : {}),
          },
          cfWorkspaceGenerateTextResultSchema,
          {
            signal: params.signal,
            ...(params.requestTimeoutMs ? { timeoutMs: params.requestTimeoutMs } : {}),
          },
        );
      } finally {
        params.signal?.removeEventListener("abort", cancel);
      }
    },

    async testModelConnectivity(params: CfAgentTestModelConnectivityParams) {
      const client = await getClient(params);
      await ensureAccountProviderConfigSynced({
        client,
        reason: "provider_test_model_connectivity",
        workspace: params,
        refreshRegistry: true,
      });
      return client.request(
        cfProtocolMethods.providerTestModelConnectivity,
        {
          workspace: buildWorkspaceRef(params),
          selection: params.selection,
        },
        cfProviderTestModelConnectivityResultSchema,
        { signal: params.signal },
      );
    },

    async sendPrompt(params: CfAgentSendPromptParams) {
      const startedAt = Date.now();
      const client = await getClient(params);
      await ensureAccountProviderConfigSynced({
        client,
        reason: "session_send",
        workspace: params,
        refreshRegistry: true,
      });
      const sessionTraceId = params.sessionTraceId?.trim() || getSessionTraceId(params);
      const logTraceId = sessionTraceId ?? params.inputId;
      const browserAmbientContext =
        params.browserAmbientContext ??
        (await collectBrowserAmbientContext(options?.browserControlExecutor, {
          sessionId: params.sessionId,
          workspacePath: params.workspacePath,
          ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
          ...(params.remoteSessionId ? { remoteSessionId: params.remoteSessionId } : {}),
          ...(params.clientMode ? { clientMode: params.clientMode } : {}),
        }));
      const protocolParams: CfAgentSendPromptParams = {
        ...params,
        ...(browserAmbientContext ? { browserAmbientContext } : {}),
      };
      logger.info(logTraceId, "CodeFusion Agent session/send started", {
        attachmentCount: params.attachments?.length ?? 0,
        hasBrowserAmbientContext: browserAmbientContext !== undefined,
        inputId: params.inputId,
        queryId: params.queryId ?? null,
        sessionId: params.sessionId,
        sessionTraceId: sessionTraceId ?? null,
        textLength: params.content.length,
        workspaceKey: resolveWorkspaceKey(params),
        workspacePath: params.workspacePath,
      });
      try {
        const result = await client.request(
          cfProtocolMethods.sessionSend,
          buildSessionSendParams(protocolParams),
          cfSessionSendResultSchema,
        );
        logger.info(logTraceId, "CodeFusion Agent session/send ACK", {
          durationMs: Date.now() - startedAt,
          inputId: params.inputId,
          queryId: params.queryId ?? null,
          sessionId: params.sessionId,
          sessionTraceId: sessionTraceId ?? null,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        return result;
      } catch (error) {
        const compatFields = getSessionSendCompatFields(error);
        if (compatFields.length > 0) {
          logger.warn(logTraceId, "CodeFusion Agent session/send triggered legacy protocol compatibility retry", {
            compatFields,
            durationMs: Date.now() - startedAt,
            sessionId: params.sessionId,
            workspaceKey: resolveWorkspaceKey(params),
            workspacePath: params.workspacePath,
          });
          const result = await client.request(
            cfProtocolMethods.sessionSend,
            buildSessionSendParams(protocolParams, new Set(compatFields)),
            cfSessionSendResultSchema,
          );
          return result;
        }
        logger.warn(logTraceId, "CodeFusion Agent session/send failed", {
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
          inputId: params.inputId,
          queryId: params.queryId ?? null,
          sessionId: params.sessionId,
          sessionTraceId: sessionTraceId ?? null,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        throw error;
      }
    },

    async compactSession(params: CfAgentCompactParams) {
      const startedAt = Date.now();
      const client = await getClient(params);
      const sessionTraceId = getSessionTraceId(params);
      logger.info(sessionTraceId ?? params.inputId, "CodeFusion Protocol session/compact started", {
        inputId: params.inputId,
        sessionId: params.sessionId,
        workspaceKey: resolveWorkspaceKey(params),
        workspacePath: params.workspacePath,
      });
      try {
        const result = await client.request(
          cfProtocolMethods.sessionCompact,
          buildSessionCompactParams(params),
          cfSessionCompactResultSchema,
          {
            timeoutMs: SESSION_COMPACT_REQUEST_TIMEOUT_MS,
          },
        );
        logger.info(sessionTraceId ?? params.inputId, "CodeFusion Protocol session/compact ACK", {
          durationMs: Date.now() - startedAt,
          inputId: params.inputId,
          sessionId: params.sessionId,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        return result;
      } catch (error) {
        logger.warn(sessionTraceId ?? params.inputId, "CodeFusion Protocol session/compact failed", {
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
          inputId: params.inputId,
          sessionId: params.sessionId,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        throw error;
      }
    },

    async goalSession(params: CfAgentGoalParams) {
      const startedAt = Date.now();
      const client = await getClient(params);
      logger.info(params.inputId, "Starting CodeFusion Protocol session/goal request", {
        action: params.action,
        hasObjective: Boolean(params.objective?.trim()),
        sessionId: params.sessionId,
        workspaceKey: resolveWorkspaceKey(params),
        workspacePath: params.workspacePath,
      });
      try {
        const result = await client.request(
          cfProtocolMethods.sessionGoal,
          {
            sessionId: params.sessionId,
            inputId: params.inputId,
            action: params.action,
            objective: params.objective,
            expectedRevision: params.expectedRevision,
          },
          cfSessionGoalResultSchema,
        );
        logger.info(params.inputId, "CodeFusion Protocol session/goal completed", {
          action: params.action,
          durationMs: Date.now() - startedAt,
          messageCount: result.snapshot.messages.length,
          responseLength: result.response?.length ?? 0,
          sessionId: params.sessionId,
          startedTurn: result.startedTurn,
          status: result.snapshot.session.status,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        return result;
      } catch (error) {
        logger.warn(params.inputId, "CodeFusion Protocol session/goal failed", {
          action: params.action,
          durationMs: Date.now() - startedAt,
          message: error instanceof Error ? error.message : String(error),
          sessionId: params.sessionId,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        throw error;
      }
    },

    async closeSession(
      params: CfAgentSessionTarget & {
        expectedPersistence?: "deferred" | "immediate";
      },
    ): Promise<boolean> {
      const client = await getClient(params);
      const result = await client.request(
        cfProtocolMethods.sessionClose,
        {
          sessionId: params.sessionId,
          ...(params.expectedPersistence
            ? { expectedPersistence: params.expectedPersistence }
            : {}),
        },
        cfSessionCloseResultSchema,
      );
      return result.closed ?? true;
    },

    async setModel(params: CfAgentSetModelParams) {
      const startedAt = Date.now();
      const client = await getClient(params);
      logger.info(undefined, "Starting CodeFusion Protocol session/setModel request", {
        expectedRevision: params.expectedRevision ?? null,
        persistAsWorkspaceLastUsed: params.persistAsWorkspaceLastUsed ?? null,
        requestedModel: formatModelSelectionForLog(params.model),
        sessionId: params.sessionId,
        workspaceKey: resolveWorkspaceKey(params),
        workspacePath: params.workspacePath,
      });
      try {
        const snapshot = await client.request(
          cfProtocolMethods.sessionSetModel,
          {
            sessionId: params.sessionId,
            model: params.model,
            expectedRevision: params.expectedRevision,
            persistAsWorkspaceLastUsed: params.persistAsWorkspaceLastUsed,
          },
          cfSessionStateSnapshotSchema,
        );
        logger.info(undefined, "CodeFusion Protocol session/setModel completed", {
          durationMs: Date.now() - startedAt,
          requestedModel: formatModelSelectionForLog(params.model),
          sessionId: params.sessionId,
          snapshotModel: formatModelSelectionForLog(snapshot.settings.model.current),
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        return snapshot;
      } catch (error) {
        logger.warn(undefined, "CodeFusion Protocol session/setModel failed", {
          durationMs: Date.now() - startedAt,
          message: error instanceof Error ? error.message : String(error),
          requestedModel: formatModelSelectionForLog(params.model),
          sessionId: params.sessionId,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        throw error;
      }
    },

    async setThoughtLevel(params: CfAgentSetThoughtLevelParams) {
      const client = await getClient(params);
      const snapshot = await client.request(
        cfProtocolMethods.sessionSetThoughtLevel,
        {
          sessionId: params.sessionId,
          thoughtLevel: params.thoughtLevel,
          expectedRevision: params.expectedRevision,
          persistAsWorkspaceLastUsed: params.persistAsWorkspaceLastUsed,
        },
        cfSessionStateSnapshotSchema,
      );
      return snapshot;
    },

    async setMode(params: CfAgentSetModeParams) {
      const client = await getClient(params);
      return client.request(
        cfProtocolMethods.sessionSetMode,
        {
          sessionId: params.sessionId,
          mode: params.mode,
          expectedRevision: params.expectedRevision,
        },
        cfSessionStateSnapshotSchema,
      );
    },

    async respondSessionRuntimePreferences(
      params: CfAgentRespondSessionRuntimePreferencesParams,
    ): Promise<void> {
      const pending = takePendingSessionRuntimePreferences(params.requestId);
      if (!pending) {
        logger.warn(undefined, "No pending request found for runtime preferences response", {
          event: "cf_agent.runtime_preferences.response_without_pending",
          module: "services.cf_agent",
          requestId: params.requestId,
        });
        throw new Error(`CodeFusion session runtime preferences request not found: ${params.requestId}`);
      }
      const responseContext = {
        event: "cf_agent.runtime_preferences.host_response_received",
        module: "services.cf_agent",
        requestId: params.requestId,
        scope: pending.request.scope,
        sessionId: pending.request.sessionId,
        workspaceKey: pending.workspaceKey,
      };
      if (params.resolution.status === "failed") {
        logger.warn(undefined, "Host failed to return runtime preferences", {
          ...responseContext,
          error: params.resolution.message,
        });
        await pending.client.respondError(pending.protocolRequestId, {
          code: -32603,
          message: params.resolution.message,
        });
        return;
      }
      let preferences: CfSessionRuntimePreferencesResult;
      try {
        preferences = cfSessionRuntimePreferencesResultSchema.parse(
          params.resolution.preferences,
        );
        if (
          pending.request.scope === "runtime-materialization" &&
          options?.resolveSessionDirectories
        ) {
          preferences.additionalDirectories = await options.resolveSessionDirectories({
            ...pending.workspace,
            sessionId: pending.request.sessionId,
          });
        }
      } catch (error) {
        logger.warn(undefined, "Host returned invalid runtime preferences format", {
          ...responseContext,
          error: error instanceof Error ? error.message : String(error),
        });
        await pending.client.respondError(pending.protocolRequestId, {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      await pending.client.respond(pending.protocolRequestId, preferences);
      logger.info(undefined, "Runtime preferences response returned to Agent", responseContext);
    },

    onDynamicWorkspaceProviderRuntimeHeadersCancelled(params: CfAgentWorkspaceTarget) {
      const key = resolveWorkspaceKey(params);
      let emitter = providerRuntimeHeadersCancelledEmitters.get(key);
      if (!emitter) {
        emitter = new Emitter<CfProviderRuntimeHeadersCancelled>();
        providerRuntimeHeadersCancelledEmitters.set(key, emitter);
      }
      return emitter.event;
    },

    onDynamicSessionRuntimePreferencesRequest() {
      return (listener) => {
        const disposable = sessionRuntimePreferencesRequestEmitter.event(listener);
        for (const pending of pendingSessionRuntimePreferences.values()) {
          listener(pending.request);
        }
        return disposable;
      };
    },

    async respondProviderRuntimeHeaders(
      params: CfAgentRespondProviderRuntimeHeadersParams,
    ): Promise<void> {
      const key = providerRuntimeHeadersRequestKey(params);
      const pending = pendingProviderRuntimeHeaders.get(key);
      if (!pending) {
        throw new Error(`CodeFusion provider runtime headers request not found: ${params.requestId}`);
      }
      if (pending.responding) {
        throw new Error(
          `CodeFusion provider runtime headers response already pending: ${params.requestId}`,
        );
      }
      pending.responding = true;
      if (!params.response.headersApplied) {
        pendingProviderRuntimeHeaders.delete(key);
        await pending.client.respond(pending.protocolRequestId, {
          headersApplied: false,
          ...(params.response.errorMessage ? { errorMessage: params.response.errorMessage } : {}),
        });
        return;
      }
      let accountRequestAuth: AccountRequestAuthMaterial | undefined;
      try {
        accountRequestAuth = await resolveAccountRequestAuth(pending.request);
      } catch (error) {
        if (pendingProviderRuntimeHeaders.get(key) !== pending) return;
        pendingProviderRuntimeHeaders.delete(key);
        logger.warn(undefined, "Failed to apply CodeFusion provider runtime headers", {
          modelId: pending.request.modelSelection.modelId,
          providerId: pending.request.providerId,
          requestId: pending.request.requestId,
          sessionId: pending.request.sessionId,
          error: error instanceof Error ? error.message : String(error),
          workspaceKey: resolveWorkspaceKey(pending.request.workspace),
        });
        await pending.client.respond(pending.protocolRequestId, {
          headersApplied: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      if (pendingProviderRuntimeHeaders.get(key) !== pending) return;
      pendingProviderRuntimeHeaders.delete(key);
      const requestHeaders = {
        ...accountRequestAuth?.headers,
      };
      Object.assign(
        requestHeaders,
        allowRequestVerificationHeaders(params.response.runtimeProviderHeaders ?? {}),
      );
      const requestAuth =
        accountRequestAuth?.apiKey || Object.keys(requestHeaders).length > 0
          ? {
              ...(accountRequestAuth?.apiKey ? { apiKey: accountRequestAuth.apiKey } : {}),
              ...(accountRequestAuth?.apiKeyId ? { apiKeyId: accountRequestAuth.apiKeyId } : {}),
              ...(accountRequestAuth?.accountScope
                ? { accountScope: accountRequestAuth.accountScope }
                : {}),
              ...(Object.keys(requestHeaders).length > 0 ? { headers: requestHeaders } : {}),
            }
          : undefined;
      await pending.client.respond(
        pending.protocolRequestId,
        requestAuth
          ? { headersApplied: true, requestAuth }
          : { headersApplied: false, errorMessage: "Provider request auth is missing" },
      );
      const logContext = {
        modelId: pending.request.modelSelection.modelId,
        providerId: pending.request.providerId,
        requestId: pending.request.requestId,
        sessionId: pending.request.sessionId,
        ...(params.response.errorMessage ? { error: params.response.errorMessage } : {}),
        workspaceKey: resolveWorkspaceKey(pending.request.workspace),
      };
      if (requestAuth) {
        logger.info(undefined, "CodeFusion provider runtime headers applied", logContext);
      } else {
        logger.warn(undefined, "Failed to apply CodeFusion provider runtime headers", logContext);
      }
    },

    onDynamicProviderRuntimeHeadersRequest(params: CfAgentSessionTarget) {
      const emitter = getSessionEmitter(params);
      return (listener) => {
        const disposable = emitter.event((event) => {
          if (event.type !== "providerRuntimeHeaders.request") {
            return;
          }
          listener(event.request);
        });
        const pendingSessionPrefix = `${sessionEventKey(params)}\u0000`;
        for (const [key, pending] of pendingProviderRuntimeHeaders) {
          if (key.startsWith(pendingSessionPrefix)) {
            listener(pending.request);
          }
        }
        return disposable;
      };
    },

    onDynamicWorkspaceProviderRuntimeHeadersRequest(params: CfAgentWorkspaceTarget) {
      const emitter = getProviderRuntimeHeadersWorkspaceEmitter(params);
      return (listener) => {
        const disposable = emitter.event((request) => {
          listener(request);
        });
        const pendingWorkspacePrefix = `${resolveWorkspaceKey(params)}\u0000`;
        for (const [key, pending] of pendingProviderRuntimeHeaders) {
          if (key.startsWith(pendingWorkspacePrefix)) {
            listener(pending.request);
          }
        }
        return disposable;
      };
    },

    onDynamicSessionEvent(params: CfAgentSessionSubscribeParams) {
      const emitter = getSessionEmitter(params);
      return (listener) => {
        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | undefined;
        let subscriptionReady = false;
        const pendingLiveEvents: CfAgentServiceEvent[] = [];
        const deliveredEventIds = new Set<string>();
        const deliveredEventIdOrder: string[] = [];
        const eventCoalescer =
          params.eventCoalescing?.mode === "background-summary"
            ? createBackgroundSessionEventCoalescer({
                emit: listener,
                flushDelayMs: params.eventCoalescing.intervalMs,
              })
            : null;

        const deliverToListener = (event: CfAgentServiceEvent): void => {
          if (cancelled) {
            return;
          }
          if (event.type === "session.event") {
            const firstDelivery = rememberBoundedEventId(
              deliveredEventIds,
              deliveredEventIdOrder,
              event.event.eventId,
            );
            if (!firstDelivery) {
              return;
            }
          }
          if (eventCoalescer) {
            eventCoalescer.accept(event);
            return;
          }
          listener(event);
        };

        const releaseBufferedLiveEvents = (): void => {
          if (subscriptionReady) {
            return;
          }
          subscriptionReady = true;
          const bufferedEvents = pendingLiveEvents.splice(0);
          for (const event of bufferedEvents) {
            deliverToListener(event);
          }
        };

        const subscription = emitter.event((event) => {
          if (cancelled) {
            return;
          }
          if (!subscriptionReady) {
            pendingLiveEvents.push(event);
            return;
          }
          deliverToListener(event);
        });

        const establishSubscription = async (attempt: number): Promise<void> => {
          if (cancelled) {
            return;
          }
          try {
            const client = await getReadOnlyClient(params);
            if (cancelled) {
              return;
            }
            const result = await client.request(
              cfProtocolMethods.sessionSubscribe,
              {
                sessionId: params.sessionId,
                deliveryKind: params.deliveryKind,
                afterSeq: params.afterSeq,
                includeSnapshot: params.includeSnapshot ?? false,
              },
              cfSessionSubscribeResultSchema,
            );
            if (cancelled) {
              return;
            }
            const replayEvents = result.events
              .map((event) => normalizeSessionEventSeq(params, event))
              .sort((left, right) => left.seq - right.seq || left.timestamp - right.timestamp);
            for (const event of replayEvents) {
              deliverToListener({ type: "session.event", event });
            }
            if (result.snapshot) {
              deliverToListener({
                type: "snapshot",
                snapshot: result.snapshot,
              });
            }
            releaseBufferedLiveEvents();
          } catch (error) {
            if (cancelled) {
              return;
            }
            if (attempt >= SESSION_SUBSCRIBE_MAX_ATTEMPTS - 1) {
              console.warn(
                formatLogPrefix("cf-agent", process.pid),
                "Failed to establish session subscription: maximum retries reached, giving up",
                {
                  sessionId: params.sessionId,
                  workspaceKey: resolveWorkspaceKey(params),
                  attempts: attempt + 1,
                  message: error instanceof Error ? error.message : String(error),
                },
              );
              releaseBufferedLiveEvents();
              return;
            }
            const delay = Math.min(
              SESSION_SUBSCRIBE_RETRY_BASE_DELAY_MS * 2 ** attempt,
              SESSION_SUBSCRIBE_RETRY_MAX_DELAY_MS,
            );
            retryTimer = setTimeout(() => {
              retryTimer = undefined;
              void establishSubscription(attempt + 1);
            }, delay);
          }
        };

        void establishSubscription(0);

        return {
          dispose() {
            cancelled = true;
            if (retryTimer) {
              clearTimeout(retryTimer);
              retryTimer = undefined;
            }
            pendingLiveEvents.length = 0;
            eventCoalescer?.dispose();
            subscription.dispose();
          },
        };
      };
    },

    async helloConversationV4() {
      return {
        kind: "hello" as const,
        protocolVersion: V4_WIRE_PROTOCOL_VERSION,
        connectionId: v4ConnectionId,
        clientMode: "desktop-continuous" as const,
        deliveryProfile: "continuous" as const,
        serverTime: Date.now(),
        capabilities: {
          nativeDialogs: true,
          localTerminal: true,
          binaryFrames: false,
          compression: "none" as const,
          workspaceHookReview: true,
          independentPlanState: true,
          workflowRunDeltas: true,
          historyFirst: true,
        },
        auth: {},
      };
    },

    async initializeConversationV4(rawClientHello) {
      clientHelloSchema.parse(rawClientHello);
    },

    async setConnectionFlowStateV4(params: CfAgentConnectionFlowParams) {
      const trusted = readTrustedCfAgentV4Connection(params);
      if (!trusted) throw new Error("fault.connection.flowControlUntrusted");
      const client = await getReadOnlyClient(params);
      await client.request(
        V4_METHODS.connectionFlow,
        { connectionId: trusted.connectionId, state: params.state },
        v4ConnectionFlowResultSchema,
      );
    },

    async subscribeConversationV4(params: CfAgentConversationSubscribeParams) {
      const subscribeStartedAt = performance.now();
      const existingClient = processManager.getExistingClient(params);
      const cliProcessState: "reused" | "spawned" =
        existingClient && !existingClient.isDisposed ? "reused" : "spawned";
      const cliBootstrapStartedAt = performance.now();
      const client = await getReadOnlyClient(params);
      const cliBootstrapMs =
        cliProcessState === "spawned"
          ? Math.max(0, Math.round(performance.now() - cliBootstrapStartedAt))
          : undefined;
      const providerRegistryStartedAt = performance.now();
      await ensureAccountProviderConfigSynced({
        client,
        reason: "conversation_subscribe",
        workspace: params,
        refreshRegistry: true,
      });
      const providerRegistrySyncMs = Math.max(
        0,
        Math.round(performance.now() - providerRegistryStartedAt),
      );
      const connection = resolveV4Connection(params);
      const historyFirst = connection.historyFirst === true && (await supportsHistoryFirst(client));
      const topic = conversationTopic(params.sessionId);
      const taskMetaStartedAt = performance.now();
      const resumeThoughtLevel = await automationTaskIndexRepo
        .getTaskMeta({
          workspacePath: params.workspacePath,
          workspaceIdentity: params.workspaceIdentity,
          taskId: params.sessionId,
        })
        .then((meta) => meta?.thoughtLevel?.trim() || undefined)
        .catch((error) => {
          logger.warn(undefined, "Failed to read V4 cold resume thought hint; continuing subscription without hint", {
            error: error instanceof Error ? error.message : String(error),
            event: "v4.conversation.subscribe.resume_thought_hint_failed",
            sessionId: params.sessionId,
            workspaceIdentity: params.workspaceIdentity ?? null,
            workspaceKey: resolveWorkspaceKey(params),
            workspacePath: params.workspacePath,
          });
          return undefined;
        });
      let directorySessionId = params.sessionId;
      if (options?.resolveSessionDirectories) {
        const visited = new Set<string>();
        while (true) {
          if (visited.has(directorySessionId)) throw new Error("project.session-lineage-invalid");
          visited.add(directorySessionId);
          const { sessions } = await client.request(
            cfProtocolMethods.sessionList,
            { workspace: buildWorkspaceRef(params), sessionIds: [directorySessionId] },
            cfSessionListResultSchema,
          );
          const session = sessions.find((entry) => entry.sessionId === directorySessionId);
          if (!session) {
            if (directorySessionId !== params.sessionId)
              throw new Error("project.session-lineage-invalid");
            break;
          }
          if (
            resolveWorkspaceKey(session.workspace) !== resolveWorkspaceKey(params) ||
            session.workspace.workspacePath !== params.workspacePath
          )
            throw new Error("project.session-lineage-invalid");
          if (!isAuxiliarySessionKind(session.sessionKind)) break;
          if (!session.parentSessionId) throw new Error("project.session-lineage-invalid");
          directorySessionId = session.parentSessionId;
        }
      }
      const additionalDirectories = await options?.resolveSessionDirectories?.({
        ...params,
        sessionId: directorySessionId,
      });
      const taskMetaReadMs = Math.max(0, Math.round(performance.now() - taskMetaStartedAt));
      const cliRequestStartedAt = performance.now();
      const result = await client.request(
        V4_METHODS.conversationSubscribe,
        {
          topic,
          connectionId: connection.connectionId,
          clientMode: connection.clientMode,
          ...(connection.workflowRunDeltas === true ? { workflowRunDeltas: true } : {}),
          ...(historyFirst
            ? {
                historyFirst: true,
                ...(params.retryInitialization
                  ? { retryInitialization: params.retryInitialization }
                  : {}),
              }
            : {}),
          workspace: buildWorkspaceRef(params),
          ...(resumeThoughtLevel ? { resumeThoughtLevel } : {}),
          ...(additionalDirectories !== undefined ? { additionalDirectories } : {}),
          ...(params.base ? { base: params.base } : {}),
          ...(params.visibility ? { visibility: params.visibility } : {}),
        },
        v4ConversationSubscribeResultSchema,
      );
      const cliRequestMs = Math.max(0, Math.round(performance.now() - cliRequestStartedAt));
      const hostPrepareMs = Math.max(0, Math.round(cliRequestStartedAt - subscribeStartedAt));
      const openTiming = {
        ...(result.ack.openTiming ? result.ack.openTiming : {}),
        version: 1 as const,
        hostPrepareMs,
        ...(cliBootstrapMs !== undefined ? { cliBootstrapMs } : {}),
        cliProcessState,
        providerRegistrySyncMs,
        taskMetaReadMs,
        cliRequestMs,
      };
      rememberV4SubscriptionRoute(
        params,
        topic,
        result.ack.subscriptionId,
        connection.connectionId,
      );
      return {
        ...result,
        ack: {
          ...result.ack,
          openTiming,
        },
      };
    },

    async unsubscribeConversationV4(params: CfAgentConversationUnsubscribeParams) {
      await unsubscribeV4Route(params, "conversation/");
    },

    async resyncConversationV4(params: CfAgentConversationResyncParams) {
      return resyncV4Route(params, "conversation/");
    },

    async sendConversationCommandV4(params: CfAgentConversationCommandParams) {
      const client = await getClient(params);
      const planPayload = params.envelope.payload as {
        planEnabled?: boolean;
        config?: { planEnabled?: boolean };
        firstInput?: { planEnabled?: boolean };
      };
      if (
        planPayload.planEnabled ||
        planPayload.config?.planEnabled ||
        planPayload.firstInput?.planEnabled
      ) {
        await ensureIndependentPlanSupport(client);
      }
      const commandClientMode =
        readTrustedCfAgentV4Connection(params)?.clientMode ??
        params.clientMode ??
        "desktop-continuous";
      let envelope = await buildConversationCommandEnvelope(params);
      if (requiresProviderRegistryRefresh(envelope.type)) {
        await ensureAccountProviderConfigSynced({
          client,
          reason: "v4_command",
          workspace: params,
          refreshRegistry: true,
        });
      }
      if (
        commandClientMode !== "desktop-continuous" ||
        params.workspaceIdentity?.trim() ||
        params.remoteSessionId
      ) {
        const { ttft: _ttft, ...withoutTtft } = envelope;
        envelope = withoutTtft;
      }
      if (envelope.type === "sendText" && envelope.sessionId) {
        const sessionId = envelope.sessionId;
        const payload = {
          ...commandPayloadSchemas.sendText.parse(envelope.payload),
          inputOrigin:
            commandClientMode === "web-remote-replayable"
              ? ("mobile" as const)
              : ("desktop" as const),
        };
        envelope = { ...envelope, payload };
        const browserAmbientContext = await collectBrowserAmbientContext(
          options?.browserControlExecutor,
          {
            sessionId,
            workspacePath: params.workspacePath,
            ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
            ...(params.remoteSessionId ? { remoteSessionId: params.remoteSessionId } : {}),
            clientMode: commandClientMode,
          },
        );
        if (browserAmbientContext) {
          envelope = {
            ...envelope,
            payload: { ...payload, browserAmbientContext },
          };
        }
      }
      const ack: CommandAck = await client.request(V4_METHODS.command, envelope, commandAckSchema);
      return ack;
    },

    async queryConversationCommandsV4(params: CfAgentCommandsQueryParams) {
      if (!readTrustedCfAgentV4Connection(params)) {
        throw new Error("fault.command.queryConnectionUntrusted");
      }
      const query = commandsQueryParamsSchema.parse({
        commands: params.commands,
        ...(params.clock ? { clock: true } : {}),
      });
      const client = await getReadOnlyClient(params);
      return client.request(V4_METHODS.commandsQuery, query, commandsQueryResultSchema);
    },

    async attachmentBeginV4(params: CfAgentAttachmentBeginParams) {
      const trusted = readTrustedCfAgentV4Connection(params);
      if (!trusted) throw new Error("fault.attachment.connectionUntrusted");
      const client = await getClient(params);
      const wireParams = {
        connectionId: trusted.connectionId,
        uploadId: params.uploadId,
        sessionId: params.sessionId,
        fileName: params.fileName,
        mime: params.mime,
        totalBytes: params.totalBytes,
        totalChunks: params.totalChunks,
        checksum: params.checksum,
      };
      assertV4AttachmentNdjsonEnvelope(V4_METHODS.attachmentBegin, wireParams);
      return client.request(V4_METHODS.attachmentBegin, wireParams, v4AttachmentBeginResultSchema);
    },

    async attachmentChunkV4(params: CfAgentAttachmentChunkParams) {
      const trusted = readTrustedCfAgentV4Connection(params);
      if (!trusted) throw new Error("fault.attachment.connectionUntrusted");
      const client = await getClient(params);
      const wireParams = {
        connectionId: trusted.connectionId,
        uploadId: params.uploadId,
        sessionId: params.sessionId,
        chunkIndex: params.chunkIndex,
        dataBase64: params.dataBase64,
      };
      assertV4AttachmentNdjsonEnvelope(V4_METHODS.attachmentChunk, wireParams);
      return client.request(V4_METHODS.attachmentChunk, wireParams, v4AttachmentChunkResultSchema);
    },

    async attachmentCommitV4(params: CfAgentAttachmentTerminalParams) {
      const trusted = readTrustedCfAgentV4Connection(params);
      if (!trusted) throw new Error("fault.attachment.connectionUntrusted");
      const client = await getClient(params);
      const wireParams = {
        connectionId: trusted.connectionId,
        uploadId: params.uploadId,
        sessionId: params.sessionId,
      };
      assertV4AttachmentNdjsonEnvelope(V4_METHODS.attachmentCommit, wireParams);
      return client.request(
        V4_METHODS.attachmentCommit,
        wireParams,
        v4AttachmentCommitResultSchema,
      );
    },

    async attachmentAbortV4(params: CfAgentAttachmentTerminalParams) {
      const trusted = readTrustedCfAgentV4Connection(params);
      if (!trusted) throw new Error("fault.attachment.connectionUntrusted");
      const client = await getClient(params);
      const wireParams = {
        connectionId: trusted.connectionId,
        uploadId: params.uploadId,
        sessionId: params.sessionId,
      };
      assertV4AttachmentNdjsonEnvelope(V4_METHODS.attachmentAbort, wireParams);
      await client.request(V4_METHODS.attachmentAbort, wireParams, v4AttachmentAbortResultSchema);
    },

    async attachmentReadV4(params: CfAgentAttachmentReadParams) {
      if (!readTrustedCfAgentV4Connection(params)) {
        throw new Error("fault.attachment.readConnectionUntrusted");
      }
      const wireParams = v4AttachmentReadParamsSchema.parse({
        sessionId: params.sessionId,
        ref: params.ref,
        ...(params.target ? { target: params.target } : {}),
        ...(params.attachmentIndex !== undefined
          ? { attachmentIndex: params.attachmentIndex }
          : {}),
        offset: params.offset,
        limit: params.limit,
      });
      const client = await getReadOnlyClient(params);
      return client.request(V4_METHODS.attachmentRead, wireParams, v4AttachmentReadResultSchema);
    },

    async conversationAttachmentReadV4(params: CfAgentConversationAttachmentReadParams) {
      if (!readTrustedCfAgentV4Connection(params)) {
        throw new CfAttachmentFaultError(
          CF_ATTACHMENT_FAULT_CODES.shareReadConnectionUntrusted,
        );
      }
      const wireParams = v4ConversationAttachmentReadParamsSchema.parse({
        sessionId: params.sessionId,
        ref: params.ref,
        target: params.target,
        attachmentIndex: params.attachmentIndex,
        offset: params.offset,
        limit: params.limit,
      });
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationAttachmentRead,
        wireParams,
        v4ConversationAttachmentReadResultSchema,
      );
    },

    async conversationAttachmentStatV4(params: CfAgentConversationAttachmentStatParams) {
      if (!readTrustedCfAgentV4Connection(params)) {
        throw new CfAttachmentFaultError(
          CF_ATTACHMENT_FAULT_CODES.shareStatConnectionUntrusted,
        );
      }
      const wireParams = v4ConversationAttachmentStatParamsSchema.parse({
        sessionId: params.sessionId,
        ref: params.ref,
        target: params.target,
        attachmentIndex: params.attachmentIndex,
      });
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationAttachmentStat,
        wireParams,
        v4ConversationAttachmentStatResultSchema,
      );
    },

    async attachmentPreviewSourceV4(params: CfAgentAttachmentPreviewSourceParams) {
      const trusted = readTrustedCfAgentV4Connection(params);
      if (!trusted) throw new Error("fault.attachment.previewSourceConnectionUntrusted");
      if (trusted.clientMode !== "desktop-continuous" || params.remoteSessionId) {
        return { kind: "chunked" } as const;
      }
      const wireParams = v4AttachmentPreviewSourceParamsSchema.parse({
        sessionId: params.sessionId,
        ref: params.ref,
        ...(params.target ? { target: params.target } : {}),
        ...(params.attachmentIndex !== undefined
          ? { attachmentIndex: params.attachmentIndex }
          : {}),
        clientMode: trusted.clientMode,
      });
      const client = await getReadOnlyClient(params);
      const source = await client.request(
        V4_METHODS.attachmentPreviewSource,
        wireParams,
        v4AttachmentPreviewSourceResultSchema,
      );
      if (source.kind !== "local_path") return source;
      if (!options?.authorizeLocalMediaPreviewPath) {
        throw new Error("fault.attachment.previewPathAuthorizationUnavailable");
      }
      return {
        ...source,
        path: await options.authorizeLocalMediaPreviewPath(source.path),
      };
    },

    async conversationRowsRangeV4(params: CfAgentConversationRowsRangeParams) {
      const trusted = readTrustedCfAgentV4Connection(params);
      if (!trusted) throw new Error("fault.conversation.rowsRangeConnectionUntrusted");
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationRowsRange,
        {
          sessionId: params.sessionId,
          clientMode: trusted.clientMode,
          ...(params.beforeRowId !== undefined ? { beforeRowId: params.beforeRowId } : {}),
          limit: params.limit,
        },
        v4ConversationRowsRangeResultSchema,
      );
    },

    async conversationPlansV4(params: CfAgentConversationPlansParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationPlans,
        { sessionId: params.sessionId },
        v4ConversationPlansResultSchema,
      );
    },

    async conversationWorkflowRunEventsV4(params: CfAgentConversationWorkflowRunEventsParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationWorkflowRunEvents,
        {
          sessionId: params.sessionId,
          runId: params.runId,
          ...(params.afterSequence !== undefined ? { afterSequence: params.afterSequence } : {}),
          ...(params.limit !== undefined ? { limit: params.limit } : {}),
        },
        v4ConversationWorkflowRunEventsResultSchema,
      );
    },

    async conversationWorkflowRunsV4(params: CfAgentConversationWorkflowRunsParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationWorkflowRuns,
        {
          sessionId: params.sessionId,
          ...(params.limit !== undefined ? { limit: params.limit } : {}),
        },
        v4ConversationWorkflowRunsResultSchema,
      );
    },

    async conversationWorkflowRunArtifactsV4(
      params: CfAgentConversationWorkflowRunArtifactsParams,
    ) {
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationWorkflowRunArtifacts,
        { sessionId: params.sessionId, runId: params.runId },
        v4ConversationWorkflowRunArtifactsResultSchema,
      );
    },

    async conversationWorkflowRunArtifactDataV4(
      params: CfAgentConversationWorkflowRunArtifactDataParams,
    ) {
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationWorkflowRunArtifactData,
        {
          sessionId: params.sessionId,
          runId: params.runId,
          artifactId: params.artifactId,
          ...(params.afterSequence !== undefined ? { afterSequence: params.afterSequence } : {}),
          ...(params.limit !== undefined ? { limit: params.limit } : {}),
        },
        v4ConversationWorkflowRunArtifactDataResultSchema,
      );
    },

    async conversationWorkflowRunArtifactReadV4(
      params: CfAgentConversationWorkflowRunArtifactReadParams,
    ) {
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationWorkflowRunArtifactRead,
        {
          sessionId: params.sessionId,
          runId: params.runId,
          artifactId: params.artifactId,
          version: params.version,
          offset: params.offset,
          limit: params.limit,
        },
        v4ConversationWorkflowRunArtifactReadResultSchema,
      );
    },

    async conversationWorkflowRunWorkspaceV4(
      params: CfAgentConversationWorkflowRunWorkspaceParams,
    ) {
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationWorkflowRunWorkspace,
        { sessionId: params.sessionId, runId: params.runId },
        v4ConversationWorkflowRunWorkspaceResultSchema,
      );
    },

    async conversationWorkflowRunNodeResultV4(
      params: CfAgentConversationWorkflowRunNodeResultParams,
    ) {
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationWorkflowRunNodeResult,
        {
          sessionId: params.sessionId,
          runId: params.runId,
          siteId: params.siteId,
          ordinal: params.ordinal,
          ...(params.maxBytes !== undefined ? { maxBytes: params.maxBytes } : {}),
        },
        v4ConversationWorkflowRunNodeResultResultSchema,
      );
    },

    async backgroundBashOutputV4(params: CfAgentBackgroundBashOutputParams) {
      if (!readTrustedCfAgentV4Connection(params))
        throw new Error("fault.bashOutput.connectionUntrusted");
      const wireParams = v4BackgroundBashOutputParamsSchema.parse({
        sessionId: params.sessionId,
        workId: params.workId,
      });
      try {
        const client = await getReadOnlyClient(params, "existing-only");
        return await client.request(
          V4_METHODS.backgroundBashOutput,
          wireParams,
          backgroundBashOutputResultSchema,
        );
      } catch (error) {
        if (isProtocolMethodNotFoundError(error))
          return { kind: "unsupported", workId: params.workId };
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === CF_AGENT_RUNTIME_UNAVAILABLE_CODE
        ) {
          return { kind: "unavailable", workId: params.workId };
        }
        throw error;
      }
    },

    async conversationFileChangesV4(params: CfAgentConversationFileChangesParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationFileChanges,
        {
          sessionId: params.sessionId,
          target: params.target,
          baseRevision: params.baseRevision,
          baseLogEpoch: params.baseLogEpoch,
        },
        v4ConversationFileChangesResultSchema,
      );
    },

    async conversationFileRewindPreviewV4(params: CfAgentConversationFileRewindPreviewParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationFileRewindPreview,
        {
          sessionId: params.sessionId,
          target: params.target,
          baseRevision: params.baseRevision,
          baseLogEpoch: params.baseLogEpoch,
        },
        v4ConversationFileRewindPreviewResultSchema,
      );
    },

    onDynamicConversationFrame(params: CfAgentWorkspaceTarget) {
      return getConversationFrameEmitter(params).event;
    },

    onDynamicLocalTtftFacts(params: CfAgentWorkspaceTarget) {
      return (listener: (facts: LocalTtftFacts) => void) =>
        localTtftFactsEmitter.event((event) => {
          if (event.workspaceKey === resolveWorkspaceKey(params)) listener(event.facts);
        });
    },
    onDynamicConversationTelemetryFact(params: CfAgentWorkspaceTarget) {
      return getConversationTelemetryFactEmitter(params).event;
    },
    onDynamicOffPeakLifecycle(params: CfAgentWorkspaceTarget) {
      return getOffPeakLifecycleEmitter(params).event;
    },
    async controlOffPeakExecutionV4(
      params: CfAgentWorkspaceTarget & { control: OffPeakControlParams },
    ) {
      const control = offPeakControlParamsSchema.parse(params.control);
      const client = await getReadOnlyClient(params, "existing-only");
      return client.request(V4_METHODS.offPeakControl, control, offPeakControlResultSchema);
    },

    onDynamicPluginUiToolResult() {
      return pluginUiToolResultEmitter.event;
    },
    onDynamicCuaPermissionObservation() {
      return cuaPermissionObservationEmitter.event;
    },

    async reconcileSessionsIndexV4(params) {
      const client = await getReadOnlyClient(params, "existing-only");
      return client.request(
        V4_METHODS.sessionsIndexReconcile,
        { workspaceId: resolveWorkspaceKey(params), sessionIds: params.sessionIds },
        sessionsIndexReconcileResultSchema,
      );
    },

    async subscribeSessionsIndexV4(params: CfAgentSessionsIndexSubscribeParams) {
      const client = await getReadOnlyClient(params, params.runtimePolicy);
      const connection = resolveV4Connection(params, v4ConnectionIdFor(params.subscriberScope));
      const topic = sessionsIndexTopic(resolveWorkspaceKey(params));
      let legacyTaskIds: string[] = [];
      if (supportsLegacyRemoteTaskAllowlist(params.workspaceIdentity)) {
        try {
          legacyTaskIds = (
            await automationTaskIndexRepo.listTaskMetas({
              workspacePath: params.workspacePath,
              workspaceIdentity: params.workspaceIdentity,
              provider: "glm",
            })
          )
            .slice(0, MAX_LEGACY_TASK_IDS_PER_SUBSCRIBE)
            .map((task) => task.taskId);
        } catch (error) {
          logger.warn(undefined, "Failed to read remote historical task attribution proof; continuing subscription with strict identity", {
            error: error instanceof Error ? error.message : String(error),
            event: "sessions_index.legacy_remote_allowlist_read_failed",
            workspaceIdentity: params.workspaceIdentity,
            workspacePath: params.workspacePath,
          });
        }
      }
      const result = await client.request(
        V4_METHODS.conversationSubscribe,
        {
          topic,
          connectionId: connection.connectionId,
          clientMode: connection.clientMode,
          ...(legacyTaskIds.length > 0 ? { legacyTaskIds } : {}),
          ...(params.base ? { base: params.base } : {}),
          ...(params.visibility ? { visibility: params.visibility } : {}),
        },
        v4SessionsIndexSubscribeResultSchema,
      );
      rememberV4SubscriptionRoute(
        params,
        topic,
        result.ack.subscriptionId,
        connection.connectionId,
      );
      return result;
    },

    async unsubscribeSessionsIndexV4(params: CfAgentConversationUnsubscribeParams) {
      await unsubscribeV4Route(params, "sessions-index/");
    },

    async resyncSessionsIndexV4(params: CfAgentConversationResyncParams) {
      return resyncV4Route(params, "sessions-index/");
    },

    onDynamicSessionsIndexFrame(params: CfAgentWorkspaceTarget) {
      return getSessionsIndexFrameEmitter(params).event;
    },

    async subscribeWorkspaceConfigV4(params: CfAgentWorkspaceConfigSubscribeParams) {
      const client = await getReadOnlyClient(params, params.runtimePolicy);
      const connection = resolveV4Connection(params, v4ConnectionIdFor(params.subscriberScope));
      const topic = workspaceConfigTopic(resolveWorkspaceKey(params));
      const result = await client.request(
        V4_METHODS.conversationSubscribe,
        {
          topic,
          connectionId: connection.connectionId,
          clientMode: connection.clientMode,
          ...(params.base ? { base: params.base } : {}),
          ...(params.visibility ? { visibility: params.visibility } : {}),
        },
        v4WorkspaceConfigSubscribeResultSchema,
      );
      rememberV4SubscriptionRoute(
        params,
        topic,
        result.ack.subscriptionId,
        connection.connectionId,
      );
      return result;
    },

    async unsubscribeWorkspaceConfigV4(params: CfAgentConversationUnsubscribeParams) {
      await unsubscribeV4Route(params, "workspace-config/");
    },

    async resyncWorkspaceConfigV4(params: CfAgentConversationResyncParams) {
      return resyncV4Route(params, "workspace-config/");
    },

    onDynamicWorkspaceConfigFrame(params: CfAgentWorkspaceTarget) {
      return getWorkspaceConfigFrameEmitter(params).event;
    },

    onDynamicProcessResourceSample() {
      return processResourceSampleEmitter.event;
    },

    onDynamicToolExecResource() {
      return toolExecResourceEmitter.event;
    },
    onDynamicMcpResourceSamples() {
      return mcpResourceSamplesEmitter.event;
    },

    onDynamicMcpTelemetry() {
      return mcpTelemetryEmitter.event;
    },

    onAgentRuntimeRestarted(listener) {
      return processManager.onRuntimeRestarted(listener);
    },

    onAgentRuntimeLifecycle(listener: (event: CfAgentRuntimeLifecycleEvent) => void) {
      return processManager.onRuntimeLifecycle(listener);
    },

    async disposeWorkspace(params): Promise<void> {
      const workspaceKey = resolveWorkspaceKey(params);
      cancelWaitingWorkspaceStartup(workspaceKey);
      clearV4SubscriptionRoutes(workspaceKey);
      cuaOperationTurnTracker?.clearWorkspaceKey(workspaceKey);
      const active = activeClientsByWorkspaceKey.get(workspaceKey);
      if (active) {
        invalidateWorkspaceClient(workspaceKey, active.client);
      } else {
        interactionPreferenceSyncByWorkspaceKey.delete(workspaceKey);
      }
      await processManager.disposeWorkspace(params);
    },

    disposeAll(): void {
      processManager.disposeAll();
      pluginProcessManager.disposeAll();
      mcpStatusProcessManager.disposeAll();
      automationRepo.close();
      automationTaskIndexRepo.close();
      disposeLocalState();
    },

    async disposeAllAndWait(): Promise<void> {
      await Promise.all([
        processManager.disposeAllAndWait(),
        pluginProcessManager.disposeAllAndWait(),
        mcpStatusProcessManager.disposeAllAndWait(),
      ]);
      automationRepo.close();
      automationTaskIndexRepo.close();
      disposeLocalState();
    },
  };
}
