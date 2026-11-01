// @vitest-environment jsdom

//
//
import { createElement, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TID_WORKFLOW_ARTIFACT_PANE, type IPlatformService } from "@origin-ai/cf-shared";
import type {
  V4ConversationWorkflowRunArtifactDataResult,
  V4ConversationWorkflowRunArtifactReadResult,
  V4ConversationWorkflowRunArtifactsResult,
  WorkflowRunArtifact,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowArtifactSidePaneTab } from "@/lib/workspaceSidePane.js";

vi.mock("@/logger.js", () => ({
  logger: { debug: vi.fn(), warn: vi.fn() },
}));

const toast = vi.fn();
vi.mock("@/components/ui/toast.js", () => ({
  toast: (...args: unknown[]) => toast(...args),
}));

const workflowRunArtifacts = vi.fn<() => Promise<V4ConversationWorkflowRunArtifactsResult>>();
const workflowRunArtifactData = vi.fn<() => Promise<V4ConversationWorkflowRunArtifactDataResult>>();
const workflowRunArtifactRead =
  vi.fn<
    (params: {
      version: number;
      offset: number;
      limit: number;
    }) => Promise<V4ConversationWorkflowRunArtifactReadResult>
  >();
const release = vi.fn();
const layer = { acquire: vi.fn(() => ({ release })) };

vi.mock("@/v4/V4ConversationContext.js", () => ({
  V4PaneConversationProvider: ({ children }: { children: ReactNode }) => children,
  useV4Conversation: () => ({
    layer,
    workflowRunArtifacts,
    workflowRunArtifactData,
    workflowRunArtifactRead,
  }),
}));

let snapshot: unknown = null;
vi.mock("@/v4/useConversationProjection.js", () => ({
  useConversationProjection: () => ({ snapshot }),
}));

vi.mock("@/previewPanePdfContent.js", () => ({
  PdfPreviewContent: ({ source }: { source: Blob }) =>
    createElement("div", { "data-testid": "pdf-viewer", "data-size": String(source.size) }),
}));
vi.mock("@/previewPanePptxContent.js", () => ({
  PptxPreviewContent: ({ data, fileName }: { data: ArrayBuffer; fileName?: string }) =>
    createElement("div", {
      "data-testid": "pptx-viewer",
      "data-file-name": fileName ?? "",
      "data-size": String(data.byteLength),
    }),
}));
vi.mock("@/previewPaneOfficeContent.js", () => ({
  PreviewPaneOfficeContent: ({
    kind,
    preview,
    resolvedTheme,
  }: {
    kind: string;
    preview: { dataBase64: string; totalBytes: number } | null;
    resolvedTheme: string;
  }) =>
    createElement("div", {
      "data-testid": "office-viewer",
      "data-kind": kind,
      "data-resolved-theme": resolvedTheme,
      "data-total-bytes": String(preview?.totalBytes ?? 0),
    }),
}));
vi.mock("@/components/ai-elements/message.js", () => ({
  MessageResponse: ({ children, theme }: { children?: ReactNode; theme?: string }) =>
    createElement(
      "div",
      { "data-testid": "markdown-response", "data-theme": theme ?? "" },
      children,
    ),
}));
vi.mock("@/components/ai-elements/code-block.js", () => ({
  CodeBlock: ({ code, language }: { code: string; language?: string }) =>
    createElement("pre", { "data-testid": "code-block", "data-language": language ?? "" }, code),
}));

import { CfIntlProvider } from "@/i18n/IntlProvider.js";
// eslint-disable-next-line import/first
import { WorkflowArtifactSidePane } from "@/app-shell/WorkflowArtifactSidePane.js";
// eslint-disable-next-line import/first
import { encodeBytesToBase64 } from "@/hooks/useWorkflowRunArtifactBytes.js";
// eslint-disable-next-line import/first
import { PlatformProvider } from "@/hooks/usePlatform.js";

const onOpenBrowserUrl = vi.fn();
const onRevealFileInTree = vi.fn();

function tabOf(overrides: Partial<WorkflowArtifactSidePaneTab> = {}): WorkflowArtifactSidePaneTab {
  return {
    id: "workflow-artifact:%2Fworkspace:parent-a:dwfrun-1:book",
    type: "workflow-artifact",
    workspaceKey: "/workspace",
    workspacePath: "/workspace",
    parentSessionId: "parent-a",
    runId: "dwfrun-1",
    artifactId: "book",
    ...overrides,
  };
}

function record(overrides: Partial<WorkflowRunArtifact> = {}): WorkflowRunArtifact {
  return {
    id: "book",
    kind: "file",
    title: "审计报告",
    contentType: "application/pdf",
    sourcePath: "out/book.pdf",
    version: 1,
    versions: [{ version: 1, publishedAt: 1, bytes: 8, sourcePath: "out/book.pdf" }],
    itemCount: 0,
    ...overrides,
  };
}

function textChunk(text: string, mediaType: string): V4ConversationWorkflowRunArtifactReadResult {
  const bytes = new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
  return {
    dataBase64: encodeBytesToBase64(bytes),
    mediaType,
    totalBytes: bytes.length,
    nextOffset: null,
  };
}

function renderPane(
  options: {
    tab?: WorkflowArtifactSidePaneTab;
    locale?: "en-US" | "zh-CN";
    withBrowser?: boolean;
    withReveal?: boolean;
    
    platform?: Partial<IPlatformService>;
  } = {},
) {
  const pane = createElement(WorkflowArtifactSidePane, {
    tab: options.tab ?? tabOf(),
    ...(options.withBrowser === false ? {} : { onOpenBrowserUrl }),
    ...(options.withReveal === false ? {} : { onRevealFileInTree }),
  });
  return render(
    createElement(
      CfIntlProvider,
      { initialLocale: options.locale ?? "zh-CN" },
      options.platform === undefined
        ? pane
        : createElement(PlatformProvider, {
            platform: options.platform as IPlatformService,
            children: pane,
          }),
    ),
  );
}

beforeEach(() => {
  cleanup();
  snapshot = null;
  toast.mockClear();
  onOpenBrowserUrl.mockClear();
  onRevealFileInTree.mockClear();
  layer.acquire.mockClear();
  workflowRunArtifacts.mockReset();
  workflowRunArtifactData.mockReset();
  workflowRunArtifactRead.mockReset();
  workflowRunArtifacts.mockResolvedValue({ artifacts: [record()] });
  workflowRunArtifactData.mockResolvedValue({ items: [], hasMore: false });
  workflowRunArtifactRead.mockResolvedValue(textChunk("bytes---", "application/pdf"));
  (window as unknown as { matchMedia: (query: string) => unknown }).matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  });
});

describe("WorkflowArtifactSidePane Body分派", () => {
  it("pdf 交To既有的 PdfViewer，喂的Yes Blob（不落地成File、不走 range transport）", async () => {
    const view = renderPane();
    await waitFor(() => expect(view.getByTestId("pdf-viewer")).toBeTruthy());
    expect(view.getByTestId("pdf-viewer").getAttribute("data-size")).toBe("8");
    expect(view.getByTestId("workflow-artifact-title").textContent).toBe("审计报告");
  });

  it("markdown 走 MessageResponse 并**传 theme**（深底深Character修过One次）", async () => {
    workflowRunArtifacts.mockResolvedValue({
      artifacts: [
        record({
          id: "notes",
          kind: "markdown",
          contentType: "text/markdown",
          sourcePath: undefined,
          versions: [{ version: 1, publishedAt: 1, bytes: 5 }],
        }),
      ],
    });
    workflowRunArtifactRead.mockResolvedValue(textChunk("# hi", "text/markdown"));
    const view = renderPane({ tab: tabOf({ artifactId: "notes" }) });

    await waitFor(() => expect(view.getByTestId("markdown-response")).toBeTruthy());
    expect(view.getByTestId("markdown-response").textContent).toBe("# hi");
    expect(view.getByTestId("markdown-response").getAttribute("data-theme")).toBe("system");
  });

  it("Image走 blob object url 的 <img>", async () => {
    (URL as unknown as { createObjectURL: (blob: Blob) => string }).createObjectURL = () =>
      "blob:artifact-img";
    (URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = () => {};
    workflowRunArtifacts.mockResolvedValue({
      artifacts: [record({ id: "shot", contentType: "image/png" })],
    });
    workflowRunArtifactRead.mockResolvedValue(textChunk("png-bytes", "image/png"));
    const view = renderPane({ tab: tabOf({ artifactId: "shot" }) });

    await waitFor(() => expect(view.getByTestId("workflow-artifact-image")).toBeTruthy());
    expect(view.getByTestId("workflow-artifact-image").getAttribute("src")).toBe(
      "blob:artifact-img",
    );
  });

  it("csv / json 走等宽 code viewer", async () => {
    workflowRunArtifacts.mockResolvedValue({
      artifacts: [record({ id: "rows", contentType: "text/csv" })],
    });
    workflowRunArtifactRead.mockResolvedValue(textChunk("a,b\n1,2", "text/csv"));
    const view = renderPane({ tab: tabOf({ artifactId: "rows" }) });

    await waitFor(() => expect(view.getByTestId("code-block")).toBeTruthy());
    expect(view.getByTestId("code-block").getAttribute("data-language")).toBe("csv");
  });

  it("docx 交To既有 office View器，喂的YesCharacter节（不Yes路径）", async () => {
    workflowRunArtifacts.mockResolvedValue({
      artifacts: [
        record({
          id: "doc",
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      ],
    });
    workflowRunArtifactRead.mockResolvedValue(
      textChunk("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    );
    const view = renderPane({ tab: tabOf({ artifactId: "doc" }) });

    await waitFor(() => expect(view.getByTestId("office-viewer")).toBeTruthy());
    expect(view.getByTestId("office-viewer").getAttribute("data-kind")).toBe("docx");
    expect(view.getByTestId("office-viewer").getAttribute("data-total-bytes")).toBe("4");
  });

  it("pptx 交To既有 pptx View器，喂的Yes ArrayBuffer", async () => {
    const contentType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    workflowRunArtifacts.mockResolvedValue({
      artifacts: [record({ id: "deck", contentType, sourcePath: "out/deck.pptx" })],
    });
    workflowRunArtifactRead.mockResolvedValue(textChunk("pptx-bytes", contentType));
    const view = renderPane({ tab: tabOf({ artifactId: "deck" }) });

    await waitFor(() => expect(view.getByTestId("pptx-viewer")).toBeTruthy());
    expect(view.getByTestId("pptx-viewer").getAttribute("data-size")).toBe("10");
    expect(view.getByTestId("pptx-viewer").getAttribute("data-file-name")).toBe("out/deck.pptx");
  });

  it("表outer类型ToOne张Metadata卡 + 「在WorkspaceShow」，不假装能渲染", async () => {
    workflowRunArtifacts.mockResolvedValue({
      artifacts: [
        record({ id: "blob", contentType: "application/octet-stream", sourcePath: "out/x.bin" }),
      ],
    });
    workflowRunArtifactRead.mockResolvedValue(textChunk("bin", "application/octet-stream"));
    const view = renderPane({ tab: tabOf({ artifactId: "blob" }) });

    await waitFor(() => expect(view.getByTestId("workflow-artifact-unsupported")).toBeTruthy());
    const card = view.getByTestId("workflow-artifact-unsupported");
    expect(card.textContent).toContain("application/octet-stream");
    expect(card.textContent).toContain("out/x.bin");
    fireEvent.click(view.getByTestId("workflow-artifact-unsupported-reveal"));
    expect(onRevealFileInTree).toHaveBeenCalledWith("/workspace/out/x.bin");
  });

  it("预置看板画在 tab 里，且**不读One个Character节**", async () => {
    workflowRunArtifacts.mockResolvedValue({
      artifacts: [
        record({
          id: "rounds",
          kind: "table",
          contentType: undefined,
          sourcePath: undefined,
          versions: [{ version: 1, publishedAt: 1 }],
          spec: { columns: [{ field: "round" }] },
          itemCount: 1,
        }),
      ],
    });
    workflowRunArtifactData.mockResolvedValue({
      items: [{ sequence: 1, siteId: "report#1", ordinal: 1, item: { round: 7 } }],
      hasMore: false,
    });
    const view = renderPane({ tab: tabOf({ artifactId: "rounds" }) });

    await waitFor(() => expect(view.getByTestId("artifact-table")).toBeTruthy());
    expect(view.getByText("7")).toBeTruthy();
    expect(workflowRunArtifactRead).not.toHaveBeenCalled();
  });
});

describe("WorkflowArtifactSidePane html 卡", () => {
  const htmlRecord = (sourcePath: string | undefined, versionCount = 1) =>
    record({
      id: "site",
      contentType: "text/html",
      ...(sourcePath === undefined ? { sourcePath: undefined } : { sourcePath }),
      version: versionCount,
      versions: Array.from({ length: versionCount }, (_unused, index) => ({
        version: index + 1,
        publishedAt: index + 1,
        bytes: 4,
      })),
    });

  beforeEach(() => {
    workflowRunArtifactRead.mockResolvedValue(textChunk("<h1>", "text/html"));
  });

  it("LocalWorkspace + 最New版：To「在BrowserMedium打开」，打开的YesWorkspace原件的 file:// URL", async () => {
    workflowRunArtifacts.mockResolvedValue({ artifacts: [htmlRecord("out/site.html")] });
    const view = renderPane({ tab: tabOf({ artifactId: "site" }) });

    await waitFor(() => expect(view.getByTestId("workflow-artifact-html-card")).toBeTruthy());
    fireEvent.click(view.getByTestId("workflow-artifact-open-in-browser"));
    expect(onOpenBrowserUrl).toHaveBeenCalledWith("file:///workspace/out/site.html");
    expect(view.getByTestId("workflow-artifact-note").textContent).toContain("工作区");
  });

  it("Remote workspace（有 remoteSessionId）退成「仅LocalWorkspace可预览」", async () => {
    workflowRunArtifacts.mockResolvedValue({ artifacts: [htmlRecord("out/site.html")] });
    const view = renderPane({
      tab: tabOf({
        artifactId: "site",
        remoteSessionId: "remote-1",
        workspaceIdentity: "ssh://host/workspace",
      }),
    });

    await waitFor(() => expect(view.getByTestId("workflow-artifact-html-card")).toBeTruthy());
    expect(view.queryByTestId("workflow-artifact-open-in-browser")).toBeNull();
    expect(view.getByTestId("workflow-artifact-note").textContent).toContain("仅LocalWorkspace");
    expect(view.queryByTestId("workflow-artifact-reveal")).toBeNull();
  });

  it("看的YesLegacy version时不To「在BrowserMedium打开」——Workspace原件早被同名覆盖了", async () => {
    workflowRunArtifacts.mockResolvedValue({ artifacts: [htmlRecord("out/site.html", 2)] });
    const view = renderPane({ tab: tabOf({ artifactId: "site", version: 1 }) });

    await waitFor(() => expect(view.getByTestId("workflow-artifact-html-card")).toBeTruthy());
    expect(view.queryByTestId("workflow-artifact-open-in-browser")).toBeNull();
    expect(view.getByTestId("workflow-artifact-html-reveal")).toBeTruthy();
  });
});

describe("WorkflowArtifactSidePane Version步进器", () => {
  it("只有One版时整块缺席，只留One个VersionNumber", async () => {
    const view = renderPane();
    await waitFor(() => expect(view.getByTestId("pdf-viewer")).toBeTruthy());
    expect(view.queryByTestId("workflow-artifact-version-stepper")).toBeNull();
    expect(view.getByTestId("workflow-artifact-version").textContent).toBe("第 1 版");
  });

  it("多版时按**已知Version的Array**翻，并按所选Version重读Character节", async () => {
    workflowRunArtifacts.mockResolvedValue({
      artifacts: [
        record({
          version: 3,
          versions: [
            { version: 1, publishedAt: 1, bytes: 2 },
            { version: 2, publishedAt: 2, bytes: 4 },
            { version: 3, publishedAt: 3, bytes: 8 },
          ],
        }),
      ],
    });
    const view = renderPane();
    await waitFor(() => expect(view.getByTestId("workflow-artifact-version-stepper")).toBeTruthy());
    expect(view.getByTestId("workflow-artifact-version").textContent).toBe("第 3 版 / 共 3 版");
    expect(view.getByTestId("workflow-artifact-version-next").hasAttribute("disabled")).toBe(true);

    fireEvent.click(view.getByTestId("workflow-artifact-version-previous"));
    await waitFor(() =>
      expect(view.getByTestId("workflow-artifact-version").textContent).toBe("第 2 版 / 共 3 版"),
    );
    await waitFor(() => expect(workflowRunArtifactRead.mock.calls.at(-1)?.[0]?.version).toBe(2));
  });

  it("journal 读不到Version历史时不凭最New版Number编造 1..n", async () => {
    workflowRunArtifacts.mockRejectedValue(new Error("fault.command.capabilityUnsupported"));
    snapshot = {
      workflowRuns: {
        revision: 1,
        runs: [
          {
            runId: "dwfrun-1",
            status: "completed",
            usage: { spentTokens: 0, nodesUsed: 0 },
            actors: [],
            nodes: [],
            lastEventSequence: 0,
            artifacts: [
              {
                id: "book",
                kind: "file",
                title: "审计报告",
                version: 4,
                contentType: "application/pdf",
                bytes: 8,
              },
            ],
          },
        ],
      },
    };
    const view = renderPane();
    await waitFor(() => expect(view.getByTestId("pdf-viewer")).toBeTruthy());
    expect(view.queryByTestId("workflow-artifact-version-stepper")).toBeNull();
    expect(view.getByTestId("workflow-artifact-version").textContent).toBe("第 4 版");
  });
});

describe("WorkflowArtifactSidePane MetadataSource与空态", () => {
  it("run 在活投影里：source Label为 live，Summary先画出来", async () => {
    snapshot = {
      workflowRuns: {
        revision: 1,
        runs: [
          {
            runId: "dwfrun-1",
            status: "running",
            usage: { spentTokens: 0, nodesUsed: 0 },
            actors: [],
            nodes: [],
            lastEventSequence: 0,
            artifacts: [
              { id: "book", kind: "file", version: 1, contentType: "application/pdf", bytes: 8 },
            ],
          },
        ],
      },
    };
    const view = renderPane();
    await waitFor(() => expect(view.getByTestId("pdf-viewer")).toBeTruthy());
    expect(view.getByTestId(TID_WORKFLOW_ARTIFACT_PANE).getAttribute("data-artifact-source")).toBe(
      "live",
    );
  });

  it("run 不在活投影里：source Label为 journal（冷恢复走 durable 读法）", async () => {
    const view = renderPane();
    await waitFor(() => expect(view.getByTestId("pdf-viewer")).toBeTruthy());
    expect(view.getByTestId(TID_WORKFLOW_ARTIFACT_PANE).getAttribute("data-artifact-source")).toBe(
      "journal",
    );
  });

  it("读完了但这个 id 不在清单里：说「已经不在了」，不永远停在加载Copy上", async () => {
    workflowRunArtifacts.mockResolvedValue({ artifacts: [] });
    const view = renderPane();
    await waitFor(() =>
      expect(view.getByTestId("workflow-artifact-placeholder").textContent).toBe(
        "这个产物已经不在了。",
      ),
    );
  });

  it("Session不支持产物Query（老 CLI）时说的Yes「读不到Details」，不Yes「不在了」", async () => {
    workflowRunArtifacts.mockRejectedValue(new Error("fault.command.capabilityUnsupported"));
    const view = renderPane();
    await waitFor(() =>
      expect(view.getByTestId("workflow-artifact-placeholder").textContent).toBe(
        "CurrentSession读不到产物Details。",
      ),
    );
  });

  it("面板订阅的Yes**父Session**的投影（产物的New鲜MetadataYes它的One部分）", async () => {
    renderPane();
    await act(async () => {});
    expect(layer.acquire).toHaveBeenCalledWith("parent-a");
  });
});

describe("WorkflowArtifactSidePane 头部动作", () => {
  it("宿主不能落Replica时，「在WorkspaceShow」独立留在头部（desktop-local ∧ sourcePath 在场才出现）", async () => {
    const view = renderPane();
    await waitFor(() => expect(view.getByTestId("workflow-artifact-reveal")).toBeTruthy());
    fireEvent.click(view.getByTestId("workflow-artifact-reveal"));
    expect(onRevealFileInTree).toHaveBeenCalledWith("/workspace/out/book.pdf");
  });

  it("markdown 没有Workspace出处，因此没有「在WorkspaceShow」，但有「Copy」", async () => {
    workflowRunArtifacts.mockResolvedValue({
      artifacts: [
        record({
          id: "notes",
          kind: "markdown",
          contentType: "text/markdown",
          sourcePath: undefined,
          versions: [{ version: 1, publishedAt: 1, bytes: 4 }],
        }),
      ],
    });
    workflowRunArtifactRead.mockResolvedValue(textChunk("# hi", "text/markdown"));
    const view = renderPane({ tab: tabOf({ artifactId: "notes" }) });

    await waitFor(() => expect(view.getByTestId("workflow-artifact-copy")).toBeTruthy());
    expect(view.queryByTestId("workflow-artifact-reveal")).toBeNull();
  });

  it("pdf 不To「Copy」（Two进制Copy成TextYesOne句谎）", async () => {
    const view = renderPane();
    await waitFor(() => expect(view.getByTestId("pdf-viewer")).toBeTruthy());
    expect(view.queryByTestId("workflow-artifact-copy")).toBeNull();
  });
});

describe("WorkflowArtifactSidePane 作为File打开", () => {
  const markdownRecord = () =>
    record({
      id: "notes",
      kind: "markdown",
      contentType: "text/markdown",
      sourcePath: undefined,
      versions: [{ version: 1, publishedAt: 1, bytes: 4 }],
    });

  function desktopPlatform(overrides: Partial<IPlatformService> = {}) {
    return {
      materializeWorkflowArtifactFile: vi.fn(async (payload: { fileName: string }) => ({
        localPath: `/copies/${payload.fileName}`,
      })),
      openExternalFile: vi.fn(async () => ({ success: true })),
      getInstalledEditors: vi.fn(async () => [
        { id: "vscode", name: "VS Code", iconDataUrl: "data:," },
        { id: "finder", name: "Finder", iconDataUrl: "data:," },
      ]),
      openInEditor: vi.fn(async () => ({ success: true })),
      ...overrides,
    };
  }

  function decode(bytes: unknown): string {
    return new TextDecoder().decode(bytes as Uint8Array);
  }

  it("宿主不能落Replica时（Mobile Remote Control / web）不出入口", async () => {
    workflowRunArtifacts.mockResolvedValue({ artifacts: [markdownRecord()] });
    workflowRunArtifactRead.mockResolvedValue(textChunk("# hi", "text/markdown"));
    const view = renderPane({
      tab: tabOf({ artifactId: "notes" }),
      platform: { openExternalFile: vi.fn() },
    });

    await waitFor(() => expect(view.getByTestId("markdown-response")).toBeTruthy());
    expect(view.queryByTestId("workflow-artifact-open-as-file")).toBeNull();
  });

  it("预置看板没有Character节，不出入口", async () => {
    workflowRunArtifacts.mockResolvedValue({
      artifacts: [
        record({
          id: "scores",
          kind: "table",
          contentType: undefined,
          sourcePath: undefined,
          versions: [{ version: 1, publishedAt: 1 }],
          spec: { columns: [{ field: "round" }] },
        }),
      ],
    });
    const view = renderPane({
      tab: tabOf({ artifactId: "scores" }),
      platform: desktopPlatform(),
    });

    await waitFor(() => expect(view.getByTestId("workflow-artifact-title")).toBeTruthy());
    expect(view.queryByTestId("workflow-artifact-open-as-file")).toBeNull();
  });

  it("markdown：把这One版的Character节落成 <id>.md，用System Default App 打开", async () => {
    workflowRunArtifacts.mockResolvedValue({ artifacts: [markdownRecord()] });
    workflowRunArtifactRead.mockResolvedValue(textChunk("# hi", "text/markdown"));
    const platform = desktopPlatform();
    const view = renderPane({ tab: tabOf({ artifactId: "notes" }), platform });

    await waitFor(() => expect(view.getByTestId("markdown-response")).toBeTruthy());
    fireEvent.click(view.getByTestId("workflow-artifact-open-as-file"));

    await waitFor(() => expect(platform.openExternalFile).toHaveBeenCalledWith("/copies/notes.md"));
    const payload = platform.materializeWorkflowArtifactFile.mock.calls[0]?.[0] as unknown as {
      runId: string;
      artifactId: string;
      version: number;
      fileName: string;
      bytes: Uint8Array;
    };
    expect(payload).toMatchObject({
      runId: "dwfrun-1",
      artifactId: "notes",
      version: 1,
      fileName: "notes.md",
    });
    expect(decode(payload.bytes)).toBe("# hi");
  });

  it("file：File名取所选Version的 sourcePath 基名，翻到Legacy version就落Legacy version的Character节", async () => {
    workflowRunArtifacts.mockResolvedValue({
      artifacts: [
        record({
          version: 2,
          sourcePath: "out/book.pdf",
          versions: [
            { version: 1, publishedAt: 1, bytes: 5, sourcePath: "out/draft.pdf" },
            { version: 2, publishedAt: 2, bytes: 5, sourcePath: "out/book.pdf" },
          ],
        }),
      ],
    });
    workflowRunArtifactRead.mockImplementation(async (params) =>
      textChunk(`pdf-v${params.version}`, "application/pdf"),
    );
    const platform = desktopPlatform();
    const view = renderPane({ platform });

    await waitFor(() => expect(view.getByTestId("pdf-viewer")).toBeTruthy());
    fireEvent.click(view.getByTestId("workflow-artifact-open-as-file"));
    await waitFor(() => expect(platform.openExternalFile).toHaveBeenCalledWith("/copies/book.pdf"));
    expect(platform.materializeWorkflowArtifactFile.mock.calls[0]?.[0]).toMatchObject({
      version: 2,
      fileName: "book.pdf",
    });

    fireEvent.click(view.getByTestId("workflow-artifact-version-previous"));
    await waitFor(() =>
      expect(view.getByTestId("workflow-artifact-version").textContent).toBe("第 1 版 / 共 2 版"),
    );
    await waitFor(() =>
      expect(view.getByTestId("pdf-viewer").getAttribute("data-size")).toBe(
        String("pdf-v1".length),
      ),
    );
    fireEvent.click(view.getByTestId("workflow-artifact-open-as-file"));
    await waitFor(() =>
      expect(platform.openExternalFile).toHaveBeenLastCalledWith("/copies/draft.pdf"),
    );
    const second = platform.materializeWorkflowArtifactFile.mock.calls[1]?.[0] as unknown as {
      version: number;
      fileName: string;
      bytes: Uint8Array;
    };
    expect(second).toMatchObject({ version: 1, fileName: "draft.pdf" });
    expect(decode(second.bytes)).toBe("pdf-v1");
  });

  it("同One版再打开不再重传Character节，直接开同One个Replica", async () => {
    workflowRunArtifacts.mockResolvedValue({ artifacts: [markdownRecord()] });
    workflowRunArtifactRead.mockResolvedValue(textChunk("# hi", "text/markdown"));
    const platform = desktopPlatform();
    const view = renderPane({ tab: tabOf({ artifactId: "notes" }), platform });

    await waitFor(() => expect(view.getByTestId("markdown-response")).toBeTruthy());
    fireEvent.click(view.getByTestId("workflow-artifact-open-as-file"));
    await waitFor(() => expect(platform.openExternalFile).toHaveBeenCalledTimes(1));
    fireEvent.click(view.getByTestId("workflow-artifact-open-as-file"));
    await waitFor(() => expect(platform.openExternalFile).toHaveBeenCalledTimes(2));
    expect(platform.materializeWorkflowArtifactFile).toHaveBeenCalledTimes(1);
  });

  it("System App 打不开时To toast，不静默", async () => {
    workflowRunArtifacts.mockResolvedValue({ artifacts: [markdownRecord()] });
    workflowRunArtifactRead.mockResolvedValue(textChunk("# hi", "text/markdown"));
    const platform = desktopPlatform({
      openExternalFile: vi.fn(async () => ({ success: false, error: "no app" })),
    });
    const view = renderPane({ tab: tabOf({ artifactId: "notes" }), platform });

    await waitFor(() => expect(view.getByTestId("markdown-response")).toBeTruthy());
    fireEvent.click(view.getByTestId("workflow-artifact-open-as-file"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("无法作为File打开此产物"));
  });

  it("Replica写Failed时同样To toast", async () => {
    workflowRunArtifacts.mockResolvedValue({ artifacts: [markdownRecord()] });
    workflowRunArtifactRead.mockResolvedValue(textChunk("# hi", "text/markdown"));
    const platform = desktopPlatform({
      materializeWorkflowArtifactFile: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });
    const view = renderPane({ tab: tabOf({ artifactId: "notes" }), platform });

    await waitFor(() => expect(view.getByTestId("markdown-response")).toBeTruthy());
    fireEvent.click(view.getByTestId("workflow-artifact-open-as-file"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("无法作为File打开此产物"));
    expect(platform.openExternalFile).not.toHaveBeenCalled();
  });

  it("选择Open with：列出已装 App（FileManage器在前），选Medium即用它打开Replica", async () => {
    workflowRunArtifacts.mockResolvedValue({ artifacts: [markdownRecord()] });
    workflowRunArtifactRead.mockResolvedValue(textChunk("# hi", "text/markdown"));
    const platform = desktopPlatform();
    const view = renderPane({ tab: tabOf({ artifactId: "notes" }), platform });

    await waitFor(() => expect(view.getByTestId("markdown-response")).toBeTruthy());
    fireEvent.pointerDown(view.getByTestId("workflow-artifact-open-as-file-menu"), {
      button: 0,
      ctrlKey: false,
    });
    await waitFor(() => expect(view.getByText("VS Code")).toBeTruthy());
    const names = view.getAllByRole("menuitem").map((item) => item.textContent);
    expect(names.slice(0, 2)).toEqual(["Finder", "VS Code"]);

    fireEvent.click(view.getByText("VS Code"));
    await waitFor(() =>
      expect(platform.openInEditor).toHaveBeenCalledWith("vscode", "/copies/notes.md", {
        pathKind: "file",
      }),
    );
    expect(platform.openExternalFile).not.toHaveBeenCalled();
  });

  it("有Workspace出处时，「在WorkspaceShow」收进菜单，头部只剩One个File控件", async () => {
    const platform = desktopPlatform();
    const view = renderPane({ platform });

    await waitFor(() => expect(view.getByTestId("pdf-viewer")).toBeTruthy());
    expect(view.getByTestId("workflow-artifact-open-as-file")).toBeTruthy();
    expect(view.queryByTestId("workflow-artifact-reveal")).toBeNull();

    fireEvent.pointerDown(view.getByTestId("workflow-artifact-open-as-file-menu"), {
      button: 0,
      ctrlKey: false,
    });
    await waitFor(() =>
      expect(view.getByTestId("workflow-artifact-open-as-file-reveal")).toBeTruthy(),
    );
    const names = view.getAllByRole("menuitem").map((item) => item.textContent);
    expect(names.slice(-2)).toEqual(["在WorkspaceShow", "复制绝对路径"]);

    fireEvent.click(view.getByTestId("workflow-artifact-open-as-file-reveal"));
    expect(onRevealFileInTree).toHaveBeenCalledWith("/workspace/out/book.pdf");
    expect(platform.materializeWorkflowArtifactFile).not.toHaveBeenCalled();
  });

  it("没有Workspace出处（markdown）orRemoteWorkspace时，菜单里没有「在WorkspaceShow」", async () => {
    workflowRunArtifacts.mockResolvedValue({ artifacts: [markdownRecord()] });
    workflowRunArtifactRead.mockResolvedValue(textChunk("# hi", "text/markdown"));
    const markdownView = renderPane({
      tab: tabOf({ artifactId: "notes" }),
      platform: desktopPlatform(),
    });
    await waitFor(() => expect(markdownView.getByTestId("markdown-response")).toBeTruthy());
    fireEvent.pointerDown(markdownView.getByTestId("workflow-artifact-open-as-file-menu"), {
      button: 0,
      ctrlKey: false,
    });
    await waitFor(() => expect(markdownView.getByText("复制绝对路径")).toBeTruthy());
    expect(markdownView.queryByTestId("workflow-artifact-open-as-file-reveal")).toBeNull();
    cleanup();

    workflowRunArtifacts.mockResolvedValue({ artifacts: [record()] });
    const remoteView = renderPane({
      tab: tabOf({ remoteSessionId: "remote-1", workspaceIdentity: "ssh://host/workspace" }),
      platform: desktopPlatform(),
    });
    await waitFor(() => expect(remoteView.getByTestId("pdf-viewer")).toBeTruthy());
    expect(remoteView.queryByTestId("workflow-artifact-reveal")).toBeNull();
    fireEvent.pointerDown(remoteView.getByTestId("workflow-artifact-open-as-file-menu"), {
      button: 0,
      ctrlKey: false,
    });
    await waitFor(() => expect(remoteView.getByText("复制绝对路径")).toBeTruthy());
    expect(remoteView.queryByTestId("workflow-artifact-open-as-file-reveal")).toBeNull();
  });

  it("「Copy路径」Copy的YesReplica的绝对路径", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    workflowRunArtifacts.mockResolvedValue({ artifacts: [markdownRecord()] });
    workflowRunArtifactRead.mockResolvedValue(textChunk("# hi", "text/markdown"));
    const platform = desktopPlatform();
    const view = renderPane({ tab: tabOf({ artifactId: "notes" }), platform });

    await waitFor(() => expect(view.getByTestId("markdown-response")).toBeTruthy());
    fireEvent.pointerDown(view.getByTestId("workflow-artifact-open-as-file-menu"), {
      button: 0,
      ctrlKey: false,
    });
    await waitFor(() => expect(view.getByText("复制绝对路径")).toBeTruthy());
    fireEvent.click(view.getByText("复制绝对路径"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("/copies/notes.md"));
  });
});
