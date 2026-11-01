import {
  clearAppData,
  clickTestIdByDom,
  waitForDefaultWorkspaceReady,
} from "../../../helpers/desktop-app.js";
import {
  PLUGIN_CDN_ZIP_MARKETPLACE_ID,
  PLUGIN_STORE_AUTO_REFRESH_STALE_LAST_UPDATED,
} from "../../../helpers/plugin-cdn-zip-marketplace.js";
import {
  capturePluginManualReview,
  getPluginOverview,
  hasPluginControl,
  openPluginSettings,
  requirePluginManualReview,
  waitForPluginControl,
} from "../../../helpers/plugin-management-lifecycle.js";

//   CF_E2E_MANUAL_REVIEW=1 CF_E2E_MANUAL_REVIEW_HOLD_MS=180000 \
//   E2E_PROVIDER_REPLAY_FIXTURE_PATH=packages/desktop/test/e2e/fixtures/upstream/common.json \
const CDN_REFRESH_TIMEOUT_MS = 180000;
const NO_REFRESH_SETTLE_MS = 5000;

function readOfficialLastUpdated(
  overview: Awaited<ReturnType<typeof getPluginOverview>>,
): string | undefined {
  return overview.marketplaces.find((item) => item.id === PLUGIN_CDN_ZIP_MARKETPLACE_ID)
    ?.lastUpdated;
}

describe("PLM-LC-019 Desktop plugin store auto refresh on enter (real official CDN)", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("官方市场刷新时间过期时，进入商店页不点刷新也会自动刷新，重进则命中节流", async function () {
    requirePluginManualReview();
    await waitForDefaultWorkspaceReady();

    expect(readOfficialLastUpdated(await getPluginOverview())).toBe(
      PLUGIN_STORE_AUTO_REFRESH_STALE_LAST_UPDATED,
    );
    const enteredAt = Date.now();

    await openPluginSettings();
    let refreshedLastUpdated: string | undefined;
    let official: Awaited<ReturnType<typeof getPluginOverview>>["marketplaces"][number] | undefined;
    await browser
      .waitUntil(
        async () => {
          official = (await getPluginOverview()).marketplaces.find(
            (item) => item.id === PLUGIN_CDN_ZIP_MARKETPLACE_ID,
          );
          if (official?.refreshFailure) {
            throw new Error(
              `Official marketplace auto refresh failed: ${JSON.stringify(official.refreshFailure)}`,
            );
          }
          refreshedLastUpdated = official?.lastUpdated;
          return (
            refreshedLastUpdated !== undefined &&
            refreshedLastUpdated !== PLUGIN_STORE_AUTO_REFRESH_STALE_LAST_UPDATED
          );
        },
        {
          timeout: CDN_REFRESH_TIMEOUT_MS,
          interval: 2000,
          timeoutMsg: "Entering the plugin store did not auto refresh the official marketplace",
        },
      )
      .catch((error: unknown) => {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}; official=${JSON.stringify(official)}`,
        );
      });
    if (!refreshedLastUpdated) throw new Error("Official marketplace lastUpdated missing");
    expect(Date.parse(refreshedLastUpdated)).toBeGreaterThanOrEqual(enteredAt - 60_000);
    expect(await hasPluginControl("plugin-store-error")).toBe(false);
    await capturePluginManualReview("PLM-LC-019", "auto-refreshed-on-enter");

    await clickTestIdByDom("desktop-top-nav-back");
    await clickTestIdByDom("plugin-store-sidebar-open");
    await waitForPluginControl("plugin-store-root", {}, 30000);
    await browser.pause(NO_REFRESH_SETTLE_MS);
    expect(readOfficialLastUpdated(await getPluginOverview())).toBe(refreshedLastUpdated);
  });
});
