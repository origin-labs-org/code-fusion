import { withCredentialFault } from "#e2e/helpers/credential-fault";
import { NodePersonalProviderConfigRepository } from "@origin-ai/cf-provider-node";
import { parseRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";
import {
  clearAppData,
  getE2EAppDataPaths,
  waitForWorkspaceApp,
} from "../../../helpers/desktop-app.js";
import { prepareV4ConversationE2E } from "../../../helpers/v4-conversation.js";
import {
  clickLastEnabledSSHDialogButton,
  fillSSHPasswordSettings,
  openSSHRemoteDialog,
  readHostProcesses,
  readRemoteTabSnapshot,
  readSSHRuntimeConfig,
  selectSSHRemoteDirectory,
  waitForRemoteTab,
  waitForSSHDirectoryStep,
  waitForSSHError,
  SSH_WORKSPACE_READY_TIMEOUT_MS,
} from "../../../helpers/ssh-remote-p0.js";

const CASE_MARKER = "SSH_PROVISIONING_FAILURE";

describe(CASE_MARKER, () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("SSH-P0-CONN-08 First failure retains security diagnostics; default does not block connection after credential recovery", async function () {
    this.timeout(20 * 60_000);
    const config = readSSHRuntimeConfig(CASE_MARKER);
    const workspacePath = config.workspacePaths[0];
    await prepareV4ConversationE2E({ skipProvider: true });
    const hosts = await readHostProcesses();
    const paths = getE2EAppDataPaths();
    const invalidCredential = "enc:v1:E2E_INVALID_PROVISIONING_CREDENTIAL";
    await withCredentialFault(
      paths.credentialsFile,
      "oauth:bigmodel:refresh_token",
      invalidCredential,
      async () => {
        await openSSHRemoteDialog(CASE_MARKER);
        await fillSSHPasswordSettings(config);
        await clickLastEnabledSSHDialogButton(CASE_MARKER);
        await expect(waitForSSHDirectoryStep(CASE_MARKER)).rejects.toThrow("SSH 连接失败");
        expect(await waitForSSHError(CASE_MARKER)).toMatch(/Connection failed|Connection failed/iu);
        await $('[data-testid="ssh-error"] summary').click();
        const details = $('[data-testid="ssh-error"] details pre');
        await details.waitForDisplayed();
        expect(await details.getText()).toContain("source-read-failed");
        const text = await browser.execute(
          () => document.querySelector('[data-testid="ssh-dialog"]')?.textContent ?? "",
        );
        expect(text).not.toContain(invalidCredential);
        expect(text).not.toContain(config.password);
        expect((await readRemoteTabSnapshot()).remoteSessionId).toBeNull();
      },
    );

    const defaultModelSelection = {
      providerId: "e2e-removed-provider",
      modelId: "e2e-removed-model",
    };
    const personal = new NodePersonalProviderConfigRepository({
      filePath: paths.configFile,
      pollingIntervalMs: false,
    });
    try {
      await personal.update((current) => ({ ...current, defaultModelSelection }));
      await $('[data-testid="ssh-error"]')
        .$('.//button[normalize-space(.)="重试" or normalize-space(.)="重试"]')
        .click();
      await waitForSSHDirectoryStep(CASE_MARKER);
      await selectSSHRemoteDirectory(workspacePath, CASE_MARKER);
      await waitForWorkspaceApp(workspacePath, SSH_WORKSPACE_READY_TIMEOUT_MS);
      const tab = await waitForRemoteTab({
        caseMarker: CASE_MARKER,
        expectedPath: workspacePath,
      });
      expect(parseRemoteWorkspaceIdentity(tab.workspaceIdentity!)).toMatchObject({
        kind: "server",
        workspacePath,
      });
      expect(tab.remoteHost).toBe(config.host);
      expect(tab.secretPersistedInTab).toBe(false);
      expect((await personal.read()).defaultModelSelection).toEqual(defaultModelSelection);
      expect(await readHostProcesses()).toEqual(hosts);
    } finally {
      personal.dispose();
    }
  });
});
