import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  E2E_REPLY_TOKEN,
  assertVisibleUserMessagesNotContaining,
  clickChatStop,
  clickQueueEdit,
  clickQueueEditSave,
  clickQueueRemove,
  countUpstreamRequestsContaining,
  dragQueueItemOnto,
  expectNoUpstreamRequestForTextWithin,
  getQueueItems,
  prepareConversationE2E,
  sendPrompt,
  setQueueEditInputText,
  startNewTask,
  waitForChatState,
  waitForComposerText,
  waitForQueueCount,
  waitForQueueOrderContaining,
} from "../../../helpers/conversation-session.js";

const COMPACT_REQUEST_SENTINEL = "CRITICAL: Respond with TEXT ONLY";

describe("会话区 Goal Queue E2E", () => {
  afterEach(async () => {
    await stopIfStreaming();
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Goal queue items can be edited, deleted, reordered; /compact while running does not enter mixed queue", async function () {
    this.timeout(170000);

    await prepareConversationE2E();
    await startNewTask();

    const runId = Date.now();
    await sendPrompt(
      `E2E_SLOW_STREAM E2E_GOAL_QUEUE_BASE_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`,
    );
    await waitForComposerText("", "Input box not cleared after sending basic goal queue message");
    await waitForChatState(
      (snapshot) => snapshot.state === "streaming",
      "goal queue basic message failed to enter streaming",
      30000,
    );

    const firstGoal = goalPrompt(`E2E_GOAL_QUEUE_FIRST_${runId}`);
    const queuedText = `E2E_GOAL_QUEUE_TEXT_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    const secondGoal = goalPrompt(`E2E_GOAL_QUEUE_SECOND_${runId}`);
    await sendPrompt(firstGoal);
    await sendPrompt(queuedText);
    await sendPrompt(secondGoal);
    await waitForQueueOrderContaining([
      `E2E_GOAL_QUEUE_FIRST_${runId}`,
      `E2E_GOAL_QUEUE_TEXT_${runId}`,
      `E2E_GOAL_QUEUE_SECOND_${runId}`,
    ]);
    let queue = await waitForQueueCount(3);
    expect(queue.map((item) => item.kind)).toEqual(["goal", "text", "goal"]);

    const compactRequestsBefore = await countUpstreamRequestsContaining(
      COMPACT_REQUEST_SENTINEL,
    );
    await sendPrompt("/compact");
    await waitForQueueCount(3);
    await assertVisibleUserMessagesNotContaining("/compact");
    expect(
      await countUpstreamRequestsContaining(COMPACT_REQUEST_SENTINEL),
    ).toBe(compactRequestsBefore);

    await clickChatStop();
    await waitForChatState(
      (snapshot) =>
        snapshot.state !== "streaming" &&
        snapshot.runtimeStatus === "completed" &&
        snapshot.activeInputId === null &&
        snapshot.queueCount === 3,
      "3 queue items were not preserved after goal queue stop",
      30000,
    );

    queue = await getQueueItems();
    const firstId = queue[0]?.id;
    const textId = queue[1]?.id;
    const secondId = queue[2]?.id;
    if (!firstId || !textId || !secondId) {
      throw new Error(`goal queue Queue项 id 缺失: ${JSON.stringify(queue)}`);
    }

    const editedGoalMarker = `E2E_GOAL_QUEUE_SECOND_EDITED_${runId}`;
    const editedGoalRequestsBefore =
      await countUpstreamRequestsContaining(editedGoalMarker);
    await clickQueueEdit(secondId);
    await setQueueEditInputText(secondId, goalObjective(editedGoalMarker));
    await clickQueueEditSave(secondId);
    queue = await waitForQueueOrderContaining([
      `E2E_GOAL_QUEUE_FIRST_${runId}`,
      `E2E_GOAL_QUEUE_TEXT_${runId}`,
      editedGoalMarker,
    ]);
    expect(queue.map((item) => item.kind)).toEqual(["goal", "text", "goal"]);
    expect(await countUpstreamRequestsContaining(editedGoalMarker)).toBe(
      editedGoalRequestsBefore,
    );

    await dragQueueItemOnto(secondId, firstId);
    queue = await waitForQueueOrderContaining([
      editedGoalMarker,
      `E2E_GOAL_QUEUE_FIRST_${runId}`,
      `E2E_GOAL_QUEUE_TEXT_${runId}`,
    ]);
    expect(queue.map((item) => item.id)).toEqual([secondId, firstId, textId]);
    expect(queue.map((item) => item.kind)).toEqual(["goal", "goal", "text"]);

    await clickQueueRemove(firstId);
    queue = await waitForQueueOrderContaining([
      editedGoalMarker,
      `E2E_GOAL_QUEUE_TEXT_${runId}`,
    ]);
    expect(queue.map((item) => item.id)).toEqual([secondId, textId]);
    expect(queue.map((item) => item.kind)).toEqual(["goal", "text"]);
    expect(queue.map((item) => item.content).join("\n")).not.toContain(
      `E2E_GOAL_QUEUE_FIRST_${runId}`,
    );
    await expectNoUpstreamRequestForTextWithin(editedGoalMarker, 800);
  });

  it("Multiple queued goals maintain FIFO while running and are not auto-consumed after stop", async function () {
    this.timeout(190000);

    await prepareConversationE2E();
    await startNewTask();

    const runId = Date.now();
    await sendPrompt(
      `E2E_SLOW_STREAM E2E_GOAL_QUEUE_ORDER_BASE_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`,
    );
    await waitForChatState(
      (snapshot) => snapshot.state === "streaming",
      "goal queue order basic message failed to enter streaming",
      30000,
    );

    const firstMarker = `E2E_GOAL_QUEUE_ORDER_FIRST_${runId}`;
    const secondMarker = `E2E_GOAL_QUEUE_ORDER_SECOND_${runId}`;
    await sendPrompt(goalPrompt(firstMarker));
    await sendPrompt(goalPrompt(secondMarker));
    let queue = await waitForQueueOrderContaining([firstMarker, secondMarker]);
    expect(queue.map((item) => item.kind)).toEqual(["goal", "goal"]);
    await expectNoUpstreamRequestForTextWithin(firstMarker, 800);
    await expectNoUpstreamRequestForTextWithin(secondMarker, 800);

    await clickChatStop();
    await waitForChatState(
      (snapshot) =>
        snapshot.state !== "streaming" &&
        snapshot.runtimeStatus === "completed" &&
        snapshot.activeInputId === null &&
        snapshot.queueCount === 2,
      "2 goals were not preserved after goal queue order stop",
      30000,
    );
    queue = await waitForQueueOrderContaining([firstMarker, secondMarker]);
    expect(queue.map((item) => item.kind)).toEqual(["goal", "goal"]);
    await expectNoUpstreamRequestForTextWithin(firstMarker, 800);
    await expectNoUpstreamRequestForTextWithin(secondMarker, 800);
  });
});

function goalPrompt(marker: string) {
  return `/goal ${goalObjective(marker)}`;
}

function goalObjective(marker: string) {
  return `${marker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
}

async function stopIfStreaming() {
  const snapshot = await waitForChatState(
    () => true,
    "读取 chat 状态失败",
    5000,
  );
  if (snapshot.state !== "streaming") {
    return;
  }
  await clickChatStop().catch(() => undefined);
  await waitForChatState(
    (candidate) => candidate.state !== "streaming",
    "Failed to exit streaming after afterEach stop",
    30000,
  ).catch(() => undefined);
}
