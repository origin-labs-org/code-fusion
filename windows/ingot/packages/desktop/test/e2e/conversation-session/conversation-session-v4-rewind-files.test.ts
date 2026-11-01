import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { clearAppData, DEFAULT_WORKSPACE } from "../helpers/desktop-app.js";
import { countUpstreamRequestsContaining } from "../helpers/conversation-session-network.js";
import {
  approveV4Permission,
  beginFirstV4UserQueryEdit,
  clickV4EditConflictConversationOnly,
  clickV4EditWorkspaceReset,
  getV4PaneSnapshot,
  prepareV4ConversationE2E,
  sendV4Prompt,
  switchV4Mode,
  waitForV4Edit,
  waitForV4EditWorkspaceConflict,
  waitForLatestV4CommandAck,
  waitForV4Pane,
  waitForV4PermissionDialog,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

const CASE_ROOT = join(DEFAULT_WORKSPACE, "v4-rewind-files-e2e");
const SAFE_RELATIVE_PATH = "v4-rewind-files-e2e/safe.txt";
const CONFLICT_RELATIVE_PATH = "v4-rewind-files-e2e/conflict.txt";
const SAFE_PATH = join(DEFAULT_WORKSPACE, SAFE_RELATIVE_PATH);
const CONFLICT_PATH = join(DEFAULT_WORKSPACE, CONFLICT_RELATIVE_PATH);

describe("PV4-21/PV4-22 conversation + file rewind", () => {
  afterEach(async () => {
    await rm(CASE_ROOT, { force: true, recursive: true });
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("PV4-21 safe checkpoint commits same-session branch only after reverse-order file restoration", async function () {
    this.timeout(150000);
    await prepareFileCase(SAFE_PATH);

    await sendV4Prompt("E2E_V4_REWIND_FILE_SAFE 请更新 safe.txt");
    await approvePendingFileWriteIfRequired();
    await waitForV4TimelineContaining(
      "V4_REWIND_FILE_SAFE_ORIGINAL_REPLY",
      90000,
    );
    await waitForFileContent(SAFE_PATH, "safe-after\n");
    const originalSessionId = (await getV4PaneSnapshot()).sessionId;

    await waitForV4Edit();
    const rowId = await beginFirstV4UserQueryEdit(
      "E2E_V4_REWIND_FILE_SAFE_EDITED Resend after file restoration",
    );
    await clickV4EditWorkspaceReset(rowId);

    const rewindAck = await waitForLatestV4CommandAck(
      "editUserQuery",
      30000,
    ).catch(async (error) => {
      const fileState = await readFile(SAFE_PATH, "utf8").catch(
        () => "<missing>",
      );
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; safe.txt=${JSON.stringify(fileState)}`,
      );
    });
    expect(rewindAck.status).toBe("accepted");

    await waitForV4TimelineContaining(
      "V4_REWIND_FILE_SAFE_EDITED_REPLY",
      90000,
    );
    await waitForV4Pane(
      (snapshot) => !snapshot.canStop,
      "Safe combined rewind did not return to idle",
      60000,
    );
    expect(await readFile(SAFE_PATH, "utf8")).toBe("safe-before\n");
    const finalSnapshot = await getV4PaneSnapshot();
    expect(finalSnapshot.sessionId).toBe(originalSessionId);
    expect(finalSnapshot.timelineText).not.toContain(
      "V4_REWIND_FILE_SAFE_ORIGINAL_REPLY",
    );
    expect(finalSnapshot.timelineText).not.toContain(
      "Conversation rewind applied",
    );
  });

  it("PV4-22 external modified blocked first, downgrades to dialogue-only truncation with new commandId", async function () {
    this.timeout(150000);
    await prepareFileCase(CONFLICT_PATH);

    await sendV4Prompt("E2E_V4_REWIND_FILE_CONFLICT 请更新 conflict.txt");
    await approvePendingFileWriteIfRequired();
    await waitForV4TimelineContaining(
      "V4_REWIND_FILE_CONFLICT_ORIGINAL_REPLY",
      90000,
    );
    await waitForFileContent(CONFLICT_PATH, "conflict-after\n");
    await writeFile(CONFLICT_PATH, "external-wins\n", "utf8");

    const editedMarker = "E2E_V4_REWIND_FILE_CONFLICT_EDITED";
    const requestsBefore = await countUpstreamRequestsContaining(editedMarker);
    await waitForV4Edit();
    const rowId = await beginFirstV4UserQueryEdit(`${editedMarker} 只ResetChat`);
    await clickV4EditWorkspaceReset(rowId);
    await waitForV4EditWorkspaceConflict(60000);

    expect(await readFile(CONFLICT_PATH, "utf8")).toBe("external-wins\n");
    expect((await getV4PaneSnapshot()).timelineText).toContain(
      "V4_REWIND_FILE_CONFLICT_ORIGINAL_REPLY",
    );
    expect(await countUpstreamRequestsContaining(editedMarker)).toBe(
      requestsBefore,
    );

    await clickV4EditConflictConversationOnly();
    await waitForV4TimelineContaining(
      "V4_REWIND_FILE_CONFLICT_EDITED_REPLY",
      90000,
    );
    expect(await readFile(CONFLICT_PATH, "utf8")).toBe("external-wins\n");
    const finalSnapshot = await getV4PaneSnapshot();
    expect(finalSnapshot.timelineText).not.toContain(
      "V4_REWIND_FILE_CONFLICT_ORIGINAL_REPLY",
    );
    expect(await countUpstreamRequestsContaining(editedMarker)).toBe(
      requestsBefore + 1,
    );
  });
});

async function prepareFileCase(filePath: string) {
  await rm(CASE_ROOT, { force: true, recursive: true });
  await mkdir(CASE_ROOT, { recursive: true });
  await writeFile(
    filePath,
    filePath === SAFE_PATH ? "safe-before\n" : "conflict-before\n",
    "utf8",
  );
  await prepareV4ConversationE2E();
  await switchV4Mode("yolo");
}

async function waitForFileContent(filePath: string, expected: string) {
  await browser.waitUntil(
    async () => (await readFile(filePath, "utf8").catch(() => "")) === expected,
    { timeout: 60000, timeoutMsg: `${filePath} 没有收敛到期望inner容` },
  );
}

async function approvePendingFileWriteIfRequired() {
  try {
    await waitForV4PermissionDialog(15000);
    expect(await approveV4Permission()).toBe(true);
  } catch {
  }
}
