import {
  TID_COMPOSER_REMOTE_CONNECTION,
  TID_COMPOSER_WORKSPACE_TRIGGER,
  TID_SSH_DIALOG,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByWebDriver,
} from "../../../helpers/desktop-app.js";
import { prepareConversationE2E } from "../../../helpers/conversation-session.js";

describe("Session area remote connection modal and workspace menu mutual exclusion E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("CWP12: Close parent menu when opening remote connection modal from composer workspace menu", async function () {
    this.timeout(90000);

    await prepareConversationE2E({ skipProvider: true });
    await clickTestIdByWebDriver(TID_COMPOSER_WORKSPACE_TRIGGER, {
      timeout: 15000,
      timeoutMsg: "Workspace menu trigger not displayed for empty draft",
    });
    await clickTestIdByWebDriver(TID_COMPOSER_REMOTE_CONNECTION, {
      timeout: 15000,
      timeoutMsg: "Workspace menu does not show remote connection entry",
    });

    await browser.waitUntil(
      async () => {
        const snapshot = await readOverlaySnapshot();
        return (
          snapshot.remoteDialogVisible &&
          !snapshot.remoteMenuItemExists &&
          snapshot.workspaceMenuExpanded === "false"
        );
      },
      {
        timeout: 15000,
        timeoutMsg: "远程连接弹窗打开后，父工作区菜单没有关闭",
      },
    );

    expect(await readOverlaySnapshot()).toEqual({
      remoteDialogVisible: true,
      remoteMenuItemExists: false,
      workspaceMenuExpanded: "false",
    });
  });
});

function readOverlaySnapshot() {
  return browser.execute(
    (workspaceTriggerTestId, remoteMenuItemTestId, remoteDialogTestId) => {
      const workspaceTrigger = document.querySelector<HTMLElement>(
        `[data-testid="${workspaceTriggerTestId}"]`,
      );
      const remoteMenuItem = document.querySelector<HTMLElement>(
        `[data-testid="${remoteMenuItemTestId}"]`,
      );
      const remoteDialog = document.querySelector<HTMLElement>(
        `[data-testid="${remoteDialogTestId}"]`,
      );

      return {
        remoteDialogVisible:
          remoteDialog !== null &&
          remoteDialog.getClientRects().length > 0 &&
          getComputedStyle(remoteDialog).visibility !== "hidden",
        remoteMenuItemExists: remoteMenuItem !== null,
        workspaceMenuExpanded:
          workspaceTrigger?.getAttribute("aria-expanded") ?? null,
      };
    },
    TID_COMPOSER_WORKSPACE_TRIGGER,
    TID_COMPOSER_REMOTE_CONNECTION,
    TID_SSH_DIALOG,
  );
}
