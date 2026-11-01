import type { McpServerConfig } from "@origin-ai/cf-contracts";
import type { CfProtocolMcpServer } from "@origin-ai/cf-shared";

export function protocolMcpServersToRuntimeMcpConfig(
  servers: CfProtocolMcpServer[] | undefined,
): { enabled: true; servers: Record<string, McpServerConfig> } | undefined {
  if (!servers || servers.length === 0) {
    return undefined;
  }

  const runtimeServers: Record<string, McpServerConfig> = {};
  for (const server of servers) {
    if ("command" in server) {
      runtimeServers[server.name] = {
        type: "stdio",
        command: server.command,
        args: server.args,
        env: Object.fromEntries(server.env.map(({ name, value }) => [name, value])),
        ...(server.alwaysLoad !== undefined ? { alwaysLoad: server.alwaysLoad } : {}),
        ...(server.timeoutMs !== undefined ? { timeoutMs: server.timeoutMs } : {}),
        ...(server.isolation !== undefined ? { isolation: server.isolation } : {}),
        ...(server.protocolVersion !== undefined
          ? { protocolVersion: server.protocolVersion }
          : {}),
      };
      continue;
    }
    runtimeServers[server.name] = {
      type: server.type,
      url: server.url,
      headers: Object.fromEntries(server.headers.map(({ name, value }) => [name, value])),
      ...(server.oauth !== undefined ? { oauth: server.oauth } : {}),
      ...(server.alwaysLoad !== undefined ? { alwaysLoad: server.alwaysLoad } : {}),
      ...(server.timeoutMs !== undefined ? { timeoutMs: server.timeoutMs } : {}),
      ...(server.isolation !== undefined ? { isolation: server.isolation } : {}),
      ...(server.protocolVersion !== undefined ? { protocolVersion: server.protocolVersion } : {}),
    };
  }

  return { enabled: true, servers: runtimeServers };
}
