import type { ToolSearchExecutionContext, ToolSearchMode } from "@origin-ai/cf-contracts";
import type { RequestVerificationReason } from "@origin-ai/cf-shared";
import type { GetAgentDefinitions, LoadAgentDefinitions } from "../subagent/definitions.js";
import type { RuntimeInputPresentation, TurnExecutionModelFallbackReason } from "@origin-ai/cf-contracts";

import { PermissionService, ToolScheduler } from "./deps.js";
import type {
  JsonSchema,
  AgentExecutionTelemetryPort,
  AgentTelemetryCausation,
  BackgroundResultOriginMeta,
  ContextUsageBreakdownItem,
  CoordinatorResponsePort,
  ForkCommitBundle,
  ForkChildSessionMetadata,
  ModelRequestAuth,
  ModelRequestDependencies,
  ModelSelection,
  PluginReferenceCatalog,
  ResolvedUserInstructions,
  StableForkGoalBoundaryMetadata,
  StableForkTargetMetadata,
  WorkspaceHookBundleSnapshot,
  WorkspaceId,
} from "@origin-ai/cf-contracts";
import type { CfProviderAccountAccess } from "@origin-ai/cf-shared";
import type { EffectiveModelSelectionResult } from "@origin-ai/cf-shared/model-selection";
import type { RuntimeMessageEntry } from "../agent/message-history.js";
import type {
  CompactPhase,
  CompactReason,
  CompactTrigger,
  CollaborationMode,
  EmbeddedSearchBackend,
  Logger,
  AttachmentStorageMetadata,
  MessageId,
  MessageVisibility,
  FilePartSource,
  ModelRequestAdmission,
  Model,
  ModelNetworkStatusEvent,
  ModelMessageContentBlock,
  ModelReasoningContentBlock,
  ModelStreamRecoveryStatus,
  ModelToolCall,
  ModelToolContract,
  ModelUsage,
  ModelUsageSummary,
  ModelInputMessage,
  MessageWithParts,
  PendingTurnInput,
  TurnInputIntentMetadata,
  TurnSteerResult,
  PartId,
  PermissionBrokerPort,
  PermissionUpdate,
  QueryId,
  RewindScope,
  RewindStrategy,
  SessionEvent,
  SessionEventSink,
  SessionEventStorePort,
  SessionId,
  SessionTaskType,
  SessionMailboxPort,
  SessionProjection,
  SessionStorePort,
  ContextSourcePort,
  DynamicWorkflowRunPort,
  DynamicWorkflowSnippetPort,
  ModelCatalogPort,
  ExecutionPort,
  BrowserControlPort,
  ExecutionShellSelection,
  AutomationPort,
  OffPeakPort,
  TopicResourcePort,
  FileSystemPort,
  HttpClientPort,
  ImageProcessorPort,
  PdfDocumentPort,
  HooksRuntimeConfig,
  SkillPort,
  McpPort,
  McpServerConfig,
  SubagentPort,
  ToolArtifactStorePort,
  ToolCallId,
  WorkflowPort,
  WorkflowEscalatePort,
  WorkflowSubmitPort,
  TraceContext,
  TraceId,
  TurnId,
  CheckpointCreatedPayload,
  RewindTargetEvaluation,
  SessionHistoryHydrationResult,
  SyntheticUserMessageSource,
  HookRunner,
  ToolExecutionResult,
  ToolExecutor,
  ToolRegistry,
  ContextBuilder,
  EnvInfo,
  ProjectContext,
  UserInstructionsOptions,
  AutoCompactPolicyConfig,
  ModelAnomalyGuardConfig,
  OutputStylePromptConfig,
} from "./deps.js";
import type { AgentProfile } from "../subagent/profile.js";
import type { RuntimeTaskRegistry } from "../runtime-task/registry.js";
import type { BashTimeoutPolicy } from "../tool/bash-timeout-policy.js";
import type { PresentationSurface } from "../context/types.js";
import type { WorkspaceHookRuntimeAdmissionPort } from "../hooks/workspace-hook-runtime-admission.js";

// -----------------------------------------------
// Agent Runtime
// -----------------------------------------------

export interface AgentRuntimeConfig {
  toolSearch?: { mode?: ToolSearchMode };
  /** shared-host CUA request routing metadata; desktop is the safe default. */
  clientMode?: "desktop-continuous" | "web-remote-replayable";
  deliveryKind?: "desktop-continuous" | "web-remote-replayable";
  remoteSessionId?: string;
  bashTimeoutPolicy?: BashTimeoutPolicy;
  presentationSurface?: PresentationSurface;
  /** Execution Host's output root, independent of the working repository. */
  genUiOutputRoot?: string;
  mode?: CollaborationMode;
  planEnabled?: boolean;
  modelStreaming?: "off" | "on";
  streamingToolExecution?: "off" | "readOnly";
  
  modelContextBudgetStrategy?: "legacy" | "preflight-v1";
  maxTurns?: number;
  permissionTimeoutMs?: number;
  compact?: AutoCompactPolicyConfig;
  targetCompletionVerification?: { enabled?: boolean };
  midConversationSystem?: {
    mode?: "auto" | "force";
  };
  subagents?: {
    enabled?: boolean;
    inactivityTimeoutMs?: number;
    autoBackgroundMs?: number;
    backgroundBashMaxMs?: number;
    maxTurns?: number;
    outputRootDir?: string;
    profiles?: readonly AgentProfile[];
    builtInModelSelectionOverrides?: Partial<Record<"general-purpose" | "Explore", ModelSelection>>;
  };
  toolAllowlist?: readonly string[];
  toolDisallowlist?: readonly string[];
  
  toolset?: "main" | "explore";
  toolConcurrency?: { maxConcurrency?: number };
  runtimeFeatures?: {
    
    nodeRepl?: boolean;
    
    browserUse?: boolean;
    
    computerUse?: boolean;
    
    browserDocumentationRoot?: string;
  };
  modelAnomalyGuard?: Partial<ModelAnomalyGuardConfig>;
  mcp?: {
    enabled?: boolean;
    servers?: Record<string, McpServerConfig>;
    /**
     * Process-local provenance supplied by bootstrap after resolving bundled
     * official plugins. Never derive this list from serialized MCP config.
     */
    trustedOfficialCuaServerNames?: readonly string[];
  };
  
  pluginReferenceCatalog?: PluginReferenceCatalog;
  hooks?: HooksRuntimeConfig;
  bashShellSelection?: ExecutionShellSelection | undefined;
  embeddedSearchBackend?: EmbeddedSearchBackend;
  
  nativeSearchEnhancementsEnabled?: boolean;
  memory?: MemoryRuntimeConfig;
  
  modelSelection?: ModelSelection;
  titleGeneration?: {
    enabled?: boolean;
    modelSelection?: ModelSelection;
    timeoutMs?: number;
  };
  parentSessionId?: SessionId;
  taskType?: SessionTaskType;
  
  dynamicWorkflowEnabled?: boolean;
  
  dynamicWorkflowToolsOnDemand?: boolean;

  // Context Builder config
  systemPrompt?: string;
  
  workflowActor?: { name?: string; persona?: string };
  /**
   * Selects the subagent-specific context builder for child runtimes. The
   * builder still receives env/date/model data through the normal runtime
   * context snapshot, but assembles provider-visible system sections with the
   * subagent prompt shape instead of the main ContextBuilder stack.
   */
  subagentContext?: {
    agentPrompt: string;
    userInstructions?: ResolvedUserInstructions;
  };
  language?: string;
  outputStyle?: OutputStylePromptConfig;
  agentName?: string; // Default: "cf-agent"
  workingDirectory?: string; // Required for context builder
  
  additionalDirectories?: readonly string[];
  
  workspacePath?: string;
  
  workspaceIdentity?: WorkspaceId;
  envInfo?: EnvInfo; // Optional, will be auto-detected if not provided
  currentDate?: string; // YYYY-MM-DD, resolved by adapter when omitted
  userInstructions?: UserInstructionsOptions; // P1: AGENTS.md
  projectContext?: ProjectContext; // P2: auto-detected if not provided
  skillMetadataBudget?: number;
}

export interface ResumeSessionOptions {
  
  abortSignal?: AbortSignal;
  traceContext?: TraceContext;
  
  persistedMessages?: MessageWithParts[];
  
  modeOverride?: CollaborationMode;
}

export interface MainTurnCacheHitAggregate {
  requestCount: number;
  totalInputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
}

export type BackgroundTaskNotificationSealReason = "subagent_terminal" | "subagent_cancelled";

export interface SealBackgroundTaskNotificationsInput {
  reason: BackgroundTaskNotificationSealReason;
  traceContext?: TraceContext;
}

export interface PendingModelChangeTimeline {
  createdAt: number;
  fromModel?: ModelSelection;
  fromModelLabel?: string;
  requestId: string;
  toModel: ModelSelection;
  toModelLabel: string;
}

export interface EnqueueSubagentMessageInput {
  responseId: string;
  agentId: string;
  agentType: string;
  childSessionId: SessionId;
  childToolCallId: string;
  parentToolCallId?: string;
  summary: string;
  message: string;
  traceContext: TraceContext;
}

export interface MemoryRuntimeConfig {
  cliStorageRoot?: string;
  enabled?: boolean;
  
  extractionEnabled?: boolean;
  storageRoot?: string;
  use?: boolean;
  workspaceIdentity?: string;
}

export interface AgentRuntimeDeps {
  
  getAgentDefinitions?: GetAgentDefinitions;
  
  loadAgentDefinitions?: LoadAgentDefinitions;
  agentTelemetry?: AgentExecutionTelemetryPort;
  agentTelemetryCausation?: AgentTelemetryCausation;
  agentTelemetryCausationMode?: "child" | "linked_root";
  appVersion?: string;
  eventStore: SessionEventStorePort;
  sessionStore?: SessionStorePort;
  sessionMailboxPort?: SessionMailboxPort;
  modelFactory: RuntimeModelFactory;
  
  resolveEffectiveModelSelection?: (selection: ModelSelection) => EffectiveModelSelectionResult;
  modelIoDir?: string;
  providerRuntimeHeadersPort?: ProviderRuntimeHeadersPort;
  permissionService?: PermissionService;
  permissionBroker?: PermissionBrokerPort;
  toolScheduler?: ToolScheduler;
  toolRegistry?: ToolRegistry;
  toolExecutor?: ToolExecutor;
  hookRunner?: HookRunner;
  workspaceHookAdmission?: WorkspaceHookRuntimeAdmissionPort;
  workspaceHookSnapshot?: WorkspaceHookBundleSnapshot;
  executionPort?: ExecutionPort;
  
  browserControlPort?: BrowserControlPort;
  fileSystemPort?: FileSystemPort;
  httpClientPort?: HttpClientPort;
  imageProcessorPort?: ImageProcessorPort;
  pdfDocumentPort?: PdfDocumentPort;
  skillPort?: SkillPort;
  mcpPort?: McpPort;
  subagentPort?: SubagentPort;
  coordinatorResponsePort?: CoordinatorResponsePort;
  
  workflowSubmitPort?: WorkflowSubmitPort;
  
  workflowSubmitSchema?: JsonSchema;
  
  workflowEscalatePort?: WorkflowEscalatePort;
  
  modelRequestAdmission?: ModelRequestAdmission;
  onOffPeakLifecycleEvent?: (
    event: import("./off-peak/lifecycle.js").OffPeakLifecycleEvent,
  ) => void;
  workflowPort?: WorkflowPort;
  
  dynamicWorkflowRunPort?: DynamicWorkflowRunPort;
  dynamicWorkflowSnippetPort?: DynamicWorkflowSnippetPort;
  
  modelCatalogPort?: ModelCatalogPort;
  runtimeTaskRegistry?: RuntimeTaskRegistry;
  artifactStore?: ToolArtifactStorePort;
  automationPort?: AutomationPort;
  offPeakPort?: OffPeakPort;
  topicResourcePort?: TopicResourcePort;
  contextSourcePort?: ContextSourcePort;
  eventSink?: SessionEventSink;
  logger?: Logger;
  traceContext?: TraceContext;
  contextBuilder?: ContextBuilder; // Optional, will be created from config
  now?: () => Date;
  isRemoteWorkspace?: () => boolean;
  memoryRoot?: string;
}

export interface RuntimeModelFactoryInput {
  selection: ModelSelection;
  
  requestDependencies?: ModelRequestDependencies;
}

export type RuntimeModelFactory = (input: RuntimeModelFactoryInput) => Model;

export interface ProviderRuntimeHeadersPort {
  shouldRefreshBeforeModelRequest?(input: { providerId: string; modelId: string }): boolean;
  refreshBeforeModelRequest(input: {
    accountAccess?: CfProviderAccountAccess;
    expectedAccountScope?: string;
    rejectedProjectTokenFingerprint?: string;
    abortSignal?: AbortSignal;
    modelId: string;
    providerId: string;
    reason: RequestVerificationReason;
    sessionId: SessionId;
    traceContext: TraceContext;
    turnId?: TurnId;
  }): Promise<{
    headersApplied: boolean;
    requestAuth?: ModelRequestAuth;
  }>;
}

export interface TurnResult {
  response: string;
  turnId: TurnId;
  traceId: TraceId;
  usage?: ModelUsageSummary;
  events: SessionEvent[];
  projection: SessionProjection;
}

export interface ModelExecutionContext {
  offPeak?: { executionId: string; ticketId: string; providerErrorCode: string };
  
  memoryExtraction?: "skip";
  selectionScope: "execution";
  
  highspeedFallbackSelection?: ModelSelection;
  requestDependencies?: ModelRequestDependencies;
  subagents?: {
    foregroundModel: "submission";
    background: "deny" | "allow";
  };
  
  selectionFallback?: {
    providerId: string;
    rules: Array<{
      reason: TurnExecutionModelFallbackReason;
      providerErrorCode?: string;
    }>;
    target?: ModelSelection;
  };
}

export interface ExecuteTurnOptionsBase {
  
  offPeakExecutionId?: string;
  executionSelection?: ModelSelection;
  abortSignal?: AbortSignal;
  browserAmbientContext?: {
    tabCount: number;
    currentUrl?: string;
  };
  continueActiveTargetAfterTurn?: boolean;
  displayInput?: string;
  
  epilogueStart?: number;
  inputId?: string;
  intent?: TurnInputIntentMetadata;
  sharedContextRefs?: TurnInputIntentMetadata["sharedContextRefs"];
  queryId?: QueryId;
  inputSource?: SyntheticUserMessageSource;
  inputPresentation?: RuntimeInputPresentation;
  inputVisibility?: MessageVisibility;
  originMeta?: BackgroundResultOriginMeta;
  
  backgroundSource?: BackgroundResultOriginMeta["backgroundSource"];
  
  backgroundSubagentResultConsumed?: boolean;
  
  workflowResultConsumed?: boolean;
  recordedInputMessageId?: MessageId;
  skipInputRecord?: boolean;
  skipUserPromptSubmitHooks?: boolean;
  targetId?: string;
  
  toolDisallowlist?: readonly string[];
  traceContext?: TraceContext;
  
  modelExecution?: ModelExecutionContext;
}

export type ExecuteTurnOptions = ExecuteTurnOptionsBase &
  import("@origin-ai/cf-contracts").TurnBackgroundAttribution;

export type PromptAdmissionOptions = ExecuteTurnOptions & {
  commandKind?: "sendText" | "sendGoalCommand" | "compact";
  delivery?: "auto" | "start_turn" | "steer_active_turn";
  expectedTurnId?: TurnId;
  
  queueDelivery?: "guide" | "queue";
  
  requireQueue?: boolean;
  
  requireIdle?: boolean;
};

export type PromptAdmissionReceipt =
  | {
      kind: "started";
      completion: Promise<TurnResult>;
      turnId: TurnId;
    }
  | TurnSteerResult;

export type ActiveTargetLoopTrigger = "manual" | "user-prompt" | "task-notification";

export interface ContinueActiveTargetLoopOptions {
  abortSignal?: AbortSignal;
  inputId?: string;
  intent?: TurnInputIntentMetadata;
  traceContext?: TraceContext;
  trigger: ActiveTargetLoopTrigger;
  verifyBeforeFirstContinue?: boolean;
}

export interface ActiveForegroundExecutionState {
  controller: AbortController;
  disposeParentAbort: () => void;
  foregroundExecutionId: string;
  preserveQueueAutoDrainOnCancel: boolean;
}

export interface StopActiveForegroundExecutionOptions {
  expectedForegroundExecutionId?: string;
  preserveQueueAutoDrainOnCancel?: boolean;
  reason?: string;
}

export type StopActiveForegroundExecutionResult =
  | { kind: "stopped"; foregroundExecutionId: string }
  | { kind: "idle" }
  | { kind: "mismatch"; activeForegroundExecutionId: string };

export type ForegroundPromotionLeaseMode = "after-current" | "idle-only";

export interface ForegroundPromotionLeaseState {
  leaseId: string;
  promotedInputId: string;
}

export type AcquireForegroundPromotionLeaseResult =
  | { kind: "acquired"; leaseId: string }
  | { kind: "busy" }
  | { kind: "conflict"; leaseId: string };

export interface ActiveTurnInfo {
  kind: ActiveTurnKind;
  
  inputId?: string;
  queueLength: number;
  steerable: boolean;
  turnId: TurnId;
}

export interface WorkspaceRewindRestoredFile {
  action: "delete" | "restore";
  bytesWritten?: number;
  path: string;
}

export interface WorkspaceRewindResult {
  checkpoint?: CheckpointCreatedPayload;
  evaluation?: RewindTargetEvaluation;
  restoredFiles: WorkspaceRewindRestoredFile[];
  response: string;
  rewindId: string;
  strategy: RewindStrategy;
}

export type WorkspaceFileRewindAction = "restore" | "delete";

export type WorkspaceFileRewindUnsafeReason =
  | "checkpoint_missing"
  | "checkpoint_unreadable"
  | "external_modified"
  | "file_read_failed"
  | "unsupported_checkpoint";

export interface WorkspaceFileRewindSafeFile {
  action: WorkspaceFileRewindAction;
  operationCount: number;
  path: string;
  toolNames: string[];
}

export interface WorkspaceFileRewindUnsafeFile {
  currentHash?: string;
  expectedHash?: string;
  message?: string;
  operationCount: number;
  path: string;
  reason: WorkspaceFileRewindUnsafeReason;
  toolNames: string[];
}

export interface WorkspaceFileRewindIgnoredFile {
  operationCount: number;
  path: string;
  reason: "bash_ignored";
  toolNames: string[];
}

export interface WorkspaceFileRewindPreview {
  canApply: boolean;
  ignoredFiles: WorkspaceFileRewindIgnoredFile[];
  safeFiles: WorkspaceFileRewindSafeFile[];
  unsafeFiles: WorkspaceFileRewindUnsafeFile[];
}

export interface WorkspaceFileRewindApplyResult {
  applied: boolean;
  preview: WorkspaceFileRewindPreview;
  response: string;
}

export interface ConversationRewindResult {
  branchGeneration?: number;
  evaluation?: RewindTargetEvaluation;
  keptMessageCount: number;
  response: string;
  rewindId: string;
  strategy: RewindStrategy;
  targetMessageId: MessageId;
}

export interface WorkspaceForkResult {
  checkpoint?: CheckpointCreatedPayload;
  copiedMessageCount: number;
  forkedSessionId: SessionId;
  parentSessionId: SessionId;
  targetMessageId: MessageId;
  targetCheckpointId?: string;
  restoredFiles: WorkspaceRewindRestoredFile[];
  response: string;
}

export type StableConversationForkTarget = StableForkTargetMetadata;

export type StableConversationForkGoalBoundary = StableForkGoalBoundaryMetadata;

export type StableConversationForkChildMetadata = ForkChildSessionMetadata;

export interface StableConversationForkOptions {
  forkedSessionId?: SessionId;
  modelSelection?: ModelSelection;
  goalBoundary: StableConversationForkGoalBoundary;
  sourceCommandId: string;
  revisionAtDecision?: number;
  target: StableConversationForkTarget;
  traceContext?: TraceContext;
}

export interface SelectionSideChatCreateOptions {
  modelSelection?: ModelSelection;
  sourceCommandId: string;
  revisionAtDecision?: number;
  traceContext?: TraceContext;
}

export interface ConversationBeforeInputForkOptions {
  modelSelection?: ModelSelection;
  forkedSessionId?: SessionId;
  goalBoundary: StableConversationForkGoalBoundary;
  sourceCommandId: string;
  targetMessageId: MessageId;
  targetProductTurnId: string;
  targetTranscriptTurnId: string;
  initialInput: ForkCommitBundle["initialInput"];
  commandFact: ForkCommitBundle["commandFact"];
  traceContext?: TraceContext;
}

export interface WorkspaceCheckpointSummary {
  checkpointId: string;
  compactBoundaryId?: string;
  coveredByCompact?: boolean;
  createdAt: Date;
  diffRef?: string;
  fileCount?: number;
  messageId: MessageId;
  targetMessageId?: MessageId;
  toolMessageId?: MessageId;
  preview?: string;
  scope: RewindScope;
  snapshotRef: string;
}

export interface RuntimeTurnFileChangeEntry {
  afterContent?: string;
  beforeContent: string | null;
  fallbackAdditions: number;
  fallbackDeletions: number;
  path: string;
  toolNames: Set<string>;
  writeCount: number;
}

export type RuntimeTurnFileChangeMap = Map<string, RuntimeTurnFileChangeEntry>;

export interface CompactTimelineContext {
  operationId: string;
  messageId: MessageId;
  partId: PartId;
  trigger: CompactTrigger;
  phase: CompactPhase;
  compactReason: CompactReason;
  sourceCommandId?: string;
  startedAt: number;
  preCompactTokenCount?: number;
}

export interface ResumeSessionResult extends SessionHistoryHydrationResult {
  directory: string;
  
  modelSelection?: ModelSelection;
  
  persistedMessagesReloadRequired: boolean;
  readFileStateRestoredCount: number;
  readFileStateSkippedRangeReadCount: number;
  readFileStateSkippedUnreadableEditCount: number;
  traceId: TraceId;
}

export interface PermissionDecisionResult {
  allowed: boolean;
  reason?: string;
  modifiedInput?: unknown;
  permissionUpdates?: PermissionUpdate[];
}

export interface ExecuteToolsOptions {
  toolSearch?: ToolSearchExecutionContext;
  automationTurn?: boolean;
  offPeakTurn?: boolean;
  signal?: AbortSignal;
  traceContext?: TraceContext;
  
  subagentModelOverride?: import("@origin-ai/cf-contracts").SubagentRunOptions["modelOverride"];
  model?: Model;
  onBatchStart?: (toolCallIds: string[]) => Promise<void>;
}

export interface ExecuteToolsResult {
  results: ToolExecutionResult[];
  events: SessionEvent[];
}

export type ActiveTurnKind = "regular" | "compact" | "rewind";

export const INLINE_TEXT_ATTACHMENT_MAX_BYTES = 64 * 1024;

export const INLINE_MEDIA_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

export const MAX_IMAGE_ATTACHMENT_DIMENSION = 2000;

export interface ResolvedTurnAttachment {
  contentBlock: ModelMessageContentBlock;
  filename?: string;
  metadata: AttachmentStorageMetadata;
  mime: string;
  source?: FilePartSource;
  url: string;
}

export interface PreparedImageData {
  dataUrl: string;
  mediaType: string;
  metadata?: AttachmentStorageMetadata["image"];
}

export interface ActiveTurnSteeringState {
  kind: ActiveTurnKind;
  goalStateChangeReminderDeferralOpen: boolean;
  pendingGoalStateChangeReminder?: {
    text: string;
  };
  pendingInputs: PendingTurnInput[];
  steerable: boolean;
  traceContext: TraceContext;
  turnId: TurnId;
  
  inputId?: string;
}

export interface ActiveTurnStartReservation {
  kind: ActiveTurnKind;
  traceContext: TraceContext;
  turnId: TurnId;
}

export interface DrainedPendingInputDiagnostics {
  injectedMessageIds: MessageId[];
  
  intent?: TurnInputIntentMetadata;
  latestMessageId: MessageId | undefined;
  pendingInputIds: string[];
  queryIds?: QueryId[];
  
  runtimeEntries: readonly RuntimeMessageEntry[];
  
  toolDisallowlist?: readonly string[];
}

export interface ProviderContextUsageSnapshot {
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  contextUsageTokens?: number;
  inputTokens: number;
  messageCount: number;
  model: { providerId: Model["providerId"]; modelId: Model["modelId"] };
  outputTokens?: number;
  recordedAt: number;
  traceId: TraceId;
  turnId?: TurnId;
}

export interface RunModelTextRequestOptions {
  toolSearchEnabled?: boolean;
  abortSignal?: AbortSignal;
  assistantMessageId: MessageId;
  events: SessionEvent[];
  maxOutputTokens?: number;
  latestRealUserMessageIndex?: number;
  messages: ModelInputMessage[];
  
  sourceEntries?: readonly (RuntimeMessageEntry | undefined)[];
  model: Model;
  onStreamSnapshot?: (snapshot: RuntimeModelStreamSnapshot) => void;
  onStreamReasoningDelta?: (text: string) => void;
  onStreamTextDelta?: (text: string) => void;
  onStreamToolCall?: (toolCall: ModelToolCall) => void;
  onModelNetworkStatus?: (event: ModelNetworkStatusEvent) => void;
  streamRecovery?: ModelStreamRecoveryStatus;
  tools: ModelToolContract[];
  traceContext: TraceContext;
}

export interface RuntimeModelStreamSnapshot {
  reasoning: ModelReasoningContentBlock[];
  text: string;
}

export interface StreamedToolExecutionResult {
  input: Record<string, unknown>;
  ledgerRecorded?: boolean;
  partID: PartId;
  result: ToolExecutionResult;
  toolCallId: ToolCallId;
}

export interface RuntimeModelTextResult {
  contextUsageBreakdown?: ContextUsageBreakdownItem[];
  finishReason: string;
  providerMetadata?: Record<string, unknown>;
  reasoning?: ModelReasoningContentBlock[];
  text: string;
  toolCalls?: ModelToolCall[];
  usage: ModelUsage;
}

export type ParsedRewindCommand =
  | {
      action: "apply";
      targetCheckpointId?: string;
    }
  | {
      action: "fork";
      targetCheckpointId?: string;
    }
  | {
      action: "cascade-message";
      scope: RewindScope;
      targetMessageId: MessageId;
    }
  | {
      action: "message";
      scope: RewindScope;
      targetMessageId: MessageId;
    }
  | {
      action: "status";
    };

export type ContextUsageTokenMethod = "estimated" | "provider_count" | "proportional_estimate";

export type ContextUsageConfidence = "high" | "medium" | "low";

export interface ContextUsageMetric {
  chars: number;
  confidence: ContextUsageConfidence;
  tokenMethod: ContextUsageTokenMethod;
  tokenizer: string;
  tokens: number;
}

export interface ContextUsageCategory extends ContextUsageMetric {
  name: string;
  percentTokens: number;
  source:
    | "system_prompt"
    | "meta_user_context"
    | "skills"
    | "tool_prompt"
    | "system_tool_schemas"
    | "mcp_tool_schemas"
    | "messages";
}

export interface ContextUsageToolDetail extends ContextUsageMetric {
  name: string;
  readOnly?: boolean;
  serverName?: string;
  sideEffectScope?: string;
  source: "system_tool" | "mcp_tool";
}

export interface ContextUsageSkillDetail extends ContextUsageMetric {
  name: string;
  path: string;
  scope: string;
  source: string;
}

export interface ContextUsageMessageRoleBreakdown extends ContextUsageMetric {
  count: number;
  role: string;
}
