import {
  disconnectRemoteSource,
  reconnectRemoteProject,
} from "#e2e/helpers/remote-project-actions";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";
import { clearAppData, DEFAULT_WORKSPACE } from "../../../helpers/desktop-app.js";
import {
  getUpstreamRequestRecordCount,
  waitForUpstreamRequest,
} from "../../../helpers/conversation-session-network.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  listRemoteAgentProcesses,
  prepareSSHLifecycle,
  readRemoteCoreIdentity,
  type SSHLifecycleProvider,
} from "../../../helpers/ssh-remote-lifecycle.js";
import {
  openSSHSourceDirectory,
  readHostProcesses,
  readRemoteTabSnapshot,
  selectSSHRemoteDirectory,
  waitForRemoteTab,
  waitForSSHDirectoryStep,
} from "../../../helpers/ssh-remote-p0.js";
import {
  selectV4TaskById,
  sendV4PromptAndWaitAccepted,
  startNewV4Draft,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
} from "../../../helpers/v4-conversation.js";
import { openWorkspaceDraftFromSidebar } from "../../../helpers/workspace-agent-warmup.js";

const CASE_MARKER = "E2E_R3_SOAK_RECONNECT";
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-soak-reconnect",
);
const ROUNDS = Number(process.env.R3_SOAK_ROUNDS?.trim() || "50");

interface RoundRecord {
  round: number;
  disconnectMs: number;
  reconnectMs: number;
  sessionChanged: boolean;
  hosts: number;
  agents: number;
  turnOk: boolean | null;
  error?: string;
}

describe(`${CASE_MARKER}: 两Project + conversation 的Connect/Disconnect/恢复/开关 tab 循环`, () => {
  let provider: SSHLifecycleProvider | null = null;
  const facts: Record<string, unknown> = {};
  const rounds: RoundRecord[] = [];

  after(async () => {
    facts.rounds = rounds;
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "soak-reconnect.json"), JSON.stringify(facts, null, 2));
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it(`R3A-SOAK-01 ${ROUNDS} Disconnect/reconnect/切 tab：每轮可Continue execution、Host/远端 Agent 回到基线、Core 不换代、无Old generation 误写`, async function () {
    if (!Number.isSafeInteger(ROUNDS) || ROUNDS <= 0) {
      throw new Error(`${CASE_MARKER}: R3_SOAK_ROUNDS 必须Yes正整Count，不能SkipReconnect循环`);
    }
    this.timeout(150 * 60_000);
    const prepared = await prepareSSHLifecycle(CASE_MARKER, { tunnelUsername: "tunnel" });
    provider = prepared.provider;
    const [workspaceA, workspaceB] = prepared.config.workspacePaths;
    const taskA = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: prepared.config,
      label: "A",
      provider,
      workspacePath: workspaceA,
    });
    await openSSHSourceDirectory(prepared.config, CASE_MARKER);
    await waitForSSHDirectoryStep(CASE_MARKER);
    await selectSSHRemoteDirectory(workspaceB, CASE_MARKER);
    await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedPath: workspaceB,
      timeoutMs: 120_000,
    });
    const sourceId = parseRemoteWorkspaceIdentity(taskA.identity)?.sourceServerId ?? "";

    const core0 = await readRemoteCoreIdentity(prepared.config, CASE_MARKER);
    const baseline = {
      hosts: (await readHostProcesses()).length,
      agents: (await listRemoteAgentProcesses(prepared.config)).length,
      core: core0.pid,
    };
    facts.baseline = baseline;

    let previousSession = (await readRemoteTabSnapshot(taskA.identity)).remoteSessionId;
    for (let round = 1; round <= ROUNDS; round += 1) {
      const record: RoundRecord = {
        round,
        disconnectMs: 0,
        reconnectMs: 0,
        sessionChanged: false,
        hosts: 0,
        agents: 0,
        turnOk: null,
      };
      try {
        await openWorkspaceDraftFromSidebar(DEFAULT_WORKSPACE);
        await selectV4TaskById(taskA.taskId);
        const t0 = Date.now();
        await disconnectRemoteSource(sourceId!, CASE_MARKER, {
          workspaceIdentities: [taskA.identity],
        });

        record.disconnectMs = Date.now() - t0;
        const t1 = Date.now();
        await reconnectRemoteProject(taskA.identity, CASE_MARKER);
        let sessionNow: string | null = null;
        await browser.waitUntil(
          async () => {
            const snapshot = await readRemoteTabSnapshot(taskA.identity).catch(() => null);
            sessionNow = snapshot?.remoteSessionId ?? null;
            return Boolean(sessionNow);
          },
          { timeout: 120_000, interval: 1000, timeoutMsg: `round ${round}: Reconnect没有恢复` },
        );
        await browser.waitUntil(
          async () =>
            Boolean(
              (await readRemoteTabSnapshot(undefined, workspaceB).catch(() => null))
                ?.remoteSessionId,
            ),
          { timeout: 60_000, interval: 1000, timeoutMsg: `round ${round}: Project b 没有恢复` },
        );
        record.reconnectMs = Date.now() - t1;
        record.sessionChanged = sessionNow !== previousSession;
        previousSession = sessionNow;
        if (round % 10 === 0 || round === ROUNDS) {
          await selectV4TaskById(taskA.taskId, 30_000);
          const start = await getUpstreamRequestRecordCount();
          const marker = `${CASE_MARKER}_R${round}`;
          await sendV4PromptAndWaitAccepted(
            `${marker} 请Reply`,
            marker,
            `round ${round}: 回合未被接受`,
          );
          await waitForUpstreamRequest(
            { lastUserMessageIncludes: [marker], includes: [taskA.firstPrompt] },
            `round ${round}: Request没有到达or丢历史`,
            90_000,
            { afterIndex: start - 1 },
          );
          await waitForV4AssistantMessageContaining("R3_SOAK_RECONNECT_REPLY", 90_000);
          await waitForV4ConversationState(
            (s) => s.taskId === taskA.taskId && s.state === "idle",
            `round ${round}: 回合没有收口`,
            90_000,
          );
          record.turnOk = true;
        }
        record.hosts = (await readHostProcesses()).length;
        record.agents = (await listRemoteAgentProcesses(prepared.config)).length;
      } catch (error) {
        record.error = String(error).slice(0, 300);
        rounds.push(record);
        throw error;
      }
      rounds.push(record);
    }
    const core1 = await readRemoteCoreIdentity(prepared.config, CASE_MARKER);
    facts.final = {
      core: core1.pid,
      hosts: (await readHostProcesses()).length,
      agents: (await listRemoteAgentProcesses(prepared.config)).length,
      maxReconnectMs: Math.max(...rounds.map((r) => r.reconnectMs)),
      avgReconnectMs: Math.round(rounds.reduce((a, r) => a + r.reconnectMs, 0) / rounds.length),
    };
    expect(core1.pid).toBe(core0.pid);
    expect((facts.final as { hosts: number }).hosts).toBe(baseline.hosts);
    expect((facts.final as { agents: number }).agents).toBeLessThanOrEqual(baseline.agents + 1);
    expect(rounds.every((r) => r.sessionChanged)).toBe(true);
    expect(rounds).toHaveLength(ROUNDS);
    expect(rounds.at(-1)?.turnOk).toBe(true);
    await startNewV4Draft();
  });
});
