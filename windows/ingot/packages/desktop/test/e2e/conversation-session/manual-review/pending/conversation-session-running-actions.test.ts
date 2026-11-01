import { clearAppData } from "../../../helpers/desktop-app.js";
import { buildReadonlyToolPrompt } from "../../../helpers/conversation-session.js";
import {
  clickFirstV4Fork,
  clickV4Stop,
  getV4PaneSnapshot,
  getV4QueueItems,
  prepareV4ConversationE2E,
  selectV4TaskById,
  sendV4Prompt,
  waitForV4Fork,
  waitForV4Pane,
  waitForV4QueueCount,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

describe("PV4-08 running stable assistant fork E2E", () => {
  afterEach(async () => {
    await stopRunningTurnIfNeeded();
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Forking earlier stable assistant while running: parent continues and child does not copy active work/queue", async function () {
    this.timeout(150000);
    await prepareV4ConversationE2E();

    const runId = Date.now();
    const completedMarker = `E2E_RUNNING_ACTIONS_COMPLETED_${runId}`;
    await sendV4Prompt(buildReadonlyToolPrompt(completedMarker));
    await waitForV4TimelineContaining(completedMarker, 60000);
    await waitForV4Pane(
      (snapshot) => !snapshot.canStop,
      "Preceding turn of running stable fork did not complete",
      90000,
    );
    await waitForV4Fork();

    const parent = await getV4PaneSnapshot();
    const parentSessionId = parent.sessionId;
    expect(parentSessionId).toBeTruthy();
    expect(parentSessionId).not.toBe("draft");

    const activeMarker = `E2E_RUNNING_ACTIONS_ACTIVE_${runId}`;
    await sendV4Prompt(
      `E2E_SLOW_STREAM ${activeMarker}: Reply with exactly "upstream-e2e-ok" and no other text.`,
    );
    await waitForV4Pane(
      (snapshot) => snapshot.canStop,
      "Turn 2 did not enter controlled streaming",
      30000,
    );

    const queuedMarker = `E2E_RUNNING_ACTIONS_QUEUED_${runId}`;
    await sendV4Prompt(`${queuedMarker}: keep this input queued.`);
    await waitForV4QueueCount(1, 30000);

    await waitForV4Fork();
    expect(await clickFirstV4Fork()).toBe(true);
    const child = await waitForV4Pane(
      (snapshot) =>
        snapshot.sessionId !== null &&
        snapshot.sessionId !== "draft" &&
        snapshot.sessionId !== parentSessionId &&
        snapshot.timelineText.includes(completedMarker),
      "Running stable fork child failed to complete stable history hydration",
      30000,
    );
    expect(child.timelineText).toContain(completedMarker);
    expect(child.timelineText).not.toContain(activeMarker);
    expect(child.timelineText).not.toContain(queuedMarker);
    expect(await getV4QueueItems()).toHaveLength(0);

    await selectV4TaskById(parentSessionId!);
    await waitForV4Pane(
      (snapshot) => snapshot.canStop,
      "fork child 后父 session 没有继续运行",
      15000,
    );
    await waitForV4QueueCount(1, 15000);
    expect((await getV4QueueItems())[0]?.text).toContain(queuedMarker);

    await clickV4Stop();
    await waitForV4Pane(
      (snapshot) => !snapshot.canStop,
      "Cleanup stop for running stable fork did not complete",
      30000,
    );
  });
});

async function stopRunningTurnIfNeeded() {
  const snapshot = await getV4PaneSnapshot();
  if (!snapshot.canStop) return;
  await clickV4Stop();
  await waitForV4Pane(
    (nextSnapshot) => !nextSnapshot.canStop,
    "running stable fork 收尾 stop 后没有退出 streaming",
    30000,
  );
}
