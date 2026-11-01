import type { CfGroupedTaskViewNode } from "@/project-sidebar/grouped/types.js";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { taskKey } from "@/project-sidebar/grouped/ids.js";
import {
  isPotentialVerticalScrollContainer,
  scrollGroupedTaskVirtualizerToOffset,
} from "@/project-sidebar/grouped/virtualized-scroll.js";

const GROUPED_TOP_LEVEL_TASK_ROW_ESTIMATE_PX = 32;
const GROUPED_TOP_LEVEL_GROUP_HEADER_ESTIMATE_PX = 40;
const GROUPED_TOP_LEVEL_VIRTUALIZATION_THRESHOLD = 80;
const GROUPED_TOP_LEVEL_VIRTUALIZATION_OVERSCAN = 12;

function shouldVirtualizeGroupedTopLevelNodes(nodeCount: number): boolean {
  return nodeCount > GROUPED_TOP_LEVEL_VIRTUALIZATION_THRESHOLD;
}

function getTopLevelNodeKey(node: CfGroupedTaskViewNode | undefined, index: number): string {
  if (!node) {
    return `missing:${index}`;
  }
  return node.type === "group" ? `group:${node.group.id}` : `task:${taskKey(node.task)}`;
}

function estimateTopLevelNodeSize(
  node: CfGroupedTaskViewNode | undefined,
  isGroupCollapsed: (groupId: string) => boolean,
): number {
  if (!node || node.type === "task") {
    return GROUPED_TOP_LEVEL_TASK_ROW_ESTIMATE_PX;
  }
  if (isGroupCollapsed(node.group.id)) {
    return GROUPED_TOP_LEVEL_GROUP_HEADER_ESTIMATE_PX;
  }
  return (
    GROUPED_TOP_LEVEL_GROUP_HEADER_ESTIMATE_PX +
    Math.min(node.tasks.length, 24) * GROUPED_TOP_LEVEL_TASK_ROW_ESTIMATE_PX
  );
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

function VirtualizedGroupedTopLevelList({
  nodes,
  isGroupCollapsed,
  renderNode,
}: {
  nodes: CfGroupedTaskViewNode[];
  isGroupCollapsed: (groupId: string) => boolean;
  renderNode: (node: CfGroupedTaskViewNode, index: number) => ReactNode;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const shouldVirtualize = shouldVirtualizeGroupedTopLevelNodes(nodes.length);
  const getItemKey = useCallback(
    (index: number) => getTopLevelNodeKey(nodes[index], index),
    [nodes],
  );
  const estimateSize = useCallback(
    (index: number) => estimateTopLevelNodeSize(nodes[index], isGroupCollapsed),
    [isGroupCollapsed, nodes],
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
  }, [nodes.length, shouldVirtualize, updateScrollMargin]);

  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? nodes.length : 0,
    getScrollElement: () => scrollElement,
    estimateSize,
    getItemKey,
    overscan: GROUPED_TOP_LEVEL_VIRTUALIZATION_OVERSCAN,
    scrollMargin,
    scrollToFn: scrollGroupedTaskVirtualizerToOffset,
    initialOffset: resolveInitialScrollOffset,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  const renderedVirtualNodes = useMemo(
    () =>
      virtualRows.map((virtualRow) => {
        const node = nodes[virtualRow.index];
        if (!node) {
          return null;
        }
        return (
          <div
            key={virtualRow.key}
            ref={rowVirtualizer.measureElement}
            className="absolute left-0 top-0 w-full"
            data-index={virtualRow.index}
            style={{
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
            }}
          >
            {renderNode(node, virtualRow.index)}
          </div>
        );
      }),
    [nodes, renderNode, rowVirtualizer.measureElement, scrollMargin, virtualRows],
  );

  if (!shouldVirtualize) {
    return <>{nodes.map((node, index) => renderNode(node, index))}</>;
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
      {renderedVirtualNodes}
    </div>
  );
}

export {
  GROUPED_TOP_LEVEL_VIRTUALIZATION_THRESHOLD,
  VirtualizedGroupedTopLevelList,
  shouldVirtualizeGroupedTopLevelNodes,
};
