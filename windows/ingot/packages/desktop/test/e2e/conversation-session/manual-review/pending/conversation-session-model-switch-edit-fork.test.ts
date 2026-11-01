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
  getUpstreamThoughtLevelLabels,
  getSelectedUpstreamModelLabel,
  getSelectedUpstreamThoughtLevelLabel,
  selectUpstreamModelById,
  selectUpstreamThoughtLevelValue,
  waitForUpstreamModelSelected,
} from "../../../helpers/upstream-provider.js";
import {
  E2E_REPLY_TOKEN,
  clickChatStop,
  clickForkButtonForAssistantContaining,
  editUserMessageContaining,
  getChatRootSnapshot,
  prepareConversationE2E,
  sendPrompt,
  startNewTask,
  waitForAssistantMessageContaining,
  waitForChatState,
  waitForComposerText,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";

const MODEL_SWITCH_EDIT_FORK_TIMEOUT_MS = 180000;
const MODEL_SWITCH_GUARD_TITLE_ZH = "需要压缩上下文后再切换模型";
const MODEL_SWITCH_GUARD_TITLE_EN = "Compress context before switching models";

describe("Chat area Edit/Fork after completed model switch E2E", () => {
  before(async function () {
    this.timeout(MODEL_SWITCH_EDIT_FORK_TIMEOUT_MS);

    await prepareConversationE2E();
    await ensureUpstreamModelForE2E(UPSTREAM_SECONDARY_MODEL);
  });

  afterEach(async () => {
    await stopIfBusy();
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Switching to secondary after completed and then editing/forking should use secondary config for subsequent requests", async function () {
    this.timeout(MODEL_SWITCH_EDIT_FORK_TIMEOUT_MS);

    const runId = Date.now();

    await startNewTaskWithPrimaryConfig();
    const editSourceMarker = `E2E_MODEL_SWITCH_EDIT_SOURCE_${runId}`;
    const editRerunMarker = `E2E_MODEL_SWITCH_EDIT_RERUN_${runId}`;
    await sendPrompt(simpleReplyPrompt(editSourceMarker));
    await waitForComposerText("", "model switch edit: input box was not cleared after sending source");
    await waitForUserMessageContaining(editSourceMarker);
    assertPrimaryConfig(await waitForUpstreamNetworkCapture(editSourceMarker), editSourceMarker);
    await waitForCompletedAssistant("model switch edit: source 没有完成");

    await switchToSecondaryConfig();
    await editUserMessageContaining(editSourceMarker, simpleReplyPrompt(editRerunMarker));
    await waitForComposerText("", "model switch edit: input box was not cleared after submitting rerun");
    await waitForUserMessageContaining(editRerunMarker);
    assertSecondaryConfig(await waitForUpstreamNetworkCapture(editRerunMarker), editRerunMarker);
    await waitForCompletedAssistant("model switch edit: rerun 没有完成");

    await startNewTaskWithPrimaryConfig();
    const forkSourceMarker = `E2E_MODEL_SWITCH_FORK_SOURCE_${runId}`;
    const forkFollowupMarker = `E2E_MODEL_SWITCH_FORK_FOLLOWUP_${runId}`;
    await sendPrompt(simpleReplyPrompt(forkSourceMarker));
    await waitForComposerText("", "model switch fork: input box was not cleared after sending source");
    await waitForUserMessageContaining(forkSourceMarker);
    const sourceSnapshot = await waitForChatState(
      (snapshot) => Boolean(snapshot.sessionId || snapshot.taskId),
      "model switch fork: source 没有创建 session",
      30000,
    );
    assertPrimaryConfig(await waitForUpstreamNetworkCapture(forkSourceMarker), forkSourceMarker);
    await waitForCompletedAssistant("model switch fork: source 没有完成");

    await switchToSecondaryConfig();
    await clickForkButtonForAssistantContaining(E2E_REPLY_TOKEN);
    const sourceSessionId = sourceSnapshot.sessionId || sourceSnapshot.taskId;
    const forkedSnapshot = await waitForChatState(
      (snapshot) =>
        Boolean(snapshot.sessionId || snapshot.taskId) &&
        (snapshot.sessionId || snapshot.taskId) !== sourceSessionId,
      "model switch fork: 点击 fork 后没有切换到派生 session",
      30000,
    );
    expect(forkedSnapshot.queueCount).toBe(0);
    const forkedSessionId = forkedSnapshot.sessionId || forkedSnapshot.taskId;
    expect(forkedSessionId).toBeTruthy();
    await waitForChatState(
      (snapshot) =>
        (snapshot.sessionId || snapshot.taskId) === forkedSessionId &&
        snapshot.state === "idle" &&
        snapshot.runtimeStatus !== "restoring",
      "model switch fork: forked session did not finish restoring",
      60000,
    );
    await expectToolbarConfig(UPSTREAM_SECONDARY_MODEL, UPSTREAM_SECONDARY_THOUGHT_LEVEL);

    await sendPrompt(simpleReplyPrompt(forkFollowupMarker));
    await waitForComposerText("", "model switch fork: input box was not cleared after sending followup");
    await waitForUserMessageContaining(forkFollowupMarker);
    assertSecondaryConfig(
      await waitForUpstreamNetworkCapture(forkFollowupMarker),
      forkFollowupMarker,
    );
    await waitForCompletedAssistant("model switch fork: followup 没有完成");
  });
});

async function startNewTaskWithPrimaryConfig() {
  await startNewTask();
  await selectUpstreamModelById(UPSTREAM_MODEL);
  if (UPSTREAM_THOUGHT_LEVEL) {
    await selectUpstreamThoughtLevelValue(UPSTREAM_THOUGHT_LEVEL);
  }
  await expectToolbarConfig(UPSTREAM_MODEL, UPSTREAM_THOUGHT_LEVEL);
}

async function switchToSecondaryConfig() {
  await selectUpstreamModelById(UPSTREAM_SECONDARY_MODEL, {
    afterModelItemClick: () =>
      confirmModelSwitchCompressionDialogIfPresent(UPSTREAM_SECONDARY_MODEL),
  });
  await selectUpstreamThoughtLevelValue(UPSTREAM_SECONDARY_THOUGHT_LEVEL);
  await expectToolbarConfig(UPSTREAM_SECONDARY_MODEL, UPSTREAM_SECONDARY_THOUGHT_LEVEL);
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
    const dialog =
      document.querySelector<HTMLElement>('[role="dialog"]') ?? document.body;
    const buttons = Array.from(
      dialog.querySelectorAll<HTMLButtonElement>("button"),
    );
    const confirmButton = buttons.find((button) => {
      const text = button.innerText.replace(/\s+/g, " ").trim();
      return (
        text === "压缩" ||
        text === "继续" ||
        text === "Compress" ||
        text === "Continue" ||
        text.includes("压缩")
      );
    });
    confirmButton?.click();
    return Boolean(confirmButton);
  });
  expect(clicked).toBe(true);
}

async function waitForModelSwitchCompressionDialog(timeout: number) {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (titleZh, titleEn) => {
          const bodyText = document.body.innerText;
          return bodyText.includes(titleZh) || bodyText.includes(titleEn);
        },
        MODEL_SWITCH_GUARD_TITLE_ZH,
        MODEL_SWITCH_GUARD_TITLE_EN,
      ),
    {
      timeout,
      timeoutMsg: "Context compaction confirmation dialog before model switch did not appear",
    },
  );
  return true;
}

function simpleReplyPrompt(marker: string) {
  return `${marker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
}

async function waitForCompletedAssistant(timeoutMsg: string) {
  await waitForAssistantMessageContaining(E2E_REPLY_TOKEN);
  await waitForChatState(
    (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
    timeoutMsg,
    90000,
  );
}

async function expectToolbarConfig(model: string, thoughtLevel: string) {
  const modelLabel = await getSelectedUpstreamModelLabel();
  const acceptedModelValues = [`e2e-upstream/${model}`, `custom:e2e-upstream:${model}`, model];
  if (modelLabel.currentValue) {
    expect(acceptedModelValues).toContain(modelLabel.currentValue);
  } else {
    expect(Object.values(modelLabel).join("\n")).toContain(model);
  }

  if (!thoughtLevel) {
    return;
  }

  const thoughtLabel = await getSelectedUpstreamThoughtLevelLabel();
  const labelCandidates = Object.values(thoughtLabel)
    .map((value) => value.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
  const expectedLabels = [
    thoughtLevel,
    ...getUpstreamThoughtLevelLabels(thoughtLevel),
  ].map((label) => label.replace(/\s+/g, " ").trim().toLowerCase());
  const matchedThoughtLevel = labelCandidates.some((label) =>
    expectedLabels.some((expectedLabel) => label === expectedLabel || label.includes(expectedLabel)),
  );
  if (!matchedThoughtLevel) {
    throw new Error(
      `Thinking深度未Exact匹配 ${thoughtLevel}: ${JSON.stringify({
        expectedLabels,
        thoughtLabel,
      })}`,
    );
  }
}

function assertPrimaryConfig(
  record: Awaited<ReturnType<typeof waitForUpstreamNetworkCapture>>,
  expectedText: string,
) {
  assertUpstreamRequestCapture(record, {
    expectedText,
    model: UPSTREAM_MODEL,
  });
  if (UPSTREAM_THOUGHT_LEVEL) {
    assertUpstreamThoughtLevelCapture(record, UPSTREAM_THOUGHT_LEVEL);
  }
}

function assertSecondaryConfig(
  record: Awaited<ReturnType<typeof waitForUpstreamNetworkCapture>>,
  expectedText: string,
) {
  assertUpstreamRequestCapture(record, {
    expectedText,
    model: UPSTREAM_SECONDARY_MODEL,
  });
  assertUpstreamThoughtLevelCapture(record, UPSTREAM_SECONDARY_THOUGHT_LEVEL);
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
