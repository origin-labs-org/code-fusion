import { reloadElectronSessionPreservingBrowserProfile } from "#e2e/helpers/e2e-electron-reload";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";
import { clearAppData, DEFAULT_WORKSPACE, readSettings } from "../../../helpers/desktop-app.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  prepareSSHLifecycle,
  sendSSHFollowTurn,
  waitForRendererAfterColdRestart,
  type SSHLifecycleProvider,
} from "../../../helpers/ssh-remote-lifecycle.js";
import {
  prepareSSHConnectionPage,
  openSSHSourceDirectory,
  readHostProcesses,
  readRemoteTabSnapshot,
  selectSSHRemoteDirectory,
  waitForRemoteTab,
  waitForSSHDirectoryStep,
} from "../../../helpers/ssh-remote-p0.js";
import {
  openWorkspaceDraftFromSidebar,
  selectTaskOrganizeMode,
} from "../../../helpers/workspace-agent-warmup.js";

const CASE_MARKER = "E2E_R3_MIXED_ENTRIES";
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-mixed-entries",
);

interface TabRow {
  id: string;
  workspacePath: string | null;
  workspaceIdentity: string | null;
  remoteSessionId: string | null;
}

function readTabs(): Promise<{ active: string | null; tabs: TabRow[] }> {
  return browser.execute(() => {
    const store = (
      window as Window & {
        __cfTabStoreE2E?: {
          getState?: () => {
            activeWorkspaceIdentity?: string | null;
            activeWorkspacePath?: string | null;
            tabs?: Array<{
              id: string;
              workspacePath?: string;
              workspaceIdentity?: string;
              remoteSessionId?: string;
            }>;
          };
        };
      }
    ).__cfTabStoreE2E;
    const state = store?.getState?.();
    return {
      active: state?.activeWorkspaceIdentity ?? state?.activeWorkspacePath ?? null,
      tabs: (state?.tabs ?? []).map((tab) => ({
        id: tab.id,
        workspacePath: tab.workspacePath ?? null,
        workspaceIdentity: tab.workspaceIdentity ?? null,
        remoteSessionId: tab.remoteSessionId ?? null,
      })),
    };
  });
}

describe(`${CASE_MARKER}: Local与远端Project入口Retain，冷Start只恢复EventsTable of Contents`, () => {
  let provider: SSHLifecycleProvider | null = null;
  const facts: Record<string, unknown> = {};

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "mixed-entries.json"), JSON.stringify(facts, null, 2));
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-ID-08/REC-10 Cold boot restores original remote focus, preserves project entries; other projects open on demand and original tasks can be resumed", async function () {
    this.timeout(30 * 60_000);
    await prepareSSHConnectionPage(CASE_MARKER);
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
    const sourceId = parseRemoteWorkspaceIdentity(taskA.identity)?.sourceServerId ?? "";
    await openSSHSourceDirectory(prepared.config, CASE_MARKER);
    await waitForSSHDirectoryStep(CASE_MARKER);
    await selectSSHRemoteDirectory(workspaceB, CASE_MARKER);
    const tabB = await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedPath: workspaceB,
      timeoutMs: 120_000,
    });
    await openWorkspaceDraftFromSidebar(DEFAULT_WORKSPACE);
    await openWorkspaceDraftFromSidebar(workspaceA);
    const before = await readTabs();
    expect(before.active).toBe(taskA.identity);
    await browser.waitUntil(
      async () => {
        const settings = await readSettings();
        return (
          settings.lastActiveWorkspace?.kind === "remote" &&
          settings.lastActiveWorkspace.workspacePath === workspaceA
        );
      },
      { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: 冷Start前远端 active 尚未Persistence` },
    );
    const settingsBefore = (await readSettings()).lastWorkspaceSession ?? [];
    facts.before = {
      tabs: before.tabs.map((t) => ({
        path: t.workspacePath,
        identity: t.workspaceIdentity,
        online: Boolean(t.remoteSessionId),
      })),
      active: before.active,
      entries: settingsBefore.map((e) => ({ kind: e.kind, path: e.workspacePath })),
    };
    const readProjectEntries = () =>
      browser.execute(() =>
        [...document.querySelectorAll("[data-project-id]")]
          .map(
            (row) =>
              `${row.getAttribute("data-project-host")}::${row.getAttribute("data-project-id")}`,
          )
          .sort(),
      );
    const projectEntriesBefore = await readProjectEntries();
    expect(projectEntriesBefore.length).toBeGreaterThanOrEqual(3);
    const expectedRemoteIdentities = [taskA.identity, tabB.workspaceIdentity!];

    await reloadElectronSessionPreservingBrowserProfile(browser);
    await waitForRendererAfterColdRestart(CASE_MARKER);
    let early = await readTabs();
    await browser.waitUntil(
      async () => {
        early = await readTabs();
        return early.tabs.length > 0;
      },
      { timeout: 60_000, interval: 200, timeoutMsg: `${CASE_MARKER}: 冷Start后 tab store One直为空` },
    );
    facts.earlyAfterCold = {
      tabs: early.tabs.map((t) => ({
        path: t.workspacePath,
        identity: t.workspaceIdentity,
        online: Boolean(t.remoteSessionId),
      })),
      active: early.active,
    };
    const restoreStarted = Date.now();
    const timeline: Array<{ t: number; online: string[] }> = [];
    facts.restoreTimeline = timeline;
    await browser
      .waitUntil(
        async () => {
          const now = await readTabs();
          const online = now.tabs
            .filter((t) => t.remoteSessionId)
            .map((t) => t.workspacePath ?? "");
          if (timeline.length === 0 || timeline.at(-1)!.online.join("|") !== online.join("|"))
            timeline.push({ t: Date.now() - restoreStarted, online });
          return now.tabs.some(
            (tab) => tab.workspaceIdentity === taskA.identity && tab.remoteSessionId,
          );
        },
        {
          timeout: 240_000,
          interval: 1000,
          timeoutMsg: `${CASE_MARKER}: 冷Start后EventsProject没有恢复`,
        },
      )
      .catch(async (cause: unknown) => {
        facts.restoreFailure = await readTabs();
        throw new Error(`${CASE_MARKER}: 冷Start后EventsProject没有恢复: ${JSON.stringify(timeline)}`, {
          cause,
        });
      });
    const after = await readTabs();
    expect(early.active).toBe(taskA.identity);
    expect(after.active).toBe(taskA.identity);
    const afterKeys = after.tabs
      .filter((t) => t.workspacePath)
      .map((t) => `${t.workspaceIdentity ?? "local"}::${t.workspacePath}`);
    facts.afterCold = {
      tabs: after.tabs.map((t) => ({
        path: t.workspacePath,
        identity: t.workspaceIdentity,
        online: Boolean(t.remoteSessionId),
      })),
      duplicates: afterKeys.length - new Set(afterKeys).size,
      active: after.active,
    };
    expect(new Set(afterKeys).size).toBe(afterKeys.length);
    expect(after.tabs.filter((tab) => tab.workspaceIdentity)).toHaveLength(1);
    const projectEntriesAfter = await readProjectEntries();
    expect(projectEntriesAfter).toEqual(projectEntriesBefore);
    facts.projectEntries = { before: projectEntriesBefore, after: projectEntriesAfter };
    const settingsAfter = (await readSettings()).lastWorkspaceSession ?? [];
    expect(settingsAfter.filter((e) => e.kind === "remote").length).toBe(
      settingsBefore.filter((e) => e.kind === "remote").length,
    );
    expect((await readRemoteTabSnapshot(tabB.workspaceIdentity!)).remoteSessionId).toBeNull();
    await openWorkspaceDraftFromSidebar(workspaceB);
    await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: tabB.workspaceIdentity!,
      expectedPath: workspaceB,
    });
    expect(expectedRemoteIdentities).toHaveLength(2);
    const snapA = await readRemoteTabSnapshot(taskA.identity);
    const snapB = await readRemoteTabSnapshot(tabB.workspaceIdentity!);
    facts.siblings = {
      a: snapA.remoteSessionId,
      b: snapB.remoteSessionId,
      sameSource:
        parseRemoteWorkspaceIdentity(tabB.workspaceIdentity!)?.sourceServerId === sourceId,
    };
    expect(snapA.remoteSessionId).toBeTruthy();
    expect(snapB.remoteSessionId).toBeTruthy();
    expect(snapA.remoteSessionId).not.toBe(snapB.remoteSessionId);
    expect(parseRemoteWorkspaceIdentity(tabB.workspaceIdentity!)?.sourceServerId).toBe(sourceId);
    await sendSSHFollowTurn(
      {
        ...taskA,
        remoteSessionId: snapA.remoteSessionId!,
        followReply: "R3_MIXED_ENTRIES_FOLLOW_REPLY",
      },
      CASE_MARKER,
    );
    facts.followTurnVerified = true;
    await selectTaskOrganizeMode(["项目", "Project"]);
    expect((await readHostProcesses()).length).toBe(1);
  });
});
