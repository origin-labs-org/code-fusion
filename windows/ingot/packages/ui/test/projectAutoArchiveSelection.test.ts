// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProjectTask, ProjectTree } from "@/project-sidebar/contract.js";
import { useProjectTree } from "@/project-sidebar/useProjectTree.js";
const fixture = vi.hoisted(() => ({
  read: vi.fn(),
  remove: vi.fn(),
  tabs: [],
  activity: { items: [] },
}));
const services = {
  projectService: {},
  remoteProjectService: {},
  broadcastService: { onMessage: () => ({ dispose() {} }) },
  cfTaskService: { onDynamicWorkspaceEvent: () => () => ({ dispose() {} }) },
};
vi.mock("@/hooks/useWorkspaceServices.js", () => ({ useBaseWorkspaceServices: () => services }));
vi.mock("@/store/TabStoreProvider.js", () => ({
  useTabStore: (select: (state: unknown) => unknown) => select({ tabs: fixture.tabs }),
  useTabStoreApi: () => ({ subscribe: () => () => {} }),
}));
vi.mock("@/store/cfSessionStore.js", () => ({
  useCfSessionStore: Object.assign(
    (select: (state: unknown) => unknown) =>
      select({ workspaces: {}, removeTaskState: fixture.remove }),
    { subscribe: () => () => {} },
  ),
}));
vi.mock("@/v4/useWorkspaceSessionsIndexItems.js", () => ({
  useWorkspaceSessionsIndexItems: () => fixture.activity,
}));
vi.mock("@/project-sidebar/project-tree-reader.js", () => ({
  readProjectSidebarTree: fixture.read,
}));
const task = (overrides: Partial<ProjectTask> = {}): ProjectTask => ({
  taskId: "same",
  hostId: "local",
  workspacePath: "/repo",
  title: "1111",
  projectId: null,
  archived: false,
  pinned: false,
  createdAt: 1,
  updatedAt: 2,
  traceId: "s",
  mode: "default",
  ...overrides,
});
const result = (tasks: ProjectTask[]) => ({
  tree: { projects: [], tasks } as ProjectTree,
  availability: new Map(),
  directory: { hosts: [], entries: [] },
});
beforeEach(() => {
  vi.clearAllMocks();
  services.projectService = {};
  fixture.read.mockResolvedValue(result([task(), task({ taskId: "next", unreadAt: 20 })]));
});
afterEach(cleanup);
it("Reuse UI cleanup when accepting auto-archive results, preserving another unread task with the same name; repeated reads do not duplicate cleanup", async () => {
  const hook = renderHook(useProjectTree);
  await act(async () => {});
  fixture.read.mockResolvedValue(
    result([task({ archived: true }), task({ taskId: "next", unreadAt: 20 })]),
  );
  await act(() => hook.result.current.refresh());
  expect(fixture.remove).toHaveBeenCalledExactlyOnceWith("/repo", "same", undefined);
  expect(hook.result.current.tree.tasks[1]?.unreadAt).toBe(20);
  await act(() => hook.result.current.refresh());
  expect(fixture.remove).toHaveBeenCalledOnce();
});
it("Initial read of archived history and offline missing rows do not clean up explicitly opened tasks", async () => {
  fixture.read.mockResolvedValue(result([task({ archived: true })]));
  const hook = renderHook(useProjectTree);
  await act(async () => {});
  fixture.read.mockResolvedValue(result([]));
  await act(() => hook.result.current.refresh());
  expect(fixture.remove).not.toHaveBeenCalled();
});
it("Clean up different Hosts with the same path/task ID by full identity", async () => {
  const a = task({ hostId: "remote:server:a", workspaceIdentity: "remote:server:a:/repo" });
  const b = task({ hostId: "remote:server:b", workspaceIdentity: "remote:server:b:/repo" });
  fixture.read.mockResolvedValue(result([a, b]));
  const hook = renderHook(useProjectTree);
  await act(async () => {});
  fixture.read.mockResolvedValue(result([a, { ...b, archived: true }]));
  await act(() => hook.result.current.refresh());
  expect(fixture.remove).toHaveBeenCalledExactlyOnceWith("/repo", "same", b.workspaceIdentity);
});
it("Late archive responses after service migration cannot clean up current tasks retained by the new tree", async () => {
  const hook = renderHook(useProjectTree);
  await act(async () => {});
  let resolve!: (value: ReturnType<typeof result>) => void;
  fixture.read.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  let first!: Promise<void>;
  act(() => {
    first = hook.result.current.refresh();
  });
  act(() => {
    services.projectService = {};
    hook.rerender();
  });
  await act(async () => {});
  expect(fixture.read).toHaveBeenCalledTimes(3);
  expect(hook.result.current.tree.tasks[0]?.archived).toBe(false);
  await act(async () => {
    resolve(result([task({ archived: true })]));
    await first;
  });
  expect(fixture.remove).not.toHaveBeenCalled();
  expect(hook.result.current.tree.tasks[0]?.archived).toBe(false);
});
