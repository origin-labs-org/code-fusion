import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { encodeCustomModelValue } from "@origin-ai/cf-shared";
import {
  TID_AUTOMATION_CREATE_MANUALLY,
  TID_AUTOMATION_FORM_PROMPT,
  TID_AUTOMATION_FORM_SUBMIT,
  TID_AUTOMATION_FORM_TITLE,
  TID_AUTOMATION_FREQUENCY_OPTION,
  TID_AUTOMATION_SCHEDULE_ADD,
  TID_AUTOMATIONS_OPEN,
  TID_COMPOSER_WORK_OUTSIDE_PROJECT,
  TID_COMPOSER_WORKSPACE_TRIGGER,
  TID_CONVERSATION_SECTION,
  TID_PROJECT_SECTION,
  TID_TASK_ITEM,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  DEFAULT_CONVERSATION_WORKSPACE,
  clearAppData,
  clickTestIdByDom,
  clickTestIdByWebDriver,
  setInputValueByTestIdDom,
  waitForDefaultWorkspaceReady,
} from "../../../helpers/desktop-app.js";
import {
  prepareV4ConversationE2E,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";
import { reloadElectronSessionSafely } from "../../../helpers/e2e-electron-reload.js";
import { UPSTREAM_MODEL, UPSTREAM_PROVIDER_ID } from "../../../helpers/upstream-provider.js";
import { getUpstreamRequestEvidence } from "../../../helpers/conversation-session-network.js";

const CASE_TIMEOUT_MS = 150_000;
const AUTOMATION_TITLE = "AUTOMATION_UNREAD_CLEAR_TASK";
const RUN_PROMPT = "E2E_AUTOMATION_UNREAD_CLEAR Please report scheduled task completion";
const FINAL_TOKEN = "automation-unread-clear-done";

interface TaskIndexState {
  automationId: string | null;
  taskId: string;
  unreadAt: number | null;
  workspacePath: string;
}

interface AutomationIndexState {
  automationId: string;
  workspacePath: string;
}

describe("TSL38：定时任务后台执行完成后点击清除未读", () => {
  afterEach(async function () {
    if (this.currentTest?.state !== "failed") return;
    const database = new DatabaseSync(join(homedir(), ".cf", "v2", "tasks-index.sqlite"));
    try {
      console.info("[Todo88 legacy automation]", {
        definitions: database
          .prepare(
            "select automation_id, model_selection, enabled, lifecycle_status, next_run_at, dispatch_status, last_error, retry_at from automations where title = ?",
          )
          .all(AUTOMATION_TITLE),
        runs: database
          .prepare("select run_id, model_selection, dispatch_status, error from automation_runs")
          .all(),
      });
      console.info("[Todo88 automation UI]", await browser.execute(() => document.body.innerText));
    } finally {
      database.close();
    }
  });
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("任务空间的 scheduler 执行完成后，点击蓝点清除 UI 与 tasks-index 未读状态", async function () {
    this.timeout(CASE_TIMEOUT_MS);

    await prepareV4ConversationE2E({ resetDraftBeforeProvider: true });
    const automationId = await createScheduledAutomationAndMakeDue();
    const taskId = await waitForScheduledBackgroundUnread(automationId);
    assertMigratedAutomationSelection(automationId);
    const requests = await getUpstreamRequestEvidence({ lastUserMessageIncludes: [RUN_PROMPT] });
    expect(
      requests.some(
        (request) => request.fixtureId === "upstream-conversation-automation-run-unread-clear-main",
      ),
    ).toBe(true);
    expect(requests.at(-1)?.requestJson).toMatchObject({
      model: UPSTREAM_MODEL,
      output_config: { effort: "high" },
    });

    await openUnreadTaskAndWaitUntilRead(taskId, "scheduler");
  });
});

async function waitForScheduledBackgroundUnread(automationId: string): Promise<string> {
  await browser.waitUntil(() => Boolean(readLatestUnreadTaskIndexState(automationId)), {
    timeout: 35_000,
    timeoutMsg: "Execution session with unread_at was not created after scheduler task execution completed",
  });
  const state = readLatestUnreadTaskIndexState(automationId);
  if (!state) {
    throw new Error("Execution session missing after scheduler task execution completed");
  }
  if (state.workspacePath !== DEFAULT_CONVERSATION_WORKSPACE) {
    throw new Error(
      `Scheduled TasksexecuteSessionError落入Project空间：expected=${DEFAULT_CONVERSATION_WORKSPACE}; actual=${state.workspacePath}`,
    );
  }
  await waitForTaskUnreadIndicator(
    state.taskId,
    true,
    "Blue dot not displayed in 'Tasks' section after scheduler task execution completed",
  );
  await assertTaskOnlyInConversationSection(state.taskId);
  return state.taskId;
}

async function openUnreadTaskAndWaitUntilRead(taskId: string, runLabel: string): Promise<void> {
  const unreadIndicator = await browser.$(
    `[data-testid="${TID_CONVERSATION_SECTION}"] [data-testid="${testId(TID_TASK_ITEM, taskId)}"] [data-unread-indicator="true"]`,
  );
  await unreadIndicator.waitForClickable({
    timeout: 15_000,
    timeoutMsg: runLabel + "定时任务执行会话的蓝点不可点击",
  });
  await unreadIndicator.click();
  await waitForV4TimelineContaining(FINAL_TOKEN, 30_000);
  await waitForTaskUnreadIndicator(taskId, false, runLabel + "点击定时任务执行会话后蓝点没有消失");
  await waitForTaskIndexState(
    taskId,
    (state) => state?.unreadAt === null,
    runLabel + "tasks-index unread_at was still not cleared after clicking scheduled task execution session",
  );
}

async function createScheduledAutomationAndMakeDue(): Promise<string> {
  await clickTestIdByDom(TID_AUTOMATIONS_OPEN, {
    timeoutMsg: "侧栏没有出现 Automations 入口",
  });
  await clickTestIdByDom(TID_AUTOMATION_CREATE_MANUALLY, {
    timeoutMsg: "No manual creation entry point for scheduled tasks",
  });
  await clickTestIdByWebDriver(TID_COMPOSER_WORKSPACE_TRIGGER, {
    timeoutMsg: "Scheduled task creation page lacks workspace selector",
  });
  await clickTestIdByDom(TID_COMPOSER_WORK_OUTSIDE_PROJECT, {
    timeoutMsg: "Scheduled task workspace menu lacks 'Do not work in project' entry",
  });
  await setInputValueByTestIdDom(TID_AUTOMATION_FORM_TITLE, AUTOMATION_TITLE);
  await setInputValueByTestIdDom(TID_AUTOMATION_FORM_PROMPT, RUN_PROMPT);
  await clickTestIdByWebDriver(TID_AUTOMATION_SCHEDULE_ADD, {
    timeoutMsg: "Scheduled task creation page missing add schedule entry",
  });
  await clickTestIdByDom(testId(TID_AUTOMATION_FREQUENCY_OPTION, "daily"), {
    timeoutMsg: "添加日程菜单没有每天选项",
  });
  await clickTestIdByDom(TID_AUTOMATION_FORM_SUBMIT, {
    timeoutMsg: "定时任务创建按钮不可点击",
  });
  const automation = await waitForAutomationByTitle(AUTOMATION_TITLE);
  if (automation.workspacePath !== DEFAULT_CONVERSATION_WORKSPACE) {
    throw new Error(
      `Scheduled TasksErrorBindProject空间：expected=${DEFAULT_CONVERSATION_WORKSPACE}; actual=${automation.workspacePath}`,
    );
  }
  await reloadElectronSessionSafely(browser, {
    afterElectronProcessExit: async () => seedLegacyAutomationSelection(automation.automationId),
  });
  await waitForDefaultWorkspaceReady(30_000);
  await clickTestIdByDom(TID_AUTOMATIONS_OPEN);
  const database = new DatabaseSync(join(homedir(), ".cf", "v2", "tasks-index.sqlite"));
  try {
    database
      .prepare("update automations set next_run_at = ? where automation_id = ?")
      .run(Date.now(), automation.automationId);
  } finally {
    database.close();
  }
  return automation.automationId;
}

async function waitForTaskUnreadIndicator(
  taskId: string,
  expected: boolean,
  timeoutMsg: string,
): Promise<void> {
  await browser.waitUntil(
    () =>
      browser
        .execute(
          (conversationSectionTestId, taskItemTestId) =>
            Boolean(
              document
                .querySelector<HTMLElement>('[data-testid="' + conversationSectionTestId + '"]')
                ?.querySelector('[data-testid="' + taskItemTestId + '"]')
                ?.querySelector('[data-unread-indicator="true"]'),
            ),
          TID_CONVERSATION_SECTION,
          testId(TID_TASK_ITEM, taskId),
        )
        .then((visible) => visible === expected),
    { timeout: 15_000, timeoutMsg },
  );
}

async function assertTaskOnlyInConversationSection(taskId: string): Promise<void> {
  const taskItemTestId = testId(TID_TASK_ITEM, taskId);
  const placement = await browser.execute(
    (conversationSectionTestId, projectSectionTestId, itemTestId) => ({
      inConversation: Boolean(
        document
          .querySelector(`[data-testid="${conversationSectionTestId}"]`)
          ?.querySelector(`[data-testid="${itemTestId}"]`),
      ),
      inProject: Boolean(
        document
          .querySelector(`[data-testid="${projectSectionTestId}"]`)
          ?.querySelector(`[data-testid="${itemTestId}"]`),
      ),
    }),
    TID_CONVERSATION_SECTION,
    TID_PROJECT_SECTION,
    taskItemTestId,
  );
  if (!placement.inConversation || placement.inProject) {
    throw new Error(`Scheduled TasksexecuteSession没有只出现在「Task」分区：${JSON.stringify(placement)}`);
  }
}

async function waitForTaskIndexState(
  taskId: string,
  predicate: (state: TaskIndexState | null) => boolean,
  timeoutMsg: string,
): Promise<void> {
  await browser.waitUntil(() => predicate(readTaskIndexState(taskId)), {
    timeout: 15_000,
    timeoutMsg,
  });
}

function readTaskIndexState(taskId: string): TaskIndexState | null {
  const database = new DatabaseSync(join(homedir(), ".cf", "v2", "tasks-index.sqlite"));
  try {
    const row = database
      .prepare(
        `select task_id as taskId, cron_automation_id as automationId,
                unread_at as unreadAt, workspace_path as workspacePath
         from tasks where task_id = ?`,
      )
      .get(taskId) as TaskIndexState | undefined;
    return row ?? null;
  } finally {
    database.close();
  }
}

function readLatestUnreadTaskIndexState(automationId: string): TaskIndexState | null {
  const database = new DatabaseSync(join(homedir(), ".cf", "v2", "tasks-index.sqlite"));
  try {
    const row = database
      .prepare(
        `select task_id as taskId, cron_automation_id as automationId,
                unread_at as unreadAt, workspace_path as workspacePath
         from tasks
         where cron_automation_id = ? and unread_at is not null and deleted = 0
         order by created_at desc, task_id desc
         limit 1`,
      )
      .get(automationId) as TaskIndexState | undefined;
    return row ?? null;
  } finally {
    database.close();
  }
}

async function waitForAutomationByTitle(title: string): Promise<AutomationIndexState> {
  await browser.waitUntil(() => Boolean(readAutomationByTitle(title)), {
    timeout: 15_000,
    timeoutMsg: "定时任务保存后没有写入 automations 表：" + title,
  });
  const automation = readAutomationByTitle(title);
  if (!automation) {
    throw new Error("定时任务保存后缺少 automationId");
  }
  return automation;
}

function readAutomationByTitle(title: string): AutomationIndexState | null {
  const database = new DatabaseSync(join(homedir(), ".cf", "v2", "tasks-index.sqlite"));
  try {
    const row = database
      .prepare(
        `select automation_id as automationId, workspace_path as workspacePath
         from automations where title = ?`,
      )
      .get(title) as AutomationIndexState | undefined;
    return row ?? null;
  } finally {
    database.close();
  }
}

function seedLegacyAutomationSelection(automationId: string): void {
  const database = new DatabaseSync(join(homedir(), ".cf", "v2", "tasks-index.sqlite"));
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    const result = database
      .prepare(
        `update automations set next_run_at = NULL, retry_at = null, running = 0,
           provider = 'cf', model = ?, thought_level = 'high', model_selection = NULL
         where automation_id = ?`,
      )
      .run(encodeCustomModelValue(UPSTREAM_PROVIDER_ID, UPSTREAM_MODEL), automationId);
    if (result.changes !== 1) {
      throw new Error("Failed to advance scheduled task to scheduler expiration window:" + automationId);
    }
  } finally {
    database.close();
  }
}

function assertMigratedAutomationSelection(automationId: string): void {
  const database = new DatabaseSync(join(homedir(), ".cf", "v2", "tasks-index.sqlite"));
  try {
    const row = database
      .prepare(
        "select model, provider, thought_level, model_selection from automations where automation_id = ?",
      )
      .get(automationId)!;
    const expected = {
      providerId: UPSTREAM_PROVIDER_ID,
      modelId: UPSTREAM_MODEL,
      options: { reasoningLevel: "high" },
    };
    expect(JSON.parse(String(row.model_selection))).toEqual(expected);
    expect(row).toMatchObject({
      provider: "cf",
      model: encodeCustomModelValue(UPSTREAM_PROVIDER_ID, UPSTREAM_MODEL),
      thought_level: "high",
    });
    const run = database
      .prepare(
        "select model_selection from automation_runs where automation_id = ? order by created_at desc limit 1",
      )
      .get(automationId)!;
    expect(JSON.parse(String(run.model_selection))).toEqual(expected);
  } finally {
    database.close();
  }
}
