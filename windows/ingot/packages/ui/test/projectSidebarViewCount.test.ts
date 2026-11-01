import { describe, expect, it } from "vitest";
import type { ProjectTask, ProjectTree } from "@/project-sidebar/contract.js";
import { countProjectTreeUnreadTasks } from "@/project-sidebar/view.js";

const task = (id: string, overrides: Partial<ProjectTask> = {}): ProjectTask => ({
  taskId: id,
  projectId: "p1",
  hostId: "local",
  pinned: false,
  archived: false,
  workspacePath: "/repo",
  title: id,
  mode: "build",
  traceId: id,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const project = (id: string, hostId: string, deleted = false): VirtualProject => ({
  id,
  hostId,
  name: id,
  nameOverridden: false,
  roots: [],
  position: 0,
  pinned: false,
  deleted,
});

const tree = (
  tasks: ProjectTask[],
  projects: VirtualProject[] = [project("p1", "local")],
): ProjectTree => ({ projects, tasks });

describe("countProjectTreeUnreadTasks", () => {
  it("只统计非归档且有 unreadAt 的任务", () => {
    expect(
      countProjectTreeUnreadTasks(
        tree([
          task("a", { unreadAt: 100 }),
          task("b", { unreadAt: undefined }),
          task("c", { unreadAt: 300, archived: true }),
        ]),
      ),
    ).toBe(1);
  });

  it("Deduplicate by host+workspace+task: same-named tasks on different hosts are counted separately", () => {
    expect(
      countProjectTreeUnreadTasks(
        tree(
          [
            task("a", { unreadAt: 100 }),
            task("b", { unreadAt: 200 }),
            task("a", { unreadAt: 300, hostId: "remote:server" }),
          ],
          [project("p1", "local"), project("p1", "remote:server")],
        ),
      ),
    ).toBe(3);
  });

  it("空树计 0", () => {
    expect(countProjectTreeUnreadTasks(tree([]))).toBe(0);
  });

  it("Orphaned tasks (non-existent project) are excluded: unread items without blue dot anchors produce no ghost alerts", () => {
    expect(
      countProjectTreeUnreadTasks(
        tree([task("orphan", { unreadAt: 100, projectId: "ghost" })]),
      ),
    ).toBe(0);
  });

  it("Unread items in soft-deleted projects are excluded (sidebar does not render deleted projects)", () => {
    expect(
      countProjectTreeUnreadTasks(
        tree(
          [
            task("a", { unreadAt: 100 }),
            task("ghost", { unreadAt: 200, projectId: "p-deleted" }),
          ],
          [project("p1", "local"), project("p-deleted", "local", true)],
        ),
      ),
    ).toBe(1);
  });

  it("Pinned tasks are visible across projects: pinned unread items in soft-deleted projects are still counted", () => {
    expect(
      countProjectTreeUnreadTasks(
        tree(
          [task("pinned", { unreadAt: 100, pinned: true, projectId: "p-deleted" })],
          [project("p1", "local"), project("p-deleted", "local", true)],
        ),
      ),
    ).toBe(1);
  });

  it("Local project-less tasks (projectId null + host local) are counted", () => {
    expect(
      countProjectTreeUnreadTasks(
        tree([task("local-task", { unreadAt: 100, projectId: null })]),
      ),
    ).toBe(1);
  });
});
