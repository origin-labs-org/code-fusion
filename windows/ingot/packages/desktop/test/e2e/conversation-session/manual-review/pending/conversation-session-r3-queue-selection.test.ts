import { releaseControlledReplay } from "#e2e/helpers/controlled-replay";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  getUpstreamRequestEvidence,
  getUpstreamRequestRecordCount,
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
import { readRemoteTabSnapshot, runSSHCommand } from "../../../helpers/ssh-remote-p0.js";
import {
  getV4ConversationState,
  sendV4Prompt,
  sendV4PromptAndWaitAccepted,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

const CASE_MARKER = "E2E_R3_QUEUE_SELECTION";
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-queue-selection",
);
const PROVIDER_B_ID = "e2e-r3-queue-selection-b";
const PROVIDER_B_NAME = "R3 Queue Model B";
const MODEL_B_ID = "e2e-r3-queue-model-b";

describe(`${CASE_MARKER}: running 期间已 admitted 的 queue 与Configuration/selection Changes`, () => {
  let provider: SSHLifecycleProvider | null = null;
  const facts: Record<string, unknown> = {};

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "queue-selection.json"), JSON.stringify(facts, null, 2));
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-PRV-15 Enqueue Q (admitted) while Model A slow turn is running, then switch to Model B: model when Q drains follows admission contract and is deterministic; subsequent new turn reads updated Provider fact (B); source ID/history preserved", async function () {
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
    await waitForV4TimelineContaining("R3_QUEUE_STREAMING", 60_000);
    await waitForV4Pane(
      (s) => s.canStop && s.sessionId === taskA.taskId,
      `${CASE_MARKER}: 慢回合没有进入 running`,
      45_000,
    );
    await waitForUpstreamRequest(
      { lastUserMessageIncludes: [`${CASE_MARKER}_SLOW`], includes: [SSH_LIFECYCLE_MODEL_ID] },
      `${CASE_MARKER}: 慢回合Request体不Yes Model A`,
      30_000,
      { afterIndex: slowStart - 1 },
    );
    await sendV4Prompt(`${CASE_MARKER}_QUEUED QueuedMessages`);
    await waitForV4ConversationState(
      (s) => s.taskId === taskA.taskId && s.queueCount >= 1,
      `${CASE_MARKER}: Q 没有进入Queue`,
      30_000,
    );
    const queuedState = await getV4ConversationState();
    facts.queued = { queueCount: queuedState.queueCount, state: queuedState.state };

    const triggerWhileQueued = await browser.execute(() => {
      const trigger = document.querySelector<HTMLButtonElement>(
        '[data-testid="chat-model-select-trigger"]',
      );
      return {
        exists: Boolean(trigger),
        disabled: trigger?.disabled ?? null,
        ariaDisabled: trigger?.getAttribute("aria-disabled") ?? null,
        text: trigger?.innerText.replace(/\s+/gu, " ").slice(0, 80) ?? "",
      };
    });
    facts.modelTriggerWhileQueued = triggerWhileQueued;
    expect(triggerWhileQueued.exists).toBe(true);
    let switchedWhileQueued = false;
    if (
      triggerWhileQueued.exists &&
      !triggerWhileQueued.disabled &&
      triggerWhileQueued.ariaDisabled !== "true"
    ) {
      await selectUpstreamProviderModelById(MODEL_B_ID, {
        includePlainModelFallback: false,
        providerId: PROVIDER_B_ID,
        providerName: PROVIDER_B_NAME,
      });
      await selectUpstreamThoughtLevelValue("disabled");
      switchedWhileQueued = true;
    }
    const stateWhileQueued = (await getV4ConversationState()).state;
    facts.switchedWhileQueued = {
      switched: switchedWhileQueued,
      state: stateWhileQueued,
    };
    expect(stateWhileQueued).toBe("streaming");
    await waitForV4AssistantMessageContaining("R3_QUEUE_STREAMING", 90_000);
    expect((await getV4ConversationState()).queueCount).toBeGreaterThan(0);
    expect(
      await getUpstreamRequestEvidence(
        {
          lastUserMessageIncludes: [`${CASE_MARKER}_QUEUED`],
          excludes: ["Generate a concise title"],
        },
        { afterIndex: slowStart - 1 },
      ),
    ).toHaveLength(0);
    await releaseControlledReplay("r3-queue-slow");
    const queuedQuery = {
      lastUserMessageIncludes: [`${CASE_MARKER}_QUEUED`],
      includes: [taskA.firstPrompt],
      excludes: ["Generate a concise title"],
    };
    await waitForUpstreamRequest(queuedQuery, "排队请求必须到达远端模型且保留历史", 90_000, {
      afterIndex: slowStart - 1,
    });
    await waitForV4AssistantMessageContaining("R3_QUEUE_DRAINED", 120_000);
    await waitForV4ConversationState(
      (s) => s.taskId === taskA.taskId && s.state === "idle" && s.queueCount === 0,
      `${CASE_MARKER}: Queue Did not return to idle after drain`,
      120_000,
    );
    const queuedRequests = await getUpstreamRequestEvidence(queuedQuery, {
      afterIndex: slowStart - 1,
    });
    expect(queuedRequests).toHaveLength(1);
    expect(queuedRequests[0]?.requestJson).toMatchObject({ model: SSH_LIFECYCLE_MODEL_ID });
    facts.queueDrainModel = "A";
    if (!switchedWhileQueued) {
      await selectUpstreamProviderModelById(MODEL_B_ID, {
        includePlainModelFallback: false,
        providerId: PROVIDER_B_ID,
        providerName: PROVIDER_B_NAME,
      });
      await selectUpstreamThoughtLevelValue("disabled");
      facts.switchedAfterDrain = true;
    }

    const nextStart = await getUpstreamRequestRecordCount();
    await sendV4PromptAndWaitAccepted(
      `${CASE_MARKER}_NEXT 请Reply`,
      `${CASE_MARKER}_NEXT`,
      `${CASE_MARKER}: New回合未被接受`,
    );
    await waitForUpstreamRequest(
      {
        lastUserMessageIncludes: [`${CASE_MARKER}_NEXT`],
        includes: [MODEL_B_ID, taskA.firstPrompt, `${CASE_MARKER}_QUEUED`],
      },
      `${CASE_MARKER}: New回合Request体不Yes Model B or丢失历史`,
      60_000,
      { afterIndex: nextStart - 1 },
    );
    await waitForV4AssistantMessageContaining("R3_QUEUE_MODEL_B_REPLY", 90_000);
    await waitForV4ConversationState(
      (s) => s.taskId === taskA.taskId && s.state === "idle",
      `${CASE_MARKER}: New回合没有收口`,
      60_000,
    );
    facts.nextTurnModelB = true;
    expect((await readRemoteTabSnapshot(taskA.identity)).remoteSessionId).toBe(
      taskA.remoteSessionId,
    );
  });
});
