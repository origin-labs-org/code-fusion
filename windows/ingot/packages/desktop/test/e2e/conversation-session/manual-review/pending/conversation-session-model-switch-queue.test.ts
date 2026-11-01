import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  assertUpstreamRequestCapture,
  assertUpstreamThoughtLevelCapture,
  waitForUpstreamNetworkCapture,
} from "../../../helpers/upstream-capture.js";
import {
  UPSTREAM_MODEL,
  UPSTREAM_SECONDARY_MODEL,
  UPSTREAM_SECONDARY_THOUGHT_LEVEL,
  UPSTREAM_THOUGHT_LEVEL,
  ensureUpstreamModelForE2E,
  selectUpstreamModelById,
  selectUpstreamThoughtLevelValue,
  waitForUpstreamModelSelected,
} from "../../../helpers/upstream-provider.js";
import {
  E2E_REPLY_TOKEN,
  clickChatStop,
  clickFirstQueueSendNow,
  expectNoUpstreamRequestForTextWithin,
  getChatRootSnapshot,
  prepareConversationE2E,
  sendPrompt,
  startNewTask,
  waitForChatState,
  waitForComposerText,
  waitForUpstreamRequest,
  waitForQueueContaining,
  waitForQueueCount,
} from "../../../helpers/conversation-session.js";

const MODEL_SWITCH_QUEUE_TIMEOUT_MS = 180000;
const MODEL_SWITCH_GUARD_TITLE_ZH = "需要压缩上下文后再切换模型";
const MODEL_SWITCH_GUARD_TITLE_EN = "Compress context before switching models";

describe("Chat area model switch Queue E2E", () => {
  before(async function () {
    this.timeout(MODEL_SWITCH_QUEUE_TIMEOUT_MS);

    await prepareConversationE2E();
    await ensureUpstreamModelForE2E(UPSTREAM_SECONDARY_MODEL);
  });

  beforeEach(async function () {
    this.timeout(MODEL_SWITCH_QUEUE_TIMEOUT_MS);

    await startNewTask();
    await selectUpstreamModelByIdWithGuardConfirm(UPSTREAM_MODEL);
    await selectUpstreamThoughtLevelValue(UPSTREAM_THOUGHT_LEVEL);
  });

  afterEach(async () => {
    await stopIfBusy();
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Switching model in held queue after stop and sending immediately should use secondary config", async function () {
    this.timeout(MODEL_SWITCH_QUEUE_TIMEOUT_MS);

    const runId = Date.now();
    const runningMarker = `E2E_MODEL_SWITCH_HELD_RUNNING_${runId}`;
    const heldMarker = `E2E_MODEL_SWITCH_HELD_SEND_NOW_${runId}`;
    const runningPrompt = `E2E_SLOW_STREAM ${runningMarker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(runningPrompt);
    await waitForComposerText("", "Input box was not cleared after sending held turn 1 during model switch");
    await waitForChatState(
      (snapshot) => snapshot.state === "streaming",
      "Held turn 1 did not enter streaming during model switch",
      30000,
    );
    await waitForUpstreamRequest(
      { excludes: [heldMarker], includes: [runningMarker] },
      "Held turn 1 main request did not reach upstream capture during model switch",
      30000,
    );

    const heldPrompt = `${heldMarker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(heldPrompt);
    await waitForComposerText("", "Input box was not cleared after sending held queued text during model switch");
    await waitForQueueContaining(heldMarker);
    const queuedItems = await waitForQueueCount(1);
    expect(queuedItems[0]?.kind).toBe("text");
    expect(queuedItems[0]?.content).toContain(heldMarker);

    await clickChatStop();
    await waitForChatState(
      (snapshot) => snapshot.state !== "streaming" && snapshot.queueCount === 1,
      "stop 后没有退出 streaming 并保留 held queue",
      30000,
    );
    await expectNoUpstreamRequestForTextWithin(heldMarker, 900);

    await selectUpstreamModelByIdWithGuardConfirm(UPSTREAM_SECONDARY_MODEL);
    await selectUpstreamThoughtLevelValue(UPSTREAM_SECONDARY_THOUGHT_LEVEL);

    const sentNowItem = await clickFirstQueueSendNow();
    expect(sentNowItem.content).toContain(heldMarker);

    const sendNowRecord = await waitForUpstreamNetworkCapture(heldMarker);
    assertSecondaryUpstreamConfig(sendNowRecord, heldMarker);
  });

  it("Switching model before consuming queued text during running: auto drain should use secondary config", async function () {
    this.timeout(MODEL_SWITCH_QUEUE_TIMEOUT_MS);

    const runId = Date.now();
    const runningMarker = `E2E_MODEL_SWITCH_QUEUE_RUNNING_${runId}`;
    const queuedMarker = `E2E_MODEL_SWITCH_QUEUE_AUTO_DRAIN_${runId}`;
    const runningPrompt = `E2E_SLOW_STREAM ${runningMarker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(runningPrompt);
    await waitForComposerText("", "Input box was not cleared after sending queue turn 1 during model switch");
    await waitForChatState(
      (snapshot) => snapshot.state === "streaming",
      "Queue turn 1 did not enter streaming during model switch",
      30000,
    );
    await waitForUpstreamRequest(
      { excludes: [queuedMarker], includes: [runningMarker] },
      "Queue turn 1 main request did not reach upstream capture during model switch",
      30000,
    );

    const queuedPrompt = `${queuedMarker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(queuedPrompt);
    await waitForComposerText("", "Input box was not cleared after sending queued text during model switch");
    await waitForQueueContaining(queuedMarker);
    const queue = await waitForQueueCount(1);
    expect(queue[0]?.kind).toBe("text");
    expect(queue[0]?.content).toContain(queuedMarker);

    await selectUpstreamModelByIdWithGuardConfirm(UPSTREAM_SECONDARY_MODEL);
    await selectUpstreamThoughtLevelValue(UPSTREAM_SECONDARY_THOUGHT_LEVEL);

    await waitForChatState(
      (snapshot) => snapshot.queueCount === 0,
      "切换 secondary 后 queued text 没有开始 auto drain",
      120000,
    );
    const queuedRecord = await waitForUpstreamNetworkCapture(queuedMarker);
    assertSecondaryUpstreamConfig(queuedRecord, queuedMarker);
    await waitForChatState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      "Queued text was not completely consumed by auto drain after switching to secondary",
      90000,
    );
  });
});

function assertSecondaryUpstreamConfig(
  record: Awaited<ReturnType<typeof waitForUpstreamNetworkCapture>>,
  expectedText: string,
) {
  assertUpstreamRequestCapture(record, {
    expectedText,
    model: UPSTREAM_SECONDARY_MODEL,
  });
  assertUpstreamThoughtLevelCapture(record, UPSTREAM_SECONDARY_THOUGHT_LEVEL);
}

async function selectUpstreamModelByIdWithGuardConfirm(modelId: string) {
  await selectUpstreamModelById(modelId, {
    afterModelItemClick: () => confirmModelSwitchCompressionDialogIfPresent(modelId),
  });
}

async function confirmModelSwitchCompressionDialogIfPresent(modelId: string) {
  const hasDialog = await waitForModelSwitchCompressionDialog(250).catch(() => false);
  if (!hasDialog) {
    return false;
  }
  await confirmModelSwitchCompressionDialog();
  await waitForChatState(
    (snapshot) => !snapshot.modelSwitchPending,
    `Model ${modelId} guard Compact后切换 pending Status没有结束`,
    120000,
  );
  await waitForUpstreamModelSelected(modelId);
  return true;
}

async function confirmModelSwitchCompressionDialog() {
  await waitForModelSwitchCompressionDialog(15000);

  const clicked = await browser.execute(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
    const confirmButton = buttons.find((button) => {
      const text = button.innerText.replace(/\s+/g, " ").trim();
      return text === "压缩" || text === "Compress" || text.includes("压缩");
    });
    confirmButton?.click();
    return Boolean(confirmButton);
  });
  expect(clicked).toBe(true);
}

async function waitForModelSwitchCompressionDialog(timeout: number) {
  await browser.waitUntil(async () => hasModelSwitchCompressionDialog(), {
    timeout,
    timeoutMsg: "Context compaction confirmation dialog before model switch did not appear",
  });
  return true;
}

async function hasModelSwitchCompressionDialog() {
  return browser.execute(
    (titleZh, titleEn) => {
      const bodyText = document.body.innerText;
      return bodyText.includes(titleZh) || bodyText.includes(titleEn);
    },
    MODEL_SWITCH_GUARD_TITLE_ZH,
    MODEL_SWITCH_GUARD_TITLE_EN,
  );
}

async function stopIfBusy() {
  const snapshot = await getChatRootSnapshot().catch(() => null);
  if (snapshot?.state !== "streaming") {
    return;
  }
  await clickChatStop().catch(() => undefined);
  await waitForChatState(
    (candidate) => candidate.state !== "streaming",
    "Failed to exit streaming after afterEach stop",
    30000,
  ).catch(() => undefined);
}
