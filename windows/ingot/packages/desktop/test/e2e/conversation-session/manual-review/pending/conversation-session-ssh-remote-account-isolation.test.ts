import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";
import { clearAppData, readSettings } from "#e2e/helpers/desktop-app";
import {
  disconnectRemoteSource,
  requestRemoteProjectConnection,
} from "#e2e/helpers/remote-project-actions";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  createSSHLifecycleProvider,
  prepareSSHLifecycle,
  sendSSHFollowTurn,
  type SSHLifecycleProvider,
} from "#e2e/helpers/ssh-remote-lifecycle";
import { runSSHCommand, waitForRemoteTab } from "#e2e/helpers/ssh-remote-p0";

const MARKER = "E2E_SSH_ACCOUNT_ISOLATION";
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/ssh-account-isolation",
);

describe(`${MARKER}: 同地址不同登录账Number`, () => {
  const providers: SSHLifecycleProvider[] = [];
  const facts: Record<string, unknown> = {};
  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "account-isolation.json"), JSON.stringify(facts, null, 2));
    await Promise.all(providers.map((provider) => provider.tunnel.close()));
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("SSH-GUIDE-ACCOUNT Two accounts on separate devices, same-path first send and reconnect chat do not cross histories, no false reinstall alarms", async function () {
    this.timeout(15 * 60_000);
    const prepared = await prepareSSHLifecycle(MARKER, { tunnelUsername: "tunnel" });
    providers.push(prepared.provider);
    expect(
      (
        await runSSHCommand(
          prepared.config,
          `chmod 755 '/home/${prepared.config.username}' '${prepared.config.workspacePaths[0]}'`,
        )
      ).code,
    ).toBe(0);
    const first = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: MARKER,
      config: prepared.config,
      provider: prepared.provider,
      label: "A",
      workspacePath: prepared.config.workspacePaths[0],
    });
    const secondConfig = { ...prepared.config, username: "tunnel" };
    const secondProvider = await createSSHLifecycleProvider(secondConfig, MARKER, {
      tunnelUsername: "tunnel",
    });
    providers.push(secondProvider);
    const second = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: MARKER,
      config: secondConfig,
      provider: secondProvider,
      label: "B",
      workspacePath: prepared.config.workspacePaths[0],
    });
    const firstSource = parseRemoteWorkspaceIdentity(first.identity)?.sourceServerId;
    const secondSource = parseRemoteWorkspaceIdentity(second.identity)?.sourceServerId;
    expect(firstSource).toBeTruthy();
    expect(secondSource).toBeTruthy();
    expect(firstSource).not.toBe(secondSource);
    expect(first.identity).not.toBe(second.identity);
    expect(first.taskId).not.toBe(second.taskId);
    expect(await $('[data-confirm-intent="source-server-identity"]').isExisting()).toBe(false);
    expect((await readSettings()).sourceServers).toHaveLength(2);
    facts.first = { identity: first.identity, taskId: first.taskId, sourceId: firstSource };
    facts.second = { identity: second.identity, taskId: second.taskId, sourceId: secondSource };

    await disconnectRemoteSource(firstSource!, MARKER);
    const secondStillOnline = await waitForRemoteTab({
      caseMarker: MARKER,
      expectedIdentity: second.identity,
      expectedPath: second.workspacePath,
      requireActive: false,
    });
    expect(secondStillOnline.remoteSessionId).toBe(second.remoteSessionId);
    await sendSSHFollowTurn(second, MARKER, first.firstPrompt);
    await requestRemoteProjectConnection(first.identity, MARKER);
    const restoredFirst = await waitForRemoteTab({
      caseMarker: MARKER,
      expectedIdentity: first.identity,
      expectedPath: first.workspacePath,
      requireActive: false,
    });
    first.remoteSessionId = restoredFirst.remoteSessionId!;
    await sendSSHFollowTurn(first, MARKER, second.firstPrompt);
    facts.independentReconnect = true;
    await browser.saveScreenshot(resolve(artifactDir, "two-accounts-same-path.png"));
  });
});
