import { clearAppData } from "./helpers/desktop-app.js";
import {
  openBigModelCodingPlanPersonalUpgradePanel,
} from "./helpers/coding-plan-upgrade.js";
import {
  waitForCodingPlanWebviewBodyTextIncludes,
  waitForCodingPlanWebviewDisplayed,
} from "./helpers/coding-plan-upgrade-webview.js";

describe("BigModel Coding Plan upgrade page personal plan system busy E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("When an account without Coding entitlements enters the upgrade page and the plan endpoint is busy, the personal plan button displays Subscription Busy", async function () {
    this.timeout(120000);

    await openBigModelCodingPlanPersonalUpgradePanel();
    await waitForCodingPlanWebviewDisplayed();
    await waitForCodingPlanWebviewBodyTextIncludes(["Subscription Busy", "System busy"]);
  });
});
