import {
  TID_V4_EDIT,
  TID_V4_EDIT_INPUT,
  TID_V4_EDIT_SUBMIT,
  TID_V4_ROW,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  setInputValueByTestIdDom,
  waitForDefaultWorkspaceReady,
} from "../../../helpers/desktop-app.js";
import { waitForUpstreamNetworkCapture } from "../../../helpers/upstream-capture.js";
import {
  prepareV4ConversationE2E,
  selectV4TaskById,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

const FAIL_MARKER = "E2E_V4_COLD_FAILED_EDIT_SOURCE";
const RERUN_MARKER = "E2E_V4_COLD_FAILED_EDIT_RERUN";
const RERUN_REPLY = "E2E_V4_COLD_FAILED_EDIT_OK";

describe("PV4-06 cold hydration: edit latest user after failure before first token", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("provider 首 token 前失败 → CLI 重启 cold resume → edit 发送成功", async function () {
    this.timeout(240000);
    await prepareV4ConversationE2E();

    const runId = Date.now();
    const failingPrompt = `${FAIL_MARKER}_${runId}: fail before the first assistant token.`;
    await sendV4Prompt(failingPrompt);
    await waitForV4TimelineContaining(failingPrompt, 30000);

    const failureRequest = await waitForUpstreamNetworkCapture(FAIL_MARKER);
    expect(failureRequest.statusCode).toBe(400);
    const settled = await waitForV4Pane(
      (snapshot) =>
        snapshot.sessionId !== null &&
        snapshot.sessionId !== "draft" &&
        !snapshot.canStop &&
        snapshot.timelineText.includes(FAIL_MARKER),
      "Provider failure before first token did not retain user row and close",
      60000,
    );
    const sessionId = settled.sessionId;
    if (!sessionId || sessionId === "draft") {
      throw new Error(`failure 后没有真实 sessionId: ${JSON.stringify(settled)}`);
    }

    await reloadAppAndRestoreV4Session(sessionId);
    await waitForV4TimelineContaining(FAIL_MARKER, 30000);

    const rowId = await waitForEditableV4Row(FAIL_MARKER);
    await clickTestIdByDom(testId(TID_V4_EDIT, rowId), {
      timeout: 15000,
      timeoutMsg: "Edit button of cold hydrated latest user row is not clickable",
    });
    const rerunPrompt = `${RERUN_MARKER}_${runId}: reply with ${RERUN_REPLY}.`;
    await setInputValueByTestIdDom(testId(TID_V4_EDIT_INPUT, rowId), rerunPrompt, {
      timeout: 15000,
      timeoutMsg: "Cold hydrated user row did not enter edit state",
    });
    await waitForEnabledButton(testId(TID_V4_EDIT_SUBMIT, rowId));
    await clickTestIdByDom(testId(TID_V4_EDIT_SUBMIT, rowId), {
      timeout: 15000,
      timeoutMsg: "Submit button for cold hydrated user edit is not clickable",
    });

    const rerunRequest = await waitForUpstreamNetworkCapture(RERUN_MARKER);
    expect(rerunRequest.statusCode).toBe(200);
    await waitForV4TimelineContaining(RERUN_REPLY, 60000);
    const completed = await waitForV4Pane(
      (snapshot) =>
        !snapshot.canStop &&
        snapshot.timelineText.includes(rerunPrompt) &&
        snapshot.timelineText.includes(RERUN_REPLY) &&
        !snapshot.timelineText.includes(failingPrompt),
      "Cold hydrated user edit sent request but did not complete rerun",
      60000,
    );
    expect(completed.sessionId).toBe(sessionId);
    expect(completed.timelineText).toContain(rerunPrompt);
    expect(completed.timelineText).not.toContain(failingPrompt);
  });
});

async function waitForEditableV4Row(marker: string) {
  let rowId: string | null = null;
  await browser.waitUntil(
    async () => {
      rowId = await browser.execute(
        (expectedMarker, rowPrefix, editPrefix) => {
          const rows = Array.from(
            document.querySelectorAll<HTMLElement>(`[data-testid^="${rowPrefix}-"]`),
          );
          const row = rows.find((candidate) => candidate.innerText.includes(expectedMarker));
          const edit = row?.querySelector<HTMLElement>(`[data-testid^="${editPrefix}-"]`);
          const editTestId = edit?.dataset.testid ?? "";
          return editTestId.startsWith(`${editPrefix}-`)
            ? editTestId.slice(editPrefix.length + 1)
            : null;
        },
        marker,
        TID_V4_ROW,
        TID_V4_EDIT,
      );
      return Boolean(rowId);
    },
    {
      timeout: 30000,
      timeoutMsg: `cold hydrated latest user row 没有权威 canEdit action: ${marker}`,
    },
  );
  if (!rowId) throw new Error(`无法解析 editable v4 rowId: ${marker}`);
  return rowId;
}

async function waitForEnabledButton(buttonTestId: string) {
  await browser.waitUntil(
    async () =>
      browser.execute((currentTestId) => {
        const button = document.querySelector<HTMLButtonElement>(
          `[data-testid="${currentTestId}"]`,
        );
        return Boolean(button && !button.disabled);
      }, buttonTestId),
    {
      timeout: 15000,
      timeoutMsg: `按钮没有变为Available: ${buttonTestId}`,
    },
  );
}

async function reloadAppAndRestoreV4Session(sessionId: string) {
  await browser.reloadSession();
  await waitForRendererAfterReloadSession();
  await waitForDefaultWorkspaceReady(60000);
  await selectV4TaskById(sessionId);
  await waitForV4Pane(
    (snapshot) => snapshot.sessionId === sessionId,
    `CLI cold restart 后没有恢复 session ${sessionId}`,
    60000,
  );
}

async function waitForRendererAfterReloadSession() {
  await browser.waitUntil(
    async () => {
      try {
        const puppeteer = await browser.getPuppeteer();
        const rendererTarget = puppeteer
          .targets()
          .filter((target) => isRendererUrl(target.url()))
          .at(-1);
        const targetId = rendererTarget
          ? ((rendererTarget as unknown as { _targetId?: string })._targetId ?? null)
          : null;
        if (!targetId) return false;
        await browser.switchToWindow(targetId);
        return true;
      } catch {
        return false;
      }
    },
    {
      timeout: 30000,
      interval: 250,
      timeoutMsg: "renderer target not found after CLI cold restart",
    },
  );
}

function isRendererUrl(url: string) {
  try {
    return new URL(url).pathname.endsWith("/renderer/index.html");
  } catch {
    return false;
  }
}
