import { TID_CHAT_WORKFLOW_RUN_DIGEST } from "@origin-ai/cf-shared";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4AssistantMessageContaining,
} from "../../../helpers/v4-conversation.js";
import { waitForToolCallBlockByToolName } from "../../../helpers/conversation-session-tool.js";

// 「The `FillWorkflowHole` tool」、docs/dynamic-workflow/transcript-and-notifications.md「The hole row's live state」）
//
const RUN_DIGEST = `[data-testid^="${TID_CHAT_WORKFLOW_RUN_DIGEST}"]`;
const DECIDE_HOLE_ID = "hole#21b40fca";

describe("Dynamic workflow · Hole", () => {
  before(async () => {
    await prepareV4ConversationE2E();
  });
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("DWH-01 Hole stop drawn on card; turns to waiting state and spawns \"1 hole to complete\" upon run arrival", async function () {
    this.timeout(240000);
    await sendV4Prompt("Run flaky-hunt workflow (script with holes)");
    await waitForToolCallBlockByToolName("CreateWorkflow", 120000);
    const digest = await $(RUN_DIGEST);
    await digest.waitForDisplayed({ timeout: 120000 });

    const holeStation = await digest.$(
      '[data-testid="workflow-timeline-station"][data-station-hole]',
    );
    await holeStation.waitForDisplayed({ timeout: 60000 });
    expect(await holeStation.getText()).toContain("决定分组");
    expect(await holeStation.getText()).not.toContain("Plan");
    await expect(
      digest.$('[data-testid="workflow-timeline-rail"][data-rail-dashed="true"]'),
    ).toBeExisting();
    await expect(digest.$('[data-testid="workflow-timeline-tail-stub"]')).toBeExisting();

    await browser.waitUntil(
      async () => (await holeStation.getAttribute("data-station-hole")) === "waiting",
      { timeout: 120000, timeoutMsg: "run did not pause at hole" },
    );
    await expect(holeStation.$('[data-testid="workflow-hole-waiting"]')).toBeDisplayed();
    await expect(holeStation.$(".wf-lamp-hole-waiting")).toBeExisting();
    await expect(holeStation.$(".wf-lamp-running")).not.toBeExisting();
    const chip = await digest.$('[data-testid="workflow-digest-holes"]');
    await chip.waitForDisplayed({ timeout: 30000 });
    expect(await chip.getText()).toContain("1 hole to complete");
    for (const pill of await digest.$$('[data-testid="workflow-agent-pill"]')) {
      expect(await pill.getText()).not.toContain("Unnamed sub-agent");
    }
  });

  it("DWH-02 Notification row: pen icon, \"Workflow hole · Awaiting completion\"; expanded body has prompt, location, draft path, and wait duration", async function () {
    this.timeout(120000);
    const row = await $(
      '[data-testid^="chat-workflow-notification-row-"][data-hole-state="waiting"]',
    );
    await row.waitForDisplayed({ timeout: 120000 });
    expect(await row.getText()).toContain("Workflow hole · Awaiting completion");
    expect(await row.$('[data-testid="workflow-hole-notification-name"]').getText()).toBe(
      "决定分组",
    );
    await row.$('[role="button"]').click();
    const body = await row.$('[data-testid="workflow-hole-notification-body"]');
    await body.waitForDisplayed({ timeout: 10000 });
    expect(await body.getText()).toContain("Completion must return Plan");
    await expect(body.$('[data-testid="workflow-hole-notification-draft"]')).toBeExisting();
    await expect(body.$('[data-testid="workflow-hole-notification-waited"]')).toBeExisting();
  });

  it("DWH-03 Completion hooked into run: completion row says \"Hole completed\", card spawns header and new stops, notification row turns to \"Hole completed\"", async function () {
    this.timeout(240000);
    await waitForToolCallBlockByToolName("FillWorkflowHole", 180000);
    await waitForV4AssistantMessageContaining("补全", 180000);
    const fillRow = await $(
      '[data-testid="workflow-tool-summary"][data-tool-call-id]:has([data-testid="workflow-summary-hole-name"])',
    );
    await fillRow.waitForDisplayed({ timeout: 60000 });
    expect(await fillRow.getText()).toContain("Hole completed");
    expect(await fillRow.$('[data-testid="workflow-summary-hole-phases"]').getText()).toContain(
      " phases",
    );

    const digest = await $(RUN_DIGEST);
    const head = await digest.$('[data-testid="workflow-timeline-fill-head"]');
    await head.waitForDisplayed({ timeout: 60000 });
    expect(await head.getText()).toContain("决定分组");
    await expect(
      digest.$('[data-testid="workflow-timeline-fill-frame"][data-fill-fresh="true"]'),
    ).toBeExisting();
    await browser.waitUntil(
      async () =>
        !(await digest
          .$('[data-testid="workflow-timeline-fill-frame"][data-fill-fresh="true"]')
          .isExisting()),
      { timeout: 10000, timeoutMsg: "Box fresh state did not fade after two seconds" },
    );
    await (
      await digest.$(`[data-testid="workflow-timeline-station"][data-fill="${DECIDE_HOLE_ID}"]`)
    ).moveTo();
    await expect(
      digest.$('[data-testid="workflow-timeline-fill-frame"][data-fill-on="true"]'),
    ).not.toBeExisting();
    await head.moveTo();
    await expect(
      digest.$(
        `[data-testid="workflow-timeline-fill-frame"][data-fill-frame="${DECIDE_HOLE_ID}"][data-fill-on="true"]`,
      ),
    ).toBeExisting();
    expect(
      await digest.$$('[data-testid="workflow-timeline-fill-frame"][data-fill-on="true"]'),
    ).toHaveLength(1);
    await expect(digest.$('[data-testid="workflow-digest-holes"]')).not.toBeExisting();

    const row = await $(
      '[data-testid^="chat-workflow-notification-row-"][data-hole-state="filled"]',
    );
    await row.waitForDisplayed({ timeout: 60000 });
    expect(await row.getText()).toContain("Hole completed");
  });

  it("DWH-04 Side panel: hole section header, waiting body, completed title row (as box header), and unindented completion section; sidebar run row displays \"Determine grouping · Awaiting completion\"", async function () {
    this.timeout(120000);
    const digest = await $(RUN_DIGEST);
    await (await digest.$('[data-testid="workflow-timeline-fill-head"]')).click();
    const heading = await $('[data-testid="workflow-run-fill-heading"]');
    await heading.waitForDisplayed({ timeout: 60000 });
    expect(await heading.getText()).toContain("决定分组");
    await expect(
      $(`[data-testid="workflow-run-phase"][data-phase-fill="${DECIDE_HOLE_ID}"]`),
    ).toBeExisting();
    await heading.moveTo();
    await expect(
      $(
        `[data-testid="workflow-run-fill-frame"][data-fill-frame="${DECIDE_HOLE_ID}"][data-fill-on="true"]`,
      ),
    ).toBeExisting();
    const tail = await $('[data-testid="workflow-run-phase"][data-phase-hole="open"]');
    await expect(tail).toBeExisting();
    expect(await tail.getText()).toContain("评判");
    expect(await tail.getText()).not.toContain("Verdict");
    const line = await $('[data-workflow-run-line="true"]');
    await browser.waitUntil(async () => (await line.getText()).includes("等待补全"), {
      timeout: 120000,
      timeoutMsg: "Sidebar run row did not display \"Awaiting completion\"",
    });
    await expect(line.$('[data-rail-hole="waiting"]')).toBeExisting();
    await expect($('[data-testid="workflow-run-hole-waiting"]')).toBeExisting();
    await expect($('[data-testid="workflow-run-hole-prompt"]')).toBeExisting();
    await expect($('[data-testid="workflow-run-holes"]')).toBeExisting();
  });
});
