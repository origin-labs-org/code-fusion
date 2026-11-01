import { memo, useEffect } from "react";
import { ProjectDirectoryProvider } from "@/project-sidebar/index.js";
import { App } from "@/App.js";
import { ScopedErrorBoundary } from "@/ErrorBoundary.js";
import { ServiceProvider } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";
import { WorkspaceSettingsLayer } from "@/root/WorkspaceSettingsLayer.js";
import type { AppProps } from "@/app-shell/types.js";
import type { RootProps } from "@/root/types.js";
import type { IFeedbackService, IServiceAccessor } from "@origin-ai/cf-services";
import { ConversationTelemetryWorkspaceAttachment } from "@/v4/telemetry/ConversationTelemetryAttachment.js";

const StableWorkspaceApp = memo(App);

interface RootWorkspaceContentProps {
  workspaceScopedServices: IServiceAccessor;
  baseFeedbackService: IFeedbackService;
  workspaceShellPath: string;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
  activeWorkspacePath: string | null;
  isSettingsTabActive: boolean;
  handleConnectRemote: AppProps["onConnectRemote"];
  handleSelectRemoteProject: AppProps["onSelectRemoteProject"];
  handleCancelRemoteProject: AppProps["onCancelRemoteProject"];
  handleReconnectRemoteWorkspace: AppProps["onReconnectRemoteWorkspace"];
  handleCreateTask: AppProps["onCreateTask"];
  handleCreateConversationTask: NonNullable<AppProps["onCreateConversationTask"]>;
  handleResolveConversationWorkspace: NonNullable<AppProps["onResolveConversationWorkspace"]>;
  handleOpenWorkspace: AppProps["onOpenWorkspace"];
  handleOpenFolderFromWorkspaceMenu: AppProps["onOpenFolderFromWorkspaceMenu"];
  handleOpenRemoteWorkspace?: AppProps["onOpenRemoteWorkspace"];
  remoteConnectionInProgress?: AppProps["remoteConnectionInProgress"];
  remoteWorkspaceSessions: NonNullable<AppProps["remoteWorkspaceSessions"]>;
  allowRemoteWorkspace: NonNullable<RootProps["allowRemoteWorkspace"]>;
  handleBackFromSettings: () => void;
  handleLogout?: () => void;
  onLogin?: () => void;
  user: AppProps["user"];
  reconnectingRemoteWorkspaceKeys: AppProps["reconnectingRemoteWorkspaceKeys"];
  remoteWorkspaceRecoveryByWorkspaceKey: AppProps["remoteWorkspaceRecoveryByWorkspaceKey"];
  remoteWorkspaceErrorByWorkspaceKey: AppProps["remoteWorkspaceErrorByWorkspaceKey"];

  remoteConnectionLogs?: AppProps["remoteConnectionLogs"];
  allowOpenWorkspace: NonNullable<RootProps["allowOpenWorkspace"]>;
  webRemoteControlWorkspaceSwitcher?: RootProps["webRemoteControlWorkspaceSwitcher"];
  initialSidebarFileTreeOpen?: boolean;
  initialWebRemoteControlMobileNavigationIntent?: RootProps["initialWebRemoteControlMobileNavigationIntent"];
  webRemoteControlTerminalTransportState?: RootProps["webRemoteControlTerminalTransportState"];
  isDesktop?: RootProps["isDesktop"];
  isMacDesktop?: RootProps["isMacDesktop"];
  isWindowsDesktop?: RootProps["isWindowsDesktop"];
  supportsEmbeddedBrowser: NonNullable<RootProps["supportsEmbeddedBrowser"]>;
  windowsWindowControlsRightPaddingPx?: number;
}

export function RootWorkspaceContent({
  workspaceScopedServices,
  baseFeedbackService,
  workspaceShellPath,
  workspaceIdentity,
  workspaceRemoteSessionId,
  activeWorkspacePath,
  isSettingsTabActive,
  handleConnectRemote,
  handleSelectRemoteProject,
  handleCancelRemoteProject,
  handleReconnectRemoteWorkspace,
  handleCreateTask,
  handleCreateConversationTask,
  handleResolveConversationWorkspace,
  handleOpenWorkspace,
  handleOpenFolderFromWorkspaceMenu,
  handleOpenRemoteWorkspace,
  remoteConnectionInProgress,
  remoteWorkspaceSessions,
  allowRemoteWorkspace,
  handleBackFromSettings,
  handleLogout,
  onLogin,
  user,
  reconnectingRemoteWorkspaceKeys,
  remoteWorkspaceRecoveryByWorkspaceKey,
  remoteWorkspaceErrorByWorkspaceKey,

  remoteConnectionLogs,
  allowOpenWorkspace,
  webRemoteControlWorkspaceSwitcher,
  initialSidebarFileTreeOpen,
  initialWebRemoteControlMobileNavigationIntent,
  webRemoteControlTerminalTransportState,
  isDesktop,
  isMacDesktop,
  isWindowsDesktop,
  supportsEmbeddedBrowser,
  windowsWindowControlsRightPaddingPx,
}: RootWorkspaceContentProps) {
  const workspaceKey = workspaceIdentity?.trim() || workspaceShellPath;

  useEffect(() => {
    logger.info("[RootWorkspaceContent] settings layer visibility changed", {
      isSettingsTabActive,
      workspaceShellPath,
      workspaceHiddenByLayout: false,
    });
  }, [isSettingsTabActive, workspaceShellPath]);

  return (
    <ProjectDirectoryProvider isDesktop={isDesktop}>
      <div
        className={isSettingsTabActive ? "h-full opacity-0 pointer-events-none" : "h-full"}
        aria-hidden={isSettingsTabActive}
        data-root-workspace-surface={isSettingsTabActive ? "inert" : "interactive"}
        inert={isSettingsTabActive ? true : undefined}
      >
        {}
        <ConversationTelemetryWorkspaceAttachment
          enabled={isDesktop === true}
          foregroundEnabled={!isSettingsTabActive}
          services={workspaceScopedServices}
          workspacePath={workspaceShellPath}
          workspaceIdentity={workspaceIdentity}
          remoteSessionId={workspaceRemoteSessionId}
        >
          <ServiceProvider services={workspaceScopedServices}>
            <ScopedErrorBoundary
              scope="workspace-app"
              resetKeys={[workspaceKey]}
              variant="panel"
              className="h-full"
            >
              <StableWorkspaceApp
                services={workspaceScopedServices}
                baseFeedbackService={baseFeedbackService}
                onConnectRemote={handleConnectRemote}
                onSelectRemoteProject={handleSelectRemoteProject}
                onCancelRemoteProject={handleCancelRemoteProject}
                onReconnectRemoteWorkspace={handleReconnectRemoteWorkspace}
                onLogout={handleLogout}
                onLogin={onLogin}
                user={user}
                reconnectingRemoteWorkspaceKeys={reconnectingRemoteWorkspaceKeys}
                remoteWorkspaceRecoveryByWorkspaceKey={remoteWorkspaceRecoveryByWorkspaceKey}
                remoteWorkspaceErrorByWorkspaceKey={remoteWorkspaceErrorByWorkspaceKey}
                remoteConnectionLogs={remoteConnectionLogs}
                workspaceAbsPath={workspaceShellPath}
                workspaceRemoteSessionId={workspaceRemoteSessionId}
                workspaceIdentity={workspaceIdentity}
                onCreateTask={handleCreateTask}
                onCreateConversationTask={handleCreateConversationTask}
                onResolveConversationWorkspace={handleResolveConversationWorkspace}
                onOpenWorkspace={handleOpenWorkspace}
                onOpenFolderFromWorkspaceMenu={handleOpenFolderFromWorkspaceMenu}
                onOpenRemoteWorkspace={handleOpenRemoteWorkspace}
                remoteConnectionInProgress={remoteConnectionInProgress}
                onReturnToWorkspace={handleBackFromSettings}
                allowOpenWorkspace={allowOpenWorkspace}
                webRemoteControlWorkspaceSwitcher={webRemoteControlWorkspaceSwitcher}
                initialSidebarFileTreeOpen={initialSidebarFileTreeOpen}
                initialWebRemoteControlMobileNavigationIntent={
                  initialWebRemoteControlMobileNavigationIntent
                }
                webRemoteControlTerminalTransportState={webRemoteControlTerminalTransportState}
                allowRemoteWorkspace={allowRemoteWorkspace}
                remoteWorkspaceSessions={remoteWorkspaceSessions}
                isWorkspaceVisible={!isSettingsTabActive}
                isDesktop={isDesktop}
                isMacDesktop={isMacDesktop}
                isWindowsDesktop={isWindowsDesktop}
                supportsEmbeddedBrowser={supportsEmbeddedBrowser}
              />
            </ScopedErrorBoundary>
          </ServiceProvider>
        </ConversationTelemetryWorkspaceAttachment>
      </div>

      {isSettingsTabActive ? (
        <ScopedErrorBoundary
          scope="workspace-settings-layer"
          resetKeys={[workspaceKey, isSettingsTabActive]}
          variant="panel"
          className="absolute inset-0 z-10"
        >
          <WorkspaceSettingsLayer
            workspaceScopedServices={workspaceScopedServices}
            isDesktop={isDesktop}
            isMacDesktop={isMacDesktop}
            isWindowsDesktop={isWindowsDesktop}
            windowsWindowControlsRightPaddingPx={windowsWindowControlsRightPaddingPx}
            captionWorkspacePath={activeWorkspacePath}
            onBack={activeWorkspacePath ? handleBackFromSettings : undefined}
            onCreateTask={handleCreateTask}
            onOpenWorkspace={handleOpenWorkspace}
            onOpenRemoteWorkspace={handleOpenRemoteWorkspace}
            allowOpenWorkspace={allowOpenWorkspace}
            onLogin={onLogin}
            onLogout={handleLogout}
            user={user}
          />
        </ScopedErrorBoundary>
      ) : null}
    </ProjectDirectoryProvider>
  );
}
