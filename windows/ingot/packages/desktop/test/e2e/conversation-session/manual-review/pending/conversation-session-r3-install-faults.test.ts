import { selectTaskOrganizeMode } from "../../../helpers/workspace-agent-warmup.js";
import { disconnectRemoteSource } from "#e2e/helpers/remote-project-actions";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  SOURCE_SERVER_RELEASE_DESCRIPTOR_FILE_NAME,
  parseRemoteWorkspaceIdentity,
  sourceServerReleaseDescriptorSchema,
  type SourceServerReleaseArchive,
} from "@origin-ai/cf-shared";
import {
  selectSourceServerReleaseArchive,
  withSourceServerReleaseFileFault,
} from "#e2e/helpers/source-server-release-faults";
import { clearAppData, DEFAULT_WORKSPACE } from "#e2e/helpers/desktop-app";
import { prepareV4ConversationE2E } from "#e2e/helpers/v4-conversation";
import { openWorkspaceDraftFromSidebar } from "#e2e/helpers/workspace-agent-warmup";
import {
  clickLastEnabledSSHDialogButton,
  connectSSHWorkspace,
  fillSSHPasswordSettings,
  openSSHRemoteDialog,
  readDualSSHRuntimeConfig,
  readHostProcesses,
  readRemoteTabSnapshot,
  readSSHRuntimeConfig,
  runSSHCommand,
  selectSSHRemoteDirectory,
  waitForRemoteTab,
  waitForSSHDirectoryStep,
  type SSHConnectionConfig,
} from "#e2e/helpers/ssh-remote-p0";

const CASE_MARKER = "E2E_R3_INSTALL_FAULTS";
const DESKTOP_ROOT = resolve(import.meta.dirname, "../../../../..");
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-install-faults",
);

interface FaultRecord {
  fault: string;
  target: string;
  archiveFileName: string;
  port: number;
  dialogState: string;
  errorText: string;
  remoteInstalledAfter: string;
  remoteTabSessionId: string | null;
  hostsUnchanged: boolean;
}

async function stagedReleaseDir(): Promise<string> {
  const runId = process.env.CF_E2E_RUN_ID?.trim();
  if (!runId) throw new Error(`${CASE_MARKER}: CF_E2E_RUN_ID 缺失`);
  const { version } = JSON.parse(
    await readFile(resolve(DESKTOP_ROOT, "../../package.json"), "utf8"),
  );
  return join(DESKTOP_ROOT, ".e2e-cache", runId, "mock-cdn", "releases", version);
}

async function remoteInstalledState(config: SSHConnectionConfig): Promise<string> {
  const result = await runSSHCommand(
    config,
    'if [ -f "$HOME/.cf/server/current.json" ]; then grep -o \'"archiveSha256": *"[0-9a-f]*"\' "$HOME/.cf/server/current.json"; else echo none; fi',
  );
  return result.stdout.trim() || `exit=${result.code}`;
}

async function attemptConnectExpectingFailure(
  config: SSHConnectionConfig,
  fault: string,
  initialHosts: Array<{ name: string; pid: number }>,
  archive: SourceServerReleaseArchive,
): Promise<FaultRecord> {
  await openSSHRemoteDialog(CASE_MARKER);
  await fillSSHPasswordSettings(config);
  await clickLastEnabledSSHDialogButton(CASE_MARKER);
  let errorText = "";
  let dialogState = "waiting";
  let record: FaultRecord;
  try {
    await browser.waitUntil(
      async () => {
        const state = await browser.execute(() => {
          const error = document.querySelector<HTMLElement>('[data-testid="ssh-error"]');
          if (error?.getClientRects().length) return `error:${error.innerText.trim()}`;
          const dialog = document.querySelector('[data-testid="ssh-dialog"]');
          const install = Array.from(
            dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [],
          ).find(
            (item) =>
              item.getClientRects().length &&
              !item.disabled &&
              ["安装并继续", "Install and continue"].includes(item.innerText.trim()),
          );
          if (install) {
            install.click();
            return "confirmed";
          }
          return dialog ? "waiting" : "dialog-gone";
        });
        dialogState = state.startsWith("error:") ? "error" : state;
        if (state === "dialog-gone") return true;
        if (state.startsWith("error:")) {
          errorText = state.slice("error:".length);
          return true;
        }
        return false;
      },
      { timeout: 120_000, interval: 300, timeoutMsg: `${CASE_MARKER}: ${fault} 没有Show明确Error` },
    );
  } finally {
    const snapshot = await readRemoteTabSnapshot();
    record = {
      fault,
      target: archive.target,
      archiveFileName: archive.fileName,
      port: config.port,
      dialogState,
      errorText,
      remoteInstalledAfter: await remoteInstalledState(config),
      remoteTabSessionId: snapshot.remoteSessionId,
      hostsUnchanged: JSON.stringify(await readHostProcesses()) === JSON.stringify(initialHosts),
    };
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, `${fault}.json`), JSON.stringify(record, null, 2));
  }
  if (dialogState === "dialog-gone") {
    throw new Error(`${CASE_MARKER}: ${fault} 未停留在Error态: ${JSON.stringify(record)}`);
  }
  expect(record.errorText).toMatch(/资源|校验|Install包|release|archive|verification/iu);
  expect(record.errorText).not.toContain(config.password);
  expect(record.hostsUnchanged).toBe(true);
  await closeSSHDialogFromError();
  return record;
}

async function closeSSHDialogFromError(): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const dialog = document.querySelector<HTMLElement>('[data-testid="ssh-dialog"]');
        if (!dialog) return true;
        const back = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find(
          (item) =>
            item.getClientRects().length &&
            !item.disabled &&
            ["返回配置", "Back to settings", "关闭", "Close"].includes(item.innerText.trim()),
        );
        back?.click();
        const close = document.querySelector<HTMLButtonElement>(
          '[data-testid="ssh-dialog"] button[aria-label="关闭"], [data-testid="ssh-dialog"] button[aria-label="Close"]',
        );
        close?.click();
        return false;
      }),
    { timeout: 30_000, interval: 300, timeoutMsg: `${CASE_MARKER}: Failed后无法Close SSH 向导` },
  );
  await browser.keys(["Escape"]);
  await browser.waitUntil(
    () => browser.execute(() => !document.querySelector('[data-testid="ssh-dialog"]')),
    { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: SSH 向导没有Close` },
  );
}

describe(`${CASE_MARKER}: Local release 产物缺失/校验Failed与Install确认Cancel`, () => {
  const records: FaultRecord[] = [];

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "install-faults.json"), JSON.stringify(records, null, 2));
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-BLD-04/06 Missing descriptor, missing archive, SHA/size mismatch all fail explicitly without persisting; retry succeeds after cancelling confirmation", async function () {
    this.timeout(30 * 60_000);
    const fresh = readSSHRuntimeConfig(CASE_MARKER);
    const dual = readDualSSHRuntimeConfig(CASE_MARKER);
    const installedTarget = dual.targets[1];
    await prepareV4ConversationE2E({ skipProvider: true });
    const initialHosts = await readHostProcesses();
    expect(initialHosts).toHaveLength(1);
    expect(await remoteInstalledState(fresh)).toBe("none");
    const preinstalled = await connectSSHWorkspace({
      caseMarker: CASE_MARKER,
      config: installedTarget,
      workspacePath: dual.workspacePath,
    });
    expect(preinstalled.remoteSessionId).toBeTruthy();
    const installedBefore = await remoteInstalledState(installedTarget);
    expect(installedBefore).toContain("archiveSha256");

    const installedIdentity = preinstalled.workspaceIdentity!;
    const installedSourceId = parseRemoteWorkspaceIdentity(installedIdentity)?.sourceServerId;
    expect(installedSourceId).toBeTruthy();
    await selectTaskOrganizeMode(["项目", "Project"]);
    await disconnectRemoteSource(installedSourceId!, CASE_MARKER, {
      workspaceIdentities: [installedIdentity],
    });
    await openWorkspaceDraftFromSidebar(DEFAULT_WORKSPACE);

    const releaseDir = await stagedReleaseDir();
    const descriptorPath = join(releaseDir, SOURCE_SERVER_RELEASE_DESCRIPTOR_FILE_NAME);
    const originalDescriptor = await readFile(descriptorPath, "utf8");
    const descriptor = sourceServerReleaseDescriptorSchema.parse(JSON.parse(originalDescriptor));
    const readTargetArchive = async (config: SSHConnectionConfig) => {
      const environment = await runSSHCommand(config, "uname -s && uname -m");
      expect(environment.code).toBe(0);
      const [platform = "", arch = ""] = environment.stdout.trim().split(/\r?\n/);
      const entry = selectSourceServerReleaseArchive(descriptor, { platform, arch });
      const path = join(releaseDir, entry.fileName);
      const bytes = await readFile(path);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
      expect((await stat(path)).size).toBe(entry.sizeBytes);
      return { entry, path, bytes };
    };
    const freshArchive = await readTargetArchive(fresh);
    const installedArchive = await readTargetArchive(installedTarget);
    expect(installedBefore).toContain(installedArchive.entry.sha256);

    expect(await readHostProcesses()).toEqual(initialHosts);

    const expectFreshFailure = async (fault: string) => {
      const record = await attemptConnectExpectingFailure(
        fresh,
        fault,
        initialHosts,
        freshArchive.entry,
      );
      records.push(record);
      expect(record.remoteInstalledAfter).toBe("none");
      expect(record.remoteTabSessionId).toBeNull();
    };

    await withSourceServerReleaseFileFault(descriptorPath, null, () =>
      expectFreshFailure("descriptor-missing"),
    );

    await withSourceServerReleaseFileFault(freshArchive.path, null, () =>
      expectFreshFailure("archive-missing"),
    );

    const tamperedArchive = Buffer.from(freshArchive.bytes);
    tamperedArchive[0] = tamperedArchive[0]! ^ 1;
    await withSourceServerReleaseFileFault(freshArchive.path, tamperedArchive, () =>
      expectFreshFailure("archive-sha-mismatch"),
    );

    const sizeTampered = {
      ...descriptor,
      archives: descriptor.archives.map((entry) =>
        entry.target === freshArchive.entry.target
          ? { ...entry, sizeBytes: entry.sizeBytes + 1 }
          : entry,
      ),
    };
    await withSourceServerReleaseFileFault(descriptorPath, JSON.stringify(sizeTampered), () =>
      expectFreshFailure("descriptor-size-mismatch"),
    );

    await withSourceServerReleaseFileFault(
      installedArchive.path,
      Buffer.concat([installedArchive.bytes, Buffer.from("e2e-tamper")]),
      async () => {
        const record = await attemptConnectExpectingFailure(
          installedTarget,
          "installed-target-local-archive-tampered",
          initialHosts,
          installedArchive.entry,
        );
        records.push(record);
        expect(record.remoteInstalledAfter).toBe(installedBefore);
      },
    );

    await openSSHRemoteDialog(CASE_MARKER);
    await fillSSHPasswordSettings(fresh);
    await clickLastEnabledSSHDialogButton(CASE_MARKER);
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const dialog = document.querySelector('[data-testid="ssh-dialog"]');
          const buttons = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? []);
          const install = buttons.find(
            (item) =>
              item.getClientRects().length &&
              ["安装并继续", "Install and continue"].includes(item.innerText.trim()),
          );
          if (!install) return false;
          const cancel = buttons.find(
            (item) =>
              item.getClientRects().length &&
              !item.disabled &&
              ["取消", "Cancel"].includes(item.innerText.trim()),
          );
          if (!cancel) return false;
          cancel.click();
          return true;
        }),
      { timeout: 90_000, interval: 300, timeoutMsg: `${CASE_MARKER}: 没有出现可Cancel的Install确认` },
    );
    await browser.pause(3000);
    const afterCancel = {
      remoteInstalled: await remoteInstalledState(fresh),
      remoteTabSessionId: (await readRemoteTabSnapshot()).remoteSessionId,
      dialogState: await browser.execute(() => {
        const dialog = document.querySelector<HTMLElement>('[data-testid="ssh-dialog"]');
        return dialog ? dialog.innerText.slice(0, 400) : "dialog-gone";
      }),
      hosts: await readHostProcesses(),
    };
    expect(afterCancel.remoteInstalled).toBe("none");
    expect(afterCancel.remoteTabSessionId).toBeNull();
    expect(afterCancel.hosts).toEqual(initialHosts);
    await mkdir(artifactDir, { recursive: true });
    await writeFile(
      resolve(artifactDir, "install-cancel.json"),
      JSON.stringify(afterCancel, null, 2),
    );
    if (afterCancel.dialogState !== "dialog-gone") {
      await browser.keys(["Escape"]);
      await browser.waitUntil(
        () => browser.execute(() => !document.querySelector('[data-testid="ssh-dialog"]')),
        { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: CancelInstall后向导没有Close` },
      );
    }

    await openSSHRemoteDialog(CASE_MARKER);
    await fillSSHPasswordSettings(fresh);
    await clickLastEnabledSSHDialogButton(CASE_MARKER);
    await waitForSSHDirectoryStep(CASE_MARKER);
    await selectSSHRemoteDirectory(fresh.workspacePaths[0], CASE_MARKER);
    const tab = await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedPath: fresh.workspacePaths[0],
    });
    expect(tab.remoteSessionId).toBeTruthy();
    expect(await remoteInstalledState(fresh)).toContain(freshArchive.entry.sha256);
    expect(await readHostProcesses()).toEqual(initialHosts);
    const project = await connectSSHWorkspace({
      caseMarker: CASE_MARKER,
      config: fresh,
      workspacePath: fresh.workspacePaths[0],
    });
    expect(project.remoteSessionId).toBeTruthy();
  });
});
