import { ModelConfig, ProviderConfig } from "@origin-ai/cf-provider";
import { NodePersonalProviderConfigRepository } from "@origin-ai/cf-provider-node";
import { clearAppData, getE2EAppDataPaths } from "../helpers/desktop-app.js";
import {
  selectUpstreamProviderModelById,
  selectUpstreamThoughtLevelValue,
} from "../helpers/upstream-provider.js";
import {
  E2E_BIGMODEL_PLAN_PROVIDER_ID,
  E2E_PLAN_DEFAULT_MODEL,
  E2E_PLAN_TURBO_MODEL,
  restartIntoWorkspace,
  seedTurboAgentStartupModel,
  seedGlobalAgentReasoningLevel,
  seedBigModelOAuthCredential,
  seedBigModelConnectionSelection,
  seedPersistedModelSelection,
  waitForDraftThoughtLevelState,
  waitForSelectedModel,
  waitForV4DraftModelConfig,
} from "../helpers/model-provider-restart.js";
import { prepareV4ConversationE2E } from "../helpers/v4-conversation.js";

describe("模型 Provider Turbo 跨能力切换 E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  beforeEach(async () => {
    await prepareV4ConversationE2E({ skipProvider: true });
  });

  it("I38/MP-T04: Late workspace responses must not corrupt Turbo draft capabilities", async function () {
    this.timeout(180000);
    await prepareTurboDraft("disabled");
    await selectUpstreamThoughtLevelValue("enabled");
    await browser.pause(1500);
    await waitForSelectedModel(E2E_BIGMODEL_PLAN_PROVIDER_ID, E2E_PLAN_TURBO_MODEL);
    await waitForDraftThoughtLevelState({ current: "enabled", values: ["disabled", "enabled"] });
  });

  it("I39/MP-T05: Atomically update thinking capability when switching GLM-5.2 to Turbo", async function () {
    this.timeout(180000);
    await seedPersistedModelSelection({
      modelId: E2E_PLAN_DEFAULT_MODEL,
      providerId: E2E_BIGMODEL_PLAN_PROVIDER_ID,
      reasoningLevel: "high",
    });
    await restartWithTurboProviderFixture({ thoughtLevel: "high" });
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
    await waitForSelectedModel(E2E_BIGMODEL_PLAN_PROVIDER_ID, E2E_PLAN_TURBO_MODEL);
    await waitForV4DraftModelConfig({ model: E2E_PLAN_TURBO_MODEL, thought: "enabled" });
    await waitForDraftThoughtLevelState({ current: "enabled", values: ["disabled", "enabled"] });
  });

  it("I42/MP-T06: Discard source model thought when switching Turbo to GLM-5.2", async function () {
    this.timeout(180000);
    await seedPersistedModelSelection({
      modelId: E2E_PLAN_TURBO_MODEL,
      providerId: E2E_BIGMODEL_PLAN_PROVIDER_ID,
      reasoningLevel: "enabled",
    });
    await restartWithTurboProviderFixture({
      startupModel: E2E_PLAN_TURBO_MODEL,
      thoughtLevel: "enabled",
    });
    await selectUpstreamProviderModelById(E2E_PLAN_DEFAULT_MODEL, {
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
    await waitForSelectedModel(E2E_BIGMODEL_PLAN_PROVIDER_ID, E2E_PLAN_DEFAULT_MODEL);
    await waitForV4DraftModelConfig({ model: E2E_PLAN_DEFAULT_MODEL, thought: "max" });
    await waitForDraftThoughtLevelState({
      current: "max",
      values: ["disabled", "high", "max"],
    });
  });
});

async function prepareTurboDraft(thoughtLevel: "disabled" | "enabled") {
  await seedPersistedModelSelection({
    modelId: E2E_PLAN_TURBO_MODEL,
    providerId: E2E_BIGMODEL_PLAN_PROVIDER_ID,
    reasoningLevel: thoughtLevel,
  });
  await restartWithTurboProviderFixture({
    startupModel: E2E_PLAN_TURBO_MODEL,
    thoughtLevel,
  });
  await waitForSelectedModel(E2E_BIGMODEL_PLAN_PROVIDER_ID, E2E_PLAN_TURBO_MODEL);
  await waitForDraftThoughtLevelState({ current: thoughtLevel, values: ["disabled", "enabled"] });
}

async function restartWithTurboProviderFixture(options: {
  startupModel?: string;
  thoughtLevel: "disabled" | "enabled" | "high";
}) {
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
        const models = [E2E_PLAN_DEFAULT_MODEL, E2E_PLAN_TURBO_MODEL];
        await repository.update((current) => ({
          ...current,
          providers: current.providers.setRule({
            providerId: E2E_BIGMODEL_PLAN_PROVIDER_ID,
            config: (
              current.providers.get(E2E_BIGMODEL_PLAN_PROVIDER_ID) ?? new ProviderConfig()
            ).overlay(new ProviderConfig({ personalModelIds: models })),
          }),
          models: models.reduce(
            (rules, modelId) =>
              rules.setExact(
                E2E_BIGMODEL_PLAN_PROVIDER_ID,
                modelId,
                (
                  rules.getExact(E2E_BIGMODEL_PLAN_PROVIDER_ID, modelId) ?? new ModelConfig()
                ).overlay(new ModelConfig({ enabled: true })),
              ),
            current.models,
          ),
        }));
      } finally {
        repository.dispose();
      }
      if (options.startupModel) {
        await seedTurboAgentStartupModel(E2E_BIGMODEL_PLAN_PROVIDER_ID, options.startupModel);
      }
      await seedGlobalAgentReasoningLevel(options.thoughtLevel);
    },
  });
}
