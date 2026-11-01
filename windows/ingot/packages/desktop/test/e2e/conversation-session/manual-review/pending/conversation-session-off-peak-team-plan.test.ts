import {
  TID_AUTOMATIONS_OPEN,
  TID_MODEL_PROVIDER_CONNECTION_MODE_ITEM,
  TID_MODEL_PROVIDER_CONNECTION_MODE_TRIGGER,
  TID_MODEL_PROVIDER_NAV_ITEM,
  TID_OFFPEAK_CARD,
  TID_OFFPEAK_CREATE_BUTTON,
  TID_OFFPEAK_EDIT_SUBMIT,
  TID_OFFPEAK_FORM_INSTRUCTIONS,
  TID_OFFPEAK_FORM_TITLE,
  TID_OFFPEAK_TAB,
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  setInputValueByTestIdDom,
  waitForTestIdByDom,
} from "../../../helpers/desktop-app.js";
import { prepareConversationE2E } from "../../../helpers/conversation-session.js";
import { sel } from "../../../helpers/selectors.js";

const BIGMODEL_API_KEY_NAV_KEY = "preset:bigmodel-api";
const TEAM_PLAN_KEY = "team:bigmodel:product-team-a:org-team-a:proj-team-a";

interface OffPeakRequestRecord {
  hasCodingPlanApiKey: boolean;
  model?: string;
  organization?: string;
  project?: string;
  ticketId: string;
}

describe("Team Coding Plan 闲时任务 E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("F-OFFPEAK-002: Off-peak requests use Team idle-plan identity when Team scope is valid", async function () {
    this.timeout(240000);
    await prepareConversationE2E({ skipProvider: true });
    await selectTeamPlanConnection();
    await createOffPeakTask();

    const request = (await waitForOffPeakRequest()).at(-1);
    expect(request?.hasCodingPlanApiKey).toBe(true);
    expect(request?.organization).toBe("org-team-a");
    expect(request?.project).toBe("proj-team-a");
    expect(request?.ticketId).toMatch(/^mock-ticket-/u);
    expect(request?.model).toBeTruthy();

    await clickTestIdByDom(TID_AUTOMATIONS_OPEN, { timeoutMsg: "Failed to reopen Automations" });
    await selectIdleTimeTab();
    await browser.waitUntil(
      async () => (await readCardTexts()).some((text) => text.includes("E2E_OFFPEAK_TEAM_")),
      { timeout: 30000, timeoutMsg: "List did not reflect completed Team off-peak task" },
    );
  });
});

async function selectTeamPlanConnection() {
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, { timeoutMsg: "Settings entry not found" });
  await waitForTestIdByDom(TID_SETTINGS_PAGE, { timeoutMsg: "设置页没有打开" });
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "modelProvider"), {
    timeoutMsg: "Model provider settings entry did not appear",
  });
  await clickTestIdByDom(testId(TID_MODEL_PROVIDER_NAV_ITEM, BIGMODEL_API_KEY_NAV_KEY), {
    timeoutMsg: "BigModel 供应商没有出现",
  });
  await clickTestIdByDom(TID_MODEL_PROVIDER_CONNECTION_MODE_TRIGGER, {
    timeoutMsg: "连接方式选择器没有出现",
  });
  const item = $(sel(testId(TID_MODEL_PROVIDER_CONNECTION_MODE_ITEM, TEAM_PLAN_KEY)));
  await item.waitForDisplayed({ timeout: 30000, timeoutMsg: "Team Plan 连接方式没有出现" });
  await item.click();
  await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, { timeoutMsg: "设置页返回按钮没有出现" });
  await browser.waitUntil(
    async () =>
      !(await $(sel(TID_SETTINGS_PAGE))
        .isDisplayed()
        .catch(() => false)),
    { timeout: 15000, timeoutMsg: "返回工作区失败" },
  );
}

async function createOffPeakTask() {
  await clickTestIdByDom(TID_AUTOMATIONS_OPEN, { timeoutMsg: "侧栏没有 Automations" });
  await clickTestIdByDom(TID_OFFPEAK_CREATE_BUTTON, { timeoutMsg: "Idle-time task creation button did not appear" });
  await setInputValueByTestIdDom(TID_OFFPEAK_FORM_TITLE, `E2E_OFFPEAK_TEAM_${Date.now()}`);
  await setInputValueByTestIdDom(
    TID_OFFPEAK_FORM_INSTRUCTIONS,
    "E2E Team idle-plan request: reply with a short completion marker.",
  );
  await clickTestIdByDom(TID_OFFPEAK_EDIT_SUBMIT, { timeoutMsg: "Idle-time task submit button is unavailable" });
}

async function waitForOffPeakRequest(): Promise<OffPeakRequestRecord[]> {
  const port = Number(process.env.CF_OFFPEAK_MOCK_PORT ?? "45197");
  let records: OffPeakRequestRecord[] = [];
  await browser.waitUntil(
    async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/__e2e/off-peak/requests`);
        if (!response.ok) return false;
        const body = (await response.json()) as { requests?: OffPeakRequestRecord[] };
        records = Array.isArray(body.requests) ? body.requests : [];
        return records.length > 0;
      } catch {
        return false;
      }
    },
    { timeout: 180000, interval: 1000, timeoutMsg: "Team 闲时任务没有发出 provider 请求" },
  );
  return records;
}

async function selectIdleTimeTab() {
  const tab = await browser.$(`[data-testid="${TID_OFFPEAK_TAB}"]`);
  for (const button of await tab.$$("button")) {
    if (/Idle-time task|闲时Task/u.test(await button.getText())) {
      await button.click();
      return;
    }
  }
  throw new Error("Off-peak task tab did not appear");
}

async function readCardTexts(): Promise<string[]> {
  return browser.execute(
    (cardTestId) =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-testid]"))
        .filter((element) => element.dataset.testid === cardTestId)
        .map((element) => element.textContent?.trim() ?? ""),
    TID_OFFPEAK_CARD,
  );
}
