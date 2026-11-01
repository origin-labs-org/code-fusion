import "$styles/global.css";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import WorkWebsiteData from "../components/WorkWebsiteData.svelte";

const native = vi.hoisted(() => ({ clear: vi.fn() }));
vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({ workClearWebsiteData: native.clear });
});

const PROFILE = "00000000000000000000000001";

test("clearing asks first, then clears only Work's data for the profile", async () => {
  await page.viewport(1200, 800);
  native.clear.mockResolvedValue(true);
  const screen = await render(WorkWebsiteData, { profile: PROFILE });

  await screen.getByRole("button", { name: "Clear…" }).click();
  expect(native.clear).not.toHaveBeenCalled();
  await expect.element(screen.getByText(/will forget cookies, solved checks/)).toBeVisible();

  await screen.getByRole("button", { name: "Clear data" }).click();

  expect(native.clear).toHaveBeenCalledWith(PROFILE);
  await expect.element(screen.getByText("Work's website data cleared.")).toBeVisible();
});

test("a refused clear keeps the confirmation and says so", async () => {
  await page.viewport(1200, 800);
  native.clear.mockResolvedValue(false);
  const screen = await render(WorkWebsiteData, { profile: PROFILE });

  await screen.getByRole("button", { name: "Clear…" }).click();
  await screen.getByRole("button", { name: "Clear data" }).click();

  await expect.element(screen.getByRole("alert")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Clear data" })).toBeVisible();
});
