// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme } from "@/useTheme.js";

beforeEach(() => {
  document.head.innerHTML = "";
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-cf-browser-theme-surface");
  document.documentElement.removeAttribute("style");
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("applyTheme", () => {
  it.each([
    ["cf-dark", "dark", "#161616"],
    ["cf-light", "light", "#f8f8f8"],
  ] as const)("把 %s 同步到已 opt-in 的BrowserTheme表面", (theme, resolvedTheme, background) => {
    document.documentElement.setAttribute("data-cf-browser-theme-surface", "light");
    document.documentElement.style.setProperty("--color-background", background);
    document.head.innerHTML = `
        <meta name="theme-color" content="#ffffff" />
        <meta name="color-scheme" content="light" />
      `;

    applyTheme(theme);

    expect(document.documentElement.getAttribute("data-cf-browser-theme-surface")).toBe(
      resolvedTheme,
    );
    expect(document.documentElement.style.colorScheme).toBe(resolvedTheme);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      background,
    );
    expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute("content")).toBe(
      resolvedTheme,
    );
  });

  it("system Mode用Browser偏OK同步同One份 resolved theme", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    document.documentElement.setAttribute("data-cf-browser-theme-surface", "light");
    document.documentElement.style.setProperty("--color-background", "#161616");

    applyTheme("system");

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("theme-cf-dark")).toBe(true);
    expect(document.documentElement.getAttribute("data-cf-browser-theme-surface")).toBe("dark");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      "#161616",
    );
    expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute("content")).toBe(
      "dark",
    );
  });

  it("未 opt-in 的 Electron Pages只切换既有Theme class", () => {
    applyTheme("cf-dark");

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("theme-cf-dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("");
    expect(document.querySelector('meta[name="theme-color"]')).toBeNull();
    expect(document.querySelector('meta[name="color-scheme"]')).toBeNull();
  });

  it("轻量 DOM shim 未提供Browser表面Capabilities时仍Retain既有 class 切换", () => {
    const toggle = vi.fn();
    vi.stubGlobal("document", {
      documentElement: {
        classList: { toggle },
      },
    });

    expect(() => applyTheme("cf-dark")).not.toThrow();
    expect(toggle).toHaveBeenCalledTimes(3);
  });
});
