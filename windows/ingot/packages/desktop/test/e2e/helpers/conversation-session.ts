
import {
  TID_CHAT_ASSISTANT_MESSAGE,
  TID_CHAT_INPUT,
  TID_CHAT_MESSAGES,
  TID_CHAT_SEND_BUTTON,
  TID_CHAT_SUMMARY_PANEL,
  TID_CHAT_STOP_BUTTON,
  TID_CHAT_USER_MESSAGE,
  TID_CHAT_VIEW,
  TID_LOGIN_API_KEY_CONTINUE_BUTTON,
  TID_LOGIN_API_KEY_INPUT,
  TID_LOGIN_USE_API_KEY_BUTTON,
  TID_TASK_ITEM,
  TID_TASK_NEW_BUTTON,
  TID_V4_COMPOSER_INPUT,
  TID_V4_COMPOSER_SEND,
  TID_V4_QUEUE_ITEM,
  TID_V4_SESSION_PANE,
  TID_V4_STOP,
  TID_V4_TIMELINE,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import AppPage from "../pages/app.page.js";
import {
  clickTestIdByDom,
  setInputValueByTestIdDom,
  waitForDefaultWorkspaceReady,
} from "./desktop-app.js";
import { ensureUpstreamProviderForE2E } from "./upstream-provider.js";
import { getQueueItems as readQueueItemsForDiagnostics } from "./conversation-session-queue.js";
import { getTaskStoreSnapshot as readTaskStoreSnapshotForDiagnostics } from "./conversation-session-store.js";
import { readV4ChatRootSnapshotInBrowser } from "./conversation-session-chat-root-snapshot-script.js";
import {
  E2E_READONLY_TOOL_FILE_CONTENT,
  E2E_READONLY_TOOL_FILE_PATH,
  buildReadonlyToolPrompt,
  ensureReadonlyToolFixtureFile,
} from "./conversation-session-readonly-tool.js";

type LexicalInputE2EBridge = {
  focus: () => void;
  getText: () => string;
  setText: (text: string) => void;
};

type LexicalInputE2EElement = HTMLElement & {
  __cfLexicalInputE2E?: LexicalInputE2EBridge;
};

export const E2E_REPLY_TOKEN = "upstream-e2e-ok";
export const LOGIN_API_KEY = "e2e-login-api-key";

export {
  E2E_READONLY_TOOL_FILE_CONTENT,
  E2E_READONLY_TOOL_FILE_PATH,
  buildReadonlyToolPrompt,
  ensureReadonlyToolFixtureFile,
};

export {
  getCompactMarkers,
  waitForCompactMarkerStatuses,
  waitForCompactMarkerStatus,
} from "./conversation-session-compact.js";
export type { CompactMarkerSnapshot } from "./conversation-session-compact.js";
export {
  setComposerPrefill,
  waitForVisibleAttachmentNames,
  writeComposerPrefillPngFixture,
  writeOversizedComposerPrefillPngFixture,
} from "./conversation-session-composer-prefill.js";
export type { ComposerPrefillExpectation } from "./conversation-session-composer-prefill.js";
export {
  clickForkButtonForAssistantContaining,
  getForkButtonForAssistantContaining,
  getForkButtonForUserContaining,
  waitForForkButtonForAssistantContaining,
} from "./conversation-session-fork.js";
export {
  clickEditButtonForUserContaining,
  editUserMessageContaining,
  getEditButtonForAssistantContaining,
  getEditButtonForUserContaining,
  setMessageEditInputText,
  waitForEditButtonForUserContaining,
} from "./conversation-session-edit.js";
export {
  countUpstreamRequests,
  countUpstreamRequestsContaining,
  countUpstreamRequestsContainingAll,
  countUpstreamTitleRequestsContaining,
  expectNoUpstreamRequestForTextWithin,
  findFirstUpstreamRequestIndex,
  findLastUpstreamRequestIndex,
  getUpstreamRequestRecordCount,
  waitForUpstreamRequest,
  waitForUpstreamRequestContaining,
} from "./conversation-session-network.js";
export type { UpstreamRequestQuery } from "./conversation-session-network.js";
export type { QueueItemSnapshot } from "./conversation-session-queue.js";
export {
  clickFirstQueueSendNow,
  clickQueueSendNow,
  clickQueueEdit,
  clickQueueEditSave,
  clickQueueRemove,
  dragQueueItemOnto,
  getQueueItems,
  setQueueEditInputText,
  waitForQueueContaining,
  waitForQueueCount,
  waitForQueueOrderContaining,
} from "./conversation-session-queue.js";
export {
  assertToolCallNotFailedByToolCallId,
  expandAssistantHistoriesWithContent,
  getToolCallBlockByToolCallId,
  getToolCallBlockByToolName,
  getToolCallBlockContaining,
  listToolCallBlocks,
  openAssistantHistoryForAssistantContaining,
  waitForSuccessfulToolCallByToolCallId,
  waitForToolCallBlockByToolCallId,
  waitForToolCallBlockByToolName,
  waitForToolCallBlockContaining,
} from "./conversation-session-tool.js";
export {
  getTaskStoreSnapshot,
  waitForTaskStoreSnapshot,
  type ConfigOptionSnapshot,
  type TaskStoreSnapshot,
} from "./conversation-session-store.js";
export {
  getToastMessages,
  waitForToastContaining,
} from "./conversation-session-toast.js";

export interface ChatRootSnapshot {
  activeInputId: string | null;
  queueCount: number;
  runtimeStatus: string | null;
  sessionId: string | null;
  state: string | null;
  modelSwitchPending: boolean;
  stopRequested: boolean;
  targetId: string | null;
  targetObjective: string | null;
  targetStatus: string | null;
  taskId: string | null;
}

export interface MessageSnapshot {
  id: string | null;
  role: string | null;
  text: string;
}

interface PrepareConversationE2EOptions {
  resetDraftBeforeProvider?: boolean;
  skipProvider?: boolean;
}

export async function prepareConversationE2E(
  options: PrepareConversationE2EOptions = {},
) {
  await ensureReadonlyToolFixtureFile();
  await ensureConversationShellReady();
  if (options.resetDraftBeforeProvider) {
    await startNewTask();
  }
  if (!options.skipProvider) {
    await ensureUpstreamProviderForE2E();
  }
  await ensureConversationDraftReady();
}

async function ensureConversationShellReady() {
  try {
    await waitForDefaultWorkspaceReady(30000);
    return;
  } catch (error) {
    if (!(await hasApiKeyLoginButton())) {
      throw error;
    }

    await loginWithApiKey();
    await waitForDefaultWorkspaceReady(30000);
  }
}

async function hasApiKeyLoginButton() {
  const exists = await browser
    .execute(
      (currentTestId) =>
        Boolean(document.querySelector(`[data-testid="${currentTestId}"]`)),
      TID_LOGIN_USE_API_KEY_BUTTON,
    )
    .catch(() => false);
  return Boolean(exists);
}

export async function loginWithApiKey() {
  await clickTestIdByDom(TID_LOGIN_USE_API_KEY_BUTTON, {
    timeout: 30000,
    timeoutMsg: "欢迎页没有出现 API Key 登录入口",
  });
  await setInputValueByTestIdDom(TID_LOGIN_API_KEY_INPUT, LOGIN_API_KEY, {
    timeout: 15000,
    timeoutMsg: "API Key 登录输入框没有出现",
  });
  await waitForApiKeyContinueEnabled();
  await clickTestIdByDom(TID_LOGIN_API_KEY_CONTINUE_BUTTON, {
    timeout: 15000,
    timeoutMsg: "API Key 登录继续按钮没有出现或不可点击",
  });
}

export async function startNewTask() {
  await clickTestIdByDom(TID_TASK_NEW_BUTTON, {
    timeout: 15000,
    timeoutMsg: "侧栏新任务按钮没有出现或不可点击",
  });
  await waitForConversationDraftReady("新建任务后没有进入空草稿态");
}

async function ensureConversationDraftReady() {
  const current = await inspectConversationComposer();
  if (current.displayed && current.draftReady) {
    return;
  }
  await startNewTask();
}

async function waitForConversationDraftReady(timeoutMsg: string) {
  try {
    await browser.waitUntil(
      async () => {
        const current = await inspectConversationComposer();
        return current.displayed && current.draftReady;
      },
      { timeout: 30000, timeoutMsg },
    );
  } catch (error) {
    const diagnostics = await collectConversationDraftDiagnostics();
    throw new Error(
      `${timeoutMsg}; diagnostics=${JSON.stringify(diagnostics)}`,
      {
        cause: error,
      },
    );
  }
}

function inspectConversationComposer(): Promise<{
  displayed: boolean;
  draftReady: boolean;
  inputTestId: string | null;
  variant: "legacy" | "v4" | null;
}> {
  return browser.execute(
    (v4InputTestId, legacyInputTestId, v4PaneTestId, legacyViewTestId) => {
      const isDisplayed = (element: Element | null) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const v4Input = document.querySelector(
        `[data-testid="${v4InputTestId}"]`,
      );
      if (isDisplayed(v4Input)) {
        const pane = document.querySelector<HTMLElement>(
          `[data-testid="${v4PaneTestId}"]`,
        );
        return {
          displayed: true,
          draftReady: pane?.getAttribute("data-session-id") === "draft",
          inputTestId: v4InputTestId,
          variant: "v4" as const,
        };
      }
      const legacyInput = document.querySelector(
        `[data-testid="${legacyInputTestId}"]`,
      );
      const root = document.querySelector<HTMLElement>(
        `[data-testid="${legacyViewTestId}"]`,
      );
      return {
        displayed: isDisplayed(legacyInput),
        draftReady:
          Boolean(root) &&
          !root?.getAttribute("data-task-id") &&
          !root?.getAttribute("data-session-id") &&
          root?.getAttribute("data-state") === "idle" &&
          root?.getAttribute("data-model-switch-pending") !== "true",
        inputTestId: isDisplayed(legacyInput) ? legacyInputTestId : null,
        variant: isDisplayed(legacyInput) ? ("legacy" as const) : null,
      };
    },
    TID_V4_COMPOSER_INPUT,
    TID_CHAT_INPUT,
    testId(TID_V4_SESSION_PANE, "workspace-main"),
    TID_CHAT_VIEW,
  );
}

async function collectConversationDraftDiagnostics() {
  const composer = await inspectConversationComposer().catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  const visibleTestIds = await browser.execute(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-testid]"))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      })
      .map((element) => element.getAttribute("data-testid"))
      .filter((value): value is string => Boolean(value))
      .slice(0, 80),
  );
  return { composer, visibleTestIds };
}

export async function selectTaskById(
  taskId: string,
  {
    timeout = 15000,
    timeoutMsg = `Tasklist没有可点击的 task: ${taskId}`,
  }: { timeout?: number; timeoutMsg?: string } = {},
) {
  await clickTestIdByDom(testId(TID_TASK_ITEM, taskId), {
    timeout,
    timeoutMsg,
  });
}

export async function sendPrompt(prompt: string) {
  await typeChatPrompt(prompt);
  await clickChatSend();
}

export async function typeChatPrompt(prompt: string) {
  const composer = await inspectConversationComposer();
  if (composer.variant === "v4") {
    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, prompt, {
      timeout: 15000,
      timeoutMsg: "v4 composer input box did not appear or is not editable",
    });
    return;
  }
  await AppPage.chatInput.waitForDisplayed({ timeout: 15000 });
  await AppPage.chatInput.click();
  const lexicalBridgeResult = await writePromptWithLexicalBridge(prompt);
  if (lexicalBridgeResult.ok) {
    return;
  }

  if (
    shouldTypePromptWithKeyboard(prompt) &&
    (await getComposerText()) === ""
  ) {
    await browser.keys(prompt);
    await browser.waitUntil(
      async () => (await getComposerText()) === prompt.trim(),
      {
        timeout: 10000,
        timeoutMsg: `聊天Input框没有Passed键盘Write prompt: ${prompt}`,
      },
    );
    return;
  }

  const result = (await browser.executeAsync(
    (inputTestId, text, bridgeReason, done) => {
      const input = document.querySelector<LexicalInputE2EElement>(
        `[data-testid="${inputTestId}"]`,
      );
      if (!input) {
        done({
          actual: "",
          inserted: false,
          ok: false,
          reason: "input-missing",
        });
        return;
      }

      input.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand("delete");

      let inserted = true;
      const lines = text.split("\n");
      for (const [lineIndex, line] of lines.entries()) {
        inserted = document.execCommand("insertText", false, line) && inserted;
        if (lineIndex < lines.length - 1) {
          inserted = document.execCommand("insertLineBreak") && inserted;
        }
      }

      requestAnimationFrame(() => {
        const actual = (input.innerText || input.textContent || "")
          .replace(/\u00a0/g, " ")
          .trim();
        done({
          actual,
          bridgeReason,
          inserted,
          ok: actual === text.trim(),
        });
      });
    },
    TID_CHAT_INPUT,
    prompt,
    lexicalBridgeResult.reason ?? "bridge-unavailable",
  )) as {
    actual: string;
    bridgeReason?: string;
    inserted: boolean;
    ok: boolean;
    reason?: string;
  };

  if (!result.ok) {
    throw new Error(`聊天Input框没有WriteComplete prompt: ${JSON.stringify(result)}`);
  }
}

function shouldTypePromptWithKeyboard(prompt: string) {
  return !prompt.includes("\n") && !isVisibleSlashCommandPrompt(prompt);
}

function isVisibleSlashCommandPrompt(prompt: string) {
  return /^\/(?:goal|target|compact|compress)(?:\s|$)/i.test(prompt.trim());
}

async function writePromptWithLexicalBridge(prompt: string): Promise<{
  actual?: string;
  ok: boolean;
  reason?: string;
}> {
  try {
    await browser.waitUntil(
      async () =>
        browser.execute((inputTestId) => {
          const input = document.querySelector<LexicalInputE2EElement>(
            `[data-testid="${inputTestId}"]`,
          );
          return Boolean(input?.__cfLexicalInputE2E);
        }, TID_CHAT_INPUT),
      {
        timeout: 5000,
        timeoutMsg: "聊天输入框 Lexical E2E bridge 没有就绪",
      },
    );
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const setResult = (await browser.execute(
    (inputTestId, text) => {
      try {
        const input = document.querySelector<LexicalInputE2EElement>(
          `[data-testid="${inputTestId}"]`,
        );
        const bridge = input?.__cfLexicalInputE2E;
        if (!bridge) {
          return { ok: false, reason: "bridge-missing" };
        }
        bridge.setText(text);
        bridge.focus();
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
    TID_CHAT_INPUT,
    prompt,
  )) as { ok: boolean; reason?: string };

  if (!setResult.ok) {
    return setResult;
  }

  let latest: {
    bridgeText?: string;
    domText?: string;
    ok: boolean;
    reason?: string;
  } = {
    ok: false,
  };
  try {
    await browser.waitUntil(
      async () => {
        latest = await readLexicalBridgePromptSnapshot();
        return latest.bridgeText === prompt.trim();
      },
      {
        timeout: 10000,
        timeoutMsg: `聊天Input框没有Passed Lexical bridge Write prompt: ${prompt}`,
      },
    );
  } catch (error) {
    throw new Error(
      `聊天Input框没有Passed Lexical bridge Write prompt: ${prompt}; latest=${JSON.stringify(
        latest,
      )}`,
      { cause: error },
    );
  }
  return { actual: latest.bridgeText, ok: true };
}

function readLexicalBridgePromptSnapshot(): Promise<{
  bridgeText?: string;
  domText?: string;
  ok: boolean;
  reason?: string;
}> {
  return browser.execute((inputTestId) => {
    try {
      const input = document.querySelector<LexicalInputE2EElement>(
        `[data-testid="${inputTestId}"]`,
      );
      const bridge = input?.__cfLexicalInputE2E;
      if (!bridge) {
        return { ok: false, reason: "bridge-missing" };
      }
      return {
        bridgeText: bridge.getText().trim(),
        domText: (input.innerText || input.textContent || "")
          .replace(/\u00a0/g, " ")
          .trim(),
        ok: true,
      };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }, TID_CHAT_INPUT);
}

export async function clickChatSend() {
  const sendButtonTestId = await resolveVisibleComposerControlTestId(
    TID_V4_COMPOSER_SEND,
    TID_CHAT_SEND_BUTTON,
  );
  await browser.waitUntil(
    async () =>
      browser.execute((sendButtonTestId) => {
        const button = document.querySelector<HTMLButtonElement>(
          `[data-testid="${sendButtonTestId}"]`,
        );
        return Boolean(button && !button.disabled);
      }, sendButtonTestId),
    {
      timeout: 30000,
      timeoutMsg: "聊天发送按钮没有变为可用",
    },
  );
  await clickTestIdByDom(sendButtonTestId, {
    timeout: 15000,
    timeoutMsg: "聊天发送按钮没有出现或不可点击",
  });
}

export async function clickChatStop() {
  const stopButtonTestId = await resolveVisibleComposerControlTestId(
    TID_V4_STOP,
    TID_CHAT_STOP_BUTTON,
  );
  await clickTestIdByDom(stopButtonTestId, {
    timeout: 30000,
    timeoutMsg: "聊天停止按钮没有出现或不可点击",
  });
}

export async function waitForComposerText(
  expected: string,
  timeoutMsg: string,
) {
  await browser.waitUntil(async () => (await getComposerText()) === expected, {
    timeout: 10000,
    timeoutMsg,
  });
}

export function getComposerText() {
  return browser.execute(
    (inputTestIds) => {
      const input = inputTestIds
        .map((inputTestId) =>
          document.querySelector<HTMLElement>(`[data-testid="${inputTestId}"]`),
        )
        .find(Boolean);
      return (input?.innerText || input?.textContent || "")
        .replace(/\u00a0/g, " ")
        .trim();
    },
    [TID_V4_COMPOSER_INPUT, TID_CHAT_INPUT],
  );
}

async function resolveVisibleComposerControlTestId(
  v4TestId: string,
  legacyTestId: string,
) {
  return browser.execute(
    (testIds) => {
      const visible = testIds.find((currentTestId) => {
        const element = document.querySelector<HTMLElement>(
          `[data-testid="${currentTestId}"]`,
        );
        if (!element) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      });
      return visible ?? testIds[0]!;
    },
    [v4TestId, legacyTestId],
  );
}

export async function waitForChatState(
  predicate: (snapshot: ChatRootSnapshot) => boolean,
  timeoutMsg: string,
  timeout = 30000,
) {
  let latest: ChatRootSnapshot | null = null;
  try {
    await browser.waitUntil(
      async () => {
        latest = await getChatRootSnapshot();
        return predicate(latest);
      },
      {
        timeout,
        timeoutMsg,
      },
    );
  } catch (error) {
    latest = await getChatRootSnapshot();
    throw new Error(`${timeoutMsg}; latest=${JSON.stringify(latest)}`, {
      cause: error,
    });
  }
  return getChatRootSnapshot();
}

export async function getChatRootSnapshot(): Promise<ChatRootSnapshot> {
  const legacySnapshot = await browser.execute((chatViewTestId) => {
    const root = document.querySelector<HTMLElement>(
      `[data-testid="${chatViewTestId}"]`,
    );
    if (!root) {
      return null;
    }
    const rawQueueCount = root.getAttribute("data-queue-count");
    return {
      activeInputId: root.getAttribute("data-active-input-id") || null,
      queueCount: rawQueueCount ? Number(rawQueueCount) : 0,
      runtimeStatus: root.getAttribute("data-runtime-status") || null,
      sessionId: root.getAttribute("data-session-id") || null,
      state: root.getAttribute("data-state") || null,
      modelSwitchPending:
        root.getAttribute("data-model-switch-pending") === "true",
      stopRequested: root.getAttribute("data-stop-requested") === "true",
      targetId: root.getAttribute("data-target-id") || null,
      targetObjective: root.getAttribute("data-target-objective") || null,
      targetStatus: root.getAttribute("data-target-status") || null,
      taskId: root.getAttribute("data-task-id") || null,
    } satisfies ChatRootSnapshot;
  }, TID_CHAT_VIEW);

  if (legacySnapshot) {
    return legacySnapshot;
  }

  const v4Snapshot = await browser.execute(
    readV4ChatRootSnapshotInBrowser,
    testId(TID_V4_SESSION_PANE, "workspace-main"),
    TID_V4_QUEUE_ITEM,
    TID_V4_STOP,
  );
  if (v4Snapshot.bridgeError) {
    throw new Error(
      `无法Read V4 conversation workspace: ${v4Snapshot.bridgeError}; ` +
        `workspaceKey=${v4Snapshot.workspaceKey}; paneSessionId=${v4Snapshot.paneSessionId}`,
    );
  }

  if (!v4Snapshot.taskId) {
    return {
      activeInputId: null,
      queueCount: v4Snapshot.queueCount,
      runtimeStatus: v4Snapshot.runtimeStatus,
      sessionId: null,
      state: v4Snapshot.runtimeStatus === "streaming" ? "streaming" : "idle",
      modelSwitchPending: v4Snapshot.modelSwitchPending,
      stopRequested: false,
      targetId: null,
      targetObjective: null,
      targetStatus: null,
      taskId: null,
    };
  }

  const taskStore = await readTaskStoreSnapshotForDiagnostics(
    v4Snapshot.taskId,
    v4Snapshot.workspaceKey ?? undefined,
  );
  if (!taskStore.workspaceKey) {
    throw new Error(
      `无法Read V4 conversation task: ${taskStore.error}; ` +
        `workspaceKey=${v4Snapshot.workspaceKey}; taskId=${v4Snapshot.taskId}`,
    );
  }

  const goalProjection = await browser.execute(
    (paneTestId, panelTestId) => {
      const pane = document.querySelector<HTMLElement>(
        `[data-testid="${paneTestId}"]`,
      );
      const panel = pane?.querySelector<HTMLElement>(
        `[data-testid="${panelTestId}"]`,
      );
      if (!panel) {
        return null;
      }
      return {
        objective: panel.getAttribute("data-goal-objective"),
        status: panel.getAttribute("data-goal-status"),
      };
    },
    testId(TID_V4_SESSION_PANE, "workspace-main"),
    TID_CHAT_SUMMARY_PANEL,
  );
  const hasBlockingGoalWork =
    goalProjection?.status === "active" ||
    goalProjection?.status === "verifying";
  const effectiveRuntimeStatus =
    v4Snapshot.runtimeStatus === "streaming"
      ? "streaming"
      : taskStore.runtimeStatus;

  return {
    activeInputId: taskStore.activeInputId,
    queueCount: v4Snapshot.queueCount,
    runtimeStatus: effectiveRuntimeStatus,
    sessionId: v4Snapshot.taskId,
    state:
      effectiveRuntimeStatus === "streaming" || hasBlockingGoalWork
        ? "streaming"
        : "idle",
    modelSwitchPending: v4Snapshot.modelSwitchPending,
    stopRequested: taskStore.stopRequested,
    targetId: taskStore.taskMeta?.targetId ?? null,
    targetObjective:
      goalProjection?.objective ?? taskStore.taskMeta?.targetObjective ?? null,
    targetStatus:
      goalProjection?.status ?? taskStore.taskMeta?.targetStatus ?? null,
    taskId: v4Snapshot.taskId,
  };
}

export async function waitForAssistantMessageContaining(text: string) {
  await browser.waitUntil(
    async () =>
      (await getMessages("assistant")).some((message) =>
        message.text.includes(text),
      ),
    {
      timeout: 90000,
      timeoutMsg: `assistant messageMedium没有出现: ${text}`,
    },
  );
}

export async function waitForUserMessageContaining(text: string) {
  let latestMessages: MessageSnapshot[] = [];
  try {
    await browser.waitUntil(
      async () => {
        latestMessages = await getMessages("user");
        return latestMessages.some((message) => message.text.includes(text));
      },
      {
        timeout: 60000,
        timeoutMsg: `user messageMedium没有出现: ${text}`,
      },
    );
  } catch (error) {
    const chat = await getChatRootSnapshot().catch((snapshotError) => ({
      error:
        snapshotError instanceof Error
          ? snapshotError.message
          : String(snapshotError),
    }));
    const queue = await readQueueItemsForDiagnostics().catch((queueError) => [
      {
        content:
          queueError instanceof Error ? queueError.message : String(queueError),
        id: "<queue-read-error>",
        index: -1,
        kind: null,
        status: null,
      },
    ]);
    const taskStore =
      "taskId" in chat && chat.taskId
        ? await readTaskStoreSnapshotForDiagnostics(chat.taskId).catch(
            (storeError) => ({
              error:
                storeError instanceof Error
                  ? storeError.message
                  : String(storeError),
            }),
          )
        : null;
    const composer = await getComposerText().catch((composerError) =>
      composerError instanceof Error
        ? composerError.message
        : String(composerError),
    );
    throw new Error(
      `user messageMedium没有出现: ${text}; latestMessages=${JSON.stringify(latestMessages)}; chat=${JSON.stringify(chat)}; queue=${JSON.stringify(queue)}; taskStore=${JSON.stringify(taskStore)}; composer=${JSON.stringify(composer)}`,
      { cause: error },
    );
  }
}

export async function assertVisibleUserMessagesNotContaining(text: string) {
  const messages = await getMessages("user");
  expect(messages.map((message) => message.text).join("\n")).not.toContain(
    text,
  );
}

export function getMessages(
  role?: "assistant" | "user",
): Promise<MessageSnapshot[]> {
  return browser.execute(
    (
      messagesTestId: string,
      userPrefix: string,
      assistantPrefix: string,
      selectedRole: "assistant" | "user" | undefined,
      v4TimelineTestId: string,
    ) => {
      const legacyRoot = document.querySelector<HTMLElement>(
        `[data-testid="${messagesTestId}"]`,
      );
      if (legacyRoot) {
        const selector =
          selectedRole === "user"
            ? `[data-testid^="${userPrefix}-"]`
            : selectedRole === "assistant"
              ? `[data-testid^="${assistantPrefix}-"]`
              : `[data-testid^="${userPrefix}-"],[data-testid^="${assistantPrefix}-"]`;
        return Array.from(
          legacyRoot.querySelectorAll<HTMLElement>(selector),
        ).map((element) => ({
          id: element.getAttribute("data-message-id"),
          role: element.getAttribute("data-role"),
          text: element.innerText.replace(/\u00a0/g, " ").trim(),
        }));
      }

      const timeline = document.querySelector<HTMLElement>(
        `[data-testid="${v4TimelineTestId}"]`,
      );
      return Array.from(
        timeline?.querySelectorAll<HTMLElement>("[data-row-id]") ?? [],
      )
        .map((element) => {
          const role = element.classList.contains("group/user-row")
            ? "user"
            : element.classList.contains("group/assistant-row")
              ? "assistant"
              : null;
          return {
            id: element.getAttribute("data-row-id"),
            role,
            text: element.innerText.replace(/\u00a0/g, " ").trim(),
          };
        })
        .filter(
          (message) =>
            message.role && (!selectedRole || message.role === selectedRole),
        );
    },
    TID_CHAT_MESSAGES,
    TID_CHAT_USER_MESSAGE,
    TID_CHAT_ASSISTANT_MESSAGE,
    role,
    TID_V4_TIMELINE,
  );
}

async function waitForApiKeyContinueEnabled() {
  await browser.waitUntil(
    async () =>
      browser.execute((continueButtonTestId) => {
        const button = document.querySelector<HTMLElement>(
          `[data-testid="${continueButtonTestId}"]`,
        );
        return button instanceof HTMLButtonElement && !button.disabled;
      }, TID_LOGIN_API_KEY_CONTINUE_BUTTON),
    {
      timeout: 15000,
      timeoutMsg: "API Key 登录继续按钮没有变为可用",
    },
  );
}
