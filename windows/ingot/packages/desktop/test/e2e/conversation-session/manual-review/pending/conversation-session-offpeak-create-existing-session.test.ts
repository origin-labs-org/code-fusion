import { join, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { modelSelectionSchema, OFF_PEAK_PROVIDER_IDS, type ModelSelection } from "@origin-ai/cf-shared";
import {
  TID_OFFPEAK_CARD,
  TID_OFFPEAK_CREATE_CARD,
  TID_OFFPEAK_CREATE_OPEN,
  TID_OFFPEAK_EDIT_SUBMIT,
  TID_OFFPEAK_EDIT_VIEW,
  TID_OFFPEAK_FORM_TITLE,
  TID_OFFPEAK_TAB,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  DEFAULT_WORKSPACE,
  getE2EAppDataPaths,
  setInputValueByTestIdDom,
  waitForTestIdByDom,
  waitForWorkspaceApp,
} from "../../../helpers/desktop-app.js";
import {
  expandAssistantHistoriesWithContent,
  getToolCallDiagnostics,
} from "../../../helpers/conversation-session-tool-diagnostics.js";
import {
  getUpstreamRequestToolContract,
  waitForUpstreamRequest,
} from "../../../helpers/conversation-session-network.js";
import { reloadElectronSessionSafely } from "../../../helpers/e2e-electron-reload.js";
import {
  ELECTRON_WINDOW_RECORDING_CAPTURE_MODE,
  startElectronWindowRecording,
} from "../../../helpers/electron-window-recorder.js";
import {
  approveV4Permission,
  prepareV4ConversationE2E,
  selectV4TaskById,
  sendV4Prompt,
  waitForV4AssistantMessageContaining,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

const CASE_NAME = "conversation-session-offpeak-create-existing-session";
const WARMUP_MARKER = "E2E_OFFPEAK_EXISTING_WARMUP";
const WARMUP_REPLY = `${WARMUP_MARKER}_OK`;
const CREATE_MARKER = "E2E_OFFPEAK_EXISTING_CREATE";
const TASK_TITLE = "E2E_OFFPEAK_EXISTING_TASK";
const UPDATED_TASK_TITLE = "E2E_OFFPEAK_EXISTING_TASK_EDITED";
const MOCK_ALLOWED_MODEL = "GLM-5.2";

describe("OffPeakCreate in existing chat (cold restore session) E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("OP-CHAT-02: After cold restoring old session, prompt creates off-peak task → turn-end card → direct edit", async function () {
    this.timeout(240000);

    await prepareV4ConversationE2E({ resetDraftBeforeProvider: true });
    await sendV4Prompt(`${WARMUP_MARKER} 先Take a look at this for me这个Workspace里有哪些 TODO 注释`);
    await waitForV4AssistantMessageContaining(WARMUP_REPLY);
    const warm = await waitForV4Pane(
      (snapshot) =>
        snapshot.sessionId !== null && snapshot.sessionId !== "draft" && !snapshot.canStop,
      "First conversation turn did not complete",
      60000,
    );
    const sessionId = warm.sessionId!;
    const ordinarySelection = readPersistedSessionSelection(sessionId);

    await reloadElectronSessionSafely(browser);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 60000);

    const recording = await startElectronWindowRecording({
      frameIntervalMs: 200,
      outputPath: resolveArtifactPath(`${CASE_NAME}.webm`),
    });
    try {
      await selectV4TaskById(sessionId);
      await waitForV4TimelineContaining(WARMUP_REPLY);
      await browser.pause(1200);

      await sendV4Prompt(`${CREATE_MARKER} 把这些 TODO 的清理整理成闲时Task，写One份 TODO-PLAN.md`);
      await waitForV4TimelineContaining(CREATE_MARKER);
      const createRequest = { lastUserMessageIncludes: [CREATE_MARKER] };
      await waitForUpstreamRequest(
        createRequest,
        "Failed to capture provider request for OffPeakCreate in cold-restored session",
      );
      const contract = await getUpstreamRequestToolContract(createRequest, "OffPeakCreate");
      expect(contract).not.toBeNull();

      await approveV4Permission();
      await waitForV4Pane(
        (snapshot) => snapshot.sessionId === sessionId && !snapshot.canStop,
        "OffPeakCreate in cold-restored session did not complete",
        90000,
      );

      await expandAssistantHistoriesWithContent();
      try {
        await waitForTestIdByDom(TID_OFFPEAK_CREATE_CARD, {
          timeout: 15000,
          timeoutMsg: "OffPeakCreate off-peak task card not rendered in cold-restored session",
        });
      } catch (error) {
        const diagnostics = await getToolCallDiagnostics({
          type: "toolName",
          value: "OffPeakCreate",
        });
        throw new Error(
          `OffPeakCreate off-peak task card not rendered in cold restored session；diagnostics=${JSON.stringify(diagnostics)}`,
          { cause: error },
        );
      }
      await browser.waitUntil(
        async () => {
          const cardText = await readTestIdText(TID_OFFPEAK_CREATE_CARD);
          return cardText.includes(TASK_TITLE) && /in queue|Queued第/u.test(cardText);
        },
        { timeout: 10000, timeoutMsg: "OffPeakCreate card did not display task title and queue position snapshot" },
      );
      await browser.pause(1500);

      const created = await waitForOffPeakRecordByTitle(TASK_TITLE);
      expect(created.permissionMode).toBe("yolo");
      expect(created.modelSelection.modelId).toBe(MOCK_ALLOWED_MODEL);
      expect(Object.values(OFF_PEAK_PROVIDER_IDS)).toContain(created.modelSelection.providerId);
      expect(created.modelSelection.options?.reasoningLevel).toEqual(expect.any(String));
      expect(created.sessionId).toBe(sessionId);
      expect(created.conversationId).toBeNull();
      expect(created.status).toBe("queued");

      await clickTestIdByDom(TID_OFFPEAK_CREATE_OPEN, {
        timeoutMsg: "Off-peak card is missing \"Go to Off-peak Tasks\" button",
      });
      await waitForTestIdByDom(TID_OFFPEAK_EDIT_VIEW, {
        timeout: 15000,
        timeoutMsg: "Did not navigate to off-peak task edit view after clicking card",
      });
      await browser.waitUntil(
        async () => (await readTestIdValue(TID_OFFPEAK_FORM_TITLE)) === TASK_TITLE,
        { timeout: 10000, timeoutMsg: "Edit form did not display title of task created in session" },
      );
      await browser.pause(1500);
      await setInputValueByTestIdDom(TID_OFFPEAK_FORM_TITLE, UPDATED_TASK_TITLE, {
        timeoutMsg: "闲时任务标题输入不可编辑",
      });
      await clickTestIdByDom(TID_OFFPEAK_EDIT_SUBMIT, { timeoutMsg: "Off-peak task save button is not clickable" });
      await ensureIdleTabSelected();
      await browser.waitUntil(
        async () =>
          (await readAllTestIdTexts(TID_OFFPEAK_CARD)).some((t) => t.includes(UPDATED_TASK_TITLE)),
        { timeout: 20000, timeoutMsg: `闲时Tasklist没有回显修改后的Title：${UPDATED_TASK_TITLE}` },
      );
      const updated = await waitForOffPeakRecordByTitle(UPDATED_TASK_TITLE);
      expect(updated.offPeakTaskId).toBe(created.offPeakTaskId);
      await browser.waitUntil(
        () => {
          const task = readOffPeakRecordByTitle(UPDATED_TASK_TITLE);
          if (task?.status === "failed" || task?.status === "cancelled") {
            throw new Error(`闲时Task异常End止：${JSON.stringify(task)}`);
          }
          return task?.status === "completed";
        },
        { timeout: 90000, timeoutMsg: "Session-bound off-peak task did not complete execution" },
      );
      const completed = readOffPeakRecordByTitle(UPDATED_TASK_TITLE)!;
      expect(completed.sessionId).toBe(sessionId);
      expect(completed.conversationId).toBe(sessionId);
      expect(readPersistedSessionSelection(sessionId)).toEqual(ordinarySelection);
      const response = await fetch("http://127.0.0.1:45197/__e2e/off-peak/requests");
      expect(response.ok).toBe(true);
      const capture = (await response.json()) as {
        requests: Array<{ model?: string; ticketId: string; hasCodingPlanApiKey: boolean }>;
      };
      expect(capture.requests.length).toBeGreaterThan(0);
      for (const request of capture.requests) {
        expect(request.model).toBe(created.modelSelection.modelId);
        expect(request.ticketId).toBeTruthy();
        expect(request.hasCodingPlanApiKey).toBe(true);
      }
    } finally {
      const result = await recording.stop({ tailDurationMs: 500 });
      await writeRecordingManifest({ frameCount: result.frameCount, videoPath: result.videoPath });
    }
  });
});

interface OffPeakRecord {
  offPeakTaskId: string;
  permissionMode: string;
  modelSelection: ModelSelection;
  sessionId: string | null;
  conversationId: string | null;
  status: string;
  failureReason: string | null;
}

function readPersistedSessionSelection(sessionId: string): ModelSelection {
  const database = new DatabaseSync(
    join(getE2EAppDataPaths().storageRoot, "cli", "db", "db.sqlite"),
    { readOnly: true },
  );
  try {
    const row = database
      .prepare(
        "SELECT data FROM session_entry WHERE session_id = ? AND type = 'runtime/model_selection'",
      )
      .get(sessionId) as { data: string } | undefined;
    if (!row) throw new Error(`Session ${sessionId} 没有持久Model Selection`);
    return modelSelectionSchema.parse(JSON.parse(row.data).modelSelection);
  } finally {
    database.close();
  }
}

async function waitForOffPeakRecordByTitle(title: string): Promise<OffPeakRecord> {
  let record: OffPeakRecord | null = null;
  await browser.waitUntil(
    async () => {
      record = readOffPeakRecordByTitle(title);
      return record !== null;
    },
    { timeout: 10000, timeoutMsg: `没有在 off_peak_tasks Medium找到 ${title}` },
  );
  if (!record) throw new Error(`off_peak_tasks 记录为空：${title}`);
  return record;
}

function readOffPeakRecordByTitle(title: string): OffPeakRecord | null {
  const database = new DatabaseSync(
    join(getE2EAppDataPaths().storageRoot, "v2", "tasks-index.sqlite"),
    { readOnly: true },
  );
  try {
    const hasTable = database
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'off_peak_tasks'`)
      .get();
    if (!hasTable) return null;
    const row = database
      .prepare(
        `SELECT off_peak_task_id, permission_mode, model_selection, status, session_id, conversation_id, failure_reason
         FROM off_peak_tasks WHERE title = ?`,
      )
      .get(title) as
      | {
          off_peak_task_id: string;
          permission_mode: string;
          model_selection: string;
          session_id: string | null;
          conversation_id: string | null;
          status: string;
          failure_reason: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      offPeakTaskId: row.off_peak_task_id,
      permissionMode: row.permission_mode,
      modelSelection: modelSelectionSchema.parse(JSON.parse(row.model_selection)),
      sessionId: row.session_id,
      conversationId: row.conversation_id,
      status: row.status,
      failureReason: row.failure_reason,
    };
  } finally {
    database.close();
  }
}

async function ensureIdleTabSelected(): Promise<void> {
  try {
    await clickTestIdByDom(TID_OFFPEAK_TAB, { timeout: 5000, timeoutMsg: "" });
  } catch {
  }
}

async function readTestIdText(currentTestId: string): Promise<string> {
  return browser.execute((tid) => {
    const el = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
      (item) => item.dataset.testid === tid,
    );
    return el?.textContent?.trim() ?? "";
  }, currentTestId);
}

async function readAllTestIdTexts(currentTestId: string): Promise<string[]> {
  return browser.execute((tid) => {
    return Array.from(document.querySelectorAll<HTMLElement>("[data-testid]"))
      .filter((item) => item.dataset.testid === tid)
      .map((item) => item.textContent?.trim() ?? "");
  }, currentTestId);
}

async function readTestIdValue(currentTestId: string): Promise<string> {
  return browser.execute((tid) => {
    const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `[data-testid="${tid}"]`,
    );
    return element?.value ?? "";
  }, currentTestId);
}

function resolveArtifactPath(fileName: string) {
  return resolve(
    process.env.CF_E2E_ARTIFACT_DIR?.trim() ||
      process.env.CODEX_E2E_ARTIFACT_DIR?.trim() ||
      join(process.cwd(), ".e2e-artifacts", CASE_NAME),
    fileName,
  );
}

async function writeRecordingManifest(input: { frameCount: number; videoPath: string }) {
  const manifestPath = resolveArtifactPath(`${CASE_NAME}.recording.json`);
  await mkdir(resolve(manifestPath, ".."), { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        case: CASE_NAME,
        video_capture_mode: ELECTRON_WINDOW_RECORDING_CAPTURE_MODE,
        video_path: input.videoPath,
        frame_count: input.frameCount,
        recorded_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}
