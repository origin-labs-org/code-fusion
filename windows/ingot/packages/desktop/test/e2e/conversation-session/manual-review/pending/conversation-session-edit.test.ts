import { clearAppData } from "../../../helpers/desktop-app.js";
import { waitForUpstreamNetworkCapture } from "../../../helpers/upstream-capture.js";
import {
  E2E_REPLY_TOKEN,
  assertVisibleUserMessagesNotContaining,
  buildReadonlyToolPrompt,
  clickChatStop,
  countUpstreamRequestsContaining,
  editUserMessageContaining,
  expectNoUpstreamRequestForTextWithin,
  getEditButtonForAssistantContaining,
  getQueueItems,
  getTaskStoreSnapshot,
  prepareConversationE2E,
  sendPrompt,
  startNewTask,
  typeChatPrompt,
  clickChatSend,
  waitForAssistantMessageContaining,
  waitForChatState,
  waitForCompactMarkerStatus,
  waitForComposerText,
  waitForUpstreamRequestContaining,
  waitForEditButtonForUserContaining,
  waitForQueueContaining,
  waitForQueueCount,
  waitForToastContaining,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";

const COMPACT_REQUEST_SENTINEL = "CRITICAL: Respond with TEXT ONLY";
const COMPACT_DUPLICATE_BLOCKED_TOAST_TEXTS = [
  "A compaction is already running or queued.",
  "已有压缩任务正在运行或排队。",
];
const RESOLVE_USER_MESSAGE_ERROR = "Cannot resolve user message";
const REWIND_RUNNING_ERROR = "Cannot rewind while a prompt is running";
const EDIT_INTERRUPTED_SOURCE_REPLY_PREFIX = "deep";
const EDIT_INTERRUPTED_RERUN_REPLY_TOKEN = "upstream-e2e-edit-rerun-ok";

describe("会话区 Edit User Query E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("user query edit should rerun immediately; keeps queue when held queue exists, running latest edit can preempt", async function () {
    this.timeout(220000);

    await prepareConversationE2E();

    const runId = Date.now();
    const originalPrompt = `E2E_EDIT_ORIGINAL_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(originalPrompt);
    await waitForUpstreamNetworkCapture(`E2E_EDIT_ORIGINAL_${runId}`);
    await waitForAssistantMessageContaining(E2E_REPLY_TOKEN);
    await waitForChatState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      "First turn did not finish before edit",
      90000,
    );

    expect((await getEditButtonForAssistantContaining(E2E_REPLY_TOKEN))?.exists).not.toBe(true);

    const editedPrompt = buildReadonlyToolPrompt(`E2E_EDIT_RERUN_${runId}`);
    await editUserMessageContaining(`E2E_EDIT_ORIGINAL_${runId}`, editedPrompt);
    await waitForComposerText("", "Input box was not cleared after edit submission");
    await waitForUpstreamNetworkCapture(`E2E_EDIT_RERUN_${runId}`);
    await waitForUserMessageContaining(`E2E_EDIT_RERUN_${runId}`);
    await assertVisibleUserMessagesNotContaining(`E2E_EDIT_ORIGINAL_${runId}`);
    await waitForChatState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      "edit 重跑完成后会话没有回到 idle",
      90000,
    );

    await startNewTask();

    const slowPrompt = `E2E_SLOW_STREAM E2E_EDIT_HELD_RUNNING_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(slowPrompt);
    await waitForComposerText("", "Input box was not cleared after first turn sent in held queue scenario");
    await waitForChatState(
      (snapshot) => snapshot.state === "streaming",
      "Did not enter streaming in first turn in held queue scenario",
      30000,
    );

    const heldPrompt = `E2E_EDIT_HELD_QUEUE_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(heldPrompt);
    await waitForQueueContaining(`E2E_EDIT_HELD_QUEUE_${runId}`);
    const heldQueue = await waitForQueueCount(1);
    const heldQueueItemId = heldQueue[0]?.id;
    expect(heldQueueItemId).toBeTruthy();

    await clickChatStop();
    await waitForChatState(
      (snapshot) => snapshot.state !== "streaming" && snapshot.queueCount === 1,
      "held queue was not retained after stop",
      30000,
    );
    await expectNoUpstreamRequestForTextWithin(`E2E_EDIT_HELD_QUEUE_${runId}`, 900);

    const heldEditPrompt = `E2E_SLOW_STREAM E2E_EDIT_HELD_RERUN_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await editUserMessageContaining(`E2E_EDIT_HELD_RUNNING_${runId}`, heldEditPrompt);
    await waitForUpstreamRequestContaining(`E2E_EDIT_HELD_RERUN_${runId}`);
    await waitForUserMessageContaining(`E2E_EDIT_HELD_RERUN_${runId}`);
    await waitForChatState(
      (snapshot) => snapshot.state === "streaming" && snapshot.queueCount === 1,
      "edit did not rerun immediately and retain queue when held queue exists",
      30000,
    );
    expect((await getQueueItems())[0]?.id).toBe(heldQueueItemId);

    await waitForEditButtonForUserContaining(`E2E_EDIT_HELD_RERUN_${runId}`);

    const followupPrompt = `E2E_EDIT_RUNNING_FOLLOWUP_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(followupPrompt);
    await waitForQueueContaining(`E2E_EDIT_RUNNING_FOLLOWUP_${runId}`);
    await waitForQueueCount(2);

    const goalPrompt = `/goal E2E_EDIT_RUNNING_GOAL_${runId}`;
    await sendPrompt(goalPrompt);
    await waitForQueueContaining(`E2E_EDIT_RUNNING_GOAL_${runId}`);
    let queue = await waitForQueueCount(3);
    expect(queue.map((item) => item.kind)).toEqual(["text", "text", "goal"]);
    await expectNoUpstreamRequestForTextWithin(`E2E_EDIT_RUNNING_GOAL_${runId}`, 800);

    await waitForChatState(
      (snapshot) =>
        snapshot.state !== "streaming" &&
        snapshot.runtimeStatus === "completed" &&
        snapshot.queueCount === 3,
      "Failed to steadily retain 3 queued items after edit rerun completed",
      90000,
    );

    const compactRequestsBefore = await countUpstreamRequestsContaining(COMPACT_REQUEST_SENTINEL);
    await sendPrompt("/compact");
    await waitForComposerText("", "Input box was not cleared after sending manual compact under held queue");
    const startedMarker = await waitForCompactMarkerStatus("started", "manual");
    expect(startedMarker.inputId).toBeTruthy();
    await browser.waitUntil(
      async () =>
        (await countUpstreamRequestsContaining(COMPACT_REQUEST_SENTINEL)) ===
        compactRequestsBefore + 1,
      {
        timeout: 10000,
        timeoutMsg: "held queue 下没有捕获到手动 compact 请求",
      },
    );
    queue = await waitForQueueCount(3);
    expect(queue.map((item) => item.kind)).toEqual(["text", "text", "goal"]);

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
    queue = await waitForQueueCount(3);
    expect(queue.map((item) => item.kind)).toEqual(["text", "text", "goal"]);
    await assertVisibleUserMessagesNotContaining("/compact");

    const completedMarker = await waitForCompactMarkerStatus(
      "completed",
      "manual",
      startedMarker.inputId,
    );
    expect(completedMarker.operationId).toBeTruthy();
    await waitForChatState(
      (snapshot) =>
        snapshot.state !== "streaming" &&
        snapshot.runtimeStatus === "completed" &&
        snapshot.queueCount === 3,
      "queue was not retained after manual compact completed under held queue",
      90000,
    );
  });

  it("Editing and resubmitting a sent user query after interrupting model response should not trigger turnIndex parse error", async function () {
    this.timeout(160000);

    await prepareConversationE2E();

    const runId = Date.now();
    const sourceMarker = `E2E_EDIT_INTERRUPTED_RESUBMIT_SOURCE_${runId}`;
    const rerunMarker = `E2E_EDIT_INTERRUPTED_RESUBMIT_RERUN_${runId}`;
    const rerunReplyToken = EDIT_INTERRUPTED_RERUN_REPLY_TOKEN;
    const sourcePrompt = `E2E_SLOW_STREAM ${sourceMarker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(sourcePrompt);
    await waitForComposerText("", "Input box was not cleared after sending source prompt in interrupted resubmit");
    const runningSnapshot = await waitForChatState(
      (snapshot) =>
        snapshot.state === "streaming" && Boolean(snapshot.sessionId || snapshot.taskId),
      "Source prompt did not enter streaming in interrupted resubmit",
      30000,
    );
    const taskId = runningSnapshot.sessionId || runningSnapshot.taskId;
    if (!taskId) {
      throw new Error("Source prompt missing taskId/sessionId in interrupted resubmit");
    }

    await waitForAssistantMessageContaining(EDIT_INTERRUPTED_SOURCE_REPLY_PREFIX);
    await clickChatStop();
    await waitForUserMessageContaining(sourceMarker);
    await waitForChatState(
      (snapshot) =>
        (snapshot.sessionId || snapshot.taskId) === taskId &&
        snapshot.state !== "streaming" &&
        snapshot.runtimeStatus === "completed" &&
        snapshot.queueCount === 0,
      "Did not enter editable completed(interrupted) state after stop in interrupted resubmit",
      30000,
    );

    const editedPrompt = `${rerunMarker}: Reply with exactly "${rerunReplyToken}" and no other text.`;
    await browser.pause(500);
    await editUserMessageContaining(sourceMarker, editedPrompt);
    await waitForComposerText("", "Input box was not cleared after edit submission in interrupted resubmit");
    const outcome = await waitForInterruptedEditOutcomeWithoutResolveUserMessageError(
      rerunMarker,
      taskId,
    );
    if (outcome === "busy") {
      await expectNoUpstreamRequestForTextWithin(rerunMarker, 800);
      return;
    }
    await waitForUserMessageContaining(rerunMarker);
    await assertVisibleUserMessagesNotContaining(sourceMarker);
    await waitForAssistantMessageContaining(rerunReplyToken);
    await waitForChatState(
      (snapshot) =>
        (snapshot.sessionId || snapshot.taskId) === taskId &&
        snapshot.state === "idle" &&
        snapshot.queueCount === 0,
      "Did not return to idle after edit rerun in interrupted resubmit",
      90000,
    );
  });
});

async function waitForInterruptedEditOutcomeWithoutResolveUserMessageError(
  expectedText: string,
  taskId: string,
): Promise<"rerun" | "busy"> {
  let latestStore: Awaited<ReturnType<typeof getTaskStoreSnapshot>> | null = null;
  let requestCount = 0;
  try {
    await browser.waitUntil(
      async () => {
        const [nextRequestCount, nextStore] = await Promise.all([
          countUpstreamRequestsContaining(expectedText),
          getTaskStoreSnapshot(taskId),
        ]);
        requestCount = nextRequestCount;
        latestStore = nextStore;
        const taskErrorText = getTaskErrorText(latestStore);
        return (
          requestCount > 0 ||
          hasCannotResolveUserMessageError(taskErrorText) ||
          hasRewindRunningError(taskErrorText)
        );
      },
      {
        timeout: 45000,
        timeoutMsg: `interrupted resubmit edit 没有发FromRerunRequest: ${expectedText}`,
      },
    );
  } catch (error) {
    latestStore = await getTaskStoreSnapshot(taskId);
    throw new Error(
      [
        `interrupted resubmit edit 没有发FromRerunRequest: ${expectedText}`,
        `requestCount=${requestCount}`,
        `taskStore=${JSON.stringify(latestStore)}`,
      ].join("; "),
      { cause: error },
    );
  }

  const taskErrorText = getTaskErrorText(latestStore);
  if (hasCannotResolveUserMessageError(taskErrorText)) {
    throw new Error(`interrupted resubmit edit 触发了 user message 解析Error: ${taskErrorText}`);
  }
  if (requestCount > 0) {
    return "rerun";
  }
  if (hasRewindRunningError(taskErrorText)) {
    return "busy";
  }
  throw new Error(
    `interrupted resubmit edit 没有得到 rerun or busy guard: ${expectedText}; taskStore=${JSON.stringify(
      latestStore,
    )}`,
  );
}

function getTaskErrorText(snapshot: Awaited<ReturnType<typeof getTaskStoreSnapshot>> | null) {
  return [snapshot?.error, snapshot?.uiError].filter(Boolean).join("\n");
}

function hasCannotResolveUserMessageError(errorText: string) {
  return (
    errorText.includes(RESOLVE_USER_MESSAGE_ERROR) ||
    errorText.includes("Cannot resolve user message for turnlndex")
  );
}

function hasRewindRunningError(errorText: string) {
  return errorText.includes(REWIND_RUNNING_ERROR);
}
