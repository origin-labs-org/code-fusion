import { TID_V4_COMPOSER_INPUT } from "@origin-ai/cf-shared/test-ids";
import { clearAppData, setInputValueByTestIdDom } from "../helpers/desktop-app.js";
import {
  assertUpstreamRequestCapture,
  assertUpstreamThoughtLevelCapture,
  waitForUpstreamNetworkCapture,
} from "../helpers/upstream-capture.js";
import { UPSTREAM_MODEL, UPSTREAM_PROVIDER_ID } from "../helpers/upstream-provider.js";
import {
  getV4ModelConfig,
  getV4ComposerText,
  prepareV4ConversationE2E,
  selectV4TaskById,
  sendV4Prompt,
  startNewV4Draft,
  switchV4Model,
  waitForV4ComposerSelectionReady,
  waitForV4Pane,
} from "../helpers/v4-conversation.js";
import { isV4TurnCompleted } from "../helpers/v4-turn-completion.js";

const A_SEED_REPLY = "I55_A_SEED_DONE";
const B_SEED_REPLY = "I55_B_SEED_DONE";
const B_FOLLOW_REPLY = "I55_B_FOLLOW_DONE";
const A_FOLLOW_REPLY = "I55_A_FOLLOW_DONE";
const INITIAL_THOUGHT_LEVEL = "high";
const SESSION_A_THOUGHT_LEVEL = "max";

describe("Conversation area thinking depth session isolation E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("I55: Modifying thinking depth for A only should not change thinking depth for B", async function () {
    this.timeout(260000);

    await prepareV4ConversationE2E();

    await waitForV4ComposerSelectionReady();
    await selectSharedModelAndThought(INITIAL_THOUGHT_LEVEL);
    const runId = Date.now();
    const promptASeed = buildPrompt(`E2E_THOUGHT_LEVEL_SESSION_ISOLATION_A_SEED_${runId}`);
    const sessionA = await sendPromptAndAssertThought(
      promptASeed,
      INITIAL_THOUGHT_LEVEL,
      A_SEED_REPLY,
      "First turn of A did not complete",
    );

    await startNewV4Draft();
    await waitForV4ComposerSelectionReady();
    await selectSharedModelAndThought(INITIAL_THOUGHT_LEVEL);
    const promptBSeed = buildPrompt(`E2E_THOUGHT_LEVEL_SESSION_ISOLATION_B_SEED_${runId}`);
    const sessionB = await sendPromptAndAssertThought(
      promptBSeed,
      INITIAL_THOUGHT_LEVEL,
      B_SEED_REPLY,
      "First turn of B did not complete",
    );
    expect(sessionB).not.toBe(sessionA);

    await selectV4TaskById(sessionA);
    await assertSelectedSharedModelAndThought(INITIAL_THOUGHT_LEVEL);
    const promptAFollow = buildPrompt(`E2E_THOUGHT_LEVEL_SESSION_ISOLATION_A_FOLLOW_${runId}`);
    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, promptAFollow);
    await selectSharedModelAndThought(SESSION_A_THOUGHT_LEVEL);

    await selectV4TaskById(sessionB);
    await assertSelectedSharedModelAndThought(INITIAL_THOUGHT_LEVEL);
    const promptBFollow = buildPrompt(`E2E_THOUGHT_LEVEL_SESSION_ISOLATION_B_FOLLOW_${runId}`);
    await sendPromptAndAssertThought(
      promptBFollow,
      INITIAL_THOUGHT_LEVEL,
      B_FOLLOW_REPLY,
      "B follow-up 没有完成",
    );

    await selectV4TaskById(sessionA);
    await assertSelectedSharedModelAndThought(SESSION_A_THOUGHT_LEVEL);
    expect(await getV4ComposerText()).toBe(promptAFollow);
    await sendPromptAndAssertThought(
      promptAFollow,
      SESSION_A_THOUGHT_LEVEL,
      A_FOLLOW_REPLY,
      "A follow-up 没有完成",
    );
  });
});

function buildPrompt(marker: string) {
  return `${marker}: Return the deterministic fixture reply for this marker.`;
}

async function selectSharedModelAndThought(thoughtLevel: string) {
  await switchV4Model(UPSTREAM_PROVIDER_ID, UPSTREAM_MODEL, thoughtLevel);
  await assertSelectedSharedModelAndThought(thoughtLevel);
}

async function sendPromptAndAssertThought(
  prompt: string,
  thoughtLevel: string,
  expectedAssistantReply: string,
  timeoutMsg: string,
) {
  const marker = prompt.split(":")[0] ?? prompt;
  await sendV4Prompt(prompt);
  const record = await waitForUpstreamNetworkCapture(marker);
  assertUpstreamRequestCapture(record, {
    expectedText: prompt,
    model: UPSTREAM_MODEL,
  });
  assertUpstreamThoughtLevelCapture(record, thoughtLevel);
  return waitForCompletedSession(expectedAssistantReply, timeoutMsg);
}

async function assertSelectedSharedModelAndThought(thoughtLevel: string) {
  let latest = await getV4ModelConfig();
  await browser.waitUntil(
    async () => {
      latest = await getV4ModelConfig();
      return (
        latest.provider === UPSTREAM_PROVIDER_ID &&
        latest.model === UPSTREAM_MODEL &&
        latest.thought === thoughtLevel
      );
    },
    {
      timeout: 30000,
      timeoutMsg: `v4 Model Configuration不Yes期望Value: ${JSON.stringify({
        expected: {
          model: UPSTREAM_MODEL,
          provider: UPSTREAM_PROVIDER_ID,
          thought: thoughtLevel,
        },
        latest,
      })}`,
    },
  );
}

async function waitForCompletedSession(expectedAssistantReply: string, timeoutMsg: string) {
  const snapshot = await waitForV4Pane(
    (candidate) => isV4TurnCompleted(candidate, expectedAssistantReply),
    timeoutMsg,
    90000,
  );
  if (!snapshot.sessionId || snapshot.sessionId === "draft") {
    throw new Error(`${timeoutMsg}: sessionId missing`);
  }
  return snapshot.sessionId;
}
