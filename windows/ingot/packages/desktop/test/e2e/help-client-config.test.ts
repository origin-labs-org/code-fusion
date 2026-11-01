import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { readSettings, seedSettings, waitForDefaultWorkspaceReady } from "./helpers/desktop-app.js";
import { writeE2EJsonFileAtomically } from "./helpers/e2e-atomic-json-file.js";
import {
  buildHelpBrowserFixture,
  readHelpFixture,
  startHelpConfigFixture,
} from "./helpers/help-client-config-fixture.js";

type DesktopBridge = {
  executeDesktopCommand(command: string): Promise<void>;
  canOpenCommunity(locale: "zh-CN" | "en-US"): Promise<boolean>;
  setApplicationLocale(locale: "zh-CN" | "en-US"): Promise<void>;
};

async function command(command: string) {
  await browser.execute(async (value) => {
    await (window as unknown as { cf: DesktopBridge }).cf.executeDesktopCommand(value);
  }, command);
}
async function available(locale: "zh-CN" | "en-US") {
  return browser.execute(
    async (value) => (window as unknown as { cf: DesktopBridge }).cf.canOpenCommunity(value),
    locale,
  );
}
async function english() {
  await browser.execute(async () => {
    await (window as unknown as { cf: DesktopBridge }).cf.setApplicationLocale("en-US");
  });
}

describe("Help configure client/configs", () => {
  let originalSettings: Awaited<ReturnType<typeof readSettings>>;
  let localPath: string;
  let originalLocal: string | undefined;
  let fixture: Awaited<ReturnType<typeof readHelpFixture>>;
  let server: Awaited<ReturnType<typeof startHelpConfigFixture>>;
  let external: Awaited<ReturnType<typeof browser.electron.mock>>;

  before(async () => {
    await waitForDefaultWorkspaceReady(30000);
    originalSettings = await readSettings();
    fixture = await readHelpFixture();
    const appPath = await browser.electron.execute((electron) => electron.app.getAppPath());
    if (!appPath.includes(".e2e-cache")) throw new Error(`Unexpected E2E app path: ${appPath}`);
    localPath = join(appPath, "../../config/default.json");
    originalLocal = await readFile(localPath, "utf8").catch(() => undefined);
    await seedSettings({ locale: "en-US", localePreference: "en-US" });
    await browser.refresh();
    await waitForDefaultWorkspaceReady(30000);
  });
  beforeEach(async () => {
    await english();
    await writeE2EJsonFileAtomically(localPath, fixture.local);
    external = await browser.electron.mock("shell", "openExternal");
    await external.mockResolvedValue(undefined);
    server = await startHelpConfigFixture(fixture.remote);
    await seedSettings({ cfEndpointOrigin: server.origin });
  });
  afterEach(async () => {
    await browser.keys("Escape");
    await browser.electron.restoreAllMocks();
    await seedSettings({ cfEndpointOrigin: originalSettings.cfEndpointOrigin });
    await server?.close();
  });
  after(async () => {
    if (originalLocal === undefined) await rm(localPath, { force: true });
    else await writeFile(localPath, originalLocal, "utf8");
    await seedSettings(originalSettings);
    await browser.execute(async (locale) => {
      await (window as unknown as { cf: DesktopBridge }).cf.setApplicationLocale(locale);
    }, originalSettings.locale ?? "en-US");
  });

  async function expectExternal(url: string) {
    await browser.waitUntil(
      async () => {
        try {
          await expect(external).toHaveBeenCalledWith(url);
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 10000, timeoutMsg: `未打开outer链 ${url}` },
    );
  }

  it("HC-01: Real help menu, language, and success cache", async () => {
    expect(await available("en-US")).toBe(true);
    await $('button[aria-label="Help"]').click();
    await $('//*[@role="menuitem" and contains(.,"User community")]').click();
    await expectExternal(fixture.remote.community_urls!["en-US"]!);
    expect(await available("zh-CN")).toBe(true);
    await browser.execute(async () => {
      await (window as unknown as { cf: DesktopBridge }).cf.setApplicationLocale("zh-CN");
    });
    await command("openCommunity");
    await expectExternal(fixture.remote.community_urls!["zh-CN"]!);
    const helpRequests = server.requests.filter((request) => !request.headers["x-request-id"]);
    expect(helpRequests).toHaveLength(1);
    const query = new URL(helpRequests[0]!.url, server.origin).searchParams;
    expect(query.get("app_version")).toBeTruthy();
    expect(query.get("platform")).toBe(`${process.platform}-${process.arch}`);
    expect(helpRequests[0]!.headers.authorization).toBeUndefined();
  });

  it("HC-02: Missing English only falls back to built-in English value", async () => {
    server.setConfig({ community_urls: { "zh-CN": fixture.remote.community_urls!["zh-CN"] } });
    expect(await available("en-US")).toBe(true);
    await command("openCommunity");
    await expectExternal(fixture.local.community_urls!["en-US"]!);
  });

  it("HC-03: false overrides local true and shows modal; new endpoint true opens form", async () => {
    await command("openFeedback");
    await $('[role="dialog"]').waitForDisplayed({ timeout: 10000 });
    await expect($('[role="dialog"]')).toHaveText(expect.stringContaining("Submit feedback"));
    if (process.platform === "linux") {
      const overlayTop = await browser.execute(() => {
        const overlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]');
        if (!overlay) throw new Error("Feedback modal overlay does not exist");
        return overlay.getBoundingClientRect().top;
      });
      expect(overlayTop).toBe(0);
    }
    await expect(external).not.toHaveBeenCalled();
    await browser.keys("Escape");
    const other = await startHelpConfigFixture({
      ...fixture.remote,
      feedback_use_external_form: true,
    });
    try {
      await seedSettings({ cfEndpointOrigin: other.origin });
      await command("openFeedback");
      await expectExternal(fixture.remote.feedback_url!);
      expect(other.requests).toHaveLength(1);
    } finally {
      await other.close();
    }
  });

  for (const failure of ["http", "business", "json"] as const) {
    it(`HC-04-${failure}: Failed回退、不CacheFailed、同 endpoint 恢复`, async () => {
      server.setFailure(failure);
      expect(await available("en-US")).toBe(true);
      await command("openCommunity");
      await expectExternal(fixture.local.community_urls!["en-US"]!);
      expect(server.requests.length).toBeGreaterThanOrEqual(2);
      server.setConfig(fixture.remote);
      await command("openCommunity");
      await expectExternal(fixture.remote.community_urls!["en-US"]!);
    });
  }

  it("HC-04-empty: Platform unavailable when neither remote nor built-in has current language", async () => {
    await writeE2EJsonFileAtomically(localPath, {});
    server.setConfig({});
    expect(await available("en-US")).toBe(false);
    expect(await available("zh-CN")).toBe(false);
  });

  it("HC-05: Narrow-screen Chromium Web parsing, concurrent caching, and re-request on page reload", async () => {
    const webServer = await startHelpConfigFixture(fixture.remote, await buildHelpBrowserFixture());
    const mainHandle = await browser.getWindowHandle();
    const existing = await browser.getWindowHandles();
    const id = await browser.electron.execute(async (electron, url) => {
      const win = new electron.BrowserWindow({
        width: 390,
        height: 844,
        show: false,
        webPreferences: { sandbox: true, nodeIntegration: false },
      });
      await win.loadURL(url);
      return win.id;
    }, webServer.origin);
    try {
      await browser.waitUntil(
        async () => (await browser.getWindowHandles()).length > existing.length,
        { timeout: 10000 },
      );
      const handle = (await browser.getWindowHandles()).find((item) => !existing.includes(item))!;
      await browser.switchToWindow(handle);
      const read = async () =>
        browser.execute(async () => {
          const help = (
            window as unknown as {
              helpFixture: {
                resolveWebCommunityUrl(
                  locale: string,
                  options: { endpointOrigin: string },
                ): Promise<string>;
              };
            }
          ).helpFixture;
          return Promise.all(
            ["zh-CN", "en-US"].map((locale) =>
              help.resolveWebCommunityUrl(locale, { endpointOrigin: location.origin }),
            ),
          );
        });
      expect(await read()).toEqual([
        fixture.remote.community_urls!["zh-CN"],
        fixture.remote.community_urls!["en-US"],
      ]);
      expect(webServer.requests).toHaveLength(1);
      expect(
        new URL(webServer.requests[0]!.url, webServer.origin).searchParams.has("platform"),
      ).toBe(false);
      webServer.setConfig({ community_urls: { "en-US": "https://example.com/E2E_WEB_CHANGED" } });
      expect((await read())[1]).toBe(fixture.remote.community_urls!["en-US"]);
      await browser.refresh();
      expect((await read())[1]).toBe("https://example.com/E2E_WEB_CHANGED");
      expect(webServer.requests).toHaveLength(2);
    } finally {
      await browser.electron.execute(
        (electron, windowId) => electron.BrowserWindow.fromId(windowId)?.destroy(),
        id,
      );
      await browser.switchToWindow(mainHandle);
      await webServer.close();
    }
  });
});
