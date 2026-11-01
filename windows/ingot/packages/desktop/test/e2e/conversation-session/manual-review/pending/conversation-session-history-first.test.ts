import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TID_V4_COMPOSER_INPUT, TID_V4_COMPOSER_SEND } from "@origin-ai/cf-shared/test-ids";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  waitForWorkspaceApp,
  setInputValueByTestIdDom,
} from "../../../helpers/desktop-app.js";
import {
  prepareV4ConversationE2E,
  selectV4TaskById,
  waitForV4TimelineContaining,
  scrollV4TimelineToTop,
  getV4TimelineScrollState,
} from "../../../helpers/v4-conversation.js";
import {
  HISTORY_FIRST_SESSION,
  HISTORY_FIRST_FAILED_SESSION,
  HISTORY_FIRST_TEXT,
} from "../../../helpers/session-history-first-fixture.js";

const root = join(DEFAULT_WORKSPACE, ".cf", "history-first-e2e");
const release = join(root, "release");
const entered = join(root, "entered");
const artifacts = process.env.CF_E2E_ARTIFACT_DIR ?? join(process.cwd(), ".e2e-artifacts");

describe("HF01: First history frame completed before resume hook", () => {
  afterEach(async function () {
    if (this.currentTest?.state !== "failed") return;
    await browser.saveScreenshot(join(artifacts, "history-first-failure.png"));
    console.info(
      "history-first UI failure",
      await browser.execute(() => ({
        text: document.body.innerText.slice(-6000),
        dialogs: [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].map(
          (node) => node.textContent,
        ),
        trigger: document.querySelector('[data-testid="chat-model-select-trigger"]')?.outerHTML,
      })),
    );
  });
  after(async () => {
    await writeFile(release, "release").catch(() => undefined);
    await clearAppData();
  });

  it("History can be read and drafts edited first; sending is allowed only after the initialization barrier is released", async function () {
    this.timeout(180_000);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);
    await prepareV4ConversationE2E();
    const openedAt = performance.now();
    await selectV4TaskById(HISTORY_FIRST_SESSION);
    await waitForV4TimelineContaining(HISTORY_FIRST_TEXT, 30_000);
    const historyVisibleMs = Math.round(performance.now() - openedAt);
    await browser.waitUntil(
      async () => (await readFile(entered, "utf8").catch(() => "")) === "entered",
      { timeout: 30_000, timeoutMsg: "resume hook 未进入屏障" },
    );
    expect(await $(`[data-testid="v4-session-initialization"]`).isExisting()).toBe(false);
    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "E2E_HISTORY_FIRST preserved draft");
    expect(await $(`[data-testid="${TID_V4_COMPOSER_SEND}"]`).isEnabled()).toBe(false);
    await browser.saveScreenshot(join(artifacts, "history-first-initializing.png"));
    await writeFile(release, "release");
    await browser.waitUntil(
      async () => await $(`[data-testid="${TID_V4_COMPOSER_SEND}"]`).isEnabled(),
      { timeout: 30_000, timeoutMsg: "初始化未收敛" },
    );
    expect(await $(`[data-testid="${TID_V4_COMPOSER_INPUT}"]`).getText()).toContain(
      "E2E_HISTORY_FIRST preserved draft",
    );
    expect(await $(`[data-testid="${TID_V4_COMPOSER_SEND}"]`).isEnabled()).toBe(true);
    console.info("history-first timings", {
      historyVisibleMs,
      runtimeReadyMs: Math.round(performance.now() - openedAt),
    });
    await $(`[data-testid="${TID_V4_COMPOSER_SEND}"]`).click();
    await waitForV4TimelineContaining("HISTORY_FIRST_OK", 30_000);
  });

  it("HF02: History, draft, and scroll are preserved after final materialization failure; double-click retry restores only once", async function () {
    this.timeout(120_000);
    await Promise.all([rm(release, { force: true }), rm(entered, { force: true })]);
    await selectV4TaskById(HISTORY_FIRST_FAILED_SESSION);
    await waitForV4TimelineContaining("History paragraph", 30_000);
    await browser.waitUntil(
      async () => (await readFile(entered, "utf8").catch(() => "")) === "entered",
      { timeout: 30_000, timeoutMsg: "Hook for failed case did not enter barrier" },
    );
    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "E2E_HISTORY_FIRST retry preserved draft");
    await scrollV4TimelineToTop();
    const scrollBefore = (await getV4TimelineScrollState()).scrollTop;
    const database = new DatabaseSync(
      join(DEFAULT_WORKSPACE, "..", ".cf", "cli", "db", "db.sqlite"),
    );
    try {
      database
        .prepare("UPDATE session SET revert = '{' WHERE id = ?")
        .run(HISTORY_FIRST_FAILED_SESSION);
      await writeFile(release, "release");
      const retry = $('[data-testid="v4-session-initialization-retry"]');
      await retry.waitForDisplayed({ timeout: 30_000 });
      await browser.saveScreenshot(join(artifacts, "history-first-retry.png"));
      expect(await $(`[data-testid="${TID_V4_COMPOSER_INPUT}"]`).getText()).toContain(
        "Retry preserved draft",
      );
      expect(Math.abs((await getV4TimelineScrollState()).scrollTop - scrollBefore)).toBeLessThan(2);
      await waitForV4TimelineContaining(HISTORY_FIRST_TEXT);
      database
        .prepare("UPDATE session SET revert = NULL WHERE id = ?")
        .run(HISTORY_FIRST_FAILED_SESSION);
      await Promise.all([rm(release, { force: true }), rm(entered, { force: true })]);
      const attemptsBefore = (await readFile(join(root, "attempts"), "utf8"))
        .trim()
        .split("\n").length;
      await retry.doubleClick();
      await browser.waitUntil(
        async () => (await readFile(entered, "utf8").catch(() => "")) === "entered",
        { timeout: 30_000, timeoutMsg: "重试未重新执行 resume hook" },
      );
      expect((await readFile(join(root, "attempts"), "utf8")).trim().split("\n").length).toBe(
        attemptsBefore + 1,
      );
      expect(await $('[data-testid="v4-session-initialization"]').isExisting()).toBe(false);
      expect(await $(`[data-testid="${TID_V4_COMPOSER_SEND}"]`).isEnabled()).toBe(false);
      await writeFile(release, "release");
      await browser.waitUntil(
        async () => await $(`[data-testid="${TID_V4_COMPOSER_SEND}"]`).isEnabled(),
        { timeout: 30_000, timeoutMsg: "重试未就绪" },
      );
      expect(await $(`[data-testid="${TID_V4_COMPOSER_INPUT}"]`).getText()).toContain(
        "Retry preserved draft",
      );
      expect(await $(`[data-testid="${TID_V4_COMPOSER_SEND}"]`).isEnabled()).toBe(true);
      expect(Math.abs((await getV4TimelineScrollState()).scrollTop - scrollBefore)).toBeLessThan(2);
    } finally {
      database
        .prepare("UPDATE session SET revert = NULL WHERE id = ?")
        .run(HISTORY_FIRST_FAILED_SESSION);
      database.close();
    }
  });
});
