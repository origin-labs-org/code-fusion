import { TID_TASK_ITEM, TID_WORKSPACE_TITLE, testId } from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  getTaskStoreSnapshot,
  prepareConversationE2E,
  sendPrompt,
  waitForAssistantMessageContaining,
  waitForChatState,
  waitForComposerText,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";

const PROMPT_MARKER = "E2E_TITLE_SIDECAR_TIMEOUT";
const SKILL_LINK =
  "[$e2e-case-lifecycle](/Users/dev/workspace/z-code/.agents/skills/e2e-case-lifecycle/SKILL.md)";
const FINAL_TOKEN = "e2e-title-timeout-ok";
const GENERATED_TITLE = "e2e-case-lifecycle 技能说明";

describe("conversation session title generation timeout", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Task title should still be written back when message starts with skill link and title sidecar takes longer than 15s but less than 60s", async function () {
    this.timeout(120000);

    await prepareConversationE2E();

    const runId = Date.now();
    const prompt =
      `${SKILL_LINK} ${PROMPT_MARKER}_${runId}: 请用One句话Answer，并且Final answer必须只包含 ${FINAL_TOKEN}`;
    await sendPrompt(prompt);
    await waitForComposerText("", "Input box was not cleared after initial send in title timeout case");
    await waitForUserMessageContaining(PROMPT_MARKER);

    const runningSnapshot = await waitForChatState(
      (snapshot) => Boolean(snapshot.sessionId || snapshot.taskId),
      "Task was not created after initial send in title timeout case",
      30000,
    );
    const taskId = runningSnapshot.sessionId || runningSnapshot.taskId;
    if (!taskId) {
      throw new Error("Title timeout case missing taskId; cannot assert title writeback");
    }

    await waitForAssistantMessageContaining(FINAL_TOKEN);
    await waitForChatState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      "Session did not return to idle after main response completed in title timeout case",
      90000,
    );

    await waitForGeneratedTaskTitle(taskId);
    await waitForHeaderTitle(GENERATED_TITLE);
    await waitForTaskItemTitle(taskId, GENERATED_TITLE);
  });
});

async function waitForGeneratedTaskTitle(taskId: string) {
  let latestTitle: string | null = null;
  await browser.waitUntil(
    async () => {
      const snapshot = await getTaskStoreSnapshot(taskId);
      latestTitle = snapshot.taskMeta?.title ?? null;
      return latestTitle === GENERATED_TITLE;
    },
    {
      timeout: 70000,
      timeoutMsg: `Title sidecar 没有在 60s timeout inner回写生成Title，latest=${latestTitle}`,
    },
  );
}

async function waitForHeaderTitle(expectedTitle: string) {
  await browser.waitUntil(
    async () =>
      browser.execute((titleTestId, title) => {
        const header = document.querySelector<HTMLElement>(
          `[data-testid="${titleTestId}"]`,
        );
        return (
          header?.innerText.includes(title) ||
          header?.getAttribute("title") === title
        );
      }, TID_WORKSPACE_TITLE, expectedTitle),
    {
      timeout: 10000,
      timeoutMsg: `WorkspaceHeader 没有展示生成Title: ${expectedTitle}`,
    },
  );
}

async function waitForTaskItemTitle(taskId: string, expectedTitle: string) {
  const taskItemTestId = testId(TID_TASK_ITEM, taskId);
  await browser.waitUntil(
    async () =>
      browser.execute((itemTestId, title) => {
        const item = document.querySelector<HTMLElement>(
          `[data-testid="${itemTestId}"]`,
        );
        return item?.innerText.includes(title) ?? false;
      }, taskItemTestId, expectedTitle),
    {
      timeout: 10000,
      timeoutMsg: `Tasklist没有展示生成Title: ${expectedTitle}`,
    },
  );
}
