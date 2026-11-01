import { selectTaskOrganizeMode } from "../../../helpers/workspace-agent-warmup.js";
import {
  disconnectRemoteSource,
  reconnectRemoteProject,
} from "#e2e/helpers/remote-project-actions";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  prepareSSHLifecycle,
  readRemoteCoreIdentity,
  readTaskRowInProject,
  sendSSHFollowTurn,
  terminateRemoteProcess,
  type SSHLifecycleProvider,
  type SSHLifecycleTask,
} from "../../../helpers/ssh-remote-lifecycle.js";
import {
  readHostProcesses,
  readRemoteTabSnapshot,
  runSSHCommand,
  waitForRemoteTab,
} from "../../../helpers/ssh-remote-p0.js";

const CASE_MARKER = "E2E_R3_DAEMON_DETACHED";
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-daemon-detached",
);

describe(`${CASE_MARKER}: 无 user service manager Target的 daemon Lifecycle`, () => {
  let provider: SSHLifecycleProvider | null = null;
  let restoreRemoteEnvironment: (() => Promise<void>) | undefined;

  after(async () => {
    await restoreRemoteEnvironment?.();
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-BLD-07 detached daemon: daemon not killed on disconnect; can still be brought up on reconnect when offline detection is skipped", async function () {
    this.timeout(30 * 60_000);
    const prepared = await prepareSSHLifecycle(CASE_MARKER);
    provider = prepared.provider;
    const [workspaceA] = prepared.config.workspacePaths;
    const facts: Record<string, unknown> = {};

    const taskA = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: prepared.config,
      label: "A",
      provider,
      workspacePath: workspaceA,
    });
    const core0 = await readRemoteCoreIdentity(prepared.config, CASE_MARKER);
    const status0 = JSON.parse(
      (await runSSHCommand(prepared.config, 'cat "$HOME/.cf/server/run/status.json"')).stdout,
    ) as { serviceRegistered: boolean; state: string };
    expect(status0.serviceRegistered).toBe(false);
    expect(status0.state).toBe("ready");
    const systemd = await runSSHCommand(
      prepared.config,
      'command -v systemctl >/dev/null 2>&1 && systemctl --user is-system-running 2>&1 || echo "no-user-manager"',
    );
    facts.remoteUserManager = systemd.stdout.trim();
    facts.core0 = core0;

    const sourceId = parseRemoteWorkspaceIdentity(taskA.identity)?.sourceServerId;
    expect(sourceId).toBeTruthy();
    await selectTaskOrganizeMode(["项目", "Project"]);

    await disconnectRemoteSource(sourceId!, CASE_MARKER, { workspaceIdentities: [taskA.identity] });

    await browser.pause(3000);
    const coreAfterDisconnect = await readRemoteCoreIdentity(prepared.config, CASE_MARKER);
    expect(coreAfterDisconnect.pid).toBe(core0.pid);
    expect(coreAfterDisconnect.startTicks).toBe(core0.startTicks);
    expect(coreAfterDisconnect.supervisorPid).toBe(core0.supervisorPid);
    facts.coreAfterDisconnect = coreAfterDisconnect;

    const supervisorStart = await runSSHCommand(
      prepared.config,
      `awk '{print $22}' /proc/${core0.supervisorPid}/stat`,
    );
    await terminateRemoteProcess(
      prepared.config,
      { pid: core0.supervisorPid, startTicks: Number.parseInt(supervisorStart.stdout.trim(), 10) },
      CASE_MARKER,
    );
    const coreStillThere = await runSSHCommand(
      prepared.config,
      `awk '{print $22}' /proc/${core0.pid}/stat 2>/dev/null || echo gone`,
    );
    if (coreStillThere.stdout.trim() === String(core0.startTicks)) {
      await terminateRemoteProcess(prepared.config, core0, CASE_MARKER);
    }
    const daemonGone = await runSSHCommand(
      prepared.config,
      'r=gone; for d in /proc/[0-9]*; do c=$(tr "\\0" " " < "$d/cmdline" 2>/dev/null) || continue; case "$c" in *runtime/server-cor[e].js*|*"serve --superviso"[r]*) r=alive;; esac; done; echo $r',
    );
    expect(daemonGone.stdout.trim()).toBe("gone");
    facts.daemonAfterKill = daemonGone.stdout.trim();

    const fixtureRoot = `'${`${workspaceA}/.cf-e2e/${CASE_MARKER}`.replaceAll("'", "'\\''")}'`;
    const backup = `${fixtureRoot}/bashrc.original`;
    const setup = await runSSHCommand(
      prepared.config,
      `mkdir -p ${fixtureRoot} && test ! -e ${backup} && cp -p "$HOME/.bashrc" ${backup}`,
    );
    expect(setup.code).toBe(0);
    restoreRemoteEnvironment = async () => {
      const restored = await runSSHCommand(prepared.config, `mv ${backup} "$HOME/.bashrc"`);
      expect(restored.code).toBe(0);
    };
    const configured = await runSSHCommand(
      prepared.config,
      `{ printf '%s\\n' 'export SYSTEMD_OFFLINE=1'; cat ${backup}; } > ${fixtureRoot}/bashrc.offline && mv ${fixtureRoot}/bashrc.offline "$HOME/.bashrc"`,
    );
    expect(configured.code).toBe(0);
    const skippedProbe = await runSSHCommand(
      prepared.config,
      'test "$SYSTEMD_OFFLINE" = 1 && test "${CF_SERVER_SKIP_SERVICE_REGISTRATION-}" != 1 && systemctl --user show --property=Version',
    );
    expect(skippedProbe.code).toBe(0);
    expect(skippedProbe.stdout.trim()).toBe("");
    facts.skippedProbe = skippedProbe;

    await reconnectRemoteProject(taskA.identity, CASE_MARKER);
    const reconnected = await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: taskA.identity,
      expectedPath: workspaceA,
      requireActive: false,
    });
    expect(reconnected.remoteSessionId).not.toBe(taskA.remoteSessionId);
    const core1 = await readRemoteCoreIdentity(prepared.config, CASE_MARKER);
    expect(core1.pid).not.toBe(core0.pid);
    expect(core1.supervisorPid).not.toBe(core0.supervisorPid);
    expect(core1.state).toBe("ready");
    const status1 = JSON.parse(
      (await runSSHCommand(prepared.config, 'cat "$HOME/.cf/server/run/status.json"')).stdout,
    ) as { serviceRegistered: boolean };
    expect(status1.serviceRegistered).toBe(false);
    facts.core1 = core1;
    expect(await readHostProcesses()).toEqual(prepared.initialHosts);

    const resumed: SSHLifecycleTask = { ...taskA, remoteSessionId: reconnected.remoteSessionId! };
    await readTaskRowInProject(resumed, CASE_MARKER);
    await sendSSHFollowTurn(resumed, CASE_MARKER);
    expect((await readRemoteTabSnapshot(taskA.identity)).secretPersistedInTab).toBe(false);

    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "daemon-detached.json"), JSON.stringify(facts, null, 2));
  });
});
