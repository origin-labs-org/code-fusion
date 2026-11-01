import { skipOccupationOnboardingIfPresent } from "../helpers/occupation-onboarding.js";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  clearAppData,
  getE2EAppDataPaths,
  setInputValueByTestIdDom,
} from "../helpers/desktop-app.js";
import {
  UPSTREAM_PROVIDER_ID,
  UPSTREAM_MODEL,
  UPSTREAM_SECONDARY_MODEL,
  UPSTREAM_ALTERNATE_PROVIDER_ID,
  UPSTREAM_ALTERNATE_MODEL,
} from "../helpers/upstream-provider.js";
import {
  TID_CHAT_MODE_SELECT_TRIGGER,
  TID_CHAT_MODEL_SELECT_TRIGGER,
  TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER,
  TID_V4_COMPOSER_INPUT,
  TID_V4_MODEL_CONFIG,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_BACK_BUTTON,
} from "@origin-ai/cf-shared/test-ids";
import {
  clickV4SlashOption,
  getV4ComposerText,
  getV4ConfigProjection,
  getV4ModelConfig,
  getV4PaneSnapshot,
  getV4SlashOptionIds,
  hasV4SlashPanel,
  prepareV4ConversationE2E,
  sendV4Prompt,
  selectV4TaskById,
  startNewV4Draft,
  switchV4Mode,
  switchV4Model,
  waitForV4Pane,
  waitForV4SlashOption,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

import { seedPersonalProviderConfig } from "../helpers/model-provider-restart-config.js";
import { waitForProviderConfigPolling } from "../helpers/provider-config-polling.js";

const CUSTOM_SLASH_COMMAND_NAME = "e2e-draft-catalog";
const CUSTOM_SLASH_OPTION_ID = `slash:${CUSTOM_SLASH_COMMAND_NAME}`;
const CUSTOM_SLASH_COMMAND_DIR = join(getE2EAppDataPaths().homeDir, ".cf", "commands");
const CUSTOM_SLASH_COMMAND_PATH = join(CUSTOM_SLASH_COMMAND_DIR, `${CUSTOM_SLASH_COMMAND_NAME}.md`);
const COMPOSER_PICKER_TRIGGER_IDS = {
  mode: TID_CHAT_MODE_SELECT_TRIGGER,
  model: TID_CHAT_MODEL_SELECT_TRIGGER,
} as const;

type ComposerPicker = keyof typeof COMPOSER_PICKER_TRIGGER_IDS;

async function openComposerPicker(picker: ComposerPicker) {
  const trigger = $(`[data-testid="${COMPOSER_PICKER_TRIGGER_IDS[picker]}"]`);
  await trigger.waitForClickable({ timeout: 30000 });
  await trigger.click();
}

async function waitForOnlyComposerPickerOpen(picker: ComposerPicker, transition: string) {
  let latest: unknown = null;
  await browser.waitUntil(
    async () => {
      latest = await browser.execute((triggerIds) => {
        const expanded = Object.fromEntries(
          Object.entries(triggerIds).map(([key, testId]) => [
            key,
            document
              .querySelector<HTMLElement>(`[data-testid="${testId}"]`)
              ?.getAttribute("aria-expanded") ?? null,
          ]),
        );
        return {
          expanded,
          listboxes: document.querySelectorAll('[role="listbox"]').length,
          menus: document.querySelectorAll('[role="menu"]').length,
        };
      }, COMPOSER_PICKER_TRIGGER_IDS);
      const state = latest as {
        expanded: Record<ComposerPicker, string | null>;
        listboxes: number;
        menus: number;
      };
      const expectedListboxes = 0;
      const expectedMenus = 1;
      return (
        state.expanded[picker] === "true" &&
        Object.entries(state.expanded).every(
          ([key, value]) => key === picker || value !== "true",
        ) &&
        state.listboxes === expectedListboxes &&
        state.menus === expectedMenus
      );
    },
    {
      timeout: 5000,
      timeoutMsg: `${transition} 后没有只RetainTarget picker；latest=${JSON.stringify(latest)}`,
    },
  );
}

async function waitForNoComposerPickerOpen(transition: string) {
  let latest: unknown = null;
  await browser.waitUntil(
    async () => {
      latest = await browser.execute(
        (triggerIds) => ({
          expanded: Object.fromEntries(
            Object.entries(triggerIds).map(([key, testId]) => [
              key,
              document
                .querySelector<HTMLElement>(`[data-testid="${testId}"]`)
                ?.getAttribute("aria-expanded") ?? null,
            ]),
          ),
          listboxes: document.querySelectorAll('[role="listbox"]').length,
          menus: document.querySelectorAll('[role="menu"]').length,
        }),
        COMPOSER_PICKER_TRIGGER_IDS,
      );
      const state = latest as {
        expanded: Record<ComposerPicker, string | null>;
        listboxes: number;
        menus: number;
      };
      return (
        Object.values(state.expanded).every((value) => value !== "true") &&
        state.listboxes === 0 &&
        state.menus === 0
      );
    },
    {
      timeout: 5000,
      timeoutMsg: `${transition} 后 composer picker 没有AllClose；latest=${JSON.stringify(latest)}`,
    },
  );
}

async function closeComposerPicker() {
  await browser.keys("Escape");
  await waitForNoComposerPickerOpen("Escape");
}

describe("v4 M5 gate: composer toolbar and slash candidates panel", () => {
  let completedTaskId: string | null = null;
  let customSlashHydratedInDraft = false;

  async function ensureCompletedTask() {
    if (completedTaskId) {
      return completedTaskId;
    }
    await prepareV4ConversationE2E();
    await sendV4Prompt("E2E_V4_COMPOSER_TOOLBAR_SEED 建立会话");
    await waitForV4TimelineContaining("V4_COMPOSER_TOOLBAR_SEED_OK", 45000);
    await waitForV4Pane(
      (s) => !s.canStop && s.sessionId !== "draft" && s.sessionId !== null,
      "Did not return to idle state after first turn",
      45000,
    );
    completedTaskId = (await getV4PaneSnapshot()).sessionId;
    if (!completedTaskId || completedTaskId === "draft") {
      throw new Error("Composer toolbar did not leave a reopenable completed task after first turn");
    }
    return completedTaskId;
  }

  async function ensureCustomSlashHydratedInDraft() {
    if (customSlashHydratedInDraft) {
      return;
    }
    await startNewV4Draft();
    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "/", {
      timeout: 15000,
      timeoutMsg: "v4 composer input box did not appear or is not editable after task → draft",
    });
    await waitForV4SlashOption(CUSTOM_SLASH_OPTION_ID);
    expect(await getV4SlashOptionIds()).toContain(CUSTOM_SLASH_OPTION_ID);
    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "", {
      timeout: 15000,
      timeoutMsg: "Composer was not cleared after task → draft slash regression assertion",
    });
    customSlashHydratedInDraft = true;
  }

  before(async () => {
    await skipOccupationOnboardingIfPresent();
    await mkdir(CUSTOM_SLASH_COMMAND_DIR, { recursive: true });
    await writeFile(
      CUSTOM_SLASH_COMMAND_PATH,
      [
        "---",
        "description: E2E task-to-draft slash catalog rehydration",
        "argument-hint: [scope]",
        "---",
        "",
        "Draft slash catalog fixture $ARGUMENTS.",
      ].join("\n"),
      "utf-8",
    );
  });

  afterEach(async () => {
    const open = await browser.execute(() => Boolean(document.querySelector('[role="menu"]')));
    if (open) await closeComposerPicker();
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await rm(CUSTOM_SLASH_COMMAND_PATH, { force: true });
    await clearAppData();
  });

  it("Slash panel: / triggers candidate list, select to insert command after filtering", async () => {
    await prepareV4ConversationE2E();

    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "/", {
      timeout: 15000,
      timeoutMsg: "v4 composer input box did not appear or is not editable",
    });
    await waitForV4SlashOption("slash:compact");
    await waitForV4SlashOption("slash:init");
    await waitForV4SlashOption("app-slash:plan");
    const optionIds = await getV4SlashOptionIds();
    expect(optionIds).toContain("slash:compact");
    expect(optionIds).toContain("slash:goal");
    expect(optionIds).toContain("slash:init");
    expect(optionIds).toContain("app-slash:plan");
    expect(optionIds).not.toContain("slash:plan");
    expect(optionIds).not.toContain("slash:resume-goal");

    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "/plan", {
      timeout: 15000,
      timeoutMsg: "v4 composer input box did not appear or is not editable",
    });
    await waitForV4SlashOption("app-slash:plan");
    expect(await clickV4SlashOption("app-slash:plan")).toBe(true);
    await browser.waitUntil(
      async () =>
        (await $(`[data-testid="${TID_V4_MODEL_CONFIG}"]`).getAttribute("data-plan-enabled")) ===
        "true",
      {
        timeout: 15000,
        timeoutMsg: "选中 /plan 后草稿没有进入计划模式",
      },
    );
    expect((await getV4ComposerText()) ?? "").toBe("");
    expect((await getV4PaneSnapshot()).sessionId).toBe("draft");
    await switchV4Mode("plan");
    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "", {
      timeout: 15000,
      timeoutMsg: "Composer was not cleared after selecting /plan",
    });

    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "/goa", {
      timeout: 15000,
      timeoutMsg: "v4 composer input box did not appear or is not editable",
    });
    await waitForV4SlashOption("slash:goal");

    expect(await clickV4SlashOption("slash:goal")).toBe(true);
    await browser.waitUntil(async () => ((await getV4ComposerText()) ?? "").startsWith("/goal"), {
      timeout: 15000,
      timeoutMsg: "选中 slash 候选后命令没有插入 composer",
    });
    await browser.waitUntil(async () => !(await hasV4SlashPanel()), {
      timeout: 15000,
      timeoutMsg: "选中 slash 候选后面板没有关闭",
    });

    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "", {
      timeout: 15000,
      timeoutMsg: "v4 composer input box did not appear or is not editable",
    });
  });

  it("Model selector / thinking depth / mode switch → config projection updated; usage projection non-zero", async () => {
    await ensureCompletedTask();
    await browser.execute(() => {
      const probe = { empty: 0, disabled: 0, samples: 0, stop: () => {} };
      const observer = new MutationObserver(() => {
        const list = document.querySelector("[data-composer-model-list]");
        if (!list) return;
        probe.samples++;
        if (!list.textContent?.trim()) probe.empty++;
        if (document.querySelector<HTMLButtonElement>("[data-composer-combined-model]")?.disabled)
          probe.disabled++;
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["disabled"],
      });
      probe.stop = () => observer.disconnect();
      (window as Window & { __composerCatalogProbe?: typeof probe }).__composerCatalogProbe = probe;
    });

    const waitForModelConfig = async (
      predicate: (cfg: {
        provider: string | null;
        model: string | null;
        thought: string | null;
      }) => boolean,
      label: string,
    ) => {
      let latest: unknown = null;
      try {
        await browser.waitUntil(
          async () => {
            const cfg = await getV4ModelConfig();
            latest = cfg;
            return predicate(cfg);
          },
          { timeout: 30000, timeoutMsg: label },
        );
      } catch (error) {
        const acks = await browser
          .execute(() =>
            JSON.stringify(
              (window as Window & { __cfV4CommandAcksE2E?: unknown[] })
                .__cfV4CommandAcksE2E ?? [],
            ),
          )
          .catch(() => "acks unavailable");
        throw new Error(`${label}; latest=${JSON.stringify(latest)}; acks=${acks}`, {
          cause: error,
        });
      }
    };

    await switchV4Model(UPSTREAM_PROVIDER_ID, UPSTREAM_SECONDARY_MODEL, "max");
    await waitForModelConfig(
      (cfg) => cfg.model === UPSTREAM_SECONDARY_MODEL,
      "模型选择器切换后 config.model 投影没有更新",
    );
    await waitForModelConfig(
      (cfg) => cfg.thought === "max",
      "config.thought projection did not update after switching thinking depth",
    );
    const cfg = await getV4ModelConfig();
    expect(cfg.provider).toBe(UPSTREAM_PROVIDER_ID);

    for (const selected of [false, true]) {
      await openComposerPicker("model");
      const option = $(
        `[data-testid^="chat-model-select-item-"]${selected ? '[data-checked="true"]' : ':not([data-checked="true"])'}:not([data-model-option-locked])`,
      );
      await option.waitForClickable({ timeout: 15000 });
      const value = (await option.getAttribute("data-testid"))!.slice(
        "chat-model-select-item-".length,
      );
      await option.click();
      await waitForOnlyComposerPickerOpen("model", selected ? "Reselect current model" : "选择其他模型");
      await browser.waitUntil(
        async () =>
          (await $(`[data-testid="${TID_CHAT_MODEL_SELECT_TRIGGER}"]`).getAttribute(
            "data-model-current-value",
          )) === value,
        { timeout: 15000 },
      );
      await closeComposerPicker();
    }

    await openComposerPicker("model");
    await $('[data-testid="composer-provider-trigger"]').click();
    await $(
      `[data-model-provider-key="registry-provider:${UPSTREAM_ALTERNATE_PROVIDER_ID}"]`,
    ).click();
    await waitForModelConfig(
      (value) =>
        value.provider === UPSTREAM_ALTERNATE_PROVIDER_ID &&
        value.model === UPSTREAM_ALTERNATE_MODEL,
      "Target model not automatically selected after clicking Provider",
    );
    await browser.waitUntil(
      async () => {
        const slider = $('[data-testid="composer-thought-slider"]');
        const levels = JSON.parse((await slider.getAttribute("data-levels")) ?? "[]") as string[];
        return levels.includes((await getV4ModelConfig()).thought ?? "");
      },
      { timeout: 15000, timeoutMsg: "Think was not synced to a valid level after switching Provider" },
    );
    await waitForOnlyComposerPickerOpen("model", "切换 Provider 后保留弹层");
    await closeComposerPicker();
    await switchV4Model(UPSTREAM_PROVIDER_ID, UPSTREAM_SECONDARY_MODEL, "max");

    const catalogProbe = await browser.execute(() => {
      const target = window as Window & {
        __composerCatalogProbe?: { empty: number; disabled: number; samples: number; stop(): void };
      };
      const probe = target.__composerCatalogProbe!;
      probe.stop();
      delete target.__composerCatalogProbe;
      return { empty: probe.empty, disabled: probe.disabled, samples: probe.samples };
    });
    expect(catalogProbe.samples).toBeGreaterThan(0);
    expect(catalogProbe.empty).toBe(0);
    expect(catalogProbe.disabled).toBe(0);
    const modeTrigger = await $(`[data-testid="${TID_CHAT_MODE_SELECT_TRIGGER}"]`);
    await browser.execute((id) => {
      const trigger = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
      const probe = {
        animated: false,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
        stop: () => {},
      };
      const observer = new MutationObserver(() => {
        for (const node of trigger.querySelectorAll<HTMLElement>("[style]")) {
          const style = getComputedStyle(node);
          if (style.transform !== "none" && Number(style.opacity) > 0 && Number(style.opacity) < 1)
            probe.animated = true;
        }
      });
      observer.observe(trigger, { subtree: true, attributes: true, attributeFilter: ["style"] });
      probe.stop = () => observer.disconnect();
      (window as Window & { __modeRollProbe?: typeof probe }).__modeRollProbe = probe;
    }, TID_CHAT_MODE_SELECT_TRIGGER);
    try {
      await switchV4Mode("guarded");
      await browser.waitUntil(
        async () => {
          const label = await modeTrigger.$("span[title]");
          return (await label.getText()) === (await label.getAttribute("title"));
        },
        { timeout: 5000, timeoutMsg: "mode rolling label did not settle" },
      );
      expect((await $(`[data-testid="${TID_CHAT_MODE_SELECT_TRIGGER}"]`)).elementId).toBe(
        modeTrigger.elementId,
      );
      const motion = await browser.execute(() => {
        const probe = (
          window as Window & { __modeRollProbe?: { animated: boolean; reduced: boolean } }
        ).__modeRollProbe!;
        return { animated: probe.animated, reduced: probe.reduced };
      });
      expect(motion.animated).toBe(!motion.reduced);
    } finally {
      await browser.execute(() => {
        const target = window as Window & { __modeRollProbe?: { stop: () => void } };
        target.__modeRollProbe?.stop();
        delete target.__modeRollProbe;
      });
      await switchV4Mode("build");
    }
    await switchV4Mode("plan");
    await browser.waitUntil(
      () =>
        browser.execute(
          (testId) =>
            document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.dataset
              .planEnabled === "true",
          TID_V4_MODEL_CONFIG,
        ),
      { timeout: 15000, timeoutMsg: "Plan 开关没有写回 Composer" },
    );
    expect((await getV4ModelConfig()).mode).toBe("build");
    expect(await $('[data-testid="v4-composer-plan-marker"]').isDisplayed()).toBe(true);

    const projection = await getV4ConfigProjection();
    expect(projection.usageUsed).toBeGreaterThan(0);
  });

  it("Merged model/thinking popup is mutually exclusive with mode picker", async () => {
    await ensureCompletedTask();
    expect(await $(`[data-testid="${TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER}"]`).isExisting()).toBe(
      false,
    );
    await openComposerPicker("mode");
    await waitForOnlyComposerPickerOpen("mode", "打开模式 picker");
    const originalWidth = (await $(`[data-testid="${TID_CHAT_MODEL_SELECT_TRIGGER}"]`).getSize())
      .width;
    await openComposerPicker("model");
    await waitForOnlyComposerPickerOpen("model", "Mode → Merged menu");
    expect(
      await $('[data-testid="composer-provider-trigger"] [data-provider-access-badge]').getText(),
    ).toBe("API");
    const triggerAppearance = await browser.execute(() => {
      const trigger = document.querySelector<HTMLElement>("[data-composer-combined-model]")!;
      const style = getComputedStyle(trigger);
      return { background: style.backgroundColor, radius: Number.parseFloat(style.borderRadius) };
    });
    expect(triggerAppearance.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(triggerAppearance.radius).toBeGreaterThan(0);
    expect(triggerAppearance.radius).toBeLessThan(14);
    expect(await $('[role="menu"]').getAttribute("data-align")).toBe("center");
    const expandedTrigger = $(`[data-testid="${TID_CHAT_MODEL_SELECT_TRIGGER}"]`);
    expect(await expandedTrigger.getText()).toMatch(/Select model|Select Model/);
    const minimumWidth = await browser.execute(
      () => 8 * Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    );
    expect((await expandedTrigger.getSize()).width).toBe(Math.max(originalWidth, minimumWidth));
    const labelFits = await browser.execute(() => {
      const label = document.querySelector<HTMLElement>("[data-composer-open-label]")!;
      return label.scrollWidth <= label.clientWidth;
    });
    expect(labelFits).toBe(true);
    const modelFonts = await browser.execute(() => {
      const row = document.querySelector<HTMLElement>(
        '[data-composer-model-list] [role="menuitemradio"]',
      )!;
      const name = row.querySelector<HTMLElement>("[title]")!;
      return {
        name: getComputedStyle(name).fontSize,
        row: getComputedStyle(row).fontSize,
      };
    });
    expect(modelFonts.name).toBe(modelFonts.row);
    expect(await $('[data-testid="composer-thought-endpoints"]').isExisting()).toBe(false);
    expect(await $('[data-slot="dropdown-menu-label"]').getText()).toMatch(/Models|Model/);
    expect(await $('[data-testid="composer-thought-slider"]').isDisplayed()).toBe(true);
    const declaredLevels = JSON.parse(
      (await $('[data-testid="composer-thought-slider"]').getAttribute("data-levels")) ?? "[]",
    ) as string[];
    expect(await $$("[data-composer-thought-stop]").length).toBe(declaredLevels.length);
    expect(await $('[data-testid="composer-thought-track"]').isDisplayed()).toBe(true);
    const trackGeometry = await browser.execute(() => {
      const track = document.querySelector<HTMLElement>('[data-testid="composer-thought-track"]')!;
      const fill = track.querySelector<HTMLElement>(".composer-thought-slider-fill")!;
      return {
        trackHeight: track.getBoundingClientRect().height,
        fillHeight: fill.getBoundingClientRect().height,
        topOffset: fill.getBoundingClientRect().top - track.getBoundingClientRect().top,
        border: getComputedStyle(track).borderTopWidth,
      };
    });
    expect(trackGeometry.border).toBe("0px");
    expect(trackGeometry.topOffset).toBe(0);
    expect(trackGeometry.fillHeight).toBe(trackGeometry.trackHeight);
    const motion = await browser.execute(() => {
      const thumb = document.querySelector(".composer-thought-slider-thumb")!;
      const fill = document.querySelector(".composer-thought-slider-fill")!;
      return {
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
        thumb: getComputedStyle(thumb).transitionDuration,
        fill: getComputedStyle(fill).transitionDuration,
        gradient: getComputedStyle(fill, "::before").transitionDuration,
        gradientProperty: getComputedStyle(fill, "::before").transitionProperty,
      };
    });
    expect(motion.thumb).toBe(motion.reduced ? "0s" : "0.12s");
    expect(motion.fill).toBe(motion.thumb);
    const menuLayout = await browser.execute(() => {
      const list = document.querySelector<HTMLElement>("[data-composer-model-list]")!;
      const menu = list.closest('[role="menu"]')!;
      return {
        outerOverflow: getComputedStyle(menu).overflowY,
        listOverflow: getComputedStyle(list).overflowY,
        appRegion: getComputedStyle(menu).getPropertyValue("app-region"),
      };
    });
    expect(menuLayout.outerOverflow).toBe("hidden");
    expect(menuLayout.listOverflow).toBe("auto");
    expect(menuLayout.appRegion).toBe("no-drag");
    const modelList = $("[data-composer-model-list]");
    try {
      await browser.execute(() => {
        const list = document.querySelector<HTMLElement>("[data-composer-model-list]")!;
        list.style.maxHeight = "30px";
        list.scrollTop = 0;
      });
      await browser.waitUntil(
        async () => (await modelList.getAttribute("data-scroll-mask")) === "bottom",
      );
      for (const [position, mask] of [
        [0.5, "both"],
        [1, "top"],
      ] as const) {
        await browser.execute((ratio) => {
          const list = document.querySelector<HTMLElement>("[data-composer-model-list]")!;
          list.scrollTop = (list.scrollHeight - list.clientHeight) * ratio;
        }, position);
        await browser.waitUntil(
          async () => (await modelList.getAttribute("data-scroll-mask")) === mask,
        );
      }
    } finally {
      await browser.execute(() => {
        const list = document.querySelector<HTMLElement>("[data-composer-model-list]")!;
        list.style.removeProperty("max-height");
        list.scrollTop = 0;
      });
    }
    await browser.waitUntil(
      async () => (await modelList.getAttribute("data-scroll-mask")) === "none",
    );

    const combinedTrigger = await $("[data-composer-combined-model]");
    expect(await combinedTrigger.$('[data-composer-trigger-frame="open"]').isExisting()).toBe(true);
    expect(await combinedTrigger.$("[data-composer-open-chevron]").isExisting()).toBe(false);

    const shortcut = await $('[data-testid="composer-effort-shortcut"]');
    expect(await shortcut.getText()).toMatch(/T/i);
    const shortcutLayout = await browser.execute(() => {
      const shortcut = document.querySelector<HTMLElement>(
        '[data-testid="composer-effort-shortcut"]',
      )!;
      const value = document.querySelector<HTMLElement>('[data-testid="composer-thought-value"]')!;
      const a = shortcut.getBoundingClientRect();
      const b = value.getBoundingClientRect();
      const row = shortcut.parentElement!.getBoundingClientRect();
      return {
        afterValue: a.left > b.right,
        rightGap: row.right - a.right,
        sameRow: Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) < 2,
      };
    });
    expect(shortcutLayout.afterValue).toBe(true);
    expect(shortcutLayout.rightGap).toBeLessThan(2);
    expect(shortcutLayout.sameRow).toBe(true);
    const shortcutStyle = await browser.execute(() => {
      const element = document.querySelector('[data-testid="composer-effort-shortcut"]')!;
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        radius: style.borderRadius,
        height: style.height,
      };
    });
    expect(shortcutStyle.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(shortcutStyle.radius).toBe("6px");
    expect(shortcutStyle.height).toBe("16px");

    expect(motion.gradient).toBe(motion.reduced ? "0s" : "0.2s");
    if (!motion.reduced) expect(motion.gradientProperty).toBe("opacity");
    await closeComposerPicker();
    await openComposerPicker("model");
    await openComposerPicker("mode");
    await waitForOnlyComposerPickerOpen("mode", "Merged menu → Mode");
    await browser.waitUntil(
      async () => !(await combinedTrigger.$('[data-composer-trigger-frame="open"]').isExisting()),
      { timeout: 3000 },
    );
    expect(await combinedTrigger.$('[data-composer-trigger-frame="closed"]').isExisting()).toBe(
      true,
    );
    expect((await $("[data-composer-combined-model]")).elementId).toBe(combinedTrigger.elementId);

    await closeComposerPicker();
  });

  it("slider dots grow on hover and remain white on the filled track", async () => {
    const highspeed = process.env.E2E_COMPOSER_EXPECT_HIGHSPEED === "1";
    await ensureCompletedTask();
    if (highspeed) {
      const model = process.env.E2E_COMPOSER_ANIMATION_MODEL || "GLM-5.3-FlashX";
      await seedPersonalProviderConfig(getE2EAppDataPaths().configFile, {
        id: "e2e-animation-model",
        label: "Animation Fixture",
        apiFormat: "anthropic-messages",
        apiKey: "e2e-fixture-key",
        baseURL: "http://127.0.0.1:1/v1",
        models: [{ id: model, reasoningLevel: { values: ["high", "max"], map: "{}" } }],
      });
      await waitForProviderConfigPolling();
      await switchV4Model("e2e-animation-model", model, "high");
    }
    await openComposerPicker("model");
    const slider = $('[data-testid="composer-thought-slider"]');
    expect(await $(".composer-thought-slider-fill").getAttribute("data-highspeed")).toBe(
      String(highspeed),
    );
    expect(await $('[data-testid="composer-thought-meter"]').getAttribute("data-highspeed")).toBe(
      String(highspeed),
    );
    const filledOpacity = await browser.execute(
      () =>
        getComputedStyle(
          document.querySelector('[data-composer-thought-stop][data-filled="true"]')!,
        ).opacity,
    );
    expect(filledOpacity).toBe("0.3");
    const sliderSize = await slider.getSize();
    await slider.moveTo({ xOffset: Math.round(16 - sliderSize.width / 2), yOffset: 0 });
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const dot = document.querySelector<HTMLElement>("[data-composer-thought-stop]")!;
          return Number.parseFloat(getComputedStyle(dot).scale) > 1.7;
        }),
      { timeout: 3000 },
    );
    const filledColor = await browser.execute(() => {
      const dot = document.querySelector<HTMLElement>(
        '[data-composer-thought-stop][data-filled="true"]',
      )!;
      return getComputedStyle(dot).backgroundColor;
    });
    expect(filledColor).toBe("rgb(255, 255, 255)");
    const drag = await browser.execute(() => {
      const input = document.querySelector<HTMLInputElement>(
        '[data-testid="composer-thought-slider"]',
      )!;
      const rect = input.getBoundingClientRect();
      return {
        x: Math.round(
          rect.left + 14 + ((rect.width - 28) * Number(input.value)) / Number(input.max),
        ),
        y: Math.round(rect.top + rect.height / 2),
        target: Math.round(rect.left + 14),
      };
    });
    await browser.performActions([
      {
        type: "pointer",
        id: "slider-drag",
        parameters: { pointerType: "mouse" },
        actions: [
          { type: "pointerMove", duration: 0, x: drag.x, y: drag.y },
          { type: "pointerDown", button: 0 },
          { type: "pointerMove", duration: 150, x: drag.target, y: drag.y },
        ],
      },
    ]);
    const dragMotion = await browser.execute(() => ({
      reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
      thumb: getComputedStyle(document.querySelector(".composer-thought-slider-thumb")!)
        .transitionDuration,
      fill: getComputedStyle(document.querySelector(".composer-thought-slider-fill")!)
        .transitionDuration,
    }));
    await browser.releaseActions();
    expect(dragMotion.thumb).toBe(dragMotion.reduced ? "0s" : "0.12s");
    expect(dragMotion.fill).toBe(dragMotion.thumb);
    await slider.click();
    await browser.keys("End");
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            getComputedStyle(document.querySelector(".composer-thought-slider-fill")!, "::before")
              .opacity === "1",
        ),
      { timeout: 3000 },
    );
    const gradientColors = await browser.execute(() => {
      const fill = document.querySelector<HTMLElement>(".composer-thought-slider-fill")!;
      const marker = document.createElement("span");
      marker.style.color = "var(--composer-thought-max-accent)";
      fill.append(marker);
      const accent = getComputedStyle(marker).color;
      marker.style.color = "var(--color-purple-500)";
      const purple = getComputedStyle(marker).color;
      marker.remove();
      return { gradient: getComputedStyle(fill, "::before").backgroundImage, accent, purple };
    });
    expect(gradientColors.gradient).toContain(gradientColors.accent);
    if (highspeed) {
      expect(gradientColors.gradient).toContain(gradientColors.purple);
      expect(gradientColors.gradient).not.toContain("in oklch");
    } else expect(gradientColors.gradient).toContain("in oklch");
    const bubbles = await browser.execute(() => {
      const layer = document.querySelector<HTMLElement>(
        '[data-testid="composer-thought-bubbles"]',
      )!;
      return {
        count: layer.children.length,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
        display: getComputedStyle(layer).display,
        animation: getComputedStyle(layer.firstElementChild!).animationName,
        duration: parseFloat(getComputedStyle(layer.firstElementChild!).animationDuration),
      };
    });
    expect(bubbles.count).toBe(highspeed ? 32 : 12);
    if (highspeed && !bubbles.reduced) {
      expect(bubbles.duration).toBeGreaterThanOrEqual(0.8);
      expect(bubbles.duration).toBeLessThanOrEqual(1.2);
    }
    expect(bubbles.animation).toBe(bubbles.reduced ? "none" : "composer-thought-bubble-flow");
    if (bubbles.reduced) expect(bubbles.display).toBe("none");
    await browser.keys("ArrowLeft");
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            getComputedStyle(document.querySelector(".composer-thought-slider-fill")!, "::before")
              .opacity === "0",
        ),
      { timeout: 3000 },
    );
    expect(await $('[data-testid="composer-thought-bubbles"]').isExisting()).toBe(false);
    await closeComposerPicker();
    if (highspeed) await switchV4Model(UPSTREAM_PROVIDER_ID, UPSTREAM_MODEL, "high");
  });

  it("模型管理入口位于 Provider 子菜单并打开模型设置", async () => {
    await ensureCompletedTask();
    await openComposerPicker("model");
    expect(await $('[data-model-footer-action="manage-models"]').isExisting()).toBe(false);
    const provider = $('[data-testid="composer-provider-trigger"]');
    expect(await provider.$('img, svg[aria-hidden="true"]').isExisting()).toBe(true);
    await provider.click();
    const providerMenu = await $('[data-slot="dropdown-menu-sub-content"]');
    await providerMenu.waitForDisplayed();
    await browser.waitUntil(() =>
      browser.execute(() =>
        Array.from(document.querySelectorAll('[role="menu"]')).every((menu) =>
          menu.getAnimations().every((animation) => animation.playState === "finished"),
        ),
      ),
    );
    const providerBounds = await browser.execute(() => {
      const menu = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-sub-content"]')!;
      const rect = menu.getBoundingClientRect();
      return {
        inside: rect.left >= 0 && rect.right <= document.documentElement.clientWidth,
        overflow: menu.scrollWidth > menu.clientWidth,
        topSafe: rect.top >= 11,
        aligned:
          Math.abs(
            rect.top -
              document.querySelector('[data-slot="dropdown-menu-content"]')!.getBoundingClientRect()
                .top,
          ) <= 1,
        listOverflow: getComputedStyle(menu.querySelector("[data-composer-provider-list]")!)
          .overflowY,
      };
    });
    expect(providerBounds.inside).toBe(true);
    expect(providerBounds.overflow).toBe(false);
    expect(providerBounds.topSafe).toBe(true);
    expect(providerBounds.aligned).toBe(true);
    expect(providerBounds.listOverflow).toBe("auto");
    expect(
      await browser.execute(() =>
        getComputedStyle(
          document.querySelector('[data-slot="dropdown-menu-sub-content"]')!,
        ).getPropertyValue("app-region"),
      ),
    ).toBe("no-drag");

    const manage = $('[data-model-footer-action="manage-models"]');
    await manage.waitForDisplayed();
    const badgeGaps = await browser.execute(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="menuitemradio"] [data-provider-access-badge]',
        ),
      ).map((badge) => {
        const name = badge.previousElementSibling!;
        const range = document.createRange();
        range.selectNodeContents(name);
        return badge.getBoundingClientRect().left - range.getBoundingClientRect().right;
      }),
    );
    expect(badgeGaps.length).toBeGreaterThan(0);
    for (const gap of badgeGaps) expect(gap).toBeLessThanOrEqual(9);
    await manage.click();
    await $(`[data-testid="${TID_SETTINGS_PAGE}"]`).waitForDisplayed();
    await $(`[data-testid="${TID_SETTINGS_BACK_BUTTON}"]`).click();
    await waitForNoComposerPickerOpen("Menu closed after returning from model settings");
  });

  it("completed task 的 picker 不跨 scope 自动弹到新 draft", async () => {
    await ensureCompletedTask();
    await openComposerPicker("model");
    await waitForOnlyComposerPickerOpen("model", "completed task 打开模型 picker");

    await startNewV4Draft();
    await waitForNoComposerPickerOpen("completed task→draft");
  });

  it("completed task → draft 后独立重新水合自定义 slash command", async () => {
    await ensureCompletedTask();
    await ensureCustomSlashHydratedInDraft();
  });

  it("draft → 已知 completed task 后保留自定义 slash command", async () => {
    const taskId = await ensureCompletedTask();
    await ensureCustomSlashHydratedInDraft();
    await selectV4TaskById(taskId);
    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "/", {
      stabilizeLexicalCaretAtEnd: true,
      timeout: 15000,
      timeoutMsg: "draft → 已知 task 后 v4 composer 输入框没有出现或不可输入",
    });
    await waitForV4SlashOption(CUSTOM_SLASH_OPTION_ID);
    expect(await getV4SlashOptionIds()).toContain(CUSTOM_SLASH_OPTION_ID);

    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "", {
      timeout: 15000,
      timeoutMsg: "已知 task slash 回归断言后没有清空 composer",
    });
  });
  it("model tooltip describes the action and closes when the menu opens", async () => {
    await ensureCompletedTask();
    const trigger = $(`[data-testid="${TID_CHAT_MODEL_SELECT_TRIGGER}"]`);
    await browser.performActions([
      {
        type: "pointer",
        id: "tooltip-mouse",
        parameters: { pointerType: "mouse" },
        actions: [{ type: "pointerMove", duration: 0, x: 1, y: 1 }],
      },
    ]);
    await trigger.moveTo();
    const tooltip = $('[data-slot="tooltip-content"]');
    await tooltip.waitForDisplayed();
    expect(await tooltip.getText()).toMatch(/Select model|Select Model/);
    expect(await tooltip.getText()).not.toContain(" · ");
    expect(await tooltip.$("kbd").isExisting()).toBe(true);
    await trigger.click();
    await waitForOnlyComposerPickerOpen("model", "tooltip to model menu");
    await tooltip.waitForDisplayed({ reverse: true });
    await closeComposerPicker();
  });
  it("dismisses with one outside click after using the effort slider", async () => {
    await ensureCompletedTask();
    for (const gesture of ["click", "drag"]) {
      await openComposerPicker("model");
      try {
        const slider = $('[data-testid="composer-thought-slider"]');
        const levels = JSON.parse((await slider.getAttribute("data-levels")) ?? "[]") as string[];
        expect(levels.length).toBeGreaterThan(1);
        await slider.click();
        await browser.waitUntil(
          async () => (await slider.getAttribute("aria-disabled")) === "false",
          { timeout: 15000 },
        );
        await browser.keys("Home");
        await browser.waitUntil(async () => (await getV4ModelConfig()).thought === levels[0]);
        const before = await getV4ModelConfig();
        const targetIndex = gesture === "click" ? 1 : levels.length - 1;
        const rect = await browser.execute((target) => {
          const input = document.querySelector<HTMLInputElement>(
            '[data-testid="composer-thought-slider"]',
          )!;
          const bounds = input.getBoundingClientRect();
          const position = (index: number) =>
            Math.round(bounds.left + 14 + ((bounds.width - 28) * index) / Number(input.max));
          return {
            x: position(Number(input.value)),
            y: Math.round(bounds.top + bounds.height / 2),
            end: position(target),
          };
        }, targetIndex);
        await browser.performActions([
          {
            type: "pointer",
            id: "dismiss-slider",
            parameters: { pointerType: "mouse" },
            actions: [
              {
                type: "pointerMove",
                duration: 0,
                x: gesture === "click" ? rect.end : rect.x,
                y: rect.y,
              },
              { type: "pointerDown", button: 0 },
              ...(gesture === "drag"
                ? [{ type: "pointerMove" as const, duration: 150, x: rect.end, y: rect.y }]
                : []),
              { type: "pointerUp", button: 0 },
            ],
          },
        ]);
        await browser.releaseActions();
        await browser.waitUntil(
          async () =>
            Number(await slider.getValue()) === targetIndex &&
            (await getV4ModelConfig()).thought === levels[targetIndex],
          { timeout: 15000, timeoutMsg: `${gesture} did not commit the target effort` },
        );
        expect(await getV4ModelConfig()).toMatchObject({
          provider: before.provider,
          model: before.model,
          thought: levels[targetIndex],
        });
        await browser.waitUntil(
          async () => {
            const value = await $('[data-testid="composer-thought-value"] [title]');
            return (await value.getText()) === (await slider.getAttribute("aria-valuetext"));
          },
          { timeout: 5000, timeoutMsg: "rolling effort label did not settle on the current level" },
        );
        await waitForOnlyComposerPickerOpen("model", "slider interaction");
        await browser.performActions([
          {
            type: "pointer",
            id: "outside-click",
            parameters: { pointerType: "mouse" },
            actions: [
              { type: "pointerMove", duration: 0, x: 4, y: 100 },
              { type: "pointerDown", button: 0 },
              { type: "pointerUp", button: 0 },
            ],
          },
        ]);
        await browser.releaseActions();
        await waitForNoComposerPickerOpen(`one outside click after ${gesture}`);
        expect(await getV4ModelConfig()).toMatchObject({
          provider: before.provider,
          model: before.model,
          thought: levels[targetIndex],
        });
      } finally {
        await browser.releaseActions();
        if (
          (await $('[data-testid="chat-model-select-trigger"]').getAttribute("aria-expanded")) ===
          "true"
        )
          await closeComposerPicker();
      }
    }
  });
  it("keeps the open model picker responsive when the composer shrinks and expands", async () => {
    await ensureCompletedTask();
    await openComposerPicker("model");
    const trigger = await $('[data-testid="chat-model-select-trigger"]');
    const slider = await $('[data-testid="composer-thought-slider"]');
    const menu = await $('[role="menu"]');
    const levels = JSON.parse((await slider.getAttribute("data-levels")) ?? "[]") as string[];
    expect(levels.length).toBeGreaterThan(1);
    await browser.performActions([
      {
        type: "pointer",
        id: "resize-pointer",
        parameters: { pointerType: "mouse" },
        actions: [{ type: "pointerMove", duration: 0, x: 4, y: 100 }],
      },
    ]);
    await browser.releaseActions();
    await browser.keys("End");
    await browser.waitUntil(() => slider.isFocused(), {
      timeout: 5000,
      timeoutMsg: "keyboard did not focus effort slider",
    });
    await browser.keys("Home");
    await browser.waitUntil(async () => (await getV4ModelConfig()).thought === levels[0]);
    let expectedConfig = await getV4ModelConfig();
    const resizeToolbar = async (width: string) =>
      browser.execute((value) => {
        const trigger = document.querySelector<HTMLElement>(
          '[data-testid="chat-model-select-trigger"]',
        )!;
        const root = trigger.closest<HTMLElement>(
          "[data-composer-trailing-actions]",
        )!.parentElement!;
        root.style.width = value;
      }, width);
    try {
      for (const width of ["240px", ""]) {
        await resizeToolbar(width);
        await browser.waitUntil(
          async () =>
            browser.execute((compact) => {
              const trigger = document.querySelector<HTMLElement>(
                '[data-testid="chat-model-select-trigger"]',
              )!;
              const root = trigger.closest<HTMLElement>(
                "[data-composer-trailing-actions]",
              )!.parentElement!;
              const leading = root
                .querySelector<HTMLElement>("[data-composer-leading-content]")!
                .getBoundingClientRect();
              const trailing = root
                .querySelector<HTMLElement>("[data-composer-trailing-actions]")!
                .getBoundingClientRect();
              const label = trigger.querySelector<HTMLElement>("[data-composer-open-label]")!;
              const icon = trigger.querySelector<HTMLElement>("[data-composer-open-icon]")!;
              return (
                trigger.getAttribute("aria-expanded") === "true" &&
                leading.right <= trailing.left &&
                (compact
                  ? trigger.getBoundingClientRect().width < 128 &&
                    getComputedStyle(label).display === "none" &&
                    getComputedStyle(icon).display !== "none" &&
                    getComputedStyle(
                      trigger.querySelector<HTMLElement>("[data-composer-open-thought]")!,
                    ).display !== "none" &&
                    !trigger.querySelector("[data-composer-open-chevron]")
                  : trigger.getBoundingClientRect().width >= 128 &&
                    getComputedStyle(label).display !== "none" &&
                    getComputedStyle(icon).display === "none")
              );
            }, Boolean(width)),
          { timeout: 5000, timeoutMsg: `open picker failed to fit ${width || "restored width"}` },
        );
        expect((await $('[data-testid="chat-model-select-trigger"]')).elementId).toBe(
          trigger.elementId,
        );
        expect((await $('[data-testid="composer-thought-slider"]')).elementId).toBe(
          slider.elementId,
        );
        expect((await $('[role="menu"]')).elementId).toBe(menu.elementId);
        expect(await slider.isFocused()).toBe(true);
        expect(await getV4ModelConfig()).toEqual(expectedConfig);
        if (width) {
          await browser.keys("End");
          await browser.waitUntil(
            async () =>
              (await getV4ModelConfig()).thought === levels.at(-1) &&
              (await $('[data-testid="composer-thought-meter"]').getAttribute("data-progress")) ===
                "100",
            { timeout: 15000, timeoutMsg: "compact picker lost keyboard effort updates" },
          );
          expect(await $('[data-testid="composer-thought-meter"]').isDisplayed()).toBe(true);
          expectedConfig = { ...expectedConfig, thought: levels.at(-1)! };
          expect(await getV4ModelConfig()).toEqual(expectedConfig);
        }
      }
      await resizeToolbar("240px");
      await closeComposerPicker();
      await openComposerPicker("model");
      await waitForOnlyComposerPickerOpen("model", "reopen at compact width");
      expect(await $("[data-composer-open-icon]").isDisplayed()).toBe(true);
      expect(await $('[data-testid="composer-thought-meter"]').isDisplayed()).toBe(true);
      expect(await $("[data-composer-open-chevron]").isExisting()).toBe(false);
      expect(await $("[data-composer-open-label]").isDisplayed()).toBe(false);
      expect((await trigger.getSize()).width).toBeLessThan(128);
      expect(await getV4ModelConfig()).toEqual(expectedConfig);
    } finally {
      await resizeToolbar("");
      await closeComposerPicker();
    }
  });
});
