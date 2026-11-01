import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  E2E_REPLY_TOKEN,
  assertVisibleUserMessagesNotContaining,
  clickChatStop,
  expectNoUpstreamRequestForTextWithin,
  prepareConversationE2E,
  sendPrompt,
  waitForChatState,
  waitForComposerText,
  waitForUpstreamRequestContaining,
  waitForQueueContaining,
  waitForQueueCount,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";

describe("Chat Area Prewarming Queue E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("A02: Sending plain text during prewarming should queue and not interrupt the first turn", async function () {
    this.timeout(90000);

    await prepareConversationE2E();

    const runId = Date.now();
    const firstMarker = `E2E_PREWARMING_FIRST_${runId}`;
    const queuedMarker = `E2E_PREWARMING_QUEUED_${runId}`;
    const firstPrompt =
      `E2E_PREWARMING_DELAY ${firstMarker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    const queuedPrompt =
      `${queuedMarker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;

    await sendPrompt(firstPrompt);
    await waitForComposerText("", "Input box was not cleared after sending first turn during prewarming");
    await waitForUserMessageContaining(firstPrompt);
    await waitForUpstreamRequestContaining(firstMarker);
    const prewarmingSnapshot = await waitForChatState(
      (snapshot) =>
        Boolean(snapshot.sessionId || snapshot.taskId) &&
        snapshot.queueCount === 0 &&
        (snapshot.state === "submitting" || snapshot.state === "streaming"),
      "Did not enter prewarming/running window after sending first turn",
      10000,
    );
    expect(prewarmingSnapshot.queueCount).toBe(0);

    await sendPrompt(queuedPrompt);
    await waitForComposerText("", "Input box was not cleared after sending second message during prewarming");
    await waitForQueueContaining(queuedMarker);
    const queue = await waitForQueueCount(1);
    expect(queue[0]?.kind).toBe("text");
    expect(queue[0]?.content).toContain(queuedMarker);
    await assertVisibleUserMessagesNotContaining(queuedPrompt);
    await expectNoUpstreamRequestForTextWithin(queuedMarker, 750);

    await clickChatStop();
    await waitForChatState(
      (snapshot) =>
        snapshot.state !== "submitting" &&
        snapshot.state !== "streaming" &&
        snapshot.queueCount === 1,
      "Queued prompt was not preserved after stopping prewarming first turn",
      30000,
    );
  });
});
