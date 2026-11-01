import { selectTaskOrganizeMode } from "../../../helpers/workspace-agent-warmup.js";
import {
  openRemoteProjectSelection,
  waitForRemoteTab,
  waitForSSHDirectoryStep,
  selectSSHRemoteDirectory,
} from "#e2e/helpers/ssh-remote-p0";
import {
  disconnectRemoteSource,
  reconnectRemoteProject,
} from "#e2e/helpers/remote-project-actions";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { parseRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";
import { TID_DOCKER_CONTAINER_INPUT, TID_REMOTE_KIND_DOCKER } from "@origin-ai/cf-shared/test-ids";
import { ApiKeyAccessConfig, ProviderApiConfig, ProviderConfig } from "@origin-ai/cf-provider";
import { NodePersonalProviderConfigRepository } from "@origin-ai/cf-provider-node";
import {
  clearAppData,
  clickTestIdByDom,
  getE2EAppDataPaths,
} from "../../../helpers/desktop-app.js";
import { refreshSeededOpenAIProvidersThroughSettings } from "../../../helpers/custom-openai-provider.js";
import {
  selectUpstreamProviderModelById,
  selectUpstreamThoughtLevelValue,
} from "../../../helpers/upstream-provider.js";
import { getUpstreamRequestRecordCount } from "../../../helpers/conversation-session-network.js";
import {
  clickLastEnabledSSHDialogButton,
  readHostProcesses,
  readRemoteTabSnapshot,
} from "../../../helpers/ssh-remote-p0.js";
import {
  getV4Messages,
  prepareV4ConversationE2E,
  sendV4PromptAndWaitAccepted,
  waitForV4ConversationState,
} from "../../../helpers/v4-conversation.js";

const CASE_MARKER = "E2E_R3_DOCKER_TRANSPORT";
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-docker-transport",
);
const LIVE_PROVIDER_ID = "e2e-r3-docker-live-zapi";
const LIVE_PROVIDER_NAME = "R3 Docker Live ZAPI";
const LIVE_MODEL_ID = "GLM-5.3";
const USER_ZAPI_PROVIDER_ID = "84916fff-3839-4e1c-a59d-64923669a665";
const run = promisify(execFile);

async function dockerSh(container: string, command: string): Promise<string> {
  try {
    return (await run("docker", ["exec", container, "sh", "-lc", command], { maxBuffer: 1 << 22 }))
      .stdout;
  } catch (error) {
    return `ERR:${(error as { stderr?: string }).stderr ?? String(error)}`;
  }
}

async function seedLiveZapiProvider(): Promise<{ baseURL: string }> {
  const sourcePath = process.env.R3_LIVE_PERSONAL_CONFIG?.trim();
  if (!sourcePath) throw new Error(`${CASE_MARKER}: 需Settings R3_LIVE_PERSONAL_CONFIG`);
  const sourceRepository = new NodePersonalProviderConfigRepository({
    filePath: sourcePath,
    pollingIntervalMs: false,
  });
  let sourceApiKey: string | undefined;
  let sourceBaseUrl: string | undefined;
  let sourceApiType: string | undefined;
  try {
    const snapshot = await sourceRepository.read();
    const rule = snapshot.providers.getRule(USER_ZAPI_PROVIDER_ID);
    const access = rule?.config.access;
    sourceApiKey = access?.type === "api-key" ? (access.apiKey ?? undefined) : undefined;
    sourceBaseUrl = rule?.config.api?.baseUrl ?? undefined;
    sourceApiType = rule?.config.api?.type ?? undefined;
  } finally {
    sourceRepository.dispose();
  }
  if (!sourceApiKey || sourceApiType !== "anthropic-messages" || !sourceBaseUrl) {
    throw new Error(
      `${CASE_MARKER}: Local machine ZAPI provider（${USER_ZAPI_PROVIDER_ID}, anthropic-messages）ConfigurationUnavailable——live 材料缺失，需在Local machine Personal ConfigurationMedium导入 ZAPI provider`,
    );
  }
  const repository = new NodePersonalProviderConfigRepository({
    filePath: getE2EAppDataPaths().configFile,
    pollingIntervalMs: false,
  });
  try {
    await repository.update((current) => ({
      ...current,
      providers: current.providers.setRule({
        providerId: LIVE_PROVIDER_ID,
        providerName: LIVE_PROVIDER_NAME,
        config: new ProviderConfig({
          group: "standard-personal",
          access: new ApiKeyAccessConfig({ apiKey: sourceApiKey }),
          api: new ProviderApiConfig({ type: "anthropic-messages", baseUrl: sourceBaseUrl }),
          personalModelIds: [LIVE_MODEL_ID],
        }),
      }),
      models: current.models,
    }));
  } finally {
    repository.dispose();
  }
  return { baseURL: sourceBaseUrl };
}

async function connectDockerTargetUntilReady(
  container: string,
): Promise<{ identity: string; remoteSessionId: string; kind: string | null }> {
  await openRemoteProjectSelection();
  await clickTestIdByDom(TID_REMOTE_KIND_DOCKER, {
    timeout: 30_000,
    timeoutMsg: `${CASE_MARKER}: 无法选择 Docker transport`,
  });
  const input = $(`[data-testid="${TID_DOCKER_CONTAINER_INPUT}"]`);
  await input.waitForDisplayed({ timeout: 30_000 });
  await input.setValue(container);
  await clickLastEnabledSSHDialogButton(CASE_MARKER);
  await waitForSSHDirectoryStep(CASE_MARKER);
  const workspacePath = process.env.CF_E2E_SSH_WORKSPACE_PATH;
  if (!workspacePath) throw new Error(`${CASE_MARKER}: Missing Docker ProjectTable of Contents`);
  await selectSSHRemoteDirectory(workspacePath, CASE_MARKER);
  const tab = await waitForRemoteTab({ caseMarker: CASE_MARKER, expectedPath: workspacePath });
  return {
    identity: tab.workspaceIdentity!,
    remoteSessionId: tab.remoteSessionId!,
    kind: tab.remoteKind,
  };
}

describe(`${CASE_MARKER}: Desktop Docker transport 首装、Initial turn与CloseReconnect`, () => {
  const facts: Record<string, unknown> = {};

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "docker-transport.json"), JSON.stringify(facts, null, 2));
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-TRN-01 Standalone Docker container: Docker entry installation, Provisioning, real first send, reconnect after disconnect", async function () {
    this.timeout(30 * 60_000);
    const container = process.env.R3_DOCKER_TARGET?.trim();
    if (!container) throw new Error(`${CASE_MARKER}: 需Settings R3_DOCKER_TARGET`);
    facts.container = container;
    facts.containerUser = (
      await dockerSh(
        container,
        "id -un; test -e ~/.cf/server/current.json && echo installed || echo fresh",
      )
    ).trim();
    await prepareV4ConversationE2E({ skipProvider: true });
    const initialHosts = await readHostProcesses();
    const seeded = await seedLiveZapiProvider();
    await refreshSeededOpenAIProvidersThroughSettings([LIVE_PROVIDER_NAME]);

    const ready = await connectDockerTargetUntilReady(container);
    facts.ready = ready;
    expect(ready.kind).toBe("docker");
    const parsed = parseRemoteWorkspaceIdentity(ready.identity);
    expect(parsed?.kind).toBe("server");
    const installState = await dockerSh(
      container,
      'grep -o \'"archiveSha256": *"[0-9a-f]*"\' ~/.cf/server/current.json || true; cat ~/.cf/server/run/status.json | tr -d "\\n "; echo; grep -o "\\"providerName\\": *\\"[^\\"]*\\"" ~/.cf/v2/provider_config.json || true',
    );
    facts.remoteAfterConnect = installState.split("\n").filter(Boolean).slice(0, 8);
    expect(installState).toContain("archiveSha256");
    expect(installState).toContain('"state":"ready"');
    expect(installState).toContain(LIVE_PROVIDER_NAME);
    expect(await readHostProcesses()).toEqual(initialHosts);

    await selectUpstreamProviderModelById(LIVE_MODEL_ID, {
      includePlainModelFallback: false,
      providerId: LIVE_PROVIDER_ID,
      providerName: LIVE_PROVIDER_NAME,
    });
    await selectUpstreamThoughtLevelValue("low");
    const replayBefore = await getUpstreamRequestRecordCount();
    await sendV4PromptAndWaitAccepted(
      `${CASE_MARKER}_FIRST 请只Reply DOCKER1`,
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
        (await getV4Messages("assistant")).some((message) =>
          /DOCKER\s*1/u.test(message.text ?? ""),
        ),
      { timeout: 30_000, timeoutMsg: `${CASE_MARKER}: assistant 未Back DOCKER1` },
    );
    const text = (await getV4Messages("assistant")).map((message) => message.text ?? "").join("\n");
    expect(text).toMatch(/DOCKER\s*1/u);
    expect(await getUpstreamRequestRecordCount()).toBe(replayBefore);
    const remoteRequests = await dockerSh(
      container,
      'F=$(ls -t ~/.cf/cli/log/*.jsonl | head -n1); grep -c "model.network.completed" "$F" || true; grep -o "\\"baseURL\\":\\"[^\\"]*\\"" "$F" | sort | uniq -c',
    );
    facts.remoteModelNetwork = remoteRequests.trim().split("\n");
    expect(remoteRequests).toContain(seeded.baseURL);

    const sourceId = parsed?.sourceServerId;
    await selectTaskOrganizeMode(["项目", "Project"]);

    await disconnectRemoteSource(sourceId!, CASE_MARKER, { workspaceIdentities: [ready.identity] });

    const daemonAfterDisconnect = await dockerSh(
      container,
      'cat ~/.cf/server/run/status.json | tr -d "\\n " | cut -c1-120',
    );
    expect(daemonAfterDisconnect).toContain('"state":"ready"');
    await reconnectRemoteProject(ready.identity, CASE_MARKER);
    let reconnected: string | null = null;
    await browser.waitUntil(
      async () => {
        const snapshot = await readRemoteTabSnapshot(ready.identity).catch(() => null);
        if (snapshot?.remoteSessionId && snapshot.remoteSessionId !== ready.remoteSessionId) {
          reconnected = snapshot.remoteSessionId;
          return true;
        }
        return false;
      },
      { timeout: 180_000, interval: 1000, timeoutMsg: `${CASE_MARKER}: Docker TargetReconnect没有换代` },
    );
    facts.reconnected = { before: ready.remoteSessionId, after: reconnected };
    expect(await readHostProcesses()).toEqual(initialHosts);
  });
});
