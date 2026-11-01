import {
  TID_AUTOMATIONS_PAGE_TAB,
  TID_SETTINGS_DYNAMIC_WORKFLOW_MODE_ITEM,
  TID_SETTINGS_DYNAMIC_WORKFLOW_MODE_TRIGGER,
  type DynamicWorkflowMode,
} from "@origin-ai/cf-shared";
import {
  TID_AUTOMATIONS_OPEN,
  TID_CHAT_ATTACHMENT_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  TID_V4_COMPOSER_INPUT,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  clickTestIdByDom,
  clickTestIdByWebDriver,
  setInputValueByTestIdDom,
} from "./desktop-app.js";
import { sel } from "./selectors.js";
import { getV4SlashOptionIds, hasV4SlashPanel } from "./v4-conversation.js";
import {
  DYNAMIC_WORKFLOW_CONFIG_MOCK_STATUS_PATH,
  type DynamicWorkflowConfigMockStatus,
} from "./dynamic-workflow-config-mock-server.js";

export const PLUS_MENU_PANEL_SELECTOR = '[data-trigger="+"]';

export const SLASH_GOAL_OPTION_ID = "slash:goal";

export const SLASH_WORKFLOW_OPTION_ID = "slash:workflow";

export const PLUS_GOAL_OPTION_ID = "add-goal";
export const PLUS_WORKFLOW_OPTION_ID = "add-workflow";

export const AUTOMATIONS_CONTENT_SELECTOR = "[data-automations-content]";

export function automationsPageTabTestId(tab: "automation" | "workflow"): string {
  return testId(TID_AUTOMATIONS_PAGE_TAB, tab);
}

export async function readDynamicWorkflowGrayMockStatus(): Promise<DynamicWorkflowConfigMockStatus> {
  const origin = process.env.CF_TEST_BASE_URL;
  if (!origin) throw new Error("缺少动态工作流灰度的 case-local 配置网关");
  const response = await fetch(new URL(DYNAMIC_WORKFLOW_CONFIG_MOCK_STATUS_PATH, origin));
  return (await response.json()) as DynamicWorkflowConfigMockStatus;
}

export async function setComposerDraft(text: string): Promise<void> {
  await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, text, {
    stabilizeLexicalCaretAtEnd: true,
  });
}

export async function openSlashPanelWithCatalogReady(timeout = 30000): Promise<string[]> {
  await setComposerDraft("/");
  await browser.waitUntil(
    async () =>
      (await hasV4SlashPanel()) && (await getV4SlashOptionIds()).includes(SLASH_GOAL_OPTION_ID),
    {
      timeout,
      timeoutMsg: `slash 面板没有出现 catalog 屏障候选项: ${SLASH_GOAL_OPTION_ID}`,
    },
  );
  return await getV4SlashOptionIds();
}

export async function closeSlashPanel(): Promise<void> {
  await browser.keys("Escape");
  await setComposerDraft("");
}

export async function openPlusMenu(): Promise<void> {
  await clickTestIdByDom(TID_CHAT_ATTACHMENT_BUTTON, {
    timeoutMsg: "输入框没有出现 + 入口",
  });
  await $(PLUS_MENU_PANEL_SELECTOR).waitForDisplayed();
}

export async function closePlusMenu(): Promise<void> {
  await browser.keys("Escape");
  await $(PLUS_MENU_PANEL_SELECTOR).waitForDisplayed({ reverse: true });
}

export async function readPlusMenuAddOptionIds(): Promise<string[]> {
  return await browser.execute(
    (selector) =>
      Array.from(document.querySelectorAll(`${selector} [data-option-id^="add-"]`)).map(
        (element) => element.getAttribute("data-option-id") ?? "",
      ),
    PLUS_MENU_PANEL_SELECTOR,
  );
}

export async function openAutomationsPage(): Promise<void> {
  await clickTestIdByDom(TID_AUTOMATIONS_OPEN, {
    timeoutMsg: "Sidebar missing Automation entry",
  });
  await $(AUTOMATIONS_CONTENT_SELECTOR).waitForDisplayed({
    timeout: 30000,
    timeoutMsg: "自动化页内容没有渲染",
  });
}

export function hasTestIdInDom(target: string): Promise<boolean> {
  return browser.execute(
    (current) =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).some(
        (element) => element.dataset.testid === current,
      ),
    target,
  );
}

export async function expectTestIdAbsentThroughout(
  target: string,
  { windowMs = 3000, intervalMs = 200 }: { windowMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    if (await hasTestIdInDom(target)) {
      throw new Error(`灰度Close时不应出现的 test id 迟到出现: ${target}`);
    }
    await browser.pause(intervalMs);
  }
}

export async function openGeneralSettings(): Promise<void> {
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
    timeout: 15000,
    timeoutMsg: "Could not find settings entry button",
  });
  await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout: 15000 });
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "general"), {
    timeout: 15000,
    timeoutMsg: "设置页没有出现常规分区入口",
  });
}

export async function openDynamicWorkflowModeSelect(): Promise<void> {
  await clickTestIdByWebDriver(TID_SETTINGS_DYNAMIC_WORKFLOW_MODE_TRIGGER, {
    timeout: 15000,
    timeoutMsg: "动态工作流模式下拉触发器没有出现",
  });
  await $(sel(testId(TID_SETTINGS_DYNAMIC_WORKFLOW_MODE_ITEM, "alwaysOn"))).waitForDisplayed({
    timeout: 15000,
    timeoutMsg: "动态工作流模式下拉没有展开",
  });
}

export async function selectDynamicWorkflowMode(mode: DynamicWorkflowMode): Promise<void> {
  await openDynamicWorkflowModeSelect();
  await clickTestIdByDom(testId(TID_SETTINGS_DYNAMIC_WORKFLOW_MODE_ITEM, mode), {
    timeout: 15000,
    timeoutMsg: `动态WorkflowMode选项没有出现: ${mode}`,
  });
}

export function readDynamicWorkflowModeTriggerText(): Promise<string> {
  return $(sel(TID_SETTINGS_DYNAMIC_WORKFLOW_MODE_TRIGGER)).getText();
}
