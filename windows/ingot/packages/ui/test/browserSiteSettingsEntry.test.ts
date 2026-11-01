// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BrowserSiteSettingsEntry } from "@/browser-use/BrowserSiteSettingsEntry.js";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(cleanup);

function renderEntry(onOpenSettings?: (origin: string) => void) {
  return render(
    createElement(BrowserSiteSettingsEntry, {
      origin: "https://example.com",
      onOpenSettings,
    }),
  );
}

it("Click slider icon to expand site info popover, showing origin and permission settings entry", async () => {
  renderEntry();
  fireEvent.click(screen.getByTestId("browser-permission-trigger"));
  expect(await screen.findByTestId("browser-permission-popover")).toBeTruthy();
  expect(screen.getByTestId("browser-permission-origin").textContent).toBe("https://example.com");
  expect(screen.getByTestId("browser-permission-open-settings")).toBeTruthy();
});

it("Close modal before invoking callback after clicking permission settings (otherwise portal content collapses to top-left when trigger hides with tab)", async () => {
  const onOpenSettings = vi.fn();
  renderEntry(onOpenSettings);
  fireEvent.click(screen.getByTestId("browser-permission-trigger"));
  expect(await screen.findByTestId("browser-permission-popover")).toBeTruthy();
  fireEvent.click(screen.getByTestId("browser-permission-open-settings"));
  expect(onOpenSettings).toHaveBeenCalledWith("https://example.com");
  await waitFor(() => expect(screen.queryByTestId("browser-permission-popover")).toBeNull());
});

it("Disable permission settings entry when no callback is provided", async () => {
  renderEntry(undefined);
  fireEvent.click(screen.getByTestId("browser-permission-trigger"));
  expect((await screen.findByTestId("browser-permission-open-settings")).disabled).toBe(true);
});
