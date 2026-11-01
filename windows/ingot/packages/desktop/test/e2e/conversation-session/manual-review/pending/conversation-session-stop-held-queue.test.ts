import { clearAppData } from "../../../helpers/desktop-app.js";
import { waitForUpstreamNetworkCapture } from "../../../helpers/upstream-capture.js";
import {
  E2E_REPLY_TOKEN,
  clickChatStop,
  clickFirstQueueSendNow,
  countUpstreamRequestsContaining,
  expectNoUpstreamRequestForTextWithin,
  getChatRootSnapshot,
  prepareConversationE2E,
  sendPrompt,
  waitForChatState,
  waitForComposerText,
  waitForQueueContaining,
  waitForQueueCount,
} from "../../../helpers/conversation-session.js";

describe("Chat Area Stop and Held Queue E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Queue should be preserved after stop and not consumed automatically by default; sending immediately triggers next round", async function () {
    this.timeout(150000);

    await prepareConversationE2E();

    const runId = Date.now();
    const firstPrompt =
      `E2E_SLOW_STREAM E2E_STOP_HELD_RUNNING_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(firstPrompt);
    await waitForComposerText("", "首轮发送后输入框没有清空");
    await waitForChatState(
      (snapshot) => snapshot.state === "streaming",
      "首轮发送后 chat-view 没有进入 streaming",
      30000,
    );

    const queuedPrompt =
      `E2E_STOP_HELD_QUEUE_FIRST_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(queuedPrompt);
    await waitForQueueContaining(`E2E_STOP_HELD_QUEUE_FIRST_${runId}`);
    await waitForQueueCount(1);

    const secondQueuedPrompt =
      `E2E_STOP_HELD_QUEUE_SECOND_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(secondQueuedPrompt);
    await waitForQueueContaining(`E2E_STOP_HELD_QUEUE_SECOND_${runId}`);
    await waitForQueueCount(2);

    const thirdQueuedPrompt =
      `E2E_STOP_HELD_QUEUE_THIRD_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(thirdQueuedPrompt);
    await waitForQueueContaining(`E2E_STOP_HELD_QUEUE_THIRD_${runId}`);
    await waitForQueueCount(3);

    await clickChatStop();
    await waitForChatState(
      (snapshot) =>
        snapshot.state !== "streaming" &&
        snapshot.runtimeStatus === "completed" &&
        snapshot.activeInputId === null &&
        snapshot.queueCount === 3,
      "Failed to exit streaming after stop and 3 queued items were preserved",
      30000,
    );
    await expectNoUpstreamRequestForTextWithin(
      `E2E_STOP_HELD_QUEUE_FIRST_${runId}`,
      900,
    );

    const appendedPrompt =
      `E2E_STOP_HELD_QUEUE_APPEND_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    const appendedRequestsBefore =
      await countUpstreamRequestsContaining(`E2E_STOP_HELD_QUEUE_APPEND_${runId}`);
    await sendPrompt(appendedPrompt);
    await waitForQueueContaining(`E2E_STOP_HELD_QUEUE_APPEND_${runId}`);
    await waitForQueueCount(4);
    await expectNoUpstreamRequestForTextWithin(
      `E2E_STOP_HELD_QUEUE_APPEND_${runId}`,
      900,
    );
    expect(
      await countUpstreamRequestsContaining(`E2E_STOP_HELD_QUEUE_APPEND_${runId}`),
    ).toBe(appendedRequestsBefore);

    const sentNowItem = await clickFirstQueueSendNow();
    expect(sentNowItem.content).toContain(`E2E_STOP_HELD_QUEUE_FIRST_${runId}`);
    await waitForUpstreamNetworkCapture(`E2E_STOP_HELD_QUEUE_FIRST_${runId}`);

    const finalSnapshot = await getChatRootSnapshot();
    expect(finalSnapshot.queueCount).toBeLessThanOrEqual(3);
  });
});
