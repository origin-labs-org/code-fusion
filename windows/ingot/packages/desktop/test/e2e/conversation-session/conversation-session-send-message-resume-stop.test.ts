import { readFile } from "node:fs/promises";
import {
  TID_CHAT_SUMMARY_PANEL,
  TID_V4_BACKGROUND_WORK_CANCEL,
  TID_V4_BACKGROUND_WORK_ITEM,
  TID_V4_SUBAGENT_OPEN_SIDE_PANE,
} from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../helpers/desktop-app.js";
import { waitForToolCallBlockByToolName } from "../helpers/conversation-session-tool.js";
import {
  getUpstreamRequestRecordCount,
  waitForUpstreamRequest,
} from "../helpers/conversation-session-network.js";
import type { E2ENetworkCaptureArtifact } from "../helpers/network-capture-proxy.js";
import { ensureToolCrossProductFullAccessMode } from "../helpers/conversation-session-tool-cross-product.js";
import {
  clickV4BackgroundWorkCancel,
  getV4BackgroundWorks,
  getV4ComposerBackgroundWorkCounts,
  openV4RunningBackgroundWorks,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForLatestV4CommandAck,
  waitForV4AssistantMessageContaining,
  waitForV4ComposerText,
  waitForV4ConversationState,
} from "../helpers/v4-conversation.js";

const PARENT_MARKER = "E2E_SEND_MESSAGE_RESUME_STOP_PARENT";
const FOREGROUND_DONE = "E2E_SEND_MESSAGE_RESUME_STOP_FOREGROUND_DONE";
const FOREGROUND_PARENT_IDLE = "E2E_SEND_MESSAGE_RESUME_STOP_FOREGROUND_PARENT_IDLE";
const RESUME_MARKER = "E2E_SEND_MESSAGE_RESUME_STOP_RESUME";
const CHILD_DONE = "E2E_SEND_MESSAGE_RESUME_STOP_CHILD_DONE";
const STOP_NOTIFICATION_DONE = "E2E_SEND_MESSAGE_RESUME_STOP_NOTIFICATION_DONE";

describe("SendMessage resume Stop", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("SAT12: Foreground subagent resumed by SendMessage displays Stop and can be stopped after completion", async function () {
    this.timeout(240000);

    await prepareV4ConversationE2E();
    await ensureToolCrossProductFullAccessMode();

    const runId = Date.now();
    const parentRunMarker = `${PARENT_MARKER}_${runId}`;
    await sendV4Prompt(
      [
        `${parentRunMarker}: call Agent exactly once with run_in_background false and subagent_type "general-purpose".`,
        `Tell the child to reply with exactly ${FOREGROUND_DONE}_${runId} and do nothing else.`,
        "After that foreground Agent completes, call no more tools and finish this turn.",
      ].join(" "),
    );
    await waitForV4ComposerText("", "Input box was not cleared after foreground Agent initial send");
    await waitForToolCallBlockByToolName("Agent", 90000);
    await waitForV4AssistantMessageContaining(FOREGROUND_PARENT_IDLE, 90000);
    await waitForV4ConversationState(
      (snapshot) => snapshot.state !== "streaming" && !snapshot.stopRequested,
      "Parent turn did not return to idle after foreground Agent completed",
      90000,
    );
    expect((await waitForToolCallBlockByToolName("Agent", 30000)).status).toBe("completed");
    await waitForUpstreamRequest(
      {
        includes: [parentRunMarker, FOREGROUND_DONE, "agentId: agent_"],
        excludes: ["resumed it in the background"],
      },
      "foreground Agent 完成结果没有进入父模型请求",
      90000,
    );

    const foregroundAgentId = await readForegroundAgentId(parentRunMarker);
    const foregroundChildSessionId = await waitForSingleSubagentSummaryChildSessionId(30000);

    const resumeRunMarker = `${RESUME_MARKER}_${runId}`;
    await sendV4Prompt(
      [
        `${resumeRunMarker}: read the agentId from the completed Agent result and call SendMessage exactly once for that same agent.`,
        'Use summary "resume stopped agent for stop check".',
        `Use this exact message verbatim: You MUST invoke the Bash tool with command "sleep 120". Do not send any text before the Bash tool finishes. After it finishes, reply with exactly ${CHILD_DONE}_${runId}.`,
        "After SendMessage returns, call no more tools and finish this turn without waiting for the resumed agent.",
      ].join(" "),
    );
    await waitForV4ComposerText("", "Input box was not cleared after SendMessage resume initial send");
    await waitForToolCallBlockByToolName("SendMessage", 90000);
    await waitForV4ConversationState(
      (snapshot) => snapshot.state !== "streaming" && !snapshot.stopRequested,
      "SendMessage resume 后父 turn 没有回到 idle",
      90000,
    );
    expect((await waitForToolCallBlockByToolName("SendMessage", 30000)).status).toBe("completed");
    expect(await waitForSingleSubagentSummaryChildSessionId(30000)).toBe(
      foregroundChildSessionId,
    );

    await openV4RunningBackgroundWorks(90000);
    const runningWork = await waitForSingleRunningBackgroundWork(30000);
    expect(runningWork.workId).toBe(foregroundAgentId);
    const control = await readRunningSubagentControl(runningWork.workId);
    expect(control).not.toBeNull();
    expect(control?.kind).toBe("agent");
    expect(control?.childSessionId).toBe(foregroundChildSessionId);
    expect(control?.stopVisible).toBe(true);
    expect((await getV4ComposerBackgroundWorkCounts())?.subagentCount).toBe(1);
    expect(await countVisibleSubagentTabs()).toBe(0);

    const requestCountBeforeStop = await getUpstreamRequestRecordCount();
    expect(await clickV4BackgroundWorkCancel(runningWork.workId)).toBe(true);
    const ack = await waitForLatestV4CommandAck("cancelBackgroundWork", 30000);
    expect(ack.status).toBe("accepted");

    await waitForUpstreamRequest(
      {
        includes: [
          PARENT_MARKER,
          "<task-notification>",
          "<tool-use-id>toolu_e2e_send_message_resume_stop_send_message</tool-use-id>",
          "<status>stopped</status>",
        ],
        lastUserMessageIncludes: ["<task-notification>", "<status>stopped</status>"],
      },
      "Stop 后 resumed subagent completion notification 没有进入父模型请求",
      60000,
      { afterIndex: requestCountBeforeStop - 1 },
    );
    await waitForV4AssistantMessageContaining(STOP_NOTIFICATION_DONE, 60000);
    await waitForV4ConversationState(
      (snapshot) => snapshot.state !== "streaming" && !snapshot.stopRequested,
      "Stop completion notification turn 没有回到 idle",
      60000,
    );
    await waitForResumedSubagentStopped(runningWork.workId, 60000);
    expect(await countVisibleSubagentTabs()).toBe(0);
  });
});

async function readForegroundAgentId(runMarker: string): Promise<string> {
  const capturePath = process.env.E2E_PROVIDER_CAPTURE_PATH?.trim();
  if (!capturePath) {
    throw new Error("E2E_PROVIDER_CAPTURE_PATH is not configured; cannot read foreground agentId");
  }
  const artifact = JSON.parse(
    await readFile(capturePath, "utf8"),
  ) as E2ENetworkCaptureArtifact;
  for (const record of artifact.records) {
    const requestText = JSON.stringify(record.requestJson ?? null);
    if (!requestText.includes(runMarker) || !requestText.includes(FOREGROUND_DONE)) continue;
    const agentId = /agentId:\s*(agent_[A-Za-z0-9_-]+)/u.exec(requestText)?.[1];
    if (agentId) return agentId;
  }
  throw new Error(`没有从 foreground Agent tool result Read到 agentId: ${runMarker}`);
}

async function waitForSingleRunningBackgroundWork(
  timeout: number,
): Promise<{ workId: string; status: string | null }> {
  let running: Array<{ workId: string; status: string | null }> = [];
  await browser.waitUntil(
    async () => {
      running = (await getV4BackgroundWorks()).filter((work) => work.status === "running");
      return running.length === 1 && Boolean(running[0]?.workId);
    },
    {
      timeout,
      timeoutMsg: "Did not wait for unique resumed subagent background work",
    },
  );
  return running[0]!;
}

async function waitForSingleSubagentSummaryChildSessionId(timeout: number): Promise<string> {
  let childSessionIds: string[] = [];
  await browser.waitUntil(
    async () => {
      childSessionIds = await browser.execute(
        (prefix) =>
          Array.from(document.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}-"]`)).map(
            (element) => (element.getAttribute("data-testid") ?? "").slice(prefix.length + 1),
          ),
        TID_V4_SUBAGENT_OPEN_SIDE_PANE,
      );
      return childSessionIds.length === 1 && Boolean(childSessionIds[0]);
    },
    {
      timeout,
      timeoutMsg: "Did not wait for unique foreground subagent child identity",
    },
  );
  return childSessionIds[0]!;
}

async function readRunningSubagentControl(workId: string): Promise<{
  kind: string | null;
  childSessionId: string | null;
  stopVisible: boolean;
} | null> {
  return browser.execute(
    (itemPrefix, cancelPrefix, id) => {
      const row = document.querySelector<HTMLElement>(`[data-testid="${itemPrefix}-${id}"]`);
      if (!row) return null;
      const stop = row.querySelector<HTMLElement>(`[data-testid="${cancelPrefix}-${id}"]`);
      return {
        kind: row.dataset.backgroundTaskKind ?? null,
        childSessionId: row.dataset.childSessionId ?? null,
        stopVisible: Boolean(stop && getComputedStyle(stop).display !== "none"),
      };
    },
    TID_V4_BACKGROUND_WORK_ITEM,
    TID_V4_BACKGROUND_WORK_CANCEL,
    workId,
  );
}

async function waitForResumedSubagentStopped(workId: string, timeout: number): Promise<void> {
  await browser.waitUntil(
    async () => {
      const [works, composerCounts, runningAgentCount] = await Promise.all([
        getV4BackgroundWorks(),
        getV4ComposerBackgroundWorkCounts(),
        readStatusPanelRunningAgentCount(),
      ]);
      return (
        !works.some((work) => work.workId === workId) &&
        composerCounts === null &&
        runningAgentCount === 0
      );
    },
    {
      timeout,
      timeoutMsg: "Resumed subagent work, top-right entry, or running row did not close after clicking Stop",
    },
  );
}

async function readStatusPanelRunningAgentCount(): Promise<number> {
  return browser.execute((panelTestId) => {
    const panel = document.querySelector<HTMLElement>(`[data-testid="${panelTestId}"]`);
    return Number(panel?.dataset.runningAgentCount ?? "0");
  }, TID_CHAT_SUMMARY_PANEL);
}

async function countVisibleSubagentTabs(): Promise<number> {
  return browser.execute(
    () => document.querySelectorAll('[data-side-pane-tab-id^="subagent-session:"]').length,
  );
}
