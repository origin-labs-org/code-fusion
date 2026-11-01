import { releaseControlledReplay } from "#e2e/helpers/controlled-replay";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  getUpstreamRequestRecordCount,
  getUpstreamRequestEvidence,
  waitForUpstreamRequest,
} from "../../../helpers/conversation-session-network.js";
import {
  refreshSeededOpenAIProvidersThroughSettings,
  seedCustomAnthropicMessagesProvider,
} from "../../../helpers/custom-openai-provider.js";
import {
  selectUpstreamProviderModelById,
  selectUpstreamThoughtLevelValue,
} from "../../../helpers/upstream-provider.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  prepareSSHLifecycle,
  SSH_LIFECYCLE_MODEL_ID,
  type SSHLifecycleProvider,
} from "../../../helpers/ssh-remote-lifecycle.js";
import {
  readRemoteTabSnapshot,
  runSSHCommand,
  waitForRemoteTab,
} from "../../../helpers/ssh-remote-p0.js";
import {
  clickFirstV4Fork,
  editFirstV4UserQuery,
  getV4ConversationState,
  sendV4Prompt,
  sendV4PromptAndWaitAccepted,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
  waitForV4Fork,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

const CASE_MARKER = "E2E_R3_MODEL_SWITCH";
const artifactDir = resolve(process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-model-switch");
const PROVIDER_B_ID = "e2e-r3-model-switch-b";
const PROVIDER_B_NAME = "R3 Model Switch B";
const MODEL_B_ID = "e2e-r3-model-b";

describe(`${CASE_MARKER}: 慢回合MediumSwitch Model、fork/edit 与远端历史`, () => {
  let provider: SSHLifecycleProvider | null = null;
  const facts: Record<string, unknown> = {};

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "model-switch.json"), JSON.stringify(facts, null, 2));
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-PRV-14/TASK-04 Switching to B during Model A slow turn: A request body remains A, next turn request body is B; fork/edit preserves history and identity remotely", async function () {
    this.timeout(30 * 60_000);
    const prepared = await prepareSSHLifecycle(CASE_MARKER, {
      apiType: "anthropic-messages",
      tunnelUsername: "tunnel",
    });
    provider = prepared.provider;
    await seedCustomAnthropicMessagesProvider({
      baseURL: `${provider.tunnel.baseURL}/anthropic`,
      modelId: MODEL_B_ID,
      providerId: PROVIDER_B_ID,
      providerName: PROVIDER_B_NAME,
    });
    await refreshSeededOpenAIProvidersThroughSettings([PROVIDER_B_NAME]);
    const [workspaceA] = prepared.config.workspacePaths;
    const taskA = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: prepared.config,
      label: "A",
      provider,
      workspacePath: workspaceA,
    });
    const remoteConfig = await runSSHCommand(
      prepared.config,
      'cat "$HOME/.cf/v2/provider_config.json"',
    );
    expect(remoteConfig.stdout).toContain(PROVIDER_B_NAME);

    const slowStart = await getUpstreamRequestRecordCount();
    await sendV4Prompt(`${CASE_MARKER}_SLOW 慢慢Answer`);
    await waitForV4TimelineContaining("R3_SWITCH_STREAMING", 60_000);
    await waitForV4Pane(
      (s) => s.canStop && s.sessionId === taskA.taskId,
      "A did not enter running",
      45_000,
    );
    await waitForUpstreamRequest(
      { lastUserMessageIncludes: [`${CASE_MARKER}_SLOW`] },
      `${CASE_MARKER}: 慢回合Request体不Yes Model A`,
      30_000,
      { afterIndex: slowStart - 1 },
    );
    await selectUpstreamProviderModelById(MODEL_B_ID, {
      includePlainModelFallback: false,
      providerId: PROVIDER_B_ID,
      providerName: PROVIDER_B_NAME,
    });
    await selectUpstreamThoughtLevelValue("disabled");
    facts.switchedDuringRunning = (await getV4ConversationState()).state;
    expect(facts.switchedDuringRunning).toBe("streaming");
    await releaseControlledReplay("r3-switch-slow");
    await waitForV4AssistantMessageContaining("R3_SWITCH_STREAMING", 90_000);
    await waitForV4ConversationState(
      (s) => s.taskId === taskA.taskId && s.state === "idle",
      `${CASE_MARKER}: 慢回合没有收口`,
      120_000,
    );
    const slowRequests = await getUpstreamRequestEvidence(
      {
        lastUserMessageIncludes: [`${CASE_MARKER}_SLOW`],
        excludes: ["CRITICAL: Respond with TEXT ONLY"],
      },
      { afterIndex: slowStart - 1 },
    );
    expect(slowRequests).toHaveLength(1);
    expect(slowRequests[0]!.requestJson).toMatchObject({ model: SSH_LIFECYCLE_MODEL_ID });
    facts.slowRequestModelIsA = true;
    const nextStart = await getUpstreamRequestRecordCount();
    await sendV4PromptAndWaitAccepted(
      `${CASE_MARKER}_NEXT 请Reply`,
      `${CASE_MARKER}_NEXT`,
      `${CASE_MARKER}: 切换后下One回合未被接受`,
    );
    await waitForUpstreamRequest(
      {
        lastUserMessageIncludes: [`${CASE_MARKER}_NEXT`],
        includes: [taskA.firstPrompt],
      },
      `${CASE_MARKER}: 下One回合Request体不Yes Model B or丢失历史`,
      60_000,
      { afterIndex: nextStart - 1 },
    );
    const nextRequests = await getUpstreamRequestEvidence(
      {
        lastUserMessageIncludes: [`${CASE_MARKER}_NEXT`],
        excludes: ["CRITICAL: Respond with TEXT ONLY"],
      },
      { afterIndex: nextStart - 1 },
    );
    expect(nextRequests).toHaveLength(1);
    expect(nextRequests[0]!.requestJson).toMatchObject({ model: MODEL_B_ID });
    facts.nextRequestModelIsB = true;
    await waitForV4AssistantMessageContaining("R3_MODEL_B_REPLY", 90_000);
    await waitForV4ConversationState(
      (s) => s.taskId === taskA.taskId && s.state === "idle",
      `${CASE_MARKER}: B 回合没有收口`,
      60_000,
    );

    await waitForV4Fork(30_000);
    expect(await clickFirstV4Fork()).toBe(true);
    let forkedTaskId = "";
    await browser.waitUntil(
      async () => {
        const state = await getV4ConversationState();
        if (state.taskId && state.taskId !== taskA.taskId && state.taskId !== "draft") {
          forkedTaskId = state.taskId;
          return true;
        }
        return false;
      },
      { timeout: 60_000, timeoutMsg: `${CASE_MARKER}: fork 没有产生New session` },
    );
    const forkTab = await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: taskA.identity,
      expectedPath: workspaceA,
    });
    expect(forkTab.remoteSessionId).toBe(taskA.remoteSessionId);
    const forkStart = await getUpstreamRequestRecordCount();
    await sendV4PromptAndWaitAccepted(
      `${CASE_MARKER}_FORK 请Reply`,
      `${CASE_MARKER}_FORK`,
      `${CASE_MARKER}: fork 续发未被接受`,
    );
    await waitForUpstreamRequest(
      { lastUserMessageIncludes: [`${CASE_MARKER}_FORK`], includes: [taskA.firstPrompt] },
      `${CASE_MARKER}: fork Sub-sessionRequestMissing父历史`,
      60_000,
      { afterIndex: forkStart - 1 },
    );
    await waitForV4ConversationState(
      (s) => s.taskId === forkedTaskId && s.state === "idle",
      `${CASE_MARKER}: fork 回合没有收口`,
      90_000,
    );
    facts.fork = { parent: taskA.taskId, child: forkedTaskId };

    const editStart = await getUpstreamRequestRecordCount();
    const editedText = `${CASE_MARKER}_EDITED 请Reply`;
    await editFirstV4UserQuery(editedText);
    await waitForUpstreamRequest(
      { lastUserMessageIncludes: [`${CASE_MARKER}_EDITED`], excludes: [`${CASE_MARKER}_FORK`] },
      `${CASE_MARKER}: edit 后RequestContext未按Edit后inner容Replay`,
      60_000,
      { afterIndex: editStart - 1 },
    );
    await waitForV4ConversationState(
      (s) => s.state === "idle",
      `${CASE_MARKER}: edit 回合没有收口`,
      90_000,
    );
    facts.editRequestReplayedFromEditedQuery = true;
    expect((await readRemoteTabSnapshot(taskA.identity)).secretPersistedInTab).toBe(false);
  });
});
