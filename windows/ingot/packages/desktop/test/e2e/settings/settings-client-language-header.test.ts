import { fileURLToPath } from "node:url";
import {
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_LOCALE_SELECT_ITEM,
  TID_SETTINGS_LOCALE_SELECT_TRIGGER,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  clickTestIdByDom,
  clickTestIdByWebDriver,
  quitElectronAppGracefully,
  readSettings,
  seedSettings,
  waitForDefaultWorkspaceReady,
  waitForWorkspaceApp,
} from "../helpers/desktop-app.js";
import { startHelpConfigFixture } from "../helpers/help-client-config-fixture.js";
import { openFaultInjectedHostWindow } from "../helpers/subagent-host-window.js";

type Locale = "zh-CN" | "en-US";
type HelpServer = Awaited<ReturnType<typeof startHelpConfigFixture>>;
type Request = HelpServer["requests"][number];

const HELP_MENU_TRIGGER = 'button[data-testid="workspace-help-menu-trigger"]';
const PERSISTED: Locale = "en-US";
const SWITCHED: Locale = "zh-CN";
const HOST_PRELOAD = fileURLToPath(new URL("../helpers/subagent-host-faults.cjs", import.meta.url));

// spec：docs/cf-endpoint-client-language-header.md。
const isHost = (request: Request) => Boolean(request.headers["x-request-id"]);
function expectLanguage(requests: Request[], locale: Locale) {
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.map((request) => request.headers["x-client-language"])).toEqual(
    requests.map(() => locale),
  );
}

describe("CodeFusion endpoint X-Client-Language 跟随界面语言", () => {
  let external: Awaited<ReturnType<typeof browser.electron.mock>>;
  const servers: HelpServer[] = [];

  async function mockExternal() {
    external = await browser.electron.mock("shell", "openExternal");
    await external.mockResolvedValue(undefined);
  }
  afterEach(async () => {
    await browser.keys("Escape");
    await browser.electron.restoreAllMocks();
  });
  after(async () => {
    for (const server of servers) await server.close();
    await clearAppData();
  });

  async function startServer() {
    const server = await startHelpConfigFixture({
      community_urls: {
        "zh-CN": "https://example.com/E2E_CLIENT_LANGUAGE_ZH",
        "en-US": "https://example.com/E2E_CLIENT_LANGUAGE_EN",
      },
    });
    servers.push(server);
    return server;
  }

  
  async function openHelpMenuForHostRequests(server: HelpServer) {
    const before = server.requests.filter(isHost).length;
    await $(HELP_MENU_TRIGGER).click();
    await browser.waitUntil(async () => server.requests.filter(isHost).length > before, {
      timeout: 15000,
      timeoutMsg: "打开帮助菜单后 Host 没有请求 client/configs",
    });
    await browser.keys("Escape");
    return server.requests.filter(isHost).slice(before);
  }

  async function openCommunityForMainRequests(server: HelpServer) {
    const before = server.requests.filter((request) => !isHost(request)).length;
    await browser.execute(async () => {
      await (
        window as unknown as { cf: { executeDesktopCommand(command: string): Promise<void> } }
      ).cf.executeDesktopCommand("openCommunity");
    });
    await browser.waitUntil(
      async () => server.requests.filter((request) => !isHost(request)).length > before,
      { timeout: 15000, timeoutMsg: "openCommunity 后 Main 没有请求帮助配置" },
    );
    return server.requests.filter((request) => !isHost(request)).slice(before);
  }

  async function selectLocaleInSettings(locale: Locale) {
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
      timeout: 15000,
      timeoutMsg: "Could not find settings entry button",
    });
    await $(`[data-testid="${TID_SETTINGS_PAGE}"]`).waitForDisplayed({ timeout: 15000 });
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "general"), {
      timeout: 15000,
      timeoutMsg: "设置页没有出现通用分区入口",
    });
    await clickTestIdByWebDriver(TID_SETTINGS_LOCALE_SELECT_TRIGGER, {
      timeout: 15000,
      timeoutMsg: "界面语言下拉触发器没有出现",
    });
    await clickTestIdByDom(testId(TID_SETTINGS_LOCALE_SELECT_ITEM, locale), {
      timeout: 15000,
      timeoutMsg: `UI Language下拉项没有出现: ${locale}`,
    });
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
      timeout: 15000,
      timeoutMsg: "设置页没有返回按钮",
    });
  }

  it("CLH-01: 重启后启动预热、Host 与 Main 的请求都使用持久化界面语言", async function () {
    this.timeout(120000);
    await waitForDefaultWorkspaceReady(30000);
    const server = await startServer();
    await quitElectronAppGracefully();
    await seedSettings({
      locale: PERSISTED,
      localePreference: PERSISTED,
      cfEndpointOrigin: server.origin,
      lastWorkspaceSession: [
        { kind: "local", workspacePath: DEFAULT_WORKSPACE, workspacePurpose: "project" },
      ],
      lastActiveTabIndex: 0,
    });
    await browser.reloadSession();
    await waitForDefaultWorkspaceReady(30000);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30000);
    await mockExternal();

    await browser.waitUntil(async () => server.requests.some((request) => !isHost(request)), {
      timeout: 15000,
      timeoutMsg: "启动后 Main 没有发出 client/configs 灰度预热",
    });
    expectLanguage(
      server.requests.filter((request) => !isHost(request)),
      PERSISTED,
    );

    expectLanguage(await openHelpMenuForHostRequests(server), PERSISTED);
  });

  it("CLH-02: 语言写入失败时，切换仍实时到达 Main 与每个窗口的 Host", async function () {
    this.timeout(150000);
    await mockExternal();
    const firstHandle = await browser.getWindowHandle();
    const second = await openFaultInjectedHostWindow(HOST_PRELOAD, {
      CF_E2E_FS_FAULTS: JSON.stringify([
        {
          id: "client-language-settings-write",
          code: "EACCES",
          operations: ["writeFile"],
          pathEndsWith: "setting.json",
          maxMatches: 0,
        },
      ]),
    });
    try {
      await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30000);
      await selectLocaleInSettings(SWITCHED);
      await expect($(HELP_MENU_TRIGGER)).toHaveAttribute("aria-label", "帮助");

      const server = await startServer();
      await seedSettings({ cfEndpointOrigin: server.origin });

      expectLanguage(await openHelpMenuForHostRequests(server), SWITCHED);
      await browser.switchToWindow(firstHandle);
      expectLanguage(await openHelpMenuForHostRequests(server), SWITCHED);
      expectLanguage(await openCommunityForMainRequests(server), SWITCHED);
      expect((await readSettings()).locale).toBe(PERSISTED);
    } finally {
      await browser.electron.execute(
        (electron, id) => electron.BrowserWindow.fromId(id)?.destroy(),
        second.windowId,
      );
      await browser.switchToWindow(firstHandle);
    }
  });
});
