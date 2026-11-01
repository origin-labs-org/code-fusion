import { skipOccupationOnboardingIfPresent } from "../helpers/occupation-onboarding.js";
import { ModelConfig, ProviderConfig } from "@origin-ai/cf-provider";
import { NodePersonalProviderConfigRepository } from "@origin-ai/cf-provider-node";
import { clearAppData, getE2EAppDataPaths } from "../helpers/desktop-app.js";
import { refreshSeededOpenAIProvidersThroughSettings } from "../helpers/custom-openai-provider.js";
import {
  UPSTREAM_MODEL,
  UPSTREAM_SECONDARY_MODEL,
  UPSTREAM_PROVIDER_ID,
  selectUpstreamProviderModelById,
  selectUpstreamThoughtLevelValue,
} from "../helpers/upstream-provider.js";
import {
  E2E_BIGMODEL_PLAN_PROVIDER_ID,
  E2E_PLAN_TURBO_MODEL,
  restartIntoWorkspace,
  restartIntoWorkspacePreservingProfile,
  seedTurboAgentStartupModel,
  seedBigModelOAuthCredential,
  seedBigModelConnectionSelection,
  seedGlobalAgentReasoningLevel,
  seedPersistedModelSelection,
  waitForDraftThoughtLevelState,
  waitForLastSelectedAgentConfig,
  waitForPlanModelIoRequest,
  waitForSelectedModel,
} from "../helpers/model-provider-restart.js";
import {
  E2E_REPLY_TOKEN,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

describe("模型 Provider Turbo 重启恢复 E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  before(async () => {
    await skipOccupationOnboardingIfPresent();
  });

  beforeEach(async () => {
    await prepareV4ConversationE2E({ skipProvider: true });
  });

  for (const binary of [false, true]) {
    it(`${binary ? "binary" : "sole enabled"} effort status presentation`, async function () {
      this.timeout(180000);
      await seedPersistedModelSelection({
        providerId: UPSTREAM_PROVIDER_ID,
        modelId: UPSTREAM_MODEL,
        reasoningLevel: "enabled",
      });
      await restartIntoWorkspace({
        afterElectronProcessExit: async () => {
          const repository = new NodePersonalProviderConfigRepository({
            filePath: getE2EAppDataPaths().configFile,
            pollingIntervalMs: false,
          });
          try {
            await repository.update((current) => ({
              ...current,
              models: current.models.setExact(
                UPSTREAM_PROVIDER_ID,
                UPSTREAM_MODEL,
                ModelConfig.fromData({
                  enabled: true,
                  optionSpecs: {
                    reasoningLevel: { values: binary ? ["disabled", "enabled"] : ["enabled"] },
                  },
                }),
              ),
            }));
          } finally {
            repository.dispose();
          }
          await seedGlobalAgentReasoningLevel("enabled");
        },
      });
      await selectUpstreamProviderModelById(UPSTREAM_SECONDARY_MODEL);
      await selectUpstreamProviderModelById(UPSTREAM_MODEL);
      await waitForSelectedModel(UPSTREAM_PROVIDER_ID, UPSTREAM_MODEL);
      const trigger = $('[data-testid="chat-model-select-trigger"]');
      await trigger.click();
      if (binary) {
        const slider = $('[data-testid="composer-thought-slider"]');
        await slider.waitForDisplayed();
        expect(await slider.getAttribute("max")).toBe("1");
        await slider.click();
        await browser.keys("Home");
        await browser.waitUntil(async () => (await slider.getValue()) === "0");
        expect(await slider.getAttribute("aria-valuetext")).toMatch(/Off|Close/);
        await browser.keys("End");
        await browser.waitUntil(async () => (await slider.getValue()) === "1");
        expect(await slider.getAttribute("aria-valuetext")).toMatch(/On|开启/);
      } else {
        await $('[data-testid="composer-thought-value"]').waitForDisplayed();
        expect(await $('[data-testid="composer-thought-value"]').getText()).toMatch(/On|开启/);
        expect(await $('[data-testid="composer-thought-slider"]').isExisting()).toBe(false);
        expect(await $('[data-testid="composer-effort-shortcut"]').isExisting()).toBe(false);
      }
      expect(await $('[data-testid="composer-thought-switch"]').isExisting()).toBe(false);
      await browser.keys("Escape");
      await browser.waitUntil(
        async () => (await trigger.getAttribute("aria-expanded")) === "false",
      );
      await waitForSelectedModel(UPSTREAM_PROVIDER_ID, UPSTREAM_MODEL);
    });
  }

  it("I35/MP-T01: Maintain dual-state thinking capability after restarting with Turbo off", async function () {
    this.timeout(180000);
    await restartWithTurboProviderFixture();
    await selectTurboBeforeRestart("disabled");
    await restartIntoWorkspacePreservingProfile();
    await waitForSelectedModel(E2E_BIGMODEL_PLAN_PROVIDER_ID, E2E_PLAN_TURBO_MODEL);
    await waitForDraftThoughtLevelState({ current: "disabled", values: ["disabled", "enabled"] });
  });

  it("I36/MP-T02: Maintain model and thinking level on first send after restarting with Turbo enabled", async function () {
    this.timeout(180000);
    await restartWithTurboProviderFixture();
    await selectTurboBeforeRestart("enabled");
    await restartIntoWorkspacePreservingProfile();
    await waitForSelectedModel(E2E_BIGMODEL_PLAN_PROVIDER_ID, E2E_PLAN_TURBO_MODEL);
    await waitForDraftThoughtLevelState({ current: "enabled", values: ["disabled", "enabled"] });
    const marker = "E2E_MODEL_PROVIDER_RESTART_T02";
    const prompt = `${marker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendV4Prompt(prompt);
    await waitForV4TimelineContaining(E2E_REPLY_TOKEN);
    const request = await waitForPlanModelIoRequest(marker);
    expect(request?.model).toBe(E2E_PLAN_TURBO_MODEL);
    expect(request?.thinking?.type).toBe("enabled");
  });

  it("I37/MP-T03: Model remains stable during continuous toggling of Turbo dual-state", async function () {
    this.timeout(180000);
    await prepareTurboDraft("disabled");
    for (const thoughtLevel of ["enabled", "disabled"] as const) {
      const trigger = $('[data-testid="chat-model-select-trigger"]');
      await trigger.click();
      const slider = $('[data-testid="composer-thought-slider"]');
      await slider.waitForDisplayed();
      expect(await $('[data-testid="composer-thought-switch"]').isExisting()).toBe(false);
      expect(await $('[data-testid="composer-thought-endpoints"]').isExisting()).toBe(false);
      await slider.click();
      await browser.keys(thoughtLevel === "enabled" ? "End" : "Home");
      await browser.waitUntil(
        async () => (await slider.getValue()) === (thoughtLevel === "enabled" ? "1" : "0"),
      );
      expect(await trigger.getAttribute("aria-expanded")).toBe("true");
      await waitForSelectedModel(E2E_BIGMODEL_PLAN_PROVIDER_ID, E2E_PLAN_TURBO_MODEL);
      await waitForDraftThoughtLevelState({
        current: thoughtLevel,
        values: ["disabled", "enabled"],
      });
      await browser.performActions([
        {
          type: "pointer",
          id: "effort-outside",
          parameters: { pointerType: "mouse" },
          actions: [
            { type: "pointerMove", duration: 0, x: 4, y: 100 },
            { type: "pointerDown", button: 0 },
            { type: "pointerUp", button: 0 },
          ],
        },
      ]);
      await browser.releaseActions();
      await browser.waitUntil(
        async () => (await trigger.getAttribute("aria-expanded")) === "false",
      );
    }
  });
});

async function prepareTurboDraft(thoughtLevel: "disabled" | "enabled") {
  await restartWithTurboProviderFixture();
  await selectTurboDraft(thoughtLevel);
}

async function restartWithTurboProviderFixture() {
  await restartIntoWorkspace({
    afterElectronProcessExit: async () => {
      await seedBigModelConnectionSelection({
        kind: "team-coding-plan",
        productId: "product-team-a",
        organizationId: "org-team-a",
        projectId: "proj-team-a",
      });
      await seedBigModelOAuthCredential();
      const repository = new NodePersonalProviderConfigRepository({
        filePath: getE2EAppDataPaths().configFile,
        pollingIntervalMs: false,
      });
      try {
        await repository.update((current) => ({
          ...current,
          providers: current.providers.setRule({
            providerId: E2E_BIGMODEL_PLAN_PROVIDER_ID,
            config: (
              current.providers.get(E2E_BIGMODEL_PLAN_PROVIDER_ID) ?? new ProviderConfig()
            ).overlay(new ProviderConfig({ personalModelIds: [E2E_PLAN_TURBO_MODEL] })),
          }),
          models: current.models.setExact(
            E2E_BIGMODEL_PLAN_PROVIDER_ID,
            E2E_PLAN_TURBO_MODEL,
            (
              current.models.getExact(E2E_BIGMODEL_PLAN_PROVIDER_ID, E2E_PLAN_TURBO_MODEL) ??
              new ModelConfig()
            ).overlay(new ModelConfig({ enabled: true })),
          ),
        }));
      } finally {
        repository.dispose();
      }
    },
  });
}

async function selectTurboBeforeRestart(thoughtLevel: "disabled" | "enabled") {
  await selectTurboDraft(thoughtLevel);
  await seedPersistedModelSelection({
    modelId: E2E_PLAN_TURBO_MODEL,
    providerId: E2E_BIGMODEL_PLAN_PROVIDER_ID,
    reasoningLevel: thoughtLevel,
  });
  await waitForLastSelectedAgentConfig({
    model: E2E_PLAN_TURBO_MODEL,
    thoughtLevel,
  });
  await seedGlobalAgentReasoningLevel(thoughtLevel);
  await seedTurboAgentStartupModel(E2E_BIGMODEL_PLAN_PROVIDER_ID, E2E_PLAN_TURBO_MODEL);
}

async function selectTurboDraft(thoughtLevel: "disabled" | "enabled") {
  await refreshSeededOpenAIProvidersThroughSettings([]);
  await selectUpstreamProviderModelById(E2E_PLAN_TURBO_MODEL, {
    providerId: E2E_BIGMODEL_PLAN_PROVIDER_ID,
    providerName: "BigModel Coding Plan E2E",
    providerGroupKey: JSON.stringify([
      "bigmodel",
      "team-coding-plan",
      "product-team-a",
      "org-team-a",
      "proj-team-a",
    ]),
    includePlainModelFallback: false,
  });
  await selectUpstreamThoughtLevelValue(thoughtLevel === "enabled" ? "disabled" : "enabled");
  await selectUpstreamThoughtLevelValue(thoughtLevel);
  await waitForSelectedModel(E2E_BIGMODEL_PLAN_PROVIDER_ID, E2E_PLAN_TURBO_MODEL);
  await waitForDraftThoughtLevelState({
    current: thoughtLevel,
    values: ["disabled", "enabled"],
  });
}
