import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  E2E_REPLY_TOKEN,
  assertVisibleUserMessagesNotContaining,
  buildReadonlyToolPrompt,
  clickChatSend,
  countUpstreamRequestsContaining,
  expectNoUpstreamRequestForTextWithin,
  getForkButtonForAssistantContaining,
  prepareConversationE2E,
  sendPrompt,
  typeChatPrompt,
  waitForAssistantMessageContaining,
  waitForChatState,
  waitForCompactMarkerStatus,
  waitForComposerText,
  waitForUpstreamRequestContaining,
  waitForToastContaining,
  waitForQueueContaining,
  waitForQueueCount,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";

const COMPACT_REQUEST_SENTINEL = "CRITICAL: Respond with TEXT ONLY";
const COMPACT_DUPLICATE_BLOCKED_TOAST_TEXTS = [
  "A compaction is already running or queued.",
  "已有压缩任务正在运行或排队。",
];

describe("会话区 Compacting Actions E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("手动 compacting 中普通输入和 /goal 只入队、重复 /compact 不抢占；compact 完成后继续消费 queue", async function () {
    this.timeout(240000);

    await prepareConversationE2E();

    const runId = Date.now();
    const prepPromptOne = buildReadonlyToolPrompt(`E2E_COMPACTING_ACTIONS_PREP_ONE_${runId}`);
    await sendPrompt(prepPromptOne);
    await waitForComposerText("", "compacting actions 第一轮发送后输入框没有清空");
    await waitForUpstreamRequestContaining(`E2E_COMPACTING_ACTIONS_PREP_ONE_${runId}`);
    await waitForChatState(
      (snapshot) =>
        snapshot.state === "idle" &&
        snapshot.runtimeStatus === "completed" &&
        snapshot.activeInputId === null &&
        snapshot.queueCount === 0,
      "compacting actions 第一轮预置消息没有完成",
      90000,
    );

    const prepPromptTwo = buildReadonlyToolPrompt(`E2E_COMPACTING_ACTIONS_PREP_TWO_${runId}`);
    await sendPrompt(prepPromptTwo);
    await waitForComposerText("", "compacting actions 第二轮发送后输入框没有清空");
    await waitForUpstreamRequestContaining(`E2E_COMPACTING_ACTIONS_PREP_TWO_${runId}`);
    await waitForAssistantMessageContaining(E2E_REPLY_TOKEN);
    await waitForChatState(
      (snapshot) =>
        snapshot.state === "idle" &&
        snapshot.runtimeStatus === "completed" &&
        snapshot.activeInputId === null &&
        snapshot.queueCount === 0,
      "compacting actions 第二轮预置消息没有完成",
      90000,
    );

    const compactRequestsBefore = await countUpstreamRequestsContaining(COMPACT_REQUEST_SENTINEL);
    await sendPrompt("/compact");
    await waitForComposerText("", "/compact 发送后输入框没有清空");

    const startedMarker = await waitForCompactMarkerStatus("started", "manual");
    expect(startedMarker.inputId).toBeTruthy();
    await browser.waitUntil(
      async () =>
        (await countUpstreamRequestsContaining(COMPACT_REQUEST_SENTINEL)) ===
        compactRequestsBefore + 1,
      {
        timeout: 10000,
        timeoutMsg: "没有捕获到 compacting actions 的手动 compact 请求",
      },
    );

    const forkButton = await getForkButtonForAssistantContaining(E2E_REPLY_TOKEN);
    expect(forkButton?.exists).toBe(true);
    expect(forkButton?.ariaDisabled || forkButton?.disabled).toBe(true);

    const queuedTextPrompt = `E2E_COMPACTING_ACTIONS_TEXT_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(queuedTextPrompt);
    await waitForComposerText("", "compacting 中普通文本发送后输入框没有清空");
    await waitForQueueContaining(`E2E_COMPACTING_ACTIONS_TEXT_${runId}`);
    let queue = await waitForQueueCount(1);
    expect(queue[0]?.kind).toBe("text");

    const queuedGoalMarker = `E2E_COMPACTING_ACTIONS_GOAL_${runId}`;
    const queuedGoalPrompt = `/goal ${queuedGoalMarker}`;
    await sendPrompt(queuedGoalPrompt);
    await waitForComposerText("", "compacting 中 /goal 发送后输入框没有清空");
    await waitForQueueContaining(`E2E_COMPACTING_ACTIONS_GOAL_${runId}`);
    queue = await waitForQueueCount(2);
    expect(queue.map((item) => item.kind)).toEqual(["text", "goal"]);

    const duplicateCompactRequestsBefore =
      await countUpstreamRequestsContaining(COMPACT_REQUEST_SENTINEL);
    await typeChatPrompt("/compact");
    await clickChatSend();
    await waitForToastContaining(
      COMPACT_DUPLICATE_BLOCKED_TOAST_TEXTS,
      "compacting 中重复 /compact 没有弹出 duplicate blocked toast",
    );
    await expectNoUpstreamRequestForTextWithin(COMPACT_REQUEST_SENTINEL, 800);
    expect(await countUpstreamRequestsContaining(COMPACT_REQUEST_SENTINEL)).toBe(
      duplicateCompactRequestsBefore,
    );
    await waitForQueueCount(2);
    await assertVisibleUserMessagesNotContaining("/compact");

    const completedMarker = await waitForCompactMarkerStatus(
      "completed",
      "manual",
      startedMarker.inputId,
      15000,
    ).catch(() => null);
    if (completedMarker) {
      expect(completedMarker.operationId).toBeTruthy();
    }
    await waitForUpstreamRequestContaining(`E2E_COMPACTING_ACTIONS_TEXT_${runId}`);
    await waitForUserMessageContaining(queuedTextPrompt);
    await waitForChatState(
      (snapshot) =>
        snapshot.state === "idle" &&
        snapshot.runtimeStatus === "completed" &&
        snapshot.activeInputId === null &&
        snapshot.queueCount === 0 &&
        (snapshot.targetObjective ?? "").includes(queuedGoalMarker),
      "manual compact 完成后没有继续消费 compacting 期间追加的 text/goal queue",
      120000,
    );
  });
});
