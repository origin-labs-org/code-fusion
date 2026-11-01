import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "$styles/global.css";
import type { PageSiteStylesV1 } from "$shared/ipc/bindings";
import PageStyles from "../components/PageStyles.svelte";

const native = vi.hoisted(() => ({
  sites: [] as PageSiteStylesV1[],
  toggle: vi.fn(),
  remove: vi.fn(),
}));

const all = () => ({ version: 1, profile: "p1", sites: native.sites });

vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({
    pageStylesAll: async () => all(),
    pageStyleToggleFor: async (_p: string, site: string, style: string, enabled: boolean) => {
      native.toggle(site, style, enabled);
      native.sites = native.sites.map((row) => ({
        ...row,
        styles: row.styles.map((item) => (item.id === style ? { ...item, enabled } : item)),
      }));
      return all();
    },
    pageStyleRemoveFor: async (_p: string, site: string, style: string) => {
      native.remove(site, style);
      native.sites = native.sites
        .map((row) => ({ ...row, styles: row.styles.filter((item) => item.id !== style) }))
        .filter((row) => row.styles.length > 0);
      return all();
    },
  });
});
vi.mock("$domain/tabs", () => ({
  tabs: { profile: () => ({ id: "p1", name: "Alex", kind: "default" }) },
}));

afterEach(() => {
  delete document.documentElement.dataset.theme;
  vi.clearAllMocks();
});

test("a profile's page styles list by site, switch and go", async () => {
  native.sites = [
    {
      site: "nytimes.com",
      styles: [{ id: "a", summary: "Dark background, light text", enabled: true }],
    },
    { site: "wikipedia.org", styles: [{ id: "b", summary: "Text 18px", enabled: false }] },
  ];
  await page.viewport(640, 360);
  const screen = await render(PageStyles);
  screen.container.style.cssText = "inline-size:600px;padding:24px;background:var(--color-canvas)";
  await expect.element(screen.getByText("nytimes.com", { exact: true })).toBeVisible();
  for (const theme of ["dark", "light"]) {
    document.documentElement.dataset.theme = theme;
    await page
      .elementLocator(screen.container)
      .screenshot({ path: `../../../../../target/look/assist/settings-styles-${theme}.png` });
  }
  await screen.getByRole("switch", { name: "Page style for wikipedia.org" }).click();
  expect(native.toggle).toHaveBeenCalledWith("wikipedia.org", "b", true);
  await screen.getByRole("button", { name: "Remove the style for nytimes.com" }).click();
  expect(native.remove).toHaveBeenCalledWith("nytimes.com", "a");
  await expect.element(screen.getByText("nytimes.com", { exact: true })).not.toBeInTheDocument();
});
