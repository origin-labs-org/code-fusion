// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppUsageRange, AppUsageSnapshot } from "@origin-ai/cf-shared";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import { ServiceProvider } from "@/hooks/useServices.js";
import {
  AppUsageLifetimeSummaryStrip,
  AppUsagePanel,
} from "@/settings/usage-stats/AppUsagePanel.js";

vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children, title }: { children: ReactNode; title: string }) =>
    createElement("span", { "data-tooltip-title": title }, children),
}));

function createSnapshot(
  overrides: Partial<AppUsageSnapshot> & { range?: AppUsageRange } = {},
): AppUsageSnapshot {
  return {
    range: overrides.range ?? "all",
    generatedAt: 0,
    timeZone: "UTC",
    source: "agent-db",
    summary: {
      totalTokens: 20_650_000_000,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cacheHitRate: 0,
      totalSessions: 0,
      totalTurns: 0,
      toolCallCount: 0,
      toolErrorRate: 0,
      modelErrorRate: 0,
      avgTimeToFirstTokenMs: null,
      avgTurnDurationMs: null,
      activeDays: 0,
      currentStreakDays: 5,
      longestSessionMs: 2 * 60 * 60 * 1000 + 15 * 60 * 1000,
      longestStreakDays: 34,
      peakDayTokens: 370_000_000,
      favoriteModel: null,
    },
    heatmap: {
      startDate: null,
      endDate: null,
      maxTokens: 370_000_000,
      weeks: [],
    },
    dailyModelUsage: [],
    models: [],
    tools: [],
    ...overrides,
  };
}

function createOneDayHeatmap(totalTokens: number): AppUsageSnapshot["heatmap"] {
  return {
    startDate: "2026-08-15",
    endDate: "2026-08-15",
    maxTokens: totalTokens,
    weeks: [
      {
        weekIndex: 0,
        days: [
          {
            date: "2026-08-15",
            level: 1,
            totalTokens,
            turnCount: 1,
            toolCallCount: 0,
          },
        ],
      },
    ],
  };
}

function createServices(): IServiceAccessor {
  return {
    usageStatsService: {
      getAppUsageSnapshot: vi.fn(async ({ range }: { range: AppUsageRange }) =>
        createSnapshot({
          range,
          heatmap: range === "all" ? createOneDayHeatmap(99) : createOneDayHeatmap(10),
          summary: {
            ...createSnapshot().summary,
            totalTokens: range === "all" ? 20_650_000_000 : 389_000,
            totalSessions: 4,
            totalTurns: 8,
            activeDays: 1,
            favoriteModel:
              range === "all"
                ? null
                : {
                    modelId: "glm-5.3",
                    totalTokens: 280_080,
                    share: 0.72,
                  },
          },
        }),
      ),
    },
  } as unknown as IServiceAccessor;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AppUsageLifetimeSummaryStrip", () => {
  it("renders all-time app usage metrics independent of the selected range", () => {
    const html = renderToStaticMarkup(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(AppUsageLifetimeSummaryStrip, {
          snapshot: createSnapshot(),
        }),
      ),
    );

    expect(html).toContain("累计 Token 数");
    expect(html).toContain("峰值 Token 数");
    expect(html).toContain("最长聊天时长");
    expect(html).toContain("当前连续天数");
    expect(html).toContain("最长连续天数");
    expect(html).toContain("206.5 亿");
    expect(html).toContain("3.7 亿");
    expect(html).toContain("2 小时 15 分");
    expect(html).toContain("5 天");
    expect(html).toContain("34 天");
  });

  it("keeps the selected range for charts but removes the old range metric cards", async () => {
    await Promise.all([
      import("@/settings/usage-stats/AppUsageDailyModelTrendChart.js"),
      import("@/settings/usage-stats/AppUsageModelUsagePieChart.js"),
    ]);
    render(
      createElement(
        ServiceProvider,
        { services: createServices() },
        createElement(CfIntlProvider, { initialLocale: "zh-CN" }, createElement(AppUsagePanel)),
      ),
    );

    await screen.findByText("累计 Token 数");
    await waitFor(
      () => {
        expect(screen.queryAllByText("正在统计中")).toHaveLength(0);
      },
      { timeout: 5000 },
    );

    const lifetimeTitle = screen.getByText("累计 Token 数");
    const tokenActivityTitle = screen.getByText("Token 活动");
    const rangeTitle = screen.getByText("时间范围");
    expect(
      lifetimeTitle.compareDocumentPosition(tokenActivityTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      tokenActivityTitle.compareDocumentPosition(rangeTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(rangeTitle).toBeTruthy();
    expect(document.body.innerHTML).toContain("99");
    const sevenDayTab = screen.getByText("Last 7 Days");
    const thirtyDayTab = screen.getByText("Last 30 Days");
    expect(sevenDayTab.getAttribute("aria-selected")).toBe("true");
    expect(thirtyDayTab.getAttribute("aria-selected")).toBe("false");
    expect(await screen.findByText("每日 Token 趋势图")).toBeTruthy();
    expect(screen.queryByText("趋势图")).toBeNull();
    expect(screen.queryByText("按天 Token 趋势")).toBeNull();
    expect(screen.queryByText("tokens 用量")).toBeNull();
    expect(screen.queryByText("会话数量")).toBeNull();
    expect(screen.queryByText("消息数量")).toBeNull();
    expect(screen.queryByText("活跃天数")).toBeNull();
    expect(screen.queryByText("最常用模型")).toBeNull();
  });
});
