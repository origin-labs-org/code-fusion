import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { TID_CHAT_SUMMARY_PANEL, TID_V4_COMPOSER_INPUT } from "@origin-ai/cf-shared/test-ids";
import { clearAppData, setInputValueByTestIdDom } from "../../../helpers/desktop-app.js";
import {
  getUpstreamRequestRecordCount,
  waitForUpstreamRequest,
} from "../../../helpers/conversation-session-network.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  prepareSSHLifecycle,
  type SSHLifecycleProvider,
} from "../../../helpers/ssh-remote-lifecycle.js";
import { readRemoteTabSnapshot, runSSHCommand } from "../../../helpers/ssh-remote-p0.js";
import {
  clickV4Send,
  getV4ConversationState,
  getV4GoalProjection,
  getV4Messages,
  sendV4PromptAndWaitAccepted,
  waitForV4AssistantMessageContaining,
  waitForV4CompactMarker,
  waitForV4ConversationState,
  waitForV4Pane,
} from "../../../helpers/v4-conversation.js";

const CASE_MARKER = "E2E_R3_COMPACT_GOAL";
const artifactDir = resolve(process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-compact-goal");

async function clickGoalAction(action: "pause" | "resume"): Promise<boolean> {
  await browser.waitUntil(
    () =>
      browser.execute((panelTestId) => {
        const panel = document.querySelector<HTMLElement>(`[data-testid="${panelTestId}"]`);
        if (!panel) return false;
        if (panel.dataset.state === "collapsed") {
          panel.querySelector<HTMLButtonElement>("button")?.click();
          return false;
        }
        return panel.dataset.state === "expanded";
      }, TID_CHAT_SUMMARY_PANEL),
    { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: goal Status面板没有展开` },
  );
  await browser.waitUntil(
    () =>
      browser.execute(
        (name) =>
          Boolean(
            document.querySelector<HTMLButtonElement>(`[data-goal-action="${name}"]`)?.disabled ===
            false,
          ),
        action,
      ),
    { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: goal ${action} 按钮Unavailable` },
  );
  return browser.execute((name) => {
    const button = document.querySelector<HTMLButtonElement>(`[data-goal-action="${name}"]`);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }, action);
}

describe(`${CASE_MARKER}: 远端 session 的手动 compact 与 goal 暂停/Continue/结束`, () => {
  let provider: SSHLifecycleProvider | null = null;
  const facts: Record<string, unknown> = {};

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "compact-goal.json"), JSON.stringify(facts, null, 2));
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-TASK-05 /compact executed remotely with history replaced by summary, queue not lost in subsequent turns; /goal create → pause → resume → end turn, correct active-work state, no duplicate continuation", async function () {
    this.timeout(30 * 60_000);
    const prepared = await prepareSSHLifecycle(CASE_MARKER, {
      apiType: "anthropic-messages",
      tunnelUsername: "tunnel",
    });
    provider = prepared.provider;
    const [workspaceA] = prepared.config.workspacePaths;
    const taskA = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: prepared.config,
      label: "A",
      provider,
      workspacePath: workspaceA,
    });

    const compactStart = await getUpstreamRequestRecordCount();
    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "/compact", {
      timeout: 15_000,
      timeoutMsg: `${CASE_MARKER}: composer input box did not appear`,
    });
    await clickV4Send();
    await waitForUpstreamRequest(
      { includes: ["CRITICAL: Respond with TEXT ONLY", taskA.firstPrompt] },
      `${CASE_MARKER}: compaction Request没有到达回放`,
      90_000,
      { afterIndex: compactStart - 1 },
    );
    await waitForV4CompactMarker({ origin: "manual", status: "success" }, 120_000);
    await waitForV4ConversationState(
      (s) => s.taskId === taskA.taskId && s.state === "idle",
      `${CASE_MARKER}: compact 后没有回到 idle`,
      60_000,
    );
    const compactRequests = (await getUpstreamRequestRecordCount()) - compactStart;
    facts.compact = { requestsDuringCompact: compactRequests };
    expect(compactRequests).toBeGreaterThanOrEqual(1);
    expect(compactRequests).toBeLessThanOrEqual(3);
    const afterCompactStart = await getUpstreamRequestRecordCount();
    await sendV4PromptAndWaitAccepted(
      `${CASE_MARKER}_AFTER 请Reply`,
      `${CASE_MARKER}_AFTER`,
      `${CASE_MARKER}: compact 后回合未被接受`,
    );
    await waitForUpstreamRequest(
      {
        lastUserMessageIncludes: [`${CASE_MARKER}_AFTER`],
        includes: ["R3_COMPACT_SUMMARY"],
        excludes: [taskA.firstReply],
      },
      `${CASE_MARKER}: compact 后Request没有携带Summaryor仍含RawReply`,
      90_000,
      { afterIndex: afterCompactStart - 1 },
    );
    await waitForV4AssistantMessageContaining("R3_COMPACT_GOAL_REPLY", 90_000);
    await waitForV4ConversationState(
      (s) => s.taskId === taskA.taskId && s.state === "idle",
      `${CASE_MARKER}: compact 后回合没有收口`,
      90_000,
    );
    facts.afterCompactTurnUsesSummary = true;
    const remoteCompact = await runSSHCommand(
      prepared.config,
      'F=$(ls -t ~/.cf/cli/log/*.jsonl | head -n1); grep -c "compact" "$F" || true',
    );
    facts.remoteLogCompactMentions = Number.parseInt(remoteCompact.stdout.trim() || "0", 10);

    const goalStart = await getUpstreamRequestRecordCount();
    await setInputValueByTestIdDom(
      TID_V4_COMPOSER_INPUT,
      `/goal ${CASE_MARKER}_OBJECTIVE Completed远端Target`,
      { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: composer input box did not appear` },
    );
    await clickV4Send();
    await browser.waitUntil(
      async () =>
        ((await getV4GoalProjection())?.objective ?? "").includes(`${CASE_MARKER}_OBJECTIVE`),
      {
        timeout: 60_000,
        timeoutMsg: `${CASE_MARKER}: goal Status面板没有出现 objective`,
      },
    );
    const active = await getV4GoalProjection();
    facts.goalActive = active;
    expect(["active", "verifying"]).toContain(active?.status);
    await waitForUpstreamRequest(
      { includes: [`${CASE_MARKER}_OBJECTIVE`, "Continue working toward the active session goal"] },
      `${CASE_MARKER}: goal continuation Request没有到达回放`,
      90_000,
      { afterIndex: goalStart - 1 },
    );
    await waitForV4Pane(
      (s) => s.canStop,
      `${CASE_MARKER}: goal continuation 没有进入 running`,
      60_000,
    );

    expect(await clickGoalAction("pause")).toBe(true);
    await browser.waitUntil(async () => (await getV4GoalProjection())?.status === "paused", {
      timeout: 30_000,
      timeoutMsg: `${CASE_MARKER}: pause 后Target没有进入 paused`,
    });
    const requestsAtPause = await getUpstreamRequestRecordCount();
    await browser.pause(8_000);
    const pausedState = await getV4ConversationState();
    facts.paused = {
      state: pausedState.state,
      requestsDuringPause: (await getUpstreamRequestRecordCount()) - requestsAtPause,
    };
    expect(facts.paused).toMatchObject({ requestsDuringPause: 0 });

    expect(await clickGoalAction("resume")).toBe(true);
    await browser.waitUntil(
      async () =>
        ["active", "verifying", "verified", "completed"].includes(
          (await getV4GoalProjection())?.status ?? "",
        ),
      { timeout: 60_000, timeoutMsg: `${CASE_MARKER}: resume 后Target没有恢复` },
    );
    facts.resumed = await getV4GoalProjection();
    await waitForUpstreamRequest(
      { includes: [`${CASE_MARKER}_OBJECTIVE`, "Verify whether the active session goal"] },
      `${CASE_MARKER}: goal 恢复后没有产生验证Request`,
      180_000,
      { afterIndex: goalStart - 1 },
    );
    await browser.waitUntil(
      async () => ["verified", "completed"].includes((await getV4GoalProjection())?.status ?? ""),
      { timeout: 60_000, timeoutMsg: `${CASE_MARKER}: verifier Passed后Target没有Completed` },
    );
    await waitForV4ConversationState(
      (s) => s.taskId === taskA.taskId && s.state === "idle",
      `${CASE_MARKER}: goal 回合没有收口`,
      180_000,
    );
    const goalRequestsTotal = (await getUpstreamRequestRecordCount()) - goalStart;
    const finalGoal = await getV4GoalProjection();
    facts.goalEnd = { status: finalGoal?.status ?? null, requestsTotal: goalRequestsTotal };
    expect(goalRequestsTotal).toBeLessThanOrEqual(4);
    const messages = await getV4Messages("user");
    facts.userMessages = messages.map((m) => (m.text ?? "").slice(0, 50));
    expect((await readRemoteTabSnapshot(taskA.identity)).remoteSessionId).toBe(
      taskA.remoteSessionId,
    );
  });
});
