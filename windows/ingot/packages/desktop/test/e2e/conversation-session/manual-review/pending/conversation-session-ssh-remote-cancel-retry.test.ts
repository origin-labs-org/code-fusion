import { parseRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";
import { clearAppData, waitForWorkspaceApp } from "../../../helpers/desktop-app.js";
import { prepareV4ConversationE2E } from "../../../helpers/v4-conversation.js";
import {
  clickLastEnabledSSHDialogButton,
  createFirstConnectionStallingSSHProxy,
  fillSSHPasswordSettings,
  openSSHRemoteDialog,
  openSSHSourceDirectory,
  readHostProcesses,
  readSSHRuntimeConfig,
  prepareSSHConnectionPage,
  selectSSHRemoteDirectory,
  waitForRemoteTab,
  waitForSSHDirectoryStep,
  type FirstConnectionStallingSSHProxy,
  SSH_WORKSPACE_READY_TIMEOUT_MS,
} from "../../../helpers/ssh-remote-p0.js";

const CASE_MARKER = "E2E_SSH_P0_CANCEL_RETRY";
const CONNECTION_CLOSE_TIMEOUT_MS = 30_000;

describe(`${CASE_MARKER}: SSH pending cancel 后立即Retry`, () => {
  let proxy: FirstConnectionStallingSSHProxy | null = null;

  after(async () => {
    try {
      await browser.electron.restoreAllMocks();
      await clearAppData();
    } finally {
      await proxy?.close();
      proxy = null;
    }
  });

  it("SSH-P0-CONN-03 停止 pending 连接后，同 target 使用新凭据重试", async function () {
    this.timeout(20 * 60_000);
    const config = readSSHRuntimeConfig(CASE_MARKER);
    const workspacePath = config.workspacePaths[0];
    proxy = await createFirstConnectionStallingSSHProxy(config, CASE_MARKER);
    const proxiedConfig = {
      ...config,
      host: "127.0.0.1",
      port: proxy.port,
    };
    await prepareSSHConnectionPage(CASE_MARKER);
    await prepareV4ConversationE2E({ skipProvider: true });
    const initialHosts = await readHostProcesses();
    expect(initialHosts).toHaveLength(1);

    await openSSHRemoteDialog(CASE_MARKER);
    await fillSSHPasswordSettings({
      ...proxiedConfig,
      password: "cancelled-attempt",
    });
    await clickLastEnabledSSHDialogButton(CASE_MARKER);
    await proxy.firstConnectionAccepted;

    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const buttons = Array.from(
            document.querySelectorAll<HTMLButtonElement>('[data-testid="ssh-dialog"] button'),
          );
          const button = buttons.find((item) =>
            ["取消连接", "Cancel connection"].includes(item.textContent?.trim() ?? ""),
          );
          if (!button || button.disabled) return false;
          button.click();
          return true;
        }),
      { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: Connecting主按钮不可Cancel` },
    );
    await waitForPromise(
      proxy.waitForFirstConnectionClosed(),
      CONNECTION_CLOSE_TIMEOUT_MS,
      `${CASE_MARKER}: Cancel后首个 SSH socket 没有Close`,
    );
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const dialog = document.querySelector('[data-testid="ssh-dialog"]');
          return (
            /Canceled|Cancelled/u.test(dialog?.textContent ?? "") &&
            !dialog?.querySelector('[data-testid="ssh-error"]')
          );
        }),
      { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: 主动Cancel仍ShowError` },
    );
    await closeCancelledSSHDialog();
    await openSSHRemoteDialog(CASE_MARKER);

    await fillSSHPasswordSettings(proxiedConfig);
    await clickLastEnabledSSHDialogButton(CASE_MARKER);
    const retryFlow = await waitForSSHDirectoryStep(CASE_MARKER);
    if (retryFlow === "closed") {
      await openSSHSourceDirectory(proxiedConfig, CASE_MARKER);
    }
    await selectSSHRemoteDirectory(workspacePath, CASE_MARKER);
    await waitForWorkspaceApp(workspacePath, SSH_WORKSPACE_READY_TIMEOUT_MS);

    const tab = await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedPath: workspacePath,
    });
    expect(tab.remoteSessionId).toBeTruthy();
    const parsedIdentity = tab.workspaceIdentity
      ? parseRemoteWorkspaceIdentity(tab.workspaceIdentity)
      : null;
    expect(parsedIdentity).toMatchObject({
      kind: "server",
      workspacePath,
    });
    expect(tab.secretPersistedInTab).toBe(false);
    expect(await readHostProcesses()).toEqual(initialHosts);
  });
});

async function closeCancelledSSHDialog(): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const button = Array.from(
          document.querySelectorAll<HTMLButtonElement>('[data-testid="ssh-dialog"] button'),
        ).find((item) => ["关闭", "Close"].includes(item.innerText.trim()) && !item.disabled);
        button?.click();
        return Boolean(button);
      }),
    { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: Cancel页没有Close入口` },
  );
  await $('[data-testid="ssh-dialog"]').waitForExist({ reverse: true });
}

async function waitForPromise<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
