// @vitest-environment jsdom
import { createElement, useLayoutEffect, useState } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProjectTree } from "@/project-sidebar/useProjectTree.js";
import type { ProjectTask, ProjectTree } from "@/project-sidebar/contract.js";

const mocks = vi.hoisted(() => ({
  services: {} as Record<string, unknown>,
  tabs: [],
  read: vi.fn(),
}));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useBaseWorkspaceServices: () => mocks.services,
}));
vi.mock("@/store/TabStoreProvider.js", () => ({
  useTabStore: () => mocks.tabs,
  useTabStoreApi: () => ({ subscribe: () => () => {} }),
}));
vi.mock("@/store/cfSessionStore.js", () => ({
  useCfSessionStore: Object.assign(() => 0, { subscribe: () => () => {} }),
}));
vi.mock("@/v4/useWorkspaceSessionsIndexItems.js", () => ({
  useWorkspaceSessionsIndexItems: () => ({ items: [] }),
}));
vi.mock("@/project-sidebar/project-tree-reader.js", () => ({
  readProjectSidebarTree: () => mocks.read(),
}));
vi.mock("@/logger.js", () => ({ logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const task = {
  taskId: "new",
  workspacePath: "/same",
  workspaceIdentity: "remote:one",
  hostId: "one",
  projectId: "p",
  archived: false,
} as ProjectTask;
const resultOf = (tasks: ProjectTask[] = []) => ({
  tree: { projects: [], tasks } as ProjectTree,
  availability: new Map(),
  directory: { hosts: [], entries: [] },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let owner!: ReturnType<typeof useProjectTree>;
let setDetail!: (id: string) => void;
const frames: Array<{ detail: string; rows: string[] }> = [];
function App() {
  owner = useProjectTree();
  const [detail, select] = useState("draft");
  setDetail = select;
  useLayoutEffect(() => {
    frames.push({ detail, rows: owner.tree.tasks.map((row) => row.taskId) });
  });
  return createElement("div", { "data-testid": "detail" }, detail);
}
beforeEach(() => {
  mocks.read.mockReset();
  mocks.services = {
    projectService: {},
    cfTaskService: { onDynamicWorkspaceEvent: () => () => ({ dispose() {} }) },
    broadcastService: { onMessage: () => ({ dispose() {} }) },
  };
  frames.length = 0;
});
afterEach(cleanup);

it("FSV03: Continuous invalidation merged reads; initial directory and details committed together, matched by full identity", async () => {
  const first = deferred<ReturnType<typeof resultOf>>();
  const second = deferred<ReturnType<typeof resultOf>>();
  mocks.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  render(createElement(App));
  let completed!: Promise<void>;
  act(() => {
    completed = owner.commitCreatedTask(task, () => setDetail(task.taskId));
    for (let i = 0; i < 20; i++) void owner.refresh();
  });
  expect(mocks.read).toHaveBeenCalledTimes(1);
  await act(async () => {
    first.resolve(resultOf([{ ...task, workspaceIdentity: "remote:other" }]));
  });
  expect(screen.getByTestId("detail").textContent).toBe("draft");
  expect(mocks.read).toHaveBeenCalledTimes(2);
  await act(async () => {
    second.resolve(resultOf([task]));
    await completed;
  });
  expect(screen.getByTestId("detail").textContent).toBe("new");
  expect(
    frames.filter((frame) => frame.detail === "new").every((frame) => frame.rows.includes("new")),
  ).toBe(true);
  expect(mocks.read).toHaveBeenCalledTimes(2);
});

it("FSV04: Late directory after navigation cancellation does not invoke original pane callback", async () => {
  const read = deferred<ReturnType<typeof resultOf>>();
  mocks.read.mockReturnValue(read.promise);
  const app = render(createElement(App));
  const commit = vi.fn();
  const abort = new AbortController();
  let completed!: Promise<void>;
  act(() => {
    completed = owner.commitCreatedTask(task, commit, abort.signal);
    abort.abort();
  });
  await completed;
  app.unmount();
  await act(async () => {
    read.resolve(resultOf([task]));
  });
  expect(commit).not.toHaveBeenCalled();
});

it("FSV04: Read failure rejects initial UI completion and does not enter details early", async () => {
  mocks.read.mockResolvedValue(resultOf());
  render(createElement(App));
  await waitFor(() => expect(owner.loading).toBe(false));
  mocks.read.mockRejectedValue(new Error("offline"));
  const commit = vi.fn();
  await act(async () => {
    await expect(owner.commitCreatedTask(task, commit)).rejects.toThrow("offline");
  });
  expect(commit).not.toHaveBeenCalled();
  expect(owner.error).toContain("offline");
});

it("FSV04: Service migration accepts new directory; old responses do not overwrite or navigate", async () => {
  const old = deferred<ReturnType<typeof resultOf>>();
  mocks.read.mockReturnValueOnce(old.promise).mockResolvedValue(resultOf());
  const app = render(createElement(App));
  const commit = vi.fn();
  let completed!: Promise<void>;
  act(() => {
    completed = owner.commitCreatedTask(task, commit);
  });
  mocks.services = { ...mocks.services, projectService: {} };
  app.rerender(createElement(App));
  await completed;
  await waitFor(() => expect(owner.loading).toBe(false));
  await act(async () => {
    old.resolve(resultOf([task]));
  });
  expect(owner.tree.tasks).toEqual([]);
  expect(commit).not.toHaveBeenCalled();
});

it.each(["admit", "group-read"])("CR-01: %s suspension does not block directory, initial delivery, or other tasks", async (stage) => {
  const first = deferred<ReturnType<typeof resultOf>>();
  const held = deferred<void>();
  const other = { ...task, taskId: "other" };
  mocks.read.mockReturnValueOnce(first.promise).mockResolvedValue(resultOf([task, other]));
  render(createElement(App));
  const abort = new AbortController();
  const admit = vi.fn(() => (stage === "admit" ? held.promise : Promise.resolve()));
  const reread = vi.fn(() => (stage === "group-read" ? held.promise : Promise.resolve()));
  const organize = vi.fn(async () => {
    await admit();
    await reread();
  });
  const otherCommit = vi.fn();
  let finished = 0;
  act(() => {
    void owner
      .commitCreatedTask(task, () => setDetail(task.taskId), abort.signal, organize)
      .then(() => {
        finished++;
      });
    void owner.commitCreatedTask(other, otherCommit).then(() => {
      finished++;
    });
  });
  await act(async () => {
    first.resolve(resultOf([task, other]));
  });
  expect(screen.getByTestId("detail").textContent).toBe(task.taskId);
  expect(owner.tree.tasks.map((row) => row.taskId)).toEqual([task.taskId, other.taskId]);
  expect(finished).toBe(2);
  expect(otherCommit).toHaveBeenCalledOnce();
  const reads = mocks.read.mock.calls.length;
  await act(async () => {
    abort.abort();
    void owner.refresh();
  });
  expect(mocks.read.mock.calls.length).toBeGreaterThan(reads);
  expect(organize).toHaveBeenCalledOnce();
  expect(owner.error).toBeNull();
  await act(async () => {
    held.resolve();
  });
});

it.each([false, true])(
  "CR-01: Cancellation before directory confirmation ends UI immediately, still performs one organize action (canceled=%s)",
  async (alreadyAborted) => {
    const first = deferred<ReturnType<typeof resultOf>>();
    mocks.read.mockReturnValueOnce(first.promise).mockResolvedValue(resultOf([task]));
    render(createElement(App));
    const abort = new AbortController();
    if (alreadyAborted) abort.abort();
    const organize = vi.fn(async () => {});
    const commit = vi.fn();
    let finished = false;
    await act(async () => {
      void owner.commitCreatedTask(task, commit, abort.signal, organize).then(() => {
        finished = true;
      });
      abort.abort();
    });
    expect(finished).toBe(true);
    expect(organize).not.toHaveBeenCalled();
    await act(async () => {
      first.resolve(resultOf([task]));
    });
    await act(async () => {
      await owner.refresh();
    });
    expect(owner.tree.tasks).toHaveLength(1);
    expect(commit).not.toHaveBeenCalled();
    expect(organize).toHaveBeenCalledOnce();
  },
);

it("CR-01: Organize failure does not overwrite directory error or reject confirmed initial delivery", async () => {
  mocks.read.mockResolvedValue(resultOf([task]));
  render(createElement(App));
  await waitFor(() => expect(owner.loading).toBe(false));
  const commit = vi.fn();
  const organize = vi.fn(async () => {
    throw new Error("group unavailable");
  });
  await act(async () => {
    await owner.commitCreatedTask(task, commit, undefined, organize);
  });
  expect(owner.error).toBeNull();
  expect(owner.tree.tasks).toHaveLength(1);
  expect(commit).toHaveBeenCalledOnce();
  expect(organize).toHaveBeenCalledOnce();
});
