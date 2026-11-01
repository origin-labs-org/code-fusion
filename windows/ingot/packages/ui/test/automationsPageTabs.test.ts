// @vitest-environment jsdom
import { createElement, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TID_AUTOMATIONS_PAGE_TAB } from "@origin-ai/cf-shared";
import { testId } from "@origin-ai/cf-shared/test-ids";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import {
  AutomationsPageTitleSwitch,
  type AutomationsPageTab,
} from "@/settings/saved-workflows/AutomationsPageTitleSwitch.js";
import {
  readAutomationsPageTab,
  writeAutomationsPageTab,
} from "@/settings/saved-workflows/automationsPageTabMemory.js";

function Harness({ initial = "automation" }: { initial?: AutomationsPageTab }) {
  const [tab, setTab] = useState<AutomationsPageTab>(initial);
  return createElement(
    CfIntlProvider,
    { initialLocale: "zh-CN" },
    createElement(AutomationsPageTitleSwitch, { value: tab, onValueChange: setTab }),
  );
}

describe("AutomationsPageTitleSwitch", () => {
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it("Both title words are tabs in the tablist; selected state follows value", () => {
    render(createElement(Harness));
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["自动化", "工作流"]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("false");
    expect(tabs[0]?.getAttribute("tabindex")).toBe("0");
    expect(tabs[1]?.getAttribute("tabindex")).toBe("-1");
    fireEvent.click(screen.getByTestId(testId(TID_AUTOMATIONS_PAGE_TAB, "workflow")));
    expect(
      screen
        .getByTestId(testId(TID_AUTOMATIONS_PAGE_TAB, "workflow"))
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("方向键在两个标签间循环切换", () => {
    render(createElement(Harness));
    const tablist = screen.getByRole("tablist");
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(
      screen
        .getByTestId(testId(TID_AUTOMATIONS_PAGE_TAB, "workflow"))
        .getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(
      screen
        .getByTestId(testId(TID_AUTOMATIONS_PAGE_TAB, "automation"))
        .getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(
      screen
        .getByTestId(testId(TID_AUTOMATIONS_PAGE_TAB, "workflow"))
        .getAttribute("aria-selected"),
    ).toBe("true");
  });
});

describe("automationsPageTabMemory", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it("Store app-level single key in sessionStorage without per-project bucketing; fall back to default for unknown values", () => {
    expect(readAutomationsPageTab()).toBe("automation");
    writeAutomationsPageTab("workflow");
    expect(readAutomationsPageTab()).toBe("workflow");
    expect(sessionStorage.length).toBe(1);
    expect(sessionStorage.getItem("cf-automations-page-tab")).toBe("workflow");
    sessionStorage.setItem("cf-automations-page-tab", "bogus");
    expect(readAutomationsPageTab()).toBe("automation");
    writeAutomationsPageTab("automation");
    expect(readAutomationsPageTab()).toBe("automation");
    expect(sessionStorage.length).toBe(1);
  });
});
