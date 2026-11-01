import {
  createRootTraceContext,
  createTraceId,
  type Logger,
  type LoggerFactory,
  type McpPort,
  type SessionEventStorePort,
  type SessionId,
  type SessionTaskType,
  type SessionStorePort,
  type TraceContext,
} from "@origin-ai/cf-contracts";
import type { McpTelemetryTracker } from "@origin-ai/cf-adapters";
import type { WorkspaceHookPolicyProvider } from "@origin-ai/cf-core";
import type { AccountProviderConfigSnapshot } from "@origin-ai/cf-provider";
import {
  cfProtocolErrorCodes,
  type AppToolSearchMode,
  type CfAutomationBotDeliveryTarget,
  type CfDeliveryKind,
  type ModelSelection,
  type CfModelContextBudgetStrategy,
  type CfProtocolMessage,
  type CfProtocolMethod,
  type CfProtocolNotification,
  type CfProtocolRequest,
  type CfProtocolRequestId,
  type CfProtocolTrace,
  type CfSessionMode,
  type CfSessionPersistence,
  type CfWorkspaceRef,
} from "@origin-ai/cf-shared";
import type { CfApp, CfAppOptions } from "../app/types.js";
import type { V4InteractionRegistry } from "../cf-protocol-v4/interaction-registry.js";
import type { ConversationV4Gateway } from "../cf-protocol-v4/v4-gateway.js";
import type { SessionResidentPool, SessionResidentPoolOptions } from "./session-resident-pool.js";
import type { DynamicWorkflowMode } from "@origin-ai/cf-shared";

export interface ParamsSchema<T> {
  parse(input: unknown): T;
}

export interface CfProtocolAgentDependencies {
  createCfApp(options?: Omit<CfAppOptions, "providerRegistry">): CfApp | Promise<CfApp>;
  
  createSessionEventStore?(sessionId: string): SessionEventStorePort;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  loggerFactory?: LoggerFactory;
  mcpPort?: McpPort;
  
  mcpTelemetry?: Pick<McpTelemetryTracker, "listProcesses">;
  platform?: NodeJS.Platform | string;
  
  sessionResidentPoolOptions?: SessionResidentPoolOptions;
  
  sessionResidentTargetCount?: number;
  sessionStore?: SessionStorePort;
  version?: string;
  
  workspaceHookPolicyProvider?: WorkspaceHookPolicyProvider;
  
  syncAccountProviderConfig?: (snapshot: AccountProviderConfigSnapshot) => Promise<boolean>;
  
  refreshProviderRegistry?: (reason: string) => Promise<void>;
}

export type CfProtocolAgentResolvedDependencies = CfProtocolAgentDependencies & {
  createSessionEventStore(sessionId: string): SessionEventStorePort;
  workspaceHookPolicyProvider: WorkspaceHookPolicyProvider;
};

export interface CfProtocolEventSequenceState {
  lastSeq: number;
  seqBySourceEventKey: Map<string, number>;
}

export interface CfProtocolToolInputTransmissionState {
  streamedToolCallIdsWithInput: Set<string>;
}

export interface CfProtocolSessionRecord {
  app: CfApp;
  subagentRuntimeConfigEnabled?: boolean;
  memoryEnabled: boolean;
  nativeSearchEnhancementsEnabled: boolean;
  toolSearchMode: AppToolSearchMode;
  modelContextBudgetStrategy: CfModelContextBudgetStrategy;
  createdAt: number;
  deliveryKind?: CfDeliveryKind;
  
  legacyStreamSubscribed?: boolean;
  eventStore: SessionEventStorePort;
  parentSessionId?: SessionId;
  persistence: CfSessionPersistence;
  protocolEventSequences: Map<string, CfProtocolEventSequenceState>;
  protocolToolInputTransmissions: Map<string, CfProtocolToolInputTransmissionState>;
  stateRevision: number;
  taskType?: SessionTaskType;
  traceContext: TraceContext;
  unsubscribe?: () => void;
  updatedAt: number;
  lastOutcome?: "completed" | "interrupted" | "error";
  workspace: CfWorkspaceRef;
  activeAbortController?: AbortController;
  
  residencyFinalizationCount?: number;
  
  activeAutomationId?: string;
  
  activeOffPeakTaskId?: string;
  
  activeBotDeliveryTarget?: CfAutomationBotDeliveryTarget;
  restoreWarning?: { message: string; type: string };
  
  restoredModelSelection?: ModelSelection;
}

export interface CfProtocolClientRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  trace?: CfProtocolTrace;
  reannounceIntervalMs?: number;
}

export interface CfProtocolAgentServerContext {
  
  assertServing?: () => void;
  deps: CfProtocolAgentResolvedDependencies;
  logger?: Logger;
  appRuntimePreferences: {
    askUserQuestionAutoResolutionEnabled: boolean;
    modelIoFullRetentionEnabled: boolean;
    
    offPeakToolEnabled: boolean;
    
    dynamicWorkflowEnabled: boolean;
    
    dynamicWorkflowMode?: DynamicWorkflowMode;
  };
  sessionCreationIds?: Set<string>;
  notify(notification: CfProtocolNotification): void;
  requestClient<T>(
    method: CfProtocolMethod,
    params: unknown,
    resultSchema: ParamsSchema<T>,
    options?: CfProtocolClientRequestOptions,
  ): Promise<T>;
}

export const PROTOCOL_CLIENT_REQUEST_ERROR_CODES = {
  
  noClientAttached: -32020,
  
  cancelled: -32021,
  
  timedOut: -32022,
} as const;

export class ProtocolRequestError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "ProtocolRequestError";
  }
}

export function isRequest(message: CfProtocolMessage): message is CfProtocolRequest {
  return "method" in message && "id" in message;
}

export function isNotification(
  message: CfProtocolMessage,
): message is CfProtocolNotification {
  return "method" in message && !("id" in message);
}

export function isResponse(
  message: CfProtocolMessage,
): message is { id: CfProtocolRequestId; result: unknown } {
  return "id" in message && "result" in message;
}

export function isErrorResponse(message: CfProtocolMessage): message is {
  id: CfProtocolRequestId;
  error: { code: number; message: string; data?: unknown };
} {
  return "id" in message && "error" in message;
}

function summarizeParamsError(error: unknown): string | undefined {
  const issues = (error as { issues?: Array<{ path?: unknown[]; message?: string }> })?.issues;
  if (!Array.isArray(issues) || issues.length === 0) {
    return undefined;
  }
  const parts = issues.slice(0, 5).map((issue) => {
    const path =
      Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message ?? "invalid"}`;
  });
  const more = issues.length > 5 ? ` (+${issues.length - 5} more)` : "";
  return parts.join("; ") + more;
}

export function parseParams<T>(schema: ParamsSchema<T>, params: unknown): T {
  try {
    return schema.parse(params);
  } catch (error) {
    const detail = summarizeParamsError(error);
    throw new ProtocolRequestError(
      -32602,
      detail ? `Invalid params — ${detail}` : "Invalid params",
      error,
    );
  }
}

export function assertExpectedRevision(
  record: CfProtocolSessionRecord,
  expectedRevision: number | undefined,
): void {
  if (expectedRevision !== undefined && expectedRevision !== record.stateRevision) {
    throw new ProtocolRequestError(-32009, "Session state revision mismatch", {
      actualRevision: record.stateRevision,
      expectedRevision,
    });
  }
}

export function toProtocolError(error: unknown): {
  code: number;
  data?: unknown;
  message: string;
} {
  if (error instanceof ProtocolRequestError) {
    return { code: error.code, data: error.data, message: error.message };
  }
  if (error instanceof Error) {
    const businessCode = "code" in error && typeof error.code === "string" ? error.code : undefined;
    return {
      code: -32603,
      data: {
        name: error.name,
        stack: error.stack,
        ...(businessCode ? { code: businessCode } : {}),
      },
      message: error.message,
    };
  }
  return {
    code: -32603,
    message: String(error),
  };
}

export function createProtocolTraceId(_sessionId: SessionId): TraceContext["traceId"] {
  return createTraceId();
}

export function createProtocolRootTraceContext(
  sessionId: SessionId,
  trace?: CfProtocolTrace,
): TraceContext {
  const context = createRootTraceContext({
    sessionId,
    traceId: (trace?.traceId ?? createProtocolTraceId(sessionId)) as TraceContext["traceId"],
  });
  if (trace?.spanId) {
    context.spanId = trace.spanId;
  }
  if (trace?.parentId) {
    context.parentId = trace.parentId;
    context.parentSpanId = trace.parentId;
  }
  return context;
}

export function protocolTraceFromTraceContext(context: TraceContext): CfProtocolTrace {
  return {
    traceId: context.traceId,
    ...(context.spanId ? { spanId: context.spanId } : {}),
    ...((context.parentId ?? context.parentSpanId)
      ? { parentId: context.parentId ?? context.parentSpanId }
      : {}),
  };
}

export function requireSession(
  context: CfProtocolAgentServerContext,
  sessionId: string,
  options: { deliveryKind?: CfDeliveryKind; operation?: string } = {},
): CfProtocolSessionRecord {
  const record = context.sessions.get(sessionId);
  if (!record) {
    context.logger?.warn("CodeFusion Protocol session runtime missing", {
      activeSessionCount: context.sessions.size,
      event: "cf_protocol.session.require_missing",
      hasSessionStore: Boolean(context.deps.sessionStore),
      module: "bootstrap.cf_protocol",
      operation: options.operation ?? "unknown",
      ...(options.deliveryKind ? { deliveryKind: options.deliveryKind } : {}),
      sessionId,
    });
    throw new ProtocolRequestError(
      cfProtocolErrorCodes.sessionUnavailable,
      `Session is not active: ${sessionId}`,
    );
  }
  return record;
}

export function createProtocolLogger(deps: CfProtocolAgentDependencies): Logger | undefined {
  return deps.loggerFactory?.createLogger("cf").child({
    module: "bootstrap.cf_protocol",
  });
}
