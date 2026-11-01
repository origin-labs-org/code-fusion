import type { CfSessionStateSnapshot } from "@origin-ai/cf-shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { repairImportedClaudeSessionSnapshot } from "#src/session/claude-native/importedClaudeHistoryRepair.js";
import type { ICfAgentService } from "#src/cf-agent/cfAgent.js";
import type {
  CfSessionReadParams,
  CfSessionResumeParams,
} from "#src/cf-session/cfSession.js";

const logger = createServiceLogger("cf-session-service");

export async function repairEmptyImportedClaudeSessionSnapshot(params: {
  agentService: ICfAgentService;
  snapshot: CfSessionStateSnapshot;
  target: CfSessionResumeParams | CfSessionReadParams;
}): Promise<CfSessionStateSnapshot> {
  const repaired = await repairImportedClaudeSessionSnapshot({
    snapshot: params.snapshot,
    target: {
      workspacePath: params.target.workspacePath,
      workspaceIdentity: params.target.workspaceIdentity,
      taskId: params.target.sessionId,
      ...("mcpServers" in params.target && params.target.mcpServers
        ? { mcpServers: params.target.mcpServers }
        : {}),
    },
    createSession: (input) => params.agentService.createSession(input),
    onRepair: (history) => {
      logger.warn(
        undefined,
        `[cf-session-service] Claude 导入 session 历史异常，按 ${history.source} 回填 taskId=${params.target.sessionId}`,
      );
    },
  });
  return repaired ?? params.snapshot;
}
