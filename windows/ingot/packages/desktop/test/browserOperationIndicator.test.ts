import { describe, expect, it } from "vitest";
import {
  browserOperationResetsResizeBaseline,
  resolveBrowserOperationTabId,
} from "../src/main/browserView/browserOperationIndicator.js";

describe("browserOperationResetsResizeBaseline", () => {
  it("Only mark commands where the model actively opens, displays, activates, or changes the viewport", () => {
    expect(browserOperationResetsResizeBaseline({ method: "newTab" })).toBe(true);
    expect(browserOperationResetsResizeBaseline({ method: "activateTab", tabId: "tab-1" })).toBe(
      true,
    );
    expect(
      browserOperationResetsResizeBaseline({ method: "browserVisibilitySet", visible: true }),
    ).toBe(true);
    expect(
      browserOperationResetsResizeBaseline({ method: "browserVisibilitySet", visible: false }),
    ).toBe(false);
    expect(browserOperationResetsResizeBaseline({ method: "browserViewportSet" })).toBe(true);
    expect(browserOperationResetsResizeBaseline({ method: "browserViewportReset" })).toBe(true);
  });

  it("Ordinary Browser commands do not rebuild size baseline", () => {
    expect(browserOperationResetsResizeBaseline({ method: "navigate", tabId: "tab-1" })).toBe(
      false,
    );
    expect(browserOperationResetsResizeBaseline({ method: "playwright", tabId: "tab-1" })).toBe(
      false,
    );
    expect(browserOperationResetsResizeBaseline({ method: "screenshot", tabId: "tab-1" })).toBe(
      false,
    );
  });
});

describe("resolveBrowserOperationTabId", () => {
  it("uses an explicit tab id before command execution", () => {
    expect(resolveBrowserOperationTabId({ method: "navigate", tabId: "tab-1" })).toBe("tab-1");
  });

  it("uses the successful manager result for new/default-tab operations", () => {
    expect(
      resolveBrowserOperationTabId(
        { method: "newTab" },
        { ok: true, meta: { tabId: "tab-new" }, tab: { tabId: "tab-fallback" } },
      ),
    ).toBe("tab-new");
    expect(
      resolveBrowserOperationTabId(
        { method: "newTab" },
        { ok: true, tab: { tabId: "tab-fallback" } },
      ),
    ).toBe("tab-fallback");
  });

  it("does not invent an operation target for failed or tabless commands", () => {
    expect(
      resolveBrowserOperationTabId(
        { method: "newTab" },
        { ok: false, meta: { tabId: "tab-failed" } },
      ),
    ).toBeUndefined();
    expect(resolveBrowserOperationTabId({ method: "list" }, { ok: true })).toBeUndefined();
  });
});
