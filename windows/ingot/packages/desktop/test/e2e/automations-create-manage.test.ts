import {
  TID_AUTOMATION_ACTION_DELETE,
  TID_AUTOMATION_ACTION_TOGGLE,
  TID_AUTOMATION_CARD,
  TID_AUTOMATION_CARD_MENU,
  TID_AUTOMATION_CREATE_MANUALLY,
  TID_AUTOMATION_FORM_PROMPT,
  TID_AUTOMATION_FORM_SUBMIT,
  TID_AUTOMATION_FORM_TITLE,
  TID_AUTOMATION_FREQUENCY_OPTION,
  TID_AUTOMATION_SCHEDULE_ADD,
  TID_AUTOMATIONS_LIST,
  TID_AUTOMATIONS_OPEN,
  TID_CONFIRM_DIALOG_CONFIRM,
  TID_CHAT_MODEL_SELECT_TRIGGER,
  TID_CHAT_MODEL_SELECT_GROUP,
  TID_CHAT_MODEL_SELECT_ITEM,
  TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER,
  TID_CHAT_THOUGHT_LEVEL_SELECT_ITEM,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  clickTestIdByWebDriver,
  hoverTestIdByWebDriver,
  setInputValueByTestIdDom,
  waitForTestIdByDom,
} from "#e2e/helpers/desktop-app";
import { prepareConversationE2E } from "#e2e/helpers/conversation-session";
import { UPSTREAM_PROVIDER_ID, UPSTREAM_MODEL } from "#e2e/helpers/upstream-provider";

describe("定时任务表单创建与管理 E2E", () => {
  afterEach(async function () {
    if (this.currentTest?.state === "failed") {
      console.info("[SR87 form diagnosis]", await browser.execute(() => document.body.innerText));
    }
  });
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("表单创建后可编辑、暂停、恢复并删除", async function () {
    this.timeout(150000);

    await prepareConversationE2E();

    await clickTestIdByDom(TID_AUTOMATIONS_OPEN, {
      timeoutMsg: "Scheduled task entry did not appear in sidebar",
    });

    await clickTestIdByDom(TID_AUTOMATION_CREATE_MANUALLY, {
      timeoutMsg: "Primary button to create scheduled task did not appear",
    });

    await clickTestIdByWebDriver("automation-project-select", {
      timeoutMsg: "Project selector not found on scheduled task creation page",
    });
    const workspaceMenuItems = await readWorkspaceMenuItems();
    expect(workspaceMenuItems).toEqual(["CfProject"]);
    await selectWorkspaceMenuItem("CfProject");
    await clickTestIdByWebDriver(TID_CHAT_MODEL_SELECT_TRIGGER);
    await clickTestIdByWebDriver(
      testId(TID_CHAT_MODEL_SELECT_GROUP, `registry-provider:${UPSTREAM_PROVIDER_ID}`),
    );
    await clickTestIdByWebDriver(
      testId(TID_CHAT_MODEL_SELECT_ITEM, `custom:${UPSTREAM_PROVIDER_ID}:${UPSTREAM_MODEL}`),
    );
    await clickTestIdByWebDriver(TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER);
    await clickTestIdByWebDriver(testId(TID_CHAT_THOUGHT_LEVEL_SELECT_ITEM, "high"));

    await clickTestIdByWebDriver(TID_AUTOMATION_SCHEDULE_ADD, {
      timeoutMsg: "No entry to add schedule found in new scheduled task",
    });
    await clickTestIdByWebDriver(testId(TID_AUTOMATION_FREQUENCY_OPTION, "daily"), {
      timeoutMsg: "Daily frequency did not appear in add schedule menu",
    });
    const title = `E2E_AUTOMATION_${Date.now()}`;
    const editedTitle = `${title}_EDITED`;
    await setInputValueByTestIdDom(TID_AUTOMATION_FORM_TITLE, title, {
      timeoutMsg: "Scheduled task title input did not appear",
    });
    await setInputValueByTestIdDom(TID_AUTOMATION_FORM_PROMPT, "Summarize today's progress and generate a brief report", {
      timeoutMsg: "Scheduled task prompt input did not appear",
    });
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
      timeoutMsg: "Cannot click new task card to enter editing",
    });
    await setInputValueByTestIdDom(TID_AUTOMATION_FORM_TITLE, editedTitle, {
      timeoutMsg: "Title input did not appear on edit page",
    });
    await setInputValueByTestIdDom(TID_AUTOMATION_FORM_PROMPT, "Summarize today\'s progress, risks, and next steps", {
      timeoutMsg: "Prompt input did not appear on edit page",
    });
    await clickTestIdByDom(TID_AUTOMATION_FORM_SUBMIT, {
      timeoutMsg: "编辑保存按钮不可点击",
    });
    await browser.waitUntil(
      async () => (await automationCardTitles()).some((text) => text.includes(editedTitle)),
      {
        timeout: 15000,
        timeoutMsg: `Edit后list没有回显New title：${editedTitle}`,
      },
    );

    await hoverTestIdByWebDriver(TID_AUTOMATION_CARD, {
      timeoutMsg: "Newly created scheduled task card is not hoverable",
    });
    await clickTestIdByWebDriver(TID_AUTOMATION_CARD_MENU, {
      timeoutMsg: "Card action menu did not appear",
    });
    const toggleLabelBefore = await readTestIdText(TID_AUTOMATION_ACTION_TOGGLE);
    await clickTestIdByDom(TID_AUTOMATION_ACTION_TOGGLE, {
      timeoutMsg: "Card action menu does not have \"Pause/Resume\" option",
    });
    await hoverTestIdByWebDriver(TID_AUTOMATION_CARD, {
      timeoutMsg: "Disabled scheduled task card is not hoverable",
    });
    await clickTestIdByWebDriver(TID_AUTOMATION_CARD_MENU, {
      timeoutMsg: "停用后重新打开卡片菜单失败",
    });
    await browser.waitUntil(
      async () => {
        const now = await readTestIdText(TID_AUTOMATION_ACTION_TOGGLE);
        return now.length > 0 && now !== toggleLabelBefore;
      },
      {
        timeout: 10000,
        timeoutMsg: "After disabling, \"Pause/Resume\" text did not toggle, and enabled state was not switched",
      },
    );

    await clickTestIdByDom(TID_AUTOMATION_ACTION_TOGGLE, {
      timeoutMsg: "停用后菜单没有恢复入口",
    });
    await hoverTestIdByWebDriver(TID_AUTOMATION_CARD, {
      timeoutMsg: "Scheduled task card cannot be hovered after resumption",
    });
    await clickTestIdByWebDriver(TID_AUTOMATION_CARD_MENU, {
      timeoutMsg: "Failed to reopen card menu after resumption",
    });
    await browser.waitUntil(
      async () => (await readTestIdText(TID_AUTOMATION_ACTION_TOGGLE)) === toggleLabelBefore,
      {
        timeout: 10000,
        timeoutMsg: "Pause/Resume text did not revert to initial state after resumption",
      },
    );

    await clickTestIdByDom(TID_AUTOMATION_ACTION_DELETE, {
      timeoutMsg: "Card action menu missing \"Delete\" item",
    });
    await clickTestIdByDom(TID_CONFIRM_DIALOG_CONFIRM, {
      timeoutMsg: "Delete confirmation popup did not appear",
    });
    await browser.waitUntil(
      async () => !(await automationCardTitles()).some((t) => t.includes(editedTitle)),
      {
        timeout: 15000,
        timeoutMsg: `Delete后卡片仍然存在：${editedTitle}`,
      },
    );
  });
});

async function readTestIdText(currentTestId: string): Promise<string> {
  return browser.execute((tid) => {
    const el = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
      (item) => item.dataset.testid === tid,
    );
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

async function readWorkspaceMenuItems(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
      .map((item) => item.innerText.trim())
      .filter(Boolean),
  );
}

async function selectWorkspaceMenuItem(label: string): Promise<void> {
  const selected = await browser.execute((text) => {
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (candidate) => candidate.innerText.trim() === text,
    );
    item?.click();
    return Boolean(item);
  }, label);
  if (!selected) throw new Error(`Project菜单没有Optional择的Current workspace：${label}`);
}
