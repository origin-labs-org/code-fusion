import {
  TID_AUTOMATION_CARD,
  TID_AUTOMATION_FORM_TITLE,
  TID_AUTOMATION_SCHEDULE_PREVIEW,
  TID_AUTOMATIONS_LIST,
  TID_CONFIRM_DIALOG_CONFIRM,
  TID_CRON_CREATE_CARD,
  TID_CRON_CREATE_OPEN,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  seedSettings,
  waitForTestIdByDom,
} from "../helpers/desktop-app.js";
import { expandAssistantHistoriesWithContent } from "../helpers/conversation-session-tool-diagnostics.js";
import {
  approveV4Permission,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

const MARKER = "E2E_AUTOMATION_CRON_RELATIVE";
const AUTOMATION_TITLE = "E2E_CRON_RELATIVE_ONESHOT";

describe("会话内相对时间一次性定时任务 E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("delayMinutes 创建一次性任务 → 详情与列表显示自定义而非重复频率", async function () {
    this.timeout(150000);

    await seedSettings({ locale: "zh-CN", localePreference: "zh-CN" });
    await prepareV4ConversationE2E({ resetDraftBeforeProvider: true });

    await sendV4Prompt(`${MARKER} remind me to drink water in 5 minutes`);
    await waitForV4TimelineContaining(MARKER);
    await approveV4Permission();
    await waitForV4Pane(
      (snapshot) =>
        snapshot.sessionId !== null &&
        snapshot.sessionId !== "draft" &&
        !snapshot.canStop,
      "会话内相对时间 CronCreate 没有完成",
      90000,
    );

    await expandAssistantHistoriesWithContent();
    await waitForTestIdByDom(TID_CRON_CREATE_CARD, {
      timeout: 15000,
      timeoutMsg: "会话内没有渲染相对时间 CronCreate 定时任务卡片",
    });
    await browser.waitUntil(
      async () =>
        (await readTestIdText(TID_CRON_CREATE_CARD)).includes(AUTOMATION_TITLE),
      {
        timeout: 10000,
        timeoutMsg: `CronCreate 卡片没有ShowScheduled TasksTitle：${AUTOMATION_TITLE}`,
      },
    );

    await clickTestIdByDom(TID_CRON_CREATE_OPEN, {
      timeoutMsg: "CronCreate 卡片没有可点击的「去到定时任务」按钮",
    });
    await browser.waitUntil(
      async () =>
        (await readTestIdValue(TID_AUTOMATION_FORM_TITLE)) === AUTOMATION_TITLE,
      {
        timeout: 15000,
        timeoutMsg: `TaskDetails没有回显Session创建的Title：${AUTOMATION_TITLE}`,
      },
    );
    await waitForTestIdByDom(TID_AUTOMATION_SCHEDULE_PREVIEW, {
      timeout: 10000,
      timeoutMsg: "相对时间任务详情没有显示只读调度摘要",
    });
    expect(await readTestIdText(TID_AUTOMATION_SCHEDULE_PREVIEW)).toBe("自定义");

    await clickAutomationsBreadcrumbBack();
    expect(await hasVisibleTestId(TID_CONFIRM_DIALOG_CONFIRM)).toBe(false);
    await waitForTestIdByDom(TID_AUTOMATIONS_LIST, {
      timeout: 15000,
      timeoutMsg: "无修改返回没有直接回到任务列表（疑似误弹未保存确认框）",
    });

    const badgeText = await readScheduleBadgeText();
    expect(badgeText).toContain("自定义");
    expect(badgeText).toContain("下次运行");
    expect(badgeText).not.toContain("每 ");
    const cardText = await readTestIdText(TID_AUTOMATION_CARD);
    expect(cardText).toContain("已运行 0 次");
    expect(cardText).not.toContain("0/1");
  });
});

async function clickAutomationsBreadcrumbBack(): Promise<void> {
  const buttons = await browser.$$('nav[aria-label] button');
  for (const button of buttons) {
    if (/Automations|Automation/u.test(await button.getText())) {
      await button.click();
      return;
    }
  }
  throw new Error("任务详情没有返回 Automations 列表的 breadcrumb 入口");
}

async function readTestIdText(currentTestId: string): Promise<string> {
  return browser.execute((tid) => {
    const el = Array.from(
      document.querySelectorAll<HTMLElement>("[data-testid]"),
    ).find((item) => item.dataset.testid === tid);
    return el?.textContent?.trim() ?? "";
  }, currentTestId);
}

async function readTestIdValue(currentTestId: string): Promise<string> {
  return browser.execute((tid) => {
    const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `[data-testid="${tid}"]`,
    );
    return element?.value ?? "";
  }, currentTestId);
}

async function hasVisibleTestId(currentTestId: string): Promise<boolean> {
  return browser.execute(
    (tid) => Boolean(document.querySelector(`[data-testid="${tid}"]`)),
    currentTestId,
  );
}

async function readScheduleBadgeText(): Promise<string> {
  return browser.execute(
    () =>
      document
        .querySelector<HTMLElement>('[data-testid="automation-schedule-text"]')
        ?.textContent?.trim() ?? "",
  );
}
