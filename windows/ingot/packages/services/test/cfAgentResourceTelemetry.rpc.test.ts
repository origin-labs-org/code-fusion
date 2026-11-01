import { ChannelClient, ChannelServer, createQueuePair, Emitter, ProxyChannel } from "@origin-ai/cf-rpc";
import type { AgentLaneResourceSample } from "@origin-ai/cf-shared";
import { describe, expect, it } from "vitest";
import { ICfAgentService } from "#src/cf-agent/cfAgent.js";

describe("CodeFusion Agent resource telemetry RPC", () => {
  it("uses an explicit dynamic event across remote RPC without conversation state", async () => {
    const emitter = new Emitter<AgentLaneResourceSample>();
    const [serverProtocol, clientProtocol] = createQueuePair();
    const server = new ChannelServer(serverProtocol, "test");
    const client = new ChannelClient(clientProtocol);
    server.registerChannel(
      ICfAgentService.channelName,
      ProxyChannel.fromService({
        onDynamicProcessResourceSample() {
          return emitter.event;
        },
      }),
    );
    const service = ProxyChannel.toService<ICfAgentService>(
      client.getChannel(ICfAgentService.channelName),
    );
    const sample: AgentLaneResourceSample = {
      arch: "x64",
      cpuCores: 2,
      cpuPercent: 25,
      heapUsedKb: 40_000,
      instanceToken: "9f2c4a1b7d0e5638",
      intervalMs: 60_000,
      lane: "chat",
      logicalCpuCount: 8,
      platform: "linux",
      rssKb: 128_000,
      totalMemoryGb: 32,
      uptimeMinutes: 7,
    };

    try {
      const received = new Promise<AgentLaneResourceSample>((resolve) => {
        service.onDynamicProcessResourceSample()(resolve);
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      emitter.fire(sample);

      await expect(received).resolves.toEqual(sample);
    } finally {
      client.dispose();
      server.dispose();
      emitter.dispose();
    }
  });
});
