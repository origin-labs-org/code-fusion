import { dirname } from "node:path";
import { DEFAULT_WORKSPACE, clearAppData, waitForWorkspaceApp } from "./helpers/desktop-app.js";
import {
  PASSIVE_AGENT_STARTUP_SCENARIO,
  getPassiveAgentStartupWorkspacePaths,
} from "./helpers/passive-agent-startup-fixture.js";
import {
  isMainRendererUrl,
  isResourceManagerUrl,
  openResourceManager,
  switchToElectronRendererTarget,
  waitForResourceManagerReady,
} from "./helpers/resource-manager.js";
import {
  assertStableAgentSelection,
  openWorkspaceDraftFromSidebar,
  pickWorkspacePaths,
  waitForActiveWorkspacePath,
  waitForRestoredProjects,
} from "./helpers/workspace-agent-warmup.js";

describe("Workspace Agent warmup lifecycle", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("TSL31: renderer reload 复用原 Agent PID，显式打开其他 workspace 后只增加 1 个", async function () {
    this.timeout(120_000);
    const workspacePaths = getPassiveAgentStartupWorkspacePaths(
      dirname(DEFAULT_WORKSPACE),
      PASSIVE_AGENT_STARTUP_SCENARIO.workspaceCount,
    );
    const activeWorkspacePath = workspacePaths[PASSIVE_AGENT_STARTUP_SCENARIO.activeWorkspaceIndex];
    const explicitWorkspacePath =
      workspacePaths[PASSIVE_AGENT_STARTUP_SCENARIO.explicitWorkspaceIndex];
    if (!activeWorkspacePath || !explicitWorkspacePath) {
      throw new Error("Startup fixture missing active or explicitly opened workspace");
    }
    const startupWarmupWorkspacePaths = pickWorkspacePaths(
      workspacePaths,
      PASSIVE_AGENT_STARTUP_SCENARIO.expectedWarmupWorkspaceIndexes,
    );

    await waitForWorkspaceApp(activeWorkspacePath, 30_000);
    await waitForActiveWorkspacePath(activeWorkspacePath);
    await waitForRestoredProjects(workspacePaths);

    await openResourceManager();
    await switchToElectronRendererTarget(isResourceManagerUrl);
    await waitForResourceManagerReady();
    const beforeReload = await assertStableAgentSelection(
      workspacePaths,
      startupWarmupWorkspacePaths,
    );

    await switchToElectronRendererTarget(isMainRendererUrl);
    await browser.execute(() => window.location.reload());
    await waitForActiveWorkspacePath(activeWorkspacePath);
    await waitForRestoredProjects(workspacePaths);

    await switchToElectronRendererTarget(isResourceManagerUrl);
    await waitForResourceManagerReady();
    const afterReload = await assertStableAgentSelection(
      workspacePaths,
      startupWarmupWorkspacePaths,
    );
    expect(afterReload).toEqual(beforeReload);

    await switchToElectronRendererTarget(isMainRendererUrl);
    await openWorkspaceDraftFromSidebar(explicitWorkspacePath);

    const expectedAfterExplicitOpen = [...startupWarmupWorkspacePaths, explicitWorkspacePath];
    await switchToElectronRendererTarget(isResourceManagerUrl);
    await assertStableAgentSelection(workspacePaths, expectedAfterExplicitOpen);
  });
});
