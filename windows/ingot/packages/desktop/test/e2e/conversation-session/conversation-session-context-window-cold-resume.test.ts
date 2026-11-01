import { DEFAULT_WORKSPACE } from "../helpers/desktop-app.js";
import { openWorkspaceDraftFromSidebar } from "../helpers/workspace-agent-warmup.js";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { restartIntoWorkspacePreservingProfile as restartWithFixture } from "../helpers/model-provider-restart-runtime.js";
import {
  TID_V4_COMPOSER_INPUT,
  TID_V4_MODEL_CONFIG,
  TID_V4_SESSION_PANE,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  getE2EAppDataPaths,
  setInputValueByTestIdDom,
  waitForDefaultWorkspaceReady,
} from "../helpers/desktop-app.js";
import {
  restartIntoWorkspacePreservingProfile,
  waitForSelectedModel,
} from "../helpers/model-provider-restart.js";
import {
  CONTEXT_WINDOW_COLD_RESUME_MAX_TOKENS,
  CONTEXT_WINDOW_COLD_RESUME_MAX_OUTPUT_TOKENS,
  CONTEXT_WINDOW_COLD_RESUME_MODEL_ID,
  CONTEXT_WINDOW_COLD_RESUME_PROVIDER_ID,
} from "../helpers/provider-readiness-history-fixture.js";
import {
  clickV4Send,
  getV4CompactMarkers,
  getV4ConfigProjection,
  selectV4TaskById,
  sendV4Prompt,
  V4_MAIN_PANE_ID,
  waitForV4CompactMarker,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

const PROVIDER_ID = CONTEXT_WINDOW_COLD_RESUME_PROVIDER_ID;
const MODEL_ID = CONTEXT_WINDOW_COLD_RESUME_MODEL_ID;
const CONTEXT_WINDOW = CONTEXT_WINDOW_COLD_RESUME_MAX_TOKENS;
const MAX_OUTPUT_TOKENS = CONTEXT_WINDOW_COLD_RESUME_MAX_OUTPUT_TOKENS;
const HIGH_USAGE_INPUT_TOKENS = 157_762;
const TOOL_CALL_ID = "call_cw_pwd";
const CREATE_HISTORY_MARKER = "E2E_CW_CREATE_HISTORY";
const CREATE_HISTORY_REPLY = "cw-history-created-ok";
const PARKING_MARKER = "E2E_CW_PARKING";
const PARKING_REPLY = "cw-parking-ok";
const HIGH_USAGE_MARKER = "E2E_CW_HIGH_USAGE_TOOL";
const TOOL_FOLLOWUP_REPLY = "cw-tool-followup-ok";
const CONTINUE_REPLY = "cw-continue-ok";
const paths = getE2EAppDataPaths();

describe("上下文窗口与输出预算冷恢复 E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("CW01-CW04: 1M/64K session cold recovery limits are correct; restart after compact maintains compacted watermark", async function () {
    this.timeout(360_000);

    await waitForDefaultWorkspaceReady(30_000);
    await waitForSelectedModel(PROVIDER_ID, MODEL_ID);

    await sendV4Prompt(CREATE_HISTORY_MARKER);
    await waitForV4TimelineContaining(CREATE_HISTORY_REPLY);
    const targetSessionId = await waitForBoundSession("Real 1M historical session was not created successfully");

    await openWorkspaceDraftFromSidebar(DEFAULT_WORKSPACE);
    await sendV4Prompt(PARKING_MARKER);
    await waitForV4TimelineContaining(PARKING_REPLY);
    const parkingSessionId = await waitForBoundSession("Parking session was not created successfully");
    expect(parkingSessionId).not.toBe(targetSessionId);

    await restartIntoWorkspacePreservingProfile();
    await waitForV4Pane(
      (snapshot) => snapshot.sessionId !== targetSessionId,
      "重启后目标会话在记录器安装前已被提前打开",
    );
    await installContextWindowProjectionRecorder(paths.workspace, targetSessionId);
    await selectV4TaskById(targetSessionId);
    await waitForV4TimelineContaining(CREATE_HISTORY_MARKER);
    await waitForV4TimelineContaining(CREATE_HISTORY_REPLY);
    await waitForV4Pane(
      (snapshot) => snapshot.sessionId === targetSessionId,
      "1M 历史 session 没有完成冷恢复",
    );

    const coldProjection = await waitForConfigProjection(
      (projection) => projection.usageUsed > 0 && projection.usageMax === CONTEXT_WINDOW,
      "First projection of historical session with configured 1M provider did not use 1M",
    );
    expect(coldProjection.usageMax).toBe(CONTEXT_WINDOW);
    const observedContextWindows = await readContextWindowProjectionRecorder();
    const nonZeroContextWindows = observedContextWindows.filter((value) => value > 0);
    expect(observedContextWindows).not.toContain(200_000);
    expect(nonZeroContextWindows[0]).toBe(CONTEXT_WINDOW);
    expect(new Set(nonZeroContextWindows)).toEqual(new Set([CONTEXT_WINDOW]));

    const highUsagePrompt =
      `${HIGH_USAGE_MARKER}: run readonly Bash pwd, then reply with ` + `"${TOOL_FOLLOWUP_REPLY}".`;
    await sendV4Prompt(highUsagePrompt);
    await waitForV4TimelineContaining(TOOL_FOLLOWUP_REPLY);
    await waitForV4Pane(
      (snapshot) => snapshot.sessionId === targetSessionId && !snapshot.canStop,
      "High-usage tool continuation turn did not complete",
      90_000,
    );

    const highUsageProjection = await waitForConfigProjection(
      (projection) =>
        projection.usageMax === CONTEXT_WINDOW && projection.usageUsed >= HIGH_USAGE_INPUT_TOKENS,
      "provider usage 没有更新到同一 1M session 的状态投影",
    );
    expect(highUsageProjection.usageUsed).toBeGreaterThanOrEqual(HIGH_USAGE_INPUT_TOKENS);

    const afterTool = await waitForModelIoSequence(targetSessionId, 3);
    expect(afterTool.filter((record) => record.querySource === "compact")).toHaveLength(0);
    const afterToolMainTurns = afterTool.filter((record) => record.querySource === "main_turn");
    expect(afterToolMainTurns).toHaveLength(3);
    expect(
      afterToolMainTurns.every((record) => record.body.max_completion_tokens === MAX_OUTPUT_TOKENS),
    ).toBe(true);
    expect(afterTool.every((record) => record.modelId === MODEL_ID)).toBe(true);
    expect(JSON.stringify(afterToolMainTurns[2]?.body)).toContain(TOOL_CALL_ID);
    expect(await getV4CompactMarkers()).toHaveLength(0);

    await sendV4Prompt("继续");
    await waitForV4TimelineContaining(CONTINUE_REPLY);
    await waitForV4Pane(
      (snapshot) => snapshot.sessionId === targetSessionId && !snapshot.canStop,
      "\"Continue\" turn did not complete",
      90_000,
    );

    const finalRequests = await waitForModelIoSequence(targetSessionId, 4);
    expect(finalRequests.filter((record) => record.querySource === "compact")).toHaveLength(0);
    const finalMainTurns = finalRequests.filter((record) => record.querySource === "main_turn");
    expect(finalMainTurns).toHaveLength(4);
    expect(
      finalMainTurns.every((record) => record.body.max_completion_tokens === MAX_OUTPUT_TOKENS),
    ).toBe(true);
    expect(finalRequests.every((record) => record.modelId === MODEL_ID)).toBe(true);
    expect(JSON.stringify(finalMainTurns[3]?.body)).toContain("继续");
    expect(await getV4CompactMarkers()).toHaveLength(0);
    expect((await getV4ConfigProjection()).usageMax).toBe(CONTEXT_WINDOW);

    const preCompactProjection = await getV4ConfigProjection();
    expect(preCompactProjection.usageUsed).toBeGreaterThanOrEqual(HIGH_USAGE_INPUT_TOKENS);
    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "/compact", {
      timeout: 15_000,
      timeoutMsg: "CW04 手动 compact 前 composer 输入框没有出现",
    });
    await clickV4Send();
    await waitForV4CompactMarker({ origin: "manual", status: "success" }, 90_000);
    await waitForV4Pane(
      (snapshot) => snapshot.sessionId === targetSessionId && !snapshot.canStop,
      "CW04 手动 compact 完成后没有回到 idle",
      90_000,
    );
    const postCompactProjection = await waitForConfigProjection(
      (projection) =>
        projection.usageMax === CONTEXT_WINDOW &&
        projection.usageUsed > 0 &&
        projection.usageUsed < preCompactProjection.usageUsed,
      "CW04 hot meter did not drop to post-compact level",
    );

    await selectV4TaskById(parkingSessionId);
    await waitForV4TimelineContaining(PARKING_REPLY);
    await waitForV4Pane(
      (snapshot) => snapshot.sessionId === parkingSessionId && !snapshot.canStop,
      "CW04 重启前没有切回 parking session",
    );
    await restartIntoWorkspacePreservingProfile();
    await waitForV4Pane(
      (snapshot) => snapshot.sessionId !== targetSessionId,
      "CW04 第二次重启后目标 session 被提前打开",
    );
    await selectV4TaskById(targetSessionId);
    await waitForV4Pane(
      (snapshot) => snapshot.sessionId === targetSessionId && !snapshot.canStop,
      "CW04 compact historical session did not complete cold restore",
      90_000,
    );
    await waitForV4CompactMarker({ origin: "manual", status: "success" }, 90_000);
    await waitForSelectedModel(PROVIDER_ID, MODEL_ID);

    const coldPostCompactProjection = await waitForConfigProjection(
      (projection) => projection.usageMax === CONTEXT_WINDOW && projection.usageUsed > 0,
      "CW04 context usage was not published after cold restore",
    );
    expect(coldPostCompactProjection.usageUsed).toBe(postCompactProjection.usageUsed);
    expect(coldPostCompactProjection.usageUsed).toBeLessThan(preCompactProjection.usageUsed);

    await selectV4TaskById(parkingSessionId);
    await restartWithFixture(paths.workspace, {
      afterElectronProcessExit: () => patchFixtureSelection(targetSessionId, false),
    });
    await installContextWindowProjectionRecorder(paths.workspace, targetSessionId);
    await selectV4TaskById(targetSessionId);
    await waitForV4TimelineContaining(CREATE_HISTORY_REPLY);
    const missingReasoning = await waitForConfigProjection(
      (projection) => projection.usageMax === CONTEXT_WINDOW && projection.usageUsed > 0,
      "CW05 historical selection without tier did not retain actual capacity and usage",
    );
    expect(missingReasoning.usageUsed).toBe(coldPostCompactProjection.usageUsed);
    expect(await readContextWindowProjectionRecorder()).not.toContain(200_000);

    await selectV4TaskById(parkingSessionId);
    await restartWithFixture(paths.workspace, {
      afterElectronProcessExit: () => patchFixtureSelection(targetSessionId, true),
    });
    await selectV4TaskById(targetSessionId);
    await waitForV4TimelineContaining(CREATE_HISTORY_REPLY);
    await waitForV4Pane(
      (snapshot) => snapshot.sessionId === targetSessionId && !snapshot.canStop,
      "CW06 未知模型会话应可打开",
    );
    await waitForConfigProjection(
      (projection) => projection.usageMax === 0,
      "CW06 unknown model should not display fake capacity",
    );
  });
});

function patchFixtureSelection(sessionId: string, unknownModel: boolean): void {
  const database = new DatabaseSync(join(paths.homeDir, ".cf", "cli", "db", "db.sqlite"));
  try {
    const result = database
      .prepare(`UPDATE session_entry
      SET data=json_set(data, '$.modelSelection', json(?))
      WHERE session_id=? AND type='runtime/model_selection'`)
      .run(
        JSON.stringify({
          providerId: PROVIDER_ID,
          modelId: unknownModel ? "missing-cw-model" : MODEL_ID,
        }),
        sessionId,
      );
    expect(Number(result.changes)).toBeGreaterThan(0);
  } finally {
    database.close();
  }
}

async function waitForBoundSession(timeoutMsg: string): Promise<string> {
  const snapshot = await waitForV4Pane(
    (current) => Boolean(current.sessionId && current.sessionId !== "draft" && !current.canStop),
    timeoutMsg,
    90_000,
  );
  if (!snapshot.sessionId || snapshot.sessionId === "draft") {
    throw new Error(`${timeoutMsg}; sessionId=${snapshot.sessionId}`);
  }
  return snapshot.sessionId;
}

interface ConfigProjection {
  mode: string | null;
  usageMax: number;
  usageUsed: number;
}

async function waitForConfigProjection(
  predicate: (projection: ConfigProjection) => boolean,
  timeoutMsg: string,
): Promise<ConfigProjection> {
  let latest: ConfigProjection = await getV4ConfigProjection();
  await browser.waitUntil(
    async () => {
      latest = await getV4ConfigProjection();
      return predicate(latest);
    },
    {
      interval: 100,
      timeout: 30_000,
      timeoutMsg: `${timeoutMsg}; latest=${JSON.stringify(latest)}`,
    },
  );
  return latest;
}

interface ContextWindowProjectionRecorder {
  dom: number[];
  store: number[];
}

async function installContextWindowProjectionRecorder(
  workspacePath: string,
  sessionId: string,
): Promise<void> {
  const paneTestId = testId(TID_V4_SESSION_PANE, V4_MAIN_PANE_ID);
  await browser.execute(
    (targetWorkspacePath, targetSessionId, targetPaneTestId, modelConfigTestId) => {
      interface SessionStoreState {
        getWorkspaceState: (workspace: string) => {
          taskRuntimeByTaskId: Record<
            string,
            {
              contextWindow?: number | null;
              usage?: { size?: number } | null;
            }
          >;
        };
      }
      interface SessionStoreBridge {
        getState: () => SessionStoreState;
        subscribe: (listener: (state: SessionStoreState) => void) => () => void;
      }
      interface RecorderHost {
        __cfContextWindowColdResumeE2E?: {
          dom: number[];
          observer: MutationObserver;
          store: number[];
          unsubscribe: () => void;
        };
        __cfSessionStoreE2E?: SessionStoreBridge;
      }
      const host = window as unknown as RecorderHost;
      host.__cfContextWindowColdResumeE2E?.observer.disconnect();
      host.__cfContextWindowColdResumeE2E?.unsubscribe();

      const dom: number[] = [];
      const store: number[] = [];
      const append = (target: number[], value: unknown) => {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && target[target.length - 1] !== numeric) {
          target.push(numeric);
        }
      };
      const recordDom = () => {
        const pane = document.querySelector<HTMLElement>(`[data-testid="${targetPaneTestId}"]`);
        if (pane?.getAttribute("data-session-id") !== targetSessionId) {
          return;
        }
        const modelConfig = pane.querySelector<HTMLElement>(`[data-testid="${modelConfigTestId}"]`);
        append(dom, modelConfig?.getAttribute("data-usage-max"));
      };
      const observer = new MutationObserver(recordDom);
      observer.observe(document.body, {
        attributeFilter: ["data-session-id", "data-usage-max"],
        attributes: true,
        childList: true,
        subtree: true,
      });

      const bridge = host.__cfSessionStoreE2E;
      if (!bridge) {
        throw new Error("CodeFusion session E2E store bridge is not registered");
      }
      const recordStore = (state: SessionStoreState) => {
        const runtime =
          state.getWorkspaceState(targetWorkspacePath).taskRuntimeByTaskId[targetSessionId];
        append(store, runtime?.usage?.size ?? runtime?.contextWindow);
      };
      const unsubscribe = bridge.subscribe(recordStore);
      recordStore(bridge.getState());
      recordDom();
      host.__cfContextWindowColdResumeE2E = {
        dom,
        observer,
        store,
        unsubscribe,
      };
    },
    workspacePath,
    sessionId,
    paneTestId,
    TID_V4_MODEL_CONFIG,
  );
}

async function readContextWindowProjectionRecorder(): Promise<number[]> {
  const recorder = await browser.execute(() => {
    const value = (
      window as unknown as {
        __cfContextWindowColdResumeE2E?: ContextWindowProjectionRecorder;
      }
    ).__cfContextWindowColdResumeE2E;
    return value ? { dom: [...value.dom], store: [...value.store] } : null;
  });
  if (!recorder) {
    throw new Error("1M context cold restore projection recorder was unexpectedly lost");
  }
  return [...recorder.store, ...recorder.dom];
}

interface ModelIoRecord {
  error?: unknown;
  model?: { modelId?: string };
  querySource?: string;
  request?: { body?: unknown };
  response?: unknown;
  sessionId?: string;
}

interface ModelIoMatch {
  body: Record<string, unknown>;
  modelId: string | undefined;
  querySource: string;
}

async function waitForModelIoSequence(
  sessionId: string,
  expectedMainTurnCount: number,
): Promise<ModelIoMatch[]> {
  let matched: ModelIoMatch[] = [];
  await browser.waitUntil(
    async () => {
      matched = await readSuccessfulModelIo(sessionId);
      return (
        matched.filter((record) => record.querySource === "main_turn").length >=
        expectedMainTurnCount
      );
    },
    {
      interval: 100,
      timeout: 30_000,
      timeoutMsg:
        `model-io 没有达到 ${expectedMainTurnCount} 个 main_turn; ` +
        `latest=${JSON.stringify(matched.map((record) => record.querySource))}`,
    },
  );
  return matched;
}

async function readSuccessfulModelIo(sessionId: string): Promise<ModelIoMatch[]> {
  const debugDir = join(paths.homeDir, ".cf", "cli", "debug");
  const files = (await readdir(debugDir).catch(() => []))
    .filter((name) => name.startsWith("model-io-") && name.endsWith(".jsonl"))
    .sort();
  const matched: ModelIoMatch[] = [];
  for (const file of files) {
    const content = await readFile(join(debugDir, file), "utf-8").catch(() => "");
    for (const line of content.split("\n")) {
      const record = parseJsonObject(line) as ModelIoRecord | null;
      if (
        !record ||
        record.error !== undefined ||
        record.response === undefined ||
        record.sessionId !== sessionId ||
        typeof record.querySource !== "string"
      ) {
        continue;
      }
      const body = parseJsonObject(record.request?.body);
      if (!body || body.bodySource === "ai_sdk_options") {
        continue;
      }
      matched.push({
        body,
        modelId: record.model?.modelId,
        querySource: record.querySource,
      });
    }
  }
  return matched;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return parseJsonObject(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
