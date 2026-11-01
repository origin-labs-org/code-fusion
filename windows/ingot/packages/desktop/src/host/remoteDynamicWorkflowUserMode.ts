import type { DynamicWorkflowMode, RemoteTarget } from "@origin-ai/cf-shared";
import type { ICfAgentService } from "@origin-ai/cf-services";

export async function pushDynamicWorkflowUserModeToRemoteHosts(
  connections: ReadonlyArray<{
    target: RemoteTarget;
    cfAgentService: Pick<ICfAgentService, "syncDynamicWorkflowUserMode">;
  }>,
  mode: DynamicWorkflowMode | undefined,
  onError: (error: unknown) => void,
): Promise<void> {
  await Promise.all(
    connections
      .filter((connection) => connection.target.kind !== "server")
      .map(async (connection) => {
        try {
          await connection.cfAgentService.syncDynamicWorkflowUserMode(mode ? { mode } : {});
        } catch (error) {
          onError(error);
        }
      }),
  );
}
