import { mkdir, rm, writeFile } from "node:fs/promises";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  resolveE2ERuntimePath,
  resolveE2EToolPath,
} from "../../../helpers/e2e-runtime-paths.js";
import {
  E2E_REPLY_TOKEN,
  openAssistantHistoryForAssistantContaining,
  prepareConversationE2E,
  sendPrompt,
  waitForAssistantMessageContaining,
  waitForChatState,
  waitForComposerText,
  waitForToolCallBlockByToolName,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";

const TOOL_ACTION_RUNTIME_ROOT = resolveE2ERuntimePath(
  "conversation-session-tool-actions",
);
const TOOL_FILE_PATH = resolveE2EToolPath(
  "conversation-session-tool-actions",
  "tool-action-guard.txt",
);

describe("会话区 Tool Action Guard E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await rm(TOOL_ACTION_RUNTIME_ROOT, { force: true, recursive: true });
    await clearAppData();
  });

  it("tool call block should not provide edit or fork entry points", async function () {
    this.timeout(160000);

    const runId = Date.now();
    await mkdir(TOOL_ACTION_RUNTIME_ROOT, { recursive: true });
    await writeFile(
      TOOL_FILE_PATH,
      `E2E_TOOL_FILE_CONTENT_${runId}\n`,
      "utf-8",
    );

    await prepareConversationE2E();

    const prompt =
      `E2E_TOOL_ACTION_GUARD_${runId}: Read ${TOOL_FILE_PATH}, then reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(prompt);
    await waitForComposerText("", "Input box was not cleared after initial send in tool action guard");
    await waitForUserMessageContaining(`E2E_TOOL_ACTION_GUARD_${runId}`);

    await waitForAssistantMessageContaining(E2E_REPLY_TOKEN);
    await waitForChatState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      "tool action guard 完成后会话没有回到 idle",
      90000,
    );
    await openAssistantHistoryForAssistantContaining(E2E_REPLY_TOKEN);

    const toolBlock = await waitForToolCallBlockByToolName("Read");
    expect(toolBlock.exists).toBe(true);
    expect(toolBlock.toolCallId).toBeTruthy();
    expect(toolBlock.toolName).toBe("Read");
    expect(toolBlock.status).toBe("completed");
    expect(toolBlock.hasEditAction).toBe(false);
    expect(toolBlock.hasForkAction).toBe(false);
  });
});
