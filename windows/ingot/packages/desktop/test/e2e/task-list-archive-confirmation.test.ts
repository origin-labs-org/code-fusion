import {
  TID_VIRTUAL_PROJECT_NEW_TASK,
  TID_CONVERSATION_SECTION,
  TID_TASK_ARCHIVE,
  TID_TASK_ITEM,
  TID_V4_SESSION_PANE,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "./helpers/desktop-app.js";
import {
  E2E_REPLY_TOKEN,
  buildReadonlyToolPrompt,
  ensureReadonlyToolFixtureFile,
} from "./helpers/conversation-session.js";
import { sel } from "./helpers/selectors.js";
import {
  V4_MAIN_PANE_ID,
  getV4PaneSnapshot,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "./helpers/v4-conversation.js";

describe("Task list archive confirmation E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Project view task section archive confirmation does not disappear on press; task leaves task section after a full click", async function () {
    this.timeout(150000);

    await ensureReadonlyToolFixtureFile();
    await prepareV4ConversationE2E();
    await useProjectConversationTaskView();
    await browser.refresh();
    await startConversationTaskDraft();

    const marker = `E2E_FIRST_SEND_TASK_ARCHIVE_CONFIRM_${Date.now()}`;
    await sendV4Prompt(buildReadonlyToolPrompt(marker));
    await waitForV4TimelineContaining(marker);
    await waitForV4TimelineContaining(E2E_REPLY_TOKEN, 90000);
    const completed = await waitForV4Pane(
      (snapshot) =>
        !snapshot.canStop && Boolean(snapshot.sessionId) && snapshot.sessionId !== "draft",
      "Task archive confirmation E2E prerequisite task not completed",
      90000,
    );

    const taskId = completed.sessionId ?? (await getV4PaneSnapshot()).sessionId;
    expect(taskId).toBeTruthy();

    await hoverConversationTaskRow(taskId as string);
    await waitForArchiveButtonState(taskId as string, (state) => state.visible);

    await $(sel(testId(TID_TASK_ARCHIVE, taskId as string))).click();
    await waitForArchiveButtonState(taskId as string, (state) => state.confirming && state.visible);

    await pointerDownArchiveConfirmButton(taskId as string);
    await waitForArchiveButtonState(taskId as string, (state) => state.confirming && state.visible);

    await movePointerAwayFromTaskRow();
    await waitForArchiveButtonState(taskId as string, (state) => state.confirming && state.visible);

    await clickBlankArea();
    await waitForArchiveButtonState(
      taskId as string,
      (state) => !state.confirming && !state.exists,
    );

    await hoverConversationTaskRow(taskId as string);
    await waitForArchiveButtonState(taskId as string, (state) => state.visible);
    await $(sel(testId(TID_TASK_ARCHIVE, taskId as string))).click();
    await waitForArchiveButtonState(taskId as string, (state) => state.confirming && state.visible);
    await $(sel(testId(TID_TASK_ARCHIVE, taskId as string))).click();
    await waitForConversationTaskRowAbsent(taskId as string);
  });
});

async function useProjectConversationTaskView() {
  await browser.execute(() => {
    localStorage.setItem(
      "cf-sidebar-task-preferences",
      JSON.stringify({
        organizeBy: "project",
        sortBy: "updated",
      }),
    );
    localStorage.setItem(
      "cf-sidebar-purpose-section-preferences",
      JSON.stringify({
        projectsExpanded: true,
        conversationsExpanded: true,
        sectionOrder: ["projects", "conversations"],
      }),
    );
  });
}

async function startConversationTaskDraft() {
  await browser.waitUntil(
    async () =>
      browser.execute((testIdValue) => {
        const button = document.querySelector<HTMLButtonElement>(`[data-testid="${testIdValue}"]`);
        return Boolean(button && !button.disabled);
      }, TID_VIRTUAL_PROJECT_NEW_TASK),
    {
      timeout: 15000,
      timeoutMsg: "Usable \"New Task\" button did not appear after project task section hydrated",
    },
  );

  const clicked = await browser.execute((testIdValue) => {
    const button = document.querySelector<HTMLElement>(`[data-testid="${testIdValue}"]`);
    button?.click();
    return Boolean(button);
  }, TID_VIRTUAL_PROJECT_NEW_TASK);
  expect(clicked).toBe(true);
  await waitForV4Pane(
    (snapshot) => snapshot.sessionId === "draft",
    "Did not enter conversation draft after clicking the \"Tasks\" section new button",
  );
}

interface ArchiveButtonState {
  ariaLabel: string | null;
  confirming: boolean;
  display: string | null;
  exists: boolean;
  text: string;
  visible: boolean;
}

async function hoverConversationTaskRow(taskId: string) {
  const row = await $(`${sel(TID_CONVERSATION_SECTION)} ${sel(testId(TID_TASK_ITEM, taskId))}`);
  await row.waitForDisplayed({
    timeout: 15000,
    timeoutMsg: `ProjectView的“Task”分区没有ShowTarget conversation task: ${taskId}`,
  });
  await row.moveTo();
}

async function waitForConversationTaskRowAbsent(taskId: string) {
  const row = await $(`${sel(TID_CONVERSATION_SECTION)} ${sel(testId(TID_TASK_ITEM, taskId))}`);
  await row.waitForExist({
    reverse: true,
    timeout: 15000,
    timeoutMsg: `确认Archive后 task 仍留在ProjectView的“Task”分区: ${taskId}`,
  });
}

async function movePointerAwayFromTaskRow() {
  const sessionPane = await $(sel(testId(TID_V4_SESSION_PANE, V4_MAIN_PANE_ID)));
  await sessionPane.waitForDisplayed({
    timeout: 15000,
    timeoutMsg: "v4 conversation main area not displayed; unable to move mouse away from task row",
  });
  await sessionPane.moveTo({ xOffset: 20, yOffset: 20 });
}

async function pointerDownArchiveConfirmButton(taskId: string) {
  const dispatched = await browser.execute(
    (archiveTestId) => {
      const button = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
        (element) =>
          element.dataset.testid === archiveTestId &&
          element.closest("[data-archive-confirming-task-id]"),
      );
      if (!button) {
        return false;
      }

      button.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          composed: true,
          pointerId: 1,
          pointerType: "mouse",
        }),
      );
      return true;
    },
    testId(TID_TASK_ARCHIVE, taskId),
  );
  expect(dispatched).toBe(true);
}

async function clickBlankArea() {
  await browser.execute(() => {
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        pointerType: "mouse",
      }),
    );
    document.body.click();
  });
}

async function waitForArchiveButtonState(
  taskId: string,
  predicate: (state: ArchiveButtonState) => boolean,
) {
  await browser.waitUntil(async () => predicate(await getArchiveButtonState(taskId)), {
    timeout: 10000,
    timeoutMsg: `Archive按钮Status没有达到预期: ${JSON.stringify(await getArchiveButtonState(taskId))}`,
  });
}

async function getArchiveButtonState(taskId: string): Promise<ArchiveButtonState> {
  return browser.execute(
    (archiveTestId) => {
      const button = document.querySelector<HTMLElement>(`[data-testid="${archiveTestId}"]`);
      if (!button) {
        return {
          ariaLabel: null,
          confirming: Boolean(document.querySelector("[data-archive-confirming-task-id]")),
          display: null,
          exists: false,
          text: "",
          visible: false,
        };
      }

      const style = window.getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      return {
        ariaLabel: button.getAttribute("aria-label"),
        confirming: Boolean(button.closest("[data-archive-confirming-task-id]")),
        display: style.display,
        exists: true,
        text: button.textContent?.trim() ?? "",
        visible:
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0,
      };
    },
    testId(TID_TASK_ARCHIVE, taskId),
  );
}
