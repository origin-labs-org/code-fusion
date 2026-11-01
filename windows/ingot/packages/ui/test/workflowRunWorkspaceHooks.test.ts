// @vitest-environment jsdom

//
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  V4ConversationWorkflowRunNodeResultResult,
  V4ConversationWorkflowRunWorkspaceResult,
} from "@origin-ai/cf-shared/cf-protocol-v4";

vi.mock("@/logger.js", () => ({
  logger: { debug: vi.fn(), warn: vi.fn() },
}));

const workflowRunWorkspace = vi.fn<() => Promise<V4ConversationWorkflowRunWorkspaceResult>>();
const workflowRunNodeResult = vi.fn<() => Promise<V4ConversationWorkflowRunNodeResultResult>>();

vi.mock("@/v4/V4ConversationContext.js", () => ({
  useV4Conversation: () => ({ workflowRunWorkspace, workflowRunNodeResult }),
}));

import { useWorkflowRunWorkspace } from "@/hooks/useWorkflowRunWorkspace.js";
// eslint-disable-next-line import/first
import {
  resetWorkflowRunNodeResultCache,
  useWorkflowRunNodeResult,
} from "@/hooks/useWorkflowRunNodeResult.js";

const SESSION = "parent-a";
const RUN = "dwfrun-1";

const NODE: V4ConversationWorkflowRunWorkspaceResult["nodes"][number] = {
  siteId: "world-read#1",
  ordinal: 1,
  kind: "world-read",
  op: "glob",
  args: ["src/**"],
  status: "completed",
  summary: { resultBytes: 10, resultCount: 1 },
  createdAt: 1,
  updatedAt: 2,
};

beforeEach(() => {
  workflowRunWorkspace.mockReset();
  workflowRunNodeResult.mockReset();
  resetWorkflowRunNodeResultCache();
  workflowRunWorkspace.mockResolvedValue({ nodes: [NODE] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useWorkflowRunWorkspace", () => {
  it("挂载即查One次；loaded 在首次成功后为真", async () => {
    const hook = renderHook(() => useWorkflowRunWorkspace({ sessionId: SESSION, runId: RUN }));
    expect(hook.result.current.loaded).toBe(false);
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    expect(hook.result.current.nodes).toEqual([NODE]);
    expect(workflowRunWorkspace).toHaveBeenCalledTimes(1);
    expect(workflowRunWorkspace).toHaveBeenCalledWith({ sessionId: SESSION, runId: RUN });
  });

  it("RefreshLetterNumber抬升后合并 250 ms 再重查；同One拍里的多次抬升只查One次；不抬升不查", async () => {
    vi.useFakeTimers();
    const hook = renderHook(
      (props: { signal: number }) =>
        useWorkflowRunWorkspace({ sessionId: SESSION, runId: RUN, refreshSignal: props.signal }),
      { initialProps: { signal: 3 } },
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(workflowRunWorkspace).toHaveBeenCalledTimes(1);
    hook.rerender({ signal: 4 });
    hook.rerender({ signal: 5 });
    expect(workflowRunWorkspace).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(260);
      await Promise.resolve();
    });
    expect(workflowRunWorkspace).toHaveBeenCalledTimes(2);
    hook.rerender({ signal: 5 });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(workflowRunWorkspace).toHaveBeenCalledTimes(2);
  });

  it("Capabilities缺席（老 CLI）：unavailable 为真、loaded 为真、没有 error", async () => {
    workflowRunWorkspace.mockRejectedValue(new Error("fault.command.capabilityUnsupported"));
    const hook = renderHook(() => useWorkflowRunWorkspace({ sessionId: SESSION, runId: RUN }));
    await waitFor(() => expect(hook.result.current.unavailable).toBe(true));
    expect(hook.result.current.loaded).toBe(true);
    expect(hook.result.current.error).toBeNull();
  });

  it("别的Error进 error，且切 run 时先丢掉Old清单", async () => {
    const hook = renderHook(
      (props: { runId: string }) =>
        useWorkflowRunWorkspace({ sessionId: SESSION, runId: props.runId }),
      { initialProps: { runId: RUN } },
    );
    await waitFor(() => expect(hook.result.current.nodes).toHaveLength(1));
    workflowRunWorkspace.mockRejectedValue(new Error("boom"));
    hook.rerender({ runId: "dwfrun-2" });
    expect(hook.result.current.nodes).toEqual([]);
    await waitFor(() => expect(hook.result.current.error).toBe("boom"));
    expect(hook.result.current.unavailable).toBe(false);
  });

  it("truncated 随Result透出", async () => {
    workflowRunWorkspace.mockResolvedValue({ nodes: [NODE], truncated: true });
    const hook = renderHook(() => useWorkflowRunWorkspace({ sessionId: SESSION, runId: RUN }));
    await waitFor(() => expect(hook.result.current.truncated).toBe(true));
  });
});

describe("useWorkflowRunNodeResult", () => {
  const body: V4ConversationWorkflowRunNodeResultResult = {
    status: "completed",
    result: ["src/a.ts"],
    truncated: false,
    totalBytes: 12,
  };

  it("enabled 才取；取回后同One节点Second time挂载直接HitCache、不再Question", async () => {
    workflowRunNodeResult.mockResolvedValue(body);
    const args = { sessionId: SESSION, runId: RUN, siteId: "world-read#1", ordinal: 1 };
    const off = renderHook(() => useWorkflowRunNodeResult({ ...args, enabled: false }));
    expect(off.result.current).toEqual({ result: null, loading: false, error: null });
    expect(workflowRunNodeResult).not.toHaveBeenCalled();

    const first = renderHook(() => useWorkflowRunNodeResult(args));
    expect(first.result.current.loading).toBe(true);
    await waitFor(() => expect(first.result.current.result).toEqual(body));
    expect(workflowRunNodeResult).toHaveBeenCalledTimes(1);
    expect(workflowRunNodeResult).toHaveBeenCalledWith(args);

    const second = renderHook(() => useWorkflowRunNodeResult(args));
    expect(second.result.current).toEqual({ result: body, loading: false, error: null });
    expect(workflowRunNodeResult).toHaveBeenCalledTimes(1);
  });

  it("running 行的Answer复不进Cache（下次展开要再Question）；Failed进 error", async () => {
    const running: V4ConversationWorkflowRunNodeResultResult = {
      status: "running",
      truncated: false,
      totalBytes: 0,
    };
    workflowRunNodeResult.mockResolvedValue(running);
    const args = { sessionId: SESSION, runId: RUN, siteId: "world-read#2", ordinal: 1 };
    const first = renderHook(() => useWorkflowRunNodeResult(args));
    await waitFor(() => expect(first.result.current.result).toEqual(running));
    first.unmount();
    renderHook(() => useWorkflowRunNodeResult(args));
    await waitFor(() => expect(workflowRunNodeResult).toHaveBeenCalledTimes(2));

    workflowRunNodeResult.mockRejectedValue(new Error("notFound"));
    const failed = renderHook(() => useWorkflowRunNodeResult({ ...args, siteId: "world-read#9" }));
    await waitFor(() => expect(failed.result.current.error).toBe("notFound"));
    expect(failed.result.current.result).toBeNull();
  });
});
