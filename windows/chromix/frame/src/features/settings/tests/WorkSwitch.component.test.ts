import "$styles/global.css";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { preferences } from "$domain/preferences";
import * as settings from "../lib/settings-state.svelte";
import SettingsLookStage from "./SettingsLookStage.svelte";

const native = vi.hoisted(() => ({
  settings: {} as Record<string, string>,
  writes: [] as [string, string][],
  running: false,
}));
vi.mock("$domain/tabs", () => ({
  tabs: { profile: () => ({ id: "00000000000000000000000001", kind: "regular" }) },
}));
vi.mock("$shared/ipc/bindings", async () => {
  const known: Record<string, (...args: never[]) => Promise<unknown>> = {
    settingGet: async (key: string) => native.settings[key] ?? null,
    settingSet: async (key: string, value: string) => {
      native.writes.push([key, value]);
      native.settings[key] = value;
      return { accepted: true, operation_id: null };
    },
    keymapEntries: async () => [],
    workRunning: async () => native.running,
  };
  return {
    commands: new Proxy(known, {
      get: (target, key) =>
        typeof key === "string" ? (target[key] ?? (async () => null)) : undefined,
    }),
  };
});

afterEach(() => {
  preferences.dispose();
  native.settings = {};
  native.writes = [];
  native.running = false;
});

const nav = () => page.getByRole("navigation", { name: "Settings" });

test("turning AI off in Features asks first, and Settings keeps only the Work page", async () => {
  await page.viewport(1280, 860);
  await preferences.init();
  settings.select("features");
  const screen = await render(SettingsLookStage);
  const toggle = screen.getByRole("switch", { name: "AI", exact: true });
  await expect.element(toggle).toHaveAttribute("aria-checked", "true");
  await expect.element(nav().getByRole("button", { name: "Models" })).toBeVisible();

  await toggle.click();
  const dialog = page.getByRole("dialog");
  await expect.element(dialog.getByText("Dictation")).toBeVisible();
  await expect.element(dialog.getByText("Work that’s running now stops.")).not.toBeInTheDocument();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(toggle).toHaveAttribute("aria-checked", "true");
  expect(native.writes).toEqual([]);

  native.running = true;
  await toggle.click();
  await expect.element(dialog.getByText("Work that’s running now stops.")).toBeVisible();
  await page.getByRole("button", { name: "Turn Off" }).click();
  await expect.element(toggle).toHaveAttribute("aria-checked", "false");
  expect(native.writes).toEqual([["ai.enabled", "false"]]);
  for (const name of ["Models", "Skills", "Memory", "Site access", "Connections"])
    await expect.element(nav().getByRole("button", { name, exact: true })).not.toBeInTheDocument();
  await expect.element(nav().getByRole("button", { name: "Work", exact: true })).toBeVisible();
  await expect
    .element(screen.getByRole("switch", { name: "Let Work look at pages" }))
    .not.toBeInTheDocument();

  // A section that left with Work opens the Work page instead.
  settings.select("ai");
  await expect.element(screen.getByRole("heading", { level: 1, name: "Work" })).toBeVisible();
  settings.select("features");

  await toggle.click();
  await expect.element(toggle).toHaveAttribute("aria-checked", "true");
  expect(native.writes.at(-1)).toEqual(["ai.enabled", "true"]);
  await expect.element(nav().getByRole("button", { name: "Models" })).toBeVisible();
});
