import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  waitForUpstreamNetworkCapture,
  waitForUpstreamNetworkRequestStarted,
} from "../../../helpers/upstream-capture.js";
import { ensureToolCrossProductFullAccessMode } from "../../../helpers/conversation-session-tool-cross-product.js";
import {
  E2E_REPLY_TOKEN,
  clickChatStop,
  prepareConversationE2E,
  sendPrompt,
  waitForChatState,
  waitForComposerText,
  waitForToolCallBlockByToolCallId,
} from "../../../helpers/conversation-session.js";

describe("Conversation area Stop Empty Queue E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("After stop, queue=0 should exit running, and subsequent plain text should start next round immediately", async function () {
    this.timeout(150000);

    await prepareConversationE2E();

    const runId = Date.now();
    const firstPrompt = `E2E_SLOW_STREAM E2E_STOP_EMPTY_RUNNING_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(firstPrompt);
    await waitForComposerText("", "Input box was not cleared after sending first round with empty queue stop");
    await waitForChatState(
      (snapshot) => snapshot.state === "streaming" && snapshot.queueCount === 0,
      "First round with empty queue stop did not enter streaming",
      30000,
    );
    await waitForUpstreamNetworkRequestStarted(`E2E_STOP_EMPTY_RUNNING_${runId}`);

    await clickChatStop();
    await waitForChatState(
      (snapshot) =>
        snapshot.state !== "streaming" &&
        snapshot.queueCount === 0 &&
        snapshot.runtimeStatus === "completed" &&
        !snapshot.stopRequested,
      "空队列 stop 后没有退出 running completed 态",
      30000,
    );

    const nextPrompt = `E2E_STOP_EMPTY_NEXT_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(nextPrompt);
    await waitForComposerText("", "Input box was not cleared upon next round send after empty queue stop");
    await waitForUpstreamNetworkCapture(`E2E_STOP_EMPTY_NEXT_${runId}`);
    await waitForChatState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      "Next round did not complete and maintain queue=0 after empty queue stop",
      90000,
    );
  });

  it("Stopping during tool call execution results in queue=0, after which plain text should start next round immediately", async function () {
    this.timeout(150000);

    await prepareConversationE2E();
    await ensureToolCrossProductFullAccessMode();

    const runId = Date.now();
    const toolPrompt = `E2E_STOP_EMPTY_TOOLCALL_RUNNING_${runId}: Start a long Bash tool call, then wait.`;
    await sendPrompt(toolPrompt);
    await waitForComposerText("", "Input box was not cleared after sending first round with toolcall stop");
    await waitForUpstreamNetworkRequestStarted(`E2E_STOP_EMPTY_TOOLCALL_RUNNING_${runId}`);
    await waitForToolCallBlockByToolCallId("toolu_e2e_stop_empty_toolcall_bash", 30000);
    await waitForChatState(
      (snapshot) => snapshot.state === "streaming" && snapshot.queueCount === 0,
      "First round with toolcall stop did not maintain streaming and queue=0",
      30000,
    );

    await clickChatStop();
    await waitForChatState(
      (snapshot) =>
        snapshot.state !== "streaming" &&
        snapshot.queueCount === 0 &&
        snapshot.runtimeStatus === "completed" &&
        !snapshot.stopRequested,
      "toolcall stop 后没有退出 running completed 态",
      30000,
    );

    const nextPrompt = `E2E_STOP_EMPTY_TOOLCALL_NEXT_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(nextPrompt);
    await waitForComposerText("", "Input box was not cleared upon next round send after toolcall stop");
    await waitForUpstreamNetworkCapture(`E2E_STOP_EMPTY_TOOLCALL_NEXT_${runId}`);
    await waitForChatState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      "Next round did not complete and maintain queue=0 after toolcall stop",
      90000,
    );
  });
});
