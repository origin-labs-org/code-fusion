import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  testId,
  TID_AUTOMATION_CREATE_MANUALLY,
  TID_AUTOMATION_CREATE_MENU,
  TID_AUTOMATION_CUSTOM_CONFIRM,
  TID_AUTOMATION_CUSTOM_INTERVAL_SELECT,
  TID_AUTOMATION_CUSTOM_REPEAT_EDIT,
  TID_AUTOMATION_FORM_PROMPT,
  TID_AUTOMATION_FORM_SUBMIT,
  TID_AUTOMATION_FORM_TITLE,
  TID_AUTOMATION_FREQUENCY_OPTION,
  TID_AUTOMATION_SCHEDULE_ADD,
  TID_AUTOMATION_SCHEDULE_PREVIEW,
  TID_AUTOMATIONS_LIST,
  TID_AUTOMATIONS_OPEN,
  TID_CRON_CREATE_CARD,
  TID_CRON_CREATE_OPEN,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  clickTestIdByWebDriver,
  setInputValueByTestIdDom,
  waitForTestIdByDom,
} from "../../../helpers/desktop-app.js";
import {
  expandAssistantHistoriesWithContent,
  getToolCallDiagnostics,
} from "../../../helpers/conversation-session-tool-diagnostics.js";
import { waitForToolCallBlockByToolName } from "../../../helpers/conversation-session-tool.js";
import {
  approveV4Permission,
  prepareV4ConversationE2E,
  sendV4Prompt,
  startNewV4Draft,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

const MARKER = "E2E_AUTOMATION_CRON_UPDATE";
const ORIGINAL_TITLE = "E2E_CRON_UPDATE_ORIGINAL";
const UPDATED_TITLE = "E2E_CRON_UPDATE_UPDATED";
const ORIGINAL_PROMPT = "E2E_CRON_UPDATE_ORIGINAL_PROMPT";
const UPDATED_PROMPT = "E2E_CRON_UPDATE_UPDATED_PROMPT";
const FINAL_TOKEN = "E2E_CRON_UPDATE_DONE";
const UPDATED_INTERVAL = 200;
const UPDATED_COMPATIBLE_CRON = "30 10 * * *";

describe("In-Session CronUpdate Existing Scheduled Task E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("UI Creation → CronList → CronUpdate → Update Card → Same Task Details", async function () {
    this.timeout(150000);

    await prepareV4ConversationE2E({ resetDraftBeforeProvider: true });

    await clickTestIdByDom(TID_AUTOMATIONS_OPEN, {
      timeoutMsg: "Scheduled task entry did not appear in sidebar",
    });
    await clickTestIdByWebDriver(TID_AUTOMATION_CREATE_MENU, {
      timeoutMsg: "定时任务创建下拉没有出现",
    });
    await clickTestIdByDom(TID_AUTOMATION_CREATE_MANUALLY, {
      timeoutMsg: "创建下拉没有出现手动创建入口",
    });
    await setInputValueByTestIdDom(TID_AUTOMATION_FORM_TITLE, ORIGINAL_TITLE);
    await setInputValueByTestIdDom(TID_AUTOMATION_FORM_PROMPT, ORIGINAL_PROMPT);
    await clickTestIdByWebDriver(TID_AUTOMATION_SCHEDULE_ADD, {
      timeoutMsg: "Scheduled task creation page missing add schedule entry point",
    });
    await clickTestIdByDom(testId(TID_AUTOMATION_FREQUENCY_OPTION, "daily"), {
      timeoutMsg: "添加调度菜单没有每天选项",
    });
    await clickTestIdByDom(TID_AUTOMATION_FORM_SUBMIT, {
      timeoutMsg: "定时任务创建按钮不可点击",
    });
    await waitForTestIdByDom(TID_AUTOMATIONS_LIST, {
      timeout: 15000,
      timeoutMsg: "Did not return to scheduled tasks list after creation",
    });
    const originalAutomation =
      await waitForAutomationRecordByTitle(ORIGINAL_TITLE);

    await startNewV4Draft();
    await sendV4Prompt(`${MARKER} 请先Query并更New已有的Scheduled Tasks`);
    await waitForV4TimelineContaining(MARKER);
    await waitForToolCallBlockByToolName("CronUpdate", 60000);
    await expandAssistantHistoriesWithContent();
    const pendingDiagnostics = await getToolCallDiagnostics(null);
    const pendingToolNames = pendingDiagnostics.blocks.map(
      (block) => block.toolName,
    );
    expect(pendingToolNames).toContain("CronList");
    expect(pendingToolNames).toContain("CronUpdate");
    expect(pendingToolNames).not.toContain("CronCreate");
    expect(pendingToolNames).not.toContain("CronDelete");
    await approveV4Permission();
    await waitForV4TimelineContaining(FINAL_TOKEN, 90000);
    await waitForV4Pane(
      (snapshot) =>
        snapshot.sessionId !== null &&
        snapshot.sessionId !== "draft" &&
        !snapshot.canStop,
      "CronUpdate 会话没有完成",
      90000,
    );

    await waitForTestIdByDom(TID_CRON_CREATE_CARD, {
      timeout: 15000,
      timeoutMsg: "Update success card was not rendered after CronUpdate completed",
    });
    const cardText = await readTestIdText(TID_CRON_CREATE_CARD);
    expect(cardText).toContain(UPDATED_TITLE);
    expect(cardText).toContain(String(UPDATED_INTERVAL));
    expect(cardText).toContain("10:30");

    const updatedAutomation = readAutomationRecordById(
      originalAutomation.automationId,
    );
    expect(updatedAutomation).toMatchObject({
      automationId: originalAutomation.automationId,
      cronExpr: UPDATED_COMPATIBLE_CRON,
      prompt: UPDATED_PROMPT,
      title: UPDATED_TITLE,
      scheduleRule: {
        unit: "daily",
        interval: UPDATED_INTERVAL,
        hour: 10,
        minute: 30,
      },
    });
    expect(countAutomationRecords()).toBe(1);

    expect(await countTextCodeBlocksInCardTurn()).toBe(0);

    await clickTestIdByDom(TID_CRON_CREATE_OPEN, {
      timeoutMsg: "CronUpdate card lacks a clickable scheduled task details button",
    });
    await waitForTestIdByDom(TID_AUTOMATION_FORM_TITLE, {
      timeout: 15000,
      timeoutMsg: "没有跳转到更新后的定时任务详情",
    });
    expect(await readTestIdValue(TID_AUTOMATION_FORM_TITLE)).toBe(
      UPDATED_TITLE,
    );
    expect(await readTestIdValue(TID_AUTOMATION_FORM_PROMPT)).toBe(
      UPDATED_PROMPT,
    );
    const schedulePreview = await readTestIdText(
      TID_AUTOMATION_SCHEDULE_PREVIEW,
    );
    expect(schedulePreview).toContain(String(UPDATED_INTERVAL));
    expect(schedulePreview).toContain("10:30");
    await clickTestIdByDom(TID_AUTOMATION_CUSTOM_REPEAT_EDIT, {
      timeoutMsg: "No custom repeat edit entry point after CronUpdate",
    });
    await waitForTestIdByDom(TID_AUTOMATION_CUSTOM_INTERVAL_SELECT, {
      timeout: 10000,
      timeoutMsg: "200-day custom interval was not restored after CronUpdate",
    });
    expect(await readTestIdValue(TID_AUTOMATION_CUSTOM_INTERVAL_SELECT)).toBe(
      String(UPDATED_INTERVAL),
    );
    await clickTestIdByDom(TID_AUTOMATION_CUSTOM_CONFIRM, {
      timeoutMsg: "Unable to close custom repeat edit in CronUpdate",
    });
  });
});

interface AutomationRecord {
  automationId: string;
  cronExpr: string;
  prompt: string;
  scheduleRule?: Record<string, unknown>;
  title: string;
}

function automationDatabasePath(): string {
  return join(homedir(), ".cf", "v2", "tasks-index.sqlite");
}

function readAutomationRecordById(
  automationId: string,
): AutomationRecord | null {
  const database = new DatabaseSync(automationDatabasePath(), {
    readOnly: true,
  });
  try {
    const row = database
      .prepare(
        `SELECT automation_id, title, cron_expr, prompt, schedule_rule
         FROM automations
         WHERE automation_id = ?`,
      )
      .get(automationId) as
      | {
          automation_id: string;
          cron_expr: string;
          prompt: string;
          schedule_rule: string | null;
          title: string;
        }
      | undefined;
    return row
      ? {
          automationId: row.automation_id,
          cronExpr: row.cron_expr,
          prompt: row.prompt,
          ...(row.schedule_rule
            ? {
                scheduleRule: JSON.parse(row.schedule_rule) as Record<
                  string,
                  unknown
                >,
              }
            : {}),
          title: row.title,
        }
      : null;
  } finally {
    database.close();
  }
}

async function waitForAutomationRecordByTitle(
  title: string,
): Promise<AutomationRecord> {
  let record: AutomationRecord | null = null;
  await browser.waitUntil(
    async () => {
      const database = new DatabaseSync(automationDatabasePath(), {
        readOnly: true,
      });
      try {
        const row = database
          .prepare(
            `SELECT automation_id, title, cron_expr, prompt
             FROM automations
             WHERE title = ?`,
          )
          .get(title) as
          | {
              automation_id: string;
              cron_expr: string;
              prompt: string;
              title: string;
            }
          | undefined;
        record = row
          ? {
              automationId: row.automation_id,
              cronExpr: row.cron_expr,
              prompt: row.prompt,
              title: row.title,
            }
          : null;
        return record !== null;
      } finally {
        database.close();
      }
    },
    {
      timeout: 10000,
      timeoutMsg: `没有在 automation Data库Medium找到 ${title}`,
    },
  );
  if (!record) throw new Error(`automation Data库记录为空：${title}`);
  return record;
}

function countAutomationRecords(): number {
  const database = new DatabaseSync(automationDatabasePath(), {
    readOnly: true,
  });
  try {
    const row = database
      .prepare("SELECT COUNT(*) AS count FROM automations")
      .get() as {
      count: number;
    };
    return row.count;
  } finally {
    database.close();
  }
}

async function readTestIdText(currentTestId: string): Promise<string> {
  return browser.execute((testId) => {
    const element = document.querySelector<HTMLElement>(
      `[data-testid="${testId}"]`,
    );
    return element?.innerText.trim() ?? "";
  }, currentTestId);
}

async function readTestIdValue(currentTestId: string): Promise<string> {
  return browser.execute((testId) => {
    const element = document.querySelector<
      HTMLInputElement | HTMLTextAreaElement
    >(`[data-testid="${testId}"]`);
    return element?.value ?? "";
  }, currentTestId);
}

async function countTextCodeBlocksInCardTurn(): Promise<number> {
  return browser.execute((cardTestId) => {
    const card = document.querySelector<HTMLElement>(
      `[data-testid="${cardTestId}"]`,
    );
    const turn = card?.closest<HTMLElement>("[data-turn-id]");
    return turn?.querySelectorAll('[data-language="text"]').length ?? -1;
  }, TID_CRON_CREATE_CARD);
}
