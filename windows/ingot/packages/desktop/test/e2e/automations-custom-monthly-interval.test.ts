import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  testId,
  TID_AUTOMATION_CARD,
  TID_AUTOMATION_CREATE_MANUALLY,
  TID_AUTOMATION_CUSTOM_CONFIRM,
  TID_AUTOMATION_CUSTOM_INTERVAL_DECREMENT,
  TID_AUTOMATION_CUSTOM_INTERVAL_INCREMENT,
  TID_AUTOMATION_CUSTOM_INTERVAL_SELECT,
  TID_AUTOMATION_CUSTOM_REPEAT_EDIT,
  TID_AUTOMATION_CUSTOM_UNIT_OPTION,
  TID_AUTOMATION_CUSTOM_UNIT_SELECT,
  TID_AUTOMATION_FORM_PROMPT,
  TID_AUTOMATION_FORM_SUBMIT,
  TID_AUTOMATION_FORM_TITLE,
  TID_AUTOMATION_FREQUENCY_OPTION,
  TID_AUTOMATION_SCHEDULE_ADD,
  TID_AUTOMATIONS_LIST,
  TID_AUTOMATIONS_OPEN,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  clickTestIdByWebDriver,
  setInputValueByTestIdDom,
  waitForTestIdByDom,
} from "./helpers/desktop-app.js";
import { prepareConversationE2E } from "./helpers/conversation-session.js";

const TARGET_INTERVAL = "29";

describe("定时任务自定义长月度间隔 E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Use valid compatible cron every 29 months, and save and restore by scheduleRule", async function () {
    this.timeout(150000);

    await prepareConversationE2E({ skipProvider: true });
    await clickTestIdByDom(TID_AUTOMATIONS_OPEN, {
      timeoutMsg: "Scheduled task entry did not appear in sidebar",
    });
    await clickTestIdByDom(TID_AUTOMATION_CREATE_MANUALLY, {
      timeoutMsg: "Primary button to create scheduled task did not appear",
    });

    const title = `E2E_AUTOMATION_MONTHLY_${Date.now()}`;
    await setInputValueByTestIdDom(TID_AUTOMATION_FORM_TITLE, title);
    await setInputValueByTestIdDom(TID_AUTOMATION_FORM_PROMPT, "每 29 个月生成一次长期项目复盘");
    await clickTestIdByWebDriver(TID_AUTOMATION_SCHEDULE_ADD, {
      timeoutMsg: "Scheduled task creation page missing add schedule entry",
    });
    await clickTestIdByDom(testId(TID_AUTOMATION_FREQUENCY_OPTION, "custom"), {
      timeoutMsg: "Add schedule menu missing Custom option",
    });

    await setInputValueByTestIdDom(
      TID_AUTOMATION_CUSTOM_INTERVAL_SELECT,
      "199",
      { timeoutMsg: "Custom recurrence popup missing editable frequency input" },
    );
    await clickTestIdByDom(TID_AUTOMATION_CUSTOM_INTERVAL_INCREMENT, {
      timeoutMsg: "Custom recurrence frequency increase button is not clickable",
    });
    await browser.waitUntil(
      async () =>
        (await readInputValueByTestId(TID_AUTOMATION_CUSTOM_INTERVAL_SELECT)) === "200" &&
        (await isTestIdDisabled(TID_AUTOMATION_CUSTOM_INTERVAL_INCREMENT)),
      {
        timeout: 10000,
        timeoutMsg: "频率增加到 200 后没有更新数值或禁用增加按钮",
      },
    );
    await clickTestIdByDom(TID_AUTOMATION_CUSTOM_INTERVAL_DECREMENT, {
      timeoutMsg: "Custom recurrence frequency decrease button is not clickable",
    });
    await browser.waitUntil(
      async () =>
        (await readInputValueByTestId(TID_AUTOMATION_CUSTOM_INTERVAL_SELECT)) === "199",
      {
        timeout: 10000,
        timeoutMsg: "Frequency did not update to 199 after decrease",
      },
    );
    await setInputValueByTestIdDom(TID_AUTOMATION_CUSTOM_INTERVAL_SELECT, "0");
    await browser.waitUntil(
      () => isTestIdDisabled(TID_AUTOMATION_CUSTOM_INTERVAL_DECREMENT),
      {
        timeout: 10000,
        timeoutMsg: "频率为 0 时没有禁用减少按钮",
      },
    );

    await setInputValueByTestIdDom(
      TID_AUTOMATION_CUSTOM_INTERVAL_SELECT,
      TARGET_INTERVAL,
      { timeoutMsg: "Custom recurrence popup missing editable frequency input" },
    );
    await selectRadixOption(
      TID_AUTOMATION_CUSTOM_UNIT_SELECT,
      testId(TID_AUTOMATION_CUSTOM_UNIT_OPTION, "monthly"),
      "Custom recurrence popup missing month unit",
    );
    await clickTestIdByDom(TID_AUTOMATION_CUSTOM_CONFIRM, {
      timeoutMsg: "Custom recurrence popup missing confirm button",
    });
    await clickTestIdByDom(TID_AUTOMATION_FORM_SUBMIT, {
      timeoutMsg: "Scheduled task for every 29 months cannot be submitted",
    });
    await waitForTestIdByDom(TID_AUTOMATIONS_LIST, {
      timeoutMsg: "Did not return to scheduled tasks list after creation",
    });

    const record = await waitForAutomationRecordByTitle(title);
    expect(record.cronExpr).toBe("0 9 1 * *");
    expect(record.scheduleRule).toMatchObject({
      unit: "monthly",
      interval: 29,
      monthDays: [1],
      monthlyMode: "date",
    });

    await clickAutomationCardByTitle(title);
    await clickTestIdByDom(TID_AUTOMATION_CUSTOM_REPEAT_EDIT, {
      timeoutMsg: "No custom recurrence edit entry after re-entering edit mode",
    });
    await waitForTestIdByDom(TID_AUTOMATION_CUSTOM_INTERVAL_SELECT, {
      timeoutMsg: "Custom recurrence control was not restored after re-entering edit mode",
    });
    expect(await readInputValueByTestId(TID_AUTOMATION_CUSTOM_INTERVAL_SELECT)).toBe(TARGET_INTERVAL);
  });
});

async function selectRadixOption(
  triggerTestId: string,
  itemTestId: string,
  timeoutMsg: string,
): Promise<void> {
  const trigger = $(`[data-testid="${triggerTestId}"]`);
  await trigger.waitForClickable({ timeout: 30000 });
  await trigger.click();
  const item = $(`[data-testid="${itemTestId}"]`);
  try {
    await item.waitForClickable({ timeout: 15000 });
  } catch (error) {
    throw new Error(timeoutMsg, { cause: error });
  }
  await browser.execute((currentTestId) => {
    const element = document.querySelector<HTMLElement>(`[data-testid="${currentTestId}"]`);
    if (!element) return;
    element.focus();
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  }, itemTestId);
}

async function clickAutomationCardByTitle(title: string): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (cardTestId, expectedTitle) => {
          const target = Array.from(
            document.querySelectorAll<HTMLElement>(`[data-testid="${cardTestId}"]`),
          ).find((card) => card.innerText.includes(expectedTitle));
          target?.click();
          return Boolean(target);
        },
        TID_AUTOMATION_CARD,
        title,
      ),
    {
      timeout: 15000,
      timeoutMsg: `没有找到刚创建的Scheduled Tasks：${title}`,
    },
  );
}

interface AutomationRecord {
  cronExpr: string;
  scheduleRule: Record<string, unknown>;
}

async function waitForAutomationRecordByTitle(title: string): Promise<AutomationRecord> {
  let record: AutomationRecord | null = null;
  await browser.waitUntil(
    async () => {
      record = readAutomationRecordByTitle(title);
      return record !== null;
    },
    {
      timeout: 10000,
      timeoutMsg: `没有在 automation Data库Medium找到 ${title}`,
    },
  );
  if (!record) throw new Error(`automation Data库记录为空：${title}`);
  return record;
}

function readAutomationRecordByTitle(title: string): AutomationRecord | null {
  const database = new DatabaseSync(join(homedir(), ".cf", "v2", "tasks-index.sqlite"), {
    readOnly: true,
  });
  try {
    const row = database
      .prepare(
        `SELECT cron_expr, schedule_rule
         FROM automations
         WHERE title = ?`,
      )
      .get(title) as { cron_expr: string; schedule_rule: string | null } | undefined;
    if (!row?.schedule_rule) return null;
    return {
      cronExpr: row.cron_expr,
      scheduleRule: JSON.parse(row.schedule_rule) as Record<string, unknown>,
    };
  } finally {
    database.close();
  }
}

async function readInputValueByTestId(currentTestId: string): Promise<string> {
  return browser.execute((testIdValue) => {
    const element = document.querySelector(`[data-testid="${testIdValue}"]`);
    return element instanceof HTMLInputElement ? element.value : "";
  }, currentTestId);
}

async function isTestIdDisabled(currentTestId: string): Promise<boolean> {
  return browser.execute((testIdValue) => {
    const element = document.querySelector(`[data-testid="${testIdValue}"]`);
    return element instanceof HTMLButtonElement && element.disabled;
  }, currentTestId);
}
