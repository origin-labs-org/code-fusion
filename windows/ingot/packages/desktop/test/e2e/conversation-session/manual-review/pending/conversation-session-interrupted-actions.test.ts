import { TID_CHAT_STOP_BUTTON } from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  E2E_REPLY_TOKEN,
  assertVisibleUserMessagesNotContaining,
  editUserMessageContaining,
  getForkButtonForAssistantContaining,
  getChatRootSnapshot,
  prepareConversationE2E,
  sendPrompt,
  startNewTask,
  waitForAssistantMessageContaining,
  waitForChatState,
  waitForComposerText,
  waitForUpstreamRequestContaining,
  waitForQueueContaining,
  waitForQueueCount,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";

describe("Chat area Interrupted Actions E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Edit should be allowed after interrupted, but stopped assistant partial does not provide fork", async function () {
    this.timeout(240000);

    await prepareConversationE2E();

    const runId = Date.now();

    const editSourcePrompt = `E2E_SLOW_STREAM E2E_INTERRUPTED_EDIT_SOURCE_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(editSourcePrompt);
    await waitForComposerText(
      "",
      "Input box was not cleared after sending interrupted edit source prompt",
    );
    await waitForChatState(
      (snapshot) => snapshot.state === "streaming" && snapshot.queueCount === 0,
      "Interrupted edit source prompt did not enter running",
      30000,
    );
    const editStop = await clickChatStopIfAvailable();
    if (editStop.clicked) {
      await waitForChatState(
        (snapshot) =>
          snapshot.state !== "streaming" &&
          snapshot.runtimeStatus === "completed" &&
          snapshot.queueCount === 0,
        "queue=0 running did not enter interrupted completed after stop",
        30000,
      );
    } else {
      await waitForChatState(
        (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
        `queue=0 源 prompt 未出现可点 stop，Waiting线上FastCompleted: ${JSON.stringify(
          editStop,
        )}`,
        90000,
      );
    }

    const editRerunPrompt = `E2E_INTERRUPTED_EDIT_RERUN_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await editUserMessageContaining(
      `E2E_INTERRUPTED_EDIT_SOURCE_${runId}`,
      editRerunPrompt,
    );
    await waitForUpstreamRequestContaining(
      `E2E_INTERRUPTED_EDIT_RERUN_${runId}`,
    );
    await waitForUserMessageContaining(`E2E_INTERRUPTED_EDIT_RERUN_${runId}`);
    await assertVisibleUserMessagesNotContaining(
      `E2E_INTERRUPTED_EDIT_SOURCE_${runId}`,
    );
    await waitForChatState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      "interrupted queue=0 edit did not return to idle after rerun",
      90000,
    );

    await startNewTask();

    const forkQueueEmptyPrompt = `E2E_SLOW_STREAM E2E_INTERRUPTED_NO_FORK_EMPTY_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(forkQueueEmptyPrompt);
    await waitForComposerText(
      "",
      "Input box was not cleared after sending interrupted no-fork queue=0 source prompt",
    );
    await waitForChatState(
      (snapshot) => snapshot.state === "streaming" && snapshot.queueCount === 0,
      "Interrupted no-fork queue=0 source prompt did not enter running",
      30000,
    );
    await waitForAssistantMessageContaining("deep");
    const emptyStop = await clickChatStopIfAvailable();
    if (!emptyStop.clicked) {
      await waitForChatState(
        (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
        `queue=0 no-fork 源 prompt 未出现可点 stop，Skip interrupted fork 断言: ${JSON.stringify(
          emptyStop,
        )}`,
        90000,
      );
      return;
    }
    const forkQueueEmptySource = await waitForChatState(
      (snapshot) =>
        snapshot.state !== "streaming" &&
        snapshot.runtimeStatus === "completed" &&
        snapshot.queueCount === 0 &&
        Boolean(snapshot.sessionId || snapshot.taskId),
      "queue=0 interrupted assistant stop 后没有稳定下来",
      30000,
    );
    expect(
      forkQueueEmptySource.sessionId || forkQueueEmptySource.taskId,
    ).toBeTruthy();
    await expectNoEnabledForkButtonForAssistantContaining(
      "deep",
      "queue=0 interrupted assistant partial should not provide available fork entry",
    );

    await startNewTask();

    const forkHeldPrompt = `E2E_SLOW_STREAM E2E_INTERRUPTED_NO_FORK_HELD_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(forkHeldPrompt);
    await waitForComposerText(
      "",
      "Input box was not cleared after sending interrupted held no-fork source prompt",
    );
    await waitForChatState(
      (snapshot) => snapshot.state === "streaming" && snapshot.queueCount === 0,
      "Interrupted held no-fork source prompt did not enter running",
      30000,
    );
    await waitForAssistantMessageContaining("deep");

    const heldPrompt = `E2E_INTERRUPTED_NO_FORK_HELD_QUEUE_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(heldPrompt);
    await waitForQueueContaining(`E2E_INTERRUPTED_NO_FORK_HELD_QUEUE_${runId}`);
    const heldQueue = await waitForQueueCount(1);
    const heldQueueItemId = heldQueue[0]?.id;
    expect(heldQueueItemId).toBeTruthy();

    const heldStop = await clickChatStopIfAvailable();
    if (!heldStop.clicked) {
      await waitForChatState(
        (snapshot) => snapshot.state === "idle" && snapshot.queueCount >= 1,
        `held no-fork 源 prompt 未出现可点 stop，Skip interrupted fork 断言: ${JSON.stringify(
          heldStop,
        )}`,
        90000,
      );
      return;
    }
    const forkHeldSource = await waitForChatState(
      (snapshot) =>
        snapshot.state !== "streaming" &&
        snapshot.runtimeStatus === "completed" &&
        snapshot.queueCount === 1 &&
        Boolean(snapshot.sessionId || snapshot.taskId),
      "held queue interrupted assistant did not preserve parent queue after stop",
      30000,
    );
    const forkHeldSourceId = forkHeldSource.sessionId || forkHeldSource.taskId;
    expect(forkHeldSourceId).toBeTruthy();

    await expectNoEnabledForkButtonForAssistantContaining(
      "deep",
      "held queue interrupted assistant partial should not provide available fork entry",
    );
    await waitForChatState(
      (snapshot) =>
        (snapshot.sessionId || snapshot.taskId) === forkHeldSourceId &&
        snapshot.queueCount === 1,
      "Parent held queue was not preserved after disabling fork on interrupted assistant partial",
      30000,
    );
    const parentQueue = await waitForQueueCount(1);
    expect(parentQueue[0]?.id).toBe(heldQueueItemId);
    expect(parentQueue[0]?.content).toContain(
      `E2E_INTERRUPTED_NO_FORK_HELD_QUEUE_${runId}`,
    );
  });
});

async function clickChatStopIfAvailable() {
  let latest: Awaited<ReturnType<typeof getChatRootSnapshot>> | null = null;
  let latestButton: { clicked: boolean; reason?: string } = {
    clicked: false,
    reason: "not-started",
  };
  await browser
    .waitUntil(
      async () => {
        latest = await getChatRootSnapshot();
        if (latest.state !== "streaming") {
          latestButton = { clicked: false, reason: "not-streaming" };
          return true;
        }
        latestButton = (await browser.execute((stopButtonTestId) => {
          const button = document.querySelector<HTMLButtonElement>(
            `[data-testid="${stopButtonTestId}"]`,
          );
          if (!button) {
            return { clicked: false, reason: "missing" };
          }
          if (button.disabled) {
            return { clicked: false, reason: "disabled" };
          }
          button.click();
          return { clicked: true };
        }, TID_CHAT_STOP_BUTTON)) as { clicked: boolean; reason?: string };
        return latestButton.clicked;
      },
      {
        timeout: 8000,
        timeoutMsg: "聊天停止按钮没有在 live provider 可停止窗口内出现",
      },
    )
    .catch(() => undefined);

  latest = await getChatRootSnapshot();
  if (!latestButton.clicked && latest.state === "streaming") {
    await browser.keys("Escape").catch(() => undefined);
  }
  return {
    ...latestButton,
    snapshot: latest,
  };
}

async function expectNoEnabledForkButtonForAssistantContaining(
  text: string,
  timeoutMsg: string,
) {
  let latest: Awaited<ReturnType<typeof getForkButtonForAssistantContaining>> =
    null;
  const deadline = Date.now() + 3000;
  do {
    latest = await getForkButtonForAssistantContaining(text);
    if (latest?.exists && !latest.disabled && !latest.ariaDisabled) {
      throw new Error(`${timeoutMsg}; latest=${JSON.stringify(latest)}`);
    }
    await browser.pause(250);
  } while (Date.now() < deadline);
}
