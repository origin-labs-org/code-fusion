import { TID_CHAT_ERROR_BANNER, TID_CHAT_MODEL_SELECT_TRIGGER } from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../../../helpers/desktop-app.js";
import { waitForToastContaining } from "../../../helpers/conversation-session-toast.js";
import {
  prepareHighspeedDrawWorkspace,
  startHighspeedComposerProbe,
  takeHighspeedComposerProbe,
  waitForHighspeedComposerCleared,
} from "../../../helpers/highspeed-card.js";
import {
  sendV4Prompt,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

const FALLBACK_REPLY_TOKEN = "hs-invalid-model-fallback-done";
const FALLBACK_TOAST = "Acceleration service temporarily unavailable; subsequent content in this round will continue using the original model";

describe("Highspeed card fallback unlock E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("HS-E2E-05: Automatically fall back to original model and unlock model selection when accelerated model is not in catalog", async function () {
    this.timeout(180000);

    await prepareHighspeedDrawWorkspace();
    await startHighspeedComposerProbe();
    await sendV4Prompt(
      "E2E_HIGHSPEED_INVALID_MODEL_FALLBACK: reply with the fixed fallback token.",
    );

    await waitForToastContaining(FALLBACK_TOAST, "Downgrade prompt was not shown once after Highspeed creation failure");
    await waitForV4TimelineContaining(FALLBACK_REPLY_TOKEN);
    await waitForV4Pane(
      (snapshot) => !snapshot.canStop && snapshot.timelineText.includes(FALLBACK_REPLY_TOKEN),
      "退回原模型后本轮没有正常完成",
      90000,
    );

    expect(await takeHighspeedComposerProbe()).toBe(true);
    await waitForHighspeedComposerCleared("Input box remained in Highspeed state after falling back to original model");
    expect(await $(`[data-testid="${TID_CHAT_ERROR_BANNER}"]`).isExisting()).toBe(false);

    const modelTrigger = $(`[data-testid="${TID_CHAT_MODEL_SELECT_TRIGGER}"]`);
    await modelTrigger.waitForExist({ timeout: 15000 });
    expect(await modelTrigger.isEnabled()).toBe(true);
    expect(await modelTrigger.getAttribute("aria-disabled")).not.toBe("true");
    await modelTrigger.click();
    await browser.waitUntil(
      async () => (await modelTrigger.getAttribute("aria-expanded")) === "true",
      { timeout: 15000, timeoutMsg: "Highspeed 退回后模型选择器仍无法打开" },
    );
    await browser.keys("Escape");
  });
});
