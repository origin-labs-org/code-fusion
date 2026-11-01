import { reloadElectronSessionPreservingBrowserProfile } from "#e2e/helpers/e2e-electron-reload";
import {
  TID_SSH_DIALOG,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import { clearAppData, seedSettings, clickTestIdByDom } from "../../../helpers/desktop-app.js";
import { prepareV4ConversationE2E } from "../../../helpers/v4-conversation.js";
import { waitForRendererAfterColdRestart } from "../../../helpers/ssh-remote-lifecycle.js";

const CASE_MARKER = "E2E_REMOTE_OFFLINE_ICONS";
const SOURCE_ID = "b2d3aeee-9c83-4d03-b62b-40dbed84d389";

describe(`${CASE_MARKER}: OfflineDeviceConnect按钮`, () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("RUI-SIMPLE-11 Settings page shows accessible connect button for identified and pending SSH/Docker, keyboard can enter corresponding wizard", async function () {
    this.timeout(120_000);
    await prepareV4ConversationE2E({ skipProvider: true });
    await seedSettings({
      remoteStartupAutoReconnectEnabled: false,
      sourceServerDirectoryMigrationVersion: 1,
      sourceServers: [
        {
          sourceServerId: SOURCE_ID,
          displayName: "E2E known",
          installState: "installed",
          declaredWorkspaces: [],
        },
      ],
      sourceServerWorkspaceHistory: [],
      lastWorkspaceSession: [
        {
          kind: "remote",
          workspacePath: "/e2e/known",
          workspaceIdentity: `remote:server:${SOURCE_ID}:/e2e/known`,
          target: { kind: "ssh", host: "127.0.0.1", port: 1, username: "e2e" },
          lastOpenedAt: Date.now(),
          lastConnectionStatus: "failed",
        },
        {
          kind: "remote",
          workspacePath: "/e2e/ssh",
          workspaceIdentity: "remote:ssh:127.0.0.1:2:e2e:/e2e/ssh",
          target: {
            kind: "ssh",
            host: "127.0.0.1",
            port: 2,
            username: "e2e",
            sshConfigAlias: "E2E pending SSH",
          },
          lastOpenedAt: Date.now(),
          lastConnectionStatus: "failed",
        },
        {
          kind: "remote",
          workspacePath: "/e2e/docker",
          workspaceIdentity: "remote:docker:e2e-pending-docker:/e2e/docker",
          target: { kind: "docker", container: "e2e-pending-docker" },
          lastOpenedAt: Date.now(),
          lastConnectionStatus: "failed",
        },
      ],
      connectionProfiles: [
        {
          profileId: "297c6971-47a3-40ca-8767-678b50889922",
          sourceServerId: SOURCE_ID,
          displayName: "E2E known",
          transport: "ssh",
          createdAt: 1,
          lifecycleState: "active",
          target: { kind: "ssh", host: "127.0.0.1", port: 1, username: "e2e" },
        },
        {
          profileId: "d41c3adc-c998-4052-b2aa-04adf90beb5e",
          displayName: "E2E pending SSH",
          transport: "ssh",
          createdAt: 1,
          lifecycleState: "active",
          target: { kind: "ssh", host: "127.0.0.1", port: 2, username: "e2e" },
        },
        {
          profileId: "2c47f140-7116-4a1f-a7b6-098771cfe19d",
          displayName: "e2e-pending-docker",
          transport: "docker",
          createdAt: 1,
          lifecycleState: "active",
          target: { kind: "docker", container: "e2e-pending-docker" },
        },
      ],
    });
    await reloadElectronSessionPreservingBrowserProfile(browser);
    await waitForRendererAfterColdRestart(CASE_MARKER);
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, { timeout: 15_000 });
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "remoteDevices"), { timeout: 15_000 });
    const unfinished = $("[data-unfinished-connections]");
    await unfinished.waitForDisplayed();
    expect(await unfinished.getAttribute("open")).toBeNull();
    await unfinished.$("summary").click();
    await browser.waitUntil(async () => (await readActions()).length === 3, {
      timeout: 30_000,
      timeoutMsg: `${CASE_MARKER}: Three条已SaveConnect未出现`,
    });
    const actions = await readActions();
    expect(actions.map((item) => item.name).sort()).toEqual(
      ["E2E known", "E2E pending SSH", "e2e-pending-docker"].sort(),
    );
    expect(actions.every((item) => item.label === "连接" && !item.disabled)).toBe(true);
    await browser.waitUntil(
      async () => {
        const focused = await browser.execute(() => {
          const card = Array.from(
            document.querySelectorAll<HTMLElement>(
              '[data-testid="settings-page"] p, [data-testid="settings-page"] span',
            ),
          )
            .find((item) => item.textContent?.trim() === "E2E pending SSH")
            ?.closest("div.group\\/line, section");
          const button = Array.from(card?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
            (item) => item.innerText.trim() === "连接",
          );
          if (!button) return false;
          if (document.activeElement !== button) button.focus();
          return document.activeElement === button;
        });
        if (focused) await browser.keys("Enter");
        return browser.execute(
          (dialogTestId) => Boolean(document.querySelector(`[data-testid="${dialogTestId}"]`)),
          TID_SSH_DIALOG,
        );
      },
      {
        timeout: 20_000,
        interval: 1_000,
        timeoutMsg: `${CASE_MARKER}: 键盘没有触发既有 workspace Connect动作(弹窗未打开)`,
      },
    );
  });
});

function readActions() {
  return browser.execute(() =>
    ["E2E known", "E2E pending SSH", "e2e-pending-docker"].flatMap((name) => {
      const row = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="settings-page"] p, [data-testid="settings-page"] span',
        ),
      )
        .find((item) => item.textContent?.trim() === name)
        ?.closest("div.group\\/line, section");
      const action = Array.from(row?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
        (item) => item.innerText.trim() === "连接",
      );
      return action ? [{ name, label: action.innerText.trim(), disabled: action.disabled }] : [];
    }),
  );
}
