import { ServiceChannels } from "@origin-ai/cf-shared";
import type {
  TraceId,
  CfAgentMcpServer,
  CfDeliveryKind,
  CfMessageWithParts,
  ModelSelection,
  CfPermissionRequestParams,
  CfProviderRuntimeHeadersRequestParams,
  CfUserInputRequestParams,
  CfUserInputResponse,
  CfSessionInfo,
  CfSessionImportHistory,
  CfSessionEvent,
  CfSessionMode,
  CfSessionPersistence,
  CfSessionStateSnapshot,
  CfStateUpdatedNotification,
  CfWorkspacePresentation,
} from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "#src/descriptors.js";
import type { ProviderRuntimeHeadersUiResponse } from "#src/cf-agent/cfAgent.js";

export interface CfSessionWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}

export type CfSessionReadWorkspacePresentationParams = CfSessionWorkspaceTarget;

export interface CfTaskTarget extends CfSessionWorkspaceTarget {
  sessionId: string;
}

export interface CfSessionCreateParams extends CfSessionWorkspaceTarget {
  
  sessionId?: string;
  sessionTraceId?: TraceId;
  parentSessionId?: string;
  mode?: CfSessionMode;
  model?: ModelSelection;
  persistence?: CfSessionPersistence;
  thoughtLevel?: string;
  mcpServers?: CfAgentMcpServer[];
  importedHistory?: CfSessionImportHistory;
}

export interface CfSessionResumeParams extends CfTaskTarget {
  model?: ModelSelection;
  thoughtLevel?: string;
  mcpServers?: CfAgentMcpServer[];
  
  broadcastSnapshot?: boolean;
}

export interface CfSessionListParams extends CfSessionWorkspaceTarget {
  limit?: number;
}

export interface CfSessionReadParams extends CfTaskTarget {
  deliveryKind?: CfDeliveryKind;
  messageLimit?: number;
  afterSeq?: number;
}

export interface CfSessionMessagesParams extends CfTaskTarget {
  afterMessageId?: string;
  limit?: number;
}

export interface CfSessionEventsParams extends CfTaskTarget {
  afterSeq?: number;
  limit?: number;
}

export interface CfSessionSetModelParams extends CfTaskTarget {
  model: ModelSelection;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface CfSessionSetThoughtLevelParams extends CfTaskTarget {
  thoughtLevel?: string;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface CfSessionSetModeParams extends CfTaskTarget {
  mode: CfSessionMode;
  expectedRevision?: number;
}

export interface CfSessionRespondProviderRuntimeHeadersParams extends CfTaskTarget {
  requestId: string;
  response: ProviderRuntimeHeadersUiResponse;
}

export interface CfSessionSubscribeParams extends CfTaskTarget {
  deliveryKind: CfDeliveryKind;
  afterSeq?: number;
  includeSnapshot?: boolean;
  eventCoalescing?: {
    mode: "background-summary";
    intervalMs?: number;
  };
}

export type CfSessionServiceEvent =
  | { type: "session.event"; event: CfSessionEvent }
  | { type: "state.updated"; notification: CfStateUpdatedNotification }
  | { type: "permission.request"; request: CfPermissionRequestParams }
  | { type: "userInput.request"; request: CfUserInputRequestParams }
  | {
      type: "userInput.response";
      requestId: string;
      response: CfUserInputResponse;
    }
  | { type: "providerRuntimeHeaders.request"; request: CfProviderRuntimeHeadersRequestParams }
  | { type: "snapshot"; snapshot: CfSessionStateSnapshot };

export interface CfSessionInitializeResult {
  available: boolean;
  workspaceKey: string;
  protocolName?: string;
  protocolVersion?: number;
  transportKind?: "stdio" | "websocket";
  reason?: string;
  reasonCode?: "provider_not_ready";
}

export interface CfSessionWorkspaceRuntimeIdentity {
  generation: number;
  identity: string;
  processId?: number;
  workspaceKey: string;
}

export interface ICfSessionService {
  initializeWorkspace(params: CfSessionWorkspaceTarget): Promise<CfSessionInitializeResult>;
  getWorkspaceRuntimeIdentity(
    params: CfSessionWorkspaceTarget,
  ): Promise<CfSessionWorkspaceRuntimeIdentity>;
  readWorkspacePresentation(
    params: CfSessionReadWorkspacePresentationParams,
  ): Promise<CfWorkspacePresentation>;
  createSession(params: CfSessionCreateParams): Promise<CfSessionStateSnapshot>;
  resumeSession(params: CfSessionResumeParams): Promise<CfSessionStateSnapshot>;
  listSessions(params: CfSessionListParams): Promise<CfSessionInfo[]>;
  readSession(params: CfSessionReadParams): Promise<CfSessionStateSnapshot>;
  readSessionMessages(params: CfSessionMessagesParams): Promise<CfMessageWithParts[]>;
  readSessionEvents(params: CfSessionEventsParams): Promise<CfSessionEvent[]>;
  promoteDeferredDraftSession(params: CfTaskTarget): Promise<void>;
  closeSession(params: CfTaskTarget): Promise<void>;
  closeDeferredDraftSession(params: CfTaskTarget): Promise<boolean>;
  setModel(params: CfSessionSetModelParams): Promise<CfSessionStateSnapshot>;
  setThoughtLevel(params: CfSessionSetThoughtLevelParams): Promise<CfSessionStateSnapshot>;
  setMode(params: CfSessionSetModeParams): Promise<CfSessionStateSnapshot>;
  respondProviderRuntimeHeaders(
    params: CfSessionRespondProviderRuntimeHeadersParams,
  ): Promise<void>;
}

export const ICfSessionService = createServiceDescriptor<ICfSessionService>(
  ServiceChannels.CfSession,
);
