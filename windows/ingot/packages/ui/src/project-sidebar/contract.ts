import type { Locale, RemoteTarget, UserInfo } from "@origin-ai/cf-shared";
import type { LucideIcon } from "lucide-react";
import type {
  AppProps,
  CreateTaskRequest,
  RemoteWorkspaceRecoveryStatus,
} from "@/app-shell/types.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import type { Theme } from "@/useTheme.js";
export { LEGACY_SINGLE_ROOT_PROJECT_PREFIX } from "@origin-ai/cf-services";
export type { WebRemoteControlMobileTaskView, WebRemoteControlStatus } from "@origin-ai/cf-shared";
export interface ProjectDevice {
  id: string;
  label: string;
  status: string;
  sourceServerId?: string;
}

export interface ProjectRowAction {
  id: string;
  label: string;
  icon?: LucideIcon;
  run(): void;
  disabled?: boolean;
  destructive?: boolean;
}
export {
  buildRemoteHostWorkspaceIdentity,
  parseRemoteWorkspaceIdentity,
  buildRemoteWorkspaceIdentity,
  buildServerRemoteWorkspaceIdentity,
  remoteHostIdFromWorkspaceIdentity,
} from "@origin-ai/cf-shared";
export type {
  WindowHostTaskAddress,
  WindowHostControllerTaskActivity,
} from "@origin-ai/cf-shared/cf-protocol-v4";
export type {
  TaskGroup,
  TaskGroupColor,
  TaskGroupStructure,
  GroupTaskRef,
  GroupNode,
  MoveGroupNode,
  ProjectTree,
  ProjectTask,
  ProjectTaskRef,
  VirtualProject,
  SaveProjectInput,
  IProjectService,
  IWindowControllerService,
  ICfTaskService,
  WindowHostControllerMutation,
  WindowHostControllerFrame,
  WindowHostTaskUnreadSignal,
  IRemoteProjectService,
  RemoteProjectDirectory,
  RemoteProjectEntry,
  RemoteProjectHost,
} from "@origin-ai/cf-services";
export interface ProjectAvailability {
  entryId?: string;
  
  upgradeEntryId?: string;
  online: boolean;
  unresolved?: boolean;
}
export type { Locale, Theme };
export type ProjectSidebarView = "projects" | "grouped" | "timeline";
export interface SidebarFileTreeTarget {
  workspacePath: string;
  workspaceName: string;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
  revealPath?: string;
  temporaryExternalDirectory?: boolean;
}
export interface SidebarFileTreeOpenRequest {
  id: number;
  target: SidebarFileTreeTarget;
}

export interface ProjectSidebarProps {
  workspacePath: string;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
  activePreviewPath?: string | null;
  onOpenFileManager?: (target: SidebarFileTreeTarget) => void;
  onSelectTask: (
    targetWorkspacePath: string,
    taskId: string,
    targetWorkspaceIdentity?: string,
    targetRemoteSessionId?: string,
    expectedUnreadAt?: number,
  ) => void;
  onStartDraftInWorkspace: (targetWorkspacePath: string, targetWorkspaceIdentity?: string) => void;
  onOpenCodeViewer?: (source: CodeViewerSource) => void;
  onOpenBrowserUrl?: (url: string) => void;
  fileTreeOpenRequest?: SidebarFileTreeOpenRequest | null;
  onCreateTask: (request?: CreateTaskRequest) => void;
  onCreateConversationTask: () => void;
  onCreateConversationTaskOnSource?: (sourceServerId: string) => void;
  onOpenFolderFromWorkspaceMenu: () => void;
  onOpenRemoteWorkspace?: AppProps["onOpenRemoteWorkspace"];
  webRemoteControlWorkspaceSwitcher?: import("@/root/types.js").WebRemoteControlWorkspaceSwitcherApi;
  theme: Theme;
  onConnectRemote: (
    options: RemoteTarget,
    requestId?: string,
    context?: { confirmSourceServerInstall?: boolean },
    feedback?: import("@/app-shell/types.js").RemoteConnectionFeedbackOptions,
  ) => Promise<string>;
  onSelectRemoteProject: (
    sessionId: string,
    path: string,
    localWorkspacePath?: string,
    preparedWorkspaceIdentity?: string,
    isCurrent?: () => boolean | Promise<boolean>,
  ) => Promise<void>;
  onCancelRemoteProject: (sessionId: string) => Promise<void>;
  onReconnectRemoteWorkspace: (workspaceKey: string) => Promise<void>;
  onLogout?: () => void;
  onLogin?: () => void;
  user?: UserInfo | null;
  reconnectingRemoteWorkspaceKeys: string[];
  remoteWorkspaceRecoveryByWorkspaceKey?: Record<string, RemoteWorkspaceRecoveryStatus>;
  remoteWorkspaceErrorByWorkspaceKey: Record<string, string>;
  isDesktop?: boolean;
  isWebRemoteControl?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
  isSidebarVisible?: boolean;
  onToggleSidebar?: () => void;
  toggleSidebarShortcutLabel?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  goBackShortcutLabel?: string;
  goForwardShortcutLabel?: string;
  onOpenCommandCenter: () => void;
  onOpenRepoWiki?: () => void;
  repoWikiActive?: boolean;
  onOpenAutomations?: () => void;
  onOpenPluginStore?: () => void;
  automationsActive?: boolean;
  pluginStoreActive?: boolean;
  onFileTreeOpenChange?: (open: boolean) => void;
  onWebRemoteTaskOpen?: (options: { crossWorkspace: boolean }) => void;
  onWebRemoteTaskSwitchingChange?: (switching: boolean) => void;
}
