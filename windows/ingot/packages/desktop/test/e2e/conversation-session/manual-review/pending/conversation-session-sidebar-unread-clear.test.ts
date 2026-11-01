import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TID_TASK_ITEM, testId } from "@origin-ai/cf-shared/test-ids";
import { clearAppData, clickTestIdByDom } from "../../../helpers/desktop-app.js";
import {
  getV4PaneSnapshot,
  prepareV4ConversationE2E,
  selectV4TaskById,
  sendV4Prompt,
  startNewV4Draft,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";
import { ensureUpstreamProviderForE2E } from "../../../helpers/upstream-provider.js";

const CASE_TIMEOUT_MS = 120_000;
const SEED_MARKER = "E2E_SIDEBAR_UNREAD_CLEAR_SEED";
const REPLY_MARKER = "SIDEBAR_UNREAD_CLEAR_OK";
const MARK_UNREAD_LABELS = ["标记为未读", "Mark as unread"];

describe("TSL04: Open task after right-clicking sidebar to mark as unread", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("点击同一任务立即清除蓝点，并把 tasks-index 持久化为已读", async function () {
    this.timeout(CASE_TIMEOUT_MS);

    await prepareV4ConversationE2E();
    await ensureUpstreamProviderForE2E();
    await sendV4Prompt(`${SEED_MARKER}: Reply with exactly "${REPLY_MARKER}".`);
    await waitForV4TimelineContaining(REPLY_MARKER, 45_000);
    await waitForV4Pane(
      (snapshot) => Boolean(snapshot.sessionId && snapshot.sessionId !== "draft"),
      "未读清除 case 没有建立正式 session",
      45_000,
    );
    const taskId = (await getV4PaneSnapshot()).sessionId;
    if (!taskId || taskId === "draft") {
      throw new Error(`未读清除 case Missing taskId: ${String(taskId)}`);
    }

    await waitForTaskRow(taskId);
    await waitForTaskIndexUnread(taskId, null, "New task initial state is not read");

    await markTaskUnreadFromContextMenu(taskId);
    await waitForTaskUnreadIndicator(taskId, true, "右键标记未读后没有显示蓝点");
    await waitForTaskIndexUnread(taskId, "number", "Right-clicking mark as unread did not write to tasks-index");

    await clickTestIdByDom(testId(TID_TASK_ITEM, taskId), {
      timeout: 15_000,
      timeoutMsg: "Task row is not clickable after marking as unread",
    });
    await waitForTaskUnreadIndicator(taskId, false, "打开未读 task 后蓝点没有消失");
    await waitForTaskIndexUnread(taskId, null, "tasks-index remains unread after opening unread task");

    await startNewV4Draft();
    await selectV4TaskById(taskId);
    await waitForTaskUnreadIndicator(taskId, false, "切走再返回后未读蓝点重新出现");
    await waitForTaskIndexUnread(taskId, null, "切走再返回后 tasks-index 未读状态反弹");
  });
});

async function waitForTaskRow(taskId: string) {
  await browser.waitUntil(
    () =>
      browser.execute(
        (taskItemTestId) => Boolean(document.querySelector(`[data-testid="${taskItemTestId}"]`)),
        testId(TID_TASK_ITEM, taskId),
      ),
    {
      timeout: 30_000,
      timeoutMsg: `Sidebar没有出现 task 行: ${taskId}`,
    },
  );
}

async function markTaskUnreadFromContextMenu(taskId: string) {
  const opened = await browser.execute(
    (taskItemTestId) => {
      const row = document.querySelector<HTMLElement>(`[data-testid="${taskItemTestId}"]`);
      if (!row) {
        return false;
      }
      const rect = row.getBoundingClientRect();
      row.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }),
      );
      return true;
    },
    testId(TID_TASK_ITEM, taskId),
  );
  expect(opened).toBe(true);

  await browser.waitUntil(
    () =>
      browser.execute(
        (labels) =>
          Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).some((item) =>
            labels.includes((item.textContent ?? "").trim()),
          ),
        MARK_UNREAD_LABELS,
      ),
    {
      timeout: 15_000,
      timeoutMsg: "\"Mark as unread\" did not appear in task context menu",
    },
  );

  const clicked = await browser.execute((labels) => {
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (candidate) => labels.includes((candidate.textContent ?? "").trim()),
    );
    item?.click();
    return Boolean(item);
  }, MARK_UNREAD_LABELS);
  expect(clicked).toBe(true);
}

async function waitForTaskUnreadIndicator(taskId: string, expected: boolean, timeoutMsg: string) {
  await browser.waitUntil(
    () =>
      browser
        .execute(
          (taskItemTestId) =>
            Boolean(
              document
                .querySelector<HTMLElement>(`[data-testid="${taskItemTestId}"]`)
                ?.querySelector('[data-unread-indicator="true"]'),
            ),
          testId(TID_TASK_ITEM, taskId),
        )
        .then((visible) => visible === expected),
    { timeout: 15_000, timeoutMsg },
  );
}

async function waitForTaskIndexUnread(
  taskId: string,
  expected: "number" | null,
  timeoutMsg: string,
) {
  await browser.waitUntil(
    () => {
      const unreadAt = readTaskIndexUnread(taskId);
      return expected === "number" ? typeof unreadAt === "number" : unreadAt === null;
    },
    { timeout: 15_000, timeoutMsg },
  );
}

function readTaskIndexUnread(taskId: string): number | null | undefined {
  const db = new DatabaseSync(join(homedir(), ".cf", "v2", "tasks-index.sqlite"));
  try {
    const row = db.prepare("select unread_at from tasks where task_id = ?").get(taskId) as
      | { unread_at?: number | null }
      | undefined;
    return row?.unread_at;
  } finally {
    db.close();
  }
}
