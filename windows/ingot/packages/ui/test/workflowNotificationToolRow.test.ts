//
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";

vi.mock("@/components/ai-elements/code-block.js", () => ({
  CodeBlockHeader: () => null,
  CodeBlock: ({ code, language }: { code: string; language?: string; children?: ReactNode }) =>
    createElement("pre", { "data-testid": "code-block", "data-language": language }, code),
}));

import {
  WorkflowNotificationToolRow,
  type WorkflowNotificationToolRowProps,
} from "@/v4/WorkflowNotificationToolRow.js";

function render(
  props: Partial<WorkflowNotificationToolRowProps> &
    Pick<WorkflowNotificationToolRowProps, "notification">,
  locale: "en-US" | "zh-CN" = "en-US",
): string {
  return renderToStaticMarkup(
    createElement(
      CfIntlProvider,
      { initialLocale: locale },
      createElement(WorkflowNotificationToolRow, {
        runName: "flaky-test-triage",
        testIdKey: "turn-1:1",
        theme: "system",
        ...props,
      } as WorkflowNotificationToolRowProps),
    ),
  );
}

const EXPAND_TOGGLE_LABEL = "Expand tool details";
const OPEN_RUN_LABEL = "Open run details";

describe("WorkflowNotificationToolRow — terminal", () => {
  it("kindLabel 承载Three个Final state（Tools卡语法，无Failed装置）", () => {
    expect(
      render({ notification: { kind: "terminal", status: "completed", summary: "s" } }),
    ).toContain("Workflow completed");
    expect(
      render({
        notification: { kind: "terminal", status: "errored", summary: "s", error: "boom" },
      }),
    ).toContain("Workflow errored");
    expect(
      render({ notification: { kind: "terminal", status: "stopped", summary: "s" } }),
    ).toContain("Workflow stopped");
  });

  it("stopped 带原因词：kindLabel 后跟 `· <reason>`（决策 15）", () => {
    const html = render({
      notification: { kind: "terminal", status: "stopped", stopReason: "provider", summary: "s" },
    });
    expect(html).toContain("Workflow stopped · model error");
    expect(
      render({
        notification: { kind: "terminal", status: "stopped", stopReason: "user", summary: "s" },
      }),
    ).toContain("Workflow stopped · by you");
  });

  it("stopped 而带 error（provider / interrupted）→ 可展开，error 走Error面板", () => {
    const html = render({
      notification: {
        kind: "terminal",
        status: "stopped",
        stopReason: "provider",
        summary: "s",
        error: "Sign-in to BigModel expired.",
      },
      forceOpen: true,
    });
    expect(html).toContain("Sign-in to BigModel expired.");
    expect(html).toContain("border-destructive/40");
  });

  it("stall 通知：kindLabel「WaitingModel」+ 沙漏图Label，展开体ToWaitingDuration / 原因 / ConcurrencyCount", () => {
    const html = render({
      notification: { kind: "stall", sinceMs: 20 * 60_000, reason: "rate_limited", cap: 2 },
      forceOpen: true,
    });
    expect(html).toContain("Workflow waiting on the model");
    expect(html).toContain("No model request in this run has succeeded for 20 min.");
    expect(html).toContain("rate_limited");
    expect(html).toContain("Max concurrency");
    expect(html).toContain("workflow-notification-stall");
  });

  it("blocked 提醒：kindLabel「Waiting主代理」+ run 名，展开体One行计Count与WaitingDuration，再加 run 链接", () => {
    const html = render({
      notification: { kind: "blocked", questions: 2, holes: 1, sinceMs: 17 * 60_000 },
      forceOpen: true,
      onOpenRun: () => {},
    });
    expect(html).toContain("Workflow waiting on the agent");
    expect(html).toContain("flaky-test-triage");
    expect(html).toContain("workflow-notification-blocked");
    expect(html).toContain("2 questions · 1 hole · open for 17 min");
    expect(html).toContain(OPEN_RUN_LABEL);
    expect(html).not.toContain("border-destructive");
  });

  it("blocked 提醒：零的那One种不出现；不足One分钟按 1 分钟；Chinese走同One组词", () => {
    const onlyHoles = render({
      notification: { kind: "blocked", questions: 0, holes: 2, sinceMs: 20_000 },
      forceOpen: true,
    });
    expect(onlyHoles).toContain("2 holes · open for 1 min");
    expect(onlyHoles).not.toContain("question");

    const zh = render(
      {
        notification: { kind: "blocked", questions: 1, holes: 0, sinceMs: 45 * 60_000 },
        forceOpen: true,
      },
      "zh-CN",
    );
    expect(zh).toContain("WorkflowWaiting主代理");
    expect(zh).toContain("1 个待AnswerIssue · 已Waiting 45 分钟");
    expect(zh).not.toContain("留白");
  });

  it("blocked 提醒折叠时只有头部：计Count在展开体里", () => {
    const html = render({
      notification: { kind: "blocked", questions: 2, holes: 1, sinceMs: 17 * 60_000 },
    });
    expect(html).toContain("Workflow waiting on the agent");
    expect(html).toContain(EXPAND_TOGGLE_LABEL);
    expect(html).not.toContain("open for 17 min");
  });

  it("primaryText = 分隔符与普通Font run 名", () => {
    const html = render({
      notification: { kind: "terminal", status: "completed", summary: "s", result: "r" },
    });
    expect(html).toContain("flaky-test-triage");
    expect(html).not.toContain("font-mono");
    expect(html).toContain('data-testid="chat-workflow-notification-row-turn-1:1"');
  });

  it("展开体：completed 的 prose result 走 <p>（不进 code-block）", () => {
    const html = render({
      notification: {
        kind: "terminal",
        status: "completed",
        summary: "s",
        result: "Confirmed 3 flaky tests; harness race shared by two of them.",
        resultForm: "prose",
      },
      forceOpen: true,
    });
    expect(html).toContain("Confirmed 3 flaky tests; harness race shared by two of them.");
    expect(html).not.toContain('data-testid="code-block"');
    expect(html).toContain("max-h-80");
    expect(html).not.toContain("border-border bg-panel");
  });

  it("展开体：json result 进 CodeBlock 桩（language=json）", () => {
    const html = render({
      notification: {
        kind: "terminal",
        status: "completed",
        summary: "s",
        result: '{ "confirmed": 3 }',
        resultForm: "json",
      },
      forceOpen: true,
    });
    expect(html).toContain('data-testid="code-block"');
    expect(html).toContain('data-language="json"');
    expect(html).toContain("&quot;confirmed&quot;");
  });

  it("展开体：errored 的 error 走 border-destructive/40 面板（非行级Failed装置）", () => {
    const html = render({
      notification: {
        kind: "terminal",
        status: "errored",
        summary: "s",
        error: "NODE_LIMIT exceeded: run spawned 100 nodes (budget 100).",
      },
      forceOpen: true,
    });
    expect(html).toContain("NODE_LIMIT exceeded: run spawned 100 nodes (budget 100).");
    expect(html).toContain("border-destructive/40");
  });

  it("result 与 error 双缺 → 行不可展开（无 chevron）", () => {
    const html = render({ notification: { kind: "terminal", status: "completed", summary: "s" } });
    expect(html).toContain("Workflow completed");
    expect(html).not.toContain(EXPAND_TOGGLE_LABEL);
  });

  it("errored 但 error 缺席 → 无 chevron", () => {
    const html = render({ notification: { kind: "terminal", status: "errored", summary: "s" } });
    expect(html).toContain("Workflow errored");
    expect(html).not.toContain(EXPAND_TOGGLE_LABEL);
  });

  it("打开RunDetails链接：onOpenRun 在场时渲染，缺席时不渲染", () => {
    const withCb = render({
      notification: { kind: "terminal", status: "completed", summary: "s", result: "r" },
      onOpenRun: () => {},
      forceOpen: true,
    });
    expect(withCb).toContain(OPEN_RUN_LABEL);

    const without = render({
      notification: { kind: "terminal", status: "completed", summary: "s", result: "r" },
      forceOpen: true,
    });
    expect(without).not.toContain(OPEN_RUN_LABEL);
  });
});

const ESCALATION = {
  kind: "escalation",
  qid: "q_7f2c",
  actor: "planner #3",
  question:
    "Fix the harness once (larger blast radius) or patch each test individually (safe but leaves the race)?",
  context: "Harness fix = ~40 lines in test/fixtures/harness.ts.",
  askedAt: Date.now() - 5 * 60_000,
} as const;

describe("WorkflowNotificationToolRow — escalation", () => {
  it("kindLabel Three态由 pendingQids 活翻转", () => {
    expect(render({ notification: ESCALATION, pendingQids: new Set(["q_7f2c"]) })).toContain(
      "Subagent is waiting for an answer",
    );
    expect(render({ notification: ESCALATION, pendingQids: new Set<string>() })).toContain(
      "Subagent question answered",
    );
    expect(render({ notification: ESCALATION })).toContain("Subagent asked a question");
  });

  it("primaryText = Issue单行概要（折叠态可见，全Text不挂载）", () => {
    const html = render({ notification: ESCALATION, pendingQids: new Set(["q_7f2c"]) });
    expect(html).toContain("Fix the harness once (larger blast radius)");
    expect(html).not.toContain("Harness fix = ~40 lines in test/fixtures/harness.ts.");
  });

  it("展开体：Issue全Text + context；不引用AnswerOriginal text", () => {
    const html = render({
      notification: ESCALATION,
      pendingQids: new Set(["q_7f2c"]),
      forceOpen: true,
    });
    expect(html).toContain(
      "Fix the harness once (larger blast radius) or patch each test individually (safe but leaves the race)?",
    );
    expect(html).toContain("Harness fix = ~40 lines in test/fixtures/harness.ts.");
  });

  it("WaitingDuration只在 waiting 态出现", () => {
    const waiting = render({
      notification: ESCALATION,
      pendingQids: new Set(["q_7f2c"]),
      forceOpen: true,
    });
    expect(waiting).toContain("5m ago");

    const answered = render({
      notification: ESCALATION,
      pendingQids: new Set<string>(),
      forceOpen: true,
    });
    expect(answered).not.toContain("5m ago");
  });
});
