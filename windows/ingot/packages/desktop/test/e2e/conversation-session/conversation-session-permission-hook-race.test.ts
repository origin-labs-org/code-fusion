import { readFile, mkdir, rm } from "node:fs/promises";
import { clearAppData } from "../helpers/desktop-app.js";
import {
  resolveE2ERuntimePath,
  resolveE2EToolPath,
} from "../helpers/e2e-runtime-paths.js";
import {
  installPermissionHookRaceFixture,
  PERMISSION_HOOK_RACE_FINAL_MARKER,
  PERMISSION_HOOK_RACE_MARKER,
  PERMISSION_HOOK_RACE_RESULT_CONTENT,
  readPermissionHookRaceTrace,
  restorePermissionHookRaceFixture,
  waitForBlockingHookStarted,
} from "../helpers/permission-hook-race-fixture.js";
import {
  approveV4Permission,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4PermissionDialogInComposerDock,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

const PERMISSION_HOOK_RACE_CASE = "conversation-session-permission-hook-race";
const PERMISSION_HOOK_RACE_DIR = resolveE2ERuntimePath(
  PERMISSION_HOOK_RACE_CASE,
);
const PERMISSION_HOOK_RACE_OUTPUT_PATH = resolveE2EToolPath(
  PERMISSION_HOOK_RACE_CASE,
  "write-output.txt",
);

describe("PermissionRequest Hook and Approval Interaction Race Condition", () => {
  before(async function () {
    this.timeout(120000);
    await rm(PERMISSION_HOOK_RACE_DIR, { recursive: true, force: true });
    await mkdir(PERMISSION_HOOK_RACE_DIR, { recursive: true });
    await installPermissionHookRaceFixture();
    await prepareV4ConversationE2E();
  });

  after(async () => {
    await restorePermissionHookRaceFixture();
    await browser.electron.restoreAllMocks();
    await clearAppData();
    await rm(PERMISSION_HOOK_RACE_DIR, { recursive: true, force: true });
  });

  it("HK16: Blocked PermissionRequest hook no longer blocks confirmation dialog response; user approval wins on first arrival", async function () {
    this.timeout(180000);

    await sendV4Prompt(
      `${PERMISSION_HOOK_RACE_MARKER} 请WriteFile ${PERMISSION_HOOK_RACE_OUTPUT_PATH}`,
    );

    const dockState = await waitForV4PermissionDialogInComposerDock();
    expect(dockState.inDock).toBe(true);
    expect(dockState.composerHidden).toBe(true);

    await waitForBlockingHookStarted();

    const dismissed = await approveV4Permission();
    expect(dismissed).toBe(true);

    await waitForV4TimelineContaining(PERMISSION_HOOK_RACE_FINAL_MARKER, 60000);

    expect(await readFile(PERMISSION_HOOK_RACE_OUTPUT_PATH, "utf8")).toBe(
      PERMISSION_HOOK_RACE_RESULT_CONTENT,
    );

    const trace = await readPermissionHookRaceTrace();
    expect(
      trace.filter((record) => record.phase === "started"),
    ).toHaveLength(1);
    expect(
      trace.some((record) => record.phase === "settled-without-decision"),
    ).toBe(false);
  });
});
