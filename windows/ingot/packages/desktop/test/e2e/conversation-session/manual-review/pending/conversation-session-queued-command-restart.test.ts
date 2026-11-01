import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_WORKSPACE, clearAppData } from "../../../helpers/desktop-app.js";
import { restartIntoWorkspacePreservingProfile } from "../../../helpers/model-provider-restart.js";
import {
  getV4PaneSnapshot,
  prepareV4ConversationE2E,
  selectV4TaskById,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4QueueCount,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";
import { ensureProjectExpanded } from "../../../helpers/project-sidebar.js";

const CASE_TIMEOUT_MS = 180_000;
const PENDING_COMMAND_STORAGE_KEY = "cf-v4-pending-commands:v1";
const RUNNING_MARKER = "E2E_QUEUED_COMMAND_RESTART_RUNNING";
const QUEUED_MARKER = "E2E_QUEUED_COMMAND_RESTART_DISCARDED";

type SessionInputRow = {
  delivery: string;
  payload: string;
  status: string;
  statusReason: string | null;
};

describe("PV4-25Q: restart-discarded queue silently cleared", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Real queued input discarded after App/CLI restart, without showing retry prompt", async function () {
    this.timeout(CASE_TIMEOUT_MS);

    await prepareV4ConversationE2E();
    await sendV4Prompt(`${RUNNING_MARKER}: keep the turn running.`);
    await waitForV4TimelineContaining("QUEUED_COMMAND_RESTART_STREAMING", 60_000);
    const running = await waitForV4Pane(
      (snapshot) =>
        snapshot.canStop && Boolean(snapshot.sessionId && snapshot.sessionId !== "draft"),
      "PV4-25Q did not enter running in the first round",
      60_000,
    );
    const sessionId = requireSessionId(running.sessionId);

    await sendV4Prompt(`${QUEUED_MARKER}: this input must remain runtime-local.`);
    await waitForV4QueueCount(1, 30_000);
    const admitted = await waitForSessionInput(sessionId, "admitted");
    expect(admitted.delivery).toBe("queue");
    const sourceCommandId = readSourceCommandId(admitted.payload);

    await seedPendingSendText(sessionId, sourceCommandId, QUEUED_MARKER);
    expect(await readPendingCommandIds()).toContain(sourceCommandId);

    await restartIntoWorkspacePreservingProfile();
    await ensureProjectExpanded(DEFAULT_WORKSPACE);
    await selectV4TaskById(sessionId);
    await waitForV4Pane(
      (snapshot) => snapshot.sessionId === sessionId,
      "PV4-25Q did not open original session after cold boot",
      60_000,
    );

    const discarded = await waitForSessionInput(sessionId, "discarded");
    expect(discarded).toMatchObject({
      delivery: "queue",
      status: "discarded",
      statusReason: "session_resumed",
    });
    await waitForPendingCommandRemoved(sourceCommandId);

    expect(await hasPendingRecoveryBanner()).toBe(false);
    expect((await getV4PaneSnapshot()).timelineText).not.toContain(QUEUED_MARKER);
  });
});

function requireSessionId(value: string | null): string {
  if (!value || value === "draft") {
    throw new Error(`PV4-25Q Missing sessionId: ${String(value)}`);
  }
  return value;
}

async function waitForSessionInput(
  sessionId: string,
  status: "admitted" | "discarded",
): Promise<SessionInputRow> {
  let latest: SessionInputRow | null = null;
  await browser.waitUntil(
    async () => {
      latest = readSessionInput(sessionId);
      return latest?.status === status;
    },
    {
      timeout: 30_000,
      timeoutMsg: `PV4-25Q session_input 没有进入 ${status}; latest=${JSON.stringify(latest)}`,
    },
  );
  if (!latest) throw new Error(`PV4-25Q Missing ${status} session_input`);
  return latest;
}

function readSessionInput(sessionId: string): SessionInputRow | null {
  const database = new DatabaseSync(join(homedir(), ".cf", "cli", "db", "db.sqlite"), {
    readOnly: true,
  });
  try {
    const row = database
      .prepare(
        `select delivery, payload, status, status_reason
           from session_input
          where session_id = ? and payload like ?
          order by admitted_sequence desc
          limit 1`,
      )
      .get(sessionId, `%${QUEUED_MARKER}%`) as
      | {
          delivery: string;
          payload: string;
          status: string;
          status_reason: string | null;
        }
      | undefined;
    return row
      ? {
          delivery: row.delivery,
          payload: row.payload,
          status: row.status,
          statusReason: row.status_reason,
        }
      : null;
  } finally {
    database.close();
  }
}

function readSourceCommandId(rawPayload: string): string {
  const payload = JSON.parse(rawPayload) as Record<string, unknown>;
  for (const key of ["conversationInputIntent", "intent"]) {
    const intent = payload[key];
    if (!intent || typeof intent !== "object" || Array.isArray(intent)) continue;
    const sourceCommandId = (intent as Record<string, unknown>).sourceCommandId;
    if (typeof sourceCommandId === "string" && sourceCommandId.length > 0) {
      return sourceCommandId;
    }
  }
  throw new Error(`PV4-25Q session_input Missing sourceCommandId: ${rawPayload}`);
}

async function seedPendingSendText(sessionId: string, commandId: string, text: string) {
  await browser.execute(
    (storageKey, currentSessionId, currentCommandId, currentText, now) => {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify([
          {
            commandId: currentCommandId,
            clientId: "e2e-command-recovery",
            sessionId: currentSessionId,
            issuedAt: now,
            expiresAt: now + 60_000,
            replay: {
              kind: "input",
              type: "sendText",
              payload: { text: currentText, attachments: [] },
            },
          },
        ]),
      );
    },
    PENDING_COMMAND_STORAGE_KEY,
    sessionId,
    commandId,
    text,
    Date.now(),
  );
}

function readPendingCommandIds(): Promise<string[]> {
  return browser.execute((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    try {
      const entries = JSON.parse(raw) as Array<{ commandId?: unknown }>;
      return entries.flatMap((entry) =>
        typeof entry.commandId === "string" ? [entry.commandId] : [],
      );
    } catch {
      return ["<invalid-json>"];
    }
  }, PENDING_COMMAND_STORAGE_KEY);
}

async function waitForPendingCommandRemoved(commandId: string) {
  await browser.waitUntil(async () => !(await readPendingCommandIds()).includes(commandId), {
    timeout: 30_000,
    timeoutMsg: `PV4-25Q discarded queue ${commandId} 没有从 renderer ledger 清除`,
  });
}

function hasPendingRecoveryBanner(): Promise<boolean> {
  return browser.execute(() => {
    const text = document.body.innerText;
    return (
      text.includes("CLI 重启前Submitted的输入没有进入对话") ||
      text.includes("An input submitted before the CLI restarted did not reach the conversation")
    );
  });
}
