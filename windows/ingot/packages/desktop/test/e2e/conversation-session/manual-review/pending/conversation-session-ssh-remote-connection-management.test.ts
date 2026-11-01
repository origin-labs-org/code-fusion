import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";
import {
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  TID_SSH_PORT_INPUT,
  TID_REMOTE_KIND_SSH,
  TID_CONFIRM_DIALOG_CONFIRM,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  getE2EAppDataPaths,
  readSettings,
} from "#e2e/helpers/desktop-app";
import {
  disconnectRemoteSource,
  connectRemoteSourceFromSettings,
  requestRemoteProjectConnection,
} from "#e2e/helpers/remote-project-actions";
import { createStallableTcpProxy } from "#e2e/helpers/ssh-stallable-proxy";
import {
  connectSSHWorkspace,
  openRemoteProjectSelection,
  fillSSHPasswordSettings,
  clickLastEnabledSSHDialogButton,
  waitForSSHDirectoryStep,
  selectSSHRemoteDirectory,
  readSSHRuntimeConfig,
  readRemoteTabSnapshot,
  runSSHCommand,
  waitForRemoteTab,
} from "#e2e/helpers/ssh-remote-p0";
import { prepareV4ConversationE2E } from "#e2e/helpers/v4-conversation";

const MARKER = "E2E_SSH_CONNECTION_MANAGEMENT";
const deviceName = "SSH guide device";
const primaryName = "SSH guide primary";
const scenario = process.env.R3_CONNECTION_MANAGEMENT_CASE ?? "edit";
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/ssh-connection-management",
);

async function openSettings() {
  if (!(await $(`[data-testid="${TID_SETTINGS_PAGE}"]`).isDisplayed()))
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON);
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "remoteDevices"));
}

async function clickLabel(label: string, root = "[data-settings-content-frame]") {
  await browser.waitUntil(
    () =>
      browser.execute(
        (text, selector) => {
          const button = Array.from(
            document
              .querySelector(selector)
              ?.querySelectorAll<HTMLElement>('button, [role="menuitem"]') ?? [],
          ).find(
            (item) =>
              item.getClientRects().length &&
              item.textContent?.trim() === text &&
              !item.matches(":disabled"),
          );
          button?.click();
          return Boolean(button);
        },
        label,
        root,
      ),
    { timeout: 15_000, timeoutMsg: `${MARKER}: Missing ${label}` },
  );
}

async function clickLineAction(lineName: string, label: string) {
  await browser.waitUntil(
    () =>
      browser.execute(
        (name, text) => {
          const button = Array.from(
            document.querySelectorAll<HTMLButtonElement>("[data-settings-content-frame] button"),
          ).find((item) => {
            const line = item.closest("div.group\\/line") ?? item.parentElement;
            return (
              line?.textContent?.includes(name) &&
              (item.textContent?.trim() === text || item.getAttribute("aria-label") === text) &&
              !item.disabled
            );
          });
          button?.click();
          return Boolean(button);
        },
        lineName,
        label,
      ),
    { timeout: 15_000, timeoutMsg: `${MARKER}: ${lineName} Missing ${label}` },
  );
}

describe(`${MARKER}: Edit、多ConnectDefault value与移除`, () => {
  const facts: Record<string, unknown> = { scenario };
  let editedRoute: Awaited<ReturnType<typeof createStallableTcpProxy>> | undefined;
  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(
      resolve(artifactDir, "connection-management.json"),
      JSON.stringify(facts, null, 2),
    );
    await editedRoute?.close();
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it(`SSH-GUIDE-MANAGE ${scenario}: EditReconnectorDefault/移除的独立场景`, async function () {
    this.timeout(15 * 60_000);
    if (!["edit", "lifecycle"].includes(scenario)) throw new Error("未知设备管理场景");
    const config = readSSHRuntimeConfig(MARKER);
    await prepareV4ConversationE2E({ skipProvider: true });
    const first = await connectSSHWorkspace({
      caseMarker: MARKER,
      config,
      workspacePath: config.workspacePaths[0],
    });
    const second = await connectSSHWorkspace({
      caseMarker: MARKER,
      config,
      workspacePath: config.workspacePaths[1],
    });
    const sourceId = parseRemoteWorkspaceIdentity(first.workspaceIdentity!)?.sourceServerId;
    if (!sourceId) throw new Error("缺少设备身份");
    editedRoute = await createStallableTcpProxy(config);
    expect(
      (
        await runSSHCommand(
          config,
          `printf GUIDE_KEEP_REMOTE > '${config.workspacePaths[0]}/guide-remove-sentinel.txt'`,
        )
      ).code,
    ).toBe(0);
    await openSettings();
    await clickLabel("编辑");
    await $("#edit-connection-name").setValue(primaryName);
    await $("#edit-device-name").setValue(deviceName);
    if (scenario === "edit")
      await $(`[data-testid="${TID_SSH_PORT_INPUT}"]`).setValue(String(editedRoute.port));
    await clickLabel("Save Changes", '[role="dialog"]');
    await $('[role="dialog"]').waitForDisplayed({ reverse: true });
    const savedProfile = (await readSettings()).connectionProfiles?.find(
      (profile) => profile.displayName === primaryName,
    );
    expect(savedProfile?.target.kind === "ssh" ? savedProfile.target.port : null).toBe(
      scenario === "edit" ? editedRoute.port : config.port,
    );
    facts.savedRoutePort = scenario === "edit" ? editedRoute.port : config.port;
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON);
    expect(
      (
        await waitForRemoteTab({
          caseMarker: MARKER,
          expectedIdentity: first.workspaceIdentity!,
          expectedPath: first.workspacePath!,
          requireActive: false,
        })
      ).remoteSessionId,
    ).toBe(first.remoteSessionId);
    expect(editedRoute.acceptedCount()).toBe(0);
    if (scenario === "edit") {
      await disconnectRemoteSource(sourceId, MARKER);
      await browser.waitUntil(
        async () =>
          (await readRemoteTabSnapshot(first.workspaceIdentity!)).remoteSessionId === null,
        { timeout: 30_000 },
      );
      await requestRemoteProjectConnection(first.workspaceIdentity!, MARKER);
      await waitForRemoteTab({
        caseMarker: MARKER,
        expectedIdentity: first.workspaceIdentity!,
        expectedPath: first.workspacePath!,
        requireActive: false,
      });
      const restoredSibling = await waitForRemoteTab({
        caseMarker: MARKER,
        expectedIdentity: second.workspaceIdentity!,
        expectedPath: second.workspacePath!,
        requireActive: false,
      });
      expect(restoredSibling.remoteSessionId).not.toBe(second.remoteSessionId);
      expect(editedRoute.acceptedCount()).toBeGreaterThan(0);
      const reconnectedProfiles = (await readSettings()).connectionProfiles?.filter(
        (profile) => profile.sourceServerId === sourceId && profile.lifecycleState !== "retired",
      );
      expect(reconnectedProfiles).toHaveLength(1);
      expect(reconnectedProfiles?.[0]?.profileId).toBe(savedProfile?.profileId);
      expect(reconnectedProfiles?.[0]?.target).toMatchObject({ port: editedRoute.port });
      facts.editedRouteAcceptedCount = editedRoute.acceptedCount();
      facts.profileCountAfterReconnect = reconnectedProfiles?.length;
      facts.siblingRestored = true;
      facts.editedConnectionWorkedWithRetainedPassword = true;
      return;
    }

    await disconnectRemoteSource(sourceId, MARKER);
    await browser.waitUntil(
      async () => (await readRemoteTabSnapshot(first.workspaceIdentity!)).remoteSessionId === null,
      { timeout: 30_000 },
    );
    await openRemoteProjectSelection();
    await clickTestIdByDom(TID_REMOTE_KIND_SSH);
    await fillSSHPasswordSettings({ ...config, host: "localhost" });
    await clickLastEnabledSSHDialogButton(MARKER);
    await waitForSSHDirectoryStep(MARKER);
    await selectSSHRemoteDirectory(config.workspacePaths[1], MARKER);
    await waitForRemoteTab({ caseMarker: MARKER, expectedPath: config.workspacePaths[1] });
    await browser.waitUntil(
      async () =>
        ((await readSettings()).connectionProfiles?.filter(
          (profile) => profile.sourceServerId === sourceId && profile.lifecycleState !== "retired",
        ).length ?? 0) === 2,
      { timeout: 30_000 },
    );
    const settings = await readSettings();
    const profiles =
      settings.connectionProfiles?.filter(
        (profile) => profile.sourceServerId === sourceId && profile.lifecycleState !== "retired",
      ) ?? [];
    expect(profiles).toHaveLength(2);
    const primary = profiles.find((profile) => profile.displayName === primaryName);
    const other = profiles.find((profile) => profile.profileId !== primary?.profileId);
    if (!primary || !other) throw new Error("Both connections were not retained separately");
    const otherLabel =
      other.displayName ??
      (other.target.kind === "ssh" ? `${other.target.host}:${other.target.port}` : other.transport);
    expect(
      settings.sourceServers?.find((server) => server.sourceServerId === sourceId)
        ?.preferredProfileId,
    ).toBe(primary.profileId);
    await openSettings();
    await browser.waitUntil(
      () =>
        browser.execute((id) => {
          const button = document.querySelector<HTMLButtonElement>(
            `[data-source-server-card="${id}"] button[aria-label="其他已保存连接"]`,
          );
          if (button?.getAttribute("aria-expanded") === "true") return true;
          button?.click();
          return Boolean(button);
        }, sourceId),
      { timeout: 15_000 },
    );
    await clickLineAction(otherLabel, "设为默认连接");
    await browser.waitUntil(
      async () =>
        (await readSettings()).sourceServers?.find((server) => server.sourceServerId === sourceId)
          ?.preferredProfileId === other.profileId,
    );
    expect(await $("[data-settings-content-frame]").getText()).toContain("默认");
    await browser.waitUntil(
      () =>
        browser.execute((id) => {
          const button = document.querySelector<HTMLButtonElement>(
            `[data-source-server-card="${id}"] button[aria-label="其他已保存连接"]`,
          );
          if (button?.getAttribute("aria-expanded") === "true") return true;
          button?.click();
          return Boolean(button);
        }, sourceId),
      { timeout: 15_000 },
    );
    await clickLabel("设为默认连接");
    await browser.waitUntil(
      async () =>
        (await readSettings()).sourceServers?.find((server) => server.sourceServerId === sourceId)
          ?.preferredProfileId === primary.profileId,
    );
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON);
    await disconnectRemoteSource(sourceId, MARKER);
    await browser.waitUntil(
      async () => (await readRemoteTabSnapshot(first.workspaceIdentity!)).remoteSessionId === null,
      { timeout: 30_000 },
    );
    await connectRemoteSourceFromSettings(sourceId, MARKER);
    await waitForRemoteTab({
      caseMarker: MARKER,
      expectedIdentity: first.workspaceIdentity!,
      expectedPath: first.workspacePath!,
      requireActive: false,
    });
    const directoryStep = await waitForSSHDirectoryStep(MARKER);
    if (directoryStep === "directory") {
      await browser.waitUntil(
        () =>
          browser.execute(() => {
            const button = Array.from(
              document.querySelectorAll<HTMLButtonElement>('[data-testid="ssh-dialog"] button'),
            ).find((item) => /Choose later|Choose later/iu.test(item.innerText) && !item.disabled);
            button?.click();
            return Boolean(button);
          }),
        { timeout: 15_000 },
      );
      await $('[data-testid="ssh-dialog"]').waitForDisplayed({ reverse: true, timeout: 15_000 });
    }
    await browser.waitUntil(
      () =>
        browser.execute((id) => {
          const button = document.querySelector<HTMLButtonElement>(
            `[data-source-server-card="${id}"] button[aria-label="其他已保存连接"]`,
          );
          if (button?.getAttribute("aria-expanded") === "true") return true;
          button?.click();
          return Boolean(button);
        }, sourceId),
      { timeout: 15_000 },
    );
    await clickLineAction(otherLabel, "移除连接");
    await clickTestIdByDom(TID_CONFIRM_DIALOG_CONFIRM);
    await browser.waitUntil(
      async () =>
        !(await readSettings()).connectionProfiles?.some(
          (profile) => profile.profileId === other.profileId,
        ),
    );
    expect(
      (await readSettings()).sourceServers?.some((server) => server.sourceServerId === sourceId),
    ).toBe(true);
    const primaryKey =
      primary.target.kind === "ssh" ? primary.target.passwordCredentialKey : undefined;
    const credentialsAfterLineRemoval = JSON.parse(
      await readFile(getE2EAppDataPaths().credentialsFile, "utf8"),
    );
    expect(Boolean(primaryKey && Object.hasOwn(credentialsAfterLineRemoval, primaryKey))).toBe(
      true,
    );
    facts.defaultAndRemoval = {
      retainedProfileId: primary.profileId,
      removedProfileId: other.profileId,
    };

    await $('[data-settings-content-frame] button[aria-label="更多"]').click();
    await clickLabel("Remove Device", '[role="menu"]');
    const dialog = $('[role="dialog"]:has([data-testid="confirm-dialog-confirm"])');
    await dialog.waitForDisplayed();
    for (const path of config.workspacePaths) expect(await dialog.getText()).toContain(path);
    expect(await browser.execute(() => document.activeElement?.textContent)).toContain("取消");
    await browser.keys("Enter");
    await dialog.waitForDisplayed({ reverse: true });
    expect(
      (await readSettings()).sourceServers?.some((server) => server.sourceServerId === sourceId),
    ).toBe(true);
    await $('[data-settings-content-frame] button[aria-label="更多"]').click();
    await clickLabel("Remove Device", '[role="menu"]');
    await clickTestIdByDom(TID_CONFIRM_DIALOG_CONFIRM);
    await browser.waitUntil(
      async () =>
        !(await readSettings()).sourceServers?.some((server) => server.sourceServerId === sourceId),
    );
    expect(
      (await readSettings()).connectionProfiles?.some(
        (profile) => profile.sourceServerId === sourceId,
      ),
    ).toBe(false);
    const credentialsAfterDeviceRemoval = JSON.parse(
      await readFile(getE2EAppDataPaths().credentialsFile, "utf8"),
    );
    expect(Boolean(primaryKey && Object.hasOwn(credentialsAfterDeviceRemoval, primaryKey))).toBe(
      false,
    );
    const remote = await runSSHCommand(
      config,
      `cat '${config.workspacePaths[0]}/guide-remove-sentinel.txt'; test -f "$HOME/.cf/server/current.json"`,
    );
    expect(remote.code).toBe(0);
    expect(remote.stdout).toBe("GUIDE_KEEP_REMOTE");
    facts.remoteDataAndInstallationPreserved = true;
  });
});
