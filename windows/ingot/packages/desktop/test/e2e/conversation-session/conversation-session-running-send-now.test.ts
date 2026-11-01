import { TID_CHAT_QUEUE_SEND_NOW_BUTTON, TID_V4_QUEUE_ITEM_SEND_NOW } from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../helpers/desktop-app.js";
import {
  INCOMING_MESSAGE_MODES,
  prepareIncomingMessageCapability,
} from "../helpers/incoming-message-capability.js";
import { assertIncomingMessage, wireText } from "../helpers/incoming-message-evidence.js";
import {
  UPSTREAM_MODEL,
  UPSTREAM_THOUGHT_LEVEL,
  selectUpstreamModelById,
  selectUpstreamThoughtLevelValue,
} from "../helpers/upstream-provider.js";
import {
  countUpstreamRequestsContaining,
  getUpstreamRequestEvidence,
  expectNoUpstreamRequestForTextWithin,
  waitForUpstreamRequestContaining,
} from "../helpers/conversation-session-network.js";
import {
  clickFirstQueueSendNow,
  clickQueueSendNow,
  getQueueItems,
  waitForQueueCount,
  waitForQueueOrderContaining,
} from "../helpers/conversation-session-queue.js";
import {
  E2E_REPLY_TOKEN,
  clickV4Stop,
  getV4ConversationState,
  getV4GoalProjection,
  getV4Messages,
  prepareV4ConversationE2E,
  sendV4Prompt,
  startNewV4Draft,
  waitForV4ComposerText,
  waitForV4ConversationState,
  waitForV4UserMessageContaining,
  waitForV4AssistantMessageContaining,
} from "../helpers/v4-conversation.js";

const RUNNING_SEND_NOW_TIMEOUT_MS = 180000;

describe("Chat area Running Queue Immediate Steering E2E", () => {
  before(async function () {
    this.timeout(RUNNING_SEND_NOW_TIMEOUT_MS);

    await prepareV4ConversationE2E();
  });

  beforeEach(async function () {
    this.timeout(RUNNING_SEND_NOW_TIMEOUT_MS);

    await startNewV4Draft();
    await selectUpstreamModelById(UPSTREAM_MODEL);
    await selectUpstreamThoughtLevelValue(UPSTREAM_THOUGHT_LEVEL);
  });

  afterEach(async () => {
    await stopIfBusy();
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  for (const { label, mcs } of INCOMING_MESSAGE_MODES) {
    it(`M07a ${label}：running Medium点击队首立即Onboarding，消费Original text并以 user reminder 降级`, async function () {
      this.timeout(RUNNING_SEND_NOW_TIMEOUT_MS);

      await prepareIncomingMessageCapability(mcs, "queue");
      const runId = Date.now();
      await startSlowRunningTurn(`E2E_RUNNING_SEND_NOW_HEAD_BASE_${runId}`);
      await waitForV4AssistantMessageContaining("send-now-head-partial");

      const queuedMarker = `E2E_RUNNING_SEND_NOW_HEAD_${runId}`;
      await enqueueTextPrompt(queuedMarker);
      const queuedBeforeSendNow = await waitForQueueOrderContaining(
        [queuedMarker],
        "text queue was not formed before clicking running send-now queue head",
      );
      expect(queuedBeforeSendNow[0]?.kind).toBe("text");

      const requestsBefore = await countUpstreamRequestsContaining(queuedMarker);
      const sentNowItem = await clickFirstQueueSendNow();
      expect(sentNowItem.id).toBe(queuedBeforeSendNow[0]?.id);
      expect(sentNowItem.content).toContain(queuedMarker);

      await waitForUpstreamRequestContaining(queuedMarker, 60000);
      await waitForV4UserMessageContaining(queuedMarker);
      await waitForV4ConversationState(
        (snapshot) => snapshot.queueCount === 0,
        "running send-now head message was not consumed from queue",
        45000,
      );
      expect(await countUpstreamRequestsContaining(queuedMarker)).toBeGreaterThan(requestsBefore);
      const evidence = await getUpstreamRequestEvidence({
        includes: [queuedMarker],
        excludes: ["Generate a concise title"],
      });
      const wire = await assertIncomingMessage(evidence.at(-1)!.requestJson, {
        presentation: "user_steer",
        marker: queuedMarker,
        body: buildQueuedPrompt(queuedMarker),
        role: "user",
        evidenceLabel: `send-now-head-${label}`,
      });
      expect(wire.messages[wire.index - 1]?.role).toBe("assistant");
      expect(wireText(wire.messages[wire.index - 1]?.content)).toContain("send-now-head-partial");
      const userRows = (await getV4Messages("user")).filter((message) =>
        message.text.includes(queuedMarker),
      );
      expect(userRows).toHaveLength(1);
      expect(
        await $(`[data-row-id="${userRows[0]!.id}"] [data-v4-user-input-bubble]`).getText(),
      ).toBe(buildQueuedPrompt(queuedMarker));
    });
  }

  it("Clicking non-head queued text for immediate steering while running should promote and only consume the clicked message", async function () {
    this.timeout(RUNNING_SEND_NOW_TIMEOUT_MS);

    const runId = Date.now();
    await startSlowRunningTurn(`E2E_RUNNING_SEND_NOW_PROMOTE_BASE_${runId}`);

    const firstMarker = `E2E_RUNNING_SEND_NOW_PROMOTE_FIRST_${runId}`;
    const secondMarker = `E2E_RUNNING_SEND_NOW_PROMOTE_SECOND_${runId}`;
    await enqueueTextPrompt(firstMarker);
    await enqueueTextPrompt(secondMarker, { slow: true });

    const queuedBeforeSendNow = await waitForQueueOrderContaining(
      [firstMarker, secondMarker],
      "Two texts were not rendered in FIFO order before clicking non-head in running send-now",
    );
    expect(queuedBeforeSendNow.map((item) => item.kind)).toEqual([
      "text",
      "text",
    ]);
    const remainingQueueItem = queuedBeforeSendNow[0]!;
    const selectedQueueItem = queuedBeforeSendNow[1]!;

    const firstRequestsBefore =
      await countUpstreamRequestsContaining(firstMarker);
    const secondRequestsBefore =
      await countUpstreamRequestsContaining(secondMarker);
    const sentNowItem = await clickQueueSendNow(selectedQueueItem.id);
    expect(sentNowItem.id).toBe(selectedQueueItem.id);
    expect(sentNowItem.content).toContain(secondMarker);

    await waitForUpstreamRequestContaining(secondMarker, 60000);
    await waitForV4UserMessageContaining(secondMarker);
    await waitForV4ConversationState(
      (snapshot) => snapshot.queueCount === 1,
      "running send-now 非队首被点项消费后剩余 queue 数量不对",
      45000,
    );
    const queuedAfterSendNow = await waitForQueueCount(
      1,
      "Queue does not contain only unselected items after consuming clicked non-head item in running send-now",
    );
    expect(queuedAfterSendNow[0]?.id).toBe(remainingQueueItem.id);
    expect(queuedAfterSendNow[0]?.content).toContain(firstMarker);
    expect(queuedAfterSendNow[0]?.content).not.toContain(secondMarker);

    const selectedUserMessage = (await getV4Messages("user")).find((message) =>
      message.text.includes(secondMarker),
    );
    expect(selectedUserMessage).toBeDefined();
    await expectNoUpstreamRequestForTextWithin(firstMarker, 900);
    expect(await countUpstreamRequestsContaining(firstMarker)).toBe(
      firstRequestsBefore,
    );
    expect(await countUpstreamRequestsContaining(secondMarker)).toBeGreaterThan(
      secondRequestsBefore,
    );
  });

  it("Clicking queued /goal steer-now while running should consume with goal semantics and update target", async function () {
    this.timeout(RUNNING_SEND_NOW_TIMEOUT_MS);

    const runId = Date.now();
    await startSlowRunningTurn(`E2E_RUNNING_SEND_NOW_GOAL_BASE_${runId}`);

    const goalMarker = `E2E_RUNNING_SEND_NOW_GOAL_${runId}`;
    await sendV4Prompt(goalPrompt(goalMarker));
    await waitForV4ComposerText("", "Input box was not cleared after sending running send-now goal");
    const queue = await waitForQueueOrderContaining(
      [goalMarker],
      "Goal queue was not formed before clicking running send-now goal",
    );
    expect(queue[0]?.kind).toBe("goal");

    const sentNowItem = await clickFirstQueueSendNow();
    expect(sentNowItem.kind).toBe("goal");
    expect(sentNowItem.content).toContain(goalMarker);

    await browser.waitUntil(
      async () => {
        const [snapshot, goal] = await Promise.all([
          getV4ConversationState(),
          getV4GoalProjection(),
        ]);
        return (
          snapshot.queueCount === 0 &&
          goal?.objective?.includes(goalMarker) === true &&
          ["active", "verifying"].includes(goal.status ?? "")
        );
      },
      {
        timeout: 45000,
        timeoutMsg: "Running send-now goal was not consumed by goal intent to set target",
      },
    );
  });

  it("Double-clicking steer-now rapidly while running should consume clicked item only once and retain unclicked queue items", async function () {
    this.timeout(RUNNING_SEND_NOW_TIMEOUT_MS);

    const runId = Date.now();
    await startSlowRunningTurn(`E2E_RUNNING_SEND_NOW_DOUBLE_BASE_${runId}`);

    const firstMarker = `E2E_RUNNING_SEND_NOW_DOUBLE_FIRST_${runId}`;
    const secondMarker = `E2E_RUNNING_SEND_NOW_DOUBLE_SECOND_${runId}`;
    await enqueueTextPrompt(firstMarker);
    await enqueueTextPrompt(secondMarker, { slow: true });

    const queuedBeforeSendNow = await waitForQueueOrderContaining(
      [firstMarker, secondMarker],
      "Two text queues were not formed before running send-now double click",
    );
    const remainingQueueItem = queuedBeforeSendNow[0]!;
    const selectedQueueItem = queuedBeforeSendNow[1]!;
    const firstRequestsBefore =
      await countUpstreamRequestsContaining(firstMarker);
    const secondRequestsBefore =
      await countUpstreamRequestsContaining(secondMarker);

    await doubleClickQueueSendNow(selectedQueueItem.id);
    await waitForUpstreamRequestContaining(secondMarker, 60000);
    await waitForV4UserMessageContaining(secondMarker);
    await waitForV4ConversationState(
      (snapshot) => snapshot.queueCount === 1,
      "Did not keep consuming only clicked item after running send-now double click",
      45000,
    );

    await expectNoUpstreamRequestForTextWithin(firstMarker, 900);
    const queuedAfterDoubleClick = await waitForQueueCount(
      1,
      "Unclicked queue items were not retained in queue after running send-now double click",
    );
    expect(queuedAfterDoubleClick[0]?.id).toBe(remainingQueueItem.id);
    expect(queuedAfterDoubleClick[0]?.content).toContain(firstMarker);
    expect(await countUpstreamRequestsContaining(firstMarker)).toBe(firstRequestsBefore);
    expect(await countUpstreamRequestsContaining(secondMarker)).toBe(
      secondRequestsBefore + 1,
    );
    const selectedUserMessages = (await getV4Messages("user")).filter((message) =>
      message.text.includes(secondMarker),
    );
    expect(selectedUserMessages).toHaveLength(1);
    const remainingUserMessages = (await getV4Messages("user")).filter((message) =>
      message.text.includes(firstMarker),
    );
    expect(remainingUserMessages).toHaveLength(0);
  });
});

function buildRunningPrompt(marker: string) {
  return `E2E_HOLD_STREAM ${marker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
}

function buildQueuedPrompt(marker: string, options: { slow?: boolean } = {}) {
  const prefix = options.slow ? "E2E_SLOW_STREAM " : "";
  return `${prefix}${marker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
}

function goalPrompt(marker: string) {
  return `/goal ${marker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
}

async function startSlowRunningTurn(marker: string) {
  await sendV4Prompt(buildRunningPrompt(marker));
  await waitForV4ComposerText("", "Input box was not cleared after sending basic message in running send-now");
  await waitForV4UserMessageContaining(marker);
  await waitForV4ConversationState(
    (snapshot) => snapshot.state === "streaming",
    "Basic message did not enter streaming in running send-now",
    30000,
  );
}

async function enqueueTextPrompt(
  marker: string,
  options: { slow?: boolean } = {},
) {
  await sendV4Prompt(buildQueuedPrompt(marker, options));
  await waitForV4ComposerText(
    "",
    `running send-now queued text 没有Clear: ${marker}`,
  );
}

async function doubleClickQueueSendNow(promptId: string) {
  const clicked = await browser.execute(
    (buttonTestIds) => {
      const button = buttonTestIds
        .map((buttonTestId) =>
          document.querySelector<HTMLButtonElement>(
            `[data-testid="${buttonTestId}"]`,
          ),
        )
        .find((candidate) => candidate !== null);
      if (!button || button.disabled) {
        return false;
      }
      button.click();
      button.click();
      return true;
    },
    [
      `${TID_V4_QUEUE_ITEM_SEND_NOW}-${promptId}`,
      `${TID_CHAT_QUEUE_SEND_NOW_BUTTON}-${promptId}`,
    ],
  );
  expect(clicked).toBe(true);
}

async function stopIfBusy() {
  const snapshot = await getV4ConversationState().catch(() => null);
  if (snapshot?.state !== "streaming") {
    return;
  }
  await clickV4Stop().catch(() => undefined);
  await waitForV4ConversationState(
    (candidate) => candidate.state !== "streaming",
    "Did not exit streaming during cleanup stage in running send-now",
    30000,
  ).catch(() => undefined);
  await getQueueItems().catch(() => []);
}
