import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import {
  TID_CONFIRM_DIALOG_CONFIRM,
  TID_OFFPEAK_ACTION_CONTINUE,
  TID_OFFPEAK_ACTION_DELETE,
  TID_OFFPEAK_ACTION_PAUSE,
  TID_OFFPEAK_CARD,
  TID_OFFPEAK_CARD_MENU,
  TID_OFFPEAK_CREATE_BUTTON,
  TID_OFFPEAK_EDIT_SUBMIT,
  TID_OFFPEAK_EDIT_VIEW,
  TID_OFFPEAK_FORM_INSTRUCTIONS,
  TID_OFFPEAK_FORM_TITLE,
  TID_OFFPEAK_TAB,
  TID_AUTOMATIONS_OPEN,
  TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER,
  TID_CHAT_THOUGHT_LEVEL_SELECT_ITEM,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  clickTestIdByDom,
  clickTestIdByWebDriver,
  getE2EAppDataPaths,
  restoreElectronRendererContentSize,
  setInputValueByTestIdDom,
  setCurrentElectronRendererContentSize,
  type ElectronRendererContentSizeSnapshot,
  waitForTestIdByDom,
} from "./helpers/desktop-app.js";
import {
  ensureUpstreamModelForE2E,
  selectUpstreamModelById,
  UPSTREAM_SECONDARY_MODEL,
} from "./helpers/upstream-provider.js";
import { prepareV4ConversationE2E } from "./helpers/v4-conversation.js";
import { openWorkspaceDraftFromSidebar } from "./helpers/workspace-agent-warmup.js";
import {
  restartIntoWorkspace,
  seedBigModelConnectionSelection,
  seedBigModelOAuthCredential,
} from "./helpers/model-provider-restart.js";

let rendererSizeSnapshot: ElectronRendererContentSizeSnapshot | undefined;

describe("Idle-time task form creation and management E2E", () => {
  afterEach(async function () {
    if (this.currentTest?.state === "failed") {
      console.info("[SR87 idle diagnosis]", await browser.execute(() => document.body.innerText));
    }
  });
  after(async () => {
    if (rendererSizeSnapshot) {
      await restoreElectronRendererContentSize(rendererSizeSnapshot);
    }
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Idle-time task created via form appears in list, can be Paused / Continued, and deleted", async function () {
    this.timeout(150000);

    await prepareV4ConversationE2E({ skipProvider: true });
    await seedCurrentAccount();
    rendererSizeSnapshot = await setCurrentElectronRendererContentSize(1440);

    await clickTestIdByDom(TID_AUTOMATIONS_OPEN, {
      timeoutMsg: "侧栏没有出现 Automations 入口",
    });

    if (await browser.$(`[data-testid="${TID_OFFPEAK_TAB}"]`).isExisting())
      await selectIdleTimeTab();
    await clickTestIdByDom(TID_OFFPEAK_CREATE_BUTTON, {
      timeoutMsg: "Idle-time task creation button did not appear (canary rollout missed?)",
    });

    await selectOffPeakReasoning();
    const title = `E2E_OFFPEAK_${Date.now()}`;
    await setInputValueByTestIdDom(TID_OFFPEAK_FORM_TITLE, title, {
      timeoutMsg: "Idle-time task title input did not appear",
    });
    await setInputValueByTestIdDom(
      TID_OFFPEAK_FORM_INSTRUCTIONS,
      "整理今天改动的文件并生成一份摘要",
      { timeoutMsg: "Idle-time task instructions input did not appear" },
    );
    await clickTestIdByDom(TID_OFFPEAK_EDIT_SUBMIT, {
      timeoutMsg: "Idle-time task create submit button is not clickable",
    });

    await selectIdleTimeTab();
    await browser.waitUntil(
      async () => (await offPeakCardTitles()).some((t) => t.includes(title)),
      {
        timeout: 20000,
        timeoutMsg: `闲时Tasklist没有回显New卡片：${title}`,
      },
    );

    await openOffPeakCardMenu({
      timeoutMsg: "Card action menu did not appear",
    });
    await assertMenuHintDoesNotSelectAction(TID_OFFPEAK_ACTION_PAUSE, "right");

    await browser.keys("Escape");
    await setCurrentElectronRendererContentSize(900, 720);
    await openOffPeakCardMenu({
      timeoutMsg: "窄窗口下卡片操作菜单没有出现",
    });
    await assertMenuHintDoesNotSelectAction(TID_OFFPEAK_ACTION_PAUSE, "top");
    await clickTestIdByDom(TID_OFFPEAK_ACTION_PAUSE, {
      timeoutMsg: "Card menu is missing Pause option",
    });
    await setCurrentElectronRendererContentSize(1440);
    await openOffPeakCardMenu({
      timeoutMsg: "Pause 后重新打开卡片菜单失败",
    });
    await waitForTestIdByDom(TID_OFFPEAK_ACTION_CONTINUE, {
      timeoutMsg: "Continue did not appear in menu after Pause, and status did not switch to paused",
    });

    await browser.execute((cardTid) => {
      const card = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
        (item) => item.dataset.testid === cardTid,
      );
      card?.click();
    }, TID_OFFPEAK_CARD);
    await waitForTestIdByDom(TID_OFFPEAK_EDIT_VIEW, {
      timeoutMsg: "Clicking idle-time task card did not open task details",
    });
    const editView = await browser.$(`[data-testid="${TID_OFFPEAK_EDIT_VIEW}"]`);
    const editViewButtons = await editView.$$("button");
    let historyButton: WebdriverIO.Element | undefined;
    for (const button of editViewButtons) {
      if (/History|历史/.test(await button.getText())) {
        historyButton = button;
        break;
      }
    }
    if (!historyButton) {
      throw new Error("Task details is missing History entry");
    }
    await historyButton.click();
    await browser.waitUntil(
      async () =>
        browser.execute(
          (viewTid, submitTid) => {
            const view = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
              (item) => item.dataset.testid === viewTid,
            );
            return !Array.from(view?.querySelectorAll<HTMLElement>("[data-testid]") ?? []).some(
              (item) => item.dataset.testid === submitTid,
            );
          },
          TID_OFFPEAK_EDIT_VIEW,
          TID_OFFPEAK_EDIT_SUBMIT,
        ),
      {
        timeout: 5000,
        timeoutMsg: "Create or Save CTA is still displayed in History detail state",
      },
    );
    await clickAutomationsBreadcrumbBack();
    await browser.waitUntil(
      async () => (await offPeakCardTitles()).some((t) => t.includes(title)),
      {
        timeout: 10000,
        timeoutMsg: "List did not restore after returning from idle-time task details",
      },
    );

    await openOffPeakCardMenu({
      timeoutMsg: "返回列表后重新打开卡片菜单失败",
    });
    await assertMenuHintDoesNotSelectAction(TID_OFFPEAK_ACTION_CONTINUE, "right");
    await clickTestIdByDom(TID_OFFPEAK_ACTION_CONTINUE, {
      timeoutMsg: "Card menu is missing Continue option",
    });
    await openOffPeakCardMenu({
      timeoutMsg: "Continue 后重新打开卡片菜单失败",
    });
    await waitForTestIdByDom(TID_OFFPEAK_ACTION_PAUSE, {
      timeoutMsg: "Menu did not return to Pause after Continue, and status did not revert to queued",
    });

    await clickTestIdByDom(TID_OFFPEAK_ACTION_DELETE, {
      timeoutMsg: "Card menu is missing Delete option",
    });
    await clickTestIdByDom(TID_CONFIRM_DIALOG_CONFIRM, {
      timeoutMsg: "Delete confirmation popup did not appear",
    });
    await browser.waitUntil(
      async () => !(await offPeakCardTitles()).some((t) => t.includes(title)),
      { timeout: 15000, timeoutMsg: `Delete后卡片仍然存在：${title}` },
    );
  });

  it("F-OFFPEAK-004: Switching normal chat plan while waiting to run does not rebind saved idle-time tasks", async function () {
    this.timeout(150000);
    await openWorkspaceDraftFromSidebar(DEFAULT_WORKSPACE);
    await prepareV4ConversationE2E();
    await ensureUpstreamModelForE2E(UPSTREAM_SECONDARY_MODEL);

    await clickTestIdByDom(TID_AUTOMATIONS_OPEN, { timeoutMsg: "Sidebar is missing Automations entry" });
    await clickTestIdByDom(TID_OFFPEAK_CREATE_BUTTON, { timeoutMsg: "Idle-time task creation button did not appear" });
    await selectOffPeakReasoning();
    const title = `E2E_OFFPEAK_SWITCH_${Date.now()}`;
    await setInputValueByTestIdDom(TID_OFFPEAK_FORM_TITLE, title);
    await setInputValueByTestIdDom(
      TID_OFFPEAK_FORM_INSTRUCTIONS,
      "Switching model connection in normal chat while waiting; idle-time task still uses the snapshot from creation.",
    );
    await clickTestIdByDom(TID_OFFPEAK_EDIT_SUBMIT, { timeoutMsg: "Idle-time task submit button is unavailable" });

    const before = await waitForOffPeakModelSelection(title);
    expect(before.providerId).toContain("offpeak");
    await openWorkspaceDraftFromSidebar(DEFAULT_WORKSPACE);
    await selectUpstreamModelById(UPSTREAM_SECONDARY_MODEL);
    const after = await waitForOffPeakModelSelection(title);
    expect(after).toEqual(before);
    expect(await readOffPeakStatus(title)).toBe("queued");
  });
});

async function selectIdleTimeTab(): Promise<void> {
  const tabList = await browser.$(`[data-testid="${TID_OFFPEAK_TAB}"]`);
  const buttons = await tabList.$$("button");
  for (const button of buttons) {
    if (/Idle-time task|闲时Task/u.test(await button.getText())) {
      await button.click();
      return;
    }
  }
  throw new Error("Idle-time task list is missing Idle-time tab");
}

async function seedCurrentAccount(): Promise<void> {
  await restartIntoWorkspace({
    afterElectronProcessExit: async () => {
      await seedBigModelConnectionSelection({ kind: "individual-coding-plan" });
      await seedBigModelOAuthCredential();
    },
  });
}

async function selectOffPeakReasoning(): Promise<void> {
  await clickTestIdByWebDriver(TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER);
  await clickTestIdByWebDriver(testId(TID_CHAT_THOUGHT_LEVEL_SELECT_ITEM, "high"));
}

async function clickAutomationsBreadcrumbBack(): Promise<void> {
  const buttons = await browser.$$("nav[aria-label] button");
  for (const button of buttons) {
    if (/Automations|Automation/u.test(await button.getText())) {
      await button.click();
      return;
    }
  }
  throw new Error("Idle-time task details is missing breadcrumb to return to Automations list");
}

async function offPeakCardTitles(): Promise<string[]> {
  return browser.execute((cardTid) => {
    return Array.from(document.querySelectorAll<HTMLElement>("[data-testid]"))
      .filter((item) => item.dataset.testid === cardTid)
      .map((item) => item.textContent?.trim() ?? "");
  }, TID_OFFPEAK_CARD);
}

async function openOffPeakCardMenu({ timeoutMsg }: { timeoutMsg: string }): Promise<void> {
  const card = await browser.$(`[data-testid="${TID_OFFPEAK_CARD}"]`);
  const menu = await browser.$(`[data-testid="${TID_OFFPEAK_CARD_MENU}"]`);
  await card.scrollIntoView();
  await card.moveTo();
  await browser.waitUntil(
    () =>
      browser
        .execute((menuTestId) => {
          const menu = document.querySelector<HTMLElement>(`[data-testid="${menuTestId}"]`);
          if (!(menu instanceof HTMLButtonElement)) return { present: false };
          const rect = menu.getBoundingClientRect();
          return {
            disabled: menu.disabled,
            opacity: getComputedStyle(menu).opacity,
            present: true,
            visible:
              rect.bottom > 0 &&
              rect.left > 0 &&
              rect.right < window.innerWidth &&
              rect.top < window.innerHeight,
          };
        }, TID_OFFPEAK_CARD_MENU)
        .then(
          (state) => state.present && !state.disabled && state.opacity === "1" && state.visible,
        ),
    { timeout: 5_000, timeoutMsg },
  );
  try {
    await menu.click();
  } catch (error) {
    const opened = await browser.execute((menuTestId) => {
      const trigger = document.querySelector<HTMLElement>(`[data-testid="${menuTestId}"]`);
      return trigger?.getAttribute("aria-expanded") === "true";
    }, TID_OFFPEAK_CARD_MENU);
    if (!opened) throw error;
  }
}

async function assertMenuHintDoesNotSelectAction(
  actionTestId: string,
  expectedSide: "right" | "top",
): Promise<void> {
  const action = await browser.$(`[data-testid="${actionTestId}"]`);
  const hintTrigger = await action.$(":scope > span:last-child");
  await hintTrigger.moveTo();

  await browser.waitUntil(
    async () => {
      const tooltip = await browser.$('[role="tooltip"]');
      return tooltip.isDisplayed();
    },
    {
      timeout: 5000,
      timeoutMsg: `操作Notice没有出现：${actionTestId}`,
    },
  );

  const geometry = await browser.execute(() => {
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    const tooltip = Array.from(document.querySelectorAll<HTMLElement>('[role="tooltip"]')).find(
      (item) => item.dataset.state !== "closed",
    );
    if (!menu || !tooltip) {
      return null;
    }
    const menuRect = menu.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    return {
      menuRight: menuRect.right,
      menuTop: menuRect.top,
      tooltipBottom: tooltipRect.bottom,
      tooltipLeft: tooltipRect.left,
      tooltipWidth: tooltipRect.width,
    };
  });

  expect(geometry).not.toBeNull();
  if (expectedSide === "right") {
    expect(geometry?.tooltipLeft ?? 0).toBeGreaterThanOrEqual(
      geometry?.menuRight ?? Number.POSITIVE_INFINITY,
    );
  } else {
    expect(geometry?.tooltipBottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      geometry?.menuTop ?? 0,
    );
  }
  expect(geometry?.tooltipWidth ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(320);

  await hintTrigger.click();
  await browser.waitUntil(
    async () => {
      const currentAction = await browser.$(`[data-testid="${actionTestId}"]`);
      return currentAction.isDisplayed();
    },
    {
      timeout: 2000,
      timeoutMsg: `点击Letter息图LabelError触发了父级动作：${actionTestId}`,
    },
  );
}

async function waitForOffPeakModelSelection(title: string): Promise<{
  modelId: string;
  providerId: string;
}> {
  let selection: { modelId: string; providerId: string } | null = null;
  await browser.waitUntil(
    async () => {
      selection = readOffPeakModelSelection(title);
      return selection !== null;
    },
    { timeout: 30000, interval: 500, timeoutMsg: `闲时Task没有SaveModel Selection：${title}` },
  );
  if (!selection) throw new Error(`闲时TaskModel Selection为空：${title}`);
  return selection;
}

function readOffPeakModelSelection(title: string): { modelId: string; providerId: string } | null {
  const database = new DatabaseSync(join(getE2EAppDataPaths().appDataDir, "tasks-index.sqlite"), {
    readOnly: true,
  });
  try {
    const row = database
      .prepare("SELECT model_selection FROM off_peak_tasks WHERE title = ?")
      .get(title) as { model_selection: string | null } | undefined;
    if (!row?.model_selection) return null;
    const parsed = JSON.parse(row.model_selection) as { modelId?: string; providerId?: string };
    return parsed.modelId && parsed.providerId
      ? { modelId: parsed.modelId, providerId: parsed.providerId }
      : null;
  } finally {
    database.close();
  }
}

function readOffPeakStatus(title: string): string | null {
  const database = new DatabaseSync(join(getE2EAppDataPaths().appDataDir, "tasks-index.sqlite"), {
    readOnly: true,
  });
  try {
    const row = database.prepare("SELECT status FROM off_peak_tasks WHERE title = ?").get(title) as
      | { status: string }
      | undefined;
    return row?.status ?? null;
  } finally {
    database.close();
  }
}
