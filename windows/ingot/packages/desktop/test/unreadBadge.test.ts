import { describe, expect, it, vi } from "vitest";
import {
  maxWindowUnreadCounts,
  parseWindowUnreadCount,
  resolveBadgeOverlayLabel,
  supportsAppUnreadBadge,
  syncUnreadBadgeForPlatform,
} from "../src/main/unreadBadge.js";

describe("unread badge", () => {
  it("Only accept non-negative integer reports for window unread count", () => {
    expect(parseWindowUnreadCount(0)).toBe(0);
    expect(parseWindowUnreadCount(3)).toBe(3);
    expect(parseWindowUnreadCount(-1)).toBeNull();
    expect(parseWindowUnreadCount(1.5)).toBeNull();
    expect(parseWindowUnreadCount("2")).toBeNull();
  });

  it("Multiple windows report the same global count; aggregate using max to prevent doubling from multiple main windows", () => {
    expect(
      maxWindowUnreadCounts(
        new Map([
          [1, 3],
          [2, 3],
          [3, 0],
        ]),
      ),
    ).toBe(3);
    expect(maxWindowUnreadCounts(new Map())).toBe(0);
  });

  it("Enable app-level badge only on macOS / Linux", () => {
    expect(supportsAppUnreadBadge("darwin")).toBe(true);
    expect(supportsAppUnreadBadge("linux")).toBe(true);
    expect(supportsAppUnreadBadge("win32")).toBe(false);
  });

  it("Badge overlay text: 0 to clear, 1-9 as-is, 10 and above collapsed to 9+", () => {
    expect(resolveBadgeOverlayLabel(0)).toBeNull();
    expect(resolveBadgeOverlayLabel(7)).toBe("7");
    expect(resolveBadgeOverlayLabel(9)).toBe("9");
    expect(resolveBadgeOverlayLabel(10)).toBe("9+");
    expect(resolveBadgeOverlayLabel(999)).toBe("9+");
    expect(resolveBadgeOverlayLabel(-3)).toBeNull();
  });

  it("Platform fork: macOS/Linux updates app badge without touching overlay", () => {
    const setBadgeCount = vi.fn();
    const applyOverlay = vi.fn();

    syncUnreadBadgeForPlatform({
      platform: "darwin",
      totalUnreadCount: 4,
      setBadgeCount,
      applyOverlay,
    });

    expect(setBadgeCount).toHaveBeenCalledWith(4);
    expect(applyOverlay).not.toHaveBeenCalled();
  });

  it("Platform fork: Windows updates overlay text without touching app badge", () => {
    const setBadgeCount = vi.fn();
    const applyOverlay = vi.fn();

    syncUnreadBadgeForPlatform({
      platform: "win32",
      totalUnreadCount: 3,
      setBadgeCount,
      applyOverlay,
    });

    expect(applyOverlay).toHaveBeenCalledWith("3");
    expect(setBadgeCount).not.toHaveBeenCalled();
  });

  it("Send null to remove overlay when Windows unread count drops to zero", () => {
    const applyOverlay = vi.fn();

    syncUnreadBadgeForPlatform({
      platform: "win32",
      totalUnreadCount: 0,
      setBadgeCount: vi.fn(),
      applyOverlay,
    });

    expect(applyOverlay).toHaveBeenCalledWith(null);
  });
});
