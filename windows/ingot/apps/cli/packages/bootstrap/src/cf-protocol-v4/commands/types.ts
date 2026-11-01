//
import type {
  SessionTaskType,
  StableForkGoalBoundaryMetadata,
  TraceContext,
} from "@origin-ai/cf-contracts";
import type { DynamicWorkflowMode, CfAutomationBotDeliveryTarget } from "@origin-ai/cf-shared";
import type {
  CommandAck,
  CommandEnvelope,
  CommandPayloadMap,
  ConversationInputIntent,
  QueueItem,
  StableForkTarget,
  StableForkTargetResolution,
  ConversationRowTarget,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import type { CfApp } from "../../app/types.js";
import type { V4InteractionRegistry } from "../interaction-registry.js";
import type {
  ConversationEditTarget,
  ConversationRowTargetAction,
  ConversationRowTargetResolution,
} from "../product-projection.js";

export interface V4CommandLogger {
  info?(message: string, fields?: Record<string, unknown>): void;
  warn?(message: string, fields?: Record<string, unknown>): void;
}

export type V4QueueItemCommand = QueueItem;

export type V4TurnExecution = NonNullable<CommandPayloadMap["sendText"]["modelExecution"]>;

export interface V4QueuedTurnExecution {
  modelSelection: NonNullable<CommandPayloadMap["sendText"]["modelSelection"]>;
  modelExecution: V4TurnExecution;
}

export type V4StableForkTargetResolution =
  | {
      ok: true;
      target: StableForkTarget;
      goalBoundary: StableForkGoalBoundaryMetadata;
    }
  | Extract<StableForkTargetResolution, { ok: false }>;

export interface V4SessionRecordView {
  app: CfApp;
  
  traceContext: TraceContext;
  workspace: { workspacePath: string };
  
  persistence: "immediate" | "deferred";
  
  activeAbortController?: AbortController;
  
  residencyFinalizationCount?: number;
  
  activeAutomationId?: string;
  
  activeOffPeakTaskId?: string;
  
  activeBotDeliveryTarget?: CfAutomationBotDeliveryTarget;
  
  restoreWarning?: { message: string; type: string };
  taskType?: SessionTaskType;
}

export interface V4CommandCoreHost {
  
  getRecord(sessionId: string): V4SessionRecordView | undefined;
  logger?: V4CommandLogger;

  
  getQueueItem?(sessionId: string, queueItemId: string): V4QueueItemCommand | null;
  
  hasQueueItemKind?(sessionId: string, kind: QueueItem["kind"]): boolean;
  
  hasQueuedDelivery?(sessionId: string, delivery: "guide" | "queue"): boolean;
  getQueueLength?(sessionId: string): number;
  
  retainQueuedTurnExecution?(
    sessionId: string,
    sourceCommandId: string,
    execution: V4QueuedTurnExecution,
  ): void;
  readQueuedTurnExecution?(
    sessionId: string,
    sourceCommandId: string,
  ): V4QueuedTurnExecution | undefined;
  deleteQueuedTurnExecution?(sessionId: string, sourceCommandId: string): void;
  clearQueuedTurnExecutions?(sessionId: string): void;
  
  recordPersistentCommandFact?(
    sessionId: string,
    source: "timeline" | "child",
    ack: CommandAck,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  
  admitInputCommand?(
    envelope: CommandEnvelope,
    sessionId: string,
    admission: { admissionSeq: number; admittedAt: number; queueItemId: string },
  ): Promise<ConversationInputIntent | null>;
  cancelInputCommand?(sessionId: string, queueItemId: string, reason: string): Promise<void>;
  discardSharedContext?(sessionId: string, contextId: string): Promise<boolean>;
  
  getInputRoutingMode?(
    sessionId: string,
  ): "startNow" | "enqueue" | "guide" | "reject" | "choice" | null;
  
  waitForProjectionEventCommit?(
    sessionId: string,
    eventId: string,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  
  getMessageIdForRow?(sessionId: string, rowId: number): string | null;
  
  resolveRowActionTarget?(
    sessionId: string,
    target: ConversationRowTarget,
    action: ConversationRowTargetAction,
  ): ConversationRowTargetResolution | null;
  
  getMessageIdsForTurnRow?(sessionId: string, rowId: number): string[];
  
  isLatestAssistantSegmentRow?(sessionId: string, rowId: number): boolean | null;
  
  resolveStableForkTarget?(sessionId: string, rowId: number): Promise<V4StableForkTargetResolution>;
  
  isLatestRetryAssistantRow?(sessionId: string, rowId: number): boolean | null;
  
  isLatestEditableUserRow?(sessionId: string, rowId: number): boolean | null;
  
  getTurnIdForRow?(sessionId: string, rowId: number): string | null;
  
  hasUsableRuntimeModelTarget?(record: V4SessionRecordView): boolean;
  
  getTurnRewindAnchor?(sessionId: string, rowId: number): string | null;
  
  resolveUserMessageIdForRow?(sessionId: string, rowId: number): Promise<string | null>;
  
  resolveTurnUserPrompt?(sessionId: string, assistantMessageId: string): Promise<string | null>;
  
  setAssistantFeedback?(
    sessionId: string,
    input: {
      entityId: string;
      messageId: string;
      feedback: "like" | "dislike" | null;
    },
  ): Promise<void>;
  
  setHighspeedMetrics?(
    sessionId: string,
    input: {
      entityId: string;
      messageId: string;
      metrics: {
        regularTps: number;
        outputTokens: number;
        durationMs: number;
        highspeedTps: number;
        savedDurationMs: number;
        modelDurationMs?: number;
        toolDurationMs?: number;
        otherDurationMs?: number;
      };
    },
  ): Promise<void>;
  
  interactions?: V4InteractionRegistry;

  
  ensureModelReady?(record: V4SessionRecordView): Promise<void>;
  
  ensureProviderAvailable?(
    sessionId: string,
    providerId: string,
  ): Promise<{ available: boolean; reason?: string }>;
  
  afterLegacyStateMutation?(record: V4SessionRecordView, reason: string): Promise<void>;
  
  deleteSession?(sessionId: string): Promise<void>;
  
  createSessionRecord?(params: {
    sessionId?: string;
    additionalDirectories?: string[];
    workspaceId: string;
    permissionScope?: "session";
    mcpServers?: CommandPayloadMap["createSession"]["mcpServers"];
    
    offPeakToolEnabled?: boolean;
    
    dynamicWorkflowEnabled?: boolean;
    
    dynamicWorkflowMode?: DynamicWorkflowMode;
  }): Promise<{ sessionId: string }>;
  
  createSelectionSideSession?(
    sessionId: string,
    options: {
      sourceCommandId: string;
      revisionAtDecision: number;
      modelSelection?: NonNullable<
        CommandPayloadMap["createSelectionSideSession"]["firstInput"]
      >["modelSelection"];
    },
  ): Promise<{ sessionId: string }>;
  
  forkStableConversation?(
    sessionId: string,
    options: {
      target: StableForkTarget;
      goalBoundary: StableForkGoalBoundaryMetadata;
      sourceCommandId: string;
      revisionAtDecision: number;
    },
  ): Promise<{ forkedSessionId: string }>;
  
  forkConversationBeforeInput?(
    sessionId: string,
    options: {
      editTarget: ConversationEditTarget;
      envelope: CommandEnvelope;
      admission: { admissionSeq: number; admittedAt: number; queueItemId: string };
    },
  ): Promise<{ forkedSessionId: string }>;
  
  recordForkStartFailure?(
    sessionId: string,
    envelope: CommandEnvelope,
    error: unknown,
  ): Promise<void>;
}
