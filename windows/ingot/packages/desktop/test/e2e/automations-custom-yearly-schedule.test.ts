import {
  TID_AUTOMATION_CARD,
  TID_AUTOMATION_CREATE_MANUALLY,
  TID_AUTOMATION_CUSTOM_CONFIRM,
  TID_AUTOMATION_CUSTOM_UNIT_OPTION,
  TID_AUTOMATION_CUSTOM_UNIT_SELECT,
  TID_AUTOMATION_FORM_PROMPT,
  TID_AUTOMATION_FORM_SUBMIT,
  TID_AUTOMATION_FORM_TITLE,
  TID_AUTOMATION_FREQUENCY_OPTION,
  TID_AUTOMATION_SCHEDULE_ADD,
  TID_AUTOMATION_SCHEDULE_PREVIEW,
  TID_AUTOMATION_YEAR_DAY_OPTION,
  TID_AUTOMATION_YEAR_MONTH_OPTION,
  TID_AUTOMATION_YEAR_MONTHDAY,
  TID_AUTOMATIONS_LIST,
  TID_AUTOMATIONS_OPEN,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  clickTestIdByWebDriver,
  setInputValueByTestIdDom,
  waitForTestIdByDom,
} from "./helpers/desktop-app.js";
import { prepareConversationE2E } from "./helpers/conversation-session.js";
import { sel } from "./helpers/selectors.js";

describe("定时任务自定义年度月/日选择器 E2E", () => {
  const TARGET_MONTH = "3";
  const TARGET_DAY = "20";

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Custom + Yearly shows month/day picker; changing values updates summary and can be saved/restored", async function () {
    this.timeout(150000);

    await prepareConversationE2E({ skipProvider: true });

    await clickTestIdByDom(TID_AUTOMATIONS_OPEN, {
      timeoutMsg: "Scheduled task entry did not appear in sidebar",
    });
    await clickTestIdByDom(TID_AUTOMATION_CREATE_MANUALLY, {
      timeoutMsg: "Primary button to create scheduled task did not appear",
    });

    const title = `E2E_AUTOMATION_YEARLY_${Date.now()}`;
    await setInputValueByTestIdDom(TID_AUTOMATION_FORM_TITLE, title, {
      timeoutMsg: "Scheduled task title input did not appear",
    });
    await setInputValueByTestIdDom(
      TID_AUTOMATION_FORM_PROMPT,
      "Generate an annual summary once a year",
      { timeoutMsg: "Scheduled task prompt input did not appear" },
    );

    await clickTestIdByWebDriver(TID_AUTOMATION_SCHEDULE_ADD, {
      timeoutMsg: "No entry to add schedule found in new scheduled task",
    });
    await clickTestIdByWebDriver(testId(TID_AUTOMATION_FREQUENCY_OPTION, "custom"), {
      timeoutMsg: "Add schedule menu missing Custom option",
    });

    await selectRadixOption(
      TID_AUTOMATION_CUSTOM_UNIT_SELECT,
      testId(TID_AUTOMATION_CUSTOM_UNIT_OPTION, "yearly"),
      "Custom recurrence popup missing \"Year\" unit option",
    );
    await clickTestIdByDom(TID_AUTOMATION_CUSTOM_CONFIRM, {
      timeoutMsg: "Custom recurrence popup missing confirm button",
    });

    await waitForTestIdByDom(TID_AUTOMATION_YEAR_MONTHDAY, {
      timeoutMsg: "Custom + Yearly missing month/day picker",
    });

    await clickTestIdByDom(TID_AUTOMATION_YEAR_MONTHDAY, {
      timeoutMsg: "Month/day picker cannot be opened",
    });
    await clickTestIdByDom(testId(TID_AUTOMATION_YEAR_MONTH_OPTION, TARGET_MONTH), {
      timeoutMsg: "Target month not found in month column",
    });
    await clickTestIdByDom(testId(TID_AUTOMATION_YEAR_DAY_OPTION, TARGET_DAY), {
      timeoutMsg: "Target date not found in date column",
    });

    await browser.waitUntil(
      async () => {
        const preview = await readTestIdText(TID_AUTOMATION_SCHEDULE_PREVIEW);
        return preview.includes(TARGET_DAY) && preview.includes(TARGET_MONTH);
      },
      {
        timeout: 10000,
        timeoutMsg: "Schedule summary did not reflect selected March 20 after changing month/day",
      },
    );
    const pillText = await readTestIdText(TID_AUTOMATION_YEAR_MONTHDAY);
    expect(pillText).toContain(TARGET_DAY);
    expect(pillText).toContain(TARGET_MONTH);

    await clickTestIdByDom(TID_AUTOMATION_FORM_SUBMIT, {
      timeoutMsg: "定时任务提交按钮不可点击",
    });
    await waitForTestIdByDom(TID_AUTOMATIONS_LIST, {
      timeoutMsg: "Did not return to scheduled tasks list after creation",
    });
    await browser.waitUntil(
      async () => (await automationCardTitles()).some((t) => t.includes(title)),
      {
        timeout: 15000,
        timeoutMsg: `Scheduled Taskslist没有回显New卡片：${title}`,
      },
    );

    await clickTestIdByDom(TID_AUTOMATION_CARD, {
      timeoutMsg: "Cannot click card to re-enter edit mode",
    });
    await waitForTestIdByDom(TID_AUTOMATION_YEAR_MONTHDAY, {
      timeoutMsg: "Yearly month/day picker was not restored after re-entering edit mode",
    });
    const restoredPill = await readTestIdText(TID_AUTOMATION_YEAR_MONTHDAY);
    expect(restoredPill).toContain(TARGET_DAY);
    expect(restoredPill).toContain(TARGET_MONTH);
  });
});

async function selectRadixOption(
  triggerTestId: string,
  itemTestId: string,
  timeoutMsg: string,
): Promise<void> {
  const trigger = $(sel(triggerTestId));
  await trigger.scrollIntoView();
  await trigger.waitForClickable({ timeout: 30000 });
  await trigger.click();
  const item = $(sel(itemTestId));
  try {
    await item.scrollIntoView();
    await item.waitForClickable({ timeout: 15000 });
  } catch (error) {
    throw new Error(timeoutMsg, { cause: error });
  }
  await item.click();
}

async function readTestIdText(currentTestId: string): Promise<string> {
  return browser.execute((tid) => {
    const el = Array.from(
      document.querySelectorAll<HTMLElement>("[data-testid]"),
    ).find((item) => item.dataset.testid === tid);
    return el?.textContent?.trim() ?? "";
  }, currentTestId);
}

async function automationCardTitles(): Promise<string[]> {
  return browser.execute((cardTid) => {
    return Array.from(document.querySelectorAll<HTMLElement>("[data-testid]"))
      .filter((item) => item.dataset.testid === cardTid)
      .map((item) => item.textContent?.trim() ?? "");
  }, TID_AUTOMATION_CARD);
}
