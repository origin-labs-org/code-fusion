import { readFile } from "node:fs/promises";
import {
  TID_CHAT_MODEL_SELECT_TRIGGER,
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
  getE2EAppDataPaths,
  readModelProviders,
  waitForWorkspaceApp,
  type E2EModelProviderSnapshot,
} from "../helpers/desktop-app.js";
import {
  assertUpstreamRequestCapture,
  assertUpstreamThoughtLevelCapture,
  waitForUpstreamNetworkCapture,
} from "../helpers/upstream-capture.js";
import { resolveSeededReplayBaseUrl } from "../helpers/custom-openai-provider-store.js";
import { createAndConfigurePersonalProvider } from "../helpers/personal-provider-settings.js";
import {
  getUpstreamApiKey,
  getUpstreamProviderModelValues,
  getSelectedUpstreamModelLabel,
  selectUpstreamProviderModelById,
  selectUpstreamThoughtLevelValue,
} from "../helpers/upstream-provider.js";
import { sel } from "../helpers/selectors.js";
import { waitForProviderConfigPolling } from "../helpers/provider-config-polling.js";
import {
  E2E_REPLY_TOKEN,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4AssistantMessageContaining,
  waitForV4ComposerText,
  waitForV4ConversationState,
  waitForV4UserMessageContaining,
} from "../helpers/v4-conversation.js";

const TEMPLATE_MODEL = "deepseek-flash";
const CATALOG_MAX_OUTPUT_TOKENS = 384_000;
const EDITED_MAX_OUTPUT_TOKENS = 64_000;
const EXPECTED_THOUGHT_LEVEL = "high";
const paths = getE2EAppDataPaths();

describe("Chat area settings page add model provider first-send E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("I08: After creating Provider from Template on settings page, chat box should retain instance identity and send first message", async function () {
    this.timeout(180000);

    await prepareV4ConversationE2E();
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30000);

    const runId = Date.now();
    const providerName = `Upstream E2E Added ${runId}`;
    const provider = await createCustomUpstreamProvider(providerName);

    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
      timeout: 15000,
      timeoutMsg: "设置页返回按钮没有出现",
    });
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30000);

    await selectUpstreamProviderModelById(TEMPLATE_MODEL, {
      includePlainModelFallback: false,
      providerId: provider.id,
      providerName,
    });
    await assertSelectedAddedProviderModel(provider);
    await selectUpstreamThoughtLevelValue(EXPECTED_THOUGHT_LEVEL);

    const marker = `E2E_MODEL_PROVIDER_ADD_SEND_${runId}`;
    const prompt = `${marker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendV4Prompt(prompt);
    await waitForV4ComposerText("", "Input box was not cleared after first send with newly added provider");
    await waitForV4UserMessageContaining(marker);

    const captureRecord = await waitForUpstreamNetworkCapture(marker);
    assertUpstreamRequestCapture(captureRecord, {
      expectedText: prompt,
      model: TEMPLATE_MODEL,
    });
    assertUpstreamThoughtLevelCapture(captureRecord, EXPECTED_THOUGHT_LEVEL);
    expect(readRequestNumber(captureRecord.requestJson, "max_completion_tokens")).toBe(
      EDITED_MAX_OUTPUT_TOKENS,
    );

    await waitForV4AssistantMessageContaining(E2E_REPLY_TOKEN);
    await waitForV4ConversationState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      "Did not return to idle after first turn with newly added provider",
      90000,
    );
  });
});

async function createCustomUpstreamProvider(providerName: string) {
  const baseURL = await resolveSeededReplayBaseUrl();
  if (!baseURL) {
    throw new Error("Replay provider Base URL for this turn not found; cannot add provider via settings page");
  }

  await openModelProviderSettings();
  const firstProvider = await createAndConfigureTemplateProvider({
    baseURL,
    providerName: `${providerName} First`,
  });
  const provider = await createAndConfigureTemplateProvider({ baseURL, providerName });
  expect(provider.id).not.toBe(firstProvider.id);

  await editModelMaxOutputTokens(CATALOG_MAX_OUTPUT_TOKENS, EDITED_MAX_OUTPUT_TOKENS);
  await restoreModelDefaults(EDITED_MAX_OUTPUT_TOKENS, CATALOG_MAX_OUTPUT_TOKENS);
  await editModelMaxOutputTokens(CATALOG_MAX_OUTPUT_TOKENS, EDITED_MAX_OUTPUT_TOKENS);
  expect(
    await hasPersonalMaxOutputOverride(firstProvider.id, TEMPLATE_MODEL, EDITED_MAX_OUTPUT_TOKENS),
  ).toBe(false);

  const savedProvider = await waitForCreatedProvider(
    providerName,
    baseURL,
    TEMPLATE_MODEL,
    EDITED_MAX_OUTPUT_TOKENS,
  );
  await waitForProviderConfigPolling();
  return savedProvider;
}

async function createAndConfigureTemplateProvider({
  baseURL,
  providerName,
}: {
  baseURL: string;
  providerName: string;
}) {
  await createAndConfigurePersonalProvider({
    apiFormat: "openai-chat-completions",
    apiKey: getUpstreamApiKey(),
    baseURL,
    providerName,
    templateId: "deepseek",
  });
  const provider = await waitForProviderByName(providerName, baseURL);
  await waitForProviderConfigPolling();
  return provider;
}

async function waitForProviderByName(providerName: string, baseURL: string) {
  let provider: E2EModelProviderSnapshot | undefined;
  await browser.waitUntil(
    async () => {
      provider = (await readModelProviders()).find((candidate) => candidate.name === providerName);
      return Boolean(
        provider &&
        provider.apiKey.trim() === getUpstreamApiKey() &&
        provider.apiFormat === "openai-chat-completions" &&
        hasEndpoint(provider, baseURL),
      );
    },
    {
      timeout: 15_000,
      timeoutMsg: `Template Provider 没有Save到 Personal Config: ${providerName}`,
    },
  );
  if (!provider) throw new Error(`Template Provider WaitingCompleted后仍不存在: ${providerName}`);
  return provider;
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

async function setMaxOutputTokensValue(value: number) {
  const inputIndex = await browser.execute(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    return Array.from(dialog?.querySelectorAll<HTMLInputElement>("input") ?? []).findIndex(
      (input) =>
        /^(最大Output Token|Max output tokens)$/i.test(input.getAttribute("aria-label") ?? ""),
    );
  });
  if (inputIndex < 0) {
    throw new Error("Model metadata modal lacks max output token input field");
  }
  const inputs = await $$('[role="dialog"] input');
  const input = inputs[inputIndex];
  if (!input || !(await input.isEnabled())) {
    throw new Error(`最大Output Token 无法Input: ${input ? "disabled" : "missing-input"}`);
  }
  await input.setValue(String(value));
  await browser.waitUntil(async () => (await input.getValue()) === String(value), {
    timeout: 5000,
    timeoutMsg: `最大Output Token 没有更New为 ${value}`,
  });
}

async function clickModelMetadataSave() {
  const saveButtonIndex = await browser.execute(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    return Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? []).findIndex(
      (button) => {
        const text = button.innerText.replace(/\s+/g, " ").trim();
        return text === "保存" || text.startsWith("Save");
      },
    );
  });
  const buttons = await $$('[role="dialog"] button');
  const saveButton = buttons[saveButtonIndex];
  if (!saveButton || !(await saveButton.isEnabled())) {
    throw new Error("Model metadata modal lacks a clickable save button");
  }
  await saveButton.click();
  try {
    await browser.waitUntil(
      () => browser.execute(() => !document.querySelector<HTMLElement>('[role="dialog"]')),
      {
        timeout: 10000,
        timeoutMsg: "模型 metadata 弹窗保存后没有关闭",
      },
    );
  } catch (error) {
    const dialogText = await browser.execute(
      () => document.querySelector<HTMLElement>('[role="dialog"]')?.innerText ?? "",
    );
    throw new Error(`Model metadata 弹窗SaveFailed: ${dialogText}`, { cause: error });
  }
}

async function readModelMetadataDialogSnapshot() {
  return browser.execute(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const inputs = Array.from(dialog?.querySelectorAll<HTMLInputElement>("input") ?? []);
    const maxOutputTokensInput = inputs.find((input) =>
      /^(最大Output Token|Max output tokens)$/i.test(input.getAttribute("aria-label") ?? ""),
    );
    const contextWindowInput = inputs.find((input) => {
      const label = input.parentElement?.querySelector("label")?.textContent?.trim() ?? "";
      return /^(ContextWindow|Context window)$/i.test(label);
    });
    const saveButton = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
      (button) => {
        const text = button.innerText.replace(/\s+/g, " ").trim();
        return text === "保存" || text.startsWith("Save");
      },
    );
    return {
      contextWindowPlaceholder: contextWindowInput?.placeholder ?? null,
      contextWindowValue: contextWindowInput?.value ?? null,
      hasDialog: Boolean(dialog),
      loadingVisible: maxOutputTokensInput?.getAttribute("aria-busy") === "true",
      maxOutputTokensDisabled: maxOutputTokensInput?.disabled ?? null,
      maxOutputTokensPlaceholder: maxOutputTokensInput?.placeholder ?? null,
      maxOutputTokensValue: maxOutputTokensInput?.value ?? null,
      saveDisabled: saveButton?.disabled ?? null,
    };
  });
}

async function editModelMaxOutputTokens(currentValue: number, nextValue: number) {
  await openFirstModelMetadataDialog();

  const snapshot = await readModelMetadataDialogSnapshot();
  expect(snapshot.maxOutputTokensValue).toBe("");
  expect(snapshot.maxOutputTokensPlaceholder).toBe(String(currentValue));
  expect(snapshot.maxOutputTokensDisabled).toBe(false);
  expect(snapshot.loadingVisible).toBe(false);

  await setMaxOutputTokensValue(nextValue);
  await clickModelMetadataSave();
}

async function restoreModelDefaults(currentValue: number, inheritedValue: number) {
  await openFirstModelMetadataDialog();
  expect((await readModelMetadataDialogSnapshot()).maxOutputTokensValue).toBe(String(currentValue));
  const restored = await browser.execute(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const button = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
      (candidate) => /^(Reset form|Reset form)$/i.test(candidate.innerText.trim()),
    );
    if (!button || button.disabled) return false;
    button.click();
    return true;
  });
  if (!restored) throw new Error("Template model lacks an available reset form button");
  await browser.waitUntil(
    async () => {
      const snapshot = await readModelMetadataDialogSnapshot();
      return (
        snapshot.maxOutputTokensValue === "" &&
        snapshot.maxOutputTokensPlaceholder === String(inheritedValue)
      );
    },
    {
      timeout: 10_000,
      timeoutMsg: "重置表单后没有回到 Provider Template 继承值",
    },
  );
  await clickModelMetadataSave();
}

async function openFirstModelMetadataDialog() {
  await browser.waitUntil(
    async () =>
      browser.execute(() =>
        Boolean(
          document.querySelector<HTMLButtonElement>(
            'button[aria-label="编辑模型配置"], button[aria-label="编辑模型配置"]',
          ),
        ),
      ),
    {
      timeout: 15000,
      timeoutMsg: "Model edit button did not appear after saving newly added provider",
    },
  );
  await browser.execute(() => {
    document
      .querySelector<HTMLButtonElement>(
        'button[aria-label="编辑模型配置"], button[aria-label="编辑模型配置"]',
      )
      ?.click();
  });
  await browser.waitUntil(
    () => browser.execute(() => Boolean(document.querySelector<HTMLElement>('[role="dialog"]'))),
    {
      timeout: 10000,
      timeoutMsg: "编辑模型 metadata 弹窗没有出现",
    },
  );
  const visibleInputModalities = await browser.execute(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>('[role="dialog"] [data-model-input-modality]'),
    ).map((element) => element.dataset.modelInputModality),
  );
  expect(visibleInputModalities).toEqual(["text", "image", "video", "pdf"]);
}

async function waitForCreatedProvider(
  providerName: string,
  baseURL: string,
  modelId: string,
  maxOutputTokens: number,
) {
  let latestProviders: E2EModelProviderSnapshot[] = [];
  try {
    await browser.waitUntil(
      async () => {
        latestProviders = await readModelProviders();
        const provider = latestProviders.find((candidate) => candidate.name === providerName);
        return Boolean(
          provider &&
          provider.apiKey.trim() === getUpstreamApiKey() &&
          hasEndpoint(provider, baseURL) &&
          (await hasPersonalMaxOutputOverride(provider.id, modelId, maxOutputTokens)),
        );
      },
      {
        timeout: 10000,
        timeoutMsg: `New增 provider 没有Save到LocalConfiguration: ${providerName}`,
      },
    );
  } catch (error) {
    throw new Error(
      `New增 provider 落盘Result不符合预期: ${JSON.stringify(
        latestProviders.map((provider) => ({
          id: provider.id,
          name: provider.name,
          personalModelIds: provider.models.map((model) => model.id),
        })),
      )}`,
      { cause: error },
    );
  }

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

async function hasPersonalMaxOutputOverride(
  providerId: string,
  modelId: string,
  maxOutputTokens: number,
) {
  try {
    const parsed = JSON.parse(await readFile(paths.configFile, "utf-8")) as {
      config?: { modelConfigRules?: { providerModelRules?: unknown } };
    };
    const rules = parsed.config?.modelConfigRules?.providerModelRules;
    if (!Array.isArray(rules)) return false;
    return rules.some((rule) => {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) return false;
      const candidate = rule as Record<string, unknown>;
      const config = candidate.config;
      if (!config || typeof config !== "object" || Array.isArray(config)) return false;
      const optionSpecs = (config as Record<string, unknown>).optionSpecs;
      if (!optionSpecs || typeof optionSpecs !== "object" || Array.isArray(optionSpecs)) {
        return false;
      }
      const maxSpec = (optionSpecs as Record<string, unknown>).maxOutputTokens;
      return (
        candidate.providerId === providerId &&
        candidate.modelId === modelId &&
        Boolean(
          maxSpec &&
          typeof maxSpec === "object" &&
          !Array.isArray(maxSpec) &&
          (maxSpec as Record<string, unknown>).max === maxOutputTokens,
        )
      );
    });
  } catch {
    return false;
  }
}

function readRequestNumber(body: unknown, key: string): number | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

async function assertSelectedAddedProviderModel(provider: E2EModelProviderSnapshot) {
  const label = await getSelectedUpstreamModelLabel();
  const acceptedValues = getUpstreamProviderModelValues(TEMPLATE_MODEL, {
    includePlainModelFallback: false,
    providerId: provider.id,
  });
  if (!acceptedValues.includes(label.currentValue)) {
    throw new Error(
      `聊天Tools栏CurrentModel没有RetainNew增 provider 身份: ${JSON.stringify({
        acceptedValues,
        label,
        providerId: provider.id,
      })}`,
    );
  }
  await $(sel(TID_CHAT_MODEL_SELECT_TRIGGER)).waitForDisplayed({ timeout: 15000 });
}
