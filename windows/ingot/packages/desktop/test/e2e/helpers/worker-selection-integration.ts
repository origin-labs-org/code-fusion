import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  MutableAccountProviderConfigSource,
  ProviderConfig,
  ProviderConfigMap,
  ZhipuAccountAccessConfig,
  createAccountProviderConfigSnapshot,
  createFailClosedAccountProviderConfigSnapshot,
  type ModelSelectionViewInput,
} from "@origin-ai/cf-provider";
import { NodeProviderRegistryRuntime, createNodeModelSelectionFacade } from "@origin-ai/cf-provider-node";
import {
  createCfAgentService,
  createCfTaskServiceAdapter,
  getDataBaseDir,
  setDataBaseDir,
} from "@origin-ai/cf-services/node";
import { BUILTIN_MODEL_PROVIDER_IDS } from "@origin-ai/cf-shared";
import { TaskIndexRepo } from "../../../../services/src/session/taskIndexRepo.js";
import { createCfTaskIndexSyncer } from "../../../../services/src/cf-agent/cfTaskIndexSyncer.js";
import { getE2EAppDataPaths } from "./desktop-app.js";

export async function createWorkerSelectionIntegration() {
  const paths = getE2EAppDataPaths();
  const home = join(paths.homeDir, "worker-selection-host");
  const workspacePath = join(home, "workspace");
  await mkdir(workspacePath, { recursive: true });
  const previousDataDir = getDataBaseDir();
  setDataBaseDir(home);
  const source = new MutableAccountProviderConfigSource();
  const deliverySource = new MutableAccountProviderConfigSource();
  let deliveryPaused = false;
  const runtimePaths = {
    cfBuiltinFilePath: resolve("../../config/provider/cf-builtin.json"),
    personalFilePath: join(home, ".cf/v2/provider_config.json"),
  };
  const runtime = new NodeProviderRegistryRuntime({
    ...runtimePaths,
    accountSource: source,
    watch: false,
    personalPollingIntervalMs: false,
  });
  await runtime.start();
  const config = await runtime.configService.read();
  const individual = BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan;
  const team = BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan;
  const modelId = "GLM-5.3-Flash";
  async function selectAccount(providerId: string) {
    const base = createFailClosedAccountProviderConfigSnapshot(config);
    const providers = new Map(base.providers.entries());
    for (const id of [individual, team]) {
      providers.set(
        id,
        new ProviderConfig({
          access: new ZhipuAccountAccessConfig({ entitled: true }),
          builtinModelIds: [modelId],
        }),
      );
    }
    source.replace(
      createAccountProviderConfigSnapshot(
        config.cfBuiltinRevision,
        new ProviderConfigMap([...providers]),
        Object.fromEntries(
          [individual, team].map((id) => [
            id,
            {
              availability: "available" as const,
              entitled: true,
              current: id === providerId,
            },
          ]),
        ),
      ),
    );
    await runtime.registryService.refresh("test-account-change");
    if (!deliveryPaused) deliverySource.replace(await source.read());
  }
  await selectAccount(individual);
  const facade = createNodeModelSelectionFacade(runtime.registryService);
  const modelSelectionService = {
    getView: async (input?: ModelSelectionViewInput) => facade.getView(undefined, undefined, input),
    onDidChange: (listener: Parameters<typeof facade.onDidChange>[0]) => ({
      dispose: facade.onDidChange(listener),
    }),
  };
  const agent = createCfAgentService({
    commandResolver: () => ({
      command: process.execPath,
      args: [resolve("../../apps/cli/packages/cli/dist/cf.cjs"), "app-server", "--stdio"],
      env: {
        HOME: home,
        USERPROFILE: home,
        CF_DATA_BASE_DIR: home,
        CF_RUNTIME_ENV: "development",
        CF_BUILTIN_PROVIDER_CONFIG_FILE: runtimePaths.cfBuiltinFilePath,
        CF_PERSONAL_PROVIDER_CONFIG_FILE: runtimePaths.personalFilePath,
      },
    }),
    modelSelectionReadinessSource: modelSelectionService,
    accountProviderConfigSource: deliverySource,
    accountRequestAuthService: {
      resolveAccessCurrent: async () => ({
        type: "zhipu-account",
        family: "bigmodel",
        planKind: "team-coding-plan",
        productId: "product-team-a",
        organizationId: "org-team-a",
        projectId: "proj-team-a",
      }),
      resolveCurrent: async () => ({ apiKey: "e2e-fixture-key" }),
      assertCurrent: async () => {},
    },
  });
  const repo = new TaskIndexRepo();
  const syncer = createCfTaskIndexSyncer({ agentService: agent, taskIndexRepo: repo });
  const task = createCfTaskServiceAdapter({
    cfAgentService: agent,
    taskIndexRepo: repo,
    taskIndexSyncer: syncer,
  });
  return {
    home,
    workspacePath,
    agent,
    task,
    modelSelectionService,
    selectAccount,
    async setDeliveryPaused(paused: boolean) {
      deliveryPaused = paused;
      if (!paused) deliverySource.replace(await source.read());
    },
    async dispose() {
      syncer.disposeAll();
      await agent.disposeWorkspace({ workspacePath });
      agent.disposeAll();
      repo.close();
      runtime.dispose();
      setDataBaseDir(previousDataDir);
    },
  };
}
