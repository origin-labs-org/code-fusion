import { join, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { modelSelectionSchema, OFF_PEAK_PROVIDER_IDS, type ModelSelection } from "@origin-ai/cf-shared";
import {
  TID_OFFPEAK_CARD,
  TID_OFFPEAK_CARD_SESSION,
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
  getE2EAppDataPaths,
  setInputValueByTestIdDom,
  waitForTestIdByDom,
} from "../../../helpers/desktop-app.js";
import {
  expandAssistantHistoriesWithContent,
  getToolCallDiagnostics,
} from "../../../helpers/conversation-session-tool-diagnostics.js";
import {
  getUpstreamRequestToolContract,
  waitForUpstreamRequest,
} from "../../../helpers/conversation-session-network.js";
import {
  ELECTRON_WINDOW_RECORDING_CAPTURE_MODE,
  startElectronWindowRecording,
} from "../../../helpers/electron-window-recorder.js";
import {
  approveV4Permission,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

const CASE_NAME = "conversation-session-offpeak-create";
const MARKER = "E2E_OFFPEAK_CHAT_CREATE";
const TASK_TITLE = "E2E_OFFPEAK_DIGEST";
const UPDATED_TASK_TITLE = "E2E_OFFPEAK_DIGEST_EDITED";
const MOCK_ALLOWED_MODEL = "GLM-5.2";

describe("会话内 OffPeakCreate 闲时任务卡片与直达编辑 E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("OP-CHAT-01: Prompt creates off-peak task → turn-end card → direct edit form modification", async function () {
    this.timeout(180000);

    await prepareV4ConversationE2E({ resetDraftBeforeProvider: true });
    const recording = await startElectronWindowRecording({
      frameIntervalMs: 200,
      outputPath: resolveArtifactPath(`${CASE_NAME}.webm`),
    });

    try {
      await sendV4Prompt(
        `${MARKER} 帮我建One个闲时Task：Organize files modified today and generate a summary写到 DIGEST.md`,
      );
      await waitForV4TimelineContaining(MARKER);

      const createRequest = { lastUserMessageIncludes: [MARKER] };
      await waitForUpstreamRequest(
        createRequest,
        "Failed to capture provider request for in-session OffPeakCreate",
      );
      const contract = await getUpstreamRequestToolContract(createRequest, "OffPeakCreate");
      expect(contract).not.toBeNull();
      const serializedContract = JSON.stringify(contract);
      expect(serializedContract).toContain("OffPeakCreate has no clock");
      expect(serializedContract).toContain("full-automatic mode");

      await approveV4Permission();
      const donePane = await waitForV4Pane(
        (snapshot) =>
          snapshot.sessionId !== null && snapshot.sessionId !== "draft" && !snapshot.canStop,
        "会话内 OffPeakCreate 没有完成",
        90000,
      );
      const creatingSessionId = donePane.sessionId!;

      await expandAssistantHistoriesWithContent();
      try {
        await waitForTestIdByDom(TID_OFFPEAK_CREATE_CARD, {
          timeout: 15000,
          timeoutMsg: "In-session OffPeakCreate off-peak task card not rendered",
        });
      } catch (error) {
        const diagnostics = await getToolCallDiagnostics({
          type: "toolName",
          value: "OffPeakCreate",
        });
        throw new Error(
          `In-session OffPeakCreate off-peak task card was not rendered；diagnostics=${JSON.stringify(diagnostics)}`,
          { cause: error },
        );
      }
      await browser.waitUntil(
        async () => {
          const cardText = await readTestIdText(TID_OFFPEAK_CREATE_CARD);
          return cardText.includes(TASK_TITLE) && /in queue|Queued第/u.test(cardText);
        },
        {
          timeout: 10000,
          timeoutMsg: "OffPeakCreate card did not display task title and queue position snapshot",
        },
      );

      await browser.pause(1500);

      const created = await waitForOffPeakRecordByTitle(TASK_TITLE);
      expect(created.permissionMode).toBe("yolo");
      expect(created.modelSelection.modelId).toBe(MOCK_ALLOWED_MODEL);
      expect(Object.values(OFF_PEAK_PROVIDER_IDS)).toContain(created.modelSelection.providerId);
      expect(created.modelSelection.options?.reasoningLevel).toEqual(expect.any(String));
      expect(created.status).toBe("queued");
      expect(created.sessionId).toBe(creatingSessionId);
      expect(created.conversationId).toBeNull();

      await clickTestIdByDom(TID_OFFPEAK_CREATE_OPEN, {
        timeoutMsg: "Off-peak card is missing \"Go to Off-peak Tasks\" button",
      });
      try {
        await waitForTestIdByDom(TID_OFFPEAK_EDIT_VIEW, {
          timeout: 15000,
          timeoutMsg: "Did not navigate to off-peak task edit view after clicking card",
        });
      } catch (error) {
        const dom = await readDomDiagnostics();
        throw new Error(`Did not enter off-peak task edit view after clicking card；dom=${JSON.stringify(dom)}`, {
          cause: error,
        });
      }
      await browser.waitUntil(
        async () => (await readTestIdValue(TID_OFFPEAK_FORM_TITLE)) === TASK_TITLE,
        {
          timeout: 10000,
          timeoutMsg: "Edit form did not display title of task created in session",
        },
      );

      await browser.pause(1500);

      await setInputValueByTestIdDom(TID_OFFPEAK_FORM_TITLE, UPDATED_TASK_TITLE, {
        timeoutMsg: "闲时任务标题输入不可编辑",
      });
      await clickTestIdByDom(TID_OFFPEAK_EDIT_SUBMIT, {
        timeoutMsg: "Off-peak task save button is not clickable",
      });
      await ensureIdleTabSelected();
      await browser.waitUntil(
        async () =>
          (await readAllTestIdTexts(TID_OFFPEAK_CARD)).some((t) => t.includes(UPDATED_TASK_TITLE)),
        {
          timeout: 20000,
          timeoutMsg: `闲时Tasklist没有回显修改后的Title：${UPDATED_TASK_TITLE}`,
        },
      );
      const updated = await waitForOffPeakRecordByTitle(UPDATED_TASK_TITLE);
      expect(updated.offPeakTaskId).toBe(created.offPeakTaskId);
      const boundSessionTitle = readTaskTitleById(creatingSessionId);
      expect(boundSessionTitle).toBeTruthy();
      await browser.waitUntil(
        async () =>
          (await readAllTestIdTexts(TID_OFFPEAK_CARD_SESSION)).some((t) =>
            t.includes(boundSessionTitle!),
          ),
        {
          timeout: 10000,
          timeoutMsg: `闲时卡片没有展示Bind sessionTitle：${boundSessionTitle}`,
        },
      );
      await browser.pause(1500);
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
  status: string;
  sessionId: string | null;
  conversationId: string | null;
}

function readTaskTitleById(taskId: string): string | null {
  const database = new DatabaseSync(
    join(getE2EAppDataPaths().storageRoot, "v2", "tasks-index.sqlite"),
    { readOnly: true },
  );
  try {
    const row = database.prepare(`SELECT title FROM tasks WHERE task_id = ?`).get(taskId) as
      | { title: string }
      | undefined;
    return row?.title?.trim() || null;
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
        `SELECT off_peak_task_id, permission_mode, model_selection, status, session_id, conversation_id
         FROM off_peak_tasks WHERE title = ?`,
      )
      .get(title) as
      | {
          off_peak_task_id: string;
          permission_mode: string;
          model_selection: string;
          status: string;
          session_id: string | null;
          conversation_id: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      offPeakTaskId: row.off_peak_task_id,
      permissionMode: row.permission_mode,
      modelSelection: modelSelectionSchema.parse(JSON.parse(row.model_selection)),
      status: row.status,
      sessionId: row.session_id,
      conversationId: row.conversation_id,
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

async function readDomDiagnostics(): Promise<{
  testIds: string[];
  toasts: string[];
  bodyText: string;
}> {
  return browser.execute(() => {
    const testIds = Array.from(
      new Set(
        Array.from(document.querySelectorAll<HTMLElement>("[data-testid]"))
          .map((el) => el.dataset.testid ?? "")
          .filter((id) => /offpeak|automation|settings|toast/iu.test(id)),
      ),
    );
    const toasts = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[role="status"],[data-sonner-toast],[data-radix-toast-viewport] *',
      ),
    )
      .map((el) => el.textContent?.trim() ?? "")
      .filter(Boolean)
      .slice(0, 5);
    return { testIds, toasts, bodyText: (document.body.innerText ?? "").slice(0, 1500) };
  });
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
