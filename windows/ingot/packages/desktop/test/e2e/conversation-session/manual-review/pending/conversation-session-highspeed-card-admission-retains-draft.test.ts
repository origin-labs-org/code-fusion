import { TID_CHAT_ERROR_BANNER, TID_CHAT_MODEL_SELECT_TRIGGER } from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  prepareHighspeedDrawWorkspace,
  waitForHighspeedComposerCleared,
} from "../../../helpers/highspeed-card.js";
import { seedReplayProvider } from "../../../helpers/model-provider-restart.js";
import {
  sendV4Prompt,
  waitForV4ComposerText,
  waitForV4Pane,
} from "../../../helpers/v4-conversation.js";

const PROMPT = "E2E_HIGHSPEED_ADMISSION_RETAINS_DRAFT";
const RECOVERY_PROVIDER_ID = "highspeed-admission-recovery";
const RECOVERY_MODEL_ID = "recovery-model";

async function installHighspeedAdmissionRegistryRace() {
  await browser.execute(() => {
    const element = document.querySelector('[data-testid="v4-model-config"]');
    if (!element) throw new Error("Highspeed admission probe cannot find model configuration entrypoint");
    const fiberKey = Object.keys(element).find((key) => key.startsWith("__reactFiber"));
    let fiber = fiberKey
      ? (element as unknown as Record<string, { return?: unknown }>)[fiberKey]
      : undefined;
    let services: any;
    while (fiber) {
      const value = (fiber as any).memoizedProps?.value;
      const candidate = value?.highspeedCardService
        ? value
        : (fiber as any).memoizedProps?.services;
      if (candidate?.highspeedCardService && candidate?.providerSettingsService) {
        services = candidate;
        break;
      }
      fiber = (fiber as any).return;
    }
    if (!services) throw new Error("Highspeed admission probe 找不到 Workspace services");

    const highspeed = services.highspeedCardService;
    const originalPrepareTurn = highspeed.prepareTurn;
    (window as any).__restoreHighspeedAdmissionRegistryRace = () => {
      highspeed.prepareTurn = originalPrepareTurn;
      delete (window as any).__restoreHighspeedAdmissionRegistryRace;
    };
    highspeed.prepareTurn = async (...args: unknown[]) => {
      const result = await originalPrepareTurn.apply(highspeed, args);
      if (result?.kind !== "accelerated") return result;

      await services.oauthService.logoutAll();
      await services.providerSettingsService.refresh("e2e-highspeed-admission-registry-race");
      return result;
    };
  });
}

async function restoreHighspeedAdmissionRegistryRace() {
  await browser.execute(() => {
    (window as any).__restoreHighspeedAdmissionRegistryRace?.();
  });
}

describe("Highspeed card admission rejection E2E", () => {
  after(async () => {
    await restoreHighspeedAdmissionRegistryRace().catch(() => undefined);
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("HS-E2E-04: Restore input and exit accelerated state when both Highspeed and fallback targets are unavailable", async function () {
    this.timeout(180000);

    await seedReplayProvider({
      id: RECOVERY_PROVIDER_ID,
      models: [RECOVERY_MODEL_ID],
      name: "Highspeed Admission Recovery",
    });
    await prepareHighspeedDrawWorkspace();
    await installHighspeedAdmissionRegistryRace();
    await sendV4Prompt(PROMPT);

    await waitForV4ComposerText(PROMPT, "Highspeed 准入拒绝后 Composer 没有恢复原输入", 30000);
    await waitForHighspeedComposerCleared("Input box remained in accelerated state after Highspeed admission rejection");
    const pane = await waitForV4Pane(
      (snapshot) => !snapshot.timelineText.includes(PROMPT),
      "Inputs rejected before ACK should not appear in timeline",
    );
    expect(pane.timelineText).not.toContain(PROMPT);
    expect(await $(`[data-testid="${TID_CHAT_ERROR_BANNER}"]`).isExisting()).toBe(false);

    const modelTrigger = $(`[data-testid="${TID_CHAT_MODEL_SELECT_TRIGGER}"]`);
    await modelTrigger.waitForExist({ timeout: 15000 });
    await browser.waitUntil(
      async () =>
        (await modelTrigger.isEnabled()) &&
        (await modelTrigger.getAttribute("aria-disabled")) !== "true",
      { timeout: 15000, timeoutMsg: "Model selector was not unlocked after Highspeed admission rejection" },
    );
    await modelTrigger.click();
    await browser.waitUntil(
      async () => (await modelTrigger.getAttribute("aria-expanded")) === "true",
      { timeout: 15000, timeoutMsg: "Highspeed 准入拒绝后模型选择器仍无法打开" },
    );
    await browser.keys("Escape");
  });
});
