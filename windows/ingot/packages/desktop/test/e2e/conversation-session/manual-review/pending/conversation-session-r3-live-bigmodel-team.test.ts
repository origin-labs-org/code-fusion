import { reloadElectronSessionPreservingBrowserProfile } from "#e2e/helpers/e2e-electron-reload";
import { importLiveBigModelCredentials } from "#e2e/helpers/live-bigmodel-profile";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { clearAppData, getE2EAppDataPaths, seedSettings } from "../../../helpers/desktop-app.js";
import { selectUpstreamProviderModelById } from "../../../helpers/upstream-provider.js";
import { getUpstreamRequestRecordCount } from "../../../helpers/conversation-session-network.js";
import {
  connectSSHWorkspace,
  readHostProcesses,
  readSSHRuntimeConfig,
  runSSHCommand,
  type SSHConnectionConfig,
} from "../../../helpers/ssh-remote-p0.js";
import {
  getV4Messages,
  prepareV4ConversationE2E,
  sendV4PromptAndWaitAccepted,
  waitForV4ConversationState,
} from "../../../helpers/v4-conversation.js";

const CASE_MARKER = "E2E_R3_LIVE_TEAM";
const artifactDir = resolve(process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-live-team");
const TEAM_PROVIDER_ID = "account:bigmodel-team-coding-plan";
const TEAM_MODEL_ID = "GLM-5.3-Flash";

async function readRemoteModelNetwork(config: SSHConnectionConfig, startedAt: string) {
  const result = await runSSHCommand(
    config,
    `cat "$HOME/.cf/cli/log/"*.jsonl 2>/dev/null | awk -v since="${startedAt}" -F'"timestamp":"' 'substr($2,1,24) >= since' | grep -E '"event":"model\\.network\\.' | while IFS= read -r line; do printf '%s\\n' "$line" | grep -oE '"(timestamp|event|modelId|providerId|providerKind|baseURL|status|statusCode|responseStatus|durationMs|finishReason|errorCode|retryCount)":"?[^,"}]*' | paste -sd '\t' -; done`,
  );
  return result.stdout.trim().split("\n").filter(Boolean);
}

describe(`${CASE_MARKER}: 账Number Coding Plan 代表（BigModel Team / glm-5.3-flash）经 Provisioning 到达 SSH Target并真实Request`, () => {
  const facts: Record<string, unknown> = {};
  let remoteConfig: SSHConnectionConfig | undefined;
  let requestStartedAt: string | undefined;

  after(async () => {
    if (remoteConfig && requestStartedAt) {
      try {
        facts.remoteModelNetwork = await readRemoteModelNetwork(remoteConfig, requestStartedAt);
      } catch (error) {
        facts.remoteModelNetworkCollectionError = String(error);
      }
    }
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "live-team.json"), JSON.stringify(facts, null, 2));
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-LIVE-02 After local account narrow settings and OAuth provisioning, remote credential exchange completes real Team request", async function () {
    this.timeout(30 * 60_000);
    const config = readSSHRuntimeConfig(CASE_MARKER);
    remoteConfig = config;
    const workspaceA = config.workspacePaths[0];
    const imported = await importLiveBigModelCredentials(CASE_MARKER);
    facts.imported = imported;
    const defaultWorkspace = resolve(getE2EAppDataPaths().homeDir, "CfProject");
    await mkdir(defaultWorkspace, { recursive: true });
    await seedSettings({
      providerFamilyDomain: "bigmodel",
      providerFamilyConnectionSelections: { bigmodel: imported.teamSelection },
      lastWorkspaceSession: [
        { kind: "local", workspacePath: defaultWorkspace, workspacePurpose: "project" },
      ],
      lastActiveTabIndex: 0,
    } as never);
    await reloadElectronSessionPreservingBrowserProfile(browser);
    await prepareV4ConversationE2E({ skipProvider: true });
    const initialHosts = await readHostProcesses();
    try {
      await selectUpstreamProviderModelById(TEAM_MODEL_ID, {
        includePlainModelFallback: false,
        providerId: TEAM_PROVIDER_ID,
        providerName: "BigModel",
      });
      facts.localAccountModelReady = TEAM_MODEL_ID;
    } catch (error) {
      facts.localAccountModelUnavailable = true;
      throw new Error(`${CASE_MARKER}: BLOCKED_ACCOUNT Local machine真实账Number的 Team Model未就绪`, {
        cause: error,
      });
    }

    const startedAt = new Date().toISOString();
    requestStartedAt = startedAt;
    await connectSSHWorkspace({ caseMarker: CASE_MARKER, config, workspacePath: workspaceA });
    const remoteSettings = await runSSHCommand(config, 'cat "$HOME/.cf/v2/setting.json"');
    expect(remoteSettings.stdout).toContain('"providerFamilyDomain": "bigmodel"');
    const remoteCredentialKeys = await runSSHCommand(
      config,
      `grep -o '"[^"]*":' "$HOME/.cf/v2/credentials.json" | sed -E 's/^"//; s/":$//'`,
    );
    facts.remoteCredentialKeys = remoteCredentialKeys.stdout.trim().split("\n").filter(Boolean);
    expect(remoteCredentialKeys.stdout).not.toContain("account-provider:coding-plan:");
    expect(remoteCredentialKeys.stdout).toContain("oauth:active_provider");
    expect(remoteCredentialKeys.stdout).toContain("oauth:bigmodel:access_token");

    await selectUpstreamProviderModelById(TEAM_MODEL_ID, {
      includePlainModelFallback: false,
      providerId: TEAM_PROVIDER_ID,
      providerName: "BigModel",
    });
    const replayBefore = await getUpstreamRequestRecordCount();
    await sendV4PromptAndWaitAccepted(
      `${CASE_MARKER}_FIRST 请只Reply TEAM1，不要Otherinner容`,
      `${CASE_MARKER}_FIRST`,
      `${CASE_MARKER}: Initial turn未被接受`,
    );
    const running = await waitForV4ConversationState(
      (s) => Boolean(s.taskId && s.taskId !== "draft"),
      `${CASE_MARKER}: Initial turn没有产生 task`,
      60_000,
    );
    await waitForV4ConversationState(
      (s) => s.taskId === running.taskId && s.state === "idle" && s.queueCount === 0,
      `${CASE_MARKER}: 真实Initial turn没有收口`,
      180_000,
    );
    await browser.waitUntil(
      async () =>
        (await getV4Messages("assistant")).some((message) => /TEAM\s*1/u.test(message.text ?? "")),
      { timeout: 30_000, timeoutMsg: `${CASE_MARKER}: assistant 未Back TEAM1` },
    );
    const text = (await getV4Messages("assistant")).map((message) => message.text ?? "").join("\n");
    facts.replyContainsMarker = /TEAM\s*1/u.test(text);
    expect(text).toMatch(/TEAM\s*1/u);
    expect(await getUpstreamRequestRecordCount()).toBe(replayBefore);
    expect(await readHostProcesses()).toEqual(initialHosts);

    const remoteRequests = await readRemoteModelNetwork(config, startedAt);
    facts.remoteModelNetwork = remoteRequests;
    const completed = remoteRequests.find((row) => {
      const fields = row.split("\t");
      return [
        '"event":"model.network.completed',
        `"providerId":"${TEAM_PROVIDER_ID}`,
        `"modelId":"${TEAM_MODEL_ID}`,
      ].every((field) => fields.includes(field));
    });
    expect(completed).toBeDefined();
    expect(completed).toContain('"baseURL":"https://open.bigmodel.cn/api/anthropic');
  });
});
