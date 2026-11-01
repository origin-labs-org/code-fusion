import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_SIDEBAR,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  clickTestIdByDom,
  getE2EAppDataPaths,
  waitForDefaultWorkspaceReady,
  waitForWorkspaceApp,
} from "../helpers/desktop-app.js";
import { sel } from "../helpers/selectors.js";

interface ShortcutSettingsShape {
  shortcutBindings?: Record<string, string[]>;
}

describe("快捷键设置 E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("SC-01: 录制新键位后落盘，主界面按新键位切换侧栏", async function () {
    this.timeout(120_000);

    await waitForDefaultWorkspaceReady(30_000);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);
    await openShortcutSettings();

    await clickTestIdByDom("settings-shortcut-bind-toggleSidebar-0", {
      timeout: 15_000,
      timeoutMsg: "快捷键列表没有出现 toggleSidebar 行",
    });
    await dispatchShortcut("e", "KeyE");
    await browser.waitUntil(
      async () => {
        const settings = await readSettings();
        return settings.shortcutBindings?.toggleSidebar?.[0] === "CmdOrCtrl+e";
      },
      { timeout: 15_000, timeoutMsg: "录制的新键位没有写入 setting.json" },
    );

    await backToWorkspace();
    await dispatchShortcut("e", "KeyE");
    await $(sel(TID_SIDEBAR)).waitForDisplayed({ reverse: true, timeout: 10_000 });
    await dispatchShortcut("e", "KeyE");
    await $(sel(TID_SIDEBAR)).waitForDisplayed({ timeout: 10_000 });
  });

  it("SC-02: app 内占用提示后二次确认抢绑；系统保留键直接拒绝且无确认入口", async function () {
    this.timeout(90_000);

    await openShortcutSettings();

    await clickTestIdByDom("settings-shortcut-bind-findInTask-0", {
      timeout: 15_000,
      timeoutMsg: "快捷键列表没有出现 findInTask 行",
    });
    await dispatchShortcut("j", "KeyJ");
    await $(sel("settings-shortcut-error-findInTask")).waitForDisplayed({ timeout: 10_000 });
    await $(sel("settings-shortcut-steal-findInTask")).waitForDisplayed({ timeout: 10_000 });

    await dispatchShortcut("c", "KeyC");
    await browser.pause(300);
    const settingsAfterReserved = await readSettings();
    expect(settingsAfterReserved.shortcutBindings?.findInTask).toBeUndefined();

    await dispatchShortcut("j", "KeyJ");
    await $(sel("settings-shortcut-steal-findInTask")).waitForDisplayed({ timeout: 10_000 });
    await clickTestIdByDom("settings-shortcut-steal-findInTask", {
      timeout: 10_000,
      timeoutMsg: "\"Bind Anyway\" confirmation button did not appear",
    });

    await browser.waitUntil(
      async () => {
        const settings = await readSettings();
        return (
          settings.shortcutBindings?.findInTask?.[0] === "CmdOrCtrl+j" &&
          settings.shortcutBindings?.toggleTerminal?.length === 0
        );
      },
      { timeout: 15_000, timeoutMsg: "二次确认抢绑后没有按预期写入 setting.json" },
    );

    await dispatchKey("Escape", "Escape", {});
  });

  it("SC-03: IME 组合中的按键不触发快捷键命令", async function () {
    this.timeout(60_000);

    await backToWorkspace();
    await $(sel(TID_SIDEBAR)).waitForDisplayed({ timeout: 10_000 });

    await dispatchShortcut("e", "KeyE", { isComposing: true });
    await browser.pause(800);
    expect(await $(sel(TID_SIDEBAR)).isDisplayed()).toBe(true);

    await dispatchShortcut("e", "KeyE");
    await $(sel(TID_SIDEBAR)).waitForDisplayed({ reverse: true, timeout: 10_000 });
    await dispatchShortcut("e", "KeyE");
    await $(sel(TID_SIDEBAR)).waitForDisplayed({ timeout: 10_000 });
  });

  it("SC-10: 清除 = 未分配，原键彻底失效且持久化不回退默认", async function () {
    this.timeout(120_000);

    await openShortcutSettings();

    await clickTestIdByDom("settings-shortcut-clear-toggleSidebar", {
      timeout: 15_000,
      timeoutMsg: "快捷键列表没有出现 toggleSidebar 清除按钮",
    });

    await browser.waitUntil(
      async () => {
        const settings = await readSettings();
        return settings.shortcutBindings?.toggleSidebar?.length === 0;
      },
      { timeout: 15_000, timeoutMsg: "清除后没有写入显式空数组" },
    );

    const kbdText = await $(sel("settings-shortcut-bind-toggleSidebar-unassigned")).getText();
    expect(["未分配", "Unassigned"]).toContain(kbdText.trim());
    expect(await $(sel("settings-shortcut-clear-toggleSidebar")).isEnabled()).toBe(false);

    await backToWorkspace();
    await $(sel(TID_SIDEBAR)).waitForDisplayed({ timeout: 10_000 });
    await dispatchShortcut("e", "KeyE");
    await browser.pause(800);
    expect(await $(sel(TID_SIDEBAR)).isDisplayed()).toBe(true);

    await openShortcutSettings();
    const kbdTextAgain = await $(sel("settings-shortcut-bind-toggleSidebar-unassigned")).getText();
    expect(["未分配", "Unassigned"]).toContain(kbdTextAgain.trim());
  });
});

async function openShortcutSettings() {
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
    timeout: 15_000,
    timeoutMsg: "Could not find settings entry button",
  });
  await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout: 15_000 });
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "shortcuts"), {
    timeout: 15_000,
    timeoutMsg: "设置页没有出现快捷键分区入口",
  });
}

async function backToWorkspace() {
  await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
    timeout: 15_000,
    timeoutMsg: "设置页没有出现返回按钮",
  });
}

async function dispatchShortcut(key: string, code: string, opts: { isComposing?: boolean } = {}) {
  const isMac = await browser.execute(() => /Mac|iPhone|iPad/.test(navigator.userAgent));
  await dispatchKey(key, code, {
    metaKey: isMac,
    ctrlKey: !isMac,
    isComposing: opts.isComposing ?? false,
  });
}

async function dispatchKey(
  key: string,
  code: string,
  modifiers: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; isComposing?: boolean },
) {
  await browser.execute(
    (eventKey, eventCode, metaKey, ctrlKey, shiftKey, isComposing) => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: eventKey,
          code: eventCode,
          metaKey,
          ctrlKey,
          shiftKey,
          isComposing,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    key,
    code,
    modifiers.metaKey ?? false,
    modifiers.ctrlKey ?? false,
    modifiers.shiftKey ?? false,
    modifiers.isComposing ?? false,
  );
}

async function readSettings(): Promise<ShortcutSettingsShape> {
  try {
    return JSON.parse(
      await readFile(join(getE2EAppDataPaths().appDataDir, "setting.json"), "utf-8"),
    ) as ShortcutSettingsShape;
  } catch {
    return {};
  }
}
