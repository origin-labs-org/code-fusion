import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CfTaskMeta } from "@origin-ai/cf-shared";
import zh from "@/i18n/locales/zh-CN.js";
import { WorkspaceLastActivity } from "@/WorkspaceHeaderSections/WorkspaceLastActivity.js";
vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }, values: Record<string, unknown> = {}) =>
        zh[id]!.replace(/\{(\w+)\}/g, (_, key) => String(values[key])),
    },
  }),
}));
afterEach(() => vi.useRealTimers());
describe("current task last activity", () => {
  it("uses current task updatedAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    expect(
      renderToStaticMarkup(
        createElement(WorkspaceLastActivity, { task: { updatedAt: 880_000 } as CfTaskMeta }),
      ),
    ).toContain("RecentEvents 2 minutes前");
  });
  it("prefers live activity over stored metadata", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const task = {
      updatedAt: 1,
      __cfSessionActivity: { lastActivityAt: 999_000 },
    } as unknown as CfTaskMeta;
    expect(renderToStaticMarkup(createElement(WorkspaceLastActivity, { task }))).toContain(
      "RecentEvents Just now",
    );
  });
  it("does not invent a timestamp for a missing task", () => {
    expect(renderToStaticMarkup(createElement(WorkspaceLastActivity, { task: null }))).toBe("");
  });
});
