import { TID_TASK_ITEM } from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  clickV4DeleteSession,
  getV4PaneSnapshot,
  getV4SessionTitle,
  prepareV4ConversationE2E,
  renameV4Session,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

async function sidebarTaskItemText(sessionId: string): Promise<string | null> {
  return browser.execute(
    (itemTestId, id) => {
      const el = document.querySelector(
        `[data-testid="${itemTestId}-${id}"]`,
      );
      return el ? (el.textContent ?? "") : null;
    },
    TID_TASK_ITEM,
    sessionId,
  );
}

describe("v4 M5 ② Gate: Sidebar list data source sessions-index (Create → Appear → Rename → Update → Delete → Disappear)", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Create session → Appears in sidebar → Rename → Sidebar updates → Delete → Disappears from sidebar", async () => {
    await prepareV4ConversationE2E();
    await sendV4Prompt("E2E_V4_SIDEBAR_SEED create session");
    await waitForV4TimelineContaining("V4_SIDEBAR_SEED_OK", 45000);
    await waitForV4Pane(
      (s) => s.sessionId !== "draft" && s.sessionId !== null,
      "会话没有建立",
      45000,
    );
    const sessionId = (await getV4PaneSnapshot()).sessionId as string;

    await browser.waitUntil(
      async () => (await sidebarTaskItemText(sessionId)) !== null,
      { timeout: 30000, timeoutMsg: "New session did not appear in sidebar task list" },
    );

    const customTitle = "E2E_V4_SIDEBAR_RENAMED";
    await renameV4Session(customTitle);
    await browser.waitUntil(
      async () => (await getV4SessionTitle()) === customTitle,
      { timeout: 30000, timeoutMsg: "会话标题没有更新为自定义值" },
    );
    await browser.waitUntil(
      async () => {
        const text = await sidebarTaskItemText(sessionId);
        return text !== null && text.includes(customTitle);
      },
      { timeout: 30000, timeoutMsg: "侧栏 task 项没有跟随重命名更新标题" },
    );

    await clickV4DeleteSession();
    await browser.waitUntil(
      async () => (await sidebarTaskItemText(sessionId)) === null,
      { timeout: 30000, timeoutMsg: "删除后侧栏 task 项没有消失" },
    );
  });
});
