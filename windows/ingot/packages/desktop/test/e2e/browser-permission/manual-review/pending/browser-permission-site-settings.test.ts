import { createServer, type Server } from "node:http";
import {
  TID_BROWSER_ADDRESS_INPUT,
  TID_BROWSER_REFRESH_BUTTON,
  TID_BROWSER_WEBVIEW,
} from "@origin-ai/cf-shared/test-ids";
import { clickTestIdByWebDriver } from "../../../helpers/desktop-app.js";
import { openFirstBrowserTab } from "../../../helpers/browser-side-pane.js";
import { prepareConversationE2E } from "../../../helpers/conversation-session.js";

const PERMISSION_TEST_PAGE = `<!doctype html><html><head><title>permission-settings-test</title></head><body>
<h1>permission settings test page</h1>
<script>
  window.__permissionState = async (name) => {
    const status = await navigator.permissions.query({ name });
    return status.state;
  };
</script>
</body></html>`;

async function startPermissionTestServer(): Promise<{ server: Server; origin: string }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(PERMISSION_TEST_PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("permission test server did not bind a port");
  }
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

describe("Site permissions settings tab: Address bar entry point and itemized modification", () => {
  let testServer: { server: Server; origin: string };

  before(async () => {
    testServer = await startPermissionTestServer();
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await new Promise<void>((resolve) => {
      testServer.server.close(() => resolve());
    });
  });

  it("Slider entry opens settings tab; takes effect immediately when allowed, reverts to ask after reset", async function () {
    this.timeout(300_000);
    await prepareConversationE2E({ skipProvider: true });
    await openFirstBrowserTab();
    await navigateTo(testServer.origin);

    expect(await runInGuest("window.__permissionState('geolocation')")).toBe("denied");

    await clickTestIdByWebDriver("browser-permission-trigger");
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => !!document.querySelector('[data-testid="browser-permission-popover"]'),
        )),
      { timeout: 10_000, timeoutMsg: "Site information bubble did not appear" },
    );
    await clickTestIdByWebDriver("browser-permission-open-settings");

    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => !!document.querySelector('[data-testid="browser-site-permissions"]'),
        )),
      { timeout: 15_000, timeoutMsg: "Site permissions settings tab did not appear" },
    );
    const originText = await browser.execute(
      () => document.querySelector('[data-testid="browser-site-permissions"] h1')?.textContent,
    );
    expect(originText).toBe(testServer.origin);

    await clickTestIdByWebDriver("site-permission-setting-geolocation");
    await clickTestIdByWebDriver("site-permission-option-allow");
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => !!document.querySelector('[data-testid="browser-permission-saved"]'),
        )),
      { timeout: 10_000, timeoutMsg: "Save prompt did not appear" },
    );
    await browser.waitUntil(
      async () => (await runInGuest("window.__permissionState('geolocation')")) === "granted",
      { timeout: 15_000, timeoutMsg: "permissions.query should be granted after allowing in settings page" },
    );

    await clickTestIdByWebDriver("browser-permission-reset");
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => !!document.querySelector('[data-testid="browser-permission-reset-done"]'),
        )),
      { timeout: 10_000, timeoutMsg: "Reset complete prompt did not appear" },
    );
    await browser.waitUntil(
      async () => (await runInGuest("window.__permissionState('geolocation')")) === "denied",
      { timeout: 15_000, timeoutMsg: "permissions.query should return to denied after reset" },
    );
  });
});

async function navigateTo(origin: string): Promise<void> {
  const addressInput = await $(`[data-testid="${TID_BROWSER_ADDRESS_INPUT}"]`);
  await addressInput.setValue(origin);
  await browser.keys("Enter");
  await browser.waitUntil(
    () =>
      browser.execute((refreshTestId: string) => {
        const refresh = document.querySelector<HTMLButtonElement>(
          `[data-testid="${refreshTestId}"]`,
        );
        return !!refresh && !refresh.disabled;
      }, TID_BROWSER_REFRESH_BUTTON),
    { timeout: 30_000, timeoutMsg: `Built-inBrowser没有加载完 ${origin}` },
  );
  await browser.waitUntil(async () => (await runInGuest("document.title")) === "permission-settings-test", {
    timeout: 15_000,
    timeoutMsg: "Test page script not ready",
  });
}

async function readBrowserGuestWebContentsId(): Promise<number> {
  const webContentsId = await browser.execute((testIdValue: string) => {
    const webviews = Array.from(
      document.querySelectorAll<HTMLElement & { getWebContentsId?: () => number }>(
        `[data-testid="${testIdValue}"]`,
      ),
    );
    const visible = webviews.findLast(
      (element) => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0,
    );
    const webview = visible ?? webviews.at(-1);
    return webview?.getWebContentsId?.() ?? null;
  }, TID_BROWSER_WEBVIEW);
  if (typeof webContentsId !== "number") {
    throw new Error("browser guest webview is not mounted yet");
  }
  return webContentsId;
}

async function runInGuest<T>(script: string): Promise<T> {
  const webContentsId = await readBrowserGuestWebContentsId();
  return browser.electron.execute(
    async (electron, guestId: number, code: string) => {
      const guest = electron.webContents.fromId(guestId);
      if (!guest || guest.isDestroyed()) {
        throw new Error("browser guest webContents is not available");
      }
      return guest.executeJavaScript(code) as Promise<unknown>;
    },
    webContentsId,
    script,
  ) as Promise<T>;
}
