import type {
  IPlatformService,
  UserInfo,
  WebRemoteControlMobileNavigationIntent,
  WebRemoteControlMobileTaskView,
  WebRemoteControlTaskTarget,
  WebRemoteControlWorkspaceListResult,
  WebRemoteControlWorkspaceSwitchOptions,
} from "@origin-ai/cf-shared";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import type { ReactNode } from "react";
import type { CreateTaskOptions, CreateTaskRequest } from "@/app-shell/types.js";

export type WebRemoteControlTerminalTransportState =
  | "idle"
  | "connecting"
  | "authenticating"
  | "waiting"
  | "paired"
  | "reconnecting"
  | "suspended"
  | "kicked"
  | "error";

export interface WebRemoteControlWorkspaceSwitcherApi {
  
  deviceNavigation?: {
    deviceName?: string;
    
    devicePlatform?: string;
    chooseOtherDevice(): void;
  };
  listWorkspaces(): Promise<WebRemoteControlWorkspaceListResult>;
  openProjectDraft?(request: CreateTaskOptions): Promise<void>;
  onWorkspaceListUpdated?(
    listener: (result: WebRemoteControlWorkspaceListResult) => void,
  ): () => void;
  switchWorkspace(
    workspaceKey: string,
    options?: WebRemoteControlWorkspaceSwitchOptions,
  ): Promise<void>;
  
  markTaskRead?(task: WebRemoteControlTaskTarget): Promise<void>;
  updateMobileViewState?(workspaceKey: string, taskId?: string): Promise<void>;
  
  updateMobileTaskView?(view: WebRemoteControlMobileTaskView | null): Promise<void>;
  reconnectWorkspace?(workspaceKey: string): Promise<void>;
  startDraft?(
    workspaceKey: string,
    options?: { mobileNavigationIntent?: WebRemoteControlMobileNavigationIntent },
  ): Promise<void>;
}

export interface RootProps {
  services: IServiceAccessor;
  platform: IPlatformService;
  
  initialWorkspaceAbsPath?: string;
  
  initialWorkspacePurpose?: import("@origin-ai/cf-shared").WorkspacePurpose;
  
  unavailableWorkspacePath?: string;
  
  initialWorkspaceIdentity?: string;
  
  initialTaskId?: string;
  
  initialTaskDraft?: CreateTaskOptions;
  
  composerClientNamespace?: string;
  
  isDesktop?: boolean;
  
  isMacDesktop?: boolean;
  
  isWindowsDesktop?: boolean;
  
  restoreSession?: boolean;
  
  supportsSettings?: boolean;
  
  allowOpenWorkspace?: boolean;
  
  preferDirectoryBrowser?: boolean;
  
  supportsEmbeddedBrowser?: boolean;
  
  allowRemoteWorkspace?: boolean;
  
  webRemoteControlWorkspaceSwitcher?: WebRemoteControlWorkspaceSwitcherApi;
  
  initialSidebarFileTreeOpen?: boolean;
  initialWebRemoteControlMobileNavigationIntent?: WebRemoteControlMobileNavigationIntent;
  
  webRemoteControlTerminalTransportState?: WebRemoteControlTerminalTransportState;
  
  initialWorkspaceLoadingFallback?: ReactNode;
  
  webRemoteControlFeatureEnabled?: boolean;
  
  assistantCodeCommentCardsEnabled?: boolean;
}

export interface WorkspaceSettingsLayerProps {
  workspaceScopedServices?: IServiceAccessor;
  isDesktop?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
  isWebRemoteControl?: boolean;
  windowsWindowControlsRightPaddingPx?: number;
  captionWorkspacePath?: string | null;
  onBack?: () => void;
  onCreateTask?: (request?: CreateTaskRequest) => void;
  onOpenWorkspace?: () => void;
  onOpenRemoteWorkspace?: () => void;
  allowOpenWorkspace?: RootProps["allowOpenWorkspace"];
  onLogin?: () => void;
  onLogout?: () => void;
  user?: UserInfo | null;
}
