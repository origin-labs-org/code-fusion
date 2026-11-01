import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  prepareSSHLifecycle,
  readTaskRowInProject,
  removeRemoteProjectEntry,
  sendSSHFollowTurn,
  type SSHLifecycleProvider,
  type SSHLifecycleTask,
} from "../../../helpers/ssh-remote-lifecycle.js";
import {
  openSSHSourceDirectory,
  readHostProcesses,
  waitForRemoteTab,
} from "../../../helpers/ssh-remote-p0.js";

const CASE_MARKER = "E2E_SSH_P0_TASK_LIFECYCLE";

describe(`${CASE_MARKER}: remove one SSH project entry and continue another`, () => {
  let provider: SSHLifecycleProvider | null = null;

  after(async () => {
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("SSH-P0-TASK-02 B continues sending after removing A entry point; rejoining original project A reuses shared Host", async function () {
    this.timeout(30 * 60_000);
    const prepared = await prepareSSHLifecycle(CASE_MARKER);
    provider = prepared.provider;
    const [workspaceA, workspaceB] = prepared.config.workspacePaths;

    const taskA = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: prepared.config,
      label: "A",
      provider,
      workspacePath: workspaceA,
    });
    const taskB = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: prepared.config,
      label: "B",
      provider,
      workspacePath: workspaceB,
    });
    const hostBeforeClose = await readHostProcesses();
    expect(hostBeforeClose).toEqual(prepared.initialHosts);

    const originalProject = $(`[data-project-workspace-identity="${taskA.identity}"]`);
    const projectId = await originalProject.getAttribute("data-project-id");
    const projectName = await originalProject.getAttribute("data-project-name");
    await removeRemoteProjectEntry(workspaceA, CASE_MARKER);
    await sendSSHFollowTurn(taskB, CASE_MARKER, taskA.firstPrompt);
    await readTaskRowInProject(taskB, CASE_MARKER);
    expect(await readHostProcesses()).toEqual(hostBeforeClose);

    await openSSHSourceDirectory(prepared.config, CASE_MARKER);
    await browser.waitUntil(
      () =>
        browser.execute((name) => {
          const matches = [
            ...document.querySelectorAll<HTMLButtonElement>('[data-testid="remote-project-pick"]'),
          ].filter((button) => button.textContent?.trim() === name && !button.disabled);
          if (matches.length !== 1) return false;
          matches[0]!.click();
          return true;
        }, projectName),
      { timeout: 30_000, timeoutMsg: "Remote list does not show original project A" },
    );
    const restoredProject = $(`[data-project-id="${projectId}"]`);
    await restoredProject.waitForDisplayed();
    expect(await restoredProject.getAttribute("data-project-workspace-identity")).toBe(
      taskA.identity,
    );
    await readTaskRowInProject(taskA, CASE_MARKER);
    const reopened = await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedPath: workspaceA,
      expectedIdentity: taskA.identity,
      requireActive: false,
    });
    const reopenedTaskA: SSHLifecycleTask = {
      ...taskA,
      remoteSessionId: reopened.remoteSessionId!,
    };
    expect(reopened.remoteSessionId).toBe(taskA.remoteSessionId);
    await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: taskB.identity,
      expectedPath: workspaceB,
      expectedRemoteSessionId: taskB.remoteSessionId,
      requireActive: false,
    });
    await readTaskRowInProject(reopenedTaskA, CASE_MARKER);
    await sendSSHFollowTurn(reopenedTaskA, CASE_MARKER, taskB.firstPrompt);
    expect(await readHostProcesses()).toEqual(hostBeforeClose);
  });
});
