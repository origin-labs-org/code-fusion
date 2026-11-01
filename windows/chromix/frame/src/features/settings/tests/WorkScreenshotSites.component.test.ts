import "$styles/global.css";
import { beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import WorkScreenshotSites from "../components/WorkScreenshotSites.svelte";

const native = vi.hoisted(() => ({ read: vi.fn(), change: vi.fn() }));
vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({ workScreenshotSites: native.read, workSetScreenshotSite: native.change });
});
const PROFILE = "00000000000000000000000001";
const ORIGIN = "https://app.example.test:8443";
const row = { origin: ORIGIN, name: "app.example.test", unconfirmed: false };
const reply = (sites = [row]) => ({ version: 1, profile: PROFILE, sites, error: null });
beforeEach(() => {
  native.read.mockReset();
  native.change.mockReset();
});

test("forgetting a screenshot origin waits for Rust and shows unconfirmed revocation as blocked", async () => {
  native.read.mockResolvedValue(reply());
  let settle: (value: ReturnType<typeof reply>) => void = () => {};
  native.change.mockImplementation(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  const screen = await render(WorkScreenshotSites, { profile: PROFILE });
  await expect.element(screen.getByRole("heading", { name: "app.example.test" })).toBeVisible();
  const forget = screen.getByRole("button", { name: "Ask next time" });
  await forget.click();
  expect(native.change).toHaveBeenCalledWith(PROFILE, { origin: ORIGIN, allow: false });
  await expect.element(forget).toBeDisabled();
  await expect.element(screen.getByRole("heading", { name: "app.example.test" })).toBeVisible();
  settle(reply([{ ...row, unconfirmed: true }]));
  await expect
    .element(screen.getByText("Couldn't confirm the change. Pictures stay off for this site."))
    .toBeVisible();
});

test("a different profile reply is not displayed as this profile's permission", async () => {
  native.read.mockResolvedValue({ ...reply(), profile: "00000000000000000000000002" });
  const screen = await render(WorkScreenshotSites, { profile: PROFILE });
  await expect.element(screen.getByRole("alert")).toBeVisible();
  await expect
    .element(screen.getByRole("heading", { name: "app.example.test" }))
    .not.toBeInTheDocument();
  expect(native.read).toHaveBeenCalledWith(PROFILE);
});
