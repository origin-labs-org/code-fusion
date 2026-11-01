import { clearAppData } from "../helpers/desktop-app.js";
import { waitForUpstreamRequest } from "../helpers/conversation-session-network.js";
import { waitForToolCallBlockByToolName } from "../helpers/conversation-session-tool.js";
import {
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

const MARKER_EMPTY_SUBMIT = "E2E_ADF_EMPTY_SUBMIT";
const MARKER_TAB_ENTER = "E2E_ADF_TAB_ENTER";
const MARKER_ENTER_SKIP = "E2E_ADF_ENTER_SKIP";
const MARKER_MULTISELECT = "E2E_ADF_MULTISELECT";
const MARKER_ESCAPE_DISMISS = "E2E_ADF_ESCAPE_DISMISS";

const Q1_SINGLE = "E2E_ADF_Q1_SINGLE_SELECT";
const Q2_MULTI = "E2E_ADF_Q2_MULTI_SELECT";

const Q1_OPT_A = "E2E_ADF_Q1_A";
const Q1_OPT_B = "E2E_ADF_Q1_B";
const Q2_OPT_A = "E2E_ADF_Q2_A";
const Q2_OPT_B = "E2E_ADF_Q2_B";
const Q2_OPT_C = "E2E_ADF_Q2_C";

describe("AskUserQuestion default unfocused keyboard navigation E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Modal opens unfocused; click Submit with mouse to submit empty answer", async function () {
    this.timeout(180000);

    await prepareV4ConversationE2E();

    const runId = Date.now();
    const prompt = [
      `${MARKER_EMPTY_SUBMIT}_${runId}: Trigger AskUserQuestion with one single-select question.`,
      `Question "${Q1_SINGLE}" with options "${Q1_OPT_A}" and "${Q1_OPT_B}".`,
      "Do not answer. After the user responds, briefly confirm what was received.",
    ].join(" ");

    await sendV4Prompt(prompt);
    await waitForV4TimelineContaining(`${MARKER_EMPTY_SUBMIT}_${runId}`);
    await waitForToolCallBlockByToolName("AskUserQuestion", 60000);

    await waitForElicitationVisible(Q1_SINGLE);
    await expectNoOptionPreSelected();

    await clickPrimaryAction();

    await waitForUpstreamRequest(
      {
        includes: [`${MARKER_EMPTY_SUBMIT}_${runId}`, "toolu_e2e_adf_empty_submit"],
      },
      "Agent received no reply after empty answer submission",
      60000,
    );
  });

  it("Press Tab to focus first item when unfocused, Enter to select and advance", async function () {
    this.timeout(180000);

    await prepareV4ConversationE2E();

    const runId = Date.now();
    const prompt = [
      `${MARKER_TAB_ENTER}_${runId}: Trigger AskUserQuestion with two questions.`,
      `Q1 single-select "${Q1_SINGLE}" with options "${Q1_OPT_A}" and "${Q1_OPT_B}".`,
      `Q2 single-select "${Q2_MULTI}" with options "${Q2_OPT_A}" and "${Q2_OPT_B}".`,
      "Do not answer. After the user responds, briefly confirm what was received.",
    ].join(" ");

    await sendV4Prompt(prompt);
    await waitForV4TimelineContaining(`${MARKER_TAB_ENTER}_${runId}`);
    await waitForToolCallBlockByToolName("AskUserQuestion", 60000);

    await waitForElicitationVisible(Q1_SINGLE);
    await expectNoOptionPreSelected();

    await browser.keys("Tab");
    await expectActiveOption(Q1_OPT_A);

    await browser.keys("Enter");
    await waitForElicitationPage("2 / 2", Q2_MULTI);

    await expectNoOptionPreSelected();

    await browser.keys("ArrowDown");
    await expectActiveOption(Q2_OPT_A);
    await expectOptionSelected(Q2_OPT_A, false);
    await browser.keys("Enter");

    await waitForUpstreamRequest(
      { includes: [`${MARKER_TAB_ENTER}_${runId}`, Q1_OPT_A, Q2_OPT_A] },
      "Tab+Enter selection result did not enter next model request",
      60000,
    );
  });

  it("Press Enter directly when unfocused to skip current question and advance", async function () {
    this.timeout(180000);

    await prepareV4ConversationE2E();

    const runId = Date.now();
    const prompt = [
      `${MARKER_ENTER_SKIP}_${runId}: Trigger AskUserQuestion with two single-select questions.`,
      `Q1 "${Q1_SINGLE}" with options "${Q1_OPT_A}" and "${Q1_OPT_B}".`,
      `Q2 "${Q2_MULTI}" with options "${Q2_OPT_A}" and "${Q2_OPT_B}".`,
      "Do not answer. After the user responds, briefly confirm what was received.",
    ].join(" ");

    await sendV4Prompt(prompt);
    await waitForV4TimelineContaining(`${MARKER_ENTER_SKIP}_${runId}`);
    await waitForToolCallBlockByToolName("AskUserQuestion", 60000);

    await waitForElicitationVisible(Q1_SINGLE);
    await expectNoOptionPreSelected();

    await browser.keys("Enter");
    await waitForElicitationPage("2 / 2", Q2_MULTI);

    await expectNoOptionPreSelected();
    await browser.keys("Escape");
    await waitForElicitationPage("1 / 2", Q1_SINGLE);
    await expectNoOptionPreSelected();

    await browser.keys("Enter");
    await waitForElicitationPage("2 / 2", Q2_MULTI);

    await browser.keys("Tab");
    await expectActiveOption(Q2_OPT_A);
    await browser.keys("Enter");

    await waitForUpstreamRequest(
      {
        includes: [`${MARKER_ENTER_SKIP}_${runId}`, "toolu_e2e_adf_enter_skip", Q2_OPT_A],
      },
      "Q1 skip + Q2 Enter selection did not enter model request",
      60000,
    );
  });

  it("Multi-select: Space to check/uncheck, Enter to confirm and submit", async function () {
    this.timeout(180000);

    await prepareV4ConversationE2E();

    const runId = Date.now();
    const prompt = [
      `${MARKER_MULTISELECT}_${runId}: Trigger AskUserQuestion with one multi-select question.`,
      `Multi-select question "${Q2_MULTI}"`,
      `with options "${Q2_OPT_A}", "${Q2_OPT_B}", "${Q2_OPT_C}".`,
      "Do not answer. After the user responds, briefly confirm what was received.",
    ].join(" ");

    await sendV4Prompt(prompt);
    await waitForV4TimelineContaining(`${MARKER_MULTISELECT}_${runId}`);
    await waitForToolCallBlockByToolName("AskUserQuestion", 60000);

    await waitForElicitationVisible(Q2_MULTI);
    await expectNoOptionSelected();

    await browser.keys("Tab");
    await expectActiveOption(Q2_OPT_A);

    await browser.keys(" ");
    await expectOptionChecked(Q2_OPT_A, true);

    await browser.keys("ArrowDown");
    await browser.keys(" ");
    await expectOptionChecked(Q2_OPT_B, true);

    await browser.keys("ArrowDown");
    await browser.keys(" ");
    await expectOptionChecked(Q2_OPT_C, true);

    await browser.keys("ArrowUp");
    await browser.keys(" ");
    await expectOptionChecked(Q2_OPT_B, false);

    await browser.keys("Enter");

    await waitForUpstreamRequest(
      { includes: [`${MARKER_MULTISELECT}_${runId}`, Q2_OPT_A, Q2_OPT_C] },
      "Multi-select Space + Enter result did not enter model request",
      60000,
    );
  });

  it("Press Escape when first question has no focused option to close entire Q&A set", async function () {
    this.timeout(180000);

    await prepareV4ConversationE2E();

    const runId = Date.now();
    const prompt = [
      `${MARKER_ESCAPE_DISMISS}_${runId}: Trigger AskUserQuestion with one single-select question.`,
      `Question "${Q1_SINGLE}" with options "${Q1_OPT_A}" and "${Q1_OPT_B}".`,
      "Do not answer. Stop if the user dismisses the question.",
    ].join(" ");

    await sendV4Prompt(prompt);
    await waitForV4TimelineContaining(`${MARKER_ESCAPE_DISMISS}_${runId}`);
    await waitForToolCallBlockByToolName("AskUserQuestion", 60000);
    await waitForElicitationVisible(Q1_SINGLE);
    await expectNoOptionPreSelected();

    await browser.keys("Escape");
    await waitForElicitationClosed();
    await waitForUpstreamRequest(
      {
        includes: [
          `${MARKER_ESCAPE_DISMISS}_${runId}`,
          "toolu_e2e_adf_escape_dismiss",
          "AskUserQuestion was declined",
        ],
      },
      "Declined tool_result did not enter model concluding request after Escape dismiss",
      60000,
    );
    await waitForV4TimelineContaining("E2E_ADF_ESCAPE_DISMISS_ACK", 60000);
  });
});

// --- helpers ---

interface ElicitationKeyboardSnapshot {
  activeText: string;
  bodyText: string;
  cardFocused: boolean;
  pageText: string | null;
  selectedTexts: string[];
  visible: boolean;
}

async function waitForElicitationVisible(questionContains: string) {
  let latest: ElicitationKeyboardSnapshot | null = null;
  try {
    await browser.waitUntil(
      async () => {
        latest = await getElicitationKeyboardSnapshot();
        return latest.visible && latest.bodyText.includes(questionContains);
      },
      {
        timeout: 60000,
        timeoutMsg: `AskUserQuestion 弹窗没有出现orinner容不包含 "${questionContains}"`,
      },
    );
  } catch (error) {
    latest = await getElicitationKeyboardSnapshot();
    throw new Error(`AskUserQuestion 弹窗没有出现; snapshot=${JSON.stringify(latest)}`, {
      cause: error,
    });
  }
}

async function waitForElicitationPage(pageText: string, questionContains: string) {
  let latest: ElicitationKeyboardSnapshot | null = null;
  try {
    await browser.waitUntil(
      async () => {
        latest = await getElicitationKeyboardSnapshot();
        return (
          latest.visible &&
          latest.pageText === pageText &&
          latest.bodyText.includes(questionContains)
        );
      },
      {
        timeout: 60000,
        timeoutMsg: `AskUserQuestion 没有进入Target题目 ${pageText} ${questionContains}`,
      },
    );
  } catch (error) {
    latest = await getElicitationKeyboardSnapshot();
    throw new Error(
      `AskUserQuestion 没有进入Target题目; expected=${pageText}/${questionContains}; snapshot=${JSON.stringify(latest)}`,
      { cause: error },
    );
  }
}

async function expectNoOptionPreSelected() {
  let latest: ElicitationKeyboardSnapshot | null = null;
  try {
    await browser.waitUntil(
      async () => {
        latest = await getElicitationKeyboardSnapshot();
        return latest.cardFocused && latest.activeText === "" && latest.selectedTexts.length === 0;
      },
      {
        timeout: 10000,
        timeoutMsg: "AskUserQuestion 弹窗不应有预选选项",
      },
    );
  } catch (error) {
    latest = await getElicitationKeyboardSnapshot();
    throw new Error(`AskUserQuestion modal should not have preselected options; snapshot=${JSON.stringify(latest)}`, {
      cause: error,
    });
  }
}

async function expectNoOptionSelected() {
  let latest: ElicitationKeyboardSnapshot | null = null;
  try {
    await browser.waitUntil(
      async () => {
        latest = await getElicitationKeyboardSnapshot();
        return latest.selectedTexts.length === 0;
      },
      {
        timeout: 10000,
        timeoutMsg: "AskUserQuestion 弹窗不应有已选选项",
      },
    );
  } catch (error) {
    latest = await getElicitationKeyboardSnapshot();
    throw new Error(`AskUserQuestion modal should not have selected options; snapshot=${JSON.stringify(latest)}`, {
      cause: error,
    });
  }
}

async function expectActiveOption(optionText: string) {
  let latest: ElicitationKeyboardSnapshot | null = null;
  try {
    await browser.waitUntil(
      async () => {
        latest = await getElicitationKeyboardSnapshot();
        return latest.activeText.includes(optionText);
      },
      {
        timeout: 10000,
        timeoutMsg: `AskUserQuestion Current焦点选项不Yes "${optionText}"`,
      },
    );
  } catch (error) {
    latest = await getElicitationKeyboardSnapshot();
    throw new Error(
      `AskUserQuestion Current焦点选项不Yes "${optionText}"; snapshot=${JSON.stringify(latest)}`,
      { cause: error },
    );
  }
}

async function expectOptionChecked(optionText: string, checked: boolean) {
  let latest: ElicitationKeyboardSnapshot | null = null;
  try {
    await browser.waitUntil(
      async () => {
        latest = await getElicitationKeyboardSnapshot();
        const isSelected = latest.selectedTexts.some((t) => t.includes(optionText));
        return isSelected === checked;
      },
      {
        timeout: 10000,
        timeoutMsg: `AskUserQuestion 勾选Status不符合预期; option=${optionText} expectedChecked=${checked}`,
      },
    );
  } catch (error) {
    latest = await getElicitationKeyboardSnapshot();
    throw new Error(
      `AskUserQuestion 勾选Status不符合预期; option=${optionText} expectedChecked=${checked}; snapshot=${JSON.stringify(latest)}`,
      { cause: error },
    );
  }
}

async function expectOptionSelected(optionText: string, selected: boolean) {
  let latest: ElicitationKeyboardSnapshot | null = null;
  try {
    await browser.waitUntil(
      async () => {
        latest = await getElicitationKeyboardSnapshot();
        const isSelected = latest.selectedTexts.some((text) => text.includes(optionText));
        return isSelected === selected;
      },
      {
        timeout: 10000,
        timeoutMsg: `AskUserQuestion 单选Status不符合预期; option=${optionText} expectedSelected=${selected}`,
      },
    );
  } catch (error) {
    latest = await getElicitationKeyboardSnapshot();
    throw new Error(
      `AskUserQuestion 单选Status不符合预期; option=${optionText} expectedSelected=${selected}; snapshot=${JSON.stringify(latest)}`,
      { cause: error },
    );
  }
}

async function clickPrimaryAction() {
  const button = await $('[data-elicitation-dialog-footer="true"] button:last-child');
  await button.waitForDisplayed({ timeout: 10000 });
  await button.click();
}

async function waitForElicitationClosed() {
  await browser.waitUntil(
    async () =>
      !(await browser.execute(() =>
        Boolean(document.querySelector('[data-elicitation-dialog-card="true"]')),
      )),
    {
      timeout: 10000,
      timeoutMsg: "AskUserQuestion 弹窗没有在 Escape 后关闭",
    },
  );
}

function getElicitationKeyboardSnapshot(): Promise<ElicitationKeyboardSnapshot> {
  return browser.execute(() => {
    const normalizeText = (value: string | null | undefined) =>
      (value ?? "").replace(/\u00a0/g, " ").trim();
    const body = document.querySelector<HTMLElement>('[data-elicitation-dialog-body="true"]');
    const focused = document.activeElement as HTMLElement | null;
    const card = document.querySelector<HTMLElement>('[data-elicitation-dialog-card="true"]');
    const activeOption = focused?.closest<HTMLElement>('button[role="option"],[role="checkbox"]');
    const pageText =
      normalizeText(body?.innerText)
        .match(/\b\d+\s*\/\s*\d+\b/)?.[0]
        ?.replace(/\s+/g, " ") ?? null;
    const selectedTexts = Array.from(
      body?.querySelectorAll<HTMLElement>(
        'button[role="option"][aria-selected="true"],[role="checkbox"][aria-checked="true"]',
      ) ?? [],
    ).map((element) => normalizeText(element.innerText));

    return {
      activeText: normalizeText(activeOption?.innerText),
      bodyText: normalizeText(body?.innerText),
      cardFocused: focused === card,
      pageText,
      selectedTexts,
      visible: Boolean(body),
    };
  });
}
