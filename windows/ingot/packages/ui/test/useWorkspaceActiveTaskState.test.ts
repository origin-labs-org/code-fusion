// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CfTaskMeta } from "@origin-ai/cf-shared";
import { useWorkspaceActiveTaskState } from "@/hooks/useWorkspaceActiveTaskState.js";

const fixture = vi.hoisted(() => ({
  service: { getTaskMeta: vi.fn(), onDynamicWorkspaceEvent: vi.fn() },
  readSession: vi.fn(async () => {
    throw new Error("Session is not active");
  }),
  workspace: {
    optimisticTaskListByTaskId: {} as Record<string, CfTaskMeta>,
    taskListCache: [],
    taskListVersion: 0,
  },
  events: new Set<(event: { type: string }) => void>(),
  broadcasts: new Set<(event: { channel: string }) => void>(),
  warning: vi.fn(),
}));
vi.mock("@/hooks/useCfTaskService.js", () => ({ useCfTaskService: () => fixture.service }));
vi.mock("@/hooks/useCfSessionService.js", () => ({
  useCfSessionService: () => ({ readSession: fixture.readSession }),
}));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useBaseWorkspaceServices: () => ({ broadcastService }),
}));
const broadcastService = {
  onMessage: (listener: (event: { channel: string }) => void) => {
    fixture.broadcasts.add(listener);
    return { dispose: () => fixture.broadcasts.delete(listener) };
  },
};
vi.mock("@/logger.js", () => ({ logger: { warn: fixture.warning } }));
vi.mock("@/store/cfSessionStore.js", () => ({
  getTaskMeta: () => null,
  selectWorkspaceCfState: () => fixture.workspace,
  useCfSessionStore: (selector: (state: unknown) => unknown) => selector({}),
}));
vi.mock("@/store/taskQueryCacheStore.js", () => ({
  useTaskQueryCacheStore: (select: (state: unknown) => unknown) =>
    select({ taskMetaByEntityKey: {} }),
}));
vi.mock("@/hooks/useTaskNativeSessionLogFile.js", () => ({
  useTaskNativeSessionLogFile: () => null,
}));
vi.mock("@/hooks/useTaskSessionFilePath.js", () => ({ useTaskSessionFilePath: () => null }));
const meta = (title = "1111"): CfTaskMeta => ({
  taskId: "s",
  title,
  workspacePath: "/repo",
  createdAt: 1,
  updatedAt: 2,
  traceId: "s",
  mode: "default",
});
const params = {
  workspaceAbsPath: "/repo",
  activeTaskId: "s",
  selectedProvider: "codex" as const,
  intl: { formatMessage: ({ id }: { id: string }) => id },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const changed = () =>
  act(() => {
    fixture.events.forEach((listener) => listener({ type: "workspace_task_list_changed" }));
  });
beforeEach(() => {
  vi.clearAllMocks();
  fixture.workspace.optimisticTaskListByTaskId = {};
  fixture.service.getTaskMeta.mockResolvedValue(meta());
  fixture.service.onDynamicWorkspaceEvent.mockImplementation(
    () => (listener: (event: { type: string }) => void) => {
      fixture.events.add(listener);
      return { dispose: () => fixture.events.delete(listener) };
    },
  );
});
afterEach(() => {
  cleanup();
  fixture.events.clear();
  fixture.broadcasts.clear();
});

describe("Current task Host Metadata", () => {
  it("冷历史Title不依赖 CLI active runtime，且响应 Host 重命名", async () => {
    const { result } = renderHook(() => useWorkspaceActiveTaskState(params));
    await waitFor(() => expect(result.current.activeTaskTitle).toBe("1111"));
    expect(fixture.readSession).not.toHaveBeenCalled();
    expect(fixture.service.getTaskMeta).toHaveBeenCalledWith({
      workspacePath: "/repo",
      workspaceIdentity: undefined,
      taskId: "s",
    });
    fixture.service.getTaskMeta.mockResolvedValue({ ...meta("手动Title"), titleOverridden: true });
    changed();
    await waitFor(() => expect(result.current.activeTaskTitle).toBe("手动Title"));
  });
  it("E同Metadata的Refresh保持引用稳定，projects ArchiveEvents也会Refresh", async () => {
    const { result } = renderHook(() => useWorkspaceActiveTaskState(params));
    await waitFor(() => expect(result.current.activeTaskTitle).toBe("1111"));
    const initial = result.current.resolvedActiveTaskMeta;
    fixture.service.getTaskMeta.mockResolvedValue(meta());
    act(() => fixture.broadcasts.forEach((listener) => listener({ channel: "state:projects" })));
    await waitFor(() => expect(fixture.service.getTaskMeta).toHaveBeenCalledTimes(2));
    expect(result.current.resolvedActiveTaskMeta).toBe(initial);
  });
  it("同 ID/路径切换远端身份时立即撤下Legacy title，迟到Result不能覆盖New身份", async () => {
    const old = deferred<CfTaskMeta>();
    const next = deferred<CfTaskMeta>();
    fixture.service.getTaskMeta.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(
      ({ identity }) => useWorkspaceActiveTaskState({ ...params, workspaceIdentity: identity }),
      { initialProps: { identity: "remote:server:a:/repo" } },
    );
    rerender({ identity: "remote:server:b:/repo" });
    expect(result.current.resolvedActiveTaskMeta).toBeNull();
    await act(async () =>
      next.resolve({ ...meta("B"), workspaceIdentity: "remote:server:b:/repo" }),
    );
    await act(async () =>
      old.resolve({ ...meta("A"), workspaceIdentity: "remote:server:a:/repo" }),
    );
    expect(result.current.activeTaskTitle).toBe("B");
    expect(fixture.service.getTaskMeta.mock.calls[1]?.[0].workspaceIdentity).toBe(
      "remote:server:b:/repo",
    );
  });
  it("Refresh乱序只接受最NewRequest，ReadFailed记录Logs且不回退 runtime", async () => {
    const old = deferred<CfTaskMeta>();
    fixture.service.getTaskMeta.mockReturnValueOnce(old.promise);
    const { result } = renderHook(() => useWorkspaceActiveTaskState(params));
    fixture.service.getTaskMeta.mockResolvedValue(meta("新标题"));
    changed();
    await waitFor(() => expect(result.current.activeTaskTitle).toBe("新标题"));
    await act(async () => old.resolve(meta("旧标题")));
    expect(result.current.activeTaskTitle).toBe("新标题");
    fixture.service.getTaskMeta.mockRejectedValueOnce(new Error("offline"));
    changed();
    await waitFor(() => expect(fixture.warning).toHaveBeenCalled());
    expect(result.current.activeTaskTitle).toBe("新标题");
    expect(fixture.readSession).not.toHaveBeenCalled();
  });
  it("已Show的Title在切换Task的首帧即撤下，卸载后释放所有订阅", async () => {
    const pending = deferred<CfTaskMeta>();
    const { result, rerender, unmount } = renderHook(
      ({ taskId }) => useWorkspaceActiveTaskState({ ...params, activeTaskId: taskId }),
      { initialProps: { taskId: "s" } },
    );
    await waitFor(() => expect(result.current.activeTaskTitle).toBe("1111"));
    fixture.service.getTaskMeta.mockReturnValueOnce(pending.promise);
    rerender({ taskId: "next" });
    expect(result.current.resolvedActiveTaskMeta).toBeNull();
    unmount();
    expect(fixture.events.size).toBe(0);
    expect(fixture.broadcasts.size).toBe(0);
    await act(async () => pending.resolve({ ...meta("下一条"), taskId: "next" }));
  });
  it("Initial turn落索引前Allow现有乐观Title，Host Back后以权威Title为准", async () => {
    fixture.workspace.optimisticTaskListByTaskId.s = meta("Initial turnDraft");
    fixture.service.getTaskMeta.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useWorkspaceActiveTaskState(params));
    await waitFor(() => expect(result.current.activeTaskTitle).toBe("Initial turnDraft"));
    fixture.service.getTaskMeta.mockResolvedValue(meta("生成Title"));
    changed();
    await waitFor(() => expect(result.current.activeTaskTitle).toBe("生成Title"));
  });
  it("attachment 重建即使复用 service 对e也不能沿用OldRequest", async () => {
    const pending = deferred<CfTaskMeta>();
    const { result, rerender } = renderHook(
      ({ attachment }) =>
        useWorkspaceActiveTaskState({ ...params, workspaceRemoteSessionId: attachment }),
      { initialProps: { attachment: "old-attachment" } },
    );
    await waitFor(() => expect(result.current.activeTaskTitle).toBe("1111"));
    fixture.service.getTaskMeta.mockReturnValueOnce(pending.promise);
    rerender({ attachment: "new-attachment" });
    expect(result.current.resolvedActiveTaskMeta).toBeNull();
    await act(async () => pending.resolve(meta("NewConnect")));
    expect(result.current.activeTaskTitle).toBe("NewConnect");
  });
});
