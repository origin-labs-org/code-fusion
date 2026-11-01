// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PresentationPageElement,
  PresentationPreviewDocument,
  PresentationRenderHandle,
} from "@/presentation/types.js";

const h = vi.hoisted(() => ({
  open: vi.fn(),
  loggerError: vi.fn(),
  toast: vi.fn(),
  sha256Fingerprint: vi.fn(),
  createReference: vi.fn(),
  dispatchReference: vi.fn(),
  readSelectedText: vi.fn(),
}));

vi.mock("@/presentation/pptxRendererPreviewEngine.js", () => ({
  pptxRendererPreviewEngine: { open: h.open },
}));

vi.mock("@/logger.js", () => ({
  logger: { error: h.loggerError },
}));

vi.mock("@/components/ui/toast.js", () => ({
  toast: h.toast,
}));

vi.mock("@/lib/pptxElementReference.js", () => ({
  sha256Fingerprint: h.sha256Fingerprint,
  createPptxElementReference: h.createReference,
  dispatchPptxElementReferenceAddToChat: h.dispatchReference,
}));

vi.mock("@/presentation/presentationTextSelection.js", () => ({
  getPresentationElementSelectedText: h.readSelectedText,
}));

import {
  PptxPreviewViewer,
  type PptxPreviewViewerLabels,
} from "@/components/ui/pptx-preview-viewer.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createDocument(
  label: string,
  ready: Promise<void>,
  elements: readonly PresentationPageElement[] = [],
  pageCount = 1,
): PresentationPreviewDocument & {
  dispose: ReturnType<typeof vi.fn>;
  renderPage: ReturnType<typeof vi.fn>;
} {
  const handle: PresentationRenderHandle = {
    ready,
    dispose: vi.fn(),
  };
  return {
    pageCount,
    pageSize: { width: 1280, height: 720 },
    getPageElements: () => elements,
    dispose: vi.fn(),
    renderPage: vi.fn((_pageIndex: number, container: HTMLElement) => {
      const page = document.createElement("div");
      page.textContent = label;
      container.append(page);
      return handle;
    }),
  };
}

const labels: PptxPreviewViewerLabels = {
  loading: "loading",
  loadError: "load-error",
  noSlides: "no-slides",
  previousPage: "previous-page",
  nextPage: "next-page",
  pageInput: "page-input",
  zoomIn: "zoom-in",
  zoomOut: "zoom-out",
  thumbnails: "thumbnails",
  thumbnail: (pageNumber) => `thumbnail-${pageNumber}`,
  exportPdf: "export-pdf",
  exportingPdf: "exporting-pdf",
  exportPdfSuccess: (path) => `export-pdf-success-${path}`,
  exportPdfFailed: "export-pdf-failed",
  selectElement: "select-element",
  exitElementSelection: "exit-selection",
  aiEdit: "ai-edit",
  commentPlaceholder: "comment-placeholder",
  cancelAiEdit: "cancel-ai-edit",
  addToConversation: "add-to-conversation",
  referencedPageMissing: (pageNumber) => `missing-page-${pageNumber}`,
  referencedSourceChanged: (pageNumber) => `changed-source-${pageNumber}`,
};

beforeEach(() => {
  h.open.mockReset();
  h.loggerError.mockReset();
  h.toast.mockReset();
  h.sha256Fingerprint.mockReset();
  h.sha256Fingerprint.mockResolvedValue(`sha256:${"a".repeat(64)}`);
  h.createReference.mockReset();
  h.dispatchReference.mockReset();
  h.readSelectedText.mockReset();
  h.readSelectedText.mockReturnValue(null);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => cleanup());

describe("PptxPreviewViewer lifecycle", () => {
  it("Only pass isolated leaf mounts to renderer; switching and exiting element selection will not destroy React nodes", async () => {
    const firstElement: PresentationPageElement = {
      slideIndex: 0,
      slidePart: "ppt/slides/slide1.xml",
      nodeId: "7",
      nodeName: "Title",
      nodeType: "shape",
      text: "Quarterly plan",
      bounds: { x: 100, y: 80, width: 400, height: 120 },
      zIndex: 1,
    };
    const secondElement: PresentationPageElement = {
      ...firstElement,
      nodeId: "8",
      nodeName: "Subtitle",
      text: "Next steps",
      bounds: { x: 100, y: 240, width: 400, height: 80 },
      zIndex: 2,
    };
    const previewDocument = createDocument(
      "Quarterly plan",
      Promise.resolve(),
      [firstElement, secondElement],
    );
    h.open.mockResolvedValue(previewDocument);

    const view = render(
      createElement(PptxPreviewViewer, {
        data: new ArrayBuffer(1),
        labels,
        referenceSource: {
          workspacePath: "/workspace",
          sourcePath: "/workspace/deck.pptx",
          sourceTitle: "deck.pptx",
        },
      }),
    );

    expect(await screen.findByText("Quarterly plan")).toBeTruthy();
    const rendererMount = previewDocument.renderPage.mock.calls[0]?.[1] as
      | HTMLElement
      | undefined;
    expect(rendererMount?.dataset.cfPptxRenderSurface).toBe("true");
    expect(rendererMount?.childElementCount).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: labels.selectElement }));
    fireEvent.click(screen.getByRole("button", { name: firstElement.text }));
    fireEvent.click(screen.getByRole("button", { name: secondElement.text }));
    expect(
      screen
        .getByRole("button", { name: secondElement.text })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(
      screen.getByRole("button", { name: labels.exitElementSelection }),
    );
    expect(
      document.querySelector('[data-pptx-element-selection-overlay="true"]'),
    ).toBeNull();
    expect(rendererMount?.isConnected).toBe(true);

    expect(() => view.unmount()).not.toThrow();
  });

  it("Release old documents completed after switching and do not render old content", async () => {
    const firstOpen = createDeferred<PresentationPreviewDocument>();
    const secondOpen = createDeferred<PresentationPreviewDocument>();
    const firstDocument = createDocument("document-1", Promise.resolve());
    const secondDocument = createDocument("document-2", Promise.resolve());
    h.open.mockReturnValueOnce(firstOpen.promise).mockReturnValueOnce(secondOpen.promise);

    const view = render(createElement(PptxPreviewViewer, { data: new ArrayBuffer(1), labels }));
    await waitFor(() => expect(h.open).toHaveBeenCalledTimes(1));

    view.rerender(createElement(PptxPreviewViewer, { data: new ArrayBuffer(2), labels }));
    await waitFor(() => expect(h.open).toHaveBeenCalledTimes(2));

    await act(async () => firstOpen.resolve(firstDocument));
    expect(firstDocument.dispose).toHaveBeenCalledTimes(1);
    expect(firstDocument.renderPage).not.toHaveBeenCalled();

    await act(async () => secondOpen.resolve(secondDocument));
    expect(await screen.findByText("document-2")).toBeTruthy();
    expect(screen.queryByText("document-1")).toBeNull();
  });

  it("Ignore late rendering errors of old pages after document switching", async () => {
    const firstReady = createDeferred<void>();
    const firstDocument = createDocument("document-1", firstReady.promise);
    const secondDocument = createDocument("document-2", Promise.resolve());
    h.open.mockResolvedValueOnce(firstDocument).mockResolvedValueOnce(secondDocument);

    const view = render(createElement(PptxPreviewViewer, { data: new ArrayBuffer(1), labels }));
    expect(await screen.findByText("document-1")).toBeTruthy();

    view.rerender(createElement(PptxPreviewViewer, { data: new ArrayBuffer(2), labels }));
    expect(await screen.findByText("document-2")).toBeTruthy();

    await act(async () => firstReady.reject(new Error("old render failed")));
    expect(screen.queryByText(labels.loadError)).toBeNull();
    expect(screen.getByText("document-2")).toBeTruthy();
    expect(h.loggerError).not.toHaveBeenCalled();
  });

  it("新文件 generation 完整重置页码、缩放和元素选择状态", async () => {
    const element: PresentationPageElement = {
      slideIndex: 0,
      slidePart: "ppt/slides/slide1.xml",
      nodeId: "7",
      nodeName: "Title",
      nodeType: "shape",
      text: "Quarterly plan",
      bounds: { x: 100, y: 80, width: 400, height: 120 },
      zIndex: 1,
    };
    const firstDocument = createDocument("document-1", Promise.resolve(), [element], 2);
    const secondDocument = createDocument("document-2", Promise.resolve(), [element], 2);
    h.open.mockResolvedValueOnce(firstDocument).mockResolvedValueOnce(secondDocument);

    const props = {
      labels,
      referenceSource: {
        workspacePath: "/workspace",
        sourcePath: "/workspace/deck.pptx",
        sourceTitle: "deck.pptx",
      },
    };
    const view = render(
      createElement(PptxPreviewViewer, { ...props, data: new ArrayBuffer(1) }),
    );
    expect(await screen.findByText("document-1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: labels.nextPage }));
    fireEvent.click(screen.getByRole("button", { name: labels.zoomIn }));
    fireEvent.click(screen.getByRole("button", { name: labels.selectElement }));
    fireEvent.click(screen.getByRole("button", { name: element.text }));
    expect(screen.getByRole("button", { name: labels.exitElementSelection })).toBeTruthy();
    expect((screen.getByLabelText(labels.pageInput) as HTMLInputElement).value).toBe("2");
    expect(screen.getByText("125%")).toBeTruthy();

    view.rerender(
      createElement(PptxPreviewViewer, { ...props, data: new ArrayBuffer(2) }),
    );
    expect(await screen.findByText("document-2")).toBeTruthy();
    expect(screen.getByRole("button", { name: labels.selectElement })).toBeTruthy();
    expect((screen.getByLabelText(labels.pageInput) as HTMLInputElement).value).toBe("1");
    expect(screen.getByText("100%")).toBeTruthy();
    expect(
      document.querySelector('[data-pptx-element-selection-overlay="true"]'),
    ).toBeNull();
  });

  it("Ignore element references completed by old generation after file reload", async () => {
    const element: PresentationPageElement = {
      slideIndex: 0,
      slidePart: "ppt/slides/slide1.xml",
      nodeId: "7",
      nodeName: "Title",
      nodeType: "shape",
      text: "Quarterly plan",
      bounds: { x: 100, y: 80, width: 400, height: 120 },
      zIndex: 1,
    };
    const pendingReference = createDeferred<unknown>();
    h.createReference.mockReturnValue(pendingReference.promise);
    h.open
      .mockResolvedValueOnce(createDocument("document-1", Promise.resolve(), [element]))
      .mockResolvedValueOnce(createDocument("document-2", Promise.resolve(), [element]));

    const props = {
      labels,
      referenceSource: {
        workspacePath: "/workspace",
        sourcePath: "/workspace/deck.pptx",
        sourceTitle: "deck.pptx",
      },
    };
    const view = render(
      createElement(PptxPreviewViewer, { ...props, data: new ArrayBuffer(1) }),
    );
    expect(await screen.findByText("document-1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: labels.selectElement }));
    fireEvent.click(screen.getByRole("button", { name: element.text }));
    const actionBar = await screen.findByRole("toolbar", { name: labels.aiEdit });
    fireEvent.click(within(actionBar).getByText(labels.aiEdit).closest("button")!);
    fireEvent.click(
      within(actionBar).getByText(labels.addToConversation).closest("button")!,
    );
    await waitFor(() => expect(h.createReference).toHaveBeenCalledTimes(1));

    view.rerender(
      createElement(PptxPreviewViewer, { ...props, data: new ArrayBuffer(2) }),
    );
    expect(await screen.findByText("document-2")).toBeTruthy();
    await act(async () => {
      pendingReference.resolve({ id: "stale-reference" });
    });

    expect(h.dispatchReference).not.toHaveBeenCalled();
  });

  it("AI edits enter comment drafts first; cancellations are not dispatched, and comments are added to references only upon confirmation", async () => {
    const element: PresentationPageElement = {
      slideIndex: 0,
      slidePart: "ppt/slides/slide1.xml",
      nodeId: "7",
      nodeName: "Title",
      nodeType: "shape",
      text: "Quarterly plan",
      bounds: { x: 100, y: 80, width: 400, height: 120 },
      zIndex: 1,
    };
    const reference = {
      ...element,
      id: "reference-1",
      workspacePath: "/workspace",
      sourcePath: "/workspace/deck.pptx",
      sourceTitle: "deck.pptx",
      sourceFingerprint: `sha256:${"a".repeat(64)}`,
      capturedAt: 1,
    };
    h.open.mockResolvedValue(
      createDocument("document", Promise.resolve(), [element]),
    );
    h.createReference.mockResolvedValue(reference);

    render(
      createElement(PptxPreviewViewer, {
        data: new ArrayBuffer(1),
        labels,
        referenceSource: {
          workspacePath: "/workspace",
          sourcePath: "/workspace/deck.pptx",
          sourceTitle: "deck.pptx",
        },
      }),
    );

    expect(await screen.findByText("document")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: labels.selectElement }));
    fireEvent.click(screen.getByRole("button", { name: element.text }));

    const actionBar = await screen.findByRole("toolbar", {
      name: labels.aiEdit,
    });
    const actionButtons = within(actionBar).getAllByRole("button", {
      hidden: true,
    });
    expect(actionButtons).toHaveLength(1);
    const aiEditButton = actionButtons[0];
    expect(aiEditButton).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: labels.zoomIn }));
    expect(actionBar.isConnected).toBe(true);

    h.readSelectedText.mockReturnValue("Quarterly");
    const mouseDown = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    aiEditButton?.dispatchEvent(mouseDown);
    expect(mouseDown.defaultPrevented).toBe(true);
    fireEvent.click(aiEditButton as HTMLButtonElement);
    expect(h.createReference).not.toHaveBeenCalled();
    expect(h.dispatchReference).not.toHaveBeenCalled();

    const instructionInput = within(actionBar).getByPlaceholderText(
      labels.commentPlaceholder,
    );
    expect(instructionInput.tagName).toBe("TEXTAREA");
    expect(within(actionBar).queryByText(labels.aiEdit)).toBeNull();
    fireEvent.change(instructionInput, {
      target: { value: "  Make the title more concise  " },
    });
    fireEvent.click(
      within(actionBar).getByText(labels.cancelAiEdit).closest("button")!,
    );
    expect(h.createReference).not.toHaveBeenCalled();
    expect(h.dispatchReference).not.toHaveBeenCalled();

    fireEvent.click(
      within(actionBar).getByText(labels.aiEdit).closest("button")!,
    );
    fireEvent.change(
      within(actionBar).getByPlaceholderText(labels.commentPlaceholder),
      { target: { value: "  Make the title more concise  " } },
    );
    fireEvent.click(
      within(actionBar)
        .getByText(labels.addToConversation)
        .closest("button")!,
    );
    await waitFor(() =>
      expect(h.createReference).toHaveBeenCalledWith(
        expect.objectContaining({
          element,
          selectedText: "Quarterly",
          comment: "Make the title more concise",
        }),
      ),
    );
    await waitFor(() => expect(h.dispatchReference).toHaveBeenCalledWith(reference));
    expect(within(actionBar).getByText(labels.aiEdit)).toBeTruthy();

    fireEvent.keyDown(actionBar, { key: "Escape" });
    expect(actionBar.isConnected).toBe(false);
    expect(
      screen.getByRole("button", { name: labels.selectElement }),
    ).toBeTruthy();
  });

  it("Comment draft consumes arrow keys; Esc only reverts draft without exiting element selection", async () => {
    const element: PresentationPageElement = {
      slideIndex: 0,
      slidePart: "ppt/slides/slide1.xml",
      nodeId: "7",
      nodeName: "Title",
      nodeType: "shape",
      text: "Quarterly plan",
      bounds: { x: 100, y: 80, width: 400, height: 120 },
      zIndex: 1,
    };
    h.open.mockResolvedValue(
      createDocument("document", Promise.resolve(), [element], 3),
    );

    render(
      createElement(PptxPreviewViewer, {
        data: new ArrayBuffer(1),
        labels,
        referenceSource: {
          workspacePath: "/workspace",
          sourcePath: "/workspace/deck.pptx",
          sourceTitle: "deck.pptx",
        },
      }),
    );

    expect(await screen.findByText("document")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: labels.selectElement }));
    fireEvent.click(screen.getByRole("button", { name: element.text }));
    const actionBar = await screen.findByRole("toolbar", {
      name: labels.aiEdit,
    });
    fireEvent.click(
      within(actionBar).getAllByRole("button", { hidden: true })[0]!,
    );

    const textarea = within(actionBar).getByPlaceholderText(
      labels.commentPlaceholder,
    );
    fireEvent.change(textarea, { target: { value: "Make it shorter" } });
    const pageInput = screen.getByLabelText(
      labels.pageInput,
    ) as HTMLInputElement;
    expect(pageInput.value).toBe("1");

    fireEvent.keyDown(textarea, { key: "ArrowRight" });
    fireEvent.keyDown(textarea, { key: "ArrowLeft" });
    expect(pageInput.value).toBe("1");
    expect(
      (
        within(actionBar).getByPlaceholderText(
          labels.commentPlaceholder,
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("Make it shorter");

    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(actionBar.isConnected).toBe(true);
    expect(within(actionBar).getByText(labels.aiEdit)).toBeTruthy();
    expect(
      within(actionBar).queryByPlaceholderText(labels.commentPlaceholder),
    ).toBeNull();
    expect(h.createReference).not.toHaveBeenCalled();
    expect(h.dispatchReference).not.toHaveBeenCalled();

    fireEvent.keyDown(actionBar, { key: "Escape" });
    expect(actionBar.isConnected).toBe(false);
    expect(
      screen.getByRole("button", { name: labels.selectElement }),
    ).toBeTruthy();
  });

  it("During IME composition, Esc only cancels candidates without discarding comment draft", async () => {
    const element: PresentationPageElement = {
      slideIndex: 0,
      slidePart: "ppt/slides/slide1.xml",
      nodeId: "7",
      nodeName: "Title",
      nodeType: "shape",
      text: "Quarterly plan",
      bounds: { x: 100, y: 80, width: 400, height: 120 },
      zIndex: 1,
    };
    h.open.mockResolvedValue(
      createDocument("document", Promise.resolve(), [element]),
    );

    render(
      createElement(PptxPreviewViewer, {
        data: new ArrayBuffer(1),
        labels,
        referenceSource: {
          workspacePath: "/workspace",
          sourcePath: "/workspace/deck.pptx",
          sourceTitle: "deck.pptx",
        },
      }),
    );

    expect(await screen.findByText("document")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: labels.selectElement }));
    fireEvent.click(screen.getByRole("button", { name: element.text }));
    const actionBar = await screen.findByRole("toolbar", {
      name: labels.aiEdit,
    });
    fireEvent.click(
      within(actionBar).getAllByRole("button", { hidden: true })[0]!,
    );

    const textarea = within(actionBar).getByPlaceholderText(
      labels.commentPlaceholder,
    );
    fireEvent.change(textarea, { target: { value: "标题" } });

    const draftValue = () =>
      (
        within(actionBar).queryByPlaceholderText(
          labels.commentPlaceholder,
        ) as HTMLTextAreaElement | null
      )?.value;

    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(draftValue()).toBe("标题");

    fireEvent.compositionEnd(textarea);
    fireEvent.keyDown(textarea, { key: "Escape", isComposing: true });
    expect(draftValue()).toBe("标题");

    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(actionBar.isConnected).toBe(true);
    expect(within(actionBar).getByText(labels.aiEdit)).toBeTruthy();
    expect(draftValue()).toBeUndefined();
    expect(h.createReference).not.toHaveBeenCalled();
  });

  it("高亮含文本元素后允许底层文字划选，并继续拦截预览跳转", async () => {
    const textElement: PresentationPageElement = {
      slideIndex: 0,
      slidePart: "ppt/slides/slide1.xml",
      nodeId: "7",
      nodeName: "Title",
      nodeType: "shape",
      text: "Quarterly plan",
      bounds: { x: 100, y: 80, width: 400, height: 120 },
      zIndex: 1,
    };
    const tableCellElement: PresentationPageElement = {
      slideIndex: 0,
      slidePart: "ppt/slides/slide1.xml",
      nodeId: "8",
      nodeName: "Status table",
      nodeType: "table-cell",
      text: "On track",
      bounds: { x: 600, y: 80, width: 200, height: 120 },
      zIndex: 2,
      rowIndex: 0,
      cellIndex: 0,
    };
    const previewDocument = createDocument(
      "Quarterly plan",
      Promise.resolve(),
      [textElement, tableCellElement],
    );
    const navigate = vi.fn();
    previewDocument.renderPage.mockImplementation(
      (_pageIndex: number, container: HTMLElement) => {
        const link = document.createElement("a");
        link.href = "https://example.com";
        link.textContent = "Quarterly plan";
        link.addEventListener("click", navigate);
        container.append(link);
        return { ready: Promise.resolve(), dispose: vi.fn() };
      },
    );
    h.open.mockResolvedValue(previewDocument);

    render(
      createElement(PptxPreviewViewer, {
        data: new ArrayBuffer(1),
        labels,
        referenceSource: {
          workspacePath: "/workspace",
          sourcePath: "/workspace/deck.pptx",
          sourceTitle: "deck.pptx",
        },
      }),
    );

    const renderedText = await screen.findByText("Quarterly plan");
    const renderSurface = renderedText.parentElement;
    expect(renderSurface).not.toBeNull();
    vi.spyOn(
      renderSurface as HTMLElement,
      "getBoundingClientRect",
    ).mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1280,
      bottom: 720,
      width: 1280,
      height: 720,
      toJSON: () => ({}),
    });
    fireEvent.click(screen.getByRole("button", { name: labels.selectElement }));
    fireEvent.click(screen.getByRole("button", { name: textElement.text }));

    expect(renderSurface?.classList.contains("pointer-events-auto")).toBe(true);
    expect(renderSurface?.classList.contains("select-text")).toBe(true);
    expect(
      screen
        .getByRole("button", { name: textElement.text })
        .classList.contains("pointer-events-none"),
    ).toBe(true);

    const textPointerDown = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 100,
    });
    renderSurface?.dispatchEvent(textPointerDown);
    expect(textPointerDown.defaultPrevented).toBe(false);

    const linkClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    renderedText.dispatchEvent(linkClick);
    expect(linkClick.defaultPrevented).toBe(true);
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.pointerDown(renderSurface as HTMLElement, {
      clientX: 650,
      clientY: 100,
    });
    expect(
      screen.getByRole("button", { name: tableCellElement.text }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: tableCellElement.text })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(renderSurface?.classList.contains("pointer-events-auto")).toBe(true);
  });

  it("Same-file reference navigation does not re-parse, and exits element selection mode before navigating", async () => {
    const element: PresentationPageElement = {
      slideIndex: 0,
      slidePart: "ppt/slides/slide1.xml",
      nodeId: "7",
      nodeName: "Title",
      nodeType: "shape",
      text: "Quarterly plan",
      bounds: { x: 100, y: 80, width: 400, height: 120 },
      zIndex: 1,
    };
    const data = new ArrayBuffer(1);
    h.open.mockResolvedValue(
      createDocument("document", Promise.resolve(), [element], 3),
    );
    const view = render(
      createElement(PptxPreviewViewer, {
        data,
        labels,
        referenceSource: {
          workspacePath: "/workspace",
          sourcePath: "/workspace/deck.pptx",
          sourceTitle: "deck.pptx",
        },
      }),
    );

    expect(await screen.findByText("document")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: labels.selectElement }));
    fireEvent.click(screen.getByRole("button", { name: element.text }));
    expect(await screen.findByRole("toolbar", { name: labels.aiEdit })).toBeTruthy();

    view.rerender(
      createElement(PptxPreviewViewer, {
        data,
        labels,
        referenceSource: {
          workspacePath: "/workspace",
          sourcePath: "/workspace/deck.pptx",
          sourceTitle: "deck.pptx",
        },
        referenceNavigation: {
          requestId: "navigation-1",
          pageIndex: 1,
          expectedSourceFingerprint: `sha256:${"a".repeat(64)}`,
        },
      }),
    );

    await waitFor(() =>
      expect(
        (screen.getByRole("textbox", { name: labels.pageInput }) as HTMLInputElement).value,
      ).toBe("2"),
    );
    expect(screen.queryByRole("toolbar", { name: labels.aiEdit })).toBeNull();
    expect(h.open).toHaveBeenCalledTimes(1);
  });

  it("Retain file preview and show toast when page number does not exist; do not use clamp to fake successful navigation", async () => {
    h.open.mockResolvedValue(createDocument("document", Promise.resolve()));

    render(
      createElement(PptxPreviewViewer, {
        data: new ArrayBuffer(1),
        labels,
        referenceNavigation: {
          requestId: "navigation-missing-page",
          pageIndex: 4,
          expectedSourceFingerprint: `sha256:${"a".repeat(64)}`,
        },
      }),
    );

    expect(await screen.findByText("document")).toBeTruthy();
    expect(
      (screen.getByRole("textbox", { name: labels.pageInput }) as HTMLInputElement).value,
    ).toBe("1");
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith("missing-page-5"));
  });

  it("Navigate and show toast when file fingerprint changed but page number exists", async () => {
    h.open.mockResolvedValue(
      createDocument("document", Promise.resolve(), [], 2),
    );

    render(
      createElement(PptxPreviewViewer, {
        data: new ArrayBuffer(1),
        labels,
        referenceNavigation: {
          requestId: "navigation-stale-source",
          pageIndex: 1,
          expectedSourceFingerprint: `sha256:${"b".repeat(64)}`,
        },
      }),
    );

    expect(await screen.findByText("document")).toBeTruthy();
    await waitFor(() =>
      expect(
        (screen.getByRole("textbox", { name: labels.pageInput }) as HTMLInputElement).value,
      ).toBe("2"),
    );
    expect(h.toast).toHaveBeenCalledWith("changed-source-2");
  });
});

describe("PptxPreviewViewer 滚动防护", () => {
  function stubScrollOffset(element: HTMLElement, top: number, left: number) {
    let scrollTop = top;
    let scrollLeft = left;
    Object.defineProperty(element, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    Object.defineProperty(element, "scrollLeft", {
      configurable: true,
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = value;
      },
    });
    return {
      get scrollTop() {
        return scrollTop;
      },
      get scrollLeft() {
        return scrollLeft;
      },
    };
  }

  it("Immediately reset slide inner container after native scrolling (scrollbar hidden, offset invisible and cannot be dragged back)", async () => {
    const doc = createDocument("document-1", Promise.resolve());
    h.open.mockResolvedValueOnce(doc);

    render(createElement(PptxPreviewViewer, { data: new ArrayBuffer(1), labels }));
    const inner = await screen.findByText("document-1");

    const offset = stubScrollOffset(inner, 24, 8);
    inner.dispatchEvent(new Event("scroll"));

    expect(offset.scrollTop).toBe(0);
    expect(offset.scrollLeft).toBe(0);
  });
});
