import {
  clearAppData,
  clickTestIdByDom,
  waitForDefaultWorkspaceReady,
} from "../../../helpers/desktop-app.js";
import {
  PLUGIN_CDN_ZIP_ID,
  PLUGIN_CDN_ZIP_MARKETPLACE_ID,
  PLUGIN_CDN_ZIP_OFFLINE_LAST_UPDATED,
} from "../../../helpers/plugin-cdn-zip-marketplace.js";
import {
  capturePluginManualReview,
  getPluginOverview,
  hasPluginControl,
  openPluginSettings,
  requirePluginManualReview,
  waitForPluginCard,
  waitForPluginControl,
} from "../../../helpers/plugin-management-lifecycle.js";

const THROTTLED_TIMEOUT_MS = 120000;
const NO_REFRESH_SETTLE_MS = 5000;

function readOfficialLastUpdated(
  overview: Awaited<ReturnType<typeof getPluginOverview>>,
): string | undefined {
  return overview.marketplaces.find((item) => item.id === PLUGIN_CDN_ZIP_MARKETPLACE_ID)
    ?.lastUpdated;
}

describe("PLM-LC-018 Desktop plugin store auto refresh throttled", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("官方市场 1 分钟前刷新过，进入与重进商店页都不再刷新", async function () {
    this.timeout(THROTTLED_TIMEOUT_MS);
    requirePluginManualReview();
    await waitForDefaultWorkspaceReady();

    const seeded = await getPluginOverview();
    const seededLastUpdated = readOfficialLastUpdated(seeded);
    if (!seededLastUpdated) throw new Error("Seeded official marketplace has no lastUpdated");
    expect(Date.now() - Date.parse(seededLastUpdated)).toBeLessThan(10 * 60_000);

    await openPluginSettings();
    await waitForPluginCard(PLUGIN_CDN_ZIP_ID, 60000);
    await browser.pause(NO_REFRESH_SETTLE_MS);
    expect(readOfficialLastUpdated(await getPluginOverview())).toBe(seededLastUpdated);
    expect(await hasPluginControl("plugin-store-error")).toBe(false);

    await clickTestIdByDom("desktop-top-nav-back");
    await clickTestIdByDom("plugin-store-sidebar-open");
    await waitForPluginControl("plugin-store-root", {}, 30000);
    await waitForPluginCard(PLUGIN_CDN_ZIP_ID, 60000);
    await browser.pause(NO_REFRESH_SETTLE_MS);
    const after = await getPluginOverview();
    expect(readOfficialLastUpdated(after)).toBe(seededLastUpdated);
    expect(
      after.marketplaces.find((item) => item.id === PLUGIN_CDN_ZIP_MARKETPLACE_ID)?.refreshFailure,
    ).toBeUndefined();
    const claude = after.marketplaces.find((item) => item.id === "claude-plugins-official");
    expect(claude?.refreshFailure).toBeUndefined();
    expect(claude?.lastUpdated).toBe(PLUGIN_CDN_ZIP_OFFLINE_LAST_UPDATED);
    expect(await hasPluginControl("plugin-store-error")).toBe(false);
    await capturePluginManualReview("PLM-LC-018", "throttled-reenter");
  });
});
