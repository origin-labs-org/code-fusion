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
} from "../../../helpers/upstream-provider.js";
import {
  E2E_REPLY_TOKEN,
  buildReadonlyToolPrompt,
  clickChatStop,
  getChatRootSnapshot,
  getForkButtonForAssistantContaining,
  prepareConversationE2E,
  selectTaskById,
  sendPrompt,
  startNewTask,
  waitForAssistantMessageContaining,
  waitForChatState,
  waitForUpstreamRequestContaining,
  waitForQueueContaining,
  waitForQueueCount,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";

describe("Session area Goal Session/Model E2E", () => {
  afterEach(async () => {
    await stopIfStreaming();
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("queued goal consumes using current session's latest model and thinking depth", async function () {
    this.timeout(190000);

    await prepareConversationE2E();
    await ensureUpstreamModelForE2E(UPSTREAM_SECONDARY_MODEL);
    await startNewTask();

    const runId = Date.now();
    await selectUpstreamModelById(UPSTREAM_MODEL);
    await selectUpstreamThoughtLevelValue(UPSTREAM_THOUGHT_LEVEL);
    await expectToolbarConfig(UPSTREAM_MODEL, UPSTREAM_THOUGHT_LEVEL);

    const runningMarker = `E2E_MODEL_CONFIG_AUTO_DRAIN_RUNNING_GOAL_${runId}`;
    const runningPrompt = [
      `${runningMarker}: Respond directly in chat.`,
      "Do not use tools or run commands.",
      `Write 40 short numbered lines to keep this E2E turn running, then finish with "${E2E_REPLY_TOKEN}".`,
    ].join(" ");
    await sendPrompt(runningPrompt);
    await waitForUserMessageContaining(runningMarker);
    await waitForChatState(
      (snapshot) => snapshot.state === "streaming",
      "queued goal model basic message failed to enter streaming",
      30000,
    );

    const queuedGoalMarker = `E2E_GOAL_MODEL_QUEUE_LATEST_${runId}`;
    await sendPrompt(goalPrompt(queuedGoalMarker));
    await waitForQueueContaining(queuedGoalMarker);
    await waitForQueueCount(1);

    await selectUpstreamModelById(UPSTREAM_SECONDARY_MODEL);
    await selectUpstreamThoughtLevelValue(UPSTREAM_SECONDARY_THOUGHT_LEVEL);
    await expectToolbarConfig(UPSTREAM_SECONDARY_MODEL, UPSTREAM_SECONDARY_THOUGHT_LEVEL);

    const goalRecord = await waitForUpstreamNetworkCapture(queuedGoalMarker);
    assertUpstreamRequestCapture(goalRecord, {
      expectedText: queuedGoalMarker,
      model: UPSTREAM_SECONDARY_MODEL,
    });
    assertUpstreamThoughtLevelCapture(goalRecord, UPSTREAM_SECONDARY_THOUGHT_LEVEL);
    await waitForChatState(
      (snapshot) => snapshot.targetObjective?.includes(queuedGoalMarker) === true,
      "Target was not set after consuming queued goal",
      30000,
    );
  });

  it("goal running and queued goal states do not leak across session switches", async function () {
    this.timeout(190000);

    await prepareConversationE2E({ resetDraftBeforeProvider: true });

    const runId = Date.now();
    await selectUpstreamModelById(UPSTREAM_MODEL);
    await selectUpstreamThoughtLevelValue(UPSTREAM_THOUGHT_LEVEL);
    await expectToolbarConfig(UPSTREAM_MODEL, UPSTREAM_THOUGHT_LEVEL);

    const seedPrompt = buildReadonlyToolPrompt(
      `E2E_GOAL_SESSION_SEED_${runId}`,
    );
    await sendPrompt(seedPrompt);
    await waitForUpstreamRequestContaining(`E2E_GOAL_SESSION_SEED_${runId}`);
    await waitForAssistantMessageContaining(E2E_REPLY_TOKEN);
    const sessionAIdle = await waitForChatState(
      (snapshot) => snapshot.state === "idle" && Boolean(snapshot.taskId),
      "goal session seed did not complete",
      90000,
    );
    const sessionA = sessionAIdle.taskId;
    if (!sessionA) {
      throw new Error("goal session seed is missing taskId");
    }

    const activeGoalMarker = `E2E_GOAL_SESSION_ACTIVE_${runId}`;
    await sendPrompt(goalPrompt(activeGoalMarker));
    await waitForUpstreamRequestContaining(activeGoalMarker);
    await waitForChatState(
      (snapshot) =>
        snapshot.taskId === sessionA &&
        snapshot.state === "streaming" &&
        snapshot.targetObjective?.includes(activeGoalMarker) === true,
      "session A goal did not enter running",
      30000,
    );
    const forkButton = await getForkButtonForAssistantContaining(E2E_REPLY_TOKEN);
    expect(forkButton?.exists).toBe(true);
    expect(forkButton?.ariaDisabled || forkButton?.disabled).toBe(true);

    const queuedGoalMarker = `E2E_GOAL_SESSION_QUEUED_${runId}`;
    await sendPrompt(goalPrompt(queuedGoalMarker));
    let queue = await waitForQueueCount(1);
    expect(queue[0]?.kind).toBe("goal");
    expect(queue[0]?.content).toContain(queuedGoalMarker);

    await startNewTask();
    await waitForChatState(
      (snapshot) =>
        snapshot.taskId !== sessionA &&
        snapshot.queueCount === 0 &&
        snapshot.targetObjective === null &&
        snapshot.targetStatus === null,
      "New session should not inherit A's goal or queue",
      30000,
    );
    const draftSnapshot = await getChatRootSnapshot();
    expect(draftSnapshot.targetObjective).toBeNull();
    expect(draftSnapshot.queueCount).toBe(0);

    await selectTaskById(sessionA);
    await waitForChatState(
      (snapshot) =>
        snapshot.taskId === sessionA &&
        snapshot.targetObjective?.includes(activeGoalMarker) === true &&
        snapshot.queueCount === 1,
      "Failed to restore goal and queued goal after switching back to session A",
      30000,
    );
    queue = await waitForQueueCount(1);
    expect(queue[0]?.kind).toBe("goal");
    expect(queue[0]?.content).toContain(queuedGoalMarker);
  });
});

function goalPrompt(marker: string) {
  return `/goal ${marker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
}

async function expectToolbarConfig(model: string, thoughtLevel: string) {
  const modelLabel = await getSelectedUpstreamModelLabel();
  const acceptedModelValues = [`e2e-upstream/${model}`, `custom:e2e-upstream:${model}`, model];
  if (modelLabel.currentValue) {
    expect(acceptedModelValues).toContain(modelLabel.currentValue);
  } else {
    expect(Object.values(modelLabel).join("\n")).toContain(model);
  }

  const thoughtLabel = await getSelectedUpstreamThoughtLevelLabel();
  const labelCandidates = Object.values(thoughtLabel)
    .map((value) => value.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
  const expectedLabels = [
    thoughtLevel,
    ...getUpstreamThoughtLevelLabels(thoughtLevel),
  ].map((label) => label.replace(/\s+/g, " ").trim().toLowerCase());
  const matchedThoughtLevel = labelCandidates.some((label) => expectedLabels.includes(label));
  if (!matchedThoughtLevel) {
    throw new Error(
      `Thinking深度未Exact匹配 ${thoughtLevel}: ${JSON.stringify({
        expectedLabels,
        thoughtLabel,
      })}`,
    );
  }
}

async function stopIfStreaming() {
  const snapshot = await waitForChatState(() => true, "读取 chat 状态失败", 5000);
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
