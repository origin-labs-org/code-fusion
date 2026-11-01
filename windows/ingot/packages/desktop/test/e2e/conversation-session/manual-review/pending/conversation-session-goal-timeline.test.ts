import {
  TID_CHAT_ASSISTANT_MESSAGE,
  TID_CHAT_GOAL_VERIFICATION_MARKER,
  TID_CHAT_MESSAGES,
  TID_CHAT_USER_MESSAGE,
} from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  clickChatStop,
  prepareConversationE2E,
  countUpstreamRequests,
  getChatRootSnapshot,
  sendPrompt,
  waitForAssistantMessageContaining,
  waitForChatState,
  waitForComposerText,
  waitForUpstreamRequest,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";

const GOAL_MARKER_PREFIX = "E2E_GOAL_TIMELINE_REPRO";
const GOAL_A_MARKER = `${GOAL_MARKER_PREFIX}_A`;
const GOAL_B_MARKER = `${GOAL_MARKER_PREFIX}_B`;
const FIRST_REPLY = "After humanity went extinct, the machine wept.";
const FINAL_REPLY = "After humanity went extinct, the machine wept.";
const SECOND_TARGET_REPLY = "This requires a full-length serialization; 100,000 words cannot be delivered all at once.";
interface GoalTimelineExpectation {
  label: string;
  texts: readonly string[];
}

const FIRST_TARGET_TIMELINE_STEPS = [
  {
    label: "iteration-1-incomplete",
    texts: [
      "Iteration 1 · Goal not achieved, task continues",
      "Iteration 1 · Goal incomplete, continuing",
    ],
  },
  {
    label: "iteration-2-complete",
    texts: [
      "Iteration 2 · Goal achieved, task ended",
      "Iteration 2 · Goal complete, ending task",
    ],
  },
] as const satisfies readonly GoalTimelineExpectation[];

const NEW_TARGET_TIMELINE_STEP = {
  label: "new-target-iteration-1",
  texts: [
    "第 1 次迭代 · 目标校验中",
    "Iteration 1 · Verifying goal",
    "Iteration 1 · Goal not achieved, task continues",
    "Iteration 1 · Goal incomplete, continuing",
  ],
} as const satisfies GoalTimelineExpectation;

const EXPECTED_TIMELINE_STEPS = [
  ...FIRST_TARGET_TIMELINE_STEPS,
  {
    ...NEW_TARGET_TIMELINE_STEP,
  },
] as const satisfies readonly GoalTimelineExpectation[];

interface ConversationEntrySnapshot {
  id: string | null;
  kind: "assistant" | "goalTimeline" | "user";
  text: string;
  title: string | null;
}

describe("Session area Goal Timeline E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Auto-continuation for the same target and verifier timeline for a new target should not cross into the same turn sequence", async function () {
    this.timeout(180000);

    await prepareConversationE2E();

    const objective = `${GOAL_A_MARKER}: 写One篇恰OK 10 个汉Character的科幻小说。不要Call tool。`;
    await sendPrompt(`/goal ${objective}`);
    await waitForComposerText("", "goal timeline: Input box was not cleared after sending /goal");
    await waitForUserMessageContaining(objective);

    await waitForUpstreamRequest(
      {
        excludes: [FINAL_REPLY],
        includes: [GOAL_A_MARKER, "Verify whether the active session goal"],
      },
      "goal timeline: Failed to capture 1st verifier request",
      90000,
    );
    await waitForAssistantMessageContaining(FIRST_REPLY);

    await waitForUpstreamRequest(
      {
        includes: [
          GOAL_A_MARKER,
          FINAL_REPLY,
          "Verify whether the active session goal",
        ],
      },
      "goal timeline: Failed to capture 2nd verifier request",
      120000,
    );
    await waitForAssistantMessageContaining(FINAL_REPLY);
    await waitForChatState(
      (snapshot) =>
        snapshot.state !== "streaming" &&
        snapshot.queueCount === 0 &&
        snapshot.targetObjective?.includes(GOAL_A_MARKER) === true &&
        (snapshot.targetStatus === "complete" ||
          snapshot.targetStatus === "completed"),
      "goal timeline: First goal eventually failed to return to completed state",
      120000,
    );
    await waitForGoalTimelineTexts(FIRST_TARGET_TIMELINE_STEPS);

    const secondTargetObjective = `${GOAL_B_MARKER}: 写One篇 10w Character科幻小说。不要Call tool。`;
    await sendPrompt(`/goal ${secondTargetObjective}`);
    await waitForComposerText(
      "",
      "goal timeline: Input box was not cleared after sending second /goal",
    );
    await waitForUserMessageContaining(secondTargetObjective);
    await waitForAssistantMessageContaining(SECOND_TARGET_REPLY);
    await waitForUpstreamRequest(
      {
        includes: [
          GOAL_B_MARKER,
          SECOND_TARGET_REPLY,
          "Verify whether the active session goal",
        ],
      },
      "goal timeline: Failed to capture 3rd verifier request for new target",
      120000,
    );
    const entries = await waitForGoalTimelineTexts(EXPECTED_TIMELINE_STEPS);
    await stopIfStreaming();

    expect(
      await countUpstreamRequests({
        includes: [
          GOAL_MARKER_PREFIX,
          "Verify whether the active session goal",
        ],
      }),
    ).toBeGreaterThanOrEqual(3);

    const timelineTexts = entries
      .filter((entry) => entry.kind === "goalTimeline")
      .map((entry) => normalizeEntryText(entry.text));

    expect(
      resolveGoalTimelineSteps(timelineTexts, EXPECTED_TIMELINE_STEPS),
    ).toEqual(
      EXPECTED_TIMELINE_STEPS.map((step) => step.label),
    );

    const firstAssistantIndex = findEntryIndex(
      entries,
      "assistant",
      FIRST_REPLY,
    );
    const firstTimelineIndex = findEntryIndex(
      entries,
      "goalTimeline",
      EXPECTED_TIMELINE_STEPS[0],
    );
    const finalTimelineIndex = findEntryIndex(
      entries,
      "goalTimeline",
      EXPECTED_TIMELINE_STEPS[1],
    );
    const secondTargetUserIndex = findEntryIndex(
      entries,
      "user",
      secondTargetObjective,
    );
    const secondTargetTimelineIndex = findEntryIndexFrom(
      entries,
      "goalTimeline",
      NEW_TARGET_TIMELINE_STEP,
      finalTimelineIndex + 1,
    );

    const orderSnapshot = {
      entries,
      firstAssistantIndex,
      firstTimelineIndex,
      finalTimelineIndex,
      secondTargetUserIndex,
      secondTargetTimelineIndex,
    };
    if (
      firstAssistantIndex < 0 ||
      firstTimelineIndex < 0 ||
      finalTimelineIndex < 0 ||
      secondTargetUserIndex < 0 ||
      secondTargetTimelineIndex < 0
    ) {
      throw new Error(
        `goal timeline: Missing预期Messagesor timeline: ${JSON.stringify(
          orderSnapshot,
          null,
          2,
        )}`,
      );
    }
    expect(firstAssistantIndex).toBeLessThan(firstTimelineIndex);
    expect(firstTimelineIndex).toBeLessThan(finalTimelineIndex);
    expect(secondTargetUserIndex).toBeLessThan(secondTargetTimelineIndex);
    expect(finalTimelineIndex).toBeLessThan(secondTargetTimelineIndex);
  });
});

async function stopIfStreaming() {
  const snapshot = await getChatRootSnapshot();
  if (snapshot.state !== "streaming" && snapshot.runtimeStatus !== "streaming") {
    return;
  }

  await clickChatStop();
  await waitForChatState(
    (latest) =>
      latest.state !== "streaming" && latest.runtimeStatus !== "streaming",
    "goal timeline: Failed to exit streaming after teardown stop",
    30000,
  );
}

async function waitForGoalTimelineTexts(
  expectedSteps: readonly GoalTimelineExpectation[],
) {
  let entries: ConversationEntrySnapshot[] = [];
  let timelineTexts: string[] = [];
  let timelineSteps: Array<string | null> = [];
  await browser.waitUntil(
    async () => {
      entries = await getConversationEntrySnapshot();
      timelineTexts = entries
        .filter((entry) => entry.kind === "goalTimeline")
        .map((entry) => normalizeEntryText(entry.text));
      timelineSteps = resolveGoalTimelineSteps(timelineTexts, expectedSteps);
      return expectedSteps.every(
        (step, index) => timelineSteps[index] === step.label,
      );
    },
    {
      timeout: 30000,
      timeoutMsg: `goal timeline: 没有看到Completed后的Target校验序列, expected=${JSON.stringify(
        expectedSteps.map((step) => step.label),
      )}, actual=${JSON.stringify(timelineSteps)}, texts=${JSON.stringify(
        timelineTexts,
      )}, entries=${JSON.stringify(entries)}`,
    },
  );
  return entries;
}

function getConversationEntrySnapshot(): Promise<ConversationEntrySnapshot[]> {
  return browser.execute(
    (messagesTestId, userPrefix, assistantPrefix, goalVerificationPrefix) => {
      const root = document.querySelector<HTMLElement>(
        `[data-testid="${messagesTestId}"]`,
      );
      if (!root) return [];

      const candidates = Array.from(
        root.querySelectorAll<HTMLElement>(
          [
            `[data-testid^="${userPrefix}-"]`,
            `[data-testid^="${assistantPrefix}-"]`,
            `[data-testid^="${goalVerificationPrefix}-"]`,
          ].join(","),
        ),
      );

      const entries: ConversationEntrySnapshot[] = [];
      for (const element of candidates) {
        const text = (element.innerText || element.textContent || "")
          .replace(/\u00a0/g, " ")
          .trim();
        if (!text) continue;
        if (element.matches(`[data-testid^="${userPrefix}-"]`)) {
          entries.push({
            id: element.getAttribute("data-message-id"),
            kind: "user",
            text,
            title: element.getAttribute("title"),
          });
          continue;
        }
        if (element.matches(`[data-testid^="${assistantPrefix}-"]`)) {
          entries.push({
            id: element.getAttribute("data-message-id"),
            kind: "assistant",
            text,
            title: element.getAttribute("title"),
          });
          continue;
        }
        if (element.matches(`[data-testid^="${goalVerificationPrefix}-"]`)) {
          entries.push({
            id: element.getAttribute("data-message-id"),
            kind: "goalTimeline",
            text,
            title: element.getAttribute("title"),
          });
        }
      }
      return entries;
    },
    TID_CHAT_MESSAGES,
    TID_CHAT_USER_MESSAGE,
    TID_CHAT_ASSISTANT_MESSAGE,
    TID_CHAT_GOAL_VERIFICATION_MARKER,
  );
}

function normalizeEntryText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeGoalTimelineText(text: string) {
  const normalized = normalizeEntryText(text);
  const match = EXPECTED_TIMELINE_STEPS.find((step) =>
    matchesGoalTimelineText(normalized, step),
  );
  return match?.label ?? null;
}

function resolveGoalTimelineSteps(
  timelineTexts: readonly string[],
  expectedSteps: readonly GoalTimelineExpectation[],
) {
  return expectedSteps.map((step, index) =>
    matchesGoalTimelineText(timelineTexts[index] ?? "", step)
      ? step.label
      : normalizeGoalTimelineText(timelineTexts[index] ?? ""),
  );
}

function matchesGoalTimelineText(
  text: string,
  expected: GoalTimelineExpectation,
) {
  const normalized = normalizeEntryText(text);
  return expected.texts.includes(normalized);
}

function findEntryIndex(
  entries: readonly ConversationEntrySnapshot[],
  kind: ConversationEntrySnapshot["kind"],
  text: string | GoalTimelineExpectation,
) {
  return findEntryIndexFrom(entries, kind, text, 0);
}

function findEntryIndexFrom(
  entries: readonly ConversationEntrySnapshot[],
  kind: ConversationEntrySnapshot["kind"],
  text: string | GoalTimelineExpectation,
  fromIndex: number,
) {
  return entries.findIndex(
    (entry, index) =>
      index >= fromIndex &&
      entry.kind === kind &&
      entryMatchesText(entry, text),
  );
}

function entryMatchesText(
  entry: ConversationEntrySnapshot,
  text: string | GoalTimelineExpectation,
) {
  if (typeof text === "string") {
    return entry.text.includes(text);
  }

  return matchesGoalTimelineText(entry.text, text);
}
