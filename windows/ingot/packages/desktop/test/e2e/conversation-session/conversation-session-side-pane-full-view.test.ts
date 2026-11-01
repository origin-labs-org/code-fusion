import { join } from "node:path";
import {
  TID_SIDE_PANE_FULL_VIEW_ANSWER_BUBBLE,
  TID_SIDE_PANE_FULL_VIEW_ANSWER_BUBBLE_CLOSE,
  TID_SIDE_PANE_FULL_VIEW_BUBBLE,
  TID_SIDE_PANE_FULL_VIEW_EXPAND,
  TID_SIDE_PANE_FULL_VIEW_HEADER,
  TID_SIDE_PANE_FULL_VIEW_HOST,
  TID_SIDE_PANE_FULL_VIEW_MINIMIZE,
  TID_SIDE_PANE_FULL_VIEW_RUNNING,
  TID_SIDE_PANE_FULL_VIEW_TOGGLE,
  TID_SIDE_PANE_TOGGLE,
  TID_V4_COMPOSER_INPUT,
  TID_V4_COMPOSER_SEND,
  TID_WORKSPACE_HEADER,
} from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../helpers/desktop-app.js";
import {
  prepareV4ConversationE2E,
  selectV4TaskById,
  sendV4Prompt,
  waitForV4AssistantMessageContaining,
  waitForV4Pane,
  waitForV4UserMessageContaining,
} from "../helpers/v4-conversation.js";

const SIDE_FRAME = '[data-workspace-side-frame="true"]';
const HOST = `[data-testid="${TID_SIDE_PANE_FULL_VIEW_HOST}"]`;
const FLOATING_INPUT = `${HOST}[data-side-pane-full-view-host="floating"] [data-testid="${TID_V4_COMPOSER_INPUT}"]`;
const TAB = "[data-side-pane-tab-id]";
const ELICITATION_BODY = '[data-elicitation-dialog-body="true"]';
const RUNNING = `[data-testid="${TID_SIDE_PANE_FULL_VIEW_RUNNING}"]`;
const ANSWER_BUBBLE = `${HOST} [data-testid="${TID_SIDE_PANE_FULL_VIEW_ANSWER_BUBBLE}"]`;
const ANSWER_BUBBLE_OPEN = `${ANSWER_BUBBLE} > button:first-child`;
const STREAM_WORKING_LABEL = `${HOST} [data-testid^="chat-assistant-history-trigger"] > span`;

describe("Side Pane Full View Popover (SPFV provider)", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("SPFV-E2E-007 Send message in popover and persist full view by session", async function () {
    this.timeout(180_000);
    await prepareV4ConversationE2E();
    const runId = Date.now();

    await sendV4Prompt(`E2E_SPFV_FIRST_${runId}: reply briefly.`);
    await waitForV4AssistantMessageContaining("spfv-first-ok");
    const sessionA = (
      await waitForV4Pane(
        (snapshot) => snapshot.sessionId !== null && snapshot.sessionId !== "draft",
        "No real session bound after first message",
      )
    ).sessionId!;
    await ensureSidePaneExpanded();
    await ensureTerminalTab();
    await $(`${SIDE_FRAME} [data-testid="${TID_SIDE_PANE_FULL_VIEW_TOGGLE}"]`).click();
    await waitForHostMode("floating");

    const floatingPrompt = `E2E_SPFV_FLOATING_SEND_${runId}: reply briefly.`;
    await typeIntoFloatingComposer(floatingPrompt);
    await browser.keys("Enter");
    await waitForV4UserMessageContaining(`E2E_SPFV_FLOATING_SEND_${runId}`);
    await waitForV4AssistantMessageContaining("spfv-floating-ok");
    await waitForAnswerBubble("spfv-floating-ok");
    expect(await $(`${ANSWER_BUBBLE_OPEN} svg`).isExisting()).toBe(false);
    expect((await $(ANSWER_BUBBLE_OPEN).getText()).trim()).toBe("spfv-floating-ok");
    const bubbleBottom = await browser.execute(
      (selector) => document.querySelector(selector)?.getBoundingClientRect().bottom ?? -1,
      ANSWER_BUBBLE,
    );
    const hostTop = await browser.execute(
      (selector) => document.querySelector(selector)?.getBoundingClientRect().top ?? -1,
      HOST,
    );
    expect(bubbleBottom).toBeLessThanOrEqual(hostTop);
    await saveThemeScreenshots("spfv-answer-bubble");

    await realKeys(["Control", "k"]);
    await $('[role="dialog"] [cmdk-input]').waitForDisplayed({ timeout: 10_000 });
    await browser.keys("New task");
    await browser.keys("Enter");
    await waitForV4Pane((snapshot) => snapshot.sessionId === "draft", "命令面板新建任务失败");
    await waitForHostMode("normal");
    expect(await $(`[data-testid="${TID_WORKSPACE_HEADER}"]`).isExisting()).toBe(true);

    await selectV4TaskById(sessionA);
    await waitForHostMode("floating");
    await waitForAnswerBubble("spfv-floating-ok");
    await $(ANSWER_BUBBLE_OPEN).click();
    await browser.waitUntil(
      async () =>
        (await $(HOST).getAttribute("data-floating")) === "expanded" &&
        !(await $(ANSWER_BUBBLE).isExisting()),
      { timeout: 5_000, timeoutMsg: "Message stream did not expand and bubble was not cleared after clicking bubble" },
    );
    await waitForHostTransitionsSettled();
    await $(`[data-testid="${TID_SIDE_PANE_FULL_VIEW_EXPAND}"]`).click();
    await browser.waitUntil(
      async () => (await $(HOST).getAttribute("data-floating")) === "collapsed",
      {
        timeout: 5_000,
        timeoutMsg: "收起消息流失败",
      },
    );
    expect(await $(ANSWER_BUBBLE).isExisting()).toBe(false);
  });

  it("SPFV-E2E-008 AskUserQuestion automatically restores popover and displays card when minimized", async function () {
    this.timeout(180_000);
    await waitForHostMode("floating");
    const runId = Date.now();

    await typeIntoFloatingComposer(`E2E_SPFV_ASK_${runId}: ask one question before continuing.`);
    await browser.waitUntil(
      () =>
        browser.execute(
          (hostSelector, sendTestId) =>
            document.querySelector<HTMLButtonElement>(
              `${hostSelector} [data-testid="${sendTestId}"]`,
            )?.disabled === false,
          HOST,
          TID_V4_COMPOSER_SEND,
        ),
      { timeout: 30_000, timeoutMsg: "Popover send button was not enabled after switching back to session" },
    );
    await browser.keys("Enter");
    await waitForV4UserMessageContaining(`E2E_SPFV_ASK_${runId}`);
    await $(RUNNING).waitForDisplayed({ timeout: 10_000 });
    await browser.waitUntil(
      () =>
        browser.execute(
          (inputSelector, labelSelector) => {
            const placeholder =
              document.querySelector(inputSelector)?.getAttribute("aria-placeholder") ?? "";
            const label = [...document.querySelectorAll(labelSelector)].at(-1)?.textContent ?? "";
            return /^(Working for|In progress) /.test(placeholder) && placeholder === label.trim();
          },
          FLOATING_INPUT,
          STREAM_WORKING_LABEL,
        ),
      { timeout: 3_000, timeoutMsg: "Running placeholder text duration did not match streaming message duration" },
    );
    await $(`[data-testid="${TID_SIDE_PANE_FULL_VIEW_MINIMIZE}"]`).click();
    await browser.waitUntil(
      async () =>
        (await $(HOST).getAttribute("data-floating")) === "collapsed" &&
        (await $(`${HOST} ${ELICITATION_BODY}`).isDisplayed()),
      { timeout: 60_000, timeoutMsg: "Q&A request did not restore minimized popover and display card" },
    );
    expect(await $(`[data-testid="${TID_SIDE_PANE_FULL_VIEW_BUBBLE}"]`).isExisting()).toBe(false);

    const option = await $(`${HOST} ${ELICITATION_BODY}`).$("button=Use default");
    if (await option.isExisting()) {
      await option.click();
    }
    await submitElicitation();
    await waitForV4AssistantMessageContaining("spfv-ask-done");
    await browser.waitUntil(async () => !(await $(`${HOST} ${ELICITATION_BODY}`).isExisting()), {
      timeout: 30_000,
      timeoutMsg: "提交回答后问答卡片没有消失",
    });
    await $(FLOATING_INPUT).waitForDisplayed({ timeout: 10_000 });
    await waitForAnswerBubble("spfv-ask-done");
    await $(`[data-testid="${TID_SIDE_PANE_FULL_VIEW_ANSWER_BUBBLE_CLOSE}"]`).click();
    await $(ANSWER_BUBBLE).waitForExist({ reverse: true, timeout: 5_000 });
    expect(await $(HOST).getAttribute("data-floating")).toBe("collapsed");
    await $(FLOATING_INPUT).click();
    await $(`[data-testid="${TID_SIDE_PANE_FULL_VIEW_HEADER}"]`).waitForExist({ timeout: 5_000 });
    await $(RUNNING).waitForExist({ reverse: true, timeout: 30_000 });
  });
});

async function waitForHostTransitionsSettled() {
  await browser.waitUntil(
    () =>
      browser.execute(
        (selector) =>
          (document.querySelector(selector)?.getAnimations() ?? []).every(
            (animation) => animation.playState !== "running",
          ),
        HOST,
      ),
    { timeout: 5_000, timeoutMsg: "完整视图宿主的几何过渡没有结束" },
  );
}

async function waitForAnswerBubble(text: string) {
  await browser.waitUntil(
    async () =>
      (await $(ANSWER_BUBBLE).isDisplayed()) && (await $(ANSWER_BUBBLE).getText()).includes(text),
    { timeout: 15_000, timeoutMsg: `Answer气泡没有Show「${text}」` },
  );
}

async function saveThemeScreenshots(name: string) {
  const artifactDir = process.env.CF_E2E_ARTIFACT_DIR;
  if (!artifactDir) return;
  for (const theme of ["cf-light", "cf-dark"]) {
    await browser.execute((value) => {
      const actions = (
        window as typeof window & { __testActions?: { setTheme(theme: string): void } }
      ).__testActions;
      actions?.setTheme(value);
    }, theme);
    await browser.pause(300);
    await browser.saveScreenshot(join(artifactDir, `${name}-${theme}.png`));
  }
}

async function realKeys(keys: string[]) {
  const isMac = await browser.execute(() => /Mac|iPhone|iPad/.test(navigator.userAgent));
  const mapped = keys.map((key) => (key === "Control" && isMac ? "Command" : key));
  await browser.keys(mapped as never);
}

async function waitForHostMode(mode: "normal" | "conversation" | "floating") {
  await browser.waitUntil(
    async () => (await $(HOST).getAttribute("data-side-pane-full-view-host")) === mode,
    { timeout: 10_000, timeoutMsg: `CompleteView宿主没有进入 ${mode}` },
  );
}

async function typeIntoFloatingComposer(text: string) {
  const input = await $(FLOATING_INPUT);
  await input.waitForDisplayed({ timeout: 10_000 });
  try {
    await input.click();
  } catch (error) {
    const geometry = await browser.execute(
      (hostSelector, inputSelector) => {
        const rect = (selector: string) => {
          const r = document.querySelector(selector)?.getBoundingClientRect();
          return r
            ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]
            : null;
        };
        const host = document.querySelector<HTMLElement>(hostSelector);
        const inputRect = document.querySelector(inputSelector)?.getBoundingClientRect();
        const hit = inputRect
          ? document.elementFromPoint(
              inputRect.left + inputRect.width / 2,
              inputRect.top + inputRect.height / 2,
            )
          : null;
        return {
          host: rect(hostSelector),
          style: host?.getAttribute("style"),
          attrs: [host?.dataset.floating, host?.dataset.headerVisible],
          input: rect(inputSelector),
          hit: `${hit?.tagName}.${(hit?.className?.toString() ?? "").slice(0, 80)}`,
          dialogs: document.querySelectorAll('[role="dialog"]').length,
        };
      },
      HOST,
      FLOATING_INPUT,
    );
    throw new Error(`浮窗Input框不可点击: ${JSON.stringify(geometry)}`, { cause: error });
  }
  await browser.keys(text);
  await browser.waitUntil(async () => (await input.getText()).includes(text.slice(0, 20)), {
    timeout: 5_000,
    timeoutMsg: "No text was entered into popover input box",
  });
}

async function submitElicitation() {
  const clicked = await browser.execute((hostSelector) => {
    const footer = document.querySelector<HTMLElement>(
      `${hostSelector} [data-elicitation-dialog-footer="true"]`,
    );
    const button = Array.from(footer?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
      (candidate) => ["提交", "Submit"].includes((candidate.textContent ?? "").trim()),
    );
    button?.click();
    return Boolean(button);
  }, HOST);
  expect(clicked).toBe(true);
}

async function ensureSidePaneExpanded() {
  const isExpanded = () =>
    browser.execute((frameSelector) => {
      const panel = document.querySelector(frameSelector)?.parentElement;
      return Boolean(
        panel &&
        panel.getBoundingClientRect().width > 100 &&
        getComputedStyle(panel).opacity === "1",
      );
    }, SIDE_FRAME);
  if (await isExpanded()) return;
  const toggle = await $(
    `[data-testid="${TID_WORKSPACE_HEADER}"] [data-testid="${TID_SIDE_PANE_TOGGLE}"]`,
  );
  await toggle.waitForClickable({ timeout: 10_000 });
  await toggle.click();
  await browser.waitUntil(isExpanded, { timeout: 10_000, timeoutMsg: "Side Pane was not actually expanded" });
}

async function ensureTerminalTab() {
  if ((await $$(TAB).length) > 0) return;
  const launcher = await $('[data-side-pane-open-tab-item="terminal"]');
  await launcher.waitForClickable({ timeout: 10_000 });
  await launcher.click();
  await browser.waitUntil(async () => (await $$(TAB).length) === 1, {
    timeout: 10_000,
    timeoutMsg: "Terminal tab was not opened",
  });
}
