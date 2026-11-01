import { clearAppData } from "../helpers/desktop-app.js";
import { waitForToastContaining } from "../helpers/conversation-session-toast.js";
import {
  clickV4Stop,
  clickV4QueueItemDelete,
  dragV4QueueItemOnto,
  clickV4QueueItemEdit,
  getV4ComposerAttachments,
  getV4ComposerText,
  getV4PaneSnapshot,
  getV4QueueItems,
  isV4ComposerFocused,
  prepareV4ConversationE2E,
  pasteV4ComposerImageAttachment,
  sendV4Prompt,
  setV4ComposerText,
  waitForV4Pane,
  waitForV4QueueCount,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

describe("v4 M4/B09 gate: single queue item management and recall for edit", () => {
  afterEach(async () => {
    const snapshot = await getV4PaneSnapshot();
    if (!snapshot.canStop) return;
    await clickV4Stop();
    await waitForV4Pane((next) => !next.canStop, "Queue operation case teardown stop did not complete", 30000);
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Enqueue an item while running → QueuePanel displays → delete → queue cleared", async () => {
    await prepareV4ConversationE2E();

    await sendV4Prompt("E2E_V4_QUEUE_SLOW 慢慢回答");
    await waitForV4TimelineContaining("V4_QUEUE_STREAMING", 45000);
    await waitForV4Pane(
      (s) => s.canStop && s.sessionId !== "draft" && s.sessionId !== null,
      "First round did not enter running (canStop)",
      45000,
    );

    await sendV4Prompt("E2E_V4_QUEUE_ITEM 排队的问题");
    await waitForV4QueueCount(1, 30000);
    const before = await getV4QueueItems();
    expect(before).toHaveLength(1);
    expect(before[0]!.text).toContain("E2E_V4_QUEUE_ITEM");

    const clicked = await clickV4QueueItemDelete(before[0]!.queueItemId);
    expect(clicked).toBe(true);
    await waitForV4QueueCount(0, 30000);
    expect(await getV4QueueItems()).toHaveLength(0);
  });

  it("Enqueue with image while running → recall to composer → edit and resend generates new queueItemId", async () => {
    await prepareV4ConversationE2E();

    await sendV4Prompt("E2E_V4_QUEUE_SLOW 慢慢回答");
    await waitForV4TimelineContaining("V4_QUEUE_STREAMING", 45000);
    await waitForV4Pane(
      (s) => s.canStop && s.sessionId !== "draft" && s.sessionId !== null,
      "First round did not enter running (canStop)",
      45000,
    );

    await pasteV4ComposerImageAttachment("e2e-queue-edit.png");
    await sendV4Prompt("E2E_V4_QUEUE_ITEM 排队原文");
    await waitForV4QueueCount(1, 30000);
    const before = await getV4QueueItems();
    expect(before[0]!.text).toContain("排队原文");
    const queueItemId = before[0]!.queueItemId;

    const clicked = await clickV4QueueItemEdit(queueItemId, 2);
    expect(clicked).toBe(true);
    await waitForV4QueueCount(0, 30000);
    await browser.waitUntil(
      async () => {
        const text = await getV4ComposerText();
        const attachments = await getV4ComposerAttachments();
        return (
          text === "E2E_V4_QUEUE_ITEM 排队原文" &&
          attachments.length === 1 &&
          attachments[0]?.uploadStatus === "ready"
        );
      },
      { timeout: 30000, timeoutMsg: "Composer text and attachments were not fully restored after queue item removal" },
    );
    expect(await isV4ComposerFocused()).toBe(true);
    expect(await getV4ComposerAttachments()).toHaveLength(1);

    await sendV4Prompt("E2E_V4_QUEUE_ITEM 编辑后重新提交");
    await waitForV4QueueCount(1, 30000);
    const after = await getV4QueueItems();
    expect(after).toHaveLength(1);
    expect(after[0]?.queueItemId).not.toBe(queueItemId);
    expect(after[0]?.text).toContain("编辑后重新提交");
  });

  it("When composer already has a draft, editing queue does not recall and prompts to handle draft first", async () => {
    await prepareV4ConversationE2E();

    await sendV4Prompt("E2E_V4_QUEUE_SLOW 慢慢回答");
    await waitForV4TimelineContaining("V4_QUEUE_STREAMING", 45000);
    await waitForV4Pane(
      (s) => s.canStop && s.sessionId !== "draft" && s.sessionId !== null,
      "First round did not enter running (canStop)",
      45000,
    );

    await sendV4Prompt("E2E_V4_QUEUE_ITEM 不应被撤回");
    await waitForV4QueueCount(1, 30000);
    const before = await getV4QueueItems();
    await setV4ComposerText("保留现有草稿");

    expect(await clickV4QueueItemEdit(before[0]!.queueItemId)).toBe(true);
    await waitForToastContaining(
      [
        "Send or clear the current draft before editing a queued message.",
        "Please send or clear your current draft before editing queued messages.",
      ],
      "Recall prevention prompt did not appear for non-empty draft",
    );
    expect(await getV4ComposerText()).toBe("保留现有草稿");
    const after = await getV4QueueItems();
    expect(after).toHaveLength(1);
    expect(after[0]?.queueItemId).toBe(before[0]?.queueItemId);
    expect(after[0]?.text).toContain("不应被撤回");
  });

  it("Enqueue two items while running → drag second item to first → order swapped (reorderQueueItem)", async () => {
    await prepareV4ConversationE2E();

    await sendV4Prompt("E2E_V4_QUEUE_SLOW 慢慢回答");
    await waitForV4TimelineContaining("V4_QUEUE_STREAMING", 45000);
    await waitForV4Pane(
      (s) => s.canStop && s.sessionId !== "draft" && s.sessionId !== null,
      "First round did not enter running (canStop)",
      45000,
    );

    await sendV4Prompt("E2E_V4_QUEUE_ITEM 第一条问题");
    await waitForV4QueueCount(1, 30000);
    await sendV4Prompt("E2E_V4_QUEUE_ITEM 第二条问题");
    await waitForV4QueueCount(2, 30000);

    const before = await getV4QueueItems();
    expect(before).toHaveLength(2);
    expect(before[0]!.text).toContain("第一条问题");
    expect(before[1]!.text).toContain("第二条问题");
    const secondId = before[1]!.queueItemId;

    await dragV4QueueItemOnto(secondId, before[0]!.queueItemId);
    await browser.waitUntil(
      async () => {
        const items = await getV4QueueItems();
        return items.length === 2 && items[0]!.queueItemId === secondId;
      },
      { timeout: 30000, timeoutMsg: "Second item was not dragged to the front of the queue" },
    );
    const after = await getV4QueueItems();
    expect(after).toHaveLength(2);
    expect(after[0]!.queueItemId).toBe(secondId);
    expect(after[0]!.text).toContain("第二条问题");
    expect(after[1]!.text).toContain("第一条问题");
  });
});
