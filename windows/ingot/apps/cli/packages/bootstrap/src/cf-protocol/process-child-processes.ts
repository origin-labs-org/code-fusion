import type { McpTrackedProcess } from "@origin-ai/cf-adapters";
import type { CfProcessChildProcessesResult } from "@origin-ai/cf-shared";
import { resolveOfficialPluginNameByHostMcpServerName } from "../app/official-plugin-definitions.js";

export function listChildProcesses(
  tracked: readonly McpTrackedProcess[],
): CfProcessChildProcessesResult {
  return {
    processes: tracked.map((process) => {
      const pluginName =
        process.pluginName ??
        (process.mcpSource === "builtin"
          ? resolveOfficialPluginNameByHostMcpServerName(process.serverName)
          : undefined);
      return {
        pid: process.pid,
        serverName: process.serverName,
        mcpSource: process.mcpSource,
        ...(pluginName ? { pluginName } : {}),
      };
    }),
  };
}
