import {
  TID_CHAT_MODE_SELECT_TRIGGER,
  TID_CHAT_MODE_SELECT_ITEM,
  TID_V4_COMPOSER_INPUT,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  prepareV4ConversationE2E,
  switchV4Mode,
  getV4ModelConfig,
} from "../../../helpers/v4-conversation.js";
import { getUpstreamRequestRecordCount } from "../../../helpers/conversation-session-network.js";

describe("Todo151 standalone Plan draft", () => {
  after(async () => {
    await clearAppData();
  });
  it("PLAN151-01: Plan is independent of permissions; entire button only clears flag without triggering requests", async () => {
    try {
      await prepareV4ConversationE2E();
    } catch (error) {
      const onboarding = $('[data-testid="onboarding-page"]');
      if (!(await onboarding.isDisplayed())) throw error;
      for (let step = 0; step < 3 && (await onboarding.isDisplayed()); step++) {
        const previous = await onboarding.getText();
        const buttons = await onboarding.$$("button");
        for (const button of buttons) {
          if (/^(Skip|Skip)$/.test(await button.getText())) {
            await button.click();
            break;
          }
        }
        await browser.waitUntil(async () =>
          browser.execute((previousText) => {
            const page = document.querySelector('[data-testid="onboarding-page"]');
            return !page || (page as HTMLElement).innerText !== previousText;
          }, previous),
        );
      }
      await prepareV4ConversationE2E();
    }
    await switchV4Mode("yolo");
    const before = await getUpstreamRequestRecordCount();
    await $(`[data-testid="${TID_CHAT_MODE_SELECT_TRIGGER}"]`).click();
    const plan = $(`[data-testid="${testId(TID_CHAT_MODE_SELECT_ITEM, "plan")}"]`);
    await plan.waitForDisplayed();
    expect(await plan.getText()).toMatch(/Edit前先出Plan。|Plan before editing\./);
    expect(await plan.getAttribute("role")).toBe("menuitemcheckbox");
    await plan.click();
    const marker = $('[data-testid="v4-composer-plan-marker"]');
    await marker.waitForDisplayed();
    expect((await getV4ModelConfig()).mode).toBe("yolo");
    await plan.waitForExist({ reverse: true });
    await $(`[data-testid="${TID_CHAT_MODE_SELECT_TRIGGER}"]`).click();
    await plan.waitForDisplayed();
    expect(await plan.getAttribute("aria-checked")).toBe("true");
    await plan.click();
    await marker.waitForExist({ reverse: true });
    expect((await getV4ModelConfig()).mode).toBe("yolo");
    expect(await getUpstreamRequestRecordCount()).toBe(before);
    await plan.waitForExist({ reverse: true });
    await $(`[data-testid="${TID_CHAT_MODE_SELECT_TRIGGER}"]`).click();
    await plan.waitForDisplayed();
    expect(await plan.getAttribute("aria-checked")).toBe("false");
    await plan.click();
    await marker.waitForDisplayed();
    await plan.waitForExist({ reverse: true });
    await switchV4Mode("edit");
    expect((await getV4ModelConfig()).mode).toBe("edit");
    expect(await marker.isDisplayed()).toBe(true);
    const button = marker.$("button");
    const divider = marker.$('[role="separator"]');
    expect(await divider.getSize("height")).toBe(12);
    expect(await button.getSize("height")).toBe(
      await $(`[data-testid="${TID_CHAT_MODE_SELECT_TRIGGER}"]`).getSize("height"),
    );
    await $(`[data-testid="${TID_V4_COMPOSER_INPUT}"]`).moveTo();
    await browser.waitUntil(async () =>
      browser.execute(() => !document.querySelector('[data-slot="tooltip-content"]')),
    );
    expect(await button.$("svg.lucide-lightbulb").isDisplayed()).toBe(true);
    expect(await button.$("svg.lucide-x").isDisplayed()).toBe(false);
    await button.moveTo();
    await browser.waitUntil(
      async () => {
        for (const tooltip of await $$('[data-slot="tooltip-content"]')) {
          if (
            (await tooltip.isDisplayed()) &&
            /ClosePlan Mode|Turn off Plan mode/.test(await tooltip.getText())
          )
            return true;
        }
        return false;
      },
      { timeoutMsg: "Plan close prompt was not displayed" },
    );
    expect(await button.$("svg.lucide-lightbulb").isDisplayed()).toBe(false);
    expect(await button.$("svg.lucide-x").isDisplayed()).toBe(true);
    for (const width of [1280, 980, 740, 520, 390]) {
      await browser.electron.execute(async (electron, viewportWidth) => {
        const target = electron.BrowserWindow.getAllWindows().find(
          (window) => !window.isDestroyed() && window.isVisible(),
        )!;
        if (!target.webContents.debugger.isAttached()) target.webContents.debugger.attach("1.3");
        await target.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
          width: viewportWidth,
          height: 844,
          deviceScaleFactor: 1,
          mobile: false,
        });
      }, width);
      for (const theme of ["cf-light", "cf-dark"]) {
        await browser.execute((value) => {
          (
            window as unknown as { __testActions: { setTheme(theme: string): void } }
          ).__testActions.setTheme(value);
        }, theme);
        await browser.waitUntil(async () =>
          browser.execute((expected) => window.innerWidth === expected, width),
        );
        await marker.waitForDisplayed();
        expect(await divider.getSize("height")).toBe(12);
        const modeButton = $(`[data-testid="${TID_CHAT_MODE_SELECT_TRIGGER}"]`);
        if (width === 390) {
          expect(await button.$("span").isDisplayed()).toBe(false);
          expect(await button.getSize()).toEqual({ width: 28, height: 28 });
          expect(await modeButton.getSize()).toEqual({ width: 28, height: 28 });
        } else if (width === 1280) {
          expect(await button.$("span").isDisplayed()).toBe(true);
          expect(await button.getSize("width")).toBeGreaterThan(28);
        }
        const groupsSeparated = await browser.execute(() => {
          const left = document
            .querySelector("[data-composer-leading-content]")!
            .getBoundingClientRect();
          const right = document
            .querySelector("[data-composer-trailing-actions]")!
            .getBoundingClientRect();
          return right.left >= left.right + 11 && Math.abs(right.bottom - left.bottom) <= 1;
        });
        expect(groupsSeparated).toBe(true);
        await browser.saveScreenshot(`.e2e-artifacts/plan-marker-${width}-${theme}.png`);
      }
    }
    await browser.electron.execute(async (electron) => {
      const target = electron.BrowserWindow.getAllWindows().find(
        (window) => !window.isDestroyed() && window.isVisible(),
      )!;
      await target.webContents.debugger.sendCommand("Emulation.clearDeviceMetricsOverride");
    });
    await button.$("span").click();
    await marker.waitForExist({ reverse: true });
    expect((await getV4ModelConfig()).mode).toBe("edit");
    expect(await getUpstreamRequestRecordCount()).toBe(before);
  });
});
