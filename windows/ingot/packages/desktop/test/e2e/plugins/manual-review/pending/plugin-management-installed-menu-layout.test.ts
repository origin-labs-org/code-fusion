import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { clearAppData, getE2EAppDataPaths } from "../../../helpers/desktop-app.js";
import {
  capturePluginManualReview,
  openPluginManagementSettings,
  requirePluginManualReview,
  restartPluginLifecycleApp,
  selectPluginSettingsScope,
  waitForPluginControl,
} from "../../../helpers/plugin-management-lifecycle.js";

const BUILTIN_ID = "skill-creator@cf-plugins-official";
const MENU_LAYOUT_TIMEOUT_MS = 240000;
const RESTORE_USER_DEFAULT_PATTERN = /恢复 User Default|Restore User default/u;

interface MenuItemLayout {
  text: string;
  textLineCount: number;
  height: number;
}

describe("PLM-LC-017 已安装列表行内菜单布局 E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Workspace 覆盖下菜单只含启停与卸载且保持单行", async function () {
    this.timeout(MENU_LAYOUT_TIMEOUT_MS);
    requirePluginManualReview();

    await seedWorkspacePluginOverride();
    await restartPluginLifecycleApp();
    await openPluginManagementSettings();
    await selectPluginSettingsScope("workspace");
    await waitForPluginControl("plugin-settings-plugin-row", { pluginId: BUILTIN_ID }, 60000);
    await browser.waitUntil(
      () =>
        browser.execute((pluginId) => {
          const row = Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid="plugin-settings-plugin-row"]'),
          ).find((candidate) => candidate.dataset.pluginId === pluginId);
          return Boolean(row?.querySelector('[data-settings-scope="workspace"]'));
        }, BUILTIN_ID),
      { timeout: 30000, timeoutMsg: "已安装列表没有把内置插件标记为 Workspace 覆盖" },
    );

    await browser.execute((pluginId) => {
      const row = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="plugin-settings-plugin-row"]'),
      ).find((candidate) => candidate.dataset.pluginId === pluginId);
      const trigger = row?.querySelector<HTMLElement>('button[aria-haspopup="menu"]');
      if (!trigger) throw new Error("No \"…\" menu trigger in installed list row");
      row?.scrollIntoView({ block: "center" });
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
      );
    }, BUILTIN_ID);
    await browser.waitUntil(
      () =>
        browser.execute(
          () =>
            document.querySelectorAll(
              '[data-slot="dropdown-menu-content"][data-state="open"] [role="menuitem"]',
            ).length >= 2,
        ),
      { timeout: 15000, timeoutMsg: "Inline \"…\" menu did not expand" },
    );

    const items = await browser.execute((): MenuItemLayout[] => {
      const content = document.querySelector<HTMLElement>(
        '[data-slot="dropdown-menu-content"][data-state="open"]',
      );
      if (!content) return [];
      return Array.from(content.querySelectorAll<HTMLElement>('[role="menuitem"]')).map((item) => {
        let textLineCount = 0;
        for (const node of Array.from(item.childNodes)) {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          textLineCount += Array.from(range.getClientRects()).filter(
            (rect) => rect.width > 0 && rect.height > 0,
          ).length;
        }
        return {
          text: item.innerText.trim(),
          textLineCount,
          height: item.getBoundingClientRect().height,
        };
      });
    });
    await capturePluginManualReview("PLM-LC-017", "installed-row-menu-workspace-override");

    const restoreItem = items.find((item) => RESTORE_USER_DEFAULT_PATTERN.test(item.text));
    expect(restoreItem).toBeUndefined();
    expect(items).toHaveLength(2);
    const wrapped = items.filter((item) => item.textLineCount !== 1);
    if (wrapped.length > 0) {
      throw new Error(`菜单项折行：${JSON.stringify(wrapped)}`);
    }
    const heights = new Set(items.map((item) => Math.round(item.height)));
    if (heights.size !== 1) {
      throw new Error(`菜单项High度不One致：${JSON.stringify(items)}`);
    }
    expect(items.length).toBeGreaterThanOrEqual(2);
  });
});

async function seedWorkspacePluginOverride(): Promise<void> {
  const { workspace } = getE2EAppDataPaths();
  const configPath = join(workspace, ".cf", "config.json");
  await mkdir(join(workspace, ".cf"), { recursive: true });
  const existing = existsSync(configPath)
    ? (JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>)
    : {};
  const plugins = isRecord(existing.plugins) ? existing.plugins : {};
  const enabledPlugins = isRecord(plugins.enabledPlugins) ? plugins.enabledPlugins : {};
  await writeFile(
    configPath,
    JSON.stringify(
      {
        ...existing,
        plugins: { ...plugins, enabledPlugins: { ...enabledPlugins, [BUILTIN_ID]: true } },
      },
      null,
      2,
    ),
    "utf8",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
