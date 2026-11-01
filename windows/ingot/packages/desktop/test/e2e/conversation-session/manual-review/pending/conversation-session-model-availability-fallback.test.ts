import {
  TID_MODEL_PROVIDER_NAV_ITEM,
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  clickTestIdByDom,
  waitForWorkspaceApp,
} from "../../../helpers/desktop-app.js";
import {
  assertUpstreamRequestCapture,
  waitForUpstreamNetworkCapture,
} from "../../../helpers/upstream-capture.js";
import {
  UPSTREAM_ALTERNATE_MODEL,
  UPSTREAM_ALTERNATE_PROVIDER_ID,
  UPSTREAM_MODEL,
  UPSTREAM_PROVIDER_ID,
} from "../../../helpers/upstream-provider.js";
import {
  readLastSelectedAgentConfig,
  restartIntoWorkspace,
  seedPersistedModelSelection,
  seedReplayProvider,
  waitForSelectedModel,
} from "../../../helpers/model-provider-restart.js";
import { sel } from "../../../helpers/selectors.js";
import {
  E2E_REPLY_TOKEN,
  prepareV4ConversationE2E,
  sendV4Prompt,
  startNewV4Draft,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

describe("Model Availability Agent Fallback E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("I56/MAF-01: Idle session atomically switches to an available model after current provider is disabled", async function () {
    this.timeout(180000);
    await prepareV4ConversationE2E({ skipProvider: true });
    await seedReplayProvider({
      id: UPSTREAM_PROVIDER_ID,
      models: [UPSTREAM_MODEL],
      name: "Upstream Fallback Source",
    });
    await seedReplayProvider({
      id: UPSTREAM_ALTERNATE_PROVIDER_ID,
      models: [UPSTREAM_ALTERNATE_MODEL],
      name: "Upstream Fallback Target",
    });
    await seedPersistedModelSelection({
      modelId: UPSTREAM_MODEL,
      providerId: UPSTREAM_PROVIDER_ID,
      reasoningLevel: "max",
    });
    await restartIntoWorkspace();
    await waitForSelectedModel(UPSTREAM_PROVIDER_ID, UPSTREAM_MODEL);

    const seedMarker = `E2E_MODEL_FALLBACK_SEED_${Date.now()}`;
    await sendV4Prompt(`${seedMarker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`);
    await waitForV4TimelineContaining(E2E_REPLY_TOKEN);

    await disableProvider(UPSTREAM_PROVIDER_ID);
    await waitForSelectedModel(UPSTREAM_ALTERNATE_PROVIDER_ID, UPSTREAM_ALTERNATE_MODEL);

    const remembered = await waitForRememberedModel(UPSTREAM_ALTERNATE_MODEL);
    expect(remembered?.model).toContain(UPSTREAM_ALTERNATE_MODEL);
    expect(remembered?.model).not.toContain(UPSTREAM_MODEL);

    const marker = `E2E_MODEL_FALLBACK_TARGET_${Date.now()}`;
    const prompt = `${marker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendV4Prompt(prompt);
    const capture = await waitForUpstreamNetworkCapture(marker);
    assertUpstreamRequestCapture(capture, {
      expectedText: prompt,
      model: UPSTREAM_ALTERNATE_MODEL,
    });
    await waitForV4TimelineContaining(E2E_REPLY_TOKEN);
  });

  it("I61/MAF-02: Prewarm fallback promotes actual tuple and next draft inherits directly", async function () {
    this.timeout(180000);
    await prepareV4ConversationE2E({ skipProvider: true });
    await seedReplayProvider({
      id: UPSTREAM_PROVIDER_ID,
      models: [UPSTREAM_MODEL],
      name: "Upstream Draft Fallback Source",
    });
    await seedReplayProvider({
      id: UPSTREAM_ALTERNATE_PROVIDER_ID,
      models: [UPSTREAM_ALTERNATE_MODEL],
      name: "Upstream Draft Fallback Target",
    });
    await seedPersistedModelSelection({
      modelId: UPSTREAM_MODEL,
      providerId: UPSTREAM_PROVIDER_ID,
      reasoningLevel: "max",
    });
    await restartIntoWorkspace();
    await waitForSelectedModel(UPSTREAM_PROVIDER_ID, UPSTREAM_MODEL);

    await disableProvider(UPSTREAM_PROVIDER_ID);
    await waitForSelectedModel(UPSTREAM_ALTERNATE_PROVIDER_ID, UPSTREAM_ALTERNATE_MODEL);
    const remembered = await waitForRememberedModel(UPSTREAM_ALTERNATE_MODEL);
    expect(remembered?.model).toContain(UPSTREAM_ALTERNATE_MODEL);
    expect(remembered?.model).not.toContain(UPSTREAM_MODEL);

    const marker = `E2E_MODEL_FALLBACK_DRAFT_TARGET_${Date.now()}`;
    const prompt = `${marker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendV4Prompt(prompt);
    const capture = await waitForUpstreamNetworkCapture(marker);
    assertUpstreamRequestCapture(capture, {
      expectedText: prompt,
      model: UPSTREAM_ALTERNATE_MODEL,
    });
    await waitForV4TimelineContaining(E2E_REPLY_TOKEN);

    await startNewV4Draft();
    await waitForSelectedModel(UPSTREAM_ALTERNATE_PROVIDER_ID, UPSTREAM_ALTERNATE_MODEL);
  });
});

async function disableProvider(providerId: string) {
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, { timeout: 15000 });
  await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout: 15000 });
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "modelProvider"), {
    timeout: 15000,
  });
  await clickTestIdByDom(testId(TID_MODEL_PROVIDER_NAV_ITEM, `custom:${providerId}`), {
    timeout: 30000,
    timeoutMsg: `Model Provider导航没有出现 ${providerId}`,
  });
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
          (candidate) => ["停用", "Disable"].includes(candidate.innerText.trim()),
        );
        if (!button || button.disabled) return false;
        button.click();
        return true;
      }),
    { timeout: 15000, timeoutMsg: `Model Provider没有可点击的Disable按钮 ${providerId}` },
  );
  await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, { timeout: 15000 });
  await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30000);
}

async function waitForRememberedModel(modelId: string) {
  await browser.waitUntil(
    async () => {
      const latest = await readLastSelectedAgentConfig();
      return Boolean(latest?.model.includes(modelId));
    },
    {
      timeout: 30000,
      timeoutMsg: `Auto fallback 没有把实际Model ${modelId} 晋升为 last-selected`,
    },
  );
  const resolved = await readLastSelectedAgentConfig();
  if (!resolved) {
    throw new Error(`last-selected 在Waiting ${modelId} 后意outer消失`);
  }
  return resolved;
}
