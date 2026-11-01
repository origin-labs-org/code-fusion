import {
  assertIncomingMessage,
  assertTaskNotificationContents,
} from "../helpers/incoming-message-evidence.js";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  TID_CHAT_ASSISTANT_HISTORY_CONTENT,
  TID_CHAT_ASSISTANT_HISTORY_TRIGGER,
  TID_CHAT_BACKGROUND_RESULT_TITLE,
  TID_CHAT_LOADING,
  TID_CHAT_MESSAGES,
  TID_CHAT_USER_MESSAGE,
  TID_V4_BACKGROUND_WORK_CANCEL,
  TID_V4_SESSION_PANE,
  TID_V4_TURN_NAVIGATOR_ITEM,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import { clearAppData, seedSettings } from "../helpers/desktop-app.js";
import {
  waitForCompactMarkerStatus,
  waitForCompactMarkerStatuses,
} from "../helpers/conversation-session-compact.js";
import {
  countUpstreamRequests,
  findFirstUpstreamRequestIndex,
  getUpstreamRequestEvidence,
  getUpstreamRequestRecordCount,
  getLatestUpstreamToolResultByToolCallId,
  waitForUpstreamRequest,
} from "../helpers/conversation-session-network.js";
import {
  clickFirstQueueSendNow,
  waitForQueueOrderContaining,
} from "../helpers/conversation-session-queue.js";
import {
  listToolCallBlocks,
  waitForToolCallBlockByToolCallId,
  waitForToolCallBlockByToolName,
} from "../helpers/conversation-session-tool.js";
import { resolveE2ERuntimePath } from "../helpers/e2e-runtime-paths.js";
import {
  assertVisibleV4UserMessagesNotContaining,
  clickV4Stop,
  getV4ConversationState,
  getV4Messages,
  getV4PaneSnapshot,
  openV4ComposerRunningBackgroundWorks,
  prepareV4ConversationE2E,
  selectV4TaskById,
  sendV4Prompt,
  sendV4PromptAndWaitAccepted,
  waitForV4AssistantMessageContaining,
  waitForV4ComposerText,
  waitForV4ConversationState,
  waitForV4TimelineContaining,
  waitForV4UserMessageContaining,
  V4_MAIN_PANE_ID,
} from "../helpers/v4-conversation.js";
import {
  ensureToolCrossProductFullAccessMode,
  respondToToolCrossProductBlockers,
} from "../helpers/conversation-session-tool-cross-product.js";
import {
  beginConversationTelemetryCapture,
  checkpointConversationTelemetryCase,
  waitForConversationReportDelta,
  type ConversationTelemetryReport,
} from "../helpers/conversation-telemetry-parity-capture.js";

const BACKGROUND_E2E_TIMEOUT_MS = 240000;
const BACKGROUND_RUNTIME_ROOT = resolveE2ERuntimePath("conversation-session-background");
const BG14_PREVIEW_RELEASE_FILE = resolveE2ERuntimePath(
  "conversation-session-background",
  "bg14-preview-release",
);
const BG08_ROOT_PID_FILE = resolveE2ERuntimePath(
  "conversation-session-background",
  "bg08-root.pid",
);
const BG08_LAUNCHER_PID_FILE = resolveE2ERuntimePath(
  "conversation-session-background",
  "bg08-launcher.pid",
);
const BG08_WORKER_PID_FILE = resolveE2ERuntimePath(
  "conversation-session-background",
  "bg08-worker.pid",
);
const BG08_LAUNCHER_SCRIPT_FILE = resolveE2ERuntimePath(
  "conversation-session-background",
  "bg08-launcher.cjs",
);
const BG08_LAUNCHER_SCRIPT = [
  'const { spawn } = require("node:child_process");',
  'const { writeFileSync } = require("node:fs");',
  'writeFileSync(process.argv[2], String(process.pid) + "\\n");',
  'const worker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {',
  '  stdio: "ignore",',
  "});",
  'if (!worker.pid) throw new Error("BG08 worker did not start");',
  'writeFileSync(process.argv[3], String(worker.pid) + "\\n");',
  "setInterval(() => {}, 1000);",
].join("\n");
const BG21_RELEASE_FILE = resolveE2ERuntimePath(
  "conversation-session-background",
  "bg21-child-tool-release",
);
const BG38_STARTED_FILE = resolveE2ERuntimePath(
  "conversation-session-background",
  "bg38-bash-started",
);
const BACKGROUND_SEND_NOW_QUEUE_RELEASE_FILE = resolveE2ERuntimePath(
  "conversation-session-background",
  "background-send-now-queue-release",
);
const BACKGROUND_CHILD_TOOL_IDLE_RELEASE_FILE = resolveE2ERuntimePath(
  "conversation-session-background",
  "background-child-tool-idle-release",
);
const BACKGROUND_PARENT_ANCHOR_RELEASE_FILE = resolveE2ERuntimePath(
  "conversation-session-background",
  "background-parent-anchor-release",
);
const BACKGROUND_SWITCH_BACK_RELEASE_FILE = resolveE2ERuntimePath(
  "conversation-session-background",
  "background-switch-back-release",
);
const BACKGROUND_MIXED_FOREGROUND_RELEASE_FILE = resolveE2ERuntimePath(
  "conversation-session-background",
  "agent-composition-mixed-foreground-release",
);

interface BackgroundResultPresentationSnapshot {
  assistantText: string;
  historyContentCount: number;
  historyTriggerCount: number;
  navigatorItemCount: number;
  title: string;
}

async function getBackgroundResultPresentation(
  expectedTitle: string,
): Promise<BackgroundResultPresentationSnapshot | null> {
  return browser.execute(
    (titleTestId, historyTriggerTestId, historyContentTestId, navigatorItemTestId, title) => {
      const titleNode = Array.from(
        document.querySelectorAll<HTMLElement>(`[data-testid^="${titleTestId}-"]`),
      ).find((node) => node.textContent?.trim() === title);
      const turn = titleNode?.closest<HTMLElement>("[data-turn-key]");
      if (!titleNode || !turn) return null;
      return {
        assistantText: turn.textContent ?? "",
        historyContentCount: turn.querySelectorAll(`[data-testid^="${historyContentTestId}-"]`)
          .length,
        historyTriggerCount: turn.querySelectorAll(`[data-testid^="${historyTriggerTestId}-"]`)
          .length,
        navigatorItemCount: document.querySelectorAll(`[data-testid^="${navigatorItemTestId}-"]`)
          .length,
        title: titleNode.textContent?.trim() ?? "",
      };
    },
    TID_CHAT_BACKGROUND_RESULT_TITLE,
    TID_CHAT_ASSISTANT_HISTORY_TRIGGER,
    TID_CHAT_ASSISTANT_HISTORY_CONTENT,
    TID_V4_TURN_NAVIGATOR_ITEM,
    expectedTitle,
  );
}

async function waitForBackgroundResultPresentation(options: {
  assistantMarker: string;
  expectedTitle: string;
  failureLabel: string;
}): Promise<void> {
  let snapshot: BackgroundResultPresentationSnapshot | null = null;
  await browser.waitUntil(
    async () => {
      snapshot = await getBackgroundResultPresentation(options.expectedTitle);
      return Boolean(
        snapshot &&
        snapshot.assistantText.includes(options.assistantMarker) &&
        snapshot.historyTriggerCount === 0 &&
        snapshot.historyContentCount === 0 &&
        snapshot.navigatorItemCount === 0,
      );
    },
    {
      timeout: 60000,
      timeoutMsg: `${options.failureLabel} 没有ShowStructures化Title、仍存在折叠控件，or被计入 turn navigator`,
    },
  );
  expect(snapshot).toMatchObject({
    historyContentCount: 0,
    historyTriggerCount: 0,
    navigatorItemCount: 0,
    title: options.expectedTitle,
  });
}

describe("Chat Area Background Runtime Task E2E", () => {
  before(async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);
    await mkdir(BACKGROUND_RUNTIME_ROOT, { recursive: true });
    await writeFile(BG08_LAUNCHER_SCRIPT_FILE, BG08_LAUNCHER_SCRIPT, "utf-8");
    await removeBg08PidFiles();
    await seedSettings({ messageStreamShowTodos: true });
    await prepareV4ConversationE2E();
  });

  afterEach(async () => {
    await Promise.all([
      writeFile(BG21_RELEASE_FILE, "release\n", "utf-8").catch(() => undefined),
      writeFile(BACKGROUND_SEND_NOW_QUEUE_RELEASE_FILE, "release\n", "utf-8").catch(
        () => undefined,
      ),
      writeFile(BACKGROUND_CHILD_TOOL_IDLE_RELEASE_FILE, "release\n", "utf-8").catch(
        () => undefined,
      ),
      writeFile(BACKGROUND_PARENT_ANCHOR_RELEASE_FILE, "release\n", "utf-8").catch(() => undefined),
      writeFile(BACKGROUND_SWITCH_BACK_RELEASE_FILE, "release\n", "utf-8").catch(() => undefined),
    ]);
    await stopIfBusy();
    await cleanupBg08ProcessTree();
    await rm(BG21_RELEASE_FILE, { force: true }).catch(() => undefined);
    await rm(BACKGROUND_SEND_NOW_QUEUE_RELEASE_FILE, { force: true }).catch(() => undefined);
    await rm(BACKGROUND_CHILD_TOOL_IDLE_RELEASE_FILE, { force: true }).catch(() => undefined);
    await rm(BACKGROUND_PARENT_ANCHOR_RELEASE_FILE, { force: true }).catch(() => undefined);
    await rm(BACKGROUND_SWITCH_BACK_RELEASE_FILE, { force: true }).catch(() => undefined);
    await rm(BG38_STARTED_FILE, { force: true }).catch(() => undefined);
    await removeBg08PidFiles();
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await rm(BACKGROUND_RUNTIME_ROOT, { force: true, recursive: true });
    await clearAppData();
  });

  it("Background Agent wakes parent session via task-notification upon completion without displaying synthetic user", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const prompt =
      "E2E_BACKGROUND_AGENT: Launch a background agent and summarize only after its notification.";
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await sendV4PromptAndWaitAccepted(
      prompt,
      "E2E_BACKGROUND_AGENT",
      "Background Agent prompt was not accepted by composer",
    );
    await waitForToolCallBlockByToolName("Agent", 60000);
    await respondToBackgroundBlockers();

    const launchIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BACKGROUND_AGENT", "Async agent launched successfully"],
      },
      requestCountBefore,
      "Background Agent launch tool result did not enter parent model request",
    );
    const notificationIndex = await waitForFirstRequestIndex(
      {
        includes: ["<task-notification>", "E2E_BACKGROUND_AGENT_CHILD_RESULT"],
      },
      launchIndex,
      "Background Agent completion notification did not enter parent model request",
    );

    expect(notificationIndex).toBeGreaterThan(launchIndex);
    await waitForV4AssistantMessageContaining("background-agent-notification-consumed-ok");
    await waitForIdle("background Agent notification 后会话没有回到 idle");
    await waitForBackgroundResultPresentation({
      assistantMarker: "background-agent-notification-consumed-ok",
      expectedTitle: "Check background",
      failureLabel: "Background Agent standalone result turn",
    });
    await assertNoVisibleTaskNotification();

    await browser.refresh();
    await waitForBackgroundResultPresentation({
      assistantMarker: "background-agent-notification-consumed-ok",
      expectedTitle: "Check background",
      failureLabel: "Background Agent refreshed restored result turn",
    });
  });

  it("Background Bash reuses the same notification/wake path upon completion", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const capture = await beginBackgroundTelemetryCapture();
    const prompt =
      "E2E_BACKGROUND_BASH: Run a background Bash command and report after notification.";
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await sendV4Prompt(prompt);
    await waitForV4ComposerText("", "background Bash prompt 发送后输入框没有清空");
    await waitForV4UserMessageContaining("E2E_BACKGROUND_BASH");
    await waitForToolCallBlockByToolName("Bash", 60000);
    await respondToBackgroundBlockers();

    const launchIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BACKGROUND_BASH", "Command running in background"],
      },
      requestCountBefore,
      "Background Bash launch tool result did not enter parent model request",
    );
    const notificationIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_BASH",
          "<task-notification>",
          "<tool-use-id>toolu_e2e_background_bash</tool-use-id>",
          "<status>completed</status>",
        ],
      },
      launchIndex,
      "Background Bash completion notification did not enter parent model request",
    );

    expect(notificationIndex).toBeGreaterThan(launchIndex);
    await waitForV4AssistantMessageContaining("background-bash-notification-consumed-ok");
    const block = await waitForToolCallBlockByToolName("Bash", 30000);
    expect(block.status).not.toBe("running");
    await waitForIdle("background Bash notification 后会话没有回到 idle");
    await waitForBackgroundResultPresentation({
      assistantMarker: "background-bash-notification-consumed-ok",
      expectedTitle: "Print background marker",
      failureLabel: "Background Bash standalone result turn",
    });
    await assertNoVisibleTaskNotification();
    const reports = await waitForConversationReportDelta(capture, {
      message_completion: 2,
    });
    assertMainCompletionAgentCompositions(reports, ["main_only", "main_only"]);
    assertMainCompletionMessageSources(reports, ["chat", "background_task"]);
  });

  it("When background task is running, normal user messages should be sent directly instead of queued", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const launchPrompt =
      "E2E_BACKGROUND_DIRECT_USER_PROMPT_SETUP: Start a long background Bash command and wait for my next message.";
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await sendV4Prompt(launchPrompt);
    await waitForV4ComposerText("", "background direct user prompt setup 发送后输入框没有清空");
    await waitForV4UserMessageContaining("E2E_BACKGROUND_DIRECT_USER_PROMPT_SETUP");
    await waitForToolCallBlockByToolCallId("toolu_e2e_background_direct_user_prompt_bash", 60000);
    await respondToBackgroundBlockers();

    const launchIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BACKGROUND_DIRECT_USER_PROMPT_SETUP", "Command running in background"],
      },
      requestCountBefore,
      "Bash launch result of background direct user prompt setup did not enter parent model request",
    );
    await waitForV4AssistantMessageContaining("background-direct-user-prompt-launched-ok");
    await waitForIdle("background direct user prompt setup 后父会话没有回到 idle");
    await waitForBackgroundTaskControlRow(
      "bash",
      "background direct user prompt bash sleep",
      "Background direct user prompt Bash did not appear in unified background control UI",
    );

    const directPrompt =
      "E2E_BACKGROUND_DIRECT_USER_PROMPT: This message should be sent immediately while the background task is still running. Payload: E2E_BACKGROUND_DIRECT_USER_PROMPT_PAYLOAD.";
    await sendV4Prompt(directPrompt);
    await waitForV4ComposerText("", "background running 时用户新消息发送后输入框没有清空");
    await waitForV4UserMessageContaining("E2E_BACKGROUND_DIRECT_USER_PROMPT_PAYLOAD");
    const directSnapshot = await getV4ConversationState();
    expect(directSnapshot.queueCount).toBe(0);

    const directPromptIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_DIRECT_USER_PROMPT",
          "E2E_BACKGROUND_DIRECT_USER_PROMPT_PAYLOAD",
        ],
        lastUserMessageIncludes: ["E2E_BACKGROUND_DIRECT_USER_PROMPT_PAYLOAD"],
      },
      launchIndex,
      "Normal user message did not enter provider request immediately while background is running",
    );

    expect(directPromptIndex).toBeGreaterThan(launchIndex);
    await waitForV4AssistantMessageContaining("background-direct-user-prompt-received-ok");
    await waitForIdle("Session did not return to idle after normal user message responded while background is running");
    await waitForBackgroundTaskControlRow(
      "bash",
      "background direct user prompt bash sleep",
      "Background Bash control row should not disappear after normal user message completes",
    );

    await clickStopBackgroundTaskControlRow("bash", "background direct user prompt bash sleep");
    const notificationIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_DIRECT_USER_PROMPT_SETUP",
          "<task-notification>",
          "<tool-use-id>toolu_e2e_background_direct_user_prompt_bash</tool-use-id>",
          "<status>killed</status>",
        ],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      directPromptIndex,
      "Background direct user prompt Bash stop notification did not enter parent model request",
    );

    expect(notificationIndex).toBeGreaterThan(directPromptIndex);
    await waitForV4AssistantMessageContaining("background-direct-user-prompt-bash-stopped-ok");
    await waitForNoBackgroundTaskControlRow(
      "bash",
      "background direct user prompt bash sleep",
      "Stopped background direct user prompt Bash still shows as running",
    );
    await waitForIdle("background direct user prompt Bash stop notification 后会话没有回到 idle");
    await assertNoVisibleTaskNotification();
  });

  it("Allow compact when background task is running and main is idle; completion notification continues based on compacted context", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const prompt =
      "E2E_BACKGROUND_COMPACT_AFTER_IDLE: Start a background Bash, then stay idle while I compact the conversation.";
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await sendV4PromptAndWaitAccepted(
      prompt,
      "E2E_BACKGROUND_COMPACT_AFTER_IDLE",
      "Background compact setup prompt was not accepted by composer",
    );
    await waitForToolCallBlockByToolCallId("toolu_e2e_background_compact_after_idle_bash", 60000);
    await respondToBackgroundBlockers();

    const launchIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BACKGROUND_COMPACT_AFTER_IDLE", "Command running in background"],
      },
      requestCountBefore,
      "Background compact Bash launch tool result did not enter parent model request",
    );
    await waitForV4AssistantMessageContaining("background-compact-launched-ok");
    await waitForIdle("Main did not return to idle after background compact setup");
    await waitForBackgroundTaskControlRow(
      "bash",
      "background compact bash sleep",
      "background compact Bash 没有出现在统一 background control UI",
    );

    await sendV4Prompt("/compact");
    await waitForV4ComposerText("", "Input box was not cleared after sending /compact while background is running");
    const compactMarker = await waitForCompactMarkerStatuses(["started", "completed"], "manual");
    expect(compactMarker.inputId).toBeTruthy();
    if (compactMarker.status !== "completed") {
      await waitForCompactMarkerStatus("completed", "manual", compactMarker.inputId);
    }

    const notificationIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "<task-notification>",
          "E2E_BACKGROUND_COMPACT_SUMMARY_MARKER",
          "toolu_e2e_background_compact_after_idle_bash",
          "<status>completed</status>",
        ],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      launchIndex,
      "background compact 后 completion notification 没有基于 compact 摘要进入父模型请求",
    );
    expect(notificationIndex).toBeGreaterThan(launchIndex);
    await waitForV4AssistantMessageContaining("background-compact-notification-consumed-ok");
    await waitForIdle("background compact notification 后会话没有回到 idle");
    await assertNoVisibleTaskNotification();
  });

  it("foreground long-running Bash timeout 后会转为 background，并在完成后从 UI 移除", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const prompt =
      "E2E_BACKGROUND_AUTO_TIMEOUT_BASH: Run an eligible foreground Bash command that should auto-background on timeout, then report after completion.";
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await sendV4PromptAndWaitAccepted(
      prompt,
      "E2E_BACKGROUND_AUTO_TIMEOUT_BASH",
      "foreground Bash auto-background prompt 没有被 composer 接受",
    );
    await waitForToolCallBlockByToolCallId("toolu_e2e_background_auto_timeout_bash", 60000);
    await respondToBackgroundBlockers();

    const launchIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BACKGROUND_AUTO_TIMEOUT_BASH", "Command running in background"],
      },
      requestCountBefore,
      "Foreground Bash did not return backgrounded tool result upon timeout",
    );
    await waitForBackgroundTaskControlRow(
      "bash",
      "auto timeout bash sleep",
      "auto-background Bash 没有出现在统一 background control UI",
    );

    const notificationIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_AUTO_TIMEOUT_BASH",
          "<task-notification>",
          "<tool-use-id>toolu_e2e_background_auto_timeout_bash</tool-use-id>",
          "<status>completed</status>",
        ],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      launchIndex,
      "auto-background Bash completion notification 没有进入父模型请求",
    );

    expect(notificationIndex).toBeGreaterThan(launchIndex);
    await waitForV4AssistantMessageContaining("background-auto-timeout-bash-completed-ok");
    await waitForNoBackgroundTaskControlRow(
      "bash",
      "auto timeout bash sleep",
      "Naturally completed auto-background Bash still shows as running",
    );
    await waitForIdle("auto-background Bash notification 后会话没有回到 idle");
    await assertNoVisibleTaskNotification();
  });

  it("Explicit background Bash completes naturally past input timeout and notifies only once", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const prompt =
      "E2E_BG37_EXPLICIT_TIMEOUT: Start an explicit background Bash whose timeout is shorter than its runtime, then report after completion.";
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await sendV4PromptAndWaitAccepted(
      prompt,
      "E2E_BG37_EXPLICIT_TIMEOUT",
      "BG37 prompt 没有被 composer 接受",
    );
    await waitForToolCallBlockByToolCallId("toolu_e2e_bg37_explicit_timeout", 60000);
    await respondToBackgroundBlockers();

    const launchIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BG37_EXPLICIT_TIMEOUT", "Command running in background"],
      },
      requestCountBefore,
      "BG37 explicit Bash 没有返回 background task ID",
    );
    const launchResult = await getLatestUpstreamToolResultByToolCallId(
      "toolu_e2e_bg37_explicit_timeout",
    );
    const outputPath = /Output is being written to: (.+?)\. You will be notified/u.exec(
      launchResult?.content ?? "",
    )?.[1];
    expect(outputPath).toBeTruthy();
    const runningOutput = await readFile(outputPath!, "utf8");
    expect(runningOutput).toContain("E2E_BG37_STARTED");
    expect(runningOutput).not.toContain("E2E_BG37_DONE");
    await waitForBackgroundTaskControlRow(
      "bash",
      "BG37 explicit timeout bash",
      "BG37 explicit Bash 没有出现在 background control UI",
    );
    await browser.pause(100);
    await waitForBackgroundTaskControlRow(
      "bash",
      "BG37 explicit timeout bash",
      "BG37 explicit Bash should not be terminated past input timeout",
    );

    const notificationIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BG37_EXPLICIT_TIMEOUT",
          "<task-notification>",
          "<tool-use-id>toolu_e2e_bg37_explicit_timeout</tool-use-id>",
          "<status>completed</status>",
        ],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      launchIndex,
      "BG37 explicit Bash completion notification 没有进入父模型请求",
    );
    await waitForV4AssistantMessageContaining("bg37-explicit-timeout-completed-ok");
    expect(
      await countUpstreamRequests(
        {
          includes: [
            "<task-notification>",
            "<tool-use-id>toolu_e2e_bg37_explicit_timeout</tool-use-id>",
          ],
        },
        { afterIndex: launchIndex },
      ),
    ).toBe(1);
    expect(notificationIndex).toBeGreaterThan(launchIndex);
    await waitForNoBackgroundTaskControlRow(
      "bash",
      "BG37 explicit timeout bash",
      "BG37 completed Bash still shows as running",
    );
    await waitForIdle("BG37 completion notification 后会话没有回到 idle");
    const completedOutput = await readFile(outputPath!, "utf8");
    expect(completedOutput).toContain("E2E_BG37_STARTED");
    expect(completedOutput).toContain("E2E_BG37_DONE");
  });

  it("explicit Bash commit 后停止 parent turn 不会终止后台进程", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await rm(BG38_STARTED_FILE, { force: true }).catch(() => undefined);
    await startNewBackgroundDraft();
    const prompt =
      "E2E_BG38_PARENT_ABORT: Start an explicit background Bash, keep the parent turn running, and let me stop that turn after the task starts.";
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await sendV4PromptAndWaitAccepted(
      prompt,
      "E2E_BG38_PARENT_ABORT",
      "BG38 prompt 没有被 composer 接受",
    );
    await waitForToolCallBlockByToolCallId("toolu_e2e_bg38_parent_abort", 60000);
    await respondToBackgroundBlockers();

    const launchIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BG38_PARENT_ABORT", "Command running in background"],
      },
      requestCountBefore,
      "BG38 explicit Bash 没有完成 background commit",
    );
    await waitForBackgroundTaskControlRow(
      "bash",
      "BG38 parent abort bash",
      "BG38 committed Bash 没有出现在 background control UI",
    );
    let startedMarker = "";
    await browser.waitUntil(
      async () => {
        startedMarker = await readFile(BG38_STARTED_FILE, "utf-8").catch(() => "");
        return startedMarker.includes("E2E_BG38_STARTED");
      },
      {
        timeout: 30000,
        timeoutMsg: `BG38 Bash 没有写出 started marker; latest=${startedMarker}`,
      },
    );
    await waitForMainLoading("BG38 parent turn 在 stop 前没有保持 running");
    await clickV4Stop();
    await waitForV4ConversationState(
      (snapshot) => snapshot.state !== "streaming",
      "BG38 parent turn stop 后没有退出 streaming",
      30000,
    );
    await waitForBackgroundTaskControlRow(
      "bash",
      "BG38 parent abort bash",
      "Background control row should not disappear after BG38 parent turn stop",
    );

    const notificationIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BG38_PARENT_ABORT",
          "<task-notification>",
          "<tool-use-id>toolu_e2e_bg38_parent_abort</tool-use-id>",
          "<status>completed</status>",
          "E2E_BG38_DONE",
        ],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      launchIndex,
      "BG38 parent abort 后 Bash 没有自然完成",
    );
    await waitForV4AssistantMessageContaining("bg38-parent-abort-background-completed-ok");
    expect(
      await countUpstreamRequests(
        {
          includes: [
            "<task-notification>",
            "<tool-use-id>toolu_e2e_bg38_parent_abort</tool-use-id>",
          ],
        },
        { afterIndex: launchIndex },
      ),
    ).toBe(1);
    expect(notificationIndex).toBeGreaterThan(launchIndex);
    await waitForNoBackgroundTaskControlRow(
      "bash",
      "BG38 parent abort bash",
      "BG38 completed Bash 留下 orphan control row",
    );
    await waitForIdle("BG38 completion notification 后会话没有回到 idle");
  });

  it("Foreground Bash with sleep as first token does not move to background upon timeout", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const prompt =
      "E2E_BG39_SLEEP_HARD_TIMEOUT: Run a foreground Bash whose first raw token is sleep with a timeout shorter than its runtime.";
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await sendV4PromptAndWaitAccepted(
      prompt,
      "E2E_BG39_SLEEP_HARD_TIMEOUT",
      "BG39 prompt 没有被 composer 接受",
    );
    await waitForToolCallBlockByToolCallId("toolu_e2e_bg39_sleep_timeout", 60000);
    await respondToBackgroundBlockers();

    const completionIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BG39_SLEEP_HARD_TIMEOUT",
          "<error>Command was aborted before completion</error>",
        ],
        excludes: ["Command running in background"],
      },
      requestCountBefore,
      "BG39 sleep Bash 没有返回 foreground timeout 结果",
    );
    await waitForV4AssistantMessageContaining("bg39-sleep-hard-timeout-ok");
    await browser.pause(500);
    expect(
      await countUpstreamRequests(
        {
          includes: [
            "<task-notification>",
            "<tool-use-id>toolu_e2e_bg39_sleep_timeout</tool-use-id>",
          ],
        },
        { afterIndex: completionIndex },
      ),
    ).toBe(0);
    await waitForNoBackgroundTaskControlRow(
      "bash",
      "BG39 sleep hard timeout",
      "BG39 sleep Bash should not generate a background control row",
    );
    await waitForIdle("BG39 foreground timeout 后会话没有回到 idle");
  });

  it("Bottom loading still displays while normal foreground long Bash is running", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await rm(BG14_PREVIEW_RELEASE_FILE, { force: true });
    await startNewBackgroundDraft();
    const prompt =
      "E2E_FOREGROUND_LONG_BASH_LOADING: Run a normal foreground Bash command long enough to show loading, then report after completion.";
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await sendV4PromptAndWaitAccepted(
      prompt,
      "E2E_FOREGROUND_LONG_BASH_LOADING",
      "foreground long Bash loading prompt was not accepted by composer",
    );
    await waitForToolCallBlockByToolCallId("toolu_e2e_foreground_long_bash_loading", 60000);
    await respondToBackgroundBlockers();
    await waitForMainLoading("Bottom loading should display when normal foreground long Bash is running");

    try {
      const trigger = await $(
        '[data-testid="tool-summary-trigger-toolu_e2e_foreground_long_bash_loading"]',
      );
      if ((await trigger.getAttribute("aria-expanded")) === "true") await trigger.click();
      await browser.waitUntil(
        async () => !(await $('[data-testid^="bash-output-preview-"]').isExisting()),
        { timeout: 5000, timeoutMsg: "收起的 Bash 不应渲染运行输出" },
      );
      await trigger.click();
      await browser.waitUntil(
        async () => {
          const preview = await $('[data-testid="bash-output-preview-full"]');
          return (
            (await preview.isDisplayed()) && (await preview.getText()).includes("progress-line-30")
          );
        },
        { timeout: 10000, timeoutMsg: "Bash expanded preview did not display long text" },
      );
      const full = await $('[data-testid="bash-output-preview-full"]');
      expect(await full.getText()).toContain("progress-line-30");
      expect(await full.getText()).toContain("progress-line-120");
      expect(
        await browser.execute(() => {
          const node = document.querySelector('[data-testid="bash-output-preview-full"]');
          return node instanceof HTMLElement && getComputedStyle(node).whiteSpace === "pre-wrap";
        }),
      ).toBe(true);
    } finally {
      await writeFile(BG14_PREVIEW_RELEASE_FILE, "release");
    }

    const completionIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_FOREGROUND_LONG_BASH_LOADING", "<persisted-output>"],
      },
      requestCountBefore,
      "tool result after foreground long Bash completion was not included in parent model request",
    );

    expect(completionIndex).toBeGreaterThan(requestCountBefore);
    await waitForV4AssistantMessageContaining("foreground-long-bash-loading-completed-ok");
    await waitForIdle("Session did not return to idle after foreground long Bash completed");
    expect(await $('[data-testid="bash-output-preview-full"]').isExisting()).toBe(false);
    await waitForToolCallBlockByToolCallId("toolu_e2e_foreground_long_bash_loading");
    const resultTrigger = await $(
      '[data-testid="tool-summary-trigger-toolu_e2e_foreground_long_bash_loading"]',
    );
    if ((await resultTrigger.getAttribute("aria-expanded")) !== "true") await resultTrigger.click();
    const result = await $('[data-testid="bash-result-output"]');
    await browser.waitUntil(
      async () =>
        (await result.isDisplayed()) && (await result.getText()).includes("progress-line-1"),
      { timeout: 10000, timeoutMsg: "Bash terminal state header text was not displayed" },
    );
    expect(await $('[data-testid="bash-output-notice"]').isExisting()).toBe(false);
    expect(await $('[data-testid="bash-output-file"]').isExisting()).toBe(false);
    expect(await result.getText()).not.toContain("E2E_FOREGROUND_LONG_BASH_DONE");
    expect(await result.getText()).not.toContain("<persisted-output>");
    const modelResult = await getLatestUpstreamToolResultByToolCallId(
      "toolu_e2e_foreground_long_bash_loading",
    );
    expect(modelResult?.content).toContain("<persisted-output>");
    expect(modelResult?.content).not.toContain("E2E_FOREGROUND_LONG_BASH_DONE");
    const outputPath = modelResult?.content.match(/Full output saved to: ([^\n]+)/)?.[1];
    if (!outputPath) throw new Error("Bash provider result is missing the retained output path");
    const output = await readFile(outputPath, "utf8");
    expect(Buffer.byteLength(output)).toBeGreaterThan(30000);
    expect(output).toContain("E2E_FOREGROUND_LONG_BASH_DONE");
  });

  it("background Bash can be stopped from unified background control UI", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const prompt =
      "E2E_BACKGROUND_CANCEL_BASH: Start a long background Bash command, wait for it to be stopped, then report the stop notification.";
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await sendV4PromptAndWaitAccepted(
      prompt,
      "E2E_BACKGROUND_CANCEL_BASH",
      "background Bash cancel prompt was not accepted by composer",
    );
    await waitForToolCallBlockByToolCallId("toolu_e2e_background_cancel_bash", 60000);
    await respondToBackgroundBlockers();

    const launchIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BACKGROUND_CANCEL_BASH", "Command running in background"],
      },
      requestCountBefore,
      "background Bash cancel launch tool result was not included in parent model request",
    );
    await openV4ComposerRunningBackgroundWorks();
    await waitForBackgroundTaskControlRow(
      "bash",
      "background cancel bash process tree",
      "background Bash did not appear in unified background control UI",
    );

    const [launcherPid, workerPid] = await Promise.all([
      waitForRunningPidFile(BG08_LAUNCHER_PID_FILE, "BG08 launcher"),
      waitForRunningPidFile(BG08_WORKER_PID_FILE, "BG08 worker"),
    ]);
    let rootPid: number | null = null;
    if (process.platform !== "win32") {
      rootPid = await waitForRunningPidFile(BG08_ROOT_PID_FILE, "BG08 root Bash");
      const [rootProcessGroupId, launcherProcessGroupId, workerProcessGroupId] = await Promise.all([
        readPosixProcessGroupId(rootPid),
        readPosixProcessGroupId(launcherPid),
        readPosixProcessGroupId(workerPid),
      ]);
      expect(launcherProcessGroupId).not.toBe(rootProcessGroupId);
      expect(workerProcessGroupId).toBe(launcherProcessGroupId);
    }

    await clickStopBackgroundTaskControlRow("bash", "background cancel bash process tree");

    await waitForV4AssistantMessageContaining("background-cancel-bash-launched-ok");
    const notificationIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_CANCEL_BASH",
          "<task-notification>",
          "<tool-use-id>toolu_e2e_background_cancel_bash</tool-use-id>",
          "<status>killed</status>",
        ],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      launchIndex,
      "background Bash stop notification was not included in parent model request",
    );

    expect(notificationIndex).toBeGreaterThan(launchIndex);
    await waitForV4AssistantMessageContaining("background-cancel-bash-stopped-ok");
    await waitForNoBackgroundTaskControlRow(
      "bash",
      "background cancel bash process tree",
      "Stopped background Bash still displays as running",
    );
    await Promise.all([
      rootPid === null ? Promise.resolve() : waitForProcessExit(rootPid, "BG08 root Bash"),
      waitForProcessExit(launcherPid, "BG08 launcher"),
      waitForProcessExit(workerPid, "BG08 worker"),
    ]);
    await waitForIdle("background Bash stop notification 后会话没有回到 idle");
    await assertNoVisibleTaskNotification();
  });

  it("background Agent can be stopped from unified background control UI", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const prompt =
      "E2E_BACKGROUND_CANCEL_AGENT: Start a long background Agent and stop it from the background control UI.";
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await sendV4PromptAndWaitAccepted(
      prompt,
      "E2E_BACKGROUND_CANCEL_AGENT",
      "background Agent cancel prompt was not accepted by composer",
    );
    await waitForToolCallBlockByToolCallId("toolu_e2e_background_cancel_agent", 60000);
    await respondToBackgroundBlockers();

    const launchIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BACKGROUND_CANCEL_AGENT", "Async agent launched successfully"],
      },
      requestCountBefore,
      "background Agent cancel launch tool result was not included in parent model request",
    );
    await waitForBackgroundTaskControlRow(
      "agent",
      "E2E background cancel agent",
      "background Agent did not appear in unified background control UI",
    );

    await clickStopBackgroundTaskControlRow("agent", "E2E background cancel agent");

    await waitForV4AssistantMessageContaining("background-cancel-agent-launched-ok");
    const notificationIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_CANCEL_AGENT",
          "<task-notification>",
          "<tool-use-id>toolu_e2e_background_cancel_agent</tool-use-id>",
          "<status>stopped</status>",
        ],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      launchIndex,
      "background Agent stop notification was not included in parent model request",
    );

    expect(notificationIndex).toBeGreaterThan(launchIndex);
    await waitForV4AssistantMessageContaining("background-cancel-agent-stopped-ok");
    await waitForNoBackgroundTaskControlRow(
      "agent",
      "E2E background cancel agent",
      "Stopped background Agent still displays as running",
    );
    await waitForIdle("background Agent stop notification 后会话没有回到 idle");
    await assertNoVisibleTaskNotification();
  });

  it("TaskStop tool 停止 background Agent 时复用同一 notification 链路", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const prompt =
      "E2E_BACKGROUND_TASKSTOP_AGENT: Start a background Agent, then use TaskStop on its task id and report after the stop notification.";
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await sendV4PromptAndWaitAccepted(
      prompt,
      "E2E_BACKGROUND_TASKSTOP_AGENT",
      "TaskStop background Agent prompt 没有被 composer 接受",
    );
    await waitForToolCallBlockByToolCallId("toolu_e2e_background_taskstop_agent", 60000);
    await respondToBackgroundBlockers();

    const taskStopIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_TASKSTOP_AGENT",
          "Async agent launched successfully",
          "agentId: agent_",
          "TaskStop",
        ],
      },
      requestCountBefore,
      "background Agent launch 后父模型没有调用 TaskStop",
    );
    const notificationIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_TASKSTOP_AGENT",
          "Successfully stopped task:",
          "<task-notification>",
          "<tool-use-id>toolu_e2e_background_taskstop_agent</tool-use-id>",
          "<status>stopped</status>",
        ],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      taskStopIndex,
      "background Agent stop notification was not included in parent model request after TaskStop",
    );

    expect(notificationIndex).toBeGreaterThan(taskStopIndex);
    await waitForV4AssistantMessageContaining("background-taskstop-agent-stopped-ok");
    await waitForIdle("TaskStop background Agent notification 后会话没有回到 idle");
    await assertNoVisibleTaskNotification();
  });

  it("background notification merges before next model request in active tool-loop", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const prompt =
      "E2E_BACKGROUND_ACTIVE_LOOP_BASH: Start a quick background Bash and keep the tool loop active until it can report completion.";
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await sendV4PromptAndWaitAccepted(
      prompt,
      "E2E_BACKGROUND_ACTIVE_LOOP_BASH",
      "active-loop background Bash prompt was not accepted by composer",
    );
    await waitForToolCallBlockByToolCallId("toolu_e2e_background_active_loop_bash_bg", 60000);
    await waitForToolCallBlockByToolCallId("toolu_e2e_background_active_loop_bash_wait", 60000);
    await respondToBackgroundBlockers();
    await respondToBackgroundBlockers();

    const activeLoopIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_ACTIVE_LOOP_BASH",
          "E2E_BACKGROUND_ACTIVE_LOOP_WAIT_DONE",
          "<task-notification>",
          "<tool-use-id>toolu_e2e_background_active_loop_bash_bg</tool-use-id>",
          "<status>completed</status>",
        ],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      requestCountBefore,
      "Subsequent model request in active-loop did not contain both Bash tool result and task-notification",
    );

    expect(activeLoopIndex).toBeGreaterThan(requestCountBefore);
    expect(
      await countUpstreamRequests(
        {
          includes: ["E2E_BACKGROUND_ACTIVE_LOOP_BASH", "toolu_e2e_background_active_loop_bash_bg"],
          lastUserMessageExcludes: ["<task-notification>"],
        },
        { afterIndex: requestCountBefore },
      ),
    ).toBe(0);
    expect(
      await countUpstreamRequests(
        {
          includes: [
            "<task-notification>",
            "<tool-use-id>toolu_e2e_background_active_loop_bash_bg</tool-use-id>",
          ],
          lastUserMessageIncludes: ["<task-notification>"],
        },
        { afterIndex: requestCountBefore },
      ),
    ).toBe(1);
    await waitForV4AssistantMessageContaining("background-active-loop-notification-consumed-ok");
    await waitForIdle("active-loop background notification 后会话没有回到 idle");
    await assertNoVisibleTaskNotification();
  });

  it("goal verifier waits for background notification to be consumed before verifying", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const goal =
      '/goal E2E_BACKGROUND_GOAL: Finish only after consuming the background agent result and then reply with "upstream-e2e-ok".';
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await sendV4Prompt(goal);
    await waitForV4ComposerText("", "background goal /goal 发送后输入框没有清空");
    await waitForV4UserMessageContaining("E2E_BACKGROUND_GOAL");
    await waitForToolCallBlockByToolName("Agent", 60000);
    await respondToBackgroundBlockers();

    const notificationIndex = await waitForFirstRequestIndex(
      {
        includes: ["<task-notification>", "E2E_BACKGROUND_GOAL_CHILD_RESULT"],
      },
      requestCountBefore,
      "goal background Agent completion notification was not included in parent model request",
    );
    await waitForV4AssistantMessageContaining("E2E_BACKGROUND_GOAL_NOTIFICATION_CONSUMED");
    const verifierIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BACKGROUND_GOAL", "Verify whether the active session goal"],
      },
      notificationIndex,
      "goal verifier was not triggered after background notification",
    );

    expect(verifierIndex).toBeGreaterThan(notificationIndex);
    expect(
      await countUpstreamRequests(
        {
          includes: ["E2E_BACKGROUND_GOAL", "Verify whether the active session goal"],
        },
        { beforeIndex: notificationIndex },
      ),
    ).toBe(0);
    await waitForV4ConversationState(
      (snapshot) => snapshot.targetStatus === "complete" || snapshot.targetStatus === "verified",
      "background goal verifier did not mark target as complete/verified",
      90000,
    );
    await assertNoVisibleTaskNotification();
  });

  it("running background Agent can receive steer messages via SendMessage", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const prompt =
      "E2E_BACKGROUND_SEND_MESSAGE: Launch a background agent, then send it a coordinator message while it is still running.";
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await sendV4Prompt(prompt);
    await waitForV4ComposerText("", "background SendMessage prompt 发送后输入框没有清空");
    await waitForV4UserMessageContaining("E2E_BACKGROUND_SEND_MESSAGE");
    await waitForToolCallBlockByToolName("Agent", 60000);
    await respondToBackgroundBlockers();

    const sendMessageIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_SEND_MESSAGE",
          "Async agent launched successfully",
          "agentId: agent_",
          "E2E_BACKGROUND_SEND_MESSAGE_PAYLOAD",
        ],
        excludes: ["sent to its active turn"],
      },
      requestCountBefore,
      "background Agent launch 后父模型没有调用 SendMessage",
    );
    const sendMessageResultIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_SEND_MESSAGE",
          "E2E_BACKGROUND_SEND_MESSAGE_PAYLOAD",
          "sent to its active turn",
        ],
      },
      sendMessageIndex,
      "background Agent SendMessage tool result was not included in parent model request",
    );
    const coordinatorQuery = {
      includes: ["E2E_BACKGROUND_SEND_MESSAGE_CHILD_BASH_DONE"],
      lastUserMessageIncludes: [
        "The coordinator sent a message while you were working:",
        "E2E_BACKGROUND_SEND_MESSAGE_PAYLOAD",
      ],
    };
    await waitForFirstRequestIndex(
      coordinatorQuery,
      requestCountBefore - 1,
      "running child did not receive coordinator prompt",
    );
    const coordinatorEvidence = await getUpstreamRequestEvidence(coordinatorQuery, {
      afterIndex: requestCountBefore - 1,
    });
    await assertIncomingMessage(coordinatorEvidence[0]!.requestJson, {
      presentation: "coordinator_steer",
      marker: "E2E_BACKGROUND_SEND_MESSAGE_PAYLOAD",
      role: "user",
      body: "E2E_BACKGROUND_SEND_MESSAGE_STEER\n\nE2E_BACKGROUND_SEND_MESSAGE_PAYLOAD",
    });
    const notificationIndex = await waitForFirstRequestIndex(
      {
        includes: ["<task-notification>", "E2E_BACKGROUND_SEND_MESSAGE_CHILD_RECEIVED"],
      },
      sendMessageResultIndex,
      "background Agent completion notification was not included in parent model request after SendMessage",
    );

    expect(sendMessageIndex).toBeGreaterThan(requestCountBefore);
    expect(sendMessageResultIndex).toBeGreaterThan(sendMessageIndex);
    expect(notificationIndex).toBeGreaterThan(sendMessageResultIndex);
    await waitForIdle("background SendMessage notification 后会话没有回到 idle");
    await assertNoVisibleTaskNotification();
  });

  it("main still shows bottom loading while foreground subagent runs child tool", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const capture = await beginBackgroundTelemetryCapture();
    const prompt =
      "E2E_FOREGROUND_AGENT_CHILD_TOOL_STREAMING_STATUS: Launch a foreground agent that runs a visible child Bash tool while the parent conversation is still running.";
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await sendV4Prompt(prompt);
    await waitForV4ComposerText("", "foreground child tool streaming prompt 发送后输入框没有清空");
    await waitForV4UserMessageContaining("E2E_FOREGROUND_AGENT_CHILD_TOOL_STREAMING_STATUS");
    await waitForToolCallBlockByToolCallId("toolu_e2e_foreground_child_tool_agent", 60000);
    await respondToBackgroundBlockers();

    await waitForMainLoading("main bottom loading should be maintained while foreground subagent runs child tool");
    await assertNoMainToolCallById(
      "toolu_e2e_foreground_child_tool_bash",
      "foreground child Bash should not be mirrored as main timeline tool row",
    );

    const completionIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_FOREGROUND_AGENT_CHILD_TOOL_STREAMING_STATUS",
          "E2E_FOREGROUND_AGENT_CHILD_TOOL_DONE",
        ],
      },
      requestCountBefore,
      "foreground child tool Agent completion was not included in parent model request",
    );

    expect(completionIndex).toBeGreaterThan(requestCountBefore);
    await waitForV4AssistantMessageContaining("foreground-agent-child-tool-streaming-completed-ok");
    await waitForIdle("Session did not return to idle after foreground child tool Agent completion");
    const reports = await waitForConversationReportDelta(capture, {
      agent_step: 1,
      message_completion: 1,
    });
    assertMainCompletionAgentCompositions(reports, ["main_plus_fg"]);
    assertMainCompletionMessageSources(reports, ["chat"]);
  });

  it("同一 main turn 同时消费 foreground 和 background subagent 结果", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    await rm(BACKGROUND_MIXED_FOREGROUND_RELEASE_FILE, { force: true });
    const capture = await beginBackgroundTelemetryCapture();
    const prompt =
      "E2E_AGENT_COMPOSITION_MIXED: Launch one foreground Agent and one background Agent, then summarize both results.";
    const requestCountBefore = await getUpstreamRequestRecordCount();

    try {
      await sendV4Prompt(prompt);
      await waitForV4ComposerText("", "mixed agent composition prompt 发送后输入框没有清空");
      await waitForV4UserMessageContaining("E2E_AGENT_COMPOSITION_MIXED");
      await waitForToolCallBlockByToolCallId("toolu_e2e_composition_mixed_foreground", 60000);
      await waitForToolCallBlockByToolCallId("toolu_e2e_composition_mixed_background", 60000);
      await browser.waitUntil(
        async () => {
          const evidence = await getUpstreamRequestEvidence(
            {
              lastUserMessageIncludes: ["E2E_AGENT_COMPOSITION_MIXED_FOREGROUND_CHILD"],
            },
            { afterIndex: requestCountBefore },
          );
          return evidence.some(
            (record) =>
              record.fixtureId === "upstream-agent-composition-mixed-foreground-child" &&
              record.status === "complete",
          );
        },
        {
          timeout: 45000,
          timeoutMsg: "mixed agent composition foreground child 没有进入 Bash barrier",
        },
      );
      await respondToBackgroundBlockers();

      await browser.waitUntil(
        async () => {
          const evidence = await getUpstreamRequestEvidence(
            {
              lastUserMessageIncludes: ["E2E_AGENT_COMPOSITION_MIXED_BACKGROUND_CHILD"],
            },
            { afterIndex: requestCountBefore },
          );
          return evidence.some(
            (record) =>
              record.fixtureId === "upstream-agent-composition-mixed-background-child" &&
              record.status === "complete",
          );
        },
        {
          timeout: 45000,
          timeoutMsg: "mixed agent composition background child 没有完成 provider response",
        },
      );
      await writeFile(BACKGROUND_MIXED_FOREGROUND_RELEASE_FILE, "release\n", "utf-8");

      const mixedRequestIndex = await waitForFirstRequestIndex(
        {
          includes: [
            "E2E_AGENT_COMPOSITION_MIXED_FOREGROUND_DONE",
            "E2E_AGENT_COMPOSITION_MIXED_BACKGROUND_DONE",
            "<task-notification>",
          ],
          lastUserMessageIncludes: [
            "<task-notification>",
            "E2E_AGENT_COMPOSITION_MIXED_FOREGROUND_DONE",
          ],
        },
        requestCountBefore,
        "mixed agent composition 没有在同一 main request 消费 foreground 和 background 结果",
      );
      expect(mixedRequestIndex).toBeGreaterThan(requestCountBefore);

      await waitForV4AssistantMessageContaining("agent-composition-mixed-completed-ok");
      await waitForIdle("Session did not return to idle after mixed agent composition finalized");
      const reports = await waitForConversationReportDelta(capture, {
        agent_step: 1,
        message_completion: 1,
      });
      assertMainCompletionAgentCompositions(reports, ["main_plus_fg_bg"]);
      assertMainCompletionMessageSources(reports, ["chat"]);
    } finally {
      await writeFile(BACKGROUND_MIXED_FOREGROUND_RELEASE_FILE, "release\n", "utf-8").catch(
        () => undefined,
      );
    }
  });

  it("background subagent's child tool stays only in child conversation, and idle main does not show bottom loading", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const capture = await beginBackgroundTelemetryCapture();
    await rm(BACKGROUND_CHILD_TOOL_IDLE_RELEASE_FILE, { force: true });
    const prompt =
      "E2E_BACKGROUND_AGENT_CHILD_TOOL_IDLE_STATUS: Launch a background agent that runs a visible child Bash tool while the parent conversation is idle.";
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await sendV4Prompt(prompt);
    await waitForV4ComposerText("", "background child tool idle prompt 发送后输入框没有清空");
    await waitForV4UserMessageContaining("E2E_BACKGROUND_AGENT_CHILD_TOOL_IDLE_STATUS");
    await waitForToolCallBlockByToolCallId("toolu_e2e_background_idle_child_tool_agent", 60000);
    await respondToBackgroundBlockers();

    const launchIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_AGENT_CHILD_TOOL_IDLE_STATUS",
          "Async agent launched successfully",
        ],
      },
      requestCountBefore,
      "background child tool idle Agent launch tool result was not included in parent model request",
    );
    await waitForV4AssistantMessageContaining("background-agent-child-tool-idle-launched-ok");
    await waitForIdle("Parent session did not return to idle first after background child tool idle launch");
    await waitForBackgroundTaskControlRow(
      "agent",
      "E2E background child tool idle",
      "background child tool idle Agent 没有出现在统一 background control UI",
    );
    await assertNoMainToolCallById(
      "toolu_e2e_background_idle_child_tool_bash",
      "background child Bash should not be mirrored as main timeline tool row",
    );
    await assertNoMainFakeLoading(
      "background subagent child tool update 不应让 idle main 显示底部 loading",
    );
    await writeFile(BACKGROUND_CHILD_TOOL_IDLE_RELEASE_FILE, "release\n", "utf-8");

    const notificationIndex = await waitForFirstRequestIndex(
      {
        includes: ["<task-notification>", "E2E_BACKGROUND_AGENT_CHILD_TOOL_IDLE_DONE"],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      launchIndex,
      "background child tool idle Agent completion notification was not included in parent model request",
    );

    expect(notificationIndex).toBeGreaterThan(launchIndex);
    await waitForV4AssistantMessageContaining(
      "background-agent-child-tool-idle-notification-consumed-ok",
    );
    await waitForIdle("Session did not return to idle after background child tool idle notification");
    const { eventReport: reports } = await checkpointConversationTelemetryCase(capture, {
      caseId: "BG13-token-identity",
      minimumReportInventory: { agent_step: 1, message_completion: 2 },
      minimumArmsInventory: {},
      proof: ["child Bash + Agent usage owner", "new UUID v7 wake message"],
    });
    assertBackgroundToolStepTelemetry(reports, "toolu_e2e_background_idle_child_tool_bash");
    assertMainCompletionAgentCompositions(reports, ["main_only", "main_plus_bg"]);
    assertMainCompletionMessageSources(reports, ["chat", "background_subagent"]);
    await assertNoVisibleTaskNotification();
  });

  it("background subagent's child tool does not pollute subsequent main responses and original Agent control identity remains stable", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const capture = await beginBackgroundTelemetryCapture();
    const prompt =
      "E2E_BACKGROUND_CHILD_TOOL_PARENT_ANCHOR: Launch a background agent whose child tool update arrives after my next main prompt has completed.";
    const followUpPrompt =
      "E2E_BACKGROUND_CHILD_TOOL_PARENT_ANCHOR_FOLLOWUP: This main prompt should complete before the background child Bash update arrives.";
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await rm(BACKGROUND_PARENT_ANCHOR_RELEASE_FILE, { force: true });

    await sendV4Prompt(prompt);
    await waitForV4ComposerText("", "background parent anchor prompt 发送后输入框没有清空");
    await waitForV4UserMessageContaining("E2E_BACKGROUND_CHILD_TOOL_PARENT_ANCHOR");
    await waitForToolCallBlockByToolCallId("toolu_e2e_background_parent_anchor_agent", 60000);
    await respondToBackgroundBlockers();

    const launchIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BACKGROUND_CHILD_TOOL_PARENT_ANCHOR", "Async agent launched successfully"],
      },
      requestCountBefore,
      "background parent anchor Agent launch tool result was not included in parent model request",
    );
    await waitForV4AssistantMessageContaining("background-child-tool-parent-anchor-launched-ok");
    await waitForIdle("Parent session did not return to idle first after background parent anchor launch");
    await waitForBackgroundTaskControlRow(
      "agent",
      "E2E background child tool parent anchor",
      "background parent anchor Agent 没有出现在统一 background control UI",
    );

    await sendV4Prompt(followUpPrompt);
    await waitForV4ComposerText("", "background parent anchor follow-up 发送后输入框没有清空");
    await waitForV4UserMessageContaining("E2E_BACKGROUND_CHILD_TOOL_PARENT_ANCHOR_FOLLOWUP");
    const followUpIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BACKGROUND_CHILD_TOOL_PARENT_ANCHOR_FOLLOWUP"],
        lastUserMessageIncludes: ["E2E_BACKGROUND_CHILD_TOOL_PARENT_ANCHOR_FOLLOWUP"],
      },
      launchIndex,
      "background parent anchor follow-up was not immediately included in provider request",
    );
    expect(followUpIndex).toBeGreaterThan(launchIndex);
    await waitForV4AssistantMessageContaining(
      "background-child-tool-parent-anchor-main-followup-ok",
    );

    await waitForBackgroundTaskControlRow(
      "agent",
      "E2E background child tool parent anchor",
      "Original Agent control identity was not maintained after background child tool arrived",
    );
    await assertNoMainToolCallById(
      "toolu_e2e_background_parent_anchor_child_bash",
      "background child Bash 不应污染后续 main timeline",
    );
    await writeFile(BACKGROUND_PARENT_ANCHOR_RELEASE_FILE, "release\n", "utf-8");
    await respondToBackgroundBlockers();

    const notificationIndex = await waitForFirstRequestIndex(
      {
        includes: ["<task-notification>", "E2E_BACKGROUND_CHILD_TOOL_PARENT_ANCHOR_CHILD_DONE"],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      followUpIndex,
      "background parent anchor Agent completion notification was not included in parent model request",
    );

    expect(notificationIndex).toBeGreaterThan(followUpIndex);
    await waitForV4AssistantMessageContaining(
      "background-child-tool-parent-anchor-notification-consumed-ok",
    );
    await waitForIdle("Session did not return to idle after background parent anchor notification");
    const { eventReport: reports } = await checkpointConversationTelemetryCase(capture, {
      caseId: "BG18-token-identity",
      minimumReportInventory: { agent_step: 1, message_completion: 3 },
      minimumArmsInventory: {},
      proof: [
        "child usage retains original launch identity after follow-up",
        "new UUID v7 wake message",
      ],
    });
    assertBackgroundToolStepTelemetry(reports, "toolu_e2e_background_parent_anchor_child_bash");
    assertMainCompletionAgentCompositions(reports, ["main_only", "main_only", "main_plus_bg"]);
    assertMainCompletionMessageSources(reports, ["chat", "chat", "background_subagent"]);
    await assertNoVisibleTaskNotification();
  });

  it("background subagent completed while switching sessions should retain parent Agent description and finalize upon switching back", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const prompt =
      "E2E_BACKGROUND_CHILD_TOOL_SESSION_SWITCH: Launch a background agent whose child Bash completes while I am viewing another session.";
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await rm(BG21_RELEASE_FILE, { force: true });

    await sendV4Prompt(prompt);
    await waitForV4ComposerText("", "background session switch prompt 发送后输入框没有清空");
    await waitForV4UserMessageContaining("E2E_BACKGROUND_CHILD_TOOL_SESSION_SWITCH");
    await waitForToolCallBlockByToolCallId("toolu_e2e_background_session_switch_agent", 60000);
    await respondToBackgroundBlockers();

    const launchIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BACKGROUND_CHILD_TOOL_SESSION_SWITCH", "Async agent launched successfully"],
      },
      requestCountBefore,
      "background session switch Agent launch tool result was not included in parent model request",
    );
    await waitForV4AssistantMessageContaining("background-session-switch-launched-ok");
    const sessionSwitchSnapshot = await waitForIdle(
      "Parent session did not return to idle first after background session switch launch",
    );
    const sourceTaskId = sessionSwitchSnapshot.taskId;
    if (!sourceTaskId) {
      throw new Error(
        `background session switch Missing source taskId: ${JSON.stringify(sessionSwitchSnapshot)}`,
      );
    }

    await waitForBackgroundTaskControlRow(
      "agent",
      "E2E background session switch child tool",
      "background session switch Agent 没有出现在统一 background control UI",
    );
    await assertNoMainToolCallById(
      "toolu_e2e_background_session_switch_child_bash",
      "background session switch child Bash 不应进入 main timeline",
    );

    await startNewBackgroundDraft();
    await waitForV4ConversationState(
      (snapshot) => snapshot.taskId === null && snapshot.sessionId === null,
      "background session switch did not switch to the new draft task",
      30000,
    );
    await writeFile(BG21_RELEASE_FILE, "release\n", "utf-8");

    const notificationIndex = await waitForFirstRequestIndex(
      {
        includes: ["<task-notification>", "E2E_BACKGROUND_CHILD_TOOL_SESSION_SWITCH_CHILD_DONE"],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      launchIndex,
      "background session switch Agent completion notification 没有进入父模型请求",
    );
    expect(notificationIndex).toBeGreaterThan(launchIndex);

    await selectV4TaskById(sourceTaskId);
    await waitForV4ConversationState(
      (snapshot) => snapshot.taskId === sourceTaskId,
      "background session switch chat root was not restored to the original task after switching back",
      30000,
    );
    await waitForV4AssistantMessageContaining("background-session-switch-notification-consumed-ok");
    await waitForIdle("background session switch session did not return to idle after notification");
    await waitForNoBackgroundTaskControlRow(
      "agent",
      "E2E background session switch child tool",
      "background session switch parent Agent control did not finalize after switching back",
    );
    await waitForV4TimelineContaining("E2E background session switch child tool", 60000);
    expect((await getV4PaneSnapshot()).timelineText).not.toContain("Unknown");
    await assertNoMainToolCallById(
      "toolu_e2e_background_session_switch_child_bash",
      "background session switch should not resurrect child Bash as main row after switching back",
    );
    await assertNoVisibleTaskNotification();
  });

  it("Background subagent is still running when switching back to session; parent Agent state should continue to finalize", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const prompt =
      "E2E_BACKGROUND_CHILD_TOOL_SWITCH_BACK_RUNNING: Launch a background agent whose child Bash is still running when I switch back.";
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await rm(BACKGROUND_SWITCH_BACK_RELEASE_FILE, { force: true });

    await sendV4Prompt(prompt);
    await waitForV4ComposerText("", "background switch-back-running input box was not cleared after prompt was sent");
    await waitForV4UserMessageContaining("E2E_BACKGROUND_CHILD_TOOL_SWITCH_BACK_RUNNING");
    await waitForToolCallBlockByToolCallId("toolu_e2e_background_switch_back_running_agent", 60000);
    await respondToBackgroundBlockers();

    const launchIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_CHILD_TOOL_SWITCH_BACK_RUNNING",
          "Async agent launched successfully",
        ],
      },
      requestCountBefore,
      "background switch-back-running Agent launch tool result 没有进入父模型请求",
    );
    await waitForV4AssistantMessageContaining("background-switch-back-running-launched-ok");
    const sourceSnapshot = await waitForIdle(
      "background switch-back-running parent session did not first return to idle after launch",
    );
    const sourceTaskId = sourceSnapshot.taskId;
    if (!sourceTaskId) {
      throw new Error(
        `background switch-back-running Missing source taskId: ${JSON.stringify(sourceSnapshot)}`,
      );
    }

    await waitForBackgroundTaskControlRow(
      "agent",
      "E2E background switch back running child tool",
      "background switch-back-running Agent 没有出现在统一 background control UI",
    );
    await assertNoMainToolCallById(
      "toolu_e2e_background_switch_back_running_child_bash",
      "background switch-back-running child Bash 不应进入 main timeline",
    );

    await startNewBackgroundDraft();
    await waitForV4ConversationState(
      (snapshot) => snapshot.taskId === null && snapshot.sessionId === null,
      "background switch-back-running 没有切到新草稿 task",
      30000,
    );

    await selectV4TaskById(sourceTaskId);
    await waitForV4ConversationState(
      (snapshot) => snapshot.taskId === sourceTaskId,
      "background switch-back-running chat root was not restored to original task after switching back",
      30000,
    );
    await waitForBackgroundTaskControlRow(
      "agent",
      "E2E background switch back running child tool",
      "background switch-back-running parent Agent running control was not restored after switching back",
    );
    await assertNoMainToolCallById(
      "toolu_e2e_background_switch_back_running_child_bash",
      "background switch-back-running should not project child Bash onto main timeline after switching back",
    );
    await writeFile(BACKGROUND_SWITCH_BACK_RELEASE_FILE, "release\n", "utf-8");

    const notificationIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "<task-notification>",
          "E2E_BACKGROUND_CHILD_TOOL_SWITCH_BACK_RUNNING_CHILD_DONE",
        ],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      launchIndex,
      "background switch-back-running Agent completion notification 没有进入父模型请求",
    );
    expect(notificationIndex).toBeGreaterThan(launchIndex);
    await waitForV4AssistantMessageContaining(
      "background-switch-back-running-notification-consumed-ok",
    );
    await waitForIdle("background switch-back-running session did not return to idle after notification");
    await waitForNoBackgroundTaskControlRow(
      "agent",
      "E2E background switch back running child tool",
      "background switch-back-running parent Agent control did not finalize upon completion",
    );
    await waitForV4TimelineContaining("E2E background switch back running child tool", 60000);
    expect((await getV4PaneSnapshot()).timelineText).not.toContain("Unknown");
    await assertNoMainToolCallById(
      "toolu_e2e_background_switch_back_running_child_bash",
      "background switch-back-running should not resurrect child Bash as main row upon completion",
    );
    await assertNoVisibleTaskNotification();
  });

  it("Clicking send now on queued prompt while background-only is running should not stop background task", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const prompt =
      "E2E_BACKGROUND_SEND_NOW_QUEUE: Launch a background agent with a visible child Bash tool, then wait.";
    const queuedPrompt =
      "E2E_BACKGROUND_SEND_NOW_QUEUE_PAYLOAD: This queued prompt should send now without stopping the background agent.";
    const holdPrompt =
      'E2E_HOLD_STREAM E2E_BACKGROUND_SEND_NOW_QUEUE_HOLD: Reply with exactly "upstream-e2e-ok" and no other text.';
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await sendV4Prompt(prompt);
    await waitForV4ComposerText("", "background send-now queue input box was not cleared after prompt was sent");
    await waitForV4UserMessageContaining("E2E_BACKGROUND_SEND_NOW_QUEUE");
    await waitForToolCallBlockByToolCallId("toolu_e2e_background_send_now_queue_agent", 60000);
    await respondToBackgroundBlockers();

    const launchIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BACKGROUND_SEND_NOW_QUEUE", "Async agent launched successfully"],
      },
      requestCountBefore,
      "background send-now queue Agent launch tool result 没有进入父模型请求",
    );
    await waitForV4AssistantMessageContaining("background-send-now-queue-launched-ok");
    await waitForIdle("background send-now queue parent session did not first return to idle after launch");
    await waitForBackgroundTaskControlRow(
      "agent",
      "E2E background send now queue",
      "background send-now queue Agent 没有保持 running control",
    );
    await assertNoMainToolCallById(
      "toolu_e2e_background_send_now_queue_child_bash",
      "background send-now queue child Bash 不应进入 main timeline",
    );
    await assertNoMainFakeLoading(
      "background send-now queue child tool update 不应让 idle main 显示底部 loading",
    );

    await sendV4Prompt(holdPrompt);
    await waitForV4ComposerText("", "background send-now hold input box was not cleared after prompt was sent");
    await waitForV4UserMessageContaining("E2E_BACKGROUND_SEND_NOW_QUEUE_HOLD");
    await waitForV4ConversationState(
      (snapshot) => snapshot.state === "streaming",
      "background send-now hold prompt 没有进入 streaming",
      30000,
    );
    await sendV4Prompt(queuedPrompt);
    await waitForV4ComposerText("", "background send-now queued prompt 没有清空");
    const queuedBeforeSendNow = await waitForQueueOrderContaining(
      ["E2E_BACKGROUND_SEND_NOW_QUEUE_PAYLOAD"],
      "background-only running queued prompt was not formed before clicking send-now",
    );
    expect(queuedBeforeSendNow[0]?.kind).toBe("text");

    await clickV4Stop();
    await waitForV4ConversationState(
      (snapshot) =>
        snapshot.state !== "streaming" && !snapshot.stopRequested && snapshot.queueCount === 1,
      "background send-now did not enter background-only + paused queue after stop",
      30000,
    );
    await waitForBackgroundTaskControlRow(
      "agent",
      "E2E background send now queue",
      "background send-now mistakenly stopped background Agent after stopping main turn",
    );

    const sentNowItem = await clickFirstQueueSendNow();
    expect(sentNowItem.content).toContain("E2E_BACKGROUND_SEND_NOW_QUEUE_PAYLOAD");
    await browser.pause(80);
    const afterClickSnapshot = await getV4ConversationState();
    expect(afterClickSnapshot.stopRequested).toBe(false);

    const queuedPromptIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BACKGROUND_SEND_NOW_QUEUE_PAYLOAD"],
        lastUserMessageIncludes: ["E2E_BACKGROUND_SEND_NOW_QUEUE_PAYLOAD"],
      },
      launchIndex,
      "Under background-only running, queued prompt did not go directly into provider request after clicking send now",
    );

    expect(queuedPromptIndex).toBeGreaterThan(launchIndex);
    await waitForV4AssistantMessageContaining("background-send-now-queue-received-ok");
    await writeFile(BACKGROUND_SEND_NOW_QUEUE_RELEASE_FILE, "release\n", "utf-8");
    const notificationIndex = await waitForFirstRequestIndex(
      {
        includes: ["<task-notification>", "E2E_BACKGROUND_SEND_NOW_QUEUE_CHILD_DONE"],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      queuedPromptIndex,
      "background send-now queue Agent completion notification 没有进入父模型请求",
    );

    expect(notificationIndex).toBeGreaterThan(queuedPromptIndex);
    await waitForV4AssistantMessageContaining("background-send-now-queue-notification-consumed-ok");
    await waitForIdle("background send-now queue session did not return to idle after notification");
    await assertNoVisibleTaskNotification();
  });

  it("When main turn ends after starting background task, it continues to drain existing queue without losing subsequent queued prompts", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const backgroundLaunchPrompt =
      "E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END: Start a background agent, but let me queue follow-up messages while this main turn is still running.";
    const queuedPromptTwo =
      "E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q2: Q2 should queue while the background launch turn is still active.";
    const queuedPromptThree =
      "E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q3: Q3 should queue behind Q2 while the background launch turn is still active.";
    const queuedPromptFour =
      "E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q4: Q4 should queue behind Q3 while the background launch turn is still active.";
    const requestCountBefore = await getUpstreamRequestRecordCount();
    const lastRequestIndexBefore = requestCountBefore - 1;

    await sendV4Prompt(backgroundLaunchPrompt);
    await waitForV4ComposerText("", "background queue drain launch input box was not cleared after prompt was sent");
    await waitForV4UserMessageContaining("E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END");
    const backgroundPromptIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END"],
        lastUserMessageIncludes: ["E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END"],
      },
      lastRequestIndexBefore,
      "background launch prompt 没有进入 provider request",
    );
    await waitForToolCallBlockByToolCallId("toolu_e2e_background_queue_drain_agent", 60000);
    await respondToBackgroundBlockers();
    await waitForBackgroundTaskControlRow(
      "agent",
      "E2E background queue drain agent",
      "background queue drain Agent 没有出现在统一 background control UI",
    );
    await waitForV4ConversationState(
      (snapshot) => snapshot.state === "streaming",
      "background queue drain main did not stay running during launch ack delay",
      30000,
    );

    await sendV4Prompt(queuedPromptTwo);
    await waitForV4ComposerText("", "background queue drain input box was not cleared after Q2 was enqueued");
    await waitForQueueOrderContaining(
      ["E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q2"],
      "Q2 did not enter queue while background Agent is running and launch ack has not completed",
    );

    await sendV4Prompt(queuedPromptThree);
    await waitForV4ComposerText("", "background queue drain input box was not cleared after Q3 was enqueued");
    await waitForQueueOrderContaining(
      [
        "E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q2",
        "E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q3",
      ],
      "Q2/Q3 queue order is incorrect while background Agent is running and launch ack has not completed",
    );

    await sendV4Prompt(queuedPromptFour);
    await waitForV4ComposerText("", "background queue drain input box was not cleared after Q4 was enqueued");
    await waitForQueueOrderContaining(
      [
        "E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q2",
        "E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q3",
        "E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q4",
      ],
      "Q2/Q3/Q4 queue order is incorrect while background Agent is running and launch ack has not completed",
    );

    await startVisibleUserMessageSampler();

    const launchIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END",
          "Async agent launched successfully",
        ],
      },
      backgroundPromptIndex,
      "background queue drain Agent launch tool result did not enter parent model request",
    );
    expect(launchIndex).toBeGreaterThan(backgroundPromptIndex);
    await waitForV4AssistantMessageContaining("background-queue-drain-launched-ok");

    const secondQueuedIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q2"],
        lastUserMessageIncludes: ["E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q2"],
      },
      launchIndex,
      "Q2 did not continue to drain after background prompt completed",
    );
    expect(secondQueuedIndex).toBeGreaterThan(launchIndex);
    await waitForVisibleUserMessagesContainingAll(
      ["E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q2"],
      "Q2 should render as visible user message after drain",
    );
    await waitForQueueOrderContaining(
      [
        "E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q3",
        "E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q4",
      ],
      "Q2 drain 期间 Q3/Q4 应仍留在 queue 中",
    );
    expect(
      await countUpstreamRequests(
        {
          includes: ["E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q4"],
          lastUserMessageIncludes: ["E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q4"],
        },
        { afterIndex: secondQueuedIndex },
      ),
    ).toBe(0);

    await waitForV4AssistantMessageContaining("background-queue-drain-first-ok");

    const thirdQueuedIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q3"],
        lastUserMessageIncludes: ["E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q3"],
      },
      secondQueuedIndex,
      "Q3 did not continue to drain after Q2 completed",
    );
    expect(thirdQueuedIndex).toBeGreaterThan(secondQueuedIndex);
    await waitForVisibleUserMessagesContainingAll(
      [
        "E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q2",
        "E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q3",
      ],
      "Q2/Q3 should both remain in visible user messages after Q3 drain",
    );
    await waitForQueueOrderContaining(
      ["E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q4"],
      "Q3 drain 期间 Q4 应仍留在 queue 中",
    );
    expect(
      await countUpstreamRequests(
        {
          includes: ["E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q4"],
          lastUserMessageIncludes: ["E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q4"],
        },
        { afterIndex: thirdQueuedIndex },
      ),
    ).toBe(0);

    await waitForV4AssistantMessageContaining("background-queue-drain-second-ok");

    const fourthQueuedIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q4"],
        lastUserMessageIncludes: ["E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q4"],
      },
      thirdQueuedIndex,
      "Q4 did not continue to drain after Q3 completed",
    );
    expect(fourthQueuedIndex).toBeGreaterThan(thirdQueuedIndex);
    await waitForVisibleUserMessagesContainingAll(
      [
        "E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q2",
        "E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q3",
        "E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q4",
      ],
      "Q4 drain 后 Q2/Q3/Q4 应同时保留在可见 user messages 中",
    );
    assertVisibleUserMessageMarkersNeverDisappear(await stopVisibleUserMessageSampler(), [
      "E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q2",
      "E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q3",
      "E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_Q4",
    ]);
    await waitForV4AssistantMessageContaining("background-queue-drain-third-ok");

    const notificationIndex = await waitForFirstRequestIndex(
      {
        includes: ["<task-notification>", "E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_CHILD_DONE"],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      fourthQueuedIndex,
      "background queue drain Agent completion notification did not enter parent model request",
    );
    expect(notificationIndex).toBeGreaterThan(fourthQueuedIndex);
    await waitForV4AssistantMessageContaining("background-queue-drain-notification-consumed-ok");
    await waitForIdle("background queue drain session did not return to idle after notification");
    await assertNoVisibleTaskNotification();
  });

  it("Only child cleanup should be performed after background Bash inside background subagent completes", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const prompt =
      "E2E_BACKGROUND_NESTED_BASH: Launch a background agent that starts a background Bash command and then finishes.";
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await sendV4Prompt(prompt);
    await waitForV4ComposerText("", "nested background Bash input box was not cleared after prompt was sent");
    await waitForV4UserMessageContaining("E2E_BACKGROUND_NESTED_BASH");
    await waitForToolCallBlockByToolName("Agent", 60000);
    await respondToBackgroundBlockers();

    const launchIndex = await waitForFirstRequestIndex(
      {
        includes: ["E2E_BACKGROUND_NESTED_BASH", "Async agent launched successfully"],
      },
      requestCountBefore,
      "nested background Agent launch tool result did not enter parent model request",
    );
    const notificationIndex = await waitForFirstRequestIndex(
      {
        includes: ["<task-notification>", "E2E_BACKGROUND_NESTED_BASH_CHILD_DONE"],
      },
      launchIndex,
      "nested background Agent completion notification did not enter parent model request",
    );

    expect(notificationIndex).toBeGreaterThan(launchIndex);
    await waitForV4AssistantMessageContaining("background-nested-bash-notification-consumed-ok");
    await waitForIdle("nested background Agent session did not return to idle after notification");
    await browser.pause(2500);
    const unexpectedChildWakeCount = await countUpstreamRequests(
      {
        includes: ["toolu_e2e_background_nested_child_bash"],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      { afterIndex: launchIndex },
    );
    if (unexpectedChildWakeCount > 0) {
      throw new Error(
        "sealed child runtime should not be re-invoked by nested background Bash completion; " +
          `count=${unexpectedChildWakeCount}`,
      );
    }
    expect(unexpectedChildWakeCount).toBe(0);
    expect(
      await countUpstreamRequests(
        {
          includes: ["<task-notification>", "E2E_BACKGROUND_NESTED_BASH_CHILD_DONE"],
          lastUserMessageIncludes: ["<task-notification>"],
        },
        { afterIndex: requestCountBefore },
      ),
    ).toBe(1);
    await assertNoVisibleTaskNotification();
  });

  it("partial runtime snapshot should not clear missing running background control row", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await sendV4Prompt(
      "E2E_BACKGROUND_SNAPSHOT_CONTROL: Start two background Bash tasks. One should finish first while the other keeps running.",
    );
    await waitForV4ComposerText("", "BG23 input box was not cleared after prompt was sent");
    await waitForV4UserMessageContaining("E2E_BACKGROUND_SNAPSHOT_CONTROL");
    await waitForToolCallBlockByToolCallId("toolu_e2e_bg23_bash_one", 60000);
    await waitForToolCallBlockByToolCallId("toolu_e2e_bg23_bash_two", 60000);
    await respondToBackgroundBlockers();
    await respondToBackgroundBlockers();

    const launchIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_SNAPSHOT_CONTROL",
          "toolu_e2e_bg23_bash_one",
          "toolu_e2e_bg23_bash_two",
          "Command running in background",
        ],
      },
      requestCountBefore,
      "BG23 both background Bash launch results did not enter parent model request",
    );
    await waitForV4AssistantMessageContaining("background-snapshot-control-ready-ok");
    await waitForIdle("BG23 session did not return to idle after setup prompt");
    await waitForBackgroundTaskControlRow(
      "bash",
      "E2E BG23 bash one",
      "BG23 initial first Bash background control row was not displayed in top-right panel",
    );
    await waitForBackgroundTaskControlRow(
      "bash",
      "E2E BG23 bash two",
      "BG23 initial second Bash background control row was not displayed in top-right panel",
    );

    const firstNotificationIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_SNAPSHOT_CONTROL",
          "<task-notification>",
          "<tool-use-id>toolu_e2e_bg23_bash_one</tool-use-id>",
          "<status>completed</status>",
        ],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      launchIndex,
      "BG23 first background Bash completion notification did not enter parent model request",
    );
    expect(firstNotificationIndex).toBeGreaterThan(launchIndex);
    await waitForV4AssistantMessageContaining("background-snapshot-control-first-notification-ok");
    await waitForIdle("BG23 session did not return to idle after first background Bash notification");
    await waitForNoBackgroundTaskControlRow(
      "bash",
      "E2E BG23 bash one",
      "BG23 第一个 terminal Bash row 没有从右上角面板消失",
    );
    await waitForBackgroundTaskControlRow(
      "bash",
      "E2E BG23 bash two",
      "BG23 second running Bash row was mistakenly cleared after first Bash completed",
    );

    await clickStopBackgroundTaskControlRow("bash", "E2E BG23 bash two");
    const stopNotificationIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_SNAPSHOT_CONTROL",
          "<task-notification>",
          "<tool-use-id>toolu_e2e_bg23_bash_two</tool-use-id>",
          "<status>killed</status>",
        ],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      firstNotificationIndex,
      "BG23 second background Bash stop notification did not enter parent model request",
    );
    expect(stopNotificationIndex).toBeGreaterThan(firstNotificationIndex);
    await waitForV4AssistantMessageContaining("background-snapshot-control-second-stopped-ok");
    await waitForIdle("BG23 session did not return to idle after second background Bash stop notification");
    await waitForNoBackgroundTaskControlRow(
      "bash",
      "E2E BG23 bash two",
      "BG23 第二个 Bash stop 后 row 没有从右上角面板消失",
    );
  });

  it("Other Agent control rows that are still running should not be cleared during background Agent notification handling", async function () {
    this.timeout(BACKGROUND_E2E_TIMEOUT_MS);

    await startNewBackgroundDraft();
    const requestCountBefore = await getUpstreamRequestRecordCount();
    await sendV4Prompt(
      "E2E_BACKGROUND_AGENT_CONTROL_PRESERVE: Start one long cc background agent and three cf background agents. The three cf agents should finish before the cc agent.",
    );
    await waitForV4ComposerText("", "BG24 input box was not cleared after prompt was sent");
    await waitForV4UserMessageContaining("E2E_BACKGROUND_AGENT_CONTROL_PRESERVE");
    await waitForToolCallBlockByToolCallId("toolu_e2e_bg24_cc_agent", 60000);
    await waitForToolCallBlockByToolCallId("toolu_e2e_bg24_cf_one_agent", 60000);
    await waitForToolCallBlockByToolCallId("toolu_e2e_bg24_cf_two_agent", 60000);
    await waitForToolCallBlockByToolCallId("toolu_e2e_bg24_cf_three_agent", 60000);
    await respondToBackgroundBlockers();

    const launchIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_AGENT_CONTROL_PRESERVE",
          "toolu_e2e_bg24_cc_agent",
          "toolu_e2e_bg24_cf_one_agent",
          "toolu_e2e_bg24_cf_two_agent",
          "toolu_e2e_bg24_cf_three_agent",
          "Async agent launched successfully",
        ],
      },
      requestCountBefore,
      "BG24 four background Agent launch results were not included in parent model request",
    );
    await waitForV4AssistantMessageContaining("background-agent-control-preserve-ready-ok");
    const sourceSnapshot = await waitForIdle("BG24 session did not return to idle after setup prompt");
    const sourceTaskId = sourceSnapshot.taskId;
    if (!sourceTaskId) {
      throw new Error(`BG24 setup 后Missing source taskId: ${JSON.stringify(sourceSnapshot)}`);
    }
    await waitForBackgroundTaskControlRow(
      "agent",
      "E2E BG24 cc keepalive agent",
      "BG24 initial cc Agent background control row not displayed in top-right panel",
    );
    await waitForBackgroundTaskControlRow(
      "agent",
      "E2E BG24 cf three agent",
      "BG24 initial third cf Agent background control row not displayed in top-right panel",
    );

    const cfOneNotificationIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_AGENT_CONTROL_PRESERVE",
          "<task-notification>",
          "<tool-use-id>toolu_e2e_bg24_cf_one_agent</tool-use-id>",
          "<status>completed</status>",
          "E2E_BG24_CF_ONE_CHILD_DONE",
        ],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      launchIndex,
      "BG24 first cf background Agent completion notification was not included in parent model request",
    );
    expect(cfOneNotificationIndex).toBeGreaterThan(launchIndex);
    await waitForV4AssistantMessageContaining(
      "background-agent-control-preserve-cf-one-notification-ok",
    );
    await waitForBackgroundTaskControlRow(
      "agent",
      "E2E BG24 cc keepalive agent",
      "BG24 cc running Agent row was incorrectly cleared after first cf Agent completed",
    );
    await startBackgroundTaskControlPresenceProbe(
      "agent",
      "E2E BG24 cc keepalive agent",
      sourceTaskId,
    );
    const cfTwoNotificationIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_AGENT_CONTROL_PRESERVE",
          "<task-notification>",
          "<tool-use-id>toolu_e2e_bg24_cf_two_agent</tool-use-id>",
          "<status>completed</status>",
          "E2E_BG24_CF_TWO_CHILD_DONE",
        ],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      cfOneNotificationIndex,
      "BG24 second cf background Agent completion notification was not included in parent model request",
    );
    expect(cfTwoNotificationIndex).toBeGreaterThan(cfOneNotificationIndex);

    await startNewBackgroundDraft();
    await waitForV4ConversationState(
      (snapshot) => snapshot.taskId === null && snapshot.sessionId === null,
      "BG24 did not switch to new draft task while processing second notification",
      30000,
    );
    await selectV4TaskById(sourceTaskId);
    await waitForV4ConversationState(
      (snapshot) => snapshot.taskId === sourceTaskId,
      "BG24 chat root was not restored after switching back to original task while processing second notification",
      30000,
    );
    await waitForBackgroundTaskControlRow(
      "agent",
      "E2E BG24 cc keepalive agent",
      "BG24 cc running Agent row was not restored after switching back to original task while processing second notification",
    );
    await waitForV4AssistantMessageContaining(
      "background-agent-control-preserve-cf-two-notification-ok",
    );
    await waitForBackgroundTaskControlRow(
      "agent",
      "E2E BG24 cc keepalive agent",
      "BG24 cc running Agent row was incorrectly cleared after second cf Agent completed",
    );

    const cfNotificationIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_AGENT_CONTROL_PRESERVE",
          "<task-notification>",
          "<tool-use-id>toolu_e2e_bg24_cf_three_agent</tool-use-id>",
          "<status>completed</status>",
          "E2E_BG24_CF_THREE_CHILD_DONE",
        ],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      cfTwoNotificationIndex,
      "BG24 third cf background Agent completion notification was not included in parent model request",
    );
    expect(cfNotificationIndex).toBeGreaterThan(cfTwoNotificationIndex);
    const afterTodoIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_AGENT_CONTROL_PRESERVE",
          "toolu_e2e_bg24_todo_write",
          "E2E_BG24_TODO_UPDATED",
        ],
      },
      cfNotificationIndex,
      "BG24 TodoWrite tool result in cf notification was not included in subsequent parent model requests",
    );
    expect(afterTodoIndex).toBeGreaterThan(cfNotificationIndex);
    await waitForV4AssistantMessageContaining(
      "background-agent-control-preserve-cf-notification-ok",
    );
    await waitForIdle("BG24 session did not return to idle after cf Agent notification");
    const presenceProbe = await stopBackgroundTaskControlPresenceProbe();
    expect(presenceProbe.observedPresent).toBe(true);
    expect(presenceProbe.missingTransitions).toEqual([]);
    await waitForNoBackgroundTaskControlRow(
      "agent",
      "E2E BG24 cf three agent",
      "BG24 已完成的第三个 cf Agent row 没有从右上角面板消失",
    );
    await waitForBackgroundTaskControlRow(
      "agent",
      "E2E BG24 cc keepalive agent",
      "BG24 cc running Agent row was incorrectly cleared after cf Agent completed",
    );

    await clickStopBackgroundTaskControlRow("agent", "E2E BG24 cc keepalive agent");
    const stopNotificationIndex = await waitForFirstRequestIndex(
      {
        includes: [
          "E2E_BACKGROUND_AGENT_CONTROL_PRESERVE",
          "<task-notification>",
          "<tool-use-id>toolu_e2e_bg24_cc_agent</tool-use-id>",
          "<status>stopped</status>",
        ],
        lastUserMessageIncludes: ["<task-notification>"],
      },
      cfNotificationIndex,
      "BG24 cc background Agent stop notification was not included in parent model request",
    );
    expect(stopNotificationIndex).toBeGreaterThan(cfNotificationIndex);
    await waitForV4AssistantMessageContaining("background-agent-control-preserve-cc-stopped-ok");
    await waitForIdle("BG24 session did not return to idle after cc Agent stop notification");
    await waitForNoBackgroundTaskControlRow(
      "agent",
      "E2E BG24 cc keepalive agent",
      "BG24 stop 后 cc Agent row 没有从右上角面板消失",
    );
  });
});

async function waitForFirstRequestIndex(
  query: Parameters<typeof waitForUpstreamRequest>[0],
  afterIndex: number,
  timeoutMsg: string,
) {
  await waitForUpstreamRequest(query, timeoutMsg, 45000, { afterIndex });
  const index = await findFirstUpstreamRequestIndex(query, { afterIndex });
  if (index === null) {
    throw new Error(`${timeoutMsg}; request disappeared after wait`);
  }
  if (
    query.includes?.includes("<task-notification>") ||
    query.lastUserMessageIncludes?.includes("<task-notification>")
  ) {
    const records = await getUpstreamRequestEvidence(query, {
      afterIndex: index - 1,
      beforeIndex: index + 1,
    });
    await assertTaskNotificationContents(records[0]!.requestJson, `background-request-${index}`);
  }
  return index;
}

async function waitForRunningPidFile(path: string, label: string): Promise<number> {
  let recordedPid: number | null = null;
  await browser.waitUntil(
    async () => {
      recordedPid = await readRecordedPid(path);
      return recordedPid !== null && isProcessAlive(recordedPid);
    },
    {
      timeout: 30000,
      timeoutMsg: `${label} 没有Write fresh PID marker or进程未保持Run`,
    },
  );
  return recordedPid!;
}

async function readRecordedPid(path: string): Promise<number | null> {
  const raw = await readFile(path, "utf-8").catch(() => "");
  const pid = Number(raw.trim());
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readPosixProcessGroupId(pid: number): Promise<number> {
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile("ps", ["-o", "pgid=", "-p", String(pid)], (error, output) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(output);
    });
  });
  const processGroupId = Number(stdout.trim());
  if (!Number.isInteger(processGroupId) || processGroupId <= 1) {
    throw new Error(`无法Read PID ${pid} 的 POSIX PGID: ${JSON.stringify(stdout)}`);
  }
  return processGroupId;
}

async function waitForProcessExit(pid: number, label: string): Promise<void> {
  await browser.waitUntil(() => !isProcessAlive(pid), {
    timeout: 15000,
    timeoutMsg: `${label} PID ${pid} 在 background stop 收口后仍存活`,
  });
}

async function cleanupBg08ProcessTree(): Promise<void> {
  const processFiles = [BG08_WORKER_PID_FILE, BG08_LAUNCHER_PID_FILE];
  if (process.platform !== "win32") {
    processFiles.push(BG08_ROOT_PID_FILE);
  }
  for (const path of processFiles) {
    const pid = await readRecordedPid(path);
    if (pid === null || !isProcessAlive(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
    }
  }
}

async function removeBg08PidFiles(): Promise<void> {
  await Promise.all(
    [BG08_ROOT_PID_FILE, BG08_LAUNCHER_PID_FILE, BG08_WORKER_PID_FILE].map((path) =>
      rm(path, { force: true }).catch(() => undefined),
    ),
  );
}

async function waitForVisibleUserMessagesContainingAll(
  markers: readonly string[],
  timeoutMsg: string,
) {
  let latestMessages: Awaited<ReturnType<typeof getV4Messages>> = [];
  await browser.waitUntil(
    async () => {
      latestMessages = await getV4Messages("user");
      return markers.every((marker) =>
        latestMessages.some((message) => message.text.includes(marker)),
      );
    },
    {
      timeout: 60000,
      timeoutMsg: `${timeoutMsg}; visibleUserMessages=${JSON.stringify(
        latestMessages.map((message) => ({
          id: message.id,
          text: message.text.slice(0, 200),
        })),
      )}`,
    },
  );
}

type VisibleUserMessageSample = {
  at: number;
  messages: Array<{
    id: string | null;
    text: string;
  }>;
};

async function startVisibleUserMessageSampler() {
  await browser.execute(
    (messagesTestId: string, userMessagePrefix: string) => {
      type SamplerState = {
        intervalId: ReturnType<typeof setInterval>;
        samples: VisibleUserMessageSample[];
      };
      const sampleWindow = window as typeof window & {
        __cfBg17UserMessageSampler?: SamplerState;
      };
      if (sampleWindow.__cfBg17UserMessageSampler) {
        clearInterval(sampleWindow.__cfBg17UserMessageSampler.intervalId);
      }
      const collect = () => {
        const root = document.querySelector<HTMLElement>(`[data-testid="${messagesTestId}"]`);
        const messages = Array.from(
          root?.querySelectorAll<HTMLElement>(`[data-testid^="${userMessagePrefix}-"]`) ?? [],
        ).map((element) => ({
          id: element.getAttribute("data-message-id"),
          text: element.innerText.replace(/\u00a0/g, " ").trim(),
        }));
        sampleWindow.__cfBg17UserMessageSampler?.samples.push({
          at: Date.now(),
          messages,
        });
      };
      sampleWindow.__cfBg17UserMessageSampler = {
        intervalId: setInterval(collect, 50),
        samples: [],
      };
      collect();
    },
    TID_CHAT_MESSAGES,
    TID_CHAT_USER_MESSAGE,
  );
}

async function stopVisibleUserMessageSampler() {
  return await browser.execute(() => {
    const sampleWindow = window as typeof window & {
      __cfBg17UserMessageSampler?: {
        intervalId: ReturnType<typeof setInterval>;
        samples: VisibleUserMessageSample[];
      };
    };
    const sampler = sampleWindow.__cfBg17UserMessageSampler;
    if (!sampler) {
      return [] satisfies VisibleUserMessageSample[];
    }
    clearInterval(sampler.intervalId);
    delete sampleWindow.__cfBg17UserMessageSampler;
    return sampler.samples;
  });
}

function assertVisibleUserMessageMarkersNeverDisappear(
  samples: readonly VisibleUserMessageSample[],
  markers: readonly string[],
) {
  const seen = new Set<string>();
  const violations: Array<{
    marker: string;
    sampleIndex: number;
    at: number;
    messages: VisibleUserMessageSample["messages"];
  }> = [];
  for (const [sampleIndex, sample] of samples.entries()) {
    const presentMarkers = new Set(
      markers.filter((marker) => sample.messages.some((message) => message.text.includes(marker))),
    );
    for (const marker of presentMarkers) {
      seen.add(marker);
    }
    for (const marker of seen) {
      if (!presentMarkers.has(marker)) {
        violations.push({
          marker,
          sampleIndex,
          at: sample.at,
          messages: sample.messages,
        });
      }
    }
  }

  expect(violations).toEqual([]);
}

async function waitForIdle(timeoutMsg: string) {
  return waitForV4ConversationState(
    (snapshot) => snapshot.state !== "streaming" && !snapshot.stopRequested,
    timeoutMsg,
    90000,
  );
}

async function assertNoVisibleTaskNotification() {
  await assertVisibleV4UserMessagesNotContaining("<task-notification>");
  await assertVisibleV4UserMessagesNotContaining("E2E_BACKGROUND_AGENT_CHILD_RESULT");
  await assertVisibleV4UserMessagesNotContaining("E2E_BACKGROUND_GOAL_CHILD_RESULT");
  await assertVisibleV4UserMessagesNotContaining("E2E_BACKGROUND_SEND_MESSAGE_CHILD_RECEIVED");
  await assertVisibleV4UserMessagesNotContaining("E2E_BACKGROUND_AGENT_CHILD_TOOL_IDLE_DONE");
  await assertVisibleV4UserMessagesNotContaining("E2E_BACKGROUND_COMPACT_AFTER_IDLE_DONE");
  await assertVisibleV4UserMessagesNotContaining(
    "E2E_BACKGROUND_QUEUE_DRAIN_AFTER_MAIN_END_CHILD_DONE",
  );
  await assertVisibleV4UserMessagesNotContaining("E2E_BACKGROUND_NESTED_BASH_CHILD_DONE");
}

async function assertNoMainFakeLoading(timeoutMsg: string) {
  await browser.pause(600);
  const [snapshot, loadingTexts] = await Promise.all([
    getV4ConversationState(),
    getVisibleChatLoadingTexts(),
  ]);
  if (snapshot.state === "streaming" || loadingTexts.length > 0) {
    throw new Error(
      `${timeoutMsg}; state=${JSON.stringify(snapshot)}; loading=${JSON.stringify(loadingTexts)}`,
    );
  }
}

async function waitForMainLoading(timeoutMsg: string) {
  let latestSnapshot = await getV4ConversationState();
  let latestLoadingTexts: string[] = [];
  await browser.waitUntil(
    async () => {
      latestSnapshot = await getV4ConversationState();
      latestLoadingTexts = await getVisibleChatLoadingTexts();
      return latestSnapshot.state === "streaming";
    },
    {
      interval: 100,
      timeout: 5000,
      timeoutMsg: `${timeoutMsg}; latest=${JSON.stringify(
        latestSnapshot,
      )}; loading=${JSON.stringify(latestLoadingTexts)}`,
    },
  );
}

async function getVisibleChatLoadingTexts(): Promise<string[]> {
  return browser.execute((chatLoadingTestId) => {
    const isElementVisible = (element: HTMLElement) =>
      element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    return Array.from(
      document.querySelectorAll<HTMLElement>(`[data-testid="${chatLoadingTestId}"]`),
    )
      .filter(isElementVisible)
      .map((element) => element.innerText.replace(/\u00a0/g, " ").trim());
  }, TID_CHAT_LOADING);
}

async function assertNoMainToolCallById(toolCallId: string, failureMessage: string) {
  const blocks = await listToolCallBlocks();
  const mirrored = blocks.filter((block) => block.toolCallId?.includes(toolCallId));
  if (mirrored.length > 0) {
    throw new Error(`${failureMessage}; mirrored=${JSON.stringify(mirrored)}`);
  }
}

async function beginBackgroundTelemetryCapture() {
  const capture = await beginConversationTelemetryCapture();
  await capture.telemetryFetch.mockClear();
  return capture;
}

async function startNewBackgroundDraft() {
  await prepareV4ConversationE2E({ skipProvider: true });
  await ensureToolCrossProductFullAccessMode();
}

async function respondToBackgroundBlockers() {
  await respondToToolCrossProductBlockers();
}

type BackgroundTaskControlKind = "agent" | "bash";

interface BackgroundTaskControlRowSnapshot {
  buttonDisabled: boolean;
  kind: string | null;
  text: string;
  visible: boolean;
}

interface BackgroundTaskProjectionSnapshot {
  projectionSeq: string | null;
  runningSubagentIds: string | null;
  runningSubagentWorkIds: string | null;
  sessionId: string | null;
}

async function waitForBackgroundTaskControlRow(
  kind: BackgroundTaskControlKind,
  textIncludes: string,
  timeoutMsg: string,
) {
  let latest: BackgroundTaskControlRowSnapshot[] = [];
  let projection: BackgroundTaskProjectionSnapshot | null = null;
  await browser.waitUntil(
    async () => {
      try {
        await openV4ComposerRunningBackgroundWorks();
      } catch (error) {
        projection = await getBackgroundTaskProjectionSnapshot();
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}; projection=${JSON.stringify(projection)}`,
          { cause: error },
        );
      }
      latest = await getBackgroundTaskControlRows({ visibleOnly: false });
      return latest.some(
        (row) => row.visible && row.kind === kind && row.text.includes(textIncludes),
      );
    },
    {
      interval: 250,
      timeout: 30000,
      timeoutMsg: `${timeoutMsg}; latest=${JSON.stringify(latest)}; projection=${JSON.stringify(projection)}`,
    },
  );
}

async function getBackgroundTaskProjectionSnapshot(): Promise<BackgroundTaskProjectionSnapshot> {
  return browser.execute(
    (paneTestId) => {
      const pane = document.querySelector<HTMLElement>(`[data-testid="${paneTestId}"]`);
      return {
        projectionSeq: pane?.getAttribute("data-projection-seq") ?? null,
        runningSubagentIds: pane?.getAttribute("data-running-subagent-ids") ?? null,
        runningSubagentWorkIds: pane?.getAttribute("data-running-subagent-work-ids") ?? null,
        sessionId: pane?.getAttribute("data-session-id") ?? null,
      };
    },
    testId(TID_V4_SESSION_PANE, V4_MAIN_PANE_ID),
  );
}

async function waitForNoBackgroundTaskControlRow(
  kind: BackgroundTaskControlKind,
  textIncludes: string,
  timeoutMsg: string,
) {
  let latest: BackgroundTaskControlRowSnapshot[] = [];
  await browser.waitUntil(
    async () => {
      latest = await getBackgroundTaskControlRows({ visibleOnly: false });
      return !latest.some((row) => row.kind === kind && row.text.includes(textIncludes));
    },
    {
      interval: 250,
      timeout: 30000,
      timeoutMsg: `${timeoutMsg}; latest=${JSON.stringify(latest)}`,
    },
  );
}

interface BackgroundTaskControlPresenceProbeResult {
  missingTransitions: Array<{
    atMs: number;
    panelState: string | null;
    rows: string[];
    storeJobs: string[];
  }>;
  observedPresent: boolean;
}

async function startBackgroundTaskControlPresenceProbe(
  kind: BackgroundTaskControlKind,
  textIncludes: string,
  taskId: string,
) {
  await openV4ComposerRunningBackgroundWorks();
  await browser.execute(
    (expectedKind, expectedText, expectedTaskId, v4SessionPanePrefix) => {
      const probeKey = "__cfBackgroundTaskControlPresenceProbe";
      const probeWindow = window as typeof window & {
        __cfBackgroundTaskControlPresenceProbe?: {
          intervalId: number;
          missingTransitions: Array<{
            atMs: number;
            panelState: string | null;
            rows: string[];
            storeJobs: string[];
          }>;
          hasLeftTask: boolean;
          hasReturnedToTask: boolean;
          observedPresent: boolean;
          startedAt: number;
          wasPresent: boolean | null;
        };
      };
      const existing = probeWindow[probeKey];
      if (existing) {
        window.clearInterval(existing.intervalId);
      }
      const state: NonNullable<(typeof probeWindow)[typeof probeKey]> = {
        intervalId: 0,
        missingTransitions: [],
        hasLeftTask: false,
        hasReturnedToTask: false,
        observedPresent: false,
        startedAt: performance.now(),
        wasPresent: null,
      };
      const isElementVisible = (element: HTMLElement) =>
        element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      const sample = () => {
        const legacyTaskId = document
          .querySelector<HTMLElement>('[data-testid="chat-view"]')
          ?.getAttribute("data-task-id");
        const v4SessionId = document
          .querySelector<HTMLElement>(`[data-testid="${v4SessionPanePrefix}-workspace-main"]`)
          ?.getAttribute("data-session-id");
        const activeTaskId =
          legacyTaskId || (v4SessionId && v4SessionId !== "draft" ? v4SessionId : null);
        if (activeTaskId !== expectedTaskId) {
          state.hasLeftTask = true;
          state.wasPresent = null;
          return;
        }
        if (state.hasLeftTask) {
          state.hasReturnedToTask = true;
        }
        const rows = Array.from(
          document.querySelectorAll<HTMLElement>("[data-background-task-kind]"),
        );
        const present = rows.some(
          (row) =>
            row.getAttribute("data-background-task-kind") === expectedKind &&
            row.innerText.includes(expectedText) &&
            isElementVisible(row),
        );
        state.observedPresent ||= present;
        if (state.hasReturnedToTask && state.wasPresent === true && !present) {
          const store = (
            window as typeof window & {
              __cfSessionStoreE2E?: {
                getState: () => {
                  workspaces: Record<
                    string,
                    {
                      taskRuntimeByTaskId?: Record<
                        string,
                        {
                          backgroundTaskControls?: Array<{
                            jobId: string;
                            status: string;
                            title?: string;
                          }>;
                        }
                      >;
                    }
                  >;
                };
              };
            }
          ).__cfSessionStoreE2E;
          const taskRuntime = Object.values(store?.getState().workspaces ?? {})
            .map((workspace) => workspace.taskRuntimeByTaskId?.[expectedTaskId])
            .find(Boolean);
          state.missingTransitions.push({
            atMs: Math.round(performance.now() - state.startedAt),
            panelState:
              document
                .querySelector<HTMLElement>('[data-testid="chat-summary-panel"]')
                ?.getAttribute("data-state") ?? null,
            rows: rows.map((row) => row.innerText.replace(/\u00a0/g, " ").trim()),
            storeJobs: (taskRuntime?.backgroundTaskControls ?? []).map(
              (job) => `${job.jobId}:${job.status}:${job.title ?? ""}`,
            ),
          });
        }
        state.wasPresent = present;
      };
      sample();
      state.intervalId = window.setInterval(sample, 16);
      probeWindow[probeKey] = state;
    },
    kind,
    textIncludes,
    taskId,
    TID_V4_SESSION_PANE,
  );
}

async function stopBackgroundTaskControlPresenceProbe(): Promise<BackgroundTaskControlPresenceProbeResult> {
  return browser.execute(() => {
    const probeKey = "__cfBackgroundTaskControlPresenceProbe";
    const probeWindow = window as typeof window & {
      __cfBackgroundTaskControlPresenceProbe?: {
        intervalId: number;
        missingTransitions: BackgroundTaskControlPresenceProbeResult["missingTransitions"];
        observedPresent: boolean;
      };
    };
    const state = probeWindow[probeKey];
    if (!state) {
      return { missingTransitions: [], observedPresent: false };
    }
    window.clearInterval(state.intervalId);
    delete probeWindow[probeKey];
    return {
      missingTransitions: state.missingTransitions,
      observedPresent: state.observedPresent,
    };
  });
}

async function clickStopBackgroundTaskControlRow(
  kind: BackgroundTaskControlKind,
  textIncludes: string,
) {
  let latest:
    | { clicked: true; rows: [] }
    | { clicked: false; rows: BackgroundTaskControlRowSnapshot[] } = {
    clicked: false,
    rows: [],
  };
  await browser.waitUntil(
    async () => {
      await openV4ComposerRunningBackgroundWorks();
      latest = await browser.execute(
        (expectedKind, expectedText, cancelButtonPrefix) => {
          const isElementVisible = (element: HTMLElement) =>
            element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
          const rows = Array.from(
            document.querySelectorAll<HTMLElement>("[data-background-task-kind]"),
          );
          const row = rows.find(
            (candidate) =>
              isElementVisible(candidate) &&
              candidate.getAttribute("data-background-task-kind") === expectedKind &&
              candidate.innerText.includes(expectedText),
          );
          const button = row?.querySelector<HTMLButtonElement>(
            `[data-testid^="${cancelButtonPrefix}-"]`,
          );
          if (!row || !button || button.disabled || !isElementVisible(button)) {
            return {
              clicked: false,
              rows: rows.map((candidate) => ({
                buttonDisabled:
                  candidate.querySelector<HTMLButtonElement>("button")?.disabled ?? false,
                kind: candidate.getAttribute("data-background-task-kind"),
                text: candidate.innerText.replace(/\u00a0/g, " ").trim(),
                visible: isElementVisible(candidate),
              })),
            };
          }
          button.click();
          return { clicked: true, rows: [] };
        },
        kind,
        textIncludes,
        TID_V4_BACKGROUND_WORK_CANCEL,
      );
      return latest.clicked;
    },
    {
      interval: 250,
      timeout: 30000,
      timeoutMsg: `没有点击到 background control stop button: ${JSON.stringify(latest)}`,
    },
  );
}

async function getBackgroundTaskControlRows({
  visibleOnly,
}: {
  visibleOnly: boolean;
}): Promise<BackgroundTaskControlRowSnapshot[]> {
  return browser.execute((filterVisible) => {
    const isElementVisible = (element: HTMLElement) =>
      element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    return Array.from(document.querySelectorAll<HTMLElement>("[data-background-task-kind]"))
      .map((row) => ({
        buttonDisabled: row.querySelector<HTMLButtonElement>("button")?.disabled ?? false,
        kind: row.getAttribute("data-background-task-kind"),
        text: row.innerText.replace(/\u00a0/g, " ").trim(),
        visible: isElementVisible(row),
      }))
      .filter((row) => !filterVisible || row.visible);
  }, visibleOnly);
}

async function stopIfBusy() {
  const snapshot = await getV4ConversationState().catch(() => null);
  if (snapshot?.state !== "streaming" || snapshot.stopRequested) {
    return;
  }
  await browser.keys(["Escape"]).catch(() => undefined);
  await waitForV4ConversationState(
    (candidate) => candidate.state !== "streaming" || candidate.stopRequested,
    "Current run was not stopped during background E2E teardown",
    30000,
  ).catch(() => undefined);
}

function assertBackgroundToolStepTelemetry(
  reports: ConversationTelemetryReport[],
  childToolCallId: string,
): void {
  const backgroundSteps = reports.filter(
    (report) =>
      report.element_name === "agent_step" &&
      (report.event_extra_detail as Record<string, unknown> | undefined)?.agent_role ===
        "background subagent",
  );
  expect(backgroundSteps).toHaveLength(2);

  const detail = backgroundSteps[0]?.event_extra_detail as Record<string, unknown> | undefined;
  expect(detail).toMatchObject({
    agent_role: "background subagent",
    step_type: "tool_call",
    status: "success",
    tool_name: "Bash",
    loop_index: "1",
    token_usage_scope: "",
    total_tokens: "0",
  });
  expect(typeof detail?.agent_id).toBe("string");
  expect(String(detail?.agent_id)).not.toHaveLength(0);
  expect(typeof detail?.model_name).toBe("string");
  expect(detail?.model_name).not.toBe("");
  expect(typeof detail?.model_provider).toBe("string");
  expect(detail?.model_provider).not.toBe("");
  expect(typeof detail?.provider_name).toBe("string");
  expect(detail?.provider_name).not.toBe("");
  expect(typeof backgroundSteps[0]?.message_id).toBe("string");
  expect(backgroundSteps[0]?.message_id).not.toBe("");
  expect(typeof backgroundSteps[0]?.talk_id).toBe("string");
  expect(backgroundSteps[0]?.talk_id).not.toBe("");
  expect(String(detail?.tool_call_id)).toBe(
    `tool_subagent_${String(detail?.agent_id)}_${childToolCallId}`,
  );
  const aggregate = backgroundSteps[1]!;
  const aggregateDetail = aggregate.event_extra_detail as Record<string, unknown>;
  expect(aggregateDetail).toMatchObject({
    agent_role: "background subagent",
    agent_id: detail?.agent_id,
    step_type: "tool_call",
    tool_name: "Agent",
    status: "success",
    loop_index: "2",
    token_usage_scope: "subagent_requests",
    model_request_count: "2",
    input_tokens: "256",
    output_tokens: "28",
    total_tokens: "284",
    model_name: detail?.model_name,
    model_provider: detail?.model_provider,
    provider_name: detail?.provider_name,
  });
  expect(aggregateDetail.tool_call_id).toBe(
    `tool_subagent_${String(detail?.agent_id)}_${String(aggregateDetail.parent_tool_call_id)}`,
  );
  const completions = reports.filter((report) => report.element_name === "message_completion");
  expect(aggregate.message_id).toBe(completions[0]?.message_id);
  expect(aggregate.message_id).toBe(backgroundSteps[0]?.message_id);
  expect(reports.indexOf(aggregate)).toBeGreaterThan(reports.indexOf(completions[0]!));
  for (const completion of completions) {
    expect(completion.message_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(
      reports.filter(
        (report) =>
          report.element_name === "agent_step" &&
          report.message_id === completion.message_id &&
          !(report.event_extra_detail as Record<string, unknown>)?.agent_role,
      ).length,
    ).toBeGreaterThan(0);
  }
  expect(
    reports.filter(
      (report) =>
        report.element_name === "message_completion" &&
        ["child_session_id", "parent_tool_call_id"].some((key) =>
          Object.hasOwn(
            (report.event_extra_detail as Record<string, unknown> | undefined) ?? {},
            key,
          ),
        ),
    ),
  ).toHaveLength(0);
}

function assertMainCompletionAgentCompositions(
  reports: ConversationTelemetryReport[],
  expectedCompositions: string[],
): void {
  const completions = reports.filter((report) => report.element_name === "message_completion");
  expect(completions).toHaveLength(expectedCompositions.length);
  expect(
    completions.map(
      (report) =>
        (report.event_extra_detail as Record<string, unknown> | undefined)?.agent_composition,
    ),
  ).toEqual(expectedCompositions);

  const messageIds = completions.map((report) => String(report.message_id ?? ""));
  expect(messageIds.every((messageId) => messageId.length > 0)).toBe(true);
  expect(new Set(messageIds).size).toBe(messageIds.length);
}

function assertMainCompletionMessageSources(
  reports: ConversationTelemetryReport[],
  expectedSources: string[],
): void {
  const completions = reports.filter((report) => report.element_name === "message_completion");
  expect(completions).toHaveLength(expectedSources.length);
  expect(
    completions.map(
      (report) =>
        (report.event_extra_detail as Record<string, unknown> | undefined)?.message_source,
    ),
  ).toEqual(expectedSources);
}
