import {
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  clickTestIdByDom,
  readSettings,
  waitForWorkspaceApp,
} from "../../../helpers/desktop-app.js";
import {
  E2E_REPLY_TOKEN,
  assertVisibleUserMessagesNotContaining,
  buildReadonlyToolPrompt,
  clickChatStop,
  countUpstreamRequestsContaining,
  getChatRootSnapshot,
  getQueueItems,
  listToolCallBlocks,
  prepareConversationE2E,
  sendPrompt,
  startNewTask,
  waitForChatState,
  waitForComposerText,
  waitForQueueContaining,
  waitForQueueOrderContaining,
  waitForToastContaining,
} from "../../../helpers/conversation-session.js";
import { sel } from "../../../helpers/selectors.js";

const TEST_TIMEOUT_MS = 120000;
const COMPACT_REQUEST_SENTINEL = "CRITICAL: Respond with TEXT ONLY";
const COMPACT_QUEUED_TOAST_TEXTS = [
  "Compaction queued and will run in order.",
  "Queued. Context will be compacted sequentially.",
];

describe("会话区 Turn Steering E2E", () => {
  before(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await prepareConversationE2E();
    await ensureQueueInteractionBehavior();
  });

  afterEach(async () => {
    await stopIfBusy();
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Sending plain text during first-turn tool call enters future queue and preserves tool block", async function () {
    this.timeout(TEST_TIMEOUT_MS);

    await startNewTask();
    const runId = Date.now();
    const basePrompt = buildReadonlyToolPrompt(`E2E_TURN_STEER_TOOL_TEXT_${runId}`);
    const guidedMarker = `E2E_TURN_STEER_TEXT_AFTER_TOOL_${runId}`;
    const guidedPrompt = `E2E_SLOW_STREAM ${guidedMarker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;

    await sendPrompt(basePrompt);
    await waitForComposerText("", "turn steer: input box was not cleared after first-turn tool prompt");
    await waitForChatState(
      (snapshot) => snapshot.state === "streaming",
      "turn steer: 首轮工具 prompt 没有进入 streaming",
      30000,
    );
    await waitForToolBlock();

    await sendPrompt(guidedPrompt);
    await waitForComposerText("", "turn steer: input box was not cleared after normal follow-up input");

    const queue = await waitForQueueItemContaining(guidedMarker);
    expect(queue.kind).toBe("text");
    expect(await listToolCallBlocks()).not.toHaveLength(0);
  });

  it("Sending /goal while first turn is running enters future queue", async function () {
    this.timeout(TEST_TIMEOUT_MS);

    await startNewTask();
    const runId = Date.now();
    const basePrompt = `E2E_SLOW_STREAM E2E_TURN_STEER_GOAL_BASE_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    const goalPrompt = `/goal E2E_SLOW_STREAM E2E_TURN_STEER_GOAL_${runId}: 观察CurrentSession，不修Modify file。`;

    await sendPrompt(basePrompt);
    await waitForComposerText("", "turn steer: input box was not cleared after goal base prompt");
    await waitForChatState(
      (snapshot) => snapshot.state === "streaming",
      "turn steer: goal base prompt 没有进入 streaming",
      30000,
    );

    await sendPrompt(goalPrompt);
    await waitForComposerText("", "turn steer: input box was not cleared after running /goal");

    const queue = await waitForQueueItemContaining(`E2E_TURN_STEER_GOAL_${runId}`);
    expect(queue.kind).toBe("goal");
  });

  it("Interleaved text, /goal, and /compact while first turn is running are enqueued via unified FIFO", async function () {
    this.timeout(TEST_TIMEOUT_MS);

    await startNewTask();
    const runId = Date.now();
    const basePrompt = `E2E_SLOW_STREAM E2E_TURN_STEER_MIXED_BASE_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    const textPrompt = `E2E_SLOW_STREAM E2E_TURN_STEER_MIXED_TEXT_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    const goalPrompt = `/goal E2E_SLOW_STREAM E2E_TURN_STEER_MIXED_GOAL_${runId}: 观察CurrentSession，不修Modify file。`;

    await sendPrompt(basePrompt);
    await waitForComposerText("", "turn steer: mixed base prompt did not enter streaming");
    await waitForChatState(
      (snapshot) => snapshot.state === "streaming",
      "turn steer: mixed base prompt 没有进入 streaming",
      30000,
    );

    await sendPrompt(textPrompt);
    await waitForComposerText("", "turn steer: input box was not cleared after mixed text");
    let queue = await waitForQueueOrderContaining([`E2E_TURN_STEER_MIXED_TEXT_${runId}`]);
    expect(queue.map((item) => item.kind)).toEqual(["text"]);

    await sendPrompt(goalPrompt);
    await waitForComposerText("", "turn steer: input box was not cleared after mixed /goal");
    queue = await waitForQueueOrderContaining([
      `E2E_TURN_STEER_MIXED_TEXT_${runId}`,
      `E2E_TURN_STEER_MIXED_GOAL_${runId}`,
    ]);
    expect(queue.map((item) => item.kind)).toEqual(["text", "goal"]);

    const compactRequestsBefore = await countUpstreamRequestsContaining(COMPACT_REQUEST_SENTINEL);
    await sendPrompt("/compact");
    await waitForComposerText("", "turn steer: input box was not cleared after mixed /compact");
    await waitForToastContaining(
      COMPACT_QUEUED_TOAST_TEXTS,
      "turn steer: queued toast did not pop up for running /compact",
    );
    queue = await waitForQueueOrderContaining([
      `E2E_TURN_STEER_MIXED_TEXT_${runId}`,
      `E2E_TURN_STEER_MIXED_GOAL_${runId}`,
      "/compact",
    ]);
    expect(queue.map((item) => item.kind)).toEqual(["text", "goal", "compact"]);
    await assertVisibleUserMessagesNotContaining("/compact");
    expect(await countUpstreamRequestsContaining(COMPACT_REQUEST_SENTINEL)).toBe(
      compactRequestsBefore,
    );
  });
});

async function waitForToolBlock() {
  await browser.waitUntil(async () => (await listToolCallBlocks()).length > 0, {
    timeout: 30000,
    timeoutMsg: "turn steer: tool block not observed",
  });
}

async function ensureQueueInteractionBehavior() {
  if ((await readSettings()).cfInteractionBehavior === "queue") {
    return;
  }

  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
    timeout: 15000,
    timeoutMsg: "turn steer: settings entry button not found",
  });
  await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout: 15000 });
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "general"), {
    timeout: 15000,
    timeoutMsg: "turn steer: General section entry did not appear on settings page",
  });

  await clickInteractionBehaviorSelect();
  await clickInteractionBehaviorQueueOption();

  await browser.waitUntil(async () => (await readSettings()).cfInteractionBehavior === "queue", {
    timeout: 15000,
    timeoutMsg: "turn steer: interaction behavior was not saved as queue",
  });
  await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
    timeout: 15000,
    timeoutMsg: "turn steer: back button did not appear on settings page",
  });
  await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30000);
}

async function clickInteractionBehaviorSelect() {
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const triggers = Array.from(document.querySelectorAll<HTMLElement>('[role="combobox"]'));
        const trigger = triggers.find((element) =>
          ["引导", "Guide", "队列", "Queue"].some((label) =>
            (element.innerText || element.textContent || "").includes(label),
          ),
        );
        if (!trigger) {
          return false;
        }
        trigger.scrollIntoView({ block: "center", inline: "nearest" });
        trigger.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            buttons: 1,
            cancelable: true,
            pointerId: 1,
            pointerType: "mouse",
          }),
        );
        trigger.click();
        return true;
      }),
    {
      timeout: 15000,
      timeoutMsg: "turn steer: interaction behavior Select not found",
    },
  );
}

async function clickInteractionBehaviorQueueOption() {
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const options = Array.from(
          document.querySelectorAll<HTMLElement>('[role="option"], [data-radix-collection-item]'),
        );
        const option = options.find((element) =>
          ["队列", "Queue"].includes((element.innerText || element.textContent || "").trim()),
        );
        if (!option) {
          return false;
        }
        option.scrollIntoView({ block: "center", inline: "nearest" });
        option.click();
        return true;
      }),
    {
      timeout: 15000,
      timeoutMsg: "turn steer: interaction behavior queue option not found",
    },
  );
}

async function waitForQueueItemContaining(text: string) {
  await waitForQueueContaining(text);
  const queue = await getQueueItems();
  const item = queue.find((candidate) => candidate.content.includes(text));
  if (!item) {
    throw new Error(`turn steer: QueueWaiting后仍找不到 ${text}; latest=${JSON.stringify(queue)}`);
  }
  return item;
}

async function stopIfBusy() {
  const snapshot = await getChatRootSnapshot().catch(() => null);
  if (snapshot?.state !== "streaming") {
    return;
  }
  await clickChatStop().catch(() => undefined);
  await waitForChatState(
    (candidate) => candidate.state !== "streaming",
    "turn steer cleanup phase did not exit streaming",
    30000,
  ).catch(() => undefined);
  await getQueueItems().catch(() => []);
}
