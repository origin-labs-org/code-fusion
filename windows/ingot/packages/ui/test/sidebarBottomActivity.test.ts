// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import {
  createGlobalNoticeStore,
  type GlobalNoticeStorage,
} from "@/global-notice/globalNoticeStore.js";
import { isMarketingBannerRenderable } from "@/components/marketing-touch/marketingTouchController.js";
import type { MarketingTouchController } from "@/components/marketing-touch/marketingTouchController.js";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";

vi.mock("@/components/marketing-touch/MarketingTouchProvider.js", async (importActual) => {
  const actual =
    await importActual<typeof import("@/components/marketing-touch/MarketingTouchProvider.js")>();
  return {
    ...actual,
    MarketingBanner: () =>
      createElement("div", { "data-testid": "marketing-banner-stub" }, "banner"),
  };
});

import { SidebarBottomActivity } from "@/sidebar-activity/SidebarBottomActivity.js";
import { MarketingTouchContext } from "@/components/marketing-touch/MarketingTouchProvider.js";

function memoryStorage(): GlobalNoticeStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function publishShareNotice(
  store: ReturnType<typeof createGlobalNoticeStore>,
  now = Date.now(),
): void {
  store.publish({
    noticeId: "notice-1",
    dedupeKey: "highspeed-share:latest",
    type: "highspeed-share",
    schemaVersion: 1,
    scope: "user",
    priority: "normal",
    interruptPolicy: "passive",
    createdAt: now,
    expiresAt: now + 100_000,
    payload: {
      cardId: "hsc-1",
      shareId: "share-1",
      shareUrl: "https://example.test/share-1",
      shareExpiresAt: now + 1_000_000,
      tokenUsage: 10,
      durationSeconds: 1,
    },
    actions: [],
    dismissPolicy: { kind: "cooldown", cooldownMs: 24 * 60 * 60_000 },
    persistencePolicy: "latest-only",
    source: "highspeed",
    revision: 1,
  });
}

function fakeController(banner: unknown): MarketingTouchController {
  const store = createStore(() => ({ banner }));
  return { store } as unknown as MarketingTouchController;
}

type GlobalNoticeStore = ReturnType<typeof createGlobalNoticeStore>;

const renderableBanner = {
  delivery: { resource_position: "banner" },
  image: "data:image/png;base64,a",
} as unknown;

function renderActivity(controller: MarketingTouchController, noticeStore: GlobalNoticeStore) {
  return render(
    createElement(
      CfIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(
        MarketingTouchContext.Provider,
        { value: controller },
        createElement(SidebarBottomActivity, { noticeStore }),
      ),
    ),
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("isMarketingBannerRenderable", () => {
  it("Placements at popup position do not count as bottom-left banner", () => {
    expect(
      isMarketingBannerRenderable({
        delivery: { resource_position: "popup" },
        image: "x",
      } as never),
    ).toBe(false);
  });
  it("Hidden at banner position when there is no image and no hero", () => {
    expect(
      isMarketingBannerRenderable({ delivery: { resource_position: "banner" } } as never),
    ).toBe(false);
  });
  it("Visible at banner position when bannerHero is present", () => {
    expect(
      isMarketingBannerRenderable({
        delivery: { resource_position: "banner" },
        bannerHero: { type: "video" },
      } as never),
    ).toBe(true);
  });
});

describe("SidebarBottomActivity 共享槽位仲裁", () => {
  it("Banner visible + highspeed has notification → render claim token banner only, yielding to highspeed", () => {
    const noticeStore = createGlobalNoticeStore({ storage: memoryStorage() });
    publishShareNotice(noticeStore);
    const { container } = renderActivity(fakeController(renderableBanner), noticeStore);

    expect(container.querySelector('[data-testid="marketing-banner-stub"]')).not.toBeNull();
    expect(container.querySelector('[data-global-notice-type="highspeed-share"]')).toBeNull();
  });

  it("Banner hidden + highspeed has notification → render highspeed card in the same slot", () => {
    const noticeStore = createGlobalNoticeStore({ storage: memoryStorage() });
    publishShareNotice(noticeStore);
    const { container } = renderActivity(fakeController(null), noticeStore);

    expect(container.querySelector('[data-testid="marketing-banner-stub"]')).toBeNull();
    expect(container.querySelector('[data-global-notice-type="highspeed-share"]')).not.toBeNull();
  });

  it("Both hidden → slot produces no extra content", () => {
    const noticeStore = createGlobalNoticeStore({ storage: memoryStorage() });
    const { container } = renderActivity(fakeController(null), noticeStore);

    expect(container.querySelector('[data-testid="marketing-banner-stub"]')).toBeNull();
    expect(container.querySelector('[data-global-notice-type="highspeed-share"]')).toBeNull();
  });

  it("After banner is closed (store updated to null), highspeed reappears in the same slot", () => {
    const noticeStore = createGlobalNoticeStore({ storage: memoryStorage() });
    publishShareNotice(noticeStore);
    const controller = fakeController(renderableBanner);
    const { container } = renderActivity(controller, noticeStore);
    expect(container.querySelector('[data-testid="marketing-banner-stub"]')).not.toBeNull();

    act(() => {
      controller.store.setState({ banner: null } as never);
    });

    expect(container.querySelector('[data-testid="marketing-banner-stub"]')).toBeNull();
    expect(container.querySelector('[data-global-notice-type="highspeed-share"]')).not.toBeNull();
  });
});
