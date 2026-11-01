import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  E2E_REPLY_TOKEN,
  assertVisibleUserMessagesNotContaining,
  clickChatSend,
  countUpstreamRequestsContainingAll,
  expectNoUpstreamRequestForTextWithin,
  getQueueItems,
  prepareConversationE2E,
  sendPrompt,
  typeChatPrompt,
  waitForChatState,
  waitForCompactMarkerStatuses,
  waitForCompactMarkerStatus,
  waitForUpstreamRequest,
  waitForComposerText,
  waitForUpstreamRequestContaining,
  waitForUserMessageContaining,
  type QueueItemSnapshot,
} from "../../../helpers/conversation-session.js";

const ACTION_MARKER = "E2E_AUTO_ACTIONS";
const COMPACT_REQUEST_SENTINEL = "CRITICAL: Respond with TEXT ONLY";

describe("会话区 Auto Compact Actions E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("auto compacting 中普通文本和 /goal 入队，重复 /compact 被拒绝；compact 完成后继续消费 queue", async function () {
    this.timeout(240000);

    await prepareConversationE2E();

    const runId = Date.now();
    const seedPrompt =
      `${ACTION_MARKER}_CONTEXT_SEED_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(seedPrompt);
    await waitForComposerText("", "auto compact actions 第一轮发送后输入框没有清空");
    await waitForUpstreamRequestContaining(`${ACTION_MARKER}_CONTEXT_SEED_${runId}`);
    await waitForChatState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      "auto compact actions 第一轮没有完成",
      90000,
    );

    const compactRequestsBefore = await countUpstreamRequestsContainingAll([
      COMPACT_REQUEST_SENTINEL,
      ACTION_MARKER,
    ]);
    const pendingPrompt =
      `${ACTION_MARKER}_PENDING_TEXT_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(pendingPrompt);
    await waitForComposerText("", "auto compact actions pending 文本发送后输入框没有清空");
    await waitForUserMessageContaining(pendingPrompt);
    const compactMarker = await waitForCompactMarkerStatuses(["started", "skipped"], "auto");
    expect(compactMarker.trigger).toBe("auto");

    if (compactMarker.status === "skipped") {
      expect(
        await countUpstreamRequestsContainingAll([COMPACT_REQUEST_SENTINEL, ACTION_MARKER]),
      ).toBe(compactRequestsBefore);
      await waitForMainModelRequest(`${ACTION_MARKER}_PENDING_TEXT_${runId}`);
      await waitForChatState(
        (snapshot) =>
          snapshot.state === "idle" &&
          snapshot.runtimeStatus === "completed" &&
          snapshot.activeInputId === null &&
          snapshot.queueCount === 0,
        "auto compact skipped 后没有继续消费 pendingAction",
        90000,
      );
      return;
    }

    const startedMarker = compactMarker;

    await browser.waitUntil(
      async () =>
        (await countUpstreamRequestsContainingAll([
          COMPACT_REQUEST_SENTINEL,
          ACTION_MARKER,
        ])) === compactRequestsBefore + 1,
      {
        timeout: 30000,
        timeoutMsg: "auto compact actions 没有捕获到自动 compact 请求",
      },
    );

    await typeChatPrompt("/compact");
    await clickChatSend();
    await waitForComposerText("", "auto compacting 中重复 /compact 后输入框没有清空");
    await expectNoUpstreamRequestForTextWithin(COMPACT_REQUEST_SENTINEL, 800);
    expect(
      await countUpstreamRequestsContainingAll([COMPACT_REQUEST_SENTINEL, ACTION_MARKER]),
    ).toBe(compactRequestsBefore + 1);
    await assertVisibleUserMessagesNotContaining("/compact");

    const queuedTextPrompt =
      `${ACTION_MARKER}_QUEUED_TEXT_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(queuedTextPrompt);
    await waitForComposerText("", "auto compacting 中普通文本发送后输入框没有清空");
    const queuedText = await waitForQueueItemContaining(
      `${ACTION_MARKER}_QUEUED_TEXT_${runId}`,
    );
    expect(queuedText.kind).toBe("text");

    const queuedGoalMarker = `${ACTION_MARKER}_QUEUED_GOAL_${runId}`;
    const queuedGoalPrompt = `/goal ${queuedGoalMarker}`;
    await sendPrompt(queuedGoalPrompt);
    await waitForComposerText("", "auto compacting 中 /goal 发送后输入框没有清空");
    const queuedGoal = await waitForQueueItemContaining(
      `${ACTION_MARKER}_QUEUED_GOAL_${runId}`,
    );
    expect(queuedGoal.kind).toBe("goal");
    expect(
      await countUpstreamRequestsContainingAll([COMPACT_REQUEST_SENTINEL, ACTION_MARKER]),
    ).toBe(compactRequestsBefore + 1);

    const completedMarker = await waitForCompactMarkerStatus(
      "completed",
      "auto",
      startedMarker.inputId,
    );
    expect(completedMarker.operationId).toBeTruthy();
    await waitForMainModelRequest(`${ACTION_MARKER}_PENDING_TEXT_${runId}`);
    await waitForMainModelRequest(`${ACTION_MARKER}_QUEUED_TEXT_${runId}`);
    await waitForUserMessageContaining(queuedTextPrompt);
    await waitForChatState(
      (snapshot) =>
        snapshot.state === "idle" &&
        snapshot.runtimeStatus === "completed" &&
        snapshot.activeInputId === null &&
        snapshot.queueCount === 0 &&
        (snapshot.targetObjective ?? "").includes(queuedGoalMarker),
      "auto compact 完成后没有继续消费 pendingAction 和 compacting 期间追加的 text/goal queue",
      120000,
    );
  });
});

async function waitForMainModelRequest(marker: string) {
  await waitForUpstreamRequest(
    {
      excludes: [COMPACT_REQUEST_SENTINEL],
      includes: [marker],
    },
    `auto compact 后没有Continue发From主Model request: ${marker}`,
    90000,
  );
}

async function waitForQueueItemContaining(text: string): Promise<QueueItemSnapshot> {
  let latest: QueueItemSnapshot[] = [];
  await browser.waitUntil(
    async () => {
      latest = await getQueueItems();
      return latest.some((item) => item.content.includes(text));
    },
    {
      timeout: 30000,
      timeoutMsg: `QueueMedium没有出现 ${text}; latest=${JSON.stringify(latest)}`,
    },
  );
  const item = latest.find((candidate) => candidate.content.includes(text));
  if (!item) {
    throw new Error(`Queue项 ${text} 在Waiting后仍不存在`);
  }
  return item;
}
