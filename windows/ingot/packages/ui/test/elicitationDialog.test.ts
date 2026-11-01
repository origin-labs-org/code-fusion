import type { CfElicitationRequest } from "@origin-ai/cf-shared";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  buildElicitationResponseContent,
  createInitialElicitationDrafts,
  ElicitationDialog,
  getElicitationCountdownSeconds,
  getElicitationQuestionAdvanceKind,
  normalizeElicitationQuestions,
  resolveElicitationCustomInputKeyAction,
  updateElicitationDraftsForOption,
} from "../src/ElicitationDialog.js";
import { CfIntlProvider } from "../src/i18n/IntlProvider.js";

const SUBAGENT_ORIGIN = {
  kind: "subagent" as const,
  agentId: "general-purpose",
  agentType: "general-purpose",
  childSessionId: "sess-child",
  parentSessionId: "sess-parent",
  parentToolCallId: "tool-parent-agent",
};

function createMultiQuestionRequest(): CfElicitationRequest {
  return {
    type: "elicitation_request",
    taskId: "task-1",
    traceId: "run-1",
    requestId: "request-1",
    message: "请选择方案",
    options: [],
    questions: [
      {
        question: "请选择方案",
        header: "方案",
        options: [
          { value: "fast", label: "快速" },
          { value: "safe", label: "稳妥" },
        ],
      },
      {
        question: "Please select a guarantee option",
        header: "保障项",
        options: [
          { value: "tests", label: "Testing" },
          { value: "docs", label: "文档" },
        ],
      },
    ],
  };
}

function createPlanApprovalRequest(): CfElicitationRequest {
  return {
    type: "elicitation_request",
    taskId: "task-1",
    traceId: "run-1",
    requestId: "exit-plan-1",
    message: "Review this implementation plan.",
    header: "Plan",
    options: [
      {
        value: "approve",
        label: "Approve",
        description: "Exit plan mode and start implementation.",
      },
    ],
    questions: [
      {
        question: "Review this implementation plan.",
        header: "Plan",
        options: [
          {
            value: "approve",
            label: "Approve",
            description: "Exit plan mode and start implementation.",
          },
        ],
      },
    ],
    schema: { interaction: "plan_approval", toolName: "ExitPlanMode" },
  };
}

describe("ElicitationDialog", () => {
  it("only exposes 59s through 1s during the final minute", () => {
    const autoResolution = {
      state: "visibleCountdown" as const,
      startedAt: 700_000,
      visibleAt: 760_000,
      deadlineAt: 1_000_000,
    };

    expect(getElicitationCountdownSeconds(autoResolution, 940_000)).toBeNull();
    expect(getElicitationCountdownSeconds(autoResolution, 940_001)).toBe(59);
    expect(getElicitationCountdownSeconds(autoResolution, 999_000)).toBe(1);
    expect(getElicitationCountdownSeconds(autoResolution, 999_999)).toBe(1);
    expect(getElicitationCountdownSeconds(autoResolution, 1_000_000)).toBeNull();
    expect(
      getElicitationCountdownSeconds(
        { state: "snoozed", startedAt: 700_000, snoozedAt: 900_000 },
        940_001,
      ),
    ).toBeNull();
  });

  it("renders a localized final-minute timer", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(940_001);
    const Dialog = ElicitationDialog as ComponentType<Record<string, unknown>>;
    const autoResolution = {
      state: "visibleCountdown" as const,
      startedAt: 700_000,
      visibleAt: 760_000,
      deadlineAt: 1_000_000,
    };
    const render = (locale: "en-US" | "zh-CN") =>
      renderToStaticMarkup(
        createElement(
          CfIntlProvider,
          { initialLocale: locale },
          createElement(Dialog, {
            request: createMultiQuestionRequest(),
            autoResolution,
            onFirstInteraction: () => {},
            onRespond: () => {},
          }),
        ),
      );

    try {
      const zhHtml = render("zh-CN");
      expect(zhHtml).toContain('data-elicitation-countdown-seconds="59"');
      expect(zhHtml).toContain('aria-label="停止计时"');
      expect(zhHtml).toContain(">59秒</button>");

      const enHtml = render("en-US");
      expect(enHtml).toContain(">59s</button>");
      expect(enHtml).toContain('aria-label="Stop timer"');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("shows a subagent source tag for delegated elicitation requests only", () => {
    const Dialog = ElicitationDialog as ComponentType<Record<string, unknown>>;
    const request = createMultiQuestionRequest();
    const mainHtml = renderToStaticMarkup(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(Dialog, {
          request,
          onRespond: () => {},
        }),
      ),
    );
    const subagentHtml = renderToStaticMarkup(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(Dialog, {
          request: {
            ...request,
            origin: SUBAGENT_ORIGIN,
          },
          onRespond: () => {},
        }),
      ),
    );

    expect(mainHtml).not.toContain('data-interaction-origin-badge="subagent"');
    expect(subagentHtml).toContain('data-interaction-origin-badge="subagent"');
    expect(subagentHtml).toContain("子智能体");
    expect(subagentHtml).toContain("来自子智能体：general-purpose");
  });

  it("submits after the final question and includes the final selected option", () => {
    const request = createMultiQuestionRequest();
    const questions = normalizeElicitationQuestions(request);
    const initialDrafts = createInitialElicitationDrafts(questions, request);
    const firstDrafts = updateElicitationDraftsForOption(initialDrafts, questions[0]!, "fast");
    const finalDrafts = updateElicitationDraftsForOption(firstDrafts, questions[1]!, "tests");

    expect(getElicitationQuestionAdvanceKind(questions, 0)).toBe("next");
    expect(getElicitationQuestionAdvanceKind(questions, 1)).toBe("submit");
    expect(buildElicitationResponseContent(questions, finalDrafts)).toEqual({
      answers: {
        Please select an option: "fast",
        Please select a guarantee option: "tests",
      },
      answer_0: "fast",
      answer_1: "tests",
    });
  });

  it("Allow submitting answers to only some questions without forging unanswered items", () => {
    const request = createMultiQuestionRequest();
    const questions = normalizeElicitationQuestions(request);
    const initialDrafts = createInitialElicitationDrafts(questions, request);
    const finalDrafts = updateElicitationDraftsForOption(initialDrafts, questions[1]!, "tests");

    expect(buildElicitationResponseContent(questions, finalDrafts)).toEqual({
      answers: { Please select a guarantee option: "tests" },
      answer_1: "tests",
    });
  });

  it("允许提交零回答", () => {
    const request = createMultiQuestionRequest();
    const questions = normalizeElicitationQuestions(request);
    const drafts = createInitialElicitationDrafts(questions, request);

    expect(buildElicitationResponseContent(questions, drafts)).toEqual({ answers: {} });
  });

  it("Preserve full hover title for truncated question titles", () => {
    const Dialog = ElicitationDialog as ComponentType<Record<string, unknown>>;
    const longQuestion =
      "The PRD spans 4 native codebases plus shared contract and tokens. How should I sequence implementation?";
    const request = createMultiQuestionRequest();
    request.questions![0] = {
      ...request.questions![0]!,
      question: longQuestion,
    };
    const html = renderToStaticMarkup(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(Dialog, {
          request,
          onRespond: () => {},
        }),
      ),
    );

    expect(html).toContain(`title="${longQuestion}"`);
  });

  it("Keep both body text and full title for long questions", () => {
    const Dialog = ElicitationDialog as ComponentType<Record<string, unknown>>;
    const longQuestion =
      "The PRD spans 4 native codebases plus shared contract and tokens. How should I sequence implementation without hiding the decision text on mobile?";
    const request = createMultiQuestionRequest();
    request.questions![0] = {
      ...request.questions![0]!,
      question: longQuestion,
    };
    const html = renderToStaticMarkup(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(Dialog, {
          request,
          onRespond: () => {},
        }),
      ),
    );

    expect(html).toContain(`title="${longQuestion}"`);
    expect(html).toContain(">Plan</span>");
    expect(html).toContain(`>${longQuestion}</span>`);
  });

  it("Provide expand entry for long questions", () => {
    const Dialog = ElicitationDialog as ComponentType<Record<string, unknown>>;
    const longQuestion =
      "Suppose you are designing a next-generation distributed real-time collaboration platform for global users. The platform needs to support millions of concurrent users simultaneously editing documents, whiteboards, spreadsheets, and low-code applications, while allowing offline editing and automatic conflict resolution upon reconnection. Explain your choice at the data synchronization protocol level.";
    const request = createMultiQuestionRequest();
    request.questions![0] = {
      question: longQuestion,
      header: "Data synchronization protocol",
      options: [
        {
          value: "crdt",
          label: "CRDT (Conflict-free Replicated Data Types)",
          description: "Based on Conflict-free Replicated Data Types, inherently supporting decentralized sync and P2P scenarios.",
        },
        {
          value: "ot",
          label: "OT (Operational Transform)",
          description: "Based on Operational Transformation, relying on a central server for operation ordering and transformation.",
        },
        {
          value: "hybrid",
          label: "混合 CRDT + OT",
          description: "客户端处理本地变更和离线缓冲，服务端处理最终排序。",
        },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(Dialog, {
          request,
          onRespond: () => {},
        }),
      ),
    );

    expect(html).toContain('aria-label="展开问题"');
  });

  it("手机端阻塞弹窗提供整卡折叠入口并标记可隐藏内容", () => {
    const Dialog = ElicitationDialog as ComponentType<Record<string, unknown>>;
    const html = renderToStaticMarkup(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(Dialog, {
          request: createMultiQuestionRequest(),
          onRespond: () => {},
        }),
      ),
    );

    expect(html).toContain('aria-label="折叠问题弹窗"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-elicitation-dialog-body="true"');
    expect(html).toContain('data-elicitation-dialog-footer="true"');
  });

  it("选项显示标题与描述", () => {
    const Dialog = ElicitationDialog as ComponentType<Record<string, unknown>>;
    const request = createMultiQuestionRequest();
    request.questions![0]!.options[0] = {
      value: "fast",
      label: "快速",
      description: "先处理核心路径",
    };
    const html = renderToStaticMarkup(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(Dialog, {
          request,
          onRespond: () => {},
        }),
      ),
    );

    expect(html).toContain(">快速</span>");
    expect(html).toContain(">先处理核心路径</span>");
  });

  it("plan approval title follows permission copy and approve option keeps approval copy in both locales", () => {
    const Dialog = ElicitationDialog as ComponentType<Record<string, unknown>>;
    const request = createPlanApprovalRequest();
    const render = (locale: "en-US" | "zh-CN") =>
      renderToStaticMarkup(
        createElement(
          CfIntlProvider,
          { initialLocale: locale },
          createElement(Dialog, {
            request,
            onRespond: () => {},
          }),
        ),
      );

    const enHtml = render("en-US");
    expect(enHtml).toContain("Permission required");
    expect(enHtml).toContain("Implementation plan");
    expect(enHtml).toContain(">Approve</span>");
    expect(enHtml).toContain("Exit plan mode and start implementation.");
    expect(enHtml).toContain(">1.</span>");
    expect(enHtml).toContain(">2.</span>");
    expect(enHtml).not.toContain(">Allow</span>");
    expect(enHtml).not.toContain("Allow only this time");

    const zhHtml = render("zh-CN");
    expect(zhHtml).toContain("需要权限");
    expect(zhHtml).toContain("Implementation Plan");
    expect(zhHtml).toContain(">批准</span>");
    expect(zhHtml).toContain("退出计划模式并开始实施。");
    expect(zhHtml).toContain(">1.</span>");
    expect(zhHtml).toContain(">2.</span>");
    expect(zhHtml).not.toContain(">允许</span>");
    expect(zhHtml).not.toContain(">Approve</span>");
    expect(zhHtml).not.toContain("Exit plan mode and start implementation.");
  });

  it("自定义回答输入框 Enter 遵循当前题目和计划审批语义，并避开输入法组词态", () => {
    expect(
      resolveElicitationCustomInputKeyAction({
        key: "Enter",
        advanceKind: "next",
      }),
    ).toBe("advance");
    expect(
      resolveElicitationCustomInputKeyAction({
        key: "Enter",
        advanceKind: "submit",
      }),
    ).toBe("submit");
    expect(resolveElicitationCustomInputKeyAction({ key: "Enter" })).toBe("advance");
    expect(resolveElicitationCustomInputKeyAction({ key: "Enter", ctrlKey: true })).toBe("submit");
    expect(resolveElicitationCustomInputKeyAction({ key: "Enter", metaKey: true })).toBe("submit");
    expect(
      resolveElicitationCustomInputKeyAction({
        key: "Enter",
        nativeEvent: { isComposing: true },
      }),
    ).toBeNull();
    expect(
      resolveElicitationCustomInputKeyAction({
        key: "Enter",
        compositionActive: true,
      }),
    ).toBeNull();
    expect(resolveElicitationCustomInputKeyAction({ key: "Escape" })).toBe("dismiss");
    expect(
      resolveElicitationCustomInputKeyAction({
        key: "Escape",
        hasPreviousQuestion: true,
      }),
    ).toBe("previous");
  });

  it("ExitPlanMode 自定义反馈输入框裸 Enter 提交", () => {
    expect(
      resolveElicitationCustomInputKeyAction({
        key: "Enter",
        isPlanApproval: true,
      }),
    ).toBe("submit");
    expect(
      resolveElicitationCustomInputKeyAction({
        key: "Escape",
        hasPreviousQuestion: true,
        isPlanApproval: true,
      }),
    ).toBe("dismiss");
  });
});
