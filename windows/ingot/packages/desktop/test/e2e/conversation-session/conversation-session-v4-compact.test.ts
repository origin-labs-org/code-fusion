// dispatchCommand("compact", baseRevision) → v4-bridge compactSession → CompactStarted/Completed
import { TID_V4_COMPOSER_INPUT } from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  setInputValueByTestIdDom,
} from "../helpers/desktop-app.js";
import {
  clickV4Send,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4CompactMarker,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

describe("v4 M4 gate: compact (/compact slash)", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("First turn completed → /compact → timeline displays manual compact success marker", async () => {
    await prepareV4ConversationE2E();

    await sendV4Prompt("E2E_V4_COMPACT_SEED 请回复种子");
    await waitForV4TimelineContaining("V4_COMPACT_SEED_OK", 45000);
    await waitForV4Pane(
      (s) =>
        !s.canStop && s.sessionId !== "draft" && s.sessionId !== null,
      "Did not return to idle state after first turn",
      45000,
    );

    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "/compact", {
      timeout: 15000,
      timeoutMsg: "Composer input box did not appear",
    });
    await clickV4Send();

    await waitForV4CompactMarker({ origin: "manual", status: "success" }, 90000);
  });
});
