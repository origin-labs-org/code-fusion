import { useEffect } from "react";
import { useModelTrajectoryStore } from "@/store/modelTrajectoryStore.js";

export function useModelTrajectoryOpenBridge(
  ownWorkspaceKey: string,
  onOpen: (params: { taskId: string; title?: string | null }) => void,
): void {
  useEffect(() => {
    const handlePending = (
      pendingRequest: ReturnType<typeof useModelTrajectoryStore.getState>["pendingRequest"],
    ) => {
      if (!pendingRequest || pendingRequest.workspaceKey !== ownWorkspaceKey) {
        return;
      }
      onOpen({ taskId: pendingRequest.taskId, title: pendingRequest.title });
      useModelTrajectoryStore.getState().consumeRequest(pendingRequest.requestId);
    };

    handlePending(useModelTrajectoryStore.getState().pendingRequest);
    return useModelTrajectoryStore.subscribe((state) => {
      handlePending(state.pendingRequest);
    });
  }, [onOpen, ownWorkspaceKey]);
}
