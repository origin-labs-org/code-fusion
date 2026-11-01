import { existsSync } from "node:fs";
import { normalize } from "node:path";
import type { CfAgentMcpServer } from "@origin-ai/cf-shared";

function normalizePathForCompare(value: string): string {
  const normalized = normalize(value.trim()).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isFilesystemServer(
  server: CfAgentMcpServer,
): server is Extract<CfAgentMcpServer, { command: string }> {
  return (
    "command" in server &&
    server.name === "filesystem" &&
    server.args.some((arg) => arg.includes("@modelcontextprotocol/server-filesystem"))
  );
}

export function appendWorkspaceToFilesystemMcpServers(
  mcpServers: CfAgentMcpServer[] | undefined,
  workspacePath: string,
): CfAgentMcpServer[] | undefined {
  if (!mcpServers || mcpServers.length === 0) {
    return mcpServers;
  }

  const trimmedWorkspacePath = workspacePath.trim();
  if (!trimmedWorkspacePath || !existsSync(trimmedWorkspacePath)) {
    return mcpServers;
  }

  let changed = false;
  const workspaceKey = normalizePathForCompare(trimmedWorkspacePath);
  const nextServers = mcpServers.map((server) => {
    if (!isFilesystemServer(server)) {
      return server;
    }

    const hasWorkspace = server.args.some((arg) => normalizePathForCompare(arg) === workspaceKey);
    if (hasWorkspace) {
      return server;
    }

    changed = true;
    return {
      ...server,
      args: [...server.args, trimmedWorkspacePath],
    };
  });

  return changed ? nextServers : mcpServers;
}
