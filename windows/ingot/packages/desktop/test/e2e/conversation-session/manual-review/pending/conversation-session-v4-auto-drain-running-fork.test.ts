import { TID_V4_FORK, TID_V4_ROW } from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../../../helpers/desktop-app.js";
import { waitForUpstreamNetworkRequestStarted } from "../../../helpers/upstream-capture.js";
import {
  clickV4Stop,
  getV4PaneSnapshot,
  getV4QueueItems,
  prepareV4ConversationE2E,
  selectV4TaskById,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4QueueCount,
} from "../../../helpers/v4-conversation.js";

const Q0_MARKER = "E2E_V4_AUTODRAIN_FORK_Q0";
const A0_MARKER = "E2E_V4_AUTODRAIN_FORK_A0";
const Q1_MARKER = "E2E_V4_AUTODRAIN_FORK_Q1";
const A1_MARKER = "E2E_V4_AUTODRAIN_FORK_A1";
const Q2_MARKER = "E2E_V4_AUTODRAIN_FORK_Q2";
const A2_PARTIAL_MARKER = "E2E_V4_AUTODRAIN_FORK_A2_PARTIAL";

describe("PV4-08 auto-drain stable assistant running fork", () => {
  let runningParentSessionId: string | null = null;

  afterEach(async () => {
    if (runningParentSessionId) {
      await selectV4TaskById(runningParentSessionId).catch(() => undefined);
    }
    await stopCurrentTurnIfNeeded();
    runningParentSessionId = null;
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("After Q1 auto-drains to A1, fork A1 while Q2 is running; parent continues and child prefix is fixed", async function () {
    this.timeout(180000);
    await prepareV4ConversationE2E();

    const runId = Date.now();
    const q0 = `${Q0_MARKER}_${runId}: hold the first turn while Q1 and Q2 queue.`;
    const q1 = `${Q1_MARKER}_${runId}: auto-drain this input and reply with ${A1_MARKER}.`;
    const q2 = `${Q2_MARKER}_${runId}: keep streaming while A1 is forked.`;

    await sendV4Prompt(q0);
    const parent = await waitForV4Pane(
      (snapshot) =>
        snapshot.canStop &&
        snapshot.sessionId !== null &&
        snapshot.sessionId !== "draft" &&
        snapshot.timelineText.includes(A0_MARKER),
      "Q0 没有进入 controlled running 窗口",
      30000,
    );
    runningParentSessionId = parent.sessionId;

    await sendV4Prompt(q1);
    await waitForV4QueueCount(1, 30000);
    await sendV4Prompt(q2);
    await waitForV4QueueCount(2, 30000);
    expect((await getV4QueueItems()).map((item) => item.text).join("\n")).toContain(Q1_MARKER);
    expect((await getV4QueueItems()).map((item) => item.text).join("\n")).toContain(Q2_MARKER);

    await waitForUpstreamNetworkRequestStarted(Q2_MARKER);
    const q2Running = await waitForV4Pane(
      (snapshot) =>
        snapshot.canStop &&
        snapshot.timelineText.includes(Q1_MARKER) &&
        snapshot.timelineText.includes(A1_MARKER) &&
        snapshot.timelineText.includes(Q2_MARKER),
      "Q1/A1 did not complete auto-drain, or Q2 did not proceed to running",
      60000,
    );
    expect(await getV4QueueItems()).toHaveLength(0);
    expect(q2Running.timelineText).toContain(A2_PARTIAL_MARKER);

    await waitForForkActionOnRow(A1_MARKER);
    expect(await clickForkActionOnRow(A1_MARKER)).toBe(true);
    const child = await waitForV4Pane(
      (snapshot) =>
        snapshot.sessionId !== null &&
        snapshot.sessionId !== "draft" &&
        snapshot.sessionId !== runningParentSessionId &&
        snapshot.timelineText.includes(A1_MARKER),
      "Forking A1 while Q2 is running did not create child",
      30000,
    );

    expect(child.timelineText).toContain(Q0_MARKER);
    expect(child.timelineText).toContain(A0_MARKER);
    expect(child.timelineText).toContain(Q1_MARKER);
    expect(child.timelineText).toContain(A1_MARKER);
    expect(child.timelineText).not.toContain(Q2_MARKER);
    expect(child.timelineText).not.toContain(A2_PARTIAL_MARKER);
    expect(await getV4QueueItems()).toHaveLength(0);

    if (!runningParentSessionId) throw new Error("Parent sessionId was not recorded before fork");
    await selectV4TaskById(runningParentSessionId);
    const parentStillRunning = await waitForV4Pane(
      (snapshot) =>
        snapshot.sessionId === runningParentSessionId &&
        snapshot.canStop &&
        snapshot.timelineText.includes(Q2_MARKER),
      "fork A1 后父 Q2 没有继续运行",
      15000,
    );
    expect(parentStillRunning.timelineText).toContain(A2_PARTIAL_MARKER);

    await clickV4Stop();
    await waitForV4Pane(
      (snapshot) => !snapshot.canStop,
      "auto-drain running fork teardown stop did not complete",
      30000,
    );
  });
});

async function waitForForkActionOnRow(marker: string) {
  await browser.waitUntil(async () => hasForkActionOnRow(marker), {
    timeout: 30000,
    timeoutMsg: `稳定 assistant row 没有权威 canFork action: ${marker}`,
  });
}

async function hasForkActionOnRow(marker: string) {
  return browser.execute(
    (expectedMarker, rowPrefix, forkPrefix) => {
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(`[data-testid^="${rowPrefix}-"]`),
      );
      return rows.some((candidate) => {
        if (!candidate.innerText.includes(expectedMarker)) return false;
        const rowId = candidate.dataset.rowId;
        return Boolean(rowId && document.querySelector(`[data-testid="${forkPrefix}-${rowId}"]`));
      });
    },
    marker,
    TID_V4_ROW,
    TID_V4_FORK,
  );
}

async function clickForkActionOnRow(marker: string) {
  return browser.execute(
    (expectedMarker, rowPrefix, forkPrefix) => {
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(`[data-testid^="${rowPrefix}-"]`),
      );
      const row = rows.find((candidate) => {
        if (!candidate.innerText.includes(expectedMarker)) return false;
        const rowId = candidate.dataset.rowId;
        return Boolean(rowId && document.querySelector(`[data-testid="${forkPrefix}-${rowId}"]`));
      });
      const rowId = row?.dataset.rowId;
      const button = rowId
        ? document.querySelector<HTMLButtonElement>(`[data-testid="${forkPrefix}-${rowId}"]`)
        : null;
      button?.click();
      return Boolean(button);
    },
    marker,
    TID_V4_ROW,
    TID_V4_FORK,
  );
}

async function stopCurrentTurnIfNeeded() {
  const snapshot = await getV4PaneSnapshot().catch(() => null);
  if (!snapshot?.canStop) return;
  await clickV4Stop();
  await waitForV4Pane(
    (next) => !next.canStop,
    "auto-drain running fork cleanup 没有退出 streaming",
    30000,
  );
}
