import { clearAppData } from "./helpers/desktop-app.js";
import { prepareConversationE2E } from "./helpers/conversation-session.js";
import {
  clickCloseButton,
  openFirstBrowserTab,
  readBrowserTabIds,
  waitForTabCount,
} from "./helpers/browser-side-pane.js";

interface CloseTabProbeResult {
  ok: boolean;
  message: string;
}

describe("Browser tab close idempotency E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("BTC01: main 已经关闭逻辑 tab 后，renderer 再次请求关闭仍然成功", async function () {
    this.timeout(300000);
    await prepareConversationE2E({ skipProvider: true });

    await openFirstBrowserTab();
    const tabIds = await readBrowserTabIds();
    const tabId = tabIds[0];
    if (!tabId) throw new Error("没有成功打开 Browser tab，无法验证关闭幂等性");

    await clickCloseButton(tabId);
    await waitForTabCount(0);

    const probe = await requestCloseTabViaIpc(tabId);
    expect(probe).toEqual({ ok: true, message: "" });
  });
});

async function requestCloseTabViaIpc(tabId: string): Promise<CloseTabProbeResult> {
  return browser.execute(async (targetTabId) => {
    const bridge = (
      window as unknown as {
        cf?: { browserViewCloseTab?: (payload: Record<string, unknown>) => Promise<void> };
      }
    ).cf;
    if (!bridge?.browserViewCloseTab) {
      return { ok: false, message: "preload did not expose browserViewCloseTab" };
    }
    try {
      await bridge.browserViewCloseTab({
        tabId: targetTabId,
        workspaceKey: "e2e-unknown-workspace",
        sessionId: "e2e-unknown-session",
      });
      return { ok: true, message: "" };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }, tabId);
}
