import type { ProjectTask as CfTaskMeta } from "@/project-sidebar/contract.js";
import type {
  CfGroupedTaskView,
  CfGroupedTaskViewNode,
  GroupedDraftTaskPlacement,
} from "@/project-sidebar/grouped/types.js";

import { taskKey } from "@/project-sidebar/grouped/ids.js";

function cloneView(view: CfGroupedTaskView): CfGroupedTaskView {
  return {
    nodes: view.nodes.map((node) =>
      node.type === "task" ? { ...node } : { ...node, tasks: [...node.tasks] },
    ),
  };
}

function cloneNodes(view: CfGroupedTaskView): CfGroupedTaskViewNode[] {
  return [...view.nodes];
}

function cloneGroupNode(
  node: Extract<CfGroupedTaskViewNode, { type: "group" }>,
): Extract<CfGroupedTaskViewNode, { type: "group" }> {
  return { ...node, tasks: [...node.tasks] };
}

function removeTaskFromView(
  view: CfGroupedTaskView,
  targetTaskKey: string,
): {
  nextView: CfGroupedTaskView;
  task: CfTaskMeta | null;
} {
  const nodes = cloneNodes(view);
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node) {
      continue;
    }
    if (node.type === "task" && taskKey(node.task) === targetTaskKey) {
      nodes.splice(index, 1);
      return { nextView: { nodes }, task: node.task };
    }
    if (node.type === "group") {
      const taskIndex = node.tasks.findIndex((task) => taskKey(task) === targetTaskKey);
      if (taskIndex >= 0) {
        const nextGroupNode = cloneGroupNode(node);
        const [task] = nextGroupNode.tasks.splice(taskIndex, 1);
        nodes[index] = nextGroupNode;
        return { nextView: { nodes }, task: task ?? null };
      }
    }
  }
  return { nextView: { nodes }, task: null };
}

function insertTaskIntoGroup(
  view: CfGroupedTaskView,
  task: CfTaskMeta,
  groupId: string,
  beforeTaskKey: string | null,
): CfGroupedTaskView {
  const nodes = cloneNodes(view);
  const groupIndex = nodes.findIndex((node) => node.type === "group" && node.group.id === groupId);
  const groupNode = nodes[groupIndex];
  if (!groupNode || groupNode.type !== "group") {
    return { nodes };
  }
  const nextGroupNode = cloneGroupNode(groupNode);
  const insertIndex =
    beforeTaskKey === null
      ? nextGroupNode.tasks.length
      : nextGroupNode.tasks.findIndex((item) => taskKey(item) === beforeTaskKey);
  nextGroupNode.tasks.splice(insertIndex < 0 ? nextGroupNode.tasks.length : insertIndex, 0, task);
  nodes[groupIndex] = nextGroupNode;
  return { nodes };
}

function removeTaskFromGroupedView(
  view: CfGroupedTaskView,
  targetTaskKey: string,
): CfGroupedTaskView {
  const nextView = cloneView(view);
  for (const node of nextView.nodes) {
    if (node.type !== "group") {
      continue;
    }
    const taskIndex = node.tasks.findIndex((task) => taskKey(task) === targetTaskKey);
    if (taskIndex >= 0) {
      node.tasks.splice(taskIndex, 1);
      return nextView;
    }
  }

  const nodeIndex = nextView.nodes.findIndex(
    (node) => node.type === "task" && taskKey(node.task) === targetTaskKey,
  );
  if (nodeIndex >= 0) {
    nextView.nodes.splice(nodeIndex, 1);
  }
  return nextView;
}

function filterGroupedViewByTaskKeys(
  view: CfGroupedTaskView,
  hiddenTaskKeys: ReadonlySet<string>,
): CfGroupedTaskView {
  if (hiddenTaskKeys.size === 0) {
    return view;
  }

  let changed = false;
  const nodes: CfGroupedTaskView["nodes"] = [];
  for (const node of view.nodes) {
    if (node.type === "task") {
      if (!hiddenTaskKeys.has(taskKey(node.task))) {
        nodes.push(node);
      } else {
        changed = true;
      }
      continue;
    }

    const tasks = node.tasks.filter((task) => !hiddenTaskKeys.has(taskKey(task)));
    if (tasks.length === node.tasks.length) {
      nodes.push(node);
      continue;
    }
    changed = true;
    nodes.push({ ...node, tasks });
  }

  return changed ? { nodes } : view;
}

function findTaskInGroupedView(
  view: CfGroupedTaskView,
  targetTaskKey: string,
): CfTaskMeta | null {
  for (const node of view.nodes) {
    if (node.type === "task" && taskKey(node.task) === targetTaskKey) {
      return node.task;
    }
    if (node.type === "group") {
      const task = node.tasks.find((item) => taskKey(item) === targetTaskKey);
      if (task) {
        return task;
      }
    }
  }
  return null;
}

function replaceTaskInGroupedView(
  view: CfGroupedTaskView,
  nextTask: CfTaskMeta,
): CfGroupedTaskView {
  const targetTaskKey = taskKey(nextTask);
  return {
    nodes: view.nodes.map((node) => {
      if (node.type === "task") {
        return taskKey(node.task) === targetTaskKey ? { ...node, task: nextTask } : node;
      }
      return {
        ...node,
        tasks: node.tasks.map((task) => (taskKey(task) === targetTaskKey ? nextTask : task)),
      };
    }),
  };
}

function getGroupedTaskGroupIds(view: CfGroupedTaskView): string[] {
  return view.nodes.flatMap((node) => (node.type === "group" ? [node.group.id] : []));
}

function areAllGroupedTaskGroupsExpanded(
  groupIds: readonly string[],
  collapsedGroupIds: ReadonlySet<string>,
): boolean {
  return groupIds.length > 0 && groupIds.every((groupId) => !collapsedGroupIds.has(groupId));
}

function pruneCollapsedGroupedTaskGroupIds(
  collapsedGroupIds: ReadonlySet<string>,
  groupIds: readonly string[],
): Set<string> {
  const knownGroupIds = new Set(groupIds);
  return new Set([...collapsedGroupIds].filter((groupId) => knownGroupIds.has(groupId)));
}

function getTaskGroupIdInView(view: CfGroupedTaskView, targetTaskKey: string): string | null {
  for (const node of view.nodes) {
    if (node.type !== "group") {
      continue;
    }
    if (node.tasks.some((task) => taskKey(task) === targetTaskKey)) {
      return node.group.id;
    }
  }
  return null;
}

type GroupedTaskLocation =
  | {
      parent: "root";
      nodeIndex: number;
      task: CfTaskMeta;
    }
  | {
      parent: "group";
      groupId: string;
      nodeIndex: number;
      taskIndex: number;
      task: CfTaskMeta;
    };

type GroupedTaskInsertPosition = "before" | "after";

function findTopLevelTaskIndex(view: CfGroupedTaskView, targetTaskKey: string): number {
  return view.nodes.findIndex(
    (node) => node.type === "task" && taskKey(node.task) === targetTaskKey,
  );
}

function findGroupIndex(view: CfGroupedTaskView, groupId: string): number {
  return view.nodes.findIndex((node) => node.type === "group" && node.group.id === groupId);
}

function findGroupIdByTaskKey(view: CfGroupedTaskView, targetTaskKey: string): string | null {
  for (const node of view.nodes) {
    if (node.type !== "group") {
      continue;
    }
    if (node.tasks.some((task) => taskKey(task) === targetTaskKey)) {
      return node.group.id;
    }
  }
  return null;
}

function findTaskLocation(
  view: CfGroupedTaskView,
  targetTaskKey: string,
): GroupedTaskLocation | null {
  for (let nodeIndex = 0; nodeIndex < view.nodes.length; nodeIndex += 1) {
    const node = view.nodes[nodeIndex];
    if (!node) {
      continue;
    }
    if (node.type === "task" && taskKey(node.task) === targetTaskKey) {
      return { parent: "root", nodeIndex, task: node.task };
    }
    if (node.type === "group") {
      const taskIndex = node.tasks.findIndex((task) => taskKey(task) === targetTaskKey);
      if (taskIndex >= 0) {
        const task = node.tasks[taskIndex];
        if (!task) {
          return null;
        }
        return {
          parent: "group",
          groupId: node.group.id,
          nodeIndex,
          taskIndex,
          task,
        };
      }
    }
  }
  return null;
}

function resolveGroupedDraftTaskPlacementForTask(
  view: CfGroupedTaskView,
  targetTaskKey: string | null | undefined,
): GroupedDraftTaskPlacement {
  if (!targetTaskKey) {
    return { type: "top" };
  }
  const location = findTaskLocation(view, targetTaskKey);
  return location?.parent === "group"
    ? { type: "group", groupId: location.groupId }
    : { type: "top" };
}

function insertTaskNearTask(
  view: CfGroupedTaskView,
  task: CfTaskMeta,
  overTaskKey: string,
  position: GroupedTaskInsertPosition,
): CfGroupedTaskView {
  const nodes = cloneNodes(view);
  const overLocation = findTaskLocation({ nodes }, overTaskKey);
  if (!overLocation) {
    return { nodes };
  }

  if (overLocation.parent === "root") {
    const insertIndex = overLocation.nodeIndex + (position === "after" ? 1 : 0);
    nodes.splice(insertIndex, 0, { type: "task", task });
    return { nodes };
  }

  const groupNode = nodes[overLocation.nodeIndex];
  if (!groupNode || groupNode.type !== "group") {
    return { nodes };
  }
  const nextGroupNode = cloneGroupNode(groupNode);
  const insertIndex = overLocation.taskIndex + (position === "after" ? 1 : 0);
  nextGroupNode.tasks.splice(insertIndex, 0, task);
  nodes[overLocation.nodeIndex] = nextGroupNode;
  return { nodes };
}

function moveTaskOverTask(
  view: CfGroupedTaskView,
  params: {
    activeTaskKey: string;
    overTaskKey: string;
    position: GroupedTaskInsertPosition;
  },
): CfGroupedTaskView {
  if (params.activeTaskKey === params.overTaskKey) {
    return view;
  }
  const activeLocation = findTaskLocation(view, params.activeTaskKey);
  const overLocation = findTaskLocation(view, params.overTaskKey);
  if (!activeLocation || !overLocation) {
    return view;
  }

  const { nextView, task } = removeTaskFromView(view, params.activeTaskKey);
  if (!task) {
    return view;
  }

  return insertTaskNearTask(nextView, task, params.overTaskKey, params.position);
}

function insertTaskAroundGroup(
  view: CfGroupedTaskView,
  task: CfTaskMeta,
  groupId: string,
  position: GroupedTaskInsertPosition,
): CfGroupedTaskView {
  const nodes = cloneNodes(view);
  const groupIndex = nodes.findIndex((node) => node.type === "group" && node.group.id === groupId);
  if (groupIndex < 0) {
    return { nodes };
  }
  nodes.splice(groupIndex + (position === "after" ? 1 : 0), 0, { type: "task", task });
  return { nodes };
}

function moveTaskToRootAroundGroup(
  view: CfGroupedTaskView,
  params: {
    activeTaskKey: string;
    groupId: string;
    position: GroupedTaskInsertPosition;
  },
): CfGroupedTaskView {
  const groupNode = view.nodes.find(
    (node) => node.type === "group" && node.group.id === params.groupId,
  );
  if (!groupNode || groupNode.type !== "group") {
    return view;
  }

  const { nextView, task } = removeTaskFromView(view, params.activeTaskKey);
  if (!task) {
    return view;
  }

  return insertTaskAroundGroup(nextView, task, params.groupId, params.position);
}

function moveTaskToGroupStart(
  view: CfGroupedTaskView,
  params: {
    activeTaskKey: string;
    groupId: string;
  },
): CfGroupedTaskView {
  const { nextView, task } = removeTaskFromView(view, params.activeTaskKey);
  if (!task) {
    return view;
  }
  const groupNode = nextView.nodes.find(
    (node) => node.type === "group" && node.group.id === params.groupId,
  );
  if (!groupNode || groupNode.type !== "group") {
    return view;
  }
  const firstTaskKey = groupNode.tasks[0] ? taskKey(groupNode.tasks[0]) : null;
  return insertTaskIntoGroup(nextView, task, params.groupId, firstTaskKey);
}

function moveTaskToGroupEnd(
  view: CfGroupedTaskView,
  params: {
    activeTaskKey: string;
    groupId: string;
  },
): CfGroupedTaskView {
  const { nextView, task } = removeTaskFromView(view, params.activeTaskKey);
  if (!task) {
    return view;
  }
  const groupIndex = findGroupIndex(nextView, params.groupId);
  const groupNode = nextView.nodes[groupIndex];
  if (!groupNode || groupNode.type !== "group") {
    return view;
  }
  const nextGroupNode = cloneGroupNode(groupNode);
  nextGroupNode.tasks.push(task);
  const nodes = cloneNodes(nextView);
  nodes[groupIndex] = nextGroupNode;
  return { nodes };
}

function moveGroupAroundTopLevelNode(
  view: CfGroupedTaskView,
  params: {
    activeGroupId: string;
    over:
      | {
          type: "group";
          groupId: string;
        }
      | {
          type: "task";
          taskKey: string;
        };
    position: GroupedTaskInsertPosition;
  },
): CfGroupedTaskView {
  if (params.over.type === "group" && params.activeGroupId === params.over.groupId) {
    return view;
  }
  const overGroupId =
    params.over.type === "task" ? findGroupIdByTaskKey(view, params.over.taskKey) : null;
  if (overGroupId === params.activeGroupId) {
    return view;
  }
  const nodes = cloneNodes(view);
  const activeIndex = nodes.findIndex(
    (node) => node.type === "group" && node.group.id === params.activeGroupId,
  );
  if (activeIndex < 0) {
    return view;
  }
  const [activeNode] = nodes.splice(activeIndex, 1);
  if (!activeNode || activeNode.type !== "group") {
    return view;
  }
  const nextView = { nodes };
  const overIndex =
    params.over.type === "group"
      ? findGroupIndex(nextView, params.over.groupId)
      : overGroupId
        ? findGroupIndex(nextView, overGroupId)
        : findTopLevelTaskIndex(nextView, params.over.taskKey);
  if (overIndex < 0) {
    return view;
  }
  nodes.splice(overIndex + (params.position === "after" ? 1 : 0), 0, activeNode);
  return { nodes };
}

function getNodeIdAfterGroup(
  view: CfGroupedTaskView,
  groupId: string,
): CfGroupedTaskViewNode | null {
  const groupIndex = view.nodes.findIndex(
    (node) => node.type === "group" && node.group.id === groupId,
  );
  return groupIndex >= 0 ? (view.nodes[groupIndex + 1] ?? null) : null;
}

function insertTaskBeforeTopLevelNode(
  view: CfGroupedTaskView,
  task: CfTaskMeta,
  beforeNode: CfGroupedTaskViewNode | null,
): CfGroupedTaskView {
  const nodes = cloneNodes(view);
  const insertIndex =
    beforeNode === null
      ? nodes.length
      : nodes.findIndex((node) =>
          beforeNode.type === "group"
            ? node.type === "group" && node.group.id === beforeNode.group.id
            : node.type === "task" && taskKey(node.task) === taskKey(beforeNode.task),
        );
  nodes.splice(insertIndex < 0 ? nodes.length : insertIndex, 0, {
    type: "task",
    task,
  });
  return { nodes };
}

function moveTaskByMenu(
  view: CfGroupedTaskView,
  targetTask: CfTaskMeta,
  targetGroupId: string | null,
): CfGroupedTaskView {
  const targetTaskKey = taskKey(targetTask);
  const currentGroupId = getTaskGroupIdInView(view, targetTaskKey);
  if (currentGroupId === targetGroupId) {
    return view;
  }

  const { nextView, task } = removeTaskFromView(view, targetTaskKey);
  if (!task) {
    return view;
  }
  if (targetGroupId) {
    return insertTaskIntoGroup(nextView, task, targetGroupId, null);
  }

  const beforeNode = currentGroupId ? getNodeIdAfterGroup(view, currentGroupId) : null;
  return insertTaskBeforeTopLevelNode(nextView, task, beforeNode);
}

function moveTaskToTopByMenu(
  view: CfGroupedTaskView,
  targetTask: CfTaskMeta,
): CfGroupedTaskView {
  const targetTaskKey = taskKey(targetTask);
  const location = findTaskLocation(view, targetTaskKey);
  if (
    !location ||
    (location.parent === "root" && location.nodeIndex === 0) ||
    (location.parent === "group" && location.taskIndex === 0)
  ) {
    return view;
  }

  const { nextView, task } = removeTaskFromView(view, targetTaskKey);
  if (!task) {
    return view;
  }

  if (location.parent === "group") {
    const groupNode = nextView.nodes.find(
      (node) => node.type === "group" && node.group.id === location.groupId,
    );
    if (!groupNode || groupNode.type !== "group") {
      return view;
    }
    const firstTaskKey = groupNode.tasks[0] ? taskKey(groupNode.tasks[0]) : null;
    return insertTaskIntoGroup(nextView, task, location.groupId, firstTaskKey);
  }

  return {
    nodes: [{ type: "task", task }, ...nextView.nodes],
  };
}

export {
  areAllGroupedTaskGroupsExpanded,
  cloneView,
  filterGroupedViewByTaskKeys,
  findTaskInGroupedView,
  getGroupedTaskGroupIds,
  moveTaskByMenu,
  moveGroupAroundTopLevelNode,
  moveTaskToTopByMenu,
  moveTaskToGroupEnd,
  moveTaskToGroupStart,
  moveTaskToRootAroundGroup,
  moveTaskOverTask,
  pruneCollapsedGroupedTaskGroupIds,
  removeTaskFromGroupedView,
  replaceTaskInGroupedView,
  resolveGroupedDraftTaskPlacementForTask,
};
export type { GroupedTaskInsertPosition };
