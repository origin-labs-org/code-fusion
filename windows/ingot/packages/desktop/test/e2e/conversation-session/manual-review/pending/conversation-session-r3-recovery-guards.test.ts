import { reloadElectronSessionPreservingBrowserProfile } from "#e2e/helpers/e2e-electron-reload";
import {
  disconnectRemoteSource,
  reconnectRemoteProject,
} from "#e2e/helpers/remote-project-actions";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";
import { clearAppData, readSettings, seedSettings } from "../../../helpers/desktop-app.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  prepareSSHLifecycle,
  waitForRendererAfterColdRestart,
  type SSHLifecycleProvider,
} from "../../../helpers/ssh-remote-lifecycle.js";
import {
  readHostProcesses,
  readRemoteTabSnapshot,
  waitForRemoteTab,
} from "../../../helpers/ssh-remote-p0.js";

const CASE_MARKER = "E2E_R3_RECOVERY_GUARDS";
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-recovery-guards",
);
const EIGHT_DAYS_MS = 8 * 24 * 60 * 60_000;

async function disconnectDevice(sourceId: string, workspaceIdentity: string): Promise<void> {
  await disconnectRemoteSource(sourceId, CASE_MARKER, { workspaceIdentities: [workspaceIdentity] });
}

describe(`${CASE_MARKER}: 显式Disconnect收口与Old Source Cold-start recovery`, () => {
  let provider: SSHLifecycleProvider | null = null;
  const facts: Record<string, unknown> = {};

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "recovery-guards.json"), JSON.stringify(facts, null, 2));
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-REC-02/05 Does not reopen and preserves history after explicit user disconnect; Source still participates in cold boot silent recovery after over 7 days, no unauthorized interaction", async function () {
    this.timeout(25 * 60_000);
    const prepared = await prepareSSHLifecycle(CASE_MARKER, { tunnelUsername: "tunnel" });
    provider = prepared.provider;
    const [workspaceA] = prepared.config.workspacePaths;
    const taskA = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: prepared.config,
      label: "A",
      provider,
      workspacePath: workspaceA,
    });
    const sourceId = parseRemoteWorkspaceIdentity(taskA.identity)?.sourceServerId;
    if (!sourceId) throw new Error(`${CASE_MARKER}: Missing Source identity`);

    await disconnectDevice(sourceId, taskA.identity);
    await browser.pause(30_000);
    const disconnectedState = await browser.execute(
      (groupKey, projectName) => {
        const group = document.querySelector<HTMLElement>(
          `[data-project-workspace-identity="${groupKey}"]`,
        );
        return {
          group: Boolean(group),
          projectVisible: (document.body?.innerText ?? "").includes(projectName),
          sourceStatus: group?.dataset.connectionState ?? null,
        };
      },
      taskA.identity,
      "r3-workspace-a",
    );
    const openEntryKeptAfterDisconnect =
      (await readSettings()).lastWorkspaceSession?.some(
        (entry) => entry.kind === "remote" && entry.workspacePath === workspaceA,
      ) ?? false;
    const afterDisconnect = await readRemoteTabSnapshot(taskA.identity).catch(() => null);
    facts.explicitDisconnect = {
      ...disconnectedState,
      openEntryKeptInSettings: openEntryKeptAfterDisconnect,
      remoteSessionId: afterDisconnect?.remoteSessionId ?? null,
    };
    expect(disconnectedState.group).toBe(true);
    expect(disconnectedState.projectVisible).toBe(true);
    expect(disconnectedState.sourceStatus).toBe("offline");
    expect(openEntryKeptAfterDisconnect).toBe(true);
    expect(afterDisconnect?.remoteSessionId ?? null).toBeNull();
    expect(await readHostProcesses()).toEqual(prepared.initialHosts);

    const staleAt = Date.now() - EIGHT_DAYS_MS;
    await reloadElectronSessionPreservingBrowserProfile(browser, {
      afterElectronProcessExit: async () => {
        const settings = await readSettings();
        const servers = settings.sourceServers ?? [];
        expect(servers.some((server) => server.sourceServerId === sourceId)).toBe(true);
        await seedSettings({
          sourceServers: servers.map((server) =>
            server.sourceServerId === sourceId ? { ...server, lastOnlineAt: staleAt } : server,
          ),
        });
      },
    });
    await waitForRendererAfterColdRestart(CASE_MARKER);
    const afterCold = await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: taskA.identity,
      expectedPath: workspaceA,
      requireActive: false,
      timeoutMs: 120_000,
    });
    const hasDialog = await browser.execute(() =>
      Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]')),
    );
    const coldSidebar = await browser.execute(() => document.body?.innerText ?? "");
    const coldSettings = await readSettings();
    const openEntryKept =
      coldSettings.lastWorkspaceSession?.some(
        (entry) => entry.kind === "remote" && entry.workspacePath === workspaceA,
      ) ?? false;
    facts.staleColdStart = {
      staleAt,
      remoteSessionIdAfterCold: afterCold?.remoteSessionId ?? null,
      workspaceStillListed: coldSidebar.includes("r3-workspace-a"),
      openEntryKeptInSettings: openEntryKept,
      dialogShown: hasDialog,
      hostCount: (await readHostProcesses()).length,
    };
    expect(afterCold.remoteSessionId).toBeTruthy();
    expect(hasDialog).toBe(false);
    expect(openEntryKept).toBe(true);
    facts.staleColdStartDeviceRowShown = coldSidebar.includes("r3-workspace-a");
    expect(facts.staleColdStartDeviceRowShown).toBe(true);
    expect((await readHostProcesses()).length).toBe(1);

    await disconnectDevice(sourceId, taskA.identity);
    await reconnectRemoteProject(taskA.identity, CASE_MARKER);
    await browser.waitUntil(
      async () =>
        Boolean((await readRemoteTabSnapshot(taskA.identity).catch(() => null))?.remoteSessionId),
      { timeout: 120_000, interval: 1000, timeoutMsg: `${CASE_MARKER}: User点击Reconnect后没有恢复` },
    );
    facts.manualRecoveryAfterGuard = true;
    const recoveredSidebar = await browser.execute(() => document.body?.innerText ?? "");
    facts.workspaceListedAfterManualRecovery = recoveredSidebar.includes("r3-workspace-a");
    facts.taskListedAfterManualRecovery = recoveredSidebar.includes(taskA.firstPrompt.slice(0, 30));
    expect(recoveredSidebar).toContain("r3-workspace-a");
  });
});
