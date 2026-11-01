import { mkdir, rm, writeFile } from "node:fs/promises";
import { clearAppData } from "../helpers/desktop-app.js";
import { resolveE2ERuntimePath } from "../helpers/e2e-runtime-paths.js";
import {
  countUpstreamRequestsContainingAll,
  findFirstUpstreamRequestIndex,
  findLastUpstreamRequestIndex,
  getUpstreamRequestRecordCount,
  waitForUpstreamRequest,
  waitForUpstreamRequestContaining,
} from "../helpers/conversation-session-network.js";
import {
  waitForQueueContaining,
  waitForQueueCount,
} from "../helpers/conversation-session-queue.js";
import { ensureToolCrossProductFullAccessMode } from "../helpers/conversation-session-tool-cross-product.js";
import { expandAssistantHistoriesWithContent } from "../helpers/conversation-session-tool.js";
import {
  E2E_REPLY_TOKEN,
  editFirstV4UserQuery,
  getV4CompactMarkers,
  getV4Messages,
  prepareV4ConversationE2E,
  sendV4Prompt,
  startNewV4Draft,
  type V4CompactMarkerSnapshot,
  waitForV4ComposerText,
  waitForV4ConversationState,
  waitForV4UserMessageContaining,
} from "../helpers/v4-conversation.js";

const COMPACT_REQUEST_SENTINEL = "CRITICAL: Respond with TEXT ONLY";
const ADJACENT_AUTO_COMPACT_MARKER = "E2E_ADJACENT_AUTOCOMPACT";
const AUTO_COMPACT_RUNTIME_ROOT = resolveE2ERuntimePath(
  "conversation-session-compact-auto",
);
const ADJACENT_AUTO_COMPACT_FILE_PATH = resolveE2ERuntimePath(
  "conversation-session-compact-auto",
  "adjacent-autocompact.txt",
);

describe("Session area Auto Compact E2E", () => {
  let runId = 0;

  before(async () => {
    await mkdir(AUTO_COMPACT_RUNTIME_ROOT, { recursive: true });
    await prepareV4ConversationE2E();
    await ensureToolCrossProductFullAccessMode();
    await waitForV4ConversationState(
      (snapshot) => !snapshot.modelSwitchPending,
      "auto compact case did not end pending after switching to full access mode",
      30000,
    );
    runId = Date.now();
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await rm(AUTO_COMPACT_RUNTIME_ROOT, { force: true, recursive: true });
    await clearAppData();
  });

  it("G01: when completed queue=0 and needsCompact, auto compact first, then continue with original plain text upon success", async () => {
    await seedAutoCompactHistory(runId, "G01");
    const seedPrompt = `E2E_AUTO_COMPACT_CONTEXT_SEED_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendV4Prompt(seedPrompt);
    await waitForV4ComposerText("", "Input box not cleared after sending round 1 of auto compact");
    await waitForV4UserMessageContaining(seedPrompt);
    await waitForUpstreamRequestContaining(
      `E2E_AUTO_COMPACT_CONTEXT_SEED_${runId}`,
    );
    await waitForV4ConversationState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      "Round 1 of auto compact did not complete",
      90000,
    );

    const compactRequestsBefore = await countUpstreamRequestsContainingAll([
      COMPACT_REQUEST_SENTINEL,
      "E2E_AUTO_COMPACT",
    ]);
    const modelRequestsBefore = await countUpstreamRequestsContainingAll([]);
    const assistantMessagesBefore = (await getV4Messages("assistant")).length;
    const compactRowIdsBefore = await getV4AutoCompactRowIds();
    const pendingPrompt = `E2E_AUTO_COMPACT_PENDING_TEXT_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendV4Prompt(pendingPrompt);
    await waitForV4ComposerText(
      "",
      "Input box not cleared after sending auto compact pending text",
    );

    await waitForNewV4AutoCompactSuccess(compactRowIdsBefore, 30000);
    await browser.waitUntil(
      async () =>
        (await countUpstreamRequestsContainingAll([
          COMPACT_REQUEST_SENTINEL,
          "E2E_AUTO_COMPACT",
        ])) ===
        compactRequestsBefore + 1,
      {
        timeout: 30000,
        timeoutMsg: "auto compact 基础路径没有按单次请求完成",
      },
    );
    await browser.waitUntil(
      async () =>
        (await countUpstreamRequestsContainingAll([])) ===
        modelRequestsBefore + 2,
      {
        timeout: 90000,
        timeoutMsg:
          "Primary model request for original pending text was not initiated after successful auto compact",
      },
    );
    await waitForAssistantMessageCount(
      assistantMessagesBefore + 1,
      "Original pending plain text was not executed after successful auto compact",
    );
    await waitForV4UserMessageContaining(pendingPrompt);
    await waitForV4ConversationState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      "Did not return to idle after completing auto compact pending text",
      90000,
    );
  });

  it("G02: Auto compact before autoDrain consumes plain text, then proceed with head-of-queue text upon success", async () => {
    await startNewV4Draft();
    await assertAutoCompactBeforeAutoDrainText(runId);
  });

  it("G04: Auto compact before edit rerun, then proceed with edited user query upon success", async () => {
    await startNewV4Draft();
    await assertAutoCompactBeforeEditRerun(runId);
  });

  it("G03: Auto compact before autoDrain consumes /goal, then consume head of queue as goal command upon success", async () => {
    await startNewV4Draft();
    await assertAutoCompactBeforeAutoDrainGoal(runId);
  });

  it("AC05: Retain both V4 success markers during back-to-back auto compactions across mid_turn and next-turn pre_request", async () => {
    await startNewV4Draft();
    await assertAdjacentAutoCompactMarkersRemainStructured(runId);
  });
});

async function assertAdjacentAutoCompactMarkersRemainStructured(runId: number) {
  await seedAutoCompactHistory(runId, "AC05");
  const fileMarker = `${ADJACENT_AUTO_COMPACT_MARKER}_FILE_${runId}`;
  await writeFile(ADJACENT_AUTO_COMPACT_FILE_PATH, `${fileMarker}\n`, "utf-8");

  const existingRowIds = await getV4AutoCompactRowIds();
  const compactRequestsBefore = await countUpstreamRequestsContainingAll([
    COMPACT_REQUEST_SENTINEL,
    ADJACENT_AUTO_COMPACT_MARKER,
  ]);
  const toolPrompt = `${ADJACENT_AUTO_COMPACT_MARKER}_TOOL_${runId}: Read ${ADJACENT_AUTO_COMPACT_FILE_PATH}, then reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
  await sendV4Prompt(toolPrompt);
  await waitForV4ComposerText(
    "",
    "Input box not cleared after sending adjacent auto compact tool turn",
  );
  await waitForV4UserMessageContaining(
    `${ADJACENT_AUTO_COMPACT_MARKER}_TOOL_${runId}`,
  );
  await waitForV4ConversationState(
    (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
    "Adjacent auto compact tool turn did not complete",
    90000,
  );
  await waitForCompactRequestCount(
    compactRequestsBefore + 1,
    "Adjacent auto compact did not trigger first-round mid_turn compact",
    30000,
  );
  const midTurnMarker = await waitForNewV4AutoCompactSuccess(
    existingRowIds,
    30000,
  );

  const rowIdsBeforeFollowup = new Set(existingRowIds);
  expect(midTurnMarker.rowId).not.toBeNull();
  rowIdsBeforeFollowup.add(midTurnMarker.rowId as number);
  const followupPrompt = `${ADJACENT_AUTO_COMPACT_MARKER}_FOLLOWUP_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
  await sendV4Prompt(followupPrompt);
  await waitForV4ComposerText(
    "",
    "Input box not cleared after sending adjacent auto compact follow-up",
  );
  await waitForV4UserMessageContaining(
    `${ADJACENT_AUTO_COMPACT_MARKER}_FOLLOWUP_${runId}`,
  );
  await waitForV4ConversationState(
    (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
    "Adjacent auto compact follow-up turn did not complete",
    90000,
  );
  await waitForCompactRequestCount(
    compactRequestsBefore + 2,
    "Adjacent auto compact did not trigger second-round pre_request compact",
    30000,
  );
  const preRequestMarker = await waitForNewV4AutoCompactSuccess(
    rowIdsBeforeFollowup,
    30000,
  );
  expect(preRequestMarker.rowId).not.toBe(midTurnMarker.rowId);
}

async function assertAutoCompactBeforeAutoDrainText(runId: number) {
  await seedAutoCompactHistory(runId, "G02");
  const requestStartIndex = await getUpstreamRequestStartIndex();
  const runningMarker = `E2E_AUTO_COMPACT_DRAIN_RUNNING_TEXT_${runId}`;
  const queuedMarker = `E2E_AUTO_COMPACT_DRAIN_TEXT_${runId}`;
  const runningPrompt = `${runningMarker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
  const queuedPrompt = `${queuedMarker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;

  await sendV4Prompt(runningPrompt);
  await waitForV4ComposerText(
    "",
    "Input box not cleared after sending first turn in auto compact text drain scenario",
  );
  await waitForV4ConversationState(
    (snapshot) => snapshot.state === "streaming",
    "First turn did not enter streaming in auto compact text drain scenario",
    30000,
  );

  const compactRowIdsBefore = await getV4AutoCompactRowIds();
  await sendV4Prompt(queuedPrompt);
  await waitForV4ComposerText(
    "",
    "Input box not cleared after sending auto compact text drain queue",
  );
  await waitForQueueContaining(queuedMarker);
  const queue = await waitForQueueCount(1);
  expect(queue[0]?.kind).toBe("text");

  await waitForAutoCompactPrefixBeforeAction(
    queuedMarker,
    requestStartIndex,
    compactRowIdsBefore,
  );
  await waitForV4UserMessageContaining(queuedPrompt);
  await waitForV4ConversationState(
    (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
    "Did not clear queue and return to idle after auto compact text drain completed",
    90000,
  );
}

async function assertAutoCompactBeforeAutoDrainGoal(runId: number) {
  await seedAutoCompactHistory(runId, "G03");
  const requestStartIndex = await getUpstreamRequestStartIndex();
  const runningMarker = `E2E_AUTO_COMPACT_DRAIN_RUNNING_GOAL_${runId}`;
  const goalMarker = `E2E_AUTO_COMPACT_DRAIN_GOAL_${runId}`;
  const runningPrompt = `${runningMarker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
  const goalPrompt = `/goal ${goalMarker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;

  await sendV4Prompt(runningPrompt);
  await waitForV4ComposerText(
    "",
    "Input box not cleared after sending first turn in auto compact goal drain scenario",
  );
  await waitForV4ConversationState(
    (snapshot) => snapshot.state === "streaming",
    "First turn did not enter streaming in auto compact goal drain scenario",
    30000,
  );

  const compactRowIdsBefore = await getV4AutoCompactRowIds();
  await sendV4Prompt(goalPrompt);
  await waitForV4ComposerText(
    "",
    "Input box not cleared after sending auto compact goal drain queue",
  );
  await waitForQueueContaining(goalMarker);
  const queue = await waitForQueueCount(1);
  expect(queue[0]?.kind).toBe("goal");

  await waitForAutoCompactPrefixBeforeAction(
    goalMarker,
    requestStartIndex,
    compactRowIdsBefore,
  );
  await waitForV4ConversationState(
    (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
    "Head of goal queue was not consumed and did not return to idle after auto compact",
    90000,
  );
  await waitForV4UserMessageContaining(goalMarker);
}

async function assertAutoCompactBeforeEditRerun(runId: number) {
  const contextMarker = `E2E_AUTO_COMPACT_CONTEXT_BEFORE_EDIT_A_${runId}`;
  const secondContextMarker = `E2E_AUTO_COMPACT_CONTEXT_BEFORE_EDIT_B_${runId}`;
  const seedMarker = `E2E_AUTO_COMPACT_CONTEXT_SEED_EDIT_${runId}`;
  const editMarker = `E2E_AUTO_COMPACT_EDIT_RERUN_${runId}`;
  const contextPrompt = `${contextMarker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
  const secondContextPrompt = `${secondContextMarker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
  const seedPrompt = `${seedMarker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
  const editedPrompt = `${editMarker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;

  await sendV4Prompt(contextPrompt);
  await waitForV4ComposerText(
    "",
    "Input box not cleared after sending auto compact edit context",
  );
  await waitForUpstreamRequestContaining(contextMarker, 30000);
  await waitForV4ConversationState(
    (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
    "auto compact edit context 没有完成",
    90000,
  );

  await sendV4Prompt(secondContextPrompt);
  await waitForV4ComposerText(
    "",
    "Input box not cleared after sending auto compact edit second context",
  );
  await waitForUpstreamRequestContaining(secondContextMarker, 30000);
  await waitForV4ConversationState(
    (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
    "auto compact edit second context 没有完成",
    90000,
  );

  await sendV4Prompt(seedPrompt);
  await waitForV4ComposerText("", "Input box not cleared after sending auto compact edit seed");
  await waitForUpstreamRequestContaining(seedMarker, 30000);
  await waitForV4ConversationState(
    (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
    "auto compact edit seed 没有完成",
    90000,
  );

  const requestStartIndex = await getUpstreamRequestStartIndex();
  const compactRowIdsBefore = await getV4AutoCompactRowIds();
  await editFirstV4UserQuery(editedPrompt);
  await waitForAutoCompactPrefixBeforeAction(
    editMarker,
    requestStartIndex,
    compactRowIdsBefore,
  );
  await waitForV4UserMessageContaining(editMarker);
  await waitForV4ConversationState(
    (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
    "auto compact edit 重跑完成后没有回到 idle",
    90000,
  );
}

async function seedAutoCompactHistory(runId: number, scope: string) {
  const marker = `E2E_AUTO_COMPACT_CONTEXT_SEED_WARMUP_${scope}_${runId}`;
  const prompt = `${marker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
  await sendV4Prompt(prompt);
  await waitForV4ComposerText(
    "",
    `${scope} auto compact warmup 后Input框没有Clear`,
  );
  await waitForUpstreamRequestContaining(marker, 30000);
  await waitForV4ConversationState(
    (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
    `${scope} auto compact warmup 没有Completed`,
    90000,
  );
}

async function getUpstreamRequestStartIndex() {
  return (await getUpstreamRequestRecordCount()) - 1;
}

async function waitForAutoCompactPrefixBeforeAction(
  actionMarker: string,
  requestStartIndex: number,
  compactRowIdsBefore: ReadonlySet<number>,
) {
  const compactQuery = {
    excludes: [actionMarker],
    includes: [COMPACT_REQUEST_SENTINEL],
  };
  const actionQuery = {
    excludes: [COMPACT_REQUEST_SENTINEL],
    includes: [actionMarker],
  };
  await waitForNewV4AutoCompactSuccess(compactRowIdsBefore, 30000);
  await waitForUpstreamRequest(
    actionQuery,
    `auto compact 后没有Continue action=${actionMarker} 的主Request`,
    45000,
    { afterIndex: requestStartIndex },
  );

  const actionIndex = await findFirstUpstreamRequestIndex(actionQuery, {
    afterIndex: requestStartIndex,
  });
  expect(actionIndex).not.toBeNull();
  const compactIndex = await findLastUpstreamRequestIndex(compactQuery, {
    afterIndex: requestStartIndex,
    beforeIndex: actionIndex as number,
  });
  expect(compactIndex).not.toBeNull();
  expect(compactIndex as number).toBeLessThan(actionIndex as number);
}

async function getV4AutoCompactRowIds() {
  await expandAssistantHistoriesWithContent();
  return new Set(
    (await getV4CompactMarkers())
      .filter((marker) => marker.origin === "auto" && marker.rowId !== null)
      .map((marker) => marker.rowId as number),
  );
}

async function waitForNewV4AutoCompactSuccess(
  existingRowIds: ReadonlySet<number>,
  timeout = 90000,
): Promise<V4CompactMarkerSnapshot> {
  let latestMarkers: V4CompactMarkerSnapshot[] = [];
  await browser.waitUntil(
    async () => {
      await expandAssistantHistoriesWithContent();
      latestMarkers = await getV4CompactMarkers();
      return latestMarkers.some(
        (marker) =>
          marker.status === "success" &&
          marker.origin === "auto" &&
          marker.rowId !== null &&
          !existingRowIds.has(marker.rowId),
      );
    },
    {
      timeout,
      timeoutMsg: `没有等到New的 V4 auto/success compact marker, latest=${JSON.stringify(
        latestMarkers,
        null,
        2,
      )}`,
    },
  );

  const marker = latestMarkers.find(
    (candidate) =>
      candidate.status === "success" &&
      candidate.origin === "auto" &&
      candidate.rowId !== null &&
      !existingRowIds.has(candidate.rowId),
  );
  if (!marker) {
    throw new Error("新的 V4 auto/success compact marker 在等待后仍不存在");
  }
  return marker;
}

async function waitForCompactRequestCount(
  expectedCount: number,
  timeoutMsg: string,
  timeout: number,
) {
  await browser.waitUntil(
    async () =>
      (await countUpstreamRequestsContainingAll([
        COMPACT_REQUEST_SENTINEL,
        ADJACENT_AUTO_COMPACT_MARKER,
      ])) === expectedCount,
    {
      timeout,
      timeoutMsg,
    },
  );
}

async function waitForAssistantMessageCount(
  expectedCount: number,
  timeoutMsg: string,
) {
  let latestCount = 0;
  await browser.waitUntil(
    async () => {
      latestCount = (await getV4Messages("assistant")).length;
      return latestCount >= expectedCount;
    },
    {
      timeout: 90000,
      timeoutMsg: `${timeoutMsg}; latestCount=${latestCount}, expected=${expectedCount}`,
    },
  );
}
