//
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { getCfToolFamilyForName, normalizeCfToolName } from "@origin-ai/cf-shared";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import { resolveToolCallIdentity } from "@/lib/toolIdentity.js";

vi.mock("@/components/ai-elements/code-block.js", () => ({
  CodeBlock: ({ code, language }: { code: string; language?: string; children?: ReactNode }) =>
    createElement("pre", { "data-testid": "code-block", "data-language": language }, code),
}));

import { SubmitResultToolCallBlock } from "../src/ToolCallBlocks/renderers/submit-result.js";
import { CreateWorkflowToolCallBlock } from "../src/ToolCallBlocks/renderers/create-workflow.js";
import { resolveToolCallRenderer } from "../src/ToolCallBlocks/resolveRenderer.js";
import { ToolCallBlock } from "@/ToolCallBlocks.js";

interface ToolCallOverrides {
  input?: unknown;
  output?: unknown;
  raw?: unknown;
  status?: string;
  toolName?: string;
  snapshotRefs?: readonly { field: string; previewBytes: number; fullBytes: number }[];
}

interface ContextOverrides {
  isRunning?: boolean;
  errorText?: string;
  forceOpen?: boolean;
  onLoadFullToolCallFields?: (toolId: string) => void;
}

function buildContext(toolCall: ToolCallOverrides, contextOverrides: ContextOverrides = {}) {
  return {
    toolCallNode: {
      toolCall: {
        toolId: "tool-submit-result",
        toolName: toolCall.toolName ?? "submit_result",
        kind: toolCall.toolName ?? "submit_result",
        title: toolCall.toolName ?? "submit_result",
        input: toolCall.input,
        output: toolCall.output,
        status: toolCall.status ?? "completed",
        raw: toolCall.raw ?? {},
        snapshotRefs: toolCall.snapshotRefs,
      },
      childToolCalls: [],
    } as any,
    workspacePath: "/workspace",
    displayModel: {
      inlinePreview: { type: "none" },
      planResult: null,
      viewerSource: null,
      viewerLabelId: "codeViewer.viewCode",
      showSummaryFileLink: false,
      showInput: false,
      showOutput: true,
      showKind: false,
    } as any,
    viewerSource: null,
    rawFileSummaries: [],
    isRunning: contextOverrides.isRunning ?? false,
    statusLabel: "已执行",
    errorText: contextOverrides.errorText,
    childToolList: null,
    showIcon: true,
    canToggle: true,
    forceOpen: contextOverrides.forceOpen ?? true,
    onLoadFullToolCallFields: contextOverrides.onLoadFullToolCallFields,
  };
}

function renderBlock(
  toolCall: ToolCallOverrides,
  contextOverrides: ContextOverrides = {},
  locale: "en-US" | "zh-CN" = "zh-CN",
): string {
  return renderToStaticMarkup(
    createElement(
      CfIntlProvider,
      { initialLocale: locale },
      createElement(SubmitResultToolCallBlock, buildContext(toolCall, contextOverrides)),
    ),
  );
}

const REJECTION_TEXT = [
  "The submitted result does not match the required schema:",
  "verdict: expected one of proved | disproved, got string",
  "steps[0].tactic: expected string, got number",
].join("\n");

describe("submit_result 路由", () => {
  it("submit_result 是已知工具名，归 workflow family", () => {
    expect(normalizeCfToolName("submit_result")).toBe("submit_result");
    expect(getCfToolFamilyForName("submit_result")).toBe("workflow");
    expect(resolveToolCallIdentity({ toolName: "submit_result" })).toMatchObject({
      toolName: "submit_result",
      family: "workflow",
      isLegacy: false,
    });
  });

  it("Dispatch by tool name within workflow family without affecting CreateWorkflow", () => {
    expect(resolveToolCallRenderer(buildContext({}) as never)).toBe(SubmitResultToolCallBlock);
    expect(resolveToolCallRenderer(buildContext({ toolName: "CreateWorkflow" }) as never)).toBe(
      CreateWorkflowToolCallBlock,
    );
  });

  it("Full flow from ToolCallBlock entry yields a new card instead of fallback raw JSON dump", () => {
    const html = renderToStaticMarkup(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(ToolCallBlock, {
          toolCallNode: {
            toolCall: {
              toolId: "submit-e2e",
              toolName: "submit_result",
              kind: "submit_result",
              title: "submit_result",
              input: { result: { verdict: "proved" } },
              output: { status: "accepted" },
              status: "completed",
              raw: {},
            },
            childToolCalls: [],
          },
          workspacePath: "/workspace",
        }),
      ),
    );

    expect(html).toContain("Submitted结果");
    expect(html).not.toContain("Submit_result");
    expect(html).not.toContain("&quot;toolId&quot;");
  });
});

describe("SubmitResultToolCallBlock 相位文案", () => {
  it.each([
    { name: "completed", status: "completed", isRunning: false, expected: "Submitted结果" },
    { name: "pending", status: "pending", isRunning: true, expected: "正在提交结果" },
    { name: "in_progress", status: "in_progress", isRunning: true, expected: "正在提交结果" },
    { name: "failed", status: "failed", isRunning: false, expected: "提交被驳回" },
    { name: "stopped", status: "stopped", isRunning: false, expected: "提交已停止" },
  ])("$name phase displays \"$expected\"", ({ status, isRunning, expected }) => {
    const html = renderBlock({ input: { result: { verdict: "proved" } }, status }, { isRunning });

    expect(html).toContain(expected);
  });

  it("en-US 下相位文案同样本地化", () => {
    const html = renderBlock({ input: { result: { verdict: "proved" } } }, {}, "en-US");

    expect(html).toContain("Result submitted");
    expect(html).not.toContain("Submitted结果");
  });
});

describe("SubmitResultToolCallBlock smart body routing", () => {
  it("Object result routes to JSON code block with indented JSON", () => {
    const html = renderBlock({
      input: { result: { verdict: "proved", steps: [{ tactic: "simp" }] } },
      output: { status: "accepted" },
    });

    expect(html).toContain('data-testid="code-block"');
    expect(html).toContain('data-language="json"');
    expect(html).toContain("&quot;verdict&quot;: &quot;proved&quot;");
  });

  it("Array result also takes the JSON branch", () => {
    const html = renderBlock({ input: { result: ["alpha", "beta"] } });

    expect(html).toContain('data-testid="code-block"');
    expect(html).toContain("&quot;alpha&quot;");
  });

  it("Plain string result displays prose without entering code block", () => {
    const prose = "Root cause in scheduler may-set expansion: lane replica lacks actor routing.";
    const html = renderBlock({ input: { result: prose } });

    expect(html).toContain(prose);
    expect(html).not.toContain('data-testid="code-block"');
  });

  it("JSON string result parsed into object and takes code block branch", () => {
    const html = renderBlock({ input: { result: '{"verdict":"disproved","steps":[]}' } });

    expect(html).toContain('data-testid="code-block"');
    expect(html).toContain("&quot;verdict&quot;: &quot;disproved&quot;");
  });

  it("Unparseable JSON-like string stays as prose without crashing card", () => {
    const broken = '{"verdict":"proved"';
    const html = renderBlock({ input: { result: broken } });

    expect(html).not.toContain('data-testid="code-block"');
    expect(html).toContain("{&quot;verdict&quot;:&quot;proved&quot;");
  });

  it("Number/boolean result handled properly (all non-strings take JSON branch)", () => {
    expect(renderBlock({ input: { result: 42 } })).toContain('data-testid="code-block"');
    expect(renderBlock({ input: { result: false } })).toContain('data-testid="code-block"');
  });

  it("Reads result even when input is a JSON string", () => {
    const html = renderBlock({ input: JSON.stringify({ result: { verdict: "proved" } }) });

    expect(html).toContain('data-testid="code-block"');
    expect(html).toContain("&quot;verdict&quot;");
  });

  it("Collapsed header shows a single-line result summary", () => {
    const html = renderBlock(
      { input: { result: { verdict: "proved", steps: [{ tactic: "simp" }] } } },
      { forceOpen: false },
    );

    expect(html).toContain("{&quot;verdict&quot;:&quot;proved&quot;");
    expect(html).not.toContain("&quot;verdict&quot;: &quot;proved&quot;");
    expect(html).not.toContain('data-testid="code-block"');
  });
});

describe("SubmitResultToolCallBlock 流式门", () => {
  it("Provides no expand toggle or empty panel when first frame lacks result key", () => {
    const html = renderBlock(
      { input: {}, status: "pending", raw: { kind: "tool_input_start" } },
      { isRunning: true, forceOpen: true },
    );

    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('data-testid="code-block"');
    expect(html).toContain("正在提交结果");
  });

  it("Provides no expand toggle when input is completely missing", () => {
    const html = renderBlock({ status: "pending" }, { isRunning: true });

    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('data-testid="code-block"');
  });
});

describe("SubmitResultToolCallBlock 驳回态", () => {
  it("Rejected state is a flat row: no expand toggle, no body rendered, and no repeated per-field violations", () => {
    const html = renderBlock(
      { input: { result: { verdict: "yes" } }, status: "failed", output: REJECTION_TEXT },
      { errorText: REJECTION_TEXT },
    );

    expect(html).toContain("提交被驳回");
    expect(html).toContain("{&quot;verdict&quot;:&quot;yes&quot;}");
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('data-testid="code-block"');
    expect(html).not.toContain("expected one of proved | disproved, got string");
    expect(html).not.toContain("不符合要求的字段");
  });

  it("驳回态没有任何错误文本时同样是扁平行", () => {
    const html = renderBlock({ input: { result: { verdict: "yes" } }, status: "failed" });

    expect(html).toContain("提交被驳回");
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('data-testid="code-block"');
  });
});

describe("SubmitResultToolCallBlock 快照字段提示", () => {
  it("Snapshot field hint remains attached to card", () => {
    const html = renderBlock(
      {
        input: { result: { verdict: "proved" } },
        snapshotRefs: [{ field: "input", previewBytes: 100, fullBytes: 5_000 }],
      },
      { onLoadFullToolCallFields: () => {} },
    );

    expect(html).toContain("加载完整工具数据");
  });
});
