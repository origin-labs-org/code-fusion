import { clearAppData } from "../../../helpers/desktop-app.js";
import { waitForUpstreamNetworkCapture } from "../../../helpers/upstream-capture.js";
import {
  E2E_REPLY_TOKEN,
  buildReadonlyToolPrompt,
  getChatRootSnapshot,
  prepareConversationE2E,
  sendPrompt,
  waitForAssistantMessageContaining,
  waitForChatState,
  waitForComposerText,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";

describe("Chat area initial send and completed state E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Initial send should create session; sending after completion should proceed to next turn", async function () {
    this.timeout(150000);

    await prepareConversationE2E();

    const runId = Date.now();
    const firstPrompt = buildReadonlyToolPrompt(`E2E_FIRST_SEND_${runId}`);
    await sendPrompt(firstPrompt);
    await waitForComposerText("", "Input box was not cleared after initial send");
    await waitForUserMessageContaining(firstPrompt);
    const firstSnapshot = await waitForChatState(
      (snapshot) => Boolean(snapshot.sessionId || snapshot.taskId),
      "首发后 chat-view 没有回填 session/task id",
      30000,
    );
    expect(firstSnapshot.sessionId).toBeTruthy();
    expect(firstSnapshot.queueCount).toBe(0);
    await waitForUpstreamNetworkCapture(`E2E_FIRST_SEND_${runId}`);
    await waitForAssistantMessageContaining(E2E_REPLY_TOKEN);
    await waitForChatState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      "首轮完成后 chat-view 没有回到 idle",
      90000,
    );

    const secondPrompt =
      `E2E_SECOND_TURN_${runId}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(secondPrompt);
    await waitForComposerText("", "Input box not cleared after second send");
    await waitForUserMessageContaining(secondPrompt);
    await waitForUpstreamNetworkCapture(`E2E_SECOND_TURN_${runId}`);
    await waitForAssistantMessageContaining(E2E_REPLY_TOKEN);

    const finalSnapshot = await getChatRootSnapshot();
    expect(finalSnapshot.sessionId || finalSnapshot.taskId).toBe(
      firstSnapshot.sessionId || firstSnapshot.taskId,
    );
    expect(finalSnapshot.queueCount).toBe(0);
  });
});
