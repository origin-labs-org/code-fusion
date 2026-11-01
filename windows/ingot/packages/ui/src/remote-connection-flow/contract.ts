import type {
  RemoteConnectionFeedbackOptions,
  RemoteConnectionOpenPreference,
} from "@/app-shell/types.js";
export { requestRemoteProjectConnection } from "@/remote-connection-flow/requestRemoteProjectConnection.js";
import { type RemoteTarget, type RemoteWorkspaceSessionEntry } from "@origin-ai/cf-shared";

export interface RemoteConnectionFlowOptions {
  
  openIntentId?: number;
  completion?: RemoteConnectionOpenPreference["completion"];
  
  onDeviceConnected?: (
    sourceServerId: string | undefined,
    canDeliver?: () => boolean,
  ) => void | Promise<void>;
  
  onCancelled?: (background?: boolean) => void;
  initialFailure?: RemoteConnectionOpenPreference["initialFailure"];
  onConnect: (
    options: RemoteTarget,
    requestId?: string,
    context?: { confirmSourceServerInstall?: boolean },
    feedback?: RemoteConnectionFeedbackOptions,
  ) => Promise<string>;
  
  onConnectionReady?: (sessionId: string) => Promise<void>;
  onSelectProject: (
    sessionId: string,
    path: string,
    localWorkspacePath?: string,
    workspacePurpose?: "project" | "conversation",
  ) => Promise<void>;
  onCancelSession: (sessionId: string) => Promise<void>;
  localWorkspacePath?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  isWindowsDesktop?: boolean;
  remoteWorkspaceSessions?: RemoteWorkspaceSessionEntry[];
  onFlowActiveChange?: (active: boolean) => void;
  onFlowRequestIdChange?: (requestId: string | null) => void;
  onFlowTargetChange?: (target: RemoteTarget | null) => void;
  preferredKind?: RemoteTarget["kind"];
  preferredWslDistro?: string;
  preferredSourceServerId?: string;
  preferredProfileId?: string;
  preferredDirectoryPath?: string;
  preferredTarget?: RemoteTarget;
  
  onProjectIntentCleared?: () => void;
}

export interface RemoteConnectionCompletionIntent {
  preferredDirectoryPath?: string;
  options?: {
    directToDirectory?: boolean;
    localWorkspacePath?: string;
    announceReusedConnection?: boolean;
  };
}

export function normalizeRemoteConnectionOptions({
  openIntentId,
  completion,
  onDeviceConnected,
  onCancelled,
  onConnect,
  onConnectionReady,
  onSelectProject,
  onCancelSession,
  localWorkspacePath,
  open: controlledOpen,
  onOpenChange,
  isWindowsDesktop = false,
  remoteWorkspaceSessions = [],
  onFlowActiveChange,
  onFlowRequestIdChange,
  onFlowTargetChange,
  preferredKind,
  preferredWslDistro,
  preferredSourceServerId,
  preferredProfileId,
  preferredDirectoryPath,
  preferredTarget,
  onProjectIntentCleared,
  initialFailure,
}: RemoteConnectionFlowOptions) {
  return {
    openIntentId,
    completion,
    onDeviceConnected,
    onCancelled,
    onConnect,
    onConnectionReady,
    onSelectProject,
    onCancelSession,
    localWorkspacePath,
    controlledOpen,
    onOpenChange,
    isWindowsDesktop,
    remoteWorkspaceSessions,
    onFlowActiveChange,
    onFlowRequestIdChange,
    onFlowTargetChange,
    preferredKind,
    preferredWslDistro,
    preferredSourceServerId,
    preferredProfileId,
    preferredDirectoryPath,
    preferredTarget,
    onProjectIntentCleared,
    initialFailure,
  };
}
export type RemoteConnectionOptions = ReturnType<typeof normalizeRemoteConnectionOptions>;

export interface RemoteConnectionProgress {
  operationId: string;
  view: import("@/RemoteConnectionWizardChrome.js").RemoteWizardStep;
  cancelled: boolean;
  target: RemoteTarget | null;
  sourceServerId?: string;
  profileId?: string;
  name?: string;
  logs: import("@/hooks/useRemoteConnectionLogs.js").RemoteConnectionLogEntry[];
  error: string;
  reason: string;
  waiting: boolean;
  ready: boolean;
  onResume(): void;
  onCancel(): void;
}
