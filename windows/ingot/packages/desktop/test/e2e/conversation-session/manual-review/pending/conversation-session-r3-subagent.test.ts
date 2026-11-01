import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  TID_CHAT_ASSISTANT_HISTORY_TRIGGER,
  TID_TASK_ITEM,
  testId,
  TID_V4_SESSION_PANE,
  TID_V4_RETRY_SUBSCRIBE,
  TID_V4_SUBAGENT_OPEN_SIDE_PANE,
  TID_V4_STOP,
  TID_V4_COMPOSER_INPUT,
  TID_V4_COMPOSER_SEND,
} from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  getUpstreamRequestRecordCount,
  getUpstreamRequestEvidence,
  waitForUpstreamRequest,
} from "../../../helpers/conversation-session-network.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  listRemoteAgentProcesses,
  SSH_LIFECYCLE_MODEL_ID,
  type SSHLifecycleProvider,
} from "../../../helpers/ssh-remote-lifecycle.js";
import {
  seedCustomAnthropicMessagesProvider,
  refreshSeededOpenAIProvidersThroughSettings,
} from "../../../helpers/custom-openai-provider.js";
import {
  createSSHReplayTunnel,
  readHostProcesses,
  readRemoteTabSnapshot,
  readSSHRuntimeConfig,
  runSSHCommand,
} from "../../../helpers/ssh-remote-p0.js";
import {
  approveV4Permission,
  clickV4StopInPane,
  getV4ConfigProjection,
  getV4ConversationState,
  prepareV4ConversationE2E,
  sendV4Prompt,
  sendV4PromptAndWaitAccepted,
  switchV4Mode,
  waitForV4ConversationState,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

const CASE_MARKER = "E2E_R3_SUBAGENT";
const artifactDir = resolve(process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-subagent");
const REMOTE_RELEASE_DIR = "/home/dev/r3-workspace-a/.cf-e2e/r3-subagent";
const REMOTE_RELEASE_FILE = `${REMOTE_RELEASE_DIR}/release-child`;

async function selectFullAccessMode(): Promise<void> {
  await switchV4Mode("yolo");
  await browser.waitUntil(async () => (await getV4ConfigProjection()).mode === "yolo", {
    timeout: 30_000,
    timeoutMsg: `${CASE_MARKER}: composer 没有收敛到 Full access mode`,
  });
}

async function readPanes(): Promise<
  Array<{
    paneTestId: string | null;
    sessionId: string | null;
    canStop: boolean;
    runningSubagentIds: string[];
    projectionSeq: string;
    rowCount: number;
    subscriptionFailed: boolean;
  }>
> {
  return browser.execute(
    (paneTestId, stopTestId, retrySubscribeTestId) =>
      Array.from(document.querySelectorAll<HTMLElement>(`[data-testid^="${paneTestId}"]`)).map(
        (pane) => ({
          paneTestId: pane.getAttribute("data-testid"),
          sessionId: pane.getAttribute("data-session-id"),
          canStop: Boolean(pane.querySelector(`[data-testid="${stopTestId}"]`)),
          runningSubagentIds: (pane.dataset.runningSubagentIds ?? "").split(",").filter(Boolean),
          projectionSeq: pane.dataset.projectionSeq ?? "",
          rowCount: pane.querySelectorAll("[data-row-id]").length,
          subscriptionFailed: Boolean(
            pane.querySelector(`[data-testid="${retrySubscribeTestId}"]`),
          ),
        }),
      ),
    TID_V4_SESSION_PANE,
    TID_V4_STOP,
    TID_V4_RETRY_SUBSCRIBE,
  );
}

describe(`${CASE_MARKER}: 远端 Agent、Workflow actor 与Assisted Chat的Project归属`, () => {
  let provider: SSHLifecycleProvider | null = null;
  const facts: Record<string, unknown> = {};

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "subagent.json"), JSON.stringify(facts, null, 2));
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-TASK-06 Sub-session shares Source with parent task, independent session; open sub-session from Agent row; parent/child state wraps up after parent task stops; workflow actor readable, auxiliary conversation resumable", async function () {
    this.timeout(30 * 60_000);
    expect(await browser.electron.execute(() => process.env.CF_DYNAMIC_WORKFLOW_MODE)).toBe(
      "alwaysOn",
    );
    const prepared = { config: readSSHRuntimeConfig(CASE_MARKER) };
    await prepareV4ConversationE2E({ skipProvider: true });
    expect(await readHostProcesses()).toHaveLength(1);
    const tunnel = await createSSHReplayTunnel(prepared.config, CASE_MARKER, {
      username: "tunnel",
    });
    provider = { id: "", name: "", tunnel };
    Object.assign(
      provider,
      await seedCustomAnthropicMessagesProvider({
        baseURL: `${tunnel.baseURL}/anthropic`,
        modelId: SSH_LIFECYCLE_MODEL_ID,
        providerId: `e2e-ssh-remote-lifecycle-${Date.now()}`,
        providerName: "SSH workflow lifecycle",
      }),
    );
    await seedCustomAnthropicMessagesProvider({
      baseURL: `${provider.tunnel.baseURL}/anthropic`,
      modelId: "GLM-5.3",
      providerId: "e2e-workflow-actors",
      providerName: "Workflow actors",
    });
    await refreshSeededOpenAIProvidersThroughSettings([provider.name, "Workflow actors"]);
    const [workspaceA] = prepared.config.workspacePaths;
    await runSSHCommand(
      prepared.config,
      `rm -rf "${REMOTE_RELEASE_DIR}"; mkdir -p "${REMOTE_RELEASE_DIR}"`,
    );
    const taskA = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: prepared.config,
      label: "A",
      provider,
      workspacePath: workspaceA,
    });
    await selectFullAccessMode();

    const start = await getUpstreamRequestRecordCount();
    await sendV4Prompt(`${CASE_MARKER}_PARENT Start子Task`);
    await waitForUpstreamRequest(
      { lastUserMessageIncludes: [`${CASE_MARKER}_PARENT`] },
      `${CASE_MARKER}: 父回合没有到达回放`,
      90_000,
      { afterIndex: start - 1 },
    );
    await waitForUpstreamRequest(
      { lastUserMessageIncludes: ["R3_SUBAGENT_CHILD_TASK"] },
      `${CASE_MARKER}: Sub-session没有发FromModel request`,
      120_000,
      { afterIndex: start - 1 },
    );
    await waitForUpstreamRequest(
      { lastUserMessageIncludes: ["Async agent launched successfully"] },
      `${CASE_MARKER}: 父回合没有收到Sub-agent Start确认`,
      120_000,
      { afterIndex: start - 1 },
    );
    await waitForV4TimelineContaining("R3_SUBAGENT_PARENT_LAUNCHED", 90_000);
    await waitForV4ConversationState(
      (s) => s.taskId === taskA.taskId && s.state === "idle",
      `${CASE_MARKER}: 父回合没有收口`,
      90_000,
    );

    let childSessionId = "";
    await browser
      .waitUntil(
        async () => {
          const result = await browser.execute(
            (prefix, historyTrigger) => {
              for (const trigger of Array.from(
                document.querySelectorAll<HTMLElement>(`[data-testid^="${historyTrigger}"]`),
              )) {
                if (
                  trigger.getAttribute("aria-expanded") !== "true" &&
                  trigger.getAttribute("data-history-open") !== "true"
                )
                  trigger.click();
              }
              const button = Array.from(
                document.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}"]`),
              ).find((b) => b.getClientRects().length);
              if (!button) return null;
              const id = (button.getAttribute("data-testid") ?? "").slice(prefix.length + 1);
              button.click();
              return id;
            },
            TID_V4_SUBAGENT_OPEN_SIDE_PANE,
            TID_CHAT_ASSISTANT_HISTORY_TRIGGER,
          );
          if (result) childSessionId = result;
          return Boolean(result);
        },
        {
          timeout: 60_000,
          interval: 500,
          timeoutMsg: `${CASE_MARKER}: Agent 行没有出现打开Sub-session入口`,
        },
      )
      .catch(async (error) => {
        facts.agentRowDiagnostics = await browser.execute(() => {
          const pane = document.querySelector<HTMLElement>('[data-testid^="v4-session-pane"]');
          const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-row-id]"));
          return {
            rowCount: rows.length,
            rows: rows.map((row) => ({
              text: row.innerText.replace(/\s+/gu, " ").slice(0, 160),
              testIds: Array.from(row.querySelectorAll<HTMLElement>("[data-testid]"))
                .map((n) => n.dataset.testid ?? "")
                .slice(0, 12),
            })),
            paneTestIds: Array.from(
              new Set(
                Array.from(pane?.querySelectorAll<HTMLElement>("[data-testid]") ?? []).map((n) =>
                  (n.dataset.testid ?? "")
                    .replace(/-\d+$/u, "-N")
                    .replace(/sess_[a-z0-9-]+/u, "sess_X"),
                ),
              ),
            ).slice(0, 80),
            paneText: (pane?.innerText ?? "").replace(/\s+/gu, " ").slice(0, 1200),
            subagentTestIds: Array.from(
              document.querySelectorAll<HTMLElement>(
                "[data-testid*='subagent'], [data-testid*='agent']",
              ),
            ).map((n) => n.dataset.testid ?? ""),
          };
        });
        const remoteLog = await runSSHCommand(
          prepared.config,
          'F=$(ls -t ~/.cf/cli/log/*.jsonl | head -n1); grep -c "\"Agent\"" "$F" || true; grep -o "\"event\": "[a-z_.]*subagent[a-z_.]*"" "$F" | sort | uniq -c | tail -n 8',
        );
        facts.remoteSubagentLog = remoteLog.stdout.trim().split("\n");
        throw error;
      });
    let panes = await readPanes();
    await browser.waitUntil(
      async () => {
        panes = await readPanes();
        return panes.some(
          (pane) =>
            pane.sessionId === childSessionId &&
            pane.projectionSeq !== "" &&
            pane.rowCount > 0 &&
            !pane.subscriptionFailed,
        );
      },
      {
        timeout: 30_000,
        timeoutMsg: `${CASE_MARKER}: Sub-session pane 没有打开: ${JSON.stringify(panes)}`,
      },
    );
    facts.childOpened = { childSessionId, parent: taskA.taskId, panes };
    expect(childSessionId).not.toBe(taskA.taskId);
    expect(childSessionId.startsWith("sess_")).toBe(true);
    const tab = await readRemoteTabSnapshot(taskA.identity);
    expect(tab.remoteSessionId).toBe(taskA.remoteSessionId);
    const allRemoteAgents = await listRemoteAgentProcesses(prepared.config);
    facts.remoteAllAgents = allRemoteAgents.map((agent) => ({
      pid: agent.pid,
      ppid: agent.ppid,
      cwd: agent.cwd,
    }));
    const remoteAgents = allRemoteAgents.filter(
      (agent) => agent.cwd === workspaceA || agent.cwd.startsWith(`${workspaceA} `),
    );
    facts.remoteWorkspaceAgents = remoteAgents.map((agent) => ({ pid: agent.pid, cwd: agent.cwd }));
    expect(allRemoteAgents.length).toBeGreaterThanOrEqual(1);
    expect(allRemoteAgents.length).toBeLessThanOrEqual(2);
    await browser.waitUntil(
      async () => {
        panes = await readPanes();
        return (
          panes
            .find((pane) => pane.sessionId === taskA.taskId)
            ?.runningSubagentIds.includes(childSessionId) ?? false
        );
      },
      { timeout: 30_000, timeoutMsg: `${CASE_MARKER}: 父投影没有跟踪Running的Sub-session` },
    );
    facts.childRunningWhenOpened = true;

    const waitingBash = await runSSHCommand(prepared.config, `pgrep -f "release-child" | wc -l`);
    facts.remoteChildBashWaiting = Number.parseInt(waitingBash.stdout.trim() || "0", 10);

    const parent2Marker = `${CASE_MARKER}_PARENT2`;
    const parent2Start = await getUpstreamRequestRecordCount();
    await sendV4PromptAndWaitAccepted(
      `${parent2Marker} 再等等`,
      parent2Marker,
      `${CASE_MARKER}: 父续发未被接受`,
    );
    await waitForUpstreamRequest(
      { lastUserMessageIncludes: [parent2Marker] },
      `${CASE_MARKER}: 父续发没有execute`,
      60_000,
      { afterIndex: parent2Start - 1 },
    );
    await waitForV4TimelineContaining("R3_SUBAGENT_PARENT2_STREAMING", 60_000);
    await waitForV4Pane(
      (pane) => pane.sessionId === taskA.taskId && pane.canStop,
      `${CASE_MARKER}: 父续发没有可Stop的Runtime`,
      30_000,
    );
    facts.parentBeforeStop = (await getV4ConversationState()).state;
    expect(facts.parentBeforeStop).toBe("streaming");
    await clickV4StopInPane("workspace-main");
    await waitForV4ConversationState(
      (state) => state.taskId === taskA.taskId && state.state === "idle",
      `${CASE_MARKER}: 父 task Stop 后没有收口`,
      60_000,
    );
    await runSSHCommand(prepared.config, `touch "${REMOTE_RELEASE_FILE}"`);
    await browser.waitUntil(
      async () => {
        panes = await readPanes();
        const parent = panes.find((pane) => pane.sessionId === taskA.taskId);
        return Boolean(
          parent && !parent.canStop && !parent.runningSubagentIds.includes(childSessionId),
        );
      },
      { timeout: 90_000, timeoutMsg: `${CASE_MARKER}: 子Task释放后父/子Status没有收口` },
    );
    await waitForV4ConversationState(
      (state) => state.taskId === taskA.taskId && state.state === "idle",
      `${CASE_MARKER}: Background results收口后父Session仍在Run`,
      60_000,
    );
    const afterRelease = await runSSHCommand(prepared.config, `pgrep -f "release-child" | wc -l`);
    facts.afterParentStop = {
      panes,
      parentState: (await getV4ConversationState()).state,
      remoteChildBashWaiting: Number.parseInt(afterRelease.stdout.trim() || "0", 10),
    };
    expect(panes.every((pane) => !pane.canStop)).toBe(true);
    const childPane = $(`[data-session-id="${childSessionId}"]`);
    await browser.waitUntil(
      async () => (await childPane.getText()).includes("R3_SUBAGENT_CHILD_DONE"),
      {
        timeout: 60_000,
        timeoutMsg: `${CASE_MARKER}: Sub-sessionCompleted后Details没有收到Final body`,
      },
    );
    expect(await childPane.$(`[data-testid="${TID_V4_RETRY_SUBSCRIBE}"]`).isExisting()).toBe(false);

    await sendV4Prompt("/workflow E2E_R3_WORKFLOW_START");
    await approveV4Permission();
    await waitForV4TimelineContaining("R3_WORKFLOW_STARTED", 120_000);
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const pill = document.querySelector<HTMLElement>(
            '[data-testid="workflow-agent-pill"][data-agent-open="true"][data-agent-status="done"]',
          );
          if (!pill) return false;
          pill.click();
          return true;
        }),
      { timeout: 120_000, timeoutMsg: "Workflow actor did not complete or has no details entry" },
    );
    let actorSessionId = "";
    await browser.waitUntil(
      async () => {
        const actor = (await readPanes()).find((pane) => pane.sessionId?.startsWith("sess_dwf-"));
        actorSessionId = actor?.sessionId ?? "";
        return Boolean(actor?.projectionSeq && actor.rowCount > 0 && !actor.subscriptionFailed);
      },
      { timeout: 30_000, timeoutMsg: "Remote workflow actor details failed to load" },
    );
    const actorPane = $(`[data-session-id="${actorSessionId}"]`);
    expect(await actorPane.getText()).toContain("R3_WORKFLOW_CHILD_DONE");
    expect(await actorPane.$(`[data-testid="${TID_V4_COMPOSER_INPUT}"]`).isExisting()).toBe(false);
    const actorRequests = await getUpstreamRequestEvidence({
      lastUserMessageIncludes: ["E2E_R3_WORKFLOW_CHILD"],
    });
    expect(
      actorRequests.some(
        (request) => (request.requestJson as { model?: string })?.model === "GLM-5.3",
      ),
    ).toBe(true);
    facts.workflowActor = { actorSessionId, model: "GLM-5.3", panes: await readPanes() };

    await sendV4Prompt("/side E2E_R3_SIDE_CHAT");
    let sideSessionId = "";
    await browser.waitUntil(
      async () => {
        const pane = (await readPanes()).find(
          (entry) =>
            entry.sessionId !== taskA.taskId &&
            entry.sessionId !== childSessionId &&
            entry.sessionId !== actorSessionId &&
            Boolean(entry.projectionSeq) &&
            !entry.subscriptionFailed,
        );
        if (!pane?.paneTestId || !pane.sessionId) return false;
        sideSessionId = pane.sessionId;
        return (await $(`[data-session-id="${sideSessionId}"]`).getText()).includes(
          "R3_SIDE_CHAT_DONE",
        );
      },
      { timeout: 60_000, timeoutMsg: "Remote auxiliary conversation is not open or cannot send" },
    );
    const sidePane = $(`[data-session-id="${sideSessionId}"]`);
    const sideInput = sidePane.$(`[data-testid="${TID_V4_COMPOSER_INPUT}"]`);
    await browser.waitUntil(
      async () => (await sideInput.getAttribute("contenteditable")) === "true",
      { timeout: 15_000, timeoutMsg: "辅助对话输入框不可编辑" },
    );
    await sideInput.click();
    await browser.keys("E2E_R3_SIDE_FOLLOWUP");
    await browser.waitUntil(async () => (await sideInput.getText()) === "E2E_R3_SIDE_FOLLOWUP", {
      timeout: 15_000,
      timeoutMsg: "Resumed auxiliary conversation content did not enter the input field",
    });
    const sideSend = sidePane.$(`[data-testid="${TID_V4_COMPOSER_SEND}"]`);
    await sideSend.waitForClickable();
    await sideSend.click();
    await browser.waitUntil(
      async () =>
        (await $(`[data-session-id="${sideSessionId}"]`).getText()).includes(
          "R3_SIDE_FOLLOWUP_DONE",
        ),
      { timeout: 60_000, timeoutMsg: "Auxiliary conversation continuation not completed" },
    );
    facts.selectionSideChat = { sideSessionId, panes: await readPanes() };
    expect(await $(`[data-testid="${testId(TID_TASK_ITEM, taskA.taskId)}"]`).isExisting()).toBe(
      true,
    );
    for (const hiddenId of [childSessionId, actorSessionId, sideSessionId]) {
      expect(await $(`[data-testid="${testId(TID_TASK_ITEM, hiddenId)}"]`).isExisting()).toBe(
        false,
      );
    }
  });
});
