import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  E2E_REPLY_TOKEN,
  clickChatStop,
  clickQueueEdit,
  clickQueueEditSave,
  clickQueueRemove,
  countUpstreamRequestsContaining,
  dragQueueItemOnto,
  getComposerText,
  getQueueItems,
  prepareConversationE2E,
  sendPrompt,
  setQueueEditInputText,
  waitForChatState,
  waitForComposerText,
  waitForQueueCount,
  waitForQueueOrderContaining,
} from "../../../helpers/conversation-session.js";

describe("Chat Area Held Queue Operations E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Editing, reordering, and deleting in held queue affect only the queue itself and do not trigger model requests", async function () {
    this.timeout(180000);

    await prepareConversationE2E();

    const runId = Date.now();
    const runningPrompt =
      `E2E_SLOW_STREAM E2E_QUEUE_OPS_RUNNING_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(runningPrompt);
    await waitForComposerText("", "Input box was not cleared after first round send in held queue operation");
    await waitForChatState(
      (snapshot) => snapshot.state === "streaming",
      "Held queue operation did not enter streaming in the first round",
      30000,
    );

    const firstQueuedPrompt =
      `E2E_QUEUE_OPS_FIRST_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    const secondQueuedPrompt =
      `E2E_QUEUE_OPS_SECOND_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    const thirdQueuedPrompt =
      `E2E_QUEUE_OPS_THIRD_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;

    await sendPrompt(firstQueuedPrompt);
    await waitForQueueCount(1);
    await sendPrompt(secondQueuedPrompt);
    await waitForQueueCount(2);
    await sendPrompt(thirdQueuedPrompt);
    let queue = await waitForQueueCount(3);
    expect(queue.map((item) => item.content)).toEqual([
      firstQueuedPrompt,
      secondQueuedPrompt,
      thirdQueuedPrompt,
    ]);

    await clickChatStop();
    await waitForChatState(
      (snapshot) => snapshot.state !== "streaming" && snapshot.queueCount === 3,
      "Did not retain 3 queue items after stopping held queue operation",
      30000,
    );

    queue = await getQueueItems();
    const firstId = queue[0]?.id;
    const secondId = queue[1]?.id;
    const thirdId = queue[2]?.id;
    if (!firstId || !secondId || !thirdId) {
      throw new Error(`Queue项 id 缺失: ${JSON.stringify(queue)}`);
    }

    const editedSecondPrompt =
      `E2E_QUEUE_OPS_SECOND_EDITED_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    const editedRequestsBefore = await countUpstreamRequestsContaining(
      `E2E_QUEUE_OPS_SECOND_EDITED_${runId}`,
    );
    await clickQueueEdit(secondId);
    await setQueueEditInputText(secondId, editedSecondPrompt);
    await clickQueueEditSave(secondId);
    queue = await waitForQueueOrderContaining(
      [
        `E2E_QUEUE_OPS_FIRST_${runId}`,
        `E2E_QUEUE_OPS_SECOND_EDITED_${runId}`,
        `E2E_QUEUE_OPS_THIRD_${runId}`,
      ],
      "Did not keep original order and update content after editing queue item",
    );
    expect(queue[1]?.id).toBe(secondId);
    expect(await getComposerText()).toBe("");
    expect(
      await countUpstreamRequestsContaining(`E2E_QUEUE_OPS_SECOND_EDITED_${runId}`),
    ).toBe(editedRequestsBefore);

    await dragQueueItemOnto(thirdId, firstId);
    queue = await waitForQueueOrderContaining(
      [
        `E2E_QUEUE_OPS_THIRD_${runId}`,
        `E2E_QUEUE_OPS_FIRST_${runId}`,
        `E2E_QUEUE_OPS_SECOND_EDITED_${runId}`,
      ],
      "Reordering queue items did not only change the queue order",
    );
    expect(queue.map((item) => item.id)).toEqual([thirdId, firstId, secondId]);
    expect(await getComposerText()).toBe("");

    const removedRequestsBefore = await countUpstreamRequestsContaining(
      `E2E_QUEUE_OPS_FIRST_${runId}`,
    );
    await clickQueueRemove(firstId);
    queue = await waitForQueueCount(2);
    expect(queue.map((item) => item.id)).toEqual([thirdId, secondId]);
    expect(queue.map((item) => item.content).join("\n")).not.toContain(
      `E2E_QUEUE_OPS_FIRST_${runId}`,
    );
    expect(await getComposerText()).toBe("");
    expect(
      await countUpstreamRequestsContaining(`E2E_QUEUE_OPS_FIRST_${runId}`),
    ).toBe(removedRequestsBefore);
  });
});
