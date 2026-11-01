import {
  clearAppData,
} from "../helpers/desktop-app.js";
import {
  clickV4QueueItemSendNow,
  getV4QueueItems,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4QueueCount,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

describe("v4 M4 门禁：sendQueuedNow", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Enqueued while running → Send now → stop current + consume item as new turn", async () => {
    await prepareV4ConversationE2E();

    await sendV4Prompt("E2E_V4_SENDNOW_SLOW 慢慢回答");
    await waitForV4TimelineContaining("V4_SENDNOW_STREAMING", 45000);
    await waitForV4Pane(
      (s) => s.canStop && s.sessionId !== "draft" && s.sessionId !== null,
      "First round did not enter running (canStop)",
      45000,
    );

    await sendV4Prompt("E2E_V4_SENDNOW_ITEM Send to me immediately");
    await waitForV4QueueCount(1, 30000);
    const before = await getV4QueueItems();
    const queueItemId = before[0]!.queueItemId;

    const clicked = await clickV4QueueItemSendNow(queueItemId);
    expect(clicked).toBe(true);

    await waitForV4QueueCount(0, 30000);
    await waitForV4TimelineContaining("V4_SENDNOW_ITEM_REPLY", 60000);
    expect(await getV4QueueItems()).toHaveLength(0);
  });
});
