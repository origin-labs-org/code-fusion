import { querySessionDebug } from "./session-debug.js";
import { offPeakControlParamsSchema, offPeakControlResultSchema } from "@origin-ai/cf-shared";
import { createNodeNetworkCapture } from "@origin-ai/cf-shared/node";
import { networkCaptureControlSchema, cfProtocolNotifications } from "@origin-ai/cf-shared";
import {
  cfPluginsCancelOperationParamsSchema,
  cfProtocolMethods,
  cfWorkspaceCancelGenerateTextParamsSchema,
  cfWorkspaceHookTrustGrantParamsSchema,
} from "@origin-ai/cf-shared";
import type { BrowserControlPort } from "@origin-ai/cf-contracts";
import type {
  McpElicitationRequest,
  McpElicitationResult,
  McpServerNotification,
} from "@origin-ai/cf-contracts";
import { requestMcpElicitation } from "./interaction-broker.js";
import { InMemoryWorkspaceHookPolicyProvider } from "@origin-ai/cf-core";
import {
  V4_METHODS,
  V4_NOTIFICATIONS,
  parseConversationTopic,
  parseSessionsIndexTopic,
  parseWorkspaceConfigTopic,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import type {
  CfProtocolError,
  CfProtocolMessage,
  CfProtocolMethod,
  CfProtocolNotification,
  CfProtocolRequest,
  CfProtocolRequestId,
  CfProtocolResponse,
} from "@origin-ai/cf-shared";
import {
  cancelBackgroundTask,
  closeSession,
  compactSession,
  createSession,
  forkSession,
  generateWorkspaceText,
  goalSession,
  getTaskTokenUsage,
  getUsageStats,
  listSessions,
  listSessionSubagents,
  readEvents,
  readMessages,
  readSession,
  resumeSession,
  sendPrompt,
  setMode,
  setModel,
  setThoughtLevel,
  stopSession,
  subscribeSession,
} from "./server-operations.js";
import { listChildProcesses } from "./process-child-processes.js";
import { ProtocolRuntimeResources } from "./runtime-resources.js";
import {
  readWorkspacePresentation,
  testProviderModelConnectivity,
} from "./workspace-model-runtime.js";
import {
  addPluginMarketplace,
  configurePlugin,
  describePlugin,
  getPluginsOverview,
  installPlugin,
  listPlugins,
  removePluginMarketplace,
  resetPluginConfig,
  restoreBuiltinPlugin,
  setPluginEnabled,
  uninstallPlugin,
  updatePlugin,
  updatePluginMarketplace,
  validatePlugin,
} from "./plugins.js";
import {
  getPluginReferenceCatalog,
  resolveSuggestedPluginReference,
} from "./plugin-reference-catalog.js";
import { getSkillReferenceCatalog } from "./skill-reference-catalog.js";
import {
  deleteSavedWorkflowOp,
  getSavedWorkflowOp,
  listSavedWorkflowRunsOp,
  listSavedWorkflowsOp,
  moveSavedWorkflowOp,
  updateSavedWorkflowMetaOp,
} from "./saved-workflows.js";
import { findSavedWorkflowForRunOp, saveSavedWorkflowFromRunOp } from "./saved-workflows-run.js";
import { listMcpServers } from "./mcp.js";
import {
  callMcpUiTool,
  sampleMcpUi,
  cancelMcpUiSampling,
  cancelMcpUiToolCall,
  listMcpUiResourceTemplates,
  listMcpUiResources,
  claimMcpUiAppToolCall,
  registerMcpUiAppTools,
  resolveMcpUiAppToolCall,
  unregisterMcpUiAppTools,
  readMcpUiResource,
  readMcpUiResourceForUi,
  routeMcpServerNotification,
  subscribeMcpUiResource,
  unsubscribeMcpUiResource,
} from "./mcp-ui/index.js";
import { listPluginUiSurfaces } from "./plugin-ui-surfaces.js";
import { updateInteractionPreferences } from "./interaction-preferences.js";
import { refreshProviderRegistry, updateAccountProviderConfig } from "./account-provider-config.js";
import { updateModelIoPreferences } from "./model-io-preferences.js";
import { updateOffPeakToolPolicy } from "./off-peak-tool-policy.js";
import { updateDynamicWorkflowPolicy } from "./dynamic-workflow-policy.js";
import { grantWorkspaceHookTrustForProtocol } from "./workspace-hook-trust.js";
import {
  V4InteractionRegistry,
  resolveV4InteractionRegistryOptionsFromEnv,
} from "../cf-protocol-v4/interaction-registry.js";
import { createConversationV4Gateway } from "./v4-bridge.js";
import { createSessionResidentPoolHost } from "./session-residency.js";
import {
  DEFAULT_SESSION_RESIDENT_HIGH_WATER_COUNT,
  SessionResidentPool,
} from "./session-resident-pool.js";
import { createProtocolBrowserControlBroker } from "./browser-control-broker.js";
import {
  createProtocolLogger,
  isErrorResponse,
  isNotification,
  isRequest,
  isResponse,
  PROTOCOL_CLIENT_REQUEST_ERROR_CODES,
  ProtocolRequestError,
  type ParamsSchema,
  parseParams,
  toProtocolError,
  type CfProtocolClientRequestOptions,
  type CfProtocolAgentDependencies,
  type CfProtocolAgentServerContext,
  type CfProtocolSessionRecord,
} from "./server-types.js";
import { createInMemorySessionEventStore } from "@origin-ai/cf-contracts";

export type { CfProtocolAgentDependencies, CfProtocolSessionRecord };

import { closeMcpUiInstance, openMcpUiInstance, validateMcpUiInstance } from "./mcp-ui/index.js";
const MAX_CLIENT_REQUEST_REANNOUNCE_INTERVAL_MS = 10_000;

type CfProtocolOutboundMessage = CfProtocolNotification | CfProtocolRequest;

export async function notifyWorkspaceHookTrustGrantSessions(input: {
  grantedWorkspaceKey?: string;
  sessions: Map<string, CfProtocolSessionRecord>;
}): Promise<void> {
  if (!input.grantedWorkspaceKey) return;
  await Promise.all(
    [...input.sessions.values()]
      .filter((record) => record.workspace.workspaceKey === input.grantedWorkspaceKey)
      .map((record) => record.app.reloadWorkspaceHookTrust()),
  );
}

function collectResidencySessionIds(params: unknown): string[] {
  if (!params || typeof params !== "object") return [];
  const candidate = params as {
    commands?: unknown;
    sessionId?: unknown;
    topic?: unknown;
  };
  const sessionIds = new Set<string>();
  if (typeof candidate.sessionId === "string" && candidate.sessionId.length > 0) {
    sessionIds.add(candidate.sessionId);
  }
  if (typeof candidate.topic === "string") {
    const topicSessionId = parseConversationTopic(candidate.topic);
    if (topicSessionId) sessionIds.add(topicSessionId);
  }
  if (Array.isArray(candidate.commands)) {
    for (const command of candidate.commands) {
      if (!command || typeof command !== "object") continue;
      const sessionId = (command as { sessionId?: unknown }).sessionId;
      if (typeof sessionId === "string" && sessionId.length > 0) {
        sessionIds.add(sessionId);
      }
    }
  }
  return [...sessionIds];
}

function getPluginOperationId(params: unknown): string | undefined {
  if (!params || typeof params !== "object") return undefined;
  const operationId = (params as { operationId?: unknown }).operationId;
  return typeof operationId === "string" && operationId.trim().length > 0
    ? operationId.trim()
    : undefined;
}

function getOperationId(params: unknown): string | undefined {
  if (!params || typeof params !== "object") return undefined;
  const operationId = (params as { operationId?: unknown }).operationId;
  return typeof operationId === "string" && operationId.trim().length > 0
    ? operationId.trim()
    : undefined;
}

export interface CfProtocolPostResponseBatch {
  readonly messages: readonly CfProtocolOutboundMessage[];
  commit(): boolean;
}

interface PendingClientRequest<T> {
  method: string;
  reject: (error: Error) => void;
  resolve: (value: T) => void;
  resultSchema: ParamsSchema<T>;
  requestKeys: Set<string>;
  signal?: AbortSignal;
  timeout?: ReturnType<typeof setTimeout>;
  reannounceTimer?: ReturnType<typeof setTimeout>;
  abortHandler?: () => void;
}

export class CfProtocolAgentServer {
  private readonly networkCapture = createNodeNetworkCapture("cli", (batch) => {
    this.messageSink?.({
      method: cfProtocolNotifications.processNetworkRequests,
      params: batch,
    });
  });
  private readonly runtimeResources: ProtocolRuntimeResources;
  private shutdownPromise?: Promise<void>;
  readonly browserControlPort: BrowserControlPort;
  
  
  requestMcpElicitation(
    request: McpElicitationRequest,
    options?: { signal?: AbortSignal },
  ): Promise<McpElicitationResult> {
    return requestMcpElicitation(this.context, request, options);
  }

  
  handleMcpNotification(notification: McpServerNotification): void {
    routeMcpServerNotification(this.context, notification);
  }

  get officialMcpAuthRequestContext(): Pick<CfProtocolAgentServerContext, "requestClient"> {
    return this.context;
  }

  private messageSink?: (message: CfProtocolOutboundMessage) => void;
  private clientDisconnectError?: Error;
  private readonly context: CfProtocolAgentServerContext;
  private readonly logger;
  private readonly pendingClientRequests = new Map<string, PendingClientRequest<unknown>>();
  private readonly pluginOperationControllers = new Map<string, AbortController>();
  private readonly workspaceGenerateTextControllers = new Map<string, AbortController>();
  
  private readonly postResponseOutbox = new Map<
    CfProtocolRequestId,
    CfProtocolPostResponseBatch
  >();
  private nextClientRequestId = 1;

  constructor(deps: CfProtocolAgentDependencies) {
    this.runtimeResources = new ProtocolRuntimeResources(deps.createCfApp);
    const resolvedDeps = {
      ...deps,
      createCfApp: this.runtimeResources.create,
      createSessionEventStore:
        deps.createSessionEventStore ?? (() => createInMemorySessionEventStore()),
      workspaceHookPolicyProvider:
        deps.workspaceHookPolicyProvider ?? new InMemoryWorkspaceHookPolicyProvider(),
    };
    this.logger = createProtocolLogger(resolvedDeps);
    this.context = {
      assertServing: () => this.runtimeResources.assertServing(),
      deps: resolvedDeps,
      logger: this.logger,
      appRuntimePreferences: {
        askUserQuestionAutoResolutionEnabled: true,
        modelIoFullRetentionEnabled: false,
        offPeakToolEnabled: false,
        dynamicWorkflowEnabled: false,
      },
      notify: (notification) => this.messageSink?.(notification),
      requestClient: (method, params, resultSchema, options) =>
        this.requestClient(method, params, resultSchema, options),
      sessions: new Map<string, CfProtocolSessionRecord>(),
      v4Interactions: new V4InteractionRegistry(
        resolveV4InteractionRegistryOptionsFromEnv(deps.env ?? process.env),
      ),
    };
    this.context.v4Gateway = createConversationV4Gateway(this.context);
    this.browserControlPort = createProtocolBrowserControlBroker(this.context);
    const sessionResidentTargetCount =
      deps.sessionResidentPoolOptions?.targetCount ?? deps.sessionResidentTargetCount;
    const sessionResidentHighWaterCount =
      deps.sessionResidentPoolOptions?.highWaterCount ??
      (sessionResidentTargetCount === undefined
        ? undefined
        : Math.max(DEFAULT_SESSION_RESIDENT_HIGH_WATER_COUNT, sessionResidentTargetCount));
    this.context.sessionResidentPool = new SessionResidentPool(
      createSessionResidentPoolHost(this.context),
      {
        ...deps.sessionResidentPoolOptions,
        highWaterCount: sessionResidentHighWaterCount,
        targetCount: sessionResidentTargetCount,
      },
    );
  }

  
  rebalanceResidentSessions(): void {
    this.context.sessionResidentPool?.rebalance();
  }

  
  pruneSessionEventStores(nowMs: number = Date.now()): number {
    let evicted = 0;
    for (const record of this.context.sessions.values()) {
      evicted += record.eventStore.pruneTransientEvents?.(nowMs) ?? 0;
    }
    return evicted;
  }

  
  pruneDetachedChildPublishers(nowMs: number = Date.now()): number {
    return this.context.v4Gateway?.pruneDetachedChildPublishers(nowMs) ?? 0;
  }

  
  collectMemoryDiagnostics(): Record<string, number> {
    let eventRows = 0;
    let eventEvicted = 0;
    let eventTransientRetained = 0;
    for (const record of this.context.sessions.values()) {
      const stats = record.eventStore.getStats?.();
      eventRows += stats?.events ?? 0;
      eventEvicted += stats?.evictedEvents ?? 0;
      eventTransientRetained += stats?.retainedTransient ?? 0;
    }
    const counters: Record<string, number> = {
      sessions: this.context.sessions.size,
      eventRows,
      eventEvicted,
      eventTransientRetained,
    };
    const v4 = this.context.v4Gateway?.collectMemoryDiagnostics();
    if (v4) {
      for (const [key, value] of Object.entries(v4)) {
        counters[`v4.${key}`] = value;
      }
    }
    return counters;
  }

  setNotificationSink(sink: (message: CfProtocolOutboundMessage) => void): void {
    this.runtimeResources.assertServing();
    this.clientDisconnectError = undefined;
    this.messageSink = sink;
  }

  disconnectClient(error: Error): void {
    this.networkCapture.setCaptureId(null);
    this.clientDisconnectError = error;
    const pendingRequests = new Set(this.pendingClientRequests.values());
    for (const pending of pendingRequests) {
      this.cleanupClientRequest(pending);
      pending.reject(error);
    }
    for (const record of this.context.sessions.values()) {
      try {
        record.app.runtime.stopActiveForegroundExecution?.({
          reason: "CodeFusion Protocol owner disconnected",
        });
      } catch (cause) {
        this.logger?.warn("Failed to stop foreground execution after protocol disconnect", {
          errorType: cause instanceof Error ? cause.name : typeof cause,
          sessionId: record.app.sessionId,
        });
      }
      record.activeAbortController?.abort(error);
    }
    for (const controller of this.workspaceGenerateTextControllers.values()) {
      controller.abort(error);
    }
    this.workspaceGenerateTextControllers.clear();
    for (const controller of this.pluginOperationControllers.values()) {
      controller.abort(error);
    }
    this.pluginOperationControllers.clear();
  }

  
  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = this.runtimeResources.close();
    const error = new Error("CodeFusion Protocol runtime stopping");
    this.disconnectClient(error);
    this.messageSink = undefined;
    this.clearPostResponseMessages();
    for (const controller of this.pluginOperationControllers.values()) controller.abort(error);
    for (const controller of this.workspaceGenerateTextControllers.values())
      controller.abort(error);
    for (const record of this.context.sessions.values()) {
      record.activeAbortController?.abort(error);
      try {
        record.unsubscribe?.();
      } catch {
        this.logger?.warn("Session unsubscribe failed during protocol shutdown", {
          event: "cf_protocol.session.unsubscribe.failed",
        });
      }
    }
    return this.shutdownPromise;
  }

  
  disposeProjections(): void {
    this.context.v4Gateway?.dispose();
    this.context.sessions.clear();
  }

  
  takePostResponseMessages(requestId: CfProtocolRequestId): CfProtocolOutboundMessage[] {
    const batch = this.takePostResponseBatch(requestId);
    batch?.commit();
    return [...(batch?.messages ?? [])];
  }

  
  takePostResponseBatch(requestId: CfProtocolRequestId): CfProtocolPostResponseBatch | null {
    const batch = this.postResponseOutbox.get(requestId) ?? null;
    this.postResponseOutbox.delete(requestId);
    return batch;
  }

  
  clearPostResponseMessages(): void {
    this.postResponseOutbox.clear();
  }

  async handleMessage(
    message: CfProtocolMessage,
  ): Promise<CfProtocolError | CfProtocolResponse | undefined> {
    this.runtimeResources.assertServing();
    if (isResponse(message)) {
      this.resolveClientRequest(message.id, message.result);
      return undefined;
    }
    if (isErrorResponse(message)) {
      this.rejectClientRequest(
        message.id,
        new ProtocolRequestError(message.error.code, message.error.message, message.error.data),
      );
      return undefined;
    }
    if (isRequest(message)) {
      return await this.handleRequest(message);
    }
    if (isNotification(message)) {
      if (message.method === cfProtocolMethods.processNetworkCapture) {
        const control = networkCaptureControlSchema.safeParse(message.params);
        if (control.success) this.networkCapture.setCaptureId(control.data.captureId);
        return undefined;
      }
      this.logger?.debug("CodeFusion Protocol notification ignored", {
        event: "cf_protocol.notification.ignored",
        method: message.method,
        module: "bootstrap.cf_protocol",
      });
    }
    return undefined;
  }

  private async handleRequest(
    request: CfProtocolRequest,
  ): Promise<CfProtocolError | CfProtocolResponse> {
    this.postResponseOutbox.delete(request.id);
    let releaseResidencyOperation: (() => void) | undefined;
    try {
      releaseResidencyOperation = await this.context.sessionResidentPool?.acquireOperation(
        collectResidencySessionIds(request.params),
      );
      const result = await this.dispatchRequest(request);
      return this.ok(request.id, result);
    } catch (error) {
      this.postResponseOutbox.delete(request.id);
      const protocolError = toProtocolError(error);
      return this.fail(request.id, protocolError.code, protocolError.message, protocolError.data);
    } finally {
      releaseResidencyOperation?.();
    }
  }

  private async dispatchRequest(request: CfProtocolRequest) {
    switch (request.method) {
      case V4_METHODS.connectionFlow: {
        this.requireV4Gateway().setConnectionFlowState(request.params);
        return {};
      }
      case V4_METHODS.conversationSubscribe: {
        const gateway = this.requireV4Gateway();
        const topic = (request.params as { topic?: unknown } | null)?.topic;
        let dispatch;
        if (typeof topic === "string" && parseSessionsIndexTopic(topic) !== null) {
          dispatch = await gateway.subscribeSessionsIndexReserved(request.params);
        } else if (typeof topic === "string" && parseWorkspaceConfigTopic(topic) !== null) {
          dispatch = await gateway.subscribeWorkspaceConfigReserved(request.params);
        } else {
          dispatch = await gateway.subscribeReserved(request.params);
        }
        if (dispatch.initialWires.length > 0) {
          this.postResponseOutbox.set(request.id, {
            messages: dispatch.initialWires.map((wire) => ({
              method: V4_NOTIFICATIONS.conversationFrame,
              params: wire,
            })),
            commit: dispatch.commit,
          });
        }
        return { ack: dispatch.ack };
      }
      case V4_METHODS.conversationResync: {
        const dispatch = this.requireV4Gateway().resyncReserved(request.params);
        if (dispatch.initialWires.length > 0) {
          this.postResponseOutbox.set(request.id, {
            messages: dispatch.initialWires.map((wire) => ({
              method: V4_NOTIFICATIONS.conversationFrame,
              params: wire,
            })),
            commit: dispatch.commit,
          });
        }
        return { ack: dispatch.ack };
      }
      case V4_METHODS.conversationUnsubscribe: {
        this.requireV4Gateway().unsubscribe(request.params);
        return {};
      }
      case V4_METHODS.conversationRowsRange:
        return await this.requireV4Gateway().rowsRange(request.params);
      case V4_METHODS.conversationPlans:
        return await this.requireV4Gateway().plans(request.params);
      case V4_METHODS.backgroundBashOutput:
        return await this.requireV4Gateway().backgroundBashOutput(request.params);
      case V4_METHODS.offPeakControl: {
        const params = offPeakControlParamsSchema.parse(request.params);
        const record = this.context.sessions.get(params.sessionId);
        return offPeakControlResultSchema.parse(
          record ? await record.app.runtime.controlOffPeakExecution(params) : { accepted: false },
        );
      }
      case V4_METHODS.conversationFileChanges:
        return await this.requireV4Gateway().fileChanges(request.params);
      case V4_METHODS.conversationFileRewindPreview:
        return await this.requireV4Gateway().fileRewindPreview(request.params);
      case V4_METHODS.conversationWorkflowRunEvents:
        return await this.requireV4Gateway().workflowRunEvents(request.params);
      case V4_METHODS.conversationWorkflowRuns:
        return await this.requireV4Gateway().workflowRuns(request.params);
      case V4_METHODS.conversationWorkflowRunArtifacts:
        return await this.requireV4Gateway().workflowRunArtifacts(request.params);
      case V4_METHODS.conversationWorkflowRunArtifactData:
        return await this.requireV4Gateway().workflowRunArtifactData(request.params);
      case V4_METHODS.conversationWorkflowRunArtifactRead:
        return await this.requireV4Gateway().workflowRunArtifactRead(request.params);
      case V4_METHODS.conversationWorkflowRunWorkspace:
        return await this.requireV4Gateway().workflowRunWorkspace(request.params);
      case V4_METHODS.conversationWorkflowRunNodeResult:
        return await this.requireV4Gateway().workflowRunNodeResult(request.params);
      case V4_METHODS.attachmentBegin:
        return await this.requireV4Gateway().attachmentBegin(request.params);
      case V4_METHODS.attachmentChunk:
        return await this.requireV4Gateway().attachmentChunk(request.params);
      case V4_METHODS.attachmentCommit:
        return await this.requireV4Gateway().attachmentCommit(request.params);
      case V4_METHODS.attachmentAbort:
        await this.requireV4Gateway().attachmentAbort(request.params);
        return {};
      case V4_METHODS.attachmentRead:
        return await this.requireV4Gateway().attachmentRead(request.params);
      case V4_METHODS.conversationAttachmentRead:
        return await this.requireV4Gateway().conversationAttachmentRead(request.params);
      case V4_METHODS.conversationAttachmentStat:
        return await this.requireV4Gateway().conversationAttachmentStat(request.params);
      case V4_METHODS.attachmentPreviewSource:
        return await this.requireV4Gateway().attachmentPreviewSource(request.params);
      case V4_METHODS.usageStats:
        return await getUsageStats(this.context, request.params);
      case V4_METHODS.conversationUsage:
        return await getTaskTokenUsage(this.context, request.params);
      case V4_METHODS.command:
        return this.requireV4Gateway().handleCommand(request.params);
      case V4_METHODS.commandsQuery:
        return this.requireV4Gateway().queryCommands(request.params);
      case V4_METHODS.sessionsIndexReconcile:
        return this.requireV4Gateway().reconcileSessions(request.params);
      case cfProtocolMethods.sessionCreate:
        return await createSession(this.context, request.params, request.trace);
      case cfProtocolMethods.sessionResume:
        return await resumeSession(this.context, request.params);
      case cfProtocolMethods.sessionList:
        return await listSessions(this.context, request.params);
      case cfProtocolMethods.sessionSubagents:
        return await listSessionSubagents(this.context, request.params);
      case cfProtocolMethods.sessionRead:
        return await readSession(this.context, request.params);
      case cfProtocolMethods.sessionMessages:
        return await readMessages(this.context, request.params);
      case cfProtocolMethods.sessionEvents:
        return await readEvents(this.context, request.params);
      case cfProtocolMethods.sessionSubscribe:
        return await subscribeSession(this.context, request.params);
      case cfProtocolMethods.sessionSend:
        return await sendPrompt(this.context, request.params);
      case cfProtocolMethods.sessionStop:
        return await stopSession(this.context, request.params);
      case cfProtocolMethods.sessionCancelBackgroundTask:
        return await cancelBackgroundTask(this.context, request.params);
      case cfProtocolMethods.sessionFork:
        return await forkSession(this.context, request.params);
      case cfProtocolMethods.sessionCompact:
        return await compactSession(this.context, request.params);
      case cfProtocolMethods.sessionGoal:
        return await goalSession(this.context, request.params);
      case cfProtocolMethods.sessionSetModel:
        return await setModel(this.context, request.params);
      case cfProtocolMethods.sessionSetThoughtLevel:
        return await setThoughtLevel(this.context, request.params);
      case cfProtocolMethods.sessionSetMode:
        return await setMode(this.context, request.params);
      case cfProtocolMethods.sessionClose:
        return await closeSession(this.context, request.params);
      case cfProtocolMethods.workspaceReadPresentation:
        return await readWorkspacePresentation(this.context, request.params);
      case cfProtocolMethods.workspaceHookTrustGrant: {
        const grantResult = await grantWorkspaceHookTrustForProtocol(request.params, {
          appVersion: this.context.deps.version,
          policyProvider: this.context.deps.workspaceHookPolicyProvider,
        });
        if (grantResult.accepted) {
          await notifyWorkspaceHookTrustGrantSessions({
            grantedWorkspaceKey: cfWorkspaceHookTrustGrantParamsSchema.safeParse(request.params)
              .success
              ? cfWorkspaceHookTrustGrantParamsSchema.parse(request.params).workspace
                  .workspaceKey
              : undefined,
            sessions: this.context.sessions,
          });
        }
        return grantResult;
      }
      case cfProtocolMethods.providerUpdateAccountConfig:
        return await updateAccountProviderConfig(this.context, request.params);
      case cfProtocolMethods.providerRefreshRegistry:
        return await refreshProviderRegistry(this.context, request.params);
      case cfProtocolMethods.workspaceUpdateInteractionPreferences:
        return await updateInteractionPreferences(this.context, request.params);
      case cfProtocolMethods.workspaceUpdateModelIoPreferences:
        return await updateModelIoPreferences(this.context, request.params);
      case cfProtocolMethods.workspaceUpdateOffPeakToolPolicy:
        return await updateOffPeakToolPolicy(this.context, request.params);
      case cfProtocolMethods.workspaceUpdateDynamicWorkflowPolicy:
        return await updateDynamicWorkflowPolicy(this.context, request.params);
      case cfProtocolMethods.workspaceGenerateText:
        return await this.withWorkspaceGenerateTextSignal(request, (signal) =>
          generateWorkspaceText(this.context, request.params, signal),
        );
      case cfProtocolMethods.workspaceCancelGenerateText:
        return this.cancelWorkspaceGenerateText(request.params);
      case cfProtocolMethods.providerTestModelConnectivity:
        return await testProviderModelConnectivity(this.context, request.params);
      case cfProtocolMethods.mcpList:
        return await listMcpServers(this.context, request.params);
      case cfProtocolMethods.mcpReadResource:
        return await readMcpUiResource(this.context, request.params);
      case cfProtocolMethods.mcpUiOpenInstance:
        return openMcpUiInstance(this.context, request.params);
      case cfProtocolMethods.mcpUiValidateInstance:
        return validateMcpUiInstance(this.context, request.params);
      case cfProtocolMethods.mcpUiCloseInstance:
        return closeMcpUiInstance(this.context, request.params);
      case cfProtocolMethods.mcpUiSampling:
        return sampleMcpUi(this.context, request.params);
      case cfProtocolMethods.mcpUiCancelSampling:
        return cancelMcpUiSampling(this.context, request.params);
      case cfProtocolMethods.mcpUiCallTool:
        return await callMcpUiTool(this.context, request.params);
      case cfProtocolMethods.mcpUiCancelCall:
        return await cancelMcpUiToolCall(this.context, request.params);
      case cfProtocolMethods.mcpUiReadResource:
        return await readMcpUiResourceForUi(this.context, request.params);
      case cfProtocolMethods.mcpUiListResources:
        return await listMcpUiResources(this.context, request.params);
      case cfProtocolMethods.mcpUiListResourceTemplates:
        return await listMcpUiResourceTemplates(this.context, request.params);
      case cfProtocolMethods.mcpUiSubscribeResource:
        return await subscribeMcpUiResource(this.context, request.params);
      case cfProtocolMethods.mcpUiUnsubscribeResource:
        return await unsubscribeMcpUiResource(this.context, request.params);
      case cfProtocolMethods.mcpUiRegisterAppTools:
        return await registerMcpUiAppTools(this.context, request.params);
      case cfProtocolMethods.mcpUiUnregisterAppTools:
        return await unregisterMcpUiAppTools(this.context, request.params);
      case cfProtocolMethods.mcpUiClaimAppToolCall:
        return await claimMcpUiAppToolCall(this.context, request.params);
      case cfProtocolMethods.mcpUiResolveAppToolCall:
        return await resolveMcpUiAppToolCall(this.context, request.params);
      case cfProtocolMethods.pluginsList:
        return await listPlugins(this.context, request.params);
      case cfProtocolMethods.pluginsReferenceCatalogWithCategory:
        return await getPluginReferenceCatalog(this.context, request.params, true);
      case cfProtocolMethods.pluginsReferenceCatalog:
        return await getPluginReferenceCatalog(this.context, request.params);
      case cfProtocolMethods.pluginsListUiSurfaces:
        return await listPluginUiSurfaces(this.context, request.params);
      case cfProtocolMethods.skillsReferenceCatalog:
        return await getSkillReferenceCatalog(this.context, request.params);
      case cfProtocolMethods.workflowsList:
        return await listSavedWorkflowsOp(this.context, request.params);
      case cfProtocolMethods.workflowsGet:
        return await getSavedWorkflowOp(this.context, request.params);
      case cfProtocolMethods.workflowsUpdateMeta:
        return await updateSavedWorkflowMetaOp(this.context, request.params);
      case cfProtocolMethods.workflowsDelete:
        return await deleteSavedWorkflowOp(this.context, request.params);
      case cfProtocolMethods.workflowsRuns:
        return await listSavedWorkflowRunsOp(this.context, request.params);
      case cfProtocolMethods.workflowsMove:
        return await moveSavedWorkflowOp(this.context, request.params);
      case cfProtocolMethods.workflowsSave:
        return await saveSavedWorkflowFromRunOp(this.context, request.params);
      case cfProtocolMethods.workflowsForRun:
        return await findSavedWorkflowForRunOp(this.context, request.params);
      case cfProtocolMethods.pluginsResolveSuggestedReference:
        return await this.withPluginOperationSignal(request, (signal) =>
          resolveSuggestedPluginReference(this.context, request.params, signal),
        );
      case cfProtocolMethods.pluginsSetEnabled:
        return await this.withPluginOperationSignal(request, (signal) =>
          setPluginEnabled(this.context, request.params, signal),
        );
      case cfProtocolMethods.pluginsOverview:
        return await getPluginsOverview(this.context, request.params);
      case cfProtocolMethods.processChildProcesses:
        return listChildProcesses(this.context.deps.mcpTelemetry?.listProcesses() ?? []);
      case cfProtocolMethods.runtimeCapabilities:
        return { independentPlanState: true, historyFirst: true };
      case cfProtocolMethods.pluginsMarketplaceAdd:
        return await this.withPluginOperationSignal(request, (signal) =>
          addPluginMarketplace(this.context, request.params, signal),
        );
      case cfProtocolMethods.pluginsMarketplaceRemove:
        return await removePluginMarketplace(this.context, request.params);
      case cfProtocolMethods.pluginsMarketplaceUpdate:
        return await this.withPluginOperationSignal(request, (signal) =>
          updatePluginMarketplace(this.context, request.params, signal),
        );
      case cfProtocolMethods.pluginsInstall:
        return await this.withPluginOperationSignal(request, (signal) =>
          installPlugin(this.context, request.params, signal),
        );
      case cfProtocolMethods.pluginsCancelOperation:
        return this.cancelPluginOperation(request.params);
      case cfProtocolMethods.pluginsUninstall:
        return await uninstallPlugin(this.context, request.params);
      case cfProtocolMethods.pluginsUpdate:
        return await updatePlugin(this.context, request.params);
      case cfProtocolMethods.pluginsRestoreBuiltin:
        return await restoreBuiltinPlugin(this.context, request.params);
      case cfProtocolMethods.pluginsConfigure:
        return await configurePlugin(this.context, request.params);
      case cfProtocolMethods.pluginsResetConfig:
        return await resetPluginConfig(this.context, request.params);
      case cfProtocolMethods.pluginsValidate:
        return await validatePlugin(this.context, request.params);
      case cfProtocolMethods.pluginsDescribe:
        return await describePlugin(this.context, request.params);
      case cfProtocolMethods.usageStats:
        return await getUsageStats(this.context, request.params);
      case cfProtocolMethods.sessionDebug:
        return querySessionDebug(this.context, request.params);
      case cfProtocolMethods.sessionUsage:
        return await getTaskTokenUsage(this.context, request.params);
      default:
        throw new ProtocolRequestError(-32601, `Method not found: ${request.method}`);
    }
  }

  private requireV4Gateway() {
    if (!this.context.v4Gateway) {
      throw new ProtocolRequestError(-32603, "v4 gateway is not initialized");
    }
    return this.context.v4Gateway;
  }

  private async withPluginOperationSignal<T>(
    request: CfProtocolRequest,
    run: (signal?: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const operationId = getPluginOperationId(request.params);
    if (!operationId) return await run();

    const controller = new AbortController();
    this.pluginOperationControllers.set(operationId, controller);
    try {
      return await run(controller.signal);
    } finally {
      if (this.pluginOperationControllers.get(operationId) === controller) {
        this.pluginOperationControllers.delete(operationId);
      }
    }
  }

  private cancelPluginOperation(rawParams: unknown) {
    const params = parseParams(cfPluginsCancelOperationParamsSchema, rawParams);
    const controller = this.pluginOperationControllers.get(params.operationId);
    if (!controller) return { operationId: params.operationId, cancelled: false };
    controller.abort();
    this.pluginOperationControllers.delete(params.operationId);
    return { operationId: params.operationId, cancelled: true };
  }

  private async withWorkspaceGenerateTextSignal<T>(
    request: CfProtocolRequest,
    run: (signal?: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const operationId = getOperationId(request.params);
    if (!operationId) return await run();

    if (this.workspaceGenerateTextControllers.has(operationId)) {
      throw new ProtocolRequestError(
        -32600,
        `Workspace generate operation is already active: ${operationId}`,
      );
    }

    const controller = new AbortController();
    this.workspaceGenerateTextControllers.set(operationId, controller);
    try {
      return await run(controller.signal);
    } finally {
      if (this.workspaceGenerateTextControllers.get(operationId) === controller) {
        this.workspaceGenerateTextControllers.delete(operationId);
      }
    }
  }

  private cancelWorkspaceGenerateText(rawParams: unknown) {
    const params = parseParams(cfWorkspaceCancelGenerateTextParamsSchema, rawParams);
    const controller = this.workspaceGenerateTextControllers.get(params.operationId);
    if (!controller) return { operationId: params.operationId, cancelled: false };
    controller.abort(new DOMException("Workspace model request cancelled", "AbortError"));
    this.workspaceGenerateTextControllers.delete(params.operationId);
    return { operationId: params.operationId, cancelled: true };
  }

  private ok(id: CfProtocolRequestId, result: unknown): CfProtocolResponse {
    return { id, result };
  }

  private fail(
    id: CfProtocolRequestId,
    code: number,
    message: string,
    data?: unknown,
  ): CfProtocolError {
    return { error: { code, data, message }, id };
  }

  private requestClient<T>(
    method: CfProtocolMethod,
    params: unknown,
    resultSchema: ParamsSchema<T>,
    options?: CfProtocolClientRequestOptions,
  ): Promise<T> {
    if (this.clientDisconnectError) {
      throw this.clientDisconnectError;
    }
    if (!this.messageSink) {
      throw new ProtocolRequestError(
        PROTOCOL_CLIENT_REQUEST_ERROR_CODES.noClientAttached,
        `No CodeFusion Protocol client is attached for ${method}`,
      );
    }

    return new Promise<T>((resolve, reject) => {
      let active = true;
      const pending: PendingClientRequest<T> = {
        method,
        reject,
        resolve,
        resultSchema,
        requestKeys: new Set(),
        signal: options?.signal,
      };
      const cleanup = () => {
        active = false;
        this.cleanupClientRequest(pending);
      };
      pending.abortHandler = () => {
        cleanup();
        reject(
          new ProtocolRequestError(
            PROTOCOL_CLIENT_REQUEST_ERROR_CODES.cancelled,
            `Client request cancelled: ${method}`,
          ),
        );
      };
      if (options?.signal?.aborted) {
        pending.abortHandler();
        return;
      }
      if (options?.timeoutMs !== undefined) {
        pending.timeout = setTimeout(() => {
          cleanup();
          reject(
            new ProtocolRequestError(
              PROTOCOL_CLIENT_REQUEST_ERROR_CODES.timedOut,
              `Client request timed out: ${method}`,
              {
              timeoutMs: options.timeoutMs,
              },
            ),
          );
        }, options.timeoutMs);
      }
      options?.signal?.addEventListener("abort", pending.abortHandler, { once: true });
      const sendClientRequest = () => {
        if (!active) {
          return;
        }
        const id = `server-${this.nextClientRequestId++}`;
        const key = String(id);
        pending.requestKeys.add(key);
        this.pendingClientRequests.set(key, pending as PendingClientRequest<unknown>);
        this.messageSink?.({
          id,
          method,
          params,
          ...(options?.trace ? { trace: options.trace } : {}),
        });
      };
      sendClientRequest();
      const reannounceIntervalMs =
        options?.reannounceIntervalMs !== undefined &&
        Number.isFinite(options.reannounceIntervalMs) &&
        options.reannounceIntervalMs > 0
          ? Math.floor(options.reannounceIntervalMs)
          : undefined;
      if (reannounceIntervalMs !== undefined) {
        let nextReannounceIntervalMs = reannounceIntervalMs;
        const scheduleReannounce = () => {
          pending.reannounceTimer = setTimeout(() => {
            if (!active) {
              return;
            }
            sendClientRequest();
            nextReannounceIntervalMs = Math.min(
              nextReannounceIntervalMs * 2,
              MAX_CLIENT_REQUEST_REANNOUNCE_INTERVAL_MS,
            );
            scheduleReannounce();
          }, nextReannounceIntervalMs);
        };
        scheduleReannounce();
      }
    });
  }

  private resolveClientRequest(id: CfProtocolRequestId, result: unknown): void {
    const key = String(id);
    const pending = this.pendingClientRequests.get(key);
    if (!pending) {
      return;
    }
    this.cleanupClientRequest(pending);
    try {
      pending.resolve(pending.resultSchema.parse(result));
    } catch (error) {
      pending.reject(
        error instanceof Error ? error : new Error(`Invalid response: ${pending.method}`),
      );
    }
  }

  private rejectClientRequest(id: CfProtocolRequestId, error: Error): void {
    const key = String(id);
    const pending = this.pendingClientRequests.get(key);
    if (!pending) {
      return;
    }
    this.cleanupClientRequest(pending);
    pending.reject(error);
  }

  private cleanupClientRequest<T>(pending: PendingClientRequest<T>): void {
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    if (pending.reannounceTimer) {
      clearTimeout(pending.reannounceTimer);
    }
    if (pending.abortHandler) {
      pending.signal?.removeEventListener("abort", pending.abortHandler);
    }
    for (const requestKey of pending.requestKeys) {
      this.pendingClientRequests.delete(requestKey);
    }
    pending.requestKeys.clear();
  }
}
