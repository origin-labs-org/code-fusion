import { reconnectRemoteProject } from "../../../helpers/remote-project-actions.js";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  listRemoteCfServerPids,
  prepareSSHLifecycle,
  readTaskRowInProject,
  sendSSHFollowTurn,
  stopOwnedSSHServer,
  waitForRemoteWorkspaceFaultSettled,
  type SSHLifecycleProvider,
  type SSHLifecycleTask,
} from "../../../helpers/ssh-remote-lifecycle.js";
import {
  readHostProcesses,
  readRemoteTabSnapshot,
  runSSHCommand,
  waitForRemoteTab,
} from "../../../helpers/ssh-remote-p0.js";

const CASE_MARKER = "E2E_SSH_P0_SERVER_FAULT";

describe(`${CASE_MARKER}: SSH cf-server fault and grouped reconnect`, () => {
  let provider: SSHLifecycleProvider | null = null;

  after(async () => {
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("SSH-P0-LIFE-02 After terminating only the cf-server newly created by this case, reconnecting A restores A/B", async function () {
    this.timeout(35 * 60_000);
    const prepared = await prepareSSHLifecycle(CASE_MARKER);
    provider = prepared.provider;
    const [workspaceA, workspaceB] = prepared.config.workspacePaths;
    const serverPidsBefore = await listRemoteCfServerPids(prepared.config);
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
    const hostBeforeFault = await readHostProcesses();
    expect(await listRemoteCfServerPids(prepared.config)).toEqual(
      expect.arrayContaining(serverPidsBefore),
    );

    const sessionsBeforeFault = {
      A: (await readRemoteTabSnapshot(taskA.identity).catch(() => null))?.remoteSessionId ?? null,
      B: (await readRemoteTabSnapshot(taskB.identity).catch(() => null))?.remoteSessionId ?? null,
    };
    await stopOwnedSSHServer(prepared.config, serverPidsBefore, CASE_MARKER);
    const faultContext = async () => ({
      sessionsBeforeFault,
      remoteServerPids: await listRemoteCfServerPids(prepared.config).catch(
        () => "probe-failed",
      ),
      remoteServerStatus:
        (
          await runSSHCommand(
            prepared.config,
            'cat "$HOME/.cf/server/run/status.json" 2>/dev/null | tr -d "\\n " | cut -c1-200',
          ).catch(() => null)
        )?.stdout.trim() ?? null,
    });
    const settledA = await waitForRemoteWorkspaceFaultSettled(
      taskA.identity,
      CASE_MARKER,
      sessionsBeforeFault.A,
      faultContext,
    );
    const settledB = await waitForRemoteWorkspaceFaultSettled(
      taskB.identity,
      CASE_MARKER,
      sessionsBeforeFault.B,
      faultContext,
    );

    const manuallyReconnected =
      settledA === "retained-disconnected" || settledB === "retained-disconnected";
    if (manuallyReconnected) {
      await reconnectRemoteProject(taskA.identity, CASE_MARKER);
    }
    const reconnectedA = await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: taskA.identity,
      expectedPath: workspaceA,
      requireActive: manuallyReconnected,
    });
    const reconnectedB = await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: taskB.identity,
      expectedPath: workspaceB,
      requireActive: false,
    });
    expect(reconnectedA.remoteSessionId).not.toBe(taskA.remoteSessionId);
    expect(reconnectedB.remoteSessionId).not.toBe(taskB.remoteSessionId);
    expect(await readHostProcesses()).toEqual(hostBeforeFault);

    const resumedA: SSHLifecycleTask = {
      ...taskA,
      remoteSessionId: reconnectedA.remoteSessionId!,
    };
    const resumedB: SSHLifecycleTask = {
      ...taskB,
      remoteSessionId: reconnectedB.remoteSessionId!,
    };
    await readTaskRowInProject(resumedA, CASE_MARKER);
    await readTaskRowInProject(resumedB, CASE_MARKER);
    await sendSSHFollowTurn(resumedB, CASE_MARKER, taskA.firstPrompt);
    await sendSSHFollowTurn(resumedA, CASE_MARKER, taskB.firstPrompt);
    await readTaskRowInProject(resumedA, CASE_MARKER);
    await readTaskRowInProject(resumedB, CASE_MARKER);
  });
});
