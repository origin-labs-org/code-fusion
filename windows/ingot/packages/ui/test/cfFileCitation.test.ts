import { describe, expect, it } from "vitest";
import {
  extractCfFileCitations,
  projectCfFileCitations,
  resolveCfFileCitationPreviewKind,
} from "@/lib/cfFileCitation.js";

describe("cf-file-citation parser", () => {
  it("只保留 path、purpose 和 artifact_kind，并容忍Other定位参数", () => {
    const content = [
      'Preceding text ::cf-file-citation{path="docs/年度 报告.docx" purpose="output" artifact_kind="document" page_number=4 future_locator="ignored"} Following text',
      String.raw`::cf-file-citation{path='C:\Users\Zhang San\Demo Text稿.pptx', artifact_kind=presentation, slide_number=3}`,
      ':cf-file-citation{path="sheets/年度 总结.xlsx" purpose="source" artifact_kind="workbook" sheet_name="总览"}',
      ':::cf-file-citation{path="reports/论Text.pdf" purpose="source"}',
    ].join("\n");

    expect(extractCfFileCitations(content)).toEqual([
      {
        artifactKind: "document",
        end: content.indexOf("} Following text") + 1,
        path: "docs/年度 报告.docx",
        purpose: "output",
        raw: '::cf-file-citation{path="docs/年度 报告.docx" purpose="output" artifact_kind="document" page_number=4 future_locator="ignored"}',
        start: 3,
      },
      {
        artifactKind: "presentation",
        end: content.indexOf("\n:cf-file-citation"),
        path: String.raw`C:\Users\Zhang San\Demo Text稿.pptx`,
        purpose: undefined,
        raw: String.raw`::cf-file-citation{path='C:\Users\Zhang San\Demo Text稿.pptx', artifact_kind=presentation, slide_number=3}`,
        start: content.indexOf("\n::cf-file-citation") + 1,
      },
      {
        artifactKind: "workbook",
        end: content.indexOf("\n:::cf-file-citation"),
        path: "sheets/年度 总结.xlsx",
        purpose: "source",
        raw: ':cf-file-citation{path="sheets/年度 总结.xlsx" purpose="source" artifact_kind="workbook" sheet_name="总览"}',
        start: content.indexOf("\n:cf-file-citation") + 1,
      },
      {
        end: content.length,
        path: "reports/论文.pdf",
        purpose: "source",
        raw: ':::cf-file-citation{path="reports/论Text.pdf" purpose="source"}',
        start: content.indexOf("\n:::cf-file-citation") + 1,
      },
    ]);
  });

  it("支持 citation 参数使用中文智能单双引号", () => {
    const content = [
      '::cf-file-citation{path=“docs/年度 报告.docx” purpose=‘output’ artifact_kind="document"}',
      "::cf-file-citation{path='docs/普通 Report.pdf' purpose=\"output\"}",
    ].join("\n");

    expect(
      extractCfFileCitations(content).map(({ path, purpose, artifactKind }) => ({
        path,
        purpose,
        artifactKind,
      })),
    ).toEqual([
      {
        path: "docs/年度 报告.docx",
        purpose: "output",
        artifactKind: "document",
      },
      {
        path: "docs/普通 Report.pdf",
        purpose: "output",
        artifactKind: undefined,
      },
    ]);
  });

  it("Ignore unclosed, malformed parameter, and path-missing directives", () => {
    expect(
      extractCfFileCitations(
        [
          '::cf-file-citation{purpose="output"}',
          '::cf-file-citation{path "missing equals.pdf"}',
          '::cf-file-citation{path="unclosed.pdf"',
          ':cf-file-citation{path "single-colon-missing-equals.pdf"}',
          '::::cf-file-citation{path="too-many-colons.pdf"}',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("错配智能引号时 fail closed", () => {
    expect(extractCfFileCitations("::cf-file-citation{path=“docs/report.pdf'}")).toEqual([]);
  });

  it("Streaming hides unclosed citation on last line without swallowing text after abnormal output", () => {
    const incomplete = projectCfFileCitations(
      '正文\n::cf-file-citation{path="reports/result.pdf"',
      { streaming: true },
    );
    expect(incomplete.visibleText).toBe("正文\n");

    const inlineIncomplete = projectCfFileCitations(
      'Please note ::cf-file-citation{path="reports/result.pdf"',
      { streaming: true },
    );
    expect(inlineIncomplete.visibleText).toBe("Please note ");

    const malformedWithFollowingText = projectCfFileCitations(
      'Body\n::cf-file-citation{path="reports/result.pdf"\nSubsequent text remains visible',
      { streaming: true },
    );
    expect(malformedWithFollowingText.visibleText).toContain("Subsequent text remains visible");
    expect(malformedWithFollowingText.visibleText).toContain("::cf-file-citation");

    const inlineMalformed = projectCfFileCitations(
      'Please note ::cf-file-citation{path="reports/result.pdf" Subsequent text',
      { streaming: true },
    );
    expect(inlineMalformed.visibleText).toContain("Please note");
    expect(inlineMalformed.visibleText).toContain("Subsequent text");

    const legacyIncomplete = projectCfFileCitations(
      '正文\n:cf-file-citation{path="reports/legacy.pdf"',
      { streaming: true },
    );
    expect(legacyIncomplete.visibleText).toBe("正文\n");

    const legacyMalformed = projectCfFileCitations(
      'Body\n:cf-file-citation{path="reports/legacy.pdf"\nSubsequent text remains visible',
      { streaming: true },
    );
    expect(legacyMalformed.visibleText).toContain("Subsequent text remains visible");
    expect(legacyMalformed.visibleText).toContain(":cf-file-citation");

    const tripleIncomplete = projectCfFileCitations(
      '正文\n:::cf-file-citation{path="reports/triple.pdf"',
      { streaming: true },
    );
    expect(tripleIncomplete.visibleText).toBe("正文\n");
  });

  it("Streaming buffers protocol prefix before citation name is closed", () => {
    expect(projectCfFileCitations("正文\n::", { streaming: true }).visibleText).toBe("正文\n");
    expect(
      projectCfFileCitations("正文\n::cf-file-cit", { streaming: true }).visibleText,
    ).toBe("正文\n");
    expect(projectCfFileCitations("正文\n:", { streaming: true }).visibleText).toBe("正文\n:");
    expect(
      projectCfFileCitations("正文\n:cf-file-cit", { streaming: true }).visibleText,
    ).toBe("正文\n");
    expect(
      projectCfFileCitations("正文\n:::cf-file-cit", { streaming: true }).visibleText,
    ).toBe("正文\n");
    expect(
      projectCfFileCitations("正文\n::cf-file-citationX", { streaming: true }).visibleText,
    ).toContain("::cf-file-citationX");
    expect(
      projectCfFileCitations("正文\n:cf-file-citationX", { streaming: true }).visibleText,
    ).toContain(":cf-file-citationX");
  });

  it("智能引号未闭合时仍隐藏流式 citation 尾部", () => {
    const result = projectCfFileCitations("正文\n::cf-file-citation{path=“docs/report.pdf”", {
      streaming: true,
    });
    expect(result.visibleText).toBe("正文\n");
  });

  it("artifact_kind maps preferentially and must be extension-compatible; inferred from extension when unset", () => {
    expect(
      resolveCfFileCitationPreviewKind({
        artifactKind: "document",
        path: "report.docx",
      }),
    ).toBe("docx");
    expect(
      resolveCfFileCitationPreviewKind({
        artifactKind: "presentation",
        path: "deck.pptx",
      }),
    ).toBe("pptx");
    expect(
      resolveCfFileCitationPreviewKind({
        artifactKind: "workbook",
        path: "book.xlsx",
      }),
    ).toBe("xlsx");
    expect(resolveCfFileCitationPreviewKind({ path: "paper.PDF" })).toBe("pdf");
    expect(resolveCfFileCitationPreviewKind({ path: "README.md" })).toBeNull();
    expect(
      resolveCfFileCitationPreviewKind({
        artifactKind: "document",
        path: "paper.pdf",
      }),
    ).toBeNull();
    expect(
      resolveCfFileCitationPreviewKind({
        artifactKind: "unknown",
        path: "paper.pdf",
      }),
    ).toBeNull();
    expect(
      resolveCfFileCitationPreviewKind({
        artifactKind: "",
        path: "paper.pdf",
      }),
    ).toBeNull();
  });
});
