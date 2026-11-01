import { isAuxiliarySessionKind } from "@origin-ai/cf-shared";
import { resolveWorkspaceKey } from "@origin-ai/cf-shared";
import type { SubagentIndexRepair } from "#src/task-facts/contract.js";

const IDENTITY_QUERY_BATCH_SIZE = 64;

export async function repairSubagentTaskIndex(params: SubagentIndexRepair): Promise<void> {
  const { target, taskIndexRepo, agentService, isCurrent } = params;
  const rows = await taskIndexRepo.listTaskMetas(target);
  const ids = rows
    .filter((row) => !params.visibleSessionIds.has(row.taskId))
    .map((row) => row.taskId);
  for (let offset = 0; offset < ids.length; offset += IDENTITY_QUERY_BATCH_SIZE) {
    if (!isCurrent()) return;
    const batch = ids.slice(offset, offset + IDENTITY_QUERY_BATCH_SIZE);
    const sessions = await agentService.listSessions({
      ...target,
      sessionIds: batch,
      runtimePolicy: "existing-only",
    });
    for (const session of sessions) {
      if (!isCurrent()) return;
      if (
        !isAuxiliarySessionKind(session.sessionKind) ||
        !batch.includes(session.sessionId) ||
        resolveWorkspaceKey(session.workspace) !== resolveWorkspaceKey(target)
      )
        continue;
      await taskIndexRepo.removeSubagentIndexRow({
        ...target,
        taskId: session.sessionId,
      });
      if (isCurrent()) params.onRemoved();
    }
  }
}
