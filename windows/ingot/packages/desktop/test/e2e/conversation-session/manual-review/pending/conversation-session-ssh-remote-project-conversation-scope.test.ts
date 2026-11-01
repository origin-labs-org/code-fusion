import {
  TID_COMPOSER_PROJECT_DETACH,
  TID_COMPOSER_WORK_OUTSIDE_PROJECT,
  TID_COMPOSER_WORKSPACE_TRIGGER,
} from "@origin-ai/cf-shared/test-ids";
import { clearAppData, clickTestIdByWebDriver, readSettings } from "#e2e/helpers/desktop-app";
import {
  connectSSHWorkspace,
  openSSHSourceDirectory,
  readHostProcesses,
  readRemoteTabSnapshot,
  readSSHRuntimeConfig,
  selectSSHRemoteDirectory,
  waitForRemoteTab,
  waitForSSHDirectoryStep,
} from "#e2e/helpers/ssh-remote-p0";
import { prepareV4ConversationE2E } from "#e2e/helpers/v4-conversation";
const CASE_MARKER = "E2E_SSH_REMOTE_PROJECT_CONVERSATION_SCOPE";

describe(`${CASE_MARKER}: RemoteProjectIsolated与无Project入口Disable`, () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });
  it("CWP13/CWP15→RPN-03/07 项目 A/B 使用独立 session，远程项目不能退出到无项目聊天", async function () {
    this.timeout(10 * 60_000);
    const config = readSSHRuntimeConfig(CASE_MARKER);
    await prepareV4ConversationE2E({ skipProvider: true });
    const hosts = await readHostProcesses();
    const [pathA, pathB] = config.workspacePaths;
    const a = await connectSSHWorkspace({ config, caseMarker: CASE_MARKER, workspacePath: pathA });
    await openSSHSourceDirectory(config, CASE_MARKER);
    await waitForSSHDirectoryStep(CASE_MARKER);
    await selectSSHRemoteDirectory(pathB, CASE_MARKER);
    const b = await waitForRemoteTab({ caseMarker: CASE_MARKER, expectedPath: pathB });
    expect(b.workspaceIdentity).not.toBe(a.workspaceIdentity);
    expect(b.remoteSessionId).not.toBe(a.remoteSessionId);
    expect((await readRemoteTabSnapshot()).activeWorkspaceIdentity).toBe(b.workspaceIdentity);
    await clickTestIdByWebDriver(TID_COMPOSER_WORKSPACE_TRIGGER, { timeout: 15_000 });
    const trigger = $(`[data-testid="${TID_COMPOSER_WORKSPACE_TRIGGER}"]`);
    await browser.waitUntil(async () => (await trigger.getAttribute("aria-expanded")) === "true", {
      timeout: 15_000,
      timeoutMsg: `${CASE_MARKER}: Project菜单没有展开`,
    });
    const menuId = await trigger.getAttribute("aria-controls");
    expect(menuId).toBeTruthy();
    await $(`[id="${menuId}"]`).waitForDisplayed({ timeout: 15_000 });
    const items = await browser.execute(
      (id) =>
        Array.from(
          document
            .getElementById(id)
            ?.querySelectorAll<HTMLElement>(
              '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]',
            ) ?? [],
        )
          .filter((item) => item.getClientRects().length)
          .map((item) => ({
            text: item.innerText.trim(),
            checked: item.getAttribute("aria-checked") === "true",
          })),
      menuId!,
    );
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((item) => item.checked && item.text.includes(pathB.split("/").at(-1)!))).toBe(
      true,
    );
    expect(
      items.some((item) => /不在ProjectMedium工作|Work outside (?:a )?project/iu.test(item.text)),
    ).toBe(false);
    expect(await $(`[data-testid="${TID_COMPOSER_WORK_OUTSIDE_PROJECT}"]`).isExisting()).toBe(
      false,
    );
    expect(await $(`[data-testid="${TID_COMPOSER_PROJECT_DETACH}"]`).isExisting()).toBe(false);
    await browser.keys("Escape");
    expect((await readRemoteTabSnapshot()).activeWorkspaceIdentity).toBe(b.workspaceIdentity);
    const remote =
      (await readSettings()).lastWorkspaceSession?.filter((entry) => entry.kind === "remote") ?? [];
    expect(remote.map((entry) => entry.workspacePath).sort()).toEqual([pathA, pathB].sort());
    expect(remote.some((entry) => entry.workspacePurpose === "conversation")).toBe(false);
    expect(await readHostProcesses()).toEqual(hosts);
  });
});
