import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TID_TASK_ITEM, testId } from "@origin-ai/cf-shared/test-ids";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  waitForDefaultWorkspaceReady,
} from "../../../helpers/desktop-app.js";
import {
  getV4PaneSnapshot,
  prepareV4ConversationE2E,
  sendV4Prompt,
  startNewV4Draft,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

const CASE_TIMEOUT_MS = 150_000;
const PROMPT_MARKER = "E2E_TASK_CREATED_PROJECT_ROW";
const REPLY_MARKER = "TASK_CREATED_PROJECT_ROW_OK";

describe("TSL26：task_created 换代 Project task-row 快照", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Optimistic row converges to a single persistent row after initial draft send and persists on refresh", async function () {
    this.timeout(CASE_TIMEOUT_MS);

    await prepareV4ConversationE2E();
    expect((await getV4PaneSnapshot()).sessionId).toBe("draft");
    expect(readWorkspaceTaskCount()).toBe(0);

    await sendV4Prompt(`${PROMPT_MARKER}: Reply with exactly "${REPLY_MARKER}" and no other text.`);
    const bound = await waitForV4Pane(
      (snapshot) => Boolean(snapshot.sessionId && snapshot.sessionId !== "draft"),
      "Pane did not bind to formal task after initial draft send",
      45_000,
    );
    const taskId = bound.sessionId;
    if (!taskId || taskId === "draft") {
      throw new Error(`TSL26 Initial turnMissingFormal taskId: ${String(taskId)}`);
    }

    await waitForPersistedTask(taskId);
    await waitForSingleProjectRow(taskId, "Project did not immediately display a single row after task row persisted");
    await waitForV4TimelineContaining(REPLY_MARKER, 60_000);
    await waitForV4Pane((snapshot) => !snapshot.canStop, "TSL26 first round did not complete", 60_000);

    await startNewV4Draft();
    await waitForSingleProjectRow(taskId, "退出 active task 后持久 Project 行消失或重复");

    await browser.refresh();
    await waitForDefaultWorkspaceReady(45_000);
    await waitForV4Pane(
      (snapshot) => snapshot.sessionId === "draft",
      "Unsent draft was not restored after renderer reload",
      45_000,
    );
    await waitForSingleProjectRow(taskId, "renderer reload 后持久 Project 行消失或重复");
    expect(readWorkspaceTaskCount()).toBe(1);
  });
});

async function waitForPersistedTask(taskId: string) {
  await browser.waitUntil(() => readWorkspaceTaskIds().includes(taskId), {
    timeout: 30_000,
    timeoutMsg: `tasks-index 没有SubmitInitial turn task: ${taskId}`,
  });
}

async function waitForSingleProjectRow(taskId: string, timeoutMsg: string) {
  await browser.waitUntil(
    () =>
      browser.execute(
        (taskItemTestId) =>
          document.querySelectorAll(`[data-testid="${taskItemTestId}"]`).length === 1,
        testId(TID_TASK_ITEM, taskId),
      ),
    { timeout: 30_000, timeoutMsg },
  );
}

function readWorkspaceTaskCount(): number {
  return readWorkspaceTaskIds().length;
}

function readWorkspaceTaskIds(): string[] {
  const database = new DatabaseSync(join(homedir(), ".cf", "v2", "tasks-index.sqlite"), {
    readOnly: true,
  });
  try {
    const rows = database
      .prepare("select task_id from tasks where workspace_key = ? and deleted = 0 order by task_id")
      .all(DEFAULT_WORKSPACE) as Array<{ task_id: string }>;
    return rows.map((row) => row.task_id);
  } finally {
    database.close();
  }
}
