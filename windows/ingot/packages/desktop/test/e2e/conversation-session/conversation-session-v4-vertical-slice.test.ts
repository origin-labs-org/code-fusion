import { clearAppData } from "../helpers/desktop-app.js";
import {
  clickV4Stop,
  getV4PaneSnapshot,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

describe("v4 vertical slice M3 gate: subscribe → render → send → refresh recovery → stop", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Single pane full link (including refresh recovery during agent output)", async () => {
    await prepareV4ConversationE2E();

    await sendV4Prompt("E2E_V4_SLICE_TURN1 请慢慢回答");

    const bound = await waitForV4Pane(
      (snapshot) => snapshot.sessionId !== "draft" && snapshot.sessionId !== null,
      "Pane was not bound to new session after initial send",
      45000,
    );
    const sessionId = bound.sessionId;

    await waitForV4TimelineContaining("E2E_V4_SLICE_TURN1");
    await waitForV4TimelineContaining("V4_TURN1_STREAMING", 45000);
    await waitForV4Pane(
      (snapshot) => snapshot.canStop,
      "streaming 中没有出现 stop 按钮",
    );

    await browser.refresh();

    await waitForV4Pane(
      (snapshot) => snapshot.sessionId === sessionId,
      "Pane did not restore to the original session after refresh",
      60000,
    );
    await waitForV4TimelineContaining("E2E_V4_SLICE_TURN1", 30000);
    await waitForV4TimelineContaining("V4_TURN1_DONE", 60000);
    await waitForV4Pane(
      (snapshot) => !snapshot.canStop,
      "Stop button was not dismissed after turn1 stream finished",
    );

    await sendV4Prompt("E2E_V4_SLICE_TURN2 Keep outputting");
    await waitForV4TimelineContaining("V4_TURN2_STREAMING", 45000);
    await waitForV4Pane(
      (snapshot) => snapshot.canStop,
      "Stop button did not appear during turn2 streaming",
    );
    await clickV4Stop();
    await waitForV4Pane(
      (snapshot) => !snapshot.canStop,
      "canStop was not reclaimed after stop",
      30000,
    );

    const finalSnapshot = await getV4PaneSnapshot();
    expect(finalSnapshot.timelineText).toContain("V4_TURN2_STREAMING");
    expect(finalSnapshot.sessionId).toBe(sessionId);
  });
});
