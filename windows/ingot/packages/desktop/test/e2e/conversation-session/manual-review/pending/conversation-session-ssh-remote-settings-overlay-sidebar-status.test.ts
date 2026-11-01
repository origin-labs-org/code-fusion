import { releaseControlledReplay } from "#e2e/helpers/controlled-replay";
import {
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_TASK_ITEM,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  waitForWorkspaceApp,
} from "../../../helpers/desktop-app.js";
import {
  getUpstreamRequestRecordCount,
  waitForUpstreamRequest,
} from "../../../helpers/conversation-session-network.js";
import { sel } from "../../../helpers/selectors.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  prepareSSHLifecycle,
  SSH_LIFECYCLE_TURN_TIMEOUT_MS,
  type SSHLifecycleProvider,
  type SSHLifecycleTask,
} from "../../../helpers/ssh-remote-lifecycle.js";
import { waitForRemoteTab } from "../../../helpers/ssh-remote-p0.js";
import {
  selectV4TaskById,
  sendV4PromptAndWaitAccepted,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
} from "../../../helpers/v4-conversation.js";
import { projectSectionSelector } from "../../../helpers/project-sidebar.js";

const CASE_MARKER = "E2E_SSH_P0_SETTINGS_OVERLAY_SIDEBAR";

interface SidebarRowIndicator {
  exists: boolean;
  inWorkspace: boolean;
  running: boolean;
  error: boolean;
}

function readSidebarRowIndicator(task: SSHLifecycleTask): Promise<SidebarRowIndicator> {
  return browser.execute(
    (taskTestId, workspaceTestId) => {
      const taskRow = document.querySelector<HTMLElement>(taskTestId);
      const workspaceRow = document.querySelector<HTMLElement>(workspaceTestId);
      return {
        exists: Boolean(taskRow),
        inWorkspace: Boolean(taskRow && workspaceRow?.contains(taskRow)),
        running: Boolean(taskRow?.querySelector(".animate-spin")),
        error: Boolean(taskRow?.querySelector('[data-error-indicator="true"]')),
      };
    },
    sel(testId(TID_TASK_ITEM, task.taskId)),
    projectSectionSelector(task.workspacePath),
  );
}

async function waitForSidebarRowRunning(task: SSHLifecycleTask, running: boolean): Promise<void> {
  let latest: SidebarRowIndicator | null = null;
  try {
    await browser.waitUntil(
      async () => {
        latest = await readSidebarRowIndicator(task);
        return latest.exists && latest.inWorkspace && !latest.error && latest.running === running;
      },
      {
        timeout: 30_000,
        interval: 100,
        timeoutMsg: `${CASE_MARKER}: Sidebar task 行 running 期望 ${String(running)}`,
      },
    );
  } catch (cause) {
    throw new Error(
      `${CASE_MARKER}: Sidebar task 行 running 期望 ${String(running)}，实际 ${JSON.stringify(latest)}`,
      { cause },
    );
  }
}

async function openAndCloseSettingsPage(task: SSHLifecycleTask): Promise<void> {
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
    timeout: 15_000,
    timeoutMsg: `${CASE_MARKER}: 没有找到Settings页入口`,
  });
  await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout: 15_000 });
  await waitForSidebarRowRunning(task, true);
  await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
    timeout: 15_000,
    timeoutMsg: `${CASE_MARKER}: Settings页没有Back入口`,
  });
  await waitForWorkspaceApp(task.workspacePath, 30_000);
}

describe(`${CASE_MARKER}: opening Settings must not detach the remote sidebar sessions-index`, () => {
  let provider: SSHLifecycleProvider | null = null;

  after(async () => {
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("SSH-P0-TASK-03 After toggling settings page during execution, sidebar task row still collapses upon task completion", async function () {
    this.timeout(30 * 60_000);
    const prepared = await prepareSSHLifecycle(CASE_MARKER);
    provider = prepared.provider;
    const [workspaceA] = prepared.config.workspacePaths;

    const task = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: prepared.config,
      label: "A",
      provider,
      workspacePath: workspaceA,
    });
    await waitForSidebarRowRunning(task, false);

    await selectV4TaskById(task.taskId, 30_000);
    await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: task.identity,
      expectedPath: task.workspacePath,
      expectedRemoteSessionId: task.remoteSessionId,
    });
    const requestStart = await getUpstreamRequestRecordCount();
    await sendV4PromptAndWaitAccepted(
      `${task.followPrompt}: 只Reply ${task.followReply}`,
      task.followPrompt,
      `${CASE_MARKER}: 续发没有被接受`,
    );
    await waitForV4ConversationState(
      (snapshot) => snapshot.taskId === task.taskId && snapshot.state === "streaming",
      `${CASE_MARKER}: 续发没有进入 streaming`,
      SSH_LIFECYCLE_TURN_TIMEOUT_MS,
    );
    await waitForSidebarRowRunning(task, true);

    await openAndCloseSettingsPage(task);
    await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: task.identity,
      expectedPath: task.workspacePath,
      expectedRemoteSessionId: task.remoteSessionId,
    });

    await waitForUpstreamRequest(
      { lastUserMessageIncludes: [task.followPrompt] },
      `${CASE_MARKER}: 续发没有到达 provider`,
      SSH_LIFECYCLE_TURN_TIMEOUT_MS,
      { afterIndex: requestStart - 1 },
    );
    await waitForV4ConversationState(
      (snapshot) => snapshot.taskId === task.taskId && snapshot.state === "streaming",
      `${CASE_MARKER}: Settings页Close前Task已经结束，未覆盖Running的订阅恢复`,
      15_000,
    );
    await waitForSidebarRowRunning(task, true);
    await releaseControlledReplay("ssh-settings-overlay-a-follow");
    await waitForV4AssistantMessageContaining(task.followReply, SSH_LIFECYCLE_TURN_TIMEOUT_MS);
    await waitForV4ConversationState(
      (snapshot) =>
        snapshot.taskId === task.taskId && snapshot.state === "idle" && snapshot.queueCount === 0,
      `${CASE_MARKER}: 续发没有回到 idle`,
      SSH_LIFECYCLE_TURN_TIMEOUT_MS,
    );

    await waitForSidebarRowRunning(task, false);
  });
});
