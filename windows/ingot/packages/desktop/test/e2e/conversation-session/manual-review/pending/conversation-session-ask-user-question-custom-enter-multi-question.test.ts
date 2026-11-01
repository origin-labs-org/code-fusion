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

const PROMPT_MARKER = "E2E_ASK_USER_QUESTION_CUSTOM_ENTER_MULTI";
const TOOL_MARKER = "E2E_ASK_USER_QUESTION_ENTER_MULTI_TOOL";
const FIRST_QUESTION_MARKER = "E2E_ASK_USER_QUESTION_ENTER_FIRST";
const SECOND_QUESTION_MARKER = "E2E_ASK_USER_QUESTION_ENTER_SECOND";
const FIRST_ANSWER_MARKER = "E2E_ASK_USER_QUESTION_ENTER_FIRST_ANSWER";
const SECOND_ANSWER_MARKER = "E2E_ASK_USER_QUESTION_ENTER_SECOND_ANSWER";

describe("会话区 AskUserQuestion 多题 custom input Enter E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Pressing Enter on non-last custom input question should go to the next question rather than submitting early", async function () {
    this.timeout(150000);

    await prepareConversationE2E();

    const runId = Date.now();
    const prompt = [
      `${PROMPT_MARKER}_${runId}: Trigger the AskUserQuestion tool exactly once.`,
      `${TOOL_MARKER}: ask two questions before continuing.`,
      "The first answer will be submitted by pressing Enter in the custom input.",
      "After the user answers both questions, continue with a brief acknowledgement.",
    ].join(" ");
    const firstAnswer = `${FIRST_ANSWER_MARKER}_${runId}`;
    const secondAnswer = `${SECOND_ANSWER_MARKER}_${runId}`;

    await sendPrompt(prompt);
    await waitForComposerText("", "Input box was not cleared after multi-question initial send in AskUserQuestion");
    await waitForUserMessageContaining(`${PROMPT_MARKER}_${runId}`);
    await waitForToolCallBlockByToolName("AskUserQuestion", 60000);

    await waitForElicitationDialogContaining(FIRST_QUESTION_MARKER);
    await pressEnterInCustomElicitationInput(firstAnswer);

    await waitForElicitationDialogContaining(SECOND_QUESTION_MARKER, 10000);
    await expectNoUpstreamRequestForTextWithin(firstAnswer, 900);

    await submitCustomElicitationAnswer(secondAnswer);

    await waitForUpstreamRequest(
      {
        includes: [firstAnswer, secondAnswer, TOOL_MARKER],
      },
      "AskUserQuestion multi-question custom responses were not included together in the next model request",
      60000,
    );

    await waitForExpandedAskUserQuestionBlockContaining(firstAnswer, 8000);
    await waitForExpandedAskUserQuestionBlockContaining(secondAnswer, 8000);
  });
});

async function pressEnterInCustomElicitationInput(answer: string) {
  const input = await fillCustomElicitationAnswer(answer);
  await input.click();
  await browser.keys("Enter");
}

async function submitCustomElicitationAnswer(answer: string) {
  await fillCustomElicitationAnswer(answer);

  const clicked = (await browser.execute(() => {
    const normalizeText = (value: string | null | undefined) =>
      (value ?? "").replace(/\u00a0/g, " ").trim();
    const footer = document.querySelector<HTMLElement>('[data-elicitation-dialog-footer="true"]');
    const button = Array.from(footer?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
      (candidate) => {
        const text = normalizeText(candidate.textContent);
        return text === "提交" || text === "Submit";
      },
    );
    button?.click();
    return Boolean(button);
  })) as boolean;
  expect(clicked).toBe(true);
}

async function fillCustomElicitationAnswer(answer: string) {
  const input = await $('[data-elicitation-dialog-body="true"] textarea');
  await input.waitForDisplayed({
    timeout: 30000,
    timeoutMsg: "AskUserQuestion 自定义回答输入框没有出现",
  });
  await input.click();
  await input.setValue(answer);
  await browser.waitUntil(async () => (await input.getValue()) === answer, {
    timeout: 10000,
    timeoutMsg: "Custom AskUserQuestion answer was not entered into input box",
  });
  return input;
}

async function waitForElicitationDialogContaining(text: string, timeout = 60000) {
  let latest = "";
  try {
    await browser.waitUntil(
      async () => {
        latest = await getElicitationDialogText();
        return latest.includes(text);
      },
      {
        timeout,
        timeoutMsg: `AskUserQuestion QuestionAnswer卡片没有Show预期inner容: ${text}`,
      },
    );
  } catch (error) {
    latest = await getElicitationDialogText();
    throw new Error(`AskUserQuestion QuestionAnswer卡片没有Show预期inner容: ${text}; latest=${latest}`, {
      cause: error,
    });
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

interface AskUserQuestionBlockDiagnostics {
  blocks: Array<{
    expanded: boolean;
    text: string;
    toolCallId: string | null;
  }>;
  matched: boolean;
}

function getExpandedAskUserQuestionBlockDiagnostics(
  text: string,
): Promise<AskUserQuestionBlockDiagnostics> {
  return browser.execute(
    (historyTriggerPrefix, toolBlockPrefix, summaryTriggerPrefix, expectedText) => {
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
        matched: snapshots.some((block) => block.text.includes(expectedText)),
      };
    },
    TID_CHAT_ASSISTANT_HISTORY_TRIGGER,
    TID_CHAT_TOOL_CALL_BLOCK,
    TID_TOOL_SUMMARY_TRIGGER,
    text,
  );
}
