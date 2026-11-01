import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { decodeCustomModelValue, encodeCustomModelValue } from "@origin-ai/cf-shared";
import {
  TID_CHAT_MODEL_SELECT_ITEM,
  TID_CHAT_MODEL_SELECT_GROUP,
  TID_CHAT_MODEL_SELECT_TRIGGER,
  TID_CHAT_THOUGHT_LEVEL_SELECT_ITEM,
  TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER,
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_SUBAGENT_BUILT_IN_MODEL_TRIGGER,
  TID_SUBAGENT_ROW,
  TID_TASK_SETTINGS_BUTTON,
  TID_V4_SUBAGENT_OPEN_SIDE_PANE,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  clickTestIdByDom,
  readAgentsState,
  waitForTestIdByDom,
  waitForWorkspaceApp,
} from "../helpers/desktop-app.js";
import {
  assertUpstreamRequestCapture,
  assertUpstreamThoughtLevelCapture,
} from "../helpers/upstream-capture.js";
import { reloadElectronSessionSafely } from "../helpers/e2e-electron-reload.js";
import type {
  E2ENetworkCaptureArtifact,
  E2ENetworkCaptureRecord,
} from "../helpers/network-capture-proxy.js";
import {
  UPSTREAM_ALTERNATE_MODEL,
  UPSTREAM_ALTERNATE_PROVIDER_ID,
  UPSTREAM_ALTERNATE_PROVIDER_NAME,
  UPSTREAM_MODEL,
  UPSTREAM_PROVIDER_ID,
} from "../helpers/upstream-provider.js";
import { resolveE2EStorageRoot } from "../helpers/e2e-runtime-paths.js";
import {
  restartIntoWorkspacePreservingProfile,
  seedPersistedModelSelection,
} from "../helpers/model-provider-restart.js";
import { waitForProviderConfigPolling } from "../helpers/provider-config-polling.js";
import { sel } from "../helpers/selectors.js";
import { waitForToolCallBlockByToolName } from "../helpers/conversation-session-tool.js";
import {
  getV4PaneSnapshot,
  prepareV4ConversationE2E,
  selectV4TaskById,
  sendV4PromptAndWaitAccepted,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
  waitForV4Pane,
} from "../helpers/v4-conversation.js";

const OVERRIDE_MODEL_VALUE = encodeCustomModelValue(
  UPSTREAM_ALTERNATE_PROVIDER_ID,
  UPSTREAM_ALTERNATE_MODEL,
);
const PRIMARY_MODEL_VALUE = encodeCustomModelValue(UPSTREAM_PROVIDER_ID, UPSTREAM_MODEL);
const CUSTOM_AGENT_NAME = "e2e-reasoning-reviewer";
const CUSTOM_AGENT_PATH = join(resolveE2EStorageRoot(), "agents", `${CUSTOM_AGENT_NAME}.md`);
const SUBAGENT_FORM_SELECTOR = `form:has(input[type="text"]):has(${sel(TID_CHAT_MODEL_SELECT_TRIGGER)})`;
const INVALID_EFFORT = "invalid-e2e";
const GENERAL_EFFORT = "high";
const EXPLORE_EFFORT = "high";
const CUSTOM_EFFORT = "high";
const PARENT_EFFORT = "max";
const GENERAL_PARENT_MARKER = "E2E_BUILT_IN_SUBAGENT_GENERAL_PARENT";
const GENERAL_CHILD_MARKER = "E2E_BUILT_IN_SUBAGENT_GENERAL_CHILD";
const GENERAL_CHILD_REPLY_TOKEN = "E2E_BUILT_IN_SUBAGENT_GENERAL_CHILD_OK";
const GENERAL_FINAL_TOKEN = "built-in-general-subagent-model-override-done";
const EXPLORE_PARENT_MARKER = "E2E_BUILT_IN_SUBAGENT_EXPLORE_PARENT";
const EXPLORE_CHILD_MARKER = "E2E_BUILT_IN_SUBAGENT_EXPLORE_CHILD";
const EXPLORE_CHILD_REPLY_TOKEN = "E2E_BUILT_IN_SUBAGENT_EXPLORE_CHILD_OK";
const EXPLORE_FINAL_TOKEN = "built-in-explore-subagent-model-override-done";
const CUSTOM_PARENT_MARKER = "E2E_CUSTOM_SUBAGENT_REASONING_PARENT";
const CUSTOM_CHILD_MARKER = "E2E_CUSTOM_SUBAGENT_REASONING_CHILD";
const CUSTOM_CHILD_REPLY_TOKEN = "E2E_CUSTOM_SUBAGENT_REASONING_CHILD_OK";
const CUSTOM_FINAL_TOKEN = "custom-subagent-reasoning-override-done";
describe("Subagent model and reasoning effort coverage E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("I20: Settings cold boot enters child provider request after saving builtin/custom effort", async function () {
    this.timeout(300000);

    await prepareV4ConversationE2E({ skipProvider: true });
    await setRendererLocale("en-US");
    await configureSubagentReasoningOverrides();
    await seedPersistedModelSelection({
      modelId: UPSTREAM_MODEL,
      providerId: UPSTREAM_PROVIDER_ID,
      reasoningLevel: PARENT_EFFORT,
    });
    const state = await readAgentsState();
    const { builtInModelSelectionOverrides: _newSelections, ...rest } = state;
    await writeFile(
      join(resolveE2EStorageRoot(), "v2", "agents-state.json"),
      JSON.stringify({
        ...rest,
        builtInModelOverrides: {
          "general-purpose": OVERRIDE_MODEL_VALUE,
          Explore: OVERRIDE_MODEL_VALUE,
        },
        builtInThoughtLevelOverrides: {
          "general-purpose": GENERAL_EFFORT,
          Explore: EXPLORE_EFFORT,
        },
      }),
    );
    const customProfile = await readFile(CUSTOM_AGENT_PATH, "utf8");
    expect(customProfile).not.toContain("modelSelection:");
    await restartIntoWorkspacePreservingProfile();
    expect(await readFile(CUSTOM_AGENT_PATH, "utf8")).toBe(customProfile);
    await prepareV4ConversationE2E({ skipProvider: true });
    await waitForProviderConfigPolling();

    await runSubagentScenario({
      childMarker: GENERAL_CHILD_MARKER,
      childReplyToken: GENERAL_CHILD_REPLY_TOKEN,
      effort: GENERAL_EFFORT,
      finalToken: GENERAL_FINAL_TOKEN,
      parentMarker: GENERAL_PARENT_MARKER,
      subagentType: "general-purpose",
    });
    await assertInitialChildModelMarker("live");

    const sessionId = (await getV4PaneSnapshot()).sessionId;
    if (!sessionId || sessionId === "draft") {
      throw new Error(`Built-in subagent Model case 没有真实 sessionId: ${sessionId ?? "null"}`);
    }
    await reloadAppAndRestoreV4Session(sessionId);
    await assertInitialChildModelMarker("cold");

    const exploreChildRecord = await runSubagentScenario({
      childMarker: EXPLORE_CHILD_MARKER,
      childReplyToken: EXPLORE_CHILD_REPLY_TOKEN,
      effort: EXPLORE_EFFORT,
      finalToken: EXPLORE_FINAL_TOKEN,
      parentMarker: EXPLORE_PARENT_MARKER,
      subagentType: "Explore",
    });

    expect(readToolNamesFromCapture(exploreChildRecord.requestJson)).toEqual([
      "Bash",
      "Read",
      "TodoWrite",
      "WebFetch",
      "RespondToCoordinator",
    ]);

    await runSubagentScenario({
      childMarker: CUSTOM_CHILD_MARKER,
      childReplyToken: CUSTOM_CHILD_REPLY_TOKEN,
      effort: CUSTOM_EFFORT,
      finalToken: CUSTOM_FINAL_TOKEN,
      parentMarker: CUSTOM_PARENT_MARKER,
      subagentType: CUSTOM_AGENT_NAME,
    });
  });
});

async function configureSubagentReasoningOverrides() {
  expect(await readAgentsState()).toMatchObject({
    builtInModelSelectionOverrides: {
      Explore: {
        providerId: UPSTREAM_ALTERNATE_PROVIDER_ID,
        modelId: UPSTREAM_ALTERNATE_MODEL,
        options: { reasoningLevel: INVALID_EFFORT },
      },
      "general-purpose": {
        providerId: UPSTREAM_PROVIDER_ID,
        modelId: UPSTREAM_MODEL,
      },
    },
  });
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
    timeout: 15000,
    timeoutMsg: "Could not find settings entry button",
  });
  await waitForTestIdByDom(TID_SETTINGS_PAGE, {
    timeout: 15000,
    timeoutMsg: "设置页没有渲染",
  });
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "subagents"), {
    timeout: 15000,
    timeoutMsg: "设置页没有出现 subagents 分区入口",
  });
  await waitForTestIdByDom(testId(TID_SUBAGENT_ROW, "general-purpose"));
  await waitForTestIdByDom(testId(TID_SUBAGENT_ROW, "Explore"));
  await waitForTestIdByDom(testId(TID_SUBAGENT_BUILT_IN_MODEL_TRIGGER, "general-purpose"));
  await waitForTestIdByDom(testId(TID_SUBAGENT_BUILT_IN_MODEL_TRIGGER, "Explore"));
  await waitForTestIdByDom(testId(TID_SUBAGENT_ROW, CUSTOM_AGENT_NAME));

  await expectBuiltInModelValues({
    Explore: OVERRIDE_MODEL_VALUE,
    "general-purpose": PRIMARY_MODEL_VALUE,
  });
  await waitForExploreInvalidEffortError(
    "Select a reasoning effort supported by this model",
    "英文",
  );
  await setRendererLocale("zh-CN");
  await waitForExploreInvalidEffortError("请选择当前模型支持的推理档位", "中文");
  await setRendererLocale("en-US");
  await waitForExploreInvalidEffortError(
    "Select a reasoning effort supported by this model",
    "Restore English",
  );

  await selectThoughtLevelInScope(sel(testId(TID_SUBAGENT_ROW, "Explore")), EXPLORE_EFFORT);
  await waitForAgentsState(
    (state) => readBuiltInReasoningLevel(state, "Explore") === EXPLORE_EFFORT,
    "Explore valid effort was not written to agents-state.json",
  );

  await selectModelInScope(sel(testId(TID_SUBAGENT_ROW, "general-purpose")), OVERRIDE_MODEL_VALUE);
  await waitForAgentsState(
    (state) =>
      readBuiltInModelValue(state, "general-purpose") === OVERRIDE_MODEL_VALUE &&
      readBuiltInReasoningLevel(state, "general-purpose") === "max",
    "general-purpose did not use target highest effort after actively switching models",
  );
  await selectThoughtLevelInScope(sel(testId(TID_SUBAGENT_ROW, "general-purpose")), GENERAL_EFFORT);
  await waitForAgentsState(
    (state) => readBuiltInReasoningLevel(state, "general-purpose") === GENERAL_EFFORT,
    "general-purpose effort 没有写入 agents-state.json",
  );

  expect(await readAgentsState()).toMatchObject({
    builtInModelSelectionOverrides: {
      Explore: {
        providerId: UPSTREAM_ALTERNATE_PROVIDER_ID,
        modelId: UPSTREAM_ALTERNATE_MODEL,
        options: { reasoningLevel: EXPLORE_EFFORT },
      },
      "general-purpose": {
        providerId: UPSTREAM_ALTERNATE_PROVIDER_ID,
        modelId: UPSTREAM_ALTERNATE_MODEL,
        options: { reasoningLevel: GENERAL_EFFORT },
      },
    },
  });

  await configureCustomSubagentReasoningOverride();
  await assertSettingsLayoutAcrossThemes();

  await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
    timeout: 15000,
    timeoutMsg: "设置页返回按钮没有出现",
  });
  await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30000);
}

async function setRendererLocale(locale: "en-US" | "zh-CN") {
  const changed = await browser.execute((nextLocale) => {
    const actions = (
      window as typeof window & {
        __testActions?: Record<string, unknown>;
      }
    ).__testActions;
    const setLocale = actions?.setLocale;
    if (typeof setLocale !== "function") return false;
    (setLocale as (value: string) => void)(nextLocale);
    return true;
  }, locale);
  if (!changed) {
    throw new Error(`I20 Missing renderer locale test action: ${locale}`);
  }
  await browser.waitUntil(
    async () =>
      browser.execute((expectedLocale) => {
        const actions = (
          window as typeof window & {
            __testActions?: Record<string, unknown>;
          }
        ).__testActions;
        const getLocale = actions?.getLocale;
        return typeof getLocale === "function" && getLocale() === expectedLocale;
      }, locale),
    {
      timeout: 15_000,
      timeoutMsg: `I20 renderer locale 没有切换到 ${locale}`,
    },
  );
}

async function waitForExploreInvalidEffortError(expectedText: string, localeLabel: string) {
  await browser.waitUntil(
    async () =>
      (await $(sel(testId(TID_SUBAGENT_ROW, "Explore"))).getText()).includes(expectedText),
    {
      timeout: 15_000,
      timeoutMsg: `workspace catalog 就绪后 Explore 没有Show${localeLabel}无效 effort Error`,
    },
  );
}

async function configureCustomSubagentReasoningOverride() {
  const initialMarkdown = await readFile(CUSTOM_AGENT_PATH, "utf8");
  expect(initialMarkdown).toContain(`model: ${OVERRIDE_MODEL_VALUE}`);
  expect(initialMarkdown).toContain(`thoughtLevel: ${INVALID_EFFORT}`);

  await openCustomAgentForm();
  const form = $(SUBAGENT_FORM_SELECTOR);
  expect(await form.getText()).toMatch(
    /Select a reasoning effort supported by this model|Please select a reasoning effort supported by the current model/u,
  );
  expect(await form.$('button[type="submit"]').isEnabled()).toBe(false);
  expect(await form.isDisplayed()).toBe(true);
  expect(await readFile(CUSTOM_AGENT_PATH, "utf8")).toBe(initialMarkdown);

  await selectThoughtLevelInScope(SUBAGENT_FORM_SELECTOR, EXPLORE_EFFORT);
  await saveCustomAgentForm();
  await waitForCustomMarkdown((content) => {
    const selection = readCustomAgentSelection(content);
    return selection?.model === OVERRIDE_MODEL_VALUE && selection.reasoningLevel === EXPLORE_EFFORT;
  }, "custom valid effort was not written to Markdown");

  await openCustomAgentForm();
  await selectModelInScope(SUBAGENT_FORM_SELECTOR, PRIMARY_MODEL_VALUE);
  await assertThoughtOptionsAndSelectInScope(
    SUBAGENT_FORM_SELECTOR,
    ["off", "low", "high", "max"],
    [],
    "high",
  );
  await saveCustomAgentForm();
  const defaultEffortMarkdown = await waitForCustomMarkdown((content) => {
    const selection = readCustomAgentSelection(content);
    return selection?.model === PRIMARY_MODEL_VALUE && selection.reasoningLevel === "high";
  }, "custom did not write to Markdown after reconfirming default effort");
  expect(defaultEffortMarkdown).toContain("thoughtLevel: high");
  expect(defaultEffortMarkdown).not.toContain("modelSelection:");

  await openCustomAgentForm();
  await selectModelInScope(SUBAGENT_FORM_SELECTOR, OVERRIDE_MODEL_VALUE);
  await assertThoughtOptionsAndSelectInScope(
    SUBAGENT_FORM_SELECTOR,
    ["off", "low", "high", "max"],
    [],
    CUSTOM_EFFORT,
  );
  await saveCustomAgentForm();
  const finalMarkdown = await waitForCustomMarkdown((content) => {
    const selection = readCustomAgentSelection(content);
    return selection?.model === OVERRIDE_MODEL_VALUE && selection.reasoningLevel === CUSTOM_EFFORT;
  }, "custom final model + effort was not written to Markdown");
  expect(finalMarkdown).toContain(`thoughtLevel: ${CUSTOM_EFFORT}`);
  expect(finalMarkdown).not.toContain("modelSelection:");
}

async function openCustomAgentForm() {
  const rowTestId = testId(TID_SUBAGENT_ROW, CUSTOM_AGENT_NAME);
  await browser.waitUntil(
    async () =>
      browser.execute((currentRowTestId) => {
        const row = document.querySelector<HTMLElement>(`[data-testid="${currentRowTestId}"]`);
        if (!row || row.getAttribute("role") !== "button") return false;
        row.click();
        return true;
      }, rowTestId),
    { timeout: 15000, timeoutMsg: "custom subagent row is not editable" },
  );
  await $(SUBAGENT_FORM_SELECTOR).waitForDisplayed({
    timeout: 15000,
    timeoutMsg: "custom subagent edit form did not open",
  });
}

async function saveCustomAgentForm() {
  await $(SUBAGENT_FORM_SELECTOR).$('button[type="submit"]').click();
  await browser.waitUntil(async () => !(await $(SUBAGENT_FORM_SELECTOR).isExisting()), {
    timeout: 15000,
    timeoutMsg: "custom subagent form did not close after saving",
  });
  await waitForTestIdByDom(testId(TID_SUBAGENT_ROW, CUSTOM_AGENT_NAME));
}

async function selectModelInScope(scope: string, model: string) {
  const decodedModel = decodeCustomModelValue(model);
  if (!decodedModel) {
    throw new Error(`E2E 仅支持选择 custom provider Model: ${model}`);
  }
  const itemTestId = testId(TID_CHAT_MODEL_SELECT_ITEM, model);
  const groupTestId = testId(
    TID_CHAT_MODEL_SELECT_GROUP,
    `registry-provider:${decodedModel.providerId}`,
  );
  const trigger = $(scope).$(sel(TID_CHAT_MODEL_SELECT_TRIGGER));
  await trigger.waitForClickable({ timeout: 15000 });
  await trigger.click();
  try {
    await browser.waitUntil(
      () =>
        browser.execute(
          (currentItemTestId, currentGroupTestId) =>
            Boolean(
              document.querySelector(`[data-testid="${currentItemTestId}"]`) ||
              document.querySelector(`[data-testid="${currentGroupTestId}"]`),
            ),
          itemTestId,
          groupTestId,
        ),
      { timeout: 15000, timeoutMsg: `Model菜单没有出现 ${model}` },
    );
  } catch (error) {
    const candidates = await browser.execute(
      (itemPrefix, groupPrefix) =>
        Array.from(document.querySelectorAll<HTMLElement>("[data-testid]"))
          .filter((element) => {
            const value = element.dataset.testid ?? "";
            return value.startsWith(itemPrefix) || value.startsWith(groupPrefix);
          })
          .map((element) => ({
            testId: element.dataset.testid ?? "",
            text: element.innerText.replace(/\s+/gu, " ").trim(),
          })),
      testId(TID_CHAT_MODEL_SELECT_ITEM, ""),
      testId(TID_CHAT_MODEL_SELECT_GROUP, ""),
    );
    throw new Error(`Model菜单没有出现 ${model}，Current候选: ${JSON.stringify(candidates)}`, {
      cause: error,
    });
  }
  const itemVisible = await browser.execute(
    (currentItemTestId) => Boolean(document.querySelector(`[data-testid="${currentItemTestId}"]`)),
    itemTestId,
  );
  if (!itemVisible) {
    await browser.execute((currentGroupTestId) => {
      const group = document.querySelector<HTMLElement>(`[data-testid="${currentGroupTestId}"]`);
      if (!group) {
        return;
      }
      group.focus();
      for (const eventName of ["pointerenter", "mouseenter", "mousemove"] as const) {
        group.dispatchEvent(
          new MouseEvent(eventName, {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );
      }
      group.click();
    }, groupTestId);
  }
  await browser.waitUntil(
    () =>
      browser.execute(
        (currentItemTestId) =>
          Boolean(document.querySelector(`[data-testid="${currentItemTestId}"]`)),
        itemTestId,
      ),
    { timeout: 15000, timeoutMsg: `Model菜单没有出现 ${model}` },
  );
  await browser.execute((currentItemTestId) => {
    document.querySelector<HTMLElement>(`[data-testid="${currentItemTestId}"]`)?.click();
  }, itemTestId);
  await browser.waitUntil(
    async () => (await trigger.getAttribute("data-model-current-value")) === model,
    { timeout: 15000, timeoutMsg: `Model控件没有切换到 ${model}` },
  );
}

async function selectThoughtLevelInScope(scope: string, thoughtLevel: string) {
  let selected = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const trigger = $(scope).$(sel(TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER));
    await trigger.waitForClickable({
      timeout: 15000,
      timeoutMsg: `reasoning effort 控件没有出现: ${scope}`,
    });
    await trigger.click();
    try {
      const item = $(sel(testId(TID_CHAT_THOUGHT_LEVEL_SELECT_ITEM, thoughtLevel)));
      await item.waitForClickable({ timeout: 3000 });
      await item.click();
      selected = true;
      break;
    } catch {
      await browser.keys("Escape");
    }
  }
  if (!selected) {
    throw new Error(`reasoning effort 菜单没有出现 ${thoughtLevel}`);
  }
  const expectedLabels: Record<string, string[]> = {
    high: ["高", "High"],
    low: ["低", "Low"],
    max: ["最高", "Highest"],
  };
  await browser.waitUntil(
    async () => {
      const currentTrigger = $(scope).$(sel(TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER));
      const label = await currentTrigger.getAttribute("aria-label");
      return (expectedLabels[thoughtLevel] ?? [thoughtLevel]).includes(label ?? "");
    },
    {
      timeout: 15000,
      timeoutMsg: `reasoning effort 控件没有切换到 ${thoughtLevel}`,
    },
  );
}

async function assertThoughtOptionsAndSelectInScope(
  scope: string,
  expected: string[],
  excluded: string[],
  thoughtLevel: string,
) {
  const trigger = $(scope).$(sel(TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER));
  await trigger.waitForClickable({ timeout: 15000 });
  await trigger.click();
  for (const level of expected) {
    await $(sel(testId(TID_CHAT_THOUGHT_LEVEL_SELECT_ITEM, level))).waitForDisplayed({
      timeout: 15000,
      timeoutMsg: `TargetModel没有展示 reasoning effort ${level}`,
    });
  }
  for (const level of excluded) {
    expect(await $(sel(testId(TID_CHAT_THOUGHT_LEVEL_SELECT_ITEM, level))).isExisting()).toBe(
      false,
    );
  }
  const item = $(sel(testId(TID_CHAT_THOUGHT_LEVEL_SELECT_ITEM, thoughtLevel)));
  await item.waitForClickable({ timeout: 15000 });
  await item.click();
}

async function expectBuiltInModelValues(expected: Record<string, string>) {
  const values = await browser.execute(
    (entries, triggerPrefix) =>
      Object.fromEntries(
        entries.map(([name]) => {
          const element = document.querySelector<HTMLElement>(
            `[data-testid="${triggerPrefix}-${name}"]`,
          );
          return [name, element?.dataset.modelCurrentValue ?? null];
        }),
      ),
    Object.entries(expected),
    TID_SUBAGENT_BUILT_IN_MODEL_TRIGGER,
  );
  expect(values).toEqual(expected);
}

async function waitForAgentsState(
  predicate: (state: Record<string, unknown>) => boolean,
  timeoutMsg: string,
) {
  await browser.waitUntil(async () => predicate(await readAgentsState()), {
    timeout: 15000,
    timeoutMsg,
  });
}

function readBuiltInSelection(state: Record<string, unknown>, agentName: string) {
  const map = state.builtInModelSelectionOverrides;
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    return null;
  }
  const value = (map as Record<string, unknown>)[agentName];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readBuiltInModelValue(state: Record<string, unknown>, agentName: string) {
  const selection = readBuiltInSelection(state, agentName);
  return typeof selection?.providerId === "string" && typeof selection.modelId === "string"
    ? encodeCustomModelValue(selection.providerId, selection.modelId)
    : null;
}

function readBuiltInReasoningLevel(state: Record<string, unknown>, agentName: string) {
  const options = readBuiltInSelection(state, agentName)?.options;
  if (!options || typeof options !== "object" || Array.isArray(options)) return null;
  const reasoningLevel = (options as Record<string, unknown>).reasoningLevel;
  return typeof reasoningLevel === "string" ? reasoningLevel : null;
}

async function waitForCustomMarkdown(predicate: (content: string) => boolean, timeoutMsg: string) {
  let latest = "";
  await browser.waitUntil(
    async () => {
      latest = await readFile(CUSTOM_AGENT_PATH, "utf8");
      return predicate(latest);
    },
    { timeout: 15000, timeoutMsg },
  );
  return latest;
}

function parseCustomAgentFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match?.[1]) {
    return {};
  }
  const parsed = parseYaml(match[1]) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function readCustomAgentSelection(content: string) {
  const frontmatter = parseCustomAgentFrontmatter(content);
  const value = frontmatter.model;
  if (typeof value !== "string") return null;
  const separator = value.indexOf("/");
  const decoded = decodeCustomModelValue(value);
  const providerId = decoded?.providerId ?? value.slice(0, separator);
  const modelId = decoded?.modelName ?? value.slice(separator + 1);
  if (!providerId || !modelId) return null;
  return {
    model: encodeCustomModelValue(providerId, modelId),
    reasoningLevel:
      typeof frontmatter.thoughtLevel === "string" ? frontmatter.thoughtLevel : undefined,
  };
}

async function assertSettingsLayoutAcrossThemes() {
  await assertSubagentControlRowsFit();
  try {
    await setRendererViewport(390, 844);
    for (const theme of ["cf-light", "cf-dark"] as const) {
      await setSettingsTheme(theme);
      await assertSubagentControlRowsFit();
    }
  } finally {
    await clearRendererViewport();
  }
}

async function assertSubagentControlRowsFit() {
  const result = await browser.execute(
    (rowPrefix, modelPrefix, thoughtTrigger, names) =>
      names.map((name) => {
        const row = document.querySelector<HTMLElement>(`[data-testid="${rowPrefix}-${name}"]`);
        const model = row?.querySelector<HTMLElement>(`[data-testid="${modelPrefix}-${name}"]`);
        const thought = row?.querySelector<HTMLElement>(`[data-testid="${thoughtTrigger}"]`);
        const modelRect = model?.getBoundingClientRect();
        const thoughtRect = thought?.getBoundingClientRect();
        const overlaps = Boolean(
          modelRect &&
          thoughtRect &&
          modelRect.left < thoughtRect.right &&
          modelRect.right > thoughtRect.left &&
          modelRect.top < thoughtRect.bottom &&
          modelRect.bottom > thoughtRect.top,
        );
        return {
          hasModel: Boolean(modelRect),
          hasThought: Boolean(thoughtRect),
          horizontalOverflow: Boolean(row && row.scrollWidth > row.clientWidth + 1),
          name,
          overlaps,
        };
      }),
    TID_SUBAGENT_ROW,
    TID_SUBAGENT_BUILT_IN_MODEL_TRIGGER,
    TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER,
    ["general-purpose", "Explore"],
  );
  expect(result).toEqual([
    {
      hasModel: true,
      hasThought: true,
      horizontalOverflow: false,
      name: "general-purpose",
      overlaps: false,
    },
    {
      hasModel: true,
      hasThought: true,
      horizontalOverflow: false,
      name: "Explore",
      overlaps: false,
    },
  ]);
}

async function setSettingsTheme(theme: "cf-light" | "cf-dark") {
  const changed = await browser.execute((nextTheme) => {
    const actions = (window as typeof window & { __testActions?: Record<string, unknown> })
      .__testActions;
    const setTheme = actions?.setTheme;
    if (typeof setTheme !== "function") {
      return false;
    }
    (setTheme as (value: string) => void)(nextTheme);
    return true;
  }, theme);
  expect(changed).toBe(true);
  await browser.pause(100);
}

async function setRendererViewport(width: number, height: number) {
  await sendRendererEmulationCommand("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height,
    mobile: false,
    width,
  });
  await browser.waitUntil(
    async () => browser.execute((expectedWidth) => window.innerWidth === expectedWidth, width),
    { timeout: 10000, timeoutMsg: `renderer viewport 没有收敛到 ${width}px` },
  );
}

async function clearRendererViewport() {
  await sendRendererEmulationCommand("Emulation.clearDeviceMetricsOverride");
}

async function sendRendererEmulationCommand(method: string, params: Record<string, unknown> = {}) {
  const sent = await browser.electron.execute(
    async (electron, command, commandParams) => {
      const window = electron.BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.isDestroyed() && candidate.isVisible(),
      );
      if (!window) return false;
      const devtools = window.webContents.debugger;
      if (!devtools.isAttached()) devtools.attach("1.3");
      await devtools.sendCommand(command, commandParams);
      return true;
    },
    method,
    params,
  );
  expect(sent).toBe(true);
}

async function assertInitialChildModelMarker(stage: "cold" | "live") {
  const agentBlock = await waitForToolCallBlockByToolName("Agent", 30000);
  const sidePaneAction = await $(`[data-testid="${agentBlock.testId}"]`).$(
    `[data-testid^="${TID_V4_SUBAGENT_OPEN_SIDE_PANE}-"]`,
  );
  await sidePaneAction.waitForDisplayed({
    timeout: 15000,
    timeoutMsg: `${stage} child 没有Right侧Session入口`,
  });
  const actionTestId = await sidePaneAction.getAttribute("data-testid");
  const childSessionId = actionTestId?.slice(`${TID_V4_SUBAGENT_OPEN_SIDE_PANE}-`.length);
  if (!actionTestId || !childSessionId) {
    throw new Error(`${stage} child Session入口Missing session id`);
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await browser.execute(
      (blockTestId, actionId) => {
        document
          .querySelector<HTMLElement>(`[data-testid="${blockTestId}"] [data-testid="${actionId}"]`)
          ?.click();
      },
      agentBlock.testId,
      actionTestId,
    );
    try {
      await browser.waitUntil(
        () =>
          browser.execute(
            (expectedChildSessionId) =>
              Array.from(
                document.querySelectorAll<HTMLElement>(
                  `[data-session-id="${expectedChildSessionId}"]`,
                ),
              ).some((pane) => pane.offsetParent !== null),
            childSessionId,
          ),
        {
          timeout: 10000,
          timeoutMsg: `${stage} child conversation 没有在Right侧面板打开`,
        },
      );
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }

  const expectedZh = `In progress使用 ${UPSTREAM_ALTERNATE_PROVIDER_NAME}/${UPSTREAM_ALTERNATE_MODEL}`;
  const expectedEn = `Using ${UPSTREAM_ALTERNATE_PROVIDER_NAME}/${UPSTREAM_ALTERNATE_MODEL}`;
  await browser.execute((expectedChildSessionId) => {
    const pane = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-session-id="${expectedChildSessionId}"]`),
    ).find((candidate) => candidate.offsetParent !== null);
    pane?.querySelector<HTMLElement>('[data-v4-timeline-scroll="true"]')?.scrollTo({ top: 0 });
  }, childSessionId);
  try {
    await browser.waitUntil(
      async () => {
        const markers = await readVisibleModelMarkers();
        return markers.some(
          (marker) =>
            (marker.text === expectedZh || marker.text === expectedEn) && !marker.hasSwitchArrow,
        );
      },
      {
        timeout: 30000,
        timeoutMsg: `${stage} child 没有以无切换箭头的精简Copy展示初始Model ${UPSTREAM_ALTERNATE_MODEL}`,
      },
    );
  } catch (error) {
    const markers = await readVisibleModelMarkers();
    throw new Error(`${String(error)}; visibleModelMarkers=${JSON.stringify(markers)}`);
  }
}

async function readVisibleModelMarkers() {
  return browser.execute(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-marker-type="modelChange"]')).map(
      (marker) => ({
        hasSwitchArrow: marker.querySelector(".lucide-arrow-right-left") !== null,
        sessionId: marker.closest<HTMLElement>("[data-session-id]")?.dataset.sessionId ?? null,
        text: (marker.innerText ?? "").trim(),
      }),
    ),
  );
}

async function reloadAppAndRestoreV4Session(sessionId: string) {
  await reloadElectronSessionSafely(browser);
  await waitForWorkspaceApp(DEFAULT_WORKSPACE, 60000);
  await selectV4TaskById(sessionId);
  await waitForV4Pane(
    (snapshot) => snapshot.sessionId === sessionId,
    `CLI cold restart 后没有恢复 session ${sessionId}`,
    60000,
  );
}

async function runSubagentScenario(input: {
  childMarker: string;
  childReplyToken: string;
  effort: string;
  finalToken: string;
  parentMarker: string;
  subagentType: string;
}) {
  const marker = `${input.parentMarker}_${Date.now()}`;
  const prompt =
    `${marker}: Use the Agent tool with subagent_type "${input.subagentType}". ` +
    `Ask it to reply with exactly "${input.childReplyToken}". ` +
    `After the subagent returns, reply with exactly "${input.finalToken}" and no other text.`;

  await sendV4PromptAndWaitAccepted(
    prompt,
    marker,
    `${input.subagentType} Initial turn没有被 composer 接受`,
  );

  const childRecord = await waitForChildSubagentRequestCapture(input.childMarker);
  assertUpstreamRequestCapture(childRecord, {
    expectedText: input.childMarker,
    model: UPSTREAM_ALTERNATE_MODEL,
  });
  assertUpstreamThoughtLevelCapture(childRecord, input.effort);

  const parentContinuationRecord = await waitForParentContinuationRequestCapture(
    input.childReplyToken,
  );
  assertUpstreamRequestCapture(parentContinuationRecord, {
    expectedText: input.childReplyToken,
    model: UPSTREAM_MODEL,
  });
  assertUpstreamThoughtLevelCapture(parentContinuationRecord, PARENT_EFFORT);

  await waitForV4AssistantMessageContaining(input.finalToken);
  await waitForV4ConversationState(
    (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
    `${input.subagentType} Model覆盖 case Completed后没有回到 idle`,
    90000,
  );

  const agentBlock = await waitForToolCallBlockByToolName("Agent");
  expect(agentBlock.status).toBe("completed");
  return childRecord;
}

async function waitForChildSubagentRequestCapture(childMarker: string) {
  let latestArtifact: E2ENetworkCaptureArtifact | null = null;
  try {
    await browser.waitUntil(
      async () => {
        latestArtifact = await readCaptureArtifact();
        return Boolean(findChildSubagentRequest(latestArtifact, childMarker));
      },
      {
        timeout: 30000,
        timeoutMsg: `没有捕获到Built-in subagent child Request: ${childMarker}`,
      },
    );
  } catch (error) {
    throw new Error(
      `没有捕获到Built-in subagent child Request\n${JSON.stringify(
        summarizeRequestsContaining(latestArtifact, childMarker),
        null,
        2,
      )}`,
      { cause: error },
    );
  }

  const record = findChildSubagentRequest(latestArtifact, childMarker);
  if (!record) {
    throw new Error("Built-in subagent child request still does not exist after waiting for completion");
  }
  return record;
}

async function waitForParentContinuationRequestCapture(childReplyToken: string) {
  let latestArtifact: E2ENetworkCaptureArtifact | null = null;
  try {
    await browser.waitUntil(
      async () => {
        latestArtifact = await readCaptureArtifact();
        return Boolean(findParentContinuationRequest(latestArtifact, childReplyToken));
      },
      {
        timeout: 30000,
        timeoutMsg: `没有捕获到 parent continuation Request: ${childReplyToken}`,
      },
    );
  } catch (error) {
    throw new Error(
      `没有捕获到 parent continuation Request\n${JSON.stringify(
        summarizeRequestsContaining(latestArtifact, childReplyToken),
        null,
        2,
      )}`,
      { cause: error },
    );
  }

  const record = findParentContinuationRequest(latestArtifact, childReplyToken);
  if (!record) {
    throw new Error("parent continuation request still does not exist after waiting for completion");
  }
  return record;
}

async function readCaptureArtifact(): Promise<E2ENetworkCaptureArtifact | null> {
  const capturePath = process.env.E2E_PROVIDER_CAPTURE_PATH?.trim();
  if (!capturePath) {
    return null;
  }
  try {
    return JSON.parse(await readFile(capturePath, "utf-8")) as E2ENetworkCaptureArtifact;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function findChildSubagentRequest(artifact: E2ENetworkCaptureArtifact | null, childMarker: string) {
  return (
    artifact?.records.find(
      (record) =>
        isUpstreamMessageRequest(record) &&
        record.status === "complete" &&
        captureContainsText(record.requestJson, childMarker) &&
        readModelFromCapture(record.requestJson) === UPSTREAM_ALTERNATE_MODEL,
    ) ?? null
  );
}

function findParentContinuationRequest(
  artifact: E2ENetworkCaptureArtifact | null,
  childReplyToken: string,
) {
  return (
    artifact?.records.findLast(
      (record) =>
        isUpstreamMessageRequest(record) &&
        record.status === "complete" &&
        latestUserToolResultContainsText(record.requestJson, childReplyToken) &&
        readModelFromCapture(record.requestJson) === UPSTREAM_MODEL,
    ) ?? null
  );
}

function latestUserToolResultContainsText(requestJson: unknown, expectedText: string) {
  if (!requestJson || typeof requestJson !== "object") {
    return false;
  }
  const messages = (requestJson as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) {
    return false;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") {
      continue;
    }
    if ((message as { role?: unknown }).role !== "user") {
      continue;
    }
    const content = (message as { content?: unknown }).content;
    return (
      Array.isArray(content) &&
      content.some(
        (part) =>
          part !== null &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "tool_result" &&
          captureContainsText(part, expectedText),
      )
    );
  }
  return false;
}

function summarizeRequestsContaining(
  artifact: E2ENetworkCaptureArtifact | null,
  expectedText: string,
) {
  return {
    records:
      artifact?.records
        .filter((record) => captureContainsText(record.requestJson, expectedText))
        .map((record) => ({
          model: readModelFromCapture(record.requestJson),
          path: record.path,
          status: record.status,
          statusCode: record.statusCode,
          tools: readToolNamesFromCapture(record.requestJson),
        })) ?? [],
  };
}

function isUpstreamMessageRequest(record: E2ENetworkCaptureRecord) {
  return (
    record.method === "POST" &&
    (record.path.includes("/messages") || record.path.includes("/chat/completions"))
  );
}

function readModelFromCapture(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const model = (value as { model?: unknown }).model;
  return typeof model === "string" ? model : null;
}

function readToolNamesFromCapture(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const tools = (value as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) {
    return [];
  }
  return tools
    .map((tool) => {
      if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
        return null;
      }
      const name = (tool as { name?: unknown }).name;
      return typeof name === "string" ? name : null;
    })
    .filter((name): name is string => Boolean(name));
}

function captureContainsText(value: unknown, expected: string): boolean {
  if (typeof value === "string") {
    return value.includes(expected);
  }
  if (Array.isArray(value)) {
    return value.some((item) => captureContainsText(item, expected));
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.values(value).some((child) => captureContainsText(child, expected));
}
