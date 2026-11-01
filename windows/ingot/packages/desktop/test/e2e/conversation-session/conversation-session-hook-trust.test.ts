import { openWorkspaceDraftFromSidebar } from "../helpers/workspace-agent-warmup.js";

import {
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  TID_V4_WORKSPACE_HOOK_PENDING_BANNER,
  TID_V4_WORKSPACE_HOOK_PENDING_DISMISS,
  TID_V4_WORKSPACE_HOOK_PENDING_REVIEW,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  clickTestIdByDom,
  waitForWorkspaceApp,
} from "../helpers/desktop-app.js";
import { sel } from "../helpers/selectors.js";
import {
  E2E_HOOK_TRUST_LABELS,
  readHookTrustExecutions,
  readHookTrustStore,
  waitForHookTrustExecution,
  waitForHookTrustStoreRecords,
} from "../helpers/hook-trust-fixture.js";
import {
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4Pane,
} from "../helpers/v4-conversation.js";

const HOOKS_SECTION_SELECTOR = '[data-testid="hooks-settings-section"]';
const HOOK_ROW_SELECTOR = '//div[@data-testid="configured-hook-row"]';
const TRUST_BUTTON_IN_ROW = './/button[.//*[contains(@class, "lucide-shield-check")]]';

describe("Workspace Hook Trust (HK05–HK07)", () => {
  before(async function () {
    this.timeout(120000);
    await prepareV4ConversationE2E();
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("HK05: Untrusted Hook skipped by soft gate; banner guides to settings, inline only provides trust and lock toggles", async function () {
    this.timeout(180000);

    await sendV4Prompt("E2E_HOOK_TRUST: reply with ok");
    await waitForIdle("Soft-gated turn did not return to idle");

    await $(sel(TID_V4_WORKSPACE_HOOK_PENDING_BANNER)).waitForDisplayed({
      timeout: 30000,
    });
    expect(await readHookTrustExecutions()).toHaveLength(0);

    await clickTestIdByDom(TID_V4_WORKSPACE_HOOK_PENDING_REVIEW, {
      timeout: 15000,
    });
    await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout: 15000 });
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "hooks"), {
      timeout: 15000,
    });
    await $(HOOKS_SECTION_SELECTOR).waitForDisplayed({ timeout: 15000 });

    await waitForHookTrustRowCount(3);
    for (const label of Object.values(E2E_HOOK_TRUST_LABELS)) {
      await assertUntrustedHookRow(label);
    }

    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
      timeout: 15000,
    });
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30000);
    await clickTestIdByDom(TID_V4_WORKSPACE_HOOK_PENDING_DISMISS, {
      timeout: 15000,
    });
    await $(sel(TID_V4_WORKSPACE_HOOK_PENDING_BANNER)).waitForDisplayed({
      timeout: 15000,
      reverse: true,
    });
    expect(await readHookTrustStore()).toBeNull();
  });

  it("HK06: Inline trust for a single declaration persists only that entry; other rows remain reviewable", async function () {
    this.timeout(180000);

    await openHooksSettings();

    const trustButton = await findTrustButton(E2E_HOOK_TRUST_LABELS.sessionStartA);
    await trustButton.waitForDisplayed({ timeout: 15000 });
    await trustButton.click();

    const records = await waitForHookTrustStoreRecords(
      (items) => items.length === 1,
      "Trusting session-start-a did not persist exactly one store record",
    );
    expect(records[0]!.decision).toBe("trusted");
    expect(records[0]!.eventAtGrant).toBe("SessionStart");

    await assertNoTrustButton(E2E_HOOK_TRUST_LABELS.sessionStartA);
    for (const label of [E2E_HOOK_TRUST_LABELS.sessionStartB, E2E_HOOK_TRUST_LABELS.promptSubmit]) {
      await (await findTrustButton(label)).waitForDisplayed({ timeout: 15000 });
    }

    await closeHooksSettings();
  });

  it("HK07: Trusting does not rerun skipped SessionStart; it applies only to future natural events", async function () {
    this.timeout(240000);

    await openHooksSettings();
    await clickTrustButton(E2E_HOOK_TRUST_LABELS.promptSubmit);
    await waitForHookTrustStoreRecords(
      (items) => items.length === 2,
      "Trusting prompt-submit did not persist a second store record",
    );
    await closeHooksSettings();

    await sendV4Prompt("E2E_HOOK_TRUST second prompt: reply with ok");
    await waitForHookTrustExecution(
      E2E_HOOK_TRUST_LABELS.promptSubmit,
      "Trusted UserPromptSubmit hook did not run on next natural prompt",
    );
    await waitForIdle("Second turn did not return to idle");

    const inTaskExecutions = await readHookTrustExecutions();
    expect(inTaskExecutions.filter((item) => item.event === "SessionStart")).toHaveLength(0);
    expect(inTaskExecutions.some((item) => item.label === E2E_HOOK_TRUST_LABELS.promptSubmit)).toBe(
      true,
    );

    await openWorkspaceDraftFromSidebar(DEFAULT_WORKSPACE);
    await sendV4Prompt("E2E_HOOK_TRUST new task: reply with ok");
    await waitForHookTrustExecution(
      E2E_HOOK_TRUST_LABELS.sessionStartA,
      "Trusted SessionStart hook did not run on the next natural session start",
    );
    await waitForIdle("New-task turn did not return to idle");

    const executions = await readHookTrustExecutions();
    expect(
      executions.filter((item) => item.label === E2E_HOOK_TRUST_LABELS.sessionStartA),
    ).toHaveLength(1);
    expect(executions.some((item) => item.label === E2E_HOOK_TRUST_LABELS.sessionStartB)).toBe(
      false,
    );
  });
});

async function waitForIdle(timeoutMsg: string): Promise<void> {
  await waitForV4Pane(
    (snapshot) =>
      snapshot.sessionId !== null && snapshot.sessionId !== "draft" && !snapshot.canStop,
    timeoutMsg,
    60000,
  );
}

async function openHooksSettings(): Promise<void> {
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
    timeout: 15000,
    timeoutMsg: "Hook trust E2E could not open Settings",
  });
  await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout: 15000 });
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "hooks"), {
    timeout: 15000,
  });
  await $(HOOKS_SECTION_SELECTOR).waitForDisplayed({ timeout: 15000 });
}

async function closeHooksSettings(): Promise<void> {
  await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
    timeout: 15000,
    timeoutMsg: "Hook trust E2E could not leave Settings",
  });
  await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30000);
}

async function waitForHookTrustRowCount(count: number): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(
        (expected: number) =>
          Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid="configured-hook-row"]'),
          ).filter((row) => row.innerText.includes("hook-trust-")).length === expected,
        count,
      ),
    {
      timeout: 15000,
      timeoutMsg: `Hooks settings did not render ${count} workspace hook rows`,
    },
  );
}

function hookRowSelector(label: string): string {
  return `${HOOK_ROW_SELECTOR}[contains(., "${label}")]`;
}

async function findTrustButton(label: string) {
  const row = await $(hookRowSelector(label));
  await row.waitForDisplayed({ timeout: 15000 });
  return await row.$(TRUST_BUTTON_IN_ROW);
}

async function clickTrustButton(label: string): Promise<void> {
  await (await findTrustButton(label)).click();
}

async function assertNoTrustButton(label: string): Promise<void> {
  const row = await $(hookRowSelector(label));
  await row.waitForDisplayed({ timeout: 15000 });
  await (
    await row.$(TRUST_BUTTON_IN_ROW)
  ).waitForExist({
    timeout: 15000,
    reverse: true,
  });
}

async function assertUntrustedHookRow(label: string): Promise<void> {
  const row = await $(hookRowSelector(label));
  await row.waitForDisplayed({ timeout: 15000 });

  const buttons = await row.$$("button");
  expect(buttons).toHaveLength(2);

  const trustButton = await row.$(TRUST_BUTTON_IN_ROW);
  await trustButton.waitForDisplayed({ timeout: 15000 });
  expect(await trustButton.isEnabled()).toBe(true);

  const switchControl = await row.$('button[role="switch"]');
  await switchControl.waitForDisplayed({ timeout: 15000 });
  expect(await switchControl.getAttribute("aria-checked")).toBe("false");
  expect(await switchControl.getAttribute("disabled")).not.toBeNull();
}
