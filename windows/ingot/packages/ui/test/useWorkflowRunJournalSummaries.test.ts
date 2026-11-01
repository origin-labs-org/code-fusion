// @vitest-environment jsdom

//
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  V4ConversationWorkflowRunsParams,
  V4ConversationWorkflowRunsResult,
} from "@origin-ai/cf-shared/cf-protocol-v4";

vi.mock("@/logger.js", () => ({
  logger: { debug: vi.fn(), warn: vi.fn() },
}));

const workflowRuns =
  vi.fn<(params: V4ConversationWorkflowRunsParams) => Promise<V4ConversationWorkflowRunsResult>>();

vi.mock("@/v4/V4ConversationContext.js", () => ({
  useV4Conversation: () => ({ workflowRuns }),
}));

import {
  isWorkflowRunsCapabilityMissing,
  useWorkflowRunJournalSummaries,
} from "@/hooks/useWorkflowRunJournalSummaries.js";

function result(runId: string): V4ConversationWorkflowRunsResult {
  return {
    runs: [{ runId, toolCallId: `call-${runId}`, status: "failed", resumable: true }],
  };
}

describe("isWorkflowRunsCapabilityMissing", () => {
  it("Capabilities缺席与普通Failed必须分开：前者End局，后者Value得再QuestionOne次", () => {
    expect(
      isWorkflowRunsCapabilityMissing(
        new Error(
          "capability not supported by this session runtime: listDynamicWorkflowRuns (session s1)",
        ),
      ),
    ).toBe(true);
    expect(isWorkflowRunsCapabilityMissing(new Error("fault.command.capabilityUnsupported"))).toBe(
      true,
    );
    expect(
      isWorkflowRunsCapabilityMissing(new Error("fault.workflowRuns.sessionNotFound: s1")),
    ).toBe(false);
    expect(isWorkflowRunsCapabilityMissing(new Error("socket closed"))).toBe(false);
  });
});

describe("useWorkflowRunJournalSummaries", () => {
  it("首查成功即收口：live 抬升不再多打One次 RPC", async () => {
    workflowRuns.mockReset();
    workflowRuns.mockResolvedValue(result("dwfrun-1"));
    const hook = renderHook(
      (props: { live: boolean }) =>
        useWorkflowRunJournalSummaries({ sessionId: "sess-1", live: props.live }),
      { initialProps: { live: false } },
    );

    await waitFor(() => expect(hook.result.current).toHaveLength(1));
    expect(workflowRuns).toHaveBeenCalledTimes(1);

    hook.rerender({ live: true });
    await waitFor(() => expect(hook.result.current).toHaveLength(1));
    expect(workflowRuns).toHaveBeenCalledTimes(1);
  });

  it("冷开首查Failed → live 抬升时Retry并补上Summary（这就Yes那个Invalid的修复）", async () => {
    workflowRuns.mockReset();
    workflowRuns
      .mockRejectedValueOnce(new Error("fault.workflowRuns.sessionNotFound: sess-1"))
      .mockResolvedValueOnce(result("dwfrun-1"));
    const hook = renderHook(
      (props: { live: boolean }) =>
        useWorkflowRunJournalSummaries({ sessionId: "sess-1", live: props.live }),
      { initialProps: { live: false } },
    );

    await waitFor(() => expect(workflowRuns).toHaveBeenCalledTimes(1));
    expect(hook.result.current).toBeNull();

    hook.rerender({ live: true });
    await waitFor(() => expect(hook.result.current).toHaveLength(1));
    expect(hook.result.current?.[0]?.runId).toBe("dwfrun-1");
  });

  it("Capabilities缺席不Retry：Old CLI / journal UnavailableYes稳定事实", async () => {
    workflowRuns.mockReset();
    workflowRuns.mockRejectedValue(
      new Error(
        "capability not supported by this session runtime: listDynamicWorkflowRuns (session sess-1)",
      ),
    );
    const hook = renderHook(
      (props: { live: boolean }) =>
        useWorkflowRunJournalSummaries({ sessionId: "sess-1", live: props.live }),
      { initialProps: { live: false } },
    );

    await waitFor(() => expect(workflowRuns).toHaveBeenCalledTimes(1));
    hook.rerender({ live: true });
    await waitFor(() => expect(hook.result.current).toBeNull());
    expect(workflowRuns).toHaveBeenCalledTimes(1);
  });

  it("没有 sessionId（DraftSession）时根本不发Request", async () => {
    workflowRuns.mockReset();
    const hook = renderHook(() => useWorkflowRunJournalSummaries({ sessionId: null, live: true }));
    await waitFor(() => expect(hook.result.current).toBeNull());
    expect(workflowRuns).not.toHaveBeenCalled();
  });

  it("enabled=false（嵌套只读 transcript）不发Request：journal 按父Session建键，拿 actor id 去Question只会造出幽灵 runtime", async () => {
    workflowRuns.mockReset();
    const hook = renderHook(() =>
      useWorkflowRunJournalSummaries({ sessionId: "sess-actor-1", live: true, enabled: false }),
    );
    await waitFor(() => expect(hook.result.current).toBeNull());
    expect(workflowRuns).not.toHaveBeenCalled();
  });

  it("换Session：丢弃OldSummary并重查——上One个Session的 run 绝不能ToNewSession的卡片做 join", async () => {
    workflowRuns.mockReset();
    workflowRuns
      .mockResolvedValueOnce(result("dwfrun-1"))
      .mockResolvedValueOnce(result("dwfrun-2"));
    const hook = renderHook(
      (props: { sessionId: string }) =>
        useWorkflowRunJournalSummaries({ sessionId: props.sessionId, live: true }),
      { initialProps: { sessionId: "sess-1" } },
    );
    await waitFor(() => expect(hook.result.current?.[0]?.runId).toBe("dwfrun-1"));

    hook.rerender({ sessionId: "sess-2" });
    await waitFor(() => expect(hook.result.current?.[0]?.runId).toBe("dwfrun-2"));
    expect(workflowRuns).toHaveBeenCalledTimes(2);
  });

  it("切回One个Question过的Session：重查One次而不Yes空着（收口记的YesSession + Answer，不YesOne个裸的「Question过了」）", async () => {
    workflowRuns.mockReset();
    workflowRuns
      .mockResolvedValueOnce(result("dwfrun-1"))
      .mockResolvedValueOnce(result("dwfrun-2"))
      .mockResolvedValueOnce(result("dwfrun-1"));
    const hook = renderHook(
      (props: { sessionId: string }) =>
        useWorkflowRunJournalSummaries({ sessionId: props.sessionId, live: true }),
      { initialProps: { sessionId: "sess-1" } },
    );
    await waitFor(() => expect(hook.result.current?.[0]?.runId).toBe("dwfrun-1"));
    hook.rerender({ sessionId: "sess-2" });
    await waitFor(() => expect(hook.result.current?.[0]?.runId).toBe("dwfrun-2"));

    hook.rerender({ sessionId: "sess-1" });
    await waitFor(() => expect(hook.result.current?.[0]?.runId).toBe("dwfrun-1"));
    expect(workflowRuns).toHaveBeenCalledTimes(3);
  });

  it("refreshKey 不变：仍然只查One次（渲染再多也不多打 RPC）", async () => {
    workflowRuns.mockReset();
    workflowRuns.mockResolvedValue(result("dwfrun-1"));
    const hook = renderHook(
      (props: { refreshKey: number }) =>
        useWorkflowRunJournalSummaries({ sessionId: "sess-1", live: true, ...props }),
      { initialProps: { refreshKey: 2 } },
    );

    await waitFor(() => expect(hook.result.current).toHaveLength(1));
    hook.rerender({ refreshKey: 2 });
    hook.rerender({ refreshKey: 2 });
    await waitFor(() => expect(hook.result.current).toHaveLength(1));
    expect(workflowRuns).toHaveBeenCalledTimes(1);
  });

  it("refreshKey 抬升：恰OK重取One次并换上NewSummary（SessionMedium途Run完One个 run）", async () => {
    workflowRuns.mockReset();
    workflowRuns
      .mockResolvedValueOnce(result("dwfrun-1"))
      .mockResolvedValueOnce(result("dwfrun-2"));
    const hook = renderHook(
      (props: { refreshKey: number }) =>
        useWorkflowRunJournalSummaries({ sessionId: "sess-1", live: true, ...props }),
      { initialProps: { refreshKey: 0 } },
    );
    await waitFor(() => expect(hook.result.current?.[0]?.runId).toBe("dwfrun-1"));

    hook.rerender({ refreshKey: 1 });
    await waitFor(() => expect(hook.result.current?.[0]?.runId).toBe("dwfrun-2"));
    expect(workflowRuns).toHaveBeenCalledTimes(2);
  });

  it("Capabilities缺席在 refreshKey 抬升后**仍然**不重探：那Yes稳定事实，不YesNew鲜度Issue", async () => {
    workflowRuns.mockReset();
    workflowRuns.mockRejectedValue(
      new Error(
        "capability not supported by this session runtime: listDynamicWorkflowRuns (session sess-1)",
      ),
    );
    const hook = renderHook(
      (props: { refreshKey: number }) =>
        useWorkflowRunJournalSummaries({ sessionId: "sess-1", live: true, ...props }),
      { initialProps: { refreshKey: 0 } },
    );

    await waitFor(() => expect(workflowRuns).toHaveBeenCalledTimes(1));
    hook.rerender({ refreshKey: 1 });
    hook.rerender({ refreshKey: 2 });
    await waitFor(() => expect(hook.result.current).toBeNull());
    expect(workflowRuns).toHaveBeenCalledTimes(1);
  });

  it("limit 原样传ToQuery；缺省时不带这个键（由 CLI 侧定缺省）", async () => {
    workflowRuns.mockReset();
    workflowRuns.mockResolvedValue(result("dwfrun-1"));
    const withLimit = renderHook(() =>
      useWorkflowRunJournalSummaries({ sessionId: "sess-1", live: true, limit: 64 }),
    );
    await waitFor(() => expect(withLimit.result.current).toHaveLength(1));
    expect(workflowRuns).toHaveBeenLastCalledWith({ sessionId: "sess-1", limit: 64 });

    const withoutLimit = renderHook(() =>
      useWorkflowRunJournalSummaries({ sessionId: "sess-2", live: true }),
    );
    await waitFor(() => expect(withoutLimit.result.current).toHaveLength(1));
    expect(workflowRuns).toHaveBeenLastCalledWith({ sessionId: "sess-2" });
  });
});
