import { startDraftFromProject } from "../../../helpers/project-sidebar.js";
import { selectUpstreamModel } from "../../../helpers/upstream-provider.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TID_SIDE_PANE_TOGGLE } from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  getE2EAppDataPaths,
} from "../../../helpers/desktop-app.js";
import {
  getV4PaneSnapshot,
  prepareV4ConversationE2E,
  selectV4TaskById,
  sendV4Prompt,
  waitForV4AssistantMessageContaining,
} from "../../../helpers/v4-conversation.js";
import {
  PLUGIN_LIFECYCLE_ID,
  addLifecycleMarketplaceThroughUi,
  capturePluginManualReview,
  clickPluginControl,
  createPluginLifecycleFixture,
  getPluginList,
  getPluginOverview,
  installPluginThroughUi,
  openManageView,
  openPluginSettings,
  requirePluginManualReview,
  removeLifecyclePluginPayload,
  selectPluginSettingsScope,
  setPluginEnabledThroughUi,
  uninstallPluginThroughUi,
  waitForPluginControl,
} from "../../../helpers/plugin-management-lifecycle.js";
import { startElectronWindowRecording } from "../../../helpers/electron-window-recorder.js";

const ARTIFACT_DIR = join(process.cwd(), ".e2e-artifacts", "plugin-management", "plm-ui-001");
const STEP_HOLD_MS = 1500;

describe("PLM-UI-001 UI 插件市场与项目配置", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("在真实 MCP 沙箱打开界面，关闭不卸载，项目暂停不影响全局和其他项目", async function () {
    this.timeout(240000);
    requirePluginManualReview();
    const fixture = await createPluginLifecycleFixture("1.0.0", true);
    await mkdir(ARTIFACT_DIR, { recursive: true });
    const recording = await startElectronWindowRecording({
      frameIntervalMs: 200,
      outputPath: join(ARTIFACT_DIR, "plm-ui-001.webm"),
    });
    const recordingStartedAt = Date.now();
    const chapters: Array<{ label: string; atMs: number }> = [];
    const step = async (label: string) => {
      await capturePluginManualReview("PLM-UI-001", label);
      chapters.push({ label, atMs: Date.now() - recordingStartedAt });
      await browser.pause(STEP_HOLD_MS);
    };
    try {
      await openPluginSettings();
      await waitForPluginControl("plugin-store-list");
      await browser.$('[data-testid="plugin-store-card"]').waitForDisplayed({ timeout: 60000 });
      await step("01-market-header-public");
      await addLifecycleMarketplaceThroughUi(fixture);
      await clickPluginControl("plugin-store-segment-community");
      await step("02-market-community");
      await clickPluginControl("plugin-store-segment-personal");
      await waitForPluginControl("plugin-store-ui-section");
      await step("03-market-personal-ui-section");
      await removeLifecyclePluginPayload(fixture);
      try {
        await clickPluginControl("plugin-store-install", { pluginId: PLUGIN_LIFECYCLE_ID });
        await waitForPluginControl("plugin-store-error");
        expect(
          (await getPluginList()).plugins.some((plugin) => plugin.id === PLUGIN_LIFECYCLE_ID),
        ).toBe(false);
        await step("04-install-failure-before-retry");
      } finally {
        await createPluginLifecycleFixture("1.0.0", true);
      }
      await installPluginThroughUi(PLUGIN_LIFECYCLE_ID);
      await step("05-installed-ui-card");
      await startDraftFromProject(getE2EAppDataPaths().workspace);
      await prepareV4ConversationE2E();
      await startDraftFromProject(getE2EAppDataPaths().workspace);
      await selectUpstreamModel();
      await sendV4Prompt("E2E_PLUGIN_MARKET_SESSION_READY");
      await waitForV4AssistantMessageContaining("plugin-market-session-ready");

      const sessionId = (await getV4PaneSnapshot()).sessionId;
      if (!sessionId || sessionId === "draft") throw new Error("前置会话没有创建成功");
      const openSidePaneMarket = async (stepLabel?: string) => {
        await selectV4TaskById(sessionId);
        const addTab = browser.$("[data-side-pane-add-tab-trigger]");
        if (await addTab.isDisplayed().catch(() => false)) {
          await addTab.click();
          await browser.$('[data-state="active"] [data-testid="side-pane-plugin-market"]').click();
        } else {
          await clickTestIdByDom(TID_SIDE_PANE_TOGGLE);
          await waitForPluginControl("side-pane-ui-recommendations");
          await browser.waitUntil(
            async () =>
              browser.execute(() => {
                const button = document.querySelector('[data-testid="side-pane-plugin-market"]');
                const rect = button?.getBoundingClientRect();
                return Boolean(rect && rect.width > 0 && rect.right <= window.innerWidth);
              }),
            { timeout: 10000, timeoutMsg: "Side Pane 启动页内容超出窗口" },
          );
          if (stepLabel) await step(stepLabel);
          await clickPluginControl("side-pane-plugin-market");
        }
        await waitForPluginControl("plugin-store-root");
        await clickPluginControl("plugin-store-segment-personal");
        await waitForPluginControl("plugin-store-open-ui", { pluginId: PLUGIN_LIFECYCLE_ID });
      };
      const openCardDetail = async () => {
        await clickPluginControl("plugin-store-card", { pluginId: PLUGIN_LIFECYCLE_ID });
        await waitForPluginControl("plugin-store-detail");
      };
      const waitForSandboxReady = () =>
        browser.waitUntil(
          async () =>
            (await browser.electron.execute(async (electron) => {
              const guests = electron.webContents
                .getAllWebContents()
                .filter((guest) => guest.getURL().startsWith("cf-sandbox://"));
              for (const guest of guests) {
                for (const frame of guest.mainFrame.frames) {
                  const ready = await frame
                    .executeJavaScript('document.getElementById("market-ui-ready")?.textContent')
                    .catch(() => null);
                  if (ready === "PLUGIN_MARKET_UI_READY") return true;
                }
              }
              return false;
            })) === true,
          { timeout: 60000, timeoutMsg: "真实插件沙箱没有完成握手" },
        );

      await openPluginSettings();
      await clickPluginControl("plugin-store-segment-personal");
      await waitForPluginControl("plugin-store-card", { pluginId: PLUGIN_LIFECYCLE_ID });
      expect(await browser.$$('[data-testid="plugin-store-open-ui"]')).toHaveLength(0);
      expect(await browser.$$('[data-testid="plugin-store-ui-details"]')).toHaveLength(0);
      await step("06-main-nav-card-no-open");
      await openCardDetail();
      expect(await browser.$$('[data-testid="plugin-store-open-ui"]')).toHaveLength(0);
      await waitForPluginControl("plugin-store-try-now", { pluginId: PLUGIN_LIFECYCLE_ID });
      await step("07-main-nav-detail");
      expect(await browser.$$('[data-side-pane-tab-id^="plugin-ui:"]')).toHaveLength(0);

      await openSidePaneMarket("08-side-pane-launcher");
      await step("09-side-pane-market-open-button");
      await clickPluginControl("plugin-store-open-ui", { pluginId: PLUGIN_LIFECYCLE_ID });
      await browser.$('[data-side-pane-tab-id^="plugin-ui:"]').waitForDisplayed({ timeout: 30000 });
      await waitForSandboxReady();
      await step("10-ui-opened-in-session");
      await browser.execute(() => {
        const tab = document.querySelector<HTMLElement>('[data-side-pane-tab-id^="plugin-ui:"]');
        const close = tab?.querySelector<HTMLButtonElement>("button");
        if (!close) throw new Error("UI 面板缺少关闭按钮");
        close.click();
      });
      expect(
        (await getPluginOverview()).installedPlugins.some(
          (plugin) => plugin.id === PLUGIN_LIFECYCLE_ID,
        ),
      ).toBe(true);
      await browser.$('[data-side-pane-tab-id="plugin-market"]').click();
      await openManageView();
      expect(await browser.$$('[role="tab"][id$="-trigger-mcps"]')).toHaveLength(0);
      await browser
        .$(
          `[data-testid="plugin-settings-plugin-row"][data-plugin-id="${PLUGIN_LIFECYCLE_ID}"] [data-testid="plugin-store-open-ui"]`,
        )
        .waitForDisplayed({ timeout: 15000 });
      await step("11-side-pane-manage-open-button");
      await clickPluginControl("plugin-store-browse-all");
      await browser.$('[data-side-pane-tab-id="plugin-market"] button').click();

      await openPluginSettings();
      await openManageView();
      await selectPluginSettingsScope("workspace");
      await waitForPluginControl("plugin-settings-plugin-row", { pluginId: PLUGIN_LIFECYCLE_ID });
      await setPluginEnabledThroughUi(PLUGIN_LIFECYCLE_ID, false, "manage");
      const { workspace, homeDir } = getE2EAppDataPaths();
      const other = join(homeDir, "fixtures", "other-project");
      await mkdir(other, { recursive: true });
      expect(
        (await getPluginList(workspace, undefined, "user")).plugins.find(
          (plugin) => plugin.id === PLUGIN_LIFECYCLE_ID,
        )?.enabled,
      ).toBe(true);
      expect(
        (await getPluginList(other)).plugins.find((plugin) => plugin.id === PLUGIN_LIFECYCLE_ID)
          ?.enabled,
      ).toBe(true);
      await browser.$('[data-testid="plugin-store-browse-all"]').scrollIntoView();
      await step("12-project-override");
      await clickPluginControl("plugin-store-browse-all");
      await clickPluginControl("plugin-store-segment-personal");
      await openCardDetail();
      expect(
        (await getPluginList()).plugins.find((plugin) => plugin.id === PLUGIN_LIFECYCLE_ID)
          ?.enabled,
      ).toBe(false);
      expect(await browser.$$('[data-testid="plugin-store-open-ui"]')).toHaveLength(0);
      await step("13-paused-main-nav-detail");
      await openSidePaneMarket();
      await step("14-side-pane-paused-enable-button");
      await clickPluginControl("plugin-store-open-ui", { pluginId: PLUGIN_LIFECYCLE_ID });
      await browser.waitUntil(
        async () =>
          (await getPluginList()).plugins.find((plugin) => plugin.id === PLUGIN_LIFECYCLE_ID)
            ?.enabled === true,
        { timeout: 30000, timeoutMsg: "暂停的 UI 插件没有先启用" },
      );
      await browser.$('[data-side-pane-tab-id^="plugin-ui:"]').waitForDisplayed({ timeout: 30000 });
      await step("15-paused-enables-and-opens");
      await browser.execute(() => {
        const close = document.querySelector<HTMLButtonElement>(
          '[data-side-pane-tab-id="plugin-market"] button',
        );
        if (!close) throw new Error("右侧市场标签缺少关闭按钮");
        close.click();
      });
      await browser
        .$('[data-side-pane-tab-id="plugin-market"]')
        .waitForExist({ reverse: true, timeout: 10000 });

      await openPluginSettings();
      await openManageView();
      await selectPluginSettingsScope("workspace");
      expect(await browser.$$('[data-testid="plugin-settings-ui-details"]')).toHaveLength(0);
      expect(await browser.$$('[data-testid="plugin-store-open-ui"]')).toHaveLength(0);
      await waitForPluginControl("plugin-settings-plugin-row", { pluginId: PLUGIN_LIFECYCLE_ID });
      await browser.execute((pluginId) => {
        const row = document.querySelector(
          `[data-testid="plugin-settings-plugin-row"][data-plugin-id="${pluginId}"] > button`,
        );
        if (!(row instanceof HTMLButtonElement)) throw new Error("管理页缺少插件行");
        row.click();
      }, PLUGIN_LIFECYCLE_ID);
      await waitForPluginControl("plugin-store-detail");
      await clickPluginControl("plugin-store-reset-config");
      await browser.waitUntil(
        async () => {
          const plugin = (await getPluginList()).plugins.find(
            (item) => item.id === PLUGIN_LIFECYCLE_ID,
          );
          return plugin?.enabled === true && plugin.enabledSource === "user";
        },
        { timeout: 30000, timeoutMsg: "项目配置没有恢复继承全局" },
      );
      await clickPluginControl("plugin-store-item-menu", { pluginId: PLUGIN_LIFECYCLE_ID });
      await step("16-more-menu");
      await browser.keys(["Escape"]);
      await browser
        .$('[data-testid="plugin-store-menu-uninstall"]')
        .waitForDisplayed({ reverse: true, timeout: 10000 });
      await uninstallPluginThroughUi(PLUGIN_LIFECYCLE_ID, false);
      await uninstallPluginThroughUi(PLUGIN_LIFECYCLE_ID, true);
    } finally {
      const result = await recording.stop({ tailDurationMs: 500 });
      await writeFile(
        join(ARTIFACT_DIR, "plm-ui-001.chapters.json"),
        JSON.stringify(
          { videoPath: result.videoPath, frameCount: result.frameCount, chapters },
          null,
          2,
        ),
      );
    }
  });
});
