import { describe, expect, it } from "vitest";
import type { ProjectTask, TaskGroupStructure } from "@/project-sidebar/contract.js";
import { buildGroupedTaskView, groupedMoveCommand } from "@/project-sidebar/grouped/model.js";
import {
  moveTaskToGroupStart,
  moveTaskToRootAroundGroup,
  moveGroupAroundTopLevelNode,
  moveTaskToTopByMenu,
} from "@/project-sidebar/grouped/view.js";
import { taskKey } from "@/project-sidebar/grouped/ids.js";
import { groupTaskRef, taskGroupKey } from "@/project-sidebar/grouped-view.js";

const task = (id: string, extra = {}): ProjectTask => ({
  taskId: id,
  workspacePath: "/workspace",
  hostId: "local",
  projectId: null,
  title: id,
  mode: "build",
  traceId: id,
  pinned: false,
  archived: false,
  createdAt: 1,
  updatedAt: 2,
  ...extra,
});
const a = task("a"),
  b = task("b"),
  hidden = task("hidden", { archived: true });
const structure: TaskGroupStructure = {
  groups: [
    { id: "g", title: "Group", color: "blue", createdAt: 1, updatedAt: 1 },
    { id: "empty", title: "Empty", color: "gray", createdAt: 1, updatedAt: 1 },
  ],
  members: [
    { groupId: "g", workspaceKey: a.workspacePath, taskId: a.taskId, sortOrder: 0 },
    { groupId: "g", workspaceKey: hidden.workspacePath, taskId: hidden.taskId, sortOrder: 1 },
  ],
  order: [
    { type: "group", key: "g", sortOrder: 0 },
    { type: "task", key: taskGroupKey(b), sortOrder: 1 },
    { type: "group", key: "empty", sortOrder: 2 },
  ],
};
const origin = () => buildGroupedTaskView([a, b, hidden], structure);

describe("GRP11: Legacy drag semantics only submits a single node, does not write back visible list", () => {
  it("Dragging into an empty group preserves legacy preview; submit retains source and excludes hidden members", () => {
    const view = origin();
    const preview = moveTaskToGroupStart(view, { activeTaskKey: taskKey(a), groupId: "empty" });
    expect(groupedMoveCommand(view, preview, { type: "task", task: groupTaskRef(a) })).toEqual({
      node: { type: "task", task: groupTaskRef(a) },
      sourceGroupId: "g",
      groupId: "empty",
    });
    expect(structure.members).toHaveLength(2);
    expect(view.nodes[0]).toMatchObject({ type: "group", tasks: [a] });
  });
  it("Dragging past a collapsed group preserves legacy top-level relative order, must not be mistaken for joining group", () => {
    const view = origin();
    const preview = moveTaskToRootAroundGroup(view, {
      activeTaskKey: taskKey(a),
      groupId: "empty",
      position: "after",
    });
    expect(groupedMoveCommand(view, preview, { type: "task", task: groupTaskRef(a) })).toEqual({
      node: { type: "task", task: groupTaskRef(a) },
      sourceGroupId: "g",
      groupId: null,
      anchor: { node: { type: "group", groupId: "empty" }, side: "after" },
    });
  });
  it("Interleaved groups and top-level tasks only moves the current group", () => {
    const view = origin();
    const preview = moveGroupAroundTopLevelNode(view, {
      activeGroupId: "empty",
      over: { type: "task", taskKey: taskKey(b) },
      position: "before",
    });
    expect(groupedMoveCommand(view, preview, { type: "group", groupId: "empty" })).toEqual({
      node: { type: "group", groupId: "empty" },
      sourceGroupId: null,
      groupId: null,
      anchor: { node: { type: "task", task: groupTaskRef(b) }, side: "before" },
    });
  });
  it("Legacy move to top only adjusts within current level, does not pin to top or change project", () => {
    const view = origin();
    const preview = moveTaskToTopByMenu(view, b);
    expect(groupedMoveCommand(view, preview, { type: "task", task: groupTaskRef(b) })).toEqual({
      node: { type: "task", task: groupTaskRef(b) },
      sourceGroupId: null,
      groupId: null,
      anchor: { node: { type: "group", groupId: "g" }, side: "before" },
    });
    expect(b.pinned).toBe(false);
    expect(b.projectId).toBeNull();
  });
  it("Cancel, no-op move, and split-screen takeover produce no reorganize commands", () => {
    const view = origin();
    expect(groupedMoveCommand(view, view, { type: "task", task: groupTaskRef(a) })).toBeNull();
  });
  it("Two Hosts with the same path and taskId do not serialize", () => {
    const remote = task("a", {
      workspaceIdentity: "remote:server:other:/workspace",
      hostId: "remote:server:other",
    });
    const view = buildGroupedTaskView([a, remote], structure);
    const preview = moveTaskToGroupStart(view, { activeTaskKey: taskKey(remote), groupId: "g" });
    expect(
      groupedMoveCommand(view, preview, { type: "task", task: groupTaskRef(remote) }),
    ).toMatchObject({
      node: { task: { workspaceIdentity: remote.workspaceIdentity, hostId: remote.hostId } },
      sourceGroupId: null,
      groupId: "g",
    });
  });
});
