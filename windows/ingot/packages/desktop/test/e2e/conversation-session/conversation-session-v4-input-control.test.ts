import {
  clearAppData,
} from "../helpers/desktop-app.js";
import {
  getV4InputControlState,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

describe("v4 输入控制条：隐藏 queue 行为局部按钮", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("建立 session 后不渲染 autoDrain/followupMode 局部按钮", async () => {
    await prepareV4ConversationE2E();

    await sendV4Prompt("E2E_V4_INPUT_CONTROL_SEED 建立会话");
    await waitForV4TimelineContaining("V4_INPUT_CONTROL_SEED_OK", 45000);
    await waitForV4Pane(
      (s) => !s.canStop && s.sessionId !== "draft" && s.sessionId !== null,
      "Did not return to idle state after first turn",
      45000,
    );

    const state = await getV4InputControlState();
    expect(state.autoDrain).toBeNull();
    expect(state.followupMode).toBeNull();
  });
});
