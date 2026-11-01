import { DEFAULT_WORKSPACE, clearAppData, waitForWorkspaceApp } from "./helpers/desktop-app.js";
import {
  activateResourceManagerTab,
  closeResourceManagerWindow,
  countAgentProcessRows,
  isMainRendererUrl,
  isResourceManagerUrl,
  openResourceManager,
  openResourceManagerFromHelpMenu,
  readResourceUsageSnapshot,
  switchToElectronRendererTarget,
  waitForResourceManagerReady,
} from "./helpers/resource-manager.js";

describe("资源管理器", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Open the Task Manager window from the question mark Help menu in the top right", async function () {
    this.timeout(60_000);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);

    await openResourceManagerFromHelpMenu();
    await switchToElectronRendererTarget(isResourceManagerUrl);
    await waitForResourceManagerReady();
    await expect($('[data-testid="resource-manager-cpu-app"]')).toBeDisplayed();

    await switchToElectronRendererTarget(isMainRendererUrl);
    await closeResourceManagerWindow();
  });

  it("Shows three groups after opening from Help menu; Agent processes receive actual memory metrics after Host sampling", async function () {
    this.timeout(120_000);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);

    await openResourceManager();
    await switchToElectronRendererTarget(isResourceManagerUrl);
    await waitForResourceManagerReady();

    for (const category of ["base", "builtin-plugin", "community-plugin"]) {
      await expect($(`[data-testid="resource-manager-group-${category}"]`)).toBeDisplayed();
    }
    await expect($('[data-testid="resource-manager-cpu-app"]')).toBeDisplayed();
    expect(await $('[data-testid="resource-manager-memory-system"]').isExisting()).toBe(false);
    await activateResourceManagerTab("memory");
    await expect($('[data-testid="resource-manager-memory-system"]')).toBeDisplayed();
    await expect($('[data-testid="resource-manager-group-base"]')).toBeDisplayed();
    await activateResourceManagerTab("cpu");
    await expect($('[data-testid="resource-manager-cpu-app"]')).toBeDisplayed();

    await activateResourceManagerTab("storage");
    await browser.waitUntil(
      async () =>
        browser.execute(async () => {
          try {
            await (
              window as unknown as { resourceManager: { getSnapshot: () => Promise<unknown> } }
            ).resourceManager.getSnapshot();
            return false;
          } catch (error) {
            return String(error).includes("Resource sampling is inactive");
          }
        }),
      { timeout: 5_000, interval: 100, timeoutMsg: "存储页仍允许进程查询" },
    );
    await activateResourceManagerTab("cpu");
    await waitForResourceManagerReady();

    await browser.waitUntil(async () => (await countAgentProcessRows()) >= 1, {
      timeout: 60_000,
      interval: 1_000,
      timeoutMsg: "Agent process did not appear in Task Manager",
    });
    await browser.waitUntil(
      async () => {
        const snapshot = await readResourceUsageSnapshot();
        const agent = snapshot?.processes.find((process) =>
          process.name.startsWith("cf-agent-"),
        );
        return Boolean(agent && agent.sampled && agent.memoryBytes > 0);
      },
      {
        timeout: 30_000,
        interval: 1_000,
        timeoutMsg: "Agent process row did not receive Host-sampled memory metrics",
      },
    );

    const snapshot = await readResourceUsageSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.processes.some((process) => process.name === "cf-main")).toBe(true);
    expect(snapshot!.processes.some((process) => process.name.startsWith("cf-host-"))).toBe(
      true,
    );
    expect(snapshot!.app.cpuPercent).toBeLessThanOrEqual(100);
    expect(snapshot!.app.memoryBytes).toBeGreaterThan(0);

    const rowNames = await browser.execute(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="resource-manager-process-row"]'),
      ).map((element) => element.dataset.processName ?? ""),
    );
    expect(rowNames.some((name) => name.startsWith("cf-agent-"))).toBe(true);

    await switchToElectronRendererTarget(isMainRendererUrl);
  });
});
