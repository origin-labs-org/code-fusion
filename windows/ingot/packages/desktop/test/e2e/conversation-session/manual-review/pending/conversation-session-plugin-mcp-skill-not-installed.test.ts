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

const NOT_INSTALLED_TIMEOUT_MS = 180000;

describe("Chat Area Plugin MCP Skill Lifecycle E2E / Not-Installed Baseline", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("When plugin is not installed: requested tools array excludes mcp__plugin_e2e-plugin-mcp-ping_ping__ping, and tool block does not appear in chat", async function () {
    this.timeout(NOT_INSTALLED_TIMEOUT_MS);

    await prepareConversationE2E();
    await startNewTask();

    const runId = Date.now();
    const marker = `E2E_PLUGIN_MCP_PING_NOT_INSTALLED_${runId}`;
    const prompt = `${marker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;

    await sendPrompt(prompt);
    await waitForComposerText("", "Not-installed baseline: Input box was not cleared after initial send");
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
      "Not-installed baseline: Session did not return to idle after completion",
      90000,
    );
  });
});
