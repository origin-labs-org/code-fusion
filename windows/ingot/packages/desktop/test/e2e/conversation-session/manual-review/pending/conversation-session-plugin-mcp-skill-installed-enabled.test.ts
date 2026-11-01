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
  ensureToolCrossProductFullAccessMode,
  respondToToolCrossProductBlockers,
} from "../../../helpers/conversation-session-tool-cross-product.js";
import {
  PLUGIN_MCP_TOOL_NAME,
  captureArtifactAdvertisesToolName,
  findUpstreamRequestContaining,
} from "../../../helpers/plugin-mcp-skill.js";

const INSTALLED_ENABLED_TIMEOUT_MS = 180000;

describe("Chat area Plugin MCP Skill lifecycle E2E / Installed and enabled", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("When plugin is installed and enabled: requested tools array contains mcp__plugin_e2e-plugin-mcp-ping_ping__ping, and corresponding tool-call block appears in chat", async function () {
    this.timeout(INSTALLED_ENABLED_TIMEOUT_MS);

    await prepareConversationE2E();
    await ensureToolCrossProductFullAccessMode();
    await startNewTask();

    const runId = Date.now();
    const marker = `E2E_PLUGIN_MCP_PING_INSTALLED_ENABLED_${runId}`;
    const prompt = `${marker}: Call the ${PLUGIN_MCP_TOOL_NAME} tool exactly once with message "${marker}", then reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;

    await sendPrompt(prompt);
    await waitForComposerText("", "Installed & enabled: Input box was not cleared after initial send");
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
    ).toBe(true);

    let block = await getToolCallBlockByToolName(PLUGIN_MCP_TOOL_NAME);
    const deadline = Date.now() + 60000;
    while (!block && Date.now() < deadline) {
      await respondToToolCrossProductBlockers();
      block = await getToolCallBlockByToolName(PLUGIN_MCP_TOOL_NAME);
      if (!block) {
        await browser.pause(500);
      }
    }
    expect(block).not.toBeNull();
    if (!block) return;
    expect(block.exists).toBe(true);
    expect(block.toolName).toBe(PLUGIN_MCP_TOOL_NAME);

    await waitForAssistantMessageContaining(E2E_REPLY_TOKEN);
    await waitForChatState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      "Installed & enabled: Session did not return to idle after completion",
      90000,
    );
  });
});
