import {
  TID_MODEL_PROVIDER_ADD_MODEL_BUTTON,
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  DEFAULT_WORKSPACE,
  clickTestIdByDom,
  readModelProviders,
  resolveE2EProviderRuntimeBaseUrl,
  waitForWorkspaceApp,
  type E2EModelProviderSnapshot,
} from "./desktop-app.js";
import {
  resolveSeededReplayBaseUrl,
  seedCustomOpenAIChatCompletionsProvider,
  seedCustomAnthropicMessagesProvider,
  type SeedCustomOpenAIProviderOptions,
} from "./custom-openai-provider-store.js";
import { getUpstreamApiKey } from "./upstream-provider.js";
import { reloadElectronSessionSafely } from "./e2e-electron-reload.js";
import { sel } from "./selectors.js";
import { createAndConfigurePersonalProvider } from "./personal-provider-settings.js";
import { saveProviderModelMetadataDialog } from "./provider-model-metadata-dialog.js";

export { seedCustomOpenAIChatCompletionsProvider, saveProviderModelMetadataDialog };
export { seedCustomAnthropicMessagesProvider };

interface CreateCustomOpenAIProviderOptions {
  apiFormat?: "openai-chat-completions" | "anthropic-messages";
  baseURL?: string;
  modelId: string;
  providerName: string;
}

export async function restartWithSeededOpenAIProviders(
  providers: readonly SeedCustomOpenAIProviderOptions[],
) {
  const seededProviders: E2EModelProviderSnapshot[] = [];
  await reloadElectronSessionSafely(browser, {
    afterElectronProcessExit: async () => {
      for (const provider of providers) {
        seededProviders.push(await seedCustomOpenAIChatCompletionsProvider(provider));
      }
    },
  });
  await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);
  return seededProviders;
}

export async function createCustomOpenAIChatCompletionsProvider({
  apiFormat: explicitApiFormat,
  baseURL: explicitBaseURL,
  modelId,
  providerName,
}: CreateCustomOpenAIProviderOptions) {
  const baseURL = explicitBaseURL?.trim() || (await resolveSeededReplayBaseUrl());
  if (!baseURL) {
    throw new Error(
      "没有找到已 seed 的 replay provider Base URL，无法新增 OpenAI-compatible provider",
    );
  }

  await openModelProviderSettings();
  await createAndConfigurePersonalProvider({
    apiFormat: explicitApiFormat ?? "openai-chat-completions",
    apiKey: getUpstreamApiKey(),
    baseURL,
    providerName,
  });

  await clickTestIdByDom(TID_MODEL_PROVIDER_ADD_MODEL_BUTTON, {
    timeout: 15000,
    timeoutMsg: "新增 provider 添加模型按钮没有出现",
  });
  await addModelThroughMetadataDialog(modelId);

  return waitForCreatedOpenAIProvider(providerName, baseURL, modelId, explicitApiFormat);
}

export async function refreshSeededOpenAIProvidersThroughSettings(
  providerNames: readonly string[],
  options: { workspacePath?: string | null } = {},
) {
  const workspacePath =
    options.workspacePath ||
    (await browser.execute(
      () =>
        (
          window as Window & {
            __cfTabStoreE2E?: { getState?: () => { activeWorkspacePath?: string | null } };
          }
        ).__cfTabStoreE2E?.getState?.().activeWorkspacePath ?? null,
    )) ||
    DEFAULT_WORKSPACE;
  await openModelProviderSettings();
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
          (candidate) => {
            const label = candidate.getAttribute("aria-label")?.trim() ?? "";
            return label === "刷新" || label === "Refresh";
          },
        );
        if (!button || button.disabled || button.getAttribute("aria-busy") === "true") {
          return false;
        }
        button.click();
        return true;
      }),
    {
      timeout: 30000,
      timeoutMsg: "设置页模型供应商刷新按钮没有进入可点击状态",
    },
  );
  await browser.waitUntil(
    async () =>
      browser.execute((expectedNames) => {
        const bodyText = document.body?.innerText ?? "";
        return expectedNames.every((name) => bodyText.includes(name));
      }, providerNames),
    {
      timeout: 30000,
      timeoutMsg: `Settings页没有Refresh出 direct seed 的 provider: ${providerNames.join(", ")}`,
    },
  );
  await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
    timeout: 15000,
    timeoutMsg: "设置页返回按钮没有出现",
  });
  await waitForWorkspaceApp(workspacePath, 30000);
}

async function openModelProviderSettings() {
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
    timeout: 15000,
    timeoutMsg: "Could not find settings entry button",
  });
  await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout: 15000 });
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "modelProvider"), {
    timeout: 15000,
    timeoutMsg: "设置页没有出现模型供应商分区入口",
  });
}

async function addModelThroughMetadataDialog(modelId: string) {
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
        return Boolean(dialog?.querySelector("input"));
      }),
    {
      timeout: 15000,
      timeoutMsg: "新增 provider 模型 metadata 弹窗没有出现",
    },
  );

  const inputIndex = await browser.execute(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) {
      return -1;
    }
    const inputs = Array.from(dialog.querySelectorAll<HTMLInputElement>("input"));
    return inputs.findIndex((input) => {
      const label = input.parentElement?.querySelector("label")?.textContent?.trim() ?? "";
      const placeholder = input.getAttribute("placeholder") ?? "";
      return [label, placeholder].some((text) => /^(Model ID|Model ID)$/i.test(text.trim()));
    });
  });
  if (inputIndex < 0) {
    throw new Error("新增 provider 模型 metadata 弹窗没有模型 ID 输入框");
  }

  const inputs = await $$('[role="dialog"] input');
  const modelInput = inputs[inputIndex];
  if (!modelInput) {
    throw new Error(`New增 provider Model metadata Input框索引Invalid: ${inputIndex}`);
  }
  await modelInput.waitForDisplayed({ timeout: 5000 });
  await modelInput.setValue(modelId);
  await browser.waitUntil(async () => (await modelInput.getValue()) === modelId, {
    timeout: 5000,
    timeoutMsg: `New增 provider Model ID 没有WriteInput框: ${modelId}`,
  });

  await saveProviderModelMetadataDialog("provider");
}

async function waitForCreatedOpenAIProvider(
  providerName: string,
  baseURL: string,
  modelId: string,
  apiFormat: CreateCustomOpenAIProviderOptions["apiFormat"] = "openai-chat-completions",
) {
  let latestProviders: E2EModelProviderSnapshot[] = [];
  await browser.waitUntil(
    async () => {
      latestProviders = await readModelProviders();
      const provider = latestProviders.find((candidate) => candidate.name === providerName);
      return Boolean(
        provider &&
        provider.apiFormat === apiFormat &&
        provider.defaultKind ===
          (apiFormat === "anthropic-messages" ? "anthropic" : "openai-compatible") &&
        provider.apiKey.trim() === getUpstreamApiKey() &&
        hasEndpoint(provider, baseURL) &&
        resolveE2EProviderRuntimeBaseUrl(provider) === baseURL &&
        hasModel(provider, modelId),
      );
    },
    {
      timeout: 30000,
      timeoutMsg: `New增 provider 没有Save到LocalConfiguration: ${providerName}`,
    },
  );

  const provider = latestProviders.find((candidate) => candidate.name === providerName);
  if (!provider) {
    throw new Error(`New增 provider Waiting后仍不存在: ${providerName}`);
  }
  return provider;
}

function hasEndpoint(provider: E2EModelProviderSnapshot, baseURL: string) {
  return Object.values(provider.endpoints ?? {}).some((value) => {
    if (typeof value !== "string") {
      return false;
    }
    return value.trim() === baseURL;
  });
}

function hasModel(provider: E2EModelProviderSnapshot, modelId: string) {
  return provider.models.some((model) =>
    typeof model === "string" ? model === modelId : model.id === modelId,
  );
}
