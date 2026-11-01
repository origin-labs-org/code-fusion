import "$styles/global.css";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { preferences } from "$domain/preferences";
import { runtime } from "$domain/runtime";
import { updates } from "$domain/updates";
import AboutStage from "./AboutStage.svelte";

vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({
    aboutInfo: async () => ({ version: "1.0.1", os: "macOS 26.1.0", arch: "aarch64" }),
    updateStatus: async () => ({ state: "upToDate" }),
    settingGet: async () => null,
  });
});

const shots = "../../../../../target/look/about";
const settle = () => new Promise((done) => setTimeout(done, 450));

afterEach(() => {
  preferences.dispose();
  updates.dispose();
  runtime.dispose();
});

for (const mode of ["dark", "light"] as const)
  test(`About in ${mode}`, async () => {
    await page.viewport(1100, 1100);
    document.documentElement.dataset.theme = mode;
    await preferences.init();
    await runtime.init();
    const screen = await render(AboutStage);
    await expect.element(screen.getByText("Version 1.0.1")).toBeVisible();
    await settle();
    await page.screenshot({ path: `${shots}/about-${mode}.png` });
  });

test("About fits a narrow window", async () => {
  await page.viewport(420, 900);
  document.documentElement.dataset.theme = "dark";
  await preferences.init();
  await runtime.init();
  const screen = await render(AboutStage);
  await expect.element(screen.getByText("Version 1.0.1")).toBeVisible();
  await settle();
  await page.screenshot({ path: `${shots}/about-narrow.png` });
});
