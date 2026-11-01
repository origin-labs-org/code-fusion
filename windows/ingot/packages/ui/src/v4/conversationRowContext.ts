import type { CodePreviewSettings } from "@/lib/codePreviewSettings.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import type { AssistantPreviewCardsAutoOpenRequest } from "@/lib/assistantPreviewCards.js";
import type { OpenAutomationsMain } from "@/lib/taskNavigationHistory.js";
import type { MessageFileLinkTarget } from "@/components/ai-elements/message.js";
import type { WorkflowCausalityGraphData } from "@/components/workflow-graph/types.js";
import type { WorkflowRunSettingsChange } from "@/components/workflow-timeline/workflowRunSettings.js";
import type { WorkflowDraftPosition, WorkflowRunCardSummary } from "@/ToolCallBlocks/shared.js";
import type { WorkflowFillGraph } from "@/v4/workflowRunCardJoin.js";
import type { Theme } from "@/useTheme.js";
import type { ModelSelectionView } from "@origin-ai/cf-services";
import type { CfWorkflowsForRunCandidate } from "@origin-ai/cf-shared";
import type { ConversationAttachmentReadParams, ConversationTransport } from "@/v4/transport.js";
import type {
  OpenPlanDetailSideTabRequest,
  OpenWorkflowActorSessionSideTabRequest,
  OpenWorkflowArtifactSideTabRequest,
  OpenWorkflowRunSideTabRequest,
  OpenWorkflowWorkspaceSideTabRequest,
  OpenSubagentSideTabRequest,
} from "@/lib/workspaceSidePane.js";
import type {
  CommandAck,
  ConversationRowTarget,
  TurnHeaderRow,
  V4ConversationFileChangesResult,
  V4ConversationFileRewindPreviewResult,
} from "@origin-ai/cf-shared/cf-protocol-v4";

export type ConversationFileChangesState = Exclude<
  NonNullable<TurnHeaderRow["fileChanges"]>["state"],
  undefined
>;

export interface ConversationRowRenderContext {
  logEpoch?: string;
  workspacePath: string;
  
  workspaceHomePath?: string;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
  
  modelSelectionView?: ModelSelectionView | null;
  theme: Theme;
  
  codePreviewSettings: CodePreviewSettings;
  
  sessionId?: string | null;
  
  rootSessionId?: string | null;
  
  inSubagentDrilldown?: boolean;
  
  compactForRemoteControl?: boolean;
  
  chatLoadingBlockedByActiveWork?: boolean;
  
  chatLoadingBlockedByInteraction?: boolean;
  
  messageStreamShowReasoning?: boolean;
  
  messageStreamFirstReasoningRowId?: number;
  
  messageStreamShowTodos?: boolean;
  
  toolGroupingExploreEnabled?: boolean;
  
  toolGroupingTerminalEnabled?: boolean;
  
  toolGroupingChangesEnabled?: boolean;
  
  onNavigateToRow?: (sessionId: string, rowId: number) => void;
  
  onOpenBrowserUrl?: (url: string) => void;
  onOpenAutomationsMain?: OpenAutomationsMain;
  
  onOpenCodeViewer?: (source: CodeViewerSource) => void;
  
  onAutoOpenAssistantPptx?: (request: AssistantPreviewCardsAutoOpenRequest) => void;
  
  assistantPreviewPptxAutoOpenTarget?: { turnId: string; key: string } | null;
  
  onOpenFileLink?: (target: MessageFileLinkTarget) => void;
  onOpenSubagentSession?: (request: OpenSubagentSideTabRequest) => void;
  onOpenPlanDetail?: (request: OpenPlanDetailSideTabRequest) => void;
  
  onOpenWorkflowRun?: (request: OpenWorkflowRunSideTabRequest) => void;
  
  onOpenWorkflowArtifact?: (request: OpenWorkflowArtifactSideTabRequest) => void;
  
  onCancelBackgroundWork?: (workId: string) => void;
  
  onResumeWorkflowRun?: (workId: string, name?: string) => void;
  
  onAmendWorkflowRunSettings?: (
    workId: string,
    change: WorkflowRunSettingsChange,
  ) => Promise<CommandAck>;
  
  onSendWorkflowSaveRequest?: (text: string) => Promise<void>;
  
  workflowSaveCandidatesByRunId?: ReadonlyMap<string, readonly CfWorkflowsForRunCandidate[]>;
  
  workflowSessionModel?: { providerId: string; modelId: string };
  
  onOpenWorkflowActor?: (request: OpenWorkflowActorSessionSideTabRequest) => void;
  
  onOpenWorkflowWorkspace?: (request: OpenWorkflowWorkspaceSideTabRequest) => void;
  
  workflowRunByToolCallId?: ReadonlyMap<string, WorkflowRunCardSummary>;
  
  workflowRunByRunId?: ReadonlyMap<string, WorkflowRunCardSummary>;
  
  workflowRunPendingQuestionsByRunId?: ReadonlyMap<string, ReadonlySet<string>>;
  
  workflowGraphByToolCallId?: ReadonlyMap<string, WorkflowCausalityGraphData>;
  
  workflowFillGraphByRunId?: ReadonlyMap<string, WorkflowFillGraph>;
  
  workflowDraftByToolCallId?: ReadonlyMap<string, WorkflowDraftPosition>;
  fetchFileChanges?: (
    target: ConversationRowTarget,
    options: ConversationFileChangesRequestOptions,
  ) => Promise<V4ConversationFileChangesResult>;
  previewFileRewind?: (
    target: ConversationRowTarget,
  ) => Promise<V4ConversationFileRewindPreviewResult>;
  applyFileRewind?: (target: ConversationRowTarget) => Promise<CommandAck>;
  
  readAttachment?: (
    params: ConversationAttachmentReadParams,
  ) => ReturnType<ConversationTransport["attachmentRead"]>;
  readAttachmentRange?: (
    params: Parameters<ConversationTransport["attachmentReadRange"]>[0],
  ) => ReturnType<ConversationTransport["attachmentReadRange"]>;
}

export interface ConversationFileChangesRequestOptions {
  
  cachePolicy: "in-flight" | "terminal";
  
  fileChangesState?: ConversationFileChangesState;
}

export type ConversationReasoningVisibility = Pick<
  ConversationRowRenderContext,
  "messageStreamShowReasoning" | "messageStreamFirstReasoningRowId"
>;

export function isConversationReasoningRowVisible(
  rowId: number,
  visibility: ConversationReasoningVisibility,
): boolean {
  return (
    visibility.messageStreamShowReasoning === true ||
    visibility.messageStreamFirstReasoningRowId === rowId
  );
}
