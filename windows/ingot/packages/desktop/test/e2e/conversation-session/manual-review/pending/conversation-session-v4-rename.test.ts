import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  getV4SessionTitle,
  prepareV4ConversationE2E,
  renameV4Session,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

describe("v4 M4 门禁：renameSession", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Create session → Rename → Title projection updates to custom value", async () => {
    await prepareV4ConversationE2E();

    await sendV4Prompt("E2E_V4_RENAME_SEED create session");
    await waitForV4TimelineContaining("V4_RENAME_SEED_OK", 45000);
    await waitForV4Pane(
      (s) => s.sessionId !== "draft" && s.sessionId !== null,
      "会话没有建立",
      45000,
    );

    const customTitle = "E2E_V4_我的自定义会话";
    await renameV4Session(customTitle);

    await browser.waitUntil(
      async () => (await getV4SessionTitle()) === customTitle,
      { timeout: 30000, timeoutMsg: "会话标题没有更新为自定义值" },
    );
    expect(await getV4SessionTitle()).toBe(customTitle);
  });
});
