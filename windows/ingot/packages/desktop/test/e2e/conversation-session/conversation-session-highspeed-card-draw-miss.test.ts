import { clearAppData } from "../helpers/desktop-app.js";
import {
  countHighspeedStatusTags,
  prepareHighspeedDrawWorkspace,
  sendHighspeedTurnAndWaitCompleted,
  startHighspeedComposerProbe,
  takeHighspeedComposerProbe,
} from "../helpers/highspeed-card.js";

describe("Highspeed card draw miss E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("HS-E2E-03: Next turns both outside draw and during cooldown send normally; input box does not enter Highspeed", async function () {
    this.timeout(240000);

    await prepareHighspeedDrawWorkspace();

    await startHighspeedComposerProbe();
    await sendHighspeedTurnAndWaitCompleted(
      "E2E_HIGHSPEED_DRAW_MISS_TURN_1: reply with the fixed first-turn token.",
      "hs-draw-miss-turn-1-done",
    );
    await sendHighspeedTurnAndWaitCompleted(
      "E2E_HIGHSPEED_DRAW_MISS_TURN_2: reply with the fixed second-turn token.",
      "hs-draw-miss-turn-2-done",
    );

    expect(await takeHighspeedComposerProbe()).toBe(false);
    expect(await countHighspeedStatusTags()).toBe(0);
  });
});
