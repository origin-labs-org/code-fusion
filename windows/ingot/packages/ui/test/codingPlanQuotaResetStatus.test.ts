// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodingPlanQuotaResetStatusContent } from "@/components/coding-plan-quota-reset/CodingPlanQuotaResetStatus.js";
import { burstCodingPlanQuotaResetConfetti } from "@/lib/codingPlanQuotaResetConfetti.js";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    locale: "zh-CN",
    intl: {
      formatMessage: ({ id }: { id: string }, values?: Record<string, string>) => {
        const messages: Record<string, string> = {
          "codingPlan.quotaReset.processing": "Resetting 5-hour quota…",
          "codingPlan.quotaReset.done": "5-hour quota reset",
          "codingPlan.quotaReset.completed": "已重置",
          "codingPlan.quotaReset.completedAt": `${values?.time ?? ""} Reset`,
        };
        return messages[id] ?? id;
      },
    },
  }),
}));

afterEach(() => {
  cleanup();
});

describe("CodingPlanQuotaResetStatusContent", () => {
  it("processing renders status hint copy", () => {
    render(createElement(CodingPlanQuotaResetStatusContent, { status: "processing" }));

    expect(screen.getByRole("status").textContent).toContain("Resetting 5-hour quota…");
  });

  it("completed renders reset status copy", () => {
    render(createElement(CodingPlanQuotaResetStatusContent, { status: "completed" }));

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("5-hour quota reset");
  });
});

describe("burstCodingPlanQuotaResetConfetti", () => {
  let originalAnimate: typeof Element.prototype.animate;

  beforeEach(() => {
    originalAnimate = Element.prototype.animate;
    Element.prototype.animate = vi.fn().mockReturnValue({
      finished: Promise.resolve(),
    }) as unknown as typeof Element.prototype.animate;
  });

  afterEach(() => {
    Element.prototype.animate = originalAnimate;
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("Do not trigger confetti when prefers-reduced-motion", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    const origin = document.createElement("div");

    burstCodingPlanQuotaResetConfetti(origin);

    expect(document.body.childElementCount).toBe(0);
    expect(Element.prototype.animate).not.toHaveBeenCalled();
  });

  it("Play particles from trigger when motion is allowed", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    const origin = document.createElement("div");

    burstCodingPlanQuotaResetConfetti(origin);

    expect(document.body.childElementCount).toBeGreaterThan(0);
    expect(Element.prototype.animate).toHaveBeenCalled();
  });
});
