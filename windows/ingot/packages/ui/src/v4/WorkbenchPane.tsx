import {
  RemoteConversationBanner,
  RemoteConversationDisconnected,
} from "@/project-sidebar/RemoteConversationDisconnected.js";

import { memo, useCallback, useEffect, useMemo, type CSSProperties, type ReactNode } from "react";
import { TID_V4_PANE_SHELL, testId } from "@origin-ai/cf-shared/test-ids";
import type {
  GitChangeSourceId,
  GitRepositorySummary,
  CfProvider,
  CfTaskChangeSummary,
} from "@origin-ai/cf-shared";
import { cn } from "@/components/lib/utils.js";
import { useServices } from "@/hooks/useServices.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import type { AssistantPreviewCardsAutoOpenRequest } from "@/lib/assistantPreviewCards.js";
import type { OpenAutomationsMain } from "@/lib/taskNavigationHistory.js";
import type { MessageFileLinkTarget } from "@/components/ai-elements/message.js";
import type {
  OpenScopedSubagentSideTabRequest,
  OpenBackgroundBashSideTabRequest,
  OpenScopedSubagentDirectorySideTabRequest,
  OpenSelectionSideChatRequest,
  OpenScopedPlanDetailSideTabRequest,
  OpenScopedWorkflowActorSessionSideTabRequest,
  OpenScopedWorkflowArtifactSideTabRequest,
  OpenScopedWorkflowRunSideTabRequest,
  OpenScopedWorkflowRunDirectorySideTabRequest,
  OpenScopedWorkflowWorkspaceSideTabRequest,
  SyncSubagentSessionTabsRequest,
} from "@/lib/workspaceSidePane.js";
import { SessionPane } from "@/v4/SessionPane.js";
import type { PaneWorkspaceBadge } from "@/v4/ConversationHeader.js";
import type { ConversationDropTargetController } from "@/v4/composer/conversationDropTarget.js";
import { V4PaneConversationProvider } from "@/v4/V4ConversationContext.js";
import {
  paneWorkspaceKey,
  V4_PRIMARY_PANE_ID,
  type PaneBinding,
  type PaneWorkspaceScope,
} from "@/v4/paneLayoutStore.js";
import type { WorkbenchSessionBinding } from "@/v4/workbenchGroupStore.js";
import {
  acquireSessionsIndex,
  releaseSessionsIndex,
  type SessionsIndexScope,
} from "@/v4/sessionsIndexRegistry.js";
import { rectStyle, type RectExpr } from "@/v4/workbenchLayout.js";
import type {
  ChatSearchResultHighlightRequest,
  ChatViewSummaryPanelVariant,
  ConversationFindMatchState,
} from "@/v4/legacyChatViewTypes.js";

interface ChatPaneShellProps {
  paneId: string;
  focused: boolean;
  
  showFocusIndicator: boolean;
  onFocusRequest: (paneId: string) => void;
  
  style: CSSProperties;
  hidden?: boolean;
  children: ReactNode;
  restoredUnvalidated?: boolean;
}

const INACTIVE_PANE_OVERLAY_STYLE: CSSProperties = {
  backgroundColor: "color-mix(in oklab, var(--color-background) 34%, transparent)",
  backdropFilter: "brightness(0.94) saturate(0.94)",
};

const ChatPaneShell = memo(function ChatPaneShell({
  paneId,
  focused,
  showFocusIndicator,
  onFocusRequest,
  style,
  hidden = false,
  children,
  restoredUnvalidated = false,
}: ChatPaneShellProps) {
  const handleFocusRequest = useCallback(() => {
    onFocusRequest(paneId);
  }, [onFocusRequest, paneId]);

  return (
    <div
      data-testid={testId(TID_V4_PANE_SHELL, paneId)}
      data-pane-id={paneId}
      data-focused={focused ? "true" : "false"}
      data-restored-unvalidated={restoredUnvalidated ? "true" : "false"}
      onPointerDownCapture={handleFocusRequest}
      onFocusCapture={handleFocusRequest}
      style={style}
      className={cn(
        "absolute flex min-h-0 min-w-0 flex-col",
        hidden && "hidden",
        showFocusIndicator && focused && "ring-1 ring-inset ring-[var(--color-brand)]",
      )}
    >
      {showFocusIndicator && !focused ? (
        <div
          aria-hidden="true"
          data-v4-pane-inactive-overlay="true"
          style={INACTIVE_PANE_OVERLAY_STYLE}
          className="pointer-events-none absolute inset-0 z-30 rounded-md transition-[background-color,backdrop-filter]"
        />
      ) : null}
      {children}
    </div>
  );
});

interface PaneRestoredGuardProps {
  paneId: string;
  scope: PaneWorkspaceScope;
  sessionId: string;
  onConfirmed: (paneId: string) => void;
  onMissing: (paneId: string) => void;
}

function PaneRestoredGuard({
  paneId,
  scope,
  sessionId,
  onConfirmed,
  onMissing,
}: PaneRestoredGuardProps) {
  const services = useServices();
  const agentService = services.cfAgentService;
  const { workspacePath, workspaceIdentity, remoteSessionId } = scope;

  useEffect(() => {
    if (!agentService) {
      return;
    }
    const indexScope: SessionsIndexScope = {
      workspaceKey: paneWorkspaceKey({ workspacePath, workspaceIdentity }),
      workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
      ...(remoteSessionId ? { endpointKey: remoteSessionId } : {}),
    };
    const store = acquireSessionsIndex(indexScope, agentService);
    let disposed = false;
    let settled = false;
    const evaluate = () => {
      if (disposed || settled || store.getState().workspaceId === null) {
        return;
      }
      settled = true;
      const exists = store.getSessions().some((summary) => summary.sessionId === sessionId);
      if (exists) {
        onConfirmed(paneId);
      } else {
        onMissing(paneId);
      }
    };
    const unsubscribe = store.subscribe(evaluate);
    evaluate();
    return () => {
      disposed = true;
      unsubscribe();
      releaseSessionsIndex(indexScope, store);
    };
  }, [
    agentService,
    paneId,
    sessionId,
    workspacePath,
    workspaceIdentity,
    remoteSessionId,
    onConfirmed,
    onMissing,
  ]);

  return null;
}

export interface WorkbenchShellBinding {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  
  isDesktop?: boolean;
  readOnly?: boolean;
  allowEscapeStopOutsidePane?: boolean;
  compactForRemoteControl?: boolean;
  sessionId: string | null;
  
  activeSessionId?: string | null;
  activeSelectionSideChatSessionId?: string | null;
  provider?: CfProvider;
  onSessionCreated?: (sessionId: string) => void;
  onSessionDeleted?: () => void;
  draftComposerHeader?: ReactNode;
  onPrimaryDraftDropTargetControllerChange?: (
    controller: ConversationDropTargetController | null,
  ) => void;
  gitSummary?: GitRepositorySummary | null;
  gitDirtyFileCount?: number;
  gitWorktreeReviewSourceId?: GitChangeSourceId | null;
  gitWorktreeChangeSummary?: { added: number; removed: number } | null;
  activeTaskChangeSummary?: CfTaskChangeSummary | null;
  summaryPanelVariantOverride?: ChatViewSummaryPanelVariant | null;
  onSummaryPanelVariantOverrideChange?: (variant: ChatViewSummaryPanelVariant | null) => void;
  onRefreshGit?: () => void;
  onOpenGitReview?: (sourceId?: GitChangeSourceId) => void;
  onOpenBrowserUrl?: (url: string) => void;
  onOpenAutomationsMain?: OpenAutomationsMain;
  onOpenCodeViewer?: (source: CodeViewerSource) => void;
  onAutoOpenAssistantPptx?: (request: AssistantPreviewCardsAutoOpenRequest) => void;
  onOpenFileLink?: (target: MessageFileLinkTarget) => void;
  onOpenBackgroundBash?: (request: OpenBackgroundBashSideTabRequest) => void;
  onOpenSubagentSession?: (request: OpenScopedSubagentSideTabRequest) => void;
  onOpenSubagentDirectory?: (request: OpenScopedSubagentDirectorySideTabRequest) => void;
  onSyncSubagentSessionTabs?: (request: SyncSubagentSessionTabsRequest) => void;
  onOpenSelectionSideChat?: (request: OpenSelectionSideChatRequest) => void;
  onOpenPlanDetail?: (request: OpenScopedPlanDetailSideTabRequest) => void;
  
  onOpenWorkflowRun?: (request: OpenScopedWorkflowRunSideTabRequest) => void;
  onOpenWorkflowArtifact?: (request: OpenScopedWorkflowArtifactSideTabRequest) => void;
  onOpenWorkflowRunDirectory?: (request: OpenScopedWorkflowRunDirectorySideTabRequest) => void;
  onOpenWorkflowActorSession?: (request: OpenScopedWorkflowActorSessionSideTabRequest) => void;
  onOpenWorkflowWorkspace?: (request: OpenScopedWorkflowWorkspaceSideTabRequest) => void;
  conversationFindQuery?: string;
  conversationFindActiveIndex?: number;
  conversationFindNavigationRequestId?: number;
  onConversationFindMatchStateChange?: (state: ConversationFindMatchState) => void;
  searchResultHighlightRequest?: ChatSearchResultHighlightRequest | null;
  onSearchResultHighlightDone?: (requestId: number) => void;
}

export interface WorkbenchLeafPaneProps {
  paneId: string;
  rect: RectExpr;
  
  hidden?: boolean;
  focused: boolean;
  showFocusIndicator: boolean;
  shellWorkspaceKey: string;
  
  binding: PaneBinding | null;
  
  primaryBinding?: WorkbenchSessionBinding | null;
  shell: WorkbenchShellBinding;
  onFocusRequest: (paneId: string) => void;
  onClosePane: (paneId: string) => void;
  onConfirmRestoredSession: (paneId: string) => void;
  onBindSession: (paneId: string, sessionId: string) => boolean | void;
  onPaneActiveSessionChange?: (scope: PaneWorkspaceScope, sessionId: string) => void;
}

function workspaceBadgeFor(scope: PaneWorkspaceScope): PaneWorkspaceBadge {
  const label = scope.workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? scope.workspacePath;
  return {
    label,
    workspacePath: scope.workspacePath,
    remote: Boolean(scope.workspaceIdentity || scope.remoteSessionId),
  };
}

export function WorkbenchLeafPane({
  paneId,
  rect,
  hidden = false,
  focused,
  showFocusIndicator,
  shellWorkspaceKey,
  binding,
  primaryBinding,
  shell,
  onFocusRequest,
  onClosePane,
  onConfirmRestoredSession,
  onBindSession,
  onPaneActiveSessionChange,
}: WorkbenchLeafPaneProps) {
  const isPrimary = paneId === V4_PRIMARY_PANE_ID;
  const isGroupPrimary = isPrimary && Boolean(primaryBinding);
  const scope = useMemo<PaneWorkspaceScope>(() => {
    if (!isPrimary && binding) {
      return binding.workspaceScope;
    }
    if (isPrimary && primaryBinding) {
      return primaryBinding.workspaceScope;
    }
    return {
      workspacePath: shell.workspacePath,
      ...(shell.workspaceIdentity ? { workspaceIdentity: shell.workspaceIdentity } : {}),
      ...(shell.remoteSessionId ? { remoteSessionId: shell.remoteSessionId } : {}),
    };
  }, [
    isPrimary,
    binding,
    primaryBinding,
    shell.workspacePath,
    shell.workspaceIdentity,
    shell.remoteSessionId,
  ]);

  const style = useMemo(() => rectStyle(rect), [rect]);

  const handleClosePane = useCallback(() => {
    onClosePane(paneId);
  }, [onClosePane, paneId]);
  const handleSessionDeleted = useCallback(() => {
    if (isGroupPrimary) {
      handleClosePane();
      shell.onSessionDeleted?.();
      return;
    }
    if (isPrimary) {
      shell.onSessionDeleted?.();
      return;
    }
    handleClosePane();
  }, [handleClosePane, isGroupPrimary, isPrimary, shell.onSessionDeleted]);
  const handleBindSession = useCallback(
    (createdSessionId: string) => {
      const shouldSyncShellActive = onBindSession(paneId, createdSessionId) !== false;
      if (shouldSyncShellActive) {
        onPaneActiveSessionChange?.(scope, createdSessionId);
      }
    },
    [onBindSession, onPaneActiveSessionChange, paneId, scope],
  );
  const handleSessionCreated = useCallback(
    (createdSessionId: string) => {
      if (isPrimary && !primaryBinding) {
        onBindSession(paneId, createdSessionId);
        shell.onSessionCreated?.(createdSessionId);
        return;
      }
      handleBindSession(createdSessionId);
    },
    [handleBindSession, isPrimary, onBindSession, paneId, primaryBinding, shell.onSessionCreated],
  );
  if (!isPrimary && !binding) {
    return null;
  }

  const isShellWorkspace = paneWorkspaceKey(scope) === shellWorkspaceKey;
  const sessionId = isPrimary
    ? (primaryBinding?.sessionId ?? shell.sessionId)
    : (binding?.sessionId ?? null);
  const readOnly = Boolean(
    (isPrimary ? primaryBinding?.readOnly : binding?.readOnly) ||
    (isShellWorkspace && shell.readOnly),
  );
  const shouldUseShellStatusPanel = isShellWorkspace;
  const paneSearchResultHighlightRequest =
    sessionId === shell.searchResultHighlightRequest?.taskId
      ? shell.searchResultHighlightRequest
      : null;

  return (
    <ChatPaneShell
      paneId={paneId}
      focused={focused}
      showFocusIndicator={showFocusIndicator}
      onFocusRequest={onFocusRequest}
      style={style}
      hidden={hidden}
      restoredUnvalidated={Boolean((isPrimary ? primaryBinding : binding)?.restoredUnvalidated)}
    >
      <V4PaneConversationProvider
        scope={scope}
        sessionId={sessionId}
        unavailableFallback={<RemoteConversationDisconnected {...scope} sessionId={sessionId} />}
        disconnectedBanner={<RemoteConversationBanner {...scope} sessionId={sessionId} />}
      >
        {(isPrimary ? primaryBinding : binding)?.restoredUnvalidated && sessionId ? (
          <PaneRestoredGuard
            paneId={paneId}
            scope={scope}
            sessionId={sessionId}
            onConfirmed={onConfirmRestoredSession}
            onMissing={onClosePane}
          />
        ) : null}
        <SessionPane
          paneId={paneId}
          readOnly={readOnly}
          sessionId={sessionId}
          openTrigger={isPrimary ? "sidebar" : "split"}
          activeSelectionSideChatSessionId={resolvePaneActiveSelectionSideChatSessionId(
            sessionId,
            shell.activeSessionId ?? shell.sessionId,
            shell.activeSelectionSideChatSessionId,
          )}
          workspacePath={scope.workspacePath}
          workspaceIdentity={scope.workspaceIdentity}
          remoteSessionId={scope.remoteSessionId}
          isDesktop={shell.isDesktop}
          compactForRemoteControl={shell.compactForRemoteControl ?? false}
          provider={isPrimary && isShellWorkspace ? shell.provider : undefined}
          onSessionCreated={handleSessionCreated}
          onSessionDeleted={handleSessionDeleted}
          focused={focused}
          allowEscapeStopOutsidePane={shell.allowEscapeStopOutsidePane}
          onClosePane={isPrimary ? undefined : handleClosePane}
          workspaceBadge={!isPrimary && !isShellWorkspace ? workspaceBadgeFor(scope) : undefined}
          draftComposerHeader={isPrimary && !primaryBinding ? shell.draftComposerHeader : undefined}
          onDropTargetControllerChange={
            isPrimary && !primaryBinding && sessionId === null
              ? shell.onPrimaryDraftDropTargetControllerChange
              : undefined
          }
          gitSummary={shouldUseShellStatusPanel ? shell.gitSummary : undefined}
          gitDirtyFileCount={shouldUseShellStatusPanel ? shell.gitDirtyFileCount : undefined}
          gitWorktreeReviewSourceId={
            shouldUseShellStatusPanel ? shell.gitWorktreeReviewSourceId : undefined
          }
          gitWorktreeChangeSummary={
            shouldUseShellStatusPanel ? shell.gitWorktreeChangeSummary : undefined
          }
          activeTaskChangeSummary={isPrimary ? shell.activeTaskChangeSummary : undefined}
          summaryPanelVariantOverride={
            shouldUseShellStatusPanel ? shell.summaryPanelVariantOverride : undefined
          }
          onSummaryPanelVariantOverrideChange={
            shouldUseShellStatusPanel ? shell.onSummaryPanelVariantOverrideChange : undefined
          }
          onRefreshGit={shouldUseShellStatusPanel ? shell.onRefreshGit : undefined}
          onOpenGitReview={shouldUseShellStatusPanel ? shell.onOpenGitReview : undefined}
          onOpenBrowserUrl={shell.onOpenBrowserUrl}
          onOpenAutomationsMain={shell.onOpenAutomationsMain}
          onOpenCodeViewer={shell.onOpenCodeViewer}
          onAutoOpenAssistantPptx={shell.onAutoOpenAssistantPptx}
          onOpenFileLink={shell.onOpenFileLink}
          onOpenSubagentSession={shell.onOpenSubagentSession}
          onOpenBackgroundBash={shell.onOpenBackgroundBash}
          onOpenSubagentDirectory={shell.onOpenSubagentDirectory}
          onSyncSubagentSessionTabs={shell.onSyncSubagentSessionTabs}
          onOpenSelectionSideChat={shell.onOpenSelectionSideChat}
          onOpenPlanDetail={shell.onOpenPlanDetail}
          onOpenWorkflowRun={shell.onOpenWorkflowRun}
          onOpenWorkflowArtifact={shell.onOpenWorkflowArtifact}
          onOpenWorkflowRunDirectory={shell.onOpenWorkflowRunDirectory}
          onOpenWorkflowActorSession={shell.onOpenWorkflowActorSession}
          onOpenWorkflowWorkspace={shell.onOpenWorkflowWorkspace}
          conversationFindQuery={focused ? shell.conversationFindQuery : ""}
          conversationFindActiveIndex={focused ? (shell.conversationFindActiveIndex ?? -1) : -1}
          conversationFindNavigationRequestId={
            focused ? (shell.conversationFindNavigationRequestId ?? 0) : 0
          }
          onConversationFindMatchStateChange={
            focused ? shell.onConversationFindMatchStateChange : undefined
          }
          searchResultHighlightRequest={paneSearchResultHighlightRequest}
          onSearchResultHighlightDone={shell.onSearchResultHighlightDone}
        />
      </V4PaneConversationProvider>
    </ChatPaneShell>
  );
}

export function resolvePaneActiveSelectionSideChatSessionId(
  paneSessionId: string | null,
  shellActiveSessionId: string | null,
  activeSelectionSideChatSessionId: string | null | undefined,
): string | null {
  return paneSessionId && paneSessionId === shellActiveSessionId
    ? (activeSelectionSideChatSessionId ?? null)
    : null;
}
