import { TID_V4_COMPOSER_INPUT, TID_V4_SESSION_PANE, testId } from "@origin-ai/cf-shared/test-ids";
import { clearAppData, waitForDefaultWorkspaceReady } from "./helpers/desktop-app.js";
import { V4_MAIN_PANE_ID } from "./helpers/v4-conversation.js";
import { sel } from "./helpers/selectors.js";

describe("桌面端 E2E smoke", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Should enter the interactive workspace main interface after default launch", async () => {
    await waitForDefaultWorkspaceReady();

    await expect($(sel(testId(TID_V4_SESSION_PANE, V4_MAIN_PANE_ID)))).toBeDisplayed();
    await expect($(sel(TID_V4_COMPOSER_INPUT))).toBeDisplayed();
  });
});
