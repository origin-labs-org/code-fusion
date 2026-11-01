
import { useIsOfficeMode } from "@/hooks/useInterfaceMode.js";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  ActivityIcon,
  ArrowRightIcon,
  BotIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckBigIcon,
  CircleIcon,
  EllipsisIcon,
  FileDiffIcon,
  GoalIcon,
  ListChecksIcon,
  Maximize2Icon,
  Minimize2Icon,
  PauseIcon,
  PlayIcon,
  SquareIcon,
  SquareTerminalIcon,
  Workflow,
} from "lucide-react";
import {
  TID_CHAT_SUMMARY_PANEL,
  TID_V4_BACKGROUND_WORK_CANCEL,
  TID_V4_BACKGROUND_WORK_ITEM,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import type {
  GitChangeSourceId,
  GitRepositorySummary,
  CfSessionRunningSubagent,
  CfTaskChangeSummary,
} from "@origin-ai/cf-shared";
import type {
  BackgroundWorkSummary,
  GoalState,
  PlanState,
  ToolCallRow,
  WorkflowRunState,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { RUN_STATUS_DOT } from "@/components/workflow-graph/run-status-presentation.js";
import { WorkflowRunRail } from "@/components/workflow-run-line/WorkflowRunRail.js";
import { foldWorkflowRunRail } from "@/lib/workflowRunLine.js";
import { useNowTicker } from "@/components/workflow-graph/use-now-ticker.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { formatBackgroundTaskElapsedLabel } from "@/BackgroundTaskElapsedLabel.js";
import { GitActionMenu } from "@/GitActionMenu.js";
import { GitBranchSwitcher } from "@/GitBranchSwitcher.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import type {
  OpenPlanDetailSideTabRequest,
  OpenSubagentDirectorySideTabRequest,
  OpenSubagentSideTabRequest,
  OpenWorkflowRunDirectorySideTabRequest,
} from "@/lib/workspaceSidePane.js";
import type { ChatViewSummaryPanelVariant } from "@/v4/legacyChatViewTypes.js";
import { resolveConversationStatusPanelVariant } from "@/v4/conversationLayout.js";
import {
  buildConversationStatusPanelModel,
  type ConversationStatusPanelRunningSubagent,
  type ConversationStatusPanelModel,
  type ConversationStatusPanelSessionPlanItem,
  type ConversationStatusPanelWorkflowRun,
} from "@/v4/conversationStatusPanelModel.js";
import type { ConversationStatusPanelWorkflowRunTarget } from "@/v4/conversationStatusPanelModel.js";
import {
  workflowRunOpenTarget,
  workflowRunWords,
  type ConversationStatusPanelWorkflowRunWords,
} from "@/v4/conversationStatusPanelModel.js";
import {
  buildConversationGoalIterationSummaries,
  getConversationGoalElapsedSeconds,
} from "@/v4/conversationGoalSummaryModel.js";

export interface ConversationStatusPanelProps {
  workspacePath: string;
  workspaceIdentity?: string;
  gitSummary?: GitRepositorySummary | null;
  gitDirtyFileCount?: number;
  gitWorktreeReviewSourceId?: GitChangeSourceId | null;
  gitWorktreeChangeSummary?: { added: number; removed: number } | null;
  activeTaskChangeSummary?: CfTaskChangeSummary | null;
  goal?: GoalState | null;
  sessionPlans?: readonly ToolCallRow[];
  plan?: PlanState | null;
  backgroundWorks?: readonly BackgroundWorkSummary[];
  runningSubagents?: readonly CfSessionRunningSubagent[];
  
  workflowRuns?: readonly WorkflowRunState[];
  
  endedWorkflowRunCount?: number;
  endedSubagentCount?: number;
  rootSessionId?: string;
  parentSessionId?: string;
  
  isWebRemoteControl?: boolean;
  
  isMobileViewport?: boolean;
  layoutMode?: "none" | "auto" | "inline";
  summaryPanelVariantOverride?: ChatViewSummaryPanelVariant | null;
  onVariantChange?: (variant: ChatViewSummaryPanelVariant | null) => void;
  terminalSectionOpen?: boolean;
  onTerminalSectionOpenChange?: (open: boolean) => void;
  agentSectionOpen?: boolean;
  onAgentSectionOpenChange?: (open: boolean) => void;
  workflowSectionOpen?: boolean;
  onWorkflowSectionOpenChange?: (open: boolean) => void;
  onRefreshGit?: () => void;
  onOpenGitReview?: (sourceId?: GitChangeSourceId) => void;
  onPauseGoal?: () => void;
  onResumeGoal?: () => void;
  onOpenPlanDetail?: (request: OpenPlanDetailSideTabRequest) => void;
  onOpenBackgroundBash?: (work: BackgroundWorkSummary) => void;
  onCancelBackgroundWork?: (workId: string) => void;
  onOpenSubagentSession?: (request: OpenSubagentSideTabRequest) => void;
  onOpenSubagentDirectory?: (request: OpenSubagentDirectorySideTabRequest) => void;
  onOpenWorkflowRun?: (target: ConversationStatusPanelWorkflowRunTarget) => void;
  onOpenWorkflowRunDirectory?: (request: OpenWorkflowRunDirectorySideTabRequest) => void;
  className?: string;
}

const EMPTY_BACKGROUND_WORKS: readonly BackgroundWorkSummary[] = [];
const EMPTY_RUNNING_SUBAGENTS: readonly CfSessionRunningSubagent[] = [];
const EMPTY_WORKFLOW_RUNS: readonly WorkflowRunState[] = [];

function formatDurationUnits(
  totalSeconds: number,
  formatMessage: ReturnType<typeof useCfIntl>["intl"]["formatMessage"],
) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const restSeconds = seconds % 60;
  const hourUnit = formatMessage({ id: "chat.summaryPanel.duration.hours" });
  const minuteUnit = formatMessage({ id: "chat.summaryPanel.duration.minutes" });
  const secondUnit = formatMessage({ id: "chat.summaryPanel.duration.seconds" });
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours}${hourUnit}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}${minuteUnit}`);
  }
  if (restSeconds > 0 || parts.length === 0) {
    parts.push(`${restSeconds}${secondUnit}`);
  }
  return parts.join(" ");
}

function getBackgroundWorkElapsedMs(work: BackgroundWorkSummary, now: number) {
  return Math.max(0, now - work.startedAt);
}

function getLongestRunningWorkElapsedMs(works: readonly BackgroundWorkSummary[], now: number) {
  return works.reduce(
    (longestElapsedMs, work) => Math.max(longestElapsedMs, getBackgroundWorkElapsedMs(work, now)),
    0,
  );
}

function formatRunningCount(
  formatMessage: ReturnType<typeof useCfIntl>["intl"]["formatMessage"],
  count: number,
) {
  return formatMessage(
    {
      id:
        count === 1
          ? "chat.summaryPanel.runningBackgroundTasksMiniValue"
          : "chat.summaryPanel.runningBackgroundTasksMiniValuePlural",
    },
    { count: String(count) },
  );
}

function formatRunningSubagentCount(
  formatMessage: ReturnType<typeof useCfIntl>["intl"]["formatMessage"],
  count: number,
) {
  return formatMessage(
    {
      id:
        count === 1
          ? "chat.statusPanel.runningAgentsValue"
          : "chat.statusPanel.runningAgentsValuePlural",
    },
    { count: String(count) },
  );
}

type StatusSectionKind =
  | "environment"
  | "goal"
  | "sessionPlans"
  | "plan"
  | "terminal"
  | "workflow"
  | "agent";

const STATUS_SECTION_SCROLL_POLICY = {
  environment: null,
  goal: "max-h-48",
  sessionPlans: "max-h-48",
  plan: "max-h-80",
  terminal: "max-h-48",
  workflow: "max-h-[12.25rem]",
  agent: "max-h-48",
} as const satisfies Record<StatusSectionKind, string | null>;

function StatusSectionHeader({
  children,
  isOpen,
  section,
  title,
}: {
  children?: ReactNode;
  isOpen: boolean;
  section: StatusSectionKind;
  title: string;
}) {
  return (
    <div className="mb-0.5 flex h-8 min-w-0 shrink-0 items-center gap-1.5 px-2 pr-8">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          aria-expanded={isOpen}
          data-status-section-trigger={section}
          className="group flex min-w-0 shrink-0 items-center gap-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-input-border-focused)]"
        >
          <span className="shrink-0 text-ui-base text-[var(--color-foreground-subtle)]">
            {title}
          </span>
          {isOpen ? (
            <ChevronDownIcon className="size-3.5 shrink-0 text-[var(--color-foreground-subtle)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          ) : (
            <ChevronRightIcon className="size-3.5 shrink-0 text-[var(--color-foreground-subtle)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          )}
        </button>
      </CollapsibleTrigger>
      {children ? (
        <div className="inline-flex min-w-0 max-w-full shrink items-center gap-1.5 text-ui-sm text-[var(--color-foreground-subtlest)]">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function StatusSection({
  children,
  defaultOpen = true,
  footer,
  onOpenChange,
  open,
  separated = false,
  section,
  title,
  trailing,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  
  footer?: ReactNode;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  separated?: boolean;
  section: StatusSectionKind;
  title: string;
  trailing?: (isOpen: boolean) => ReactNode;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = open ?? uncontrolledOpen;
  const scrollViewportMaxHeightClass = STATUS_SECTION_SCROLL_POLICY[section];
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange],
  );

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={handleOpenChange}
      data-status-section={section}
      className={cn("min-w-0 flex-none", separated && "border-t border-[var(--color-border)] pt-2")}
    >
      <section className="min-w-0 flex-none">
        <StatusSectionHeader isOpen={isOpen} section={section} title={title}>
          {trailing?.(isOpen)}
        </StatusSectionHeader>
        <CollapsibleContent>
          {scrollViewportMaxHeightClass ? (
            <div
              data-status-section-scroll={section}
              className={cn(
                scrollViewportMaxHeightClass,
                "min-h-0 overflow-x-hidden overflow-y-auto pr-1",
              )}
            >
              {children}
            </div>
          ) : (
            children
          )}
          {footer}
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

function GitStatusSection({
  activeTaskChangeSummary,
  gitSummary,
  gitWorktreeReviewSourceId,
  model,
  onOpenGitReview,
  onRefreshGit,
  separated,
  workspaceIdentity,
  workspacePath,
  useVerticalFloatingPanels,
}: {
  activeTaskChangeSummary?: CfTaskChangeSummary | null;
  gitSummary: GitRepositorySummary | null | undefined;
  gitWorktreeReviewSourceId?: GitChangeSourceId | null;
  model: ConversationStatusPanelModel;
  onOpenGitReview?: (sourceId?: GitChangeSourceId) => void;
  onRefreshGit?: () => void;
  separated: boolean;
  workspaceIdentity?: string;
  workspacePath: string;
  useVerticalFloatingPanels: boolean;
}) {
  const { intl } = useCfIntl();
  const git = model.git;
  if (!git || !gitSummary || !onRefreshGit) {
    return null;
  }
  const hasChanges = git.added + git.removed > 0;
  const canOpenReview = Boolean(onOpenGitReview && gitSummary.isRepository);

  return (
    <StatusSection
      section="environment"
      separated={separated}
      title={intl.formatMessage({ id: "chat.statusPanel.environment" })}
      trailing={(isOpen) =>
        isOpen ? null : (
          <span className="shrink-0 font-mono text-ui-sm tabular-nums">
            <span className={cn("text-[var(--color-diff-added)]", !hasChanges && "opacity-50")}>
              +{git.added}
            </span>{" "}
            <span className={cn("text-[var(--color-diff-removed)]", !hasChanges && "opacity-50")}>
              -{git.removed}
            </span>
          </span>
        )
      }
    >
      <div className="space-y-0">
        {}
        <button
          type="button"
          disabled={!canOpenReview}
          className={cn(
            "flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-ui-base text-[var(--color-foreground)] transition-colors",
            canOpenReview
              ? "hover:bg-[var(--color-hover)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-input-border-focused)]"
              : "cursor-default opacity-50",
          )}
          onClick={() => {
            onOpenGitReview?.(gitWorktreeReviewSourceId ?? undefined);
          }}
        >
          <FileDiffIcon className="size-4 shrink-0 text-[var(--color-foreground)]" />
          <span className="min-w-0 flex-1 truncate">
            {intl.formatMessage({ id: "chat.statusPanel.changes" })}
          </span>
          <span className="shrink-0 font-mono tabular-nums">
            <span className="text-[var(--color-diff-added)]">+{git.added}</span>{" "}
            <span className="text-[var(--color-diff-removed)]">-{git.removed}</span>
          </span>
        </button>
        <GitBranchSwitcher
          workspacePath={workspacePath}
          gitSummary={gitSummary}
          dirtyFileCount={git.dirtyFileCount}
          onRefreshGit={onRefreshGit}
          className="w-full px-0 pt-0"
          triggerClassName="flex h-8 w-full min-w-0 justify-start gap-2 rounded-lg px-2 text-left text-ui-base text-[var(--color-foreground)] hover:bg-[var(--color-hover)] hover:text-[var(--color-foreground)] [&>span]:max-w-[calc(100%-3.5rem)] [&_svg:first-child]:text-[var(--color-foreground)]"
          popoverClassName="w-72 max-w-[calc(100vw-2rem)]"
          branchListClassName="max-h-56"
          popoverSide={useVerticalFloatingPanels ? "bottom" : "left"}
          showFooterActions
        />
        <GitActionMenu
          workspacePath={workspacePath}
          workspaceIdentity={workspaceIdentity}
          gitSummary={gitSummary}
          activeTaskChangeSummary={activeTaskChangeSummary ?? null}
          onRefreshGit={onRefreshGit}
          triggerLayout="status-row"
          className="w-full"
        />
      </div>
    </StatusSection>
  );
}

function GoalStatusSection({
  model,
  onPauseGoal,
  onResumeGoal,
  separated,
}: {
  model: ConversationStatusPanelModel;
  onPauseGoal?: () => void;
  onResumeGoal?: () => void;
  separated: boolean;
}) {
  const { intl } = useCfIntl();
  const goal = model.goal;
  const isPausable =
    goal?.status === "active" || goal?.status === "verifying" || goal?.status === "notSatisfied";
  const isPaused = goal?.status === "paused";
  const isDone = goal?.status === "verified";
  const iterationRows = useMemo(
    () => (goal ? buildConversationGoalIterationSummaries(goal) : []),
    [goal],
  );
  const now = useNowTicker(isPausable && goal?.activeRunStartedAtMs != null);

  if (!goal) return null;

  const elapsed = formatDurationUnits(
    getConversationGoalElapsedSeconds(goal, now),
    intl.formatMessage,
  );
  const control = isPausable ? (
    <ControlHintTooltip title={intl.formatMessage({ id: "chat.target.pause" })}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-6 shrink-0"
        data-goal-action="pause"
        disabled={!onPauseGoal}
        aria-label={intl.formatMessage({ id: "chat.target.pause" })}
        onClick={onPauseGoal}
      >
        <PauseIcon className="size-3.5" />
      </Button>
    </ControlHintTooltip>
  ) : isPaused ? (
    <ControlHintTooltip title={intl.formatMessage({ id: "chat.target.resume" })}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-6 shrink-0"
        data-goal-action="resume"
        disabled={!onResumeGoal}
        aria-label={intl.formatMessage({ id: "chat.target.resume" })}
        onClick={onResumeGoal}
      >
        <PlayIcon className="size-3.5" />
      </Button>
    </ControlHintTooltip>
  ) : isDone ? (
    <CircleCheckBigIcon
      aria-label={intl.formatMessage({ id: "chat.goalVerification.complete" })}
      className="size-4 shrink-0 text-[var(--color-success)]"
    />
  ) : null;

  return (
    <StatusSection
      section="goal"
      separated={separated}
      title={intl.formatMessage({ id: "chat.statusPanel.goal" })}
      trailing={() => (
        <>
          <span
            className="shrink-0 tabular-nums"
            data-goal-elapsed-seconds={getConversationGoalElapsedSeconds(goal, now)}
          >
            {elapsed}
          </span>
          {control ? <span className="shrink-0">·</span> : null}
          {control}
        </>
      )}
    >
      <div className="space-y-0">
        {iterationRows.map((row) => {
          const title =
            row.title ??
            intl.formatMessage(
              { id: "chat.summaryPanel.goalIterationValue" },
              { count: String(row.iteration) },
            );
          return (
            <div
              key={row.iteration}
              data-goal-iteration={row.iteration}
              data-goal-iteration-completed={row.completed}
              data-goal-verification-outcome={row.verificationOutcome ?? undefined}
              className="flex min-w-0 cursor-default items-start gap-2 rounded-lg px-2 py-2 hover:bg-[var(--color-hover)]"
              title={title}
            >
              {row.completed ? (
                <span className="flex size-4 shrink-0 items-center justify-center rounded-full border border-[var(--color-success)] text-ui-xs tabular-nums text-[var(--color-success)]">
                  {row.iteration}
                </span>
              ) : (
                <GoalIcon className="size-4 shrink-0 text-[var(--color-foreground-subtle)]" />
              )}
              <p className="line-clamp-3 min-w-0 flex-1 text-ui-base leading-4 text-[var(--color-foreground)]">
                {title}
              </p>
              {row.totalCount > 0 ? (
                <span className="shrink-0 text-ui-sm tabular-nums text-[var(--color-foreground-subtle)]">
                  {row.completedCount}/{row.totalCount}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </StatusSection>
  );
}

function PlanStatusIcon({ status }: { status: PlanState["items"][number]["status"] }) {
  if (status === "completed") {
    return (
      <CheckCircle2Icon
        aria-hidden
        className="mt-0.5 size-3.5 shrink-0 text-[var(--color-success)]"
      />
    );
  }
  if (status === "inProgress") {
    return (
      <ArrowRightIcon
        aria-hidden
        className="mt-0.5 size-3.5 shrink-0 text-[var(--color-foreground)]"
      />
    );
  }
  return (
    <CircleIcon
      aria-hidden
      className="mt-0.5 size-3.5 shrink-0 text-[var(--color-foreground-subtlest)]"
    />
  );
}

const COMPACT_TODO_THRESHOLD = 6;
const TODO_FOCUS_WINDOW_SIZE = 3;

export interface StatusPanelTodoFocusWindow {
  compact: boolean;
  precedingItems: PlanState["items"];
  focusItems: PlanState["items"];
  followingItems: PlanState["items"];
}

export function getStatusPanelTodoFocusWindow(
  items: PlanState["items"],
): StatusPanelTodoFocusWindow {
  if (items.length <= COMPACT_TODO_THRESHOLD) {
    return {
      compact: false,
      precedingItems: [],
      focusItems: items,
      followingItems: [],
    };
  }

  const runningIndex = items.findIndex((item) => item.status === "inProgress");
  const firstUnfinishedIndex = items.findIndex((item) => item.status !== "completed");
  const focusIndex =
    runningIndex >= 0
      ? runningIndex
      : firstUnfinishedIndex >= 0
        ? firstUnfinishedIndex
        : Math.max(0, items.length - TODO_FOCUS_WINDOW_SIZE);
  const focusStartIndex = Math.max(0, Math.min(focusIndex, items.length - TODO_FOCUS_WINDOW_SIZE));
  const focusEndIndex = Math.min(items.length, focusStartIndex + TODO_FOCUS_WINDOW_SIZE);

  return {
    compact: true,
    precedingItems: items.slice(0, focusStartIndex),
    focusItems: items.slice(focusStartIndex, focusEndIndex),
    followingItems: items.slice(focusEndIndex),
  };
}

function PlanStatusItemRows({ items }: { items: PlanState["items"] }) {
  return items.map((item) => (
    <li
      key={item.id}
      data-plan-status={item.status}
      className="flex min-h-8 items-start gap-2 rounded-lg px-2 py-1.5 text-ui-base hover:bg-[var(--color-hover)]"
    >
      <PlanStatusIcon status={item.status} />
      <span
        title={item.content}
        className={cn(
          "line-clamp-2 min-w-0 flex-1 break-words leading-5",
          item.status === "completed"
            ? "text-[var(--color-foreground-subtlest)] line-through"
            : "text-[var(--color-foreground)]",
        )}
      >
        {item.content}
      </span>
    </li>
  ));
}

const TodoPreviewTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<"button"> & {
    group: "preceding" | "following";
    label: string;
    open: boolean;
    onTouchOpen: () => void;
  }
>(function TodoPreviewTrigger({ group, label, onClick, onTouchOpen, open, ...buttonProps }, ref) {
  return (
    <button
      {...buttonProps}
      ref={ref}
      type="button"
      aria-expanded={open}
      data-status-todo-preview-trigger={group}
      className="flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-ui-base text-[var(--color-foreground-subtle)] hover:bg-[var(--color-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-input-border-focused)]"
      onClick={(event) => {
        onClick?.(event);
        if (
          !event.defaultPrevented &&
          typeof window !== "undefined" &&
          window.matchMedia?.("(hover: none)").matches
        ) {
          onTouchOpen();
        }
      }}
    >
      <ChevronLeftIcon className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
});

type TodoPreviewGroup = "preceding" | "following";

function TodoHiddenGroupPreview({
  group,
  items,
  onOpenChange,
  open,
  popoverSide,
}: {
  group: TodoPreviewGroup;
  items: PlanState["items"];
  onOpenChange: (open: boolean) => void;
  open: boolean;
  popoverSide: "bottom" | "left";
}) {
  const { intl } = useCfIntl();
  const messageId =
    group === "preceding"
      ? items.every((item) => item.status === "completed")
        ? "chat.statusPanel.todoCompletedFold"
        : "chat.statusPanel.todoEarlierFold"
      : items.every((item) => item.status === "pending")
        ? "chat.statusPanel.todoWaitingFold"
        : "chat.statusPanel.todoLaterFold";
  const label = intl.formatMessage({ id: messageId }, { count: String(items.length) });

  return (
    <HoverCard closeDelay={80} open={open} openDelay={120} onOpenChange={onOpenChange}>
      <HoverCardTrigger asChild>
        <TodoPreviewTrigger
          group={group}
          label={label}
          open={open}
          onTouchOpen={() => onOpenChange(true)}
        />
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        side={popoverSide}
        sideOffset={4}
        data-status-todo-preview-content={group}
        className="w-80 max-w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-[var(--color-popover-border)] bg-[var(--color-menu)] p-3 shadow-md ring-0"
      >
        <div className="flex max-h-[min(24rem,calc(100dvh-2rem))] min-w-0 flex-col">
          <p className="flex h-8 shrink-0 items-center px-2 text-ui-base text-[var(--color-foreground-subtle)]">
            {label}
          </p>
          <ul className="min-h-0 space-y-0 overflow-y-auto pr-1">
            <PlanStatusItemRows items={items} />
          </ul>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function PlanStatusItems({
  plan,
  popoverSide,
}: {
  plan: NonNullable<ConversationStatusPanelModel["plan"]>;
  popoverSide: "bottom" | "left";
}) {
  const [openPreviewGroup, setOpenPreviewGroup] = useState<TodoPreviewGroup | null>(null);
  const window = getStatusPanelTodoFocusWindow(plan.displayItems);
  const handlePreviewOpenChange = (group: TodoPreviewGroup, open: boolean) => {
    setOpenPreviewGroup((current) => (open ? group : current === group ? null : current));
  };

  return (
    <ul className="space-y-0 pb-1">
      {window.compact && window.precedingItems.length > 0 ? (
        <li>
          <TodoHiddenGroupPreview
            group="preceding"
            items={window.precedingItems}
            open={openPreviewGroup === "preceding"}
            onOpenChange={(open) => handlePreviewOpenChange("preceding", open)}
            popoverSide={popoverSide}
          />
        </li>
      ) : null}
      <PlanStatusItemRows items={window.focusItems} />
      {window.compact && window.followingItems.length > 0 ? (
        <li>
          <TodoHiddenGroupPreview
            group="following"
            items={window.followingItems}
            open={openPreviewGroup === "following"}
            onOpenChange={(open) => handlePreviewOpenChange("following", open)}
            popoverSide={popoverSide}
          />
        </li>
      ) : null}
    </ul>
  );
}

function SessionPlansStatusSection({
  model,
  onOpenPlanDetail,
  parentSessionId,
  separated,
}: {
  model: ConversationStatusPanelModel;
  onOpenPlanDetail?: (request: OpenPlanDetailSideTabRequest) => void;
  parentSessionId?: string;
  separated: boolean;
}) {
  const { intl } = useCfIntl();
  const sessionPlans = model.sessionPlans;
  if (!sessionPlans) return null;

  return (
    <StatusSection
      section="sessionPlans"
      separated={separated}
      title={intl.formatMessage({ id: "chat.statusPanel.sessionPlans" })}
    >
      <ul className="space-y-0">
        {sessionPlans.items.map((item) => {
          const title = item.title ?? intl.formatMessage({ id: "chat.statusPanel.planFallback" });
          const canOpen = Boolean(parentSessionId && onOpenPlanDetail);
          return (
            <li key={item.toolCallId}>
              <button
                type="button"
                data-plan-directory-tool-call-id={item.toolCallId}
                disabled={!canOpen}
                aria-label={intl.formatMessage({ id: "chat.statusPanel.openPlan" }, { title })}
                onClick={() => {
                  if (!parentSessionId) return;
                  onOpenPlanDetail?.(buildSessionPlanOpenRequest(parentSessionId, item));
                }}
                className={cn(
                  "flex min-h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ui-base text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-input-border-focused)]",
                  canOpen && "hover:bg-[var(--color-hover)]",
                )}
              >
                <ListChecksIcon className="size-4 shrink-0 text-[var(--color-foreground-subtle)]" />
                <span className="min-w-0 flex-1 truncate">{title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </StatusSection>
  );
}

export function buildSessionPlanOpenRequest(
  parentSessionId: string,
  item: ConversationStatusPanelSessionPlanItem,
): OpenPlanDetailSideTabRequest {
  return {
    parentSessionId,
    toolCallId: item.toolCallId,
    markdown: item.markdown,
    ...(item.planFilePath ? { planFilePath: item.planFilePath } : {}),
  };
}

function PlanStatusSection({
  model,
  popoverSide,
  separated,
}: {
  model: ConversationStatusPanelModel;
  popoverSide: "bottom" | "left";
  separated: boolean;
}) {
  const { intl } = useCfIntl();
  const plan = model.plan;
  if (!plan) return null;
  const isCompleted = plan.totalCount > 0 && plan.completedCount >= plan.totalCount;

  return (
    <StatusSection
      section="plan"
      separated={separated}
      title={intl.formatMessage({ id: "chat.statusPanel.todo" })}
      trailing={() => (
        <span
          className={cn(
            "tabular-nums",
            isCompleted ? "text-[var(--color-success)]" : "text-[var(--color-foreground-subtle)]",
          )}
        >
          {plan.completedCount}/{plan.totalCount}
        </span>
      )}
    >
      <PlanStatusItems
        key={plan.displayItems
          .map((item) => `${item.id}\u0000${item.content}\u0000${item.status}`)
          .join("\u0001")}
        plan={plan}
        popoverSide={popoverSide}
      />
    </StatusSection>
  );
}

function RunningWorkCancelButton({
  workId,
  onCancel,
}: {
  workId: string;
  onCancel?: (workId: string) => void;
}) {
  const { intl } = useCfIntl();
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onCancel?.(workId);
    },
    [onCancel, workId],
  );

  if (!onCancel) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-testid={testId(TID_V4_BACKGROUND_WORK_CANCEL, workId)}
      aria-label={intl.formatMessage({
        id: "chat.summaryPanel.stopRunningBackgroundTask",
      })}
      onClick={handleClick}
      className="pointer-events-auto relative z-[2] ml-auto h-6 shrink-0 px-1.5 text-ui-base text-[var(--color-foreground)]"
    >
      <SquareIcon aria-hidden className="size-3 fill-current" />
      {intl.formatMessage({ id: "chat.statusPanel.runningStop" })}
    </Button>
  );
}

export function buildRunningSubagentOpenRequest({
  parentSessionId,
  rootSessionId,
  subagent,
}: {
  parentSessionId?: string;
  rootSessionId?: string;
  subagent: CfSessionRunningSubagent;
}): OpenSubagentSideTabRequest | null {
  if (!parentSessionId) return null;
  return {
    rootSessionId: rootSessionId ?? parentSessionId,
    parentSessionId,
    childSessionId: subagent.childSessionId,
    subagentType: subagent.subagentType,
    title: subagent.title,
  };
}

function RunningStatusItem({
  now,
  onOpenBackgroundBash,
  onCancelBackgroundWork,
  work,
}: {
  now: number;
  onOpenBackgroundBash?: (work: BackgroundWorkSummary) => void;
  onCancelBackgroundWork?: (workId: string) => void;
  work: BackgroundWorkSummary;
}) {
  const { intl } = useCfIntl();

  return (
    <li
      data-testid={testId(TID_V4_BACKGROUND_WORK_ITEM, work.workId)}
      data-background-task-kind={work.kind}
      data-work-id={work.workId}
      data-work-status={work.status}
      className="group relative flex min-w-0 items-start gap-2 rounded-lg px-2 py-2 hover:bg-[var(--color-hover)]"
    >
      {onOpenBackgroundBash ? (
        <button
          type="button"
          className="absolute inset-0 rounded-lg focus-visible:outline-ring"
          aria-label={intl.formatMessage({ id: "bashOutput.open" }, { title: work.title })}
          data-testid="background-bash-open"
          onClick={() => onOpenBackgroundBash(work)}
        />
      ) : null}
      <SquareTerminalIcon className="pointer-events-none relative z-[1] mt-0.5 size-4 shrink-0 text-[var(--color-foreground-subtle)]" />
      <div className="pointer-events-none relative z-[1] flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="line-clamp-2 text-ui-base leading-5 text-[var(--color-foreground)]">
          {work.title}
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui-base">
          <span className="shrink-0 tabular-nums text-[var(--color-foreground-subtle)]">
            {formatBackgroundTaskElapsedLabel(
              getBackgroundWorkElapsedMs(work, now),
              intl.formatMessage,
            )}
          </span>
          {work.cancellable !== false ? (
            <RunningWorkCancelButton workId={work.workId} onCancel={onCancelBackgroundWork} />
          ) : null}
        </div>
      </div>
    </li>
  );
}

function BackgroundWorkStatusSection({
  onOpenBackgroundBash,
  onCancelBackgroundWork,
  onOpenChange,
  open,
  separated,
  section,
  title,
  works,
}: {
  onOpenBackgroundBash?: (work: BackgroundWorkSummary) => void;
  onCancelBackgroundWork?: (workId: string) => void;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  separated: boolean;
  section: "terminal" | "agent";
  title: string;
  works: readonly BackgroundWorkSummary[];
}) {
  const { intl } = useCfIntl();
  const [now, setNow] = useState(() => Date.now());
  const orderedRunningWorks = useMemo(
    () => [...works].sort((left, right) => left.startedAt - right.startedAt),
    [works],
  );

  useEffect(() => {
    if (works.length === 0) {
      return;
    }
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [works.length]);

  if (works.length === 0) return null;

  const collapsedElapsedLabel = formatDurationUnits(
    Math.max(1, Math.floor(getLongestRunningWorkElapsedMs(works, now) / 1000)),
    intl.formatMessage,
  );

  return (
    <StatusSection
      section={section}
      defaultOpen={false}
      open={open}
      onOpenChange={onOpenChange}
      separated={separated}
      title={title}
      trailing={(isOpen) =>
        isOpen ? (
          <span>
            {intl.formatMessage(
              {
                id:
                  works.length === 1
                    ? "chat.statusPanel.runningStatusValue"
                    : "chat.statusPanel.runningStatusValuePlural",
              },
              { count: String(works.length) },
            )}
          </span>
        ) : (
          <>
            <span className="min-w-0 truncate">{collapsedElapsedLabel}</span>
            <span className="shrink-0">·</span>
            <span className="shrink-0">{formatRunningCount(intl.formatMessage, works.length)}</span>
          </>
        )
      }
    >
      <ul className="space-y-0">
        {orderedRunningWorks.map((work) => (
          <RunningStatusItem
            key={work.workId}
            work={work}
            now={now}
            onOpenBackgroundBash={onOpenBackgroundBash}
            onCancelBackgroundWork={onCancelBackgroundWork}
          />
        ))}
      </ul>
    </StatusSection>
  );
}

function formatWorkflowRunElapsed(
  elapsedMs: number,
  formatMessage: ReturnType<typeof useCfIntl>["intl"]["formatMessage"],
) {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  return formatDurationUnits(seconds >= 3600 ? seconds - (seconds % 60) : seconds, formatMessage);
}

function formatWorkflowRunWords(
  words: ConversationStatusPanelWorkflowRunWords,
  formatMessage: ReturnType<typeof useCfIntl>["intl"]["formatMessage"],
) {
  switch (words.kind) {
    case "status":
      return formatMessage({ id: `chat.toolCall.workflow.run.status.${words.status}` });
    case "steps":
      return formatMessage(
        { id: "chat.toolCall.workflow.card.steps" },
        { done: String(words.done), total: String(words.total) },
      );
    case "phases":
      return words.text;
  }
}

function workflowRunDisplayName(run: ConversationStatusPanelWorkflowRun): string | null {
  return run.title && run.title !== run.runId ? run.title : null;
}

function WorkflowRunLamp({ status }: { status: "pending" | "running" }) {
  return (
    <span
      aria-hidden="true"
      data-workflow-run-lamp={status}
      className={cn("size-1.5 shrink-0 rounded-full", RUN_STATUS_DOT[status])}
    />
  );
}

function WorkflowRunStopButton({
  workId,
  onCancel,
}: {
  workId: string;
  onCancel: (workId: string) => void;
}) {
  const { intl } = useCfIntl();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-testid={testId(TID_V4_BACKGROUND_WORK_CANCEL, workId)}
      aria-label={intl.formatMessage({ id: "chat.toolCall.workflow.run.cancel" })}
      onClick={(event) => {
        event.stopPropagation();
        onCancel(workId);
      }}
      className={cn(
        "pointer-events-none absolute right-1.5 top-1.5 z-[2] h-6 gap-1 bg-menu-hover px-1.5 text-ui-sm text-foreground opacity-0 transition-opacity",
        "hover:bg-[image:linear-gradient(var(--color-hover),var(--color-hover))]",
        "group-hover/wf-run:pointer-events-auto group-hover/wf-run:opacity-100 group-focus-within/wf-run:pointer-events-auto group-focus-within/wf-run:opacity-100",
        "[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:static [@media(hover:none)]:size-8 [@media(hover:none)]:bg-transparent [@media(hover:none)]:p-0 [@media(hover:none)]:text-foreground-subtle [@media(hover:none)]:opacity-100",
      )}
    >
      <SquareIcon aria-hidden className="size-2.5 fill-current [@media(hover:none)]:size-3" />
      <span className="[@media(hover:none)]:sr-only">
        {intl.formatMessage({ id: "chat.statusPanel.runningStop" })}
      </span>
    </Button>
  );
}

function WorkflowRunRow({
  now,
  onCancelBackgroundWork,
  onOpenWorkflowRun,
  run,
}: {
  now: number;
  onCancelBackgroundWork?: (workId: string) => void;
  onOpenWorkflowRun?: (target: ConversationStatusPanelWorkflowRunTarget) => void;
  run: ConversationStatusPanelWorkflowRun;
}) {
  const { intl } = useCfIntl();
  const openTarget = onOpenWorkflowRun ? workflowRunOpenTarget(run) : null;
  const name = workflowRunDisplayName(run);
  const displayName = name ?? intl.formatMessage({ id: "chat.toolCall.workflow.fallbackName" });
  const words = workflowRunWords(run);
  const wordsText = words ? formatWorkflowRunWords(words, intl.formatMessage) : null;
  const elapsed =
    run.startedAt === undefined || run.status === "pending"
      ? null
      : formatWorkflowRunElapsed(now - run.startedAt, intl.formatMessage);
  const canStop = Boolean(run.workId && run.cancellable !== false && onCancelBackgroundWork);
  const statusWord = run.status
    ? intl.formatMessage({ id: `chat.toolCall.workflow.run.status.${run.status}` })
    : null;
  const openLabel = [
    intl.formatMessage({ id: "chat.toolCall.workflow.openRunDetails" }),
    displayName,
    statusWord,
    wordsText === statusWord ? null : wordsText,
  ]
    .filter(Boolean)
    .join(" · ");
  const phases = run.phases ?? [];

  return (
    <li
      data-testid={run.workId ? testId(TID_V4_BACKGROUND_WORK_ITEM, run.workId) : undefined}
      data-background-task-kind="workflow"
      data-workflow-run-id={run.runId}
      data-work-id={run.workId}
      data-work-status={run.status}
      className={cn(
        "group/wf-run relative grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-2 rounded-lg p-2 hover:bg-[var(--color-hover)]",
        canStop && "[@media(hover:none)]:grid-cols-[1rem_minmax(0,1fr)_2rem]",
        openTarget && "cursor-pointer",
      )}
    >
      {openTarget ? (
        <button
          type="button"
          data-workflow-run-details-trigger="true"
          data-workflow-run-id={run.runId}
          aria-label={openLabel}
          title={displayName}
          onClick={() => onOpenWorkflowRun?.(openTarget)}
          className="absolute inset-0 z-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-input-border-focused)]"
        />
      ) : null}
      <Workflow className="pointer-events-none relative z-[1] mt-0.5 size-4 shrink-0 self-start text-[var(--color-foreground-subtle)]" />
      <div className="pointer-events-none relative z-[1] flex min-w-0 flex-col gap-0.5">
        <div
          data-workflow-island-line="name"
          className="flex h-5 min-w-0 items-baseline gap-2 leading-5"
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-ui-base",
              name ? "text-[var(--color-foreground)]" : "text-[var(--color-foreground-subtle)]",
            )}
          >
            {displayName}
          </span>
          {elapsed ? (
            <span
              data-workflow-run-elapsed="true"
              className={cn(
                "shrink-0 text-ui-sm tabular-nums text-[var(--color-foreground-subtle)] transition-opacity",
                canStop &&
                  "group-hover/wf-run:opacity-0 [@media(hover:hover)]:group-focus-within/wf-run:opacity-0",
                canStop && wordsText && "[@media(hover:none)]:hidden",
              )}
            >
              {elapsed}
            </span>
          ) : null}
        </div>
        {words && wordsText ? (
          <div
            data-workflow-island-line="phase"
            className="flex h-4.5 min-w-0 items-center gap-1.5 text-ui-sm text-[var(--color-foreground-subtle)]"
          >
            {words.kind === "phases" ? (
              <WorkflowRunRail rail={foldWorkflowRunRail(phases)} intl={intl} />
            ) : (
              <WorkflowRunLamp status={run.status === "pending" ? "pending" : "running"} />
            )}
            <span className="min-w-0 flex-1 truncate">{wordsText}</span>
            {elapsed && canStop ? (
              <span
                aria-hidden="true"
                className="hidden shrink-0 tabular-nums [@media(hover:none)]:inline"
              >
                {elapsed}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {canStop && run.workId && onCancelBackgroundWork ? (
        <WorkflowRunStopButton workId={run.workId} onCancel={onCancelBackgroundWork} />
      ) : null}
    </li>
  );
}

function WorkflowStatusSection({
  endedRunCount,
  onCancelBackgroundWork,
  onOpenChange,
  onOpenDirectory,
  onOpenWorkflowRun,
  open,
  parentSessionId,
  runs,
  separated,
  title,
}: {
  endedRunCount: number;
  onCancelBackgroundWork?: (workId: string) => void;
  onOpenChange?: (open: boolean) => void;
  onOpenDirectory?: (request: OpenWorkflowRunDirectorySideTabRequest) => void;
  onOpenWorkflowRun?: (target: ConversationStatusPanelWorkflowRunTarget) => void;
  open?: boolean;
  parentSessionId?: string;
  runs: readonly ConversationStatusPanelWorkflowRun[];
  separated: boolean;
  title: string;
}) {
  const { intl } = useCfIntl();
  const [now, setNow] = useState(() => Date.now());
  const tickingRunCount = runs.filter((run) => run.startedAt !== undefined).length;
  useEffect(() => {
    if (tickingRunCount === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [tickingRunCount]);

  if (runs.length === 0 && endedRunCount <= 0) return null;

  return (
    <StatusSection
      section="workflow"
      defaultOpen={runs.length > 0}
      open={open}
      onOpenChange={onOpenChange}
      separated={separated}
      title={title}
      trailing={() =>
        runs.length > 0 ? (
          <>
            <WorkflowRunLamp status="running" />
            <span>
              {intl.formatMessage(
                { id: "chat.statusPanel.workflowsLive" },
                { count: String(runs.length) },
              )}
            </span>
          </>
        ) : null
      }
      footer={
        <EndedDirectoryRow
          count={endedRunCount}
          icon={
            <CheckCircle2Icon className="size-4 shrink-0 text-[var(--color-foreground-subtle)]" />
          }
          label={intl.formatMessage({ id: "chat.statusPanel.endedWorkflows" })}
          separated={runs.length > 0}
          testId="workflow-run-directory-trigger"
          onOpen={
            parentSessionId && onOpenDirectory
              ? () => onOpenDirectory({ parentSessionId })
              : undefined
          }
        />
      }
    >
      <ul className="space-y-0">
        {runs.map((run) => (
          <WorkflowRunRow
            key={run.runId}
            run={run}
            now={now}
            onCancelBackgroundWork={onCancelBackgroundWork}
            onOpenWorkflowRun={onOpenWorkflowRun}
          />
        ))}
      </ul>
    </StatusSection>
  );
}

function SubagentStatusSection({
  endedSubagentCount,
  onCancelBackgroundWork,
  onOpenChange,
  onOpenSubagentDirectory,
  onOpenSubagentSession,
  open,
  parentSessionId,
  rootSessionId,
  separated,
  title,
  subagents,
}: {
  endedSubagentCount: number;
  onCancelBackgroundWork?: (workId: string) => void;
  onOpenChange?: (open: boolean) => void;
  onOpenSubagentDirectory?: (request: OpenSubagentDirectorySideTabRequest) => void;
  onOpenSubagentSession?: (request: OpenSubagentSideTabRequest) => void;
  open?: boolean;
  parentSessionId?: string;
  rootSessionId?: string;
  separated: boolean;
  title: string;
  subagents: readonly ConversationStatusPanelRunningSubagent[];
}) {
  const { intl } = useCfIntl();
  const [now, setNow] = useState(() => Date.now());
  const ordered = useMemo(
    () => [...subagents].sort((left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0)),
    [subagents],
  );
  useEffect(() => {
    if (subagents.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [subagents.length]);
  if (subagents.length === 0 && endedSubagentCount <= 0) return null;
  const longestElapsedMs = subagents.reduce(
    (longest, item) => Math.max(longest, Math.max(0, now - (item.startedAt ?? now))),
    0,
  );

  return (
    <StatusSection
      section="agent"
      defaultOpen={false}
      open={open}
      onOpenChange={onOpenChange}
      separated={separated}
      title={title}
      trailing={(isOpen) =>
        subagents.length === 0 ? null : isOpen ? (
          <span>{formatRunningSubagentCount(intl.formatMessage, subagents.length)}</span>
        ) : (
          <>
            <span className="min-w-0 truncate">
              {formatDurationUnits(
                Math.max(1, Math.floor(longestElapsedMs / 1000)),
                intl.formatMessage,
              )}
            </span>
            <span className="shrink-0">·</span>
            <span className="shrink-0">
              {formatRunningSubagentCount(intl.formatMessage, subagents.length)}
            </span>
          </>
        )
      }
    >
      <ul className="space-y-0">
        {ordered.map((subagent) => {
          const request = buildRunningSubagentOpenRequest({
            parentSessionId,
            rootSessionId,
            subagent,
          });
          const canOpenSubagentSession = Boolean(request && onOpenSubagentSession);
          return (
            <li
              key={subagent.childSessionId}
              data-testid={
                subagent.controlWorkId
                  ? testId(TID_V4_BACKGROUND_WORK_ITEM, subagent.controlWorkId)
                  : undefined
              }
              data-background-task-kind="agent"
              data-child-session-id={subagent.childSessionId}
              data-work-id={subagent.controlWorkId}
              data-work-status="running"
              className={cn(
                "group relative flex min-w-0 items-start gap-2 rounded-lg px-2 py-2 hover:bg-[var(--color-hover)]",
                canOpenSubagentSession && "cursor-pointer",
              )}
            >
              {canOpenSubagentSession ? (
                <button
                  type="button"
                  data-running-subagent-session-trigger="true"
                  data-child-session-id={subagent.childSessionId}
                  aria-label={intl.formatMessage({
                    id: "chat.summaryPanel.openRunningSubagentSession",
                  })}
                  onClick={() => request && onOpenSubagentSession?.(request)}
                  className="absolute inset-0 z-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-input-border-focused)]"
                />
              ) : null}
              <BotIcon className="pointer-events-none relative z-[1] mt-0.5 size-4 shrink-0 text-[var(--color-foreground-subtle)]" />
              <div className="pointer-events-none relative z-[1] flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="line-clamp-2 text-ui-base leading-5 text-[var(--color-foreground)]">
                  {subagent.title}
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui-base">
                  <span className="text-ui-base tabular-nums text-[var(--color-foreground-subtle)]">
                    {formatBackgroundTaskElapsedLabel(
                      Math.max(0, now - (subagent.startedAt ?? now)),
                      intl.formatMessage,
                    )}
                  </span>
                  {subagent.controlWorkId && subagent.cancellable !== false ? (
                    <RunningWorkCancelButton
                      workId={subagent.controlWorkId}
                      onCancel={onCancelBackgroundWork}
                    />
                  ) : null}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <EndedSubagentDirectoryRow
        count={endedSubagentCount}
        parentSessionId={parentSessionId}
        rootSessionId={rootSessionId}
        onOpen={onOpenSubagentDirectory}
        separated={subagents.length > 0}
      />
    </StatusSection>
  );
}

function EndedDirectoryRow({
  count,
  icon,
  label,
  onOpen,
  separated,
  testId,
}: {
  count: number;
  icon: ReactNode;
  label: string;
  onOpen?: () => void;
  separated: boolean;
  testId?: string;
}) {
  if (count <= 0 || !onOpen) return null;
  return (
    <div className={cn(separated && "border-t border-[var(--color-border)] pt-2")}>
      <button
        type="button"
        data-testid={testId}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-ui-base text-[var(--color-foreground)] hover:bg-[var(--color-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-input-border-focused)]"
        onClick={onOpen}
      >
        {icon}
        <span>{label}</span>
        <span className="ml-auto text-[var(--color-foreground-subtle)]">{count}</span>
        <ChevronRightIcon className="size-4 text-[var(--color-foreground-subtle)]" />
      </button>
    </div>
  );
}

function EndedSubagentDirectoryRow({
  count,
  onOpen,
  parentSessionId,
  rootSessionId,
  separated,
}: {
  count: number;
  onOpen?: (request: OpenSubagentDirectorySideTabRequest) => void;
  parentSessionId?: string;
  rootSessionId?: string;
  separated: boolean;
}) {
  const { intl } = useCfIntl();
  return (
    <EndedDirectoryRow
      count={count}
      icon={<CheckCircle2Icon className="size-4 shrink-0 text-[var(--color-foreground-subtle)]" />}
      label={intl.formatMessage({ id: "chat.statusPanel.endedAgents" })}
      separated={separated}
      onOpen={
        parentSessionId && onOpen
          ? () =>
              onOpen({
                rootSessionId: rootSessionId ?? parentSessionId,
                parentSessionId,
              })
          : undefined
      }
    />
  );
}

function StatusSummaryMetric({ children, icon }: { children: ReactNode; icon: ReactNode }) {
  return (
    <div className="flex h-8 w-max max-w-full min-w-0 items-center gap-1.5 pl-2 pr-3 text-ui-base text-[var(--color-foreground)]">
      <span className="relative size-4 shrink-0">
        <span className="absolute inset-0 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
          {icon}
        </span>
        <Maximize2Icon className="absolute inset-0 size-4 text-[var(--color-foreground)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      </span>
      {children}
    </div>
  );
}

function WorkflowSummaryMetric({
  others,
  run,
}: {
  others: number;
  run: ConversationStatusPanelWorkflowRun;
}) {
  const { intl } = useCfIntl();
  const name = workflowRunDisplayName(run);
  const words = workflowRunWords(run);
  const wordsText = words ? formatWorkflowRunWords(words, intl.formatMessage) : null;
  return (
    <StatusSummaryMetric icon={<Workflow className="size-4 text-[var(--color-foreground)]" />}>
      <span
        data-workflow-pill={run.runId}
        className={cn(
          "min-w-0 truncate",
          !name && "text-[var(--color-foreground-subtle)]",
        )}
      >
        {name ?? intl.formatMessage({ id: "chat.toolCall.workflow.fallbackName" })}
      </span>
      {run.status && wordsText ? (
        <>
          <WorkflowRunLamp status={run.status} />
          <span className="max-w-[45%] shrink-0 truncate text-[var(--color-foreground-subtle)]">
            {wordsText}
          </span>
        </>
      ) : null}
      {others > 0 ? (
        <span className="shrink-0 tabular-nums text-[var(--color-foreground-subtlest)]">
          +{others}
        </span>
      ) : null}
    </StatusSummaryMetric>
  );
}

function getCurrentPlanItem(plan: ConversationStatusPanelModel["plan"]) {
  return (
    plan?.items.find((item) => item.status === "inProgress") ??
    plan?.items.find((item) => item.status === "pending") ??
    null
  );
}

function getCompletedPlanItem(plan: ConversationStatusPanelModel["plan"]) {
  return [...(plan?.items ?? [])].reverse().find((item) => item.status === "completed") ?? null;
}

function StatusSummaryRow({
  endedWorkflowRunCount,
  gitWorktreeChangeSummary,
  model,
  onOpenWorkflowSection,
  onVariantChange,
}: {
  
  endedWorkflowRunCount: number;
  gitWorktreeChangeSummary?: { added: number; removed: number } | null;
  model: ConversationStatusPanelModel;
  
  onOpenWorkflowSection?: () => void;
  onVariantChange?: (variant: ChatViewSummaryPanelVariant | null) => void;
}) {
  const { intl } = useCfIntl();
  const expandLabel = intl.formatMessage({ id: "chat.summaryPanel.showPanel" });
  const currentPlanItem = getCurrentPlanItem(model.plan);
  const completedPlanItem = getCompletedPlanItem(model.plan);
  const latestSessionPlan = model.sessionPlans?.items[0] ?? null;
  const goal = model.goal;
  const goalTitle = goal ? goal.summaryTitle?.trim() || goal.objective.trim() || null : null;
  const goalStatus = goal?.status ?? null;
  const isActiveGoal =
    goalStatus === "active" ||
    goalStatus === "notSatisfied" ||
    goalStatus === "paused" ||
    goalStatus === "verifying";
  const isDoneGoal = goalStatus === "verified";
  const added = gitWorktreeChangeSummary?.added ?? 0;
  const removed = gitWorktreeChangeSummary?.removed ?? 0;
  const hasGitMiniSummary = Boolean(model.git && added + removed > 0);

  const hasRunningBash = model.runningBashWorks.length > 0;
  const hasRunningSubagent = model.runningSubagentWorks.length > 0;
  const runningCount = model.runningBashWorks.length + model.runningSubagentWorks.length;
  const RunningSummaryIcon =
    hasRunningBash && hasRunningSubagent
      ? ActivityIcon
      : hasRunningBash
        ? SquareTerminalIcon
        : BotIcon;
  const firstLiveRun = model.runningWorkflowRuns[0];
  const summaryMetric = firstLiveRun ? (
    <WorkflowSummaryMetric run={firstLiveRun} others={model.runningWorkflowRuns.length - 1} />
  ) : currentPlanItem ? (
    <StatusSummaryMetric
      icon={<ArrowRightIcon className="size-4 text-[var(--color-foreground)]" />}
    >
      <span className="min-w-0 truncate">{currentPlanItem.content}</span>
    </StatusSummaryMetric>
  ) : goalTitle && isActiveGoal ? (
    <StatusSummaryMetric icon={<GoalIcon className="size-4 text-[var(--color-foreground)]" />}>
      <span className="min-w-0 truncate">{goalTitle}</span>
    </StatusSummaryMetric>
  ) : hasGitMiniSummary ? (
    <StatusSummaryMetric icon={<FileDiffIcon className="size-4 text-[var(--color-foreground)]" />}>
      <span className="min-w-0 truncate">
        {intl.formatMessage({ id: "chat.statusPanel.changes" })}
      </span>
      <span className="shrink-0 text-[var(--color-diff-added)]">+{added}</span>
      <span className="shrink-0 text-[var(--color-diff-removed)]">-{removed}</span>
    </StatusSummaryMetric>
  ) : goalTitle && isDoneGoal ? (
    <StatusSummaryMetric icon={<GoalIcon className="size-4 text-[var(--color-foreground)]" />}>
      <span className="min-w-0 truncate">{goalTitle}</span>
    </StatusSummaryMetric>
  ) : completedPlanItem ? (
    <StatusSummaryMetric icon={<CheckCircle2Icon className="size-4 text-[var(--color-success)]" />}>
      <span className="min-w-0 truncate">{completedPlanItem.content}</span>
    </StatusSummaryMetric>
  ) : model.plan ? (
    <StatusSummaryMetric
      icon={<ListChecksIcon className="size-4 text-[var(--color-foreground-subtle)]" />}
    >
      <span className="min-w-0 truncate">
        {intl.formatMessage({ id: "chat.statusPanel.todo" })}
      </span>
      <span className="shrink-0 text-[var(--color-foreground-subtle)]">
        {model.plan.completedCount}/{model.plan.totalCount}
      </span>
    </StatusSummaryMetric>
  ) : latestSessionPlan ? (
    <StatusSummaryMetric
      icon={<ListChecksIcon className="size-4 text-[var(--color-foreground)]" />}
    >
      <span className="min-w-0 truncate">
        {latestSessionPlan.title ?? intl.formatMessage({ id: "chat.statusPanel.planFallback" })}
      </span>
    </StatusSummaryMetric>
  ) : runningCount > 0 ? (
    <StatusSummaryMetric
      icon={<RunningSummaryIcon className="size-4 text-[var(--color-foreground)]" />}
    >
      {}
      <span className="shrink-0">
        {hasRunningSubagent
          ? formatRunningSubagentCount(intl.formatMessage, runningCount)
          : formatRunningCount(intl.formatMessage, runningCount)}
      </span>
    </StatusSummaryMetric>
  ) : endedWorkflowRunCount > 0 ? (
    <StatusSummaryMetric
      icon={<Workflow className="size-4 text-[var(--color-foreground-subtle)]" />}
    >
      <span className="min-w-0 truncate">
        {intl.formatMessage({ id: "chat.statusPanel.endedWorkflows" })}
      </span>
      <span className="shrink-0 text-[var(--color-foreground-subtle)]">
        {endedWorkflowRunCount}
      </span>
    </StatusSummaryMetric>
  ) : null;

  if (!summaryMetric) {
    return null;
  }

  return (
    <ControlHintTooltip title={expandLabel} sideOffset={4} side="left">
      <button
        type="button"
        aria-label={expandLabel}
        className="group inline-flex w-max max-w-full cursor-pointer flex-col items-stretch text-left text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-menu-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-input-border-focused)]"
        onClick={() => {
          if (firstLiveRun) onOpenWorkflowSection?.();
          onVariantChange?.("panel");
        }}
      >
        {summaryMetric}
      </button>
    </ControlHintTooltip>
  );
}

function ConversationStatusPanelImpl({
  workspacePath,
  workspaceIdentity,
  gitSummary,
  gitDirtyFileCount = 0,
  gitWorktreeReviewSourceId,
  gitWorktreeChangeSummary,
  activeTaskChangeSummary,
  goal,
  sessionPlans,
  plan,
  backgroundWorks = EMPTY_BACKGROUND_WORKS,
  runningSubagents = EMPTY_RUNNING_SUBAGENTS,
  workflowRuns = EMPTY_WORKFLOW_RUNS,
  endedWorkflowRunCount = 0,
  endedSubagentCount = 0,
  rootSessionId,
  parentSessionId,
  isWebRemoteControl = false,
  isMobileViewport = false,
  layoutMode = "none",
  summaryPanelVariantOverride,
  onVariantChange,
  terminalSectionOpen,
  onTerminalSectionOpenChange,
  agentSectionOpen,
  onAgentSectionOpenChange,
  workflowSectionOpen,
  onWorkflowSectionOpenChange,
  onRefreshGit,
  onOpenGitReview,
  onPauseGoal,
  onResumeGoal,
  onOpenPlanDetail,
  onOpenBackgroundBash,
  onCancelBackgroundWork,
  onOpenSubagentSession,
  onOpenSubagentDirectory,
  onOpenWorkflowRun,
  onOpenWorkflowRunDirectory,
  className,
}: ConversationStatusPanelProps) {
  const isOfficeMode = useIsOfficeMode();
  const model = useMemo(
    () =>
      buildConversationStatusPanelModel({
        isOfficeMode,
        gitSummary,
        gitDirtyFileCount,
        gitWorktreeChangeSummary,
        goal,
        sessionPlans,
        workspacePath,
        plan,
        backgroundWorks,
        runningSubagents,
        workflowRuns,
      }),
    [
      isOfficeMode,
      backgroundWorks,
      gitDirtyFileCount,
      gitSummary,
      gitWorktreeChangeSummary,
      goal,
      sessionPlans,
      plan,
      runningSubagents,
      workflowRuns,
      workspacePath,
    ],
  );
  const variant = resolveConversationStatusPanelVariant({
    variantOverride: summaryPanelVariantOverride ?? null,
  });
  const isVariantAutomatic = summaryPanelVariantOverride == null;
  const useVerticalFloatingPanels = isWebRemoteControl && isMobileViewport;
  const panelModeValue = isVariantAutomatic ? "auto" : variant;
  const { intl } = useCfIntl();
  const panelMenuLabel = intl.formatMessage({
    id: "chat.summaryPanel.displayMode",
  });
  const canRenderGit = Boolean(model.git && gitSummary && onRefreshGit);
  const canRenderGoal = Boolean(model.goal);
  const canRenderSessionPlans = Boolean(model.sessionPlans);
  const canRenderPlan = Boolean(model.plan);
  const canRenderTerminals = model.runningBashWorks.length > 0;
  const canRenderEndedWorkflows = Boolean(
    endedWorkflowRunCount > 0 && parentSessionId && onOpenWorkflowRunDirectory,
  );
  const canRenderWorkflows = model.runningWorkflowRuns.length > 0 || canRenderEndedWorkflows;
  const canRenderEndedAgents = Boolean(
    endedSubagentCount > 0 && parentSessionId && onOpenSubagentDirectory,
  );
  const canRenderAgents = model.runningSubagentWorks.length > 0 || canRenderEndedAgents;
  const handlePanelModeChange = useCallback(
    (value: string) => {
      if (value === "auto") {
        onVariantChange?.(null);
        return;
      }
      if (value === "panel" || value === "mini") {
        onVariantChange?.(value);
      }
    },
    [onVariantChange],
  );
  const handleOpenWorkflowSection = useCallback(() => {
    onWorkflowSectionOpenChange?.(true);
  }, [onWorkflowSectionOpenChange]);
  const handleCollapseToMini = useCallback(() => {
    onVariantChange?.("mini");
  }, [onVariantChange]);

  if (!model.hasContent && !canRenderEndedWorkflows) {
    return null;
  }

  return (
    <div
      className={cn(
        "pointer-events-none absolute top-0 z-20 pt-4",
        layoutMode === "inline"
          ? "right-4"
          : layoutMode === "auto"
            ? "inset-x-0 flex justify-end px-4 @min-[1280px]/conversation:left-auto @min-[1280px]/conversation:right-4 @min-[1280px]/conversation:px-0"
            : "inset-x-0 flex justify-end px-4",
        className,
      )}
    >
      {}
      <aside
        aria-label={intl.formatMessage({ id: "chat.summaryPanel.title" })}
        data-testid={TID_CHAT_SUMMARY_PANEL}
        data-state={variant === "mini" ? "collapsed" : "expanded"}
        data-display-mode={variant}
        data-goal-status={model.goal?.status}
        data-goal-objective={model.goal?.objective}
        data-running-background-count={
          model.runningBashWorks.length +
          model.runningSubagentWorks.length +
          model.runningWorkflowRuns.length
        }
        data-running-terminal-count={model.runningBashWorks.length}
        data-running-agent-count={model.runningSubagentWorks.length}
        data-running-workflow-count={model.runningWorkflowRuns.length}
        data-ended-workflow-count={endedWorkflowRunCount}
        className={cn(
          "pointer-events-auto relative overflow-hidden rounded-2xl border border-[var(--color-popover-border)] bg-[var(--color-popover)] text-[var(--color-foreground)] shadow-md transition-[border-radius,padding,background-color,box-shadow] duration-300 ease-in-out",
          variant === "mini"
            ? "inline-flex max-h-8.5 w-max max-w-[min(20rem,calc(100cqw-2rem))] flex-col"
            : variant === "panel"
              ? "flex max-h-[min(64dvh,32rem)] w-80 max-w-[calc(100cqw-2rem)] flex-col"
              : "inline-flex max-h-8.5 w-max max-w-[min(20rem,calc(100cqw-2rem))] flex-col @min-[1280px]/conversation:max-h-[min(64dvh,32rem)] @min-[1280px]/conversation:w-80",
        )}
      >
        {variant !== "mini" ? (
          <div
            className={cn(
              "absolute right-3 top-3 z-10 items-center gap-1",
              variant === "auto" ? "hidden @min-[1280px]/conversation:flex" : "flex",
            )}
          >
            <DropdownMenu>
              <ControlHintTooltip title={panelMenuLabel} side="left">
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-6"
                    aria-label={panelMenuLabel}
                  >
                    <EllipsisIcon className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
              </ControlHintTooltip>
              <DropdownMenuContent align="end" side="bottom" className="w-44">
                <DropdownMenuRadioGroup
                  value={panelModeValue}
                  onValueChange={handlePanelModeChange}
                >
                  <DropdownMenuRadioItem value="auto">
                    {intl.formatMessage({
                      id: "chat.summaryPanel.displayModeAuto",
                    })}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <ControlHintTooltip
              title={intl.formatMessage({ id: "chat.summaryPanel.showMini" })}
              side="left"
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-6"
                aria-label={intl.formatMessage({
                  id: "chat.summaryPanel.showMini",
                })}
                onClick={handleCollapseToMini}
              >
                <Minimize2Icon className="size-3.5" />
              </Button>
            </ControlHintTooltip>
          </div>
        ) : null}
        {variant !== "mini" ? (
          <div
            className={cn(
              "min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto p-2",
              variant === "auto" ? "hidden @min-[1280px]/conversation:flex" : "flex",
            )}
          >
            {canRenderGit ? (
              <GitStatusSection
                model={model}
                gitSummary={gitSummary}
                gitWorktreeReviewSourceId={gitWorktreeReviewSourceId}
                workspacePath={workspacePath}
                workspaceIdentity={workspaceIdentity}
                activeTaskChangeSummary={activeTaskChangeSummary}
                onRefreshGit={onRefreshGit}
                onOpenGitReview={onOpenGitReview}
                separated={false}
                useVerticalFloatingPanels={useVerticalFloatingPanels}
              />
            ) : null}
            {canRenderGoal ? (
              <GoalStatusSection
                model={model}
                separated={canRenderGit}
                onPauseGoal={onPauseGoal}
                onResumeGoal={onResumeGoal}
              />
            ) : null}
            {canRenderSessionPlans ? (
              <SessionPlansStatusSection
                model={model}
                parentSessionId={parentSessionId}
                onOpenPlanDetail={onOpenPlanDetail}
                separated={canRenderGit || canRenderGoal}
              />
            ) : null}
            {canRenderPlan ? (
              <PlanStatusSection
                model={model}
                popoverSide={useVerticalFloatingPanels ? "bottom" : "left"}
                separated={canRenderGit || canRenderGoal || canRenderSessionPlans}
              />
            ) : null}
            {canRenderTerminals ? (
              <BackgroundWorkStatusSection
                onOpenBackgroundBash={onOpenBackgroundBash}
                section="terminal"
                title={intl.formatMessage({ id: "chat.statusPanel.terminals" })}
                works={model.runningBashWorks}
                open={terminalSectionOpen}
                onOpenChange={onTerminalSectionOpenChange}
                separated={canRenderGit || canRenderGoal || canRenderSessionPlans || canRenderPlan}
                onCancelBackgroundWork={onCancelBackgroundWork}
              />
            ) : null}
            {canRenderWorkflows ? (
              <WorkflowStatusSection
                title={intl.formatMessage({ id: "chat.statusPanel.workflows" })}
                runs={model.runningWorkflowRuns}
                endedRunCount={canRenderEndedWorkflows ? endedWorkflowRunCount : 0}
                open={workflowSectionOpen}
                onOpenChange={onWorkflowSectionOpenChange}
                separated={
                  canRenderGit ||
                  canRenderGoal ||
                  canRenderSessionPlans ||
                  canRenderPlan ||
                  canRenderTerminals
                }
                parentSessionId={parentSessionId}
                onCancelBackgroundWork={onCancelBackgroundWork}
                onOpenWorkflowRun={onOpenWorkflowRun}
                onOpenDirectory={onOpenWorkflowRunDirectory}
              />
            ) : null}
            {canRenderAgents ? (
              <SubagentStatusSection
                title={intl.formatMessage({ id: "chat.statusPanel.agents" })}
                subagents={model.runningSubagentWorks}
                endedSubagentCount={canRenderEndedAgents ? endedSubagentCount : 0}
                onCancelBackgroundWork={onCancelBackgroundWork}
                open={agentSectionOpen}
                onOpenChange={onAgentSectionOpenChange}
                separated={
                  canRenderGit ||
                  canRenderGoal ||
                  canRenderSessionPlans ||
                  canRenderPlan ||
                  canRenderTerminals ||
                  canRenderWorkflows
                }
                parentSessionId={parentSessionId}
                rootSessionId={rootSessionId}
                onOpenSubagentSession={onOpenSubagentSession}
                onOpenSubagentDirectory={onOpenSubagentDirectory}
              />
            ) : null}
          </div>
        ) : null}
        <div
          aria-hidden={variant === "panel"}
          className={cn(
            "w-max max-w-full transition-opacity duration-150",
            variant === "mini"
              ? "pointer-events-auto relative visible opacity-100"
              : variant === "panel"
                ? "pointer-events-none invisible absolute left-0 top-0 opacity-0"
                : "pointer-events-auto relative visible opacity-100 @min-[1280px]/conversation:hidden",
          )}
        >
          <StatusSummaryRow
            model={model}
            endedWorkflowRunCount={canRenderEndedWorkflows ? endedWorkflowRunCount : 0}
            gitWorktreeChangeSummary={gitWorktreeChangeSummary}
            onOpenWorkflowSection={handleOpenWorkflowSection}
            onVariantChange={onVariantChange}
          />
        </div>
      </aside>
    </div>
  );
}

export const ConversationStatusPanel = memo(ConversationStatusPanelImpl);
