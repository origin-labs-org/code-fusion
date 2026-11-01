import { dirname } from "node:path";
import { TID_V4_COMPOSER_INPUT } from "@origin-ai/cf-shared/test-ids";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  setInputValueByTestIdDom,
} from "../../../helpers/desktop-app.js";
import {
  assertUpstreamRequestCapture,
  waitForUpstreamNetworkCapture,
} from "../../../helpers/upstream-capture.js";
import {
  UPSTREAM_MODEL,
  UPSTREAM_SECONDARY_MODEL,
  UPSTREAM_SECONDARY_THOUGHT_LEVEL,
  UPSTREAM_THOUGHT_LEVEL,
  ensureUpstreamModelForE2E,
  selectUpstreamModelById,
  selectUpstreamThoughtLevelValue,
  waitForUpstreamModelSelected,
} from "../../../helpers/upstream-provider.js";
import {
  E2E_REPLY_TOKEN,
  clickChatStop,
  clickQueueEdit,
  getMessages,
  getQueueItems,
  prepareConversationE2E,
  selectTaskById,
  sendPrompt,
  startNewTask,
  waitForChatState,
  waitForComposerText,
  waitForUpstreamRequest,
  waitForQueueContaining,
  waitForQueueCount,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";
import { getPassiveAgentStartupWorkspacePaths } from "../../../helpers/passive-agent-startup-fixture.js";
import {
  openWorkspaceDraftFromSidebar,
  waitForActiveWorkspacePath,
  waitForRestoredProjects,
} from "../../../helpers/workspace-agent-warmup.js";
import { restartIntoWorkspacePreservingProfile } from "../../../helpers/model-provider-restart.js";

describe("Model Provider Catalog Gap Regression E2E", () => {
  afterEach(async () => {
    await stopIfBusy();
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it.skip("F-APP-003: Conflict rules for two main windows operating on the same workspace simultaneously", async function () {
    this.timeout(30000);
  });

  it("F-APP-002/F-APP-005/F-HISTORY-001: Model selection and history do not mix after switching workspace", async function () {
    this.timeout(240000);
    await prepareConversationE2E();
    await ensureUpstreamModelForE2E(UPSTREAM_SECONDARY_MODEL);

    const workspacePaths = getPassiveAgentStartupWorkspacePaths(dirname(DEFAULT_WORKSPACE), 2);
    await waitForRestoredProjects(workspacePaths, 60000);
    const workspaceA = DEFAULT_WORKSPACE;
    const workspaceB = workspacePaths[0];
    if (!workspaceB) throw new Error("Workspace fixture is incomplete");

    await openWorkspaceDraftFromSidebar(workspaceA);
    await waitForActiveWorkspacePath(workspaceA);
    await selectUpstreamModelById(UPSTREAM_MODEL);
    await selectUpstreamThoughtLevelValue(UPSTREAM_THOUGHT_LEVEL);
    const markerA = `E2E_CATALOG_WORKSPACE_A_${Date.now()}`;
    const promptA = `${markerA}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(promptA);
    await waitForUserMessageContaining(markerA);
    const taskA = await waitForChatState(
      (snapshot) => Boolean(snapshot.taskId),
      "Workspace A did not bind persistent task after initial send",
    );
    if (!taskA.taskId) throw new Error("workspace A 首发后 taskId 为空");
    assertUpstreamRequestCapture(await waitForUpstreamNetworkCapture(markerA), {
      expectedText: promptA,
      model: UPSTREAM_MODEL,
    });

    await openWorkspaceDraftFromSidebar(workspaceB);
    await waitForActiveWorkspacePath(workspaceB);
    await selectUpstreamModelById(UPSTREAM_SECONDARY_MODEL);
    await selectUpstreamThoughtLevelValue(UPSTREAM_SECONDARY_THOUGHT_LEVEL);
    const markerB = `E2E_CATALOG_WORKSPACE_B_${Date.now()}`;
    const promptB = `${markerB}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(promptB);
    await waitForUserMessageContaining(markerB);
    assertUpstreamRequestCapture(await waitForUpstreamNetworkCapture(markerB), {
      expectedText: promptB,
      model: UPSTREAM_SECONDARY_MODEL,
    });

    await openWorkspaceDraftFromSidebar(workspaceA);
    await waitForActiveWorkspacePath(workspaceA);
    await selectTaskById(taskA.taskId, {
      timeout: 30000,
      timeoutMsg: `Back workspace A 后没有找到 task ${taskA.taskId}`,
    });
    await waitForUserMessageContaining(markerA);
    const messagesA = await getMessages("user");
    expect(messagesA.map((message) => message.text).join("\n")).toContain(markerA);
    expect(messagesA.map((message) => message.text).join("\n")).not.toContain(markerB);
  });

  it("F-DRAFT-002/F-DRAFT-004: Draft selection during prewarm and page roundtrips is subject to the last selection", async function () {
    this.timeout(220000);
    await prepareConversationE2E();
    await ensureUpstreamModelForE2E(UPSTREAM_SECONDARY_MODEL);
    await startNewTask();

    await Promise.allSettled([
      selectUpstreamModelById(UPSTREAM_MODEL),
      selectUpstreamModelById(UPSTREAM_SECONDARY_MODEL),
    ]);
    await selectUpstreamModelById(UPSTREAM_SECONDARY_MODEL);
    await selectUpstreamThoughtLevelValue(UPSTREAM_SECONDARY_THOUGHT_LEVEL);
    await waitForUpstreamModelSelected(UPSTREAM_SECONDARY_MODEL);

    const settingsButton = await $(`[data-testid="task-settings-button"]`);
    if (await settingsButton.isExisting()) {
      await settingsButton.click();
      await browser.waitUntil(async () => await $(`[data-testid="settings-page"]`).isDisplayed(), {
        timeout: 15000,
        timeoutMsg: "Settings page did not open in model draft case",
      });
      const back = await $(`[data-testid="settings-back-button"]`);
      if (await back.isExisting()) await back.click();
    }
    await waitForUpstreamModelSelected(UPSTREAM_SECONDARY_MODEL);

    const marker = `E2E_CATALOG_DRAFT_PREWARM_${Date.now()}`;
    const prompt = `${marker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(prompt);
    await waitForComposerText("", "Input box was not cleared after initial send in draft prewarm");
    assertUpstreamRequestCapture(await waitForUpstreamNetworkCapture(marker), {
      expectedText: prompt,
      model: UPSTREAM_SECONDARY_MODEL,
    });
  });

  it("F-SESSION-004/F-SESSION-006: Fast switching and repeated selections converge to the last model", async function () {
    this.timeout(220000);
    await prepareConversationE2E({ resetDraftBeforeProvider: true });
    await ensureUpstreamModelForE2E(UPSTREAM_SECONDARY_MODEL);

    await selectUpstreamModelById(UPSTREAM_MODEL, { includePlainModelFallback: false });
    await selectUpstreamModelById(UPSTREAM_SECONDARY_MODEL, { includePlainModelFallback: false });
    await selectUpstreamModelById(UPSTREAM_MODEL, { includePlainModelFallback: false });
    await selectUpstreamModelById(UPSTREAM_SECONDARY_MODEL);
    await selectUpstreamModelById(UPSTREAM_SECONDARY_MODEL);

    const marker = `E2E_CATALOG_SELECTION_CONVERGENCE_${Date.now()}`;
    const prompt = `${marker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(prompt);
    const capture = await waitForUpstreamNetworkCapture(marker);
    assertUpstreamRequestCapture(capture, {
      expectedText: prompt,
      model: UPSTREAM_SECONDARY_MODEL,
    });
  });

  it("F-APP-004/F-SESSION-002/F-USAGE-001: Exiting during generation does not resend; retains explicit session after recovery", async function () {
    this.timeout(260000);
    await prepareConversationE2E();
    await ensureUpstreamModelForE2E(UPSTREAM_SECONDARY_MODEL);
    await startNewTask();
    await selectUpstreamModelById(UPSTREAM_MODEL);
    const marker = `E2E_CATALOG_EXIT_DURING_STREAM_${Date.now()}`;
    const prompt = `E2E_SLOW_STREAM ${marker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(prompt);
    await waitForUpstreamRequest({ includes: [marker] }, "退出前没有进入 provider 请求");
    await waitForChatState(
      (snapshot) => snapshot.state === "streaming",
      "退出前没有进入 streaming",
    );
    await waitForUserMessageContaining(marker);
    const beforeMessages = await getMessages("user");
    const beforeRestart = await waitForChatState(
      (snapshot) => Boolean(snapshot.taskId),
      "Did not bind recoverable session before exit",
    );
    if (!beforeRestart.taskId) throw new Error("taskId was empty before exit");
    await restartIntoWorkspacePreservingProfile();
    await selectTaskById(beforeRestart.taskId, {
      timeout: 60000,
      timeoutMsg: `重启后没有找到待恢复Session ${beforeRestart.taskId}`,
    });
    await waitForChatState(
      (snapshot) =>
        snapshot.taskId === beforeRestart.taskId &&
        snapshot.state !== "submitting" &&
        snapshot.state !== "streaming",
      "重启后会话没有恢复到稳定状态",
      60000,
    );
    await waitForUserMessageContaining(marker);
    const afterRestart = await getMessages("user");
    expect(afterRestart.filter((message) => message.text.includes(marker))).toHaveLength(1);
    expect(afterRestart.length).toBeGreaterThanOrEqual(beforeMessages.length);
  });

  it("F-QUEUE-006: Multiple queue items maintain order; edit action deletes only target item and keeps the other", async function () {
    this.timeout(260000);
    await prepareConversationE2E();
    await ensureUpstreamModelForE2E(UPSTREAM_SECONDARY_MODEL);
    await startNewTask();
    await selectUpstreamModelById(UPSTREAM_MODEL);

    const runId = Date.now();
    const running = `E2E_QUEUE_CATALOG_RUNNING_${runId}`;
    await sendPrompt(
      `E2E_SLOW_STREAM ${running}: keep streaming before replying ${E2E_REPLY_TOKEN}`,
    );
    await waitForChatState(
      (snapshot) => snapshot.state === "streaming",
      "Queue running turn 没有开始",
    );
    await waitForUpstreamRequest({ includes: [running] }, "Queue running turn did not enter provider");

    const first = `E2E_QUEUE_CATALOG_FIRST_${runId}`;
    const second = `E2E_QUEUE_CATALOG_SECOND_${runId}`;
    const firstPrompt = `${first}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    const secondPrompt = `${second}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(firstPrompt);
    await sendPrompt(secondPrompt);
    await waitForQueueContaining(first);
    await waitForQueueContaining(second);
    expect(await waitForQueueCount(2)).toHaveLength(2);

    await clickChatStop();
    await waitForChatState(
      (snapshot) => snapshot.state !== "streaming" && snapshot.queueCount === 2,
      "Did not retain two pending messages after queue running turn stopped",
    );
    const queueBeforeEdit = await getQueueItems();
    const firstItem = queueBeforeEdit.find((item) => item.content.includes(first));
    if (!firstItem) throw new Error("First message to edit was not found in Queue");
    await clickQueueEdit(firstItem.id);
    const edited = `${first}_EDITED`;
    await waitForComposerText(firstPrompt, "Composer did not restore original message after Queue edit");
    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, edited);
    await waitForComposerText(edited, "Composer did not write new text after Queue edit");
    const queueAfterEdit = await getQueueItems();
    expect(queueAfterEdit.some((item) => item.content.includes(first))).toBe(false);
    expect(queueAfterEdit.some((item) => item.content.includes(second))).toBe(true);
  });
});

async function stopIfBusy() {
  const snapshot = await waitForChatState(() => true, "读取 chat 状态失败", 5000).catch(() => null);
  if (snapshot?.state === "streaming" || snapshot?.state === "submitting") {
    await clickChatStop().catch(() => undefined);
    await waitForChatState(
      (candidate) => candidate.state !== "streaming" && candidate.state !== "submitting",
      "清理 running session 失败",
      30000,
    ).catch(() => undefined);
  }
}
