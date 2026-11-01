import { openWorkspaceDraftFromSidebar } from "#e2e/helpers/workspace-agent-warmup";
import { reloadElectronSessionPreservingBrowserProfile } from "#e2e/helpers/e2e-electron-reload";
import { disconnectRemoteSource } from "#e2e/helpers/remote-project-actions";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";
import { clearAppData, readSettings, seedSettings } from "../../../helpers/desktop-app.js";
import { waitForRendererAfterColdRestart } from "../../../helpers/ssh-remote-lifecycle.js";
import {
  connectSSHWorkspace,
  openSSHSourceDirectory,
  readHostProcesses,
  readSSHRuntimeConfig,
  selectSSHRemoteDirectory,
  waitForRemoteTab,
  waitForSSHDirectoryStep,
} from "../../../helpers/ssh-remote-p0.js";
import { prepareV4ConversationE2E } from "../../../helpers/v4-conversation.js";

const CASE_MARKER = "E2E_RDUX_14_DEVICE_ONLINE_RESTORES_STALE_TABS";
const STALE_AGE_MS = 20 * 24 * 60 * 60_000;
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/rdux-14-device-online-restores-stale-tabs",
);

describe(`${CASE_MARKER}: Device上线后挂回不再按Workspace年龄过滤`, () => {
  const facts: Record<string, unknown> = {};

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "rdux-14.json"), JSON.stringify(facts, null, 2));
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("RDUX-14 Active directories older than 7 days still auto-restore, other projects open on demand", async function () {
    this.timeout(25 * 60_000);
    const config = readSSHRuntimeConfig(CASE_MARKER);
    const [workspaceA, workspaceB] = config.workspacePaths;
    await prepareV4ConversationE2E({ skipProvider: true });

    const tabA = await connectSSHWorkspace({
      caseMarker: CASE_MARKER,
      config,
      workspacePath: workspaceA,
    });
    await openSSHSourceDirectory(config, CASE_MARKER);
    await waitForSSHDirectoryStep(CASE_MARKER);
    await selectSSHRemoteDirectory(workspaceB, CASE_MARKER);
    const tabB = await waitForRemoteTab({ caseMarker: CASE_MARKER, expectedPath: workspaceB });
    const sourceId = parseRemoteWorkspaceIdentity(tabA.workspaceIdentity!)?.sourceServerId ?? "";
    expect(sourceId).toBeTruthy();
    await disconnectRemoteSource(sourceId, CASE_MARKER, {
      workspaceIdentities: [tabA.workspaceIdentity!, tabB.workspaceIdentity!],
    });

    await reloadElectronSessionPreservingBrowserProfile(browser, {
      afterElectronProcessExit: async () => {
        const before = await readSettings();
        const lastWorkspaceSession = (before.lastWorkspaceSession ?? []).map((entry) =>
          entry.kind === "remote" && entry.workspacePath === workspaceB
            ? { ...entry, lastOpenedAt: Date.now() - STALE_AGE_MS }
            : entry,
        );
        expect(
          lastWorkspaceSession.some(
            (entry) =>
              entry.kind === "remote" &&
              entry.workspacePath === workspaceB &&
              entry.lastOpenedAt < Date.now() - 7 * 24 * 60 * 60_000,
          ),
        ).toBe(true);
        const active = before.lastActiveWorkspace;
        if (active?.kind !== "remote" || active.workspacePath !== workspaceB)
          throw new Error("缺少活动远程目录 B");
        const lastActiveWorkspace = { ...active, lastOpenedAt: Date.now() - STALE_AGE_MS };
        await seedSettings({ lastWorkspaceSession, lastActiveWorkspace });
        facts.activeSeeded = lastActiveWorkspace;
        facts.seeded = lastWorkspaceSession;
      },
    });
    await waitForRendererAfterColdRestart(CASE_MARKER);

    const restoredB = await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: tabB.workspaceIdentity!,
      expectedPath: workspaceB,
      requireActive: false,
    });
    await openWorkspaceDraftFromSidebar(workspaceA);
    const restoredA = await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: tabA.workspaceIdentity!,
      expectedPath: workspaceA,
      requireActive: false,
    });
    facts.restored = { restoredA, restoredB };
    expect(restoredA.remoteSessionId).not.toBe(tabA.remoteSessionId);
    expect(restoredB.remoteSessionId).not.toBe(tabB.remoteSessionId);
    expect(await readHostProcesses()).toHaveLength(1);
  });
});
