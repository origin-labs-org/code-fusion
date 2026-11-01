// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodingPlanResetType } from "@origin-ai/cf-shared";
import {
  CodingPlanQuotaResetOpportunity,
  type CodingPlanQuotaResetDialogConfig,
} from "@/components/coding-plan-quota-reset/CodingPlanQuotaResetOpportunity.js";
import type { CodingPlanQuotaResetDialogResetItem } from "@/components/coding-plan-quota-reset/CodingPlanQuotaResetDialog.js";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import { mergeCodingPlanQuotaResetOpportunityBadges } from "@/lib/codingPlanQuotaResetUi.js";

vi.mock("@/lib/codingPlanQuotaResetConfetti.js", () => ({
  burstCodingPlanQuotaResetConfetti: vi.fn(),
}));

function renderOpportunity(props: {
  count: number;
  dialog?: CodingPlanQuotaResetDialogConfig;
  dialogOpen?: boolean;
  expiresAt: number | null;
  onDialogOpenChange?: (open: boolean) => void;
}) {
  return render(
    createElement(
      CfIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(CodingPlanQuotaResetOpportunity, {
        ...props,
        placement: "inline",
        visible: true,
      }),
    ),
  );
}

function createDialogConfig(overrides: Partial<CodingPlanQuotaResetDialogConfig> = {}) {
  return {
    usageItems: [
      {
        color: "var(--color-usage-chart-1)",
        id: "five-hour",
        label: "5 Hours",
        percentage: 5,
        resetTime: "19:08",
        value: "5%",
      },
      {
        color: "var(--color-usage-chart-2)",
        id: "week",
        label: "每周",
        percentage: 99,
        resetTime: "8月12日",
        value: "99%",
      },
    ],
    resetItems: [
      {
        count: 1,
        expiresAt: Date.now() + 20 * 60_000,
        onReset: vi.fn(async () => undefined),
        resetType: "FIVE_HOUR" as const,
      },
      {
        count: 1,
        expiresAt: Date.now() + 2 * 24 * 60 * 60_000,
        onReset: vi.fn(async () => undefined),
        resetType: "WEEK" as const,
      },
    ],
    ...overrides,
  } satisfies CodingPlanQuotaResetDialogConfig;
}

function renderStatefulOpportunity(
  initialExpiries: Partial<Record<CodingPlanResetType, number[]>>,
) {
  const onReset: Record<CodingPlanResetType, ReturnType<typeof vi.fn>> = {
    FIVE_HOUR: vi.fn(),
    WEEK: vi.fn(),
  };
  function Harness() {
    const [expiries, setExpiries] = useState(initialExpiries);
    const resetItems = (Object.keys(expiries) as CodingPlanResetType[]).map(
      (resetType): CodingPlanQuotaResetDialogResetItem => {
        const remaining = expiries[resetType] ?? [];
        return {
          count: remaining.length,
          expiresAt: remaining[0] ?? null,
          onReset: async () => {
            onReset[resetType]();
            setExpiries((current) => ({
              ...current,
              [resetType]: (current[resetType] ?? []).slice(1),
            }));
          },
          resetType,
        };
      },
    );
    const badge = mergeCodingPlanQuotaResetOpportunityBadges(
      resetItems.map((item) => ({ ...item, visible: item.count > 0 })),
    );
    return createElement(
      CfIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(CodingPlanQuotaResetOpportunity, {
        count: badge.count,
        dialog: createDialogConfig({ resetItems }),
        expiresAt: badge.expiresAt,
        placement: "inline",
        visible: badge.visible,
      }),
    );
  }
  render(createElement(Harness));
  return onReset;
}

describe("CodingPlanQuotaResetOpportunity", () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("Single opportunity keeps badge text and countdown; clicking also opens reset modal", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T10:00:00+08:00"));

    renderOpportunity({
      count: 1,
      dialog: createDialogConfig(),
      expiresAt: Date.now() + 19 * 60_000 + 8_000,
    });

    expect(screen.getByText("1 次重置额度")).toBeTruthy();
    screen.getByText("19m 8s remaining");

    expect(screen.queryByRole("button", { name: "获得1次重置额度" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "1 次重置额度" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "可重置额度" })).toBeTruthy();
  });

  it("Multiple opportunities show count and hide countdown at entry point; clicking opens design spec modal", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T10:00:00+08:00"));

    renderOpportunity({
      count: 2,
      dialog: createDialogConfig(),
      expiresAt: Date.now() + 19 * 60_000 + 8_000,
    });

    expect(screen.queryByText("19m 8s remaining")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "获得2次重置额度" }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "可重置额度" })).toBeTruthy();
    expect(screen.queryByText("2 次可用")).toBeNull();
    expect(screen.getByLabelText("剩余用量")).toBeTruthy();
    expect(screen.getByText("5 小时额度重置")).toBeTruthy();
    expect(screen.getByText("周额度重置")).toBeTruthy();
  });

  it("Modal calls reset only for the clicked credit, showing feedback and collapsing consumed items on success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T10:00:00+08:00"));
    const onReset = renderStatefulOpportunity({
      FIVE_HOUR: [Date.now() + 20 * 60_000],
      WEEK: [Date.now() + 2 * 24 * 60 * 60_000],
    });

    fireEvent.click(screen.getByRole("button", { name: "获得2次重置额度" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reset 5-Hour Quota" }));
      await Promise.resolve();
    });

    expect(onReset.FIVE_HOUR).toHaveBeenCalledTimes(1);
    expect(onReset.WEEK).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reset Successful" })).toBeTruthy();
    expect(within(screen.getByRole("dialog")).queryByText(/0 min 0 sec/)).toBeNull();

    act(() => vi.advanceTimersByTime(600));
    expect(within(screen.getByRole("dialog")).queryByText(/0 min 0 sec/)).toBeNull();

    act(() => vi.advanceTimersByTime(220));
    expect(screen.queryByText("5 小时额度重置")).toBeNull();
    expect(screen.getByText("周额度重置")).toBeTruthy();
  });

  it("After redeeming one opportunity of the same type, retain the row and display the next countdown, allowing another redemption without closing modal", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T10:00:00+08:00"));
    const onReset = renderStatefulOpportunity({
      FIVE_HOUR: [Date.now() + 20 * 60_000, Date.now() + 3 * 60 * 60_000 + 30 * 60_000 + 30_000],
      WEEK: [Date.now() + 2 * 24 * 60 * 60_000],
    });

    fireEvent.click(screen.getByRole("button", { name: "获得3次重置额度" }));
    expect(screen.getByText("2 次")).toBeTruthy();
    expect(screen.getByText("最快 20 分 0 秒后过期")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reset 5-Hour Quota" }));
      await Promise.resolve();
    });
    expect(onReset.FIVE_HOUR).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(600));
    expect(screen.getByText("5 小时额度重置")).toBeTruthy();
    expect(screen.queryByText("2 次")).toBeNull();
    expect(screen.getByText("Expires in 3 hours 30 minutes")).toBeTruthy();
    expect(within(screen.getByRole("dialog")).queryByText(/0 min 0 sec/)).toBeNull();
    const resetAgain = screen.getByRole("button", { name: "Reset 5-Hour Quota" }) as HTMLButtonElement;
    expect(resetAgain.disabled).toBe(false);

    act(() => vi.advanceTimersByTime(220));
    expect(screen.getByText("5 小时额度重置")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reset 5-Hour Quota" }));
      await Promise.resolve();
    });
    expect(onReset.FIVE_HOUR).toHaveBeenCalledTimes(2);
    expect(within(screen.getByRole("dialog")).queryByText(/0 min 0 sec/)).toBeNull();
    act(() => vi.advanceTimersByTime(820));
    expect(screen.queryByText("5 小时额度重置")).toBeNull();
    expect(screen.getByText("周额度重置")).toBeTruthy();
    expect(onReset.WEEK).not.toHaveBeenCalled();
  });

  it("Display count pill and \"earliest\" countdown when holding multiple opportunities of the same type; hide for single", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T10:00:00+08:00"));

    renderOpportunity({
      count: 3,
      dialog: createDialogConfig({
        resetItems: [
          {
            count: 2,
            expiresAt: Date.now() + 4 * 60 * 60_000 + 52 * 60_000,
            onReset: vi.fn(async () => undefined),
            resetType: "FIVE_HOUR",
          },
          {
            count: 1,
            expiresAt: Date.now() + 4 * 60 * 60_000 + 58 * 60_000,
            onReset: vi.fn(async () => undefined),
            resetType: "WEEK",
          },
        ],
      }),
      expiresAt: Date.now() + 4 * 60 * 60_000 + 52 * 60_000,
    });

    fireEvent.click(screen.getByRole("button", { name: "获得3次重置额度" }));

    expect(screen.getByText("2 次")).toBeTruthy();
    expect(screen.getByText("Expires in 4 hours 52 minutes at the earliest")).toBeTruthy();
    expect(screen.queryByText("1 次")).toBeNull();
    expect(screen.getByText("Expires in 4 hours 58 minutes")).toBeTruthy();
  });

  it("Keep mounted when server opportunity count decreases after modal opens until manually closed by user", () => {
    const dialog = createDialogConfig();
    const view = renderOpportunity({
      count: 2,
      dialog,
      expiresAt: Date.now() + 20 * 60_000,
    });

    fireEvent.click(screen.getByRole("button", { name: "获得2次重置额度" }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    view.rerender(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(CodingPlanQuotaResetOpportunity, {
          count: 1,
          dialog,
          expiresAt: Date.now() + 20 * 60_000,
          placement: "inline",
          visible: true,
        }),
      ),
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("Closing and reopening during success animation is unaffected by delayed tasks from previous modal", async () => {
    vi.useFakeTimers();
    const resetFiveHour = vi.fn(async () => undefined);
    renderOpportunity({
      count: 2,
      dialog: createDialogConfig({
        resetItems: [
          {
            count: 1,
            expiresAt: Date.now() + 20 * 60_000,
            onReset: resetFiveHour,
            resetType: "FIVE_HOUR",
          },
        ],
      }),
      expiresAt: Date.now() + 20 * 60_000,
    });

    fireEvent.click(screen.getByRole("button", { name: "获得2次重置额度" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reset 5-Hour Quota" }));
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "获得2次重置额度" }));

    act(() => vi.advanceTimersByTime(820));
    expect(screen.getByText("5 小时额度重置")).toBeTruthy();
  });

  it("Support modal toggle control by Composer to ensure HoverCard is not unmounted while modal is open", () => {
    const onDialogOpenChange = vi.fn();
    renderOpportunity({
      count: 2,
      dialog: createDialogConfig(),
      dialogOpen: false,
      expiresAt: Date.now() + 20 * 60_000,
      onDialogOpenChange,
    });

    fireEvent.click(screen.getByRole("button", { name: "获得2次重置额度" }));
    expect(onDialogOpenChange).toHaveBeenCalledWith(true);
  });
});
