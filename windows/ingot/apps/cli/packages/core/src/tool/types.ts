import type { ToolSearchExecutionContext, ModelCallWrapper } from "@origin-ai/cf-contracts";
import type { McpToolUiDescriptor } from "@origin-ai/cf-shared/mcp-apps";
// ============================================================
// Tool Types - Core tool types for registry and executor
// ============================================================

import type {
  CollaborationMode,
  AutomationPort,
  BrowserControlPort,
  CoordinatorResponsePort,
  DynamicWorkflowRunPort,
  DynamicWorkflowSnippetPort,
  EmbeddedSearchBackend,
  ExecutionPort,
  ExecutionShellSelection,
  FileSystemPort,
  HttpClientPort,
  ImageProcessorPort,
  JsonSchema,
  Model,
  ModelCatalogPort,
  ModelContentProtection,
  ModelMessageContent,
  ModelToolSideEffectScope,
  OffPeakPort,
  TopicResourcePort,
  PdfDocumentPort,
  PermissionBrokerReasonSource,
  PermissionCapabilityGroup,
  PermissionRuleBehavior,
  PermissionRuleValue,
  PermissionUpdate,
  ProviderNativeToolSpec,
  RiskLevel,
  SessionEvent,
  SessionId,
  SessionModePort,
  SessionStorePort,
  SkillPort,
  SkillTelemetryMetadata,
  SubagentPort,
  SubagentRunOptions,
  ToolArtifactStorePort,
  ToolCancellationPolicy,
  ToolContractDeclaration,
  ToolExecutionMode,
  ToolExecutionSpanWriter,
  ToolExecutionTelemetry,
  ToolResultBudgetStrategy,
  ToolResultDisplayPayload,
  ToolTimeoutPolicy,
  TraceContext,
  TraceId,
  TurnId,
  WorkflowEscalatePort,
  WorkflowPort,
  WorkflowSubmitPort,
} from "@origin-ai/cf-contracts";
import type { RuntimeTaskRegistry } from "../runtime-task/registry.js";
import type {
  PersistedReadFileStateMetadata,
  PersistedReadFileStateTool,
} from "./read-file-state-metadata.js";

// -----------------------------------------------
// Tool Metadata
// -----------------------------------------------

export interface ToolMetadata {
  shouldDefer?: boolean;
  alwaysLoad?: boolean;
  searchHint?: string;
  name: string;
  description?: string;
  modelInstructions?: readonly string[];
  allowedInPlanMode?: boolean;
  readOnly: boolean;
  destructive: boolean;
  concurrentSafe: boolean;
  requiresUserInteraction?: boolean;
  timeoutMs?: number;
  maxOutputBytes?: number;
  sideEffectScope: ModelToolSideEffectScope;
  riskLevel: RiskLevel;
  needsApproval: boolean;
  providerVisible?: boolean;
  
  stopTurnOnSuccess?: boolean;
  
  mcpPresentation?: {
    serverName: string;
    toolName: string;
    description?: string;
    
    official?: boolean;
    
    pluginId?: string;
    
    ui?: McpToolUiDescriptor;
  };
}

// -----------------------------------------------
// Tool Execution Context
// -----------------------------------------------

export type ToolRuntimeScope = "main" | "subagent";

export interface BackgroundTaskControlStopOptions {
  
  initiator?: "user" | "model";
  strict: true;
  traceContext?: TraceContext;
}

export interface BackgroundTaskControlStopResult {
  command?: string;
  ok: boolean;
  reason?:
    | "background_task_cancel_not_supported"
    | "background_task_not_found"
    | "background_task_not_running";
  status?: string;
  taskId: string;
  type?: string;
}

export interface BackgroundTaskControlPort {
  stopBackgroundTask(
    taskId: string,
    options: BackgroundTaskControlStopOptions,
  ): Promise<BackgroundTaskControlStopResult>;
}

export interface ToolExecutionContext {
  toolSearch?: ToolSearchExecutionContext;
  toolCallId: string;
  
  telemetry?: ToolExecutionSpanWriter;
  
  automationTurn?: boolean;
  
  offPeakTurn?: boolean;
  traceContext?: TraceContext;
  traceId: TraceId;
  spanId?: string;
  parentSpanId?: string;
  abortSignal: AbortSignal;
  backgroundTaskControlPort?: BackgroundTaskControlPort;
  emitEvent?: (event: SessionEvent) => Promise<void>;
  executionPort?: ExecutionPort;
  
  browserControlPort?: BrowserControlPort;
  
  browserDocumentationRoot?: string;
  fileSystemPort?: FileSystemPort;
  httpClientPort?: HttpClientPort;
  imageProcessorPort?: ImageProcessorPort;
  pdfDocumentPort?: PdfDocumentPort;
  model?: Model;
  
  subagentModelOverride?: SubagentRunOptions["modelOverride"];
  skillPort?: SkillPort;
  subagentPort?: SubagentPort;
  coordinatorResponsePort?: CoordinatorResponsePort;
  
  workflowSubmitPort?: WorkflowSubmitPort;
  
  workflowEscalatePort?: WorkflowEscalatePort;
  artifactStore?: ToolArtifactStorePort;
  automationPort?: AutomationPort;
  offPeakPort?: OffPeakPort;
  topicResourcePort?: TopicResourcePort;
  sessionStore?: SessionStorePort;
  sessionModePort?: SessionModePort;
  workflowPort?: WorkflowPort;
  
  dynamicWorkflowRunPort?: DynamicWorkflowRunPort;
  
  dynamicWorkflowSnippetPort?: DynamicWorkflowSnippetPort;
  
  modelCatalogPort?: ModelCatalogPort;
  runtimeTaskRegistry?: RuntimeTaskRegistry;
  readFileState?: ReadFileStateMap;
  recordReadFileStateMetadata?: (metadata: PersistedReadFileStateMetadata) => void;
  
  recordSkillTelemetryMetadata?: (metadata: SkillTelemetryMetadata) => void;
  bashShellSelection?: ExecutionShellSelection;
  embeddedSearch?: ToolEmbeddedSearchContext;
  setWorkingDirectory?: (cwd: string) => Promise<void> | void;
  workingDirectory: string;
  workspaceRoot: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  clientMode?: "desktop-continuous" | "web-remote-replayable";
  deliveryKind?: "desktop-continuous" | "web-remote-replayable";
  memoryRoot?: string;
  runtimeScope?: ToolRuntimeScope;
  providerVisibleToolNames?: readonly string[];
  sessionId: SessionId;
  turnId?: TurnId;
  
  inputAdjustments?: Readonly<Record<string, unknown>>;
}

export interface ToolEmbeddedSearchContext {
  backend?: EmbeddedSearchBackend;
  enabled: boolean;
  findAndGrepEnabled?: boolean;
}

export interface ReadFileStateEntry {
  path: string;
  content: string;
  offset?: number;
  limit?: number;
  isPartialView: boolean;
  readAt: Date;
  sourceTool?: PersistedReadFileStateTool;
  revisionId?: string;
  mtimeMs?: number;
  sizeBytes?: number;
}

export type ReadFileStateMap = Map<string, ReadFileStateEntry>;

// -----------------------------------------------
// Tool Handler
// -----------------------------------------------

export interface ToolHandlerFailure {
  result: false;
  errorCode: number;
  message: string;
}

export interface ToolInputValidationContext {
  runtimeTaskRegistry?: RuntimeTaskRegistry;
}

export type ToolInputValidationResult = { result: true } | ToolHandlerFailure;

export interface ToolInputResolutionContext {
  workingDirectory?: string;
  runtimeTaskRegistry?: RuntimeTaskRegistry;
  
  dynamicWorkflowRunPort?: DynamicWorkflowRunPort;
  
  modelCatalogPort?: ModelCatalogPort;
  sessionId?: string;
  
  hasLoadedSkill?: (skillName: string) => boolean;
}

export type ToolInputResolutionResult = { result: true; input: unknown } | ToolHandlerFailure;

export type ToolInputAdjustmentResult =
  | { result: true; input: unknown; applied?: Readonly<Record<string, unknown>> }
  | ToolHandlerFailure;

export type ToolHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: ToolExecutionContext,
) => Promise<TOutput>;

// -----------------------------------------------
// Tool Entry
// -----------------------------------------------

export interface ToolEntry extends ToolContractDeclaration {
  
  retainExecution?: (callId: string) => { signal: AbortSignal; release(): void };
  aliases?: readonly string[];
  /**
   * Host-issued atomicity policy for model content. Only an authority-verified
   * registration path may set this; executor code must never infer it from a
   * tool name or from model-visible content.
   */
  modelContentProtection?: ModelContentProtection["kind"];
  /**
   * Optional provider-visible character threshold for tools whose upstream contract
   * budgets UTF-16 characters rather than UTF-8 bytes.
   */
  maxModelChars?: number;
  /**
   * MIME type for provider-visible model content persisted by the result budget.
   * Defaults to the handler result shape when omitted.
   */
  resultArtifactContentType?: string;
  metadata: ToolMetadata;
  
  permissionCapabilityGroup?: PermissionCapabilityGroup;
  executionMode?: ToolExecutionMode;
  providerNative?: ProviderNativeToolSpec;
  handler: ToolHandler;
  
  resolveModelContract?: (context: ToolExecutionModelContext) => {
    description?: string;
    inputSchema?: JsonSchema;
  };
  validateInput?: (
    input: unknown,
    context: ToolInputValidationContext,
  ) => ToolInputValidationResult;
  
  resolveInput?: (
    input: unknown,
    context: ToolInputResolutionContext,
  ) => Promise<ToolInputResolutionResult> | ToolInputResolutionResult;
  
  applyInputAdjustments?: (
    input: unknown,
    adjustments: Readonly<Record<string, unknown>>,
    context: ToolInputResolutionContext,
  ) => ToolInputAdjustmentResult;
  formatModelContent?: (output: unknown) => ModelMessageContent;
  formatPersistedModelContent?: (
    input: ToolPersistedModelContentInput,
  ) => ModelMessageContent | undefined;
  resolveTimeoutBudgetMs?: (
    input: unknown,
    context?: ToolExecutionModelContext,
  ) => number | undefined;
  resolvePermissionCapability?: (
    input: unknown,
    context?: ToolRuntimePermissionCapabilityContext,
  ) => ToolRuntimePermissionCapability | undefined;
  resolvePermissionRulePolicy?: (
    input: unknown,
    context?: ToolRuntimePermissionCapabilityContext,
  ) => ToolPermissionRulePolicy | undefined;
  /**
   * Last word on an `ask` decision, owned by the tool. Runs after the permission service
   * has already decided to ask, so it can only narrow the ask to a pass (`proceed`) or
   * enrich it with a preview — it can never turn an allow into an ask.
   *
   * Synchronous like the other permission hooks: it inspects the input the executor
   * already holds and must not perform I/O on the approval path. A tool that needs to
   * read the world before it can build a preview belongs in {@link resolveInput}, which
   * runs earlier, is async, and whose result the whole downstream chain shares.
   */
  prepareApproval?: (input: unknown) => ToolApprovalGate;
  inputSchema: JsonSchema;
  runtimeInputSchema?: unknown;
  runtimeOutputSchema?: unknown;
  timeout: ToolTimeoutPolicy;
  cancellation: ToolCancellationPolicy;
}

export type ToolApprovalGate =
  | { gate: "proceed" }
  | { gate: "ask"; display?: ToolResultDisplayPayload };

export interface ToolPermissionRulePolicy {
  evaluateRules: (
    behavior: PermissionRuleBehavior,
    rules: readonly PermissionRuleValue[],
  ) => boolean;
  suggestedPermissionUpdates: PermissionUpdate[];
}

export interface ToolPersistedModelContentInput {
  output: unknown;
  content: string;
  persistedPath: string;
  originalBytes: number;
}

export interface ToolRuntimePermissionCapability {
  userApprovalRule?: string;
  allowedInPlanMode?: boolean;
  destructive?: boolean;
  needsApproval?: boolean;
  readOnly?: boolean;
  requiresUserInteraction?: boolean;
  riskLevel?: RiskLevel;
  sideEffectScope?: ModelToolSideEffectScope;
  permission?: Partial<ToolContractDeclaration["permission"]>;
}

export interface ToolRuntimePermissionCapabilityContext {
  mode?: CollaborationMode;
  bashShellSelection?: ExecutionShellSelection;
  runtimeScope?: ToolRuntimeScope;
  workingDirectory?: string;
  workspaceRoot?: string;
}

export interface ToolExecutionModelContext {
  model?: Model;
}

// -----------------------------------------------
// Execution Results
// -----------------------------------------------

export interface ToolExecutionResult {
  toolCallId: string;
  toolName: string;
  success: boolean;
  output: unknown;
  turnControl?: ToolExecutionTurnControl;
  followUpUserInput?: ToolExecutionFollowUpUserInput;
  display?: ToolResultDisplayPayload;
  modelContent?: ModelMessageContent;
  readFileStateMetadata?: PersistedReadFileStateMetadata;
  serialization?: ToolResultSerialization;
  
  performance?: ToolExecutionTelemetry;
  error?: {
    code?: string;
    detail?: string;
    type: string;
    message: string;
    reasonSource?: PermissionBrokerReasonSource;
    stack?: string;
  };
  durationMs: number;
  startedAt: Date;
  completedAt: Date;
}

export interface ToolExecutionFollowUpUserInput {
  input: string;
  reasonSource: PermissionBrokerReasonSource;
}

export interface ToolExecutionTurnControl {
  reason: "automation_create_limit" | "plan_exit_denied" | "subagent_terminal";
  stopTurnAfterResult: boolean;
}

export interface ToolResultSerialization {
  content: string;
  modelContent?: ModelMessageContent;
  originalBytes: number;
  
  returnedBytes: number;
  truncated: boolean;
  budgetStrategy: ToolResultBudgetStrategy;
  artifactPath?: string;
}

export interface ToolBatchResult {
  toolCallId: string;
  results: ToolExecutionResult[];
  allSucceeded: boolean;
}

// -----------------------------------------------
// Executable Tool Call
// -----------------------------------------------

export interface ExecutableToolCall {
  modelCallWrapper?: ModelCallWrapper;
  id: string;
  name: string;
  input: unknown;
}

// -----------------------------------------------
// Batch Events
// -----------------------------------------------

export type ToolBatchEvent =
  | { type: "batch_start"; parallelGroupIndex: number; toolCallIds: string[] }
  | {
      type: "batch_complete";
      parallelGroupIndex: number;
      results: ToolExecutionResult[];
    }
  | { type: "tool_start"; toolCallId: string }
  | { type: "tool_complete"; result: ToolExecutionResult }
  | { type: "error"; error: Error; toolCallId?: string };
