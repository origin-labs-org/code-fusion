import { BotTopicPreparation } from "@/v4/BotTopicPreparation.js";
import { useBotTopicInterruption } from "@/v4/botGroupDeliveryContext.js";
import { ConnectedBotGroupDeliveryAction } from "@/v4/BotGroupDeliveryAction.js";

import { useIsOfficeMode } from "@/hooks/useInterfaceMode.js";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { ChevronRightIcon, EyeIcon } from "lucide-react";
import { type HighspeedMessageMeta, type CfApiRetryStatus } from "@origin-ai/cf-shared";
import {
  TID_CHAT_ASSISTANT_HISTORY_CONTENT,
  TID_CHAT_ASSISTANT_HISTORY_TRIGGER,
  TID_CHAT_BACKGROUND_RESULT_TITLE,
  TID_CHAT_LOADING,
  TID_V4_ROW,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import type {
  ApiRetryState,
  AttachmentRef,
  CommandAck,
  ConversationRowTarget,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { ChatLoading } from "@/components/ai-elements/chat-loading.js";
import { ChatApiRetryStatus } from "@/chat-input-toolbar/display.js";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { MessageActions } from "@/components/ai-elements/message.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible.js";
import { ToolCallBlock } from "@/ToolCallBlocks.js";
import {
  CronCreateAutomationCard,
  isCronAutomationCardToolCall,
  readCronCreateAutomationSummary,
  type CronCreateAutomationSummary,
} from "@/ToolCallBlocks/renderers/cron-create.js";
import {
  isOffPeakCreateToolCall,
  OffPeakCreateTaskCard,
  readOffPeakCreateTaskSummary,
  type OffPeakCreateTaskSummary,
} from "@/ToolCallBlocks/renderers/offpeak-create.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { HighspeedShareDialog } from "@/highspeed/HighspeedShareNoticeCard.js";
import { isHighspeedShareEligible } from "@/highspeed/highspeedShare.js";
import {
  aggregateHighspeedCardMetrics,
  getHighspeedTurnByCommandId,
  getHighspeedTurnVersion,
  subscribeHighspeedTurns,
  type HighspeedShareMetrics,
} from "@/highspeed/highspeedTurnStore.js";
import type { AssistantPreviewCard } from "@/lib/assistantPreviewCards.js";
import { useAssistantCodeCommentFeatureEnabled } from "@/AssistantCodeCommentFeatureProvider.js";
import {
  buildAssistantCodeCommentCards,
  projectAssistantCodeComments,
  type AssistantCodeCommentCard,
} from "@/lib/assistantCodeComment.js";
import { useAssistantPreviewCardsForAssistantTextRow } from "@/v4/useAssistantPreviewCardsForRow.js";
import { shouldShowTurnChatLoading } from "@/v4/chatLoadingVisibility.js";
import {
  buildAssistantWorkRenderItems,
  ENABLE_CHANGES_TOOL_CALL_GROUPING,
  ENABLE_CUA_TOOL_CALL_GROUPING,
  ENABLE_EXPLORE_TOOL_CALL_GROUPING,
  ENABLE_TERMINAL_TOOL_CALL_GROUPING,
  type ConversationAssistantWorkRenderItem,
} from "@/v4/conversationAssistantWorkItems.js";
import type { ConversationCuaGroupEvent } from "@/v4/conversationCuaGroups.js";
import { ConversationAgentToolCallRow } from "@/v4/ConversationAgentToolCallRow.js";
import { ConversationFileSummaryPanel } from "@/v4/ConversationFileSummaryPanel.js";
import {
  WorkflowNotificationToolRow,
  workflowRowNotification,
  type WorkflowRowNotification,
} from "@/v4/WorkflowNotificationToolRow.js";
import { ConversationWorkflowDigests } from "@/v4/ConversationWorkflowDigests.js";
import { ConversationWorkflowCompletion } from "@/v4/ConversationWorkflowCompletion.js";
import { resolveWorkflowTurnDigests } from "@/v4/workflowTurnDigests.js";
import { resolveWorkflowTurnCompletion } from "@/v4/workflowTurnCompletion.js";
import { ConversationAssistantTextActions } from "@/v4/ConversationRowView.js";
import { readAssistantFeedback } from "@/v4/ConversationRowView.js";
import type {
  AssistantFeedbackHandler,
  EditWorkspaceRewindAvailability,
} from "@/v4/ConversationRowView.js";
import {
  isConversationReasoningRowVisible,
  type ConversationRowRenderContext,
} from "@/v4/conversationRowContext.js";
import type {
  AssistantWorkRow,
  ConversationTurnFlowItem,
  ConversationTurnRenderUnit,
  ConversationTurnWorkSegment,
} from "@/v4/conversationTurnRenderUnits.js";
import { formatConversationWorkDuration } from "@/v4/conversationWorkDuration.js";
import { ConversationTurnRow, resolveAssistantCopyText } from "@/v4/ConversationTurnRow.js";
import { ConversationHookDetailsAction } from "@/v4/ConversationHookDetailsAction.js";
import { toolCallRowToLegacyNode } from "@/v4/toolCallRowAdapter.js";

interface ConversationTurnGroupProps {
  unit: ConversationTurnRenderUnit;
  
  nowMs?: number;
  
  apiRetry?: ApiRetryState | null;
  context: ConversationRowRenderContext;
  onFork?: (target: ConversationRowTarget) => void;
  onRetry?: (target: ConversationRowTarget) => void;
  onFeedbackChange?: AssistantFeedbackHandler;
  onEdit?: (
    target: ConversationRowTarget,
    newText: string,
    attachments?: readonly AttachmentRef[],
    workspaceMode?: "preserve" | "rewind",
  ) => Promise<CommandAck | boolean | void> | CommandAck | boolean | void;
}

interface CronAutomationTurnCard {
  rowId: number;
  toolCallId: string;
  automation: CronCreateAutomationSummary;
}

interface OffPeakTurnCard {
  rowId: number;
  toolCallId: string;
  task: OffPeakCreateTaskSummary;
}

const MIN_VISIBLE_API_RETRY_ATTEMPT = 3;

interface HighspeedOutputFooterProps {
  generatedLabel: string;
  shareLabel: string;
  shareAriaLabel: string;
  shareEnabled: boolean;
  sharePending: boolean;
  onShare: () => void;
}

function HighspeedOutputFooter({
  generatedLabel,
  shareLabel,
  shareAriaLabel,
  shareEnabled,
  sharePending,
  onShare,
}: HighspeedOutputFooterProps) {
  return (
    <div
      data-highspeed-output-footer="true"
      className="relative flex w-full items-center justify-center py-[18px] opacity-80"
    >
      <div aria-hidden="true" className="absolute inset-x-0 top-1/2 border-t border-border" />
      <div className="relative flex items-center gap-2 bg-background px-3">
        <span className="text-ui-base text-foreground-subtle">{generatedLabel}</span>
        {shareEnabled ? (
          <Button
            type="button"
            variant="ghost"
            size="default"
            className="h-7 gap-1 rounded-[8px] bg-black/5 px-2 py-1 text-ui-base font-medium leading-5 text-foreground hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10"
            data-highspeed-output-share="true"
            disabled={sharePending}
            aria-label={shareAriaLabel}
            onClick={onShare}
          >
            <EyeIcon
              className="size-4 text-foreground/85"
              strokeWidth={4 / 3}
              aria-hidden="true"
              data-highspeed-output-share-icon="true"
            />
            {shareLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function toRetryStatus(apiRetry: ApiRetryState): CfApiRetryStatus {
  const attempt = Math.max(1, Math.floor(apiRetry.attempt));
  const maxRetries = Math.max(Math.floor(apiRetry.maxAttempts) - 1, attempt);
  return {
    kind: "api_retry",
    attempt,
    maxRetries,
    retryDelayMs: 0,
    errorStatus: null,
    error: apiRetry.reasonCode,
  };
}

function TurnChatLoadingSlot({
  apiRetry,
  eligible,
}: {
  apiRetry: ApiRetryState | null;
  eligible: boolean;
}) {
  const { intl, locale } = useCfIntl();
  const retryStatus = useMemo(() => (apiRetry ? toRetryStatus(apiRetry) : null), [apiRetry]);
  const visibleRetryStatus =
    retryStatus && retryStatus.attempt >= MIN_VISIBLE_API_RETRY_ATTEMPT ? retryStatus : null;
  if (!visibleRetryStatus && !eligible) return null;
  return (
    <div data-cf-chat-loading-slot="true" className="min-h-5">
      {visibleRetryStatus ? (
        <ChatApiRetryStatus apiRetry={visibleRetryStatus} intl={intl} locale={locale} />
      ) : (
        <ChatLoading loading data-testid={TID_CHAT_LOADING} size="sm" />
      )}
    </div>
  );
}

function ConversationExploreGroupRow({
  item,
  context,
}: {
  item: Extract<ConversationAssistantWorkRenderItem, { kind: "exploreGroup" }>;
  context: ConversationRowRenderContext;
}) {
  return (
    <div
      data-row-id={item.rowId}
      data-conversation-selectable="true"
      data-testid={testId(TID_V4_ROW, String(item.rowId))}
    >
      <ToolCallBlock
        toolCallNode={item.node}
        workspacePath={context.workspacePath}
        theme={context.theme}
        codePreviewSettings={context.codePreviewSettings}
        showTodoToolCalls={context.messageStreamShowTodos === true}
        onOpenCodeViewer={context.onOpenCodeViewer}
        onOpenFileLink={context.onOpenFileLink}
        onOpenBrowserUrl={context.onOpenBrowserUrl}
        onOpenAutomationsMain={context.onOpenAutomationsMain}
      />
    </div>
  );
}

function ConversationToolGroupRow({
  item,
  context,
}: {
  item: Extract<
    ConversationAssistantWorkRenderItem,
    { kind: "cuaGroup" | "executeGroup" | "changesGroup" }
  >;
  context: ConversationRowRenderContext;
}) {
  const renderAssistantMessage = useCallback(
    (event: Extract<ConversationCuaGroupEvent, { kind: "assistantMessage" }>) => (
      <ConversationTurnRow
        row={event.row}
        context={context}
        hideAssistantActions
        assistantCodeCommentProjectionEnabled={false}
      />
    ),
    [context],
  );
  const renderReasoning = useCallback(
    (event: Extract<ConversationCuaGroupEvent, { kind: "reasoning" }>) => (
      <ConversationTurnRow row={event.row} context={context} reasoningContentVariant="nested" />
    ),
    [context],
  );
  const visibleCuaEvents = useMemo(
    () =>
      item.kind === "cuaGroup"
        ? item.events.filter(
            (event) =>
              event.kind !== "reasoning" ||
              isConversationReasoningRowVisible(event.row.rowId, context),
          )
        : undefined,
    [context, item],
  );
  return (
    <div
      data-row-id={item.rowId}
      data-conversation-selectable="true"
      data-testid={testId(TID_V4_ROW, String(item.rowId))}
    >
      <ToolCallBlock
        toolCallNode={item.node}
        workspacePath={context.workspacePath}
        theme={context.theme}
        codePreviewSettings={context.codePreviewSettings}
        showTodoToolCalls={context.messageStreamShowTodos === true}
        onOpenCodeViewer={context.onOpenCodeViewer}
        onOpenFileLink={context.onOpenFileLink}
        onOpenBrowserUrl={context.onOpenBrowserUrl}
        onOpenAutomationsMain={context.onOpenAutomationsMain}
        cuaGroupEvents={visibleCuaEvents}
        renderCuaAssistantMessage={item.kind === "cuaGroup" ? renderAssistantMessage : undefined}
        renderCuaReasoning={item.kind === "cuaGroup" ? renderReasoning : undefined}
      />
    </div>
  );
}

function ConversationCuaGroupRow({
  item,
  context,
}: {
  item: Extract<ConversationTurnFlowItem, { kind: "cuaGroup" }>;
  context: ConversationRowRenderContext;
}) {
  const renderAssistantMessage = useCallback(
    (event: Extract<(typeof item.events)[number], { kind: "assistantMessage" }>) => (
      <ConversationTurnRow
        row={event.row}
        context={context}
        hideAssistantActions
        assistantCodeCommentProjectionEnabled={false}
      />
    ),
    [context],
  );
  const renderReasoning = useCallback(
    (event: Extract<(typeof item.events)[number], { kind: "reasoning" }>) => (
      <ConversationTurnRow row={event.row} context={context} reasoningContentVariant="nested" />
    ),
    [context],
  );
  const visibleCuaEvents = useMemo(
    () =>
      item.events.filter(
        (event) =>
          event.kind !== "reasoning" || isConversationReasoningRowVisible(event.row.rowId, context),
      ),
    [context, item.events],
  );
  return (
    <div
      data-row-id={item.rowId}
      data-conversation-selectable="true"
      data-testid={testId(TID_V4_ROW, String(item.rowId))}
    >
      <ToolCallBlock
        toolCallNode={item.node}
        workspacePath={context.workspacePath}
        theme={context.theme}
        codePreviewSettings={context.codePreviewSettings}
        showTodoToolCalls={context.messageStreamShowTodos === true}
        onOpenCodeViewer={context.onOpenCodeViewer}
        onOpenFileLink={context.onOpenFileLink}
        onOpenBrowserUrl={context.onOpenBrowserUrl}
        onOpenAutomationsMain={context.onOpenAutomationsMain}
        cuaGroupEvents={visibleCuaEvents}
        renderCuaAssistantMessage={renderAssistantMessage}
        renderCuaReasoning={renderReasoning}
      />
    </div>
  );
}

function ConversationAssistantWorkItems({
  rows,
  context,
  stageTailIsRunning = false,
  assistantCodeCommentProjectionEnabled = false,
  historyContainer,
}: {
  rows: readonly AssistantWorkRow[];
  context: ConversationRowRenderContext;
  stageTailIsRunning?: boolean;
  
  assistantCodeCommentProjectionEnabled?: boolean;
  historyContainer?: {
    chunkKey: string;
    open: boolean;
  };
}) {
  const showReasoning = context.messageStreamShowReasoning === true;
  const firstReasoningRowId = context.messageStreamFirstReasoningRowId;
  const items = useMemo(
    () =>
      buildAssistantWorkRenderItems(
        rows,
        {
          messageStreamShowReasoning: showReasoning,
          ...(firstReasoningRowId !== undefined
            ? { messageStreamFirstReasoningRowId: firstReasoningRowId }
            : {}),
        },
        {
          stageTailIsRunning,
          enableCuaGrouping: ENABLE_CUA_TOOL_CALL_GROUPING,
          enableExploreGrouping:
            context.toolGroupingExploreEnabled ?? ENABLE_EXPLORE_TOOL_CALL_GROUPING,
          enableTerminalGrouping:
            context.toolGroupingTerminalEnabled ?? ENABLE_TERMINAL_TOOL_CALL_GROUPING,
          enableChangesGrouping:
            context.toolGroupingChangesEnabled ?? ENABLE_CHANGES_TOOL_CALL_GROUPING,
        },
      ),
    [
      context.toolGroupingChangesEnabled,
      context.toolGroupingExploreEnabled,
      context.toolGroupingTerminalEnabled,
      stageTailIsRunning,
      firstReasoningRowId,
      rows,
      showReasoning,
    ],
  );

  if (items.length === 0) {
    return null;
  }

  const content = (
    <div className="flex flex-col gap-4">
      {items.map((item) =>
        item.kind === "row" ? (
          <ConversationTurnRow
            key={item.key}
            row={item.row}
            context={context}
            hideAssistantActions={item.row.kind === "assistantText"}
            assistantCodeCommentProjectionEnabled={assistantCodeCommentProjectionEnabled}
          />
        ) : item.kind === "agentToolCall" ? (
          <ConversationAgentToolCallRow key={item.key} item={item} context={context} />
        ) : item.kind === "exploreGroup" ? (
          <ConversationExploreGroupRow key={item.key} item={item} context={context} />
        ) : (
          <ConversationToolGroupRow key={item.key} item={item} context={context} />
        ),
      )}
    </div>
  );

  if (!historyContainer) {
    return content;
  }

  return (
    <CollapsibleContent
      data-testid={testId(TID_CHAT_ASSISTANT_HISTORY_CONTENT, historyContainer.chunkKey)}
      data-history-open={String(historyContainer.open)}
    >
      <div className="pt-5">{content}</div>
    </CollapsibleContent>
  );
}

function resolveCronAutomationTurnCards(
  rows: readonly AssistantWorkRow[],
): CronAutomationTurnCard[] {
  let cards: CronAutomationTurnCard[] = [];

  for (const row of rows) {
    if (row.kind !== "toolCall" || row.status !== "success") {
      continue;
    }

    const normalizedToolName = row.toolName.toLowerCase().replace(/[^a-z0-9]/gu, "");
    if (normalizedToolName === "crondelete") {
      const deletedAutomationId = readCronDeleteAutomationId(row);
      if (deletedAutomationId) {
        cards = cards.filter((card) => card.automation.automationId !== deletedAutomationId);
      }
      continue;
    }

    const node = toolCallRowToLegacyNode(row);
    if (!isCronAutomationCardToolCall(node.toolCall)) {
      continue;
    }

    const automation = readCronCreateAutomationSummary(node.toolCall);
    if (!automation) {
      continue;
    }

    if (automation.automationId) {
      cards = cards.filter((card) => card.automation.automationId !== automation.automationId);
    }
    cards.push({
      rowId: row.rowId,
      toolCallId: row.toolCallId,
      automation,
    });
  }

  return cards;
}

function resolveOffPeakTurnCards(rows: readonly AssistantWorkRow[]): OffPeakTurnCard[] {
  let cards: OffPeakTurnCard[] = [];

  for (const row of rows) {
    if (row.kind !== "toolCall" || row.status !== "success") {
      continue;
    }
    const node = toolCallRowToLegacyNode(row);
    if (!isOffPeakCreateToolCall(node.toolCall)) {
      continue;
    }
    const task = readOffPeakCreateTaskSummary(node.toolCall);
    if (!task) {
      continue;
    }
    if (task.offPeakTaskId) {
      cards = cards.filter((card) => card.task.offPeakTaskId !== task.offPeakTaskId);
    }
    cards.push({
      rowId: row.rowId,
      toolCallId: row.toolCallId,
      task,
    });
  }

  return cards;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return null;
    }
  }
  return typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : null;
}

function readCronDeleteAutomationId(
  row: Extract<AssistantWorkRow, { kind: "toolCall" }>,
): string | undefined {
  for (const candidate of [row.output?.text, row.input, row.inputText]) {
    const record = parseJsonRecord(candidate);
    const id = record?.id;
    if (typeof id === "string" && id.trim()) {
      return id.trim();
    }
  }
  return undefined;
}

function CronAutomationTurnCards({
  cards,
  context,
}: {
  cards: readonly CronAutomationTurnCard[];
  context: ConversationRowRenderContext;
}) {
  if (cards.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      {cards.map((card) => (
        <CronCreateAutomationCard
          key={`${card.rowId}:${card.toolCallId}`}
          automation={card.automation}
          onOpenAutomationsMain={context.onOpenAutomationsMain}
        />
      ))}
    </div>
  );
}

function OffPeakTurnCards({
  cards,
  context,
}: {
  cards: readonly OffPeakTurnCard[];
  context: ConversationRowRenderContext;
}) {
  if (cards.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      {cards.map((card) => (
        <OffPeakCreateTaskCard
          key={`${card.rowId}:${card.toolCallId}`}
          task={card.task}
          onOpenAutomationsMain={context.onOpenAutomationsMain}
        />
      ))}
    </div>
  );
}

function AssistantHistoryStatus({
  segment,
  open,
  highspeed,
  highspeedMeta,
  sourceCommandIds,
}: {
  segment: ConversationTurnWorkSegment;
  open: boolean;
  highspeed: boolean;
  highspeedMeta?: HighspeedMessageMeta;
  sourceCommandIds: readonly string[];
}) {
  const { intl, locale } = useCfIntl();
  const topicInterrupted = useBotTopicInterruption(sourceCommandIds);
  const durationLabel = formatConversationWorkDuration(
    segment.workStatus?.durationMs,
    intl,
    locale,
  );
  const savedDurationLabel =
    segment.workStatus?.state === "completed" &&
    highspeedMeta?.savedDurationMs !== undefined &&
    highspeedMeta.savedDurationMs > 0
      ? formatConversationWorkDuration(highspeedMeta.savedDurationMs, intl, locale)
      : null;
  const label =
    segment.workStatus?.state === "interrupted"
      ? intl.formatMessage({
          id: topicInterrupted ? "chat.history.topicInterrupted" : "chat.history.stopped",
        })
      : segment.workStatus?.state === "running"
        ? intl.formatMessage({ id: "chat.history.workingFor" }, { duration: durationLabel ?? "" })
        : durationLabel
          ? intl.formatMessage({ id: "chat.history.workedFor" }, { duration: durationLabel })
          : intl.formatMessage({ id: "chat.history.worked" });

  return (
    <div
      className={cn(
        "flex w-full flex-wrap items-center justify-between gap-2 border-b",
        highspeed ? "border-icon-purple/30 pb-3 pl-1" : "border-[var(--color-border)]/50 pb-2",
      )}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          data-testid={testId(TID_CHAT_ASSISTANT_HISTORY_TRIGGER, segment.key)}
          data-history-open={String(open)}
          className="group/history-message inline-flex max-w-full items-center gap-2 text-left text-ui-base text-foreground-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-input-border-focused)]"
        >
          <span
            className={cn("truncate", highspeed && "font-medium leading-5 text-icon-purple")}
            data-highspeed-duration={highspeed ? "true" : undefined}
          >
            {label}
          </span>
          {!segment.assistantHistoryDefaultOpen ? (
            <ChevronRightIcon
              aria-hidden
              className={cn(
                "size-4 shrink-0 text-[var(--color-foreground-subtlest)] opacity-70 transition-transform",
                open ? "rotate-90" : "rotate-0",
              )}
            />
          ) : null}
        </button>
      </CollapsibleTrigger>
      {highspeed ? (
        <div className="ml-auto flex shrink-0 items-center gap-2 text-icon-purple">
          {savedDurationLabel ? (
            <span className="text-ui-sm font-medium leading-4" data-highspeed-saved-duration="true">
              {intl.formatMessage(
                { id: "chat.highspeed.savedDuration" },
                { duration: savedDurationLabel },
              )}
            </span>
          ) : null}
          <span
            className="rounded-full bg-hover px-2 py-0.5 text-ui-sm leading-4"
            data-highspeed-status-tag="true"
          >
            {intl.formatMessage({ id: "chat.highspeed.statusTag" })}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function ConversationWorkSegmentFlow({
  segment,
  sourceCommandIds,
  context,
  onFork,
  onRetry,
  onEdit,
  editWorkspaceRewindAvailability,
  assistantCopyText,
  assistantPreviewCards,
  assistantPreviewCardsAutoOpenKey,
  assistantCodeCommentCards,
  assistantCodeCommentProjectionEnabled,
  canForkLatestAssistant,
  canRetryLatestAssistant,
  highspeed,
  highspeedMeta,
}: {
  segment: ConversationTurnWorkSegment;
  sourceCommandIds: readonly string[];
  context: ConversationRowRenderContext;
  onFork?: (target: ConversationRowTarget) => void;
  onRetry?: (target: ConversationRowTarget) => void;
  onEdit?: ConversationTurnGroupProps["onEdit"];
  editWorkspaceRewindAvailability: EditWorkspaceRewindAvailability;
  assistantCopyText?: string;
  assistantPreviewCards: AssistantPreviewCard[];
  assistantPreviewCardsAutoOpenKey?: string;
  assistantCodeCommentCards: AssistantCodeCommentCard[];
  assistantCodeCommentProjectionEnabled: boolean;
  canForkLatestAssistant: boolean;
  canRetryLatestAssistant: boolean;
  highspeed: boolean;
  highspeedMeta?: HighspeedMessageMeta;
}) {
  const [historyOpen, setHistoryOpen] = useState(segment.assistantHistoryDefaultOpen);
  useEffect(() => {
    setHistoryOpen(segment.assistantHistoryDefaultOpen);
  }, [segment.assistantHistoryDefaultOpen, segment.key]);

  const shouldShowHistoryStatus = segment.workStatus !== undefined;
  const firstAssistantFlowItemIndex = segment.flowItems.findIndex(
    (item) => item.kind !== "userInput",
  );
  let historyChunkIndex = 0;
  const open = segment.assistantHistoryDefaultOpen ? true : historyOpen;

  return (
    <Collapsible
      open={open}
      onOpenChange={segment.assistantHistoryDefaultOpen ? undefined : setHistoryOpen}
      className="history-message flex flex-col [&>*+*:not([data-slot='collapsible-content'])]:mt-5"
    >
      {segment.flowItems.map((item, index) => {
        const stageTailIsRunning =
          segment.workStatus?.state === "running" &&
          index === segment.flowItems.length - 1 &&
          (item.kind === "assistantHistory" || item.kind === "assistantWork");
        const showHistoryStatus = shouldShowHistoryStatus && index === firstAssistantFlowItemIndex;
        const itemKey =
          item.kind === "userInput" || item.kind === "assistantText"
            ? `${item.kind}:${item.row.rowId}`
            : `${item.kind}:${item.rows[0]?.rowId ?? index}`;
        let content: React.ReactNode;

        if (item.kind === "userInput") {
          const userRow = (
            <ConversationTurnRow
              row={item.row}
              context={context}
              onEdit={item.row.actions?.canEdit === true ? onEdit : undefined}
              editWorkspaceRewindAvailability={editWorkspaceRewindAvailability}
            />
          );
          content = userRow;
        } else if (item.kind === "cuaGroup") {
          const group = <ConversationCuaGroupRow item={item} context={context} />;
          if (item.flowKind === "assistantHistory") {
            const chunkKey =
              historyChunkIndex === 0 ? segment.key : `${segment.key}:chunk-${historyChunkIndex}`;
            historyChunkIndex += 1;
            content = (
              <CollapsibleContent
                data-testid={testId(TID_CHAT_ASSISTANT_HISTORY_CONTENT, chunkKey)}
                data-history-open={String(open)}
              >
                <div className="pt-5">{group}</div>
              </CollapsibleContent>
            );
          } else {
            content = group;
          }
        } else if (item.kind === "assistantHistory") {
          const chunkKey =
            historyChunkIndex === 0 ? segment.key : `${segment.key}:chunk-${historyChunkIndex}`;
          historyChunkIndex += 1;
          content = (
            <ConversationAssistantWorkItems
              rows={item.rows}
              context={context}
              stageTailIsRunning={stageTailIsRunning}
              assistantCodeCommentProjectionEnabled={assistantCodeCommentProjectionEnabled}
              historyContainer={{ chunkKey, open }}
            />
          );
        } else if (item.kind === "assistantText") {
          content = (
            <ConversationTurnRow
              row={item.row}
              context={context}
              onFork={item.latest && canForkLatestAssistant ? onFork : undefined}
              onRetry={item.latest && canRetryLatestAssistant ? onRetry : undefined}
              hideAssistantActions={!item.latest}
              deferAssistantActions={item.latest}
              assistantCopyText={item.latest ? assistantCopyText : undefined}
              assistantPreviewCards={item.latest ? assistantPreviewCards : undefined}
              assistantPreviewCardsAutoOpenKey={
                item.latest ? assistantPreviewCardsAutoOpenKey : undefined
              }
              assistantCodeCommentCards={item.latest ? assistantCodeCommentCards : undefined}
              assistantCodeCommentProjectionEnabled={assistantCodeCommentProjectionEnabled}
            />
          );
        } else {
          content = (
            <ConversationAssistantWorkItems
              rows={item.rows}
              context={context}
              stageTailIsRunning={stageTailIsRunning}
              assistantCodeCommentProjectionEnabled={assistantCodeCommentProjectionEnabled}
            />
          );
        }

        return (
          <Fragment key={itemKey}>
            {showHistoryStatus ? (
              <AssistantHistoryStatus
                segment={segment}
                open={open}
                highspeed={highspeed}
                highspeedMeta={highspeedMeta}
                sourceCommandIds={sourceCommandIds}
              />
            ) : null}
            {content}
          </Fragment>
        );
      })}
      {shouldShowHistoryStatus && firstAssistantFlowItemIndex < 0 ? (
        <AssistantHistoryStatus
          segment={segment}
          sourceCommandIds={sourceCommandIds}
          open={open}
          highspeed={highspeed}
          highspeedMeta={highspeedMeta}
        />
      ) : null}
    </Collapsible>
  );
}

function ConversationTurnFlow({
  unit,
  apiRetry,
  context,
  onFork,
  onRetry,
  onEdit,
  editWorkspaceRewindAvailability,
  assistantCopyText,
  assistantCodeCommentCards,
  assistantCodeCommentProjectionEnabled,
  assistantPreviewCardsAutoOpenKey,
  highspeed,
  highspeedMeta,
}: {
  unit: ConversationTurnRenderUnit;
  apiRetry: ApiRetryState | null;
  context: ConversationRowRenderContext;
  onFork?: (target: ConversationRowTarget) => void;
  onRetry?: (target: ConversationRowTarget) => void;
  onEdit?: ConversationTurnGroupProps["onEdit"];
  editWorkspaceRewindAvailability: EditWorkspaceRewindAvailability;
  assistantCopyText?: string;
  assistantCodeCommentCards: AssistantCodeCommentCard[];
  assistantCodeCommentProjectionEnabled: boolean;
  assistantPreviewCardsAutoOpenKey?: string;
  highspeed: boolean;
  highspeedMeta?: HighspeedMessageMeta;
}) {
  const showLoading = shouldShowTurnChatLoading({
    blockedByActiveWork: context.chatLoadingBlockedByActiveWork === true,
    blockedByInteraction: context.chatLoadingBlockedByInteraction === true,
    isLastTurn: unit.isLastTurn,
    isRunning: unit.isRunning,
    rows: unit.assistantWorkRows,
  });
  const assistantPreviewCards = useAssistantPreviewCardsForAssistantTextRow({
    row: unit.latestAssistantTextRow,
    assistantTextRows: unit.assistantTextRows,
    latestAssistantTextRow: unit.latestAssistantTextRow,
    workspacePath: context.workspacePath,
    workspaceHomePath: context.workspaceHomePath,
    compactForRemoteControl: context.compactForRemoteControl,
    fileChangesTarget: unit.header?.entityId
      ? { rowId: unit.header.rowId, entityId: unit.header.entityId }
      : null,
    fileChangesState: unit.header?.fileChanges?.state,
    fetchFileChanges: context.fetchFileChanges,
  });

  if (unit.timelineOnly) {
    return (
      <div className="flex flex-col gap-2">
        <ConversationAssistantWorkItems
          rows={unit.assistantWorkRows}
          context={context}
          stageTailIsRunning={unit.isRunning}
          assistantCodeCommentProjectionEnabled={assistantCodeCommentProjectionEnabled}
        />
        <TurnChatLoadingSlot apiRetry={apiRetry} eligible={showLoading} />
      </div>
    );
  }

  const projectedWorkSegments = unit.workSegments ?? [];
  const workSegments: ConversationTurnWorkSegment[] =
    projectedWorkSegments.length > 0
      ? projectedWorkSegments.length === 1
        ? [
            {
              ...projectedWorkSegments[0]!,
              assistantHistoryDefaultOpen: unit.assistantHistoryDefaultOpen,
            },
          ]
        : projectedWorkSegments
      : [
          {
            key: unit.key,
            flowItems: unit.flowItems,
            assistantWorkRows: unit.assistantWorkRows,
            assistantHistoryRows: unit.assistantHistoryRows,
            assistantFollowingRows: unit.assistantFollowingRows,
            assistantHistoryDefaultOpen: unit.assistantHistoryDefaultOpen,
            ...(unit.workStatus ? { workStatus: unit.workStatus } : {}),
          },
        ];
  if (
    workSegments.every(
      (segment) => segment.flowItems.length === 0 && segment.workStatus === undefined,
    ) &&
    !showLoading
  ) {
    return null;
  }

  const latestAssistantTextRow = unit.latestAssistantTextRow;
  const canRetryLatestAssistant = latestAssistantTextRow?.actions?.canRetry === true;
  const canForkLatestAssistant = latestAssistantTextRow?.actions?.canFork === true;

  return (
    <div className="flex flex-col gap-5">
      {workSegments.map((segment) => (
        <ConversationWorkSegmentFlow
          key={segment.key}
          segment={segment}
          sourceCommandIds={[
            ...segment.flowItems.flatMap((item) =>
              item.kind === "userInput" && item.row.sourceCommandId
                ? [item.row.sourceCommandId]
                : [],
            ),
            ...(segment === workSegments[0] && unit.header?.sourceCommandId
              ? [unit.header.sourceCommandId]
              : []),
          ]}
          context={context}
          onFork={onFork}
          onRetry={onRetry}
          onEdit={onEdit}
          editWorkspaceRewindAvailability={editWorkspaceRewindAvailability}
          assistantCopyText={assistantCopyText}
          assistantPreviewCards={assistantPreviewCards}
          assistantPreviewCardsAutoOpenKey={assistantPreviewCardsAutoOpenKey}
          assistantCodeCommentCards={assistantCodeCommentCards}
          assistantCodeCommentProjectionEnabled={assistantCodeCommentProjectionEnabled}
          canForkLatestAssistant={canForkLatestAssistant}
          canRetryLatestAssistant={canRetryLatestAssistant}
          highspeed={highspeed}
          highspeedMeta={highspeedMeta}
        />
      ))}
      <TurnChatLoadingSlot apiRetry={apiRetry} eligible={showLoading} />
    </div>
  );
}

const BACKGROUND_RESULT_TITLE_SOURCES: ReadonlySet<string> = new Set([
  "bash",
  "subagent",
  "workflow",
]);

function resolveBackgroundResultTitle(unit: ConversationTurnRenderUnit): string | undefined {
  if (unit.header?.origin !== "backgroundResult") return undefined;
  const originMeta = unit.header.originMeta;
  if (!originMeta?.workId.trim() || !originMeta.title.trim()) return undefined;
  if (!BACKGROUND_RESULT_TITLE_SOURCES.has(originMeta.backgroundSource)) {
    return undefined;
  }
  return originMeta.title.trim();
}

function resolveWorkflowNotification(
  unit: ConversationTurnRenderUnit,
): WorkflowRowNotification | undefined {
  if (unit.header?.origin !== "backgroundResult") return undefined;
  return workflowRowNotification(unit.header.originMeta);
}

function ConversationBackgroundResultWork({
  unit,
  apiRetry,
  context,
  onFork,
  onRetry,
  title,
  assistantCopyText,
  assistantCodeCommentCards,
  assistantCodeCommentProjectionEnabled,
  assistantPreviewCardsAutoOpenKey,
}: {
  unit: ConversationTurnRenderUnit;
  apiRetry: ApiRetryState | null;
  context: ConversationRowRenderContext;
  onFork?: (target: ConversationRowTarget) => void;
  onRetry?: (target: ConversationRowTarget) => void;
  title: string;
  assistantCopyText?: string;
  assistantCodeCommentCards: AssistantCodeCommentCard[];
  assistantCodeCommentProjectionEnabled: boolean;
  assistantPreviewCardsAutoOpenKey?: string;
}) {
  const hasHistory = unit.assistantHistoryRows.length > 0;
  const hasFollowing = unit.assistantFollowingRows.length > 0;
  const showLoading = shouldShowTurnChatLoading({
    blockedByActiveWork: context.chatLoadingBlockedByActiveWork === true,
    blockedByInteraction: context.chatLoadingBlockedByInteraction === true,
    isLastTurn: unit.isLastTurn,
    isRunning: unit.isRunning,
    rows: unit.assistantWorkRows,
  });
  const latestAssistantTextRow = unit.latestAssistantTextRow;
  const assistantPreviewCards = useAssistantPreviewCardsForAssistantTextRow({
    row: latestAssistantTextRow,
    assistantTextRows: unit.assistantTextRows,
    latestAssistantTextRow,
    workspacePath: context.workspacePath,
    workspaceHomePath: context.workspaceHomePath,
    compactForRemoteControl: context.compactForRemoteControl,
    fileChangesTarget: unit.header?.entityId
      ? { rowId: unit.header.rowId, entityId: unit.header.entityId }
      : null,
    fileChangesState: unit.header?.fileChanges?.state,
    fetchFileChanges: context.fetchFileChanges,
  });

  //
  const workflowNotification = resolveWorkflowNotification(unit);
  const workflowRunId = unit.header?.originMeta?.workId;
  const workflowRunSummary =
    workflowNotification && workflowRunId
      ? context.workflowRunByRunId?.get(workflowRunId)
      : undefined;
  const openWorkflowRun =
    workflowNotification &&
    workflowRunId &&
    context.onOpenWorkflowRun &&
    context.sessionId &&
    workflowRunSummary?.toolCallId
      ? () =>
          context.onOpenWorkflowRun?.({
            parentSessionId: context.sessionId!,
            toolCallId: workflowRunSummary.toolCallId!,
            runId: workflowRunId,
            workflowName: title,
          })
      : undefined;
  const workflowPendingQids =
    workflowNotification && workflowRunId
      ? context.workflowRunPendingQuestionsByRunId?.get(workflowRunId)
      : undefined;
  const openWorkflowArtifact =
    workflowNotification && workflowRunId && context.onOpenWorkflowArtifact && context.sessionId
      ? (artifactId: string) => {
          const contentType =
            workflowNotification.kind === "terminal"
              ? workflowNotification.artifacts?.find((candidate) => candidate.id === artifactId)
                  ?.contentType
              : undefined;
          context.onOpenWorkflowArtifact?.({
            parentSessionId: context.sessionId!,
            runId: workflowRunId,
            artifactId,
            ...(contentType === undefined ? {} : { contentType }),
          });
        }
      : undefined;

  return (
    <div className="flex flex-col gap-5">
      {workflowNotification ? (
        <WorkflowNotificationToolRow
          notification={workflowNotification}
          runName={title}
          testIdKey={unit.key}
          theme={context.theme}
          onOpenRun={openWorkflowRun}
          onOpenArtifact={openWorkflowArtifact}
          pendingQids={workflowPendingQids}
          holes={
            workflowRunSummary?.run === undefined ? undefined : (workflowRunSummary.run.holes ?? [])
          }
        />
      ) : (
        <div className="flex w-full border-b border-[var(--color-border)]/50 pb-2">
          <div
            data-testid={testId(TID_CHAT_BACKGROUND_RESULT_TITLE, unit.key)}
            className="min-w-0 whitespace-pre-wrap break-words text-left text-ui-base text-[var(--color-foreground-subtle)]"
          >
            {title}
          </div>
        </div>
      )}
      {hasHistory ? (
        <div className="flex flex-col gap-2">
          <ConversationAssistantWorkItems
            rows={unit.assistantHistoryRows}
            context={context}
            assistantCodeCommentProjectionEnabled={assistantCodeCommentProjectionEnabled}
          />
        </div>
      ) : null}
      {latestAssistantTextRow ? (
        <ConversationTurnRow
          key={`${latestAssistantTextRow.rowId}:${latestAssistantTextRow.entityId ?? ""}`}
          row={latestAssistantTextRow}
          context={context}
          onFork={latestAssistantTextRow.actions?.canFork === true ? onFork : undefined}
          onRetry={latestAssistantTextRow.actions?.canRetry === true ? onRetry : undefined}
          deferAssistantActions
          assistantCopyText={assistantCopyText}
          assistantPreviewCards={assistantPreviewCards}
          assistantPreviewCardsAutoOpenKey={assistantPreviewCardsAutoOpenKey}
          assistantCodeCommentCards={assistantCodeCommentCards}
          assistantCodeCommentProjectionEnabled={assistantCodeCommentProjectionEnabled}
        />
      ) : null}
      {hasFollowing ? (
        <ConversationAssistantWorkItems
          rows={unit.assistantFollowingRows}
          context={context}
          assistantCodeCommentProjectionEnabled={assistantCodeCommentProjectionEnabled}
        />
      ) : null}
      <TurnChatLoadingSlot apiRetry={apiRetry} eligible={showLoading} />
    </div>
  );
}

function ConversationTurnGroupImpl({
  unit,
  nowMs = Date.now(),
  apiRetry = null,
  context,
  onFork,
  onRetry,
  onFeedbackChange,
  onEdit,
}: ConversationTurnGroupProps) {
  const isOfficeMode = useIsOfficeMode();
  const { intl } = useCfIntl();
  const visibleUserRows = useMemo(() => unit.visibleUserInputs, [unit.visibleUserInputs]);
  useSyncExternalStore(subscribeHighspeedTurns, getHighspeedTurnVersion, getHighspeedTurnVersion);
  const sourceCommandId = unit.header?.sourceCommandId ?? visibleUserRows[0]?.sourceCommandId;
  const highspeedTurn = getHighspeedTurnByCommandId(sourceCommandId);
  const isHighspeed = highspeedTurn !== null || visibleUserRows.some((row) => row.highspeed);
  const highspeedExpiresAt = Math.max(
    highspeedTurn?.card.expiresAt ?? Number.NEGATIVE_INFINITY,
    ...visibleUserRows.flatMap((row) => (row.highspeed ? [row.highspeed.expiresAt] : [])),
  );
  const showHighspeedAnimatedGradient = isHighspeed && unit.isRunning && highspeedExpiresAt > nowMs;
  const highspeedMeta = unit.isRunning
    ? undefined
    : visibleUserRows.find((row) => row.highspeed)?.highspeed;
  const highspeedShareTarget = useMemo(() => {
    let target: { cardId: string; metrics: HighspeedShareMetrics } | null = null;
    if (
      highspeedTurn?.metrics &&
      highspeedTurn.metricsPersistedAt !== undefined &&
      highspeedTurn.metrics.regularTps > 0 &&
      highspeedTurn.metrics.highspeedTps !== undefined &&
      highspeedTurn.metrics.highspeedTps > 0
    ) {
      target = {
        cardId: highspeedTurn.card.cardId,
        metrics: aggregateHighspeedCardMetrics(highspeedTurn.card.cardId),
      };
    } else if (unit.highspeedOutputFooterTarget) {
      target = unit.highspeedOutputFooterTarget;
    } else if (
      highspeedMeta?.outputTokens !== undefined &&
      highspeedMeta.outputTokens > 0 &&
      highspeedMeta.highspeedTps !== undefined &&
      highspeedMeta.highspeedTps > 0 &&
      highspeedMeta.regularTps !== undefined &&
      highspeedMeta.regularTps > 0
    ) {
      target = {
        cardId: highspeedMeta.cardId,
        metrics: {
          outputTokens: highspeedMeta.outputTokens,
          durationMs: highspeedMeta.durationMs ?? 0,
          regularTps: highspeedMeta.regularTps,
          highspeedTps: highspeedMeta.highspeedTps,
          ...(highspeedMeta.savedDurationMs !== undefined
            ? { savedDurationMs: highspeedMeta.savedDurationMs }
            : {}),
        },
      };
    }
    return target && isHighspeedShareEligible(target.metrics) ? target : null;
  }, [highspeedMeta, highspeedTurn, unit.highspeedOutputFooterTarget]);
  const [highspeedShareDialogOpen, setHighspeedShareDialogOpen] = useState(false);
  const firstReasoningRowId = useMemo(
    () => unit.assistantWorkRows.find((row) => row.kind === "reasoning")?.rowId,
    [unit.assistantWorkRows],
  );
  const assistantRowContext = useMemo<ConversationRowRenderContext>(
    () => ({
      ...context,
      ...(firstReasoningRowId !== undefined
        ? { messageStreamFirstReasoningRowId: firstReasoningRowId }
        : {}),
    }),
    [context, firstReasoningRowId],
  );
  const latestAssistantTextRow = unit.latestAssistantTextRow;
  const assistantPreviewPptxAutoOpenTarget = context.assistantPreviewPptxAutoOpenTarget;
  const codeCommentCardsEnabled = useAssistantCodeCommentFeatureEnabled();
  const assistantCodeCommentProjectionEnabled =
    codeCommentCardsEnabled &&
    (unit.isRunning ||
      latestAssistantTextRow?.state === "complete" ||
      latestAssistantTextRow?.state === "interrupted");
  const assistantRawCopyText = useMemo(
    () => resolveAssistantCopyText(unit),
    [unit.assistantTextRows, unit.assistantWorkRows, unit.latestAssistantTextRow],
  );
  const assistantFileSummaryText = useMemo(
    () => unit.assistantTextRows.map((row) => row.text).join("\n\n"),
    [unit.assistantTextRows],
  );
  const assistantCopyText = useMemo(
    () =>
      assistantCodeCommentProjectionEnabled && assistantRawCopyText !== undefined
        ? projectAssistantCodeComments(assistantRawCopyText, {
            streaming: unit.isRunning,
          }).visibleText
        : assistantRawCopyText,
    [assistantRawCopyText, assistantCodeCommentProjectionEnabled, unit.isRunning],
  );
  const assistantCodeCommentCards = useMemo(
    () =>
      codeCommentCardsEnabled &&
      assistantRawCopyText !== undefined &&
      (latestAssistantTextRow?.state === "complete" ||
        latestAssistantTextRow?.state === "interrupted")
        ? buildAssistantCodeCommentCards(assistantRawCopyText, context.workspacePath, 50, {
            homePath: context.workspaceHomePath,
          })
        : [],
    [
      assistantRawCopyText,
      codeCommentCardsEnabled,
      context.workspaceHomePath,
      context.workspacePath,
      latestAssistantTextRow?.state,
    ],
  );
  const cronAutomationTurnCards = useMemo(
    () => (unit.isRunning ? [] : resolveCronAutomationTurnCards(unit.assistantWorkRows)),
    [unit.assistantWorkRows, unit.isRunning],
  );
  const workflowRunByToolCallId = context.workflowRunByToolCallId;
  const workflowRunByRunId = context.workflowRunByRunId;
  const workflowGraphByToolCallId = context.workflowGraphByToolCallId;
  const workflowFillGraphByRunId = context.workflowFillGraphByRunId;
  const workflowTurnDigests = useMemo(
    () =>
      resolveWorkflowTurnDigests(unit, {
        byToolCallId: workflowRunByToolCallId,
        byRunId: workflowRunByRunId,
        graphByToolCallId: workflowGraphByToolCallId,
        fillGraphByRunId: workflowFillGraphByRunId,
      }),
    [
      unit,
      workflowFillGraphByRunId,
      workflowGraphByToolCallId,
      workflowRunByRunId,
      workflowRunByToolCallId,
    ],
  );
  const workflowTurnCompletion = useMemo(
    () =>
      unit.isRunning
        ? undefined
        : resolveWorkflowTurnCompletion(unit.header, { byRunId: workflowRunByRunId }),
    [unit.header, unit.isRunning, workflowRunByRunId],
  );
  const offPeakTurnCards = useMemo(
    () => (unit.isRunning ? [] : resolveOffPeakTurnCards(unit.assistantWorkRows)),
    [unit.assistantWorkRows, unit.isRunning],
  );
  const canRenderAssistantActions =
    !unit.timelineOnly &&
    latestAssistantTextRow?.state === "complete" &&
    assistantCopyText !== undefined;
  const deliverySourceCommandIds = [
    ...(unit.header?.sourceCommandId ? [unit.header.sourceCommandId] : []),
    ...unit.visibleUserInputs.flatMap((row) => (row.sourceCommandId ? [row.sourceCommandId] : [])),
  ];
  const hasHookActions =
    !unit.timelineOnly &&
    !unit.isRunning &&
    unit.hookInvocations.some((row) => row.executions.some((execution) => execution.didExecute));
  const canRetryLatestAssistant = latestAssistantTextRow?.actions?.canRetry === true;
  const canForkLatestAssistant = latestAssistantTextRow?.actions?.canFork === true;
  const backgroundResultTitle = resolveBackgroundResultTitle(unit);
  const showHighspeedOutputFooter =
    unit.showHighspeedOutputFooter === true && isHighspeed && !unit.timelineOnly && !unit.isRunning;
  const hasAssistantWorkContent = unit.timelineOnly
    ? unit.assistantWorkRows.length > 0
    : unit.assistantWorkRows.length > 0 ||
      unit.workSegments?.some((segment) => segment.workStatus?.state === "running") === true ||
      unit.workStatus?.state === "running";
  const hasAssistantTurnContent =
    hasAssistantWorkContent ||
    Boolean(unit.header?.fileChanges) ||
    canRenderAssistantActions ||
    hasHookActions ||
    showHighspeedOutputFooter ||
    workflowTurnDigests.length > 0;
  const editWorkspaceRewindAvailability = useMemo<EditWorkspaceRewindAvailability>(() => {
    const fileChanges = unit.header?.fileChanges;
    if (!fileChanges || fileChanges.files <= 0) return { enabled: false, reason: "noFiles" };
    if (fileChanges.state === "reverted") return { enabled: false, reason: "reverted" };
    if (unit.isRunning) return { enabled: false, reason: "running" };
    if (unit.header?.actions?.canRewindFiles !== true) {
      return { enabled: false, reason: "unavailable" };
    }
    return { enabled: true, reason: "available" };
  }, [unit.header?.actions?.canRewindFiles, unit.header?.fileChanges, unit.isRunning]);

  const startsWithWorkflowNotificationCard =
    backgroundResultTitle !== undefined && resolveWorkflowNotification(unit) !== undefined;
  //
  const startsWithoutUserBubble =
    startsWithWorkflowNotificationCard || unit.workflowLaunch !== undefined;

  return (
    <section
      data-turn-id={unit.turnId}
      data-turn-key={unit.key}
      data-highspeed-gradient={showHighspeedAnimatedGradient ? "true" : undefined}
      className={cn(
        "relative mx-auto flex w-full flex-col gap-5 px-4 @md/conversation:px-6 pb-5",
        startsWithoutUserBubble ? "pt-0" : "pt-14",
        showHighspeedAnimatedGradient && "highspeed-animated-gradient-text",
      )}
    >
      {unit.leadingBoundaryRows.map((row) => (
        <ConversationTurnRow
          key={`${row.rowId}:${row.entityId ?? ""}`}
          row={row}
          context={context}
        />
      ))}
      {hasAssistantTurnContent ? (
        <div className="group/assistant-turn flex w-full flex-col gap-5">
          {backgroundResultTitle ? (
            <>
              {visibleUserRows.map((row) => (
                <ConversationTurnRow
                  key={`${row.rowId}:${row.entityId ?? ""}`}
                  row={row}
                  context={context}
                  onEdit={row.actions?.canEdit === true ? onEdit : undefined}
                  editWorkspaceRewindAvailability={editWorkspaceRewindAvailability}
                />
              ))}
              <ConversationBackgroundResultWork
                unit={unit}
                apiRetry={apiRetry}
                context={assistantRowContext}
                onFork={canForkLatestAssistant ? onFork : undefined}
                onRetry={onRetry}
                title={backgroundResultTitle}
                assistantCopyText={assistantCopyText}
                assistantCodeCommentCards={assistantCodeCommentCards}
                assistantCodeCommentProjectionEnabled={assistantCodeCommentProjectionEnabled}
                assistantPreviewCardsAutoOpenKey={
                  assistantPreviewPptxAutoOpenTarget?.turnId === unit.turnId
                    ? assistantPreviewPptxAutoOpenTarget.key
                    : undefined
                }
              />
            </>
          ) : (
            <ConversationTurnFlow
              unit={unit}
              apiRetry={apiRetry}
              context={assistantRowContext}
              onFork={canForkLatestAssistant ? onFork : undefined}
              onRetry={onRetry}
              onEdit={onEdit}
              editWorkspaceRewindAvailability={editWorkspaceRewindAvailability}
              assistantCopyText={assistantCopyText}
              assistantCodeCommentCards={assistantCodeCommentCards}
              assistantCodeCommentProjectionEnabled={assistantCodeCommentProjectionEnabled}
              highspeed={isHighspeed}
              highspeedMeta={highspeedMeta}
              assistantPreviewCardsAutoOpenKey={
                assistantPreviewPptxAutoOpenTarget?.turnId === unit.turnId
                  ? assistantPreviewPptxAutoOpenTarget.key
                  : undefined
              }
            />
          )}
          {}
          {workflowTurnCompletion === undefined ? null : (
            <ConversationWorkflowCompletion
              completion={workflowTurnCompletion}
              context={context}
              turnKey={unit.key}
            />
          )}
          {}
          <ConversationWorkflowDigests
            context={context}
            digests={workflowTurnDigests}
            turnKey={unit.key}
          />
          {}
          <CronAutomationTurnCards cards={cronAutomationTurnCards} context={context} />
          <OffPeakTurnCards cards={offPeakTurnCards} context={context} />
          {!isOfficeMode && unit.header?.fileChanges ? (
            <ConversationFileSummaryPanel
              header={unit.header}
              context={context}
              assistantText={assistantFileSummaryText}
            />
          ) : null}
          {unit.browserTurnEndRows.length > 0 ? (
            <ConversationAssistantWorkItems
              rows={unit.browserTurnEndRows}
              context={assistantRowContext}
              assistantCodeCommentProjectionEnabled={assistantCodeCommentProjectionEnabled}
            />
          ) : null}
          {canRenderAssistantActions && latestAssistantTextRow ? (
            <ConversationAssistantTextActions
              rowId={latestAssistantTextRow.rowId}
              entityId={latestAssistantTextRow.entityId}
              text={assistantCopyText}
              createdAt={latestAssistantTextRow.createdAt}
              compactForRemoteControl={context.compactForRemoteControl}
              feedback={readAssistantFeedback(latestAssistantTextRow)}
              sessionId={context.sessionId}
              onFork={canForkLatestAssistant ? onFork : undefined}
              onRetry={canRetryLatestAssistant ? onRetry : undefined}
              onFeedbackChange={onFeedbackChange}
              hookInvocations={unit.hookInvocations}
              turnId={unit.turnId}
              sourceCommandIds={deliverySourceCommandIds}
              className={cn(
                "flex items-center gap-1",
                context.compactForRemoteControl
                  ? "opacity-100"
                  : "opacity-0 transition-opacity group-hover/assistant-turn:opacity-100 focus-within:opacity-100 has-[[data-bot-group-delivery]]:opacity-100",
              )}
            />
          ) : (hasHookActions || !unit.isRunning) && !canRenderAssistantActions ? (
            <MessageActions
              className={cn(
                context.compactForRemoteControl
                  ? "opacity-100"
                  : "opacity-0 transition-opacity group-hover/assistant-turn:opacity-100 focus-within:opacity-100 has-[[data-bot-group-delivery]]:opacity-100",
              )}
            >
              {hasHookActions ? (
                <ConversationHookDetailsAction rows={unit.hookInvocations} turnId={unit.turnId} />
              ) : null}
              <ConnectedBotGroupDeliveryAction
                turnId={unit.turnId}
                sourceCommandIds={deliverySourceCommandIds}
              />
            </MessageActions>
          ) : null}
          {showHighspeedOutputFooter ? (
            <HighspeedOutputFooter
              generatedLabel={intl.formatMessage({ id: "chat.highspeed.generatedBy" })}
              shareLabel={intl.formatMessage({ id: "chat.highspeed.viewAction" })}
              shareAriaLabel={intl.formatMessage({ id: "chat.highspeed.share" })}
              shareEnabled={highspeedShareTarget !== null}
              sharePending={false}
              onShare={() => setHighspeedShareDialogOpen(true)}
            />
          ) : null}
          {highspeedShareTarget ? (
            <HighspeedShareDialog
              metrics={highspeedShareTarget.metrics}
              open={highspeedShareDialogOpen}
              onOpenChange={setHighspeedShareDialogOpen}
            />
          ) : null}
          {unit.assistantTailRows.length > 0 ? (
            <ConversationAssistantWorkItems
              rows={unit.assistantTailRows}
              context={assistantRowContext}
              assistantCodeCommentProjectionEnabled={assistantCodeCommentProjectionEnabled}
            />
          ) : null}
        </div>
      ) : (
        <ConversationTurnFlow
          unit={unit}
          apiRetry={apiRetry}
          context={assistantRowContext}
          onEdit={onEdit}
          editWorkspaceRewindAvailability={editWorkspaceRewindAvailability}
          assistantCopyText={assistantCopyText}
          assistantCodeCommentCards={assistantCodeCommentCards}
          assistantCodeCommentProjectionEnabled={assistantCodeCommentProjectionEnabled}
          highspeed={isHighspeed}
          highspeedMeta={highspeedMeta}
        />
      )}
      {unit.topicPreparations?.length ? (
        <BotTopicPreparation items={unit.topicPreparations} />
      ) : null}
    </section>
  );
}

export const ConversationTurnGroup = memo(ConversationTurnGroupImpl);
