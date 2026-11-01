// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Emitter } from "@origin-ai/cf-rpc";
import type { WindowHostTaskUnreadSignal } from "@origin-ai/cf-shared";
import { useProjectUnreadSignals } from "@/project-sidebar/useProjectUnreadSignals.js";
import { createTabStore, type TabStore } from "@/store/tabStore.js";
import { useCfSessionStore } from "@/store/cfSessionStore.js";

const TARGET = {
  taskId: "task",
  workspacePath: "/repo",
  workspaceIdentity: "remote:server:source:/repo",
};

const mocks = vi.hoisted(() => ({
  services: null as unknown as {
    windowControllerService: {
      onDynamicTaskUnreadSignal: ReturnType<typeof vi.fn>;
      mutateTask: ReturnType<typeof vi.fn>;
    };
    cfTaskService: Record<string, unknown>;
  },
  tabs: null as TabStore | null,
}));

vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useBaseWorkspaceServices: () => mocks.services,
}));
vi.mock("@/store/TabStoreProvider.js", () => ({
  useTabStoreApi: () => mocks.tabs,
}));
vi.mock("@/hooks/usePlatform.js", () => ({
  useOptionalPlatform: () => null,
}));

const signalEmitter = new Emitter<WindowHostTaskUnreadSignal>();
const refresh = vi.fn(async () => {});
const MARKER = 11;

const fireTerminal = () =>
  signalEmitter.fire({
    address: { ...TARGET },
    updatedAt: Date.now(),
    status: "completed",
});

const mutateTaskCalls = () =>
  vi.mocked(mocks.services.windowControllerService.mutateTask).mock.calls;

beforeEach(() => {
  mocks.tabs = createTabStore(null);
  mocks.services = {
    windowControllerService: {
      onDynamicTaskUnreadSignal: vi.fn(() => signalEmitter.event),
      mutateTask: vi.fn(async () => ({ unreadAt: MARKER })),
    },
    cfTaskService: { setTaskUnread: vi.fn() },
  };
  mocks.tabs.getState().addTab("/repo", { workspaceIdentity: TARGET.workspaceIdentity });
  useCfSessionStore
    .getState()
    .setActiveTaskId("/repo", TARGET.taskId, TARGET.workspaceIdentity);
  useCfSessionStore.setState({
    taskNavHistory: {
      entries: [
        {
          kind: "task",
          taskId: TARGET.taskId,
          workspacePath: TARGET.workspacePath,
          workspaceIdentity: TARGET.workspaceIdentity,
        },
      ],
      cursor: 0,
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("project sidebar foreground completion unread", () => {
  it("Foreground completion does not immediately mark unread (backfilled upon leaving)", async () => {
    renderHook(() => useProjectUnreadSignals([{ workspacePath: "/repo" }], refresh));
    await act(async () => fireTerminal());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mutateTaskCalls()).toHaveLength(0);
  });

  it("Backfill unread and refresh tree on leaving window (blur)", async () => {
    renderHook(() => useProjectUnreadSignals([{ workspacePath: "/repo" }], refresh));
    await act(async () => fireTerminal());
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    await waitFor(() => expect(mutateTaskCalls()).toHaveLength(1));
    expect(mutateTaskCalls()[0]?.[0]).toEqual({
      address: {
        workspacePath: TARGET.workspacePath,
        workspaceIdentity: TARGET.workspaceIdentity,
        taskId: TARGET.taskId,
        sourceServerId: "source",
      },
      mutation: { kind: "mark-unread" },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("Directly backfill if page is already hidden (minimized) when signal arrives", async () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    renderHook(() => useProjectUnreadSignals([{ workspacePath: "/repo" }], refresh));
    await act(async () => fireTerminal());
    await waitFor(() => expect(mutateTaskCalls()).toHaveLength(1));
    expect(mutateTaskCalls()[0]?.[0]?.mutation).toEqual({ kind: "mark-unread" });
  });

  it("Auto-clear by marker when returning to window with task still in view (no need to navigate away and back)", async () => {
    renderHook(() => useProjectUnreadSignals([{ workspacePath: "/repo" }], refresh));
    await act(async () => fireTerminal());
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    await waitFor(() => expect(mutateTaskCalls()).toHaveLength(1));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(mutateTaskCalls()).toHaveLength(2));
    expect(mutateTaskCalls()[1]?.[0]).toEqual({
      address: {
        workspacePath: TARGET.workspacePath,
        workspaceIdentity: TARGET.workspaceIdentity,
        taskId: TARGET.taskId,
        sourceServerId: "source",
      },
      mutation: { kind: "mark-read", expectedUnreadAt: MARKER },
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mutateTaskCalls()).toHaveLength(2);
  });

  it("Returning to window but no longer viewing: retain unread as reminder to handle later", async () => {
    renderHook(() => useProjectUnreadSignals([{ workspacePath: "/repo" }], refresh));
    await act(async () => fireTerminal());
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    await waitFor(() => expect(mutateTaskCalls()).toHaveLength(1));
    useCfSessionStore.setState({
      taskNavHistory: {
        entries: [
          {
            kind: "task",
            taskId: "other",
            workspacePath: "/repo",
            workspaceIdentity: TARGET.workspaceIdentity,
          },
        ],
        cursor: 0,
      },
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mutateTaskCalls()).toHaveLength(1);
  });

  it("No record lost on backfill failure: successful retry on next blur (CR-01)", async () => {
    renderHook(() => useProjectUnreadSignals([{ workspacePath: "/repo" }], refresh));
    await act(async () => fireTerminal());
    vi
      .mocked(mocks.services.windowControllerService.mutateTask)
      .mockRejectedValueOnce(new Error("source temporarily offline"));
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    await waitFor(() => expect(mutateTaskCalls()).toHaveLength(1));
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    await waitFor(() => expect(mutateTaskCalls()).toHaveLength(2));
    expect(mutateTaskCalls()[1]?.[0]?.mutation).toEqual({ kind: "mark-unread" });
  });

  it("blur → completion signal → focus: backfill unread and auto-clear on focus (SG-01 event sequence)", async () => {
    renderHook(() => useProjectUnreadSignals([{ workspacePath: "/repo" }], refresh));
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await act(async () => fireTerminal());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mutateTaskCalls()).toHaveLength(0);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(mutateTaskCalls()).toHaveLength(2));
    expect(mutateTaskCalls()[0]?.[0]?.mutation).toEqual({ kind: "mark-unread" });
    expect(mutateTaskCalls()[1]?.[0]).toEqual({
      address: {
        workspacePath: TARGET.workspacePath,
        workspaceIdentity: TARGET.workspaceIdentity,
        taskId: TARGET.taskId,
        sourceServerId: "source",
      },
      mutation: { kind: "mark-read", expectedUnreadAt: MARKER },
    });
  });

  it("Rapid focus and visibility restore triggers auto mark-read only once (SG-01 deduplication)", async () => {
    renderHook(() => useProjectUnreadSignals([{ workspacePath: "/repo" }], refresh));
    await act(async () => fireTerminal());
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    await waitFor(() => expect(mutateTaskCalls()).toHaveLength(1));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(mutateTaskCalls()).toHaveLength(2));
    expect(mutateTaskCalls()[1]?.[0]?.mutation).toEqual({
      kind: "mark-read",
      expectedUnreadAt: MARKER,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mutateTaskCalls()).toHaveLength(2);
  });

  it("effect 重跑不丢在途补写：写入跨 effect 收敛（CR-01 回归）", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { rerender } = renderHook(() =>
      useProjectUnreadSignals([{ workspacePath: "/repo" }], refresh),
    );
    await act(async () => fireTerminal());
    const oldMutate = vi.mocked(mocks.services.windowControllerService.mutateTask);
    oldMutate.mockImplementationOnce(async () => {
      await gate;
      return { unreadAt: MARKER };
    });
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(oldMutate).toHaveBeenCalledTimes(1);
    await act(async () => {
      mocks.services = {
        ...mocks.services,
        windowControllerService: {
          onDynamicTaskUnreadSignal: vi.fn(() => signalEmitter.event),
          mutateTask: vi.fn(async () => ({ unreadAt: MARKER })),
        },
      };
      rerender();
    });
    const newMutate = vi.mocked(mocks.services.windowControllerService.mutateTask);
    await act(async () => {
      release();
    });
    await waitFor(() => expect(oldMutate).toHaveBeenCalledTimes(1));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(newMutate).toHaveBeenCalledTimes(1));
    expect(newMutate.mock.calls[0]?.[0]?.mutation).toEqual({
      kind: "mark-read",
      expectedUnreadAt: MARKER,
    });
  });

  it("Immediate focus while blur backfill is in flight: wait for backfill completion then auto-clear (CR-01 interleaved timing)", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    renderHook(() => useProjectUnreadSignals([{ workspacePath: "/repo" }], refresh));
    await act(async () => fireTerminal());
    vi
      .mocked(mocks.services.windowControllerService.mutateTask)
      .mockImplementationOnce(async () => {
        await gate;
        return { unreadAt: MARKER };
      });
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(mutateTaskCalls()).toHaveLength(1);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mutateTaskCalls()).toHaveLength(1);
    await act(async () => {
      release();
    });
    await waitFor(() => expect(mutateTaskCalls()).toHaveLength(2));
    expect(mutateTaskCalls()[0]?.[0]?.mutation).toEqual({ kind: "mark-unread" });
    expect(mutateTaskCalls()[1]?.[0]).toEqual({
      address: {
        workspacePath: TARGET.workspacePath,
        workspaceIdentity: TARGET.workspaceIdentity,
        taskId: TARGET.taskId,
        sourceServerId: "source",
      },
      mutation: { kind: "mark-read", expectedUnreadAt: MARKER },
    });
  });

  it("Completion while not viewing still immediately marks unread (existing behavior regression)", async () => {
    useCfSessionStore.setState({
      taskNavHistory: {
        entries: [
          {
            kind: "task",
            taskId: "other",
            workspacePath: "/repo",
            workspaceIdentity: TARGET.workspaceIdentity,
          },
        ],
        cursor: 0,
      },
    });
    renderHook(() => useProjectUnreadSignals([{ workspacePath: "/repo" }], refresh));
    await act(async () => fireTerminal());
    await waitFor(() => expect(mutateTaskCalls()).toHaveLength(1));
    expect(mutateTaskCalls()[0]?.[0]?.mutation).toEqual({ kind: "mark-unread" });
  });

  it("blur backfill fails → focus retry succeeds → auto-clear when task is still in view (CR-01 closed loop)", async () => {
    renderHook(() => useProjectUnreadSignals([{ workspacePath: "/repo" }], refresh));
    await act(async () => fireTerminal());
    vi
      .mocked(mocks.services.windowControllerService.mutateTask)
      .mockRejectedValueOnce(new Error("source temporarily offline"));
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    await waitFor(() => expect(mutateTaskCalls()).toHaveLength(1));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(mutateTaskCalls()).toHaveLength(3));
    expect(mutateTaskCalls()[1]?.[0]?.mutation).toEqual({ kind: "mark-unread" });
    expect(mutateTaskCalls()[2]?.[0]).toEqual({
      address: {
        workspacePath: TARGET.workspacePath,
        workspaceIdentity: TARGET.workspaceIdentity,
        taskId: TARGET.taskId,
        sourceServerId: "source",
      },
      mutation: { kind: "mark-read", expectedUnreadAt: MARKER },
    });
  });

  it("卸载后 focus 不再触发任何写入（监听器随 effect 清理）", async () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() =>
      useProjectUnreadSignals([{ workspacePath: "/repo" }], refresh),
    );
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("focus", expect.any(Function));
    const callsBefore = mutateTaskCalls().length;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("blur"));
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mutateTaskCalls().length).toBe(callsBefore);
  });

  it("多次前台完成只补写一次（去重），blur 后集合清空", async () => {
    renderHook(() => useProjectUnreadSignals([{ workspacePath: "/repo" }], refresh));
    await act(async () => {
      fireTerminal();
      fireTerminal();
      fireTerminal();
    });
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    await waitFor(() => expect(mutateTaskCalls()).toHaveLength(1));
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mutateTaskCalls()).toHaveLength(1);
  });
});
