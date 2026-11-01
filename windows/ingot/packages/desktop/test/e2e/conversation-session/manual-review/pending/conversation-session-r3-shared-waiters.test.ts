import { DatabaseSync } from "node:sqlite";
import { selectTaskOrganizeMode } from "../../../helpers/workspace-agent-warmup.js";
import { createStallableTcpProxy as createStallableProxy } from "#e2e/helpers/ssh-stallable-proxy";
import {
  disconnectRemoteSource,
  requestRemoteProjectConnection,
} from "#e2e/helpers/remote-project-actions";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";
import { TID_SETTINGS_BACK_BUTTON } from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  getE2EAppDataPaths,
  readSettings,
} from "../../../helpers/desktop-app.js";
import { removeRemoteProjectEntry } from "../../../helpers/ssh-remote-lifecycle.js";
import {
  connectSSHWorkspace,
  openSSHRemoteDialog,
  fillSSHPasswordSettings,
  clickLastEnabledSSHDialogButton,
  openSSHSourceDirectory,
  readHostProcesses,
  readRemoteTabSnapshot,
  readSSHRuntimeConfig,
  runSSHCommand,
  selectSSHRemoteDirectory,
  waitForRemoteTab,
  waitForSSHDirectoryStep,
  type SSHConnectionConfig,
} from "../../../helpers/ssh-remote-p0.js";
import { prepareV4ConversationE2E } from "../../../helpers/v4-conversation.js";

const CASE_MARKER = "E2E_R3_SHARED_WAITERS";
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-shared-waiters",
);

async function readHostConnectRequests(): Promise<Set<string>> {
  const directory = process.env.CF_E2E_RUNTIME_LOG_DIR;
  if (!directory) throw new Error(`${CASE_MARKER}: Missing本 worker 的LogsTable of Contents`);
  const files = (await readdir(directory)).filter((name) => name.endsWith(".log"));
  const ids = new Set<string>();
  for (const content of await Promise.all(
    files.map((name) => readFile(join(directory, name), "utf8")),
  )) {
    for (const line of content.split("\n").slice(0, -1)) {
      const match = /connecting window-scoped remote source, requestId=([^,\s]+), target=.+$/u.exec(
        line,
      );
      if (match) ids.add(match[1]!);
    }
  }
  return ids;
}

describe(`${CASE_MARKER}: 同One target 的多个Waiting者与ConnectingProject入口移除`, () => {
  let proxy: Awaited<ReturnType<typeof createStallableProxy>> | null = null;
  const facts: Record<string, unknown> = {};

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "shared-waiters.json"), JSON.stringify(facts, null, 2));
    await proxy?.close().catch(() => undefined);
    proxy = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-CON-04 Canceling wizard waiter does not cancel original project connection; removing B entry during connection does not resurrect it, A comes online normally", async function () {
    this.timeout(30 * 60_000);
    const direct = readSSHRuntimeConfig(CASE_MARKER);
    proxy = await createStallableProxy(direct);
    const proxied: SSHConnectionConfig = {
      host: direct.host,
      password: direct.password,
      port: proxy.port,
      username: direct.username,
    };
    const [workspaceA, workspaceB] = direct.workspacePaths;
    await prepareV4ConversationE2E({ skipProvider: true });
    const initialHosts = await readHostProcesses();

    const tabA = await connectSSHWorkspace({
      caseMarker: CASE_MARKER,
      config: proxied,
      workspacePath: workspaceA,
    });
    const sourceId = parseRemoteWorkspaceIdentity(tabA.workspaceIdentity!)?.sourceServerId ?? "";
    await openSSHSourceDirectory(proxied, CASE_MARKER);
    await waitForSSHDirectoryStep(CASE_MARKER);
    await selectSSHRemoteDirectory(workspaceB, CASE_MARKER);
    const tabB = await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedPath: workspaceB,
      timeoutMs: 120_000,
    });
    expect(parseRemoteWorkspaceIdentity(tabB.workspaceIdentity!)?.sourceServerId).toBe(sourceId);
    const projectAId = await $(
      `[data-project-workspace-identity="${tabA.workspaceIdentity}"]`,
    ).getAttribute("data-project-id");
    const projectBId = await $(
      `[data-project-workspace-identity="${tabB.workspaceIdentity}"]`,
    ).getAttribute("data-project-id");
    if (!projectAId || !projectBId) throw new Error(`${CASE_MARKER}: MissingProject身份`);
    const entryPresent = (projectId: string) => {
      const db = new DatabaseSync(join(getE2EAppDataPaths().appDataDir, "tasks-index.sqlite"), {
        readOnly: true,
      });
      try {
        return Boolean(
          db
            .prepare("SELECT 1 FROM remote_project_entries WHERE host_id=? AND remote_project_id=?")
            .get(`remote:server:${sourceId}`, projectId),
        );
      } finally {
        db.close();
      }
    };
    expect(entryPresent(projectBId)).toBe(true);
    facts.online = {
      a: tabA.remoteSessionId,
      b: tabB.remoteSessionId,
      sharedSession: tabA.remoteSessionId === tabB.remoteSessionId,
      accepted: proxy.acceptedCount(),
    };

    await selectTaskOrganizeMode(["项目", "Project"]);

    await disconnectRemoteSource(sourceId!, CASE_MARKER, {
      workspaceIdentities: [tabA.workspaceIdentity!, tabB.workspaceIdentity!],
    });

    proxy.setStall(true);
    const acceptedBeforeReconnect = proxy.acceptedCount();
    await requestRemoteProjectConnection(tabA.workspaceIdentity!, CASE_MARKER);
    await browser.waitUntil(() => Promise.resolve(proxy!.pendingCount() > 0), {
      timeout: 30_000,
      timeoutMsg: `${CASE_MARKER}: Reconnect没有产生停摆的 TCP Connect`,
    });
    await browser.waitUntil(
      async () =>
        (await $(`[data-project-workspace-identity="${tabA.workspaceIdentity}"]`).getAttribute(
          "data-connection-state",
        )) === "connecting",
      { timeout: 15_000 },
    );
    facts.waiting = {
      status: "connecting",
      pendingConnections: proxy.pendingCount(),
      acceptedSinceReconnect: proxy.acceptedCount() - acceptedBeforeReconnect,
    };

    const requestsBeforeWizard = await readHostConnectRequests();
    await openSSHRemoteDialog(CASE_MARKER);
    await fillSSHPasswordSettings(proxied);
    await clickLastEnabledSSHDialogButton(CASE_MARKER);
    await browser.waitUntil(
      async () => {
        const requests = await readHostConnectRequests();
        return [...requests].some((id) => !requestsBeforeWizard.has(id));
      },
      { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: 第Two个Waiting者没有到达 Host` },
    );
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const button = [
            ...document.querySelectorAll<HTMLButtonElement>('[data-testid="ssh-dialog"] button'),
          ].find(
            (item) =>
              ["取消连接", "Cancel connection"].includes(item.innerText.trim()) && !item.disabled,
          );
          button?.click();
          return Boolean(button);
        }),
      { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: 第Two个向导Waiting者没有Cancel入口` },
    );
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const dialog = document.querySelector('[data-testid="ssh-dialog"]');
          return !dialog || /Canceled|Cancelled/u.test(dialog.textContent ?? "");
        }),
      { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: 向导Cancel没有收口` },
    );
    if (await $('[data-testid="ssh-dialog"]').isExisting()) {
      await $('[data-testid="ssh-dialog"]')
        .$('.//button[normalize-space(.)="关闭" or normalize-space(.)="关闭"]')
        .click();
      await $('[data-testid="ssh-dialog"]').waitForExist({ reverse: true });
    }
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON);
    expect(proxy.pendingCount()).toBe(1);
    facts.cancelledWizardDidNotCancelProject = true;

    await removeRemoteProjectEntry(workspaceB, CASE_MARKER);
    const bEntryGone = !(await $(
      `[data-project-workspace-identity="${tabB.workspaceIdentity}"]`,
    ).isExisting());
    facts.closedBVia = "sidebar-entry-removal";
    const afterClose = await browser.execute((key) => {
      const row = document.querySelector<HTMLElement>(`[data-project-workspace-identity="${key}"]`);
      return row?.dataset.connectionState ?? null;
    }, tabA.workspaceIdentity!);
    const entriesAfterClose = (await readSettings()).lastWorkspaceSession ?? [];
    const bTabGone = !(await readRemoteTabSnapshot(tabB.workspaceIdentity!)).workspaceIdentity;
    facts.afterCloseB = {
      sourceStatus: afterClose,
      pendingConnections: proxy.pendingCount(),
      aEntryPresent: entryPresent(projectAId),
      bEntryPresent: entryPresent(projectBId),
      bRemovedFromSettings: !entriesAfterClose.some(
        (entry) => entry.kind === "remote" && entry.workspacePath === workspaceB,
      ),
      bEntryGone,
      bTabGone,
    };
    expect(facts.afterCloseB).toMatchObject({
      aEntryPresent: true,
      bEntryPresent: false,
      bEntryGone: true,
    });
    expect(proxy.pendingCount()).toBeGreaterThan(0);

    const released = proxy.release();
    proxy.setStall(false);
    facts.released = released;
    expect(released).toBeGreaterThan(0);
    const restored = await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: tabA.workspaceIdentity!,
      expectedPath: workspaceA,
      requireActive: false,
      timeoutMs: 60_000,
    });
    const sessionA = restored.remoteSessionId;
    facts.cameOnlineAfterRelease = true;
    expect(sessionA).not.toBe(tabA.remoteSessionId);
    await browser.pause(5_000);
    const finalEntries = (await readSettings()).lastWorkspaceSession ?? [];
    const finalB = await readRemoteTabSnapshot(tabB.workspaceIdentity!);
    facts.final = {
      sessionA,
      regenerated: sessionA !== tabA.remoteSessionId,
      bTabPresent: Boolean(finalB?.workspaceIdentity),
      bEntryPresent: entryPresent(projectBId),
      bNavigationEntryPresent: finalEntries.some(
        (entry) => entry.kind === "remote" && entry.workspacePath === workspaceB,
      ),
      accepted: proxy.acceptedCount(),
    };
    expect(
      await $(`[data-project-workspace-identity="${tabB.workspaceIdentity}"]`).isExisting(),
    ).toBe(false);
    expect(proxy.acceptedCount() - acceptedBeforeReconnect).toBe(1);
    expect(entryPresent(projectAId)).toBe(true);
    expect(entryPresent(projectBId)).toBe(false);
    expect(await readHostProcesses()).toEqual(initialHosts);
    const remoteAgents = await runSSHCommand(
      direct,
      `for d in /proc/[0-9]*; do c=$(tr "\\0" " " < "$d/cmdline" 2>/dev/null) || continue; case "$c" in *"app-server --stdi"[o]*) echo "$(readlink $d/cwd)";; esac; done`,
    );
    facts.remoteAgentCwds = remoteAgents.stdout.trim().split("\n").filter(Boolean);
  });
});
