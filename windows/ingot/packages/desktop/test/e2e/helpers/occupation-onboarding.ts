import { TID_TASK_SETTINGS_BUTTON } from "@origin-ai/cf-shared/test-ids";
import { sel } from "./selectors.js";

export async function skipOccupationOnboardingIfPresent() {
  await browser.waitUntil(
    async () =>
      (await $('[data-testid="onboarding-page"]').isExisting()) ||
      (await $(sel(TID_TASK_SETTINGS_BUTTON)).isExisting()),
    { timeout: 30000 },
  );
  for (
    let step = 0;
    step < 3 && (await $('[data-testid="onboarding-page"]').isExisting());
    step++
  ) {
    const skip = $('//button[normalize-space(.)="跳过" or normalize-space(.)="跳过"]');
    await skip.waitForClickable({ timeout: 15000 });
    await skip.click();
  }
  await $('[data-testid="onboarding-page"]').waitForExist({ reverse: true, timeout: 15000 });
}

export async function dismissOccupationOnboarding() {
  await browser.keys("Escape");
}
