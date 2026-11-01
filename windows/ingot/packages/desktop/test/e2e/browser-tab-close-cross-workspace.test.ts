import { dirname } from "node:path";
import { PlatformChannels } from "@origin-ai/cf-shared";
import type { BrowserViewCloseTabNotification } from "@origin-ai/cf-shared";
import { DEFAULT_WORKSPACE, clearAppData, waitForWorkspaceApp } from "./helpers/desktop-app.js";
import {
  SMALL_AGENT_WARMUP_SCENARIO,
  getPassiveAgentStartupWorkspacePaths,
} from "./helpers/passive-agent-startup-fixture.js";
import {
  openWorkspaceDraftFromSidebar,
  waitForActiveWorkspacePath,
  waitForRestoredProjects,
} from "./helpers/workspace-agent-warmup.js";
import {
  openFirstBrowserTab,
  readBrowserTabIds,
  waitForTabCount,
} from "./helpers/browser-side-pane.js";

describe("Browser tab 跨 workspace 关闭通知 E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("BTC02: Close notification received when user switches to another workspace; no ghost tabs remain upon switching back", async function () {
    this.timeout(300_000);

    const workspacePaths = getPassiveAgentStartupWorkspacePaths(
      dirname(DEFAULT_WORKSPACE),
      SMALL_AGENT_WARMUP_SCENARIO.workspaceCount,
    );
    const workspaceA = workspacePaths[SMALL_AGENT_WARMUP_SCENARIO.activeWorkspaceIndex];
    const workspaceB = workspacePaths.find((path) => path !== workspaceA);
    if (!workspaceA || !workspaceB) throw new Error("跨 workspace 用例需要两个 workspace fixture");

    await waitForWorkspaceApp(workspaceA, 30_000);
    await waitForActiveWorkspacePath(workspaceA);
    await waitForRestoredProjects(workspacePaths);

    await openFirstBrowserTab();
    const [tabIdA] = await readBrowserTabIds();
    if (!tabIdA) throw new Error("Workspace A failed to open Browser tab");

    await openWorkspaceDraftFromSidebar(workspaceB);
    await waitForTabCount(0);
    await openWorkspaceDraftFromSidebar(workspaceA);
    await waitForTabCount(1);
    expect(await readBrowserTabIds()).toEqual([tabIdA]);

    await openWorkspaceDraftFromSidebar(workspaceB);
    await waitForTabCount(0);
    await openFirstBrowserTab();
    const [tabIdB] = await readBrowserTabIds();
    if (!tabIdB) throw new Error("Workspace B failed to open Browser tab");
    expect(tabIdB).not.toEqual(tabIdA);

    await sendCloseTabNotification({ tabId: tabIdB, workspaceKey: workspaceA });
    await expectTabIdsStable([tabIdB]);

    await sendCloseTabNotification({ tabId: tabIdA, workspaceKey: workspaceA });
    await expectTabIdsStable([tabIdB]);

    await openWorkspaceDraftFromSidebar(workspaceA);
    await waitForTabCount(0);
  });
});

async function sendCloseTabNotification(
  notification: BrowserViewCloseTabNotification,
): Promise<void> {
  const deliveredCount = (await browser.electron.execute(
    (electron, channel, payload) => {
      const windows = electron.BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
      for (const win of windows) win.webContents.send(channel as string, payload);
      return windows.length;
    },
    PlatformChannels.BrowserViewCloseTab,
    notification,
  )) as unknown as number;
  if (!deliveredCount) throw new Error("主进程没有可投递关闭通知的窗口");
}

async function expectTabIdsStable(expectedTabIds: string[]): Promise<void> {
  await browser.pause(1000);
  expect(await readBrowserTabIds()).toEqual(expectedTabIds);
}
