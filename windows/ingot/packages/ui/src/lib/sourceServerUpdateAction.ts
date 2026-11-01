import { SOURCE_SERVER_UPDATE_RUNNING_TASKS_ERROR_CODE } from "@origin-ai/cf-shared";
import type { SourceServerManagementSnapshot, SourceServerUpdateTarget } from "@origin-ai/cf-shared";
import type { ISourceServerManagementService } from "@origin-ai/cf-services";

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

export async function runSourceServerUpdate(options: {
  management: ISourceServerManagementService;
  profileId: string;
  expectedTarget?: SourceServerUpdateTarget;
  confirmForce: () => Promise<boolean>;
}): Promise<SourceServerManagementSnapshot | null> {
  try {
    return await options.management.updateSource({
      profileId: options.profileId,
      ...(options.expectedTarget ? { expectedTarget: options.expectedTarget } : {}),
      force: false,
    });
  } catch (error) {
    if (getErrorCode(error) !== SOURCE_SERVER_UPDATE_RUNNING_TASKS_ERROR_CODE) {
      throw error;
    }
    if (!(await options.confirmForce())) return null;
    return await options.management.updateSource({
      profileId: options.profileId,
      ...(options.expectedTarget ? { expectedTarget: options.expectedTarget } : {}),
      force: true,
    });
  }
}

export async function getSourceServerForceUpdateDescription(
  management: ISourceServerManagementService,
  profileId: string,
  formatMessage: (id: string) => string,
): Promise<string> {
  const snapshot = await management.getSnapshot();
  const tasks = snapshot.states.find((state) => state.profileId === profileId)?.runningTasks;
  return (
    formatMessage("settings.source.forceUpdateDescription") +
    "\n\n" +
    (tasks?.length
      ? tasks.map((task) => `${task.sessionId} — ${task.workspacePath}`).join("\n")
      : formatMessage("remote.runningTasksUnavailable"))
  );
}
