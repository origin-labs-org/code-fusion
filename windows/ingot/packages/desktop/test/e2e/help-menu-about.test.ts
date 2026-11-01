import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PlatformChannels,
  type UpdateStatePayload,
  type UpdateCheckResultPayload,
} from "@origin-ai/cf-shared";
import {
  TID_WORKSPACE_HELP_MENU_TRIGGER,
  TID_TASK_SETTINGS_BUTTON,
  TID_SETTINGS_PAGE,
} from "@origin-ai/cf-shared/test-ids";
import {
  DEFAULT_WORKSPACE,
  clickTestIdByWebDriver,
  waitForWorkspaceApp,
  seedSettings,
  readSettings,
} from "./helpers/desktop-app.js";
import { startHelpConfigFixture } from "./helpers/help-client-config-fixture.js";

const expectedFlavor = process.env.CF_E2E_HELP_MENU_FLAVOR ?? "preview";
if (expectedFlavor !== "production" && expectedFlavor !== "preview") {
  throw new Error("Please set CF_E2E_HELP_MENU_FLAVOR=production or preview, and build the corresponding product identity");
}
const production = expectedFlavor === "production";

async function enterWorkspace() {
  await browser.waitUntil(
    async () => {
      if (await $('[data-testid="onboarding-page"]').isDisplayed()) await browser.keys("Escape");
      return $(`[data-testid="${TID_TASK_SETTINGS_BUTTON}"]`).isExisting();
    },
    { timeout: 30_000, timeoutMsg: "首次使用引导关闭后未进入工作区" },
  );
  await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);
}

async function publishState(state: UpdateStatePayload) {
  await browser.electron.execute(
    (electron, channel, payload) => {
      for (const window of electron.BrowserWindow.getAllWindows()) {
        if (window.webContents.getURL().includes("/renderer/index.html")) {
          window.webContents.send(channel, payload);
        }
      }
    },
    PlatformChannels.UpdateStateChanged,
    state,
  );
}
async function menuLabels() {
  return $$('[role="menuitem"]').map((item) => item.getText());
}
async function openMenu() {
  await browser.waitUntil(
    async () => {
      for (const trigger of await $$(`[data-testid="${TID_WORKSPACE_HELP_MENU_TRIGGER}"]`)) {
        if (await trigger.isDisplayed()) return true;
      }
      return false;
    },
    { timeout: 10_000, timeoutMsg: "帮助按钮尚未挂载到可见页面" },
  );
  const triggers = await $$(`[data-testid="${TID_WORKSPACE_HELP_MENU_TRIGGER}"]`);
  for (const trigger of triggers) {
    if (await trigger.isDisplayed()) {
      await trigger.waitForClickable();
      await trigger.click();
      break;
    }
  }
  await $('[role="menu"]').waitForDisplayed();
  await $('[role="menuitem"][aria-busy="true"]').waitForExist({ reverse: true });
}
async function closeMenu() {
  await browser.keys("Escape");
  await $('[role="menu"]').waitForDisplayed({ reverse: true });
}
async function setTheme(theme: "cf-light" | "cf-dark") {
  await browser.execute((value) => {
    const actions = (
      window as typeof window & { __testActions?: { setTheme?: (theme: string) => void } }
    ).__testActions;
    if (!actions?.setTheme) throw new Error("缺少主题测试入口");
    actions.setTheme(value);
  }, theme);
}
async function assertLogExport(label: string, pendingLabel: string) {
  const reveal = await browser.electron.mock("shell", "showItemInFolder");
  await reveal.mockReturnValue(undefined);
  try {
    await $(`[role="menuitem"]*=${label}`).click();
    await $('[role="menu"]').waitForDisplayed({ reverse: true });
    await browser.waitUntil(
      async () => {
        await reveal.update();
        return reveal.mock.calls.length === 1;
      },
      { timeout: 30_000, timeoutMsg: "Archive was not generated and system location was not requested after clicking Export Logs" },
    );
    const archivePath = String(reveal.mock.calls[0]?.[0]);
    expect(archivePath).toMatch(/cf-logs-[^/\\]+\.zip$/);
    const archive = await readFile(archivePath);
    expect(archive.subarray(0, 4).toString("hex")).toBe("504b0304");
    await browser.waitUntil(
      async () => !(await $("#cf-toast-host").getText()).includes(pendingLabel),
      { timeout: 10_000, timeoutMsg: "Prompt did not close after log export completed" },
    );
  } finally {
    await reveal.mockRestore();
  }
}
async function assertAboutWindow() {
  try {
    await browser.waitUntil(
      async () =>
        browser.electron.execute(async (electron) => {
          const window = electron.BrowserWindow.getAllWindows().find(
            (candidate) =>
              candidate.webContents.getURL().startsWith("data:text/html") &&
              decodeURIComponent(candidate.webContents.getURL()).includes('id="about-title"'),
          );
          if (!window?.isVisible()) return false;
          const title = await window.webContents.executeJavaScript(
            'document.querySelector("#about-title")?.textContent',
          );
          return (
            typeof title === "string" &&
            title.includes("CodeFusion") &&
            title.includes(electron.app.getVersion())
          );
        }),
      { timeout: 10_000, timeoutMsg: "About window did not display app name and version" },
    );
  } finally {
    await browser.electron.execute((electron) => {
      for (const window of electron.BrowserWindow.getAllWindows()) {
        if (
          window.webContents.getURL().startsWith("data:text/html") &&
          decodeURIComponent(window.webContents.getURL()).includes('id="about-title"')
        )
          window.close();
      }
    });
  }
}

describe(`QuestionNumber菜单应用入口（${expectedFlavor}）`, () => {
  let originalSettings: Awaited<ReturnType<typeof readSettings>>;
  let helpConfig: Awaited<ReturnType<typeof startHelpConfigFixture>>;
  before(async () => {
    await enterWorkspace();
    originalSettings = await readSettings();
    helpConfig = await startHelpConfigFixture({});
    await seedSettings({
      locale: "en-US",
      localePreference: "en-US",
      cfEndpointOrigin: helpConfig.origin,
    });
    await browser.refresh();
    await enterWorkspace();
  });
  afterEach(async () => {
    if (await $('[role="menu"]').isDisplayed()) await closeMenu();
    await publishState({ kind: "idle", enabled: true });
  });
  after(async () => {
    try {
      await seedSettings(originalSettings);
    } finally {
      await helpConfig?.close();
    }
  });

  it("HM-01 English draft menu order, export logs, and about window", async function () {
    this.timeout(60_000);
    await setTheme("cf-light");
    await openMenu();
    const labels = await menuLabels();
    expect(labels).toEqual([
      "Product docs",
      "User community",
      "Report an issue",
      "Request a feature",
      "Export logs",
      "Resource manager",
      ...(production ? ["Check for updates"] : []),
      "About CodeFusion",
    ]);
    expect(await $$('[role="menu"] [role="separator"]')).toHaveLength(1);
    await browser.saveScreenshot(join(tmpdir(), "cf-help-export-en-light.png"));
    await assertLogExport("Export logs", "Exporting logs...");
    await openMenu();
    await $('[role="menuitem"]*=About CodeFusion').click();
    await assertAboutWindow();
  });

  it("HM-02 Update status events, disabled state, and close/reopen", async function () {
    this.timeout(60_000);
    await openMenu();
    if (!production) {
      await publishState({ kind: "update-downloaded", enabled: true, version: "99.0.0" });
      expect((await menuLabels()).some((label) => label.includes("Restart to update"))).toBe(false);
      expect(await menuLabels()).not.toContain("Check for updates");
      await closeMenu();
      return;
    }
    for (const [state, label] of [
      [{ kind: "checking", enabled: false }, "Checking for updates..."],
      [{ kind: "update-available", enabled: true, version: "99.0.0" }, "Update available 99.0.0"],
      [{ kind: "download-progress", enabled: true, progress: "42%" }, "Downloading update... 42%"],
      [{ kind: "update-downloaded", enabled: true, version: "99.0.0" }, "Restart to update"],
    ] as const) {
      await publishState(state);
      const item = $(`[role="menuitem"]*=${label}`);
      await item.waitForDisplayed();
      if (state.kind === "update-downloaded") {
        await expect(item.$('[data-slot="badge"]')).toHaveText(state.version);
      }
      if (!state.enabled) await expect(item).toHaveAttribute("aria-disabled", "true");
      else expect(await item.getAttribute("aria-disabled")).not.toBe("true");
    }
    await closeMenu();
    await openMenu();
    const restartItem = $('[role="menuitem"]*=Restart to update');
    await expect(restartItem).toBeDisplayed();
    await expect(restartItem.$('[data-slot="badge"]')).toHaveText("99.0.0");
    await closeMenu();
    await publishState({ kind: "idle", enabled: true });
  });

  it("HM-03 production real check command receives dev package receipt, Preview has no entry", async function () {
    this.timeout(60_000);
    await openMenu();
    if (!production) {
      expect(await menuLabels()).not.toContain("Check for updates");
      await closeMenu();
      return;
    }
    expect(await browser.electron.execute((electron) => electron.app.isPackaged)).toBe(false);
    await browser.execute(() => {
      const target = window as unknown as {
        cf: {
          onUpdateCheckResult(callback: (payload: UpdateCheckResultPayload) => void): () => void;
        };
        __helpUpdateResult?: UpdateCheckResultPayload;
        __helpUpdateDispose?: () => void;
      };
      target.__helpUpdateResult = undefined;
      target.__helpUpdateDispose = target.cf.onUpdateCheckResult((payload) => {
        target.__helpUpdateResult = payload;
      });
    });
    try {
      await $('[role="menuitem"]*=Check for updates').click();
      await browser.waitUntil(
        async () =>
          (await browser.execute(
            () =>
              (window as unknown as { __helpUpdateResult?: UpdateCheckResultPayload })
                .__helpUpdateResult?.kind,
          )) === "dev-skipped",
        { timeout: 10_000, timeoutMsg: "检查更新未收到真实 main 的开发包回执" },
      );
    } finally {
      await browser.execute(() => {
        const target = window as unknown as {
          __helpUpdateDispose?: () => void;
          __helpUpdateResult?: UpdateCheckResultPayload;
        };
        target.__helpUpdateDispose?.();
        delete target.__helpUpdateDispose;
        delete target.__helpUpdateResult;
      });
    }
  });

  it("HM-04 Chinese settings page export logs, about, and update entries", async function () {
    this.timeout(60_000);
    await seedSettings({ locale: "zh-CN", localePreference: "zh-CN" });
    await browser.refresh();
    await enterWorkspace();
    await setTheme("cf-dark");
    await clickTestIdByWebDriver(TID_TASK_SETTINGS_BUTTON);
    await $(`[data-testid="${TID_SETTINGS_PAGE}"]`).waitForDisplayed();
    await openMenu();
    const labels = await menuLabels();
    expect(labels).toEqual([
      "产品文档",
      "用户社群",
      "问题上报",
      "给产品提需求",
      "导出日志",
      "资源管理器",
      ...(production ? ["检查更新"] : []),
      "关于 CodeFusion",
    ]);
    expect(await $$('[role="menu"] [role="separator"]')).toHaveLength(1);
    await browser.saveScreenshot(join(tmpdir(), "cf-help-export-zh-dark.png"));
    await assertLogExport("导出日志", "正在导出日志中");
    await openMenu();
    await $('[role="menuitem"]*=关于 CodeFusion').click();
    await assertAboutWindow();
  });
});
