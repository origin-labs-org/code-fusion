import { TID_TASK_ITEM, testId } from "@origin-ai/cf-shared/test-ids";
import type { ProjectTask as CfTaskMeta } from "@/project-sidebar/contract.js";
import { memo, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { UniqueIdentifier } from "@dnd-kit/core";
import { isCronTask, isOffPeakTask } from "@origin-ai/cf-shared";
import { ArrowUpToLine, Clock, Cloud, Folder, ListTree, LoaderIcon, Moon, X } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { Badge } from "@/components/ui/badge.js";
import { toast } from "@/components/ui/toast.js";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import {
  deriveTaskLeadingIndicator,
  formatTaskRelativeTime,
} from "@/lib/taskListItemPresentation.js";
import { getTaskChangeSummary } from "@/lib/taskChangeSummary.js";
import { buildTaskWorkspaceKey } from "@/lib/taskQueryCache.js";
import { buildTaskFeedbackDescription } from "@/lib/taskFeedbackDraft.js";
import { useTaskListItemContextActions } from "@/useTaskListItemContextActions.js";
import { useFeedbackStore } from "@/feedback/feedbackStore.js";
import { getTaskListAttention, getTaskListRowActivity } from "@/v4/taskListRowActivity.js";
import { GroupedTaskContextMenuContent } from "@/project-sidebar/grouped/task-context-menu-content.js";
import { TaskRowActionButton } from "@/workspace-grouped-tasks/task-row-action-button.js";
import { TaskInteractionBadge } from "@/TaskInteractionBadge.js";
import { formatGroupedTaskHoverChangeParts } from "@/project-sidebar/grouped/task-row-tooltip.js";
import {
  TASK_GROUP_ROW_CLASS,
  TASK_GROUP_ROW_LINE_CLASS,
  type TaskGroupMenuItem,
} from "@/project-sidebar/grouped/types.js";
import { TaskWorkflowRunLines } from "@/components/workflow-run-line/TaskWorkflowRunLines.js";
import { useTaskInteractionAutoResolutionSnooze } from "@/hooks/useTaskInteractionAutoResolutionSnooze.js";
import { useOptionalTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceReadOnly } from "@/store/tabStore.js";
import { TaskTitleOverflowText } from "@/components/TaskTitleOverflowText.js";

function GroupedTaskRowComponent({
  task,
  currentGroupId,
  groups,
  remoteSessionId,
  activeWorkspacePath,
  activeWorkspaceIdentity,
  activeTaskId,
  mobileActiveTaskKey,
  workspaceLabel,
  onSelectTask,
  onCloseTask,
  onOpenFileTree,
  onMoveTaskToGroup,
  onMoveTaskToTop,
  onStartRenameTask,
  onArchiveTask,
  onMarkTaskAsUnread,
  dragId,
  dragging,
  dragOverlay,
  tooltipsDisabled,
}: {
  task: CfTaskMeta;
  currentGroupId?: string;
  groups: TaskGroupMenuItem[];
  remoteSessionId?: string;
  activeWorkspacePath: string;
  activeWorkspaceIdentity?: string;
  activeTaskId: string | null;
  mobileActiveTaskKey?: string | null;
  workspaceLabel: string;
  onSelectTask: (workspacePath: string, taskId: string, workspaceIdentity?: string) => void;
  onCloseTask: (task: CfTaskMeta) => void;
  onOpenFileTree?: (task: CfTaskMeta) => void;
  onMoveTaskToGroup: (task: CfTaskMeta, groupId: string | null) => void;
  onMoveTaskToTop: (task: CfTaskMeta) => void;
  onStartRenameTask: (task: CfTaskMeta) => void;
  onArchiveTask: (task: CfTaskMeta) => void;
  onMarkTaskAsUnread: (task: CfTaskMeta) => void;
  dragId?: UniqueIdentifier;
  dragging?: boolean;
  dragOverlay?: boolean;
  tooltipsDisabled?: boolean;
}) {
  const { intl } = useCfIntl();
  const workspaceActionsDisabled = useOptionalTabStore((state) =>
    isWorkspaceReadOnly(state, task.workspacePath, task.workspaceIdentity),
  );
  const workspaceActionsDisabledReason = workspaceActionsDisabled
    ? intl.formatMessage({ id: "workspaceSidebar.unavailableLocalDirectory" })
    : undefined;
  const snoozeInteractionAutoResolution = useTaskInteractionAutoResolutionSnooze({
    workspacePath: task.workspacePath,
    ...(task.workspaceIdentity ? { workspaceIdentity: task.workspaceIdentity } : {}),
    ...(remoteSessionId ? { remoteSessionId } : {}),
    sessionId: task.taskId,
  });
  const workspaceKey = buildTaskWorkspaceKey(task.workspacePath, task.workspaceIdentity);
  const taskActivity = getTaskListRowActivity(task);
  const taskAttention = getTaskListAttention(task);
  const hasPendingInteraction = Boolean(task.pendingInteraction) || taskAttention !== null;
  const canOpenFileTree =
    Boolean(onOpenFileTree) && (!task.workspaceIdentity?.trim() || Boolean(remoteSessionId));
  const taskAttentionLabel = taskAttention
    ? intl.formatMessage({
        id: taskAttention.kind === "userInput" ? "taskList.userInputTag" : "taskList.permissionTag",
      })
    : null;
  const taskAttentionDisplay =
    taskAttention && taskAttentionLabel && taskAttention.count > 1
      ? intl.formatMessage(
          { id: "taskList.attentionCount" },
          { label: taskAttentionLabel, count: String(taskAttention.count) },
        )
      : taskAttentionLabel;
  const leadingIndicator = deriveTaskLeadingIndicator(task, taskActivity);
  const taskTitle =
    task.title ||
    intl.formatMessage({
      id: task.forkedFromTaskId ? "taskList.forkedUntitled" : "taskList.untitled",
    });
  const taskChangeParts = formatGroupedTaskHoverChangeParts(getTaskChangeSummary(task));
  const taskTimeLabel = formatTaskRelativeTime(task.updatedAt, intl);
  const isTaskCron = isCronTask(task);
  const isTaskOffPeak = isOffPeakTask(task);
  const isActive =
    buildTaskWorkspaceKey(activeWorkspacePath, activeWorkspaceIdentity) === workspaceKey &&
    activeTaskId === task.taskId;
  const isMobileActive = mobileActiveTaskKey === `${workspaceKey}:${task.taskId}`;
  const statusDotClassName =
    leadingIndicator === "error"
      ? "bg-destructive"
      : leadingIndicator === "unread"
        ?
          "bg-sky-500 dark:bg-sky-400"
        : null;
  const canShowHoverActions = !dragOverlay;
  const workflowRunLinesNode =
    taskActivity?.workflowActivity && !dragOverlay ? (
      <TaskWorkflowRunLines
        activity={taskActivity.workflowActivity}
        isActive={isActive}
        intl={intl}
        session={{
          workspacePath: task.workspacePath,
          ...(task.workspaceIdentity ? { workspaceIdentity: task.workspaceIdentity } : {}),
          sessionId: task.taskId,
        }}
      />
    ) : null;

  const taskRow = (
    <div
      role={dragOverlay ? undefined : "button"}
      tabIndex={dragOverlay ? undefined : 0}
      data-mobile-active-task={!dragOverlay && isMobileActive ? "true" : undefined}
      className={cn(
        "group/task-row",
        TASK_GROUP_ROW_CLASS,
        dragOverlay
          ? "pointer-events-none cursor-grabbing border border-border bg-background shadow-lg opacity-100"
          : "cursor-pointer",
        isActive ? "bg-selected" : canShowHoverActions && "hover:bg-surface-hover",
        dragging && "opacity-0",
      )}
    >
      <span className={TASK_GROUP_ROW_LINE_CLASS}>
        <TaskTitleOverflowText
          as="span"
          className="text-foreground"
          title={dragOverlay ? undefined : taskTitle}
        >
          {}
          {taskTitle}
        </TaskTitleOverflowText>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-ui-sm text-foreground-subtle">
          {task.pendingInteraction ? (
            <TaskInteractionBadge
              interaction={task.pendingInteraction}
              formatMessage={(id) => intl.formatMessage({ id })}
              onSnoozeCountdown={dragOverlay ? undefined : snoozeInteractionAutoResolution}
            />
          ) : taskAttentionDisplay ? (
            <Badge
              className={cn(
                "h-5 border-transparent bg-success/14 px-2 text-ui-base font-medium text-success dark:bg-success/18",
                canShowHoverActions && "group-hover/task-row:hidden",
              )}
            >
              {taskAttentionDisplay}
            </Badge>
          ) : null}
          <span
            className={cn(
              "flex shrink-0 items-center gap-1",
              canShowHoverActions && "group-hover/task-row:hidden",
            )}
          >
            {leadingIndicator === "loading" ? (
              <LoaderIcon className="size-3.5 animate-spin text-foreground-subtle" />
            ) : statusDotClassName ? (
              <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
                <span className={cn("size-1.5 rounded-full", statusDotClassName)} />
              </span>
            ) : null}
            {!hasPendingInteraction && isTaskCron ? (
              <Clock
                data-cron-task-icon="true"
                aria-label={intl.formatMessage({ id: "taskList.cronTaskLabel" })}
                className="size-3.5 shrink-0"
              />
            ) : !hasPendingInteraction && isTaskOffPeak ? (
              <Moon
                data-off-peak-task-icon="true"
                aria-label={intl.formatMessage({ id: "taskList.offPeakTaskLabel" })}
                className="size-3.5 shrink-0"
              />
            ) : null}
            {!hasPendingInteraction ? <span className="mr-1">{taskTimeLabel}</span> : null}
          </span>
        </span>
      </span>
    </div>
  );

  if (dragOverlay) return taskRow;

  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [taskRowHovered, setTaskRowHovered] = useState(false);
  const [taskRowFocusWithin, setTaskRowFocusWithin] = useState(false);
  const [isHoverNone] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(hover: none)").matches,
  );
  const openFeedbackSubmit = useFeedbackStore((state) => state.openSubmit);
  const {
    taskSessionFile,
    taskNativeSessionLogFile,
    providerConfigFile,
    fileManagerLabel,
    handleCopyText,
    handleOpenTaskPathInFileManager,
    handleOpenProviderConfig,
  } = useTaskListItemContextActions({
    workspacePath: task.workspacePath,
    remoteSessionId,
    workspaceIdentity: task.workspaceIdentity,
    taskId: task.taskId,
    provider: task.provider,
    intl,
    loadTaskPaths: contextMenuOpen,
    loadProviderConfig: contextMenuOpen,
  });
  const handleSelect = () => {
    onSelectTask(task.workspacePath, task.taskId, task.workspaceIdentity);
  };
  const handleCloseTask = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (workspaceActionsDisabled) {
      return;
    }
    onCloseTask(task);
  };
  const handleOpenFileTree = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (workspaceActionsDisabled) {
      return;
    }
    onOpenFileTree?.(task);
  };
  const handleMoveTaskToTop = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (workspaceActionsDisabled) {
      return;
    }
    onMoveTaskToTop(task);
  };
  const handleOpenTaskFeedback = async () => {
    openFeedbackSubmit({
      title: intl
        .formatMessage(
          { id: "feedback.submit.template.section.taskFeedbackTitle" },
          { title: taskTitle },
        )
        .slice(0, 80),
      type: "bug",
      module: "Agent task execution failed",
      severity: "P2-中",
      includeLogs: true,
      description: buildTaskFeedbackDescription({
        taskTitle,
        taskId: task.taskId,
        workspacePath: task.workspacePath,
        taskSessionPath: taskSessionFile.path,
        taskLogPath: taskNativeSessionLogFile.path,
        formatMessage: (id: string, values?: Record<string, string>) =>
          intl.formatMessage({ id }, values),
      }),
      screenshots: [],
    });
    toast(intl.formatMessage({ id: "taskList.feedbackOpened" }));
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    handleSelect();
  };
  const dragDisabled = workspaceActionsDisabled || !dragId || contextMenuOpen || dragOverlay;
  const draggable = useDraggable({
    id: dragId ?? `disabled:${workspaceKey}:${task.taskId}`,
    disabled: dragDisabled,
    data: { type: "grouped-task", taskKey: dragId },
  });
  const droppable = useDroppable({
    id: dragId ?? `disabled-drop:${workspaceKey}:${task.taskId}`,
    disabled: workspaceActionsDisabled || !dragId || dragOverlay,
    data: { type: "grouped-task", taskKey: dragId },
  });

  const setTaskRowRef = (element: HTMLDivElement | null) => {
    draggable.setNodeRef(element);
    droppable.setNodeRef(element);
  };
  const groupedTaskDomKey = typeof dragId === "string" ? encodeURIComponent(dragId) : undefined;
  const shouldMountHoverActions =
    !task.pendingInteraction &&
    (taskRowHovered || taskRowFocusWithin || isHoverNone || isMobileActive);
  const shouldSuppressTaskMetadata = taskRowHovered || taskRowFocusWithin;

  const interactiveTaskRow = (
    <div
      ref={setTaskRowRef}
      {...draggable.attributes}
      {...draggable.listeners}
      role="button"
      tabIndex={0}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setTaskRowHovered(true)}
      onMouseLeave={() => setTaskRowHovered(false)}
      onFocusCapture={() => setTaskRowFocusWithin(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setTaskRowFocusWithin(false);
        }
      }}
      data-grouped-task-key={groupedTaskDomKey}
      data-testid={testId(TID_TASK_ITEM, task.taskId)}
      data-task-item-key={groupedTaskDomKey}
      data-mobile-active-task={isMobileActive ? "true" : undefined}
      className={cn(
        "group/task-row",
        TASK_GROUP_ROW_CLASS,
        "cursor-pointer",
        isActive ? "bg-selected" : "hover:bg-surface-hover",
        dragging && "opacity-0",
      )}
    >
      <span className={TASK_GROUP_ROW_LINE_CLASS}>
        <TaskTitleOverflowText as="span" className="text-foreground" title={taskTitle}>
          {}
          {taskTitle}
        </TaskTitleOverflowText>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-ui-sm text-foreground-subtle">
          {task.pendingInteraction ? (
            <TaskInteractionBadge
              interaction={task.pendingInteraction}
              formatMessage={(id) => intl.formatMessage({ id })}
              onSnoozeCountdown={snoozeInteractionAutoResolution}
            />
          ) : taskAttentionDisplay && !shouldSuppressTaskMetadata ? (
            <Badge className="h-5 border-transparent bg-success/14 px-2 text-ui-base font-medium text-success dark:bg-success/18">
              {taskAttentionDisplay}
            </Badge>
          ) : null}
          {!shouldSuppressTaskMetadata ? (
            <span className="flex shrink-0 items-center gap-1">
              {leadingIndicator === "loading" ? (
                <LoaderIcon className="size-3.5 animate-spin text-foreground-subtle" />
              ) : statusDotClassName ? (
                <span
                  aria-hidden="true"
                  className="flex size-4 shrink-0 items-center justify-center"
                >
                  <span className={cn("size-1.5 rounded-full", statusDotClassName)} />
                </span>
              ) : null}
              {!hasPendingInteraction && isTaskCron ? (
                <Clock
                  data-cron-task-icon="true"
                  aria-label={intl.formatMessage({ id: "taskList.cronTaskLabel" })}
                  className="size-3.5 shrink-0"
                />
              ) : !hasPendingInteraction && isTaskOffPeak ? (
                <Moon
                  data-off-peak-task-icon="true"
                  aria-label={intl.formatMessage({ id: "taskList.offPeakTaskLabel" })}
                  className="size-3.5 shrink-0"
                />
              ) : null}
              {!hasPendingInteraction ? <span className="mr-1">{taskTimeLabel}</span> : null}
            </span>
          ) : null}
          {shouldMountHoverActions ? (
            <span className="flex shrink-0 items-center gap-0.5">
              {canOpenFileTree ? (
                <TaskRowActionButton
                  label={intl.formatMessage({ id: "git.action.showTree" })}
                  onClick={handleOpenFileTree}
                  showTooltip
                  disabledReason={workspaceActionsDisabledReason}
                >
                  <ListTree className="size-3.5" />
                </TaskRowActionButton>
              ) : null}
              <TaskRowActionButton
                label={intl.formatMessage({ id: "taskGroup.moveToTop" })}
                onClick={handleMoveTaskToTop}
                showTooltip
                disabledReason={workspaceActionsDisabledReason}
              >
                <ArrowUpToLine className="size-3.5" />
              </TaskRowActionButton>
              <TaskRowActionButton
                label={intl.formatMessage({ id: "common.close" })}
                onClick={handleCloseTask}
                showTooltip
                disabledReason={workspaceActionsDisabledReason}
              >
                <X className="size-3.5" />
              </TaskRowActionButton>
            </span>
          ) : null}
        </span>
      </span>
      {workflowRunLinesNode}
    </div>
  );

  return (
    <ContextMenu onOpenChange={setContextMenuOpen}>
      {tooltipsDisabled ? (
        <ContextMenuTrigger asChild>{interactiveTaskRow}</ContextMenuTrigger>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <ContextMenuTrigger asChild>{interactiveTaskRow}</ContextMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right" align="center" sideOffset={6}>
            {remoteSessionId ? (
              <Cloud aria-hidden="true" className="size-3.5 shrink-0" />
            ) : (
              <Folder aria-hidden="true" className="size-3.5 shrink-0" />
            )}
            <span className="min-w-0 max-w-48 truncate">{workspaceLabel}</span>
            {taskChangeParts.length > 0 ? (
              <>
                <span className="text-tooltip-foreground/60">·</span>
                <span className="inline-flex shrink-0 items-center gap-1">
                  {taskChangeParts.map((part) => (
                    <span
                      key={part}
                      className={part.startsWith("+") ? "text-diff-added" : "text-diff-removed"}
                    >
                      {part}
                    </span>
                  ))}
                </span>
              </>
            ) : null}
          </TooltipContent>
        </Tooltip>
      )}
      {contextMenuOpen ? (
        <GroupedTaskContextMenuContent
          task={task}
          currentGroupId={currentGroupId}
          groups={groups}
          intl={intl}
          fileManagerLabel={fileManagerLabel}
          taskSessionFile={taskSessionFile}
          taskNativeSessionLogFile={taskNativeSessionLogFile}
          providerConfigFile={providerConfigFile}
          onMoveTaskToGroup={onMoveTaskToGroup}
          onMoveTaskToTop={onMoveTaskToTop}
          onStartRenameTask={onStartRenameTask}
          onArchiveTask={onArchiveTask}
          onMarkTaskAsUnread={onMarkTaskAsUnread}
          onOpenTaskPathInFileManager={() => void handleOpenTaskPathInFileManager()}
          onCopyText={(label, text) => void handleCopyText(label, text)}
          onOpenProviderConfig={() => void handleOpenProviderConfig()}
          onOpenTaskFeedback={() => void handleOpenTaskFeedback()}
          disabledReason={workspaceActionsDisabledReason}
        />
      ) : null}
    </ContextMenu>
  );
}
export const GroupedTaskRow = memo(GroupedTaskRowComponent);
