import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TID_V4_COMPOSER_INPUT, TID_V4_COMPOSER_SEND } from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  setInputValueByTestIdDom,
  getE2EAppDataPaths,
  readSettings,
} from "../helpers/desktop-app.js";
import { restartIntoWorkspacePreservingProfile } from "../helpers/model-provider-restart-runtime.js";
import {
  assertUpstreamRequestCapture,
  waitForUpstreamNetworkCapture,
  waitForUpstreamNetworkRequestStarted,
} from "../helpers/upstream-capture.js";
import {
  UPSTREAM_MODEL,
  UPSTREAM_PROVIDER_ID,
  selectRegistryProviderModelById,
  selectUpstreamThoughtLevelValue,
} from "../helpers/upstream-provider.js";
import {
  E2E_BIGMODEL_PLAN_PROVIDER_ID,
  E2E_BIGMODEL_START_PROVIDER_ID,
  E2E_PLAN_NON_DEFAULT_MODEL,
  restartIntoWorkspace,
  seedBigModelOAuthCredential,
  seedBigModelConnectionSelection,
  seedPersistedModelSelection,
  seedReplayProvider,
  waitForSelectedModel,
} from "../helpers/model-provider-restart.js";
import {
  E2E_REPLY_TOKEN,
  getV4ModelConfig,
  prepareV4ConversationE2E,
  sendV4Prompt,
  switchV4Model,
  waitForV4ComposerSelectionReady,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

describe("Model Provider restart recovery E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  beforeEach(async () => {
    await prepareV4ConversationE2E({ skipProvider: true });
    await seedReplayProvider({
      id: UPSTREAM_PROVIDER_ID,
      models: [{ id: UPSTREAM_MODEL, reasoningLevel: { values: ["high", "max"], map: "{}" } }],
      name: "Upstream E2E",
    });
  });

  it("I25/MP-R01: 重启保留仍可用的 上游 last-selected", async function () {
    this.timeout(180000);
    await seedPersistedModelSelection({
      modelId: UPSTREAM_MODEL,
      providerId: UPSTREAM_PROVIDER_ID,
      reasoningLevel: "max",
    });
    await restartIntoWorkspace();
    await waitForSelectedModel(UPSTREAM_PROVIDER_ID, UPSTREAM_MODEL);
    await waitForRestartedDraftModelReady(UPSTREAM_PROVIDER_ID, UPSTREAM_MODEL);
    await assertRequestUsesModel("E2E_MODEL_PROVIDER_RESTART_R01", UPSTREAM_MODEL);
  });

  it("I26/MP-R02: Restart retains non-first model within current Plan", async function () {
    this.timeout(180000);
    await restartIntoWorkspace({
      afterElectronProcessExit: async () => {
        await seedBigModelConnectionSelection({
          kind: "team-coding-plan",
          productId: "product-team-a",
          organizationId: "org-team-a",
          projectId: "proj-team-a",
        });
        await seedBigModelOAuthCredential();
      },
    });
    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "E2E_MODEL_PROVIDER_RESTART_R02 draft");
    await waitForV4ComposerSelectionReady();
    await selectRegistryProviderModelById(E2E_PLAN_NON_DEFAULT_MODEL, {
      providerId: E2E_BIGMODEL_PLAN_PROVIDER_ID,
      providerGroupKey: JSON.stringify([
        "bigmodel",
        "team-coding-plan",
        "product-team-a",
        "org-team-a",
        "proj-team-a",
      ]),
      includePlainModelFallback: false,
    });
    await selectUpstreamThoughtLevelValue("max");
    await waitForSelectedModel(E2E_BIGMODEL_PLAN_PROVIDER_ID, E2E_PLAN_NON_DEFAULT_MODEL);
    await restartIntoWorkspacePreservingProfile(getE2EAppDataPaths().workspace);
    await waitForSelectedModel(E2E_BIGMODEL_PLAN_PROVIDER_ID, E2E_PLAN_NON_DEFAULT_MODEL);
    const settingsPath = join(getE2EAppDataPaths().appDataDir, "setting.json");
    for (const key of [
      "team-plan:builtin:bigmodel-coding-plan:product-team-a:org-team-a:proj-team-a",
      "team-plan:builtin:bigmodel-coding-plan:product-team-a:proj-team-a",
    ]) {
      const legacyKeys = { bigmodel: key };
      await restartIntoWorkspacePreservingProfile(getE2EAppDataPaths().workspace, {
        afterElectronProcessExit: async () => {
          const settings = JSON.parse(await readFile(settingsPath, "utf8"));
          delete settings.providerFamilyConnectionSelections;
          await writeFile(
            settingsPath,
            JSON.stringify({
              ...settings,
              modelProviderFamilyModes: { bigmodel: "oauth" },
              modelProviderFamilySelectedKeys: legacyKeys,
            }),
          );
        },
      });
      await waitForSelectedModel(E2E_BIGMODEL_PLAN_PROVIDER_ID, E2E_PLAN_NON_DEFAULT_MODEL);
      expect((await readSettings()).providerFamilyConnectionSelections?.bigmodel).toEqual({
        kind: "team-coding-plan",
        productId: "product-team-a",
        organizationId: "org-team-a",
        projectId: "proj-team-a",
      });
      expect(
        JSON.parse(await readFile(settingsPath, "utf8")).modelProviderFamilySelectedKeys,
      ).toEqual(legacyKeys);
    }
    await assertPlanRequest("E2E_MODEL_PROVIDER_RESTART_R02");
  });

  it("I27/MP-R03: Inactive previous selections of same Family remain blank and can send after manual selection", async function () {
    this.timeout(180000);
    await seedPersistedModelSelection({
      modelId: E2E_PLAN_NON_DEFAULT_MODEL,
      providerId: E2E_BIGMODEL_START_PROVIDER_ID,
      reasoningLevel: "max",
    });
    await restartWithTeamPlanSelection();
    await assertUnavailableSelectionRequiresUserChoice();
    await assertRequestUsesModel("E2E_MODEL_PROVIDER_RESTART_R03", UPSTREAM_MODEL);
  });

  it("I28/MP-R04: Unavailable last-selected remains blank and can send after manual selection", async function () {
    this.timeout(180000);
    await seedPersistedModelSelection({
      modelId: "upstream-removed-e2e",
      providerId: UPSTREAM_PROVIDER_ID,
      reasoningLevel: "max",
    });
    await restartWithTeamPlanSelection();
    await assertUnavailableSelectionRequiresUserChoice();
    await assertRequestUsesModel("E2E_MODEL_PROVIDER_RESTART_R04", UPSTREAM_MODEL);
  });
});

async function restartWithTeamPlanSelection() {
  await restartIntoWorkspace({
    afterElectronProcessExit: async () => {
      await seedBigModelConnectionSelection({
        kind: "team-coding-plan",
        productId: "product-team-a",
        organizationId: "org-team-a",
        projectId: "proj-team-a",
      });
      await seedBigModelOAuthCredential();
    },
  });
}

async function assertRequestUsesModel(marker: string, model: string) {
  const prompt = `${marker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
  await sendV4Prompt(prompt);
  await waitForUpstreamNetworkRequestStarted(marker);
  const capture = await waitForUpstreamNetworkCapture(marker);
  assertUpstreamRequestCapture(capture, { expectedText: prompt, model });
  await waitForV4TimelineContaining(E2E_REPLY_TOKEN);
  await waitForV4Pane((snapshot) => !snapshot.canStop, `${marker} 没有Completed`, 90000);
}

async function waitForRestartedDraftModelReady(provider: string, model: string) {
  await waitForV4ComposerSelectionReady();
  let latest = await getV4ModelConfig();
  let stableSince = 0;
  await browser.waitUntil(
    async () => {
      latest = await getV4ModelConfig();
      const matched =
        latest.source === "composer" && latest.provider === provider && latest.model === model;
      if (!matched) {
        stableSince = 0;
        return false;
      }
      stableSince ||= Date.now();
      return Date.now() - stableSince >= 300;
    },
    {
      timeout: 30000,
      timeoutMsg: `重启后的 draft provider/runtime 没有稳定就绪: ${JSON.stringify({
        expected: { model, provider },
        latest,
      })}`,
    },
  );
}

async function assertPlanRequest(marker: string) {
  const prompt = `${marker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
  await sendV4Prompt(prompt);
  await waitForV4TimelineContaining(E2E_REPLY_TOKEN);
  await waitForV4Pane((snapshot) => !snapshot.canStop, `${marker} 没有Completed`, 90000);
}

async function assertUnavailableSelectionRequiresUserChoice() {
  await browser.waitUntil(async () => !(await getV4ModelConfig()).model, {
    timeout: 30_000,
    timeoutMsg: "Inactive models should not automatically fall back to default model",
  });
  await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "E2E_INVALID_SELECTION_NOT_SENT");
  expect(await $(`[data-testid="${TID_V4_COMPOSER_SEND}"]`).isEnabled()).toBe(false);
  await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "");
  await switchV4Model(UPSTREAM_PROVIDER_ID, UPSTREAM_MODEL, "max");
  await waitForRestartedDraftModelReady(UPSTREAM_PROVIDER_ID, UPSTREAM_MODEL);
}
