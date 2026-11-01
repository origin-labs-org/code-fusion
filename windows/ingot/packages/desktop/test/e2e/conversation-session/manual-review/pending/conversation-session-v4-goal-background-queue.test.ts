import { TID_V4_COMPOSER } from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  countUpstreamRequests,
  findFirstUpstreamRequestIndex,
  getUpstreamRequestRecordCount,
  waitForUpstreamRequest,
} from "../../../helpers/conversation-session-network.js";
import {
  getV4GoalProjection,
  getV4PaneSnapshot,
  getV4QueueItems,
  prepareV4ConversationE2E,
  sendV4Prompt,
  switchV4Mode,
  waitForV4Pane,
  waitForV4QueueCount,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

const E2E_TIMEOUT_MS = 180000;

describe("BG34 v4 goal background queue", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Directly send background-only input; automatically consume future queue after verifier passes", async function () {
    this.timeout(E2E_TIMEOUT_MS);
    await prepareV4ConversationE2E();
    await switchV4Mode("yolo");

    await sendV4Prompt("E2E_BACKGROUND_GOAL_SEED establish the v4 session");
    await waitForV4TimelineContaining("background-goal-seed-ok", 45000);
    await waitForV4Pane(
      (snapshot) => snapshot.sessionId !== null && snapshot.sessionId !== "draft",
      "Session was not created after BG34 seed",
      45000,
    );

    const goal =
      '/goal E2E_BACKGROUND_GOAL: Finish only after consuming the background agent result and then reply with "upstream-e2e-ok".';
    const directPrompt =
      "E2E_BACKGROUND_GOAL_DIRECT_PROMPT: Send this immediately while the goal background Agent is still running.";
    const verifierQueuePrompt =
      "E2E_BACKGROUND_GOAL_VERIFIER_QUEUE: Drain this only after the verifier marks the goal complete.";
    const requestsBeforeGoal = await getUpstreamRequestRecordCount();

    await sendV4Prompt(goal);
    await waitForV4TimelineContaining("background-goal-agent-launched-ok", 60000);
    await waitForV4Pane(
      (snapshot) => !snapshot.canStop,
      "background Agent launch 后 main turn 没有先回到 idle",
      45000,
    );
    expect((await getV4GoalProjection())?.status).toBe("active");
    expect(await getComposerInputRouting()).toBe("startNow");

    const launchIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BACKGROUND_GOAL", "Async agent launched successfully"],
      },
      requestsBeforeGoal - 1,
      "goal background Agent launch tool result 没有进入父模型请求",
    );

    await sendV4Prompt(directPrompt);
    expect(await getV4QueueItems()).toHaveLength(0);
    const directIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BACKGROUND_GOAL_DIRECT_PROMPT"],
        lastUserMessageIncludes: ["E2E_BACKGROUND_GOAL_DIRECT_PROMPT"],
      },
      launchIndex,
      "Regular messages did not directly enter provider request when active goal only had background Agent left",
    );
    await waitForV4TimelineContaining("background-goal-direct-prompt-ok", 45000);
    await waitForV4Pane(
      (snapshot) => !snapshot.canStop,
      "background-only 普通消息完成后 main turn 没有回到 idle",
      45000,
    );

    const notificationIndex = await waitForFirstRequestIndex(
      {
        includes: ["<task-notification>", "E2E_BACKGROUND_GOAL_CHILD_RESULT"],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      directIndex,
      "goal background Agent completion notification was not included in parent model request",
    );
    await waitForV4TimelineContaining("E2E_BACKGROUND_GOAL_NOTIFICATION_CONSUMED", 60000);
    const verifierIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BACKGROUND_GOAL", "Verify whether the active session goal"],
      },
      notificationIndex,
      "goal verifier was not triggered after background notification",
    );

    await sendV4Prompt(verifierQueuePrompt);
    await waitForV4QueueCount(1, 30000);
    expect((await getV4QueueItems())[0]?.text).toContain(
      "E2E_BACKGROUND_GOAL_VERIFIER_QUEUE",
    );
    expect(
      await countUpstreamRequests(
        {
          includes: ["E2E_BACKGROUND_GOAL_VERIFIER_QUEUE"],
          lastUserMessageIncludes: ["E2E_BACKGROUND_GOAL_VERIFIER_QUEUE"],
        },
        { afterIndex: verifierIndex },
      ),
    ).toBe(0);

    await browser.waitUntil(
      async () => (await getV4GoalProjection())?.status === "verified",
      {
        timeout: 90000,
        timeoutMsg: "background goal verifier 没有把 target 标记为 complete",
      },
    );
    const drainedIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BACKGROUND_GOAL_VERIFIER_QUEUE"],
        lastUserMessageIncludes: ["E2E_BACKGROUND_GOAL_VERIFIER_QUEUE"],
      },
      verifierIndex,
      "Did not automatically consume future queue after TargetChanged(complete)",
    );
    expect(drainedIndex).toBeGreaterThan(verifierIndex);
    await waitForV4TimelineContaining("background-goal-verifier-queue-drained-ok", 60000);
    await waitForV4QueueCount(0, 30000);
    expect((await getV4GoalProjection())?.status).toBe("verified");
    expect((await getV4PaneSnapshot()).timelineText).toContain(
      "E2E_BACKGROUND_GOAL_VERIFIER_QUEUE",
    );
  });
});

async function getComposerInputRouting() {
  return browser.execute((composerTestId) => {
    return (
      document
        .querySelector<HTMLElement>(`[data-testid="${composerTestId}"]`)
        ?.getAttribute("data-input-routing") ?? null
    );
  }, TID_V4_COMPOSER);
}

async function waitForFirstRequestIndex(
  query: Parameters<typeof waitForUpstreamRequest>[0],
  afterIndex: number,
  timeoutMsg: string,
) {
  await waitForUpstreamRequest(query, timeoutMsg, 60000, { afterIndex });
  const index = await findFirstUpstreamRequestIndex(query, { afterIndex });
  if (index === null) {
    throw new Error(`${timeoutMsg}; request disappeared after wait`);
  }
  return index;
}
