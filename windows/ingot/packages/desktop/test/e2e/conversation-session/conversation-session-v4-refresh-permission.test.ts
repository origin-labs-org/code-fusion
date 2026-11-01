import { mkdir, rm } from "node:fs/promises";
import { clearAppData } from "../helpers/desktop-app.js";
import { resolveE2ERuntimePath } from "../helpers/e2e-runtime-paths.js";
import {
  approveV4PermissionAlways,
  getV4PaneSnapshot,
  hasV4PermissionDialog,
  hasV4PermissionFeedbackInput,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4PermissionDialog,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

const V4_REFRESH_PERM_DIR = resolveE2ERuntimePath(
  "conversation-session-v4-refresh-permission",
);

describe("v4 refresh recovery: renderer refreshes while permission modal is pending", () => {
  before(async () => {
    await rm(V4_REFRESH_PERM_DIR, { recursive: true, force: true });
    await mkdir(V4_REFRESH_PERM_DIR, { recursive: true });
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
    await rm(V4_REFRESH_PERM_DIR, { recursive: true, force: true });
  });

  it("Permission modal pending → refresh → modal restored → approve → tool execution finalized", async () => {
    await prepareV4ConversationE2E();

    await sendV4Prompt("E2E_V4_REFRESH_PERM 使用 Bash 写入 fixture 文件");

    await waitForV4PermissionDialog();
    expect(await hasV4PermissionFeedbackInput()).toBe(true);
    const bound = await waitForV4Pane(
      (s) => s.sessionId !== "draft" && s.sessionId !== null,
      "Session was not bound before permission was pending",
      15000,
    );
    const sessionId = bound.sessionId;

    await browser.refresh();
    await waitForV4Pane(
      (s) => s.sessionId === sessionId,
      "Pane did not restore to the original session after refresh",
      60000,
    );

    await waitForV4PermissionDialog(30000);
    expect(await hasV4PermissionFeedbackInput()).toBe(true);

    const dismissed = await approveV4PermissionAlways();
    expect(dismissed).toBe(true);

    await waitForV4TimelineContaining("V4_REFRESH_PERM_DONE", 60000);

    let repeatedExactPrompted = false;
    await sendV4Prompt("E2E_V4_REFRESH_PERM_REPEAT Repeat the exact same Bash command");
    await browser.waitUntil(
      async () => {
        repeatedExactPrompted ||= await hasV4PermissionDialog();
        return (await getV4PaneSnapshot()).timelineText.includes("V4_REFRESH_PERM_REPEAT_DONE");
      },
      { timeout: 60000, timeoutMsg: "Persisted exact rule was not automatically executed after refresh" },
    );
    expect(repeatedExactPrompted).toBe(false);
  });
});
