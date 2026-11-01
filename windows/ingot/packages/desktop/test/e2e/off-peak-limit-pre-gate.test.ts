import {
  restartIntoWorkspace,
  seedBigModelConnectionSelection,
  seedBigModelOAuthCredential,
} from "./helpers/model-provider-restart.js";
import { TID_OFFPEAK_CREATE_BUTTON, TID_AUTOMATIONS_OPEN } from "@origin-ai/cf-shared/test-ids";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearAppData,
  clickTestIdByDom,
  waitForDefaultWorkspaceReady,
} from "./helpers/desktop-app.js";
import { loginWithApiKey } from "./helpers/conversation-session.js";

const SHOT_DIR = process.env.CF_OFFPEAK_SHOT_DIR ?? join(tmpdir(), "zc-offpeak-verify-shots");
let shotSeq = 0;
async function shot(label: string): Promise<void> {
  shotSeq += 1;
  const name = `${String(shotSeq).padStart(2, "0")}-${label}.png`;
  try {
    await browser.saveScreenshot(join(SHOT_DIR, name));
  } catch {
  }
}

describe("Idle-time task server quota snapshot grayed out E2E (D39)", () => {
  before(() => {
    try {
      mkdirSync(SHOT_DIR, { recursive: true });
    } catch {
      // ignore
    }
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Button is grayed out and displays next_take_at when availability does not allow creation", async function () {
    this.timeout(150000);

    try {
      await waitForDefaultWorkspaceReady(30000);
    } catch {
      await loginWithApiKey();
      await waitForDefaultWorkspaceReady(30000);
    }

    await restartIntoWorkspace({
      afterElectronProcessExit: async () => {
        await seedBigModelConnectionSelection({ kind: "individual-coding-plan" });
        await seedBigModelOAuthCredential();
      },
    });
    await clickTestIdByDom(TID_AUTOMATIONS_OPEN, {
      timeoutMsg: "侧栏没有出现 Automations 入口",
    });
    await browser.pause(2500);
    await shot("automations-open");

    await browser.waitUntil(async () => (await offPeakCreateButtonState()).present, {
      timeout: 10000,
      timeoutMsg: "Idle-time task creation button did not appear (canary rollout missed?)",
    });
    await browser.execute(() => {
      document.documentElement.style.setProperty("--ui-font-size", "20px");
    });
    const state = await offPeakCreateButtonState();
    if (!state.disabled) {
      throw new Error("Create button should be grayed out in advance when server quota is unavailable");
    }
    if (!state.tooltip || !/额度|limit/i.test(state.tooltip)) {
      throw new Error(`额度置灰必须Show Tooltip：${state.tooltip ?? "<empty>"}`);
    }
    if (!/(小时|分钟|hr|min)/i.test(state.tooltip)) {
      throw new Error(`额度 Tooltip 必须包含小时/分钟RemainingDuration：${state.tooltip}`);
    }
    if (/\d{4}|年|月|日/.test(state.tooltip)) {
      throw new Error(`额度 Tooltip 不应展示年月日or绝对Date：${state.tooltip}`);
    }
    if (!state.contentContained) {
      throw new Error("Quota tooltip text must be fully contained within the background");
    }
    await shot("create-button-quota-disabled");
    await browser.pause(3000);
  });
});

async function offPeakCreateButtonState(): Promise<{
  present: boolean;
  disabled: boolean;
  tooltip: string | null;
  contentContained: boolean;
}> {
  const state = await browser.execute((btnTid) => {
    const button = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
      (item) => item.dataset.testid === btnTid,
    );
    if (!(button instanceof HTMLButtonElement)) {
      return { present: false, disabled: false };
    }
    return {
      present: true,
      disabled: button.disabled,
    };
  }, TID_OFFPEAK_CREATE_BUTTON);

  if (!state.present) {
    return { ...state, tooltip: null, contentContained: false };
  }
  const button = await $(`[data-testid="${TID_OFFPEAK_CREATE_BUTTON}"]`);
  const trigger = await button.$("..");
  await trigger.moveTo();
  await browser.waitUntil(
    () =>
      browser.execute(() =>
        Array.from(document.querySelectorAll<HTMLElement>("[data-slot='tooltip-content']")).some(
          (item) => item.dataset.state !== "closed",
        ),
      ),
    { timeout: 5_000, timeoutMsg: "Quota tooltip did not open on actual hover" },
  );
  const tooltip = await browser.execute(() => {
    const content = Array.from(
      document.querySelectorAll<HTMLElement>("[data-slot='tooltip-content']"),
    ).find((item) => item.dataset.state !== "closed");
    const title = content?.querySelector<HTMLElement>(":scope > span.text-ui-sm");
    if (!content || !title) {
      return { text: null, contentContained: false };
    }
    const contentRect = content.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    return {
      text: title.textContent?.trim() ?? null,
      contentContained:
        titleRect.left >= contentRect.left - 0.5 &&
        titleRect.right <= contentRect.right + 0.5 &&
        titleRect.top >= contentRect.top - 0.5 &&
        titleRect.bottom <= contentRect.bottom + 0.5,
    };
  });
  return {
    ...state,
    tooltip: tooltip.text,
    contentContained: tooltip.contentContained,
  };
}
