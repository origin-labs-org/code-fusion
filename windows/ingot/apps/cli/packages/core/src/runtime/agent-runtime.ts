import { configureOffPeakRuntime, controlOffPeakRuntime } from "./off-peak/runtime.js";
import {
  createTurnAgentDefinitions,
  createAgentDefinitionsReader,
  type GetAgentDefinitions,
} from "../subagent/definitions.js";
import { DEFAULT_CF_MODEL_CONTEXT_BUDGET_STRATEGY, resolveExecutionState } from "@origin-ai/cf-shared";
import type { BackgroundBashOutputResult } from "@origin-ai/cf-shared";
import {
  createDenyPermissionBroker,
  createRootTraceContext,
  createToolRegistry,
  defaultPermissionConfig,
  EventReducer,
  MessageHistoryImpl,
  PermissionService,
  ToolScheduler,
  traceContextToLogContext,
} from "./deps.js";
import type {
  CollaborationMode,
  Logger,
  BackgroundTaskCancelResult,
  SessionEvent,
  MessageId,
  Model,
  ModelSelection,
  ModelSelectionOrigin,
  ModelToolContract,
  PermissionBrokerPort,
  PermissionBrokerRequest,
  ProjectId,
  SessionEventSink,
  SessionEventStorePort,
  SessionId,
  SessionProjection,
  SessionStorePort,
  SessionGoal,
  SavedWorkflowScope,
  TargetChangedPayload,
  DynamicWorkflowRunProgressPayload,
  UserInputAutoResolutionUpdatedPayload,
  ContextSourcePort,
  ExecutionPort,
  FileSystemPort,
  ImageProcessorPort,
  PdfDocumentPort,
  McpConnectionSnapshot,
  SkillLoadOutcome,
  SkillPort,
  McpPort,
  DynamicWorkflowRunPort,
  ModelCatalogPort,
  SubagentPort,
  ToolArtifactStorePort,
  ToolCallId,
  TraceContext,
  TurnSteerInput,
  TurnInputIntentMetadata,
  TurnSteerResult,
  ToolCall,
  TurnState,
  MessageHistory,
  ReadFileStateMap,
  ToolSchedule,
  ToolExecutor,
  ToolRegistry,
  ContextBuilder,
  ContextBuildResult,
  ContextSourceSnapshot,
  ExecutionShellSelection,
  HookRunner,
  TurnId,
} from "./deps.js";
import { installAgentRuntimeMethods } from "./methods/index.js";
import type { StartSavedWorkflowRunResult } from "./methods/dynamic-workflow-run-start.js";
import type {
  AmendWorkflowRunSettingsInput,
  AmendWorkflowRunSettingsResult,
} from "./methods/dynamic-workflow-run-settings.js";
import { createRuntimeCommandQueue } from "./command-queue.js";
import type { RuntimeCommandQueue } from "./command-queue.js";
import type {
  ModelConnectivityTestInput,
  WorkspaceGenerateTextInput,
  WorkspaceGenerateTextResult,
} from "./methods/workspace-generate-text.js";
import type {
  RuntimeBackgroundStopOptions,
  RuntimeBackgroundStopResult,
} from "./methods/background.js";
import { initializeRuntimeTooling } from "./helpers/runtime-tools.js";
import {
  resolveInitialDynamicWorkflowToolsActivated,
  type DynamicWorkflowActivationSource,
} from "./methods/dynamic-workflow-activation.js";
import type {
  ActiveTurnInfo,
  ActiveForegroundExecutionState,
  AcquireForegroundPromotionLeaseResult,
  ActiveTurnStartReservation,
  ActiveTurnSteeringState,
  AgentRuntimeConfig,
  AgentRuntimeDeps,
  ContinueActiveTargetLoopOptions,
  ConversationBeforeInputForkOptions,
  ConversationRewindResult,
  ExecuteToolsOptions,
  ExecuteToolsResult,
  ExecuteTurnOptions,
  PromptAdmissionOptions,
  PromptAdmissionReceipt,
  ForegroundPromotionLeaseMode,
  ForegroundPromotionLeaseState,
  PendingModelChangeTimeline,
  PermissionDecisionResult,
  MainTurnCacheHitAggregate,
  RuntimeTurnFileChangeMap,
  ResumeSessionOptions,
  ResumeSessionResult,
  SelectionSideChatCreateOptions,
  StableConversationForkOptions,
  StopActiveForegroundExecutionOptions,
  StopActiveForegroundExecutionResult,
  TurnResult,
  WorkspaceCheckpointSummary,
  WorkspaceFileRewindApplyResult,
  WorkspaceFileRewindPreview,
  WorkspaceForkResult,
} from "./types.js";
import type { AgentRuntimeInternal } from "./internal.js";
import { InMemoryRuntimeTaskRegistry, type RuntimeTaskRegistry } from "../runtime-task/registry.js";
import type { WorkflowBlockedReminderClock } from "../runtime-task/workflow-blocked-reminder.js";
import { createWorkflowBlockedReminder } from "./methods/dynamic-workflow-blocked-reminder.js";
import { createMemoryRecallState } from "../memory/recall/index.js";
import type { MemoryRecallState } from "../memory/recall/index.js";
import type { ChildClientPortsContext, ClientFacingPorts } from "./helpers/child-client-ports.js";
import type { ProjectMemoryRecallPrefetch } from "./helpers/project-memory-recall.js";
import type { ProjectMemoryExtractionScheduler } from "./helpers/project-memory-extraction.js";
import type { ProjectMemoryUpdate } from "./helpers/project-memory-dream.js";
import { projectPersistentAgentMemoryTools } from "../subagent/persistent-memory.js";
import { RuntimeTelemetryFacade } from "../telemetry/runtime-telemetry.js";
import type { WorkspaceHookRuntimeAdmissionPort } from "../hooks/workspace-hook-runtime-admission.js";
import { disposeNodeReplSession } from "../tool/handlers/node-repl.js";
import { cloneModelSelection } from "./model-selection.js";

// oxlint-disable typescript-eslint/no-unsafe-declaration-merging
export class AgentRuntime {
  controlOffPeakExecution(
    input: import("@origin-ai/cf-shared").OffPeakControlParams,
  ): Promise<import("@origin-ai/cf-shared").OffPeakControlResult> {
    return controlOffPeakRuntime(
      this as unknown as import("./internal.js").AgentRuntimeInternal,
      input,
    );
  }
  private sessionId: SessionId;
  private turnNumber: number;
  private config: AgentRuntimeConfig;
  private appVersion: string;
  private permissionService: PermissionService;
  private permissionBroker: PermissionBrokerPort;
  private toolScheduler: ToolScheduler;
  private eventReducer: EventReducer;
  private eventStore: SessionEventStorePort;
  private rootTraceContext: TraceContext;
  private logger?: Logger;
  private eventSinks = new Set<SessionEventSink>();
  private now: () => Date;
  private isRemoteWorkspace: () => boolean;
  private registry: ToolRegistry;
  private executor: ToolExecutor;
  private hookRunner?: HookRunner;
  private workspaceHookAdmission?: WorkspaceHookRuntimeAdmissionPort;
  private modelFactory: AgentRuntimeDeps["modelFactory"];
  private modelIoDir?: string;
  private providerRuntimeHeadersPort?: AgentRuntimeDeps["providerRuntimeHeadersPort"];
  private browserControlPort?: AgentRuntimeDeps["browserControlPort"];
  
  private modelRequestAdmission?: AgentRuntimeDeps["modelRequestAdmission"];
  private sessionModelSelection: ModelSelection | undefined;
  private messageHistory: MessageHistory;
  private readFileState: ReadFileStateMap;
  private cachedTools: ModelToolContract[] | null = null;
  
  private dynamicWorkflowToolsActivated: boolean;
  private dynamicWorkflowActivationSource?: DynamicWorkflowActivationSource;
  private contextBuilder: ContextBuilder | null = null;
  private contextInitialized = false;
  private contextSourceSnapshot?: ContextSourceSnapshot;
  private latestContextBuildResult?: ContextBuildResult;
  private memoryRoot?: string;
  private memoryIndexContent?: string;
  private memoryRecallState: MemoryRecallState;
  private memoryRecallPrefetch?: ProjectMemoryRecallPrefetch;
  private memoryExtractionScheduler?: ProjectMemoryExtractionScheduler;
  private memoryDreamLastScanAtMs = 0;
  private pendingMemoryUpdate?: ProjectMemoryUpdate;
  private contextSourcePort?: ContextSourcePort;
  private skillPort?: SkillPort;
  private mcpPort?: McpPort;
  private mcpStartupPromise?: Promise<McpConnectionSnapshot>;
  private residencyBlockingWorkCount = 0;
  private mcpInitialized = false;
  private mcpToolsRegistered = false;
  private registeredMcpToolNames?: string[];
  private mcpToolsSignature?: string;
  private mcpToolListRevision?: number;
  private subagentPort?: SubagentPort;
  private readonly getAgentDefinitions: GetAgentDefinitions;
  private readonly prepareAgentDefinitions: ReturnType<
    typeof createTurnAgentDefinitions
  >["prepare"];
  private dynamicWorkflowRunPort?: DynamicWorkflowRunPort;
  private modelCatalogPort?: ModelCatalogPort;
  private runtimeTaskRegistry: RuntimeTaskRegistry;
  private workflowBlockedReminder: WorkflowBlockedReminderClock;
  private branchGeneration = 0;
  private artifactStore?: ToolArtifactStorePort;
  private executionPort?: ExecutionPort;
  private fileSystemPort?: FileSystemPort;
  private imageProcessorPort?: ImageProcessorPort;
  private pdfDocumentPort?: PdfDocumentPort;
  private skillLoadOutcome?: SkillLoadOutcome;
  private workingDirectory: string;
  private workspaceRoot: string;
  private sessionStore?: SessionStorePort;
  private sessionPersisted = false;
  private needsPlanModeExitReminder = false;
  private latestConversationMessageId?: MessageId;
  private latestAssistantMessageId?: MessageId;
  private latestAssistantTurnId?: TurnId;
  private mainTurnCacheHitAggregate: MainTurnCacheHitAggregate = {
    requestCount: 0,
    totalInputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
  };
  private currentTurnFileChanges: RuntimeTurnFileChangeMap = new Map();
  private lastAssistantCompletedAtMs?: number;
  private lastEmittedLocalDate?: string;
  private autoCompactConsecutiveFailures = 0;
  private runtimeCommandQueue: RuntimeCommandQueue;
  private runtimeCommandDrainActive = false;
  private activeForegroundExecution?: ActiveForegroundExecutionState;
  
  private foregroundPromotionLease?: ForegroundPromotionLeaseState;
  private activeTurn?: ActiveTurnSteeringState;
  private activeTurnStartReservation?: ActiveTurnStartReservation;
  private pendingInputSequence = 0;
  
  private pendingInputReservations = new Map<string, string>();
  private queueAutoDrain = true;
  private queueExternalDrainActive = false;
  private shuttingDown = false;
  private backgroundTaskNotificationsSealed = false;
  private backgroundTaskNotificationSealReason?: "subagent_terminal" | "subagent_cancelled";
  private pendingModelChangeTimeline?: PendingModelChangeTimeline;
  private sessionStartHookRan = false;
  private sessionTitleGenerationAttempted = false;
  private agentTelemetry: RuntimeTelemetryFacade;

  constructor(sessionId: SessionId, config: AgentRuntimeConfig, deps: AgentRuntimeDeps) {
    const runtime = this as unknown as AgentRuntimeInternal;
    this.sessionId = sessionId;
    this.turnNumber = 0;
    this.config = {
      ...config,
      modelContextBudgetStrategy: DEFAULT_CF_MODEL_CONTEXT_BUDGET_STRATEGY,
    };
    Object.assign(this.config, resolveExecutionState(config));
    const definitions = createTurnAgentDefinitions(
      deps.getAgentDefinitions ??
        createAgentDefinitionsReader(this.config.subagents?.profiles ?? [], {
          builtInModelSelectionOverrides: this.config.subagents?.builtInModelSelectionOverrides,
        }),
      deps.loadAgentDefinitions,
    );
    this.getAgentDefinitions = () =>
      projectPersistentAgentMemoryTools(definitions.get(), this.config.memory);
    this.prepareAgentDefinitions = definitions.prepare;
    this.agentTelemetry = new RuntimeTelemetryFacade({
      agentName: config.agentName,
      causation: deps.agentTelemetryCausation,
      causationMode: deps.agentTelemetryCausationMode,
      parentSessionId: config.parentSessionId,
      port: deps.agentTelemetry,
      sessionId,
      taskType: config.taskType,
    });
    this.permissionService =
      deps.permissionService ?? new PermissionService(defaultPermissionConfig);
    this.permissionBroker = deps.permissionBroker ?? createDenyPermissionBroker();
    this.toolScheduler =
      deps.toolScheduler ??
      new ToolScheduler({
        maxConcurrency: this.config.toolConcurrency?.maxConcurrency,
      });
    this.eventReducer = new EventReducer();
    this.eventStore = deps.eventStore;
    this.sessionStore = deps.sessionStore;
    this.rootTraceContext = deps.traceContext ?? createRootTraceContext({ sessionId });
    this.appVersion = deps.appVersion ?? "0.0.0";
    this.logger = deps.logger?.child({
      ...traceContextToLogContext(this.rootTraceContext),
      module: "core.runtime",
    });
    if (deps.eventSink) {
      this.eventSinks.add(deps.eventSink);
    }
    this.now = deps.now ?? (() => new Date());
    this.isRemoteWorkspace = deps.isRemoteWorkspace ?? (() => false);
    this.modelFactory = deps.modelFactory;
    this.modelIoDir = deps.modelIoDir;
    this.providerRuntimeHeadersPort = deps.providerRuntimeHeadersPort;
    this.browserControlPort = deps.browserControlPort;
    this.modelRequestAdmission = deps.modelRequestAdmission;
    configureOffPeakRuntime(
      this as unknown as import("./internal.js").AgentRuntimeInternal,
      deps.onOffPeakLifecycleEvent,
    );
    this.sessionModelSelection =
      config.modelSelection && cloneModelSelection(config.modelSelection);
    this.messageHistory = new MessageHistoryImpl();
    this.readFileState = new Map();
    this.memoryRecallState = createMemoryRecallState();
    this.runtimeCommandQueue = createRuntimeCommandQueue();
    this.workingDirectory = config.workingDirectory ?? ".";
    this.contextSourcePort = deps.contextSourcePort;
    this.skillPort = deps.skillPort;
    this.mcpPort = deps.mcpPort;
    this.runtimeTaskRegistry = deps.runtimeTaskRegistry ?? new InMemoryRuntimeTaskRegistry();
    this.runtimeTaskRegistry.setActiveBranchGeneration?.(this.branchGeneration);
    this.workflowBlockedReminder = createWorkflowBlockedReminder(runtime);
    this.artifactStore = deps.artifactStore;
    this.executionPort = deps.executionPort;
    this.fileSystemPort = deps.fileSystemPort;
    this.imageProcessorPort = deps.imageProcessorPort;
    this.pdfDocumentPort = deps.pdfDocumentPort;
    this.subagentPort = deps.subagentPort ?? runtime.createDefaultSubagentPort(deps);
    this.dynamicWorkflowRunPort = deps.dynamicWorkflowRunPort;
    this.modelCatalogPort = deps.modelCatalogPort;
    this.registry = deps.toolRegistry ?? createToolRegistry();
    this.workspaceRoot = this.workingDirectory;
    this.dynamicWorkflowToolsActivated = resolveInitialDynamicWorkflowToolsActivated(this.config);
    const tooling = initializeRuntimeTooling(runtime, deps, sessionId);
    this.hookRunner = tooling.hookRunner;
    this.workspaceHookAdmission = deps.workspaceHookAdmission;
    this.executor = tooling.executor;

    this.contextBuilder = deps.contextBuilder ?? null;
    if (this.contextBuilder) {
      runtime.initializeMessageHistoryFromContext(this.contextBuilder, this.rootTraceContext);
      this.contextInitialized = true;
    }
    runtime.startMcpStartup(this.rootTraceContext);
  }

  async closeBrowserSession(): Promise<void> {
    this.beginShutdown();
    disposeNodeReplSession(this.sessionId);
    try {
      await this.browserControlPort?.closeSession?.({
        sessionId: this.sessionId,
        traceContext: this.rootTraceContext,
      });
    } catch (error) {
      this.logger?.warn("Browser session cleanup failed", {
        error: error instanceof Error ? error.message : String(error),
        event: "browser.session_cleanup.failed",
      });
    }
  }

  beginShutdown(): void {
    this.shuttingDown = true;
    this.workflowBlockedReminder.stop();
    this.memoryExtractionScheduler?.shutdown();
  }
}

export interface AgentRuntime {
  lastPermissionGrantId?: string;
  beginShutdown(): void;
  closeBrowserSession(): Promise<void>;
  updateConfig(
    patch: Pick<AgentRuntimeConfig, "mode" | "planEnabled" | "language" | "outputStyle">,
  ): void;
  initializeSessionShellEnvironmentIfNeeded(
    selection: ExecutionShellSelection | (() => ExecutionShellSelection),
  ): boolean;
  getSessionShellSelection(): ExecutionShellSelection | undefined;
  getMode(): CollaborationMode;
  getPlanEnabled(): boolean;
  grantPermissionFullAccess(interactionId: string, signal?: AbortSignal): Promise<string>;
  setExecutionState(
    input: { mode?: string; planEnabled?: boolean },
    traceContext?: TraceContext,
  ): Promise<void>;
  getSessionModelSelection(): ModelSelection | undefined;
  setSessionModelSelection(selection: ModelSelection | undefined): void;
  getProjectId(): ProjectId;
  ensureSessionPersistedForExternalActivity(
    input: string,
    options?: { traceContext?: TraceContext },
  ): Promise<void>;
  maybeStartSessionTitleGenerationFromExternalInput(
    input: string,
    options?: { goalSummaryTargetID?: string; traceContext?: TraceContext },
  ): void;
  
  setCustomSessionTitle(input: { title: string; traceContext: TraceContext }): Promise<void>;
  maybeStartGoalSummaryTitleGeneration(
    input: string,
    targetID: string,
    options?: { traceContext?: TraceContext },
  ): boolean;
  recordExternalUserPrompt(
    input: string,
    options?: {
      goalSummaryTargetID?: string;
      traceContext?: TraceContext;
      intent?: TurnInputIntentMetadata;
    },
  ): Promise<MessageId>;
  recordPendingModelChange(input: {
    fromModel?: ModelSelection;
    fromModelLabel?: string;
    toModel: ModelSelection;
    toModelLabel: string;
  }): void;
  getActiveTurnInfo(): ActiveTurnInfo | undefined;
  admitPrompt(
    input: string,
    attachments?: TurnState["attachments"],
    options?: PromptAdmissionOptions,
  ): Promise<PromptAdmissionReceipt>;
  
  hasActiveOrQueuedTurnWork(): boolean;
  
  hasRunningBackgroundTasks(): boolean;
  
  hasResidencyBlockingWork(): boolean;
  
  trackResidencyBlockingWork<T>(work: Promise<T>): Promise<T>;
  
  isSessionPersisted(): boolean;
  getActiveForegroundExecutionId(): string | undefined;
  acquireForegroundPromotionLease(options: {
    leaseId: string;
    mode: ForegroundPromotionLeaseMode;
    promotedInputId: string;
  }): AcquireForegroundPromotionLeaseResult;
  releaseForegroundPromotionLease(leaseId: string): boolean;
  enqueueDeferredInput(input: string | TurnSteerInput): Promise<TurnSteerResult>;
  steerTurn(input: string | TurnSteerInput): Promise<TurnSteerResult>;
  
  removePendingInputById(options: {
    pendingInputId: string;
    reason: "user_removed" | "promoted";
    reservationId?: string;
    traceContext?: TraceContext;
  }): Promise<boolean>;
  reservePendingInputById(options: {
    pendingInputId: string;
    reservationId: string;
    traceContext?: TraceContext;
  }): Promise<boolean>;
  markPendingInputPromoting(options: {
    pendingInputId: string;
    reservationId: string;
    traceContext?: TraceContext;
  }): Promise<boolean>;
  releasePendingInputReservation(options: {
    pendingInputId: string;
    reservationId: string;
    traceContext?: TraceContext;
  }): Promise<boolean>;
  
  editPendingInputById(options: {
    pendingInputId: string;
    newText: string;
    traceContext?: TraceContext;
  }): Promise<boolean>;
  
  reorderPendingInput(options: {
    pendingInputId: string;
    beforePendingInputId: string | null;
    traceContext?: TraceContext;
  }): Promise<boolean>;
  
  clearAllPendingInputs(traceContext: TraceContext): Promise<number>;
  
  setQueueAutoDrain(options: { autoDrain: boolean; traceContext?: TraceContext }): Promise<void>;
  
  completeExternalQueueDrain(): void;
  
  setFollowupMode(options: { mode: "queue" | "guide"; traceContext?: TraceContext }): Promise<void>;
  
  emitModelSelected(options: {
    modelSelection: ModelSelection;
    model?: Model;
    effectiveReasoningLevel?: string;
    previousModelSelection?: ModelSelection | null;
    origin?: ModelSelectionOrigin;
    supportedThoughtLevels?: readonly string[];
    traceContext?: TraceContext;
  }): Promise<void>;
  
  emitModeChanged(options: {
    mode: CollaborationMode;
    previousMode: CollaborationMode;
    traceContext: TraceContext;
  }): Promise<void>;
  getToolRegistry(): ToolRegistry;
  
  invalidateToolCache(): void;
  getToolExecutor(): ToolExecutor;
  subscribeEvents(sink: SessionEventSink): () => void;
  /** Bootstrap-owned lifecycle producers append only validated session events through this durable path. */
  appendEvent(event: SessionEvent, traceContext: TraceContext): Promise<void>;
  
  getSessionEventStore(): SessionEventStorePort;
  
  notifyExternalChildSessionEvent(input: {
    childSessionId: SessionId;
    event: SessionEvent;
    traceContext?: TraceContext;
    
    interactionOrigin?: ChildClientPortsContext;
  }): Promise<void>;
  
  createChildClientPorts(context: ChildClientPortsContext): ClientFacingPorts;
  getContextBuilder(): ContextBuilder;
  
  getSkillCatalog(traceContext: TraceContext): Promise<SkillLoadOutcome>;
  resumeFromStore(options?: ResumeSessionOptions): Promise<ResumeSessionResult>;
  recordTargetChanged(input: TargetChangedPayload & { traceContext: TraceContext }): Promise<void>;
  recordUserInputAutoResolutionUpdate(
    input: UserInputAutoResolutionUpdatedPayload & { traceContext?: TraceContext },
  ): Promise<void>;
  
  recordDynamicWorkflowRunProgress(
    input: DynamicWorkflowRunProgressPayload & { traceContext?: TraceContext },
  ): Promise<void>;
  
  
  activateDynamicWorkflowTools(input: {
    source: DynamicWorkflowActivationSource;
    traceContext?: TraceContext;
  }): Promise<boolean>;
  trackResumedDynamicWorkflowRun(input: {
    runId: string;
    toolCallId?: string;
    name?: string;
    traceContext?: TraceContext;
  }): Promise<void>;
  
  startSavedWorkflowRun(input: {
    name: string;
    scope?: SavedWorkflowScope;
    args?: Record<string, unknown>;
    traceContext?: TraceContext;
  }): Promise<StartSavedWorkflowRunResult>;
  
  amendWorkflowRunSettings(
    input: AmendWorkflowRunSettingsInput,
  ): Promise<AmendWorkflowRunSettingsResult>;
  recordGoalStateChangeReminder(input: {
    text: string;
    traceContext?: TraceContext;
  }): Promise<void>;
  continueActiveTargetIfIdle(options?: {
    abortSignal?: AbortSignal;
    inputId?: string;
    intent?: TurnInputIntentMetadata;
    traceContext?: TraceContext;
    verifyBeforeContinue?: boolean;
  }): Promise<TurnResult | null>;
  continueActiveTargetLoop(options: ContinueActiveTargetLoopOptions): Promise<TurnResult | null>;
  stopActiveForegroundExecution(
    options?: StopActiveForegroundExecutionOptions,
  ): StopActiveForegroundExecutionResult;
  activatePausedTargetAfterResume(traceContext: TraceContext): Promise<SessionGoal | null>;
  executeTurn(
    input: string,
    attachments?: TurnState["attachments"],
    options?: ExecuteTurnOptions,
  ): Promise<TurnResult>;
  scheduleTools(toolCalls: ToolCall[]): Promise<ToolSchedule>;
  executeTools(
    toolCalls: ToolCall[],
    schedule: ToolSchedule,
    options?: ExecuteToolsOptions,
  ): Promise<ExecuteToolsResult>;
  emitPermissionRequest(toolCallId: ToolCallId, toolName: string, riskLevel: string): Promise<void>;
  resolvePermission(toolCallId: ToolCallId, decision: PermissionDecisionResult): Promise<void>;
  getPendingPermissionRequests(): PermissionBrokerRequest[];
  getProjection(): Promise<SessionProjection>;
  readBackgroundBashOutput(workId: string, sessionId?: string): Promise<BackgroundBashOutputResult>;
  cancelBackgroundTask(
    taskId: string,
    options?: { traceContext?: TraceContext },
  ): Promise<BackgroundTaskCancelResult>;
  stopBackgroundTask(
    taskId: string,
    options: RuntimeBackgroundStopOptions,
  ): Promise<RuntimeBackgroundStopResult>;
  cancelRunningRuntimeBackgroundTasks(input: {
    reason: "subagent_cancelled";
    traceContext?: TraceContext;
  }): Promise<void>;
  sealBackgroundTaskNotifications(input: {
    reason: "subagent_terminal" | "subagent_cancelled";
    traceContext?: TraceContext;
  }): void;
  getSessionId(): SessionId;
  listWorkspaceCheckpoints(options?: { limit?: number }): Promise<WorkspaceCheckpointSummary[]>;
  forkWorkspaceFromCheckpoint(options?: {
    abortSignal?: AbortSignal;
    forkedSessionId?: SessionId;
    targetCheckpointId?: string;
    targetMessageId?: MessageId;
    traceContext?: TraceContext;
  }): Promise<WorkspaceForkResult>;
  forkStableConversationAtMessage(
    options: StableConversationForkOptions,
  ): Promise<WorkspaceForkResult>;
  createSelectionSideConversation(
    options: SelectionSideChatCreateOptions,
  ): Promise<WorkspaceForkResult>;
  forkConversationBeforeMessage(
    options: ConversationBeforeInputForkOptions,
  ): Promise<WorkspaceForkResult>;
  
  rewindConversationToMessage(options: {
    abortSignal?: AbortSignal;
    events: SessionEvent[];
    targetMessageId: MessageId;
    traceContext: TraceContext;
  }): Promise<ConversationRewindResult>;
  previewWorkspaceFileRewind(options?: {
    abortSignal?: AbortSignal;
    targetCheckpointId?: string;
    targetMessageId?: MessageId;
    targetMessageIds?: MessageId[];
    targetTurnId?: TurnId;
    traceContext?: TraceContext;
  }): Promise<WorkspaceFileRewindPreview>;
  applyWorkspaceFileRewind(options?: {
    abortSignal?: AbortSignal;
    targetCheckpointId?: string;
    targetMessageId?: MessageId;
    targetMessageIds?: MessageId[];
    targetTurnId?: TurnId;
    traceContext?: TraceContext;
    commitAfterApply?: () => Promise<void>;
  }): Promise<WorkspaceFileRewindApplyResult>;
  sampleModel(
    input: import("./methods/sample-model.js").SampleModelInput,
    options: { abortSignal: AbortSignal; traceContext?: TraceContext },
  ): Promise<import("@origin-ai/cf-shared/mcp-apps").McpAppsSamplingResult>;
  generateWorkspaceText(
    input: WorkspaceGenerateTextInput,
    options?: { abortSignal?: AbortSignal; traceContext?: TraceContext },
  ): Promise<WorkspaceGenerateTextResult>;
  testModelConnectivity(
    input: ModelConnectivityTestInput,
    options?: { abortSignal?: AbortSignal; traceContext?: TraceContext },
  ): Promise<void>;
  isProjectMemoryEnabled(): boolean;
  
  drainMemoryExtractions(timeoutMs?: number | null): Promise<void>;
}

installAgentRuntimeMethods(AgentRuntime);
