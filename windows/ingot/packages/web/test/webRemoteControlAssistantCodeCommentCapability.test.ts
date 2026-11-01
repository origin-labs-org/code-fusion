// @vitest-environment jsdom
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssistantCodeCommentCards } from "@/AssistantCodeCommentCards.js";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import {
  buildAssistantCodeCommentCards,
  projectAssistantCodeComments,
} from "@/lib/assistantCodeComment.js";

describe("web remote control Assistant code-comment capability", () => {
  it("Final state replay row PassedShared投影Hide directive，并Retain remote review scope", () => {
    const assistantText =
      'CompletedReview。\n::code-comment{title="[P1] Check入口" body="请CheckStart路径" file="src/main.ts" start=12 end=14 priority=1}';
    const workspacePath = "/remote/workspace";
    const workspaceIdentity = "remote:ssh:demo:/remote/workspace";
    const workspaceRemoteSessionId = "remote-session-1";
    const projection = projectAssistantCodeComments(assistantText, { streaming: false });
    const cards = buildAssistantCodeCommentCards(assistantText, workspacePath);
    const onOpenCodeViewer = vi.fn();

    expect(projection.visibleText).toBe("CompletedReview。\n");
    expect(cards).toHaveLength(1);

    render(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(AssistantCodeCommentCards, {
          cards,
          workspacePath,
          workspaceIdentity,
          workspaceRemoteSessionId,
          onOpenCodeViewer,
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /展开 1 条评论/ }));
    fireEvent.click(screen.getByRole("button", { name: /Check入口/ }));

    expect(onOpenCodeViewer).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "code-review",
        path: "/remote/workspace/src/main.ts",
        workspacePath,
        workspaceIdentity,
        workspaceRemoteSessionId,
        review: expect.objectContaining({
          title: "Check入口",
          body: "请CheckStart路径",
          startLine: 12,
          endLine: 14,
        }),
      }),
    );
  });
});
