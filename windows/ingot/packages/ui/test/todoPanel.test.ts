import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { TodoPanel } from "../src/TodoPanel.js";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }) => id,
    },
  }),
}));

function renderWithTooltipProvider(element: ReactElement) {
  return renderToStaticMarkup(createElement(TooltipProvider, null, element));
}

describe("TodoPanel", () => {
  it("hides the todo panel after every step is completed", () => {
    const html = renderWithTooltipProvider(
      createElement(TodoPanel, {
        isStreaming: true,
        plan: [
          { id: "step-1", status: "completed", title: "AnalyticsIssue" },
          { id: "step-2", status: "completed", title: "修复Issue" },
        ],
      }),
    );

    expect(html).toBe("");
  });

  it("does not render completed items in the expanded todo list", () => {
    const html = renderWithTooltipProvider(
      createElement(TodoPanel, {
        isStreaming: false,
        plan: [
          { id: "step-1", status: "completed", title: "Completed的事项" },
          { id: "step-2", status: "pending", title: "还要Processing的事项" },
        ],
      }),
    );

    expect(html).not.toContain("Completed的事项");
    expect(html).toContain("还要Processing的事项");
  });

  it("uses a collapsed content button without making the plan header a button", () => {
    const html = renderWithTooltipProvider(
      createElement(TodoPanel, {
        isStreaming: true,
        plan: [
          {
            id: "step-1",
            status: "in_progress",
            title:
              "This isOne个很Long的待办Title，用来模拟手机Remote控制窄屏里Current taskTitle把Right侧按钮挤出容器的Issue",
          },
          {
            id: "step-2",
            status: "pending",
            title: "下一步",
          },
        ],
      }),
    );

    expect(html).toMatch(/<button[^>]*aria-expanded="false"/);
    expect(html).not.toContain('data-slot="plan-header" role="button"');
  });
});
