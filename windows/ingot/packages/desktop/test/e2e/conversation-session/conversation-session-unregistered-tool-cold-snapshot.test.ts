import {
  TID_CHAT_TOOL_CALL_BLOCK,
  TID_CHAT_LOADING,
  TID_V4_COMPOSER_SEND,
  TID_V4_TIMELINE_LOAD_OLDER,
} from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../helpers/desktop-app.js";
import {
  getV4TimelineScrollState,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

const PROMPT_MARKER = "E2E_UNREGISTERED_TOOL_COLD_SNAPSHOT";
const FINAL_MARKER = `${PROMPT_MARKER}_DONE`;
const SNAPSHOT_TAIL_ROW_COUNT = 60;

describe("O17/CHL09 Unregistered tool final cold snapshot", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("HLP01/CHL09: Same turn automatically completed after trailing window truncation and remains in final state", async function () {
    this.timeout(120000);

    await prepareV4ConversationE2E();
    await sendV4Prompt(`${PROMPT_MARKER} 构造未注册 Grep Tools批次并在 continuation 后结束`);
    await waitForV4TimelineContaining(FINAL_MARKER, 60000);

    const terminal = await waitForV4Pane(
      (snapshot) =>
        snapshot.sessionId !== null &&
        snapshot.sessionId !== "draft" &&
        !snapshot.canStop &&
        snapshot.timelineText.includes(FINAL_MARKER),
      "未注册工具批次完成后会话没有进入 terminal",
      60000,
    );
    if (!terminal.sessionId || terminal.sessionId === "draft") {
      throw new Error("terminal 会话缺少 session id");
    }
    const sessionId = terminal.sessionId;

    const liveRows = await getV4TimelineScrollState();
    expect(liveRows.totalRowCount).toBeGreaterThan(SNAPSHOT_TAIL_ROW_COUNT);
    expect(await readTerminalUiState()).toMatchObject({
      loadingCount: 0,
      sendButtonExists: true,
    });

    await browser.refresh();
    await waitForV4Pane(
      (snapshot) => snapshot.sessionId === sessionId && !snapshot.canStop,
      "refresh 后 pane 没有恢复已完成会话",
      60000,
    );
    await browser.waitUntil(
      async () => {
        const rows = await getV4TimelineScrollState();
        return (
          rows.totalRowCount > SNAPSHOT_TAIL_ROW_COUNT &&
          rows.windowRowCount === rows.totalRowCount
        );
      },
      {
        timeout: 15000,
        timeoutMsg:
          "60-row cold tail of the same turn was not auto-completed after refresh, still requiring manual or reverse scrolling",
      },
    );
    expect(
      await browser.execute(
        (testId) => Boolean(document.querySelector(`[data-testid="${testId}"]`)),
        TID_V4_TIMELINE_LOAD_OLDER,
      ),
    ).toBe(false);
    await waitForV4TimelineContaining(PROMPT_MARKER, 15000);
    await waitForV4TimelineContaining(FINAL_MARKER, 30000);
    await browser.pause(500);

    const restored = await readTerminalUiState();
    expect(restored.sendButtonExists).toBe(true);
    expect(restored.activeToolCount).toBe(0);
    expect(restored.loadingCount).toBe(0);
  });
});

function readTerminalUiState(): Promise<{
  activeToolCount: number;
  loadingCount: number;
  sendButtonExists: boolean;
}> {
  return browser.execute(
    (chatLoadingTestId, sendButtonTestId, toolCallBlockTestId) => {
      const sendButton = document.querySelector<HTMLButtonElement>(
        `[data-testid="${sendButtonTestId}"]`,
      );
      const toolSelector = `[data-testid^="${toolCallBlockTestId}-"]`;
      return {
        activeToolCount: document.querySelectorAll(
          `${toolSelector}[data-status="pending"],${toolSelector}[data-status="in_progress"]`,
        ).length,
        loadingCount: document.querySelectorAll(`[data-testid="${chatLoadingTestId}"]`).length,
        sendButtonExists: Boolean(sendButton),
      };
    },
    TID_CHAT_LOADING,
    TID_V4_COMPOSER_SEND,
    TID_CHAT_TOOL_CALL_BLOCK,
  );
}
