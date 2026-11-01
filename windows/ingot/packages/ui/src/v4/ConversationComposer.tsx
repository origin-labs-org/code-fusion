import { ComposerSubmissionPendingContext } from "@/project-sidebar/index.js";

import { useRemoteProjectReconnect } from "@/hooks/RemoteProjectPresentationContext.js";
import { useOptionalRemoteWorkspaceController } from "@/remote/useRemoteWorkspaceController.js";
import { useOptionalTabStore } from "@/store/TabStoreProvider.js";
import { useRemoteConversationAvailable } from "@/v4/RemoteConversationAvailability.js";
import { getLocalTtftObserver } from "@/v4/telemetry/localTtftObserver.js";
import { formatConversationWorkDuration } from "@/v4/conversationWorkDuration.js";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { cn } from "@/components/lib/utils.js";
import { HighspeedComposerBackground } from "@/highspeed/HighspeedActivationVisual.js";
import { useHighspeedComposerEntrance } from "@/highspeed/useHighspeedComposerEntrance.js";
import {
  type HighspeedCardSnapshot,
  type PlanIdentitySnapshot,
  type CfProvider,
} from "@origin-ai/cf-shared";
import {
  TID_CHAT_ATTACHMENT_BUTTON,
  TID_CHAT_ATTACHMENT_MENU_ITEM,
  TID_V4_COMPOSER,
  TID_V4_COMPOSER_CLEAR_QUEUE_SEND,
  TID_V4_COMPOSER_INPUT,
  TID_V4_COMPOSER_KEEP_QUEUE_SEND,
  TID_V4_COMPOSER_SEND,
  TID_V4_PAUSED_QUEUE_SEND_DIALOG,
  TID_V4_ATTACHMENT,
  TID_V4_ATTACHMENT_UPLOAD_PROGRESS,
  TID_V4_ATTACHMENT_UPLOAD_RETRY,
  TID_V4_STOP,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import type {
  AttachmentRef,
  ConversationSnapshot,
  SessionConfigState,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  ArrowUpIcon,
  ClipboardPenLineIcon,
  InfoIcon,
  RotateCcwIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import {
  ChatErrorBanner,
  resolveChatErrorBannerDisplayMessage,
  shouldSuppressChatErrorBanner,
  type ChatErrorBannerModelConfigTarget,
} from "@/ChatErrorBanner.js";
import {
  Attachment,
  Attachments,
  AttachmentInfo,
  AttachmentPreview,
} from "@/components/ai-elements/attachments.js";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Spinner } from "@/components/ui/spinner.js";
import { ImagePreviewDialog } from "@/components/ai-elements/image-preview-dialog.js";
import {
  ChatMediaAttachmentPreviewDialog,
  type ChatMediaAttachmentPreviewTarget,
} from "@/ChatMediaAttachmentPreviewDialog.js";
import type { LexicalChatInputHandle } from "@/LexicalChatInput.js";
import { ChatPromptEditor } from "@/prompt-editor/ChatPromptEditor.js";
import { usePromptEditorDragState } from "@/prompt-editor/usePromptEditorDragState.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { advanceComposerDraftRevision } from "@/v4/composer/composerDraftRevision.js";
import type { AppSlashCommand } from "@/slashCommandHelpers.js";
import { useOptionalServices } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";
import { runUserAction, startUserAction } from "@/lib/userActionTelemetry.js";
import { useCfSessionStore } from "@/store/cfSessionStore.js";
import type { ComposerMentionPrefill } from "@/store/cfSessionStoreTypes.js";
import { FileDisplayIcon, resolveFileDisplayDescriptor } from "@/lib/fileDisplay.js";
import {
  isImageChatComposerAttachment,
  isPdfChatComposerAttachment,
  isMediaChatComposerAttachment,
  isVideoChatComposerAttachment,
  type ChatComposerAttachment,
} from "@/lib/chatAttachments.js";
import { resolveChatPlaceholderKey } from "@/lib/chatPlaceholder.js";
import {
  resolveChatEnterShortcut,
  resolveChatEnterSubmits,
  shouldAvoidIosInputFocusZoom,
  useIsMobileTextInputViewport,
} from "@/lib/mobileTextInput.js";
import { appendPromptHistoryEntry } from "@/lib/promptHistory.js";
import {
  persistPromptHistoryEntries,
  readPromptHistoryEntries,
} from "@/lib/promptHistoryStorage.js";
import {
  WORKSPACE_FILE_ADD_TO_CHAT_EVENT,
  readWorkspaceFileDragPayload,
  isWorkspaceFileAddToChatEvent,
} from "@/lib/workspaceFileDrag.js";
import { appendWorkspaceFileMentionToComposer } from "@/lib/workspaceFileComposer.js";
import { resolveProviderBaseURL } from "@/lib/registryProviderView.js";
import type { ModelSelectionView } from "@origin-ai/cf-services";
import type {
  ModelSelectionState,
  ModelSelectionRefreshResult,
} from "@/hooks/useModelSelectionView.js";
import type { CfUiError } from "@/lib/cfUiError.js";
import {
  resolveComposerAutoFocus,
  type ComposerAutoFocusOptions,
} from "@/v4/composer/composerAutoFocus.js";
import { V4_DRAFT_SCOPE_ROOT, type V4ComposerDraft } from "@/v4/composer/composerDraftStore.js";
import {
  resolveOppositeFollowupDelivery,
  resolveFollowupModifierTooltip,
  shouldEnableModifiedEnterSubmit,
  shouldReverseFollowupDeliveryForPointer,
} from "@/v4/composer/followupModeSettings.js";
import { isAppleKeyboardPlatform } from "@/lib/keyboardShortcuts.js";
import { usePrimaryFollowupModifier } from "@/v4/composer/usePrimaryFollowupModifier.js";
import {
  consumeV4ComposerDraftAttachments,
  registerV4ComposerDraftReader,
  consumeV4ComposerDraftWorkspaceTransferRequest,
} from "@/v4/composer/composerDraftWorkspaceTransfer.js";
import { useComposerAttachments } from "@/v4/composer/useComposerAttachments.js";
import type { ConversationDropTargetController } from "@/v4/composer/conversationDropTarget.js";
import { CodeCommentAttachmentChip } from "@/v4/composer/CodeCommentAttachmentChip.js";
import { removeCodeCommentPreview } from "@/v4/composer/codeCommentPreviewSync.js";
import {
  countComposerPromptContexts,
  serializeComposerPromptContexts,
} from "@/v4/composer/composerPromptContexts.js";
import { useCodeCommentContexts } from "@/v4/composer/useCodeCommentContexts.js";
import { useWebElementContexts } from "@/v4/composer/useWebElementContexts.js";
import {
  PluginUiModelContextChip,
  usePluginUiContextImages,
  usePluginUiModelContexts,
} from "@/plugin-ui/index.js";
import { usePptxElementReferences } from "@/v4/composer/usePptxElementReferences.js";
import { PptxElementReferenceChip } from "@/v4/composer/PptxElementReferenceChip.js";
import { useOpenPptxElementReference } from "@/v4/composer/useOpenPptxElementReference.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import { useConversationSelectionReferences } from "@/v4/composer/useConversationSelectionReferences.js";
import { ConversationBackgroundWorkTrigger } from "@/v4/composer/ConversationBackgroundWorkTrigger.js";
import { V4ComposerCuaEntry } from "@/v4/composer/V4ComposerCuaEntry.js";
import {
  V4ComposerModeSwitch,
  V4ComposerModelControls,
  type ModelSelectionSource,
} from "@/v4/composer/V4ComposerToolbar.js";
import {
  resolveV4ComposerConfigPickerState,
  type V4ComposerConfigPicker,
} from "@/v4/composer/configPickerState.js";
import { WebElementContextAttachmentChip } from "@/v4/composer/WebElementContextAttachmentChip.js";
import { ConversationSelectionReferenceChip } from "@/v4/composer/ConversationSelectionReferenceChip.js";
import type { AttachmentPutFn } from "@/v4/composer/attachmentUpload.js";
import { useScopedConversationTelemetrySupervisor } from "@/v4/telemetry/ConversationTelemetryAttachment.js";
import type { ConversationPromptTelemetrySeed } from "@/v4/telemetry/conversationTelemetrySupervisor.js";
import type { ComposerSubmissionConfig } from "@/v4/composer/composerSubmissionConfig.js";
import { buildV4ConversationPromptTelemetryExtraDetail } from "@/v4/telemetry/conversationPromptTelemetry.js";
import { pendingCommandRegistry } from "@/v4/pendingCommandRegistry.js";
import {
  subscribeComposerSubmissionSettled,
  trackUnsettledComposerSubmission,
} from "@/v4/composer/composerSubmissionSettlement.js";
import { resolveAttachableShareContext } from "@/lib/conversationShareContext.js";

const MODEL_SELECTION_LOADING_STATE: ModelSelectionState = { status: "loading" };

export interface ConversationComposerSendOptions {
  
  submittedDraftText?: string;
  
  submission?: ComposerSubmissionConfig | null;
  heldQueueDisposition?: "clearQueueAndSend" | "keepQueueAndSend";
  
  expectedHeldQueueItemIds?: readonly string[];
  
  attachments?: AttachmentRef[];
  
  contextAttachmentCount?: number;
  conversationQuotes?: import("@origin-ai/cf-shared").ConversationSelectionText[];
  
  telemetrySeed?: ConversationPromptTelemetrySeed;
  
  requestedDelivery?: "startNow" | "queue" | "guide";
  
  onCommandCreated?: (commandId: string) => void;
  sharedContextRefs?: Array<{ kind: "shared_context_import"; context_id: string }>;
  
  source?: import("@origin-ai/cf-shared/cf-protocol-v4").ConversationInputSource;
}

export type ConversationComposerSendResult = "sent" | "blocked" | "confirmationRequired";
function getComposerAttachmentTypeLabel(filename: string, mimeType: string): string {
  const leaf = filename.split(/[\\/]/u).at(-1) ?? filename;
  const dotIndex = leaf.lastIndexOf(".");
  if (dotIndex > 0 && dotIndex < leaf.length - 1) {
    return leaf.slice(dotIndex + 1).toUpperCase();
  }
  return (mimeType.split("/").at(-1) ?? mimeType).toUpperCase();
}

export interface ExternalTextInsertRequest {
  requestId: number;
  text: string;
  mention?: ComposerMentionPrefill;
  mode?: "replace" | "prepend-if-missing";
}

export function restorePersistedComposerDraftIntoInput({
  draft,
  inputApi,
  onEditorStateError,
}: {
  draft: Pick<V4ComposerDraft, "editorStateJson" | "mention" | "text">;
  inputApi: Pick<
    LexicalChatInputHandle,
    "getMarkdown" | "setEditorStateJson" | "setMention" | "setText"
  >;
  onEditorStateError?: (error: unknown) => void;
}): string {
  if (draft.editorStateJson) {
    try {
      inputApi.setEditorStateJson(draft.editorStateJson);
      return inputApi.getMarkdown();
    } catch (error) {
      onEditorStateError?.(error);
    }
  }
  if (draft.mention && draft.text.startsWith(draft.mention.markdown)) {
    inputApi.setMention(draft.mention, draft.text.slice(draft.mention.markdown.length));
    return draft.text;
  }
  inputApi.setText(draft.text);
  return draft.text;
}

export function applyExternalTextInsertRequestToComposer({
  appliedRequestId,
  inputApi,
  request,
  requestFocus,
  scheduleDraftPersist,
  updateText,
}: {
  appliedRequestId: number | null;
  inputApi: Pick<
    LexicalChatInputHandle,
    | "getMarkdown"
    | "prependMentionIfMissing"
    | "setMention"
    | "setText"
    | "setTextWithPluginMentions"
  > | null;
  request: ExternalTextInsertRequest | null | undefined;
  requestFocus: () => void;
  scheduleDraftPersist: () => void;
  updateText: (text: string) => void;
}): number | null {
  if (!request || request.requestId === appliedRequestId) {
    return appliedRequestId;
  }
  if (!inputApi) {
    return appliedRequestId;
  }
  if (request.mode === "prepend-if-missing" && request.mention) {
    if (!inputApi.prependMentionIfMissing(request.mention)) {
      return request.requestId;
    }
    updateText(inputApi.getMarkdown());
    scheduleDraftPersist();
    requestFocus();
    return request.requestId;
  }
  if (request.mention && request.text.startsWith(request.mention.markdown)) {
    inputApi.setMention(request.mention, request.text.slice(request.mention.markdown.length));
  } else if (request.text.includes("](plugin://")) {
    inputApi.setTextWithPluginMentions(request.text);
  } else {
    inputApi.setText(request.text);
  }
  updateText(request.text);
  scheduleDraftPersist();
  requestFocus();
  return request.requestId;
}

export interface ComposerRestoreRequest {
  requestId: number;
  sessionId: string;
  workspaceKey: string;
  inputKind: "sendText" | "sendGoalCommand";
  text: string;
  attachments: readonly AttachmentRef[];
  config?: Pick<V4ComposerDraft, "mode" | "planEnabled" | "modelSelection">;
}

export function applyComposerRestoreRequestToComposer({
  appliedRequestId,
  currentSessionId,
  currentWorkspaceKey,
  hasDraftContent,
  inputApi,
  request,
  requestFocus,
  restoreSessionOwnedAttachments,
  restoreDraftConfig,
  scheduleDraftPersist,
  updateText,
}: {
  appliedRequestId: number | null;
  currentSessionId: string | null;
  currentWorkspaceKey: string;
  hasDraftContent: boolean;
  inputApi: Pick<LexicalChatInputHandle, "setText"> | null;
  request: ComposerRestoreRequest | null | undefined;
  requestFocus: () => void;
  restoreSessionOwnedAttachments: (attachments: readonly AttachmentRef[]) => boolean;
  restoreDraftConfig?: (config: NonNullable<ComposerRestoreRequest["config"]>) => void;
  scheduleDraftPersist: () => void;
  updateText: (text: string) => void;
}): number | null {
  if (!request || request.requestId === appliedRequestId) {
    return appliedRequestId;
  }
  if (
    request.sessionId !== currentSessionId ||
    request.workspaceKey !== currentWorkspaceKey ||
    hasDraftContent ||
    !inputApi
  ) {
    return appliedRequestId;
  }
  if (!restoreSessionOwnedAttachments(request.attachments)) {
    return appliedRequestId;
  }
  inputApi.setText(request.text);
  updateText(request.text);
  if (request.config) restoreDraftConfig?.(request.config);
  scheduleDraftPersist();
  requestFocus();
  return request.requestId;
}

function arePromptHistoryEntriesEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

export interface ConversationComposerProps {
  snapshot: ConversationSnapshot | null;
  
  sessionId?: string | null;
  
  skillCatalogSessionId?: string | null;
  
  draftMode?: boolean;
  
  draftConfig?: Partial<SessionConfigState>;
  
  composerDraft: V4ComposerDraft;
  rootDraftScopeKey?: string;
  updateComposerContent: (
    content: Pick<V4ComposerDraft, "text" | "editorStateJson" | "mention">,
  ) => void;
  replaceComposerDraft: (draft: Omit<V4ComposerDraft, "updatedAt">) => void;
  
  submissionReady?: boolean;
  createSubmissionFromComposer?: () => ComposerSubmissionConfig | null;
  
  telemetryDraftConfig?: Partial<SessionConfigState>;
  
  contextHeader?: ReactNode;
  
  centered?: boolean;
  
  layout?: "stacked" | "inline";
  
  workingDurationMs?: number;
  
  blockingRequestId?: string | null;
  disabled?: boolean;
  onRetryInitialization?: () => void;
  
  highspeedCard?: HighspeedCardSnapshot | null;
  
  highspeedActivationCardId?: string | null;
  onHighspeedActivationApplied?: (cardId: string) => void;
  
  autoFocusEnabled?: boolean;
  
  isWebRemoteControl?: boolean;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  
  modelSelectionView?: ModelSelectionView | null;
  modelSelectionState?: ModelSelectionState;
  
  modelSelectionReload?: () => void;
  modelSelectionRefresh?: () => Promise<ModelSelectionRefreshResult>;
  
  attachmentSessionId?: string | null;
  attachmentPut: AttachmentPutFn;
  onRuntimeRestart?: (listener: () => void) => () => void;
  
  onRuntimeLifecycle?: (listener: (state: "available" | "unavailable") => void) => () => void;
  provider?: CfProvider;
  
  telemetryVisible?: boolean;
  
  readPlanIdentitySnapshot?: () => PlanIdentitySnapshot;
  onSendText: (
    text: string,
    options?: ConversationComposerSendOptions,
  ) => Promise<ConversationComposerSendResult | void>;
  
  onTextChange?: (text: string) => void;
  
  onDraftStateChange?: (state: { hasContent: boolean; busy: boolean }) => void;
  onStop: () => void;
  
  onSelectModel: (
    provider: string,
    model: string,
    sourceModel: ModelSelectionSource | null,
    reasoningLevel?: string,
  ) => void;
  
  onSelectThought: (thought: string, modelContext: { provider: string; model: string }) => void;
  onSwitchMode: (mode: string) => void;
  
  onOpenRunningBackgroundWorks?: () => void;
  
  backgroundWorkOpenTarget?: "panel" | "workflow-run";
  runningSubagentCount?: number;
  
  onRecoverCustomModelSelection?: (
    value: string,
    sourceModel: ModelSelectionSource | null,
  ) => Promise<void> | void;
  
  onSendCompressionCommand?: (command: string) => void;
  
  error?: CfUiError | null;
  onDismissError?: () => void;
  
  onOpenModelSettings?: () => void;
  onOpenModelUpgrade?: () => void;
  modelConfigTarget?: ChatErrorBannerModelConfigTarget;
  onOpenCodeViewer?: (source: CodeViewerSource) => void;
  
  listenAddToChatEvents?: boolean;
  
  externalTextInsertRequest?: ExternalTextInsertRequest | null;
  onExternalTextInsertApplied?: (requestId: number) => void;
  
  composerRestoreRequest?: ComposerRestoreRequest | null;
  onComposerRestoreApplied?: (requestId: number) => void;
  
  suppressGoalCommands?: boolean;
  
  appSlashCommands?: readonly AppSlashCommand[];
  
  onDropTargetControllerChange?: (controller: ConversationDropTargetController | null) => void;
}

function formatAttachmentLineCount(attachment: ChatComposerAttachment, locale: string): string {
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  return formatter.format(typeof attachment.lineCount === "number" ? attachment.lineCount : 0);
}

function ConversationComposerImpl({
  snapshot,
  sessionId = null,
  skillCatalogSessionId = sessionId,
  draftMode = false,
  draftConfig,
  composerDraft,
  rootDraftScopeKey,
  updateComposerContent,
  replaceComposerDraft,
  submissionReady = true,
  createSubmissionFromComposer,
  telemetryDraftConfig,
  contextHeader,
  centered = false,
  layout = "stacked",
  workingDurationMs,
  blockingRequestId = null,
  disabled: disabledProp = false,
  onRetryInitialization,
  highspeedCard = null,
  highspeedActivationCardId = null,
  onHighspeedActivationApplied,
  autoFocusEnabled = true,
  isWebRemoteControl = false,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  modelSelectionView = null,
  modelSelectionState = MODEL_SELECTION_LOADING_STATE,
  modelSelectionReload,
  modelSelectionRefresh,
  attachmentSessionId = null,
  attachmentPut,
  onRuntimeRestart,
  onRuntimeLifecycle,
  provider,
  telemetryVisible = true,
  readPlanIdentitySnapshot,
  onSendText,
  onTextChange,
  onDraftStateChange,
  onStop,
  onSelectModel,
  onSelectThought,
  onSwitchMode,
  onOpenRunningBackgroundWorks,
  backgroundWorkOpenTarget = "panel",
  runningSubagentCount = 0,
  onRecoverCustomModelSelection,
  onSendCompressionCommand,
  error,
  onDismissError,
  onOpenModelSettings,
  onOpenModelUpgrade,
  modelConfigTarget = "local",
  onOpenCodeViewer,
  listenAddToChatEvents = true,
  externalTextInsertRequest = null,
  onExternalTextInsertApplied,
  composerRestoreRequest = null,
  onComposerRestoreApplied,
  suppressGoalCommands = false,
  appSlashCommands,
  onDropTargetControllerChange,
}: ConversationComposerProps) {
  const remoteAvailable = useRemoteConversationAvailable();
  const remoteController = useOptionalRemoteWorkspaceController();
  const reconnectProject = useRemoteProjectReconnect();
  const remoteKind = useOptionalTabStore((state) =>
    state.tabs.find(
      (tab) =>
        tab.kind === "workspace" &&
        (tab.workspaceIdentity?.trim() || tab.workspacePath) ===
          (workspaceIdentity?.trim() || workspacePath),
    ),
  );
  const [targetSelectionPending, setTargetSelectionPending] = useState(false);
  const targetSelectionPendingRef = useRef(false);
  const updateTargetSelectionPending = useCallback((pending: boolean) => {
    targetSelectionPendingRef.current = pending;
    setTargetSelectionPending(pending);
  }, []);
  const disabled = disabledProp || !remoteAvailable || targetSelectionPending;
  const { intl, locale } = useCfIntl();
  const services = useOptionalServices();
  const conversationTelemetry = useScopedConversationTelemetrySupervisor({
    workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}),
    ...(remoteSessionId ? { remoteSessionId } : {}),
  });
  const draftScopeId =
    sessionId ??
    (rootDraftScopeKey ? `${V4_DRAFT_SCOPE_ROOT}:${rootDraftScopeKey}` : V4_DRAFT_SCOPE_ROOT);
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  const configPickerScopeKey = `${workspaceKey}\0${draftScopeId}`;
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [presentedHighspeedCardId, setPresentedHighspeedCardId] = useState<string | null>(null);
  const [highspeedSweepActive, setHighspeedSweepActive] = useState(false);
  const highspeedCardId = highspeedCard?.cardId ?? null;
  const highspeedEntrance = useHighspeedComposerEntrance({
    cardId: highspeedCardId,
    activationCardId: highspeedActivationCardId,
    onActivationApplied: onHighspeedActivationApplied,
  });
  const highspeedEntranceAnimated = highspeedEntrance === "activation";
  const highspeedPresented =
    highspeedCardId !== null &&
    (!highspeedEntranceAnimated || presentedHighspeedCardId === highspeedCardId);
  const handleHighspeedModelTransitionStart = useCallback(() => {
    setPresentedHighspeedCardId(highspeedCardId);
  }, [highspeedCardId]);
  useEffect(() => {
    if (!highspeedPresented || !highspeedEntranceAnimated) {
      setHighspeedSweepActive(false);
      return;
    }
    const timer = window.setTimeout(() => setHighspeedSweepActive(true), 1_900);
    return () => window.clearTimeout(timer);
  }, [highspeedEntranceAnimated, highspeedPresented]);
  const [configPickerState, setConfigPickerState] = useState<{
    scopeKey: string;
    activePicker: V4ComposerConfigPicker | null;
  }>(() => ({
    scopeKey: configPickerScopeKey,
    activePicker: null,
  }));
  if (configPickerState.scopeKey !== configPickerScopeKey) {
    setConfigPickerState({
      scopeKey: configPickerScopeKey,
      activePicker: null,
    });
  }
  const activeConfigPicker =
    configPickerState.scopeKey === configPickerScopeKey ? configPickerState.activePicker : null;
  const handleConfigPickerOpenChange = useCallback(
    (picker: V4ComposerConfigPicker, open: boolean) => {
      setConfigPickerState((current) => {
        if (current.scopeKey !== configPickerScopeKey) {
          return current;
        }
        return {
          scopeKey: current.scopeKey,
          activePicker: resolveV4ComposerConfigPickerState(current.activePicker, picker, open),
        };
      });
    },
    [configPickerScopeKey],
  );
  const [heldQueueConfirmation, setHeldQueueConfirmation] = useState<{
    queueItemIds: readonly string[];
    telemetrySeed: ConversationPromptTelemetrySeed;
    requestedDelivery?: "startNow" | "queue" | "guide";
  } | null>(null);
  const [sendTooltipOpen, setSendTooltipOpen] = useState(false);
  const textRef = useRef("");
  const contentRevisionRef = useRef(0);
  const pendingRef = useRef(false);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const activeShareContext = resolveAttachableShareContext(snapshot?.sharedContextImport);
  const pendingShareContext = activeShareContext?.status === "pending" ? activeShareContext : null;
  const inputApiRef = useRef<LexicalChatInputHandle | null>(null);
  const commandResolutionCleanupsRef = useRef(new Set<() => void>());
  const reportedErrorKeysRef = useRef(new Set<string>());
  const isMobileTextInputViewport = useIsMobileTextInputViewport();
  const primaryModifierPressed = usePrimaryFollowupModifier();
  const appleKeyboardPlatform = isAppleKeyboardPlatform();
  const enterSubmits = resolveChatEnterSubmits({
    isMobileTextInputViewport,
    preferEnterNewline: isWebRemoteControl,
  });
  const avoidIosInputFocusZoom = shouldAvoidIosInputFocusZoom({
    isMobileTextInputViewport,
    isWebRemoteControl,
  });
  const compactMobilePlaceholder = isWebRemoteControl && isMobileTextInputViewport;
  const sendShortcut = resolveChatEnterShortcut({ enterSubmits });
  const updateText = useCallback(
    (next: string) => {
      textRef.current = next;
      contentRevisionRef.current += 1;
      advanceComposerDraftRevision(workspacePath, workspaceIdentity);
      setText(next);
      onTextChange?.(next);
    },
    [onTextChange, workspaceIdentity, workspacePath],
  );

  const initialization = snapshot?.runtimeInitialization;
  const runtimeBlocked = initialization !== undefined && initialization.status !== "ready";

  const attachmentsApi = useComposerAttachments({
    workspacePath,
    workspaceIdentity,
    remoteSessionId,
    scopeId: draftScopeId,
    attachmentSessionId,
    attachmentPut,
    onRuntimeRestart,
    onRuntimeLifecycle,
    disabled: disabled || runtimeBlocked,
    listenAddToChatEvents: listenAddToChatEvents && !disabled && !runtimeBlocked,
  });
  const { externalFileDragging, workspaceFileDragging } = usePromptEditorDragState({
    enableExternalFileDrop: true,
    enableWorkspaceFileDrop: true,
  });
  const handleConversationDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      attachmentsApi.handleDragOverComposer(event);
    },
    [attachmentsApi.handleDragOverComposer],
  );
  const handleConversationDragLeave = useCallback(
    (event: DragEvent<HTMLElement>) => {
      attachmentsApi.handleDragLeaveComposer(event);
    },
    [attachmentsApi.handleDragLeaveComposer],
  );
  const handleConversationDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      const workspaceFilePayload = readWorkspaceFileDragPayload(event.dataTransfer);
      if (workspaceFilePayload) {
        event.preventDefault();
        attachmentsApi.handleDropComposer(event);
        appendWorkspaceFileMentionToComposer({
          inputApiRef,
          currentMarkdown: inputApiRef.current?.getMarkdown() ?? textRef.current,
          payload: workspaceFilePayload,
          workspacePath,
          workspaceIdentity,
          onTextChange: updateText,
        });
        return;
      }
      attachmentsApi.handleDropComposer(event);
    },
    [attachmentsApi.handleDropComposer, updateText, workspaceIdentity, workspacePath],
  );
  const conversationDragKind = workspaceFileDragging
    ? "workspace"
    : externalFileDragging
      ? "attachment"
      : (attachmentsApi.composerDragKind ??
        (attachmentsApi.isDraggingOverComposer ? "attachment" : null));
  const dropTargetController = useMemo<ConversationDropTargetController>(
    () => ({
      active: conversationDragKind !== null,
      kind: conversationDragKind,
      onDragOver: handleConversationDragOver,
      onDragLeave: handleConversationDragLeave,
      onDrop: handleConversationDrop,
    }),
    [
      conversationDragKind,
      handleConversationDragLeave,
      handleConversationDragOver,
      handleConversationDrop,
    ],
  );
  useEffect(() => {
    onDropTargetControllerChange?.(dropTargetController);
    return () => onDropTargetControllerChange?.(null);
  }, [dropTargetController, onDropTargetControllerChange]);
  const [attachmentPreviewIndex, setAttachmentPreviewIndex] = useState(0);
  const [attachmentPreviewOpen, setAttachmentPreviewOpen] = useState(false);
  const [pdfAttachmentPreview, setPdfAttachmentPreview] =
    useState<ChatMediaAttachmentPreviewTarget | null>(null);
  const [pdfAttachmentPreviewOpen, setPdfAttachmentPreviewOpen] = useState(false);
  const attachmentPreviewTitle = intl.formatMessage({
    id: "chat.attachments.preview.open",
  });
  const videoAttachmentPreviewTitle = intl.formatMessage({
    id: "chat.attachments.preview.openVideo",
  });
  const hasAttachments = attachmentsApi.hasAttachments;
  const {
    contexts: webElementContexts,
    hasContexts: hasWebElementContexts,
    removeContext: removeWebElementContext,
    clearContexts: clearWebElementContexts,
  } = useWebElementContexts({
    workspacePath,
    workspaceIdentity,
    listenAddToChatEvents: listenAddToChatEvents && !disabled,
    scopeId: draftScopeId,
  });
  const {
    contexts: pluginUiContexts,
    hasContexts: hasPluginUiContexts,
    removeContext: removePluginUiContext,
    clearContexts: clearPluginUiContexts,
  } = usePluginUiModelContexts({ sessionId, workspacePath, workspaceIdentity });
  usePluginUiContextImages(pluginUiContexts, attachmentsApi);
  const {
    references: pptxElementReferences,
    hasReferences: hasPptxElementReferences,
    removeReference: removePptxElementReference,
    clearReferences: clearPptxElementReferences,
  } = usePptxElementReferences({
    workspacePath,
    workspaceIdentity,
    remoteSessionId,
    listenAddToChatEvents: listenAddToChatEvents && !disabled,
    scopeId: draftScopeId,
  });
  const openPptxElementReference = useOpenPptxElementReference({
    workspacePath,
    workspaceIdentity,
    remoteSessionId,
    onOpenCodeViewer,
  });
  const {
    references: conversationSelectionReferences,
    limitReason: conversationSelectionLimitReason,
    removeReference: removeConversationSelectionReference,
    clearReferences: clearConversationSelectionReferences,
  } = useConversationSelectionReferences({
    sessionId,
    workspaceKey,
    draftScopeKey: rootDraftScopeKey,
  });
  const hasConversationSelectionReferences = conversationSelectionReferences.length > 0;

  const draftScopeRef = useRef(draftScopeId);
  const draftTargetRef = useRef({
    workspacePath,
    workspaceIdentity,
    scopeId: draftScopeId,
  });
  const ownerDraftRef = useRef({
    draft: composerDraft,
    workspacePath,
    workspaceIdentity,
    scopeId: draftScopeId,
  });
  const draftPersistTimerRef = useRef<number | null>(null);
  const suppressDraftPersistRef = useRef(false);

  const snapshotDraftOfEditor = useCallback((): {
    text: string;
    editorStateJson?: string;
  } => {
    const currentText = textRef.current;
    let editorStateJson: string | undefined;
    try {
      const editorState = inputApiRef.current?.getEditorState();
      editorStateJson = editorState ? JSON.stringify(editorState.toJSON()) : undefined;
    } catch (error) {
      logger.warn(`[v4-composer] Draft editorState 序列化Failed: ${String(error)}`);
    }
    return currentText.trim()
      ? { text: currentText, ...(editorStateJson ? { editorStateJson } : {}) }
      : { text: "" };
  }, []);

  useEffect(() => {
    if (!draftScopeId.startsWith(V4_DRAFT_SCOPE_ROOT)) return;
    return registerV4ComposerDraftReader(workspaceKey, () => ({
      draft: { ...ownerDraftRef.current.draft, ...snapshotDraftOfEditor() },
      attachments: attachmentsApi.attachments,
    }));
  }, [draftScopeId, workspaceKey, snapshotDraftOfEditor, attachmentsApi.attachments]);

  const persistDraftNow = useCallback(
    (scopeId: string) => {
      if (suppressDraftPersistRef.current) return;
      const content = snapshotDraftOfEditor();
      if (scopeId === draftScopeRef.current) {
        updateComposerContent(content);
        return;
      }
    },
    [snapshotDraftOfEditor, updateComposerContent, workspaceIdentity, workspacePath],
  );

  const scheduleDraftPersist = useCallback(() => {
    if (typeof window === "undefined") return;
    if (draftPersistTimerRef.current !== null) {
      window.clearTimeout(draftPersistTimerRef.current);
    }
    draftPersistTimerRef.current = window.setTimeout(() => {
      draftPersistTimerRef.current = null;
      persistDraftNow(draftScopeRef.current);
    }, 350);
  }, [persistDraftNow]);

  const draftFocusVersion = useCfSessionStore(
    (state) => state.getWorkspaceState(workspacePath, workspaceIdentity).draftFocusVersion,
  );
  useEffect(() => {
    if (!draftScopeId.startsWith(V4_DRAFT_SCOPE_ROOT)) return;
    const attachments = consumeV4ComposerDraftAttachments(workspaceKey, draftFocusVersion);
    if (attachments) attachmentsApi.restoreDraftAttachments(attachments);
  }, [draftFocusVersion, draftScopeId, workspaceKey, attachmentsApi.restoreDraftAttachments]);
  const pendingFocusRef = useRef(false);
  const programmaticFocusRef = useRef(false);
  const sendTriggerRef = useRef<"button" | "shortcut">("shortcut");
  const reversePointerDeliveryRef = useRef(false);
  const appliedComposerRestoreRequestRef = useRef<number | null>(null);
  const appliedExternalTextInsertRequestRef = useRef<number | null>(null);
  const focusOptsRef = useRef<ComposerAutoFocusOptions>({
    autoFocusEnabled,
    disabled,
    isMobileViewport: isMobileTextInputViewport,
  });
  focusOptsRef.current = {
    autoFocusEnabled,
    disabled,
    isMobileViewport: isMobileTextInputViewport,
  };
  const flushPendingFocus = useCallback(() => {
    if (!pendingFocusRef.current) return;
    if (resolveComposerAutoFocus(focusOptsRef.current) !== "focus-now") return;
    if (!inputApiRef.current) return;
    pendingFocusRef.current = false;
    programmaticFocusRef.current = true;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => inputApiRef.current?.focus());
    } else {
      inputApiRef.current.focus();
    }
  }, []);
  const requestComposerFocus = useCallback(() => {
    if (resolveComposerAutoFocus(focusOptsRef.current) === "skip") return;
    pendingFocusRef.current = true;
    flushPendingFocus();
  }, [flushPendingFocus]);

  const handleCodeCommentRemoved = useCallback(
    (comment: Parameters<typeof removeCodeCommentPreview>[0]) => {
      removeCodeCommentPreview(comment, services?.broadcastService);
    },
    [services?.broadcastService],
  );
  const {
    contexts: codeCommentContexts,
    hasContexts: hasCodeCommentContexts,
    removeContext: removeCodeCommentContext,
    clearContexts: clearCodeCommentContexts,
    getContexts: getCodeCommentContexts,
  } = useCodeCommentContexts({
    listenAddToChatEvents: listenAddToChatEvents && !disabled,
    onContextRemoved: handleCodeCommentRemoved,
    requestFocus: requestComposerFocus,
    scopeKey: `${workspaceKey}\0${draftScopeId}`,
  });

  useEffect(() => {
    if (!composerRestoreRequest) return;
    const applyRequest = () => {
      const nextAppliedRequestId = applyComposerRestoreRequestToComposer({
        appliedRequestId: appliedComposerRestoreRequestRef.current,
        currentSessionId: sessionId,
        currentWorkspaceKey: workspaceKey,
        hasDraftContent:
          textRef.current.length > 0 ||
          attachmentsApi.attachments.length > 0 ||
          codeCommentContexts.length > 0 ||
          webElementContexts.length > 0 ||
          pptxElementReferences.length > 0 ||
          conversationSelectionReferences.length > 0 ||
          pluginUiContexts.length > 0,
        inputApi: inputApiRef.current,
        request: composerRestoreRequest,
        requestFocus: requestComposerFocus,
        restoreSessionOwnedAttachments: attachmentsApi.restoreSessionOwnedAttachments,
        restoreDraftConfig: (config) =>
          replaceComposerDraft({
            ...ownerDraftRef.current.draft,
            ...config,
            text: composerRestoreRequest.text,
            editorStateJson: undefined,
            mention: undefined,
          }),
        scheduleDraftPersist,
        updateText,
      });
      const appliedNow =
        nextAppliedRequestId === composerRestoreRequest.requestId &&
        appliedComposerRestoreRequestRef.current !== composerRestoreRequest.requestId;
      appliedComposerRestoreRequestRef.current = nextAppliedRequestId;
      if (appliedNow) onComposerRestoreApplied?.(composerRestoreRequest.requestId);
      return nextAppliedRequestId === composerRestoreRequest.requestId;
    };
    if (applyRequest()) return;
    if (typeof requestAnimationFrame !== "function") return;
    const frame = requestAnimationFrame(applyRequest);
    return () => cancelAnimationFrame(frame);
  }, [
    attachmentsApi.attachments.length,
    attachmentsApi.restoreSessionOwnedAttachments,
    codeCommentContexts.length,
    composerRestoreRequest,
    conversationSelectionReferences.length,
    onComposerRestoreApplied,
    replaceComposerDraft,
    requestComposerFocus,
    scheduleDraftPersist,
    sessionId,
    updateText,
    webElementContexts.length,
    pptxElementReferences.length,
    pluginUiContexts.length,
    workspaceKey,
  ]);

  useEffect(() => {
    const previousTarget = draftTargetRef.current;
    const targetChanged =
      previousTarget.scopeId !== draftScopeId ||
      previousTarget.workspacePath !== workspacePath ||
      previousTarget.workspaceIdentity !== workspaceIdentity;
    let transferredDraft: ReturnType<typeof snapshotDraftOfEditor> | null = null;
    if (targetChanged && !suppressDraftPersistRef.current) {
      if (draftPersistTimerRef.current !== null) {
        window.clearTimeout(draftPersistTimerRef.current);
        draftPersistTimerRef.current = null;
      }
      const previousDraft = snapshotDraftOfEditor();
      const shouldTransferDraft =
        previousTarget.scopeId.startsWith(V4_DRAFT_SCOPE_ROOT) &&
        draftScopeId.startsWith(V4_DRAFT_SCOPE_ROOT) &&
        consumeV4ComposerDraftWorkspaceTransferRequest({
          sourceWorkspacePath: previousTarget.workspacePath,
          sourceWorkspaceIdentity: previousTarget.workspaceIdentity,
          targetWorkspacePath: workspacePath,
          targetWorkspaceIdentity: workspaceIdentity,
        });
      if (shouldTransferDraft) {
        replaceComposerDraft({ ...ownerDraftRef.current.draft, ...previousDraft });
        transferredDraft = previousDraft;
      }
    }
    draftScopeRef.current = draftScopeId;
    draftTargetRef.current = {
      workspacePath,
      workspaceIdentity,
      scopeId: draftScopeId,
    };

    const draft = transferredDraft ?? composerDraft;
    const restoreDraftInto = (api: LexicalChatInputHandle) => {
      if (!draft) {
        if (textRef.current) {
          api.clear();
          updateText("");
        }
        return;
      }
      updateText(
        restorePersistedComposerDraftIntoInput({
          draft,
          inputApi: api,
          onEditorStateError: (error) => {
            logger.warn(`[v4-composer] Draft editorState 恢复Failed，退Plain text: ${String(error)}`);
          },
        }),
      );
    };
    let unsubscribeSettled: (() => void) | null = null;
    const applyDraft = () => {
      const api = inputApiRef.current;
      if (!api) return;
      restoreDraftInto(api);
      const restoredText = draft?.text ?? "";
      const restoredRevision = contentRevisionRef.current;
      unsubscribeSettled = subscribeComposerSubmissionSettled(
        `${workspaceKey}\0${draftScopeId}`,
        (submission) => {
          if (submission.text !== restoredText) return;
          if (
            contentRevisionRef.current !== restoredRevision &&
            textRef.current !== submission.text
          ) {
            return;
          }
          inputApiRef.current?.clear();
          updateText("");
          updateComposerContent({ text: "" });
        },
      );
      requestComposerFocus();
    };
    if (typeof requestAnimationFrame === "function") {
      const frame = requestAnimationFrame(applyDraft);
      return () => {
        cancelAnimationFrame(frame);
        unsubscribeSettled?.();
      };
    }
    applyDraft();
    return () => unsubscribeSettled?.();
  }, [
    draftScopeId,
    persistDraftNow,
    requestComposerFocus,
    snapshotDraftOfEditor,
    updateText,
    updateComposerContent,
    workspaceIdentity,
    workspacePath,
    replaceComposerDraft,
  ]);

  useEffect(() => {
    ownerDraftRef.current = {
      draft: composerDraft,
      workspacePath,
      workspaceIdentity,
      scopeId: draftScopeId,
    };
  }, [composerDraft, draftScopeId, workspaceIdentity, workspacePath]);

  useEffect(() => {
    if (!externalTextInsertRequest) return;
    const applyRequest = () => {
      const nextAppliedRequestId = applyExternalTextInsertRequestToComposer({
        appliedRequestId: appliedExternalTextInsertRequestRef.current,
        inputApi: inputApiRef.current,
        request: externalTextInsertRequest,
        requestFocus: requestComposerFocus,
        scheduleDraftPersist,
        updateText,
      });
      const applied = nextAppliedRequestId === externalTextInsertRequest.requestId;
      appliedExternalTextInsertRequestRef.current = nextAppliedRequestId;
      if (applied) {
        onExternalTextInsertApplied?.(externalTextInsertRequest.requestId);
      }
      return applied;
    };
    if (applyRequest()) return;
    if (typeof requestAnimationFrame !== "function") return;
    const frame = requestAnimationFrame(applyRequest);
    return () => cancelAnimationFrame(frame);
  }, [
    externalTextInsertRequest,
    onExternalTextInsertApplied,
    requestComposerFocus,
    scheduleDraftPersist,
    updateText,
  ]);

  const lastFocusVersionRef = useRef(draftFocusVersion);
  useEffect(() => {
    if (lastFocusVersionRef.current === draftFocusVersion) return;
    lastFocusVersionRef.current = draftFocusVersion;
    requestComposerFocus();
  }, [draftFocusVersion, requestComposerFocus]);

  useEffect(() => {
    flushPendingFocus();
  }, [disabled, flushPendingFocus]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const flush = () => persistDraftNow(draftScopeRef.current);
    window.addEventListener("pagehide", flush);
    window.addEventListener("blur", flush);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("blur", flush);
      if (draftPersistTimerRef.current !== null) {
        window.clearTimeout(draftPersistTimerRef.current);
        draftPersistTimerRef.current = null;
      }
      for (const cleanup of commandResolutionCleanupsRef.current) cleanup();
      commandResolutionCleanupsRef.current.clear();
    };
  }, [persistDraftNow]);

  const [promptHistory, setPromptHistory] = useState<readonly string[]>(() =>
    readPromptHistoryEntries(workspacePath),
  );
  useEffect(() => {
    setPromptHistory(readPromptHistoryEntries(workspacePath));
  }, [workspacePath]);

  const mode = snapshot?.inputRouting.mode ?? "startNow";
  const modifiedEnterSubmits = shouldEnableModifiedEnterSubmit({
    inputRoutingMode: mode,
    isMobileTextInputViewport,
    isWebRemoteControl,
  });
  const canStop = Boolean(snapshot?.control.canStop);
  const modifiedEnterReversesDelivery = modifiedEnterSubmits && canStop;
  const hasText = text.trim().length > 0;
  const hasDraftToSubmit =
    hasText ||
    hasAttachments ||
    hasCodeCommentContexts ||
    hasWebElementContexts ||
    hasPptxElementReferences ||
    hasConversationSelectionReferences ||
    hasPluginUiContexts ||
    Boolean(pendingShareContext);
  const hasComposerDraftContent =
    text.length > 0 ||
    hasAttachments ||
    hasCodeCommentContexts ||
    hasWebElementContexts ||
    hasPptxElementReferences ||
    hasConversationSelectionReferences ||
    hasPluginUiContexts ||
    Boolean(pendingShareContext);
  useEffect(() => {
    onDraftStateChange?.({
      hasContent: hasComposerDraftContent,
      busy: pending,
    });
  }, [hasComposerDraftContent, onDraftStateChange, pending]);
  const routingAllowsSend = draftMode || (snapshot !== null && mode !== "reject");
  const attachmentsReady = !attachmentsApi.hasUnreadyAttachments;
  const canSend =
    !disabled &&
    !pending &&
    hasDraftToSubmit &&
    routingAllowsSend &&
    attachmentsReady &&
    submissionReady &&
    !runtimeBlocked;
  const showStopControl = canStop && !hasDraftToSubmit;

  useEffect(() => {
    if (!canSend) setSendTooltipOpen(false);
  }, [canSend]);

  const submit = useCallback(
    async (
      heldQueueDisposition?: "clearQueueAndSend" | "keepQueueAndSend",
      expectedHeldQueueItemIds?: readonly string[],
      existingTelemetrySeed?: ConversationPromptTelemetrySeed,
      requestedDelivery?: "startNow" | "queue" | "guide",
    ) => {
      const trimmed = textRef.current.trim();
      const submittedQueueItemIds =
        snapshotRef.current?.queue.items.map((item) => item.queueItemId) ?? [];
      const hasPendingAttachments = attachmentsApi.attachments.length > 0;
      const currentCodeCommentContexts = getCodeCommentContexts();
      const hasPendingCodeCommentContexts = currentCodeCommentContexts.length > 0;
      const currentWebElementContexts = webElementContexts;
      const hasPendingWebElementContexts = currentWebElementContexts.length > 0;
      const currentPluginUiContexts = pluginUiContexts;
      const hasPendingPluginUiContexts = currentPluginUiContexts.length > 0;
      const currentPptxElementReferences = pptxElementReferences;
      const hasPendingPptxElementReferences = currentPptxElementReferences.length > 0;
      const currentConversationSelections = conversationSelectionReferences;
      const hasPendingConversationSelections = currentConversationSelections.length > 0;
      const submittedShareContext = pendingShareContext;
      const submittedDraft = snapshotDraftOfEditor();
      const submittedScopeKey = `${workspaceKey}\0${draftScopeRef.current}`;
      let cleanupRevision = contentRevisionRef.current;
      const submission = createSubmissionFromComposer?.() ?? null;
      const submittedAttachmentIds = attachmentsApi.attachments.map((item) => item.id);
      if (
        (!trimmed &&
          !hasPendingAttachments &&
          !hasPendingCodeCommentContexts &&
          !hasPendingWebElementContexts &&
          !hasPendingPptxElementReferences &&
          !hasPendingConversationSelections &&
          !hasPendingPluginUiContexts &&
          !submittedShareContext) ||
        pendingRef.current ||
        targetSelectionPendingRef.current ||
        !remoteAvailable ||
        !submissionReady ||
        runtimeBlocked ||
        (createSubmissionFromComposer !== undefined && submission === null) ||
        attachmentsApi.hasUnreadyAttachments
      ) {
        return;
      }
      const sendAction = startUserAction({
        featureId: "conversation.composer.message",
        action: "send",
        trigger: sendTriggerRef.current === "button" ? "button" : "shortcut",
        workspaceKind: workspaceIdentity?.trim() ? "remote" : "local",
      });
      pendingRef.current = true;
      setPending(true);
      const telemetryConfig = telemetryDraftConfig ?? snapshotRef.current?.config ?? draftConfig;
      let telemetrySeed: ConversationPromptTelemetrySeed;
      if (existingTelemetrySeed) {
        telemetrySeed = existingTelemetrySeed;
        if (telemetrySeed.localTtft)
          getLocalTtftObserver()?.confirmation(telemetrySeed.localTtft, false);
      } else {
        const freshSeed: ConversationPromptTelemetrySeed = {
          sendTime: Date.now(),
          localTtft: !workspaceIdentity?.trim()
            ? getLocalTtftObserver()?.start(
                workspacePath,
                (snapshotRef.current !== null &&
                  snapshotRef.current.inputRouting.mode !== "startNow") ||
                  false,
                trimmed.startsWith("/"),
              )
            : undefined,
          extraDetail: buildV4ConversationPromptTelemetryExtraDetail({
            askMode: telemetryConfig?.mode,
            modelName: telemetryConfig?.model,
            configProvider: telemetryConfig?.provider,
            agentProvider: provider,
            providerBaseURL: resolveProviderBaseURL(telemetryConfig?.provider, modelSelectionView),
            planIdentitySnapshot: readPlanIdentitySnapshot?.(),
          }),
        };
        const sendTrigger = sendTriggerRef.current;
        sendTriggerRef.current = "shortcut";
        telemetrySeed =
          conversationTelemetry?.recordSendClick({
            sessionId: sessionId ?? null,
            seed: freshSeed,
            trigger: sendTrigger,
          }) ?? freshSeed;
      }
      let promptHistoryBeforeSend: readonly string[] | null = null;
      let promptHistoryAfterAppend: readonly string[] | null = null;
      let promptHistoryWasPersisted = false;
      let draftSubmissionClaimed = false;
      let editorClearedOptimistically = false;
      let submittedCommandId: string | null = null;
      let submittedCommandResolved = false;
      const claimSubmittedDraft = () => {
        if (draftPersistTimerRef.current !== null) {
          window.clearTimeout(draftPersistTimerRef.current);
          draftPersistTimerRef.current = null;
        }
        suppressDraftPersistRef.current = true;
        updateComposerContent({ text: "" });
        draftSubmissionClaimed = true;
      };
      const restoreSubmittedDraft = () => {
        if (!draftSubmissionClaimed) return;
        if (contentRevisionRef.current === cleanupRevision) {
          updateComposerContent(submittedDraft);
          if (submittedCommandId && !submittedCommandResolved) {
            trackUnsettledComposerSubmission(submittedScopeKey, {
              commandId: submittedCommandId,
              text: submittedDraft.text,
            });
          }
        }
        suppressDraftPersistRef.current = false;
        draftSubmissionClaimed = false;
        if (editorClearedOptimistically && contentRevisionRef.current === cleanupRevision) {
          if (submittedDraft.editorStateJson) {
            inputApiRef.current?.setEditorStateJson(submittedDraft.editorStateJson);
          } else {
            inputApiRef.current?.setText(submittedDraft.text);
          }
          updateText(submittedDraft.text);
          editorClearedOptimistically = false;
        }
      };
      const finalizeSubmittedDraft = () => {
        if (!draftSubmissionClaimed) return;
        suppressDraftPersistRef.current = false;
        draftSubmissionClaimed = false;
      };
      let submittedContentSettled = false;
      const settleSubmittedContent = async () => {
        if (submittedContentSettled) return;
        submittedContentSettled = true;
        await attachmentsApi.adoptSentAttachments(submittedAttachmentIds);
        if (contentRevisionRef.current === cleanupRevision) {
          inputApiRef.current?.clear();
          updateText("");
          updateComposerContent({ text: "" });
        }
        attachmentsApi.clearAttachments(submittedAttachmentIds);
        currentCodeCommentContexts.forEach(removeCodeCommentContext);
        currentWebElementContexts.forEach((context) => removeWebElementContext(context.id));
        currentPluginUiContexts.forEach((context) => removePluginUiContext(context.id));
        currentPptxElementReferences.forEach((reference) =>
          removePptxElementReference(reference.id),
        );
        currentConversationSelections.forEach((reference) =>
          removeConversationSelectionReference(reference.id),
        );
        finalizeSubmittedDraft();
      };
      const subscribeToCommandResolution = (commandId: string) => {
        let active = true;
        let cleanup = () => undefined;
        submittedCommandId = commandId;
        const unsubscribe = pendingCommandRegistry.subscribeResolution(commandId, (resolution) => {
          if (!active) return;
          submittedCommandResolved = true;
          cleanup();
          if (
            resolution !== "accepted" &&
            resolution !== "duplicate" &&
            resolution !== "authoritative"
          ) {
            return;
          }
          void settleSubmittedContent();
        });
        cleanup = () => {
          if (!active) return;
          active = false;
          unsubscribe();
          commandResolutionCleanupsRef.current.delete(cleanup);
        };
        commandResolutionCleanupsRef.current.add(cleanup);
      };
      const rollbackPromptHistory = () => {
        if (!promptHistoryWasPersisted || !promptHistoryBeforeSend || !promptHistoryAfterAppend) {
          return;
        }
        const currentPromptHistory = readPromptHistoryEntries(workspacePath);
        if (arePromptHistoryEntriesEqual(currentPromptHistory, promptHistoryAfterAppend)) {
          persistPromptHistoryEntries(workspacePath, promptHistoryBeforeSend);
          setPromptHistory(promptHistoryBeforeSend);
          return;
        }
        setPromptHistory(currentPromptHistory);
      };
      try {
        const readyAttachmentRefs = await attachmentsApi.prepareForSend();
        if (readyAttachmentRefs === null) {
          if (telemetrySeed.localTtft)
            getLocalTtftObserver()?.exclude(telemetrySeed.localTtft, "rejected");
          conversationTelemetry?.settleSendResult({
            seed: telemetrySeed,
            sessionId: sessionId ?? null,
            status: "fail",
            reasonCode: "attachment_not_ready",
          });
          sendAction.fail({ failureStage: "attachment_not_ready" });
          return;
        }
        //
        const promptText = serializeComposerPromptContexts(trimmed, {
          codeComments: currentCodeCommentContexts,
          conversationSelections: [],
          webElements: currentWebElementContexts,
          pptxElements: currentPptxElementReferences,
          pluginUiContexts: currentPluginUiContexts,
        });
        const contextAttachmentCount =
          countComposerPromptContexts({
            codeComments: currentCodeCommentContexts,
            conversationSelections: currentConversationSelections,
            webElements: currentWebElementContexts,
            pptxElements: currentPptxElementReferences,
            pluginUiContexts: currentPluginUiContexts,
          }) + (submittedShareContext ? 1 : 0);
        if (trimmed) {
          promptHistoryBeforeSend = readPromptHistoryEntries(workspacePath);
          promptHistoryAfterAppend = appendPromptHistoryEntry(promptHistoryBeforeSend, trimmed);
          if (!arePromptHistoryEntriesEqual(promptHistoryBeforeSend, promptHistoryAfterAppend)) {
            persistPromptHistoryEntries(workspacePath, promptHistoryAfterAppend);
            promptHistoryWasPersisted = true;
            setPromptHistory(promptHistoryAfterAppend);
          }
        }
        claimSubmittedDraft();
        if (requestedDelivery === "startNow") {
          inputApiRef.current?.clear();
          updateText("");
          cleanupRevision = contentRevisionRef.current;
          editorClearedOptimistically = true;
        }
        const sendResult = await onSendText(promptText, {
          submittedDraftText: submittedDraft.text,
          submission,
          ...(currentConversationSelections.length
            ? {
                conversationQuotes: currentConversationSelections.map(
                  ({ text, path, senderName, senderId, messageId, sentAt }) => ({
                    text,
                    path,
                    senderName,
                    senderId,
                    messageId,
                    sentAt,
                  }),
                ),
              }
            : {}),
          telemetrySeed,
          onCommandCreated: subscribeToCommandResolution,
          ...(requestedDelivery ? { requestedDelivery } : {}),
          ...(heldQueueDisposition ? { heldQueueDisposition } : {}),
          ...(expectedHeldQueueItemIds ? { expectedHeldQueueItemIds } : {}),
          ...(readyAttachmentRefs.length > 0 ? { attachments: readyAttachmentRefs } : {}),
          ...(contextAttachmentCount > 0 ? { contextAttachmentCount } : {}),
          ...(submittedShareContext
            ? {
                sharedContextRefs: [
                  {
                    kind: "shared_context_import" as const,
                    context_id: submittedShareContext.contextId,
                  },
                ],
              }
            : {}),
        });
        if (sendResult === "blocked") {
          if (telemetrySeed.localTtft)
            getLocalTtftObserver()?.exclude(telemetrySeed.localTtft, "rejected");
          rollbackPromptHistory();
          restoreSubmittedDraft();
          conversationTelemetry?.settleSendResult({
            seed: telemetrySeed,
            sessionId: sessionId ?? null,
            status: "fail",
            reasonCode: "blocked",
          });
          sendAction.reject({ resultSource: "authority_ack", admissionResult: "rejected" });
          return;
        }
        if (sendResult === "confirmationRequired") {
          if (telemetrySeed.localTtft)
            getLocalTtftObserver()?.confirmation(telemetrySeed.localTtft, true);
          rollbackPromptHistory();
          restoreSubmittedDraft();
          const latestQueueItemIds =
            snapshotRef.current?.queue.items.map((item) => item.queueItemId) ?? [];
          setHeldQueueConfirmation({
            telemetrySeed: { ...telemetrySeed, queueConfirmed: true },
            ...(requestedDelivery ? { requestedDelivery } : {}),
            queueItemIds:
              latestQueueItemIds.length > 0 ? latestQueueItemIds : submittedQueueItemIds,
          });
          sendAction.noop();
          return;
        }
        setHeldQueueConfirmation(null);
        await settleSubmittedContent();
        sendAction.complete({ resultSource: "authority_ack", admissionResult: "accepted" });
      } catch (error) {
        rollbackPromptHistory();
        if (!submittedContentSettled) restoreSubmittedDraft();
        if (telemetrySeed.localTtft)
          getLocalTtftObserver()?.exclude(telemetrySeed.localTtft, "failed");
        logger.warn(`[v4-composer] SendFailed: ${String(error)}`);
        conversationTelemetry?.settleSendResult({
          seed: telemetrySeed,
          sessionId: sessionId ?? null,
          status: "fail",
          reasonCode: "composer_error",
        });
        sendAction.fail({ failureStage: "composer_send" });
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [
      attachmentsApi,
      conversationSelectionReferences,
      conversationTelemetry,
      draftConfig,
      createSubmissionFromComposer,
      submissionReady,
      remoteAvailable,
      runtimeBlocked,
      getCodeCommentContexts,
      telemetryDraftConfig,
      modelSelectionView,
      onSendText,
      pendingShareContext,
      provider,
      readPlanIdentitySnapshot,
      removeCodeCommentContext,
      removeConversationSelectionReference,
      removePptxElementReference,
      removeWebElementContext,
      removePluginUiContext,
      pluginUiContexts,
      sessionId,
      snapshotDraftOfEditor,
      updateText,
      updateComposerContent,
      webElementContexts,
      pptxElementReferences,
      workspaceIdentity,
      workspacePath,
    ],
  );

  const handleEditorChange = useCallback(
    (value: string) => {
      conversationTelemetry?.recordComposerTextChange(value);
      updateText(value);
      updateComposerContent({ text: value });
      scheduleDraftPersist();
    },
    [conversationTelemetry, scheduleDraftPersist, updateComposerContent, updateText],
  );

  const handleEditorFocus = useCallback(() => {
    conversationTelemetry?.recordComposerFocus();
    if (programmaticFocusRef.current) {
      programmaticFocusRef.current = false;
      return;
    }
    conversationTelemetry?.recordComposerFocusClick({
      sessionId: sessionId ?? null,
    });
  }, [conversationTelemetry, sessionId]);

  const handleEditorSubmit = useCallback(
    (value: string) => {
      textRef.current = value;
      const reverseDelivery = reversePointerDeliveryRef.current;
      reversePointerDeliveryRef.current = false;
      const followupMode = snapshotRef.current?.config.followupMode;
      void submit(
        undefined,
        undefined,
        undefined,
        reverseDelivery && followupMode ? resolveOppositeFollowupDelivery(followupMode) : undefined,
      );
      return false;
    },
    [submit],
  );

  const handleModifiedEditorSubmit = useCallback(
    (value: string) => {
      const followupMode = snapshotRef.current?.config.followupMode;
      textRef.current = value;
      void submit(
        undefined,
        undefined,
        undefined,
        followupMode ? resolveOppositeFollowupDelivery(followupMode) : undefined,
      );
      return false;
    },
    [submit],
  );

  const handleClearQueueSend = useCallback(() => {
    if (!heldQueueConfirmation) return;
    void submit(
      "clearQueueAndSend",
      heldQueueConfirmation.queueItemIds,
      heldQueueConfirmation.telemetrySeed,
      heldQueueConfirmation.requestedDelivery,
    );
  }, [heldQueueConfirmation, submit]);

  const handleKeepQueueSend = useCallback(() => {
    if (!heldQueueConfirmation) return;
    void submit(
      "keepQueueAndSend",
      heldQueueConfirmation.queueItemIds,
      heldQueueConfirmation.telemetrySeed,
      heldQueueConfirmation.requestedDelivery,
    );
  }, [heldQueueConfirmation, submit]);

  const handleStopClick = useCallback(() => {
    runUserAction({
      input: { featureId: "conversation.composer.message", action: "stop", trigger: "button" },
      operation: onStop,
      completed: { resultSource: "optimistic_projection" },
      failureStage: "stop_generation",
    });
  }, [onStop]);

  const handleSendButtonClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      sendTriggerRef.current = "button";
      reversePointerDeliveryRef.current = shouldReverseFollowupDeliveryForPointer({
        enabled: modifiedEnterReversesDelivery,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        isApplePlatform: appleKeyboardPlatform,
      });
    },
    [appleKeyboardPlatform, modifiedEnterReversesDelivery],
  );

  useEffect(() => {
    if (!listenAddToChatEvents || typeof window === "undefined") {
      return;
    }
    const handleWorkspaceFileAddToChat = (event: Event) => {
      if (!isWorkspaceFileAddToChatEvent(event)) {
        return;
      }
      event.preventDefault();
      appendWorkspaceFileMentionToComposer({
        inputApiRef,
        currentMarkdown: inputApiRef.current?.getMarkdown() ?? textRef.current,
        payload: event.detail,
        workspacePath,
        workspaceIdentity,
        onTextChange: updateText,
      });
    };
    window.addEventListener(WORKSPACE_FILE_ADD_TO_CHAT_EVENT, handleWorkspaceFileAddToChat);
    return () => {
      window.removeEventListener(WORKSPACE_FILE_ADD_TO_CHAT_EVENT, handleWorkspaceFileAddToChat);
    };
  }, [listenAddToChatEvents, updateText, workspaceIdentity, workspacePath]);

  const workingDurationLabel =
    layout === "inline" && canStop
      ? formatConversationWorkDuration(workingDurationMs, intl, locale)
      : null;
  const normalPlaceholder = workingDurationLabel
    ? intl.formatMessage({ id: "chat.history.workingFor" }, { duration: workingDurationLabel })
    : intl.formatMessage({
        id: resolveChatPlaceholderKey({
          hasHistoryMessages: (snapshot?.rows.totalCount ?? 0) > 0,
          isTaskProcessing: canStop,
          compactNewTask: compactMobilePlaceholder || layout === "inline",
        }),
      });
  const sendTooltipTitle = intl.formatMessage({
    id: mode === "enqueue" ? "chat.queue.enqueue" : "chat.send",
  });
  const modifierTooltip = resolveFollowupModifierTooltip({
    enabled: modifiedEnterReversesDelivery,
    canSend,
    modifierPressed: primaryModifierPressed,
    followupMode: snapshot?.config.followupMode,
    isApplePlatform: appleKeyboardPlatform,
  });
  const resolvedSendTooltipTitle = modifierTooltip
    ? intl.formatMessage({ id: modifierTooltip.titleId })
    : sendTooltipTitle;
  const resolvedSendTooltipShortcut = modifierTooltip?.shortcut ?? sendShortcut;
  const stopTooltipTitle = intl.formatMessage({ id: "chat.stop" });
  const visibleError = error && !shouldSuppressChatErrorBanner(error) ? error : null;

  useEffect(() => {
    if (!visibleError || !conversationTelemetry || !telemetryVisible) return;
    const telemetryKey = [
      visibleError.taskId ?? sessionId ?? "",
      visibleError.code ?? "",
      visibleError.traceId ?? "",
      visibleError.message,
    ].join(":");
    if (reportedErrorKeysRef.current.has(telemetryKey)) return;
    reportedErrorKeysRef.current.add(telemetryKey);
    conversationTelemetry.reportVisibleChatError({
      errorKey: telemetryKey,
      displayMessage: resolveChatErrorBannerDisplayMessage(visibleError, intl),
      error: visibleError,
    });
  }, [conversationTelemetry, intl, sessionId, telemetryVisible, visibleError]);

  const attachmentAction = useMemo(
    () => ({
      label: intl.formatMessage({ id: "chat.composer.attachment" }),
      menuItemTestId: TID_CHAT_ATTACHMENT_MENU_ITEM,
      onSelect: () =>
        runUserAction({
          input: {
            featureId: "conversation.composer.attachment",
            action: "add",
            trigger: "button",
          },
          operation: attachmentsApi.openAttachmentPicker,
          completed: { resultSource: "local_commit" },
          failureStage: "attachment_picker",
        }),
      testId: TID_CHAT_ATTACHMENT_BUTTON,
    }),
    [intl, attachmentsApi.openAttachmentPicker],
  );

  const composerAttachments = attachmentsApi.attachments;
  const orderedComposerAttachments = useMemo(() => {
    const media: (typeof composerAttachments)[number][] = [];
    const files: (typeof composerAttachments)[number][] = [];
    for (const attachment of composerAttachments) {
      (isMediaChatComposerAttachment(attachment) ? media : files).push(attachment);
    }
    return [...media, ...files];
  }, [composerAttachments]);
  const composerMediaPreviewItems = useMemo(
    () =>
      composerAttachments.flatMap((attachment) =>
        attachment.objectUrl && isMediaChatComposerAttachment(attachment)
          ? [
              {
                alt: attachment.filename,
                filename: attachment.filename,
                mediaType: attachment.mimeType,
                src: attachment.objectUrl,
              },
            ]
          : [],
      ),
    [composerAttachments],
  );
  const topContentNode = useMemo(() => {
    if (
      composerAttachments.length === 0 &&
      codeCommentContexts.length === 0 &&
      webElementContexts.length === 0 &&
      pptxElementReferences.length === 0 &&
      conversationSelectionReferences.length === 0 &&
      pluginUiContexts.length === 0
    ) {
      return null;
    }
    return (
      <div className="flex max-w-full flex-col items-start gap-2">
        {composerAttachments.length > 0 ? (
          <Attachments
            variant="inline"
            className="flex max-w-full flex-wrap gap-2"
            data-composer-file-attachments-row="true"
          >
            {orderedComposerAttachments.map((attachment) => {
              const isClipboardTextAttachment = attachment.sourceKind === "clipboard-text";
              const isMediaAttachment = isMediaChatComposerAttachment(attachment);
              const isVideoAttachment = isVideoChatComposerAttachment(attachment);
              const isPdfAttachment = isPdfChatComposerAttachment(attachment);
              const mediaType = attachment.objectUrl
                ? attachment.mimeType
                : attachment.mimeType.startsWith("image/")
                  ? "application/octet-stream"
                  : attachment.mimeType;
              const canPreviewImageAttachment =
                Boolean(attachment.objectUrl) && isImageChatComposerAttachment(attachment);
              const canPreviewVideoAttachment = Boolean(attachment.objectUrl) && isVideoAttachment;
              const canPreviewPdfAttachment = Boolean(attachment.objectUrl) && isPdfAttachment;
              const fileDisplayDescriptor = resolveFileDisplayDescriptor(
                attachment.localPath ?? attachment.filename,
              );
              const uploadStatusLabel =
                attachment.uploadStatus === "uploading"
                  ? intl.formatMessage(
                      { id: "chat.attachments.upload.uploading" },
                      { progress: String(attachment.uploadProgress) },
                    )
                  : attachment.uploadStatus === "failed"
                    ? intl.formatMessage(
                        { id: "chat.attachments.upload.failed" },
                        { message: attachment.uploadError ?? "unknown" },
                      )
                    : intl.formatMessage({
                        id: `chat.attachments.upload.${attachment.uploadStatus}`,
                      });
              const showUploadStatus =
                !attachment.localZeroCopy &&
                (attachment.uploadStatus !== "ready" || attachment.showComplete);
              return (
                <Attachment
                  key={attachment.id}
                  variant={isMediaAttachment ? "grid" : "inline"}
                  data-composer-attachment-kind={
                    isVideoAttachment
                      ? "video"
                      : isMediaAttachment
                        ? "image"
                        : isPdfAttachment
                          ? "pdf"
                          : "file"
                  }
                  data-testid={testId(TID_V4_ATTACHMENT, attachment.id)}
                  data-upload-status={attachment.uploadStatus}
                  className={
                    isMediaAttachment
                      ? "relative size-12 overflow-hidden rounded-lg bg-surface after:pointer-events-none after:absolute after:inset-0 after:rounded-lg after:border after:border-border after:content-['']"
                      : "h-12 w-fit max-w-full min-w-0 gap-2 rounded-lg border border-border bg-surface p-1.5 pr-6 [--attachment-bg:var(--color-surface)] hover:bg-surface-hover"
                  }
                  data={{
                    id: attachment.id,
                    type: "file",
                    filename: attachment.filename,
                    ...(isClipboardTextAttachment
                      ? {
                          description: intl.formatMessage(
                            {
                              id: "chat.attachments.clipboardText.description",
                            },
                            {
                              lineCount: formatAttachmentLineCount(attachment, locale),
                            },
                          ),
                          displayName: intl.formatMessage({
                            id: "chat.attachments.clipboardText",
                          }),
                          sourceKind: "clipboard-text" as const,
                        }
                      : {}),
                    mediaType,
                    url: attachment.objectUrl ?? "",
                  }}
                  onRemove={() => attachmentsApi.removeAttachment(attachment.id)}
                  onOpen={
                    canPreviewImageAttachment || canPreviewVideoAttachment
                      ? () => {
                          const previewIndex = composerMediaPreviewItems.findIndex(
                            (item) => item.src === attachment.objectUrl,
                          );
                          if (previewIndex < 0) return;
                          setAttachmentPreviewIndex(previewIndex);
                          setAttachmentPreviewOpen(true);
                        }
                      : canPreviewPdfAttachment
                        ? () => {
                            setPdfAttachmentPreview({
                              filename: attachment.filename,
                              mediaType: "application/pdf",
                              url: attachment.objectUrl,
                            });
                            setPdfAttachmentPreviewOpen(true);
                          }
                        : undefined
                  }
                  openLabel={
                    canPreviewVideoAttachment
                      ? videoAttachmentPreviewTitle
                      : canPreviewImageAttachment
                        ? attachmentPreviewTitle
                        : canPreviewPdfAttachment
                          ? intl.formatMessage({ id: "chat.attachments.preview.openPdf" })
                          : undefined
                  }
                >
                  <div
                    className={cn(
                      "relative shrink-0",
                      isMediaAttachment ? "size-full" : "size-9 rounded-md bg-background",
                    )}
                  >
                    <AttachmentPreview
                      className={cn(
                        isMediaAttachment ? "size-full rounded-none" : "size-9 rounded-md",
                      )}
                      fallbackIcon={
                        isClipboardTextAttachment ? (
                          <ClipboardPenLineIcon className="size-3.5 text-muted-foreground" />
                        ) : (
                          <FileDisplayIcon
                            src={fileDisplayDescriptor.fileIconSrc}
                            size={16}
                            className="size-4 shrink-0"
                          />
                        )
                      }
                    />
                    {showUploadStatus && isMediaAttachment ? (
                      <span
                        data-testid={testId(TID_V4_ATTACHMENT_UPLOAD_PROGRESS, attachment.id)}
                        role={attachment.uploadStatus === "failed" ? "alert" : "status"}
                        aria-label={uploadStatusLabel}
                        className="absolute inset-0 grid place-items-center rounded-lg bg-background/85 text-[7px] font-semibold text-foreground"
                      >
                        <svg
                          aria-hidden="true"
                          className="absolute inset-0 size-full -rotate-90 text-brand"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="stroke-border"
                            cx="12"
                            cy="12"
                            fill="none"
                            pathLength="100"
                            r="9"
                            strokeWidth="2"
                          />
                          <circle
                            className={
                              attachment.uploadStatus === "failed"
                                ? "stroke-destructive"
                                : "stroke-current"
                            }
                            cx="12"
                            cy="12"
                            fill="none"
                            pathLength="100"
                            r="9"
                            strokeDasharray={`${attachment.uploadProgress} 100`}
                            strokeLinecap="round"
                            strokeWidth="2"
                          />
                        </svg>
                        <span className="relative">
                          {attachment.uploadStatus === "failed"
                            ? "!"
                            : `${attachment.uploadProgress}%`}
                        </span>
                      </span>
                    ) : null}
                  </div>
                  {!isMediaAttachment ? (
                    isClipboardTextAttachment ? (
                      <AttachmentInfo className="max-w-48 text-ui-base text-foreground" />
                    ) : (
                      <div className="min-w-0 max-w-40 flex-1">
                        <span
                          className="block truncate text-ui-base font-medium text-foreground"
                          title={attachment.filename}
                        >
                          {attachment.sourceKind === "topic-history"
                            ? intl.formatMessage(
                                { id: "chat.attachments.topicHistory" },
                                { count: attachment.messageCount ?? 0 },
                              )
                            : attachment.filename}
                        </span>
                        <span className="block truncate text-ui-sm font-normal text-foreground-subtle">
                          {getComposerAttachmentTypeLabel(attachment.filename, attachment.mimeType)}
                        </span>
                      </div>
                    )
                  ) : null}
                  {showUploadStatus && !isMediaAttachment ? (
                    <span
                      data-testid={testId(TID_V4_ATTACHMENT_UPLOAD_PROGRESS, attachment.id)}
                      role={attachment.uploadStatus === "failed" ? "alert" : "status"}
                      title={uploadStatusLabel}
                      className={cn(
                        "max-w-28 truncate text-ui-sm font-normal text-foreground-subtle",
                        attachment.uploadStatus === "failed" && "text-destructive",
                      )}
                    >
                      {attachment.uploadStatus === "uploading"
                        ? `${attachment.uploadProgress}%`
                        : uploadStatusLabel}
                    </span>
                  ) : null}
                  {attachment.uploadStatus === "failed" ? (
                    <button
                      type="button"
                      data-testid={testId(TID_V4_ATTACHMENT_UPLOAD_RETRY, attachment.id)}
                      aria-label={intl.formatMessage({
                        id: "chat.attachments.upload.retry",
                      })}
                      title={uploadStatusLabel}
                      className="grid size-5 shrink-0 place-items-center rounded-md text-destructive hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        attachmentsApi.retryAttachment(attachment.id);
                      }}
                    >
                      <RotateCcwIcon className="size-3" />
                    </button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    data-composer-attachment-remove={attachment.id}
                    aria-label={intl.formatMessage({
                      id: "chat.attachments.remove",
                    })}
                    className="absolute right-0.5 top-0.5 z-20 size-3.5 rounded-full bg-primary p-0 text-primary-foreground opacity-0 transition-opacity hover:bg-primary/80 hover:text-primary-foreground group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      attachmentsApi.removeAttachment(attachment.id);
                    }}
                  >
                    <XIcon className="size-2.5" />
                  </Button>
                </Attachment>
              );
            })}
          </Attachments>
        ) : null}
        {codeCommentContexts.length > 0 ||
        webElementContexts.length > 0 ||
        pptxElementReferences.length > 0 ||
        conversationSelectionReferences.length > 0 ||
        pluginUiContexts.length > 0 ? (
          <div
            className="flex max-w-full flex-wrap items-center gap-2"
            data-composer-context-attachments-row="true"
          >
            <CodeCommentAttachmentChip
              comments={codeCommentContexts}
              onRemove={removeCodeCommentContext}
              onRemoveAll={clearCodeCommentContexts}
            />
            <WebElementContextAttachmentChip
              contexts={webElementContexts}
              onRemove={removeWebElementContext}
              onRemoveAll={clearWebElementContexts}
            />
            <PluginUiModelContextChip
              contexts={pluginUiContexts}
              onRemove={removePluginUiContext}
              onRemoveAll={clearPluginUiContexts}
            />
            <PptxElementReferenceChip
              references={pptxElementReferences}
              onOpen={onOpenCodeViewer ? openPptxElementReference : undefined}
              onRemove={removePptxElementReference}
              onRemoveAll={clearPptxElementReferences}
            />
            <ConversationSelectionReferenceChip
              references={conversationSelectionReferences}
              onRemove={removeConversationSelectionReference}
              onRemoveAll={clearConversationSelectionReferences}
            />
          </div>
        ) : null}
      </div>
    );
  }, [
    attachmentPreviewTitle,
    attachmentsApi,
    clearCodeCommentContexts,
    clearConversationSelectionReferences,
    clearWebElementContexts,
    clearPluginUiContexts,
    clearPptxElementReferences,
    codeCommentContexts,
    composerAttachments,
    composerMediaPreviewItems,
    orderedComposerAttachments,
    intl,
    locale,
    removeCodeCommentContext,
    removeConversationSelectionReference,
    removeWebElementContext,
    removePluginUiContext,
    removePptxElementReference,
    conversationSelectionReferences,
    pendingShareContext,
    webElementContexts,
    pluginUiContexts,
    pptxElementReferences,
    onOpenCodeViewer,
    openPptxElementReference,
  ]);

  const composerUsage = snapshot?.usage ?? null;
  const composerPhase = snapshot?.control.phase ?? null;
  const handleSelectModelTrace = useCallback(
    (
      nextProvider: string,
      nextModel: string,
      sourceModel: ModelSelectionSource | null,
      reasoningLevel?: string,
    ) =>
      runUserAction({
        input: {
          featureId: "conversation.composer.config",
          action: "change_model",
          trigger: "select",
        },
        operation: () =>
          reasoningLevel === undefined
            ? onSelectModel(nextProvider, nextModel, sourceModel)
            : onSelectModel(nextProvider, nextModel, sourceModel, reasoningLevel),
        completed: { resultSource: "optimistic_projection" },
        failureStage: "model_change",
      }),
    [onSelectModel],
  );
  const submitControlNode = useMemo(
    () => (
      <div className="flex min-w-0 items-center gap-1">
        {!remoteAvailable ? (
          <span
            data-testid="remote-send-unavailable"
            className="max-w-40 text-right text-ui-sm text-foreground-subtle"
          >
            {intl.formatMessage({ id: "remote.conversation.sendUnavailable" })}
          </span>
        ) : null}
        {remoteAvailable ? (
          <span className="flex min-w-0 shrink items-center gap-1 overflow-hidden empty:hidden">
            <V4ComposerModelControls
              workspacePath={workspacePath}
              workspaceIdentity={workspaceIdentity}
              modelSelectionView={modelSelectionView}
              modelSelectionState={modelSelectionState}
              modelSelectionReload={modelSelectionReload}
              modelSelectionRefresh={modelSelectionRefresh}
              sessionId={sessionId ?? null}
              phase={composerPhase}
              provider={provider}
              isWebRemoteControl={isWebRemoteControl}
              isMobileViewport={isMobileTextInputViewport}
              draftMode={draftMode}
              draftConfig={draftConfig}
              usage={composerUsage}
              disabled={disabled || runtimeBlocked}
              modelLocked={highspeedCard !== null}
              highspeedPresented={highspeedPresented}
              highspeedEntranceAnimated={highspeedEntranceAnimated}
              highspeedSweepActive={highspeedSweepActive}
              highspeedExpiresAt={highspeedCard?.expiresAt}
              highspeedModel={highspeedCard?.model}
              activeConfigPicker={activeConfigPicker}
              onConfigPickerOpenChange={handleConfigPickerOpenChange}
              onSelectModel={handleSelectModelTrace}
              onSelectThought={onSelectThought}
              onSwitchMode={onSwitchMode}
              onRecoverCustomModelSelection={onRecoverCustomModelSelection}
              onSendCompressionCommand={onSendCompressionCommand}
            />
          </span>
        ) : null}
        {showStopControl ? (
          <ControlHintTooltip title={stopTooltipTitle} shortcut="Esc">
            <Button
              type="button"
              variant="secondary"
              size="icon-md"
              onClick={handleStopClick}
              data-testid={TID_V4_STOP}
              aria-label={stopTooltipTitle}
            >
              <SquareIcon className="size-4 fill-current" />
              <span className="sr-only">{stopTooltipTitle}</span>
            </Button>
          </ControlHintTooltip>
        ) : (
          <ControlHintTooltip
            title={resolvedSendTooltipTitle}
            shortcut={resolvedSendTooltipShortcut}
            open={Boolean(modifierTooltip) || sendTooltipOpen}
            onOpenChange={setSendTooltipOpen}
          >
            <Button
              type="submit"
              size="icon-md"
              disabled={!canSend}
              onClick={handleSendButtonClick}
              data-testid={TID_V4_COMPOSER_SEND}
              aria-label={resolvedSendTooltipTitle}
              className="cursor-pointer gap-1 rounded-lg bg-brand text-ui-base text-foreground-inverse hover:bg-brand/80"
            >
              {pending ? <Spinner className="size-4" /> : <ArrowUpIcon className="size-4" />}
              <span className="sr-only">{resolvedSendTooltipTitle}</span>
            </Button>
          </ControlHintTooltip>
        )}
      </div>
    ),
    [
      canSend,
      activeConfigPicker,
      composerPhase,
      composerUsage,
      disabled,
      runtimeBlocked,
      draftConfig,
      draftMode,
      handleStopClick,
      handleSendButtonClick,
      handleConfigPickerOpenChange,
      highspeedCard,
      highspeedEntranceAnimated,
      highspeedPresented,
      highspeedSweepActive,
      isWebRemoteControl,
      mode,
      handleSelectModelTrace,
      modelSelectionReload,
      modelSelectionRefresh,
      modelSelectionState,
      modelSelectionView,
      onSelectThought,
      onRecoverCustomModelSelection,
      onSendCompressionCommand,
      onSwitchMode,
      pending,
      provider,
      modifierTooltip,
      resolvedSendTooltipShortcut,
      resolvedSendTooltipTitle,
      sendTooltipOpen,
      remoteAvailable,
      sendShortcut,
      sendTooltipTitle,
      sessionId,
      showStopControl,
      stopTooltipTitle,
      workspaceIdentity,
      workspacePath,
    ],
  );

  const leadingActionsNode = useMemo(
    () => (
      <>
        <V4ComposerModeSwitch
          workspacePath={workspacePath}
          workspaceIdentity={workspaceIdentity}
          provider={provider}
          draftConfig={draftConfig}
          disabled={disabled || runtimeBlocked}
          activeConfigPicker={activeConfigPicker}
          onConfigPickerOpenChange={handleConfigPickerOpenChange}
          onSwitchMode={onSwitchMode}
        />
        {}
        <V4ComposerCuaEntry
          workspacePath={workspacePath}
          workspaceIdentity={workspaceIdentity}
          remoteSessionId={remoteSessionId}
          isWebRemoteControl={isWebRemoteControl}
          currentSessionBusy={canStop}
        />
        <ConversationBackgroundWorkTrigger
          backgroundWorks={snapshot?.backgroundWorks ?? []}
          runningSubagentCount={runningSubagentCount}
          onOpen={onOpenRunningBackgroundWorks}
          openTarget={backgroundWorkOpenTarget}
        />
      </>
    ),
    [
      activeConfigPicker,
      canStop,
      disabled,
      runtimeBlocked,
      draftConfig,
      handleConfigPickerOpenChange,
      isWebRemoteControl,
      backgroundWorkOpenTarget,
      onOpenRunningBackgroundWorks,
      onSwitchMode,
      provider,
      remoteSessionId,
      runningSubagentCount,
      snapshot?.backgroundWorks,
      workspaceIdentity,
      workspacePath,
    ],
  );
  const isBlockedByInteraction = blockingRequestId !== null;

  return (
    <div
      data-testid={TID_V4_COMPOSER}
      data-input-routing={mode}
      aria-hidden={isBlockedByInteraction ? true : undefined}
      style={isBlockedByInteraction ? { display: "none" } : undefined}
      className={cn(
        "chat-composer-region z-20 w-full shrink-0 @container/composer",
        centered && "max-w-2xl",
      )}
    >
      {}
      <input
        ref={attachmentsApi.attachmentInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={attachmentsApi.handleAttachmentInputChange}
      />
      {visibleError ? (
        <div className="mb-6 w-full shrink-0">
          <ChatErrorBanner
            error={visibleError}
            remoteKind={
              remoteKind?.kind === "workspace" ? remoteKind.remoteTarget?.kind : undefined
            }
            onReconnect={
              reconnectProject || remoteController
                ? () => {
                    const request = reconnectProject
                      ? reconnectProject(workspaceKey)
                      : remoteController?.dispatch({ type: "reconnect-workspace", workspaceKey });
                    void request?.catch((error: unknown) =>
                      logger.warn("[v4-composer] 项目重连失败", { error }),
                    );
                  }
                : undefined
            }
            onDismiss={onDismissError}
            onOpenModelSettings={onOpenModelSettings}
            onOpenUpgrade={onOpenModelUpgrade}
            modelConfigTarget={modelConfigTarget}
          />
        </div>
      ) : null}
      {initialization?.status === "failed" ? (
        <div
          data-testid="v4-session-initialization"
          role="alert"
          className="mb-2 flex w-full flex-wrap items-center gap-2 rounded-lg border border-card-border bg-card px-3 py-2 text-ui-base text-foreground-subtle"
        >
          <span className="min-w-0 flex-1">
            {intl.formatMessage({ id: "chat.initialization.failed" })}
          </span>
          {onRetryInitialization ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="v4-session-initialization-retry"
              onClick={onRetryInitialization}
            >
              {intl.formatMessage({ id: "chat.initialization.retry" })}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div
        data-highspeed-composer={highspeedCard ? "true" : undefined}
        data-highspeed-entrance={highspeedCard ? highspeedEntrance : undefined}
        className={cn(
          "chat-composer-input-surface relative w-full",
          contextHeader && "rounded-2xl bg-surface shadow-xl/5",
          highspeedCard && "highspeed-composer-surface",
          highspeedPresented && "highspeed-placeholder-presented",
        )}
      >
        {highspeedCard ? (
          <HighspeedComposerBackground
            key={highspeedCard.cardId}
            animated={highspeedEntranceAnimated}
            onModelTransitionStart={handleHighspeedModelTransitionStart}
          />
        ) : null}
        {contextHeader ? (
          <div className="relative z-10 p-1.5 flex min-w-0 flex-wrap items-center gap-0">
            <ComposerSubmissionPendingContext.Provider value={updateTargetSelectionPending}>
              {contextHeader}
            </ComposerSubmissionPendingContext.Provider>
          </div>
        ) : null}
        {conversationSelectionLimitReason ? (
          <div
            role="alert"
            className="relative z-10 mb-2 w-full rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-3 py-2 text-ui-base text-foreground"
          >
            {intl.formatMessage({
              id: `chat.selections.limit.${conversationSelectionLimitReason}`,
            })}
          </div>
        ) : null}
        <ChatPromptEditor
          workspacePath={workspacePath}
          workspaceIdentity={workspaceIdentity}
          taskId={sessionId}
          skillCatalogSessionId={skillCatalogSessionId}
          placeholder={
            remoteAvailable
              ? normalPlaceholder
              : intl.formatMessage({ id: "remote.conversation.sendUnavailable" })
          }
          disabled={disabled || mode === "reject"}
          submitting={pending}
          submitDisabled={
            runtimeBlocked || pending || !routingAllowsSend || !attachmentsReady || !submissionReady
          }
          allowSubmitWhenEmpty={
            hasCodeCommentContexts ||
            hasAttachments ||
            hasWebElementContexts ||
            hasPptxElementReferences ||
            hasConversationSelectionReferences ||
            hasPluginUiContexts
          }
          enterSubmits={enterSubmits}
          onModifiedSubmit={modifiedEnterSubmits ? handleModifiedEditorSubmit : undefined}
          submitLabel={sendTooltipTitle}
          showSlashButton
          showMentionButton
          topContent={topContentNode}
          attachmentAction={runtimeBlocked ? undefined : attachmentAction}
          inputTestId={TID_V4_COMPOSER_INPUT}
          inputApiRef={inputApiRef}
          promptHistory={promptHistory}
          avoidIosInputFocusZoom={avoidIosInputFocusZoom}
          compactPlaceholder={compactMobilePlaceholder}
          excludedSlashCommandNames={suppressGoalCommands ? ["goal"] : undefined}
          appSlashCommands={runtimeBlocked ? [] : appSlashCommands}
          enableMentionPanel
          leadingActions={leadingActionsNode}
          submitControl={submitControlNode}
          layout={layout}
          className="p-0"
          shellClassName={
            highspeedCard
              ? "relative z-10 !rounded-none !border-0 !bg-transparent !transition-none hover:!border-transparent focus-within:!border-transparent focus-within:!bg-transparent"
              : undefined
          }
          onChange={handleEditorChange}
          onFocus={handleEditorFocus}
          onSubmit={handleEditorSubmit}
          onWhiteboardMentionSelected={attachmentsApi.handleWhiteboardMentionSelected}
          onPaste={attachmentsApi.handlePaste}
        />
        {attachmentsApi.attachmentError ? (
          <p className="flex items-start gap-2 p-3 text-ui-base text-warning">
            <InfoIcon className="mt-0.5 size-4 shrink-0" />
            <span>{attachmentsApi.attachmentError}</span>
          </p>
        ) : null}
      </div>
      <ImagePreviewDialog
        initialIndex={attachmentPreviewIndex}
        items={composerMediaPreviewItems}
        onOpenChange={setAttachmentPreviewOpen}
        open={attachmentPreviewOpen}
      />
      <ChatMediaAttachmentPreviewDialog
        attachment={pdfAttachmentPreview}
        open={pdfAttachmentPreviewOpen}
        onOpenChange={(open) => {
          setPdfAttachmentPreviewOpen(open);
          if (!open) setPdfAttachmentPreview(null);
        }}
      />
      <Dialog
        open={heldQueueConfirmation !== null}
        onOpenChange={(open) => {
          if (!open && !pendingRef.current) {
            if (heldQueueConfirmation?.telemetrySeed.localTtft)
              getLocalTtftObserver()?.exclude(
                heldQueueConfirmation.telemetrySeed.localTtft,
                "cancelled",
              );
            setHeldQueueConfirmation(null);
          }
        }}
      >
        <DialogContent
          data-testid={TID_V4_PAUSED_QUEUE_SEND_DIALOG}
          showCloseButton={false}
          className="max-w-xl gap-6 p-6 sm:p-8"
        >
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-md"
              disabled={pending}
              aria-label={intl.formatMessage({ id: "common.close" })}
              className="absolute top-4 right-4"
            >
              <XIcon className="size-5" />
            </Button>
          </DialogClose>
          <DialogHeader className="gap-3 pr-8">
            <DialogTitle className="text-xl font-semibold sm:text-2xl">
              {intl.formatMessage({ id: "chat.queue.sendConfirm.title" })}
            </DialogTitle>
            <DialogDescription className="text-ui-base sm:text-ui-lg">
              {intl.formatMessage(
                { id: "chat.queue.sendConfirm.description" },
                {
                  count: String(heldQueueConfirmation?.queueItemIds.length ?? 0),
                },
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-3 sm:gap-3">
            <Button
              type="button"
              variant="destructive"
              size="lg"
              data-testid={TID_V4_COMPOSER_CLEAR_QUEUE_SEND}
              disabled={pending}
              className="min-w-32 rounded-full"
              onClick={handleClearQueueSend}
            >
              {intl.formatMessage({ id: "chat.queue.sendConfirm.clear" })}
            </Button>
            <Button
              type="button"
              size="lg"
              data-testid={TID_V4_COMPOSER_KEEP_QUEUE_SEND}
              disabled={pending}
              className="min-w-32 rounded-full"
              onClick={handleKeepQueueSend}
            >
              {pending ? <Spinner className="size-4" /> : null}
              {intl.formatMessage({ id: "chat.queue.sendConfirm.keep" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export const ConversationComposer = memo(ConversationComposerImpl);
