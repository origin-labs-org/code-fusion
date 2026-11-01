import {
  DEFAULT_WORKSPACE,
  clearAppData,
  waitForDefaultWorkspaceReady,
  waitForWorkspaceApp,
} from "../../../helpers/desktop-app.js";
import { reloadElectronSessionPreservingBrowserProfile } from "../../../helpers/e2e-electron-reload.js";
import { getV4ComposerDraftScopeSnapshot } from "../../../helpers/conversation-session-store.js";
import {
  assertUpstreamRequestCapture,
  assertUpstreamThoughtLevelCapture,
  waitForUpstreamNetworkCapture,
} from "../../../helpers/upstream-capture.js";
import {
  UPSTREAM_PROVIDER_ID,
  UPSTREAM_MODEL,
  UPSTREAM_SECONDARY_MODEL,
  UPSTREAM_SECONDARY_THOUGHT_LEVEL,
  ensureUpstreamModelForE2E,
  getUpstreamProviderModelValues,
  getUpstreamThoughtLevelLabels,
  getSelectedUpstreamModelLabel,
  getSelectedUpstreamThoughtLevelLabel,
  selectUpstreamModelById,
  selectUpstreamThoughtLevelValue,
} from "../../../helpers/upstream-provider.js";
import {
  E2E_REPLY_TOKEN,
  prepareConversationE2E,
  sendPrompt,
  waitForAssistantMessageContaining,
  waitForChatState,
  waitForComposerText,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";
import {
  getV4ModelConfig,
  selectV4TaskById,
  switchV4Mode,
} from "../../../helpers/v4-conversation.js";

describe("Chat area draft model switch first send E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("I10/I47/I52: First send freezes Composer selection; persists after acceptance and cold restart", async function () {
    this.timeout(260000);

    await prepareConversationE2E();
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30000);
    await ensureUpstreamModelForE2E(UPSTREAM_SECONDARY_MODEL);
    await waitForChatState(
      (snapshot) =>
        snapshot.state === "idle" &&
        snapshot.sessionId === null &&
        snapshot.taskId === null &&
        snapshot.queueCount === 0,
      "Draft model switch case not in empty draft state",
      30000,
    );

    await selectUpstreamModelById(UPSTREAM_SECONDARY_MODEL, {
      includePlainModelFallback: false,
      providerId: UPSTREAM_PROVIDER_ID,
    });
    await selectUpstreamThoughtLevelValue(UPSTREAM_SECONDARY_THOUGHT_LEVEL);
    await assertSelectedSecondaryConfig();

    const runId = Date.now();
    const marker = `E2E_DRAFT_MODEL_SWITCH_FIRST_SEND_${runId}`;
    const prompt = `${marker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(prompt);
    await waitForComposerText("", "Input box not cleared after first send in draft model switch case");
    await waitForUserMessageContaining(marker);

    const captureRecord = await waitForUpstreamNetworkCapture(marker);
    assertUpstreamRequestCapture(captureRecord, {
      expectedText: prompt,
      model: UPSTREAM_SECONDARY_MODEL,
    });
    if (UPSTREAM_SECONDARY_THOUGHT_LEVEL) {
      assertUpstreamThoughtLevelCapture(captureRecord, UPSTREAM_SECONDARY_THOUGHT_LEVEL);
    }

    await waitForAssistantMessageContaining(E2E_REPLY_TOKEN);
    const completed = await waitForChatState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      "Did not return to idle after first round completion in draft model switch case",
      90000,
    );
    const sessionId = completed.sessionId ?? completed.taskId;
    if (!sessionId) throw new Error("Missing sessionId after first round completion in draft model switch case");

    await assertSelectedSecondaryConfig();
    await selectUpstreamModelById(UPSTREAM_MODEL, {
      includePlainModelFallback: false,
      providerId: UPSTREAM_PROVIDER_ID,
    });
    await switchV4Mode("edit");
    await waitForComposerConfig(UPSTREAM_MODEL, "edit");
    const beforeRestartDraft = await getV4ComposerDraftScopeSnapshot(DEFAULT_WORKSPACE, sessionId);
    expect(beforeRestartDraft).toMatchObject({
      exists: true,
      mode: "edit",
      modelSelection: {
        modelId: UPSTREAM_MODEL,
        providerId: UPSTREAM_PROVIDER_ID,
      },
    });
    await reloadElectronSessionPreservingBrowserProfile(browser);
    await waitForRendererAfterReloadSession();
    await waitForDefaultWorkspaceReady(60000);
    await selectV4TaskById(sessionId);
    expect(await getV4ComposerDraftScopeSnapshot(DEFAULT_WORKSPACE, sessionId)).toMatchObject({
      exists: true,
      mode: "edit",
      modelSelection: {
        modelId: UPSTREAM_MODEL,
        providerId: UPSTREAM_PROVIDER_ID,
      },
    });
    await waitForComposerConfig(UPSTREAM_MODEL, "edit");
  });
});

async function waitForComposerConfig(model: string, mode: string) {
  let latest = await getV4ModelConfig();
  await browser.waitUntil(
    async () => {
      latest = await getV4ModelConfig();
      return (
        latest.source === "composer" &&
        latest.provider === UPSTREAM_PROVIDER_ID &&
        latest.model === model &&
        latest.mode === mode
      );
    },
    {
      timeout: 30000,
      timeoutMsg: `Composer Configuration没有恢复: ${JSON.stringify({ expected: { model, mode }, latest })}`,
    },
  );
}

async function assertSelectedSecondaryConfig() {
  const modelLabel = await getSelectedUpstreamModelLabel();
  const acceptedModelValues = getUpstreamProviderModelValues(UPSTREAM_SECONDARY_MODEL, {
    includePlainModelFallback: false,
    providerId: UPSTREAM_PROVIDER_ID,
  });
  const modelSelected =
    acceptedModelValues.includes(modelLabel.currentValue) ||
    modelLabel.text.includes(UPSTREAM_SECONDARY_MODEL) ||
    modelLabel.title.includes(UPSTREAM_SECONDARY_MODEL);
  if (!modelSelected) {
    throw new Error(
      `DraftCurrentModel不Yes secondary 上游 Model: ${JSON.stringify({
        acceptedModelValues,
        model: UPSTREAM_SECONDARY_MODEL,
        modelLabel,
      })}`,
    );
  }

  if (!UPSTREAM_SECONDARY_THOUGHT_LEVEL) {
    return;
  }
  const thoughtLabel = await getSelectedUpstreamThoughtLevelLabel();
  const acceptedThoughtValues = [
    UPSTREAM_SECONDARY_THOUGHT_LEVEL,
    ...getUpstreamThoughtLevelLabels(UPSTREAM_SECONDARY_THOUGHT_LEVEL),
  ].map((value) => value.toLowerCase());
  const currentThoughtCandidates = [
    thoughtLabel.currentValue,
    thoughtLabel.ariaLabel,
    thoughtLabel.text,
    thoughtLabel.title,
  ].map((value) => value.replace(/\s+/g, " ").trim().toLowerCase());
  if (
    !currentThoughtCandidates.some((candidate) => acceptedThoughtValues.includes(candidate))
  ) {
    throw new Error(
      `DraftCurrentThinking深度不Yes secondary Configuration: ${JSON.stringify({
        acceptedThoughtValues,
        thoughtLabel,
      })}`,
    );
  }
}

async function waitForRendererAfterReloadSession() {
  await browser.waitUntil(
    async () => {
      try {
        const puppeteer = await browser.getPuppeteer();
        const target = puppeteer
          .targets()
          .filter((candidate) => isRendererUrl(candidate.url()))
          .at(-1) as ({ _targetId?: string } & object) | undefined;
        if (!target?._targetId) return false;
        await browser.switchToWindow(target._targetId);
        return true;
      } catch {
        return false;
      }
    },
    {
      timeout: 30000,
      interval: 250,
      timeoutMsg: "Renderer target not found after Composer Draft cold restart",
    },
  );
}

function isRendererUrl(url: string) {
  try {
    return new URL(url).pathname.endsWith("/renderer/index.html");
  } catch {
    return false;
  }
}
