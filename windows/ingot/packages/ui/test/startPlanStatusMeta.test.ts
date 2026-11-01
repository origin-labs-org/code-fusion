// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveStartPlanStatusMetaState,
  StartPlanStatusMeta,
} from "@/settings/model-provider-section/CodingPlanStatusMeta.js";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    locale: "zh-CN",
    intl: {
      formatMessage: ({ id }: { id: string }, values?: Record<string, string>) =>
        values?.date ? `${id} ${values.date}` : id,
    },
  }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("StartPlanStatusMeta", () => {
  it("Show pending activation and expiration time when schedule has not arrived; do not show refresh button", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T10:00:00+08:00"));

    const { container } = render(
      createElement(StartPlanStatusMeta, {
        expireTime: "2026-09-02T09:00:00+08:00",
        entitlements: [
          {
            entitlementId: "scheduled",
            effectiveTime: "2026-09-01T20:00:00+08:00",
          },
        ],
        hasQuota: false,
        onRefresh: vi.fn(),
      }),
    );

    expect(container.textContent).toContain("settings.modelProvider.startPlan.pendingUntil");
    expect(container.textContent).toContain("settings.modelProvider.startPlan.expiresAt");
    expect(
      screen.queryByRole("button", {
        name: "settings.modelProvider.startPlan.refreshEntitlement",
      }),
    ).toBeNull();
  });

  it("Show refresh benefits button when schedule arrives but quota bucket is not yet available; click to invoke refresh flow", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T20:01:00+08:00"));
    const onRefresh = vi.fn();

    const { container } = render(
      createElement(StartPlanStatusMeta, {
        expireTime: "2026-09-02T09:00:00+08:00",
        entitlements: [
          {
            entitlementId: "scheduled",
            effectiveTime: "2026-09-01T20:00:00+08:00",
          },
        ],
        hasQuota: false,
        onRefresh,
      }),
    );

    const refreshButton = screen.getByRole("button", {
      name: "settings.modelProvider.startPlan.refreshEntitlement",
    });
    fireEvent.click(refreshButton);

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("settings.modelProvider.startPlan.pendingUntil");
    expect(container.textContent).toContain("settings.modelProvider.startPlan.expiresAt");
    expect(container.textContent?.indexOf("refreshEntitlement")).toBeLessThan(
      container.textContent?.indexOf("expiresAt") ?? -1,
    );
  });

  it("Pending activation automatically switches to refresh button if scheduled time arrives while staying on the page", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T19:59:00+08:00"));

    render(
      createElement(StartPlanStatusMeta, {
        expireTime: "2026-09-02T09:00:00+08:00",
        entitlements: [
          {
            entitlementId: "scheduled",
            effectiveTime: "2026-09-01T20:00:00+08:00",
          },
        ],
        hasQuota: false,
        onRefresh: vi.fn(),
      }),
    );
    expect(screen.queryByRole("button")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(60_001);
    });

    expect(
      screen.getByRole("button", {
        name: "settings.modelProvider.startPlan.refreshEntitlement",
      }),
    ).toBeTruthy();
  });

  it("Hide button after refresh fetches quota bucket; immediately effective benefits also never show the button", () => {
    const scheduledEntitlements = [
      {
        entitlementId: "scheduled",
        effectiveTime: "2026-09-01T20:00:00+08:00",
      },
    ];
    const now = new Date("2026-09-01T20:01:00+08:00").getTime();

    expect(
      resolveStartPlanStatusMetaState({
        entitlements: scheduledEntitlements,
        hasQuota: true,
        now,
      }),
    ).toBe("settled");
    expect(
      resolveStartPlanStatusMetaState({
        entitlements: [
          {
            entitlementId: "immediate",
            effectiveTime: "1970-01-01T00:00:00.000Z",
          },
        ],
        hasQuota: false,
        now,
      }),
    ).toBe("settled");
  });

  it("Disable refresh benefits button during refresh", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T20:01:00+08:00"));

    render(
      createElement(StartPlanStatusMeta, {
        expireTime: "2026-09-02T09:00:00+08:00",
        entitlements: [
          {
            entitlementId: "scheduled",
            effectiveTime: "2026-09-01T20:00:00+08:00",
          },
        ],
        hasQuota: false,
        refreshing: true,
        onRefresh: vi.fn(),
      }),
    );

    expect(
      screen
        .getByRole("button", {
          name: "settings.modelProvider.startPlan.refreshEntitlement",
        })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});
