import {
  RemoteConversationBanner,
  RemoteConversationDisconnected,
} from "@/project-sidebar/RemoteConversationDisconnected.js";
import type { ReactNode } from "react";
import type {
  GitChangeSourceId,
  GitRepositorySummary,
  CfProvider,
  CfTaskChangeSummary,
} from "@origin-ai/cf-shared";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import type { AssistantPreviewCardsAutoOpenRequest } from "@/lib/assistantPreviewCards.js";
import type { OpenAutomationsMain } from "@/lib/taskNavigationHistory.js";
import type { MessageFileLinkTarget } from "@/components/ai-elements/message.js";
import type {
  OpenScopedPlanDetailSideTabRequest,
  OpenScopedWorkflowActorSessionSideTabRequest,
  OpenScopedWorkflowArtifactSideTabRequest,
  OpenScopedWorkflowRunSideTabRequest,
  OpenScopedWorkflowRunDirectorySideTabRequest,
  OpenScopedWorkflowWorkspaceSideTabRequest,
  OpenScopedSubagentDirectorySideTabRequest,
  OpenScopedSubagentSideTabRequest,
  OpenBackgroundBashSideTabRequest,
  SyncSubagentSessionTabsRequest,
} from "@/lib/workspaceSidePane.js";
import { V4ConversationProvider } from "@/v4/V4ConversationContext.js";
import { SessionPane } from "@/v4/SessionPane.js";
import type { SessionOpenTrigger } from "@/lib/sessionOpenArmsTelemetry.js";
import type {
  ChatSearchResultHighlightRequest,
  ChatViewSummaryPanelVariant,
  ConversationFindMatchState,
} from "@/v4/legacyChatViewTypes.js";

export interface V4ChatPaneProps {
  workspacePath: string;
  workspaceIdentity?: string;
  
  isDesktop?: boolean;
  readOnly?: boolean;
  allowEscapeStopOutsidePane?: boolean;
  compactForRemoteControl?: boolean;
  
  sessionId: string | null;
  
  openTrigger?: SessionOpenTrigger;
  provider?: CfProvider;
  onSessionCreated?: (sessionId: string) => void;
  
  onSessionDeleted?: () => void;
  
  draftComposerHeader?: ReactNode;
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

export function V4ChatPane({
  workspacePath,
  workspaceIdentity,
  isDesktop = false,
  readOnly = false,
  allowEscapeStopOutsidePane = false,
  compactForRemoteControl = false,
  sessionId,
  openTrigger = "sidebar",
  provider,
  onSessionCreated,
  onSessionDeleted,
  draftComposerHeader,
  gitSummary,
  gitDirtyFileCount,
  gitWorktreeReviewSourceId,
  gitWorktreeChangeSummary,
  activeTaskChangeSummary,
  summaryPanelVariantOverride,
  onSummaryPanelVariantOverrideChange,
  onRefreshGit,
  onOpenGitReview,
  onOpenBrowserUrl,
  onOpenAutomationsMain,
  onOpenCodeViewer,
  onAutoOpenAssistantPptx,
  onOpenFileLink,
  onOpenSubagentSession,
  onOpenBackgroundBash,
  onOpenSubagentDirectory,
  onSyncSubagentSessionTabs,
  onOpenPlanDetail,
  onOpenWorkflowRun,
  onOpenWorkflowArtifact,
  onOpenWorkflowRunDirectory,
  onOpenWorkflowActorSession,
  onOpenWorkflowWorkspace,
  conversationFindQuery = "",
  conversationFindActiveIndex = -1,
  conversationFindNavigationRequestId = 0,
  onConversationFindMatchStateChange,
  searchResultHighlightRequest,
  onSearchResultHighlightDone,
}: V4ChatPaneProps) {
  return (
    <V4ConversationProvider
      sessionId={sessionId ?? null}
      workspacePath={workspacePath}
      workspaceIdentity={workspaceIdentity}
      unavailableFallback={
        <RemoteConversationDisconnected
          workspacePath={workspacePath}
          workspaceIdentity={workspaceIdentity}
          sessionId={sessionId}
        />
      }
      disconnectedBanner={
        <RemoteConversationBanner
          workspacePath={workspacePath}
          workspaceIdentity={workspaceIdentity}
          sessionId={sessionId}
        />
      }
    >
      <SessionPane
        paneId="workspace-main"
        readOnly={readOnly}
        allowEscapeStopOutsidePane={allowEscapeStopOutsidePane}
        sessionId={sessionId}
        openTrigger={openTrigger}
        workspacePath={workspacePath}
        workspaceIdentity={workspaceIdentity}
        isDesktop={isDesktop}
        compactForRemoteControl={compactForRemoteControl}
        provider={provider}
        onSessionCreated={onSessionCreated}
        onSessionDeleted={onSessionDeleted}
        draftComposerHeader={draftComposerHeader}
        gitSummary={gitSummary}
        gitDirtyFileCount={gitDirtyFileCount}
        gitWorktreeReviewSourceId={gitWorktreeReviewSourceId}
        gitWorktreeChangeSummary={gitWorktreeChangeSummary}
        activeTaskChangeSummary={activeTaskChangeSummary}
        summaryPanelVariantOverride={summaryPanelVariantOverride}
        onSummaryPanelVariantOverrideChange={onSummaryPanelVariantOverrideChange}
        onRefreshGit={onRefreshGit}
        onOpenGitReview={onOpenGitReview}
        onOpenBrowserUrl={onOpenBrowserUrl}
        onOpenAutomationsMain={onOpenAutomationsMain}
        onOpenCodeViewer={onOpenCodeViewer}
        onAutoOpenAssistantPptx={onAutoOpenAssistantPptx}
        onOpenFileLink={onOpenFileLink}
        onOpenSubagentSession={onOpenSubagentSession}
        onOpenBackgroundBash={onOpenBackgroundBash}
        onOpenSubagentDirectory={onOpenSubagentDirectory}
        onSyncSubagentSessionTabs={onSyncSubagentSessionTabs}
        onOpenPlanDetail={onOpenPlanDetail}
        onOpenWorkflowRun={onOpenWorkflowRun}
        onOpenWorkflowArtifact={onOpenWorkflowArtifact}
        onOpenWorkflowRunDirectory={onOpenWorkflowRunDirectory}
        onOpenWorkflowActorSession={onOpenWorkflowActorSession}
        onOpenWorkflowWorkspace={onOpenWorkflowWorkspace}
        conversationFindQuery={conversationFindQuery}
        conversationFindActiveIndex={conversationFindActiveIndex}
        conversationFindNavigationRequestId={conversationFindNavigationRequestId}
        onConversationFindMatchStateChange={onConversationFindMatchStateChange}
        searchResultHighlightRequest={searchResultHighlightRequest}
        onSearchResultHighlightDone={onSearchResultHighlightDone}
      />
    </V4ConversationProvider>
  );
}
