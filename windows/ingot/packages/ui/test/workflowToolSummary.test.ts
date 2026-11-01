// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import { WorkflowToolSummary } from "@/v4/WorkflowToolSummary.js";

const summary = {
  runId: "run-1",
  toolCallId: "tool-1",
  status: "running" as const,
  nodesTotal: 3,
  nodesSettled: 1,
  agents: 3,
};
afterEach(cleanup);
describe("WorkflowToolSummary", () => {
  it.each(["en-US", "zh-CN"] as const)("Local化Sub-agentCount并Passed普通Summary打开Details：%s", (locale) => {
    const onOpen = vi.fn();
    const view = render(
      createElement(
        CfIntlProvider,
        { initialLocale: locale },
        createElement(WorkflowToolSummary, { toolCallId: "tool-1", summary, onOpen }),
      ),
    );
    expect(view.container.textContent).toContain(locale === "en-US" ? "3 agents" : "3 个Sub-agent");
    expect(view.container.textContent).not.toContain("step");
    const trigger = view.getByRole("button");
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyDown(trigger, { key: " " });
    expect(onOpen).toHaveBeenCalledTimes(3);
    expect(view.container.querySelector("[aria-expanded]")).toBeNull();
    expect(view.queryByTestId("workflow-timeline-station")).toBeNull();
  });
  it.each([
    ["en-US", "Workflow amended"],
    ["zh-CN", "Workflow已调整"],
  ] as const)("修订行的种类词Yes「Workflow已调整」：%s", (locale, word) => {
    const view = render(
      createElement(
        CfIntlProvider,
        { initialLocale: locale },
        createElement(WorkflowToolSummary, { toolCallId: "tool-1", summary, amend: true }),
      ),
    );
    expect(view.container.textContent).toContain(word);
    expect(view.container.textContent).toContain(locale === "en-US" ? "3 agents" : "3 个Sub-agent");
  });
  it("宿主Missing打开Capabilities时只展示TextCharacter", () => {
    const view = render(
      createElement(
        CfIntlProvider,
        { initialLocale: "en-US" },
        createElement(WorkflowToolSummary, { toolCallId: "tool-1", summary }),
      ),
    );
    expect(view.queryByRole("button")).toBeNull();
    expect(view.container.textContent).toContain("3 agents");
  });
  it("Summary没带Sub-agentCount：不写计Count，也不写步Count", () => {
    const { agents: _dropped, ...bare } = summary;
    const view = render(
      createElement(
        CfIntlProvider,
        { initialLocale: "en-US" },
        createElement(WorkflowToolSummary, { toolCallId: "tool-1", summary: bare }),
      ),
    );
    expect(view.getByTestId("workflow-summary-agents").textContent).toBe("");
    expect(view.container.textContent).not.toContain("step");
  });
});
