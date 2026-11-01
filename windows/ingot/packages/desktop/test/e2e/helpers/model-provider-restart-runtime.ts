import { NodePersonalProviderConfigRepository } from "@origin-ai/cf-provider-node";
import { getE2EAppDataPaths, waitForWorkspaceApp } from "./desktop-app.js";
import { reloadElectronSessionSafely } from "./e2e-electron-reload.js";
import { flushElectronStorageData } from "./e2e-electron-storage.js";
import { skipOccupationOnboardingIfPresent } from "./occupation-onboarding.js";

const paths = getE2EAppDataPaths();
const MODEL_SELECTION_RECENT_KEY_PREFIX = "cf-model-selection-recent-v1:";
let retainedRestartUserDataDir: string | null = null;

export interface ModelProviderRestartOptions {
  afterElectronProcessExit?: () => Promise<void> | void;
}

export async function seedTurboAgentStartupModel(providerId: string, modelId: string) {
  const repository = new NodePersonalProviderConfigRepository({
    filePath: paths.configFile,
    pollingIntervalMs: false,
  });
  try {
    await repository.update((current) => ({
      ...current,
      defaultModelSelection: { providerId, modelId },
    }));
  } finally {
    repository.dispose();
  }
}

export async function restartIntoWorkspacePreservingProfile(
  workspacePath: string,
  options: ModelProviderRestartOptions = {},
) {
  const isFirstRestart = retainedRestartUserDataDir === null;
  if (isFirstRestart) {
    retainedRestartUserDataDir = (await browser.electron.execute((electron) =>
      electron.app.getPath("userData"),
    )) as string;
  }
  const requestedCapabilities = browser.requestedCapabilities as WebdriverIO.Capabilities & {
    "goog:chromeOptions"?: { args?: string[] };
  };
  const chromeOptions = requestedCapabilities["goog:chromeOptions"] ?? {};
  requestedCapabilities["goog:chromeOptions"] = {
    ...chromeOptions,
    args: [
      ...(chromeOptions.args ?? []).filter((arg) => !arg.startsWith("--user-data-dir=")),
      `--user-data-dir=${retainedRestartUserDataDir}`,
    ],
  };

  await flushElectronStorageData(browser);
  await reloadElectronSessionSafely(browser, {
    afterElectronProcessExit: options.afterElectronProcessExit,
  });
  await skipOccupationOnboardingIfPresent();
  await waitForWorkspaceApp(workspacePath, 60000);
}

export async function restartIntoWorkspaceRestoringPreferences(
  workspacePath: string,
  options: ModelProviderRestartOptions = {},
) {
  const persistedModelPreferences = await browser.execute(
    (modelSelectionRecentKeyPrefix) =>
      Object.fromEntries(
        Object.entries(window.localStorage).filter(
          ([key]) =>
            key.startsWith("cf-last-agent-") ||
            key.startsWith(modelSelectionRecentKeyPrefix),
        ),
      ),
    MODEL_SELECTION_RECENT_KEY_PREFIX,
  );
  await reloadElectronSessionSafely(browser, {
    afterElectronProcessExit: options.afterElectronProcessExit,
  });
  await waitForWorkspaceApp(workspacePath, 60000);
  await browser.execute((preferences) => {
    for (const [key, value] of Object.entries(preferences)) {
      window.localStorage.setItem(key, value);
    }
    window.location.reload();
  }, persistedModelPreferences);
  await waitForWorkspaceApp(workspacePath, 60000);
}
