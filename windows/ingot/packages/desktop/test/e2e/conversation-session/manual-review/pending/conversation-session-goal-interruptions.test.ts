import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  E2E_REPLY_TOKEN,
  clickChatStop,
  getUpstreamRequestRecordCount,
  prepareConversationE2E,
  sendPrompt,
  startNewTask,
  waitForAssistantMessageContaining,
  waitForChatState,
  waitForCompactMarkerStatus,
  waitForComposerText,
  waitForUpstreamRequest,
  waitForUpstreamRequestContaining,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";

const COMPACT_REQUEST_SENTINEL = "CRITICAL: Respond with TEXT ONLY";
const GOAL_INTERRUPTIONS_TIMEOUT_MS = 180000;

describe("会话区 Goal Interruptions E2E", () => {
  afterEach(async () => {
    await stopIfBusy();
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Stopping running goal verifier should allow plain text to start next round immediately", async function () {
    this.timeout(GOAL_INTERRUPTIONS_TIMEOUT_MS);

    await prepareConversationE2E();
    await startNewTask();

    const runId = Date.now();
    const goalMarker = `E2E_GOAL_VERIFIER_STOP_${runId}`;
    const nextMarker = `E2E_GOAL_VERIFIER_STOP_NEXT_${runId}`;
    const requestCountBefore = await getUpstreamRequestRecordCount();

    await sendPrompt(
      `/goal ${goalMarker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`,
    );
    await waitForComposerText("", "Input box not cleared after sending goal verifier stop /goal");
    await waitForUserMessageContaining(goalMarker);
    await waitForUpstreamRequest(
      {
        includes: [goalMarker, "Verify whether the active session goal"],
        excludes: [nextMarker],
      },
      "goal verifier stop did not enter verifier request",
      90000,
      { afterIndex: requestCountBefore },
    );

    await clickChatStop();
    await waitForChatState(
      (snapshot) =>
        snapshot.state !== "streaming" &&
        snapshot.queueCount === 0 &&
        snapshot.runtimeStatus === "completed" &&
        !snapshot.stopRequested &&
        snapshot.targetStatus === "paused",
      "goal verifier stop 后没有收口到 completed/paused",
      30000,
    );

    await sendPrompt(
      `${nextMarker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`,
    );
    await waitForComposerText("", "goal verifier stop 后下一轮发送没有清空输入框");
    await waitForUpstreamRequestContaining(nextMarker, 30000);
    await waitForAssistantMessageContaining(E2E_REPLY_TOKEN);
    await waitForChatState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      "Next round did not complete with queue=0 after goal verifier stop",
      90000,
    );
  });

  it("Stopping running goal verifier allows compacting and continuing to send plain text", async function () {
    this.timeout(GOAL_INTERRUPTIONS_TIMEOUT_MS);

    await prepareConversationE2E();
    await startNewTask();

    const runId = Date.now();
    const goalMarker = `E2E_GOAL_VERIFIER_COMPACT_${runId}`;
    const nextMarker = `E2E_GOAL_VERIFIER_COMPACT_NEXT_${runId}`;
    const compactSummaryMarker = "E2E_GOAL_VERIFIER_COMPACT_SUMMARY_MARKER";
    const requestCountBefore = await getUpstreamRequestRecordCount();

    await sendPrompt(
      `/goal ${goalMarker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`,
    );
    await waitForComposerText("", "Input box not cleared after sending goal verifier compact /goal");
    await waitForUpstreamRequest(
      {
        includes: [goalMarker, "Verify whether the active session goal"],
        excludes: [nextMarker],
      },
      "goal verifier compact did not enter verifier request",
      90000,
      { afterIndex: requestCountBefore },
    );

    await clickChatStop();
    await waitForChatState(
      (snapshot) =>
        snapshot.state !== "streaming" &&
        snapshot.queueCount === 0 &&
        snapshot.runtimeStatus === "completed" &&
        !snapshot.stopRequested &&
        snapshot.targetStatus === "paused",
      "goal verifier compact stop 后没有收口到 completed/paused",
      30000,
    );

    await sendPrompt("/compact");
    await waitForComposerText("", "goal verifier compact 后 /compact 没有清空输入框");
    const startedMarker = await waitForCompactMarkerStatus("started", "manual");
    expect(startedMarker.inputId).toBeTruthy();
    await waitForUpstreamRequest(
      {
        includes: [COMPACT_REQUEST_SENTINEL, goalMarker],
      },
      "goal verifier compact did not trigger manual compact request",
      30000,
      { afterIndex: requestCountBefore },
    );
    await waitForCompactMarkerStatus("completed", "manual", startedMarker.inputId);

    await sendPrompt(
      `${nextMarker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`,
    );
    await waitForComposerText("", "goal verifier compact 后下一轮发送没有清空输入框");
    await waitForUpstreamRequest(
      {
        includes: [nextMarker, compactSummaryMarker],
        lastUserMessageIncludes: [nextMarker],
      },
      "Next round request did not continue based on post-compact summary after goal verifier compact",
      30000,
      { afterIndex: requestCountBefore },
    );
    await waitForAssistantMessageContaining(E2E_REPLY_TOKEN);
    await waitForChatState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      "Next round did not complete with queue=0 after goal verifier compact",
      90000,
    );
  });
});

async function stopIfBusy() {
  const snapshot = await waitForChatState(
    () => true,
    "goal interruptions afterEach failed to read chat state",
    1000,
  ).catch(() => null);
  if (snapshot?.state !== "streaming") {
    return;
  }
  await clickChatStop().catch(() => undefined);
  await waitForChatState(
    (candidate) => candidate.state !== "streaming",
    "goal interruptions cleanup phase did not exit streaming",
    30000,
  ).catch(() => undefined);
}
