import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  waitForUpstreamNetworkCapture,
  waitForUpstreamNetworkRequestStarted,
} from "../../../helpers/upstream-capture.js";
import {
  clickV4PausedQueueResume,
  getV4ConversationState,
  getV4QueueAutoDrain,
  getV4QueueItems,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
  waitForV4PausedQueueBanner,
  waitForV4QueueCount,
} from "../../../helpers/v4-conversation.js";

const SOURCE_MARKER = "E2E_TURN_ERROR_QUEUE_SOURCE";
const QUEUED_MARKER = "E2E_TURN_ERROR_QUEUE_FOLLOWUP";
const RECOVERED_REPLY = "TURN_ERROR_QUEUE_RECOVERED";

describe("NQ: turn error preserves future queue", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Queue preserved after main turn 500 error; auto-consumption paused and FIFO can continue", async function () {
    this.timeout(120000);
    await prepareV4ConversationE2E();

    await sendV4Prompt(`${SOURCE_MARKER}: 触发One个可恢复的 provider error。`);
    await waitForUpstreamNetworkRequestStarted(SOURCE_MARKER);

    await sendV4Prompt(`${QUEUED_MARKER}: Error后按队首恢复。`);
    await waitForV4QueueCount(1);

    const failedRequest = await waitForUpstreamNetworkCapture(SOURCE_MARKER);
    expect(failedRequest.statusCode).toBe(500);
    await waitForV4ConversationState(
      (snapshot) => snapshot.state !== "streaming" && snapshot.queueCount === 1,
      "Not closed or queue cleared after turn error",
      30000,
    );
    expect((await getV4QueueItems())[0]?.text).toContain(QUEUED_MARKER);
    expect(await getV4QueueAutoDrain()).toBe(false);
    await waitForV4PausedQueueBanner();

    await clickV4PausedQueueResume();
    await waitForV4AssistantMessageContaining(RECOVERED_REPLY, 60000);
    await waitForV4QueueCount(0, 30000);
    await waitForV4ConversationState(
      (snapshot) => snapshot.queueCount === 0 && snapshot.runtimeStatus !== "streaming",
      "Queue was not consumed to empty in FIFO order after resuming",
      30000,
    );
    expect(await getV4ConversationState()).not.toMatchObject({ queueCount: 1 });
  });
});
