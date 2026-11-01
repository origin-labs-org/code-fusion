import { createServer, type Server } from "node:http";
import {
  TID_BROWSER_ADDRESS_INPUT,
  TID_BROWSER_PERMISSION_ALLOW_ALWAYS,
  TID_BROWSER_PERMISSION_DENY,
  TID_BROWSER_PERMISSION_PROMPTS,
  TID_BROWSER_REFRESH_BUTTON,
  TID_BROWSER_WEBVIEW,
} from "@origin-ai/cf-shared/test-ids";
import { clickTestIdByWebDriver } from "./helpers/desktop-app.js";
import { openFirstBrowserTab } from "./helpers/browser-side-pane.js";
import { prepareConversationE2E } from "./helpers/conversation-session.js";

const PERMISSION_TEST_PAGE = `<!doctype html><html><head><title>permission-test</title></head><body>
<h1>permission test page</h1>
<script>
  window.__permissionState = async (name) => {
    const status = await navigator.permissions.query({ name });
    return status.state;
  };
  window.__getUserMediaResult = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((track) => track.stop());
      return "ok";
    } catch (error) {
      return error && error.name ? error.name : "unknown";
    }
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

describe("Built-in browser permission default deny and confirmation bar four states", () => {
  let blockServer: { server: Server; origin: string };
  let allowServer: { server: Server; origin: string };

  afterEach(async function () {
    if (this.currentTest?.state !== "failed") return;
    console.info("[permission-e2e] camera diagnosis", {
      pageResult: await runInGuest("window.__mediaResult"),
      state: await runInGuest("window.__permissionState('camera')"),
    });
  });

  before(async () => {
    blockServer = await startPermissionTestServer();
    allowServer = await startPermissionTestServer();
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await Promise.all(
      [blockServer, allowServer].map(
        ({ server }) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
  });

  it("Default deny for unauthorized sites; Don't allow = deny once and prompt again; Allow = persist and do not prompt again", async function () {
    this.timeout(300_000);
    await prepareConversationE2E({ skipProvider: true });
    await openFirstBrowserTab();

    await navigateTo(blockServer.origin);
    expect(await runInGuest("window.__permissionState('camera')")).toBe("denied");

    await runInGuest(
      "void window.__getUserMediaResult().then((value) => { window.__mediaResult = value; })",
    );
    await waitForPermissionPrompt();
    await clickTestIdByWebDriver(TID_BROWSER_PERMISSION_DENY);
    await browser.waitUntil(
      async () => (await runInGuest("window.__mediaResult")) === "NotAllowedError",
      { timeout: 15_000, timeoutMsg: "getUserMedia should be rejected after clicking \"Don't Allow\"" },
    );
    await runInGuest(
      "void window.__getUserMediaResult().then((value) => { window.__mediaResult2 = value; })",
    );
    await waitForPermissionPrompt();
    await clickTestIdByWebDriver(TID_BROWSER_PERMISSION_DENY);

    await navigateTo(allowServer.origin);
    expect(await runInGuest("window.__permissionState('camera')")).toBe("denied");
    await runInGuest(
      "void window.__getUserMediaResult().then((value) => { window.__mediaResult = value; })",
    );
    await waitForPermissionPrompt();
    await clickTestIdByWebDriver(TID_BROWSER_PERMISSION_ALLOW_ALWAYS);
    await browser.waitUntil(
      async () => (await runInGuest("window.__permissionState('camera')")) === "granted",
      { timeout: 15_000, timeoutMsg: "permissions.query should be granted after \"Allow While Visiting This Site\"" },
    );
    await runInGuest(
      "void window.__getUserMediaResult().then((value) => { window.__mediaResult2 = value; })",
    );
    await browser.waitUntil(
      async () => {
        const result = await runInGuest("window.__mediaResult2");
        return result === "ok" || result === "NotFoundError";
      },
      { timeout: 15_000, timeoutMsg: "Second getUserMedia after allow should complete (ok or no device)" },
    );
    expect(await countPermissionPrompts()).toBe(0);
    await clickTestIdByWebDriver(TID_BROWSER_REFRESH_BUTTON);
    await browser.waitUntil(
      async () => (await runInGuest("window.__permissionState('camera')")) === "granted",
      { timeout: 15_000, timeoutMsg: "刷新后没有保留 camera 允许记录" },
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
  await browser.waitUntil(async () => (await runInGuest("document.title")) === "permission-test", {
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
      (element) =>
        element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0,
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

async function countPermissionPrompts(): Promise<number> {
  return browser.execute((testIdValue: string) => {
    return document.querySelectorAll(`[data-testid="${testIdValue}"]`).length;
  }, TID_BROWSER_PERMISSION_PROMPTS);
}

async function waitForPermissionPrompt(): Promise<void> {
  await browser.waitUntil(async () => (await countPermissionPrompts()) > 0, {
    timeout: 15_000,
    timeoutMsg: "权限确认条没有出现",
  });
}
