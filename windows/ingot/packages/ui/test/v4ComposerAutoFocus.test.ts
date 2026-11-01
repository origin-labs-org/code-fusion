import { describe, expect, it } from "vitest";
import { resolveComposerAutoFocus } from "@/v4/composer/composerAutoFocus.js";

describe("resolveComposerAutoFocus", () => {
  const base = {
    autoFocusEnabled: true,
    disabled: false,
    isMobileViewport: false,
  };

  it("focuses immediately when enabled, editable and desktop", () => {
    expect(resolveComposerAutoFocus(base)).toBe("focus-now");
  });

  it("skips when the pane is not focused (autoFocusEnabled=false)", () => {
    expect(
      resolveComposerAutoFocus({ ...base, autoFocusEnabled: false }),
    ).toBe("skip");
  });

  it("skips on mobile viewport even when enabled and editable", () => {
    expect(
      resolveComposerAutoFocus({ ...base, isMobileViewport: true }),
    ).toBe("skip");
  });

  it("defers while the composer is disabled (session connecting)", () => {
    expect(resolveComposerAutoFocus({ ...base, disabled: true })).toBe(
      "defer",
    );
  });

  it("skip takes precedence over defer (unfocused + disabled → skip)", () => {
    expect(
      resolveComposerAutoFocus({
        autoFocusEnabled: false,
        disabled: true,
        isMobileViewport: false,
      }),
    ).toBe("skip");
  });

  it("mobile skip takes precedence over defer (mobile + disabled → skip)", () => {
    expect(
      resolveComposerAutoFocus({
        autoFocusEnabled: true,
        disabled: true,
        isMobileViewport: true,
      }),
    ).toBe("skip");
  });
});
