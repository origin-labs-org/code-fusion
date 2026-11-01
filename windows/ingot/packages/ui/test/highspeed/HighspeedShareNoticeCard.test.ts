// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GlobalNoticeEnvelope } from "@/global-notice/globalNoticeStore.js";
import { HighspeedShareNoticeCard } from "@/highspeed/HighspeedShareNoticeCard.js";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";

const notice: GlobalNoticeEnvelope = {
  noticeId: "notice-1",
  dedupeKey: "highspeed-share:latest",
  type: "highspeed-share",
  schemaVersion: 1,
  scope: "user",
  priority: "normal",
  interruptPolicy: "passive",
  createdAt: 1,
  expiresAt: 10_000,
  payload: {
    cardId: "hsc-1",
    tokenUsage: 120_000,
    durationMs: 600_000,
    savedDurationMs: 480_000,
  },
  actions: [],
  dismissPolicy: { kind: "cooldown", cooldownMs: 86_400_000 },
  persistencePolicy: "latest-only",
  source: "highspeed",
  revision: 1,
};

afterEach(() => cleanup());

function renderCard(target: GlobalNoticeEnvelope) {
  return render(
    createElement(
      CfIntlProvider,
      { initialLocale: "en-US" },
      createElement(HighspeedShareNoticeCard, { notice: target, onDismiss: vi.fn() }),
    ),
  );
}

describe("HighspeedShareNoticeCard", () => {
  it("renders the compact card and opens the local share dialog", () => {
    const { container, getByRole } = renderCard(notice);
    expect(container.querySelector('[data-global-notice-type="highspeed-share"]')).not.toBeNull();
    fireEvent.click(getByRole("button", { name: "View" }));
    expect(getByRole("button", { name: "Copy image" })).toBeTruthy();
    expect(document.body.textContent).toContain("I used the CodeFusion Highspeed card and saved 480s.");
    expect(document.body.textContent).toContain("https://cf.z.ai");
    expect(document.querySelector('[data-highspeed-share-dialog-card="true"]')).not.toBeNull();
  });

  it("keeps the card visible but hides View when speedup is not greater than 1.2x", () => {
    const lowSpeedupNotice: GlobalNoticeEnvelope = {
      ...notice,
      payload: { ...notice.payload, savedDurationMs: 120_000 },
    };
    const { container, queryByRole } = renderCard(lowSpeedupNotice);
    expect(container.querySelector('[data-global-notice-type="highspeed-share"]')).not.toBeNull();
    expect(queryByRole("button", { name: "View" })).toBeNull();
  });

  it("renders View for a boundary card that only clears 1.2x at millisecond precision", () => {
    const boundaryNotice: GlobalNoticeEnvelope = {
      ...notice,
      payload: { cardId: "hsc-edge", tokenUsage: 1_000, durationMs: 6_100, savedDurationMs: 1_225 },
    };
    const { container, getByRole } = renderCard(boundaryNotice);
    expect(container.querySelector('[data-global-notice-type="highspeed-share"]')).not.toBeNull();
    expect(getByRole("button", { name: "View" })).toBeTruthy();
  });

  it("still renders legacy second-precision payloads persisted before the millisecond fields", () => {
    const legacyNotice: GlobalNoticeEnvelope = {
      ...notice,
      payload: {
        cardId: "hsc-legacy",
        tokenUsage: 120_000,
        durationSeconds: 600,
        savedDurationSeconds: 480,
      },
    };
    const { container, getByRole } = renderCard(legacyNotice);
    expect(container.querySelector('[data-global-notice-type="highspeed-share"]')).not.toBeNull();
    expect(getByRole("button", { name: "View" })).toBeTruthy();
  });
});
