import type { RemoteWizardStep } from "@/RemoteConnectionWizardChrome.js";

export interface RemoteConnectionDialogSnapshot {
  currentStep: RemoteWizardStep;
  loading: boolean;
  connectedSessionId: string | null;
}

type RemoteConnectionCompletionStatus = "success" | "error";

interface RemoteConnectionCompletionDialogState {
  open: boolean;
  step: RemoteWizardStep;
}

interface RemoteConnectionDirectoryFailureState {
  connectedSessionId: string | null;
  step: RemoteWizardStep;
}

export function isRemoteConnectionFlowActive(
  snapshot: RemoteConnectionDialogSnapshot,
): boolean {
  return snapshot.loading || Boolean(snapshot.connectedSessionId);
}

export function getRemoteConnectionCompletionDialogState(
  status: RemoteConnectionCompletionStatus,
  options?: { directToDirectory?: boolean },
): RemoteConnectionCompletionDialogState {
  return {
    open: true,
    step:
      status === "success" && options?.directToDirectory
        ? "directory"
        : "connecting",
  };
}

export function getRemoteConnectionDirectoryFailureState(params: {
  connectedSessionId: string;
  sessionStillRegistered: boolean;
}): RemoteConnectionDirectoryFailureState {
  if (params.sessionStillRegistered) {
    return {
      connectedSessionId: params.connectedSessionId,
      step: "directory",
    };
  }

  return {
    connectedSessionId: null,
    step: "settings",
  };
}
