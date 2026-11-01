// @vitest-environment jsdom

//
//
import { createElement } from "react";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TID_WORKFLOW_ARTIFACTS_TOGGLE, TID_WORKFLOW_ARTIFACT_CARD } from "@origin-ai/cf-shared";
import type { V4ConversationWorkflowRunArtifactDataResult } from "@origin-ai/cf-shared/cf-protocol-v4";

vi.mock("@/logger.js", () => ({
  logger: { debug: vi.fn(), warn: vi.fn() },
}));

const workflowRunArtifactData =
  vi.fn<
    (params: {
      sessionId: string;
      runId: string;
      artifactId: string;
      afterSequence?: number;
      limit?: number;
    }) => Promise<V4ConversationWorkflowRunArtifactDataResult>
  >();

const workflowRunArtifactRead = vi.fn();

vi.mock("@/v4/V4ConversationContext.js", () => ({
  useV4Conversation: () => ({ workflowRunArtifactData, workflowRunArtifactRead }),
  useHasV4Conversation: () => true,
}));

import { CfIntlProvider } from "@/i18n/IntlProvider.js";
// eslint-disable-next-line import/first
import { WorkflowRunArtifactsSection } from "@/app-shell/WorkflowRunArtifactsSection.js";
// eslint-disable-next-line import/first
import type { WorkflowRunArtifactView } from "@/hooks/useWorkflowRunArtifacts.js";

const onOpenArtifact = vi.fn();

function artifact(overrides: Partial<WorkflowRunArtifactView> = {}): WorkflowRunArtifactView {
  return {
    id: "book",
    kind: "file",
    title: "审计报告",
    contentType: "application/pdf",
    bytes: 4096,
    sourcePath: "out/book.pdf",
    version: 2,
    itemCount: 0,
    ...overrides,
  };
}

function renderSection(
  artifacts: readonly WorkflowRunArtifactView[],
  options: { locale?: "en-US" | "zh-CN"; openable?: boolean } = {},
) {
  return render(
    createElement(
      CfIntlProvider,
      { initialLocale: options.locale ?? "zh-CN" },
      createElement(WorkflowRunArtifactsSection, {
        artifacts,
        runId: "dwfrun-1",
        sessionId: "parent-a",
        ...(options.openable === false ? {} : { onOpenArtifact }),
      }),
    ),
  );
}

beforeEach(() => {
  cleanup();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
  onOpenArtifact.mockClear();
  workflowRunArtifactData.mockReset();
  workflowRunArtifactData.mockResolvedValue({ items: [], hasMore: false });
  workflowRunArtifactRead.mockReset();
});

describe("WorkflowRunArtifactsSection", () => {
  it("Default展开，卡直接在场（产物YesDeliver物，不该藏在One次点击后面）；One件产物即Deliver物行", () => {
    const view = renderSection([artifact()]);
    expect(view.getByTestId(TID_WORKFLOW_ARTIFACTS_TOGGLE).getAttribute("aria-expanded")).toBe(
      "true",
    );
    const cards = view.getAllByTestId(TID_WORKFLOW_ARTIFACT_CARD);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.getAttribute("data-variant")).toBe("row");
    expect(view.queryByTestId("workflow-run-artifact-gallery")).toBeNull();
  });

  it("有Deliver物时领头，Other产物按原序列出；Collapse仍Show件CountandDeliver物Title", () => {
    const view = renderSection([
      artifact({
        id: "perf",
        kind: "chart",
        bytes: undefined,
        sourcePath: undefined,
        version: 1,
        itemCount: 4,
      }),
      artifact({
        id: "notes",
        kind: "markdown",
        contentType: "text/markdown",
        bytes: 2048,
        sourcePath: undefined,
      }),
      artifact({ title: "审计报告", description: "Conclusions and remediation recommendations from this audit round.", primary: true }),
    ]);
    const body = view.getByTestId("workflow-run-artifact-primary-body");
    const cards = within(body).getAllByTestId(TID_WORKFLOW_ARTIFACT_CARD);
    expect(cards[0]!.getAttribute("data-variant")).toBe("row");
    expect(cards[0]!.getAttribute("data-artifact-id")).toBe("book");
    expect(within(cards[0]!).getByTestId("workflow-artifact-row-description").textContent).toBe(
      "Conclusions and remediation recommendations from this audit round.",
    );
    expect(within(cards[0]!).getByTestId("workflow-artifact-row-detail").textContent).toBe(
      "File·PDF·4.0 KB",
    );
    expect(
      within(cards[0]!.parentElement!).getByTestId("workflow-artifact-row-frame"),
    ).toBeTruthy();
    const index = view.getByTestId("workflow-run-artifact-index");
    expect(index.className).toContain("border-t");
    const lines = within(index).getAllByTestId(TID_WORKFLOW_ARTIFACT_CARD);
    expect(lines.map((card) => card.getAttribute("data-artifact-id"))).toEqual(["perf", "notes"]);
    expect(lines.every((card) => card.getAttribute("data-variant") === "line")).toBe(true);
    expect(within(index).queryByTestId("workflow-artifact-tile-frame")).toBeNull();
    expect(within(lines[0]!).getByTestId("workflow-run-artifact-items").textContent).toBe("4 条");
    expect(within(lines[1]!).getByTestId("workflow-run-artifact-bytes").textContent).toBe("2.0 KB");
    expect(lines[0]!.getAttribute("title")).toBe("图表 · Audit report");
    expect((cards[0] as HTMLElement).style.animationDelay).toBe("30ms");
    expect((lines[0] as HTMLElement).style.animationDelay).toBe("60ms");
    expect(view.queryByTestId("workflow-run-artifacts-primary-title")).toBeNull();
    fireEvent.click(view.getByTestId(TID_WORKFLOW_ARTIFACTS_TOGGLE));
    expect(view.getByTestId("workflow-run-artifacts-count").textContent).toBe("3");
    expect(view.getByTestId("workflow-run-artifacts-primary-title").textContent).toBe("· Audit report");
    expect(view.container.textContent).not.toMatch(/primary/iu);
  });

  it("节身YesOne片画廊：One件产物One张瓦片（预览框 + Description行），依次落地；不再有药丸行 + 挂卡", () => {
    const view = renderSection([
      artifact(),
      artifact({ id: "notes", kind: "markdown", contentType: "text/markdown", bytes: 2048 }),
      artifact({ id: "perf", kind: "chart", bytes: undefined, sourcePath: undefined, version: 1 }),
    ]);
    const gallery = view.getByTestId("workflow-run-artifact-gallery");
    const tiles = within(gallery).getAllByTestId(TID_WORKFLOW_ARTIFACT_CARD);
    expect(tiles).toHaveLength(3);
    const tile = tiles[0]!.parentElement!;
    const frame = within(tile).getByTestId("workflow-artifact-tile-frame");
    expect(frame.hasAttribute("inert")).toBe(true);
    expect(within(tile).getByTestId("workflow-artifact-sheet-badge").textContent).toBe("PDF");
    expect(within(tiles[0]!).queryByTestId("workflow-artifact-tile-frame")).toBeNull();
    expect((tiles[0] as HTMLElement).style.animationDelay).toBe("30ms");
    expect((tiles[2] as HTMLElement).style.animationDelay).toBe("90ms");
    expect(view.queryByTestId("workflow-run-artifact-row")).toBeNull();
    expect(view.queryByTestId("workflow-run-artifact-preview")).toBeNull();
  });

  it("可以手动Collapse，Collapse时表头仍报件Count", () => {
    const view = renderSection([artifact(), artifact({ id: "notes", kind: "markdown" })]);
    expect(view.getByTestId("workflow-run-artifacts-count").textContent).toBe("2");

    fireEvent.click(view.getByTestId(TID_WORKFLOW_ARTIFACTS_TOGGLE));
    expect(view.queryAllByTestId(TID_WORKFLOW_ARTIFACT_CARD)).toHaveLength(0);
    expect(view.getByTestId("workflow-run-artifacts-count").textContent).toBe("2");
  });

  it("Description行带类型徽Character、Character节Count与Version尾槽；kind 词与Workspace出处进 tooltip；title 缺席时Returned id", () => {
    const view = renderSection([artifact({ title: undefined })]);
    const card = view.getByTestId(TID_WORKFLOW_ARTIFACT_CARD);
    const version = within(card).getByTestId("workflow-artifact-tile-version");
    expect(version.textContent).toBe("v2");
    expect(version.getAttribute("title")).toBe("第 2 版");
    expect(within(card).getByTestId("workflow-run-artifact-badge").textContent).toBe("PDF");
    expect(within(card).getByTestId("workflow-run-artifact-bytes").textContent).toBe("4.0 KB");
    expect(card.getAttribute("title")).toBe("File · book\nout/book.pdf");
    expect(view.queryByTestId("workflow-run-artifact-source-path")).toBeNull();
    expect(within(card).getByText("book")).toBeTruthy();
  });

  it("English语Context下Version尾槽同样Yes v{n}，tooltip 用English", () => {
    const view = renderSection([artifact()], { locale: "en-US" });
    const version = view.getByTestId("workflow-artifact-tile-version");
    expect(version.textContent).toBe("v2");
    expect(version.getAttribute("title")).toBe("v2");
  });

  it("第 1 版不写VersionNumber（v1 Yes常态，写出来Yes噪音）", () => {
    const view = renderSection([artifact({ version: 1 })]);
    expect(view.queryByTestId("workflow-artifact-tile-version")).toBeNull();
  });

  it("看板瓦片没有Character节与出处（它的「大小」Yes有多少条Data）", () => {
    const view = renderSection([
      artifact({
        id: "perf",
        kind: "chart",
        title: "每轮耗时",
        bytes: undefined,
        contentType: undefined,
        sourcePath: undefined,
        version: 1,
      }),
    ]);
    expect(view.queryByTestId("workflow-run-artifact-bytes")).toBeNull();
    expect(view.queryByTestId("workflow-run-artifact-badge")).toBeNull();
    expect(view.queryByTestId("workflow-run-artifact-source-path")).toBeNull();
  });

  it("点瓦片把产物 id 交To宿主（瓦片只发意图，scope 由上层补齐）", () => {
    const view = renderSection([artifact()]);
    fireEvent.click(view.getByTestId(TID_WORKFLOW_ARTIFACT_CARD));
    expect(onOpenArtifact).toHaveBeenCalledWith("book");
  });

  it("瓦片YesOne颗真按钮（键盘激活交ToBrowser，不用自己接 keydown）", () => {
    const view = renderSection([artifact()]);
    const card = view.getByTestId(TID_WORKFLOW_ARTIFACT_CARD) as HTMLButtonElement;
    expect(card.tagName).toBe("BUTTON");
    expect(card.disabled).toBe(false);
    expect(card.getAttribute("data-artifact-open")).toBe("true");
    expect(card.getAttribute("aria-label")).toBe("打开产物: Audit report");
  });

  it("宿主没注入打开Capabilities时瓦片禁用，但inner容照Old在场", () => {
    const view = renderSection([artifact()], { openable: false });
    const card = view.getByTestId(TID_WORKFLOW_ARTIFACT_CARD) as HTMLButtonElement;
    expect(card.disabled).toBe(true);
    expect(card.getAttribute("data-artifact-open")).toBeNull();
    expect(card.getAttribute("aria-label")).toBeNull();
    expect(within(card).getByText("审计报告")).toBeTruthy();
    fireEvent.click(card);
    expect(onOpenArtifact).not.toHaveBeenCalled();
  });

  it("inner容产物的瓦片不去翻 journal 的 report 行；PDF 也不读Character节（画不了就不拉）", async () => {
    renderSection([artifact()]);
    await act(async () => {});
    expect(workflowRunArtifactData).not.toHaveBeenCalled();
    expect(workflowRunArtifactRead).not.toHaveBeenCalled();
  });

  it("markdown 产物的预览框里YesDocumentation开头的Zoom渲染，Character节走产物 tab 同One条Read", async () => {
    workflowRunArtifactRead.mockResolvedValue({
      dataBase64: btoa("# Hello\n\nBody."),
      mediaType: "text/markdown",
      totalBytes: 15,
      nextOffset: null,
    });
    const view = renderSection([
      artifact({
        id: "notes",
        kind: "markdown",
        title: "说明",
        contentType: "text/markdown",
        bytes: 15,
        sourcePath: undefined,
        version: 1,
      }),
    ]);
    await waitFor(() => expect(view.getByTestId("workflow-artifact-preview-body")).toBeTruthy());
    const body = view.getByTestId("workflow-artifact-preview-body");
    expect(body.getAttribute("data-preview-mode")).toBe("markdown");
    expect(body.textContent).toContain("Hello");
    expect(workflowRunArtifactRead).toHaveBeenCalledWith(
      expect.objectContaining({ artifactId: "notes", version: 1, runId: "dwfrun-1" }),
    );
  });

  it("预置看板在预览框里实时渲染，并随 itemCount 变化带 afterSequence 增量续拉", async () => {
    workflowRunArtifactData
      .mockResolvedValueOnce({
        items: [
          { sequence: 1, siteId: "report#1", ordinal: 1, item: { round: 1, ms: 120 } },
          { sequence: 2, siteId: "report#1", ordinal: 2, item: { round: 2, ms: 90 } },
        ],
        hasMore: false,
      })
      .mockResolvedValueOnce({
        items: [{ sequence: 3, siteId: "report#1", ordinal: 3, item: { round: 3, ms: 80 } }],
        hasMore: false,
      });

    const board = (itemCount: number): WorkflowRunArtifactView =>
      artifact({
        id: "rounds",
        kind: "table",
        title: "每轮",
        bytes: undefined,
        sourcePath: undefined,
        contentType: undefined,
        version: 1,
        itemCount,
        spec: { columns: [{ field: "round" }, { field: "ms", unit: "ms" }] },
      });

    const view = renderSection([board(2)]);
    await waitFor(() => expect(view.getAllByTestId("artifact-table-row")).toHaveLength(2));
    expect(workflowRunArtifactData).toHaveBeenCalledWith({
      sessionId: "parent-a",
      runId: "dwfrun-1",
      artifactId: "rounds",
      limit: 200,
      fields: ["round", "ms"],
    });

    view.rerender(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(WorkflowRunArtifactsSection, {
          artifacts: [board(3)],
          runId: "dwfrun-1",
          sessionId: "parent-a",
          onOpenArtifact,
        }),
      ),
    );

    await waitFor(() => expect(view.getAllByTestId("artifact-table-row")).toHaveLength(3));
    expect(workflowRunArtifactData).toHaveBeenLastCalledWith({
      sessionId: "parent-a",
      runId: "dwfrun-1",
      artifactId: "rounds",
      afterSequence: 2,
      limit: 200,
      fields: ["round", "ms"],
    });
  });

  it("spec 还没读回来时看板瓦片保持安静，不闪One句「无法渲染」", async () => {
    const view = renderSection([
      artifact({
        id: "perf",
        kind: "chart",
        bytes: undefined,
        sourcePath: undefined,
        contentType: undefined,
        version: 1,
        spec: undefined,
      }),
    ]);
    await act(async () => {});
    expect(view.queryByTestId("workflow-run-artifact-preset-invalid")).toBeNull();
    expect(view.queryByTestId("workflow-run-artifact-preset-missing")).toBeNull();
    expect(view.getByTestId(TID_WORKFLOW_ARTIFACT_CARD)).toBeTruthy();
    expect(view.getByTestId("workflow-artifact-preview-pending")).toBeTruthy();
  });

  it("spec 在场但解析不出来时，只有预览框降级成One句话，Description行照Old", async () => {
    const view = renderSection([
      artifact({
        id: "perf",
        kind: "chart",
        title: "坏看板",
        bytes: undefined,
        sourcePath: undefined,
        contentType: undefined,
        version: 1,
        spec: { nonsense: true },
      }),
    ]);
    await waitFor(() =>
      expect(view.getByTestId("workflow-run-artifact-preset-invalid")).toBeTruthy(),
    );
    expect(view.getByText("坏看板")).toBeTruthy();
  });
});
