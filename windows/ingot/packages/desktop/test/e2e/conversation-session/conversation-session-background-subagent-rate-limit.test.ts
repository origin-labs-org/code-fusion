import { TID_V4_SUBAGENT_OPEN_SIDE_PANE } from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../helpers/desktop-app.js";
import { waitForUpstreamRequest } from "../helpers/conversation-session-network.js";
import {
  expandAssistantHistoriesWithContent,
  waitForToolCallBlockByToolCallId,
} from "../helpers/conversation-session-tool.js";
import { getToolCallDiagnostics } from "../helpers/conversation-session-tool-diagnostics.js";
import {
  getV4PaneSnapshot,
  prepareV4ConversationE2E,
  selectV4TaskById,
  sendV4Prompt,
  startNewV4Draft,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";
import {
  beginConversationTelemetryCapture,
  readConversationReportRequests,
  waitForConversationReportInventory,
} from "../helpers/conversation-telemetry-parity-capture.js";

const BG26_TIMEOUT_MS = 240000;
const PARENT_MARKER = "E2E_BACKGROUND_SUBAGENT_RATE_LIMIT_PARENT";
const PARENT_DONE = "E2E_BACKGROUND_SUBAGENT_RATE_LIMIT_PARENT_DONE";
const CHILD_MARKER = "E2E_BACKGROUND_SUBAGENT_RATE_LIMIT_CHILD";
const TOOL_CALL_ID = "toolu_e2e_background_subagent_rate_limit_agent";
const PROVIDER_ERROR =
  "Requests are too frequent. Please reduce your request frequency, wait a short moment, and retry your request. Request id: e2e-background-subagent-rate-limit";

describe("Chat Area Background Subagent 429 Error Display E2E", () => {
  before(async function () {
    this.timeout(BG26_TIMEOUT_MS);
    await prepareV4ConversationE2E();
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("BG26: Raw 429 error entered subagent result, failure hover, and restore snapshot", async function () {
    this.timeout(BG26_TIMEOUT_MS);

    const telemetryCapture = await beginConversationTelemetryCapture();
    const prompt = `${PARENT_MARKER}: launch one background Agent and finish after its failed task notification with ${PARENT_DONE}.`;
    await sendV4Prompt(prompt);
    await waitForV4TimelineContaining(PARENT_MARKER, 60000);
    await waitForToolCallBlockByToolCallId(TOOL_CALL_ID, 60000);

    await waitForUpstreamRequest(
      { lastUserMessageIncludes: [CHILD_MARKER] },
      "Background subagent child request did not reach replay server",
      60000,
    );
    await waitForUpstreamRequest(
      {
        includes: [
          `<tool-use-id>${TOOL_CALL_ID}</tool-use-id>`,
          "<status>failed</status>",
          `<error>${PROVIDER_ERROR}</error>`,
          `failed. ${PROVIDER_ERROR}`,
        ],
      },
      "Background subagent failed notification did not pass through raw provider error",
      90000,
    );
    await waitForV4TimelineContaining(PARENT_DONE, 90000);
    await waitForConversationReportInventory(telemetryCapture, {
      message_completion: 2,
    });
    const reports = await readConversationReportRequests(telemetryCapture);
    expect(
      reports.filter(
        (report) =>
          report.element_name === "agent_step" &&
          (report.event_extra_detail as Record<string, unknown> | undefined)?.agent_role ===
            "background subagent",
      ),
    ).toEqual([
      expect.objectContaining({
        event_extra_detail: expect.objectContaining({
          agent_role: "background subagent",
          tool_name: "Agent",
          status: "fail",
          error_msg: "[redacted]",
          error_type: "TOOL_EXEC_ERROR",
          model_request_count: "0",
          token_usage_scope: "",
          total_tokens: "0",
        }),
      }),
    ]);
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
    const idleSnapshot = await waitForV4Pane(
      (snapshot) =>
        snapshot.sessionId !== null && snapshot.sessionId !== "draft" && !snapshot.canStop,
      "background subagent 429 notification 后父会话没有回到 idle",
      60000,
    );
    if (!idleSnapshot.sessionId || idleSnapshot.sessionId === "draft") {
      throw new Error(`background subagent 429 case Missing taskId: ${JSON.stringify(idleSnapshot)}`);
    }

    const sourceTaskId = idleSnapshot.sessionId;
    await assertFailedAgentSurface("live");

    await startNewV4Draft();
    await selectV4TaskById(sourceTaskId);
    await waitForV4Pane(
      (snapshot) => snapshot.sessionId === sourceTaskId && !snapshot.canStop,
      "Background subagent 429 case did not complete original task snapshot restore after switching back",
      30000,
    );
    await waitForV4TimelineContaining(PARENT_DONE, 60000);

    await assertFailedAgentSurface("restored");
  });
});

async function assertFailedAgentSurface(stage: "live" | "restored") {
  let latestDiagnostics: Awaited<ReturnType<typeof getToolCallDiagnostics>> | null = null;
  try {
    await browser.waitUntil(
      async () => {
        await expandAssistantHistoriesWithContent();
        latestDiagnostics = await getToolCallDiagnostics({
          type: "toolCallId",
          value: TOOL_CALL_ID,
        });
        return latestDiagnostics.matchedBlock?.status === "failed";
      },
      {
        timeout: 30000,
        timeoutMsg: `${stage} Agent 卡没有进入 failed`,
      },
    );
  } catch (error) {
    throw new Error(
      `${stage} Agent 卡没有进入 failed; latest=${JSON.stringify(latestDiagnostics)}`,
      { cause: error },
    );
  }

  const blockSnapshot = await waitForToolCallBlockByToolCallId(TOOL_CALL_ID, 30000);
  const sidePaneAction = await $(`[data-testid="${blockSnapshot.testId}"]`).$(
    `[data-testid^="${TID_V4_SUBAGENT_OPEN_SIDE_PANE}-"]`,
  );
  await sidePaneAction.waitForDisplayed({
    timeout: 10000,
    timeoutMsg: `${stage} Agent 卡没有Right侧 child session 入口`,
  });
  expect(["执行失败", "Failed"].some((label) => blockSnapshot.text.includes(label))).toBe(true);
  const block = await $(`[data-testid="${blockSnapshot.testId}"]`);
  const failedStatus = await block.$('[data-slot="tooltip-trigger"]');
  await failedStatus.waitForDisplayed({
    timeout: 10000,
    timeoutMsg: `${stage} Agent 卡没有Failed tooltip trigger`,
  });
  await hoverFailedAgentStatus(blockSnapshot.testId, stage);
  await $('[data-testid^="v4-session-pane-"]').moveTo({
    xOffset: 20,
    yOffset: 20,
  });

  const current = await getV4PaneSnapshot();
  expect(current.canStop).toBe(false);
}

async function hoverFailedAgentStatus(
  blockTestId: string,
  stage: "live" | "restored",
  attempt = 1,
): Promise<void> {
  const pane = await $('[data-testid^="v4-session-pane-"]');
  await pane.moveTo({ xOffset: 20, yOffset: 20 });
  const currentBlock = await $(`[data-testid="${blockTestId}"]`);
  const currentTrigger = await currentBlock.$('[data-slot="tooltip-trigger"]');
  await currentTrigger.waitForDisplayed({ timeout: 3000 });
  await currentTrigger.moveTo();

  let latestTooltipText: string | null = null;
  const opened = await browser
    .waitUntil(
      async () => {
        latestTooltipText = await browser.execute(() => {
          const visibleTooltip = Array.from(
            document.querySelectorAll<HTMLElement>('[data-slot="tooltip-content"]'),
          ).find((element) => {
            const style = window.getComputedStyle(element);
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              Number(style.opacity || "1") > 0 &&
              element.getClientRects().length > 0
            );
          });
          return visibleTooltip?.innerText ?? null;
        });
        return normalizeText(latestTooltipText ?? "").includes(normalizeText(PROVIDER_ERROR));
      },
      {
        interval: 100,
        timeout: 3000,
        timeoutMsg: `${stage} Execution failed hover 没有Show匹配的可见 tooltip`,
      },
    )
    .then(() => true)
    .catch(() => false);
  if (opened) {
    return;
  }
  if (attempt >= 3) {
    throw new Error(
      `${stage} Execution failed hover 没有Show可见 tooltip; latest=${JSON.stringify(latestTooltipText)}`,
    );
  }
  await hoverFailedAgentStatus(blockTestId, stage, attempt + 1);
}

function normalizeText(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
