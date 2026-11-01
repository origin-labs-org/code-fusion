import {
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  setCurrentElectronRendererContentSize,
  restoreElectronRendererContentSize,
  clickTestIdByDom,
  waitForDefaultWorkspaceReady,
  waitForWorkspaceApp,
} from "../helpers/desktop-app.js";
import { sel } from "../helpers/selectors.js";

describe("快捷键按组合键搜索 E2E", () => {
  before(async () => {
    await waitForDefaultWorkspaceReady(30_000);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);
    await openShortcutSettings();
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("SC-11: 武装后按组合键，过滤出物理等价绑定的命令；清除后恢复全量", async function () {
    this.timeout(90_000);

    await clickTestIdByDom("settings-shortcut-key-search", {
      timeout: 15_000,
      timeoutMsg: "搜索框右端没有出现按组合键搜索按钮",
    });
    expect(await $(sel("settings-shortcut-key-search")).getAttribute("aria-pressed")).toBe("true");

    await dispatchShortcut("k", "KeyK");
    await $(sel("settings-shortcut-key-search-clear")).waitForDisplayed({ timeout: 10_000 });
    await $(sel("settings-shortcut-row-openCommandCenter")).waitForDisplayed({ timeout: 10_000 });
    expect(await $(sel("settings-shortcut-row-toggleSidebar")).isExisting()).toBe(false);

    await clickTestIdByDom("settings-shortcut-key-search-clear", {
      timeout: 10_000,
      timeoutMsg: "捕获组合的清除按钮没有出现",
    });
    await $(sel("settings-shortcut-row-toggleSidebar")).waitForDisplayed({ timeout: 10_000 });
    expect(await $(sel("settings-shortcut-row-openCommandCenter")).isExisting()).toBe(true);
  });

  it("SC-12: 无命中组合展示空态；Escape 退出武装态不再吞键", async function () {
    this.timeout(60_000);

    await clickTestIdByDom("settings-shortcut-key-search", {
      timeout: 10_000,
      timeoutMsg: "搜索框右端没有出现按组合键搜索按钮",
    });
    await dispatchShortcut("9", "Digit9", { shiftKey: true });
    await $(sel("settings-shortcut-search-empty")).waitForDisplayed({ timeout: 10_000 });
    expect(await $(sel("settings-shortcut-row-openCommandCenter")).isExisting()).toBe(false);

    await clickTestIdByDom("settings-shortcut-key-search-clear", {
      timeout: 10_000,
      timeoutMsg: "捕获组合的清除按钮没有出现",
    });
    await $(sel("settings-shortcut-row-openCommandCenter")).waitForDisplayed({ timeout: 10_000 });
    await clickTestIdByDom("settings-shortcut-key-search", { timeout: 10_000 });
    expect(await $(sel("settings-shortcut-key-search")).getAttribute("aria-pressed")).toBe("true");
    await dispatchKey("Escape", "Escape", {});
    await browser.pause(300);
    expect(await $(sel("settings-shortcut-key-search")).getAttribute("aria-pressed")).toBe("false");
    expect(await $(sel("settings-shortcut-row-openCommandCenter")).isDisplayed()).toBe(true);
  });
  it("SC-13: 深浅主题与窄屏保持控件和长组合键可见", async function () {
    this.timeout(90_000);
    const originalSize = await setCurrentElectronRendererContentSize(1100, 800);
    const originalMinimum = await browser.electron.execute((electron, windowId) => {
      const window = electron.BrowserWindow.fromId(windowId)!;
      const minimum = window.getMinimumSize();
      window.setMinimumSize(0, 0);
      return minimum;
    }, originalSize.windowId);
    try {
      for (const theme of ["light", "dark"]) {
        await browser.execute((value) => {
          const actions = (
            window as typeof window & { __testActions?: { setTheme?: (theme: string) => void } }
          ).__testActions;
          if (!actions?.setTheme) throw new Error("missing setTheme action");
          actions.setTheme(value);
        }, theme);
        for (const width of [1100, 390]) {
          await setCurrentElectronRendererContentSize(width, 800);
          const search = await $(sel("settings-shortcut-search-input"));
          await search.waitForDisplayed();
          await browser.waitUntil(
            async () =>
              browser.execute(() => {
                const page = document.querySelector('[data-testid="settings-shortcuts-section"]')!;
                return page.scrollWidth <= page.clientWidth + 1;
              }),
            { timeout: 5000, timeoutMsg: "快捷键页面横向溢出" },
          );
          const geometry = await browser.execute(() => {
            const input = document.querySelector('[data-testid="settings-shortcut-search-input"]')!;
            const row = document.querySelector(
              '[data-testid="settings-shortcut-row-toggleSidebar"]',
            )!;
            const edit = row.querySelector(
              '[data-testid="settings-shortcut-edit-toggleSidebar-0"]',
            )!;
            const clear = row.querySelector(
              '[data-testid="settings-shortcut-clear-toggleSidebar"]',
            )!;
            const style = getComputedStyle(input);
            return {
              keycaps: [...row.querySelectorAll("kbd")].map((keycap) => {
                const style = getComputedStyle(keycap);
                return {
                  background: style.backgroundColor,
                  height: keycap.getBoundingClientRect().height,
                  radius: style.borderRadius,
                };
              }),
              height: input.getBoundingClientRect().height,
              font: style.fontFamily,
              edit: edit.getBoundingClientRect().width,
              clear: clear.getBoundingClientRect().width,
              contained: [
                ...document.querySelectorAll('[data-testid^="settings-shortcut-row-"]'),
              ].every((commandRow) => {
                const bounds = commandRow.getBoundingClientRect();
                return [...commandRow.querySelectorAll("button, kbd")].every((el) => {
                  const r = el.getBoundingClientRect();
                  return r.left >= bounds.left && r.right <= bounds.right;
                });
              }),
            };
          });
          expect(geometry.keycaps.length).toBeGreaterThan(0);
          for (const keycap of geometry.keycaps) {
            expect(keycap.background).not.toBe("rgba(0, 0, 0, 0)");
            expect(keycap.height).toBe(16);
            expect(keycap.radius).toBe("6px");
          }
          expect(geometry.height).toBe(36);
          expect(geometry.font).not.toContain("mono");
          expect(geometry.edit).toBe(geometry.clear);
          expect(geometry.contained).toBe(true);
          await browser.saveScreenshot(`.e2e-artifacts/shortcut-settings-${theme}-${width}.png`);
        }
      }
    } finally {
      await browser.electron.execute(
        (electron, windowId, minimum) => {
          electron.BrowserWindow.fromId(windowId)?.setMinimumSize(minimum[0] ?? 0, minimum[1] ?? 0);
        },
        originalSize.windowId,
        originalMinimum,
      );
      await restoreElectronRendererContentSize(originalSize);
      await browser.execute(() =>
        (
          window as typeof window & { __testActions?: { setTheme?: (theme: string) => void } }
        ).__testActions?.setTheme?.("light"),
      );
    }
  });

  it("SC-14: 清除保存后可继续编辑并恢复默认", async function () {
    this.timeout(60_000);
    await $(sel("settings-shortcut-clear-toggleSidebar")).click();
    await $(sel("settings-shortcut-bind-toggleSidebar-unassigned")).waitForDisplayed({
      timeout: 15000,
    });
    await browser.waitUntil(
      async () => $(sel("settings-shortcut-bind-toggleSidebar-unassigned")).isEnabled(),
      { timeout: 15000 },
    );
    await $(sel("settings-shortcut-bind-toggleSidebar-unassigned")).click();
    await dispatchKey("Backspace", "Backspace", {});
    await $(sel("settings-shortcut-bind-toggleSidebar-0")).waitForDisplayed({ timeout: 15000 });
    await browser.waitUntil(
      async () => $(sel("settings-shortcut-clear-toggleSidebar")).isEnabled(),
      { timeout: 15000 },
    );
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

async function dispatchShortcut(key: string, code: string, opts: { shiftKey?: boolean } = {}) {
  const isMac = await browser.execute(() => /Mac|iPhone|iPad/.test(navigator.userAgent));
  await dispatchKey(key, code, {
    metaKey: isMac,
    ctrlKey: !isMac,
    shiftKey: opts.shiftKey ?? false,
  });
}

async function dispatchKey(
  key: string,
  code: string,
  modifiers: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean },
) {
  await browser.execute(
    (eventKey, eventCode, metaKey, ctrlKey, shiftKey) => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: eventKey,
          code: eventCode,
          metaKey,
          ctrlKey,
          shiftKey,
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
  );
}
