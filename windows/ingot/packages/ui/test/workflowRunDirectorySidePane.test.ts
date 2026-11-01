// @vitest-environment jsdom

//
import { createElement, useEffect, useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { V4ConversationWorkflowRunSummary } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowRunDirectorySidePaneTab } from "@/lib/workspaceSidePane.js";

vi.mock("@/logger.js", () => ({
  logger: { debug: vi.fn(), warn: vi.fn() },
}));

const release = vi.fn();
const acquire = vi.fn(() => ({ release }));
const layer = { acquire };

vi.mock("@/v4/V4ConversationContext.js", () => ({
  V4PaneConversationProvider: ({ children }: { children: ReactNode }) => children,
  useV4Conversation: () => ({ layer }),
}));

let snapshot: { workflowRuns?: { revision: number; runs: unknown[] } } | null = null;
const projectionListeners = new Set<() => void>();
function pushProjection(next: typeof snapshot) {
  snapshot = next;
  for (const listener of projectionListeners) listener();
}
vi.mock("@/v4/useConversationProjection.js", () => ({
  useConversationProjection: () => {
    const [, forceRender] = useState(0);
    useEffect(() => {
      const listener = () => forceRender((generation) => generation + 1);
      projectionListeners.add(listener);
      return () => {
        projectionListeners.delete(listener);
      };
    }, []);
    return { snapshot };
  },
}));

let summaries: readonly V4ConversationWorkflowRunSummary[] | null = null;
let optionsSeen:
  | { sessionId: string | null; live: boolean; limit?: number; refreshKey?: number | string }
  | undefined;
const refreshKeysSeen: (number | string | undefined)[] = [];
vi.mock("@/hooks/useWorkflowRunJournalSummaries.js", () => ({
  useWorkflowRunJournalSummaries: (options: {
    sessionId: string | null;
    live: boolean;
    limit?: number;
    refreshKey?: number | string;
  }) => {
    optionsSeen = options;
    if (refreshKeysSeen.at(-1) !== options.refreshKey) refreshKeysSeen.push(options.refreshKey);
    return summaries;
  },
}));

import { CfIntlProvider } from "@/i18n/IntlProvider.js";
// eslint-disable-next-line import/first
import { WorkflowRunDirectorySidePane } from "@/app-shell/WorkflowRunDirectorySidePane.js";
// eslint-disable-next-line import/first
import {
  WORKFLOW_RUN_DIRECTORY_LIMIT,
  workflowRunDirectoryRefreshKey,
} from "@/v4/workflowRunDirectoryModel.js";

const tab: WorkflowRunDirectorySidePaneTab = {
  id: "workflow-directory:%2Fworkspace:parent-a",
  type: "workflow-directory",
  workspaceKey: "/workspace",
  workspacePath: "/workspace",
  parentSessionId: "parent-a",
};

const onOpenWorkflowRun = vi.fn();

function summary(
  overrides: Partial<V4ConversationWorkflowRunSummary> &
    Pick<V4ConversationWorkflowRunSummary, "runId">,
): V4ConversationWorkflowRunSummary {
  return {
    toolCallId: `call-${overrides.runId}`,
    status: "completed",
    resumable: false,
    ...overrides,
  };
}

function projectionRun(runId: string, status: "running" | "pending" | "completed" | "errored") {
  return {
    runId,
    toolCallId: `call-${runId}`,
    status,
    usage: { spentTokens: 0, nodesUsed: 0 },
    actors: [],
    nodes: [],
    lastEventSequence: 0,
  };
}

function renderPane(locale: "en-US" | "zh-CN" = "en-US") {
  return render(
    createElement(
      CfIntlProvider,
      { initialLocale: locale },
      createElement(WorkflowRunDirectorySidePane, { tab, onOpenWorkflowRun }),
    ),
  );
}

function rows(pane: ReturnType<typeof renderPane>, section: "running" | "ended") {
  return [
    ...pane.container.querySelectorAll(
      `[data-workflow-directory-section="${section}"] [data-run-id]`,
    ),
  ];
}

beforeEach(() => {
  summaries = null;
  optionsSeen = undefined;
  refreshKeysSeen.length = 0;
  snapshot = null;
  acquire.mockClear();
  release.mockClear();
  onOpenWorkflowRun.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("WorkflowRunDirectorySidePane", () => {
  it("按Session取One页 journal，深度与Task Island计Count同One个常量（口径分叉就Yes「岛说 5、Pages 4」）", () => {
    summaries = [];
    renderPane();

    expect(optionsSeen?.sessionId).toBe("parent-a");
    expect(optionsSeen?.live).toBe(true);
    expect(optionsSeen?.limit).toBe(WORKFLOW_RUN_DIRECTORY_LIMIT);
  });

  //

  it("把投影派生出的 refreshKey 交To取Count hook（缺了它那One页会永远冻住）", () => {
    summaries = [];
    snapshot = { workflowRuns: { revision: 1, runs: [projectionRun("r-1", "running")] } };
    renderPane();

    expect(optionsSeen?.refreshKey).toBe(
      workflowRunDirectoryRefreshKey([projectionRun("r-1", "running")] as never),
    );
  });

  it("run Run完时 refreshKey 变化 → hook 重取 → 那One行自己挪到「已结束」", () => {
    summaries = [summary({ runId: "r-1", status: "running" })];
    snapshot = { workflowRuns: { revision: 1, runs: [projectionRun("r-1", "running")] } };
    const pane = renderPane();
    expect(rows(pane, "running").map((row) => row.getAttribute("data-run-id"))).toEqual(["r-1"]);
    const keyWhileRunning = optionsSeen?.refreshKey;

    act(() => {
      summaries = [summary({ runId: "r-1", status: "completed" })];
      pushProjection({ workflowRuns: { revision: 2, runs: [projectionRun("r-1", "completed")] } });
    });

    expect(optionsSeen?.refreshKey).not.toBe(keyWhileRunning);
    expect(rows(pane, "running")).toEqual([]);
    expect(rows(pane, "ended").map((row) => row.getAttribute("data-run-id"))).toEqual(["r-1"]);
  });

  it("节点级进度不抬 refreshKey：开着的Pages不会因为引擎Events反复读 journal", () => {
    summaries = [summary({ runId: "r-1", status: "running" })];
    snapshot = { workflowRuns: { revision: 1, runs: [projectionRun("r-1", "running")] } };
    renderPane();

    act(() => {
      pushProjection({
        workflowRuns: {
          revision: 2,
          runs: [
            {
              ...projectionRun("r-1", "running"),
              nodes: [{ siteId: "ask#1", ordinal: 1, phase: "settled", outcome: "ok" }],
              lastEventSequence: 7,
            },
          ],
        },
      });
    });

    expect(refreshKeysSeen).toHaveLength(1);
  });

  it("按Session取租About，卸载时放掉（投影只当触发器，但租About照样Yes租About）", () => {
    summaries = [];
    const pane = renderPane();

    expect(acquire).toHaveBeenCalledWith("parent-a");
    expect(release).not.toHaveBeenCalled();
    pane.unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("两段各自渲染并带计Count：Running与已结束", () => {
    summaries = [
      summary({ runId: "r-run", status: "running", label: "find-flaky-tests" }),
      summary({ runId: "r-done", status: "completed", label: "review-changes" }),
      summary({ runId: "r-cancel", status: "stopped", label: "migrate-imports" }),
    ];
    const pane = renderPane();

    expect(rows(pane, "running").map((row) => row.getAttribute("data-run-id"))).toEqual(["r-run"]);
    expect(rows(pane, "ended").map((row) => row.getAttribute("data-run-id"))).toEqual([
      "r-done",
      "r-cancel",
    ]);
    expect(pane.getByTestId("workflow-run-directory-running-count").textContent).toContain("1");
    expect(pane.getByTestId("workflow-run-directory-ended-count").textContent).toContain("2");
    expect(pane.getByText("find-flaky-tests")).toBeTruthy();
  });

  it("行点击开Details页，参Count带全（runId + toolCallId + 展示名做Title兜底）", () => {
    summaries = [summary({ runId: "r-done", label: "review-changes" })];
    const pane = renderPane();

    fireEvent.click(pane.container.querySelector("[data-run-id='r-done']") as Element);

    expect(onOpenWorkflowRun).toHaveBeenCalledWith({
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      runId: "r-done",
      toolCallId: "call-r-done",
      workflowName: "review-changes",
    });
  });

  it("没有 label 的 run 用既有的兜底名，绝不Show裸 runId", () => {
    summaries = [summary({ runId: "dwfrun-8f21" })];
    const pane = renderPane();

    expect(pane.queryByText("dwfrun-8f21")).toBeNull();
    expect(pane.getByText("Workflow script")).toBeTruthy();
  });

  it("Status词复用既有词汇表；stopped 行跟原因词，errored 行跟 failureCode（决策 15）", () => {
    summaries = [
      summary({
        runId: "r-stop",
        status: "stopped",
        stopReason: "interrupted",
        failureCode: "Interrupted",
        resumable: true,
      } as never),
      summary({ runId: "r-fail", status: "errored", failureCode: "DriverError" }),
      summary({ runId: "r-done", status: "completed" }),
    ];
    const pane = renderPane();

    const stopped = pane.container.querySelector("[data-run-id='r-stop']") as HTMLElement;
    expect(stopped.textContent).toContain("Stopped");
    expect(stopped.textContent).toContain("process exited");
    expect(stopped.textContent).not.toContain("Interrupted");
    const failed = pane.container.querySelector("[data-run-id='r-fail']") as HTMLElement;
    expect(failed.textContent).toContain("Errored");
    expect(failed.textContent).toContain("DriverError");
    const completed = pane.container.querySelector("[data-run-id='r-done']") as HTMLElement;
    expect(completed.textContent).toContain("Completed");
    expect(completed.textContent).not.toContain("DriverError");
  });

  it("取满One页才Notice截断——静默截断会读成「就这些」", () => {
    summaries = Array.from({ length: WORKFLOW_RUN_DIRECTORY_LIMIT - 1 }, (_unused, index) =>
      summary({ runId: `r-${index}` }),
    );
    const short = renderPane();
    expect(short.queryByTestId("workflow-run-directory-truncated")).toBeNull();
    cleanup();

    summaries = Array.from({ length: WORKFLOW_RUN_DIRECTORY_LIMIT }, (_unused, index) =>
      summary({ runId: `r-${index}` }),
    );
    const full = renderPane();
    expect(full.getByTestId("workflow-run-directory-truncated").textContent).toContain("64");
  });

  it("Three种空态可分辨：One条都没有 / 只Yes某One段空 / 根本列不出来", () => {
    summaries = [];
    const empty = renderPane();
    expect(empty.getByTestId("workflow-run-directory-empty")).toBeTruthy();
    expect(empty.queryByTestId("workflow-run-directory-unavailable")).toBeNull();
    cleanup();

    summaries = [summary({ runId: "r-run", status: "running" })];
    const onlyRunning = renderPane();
    expect(onlyRunning.queryByTestId("workflow-run-directory-empty")).toBeNull();
    expect(onlyRunning.getByTestId("workflow-run-directory-ended-empty")).toBeTruthy();
    cleanup();

    summaries = null;
    const unavailable = renderPane();
    expect(unavailable.getByTestId("workflow-run-directory-unavailable")).toBeTruthy();
    expect(unavailable.queryByTestId("workflow-run-directory-empty")).toBeNull();
    expect(unavailable.container.querySelector("[role='alert']")).toBeNull();
  });

  it("ChineseCopy（分区Title与Status词都走 i18n，不写死English）", () => {
    summaries = [
      summary({ runId: "r-run", status: "running" }),
      summary({ runId: "r-fail", status: "errored" }),
    ];
    const pane = renderPane("zh-CN");

    expect(pane.getByText(/Running/)).toBeTruthy();
    expect(pane.getByText(/已结束/)).toBeTruthy();
    expect(
      (pane.container.querySelector("[data-run-id='r-fail']") as HTMLElement).textContent,
    ).toContain("出Wrong");
  });
});
