import { describe, expect, it } from "vitest";
import {
  addPptxElementReference,
  buildPromptWithPptxElementReferences,
  createPptxElementReference,
  getPptxElementReferenceWorkspaceKey,
  isPptxElementReferencePayload,
  isPptxElementReferenceInWorkspaceScope,
  parsePromptPptxElementReferences,
  sha256Fingerprint,
  type PptxElementReference,
} from "@/lib/pptxElementReference.js";

function makeReference(
  overrides: Partial<PptxElementReference> = {},
): PptxElementReference {
  return {
    bounds: { x: 10, y: 20, width: 300, height: 80 },
    capturedAt: 1_700_000_000_000,
    id: "pptx-ref-1",
    nodeId: "7",
    nodeName: "Title 1",
    nodeType: "shape",
    slideIndex: 0,
    slidePart: "ppt/slides/slide1.xml",
    sourceFingerprint: `sha256:${"a".repeat(64)}`,
    sourcePath: "/workspace/deck.pptx",
    sourceTitle: "deck.pptx",
    text: "Quarterly review",
    textFingerprint: `sha256:${"b".repeat(64)}`,
    workspaceIdentity: "ssh:user@host:/workspace",
    workspacePath: "/workspace",
    remoteSessionId: "remote-1",
    zIndex: 2,
    ...overrides,
  };
}

describe("PPTX element reference", () => {
  it("Selected substring and comments only serve as context; complete element text generates reference fingerprint", async () => {
    const elementText = "Quarterly review";
    const selectedText = "Quarterly";
    const reference = await createPptxElementReference({
      element: {
        ...makeReference(),
        text: elementText,
      },
      selectedText,
      comment: "  Make it more concise  ",
      workspacePath: "/workspace",
      sourcePath: "/workspace/deck.pptx",
      sourceTitle: "deck.pptx",
      sourceFingerprint: `sha256:${"a".repeat(64)}`,
    });

    expect(reference.text).toBe(elementText);
    expect(reference.selectedText).toBe(selectedText);
    expect(reference.comment).toBe("Make it more concise");
    expect(reference.textFingerprint).toBe(
      await sha256Fingerprint(elementText),
    );
  });

  it("Blank comments are not included in references and do not change element fingerprint", async () => {
    const elementText = "Quarterly review";
    const reference = await createPptxElementReference({
      element: {
        ...makeReference(),
        text: elementText,
      },
      comment: "   ",
      workspacePath: "/workspace",
      sourcePath: "/workspace/deck.pptx",
      sourceTitle: "deck.pptx",
      sourceFingerprint: `sha256:${"a".repeat(64)}`,
    });

    expect(reference).not.toHaveProperty("comment");
    expect(reference.textFingerprint).toBe(
      await sha256Fingerprint(elementText),
    );
  });

  it("校验稳定 source、slide、node 与 table-cell 坐标", () => {
    expect(isPptxElementReferencePayload(makeReference())).toBe(true);
    expect(
      isPptxElementReferencePayload(
        makeReference({ nodeType: "table-cell", rowIndex: 1, cellIndex: 2 }),
      ),
    ).toBe(true);
    expect(
      isPptxElementReferencePayload(
        makeReference({
          nodeType: "table-cell",
          rowIndex: undefined,
          cellIndex: 2,
        }),
      ),
    ).toBe(false);
    expect(
      isPptxElementReferencePayload(
        makeReference({ sourceFingerprint: "size:42" }),
      ),
    ).toBe(false);
    expect(
      isPptxElementReferencePayload({
        ...makeReference(),
        nodePath: 42,
      }),
    ).toBe(false);
    expect(
      isPptxElementReferencePayload({
        ...makeReference(),
        text: { unexpected: true },
      }),
    ).toBe(false);
    expect(
      isPptxElementReferencePayload({
        ...makeReference(),
        selectedText: { unexpected: true },
      }),
    ).toBe(false);
    expect(
      isPptxElementReferencePayload({
        ...makeReference(),
        comment: { unexpected: true },
      }),
    ).toBe(false);
  });

  it("按 source path、fingerprint、slide part、node id 和 cell 坐标精确去重", () => {
    const first = makeReference();
    const updated = makeReference({
      id: "new-id",
      text: "Updated preview",
      selectedText: "Updated",
      comment: "Use the revised wording",
    });
    const anotherCell = makeReference({
      id: "cell-2",
      nodeType: "table-cell",
      rowIndex: 0,
      cellIndex: 1,
    });

    expect(addPptxElementReference([first], updated)).toEqual([updated]);
    expect(addPptxElementReference([first], anotherCell)).toEqual([
      first,
      anotherCell,
    ]);
    expect(
      addPptxElementReference(
        [first],
        makeReference({
          id: "copied-deck",
          sourcePath: "/workspace/copy/deck.pptx",
        }),
      ),
    ).toHaveLength(2);
  });

  it("Serialize multiple PPTX comments with code-comment-like semantics and restore losslessly", () => {
    const reference = makeReference({
      text: "Title with ``` marker",
      selectedText: "Title",
      comment: "Use sentence case",
    });
    const secondReference = makeReference({
      id: "pptx-ref-2",
      nodeId: "8",
      comment: "Make the subtitle shorter",
    });
    const prompt = buildPromptWithPptxElementReferences("请执行", [
      reference,
      secondReference,
    ]);
    const parsed = parsePromptPptxElementReferences(prompt);

    expect(prompt).toContain("# Presentation element comments:");
    expect(prompt).toContain(
      "Treat every non-empty `comment` as the user's instruction",
    );
    expect(prompt).toContain('"comment": "Use sentence case"');
    expect(prompt).toContain('"comment": "Make the subtitle shorter"');
    expect(parsed.visibleContent).toBe("请执行");
    expect(parsed.pptxElementReferences).toEqual([reference, secondReference]);
  });

  it("Continue parsing historical Presentation elements JSON tail block", () => {
    const reference = makeReference();
    const legacyPrompt = `Please inspect\n\n# Presentation elements:\n\n\`\`\`json\n${JSON.stringify(
      [reference],
      null,
      2,
    )}\n\`\`\``;

    expect(parsePromptPptxElementReferences(legacyPrompt)).toEqual({
      visibleContent: "Please inspect",
      pptxElementReferences: [reference],
    });
  });

  it("When body has a heading with the same name, only consume the actual tail block without truncating visible body", () => {
    const visibleContent =
      "Please read this:\n\n# Presentation element comments:\n\nblah blah";
    const reference = makeReference({ comment: "Shorten it" });
    const prompt = buildPromptWithPptxElementReferences(visibleContent, [
      reference,
    ]);

    expect(parsePromptPptxElementReferences(prompt)).toEqual({
      visibleContent,
      pptxElementReferences: [reference],
    });
  });

  it("允许只有引用的 context-only prompt，并保持 workspace identity fallback", () => {
    const prompt = buildPromptWithPptxElementReferences("", [makeReference()]);
    expect(
      parsePromptPptxElementReferences(prompt).pptxElementReferences,
    ).toHaveLength(1);
    expect(
      getPptxElementReferenceWorkspaceKey("/workspace", "  remote-id  "),
    ).toBe("remote-id");
    expect(getPptxElementReferenceWorkspaceKey("/workspace", " ")).toBe(
      "/workspace",
    );
    expect(
      isPptxElementReferenceInWorkspaceScope(makeReference(), {
        workspacePath: "/different-mounted-path",
        workspaceIdentity: "ssh:user@host:/workspace",
        remoteSessionId: "remote-1",
      }),
    ).toBe(true);
    expect(
      isPptxElementReferenceInWorkspaceScope(makeReference(), {
        workspacePath: "/workspace",
        workspaceIdentity: "ssh:user@host:/workspace",
        remoteSessionId: "remote-2",
      }),
    ).toBe(false);
  });
});
