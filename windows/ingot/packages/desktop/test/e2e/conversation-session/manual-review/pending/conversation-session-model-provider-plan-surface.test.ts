import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { encodeCustomModelValue } from "@origin-ai/cf-shared";
import {
  TID_AUTOMATION_CREATE_MANUALLY,
  TID_AUTOMATION_CREATE_MENU,
  TID_AUTOMATION_CARD,
  TID_AUTOMATION_FORM_PROMPT,
  TID_AUTOMATION_FORM_SUBMIT,
  TID_AUTOMATION_FORM_TITLE,
  TID_AUTOMATIONS_LIST,
  TID_AUTOMATIONS_OPEN,
  TID_AUTOMATION_SCHEDULE_ADD,
  TID_CHAT_MODEL_SELECT_GROUP,
  TID_CHAT_MODEL_SELECT_ITEM,
  TID_CHAT_MODEL_SELECT_TRIGGER,
  TID_AUTOMATION_FREQUENCY_OPTION,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  clickTestIdByWebDriver,
  getE2EAppDataPaths,
  setInputValueByTestIdDom,
  waitForTestIdByDom,
} from "../../../helpers/desktop-app.js";
import {
  E2E_BIGMODEL_PLAN_PROVIDER_ID,
  E2E_BIGMODEL_START_PROVIDER_ID,
  E2E_PLAN_DEFAULT_MODEL,
  E2E_PLAN_NON_DEFAULT_MODEL,
  restartIntoWorkspace,
  restartIntoWorkspacePreservingProfile,
  seedBigModelOAuthCredential,
  seedBigModelConnectionSelection,
  seedBigModelStartPlanCredential,
  seedPersistedModelSelection,
  seedReplayProvider,
  waitForSelectedModel,
} from "../../../helpers/model-provider-restart.js";
import { prepareConversationE2E, startNewTask } from "../../../helpers/conversation-session.js";
import { sel } from "../../../helpers/selectors.js";

const PLAN_PROVIDER_ID = E2E_BIGMODEL_PLAN_PROVIDER_ID;
const PLAN_MODEL = "GLM-5.2";
const START_PROVIDER_ID = E2E_BIGMODEL_START_PROVIDER_ID;
const START_MODEL = "GLM-5.2";
const PLAN_MODEL_VALUE = encodeCustomModelValue(PLAN_PROVIDER_ID, PLAN_MODEL);
const START_MODEL_VALUE = encodeCustomModelValue(START_PROVIDER_ID, START_MODEL);

describe("Automation Model Identity Preservation Between Start/Coding Plan E2E", () => {
  afterEach(async () => {
    await setCatalogMode("full").catch(() => undefined);
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("F-AUTOMATION-004/F-AUTOMATION-005/F-AUTOMATION-006/F-PLAN-004/F-PLAN-008: Two plans are saved separately; task records do not drift with default values", async function () {
    this.timeout(180000);

    await prepareConversationE2E({ skipProvider: true });
    await seedBigModelOAuthCredential();
    await seedBigModelStartPlanCredential();
    await seedBigModelConnectionSelection({
      kind: "team-coding-plan",
      productId: "product-team-a",
      organizationId: "org-team-a",
      projectId: "proj-team-a",
    });
    await seedReplayProvider({
      id: PLAN_PROVIDER_ID,
      models: [PLAN_MODEL],
      name: "BigModel Coding Plan E2E",
    });
    await seedReplayProvider({
      id: START_PROVIDER_ID,
      models: [START_MODEL],
      name: "BigModel Start Plan E2E",
    });
    await restartIntoWorkspace();
    await prepareConversationE2E();

    const codingTitle = `E2E_AUTOMATION_CODING_PLAN_${Date.now()}`;
    await createAutomation(codingTitle, "固定 Coding Plan 模型", PLAN_MODEL_VALUE);
    const codingRecord = await waitForAutomationModel(codingTitle);
    expect(codingRecord).toEqual({
      providerId: PLAN_PROVIDER_ID,
      modelId: PLAN_MODEL,
    });
    await editAutomationPrompt(codingTitle, "Modify prompt only, not model");
    expect(await readAutomationModel(codingTitle)).toEqual({
      providerId: PLAN_PROVIDER_ID,
      modelId: PLAN_MODEL,
    });

    const startTitle = `E2E_AUTOMATION_START_PLAN_${Date.now()}`;
    await createAutomation(startTitle, "固定 Start Plan 模型", START_MODEL_VALUE);
    const startRecord = await waitForAutomationModel(startTitle);
    expect(startRecord).toEqual({
      providerId: START_PROVIDER_ID,
      modelId: START_MODEL,
    });

    expect(await readAutomationModel(codingTitle)).toEqual({
      providerId: PLAN_PROVIDER_ID,
      modelId: PLAN_MODEL,
    });

    await startNewTask();
    await selectAutomationModel(START_MODEL_VALUE);
    expect(
      await $(sel(TID_CHAT_MODEL_SELECT_TRIGGER)).getAttribute("data-model-current-value"),
    ).toBe(START_MODEL_VALUE);
    await selectAutomationModel(PLAN_MODEL_VALUE);
    expect(
      await $(sel(TID_CHAT_MODEL_SELECT_TRIGGER)).getAttribute("data-model-current-value"),
    ).toBe(PLAN_MODEL_VALUE);
    expect(await readAutomationModel(startTitle)).toEqual({
      providerId: START_PROVIDER_ID,
      modelId: START_MODEL,
    });
  });

  it("F-PLAN-005: Preserve current selection when plan catalog is temporarily unavailable, and resume use after recovery", async function () {
    this.timeout(220000);
    await prepareBigModelCatalogWorkspace(E2E_PLAN_DEFAULT_MODEL);
    await setCatalogMode("unavailable");
    await restartIntoWorkspacePreservingProfile();
    await prepareConversationE2E({ skipProvider: true });
    await waitForSelectedModel(E2E_BIGMODEL_PLAN_PROVIDER_ID, PLAN_MODEL);

    await setCatalogMode("full");
    await restartIntoWorkspacePreservingProfile();
    await prepareConversationE2E({ skipProvider: true });
    await waitForSelectedModel(E2E_BIGMODEL_PLAN_PROVIDER_ID, PLAN_MODEL);
  });

  it("F-PLAN-006: 服务端只返回部分目录时不覆盖已有模型事实", async function () {
    this.timeout(220000);
    await prepareBigModelCatalogWorkspace(E2E_PLAN_NON_DEFAULT_MODEL);
    await waitForSelectedModel(E2E_BIGMODEL_PLAN_PROVIDER_ID, E2E_PLAN_NON_DEFAULT_MODEL);
    await setCatalogMode("partial");
    await restartIntoWorkspacePreservingProfile();
    await prepareConversationE2E({ skipProvider: true });
    await waitForSelectedModel(E2E_BIGMODEL_PLAN_PROVIDER_ID, E2E_PLAN_NON_DEFAULT_MODEL);
  });
});

async function prepareBigModelCatalogWorkspace(model: string): Promise<void> {
  await prepareConversationE2E({ skipProvider: true });
  await seedBigModelOAuthCredential();
  await seedBigModelConnectionSelection({
    kind: "team-coding-plan",
    productId: "product-team-a",
    organizationId: "org-team-a",
    projectId: "proj-team-a",
  });
  await seedReplayProvider({
    id: E2E_BIGMODEL_PLAN_PROVIDER_ID,
    models: [PLAN_MODEL, E2E_PLAN_NON_DEFAULT_MODEL],
    name: "BigModel Coding Plan E2E",
  });
  await seedPersistedModelSelection({
    modelId: model,
    providerId: E2E_BIGMODEL_PLAN_PROVIDER_ID,
    reasoningLevel: "max",
  });
  await setCatalogMode("full");
  await restartIntoWorkspace();
  await prepareConversationE2E({ skipProvider: true });
  await selectAutomationModel(encodeCustomModelValue(E2E_BIGMODEL_PLAN_PROVIDER_ID, model));
  await seedPersistedModelSelection({
    modelId: model,
    providerId: E2E_BIGMODEL_PLAN_PROVIDER_ID,
    reasoningLevel: "max",
  });
}

async function setCatalogMode(mode: "full" | "partial" | "unavailable"): Promise<void> {
  const baseUrl = process.env.CF_CODING_PLAN_TEAM_MOCK_BASE_URL?.trim();
  if (!baseUrl) throw new Error("Coding Plan mock URL is not configured; cannot toggle model catalog state");
  const response = await fetch(`${baseUrl}/__e2e/coding-plan/catalog-mode`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!response.ok) throw new Error(`ModelTable of ContentsStatus切换Failed：${response.status}`);
}

async function createAutomation(title: string, prompt: string, modelValue: string): Promise<void> {
  await clickTestIdByDom(TID_AUTOMATIONS_OPEN, { timeout: 15000 });
  await clickTestIdByWebDriver(TID_AUTOMATION_CREATE_MENU, { timeout: 15000 });
  await clickTestIdByDom(TID_AUTOMATION_CREATE_MANUALLY, { timeout: 15000 });
  await setInputValueByTestIdDom(TID_AUTOMATION_FORM_TITLE, title);
  await setInputValueByTestIdDom(TID_AUTOMATION_FORM_PROMPT, prompt);
  await clickTestIdByWebDriver(TID_AUTOMATION_SCHEDULE_ADD, { timeout: 15000 });
  await clickTestIdByDom(testId(TID_AUTOMATION_FREQUENCY_OPTION, "daily"), {
    timeout: 15000,
  });
  await selectAutomationModel(modelValue);
  await clickTestIdByDom(TID_AUTOMATION_FORM_SUBMIT, { timeout: 15000 });
  await waitForTestIdByDom(TID_AUTOMATIONS_LIST, {
    timeout: 30000,
    timeoutMsg: `Automation ${title} Save后没有回到list`,
  });
}

async function selectAutomationModel(modelValue: string): Promise<void> {
  const decoded = decodeModelValue(modelValue);
  const trigger = $(sel(TID_CHAT_MODEL_SELECT_TRIGGER));
  await trigger.waitForClickable({ timeout: 15000 });
  if ((await trigger.getAttribute("data-model-current-value")) === modelValue) {
    return;
  }
  await clickTestIdByWebDriver(TID_CHAT_MODEL_SELECT_TRIGGER, {
    timeout: 15000,
    timeoutMsg: "Automation form has no model selector",
  });
  const itemTestId = testId(TID_CHAT_MODEL_SELECT_ITEM, modelValue);
  const groupTestId = testId(
    TID_CHAT_MODEL_SELECT_GROUP,
    `registry-provider:${decoded.providerId}`,
  );
  await browser.waitUntil(
    async () =>
      browser.execute(
        (itemId, groupId) =>
          Boolean(
            document.querySelector(`[data-testid="${itemId}"]`) ||
            document.querySelector(`[data-testid="${groupId}"]`),
          ),
        itemTestId,
        groupTestId,
      ),
    { timeout: 30000, timeoutMsg: `Automation Model菜单没有出现 ${modelValue}` },
  );
  if (!(await $(sel(itemTestId)).isExisting())) {
    await $(sel(groupTestId)).click();
    await $(sel(itemTestId)).waitForDisplayed({ timeout: 15000 });
  }
  await $(sel(itemTestId)).click();
  await browser.waitUntil(
    async () =>
      (await $(sel(TID_CHAT_MODEL_SELECT_TRIGGER)).getAttribute("data-model-current-value")) ===
      modelValue,
    { timeout: 15000, timeoutMsg: `Automation Model没有切换到 ${modelValue}` },
  );
}

function decodeModelValue(value: string): { providerId: string } {
  const encoded = value.slice("custom:".length);
  const separator = encoded.indexOf(":");
  return { providerId: decodeURIComponent(separator < 0 ? encoded : encoded.slice(0, separator)) };
}

async function editAutomationPrompt(title: string, prompt: string): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (cardTestId, expectedTitle) => {
          const card = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
            (element) =>
              element.dataset.testid === cardTestId && element.textContent?.includes(expectedTitle),
          );
          if (!card) return false;
          card.click();
          return true;
        },
        TID_AUTOMATION_CARD,
        title,
      ),
    { timeout: 30000, timeoutMsg: `没有打开 Automation Details：${title}` },
  );
  await waitForTestIdByDom(TID_AUTOMATION_FORM_PROMPT, {
    timeout: 15000,
    timeoutMsg: "Automation details has no prompt input box",
  });
  await setInputValueByTestIdDom(TID_AUTOMATION_FORM_PROMPT, prompt);
  await clickTestIdByDom(TID_AUTOMATION_FORM_SUBMIT, { timeout: 15000 });
  await waitForTestIdByDom(TID_AUTOMATIONS_LIST, {
    timeout: 30000,
    timeoutMsg: "Automation 编辑后没有回到列表",
  });
}

async function waitForAutomationModel(title: string) {
  await browser.waitUntil(async () => (await readAutomationModel(title)) !== null, {
    timeout: 15000,
    timeoutMsg: `没有在Task索引Medium找到 ${title} 的Model Configuration`,
  });
  const model = await readAutomationModel(title);
  if (!model) throw new Error(`Task索引Medium的Model Configuration为空：${title}`);
  return model;
}

async function readAutomationModel(title: string) {
  const database = new DatabaseSync(join(getE2EAppDataPaths().appDataDir, "tasks-index.sqlite"), {
    readOnly: true,
  });
  try {
    const row = database
      .prepare("SELECT model_selection FROM automations WHERE title = ?")
      .get(title) as { model_selection: string | null } | undefined;
    if (!row?.model_selection) return null;
    const selection = JSON.parse(row.model_selection) as {
      modelId?: string;
      providerId?: string;
    };
    return selection.providerId && selection.modelId
      ? { modelId: selection.modelId, providerId: selection.providerId }
      : null;
  } finally {
    database.close();
  }
}
