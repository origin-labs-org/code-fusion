// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EmbeddedBrowserSitePermissionsSnapshot } from "@origin-ai/cf-shared";
import { BrowserSitePermissionsPage } from "@/browser-use/BrowserSitePermissionsPage.js";

const h = vi.hoisted(() => ({
  platform: {
    getEmbeddedBrowserSitePermissions: vi.fn(),
    setEmbeddedBrowserSitePermission: vi.fn(),
    resetEmbeddedBrowserSitePermission: vi.fn(),
  },
}));
vi.mock("@/hooks/usePlatform.js", () => ({ usePlatform: () => h.platform }));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
const origin = "https://site.test";

beforeEach(() => {
  vi.resetAllMocks();
  h.platform.getEmbeddedBrowserSitePermissions.mockResolvedValue({});
});
afterEach(cleanup);

async function openPage() {
  render(createElement(BrowserSitePermissionsPage, { origin, isVisible: true }));
  await waitFor(() =>
    expect(screen.getByTestId("browser-permission-reset")).toHaveProperty("disabled", false),
  );
}

it("Render entire table by capability catalog, mapping persisted allow/deny to initial dropdown values, and unrecorded to ask", async () => {
  const snapshot: EmbeddedBrowserSitePermissionsSnapshot = {
    [origin]: { geolocation: "allow", notifications: "deny" },
  };
  h.platform.getEmbeddedBrowserSitePermissions.mockResolvedValue(snapshot);
  await openPage();
  expect(screen.getByText(origin)).toBeTruthy();
  expect(screen.getByText("browser.permission.media")).toBeTruthy();
  expect(screen.getByText("browser.permission.geolocation")).toBeTruthy();
  expect(
    screen.getByTestId("site-permission-setting-geolocation").getAttribute("data-permission-setting"),
  ).toBe("allow");
  expect(
    screen
      .getByTestId("site-permission-setting-notifications")
      .getAttribute("data-permission-setting"),
  ).toBe("block");
  expect(
    screen.getByTestId("site-permission-setting-midi").getAttribute("data-permission-setting"),
  ).toBe("ask");
});

it("Clicking retry after a failed reset resends the reset; on success, clears error and shows completion prompt", async () => {
  h.platform.resetEmbeddedBrowserSitePermission
    .mockRejectedValueOnce(new Error("disk full"))
    .mockResolvedValue({});
  await openPage();
  await act(async () => fireEvent.click(screen.getByTestId("browser-permission-reset")));
  expect(screen.queryByRole("alert")).not.toBeNull();
  expect(h.platform.resetEmbeddedBrowserSitePermission).toHaveBeenCalledTimes(1);
  await act(async () => fireEvent.click(screen.getByText("browser.permission.retry")));
  expect(h.platform.resetEmbeddedBrowserSitePermission).toHaveBeenCalledTimes(2);
  expect(h.platform.resetEmbeddedBrowserSitePermission).toHaveBeenLastCalledWith({ origin });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByTestId("browser-permission-reset-done")).not.toBeNull();
});

it("When reset succeeds but re-reading fails, retrying only reads and preserves the success state", async () => {
  await openPage();
  h.platform.getEmbeddedBrowserSitePermissions.mockRejectedValueOnce(new Error("read failed"));
  await act(async () => fireEvent.click(screen.getByTestId("browser-permission-reset")));
  expect(screen.queryByRole("alert")).not.toBeNull();
  expect(screen.queryByTestId("browser-permission-reset-done")).not.toBeNull();
  await act(async () => fireEvent.click(screen.getByText("browser.permission.retry")));
  expect(h.platform.resetEmbeddedBrowserSitePermission).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByTestId("browser-permission-reset-done")).not.toBeNull();
});

it("Show unsupported prompt and skip reading when platform capability is missing", async () => {
  const read = h.platform.getEmbeddedBrowserSitePermissions;
  h.platform.getEmbeddedBrowserSitePermissions = undefined as unknown as typeof read;
  try {
    render(
      createElement(BrowserSitePermissionsPage, { origin: "https://web.test", isVisible: true }),
    );
    await waitFor(() => expect(screen.getByText("browser.permission.unsupported")).toBeTruthy());
    expect(read).not.toHaveBeenCalled();
  } finally {
    h.platform.getEmbeddedBrowserSitePermissions = read;
  }
});
