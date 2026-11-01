import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { clearAppData } from "../../../helpers/desktop-app.js";
import { resolveE2ERuntimePath } from "../../../helpers/e2e-runtime-paths.js";
import {
  clickV4QueueItemEdit,
  getV4ConfigProjection,
  getV4QueueItems,
  prepareV4ConversationE2E,
  sendV4Prompt,
  setV4ComposerText,
  waitForV4ComposerText,
  switchV4Mode,
  waitForV4PermissionDialog,
  waitForV4QueueCount,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

const CASE = "conversation-session-permission-full-access";
const DIRECTORY = resolveE2ERuntimePath(CASE);

describe("PA158 Approve full access", () => {
  before(async () => {
    await mkdir(DIRECTORY, { recursive: true });
  });
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
    await rm(DIRECTORY, { recursive: true, force: true });
  });
  it("Original turn continues, running queue retains Plan respectively, revoke edit permission to yolo", async () => {
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Boolean(
            document.querySelector(
              '[data-testid="onboarding-page"],[data-testid="login-use-api-key-button"],[data-testid^="v4-session-pane-"]',
            ),
          ),
        ),
      { timeout: 30000 },
    );
    const onboarding = await $('[data-testid="onboarding-page"]');
    if (await onboarding.isExisting()) {
      for (let step = 0; step < 3; step += 1) {
        await $(
          '//main[@data-testid="onboarding-page"]//button[normalize-space()="跳过" or normalize-space()="跳过"]',
        ).click();
      }
      await onboarding.waitForExist({ reverse: true });
    }
    await prepareV4ConversationE2E();
    await sendV4Prompt("E2E_PA158_MAIN performs file write operation requiring confirmation");
    await waitForV4TimelineContaining("E2E_PA158_RUNNING");
    await switchV4Mode("plan");
    await sendV4Prompt("E2E_PA158_QUEUE_PLAN");
    await waitForV4QueueCount(1);
    await $('[data-testid="v4-composer-plan-marker"] button').click();
    await switchV4Mode("edit");
    expect(await getV4ConfigProjection()).toMatchObject({ mode: "edit", planEnabled: false });
    await sendV4Prompt("E2E_PA158_QUEUE_EDIT");
    await waitForV4QueueCount(2);
    const queue = await getV4QueueItems();
    await switchV4Mode("plan");
    await waitForV4PermissionDialog();
    const fullAccess = await $(
      'button[role="option"][aria-label="完全访问"],button[role="option"][aria-label="Full access"]',
    );
    await fullAccess.waitForDisplayed();
    if (process.env.CF_E2E_ARTIFACT_DIR) {
      await browser.saveScreenshot(
        join(process.env.CF_E2E_ARTIFACT_DIR, "permission-full-access.png"),
      );
    }
    await fullAccess.click();
    await waitForV4TimelineContaining("E2E_PA158_DONE");
    expect(await readFile(resolveE2ERuntimePath(CASE, "output.txt"), "utf8")).toBe(
      "E2E_PA158_TOOL_RESULT\n",
    );
    expect(await getV4QueueItems()).toEqual(queue);
    expect(await getV4ConfigProjection()).toMatchObject({ mode: "yolo", planEnabled: true });
    await clickV4QueueItemEdit(queue[0]!.queueItemId);
    await waitForV4QueueCount(1);
    await waitForV4ComposerText("E2E_PA158_QUEUE_PLAN", "First revoked draft was not restored");
    expect(await getV4ConfigProjection()).toMatchObject({ mode: "yolo", planEnabled: true });
    await setV4ComposerText("");
    await clickV4QueueItemEdit(queue[1]!.queueItemId);
    await waitForV4QueueCount(0);
    await waitForV4ComposerText("E2E_PA158_QUEUE_EDIT", "Second revoked draft was not restored");
    expect(await getV4ConfigProjection()).toMatchObject({ mode: "yolo", planEnabled: false });
  });
});
