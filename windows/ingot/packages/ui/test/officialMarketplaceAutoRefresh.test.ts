import { beforeEach, describe, expect, it } from "vitest";
import {
  OFFICIAL_MARKETPLACE_AUTO_REFRESH_INTERVAL_MS,
  claimMarketplaceAutoRefresh,
  resetMarketplaceAutoRefreshForTests,
  shouldAutoRefreshMarketplace,
} from "@/settings/officialMarketplaceAutoRefresh.js";

const NOW = Date.parse("2026-09-08T12:00:00.000Z");
const minutesAgo = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();

describe("official marketplace auto refresh throttle", () => {
  beforeEach(() => {
    resetMarketplaceAutoRefreshForTests();
  });

  it("Refresh immediately when never successfully refreshed or timestamp is unparseable", () => {
    expect(shouldAutoRefreshMarketplace({ now: NOW })).toBe(true);
    expect(shouldAutoRefreshMarketplace({ lastUpdated: "not-a-date", now: NOW })).toBe(true);
  });

  it("Skip if less than 10 minutes since last successful refresh, refresh after expiration", () => {
    expect(OFFICIAL_MARKETPLACE_AUTO_REFRESH_INTERVAL_MS).toBe(10 * 60_000);
    expect(shouldAutoRefreshMarketplace({ lastUpdated: minutesAgo(9), now: NOW })).toBe(false);
    expect(shouldAutoRefreshMarketplace({ lastUpdated: minutesAgo(10), now: NOW })).toBe(true);
    expect(shouldAutoRefreshMarketplace({ lastUpdated: minutesAgo(11), now: NOW })).toBe(true);
  });

  it("Still skip e2e-forged future lastUpdated", () => {
    expect(
      shouldAutoRefreshMarketplace({ lastUpdated: "2099-01-01T00:00:00.000Z", now: NOW }),
    ).toBe(false);
  });

  it("最近尝试过（失败或仍在飞）时即使 lastUpdated 很旧也跳过", () => {
    expect(
      shouldAutoRefreshMarketplace({
        lastUpdated: minutesAgo(60),
        lastAttemptAt: NOW - 60_000,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("After claim passes, the same market is not released again within the window; different markets do not affect each other", () => {
    expect(claimMarketplaceAutoRefresh("cf-plugins-official", undefined, NOW)).toBe(true);
    expect(claimMarketplaceAutoRefresh("cf-plugins-official", undefined, NOW + 1_000)).toBe(
      false,
    );
    expect(claimMarketplaceAutoRefresh("other-marketplace", undefined, NOW + 1_000)).toBe(true);
    expect(
      claimMarketplaceAutoRefresh(
        "cf-plugins-official",
        undefined,
        NOW + OFFICIAL_MARKETPLACE_AUTO_REFRESH_INTERVAL_MS,
      ),
    ).toBe(true);
  });

  it("After a successful manual refresh, lastUpdated is updated and the window resets accordingly", () => {
    expect(claimMarketplaceAutoRefresh("cf-plugins-official", minutesAgo(30), NOW)).toBe(true);
    const manualRefreshAt = new Date(NOW + 5 * 60_000).toISOString();
    expect(
      claimMarketplaceAutoRefresh("cf-plugins-official", manualRefreshAt, NOW + 11 * 60_000),
    ).toBe(false);
  });
});
