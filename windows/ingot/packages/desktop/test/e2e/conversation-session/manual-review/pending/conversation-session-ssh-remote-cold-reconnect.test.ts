import { reloadElectronSessionPreservingBrowserProfile } from "#e2e/helpers/e2e-electron-reload";
import {
  disconnectRemoteSource,
  requestRemoteProjectConnection,
} from "#e2e/helpers/remote-project-actions";
import { parseRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";
import { clearAppData, readSettings, seedSettings } from "../../../helpers/desktop-app.js";
import { selectUpstreamProviderModelById } from "../../../helpers/upstream-provider.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  prepareSSHLifecycle,
  readTaskRowInProject,
  sendSSHFollowTurn,
  waitForRendererAfterColdRestart,
  type SSHLifecycleProvider,
  type SSHLifecycleTask,
  SSH_LIFECYCLE_MODEL_ID,
} from "../../../helpers/ssh-remote-lifecycle.js";
import {
  prepareSSHConnectionPage,
  readHostProcesses,
  readRemoteTabSnapshot,
  waitForRemoteTab,
} from "../../../helpers/ssh-remote-p0.js";

import {
  selectTaskOrganizeMode,
  openWorkspaceDraftFromSidebar,
} from "../../../helpers/workspace-agent-warmup.js";

import {
  getV4PaneSnapshot,
  waitForV4ConversationState,
  waitForV4AssistantMessageContaining,
  waitForV4Pane,
} from "../../../helpers/v4-conversation.js";

const CASE_MARKER = "E2E_SSH_P0_COLD_RECONNECT";

describe(`${CASE_MARKER}: SSH cold restart and automatic reconnect`, () => {
  let provider: SSHLifecycleProvider | null = null;

  after(async () => {
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("SSH-P0-LIFE-01 After App cold restart, main window Host automatically restores original task", async function () {
    this.timeout(35 * 60_000);
    await prepareSSHConnectionPage(CASE_MARKER);
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
    const oldHosts = await readHostProcesses();
    const sourceId = parseRemoteWorkspaceIdentity(taskA.identity)?.sourceServerId;
    expect(sourceId).toBeTruthy();
    await selectTaskOrganizeMode(["项目", "Project"]);

    await disconnectRemoteSource(sourceId!, CASE_MARKER, {
      workspaceIdentities: [taskA.identity, taskB.identity],
    });
    const offlineA = $(`[data-project-workspace-identity="${taskA.identity}"]`);
    expect(await offlineA.isDisplayed()).toBe(true);
    expect(["offline", "failed"]).toContain(await offlineA.getAttribute("data-connection-state"));

    await requestRemoteProjectConnection(taskB.identity, CASE_MARKER);
    await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: taskB.identity,
      expectedPath: workspaceB,
    });
    await waitForV4ConversationState(
      (snapshot) => snapshot.taskId === taskB.taskId,
      `${CASE_MARKER}: 原地Reconnect没有Retain原Session`,
      60_000,
    );
    await waitForV4AssistantMessageContaining(taskB.firstReply);
    await disconnectRemoteSource(sourceId!, CASE_MARKER);
    await browser.waitUntil(
      async () => {
        const settings = await readSettings();
        return (
          settings.lastWorkspaceSession?.[settings.lastActiveTabIndex ?? 0]?.workspacePath ===
          workspaceB
        );
      },
      { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: 原激活Project没有Persistence` },
    );

    await reloadElectronSessionPreservingBrowserProfile(browser);
    await waitForRendererAfterColdRestart(CASE_MARKER);
    const reconnectedB = await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: taskB.identity,
      expectedPath: workspaceB,
      requireActive: false,
    });
    expect((await readRemoteTabSnapshot(taskA.identity)).secretPersistedInTab).toBe(false);
    expect((await readRemoteTabSnapshot(taskB.identity)).secretPersistedInTab).toBe(false);
    expect(reconnectedB.remoteSessionId).not.toBe(taskB.remoteSessionId);
    expect(await readHostProcesses()).toHaveLength(1);

    expect((await readRemoteTabSnapshot(taskB.identity)).activeWorkspaceIdentity).toBe(
      taskB.identity,
    );
    await waitForV4ConversationState(
      (snapshot) => snapshot.taskId === taskB.taskId,
      `${CASE_MARKER}: 冷Start没有Auto回到 B 原Session`,
      60_000,
    );
    await waitForV4AssistantMessageContaining(taskB.firstReply);

    expect((await readRemoteTabSnapshot(taskA.identity)).remoteSessionId).toBeNull();
    await openWorkspaceDraftFromSidebar(workspaceA);
    const reconnectedA = await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: taskA.identity,
      expectedPath: workspaceA,
      requireActive: false,
    });
    expect(reconnectedA.remoteSessionId).not.toBe(taskA.remoteSessionId);
    expect(reconnectedA.remoteSessionId).not.toBe(reconnectedB.remoteSessionId);

    await selectUpstreamProviderModelById(SSH_LIFECYCLE_MODEL_ID, {
      includePlainModelFallback: false,
      providerId: provider.id,
      providerName: provider.name,
    });
    const resumedA: SSHLifecycleTask = {
      ...taskA,
      remoteSessionId: reconnectedA.remoteSessionId!,
    };
    await readTaskRowInProject(resumedA, CASE_MARKER);
    await sendSSHFollowTurn(resumedA, CASE_MARKER, taskB.firstPrompt);
    const resumedB: SSHLifecycleTask = {
      ...taskB,
      remoteSessionId: reconnectedB.remoteSessionId!,
    };
    await readTaskRowInProject(resumedB, CASE_MARKER);
    await sendSSHFollowTurn(resumedB, CASE_MARKER, taskA.firstPrompt);
    expect(await readHostProcesses()).not.toEqual(oldHosts);

    await seedSettings({ remoteStartupAutoReconnectEnabled: false });
    await disconnectRemoteSource(sourceId!, CASE_MARKER);
    await reloadElectronSessionPreservingBrowserProfile(browser);
    await waitForRendererAfterColdRestart(CASE_MARKER);
    const unavailable = $('[data-testid="remote-conversation-unavailable"]');
    await unavailable.waitForDisplayed({ timeout: 30_000 });
    expect((await readRemoteTabSnapshot(taskB.identity)).activeWorkspaceIdentity).toBe(
      taskB.identity,
    );
    expect(await getV4PaneSnapshot()).toMatchObject({ sessionId: null, rowCount: 0 });
    expect(await $('[data-testid="remote-conversation-banner"]').isDisplayed()).toBe(true);
    expect(
      await browser.execute(
        (identity) => localStorage.getItem(`cf-v4-last-session:v1:${identity}`),
        taskB.identity,
      ),
    ).toBe(taskB.taskId);
    await browser.saveScreenshot(`${process.env.CF_E2E_ARTIFACT_DIR}/rdux09-cold-offline.png`);

    await requestRemoteProjectConnection(taskB.identity, CASE_MARKER);
    await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: taskB.identity,
      expectedPath: workspaceB,
    });
    await waitForV4ConversationState(
      (snapshot) => snapshot.taskId === taskB.taskId,
      `${CASE_MARKER}: DisconnectedStart后挂回没有恢复原Session`,
      60_000,
    );

    await browser.execute(
      (identity) =>
        localStorage.setItem(`cf-v4-last-session:v1:${identity}`, "e2e-removed-session-rdux09"),
      taskB.identity,
    );
    await seedSettings({ remoteStartupAutoReconnectEnabled: true });
    await reloadElectronSessionPreservingBrowserProfile(browser);
    await waitForRendererAfterColdRestart(CASE_MARKER);
    await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: taskB.identity,
      expectedPath: workspaceB,
    });
    await waitForV4Pane(
      (snapshot) => snapshot.sessionId === "draft",
      `${CASE_MARKER}: InvalidSession没有回到本ProjectNewTask`,
      60_000,
    );
    expect((await readRemoteTabSnapshot(taskB.identity)).activeWorkspaceIdentity).toBe(
      taskB.identity,
    );
    expect(
      await browser.execute(
        (identity) => localStorage.getItem(`cf-v4-last-session:v1:${identity}`),
        taskB.identity,
      ),
    ).toBeNull();
  });
});
