import {
  TID_CHAT_ASSISTANT_HISTORY_TRIGGER,
  TID_CHAT_TOOL_CALL_BLOCK,
  TID_TOOL_SUMMARY_TRIGGER,
} from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  prepareConversationE2E,
  sendPrompt,
  waitForComposerText,
  waitForUpstreamRequest,
  waitForToolCallBlockByToolName,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";

const PROMPT_MARKER = "E2E_ASK_USER_QUESTION_ANSWER_VISIBLE";
const LEGACY_TOOL_MARKER = "E2E_TOOL_CROSS_PRODUCT_ASK_USER_QUESTION";
const ANSWER_MARKER = "E2E_ASK_USER_QUESTION_CUSTOM_ANSWER";

describe("Chat area AskUserQuestion Q&A response visibility E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Custom Q&A responses should remain in AskUserQuestion message after being consumed by agent", async function () {
    this.timeout(150000);

    await prepareConversationE2E();

    const runId = Date.now();
    const prompt = [
      `${PROMPT_MARKER}_${runId}: Trigger the AskUserQuestion tool exactly once.`,
      `${LEGACY_TOOL_MARKER}: ask a single question before continuing.`,
      "After the user answers, continue with a brief acknowledgement.",
    ].join(" ");
    const answer = `${ANSWER_MARKER}_${runId}`;

    await sendPrompt(prompt);
    await waitForComposerText("", "Input box was not cleared after initial AskUserQuestion send");
    await waitForUserMessageContaining(`${PROMPT_MARKER}_${runId}`);
    await waitForToolCallBlockByToolName("AskUserQuestion", 60000);

    await waitForElicitationDialog();
    await submitCustomElicitationAnswer(answer);

    await waitForUpstreamRequest(
      {
        includes: [answer, LEGACY_TOOL_MARKER],
      },
      "AskUserQuestion custom response was not included in the next model request",
      60000,
    );

    await waitForExpandedAskUserQuestionBlockContaining(answer, 8000);
  });
});

async function waitForElicitationDialog() {
  let latest = "";
  try {
    await browser.waitUntil(
      async () => {
        latest = await getElicitationDialogText();
        return latest.length > 0;
      },
      {
        timeout: 60000,
        timeoutMsg: "AskUserQuestion Q&A card did not appear",
      },
    );
  } catch (error) {
    latest = await getElicitationDialogText();
    throw new Error(`AskUserQuestion card did not appear; latest=${latest}`, {
      cause: error,
    });
  }
}

async function submitCustomElicitationAnswer(answer: string) {
  const input = await $('[data-elicitation-dialog-body="true"] textarea');
  await input.waitForDisplayed({
    timeout: 30000,
    timeoutMsg: "AskUserQuestion 自定义回答输入框没有出现",
  });
  await input.setValue(answer);
  await browser.waitUntil(async () => (await input.getValue()) === answer, {
    timeout: 10000,
    timeoutMsg: "Custom AskUserQuestion answer was not entered into input box",
  });

  const clicked = (await browser.execute(() => {
    const normalizeText = (value: string | null | undefined) =>
      (value ?? "").replace(/\u00a0/g, " ").trim();
    const footer = document.querySelector<HTMLElement>(
      '[data-elicitation-dialog-footer="true"]',
    );
    const button = Array.from(
      footer?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((candidate) => {
      const text = normalizeText(candidate.textContent);
      return text === "提交" || text === "Submit";
    });
    button?.click();
    return Boolean(button);
  })) as boolean;
  expect(clicked).toBe(true);
}

function getElicitationDialogText() {
  return browser.execute(() => {
    const normalizeText = (value: string | null | undefined) =>
      (value ?? "").replace(/\u00a0/g, " ").trim();
    return normalizeText(
      document.querySelector<HTMLElement>(
        '[data-elicitation-dialog-body="true"]',
      )?.innerText,
    );
  });
}

async function waitForExpandedAskUserQuestionBlockContaining(
  text: string,
  timeout: number,
) {
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
      `AskUserQuestion custom answer was not displayed in the asked message details; diagnostics=${JSON.stringify(
        latest,
      )}`,
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
    (
      historyTriggerPrefix,
      toolBlockPrefix,
      summaryTriggerPrefix,
      expectedText,
    ) => {
      const normalizeText = (value: string | null | undefined) =>
        (value ?? "").replace(/\u00a0/g, " ").trim();
      const historyTriggers = Array.from(
        document.querySelectorAll<HTMLElement>(
          `[data-testid^="${historyTriggerPrefix}-"]`,
        ),
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
