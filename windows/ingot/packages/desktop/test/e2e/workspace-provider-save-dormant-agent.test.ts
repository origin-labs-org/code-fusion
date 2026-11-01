import { dirname } from "node:path";
import {
  TID_MODEL_PROVIDER_API_KEY_INPUT,
  TID_MODEL_PROVIDER_NAV_ITEM,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  clickTestIdByDom,
  readModelProviders,
  setInputValueByTestIdDom,
  waitForWorkspaceApp,
} from "./helpers/desktop-app.js";
import { UPSTREAM_PROVIDER_ID, UPSTREAM_PROVIDER_NAV_KEY } from "./helpers/upstream-provider.js";
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
import { sel } from "./helpers/selectors.js";
import {
  assertStableAgentSelection,
  pickWorkspacePaths,
  waitForActiveWorkspacePath,
  waitForRestoredProjects,
} from "./helpers/workspace-agent-warmup.js";

describe("Provider save does not start dormant workspace Agent", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("TSL36: 9 restored workspaces retain only original 1 Agent PID after saving provider once", async function () {
    this.timeout(150_000);
    const workspacePaths = getPassiveAgentStartupWorkspacePaths(
      dirname(DEFAULT_WORKSPACE),
      PASSIVE_AGENT_STARTUP_SCENARIO.workspaceCount,
    );
    const activeWorkspacePath = workspacePaths[PASSIVE_AGENT_STARTUP_SCENARIO.activeWorkspaceIndex];
    if (!activeWorkspacePath) throw new Error("Startup fixture missing active workspace");
    const expectedWarmupWorkspacePaths = pickWorkspacePaths(
      workspacePaths,
      PASSIVE_AGENT_STARTUP_SCENARIO.expectedWarmupWorkspaceIndexes,
    );

    await waitForWorkspaceApp(activeWorkspacePath, 30_000);
    await waitForActiveWorkspacePath(activeWorkspacePath);
    await waitForRestoredProjects(workspacePaths);

    await openResourceManager();
    await switchToElectronRendererTarget(isResourceManagerUrl);
    await waitForResourceManagerReady();
    const beforeSave = await assertStableAgentSelection(
      workspacePaths,
      expectedWarmupWorkspacePaths,
    );

    await switchToElectronRendererTarget(isMainRendererUrl);
    await saveUpstreamApiKeyThroughSettings(`e2e-provider-save-${Date.now()}`);

    await switchToElectronRendererTarget(isResourceManagerUrl);
    await browser.pause(10_000);
    const afterSave = await assertStableAgentSelection(
      workspacePaths,
      expectedWarmupWorkspacePaths,
    );
    expect(afterSave).toEqual(beforeSave);
  });
});

async function saveUpstreamApiKeyThroughSettings(nextApiKey: string): Promise<void> {
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
    timeout: 15_000,
    timeoutMsg: "Could not find settings entry button",
  });
  await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout: 15_000 });
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "modelProvider"), {
    timeout: 15_000,
    timeoutMsg: "设置页没有出现模型供应商分区入口",
  });
  await clickTestIdByDom(testId(TID_MODEL_PROVIDER_NAV_ITEM, UPSTREAM_PROVIDER_NAV_KEY), {
    timeout: 30_000,
    timeoutMsg: "Upstream E2E provider did not appear in settings page",
  });

  await setInputValueByTestIdDom(TID_MODEL_PROVIDER_API_KEY_INPUT, nextApiKey, {
    timeout: 15_000,
    timeoutMsg: "Upstream E2E provider API Key input field did not appear",
  });
  await browser.waitUntil(
    async () =>
      (await readModelProviders()).some(
        (provider) => provider.id === UPSTREAM_PROVIDER_ID && provider.apiKey === nextApiKey,
      ),
    {
      timeout: 30_000,
      timeoutMsg: "provider API Key 保存没有持久化",
    },
  );
}
