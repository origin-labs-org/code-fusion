import { describe, expect, it } from "vitest";
import {
  BROWSER_TAB_LIMIT,
  selectBrowserTabLimitVictim,
  type BrowserTabResidencyCandidate,
} from "../src/main/browserView/browserTabResidencyPolicy.js";

function candidate(
  tabId: string,
  overrides: Partial<BrowserTabResidencyCandidate> = {},
): BrowserTabResidencyCandidate {
  return {
    tabId,
    windowId: 1,
    sessionId: "task-a",
    residency: "live-background",
    guestAttached: true,
    openedAt: 1,
    lastActivityAt: 1,
    lastSelectedAt: null,
    preferred: false,
    currentTask: false,
    selected: false,
    visible: false,
    operationActive: false,
    captureActive: false,
    audible: false,
    mediaActive: false,
    loading: false,
    downloadActive: false,
    ...overrides,
  };
}

describe("Browser tab residency policy", () => {
  it("BTL04: Ignore task/preferred identity and pick oldest victim when the 33rd logical tab appears", () => {
    const tabs = Array.from({ length: BROWSER_TAB_LIMIT + 1 }, (_, index) =>
      candidate(`tab-${String(index).padStart(2, "0")}`, {
        openedAt: index + 2,
        lastActivityAt: index + 2,
      }),
    );
    tabs[0] = candidate("oldest-preferred-within-former-protection-window", {
      lastActivityAt: 0,
      lastSelectedAt: 19_999,
      preferred: true,
    });
    tabs[1] = candidate("current-task-secondary", {
      currentTask: true,
      lastActivityAt: 1,
    });

    expect(
      selectBrowserTabLimitVictim(tabs, {
        windowId: 1,
      })?.tabId,
    ).toBe("oldest-preferred-within-former-protection-window");
  });

  it("BTL04: preferred tab no longer receives permanent protection even if just selected", () => {
    const tabs = Array.from({ length: BROWSER_TAB_LIMIT + 1 }, (_, index) =>
      candidate(`tab-${index}`, {
        openedAt: index,
        lastActivityAt: index,
        lastSelectedAt: 20_000 + index,
        preferred: true,
      }),
    );

    expect(
      selectBrowserTabLimitVictim(tabs, {
        windowId: 1,
      })?.tabId,
    ).toBe("tab-0");
  });

  it("BTL05: Temporarily exceed limit when all candidates are under running-state protection", () => {
    const protectedTabs = Array.from({ length: BROWSER_TAB_LIMIT + 1 }, (_, index) =>
      candidate(`protected-${index}`, { operationActive: true }),
    );

    expect(
      selectBrowserTabLimitVictim(protectedTabs, {
        windowId: 1,
      }),
    ).toBeNull();
  });

  it("Protect tabs that are visible, selected, interacting, capturing, playing audio, playing media, loading, and downloading", () => {
    const protectedVariants: Array<Partial<BrowserTabResidencyCandidate>> = [
      { visible: true, residency: "live-visible" },
      { selected: true },
      { operationActive: true },
      { captureActive: true },
      { audible: true },
      { mediaActive: true },
      { loading: true },
      { downloadActive: true },
      { residency: "restoring" },
    ];
    const tabs = [
      ...protectedVariants.map((overrides, index) => candidate(`protected-${index}`, overrides)),
      ...Array.from({ length: BROWSER_TAB_LIMIT + 1 }, (_, index) =>
        candidate(`eligible-${index}`, { lastActivityAt: index }),
      ),
    ];

    expect(
      selectBrowserTabLimitVictim(tabs, {
        windowId: 1,
      })?.tabId,
    ).toBe("eligible-0");
  });

  it("Count independently per BrowserWindow; visible tabs also count toward logical tab limit", () => {
    const firstWindow = Array.from({ length: BROWSER_TAB_LIMIT - 1 }, (_, index) =>
      candidate(`first-${index}`),
    );
    const secondWindow = Array.from({ length: BROWSER_TAB_LIMIT }, (_, index) =>
      candidate(`second-${index}`, { windowId: 2 }),
    );
    const visible = candidate("visible", {
      residency: "live-visible",
      selected: true,
      visible: true,
    });

    expect(
      selectBrowserTabLimitVictim([...firstWindow, ...secondWindow, visible], {
        windowId: 1,
      }),
    ).toBeNull();
    expect(
      selectBrowserTabLimitVictim(
        [...firstWindow, ...secondWindow, { ...visible, tabId: "visible-2", windowId: 2 }],
        {
          windowId: 2,
        },
      )?.tabId,
    ).toBe("second-0");
  });

  it("BTL20: suspended or detached logical shells still count toward limit and can become oldest victims", () => {
    const tabs = [
      candidate("suspended-oldest", {
        residency: "suspended",
        guestAttached: false,
        openedAt: 0,
        lastActivityAt: 0,
      }),
      candidate("live-a", { openedAt: 1, lastActivityAt: 1 }),
      candidate("live-b", { openedAt: 2, lastActivityAt: 2 }),
    ];

    expect(
      selectBrowserTabLimitVictim(tabs, {
        tabLimit: 2,
        windowId: 1,
      })?.tabId,
    ).toBe("suspended-oldest");
  });
});
