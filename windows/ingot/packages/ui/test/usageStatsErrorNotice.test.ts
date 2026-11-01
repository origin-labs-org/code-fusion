// @vitest-environment jsdom

import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { UsageStatsErrorNotice } from "../src/settings/usage-stats/UsageStatsErrorNotice.js";

vi.mock("../src/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    locale: "en-US",
    intl: {
      formatMessage: ({ id }: { id: string }) => id,
    },
  }),
}));

vi.mock("../src/lib/settingsNavigation.js", () => ({
  setPendingSettingsSection: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

function renderNotice(error: string): string {
  return renderToStaticMarkup(
    createElement(UsageStatsErrorNotice, {
      error,
    } satisfies ComponentProps<typeof UsageStatsErrorNotice>),
  );
}

describe("UsageStatsErrorNotice Team Plan业务Error", () => {
  it("Original text展示企业主账NumberPermissionsError并Retain业务StatusNotice", () => {
    const html = renderNotice("仅企业主账Number可Query企业SummaryData");

    expect(html).toContain("仅企业主账Number可Query企业SummaryData");
    expect(html).not.toContain("usage.error.stats.generic");
    expect(html).toContain("lucide-info");
    expect(html).toContain("text-warning");
    expect(html).not.toContain("settings.usage.checkApiKey");
  });

  it("Original text展示Team API Key 创建Failed msg，即使包含授权Character样也不走 credential 翻译", () => {
    const html = renderNotice("您当前暂无有效的团队套餐授权记录，无法创建API Key");

    expect(html).toContain("您当前暂无有效的团队套餐授权记录，无法创建API Key");
    expect(html).not.toContain("usage.error.stats.credential");
    expect(html).not.toContain("settings.usage.checkApiKey");
    expect(html).toContain("lucide-info");
  });

  it("凭据Error保持翻译Copy与Check API Key 入口", () => {
    const html = renderNotice("token expired");

    expect(html).toContain("usage.error.stats.credential");
    expect(html).toContain("settings.usage.checkApiKey");
    expect(html).not.toContain("token expired");
  });

  it("OtherError保持 generic Copy", () => {
    const html = renderNotice("Request timed out after 15000ms");

    expect(html).toContain("usage.error.stats.generic");
    expect(html).not.toContain("Request timed out after 15000ms");
  });
});
