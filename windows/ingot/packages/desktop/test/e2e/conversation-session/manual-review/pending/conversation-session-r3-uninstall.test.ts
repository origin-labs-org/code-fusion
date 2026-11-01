import { runConfirmedProcess } from "#e2e/helpers/confirmed-process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildServerRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";
import {
  TID_SETTINGS_PAGE,
  TID_SETTINGS_BACK_BUTTON,
  TID_CONFIRM_DIALOG_CONFIRM,
  TID_SSH_ERROR,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  getE2EAppDataPaths,
  readSettings,
} from "#e2e/helpers/desktop-app";
import { getV4Messages, getV4ConversationState } from "#e2e/helpers/v4-conversation";
import {
  prepareSSHLifecycle,
  connectSSHWorkspaceAndSendFirstTurn,
  type SSHLifecycleProvider,
  sendSSHFollowTurn,
  waitForRemoteWorkspaceDisconnected,
} from "#e2e/helpers/ssh-remote-lifecycle";
import {
  openWorkspaceDraftFromSidebar,
  selectTaskOrganizeMode,
} from "#e2e/helpers/workspace-agent-warmup";
import {
  clickLastEnabledSSHDialogButton,
  fillSSHPasswordSettings,
  openSSHRemoteDialog,
  openRemoteProjectSelection,
  readHostProcesses,
  readRemoteTabSnapshot,
  runSSHCommand,
  waitForSSHDirectoryStep,
  selectSSHRemoteDirectory,
  waitForRemoteTab,
  type SSHConnectionConfig,
} from "#e2e/helpers/ssh-remote-p0";

import { requestRemoteProjectConnection } from "#e2e/helpers/remote-project-actions";

const CASE_MARKER = "E2E_R3_UNINSTALL";
const variant = process.env.R3_UNINSTALL_CASE ?? "preserve-data";
if (variant !== "preserve-data" && variant !== "replace-environment") {
  throw new Error(`Unsupported R3_UNINSTALL_CASE: ${variant}`);
}
const artifactDir = resolve(process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-uninstall");

async function readInstallFacts(config: SSHConnectionConfig) {
  const result = await runSSHCommand(
    config,
    'echo "installationId=$(grep -o \'"installationId": *"[^"]*"\' "$HOME/.cf/server/install.json" 2>/dev/null | grep -oE "[0-9a-f-]{36}")"; ' +
      'echo "current=$(test -f "$HOME/.cf/server/current.json" && echo present || echo none)"; ' +
      'echo "releases=$(ls "$HOME/.cf/server/releases" 2>/dev/null | tr "\\n" ",")"; ' +
      'echo "configSentinel=$(cat "$HOME/.cf/server/config/e2e-sentinel.txt" 2>/dev/null || echo none)"; ' +
      'echo "legacyAsset=$(test -e "$HOME/.cf/server/e2e-legacy-asset.bin" && echo present || echo none)"; ' +
      'echo "userData=$(cat "$HOME/.cf/e2e-user-data.txt" 2>/dev/null || echo none)"; ' +
      'echo "serverEntries=$(ls -A "$HOME/.cf/server" 2>/dev/null | tr "\\n" ",")"; ' +
      'echo "uninstalledMarker=$(cat "$HOME/.cf/server/uninstalled.json" 2>/dev/null | tr -d "\\n ")"',
  );
  return Object.fromEntries(
    result.stdout
      .trim()
      .split("\n")
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  ) as Record<string, string>;
}

async function readVisibleTaskIds(identity: string): Promise<string[]> {
  await selectTaskOrganizeMode(["项目", "Project"]);
  const newProject = $(
    `[data-project-workspace-identity="${identity}"] [data-testid="virtual-project-toggle"]`,
  );
  if ((await newProject.getAttribute("aria-expanded")) !== "true") await newProject.click();
  let newTaskIds: string[] = [];
  await browser.waitUntil(
    async () => {
      const visible = await browser.execute((identity) => {
        const row = document.querySelector<HTMLElement>(
          `[data-project-workspace-identity="${identity}"]`,
        );
        const taskIds = Array.from(
          row?.querySelectorAll<HTMLElement>('[data-testid^="task-item-"]') ?? [],
        ).map((item) => item.dataset.testid!.slice("task-item-".length));
        return { taskIds, empty: /暂无Task|No tasks/iu.test(row?.textContent ?? "") };
      }, identity);
      newTaskIds = visible.taskIds;
      return visible.empty || newTaskIds.length > 0;
    },
    { timeout: 30_000, timeoutMsg: `${CASE_MARKER}: Project Task List未Completed加载` },
  );
  return newTaskIds;
}

describe(`${CASE_MARKER}: ${variant}，卸载重装与独立环Context替换`, () => {
  const facts: Record<string, unknown> = { variant };
  let provider: SSHLifecycleProvider | null = null;

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "uninstall.json"), JSON.stringify(facts, null, 2));
    await provider?.tunnel.close();
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it(`R3A-UPG-09 ${variant}: 卸载Retain身份与历史；独立环Context才确认NewDevice`, async function () {
    this.timeout(20 * 60_000);
    const prepared = await prepareSSHLifecycle(CASE_MARKER, { tunnelUsername: "tunnel" });
    provider = prepared.provider;
    const config = prepared.config;
    const workspaceA = config.workspacePaths[0];
    const initialHosts = await readHostProcesses();

    const firstTab = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config,
      provider,
      label: "A",
      workspacePath: workspaceA,
    });
    facts.originalTask = {
      taskId: firstTab.taskId,
      identity: firstTab.identity,
      prompt: firstTab.firstPrompt,
    };
    facts.firstSession = firstTab.remoteSessionId;
    const originalSettings = await readSettings();

    const seed = await runSSHCommand(
      config,
      'mkdir -p "$HOME/.cf/server/config" && echo R3_CONFIG_SENTINEL > "$HOME/.cf/server/config/e2e-sentinel.txt" && ' +
        'head -c 1024 /dev/zero > "$HOME/.cf/server/e2e-legacy-asset.bin" && echo R3_USER_DATA > "$HOME/.cf/e2e-user-data.txt" && echo ok',
    );
    expect(seed.stdout.trim()).toBe("ok");
    const before = await readInstallFacts(config);
    facts.before = before;
    const previousInstallationId = before.installationId;
    if (!previousInstallationId) throw new Error("No installation identity on initial install");
    expect(previousInstallationId).toMatch(/^[0-9a-f-]{36}$/u);
    if (before.current === "present") {
      const container = process.env.CF_E2E_SSH_CONTAINER?.trim();
      if (!container) throw new Error(`${CASE_MARKER}: Missing CF_E2E_SSH_CONTAINER`);
      const uninstallStarted = performance.now();
      const uninstall = await runConfirmedProcess(
        "docker",
        [
          "exec",
          "-i",
          "-u",
          "dev",
          container,
          "bash",
          "-lc",
          '"$HOME/.cf/server/bin/cf" uninstall --server-root "$HOME/.cf/server" --json',
        ],
        {
          prompts: ["Type DELETE to uninstall CodeFusion Server: ", "Type DELETE again to confirm: "],
          answer: "DELETE",
          timeoutMs: 120_000,
        },
      );
      facts.uninstallDurationMs = Math.round(performance.now() - uninstallStarted);
      facts.uninstallOutput = uninstall.stdout.trim().split("\n").slice(-3);
      expect(uninstall.stdout).toContain('"uninstalled":true');
      expect(uninstall.stdout).toMatch(/"preservedPaths":\[[^\]]*"config"/u);
    } else {
      facts.uninstallOutput = "already uninstalled before this run (marker present)";
      expect(before.uninstalledMarker).toContain('"uninstalled":true');
    }
    const after = await readInstallFacts(config);
    facts.afterUninstall = after;
    expect(after.installationId).toBe(previousInstallationId);
    expect(after.current).toBe("none");
    expect(after.releases).toBe("");
    expect(after.configSentinel).toBe("R3_CONFIG_SENTINEL");
    expect(after.legacyAsset).toBe("present");
    expect(after.userData).toBe("R3_USER_DATA");
    expect(after.uninstalledMarker).toContain('"uninstalled":true');
    expect(after.uninstalledMarker).toContain("config");

    if (variant === "preserve-data") {
      await waitForRemoteWorkspaceDisconnected(firstTab.identity, CASE_MARKER);
      await requestRemoteProjectConnection(firstTab.identity, CASE_MARKER);
      await (async () => {
        const button = $('[data-testid="ssh-dialog"]').$(
          './/button[normalize-space(.)="安装并继续" or normalize-space(.)="安装并继续"]',
        );
        await button.waitForClickable({
          timeout: 30_000,
          timeoutMsg: `${CASE_MARKER}: 原Project没有Show重NewInstall确认`,
        });
        await button.click();
      })().catch(async (cause: unknown) => {
        facts.reinstallFailure = {
          installation: await readInstallFacts(config),
          tab: await readRemoteTabSnapshot(firstTab.identity),
          ui: await browser.execute(
            (identity) => ({
              dialog: document.querySelector('[data-testid="ssh-dialog"]')?.textContent ?? null,
              projectState:
                document
                  .querySelector(`[data-project-workspace-identity="${identity}"]`)
                  ?.getAttribute("data-connection-state") ?? null,
            }),
            firstTab.identity,
          ),
        };
        throw cause;
      });
      facts.installConfirmationClicked = true;
      await $(`[data-testid="${TID_SSH_ERROR}"]`).waitForDisplayed({
        reverse: true,
        timeout: 30_000,
      });
      await waitForSSHDirectoryStep(CASE_MARKER);
      const restored = await waitForRemoteTab({
        caseMarker: CASE_MARKER,
        expectedIdentity: firstTab.identity,
        expectedPath: workspaceA,
      });
      expect(restored.remoteSessionId).toBeTruthy();
      expect(restored.remoteSessionId).not.toBe(firstTab.remoteSessionId);
      const installed = await readInstallFacts(config);
      expect(installed.installationId).toBe(previousInstallationId);
      expect(installed.current).toBe("present");
      expect(installed.configSentinel).toBe("R3_CONFIG_SENTINEL");
      expect(installed.userData).toBe("R3_USER_DATA");
      const settings = await readSettings();
      const profileIds = (value: typeof settings) =>
        value.connectionProfiles?.map((profile) => profile.profileId).sort();
      expect(profileIds(settings)).toEqual(profileIds(originalSettings));
      expect(settings.sourceServers?.map((source) => source.sourceServerId).sort()).toEqual(
        originalSettings.sourceServers?.map((source) => source.sourceServerId).sort(),
      );
      for (const original of originalSettings.connectionProfiles ?? []) {
        const current = settings.connectionProfiles?.find(
          (profile) => profile.profileId === original.profileId,
        );
        expect(current?.sourceServerId).toBe(original.sourceServerId);
        expect(current?.target).toEqual(original.target);
        expect(current?.lifecycleState).not.toBe("retired");
      }
      const projectKeys = (value: typeof settings) =>
        value.sourceServerWorkspaceHistory
          ?.map(({ sourceServerId, profileId, workspaceIdentity, workspacePath }) =>
            JSON.stringify({ sourceServerId, profileId, workspaceIdentity, workspacePath }),
          )
          .sort();
      expect(projectKeys(settings)).toEqual(projectKeys(originalSettings));
      const taskIds = await readVisibleTaskIds(firstTab.identity);
      expect(taskIds).toContain(firstTab.taskId);
      await sendSSHFollowTurn(
        { ...firstTab, remoteSessionId: restored.remoteSessionId! },
        CASE_MARKER,
      );
      expect((await getV4ConversationState()).taskId).toBe(firstTab.taskId);
      facts.preservedIdentity = {
        sourceServerId: installed.installationId,
        workspaceIdentity: restored.workspaceIdentity,
        profileIds: profileIds(settings),
        originalProjectKeys: projectKeys(originalSettings),
        restoredProjectKeys: projectKeys(settings),
        previousSession: firstTab.remoteSessionId,
        restoredSession: restored.remoteSessionId,
        taskIds,
        continuedTaskId: firstTab.taskId,
      };
      await browser.saveScreenshot(resolve(artifactDir, "preserved-history.png"));
      expect(await readHostProcesses()).toEqual(initialHosts);
      return;
    }

    const replaced = await runSSHCommand(
      config,
      'test ! -e "$HOME/r3-uninstall-preserved-data" && mv "$HOME/.cf" "$HOME/r3-uninstall-preserved-data"',
    );
    expect(replaced.code).toBe(0);
    facts.originalDataArchived = true;
    await openWorkspaceDraftFromSidebar(resolve(getE2EAppDataPaths().homeDir, "CfProject"));
    await openSSHRemoteDialog(CASE_MARKER);
    await fillSSHPasswordSettings(config);
    await clickLastEnabledSSHDialogButton(CASE_MARKER);
    let identityError = "";
    try {
      await waitForSSHDirectoryStep(CASE_MARKER);
    } catch (error) {
      identityError = String(error);
    }
    facts.reconnectFirstAttempt = identityError.slice(0, 200);
    if (!/身份换代|身份已变化|identity has changed/iu.test(identityError)) {
      throw new Error(
        `${CASE_MARKER}: 首连预期报身份换代Error，实际: ${identityError || "(Success, contradicts isolated environment state)"}`,
      );
    }
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const close = Array.from(
            document.querySelectorAll<HTMLButtonElement>('[data-testid="ssh-dialog"] button'),
          ).find(
            (button) =>
              button.getClientRects().length &&
              !button.disabled &&
              ["关闭", "Close"].includes(button.innerText.trim()),
          );
          close?.click();
          return Boolean(close);
        }),
      { timeout: 30_000, interval: 500, timeoutMsg: `${CASE_MARKER}: 报Wrong向导没有Close按钮` },
    );
    await $('[data-testid="ssh-dialog"]').waitForExist({ reverse: true });
    if (!(await $(`[data-testid="${TID_SETTINGS_PAGE}"]`).isDisplayed())) {
      await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
        timeout: 15_000,
        timeoutMsg: `${CASE_MARKER}: No entry point set.`,
      });
    }
    await $(`[data-testid="${TID_SETTINGS_PAGE}"]`).waitForDisplayed({ timeout: 15_000 });
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "remoteDevices"), {
      timeout: 15_000,
      timeoutMsg: `${CASE_MARKER}: Settings页没有RemoteDevice分区`,
    });
    const pendingSettings = await readSettings();
    const oldProfile = pendingSettings.connectionProfiles?.find(
      (profile) =>
        profile.sourceServerId === previousInstallationId && profile.lifecycleState !== "retired",
    );
    expect(oldProfile).toBeDefined();
    const clickIdentityConfirmation = async () => {
      await browser.waitUntil(
        () =>
          browser.execute((sourceId) => {
            const card = document.querySelector(`[data-source-server-card="${sourceId}"]`);
            const button = Array.from(card?.querySelectorAll("button") ?? []).find(
              (node) =>
                node.getClientRects().length &&
                !node.disabled &&
                node.innerText.trim() === "作为新设备使用",
            );
            button?.click();
            return Boolean(button);
          }, previousInstallationId),
        { timeout: 30_000, timeoutMsg: `${CASE_MARKER}: 身份换代待确认，但Device卡没有Available确认入口` },
      );
      await $(`[data-testid="${TID_CONFIRM_DIALOG_CONFIRM}"]`).waitForDisplayed({
        timeout: 15_000,
      });
    };
    try {
      await clickIdentityConfirmation();
      await browser.saveScreenshot(resolve(artifactDir, "identity-confirmation.png"));
      await browser.keys(["Escape"]);
      await $(`[data-testid="${TID_CONFIRM_DIALOG_CONFIRM}"]`).waitForDisplayed({
        reverse: true,
        timeout: 15_000,
      });
      expect((await readSettings()).connectionProfiles).toEqual(pendingSettings.connectionProfiles);
      facts.cancelPreservedOriginalProfiles = true;
      await clickIdentityConfirmation();
      await clickTestIdByDom(TID_CONFIRM_DIALOG_CONFIRM);
      await browser.waitUntil(
        async () => {
          const settings = await readSettings();
          return (
            settings.connectionProfiles?.some(
              (profile) =>
                profile.profileId === oldProfile!.profileId && profile.lifecycleState === "retired",
            ) ?? false
          );
        },
        { timeout: 60_000, timeoutMsg: `${CASE_MARKER}: confirm后Old线路没有按身份替换合同Archive` },
      );
      const installed = await readInstallFacts(config);
      const settings = await readSettings();
      const replacement = settings.connectionProfiles?.find(
        (profile) =>
          profile.sourceServerId === installed.installationId &&
          profile.lifecycleState !== "retired",
      );
      expect(replacement).toBeDefined();
      expect(replacement!.profileId).not.toBe(oldProfile!.profileId);
      expect(installed.installationId).not.toBe(previousInstallationId);
      expect(
        settings.sourceServers?.some((server) => server.sourceServerId === previousInstallationId),
      ).toBe(true);
      expect(
        settings.sourceServerWorkspaceHistory?.filter(
          (entry) => entry.sourceServerId === previousInstallationId,
        ),
      ).toEqual(
        pendingSettings.sourceServerWorkspaceHistory?.filter(
          (entry) => entry.sourceServerId === previousInstallationId,
        ),
      );
      facts.identityConfirmed = {
        oldSource: previousInstallationId,
        newSource: installed.installationId,
        oldProfileRetired: true,
        replacementProfileCreated: true,
        oldHistoryPreserved: true,
      };
    } catch (error) {
      facts.identityConfirmationFailure = {
        message: String(error),
        settingsPanelText: await browser.execute(
          () =>
            document.querySelector<HTMLElement>('[data-testid="settings-page"]')?.innerText ??
            "absent",
        ),
        installation: await readInstallFacts(config),
      };
      throw error;
    }
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON);
    await openRemoteProjectSelection();
    const newInstallation = await readInstallFacts(config);
    await browser.waitUntil(
      () =>
        browser.execute((sourceId) => {
          const card = document.querySelector(
            `[data-testid="ssh-dialog"] [data-remote-source-server-id="${sourceId}"]`,
          );
          const button = card?.querySelector<HTMLButtonElement>("button:not(:disabled)");
          button?.click();
          return Boolean(button);
        }, newInstallation.installationId),
      { timeout: 30_000, timeoutMsg: `${CASE_MARKER}: confirm后没有NewInstall身份的选择Table of Contents入口` },
    );
    await waitForSSHDirectoryStep(CASE_MARKER);
    await selectSSHRemoteDirectory(workspaceA, CASE_MARKER);
    const reconnectedTab = await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedPath: workspaceA,
      expectedIdentity: buildServerRemoteWorkspaceIdentity({
        serverId: newInstallation.installationId!,
        workspacePath: workspaceA,
      }),
    });
    facts.reconnectedSession = {
      before: firstTab.remoteSessionId,
      after: reconnectedTab.remoteSessionId,
    };
    expect(reconnectedTab.remoteSessionId).toBeTruthy();
    expect(reconnectedTab.remoteSessionId).not.toBe(firstTab.remoteSessionId);
    const reinstalled = await readInstallFacts(config);
    facts.afterReinstall = reinstalled;
    expect(reinstalled.current).toBe("present");
    expect(reinstalled.installationId).toMatch(/[0-9a-f-]{36}/u);
    expect(reinstalled.installationId).not.toBe(previousInstallationId);
    facts.installationIdChanged = reinstalled.installationId !== previousInstallationId;
    expect(reinstalled.configSentinel).toBe("none");
    expect(reinstalled.userData).toBe("none");
    const runtime = JSON.parse(
      (await runSSHCommand(config, 'cat "$HOME/.cf/server/current.json"')).stdout,
    );
    const history = await runSSHCommand(
      config,
      `'${runtime.releaseDir}/runtime/node' --input-type=module -e 'import {DatabaseSync} from "node:sqlite";const db=new DatabaseSync(process.env.HOME+"/r3-uninstall-preserved-data/v2/tasks-index.sqlite");const rows=db.prepare("SELECT workspace_key FROM tasks WHERE task_id=?").all(process.argv[1]);db.close();process.stdout.write(JSON.stringify(rows));' '${firstTab.taskId}'`,
    );
    expect(history.code).toBe(0);
    const oldRows = JSON.parse(history.stdout) as Array<{ workspace_key: string }>;
    expect(oldRows.length).toBeGreaterThan(0);
    facts.preservedTaskStorageRows = oldRows;
    const newTaskIds = await readVisibleTaskIds(reconnectedTab.workspaceIdentity!);
    facts.newInstallationTaskIds = newTaskIds;
    expect(newTaskIds).not.toContain(firstTab.taskId);
    expect((await getV4ConversationState()).taskId).not.toBe(firstTab.taskId);
    expect(
      (await getV4Messages("user")).some((message) => message.text?.includes(firstTab.firstPrompt)),
    ).toBe(false);
    facts.oldHistoryPreservedOutsideNewEnvironment = true;
    await browser.saveScreenshot(resolve(artifactDir, "new-environment-empty.png"));
    expect(await readHostProcesses()).toEqual(initialHosts);
  });
});
