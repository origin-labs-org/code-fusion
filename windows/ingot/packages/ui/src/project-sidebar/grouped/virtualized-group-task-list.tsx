import type { ProjectTask as CfTaskMeta } from "@/project-sidebar/contract.js";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { GroupedTaskItem } from "@/project-sidebar/grouped/task-item.js";
import { taskKey } from "@/project-sidebar/grouped/ids.js";
import {
  isPotentialVerticalScrollContainer,
  scrollGroupedTaskVirtualizerToOffset,
} from "@/project-sidebar/grouped/virtualized-scroll.js";
import type { TaskGroupMenuItem } from "@/project-sidebar/grouped/types.js";

const GROUPED_TASK_ROW_ESTIMATE_PX = 32;
const GROUPED_TASK_VIRTUALIZATION_THRESHOLD = 80;
const GROUPED_TASK_VIRTUALIZATION_OVERSCAN = 12;

function shouldVirtualizeGroupedTasks(taskCount: number): boolean {
  return taskCount > GROUPED_TASK_VIRTUALIZATION_THRESHOLD;
}

function findNearestScrollableAncestor(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    if (isPotentialVerticalScrollContainer(style.overflowY)) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function resolveScrollMargin(listElement: HTMLElement, scrollElement: HTMLElement): number {
  return (
    listElement.getBoundingClientRect().top -
    scrollElement.getBoundingClientRect().top +
    scrollElement.scrollTop
  );
}

export function VirtualizedGroupedTaskList({
  tasks,
  groupId,
  groups,
  activeWorkspacePath,
  activeWorkspaceIdentity,
  activeTaskId,
  mobileActiveTaskKey,
  getTaskRemoteSessionId,
  getTaskWorkspaceLabel,
  onSelectTask,
  onCloseTask,
  onOpenFileTree,
  onMoveTaskToGroup,
  onMoveTaskToTop,
  onStartRenameTask,
  onArchiveTask,
  onMarkTaskAsUnread,
  activeDragTaskKey,
  tooltipsDisabled,
}: {
  tasks: CfTaskMeta[];
  groupId: string;
  groups: TaskGroupMenuItem[];
  activeWorkspacePath: string;
  activeWorkspaceIdentity?: string;
  activeTaskId: string | null;
  mobileActiveTaskKey?: string | null;
  getTaskRemoteSessionId: (task: CfTaskMeta) => string | undefined;
  getTaskWorkspaceLabel: (task: CfTaskMeta) => string;
  onSelectTask: (workspacePath: string, taskId: string, workspaceIdentity?: string) => void;
  onCloseTask: (task: CfTaskMeta) => void;
  onOpenFileTree?: (task: CfTaskMeta) => void;
  onMoveTaskToGroup: (task: CfTaskMeta, groupId: string | null) => void;
  onMoveTaskToTop: (task: CfTaskMeta) => void;
  onStartRenameTask: (task: CfTaskMeta) => void;
  onArchiveTask: (task: CfTaskMeta) => void;
  onMarkTaskAsUnread: (task: CfTaskMeta) => void;
  activeDragTaskKey?: string | null;
  tooltipsDisabled?: boolean;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const shouldVirtualize = shouldVirtualizeGroupedTasks(tasks.length);
  const getItemKey = useCallback(
    (index: number) => taskKey(tasks[index] ?? { workspacePath: "", taskId: String(index) }),
    [tasks],
  );

  const updateScrollMargin = useCallback(() => {
    const listElement = listRef.current;
    if (!listElement) {
      return;
    }
    const nextScrollElement = findNearestScrollableAncestor(listElement);
    setScrollElement(nextScrollElement);
    if (!nextScrollElement) {
      setScrollMargin(0);
      return;
    }
    setScrollMargin(resolveScrollMargin(listElement, nextScrollElement));
  }, []);
  const resolveInitialScrollOffset = useCallback(() => {
    const listElement = listRef.current;
    const currentScrollElement =
      scrollElement ?? (listElement ? findNearestScrollableAncestor(listElement) : null);
    return currentScrollElement?.scrollTop ?? 0;
  }, [scrollElement]);

  useLayoutEffect(() => {
    if (!shouldVirtualize) {
      setScrollElement(null);
      setScrollMargin(0);
      return undefined;
    }
    updateScrollMargin();
    const listElement = listRef.current;
    const resizeObserver =
      typeof ResizeObserver === "undefined" || !listElement
        ? null
        : new ResizeObserver(updateScrollMargin);
    if (listElement) {
      resizeObserver?.observe(listElement);
    }
    const animationFrame = window.requestAnimationFrame(updateScrollMargin);
    window.addEventListener("resize", updateScrollMargin);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", updateScrollMargin);
      resizeObserver?.disconnect();
    };
  }, [groupId, shouldVirtualize, tasks.length, updateScrollMargin]);

  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? tasks.length : 0,
    getScrollElement: () => scrollElement,
    estimateSize: () => GROUPED_TASK_ROW_ESTIMATE_PX,
    getItemKey,
    overscan: GROUPED_TASK_VIRTUALIZATION_OVERSCAN,
    scrollMargin,
    scrollToFn: scrollGroupedTaskVirtualizerToOffset,
    initialOffset: resolveInitialScrollOffset,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const measureElement = rowVirtualizer.measureElement;

  const renderTask = useCallback(
    (task: CfTaskMeta) => (
      <GroupedTaskItem
        key={taskKey(task)}
        task={task}
        groupId={groupId}
        groups={groups}
        remoteSessionId={getTaskRemoteSessionId(task)}
        workspaceLabel={getTaskWorkspaceLabel(task)}
        activeWorkspacePath={activeWorkspacePath}
        activeWorkspaceIdentity={activeWorkspaceIdentity}
        activeTaskId={activeTaskId}
        mobileActiveTaskKey={mobileActiveTaskKey}
        onSelectTask={onSelectTask}
        onCloseTask={onCloseTask}
        onOpenFileTree={onOpenFileTree}
        onMoveTaskToGroup={onMoveTaskToGroup}
        onMoveTaskToTop={onMoveTaskToTop}
        onStartRenameTask={onStartRenameTask}
        onArchiveTask={onArchiveTask}
        onMarkTaskAsUnread={onMarkTaskAsUnread}
        dragId={taskKey(task)}
        dragging={activeDragTaskKey === taskKey(task)}
        tooltipsDisabled={tooltipsDisabled}
      />
    ),
    [
      activeTaskId,
      activeWorkspaceIdentity,
      activeWorkspacePath,
      getTaskRemoteSessionId,
      getTaskWorkspaceLabel,
      groupId,
      groups,
      mobileActiveTaskKey,
      onArchiveTask,
      onCloseTask,
      onMarkTaskAsUnread,
      onMoveTaskToGroup,
      onMoveTaskToTop,
      onOpenFileTree,
      onSelectTask,
      onStartRenameTask,
      activeDragTaskKey,
      tooltipsDisabled,
    ],
  );

  const renderedVirtualTasks = useMemo(
    () =>
      virtualRows.map((virtualRow) => {
        const task = tasks[virtualRow.index];
        if (!task) {
          return null;
        }
        return (
          <div
            key={virtualRow.key}
            ref={measureElement}
            data-index={virtualRow.index}
            className="absolute left-0 top-0 w-full"
            style={{
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
            }}
          >
            {renderTask(task)}
          </div>
        );
      }),
    [measureElement, renderTask, scrollMargin, tasks, virtualRows],
  );

  if (!shouldVirtualize) {
    return <>{tasks.map((task) => renderTask(task))}</>;
  }

  return (
    <div
      ref={listRef}
      className="relative w-full"
      style={{
        height: `${rowVirtualizer.getTotalSize()}px`,
        overflowAnchor: "none",
      }}
    >
      {}
      {}
      {renderedVirtualTasks}
    </div>
  );
}

export {
  GROUPED_TASK_ROW_ESTIMATE_PX,
  GROUPED_TASK_VIRTUALIZATION_THRESHOLD,
  shouldVirtualizeGroupedTasks,
};
