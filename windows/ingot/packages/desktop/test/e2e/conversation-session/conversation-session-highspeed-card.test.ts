import { clearAppData } from "../helpers/desktop-app.js";
import {
  prepareHighspeedDrawWorkspace,
  startHighspeedEntranceProbe,
  takeHighspeedEntranceProbe,
  waitForHighspeedComposer,
  waitForHighspeedComposerCleared,
  waitForHighspeedStatusTag,
} from "../helpers/highspeed-card.js";
import {
  getV4PaneSnapshot,
  selectV4TaskById,
  sendV4Prompt,
  startNewV4Draft,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

const HIT_REPLY_TOKEN = "hs-card-hit-done";

describe("Highspeed card E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("HS-E2E-01: After draw hit, current message completes with Highspeed badge; switching back to Task does not replay activation animation", async function () {
    this.timeout(180000);

    await prepareHighspeedDrawWorkspace();

    await startHighspeedEntranceProbe();
    await sendV4Prompt("E2E_HIGHSPEED_CARD_HIT: reply with the fixed hit token.");

    await waitForHighspeedComposer("Input box did not enter Highspeed state after draw hit");
    await waitForV4TimelineContaining(HIT_REPLY_TOKEN);
    await waitForV4Pane(
      (snapshot) => !snapshot.canStop && snapshot.timelineText.includes(HIT_REPLY_TOKEN),
      "Highspeed mock turn 完成后 pane 仍处于运行态",
      90000,
    );
    await waitForHighspeedStatusTag("完成态消息没有展示 Highspeed 标识");

    const drawEntrance = await takeHighspeedEntranceProbe();
    expect(drawEntrance.entrance).toBe("activation");
    expect(drawEntrance.diffusionMounted).toBe(true);

    const { sessionId } = await getV4PaneSnapshot();
    if (!sessionId || sessionId === "draft") {
      throw new Error("Pane did not bind session after first Highspeed turn completed");
    }
    await startNewV4Draft();
    await waitForHighspeedComposerCleared("Input box remains in Highspeed state after creating a new draft");
    await startHighspeedEntranceProbe();
    await selectV4TaskById(sessionId);
    await waitForHighspeedComposer("Input box did not restore Highspeed state after switching back to Task");
    const restoreEntrance = await takeHighspeedEntranceProbe();
    expect(restoreEntrance).toEqual({
      diffusionMounted: false,
      entrance: "restore",
      modelIndicatorVisible: true,
      phase: "stable",
    });
  });
});
