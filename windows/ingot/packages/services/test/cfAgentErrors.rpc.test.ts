import { ChannelClient, ChannelServer, createQueuePair, ProxyChannel } from "@origin-ai/cf-rpc";
import { describe, expect, it } from "vitest";
import { ICfAgentService } from "#src/cf-agent/cfAgent.js";
import {
  CF_AGENT_MCP_STATUS_MODE_UNSUPPORTED_ERROR_CODE,
  CfAgentMcpStatusModeUnsupportedError,
} from "#src/cf-agent/cfAgentErrors.js";

describe("CodeFusion Agent RPC errors", () => {
  it("preserves the MCP status-only unsupported code across ChannelClient RPC", async () => {
    const [serverProtocol, clientProtocol] = createQueuePair();
    const server = new ChannelServer(serverProtocol, "test");
    const client = new ChannelClient(clientProtocol);
    server.registerChannel(
      ICfAgentService.channelName,
      ProxyChannel.fromService({
        async listMcpServerStatuses() {
          throw new CfAgentMcpStatusModeUnsupportedError();
        },
      }),
    );
    const service = ProxyChannel.toService<ICfAgentService>(
      client.getChannel(ICfAgentService.channelName),
    );

    try {
      await expect(
        service.listMcpServerStatuses({
          mcpServers: [],
          mode: "status",
          workspacePath: "/tmp/workspace",
        }),
      ).rejects.toMatchObject({
        code: CF_AGENT_MCP_STATUS_MODE_UNSUPPORTED_ERROR_CODE,
        name: "CfAgentMcpStatusModeUnsupportedError",
      });
    } finally {
      client.dispose();
      server.dispose();
    }
  });
});
