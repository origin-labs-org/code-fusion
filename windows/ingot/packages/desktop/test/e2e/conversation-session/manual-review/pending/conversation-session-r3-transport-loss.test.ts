import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { waitForPermissionInteractionId } from "#e2e/helpers/permission-interaction-id";
import { readRemoteToolExecutionEvents } from "#e2e/helpers/remote-tool-execution-evidence";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  getUpstreamRequestRecordCount,
  waitForUpstreamRequest,
} from "../../../helpers/conversation-session-network.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  prepareSSHLifecycle,
  readRemoteCoreIdentity,
  readTaskRowInProject,
  sendSSHFollowTurn,
  type SSHLifecycleProvider,
  type SSHLifecycleTask,
} from "../../../helpers/ssh-remote-lifecycle.js";
import {
  readHostProcesses,
  readRemoteTabSnapshot,
  runSSHCommand,
  waitForRemoteTab,
  type SSHConnectionConfig,
} from "../../../helpers/ssh-remote-p0.js";
import {
  approveV4Permission,
  getV4PaneSnapshot,
  hasV4PermissionDialog,
  selectV4TaskById,
  sendV4Prompt,
  waitForV4ConversationState,
  waitForV4Pane,
  waitForV4PermissionDialogInComposerDock,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

const CASE_MARKER = "E2E_R3_TRANSPORT_LOSS";
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-transport-loss",
);
const REMOTE_PERMISSION_DIR = "/home/dev/r3-workspace-a/.cf-e2e/r3-transport-loss";
const REMOTE_PERMISSION_FILE = `${REMOTE_PERMISSION_DIR}/permission-output.txt`;
const PERMISSION_EXECUTION = { toolCallId: "toolu_r3_task_permission", toolName: "Write" };
const run = promisify(execFile);

async function severDesktopSshSessions(container: string): Promise<string> {
  const script = [
    "target_uid=$(id -u dev); killed=''",
    'for d in /proc/[0-9]*; do p=${d#/proc/}; [ "$p" = 1 ] && continue',
    "c=$(tr '\\0' ' ' < \"$d/cmdline\" 2>/dev/null) || continue; case \"$c\" in *sshd*) ;; *) continue;; esac",
    'uid=$(awk \'/^Uid:/ {print $2}\' "$d/status"); [ "$uid" = "$target_uid" ] || continue',
    'parent=$(awk \'{print $4}\' "$d/stat"); kill -9 "$p" 2>/dev/null && killed="$killed $p"',
    '[ "$parent" != 1 ] && kill -9 "$parent" 2>/dev/null && killed="$killed $parent"; done',
    "echo $killed",
  ].join("; ");
  const result = await run("docker", ["exec", container, "sh", "-c", script]);
  return result.stdout.trim().split(/\s+/u).filter(Boolean).join(",");
}

async function waitForSessionRegeneration(
  identity: string,
  previous: string,
  label: string,
): Promise<string> {
  let latest: string | null = null;
  await browser.waitUntil(
    async () => {
      const snapshot = await readRemoteTabSnapshot(identity).catch(() => null);
      if (snapshot?.remoteSessionId && snapshot.remoteSessionId !== previous) {
        latest = snapshot.remoteSessionId;
        return true;
      }
      return false;
    },
    {
      interval: 1000,
      timeout: 120_000,
      timeoutMsg: `${CASE_MARKER}: workspace ${label} 传输Medium断后没有Auto换代恢复`,
    },
  );
  return latest!;
}

async function remoteAgentAlive(config: SSHConnectionConfig, workspacePath: string) {
  const script = [
    "r=none",
    'for d in /proc/[0-9]*; do c=$(tr "\\0" " " < "$d/cmdline" 2>/dev/null) || continue',
    `case "$c" in *"app-server --stdi"[o]*) [ "$(readlink $d/cwd)" = "${workspacePath}" ] && r=$(basename "$d");; esac; done`,
    "echo $r",
  ].join("; ");
  const result = await runSSHCommand(config, script);
  return result.stdout.trim();
}

describe(`${CASE_MARKER}: 产品 SSH Connection interrupted期间远端TaskContinue，恢复后同组换代且阻塞PermissionsRetain`, () => {
  let provider: SSHLifecycleProvider | null = null;
  const facts: Record<string, unknown> = {};

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "transport-loss.json"), JSON.stringify(facts, null, 2));
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-REC-01/03/09 Disconnection during running -> daemon and tasks continue, A/B auto-upgrade; permission blocking restores same ID across disconnections and responds only once", async function () {
    this.timeout(35 * 60_000);
    const container = process.env.CF_E2E_SSH_CONTAINER?.trim();
    if (!container) throw new Error(`${CASE_MARKER}: Missing CF_E2E_SSH_CONTAINER`);
    const prepared = await prepareSSHLifecycle(CASE_MARKER, {
      apiType: "anthropic-messages",
      tunnelUsername: "tunnel",
    });
    provider = prepared.provider;
    const [workspaceA, workspaceB] = prepared.config.workspacePaths;
    await runSSHCommand(prepared.config, `rm -rf "${REMOTE_PERMISSION_DIR}"`);
    const taskA = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: prepared.config,
      label: "A",
      provider,
      workspacePath: workspaceA,
    });
    const taskB = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: prepared.config,
      label: "B",
      provider,
      workspacePath: workspaceB,
    });
    const hosts = await readHostProcesses();
    const core0 = await readRemoteCoreIdentity(prepared.config, CASE_MARKER);
    const agentB0 = await remoteAgentAlive(prepared.config, workspaceB);

    await selectV4TaskById(taskA.taskId, 30_000);
    await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: taskA.identity,
      expectedPath: workspaceA,
      expectedRemoteSessionId: taskA.remoteSessionId,
    });
    await sendV4Prompt(`${CASE_MARKER}_SLOW 慢慢Answer`);
    await waitForV4TimelineContaining("R3_TLOSS_STREAMING", 60_000);
    await waitForV4Pane(
      (s) => s.canStop && s.sessionId === taskA.taskId,
      "A did not enter running",
      45_000,
    );
    const agentA0 = await remoteAgentAlive(prepared.config, workspaceA);
    facts.severedSessions = await severDesktopSshSessions(container);
    const regeneratedA = await waitForSessionRegeneration(
      taskA.identity,
      taskA.remoteSessionId,
      "A",
    );
    const regeneratedB = await waitForSessionRegeneration(
      taskB.identity,
      taskB.remoteSessionId,
      "B",
    );
    facts.regenerated = { A: regeneratedA, B: regeneratedB };
    const core1 = await readRemoteCoreIdentity(prepared.config, CASE_MARKER);
    expect(core1.pid).toBe(core0.pid);
    expect(core1.startTicks).toBe(core0.startTicks);
    expect(await remoteAgentAlive(prepared.config, workspaceA)).toBe(agentA0);
    expect(await remoteAgentAlive(prepared.config, workspaceB)).toBe(agentB0);
    expect(await readHostProcesses()).toEqual(hosts);
    await waitForV4ConversationState(
      (s) => s.taskId === taskA.taskId && s.state === "idle",
      `${CASE_MARKER}: 断连恢复后 A 的 running turn 没有正常收口`,
      120_000,
    );
    const messages = await browser.execute(() => document.body?.innerText ?? "");
    expect(messages).not.toMatch(/Task failed|task failed/iu);
    facts.aTurnCompletedAfterReconnect = true;

    const resumedB: SSHLifecycleTask = { ...taskB, remoteSessionId: regeneratedB };
    await readTaskRowInProject(resumedB, CASE_MARKER);
    await sendSSHFollowTurn(resumedB, CASE_MARKER, taskA.firstPrompt);

    const resumedA: SSHLifecycleTask = { ...taskA, remoteSessionId: regeneratedA };
    await readTaskRowInProject(resumedA, CASE_MARKER);
    await selectV4TaskById(taskA.taskId, 30_000);
    await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: taskA.identity,
      expectedPath: workspaceA,
      expectedRemoteSessionId: regeneratedA,
    });
    const permissionStart = await getUpstreamRequestRecordCount();
    await sendV4Prompt(`${CASE_MARKER}_PERMISSION 请WriteFile ${REMOTE_PERMISSION_FILE}`);
    await waitForUpstreamRequest(
      { lastUserMessageIncludes: [`${CASE_MARKER}_PERMISSION`] },
      `${CASE_MARKER}: Permissions turn 没有到达回放`,
      60_000,
      { afterIndex: permissionStart - 1 },
    );
    const dock = await waitForV4PermissionDialogInComposerDock(60_000);
    expect(dock.inDock).toBe(true);
    const pendingId = await waitForPermissionInteractionId(CASE_MARKER);
    facts.permissionDialogIdBeforeSever = pendingId;
    facts.severedSessionsSecond = await severDesktopSshSessions(container);
    const regeneratedA2 = await waitForSessionRegeneration(
      taskA.identity,
      regeneratedA,
      "A(second)",
    );
    facts.regeneratedA2 = regeneratedA2;
    await browser.waitUntil(() => hasV4PermissionDialog(), {
      timeout: 60_000,
      timeoutMsg: `${CASE_MARKER}: 恢复后PermissionsChat框没有重New出现`,
    });
    const restoredId = await waitForPermissionInteractionId(CASE_MARKER);
    facts.permissionDialogIdAfterRecover = restoredId;
    expect(restoredId).toBe(pendingId);
    expect(
      (
        await runSSHCommand(
          prepared.config,
          `test -f "${REMOTE_PERMISSION_FILE}" && echo exists || echo absent`,
        )
      ).stdout.trim(),
    ).toBe("absent");
    const executionQuery = { sessionId: taskA.taskId, toolName: PERMISSION_EXECUTION.toolName };
    expect(await readRemoteToolExecutionEvents(prepared.config, executionQuery)).toEqual([]);
    expect(await approveV4Permission()).toBe(true);
    await waitForV4TimelineContaining("R3_TLOSS_PERMISSION_DONE", 90_000);
    const written = await runSSHCommand(
      prepared.config,
      `cat "${REMOTE_PERMISSION_FILE}"; echo; grep -c R3_TLOSS_PERMISSION_RESULT "${REMOTE_PERMISSION_FILE}"`,
    );
    expect(written.stdout).toContain("R3_TLOSS_PERMISSION_RESULT");
    expect(written.stdout.trim().endsWith("1")).toBe(true);
    await browser.pause(2000);
    expect(await hasV4PermissionDialog()).toBe(false);
    facts.permissionResolvedOnce = written.stdout.trim();
    await waitForV4ConversationState(
      (s) => s.taskId === taskA.taskId && s.state === "idle",
      `${CASE_MARKER}: Permissions turn 没有回到 idle`,
      60_000,
    );
    let executions = await readRemoteToolExecutionEvents(prepared.config, executionQuery);
    await browser.waitUntil(
      async () => {
        executions = await readRemoteToolExecutionEvents(prepared.config, executionQuery);
        facts.remoteToolExecutions = executions;
        return executions.some((event) => event.event === "tool.call.completed");
      },
      { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: 远端 Write MissingCompletedEvents` },
    );
    expect(executions.filter((event) => event.event === "tool.call.started")).toHaveLength(1);
    expect(executions.filter((event) => event.event === "tool.call.completed")).toHaveLength(1);
    expect(executions.every((event) => event.toolCallId === PERMISSION_EXECUTION.toolCallId)).toBe(
      true,
    );
    expect((await getV4PaneSnapshot()).canStop).toBe(false);
    expect(await readHostProcesses()).toEqual(hosts);
  });
});
