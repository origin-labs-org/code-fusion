//
//
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";

vi.mock("@/components/ai-elements/code-block.js", () => ({
  CodeBlock: ({ code, language }: { code: string; language?: string; children?: ReactNode }) =>
    createElement("pre", { "data-testid": "code-block", "data-language": language }, code),
}));

import { EscalateToolCallBlock } from "../src/ToolCallBlocks/renderers/escalate.js";
import { ResolveWorkflowQuestionToolCallBlock } from "../src/ToolCallBlocks/renderers/resolve-workflow-question.js";
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

function buildContext(
  toolCall: ToolCallOverrides,
  contextOverrides: ContextOverrides = {},
  defaultName = "escalate",
) {
  const name = toolCall.toolName ?? defaultName;
  return {
    toolCallNode: {
      toolCall: {
        toolId: "tool-escalation",
        toolName: name,
        kind: name,
        title: name,
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

function renderEscalate(
  toolCall: ToolCallOverrides,
  contextOverrides: ContextOverrides = {},
  locale: "en-US" | "zh-CN" = "zh-CN",
): string {
  return renderToStaticMarkup(
    createElement(
      CfIntlProvider,
      { initialLocale: locale },
      createElement(EscalateToolCallBlock, buildContext(toolCall, contextOverrides, "escalate")),
    ),
  );
}

function renderResolve(
  toolCall: ToolCallOverrides,
  contextOverrides: ContextOverrides = {},
  locale: "en-US" | "zh-CN" = "zh-CN",
): string {
  return renderToStaticMarkup(
    createElement(
      CfIntlProvider,
      { initialLocale: locale },
      createElement(
        ResolveWorkflowQuestionToolCallBlock,
        buildContext(toolCall, contextOverrides, "ResolveWorkflowQuestion"),
      ),
    ),
  );
}

describe("UpgradeQuestionAnswerTools卡路由", () => {
  it("escalate 按名分流到专用卡，不误伤 CreateWorkflow", () => {
    expect(resolveToolCallRenderer(buildContext({}, {}, "escalate") as never)).toBe(
      EscalateToolCallBlock,
    );
    expect(resolveToolCallRenderer(buildContext({ toolName: "CreateWorkflow" }) as never)).toBe(
      CreateWorkflowToolCallBlock,
    );
  });

  it("ResolveWorkflowQuestion 按名分流，snake_case wire 写法也Hit", () => {
    for (const toolName of ["ResolveWorkflowQuestion", "resolve_workflow_question"]) {
      expect(resolveToolCallRenderer(buildContext({ toolName }) as never)).toBe(
        ResolveWorkflowQuestionToolCallBlock,
      );
    }
  });

  it("从 ToolCallBlock 入口整链走下来就Yes专用卡，不再Yes fallback 的裸 JSON dump", () => {
    const escalateHtml = renderToStaticMarkup(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(ToolCallBlock, {
          toolCallNode: {
            toolCall: {
              toolId: "escalate-e2e",
              toolName: "escalate",
              kind: "escalate",
              title: "escalate",
              input: { question: "门坏了吗？" },
              output: "Skip它。",
              status: "completed",
              raw: {},
            },
            childToolCalls: [],
          },
          workspacePath: "/workspace",
        }),
      ),
    );
    expect(escalateHtml).toContain("已询Question主代理");
    expect(escalateHtml).not.toContain("&quot;toolId&quot;");

    const resolveHtml = renderToStaticMarkup(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(ToolCallBlock, {
          toolCallNode: {
            toolCall: {
              toolId: "resolve-e2e",
              toolName: "ResolveWorkflowQuestion",
              kind: "ResolveWorkflowQuestion",
              title: "ResolveWorkflowQuestion",
              input: { question_id: "dwfq-run1-1", answer: "Skip它。" },
              output: "Answer delivered.",
              status: "completed",
              raw: {},
            },
            childToolCalls: [],
          },
          workspacePath: "/workspace",
        }),
      ),
    );
    expect(resolveHtml).toContain("已AnswerIssue");
    expect(resolveHtml).not.toContain("&quot;toolId&quot;");
  });
});

describe("EscalateToolCallBlock E位Copy", () => {
  it.each([
    { name: "in_progress", status: "in_progress", isRunning: true, expected: "In progress询Question主代理" },
    { name: "pending", status: "pending", isRunning: true, expected: "In progress询Question主代理" },
    { name: "completed", status: "completed", isRunning: false, expected: "已询Question主代理" },
  ])("$name phase displays \"$expected\"", ({ status, isRunning, expected }) => {
    const html = renderEscalate({ input: { question: "门坏了吗？" }, status }, { isRunning });
    expect(html).toContain(expected);
  });

  it("en-US 下相位文案同样本地化", () => {
    const asking = renderEscalate(
      { input: { question: "Is the gate broken?" }, status: "in_progress" },
      { isRunning: true },
      "en-US",
    );
    expect(asking).toContain("Asking the main agent");

    const asked = renderEscalate(
      { input: { question: "Is the gate broken?" }, output: "Yes, skip it." },
      {},
      "en-US",
    );
    expect(asked).toContain("Asked the main agent");
    expect(asked).not.toContain("In progress询Question主代理");
  });
});

describe("EscalateToolCallBlock body 分支", () => {
  it("Issue + 背景 + Answer 3段齐备", () => {
    const html = renderEscalate({
      input: { question: "门坏了吗？", context: "阈Value 96，实际封顶 95。" },
      output: "对，Skip它，用旁路。",
    });
    expect(html).toContain("门坏了吗？");
    expect(html).toContain("阈Value 96，实际封顶 95。");
    expect(html).toContain("对，Skip它，用旁路。");
    expect(html).toContain("问题");
    expect(html).toContain("背景");
    expect(html).toContain("Answer复");
  });

  it("停驻Medium（running）只有Issue、没有Answer区，卡不显Failed", () => {
    const html = renderEscalate(
      { input: { question: "门坏了吗？" }, status: "in_progress" },
      { isRunning: true },
    );
    expect(html).toContain("门坏了吗？");
    expect(html).toContain("In progress询Question主代理");
    expect(html).not.toContain("执行失败");
    expect(html).not.toContain("text-destructive");
  });

  it("Budget已尽的驳回Yes普通Result——照常渲染成Answer，绝不当Failed", () => {
    const refusal =
      "You have used all 3 escalations for this ask. Proceed on your own best judgement.";
    const html = renderEscalate({ input: { question: "还能再Question吗？" }, output: refusal });
    expect(html).toContain(refusal);
    expect(html).not.toContain("执行失败");
    expect(html).not.toContain("border-destructive");
  });

  it("首帧 input 还Yes空对e时不提供展开入口，也不渲染空面板", () => {
    const html = renderEscalate(
      { input: {}, status: "pending" },
      { isRunning: true, forceOpen: true },
    );
    expect(html).toContain("In progress询Question主代理");
    expect(html).not.toContain('role="button"');
  });
});

describe("ResolveWorkflowQuestionToolCallBlock E位Copy", () => {
  it.each([
    { name: "in_progress", status: "in_progress", isRunning: true, expected: "In progressAnswerIssue" },
    { name: "completed", status: "completed", isRunning: false, expected: "已AnswerIssue" },
  ])("$name phase displays \"$expected\"", ({ status, isRunning, expected }) => {
    const html = renderResolve(
      { input: { question_id: "dwfq-run1-1", answer: "Skip它。" }, status },
      { isRunning },
    );
    expect(html).toContain(expected);
  });

  it("en-US 下相位文案同样本地化", () => {
    const html = renderResolve(
      { input: { question_id: "dwfq-run1-1", answer: "Skip it." }, output: "Answer delivered." },
      {},
      "en-US",
    );
    expect(html).toContain("Answered question");
    expect(html).not.toContain("In progressAnswerIssue");
  });
});

describe("ResolveWorkflowQuestionToolCallBlock body 分支", () => {
  it("qid mono 行 + CompleteAnswer + 成功确认Three段齐备", () => {
    const html = renderResolve({
      input: { question_id: "dwfq-run1-1", answer: "Skip那道门，用旁路。" },
      output: "Answer delivered for question dwfq-run1-1. The run keeps going.",
    });
    expect(html).toContain("dwfq-run1-1");
    expect(html).toMatch(/font-mono[^>]*>dwfq-run1-1/u);
    expect(html).toContain("Skip那道门，用旁路。");
    expect(html).toContain("The run keeps going.");
    expect(html).toContain("Issue ID");
    expect(html).toContain("Answer复");
    expect(html).toContain("结果");
  });

  it("Structures化Deny走Failed样式（status failed）", () => {
    const refusal = "workflow_question_already_resolved: this question was already answered.";
    const html = renderResolve(
      { input: { question_id: "dwfq-run1-1", answer: "Skip它。" }, status: "failed" },
      { errorText: refusal },
    );
    expect(html).toContain("执行失败");
    expect(html).toContain(refusal);
    expect(html).toContain("border-destructive");
  });

  it("成功确认不带任何Failed样式", () => {
    const html = renderResolve({
      input: { question_id: "dwfq-run1-1", answer: "Skip它。" },
      output: "Answer delivered for question dwfq-run1-1.",
    });
    expect(html).not.toContain("执行失败");
    expect(html).not.toContain("border-destructive");
  });
});

describe("UpgradeQuestionAnswerTools卡快照Character段Notice", () => {
  it("escalate Snapshot field hint remains attached to card", () => {
    const html = renderEscalate(
      {
        input: { question: "门坏了吗？" },
        snapshotRefs: [{ field: "input", previewBytes: 100, fullBytes: 5_000 }],
      },
      { onLoadFullToolCallFields: () => {} },
    );
    expect(html).toContain("加载完整工具数据");
  });
});
