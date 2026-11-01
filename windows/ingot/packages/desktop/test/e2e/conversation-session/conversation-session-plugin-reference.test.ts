import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  clearAppData,
  DEFAULT_WORKSPACE,
  setInputValueByTestIdDom,
} from "../helpers/desktop-app.js";
import { waitForUpstreamNetworkCapture } from "../helpers/upstream-capture.js";
import {
  TID_PROMPT_SUGGESTION_OPTION,
  TID_V4_COMPOSER_INPUT,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  clickV4SlashOption,
  getV4ComposerText,
  hasV4SlashPanel,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4MentionOptionPrefix,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";
import {
  clickPluginControl,
  openPluginCard,
  openPluginSettings,
} from "../helpers/plugin-management-lifecycle.js";

const PLUGIN_STABLE_ID = "skill-creator@cf-plugins-official";
const STORE_TRY_PLUGIN_STABLE_ID = "cf-guide@cf-plugins-official";
const STORE_TRY_PLUGIN_ICON =
  "https://cdn-cf.z.ai/cf/official-plugin/assets/cf-guide/icon.png";
const PROMPT_MARKER = "E2E_PLUGIN_REFERENCE";
const REPLY_MARKER = "PLUGIN_REFERENCE_REPLY_OK";
const NOTE_RELATIVE_PATH = "plugin-reference-e2e/note.md";
const NOTE_BODY = "PLUGIN_REFERENCE_NOTE_BODY";
const SCREENSHOT_DIR = join(process.cwd(), ".e2e-artifacts", "plugin-reference");

async function captureEvidence(label: string): Promise<void> {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await browser.saveScreenshot(join(SCREENSHOT_DIR, `${label}.png`));
}

async function readPluginMentionPresentation(pluginId: string): Promise<{
  found: boolean;
  iconSrc: string | null;
  label: string;
}> {
  return browser.execute(
    (inputTestId, mentionId) => {
      const input = document.querySelector<HTMLElement>(`[data-testid="${inputTestId}"]`);
      const mention = Array.from(
        input?.querySelectorAll<HTMLElement>("[data-mention-category='plugins']") ?? [],
      ).find((element) => element.getAttribute("data-mention-id") === mentionId);
      const image = mention?.style.getPropertyValue("--mention-image").trim();
      return {
        found: Boolean(mention),
        iconSrc: image?.startsWith("url(") ? (JSON.parse(image.slice(4, -1)) as string) : null,
        label: mention?.textContent ?? "",
      };
    },
    TID_V4_COMPOSER_INPUT,
    `plugin:${pluginId}`,
  );
}

async function focusV4Composer(): Promise<void> {
  await browser.execute((inputTestId) => {
    const input = document.querySelector<
      HTMLElement & { __cfLexicalInputE2E?: { focus: () => void } }
    >(`[data-testid="${inputTestId}"]`);
    input?.__cfLexicalInputE2E?.focus();
  }, TID_V4_COMPOSER_INPUT);
}

describe("PLG plugin 引用：@ 面板 plugins 分组与 plugin_reference reminder", () => {
  beforeEach(async () => {
    await prepareV4ConversationE2E();
  });
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("@ panel displays plugins group candidates and inserts canonical plugin:// markdown upon selection", async () => {
    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "@cf-guide", {
      timeout: 15000,
      timeoutMsg: "v4 composer input box did not appear or is not editable",
    });
    const pluginOptionId = await waitForV4MentionOptionPrefix(
      `plugin:${STORE_TRY_PLUGIN_STABLE_ID}`,
      30000,
    );
    expect(pluginOptionId).toBe(`plugin:${STORE_TRY_PLUGIN_STABLE_ID}`);
    const pickerIcon = await browser.execute(
      (optionTestId) =>
        document
          .querySelector<HTMLElement>(`[data-testid="${optionTestId}"]`)
          ?.querySelector<HTMLImageElement>("img")?.src ?? null,
      testId(TID_PROMPT_SUGGESTION_OPTION, pluginOptionId),
    );
    expect(pickerIcon).toBe(STORE_TRY_PLUGIN_ICON);
    await captureEvidence("01-picker-plugins-group");

    expect(await clickV4SlashOption(pluginOptionId)).toBe(true);
    await browser.waitUntil(async () => ((await getV4ComposerText()) ?? "").includes("plugin://"), {
      timeout: 15000,
      timeoutMsg: "选中 plugin mention 后 composer 没有插入 canonical plugin:// markdown",
    });
    await browser.waitUntil(async () => !(await hasV4SlashPanel()), {
      timeout: 15000,
      timeoutMsg: "选中 plugin mention 后面板没有关闭",
    });
    expect(await readPluginMentionPresentation(STORE_TRY_PLUGIN_STABLE_ID)).toEqual({
      found: true,
      iconSrc: STORE_TRY_PLUGIN_ICON,
      label: "cf-guide",
    });
    await captureEvidence("02-composer-plugin-chip");

    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "", {
      timeout: 15000,
      timeoutMsg: "v4 composer input box did not appear or is not editable",
    });
  });

  it("Top Try now in Plugin Store only prefills canonical reference without auto-sending", async () => {
    await openPluginSettings();
    await openPluginCard(STORE_TRY_PLUGIN_STABLE_ID);
    await captureEvidence("03-plugin-store-try-now-detail");
    await clickPluginControl("plugin-store-try-now", {
      pluginId: STORE_TRY_PLUGIN_STABLE_ID,
    });

    await waitForV4Pane(
      (state) => state.sessionId === "draft" && !state.canStop,
      "Try now in Plugin Store did not enter idle draft via standard new task",
      30000,
    );
    await browser.waitUntil(
      async () =>
        ((await getV4ComposerText()) ?? "").includes(`plugin://${STORE_TRY_PLUGIN_STABLE_ID}`),
      {
        timeout: 30000,
        timeoutMsg: "Try now in Plugin Store did not prefill canonical Plugin reference",
      },
    );
    const tryNowText = (await getV4ComposerText()) ?? "";
    for (const prompt of [
      "How do I configure MCP servers in CodeFusion?",
      "Diagnose my current CodeFusion setup",
      "CodeFusion 里怎么配置 MCP 服务器？",
      "帮我诊断当前的 CodeFusion 配置",
    ]) {
      expect(tryNowText).not.toContain(prompt);
    }
    const tryNowMention = await readPluginMentionPresentation(STORE_TRY_PLUGIN_STABLE_ID);
    expect(tryNowMention.found).toBe(true);
    expect(tryNowMention.iconSrc).toBe(STORE_TRY_PLUGIN_ICON);
    expect(["CodeFusion Guide", "CodeFusion 使用指南"]).toContain(tryNowMention.label);
    await captureEvidence("04-plugin-store-try-now-draft");

    await focusV4Composer();
    await browser.keys(" ");
    const afterSpaceMention = await readPluginMentionPresentation(STORE_TRY_PLUGIN_STABLE_ID);
    expect(afterSpaceMention.found).toBe(true);
    expect((await getV4ComposerText()) ?? "").toContain(`plugin://${STORE_TRY_PLUGIN_STABLE_ID}`);
    await captureEvidence("04b-plugin-store-try-now-after-space");

    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "", {
      timeout: 15000,
      timeoutMsg: "v4 composer is not editable after Try now in Plugin Store",
    });
  });

  it("Plugin Store sample prompt prefills canonical reference and prompt without auto-sending", async () => {
    await openPluginSettings();
    await openPluginCard(STORE_TRY_PLUGIN_STABLE_ID);
    await clickPluginControl("plugin-store-example-prompt", {
      pluginId: STORE_TRY_PLUGIN_STABLE_ID,
    });

    await waitForV4Pane(
      (state) => state.sessionId === "draft" && !state.canStop,
      "Plugin Store trial did not enter idle draft via standard new task",
      30000,
    );
    await browser.waitUntil(
      async () => {
        const text = (await getV4ComposerText()) ?? "";
        return (
          text.includes(`plugin://${STORE_TRY_PLUGIN_STABLE_ID}`) &&
          [
            "How do I configure MCP servers in CodeFusion?",
            "Diagnose my current CodeFusion setup",
            "CodeFusion 里怎么配置 MCP 服务器？",
            "帮我诊断当前的 CodeFusion 配置",
          ].some((prompt) => text.includes(prompt))
        );
      },
      {
        timeout: 30000,
        timeoutMsg: "Plugin Store trial did not prefill canonical Plugin reference and sample prompt",
      },
    );
    const storeMention = await readPluginMentionPresentation(STORE_TRY_PLUGIN_STABLE_ID);
    expect(storeMention.found).toBe(true);
    expect(storeMention.iconSrc).toBe(STORE_TRY_PLUGIN_ICON);
    expect(["CodeFusion Guide", "CodeFusion 使用指南"]).toContain(storeMention.label);
    await captureEvidence("03-plugin-store-try-draft");

    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "", {
      timeout: 15000,
      timeoutMsg: "v4 composer is not editable after Plugin Store trial",
    });
  });

  it("Provider received identifiers-only reminder and drove test tool after sending canonical plugin reference", async function () {
    this.timeout(240000);
    await mkdir(join(DEFAULT_WORKSPACE, "plugin-reference-e2e"), { recursive: true });
    await writeFile(join(DEFAULT_WORKSPACE, "plugin-reference-e2e", "note.md"), NOTE_BODY, "utf8");

    await sendV4Prompt(
      `${PROMPT_MARKER} read ${NOTE_RELATIVE_PATH} with [@skill-creator](plugin://${PLUGIN_STABLE_ID})`,
    );
    await waitForV4TimelineContaining(REPLY_MARKER, 60000);
    await waitForV4Pane(
      (state) => !state.canStop && state.sessionId !== "draft" && state.sessionId !== null,
      "plugin 引用回合没有回到空闲态",
      60000,
    );
    await captureEvidence("04-timeline-plugin-reference-reply");

    const capture = await waitForUpstreamNetworkCapture("<plugin_reference>");
    const serialized = JSON.stringify(capture.requestJson);
    expect(serialized).toContain(PLUGIN_STABLE_ID);
    expect((serialized.match(/<plugin_reference>/g) ?? []).length).toBe(1);
    expect(serialized).not.toContain("CF_PLUGIN_ROOT");
    expect(serialized).not.toContain('"rootPath"');

    const timelineHasReminder = await browser.execute(() =>
      (document.body.textContent ?? "").includes("<plugin_reference>"),
    );
    expect(timelineHasReminder).toBe(false);
  });
});
