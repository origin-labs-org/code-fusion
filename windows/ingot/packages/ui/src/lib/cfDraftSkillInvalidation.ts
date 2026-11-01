import { logger } from "@/logger.js";
import { useCfSessionStore } from "@/store/cfSessionStore.js";

interface DeferredDraftRuntimeChangeParams {
  logScope: string;
  reason: string;
  workspacePath?: string | null;
  workspaceIdentity?: string | null;
}

export async function invalidateDeferredDraftSessionForRuntimeChange(
  params: DeferredDraftRuntimeChangeParams,
): Promise<void> {
  if (!params.workspacePath) {
    return;
  }

  const workspaceIdentity = params.workspaceIdentity?.trim() || undefined;
  const store = useCfSessionStore.getState();
  store.invalidateDraftRuntime(params.workspacePath, workspaceIdentity);
  logger.info(`[${params.logScope}] invalidated draft runtime capabilities`, {
    reason: params.reason,
    workspaceIdentity: workspaceIdentity ?? null,
    workspacePath: params.workspacePath,
  });
}

export async function invalidateDeferredDraftSessionForSkillChange(
  params: Omit<DeferredDraftRuntimeChangeParams, "logScope">,
): Promise<void> {
  await invalidateDeferredDraftSessionForRuntimeChange({ ...params, logScope: "skills" });
}
