import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";

import * as v4 from "#e2e/helpers/v4-conversation";
import * as ssh from "#e2e/helpers/ssh-remote-p0";
import * as app from "#e2e/helpers/desktop-app";
import * as provider from "#e2e/helpers/custom-openai-provider";
import * as models from "#e2e/helpers/upstream-provider";
import * as network from "#e2e/helpers/conversation-session-network";
import * as recorder from "#e2e/helpers/electron-window-recorder";

const marker = "E2E_R3_SSH_READY";
const providerId = "e2e-r3-ssh-ready";
const providerName = "R3 SSH Ready";
const modelId = "e2e-r3-ssh-ready-model";
const artifactDir = resolve(process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-ssh-ready");
let tunnel: { baseURL: string; close(): Promise<void> } | undefined;

describe(`${marker}: Provider 首连与远端ProjectChat`, () => {
  after(async () => {
    await tunnel?.close();
    await browser.electron.restoreAllMocks();
    await app.clearAppData();
  });

  it("Full Personal fixture synchronized on first connection, then initially launched and completed in real SSH project", async function () {
    this.timeout(5 * 60_000);
    const config = ssh.readSSHRuntimeConfig(marker);
    await v4.prepareV4ConversationE2E({ skipProvider: true });
    const activeTunnel = await ssh.createSSHReplayTunnel(config, marker);
    tunnel = activeTunnel;
    await provider.seedCustomOpenAIChatCompletionsProvider({
      providerId,
      providerName,
      modelId,
      baseURL: activeTunnel.baseURL,
    });
    await provider.refreshSeededOpenAIProvidersThroughSettings([providerName]);
    await mkdir(artifactDir, { recursive: true });
    const recording =
      process.env.CF_E2E_FAILURE_ARTIFACTS === "1"
        ? undefined
        : await recorder.startElectronWindowRecording({
            outputPath: resolve(artifactDir, "main-flow.webm"),
          });
    try {
      const tab = await ssh.connectSSHWorkspace({
        config,
        caseMarker: marker,
        workspacePath: config.workspacePaths[0],
      });
      if (!tab.workspaceIdentity) throw new Error(`${marker}: 远端 workspace identity 丢失`);
      expect(parseRemoteWorkspaceIdentity(tab.workspaceIdentity)?.sourceServerId).toBeTruthy();
      expect(tab.secretPersistedInTab).toBe(false);
      const remote = await ssh.runSSHCommand(
        config,
        'test -f "$HOME/.cf/v2/provider_config.json" && echo provisioned',
      );
      expect(remote.stdout).toContain("provisioned");
      const localProviderConfig = await readFile(
        resolve(app.getE2EAppDataPaths().appDataDir, "provider_config.json"),
        "utf8",
      ).then(
        () => "present",
        () => "absent",
      );
      expect(localProviderConfig).toBe("present");
      await writeFile(
        resolve(artifactDir, "ready-facts.json"),
        JSON.stringify({ tab, localProviderConfig, remoteProviderConfig: "present" }, null, 2),
      );
      await models.selectUpstreamProviderModelById(modelId, {
        includePlainModelFallback: false,
        providerId,
        providerName,
      });
      await models.selectUpstreamThoughtLevelValue("disabled");
      const requestStart = await network.getUpstreamRequestRecordCount();
      const prompt = `${marker}_PROMPT`;
      const reply = `${marker}_REPLY`;
      await v4.sendV4PromptAndWaitAccepted(
        `${prompt}: 只Reply ${reply}`,
        prompt,
        `${marker}: Initial turn未被接收`,
      );
      await network.waitForUpstreamRequest(
        { lastUserMessageIncludes: [prompt] },
        `${marker}: 远端Request未到达回放Service`,
        90_000,
        { afterIndex: requestStart - 1 },
      );
      await v4.waitForV4AssistantMessageContaining(reply, 90_000);
      await v4.waitForV4ConversationState(
        (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
        `${marker}: Initial turn未收口`,
        90_000,
      );
    } finally {
      await browser.saveScreenshot(resolve(artifactDir, "main-final.png"));
      await recording?.stop();
    }
  });
});
