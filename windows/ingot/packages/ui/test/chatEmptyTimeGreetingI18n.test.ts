import { describe, expect, it } from "vitest";
import { resolveGreetingFontSizePx } from "@/v4/ConversationDraftEmptyState.js";

describe("chat empty time greeting i18n", () => {
  it("Title shrinks in 1px steps only when its text is genuinely squeezed horizontally", () => {
    expect(
      resolveGreetingFontSizePx({
        availableWidthPx: 406,
        naturalTextWidthPx: 360,
      }),
    ).toBe(30);
    expect(
      resolveGreetingFontSizePx({
        availableWidthPx: 359,
        naturalTextWidthPx: 360,
      }),
    ).toBe(29);
    expect(
      resolveGreetingFontSizePx({
        availableWidthPx: 300,
        naturalTextWidthPx: 360,
      }),
    ).toBe(25);
    expect(
      resolveGreetingFontSizePx({
        availableWidthPx: 120,
        naturalTextWidthPx: 360,
      }),
    ).toBe(20);
  });

  it("Retains default font size instead of shrinking with window when title measurement is unavailable", () => {
    expect(
      resolveGreetingFontSizePx({
        availableWidthPx: 0,
        naturalTextWidthPx: 360,
      }),
    ).toBe(30);
    expect(
      resolveGreetingFontSizePx({
        availableWidthPx: 406,
        naturalTextWidthPx: Number.NaN,
      }),
    ).toBe(30);
  });

  it("Mobile remote control keeps original 20px compact title without desktop adaptive measurement", () => {
    expect(
      resolveGreetingFontSizePx({
        availableWidthPx: 406,
        naturalTextWidthPx: 360,
        compactForRemoteControl: true,
      }),
    ).toBe(20);
  });
});
