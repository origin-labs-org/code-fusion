import { clearAppData, seedSettings } from "../helpers/desktop-app.js";
import { waitForUpstreamRequest } from "../helpers/conversation-session-network.js";
import { waitForToolCallBlockByToolName } from "../helpers/conversation-session-tool.js";
import { waitForUpstreamNetworkCapture } from "../helpers/upstream-capture.js";
import {
  TOOL_CROSS_PRODUCT_CASES,
  buildToolCrossProductPrompt,
  cleanupToolCrossProductFixtures,
  ensureToolCrossProductFullAccessMode,
  markerForToolCase,
  prepareToolCrossProductFixtures,
  respondToToolCrossProductBlockers,
  type ToolCrossProductCase,
  type ToolCrossProductScenario,
} from "../helpers/conversation-session-tool-cross-product.js";
import {
  E2E_REPLY_TOKEN,
  clickFirstV4Fork,
  clickV4Stop,
  getV4ConversationState,
  getV4Messages,
  getV4PaneSnapshot,
  prepareV4ConversationE2E,
  sendV4Prompt,
  startNewV4Draft,
  waitForV4AssistantMessageContaining,
  waitForV4CompactMarker,
  waitForV4ComposerText,
  waitForV4ConversationState,
  waitForV4Fork,
  waitForV4Pane,
  waitForV4UserMessageContaining,
} from "../helpers/v4-conversation.js";

const TOOL_TURN_TIMEOUT_MS = 150000;
const TOOL_CROSS_PRODUCT_TIMEOUT_MS = 1800000;
const COMPACT_REQUEST_SENTINEL = "CRITICAL: Respond with TEXT ONLY";
const FORK_PROBE_PREFIX = "E2E_TOOL_CROSS_PRODUCT_FORK_PROBE";
const GOAL_OBJECTIVE_PREFIX = "E2E_TOOL_CROSS_PRODUCT_GOAL_OBJECTIVE";
const SELECTED_TOOL_CROSS_PRODUCT_CASES = readSelectedToolCrossProductCases();

describe("Conversation area tool cross-product E2E", () => {
  before(async function () {
    this.timeout(TOOL_CROSS_PRODUCT_TIMEOUT_MS);
    await seedSettings({ messageStreamShowTodos: true });
    await prepareV4ConversationE2E();
  });

  afterEach(async () => {
    await stopIfBusy();
    await cleanupToolCrossProductFixtures();
  });

  after(async () => {
    await cleanupToolCrossProductFixtures();
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  for (const toolCase of SELECTED_TOOL_CROSS_PRODUCT_CASES) {
    it(`${toolCase.toolName}: Completed后Allow手动 compact，并RetainTools历史`, async function () {
      this.timeout(TOOL_TURN_TIMEOUT_MS);

      await runToolCaseWithCleanup(toolCase, "compact", async (context) => {
        await sendV4Prompt("/compact");
        await waitForV4ComposerText(
          "",
          `${toolCase.toolName}: Input field not cleared after /compact`,
        );
        await waitForUpstreamRequest(
          {
            includes: compactHistoryMarkers(toolCase, context.marker),
          },
          `${toolCase.toolName}: compact Request没有包含Tools历史 marker`,
          90000,
        );
        await waitForV4CompactMarker(
          { origin: "manual", status: "success" },
          90000,
        );
        await waitForV4ConversationState(
          (snapshot) => snapshot.state === "idle",
          `${toolCase.toolName}: compact 后没有ExitRuntime`,
          90000,
        );
        await expectToolHistoryVisibleOrProviderBacked(toolCase);
      });
    });

    it(`${toolCase.toolName}: Completed后的 assistant message 能 fork 并RetainTools历史`, async function () {
      this.timeout(TOOL_TURN_TIMEOUT_MS);

      await runToolCaseWithCleanup(toolCase, "fork", async (context) => {
        const sourceTaskId = (await getV4PaneSnapshot()).sessionId;
        await waitForV4Fork();
        expect(await clickFirstV4Fork()).toBe(true);
        await waitForV4Pane(
          (snapshot) =>
            snapshot.sessionId !== null &&
            snapshot.sessionId !== "draft" &&
            snapshot.sessionId !== sourceTaskId,
          `${toolCase.toolName}: fork 后没有切换到派生 session/task`,
          30000,
        );
        await waitForV4UserMessageContaining(context.prompt);
        await waitForV4AssistantMessageContaining(E2E_REPLY_TOKEN);
        if (toolCase.historyAssertion === "providerRequest") {
          await assertForkProviderHistory(toolCase, context);
        } else {
          await expectToolBlockVisible(toolCase);
        }
      });
    });

    it(`${toolCase.toolName}: Completed后能Set goal 且不重写既有Tools历史`, async function () {
      this.timeout(TOOL_TURN_TIMEOUT_MS);

      if (toolCase.toolName === "EnterPlanMode") {
        this.skip();
      }

      await runToolCaseWithCleanup(toolCase, "goal", async (context) => {
        const objective = `${GOAL_OBJECTIVE_PREFIX}_${toolCase.markerName}_${context.runId}`;
        await sendV4Prompt(
          `/goal ${objective}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`,
        );
        await waitForV4ComposerText(
          "",
          `${toolCase.toolName}: /goal 后Input框没有Clear`,
        );
        await waitForUpstreamRequest(
          {
            includes: goalHistoryMarkers(toolCase, context.marker, objective),
            excludes: [COMPACT_REQUEST_SENTINEL],
          },
          `${toolCase.toolName}: /goal continuation Request没有包含Target与Tools历史`,
          90000,
        );
        await waitForV4ConversationState(
          (snapshot) =>
            (snapshot.targetStatus === "active" ||
              snapshot.targetStatus === "complete" ||
              snapshot.targetStatus === "completed" ||
              snapshot.targetStatus === "verified") &&
            snapshot.targetObjective?.includes(objective) === true,
          `${toolCase.toolName}: /goal 没有SettingsorCompletedTarget target`,
          90000,
        );
        await waitForV4ConversationState(
          (snapshot) => snapshot.state === "idle",
          `${toolCase.toolName}: /goal continuation 没有回到 idle`,
          90000,
        );
        await expectToolHistoryVisibleOrProviderBacked(toolCase);
      });
    });
  }
});

function readSelectedToolCrossProductCases() {
  const configured = process.env.CF_E2E_TOOL_CROSS_PRODUCT_ONLY?.trim();
  if (!configured) {
    return TOOL_CROSS_PRODUCT_CASES;
  }

  const selected = new Set(
    configured
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const cases = TOOL_CROSS_PRODUCT_CASES.filter(
    (toolCase) =>
      selected.has(toolCase.toolName) || selected.has(toolCase.markerName),
  );
  if (cases.length === 0) {
    throw new Error(
      `CF_E2E_TOOL_CROSS_PRODUCT_ONLY did not match any tool: ${configured}`,
    );
  }
  return cases;
}

async function runToolCaseWithCleanup(
  toolCase: ToolCrossProductCase,
  scenario: ToolCrossProductScenario,
  action: (context: {
    marker: string;
    prompt: string;
    runId: string;
  }) => Promise<void>,
) {
  const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    const context = await runCompletedToolTurn(toolCase, scenario, runId);
    await action(context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${scenario}/${toolCase.toolName} Tools叉乘 case Failed: ${message}`,
      { cause: error },
    );
  } finally {
    await stopIfBusy();
    await cleanupToolCrossProductFixtures();
  }
}

async function runCompletedToolTurn(
  toolCase: ToolCrossProductCase,
  scenario: ToolCrossProductScenario,
  runId: string,
) {
  await startNewV4Draft();
  await prepareToolCrossProductFixtures();
  await ensureToolCrossProductFullAccessMode();

  const marker = markerForToolCase(toolCase);
  const prompt = buildToolCrossProductPrompt(toolCase, scenario, runId);
  await sendV4Prompt(prompt);
  await waitForV4ComposerText(
    "",
    `${toolCase.toolName}: Initial turnTools prompt 后Input框没有Clear`,
  );
  await waitForV4UserMessageContaining(prompt);
  await waitForUpstreamRequest(
    {
      includes: [marker],
      excludes: [COMPACT_REQUEST_SENTINEL],
    },
    `${toolCase.toolName}: Initial turnToolsRequest没有出现`,
    90000,
  );
  await waitForToolTurnIdle(toolCase);
  if (toolCase.historyAssertion === "providerRequest") {
    await waitForProviderBackedToolHistory(toolCase, marker);
  } else {
    await expectToolBlockVisible(toolCase);
  }
  return { marker, prompt, runId };
}

async function waitForToolTurnIdle(toolCase: ToolCrossProductCase) {
  let latestState = "not-started";
  let latestAssistantMessages: string[] = [];
  await browser.waitUntil(
    async () => {
      await respondToToolCrossProductBlockers();
      const [snapshot, assistantMessages] = await Promise.all([
        getV4ConversationState(),
        getV4Messages("assistant"),
      ]);
      latestAssistantMessages = assistantMessages.map((message) => message.text);
      latestState = JSON.stringify({
        state: snapshot.state,
        queueCount: snapshot.queueCount,
        runtimeStatus: snapshot.runtimeStatus,
      });
      return (
        snapshot.state === "idle" &&
        latestAssistantMessages.some((message) =>
          message.includes(E2E_REPLY_TOKEN),
        )
      );
    },
    {
      timeout: TOOL_TURN_TIMEOUT_MS,
      timeoutMsg:
        `${toolCase.toolName}: Tools轮没有结束，latest=${latestState}; ` +
        `assistant=${JSON.stringify(latestAssistantMessages)}`,
    },
  );
}

async function expectToolBlockVisible(toolCase: ToolCrossProductCase) {
  const block = await waitForToolCallBlockByToolName(toolCase.toolName, 30000);
  expect(block.exists).toBe(true);
  expect(block.toolName).toBe(toolCase.toolName);
}

async function expectToolHistoryVisibleOrProviderBacked(
  toolCase: ToolCrossProductCase,
) {
  if (toolCase.historyAssertion !== "providerRequest") {
    await expectToolBlockVisible(toolCase);
  }
}

async function waitForProviderBackedToolHistory(
  toolCase: ToolCrossProductCase,
  marker: string,
) {
  if (!toolCase.providerHistoryMarker) {
    throw new Error(`${toolCase.toolName}: provider history assertion Missing marker`);
  }
  await waitForUpstreamRequest(
    {
      includes: [marker, toolCase.providerHistoryMarker],
      excludes: [COMPACT_REQUEST_SENTINEL, GOAL_OBJECTIVE_PREFIX],
    },
    `${toolCase.toolName}: tool result continuation 没有包含 provider history marker`,
    90000,
  );
}

function compactHistoryMarkers(toolCase: ToolCrossProductCase, marker: string) {
  return [
    COMPACT_REQUEST_SENTINEL,
    marker,
    ...(toolCase.providerHistoryMarker
      ? [toolCase.providerHistoryMarker]
      : []),
  ];
}

function goalHistoryMarkers(
  toolCase: ToolCrossProductCase,
  marker: string,
  objective: string,
) {
  return [
    objective,
    marker,
    ...(toolCase.providerHistoryMarker
      ? [toolCase.providerHistoryMarker]
      : []),
  ];
}

async function assertForkProviderHistory(
  toolCase: ToolCrossProductCase,
  context: { marker: string; runId: string },
) {
  if (!toolCase.providerHistoryMarker) {
    throw new Error(`${toolCase.toolName}: fork provider history assertion Missing marker`);
  }
  const probe = `${FORK_PROBE_PREFIX}_${toolCase.markerName}_${context.runId}`;
  await sendV4Prompt(`${probe}: Reply with exactly "${E2E_REPLY_TOKEN}".`);
  await waitForV4ComposerText(
    "",
    `${toolCase.toolName}: fork history probe 后Input框没有Clear`,
  );
  const request = await waitForUpstreamNetworkCapture(probe);
  expect(request.statusCode).toBe(200);
  assertForkRequestHasToolHistory(request.requestJson, toolCase.toolName);
  expect(JSON.stringify(request.requestJson)).toContain(context.marker);
  await waitForV4AssistantMessageContaining(E2E_REPLY_TOKEN);
  await waitForV4ConversationState(
    (snapshot) => snapshot.state === "idle",
    `${toolCase.toolName}: fork history probe 没有回到 idle`,
    90000,
  );
}

function assertForkRequestHasToolHistory(
  requestJson: unknown,
  toolName: string,
) {
  if (!requestJson || typeof requestJson !== "object") {
    throw new Error(`${toolName}: fork provider Request不Yes JSON object`);
  }
  const messages = (requestJson as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) {
    throw new Error(`${toolName}: fork provider RequestMissing messages`);
  }
  const blocks = messages.flatMap((message) => {
    if (!message || typeof message !== "object") return [];
    const content = (message as { content?: unknown }).content;
    return Array.isArray(content)
      ? content.filter(
          (block): block is Record<string, unknown> =>
            Boolean(block && typeof block === "object"),
        )
      : [];
  });
  const toolUseIds = blocks
    .filter(
      (block) => block.type === "tool_use" && block.name === toolName,
    )
    .map((block) => block.id)
    .filter((id): id is string => typeof id === "string");
  expect(toolUseIds.length).toBeGreaterThan(0);
  expect(
    blocks.some(
      (block) =>
        block.type === "tool_result" &&
        typeof block.tool_use_id === "string" &&
        toolUseIds.includes(block.tool_use_id),
    ),
  ).toBe(true);
}

async function stopIfBusy() {
  const snapshot = await getV4ConversationState();
  if (
    snapshot.state !== "streaming" &&
    snapshot.runtimeStatus !== "streaming" &&
    snapshot.runtimeStatus !== "compacting" &&
    snapshot.activeInputId === null
  ) {
    return;
  }
  await clickV4Stop();
  await waitForV4ConversationState(
    (nextSnapshot) =>
      nextSnapshot.state !== "streaming" &&
      nextSnapshot.runtimeStatus !== "streaming" &&
      nextSnapshot.runtimeStatus !== "compacting",
    "Did not exit streaming after tool cross-product afterEach stop",
    30000,
  );
}
