import { TID_V4_MODEL_CONFIG } from "@origin-ai/cf-shared/test-ids";
import { DEFAULT_WORKSPACE, clearAppData, waitForWorkspaceApp } from "../helpers/desktop-app.js";
import {
  selectUpstreamProviderModelById,
  selectUpstreamThoughtLevelValue,
  waitForUpstreamModelSelected,
} from "../helpers/upstream-provider.js";
import { restartWithSeededOpenAIProviders } from "../helpers/custom-openai-provider.js";
import {
  assertUpstreamRequestCapture,
  waitForUpstreamNetworkCapture,
} from "../helpers/upstream-capture.js";
import {
  clickFirstV4Fork,
  getV4ModelConfig,
  getV4PaneSnapshot,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4Fork,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

describe("v4 M4 门禁：forkAssistant", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("完成态 assistant 行 fork → 切到 child session，历史含父内容", async () => {
    await prepareGlm52Draft();

    await sendV4Prompt("E2E_V4_FORK_PARENT 说一句话");
    await waitForV4TimelineContaining("V4_FORK_PARENT_REPLY", 60000);

    const parent = await waitForV4Pane(
      (s) => s.sessionId !== "draft" && s.sessionId !== null,
      "父会话没有绑定 sessionId",
    );
    const parentSessionId = parent.sessionId;

    const parentThoughtLevels = await readThoughtLevelValues();
    expect(parentThoughtLevels).toHaveLength(3);
    expect(parentThoughtLevels).toEqual(expect.arrayContaining(["high", "max"]));

    await waitForV4Fork();
    const clicked = await clickFirstV4Fork();
    expect(clicked).toBe(true);

    const child = await waitForV4Pane(
      (s) => s.sessionId !== null && s.sessionId !== "draft" && s.sessionId !== parentSessionId,
      "fork 后 pane 没有切到 child session",
      60000,
    );
    expect(child.sessionId).not.toBe(parentSessionId);

    await browser.waitUntil(
      async () => (await readThoughtLevelValues()).join(",") === "high,max,nothink",
      { timeout: 30000, timeoutMsg: "fork child 没有恢复父会话的三档思考能力" },
    );
    expect(await readThoughtLevelValues()).toEqual(["high", "max", "nothink"]);
    await browser.waitUntil(async () => (await getV4ModelConfig()).thought === "high", {
      timeout: 30000,
      timeoutMsg: "fork child 没有恢复父会话的 high 思考等级",
    });

    const childPrompt = "E2E_V4_FORK_CHILD 继续回答";
    await sendV4Prompt(childPrompt);
    const childRequest = await waitForUpstreamNetworkCapture("E2E_V4_FORK_CHILD");
    assertUpstreamRequestCapture(childRequest, {
      expectedText: childPrompt,
      model: "GLM-5.2",
    });
    const childRequestJson = childRequest.requestJson as Record<string, unknown>;
    expect(childRequestJson.reasoning_effort).toBe("high");
    expect(childRequestJson.thinking).toBeUndefined();
    const boundaryText = "This session was forked from a previous session message.";
    const messages = childRequestJson.messages as Array<{ role: string; content: string }>;
    const boundaryIndex = messages.findIndex((message) => message.content.includes(boundaryText));
    const questionIndex = messages.findIndex((message) => message.content.includes(childPrompt));
    expect(boundaryIndex).toBeGreaterThanOrEqual(0);
    expect(boundaryIndex).toBeLessThan(questionIndex);
    const boundary = messages[boundaryIndex]!;
    expect(boundary.role).toBe("user");
    expect(boundary.content).toMatch(/^<system-reminder>\n/);
    expect(boundary.content).toMatch(/\n<\/system-reminder>$/);
    expect(boundary.content.match(/<system-reminder>/g)).toHaveLength(1);
    expect(JSON.stringify(messages).split(boundaryText)).toHaveLength(2);
    await waitForV4TimelineContaining("V4_FORK_CHILD_REPLY", 30000);

    await waitForV4TimelineContaining("V4_FORK_PARENT_REPLY", 30000);
    const finalSnapshot = await getV4PaneSnapshot();
    expect(finalSnapshot.timelineText).toContain("E2E_V4_FORK_PARENT");
    expect(finalSnapshot.timelineText).not.toContain(boundaryText);
    expect(finalSnapshot.timelineText).not.toContain("<system-reminder>");
  });
});

async function prepareGlm52Draft(): Promise<void> {
  const modelId = "GLM-5.2";
  const providerId = "e2e-v4-fork-glm52-provider";
  const providerName = `V4 Fork GLM 5.2 E2E ${Date.now()}`;
  await prepareV4ConversationE2E({ skipProvider: true });
  await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30000);
  const [provider] = await restartWithSeededOpenAIProviders([
    {
      modelId,
      providerId,
      providerName,
      reasoningLevel: {
        values: ["nothink", "high", "max"],
        map: '{"reasoning_effort":reasoningLevel}',
      },
    },
  ]);
  if (!provider) throw new Error("V4 fork GLM-5.2 replay provider seed 失败");
  await prepareV4ConversationE2E({ skipProvider: true });
  await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30000);
  await selectUpstreamProviderModelById(modelId, {
    includePlainModelFallback: false,
    providerId: provider.id,
    providerName,
  });
  await waitForUpstreamModelSelected(modelId, {
    includePlainModelFallback: false,
    providerId: provider.id,
  });
  await selectUpstreamThoughtLevelValue("high");
}

async function readThoughtLevelValues(): Promise<string[]> {
  return browser.execute((testId) => {
    const values = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.dataset
      .thoughtLevels;
    return (values ?? "").split(",").filter(Boolean).sort();
  }, TID_V4_MODEL_CONFIG);
}
