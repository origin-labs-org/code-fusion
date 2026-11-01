import { create } from "zustand";

export interface ModelTrajectoryOpenRequest {
  
  requestId: string;
  taskId: string;
  
  workspaceKey: string;
  title?: string | null;
}

interface ModelTrajectoryStoreState {
  pendingRequest: ModelTrajectoryOpenRequest | null;
  requestOpen: (request: Omit<ModelTrajectoryOpenRequest, "requestId">) => void;
  consumeRequest: (requestId: string) => void;
}

declare global {
  interface Window {
    __cfModelTrajectoryStoreE2E?: typeof useModelTrajectoryStore;
  }
}

let requestSeq = 0;

export const useModelTrajectoryStore = create<ModelTrajectoryStoreState>((set) => ({
  pendingRequest: null,
  requestOpen: (request) => {
    requestSeq += 1;
    set({
      pendingRequest: { ...request, requestId: `model-trajectory-open:${requestSeq}` },
    });
  },
  consumeRequest: (requestId) => {
    set((state) =>
      state.pendingRequest?.requestId === requestId ? { pendingRequest: null } : state,
    );
  },
}));

if (typeof window !== "undefined") {
  window.__cfModelTrajectoryStoreE2E = useModelTrajectoryStore;
}
