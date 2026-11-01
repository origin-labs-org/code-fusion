import { DatabaseSync } from "node:sqlite";
import { createRemoteProjectService } from "@origin-ai/cf-services/node";
import { requestRemoteProjectConnection } from "#e2e/helpers/remote-project-actions";
import { reloadElectronSessionPreservingBrowserProfile } from "#e2e/helpers/e2e-electron-reload";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { appSettingsSchema } from "@origin-ai/cf-shared";
import {
  TID_PROJECT_SECTION,
  TID_CONVERSATION_SECTION,
  TID_SSH_DIALOG,
  TID_SSH_PASSWORD_INPUT,
  TID_SSH_ERROR,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  getE2EAppDataPaths,
  readSettings,
  seedSettings,
} from "#e2e/helpers/desktop-app";
import { prepareV4ConversationE2E } from "#e2e/helpers/v4-conversation";
import { waitForRendererAfterColdRestart } from "#e2e/helpers/ssh-remote-lifecycle";
import { openSSHRemoteDialog, readRemoteTabSnapshot } from "#e2e/helpers/ssh-remote-p0";
import { selectTaskOrganizeMode } from "#e2e/helpers/workspace-agent-warmup";

const CASE_MARKER = "E2E_RPN_PROJECT_NAVIGATION";
const SOURCE_A = "25db8db2-d27b-40de-a23e-697b3c127234";
const SOURCE_B = "f6a0d063-3c52-4ce2-abf1-cb456d87f542";
const PROJECT_PATH = "/srv/project";
const CHAT_PATH = "/home/e2e/.cf/workspace/default";
const IDENTITY_A = `remote:server:${SOURCE_A}:${PROJECT_PATH}`;
const IDENTITY_B = `remote:server:${SOURCE_B}:${PROJECT_PATH}`;
const CHAT_IDENTITY = `remote:server:${SOURCE_A}:${CHAT_PATH}`;

async function dialogButton(
  labels: readonly string[],
  partial = false,
): Promise<WebdriverIO.Element> {
  const dialog = $(`[data-testid="${TID_SSH_DIALOG}"]`);
  let matched: WebdriverIO.Element | undefined;
  await browser.waitUntil(
    async () => {
      for (const button of await dialog.$$("button")) {
        const text = (await button.getText()).trim();
        if (
          (await button.isDisplayed()) &&
          labels.some((label) => (partial ? text.includes(label) : text === label))
        ) {
          matched = button;
          return true;
        }
      }
      return false;
    },
    { timeout: 10_000, timeoutMsg: `${CASE_MARKER}: 没有找到向导按钮 ${labels.join(" / ")}` },
  );
  return matched!;
}

async function completeInitialOnboarding() {
  const page = $('[data-testid="onboarding-page"]');
  await page.waitForDisplayed({ timeout: 30_000 });
  await page.$("footer > div > button").click();
  const codingMode = page.$('.//button[.//span[text()="编程模式" or text()="Coding mode"]]');
  await codingMode.waitForDisplayed();
  await codingMode.click();
  await page.$("footer > div > button").click();
  await browser.waitUntil(
    async () =>
      ["Get Started", "开始使用"].includes(await page.$("footer > div > button").getText()),
    { timeout: 10_000, timeoutMsg: `${CASE_MARKER}: Onboarding未进入偏OK页` },
  );
  await page.$("footer > button").click();
  await page.waitForDisplayed({ reverse: true, timeout: 10_000 });
}

describe(`${CASE_MARKER}: Project平铺与Remote无Project入口Disable`, () => {
  afterEach(async () => {
    const artifactDir = resolve(
      process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/rpn-project-navigation",
    );
    await mkdir(artifactDir, { recursive: true });
    await browser.saveScreenshot(resolve(artifactDir, "rpn-final.png"));
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("RPN-01/02/04/09/10/14 keeps offline projects visible and distinct without restoring remote conversations", async function () {
    this.timeout(180_000);
    await completeInitialOnboarding();
    await prepareV4ConversationE2E({ skipProvider: true });
    const before = await readSettings();
    const sources = [SOURCE_A, SOURCE_B];
    const names = ["alpha-device", "beta-device"];
    const profiles = sources.map((sourceServerId, index) => ({
      profileId: ["294224b4-a6ad-4424-97ad-37f58c833e0f", "2abca774-d38f-44ca-95bf-cc659ab1183b"][
        index
      ]!,
      sourceServerId,
      displayName: names[index]!,
      transport: "ssh" as const,
      lifecycleState: "active" as const,
      createdAt: 1,
      target: {
        kind: "ssh" as const,
        host: "127.0.0.1",
        port: index + 1,
        username: "e2e",
        assetInstallMode: "remote-download" as const,
      },
    }));
    const entries = profiles.map((profile, index) => ({
      kind: "remote" as const,
      workspacePath: PROJECT_PATH,
      workspaceIdentity: index === 0 ? IDENTITY_A : IDENTITY_B,
      workspacePurpose: "project" as const,
      target: profile.target,
      lastOpenedAt: 1,
      lastConnectionStatus: "failed" as const,
    }));
    await reloadElectronSessionPreservingBrowserProfile(browser, {
      afterElectronProcessExit: async () => {
        await seedSettings(
          appSettingsSchema.parse({
            ...before,
            remoteStartupAutoReconnectEnabled: false,
            sourceServerDirectoryMigrationVersion: 1,
            sourceServers: sources.map((sourceServerId, index) => ({
              sourceServerId,
              displayName: names[index]!,
              installState: "installed" as const,
              preferredProfileId: profiles[index]!.profileId,
              declaredWorkspaces: [],
            })),
            connectionProfiles: profiles,
            sourceServerWorkspaceHistory: entries.map((entry, index) => ({
              workspacePath: entry.workspacePath,
              workspaceIdentity: entry.workspaceIdentity,
              sourceServerId: sources[index]!,
              profileId: profiles[index]!.profileId,
              lastOpenedAt: 1,
            })),
            remoteConversationWorkspaceBySourceServerId: {
              [SOURCE_A]: { workspacePath: CHAT_PATH, lastResolvedAt: 1 },
            },
            lastWorkspaceSession: [
              ...(before.lastWorkspaceSession ?? []).filter((entry) => entry.kind === "local"),
              ...entries,
              {
                ...entries[0]!,
                workspaceIdentity: CHAT_IDENTITY,
                workspacePath: CHAT_PATH,
                workspacePurpose: "conversation",
              },
            ],
          }),
        );
        const db = new DatabaseSync(join(getE2EAppDataPaths().appDataDir, "tasks-index.sqlite"));
        try {
          const projects = createRemoteProjectService({ database: async () => db });
          for (const [index, profile] of profiles.entries()) {
            const host = await projects.saveHost({
              id: `remote:server:${profile.sourceServerId}`,
              target: profile.target,
            });
            await projects.addEntry({
              hostId: host.id,
              expectedMembershipId: host.membershipId,
              project: {
                projectId: `rpn-project-${index}`,
                name: "project",
                roots: [{ rootPath: PROJECT_PATH, isPrimary: true, position: 0 }],
              },
            });
          }
        } finally {
          db.close();
        }
      },
    });
    await waitForRendererAfterColdRestart(CASE_MARKER);
    await selectTaskOrganizeMode(["项目", "Project"]);
    await browser.waitUntil(
      async () => (await $$("[data-project-workspace-identity]").length) === 2,
      {
        timeout: 30_000,
        timeoutMsg: `${CASE_MARKER}: OfflineProject应直接展示为两条独立Project行`,
      },
    );
    expect(await $$("[data-source-group-key]")).toHaveLength(0);
    expect(await $$(`[data-testid="${TID_PROJECT_SECTION}"]`)).toHaveLength(1);
    expect(await $$(`[data-testid="${TID_CONVERSATION_SECTION}"]`)).toHaveLength(1);
    expect((await readRemoteTabSnapshot(CHAT_IDENTITY)).workspacePath).toBeNull();
    await $('[role="menu"]').waitForExist({ reverse: true, timeout: 10_000 });
    await $('[data-testid="sidebar-view-menu"]').click();
    await $('[data-testid="sidebar-view-timeline"]').waitForDisplayed();
    await $('[data-testid="sidebar-view-timeline"]').click();
    await $('[role="menu"]').waitForExist({ reverse: true, timeout: 10_000 });
    expect((await readRemoteTabSnapshot(IDENTITY_A)).remoteSessionId).toBeNull();
    expect((await readRemoteTabSnapshot(IDENTITY_B)).remoteSessionId).toBeNull();
    await selectTaskOrganizeMode(["项目", "Project"]);
    expect(await $$("[data-project-workspace-identity]")).toHaveLength(2);
    for (const identity of [IDENTITY_A, IDENTITY_B]) {
      const row = $(`[data-project-workspace-identity="${identity}"]`);
      expect(await row.getAttribute("data-connection-state")).toBe("offline");
      expect(await row.$('[data-testid="project-device"]').getText()).toBe(
        identity === IDENTITY_A ? "alpha-device" : "beta-device",
      );
      await row.moveTo();
      await row.$('[data-testid="virtual-project-menu"]').click();
      await $('[data-testid="virtual-project-connect"]').waitForDisplayed();
      await $('[data-testid="virtual-project-device-settings"]').waitForDisplayed();
      expect(await row.$('[data-testid="virtual-project-create-task"]').isExisting()).toBe(false);
      await browser.waitUntil(
        async () => {
          await browser.keys("Escape");
          return !(await $('[role="menu"]').isDisplayed());
        },
        { timeout: 5_000, interval: 300, timeoutMsg: `${CASE_MARKER}: Escape 未CloseProject菜单` },
      );
    }
    expect((await readRemoteTabSnapshot(IDENTITY_A)).remoteSessionId).toBeNull();
    expect((await readRemoteTabSnapshot(IDENTITY_B)).remoteSessionId).toBeNull();
    expect(
      (await readSettings()).remoteConversationWorkspaceBySourceServerId?.[SOURCE_A]?.workspacePath,
    ).toBe(CHAT_PATH);
    const artifactDir = resolve(
      process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/rpn-project-navigation",
    );
    await mkdir(artifactDir, { recursive: true });
    await browser.saveScreenshot(resolve(artifactDir, "rpn-project-sidebar.png"));
    await requestRemoteProjectConnection(IDENTITY_A, CASE_MARKER);
    await $(`[data-testid="${TID_SSH_DIALOG}"]`).waitForDisplayed({ timeout: 20_000 });
    expect((await readRemoteTabSnapshot(CHAT_IDENTITY)).workspacePath).toBeNull();

    await $(`[data-testid="${TID_SSH_ERROR}"]`).waitForDisplayed({ timeout: 10_000 });
    await (await dialogButton(["返回配置", "Back to configuration"])).click();
    const password = $(`[data-testid="${TID_SSH_PASSWORD_INPUT}"]`);
    await password.waitForDisplayed();
    await password.setValue("E2E_RPN_SECRET_FOR_DEVICE_A");
    await (await dialogButton(["关闭", "Close"])).click();
    await $(`[data-testid="${TID_SSH_DIALOG}"]`).waitForDisplayed({ reverse: true });
    await requestRemoteProjectConnection(IDENTITY_B, CASE_MARKER);
    await $(`[data-testid="${TID_SSH_ERROR}"]`).waitForDisplayed({ timeout: 10_000 });
    await (await dialogButton(["返回配置", "Back to configuration"])).click();
    await password.waitForDisplayed();
    expect(await password.getValue()).toBe("");
    await (await dialogButton(["高级选项", "Advanced options"])).click();
    expect(
      await (
        await dialogButton(["远端服务器下载", "Download on remote server"])
      ).getAttribute("aria-pressed"),
    ).toBe("true");

    await (await dialogButton(["关闭", "Close"])).click();
    await $(`[data-testid="${TID_SSH_DIALOG}"]`).waitForExist({ reverse: true });
    await openSSHRemoteDialog(CASE_MARKER);
    await password.waitForDisplayed();
    expect(await password.getValue()).toBe("");
    await (await dialogButton(["高级选项", "Advanced options"])).click();
    expect(
      await (
        await dialogButton(["Download locally and upload", "Download locally, then upload"])
      ).getAttribute("aria-pressed"),
    ).toBe("true");
    await browser.saveScreenshot(resolve(artifactDir, "rpn-connection-intent-isolation.png"));
    await (await dialogButton(["关闭", "Close"])).click();
    await $(`[data-testid="${TID_SSH_DIALOG}"]`).waitForExist({ reverse: true });
    await browser.keys("Escape");
    await $('[data-slot="dialog-overlay"]').waitForExist({ reverse: true });

    const rowB = $(`[data-project-workspace-identity="${IDENTITY_B}"]`);
    await rowB.moveTo();
    await rowB.$('[data-testid="virtual-project-menu"]').click();
    const deviceSettings = $('[data-testid="virtual-project-device-settings"]');
    await deviceSettings.waitForDisplayed();
    await deviceSettings.click();
    await $(`[data-source-server-card="${SOURCE_B}"]`).waitForDisplayed({ timeout: 15_000 });
    await browser.waitUntil(
      () =>
        browser.execute(
          (id) =>
            document.activeElement === document.querySelector(`[data-source-server-card="${id}"]`),
          SOURCE_B,
        ),
      { timeout: 10_000, timeoutMsg: `${CASE_MARKER}: Settings页没有定位到Project所属Device卡` },
    );
    expect((await readRemoteTabSnapshot(IDENTITY_B)).remoteSessionId).toBeNull();
    await browser.saveScreenshot(resolve(artifactDir, "rpn-project-device-settings.png"));
  });
});
