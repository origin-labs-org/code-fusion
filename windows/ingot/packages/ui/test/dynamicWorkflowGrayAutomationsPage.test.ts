// @vitest-environment jsdom
//
import { createElement, useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TID_AUTOMATIONS_PAGE_TAB } from "@origin-ai/cf-shared";
import { testId } from "@origin-ai/cf-shared/test-ids";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import {
  AutomationsPageTitle,
  type AutomationsPageTab,
} from "@/settings/saved-workflows/AutomationsPageTitleSwitch.js";

function Title({
  workflowTabEnabled,
  locale = "zh-CN",
}: {
  workflowTabEnabled: boolean;
  locale?: "zh-CN" | "en-US";
}) {
  const [tab, setTab] = useState<AutomationsPageTab>("automation");
  return createElement(
    CfIntlProvider,
    { initialLocale: locale },
    createElement(AutomationsPageTitle, {
      workflowTabEnabled,
      value: tab,
      onValueChange: setTab,
    }),
  );
}

describe("AutomationsPageTitle 灰度门", () => {
  afterEach(() => {
    cleanup();
  });

  it("Rollout off → flat \"Automations\" title, no tablist, and no \"Workflows\" word", () => {
    render(createElement(Title, { workflowTabEnabled: false }));
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByTestId(testId(TID_AUTOMATIONS_PAGE_TAB, "workflow"))).toBeNull();
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("自动化");
  });

  it("灰度关 + en-US → 标题走同一个 i18n key，不是硬编码中文", () => {
    render(createElement(Title, { workflowTabEnabled: false, locale: "en-US" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Automations");
  });

  it("Rollout on → consistent with pre-change: two title terms form a tablist", () => {
    render(createElement(Title, { workflowTabEnabled: true }));
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["自动化", "工作流"]);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});
