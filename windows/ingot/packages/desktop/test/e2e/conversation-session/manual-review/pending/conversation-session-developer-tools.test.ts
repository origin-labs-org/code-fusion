import { TID_SIDE_PANE_TOGGLE, TID_V4_COMPOSER_INPUT } from "@origin-ai/cf-shared/test-ids";
import { clearAppData, switchToNewestWindow } from "../../../helpers/desktop-app.js";
import {
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
} from "../../../helpers/v4-conversation.js";

describe("DBG01 开发者工具请求诊断", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });
  it("Open panel after completing request, restoring tokens, network, and post-first-token TPS", async function () {
    this.timeout(120_000);
    await browser.waitUntil(
      async () => {
        await switchToNewestWindow();
        return (
          (await $('[data-testid="onboarding-page"]').isDisplayed()) ||
          (await $(`[data-testid="${TID_V4_COMPOSER_INPUT}"]`).isDisplayed())
        );
      },
      { timeout: 30_000, timeoutMsg: "Initial onboarding or Composer did not appear" },
    );
    if (await $('[data-testid="onboarding-page"]').isDisplayed()) await browser.keys("Escape");
    await prepareV4ConversationE2E();
    await sendV4Prompt("E2E_DEVELOPER_TOOLS: Reply with exactly upstream-e2e-ok.");
    await waitForV4AssistantMessageContaining("upstream-e2e-ok");
    await waitForV4ConversationState((state) => state.state === "idle", "Main request has not finished");
    await browser.execute(() => {
      localStorage.setItem("cf:developer-tools:enabled", "1");
      window.dispatchEvent(new Event("focus"));
    });
    const launcher = await $('[data-side-pane-open-tab-item="developer-tools"]');
    const add = await $("[data-side-pane-add-tab-trigger]");
    if (!(await launcher.isDisplayed()) && !(await add.isDisplayed())) {
      await $(`[data-testid="${TID_SIDE_PANE_TOGGLE}"]`).click();
    }
    await browser.waitUntil(
      async () => (await launcher.isDisplayed()) || (await add.isDisplayed()),
      { timeout: 15_000, timeoutMsg: "右侧面板入口未出现" },
    );
    if (await launcher.isDisplayed()) {
      await launcher.click();
    } else {
      await add.waitForClickable({ timeout: 15_000 });
      await add.click();
      const item = await $(
        '[data-state="active"] [data-side-pane-open-tab-item="developer-tools"]',
      );
      await item.waitForClickable({ timeout: 10_000 });
      await item.click();
    }
    await browser.waitUntil(
      async () => {
        const cell = await $('[data-testid="token-debug-tps"]');
        return (await cell.isExisting()) && Number(await cell.getText()) > 0;
      },
      { timeout: 30_000, timeoutMsg: "请求诊断未到达面板" },
    );
    const tps = Number(await $('[data-testid="token-debug-tps"]').getText());
    expect(tps).toBeGreaterThan(35);
    expect(tps).toBeLessThan(45);
    const panel = await $('[data-testid="developer-tools-pane"]');
    expect(await panel.getText()).toContain("120");
    expect(await panel.$$("summary")).not.toHaveLength(0);
    expect(await panel.$('[role="alert"]').isExisting()).toBe(false);
  });
});
