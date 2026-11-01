import {
  clearAppData,
} from "../helpers/desktop-app.js";
import {
  clickV4PausedQueueResume,
  clickV4QueueItemSendNow,
  clickV4Stop,
  getV4QueueItems,
  hasV4PausedQueueBanner,
  hasV4PausedQueueSendDialog,
  prepareV4ConversationE2E,
  sendV4PausedQueueClear,
  sendV4PausedQueueKeep,
  sendV4Prompt,
  waitForV4PausedQueueBanner,
  waitForV4Pane,
  waitForV4QueueCount,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

async function setupHeldQueue(queueTexts: string[]) {
  await prepareV4ConversationE2E();
  await sendV4Prompt("E2E_V4_HELD_SLOW 慢慢回答这个问题");
  await waitForV4TimelineContaining("V4_HELD_STREAMING", 45000);
  await waitForV4Pane(
    (s) => s.canStop && s.sessionId !== "draft" && s.sessionId !== null,
    "First round did not enter running (canStop)",
    45000,
  );
  for (let i = 0; i < queueTexts.length; i++) {
    await sendV4Prompt(queueTexts[i]!);
    await waitForV4QueueCount(i + 1, 30000);
  }
  await clickV4Stop();
  await waitForV4Pane(
    (s) => !s.canStop,
    "Did not exit running after stop (canStop remains)",
    30000,
  );
}

describe("v4 catalog B 组：stop 后暂停队列、发送确认与继续消费", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("B02/B04: After stop, queue is preserved as-is, autoDrain=false, and pause prompt is displayed", async () => {
    await setupHeldQueue([
      "E2E_V4_HELD_Q1 排队的第一条",
      "E2E_V4_HELD_Q2 排队的第二条",
    ]);

    const items = await getV4QueueItems();
    expect(items).toHaveLength(2);
    expect(items[0]!.text).toContain("E2E_V4_HELD_Q1");
    expect(items[1]!.text).toContain("E2E_V4_HELD_Q2");

    await browser.pause(3000);
    const after = await getV4QueueItems();
    expect(after).toHaveLength(2);
    const snapshot = await waitForV4Pane(
      () => true,
      "读取快照失败",
      5000,
    );
    expect(snapshot.timelineText).not.toContain("V4_HELD_Q1_REPLY");

    await waitForV4PausedQueueBanner(15000);
    expect(await hasV4PausedQueueSendDialog()).toBe(false);
  });

  it("B06: Normal send button opens modal; keep sends while retaining queue, clear sends after clearing queue", async () => {
    await setupHeldQueue(["E2E_V4_HELD_Q1 排队的第一条"]);
    await waitForV4PausedQueueBanner(15000);

    await sendV4PausedQueueKeep("E2E_V4_HELD_KEEP Keep queue and ask directly");
    await waitForV4TimelineContaining("V4_HELD_KEEP_REPLY", 45000);
    await waitForV4Pane((s) => !s.canStop, "Did not return to idle after keep send", 30000);
    expect(await getV4QueueItems()).toHaveLength(1);

    await waitForV4PausedQueueBanner(15000);

    await sendV4PausedQueueClear("E2E_V4_HELD_CLEAR 清空队列再问");
    await waitForV4TimelineContaining("V4_HELD_CLEAR_REPLY", 45000);
    await waitForV4QueueCount(0, 15000);
    await waitForV4Pane((s) => !s.canStop, "Did not return to idle after clear send", 30000);

    await browser.waitUntil(
      async () =>
        !(await hasV4PausedQueueBanner()) && !(await hasV4PausedQueueSendDialog()),
      { timeout: 15000, timeoutMsg: "queue 清空后暂停提示或确认 modal 仍然存在" },
    );
    const snapshot = await waitForV4Pane(() => true, "读取快照失败", 5000);
    expect(snapshot.timelineText).not.toContain("V4_HELD_Q1_REPLY");
  });

  it("B14: Clicking resume on idle paused queue automatically drains to empty via Q1/Q2 FIFO", async () => {
    await setupHeldQueue([
      "E2E_V4_HELD_Q1 排队的第一条",
      "E2E_V4_HELD_Q2 排队的第二条",
    ]);
    await waitForV4PausedQueueBanner(15000);

    await clickV4PausedQueueResume();
    await waitForV4TimelineContaining("V4_HELD_Q1_REPLY", 45000);
    await waitForV4TimelineContaining("V4_HELD_Q2_REPLY", 45000);
    await waitForV4QueueCount(0, 15000);
    await waitForV4Pane((s) => !s.canStop, "继续消费后没有回到 idle", 30000);

    const snapshot = await waitForV4Pane(() => true, "读取 FIFO 终态失败", 5000);
    expect(snapshot.timelineText.indexOf("V4_HELD_Q1_REPLY")).toBeGreaterThanOrEqual(0);
    expect(snapshot.timelineText.indexOf("V4_HELD_Q2_REPLY")).toBeGreaterThan(
      snapshot.timelineText.indexOf("V4_HELD_Q1_REPLY"),
    );
    expect(await hasV4PausedQueueBanner()).toBe(false);
  });

  it("B15: Clicking resume while running only arms; head of paused queue is consumed only after current stream completes", async () => {
    await setupHeldQueue(["E2E_V4_HELD_Q1 排队的第一条"]);

    await sendV4PausedQueueKeep("E2E_V4_HELD_KEEP 保留队列并保持慢流");
    await waitForV4TimelineContaining("V4_HELD_KEEP_STREAMING", 30000);
    await waitForV4Pane((s) => s.canStop, "keep-and-send did not enter running", 15000);

    await clickV4PausedQueueResume();
    await browser.waitUntil(async () => !(await hasV4PausedQueueBanner()), {
      timeout: 15000,
      timeoutMsg: "点继续后暂停提示没有退出",
    });
    await browser.pause(500);
    expect(await getV4QueueItems()).toHaveLength(1);
    const armedSnapshot = await waitForV4Pane(
      (s) => s.canStop,
      "Current running was unexpectedly preempted after clicking resume",
      5000,
    );
    expect(armedSnapshot.timelineText).not.toContain("V4_HELD_Q1_REPLY");

    await waitForV4TimelineContaining("V4_HELD_KEEP_REPLY", 45000);
    await waitForV4TimelineContaining("V4_HELD_Q1_REPLY", 45000);
    await waitForV4QueueCount(0, 15000);
    await waitForV4Pane((s) => !s.canStop, "armed drain 后没有回到 idle", 30000);

    const finalSnapshot = await waitForV4Pane(() => true, "读取 armed drain 终态失败", 5000);
    expect(finalSnapshot.timelineText.indexOf("V4_HELD_Q1_REPLY")).toBeGreaterThan(
      finalSnapshot.timelineText.indexOf("V4_HELD_KEEP_REPLY"),
    );
  });

  it("B08: Held queue item \"Send now\" → item is dequeued and consumed as new turn", async () => {
    await setupHeldQueue(["E2E_V4_HELD_Q1 排队的第一条"]);

    const items = await getV4QueueItems();
    expect(items).toHaveLength(1);
    const clicked = await clickV4QueueItemSendNow(items[0]!.queueItemId);
    expect(clicked).toBe(true);

    await waitForV4TimelineContaining("V4_HELD_Q1_REPLY", 45000);
    await waitForV4QueueCount(0, 15000);
    await waitForV4Pane((s) => !s.canStop, "send-now 后没有回到 idle", 30000);
    expect(await getV4QueueItems()).toHaveLength(0);
  });
});
