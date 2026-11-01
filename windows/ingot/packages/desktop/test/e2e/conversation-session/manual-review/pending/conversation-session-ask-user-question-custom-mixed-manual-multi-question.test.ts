import {
  TID_CHAT_ASSISTANT_HISTORY_TRIGGER,
  TID_CHAT_TOOL_CALL_BLOCK,
  TID_TOOL_SUMMARY_TRIGGER,
} from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  expectNoUpstreamRequestForTextWithin,
  prepareConversationE2E,
  sendPrompt,
  waitForComposerText,
  waitForUpstreamRequest,
  waitForToolCallBlockByToolName,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";

const PROMPT_MARKER = "E2E_ASK_USER_QUESTION_CUSTOM_MIXED_MANUAL_MULTI";
const TOOL_MARKER = "E2E_ASK_USER_QUESTION_MIXED_MANUAL_MULTI_TOOL";
const QUESTION_ONE_MARKER = "E2E_AQ_MIXED_MANUAL_MULTI_Q1_CUSTOM";
const QUESTION_TWO_MARKER = "E2E_AQ_MIXED_MANUAL_MULTI_Q2_CUSTOM";
const QUESTION_THREE_MARKER = "E2E_AQ_MIXED_MANUAL_MULTI_Q3_CUSTOM";
const ANSWER_ONE_MARKER = "E2E_AQ_MIXED_MANUAL_MULTI_A1";
const ANSWER_TWO_MARKER = "E2E_AQ_MIXED_MANUAL_MULTI_A2";
const ANSWER_THREE_MARKER = "E2E_AQ_MIXED_MANUAL_MULTI_A3";

describe("Chat area AskUserQuestion multi-question custom input character-by-character mixed submission E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Mixing mouse and Enter after typing custom answers character-by-character for all three questions should not lose intermediate questions", async function () {
    this.timeout(180000);

    await prepareConversationE2E();

    const runId = Date.now();
    const prompt = [
      `${PROMPT_MARKER}_${runId}: Trigger the AskUserQuestion tool exactly once.`,
      `${TOOL_MARKER}: ask exactly three questions in one AskUserQuestion call.`,
      `Question 1 text must include ${QUESTION_ONE_MARKER}.`,
      `Question 2 text must include ${QUESTION_TWO_MARKER}.`,
      `Question 3 text must include ${QUESTION_THREE_MARKER}.`,
      "Each question should provide exactly two non-Other options; the client will provide the custom answer input.",
      "The user will type custom answers with the keyboard, click Continue for the first question, press Enter for the second question, and click Submit for the third question.",
      "After the user answers all questions, continue with a brief acknowledgement.",
    ].join(" ");
    const firstAnswer = `${ANSWER_ONE_MARKER}_${runId}`;
    const secondAnswer = `${ANSWER_TWO_MARKER}_${runId}`;
    const thirdAnswer = `${ANSWER_THREE_MARKER}_${runId}`;

    await sendPrompt(prompt);
    await waitForComposerText("", "Input box was not cleared after mixed submission multi-question initial send in AskUserQuestion");
    await waitForUserMessageContaining(`${PROMPT_MARKER}_${runId}`);
    await waitForToolCallBlockByToolName("AskUserQuestion", 60000);

    await waitForElicitationPage("1 / 3", QUESTION_ONE_MARKER);
    await typeCustomElicitationAnswer(firstAnswer);
    await clickPrimaryElicitationAction(["继续", "Continue"]);

    await waitForElicitationPage("2 / 3", QUESTION_TWO_MARKER, 10000);
    await expectNoUpstreamRequestForTextWithin(firstAnswer, 900);
    await typeCustomAnswerAndPressEnter(secondAnswer);

    await waitForElicitationPage("3 / 3", QUESTION_THREE_MARKER, 10000);
    await expectNoUpstreamRequestForTextWithin(secondAnswer, 900);
    await typeCustomElicitationAnswer(thirdAnswer);
    await clickPrimaryElicitationAction(["提交", "Submit"]);

    await waitForUpstreamRequest(
      {
        includes: [firstAnswer, secondAnswer, thirdAnswer, TOOL_MARKER],
      },
      "AskUserQuestion mixed submission of three custom answers did not include all answers in the next model request",
      60000,
    );

    await waitForExpandedAskUserQuestionBlockContaining(firstAnswer, 8000);
    await waitForExpandedAskUserQuestionBlockContaining(secondAnswer, 8000);
    await waitForExpandedAskUserQuestionBlockContaining(thirdAnswer, 8000);
    await expectNoFailedAskUserQuestionBlockForMarkers([
      QUESTION_ONE_MARKER,
      QUESTION_TWO_MARKER,
      QUESTION_THREE_MARKER,
    ]);
  });
});

async function typeCustomAnswerAndPressEnter(answer: string) {
  await typeCustomElicitationAnswer(answer);
  await browser.keys("Enter");
}

async function typeCustomElicitationAnswer(answer: string) {
  const input = await getCustomElicitationInput();
  await input.click();
  await browser.keys(answer);
  await browser.waitUntil(async () => (await input.getValue()) === answer, {
    timeout: 10000,
    timeoutMsg: "AskUserQuestion custom response was not typed character-by-character into the input box",
  });
}

async function getCustomElicitationInput() {
  const input = await $('[data-elicitation-dialog-body="true"] textarea');
  await input.waitForDisplayed({
    timeout: 30000,
    timeoutMsg: "AskUserQuestion 自定义回答输入框没有出现",
  });
  return input;
}

async function clickPrimaryElicitationAction(actionLabels: string[]) {
  const footer = await $('[data-elicitation-dialog-footer="true"]');
  await footer.waitForDisplayed({
    timeout: 10000,
    timeoutMsg: "AskUserQuestion 操作按钮区域没有出现",
  });

  const buttons = await footer.$$("button");
  const actualLabels: string[] = [];
  for (const button of buttons) {
    const label = normalizeText(await button.getText());
    actualLabels.push(label);
    if (actionLabels.includes(label)) {
      await button.click();
      return;
    }
  }

  throw new Error(
    `AskUserQuestion 鼠Label操作按钮没有出现: expected=${actionLabels.join("|")}; actual=${actualLabels.join("|")}`,
  );
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(/\u00a0/g, " ").trim();
}

async function waitForElicitationPage(
  pageText: string,
  questionText: string,
  timeout = 60000,
) {
  let latest = "";
  try {
    await browser.waitUntil(
      async () => {
        latest = await getElicitationDialogText();
        return latest.includes(pageText) && latest.includes(questionText);
      },
      {
        timeout,
        timeoutMsg: `AskUserQuestion QuestionAnswer卡片没有进入Target题目: ${pageText} ${questionText}`,
      },
    );
  } catch (error) {
    latest = await getElicitationDialogText();
    throw new Error(
      `AskUserQuestion QuestionAnswer卡片没有进入Target题目: ${pageText} ${questionText}; latest=${latest}`,
      { cause: error },
    );
  }
}

function getElicitationDialogText() {
  return browser.execute(() => {
    const normalizeText = (value: string | null | undefined) =>
      (value ?? "").replace(/\u00a0/g, " ").trim();
    return normalizeText(
      document.querySelector<HTMLElement>('[data-elicitation-dialog-body="true"]')?.innerText,
    );
  });
}

async function waitForExpandedAskUserQuestionBlockContaining(text: string, timeout: number) {
  let latest: AskUserQuestionBlockDiagnostics | null = null;
  try {
    await browser.waitUntil(
      async () => {
        latest = await getExpandedAskUserQuestionBlockDiagnostics(text);
        return latest.matched;
      },
      {
        timeout,
        timeoutMsg: "AskUserQuestion custom response was not displayed in asked message details",
      },
    );
  } catch (error) {
    latest = await getExpandedAskUserQuestionBlockDiagnostics(text);
    throw new Error(
      `AskUserQuestion custom answer was not displayed in the asked message details; diagnostics=${JSON.stringify(latest)}`,
      { cause: error },
    );
  }
}

async function expectNoFailedAskUserQuestionBlockForMarkers(markers: string[]) {
  const diagnostics = await getAskUserQuestionBlockDiagnostics();
  const failureTexts = ["失败", "Failed", "未提供回答", "No response provided", "未回答"];
  const failedBlocks = diagnostics.blocks.filter(
    (block) =>
      markers.every((marker) => block.text.includes(marker)) &&
      failureTexts.some((failureText) => block.text.includes(failureText)),
  );

  if (failedBlocks.length > 0) {
    throw new Error(
      `AskUserQuestion MixedSubmit后额outer出现UnansweredorFailed的同组Issue块; diagnostics=${JSON.stringify(
        diagnostics,
      )}`,
    );
  }
}

interface AskUserQuestionBlocksDiagnostics {
  blocks: AskUserQuestionBlockSnapshot[];
}

interface AskUserQuestionBlockDiagnostics extends AskUserQuestionBlocksDiagnostics {
  matched: boolean;
}

interface AskUserQuestionBlockSnapshot {
  expanded: boolean;
  text: string;
  toolCallId: string | null;
}

async function getExpandedAskUserQuestionBlockDiagnostics(
  text: string,
): Promise<AskUserQuestionBlockDiagnostics> {
  const diagnostics = await getAskUserQuestionBlockDiagnostics();
  return {
    ...diagnostics,
    matched: diagnostics.blocks.some((block) => block.text.includes(text)),
  };
}

function getAskUserQuestionBlockDiagnostics(): Promise<AskUserQuestionBlocksDiagnostics> {
  return browser.execute(
    (historyTriggerPrefix, toolBlockPrefix, summaryTriggerPrefix) => {
      const normalizeText = (value: string | null | undefined) =>
        (value ?? "").replace(/\u00a0/g, " ").trim();
      const historyTriggers = Array.from(
        document.querySelectorAll<HTMLElement>(`[data-testid^="${historyTriggerPrefix}-"]`),
      );
      for (const trigger of historyTriggers) {
        if (
          trigger.getAttribute("data-history-has-content") === "true" &&
          trigger.getAttribute("aria-expanded") !== "true"
        ) {
          trigger.click();
        }
      }

      const blocks = Array.from(
        document.querySelectorAll<HTMLElement>(
          `[data-testid^="${toolBlockPrefix}-"][data-tool-name="AskUserQuestion"]`,
        ),
      );

      for (const block of blocks) {
        const trigger = block.querySelector<HTMLElement>(
          `[data-testid^="${summaryTriggerPrefix}-"]`,
        );
        if (trigger && trigger.getAttribute("aria-expanded") !== "true") {
          trigger.click();
        }
      }

      const snapshots = blocks.map((block) => {
        const trigger = block.querySelector<HTMLElement>(
          `[data-testid^="${summaryTriggerPrefix}-"]`,
        );
        return {
          expanded: trigger?.getAttribute("aria-expanded") === "true",
          text: normalizeText(block.innerText),
          toolCallId: block.getAttribute("data-tool-call-id"),
        };
      });

      return {
        blocks: snapshots,
      };
    },
    TID_CHAT_ASSISTANT_HISTORY_TRIGGER,
    TID_CHAT_TOOL_CALL_BLOCK,
    TID_TOOL_SUMMARY_TRIGGER,
  );
}
