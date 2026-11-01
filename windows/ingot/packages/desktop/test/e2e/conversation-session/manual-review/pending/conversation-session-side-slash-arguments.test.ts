import {
  TID_V4_COMPOSER_INPUT,
  TID_V4_COMPOSER_SEND,
  TID_V4_SESSION_PANE,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  clickV4Stop,
  getV4PaneSnapshot,
  prepareV4ConversationE2E,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

const MAIN_PANE_TEST_ID = testId(TID_V4_SESSION_PANE, "workspace-main");
const PARENT_SEED = "E2E_SLASH_PARENT_SEED";
const PARENT_RUNNING = "E2E_SLASH_PARENT_RUNNING";
const SIDE_IDLE = "E2E_SLASH_SIDE_IDLE";
const BTW_MULTILINE = "E2E_SLASH_BTW_MULTILINE";
const SECOND_SIDE = "E2E_SLASH_SECOND_SIDE";
const SECOND_BTW = "E2E_SLASH_SECOND_BTW";
const RUNNING_CHILD = "E2E_SLASH_RUNNING_CHILD";

interface SelectionSidePane {
  childSessionId: string;
  paneTestId: string;
  tabId: string;
}

describe("/side 与 /btw 参数 E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Combinations of idle/running, both aliases, multiline text, and continuous creation all maintain child isolation", async function () {
    this.timeout(240000);
    await prepareV4ConversationE2E();
    await submitMainCommand(`Reply with exactly ${PARENT_SEED}`);
    await waitForV4TimelineContaining(PARENT_SEED);
    const parent = await waitForV4Pane(
      (snapshot) => snapshot.sessionId !== null && snapshot.sessionId !== "draft",
      "slash argument parent session 没有建立",
    );

    const beforeIdle = await readSelectionSidePanes();
    await submitMainCommand(`/side ${SIDE_IDLE}`);
    const idleSide = await waitForNewSelectionSidePane(beforeIdle);
    await waitForSelectionSidePaneContaining(idleSide.paneTestId, SIDE_IDLE);
    await waitForSelectionSidePaneContaining(idleSide.paneTestId, "upstream-e2e-ok");
    await assertMainTimelineDoesNotContain(`/side ${SIDE_IDLE}`);

    const beforeMultiline = await readSelectionSidePanes();
    await submitMainCommand(`/btw   ${BTW_MULTILINE}\n  second line  `);
    const multilineSide = await waitForNewSelectionSidePane(beforeMultiline);
    await waitForSelectionSidePaneContaining(multilineSide.paneTestId, BTW_MULTILINE);
    await waitForSelectionSidePaneContaining(multilineSide.paneTestId, "second line");
    await assertMainTimelineDoesNotContain(`/btw   ${BTW_MULTILINE}`);

    const beforeSecond = await readSelectionSidePanes();
    await submitMainCommand(`/side ${SECOND_SIDE}`);
    const firstSecondSide = await waitForNewSelectionSidePane(beforeSecond);
    await waitForSelectionSidePaneContaining(firstSecondSide.paneTestId, SECOND_SIDE);
    const beforeSecondBtw = await readSelectionSidePanes();
    await submitMainCommand(`/btw ${SECOND_BTW}`);
    const secondBtw = await waitForNewSelectionSidePane(beforeSecondBtw);
    await activateSelectionSidePane(secondBtw.tabId);
    await waitForSelectionSidePaneContaining(secondBtw.paneTestId, SECOND_BTW);
    expect(new Set([firstSecondSide.childSessionId, secondBtw.childSessionId]).size).toBe(2);

    await submitMainCommand(`Reply with exactly ${PARENT_RUNNING}`);
    await waitForV4Pane(
      (snapshot) => snapshot.canStop && snapshot.sessionId === parent.sessionId,
      "父任务没有进入 running 窗口",
      30000,
    );
    const beforeRunning = await readSelectionSidePanes();
    await submitMainCommand(`/btw ${RUNNING_CHILD}`);
    const runningSide = await waitForNewSelectionSidePane(beforeRunning);
    await waitForSelectionSidePaneContaining(runningSide.paneTestId, RUNNING_CHILD);
    await waitForSelectionSidePaneContaining(runningSide.paneTestId, "upstream-e2e-ok");
    const parentStillRunning = await waitForV4Pane(
      (snapshot) => snapshot.canStop && snapshot.sessionId === parent.sessionId,
      "发送 child 参数后父任务不再 running",
      30000,
    );
    expect(parentStillRunning.timelineText).not.toContain(`/btw ${RUNNING_CHILD}`);
    await clickV4Stop();
    await waitForV4Pane(
      (snapshot) => !snapshot.canStop && snapshot.sessionId === parent.sessionId,
      "清理父任务 running 状态失败",
      30000,
    );
  });
});

async function submitMainCommand(command: string): Promise<void> {
  await setPaneComposerText(MAIN_PANE_TEST_ID, command);
  await clickPaneComposerSend(MAIN_PANE_TEST_ID);
}

async function setPaneComposerText(paneTestId: string, text: string): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (nextPaneTestId, inputTestId, nextText) => {
          const input = document
            .querySelector<HTMLElement>(`[data-testid="${nextPaneTestId}"]`)
            ?.querySelector<HTMLElement>(`[data-testid="${inputTestId}"]`);
          const bridge = (
            input as
              | (HTMLElement & {
                  __cfLexicalInputE2E?: {
                    getText: () => string;
                    setText: (value: string) => void;
                  };
                })
              | undefined
          )?.__cfLexicalInputE2E;
          if (!bridge) return false;
          bridge.setText(nextText);
          return bridge.getText() === nextText;
        },
        paneTestId,
        TID_V4_COMPOSER_INPUT,
        text,
      ),
    { timeout: 15000, timeoutMsg: `composer 不可Input: ${paneTestId}` },
  );
}

async function clickPaneComposerSend(paneTestId: string): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (nextPaneTestId, sendTestId) => {
          const button = document
            .querySelector<HTMLElement>(`[data-testid="${nextPaneTestId}"]`)
            ?.querySelector<HTMLButtonElement>(`[data-testid="${sendTestId}"]`);
          if (!button || button.disabled) return false;
          button.click();
          return true;
        },
        paneTestId,
        TID_V4_COMPOSER_SEND,
      ),
    { timeout: 30000, timeoutMsg: `Send按钮Unavailable: ${paneTestId}` },
  );
}

async function readSelectionSidePanes(): Promise<SelectionSidePane[]> {
  return browser.execute(
    (panePrefix) =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-side-pane-tab-id^="selection-side-chat:"]',
        ),
      ).flatMap((tab) => {
        const tabId = tab.dataset.sidePaneTabId;
        if (!tabId) return [];
        const paneTestId = `${panePrefix}-${tabId}`;
        const childSessionId = document.querySelector<HTMLElement>(
          `[data-testid="${paneTestId}"]`,
        )?.dataset.sessionId;
        return childSessionId ? [{ childSessionId, paneTestId, tabId }] : [];
      }),
    TID_V4_SESSION_PANE,
  );
}

async function waitForNewSelectionSidePane(
  before: SelectionSidePane[],
): Promise<SelectionSidePane> {
  const beforeIds = new Set(before.map((side) => side.childSessionId));
  let result: SelectionSidePane | undefined;
  await browser.waitUntil(
    async () => {
      result = (await readSelectionSidePanes()).find(
        (side) => !beforeIds.has(side.childSessionId),
      );
      return result !== undefined;
    },
    { timeout: 30000, timeoutMsg: "带参数 slash command 没有创建新的 child" },
  );
  if (!result) throw new Error("new selection side pane result missing");
  return result;
}

async function waitForSelectionSidePaneContaining(
  paneTestId: string,
  marker: string,
): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (nextPaneTestId, nextMarker) =>
          document
            .querySelector<HTMLElement>(`[data-testid="${nextPaneTestId}"]`)
            ?.innerText.includes(nextMarker) ?? false,
        paneTestId,
        marker,
      ),
    { timeout: 60000, timeoutMsg: `selection side pane 没有出现 ${marker}` },
  );
}

async function activateSelectionSidePane(tabId: string): Promise<void> {
  const clicked = await browser.execute((nextTabId) => {
    const tab = document.querySelector<HTMLElement>(
      `[data-side-pane-tab-id="${nextTabId}"]`,
    );
    tab?.click();
    return Boolean(tab);
  }, tabId);
  expect(clicked).toBe(true);
}

async function assertMainTimelineDoesNotContain(text: string): Promise<void> {
  const snapshot = await getV4PaneSnapshot();
  expect(snapshot.timelineText).not.toContain(text);
}
