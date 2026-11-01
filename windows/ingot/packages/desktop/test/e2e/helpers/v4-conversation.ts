import { selectCombinedComposerThoughtLevel } from "./composer-model-picker.js";

import { encodeCustomModelValue } from "@origin-ai/cf-shared";
import {
  TID_CHAT_MODE_SELECT_ITEM,
  TID_CHAT_MODE_SELECT_TRIGGER,
  TID_CHAT_SUMMARY_PANEL,
  TID_CHAT_MODEL_SELECT_GROUP,
  TID_CHAT_MODEL_SELECT_ITEM,
  TID_CHAT_MODEL_SELECT_TRIGGER,
  TID_CHAT_THOUGHT_LEVEL_SELECT_ITEM,
  TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER,
  TID_PROMPT_SUGGESTION_OPTION,
  TID_PROMPT_SUGGESTION_PANEL,
  TID_LOGIN_API_KEY_CONTINUE_BUTTON,
  TID_LOGIN_API_KEY_INPUT,
  TID_LOGIN_USE_API_KEY_BUTTON,
  TID_TASK_ITEM,
  TID_TASK_NEW_BUTTON,
  TID_V4_AUTODRAIN_TOGGLE,
  TID_V4_ATTACHMENT,
  TID_V4_BACKGROUND_WORK_ITEM,
  TID_V4_COMPOSER,
  TID_V4_COMPOSER_BACKGROUND_WORK_TRIGGER,
  TID_V4_COMPOSER_CLEAR_QUEUE_SEND,
  TID_V4_COMPOSER_INPUT,
  TID_V4_COMPOSER_KEEP_QUEUE_SEND,
  TID_V4_COMPOSER_SEND,
  TID_V4_DELETE_SESSION,
  TID_V4_EDIT,
  TID_V4_EDIT_INPUT,
  TID_V4_EDIT_REWIND_WORKSPACE,
  TID_V4_EDIT_SUBMIT,
  TID_V4_EDIT_WORKSPACE_CONFLICT_CONVERSATION_ONLY,
  TID_V4_EDIT_WORKSPACE_CONFLICT_DIALOG,
  TID_V4_FOLLOWUP_TOGGLE,
  TID_V4_MODEL_CONFIG,
  TID_V4_PAUSED_QUEUE_SEND_DIALOG,
  TID_V4_PANE_SHELL,
  TID_V4_QUEUE,
  TID_V4_QUEUE_ITEM,
  TID_V4_QUEUE_PAUSED_BANNER,
  TID_V4_QUEUE_RESUME,
  TID_V4_RENAME_INPUT,
  TID_V4_RENAME_SUBMIT,
  TID_V4_ROW,
  TID_V4_ROW_ATTACHMENTS,
  TID_V4_SESSION_PANE,
  TID_V4_SESSION_TITLE,
  TID_V4_STOP,
  TID_V4_TIMELINE,
  TID_V4_TIMELINE_BOTTOM,
  TID_V4_TURN_NAVIGATOR,
  TID_V4_TURN_NAVIGATOR_ITEM,
  TID_V4_TURN_NAVIGATOR_TOOLTIP,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  clickTestIdByDom,
  DEFAULT_WORKSPACE,
  dispatchMouseDownByExactTestId,
  setCurrentElectronRendererContentSize,
  setInputValueByTestIdDom,
  waitForDefaultWorkspaceReady,
} from "./desktop-app.js";
import {
  ensureUpstreamProviderForE2E,
  selectUpstreamModel,
  selectUpstreamThoughtLevel,
} from "./upstream-provider.js";
import { readV4ChatRootSnapshotInBrowser } from "./conversation-session-chat-root-snapshot-script.js";
import { getTaskStoreSnapshot as readTaskStoreSnapshotForDiagnostics } from "./conversation-session-store.js";
import { sel } from "./selectors.js";
import { skipOccupationOnboardingIfPresent } from "./occupation-onboarding.js";
import { startDraftFromProject, waitForProjectRow } from "#e2e/helpers/project-sidebar";

export const LOGIN_API_KEY = "e2e-login-api-key";
export const E2E_REPLY_TOKEN = "upstream-e2e-ok";

interface PrepareV4ConversationE2EOptions {
  resetDraftBeforeProvider?: boolean;
  skipProvider?: boolean;
  
  skipShellReady?: boolean;
}

export const V4_MAIN_PANE_ID = "workspace-main";

export interface V4PaneSnapshot {
  
  sessionId: string | null;
  initialDraftProvider: string;
  initialDraftModel: string;
  
  canStop: boolean;
  
  timelineText: string;
  rowCount: number;
}

export interface V4CompactMarkerSnapshot {
  origin: string | null;
  rowId: number | null;
  status: string | null;
  text: string;
}

export interface V4ConversationStateSnapshot {
  activeInputId: string | null;
  modelSwitchPending: boolean;
  queueCount: number;
  runtimeStatus: string | null;
  sessionId: string | null;
  state: string | null;
  stopRequested: boolean;
  targetId: string | null;
  targetObjective: string | null;
  targetStatus: string | null;
  taskId: string | null;
}

export interface V4MessageSnapshot {
  id: string | null;
  role: "assistant" | "user";
  text: string;
}

export async function prepareV4ConversationE2E(options: PrepareV4ConversationE2EOptions = {}) {
  if (!options.skipShellReady) {
    await ensureV4ShellReady();
  }
  if (!options.skipShellReady || options.resetDraftBeforeProvider) {
    await ensureV4PreparationDraft(options);
  }
  if (!options.skipProvider) {
    await ensureUpstreamProviderForE2E({ skipToolbarSelection: true });
  }
  await ensureV4PreparationDraft(options);
  if (!options.skipShellReady) {
    await waitForDefaultWorkspaceReady(30000);
  }
  if (!options.skipProvider) {
    await selectUpstreamModel();
    await selectUpstreamThoughtLevel();
  }
}

async function ensureV4ShellReady() {
  try {
    await skipOccupationOnboardingIfPresent();
    await waitForProjectRow(DEFAULT_WORKSPACE, { timeout: 30000 });
    return;
  } catch (error) {
    if (!(await hasApiKeyLoginButton())) {
      throw error;
    }
    await loginWithApiKey();
    await skipOccupationOnboardingIfPresent();
    await waitForProjectRow(DEFAULT_WORKSPACE, { timeout: 30000 });
  }
}

async function ensureV4PreparationDraft(options: PrepareV4ConversationE2EOptions) {
  const ready = await browser.execute(
    (inputId, paneId, stopId, workspacePath) => {
      const pane = document.querySelector<HTMLElement>(`[data-testid="${paneId}"]`);
      const input = pane?.querySelector<HTMLElement>(`[data-testid="${inputId}"]`);
      const activePath = (
        window as Window & {
          __cfTabStoreE2E?: { getState(): { activeWorkspacePath?: string | null } };
        }
      ).__cfTabStoreE2E?.getState().activeWorkspacePath;
      return Boolean(
        pane?.dataset.sessionId === "draft" &&
        input?.getClientRects().length &&
        !input.textContent?.trim() &&
        !pane.querySelector(`[data-testid="${stopId}"]`) &&
        (!workspacePath || activePath === workspacePath),
      );
    },
    TID_V4_COMPOSER_INPUT,
    testId(TID_V4_SESSION_PANE, V4_MAIN_PANE_ID),
    TID_V4_STOP,
    options.skipShellReady ? null : DEFAULT_WORKSPACE,
  );
  if (ready) return;
  if (options.skipShellReady) {
    await startNewV4Draft();
  } else {
    await startDraftFromProject(DEFAULT_WORKSPACE);
  }
}

async function hasApiKeyLoginButton() {
  const exists = await browser
    .execute(
      (currentTestId) => Boolean(document.querySelector(`[data-testid="${currentTestId}"]`)),
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
  await clickTestIdByDom(TID_LOGIN_API_KEY_CONTINUE_BUTTON, {
    timeout: 15000,
    timeoutMsg: "API Key 登录继续按钮没有出现或不可点击",
  });
}

export async function startNewV4Draft() {
  await clickTestIdByDom(TID_TASK_NEW_BUTTON, {
    timeout: 15000,
    timeoutMsg: "侧栏新任务按钮没有出现或不可点击",
  });
  await waitForV4Pane(
    (snapshot) => snapshot.sessionId === "draft",
    "新建任务后 v4 pane 没有回到 draft 态",
  );
}

export function getV4PaneSnapshot(paneId: string = V4_MAIN_PANE_ID): Promise<V4PaneSnapshot> {
  return browser.execute(
    (paneTestId, stopTestId, timelineTestId, rowPrefix) => {
      const pane = document.querySelector<HTMLElement>(`[data-testid="${paneTestId}"]`);
      const timeline = pane?.querySelector<HTMLElement>(`[data-testid="${timelineTestId}"]`);
      return {
        sessionId: pane?.getAttribute("data-session-id") ?? null,
        initialDraftProvider: pane?.getAttribute("data-initial-draft-provider") ?? "",
        initialDraftModel: pane?.getAttribute("data-initial-draft-model") ?? "",
        canStop: Boolean(pane?.querySelector(`[data-testid="${stopTestId}"]`)),
        timelineText: (timeline?.innerText ?? "").replace(/ /g, " "),
        rowCount: pane?.querySelectorAll(`[data-testid^="${rowPrefix}-"]`).length ?? 0,
      };
    },
    testId(TID_V4_SESSION_PANE, paneId),
    TID_V4_STOP,
    TID_V4_TIMELINE,
    TID_V4_ROW,
  );
}

export async function waitForV4Pane(
  predicate: (snapshot: V4PaneSnapshot) => boolean,
  timeoutMsg: string,
  timeout = 30000,
  paneId: string = V4_MAIN_PANE_ID,
) {
  let latest: V4PaneSnapshot | null = null;
  try {
    await browser.waitUntil(
      async () => {
        latest = await getV4PaneSnapshot(paneId);
        return predicate(latest);
      },
      { timeout, timeoutMsg },
    );
  } catch (error) {
    latest = await getV4PaneSnapshot(paneId);
    throw new Error(`${timeoutMsg}; latest=${JSON.stringify(latest)}`, {
      cause: error,
    });
  }
  return latest ?? getV4PaneSnapshot(paneId);
}

export async function waitForV4ConversationState(
  predicate: (snapshot: V4ConversationStateSnapshot) => boolean,
  timeoutMsg: string,
  timeout = 30000,
) {
  let latest: V4ConversationStateSnapshot | null = null;
  try {
    await browser.waitUntil(
      async () => {
        latest = await getV4ConversationState();
        return predicate(latest);
      },
      { timeout, timeoutMsg },
    );
  } catch (error) {
    latest = await getV4ConversationState();
    throw new Error(`${timeoutMsg}; latest=${JSON.stringify(latest)}`, {
      cause: error,
    });
  }
  return latest ?? getV4ConversationState();
}

export async function getV4ConversationState(): Promise<V4ConversationStateSnapshot> {
  const browserSnapshot = await browser.execute(
    readV4ChatRootSnapshotInBrowser,
    testId(TID_V4_SESSION_PANE, V4_MAIN_PANE_ID),
    TID_V4_QUEUE_ITEM,
    TID_V4_STOP,
  );
  if (browserSnapshot.bridgeError) {
    throw new Error(
      `无法Read V4 conversation workspace: ${browserSnapshot.bridgeError}; ` +
        `workspaceKey=${browserSnapshot.workspaceKey}; paneSessionId=${browserSnapshot.paneSessionId}`,
    );
  }

  if (!browserSnapshot.taskId) {
    return {
      activeInputId: null,
      modelSwitchPending: browserSnapshot.modelSwitchPending,
      queueCount: browserSnapshot.queueCount,
      runtimeStatus: browserSnapshot.runtimeStatus,
      sessionId: null,
      state: browserSnapshot.runtimeStatus === "streaming" ? "streaming" : "idle",
      stopRequested: false,
      targetId: null,
      targetObjective: null,
      targetStatus: null,
      taskId: null,
    };
  }

  const taskStore = await readTaskStoreSnapshotForDiagnostics(
    browserSnapshot.taskId,
    browserSnapshot.workspaceKey ?? undefined,
  );
  if (!taskStore.workspaceKey) {
    throw new Error(
      `无法Read V4 conversation task: ${taskStore.error}; ` +
        `workspaceKey=${browserSnapshot.workspaceKey}; taskId=${browserSnapshot.taskId}`,
    );
  }

  const goalProjection = await browser.execute(
    (paneTestId, panelTestId) => {
      const pane = document.querySelector<HTMLElement>(`[data-testid="${paneTestId}"]`);
      const panel = pane?.querySelector<HTMLElement>(`[data-testid="${panelTestId}"]`);
      if (!panel) return null;
      return {
        objective: panel.getAttribute("data-goal-objective"),
        status: panel.getAttribute("data-goal-status"),
      };
    },
    testId(TID_V4_SESSION_PANE, V4_MAIN_PANE_ID),
    TID_CHAT_SUMMARY_PANEL,
  );
  const hasBlockingGoalWork =
    goalProjection?.status === "active" || goalProjection?.status === "verifying";
  const effectiveRuntimeStatus =
    browserSnapshot.runtimeStatus === "streaming" ? "streaming" : taskStore.runtimeStatus;

  return {
    activeInputId: taskStore.activeInputId,
    modelSwitchPending: browserSnapshot.modelSwitchPending,
    queueCount: browserSnapshot.queueCount,
    runtimeStatus: effectiveRuntimeStatus,
    sessionId: browserSnapshot.taskId,
    state: effectiveRuntimeStatus === "streaming" || hasBlockingGoalWork ? "streaming" : "idle",
    stopRequested: taskStore.stopRequested,
    targetId: taskStore.taskMeta?.targetId ?? null,
    targetObjective: goalProjection?.objective ?? taskStore.taskMeta?.targetObjective ?? null,
    targetStatus: goalProjection?.status ?? taskStore.taskMeta?.targetStatus ?? null,
    taskId: browserSnapshot.taskId,
  };
}

export async function sendV4Prompt(prompt: string) {
  await setV4ComposerText(prompt);
  const mainPaneTestId = testId(TID_V4_SESSION_PANE, V4_MAIN_PANE_ID);
  try {
    await browser.waitUntil(
      async () =>
        browser.execute(
          (paneTestId, sendButtonTestId) => {
            const pane = document.querySelector<HTMLElement>(`[data-testid="${paneTestId}"]`);
            const button = pane?.querySelector<HTMLButtonElement>(
              `[data-testid="${sendButtonTestId}"]`,
            );
            return Boolean(button && !button.disabled);
          },
          mainPaneTestId,
          TID_V4_COMPOSER_SEND,
        ),
      {
        timeout: 30000,
        timeoutMsg: "v4 发送按钮没有变为可用",
      },
    );
  } catch (error) {
    const diagnostics = await browser.execute(
      (paneTestId, inputTestId, sendTestId, stopTestId) => {
        const panes = Array.from(
          document.querySelectorAll<HTMLElement>(`[data-testid^="${paneTestId}"]`),
        );
        const active = document.activeElement as HTMLElement | null;
        return {
          activeTestId: active?.getAttribute("data-testid") ?? null,
          panes: panes.map((pane) => {
            const input = pane.querySelector<HTMLElement>(`[data-testid="${inputTestId}"]`);
            const send = pane.querySelector<HTMLButtonElement>(`[data-testid="${sendTestId}"]`);
            return {
              paneTestId: pane.getAttribute("data-testid"),
              sessionId: pane.getAttribute("data-session-id"),
              inputText: input?.innerText ?? input?.textContent ?? null,
              sendDisabled: send?.disabled ?? null,
              sendTitle: send?.getAttribute("title") ?? null,
              canStop: Boolean(pane.querySelector(`[data-testid="${stopTestId}"]`)),
            };
          }),
        };
      },
      TID_V4_SESSION_PANE,
      TID_V4_COMPOSER_INPUT,
      TID_V4_COMPOSER_SEND,
      TID_V4_STOP,
    );
    throw new Error(`v4 Send按钮没有变为Available; diagnostics=${JSON.stringify(diagnostics)}`, {
      cause: error,
    });
  }
  const submitResult = await browser.execute(
    (paneTestId, sendButtonTestId) => {
      const pane = document.querySelector<HTMLElement>(`[data-testid="${paneTestId}"]`);
      const button = pane?.querySelector<HTMLButtonElement>(`[data-testid="${sendButtonTestId}"]`);
      if (!pane) return { submitted: false, reason: "pane-missing" };
      if (!button) return { submitted: false, reason: "button-missing" };
      if (button.disabled) return { submitted: false, reason: "button-disabled" };

      const form = button.closest("form");
      if (!form) {
        button.click();
        return { submitted: true, method: "click-fallback" };
      }

      let submitEventSeen = false;
      const onSubmit = () => {
        submitEventSeen = true;
      };
      form.addEventListener("submit", onSubmit, { capture: true, once: true });
      form.requestSubmit(button);
      return {
        submitted: submitEventSeen,
        method: "request-submit",
        reason: submitEventSeen ? undefined : "submit-event-not-seen",
      };
    },
    mainPaneTestId,
    TID_V4_COMPOSER_SEND,
  );
  if (!submitResult.submitted) {
    throw new Error(`v4 composer 没有派发 submit Events: ${JSON.stringify(submitResult)}`);
  }
}

export async function sendV4PromptAndWaitAccepted(
  prompt: string,
  userMessageMarker: string,
  timeoutMsg: string,
  timeout = 60_000,
) {
  await sendV4Prompt(prompt);
  let latest: {
    composerText: string | null;
    paneExists: boolean;
    sendDisabled: boolean | null;
    sessionId: string | null;
    userMessageSeen: boolean;
  } | null = null;
  const readAcceptance = () =>
    browser.execute(
      (paneTestId, inputTestId, sendTestId, timelineTestId, marker) => {
        const pane = document.querySelector<HTMLElement>(`[data-testid="${paneTestId}"]`);
        const input = pane?.querySelector<
          HTMLElement & { __cfLexicalInputE2E?: { getText: () => string } }
        >(`[data-testid="${inputTestId}"]`);
        const send = pane?.querySelector<HTMLButtonElement>(`[data-testid="${sendTestId}"]`);
        const timeline = pane?.querySelector<HTMLElement>(`[data-testid="${timelineTestId}"]`);
        const userMessageSeen = Array.from(
          timeline?.querySelectorAll<HTMLElement>("[data-row-id]") ?? [],
        ).some(
          (row) =>
            row.classList.contains("group/user-row") &&
            (row.innerText || row.textContent || "").includes(marker),
        );
        return {
          composerText: input?.__cfLexicalInputE2E?.getText() ?? null,
          paneExists: Boolean(pane),
          sendDisabled: send?.disabled ?? null,
          sessionId: pane?.getAttribute("data-session-id") ?? null,
          userMessageSeen,
        };
      },
      testId(TID_V4_SESSION_PANE, V4_MAIN_PANE_ID),
      TID_V4_COMPOSER_INPUT,
      TID_V4_COMPOSER_SEND,
      TID_V4_TIMELINE,
      userMessageMarker,
    );

  try {
    await browser.waitUntil(
      async () => {
        latest = await readAcceptance();
        return latest.composerText === "" && latest.userMessageSeen;
      },
      { timeout, timeoutMsg },
    );
  } catch (error) {
    latest = await readAcceptance().catch(() => latest);
    const state = await getV4ConversationState().catch((stateError) => ({
      error: stateError instanceof Error ? stateError.message : String(stateError),
    }));
    throw new Error(
      `${timeoutMsg}; acceptance=${JSON.stringify(latest)}; state=${JSON.stringify(state)}`,
      { cause: error },
    );
  }
}

export async function setV4ComposerText(text: string) {
  await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, text, {
    timeout: 15000,
    timeoutMsg: "v4 composer input box did not appear or is not editable",
  });
}

export async function waitForV4ComposerText(expected: string, timeoutMsg: string, timeout = 10000) {
  await browser.waitUntil(async () => (await getV4ComposerText()) === expected, {
    timeout,
    timeoutMsg,
  });
}

export async function clickV4Send() {
  await browser.waitUntil(
    async () =>
      browser.execute((sendButtonTestId) => {
        const button = document.querySelector<HTMLButtonElement>(
          `[data-testid="${sendButtonTestId}"]`,
        );
        return Boolean(button && !button.disabled);
      }, TID_V4_COMPOSER_SEND),
    {
      timeout: 30000,
      timeoutMsg: "v4 发送按钮没有变为可用",
    },
  );
  await clickTestIdByDom(TID_V4_COMPOSER_SEND, {
    timeout: 15000,
    timeoutMsg: "v4 发送按钮没有出现或不可点击",
  });
}

export async function waitForV4TimelineContaining(text: string, timeout = 60000) {
  await waitForV4Pane(
    (snapshot) => snapshot.timelineText.includes(text),
    `v4 timeline Medium没有出现: ${text}`,
    timeout,
  );
}

export async function waitForV4AssistantMessageContaining(
  text: string,
  timeout = 90000,
  paneId: string = V4_MAIN_PANE_ID,
) {
  let latestAssistantMessages: string[] = [];
  const readAssistantMessages = () =>
    browser.execute(
      (paneTestId, timelineTestId) => {
        const pane = document.querySelector<HTMLElement>(`[data-testid="${paneTestId}"]`);
        const timeline = pane?.querySelector<HTMLElement>(`[data-testid="${timelineTestId}"]`);
        return Array.from(timeline?.querySelectorAll<HTMLElement>("[data-row-id]") ?? [])
          .filter((row) => row.classList.contains("group/assistant-row"))
          .map((row) => row.innerText.replace(/\u00a0/g, " ").trim());
      },
      testId(TID_V4_SESSION_PANE, paneId),
      TID_V4_TIMELINE,
    );

  try {
    await browser.waitUntil(
      async () => {
        latestAssistantMessages = await readAssistantMessages();
        return latestAssistantMessages.some((message) => message.includes(text));
      },
      {
        timeout,
        timeoutMsg: `v4 assistant messageMedium没有出现: ${text}`,
      },
    );
  } catch (error) {
    latestAssistantMessages = await readAssistantMessages().catch(() => latestAssistantMessages);
    throw new Error(
      `v4 assistant messageMedium没有出现: ${text}; latest=${JSON.stringify(latestAssistantMessages)}`,
      { cause: error },
    );
  }
}

export function getV4Messages(role?: "assistant" | "user"): Promise<V4MessageSnapshot[]> {
  return browser.execute(
    (paneTestId, timelineTestId, selectedRole) => {
      const pane = document.querySelector<HTMLElement>(`[data-testid="${paneTestId}"]`);
      const timeline = pane?.querySelector<HTMLElement>(`[data-testid="${timelineTestId}"]`);
      return Array.from(timeline?.querySelectorAll<HTMLElement>("[data-row-id]") ?? [])
        .map((element) => {
          const currentRole = element.classList.contains("group/user-row")
            ? "user"
            : element.classList.contains("group/assistant-row")
              ? "assistant"
              : null;
          return {
            id: element.getAttribute("data-row-id"),
            role: currentRole,
            text: element.innerText.replace(/\u00a0/g, " ").trim(),
          };
        })
        .filter(
          (message): message is V4MessageSnapshot =>
            message.role !== null && (!selectedRole || message.role === selectedRole),
        );
    },
    testId(TID_V4_SESSION_PANE, V4_MAIN_PANE_ID),
    TID_V4_TIMELINE,
    role,
  );
}

export async function waitForV4UserMessageContaining(text: string) {
  let latestMessages: V4MessageSnapshot[] = [];
  try {
    await browser.waitUntil(
      async () => {
        latestMessages = await getV4Messages("user");
        return latestMessages.some((message) => message.text.includes(text));
      },
      {
        timeout: 60000,
        timeoutMsg: `v4 user messageMedium没有出现: ${text}`,
      },
    );
  } catch (error) {
    const [state, composer, queue] = await Promise.all([
      getV4ConversationState().catch((stateError) => ({
        error: stateError instanceof Error ? stateError.message : String(stateError),
      })),
      getV4ComposerText().catch((composerError) =>
        composerError instanceof Error ? composerError.message : String(composerError),
      ),
      getV4QueueItems().catch((queueError) => [
        {
          queueItemId: "<queue-read-error>",
          text: queueError instanceof Error ? queueError.message : String(queueError),
        },
      ]),
    ]);
    throw new Error(
      `v4 user messageMedium没有出现: ${text}; latestMessages=${JSON.stringify(latestMessages)}; state=${JSON.stringify(state)}; queue=${JSON.stringify(queue)}; composer=${JSON.stringify(composer)}`,
      { cause: error },
    );
  }
}

export async function assertVisibleV4UserMessagesNotContaining(text: string) {
  const messages = await getV4Messages("user");
  expect(messages.map((message) => message.text).join("\n")).not.toContain(text);
}

export async function clickV4Stop() {
  await clickTestIdByDom(TID_V4_STOP, {
    timeout: 30000,
    timeoutMsg: "v4 stop 按钮没有出现或不可点击",
  });
}

export async function clickFirstV4Fork() {
  const buttons = await browser.$$('[data-testid^="v4-fork-"]');
  for (const button of buttons) {
    await moveV4ForkRowIntoHoverState(button);
    if (!(await button.isDisplayed()) || !(await button.isEnabled())) {
      continue;
    }
    await button.click();
    return true;
  }
  return false;
}

export async function waitForV4Fork(timeout = 60000) {
  await browser.waitUntil(
    async () => {
      const buttons = await browser.$$('[data-testid^="v4-fork-"]');
      for (const button of buttons) {
        await moveV4ForkRowIntoHoverState(button);
        if ((await button.isDisplayed()) && (await button.isEnabled())) {
          return true;
        }
      }
      return false;
    },
    { timeout, timeoutMsg: "v4 fork 按钮没有出现（assistant 行未完成？）" },
  );
}

async function moveV4ForkRowIntoHoverState(button: WebdriverIO.Element): Promise<void> {
  const rowTestId = await browser.execute(
    (element) => element.closest<HTMLElement>("[data-row-id]")?.dataset.rowId ?? null,
    button,
  );
  const row = rowTestId ? await browser.$(`[data-row-id="${rowTestId}"]`) : await button.$("..");
  await row.moveTo();
}

export async function clickFirstV4Edit() {
  return browser.execute(() => {
    const btn = document.querySelector<HTMLButtonElement>('[data-testid^="v4-edit-"]');
    btn?.click();
    return Boolean(btn);
  });
}

export async function waitForV4Edit(timeout = 60000) {
  await browser.waitUntil(
    async () =>
      browser.execute((editPrefix) => {
        const exactPattern = new RegExp(`^${editPrefix}-\\d+$`);
        return Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).some(
          (candidate) => exactPattern.test(candidate.dataset.testid ?? ""),
        );
      }, TID_V4_EDIT),
    { timeout, timeoutMsg: "v4 edit 按钮没有出现（user 行未完成？）" },
  );
}

export function getV4QueueItems(): Promise<Array<{ queueItemId: string; text: string }>> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll<HTMLElement>('li[data-testid^="v4-queue-item-"]'))
      .filter((el) => el.hasAttribute("data-queue-item-id"))
      .map((el) => ({
        queueItemId: el.getAttribute("data-queue-item-id") ?? "",
        text: (el.innerText || "").replace(/ /g, " ").trim(),
      })),
  );
}

export function getV4QueueAutoDrain(): Promise<boolean | null> {
  return browser.execute((queueTestId) => {
    const queue = document.querySelector<HTMLElement>(`[data-testid="${queueTestId}"]`);
    const value = queue?.getAttribute("data-queue-auto-drain");
    return value === null || value === undefined ? null : value === "true";
  }, TID_V4_QUEUE);
}

export async function waitForV4QueueCount(expected: number, timeout = 30000) {
  await browser.waitUntil(async () => (await getV4QueueItems()).length === expected, {
    timeout,
    timeoutMsg: `v4 queue 项Count没有达到 ${expected}`,
  });
}

export async function clickV4QueueItemDelete(queueItemId: string) {
  return browser.execute((id) => {
    const btn = document.querySelector<HTMLButtonElement>(
      `[data-testid="v4-queue-item-delete-${id}"]`,
    );
    btn?.click();
    return Boolean(btn);
  }, queueItemId);
}

export async function clickV4QueueItemEdit(queueItemId: string, clickCount = 1) {
  return browser.execute(
    (id, count) => {
      const btn = document.querySelector<HTMLButtonElement>(
        `[data-testid="v4-queue-item-edit-${id}"]`,
      );
      for (let index = 0; index < count; index += 1) {
        btn?.click();
      }
      return Boolean(btn);
    },
    queueItemId,
    clickCount,
  );
}

export async function clickV4QueueItemSendNow(queueItemId: string) {
  return browser.execute((id) => {
    const btn = document.querySelector<HTMLButtonElement>(
      `[data-testid="v4-queue-item-send-now-${id}"]`,
    );
    btn?.click();
    return Boolean(btn);
  }, queueItemId);
}

export function hasV4PausedQueueSendDialog(): Promise<boolean> {
  return browser.execute(
    (dialogTestId, clearTestId, keepTestId) =>
      Boolean(
        document.querySelector(`[data-testid="${dialogTestId}"]`) &&
        document.querySelector(`[data-testid="${clearTestId}"]`) &&
        document.querySelector(`[data-testid="${keepTestId}"]`),
      ),
    TID_V4_PAUSED_QUEUE_SEND_DIALOG,
    TID_V4_COMPOSER_CLEAR_QUEUE_SEND,
    TID_V4_COMPOSER_KEEP_QUEUE_SEND,
  );
}

export async function waitForV4PausedQueueSendDialog(timeout = 30000) {
  await browser.waitUntil(async () => hasV4PausedQueueSendDialog(), {
    timeout,
    timeoutMsg: "暂停队列发送确认 modal 没有出现（清空/发送按钮缺失）",
  });
}

export async function sendV4PausedQueueKeep(prompt: string) {
  await sendV4Prompt(prompt);
  await waitForV4PausedQueueSendDialog();
  await clickTestIdByDom(TID_V4_COMPOSER_KEEP_QUEUE_SEND, {
    timeout: 15000,
    timeoutMsg: "暂停队列确认 modal 的“发送消息”按钮没有出现或不可点击",
  });
}

export async function sendV4PausedQueueClear(prompt: string) {
  await sendV4Prompt(prompt);
  await waitForV4PausedQueueSendDialog();
  await clickTestIdByDom(TID_V4_COMPOSER_CLEAR_QUEUE_SEND, {
    timeout: 15000,
    timeoutMsg: "暂停队列确认 modal 的“清空队列”按钮没有出现或不可点击",
  });
}

export function hasV4PausedQueueBanner(): Promise<boolean> {
  return browser.execute(
    (bannerTestId, resumeTestId) =>
      Boolean(
        document.querySelector(`[data-testid="${bannerTestId}"]`) &&
        document.querySelector(`[data-testid="${resumeTestId}"]`),
      ),
    TID_V4_QUEUE_PAUSED_BANNER,
    TID_V4_QUEUE_RESUME,
  );
}

export async function waitForV4PausedQueueBanner(timeout = 30000) {
  await browser.waitUntil(async () => hasV4PausedQueueBanner(), {
    timeout,
    timeoutMsg: "暂停队列提示条或“继续”按钮没有出现",
  });
}

export async function clickV4PausedQueueResume() {
  await waitForV4PausedQueueBanner();
  await clickTestIdByDom(TID_V4_QUEUE_RESUME, {
    timeout: 15000,
    timeoutMsg: "暂停队列提示条的“继续”按钮没有出现或不可点击",
  });
}

export function getV4BackgroundWorks(): Promise<Array<{ workId: string; status: string | null }>> {
  return browser.execute((itemPrefix) => {
    return Array.from(
      document.querySelectorAll<HTMLElement>(`[data-testid^="${itemPrefix}-"]`),
    ).map((el) => ({
      workId: el.getAttribute("data-work-id") ?? "",
      status: el.getAttribute("data-work-status"),
    }));
  }, TID_V4_BACKGROUND_WORK_ITEM);
}

export function getV4ComposerBackgroundWorkCounts(): Promise<{
  bashCount: number;
  workflowCount: number;
  subagentCount: number;
  totalCount: number;
  
  openTarget: string;
  typedVisible: boolean;
  compactVisible: boolean;
} | null> {
  return browser.execute((triggerTestId) => {
    const trigger = document.querySelector<HTMLElement>(`[data-testid="${triggerTestId}"]`);
    if (!trigger) return null;
    const isVisible = (layout: string) => {
      const element = trigger.querySelector<HTMLElement>(
        `[data-composer-background-layout="${layout}"]`,
      );
      return Boolean(element && getComputedStyle(element).display !== "none");
    };
    return {
      bashCount: Number(trigger.dataset.backgroundBashCount ?? "0"),
      workflowCount: Number(trigger.dataset.backgroundWorkflowCount ?? "0"),
      subagentCount: Number(trigger.dataset.backgroundSubagentCount ?? "0"),
      totalCount: Number(trigger.dataset.backgroundTotalCount ?? "0"),
      openTarget: trigger.dataset.backgroundOpenTarget ?? "panel",
      typedVisible: isVisible("typed"),
      compactVisible: isVisible("compact"),
    };
  }, TID_V4_COMPOSER_BACKGROUND_WORK_TRIGGER);
}

export async function setV4ElectronWindowSize(width: number, height: number) {
  await setCurrentElectronRendererContentSize(width, height);
}

export async function openV4ComposerRunningBackgroundWorks(timeout = 30000) {
  await clickTestIdByDom(TID_V4_COMPOSER_BACKGROUND_WORK_TRIGGER, {
    timeout,
    timeoutMsg: "Composer 后台任务入口没有出现或不可点击",
  });
  await browser.waitUntil(
    async () =>
      browser.execute(
        (panelTestId, itemPrefix) => {
          const panel = document.querySelector<HTMLElement>(`[data-testid="${panelTestId}"]`);
          const terminalCount = Number(panel?.dataset.runningTerminalCount ?? "0");
          const agentCount = Number(panel?.dataset.runningAgentCount ?? "0");
          const terminalTrigger = panel?.querySelector<HTMLElement>(
            '[data-status-section-trigger="terminal"]',
          );
          const agentTrigger = panel?.querySelector<HTMLElement>(
            '[data-status-section-trigger="agent"]',
          );
          return Boolean(
            panel?.dataset.state === "expanded" &&
            (terminalCount === 0 || terminalTrigger?.getAttribute("aria-expanded") === "true") &&
            (agentCount === 0 || agentTrigger?.getAttribute("aria-expanded") === "true") &&
            panel.querySelector(`[data-testid^="${itemPrefix}-"]`),
          );
        },
        TID_CHAT_SUMMARY_PANEL,
        TID_V4_BACKGROUND_WORK_ITEM,
      ),
    { timeout, timeoutMsg: "Composer 入口没有直达展开的终端/智能体明细" },
  );
}

export async function openV4RunningBackgroundWorks(timeout = 30000) {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (panelTestId, itemPrefix) => {
          const panel = document.querySelector<HTMLElement>(`[data-testid="${panelTestId}"]`);
          if (!panel || Number(panel.dataset.runningBackgroundCount ?? "0") < 1) {
            return false;
          }
          if (panel.dataset.state === "collapsed") {
            panel.querySelector<HTMLButtonElement>("button")?.click();
            return false;
          }
          const sections = [
            {
              count: Number(panel.dataset.runningTerminalCount ?? "0"),
              name: "terminal",
            },
            {
              count: Number(panel.dataset.runningAgentCount ?? "0"),
              name: "agent",
            },
          ];
          let allOpen = true;
          for (const section of sections) {
            if (section.count === 0) continue;
            const trigger = panel.querySelector<HTMLButtonElement>(
              `[data-status-section-trigger="${section.name}"]`,
            );
            if (!trigger) return false;
            if (trigger.getAttribute("aria-expanded") !== "true") {
              trigger.click();
              allOpen = false;
            }
          }
          return allOpen && Boolean(panel.querySelector(`[data-testid^="${itemPrefix}-"]`));
        },
        TID_CHAT_SUMMARY_PANEL,
        TID_V4_BACKGROUND_WORK_ITEM,
      ),
    { timeout, timeoutMsg: "status panel 没有展开终端/智能体 background work" },
  );
}

export function getLatestV4CommandAck(type: string): Promise<{
  type: string;
  status: string;
  reasonCode?: string;
} | null> {
  return browser.execute((commandType) => {
    const entries =
      (
        window as Window & {
          __cfV4CommandAcksE2E?: Array<{
            type: string;
            status: string;
            reasonCode?: string;
          }>;
        }
      ).__cfV4CommandAcksE2E ?? [];
    return [...entries].reverse().find((entry) => entry.type === commandType) ?? null;
  }, type);
}

export async function waitForLatestV4CommandAck(type: string, timeout = 30000) {
  let latest: Awaited<ReturnType<typeof getLatestV4CommandAck>> = null;
  await browser.waitUntil(
    async () => {
      latest = await getLatestV4CommandAck(type);
      return latest !== null;
    },
    { timeout, timeoutMsg: `v4 command 没有Back ACK: ${type}` },
  );
  return latest!;
}

export async function clickV4BackgroundWorkCancel(workId: string) {
  return browser.execute((id) => {
    const btn = document.querySelector<HTMLButtonElement>(
      `[data-testid="v4-background-work-cancel-${id}"]`,
    );
    btn?.click();
    return Boolean(btn);
  }, workId);
}

export async function clickV4DeleteSession() {
  return clickTestIdByDom(TID_V4_DELETE_SESSION, {
    timeout: 15000,
    timeoutMsg: "v4 删除按钮没有出现",
  });
}

export function getV4ModelConfig(): Promise<{
  mode: string | null;
  provider: string | null;
  model: string | null;
  source: string | null;
  thought: string | null;
}> {
  return browser.execute((modelTestId) => {
    const el = document.querySelector<HTMLElement>(`[data-testid="${modelTestId}"]`);
    return {
      mode: el?.getAttribute("data-mode") ?? null,
      provider: el?.getAttribute("data-provider") ?? null,
      model: el?.getAttribute("data-model") ?? null,
      source: el?.getAttribute("data-source") ?? null,
      thought: el?.getAttribute("data-thought") ?? null,
    };
  }, TID_V4_MODEL_CONFIG);
}

export async function waitForV4ComposerSelectionReady(timeout = 30_000) {
  let latest = await getV4ModelConfig();
  await browser.waitUntil(
    async () => {
      latest = await getV4ModelConfig();
      return (
        latest.source === "composer" &&
        Boolean(latest.mode?.trim()) &&
        Boolean(latest.provider?.trim()) &&
        Boolean(latest.model?.trim())
      );
    },
    {
      timeout,
      timeoutMsg: `v4 Composer 选择没有就绪: ${JSON.stringify(latest)}`,
    },
  );
}

export function getV4DraftThoughtState(workspacePath: string): Promise<{
  current: string | null;
  model: string | null;
  values: string[];
}> {
  return browser.execute(
    (path, modelTestId) => {
      const e2eWindow = window as Window & {
        __cfSessionStoreE2E?: {
          getState: () => {
            getWorkspaceState?: (workspacePath: string) => {
              configOptions?: Array<{
                category?: string;
                currentValue?: unknown;
                options?: Array<{ value: string }>;
              }>;
            };
          };
        };
      };
      const options =
        e2eWindow.__cfSessionStoreE2E?.getState().getWorkspaceState?.(path).configOptions ?? [];
      const model = options.find((option) => option.category === "model");
      const thought = options.find((option) => option.category === "thought_level");
      const v4Config = document.querySelector<HTMLElement>(`[data-testid="${modelTestId}"]`);
      const v4ThoughtLevels = (v4Config?.dataset.thoughtLevels ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      return {
        current:
          v4Config?.dataset.thought?.trim() ||
          (typeof thought?.currentValue === "string" ? thought.currentValue : null),
        model:
          v4Config?.dataset.model?.trim() ||
          (typeof model?.currentValue === "string" ? model.currentValue : null),
        values:
          v4ThoughtLevels.length > 0
            ? v4ThoughtLevels
            : (thought?.options?.map((option) => option.value) ?? []),
      };
    },
    workspacePath,
    TID_V4_MODEL_CONFIG,
  );
}

export async function switchV4Model(provider: string, model: string, thought: string) {
  const modelItemTestId = testId(
    TID_CHAT_MODEL_SELECT_ITEM,
    encodeCustomModelValue(provider, model),
  );
  const providerGroupTestIds = [
    testId(TID_CHAT_MODEL_SELECT_GROUP, `registry-provider:${provider}`),
  ];
  const modelTrigger = $(sel(TID_CHAT_MODEL_SELECT_TRIGGER));
  await modelTrigger.waitForClickable({ timeout: 30000 });
  await modelTrigger.click();
  await browser.waitUntil(
    async () =>
      browser.execute(
        (itemTestId, groupTestIds) => {
          const item = document.querySelector<HTMLElement>(`[data-testid="${itemTestId}"]`);
          if (item) {
            item.click();
            return true;
          }
          const group = groupTestIds
            .map((groupTestId) =>
              document.querySelector<HTMLElement>(`[data-testid="${groupTestId}"]`),
            )
            .find((candidate): candidate is HTMLElement => Boolean(candidate));
          if (!group) {
            const providerTrigger = document.querySelector<HTMLElement>(
              '[data-testid="composer-provider-trigger"]',
            );
            providerTrigger?.focus();
            providerTrigger?.dispatchEvent(
              new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
            );
          }
          if (group) {
            group.focus();
            for (const eventName of ["pointerenter", "mouseenter", "mousemove"] as const) {
              group.dispatchEvent(
                new MouseEvent(eventName, {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                }),
              );
            }
            group.click();
          }
          return false;
        },
        modelItemTestId,
        providerGroupTestIds,
      ),
    {
      timeout: 45000,
      timeoutMsg: `v4 Model Selection器没有出现TargetModel项: ${provider}/${model}`,
    },
  );

  await browser.waitUntil(async () => (await getV4ModelConfig()).model === model, {
    timeout: 30000,
    timeoutMsg: `Model切换后 config.model 投影没有更New为 ${model}`,
  });

  if (thought && (await selectCombinedComposerThoughtLevel(thought))) return;
  if (!thought && (await modelTrigger.getAttribute("data-composer-combined-model")) === "true") {
    await browser.keys("Escape");
    return;
  }

  if (!thought) {
    return;
  }

  await selectRadixOption(
    TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER,
    testId(TID_CHAT_THOUGHT_LEVEL_SELECT_ITEM, thought),
    `v4 Thinking深度选择器没有出现Target档位: ${thought}`,
  );
}

async function selectRadixOption(triggerTestId: string, itemTestId: string, timeoutMsg: string) {
  const trigger = $(sel(triggerTestId));
  await trigger.waitForClickable({ timeout: 30000 });
  await trigger.click();
  const item = $(sel(itemTestId));
  try {
    await item.waitForClickable({ timeout: 15000 });
  } catch (error) {
    throw new Error(timeoutMsg, { cause: error });
  }
  const confirmResult = await browser.execute((currentTestId) => {
    const element = document.querySelector<HTMLElement>(`[data-testid="${currentTestId}"]`);
    if (!element) {
      return {
        ok: false,
        reason: "item-missing",
        testIds: Array.from(document.querySelectorAll<HTMLElement>("[data-testid]"))
          .map((el) => el.dataset.testid ?? "")
          .filter((id) => id.includes("select"))
          .slice(0, 40),
      };
    }
    element.focus();
    const focused = document.activeElement === element;
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    return { ok: true, focused };
  }, itemTestId);
  if (!confirmResult || confirmResult.ok !== true) {
    throw new Error(`${timeoutMsg}（item confirmPhase异常: ${JSON.stringify(confirmResult)}）`);
  }
  await browser
    .waitUntil(
      async () =>
        browser.execute(
          (currentTestId) => !document.querySelector(`[data-testid="${currentTestId}"]`),
          itemTestId,
        ),
      { timeout: 5000 },
    )
    .catch(() => {
      throw new Error(`${timeoutMsg}（item confirm后菜单未Close——选择未生效）`);
    });
}

export function getV4GoalProjection(): Promise<{
  status: string | null;
  objective: string | null;
} | null> {
  return browser.execute(
    (paneTestId, paneId, panelTestId) => {
      const pane = document.querySelector<HTMLElement>(`[data-testid="${paneTestId}-${paneId}"]`);
      const el = pane?.querySelector<HTMLElement>(`[data-testid="${panelTestId}"]`);
      if (!el) return null;
      return {
        status: el.getAttribute("data-goal-status"),
        objective: el.getAttribute("data-goal-objective"),
      };
    },
    TID_V4_SESSION_PANE,
    V4_MAIN_PANE_ID,
    TID_CHAT_SUMMARY_PANEL,
  );
}

export async function beginFirstV4UserQueryEdit(newText: string) {
  let rowId: string | null = null;
  let lastClickedRowId: string | null = null;
  let lastClickedAt = 0;
  await browser.waitUntil(
    async () => {
      const state = await browser.execute(
        (editPrefix, editInputPrefix) => {
          const actionPattern = new RegExp(`^${editPrefix}-(\\d+)$`);
          const inputPattern = new RegExp(`^${editInputPrefix}-(\\d+)$`);
          const testIds = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]"));
          const input = testIds
            .filter((candidate) => inputPattern.test(candidate.dataset.testid ?? ""))
            .at(-1);
          if (input) {
            return {
              inputRowId: inputPattern.exec(input.dataset.testid ?? "")?.[1] ?? null,
              actionRowId: null,
            };
          }
          const action = testIds
            .filter((candidate) => actionPattern.test(candidate.dataset.testid ?? ""))
            .at(-1);
          return {
            inputRowId: null,
            actionRowId: actionPattern.exec(action?.dataset.testid ?? "")?.[1] ?? null,
          };
        },
        TID_V4_EDIT,
        TID_V4_EDIT_INPUT,
      );
      if (state.inputRowId) {
        rowId = state.inputRowId;
        return true;
      }
      if (!state.actionRowId) return false;

      const now = Date.now();
      if (lastClickedRowId !== state.actionRowId || now - lastClickedAt >= 500) {
        lastClickedRowId = state.actionRowId;
        lastClickedAt = now;
        await clickTestIdByDom(testId(TID_V4_EDIT, state.actionRowId), {
          timeout: 2000,
          timeoutMsg: `v4 行innerEdit按钮在 projection 收口时消失: rowId=${state.actionRowId}`,
        }).catch(() => undefined);
      }
      return false;
    },
    {
      timeout: 15000,
      timeoutMsg: "v4 latest user edit action 出现后没有进入稳定行内编辑态",
      interval: 100,
    },
  );
  if (!rowId) {
    throw new Error("v4 latest user edit action 没有出现");
  }
  await setInputValueByTestIdDom(testId(TID_V4_EDIT_INPUT, rowId), newText, {
    timeout: 15000,
    timeoutMsg: `v4 行innerEditInput框没有出现: rowId=${rowId}`,
  });
  return rowId;
}

export async function editFirstV4UserQuery(newText: string) {
  const rowId = await beginFirstV4UserQueryEdit(newText);
  await clickTestIdByDom(testId(TID_V4_EDIT_SUBMIT, rowId), {
    timeout: 15000,
    timeoutMsg: `v4 行innerEditSubmit按钮没有出现: rowId=${rowId}`,
  });
  return rowId;
}

export async function clickV4EditWorkspaceReset(rowId: string) {
  await clickTestIdByDom(testId(TID_V4_EDIT_REWIND_WORKSPACE, rowId), {
    timeout: 15000,
    timeoutMsg: `v4 Chat + FileReset按钮没有出现or不可点击: rowId=${rowId}`,
  });
}

export async function waitForV4EditWorkspaceConflict(timeout = 30000) {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (testIdValue) => Boolean(document.querySelector(`[data-testid="${testIdValue}"]`)),
        TID_V4_EDIT_WORKSPACE_CONFLICT_DIALOG,
      ),
    { timeout, timeoutMsg: "v4 edit 文件冲突弹窗没有出现" },
  );
}

export async function clickV4EditConflictConversationOnly() {
  await clickTestIdByDom(TID_V4_EDIT_WORKSPACE_CONFLICT_CONVERSATION_ONLY, {
    timeout: 15000,
    timeoutMsg: "v4 edit 冲突弹窗没有出现仅重置对话按钮",
  });
}

export function getV4CompactMarkers(
  paneId: string = V4_MAIN_PANE_ID,
): Promise<V4CompactMarkerSnapshot[]> {
  return browser.execute(
    (paneTestId, rowPrefix) => {
      const pane = document.querySelector<HTMLElement>(`[data-testid="${paneTestId}"]`);
      return Array.from(
        pane?.querySelectorAll<HTMLElement>(
          `[data-testid^="${rowPrefix}-"][data-row-kind="timelineMarker"][data-marker-type="compact"]`,
        ) ?? [],
      ).map((row) => {
        const rowId = row.dataset.rowId ? Number(row.dataset.rowId) : Number.NaN;
        return {
          origin: row.dataset.origin ?? null,
          rowId: Number.isFinite(rowId) ? rowId : null,
          status: row.dataset.status ?? null,
          text: row.innerText.trim(),
        };
      });
    },
    testId(TID_V4_SESSION_PANE, paneId),
    TID_V4_ROW,
  );
}

export async function waitForV4CompactMarker(
  expected: { status: string; origin: "manual" | "auto" },
  timeout = 90000,
) {
  await browser.waitUntil(
    async () =>
      (await getV4CompactMarkers()).some(
        (marker) => marker.status === expected.status && marker.origin === expected.origin,
      ),
    {
      timeout,
      timeoutMsg: `v4 compact marker 未达到 ${expected.origin}/${expected.status}`,
    },
  );
}

export function getV4SessionTitle(): Promise<string | null> {
  return browser.execute((titleTestId) => {
    const el = document.querySelector<HTMLElement>(`[data-testid="${titleTestId}"]`);
    return el?.getAttribute("data-title") ?? null;
  }, TID_V4_SESSION_TITLE);
}

export async function renameV4Session(title: string) {
  await setInputValueByTestIdDom(TID_V4_RENAME_INPUT, title, {
    timeout: 15000,
    timeoutMsg: "v4 重命名输入框没有出现",
  });
  await clickTestIdByDom(TID_V4_RENAME_SUBMIT, {
    timeout: 15000,
    timeoutMsg: "v4 重命名提交按钮没有出现",
  });
}

export function getV4InputControlState(): Promise<{
  autoDrain: string | null;
  followupMode: string | null;
}> {
  return browser.execute(
    (autoDrainTestId, followupTestId) => {
      const autoBtn = document.querySelector<HTMLElement>(`[data-testid="${autoDrainTestId}"]`);
      const followupBtn = document.querySelector<HTMLElement>(`[data-testid="${followupTestId}"]`);
      return {
        autoDrain: autoBtn?.getAttribute("data-auto-drain") ?? null,
        followupMode: followupBtn?.getAttribute("data-followup-mode") ?? null,
      };
    },
    TID_V4_AUTODRAIN_TOGGLE,
    TID_V4_FOLLOWUP_TOGGLE,
  );
}

export async function clickV4AutoDrainToggle() {
  return clickTestIdByDom(TID_V4_AUTODRAIN_TOGGLE, {
    timeout: 15000,
    timeoutMsg: "v4 autoDrain 开关没有出现",
  });
}

export async function clickV4FollowupToggle() {
  return clickTestIdByDom(TID_V4_FOLLOWUP_TOGGLE, {
    timeout: 15000,
    timeoutMsg: "v4 followupMode 开关没有出现",
  });
}

export async function dragV4QueueItemOnto(sourceQueueItemId: string, targetQueueItemId: string) {
  const positions = (await browser.execute(
    (sourceId, targetId) => {
      const dragHandle = Array.from(
        document.querySelectorAll<HTMLElement>('[data-v4-queue-drag-handle="true"]'),
      ).find((el) => el.getAttribute("data-queue-item-id") === sourceId);
      const targetItem = Array.from(
        document.querySelectorAll<HTMLElement>("li[data-queue-item-id]"),
      ).find((el) => el.getAttribute("data-queue-item-id") === targetId);

      if (!dragHandle || !targetItem) {
        return {
          ok: false,
          reason: "missing-element",
          hasDragHandle: Boolean(dragHandle),
          hasTargetItem: Boolean(targetItem),
        };
      }

      const dragRect = dragHandle.getBoundingClientRect();
      const targetRect = targetItem.getBoundingClientRect();
      return {
        ok: true,
        startX: Math.round(dragRect.left + dragRect.width / 2),
        startY: Math.round(dragRect.top + dragRect.height / 2),
        endX: Math.round(targetRect.left + targetRect.width / 2),
        endY: Math.round(targetRect.top + targetRect.height / 2),
      };
    },
    sourceQueueItemId,
    targetQueueItemId,
  )) as
    | { ok: true; startX: number; startY: number; endX: number; endY: number }
    | {
        ok: false;
        reason: string;
        hasDragHandle: boolean;
        hasTargetItem: boolean;
      };

  if (!positions.ok) {
    throw new Error(`v4 Queue项拖拽元素不存在: ${JSON.stringify(positions)}`);
  }

  await browser.performActions([
    {
      id: "v4-queue-drag-pointer",
      type: "pointer",
      parameters: { pointerType: "mouse" },
      actions: [
        {
          type: "pointerMove",
          duration: 0,
          x: positions.startX,
          y: positions.startY,
        },
        { type: "pointerDown", button: 0 },
        { type: "pause", duration: 80 },
        {
          type: "pointerMove",
          duration: 120,
          x: positions.startX,
          y: positions.startY - 10,
        },
        {
          type: "pointerMove",
          duration: 260,
          x: positions.endX,
          y: positions.endY,
        },
        { type: "pointerUp", button: 0 },
      ],
    },
  ]);
  await browser.releaseActions();

  await browser.execute(() => {
    document.body.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    );
  });
  await browser.pause(50);
}

export interface V4TimelineScrollState {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  
  windowRowCount: number;
  
  renderUnitCount: number;
  
  totalRowCount: number;
  
  following: string | null;
  
  mountedRenderUnitCount: number;
  
  hasBackToBottom: boolean;
}

export function getV4TimelineScrollState(): Promise<V4TimelineScrollState> {
  return browser.execute(
    (timelineTestId, bottomTestId) => {
      const timeline = document.querySelector<HTMLElement>(`[data-testid="${timelineTestId}"]`);
      return {
        scrollTop: timeline?.scrollTop ?? 0,
        scrollHeight: timeline?.scrollHeight ?? 0,
        clientHeight: timeline?.clientHeight ?? 0,
        windowRowCount: Number(timeline?.getAttribute("data-window-row-count") ?? 0),
        renderUnitCount: Number(timeline?.getAttribute("data-render-unit-count") ?? 0),
        totalRowCount: Number(timeline?.getAttribute("data-total-row-count") ?? 0),
        following: timeline?.getAttribute("data-following") ?? null,
        mountedRenderUnitCount:
          timeline?.querySelectorAll('[data-v4-turn-unit="true"]').length ?? 0,
        hasBackToBottom: Boolean(document.querySelector(`[data-testid="${bottomTestId}"]`)),
      };
    },
    TID_V4_TIMELINE,
    TID_V4_TIMELINE_BOTTOM,
  );
}

export async function scrollV4TimelineToTop() {
  await browser.execute((timelineTestId) => {
    const timeline = document.querySelector<HTMLElement>(`[data-testid="${timelineTestId}"]`);
    if (!timeline) return;
    timeline.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -600 }),
    );
    timeline.scrollTop = 0;
    timeline.dispatchEvent(new Event("scroll"));
  }, TID_V4_TIMELINE);
  await browser.waitUntil(
    async () =>
      browser.execute(
        (timelineTestId, rowPrefix) => {
          const timeline = document.querySelector<HTMLElement>(`[data-testid="${timelineTestId}"]`);
          if (!timeline) return false;
          const timelineTop = timeline.getBoundingClientRect().top;
          const viewportHeight = timeline.clientHeight;
          return Array.from(
            timeline.querySelectorAll<HTMLElement>(`[data-testid^="${rowPrefix}-"]`),
          ).some((row) => {
            const rect = row.getBoundingClientRect();
            return rect.bottom - timelineTop > 0 && rect.top - timelineTop < viewportHeight;
          });
        },
        TID_V4_TIMELINE,
        TID_V4_ROW,
      ),
    {
      timeout: 15000,
      timeoutMsg: "scrollTop=0 后虚拟化窗口没有对齐到滚动位置（视口内始终没有行）",
    },
  );
}

export async function clickV4TimelineBackToBottom() {
  return clickTestIdByDom(TID_V4_TIMELINE_BOTTOM, {
    timeout: 15000,
    timeoutMsg: "v4 回到底部按钮没有出现",
  });
}

export interface V4TurnNavigatorState {
  centerOffsetPx: number;
  composerLeftGutterPx: number;
  exists: boolean;
  firstItemLeftOffsetPx: number;
  visible: boolean;
  itemCount: number;
  paneWidthPx: number;
  items: Array<{
    active: boolean;
    height: number;
    left: number;
    testId: string;
    top: number;
    turnId: string | null;
    unitIndex: number | null;
    visualColorTone: string | null;
    visualScale: number | null;
    visualTone: string | null;
  }>;
}

export function getV4TurnNavigatorState(): Promise<V4TurnNavigatorState> {
  return browser.execute(
    (navigatorTestId, itemPrefix, timelineTestId, composerTestId, sessionPaneTestId) => {
      const pane = document.querySelector<HTMLElement>(`[data-testid="${sessionPaneTestId}"]`);
      const scope: Document | HTMLElement = pane ?? document;
      const navigator = scope.querySelector<HTMLElement>(`[data-testid="${navigatorTestId}"]`);
      const timeline = scope.querySelector<HTMLElement>(`[data-testid="${timelineTestId}"]`);
      const composer = scope.querySelector<HTMLElement>(`[data-testid="${composerTestId}"]`);
      const style = navigator ? window.getComputedStyle(navigator) : null;
      const rect = navigator?.getBoundingClientRect();
      const timelineRect = timeline?.getBoundingClientRect();
      const composerRect = composer?.getBoundingClientRect();
      const paneRect = pane?.getBoundingClientRect();
      const items = Array.from(
        navigator?.querySelectorAll<HTMLElement>(`[data-testid^="${itemPrefix}-"]`) ?? [],
      ).map((el) => {
        const itemRect = el.getBoundingClientRect();
        return {
          active: el.getAttribute("data-active") === "true",
          height: itemRect.height,
          left: itemRect.left,
          testId: el.dataset.testid ?? "",
          top: itemRect.top,
          turnId: el.getAttribute("data-turn-id"),
          unitIndex:
            el.getAttribute("data-unit-index") === null
              ? null
              : Number(el.getAttribute("data-unit-index")),
          visualColorTone: el.getAttribute("data-visual-color-tone"),
          visualScale:
            el.getAttribute("data-visual-scale") === null
              ? null
              : Number(el.getAttribute("data-visual-scale")),
          visualTone: el.getAttribute("data-visual-tone"),
        };
      });
      const firstItemLeftOffsetPx =
        items[0] && timelineRect ? items[0].left - timelineRect.left : Number.NaN;
      const firstItem = items[0];
      const lastItem = items.at(-1);
      const stackCenter =
        firstItem && lastItem ? (firstItem.top + lastItem.top + lastItem.height) / 2 : Number.NaN;
      const timelineCenter = timelineRect ? timelineRect.top + timelineRect.height / 2 : Number.NaN;
      return {
        centerOffsetPx: stackCenter - timelineCenter,
        composerLeftGutterPx:
          composerRect && timelineRect ? composerRect.left - timelineRect.left : Number.NaN,
        exists: Boolean(navigator),
        firstItemLeftOffsetPx,
        visible: Boolean(
          navigator &&
          style &&
          rect &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0,
        ),
        itemCount: items.length,
        items,
        paneWidthPx: paneRect?.width ?? Number.NaN,
      };
    },
    TID_V4_TURN_NAVIGATOR,
    TID_V4_TURN_NAVIGATOR_ITEM,
    TID_V4_TIMELINE,
    TID_V4_COMPOSER,
    testId(TID_V4_SESSION_PANE, V4_MAIN_PANE_ID),
  );
}

export async function waitForV4TurnNavigator(
  predicate: (state: V4TurnNavigatorState) => boolean,
  timeoutMsg: string,
  timeout = 30000,
) {
  let latest: V4TurnNavigatorState | null = null;
  try {
    await browser.waitUntil(
      async () => {
        latest = await getV4TurnNavigatorState();
        return predicate(latest);
      },
      { timeout, timeoutMsg },
    );
  } catch (error) {
    latest = await getV4TurnNavigatorState();
    throw new Error(`${timeoutMsg}; latest=${JSON.stringify(latest)}`, {
      cause: error,
    });
  }
  return getV4TurnNavigatorState();
}

async function getV4TurnNavigatorItemTestIdByIndex(index: number) {
  const state = await getV4TurnNavigatorState();
  const item = state.items[index];
  if (!item) {
    throw new Error(
      `v4 turn navigator item 不存在: index=${index}; latest=${JSON.stringify(state)}`,
    );
  }
  return item.testId;
}

export async function hoverV4TurnNavigatorItemByIndex(index: number) {
  const itemTestId = await getV4TurnNavigatorItemTestIdByIndex(index);
  const item = $(sel(itemTestId));
  await item.waitForDisplayed({ timeout: 15000 });
  await item.moveTo();
  return itemTestId;
}

export async function focusV4TurnNavigatorItemByIndex(index: number) {
  const itemTestId = await getV4TurnNavigatorItemTestIdByIndex(index);
  await browser.execute((currentTestId) => {
    document.querySelector<HTMLElement>(`[data-testid="${currentTestId}"]`)?.focus();
  }, itemTestId);
  return itemTestId;
}

export async function clickV4TurnNavigatorItemByIndex(index: number) {
  const itemTestId = await getV4TurnNavigatorItemTestIdByIndex(index);
  await browser.execute((currentTestId) => {
    document.querySelector<HTMLButtonElement>(`[data-testid="${currentTestId}"]`)?.click();
  }, itemTestId);
  return itemTestId;
}

export function getV4TurnNavigatorTooltipText(): Promise<string> {
  return browser.execute((tooltipPrefix) => {
    const tooltip = document.querySelector<HTMLElement>(`[data-testid^="${tooltipPrefix}-"]`);
    return (tooltip?.innerText ?? "").replace(/ /g, " ");
  }, TID_V4_TURN_NAVIGATOR_TOOLTIP);
}

export async function waitForV4TurnNavigatorTooltip(
  predicate: (text: string) => boolean,
  timeoutMsg: string,
  timeout = 15000,
) {
  let latest = "";
  try {
    await browser.waitUntil(
      async () => {
        latest = await getV4TurnNavigatorTooltipText();
        return predicate(latest);
      },
      { timeout, timeoutMsg },
    );
  } catch (error) {
    latest = await getV4TurnNavigatorTooltipText();
    throw new Error(`${timeoutMsg}; latest=${JSON.stringify(latest)}`, {
      cause: error,
    });
  }
  return getV4TurnNavigatorTooltipText();
}

export function getV4FocusedPaneId(): Promise<string | null> {
  return browser.execute((shellPrefix) => {
    const focused = document.querySelector<HTMLElement>(
      `[data-testid^="${shellPrefix}-"][data-focused="true"]`,
    );
    return focused?.getAttribute("data-pane-id") ?? null;
  }, TID_V4_PANE_SHELL);
}

export async function selectV4TaskById(sessionId: string, taskListTimeout = 15000) {
  await clickTestIdByDom(testId(TID_TASK_ITEM, sessionId), {
    timeout: taskListTimeout,
    timeoutMsg: `Tasklist没有可点击的 v4 task: ${sessionId}`,
  });
  await waitForV4Pane(
    (snapshot) => snapshot.sessionId === sessionId,
    `点击Sidebar task 后 primary pane 没有切到 ${sessionId}`,
    30000,
    V4_MAIN_PANE_ID,
  );
}

export async function focusV4Pane(paneId: string) {
  const dispatched = await browser.execute(
    (shellTestId) => {
      const shell = document.querySelector<HTMLElement>(`[data-testid="${shellTestId}"]`);
      if (!shell) return false;
      shell.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
      return true;
    },
    testId(TID_V4_PANE_SHELL, paneId),
  );
  if (!dispatched) {
    throw new Error(`focusV4Pane: pane outer壳不存在: ${paneId}`);
  }
  await browser.waitUntil(async () => (await getV4FocusedPaneId()) === paneId, {
    timeout: 15000,
    timeoutMsg: `pane ${paneId} 没有获得焦点`,
  });
}

export async function clickV4StopInPane(paneId: string) {
  const clicked = await browser.execute(
    (shellTestId, stopTestId) => {
      const shell = document.querySelector<HTMLElement>(`[data-testid="${shellTestId}"]`);
      const btn = shell?.querySelector<HTMLButtonElement>(`[data-testid="${stopTestId}"]`);
      btn?.click();
      return Boolean(btn);
    },
    testId(TID_V4_PANE_SHELL, paneId),
    TID_V4_STOP,
  );
  if (!clicked) {
    throw new Error(`pane ${paneId} inner没有可点击的 stop 按钮`);
  }
}

export async function waitForV4PaneById(
  paneId: string,
  predicate: (snapshot: V4PaneSnapshot) => boolean,
  timeoutMsg: string,
  timeout = 30000,
) {
  return waitForV4Pane(predicate, timeoutMsg, timeout, paneId);
}

export async function sendV4PromptInPane(paneId: string, prompt: string) {
  const paneShellTestId = testId(TID_V4_PANE_SHELL, paneId);
  await browser.waitUntil(
    async () =>
      browser.execute(
        (shellTestId, inputTestId, nextValue) => {
          const shell = document.querySelector<HTMLElement>(`[data-testid="${shellTestId}"]`);
          const element = shell?.querySelector<HTMLElement>(`[data-testid="${inputTestId}"]`);
          if (!element) return false;
          const bridge = (
            element as HTMLElement & {
              __cfLexicalInputE2E?: {
                focus: () => void;
                getText: () => string;
                setText: (text: string) => void;
              };
            }
          ).__cfLexicalInputE2E;
          if (!bridge) return false;
          bridge.focus();
          bridge.setText(nextValue);
          return bridge.getText() === nextValue;
        },
        paneShellTestId,
        TID_V4_COMPOSER_INPUT,
        prompt,
      ),
    {
      timeout: 15000,
      timeoutMsg: `pane ${paneId} 的 composer input box did not appearor不可Input`,
    },
  );
  await browser.waitUntil(
    async () =>
      browser.execute(
        (shellTestId, sendTestId) => {
          const shell = document.querySelector<HTMLElement>(`[data-testid="${shellTestId}"]`);
          const button = shell?.querySelector<HTMLButtonElement>(`[data-testid="${sendTestId}"]`);
          if (!button || button.disabled) return false;
          button.click();
          return true;
        },
        paneShellTestId,
        TID_V4_COMPOSER_SEND,
      ),
    {
      timeout: 30000,
      timeoutMsg: `pane ${paneId} 的Send按钮没有变为Available`,
    },
  );
}

export function hasV4PermissionDialog(): Promise<boolean> {
  return browser.execute(() => {
    const normalize = (value: string | null | undefined) => (value ?? "").replace(/ /g, " ").trim();
    return Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]')).some(
      (element) => {
        const label = normalize(element.getAttribute("aria-label"));
        return label === "需要权限" || label === "Permission required";
      },
    );
  });
}

export function hasV4PermissionFeedbackInput(): Promise<boolean> {
  return browser.execute(() =>
    Boolean(
      document.querySelector(
        'textarea[aria-label="拒绝时给模型的可选反馈"],textarea[aria-label="拒绝时给模型的可选反馈"]',
      ),
    ),
  );
}

export async function waitForV4PermissionDialog(timeout = 60000) {
  await browser.waitUntil(hasV4PermissionDialog, { timeout, timeoutMsg: "v4 权限弹窗没有出现" });
}

export interface V4PermissionRuleScope {
  kind: "exact" | "prefix";
  text: string;
}

export async function getV4PermissionRuleScopes(): Promise<V4PermissionRuleScope[]> {
  return browser.execute(() => {
    const normalize = (value: string | null | undefined) => (value ?? "").replace(/ /g, " ").trim();
    const listbox = Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]')).find(
      (element) => {
        const label = normalize(element.getAttribute("aria-label"));
        return label === "需要权限" || label === "Permission required";
      },
    );
    return Array.from(
      listbox?.querySelectorAll<HTMLElement>("[data-permission-rule-scope]") ?? [],
    ).map((element) => ({
      kind: element.getAttribute("data-permission-rule-scope") === "prefix" ? "prefix" : "exact",
      text: normalize(element.innerText),
    }));
  });
}

export interface V4PermissionDockState {
  inDock: boolean;
  composerMounted: boolean;
  composerHidden: boolean;
  interactionBeforeComposer: boolean;
  composerAriaHidden: string | null;
  composerDisplay: string | null;
}

async function readV4PermissionDockState(): Promise<V4PermissionDockState> {
  return browser.execute((composerTestId) => {
    const normalize = (v: string | null | undefined) => (v ?? "").replace(/ /g, " ").trim();
    const listbox = Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]')).find(
      (el) => {
        const label = normalize(el.getAttribute("aria-label"));
        return label === "需要权限" || label === "Permission required";
      },
    );
    const dock = listbox?.closest<HTMLElement>('[data-v4-composer-dock="true"]') ?? null;
    const composer = dock?.querySelector<HTMLElement>(`[data-testid="${composerTestId}"]`) ?? null;
    const composerDisplay = composer ? getComputedStyle(composer).display : null;
    const interactionBeforeComposer = Boolean(
      listbox &&
      composer &&
      listbox.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    return {
      inDock: Boolean(dock),
      composerMounted: Boolean(composer),
      composerHidden:
        composer?.getAttribute("aria-hidden") === "true" && composerDisplay === "none",
      interactionBeforeComposer,
      composerAriaHidden: composer?.getAttribute("aria-hidden") ?? null,
      composerDisplay,
    };
  }, TID_V4_COMPOSER);
}

export async function waitForV4PermissionDialogInComposerDock(timeout = 60000) {
  await waitForV4PermissionDialog(timeout);
  await browser.waitUntil(
    async () => {
      const state = await readV4PermissionDockState();
      return (
        state.inDock &&
        state.composerMounted &&
        state.composerHidden &&
        state.interactionBeforeComposer
      );
    },
    { timeout, timeoutMsg: "v4 权限弹窗没有进入 composer dock 或 composer 未正确隐藏" },
  );
  return readV4PermissionDockState();
}

export async function approveV4Permission(feedback?: string) {
  await waitForV4PermissionDialog();
  if (feedback !== undefined) {
    const input = await $(
      'textarea[aria-label="拒绝时给模型的可选反馈"],textarea[aria-label="拒绝时给模型的可选反馈"]',
    );
    await input.waitForDisplayed({ timeout: 15000 });
    await input.setValue(feedback);
  }
  const confirmFirstOption = () =>
    browser.execute(() => {
      const normalize = (v: string | null | undefined) => (v ?? "").replace(/ /g, " ").trim();
      const listbox = Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]')).find(
        (el) => {
          const label = normalize(el.getAttribute("aria-label"));
          return label === "需要权限" || label === "Permission required";
        },
      );
      const option = listbox?.querySelector<HTMLButtonElement>('button[role="option"]');
      option?.click();
      return Boolean(option);
    });
  await confirmFirstOption();
  const dismissed = await browser
    .waitUntil(
      async () => {
        const stillOpen = await browser.execute(() => {
          const normalize = (v: string | null | undefined) => (v ?? "").replace(/ /g, " ").trim();
          return Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]')).some(
            (el) => {
              const label = normalize(el.getAttribute("aria-label"));
              return label === "需要权限" || label === "Permission required";
            },
          );
        });
        if (stillOpen) {
          await confirmFirstOption();
          return false;
        }
        return true;
      },
      { timeout: 15000, timeoutMsg: "v4 权限弹窗批准后没有关闭" },
    )
    .then(() => true)
    .catch(() => false);
  return dismissed;
}

export async function denyV4PermissionWithFeedback(feedback: string, submitWithEnter = false) {
  await waitForV4PermissionDialog();
  const input = await $(
    'textarea[aria-label="拒绝时给模型的可选反馈"],textarea[aria-label="拒绝时给模型的可选反馈"]',
  );
  await input.waitForDisplayed({ timeout: 15000 });
  await input.setValue(feedback);

  if (!feedback.trim() && !submitWithEnter) {
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[role="option"][data-permission-option-kind^="reject"]')
        ?.focus();
    });
  }
  await browser.waitUntil(
    () =>
      browser.execute((hasFeedback: boolean) => {
        const selectedDeny = document.querySelector(
          '[role="option"][data-permission-option-kind^="reject"][aria-selected="true"]',
        );
        const input = document.querySelector<HTMLTextAreaElement>(
          'textarea[aria-label="拒绝时给模型的可选反馈"],textarea[aria-label="拒绝时给模型的可选反馈"]',
        );
        return hasFeedback
          ? !selectedDeny &&
              document.activeElement === input &&
              input?.parentElement?.classList.contains("bg-selected")
          : Boolean(selectedDeny);
      }, Boolean(feedback.trim())),
    { timeout: 5000, timeoutMsg: "权限反馈行与普通 Deny 的独立选择状态不符合预期" },
  );

  if (submitWithEnter) {
    await input.click();
    await browser.keys("Enter");
  }

  const clicked = submitWithEnter
    ? true
    : await browser.execute(() => {
        const normalize = (v: string | null | undefined) => (v ?? "").replace(/ /g, " ").trim();
        const listbox = Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]')).find(
          (el) => {
            const label = normalize(el.getAttribute("aria-label"));
            return label === "需要权限" || label === "Permission required";
          },
        );
        const confirmButton = listbox
          ?.closest('[data-v4-composer-dock="true"]')
          ?.querySelector<HTMLButtonElement>(
            'button[aria-label="确认"],button[aria-label="确认"]',
          );
        confirmButton?.click();
        return Boolean(confirmButton);
      });
  if (!clicked) return false;

  return browser
    .waitUntil(async () => !(await hasV4PermissionDialog()), {
      timeout: 15000,
      timeoutMsg: "v4 权限弹窗拒绝后没有关闭",
    })
    .then(() => true)
    .catch(() => false);
}

export async function approveV4PermissionAlways() {
  await waitForV4PermissionDialog();
  const confirmAlwaysOption = () =>
    browser.execute(() => {
      const normalize = (value: string | null | undefined) =>
        (value ?? "").replace(/ /g, " ").trim();
      const listbox = Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]')).find(
        (element) => {
          const label = normalize(element.getAttribute("aria-label"));
          return label === "需要权限" || label === "Permission required";
        },
      );
      const option = Array.from(
        listbox?.querySelectorAll<HTMLButtonElement>('button[role="option"]') ?? [],
      ).find((button) => button.dataset.permissionOptionKind === "allowAlways");
      option?.click();
      return Boolean(option);
    });

  if (!(await confirmAlwaysOption())) return false;
  return browser
    .waitUntil(
      async () => {
        const stillOpen = await hasV4PermissionDialog();
        if (stillOpen) {
          await confirmAlwaysOption();
          return false;
        }
        return true;
      },
      { timeout: 15000, timeoutMsg: "v4 项目始终允许后权限弹窗没有关闭" },
    )
    .then(() => true)
    .catch(() => false);
}

export function getV4ComposerText(): Promise<string | null> {
  return browser.execute((inputTestId) => {
    const element = document.querySelector<HTMLElement>(`[data-testid="${inputTestId}"]`);
    const bridge = (
      element as (HTMLElement & { __cfLexicalInputE2E?: { getText: () => string } }) | null
    )?.__cfLexicalInputE2E;
    return bridge ? bridge.getText() : null;
  }, TID_V4_COMPOSER_INPUT);
}

export function isV4ComposerFocused(): Promise<boolean> {
  return browser.execute((inputTestId) => {
    const element = document.querySelector<HTMLElement>(`[data-testid="${inputTestId}"]`);
    return Boolean(element && document.activeElement && element.contains(document.activeElement));
  }, TID_V4_COMPOSER_INPUT);
}

export function getV4ComposerAttachments(): Promise<
  Array<{ text: string; uploadStatus: string | null }>
> {
  return browser.execute(
    (attachmentPrefix) =>
      Array.from(document.querySelectorAll<HTMLElement>(`[data-testid^="${attachmentPrefix}-"]`))
        .filter((element) => element.hasAttribute("data-upload-status"))
        .map((element) => {
          const mediaFilename = element.querySelector<HTMLImageElement>("img[alt]")?.alt.trim();
          return {
            text: mediaFilename || (element.innerText || element.textContent || "").trim(),
            uploadStatus: element.getAttribute("data-upload-status"),
          };
        }),
    TID_V4_ATTACHMENT,
  );
}

export function hasV4SlashPanel(): Promise<boolean> {
  return browser.execute(
    (panelTestId) => Boolean(document.querySelector(`[data-testid="${panelTestId}"]`)),
    TID_PROMPT_SUGGESTION_PANEL,
  );
}

export function getV4SlashOptionIds(): Promise<string[]> {
  return browser.execute((optionPrefix) => {
    return Array.from(
      document.querySelectorAll<HTMLElement>(`[data-testid^="${optionPrefix}-"]`),
    ).map((element) => element.getAttribute("data-option-id") ?? "");
  }, TID_PROMPT_SUGGESTION_OPTION);
}

export async function waitForV4SlashOption(optionId: string, timeout = 15000) {
  await browser.waitUntil(
    async () => (await hasV4SlashPanel()) && (await getV4SlashOptionIds()).includes(optionId),
    {
      timeout,
      timeoutMsg: `slash 面板没有出现候选项: ${optionId}`,
    },
  );
}

export async function clickV4SlashOption(optionId: string) {
  const optionTestId = testId(TID_PROMPT_SUGGESTION_OPTION, optionId);
  let dispatched = false;
  await browser.waitUntil(
    async () => {
      dispatched = await browser.execute(dispatchMouseDownByExactTestId, optionTestId);
      return dispatched;
    },
    {
      timeout: 15000,
      timeoutMsg: `slash 面板候选项不可点击: ${optionId}`,
    },
  );
  return dispatched;
}

export async function switchV4Mode(mode: string) {
  await selectRadixOption(
    TID_CHAT_MODE_SELECT_TRIGGER,
    testId(TID_CHAT_MODE_SELECT_ITEM, mode),
    `v4 Mode选择器没有出现TargetMode项: ${mode}`,
  );
}

export function getV4ConfigProjection(): Promise<{
  mode: string | null;
  planEnabled: boolean;
  usageUsed: number;
  usageMax: number;
}> {
  return browser.execute((modelTestId) => {
    const el = document.querySelector<HTMLElement>(`[data-testid="${modelTestId}"]`);
    return {
      mode: el?.getAttribute("data-mode") ?? null,
      usageUsed: Number(el?.getAttribute("data-usage-used") || 0),
      planEnabled: el?.getAttribute("data-plan-enabled") === "true",
      usageMax: Number(el?.getAttribute("data-usage-max") || 0),
    };
  }, TID_V4_MODEL_CONFIG);
}

export async function waitForV4MentionOptionPrefix(
  prefix: string,
  timeout = 15000,
): Promise<string> {
  let matched: string | undefined;
  await browser.waitUntil(
    async () => {
      if (!(await hasV4SlashPanel())) return false;
      matched = (await getV4SlashOptionIds()).find((id) => id.startsWith(prefix));
      return Boolean(matched);
    },
    {
      timeout,
      timeoutMsg: `mention 面板没有出现以 "${prefix}" 打头的候选项`,
    },
  );
  return matched as string;
}

export async function pasteV4ComposerFileAttachment(
  filename = "e2e-pasted.png",
  options: { base64?: string; mimeType?: string; pngBase64?: string } = {},
): Promise<string> {
  const pasted = await browser.execute(
    (inputTestId, fileName, explicitBase64, explicitPngBase64, explicitMimeType) => {
      const input = document.querySelector<HTMLElement>(`[data-testid="${inputTestId}"]`);
      const editable =
        input?.querySelector<HTMLElement>('[contenteditable="true"]') ??
        (input?.getAttribute("contenteditable") === "true" ? input : null);
      if (!editable) return false;
      const imageBase64 =
        explicitBase64 ??
        explicitPngBase64 ??
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4AWMAAQAABQABNtCI3QAAAABJRU5ErkJggg==";
      const binary = atob(imageBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], fileName, { type: explicitMimeType ?? "image/png" });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const pasteEvent = new ClipboardEvent("paste", {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      });
      editable.focus();
      editable.dispatchEvent(pasteEvent);
      return true;
    },
    TID_V4_COMPOSER_INPUT,
    filename,
    options.base64,
    options.pngBase64,
    options.mimeType,
  );
  if (!pasted) {
    throw new Error("v4 composer 输入框没有出现，无法派发粘贴事件");
  }
  return filename;
}

export function pasteV4ComposerImageAttachment(
  filename = "e2e-pasted.png",
  options: { base64?: string; mimeType?: string; pngBase64?: string } = {},
): Promise<string> {
  return pasteV4ComposerFileAttachment(filename, options);
}

export async function waitForV4RowAttachments(
  timeout = 60000,
  expectedNames: readonly string[] = [],
): Promise<string> {
  let text = "";
  await browser.waitUntil(
    async () => {
      text = await browser.execute((attachmentsPrefix) => {
        const el = document.querySelector<HTMLElement>(`[data-testid^="${attachmentsPrefix}-"]`);
        if (!el) return "";
        const visibleText = (el.innerText ?? "").trim();
        const mediaFilenames = Array.from(el.querySelectorAll<HTMLImageElement>("img[alt]"))
          .map((image) => image.alt.trim())
          .filter(Boolean);
        return [visibleText, ...mediaFilenames].filter(Boolean).join("\n");
      }, TID_V4_ROW_ATTACHMENTS);
      return text.trim().length > 0 && expectedNames.every((name) => text.includes(name));
    },
    { timeout, timeoutMsg: "user 行没有渲染出附件簇（TID_V4_ROW_ATTACHMENTS）" },
  );
  return text;
}
