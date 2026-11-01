import {
  TID_CHAT_INPUT,
  TID_CHAT_MESSAGES,
  TID_CHAT_REASONING_CONTENT,
  TID_CHAT_REASONING_TRIGGER,
  TID_CHAT_SEND_BUTTON,
  TID_LOGIN_TRIGGER,
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_SIDEBAR_CODING_PLAN_USAGE_BUTTON,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import AppPage from "./pages/app.page.js";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  clickTestIdByDom,
  waitForDefaultWorkspaceReady,
  waitForWorkspaceApp,
} from "./helpers/desktop-app.js";
import {
  UPSTREAM_MODEL,
  UPSTREAM_THOUGHT_LEVEL,
  ensureUpstreamProviderForE2E,
} from "./helpers/upstream-provider.js";
import {
  assertUpstreamRequestCapture,
  assertUpstreamThoughtLevelCapture,
  waitForUpstreamNetworkCapture,
} from "./helpers/upstream-capture.js";
import { sel } from "./helpers/selectors.js";

const PROMPT_RUNNING_ERROR = "a prompt is already running in session";
const MODEL_REQUEST_FAILED_ERROR = "Model request failed";

describe("e2ecase.md 回归", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("设置页再次进入时应自动打开上一次打开的分区", async () => {
    await waitForDefaultWorkspaceReady(30000);

    await openSettingsPage();
    await selectSettingsSection("mcp");
    await expectSettingsSectionActive("mcp");
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
      timeout: 15000,
      timeoutMsg: "设置页返回按钮没有出现",
    });
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30000);

    await openSettingsPage();
    await expectSettingsSectionActive("mcp");
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
      timeout: 15000,
      timeoutMsg: "设置页返回按钮没有出现",
    });
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30000);
  });

  it("Clicking Usage Statistics in workspace avatar menu should open Settings Usage section", async () => {
    await waitForDefaultWorkspaceReady(30000);

    await openUsageStatsFromProfileMenu();
    await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout: 15000 });
    await expectSettingsSectionActive("usage");

    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
      timeout: 15000,
      timeoutMsg: "设置页返回按钮没有出现",
    });
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30000);
  });

  it("Clicking Usage Statistics in Settings avatar menu should stay on Settings Usage section", async () => {
    await waitForDefaultWorkspaceReady(30000);
    await openSettingsPage();
    await selectSettingsSection("general");
    await expectSettingsSectionActive("general");

    await openUsageStatsFromProfileMenu();
    await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout: 15000 });
    await expect($(sel(TID_SETTINGS_PAGE))).toBeDisplayed();
    await expectSettingsSectionActive("usage");

    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
      timeout: 15000,
      timeoutMsg: "设置页返回按钮没有出现",
    });
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30000);
  });

  it.skip("Should allow quick sending of next message and retain input box draft while task is running", async function () {
    this.timeout(120000);

    await ensureUpstreamProviderForE2E();
    await waitForDefaultWorkspaceReady(30000);

    const runId = Date.now();
    const firstPrompt =
      `e2e running first prompt ${runId}. Use brief private reasoning if needed. ` +
      "Reply with ten short numbered lines and end with QUEUE_FIRST_DONE.";
    const draftPrompt = `e2e draft should stay while running ${runId}`;

    await typeChatPrompt(firstPrompt);
    await clickChatSend();
    await waitForComposerText("", "Input box was not cleared after the first message was sent");
    await waitForUserMessageContaining(firstPrompt);

    const workingStatus = await waitForWorkingZeroStatus();
    await assertWorkingStatusPositionStable(workingStatus.top);

    await typeChatPrompt(draftPrompt);
    await waitForComposerText(
      draftPrompt,
      "Draft entered during run did not enter input box",
    );
    await browser.pause(800);
    await waitForComposerText(
      draftPrompt,
      "Input box draft was unexpectedly cleared during run",
    );

    await waitForQueueSendButtonReady();
    await clickChatSend();
    await waitForComposerText("", "Input box was not cleared after queued message was sent");
    await waitForBodyTextContaining(
      draftPrompt,
      "第二条消息没有进入待发送队列或消息列表",
    );
    await assertBodyTextNotContaining(PROMPT_RUNNING_ERROR);
    await assertBodyTextNotContaining(MODEL_REQUEST_FAILED_ERROR);

    await waitForUserMessageContaining(draftPrompt);
    await browser.waitUntil(async () => (await getAssistantMessageCount()) >= 2, {
      timeout: 60000,
      timeoutMsg: "Queued message did not continue generating assistant response after the first round ended",
    });
    await assertBodyTextNotContaining(PROMPT_RUNNING_ERROR);
    await assertBodyTextNotContaining(MODEL_REQUEST_FAILED_ERROR);
  });

  it.skip("Thinking content should play height animation before unmounting DOM when collapsed", async function () {
    this.timeout(90000);

    await ensureUpstreamProviderForE2E();
    await waitForDefaultWorkspaceReady(30000);
    await startNewTask();

    const runId = Date.now();
    const prompt =
      `e2e reasoning collapse ${runId}. Use the configured high thinking depth. ` +
      "After reasoning, reply with exactly REASONING_COLLAPSE_DONE.";
    await typeChatPrompt(prompt);
    await clickChatSend();

    const captureRecord = await waitForUpstreamNetworkCapture(prompt);
    assertUpstreamRequestCapture(captureRecord, {
      expectedText: prompt,
      model: UPSTREAM_MODEL,
    });
    assertUpstreamThoughtLevelCapture(captureRecord, UPSTREAM_THOUGHT_LEVEL);

    await $(sel(TID_CHAT_REASONING_TRIGGER)).waitForClickable({
      timeout: 45000,
      timeoutMsg: "Thinking block trigger was not rendered",
    });
    await $(sel(TID_CHAT_REASONING_TRIGGER)).click();
    await waitForReasoningContentOpen();

    const samples = await monitorReasoningCollapseDuringClick();
    const firstExisting = samples.find((sample) => sample.exists && sample.height !== null);
    const closedSamples = samples.filter(
      (sample) => sample.exists && sample.state === "closed",
    );
    const firstClosed = closedSamples.find((sample) => sample.height !== null);

    if (!firstExisting || !firstClosed) {
      throw new Error(
        `Thinking块Collapse时没有捕获到 closed 动画帧\n${JSON.stringify(samples, null, 2)}`,
      );
    }

    expect(firstExisting.text.trim().length).toBeGreaterThan(0);
    expect(firstClosed.text.trim().length).toBeGreaterThan(0);
    expect(firstExisting.height ?? 0).toBeGreaterThan(0);
    expect(firstClosed.height ?? 0).toBeGreaterThan(0);
    expect(firstClosed.height ?? 0).toBeLessThanOrEqual((firstExisting.height ?? 0) + 2);
    await waitForReasoningContentUnmounted();
  });

  it.skip("goal initial query retains command, title excludes command, and resumed system reminder is not displayed as user message", async function () {
    this.timeout(120000);

    await ensureUpstreamProviderForE2E();
    await waitForDefaultWorkspaceReady(30000);
    await startNewTask();

    const runId = Date.now();
    const objective = `e2e target objective ${runId}`;
    await typeChatPrompt(`/goal ${objective}`);
    await clickChatSend();

    await waitForWorkspaceTitleContaining("target objective");
    await assertWorkspaceTitleNotContaining("/goal");
    await assertVisibleUserMessagesContaining(`/goal ${objective}`);
    await assertVisibleUserMessagesNotContaining("goal-continuation");
    await waitForAssistantMessageCountAtLeast(1);

    await typeChatPrompt("/goal pause");
    await clickChatSend();
    await waitForComposerText("", "Input box was not cleared after goal pause");

    await typeChatPrompt("/goal resume");
    await clickChatSend();
    await waitForAssistantMessageCountAtLeast(2);

    await assertVisibleUserMessagesNotContaining("/goal resume");
    await assertVisibleUserMessagesNotContaining("system-reminder");
    await assertVisibleUserMessagesNotContaining("goal-continuation");
  });
});

async function openSettingsPage() {
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
    timeout: 15000,
    timeoutMsg: "Could not find settings entry button",
  });
  await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout: 15000 });
}

async function openUsageStatsFromProfileMenu() {
  await clickVisibleTestIdByDom(TID_LOGIN_TRIGGER, {
    timeout: 15000,
    timeoutMsg: "No visible avatar menu entry found",
  });
  await clickVisibleTestIdByDom(TID_SIDEBAR_CODING_PLAN_USAGE_BUTTON, {
    timeout: 15000,
    timeoutMsg: "No visible Usage Statistics entry appeared in avatar menu",
  });
}

async function selectSettingsSection(section: string) {
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, section), {
    timeout: 15000,
    timeoutMsg: `Settings页没有出现 ${section} 分区入口`,
  });
}

async function clickVisibleTestIdByDom(
  targetTestId: string,
  {
    timeout = 10000,
    timeoutMsg = `Pages没有可见可点击的 test id: ${targetTestId}`,
  }: { timeout?: number; timeoutMsg?: string } = {},
) {
  let latestReason = "not-started";
  await browser.waitUntil(
    async () => {
      const result = (await browser.execute((testIdValue) => {
        function isVisible(element: HTMLElement) {
          const style = window.getComputedStyle(element);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            Number(style.opacity) === 0
          ) {
            return false;
          }
          if (element.getClientRects().length === 0) {
            return false;
          }
          return !element.closest('[aria-hidden="true"], [hidden]');
        }

        const element = Array.from(
          document.querySelectorAll<HTMLElement>("[data-testid]"),
        ).find((item) => item.dataset.testid === testIdValue && isVisible(item));
        if (!element) {
          return { clicked: false, reason: "missing-visible" };
        }
        const disabled =
          (element instanceof HTMLButtonElement ||
            element instanceof HTMLInputElement ||
            element instanceof HTMLSelectElement ||
            element instanceof HTMLTextAreaElement) &&
          element.disabled;
        if (disabled) {
          return { clicked: false, reason: "disabled" };
        }

        function dispatchE2EActivation(target: HTMLElement) {
          target.focus();
          const pointerEventCtor = window.PointerEvent ?? MouseEvent;
          for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
            const event =
              type.startsWith("pointer") && pointerEventCtor === window.PointerEvent
                ? new PointerEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    pointerId: 1,
                    pointerType: "mouse",
                    isPrimary: true,
                  })
                : new MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                  });
            target.dispatchEvent(event);
          }
        }

        dispatchE2EActivation(element);
        return { clicked: true };
      }, targetTestId)) as { clicked: boolean; reason?: string };
      latestReason = result.reason ?? "clicked";
      return result.clicked;
    },
    {
      timeout,
      timeoutMsg: `${timeoutMsg}: ${latestReason}`,
    },
  );
}

async function expectSettingsSectionActive(section: string) {
  const navItem = $(sel(testId(TID_SETTINGS_SECTION_NAV, section)));
  await browser.waitUntil(async () => (await navItem.getAttribute("aria-current")) === "page", {
    timeout: 15000,
    timeoutMsg: `Settings页没有Auto打开上One次的 ${section} 分区`,
  });
}

async function typeChatPrompt(prompt: string) {
  await AppPage.chatInput.waitForDisplayed({ timeout: 15000 });
  await AppPage.chatInput.click();
  const result = (await browser.executeAsync(
    (inputTestId, text, done) => {
      const input = document.querySelector<HTMLElement>(
        `[data-testid="${inputTestId}"]`,
      );
      if (!input) {
        done({ actual: "", inserted: false, ok: false, reason: "input-missing" });
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
          inserted,
          ok: actual === text.trim(),
        });
      });
    },
    TID_CHAT_INPUT,
    prompt,
  )) as { actual: string; inserted: boolean; ok: boolean; reason?: string };

  if (!result.ok) {
    throw new Error(
      `聊天Input框没有WriteComplete prompt: ${JSON.stringify(result)}`,
    );
  }
}

async function clickChatSend() {
  await AppPage.chatSendButton.waitForClickable({ timeout: 30000 });
  await AppPage.chatSendButton.click();
}

async function startNewTask() {
  await AppPage.taskNewButton.waitForClickable({ timeout: 15000 });
  await AppPage.taskNewButton.click();
  await AppPage.chatInput.waitForDisplayed({ timeout: 15000 });
}

async function waitForQueueSendButtonReady() {
  await browser.waitUntil(
    async () =>
      browser.execute((sendButtonTestId) => {
        const button = document.querySelector<HTMLButtonElement>(
          `[data-testid="${sendButtonTestId}"]`,
        );
        return Boolean(button && !button.disabled);
      }, TID_CHAT_SEND_BUTTON),
    {
      timeout: 30000,
      timeoutMsg: "Usable queue send button did not appear while task was streaming",
    },
  );
}

async function waitForComposerText(expected: string, timeoutMsg: string) {
  await browser.waitUntil(async () => (await getComposerText()) === expected, {
    timeout: 10000,
    timeoutMsg,
  });
}

async function getComposerText() {
  return browser.execute((inputTestId) => {
    const input = document.querySelector<HTMLElement>(
      `[data-testid="${inputTestId}"]`,
    );
    return (input?.innerText || input?.textContent || "")
      .replace(/\u00a0/g, " ")
      .trim();
  }, TID_CHAT_INPUT);
}

async function waitForUserMessageContaining(text: string) {
  await browser.waitUntil(
    async () => {
      const messages = await browser.execute((messagesTestId) => {
        const root = document.querySelector<HTMLElement>(
          `[data-testid="${messagesTestId}"]`,
        );
        return Array.from(root?.querySelectorAll<HTMLElement>(".is-user") ?? [])
          .map((element) => element.innerText)
          .join("\n");
      }, TID_CHAT_MESSAGES);
      return messages.includes(text);
    },
    {
      timeout: 60000,
      timeoutMsg: `聊天记录Medium没有出现User Message: ${text}`,
    },
  );
}

async function getAssistantMessageCount() {
  return AppPage.assistantMessages.length;
}

async function waitForAssistantMessageCountAtLeast(expectedCount: number) {
  await browser.waitUntil(async () => (await getAssistantMessageCount()) >= expectedCount, {
    timeout: 60000,
    timeoutMsg: `assistant ReplyQuantity没有达到 ${expectedCount}`,
  });
}

async function waitForWorkingZeroStatus() {
  let lastBodyText = "";
  await browser.waitUntil(
    async () => {
      const snapshot = await getWorkingStatusSnapshot();
      if (snapshot) {
        return true;
      }
      lastBodyText = await getBodyText();
      return false;
    },
    {
      timeout: 15000,
      timeoutMsg: `\"Working 0s\" status did not appear after sending message，body=${lastBodyText.slice(0, 1000)}`,
    },
  );

  const snapshot = await getWorkingStatusSnapshot();
  if (!snapshot) {
    throw new Error("“Working 0s” status did not appear after sending message");
  }
  return snapshot;
}

async function getWorkingStatusSnapshot() {
  return browser.execute(() => {
    const workingZeroPattern = /In progress\s*0\s*秒|Working for\s*0\s*(s|sec|second)/i;
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(".history-message"),
    );
    const target = candidates.find((element) =>
      workingZeroPattern.test(element.innerText),
    );
    if (!target) {
      return null;
    }
    const rect = target.getBoundingClientRect();
    return {
      text: target.innerText,
      top: rect.top,
    };
  });
}

async function assertWorkingStatusPositionStable(initialTop: number) {
  await browser.pause(350);
  const snapshot = await browser.execute(() => {
    const workingPattern = /In progress\s*\d+\s*秒|Working for\s*\d+\s*(s|sec|second)/i;
    const target = Array.from(
      document.querySelectorAll<HTMLElement>(".history-message"),
    ).find((element) => workingPattern.test(element.innerText));
    if (!target) {
      return null;
    }
    return {
      text: target.innerText,
      top: target.getBoundingClientRect().top,
    };
  });

  if (!snapshot) {
    throw new Error("Working status disappeared during stability check");
  }

  expect(Math.abs(snapshot.top - initialTop)).toBeLessThanOrEqual(2);
}

async function waitForBodyTextContaining(text: string, timeoutMsg: string) {
  await browser.waitUntil(async () => (await getBodyText()).includes(text), {
    timeout: 10000,
    timeoutMsg,
  });
}

async function assertBodyTextNotContaining(text: string) {
  expect(await getBodyText()).not.toContain(text);
}

async function getBodyText() {
  return browser.execute(() => document.body?.innerText ?? "");
}

async function waitForReasoningContentOpen() {
  await browser.waitUntil(
    async () =>
      browser.execute((contentTestId) => {
        const content = document.querySelector<HTMLElement>(
          `[data-testid="${contentTestId}"]`,
        );
        return (
          content?.getAttribute("data-state") === "open" &&
          content.innerText.trim().length > 0
        );
      }, TID_CHAT_REASONING_CONTENT),
    {
      timeout: 15000,
      timeoutMsg: "Thinking content did not maintain open state after expansion",
    },
  );
}

type CollapseSample = {
  elapsedMs: number;
  exists: boolean;
  height: number | null;
  state: string | null;
  text: string;
};

async function monitorReasoningCollapseDuringClick(): Promise<CollapseSample[]> {
  return browser.executeAsync(
    (triggerTestId, contentTestId, done) => {
      const trigger = document.querySelector<HTMLElement>(
        `[data-testid="${triggerTestId}"]`,
      );
      if (!trigger) {
        done([]);
        return;
      }

      const samples: CollapseSample[] = [];
      const startedAt = performance.now();
      const sample = () => {
        const content = document.querySelector<HTMLElement>(
          `[data-testid="${contentTestId}"]`,
        );
        const rect = content?.getBoundingClientRect();
        samples.push({
          elapsedMs: Math.round(performance.now() - startedAt),
          exists: Boolean(content),
          height: rect ? rect.height : null,
          state: content?.getAttribute("data-state") ?? null,
          text: content?.innerText ?? "",
        });

        if (performance.now() - startedAt < 420) {
          requestAnimationFrame(sample);
          return;
        }

        done(samples);
      };

      trigger.click();
      requestAnimationFrame(sample);
    },
    TID_CHAT_REASONING_TRIGGER,
    TID_CHAT_REASONING_CONTENT,
  );
}

async function waitForReasoningContentUnmounted() {
  await browser.waitUntil(
    async () =>
      browser.execute((contentTestId) => {
        return !document.querySelector(`[data-testid="${contentTestId}"]`);
      }, TID_CHAT_REASONING_CONTENT),
    {
      timeout: 5000,
      timeoutMsg: "Thinking content DOM was still not unmounted after collapse animation ended",
    },
  );
}

async function waitForWorkspaceTitleContaining(text: string) {
  await browser.waitUntil(
    async () => (await AppPage.workspaceTitle.getText()).includes(text),
    {
      timeout: 30000,
      timeoutMsg: `TaskTitle没有包含预期Text: ${text}`,
    },
  );
}

async function assertWorkspaceTitleNotContaining(text: string) {
  expect(await AppPage.workspaceTitle.getText()).not.toContain(text);
}

async function assertVisibleUserMessagesNotContaining(text: string) {
  expect(await getVisibleUserMessagesText()).not.toContain(text);
}

async function assertVisibleUserMessagesContaining(text: string) {
  expect(await getVisibleUserMessagesText()).toContain(text);
}

async function getVisibleUserMessagesText() {
  return browser.execute((messagesTestId) => {
    const root = document.querySelector<HTMLElement>(
      `[data-testid="${messagesTestId}"]`,
    );
    return Array.from(root?.querySelectorAll<HTMLElement>(".is-user") ?? [])
      .map((element) => element.innerText)
      .join("\n");
  }, TID_CHAT_MESSAGES);
}
