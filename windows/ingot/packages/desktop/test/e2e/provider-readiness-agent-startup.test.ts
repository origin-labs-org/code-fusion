import { openWorkspaceDraftFromSidebar } from "./helpers/workspace-agent-warmup.js";
import { BUILTIN_PROVIDER_TEMPLATE_IDS, decodeCustomModelValue } from "@origin-ai/cf-shared";
import {
  TID_CHAT_ERROR_BANNER,
  TID_CHAT_MODEL_SELECT_TRIGGER,
  TID_MODEL_PROVIDER_API_KEY_INPUT,
  TID_MODEL_PROVIDER_ADD_PROVIDER_BUTTON,
  TID_MODEL_PROVIDER_TEMPLATE_ITEM,
  TID_MODEL_PROVIDER_NAV_ITEM,
  TID_LOGIN_API_KEY_SKIP_BUTTON,
  TID_LOGIN_USE_API_KEY_BUTTON,
  TID_SETTINGS_SECTION_NAV,
  TID_SETTINGS_BACK_BUTTON,
  TID_TASK_ITEM,
  TID_V4_COMPOSER_INPUT,
  TID_V4_COMPOSER_SEND,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  clickTestIdByDom,
  readModelProvider,
  readModelProviders,
  setInputValueByTestIdDom,
  waitForDefaultWorkspaceReady,
  waitForTestIdByDom,
} from "./helpers/desktop-app.js";
import {
  PROVIDER_READINESS_HISTORY_ASSISTANT_TEXT,
  PROVIDER_READINESS_HISTORY_SESSION_ID,
  PROVIDER_READINESS_HISTORY_TITLE,
  PROVIDER_READINESS_HISTORY_USER_TEXT,
} from "./helpers/provider-readiness-history-fixture.js";
import {
  selectV4TaskById,
  waitForV4ComposerText,
  waitForV4TimelineContaining,
} from "#e2e/helpers/v4-conversation";
import {
  countAgentProcessRows,
  isMainRendererUrl,
  isResourceManagerUrl,
  openResourceManager,
  switchToElectronRendererTarget,
  waitForAgentProcessCount,
  waitForResourceManagerReady,
} from "./helpers/resource-manager.js";

const E2E_PROVIDER_API_KEY = "e2e-login-api-key";

describe("Provider/model readiness 只门禁模型执行", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("I23/I24: Empty config starts only a single read-only Agent, reuses and hydrates draft model after saving API Key provider", async function () {
    this.timeout(120000);

    await waitForTestIdByDom(TID_LOGIN_USE_API_KEY_BUTTON, {
      timeout: 30000,
      timeoutMsg: "API Key configuration entry was not displayed after empty auth/provider cold start",
    });
    await clickTestIdByDom(TID_LOGIN_USE_API_KEY_BUTTON);
    await clickTestIdByDom(TID_LOGIN_API_KEY_SKIP_BUTTON, {
      timeout: 15000,
      timeoutMsg: "API Key login page has no available skip-for-now option",
    });
    await waitForDefaultWorkspaceReady(30000);
    await waitForModelConfigMissingBanner();

    await waitForProviderReadinessHistory();
    await selectV4TaskById(PROVIDER_READINESS_HISTORY_SESSION_ID);
    await waitForV4TimelineContaining(PROVIDER_READINESS_HISTORY_USER_TEXT);
    await waitForV4TimelineContaining(PROVIDER_READINESS_HISTORY_ASSISTANT_TEXT);
    await openWorkspaceDraftFromSidebar(DEFAULT_WORKSPACE);
    await waitForModelConfigMissingBanner();

    const blockedDraft = "This draft must be preserved and cannot enter pending command";
    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, blockedDraft, {
      timeout: 15000,
      timeoutMsg: "Missing model draft page has no writable composer",
    });
    expect(await $(`[data-testid="${TID_V4_COMPOSER_SEND}"]`).isEnabled()).toBe(false);
    await waitForV4ComposerText(blockedDraft, "Missing model gate did not preserve original composer text");
    expect(
      await browser.execute(() => window.localStorage.getItem("cf-v4-pending-commands:v1")),
    ).toBeNull();
    await waitForModelConfigMissingBanner();

    await openResourceManager();
    await switchToElectronRendererTarget(isResourceManagerUrl);
    await waitForResourceManagerReady();
    await waitForAgentProcessCount(1, { workspaceNameSuffix: "-cfproject" });

    await switchToElectronRendererTarget(isMainRendererUrl);
    await clickModelSettingsFromMissingBanner();
    const providerId = await createApiKeyProviderFromTemplate();
    await setInputValueByTestIdDom(TID_MODEL_PROVIDER_API_KEY_INPUT, E2E_PROVIDER_API_KEY, {
      timeout: 15000,
      timeoutMsg: "Missing model banner did not open API Key provider configuration",
    });
    await browser.execute(
      (id) => document.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)?.blur(),
      TID_MODEL_PROVIDER_API_KEY_INPUT,
    );
    const provider = await waitForSavedApiKeyProvider(providerId);
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
      timeout: 15000,
      timeoutMsg: "Model provider settings page has no return entry",
    });
    await waitForDefaultWorkspaceReady(30000);

    await waitForHydratedDraftModel(provider.id);
    await waitForModelConfigMissingBannerCleared();
    await waitForV4ComposerText(blockedDraft, "保存 Provider 并返回后 composer 丢失原文");
    await browser.waitUntil(() => $(`[data-testid="${TID_V4_COMPOSER_SEND}"]`).isEnabled(), {
      timeout: 15_000,
      timeoutMsg: "Send button is still unavailable after Provider model hydration",
    });
    expect(
      await browser.execute(() => window.localStorage.getItem("cf-v4-pending-commands:v1")),
    ).toBeNull();

    await switchToElectronRendererTarget(isResourceManagerUrl);
    await waitForAgentProcessCount(1, { workspaceNameSuffix: "-cfproject" });

    await browser.pause(1500);
    expect(await countAgentProcessRows({ workspaceNameSuffix: "-cfproject" })).toBe(1);
  });
});

async function waitForProviderReadinessHistory() {
  const itemTestId = testId(TID_TASK_ITEM, PROVIDER_READINESS_HISTORY_SESSION_ID);
  await waitForTestIdByDom(itemTestId, {
    timeout: 30000,
    timeoutMsg: "Preset tasks-index history row did not appear in sidebar when provider is not ready",
  });
  const title = await browser.execute((targetTestId) => {
    return document
      .querySelector<HTMLElement>(`[data-testid="${targetTestId}"]`)
      ?.innerText.replace(/\s+/g, " ")
      .trim();
  }, itemTestId);
  expect(title).toContain(PROVIDER_READINESS_HISTORY_TITLE);
}

async function clickModelSettingsFromMissingBanner() {
  await browser.waitUntil(
    () =>
      browser.execute((bannerTestId) => {
        const banner = document.querySelector<HTMLElement>(`[data-testid="${bannerTestId}"]`);
        const button = Array.from(banner?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
          (candidate) => candidate.querySelector("svg.lucide-settings"),
        );
        if (!button || button.disabled) return false;
        button.click();
        return true;
      }, TID_CHAT_ERROR_BANNER),
    {
      timeout: 15000,
      interval: 100,
      timeoutMsg: "Missing model banner has no available model configuration entry",
    },
  );
}

async function createApiKeyProviderFromTemplate(): Promise<string> {
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "modelProvider"));
  const existingIds = new Set((await readModelProviders()).map((provider) => provider.id));
  await clickTestIdByDom(TID_MODEL_PROVIDER_ADD_PROVIDER_BUTTON);
  await clickTestIdByDom(
    testId(TID_MODEL_PROVIDER_TEMPLATE_ITEM, BUILTIN_PROVIDER_TEMPLATE_IDS.bigmodel),
  );
  let providerId = "";
  await browser.waitUntil(
    async () => {
      providerId =
        (await readModelProviders()).find((provider) => !existingIds.has(provider.id))?.id ?? "";
      return Boolean(providerId);
    },
    { timeout: 15_000, timeoutMsg: "BigModel Template 没有创建 Personal Provider" },
  );
  await clickTestIdByDom(testId(TID_MODEL_PROVIDER_NAV_ITEM, `custom:${providerId}`));
  return providerId;
}

async function waitForSavedApiKeyProvider(providerId: string) {
  let latest = await readModelProvider(providerId);
  await browser.waitUntil(
    async () => {
      latest = await readModelProvider(providerId);
      const provider = latest;
      return provider?.apiKey === E2E_PROVIDER_API_KEY;
    },
    {
      timeout: 15000,
      interval: 250,
      timeoutMsg: "Structurally usable BigModel provider/model was not saved after API Key login",
    },
  );
  if (!latest) {
    throw new Error("API Key 登录后没有读取到 BigModel provider");
  }
  return latest;
}

async function waitForHydratedDraftModel(providerId: string) {
  await browser.waitUntil(
    async () => {
      const value = await browser.execute(
        (id) =>
          document.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.dataset.modelCurrentValue ??
          "",
        TID_CHAT_MODEL_SELECT_TRIGGER,
      );
      const selected = decodeCustomModelValue(value);
      return selected?.providerId === providerId && Boolean(selected.modelName);
    },
    {
      timeout: 30_000,
      interval: 250,
      timeoutMsg: `Waiting的 workspace 没有水合 Personal Provider ${providerId} 的Model`,
    },
  );
}

async function waitForModelConfigMissingBanner() {
  await waitForTestIdByDom(TID_CHAT_ERROR_BANNER, {
    timeout: 15000,
    timeoutMsg: "未配置模型的草稿首页没有展示 modelConfigMissing banner",
  });
  const errorCode = await browser.execute((testId) => {
    return document
      .querySelector<HTMLElement>(`[data-testid="${testId}"]`)
      ?.getAttribute("data-error-code");
  }, TID_CHAT_ERROR_BANNER);
  expect(errorCode).toBe("model_config_missing");
}

async function waitForModelConfigMissingBannerCleared() {
  await browser.waitUntil(
    () =>
      browser.execute(
        (testId) => !document.querySelector(`[data-testid="${testId}"]`),
        TID_CHAT_ERROR_BANNER,
      ),
    {
      timeout: 15000,
      interval: 250,
      timeoutMsg: "草稿模型水合后 modelConfigMissing banner 没有清除",
    },
  );
}
