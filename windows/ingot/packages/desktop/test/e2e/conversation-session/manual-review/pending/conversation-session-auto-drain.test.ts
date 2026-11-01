import { clearAppData } from "../../../helpers/desktop-app.js";
import { waitForUpstreamNetworkCapture } from "../../../helpers/upstream-capture.js";
import {
  E2E_REPLY_TOKEN,
  getMessages,
  getQueueItems,
  prepareConversationE2E,
  sendPrompt,
  waitForChatState,
  waitForComposerText,
  waitForQueueContaining,
  waitForQueueCount,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";

describe("Chat Area Auto Drain E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Should automatically consume queued prompt at head of queue after running completes normally", async function () {
    this.timeout(90000);

    await prepareConversationE2E();

    const runId = Date.now();
    const runningPrompt = `E2E_AUTO_DRAIN_RUNNING_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(runningPrompt);
    await waitForComposerText(
      "",
      "Input box was not cleared after sending first auto-drain prompt",
    );
    await waitForUserMessageContaining(runningPrompt);
    await waitForChatState(
      (snapshot) => snapshot.state === "streaming",
      "First auto-drain prompt did not enter streaming",
      30000,
    );

    const queuedPrompt = `E2E_AUTO_DRAIN_QUEUED_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(queuedPrompt);
    await waitForComposerText(
      "",
      "Input box was not cleared after sending queued prompt during running",
    );
    await waitForQueueContaining(`E2E_AUTO_DRAIN_QUEUED_${runId}`);
    const queuedItems = await waitForQueueCount(1);
    expect(queuedItems[0]?.kind).toBe("text");
    expect(queuedItems[0]?.content).toContain(`E2E_AUTO_DRAIN_QUEUED_${runId}`);

    await waitForUpstreamNetworkCapture(`E2E_AUTO_DRAIN_QUEUED_${runId}`);
    await waitForUserMessageContaining(queuedPrompt);
    await waitForChatState(
      (snapshot) =>
        snapshot.state === "idle" &&
        snapshot.runtimeStatus === "completed" &&
        snapshot.queueCount === 0,
      "Queued prompt was not automatically consumed and queue was not cleared after first turn completed",
      90000,
    );

    expect(await getQueueItems()).toHaveLength(0);
    const assistantMessages = await getMessages("assistant");
    expect(
      assistantMessages.filter((message) =>
        message.text.includes(E2E_REPLY_TOKEN),
      ),
    ).toHaveLength(2);
  });
});
