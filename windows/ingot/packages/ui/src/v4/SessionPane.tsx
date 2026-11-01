import { remoteHostIdFromWorkspaceIdentity } from "@origin-ai/cf-shared";
import { useRemoteConversationAvailable } from "@/v4/RemoteConversationAvailability.js";
import {
  createRemoteWorkspaceDisconnectedError,
  getRemoteConnectionFailureCode,
} from "@/lib/remoteWorkspaceServiceError.js";
import { buildConversationShareItems } from "@/v4/conversationShareItems.js";
import { resolveSelectionSideInheritedModel } from "@/lib/selectionSideInheritedModel.js";
import { useStartPlanRecommendation } from "@/hooks/useStartPlanRecommendation.js";
import type { SessionCreateSource } from "@origin-ai/cf-shared";
import { reportSessionCreate } from "@/lib/sessionCreateTelemetry.js";
import { getLocalTtftObserver } from "@/v4/telemetry/localTtftObserver.js";
import { BotGroupDeliveryProvider } from "@/v4/BotGroupDeliveryAction.js";

import { useOptionalProjectDirectory } from "@/project-sidebar/index.js";
import { useIsOfficeMode } from "@/hooks/useInterfaceMode.js";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Hand } from "lucide-react";
import {
  BUILTIN_MODEL_PROVIDER_IDS,
  buildCustomSupplierKey,
  isHighspeedProviderId,
  isRemoteWorkspaceIdentity,
  CF_AGENT_PROVIDER,
} from "@origin-ai/cf-shared";
import { TID_CHAT_EMPTY, TID_V4_SESSION_PANE, testId } from "@origin-ai/cf-shared/test-ids";
import type {
  ConversationShareAccessMode,
  GitChangeSourceId,
  HighspeedCardSnapshot,
  HighspeedPrepareTurnResult,
  GitRepositorySummary,
  ModelSelection,
  CfProvider,
  CfTaskChangeSummary,
} from "@origin-ai/cf-shared";
import type {
  AttachmentRef,
  CommandAck,
  CommandEnvelope,
  CommandType,
  ConversationSnapshot,
  ConversationRowTarget,
  SessionErrorInfo,
  SessionModelTransition,
  UserInputRow,
  V4ConversationFileChangesResult,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { logger } from "@/logger.js";
import { PluginUiSessionProvider } from "@/plugin-ui/index.js";
import {
  getConversationShareErrorDetails,
  resolveConversationShareFallbackIssueCode,
  resolveConversationSharePublishErrorMessageId,
  sanitizeConversationShareWarnings,
} from "@/lib/conversationShareError.js";
import { localizeConversationShareUrl } from "@origin-ai/cf-shared";
import type {
  ConversationShareAllowedArtifact,
  ConversationShareTurnPreflightResult,
  ImportedConversationShare,
} from "@origin-ai/cf-services";
import { useCodingPlanBillingDiscountFromService } from "@/CodingPlanBillingDiscount.js";
import { toast } from "@/components/ui/toast.js";
import { cn } from "@/components/lib/utils.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/lib/codePreviewSettings.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import type { OpenAutomationsMain } from "@/lib/taskNavigationHistory.js";
import { WORKSPACE_FILE_DRAG_MIME } from "@/lib/workspaceFileDrag.js";
import { buildChatSessionScrollMemoryKey } from "@/lib/chatSessionScrollMemory.js";
import type { MessageFileLinkTarget } from "@/components/ai-elements/message.js";
import { useServices } from "@/hooks/useServices.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { browserGlobalNoticeStore } from "@/global-notice/globalNoticeStore.js";
import {
  HIGHSPEED_SEND_WAIT_BUDGET_MS,
  prepareHighspeedSendContext,
  readRegularTpsWithinSendBudget,
  resolveHighspeedPrepareSelection,
  type HighspeedSendContext,
  type HighspeedTurnPreparer,
} from "@/highspeed/highspeedSend.js";
import {
  calculateHighspeedSavedDurationFromMetrics,
  readHighspeedRegularTpsFromHealth,
} from "@/highspeed/highspeedSavedTime.js";
import { buildHighspeedShareNotice } from "@/highspeed/highspeedShare.js";
import {
  claimHighspeedCardAutoShare,
  claimHighspeedHealthyAttempt,
  completeHighspeedTurn,
  discardHighspeedTurn,
  getHighspeedCardTps,
  getHighspeedTurnVersion,
  hydrateHighspeedTurnsFromTranscript,
  listExpiredHighspeedCardsAwaitingTps,
  listHighspeedCardAutoShareCandidates,
  listHighspeedTurnsAwaitingMetricsPersistence,
  listPendingHighspeedTurns,
  markHighspeedCardAutoShared,
  markHighspeedTurnMetricsPersisted,
  recordHighspeedTurn,
  resolveNextHighspeedAutoShareAt,
  setHighspeedCardTps,
  subscribeHighspeedTurns,
} from "@/highspeed/highspeedTurnStore.js";
import {
  claimHighspeedCardInvalidation,
  claimHighspeedFallbackToast,
  releaseHighspeedCardInvalidation,
} from "@/highspeed/highspeedToastClaims.js";
import {
  collectHighspeedCardShareBlockers,
  listHighspeedCardsAwaitingAutoShare,
} from "@/highspeed/highspeedShareDiagnostics.js";
import type { SessionOpenTrigger } from "@/lib/sessionOpenArmsTelemetry.js";
import { useDynamicWorkflowAvailability } from "@/hooks/useDynamicWorkflowAvailability.js";
import { resolveWorkflowResumeHandler } from "@/v4/workflowResumeGate.js";
import {
  workflowSessionModelOf,
  type WorkflowRunSettingsChange,
} from "@/components/workflow-timeline/workflowRunSettings.js";
import { useWorkflowRunJournalSummaries } from "@/hooks/useWorkflowRunJournalSummaries.js";
import { usePlanIdentitySnapshot } from "@/hooks/usePlanIdentitySnapshot.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { buildGenUiModelContext } from "@origin-ai/cf-shared/gen-ui";
import { useWorkspaceHomePath } from "@/hooks/useWorkspaceHomePath.js";
import { prepareWorkspaceWithCfSessionService } from "@/hooks/useWorkspacePrepare.js";
import {
  createCodingPlanFunnelContext,
  resolveCodingPlanEntryPlanState,
} from "@/lib/codingPlanFunnelTelemetry.js";
import { decodeCustomModelValue, encodeCustomModelValue } from "@/lib/cfCustomModelValue.js";
import { parseModelPickerValue } from "@/lib/cfSessionProjection.js";
import { prepareComposerRecentReceipt } from "@/lib/composerRecent.js";
import { useComposerClientNamespace } from "@/hooks/useServices.js";
import {
  readPendingTaskDraft,
  resolveComposerScope,
  composerScopeKey,
} from "@/v4/composer/composerDraftStore.js";
import { resolveProviderLabel } from "@/lib/registryProviderView.js";
import { resolveEntitledAccountProviderAccess } from "@/lib/accountProviderAccess.js";
import { getProviderSettingsSnapshot } from "@/lib/providerSettingsSnapshot.js";
import {
  buildDraftCreateConfigPayload,
  useDraftConfigControl,
} from "@/v4/composer/useDraftConfigControl.js";
import type { ModelSelectionSource } from "@/v4/composer/V4ComposerToolbar.js";
import { formatModelChangeLabel } from "@/v4/composer/modelTriggerDisplay.js";
import { resolveAppFollowupMode } from "@/v4/composer/followupModeSettings.js";
import {
  createComposerSubmissionConfig,
  type ComposerSubmissionConfig,
} from "@/v4/composer/composerSubmissionConfig.js";
import { useDraftSessionPrewarm } from "@/v4/composer/useDraftSessionPrewarm.js";
import { projectSessionConfigToTaskConfigOptions } from "@/v4/composer/sessionConfigTaskCache.js";
import { useDraftRuntimeRebuildGate } from "@/v4/composer/useDraftRuntimeRebuildGate.js";
import { useDraftModelReadinessGate } from "@/v4/composer/useDraftModelReadinessGate.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useCfStoreWithDefault } from "@/store/StoreProvider.js";
import { useCfSessionStore } from "@/store/cfSessionStore.js";
import {
  DEFAULT_CONVERSATION_SHARE_ACCESS_MODE,
  DEFAULT_CONVERSATION_SHARE_DOCK_STATE,
  getConversationShareDockState,
  getConversationShareSelectedProductTurnIds,
  useConversationShareSelectionStore,
  type ConversationShareDisplayWarnings,
} from "@/store/conversationShareSelectionStore.js";
import {
  ConversationComposer,
  type ComposerRestoreRequest,
  type ConversationComposerSendOptions,
  type ConversationComposerSendResult,
} from "@/v4/ConversationComposer.js";
import type { ConversationDropTargetController } from "@/v4/composer/conversationDropTarget.js";
import { shouldIgnoreEscapeForStopGeneration } from "@/v4/composer/escapeStop.js";
import { useConversationPanePresentation } from "@/side-pane-full-view/index.js";
import { ConversationDraftEmptyState } from "@/v4/ConversationDraftEmptyState.js";
import { ConversationDraftSuggestedPromptsContainer } from "@/v4/ConversationDraftSuggestedPromptsContainer.js";
import { ConversationHeader, type PaneWorkspaceBadge } from "@/v4/ConversationHeader.js";
import { ConversationQueuePanel } from "@/v4/ConversationQueuePanel.js";
import { projectPendingGuideQueue } from "@/v4/pendingGuideProjection.js";
import { ConversationQuotaBanner } from "@/v4/ConversationQuotaBanner.js";
import { PendingCommandRecoveryBanner } from "@/v4/PendingCommandRecoveryBanner.js";
import { WorkspaceHookPendingBanner } from "@/v4/WorkspaceHookPendingBanner.js";
import { ConversationStatusPanel } from "@/v4/ConversationStatusPanel.js";
import { SessionSubscriptionErrorPanel } from "@/v4/SessionSubscriptionErrorPanel.js";
import { ConversationTimeline } from "@/v4/ConversationTimeline.js";
import type { ConversationLatestTurnSummary } from "@/v4/conversationTimelineLiveTail.js";
import { ConversationShareImportNotice } from "@/v4/ConversationShareImportNotice.js";
import { ConversationShareConfirmationDock } from "@/v4/ConversationShareConfirmationDock.js";
import { ConversationShareSuccessDock } from "@/v4/ConversationShareSuccessDock.js";
import {
  ConversationSharePreflightStatus,
  type ConversationSharePreflightState,
} from "@/conversation-share-interaction/ConversationSharePreflightStatus.js";
import { ConversationShareSelectionPanel } from "@/v4/ConversationShareSelectionPanel.js";
import { ConversationSharePopover } from "@/conversation-share-interaction/ConversationSharePopover.js";
import {
  conversationSharePreflightCacheKey,
  conversationShareTurnFingerprint,
  dedupeConversationShareIssues,
  aggregateConversationShareBlockingIssues,
  getMissingConversationSharePreflightTurnIds,
} from "@/v4/conversationSharePreflightCache.js";
import { createConversationSharePreflightResponseHandlers } from "@/conversation-share-interaction/conversationSharePreflightResponse.js";
import { scheduleConversationSharePreflightRequest } from "@/conversation-share-interaction/conversationSharePreflightRequest.js";
import { ConversationBottomDockTransition } from "@/v4/ConversationBottomDockTransition.js";
import {
  ensureConversationShareAttempt,
  retainConversationShareAttemptAfterFailure,
} from "@/v4/conversationShareAttempt.js";
import { resolveConversationSelectionTooltipEnabled } from "@/v4/conversationShareModePolicy.js";
import { buildConversationTurnRenderUnits } from "@/v4/conversationTurnRenderUnits.js";
import { SessionPluginReferenceIconBoundary } from "@/v4/SessionPluginReferenceIconProvider.js";
import {
  resolveConversationStatusPanelVariant,
  shouldUseConversationStatusPanelInlineLayout,
} from "@/v4/conversationLayout.js";
import {
  buildConversationStatusPanelModel,
  resolveSoleRunningWorkflowRunTarget,
} from "@/v4/conversationStatusPanelModel.js";
import type { ConversationStatusPanelWorkflowRunTarget } from "@/v4/conversationStatusPanelModel.js";
import {
  buildWorkflowRunByRunId,
  buildWorkflowSaveCandidatesByRunId,
  buildWorkflowRunByToolCallId,
  buildWorkflowRunPendingQuestionsByRunId,
  buildWorkflowFillGraphByRunId,
  buildWorkflowGraphByToolCallId,
} from "@/v4/workflowRunCardJoin.js";
import { buildWorkflowDraftByToolCallId } from "@/v4/workflowDraftJoin.js";
import {
  WORKFLOW_RUN_DIRECTORY_LIMIT,
  countEndedWorkflowRuns,
  workflowRunDirectoryRefreshKey,
} from "@/v4/workflowRunDirectoryModel.js";
import {
  hasOlderRows,
  requiresAcceptedInputProjection,
  shouldAutoLoadIncompleteLeadingTurn,
} from "@/v4/conversationProjectionStore.js";
import type {
  ConversationFileChangesRequestOptions,
  ConversationRowRenderContext,
} from "@/v4/conversationRowContext.js";
import type { AssistantPreviewCardsAutoOpenRequest } from "@/lib/assistantPreviewCards.js";
import {
  advanceAssistantPreviewPptxAutoOpenGate,
  createAssistantPreviewPptxAutoOpenGateState,
  resolveLatestCompletedAssistantPreviewTurn,
  type AssistantPreviewPptxAutoOpenTarget,
} from "@/v4/assistantPreviewPptxAutoOpen.js";
import {
  hasPluginReferenceUserRows,
  isSessionPluginCatalogReady,
} from "@/v4/pluginReferenceIconProjection.js";
import { shouldResyncForStaleAuthority } from "@/v4/staleAuthorityRecovery.js";
import { createCommandEnvelope } from "@/v4/commandFactory.js";
import { createConfigCommandBarrier } from "@/v4/configCommandBarrier.js";
import { recordV4CommandAck } from "@/v4/commandAckObservability.js";
import { pendingCommandRegistry } from "@/v4/pendingCommandRegistry.js";
import type {
  ChatSearchResultHighlightRequest,
  ChatViewSummaryPanelVariant,
  ConversationFindMatchState,
} from "@/v4/legacyChatViewTypes.js";
import type { SessionLease } from "@/v4/sessionDataLayer.js";
import { V4InteractionDialogs } from "@/v4/V4InteractionDialogs.js";
import {
  useScopedConversationTelemetryForegroundEnabled,
  useScopedConversationTelemetrySupervisor,
} from "@/v4/telemetry/ConversationTelemetryAttachment.js";
import type { ConversationPromptTelemetrySeed } from "@/v4/telemetry/conversationTelemetrySupervisor.js";
import { resolveSendAckSettlement } from "@/v4/telemetry/conversationTelemetrySupervisor.js";
import { useSessionSubscriptionErrorTelemetry } from "@/v4/telemetry/useSessionSubscriptionErrorTelemetry.js";
import { useSessionOpenArmsTelemetry } from "@/v4/telemetry/useSessionOpenArmsTelemetry.js";
import {
  parseV4VisibleSlashCommand,
  parseSelectionSideSlashCommand,
  v4QueuedCommandText,
  type V4VisibleSlashCommand,
} from "@/v4/slashCommands.js";
import { useSlashCommands } from "@/hooks/useSlashCommands.js";
import { useV4Conversation } from "@/v4/V4ConversationContext.js";
import { useConversationProjection } from "@/v4/useConversationProjection.js";
import { usePendingCommandRecovery } from "@/v4/usePendingCommandRecovery.js";
import { useV4SessionQuotaBanner } from "@/v4/useV4SessionQuotaBanner.js";
import { resolveMcpUnavailableNotice } from "@/v4/mcpUnavailableBannerNotice.js";
import { shouldFocusTimelineAfterComposerSend } from "@/v4/promptScrollFocusPolicy.js";
import {
  hasChatLoadingBlockingActiveWork,
  hasChatLoadingBlockingInteraction,
} from "@/v4/chatLoadingVisibility.js";
import type { CfUiError } from "@/lib/cfUiError.js";
import type { ChatErrorBannerModelConfigTarget } from "@/ChatErrorBanner.js";
import { isProviderNotReadyError } from "@/lib/chatPrepareError.js";
import { useOptionalCodingPlanUpgradeDialog } from "@/settings/CodingPlanUpgradeDialogProvider.js";
import { setPendingSettingsSectionIntent } from "@/lib/settingsNavigation.js";
import { useOptionalTabStore } from "@/store/TabStoreProvider.js";
import { useIsMobileTextInputViewport } from "@/lib/mobileTextInput.js";
import type {
  OpenPlanDetailSideTabRequest,
  OpenScopedPlanDetailSideTabRequest,
  OpenWorkflowRunSideTabRequest,
  OpenWorkflowRunDirectorySideTabRequest,
  OpenScopedWorkflowActorSessionSideTabRequest,
  OpenScopedWorkflowArtifactSideTabRequest,
  OpenScopedWorkflowRunSideTabRequest,
  OpenWorkflowActorSessionSideTabRequest,
  OpenWorkflowArtifactSideTabRequest,
  OpenScopedWorkflowRunDirectorySideTabRequest,
  OpenScopedWorkflowWorkspaceSideTabRequest,
  OpenWorkflowWorkspaceSideTabRequest,
  OpenScopedSubagentSideTabRequest,
  OpenBackgroundBashSideTabRequest,
  OpenScopedSubagentDirectorySideTabRequest,
  OpenSelectionSideChatRequest,
  SyncSubagentSessionTabsRequest,
  OpenSubagentSideTabRequest,
} from "@/lib/workspaceSidePane.js";
import {
  buildSelectionSideChatKey,
  clearSelectionSideChat,
  createSelectionSideChat,
  isSelectionSideChatBlocked,
  registerSelectionSideChatOpener,
  setSelectionSideChatBlocked,
  subscribeSelectionSideChatRuntime,
} from "@/lib/selectionSideChatRuntime.js";
import {
  normalizeSlashCommandValue,
  shouldOfferSideSlashCommand,
  type AppSlashCommand,
} from "@/slashCommandHelpers.js";
import {
  clearConversationSelectionReferenceScope,
  dispatchConversationSelectionAdd,
  type ConversationSelectionReference,
} from "@/lib/conversationSelectionReference.js";

export interface SessionPaneProps {
  paneId: string;
  sessionId: string | null;
  
  openTrigger?: SessionOpenTrigger;
  rootSessionId?: string;
  
  readOnly?: boolean;
  
  allowWorkspaceFileRewind?: boolean;
  
  selectionSideChat?: boolean;
  
  activeSelectionSideChatSessionId?: string | null;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string | null;
  
  isDesktop?: boolean;
  compactForRemoteControl?: boolean;
  provider?: CfProvider;
  onSessionCreated?: (sessionId: string) => void;
  
  onSessionDeleted?: () => void;
  
  onSelectionSideChatUnavailable?: () => void;
  
  focused?: boolean;
  
  allowEscapeStopOutsidePane?: boolean;
  
  telemetryVisible?: boolean;
  
  onClosePane?: () => void;
  
  workspaceBadge?: PaneWorkspaceBadge;
  
  draftComposerHeader?: ReactNode;
  
  onDropTargetControllerChange?: (controller: ConversationDropTargetController | null) => void;
  gitSummary?: GitRepositorySummary | null;
  gitDirtyFileCount?: number;
  gitWorktreeReviewSourceId?: GitChangeSourceId | null;
  gitWorktreeChangeSummary?: { added: number; removed: number } | null;
  activeTaskChangeSummary?: CfTaskChangeSummary | null;
  summaryPanelVariantOverride?: ChatViewSummaryPanelVariant | null;
  onSummaryPanelVariantOverrideChange?: (variant: ChatViewSummaryPanelVariant | null) => void;
  onRefreshGit?: () => void;
  onOpenGitReview?: (sourceId?: GitChangeSourceId) => void;
  onOpenBrowserUrl?: (url: string) => void;
  onOpenAutomationsMain?: OpenAutomationsMain;
  onOpenCodeViewer?: (source: CodeViewerSource) => void;
  onAutoOpenAssistantPptx?: (request: AssistantPreviewCardsAutoOpenRequest) => void;
  onOpenFileLink?: (target: MessageFileLinkTarget) => void;
  onOpenBackgroundBash?: (request: OpenBackgroundBashSideTabRequest) => void;
  onOpenSubagentSession?: (request: OpenScopedSubagentSideTabRequest) => void;
  onOpenSubagentDirectory?: (request: OpenScopedSubagentDirectorySideTabRequest) => void;
  onSyncSubagentSessionTabs?: (request: SyncSubagentSessionTabsRequest) => void;
  onOpenSelectionSideChat?: (request: OpenSelectionSideChatRequest) => void;
  onOpenPlanDetail?: (request: OpenScopedPlanDetailSideTabRequest) => void;
  onOpenWorkflowRun?: (request: OpenScopedWorkflowRunSideTabRequest) => void;
  
  onOpenWorkflowArtifact?: (request: OpenScopedWorkflowArtifactSideTabRequest) => void;
  onOpenWorkflowRunDirectory?: (request: OpenScopedWorkflowRunDirectorySideTabRequest) => void;
  
  onOpenWorkflowActorSession?: (request: OpenScopedWorkflowActorSessionSideTabRequest) => void;
  
  onOpenWorkflowWorkspace?: (request: OpenScopedWorkflowWorkspaceSideTabRequest) => void;
  conversationFindQuery?: string;
  conversationFindActiveIndex?: number;
  conversationFindNavigationRequestId?: number;
  onConversationFindMatchStateChange?: (state: ConversationFindMatchState) => void;
  searchResultHighlightRequest?: ChatSearchResultHighlightRequest | null;
  onSearchResultHighlightDone?: (requestId: number) => void;
}

const MOBILE_PLAN_INTERACTION_RECONCILE_DELAY_MS = 500;
function createSessionErrorKey(
  sessionId: string | null | undefined,
  error: SessionErrorInfo,
): string {
  return [
    sessionId?.trim() || "draft",
    error.code,
    error.at,
    error.message,
    error.traceId ?? "",
    error.detail ?? "",
  ].join(":");
}

const EMPTY_SUBAGENT_PROJECTION: NonNullable<ConversationSnapshot["subagents"]> = {
  revision: 0,
  childSessionIds: [],
  running: [],
  endedTotal: 0,
};

const MAX_CONVERSATION_FILE_CHANGES_CACHE_ENTRIES = 20;

function toComposerUiError(
  sessionId: string | null | undefined,
  error: SessionErrorInfo,
): CfUiError {
  return {
    code: error.code,
    message: error.message,
    ...(error.traceId ? { traceId: error.traceId } : {}),
    ...(error.detail ? { detail: error.detail } : {}),
    ...(error.underlyingErrorMessage
      ? { underlyingErrorMessage: error.underlyingErrorMessage }
      : {}),
    ...(error.underlyingErrorDetail ? { underlyingErrorDetail: error.underlyingErrorDetail } : {}),
    ...(error.attribution ? { attribution: error.attribution } : {}),
    ...(sessionId ? { taskId: sessionId } : {}),
  };
}

function submissionConfigFromCommand(
  type: CommandType,
  payload: Record<string, unknown>,
): ComposerSubmissionConfig | null {
  const candidate =
    type === "createSession"
      ? (payload.firstInput as Record<string, unknown> | undefined)
      : type === "sendText" || type === "sendGoalCommand"
        ? payload
        : undefined;
  if (!candidate?.modelSelection || !candidate.mode) return null;
  return {
    modelSelection: candidate.modelSelection as ComposerSubmissionConfig["modelSelection"],
    mode: candidate.mode as ComposerSubmissionConfig["mode"],
    planEnabled:
      typeof candidate.planEnabled === "boolean"
        ? candidate.planEnabled
        : candidate.mode === "plan",
  };
}

function isConversationFileDrag(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types);
  return (
    types.includes("Files") ||
    types.includes(WORKSPACE_FILE_DRAG_MIME) ||
    Array.from(dataTransfer.items ?? []).some((item) => item.kind === "file")
  );
}

export interface QueuedComposerRestoreTarget {
  baseRevision: number;
  queueItemId: string;
  sourceCommandId: string;
  inputKind: "sendText" | "sendGoalCommand";
  text: string;
  attachments: readonly AttachmentRef[];
  config?: ComposerRestoreRequest["config"];
}

export function resolveQueuedComposerRestore(
  snapshot: ConversationSnapshot,
  queueItemId: string,
): QueuedComposerRestoreTarget | null {
  const item = snapshot.queue.items.find((candidate) => candidate.queueItemId === queueItemId);
  if (!item || item.kind === "compact") return null;
  const restoresModelSelection =
    item.modelSelection !== undefined &&
    !isHighspeedProviderId(item.modelSelection.providerId);
  const config = {
    ...(item.mode ? { mode: item.mode } : {}),
    ...(typeof item.planEnabled === "boolean" ? { planEnabled: item.planEnabled } : {}),
    ...(restoresModelSelection ? { modelSelection: item.modelSelection } : {}),
  };
  return {
    baseRevision: snapshot.revision,
    queueItemId,
    sourceCommandId: item.sourceCommandId,
    inputKind: item.kind,
    text: v4QueuedCommandText(item.kind, item.text),
    attachments: item.attachments.map((attachment) => ({ ...attachment })),
    ...(Object.keys(config).length > 0 ? { config } : {}),
  };
}

export function shouldRestoreQueuedComposerFromAck(status: CommandAck["status"]): boolean {
  return status === "accepted" || status === "duplicate";
}

interface HighspeedPaneOrigin {
  sessionId: string | null;
  
  paneBinding: number;
  draftId: string | null;
}

interface SessionPaneLeaseBinding {
  sessionId: string | null;
  layer: object;
  lease: SessionLease | null;
}

export function useSessionPaneLease(sessionId: string | null, layer: object) {
  const [binding, setBinding] = useState<SessionPaneLeaseBinding>({
    sessionId,
    layer,
    lease: null,
  });
  if (binding.sessionId !== sessionId || binding.layer !== layer) {
    const promoted =
      binding.layer === layer &&
      binding.sessionId === null &&
      binding.lease?.sessionId === sessionId;
    const lease = promoted ? binding.lease : null;
    setBinding({ sessionId, layer, lease });
    return [lease, setBinding] as const;
  }
  return [binding.lease, setBinding] as const;
}

export function SessionPane({
  paneId,
  sessionId,
  openTrigger,
  rootSessionId,
  readOnly = false,
  allowWorkspaceFileRewind = false,
  selectionSideChat = false,
  activeSelectionSideChatSessionId = null,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  isDesktop = false,
  compactForRemoteControl = false,
  provider,
  onSessionCreated,
  onSelectionSideChatUnavailable,
  focused = true,
  allowEscapeStopOutsidePane = false,
  telemetryVisible = true,
  onClosePane,
  workspaceBadge,
  draftComposerHeader,
  onDropTargetControllerChange,
  gitSummary,
  gitDirtyFileCount,
  gitWorktreeReviewSourceId,
  gitWorktreeChangeSummary,
  activeTaskChangeSummary,
  summaryPanelVariantOverride,
  onSummaryPanelVariantOverrideChange,
  onRefreshGit,
  onOpenGitReview,
  onOpenBrowserUrl,
  onOpenAutomationsMain,
  onOpenCodeViewer,
  onAutoOpenAssistantPptx,
  onOpenFileLink,
  onOpenSubagentSession,
  onOpenBackgroundBash,
  onOpenSubagentDirectory,
  onSyncSubagentSessionTabs,
  onOpenSelectionSideChat,
  onOpenPlanDetail,
  onOpenWorkflowRun,
  onOpenWorkflowArtifact,
  onOpenWorkflowRunDirectory,
  onOpenWorkflowActorSession,
  onOpenWorkflowWorkspace,
  conversationFindQuery = "",
  conversationFindActiveIndex = -1,
  conversationFindNavigationRequestId = 0,
  onConversationFindMatchStateChange,
  searchResultHighlightRequest,
  onSearchResultHighlightDone,
}: SessionPaneProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const remoteAvailable = useRemoteConversationAvailable();
  const {
    layer,
    sendCommand,
    attachmentPut,
    attachmentRead,
    attachmentReadRange,
    onRuntimeRestart,
    onRuntimeLifecycle,
    fileChanges,
    fileRewindPreview,
  } = useV4Conversation();
  const platform = useOptionalPlatform();
  const {
    conversationShareService,
    highspeedCardService,
    modelSelectionService,
    usageStatsService,
    cfSessionService,
    cfTaskService,
  } = useServices();
  const { intl, locale } = useCfIntl();
  const slashCommands = useSlashCommands(workspacePath, workspaceIdentity);
  const baseWorkspaceServices = useBaseWorkspaceServices();
  const composerClientNamespace = useComposerClientNamespace();
  const composerProjectId = useCfSessionStore(
    (store) => store.getWorkspaceState(workspacePath, workspaceIdentity).draftProjectId,
  );
  const newTaskComposerScope = useMemo(
    () => resolveComposerScope(composerProjectId, workspaceIdentity, composerClientNamespace),
    [composerProjectId, workspaceIdentity, composerClientNamespace],
  );
  const composerDraftGeneration = useCfSessionStore(
    (store) => store.getWorkspaceState(workspacePath, workspaceIdentity).draftFocusVersion,
  );
  const pendingAtEntry = useMemo(() => {
    if (sessionId !== null || newTaskComposerScope.projectId !== null) return null;
    const pending = readPendingTaskDraft(newTaskComposerScope);
    return pending?.workspacePath === workspacePath && pending.commandId ? pending : null;
  }, [sessionId, workspacePath, newTaskComposerScope, composerDraftGeneration]);
  const [resolvedDraftCommand, setResolvedDraftCommand] = useState<string | null>(null);
  const recoveringDraft =
    pendingAtEntry?.commandId !== resolvedDraftCommand ? pendingAtEntry : null;
  const workspaceHomePath = useWorkspaceHomePath({
    workspacePath,
    workspaceIdentity,
    remoteSessionId,
  });
  const conversationTelemetry = useScopedConversationTelemetrySupervisor({
    workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}),
    ...(remoteSessionId ? { remoteSessionId } : {}),
  });
  const conversationTelemetryForegroundEnabled = useScopedConversationTelemetryForegroundEnabled({
    workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}),
    ...(remoteSessionId ? { remoteSessionId } : {}),
  });
  const conversationTelemetryForegroundOwnerRef = useRef<object>({});
  useEffect(() => {
    if (
      !conversationTelemetry ||
      !conversationTelemetryForegroundEnabled ||
      !telemetryVisible ||
      !sessionId
    ) {
      return undefined;
    }
    return conversationTelemetry.attachForeground(
      conversationTelemetryForegroundOwnerRef.current,
      sessionId,
    );
  }, [conversationTelemetry, conversationTelemetryForegroundEnabled, sessionId, telemetryVisible]);
  const [lease, setLease] = useSessionPaneLease(sessionId, layer);
  const state = useConversationProjection(lease);
  const snapshot = state.snapshot;
  const runtimeReady =
    sessionId === null ||
    (snapshot?.sessionId === sessionId &&
      (!snapshot.runtimeInitialization || snapshot.runtimeInitialization.status === "ready"));
  const newlyCreatedSessionIdRef = useRef<string | null>(null);
  const shareDraft = useConversationShareSelectionStore((storeState) =>
    sessionId ? storeState.drafts[sessionId] : undefined,
  );
  const shareDockState = useConversationShareSelectionStore((storeState) =>
    sessionId ? storeState.dockStates[sessionId] : undefined,
  );
  const shareDock = shareDockState ?? DEFAULT_CONVERSATION_SHARE_DOCK_STATE;
  const shareTitle = shareDock.title ?? snapshot?.meta.title?.trim() ?? sessionId ?? "";
  const shareDisclosureAccepted = shareDock.disclosureAccepted;
  const sharePublishing = shareDock.publishing;
  const shareProgress = shareDock.progress;
  const shareCompletedArtifacts = shareDock.completedArtifacts;
  const shareTotalArtifacts = shareDock.totalArtifacts;
  const publishedShareUrl = shareDock.publishedShareUrl;
  const shareError = shareDock.error;
  const shareWarnings = shareDock.warnings;
  const shareActive = shareDraft?.open === true;
  const shareSelectionPanelVisible = shareActive && shareDraft?.pendingExcludedRowIds != null;
  const closeShare = useConversationShareSelectionStore((value) => value.closeShare);
  const updateShareDockState = useConversationShareSelectionStore((value) => value.updateDockState);
  const confirmShareSelection = useConversationShareSelectionStore(
    (value) => value.confirmSelectionEdit,
  );
  const beginShareSelection = useConversationShareSelectionStore(
    (value) => value.beginSelectionEdit,
  );
  const syncAvailableTurns = useConversationShareSelectionStore(
    (value) => value.syncAvailableTurns,
  );
  const toggleShareRow = useConversationShareSelectionStore((value) => value.togglePendingRow);
  const setAllPendingShareRows = useConversationShareSelectionStore(
    (value) => value.setAllPendingRowsSelected,
  );
  const deselectShareProductTurn = useConversationShareSelectionStore(
    (value) => value.deselectProductTurn,
  );
  const setShareAccessMode = useConversationShareSelectionStore((value) => value.setAccessMode);
  const cancelShareSelection = useConversationShareSelectionStore(
    (value) => value.cancelSelectionEdit,
  );
  const dismissShareSelectionPanel = useCallback(() => {
    if (sessionId) cancelShareSelection(sessionId);
  }, [sessionId, cancelShareSelection]);
  const pendingShareRowIds = useMemo(
    () =>
      new Set(
        (shareDraft?.availableRowIds ?? []).filter(
          (id) =>
            !(shareDraft?.pendingExcludedRowIds ?? shareDraft?.excludedRowIds ?? []).includes(id),
        ),
      ),
    [shareDraft],
  );
  const pendingShareTurnCount = useMemo(
    () =>
      new Set([...pendingShareRowIds].map((id) => shareDraft?.productTurnIdByRowId[id] ?? id)).size,
    [pendingShareRowIds, shareDraft],
  );
  const shareRenderUnits = useMemo(
    () => buildConversationTurnRenderUnits(snapshot?.rows.window ?? []),
    [snapshot?.rows.window],
  );
  const shareItems = useMemo(
    () =>
      buildConversationShareItems(shareRenderUnits, {
        assistantEmptyPreview: intl.formatMessage({
          id: "chat.turnNavigator.emptyAssistant",
        }),
        assistantRunningPreview: intl.formatMessage({
          id: "chat.turnNavigator.runningAssistant",
        }),
        userFallbackPreview: intl.formatMessage({
          id: "chat.turnNavigator.userFallback",
        }),
      }),
    [intl, shareRenderUnits],
  );
  const eligibleShareItems = useMemo(
    () => shareItems.filter((item) => !item.isRunning),
    [shareItems],
  );
  useEffect(() => {
    if (!sessionId || !shareActive) return;
    const rowsById = new Map((snapshot?.rows.window ?? []).map((row) => [row.rowId, row]));
    syncAvailableTurns(
      sessionId,
      eligibleShareItems.flatMap((item) => {
        const productTurnId = rowsById.get(item.rowId)?.productTurnId;
        return productTurnId ? [{ rowId: item.rowId, productTurnId }] : [];
      }),
    );
  }, [eligibleShareItems, sessionId, shareActive, snapshot?.rows.window, syncAvailableTurns]);
  const selectedShareProductTurnIds = useMemo(
    () =>
      sessionId
        ? getConversationShareSelectedProductTurnIds(
            useConversationShareSelectionStore.getState(),
            sessionId,
          )
        : [],
    [sessionId, shareDraft],
  );
  const preflightShareProductTurnIds = useMemo(
    () =>
      sessionId
        ? getConversationShareSelectedProductTurnIds(
            useConversationShareSelectionStore.getState(),
            sessionId,
            "pending",
          )
        : [],
    [sessionId, shareDraft],
  );
  const sharePreflightMetaRef = useRef<{
    revision: number;
    logEpoch: string;
    capabilitiesFingerprint: string;
    supportedArtifactTypes: readonly ConversationShareAllowedArtifact[];
  }>({
    revision: 0,
    logEpoch: "",
    capabilitiesFingerprint: "",
    supportedArtifactTypes: [],
  });
  const [sharePreflightVersion, setSharePreflightVersion] = useState(0);
  const selectedShareTurnFingerprints = useMemo(
    () =>
      new Map(
        preflightShareProductTurnIds.map((productTurnId) => [
          productTurnId,
          conversationShareTurnFingerprint(
            snapshot?.rows.window ?? [],
            productTurnId,
            workspacePath,
            {
              workspaceKey: workspaceIdentity?.trim() || workspacePath,
              remoteSessionId: remoteSessionId ?? "",
              sessionId: sessionId ?? "",
              revision: snapshot?.revision,
              logEpoch: snapshot?.logEpoch,
              capabilitiesFingerprint: sharePreflightMetaRef.current.capabilitiesFingerprint,
            },
          ),
        ]),
      ),
    [
      remoteSessionId,
      preflightShareProductTurnIds,
      sessionId,
      sharePreflightVersion,
      snapshot?.logEpoch,
      snapshot?.revision,
      snapshot?.rows.window,
      workspaceIdentity,
      workspacePath,
    ],
  );
  const eligibleShareProductTurnIds = useMemo(() => {
    const rowsById = new Map((snapshot?.rows.window ?? []).map((row) => [row.rowId, row]));
    const seen = new Set<string>();
    return eligibleShareItems.flatMap((item) => {
      const productTurnId = rowsById.get(item.rowId)?.productTurnId;
      if (!productTurnId || seen.has(productTurnId)) return [];
      seen.add(productTurnId);
      return [productTurnId];
    });
  }, [eligibleShareItems, snapshot?.rows.window]);
  const sharePreflightCacheRef = useRef(new Map<string, ConversationShareTurnPreflightResult>());
  const [sharePreflightRetryToken, setSharePreflightRetryToken] = useState(0);
  const sharePreflightScopeKey = `${workspaceIdentity?.trim() || workspacePath}\u0000${remoteSessionId ?? ""}\u0000${sessionId ?? ""}`;
  const sharePreflightScopeKeyRef = useRef<string | null>(null);
  const sharePreflightCacheKey = useCallback(
    (productTurnId: string) =>
      conversationSharePreflightCacheKey(sharePreflightScopeKey, productTurnId),
    [sharePreflightScopeKey],
  );
  const retrySharePreflight = useCallback(() => {
    for (const productTurnId of preflightShareProductTurnIds) {
      sharePreflightCacheRef.current.delete(sharePreflightCacheKey(productTurnId));
    }
    setSharePreflightRetryToken((token) => token + 1);
    setSharePreflightVersion((version) => version + 1);
  }, [preflightShareProductTurnIds, sharePreflightCacheKey]);
  const shareHydratedSessionRef = useRef<string | null>(null);
  const sharePreflight = useMemo<ConversationSharePreflightState>(() => {
    if (!shareActive || !sessionId || compactForRemoteControl) {
      return { status: "idle" };
    }
    if (preflightShareProductTurnIds.length === 0) {
      return { status: "idle" };
    }
    const entries = preflightShareProductTurnIds.map((productTurnId) => {
      const entry = sharePreflightCacheRef.current.get(sharePreflightCacheKey(productTurnId));
      return entry?.turnFingerprint === selectedShareTurnFingerprints.get(productTurnId)
        ? entry
        : undefined;
    });
    if (entries.some((entry) => entry === undefined)) {
      return { status: "checking" };
    }
    const resolvedEntries = entries.filter(
      (entry): entry is ConversationShareTurnPreflightResult => entry !== undefined,
    );
    return {
      status: "ready",
      ...sharePreflightMetaRef.current,
      blockingIssues: aggregateConversationShareBlockingIssues(resolvedEntries),
      skippableWarnings: dedupeConversationShareIssues(
        resolvedEntries.flatMap((entry) => entry.skippableWarnings),
      ),
      deferredIssues: dedupeConversationShareIssues(
        resolvedEntries.flatMap((entry) => entry.deferredIssues),
      ),
      turnResults: resolvedEntries,
    };
  }, [
    compactForRemoteControl,
    sessionId,
    preflightShareProductTurnIds,
    selectedShareTurnFingerprints,
    sharePreflightCacheKey,
    shareActive,
    sharePreflightVersion,
  ]);

  useEffect(() => {
    if (sharePreflightScopeKeyRef.current === sharePreflightScopeKey) return;
    sharePreflightScopeKeyRef.current = sharePreflightScopeKey;
    sharePreflightCacheRef.current.clear();
    sharePreflightMetaRef.current = {
      revision: 0,
      logEpoch: "",
      capabilitiesFingerprint: "",
      supportedArtifactTypes: [],
    };
    setSharePreflightVersion((version) => version + 1);
  }, [sharePreflightScopeKey]);

  useEffect(() => {
    if (shareActive && sessionId) return;
    sharePreflightCacheRef.current.clear();
    sharePreflightMetaRef.current = {
      revision: 0,
      logEpoch: "",
      capabilitiesFingerprint: "",
      supportedArtifactTypes: [],
    };
    setSharePreflightVersion((version) => version + 1);
  }, [sessionId, shareActive]);

  useEffect(() => {
    const requestScopeKey = sharePreflightScopeKey;
    if (
      !shareActive ||
      !sessionId ||
      compactForRemoteControl ||
      preflightShareProductTurnIds.length === 0
    ) {
      return undefined;
    }
    const missingProductTurnIds = getMissingConversationSharePreflightTurnIds(
      sharePreflightScopeKey,
      preflightShareProductTurnIds,
      sharePreflightCacheRef.current,
      selectedShareTurnFingerprints,
    );
    if (missingProductTurnIds.length === 0) return undefined;
    const requestRows = snapshot?.rows.window ?? [];
    return scheduleConversationSharePreflightRequest({
      request: () =>
        conversationShareService.preflight({
          workspacePath,
          ...(workspaceIdentity ? { workspaceIdentity } : {}),
          ...(remoteSessionId ? { remoteSessionId } : {}),
          sessionId,
          selection: {
            kind: "productTurns",
            productTurnIds: missingProductTurnIds,
          },
        }),
      ...createConversationSharePreflightResponseHandlers({
        sessionId,
        workspacePath,
        workspaceIdentity,
        remoteSessionId,
        missingProductTurnIds,
        requestRows,
        selectedShareTurnFingerprints,
        sharePreflightCacheRef,
        sharePreflightMetaRef,
        sharePreflightCacheKey,
        isCurrent: () => shareActive && requestScopeKey === sharePreflightScopeKeyRef.current,
        onUpdated: () => setSharePreflightVersion((version) => version + 1),
      }),
    });
  }, [
    compactForRemoteControl,
    conversationShareService,
    remoteSessionId,
    preflightShareProductTurnIds,
    selectedShareTurnFingerprints,
    sharePreflightCacheKey,
    sharePreflightRetryToken,
    sharePreflightScopeKey,
    sessionId,
    shareActive,
    snapshot?.rows.window,
    workspaceIdentity,
    workspacePath,
  ]);
  const sessionLeaseReady = lease?.sessionId === sessionId;
  const shouldMeasureExistingSessionOpen =
    sessionLeaseReady && newlyCreatedSessionIdRef.current !== sessionId;
  useSessionOpenArmsTelemetry({
    sessionId,
    snapshot,
    openTiming: sessionLeaseReady ? state.openTiming : undefined,
    rendererTiming: sessionLeaseReady ? state.rendererTiming : undefined,
    openKind: sessionLeaseReady ? lease?.openKind : undefined,
    openTrigger,
    startedAt: sessionLeaseReady ? lease?.startedAt : undefined,
    status: state.status,
    lastError: state.lastError,
    enabled: shouldMeasureExistingSessionOpen,
    readOnly,
    reporter: platform,
  });
  useEffect(() => {
    const newlyCreatedSessionId = newlyCreatedSessionIdRef.current;
    if (newlyCreatedSessionId !== null && newlyCreatedSessionId !== sessionId) {
      newlyCreatedSessionIdRef.current = null;
    }
  }, [sessionId]);
  const mobilePlanInteractionReconcileTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  useEffect(() => {
    const timers = mobilePlanInteractionReconcileTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, [lease, sessionId]);
  const handleMobilePlanInteractionAccepted = useCallback(
    (interactionId: string) => {
      if (!compactForRemoteControl || !lease) return;
      const timers = mobilePlanInteractionReconcileTimersRef.current;
      if (timers.has(interactionId)) return;
      const timer = setTimeout(() => {
        timers.delete(interactionId);
        const authoritativeSnapshot = lease.store.getState().snapshot;
        const stillPending = authoritativeSnapshot?.pendingInteractions.some(
          (interaction) => interaction.interactionId === interactionId,
        );
        if (!stillPending) return;
        logger.warn("[v4-pane] 手机 Plan ACK 后 pending 未收口，触发权威恢复", {
          interactionId,
          sessionId,
          workspaceKey: workspaceIdentity?.trim() || workspacePath,
        });
        lease.store.recoverFromStaleAuthority();
      }, MOBILE_PLAN_INTERACTION_RECONCILE_DELAY_MS);
      timers.set(interactionId, timer);
    },
    [compactForRemoteControl, lease, sessionId, workspaceIdentity, workspacePath],
  );
  const pluginReferenceIconsEnabled =
    isSessionPluginCatalogReady(state.status, sessionId, snapshot?.sessionId) &&
    hasPluginReferenceUserRows(snapshot?.rows.window ?? []);
  useEffect(() => {
    const rows = snapshot?.rows.window;
    if (!rows || rows.length === 0) return;
    for (const row of rows) {
      if (row.kind === "userInput" && row.sourceCommandId) {
        conversationTelemetry?.notifyUserInputRendered(row.sourceCommandId);
      }
    }
  }, [conversationTelemetry, snapshot]);
  const fileChangesRequestCache = useMemo(
    () => new Map<string, Promise<V4ConversationFileChangesResult>>(),
    [fileChanges, sessionId, snapshot?.logEpoch],
  );
  const [dismissedErrorKeys, setDismissedErrorKeys] = useState<readonly string[]>([]);
  const [sendSubmissionError, setSendSubmissionError] = useState<CfUiError | null>(null);
  const [paneLocalSummaryPanelVariantOverride, setPaneLocalSummaryPanelVariantOverride] =
    useState<ChatViewSummaryPanelVariant | null>(null);
  const [terminalSectionOpen, setTerminalSectionOpen] = useState(false);
  const [agentSectionOpen, setAgentSectionOpen] = useState(false);
  const [workflowSectionOpen, setWorkflowSectionOpen] = useState(false);
  const [dropTargetController, setDropTargetController] =
    useState<ConversationDropTargetController | null>(null);
  const handleDropTargetControllerChange = useCallback(
    (controller: ConversationDropTargetController | null) => {
      setDropTargetController(controller);
      onDropTargetControllerChange?.(controller);
    },
    [onDropTargetControllerChange],
  );
  const readOnlyDropTargetController = useMemo<ConversationDropTargetController>(
    () => ({
      active: false,
      kind: null,
      onDragLeave: () => {},
      onDragOver: (event) => {
        if (!isConversationFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "none";
      },
      onDrop: (event) => {
        if (!isConversationFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
      },
    }),
    [],
  );
  const effectiveDropTargetController = readOnly
    ? readOnlyDropTargetController
    : dropTargetController;
  const isMobileTextInputViewport = useIsMobileTextInputViewport();

  const snapshotRef = useRef<ConversationSnapshot | null>(snapshot);
  const sessionIdRef = useRef(sessionId);
  const [activeHighspeedCard, setActiveHighspeedCard] = useState<HighspeedCardSnapshot | null>(
    null,
  );
  const invalidateActiveHighspeedCard = useCallback(
    (cardId: string, failureKey: string) => {
      if (!claimHighspeedCardInvalidation(failureKey)) return;
      void highspeedCardService
        .invalidateCard(cardId)
        .then(() => {
          setActiveHighspeedCard((current) => (current?.cardId === cardId ? null : current));
        })
        .catch((error) => {
          releaseHighspeedCardInvalidation(failureKey);
          logger.warn("[highspeed] Failed to invalidate failed speedup card", {
            cardId,
            error: error instanceof Error ? error.message : String(error),
            sessionId,
          });
        });
    },
    [highspeedCardService, sessionId],
  );
  const [highspeedActivationCardId, setHighspeedActivationCardId] = useState<string | null>(null);
  const presentedHighspeedCardIdRef = useRef<string | null>(null);
  const highspeedMetricsInFlightRef = useRef(new Set<string>());
  const highspeedTurnVersion = useSyncExternalStore(
    subscribeHighspeedTurns,
    getHighspeedTurnVersion,
    getHighspeedTurnVersion,
  );
  const [highspeedAutoShareClock, refreshHighspeedAutoShareClock] = useState(0);
  const dispatchCommandRef = useRef<
    | ((
        type: CommandType,
        payload: Record<string, unknown>,
        targetSessionId: string | null,
        baseRevision?: number,
        baseLogEpoch?: string,
      ) => Promise<CommandAck>)
    | null
  >(null);
  const autoOpenedAssistantPptxKeysRef = useRef<Set<string>>(new Set());
  const assistantPreviewPptxGateRef = useRef(createAssistantPreviewPptxAutoOpenGateState());
  const [assistantPreviewPptxAutoOpenTarget, setAssistantPreviewPptxAutoOpenTarget] =
    useState<AssistantPreviewPptxAutoOpenTarget | null>(null);
  const autoLoadIncompleteTurnCursorRef = useRef<string | null>(null);
  snapshotRef.current = snapshot;
  sessionIdRef.current = sessionId;
  const handleAutoOpenAssistantPptx = useCallback(
    (request: AssistantPreviewCardsAutoOpenRequest) => {
      if (!onAutoOpenAssistantPptx || request.sources.length === 0) return;
      if (autoOpenedAssistantPptxKeysRef.current.has(request.key)) return;
      autoOpenedAssistantPptxKeysRef.current.add(request.key);
      onAutoOpenAssistantPptx(request);
    },
    [onAutoOpenAssistantPptx],
  );
  const composerDraftStateRef = useRef({ hasContent: false, busy: false });
  const [queueEditOperation, setQueueEditOperation] = useState<{
    queueItemId: string;
    sessionId: string;
    workspaceKey: string;
  } | null>(null);
  const queueEditOperationRef = useRef(queueEditOperation);
  queueEditOperationRef.current = queueEditOperation;
  const [composerRestoreRequest, setComposerRestoreRequest] =
    useState<ComposerRestoreRequest | null>(null);
  const nextComposerRestoreRequestIdRef = useRef(1);
  const timelineScrollToBottomRef = useRef<(() => void) | null>(null);
  const timelineScrollToQueryRef = useRef<
    ((target: { unitIndex: number; rowId: number }) => void) | null
  >(null);
  const conversationLayoutContainerRef = useRef<HTMLDivElement>(null);
  const hasExternalSummaryPanelVariantControl = Boolean(onSummaryPanelVariantOverrideChange);
  const effectiveSummaryPanelVariantOverride = hasExternalSummaryPanelVariantControl
    ? (summaryPanelVariantOverride ?? null)
    : paneLocalSummaryPanelVariantOverride;
  const handleSummaryPanelVariantChange = useCallback(
    (variant: ChatViewSummaryPanelVariant | null) => {
      if (onSummaryPanelVariantOverrideChange) {
        onSummaryPanelVariantOverrideChange(variant);
        return;
      }
      setPaneLocalSummaryPanelVariantOverride(variant);
    },
    [onSummaryPanelVariantOverrideChange],
  );

  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  const paneBindingKey = `${workspaceKey}\u0000${sessionId ?? ""}`;
  const paneBindingRef = useRef({ key: paneBindingKey, generation: 0 });
  if (paneBindingRef.current.key !== paneBindingKey) {
    paneBindingRef.current = {
      key: paneBindingKey,
      generation: paneBindingRef.current.generation + 1,
    };
  }
  useEffect(() => {
    let disposed = false;
    if (!sessionId) {
      setActiveHighspeedCard(null);
      return () => undefined;
    }
    void highspeedCardService
      .getSnapshot()
      .then((serviceSnapshot) => {
        if (disposed) return;
        const card = serviceSnapshot.card;
        const now = Date.now();
        if (!card || card.taskId !== sessionId || card.expiresAt <= now) {
          setActiveHighspeedCard(null);
          return;
        }
        presentedHighspeedCardIdRef.current = card.cardId;
        setActiveHighspeedCard(card);
      })
      .catch((error) => {
        if (disposed) return;
        setActiveHighspeedCard(null);
        logger.warn("[highspeed] 读取卡片状态失败，输入框按普通状态展示", {
          error: error instanceof Error ? error.message : String(error),
          sessionId,
        });
      });
    return () => {
      disposed = true;
    };
  }, [highspeedCardService, sessionId]);
  useEffect(() => {
    if (!activeHighspeedCard) return;
    const cardId = activeHighspeedCard.cardId;
    const expiresAt = activeHighspeedCard.expiresAt;
    const clearIfExpired = () => {
      if (Date.now() < expiresAt) return false;
      setActiveHighspeedCard((current) => (current?.cardId === cardId ? null : current));
      return true;
    };
    if (clearIfExpired()) return;
    let timer: number | undefined;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!clearIfExpired()) arm();
      }, expiresAt - Date.now());
    };
    arm();
    const refreshFromWindowWake = () => {
      if (document.visibilityState === "hidden") return;
      if (!clearIfExpired()) arm();
    };
    document.addEventListener("visibilitychange", refreshFromWindowWake);
    window.addEventListener("focus", refreshFromWindowWake);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshFromWindowWake);
      window.removeEventListener("focus", refreshFromWindowWake);
    };
  }, [activeHighspeedCard]);
  useEffect(() => {
    if (!sessionId) return;
    const nextAutoShareAt = resolveNextHighspeedAutoShareAt(sessionId);
    if (nextAutoShareAt === null) return;
    const delayMs = Math.max(0, nextAutoShareAt - Date.now()) + 20;
    const timer = window.setTimeout(
      () => refreshHighspeedAutoShareClock((revision) => revision + 1),
      delayMs,
    );
    return () => window.clearTimeout(timer);
  }, [highspeedTurnVersion, sessionId]);
  useEffect(() => {
    if (!sessionId) return;
    const refreshFromWindowWake = () => {
      if (document.visibilityState === "hidden") return;
      refreshHighspeedAutoShareClock((revision) => revision + 1);
    };
    document.addEventListener("visibilitychange", refreshFromWindowWake);
    window.addEventListener("focus", refreshFromWindowWake);
    return () => {
      document.removeEventListener("visibilitychange", refreshFromWindowWake);
      window.removeEventListener("focus", refreshFromWindowWake);
    };
  }, [refreshHighspeedAutoShareClock, sessionId]);
  useEffect(() => {
    if (!sessionId || snapshot?.sessionId !== sessionId) return;
    const terminalStates = new Set(["completedSuccess", "completedInterrupted", "failed"]);
    hydrateHighspeedTurnsFromTranscript(
      sessionId,
      snapshot.rows.window
        .filter((row): row is UserInputRow => row.kind === "userInput")
        .map((row) => ({
          sourceCommandId: row.sourceCommandId,
          createdAt: row.createdAt,
          highspeed: row.highspeed,
        })),
    );
    const pendingTurns = listPendingHighspeedTurns(sessionId);
    for (const record of pendingTurns) {
      const userRow = snapshot.rows.window.find(
        (row) => row.kind === "userInput" && row.sourceCommandId === record.sourceCommandId,
      );
      if (userRow?.kind === "userInput" && !userRow.highspeed) {
        discardHighspeedTurn(record.sourceCommandId);
        continue;
      }
      const header = snapshot.rows.window.find(
        (row) => row.kind === "turnHeader" && row.sourceCommandId === record.sourceCommandId,
      );
      if (!header || header.kind !== "turnHeader") {
        logger.debug("[highspeed] Turn stats incomplete: turnHeader missing in rows.window", {
          sourceCommandId: record.sourceCommandId,
        });
        continue;
      }
      if (!terminalStates.has(header.state) || header.outputTokens === undefined) {
        logger.debug("[highspeed] Turn stats incomplete: turnHeader not in terminal state or has no outputTokens", {
          sourceCommandId: record.sourceCommandId,
          state: header.state,
          hasOutputTokens: header.outputTokens !== undefined,
        });
        continue;
      }
      const durationMs = Math.max(
        0,
        header.activeMs ?? (header.endedAt !== undefined ? header.endedAt - header.startedAt : 0),
      );
      completeHighspeedTurn({
        sourceCommandId: record.sourceCommandId,
        outputTokens: header.outputTokens,
        durationMs,
        ...(header.modelDurationMs !== undefined
          ? { modelDurationMs: header.modelDurationMs }
          : {}),
        ...(header.toolDurationMs !== undefined ? { toolDurationMs: header.toolDurationMs } : {}),
        ...(header.otherDurationMs !== undefined
          ? { otherDurationMs: header.otherDurationMs }
          : {}),
      });
    }

    const autoShareNow = Date.now();
    for (const card of listExpiredHighspeedCardsAwaitingTps(sessionId, autoShareNow)) {
      if (!claimHighspeedHealthyAttempt(card.cardId, card.allTurnsCompleted)) {
        logger.debug("[highspeed] Card-level healthy queries exhausted; still no valid TPS", {
          cardId: card.cardId,
          allTurnsCompleted: card.allTurnsCompleted,
        });
        continue;
      }
      void highspeedCardService
        .healthy(card.cardId)
        .then((usage) => {
          if (usage.completionTokens <= 0 || usage.durationSeconds <= 0) {
            logger.warn("[highspeed] Card-level healthy returned no valid TPS; will recheck after current turn", {
              cardId: card.cardId,
              completionTokens: usage.completionTokens,
              durationSeconds: usage.durationSeconds,
            });
            return;
          }
          setHighspeedCardTps(card.cardId, usage.completionTokens / usage.durationSeconds);
        })
        .catch((error) => {
          logger.warn("[highspeed] Card-level healthy query failed; will recheck after current turn", {
            cardId: card.cardId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }

    const dispatch = dispatchCommandRef.current;
    if (dispatch) {
      for (const record of listHighspeedTurnsAwaitingMetricsPersistence(sessionId)) {
        if (!record.metrics || highspeedMetricsInFlightRef.current.has(record.sourceCommandId)) {
          continue;
        }
        const userRow = snapshot.rows.window.find(
          (row): row is UserInputRow =>
            row.kind === "userInput" && row.sourceCommandId === record.sourceCommandId,
        );
        const regularTps = record.card.regularTps ?? userRow?.highspeed?.regularTps;
        const highspeedTps = getHighspeedCardTps(record.card.cardId);
        if (!userRow || !userRow.entityId || !regularTps || !highspeedTps) {
          logger.debug("[highspeed] Missing prerequisites for terminal state persistence; skipping dispatch this turn", {
            sourceCommandId: record.sourceCommandId,
            userRowInWindow: userRow !== undefined && userRow !== null,
            hasEntityId: Boolean(userRow?.entityId),
            hasRegularTps: Boolean(regularTps),
            hasCardTps: Boolean(highspeedTps),
          });
          continue;
        }
        const savedDurationMs = calculateHighspeedSavedDurationFromMetrics(
          record.metrics,
          regularTps,
          highspeedTps,
        );
        highspeedMetricsInFlightRef.current.add(record.sourceCommandId);
        let metricsPersisted = false;
        void dispatch(
          "setHighspeedMetrics",
          {
            target: { rowId: userRow.rowId, entityId: userRow.entityId },
            regularTps,
            outputTokens: record.metrics.outputTokens,
            durationMs: record.metrics.durationMs,
            highspeedTps,
            savedDurationMs,
            ...(record.metrics.modelDurationMs !== undefined
              ? { modelDurationMs: record.metrics.modelDurationMs }
              : {}),
            ...(record.metrics.toolDurationMs !== undefined
              ? { toolDurationMs: record.metrics.toolDurationMs }
              : {}),
            ...(record.metrics.otherDurationMs !== undefined
              ? { otherDurationMs: record.metrics.otherDurationMs }
              : {}),
          },
          sessionId,
          snapshot.revision,
          snapshot.logEpoch,
        )
          .then((ack) => {
            if (ack.status !== "accepted" && ack.status !== "duplicate") {
              logger.warn("[highspeed] Terminal state stats persistence rejected", {
                reasonCode: ack.reasonCode,
                sourceCommandId: record.sourceCommandId,
                status: ack.status,
              });
              return;
            }
            markHighspeedTurnMetricsPersisted(record.sourceCommandId, savedDurationMs);
            metricsPersisted = true;
          })
          .catch((error) => {
            logger.warn("[highspeed] Terminal state stats persistence failed", {
              error: error instanceof Error ? error.message : String(error),
              sourceCommandId: record.sourceCommandId,
            });
          })
          .finally(() => {
            highspeedMetricsInFlightRef.current.delete(record.sourceCommandId);
            if (metricsPersisted) {
              refreshHighspeedAutoShareClock((revision) => revision + 1);
            }
          });
      }
    }

    for (const candidate of listHighspeedCardAutoShareCandidates(sessionId)) {
      if (candidate.expiresAt > autoShareNow) continue;
      if (!claimHighspeedCardAutoShare(candidate.cardId, autoShareNow)) continue;
      browserGlobalNoticeStore?.publish(
        buildHighspeedShareNotice({ cardId: candidate.cardId, metrics: candidate.metrics }),
      );
      markHighspeedCardAutoShared(candidate.cardId);
    }

    for (const cardId of listHighspeedCardsAwaitingAutoShare(sessionId, autoShareNow)) {
      const blockers = collectHighspeedCardShareBlockers(cardId);
      if (blockers.length > 0) {
        logger.debug("[highspeed] Card expired but not auto-shared; blocking reason", {
          cardId,
          blockers,
        });
      }
    }
  }, [highspeedAutoShareClock, highspeedCardService, highspeedTurnVersion, sessionId, snapshot]);
  const workspaceConfigOptions = useCfSessionStore(
    (store) => store.getWorkspaceState(workspacePath, workspaceIdentity).configOptions,
  );
  useEffect(() => {
    if (
      !sessionId ||
      snapshot?.sessionId !== sessionId ||
      !snapshot.config.provider.trim() ||
      !snapshot.config.model.trim() ||
      !workspaceConfigOptions?.length
    ) {
      return;
    }
    useCfSessionStore
      .getState()
      .setTaskConfigOptions(
        workspacePath,
        sessionId,
        projectSessionConfigToTaskConfigOptions(workspaceConfigOptions, snapshot.config),
        workspaceIdentity,
      );
  }, [
    sessionId,
    snapshot?.config.mode,
    snapshot?.config.model,
    snapshot?.config.provider,
    snapshot?.config.thought,
    snapshot?.sessionId,
    workspaceConfigOptions,
    workspaceIdentity,
    workspacePath,
  ]);
  useEffect(() => {
    const scopeKey = `${workspaceKey}\u0000${sessionId ?? "draft"}`;
    const enabled = Boolean(onAutoOpenAssistantPptx && focused && sessionId);
    const result = advanceAssistantPreviewPptxAutoOpenGate(assistantPreviewPptxGateRef.current, {
      enabled,
      scopeKey,
      logEpoch: snapshot?.logEpoch,
      phase: snapshot?.control.phase,
      completedTurn: resolveLatestCompletedAssistantPreviewTurn(snapshot?.rows.window ?? []),
    });
    assistantPreviewPptxGateRef.current = result.state;
    if (result.target !== undefined) {
      setAssistantPreviewPptxAutoOpenTarget(result.target);
    }
  }, [
    focused,
    onAutoOpenAssistantPptx,
    sessionId,
    snapshot?.control.phase,
    snapshot?.logEpoch,
    snapshot?.rows.window,
    workspaceKey,
  ]);
  useEffect(() => {
    autoOpenedAssistantPptxKeysRef.current.clear();
  }, [sessionId, snapshot?.logEpoch, workspaceKey]);
  const composerTextInsertRequest = useCfSessionStore(
    (store) => store.getWorkspaceState(workspacePath, workspaceIdentity).composerTextInsertRequest,
  );
  const timelineBottomRequest = useCfSessionStore(
    (store) => store.getWorkspaceState(workspacePath, workspaceIdentity).timelineBottomRequest,
  );
  const draftRuntimeInvalidationVersion = useCfSessionStore(
    (store) =>
      store.getWorkspaceState(workspacePath, workspaceIdentity).draftRuntimeInvalidationVersion,
  );
  const handleExternalTextInsertApplied = useCallback(
    (requestId: number) => {
      useCfSessionStore
        .getState()
        .clearComposerTextInsertRequest(workspacePath, requestId, workspaceIdentity);
    },
    [workspaceIdentity, workspacePath],
  );
  const composerBindingRef = useRef({ sessionId, workspaceKey });
  composerBindingRef.current = { sessionId, workspaceKey };
  const configCommandBarrier = useMemo(() => createConfigCommandBarrier(), []);
  const blockingInteractionId =
    snapshot?.pendingInteractions.find(
      (interaction) => interaction.payload.kind !== "workspaceHookReview",
    )?.interactionId ?? null;
  const panePresentation = useConversationPanePresentation();
  const isFloatingPresentation = panePresentation.presentation === "floating";
  const isRunning = Boolean(snapshot?.control.canStop);
  const { reportFloatingStatus } = panePresentation;
  const floatingOwnerKey = sessionId ?? "__draft__";
  const [floatingLatestTurn, setFloatingLatestTurn] = useState<{
    ownerKey: string;
    summary: ConversationLatestTurnSummary;
  } | null>(null);
  const handleFloatingLatestTurnSummaryChange = useCallback(
    (summary: ConversationLatestTurnSummary) =>
      setFloatingLatestTurn({ ownerKey: floatingOwnerKey, summary }),
    [floatingOwnerKey],
  );
  const floatingLatestTurnSummary =
    isFloatingPresentation && floatingLatestTurn?.ownerKey === floatingOwnerKey
      ? floatingLatestTurn.summary
      : null;
  const floatingTurnKey = floatingLatestTurnSummary?.turnKey ?? null;
  const floatingTurnRunning = floatingLatestTurnSummary?.running ?? false;
  const floatingTurnAnswer = floatingLatestTurnSummary?.answer ?? null;
  const hasFloatingLatestTurn = floatingLatestTurnSummary !== null;
  useEffect(() => {
    if (!focused) return;
    reportFloatingStatus({
      running: isRunning,
      blockingInteractionId,
      ownerKey: floatingOwnerKey,
      latestTurn: hasFloatingLatestTurn
        ? { turnKey: floatingTurnKey, running: floatingTurnRunning, answer: floatingTurnAnswer }
        : null,
    });
  }, [
    blockingInteractionId,
    floatingOwnerKey,
    floatingTurnAnswer,
    floatingTurnKey,
    floatingTurnRunning,
    focused,
    hasFloatingLatestTurn,
    isRunning,
    reportFloatingStatus,
  ]);
  const selectionSideChatKey = sessionId
    ? buildSelectionSideChatKey(workspaceKey, sessionId)
    : null;
  const selectionSideActionBlocked = useSyncExternalStore(
    subscribeSelectionSideChatRuntime,
    () =>
      activeSelectionSideChatSessionId
        ? isSelectionSideChatBlocked(activeSelectionSideChatSessionId)
        : false,
    () => false,
  );
  const timelineScrollMemoryKey = buildChatSessionScrollMemoryKey({
    workspacePath,
    workspaceIdentity,
    paneId,
    sessionId,
    taskId: null,
  });

  const {
    agentStartupAllowed: providerAgentStartupAllowed,
    error: draftModelReadinessError,
    dismissError: dismissDraftModelReadinessError,
    ensureReadyForSend: ensureDraftModelReadyForSend,
    markProviderNotReady: markDraftProviderNotReady,
  } = useDraftModelReadinessGate({
    workspacePath,
    workspaceIdentity,
    provider,
    sessionId,
    modelSelectionService,
  });

  const draftAgentStartupAllowed = providerAgentStartupAllowed && remoteAvailable;

  const {
    composerDraft,
    modelSelectionRead,
    draftConfig,
    draftConfigRef,
    resolveInitialDraftConfig,
    handleDraftSelectModel,
    handleDraftSelectThought,
    handleDraftSwitchMode,
    promoteComposerDraft,
    captureAcceptedModelSelection,
    replaceComposerDraft,
    updateComposerContent,
  } = useDraftConfigControl({
    workspacePath,
    workspaceIdentity,
    provider,
    sessionId,
    sessionConfig: runtimeReady && snapshot?.sessionId === sessionId ? snapshot.config : null,
    agentStartupAllowed: draftAgentStartupAllowed,
    modelSelectionService,
  });
  useEffect(() => {
    if (
      !sessionId ||
      snapshot?.sessionId !== sessionId ||
      snapshot.control.phase !== "error" ||
      !snapshot.control.lastError ||
      activeHighspeedCard?.taskId !== sessionId
    ) {
      return;
    }
    const lastError = snapshot.control.lastError;
    const attribution = lastError.attribution;
    if (attribution?.highspeedCardId !== undefined) {
      if (
        attribution.highspeedCardId !== activeHighspeedCard.cardId ||
        attribution.highspeedFallbackUnavailable !== true
      ) {
        return;
      }
    } else if (
      !["provider_not_found", "model_not_found"].includes(lastError.code) ||
      lastError.at < activeHighspeedCard.issuedAt
    ) {
      return;
    }
    invalidateActiveHighspeedCard(
      activeHighspeedCard.cardId,
      `turn-error:${sessionId}:${lastError.at}:${activeHighspeedCard.cardId}`,
    );
  }, [activeHighspeedCard, invalidateActiveHighspeedCard, sessionId, snapshot]);

  useEffect(() => {
    if (!sessionId || snapshot?.sessionId !== sessionId) return;
    const now = Date.now();
    for (const row of snapshot.rows.window) {
      if (
        row.kind !== "userInput" ||
        !row.sourceCommandId ||
        row.highspeed?.fallbackAt === undefined
      ) {
        continue;
      }
      const sourceCommandId = row.sourceCommandId;
      if (
        !compactForRemoteControl &&
        activeHighspeedCard?.taskId === sessionId &&
        activeHighspeedCard.cardId === row.highspeed.cardId
      ) {
        invalidateActiveHighspeedCard(
          row.highspeed.cardId,
          `fallback:${sourceCommandId}:${row.highspeed.cardId}`,
        );
      }
      if (
        focused &&
        now - row.highspeed.fallbackAt >= -5_000 &&
        now - row.highspeed.fallbackAt <= 15_000 &&
        claimHighspeedFallbackToast(sourceCommandId)
      ) {
        toast(
          intl.formatMessage({
            id:
              row.highspeed.fallbackReason === "highspeed_card_expired" ||
              row.highspeed.fallbackReason === undefined
                ? "chat.highspeed.cardExpiredFallback"
                : "chat.highspeed.requestFailedFallback",
          }),
        );
      }
    }
  }, [
    activeHighspeedCard,
    compactForRemoteControl,
    focused,
    intl,
    invalidateActiveHighspeedCard,
    sessionId,
    snapshot,
  ]);
  const modelSelectionView =
    modelSelectionRead.state.status === "ready" ? modelSelectionRead.state.view : null;
  const draftModelSelectionRevisionRef = useRef<number | null>(null);
  useEffect(() => {
    if (sessionId !== null) {
      draftModelSelectionRevisionRef.current = null;
      return;
    }
    const revision = modelSelectionView?.revision ?? null;
    const previousRevision = draftModelSelectionRevisionRef.current;
    draftModelSelectionRevisionRef.current = revision;
    if (
      revision === null ||
      previousRevision === null ||
      revision === previousRevision ||
      (draftConfigRef.current.provider && draftConfigRef.current.model)
    ) {
      return;
    }
    useCfSessionStore.getState().invalidateDraftRuntime(workspacePath, workspaceIdentity);
  }, [draftConfigRef, modelSelectionView?.revision, sessionId, workspaceIdentity, workspacePath]);
  const recommendStartPlan = useStartPlanRecommendation(modelSelectionView);
  const createSubmissionFromComposer = useCallback(
    () => createComposerSubmissionConfig(draftConfigRef.current, modelSelectionView),
    [draftConfigRef, modelSelectionView],
  );
  const composerSubmissionReady = useMemo(
    () => createComposerSubmissionConfig(draftConfig, modelSelectionView) !== null,
    [draftConfig, modelSelectionView],
  );
  const codingPlanUpgradeDialog = useOptionalCodingPlanUpgradeDialog();
  const openSettingsTab = useOptionalTabStore((state) => state.openSettingsTab);
  const billingDiscount = useCodingPlanBillingDiscountFromService(
    baseWorkspaceServices.codingPlanSubscriptionService,
  );
  const projectDirectory = useOptionalProjectDirectory();
  const commitCreatedTask = projectDirectory?.commitCreatedTask;
  const refreshTaskGroups = projectDirectory?.groups.refresh;
  const draftNavigation = useMemo(
    () => ({ controller: new AbortController() }),
    [workspaceKey, sessionId],
  );
  useEffect(() => {
    draftNavigation.controller = new AbortController();
    return () => draftNavigation.controller.abort();
  }, [draftNavigation]);
  const reportDraftCreated = useCallback(
    (createdSessionId: string, source: SessionCreateSource, messageId: string) => {
      void reportSessionCreate(platform, {
        sessionId: createdSessionId,
        messageId,
        workspacePath,
        workspaceIdentity,
        remoteSessionId,
        source,
        clientKind: isDesktop ? "desktop" : compactForRemoteControl ? "mobile" : "web",
      });
    },
    [
      platform,
      workspacePath,
      workspaceIdentity,
      remoteSessionId,
      isDesktop,
      compactForRemoteControl,
    ],
  );
  const handleDraftSessionCreated = useCallback(
    async (
      createdSessionId: string,
      createSource?: SessionCreateSource,
      messageId?: string,
      taskGroupId?: string | null,
    ) => {
      if (messageId) reportDraftCreated(createdSessionId, createSource ?? "session", messageId);
      const commit = () => {
        newlyCreatedSessionIdRef.current = createdSessionId;
        promoteComposerDraft(createdSessionId);
        onSessionCreated?.(createdSessionId);
      };
      const organize =
        taskGroupId !== undefined
          ? async () => {
              const task = {
                taskId: createdSessionId,
                workspacePath,
                ...(workspaceIdentity ? { workspaceIdentity } : {}),
                hostId: remoteHostIdFromWorkspaceIdentity(workspaceIdentity ?? "") ?? "local",
              };
              const attempt = async () => {
                try {
                  if (!baseWorkspaceServices.taskGroupService)
                    throw new Error("task-group.service-unavailable");
                  await baseWorkspaceServices.taskGroupService.admit({
                    tasks: [task],
                    placement: {
                      task,
                      groupId: taskGroupId,
                      creationId: messageId ?? createdSessionId,
                    },
                  });
                  void refreshTaskGroups?.();
                } catch (cause) {
                  logger.error("[task-groups] 新任务归属提交失败", cause);
                  toast(intl.formatMessage({ id: "taskGroup.failed" }), {
                    durationMs: 0,
                    actionLabel: intl.formatMessage({ id: "taskGroup.retryPlacement" }),
                    onAction: () => void attempt(),
                    dedupeKey: `task-group:${createdSessionId}`,
                  });
                }
              };
              await attempt();
            }
          : undefined;
      if (commitCreatedTask) {
        await commitCreatedTask(
          { taskId: createdSessionId, workspacePath, workspaceIdentity },
          commit,
          draftNavigation.controller.signal,
          organize,
        );
      } else {
        void organize?.();
        commit();
      }
    },
    [
      commitCreatedTask,
      baseWorkspaceServices.taskGroupService,
      refreshTaskGroups,
      intl,
      draftNavigation,
      reportDraftCreated,
      onSessionCreated,
      promoteComposerDraft,
      workspaceIdentity,
      workspacePath,
    ],
  );
  const { settings: sharedSettings } = useSettings();
  const readPlanIdentitySnapshot = usePlanIdentitySnapshot(
    sharedSettings?.providerFamilyDomain,
    sharedSettings?.providerFamilyDomain
      ? sharedSettings.providerFamilyConnectionSelections?.[sharedSettings.providerFamilyDomain]
      : undefined,
    baseWorkspaceServices.usageStatsService,
  );
  const appFollowupMode = resolveAppFollowupMode(sharedSettings);
  const messageStreamShowReasoning = sharedSettings?.messageStreamShowReasoning ?? true;
  const messageStreamShowTodos = sharedSettings?.messageStreamShowTodos ?? false;
  const toolGroupingExploreEnabled = sharedSettings?.toolGroupingExploreEnabled ?? true;
  const toolGroupingTerminalEnabled = sharedSettings?.toolGroupingTerminalEnabled ?? true;
  const toolGroupingChangesEnabled = sharedSettings?.toolGroupingChangesEnabled ?? false;
  const snapshotSessionId = snapshot?.sessionId ?? null;
  const snapshotFollowupMode = snapshot?.config.followupMode ?? null;
  const snapshotRevision = snapshot?.revision ?? null;

  const theme = useCfStoreWithDefault((state) => state.theme, "system");
  const codePreviewSettings = useCfStoreWithDefault(
    (state) => state.codePreviewSettings,
    DEFAULT_CODE_PREVIEW_SETTINGS,
  );
  const handleNavigateToRow = useCallback(
    (targetSessionId: string, _rowId: number) => {
      if (!targetSessionId || targetSessionId === sessionId) {
        return;
      }
      onSessionCreated?.(targetSessionId);
    },
    [onSessionCreated, sessionId],
  );
  const dispatchCommand = useCallback(
    async (
      type: CommandType,
      payload: Record<string, unknown>,
      targetSessionId: string | null,
      baseRevision?: number,
      baseLogEpoch?: string,
      telemetrySeed?: ConversationPromptTelemetrySeed,
      highspeedCard?: HighspeedCardSnapshot,
      onEnvelopeCreated?: (envelope: CommandEnvelope) => void,
      creationProjectId?: string | null,
      sessionCreateSource?: SessionCreateSource,
      recentSubmissionOverride?: ComposerSubmissionConfig | null,
      creationTaskGroupId?: string | null,
      submittedDraftText?: string,
    ): Promise<CommandAck> => {
      if (!remoteAvailable) throw createRemoteWorkspaceDisconnectedError();
      const submission = submissionConfigFromCommand(type, payload);
      const recentSubmission = recentSubmissionOverride ?? submission;
      let recentScope =
        creationProjectId === undefined
          ? newTaskComposerScope
          : { ...newTaskComposerScope, projectId: creationProjectId };
      const recentReceipt = recentSubmission
        ? prepareComposerRecentReceipt(recentScope, recentSubmission)
        : undefined;
      if (recentSubmission && sessionId && targetSessionId) {
        const projectService = baseWorkspaceServices.projectService;
        if (!projectService) throw new Error("project.service-unavailable");
        const directories = await projectService.resolveSessionDirectories(
          {
            workspacePath,
            workspaceIdentity,
            taskId:
              selectionSideChat && targetSessionId === sessionId && rootSessionId
                ? rootSessionId
                : targetSessionId,
          },
          recentScope.hostId,
        );
        recentScope = { ...recentScope, projectId: directories.projectId };
      }
      if (recentReceipt) recentReceipt.scope = recentScope;
      const pendingDraft =
        sessionId === null && recentScope.projectId === null
          ? readPendingTaskDraft(recentScope)
          : null;
      const acceptSelection =
        submission && (sessionId === null || targetSessionId === sessionId)
          ? captureAcceptedModelSelection(submission.modelSelection)
          : undefined;
      const envelope = createCommandEnvelope({
        type,
        sessionId: targetSessionId,
        payload: payload as never,
        ...(baseRevision !== undefined ? { baseRevision } : {}),
        ...(baseLogEpoch ? { baseLogEpoch } : {}),
      });
      onEnvelopeCreated?.(envelope);
      const projectId =
        type === "createSession"
          ? creationProjectId !== undefined
            ? creationProjectId
            : useCfSessionStore.getState().getWorkspaceState(workspacePath, workspaceIdentity)
                .draftProjectId
          : undefined;
      pendingCommandRegistry.record(
        envelope,
        type === "createSession"
          ? {
              workspace: {
                workspacePath,
                ...(workspaceIdentity ? { workspaceIdentity } : {}),
              },
              ...(projectId !== undefined ? { projectId } : {}),
              ...(recentReceipt
                ? {
                    composer: {
                      ...recentReceipt,
                      submittedText: submittedDraftText,
                      ...(pendingDraft?.workspacePath === workspacePath
                        ? { draftId: pendingDraft.draftId }
                        : {}),
                    },
                  }
                : {}),
              taskGroupId:
                creationTaskGroupId !== undefined
                  ? creationTaskGroupId
                  : useCfSessionStore
                      .getState()
                      .getWorkspaceState(workspacePath, workspaceIdentity).draftTaskGroupId,
              sessionCreateSource:
                sessionCreateSource ??
                useCfSessionStore.getState().getWorkspaceState(workspacePath, workspaceIdentity)
                  .draftCreateSource,
            }
          : recentReceipt
            ? {
                workspace: { workspacePath, ...(workspaceIdentity ? { workspaceIdentity } : {}) },
                ...(sessionId === null
                  ? {
                      projectId: recentScope.projectId,
                      taskGroupId:
                        creationTaskGroupId ??
                        useCfSessionStore
                          .getState()
                          .getWorkspaceState(workspacePath, workspaceIdentity).draftTaskGroupId,
                      sessionCreateSource:
                        sessionCreateSource ??
                        useCfSessionStore
                          .getState()
                          .getWorkspaceState(workspacePath, workspaceIdentity).draftCreateSource,
                    }
                  : {}),
                composer: {
                  ...recentReceipt,
                  submittedText: submittedDraftText,
                  ...(pendingDraft?.workspacePath === workspacePath
                    ? { draftId: pendingDraft.draftId }
                    : {}),
                },
              }
            : undefined,
      );
      if (lease?.store && type !== "createSession") {
        lease.store.markCommandPending({
          commandId: envelope.commandId,
          type: envelope.type,
          issuedAt: envelope.issuedAt,
        });
      }
      let ack: CommandAck;
      try {
        if (telemetrySeed?.localTtft && !workspaceIdentity?.trim()) {
          envelope.ttft = getLocalTtftObserver()?.dispatch(
            telemetrySeed.localTtft,
            workspacePath,
            envelope.commandId,
            targetSessionId,
          );
        }
        ack =
          projectId !== undefined
            ? await sendCommand(envelope, { projectId })
            : await sendCommand(envelope);
        if (telemetrySeed?.localTtft && ack.reasonCode === "guard.heldQueueConfirmationStale")
          getLocalTtftObserver()?.confirmationRetry(telemetrySeed.localTtft);
        else if (telemetrySeed?.localTtft)
          getLocalTtftObserver()?.ack(telemetrySeed.localTtft, ack.status, ack.ttftExcluded);
      } catch (error) {
        if (telemetrySeed?.localTtft)
          getLocalTtftObserver()?.exclude(telemetrySeed.localTtft, "failed");
        if (lease?.store) {
          lease.store.settleCommand(envelope.commandId);
        }
        if (isProviderNotReadyError(error)) {
          pendingCommandRegistry.rejectCommand(envelope.sessionId, envelope.commandId);
        }
        recordV4CommandAck({
          type,
          status: "transport-error",
          reasonCode: String(error),
          at: Date.now(),
        });
        if (telemetrySeed) {
          conversationTelemetry?.settleSendResult({
            seed: telemetrySeed,
            sessionId: targetSessionId,
            commandId: envelope.commandId,
            status: "fail",
            reasonCode: isProviderNotReadyError(error) ? "provider_not_ready" : "transport_error",
          });
        }
        throw error;
      }
      pendingCommandRegistry.applyAck(envelope, ack);
      if (ack.status === "accepted") {
        acceptSelection?.();
      }
      if (
        lease?.store &&
        requiresAcceptedInputProjection(type) &&
        (ack.status === "accepted" || ack.status === "duplicate")
      ) {
        lease.store.expectAcceptedInputProjection(envelope.commandId);
      }
      if (ack.status === "accepted" && telemetrySeed) {
        const acceptedSessionId =
          ack.result?.type === "createSelectionSideSession"
            ? ack.result.sessionId
            : (targetSessionId ??
              (ack.result?.type === "createSession" ? ack.result.sessionId : null));
        if (acceptedSessionId) {
          conversationTelemetry?.acceptPromptSeed({
            ...telemetrySeed,
            sessionId: acceptedSessionId,
            sourceCommandId: envelope.commandId,
            memoryEnabled: ack.memoryEnabled,
          });
        }
      }
      if (ack.status === "accepted" && highspeedCard && targetSessionId) {
        recordHighspeedTurn({
          sessionId: targetSessionId,
          sourceCommandId: envelope.commandId,
          card: highspeedCard,
          createdAt: Date.now(),
        });
      }
      if (telemetrySeed) {
        const outcome = resolveSendAckSettlement(ack);
        if (outcome) {
          const settledSessionId =
            ack.result?.type === "createSelectionSideSession"
              ? ack.result.sessionId
              : (targetSessionId ??
                (ack.result?.type === "createSession" ? ack.result.sessionId : null));
          if (outcome.kind === "awaitRender") {
            conversationTelemetry?.awaitSendRender({
              seed: telemetrySeed,
              sessionId: settledSessionId,
              commandId: envelope.commandId,
              ackStatus: outcome.ackStatus,
            });
          } else {
            conversationTelemetry?.settleSendResult({
              seed: telemetrySeed,
              sessionId: settledSessionId,
              commandId: envelope.commandId,
              status: outcome.status,
              ackStatus: outcome.ackStatus,
              reasonCode: outcome.reasonCode,
            });
          }
        }
      }
      recordV4CommandAck({
        type,
        status: ack.status,
        ...(ack.reasonCode ? { reasonCode: ack.reasonCode } : {}),
        revisionAtDecision: ack.revisionAtDecision,
        at: Date.now(),
      });
      if (shouldResyncForStaleAuthority(ack)) {
        lease?.store?.recoverFromStaleAuthority();
      }
      if (
        lease?.store &&
        type !== "createSession" &&
        ack.status !== "accepted" &&
        ack.status !== "duplicate"
      ) {
        lease.store.settleCommand(envelope.commandId);
      }
      return ack;
    },
    [
      captureAcceptedModelSelection,
      newTaskComposerScope,
      baseWorkspaceServices.projectService,
      conversationTelemetry,
      lease,
      provider,
      sendCommand,
      remoteAvailable,
      rootSessionId,
      selectionSideChat,
      sessionId,
      workspaceIdentity,
      workspacePath,
    ],
  );
  dispatchCommandRef.current = dispatchCommand;

  const handleFetchFileChanges = useCallback(
    (target: ConversationRowTarget, options: ConversationFileChangesRequestOptions) => {
      const current = snapshotRef.current;
      if (!sessionId || !current) {
        return Promise.resolve({
          files: 0,
          additions: 0,
          deletions: 0,
          items: [],
        });
      }
      const cacheKey = JSON.stringify([
        options.cachePolicy,
        sessionId,
        current.logEpoch,
        options.cachePolicy === "in-flight"
          ? current.revision
          : (options.fileChangesState ?? "unknown"),
        target.rowId,
        target.entityId,
      ]);
      const cachedRequest = fileChangesRequestCache.get(cacheKey);
      if (cachedRequest) {
        fileChangesRequestCache.delete(cacheKey);
        fileChangesRequestCache.set(cacheKey, cachedRequest);
        return cachedRequest;
      }

      let request: Promise<V4ConversationFileChangesResult>;
      request = fileChanges({
        sessionId,
        target,
        baseRevision: current.revision,
        baseLogEpoch: current.logEpoch,
      }).then(
        (result) => {
          if (
            options.cachePolicy === "in-flight" &&
            fileChangesRequestCache.get(cacheKey) === request
          ) {
            fileChangesRequestCache.delete(cacheKey);
          }
          return result;
        },
        (error: unknown) => {
          if (fileChangesRequestCache.get(cacheKey) === request) {
            fileChangesRequestCache.delete(cacheKey);
          }
          if (shouldResyncForStaleAuthority(error)) {
            lease?.store?.recoverFromStaleAuthority();
          }
          throw error;
        },
      );
      fileChangesRequestCache.set(cacheKey, request);
      while (fileChangesRequestCache.size > MAX_CONVERSATION_FILE_CHANGES_CACHE_ENTRIES) {
        const oldestKey = fileChangesRequestCache.keys().next().value;
        if (oldestKey === undefined) break;
        fileChangesRequestCache.delete(oldestKey);
      }
      return request;
    },
    [fileChanges, fileChangesRequestCache, lease, sessionId],
  );

  const handlePreviewFileRewind = useCallback(
    (target: ConversationRowTarget) => {
      const current = snapshotRef.current;
      if (!sessionId || !current) {
        return Promise.resolve({
          canApply: false,
          safeFiles: [],
          unsafeFiles: [],
          ignoredFiles: [],
        });
      }
      return fileRewindPreview({
        sessionId,
        target,
        baseRevision: current.revision,
        baseLogEpoch: current.logEpoch,
      }).catch((error: unknown) => {
        if (shouldResyncForStaleAuthority(error)) {
          lease?.store?.recoverFromStaleAuthority();
        }
        throw error;
      });
    },
    [fileRewindPreview, lease, sessionId],
  );

  const handleApplyFileRewind = useCallback(
    (target: ConversationRowTarget) => {
      const current = snapshotRef.current;
      if (!sessionId || !current) {
        throw new Error("Cannot apply file rewind without an active session revision");
      }
      return dispatchCommand(
        "applyFileRewind",
        { target },
        sessionId,
        current.revision,
        current.logEpoch,
      );
    },
    [dispatchCommand, sessionId],
  );

  const handleOpenSubagentSession = useCallback(
    (request: OpenSubagentSideTabRequest) => {
      onOpenSubagentSession?.({
        ...request,
        rootSessionId: request.rootSessionId ?? rootSessionId ?? request.parentSessionId,
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        ...(remoteSessionId ? { remoteSessionId } : {}),
      });
    },
    [onOpenSubagentSession, remoteSessionId, rootSessionId, workspaceIdentity, workspacePath],
  );
  const handleOpenSubagentDirectory = useCallback(
    (request: import("@/lib/workspaceSidePane.js").OpenSubagentDirectorySideTabRequest) => {
      if (compactForRemoteControl) return;
      onOpenSubagentDirectory?.({
        ...request,
        rootSessionId: request.rootSessionId ?? rootSessionId ?? request.parentSessionId,
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        ...(remoteSessionId ? { remoteSessionId } : {}),
      });
    },
    [
      compactForRemoteControl,
      onOpenSubagentDirectory,
      remoteSessionId,
      rootSessionId,
      workspaceIdentity,
      workspacePath,
    ],
  );
  const handleOpenPlanDetail = useCallback(
    (request: OpenPlanDetailSideTabRequest) => {
      onOpenPlanDetail?.({
        ...request,
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        ...(remoteSessionId ? { remoteSessionId } : {}),
      });
    },
    [onOpenPlanDetail, remoteSessionId, workspaceIdentity, workspacePath],
  );
  const handleOpenWorkflowRun = useCallback(
    (request: OpenWorkflowRunSideTabRequest) => {
      onOpenWorkflowRun?.({
        ...request,
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        ...(remoteSessionId ? { remoteSessionId } : {}),
      });
    },
    [onOpenWorkflowRun, remoteSessionId, workspaceIdentity, workspacePath],
  );
  const handleOpenWorkflowActorSession = useCallback(
    (request: OpenWorkflowActorSessionSideTabRequest) => {
      onOpenWorkflowActorSession?.({
        ...request,
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        ...(remoteSessionId ? { remoteSessionId } : {}),
      });
    },
    [onOpenWorkflowActorSession, remoteSessionId, workspaceIdentity, workspacePath],
  );
  const handleOpenWorkflowWorkspace = useCallback(
    (request: OpenWorkflowWorkspaceSideTabRequest) => {
      onOpenWorkflowWorkspace?.({
        ...request,
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        ...(remoteSessionId ? { remoteSessionId } : {}),
      });
    },
    [onOpenWorkflowWorkspace, remoteSessionId, workspaceIdentity, workspacePath],
  );
  const handleOpenWorkflowArtifact = useCallback(
    (request: OpenWorkflowArtifactSideTabRequest) => {
      onOpenWorkflowArtifact?.({
        ...request,
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        ...(remoteSessionId ? { remoteSessionId } : {}),
      });
    },
    [onOpenWorkflowArtifact, remoteSessionId, workspaceIdentity, workspacePath],
  );
  //
  //
  const workflowRunJournalSummaries = useWorkflowRunJournalSummaries({
    sessionId,
    enabled: !readOnly && runtimeReady,
    live: state.status === "live" && runtimeReady,
    limit: WORKFLOW_RUN_DIRECTORY_LIMIT,
    refreshKey: workflowRunDirectoryRefreshKey(snapshot?.workflowRuns?.runs),
  });
  const endedWorkflowRunCount = useMemo(
    () => countEndedWorkflowRuns(workflowRunJournalSummaries),
    [workflowRunJournalSummaries],
  );
  const workflowRunByToolCallId = useMemo(
    () => buildWorkflowRunByToolCallId(snapshot?.workflowRuns?.runs),
    [snapshot?.workflowRuns],
  );
  const workflowRunByRunId = useMemo(
    () => buildWorkflowRunByRunId(snapshot?.workflowRuns?.runs),
    [snapshot?.workflowRuns],
  );
  const workflowGraphByToolCallId = useMemo(
    () => buildWorkflowGraphByToolCallId(snapshot?.rows.window),
    [snapshot?.rows.window],
  );
  const workflowFillGraphByRunId = useMemo(
    () => buildWorkflowFillGraphByRunId(snapshot?.rows.window),
    [snapshot?.rows.window],
  );
  const workflowDraftByToolCallId = useMemo(
    () => buildWorkflowDraftByToolCallId(snapshot?.rows.window),
    [snapshot?.rows.window],
  );
  const workflowSaveCandidatesByRunId = useMemo(
    () => buildWorkflowSaveCandidatesByRunId(snapshot?.rows.window),
    [snapshot?.rows.window],
  );
  const workflowRunPendingQuestionsByRunId = useMemo(
    () => buildWorkflowRunPendingQuestionsByRunId(snapshot?.workflowRuns?.runs),
    [snapshot?.workflowRuns],
  );
  const handleOpenWorkflowRunFromPanel = useCallback(
    (target: ConversationStatusPanelWorkflowRunTarget) => {
      if (!sessionId) return;
      handleOpenWorkflowRun({ ...target, parentSessionId: sessionId });
    },
    [handleOpenWorkflowRun, sessionId],
  );
  const handleOpenWorkflowRunDirectoryFromPanel = useCallback(
    (request: OpenWorkflowRunDirectorySideTabRequest) => {
      onOpenWorkflowRunDirectory?.({
        ...request,
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        ...(remoteSessionId ? { remoteSessionId } : {}),
      });
    },
    [onOpenWorkflowRunDirectory, remoteSessionId, workspaceIdentity, workspacePath],
  );
  const handleAddSelectionToCurrentTask = useCallback(
    (reference: ConversationSelectionReference) => {
      if (!sessionId) return;
      dispatchConversationSelectionAdd({
        targetSessionId: sessionId,
        workspaceKey,
        reference,
      });
    },
    [sessionId, workspaceKey],
  );
  const handleOpenSelectionSideConversation = useCallback(
    async (reference?: ConversationSelectionReference, forceNew = false) => {
      if (!sessionId || !selectionSideChatKey || !onOpenSelectionSideChat) return;
      try {
        let targetChildSessionId = reference && !forceNew ? activeSelectionSideChatSessionId : null;
        let replacesChildSessionId: string | undefined;
        if (targetChildSessionId) {
          try {
            await cfSessionService.readSession({
              workspacePath,
              ...(workspaceIdentity ? { workspaceIdentity } : {}),
              sessionId: targetChildSessionId,
              messageLimit: 1,
            });
          } catch (error) {
            if (!String(error).includes("sessionNotFound")) throw error;
            replacesChildSessionId = targetChildSessionId;
            clearSelectionSideChat(targetChildSessionId);
            clearConversationSelectionReferenceScope(targetChildSessionId, workspaceKey);
            targetChildSessionId = null;
          }
        }

        if (targetChildSessionId) {
          onOpenSelectionSideChat({
            workspacePath,
            ...(workspaceIdentity ? { workspaceIdentity } : {}),
            ...(remoteSessionId ? { remoteSessionId } : {}),
            parentSessionId: sessionId,
            childSessionId: targetChildSessionId,
          });
          if (reference) {
            dispatchConversationSelectionAdd({
              targetSessionId: targetChildSessionId,
              workspaceKey,
              reference,
            });
          }
          return;
        }

        const childSessionId = await createSelectionSideChat(selectionSideChatKey, async () => {
          const ack = await dispatchCommand("createSelectionSideSession", {}, sessionId);
          if (
            (ack.status !== "accepted" && ack.status !== "duplicate") ||
            ack.result?.type !== "createSelectionSideSession"
          ) {
            throw new Error(ack.reasonCode ?? "createSelectionSideSession 被拒绝");
          }
          return ack.result.sessionId;
        });
        onOpenSelectionSideChat({
          workspacePath,
          ...(workspaceIdentity ? { workspaceIdentity } : {}),
          ...(remoteSessionId ? { remoteSessionId } : {}),
          parentSessionId: sessionId,
          childSessionId,
          ...(replacesChildSessionId ? { replacesChildSessionId } : {}),
        });
        if (reference) {
          dispatchConversationSelectionAdd({
            targetSessionId: childSessionId,
            workspaceKey,
            reference,
          });
        }
      } catch (error) {
        logger.warn("[v4-pane] Failed to create selection side session", {
          error: error instanceof Error ? error.message : String(error),
          parentSessionId: sessionId,
          workspaceKey,
        });
      }
    },
    [
      activeSelectionSideChatSessionId,
      dispatchCommand,
      onOpenSelectionSideChat,
      remoteSessionId,
      selectionSideChatKey,
      sessionId,
      workspaceIdentity,
      workspaceKey,
      workspacePath,
      cfSessionService,
    ],
  );

  const handleOpenSelectionSideConversationWithPrompt = useCallback(
    async (text: string, telemetrySeed?: ConversationPromptTelemetrySeed): Promise<boolean> => {
      if (!sessionId || !selectionSideChatKey || !onOpenSelectionSideChat) {
        throw new Error("selection side chat is unavailable");
      }
      const inherited = resolveSelectionSideInheritedModel(
        snapshotRef.current?.config,
        modelSelectionView,
      );
      const chosen = inherited ? await recommendStartPlan(inherited) : undefined;
      if (chosen === null) return false;
      const modelSelection = chosen && chosen !== inherited ? chosen : undefined;
      const pendingKey = `${selectionSideChatKey}\u0000prompt\u0000${text}`;
      const childSessionId = await createSelectionSideChat(pendingKey, async () => {
        const ack = await dispatchCommand(
          "createSelectionSideSession",
          { firstInput: { text, ...(modelSelection ? { modelSelection } : {}) } },
          sessionId,
          undefined,
          undefined,
          telemetrySeed,
        );
        if (
          (ack.status !== "accepted" && ack.status !== "duplicate") ||
          ack.result?.type !== "createSelectionSideSession"
        ) {
          throw new Error(ack.reasonCode ?? "createSelectionSideSession 被拒绝");
        }
        return ack.result.sessionId;
      });
      onOpenSelectionSideChat({
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        ...(remoteSessionId ? { remoteSessionId } : {}),
        parentSessionId: sessionId,
        childSessionId,
      });
      return true;
    },
    [
      dispatchCommand,
      modelSelectionView,
      recommendStartPlan,
      onOpenSelectionSideChat,
      remoteSessionId,
      selectionSideChatKey,
      sessionId,
      workspaceIdentity,
      workspacePath,
    ],
  );

  useEffect(() => {
    if (
      !selectionSideChatKey ||
      !sessionId ||
      readOnly ||
      selectionSideChat ||
      isMobileTextInputViewport ||
      !onOpenSelectionSideChat
    ) {
      return;
    }

    return registerSelectionSideChatOpener(
      selectionSideChatKey,
      (reference) => handleOpenSelectionSideConversation(reference, !reference),
      focused,
      Boolean(blockingInteractionId) || selectionSideActionBlocked,
    );
  }, [
    blockingInteractionId,
    selectionSideActionBlocked,
    focused,
    handleOpenSelectionSideConversation,
    isMobileTextInputViewport,
    onOpenSelectionSideChat,
    readOnly,
    selectionSideChat,
    selectionSideChatKey,
    sessionId,
  ]);

  const cliSlashCommandNames = useMemo(
    () =>
      new Set(
        (slashCommands ?? []).map((command) =>
          normalizeSlashCommandValue(command.name).toLowerCase(),
        ),
      ),
    [slashCommands],
  );
  const availableSelectionSideSlashCommandNames = useMemo(
    () => ["side", "btw"].filter((name) => !cliSlashCommandNames.has(name)),
    [cliSlashCommandNames],
  );

  const appSlashCommands = useMemo<AppSlashCommand[] | undefined>(() => {
    if (readOnly) return undefined;
    const planAction: AppSlashCommand = {
      value: "plan",
      label: intl.formatMessage({ id: "chat.slash.app.plan.label" }),
      description: intl.formatMessage({ id: "chat.slash.app.plan.description" }),
      keywords: ["plan", "计划", "计划模式"],
      run: () => handleDraftSwitchMode("plan"),
    };
    if (
      !sessionId ||
      !onOpenSelectionSideChat ||
      !shouldOfferSideSlashCommand({
        isDraft: sessionId === null,
        selectionSideChat,
        readOnly,
        isMobileViewport: isMobileTextInputViewport,
      })
    ) {
      return [planAction];
    }
    const openNewSelectionSideChat = () => {
      void handleOpenSelectionSideConversation(undefined, true);
    };
    const sharedKeywords = ["side", "btw", "side chat", "auxiliary", "Auxiliary Chat", "辅助", "侧边"];
    const description = intl.formatMessage({ id: "chat.slash.app.side.description" });
    return [
      planAction,
      ...[
        { value: "side", description, keywords: sharedKeywords, run: openNewSelectionSideChat },
        { value: "btw", description, keywords: sharedKeywords, run: openNewSelectionSideChat },
      ].filter((command) => !cliSlashCommandNames.has(command.value)),
    ];
  }, [
    cliSlashCommandNames,
    handleDraftSwitchMode,
    handleOpenSelectionSideConversation,
    intl,
    isMobileTextInputViewport,
    onOpenSelectionSideChat,
    readOnly,
    selectionSideChat,
    sessionId,
  ]);

  const chatLoadingBlockedByInteraction = hasChatLoadingBlockingInteraction(
    snapshot?.pendingInteractions ?? [],
  );
  const chatLoadingBlockedByActiveWork = hasChatLoadingBlockingActiveWork(
    snapshot?.control.activeWorks ?? [],
  );
  const workspaceFileRewindEnabled = !readOnly || allowWorkspaceFileRewind;
  const handleCancelBackgroundWork = useCallback(
    (workId: string) => {
      if (!sessionId) return;
      void dispatchCommand("cancelBackgroundWork", { workId }, sessionId).then((ack) => {
        if (ack.status !== "accepted" && ack.status !== "noop") {
          logger.warn(
            `[v4-pane] cancelBackgroundWork 被Deny: ${ack.status} ${ack.reasonCode ?? ""}`,
          );
        }
      });
    },
    [dispatchCommand, sessionId],
  );

  const { enabled: dynamicWorkflowEnabled } = useDynamicWorkflowAvailability();

  const handleResumeWorkflowRun = useCallback(
    (workId: string, name?: string) => {
      if (!sessionId) return;
      void dispatchCommand(
        "resumeWorkflowRun",
        { workId, ...(name ? { name } : {}) },
        sessionId,
      ).then((ack) => {
        if (ack.status !== "accepted" && ack.status !== "noop") {
          logger.warn(`[v4-pane] resumeWorkflowRun 被Deny: ${ack.status} ${ack.reasonCode ?? ""}`);
        }
      });
    },
    [dispatchCommand, sessionId],
  );

  const handleAmendWorkflowRunSettings = useCallback(
    (workId: string, change: WorkflowRunSettingsChange): Promise<CommandAck> =>
      dispatchCommand("amendWorkflowRunSettings", { workId, ...change }, sessionId),
    [dispatchCommand, sessionId],
  );
  const workflowSessionModel = useMemo(
    () => workflowSessionModelOf(snapshot?.sessionId === sessionId ? snapshot?.config : undefined),
    [sessionId, snapshot?.config, snapshot?.sessionId],
  );

  
  const sendTextRef = useRef<typeof handleSendText | null>(null);
  const handleSendWorkflowSaveRequest = useCallback(async (text: string) => {
    const send = sendTextRef.current;
    if (send === null) throw new Error("send path not mounted");
    const result = await send(text);
    if (result !== "sent") throw new Error(`workflow save request not sent: ${result}`);
  }, []);

  const rowContext = useMemo<ConversationRowRenderContext>(
    () => ({
      workspacePath,
      workspaceHomePath,
      workspaceIdentity,
      workspaceRemoteSessionId: remoteSessionId ?? undefined,
      modelSelectionView,
      logEpoch: snapshot?.logEpoch,
      theme,
      codePreviewSettings,
      sessionId,
      rootSessionId: rootSessionId ?? sessionId,
      compactForRemoteControl,
      chatLoadingBlockedByActiveWork,
      chatLoadingBlockedByInteraction,
      messageStreamShowReasoning,
      messageStreamShowTodos,
      toolGroupingExploreEnabled,
      toolGroupingTerminalEnabled,
      toolGroupingChangesEnabled,
      onNavigateToRow: handleNavigateToRow,
      onOpenBrowserUrl,
      onOpenAutomationsMain,
      onOpenCodeViewer,
      onAutoOpenAssistantPptx: runtimeReady ? handleAutoOpenAssistantPptx : undefined,
      assistantPreviewPptxAutoOpenTarget,
      onOpenFileLink,
      onOpenSubagentSession:
        runtimeReady && onOpenSubagentSession ? handleOpenSubagentSession : undefined,
      onOpenPlanDetail: runtimeReady && onOpenPlanDetail ? handleOpenPlanDetail : undefined,
      onOpenWorkflowRun: runtimeReady && onOpenWorkflowRun ? handleOpenWorkflowRun : undefined,
      onOpenWorkflowActor:
        runtimeReady && onOpenWorkflowActorSession ? handleOpenWorkflowActorSession : undefined,
      onOpenWorkflowWorkspace:
        runtimeReady && onOpenWorkflowWorkspace ? handleOpenWorkflowWorkspace : undefined,
      onOpenWorkflowArtifact:
        runtimeReady && onOpenWorkflowArtifact ? handleOpenWorkflowArtifact : undefined,
      onCancelBackgroundWork: readOnly || !runtimeReady ? undefined : handleCancelBackgroundWork,
      onResumeWorkflowRun: resolveWorkflowResumeHandler({
        readOnly: readOnly || !runtimeReady,
        dynamicWorkflowEnabled,
        handler: handleResumeWorkflowRun,
      }),
      onAmendWorkflowRunSettings:
        runtimeReady && sessionId
          ? resolveWorkflowResumeHandler({
              readOnly,
              dynamicWorkflowEnabled,
              handler: handleAmendWorkflowRunSettings,
            })
          : undefined,
      onSendWorkflowSaveRequest:
        runtimeReady && sessionId
          ? resolveWorkflowResumeHandler({
              readOnly,
              dynamicWorkflowEnabled,
              handler: handleSendWorkflowSaveRequest,
            })
          : undefined,
      workflowSaveCandidatesByRunId,
      ...(workflowSessionModel === undefined ? {} : { workflowSessionModel }),
      workflowRunByToolCallId,
      workflowRunByRunId,
      workflowRunPendingQuestionsByRunId,
      workflowGraphByToolCallId,
      workflowFillGraphByRunId,
      workflowDraftByToolCallId,
      fetchFileChanges: runtimeReady ? handleFetchFileChanges : undefined,
      previewFileRewind:
        runtimeReady && workspaceFileRewindEnabled ? handlePreviewFileRewind : undefined,
      applyFileRewind:
        runtimeReady && workspaceFileRewindEnabled ? handleApplyFileRewind : undefined,
      readAttachment: runtimeReady ? attachmentRead : undefined,
      readAttachmentRange: runtimeReady ? attachmentReadRange : undefined,
    }),
    [
      workspacePath,
      workspaceHomePath,
      workspaceIdentity,
      remoteSessionId,
      modelSelectionView,
      snapshot?.logEpoch,
      theme,
      codePreviewSettings,
      sessionId,
      rootSessionId,
      compactForRemoteControl,
      chatLoadingBlockedByActiveWork,
      chatLoadingBlockedByInteraction,
      messageStreamShowReasoning,
      messageStreamShowTodos,
      toolGroupingExploreEnabled,
      toolGroupingTerminalEnabled,
      toolGroupingChangesEnabled,
      handleNavigateToRow,
      onOpenBrowserUrl,
      onOpenAutomationsMain,
      onOpenCodeViewer,
      handleAutoOpenAssistantPptx,
      assistantPreviewPptxAutoOpenTarget,
      onOpenFileLink,
      onOpenSubagentSession,
      handleOpenSubagentSession,
      onOpenPlanDetail,
      handleOpenPlanDetail,
      onOpenWorkflowRun,
      handleOpenWorkflowRun,
      onOpenWorkflowActorSession,
      handleOpenWorkflowActorSession,
      onOpenWorkflowWorkspace,
      handleOpenWorkflowWorkspace,
      onOpenWorkflowArtifact,
      handleOpenWorkflowArtifact,
      readOnly,
      runtimeReady,
      handleCancelBackgroundWork,
      dynamicWorkflowEnabled,
      handleResumeWorkflowRun,
      handleAmendWorkflowRunSettings,
      handleSendWorkflowSaveRequest,
      workflowSaveCandidatesByRunId,
      workflowSessionModel,
      workflowRunByToolCallId,
      workflowRunByRunId,
      workflowRunPendingQuestionsByRunId,
      workflowGraphByToolCallId,
      workflowFillGraphByRunId,
      workflowDraftByToolCallId,
      workspaceFileRewindEnabled,
      handleFetchFileChanges,
      handlePreviewFileRewind,
      handleApplyFileRewind,
      attachmentRead,
      attachmentReadRange,
    ],
  );

  const { binding: prewarmBinding, waitForSession: waitForDraftSession } = useDraftSessionPrewarm({
    enabled: sessionId === null && draftAgentStartupAllowed && !recoveringDraft,
    workspaceKey,
    paneId,
    invalidationVersion: draftRuntimeInvalidationVersion,
    transportIdentity: layer,
    dispatchCommand,
    resolveInitialConfig: resolveInitialDraftConfig,
  });
  const prewarmBindingRef = useRef(prewarmBinding);
  prewarmBindingRef.current = prewarmBinding;
  const prewarmSessionId = prewarmBinding?.sessionId ?? null;
  const { rebuilding: draftRuntimeRebuilding } = useDraftRuntimeRebuildGate({
    enabled: sessionId === null,
    onRuntimeRestart,
    onRuntimeLifecycle,
    prewarmSessionId,
    workspaceIdentity,
    workspacePath,
  });
  const ensureDraftPrewarmConfigBeforeSendRef = useRef<(targetSessionId: string) => Promise<void>>(
    async () => undefined,
  );
  const effectiveSessionId = sessionId ?? recoveringDraft?.sessionId ?? prewarmSessionId;
  useEffect(() => {
    if (!recoveringDraft?.commandId || !remoteAvailable) return;
    let current = true;
    const commandId = recoveringDraft.commandId;
    const off = pendingCommandRegistry.subscribeResolution(commandId, (resolution) => {
      if (!current) return;
      if (
        resolution === "accepted" ||
        resolution === "duplicate" ||
        resolution === "authoritative"
      ) {
        const entry = pendingCommandRegistry.findCommand(commandId);
        const recoveredSessionId = entry?.sessionId ?? recoveringDraft.sessionId;
        if (recoveredSessionId)
          void handleDraftSessionCreated(
            recoveredSessionId,
            entry?.clientContext?.sessionCreateSource,
            commandId,
            entry?.clientContext?.taskGroupId,
          );
      } else if (resolution === "failed" || resolution === "discarded") {
        setResolvedDraftCommand(commandId);
      }
    });
    void pendingCommandRegistry
      .reconcileSession(
        pendingCommandRegistry.findCommand(commandId)?.sessionId ??
          recoveringDraft.sessionId ??
          null,
        (params) => layer.queryCommands(params),
        workspaceIdentity?.trim() || workspacePath,
      )
      .catch((error) => {
        logger.warn("[v4-composer] Failed to query initial send result recovery; retaining draft identity", error);
      });
    return () => {
      current = false;
      off();
    };
  }, [
    recoveringDraft,
    remoteAvailable,
    layer,
    handleDraftSessionCreated,
    newTaskComposerScope,
    workspacePath,
    workspaceIdentity,
  ]);
  const showModelChangeNotice = useCallback(
    (sourceModel: ModelSelectionSource | null, targetModel: ModelSelectionSource) => {
      if (sessionId === null) {
        return;
      }

      const fromProviderId = sourceModel?.provider ?? "";
      const fromModelId = sourceModel?.model ?? "";
      const providerChanged = Boolean(
        fromProviderId && targetModel.provider && fromProviderId !== targetModel.provider,
      );
      if (
        !fromModelId ||
        !targetModel.model ||
        (fromModelId === targetModel.model && !providerChanged)
      ) {
        return;
      }

      const fromProvider = resolveProviderLabel(fromProviderId, modelSelectionView);
      const toProvider = resolveProviderLabel(targetModel.provider, modelSelectionView);
      const fromModel = formatModelChangeLabel(fromProviderId, fromProvider, fromModelId, intl);
      const toModel = formatModelChangeLabel(
        targetModel.provider,
        toProvider,
        targetModel.model,
        intl,
      );
      toast(intl.formatMessage({ id: "chat.modelChangeNotice.changed" }, { fromModel, toModel }));
    },
    [intl, modelSelectionView, sessionId],
  );

  const handleOnlineModelTransition = useCallback(
    (
      subscribedSessionId: string,
      _store: SessionLease["store"],
      transition: SessionModelTransition,
    ) => {
      if (!focused || subscribedSessionId !== effectiveSessionId) return;
      showModelChangeNotice(transition.from, transition.to);
    },
    [
      effectiveSessionId,
      focused,
      provider,
      sessionId,
      showModelChangeNotice,
      workspaceIdentity,
      workspaceKey,
      workspacePath,
    ],
  );
  const onlineModelTransitionHandlerRef = useRef(handleOnlineModelTransition);
  useLayoutEffect(() => {
    onlineModelTransitionHandlerRef.current = handleOnlineModelTransition;
  }, [handleOnlineModelTransition]);

  const recoverableCommands = usePendingCommandRecovery({
    layer,
    sessionId: effectiveSessionId,
    snapshot,
    status: state.status,
    subscriptionId: state.subscriptionId,
    workspacePath,
    workspaceIdentity,
  });

  useEffect(() => {
    if (!effectiveSessionId) {
      setLease({ sessionId, layer, lease: null });
      return;
    }
    const nextLease = layer.acquire(effectiveSessionId);
    const offOnlineModelTransition = nextLease.store.onOnlineModelTransition((transition) => {
      onlineModelTransitionHandlerRef.current(effectiveSessionId, nextLease.store, transition);
    });
    setLease({ sessionId, layer, lease: nextLease });
    return () => {
      offOnlineModelTransition();
      nextLease.release();
    };
  }, [layer, effectiveSessionId]);

  useEffect(() => {
    if (!sessionId || !lease || snapshot?.sessionId !== sessionId) return;
    void lease.store.refreshPlans();
  }, [lease, sessionId, snapshot?.sessionId, state.planDirectoryRevision]);

  useEffect(() => {
    if (sessionId === null && prewarmBinding && state.status === "error") {
      logger.warn("[v4-draft-prewarm] Failed to subscribe to prewarm session; discarding old binding", {
        prewarmSessionId: prewarmBinding.sessionId,
        lastError: state.lastError ?? null,
      });
      prewarmBinding.discard();
    }
  }, [prewarmBinding, sessionId, state.lastError, state.status]);

  useEffect(() => {
    if (
      !selectionSideChat ||
      state.status !== "error" ||
      !state.lastError?.includes("sessionNotFound")
    ) {
      return;
    }
    onSelectionSideChatUnavailable?.();
  }, [onSelectionSideChatUnavailable, selectionSideChat, state.lastError, state.status]);

  const settleCurrentQueueInputs = useCallback((targetSessionId: string) => {
    const current = snapshotRef.current;
    if (!current || current.sessionId !== targetSessionId) return;
    for (const item of current.queue.items) {
      pendingCommandRegistry.settle(targetSessionId, item.sourceCommandId);
    }
  }, []);

  const dispatchSlashCommand = useCallback(
    async (
      command: V4VisibleSlashCommand,
      targetSessionId: string,
      baseRevision: number | undefined,
      heldQueueDisposition: "clearQueueAndSend" | "keepQueueAndSend" | undefined,
      expectedHeldQueueItemIds?: readonly string[],
      submission?: ComposerSubmissionConfig,
      onAccepted?: (messageId: string) => void,
    ): Promise<boolean | "confirmationRequired"> => {
      let type: CommandType | null = null;
      let payload: Record<string, unknown> = {};
      let withBaseRevision = false;
      const currentRoutingMode = snapshotRef.current?.inputRouting.mode;
      const compactExpectedToQueue =
        command.kind === "compact" &&
        currentRoutingMode !== undefined &&
        currentRoutingMode !== "startNow";
      switch (command.kind) {
        case "compact":
          type = "compact";
          break;
        case "sendGoalCommand":
          type = "sendGoalCommand";
          if (!submission) return false;
          payload = {
            text: command.objective,
            displayText: command.displayText,
            ...submission,
            ...(heldQueueDisposition ? { heldQueueDisposition } : {}),
            ...(expectedHeldQueueItemIds ? { expectedHeldQueueItemIds } : {}),
          };
          break;
        case "resumeGoal":
          type = "resumeGoal";
          withBaseRevision = true;
          break;
        case "emptyGoal":
          logger.warn("[v4-pane] /goal 需要目标文本");
          return true;
        case "unsupportedGoal":
          logger.warn(`[v4-pane] 暂不支持 /goal ${command.action}`);
          return true;
        default:
          return false;
      }
      if (withBaseRevision && baseRevision === undefined) {
        logger.warn(`[v4-pane] slash ${command.kind} Missing baseRevision`);
        return true;
      }
      const ack = await dispatchCommand(
        type,
        payload,
        targetSessionId,
        withBaseRevision ? baseRevision : undefined,
      );
      if (ack.status === "accepted") onAccepted?.(ack.commandId);
      if (ack.reasonCode === "guard.heldQueueConfirmationStale") {
        return "confirmationRequired";
      }
      if (ack.status !== "accepted" && ack.status !== "noop") {
        logger.warn(
          `[v4-pane] slash ${command.kind} 被Deny: ${ack.status} ${ack.reasonCode ?? ""}`,
        );
        if (command.kind === "compact" && ack.reasonCode === "compactOperationLock") {
          toast(intl.formatMessage({ id: "chat.compact.duplicateBlocked" }));
        } else if (command.kind === "compact" && ack.reasonCode === "activeTurn") {
          toast(intl.formatMessage({ id: "chat.compact.runningBlocked" }));
        }
      } else if (command.kind === "compact" && compactExpectedToQueue) {
        toast(intl.formatMessage({ id: "chat.compact.queued" }));
      } else if (heldQueueDisposition === "clearQueueAndSend") {
        settleCurrentQueueInputs(targetSessionId);
      }
      return true;
    },
    [dispatchCommand, intl, settleCurrentQueueInputs],
  );

  const readGroupedDraftId = useCallback(
    () =>
      String(
        useCfSessionStore.getState().getWorkspaceState(workspacePath, workspaceIdentity)
          .draftFocusVersion,
      ),
    [workspacePath, workspaceIdentity],
  );
  
  const captureHighspeedPaneOrigin = useCallback(
    (): HighspeedPaneOrigin => ({
      sessionId: sessionIdRef.current,
      paneBinding: paneBindingRef.current.generation,
      draftId: sessionIdRef.current === null ? readGroupedDraftId() : null,
    }),
    [readGroupedDraftId],
  );

  const prepareHighspeedTurnFrom = useCallback(
    (origin: HighspeedPaneOrigin): HighspeedTurnPreparer =>
      async (
        taskId: string,
        submissionSelection?: ModelSelection,
      ): Promise<HighspeedPrepareTurnResult | null> => {
        const selection = resolveHighspeedPrepareSelection({
          submissionSelection,
          projectedConfig:
            snapshotRef.current?.sessionId === taskId ? snapshotRef.current.config : null,
          draftConfig: draftConfigRef.current,
          initialDraftConfig: resolveInitialDraftConfig(),
        });
        if (!selection) return null;
        const { provider, model, reasoningLevel } = selection;
        try {
          const sendStartedAt = Date.now();
          const result = await highspeedCardService.prepareTurn({
            taskId,
            providerId: provider,
            model,
            ...(reasoningLevel ? { reasoningLevel } : {}),
            waitBudgetMs: HIGHSPEED_SEND_WAIT_BUDGET_MS,
          });
          if (result.kind === "accelerated") {
            const regularTps = await readRegularTpsWithinSendBudget({
              read: async () => {
                const providerSettingsState = getProviderSettingsSnapshot();
                const accountAccess =
                  providerSettingsState.status === "ready"
                    ? resolveEntitledAccountProviderAccess(providerSettingsState.view, provider)
                    : null;
                if (!accountAccess) return undefined;
                return readHighspeedRegularTpsFromHealth({
                  usageStatsService,
                  preferredProviderId: provider,
                  accountAccess: accountAccess.access,
                  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                });
              },
              elapsedMs: Date.now() - sendStartedAt,
              onError: (error) =>
                logger.warn("[highspeed] Failed to read regular Decode TPS; time saved will not be displayed this turn", {
                  error: error instanceof Error ? error.message : String(error),
                  provider,
                  taskId,
                }),
              onTimeout: (budgetMs) =>
                logger.info(
                  "[highspeed] Regular Decode TPS did not return within send budget; regularTps will not be attached this turn",
                  {
                    budgetMs,
                    provider,
                    taskId,
                  },
                ),
            });
            const acceleratedResult: HighspeedPrepareTurnResult = regularTps
              ? { ...result, card: { ...result.card, regularTps } }
              : result;
            const cardId = acceleratedResult.card.cardId;
            const paneSessionId = sessionIdRef.current;
            const paneShowsSendTarget =
              paneSessionId === taskId ||
              (origin.sessionId === null &&
                paneSessionId === null &&
                paneBindingRef.current.generation === origin.paneBinding &&
                readGroupedDraftId() === origin.draftId);
            if (!paneShowsSendTarget) {
              return acceleratedResult;
            }
            if (presentedHighspeedCardIdRef.current !== cardId) {
              presentedHighspeedCardIdRef.current = cardId;
              setHighspeedActivationCardId(cardId);
            }
            setActiveHighspeedCard(acceleratedResult.card);
            return acceleratedResult;
          } else if (
            !result.card ||
            result.card.taskId !== taskId ||
            result.card.expiresAt <= Date.now()
          ) {
            setActiveHighspeedCard((current) => (current?.taskId === taskId ? null : current));
          }
          return result;
        } catch (error) {
          logger.warn("[highspeed] 抽卡失败，本轮按普通模型发送", {
            error: error instanceof Error ? error.message : String(error),
            taskId,
          });
          return null;
        }
      },
    [
      draftConfigRef,
      highspeedCardService,
      readGroupedDraftId,
      resolveInitialDraftConfig,
      usageStatsService,
    ],
  );

  const dispatchSendTextAfterConfig = useCallback(
    async (
      text: string,
      options: ConversationComposerSendOptions | undefined,
      createSourceAtSend: SessionCreateSource,
      highspeedOriginAtSend: HighspeedPaneOrigin,
      taskGroupIdAtSend?: string | null,
    ) => {
      let onAcceptedSelection: (() => void) | undefined;
      const prepareHighspeedTurn = prepareHighspeedTurnFrom(highspeedOriginAtSend);
      const dispatchSubmissionCommand = async (...args: Parameters<typeof dispatchCommand>) => {
        args[9] = createSourceAtSend;
        args[11] = taskGroupIdAtSend;
        args[12] = options?.submittedDraftText ?? text;
        if (
          args[0] === "sendText" &&
          args[2] &&
          baseWorkspaceServices.genUiService &&
          typeof args[1]?.text === "string"
        ) {
          try {
            const context = buildGenUiModelContext(
              await baseWorkspaceServices.genUiService.listState({
                workspacePath,
                workspaceIdentity,
                sessionId: args[2],
              }),
            );
            if (context) args[1] = { ...args[1], text: `${args[1].text}\n\n${context}` };
          } catch {
            logger.warn("[gen-ui] Widget context unavailable");
          }
        }
        const ack = await dispatchCommand(...args);
        if (ack.status === "accepted" && submissionConfigFromCommand(args[0], args[1]))
          onAcceptedSelection?.();
        return ack;
      };
      let submission = options?.submission ?? null;
      const heldQueueDisposition = options?.heldQueueDisposition;
      const expectedHeldQueueItemIds = options?.expectedHeldQueueItemIds;
      const readyAttachments = options?.attachments ?? [];
      const sharedContextRefs = options?.sharedContextRefs;
      const contextAttachmentCount = options?.contextAttachmentCount ?? 0;
      const slashCommand = parseV4VisibleSlashCommand(text, readyAttachments, {
        contextAttachmentCount,
      });

      if (!(await ensureDraftModelReadyForSend())) {
        return "blocked" as const;
      }

      const selectionSideSlashCommand =
        sessionId &&
        appSlashCommands?.some((command) => command.value === "side" || command.value === "btw")
          ? parseSelectionSideSlashCommand(text, readyAttachments, {
              contextAttachmentCount,
              enabledCommandNames: availableSelectionSideSlashCommandNames,
            })
          : null;
      if (sessionId && selectionSideSlashCommand) {
        const created = await handleOpenSelectionSideConversationWithPrompt(
          selectionSideSlashCommand.text,
          options?.telemetrySeed,
        );
        return created ? ("sent" as const) : ("blocked" as const);
      }
      if (
        submission?.planEnabled &&
        slashCommand !== null &&
        (slashCommand.kind === "sendGoalCommand" ||
          slashCommand.kind === "resumeGoal" ||
          slashCommand.kind === "emptyGoal" ||
          slashCommand.kind === "unsupportedGoal")
      ) {
        toast(intl.formatMessage({ id: "chat.goal.planModeBlocked" }));
        return "blocked" as const;
      }
      if (!submission) {
        logger.warn("[v4-pane] Submission is missing full model or mode configuration");
        return "blocked" as const;
      }
      const currentRoutingMode = snapshotRef.current?.inputRouting.mode;
      if (
        currentRoutingMode === "choice" &&
        !heldQueueDisposition &&
        (slashCommand === null || slashCommand.kind === "sendGoalCommand")
      ) {
        return "confirmationRequired" as const;
      }
      if (slashCommand === null || slashCommand.kind === "sendGoalCommand") {
        const original = submission.modelSelection;
        const chosen = await recommendStartPlan(original);
        if (!chosen) return "blocked" as const;
        if (chosen !== original) {
          onAcceptedSelection = captureAcceptedModelSelection(chosen, original);
          submission = { ...submission, modelSelection: chosen };
        }
      }
      const prewarmTargetBeforeSend =
        sessionId === null ? prewarmBindingRef.current?.sessionId : null;
      if (prewarmTargetBeforeSend) {
        await ensureDraftPrewarmConfigBeforeSendRef.current(prewarmTargetBeforeSend);
      }
      if (sessionId && slashCommand) {
        const consumed = await dispatchSlashCommand(
          slashCommand,
          sessionId,
          snapshotRef.current?.revision,
          heldQueueDisposition,
          expectedHeldQueueItemIds,
          submission,
        );
        if (consumed === "confirmationRequired") return consumed;
        if (consumed) {
          onAcceptedSelection?.();
          return;
        }
      }
      const draftSlashCommand =
        slashCommand?.kind === "sendGoalCommand" ||
        slashCommand?.kind === "resumeGoal" ||
        slashCommand?.kind === "emptyGoal" ||
        slashCommand?.kind === "unsupportedGoal"
          ? slashCommand
          : null;
      if (!sessionId && draftSlashCommand) {
        if (
          draftSlashCommand.kind === "emptyGoal" ||
          draftSlashCommand.kind === "unsupportedGoal"
        ) {
          await dispatchSlashCommand(
            draftSlashCommand,
            prewarmBindingRef.current?.sessionId ?? "__draft__",
            undefined,
            heldQueueDisposition,
            expectedHeldQueueItemIds,
            submission,
          );
          return;
        }
      }
      const draftBinding = sessionId === null ? await waitForDraftSession() : null;
      if (draftBinding) {
        await ensureDraftPrewarmConfigBeforeSendRef.current(draftBinding.sessionId);
        if (!draftBinding.beginPromotion()) throw new Error("Draft session has changed; please resend");
      }
      const targetSessionId = sessionId ?? draftBinding!.sessionId;
      if (draftBinding && draftSlashCommand) {
        const consumed = await dispatchSlashCommand(
          draftSlashCommand,
          targetSessionId,
          0,
          heldQueueDisposition,
          expectedHeldQueueItemIds,
          submission,
          (messageId) => reportDraftCreated(targetSessionId, createSourceAtSend, messageId),
        );
        if (consumed === "confirmationRequired") return consumed;
        if (consumed) {
          draftBinding.promote();
          await handleDraftSessionCreated(
            targetSessionId,
            createSourceAtSend,
            undefined,
            taskGroupIdAtSend,
          );
          return;
        }
      }
      const highspeed = await prepareHighspeedSendContext(
        targetSessionId,
        prepareHighspeedTurn,
        submission.modelSelection,
      );
      const ack = await dispatchSubmissionCommand(
        "sendText",
        {
          text,
          ...submission,
          ...(options?.requestedDelivery ? { requestedDelivery: options.requestedDelivery } : {}),
          conversationQuotes: options?.conversationQuotes,
          ...(readyAttachments.length > 0 ? { attachments: readyAttachments } : {}),
          ...(sessionId && options?.requestedDelivery
            ? {
                requestedDelivery: options.requestedDelivery,
              }
            : {}),
          ...(heldQueueDisposition ? { heldQueueDisposition } : {}),
          ...(expectedHeldQueueItemIds ? { expectedHeldQueueItemIds } : {}),
          ...(sharedContextRefs?.length ? { context_refs: sharedContextRefs } : {}),
          ...(options?.source ? { source: options.source } : {}),
          ...highspeed.override,
        },
        targetSessionId,
        undefined,
        undefined,
        options?.telemetrySeed,
        highspeed.acceleratedCard,
        options?.onCommandCreated
          ? (envelope) => {
              if (envelope.type === "sendText") options.onCommandCreated?.(envelope.commandId);
            }
          : undefined,
        undefined,
        undefined,
        submission,
      );
      if (ack.reasonCode === "guard.heldQueueConfirmationStale") {
        return "confirmationRequired" as const;
      }
      if (ack.status !== "accepted") {
        if (
          ack.reasonCode === "modelUnavailable" &&
          highspeed.acceleratedCard &&
          highspeed.override.modelExecution?.selectionFallback
        ) {
          setSendSubmissionError(null);
          invalidateActiveHighspeedCard(
            highspeed.acceleratedCard.cardId,
            `admission:${ack.commandId}:${highspeed.acceleratedCard.cardId}`,
          );
          return "blocked" as const;
        }
        throw new Error(ack.reasonCode ?? "sendText 被拒绝");
      }
      if (draftBinding) {
        draftBinding.promote();
        await handleDraftSessionCreated(
          targetSessionId,
          createSourceAtSend,
          ack.commandId,
          taskGroupIdAtSend,
        );
      } else if (heldQueueDisposition === "clearQueueAndSend") {
        settleCurrentQueueInputs(targetSessionId);
      }
    },
    [
      dispatchCommand,
      recommendStartPlan,
      baseWorkspaceServices,
      captureAcceptedModelSelection,
      dispatchSlashCommand,
      ensureDraftModelReadyForSend,
      availableSelectionSideSlashCommandNames,
      appSlashCommands,
      handleDraftSessionCreated,
      reportDraftCreated,
      handleOpenSelectionSideConversationWithPrompt,
      invalidateActiveHighspeedCard,
      intl,
      prepareHighspeedTurnFrom,
      resolveInitialDraftConfig,
      createSubmissionFromComposer,
      sessionId,
      settleCurrentQueueInputs,
      waitForDraftSession,
    ],
  );

  const dispatchSendText = useCallback(
    (text: string, options?: ConversationComposerSendOptions) => {
      const createSource = useCfSessionStore
        .getState()
        .getWorkspaceState(workspacePath, workspaceIdentity).draftCreateSource;
      const submissionOptions = {
        ...options,
        submission:
          options?.submission === undefined ? createSubmissionFromComposer() : options.submission,
      };
      const highspeedOrigin = captureHighspeedPaneOrigin();
      const taskGroupId =
        sessionId === null
          ? useCfSessionStore.getState().getWorkspaceState(workspacePath, workspaceIdentity)
              .draftTaskGroupId
          : undefined;
      return configCommandBarrier.enqueue(async () => {
        try {
          return await dispatchSendTextAfterConfig(
            text,
            submissionOptions,
            createSource,
            highspeedOrigin,
            taskGroupId,
          );
        } catch (error) {
          if (sessionId === null && isProviderNotReadyError(error)) {
            markDraftProviderNotReady();
            return "blocked" as const;
          }
          throw error;
        }
      });
    },
    [
      captureHighspeedPaneOrigin,
      configCommandBarrier,
      createSubmissionFromComposer,
      dispatchSendTextAfterConfig,
      markDraftProviderNotReady,
      sessionId,
      workspacePath,
      workspaceIdentity,
    ],
  );

  const focusTimelineToLatest = useCallback(() => {
    timelineScrollToBottomRef.current?.();
  }, []);

  const handleSendText = useCallback(
    async (
      text: string,
      options?: ConversationComposerSendOptions,
    ): Promise<ConversationComposerSendResult> => {
      const shouldFocusLatest = shouldFocusTimelineAfterComposerSend({
        draftMode: sessionId === null,
        inputRoutingMode: snapshotRef.current?.inputRouting.mode ?? null,
        heldQueueDisposition: options?.heldQueueDisposition,
      });
      try {
        const sendResult = await dispatchSendText(text, options);
        if (sendResult === "blocked" || sendResult === "confirmationRequired") {
          return sendResult;
        }
        setSendSubmissionError(null);
        if (shouldFocusLatest) {
          focusTimelineToLatest();
        }
        return "sent";
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const runtimeModelUnavailable = detail.includes("provider.notInRegistry");
        setSendSubmissionError({
          code:
            getRemoteConnectionFailureCode(error) ??
            (runtimeModelUnavailable ? "CF_RUNTIME_MODEL_UNAVAILABLE" : "SEND_FAILED"),
          message: runtimeModelUnavailable
            ? detail
            : intl.formatMessage({ id: "chat.error.sendFailed" }),
          detail,
          ...(sessionId ? { taskId: sessionId } : {}),
        });
        throw error;
      }
    },
    [dispatchSendText, focusTimelineToLatest, intl, sessionId],
  );
  sendTextRef.current = handleSendText;

  const handleComposerDraftStateChange = useCallback(
    (state: { hasContent: boolean; busy: boolean }) => {
      composerDraftStateRef.current = state;
    },
    [],
  );
  const clearQueueEditOperation = useCallback(() => {
    queueEditOperationRef.current = null;
    setQueueEditOperation(null);
  }, []);
  const handleComposerRestoreApplied = useCallback(
    (requestId: number) => {
      setComposerRestoreRequest((current) => (current?.requestId === requestId ? null : current));
      clearQueueEditOperation();
    },
    [clearQueueEditOperation],
  );
  const handleHighspeedActivationApplied = useCallback((cardId: string) => {
    setHighspeedActivationCardId((current) => (current === cardId ? null : current));
  }, []);

  const handleFork = useCallback(
    (target: ConversationRowTarget) => {
      const current = snapshotRef.current;
      if (!sessionId || current === null) return;
      void dispatchCommand(
        "forkAssistant",
        { target },
        sessionId,
        current.revision,
        current.logEpoch,
      ).then((ack) => {
        if (ack.status !== "accepted" && ack.status !== "duplicate") {
          logger.warn(`[v4-pane] fork 被Deny: ${ack.status} ${ack.reasonCode ?? ""}`);
          return;
        }
        if (ack.result?.type === "forkAssistant") {
          onSessionCreated?.(ack.result.sessionId);
        }
      });
    },
    [dispatchCommand, onSessionCreated, sessionId],
  );

  const handleEdit = useCallback(
    async (
      target: ConversationRowTarget,
      newText: string,
      attachments?: readonly AttachmentRef[],
      workspaceMode: "preserve" | "rewind" = "preserve",
      conversationQuotes?: import("@origin-ai/cf-shared").ConversationSelectionText[],
    ) => {
      const current = snapshotRef.current;
      if (!sessionId || current === null) return false;
      if (
        !newText.trim() &&
        (!attachments || attachments.length === 0) &&
        !conversationQuotes?.length
      ) {
        logger.warn("[v4-pane] Edit skipped: inline edit content is empty and has no attachments");
        return false;
      }
      const highspeed = await prepareHighspeedSendContext(
        sessionId,
        prepareHighspeedTurnFrom(captureHighspeedPaneOrigin()),
      );
      const latest = snapshotRef.current;
      if (!latest || latest.sessionId !== sessionId) {
        logger.warn("[v4-pane] Edit skipped: session switched after Highspeed prepare");
        return false;
      }
      const ack = await dispatchCommand(
        "editUserQuery",
        {
          target,
          newText,
          workspaceMode,
          conversationQuotes,
          ...(attachments ? { attachments: [...attachments] } : {}),
          ...highspeed.override,
        },
        sessionId,
        latest.revision,
        latest.logEpoch,
        undefined,
        highspeed.acceleratedCard,
      );
      if (ack.status !== "accepted" && ack.status !== "duplicate") {
        logger.warn(`[v4-pane] edit 被Deny: ${ack.status} ${ack.reasonCode ?? ""}`);
        return false;
      }
      return ack;
    },
    [captureHighspeedPaneOrigin, dispatchCommand, prepareHighspeedTurnFrom, sessionId],
  );

  const dispatchRetryTurn = useCallback(
    async (target: ConversationRowTarget): Promise<CommandAck> => {
      const current = snapshotRef.current;
      if (!sessionId || current === null) {
        throw new Error("retryTurn 缺少当前 session 投影");
      }
      return dispatchCommand(
        "retryTurn",
        { target },
        sessionId,
        current.revision,
        current.logEpoch,
      );
    },
    [dispatchCommand, sessionId],
  );

  const handleRetry = useCallback(
    (target: ConversationRowTarget) => {
      void dispatchRetryTurn(target)
        .then((ack) => {
          if (ack.status !== "accepted") {
            logger.warn(`[v4-pane] retry 被Deny: ${ack.status} ${ack.reasonCode ?? ""}`);
          }
        })
        .catch((error: unknown) => {
          logger.warn("[v4-pane] Failed to submit retry", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    },
    [dispatchRetryTurn],
  );

  const handleAssistantFeedback = useCallback(
    async (
      target: ConversationRowTarget,
      feedback: "like" | "dislike" | null,
    ): Promise<boolean> => {
      const current = snapshotRef.current;
      if (!sessionId || current === null) return false;
      const ack = await dispatchCommand(
        "setAssistantFeedback",
        { target, feedback },
        sessionId,
        current.revision,
        current.logEpoch,
      );
      const accepted = ack.status === "accepted" || ack.status === "duplicate";
      if (!accepted) {
        logger.warn(`[v4-pane] assistant Feedback被Deny: ${ack.status} ${ack.reasonCode ?? ""}`);
      }
      return accepted;
    },
    [dispatchCommand, sessionId],
  );

  const handleDeleteQueueItem = useCallback(
    (queueItemId: string) => {
      const current = snapshotRef.current;
      if (!sessionId || current === null) return;
      const sourceCommandId = current.queue.items.find(
        (item) => item.queueItemId === queueItemId,
      )?.sourceCommandId;
      void dispatchCommand("deleteQueueItem", { queueItemId }, sessionId, current.revision).then(
        (ack) => {
          if (ack.status !== "accepted" && ack.status !== "noop") {
            logger.warn(`[v4-pane] deleteQueueItem 被Deny: ${ack.status} ${ack.reasonCode ?? ""}`);
            return;
          }
          if (sourceCommandId) pendingCommandRegistry.settle(sessionId, sourceCommandId);
        },
      );
    },
    [dispatchCommand, sessionId],
  );

  const handleEditQueueItem = useCallback(
    async (queueItemId: string): Promise<void> => {
      const current = snapshotRef.current;
      if (!sessionId || current === null || queueEditOperationRef.current) return;
      if (composerDraftStateRef.current.hasContent || composerDraftStateRef.current.busy) {
        toast(intl.formatMessage({ id: "chat.queue.editDraftConflict" }));
        return;
      }
      const restoreTarget = resolveQueuedComposerRestore(current, queueItemId);
      if (!restoreTarget) {
        logger.warn(`[v4-pane] queue 撤回EditSkip：queue item 不存在or不可Edit ${queueItemId}`);
        return;
      }
      const operation = { queueItemId, sessionId, workspaceKey };
      queueEditOperationRef.current = operation;
      setQueueEditOperation(operation);
      try {
        const ack = await dispatchCommand(
          "deleteQueueItem",
          { queueItemId },
          sessionId,
          restoreTarget.baseRevision,
        );
        if (!shouldRestoreQueuedComposerFromAck(ack.status)) {
          logger.warn(`[v4-pane] queue 撤回Edit被Deny: ${ack.status} ${ack.reasonCode ?? ""}`);
          toast(intl.formatMessage({ id: "chat.queue.editRestoreFailed" }));
          clearQueueEditOperation();
          return;
        }
        pendingCommandRegistry.settle(sessionId, restoreTarget.sourceCommandId);
        const currentBinding = composerBindingRef.current;
        if (
          currentBinding.sessionId !== sessionId ||
          currentBinding.workspaceKey !== workspaceKey
        ) {
          logger.warn("[v4-pane] Queue recall edit not restored: composer switched before ACK returned", {
            queueItemId,
            sessionId,
            workspaceKey,
          });
          clearQueueEditOperation();
          return;
        }
        setComposerRestoreRequest({
          requestId: nextComposerRestoreRequestIdRef.current++,
          sessionId,
          workspaceKey,
          inputKind: restoreTarget.inputKind,
          text: restoreTarget.text,
          attachments: restoreTarget.attachments,
          config: restoreTarget.config,
        });
      } catch (error) {
        logger.warn("[v4-pane] Queue recall edit command failed", error);
        toast(intl.formatMessage({ id: "chat.queue.editRestoreFailed" }));
        clearQueueEditOperation();
      }
    },
    [clearQueueEditOperation, dispatchCommand, intl, sessionId, workspaceKey],
  );

  const handleSendQueuedNow = useCallback(
    (queueItemId: string) => {
      const current = snapshotRef.current;
      if (!sessionId || current === null) return;
      focusTimelineToLatest();
      const highspeedOrigin = captureHighspeedPaneOrigin();
      void (async () => {
        const queueItem = current.queue.items.find((item) => item.queueItemId === queueItemId);
        let highspeedOverride: HighspeedSendContext["override"] = {};
        if (queueItem?.highspeed && queueItem.highspeed.expiresAt > Date.now()) {
          const refreshed = await prepareHighspeedSendContext(
            sessionId,
            prepareHighspeedTurnFrom(highspeedOrigin),
            queueItem.modelSelection,
          );
          if (refreshed.acceleratedCard?.cardId === queueItem.highspeed.cardId) {
            highspeedOverride = refreshed.override;
          }
        }
        const latest = snapshotRef.current;
        const latestQueueItem = latest?.queue.items.find(
          (item) => item.queueItemId === queueItemId,
        );
        if (!latest || latest.sessionId !== sessionId || !latestQueueItem) {
          logger.warn("[v4-pane] sendQueuedNow 跳过：Highspeed prepare 后队列状态已变化", {
            queueItemId,
          });
          return null;
        }
        return dispatchCommand(
          "sendQueuedNow",
          { queueItemId, ...highspeedOverride },
          sessionId,
          latest.revision,
        );
      })().then((ack) => {
        if (!ack) return;
        if (ack.status !== "accepted" && ack.status !== "noop") {
          logger.warn(`[v4-pane] sendQueuedNow 被Deny: ${ack.status} ${ack.reasonCode ?? ""}`);
        }
      });
    },
    [
      captureHighspeedPaneOrigin,
      dispatchCommand,
      focusTimelineToLatest,
      prepareHighspeedTurnFrom,
      sessionId,
    ],
  );

  const handleReorderQueueItem = useCallback(
    (queueItemId: string, beforeQueueItemId: string | null) => {
      const current = snapshotRef.current;
      if (!sessionId || current === null) return;
      void dispatchCommand(
        "reorderQueueItem",
        { queueItemId, beforeQueueItemId },
        sessionId,
        current.revision,
      ).then((ack) => {
        if (ack.status !== "accepted" && ack.status !== "noop") {
          logger.warn(`[v4-pane] reorderQueueItem 被Deny: ${ack.status} ${ack.reasonCode ?? ""}`);
        }
      });
    },
    [dispatchCommand, sessionId],
  );

  const handleResumeQueue = useCallback(async () => {
    const current = snapshotRef.current;
    if (!sessionId || !current || current.queue.autoDrain || current.queue.items.length === 0) {
      return;
    }
    const ack = await dispatchCommand(
      "setAutoDrain",
      { autoDrain: true },
      sessionId,
      current.revision,
    );
    if (ack.status !== "accepted" && ack.status !== "noop") {
      logger.warn(`[v4-pane] 恢复暂停Queue被Deny: ${ack.status} ${ack.reasonCode ?? ""}`);
    }
  }, [dispatchCommand, sessionId]);

  const dispatchConfigCas = useCallback(
    async (
      type: CommandType,
      payload: Record<string, unknown>,
      options?: { initialBaseRevision?: number; targetSessionId?: string },
    ): Promise<CommandAck | null> => {
      const targetSessionId =
        options?.targetSessionId ?? sessionId ?? prewarmBindingRef.current?.sessionId ?? null;
      const current = snapshotRef.current;
      if (!targetSessionId) {
        recordV4CommandAck({
          type: `ui:${type}`,
          status: "skipped",
          reasonCode: "no-session",
          at: Date.now(),
        });
        return null;
      }
      let baseRevision =
        options?.initialBaseRevision ??
        (current?.sessionId === targetSessionId ? current.revision : 0);
      let lastAck: CommandAck | null = null;
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const ack = await dispatchCommand(type, payload, targetSessionId, baseRevision);
          lastAck = ack;
          if (ack.status === "stale") {
            baseRevision = ack.revisionAtDecision;
            continue;
          }
          if (ack.status !== "accepted" && ack.status !== "noop") {
            logger.warn(`[v4-pane] ${type} 被Deny: ${ack.status} ${ack.reasonCode ?? ""}`);
          }
          return ack;
        }
        logger.warn(`[v4-pane] ${type} 连续 stale，放弃Retry`);
        return lastAck;
      } catch (error) {
        if (isProviderNotReadyError(error)) {
          throw error;
        }
        recordV4CommandAck({
          type: `ui:${type}`,
          status: "dispatch-error",
          reasonCode: String(error),
          at: Date.now(),
        });
        logger.warn(`[v4-pane] ${type} Failed: ${String(error)}`);
        return null;
      }
    },
    [dispatchCommand, sessionId],
  );
  const ensureDraftPrewarmConfigBeforeSend = useCallback(
    async (targetSessionId: string) => {
      const desiredConfig = buildDraftCreateConfigPayload(
        draftConfigRef.current,
        appFollowupMode,
      ).config;
      if (!desiredConfig) return;
      const projectedConfig =
        snapshotRef.current?.sessionId === targetSessionId ? snapshotRef.current.config : null;

      const requireAcceptedConfigAck = (type: CommandType, ack: CommandAck | null) => {
        if (
          ack &&
          (ack.status === "accepted" || ack.status === "noop" || ack.status === "duplicate")
        ) {
          return;
        }
        throw new Error(
          `${type} 未在Initial turn前收敛: ${ack?.status ?? "missing-ack"} ${ack?.reasonCode ?? ""}`,
        );
      };

      if (
        desiredConfig.followupMode &&
        desiredConfig.followupMode !== projectedConfig?.followupMode
      ) {
        const ack = await dispatchConfigCas(
          "setFollowupMode",
          { mode: desiredConfig.followupMode },
          { targetSessionId },
        );
        requireAcceptedConfigAck("setFollowupMode", ack);
      }
    },
    [appFollowupMode, dispatchConfigCas, draftConfigRef],
  );
  ensureDraftPrewarmConfigBeforeSendRef.current = ensureDraftPrewarmConfigBeforeSend;

  const followupModeSyncKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const targetSessionId = sessionId ?? prewarmSessionId;
    if (!targetSessionId || !appFollowupMode || snapshotRevision === null) return;
    if (snapshotSessionId !== targetSessionId) return;
    if (snapshotFollowupMode === appFollowupMode) {
      followupModeSyncKeyRef.current = `${targetSessionId}:${appFollowupMode}:synced`;
      return;
    }
    const syncKey = `${targetSessionId}:${appFollowupMode}:${snapshotRevision}`;
    if (followupModeSyncKeyRef.current === syncKey) return;
    followupModeSyncKeyRef.current = syncKey;
    void configCommandBarrier.enqueue(() =>
      dispatchConfigCas("setFollowupMode", { mode: appFollowupMode }),
    );
  }, [
    appFollowupMode,
    configCommandBarrier,
    dispatchConfigCas,
    prewarmSessionId,
    sessionId,
    snapshotFollowupMode,
    snapshotRevision,
    snapshotSessionId,
  ]);

  const handleSelectModel = useCallback(
    (
      modelProvider: string,
      model: string,
      sourceModel: ModelSelectionSource | null,
      reasoningLevel?: string,
    ) => {
      if (activeHighspeedCard) {
        toast(intl.formatMessage({ id: "chat.highspeed.modelLocked" }));
        return;
      }
      const resolvedProvider =
        modelProvider || draftConfigRef.current.provider || sourceModel?.provider || "";
      logger.debug("[v4-pane] onSelectModel", {
        modelProvider: resolvedProvider,
        model,
        branch: "composer-submission-intent",
      });
      handleDraftSelectModel(resolvedProvider, model, reasoningLevel);
    },
    [activeHighspeedCard, draftConfigRef, handleDraftSelectModel, intl],
  );

  const handleSelectThought = useCallback(
    (thought: string, _modelContext: { provider: string; model: string }) => {
      handleDraftSelectThought(thought);
    },
    [handleDraftSelectThought],
  );

  const handleRecoverCustomModelSelection = useCallback(
    async (value: string, sourceModel: ModelSelectionSource | null) => {
      const decoded = decodeCustomModelValue(value);
      if (!decoded?.providerId) {
        return;
      }
      const displayProvider = provider ?? CF_AGENT_PROVIDER;
      let modelValue = value;
      if (!decoded.modelName) {
        const fallbackModel =
          modelSelectionView?.providers.find(
            (candidate) => candidate.providerId === decoded.providerId,
          )?.models[0]?.modelId ?? (modelSelectionView ? null : undefined);
        if (!fallbackModel) {
          logger.warn("[v4-pane] Custom provider recovery skipped: provider has no available models", {
            customProviderId: decoded.providerId,
            workspacePath,
          });
          return;
        }
        modelValue = encodeCustomModelValue(decoded.providerId, fallbackModel);
      }
      const modelSelection = parseModelPickerValue(modelValue);
      showModelChangeNotice(sourceModel, {
        provider: modelSelection.providerId,
        model: modelSelection.modelId,
      });
      const store = useCfSessionStore.getState();
      store.setModelSelectionResolution(
        workspacePath,
        {
          selectedSupplierKey: buildCustomSupplierKey(decoded.providerId),
          isGhostSupplier: false,
          supplierMismatchReason: null,
        },
        workspaceIdentity,
      );
      store.setConfigOptionsStatus(workspacePath, "loading", workspaceIdentity);
      logger.info("[v4-pane] configOptions error custom provider recovery start", {
        modelId: modelSelection.modelId,
        providerId: modelSelection.providerId,
        workspaceIdentity: workspaceIdentity ?? null,
        workspacePath,
      });

      try {
        await cfTaskService.restartWorkspaceProcess({
          workspacePath,
          workspaceIdentity,
          provider: displayProvider,
          bumpRuntimeEpoch: true,
        });

        const prepareResult = await prepareWorkspaceWithCfSessionService({
          workspacePath,
          workspaceIdentity,
          provider: displayProvider,
          cfSessionService,
        });
        handleDraftSelectModel(modelSelection.providerId, modelSelection.modelId);
        store.setConfigOptions(workspacePath, prepareResult.configOptions ?? [], workspaceIdentity);
        store.setConfigOptionsStatus(workspacePath, "ready", workspaceIdentity);
        store.setSlashCommands(workspacePath, prepareResult.slashCommands ?? [], workspaceIdentity);
        logger.info("[v4-pane] configOptions error custom provider recovery done", {
          configOptionsCount: prepareResult.configOptions?.length ?? 0,
          modelId: modelSelection.modelId,
          providerId: modelSelection.providerId,
          workspacePath,
        });
      } catch (error) {
        store.setConfigOptionsStatus(workspacePath, "error", workspaceIdentity);
        logger.warn("[v4-pane] configOptions error custom provider recovery failed", {
          error: error instanceof Error ? error.message : String(error),
          modelId: modelSelection.modelId,
          providerId: modelSelection.providerId,
          workspacePath,
        });
        throw error;
      }
    },
    [
      provider,
      handleDraftSelectModel,
      sessionId,
      showModelChangeNotice,
      workspaceIdentity,
      workspacePath,
      cfSessionService,
      cfTaskService,
    ],
  );

  const handleSwitchMode = useCallback(
    (mode: string) => {
      handleDraftSwitchMode(mode);
    },
    [handleDraftSwitchMode],
  );

  const handleSendCompressionCommand = useCallback(
    (command: string) => {
      if (!sessionId) return;
      const parsed = parseV4VisibleSlashCommand(command);
      if (!parsed) return;
      void dispatchSlashCommand(parsed, sessionId, snapshotRef.current?.revision, undefined);
    },
    [dispatchSlashCommand, sessionId],
  );

  const handleStop = useCallback(
    (source: "button" | "escape") => {
      const current = snapshotRef.current;
      if (!sessionId || !current?.control.canStop) {
        logger.lifecycle.info("[v4-pane] Stop command skipped (no stoppable execution)", {
          source,
          sessionId: sessionId ?? "",
        });
        return;
      }
      const foregroundExecutionId = current.control.activeWorks.find(
        (work) => work.foregroundExecutionId,
      )?.foregroundExecutionId;
      logger.lifecycle.info("[v4-pane] Stop command sent", {
        source,
        sessionId,
        foregroundExecutionId: foregroundExecutionId ?? "",
      });
      void dispatchCommand(
        "stop",
        foregroundExecutionId ? { expectedForegroundExecutionId: foregroundExecutionId } : {},
        sessionId,
      ).catch((error) => {
        logger.lifecycle.warn(`[v4-pane] stop Failed: ${String(error)}`);
      });
    },
    [dispatchCommand, sessionId],
  );

  const handlePauseGoal = useCallback(() => {
    const current = snapshotRef.current;
    if (!sessionId || !current?.availability.pauseGoal.allowed) return;
    void dispatchCommand("pauseGoal", {}, sessionId, current.revision).then((ack) => {
      if (ack.status !== "accepted" && ack.status !== "noop") {
        logger.warn(`[v4-pane] pauseGoal 被Deny: ${ack.status} ${ack.reasonCode ?? ""}`);
      }
    });
  }, [dispatchCommand, sessionId]);

  const handleResumeGoal = useCallback(() => {
    const current = snapshotRef.current;
    if (!sessionId || !current?.availability.resumeGoal.allowed) return;
    void dispatchCommand("resumeGoal", {}, sessionId, current.revision).then((ack) => {
      if (ack.status !== "accepted" && ack.status !== "noop") {
        logger.warn(`[v4-pane] resumeGoal 被Deny: ${ack.status} ${ack.reasonCode ?? ""}`);
      }
    });
  }, [dispatchCommand, sessionId]);

  useEffect(() => {
    if (!focused || readOnly) return;
    if (!sessionId || !snapshot?.control.canStop) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!paneRef.current) return;
      if (!allowEscapeStopOutsidePane && !event.composedPath().includes(paneRef.current)) return;
      if (shouldIgnoreEscapeForStopGeneration(event)) return;
      event.preventDefault();
      handleStop("escape");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    allowEscapeStopOutsidePane,
    focused,
    handleStop,
    readOnly,
    sessionId,
    snapshot?.control.canStop,
  ]);

  const handleStopFromButton = useCallback(() => handleStop("button"), [handleStop]);

  const handleRetrySubscribe = useCallback(() => {
    void lease?.store.retry();
  }, [lease]);

  const handleLoadOlder = useCallback(() => {
    return lease?.store.loadOlder();
  }, [lease]);

  const handleLoadAllOlder = useCallback(() => {
    return lease
      ? lease.store.loadAllOlder()
      : Promise.resolve({
          status: "stale" as const,
          logEpoch: snapshot?.logEpoch ?? "unknown",
        });
  }, [lease, snapshot?.logEpoch]);

  useEffect(() => {
    if (!shareActive || !sessionId || !hasOlderRows(snapshot)) return;
    const key = `${sessionId}:${snapshot?.logEpoch ?? "unknown"}`;
    if (shareHydratedSessionRef.current === key) return;
    shareHydratedSessionRef.current = key;
    void handleLoadAllOlder().catch((error) => {
      shareHydratedSessionRef.current = null;
      logger.warn("[conversation-share] Failed to complete share catalog", { error });
    });
  }, [handleLoadAllOlder, sessionId, shareActive, snapshot]);

  useEffect(() => {
    if (
      !sessionId ||
      !lease?.store ||
      !shouldAutoLoadIncompleteLeadingTurn(snapshot, state.loadingOlder)
    ) {
      return;
    }
    const firstRowId = snapshot?.rows.window[0]?.rowId;
    if (firstRowId === undefined) return;
    const cursorKey = `${sessionId}:${state.subscriptionId ?? "connecting"}:${firstRowId}`;
    if (autoLoadIncompleteTurnCursorRef.current === cursorKey) return;
    autoLoadIncompleteTurnCursorRef.current = cursorKey;

    logger.debug("[v4-pane] Cold snapshot first turn incomplete; automatically pulling earlier rows", {
      firstRowId,
      sessionId,
      turnId: snapshot?.rows.window[0]?.turnId,
    });
    void lease.store.loadOlder();
  }, [lease, sessionId, snapshot, state.loadingOlder, state.subscriptionId]);

  const connecting =
    sessionId !== null &&
    (snapshot === null || (state.status === "connecting" && !snapshot.runtimeInitialization));
  const queueEditActiveForCurrentComposer =
    queueEditOperation?.sessionId === sessionId && queueEditOperation.workspaceKey === workspaceKey;
  const errored = sessionId !== null && state.status === "error";
  useSessionSubscriptionErrorTelemetry({
    supervisor: conversationTelemetry,
    sessionId,
    lastError: state.lastError,
    visible: errored && telemetryVisible && conversationTelemetryForegroundEnabled,
  });
  const retryActionsEnabled = runtimeReady && !readOnly && !selectionSideChat && Boolean(sessionId);
  const forkActionsEnabled = runtimeReady && !readOnly && !selectionSideChat && Boolean(sessionId);
  const editActionsEnabled = runtimeReady && !readOnly && !selectionSideChat && Boolean(sessionId);
  const isDraft = sessionId === null;
  const timelineSnapshot =
    !isDraft && (lease === null || sessionLeaseReady) && snapshot?.sessionId === sessionId
      ? snapshot
      : null;
  const shareHandoverContext =
    snapshot?.sharedContextImport && "contextId" in snapshot.sharedContextImport
      ? snapshot.sharedContextImport
      : null;
  const [importedShare, setImportedShare] = useState<ImportedConversationShare | null>(null);
  const importedShareContextId =
    shareHandoverContext && shareHandoverContext.status !== "discarded"
      ? shareHandoverContext.contextId
      : null;
  useEffect(() => {
    if (!importedShareContextId || compactForRemoteControl) {
      setImportedShare(null);
      return;
    }
    let disposed = false;
    void conversationShareService
      .getImportedConversation({
        workspacePath,
        contextId: importedShareContextId,
      })
      .then((imported) => {
        if (disposed) return;
        setImportedShare(imported);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        logger.warn("[conversation-share] 读取导入的分享对话失败", { error });
        setImportedShare(null);
      });
    return () => {
      disposed = true;
    };
  }, [compactForRemoteControl, conversationShareService, importedShareContextId, workspacePath]);
  const importedShareArtifactNames = useMemo(
    () =>
      new Map(
        (importedShare?.artifacts ?? []).map((artifact) => [
          artifact.artifactId,
          artifact.displayName,
        ]),
      ),
    [importedShare],
  );
  const importedShareArtifactWorkspaceRelativePaths = useMemo(() => {
    const entries: Array<[string, string]> = [];
    for (const artifact of importedShare?.artifacts ?? []) {
      if (artifact.workspaceRelativePath) {
        entries.push([artifact.artifactId, artifact.workspaceRelativePath]);
      }
    }
    return new Map(entries);
  }, [importedShare]);
  useLayoutEffect(() => {
    if (
      compactForRemoteControl ||
      !timelineBottomRequest ||
      timelineBottomRequest.taskId !== sessionId ||
      !importedShare ||
      importedShare.contextId !== importedShareContextId
    ) {
      return;
    }
    const scrollToBottom = () => {
      const action = timelineScrollToBottomRef.current;
      if (!action) return false;
      action();
      return true;
    };
    let secondFrame: number | null = null;
    const firstFrame = window.requestAnimationFrame(() => {
      scrollToBottom();
      secondFrame = window.requestAnimationFrame(() => {
        if (!scrollToBottom()) return;
        useCfSessionStore
          .getState()
          .clearTimelineBottomRequest(
            workspacePath,
            timelineBottomRequest.requestId,
            workspaceIdentity,
          );
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
    };
  }, [
    compactForRemoteControl,
    importedShare,
    importedShareContextId,
    sessionId,
    timelineBottomRequest,
    workspaceIdentity,
    workspacePath,
  ]);
  const handleOpenImportedShareUrl = useCallback(() => {
    if (!shareHandoverContext || !onOpenBrowserUrl) return;
    onOpenBrowserUrl(localizeConversationShareUrl(shareHandoverContext.shareUrl, locale));
  }, [locale, onOpenBrowserUrl, shareHandoverContext]);
  const initialDraftConfigForDiagnostics = isDraft ? resolveInitialDraftConfig() : undefined;
  const telemetryDraftConfig = draftConfig;
  const subagents = snapshot?.subagents ?? EMPTY_SUBAGENT_PROJECTION;
  useEffect(() => {
    if (!sessionId || subagents.revision === 0 || !onSyncSubagentSessionTabs) return;
    onSyncSubagentSessionTabs({
      rootSessionId: rootSessionId ?? sessionId,
      parentSessionId: sessionId,
      validChildSessionIds: subagents.childSessionIds,
    });
  }, [
    onSyncSubagentSessionTabs,
    rootSessionId,
    sessionId,
    subagents.childSessionIds,
    subagents.revision,
  ]);
  useEffect(() => {
    if (!selectionSideChat || !sessionId) return;
    setSelectionSideChatBlocked(sessionId, Boolean(blockingInteractionId));
    return () => setSelectionSideChatBlocked(sessionId, false);
  }, [blockingInteractionId, selectionSideChat, sessionId]);
  const isOfficeMode = useIsOfficeMode();
  const statusPanelModel = useMemo(
    () =>
      buildConversationStatusPanelModel({
        isOfficeMode,
        workspacePath,
        gitSummary,
        gitDirtyFileCount,
        gitWorktreeChangeSummary,
        goal: selectionSideChat ? null : (snapshot?.goal ?? null),
        sessionPlans: state.sessionPlans,
        plan: snapshot?.plan ?? null,
        backgroundWorks: snapshot?.backgroundWorks ?? [],
        runningSubagents: subagents.running,
        workflowRuns: snapshot?.workflowRuns?.runs ?? [],
      }),
    [
      isOfficeMode,
      gitDirtyFileCount,
      gitSummary,
      gitWorktreeChangeSummary,
      snapshot?.backgroundWorks,
      snapshot?.goal,
      snapshot?.plan,
      snapshot?.workflowRuns,
      state.sessionPlans,
      selectionSideChat,
      subagents.running,
      workspacePath,
    ],
  );
  const runningBackgroundWorkCount =
    statusPanelModel.runningBashWorks.length +
    statusPanelModel.runningSubagentWorks.length +
    statusPanelModel.runningWorkflowRuns.length;
  const runningTerminalCount = statusPanelModel.runningBashWorks.length;
  const runningAgentCount = statusPanelModel.runningSubagentWorks.length;
  const runningWorkflowCount = statusPanelModel.runningWorkflowRuns.length;
  useEffect(() => {
    setTerminalSectionOpen(false);
    setAgentSectionOpen(false);
  }, [sessionId]);
  useEffect(() => {
    if (runningTerminalCount === 0) {
      setTerminalSectionOpen(false);
    }
  }, [runningTerminalCount]);
  const hasLiveWorkflowRun = runningWorkflowCount > 0;
  useEffect(() => {
    setWorkflowSectionOpen(hasLiveWorkflowRun);
  }, [hasLiveWorkflowRun, sessionId]);
  useEffect(() => {
    if (runningAgentCount === 0) {
      setAgentSectionOpen(false);
    }
  }, [runningAgentCount]);
  const soleRunningWorkflowRunTarget = useMemo(
    () => (onOpenWorkflowRun ? resolveSoleRunningWorkflowRunTarget(statusPanelModel) : null),
    [onOpenWorkflowRun, statusPanelModel],
  );
  const handleOpenRunningBackgroundWorks = useCallback(() => {
    if (runningBackgroundWorkCount === 0) return;
    if (soleRunningWorkflowRunTarget) {
      handleOpenWorkflowRunFromPanel(soleRunningWorkflowRunTarget);
      return;
    }
    setTerminalSectionOpen(runningTerminalCount > 0);
    setAgentSectionOpen(runningAgentCount > 0);
    setWorkflowSectionOpen(runningWorkflowCount > 0);
    handleSummaryPanelVariantChange("panel");
  }, [
    handleOpenWorkflowRunFromPanel,
    handleSummaryPanelVariantChange,
    runningAgentCount,
    runningBackgroundWorkCount,
    runningTerminalCount,
    runningWorkflowCount,
    soleRunningWorkflowRunTarget,
  ]);
  const statusPanelVariant = resolveConversationStatusPanelVariant({
    variantOverride: effectiveSummaryPanelVariantOverride,
  });
  const shouldUseStatusPanelInlineLayout =
    !isDraft &&
    shouldUseConversationStatusPanelInlineLayout({
      hasContent: statusPanelModel.hasContent,
      variant: statusPanelVariant,
    });
  const statusPanelLayout = !shouldUseStatusPanelInlineLayout
    ? "none"
    : statusPanelVariant === "auto"
      ? "auto"
      : "inline";
  const controlLastError = snapshot?.control.lastError ?? null;
  const controlLastErrorKey = controlLastError
    ? createSessionErrorKey(snapshot?.sessionId ?? sessionId, controlLastError)
    : null;
  const projectedComposerError =
    controlLastError && controlLastErrorKey && !dismissedErrorKeys.includes(controlLastErrorKey)
      ? toComposerUiError(snapshot?.sessionId ?? sessionId, controlLastError)
      : null;
  const mcpUnavailableNotice = useMemo(
    () => resolveMcpUnavailableNotice(snapshot?.rows.window),
    [snapshot?.rows.window],
  );
  const quotaBanner = useV4SessionQuotaBanner({
    sessionId: snapshot?.sessionId ?? sessionId,
    error: controlLastError,
    errorKey: controlLastErrorKey,
    phase: snapshot?.control.phase ?? null,
    providerId: snapshot?.config.provider ?? null,
    modelId: snapshot?.config.model ?? null,
    usageStatsService: baseWorkspaceServices.usageStatsService,
    mcpUnavailableNotice,
  });
  const composerError =
    draftModelReadinessError ??
    sendSubmissionError ??
    (quotaBanner.takesOverError ? null : projectedComposerError);
  useEffect(() => {
    setSendSubmissionError(null);
  }, [sessionId]);
  const handleDismissComposerError = useCallback(() => {
    if (draftModelReadinessError) {
      dismissDraftModelReadinessError();
      return;
    }
    if (sendSubmissionError) {
      setSendSubmissionError(null);
      return;
    }
    if (!controlLastErrorKey) return;
    setDismissedErrorKeys((keys) =>
      keys.includes(controlLastErrorKey) ? keys : [...keys.slice(-19), controlLastErrorKey],
    );
  }, [
    controlLastErrorKey,
    dismissDraftModelReadinessError,
    draftModelReadinessError,
    sendSubmissionError,
  ]);
  const modelConfigTarget: ChatErrorBannerModelConfigTarget = isRemoteWorkspaceIdentity(
    workspaceIdentity ?? "",
  )
    ? "remote"
    : "local";
  const handleOpenModelSettings = useCallback(() => {
    setPendingSettingsSectionIntent("modelProvider");
    openSettingsTab();
  }, [openSettingsTab]);
  const handleOpenModelUpgrade = useCallback(() => {
    if (!codingPlanUpgradeDialog) return;
    const providerId =
      sharedSettings?.providerFamilyDomain === "bigmodel"
        ? BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan
        : BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan;
    codingPlanUpgradeDialog.openCodingPlanUpgrade({ providerId });
  }, [codingPlanUpgradeDialog, sharedSettings?.providerFamilyDomain]);
  const handleOpenQuotaUpgrade = useCallback(() => {
    const providerId = quotaBanner.upgradeProviderId;
    if (!providerId || !codingPlanUpgradeDialog) return;
    const eventText = intl.formatMessage({
      id: quotaBanner.upgradeActionLabelId,
    });
    codingPlanUpgradeDialog.openCodingPlanUpgrade({
      providerId,
      funnelContext: createCodingPlanFunnelContext({
        providerId,
        upgradeSource: "session_quota_alert",
        eventRegion: "app.session",
        eventText,
        entryPlanState: resolveCodingPlanEntryPlanState({
          providerId,
          displayStatus: "purchased",
          planLevel: "start",
        }),
      }),
    });
  }, [
    codingPlanUpgradeDialog,
    intl,
    quotaBanner.upgradeActionLabelId,
    quotaBanner.upgradeProviderId,
  ]);

  const handleConfirmShareDisclosure = useCallback(async () => {
    if (!sessionId || !shareDraft || sharePublishing) return;
    const productTurnIds = getConversationShareSelectedProductTurnIds(
      useConversationShareSelectionStore.getState(),
      sessionId,
    );
    if (productTurnIds.length === 0 || !shareTitle.trim()) return;
    const attemptKey = JSON.stringify({
      title: shareTitle.trim(),
      accessMode: shareDraft.accessMode,
      productTurnIds,
      revision: snapshot?.revision ?? null,
      logEpoch: snapshot?.logEpoch ?? null,
    });
    const shareAttempt = ensureConversationShareAttempt(
      getConversationShareDockState(useConversationShareSelectionStore.getState(), sessionId)
        .attempt,
      attemptKey,
      sessionId,
      { randomUUID: () => globalThis.crypto?.randomUUID?.() },
    );
    const operationId = `share-operation-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
    let activePhase = "collecting";
    let collectedWarnings: ConversationShareDisplayWarnings | null = null;
    const progressSubscription = conversationShareService.onDynamicPublishProgress(operationId)((
      progress,
    ) => {
      activePhase = progress.phase;
      updateShareDockState(sessionId, {
        progress: progress.phase === "complete" ? "checking" : progress.phase,
        completedArtifacts: progress.completedArtifacts,
        totalArtifacts: progress.totalArtifacts,
      });
      const warnings = sanitizeConversationShareWarnings(progress.warnings);
      if (warnings.length > 0) {
        collectedWarnings = {
          issues: warnings,
          issueCount: warnings.length,
          ...(progress.omittedWarningCount
            ? { omittedIssueCount: progress.omittedWarningCount }
            : {}),
        };
      }
    });
    updateShareDockState(sessionId, {
      attempt: shareAttempt,
      publishing: true,
      progress: "collecting",
      completedArtifacts: 0,
      totalArtifacts: 0,
      publishedShareUrl: null,
      error: null,
      warnings: null,
    });
    try {
      const share = await conversationShareService.publish(
        {
          workspacePath,
          ...(workspaceIdentity ? { workspaceIdentity } : {}),
          ...(remoteSessionId ? { remoteSessionId } : {}),
          sessionId,
          title: shareTitle.trim(),
          accessMode: shareDraft.accessMode,
          selection: { kind: "productTurns", productTurnIds },
          clientRequestId: shareAttempt.clientRequestId,
          disclosureAcceptedAt: shareAttempt.disclosureAcceptedAt,
          locale,
        },
        operationId,
      );
      const warnings = collectedWarnings as ConversationShareDisplayWarnings | null;
      updateShareDockState(sessionId, {
        publishedShareUrl: share.share_url,
        warnings,
      });
      if (warnings) {
        toast(
          intl.formatMessage(
            { id: "conversationShare.publishSucceededWithSkips" },
            { count: warnings.issueCount },
          ),
        );
      } else {
        toast(intl.formatMessage({ id: "conversationShare.publishSucceeded" }));
      }
    } catch (error) {
      const details = getConversationShareErrorDetails(error);
      const resolvedMessageId = resolveConversationSharePublishErrorMessageId(error);
      const messageId =
        resolvedMessageId === "conversationShare.publishFailed" ? undefined : resolvedMessageId;
      updateShareDockState(sessionId, {
        attempt: retainConversationShareAttemptAfterFailure(shareAttempt, details.code),
        error:
          details.issues && details.issues.length > 0
            ? {
                issues: details.issues,
                issueCount: details.issueCount ?? details.issues.length,
                omittedIssueCount: details.omittedIssueCount,
                requestId: details.requestId,
                clientRequestId: details.clientRequestId,
                operationId,
                status: details.status,
                code: details.code,
                rejection: details.rejection,
              }
            : {
                issues: [
                  {
                    code: resolveConversationShareFallbackIssueCode(details),
                    scope: "transport",
                    phase: activePhase as "collecting" | "uploading" | "checking" | "complete",
                  },
                ],
                issueCount: 1,
                requestId: details.requestId,
                clientRequestId: details.clientRequestId,
                operationId,
                status: details.status,
                code: details.code,
                rejection: details.rejection,
                messageId,
              },
      });
      logger.warn("[conversation-share] Failed to publish session", {
        sessionId,
        operationId,
        phase: activePhase,
        accessMode: shareDraft.accessMode,
        selectedProductTurnCount: productTurnIds.length,
        remoteWorkspace: Boolean(workspaceIdentity || remoteSessionId),
        errorName: details.name,
        kind: details.kind,
        ...(details.reasonCode === undefined ? {} : { reasonCode: details.reasonCode }),
        ...(details.diagnostics === undefined ? {} : { diagnostics: details.diagnostics }),
        ...(details.status === undefined ? {} : { status: details.status }),
        ...(details.code === undefined ? {} : { code: details.code }),
        ...(details.rejection ? { rejection: details.rejection } : {}),
        ...(details.requestId === undefined ? {} : { requestId: details.requestId }),
      });
    } finally {
      progressSubscription.dispose();
      updateShareDockState(sessionId, { publishing: false });
    }
  }, [
    conversationShareService,
    intl,
    remoteSessionId,
    sessionId,
    shareDraft,
    sharePublishing,
    shareTitle,
    snapshot?.logEpoch,
    snapshot?.revision,
    updateShareDockState,
    workspaceIdentity,
    workspacePath,
  ]);

  const handleCopyPublishedShare = useCallback(async () => {
    if (!publishedShareUrl || !navigator.clipboard?.writeText) return false;
    try {
      await navigator.clipboard.writeText(publishedShareUrl);
      toast(intl.formatMessage({ id: "conversationShare.copySucceeded" }));
      return true;
    } catch {
      toast(intl.formatMessage({ id: "conversationShare.copyFailed" }));
      return false;
    }
  }, [intl, publishedShareUrl]);

  const handleOpenPublishedShare = useCallback(() => {
    if (!publishedShareUrl || !onOpenBrowserUrl) return;
    onOpenBrowserUrl(localizeConversationShareUrl(publishedShareUrl, locale));
  }, [locale, onOpenBrowserUrl, publishedShareUrl]);

  const handleCopyShareRequestId = useCallback(() => {
    const requestId = shareError?.requestId;
    if (!requestId || !navigator.clipboard?.writeText) {
      toast(intl.formatMessage({ id: "conversationShare.copyFailed" }));
      return;
    }
    void navigator.clipboard.writeText(requestId).then(
      () => toast(intl.formatMessage({ id: "conversationShare.copySucceeded" })),
      () => toast(intl.formatMessage({ id: "conversationShare.copyFailed" })),
    );
  }, [intl, shareError?.requestId]);

  const handleShareCancel = useCallback(() => {
    if (sharePublishing || !sessionId) return;
    closeShare(sessionId);
  }, [closeShare, sessionId, sharePublishing]);

  const handleConfirmShareSelection = useCallback(() => {
    if (!sharePublishing && sessionId) confirmShareSelection(sessionId);
  }, [confirmShareSelection, sessionId, sharePublishing]);

  const handleDismissShareError = useCallback(() => {
    if (sessionId) updateShareDockState(sessionId, { error: null });
  }, [sessionId, updateShareDockState]);
  const handleDismissShareWarnings = useCallback(() => {
    if (sessionId) updateShareDockState(sessionId, { warnings: null });
  }, [sessionId, updateShareDockState]);

  const handleDeselectShareTurn = useCallback(
    (productTurnId: string) => {
      if (!sessionId || !productTurnId) return;
      deselectShareProductTurn(sessionId, productTurnId);
    },
    [deselectShareProductTurn, sessionId],
  );

  const handleShareTitleChange = useCallback(
    (value: string) => {
      if (!sessionId) return;
      updateShareDockState(sessionId, {
        title: value,
        disclosureAccepted: false,
        publishedShareUrl: null,
        error: null,
        warnings: null,
      });
    },
    [sessionId, updateShareDockState],
  );

  const handleShareAccessModeChange = useCallback(
    (accessMode: ConversationShareAccessMode) => {
      if (!sessionId) return;
      setShareAccessMode(sessionId, accessMode);
      updateShareDockState(sessionId, {
        disclosureAccepted: false,
        publishedShareUrl: null,
        error: null,
        warnings: null,
      });
    },
    [sessionId, setShareAccessMode, updateShareDockState],
  );

  const handleShareDisclosureAcceptedChange = useCallback(
    (accepted: boolean) => {
      if (sessionId) {
        updateShareDockState(sessionId, { disclosureAccepted: accepted });
      }
    },
    [sessionId, updateShareDockState],
  );

  const handleEditShareSelection = useCallback(() => {
    if (sharePublishing || publishedShareUrl || !sessionId) return;
    updateShareDockState(sessionId, { error: null });
    beginShareSelection(sessionId);
  }, [beginShareSelection, publishedShareUrl, sessionId, sharePublishing, updateShareDockState]);

  const handleShareConfirm = useCallback(() => {
    if (
      !shareDisclosureAccepted ||
      shareSelectionPanelVisible ||
      sharePreflight.status !== "ready" ||
      sharePreflight.blockingIssues.length > 0
    )
      return;
    void handleConfirmShareDisclosure();
  }, [
    handleConfirmShareDisclosure,
    shareDisclosureAccepted,
    shareSelectionPanelVisible,
    sharePreflight,
  ]);

  const handleShareSelectionToggle = useCallback(
    (rowId: number) => {
      if (sessionId) toggleShareRow(sessionId, rowId);
    },
    [sessionId, toggleShareRow],
  );

  const handleShareSelectionInspect = useCallback(
    (target: { unitIndex: number; rowId: number }) => {
      timelineScrollToQueryRef.current?.(target);
    },
    [],
  );

  const recoverableCommand = recoverableCommands[0] ?? null;
  const handleDismissPendingRecovery = useCallback(() => {
    if (!recoverableCommand) return;
    pendingCommandRegistry.dismissRecovery(
      recoverableCommand.sessionId,
      recoverableCommand.commandId,
    );
  }, [recoverableCommand]);
  const handleResendPendingCommand = useCallback(() => {
    if (!recoverableCommand) return;
    const replay = pendingCommandRegistry.consumeReplay({
      sessionId: recoverableCommand.sessionId,
      commandId: recoverableCommand.commandId,
    });
    if (!replay) return;
    void dispatchCommand(
      replay.type,
      replay.payload,
      replay.sessionId,
      replay.baseRevision,
      undefined,
      undefined,
      undefined,
      undefined,
      replay.clientContext?.projectId,
      replay.clientContext?.sessionCreateSource,
      undefined,
      replay.clientContext?.taskGroupId,
    )
      .then((ack) => {
        if (
          replay.type === "createSession" &&
          (ack.status === "accepted" || ack.status === "duplicate") &&
          ack.result?.type === "createSession"
        ) {
          const originWorkspace = replay.clientContext?.workspace;
          const originWorkspaceKey =
            originWorkspace?.workspaceIdentity?.trim() || originWorkspace?.workspacePath;
          if (originWorkspaceKey && originWorkspaceKey !== workspaceKey) {
            logger.error("[v4-pending-command] Refused cross-workspace submission of createSession recovery result", {
              originWorkspaceKey,
              workspaceKey,
            });
            return;
          }
          return handleDraftSessionCreated(
            ack.result.sessionId,
            replay.clientContext?.sessionCreateSource,
            replay.payload.firstInput ? ack.commandId : undefined,
            replay.clientContext?.taskGroupId,
          );
        }
      })
      .catch((error) => {
        logger.warn("[v4-pending-command] User confirmation resend failed", error);
      });
  }, [dispatchCommand, handleDraftSessionCreated, recoverableCommand, workspaceKey]);

  const composerNode = readOnly ? null : (
    <ConversationComposer
      key="conversation-composer"
      snapshot={snapshot}
      sessionId={sessionId}
      skillCatalogSessionId={effectiveSessionId}
      draftMode={isDraft}
      draftConfig={draftConfig}
      composerDraft={composerDraft}
      rootDraftScopeKey={composerScopeKey(newTaskComposerScope)}
      replaceComposerDraft={replaceComposerDraft}
      submissionReady={composerSubmissionReady && runtimeReady && !recoveringDraft}
      updateComposerContent={updateComposerContent}
      createSubmissionFromComposer={createSubmissionFromComposer}
      telemetryDraftConfig={telemetryDraftConfig}
      contextHeader={isDraft && !isFloatingPresentation ? draftComposerHeader : undefined}
      centered={isDraft}
      layout={isFloatingPresentation ? "inline" : "stacked"}
      workingDurationMs={
        floatingTurnRunning ? floatingLatestTurnSummary?.workDurationMs : undefined
      }
      blockingRequestId={blockingInteractionId}
      listenAddToChatEvents={focused}
      externalTextInsertRequest={focused && sessionId === null ? composerTextInsertRequest : null}
      onExternalTextInsertApplied={handleExternalTextInsertApplied}
      autoFocusEnabled={focused}
      disabled={
        connecting ||
        draftRuntimeRebuilding ||
        queueEditActiveForCurrentComposer ||
        quotaBanner.state.blocksSubmit
      }
      isWebRemoteControl={compactForRemoteControl}
      workspacePath={workspacePath}
      workspaceIdentity={workspaceIdentity}
      remoteSessionId={remoteSessionId ?? undefined}
      modelSelectionView={
        modelSelectionView ??
        (modelSelectionRead.state.status === "loading" ? modelSelectionRead.state.catalog : null)
      }
      modelSelectionState={modelSelectionRead.state}
      modelSelectionReload={modelSelectionRead.reload}
      modelSelectionRefresh={modelSelectionRead.refresh}
      attachmentSessionId={effectiveSessionId}
      attachmentPut={attachmentPut}
      onRuntimeRestart={onRuntimeRestart}
      onRuntimeLifecycle={onRuntimeLifecycle}
      provider={provider}
      telemetryVisible={telemetryVisible && conversationTelemetryForegroundEnabled}
      readPlanIdentitySnapshot={readPlanIdentitySnapshot}
      onSendText={handleSendText}
      highspeedCard={activeHighspeedCard}
      highspeedActivationCardId={highspeedActivationCardId}
      onHighspeedActivationApplied={handleHighspeedActivationApplied}
      onDraftStateChange={handleComposerDraftStateChange}
      composerRestoreRequest={composerRestoreRequest}
      onComposerRestoreApplied={handleComposerRestoreApplied}
      onStop={handleStopFromButton}
      onSelectModel={handleSelectModel}
      onSelectThought={handleSelectThought}
      onSwitchMode={handleSwitchMode}
      onOpenRunningBackgroundWorks={
        sessionId && runningBackgroundWorkCount > 0 ? handleOpenRunningBackgroundWorks : undefined
      }
      backgroundWorkOpenTarget={soleRunningWorkflowRunTarget ? "workflow-run" : "panel"}
      runningSubagentCount={runningAgentCount}
      onRecoverCustomModelSelection={handleRecoverCustomModelSelection}
      onSendCompressionCommand={handleSendCompressionCommand}
      error={composerError}
      onDismissError={handleDismissComposerError}
      onRetryInitialization={handleRetrySubscribe}
      onOpenModelSettings={handleOpenModelSettings}
      onOpenModelUpgrade={handleOpenModelUpgrade}
      modelConfigTarget={modelConfigTarget}
      onOpenCodeViewer={onOpenCodeViewer}
      suppressGoalCommands={selectionSideChat}
      appSlashCommands={appSlashCommands}
      onDropTargetControllerChange={handleDropTargetControllerChange}
    />
  );
  const sharePreflightContent = useMemo(
    () => (
      <ConversationSharePreflightStatus
        preflight={sharePreflight}
        onDeselectTurn={handleDeselectShareTurn}
        onRetryPreflight={retrySharePreflight}
      />
    ),
    [sharePreflight, handleDeselectShareTurn, retrySharePreflight],
  );
  const handleSelectAllShareRows = useCallback(
    (selected: boolean) => {
      if (sessionId) setAllPendingShareRows(sessionId, selected);
    },
    [sessionId, setAllPendingShareRows],
  );
  const pendingGuideProjection = snapshot ? projectPendingGuideQueue(snapshot.queue) : null;
  const sharePopoverContent =
    readOnly || !sessionId ? null : publishedShareUrl ? (
      <ConversationShareSuccessDock
        url={publishedShareUrl}
        title={shareTitle}
        warnings={shareWarnings}
        onOpen={handleOpenPublishedShare}
        onCopy={handleCopyPublishedShare}
        onDismiss={handleShareCancel}
      />
    ) : (
      <ConversationShareConfirmationDock
        preflightChecking={
          sharePreflight.status === "checking" ||
          sharePreflight.status === "stale" ||
          (sharePreflight.status === "idle" && preflightShareProductTurnIds.length > 0)
        }
        selectionEditing={shareSelectionPanelVisible}
        publishDisabled={
          sharePreflight.status !== "ready" || sharePreflight.blockingIssues.length > 0
        }
        preflightContent={sharePreflightContent}
        selectedCount={selectedShareProductTurnIds.length}
        totalCount={eligibleShareProductTurnIds.length}
        title={shareTitle}
        accessMode={shareDraft?.accessMode ?? DEFAULT_CONVERSATION_SHARE_ACCESS_MODE}
        progressLabel={intl.formatMessage({
          id:
            shareProgress === "uploading"
              ? "conversationShare.progress.uploading"
              : shareProgress === "checking"
                ? "conversationShare.progress.checking"
                : "conversationShare.progress.collecting",
        })}
        progressPhase={shareProgress}
        completedArtifacts={shareCompletedArtifacts}
        totalArtifacts={shareTotalArtifacts}
        pending={sharePublishing}
        error={shareError}
        warnings={shareWarnings}
        onDismissError={handleDismissShareError}
        onDismissWarnings={handleDismissShareWarnings}
        onCopyRequestId={handleCopyShareRequestId}
        onDeselectTurn={handleDeselectShareTurn}
        onTitleChange={handleShareTitleChange}
        onAccessModeChange={handleShareAccessModeChange}
        disclosureAccepted={shareDisclosureAccepted}
        onDisclosureAcceptedChange={handleShareDisclosureAcceptedChange}
        onCancel={handleShareCancel}
        onEditSelection={handleEditShareSelection}
        onConfirm={handleShareConfirm}
      />
    );
  const conversationBottomDockContent = readOnly ? null : (
    <>
      {quotaBanner.state.visible &&
      !quotaBanner.dismissed &&
      (!projectedComposerError || quotaBanner.takesOverError || quotaBanner.state.blocksSubmit) ? (
        <ConversationQuotaBanner
          state={quotaBanner.state}
          onShown={quotaBanner.markShown}
          billingDiscountActive={billingDiscount.active}
          billingDiscountConfig={billingDiscount.config}
          upgradeActionLabelId={quotaBanner.upgradeActionLabelId}
          onUpgrade={
            quotaBanner.upgradeProviderId && codingPlanUpgradeDialog
              ? handleOpenQuotaUpgrade
              : undefined
          }
          onDismiss={quotaBanner.dismiss}
        />
      ) : null}
      {recoverableCommand ? (
        <PendingCommandRecoveryBanner
          entry={recoverableCommand}
          onResend={
            recoverableCommand.replay.kind === "input" ? handleResendPendingCommand : undefined
          }
          onDismiss={handleDismissPendingRecovery}
        />
      ) : null}
      {sessionId && snapshot?.workspaceHookAdmission ? (
        <WorkspaceHookPendingBanner
          sessionId={sessionId}
          workspacePath={workspacePath}
          workspaceIdentity={workspaceIdentity}
          admission={snapshot.workspaceHookAdmission}
        />
      ) : null}
      {sessionId && snapshot ? (
        <ConversationQueuePanel
          key="conversation-queue"
          queue={pendingGuideProjection?.visibleQueue ?? snapshot.queue}
          onDeleteItem={handleDeleteQueueItem}
          onEditItem={handleEditQueueItem}
          pendingEditQueueItemId={
            queueEditActiveForCurrentComposer ? queueEditOperation.queueItemId : null
          }
          onSendNow={handleSendQueuedNow}
          onMoveItem={handleReorderQueueItem}
          onResume={handleResumeQueue}
        />
      ) : null}
      {}
      {sessionId && snapshot ? (
        <V4InteractionDialogs
          key="conversation-interactions"
          sessionId={sessionId}
          workspacePath={workspacePath}
          workspaceIdentity={workspaceIdentity}
          remoteSessionId={remoteSessionId ?? undefined}
          isWebRemoteControl={compactForRemoteControl}
          provider={provider}
          snapshot={snapshot}
          onPlanInteractionAccepted={
            compactForRemoteControl ? handleMobilePlanInteractionAccepted : undefined
          }
        />
      ) : null}
      {composerNode}
      {}
      {}
      {isDraft &&
      !isFloatingPresentation &&
      (!isOfficeMode || sharedSettings?.proactiveSuggestionsEnabled === true) ? (
        <ConversationDraftSuggestedPromptsContainer
          className={isOfficeMode ? "mt-4" : "mt-6"}
          proactive={isOfficeMode}
          onOpenAutomations={
            onOpenAutomationsMain && !compactForRemoteControl
              ? (automationTab) => onOpenAutomationsMain(undefined, automationTab)
              : undefined
          }
          workspacePath={workspacePath}
          workspaceIdentity={workspaceIdentity}
          remoteSessionId={remoteSessionId ?? undefined}
          isWebRemoteControl={compactForRemoteControl}
          isDesktop={isDesktop}
        />
      ) : null}
    </>
  );
  const pluginUiUploadAttachment = useCallback(
    async (input: { fileName: string; mime: string; dataBase64: string }) => {
      if (!sessionId) throw new Error("Plugin UI attachments need an open session");
      const { ref } = await attachmentPut({ sessionId, ...input });
      const padding = input.dataBase64.endsWith("==") ? 2 : input.dataBase64.endsWith("=") ? 1 : 0;
      return {
        ref,
        fileName: input.fileName,
        mime: input.mime,
        bytes: Math.floor((input.dataBase64.length * 3) / 4) - padding,
      };
    },
    [attachmentPut, sessionId],
  );
  const conversationBottomDock = conversationBottomDockContent ? (
    <ConversationBottomDockTransition mode="chat">
      {conversationBottomDockContent}
    </ConversationBottomDockTransition>
  ) : null;

  return (
    <PluginUiSessionProvider
      workspacePath={workspacePath}
      workspaceIdentity={workspaceIdentity}
      remoteSessionId={remoteSessionId}
      sessionId={runtimeReady ? sessionId : null}
      readOnly={readOnly || !runtimeReady}
      sendText={dispatchSendText}
      uploadAttachment={pluginUiUploadAttachment}
      projectionStore={sessionLeaseReady ? lease?.store : null}
    >
      <div
        ref={paneRef}
        data-testid={testId(TID_V4_SESSION_PANE, paneId)}
        data-session-id={sessionId ?? "draft"}
        data-initial-draft-provider={initialDraftConfigForDiagnostics?.provider ?? ""}
        data-initial-draft-model={initialDraftConfigForDiagnostics?.model ?? ""}
        data-projection-seq={snapshot?.seq ?? ""}
        data-running-subagent-ids={subagents.running.map((item) => item.childSessionId).join(",")}
        data-running-subagent-work-ids={(snapshot?.backgroundWorks ?? [])
          .filter((work) => work.kind === "subagent" && work.status === "running")
          .map((work) => work.childSessionId ?? work.workId)
          .join(",")}
        data-v4-conversation-drop-target="true"
        onDragOver={effectiveDropTargetController?.onDragOver}
        onDragLeave={effectiveDropTargetController?.onDragLeave}
        onDrop={effectiveDropTargetController?.onDrop}
        className={cn(
          "relative flex h-full min-h-0 flex-col",
          compactForRemoteControl && "min-w-0",
        )}
      >
        {effectiveDropTargetController?.active ? (
          <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-accent/55 backdrop-blur-sm">
            <div className="flex items-center gap-2 rounded-full border border-border bg-accent px-4 py-2 text-ui-base text-foreground shadow-sm">
              <Hand className="size-4 text-foreground" />
              <span>
                {intl.formatMessage({
                  id:
                    effectiveDropTargetController.kind === "workspace"
                      ? "chat.composer.workspaceFileDragHint"
                      : "chat.attachments.dragHint",
                })}
              </span>
            </div>
          </div>
        ) : null}
        <ConversationHeader
          title={snapshot?.meta.title ?? ""}
          onClosePane={onClosePane}
          workspaceBadge={workspaceBadge}
        />

        <div
          ref={conversationLayoutContainerRef}
          className={cn(
            "@container/conversation relative flex min-h-0 flex-1 flex-col",
            compactForRemoteControl && "min-w-0",
          )}
        >
          {sessionId && !compactForRemoteControl ? (
            <ConversationSharePopover
              key={sessionId}
              sessionId={sessionId}
              open={shareActive}
              publishing={sharePublishing}
              selecting={shareSelectionPanelVisible}
              onClose={handleShareCancel}
              onCancelSelection={dismissShareSelectionPanel}
            >
              {sharePopoverContent}
            </ConversationSharePopover>
          ) : null}
          <ConversationShareSelectionPanel
            visible={shareSelectionPanelVisible}
            items={shareItems}
            selectedRowIds={pendingShareRowIds}
            selectedCount={pendingShareTurnCount}
            preflight={sharePreflight}
            onSelectAllChange={handleSelectAllShareRows}
            onToggle={handleShareSelectionToggle}
            onInspect={handleShareSelectionInspect}
            onConfirm={handleConfirmShareSelection}
            onCancel={dismissShareSelectionPanel}
          />
          {!isDraft ? (
            <ConversationStatusPanel
              workspacePath={workspacePath}
              workspaceIdentity={workspaceIdentity}
              gitSummary={gitSummary}
              gitDirtyFileCount={gitDirtyFileCount}
              gitWorktreeReviewSourceId={gitWorktreeReviewSourceId}
              gitWorktreeChangeSummary={gitWorktreeChangeSummary}
              activeTaskChangeSummary={activeTaskChangeSummary}
              goal={selectionSideChat ? null : (snapshot?.goal ?? null)}
              sessionPlans={state.sessionPlans}
              plan={snapshot?.plan ?? null}
              backgroundWorks={snapshot?.backgroundWorks ?? []}
              runningSubagents={subagents.running}
              workflowRuns={snapshot?.workflowRuns?.runs ?? []}
              endedSubagentCount={subagents.endedTotal}
              rootSessionId={rootSessionId ?? sessionId ?? undefined}
              parentSessionId={sessionId ?? undefined}
              isWebRemoteControl={compactForRemoteControl}
              isMobileViewport={isMobileTextInputViewport}
              layoutMode={statusPanelLayout}
              summaryPanelVariantOverride={effectiveSummaryPanelVariantOverride}
              onVariantChange={handleSummaryPanelVariantChange}
              terminalSectionOpen={terminalSectionOpen}
              onTerminalSectionOpenChange={setTerminalSectionOpen}
              agentSectionOpen={agentSectionOpen}
              onAgentSectionOpenChange={setAgentSectionOpen}
              workflowSectionOpen={workflowSectionOpen}
              onWorkflowSectionOpenChange={setWorkflowSectionOpen}
              onRefreshGit={onRefreshGit}
              onOpenGitReview={onOpenGitReview}
              onPauseGoal={
                !readOnly && !selectionSideChat && snapshot?.availability.pauseGoal.allowed
                  ? handlePauseGoal
                  : undefined
              }
              onResumeGoal={
                !readOnly && !selectionSideChat && snapshot?.availability.resumeGoal.allowed
                  ? handleResumeGoal
                  : undefined
              }
              onOpenPlanDetail={onOpenPlanDetail ? handleOpenPlanDetail : undefined}
              onOpenBackgroundBash={
                onOpenBackgroundBash && sessionId
                  ? (work) =>
                      onOpenBackgroundBash({
                        workspacePath,
                        workspaceIdentity: workspaceIdentity ?? undefined,
                        remoteSessionId: remoteSessionId ?? undefined,
                        rootSessionId: rootSessionId ?? sessionId,
                        sessionId,
                        workId: work.workId,
                        title: work.title,
                      })
                  : undefined
              }
              onCancelBackgroundWork={readOnly ? undefined : handleCancelBackgroundWork}
              onOpenSubagentSession={onOpenSubagentSession ? handleOpenSubagentSession : undefined}
              onOpenSubagentDirectory={
                onOpenSubagentDirectory && !compactForRemoteControl
                  ? handleOpenSubagentDirectory
                  : undefined
              }
              onOpenWorkflowRun={
                onOpenWorkflowRun && sessionId ? handleOpenWorkflowRunFromPanel : undefined
              }
              endedWorkflowRunCount={endedWorkflowRunCount}
              onOpenWorkflowRunDirectory={
                onOpenWorkflowRunDirectory && !compactForRemoteControl
                  ? handleOpenWorkflowRunDirectoryFromPanel
                  : undefined
              }
            />
          ) : null}

          {readOnly && controlLastError ? (
            <div
              role="alert"
              data-testid="v4-subagent-readonly-error"
              className="mx-4 mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-3 py-2 text-ui-base text-[var(--color-danger)]"
            >
              {controlLastError.message}
            </div>
          ) : null}

          {errored && remoteAvailable ? (
            <SessionSubscriptionErrorPanel
              error={state.lastError ?? intl.formatMessage({ id: "chat.error.connectionLost" })}
              sessionId={sessionId}
              workspacePath={workspacePath}
              onReconnect={handleRetrySubscribe}
            />
          ) : (
            <SessionPluginReferenceIconBoundary
              enabled={pluginReferenceIconsEnabled}
              remoteSessionId={remoteSessionId}
              sessionId={sessionId}
              workspaceIdentity={workspaceIdentity}
              workspacePath={workspacePath}
            >
              <BotGroupDeliveryProvider
                taskId={sessionId}
                workspacePath={workspacePath}
                workspaceIdentity={workspaceIdentity}
              >
                <ConversationTimeline
                  compactForRemoteControl={compactForRemoteControl}
                  scrollToBottomActionRef={timelineScrollToBottomRef}
                  scrollToQueryActionRef={timelineScrollToQueryRef}
                  selectionPanelLayoutContainerRef={conversationLayoutContainerRef}
                  rows={timelineSnapshot?.rows.window ?? []}
                  pendingGuides={timelineSnapshot ? pendingGuideProjection?.pendingGuides : []}
                  apiRetry={timelineSnapshot?.control.apiRetry ?? null}
                  totalCount={timelineSnapshot?.rows.totalCount ?? 0}
                  sessionKey={sessionId ?? "draft"}
                  scrollMemoryKey={timelineScrollMemoryKey}
                  rowContext={rowContext}
                  onFork={forkActionsEnabled ? handleFork : undefined}
                  onRetry={retryActionsEnabled ? handleRetry : undefined}
                  onFeedbackChange={
                    !readOnly && !selectionSideChat && sessionId
                      ? handleAssistantFeedback
                      : undefined
                  }
                  onEdit={editActionsEnabled ? handleEdit : undefined}
                  canLoadOlder={timelineSnapshot ? hasOlderRows(timelineSnapshot) : false}
                  loadingOlder={timelineSnapshot ? state.loadingOlder : false}
                  onLoadOlder={handleLoadOlder}
                  onLoadAllOlder={handleLoadAllOlder}
                  turnNavigatorDirectoryRevision={state.turnNavigatorDirectoryRevision}
                  bottomDock={conversationBottomDock}
                  hideTurnNavigator={shareSelectionPanelVisible && !compactForRemoteControl}
                  backgroundScrollLocked={false}
                  headerSlot={
                    importedShare &&
                    (importedShare.rows.length > 0 || importedShare.unsupportedRowCount > 0) ? (
                      <ConversationShareImportNotice
                        rows={importedShare.rows}
                        contentBlocks={importedShare.contentBlocks}
                        unsupportedRowCount={importedShare.unsupportedRowCount}
                        artifactNames={importedShareArtifactNames}
                        artifactWorkspaceRelativePaths={importedShareArtifactWorkspaceRelativePaths}
                        workspacePath={workspacePath}
                        {...(workspaceIdentity ? { workspaceIdentity } : {})}
                        {...(remoteSessionId ? { workspaceRemoteSessionId: remoteSessionId } : {})}
                        locale={locale}
                        theme={theme}
                        codePreviewSettings={codePreviewSettings}
                        onOpenShareUrl={onOpenBrowserUrl ? handleOpenImportedShareUrl : undefined}
                        onOpenFileLink={onOpenFileLink}
                        onOpenCodeViewer={onOpenCodeViewer}
                      />
                    ) : null
                  }
                  emptyState={
                    !remoteAvailable ? (
                      <div className="p-6 text-center text-ui-base text-foreground-subtle">
                        {intl.formatMessage({ id: "remote.conversation.placeholder" })}
                      </div>
                    ) : isDraft ? (
                      <div data-testid={TID_CHAT_EMPTY} className="w-full">
                        <ConversationDraftEmptyState
                          compactForRemoteControl={compactForRemoteControl}
                        />
                      </div>
                    ) : null
                  }
                  centerEmptyStateWithDock={isDraft && !isFloatingPresentation}
                  floatingComposerDock={isFloatingPresentation}
                  onComposerDockHeightChange={
                    isFloatingPresentation && focused
                      ? panePresentation.reportComposerDockHeight
                      : undefined
                  }
                  onLatestTurnSummaryChange={
                    isFloatingPresentation && focused
                      ? handleFloatingLatestTurnSummaryChange
                      : undefined
                  }
                  compactEmptyStateWithDock={compactForRemoteControl}
                  summaryPanelLayout={statusPanelLayout}
                  conversationFindQuery={!isDraft && focused ? conversationFindQuery : ""}
                  conversationFindActiveIndex={
                    !isDraft && focused ? conversationFindActiveIndex : -1
                  }
                  conversationFindNavigationRequestId={
                    !isDraft && focused ? conversationFindNavigationRequestId : 0
                  }
                  onConversationFindMatchStateChange={
                    !isDraft && focused ? onConversationFindMatchStateChange : undefined
                  }
                  searchResultHighlightRequest={isDraft ? null : searchResultHighlightRequest}
                  onSearchResultHighlightDone={onSearchResultHighlightDone}
                  sessionPhase={isDraft ? undefined : snapshot?.control.phase}
                  selectionActions={
                    !isDraft &&
                    sessionId &&
                    !readOnly &&
                    !selectionSideChat &&
                    !isMobileTextInputViewport
                      ? {
                          enabled: resolveConversationSelectionTooltipEnabled({
                            selectionActionsEnabled: focused && !blockingInteractionId,
                            partialShareActive: shareActive,
                          }),
                          sideActionDisabled: selectionSideActionBlocked,
                          onAddToCurrentTask: handleAddSelectionToCurrentTask,
                          onAskInSideChat: handleOpenSelectionSideConversation,
                        }
                      : undefined
                  }
                />
              </BotGroupDeliveryProvider>
            </SessionPluginReferenceIconBoundary>
          )}
        </div>
      </div>
    </PluginUiSessionProvider>
  );
}
