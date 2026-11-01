import { readFile } from "node:fs/promises";
import { BUILTIN_MODEL_PROVIDER_IDS } from "@origin-ai/cf-shared";
import {
  TID_TASK_SETTINGS_BUTTON,
  TID_SETTINGS_SECTION_NAV,
  TID_MODEL_PROVIDER_NAV_ITEM,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  clickTestIdByDom,
  clearAppData,
  getE2EAppDataPaths,
  waitForDefaultWorkspaceReady,
} from "#e2e/helpers/desktop-app";
import {
  waitForCodingPlanWebviewBodyTextIncludes,
  waitForCodingPlanWebviewDisplayed,
} from "#e2e/helpers/coding-plan-upgrade-webview";

describe("BigModel Coding Plan upgrade page personal plan sold out E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("When an account without Coding entitlements enters the upgrade page, the personal plan button displays Sold Out", async function () {
    this.timeout(120000);

    const credentialKeys = Object.keys(
      JSON.parse(await readFile(getE2EAppDataPaths().credentialsFile, "utf8")),
    );
    expect(credentialKeys).toContain("oauth:bigmodel:access_token");
    expect(credentialKeys.some((key) => key.startsWith("oauth:zai:"))).toBe(false);

    await waitForDefaultWorkspaceReady(30000);
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON);
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "modelProvider"));
    await clickTestIdByDom(
      testId(TID_MODEL_PROVIDER_NAV_ITEM, `preset:${BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan}`),
    );
    const subscribe = () =>
      $("//button[normalize-space(.)='订阅' or normalize-space(.)='Subscribe']");
    await subscribe().waitForClickable({ timeout: 30000 });
    expect(await $('[data-testid="coding-plan-embedded-webview"]').isExisting()).toBe(false);
    await subscribe().click();
    await waitForCodingPlanWebviewDisplayed();
    await waitForCodingPlanWebviewBodyTextIncludes(["Sold Out", "已售罄"]);
  });
});
