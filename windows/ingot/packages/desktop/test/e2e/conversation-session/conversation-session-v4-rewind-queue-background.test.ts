import { clearAppData } from "../helpers/desktop-app.js";
import {
  countUpstreamRequests,
  countUpstreamRequestsContaining,
} from "../helpers/conversation-session-network.js";
import {
  clickV4Stop,
  clickV4QueueItemSendNow,
  editFirstV4UserQuery,
  getV4BackgroundWorks,
  getV4PaneSnapshot,
  getV4QueueItems,
  openV4RunningBackgroundWorks,
  prepareV4ConversationE2E,
  sendV4Prompt,
  switchV4Mode,
  waitForV4CompactMarker,
  waitForV4Edit,
  waitForV4Pane,
  waitForV4PausedQueueBanner,
  waitForV4QueueCount,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

describe("PV4-20/PV4-23 rewind queue and background fencing", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("PV4-20 edit retains held queue, then consumes once per item using original ID/order", async function () {
    this.timeout(150000);
    await prepareV4ConversationE2E();

    await sendV4Prompt("E2E_PV4_20_ORIGINAL Latest query before compact");
    await waitForV4TimelineContaining("PV4_20_ORIGINAL_REPLY", 60000);

    await sendV4Prompt("/compact");
    await waitForV4CompactMarker(
      { origin: "manual", status: "running" },
      60000,
    );
    await sendV4Prompt("E2E_PV4_20_QUEUE_ONE 队列第一项");
    await waitForV4QueueCount(1, 30000);
    await sendV4Prompt("E2E_PV4_20_QUEUE_TWO 队列第二项");
    await waitForV4QueueCount(2, 30000);

    await clickV4Stop();
    await waitForV4Pane(
      (snapshot) => !snapshot.canStop,
      "PV4-20 did not return to idle after stopping the second compact",
      30000,
    );
    await waitForV4PausedQueueBanner(15000);
    await sendV4Prompt("/compact");
    await waitForV4QueueCount(3, 30000);
    const queued = await getV4QueueItems();
    expect(queued.slice(0, 2).map((item) => item.text)).toEqual([
      expect.stringContaining("E2E_PV4_20_QUEUE_ONE"),
      expect.stringContaining("E2E_PV4_20_QUEUE_TWO"),
    ]);
    expect(await clickV4QueueItemSendNow(queued[2]!.queueItemId)).toBe(true);
    await waitForV4CompactMarker(
      { origin: "manual", status: "success" },
      90000,
    );
    await waitForV4QueueCount(2, 30000);
    const before = await getV4QueueItems();
    expect(before).toEqual(queued.slice(0, 2));
    await waitForV4Edit();
    await editFirstV4UserQuery("E2E_PV4_20_EDITED Resend while retaining held queue");
    await waitForV4TimelineContaining("PV4_20_EDITED_REPLY", 60000);

    const after = await getV4QueueItems();
    expect(after).toEqual(before);
    expect((await getV4PaneSnapshot()).timelineText).not.toContain(
      "PV4_20_ORIGINAL_REPLY",
    );
    expect(await countUpstreamRequestsContaining("E2E_PV4_20_EDITED")).toBe(1);

    expect(await clickV4QueueItemSendNow(before[0]!.queueItemId)).toBe(true);
    await waitForV4TimelineContaining("PV4_20_QUEUE_ONE_REPLY", 60000);
    await waitForV4QueueCount(1, 30000);
    expect((await getV4QueueItems())[0]?.queueItemId).toBe(
      before[1]!.queueItemId,
    );
    expect(await clickV4QueueItemSendNow(before[1]!.queueItemId)).toBe(true);
    await waitForV4TimelineContaining("PV4_20_QUEUE_TWO_REPLY", 60000);
    await waitForV4QueueCount(0, 30000);
    expect(
      await countUpstreamRequests({
        lastUserMessageIncludes: ["E2E_PV4_20_QUEUE_ONE"],
      }),
    ).toBe(1);
    expect(
      await countUpstreamRequests({
        lastUserMessageIncludes: ["E2E_PV4_20_QUEUE_TWO"],
      }),
    ).toBe(1);
  });

  it("PV4-23 cancels background Bash for truncated turn before edit; new branch starts only once", async function () {
    this.timeout(150000);
    await prepareV4ConversationE2E();
    await switchV4Mode("yolo");

    await sendV4Prompt("E2E_PV4_23_BACKGROUND_ORIGINAL 启动后台 Bash");
    await waitForV4TimelineContaining(
      "PV4_23_BACKGROUND_ORIGINAL_REPLY",
      90000,
    );
    await openV4RunningBackgroundWorks(60000);
    const running = (await getV4BackgroundWorks()).find(
      (work) => work.status === "running",
    );
    expect(running?.workId).toBeTruthy();

    await waitForV4Edit();
    await editFirstV4UserQuery("E2E_PV4_23_BACKGROUND_EDITED Resend after canceling old background task");
    await waitForV4TimelineContaining("PV4_23_BACKGROUND_EDITED_REPLY", 90000);
    await waitForV4Pane(
      (snapshot) => !snapshot.canStop,
      "PV4-23 edit 后没有回到 idle",
      60000,
    );

    await browser.waitUntil(
      async () =>
        !(await getV4BackgroundWorks()).some(
          (work) => work.workId === running?.workId,
        ),
      {
        timeout: 60000,
        timeoutMsg: "PV4-23 background Bash for truncated turn is still in the running list",
      },
    );
    const finalSnapshot = await getV4PaneSnapshot();
    expect(finalSnapshot.timelineText).not.toContain(
      "PV4_23_BACKGROUND_ORIGINAL_REPLY",
    );
    expect(
      await countUpstreamRequestsContaining("E2E_PV4_23_BACKGROUND_EDITED"),
    ).toBe(1);
  });
});
