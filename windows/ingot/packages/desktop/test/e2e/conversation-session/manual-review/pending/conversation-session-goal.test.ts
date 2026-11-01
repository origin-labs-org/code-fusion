import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  E2E_REPLY_TOKEN,
  assertVisibleUserMessagesNotContaining,
  clickChatStop,
  countUpstreamRequestsContaining,
  expectNoUpstreamRequestForTextWithin,
  getChatRootSnapshot,
  prepareConversationE2E,
  sendPrompt,
  startNewTask,
  waitForChatState,
  waitForComposerText,
  waitForQueueContaining,
  waitForQueueCount,
  waitForTaskStoreSnapshot,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";

describe("Session area Goal E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Under completed, /goal sets and updates targets; under running and held queue, it only enqueues", async function () {
    this.timeout(180000);

    await prepareConversationE2E();

    const runId = Date.now();
    const firstGoalObjective =
      `E2E_GOAL_SET_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    const firstGoal = `/goal ${firstGoalObjective}`;
    await sendPrompt(firstGoal);
    await waitForComposerText("", "Input box was not cleared after sending first /goal");
    await waitForUserMessageContaining(firstGoalObjective);
    await waitForChatState(
      (snapshot) =>
        snapshot.queueCount === 0 &&
        snapshot.targetStatus === "active" &&
        snapshot.targetObjective?.includes(`E2E_GOAL_SET_${runId}`) === true,
      "首个 /goal 没有设置 active target",
      90000,
    );
    const firstGoalStreaming = await waitForChatState(
      (snapshot) => snapshot.state === "streaming",
      "Did not enter goal verification/continue running after first /goal was set",
      30000,
    );
    expect(firstGoalStreaming.targetStatus).toBe("active");
    expect(firstGoalStreaming.targetStatus).not.toBe("validating");
    await expectNoGoalValidatingLockForWindow(firstGoalStreaming);
    await assertVisibleUserMessagesNotContaining("goal-continuation");
    await assertVisibleUserMessagesNotContaining("Current session goal state");
    const firstGoalCompletedSnapshot = await waitForChatState(
      (snapshot) =>
        snapshot.state !== "streaming" &&
        !snapshot.stopRequested &&
        snapshot.queueCount === 0 &&
        snapshot.targetObjective?.includes(`E2E_GOAL_SET_${runId}`) === true &&
        isCompletedTargetStatus(snapshot.targetStatus),
      "首个 /goal 没有通过 verifier 自然进入完成态",
      60000,
    );
    if (!firstGoalCompletedSnapshot.taskId) {
      throw new Error("首个 /goal 完成后没有可用 taskId");
    }
    await waitForTaskStoreSnapshot(
      firstGoalCompletedSnapshot.taskId,
      (snapshot) =>
        snapshot.activeInputId === null &&
        snapshot.queueCount === 0 &&
        snapshot.runtimeStatus === "completed" &&
        snapshot.taskMeta?.targetObjective?.includes(`E2E_GOAL_SET_${runId}`) === true &&
        isCompletedTargetStatus(snapshot.taskMeta?.targetStatus ?? null),
      "Task store did not settle to completed target after first /goal completed",
      30000,
    );

    const updatedGoalObjective =
      `E2E_GOAL_UPDATE_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    const updatedGoal = `/goal ${updatedGoalObjective}`;
    await sendPrompt(updatedGoal);
    await waitForComposerText("", "Input box was not cleared after sending updated /goal");
    await waitForUserMessageContaining(updatedGoalObjective);
    await waitForChatState(
      (snapshot) =>
        snapshot.queueCount === 0 &&
        snapshot.targetStatus === "active" &&
        snapshot.targetObjective?.includes(`E2E_GOAL_UPDATE_${runId}`) === true,
      "Updated /goal did not replace active target",
      90000,
    );
    const updatedGoalStreaming = await waitForChatState(
      (snapshot) => snapshot.state === "streaming",
      "Did not enter goal verification/continue running after updating /goal",
      30000,
    );
    expect(updatedGoalStreaming.targetStatus).toBe("active");
    expect(updatedGoalStreaming.targetStatus).not.toBe("validating");
    await expectNoGoalValidatingLockForWindow(updatedGoalStreaming);
    await waitForChatState(
      (snapshot) =>
        snapshot.state !== "streaming" &&
        !snapshot.stopRequested &&
        snapshot.queueCount === 0 &&
        snapshot.targetObjective?.includes(`E2E_GOAL_UPDATE_${runId}`) === true &&
        isCompletedTargetStatus(snapshot.targetStatus),
      "Updated /goal did not naturally enter completed state via verifier",
      60000,
    );

    await startNewTask();
    await waitForChatState(
      (snapshot) => snapshot.taskId === null && snapshot.queueCount === 0,
      "Did not enter empty session draft state after creating new task",
      15000,
    );

    const slowPrompt =
      `E2E_SLOW_STREAM E2E_GOAL_RUNNING_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(slowPrompt);
    await waitForComposerText("", "Input box was not cleared after sending normal message with goal already set");
    await waitForChatState(
      (snapshot) => snapshot.state === "streaming",
      "Normal message failed to enter streaming after goal was already set",
      30000,
    );

    const runningGoal = `/goal E2E_GOAL_RUNNING_QUEUE_${runId}`;
    await sendPrompt(runningGoal);
    await waitForQueueContaining(`E2E_GOAL_RUNNING_QUEUE_${runId}`);
    let queue = await waitForQueueCount(1);
    expect(queue[0]?.kind).toBe("goal");
    await expectNoUpstreamRequestForTextWithin(
      `E2E_GOAL_RUNNING_QUEUE_${runId}`,
      900,
    );

    await clickChatStop();
    await waitForChatState(
      (snapshot) =>
        snapshot.state !== "streaming" &&
        snapshot.queueCount === 1,
      "/goal queue appended during running was not preserved after stop",
      30000,
    );

    const heldGoal = `/goal E2E_GOAL_HELD_QUEUE_${runId}`;
    const heldRequestsBefore = await countUpstreamRequestsContaining(
      `E2E_GOAL_HELD_QUEUE_${runId}`,
    );
    await sendPrompt(heldGoal);
    await waitForQueueContaining(`E2E_GOAL_HELD_QUEUE_${runId}`);
    queue = await waitForQueueCount(2);
    expect(queue.map((item) => item.kind)).toEqual(["goal", "goal"]);
    await expectNoUpstreamRequestForTextWithin(
      `E2E_GOAL_HELD_QUEUE_${runId}`,
      900,
    );
    expect(await countUpstreamRequestsContaining(`E2E_GOAL_HELD_QUEUE_${runId}`)).toBe(
      heldRequestsBefore,
    );
  });
});

function isCompletedTargetStatus(status: string | null) {
  return status === "complete" || status === "completed";
}

async function expectNoGoalValidatingLockForWindow(
  initialSnapshot: Awaited<ReturnType<typeof getChatRootSnapshot>>,
  durationMs = 800,
) {
  const deadline = Date.now() + durationMs;
  let sawStreaming = initialSnapshot.state === "streaming";
  let sawActiveTarget = initialSnapshot.targetStatus === "active";
  const statuses: Array<{ state: string | null; targetStatus: string | null }> = [
    {
      state: initialSnapshot.state,
      targetStatus: initialSnapshot.targetStatus,
    },
  ];

  while (Date.now() < deadline) {
    const snapshot = await getChatRootSnapshot();
    statuses.push({
      state: snapshot.state,
      targetStatus: snapshot.targetStatus,
    });
    sawStreaming ||= snapshot.state === "streaming";
    sawActiveTarget ||= snapshot.targetStatus === "active";
    expect(snapshot.targetStatus).not.toBe("validating");
    await browser.pause(100);
  }

  expect({ sawActiveTarget, sawStreaming, statuses }).toEqual(
    expect.objectContaining({
      sawActiveTarget: true,
      sawStreaming: true,
    }),
  );
}
