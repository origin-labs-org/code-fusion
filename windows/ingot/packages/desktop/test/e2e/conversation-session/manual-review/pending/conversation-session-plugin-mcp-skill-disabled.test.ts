import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  E2E_REPLY_TOKEN,
  getToolCallBlockByToolName,
  prepareConversationE2E,
  sendPrompt,
  startNewTask,
  waitForAssistantMessageContaining,
  waitForChatState,
  waitForComposerText,
  waitForUpstreamRequestContaining,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";
import {
  PLUGIN_MCP_TOOL_NAME,
  captureArtifactAdvertisesToolName,
  findUpstreamRequestContaining,
} from "../../../helpers/plugin-mcp-skill.js";

const DISABLED_TIMEOUT_MS = 180000;

describe("Chat area Plugin MCP Skill lifecycle E2E / Installed but disabled", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("When plugin is installed but disabled: request tools array does not contain mcp__plugin_e2e-plugin-mcp-ping_ping__ping, and chat does not show this tool block", async function () {
    this.timeout(DISABLED_TIMEOUT_MS);

    await prepareConversationE2E();
    await startNewTask();

    const runId = Date.now();
    const marker = `E2E_PLUGIN_MCP_PING_DISABLED_${runId}`;
    const prompt = `${marker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;

    await sendPrompt(prompt);
    await waitForComposerText("", "Input box was not cleared after initial send when disabled");
    await waitForUserMessageContaining(prompt);
    await waitForUpstreamRequestContaining(marker, 60000);

    const requestRecord = await findUpstreamRequestContaining(marker, 60000);
    expect(requestRecord).not.toBeNull();
    if (!requestRecord) return;
    expect(
      captureArtifactAdvertisesToolName(
        requestRecord.requestJson,
        PLUGIN_MCP_TOOL_NAME,
      ),
    ).toBe(false);

    const block = await getToolCallBlockByToolName(PLUGIN_MCP_TOOL_NAME);
    expect(block).toBeNull();

    await waitForAssistantMessageContaining(E2E_REPLY_TOKEN);
    await waitForChatState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      "Chat did not return to idle upon completion when disabled",
      90000,
    );
  });
});
