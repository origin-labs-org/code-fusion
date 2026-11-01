import { clearAppData } from "../helpers/desktop-app.js";
import {
  countHighspeedStatusTags,
  prepareHighspeedDrawWorkspace,
  sendHighspeedTurnAndWaitCompleted,
  waitForHighspeedComposer,
  waitForHighspeedStatusTag,
} from "../helpers/highspeed-card.js";

describe("Highspeed card draw timeout E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("HS-E2E-02: draw 超出 1s 预算时首轮普通发送，迟到的卡在同 Task 下一轮加速", async function () {
    this.timeout(240000);

    await prepareHighspeedDrawWorkspace();

    await sendHighspeedTurnAndWaitCompleted(
      "E2E_HIGHSPEED_DRAW_TIMEOUT_TURN_1: reply with the fixed first-turn token.",
      "hs-draw-timeout-turn-1-done",
    );
    expect(await countHighspeedStatusTags()).toBe(0);

    await sendHighspeedTurnAndWaitCompleted(
      "E2E_HIGHSPEED_DRAW_TIMEOUT_TURN_2: reply with the fixed second-turn token.",
      "hs-draw-timeout-turn-2-done",
    );
    await waitForHighspeedComposer("Late card did not put input box into Highspeed in next turn under same Task");
    await waitForHighspeedStatusTag("迟到的卡加速的下一轮没有展示 Highspeed 标识");
    expect(await countHighspeedStatusTags()).toBe(1);
  });
});
