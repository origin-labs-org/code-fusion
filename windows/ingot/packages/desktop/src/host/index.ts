import { normalizeRemoteConnectionError, sanitizeRemoteConnectionLog } from "@origin-ai/cf-shared";

import { createHostDatabaseStartup } from "./database-startup/hostDatabaseStartup.js";
import { isOffPeakTerminalStatus } from "@origin-ai/cf-shared";
import { createHostNetworkCapture } from "./hostNetworkCapture.js";
import { randomUUID } from "node:crypto";
import { createPluginSandboxRegistrationBridge } from "./pluginSandbox/index.js";
import { createWindowTopicResourceRelay } from "./windowTopicResourceRelay.js";
import {
  MessagePortProtocol,
  ChannelServer,
  type IDisposable,
  type IChannelServer,
  LoggingChannelServer,
  NetworkTelemetryChannelServer,
} from "@origin-ai/cf-rpc";
import { registerHostNetworkTelemetry, stopHostNetworkTelemetry } from "./hostNetworkTelemetry.js";
import { registerHostServiceResourceTelemetry } from "./hostServiceResourceTelemetry.js";
import { resolveResourceTelemetryEnvironmentKey } from "./hostResourceTelemetryEnvironment.js";
import { reportHostSessionCreate } from "./hostSessionCreateTelemetry.js";
import { createBrowserControlMainBridge } from "./browserControlMainBridge.js";
import { materializeBrowserRecordingArtifact } from "./browserRecordingArtifactMaterializer.js";
import {
  ServiceCollection,
  IBotsService,
  ICredentialService,
  IFileService,
  IClientConfigService,
  IMediaPreviewService,
  IOffPeakTaskService,
  IRemoteProjectService,
  type RemoteProjectHost,
  IProjectService,
  ITaskGroupService,
  IBroadcastService,
  IModelSelectionService,
  ISettingService,
  ISourceServerManagementService,
  IWindowControllerService,
  IConversationShareService,
  IPromptAttachmentTransferService,
  ICfAgentService,
  ICfTaskService,
  ICfSessionService,
  ICuaPipSessionService,
  createCfAgentConnectionScope,
  type CfAgentV4ClientMode,
  collectServiceMemoryDiagnostics,
} from "@origin-ai/cf-services";
import {
  createLocalServices,
  createProjectWorkspaceNavigation,
  createRemoteProjectConnectionAdmission,
  remoteProjectHostIdForProfile,
  remoteProjectHostIdForTarget,
  prepareRemoteServerConnection,
  bindRemoteProjectIdentities,
  getOffPeakRequestAuthBuilder,
  disposeServiceResources,
  disposeServiceResourcesAndWait,
  AutomationRepo,
  OffPeakTaskRepo,
  OffPeakTaskService,
  createServiceLogger,
  buildTaskChangeSummary,
  createHostApiNetworkTransport,
  createSettingServiceWithMigrations,
  OffPeakModelUnavailableError,
  OffPeakPermanentDispatchError,
  type BotProjectConnection,
  type HostApiNetworkTransport,
  type OffPeakRequestAuthBuilder,
} from "@origin-ai/cf-services/node";
import { createHostResourceUsageResponder } from "./hostResourceUsage.js";
import {
  assertBoundSessionDispatchable,
  resolveOffPeakDispatchKind,
} from "./offPeakDispatchPlan.js";
import {
  HostMessageTypes,
  HostResponseTypes,
  formatLogPrefix,
  formatCfHostProcessName,
  formatZodError,
  buildRemoteWorkspaceIdentity,
  buildServerRemoteWorkspaceIdentity,
  remoteHostIdFromWorkspaceIdentity,
  buildRemoteEnvironmentKey,
  isRemoteWorkspaceIdentity,
  parseRemoteWorkspaceIdentity,
  buildRemoteHostWorkspaceIdentity,
  resolveWorkspaceKey,
  REMOTE_BIND_CANCELED_ERROR_CODE,
  REMOTE_WORKSPACE_BIND_SESSION_MISSING_ERROR_CODE,
  formatModelPickerValue,
  type CfPromptAttachment,
  type CfStreamEvent,
  type CfTaskMeta,
  type TaskStreamMirrorableEvent,
  type TraceId,
  type CfTaskMode,
  type WindowHostAttachmentScope,
  type SourceServerArtifactPolicy,
  type CfAutomation,
  type CfAutomationRun,
  type CfAutomationRunOutcome,
  type ModelSelection,
} from "@origin-ai/cf-shared";
import {
  parseHostIncomingMessageEvent,
  rejectUnavailableAttachedServicePort,
} from "./hostMessagePortGuard.js";
import type { IRemoteBackend } from "@origin-ai/cf-server/remote";
import type { Locale, RemoteTarget } from "@origin-ai/cf-shared";
import { wrapElectronPort } from "./electronPort.js";
import { createTaskRealtimeBridgeForHostInit } from "./taskRealtimeBridge.js";
import { resolveRpcLogLevel } from "./rpcLogLevel.js";
import { createHostWorkspaceTaskTracker } from "./hostWorkspaceTaskTracker.js";
import {
  createRemoteMediaPreviewProxy,
  type RemoteMediaPreviewProxy,
} from "./remoteMediaPreviewProxy.js";
import { watchCronRunBotDelivery } from "./cronBotDelivery.js";
import { createHostRemoteWorkspaceProxyState } from "./hostRemoteWorkspaceProxyState.js";
import {
  createServerRemoteWorkspaceServiceCollection,
  resolveServerProjectService,
} from "./remoteWorkspaceServiceCollection.js";
import { getRemoteProviderProvisioningExecutor } from "./remoteProviderProvisioningService.js";
import {
  createSourceSettingsServiceCollection,
  shouldDetachSourceSettingsAttachment,
} from "./sourceSettingsServiceCollection.js";
import { shouldReportHostConsoleError, stringifyHostLogArg } from "./hostLog.js";
import { flushHostE2ECoverage } from "./e2eCoverage.js";
import { runHostShutdownPhases, type HostShutdownResult } from "./hostShutdownPhases.js";
import { initializeHostApiNetworkTransportOwner } from "./hostInitialization.js";
import { createHostUncaughtExceptionHandler } from "./hostUncaughtExceptionGuard.js";
import {
  recordCronRunOutcomeBestEffort,
  startManualClaimHeartbeat,
  settleCronRunTerminalOutcome,
  settleManualDispatchFailureBestEffort,
} from "./cronRunLifecycle.js";
import { connectServerRemote, type ServerRemoteConnection } from "./serverRemoteConnection.js";
import { bindBotGroupTaskScope } from "./botGroupTaskScope.js";
import { createWindowHostAttachmentRegistry } from "./windowHostAttachmentRegistry.js";
import { exposeWindowHostAttachmentServices } from "./windowHostAttachmentRpcPolicy.js";
import { scopeConversationShareServiceForAttachment } from "./conversationShareAttachmentService.js";
import {
  createWindowRemoteConnectionRegistry,
  type WindowRemoteConnectionCloseEvent,
  type WindowRemoteConnectionHandle,
} from "./windowRemoteConnectionRegistry.js";
import { pushDynamicWorkflowUserModeToRemoteHosts } from "./remoteDynamicWorkflowUserMode.js";
import { connectDesktopSourceServer } from "./connectDesktopSourceServer.js";
import { prepareRemoteWorkspaceIdentity } from "./remoteWorkspacePreparation.js";
import { createWindowHostControllerRuntime } from "./windowHostControllerService.js";
import { resolveBotRemoteWorkspace } from "./botRemoteWorkspaceResolver.js";
import { SourceServerDirectory } from "./sourceServerDirectory.js";
import { connectSourceServerTarget } from "./connectSourceServerTarget.js";
import {
  SourceServerConnectionManager,
  SourceServerInstallRequiredError,
  SourceServerUpgradeRequiredError,
} from "./sourceServerConnectionManager.js";
import { createSourceServerRecoveryCloseEvent } from "./sourceServerRecoveryPolicy.js";
import { runStartupReconnectBatch } from "./sourceServerStartupReconnect.js";
import {
  createSourceServerManagementService,
  type SourceServerManagementService,
} from "./sourceServerManagementService.js";
import { resolveSourceServerReleaseAsset } from "./sourceServerReleaseResolver.js";
import { resolveAutomationSubmissionModelSelection } from "./automationModelSelection.js";
import { createRemoteConnectionProgressContext } from "@origin-ai/cf-server/remote/remoteConnectionProgressContext.js";
import {
  createRemotePromptAttachmentTransferService,
  type RemotePromptAttachmentTransferService,
} from "./promptAttachmentTransferService.js";
import { startHostSelfResourceTelemetry } from "./hostSelfResourceTelemetry.js";
type HostRemoteConnection = ServerRemoteConnection;
interface HostRemoteConnectionCapabilities {
  promptAttachmentTransferFactory?: (
    scope: Extract<WindowHostAttachmentScope, { kind: "remote" }>,
  ) => RemotePromptAttachmentTransferService;
  browserRecordingUploader?: Pick<IRemoteBackend, "upload">;
  remoteMediaPreviewFactory?: (
    scope: Extract<WindowHostAttachmentScope, { kind: "remote" }>,
  ) => RemoteMediaPreviewProxy;
  sourceServerId?: string;
  persistentSourceConnection?: boolean;
  
  physicalOwner?: () => object;
  profileId?: string;
  recordWorkspaceOpen?: (input: {
    workspacePath: string;
    workspaceIdentity: string;
    workspacePurpose?: import("@origin-ai/cf-shared").WorkspacePurpose;
    legacyWorkspaceIdentity?: string;
    signal?: AbortSignal;
  }) => Promise<void>;
  bindWorkspaceIdentity?: (input: {
    workspacePath: string;
    stableWorkspaceIdentity: string;
    legacyRouteHint?: string;
    signal?: AbortSignal;
  }) => Promise<void>;
}

let activeRemoteMediaRequests = 0;
const hostRemoteMediaRequestLimiter = {
  tryAcquire: () => {
    if (activeRemoteMediaRequests >= 4) return false;
    activeRemoteMediaRequests += 1;
    return true;
  },
  release: () => {
    activeRemoteMediaRequests = Math.max(0, activeRemoteMediaRequests - 1);
  },
  getState: () => ({ active: activeRemoteMediaRequests, limit: 4 }),
};
const remoteMediaRangePreviewEnabled =
  process.env["CF_REMOTE_MEDIA_RANGE_PREVIEW_ENABLED"] !== "0";

type RemoteAssetDirs = import("./windowRemoteConnectionRegistry.js").WindowRemoteAssetDirs;

const { parentPort } = process;
const hostNetworkCapture = createHostNetworkCapture(parentPort);

process.title = formatCfHostProcessName(process.env["CF_PROCESS_LABEL"]);

type HostLogLevel = "info" | "warn" | "error";

interface PendingFeedbackLogArchiveRequest {
  resolve: (archive: { path: string; size: number }) => void;
  reject: (error: Error) => void;
  onProgress?: (event: { processedBytes: number; totalBytes: number }) => void;
}

interface PendingLocalMediaPreviewPathAuthorization {
  resolve: (path: string) => void;
  reject: (error: Error) => void;
}

const pendingFeedbackLogArchiveRequests = new Map<string, PendingFeedbackLogArchiveRequest>();
let nextFeedbackLogArchiveRequestSeq = 0;
const pendingLocalMediaPreviewPathAuthorizations = new Map<
  string,
  PendingLocalMediaPreviewPathAuthorization
>();

function authorizeLocalMediaPreviewPath(path: string): Promise<string> {
  if (!parentPort) {
    return Promise.reject(new Error("parentPort unavailable"));
  }
  const requestId = randomUUID();
  return new Promise<string>((resolve, reject) => {
    pendingLocalMediaPreviewPathAuthorizations.set(requestId, { resolve, reject });
    try {
      parentPort.postMessage({
        type: HostResponseTypes.LocalMediaPreviewPathAuthorizeRequest,
        requestId,
        path,
      });
    } catch (error) {
      pendingLocalMediaPreviewPathAuthorizations.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

const pluginSandboxRegistrationBridge = createPluginSandboxRegistrationBridge({
  send: (message) => {
    if (!parentPort) throw new Error("parentPort unavailable");
    parentPort.postMessage(message);
  },
});

const browserControlMainBridge = createBrowserControlMainBridge({
  postToMain: (message) => {
    if (!parentPort) {
      throw new Error("parentPort unavailable");
    }
    parentPort.postMessage(message);
  },
  materializeRecording: (input) => {
    let remoteBackend: Pick<IRemoteBackend, "upload"> | undefined;
    if (input.remoteSessionId) {
      const workspaceIdentity = input.workspaceIdentity;
      if (!workspaceIdentity?.trim()) {
        throw new Error("remote Browser recording materialization requires workspaceIdentity");
      }
      remoteBackend = windowRemoteConnectionRegistry.resolveScopedCapabilities({
        kind: "remote",
        remoteSessionId: input.remoteSessionId,
        workspacePath: input.workspacePath,
        workspaceIdentity,
      })?.browserRecordingUploader;
      if (!remoteBackend) {
        throw new Error(
          "Source Server browser recording transfer requires the remote resource transaction path",
        );
      }
    }
    return materializeBrowserRecordingArtifact({
      ...input,
      ...(remoteBackend ? { remoteBackend } : {}),
    });
  },
});

function reportHostLog(level: HostLogLevel, args: unknown[]): void {
  if (!parentPort) {
    return;
  }

  try {
    parentPort.postMessage({
      type: HostResponseTypes.Log,
      level,
      source: "host",
      message: args.map((arg) => stringifyHostLogArg(arg)).join(" "),
    });
  } catch {
  }
}

const rawConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

const remoteConnectionProgressContext = createRemoteConnectionProgressContext({
  emit: ({ requestId, level, args }) => {
    if (!parentPort) {
      return;
    }
    try {
      parentPort.postMessage({
        type: HostResponseTypes.RemoteWorkspaceConnectionLog,
        requestId,
        level,
        message: args.map((arg) => stringifyHostLogArg(arg)).join(" "),
      });
    } catch {
    }
  },
});

function writeHostLog(level: HostLogLevel, ...args: unknown[]): void {
  const prefix = formatLogPrefix("cf-host", process.pid);
  const consoleFn =
    level === "error" ? rawConsole.error : level === "warn" ? rawConsole.warn : rawConsole.log;
  consoleFn(prefix, ...args);
  reportHostLog(level, [prefix, ...args]);
}

function createFullFeedbackLogArchiveViaMain(
  sourceDir: string,
  options?: {
    onProgress?: (event: { processedBytes: number; totalBytes: number }) => void;
  },
): Promise<{ path: string; size: number }> {
  const requestId = `feedback-log-archive-${Date.now()}-${nextFeedbackLogArchiveRequestSeq++}`;
  options?.onProgress?.({ processedBytes: 0, totalBytes: 0 });

  return new Promise((resolve, reject) => {
    pendingFeedbackLogArchiveRequests.set(requestId, {
      resolve,
      reject,
      onProgress: options?.onProgress,
    });
    try {
      parentPort.postMessage({
        type: HostResponseTypes.FeedbackLogArchiveRequest,
        requestId,
        sourceDir,
      });
    } catch (error) {
      pendingFeedbackLogArchiveRequests.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

const logger = {
  info: (...args: unknown[]) => writeHostLog("info", ...args),
  warn: (...args: unknown[]) => writeHostLog("warn", ...args),
  error: (...args: unknown[]) => writeHostLog("error", ...args),
};

const cronAutomationRepo = new AutomationRepo();
const cronRunSubscriptions = new Map<string, { dispose(): void }>();

const offPeakTaskRepo = new OffPeakTaskRepo();
const offPeakRunSubscriptions = new Map<string, { dispose(): void }>();

const OFF_PEAK_RESUME_PROMPT =
  "Continue the previous task from where it left off. The run was interrupted " +
  "(app restart or execution window expired). Do not start over; review what has " +
  "already been done and complete the remaining work.";

interface OffPeakRuntime {
  service: OffPeakTaskService;
  
  buildRequestAuth: OffPeakRequestAuthBuilder;
  validateSelection: (selection: {
    providerId: string;
    modelId: string;
    options?: { reasoningLevel?: string };
  }) => Promise<boolean>;
}
let offPeakRuntime: OffPeakRuntime | null = null;

async function ensureOffPeakRuntime(): Promise<OffPeakRuntime | null> {
  if (offPeakRuntime) return offPeakRuntime;
  const services = activeServices;
  if (!services) return null;
  const service = services.getOptional(IOffPeakTaskService);
  const buildRequestAuth = getOffPeakRequestAuthBuilder(services);
  if (!service || !buildRequestAuth) {
    logger.warn("off-peak runtime unavailable: missing host services");
    return null;
  }
  offPeakRuntime = {
    service: service as OffPeakTaskService,
    buildRequestAuth,
    validateSelection: (selection) =>
      (service as OffPeakTaskService).validateDispatchModelSelection(selection),
  };
  logger.info("off-peak runtime ready (service from local collection)");
  return offPeakRuntime;
}

function disposeOffPeakRuntime(): void {
  if (!offPeakRuntime) return;
  offPeakRuntime = null;
}

interface OffPeakRunDispatchRequest {
  offPeakTaskId: string;
  prompt: string;
  permissionMode: string;
  modelSelection: ModelSelection;
  conversationId?: string;
  sessionId?: string;
  serverTicketId?: string;
  workspacePath: string;
  workspaceIdentity?: string;
  projectId?: string | null;
  hostId?: string;
  additionalDirectories?: string[];
}

function offPeakRunSubscriptionKey(taskId: string, traceId: TraceId): string {
  return `${taskId}\u0000${traceId}`;
}

function disposeOffPeakRunSubscription(key: string): void {
  const disposable = offPeakRunSubscriptions.get(key);
  if (!disposable) return;
  offPeakRunSubscriptions.delete(key);
  disposable.dispose();
}

async function resolveOffPeakFilesChanged(params: {
  cfTaskService: ICfTaskService;
  taskId: string;
  workspacePath: string;
  workspaceIdentity?: string;
}): Promise<number | undefined> {
  try {
    const snapshot = await params.cfTaskService.getTaskSnapshot({
      taskId: params.taskId,
      workspacePath: params.workspacePath,
      ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
    });
    const fileChanges = snapshot?.fileChanges;
    if (!fileChanges) return undefined;
    return buildTaskChangeSummary(fileChanges)?.fileCount ?? 0;
  } catch (error) {
    logger.warn("off-peak files_changed summary failed (does not block final database persistence):", error);
    return undefined;
  }
}

async function finalizeOffPeakRun(params: {
  cfTaskService: ICfTaskService;
  offPeakTaskId: string;
  taskId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  outcome: CfAutomationRunOutcome;
  error?: string;
}): Promise<void> {
  const status =
    params.outcome === "succeeded"
      ? ("completed" as const)
      : params.outcome === "stopped"
        ? ("cancelled" as const)
        : ("failed" as const);
  const filesChanged = await resolveOffPeakFilesChanged(params);
  const updated = await offPeakTaskRepo.markTerminal(params.offPeakTaskId, {
    status,
    endedAt: Date.now(),
    ...(params.error ? { failureReason: params.error } : {}),
    ...(filesChanged !== undefined ? { filesChanged } : {}),
  });
  if (!updated) {
    logger.info(
      `off-peak terminal writeback dropped (already terminal) task=${params.offPeakTaskId}`,
    );
    return;
  }
  logger.info(
    `off-peak run finished task=${params.offPeakTaskId} status=${status} filesChanged=${filesChanged ?? "n/a"}`,
  );
  void params.cfTaskService.setTaskUnread({
    taskId: params.taskId,
    workspacePath: params.workspacePath,
    ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
    unread: true,
  });
}

function trackOffPeakRunOutcome(params: {
  cfTaskService: ICfTaskService;
  cfAgentService: ICfAgentService;
  service: OffPeakTaskService;
  ticketId: string;
  offPeakTaskId: string;
  taskId: string;
  traceId: TraceId;
  workspacePath: string;
  workspaceIdentity?: string;
}): { admitted(): void } {
  const key = offPeakRunSubscriptionKey(params.taskId, params.traceId);
  disposeOffPeakRunSubscription(key);
  const target = {
    workspacePath: params.workspacePath,
    workspaceIdentity: params.workspaceIdentity,
  };
  const registration = params.service.residentExecutions.register({
    offPeakTaskId: params.offPeakTaskId,
    executionId: params.traceId,
    sessionId: params.taskId,
    ticketId: params.ticketId,
    control: (control) =>
      params.cfAgentService.controlOffPeakExecutionV4({ ...target, control }),
    complete: (outcome) => finalizeOffPeakRun({ ...params, outcome }),
    disposed: () => disposeOffPeakRunSubscription(key),
  });
  const disposable = params.cfAgentService.onDynamicOffPeakLifecycle(target)((event) => {
    if (event.executionId !== params.traceId || event.sessionId !== params.taskId) return;
    void params.service.residentExecutions
      .handle(event)
      .catch((error) => logger.warn("off-peak 生命周期处理失败:", error));
  });
  offPeakRunSubscriptions.set(key, {
    dispose() {
      disposable.dispose();
      registration.dispose();
    },
  });
  return registration;
}

async function dispatchOffPeakRun(request: OffPeakRunDispatchRequest): Promise<{
  conversationId?: string;
  sessionId?: string;
  lifecycleManaged: true;
}> {
  const cfTaskService = activeServices?.getOptional(ICfTaskService);
  const cfAgentService = activeServices?.getOptional(ICfAgentService);
  if (!cfTaskService || !cfAgentService) {
    throw new Error("CodeFusion task service is not initialized.");
  }
  const runtime = await ensureOffPeakRuntime();
  if (!runtime) {
    throw new Error("off-peak runtime is not available");
  }
  if (!request.serverTicketId) {
    throw new Error("off-peak dispatch without server ticket");
  }
  const currentTask = await offPeakTaskRepo.get(request.offPeakTaskId);
  if (!currentTask || isOffPeakTerminalStatus(currentTask.status)) {
    await runtime.service.residentExecutions.discardTicket(request.serverTicketId);
    const sessionId = currentTask?.conversationId ?? request.conversationId ?? request.sessionId;
    return { conversationId: sessionId, sessionId, lifecycleManaged: true };
  }
  if (runtime.service.residentExecutions.has(request.offPeakTaskId)) {
    const stillNeedsTicket = runtime.service.residentExecutions.retakeGuard(request.offPeakTaskId);
    const auth = runtime.service.residentExecutions.isUserOwned(request.offPeakTaskId)
      ? {}
      : await runtime.buildRequestAuth(request.serverTicketId);
    await offPeakTaskRepo.markRunning(request.offPeakTaskId, { startedAt: Date.now() });
    try {
      const resident = await runtime.service.residentExecutions.deliverTicket(
        request.offPeakTaskId,
        request.serverTicketId,
        auth,
      );
      if (resident)
        return {
          conversationId: resident.sessionId,
          sessionId: resident.sessionId,
          lifecycleManaged: true,
        };
      await runtime.service.residentExecutions.discardTicket(request.serverTicketId);
      const sessionId = currentTask.conversationId ?? request.conversationId ?? request.sessionId;
      return { conversationId: sessionId, sessionId, lifecycleManaged: true };
    } catch (error) {
      if (stillNeedsTicket()) await offPeakTaskRepo.requeueForContinuation(request.offPeakTaskId);
      throw error;
    }
  }
  const idleSelection = request.modelSelection;
  if (!(await runtime.validateSelection(idleSelection))) {
    throw new OffPeakModelUnavailableError("idlePlan");
  }
  const requestAuth = await runtime.buildRequestAuth(request.serverTicketId);
  const dispatchKind = resolveOffPeakDispatchKind(request);
  const offPeakRunType = dispatchKind === "resume" ? "resume" : "init";
  let trackedKey: string | null = null;
  try {
    let taskId: string;
    let traceId: TraceId;
    let promptContent = request.prompt;
    if (dispatchKind === "bound-first-run") {
      taskId = request.sessionId!;
      traceId = `${request.offPeakTaskId}:bound:${randomUUID()}` as TraceId;
      const workspaceScope = {
        workspacePath: request.workspacePath,
        workspaceIdentity: request.workspaceIdentity,
        additionalDirectories: request.additionalDirectories,
      };
      const [deletedIds, activeIds] = await Promise.all([
        cfTaskService.listDeletedTaskIds(workspaceScope),
        cfTaskService.listActiveTaskIds(workspaceScope),
      ]);
      assertBoundSessionDispatchable({
        sessionId: taskId,
        deleted: deletedIds.includes(taskId),
        running: activeIds.includes(taskId),
      });
      await cfTaskService.resumeTask({
        ...workspaceScope,
        taskId,
        offPeakTaskId: request.offPeakTaskId,
      });
      await cfTaskService.setConfigOption({
        taskId,
        traceId,
        configId: "mode",
        value: request.permissionMode,
      });
    } else if (dispatchKind === "resume") {
      taskId = request.conversationId!;
      traceId = `${request.offPeakTaskId}:resume:${randomUUID()}` as TraceId;
      promptContent = OFF_PEAK_RESUME_PROMPT;
      await cfTaskService.resumeTask({
        taskId,
        workspacePath: request.workspacePath,
        workspaceIdentity: request.workspaceIdentity,
        additionalDirectories: request.additionalDirectories,
        offPeakTaskId: request.offPeakTaskId,
      });
      await cfTaskService.setConfigOption({
        taskId,
        traceId,
        configId: "mode",
        value: request.permissionMode,
      });
    } else {
      const task = await cfTaskService.createTask({
        projectId: request.projectId,
        workspacePath: request.workspacePath,
        workspaceIdentity: request.workspaceIdentity,
        additionalDirectories: request.additionalDirectories,
        mode: request.permissionMode as CfTaskMode,
        deferPersistenceUntilFirstPrompt: true,
        offPeakTaskId: request.offPeakTaskId,
      });
      taskId = task.taskId;
      traceId = task.traceId;
    }
    const beforeAdmission = await offPeakTaskRepo.get(request.offPeakTaskId);
    if (!beforeAdmission || isOffPeakTerminalStatus(beforeAdmission.status)) {
      await runtime.service.residentExecutions.discardTicket(request.serverTicketId);
      return { conversationId: taskId, sessionId: taskId, lifecycleManaged: true };
    }
    trackedKey = offPeakRunSubscriptionKey(taskId, traceId);
    const lifecycle = trackOffPeakRunOutcome({
      cfTaskService,
      cfAgentService,
      service: runtime.service,
      ticketId: request.serverTicketId,
      offPeakTaskId: request.offPeakTaskId,
      taskId,
      traceId,
      workspacePath: request.workspacePath,
      ...(request.workspaceIdentity ? { workspaceIdentity: request.workspaceIdentity } : {}),
    });
    await cfTaskService.sendPrompt({
      taskId,
      traceId,
      content: promptContent,
      clientMode: "desktop-continuous",
      toolDenylist: ["CronCreate", "OffPeakCreate"],
      modelSelection: idleSelection,
      modelExecution: {
        memoryExtraction: "skip",
        selectionScope: "execution",
        offPeak: {
          executionId: traceId,
          ticketId: request.serverTicketId,
          providerErrorCode: "3102",
        },
        requestAuth,
        subagents: {
          foregroundModel: "submission",
          background: "allow",
        },
      },
      offPeakTaskId: request.offPeakTaskId,
      offPeakRunType,
    });
    await offPeakTaskRepo.markRunning(request.offPeakTaskId, {
      startedAt: Date.now(),
      conversationId: taskId,
      sessionId: taskId,
    });
    lifecycle.admitted();
    if (dispatchKind === "init") {
      reportHostSessionCreate(parentPort, {
        sessionId: taskId,
        messageId: traceId,
        source: "automation_idle",
        workspaceIdentity: request.workspaceIdentity,
      });
    }
    return { conversationId: taskId, sessionId: taskId, lifecycleManaged: true };
  } catch (error) {
    if (trackedKey) disposeOffPeakRunSubscription(trackedKey);
    throw error;
  }
}

interface CronRunDispatchRequest {
  automationId: string;
  runId: string;
  prompt: string;
  targetTaskId?: string;
  modelSelection?: ModelSelection;
  mode?: CfTaskMode;
  workspacePath: string;
  workspaceIdentity?: string;
  projectId?: string | null;
  hostId?: string;
  additionalDirectories?: string[];
}

function resolveAutomationTargetServices(request: {
  workspacePath: string;
  workspaceIdentity?: string;
}): ServiceCollection {
  const remoteSession = windowRemoteConnectionRegistry.findSessionForWorkspace(request);
  if (remoteSession) {
    if (!remoteSession.workspaceIdentity) {
      throw new Error("Automation target Remote Host missing workspaceIdentity.");
    }
    return windowRemoteConnectionRegistry.resolveScopedServices({
      kind: "remote",
      remoteSessionId: remoteSession.remoteSessionId,
      workspacePath: request.workspacePath,
      workspaceIdentity: remoteSession.workspaceIdentity,
    });
  }
  if (request.workspaceIdentity && isRemoteWorkspaceIdentity(request.workspaceIdentity)) {
    throw new Error("Automation target Remote Host currently unavailable.");
  }
  if (!activeServices) {
    throw new Error("Local Host services are not initialized.");
  }
  return activeServices;
}

function cronRunSubscriptionKey(taskId: string, traceId: TraceId): string {
  return `${taskId}\u0000${traceId}`;
}

function parseCronRunScheduledAt(runId: string, automationId: string): number | null {
  const prefix = `${automationId}:`;
  if (!runId.startsWith(prefix)) return null;
  const value = Number(runId.slice(prefix.length).split(":")[0]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function markCronRunOutcome(params: {
  runId: string;
  automationId: string;
  workspaceKey: string;
  scheduledAt: number | null;
  trigger: "schedule" | "manual";
  outcome: CfAutomationRunOutcome;
  error?: string;
}): void {
  void recordCronRunOutcomeBestEffort({
    ...params,
    repo: cronAutomationRepo,
    logWarn: (message, error) => logger.warn(message, error),
  });
}

function disposeCronRunSubscription(key: string): void {
  const disposable = cronRunSubscriptions.get(key);
  if (!disposable) return;
  cronRunSubscriptions.delete(key);
  disposable.dispose();
}

async function applyCronRunConfigToExistingTask(params: {
  cfTaskService: ICfTaskService;
  taskId: string;
  traceId: TraceId;
  modelSelection?: ModelSelection;
  mode?: string;
}): Promise<void> {
  let thoughtAppliedWithModel = false;
  let modeAppliedWithModel = false;
  if (params.modelSelection) {
    await params.cfTaskService.setAutomationSessionConfig({
      taskId: params.taskId,
      traceId: params.traceId,
      modelSelection: params.modelSelection,
      thoughtLevel: params.modelSelection.options?.reasoningLevel,
      mode: params.mode?.trim() as CfTaskMode | undefined,
    });
    thoughtAppliedWithModel = true;
    modeAppliedWithModel = true;
  }
  if (!modeAppliedWithModel && params.mode?.trim()) {
    await params.cfTaskService.setConfigOption({
      taskId: params.taskId,
      traceId: params.traceId,
      configId: "mode",
      value: params.mode.trim(),
    });
  }
  if (!thoughtAppliedWithModel && params.modelSelection?.options?.reasoningLevel) {
    await params.cfTaskService.setConfigOption({
      taskId: params.taskId,
      traceId: params.traceId,
      configId: "thought_level",
      value: params.modelSelection.options.reasoningLevel,
    });
  }
}

function trackCronRunOutcome(params: {
  cfTaskService: ICfTaskService;
  taskId: string;
  traceId: TraceId;
  workspacePath: string;
  workspaceIdentity?: string;
  runId: string;
  automationId: string;
  workspaceKey: string;
  scheduledAt: number | null;
  trigger: "schedule" | "manual";
}): void {
  const key = cronRunSubscriptionKey(params.taskId, params.traceId);
  disposeCronRunSubscription(key);
  markCronRunOutcome({ ...params, outcome: "running" });
  const disposable = params.cfTaskService.onDynamicTaskTerminalOutcome(params.taskId)(
    (result) => {
      if (result.inputId !== params.traceId) return;
      void settleCronRunTerminalOutcome({
        ...params,
        outcome: result.outcome,
        error: result.error,
        repo: cronAutomationRepo,
        logWarn: (message, error) => logger.warn(message, error),
      });
      void params.cfTaskService.setTaskUnread({
        taskId: params.taskId,
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
        unread: true,
      });
      disposeCronRunSubscription(key);
    },
  );
  const claimHeartbeat =
    params.trigger === "manual"
      ? startManualClaimHeartbeat({
          ...params,
          repo: cronAutomationRepo,
          logWarn: (message, error) => logger.warn(message, error),
        })
      : null;
  cronRunSubscriptions.set(key, {
    dispose() {
      claimHeartbeat?.dispose();
      disposable.dispose();
    },
  });
}

async function dispatchCronRun(request: CronRunDispatchRequest): Promise<{
  taskId: string;
  sessionId: string;
}> {
  const targetServices = resolveAutomationTargetServices(request);
  const cfTaskService = targetServices.getOptional(ICfTaskService);
  if (!cfTaskService) {
    throw new Error("CodeFusion task service is not initialized.");
  }
  const modelSelectionService = targetServices.getOptional(IModelSelectionService);
  if (!modelSelectionService) {
    throw new Error("目标 Host Model Selection service is not initialized.");
  }
  const existingRun = await cronAutomationRepo.getRun(request.runId);
  const resolvedSubmissionModelSelection = await resolveAutomationSubmissionModelSelection({
    selection: request.modelSelection,
    fixedSelection: existingRun?.modelSelection,
    modelSelectionService,
    readSelection: () =>
      cronAutomationRepo.getModelSelectionForDispatch(
        request.automationId,
        resolveWorkspaceKey(request),
      ),
  });
  const submissionModelSelection = await cronAutomationRepo.fixRunModelSelection(
    request.runId,
    resolvedSubmissionModelSelection,
  );
  let trackedKey: string | null = null;
  const workspaceKey = resolveWorkspaceKey(request);
  const trigger = request.runId.includes(":manual:") ? "manual" : "schedule";
  const scheduledAt = parseCronRunScheduledAt(request.runId, request.automationId);
  try {
    const task = request.targetTaskId
      ? { taskId: request.targetTaskId }
      : await cfTaskService.createTask({
          projectId: request.projectId,
          workspacePath: request.workspacePath,
          workspaceIdentity: request.workspaceIdentity,
          additionalDirectories: request.additionalDirectories,
          model: formatModelPickerValue(submissionModelSelection),
          mode: request.mode,
          thoughtLevel: submissionModelSelection.options?.reasoningLevel,
          automationId: request.automationId,
        });
    const promptTraceId = request.runId as TraceId;
    if (request.targetTaskId) {
      await cfTaskService.resumeTask({
        taskId: task.taskId,
        workspacePath: request.workspacePath,
        workspaceIdentity: request.workspaceIdentity,
        additionalDirectories: request.additionalDirectories,
        model: formatModelPickerValue(submissionModelSelection),
        thoughtLevel: submissionModelSelection.options?.reasoningLevel,
        automationId: request.automationId,
      });
      await applyCronRunConfigToExistingTask({
        cfTaskService,
        taskId: task.taskId,
        traceId: promptTraceId,
        modelSelection: submissionModelSelection,
        mode: request.mode,
      });
    }
    const botsService = targetServices.getOptional(IBotsService);
    if (botsService) {
      try {
        await watchCronRunBotDelivery({
          automationId: request.automationId,
          runId: promptTraceId,
          workspaceKey,
          workspacePath: request.workspacePath,
          ...(request.workspaceIdentity ? { workspaceIdentity: request.workspaceIdentity } : {}),
          taskId: task.taskId,
          repo: cronAutomationRepo,
          botsService,
        });
      } catch (error) {
        logger.warn(
          `automation Bot delivery subscription failed automation=${request.automationId} provider=unknown`,
          error,
        );
      }
    }
    trackedKey = cronRunSubscriptionKey(task.taskId, promptTraceId);
    trackCronRunOutcome({
      cfTaskService,
      taskId: task.taskId,
      traceId: promptTraceId,
      workspacePath: request.workspacePath,
      workspaceIdentity: request.workspaceIdentity,
      runId: request.runId,
      automationId: request.automationId,
      workspaceKey,
      scheduledAt,
      trigger,
    });
    await cfTaskService.sendPrompt({
      taskId: task.taskId,
      traceId: promptTraceId,
      content: request.prompt,
      clientMode: "desktop-continuous",
      automationId: request.automationId,
    });
    if (!request.targetTaskId) {
      reportHostSessionCreate(parentPort, {
        sessionId: task.taskId,
        messageId: promptTraceId,
        source: "automation_scheduled",
        workspaceIdentity: request.workspaceIdentity,
      });
    }
    return { taskId: task.taskId, sessionId: task.taskId };
  } catch (error) {
    if (trackedKey) disposeCronRunSubscription(trackedKey);
    markCronRunOutcome({
      runId: request.runId,
      automationId: request.automationId,
      workspaceKey,
      scheduledAt,
      trigger,
      outcome: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function dispatchManualAutomationRun(params: {
  automation: CfAutomation;
  run: CfAutomationRun;
}): Promise<void> {
  logger.info(
    `direct manual automation dispatch started automation=${params.automation.automationId} runId=${params.run.runId}`,
  );
  let result: Awaited<ReturnType<typeof dispatchCronRun>>;
  try {
    result = await dispatchCronRun({
      automationId: params.automation.automationId,
      runId: params.run.runId,
      prompt: params.automation.prompt,
      targetTaskId: params.automation.targetTaskId,
      modelSelection: params.run.modelSelection ?? params.automation.modelSelection,
      mode: params.automation.mode,
      workspacePath: params.automation.workspacePath,
      workspaceIdentity: params.automation.workspaceIdentity,
      projectId: params.automation.projectId,
      hostId: params.automation.hostId,
      additionalDirectories: params.automation.additionalDirectories,
    });
  } catch (error) {
    logger.warn(
      `direct manual automation dispatch failed automation=${params.automation.automationId} runId=${params.run.runId}:`,
      error,
    );
    await settleManualDispatchFailureBestEffort({
      repo: cronAutomationRepo,
      automationId: params.automation.automationId,
      runId: params.run.runId,
      workspaceKey: params.automation.workspaceKey,
      scheduledAt: params.run.scheduledAt ?? null,
      trigger: "manual",
      dispatchError: error,
      logWarn: (message, releaseError) => logger.warn(message, releaseError),
    });
    throw error;
  }

  try {
    await cronAutomationRepo.markManualRunDispatched({
      runId: params.run.runId,
      sessionId: result.sessionId,
      dispatchedAt: Date.now(),
    });
  } catch (error) {
    logger.warn(
      `回写 manual automation dispatched Status与Run次CountFailed automation=${params.automation.automationId} runId=${params.run.runId}`,
      error,
    );
  }
  logger.info(
    `direct manual automation dispatch accepted automation=${params.automation.automationId} runId=${params.run.runId} taskId=${result.taskId}`,
  );
}

process.on("warning", (warning) => logger.warn(`${warning.name}: ${warning.message}`));

registerHostNetworkTelemetry(parentPort);
const hostSelfResourceTelemetry = startHostSelfResourceTelemetry({
  logger,
  collectCounters: collectServiceMemoryDiagnostics,
  postMessage: parentPort ? (message) => parentPort.postMessage(message) : undefined,
});

const runtimeProcessLifecycleReporter = {
  onSpawn(event) {
    if (!parentPort) {
      return;
    }

    parentPort.postMessage({
      type: HostResponseTypes.AgentProcessSpawned,
      ...event,
    });
  },
  onReady(event) {
    if (!parentPort) {
      return;
    }

    parentPort.postMessage({
      type: HostResponseTypes.AgentProcessReady,
      ...event,
    });
  },
  onExit(event) {
    if (!parentPort) {
      return;
    }

    parentPort.postMessage({
      type: HostResponseTypes.AgentProcessExited,
      ...event,
      signal: event.signal ?? null,
    });
  },
  onError(event) {
    if (!parentPort) {
      return;
    }

    parentPort.postMessage({
      type: HostResponseTypes.AgentProcessError,
      ...event,
    });
  },
  onException(event) {
    parentPort?.postMessage({ type: HostResponseTypes.AgentProcessException, ...event });
  },
} satisfies NonNullable<Parameters<typeof createLocalServices>[0]>["processLifecycleReporter"];

const runtimeTaskReporter = {
  onRunningTaskCountChanged(event) {
    if (!parentPort) {
      return;
    }

    parentPort.postMessage({
      type: HostResponseTypes.AgentRunningTaskCountChanged,
      runningTaskCount: event.runningTaskCount,
    });
  },
} satisfies NonNullable<Parameters<typeof createLocalServices>[0]>["taskRuntimeReporter"];

const cuaOperationStateReporter = {
  onStateChanged(event) {
    if (!parentPort) {
      return;
    }
    parentPort.postMessage({
      type: HostResponseTypes.CuaOperationState,
      ...event,
    });
  },
} satisfies NonNullable<Parameters<typeof createLocalServices>[0]>["cuaOperationStateReporter"];

let untrackedPromptRpcCount = 0;
function reportHostRunningTaskCount(): void {
  runtimeTaskReporter.onRunningTaskCountChanged({
    runningTaskCount: workspaceTaskTracker.getTotalRunningTaskCount() + untrackedPromptRpcCount,
  });
}

const workspaceTaskTracker = createHostWorkspaceTaskTracker((event) => {
  parentPort?.postMessage({
    type: HostResponseTypes.WorkspaceRunningTaskCountChanged,
    ...event,
  });
  windowRemoteConnectionRegistry.setWorkspaceRunningTaskCount(event);
  reportHostRunningTaskCount();
});

function isCfTaskMeta(value: unknown): value is CfTaskMeta {
  return (
    typeof value === "object" &&
    value !== null &&
    "taskId" in value &&
    "workspacePath" in value &&
    "traceId" in value &&
    typeof (value as { taskId?: unknown }).taskId === "string" &&
    typeof (value as { workspacePath?: unknown }).workspacePath === "string" &&
    typeof (value as { traceId?: unknown }).traceId === "string"
  );
}

function isRemoteMirrorableStreamEvent(
  event: CfStreamEvent,
): event is TaskStreamMirrorableEvent {
  return event.type !== "task_stream_mirror_batch" && event.type !== "task_snapshot_updated";
}

function createReportingRemoteCfTaskService<T extends object>(
  service: T,
  options?: {
    reportRunningPromptCount?: boolean;
    taskRealtimePort?: ReturnType<typeof createTaskRealtimeBridgeForHostInit>;
    materializePromptAttachments?: (params: {
      taskId: string;
      traceId: TraceId;
      content: string;
      attachments?: CfPromptAttachment[];
    }) => Promise<{ content: string; attachments?: CfPromptAttachment[] }>;
  },
): T {
  const workspaceProxyState = createHostRemoteWorkspaceProxyState();

  function forwardSessionMessageRequest(request: unknown): void {
    parentPort?.postMessage({
      type: HostResponseTypes.SessionMessageSendRequested,
      request,
    });
  }

  function subscribeSessionMessageRequests(target: T, meta: CfTaskMeta): void {
    const onDynamicWorkspaceEvent = Reflect.get(target, "onDynamicWorkspaceEvent");
    if (typeof onDynamicWorkspaceEvent !== "function") {
      return;
    }
    const subscribe = onDynamicWorkspaceEvent.call(target, {
      workspacePath: meta.workspacePath,
      ...(meta.workspaceIdentity ? { workspaceIdentity: meta.workspaceIdentity } : {}),
    });
    if (typeof subscribe !== "function") {
      return;
    }
    workspaceProxyState.ensureWorkspaceSubscription(meta, () =>
      subscribe((event: unknown) => {
        if (
          typeof event === "object" &&
          event !== null &&
          (event as { type?: unknown }).type === "workspace_session_message_send_requested"
        ) {
          forwardSessionMessageRequest((event as { request?: unknown }).request);
        }
      }),
    );
  }

  function rememberTaskMeta(result: unknown): void {
    if (isCfTaskMeta(result)) {
      workspaceProxyState.rememberTaskMeta(result);
      subscribeSessionMessageRequests(service, result);
      parentPort?.postMessage({
        type: HostResponseTypes.SessionRouteAnnounce,
        route: {
          sessionId: result.taskId,
        },
      });
    }
  }

  function rememberTaskMetasFromResult(result: unknown): void {
    if (Array.isArray(result)) {
      for (const item of result) {
        rememberTaskMetasFromResult(item);
      }
      return;
    }
    rememberTaskMeta(result);
    if (typeof result !== "object" || result === null) {
      return;
    }
    const items = (result as { items?: unknown }).items;
    if (Array.isArray(items)) {
      for (const item of items) {
        rememberTaskMeta(item);
      }
    }
    const snapshot = (result as { snapshot?: unknown }).snapshot;
    if (typeof snapshot === "object" && snapshot !== null) {
      rememberTaskMeta((snapshot as { meta?: unknown }).meta);
    }
    rememberTaskMeta((result as { meta?: unknown }).meta);
  }

  async function prepareRemotePromptParams(params: {
    taskId: string;
    traceId: TraceId;
    content: string;
    attachments?: CfPromptAttachment[];
  }): Promise<{
    taskId: string;
    traceId: TraceId;
    content: string;
    attachments?: CfPromptAttachment[];
  }> {
    if (!options?.materializePromptAttachments) {
      return params;
    }
    return {
      ...params,
      ...(await options.materializePromptAttachments(params)),
    };
  }

  async function mirrorRemotePrompt(
    target: T,
    sendPrompt: (...args: unknown[]) => Promise<unknown>,
    params: {
      taskId: string;
      traceId: TraceId;
      content: string;
      attachments?: CfPromptAttachment[];
    },
  ): Promise<unknown> {
    const taskRealtimePort = options?.taskRealtimePort;
    const meta = workspaceProxyState.getTaskMeta(params.taskId);
    if (!taskRealtimePort || !meta) {
      return sendPrompt.call(target, params);
    }

    const mirrorTarget = {
      workspacePath: meta.workspacePath,
      workspaceIdentity: meta.workspaceIdentity,
      workspaceKey: resolveWorkspaceKey(meta),
      taskId: params.taskId,
      runId: params.traceId,
      traceId: params.traceId,
    };
    const leaseResult = await taskRealtimePort
      .acquireTaskRunLease(mirrorTarget)
      .catch((error: unknown) => {
        logger.warn("Bot remote runtime realtime lease failed:", error);
        return null;
      });
    if (!leaseResult?.acquired) {
      return sendPrompt.call(target, params);
    }

    taskRealtimePort.publishStreamOp(mirrorTarget, {
      kind: "user_message",
      messageId: `user-${params.traceId}`,
      content: params.content,
      attachments: params.attachments,
      timestamp: Date.now(),
    });

    const dynamicStreamEvent = Reflect.get(target, "onDynamicStreamEvent");
    const streamDisposable =
      typeof dynamicStreamEvent === "function"
        ? dynamicStreamEvent.call(
            target,
            params.taskId,
          )((event: CfStreamEvent) => {
            if (isRemoteMirrorableStreamEvent(event)) {
              taskRealtimePort.publishStreamOp(mirrorTarget, {
                kind: "stream_event",
                event,
              });
            }
          })
        : null;

    try {
      return await sendPrompt.call(target, params);
    } finally {
      streamDisposable?.dispose();
      taskRealtimePort.releaseTaskRunLease(mirrorTarget);
    }
  }

  function finishWorkspaceTask(taskId: string, meta: CfTaskMeta): void {
    workspaceProxyState.disposeTaskReadySubscription(taskId);
    workspaceTaskTracker.finish(taskId, meta);
  }

  function beginWorkspaceTask(target: T, taskId: string, meta: CfTaskMeta): boolean {
    const started = workspaceTaskTracker.begin(taskId, meta);
    if (!started) {
      return false;
    }
    const onDynamicTaskReady = Reflect.get(target, "onDynamicTaskReady");
    if (typeof onDynamicTaskReady !== "function") {
      workspaceTaskTracker.finish(taskId, meta);
      throw new Error("remote CodeFusion task service does not expose onDynamicTaskReady");
    }
    const subscribe = onDynamicTaskReady.call(target, taskId);
    if (typeof subscribe !== "function") {
      workspaceTaskTracker.finish(taskId, meta);
      throw new Error("remote CodeFusion task ready event is not subscribable");
    }
    workspaceProxyState.trackTaskReady(
      taskId,
      meta,
      (listener) => subscribe(listener),
      () => finishWorkspaceTask(taskId, meta),
    );
    return true;
  }

  return new Proxy(service, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if ((property === "createTask" || property === "resumeTask") && typeof value === "function") {
        return async (...args: unknown[]) => {
          const result = await value.apply(target, args);
          rememberTaskMeta(result);
          return result;
        };
      }
      if (
        (property === "listTasks" ||
          property === "listPinnedTasks" ||
          property === "listTaskList" ||
          property === "listArchivedTasks" ||
          property === "getTaskMeta" ||
          property === "getTaskSnapshot" ||
          property === "getTaskSnapshotWithEtag") &&
        typeof value === "function"
      ) {
        return async (...args: unknown[]) => {
          const result = await value.apply(target, args);
          rememberTaskMetasFromResult(result);
          return result;
        };
      }
      if (property === "releaseWorkspacePreparation" && typeof value === "function") {
        return async (...args: unknown[]) => {
          const result = await value.apply(target, args);
          const context = args[0];
          if (
            typeof context === "object" &&
            context !== null &&
            typeof (context as { workspacePath?: unknown }).workspacePath === "string"
          ) {
            const workspaceContext = context as {
              workspacePath: string;
              workspaceIdentity?: string;
            };
            workspaceProxyState.clearWorkspace(workspaceContext);
            workspaceTaskTracker.clearWorkspace(workspaceContext);
          }
          return result;
        };
      }
      const shouldWrapSendPrompt =
        options?.reportRunningPromptCount !== false ||
        Boolean(options?.taskRealtimePort) ||
        Boolean(options?.materializePromptAttachments);
      if (property !== "sendPrompt" || typeof value !== "function" || !shouldWrapSendPrompt) {
        return value;
      }

      return async (...args: unknown[]) => {
        let trackedTask: { taskId: string; meta: CfTaskMeta; started: boolean } | undefined;
        let tracksOnlyRpcLifetime = false;
        try {
          const params = args[0];
          if (
            typeof params === "object" &&
            params !== null &&
            typeof (params as { taskId?: unknown }).taskId === "string" &&
            typeof (params as { traceId?: unknown }).traceId === "string" &&
            typeof (params as { content?: unknown }).content === "string"
          ) {
            const promptParams = params as {
              taskId: string;
              traceId: TraceId;
              content: string;
              attachments?: CfPromptAttachment[];
            };
            const taskMeta = workspaceProxyState.getTaskMeta(promptParams.taskId) as
              | CfTaskMeta
              | undefined;
            if (taskMeta) {
              trackedTask = {
                taskId: promptParams.taskId,
                meta: taskMeta,
                started: beginWorkspaceTask(target, promptParams.taskId, taskMeta),
              };
            } else if (options?.reportRunningPromptCount !== false) {
              tracksOnlyRpcLifetime = true;
              untrackedPromptRpcCount += 1;
              reportHostRunningTaskCount();
            }
            const preparedParams = await prepareRemotePromptParams(promptParams);
            return await mirrorRemotePrompt(
              target,
              value.bind(target) as (...promptArgs: unknown[]) => Promise<unknown>,
              preparedParams,
            );
          }
          if (options?.reportRunningPromptCount !== false) {
            tracksOnlyRpcLifetime = true;
            untrackedPromptRpcCount += 1;
            reportHostRunningTaskCount();
          }
          return await value.apply(target, args);
        } catch (error) {
          if (trackedTask?.started) {
            finishWorkspaceTask(trackedTask.taskId, trackedTask.meta);
          }
          throw error;
        } finally {
          if (tracksOnlyRpcLifetime) {
            untrackedPromptRpcCount = Math.max(0, untrackedPromptRpcCount - 1);
            reportHostRunningTaskCount();
          }
        }
      };
    },
  });
}

function warmUpCfAgent(
  services: ServiceCollection,
  context: { workspacePath?: string; workspaceIdentity?: string },
  reason: string,
): void {
  if (!context.workspacePath) {
    return;
  }
  const workspacePath = context.workspacePath;
  const workspaceIdentity = context.workspaceIdentity;
  const cfSessionService = services.getOptional(ICfSessionService);
  if (!cfSessionService) {
    return;
  }
  void cfSessionService
    .initializeWorkspace({
      workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
    })
    .then((result) => {
      if (!result.available) {
        if (result.reasonCode === "provider_not_ready") {
          logger.info(
            `CodeFusion agent warmup waiting for provider/model (${reason}) workspace=${workspacePath}`,
          );
          return;
        }
        logger.warn(
          `CodeFusion agent warmup unavailable (${reason}) workspace=${workspacePath} reason=${result.reason ?? "unknown"}`,
        );
        return;
      }
      logger.info(
        `CodeFusion agent warmup ready (${reason}) workspace=${workspacePath} transport=${result.transportKind ?? "unknown"}`,
      );
    })
    .catch((error) => {
      logger.warn(`CodeFusion agent warmup failed (${reason}) workspace=${workspacePath}:`, error);
    });
}

const rpcDebugLogger = createServiceLogger("rpc");

function logRpc(message: string, ...args: unknown[]): void {
  const level = resolveRpcLogLevel(message, ...args);
  if (level === "debug") {
    rpcDebugLogger.debug(undefined, message, ...args);
    return;
  }
  logger[level](message, ...args);
}

function formatRemoteTargetForLog(target: RemoteTarget): string {
  switch (target.kind) {
    case "ssh":
      return `ssh:${target.username}@${target.host}:${target.port ?? 22}`;
    case "wsl": {
      const user = target.user?.trim();
      const distro = target.distro ?? "default";
      return user ? `wsl:${distro}:${user}` : `wsl:${distro}`;
    }
    case "docker":
      return `docker:${target.container}`;
    case "server":
      return `server:${target.name?.trim() || target.url}`;
  }
}

console.log = (...args: unknown[]) => {
  rawConsole.log(...args);
  reportHostLog("info", args);
};

console.warn = (...args: unknown[]) => {
  rawConsole.warn(...args);
  reportHostLog("warn", args);
};

console.error = (...args: unknown[]) => {
  rawConsole.error(...args);
  if (!shouldReportHostConsoleError(args)) {
    return;
  }
  reportHostLog("error", args);
};

let databaseStartup: ReturnType<typeof createHostDatabaseStartup> | undefined;
const pendingStartupAttachments = new Map<string, () => void>();
let activeServices: ServiceCollection | null = null;

let applicationLocale: Locale | undefined;
let activeHostApiNetworkTransport: HostApiNetworkTransport | null = null;
let sourceServerDirectory: SourceServerDirectory | null = null;
let sourceServerConnectionManager: SourceServerConnectionManager | null = null;
let sourceServerManagementService: SourceServerManagementService | null = null;
let sourceServerArtifactPolicy: SourceServerArtifactPolicy = "release-versioned";
const sourceServerDisplayNameById = new Map<string, string>();
let sourceSettingsStateSubscription: IDisposable | null = null;
const activeWorkspaceBindRequestIds = new Set<string>();
const cancelledWorkspaceBindRequestIds = new Set<string>();
const workspaceBindAbortControllers = new Map<string, AbortController>();
const projectNavigationAbortControllers = new Map<string, AbortController>();
let sourceServerRuntimeInitializeFlight: Promise<SourceServerConnectionManager> | null = null;

function notifyProjectChange(): void {
  void activeServices
    ?.get(IBroadcastService)
    .send({ channel: "state:projects", payload: {} })
    .catch((error) => logger.warn("failed to notify project change", error));
}

function resolveBotProjectConnection(hostId: string): BotProjectConnection | undefined {
  const serverId = parseRemoteWorkspaceIdentity(
    buildRemoteHostWorkspaceIdentity(hostId, "/"),
  )?.sourceServerId;
  if (!serverId) return undefined;
  const registered = windowRemoteConnectionRegistry.getOnlineSource(serverId);
  if (registered) {
    const services = registered.services;
    return {
      owner: registered.capabilities?.physicalOwner?.() ?? services,
      taskService: createControllerRoutedTaskService(services.get(ICfTaskService), {
        kind: "local",
      }),
      modelSelectionService: services.get(IModelSelectionService),
      agentService: services.get(ICfAgentService),
      bindWorkspace: async (target) => {
        await registered.capabilities?.bindWorkspaceIdentity?.({
          workspacePath: target.workspacePath,
          stableWorkspaceIdentity: target.workspaceIdentity,
          legacyRouteHint: target.workspaceIdentity,
        });
      },
    };
  }
  const connection = sourceServerConnectionManager?.getOnlineConnection(serverId);
  if (!connection) return undefined;
  return {
    owner: connection.services,
    taskService: createControllerRoutedTaskService(connection.services.cfTaskService, {
      kind: "local",
    }),
    modelSelectionService: connection.services.modelSelectionService,
    agentService: connection.services.cfAgentService,
    bindWorkspace: async (target) => {
      await connection.services.sourceServerWorkspaceService.resolveWorkspace({
        workspacePath: target.workspacePath,
        legacyRouteHint: target.workspaceIdentity,
      });
    },
  };
}

function requireActiveHostApiNetworkTransport(): HostApiNetworkTransport {
  if (!activeHostApiNetworkTransport) {
    throw new Error("Window Host network transport is not initialized");
  }
  return activeHostApiNetworkTransport;
}

async function ensureSourceServerConnectionManager(): Promise<SourceServerConnectionManager> {
  if (sourceServerConnectionManager) return sourceServerConnectionManager;
  if (!sourceServerDirectory) throw new Error("Source Server directory not yet initialized.");
  if (!activeServices) throw new Error("Host services not yet initialized.");
  const directory = sourceServerDirectory;
  const remoteProjects = activeServices.get(IRemoteProjectService);
  sourceServerRuntimeInitializeFlight ??= (async () => {
    await directory.initialize();
    if (hasDisposedHostResources || sourceServerDirectory !== directory) {
      throw new Error("Host released during Source Server directory initialization.");
    }
    const manager = new SourceServerConnectionManager({
      directory,
      admitConnection: createRemoteProjectConnectionAdmission(remoteProjects),
      onProjectChange: notifyProjectChange,
      logWarn: (message, error) => logger.warn(message, error),
      sourceServerArtifactPolicy,
      connectServer: (options) =>
        connectDesktopSourceServer(options, {
          resolveServices: (scope) => windowRemoteConnectionRegistry.resolveScopedServices(scope),
          getBots: () => activeServices?.getOptional(IBotsService),
          readDynamicWorkflowMode: async () =>
            (await activeServices?.get(ISettingService).get())?.dynamicWorkflowMode,
          onModeSyncError: (error) =>
            logger.warn("remote dynamic workflow user mode push failed", error),
        }),
    });
    sourceServerConnectionManager = manager;
    return manager;
  })().finally(() => {
    sourceServerRuntimeInitializeFlight = null;
  });
  return await sourceServerRuntimeInitializeFlight;
}

let activeLocalResourceTelemetry: IDisposable | null = null;
const hostResourceUsageResponder = createHostResourceUsageResponder({
  getAgentService: () => activeServices?.getOptional(ICfAgentService),
  postMessage: (message) => parentPort?.postMessage(message),
});
let activeSessionRealtimePort: ReturnType<typeof createTaskRealtimeBridgeForHostInit> = null;
let hasDisposedHostResources = false;
let disposeHostResourcesInFlight: Promise<HostShutdownResult> | null = null;

async function disposeHostRemoteConnection(connection: HostRemoteConnection): Promise<void> {
  connection.dispose();
}

async function createWindowRemoteConnectionHandle(params: {
  target: RemoteTarget;
  membershipIntent?: "add" | "retain";
  existingSourceServerId?: string;
  remoteAssets: RemoteAssetDirs;
  signal: AbortSignal;
  confirmSourceServerInstall?: boolean;
}): Promise<WindowRemoteConnectionHandle<ServiceCollection, HostRemoteConnectionCapabilities>> {
  if (!activeServices) throw new Error("Local Host services are not initialized.");
  const clientConfigService = activeServices.get(IClientConfigService);
  if (params.signal.aborted) {
    throw new Error("Remote connection canceled.");
  }
  const closeListeners = new Set<(event: WindowRemoteConnectionCloseEvent) => void>();
  const reconnectListeners = new Set<() => void>();
  let topicResourceRelay: ReturnType<typeof createWindowTopicResourceRelay> | undefined;
  const notifyClose = (event: WindowRemoteConnectionCloseEvent) => {
    topicResourceRelay?.dispose();
    for (const listener of closeListeners) {
      listener(event);
    }
  };
  let connection: HostRemoteConnection;
  let managedProfile: import("@origin-ai/cf-shared").ConnectionProfile | undefined;
  let reusedConnectionTarget: RemoteTarget | undefined;
  let managerStateSubscription: { dispose(): void } | undefined;
  let managerConnectionInvalidatedSubscription: { dispose(): void } | undefined;
  let managerReconnectSubscription: { dispose(): void } | undefined;
  let services: ServiceCollection;
  let resourceTelemetry: IDisposable | undefined;
  const refreshResourceTelemetry = () => {
    resourceTelemetry?.dispose();
    resourceTelemetry = registerHostServiceResourceTelemetry({
      services,
      postMessage: (message) => parentPort?.postMessage(message),
      runtimeSurface: "remote",
      telemetrySupported: connection.serverInfo.capabilities.processResourceTelemetry === true,
      environmentKey: resolveResourceTelemetryEnvironmentKey(
        params.target,
        connection.serverInfo.serverId,
      ),
      onError: (error) => logger.warn("remote resource telemetry subscription failed", error),
    });
  };
  let lastNotifiedRecoveryAttempt = 0;
  let disposed = false;
  let sourceClosed = false;
  let projectSubscription: { dispose(): void } | undefined;
  const detachOwnSourceSettings = () => {
    const sourceId = connection?.serverInfo.serverId;
    if (!sourceId || params.target.kind !== "server") return;
    const current = windowRemoteConnectionRegistry.getOnlineSource(sourceId);
    if (!current || current.services === services)
      windowHostAttachmentRegistry.detachSourceSettingsAttachments(sourceId);
  };
  if (params.target.kind === "server") {
    if (params.existingSourceServerId) throw new Error("project.host-offline");
    if (!activeServices) throw new Error("Host services not yet initialized.");
    const admission = await prepareRemoteServerConnection({
      service: activeServices.get(IRemoteProjectService),
      credentials: activeServices.get(ICredentialService),
      target: params.target,
      intent: params.membershipIntent ?? "add",
    });
    params.signal.throwIfAborted();
    topicResourceRelay = createWindowTopicResourceRelay({
      getPeerAgentService: () => connection?.services.cfAgentService,
      resolveServices: (scope) => windowRemoteConnectionRegistry.resolveScopedServices(scope),
      getBots: () => activeServices?.getOptional(IBotsService),
    });
    try {
      connection = await connectServerRemote(admission.target, {
        signal: params.signal,
        fetchImpl: requireActiveHostApiNetworkTransport().fetch,
        commitMembership: admission.commit,
        topicResourceChannel: topicResourceRelay.channel,
        onClose: ({ code, reason }) => {
          sourceClosed = true;
          detachOwnSourceSettings();
          notifyClose({ exitCode: code, signal: null, ...(reason ? { error: reason } : {}) });
        },
      });
    } catch (error) {
      topicResourceRelay.dispose();
      throw error;
    }
  } else {
    if (!sourceServerDirectory) {
      throw new Error("Source Server manager not yet initialized.");
    }
    const manager = await ensureSourceServerConnectionManager();
    const existingProfile = params.existingSourceServerId
      ? (await sourceServerDirectory.snapshot()).profiles.find(
          (item) => item.sourceServerId === params.existingSourceServerId,
        )
      : undefined;
    const existingConnection = params.existingSourceServerId
      ? manager.getOnlineConnection(params.existingSourceServerId)
      : undefined;
    if (params.existingSourceServerId && (!existingProfile || !existingConnection))
      throw new Error("project.host-offline");
    const { profile, connection: managed } =
      existingProfile && existingConnection
        ? { profile: existingProfile, connection: existingConnection }
        : await connectSourceServerTarget(sourceServerDirectory, manager, {
            membershipIntent: params.membershipIntent,
            target: params.target,
            allowInstall: params.confirmSourceServerInstall === true,
            resolveRelease: async (probe, target, options) =>
              await resolveSourceServerReleaseAsset(
                probe,
                params.remoteAssets,
                target,
                {
                  fetch: requireActiveHostApiNetworkTransport().fetch,
                },
                options,
              ),
            context: {
              signal: params.signal,
              onLog: (event) => {
                const progress =
                  event.progress == null
                    ? ""
                    : ` ${(Math.max(0, Math.min(1, event.progress)) * 100).toFixed(1)}%`;
                const message =
                  event.progress == null || event.message.startsWith("upload progress:")
                    ? `[source-server:${event.phase}] ${event.message}`
                    : `[source-server:${event.phase}] upload progress (${event.message}):${progress}`;
                remoteConnectionProgressContext.report(event.level ?? "info", [message]);
              },
            },
          });
    managedProfile = profile;
    reusedConnectionTarget = managed.reusedConnectionTarget;
    const sourceDirectorySnapshot = await sourceServerDirectory.snapshot();
    for (const server of sourceDirectorySnapshot.servers) {
      sourceServerDisplayNameById.set(server.sourceServerId, server.displayName);
    }
    managerStateSubscription = manager.onDidChangeState((state) => {
      if (state.profileId !== profile.profileId) return;
      if (state.state === "online") {
        lastNotifiedRecoveryAttempt = 0;
        return;
      }
      const closeEvent = createSourceServerRecoveryCloseEvent(state);
      if (!closeEvent) return;
      if (state.state === "retrying" && state.recoveryAttempt === lastNotifiedRecoveryAttempt) {
        return;
      }
      if (state.state === "retrying") {
        lastNotifiedRecoveryAttempt = state.recoveryAttempt ?? lastNotifiedRecoveryAttempt;
      }
      notifyClose(closeEvent);
    });
    connection = {
      serverInfo: managed.serverInfo,
      services: managed.services,
      dispose() {
      },
    };
    managerConnectionInvalidatedSubscription = manager.onDidInvalidateConnection((event) => {
      if (event.sourceServerId !== managed.sourceServerId || disposed) return;
      notifyClose({
        exitCode: null,
        signal: null,
        recoverable: event.reason === "update",
      });
    });
    managerReconnectSubscription = manager.onDidReconnect((reconnected) => {
      if (reconnected.sourceServerId !== managed.sourceServerId || disposed) return;
      connection = {
        serverInfo: reconnected.serverInfo,
        services: reconnected.services,
        dispose() {
        },
      };
      services = createServerRemoteWorkspaceServiceCollection({
        clientConfigService,
        connectionServices: reconnected.services,
        virtualProjects: reconnected.serverInfo.capabilities.virtualProjects,
        serverId: reconnected.serverInfo.serverId,
        sourceServices: activeServices ?? undefined,
        targetKind: params.target.kind,
      });
      refreshResourceTelemetry();
      lastNotifiedRecoveryAttempt = 0;
      for (const listener of reconnectListeners) listener();
    });
  }

  if (params.signal.aborted) {
    topicResourceRelay?.dispose();
    await disposeHostRemoteConnection(connection);
    throw new Error("Remote connection canceled.");
  }

  services = createServerRemoteWorkspaceServiceCollection({
    clientConfigService,
    connectionServices: connection.services,
    virtualProjects: connection.serverInfo.capabilities.virtualProjects,
    serverId: connection.serverInfo.serverId,
    targetKind: params.target.kind,
    sourceServices: activeServices ?? undefined,
  });
  if (params.target.kind === "server") {
    projectSubscription = connection.services.broadcastService.onMessage((event) => {
      if (!disposed && !sourceClosed && event.channel === "state:projects") notifyProjectChange();
    });
  }
  refreshResourceTelemetry();
  const remoteMediaPreviewFactory =
    params.target.kind === "server" || !remoteMediaRangePreviewEnabled
      ? undefined
      : (scope: Extract<WindowHostAttachmentScope, { kind: "remote" }>) =>
          createRemoteMediaPreviewProxy({
            fileService: services.get(IFileService),
            logger: {
              debug: (message, metadata) => {
                if (process.env.NODE_ENV !== "production") logger.info(message, metadata);
              },
              warn: (message, metadata) => logger.warn(message, metadata),
            },
            scope,
            requestLimiter: hostRemoteMediaRequestLimiter,
          });

  return {
    ...(reusedConnectionTarget ? { reusedConnectionTarget } : {}),
    get services() {
      return services;
    },
    capabilities: {
      sourceServerId: connection.serverInfo.serverId,
      physicalOwner: () => connection.services,
      ...(remoteMediaPreviewFactory ? { remoteMediaPreviewFactory } : {}),
      persistentSourceConnection: true,
      ...(managedProfile ? { profileId: managedProfile.profileId } : {}),
      ...(managedProfile
        ? {
            promptAttachmentTransferFactory: (
              scope: Extract<WindowHostAttachmentScope, { kind: "remote" }>,
            ) => {
              if (!sourceServerConnectionManager) throw new Error("Source Server is unavailable");
              return createRemotePromptAttachmentTransferService(
                sourceServerConnectionManager.getFileTransfer(connection.serverInfo.serverId),
                {
                  scope,
                  onJanitorError: (error) => logger.warn("remote attachment janitor failed", error),
                },
              );
            },
          }
        : {}),
      ...(managedProfile && sourceServerDirectory
        ? {
            bindWorkspaceIdentity: async (input) => {
              input.signal?.throwIfAborted();
              const currentRouteHint = buildRemoteWorkspaceIdentity(
                input.workspacePath,
                params.target,
              );
              const legacyRouteHint = await sourceServerDirectory!.resolveLegacyWorkspaceIdentity({
                profileId: managedProfile!.profileId,
                workspacePath: input.workspacePath,
                fallback: input.legacyRouteHint ?? currentRouteHint,
              });
              input.signal?.throwIfAborted();
              await connection.services.sourceServerWorkspaceService.resolveWorkspace({
                workspacePath: input.workspacePath,
                legacyRouteHint,
              });
            },
          }
        : {
            bindWorkspaceIdentity: async (input) => {
              await connection.services.sourceServerWorkspaceService.resolveWorkspace({
                workspacePath: input.workspacePath,
              });
            },
          }),
      ...(managedProfile && sourceServerDirectory
        ? {
            recordWorkspaceOpen: async (input) => {
              await sourceServerDirectory?.recordWorkspaceOpen({
                profileId: managedProfile!.profileId,
                sourceServerId: connection.serverInfo.serverId,
                ...input,
              });
            },
          }
        : {}),
    },
    onDidClose(listener) {
      closeListeners.add(listener);
      return { dispose: () => closeListeners.delete(listener) };
    },
    onDidReconnect(listener) {
      reconnectListeners.add(listener);
      return { dispose: () => reconnectListeners.delete(listener) };
    },
    async dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      detachOwnSourceSettings();
      topicResourceRelay?.dispose();
      closeListeners.clear();
      reconnectListeners.clear();
      managerStateSubscription?.dispose();
      managerConnectionInvalidatedSubscription?.dispose();
      managerReconnectSubscription?.dispose();
      projectSubscription?.dispose();
      resourceTelemetry?.dispose();
      await disposeHostRemoteConnection(connection);
    },
  };
}

const windowRemoteConnectionRegistry = createWindowRemoteConnectionRegistry<
  ServiceCollection,
  HostRemoteConnectionCapabilities
>({
  connect: (request) => createWindowRemoteConnectionHandle(request),
  createId: randomUUID,
  onConnectionChanged: notifyProjectChange,
  resolveSourceServerId: (handle) => handle.capabilities?.sourceServerId,
  shouldKeepConnectionAlive: (handle) => handle.capabilities?.persistentSourceConnection === true,
  prepareWorkspaceIdentity: async (handle, input) => {
    await prepareRemoteWorkspaceIdentity(
      handle.services.get(IFileService),
      input,
      handle.capabilities?.bindWorkspaceIdentity,
    );
  },
  releaseWorkspace: async (services, context) => {
    await services.get(ICfTaskService).releaseWorkspacePreparation({
      workspacePath: context.workspacePath,
      ...(context.workspaceIdentity ? { workspaceIdentity: context.workspaceIdentity } : {}),
      provider: "glm",
    });
    logger.info(
      `released WSL workspace runtime, workspaceKey=${context.workspaceIdentity?.trim() || context.workspacePath}`,
    );
  },
  onWorkspaceReleaseError: (context, error) => {
    logger.warn(
      `failed to release WSL workspace runtime, workspaceKey=${context.workspaceIdentity?.trim() || context.workspacePath}`,
      error,
    );
  },
  onSessionClosed: (event) => {
    windowHostAttachmentRegistry.detachRemoteSessionAttachments(event.remoteSessionId);
    const session = windowRemoteConnectionRegistry.getSession(event.remoteSessionId);
    if (session?.workspacePath && session.workspaceIdentity) {
      windowHostControllerRuntime.disconnectSource({
        kind: "remote",
        ...(session.sourceServerId ? { sourceServerId: session.sourceServerId } : {}),
        remoteSessionId: event.remoteSessionId,
        workspacePath: session.workspacePath,
        workspaceIdentity: session.workspaceIdentity,
      });
    }
    parentPort?.postMessage({
      type: HostResponseTypes.RemoteWorkspaceClosed,
      remoteSessionId: event.remoteSessionId,
      reason: "connection-closed",
      exitCode: event.exitCode,
      signal: event.signal,
      ...(event.recoverable !== undefined ? { recoverable: event.recoverable } : {}),
      ...(event.error ? { error: event.error } : {}),
      ...(event.recoveryAttempt ? { recoveryAttempt: event.recoveryAttempt } : {}),
      ...(event.recoveryLimit ? { recoveryLimit: event.recoveryLimit } : {}),
      ...(event.recoveryBudgetExhausted !== undefined
        ? { recoveryBudgetExhausted: event.recoveryBudgetExhausted }
        : {}),
      ...(event.reasonCode ? { reasonCode: event.reasonCode } : {}),
      ...(event.retryable !== undefined ? { retryable: event.retryable } : {}),
    });
    logWindowHostTopology("remote-connection-closed");
  },
  onSessionReconnected: async ({
    previous,
    current,
    services: currentServices,
    isCurrent,
    commit,
  }) => {
    if (
      !previous.workspacePath ||
      !previous.workspaceIdentity ||
      !current.workspacePath ||
      !current.workspaceIdentity
    ) {
      throw new Error("Source 重连换代缺少 workspace scope");
    }
    const previousScope = {
      kind: "remote" as const,
      ...(previous.sourceServerId ? { sourceServerId: previous.sourceServerId } : {}),
      remoteSessionId: previous.remoteSessionId,
      workspacePath: previous.workspacePath,
      workspaceIdentity: previous.workspaceIdentity,
    };
    const currentScope = {
      kind: "remote" as const,
      ...(current.sourceServerId ? { sourceServerId: current.sourceServerId } : {}),
      ...(current.sourceServerId && sourceServerDisplayNameById.get(current.sourceServerId)
        ? {
            serverDisplayName: sourceServerDisplayNameById.get(current.sourceServerId),
          }
        : {}),
      remoteSessionId: current.remoteSessionId,
      workspacePath: current.workspacePath,
      workspaceIdentity: current.workspaceIdentity,
    };
    await windowHostControllerRuntime.replaceDisconnectedSource(
      previousScope,
      {
        scope: currentScope,
        taskService: currentServices.get(ICfTaskService),
        agentService: currentServices.getOptional(ICfAgentService),
        sourceAvailability: "online",
      },
      {
        canCommit: isCurrent,
        rollbackOnFailure: true,
      },
    );
    if (!commit()) {
      throw new Error("Source 重连换代在 Controller 提交后失去 Registry owner");
    }
    try {
      parentPort?.postMessage({
        type: HostResponseTypes.RemoteWorkspaceReconnected,
        previousRemoteSessionId: previous.remoteSessionId,
        descriptor: {
          ...(current.sourceServerId ? { sourceServerId: current.sourceServerId } : {}),
          remoteSessionId: current.remoteSessionId,
          target: current.target,
          workspacePath: current.workspacePath,
          workspaceIdentity: current.workspaceIdentity,
          generation: current.generation,
        },
      });
    } catch (error) {
      logger.error("failed to publish committed remote workspace replacement", error);
    }
    logWindowHostTopology("remote-connection-reconnected");
  },
  onSessionReconnectError: (error) => {
    logger.warn("failed to replace Source Server logical sessions after reconnect", error);
  },
});

const windowHostControllerRuntime = createWindowHostControllerRuntime({
  createId: randomUUID,
  onSourceError: (scope, operation, error) => {
    logger.warn(
      `window Controller source ${operation} failed, scope=${scope.kind}, workspaceKey=${scope.workspaceIdentity?.trim() || scope.workspacePath}`,
      error,
    );
  },
  resolveSource: (scope) => {
    const remoteSession = windowRemoteConnectionRegistry.findSessionForWorkspace(scope);
    if (remoteSession?.workspacePath && remoteSession.workspaceIdentity) {
      const controllerScope = {
        kind: "remote" as const,
        ...(remoteSession.sourceServerId ? { sourceServerId: remoteSession.sourceServerId } : {}),
        ...(remoteSession.sourceServerId &&
        sourceServerDisplayNameById.get(remoteSession.sourceServerId)
          ? {
              serverDisplayName: sourceServerDisplayNameById.get(remoteSession.sourceServerId),
            }
          : {}),
        remoteSessionId: remoteSession.remoteSessionId,
        workspacePath: remoteSession.workspacePath,
        workspaceIdentity: remoteSession.workspaceIdentity,
      };
      if (remoteSession.sourceAvailability !== "online") {
        return {
          scope: controllerScope,
          sourceAvailability: "offline" as const,
        };
      }
      const services = windowRemoteConnectionRegistry.resolveScopedServices(controllerScope);
      return {
        scope: controllerScope,
        taskService: services.get(ICfTaskService),
        agentService: services.getOptional(ICfAgentService),
        sourceAvailability: "online" as const,
      };
    }
    if (scope.workspaceIdentity && isRemoteWorkspaceIdentity(scope.workspaceIdentity)) {
      const identity = parseRemoteWorkspaceIdentity(scope.workspaceIdentity);
      const connection =
        identity?.kind === "server" &&
        identity.sourceServerId &&
        identity.workspacePath === scope.workspacePath
          ? sourceServerConnectionManager?.getOnlineConnection(identity.sourceServerId)
          : undefined;
      const registered =
        identity?.kind === "server" &&
        identity.sourceServerId &&
        identity.workspacePath === scope.workspacePath
          ? windowRemoteConnectionRegistry.getOnlineSource(identity.sourceServerId)
          : undefined;
      if (identity?.kind === "server" && identity.sourceServerId && (connection || registered))
        return {
          scope: {
            kind: "remote" as const,
            sourceServerId: identity.sourceServerId,
            workspacePath: scope.workspacePath,
            workspaceIdentity: scope.workspaceIdentity,
          },
          taskService:
            connection?.services.cfTaskService ?? registered!.services.get(ICfTaskService),
          agentService:
            connection?.services.cfAgentService ??
            registered!.services.getOptional(ICfAgentService),
          sourceAvailability: "online" as const,
        };
      return null;
    }
    const taskService = activeServices?.getOptional(ICfTaskService);
    if (!taskService) {
      return null;
    }
    return {
      scope: {
        kind: "local" as const,
        workspacePath: scope.workspacePath,
        ...(scope.workspaceIdentity ? { workspaceIdentity: scope.workspaceIdentity } : {}),
      },
      taskService,
      agentService: activeServices?.getOptional(ICfAgentService),
      sourceAvailability: "online" as const,
    };
  },
});

function wireLocalResourceTelemetry(services: ServiceCollection): void {
  activeLocalResourceTelemetry?.dispose();
  activeLocalResourceTelemetry = registerHostServiceResourceTelemetry({
    services,
    postMessage: (message) => parentPort?.postMessage(message),
    runtimeSurface: "local",
    onError: (error) => logger.warn("local resource telemetry subscription failed", error),
  });
}

function disposeLocalResourceTelemetry(): void {
  try {
    activeLocalResourceTelemetry?.dispose();
  } catch {
  } finally {
    activeLocalResourceTelemetry = null;
  }
}

type ExposedServicePortHandle = {
  server: IChannelServer & { ready(): void };
  dispose(): void;
};

function createControllerRoutedTaskService(
  base: ICfTaskService,
  attachmentScope: WindowHostAttachmentScope,
): ICfTaskService {
  const route = async (
    params: {
      taskId: string;
      workspacePath: string;
      workspaceIdentity?: string;
    },
    mutation:
      | { kind: "pin"; pinned: boolean }
      | { kind: "archive"; archived: boolean }
      | { kind: "delete" }
      | { kind: "mark-read"; expectedUnreadAt?: number }
      | { kind: "mark-unread" },
  ) =>
    windowHostControllerRuntime.service.mutateTask({
      address: await windowHostControllerRuntime.resolveTaskAddress({
        taskId: params.taskId,
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
        attachmentScope,
      }),
      mutation,
    });

  return new Proxy(base, {
    get(target, property, receiver) {
      if (property === "setTaskPinned") {
        return async (params: Parameters<ICfTaskService["setTaskPinned"]>[0]) => {
          const meta = await route(params, {
            kind: "pin",
            pinned: params.pinned,
          });
          if (!meta) throw new Error("Task projection missing after pin mutation.");
          return meta;
        };
      }
      if (property === "archiveTask" || property === "unarchiveTask") {
        return async (
          params:
            | Parameters<ICfTaskService["archiveTask"]>[0]
            | Parameters<ICfTaskService["unarchiveTask"]>[0],
        ) => {
          const meta = await route(params, {
            kind: "archive",
            archived: property === "archiveTask",
          });
          if (!meta) throw new Error("Task projection missing after archive mutation.");
          return meta;
        };
      }
      if (property === "deleteTask") {
        return async (params: Parameters<ICfTaskService["deleteTask"]>[0]) => {
          await route(params, { kind: "delete" });
        };
      }
      if (property === "deleteArchivedTasks") {
        return async (params: Parameters<ICfTaskService["deleteArchivedTasks"]>[0]) => {
          if (params.taskIds.length === 0) {
            return { deletedTaskIds: [], skippedTaskIds: [], failedTaskIds: [] };
          }
          return windowHostControllerRuntime.service.deleteArchivedTasks({
            address: await windowHostControllerRuntime.resolveTaskAddress({
              workspacePath: params.workspacePath,
              workspaceIdentity: params.workspaceIdentity,
              taskId: params.taskIds[0]!,
              attachmentScope,
              allowMissingTask: true,
            }),
            taskIds: params.taskIds,
          });
        };
      }
      if (property === "deleteArchivedTask") {
        return async (params: Parameters<ICfTaskService["deleteArchivedTask"]>[0]) =>
          windowHostControllerRuntime.service.deleteArchivedTask({
            address: await windowHostControllerRuntime.resolveTaskAddress({
              ...params,
              attachmentScope,
              allowMissingTask: true,
            }),
          });
      }
      if (property === "setTaskUnread") {
        return async (params: Parameters<ICfTaskService["setTaskUnread"]>[0]) => {
          const meta = await route(
            params,
            params.unread
              ? { kind: "mark-unread" }
              : {
                  kind: "mark-read",
                  ...(params.expectedUnreadAt != null
                    ? { expectedUnreadAt: params.expectedUnreadAt }
                    : {}),
                },
          );
          if (!meta) throw new Error("Task projection missing after unread mutation.");
          return meta;
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      if (
        typeof value === "function" &&
        [
          "getBotGroupTaskBlockReason",
          "cancelBotGroupInput",
          "submitBotGroupInput",
          "readBotTopicSummaries",
        ].includes(String(property))
      ) {
        return (params: Record<string, unknown>) =>
          value.call(target, bindBotGroupTaskScope(params, attachmentScope));
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function exposeServicesOnMessagePort(
  port: Electron.MessagePortMain,
  services: ServiceCollection,
  deferInit: boolean,
  clientMode: CfAgentV4ClientMode = "desktop-continuous",
  attachmentScope: WindowHostAttachmentScope = { kind: "local" },
  capabilities?: HostRemoteConnectionCapabilities,
): ExposedServicePortHandle {
  const wrappedPort = wrapElectronPort(port);
  const protocol = new MessagePortProtocol(wrappedPort);
  logger.info(`creating ChannelServer (deferInit=${deferInit})`);
  const rawServer = new ChannelServer(protocol, "host", 1000, deferInit);
  const loggedServer = new LoggingChannelServer(rawServer, logRpc);
  const server = new NetworkTelemetryChannelServer(loggedServer);
  const agentService = services.getOptional(ICfAgentService);
  const connectionContext = { connectionId: `host-rpc-${randomUUID()}`, clientMode };
  const connectionScope = agentService
    ? createCfAgentConnectionScope(agentService, connectionContext)
    : undefined;
  services.register(IWindowControllerService, windowHostControllerRuntime.service);
  const controllerAttachment = windowHostControllerRuntime.createAttachmentService(
    clientMode === "desktop-continuous" && attachmentScope.kind === "local",
  );
  const overrides = new Map<string, unknown>([
    [IWindowControllerService.channelName, controllerAttachment],
  ]);
  if (
    clientMode === "web-remote-replayable" &&
    attachmentScope.kind === "remote" &&
    activeServices
  ) {
    overrides.set(IProjectService.channelName, activeServices.get(IProjectService));
    overrides.set(IRemoteProjectService.channelName, activeServices.get(IRemoteProjectService));
    services.register(ITaskGroupService, activeServices.get(ITaskGroupService));
  }
  const remoteMediaPreviewProxy =
    attachmentScope.kind === "remote" && clientMode === "desktop-continuous"
      ? capabilities?.remoteMediaPreviewFactory?.(attachmentScope)
      : undefined;
  if (remoteMediaPreviewProxy) {
    overrides.set(IMediaPreviewService.channelName, remoteMediaPreviewProxy.service);
  }
  const remotePromptAttachmentTransfer =
    attachmentScope.kind === "remote"
      ? capabilities?.promptAttachmentTransferFactory?.(attachmentScope)
      : undefined;
  const { dispose: disposePromptAttachmentTransfer, ...promptAttachmentService } =
    remotePromptAttachmentTransfer ?? {};
  if (remotePromptAttachmentTransfer) {
    overrides.set(IPromptAttachmentTransferService.channelName, promptAttachmentService);
  }
  const taskService = services.getOptional(ICfTaskService);
  if (taskService) {
    overrides.set(
      ICfTaskService.channelName,
      createControllerRoutedTaskService(taskService, attachmentScope),
    );
  }
  if (connectionScope) {
    overrides.set(ICfAgentService.channelName, connectionScope.service);
  }
  const conversationShareService = services.getOptional(IConversationShareService);
  if (conversationShareService) {
    overrides.set(
      IConversationShareService.channelName,
      scopeConversationShareServiceForAttachment(
        conversationShareService,
        clientMode,
        connectionScope?.service,
        connectionContext,
      ),
    );
  }
  exposeWindowHostAttachmentServices({
    server,
    services,
    overrides,
    clientMode,
    attachmentScope,
    windowServices: activeServices ?? undefined,
  });
  let disposed = false;
  let flowUpdateChain = Promise.resolve();
  const forwardFlowState = (state: "saturated" | "drained" | "closed") => {
    if (!connectionScope) return Promise.resolve();
    const update = flowUpdateChain.then(() => connectionScope.setTransportFlowState(state));
    flowUpdateChain = update.catch((error) => {
      logger.warn("failed to forward attachment connection flow state", {
        state,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return update;
  };
  const flowStateDisposable = protocol.onFlowState((state) => {
    if (disposed) return;
    void forwardFlowState(state).catch(() => {});
  });
  const handle: ExposedServicePortHandle = {
    server,
    dispose() {
      if (disposed) return;
      disposed = true;
      flowStateDisposable.dispose();
      controllerAttachment.dispose();
      void disposePromptAttachmentTransfer?.().catch((error: unknown) => {
        logger.warn("failed to dispose remote attachment transfer", error);
      });
      void remoteMediaPreviewProxy?.dispose().catch((error: unknown) => {
        logger.warn("failed to dispose remote media preview proxy", error);
      });
      void forwardFlowState("closed")
        .catch(() => {})
        .then(() => connectionScope?.dispose());
      rawServer.dispose();
      protocol.disconnect();
    },
  };
  port.once("close", () => handle.dispose());
  logger.info(`service connection ready mode=${clientMode}`);
  return handle;
}

const windowHostAttachmentRegistry = createWindowHostAttachmentRegistry<
  ServiceCollection,
  Electron.MessagePortMain,
  HostRemoteConnectionCapabilities
>({
  resolveScope: (scope: WindowHostAttachmentScope) => {
    if (scope.kind === "local") {
      if (!activeServices) {
        throw new Error("Local services not yet initialized.");
      }
      return { services: activeServices, generation: 1 };
    }
    if (scope.kind === "source-settings") {
      const connection = sourceServerConnectionManager?.getOnlineConnection(scope.sourceServerId);
      const registered = windowRemoteConnectionRegistry.getOnlineSource(scope.sourceServerId);
      const configServices = connection?.services ?? registered?.services;
      if (!configServices) {
        throw new Error(`Source Server is offline: ${scope.sourceServerId}`);
      }
      return {
        services: createSourceSettingsServiceCollection(configServices),
        generation:
          sourceServerConnectionManager
            ?.listStates()
            .find((state) => state.sourceServerId === scope.sourceServerId)?.updatedAt ?? 1,
      };
    }
    const session = windowRemoteConnectionRegistry.getSession(scope.remoteSessionId);
    if (!session) {
      throw new Error(`未找到Remote logical session，remoteSessionId=${scope.remoteSessionId}`);
    }
    return {
      services: windowRemoteConnectionRegistry.resolveScopedServices(scope),
      generation: session.generation,
      capabilities: windowRemoteConnectionRegistry.resolveScopedCapabilities(scope),
    };
  },
  expose: ({ port, services, clientMode, scope, capabilities }) =>
    exposeServicesOnMessagePort(port, services, false, clientMode, scope, capabilities),
});

function logWindowHostTopology(reason: string): void {
  const stats = windowRemoteConnectionRegistry.getStats();
  logger.info(
    `window Host topology, reason=${reason}, pid=${process.pid}, connections=${stats.connectionCount}, logicalSessions=${stats.logicalSessionCount}, attachments=${windowHostAttachmentRegistry.size()}`,
  );
}

function disposeAttachedServicePorts(): void {
  windowHostAttachmentRegistry.dispose();
}

async function disposeHostResources(reason: string): Promise<HostShutdownResult> {
  databaseStartup?.dispose();
  pendingStartupAttachments.clear();
  if (hasDisposedHostResources) {
    return (
      (await disposeHostResourcesInFlight) ?? {
        exitCode: 0,
        failedPhases: [],
        timedOutPhases: [],
      }
    );
  }
  hasDisposedHostResources = true;
  for (const controller of projectNavigationAbortControllers.values()) controller.abort();
  projectNavigationAbortControllers.clear();

  disposeHostResourcesInFlight = (async () => {
    logger.info(`disposing host resources, reason=${reason}`);

    pluginSandboxRegistrationBridge.dispose();
    stopHostNetworkTelemetry();
    hostNetworkCapture.setCaptureId(null);
    hostSelfResourceTelemetry.stop();
    disposeLocalResourceTelemetry();
    disposeAttachedServicePorts();
    windowHostControllerRuntime.dispose();
    for (const key of Array.from(cronRunSubscriptions.keys())) {
      disposeCronRunSubscription(key);
    }
    cronAutomationRepo.close();
    for (const key of Array.from(offPeakRunSubscriptions.keys())) {
      disposeOffPeakRunSubscription(key);
    }
    disposeOffPeakRuntime();
    offPeakTaskRepo.close();

    if (activeSessionRealtimePort) {
      activeSessionRealtimePort.dispose();
      activeSessionRealtimePort = null;
    }

    const servicesToDispose = activeServices;
    activeServices = null;
    const shutdownResult = await runHostShutdownPhases(
      [
        {
          name: "remote-registry-dispose",
          run: () => windowRemoteConnectionRegistry.dispose(),
          timeoutMs: 6_000,
        },
        {
          name: "source-server-manager-dispose",
          run: async () => {
            sourceServerConnectionManager?.dispose();
            sourceServerManagementService?.dispose();
            sourceSettingsStateSubscription?.dispose();
            sourceServerConnectionManager = null;
            sourceServerManagementService = null;
            sourceSettingsStateSubscription = null;
            sourceServerDirectory = null;
          },
          timeoutMs: 2_000,
        },
        ...(servicesToDispose
          ? [
              {
                name: "service-dispose",
                run: () => disposeServiceResourcesAndWait(servicesToDispose),
                timeoutMs: 3_500,
              },
            ]
          : []),
      ],
      {
        phaseTimeoutMs: 5_000,
        log: (message, details) => logger.warn(message, details),
      },
    );
    if (shutdownResult.exitCode !== 0) {
      logger.warn("host resource cleanup completed with errors", {
        failedPhases: shutdownResult.failedPhases,
        reason,
        timedOutPhases: shutdownResult.timedOutPhases,
      });
    }
    activeHostApiNetworkTransport = null;
    return shutdownResult;
  })();

  const shutdownResult = await disposeHostResourcesInFlight;
  flushHostE2ECoverage((error) => {
    logger.warn("[e2e-coverage] host coverage flush failed", error);
  });
  return shutdownResult;
}

function disposeHostResourcesBestEffort(reason: string): void {
  if (hasDisposedHostResources) {
    return;
  }
  hasDisposedHostResources = true;

  logger.info(`disposing host resources, reason=${reason}`);
  pluginSandboxRegistrationBridge.dispose();
  stopHostNetworkTelemetry();
  hostNetworkCapture.setCaptureId(null);
  disposeLocalResourceTelemetry();
  disposeAttachedServicePorts();
  windowHostControllerRuntime.dispose();
  for (const key of Array.from(cronRunSubscriptions.keys())) {
    disposeCronRunSubscription(key);
  }
  cronAutomationRepo.close();
  for (const key of Array.from(offPeakRunSubscriptions.keys())) {
    disposeOffPeakRunSubscription(key);
  }
  disposeOffPeakRuntime();
  offPeakTaskRepo.close();
  void windowRemoteConnectionRegistry.dispose();

  if (activeServices) {
    try {
      disposeServiceResources(activeServices);
    } catch (error) {
      logger.error("failed to dispose local services:", error);
    } finally {
      activeServices = null;
      activeHostApiNetworkTransport = null;
    }
  }

  if (activeSessionRealtimePort) {
    activeSessionRealtimePort.dispose();
    activeSessionRealtimePort = null;
  }
}

process.once("SIGTERM", () => {
  void disposeHostResources("SIGTERM").then(
    (result) => process.exit(result.exitCode),
    () => process.exit(1),
  );
});

process.once("SIGINT", () => {
  void disposeHostResources("SIGINT").then(
    (result) => process.exit(result.exitCode),
    () => process.exit(1),
  );
});

process.once("disconnect", () => {
  void disposeHostResources("disconnect").finally(() => process.exit(1));
});

process.once("exit", () => {
  disposeHostResourcesBestEffort("exit");
});

let handlingFatalUncaughtException = false;
process.on(
  "uncaughtException",
  createHostUncaughtExceptionHandler({
    onRecovered: (error, origin) => {
      const memoryUsage = process.memoryUsage();
      logger.warn("contained host allocation failure from native TLS callback", {
        arrayBuffers: memoryUsage.arrayBuffers,
        external: memoryUsage.external,
        heapUsed: memoryUsage.heapUsed,
        message: error.message,
        origin,
        rss: memoryUsage.rss,
      });
    },
    onFatal: (error, origin) => {
      if (handlingFatalUncaughtException) {
        process.exit(1);
      }
      handlingFatalUncaughtException = true;
      logger.error(`uncaughtException origin=${origin}:`, error);
      void disposeHostResources(`uncaughtException:${origin}`).finally(() => process.exit(1));
    },
  }),
);

parentPort.on("message", async (e: Electron.MessageEvent) => {
  const result = parseHostIncomingMessageEvent(e);
  if (!result.success) {
    logger.error("invalid parentPort message:", formatZodError(result.error));
    return;
  }

  const msg = result.data;
  if (msg.type === HostMessageTypes.InitLocal && msg.locale) {
    applicationLocale = msg.locale;
  }
  if (msg.type === HostMessageTypes.ApplicationLocaleChanged) {
    applicationLocale = msg.locale;
    return;
  }
  if (msg.type === HostMessageTypes.NetworkCapture) {
    hostNetworkCapture.setCaptureId(msg.control.captureId);
    return;
  }
  const port = e.ports[0];
  if (msg.type === HostMessageTypes.DatabaseStartupControl) {
    if (msg.control.action === "snapshot") databaseStartup?.coordinator.publish();
    else if (msg.control.action === "retry")
      void databaseStartup?.coordinator.retry(msg.control.attemptId);
    return;
  }

  if (msg.type === HostMessageTypes.PrepareProjectWorkspace) {
    const controller = new AbortController();
    if (projectNavigationAbortControllers.has(msg.requestId)) {
      parentPort.postMessage({
        type: HostResponseTypes.ProjectWorkspacePrepared,
        requestId: msg.requestId,
        result: { ok: false, error: "Project navigation requestId duplicated." },
      });
      return;
    }
    projectNavigationAbortControllers.set(msg.requestId, controller);
    try {
      const services = activeServices;
      if (!services || hasDisposedHostResources) throw new Error("Window Host is unavailable");
      const assertHost = () => {
        controller.signal.throwIfAborted();
        if (activeServices !== services || hasDisposedHostResources)
          throw new Error("Window Host changed during project navigation");
      };
      const navigation = createProjectWorkspaceNavigation({
        projectService: services.get(IProjectService),
        remoteProjectService: services.get(IRemoteProjectService),
        readConnectionOwner: (hostId) => resolveBotProjectConnection(hostId)?.owner,
        openRemoteWorkspace: async ({ host, directories, owner, assertCurrent }) => {
          assertHost();
          const serverId = parseRemoteWorkspaceIdentity(
            buildRemoteHostWorkspaceIdentity(host.id, directories.workspacePath),
          )?.sourceServerId;
          if (!serverId || !host.target) throw new Error("project.host-offline");
          const registered = await windowRemoteConnectionRegistry.connectSource({
            target: host.target,
            remoteAssets: {},
            membershipIntent: "retain",
            existingSourceServerId: serverId,
          });
          assertHost();
          if (
            (registered.handle.capabilities?.physicalOwner?.() ?? registered.handle.services) !==
            owner
          )
            throw new Error("project.navigation-stale");
          return windowRemoteConnectionRegistry.openWorkspaceOnSource({
            requestId: msg.requestId,
            sourceServerId: serverId,
            workspacePath: directories.workspacePath,
            workspaceIdentity: directories.workspaceIdentity,
            workspacePurpose: directories.projectId ? "project" : "conversation",
            assertCurrent: async () => {
              assertHost();
              await assertCurrent();
              assertHost();
            },
          });
        },
      });
      const value = await navigation.prepare({
        projectId: msg.projectId,
        hostId: msg.hostId,
        draftId: msg.draftId,
        reuseDraft: msg.reuseDraft,
        ...(msg.task ? { task: msg.task } : {}),
      });
      assertHost();
      parentPort.postMessage({
        type: HostResponseTypes.ProjectWorkspacePrepared,
        requestId: msg.requestId,
        result: { ok: true, value },
      });
    } catch (error) {
      parentPort.postMessage({
        type: HostResponseTypes.ProjectWorkspacePrepared,
        requestId: msg.requestId,
        result: { ok: false, error: error instanceof Error ? error.message : String(error) },
      });
    } finally {
      if (projectNavigationAbortControllers.get(msg.requestId) === controller)
        projectNavigationAbortControllers.delete(msg.requestId);
    }
    return;
  }

  if (msg.type === HostMessageTypes.CuaPipFocusChanged) {
    const service = activeServices?.getOptional(ICuaPipSessionService);
    if (service) {
      void service.publishFocus(msg.event);
    } else {
      logger.warn("[cua-pip-session] focus event dropped: service unavailable");
    }
    return;
  }

  if (msg.type === HostMessageTypes.ResourceUsageSnapshotRequest) {
    void hostResourceUsageResponder.handleRequest(msg);
    return;
  }
  if (msg.type === HostMessageTypes.ResourceUsageSnapshotCancel) {
    hostResourceUsageResponder.cancelRequest(msg.requestId);
    return;
  }

  if (msg.type === HostMessageTypes.FeedbackLogArchiveResult) {
    const pending = pendingFeedbackLogArchiveRequests.get(msg.requestId);
    if (!pending) {
      return;
    }
    pendingFeedbackLogArchiveRequests.delete(msg.requestId);
    if (msg.ok && msg.path && typeof msg.size === "number") {
      pending.onProgress?.({ processedBytes: msg.size, totalBytes: msg.size });
      pending.resolve({ path: msg.path, size: msg.size });
      return;
    }
    pending.reject(new Error(msg.error ?? "Feedback log archive creation failed."));
    return;
  }

  if (msg.type === HostMessageTypes.LocalMediaPreviewPathAuthorizeResult) {
    const pending = pendingLocalMediaPreviewPathAuthorizations.get(msg.requestId);
    if (!pending) return;
    pendingLocalMediaPreviewPathAuthorizations.delete(msg.requestId);
    if (msg.ok && msg.path) {
      logger.info("local media preview path authorization OK");
      pending.resolve(msg.path);
    } else {
      pending.reject(new Error(msg.error ?? "Local video preview path authorization failed."));
    }
    return;
  }

  if (msg.type === HostMessageTypes.PluginSandboxRegisterResult) {
    pluginSandboxRegistrationBridge.accept(msg);
    return;
  }

  if (msg.type === HostMessageTypes.CronRun) {
    if (databaseStartup?.coordinator.snapshot.phase !== "ready") {
      parentPort.postMessage({
        type: HostResponseTypes.CronRunResult,
        runId: msg.runId,
        ok: false,
        error: "Local database startup is not ready",
        failureKind: "transient",
      });
      return;
    }
    void (async () => {
      try {
        const dispatchResult = await dispatchCronRun({
          ...msg,
          mode: msg.mode as CfTaskMode | undefined,
        });
        parentPort.postMessage({
          type: HostResponseTypes.CronRunResult,
          runId: msg.runId,
          ok: true,
          ...dispatchResult,
        });
      } catch (error) {
        parentPort.postMessage({
          type: HostResponseTypes.CronRunResult,
          runId: msg.runId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          failureKind: "transient",
        });
      }
    })();
    return;
  }

  if (msg.type === HostMessageTypes.OffPeakRun) {
    if (databaseStartup?.coordinator.snapshot.phase !== "ready") {
      parentPort.postMessage({
        type: HostResponseTypes.OffPeakRunResult,
        offPeakTaskId: msg.offPeakTaskId,
        ok: false,
        error: "Local database startup is not ready",
        failureKind: "transient",
      });
      return;
    }
    void (async () => {
      try {
        const dispatchResult = await dispatchOffPeakRun(msg);
        parentPort.postMessage({
          type: HostResponseTypes.OffPeakRunResult,
          offPeakTaskId: msg.offPeakTaskId,
          ok: true,
          ...dispatchResult,
        });
      } catch (error) {
        parentPort.postMessage({
          type: HostResponseTypes.OffPeakRunResult,
          offPeakTaskId: msg.offPeakTaskId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          failureKind: error instanceof OffPeakPermanentDispatchError ? "permanent" : "transient",
        });
      }
    })();
    return;
  }

  if (msg.type === HostMessageTypes.BrowserExecuteResult) {
    void browserControlMainBridge.handleResult({
      requestId: msg.requestId,
      result: msg.result,
    });
    return;
  }

  if (msg.type === HostMessageTypes.Dispose) {
    const result = await disposeHostResources("parent dispose");
    process.exit(result.exitCode);
    return;
  }

  if (msg.type === HostMessageTypes.Broadcast) {
    return;
  }

  if (msg.type === HostMessageTypes.SessionMessageDeliver) {
    const cfTaskService = activeServices?.getOptional(ICfTaskService);
    if (!cfTaskService) {
      parentPort.postMessage({
        type: HostResponseTypes.SessionMessageDeliverResult,
        result: {
          error: "CodeFusion task service is not initialized.",
          messageId: msg.request.messageId,
          requestId: msg.request.requestId,
          sessionId: msg.request.fromSessionId,
          status: "failed",
        },
      });
      return;
    }

    void cfTaskService
      .deliverSessionMessage(msg.request)
      .then((deliveryResult) => {
        parentPort.postMessage({
          type: HostResponseTypes.SessionMessageDeliverResult,
          result: deliveryResult,
        });
      })
      .catch((error) => {
        parentPort.postMessage({
          type: HostResponseTypes.SessionMessageDeliverResult,
          result: {
            error: error instanceof Error ? error.message : String(error),
            messageId: msg.request.messageId,
            requestId: msg.request.requestId,
            sessionId: msg.request.fromSessionId,
            status: "failed",
          },
        });
      });
    return;
  }

  if (msg.type === HostMessageTypes.SessionMessageDeliveryResult) {
    const cfTaskService = activeServices?.getOptional(ICfTaskService);
    if (!cfTaskService) {
      logger.warn("session message delivery result received before CodeFusion task service initialized");
      return;
    }
    void cfTaskService.sendSessionMessageDeliveryResult(msg.result).catch((error) => {
      logger.warn("failed to forward session message delivery result:", error);
    });
    return;
  }

  if (msg.type === HostMessageTypes.ProviderProvisioningExecute) {
    const session = windowRemoteConnectionRegistry.getSession(msg.remoteSessionId);
    if (
      !session ||
      !session.workspaceIdentity ||
      buildRemoteEnvironmentKey(session.target) !== msg.environmentKey
    ) {
      parentPort.postMessage({
        type: HostResponseTypes.ProviderProvisioningExecutionResult,
        requestId: msg.requestId,
        environmentKey: msg.environmentKey,
        status: "failed",
        error: "Remote Environment registration expired.",
        errorCode: "session-unavailable",
      });
      return;
    }
    const scope = {
      kind: "remote",
      remoteSessionId: session.remoteSessionId,
      workspacePath: session.workspacePath ?? "/",
      workspaceIdentity: session.workspaceIdentity,
    } as const;
    void Promise.resolve()
      .then(() =>
        (() => {
          const provisioningService = getRemoteProviderProvisioningExecutor(
            windowRemoteConnectionRegistry.resolveScopedServices(scope),
          );
          if (!provisioningService) {
            throw new Error("Remote Environment does not support Provider Provisioning.");
          }
          return provisioningService.syncLocalToRemote();
        })(),
      )
      .then((result) => {
        parentPort.postMessage({
          type: HostResponseTypes.ProviderProvisioningExecutionResult,
          requestId: msg.requestId,
          environmentKey: msg.environmentKey,
          status: result.status,
          ...(result.errorMessage ? { error: result.errorMessage } : {}),
          ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        });
      })
      .catch((error: unknown) => {
        parentPort.postMessage({
          type: HostResponseTypes.ProviderProvisioningExecutionResult,
          requestId: msg.requestId,
          environmentKey: msg.environmentKey,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          errorCode: "host-execution-failed",
        });
      });
    return;
  }

  if (msg.type === HostMessageTypes.ConnectRemoteWorkspace) {
    const workspacePath =
      msg.workspacePath ??
      (msg.target.kind === "server" ? msg.target.workspacePath?.trim() || "/" : "/");
    const workspaceIdentity =
      msg.workspaceIdentity ?? buildRemoteWorkspaceIdentity(workspacePath, msg.target);
    logger.info(
      `connecting window-scoped remote source, requestId=${msg.requestId}, target=${formatRemoteTargetForLog(msg.target)}`,
    );
    void remoteConnectionProgressContext
      .run(msg.requestId, () =>
        windowRemoteConnectionRegistry.connect({
          requestId: msg.requestId,
          target: msg.target,
          remoteAssets: msg.remoteAssets,
          workspacePath,
          workspaceIdentity,
          ...(msg.confirmSourceServerInstall ? { confirmSourceServerInstall: true } : {}),
        }),
      )
      .then(async (descriptor) => {
        const replacedOfflineSessions = windowRemoteConnectionRegistry
          .listSessions()
          .filter(
            (session) =>
              session.remoteSessionId !== descriptor.remoteSessionId &&
              session.state === "disconnected" &&
              session.workspacePath === descriptor.workspacePath &&
              session.workspaceIdentity === descriptor.workspaceIdentity,
          );
        for (const replaced of replacedOfflineSessions) {
          if (replaced.workspacePath && replaced.workspaceIdentity) {
            const previousScope = {
              kind: "remote",
              ...(replaced.sourceServerId ? { sourceServerId: replaced.sourceServerId } : {}),
              remoteSessionId: replaced.remoteSessionId,
              workspacePath: replaced.workspacePath,
              workspaceIdentity: replaced.workspaceIdentity,
            } as const;
            const nextScope = {
              kind: "remote",
              ...(descriptor.sourceServerId ? { sourceServerId: descriptor.sourceServerId } : {}),
              remoteSessionId: descriptor.remoteSessionId,
              workspacePath: replaced.workspacePath,
              workspaceIdentity: replaced.workspaceIdentity,
            } as const;
            try {
              const services = windowRemoteConnectionRegistry.resolveScopedServices(nextScope);
              await windowHostControllerRuntime.replaceDisconnectedSource(previousScope, {
                scope: nextScope,
                taskService: services.get(ICfTaskService),
                sourceAvailability: "online",
              });
            } catch (error) {
              logger.warn("failed to atomically replace disconnected Controller source", error);
            }
          }
          windowHostAttachmentRegistry.detachRemoteSessionAttachments(replaced.remoteSessionId);
          await windowRemoteConnectionRegistry.disposeSession(replaced.remoteSessionId);
          parentPort.postMessage({
            type: HostResponseTypes.RemoteWorkspaceClosed,
            remoteSessionId: replaced.remoteSessionId,
            reason: "disposed",
          });
        }
        parentPort.postMessage({
          type: HostResponseTypes.RemoteWorkspaceConnected,
          requestId: msg.requestId,
          descriptor,
        });
        logWindowHostTopology("remote-connected");
      })
      .catch((error) => {
        const failure = normalizeRemoteConnectionError(error);
        parentPort.postMessage({
          type: HostResponseTypes.RemoteWorkspaceConnectFailed,
          requestId: msg.requestId,
          error: sanitizeRemoteConnectionLog(failure.message) || "Remote connection failed",
          reasonCode: failure.code,
          ...(error instanceof SourceServerUpgradeRequiredError ||
          error instanceof SourceServerInstallRequiredError
            ? { profileId: error.profileId }
            : {}),
          ...((error instanceof SourceServerInstallRequiredError ||
            error instanceof SourceServerUpgradeRequiredError) &&
          msg.target.kind === "wsl"
            ? { resolvedWslTarget: msg.target }
            : {}),
          ...(failure.retryable === undefined ? {} : { retryable: failure.retryable }),
        });
      });
    return;
  }

  if (msg.type === HostMessageTypes.CancelRemoteWorkspaceConnect) {
    projectNavigationAbortControllers.get(msg.requestId)?.abort();
    windowRemoteConnectionRegistry.cancelConnect(msg.requestId);
    return;
  }

  if (msg.type === HostMessageTypes.CancelRemoteWorkspaceBind) {
    cancelledWorkspaceBindRequestIds.add(msg.requestId);
    workspaceBindAbortControllers.get(msg.requestId)?.abort();
    if (!activeWorkspaceBindRequestIds.has(msg.requestId)) {
      parentPort.postMessage({
        type: HostResponseTypes.RemoteWorkspaceContextBindFailed,
        requestId: msg.requestId,
        error: "Remote workspace bind was canceled",
        reasonCode: REMOTE_BIND_CANCELED_ERROR_CODE,
        retryable: false,
      });
      cancelledWorkspaceBindRequestIds.delete(msg.requestId);
      workspaceBindAbortControllers.delete(msg.requestId);
    }
    return;
  }

  if (msg.type === HostMessageTypes.BindRemoteWorkspaceContext) {
    activeWorkspaceBindRequestIds.add(msg.requestId);
    const bindAbortController = new AbortController();
    workspaceBindAbortControllers.set(msg.requestId, bindAbortController);
    if (cancelledWorkspaceBindRequestIds.has(msg.requestId)) {
      bindAbortController.abort();
      parentPort.postMessage({
        type: HostResponseTypes.RemoteWorkspaceContextBindFailed,
        requestId: msg.requestId,
        error: "Remote workspace bind was canceled",
        reasonCode: REMOTE_BIND_CANCELED_ERROR_CODE,
        retryable: false,
      });
      activeWorkspaceBindRequestIds.delete(msg.requestId);
      cancelledWorkspaceBindRequestIds.delete(msg.requestId);
      workspaceBindAbortControllers.delete(msg.requestId);
      return;
    }
    const previous = windowRemoteConnectionRegistry.getSession(msg.remoteSessionId);
    let workspaceReady: Promise<void>;
    try {
      workspaceReady = windowRemoteConnectionRegistry.bindWorkspaceContext({
        remoteSessionId: msg.remoteSessionId,
        workspacePath: msg.workspacePath,
        workspaceIdentity: msg.workspaceIdentity,
        ...(msg.workspacePurpose ? { workspacePurpose: msg.workspacePurpose } : {}),
        ...(msg.legacyRouteHint ? { legacyWorkspaceIdentity: msg.legacyRouteHint } : {}),
        signal: bindAbortController.signal,
      });
    } catch (error) {
      logger.warn(
        `failed to bind remote workspace context, remoteSessionId=${msg.remoteSessionId}`,
        error,
      );
      parentPort.postMessage({
        type: HostResponseTypes.RemoteWorkspaceContextBindFailed,
        requestId: msg.requestId,
        error: error instanceof Error ? error.message : String(error),
        ...(error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? { reasonCode: error.code }
          : {}),
        ...(error &&
        typeof error === "object" &&
        "retryable" in error &&
        typeof error.retryable === "boolean"
          ? { retryable: error.retryable }
          : {}),
      });
      activeWorkspaceBindRequestIds.delete(msg.requestId);
      cancelledWorkspaceBindRequestIds.delete(msg.requestId);
      workspaceBindAbortControllers.delete(msg.requestId);
      return;
    }
    const current = windowRemoteConnectionRegistry.getSession(msg.remoteSessionId);
    if (current) {
      windowHostAttachmentRegistry.detachStaleRemoteSessionAttachments(
        msg.remoteSessionId,
        current.generation,
      );
    }
    void workspaceReady
      .then(async () => {
        if (cancelledWorkspaceBindRequestIds.has(msg.requestId)) {
          throw Object.assign(new Error("Remote workspace bind was canceled"), {
            code: REMOTE_BIND_CANCELED_ERROR_CODE,
            retryable: false,
          });
        }
        const currentSession = windowRemoteConnectionRegistry.getSession(msg.remoteSessionId);
        if (!currentSession?.workspaceIdentity) {
          throw Object.assign(
            new Error(`Remote workspace bind Completed时 session 已Invalid: ${msg.remoteSessionId}`),
            {
              code: REMOTE_WORKSPACE_BIND_SESSION_MISSING_ERROR_CODE,
              retryable: true,
            },
          );
        }
        const scope = {
          kind: "remote" as const,
          ...(currentSession.sourceServerId
            ? { sourceServerId: currentSession.sourceServerId }
            : {}),
          remoteSessionId: msg.remoteSessionId,
          workspacePath: msg.workspacePath,
          workspaceIdentity: currentSession.workspaceIdentity,
        };
        await windowRemoteConnectionRegistry
          .resolveScopedCapabilities(scope)
          ?.recordWorkspaceOpen?.({
            workspacePath: msg.workspacePath,
            workspaceIdentity: currentSession.workspaceIdentity,
            ...(msg.workspacePurpose ? { workspacePurpose: msg.workspacePurpose } : {}),
            ...(msg.legacyRouteHint ? { legacyWorkspaceIdentity: msg.legacyRouteHint } : {}),
            signal: bindAbortController.signal,
          });
        if (cancelledWorkspaceBindRequestIds.has(msg.requestId)) {
          throw Object.assign(new Error("Remote workspace bind was canceled"), {
            code: REMOTE_BIND_CANCELED_ERROR_CODE,
            retryable: false,
          });
        }
        if (previous?.workspacePath && previous.workspaceIdentity) {
          windowHostControllerRuntime.removeSource({
            kind: "remote",
            ...(previous.sourceServerId ? { sourceServerId: previous.sourceServerId } : {}),
            remoteSessionId: msg.remoteSessionId,
            workspacePath: previous.workspacePath,
            workspaceIdentity: previous.workspaceIdentity,
          });
        }
        parentPort.postMessage({
          type: HostResponseTypes.RemoteWorkspaceContextBound,
          requestId: msg.requestId,
          ...(msg.legacyRouteHint && msg.legacyRouteHint !== currentSession.workspaceIdentity
            ? { previousWorkspaceIdentity: msg.legacyRouteHint }
            : {}),
        });
        logger.info(
          `bound remote workspace context, remoteSessionId=${msg.remoteSessionId}, workspacePath=${msg.workspacePath}`,
        );
        activeWorkspaceBindRequestIds.delete(msg.requestId);
        cancelledWorkspaceBindRequestIds.delete(msg.requestId);
        workspaceBindAbortControllers.delete(msg.requestId);
      })
      .catch((error) => {
        logger.warn(
          `failed to prepare bound remote workspace, remoteSessionId=${msg.remoteSessionId}`,
          error,
        );
        const normalizedError = cancelledWorkspaceBindRequestIds.has(msg.requestId)
          ? Object.assign(new Error("Remote workspace bind was canceled"), {
              code: REMOTE_BIND_CANCELED_ERROR_CODE,
              retryable: false,
            })
          : error;
        parentPort.postMessage({
          type: HostResponseTypes.RemoteWorkspaceContextBindFailed,
          requestId: msg.requestId,
          error:
            normalizedError instanceof Error ? normalizedError.message : String(normalizedError),
          ...(normalizedError &&
          typeof normalizedError === "object" &&
          "code" in normalizedError &&
          typeof normalizedError.code === "string"
            ? { reasonCode: normalizedError.code }
            : {}),
          ...(normalizedError &&
          typeof normalizedError === "object" &&
          "retryable" in normalizedError &&
          typeof normalizedError.retryable === "boolean"
            ? { retryable: normalizedError.retryable }
            : {}),
        });
        activeWorkspaceBindRequestIds.delete(msg.requestId);
        cancelledWorkspaceBindRequestIds.delete(msg.requestId);
        workspaceBindAbortControllers.delete(msg.requestId);
      });
    return;
  }

  if (msg.type === HostMessageTypes.DisposeRemoteWorkspaceSession) {
    const disposedSession = windowRemoteConnectionRegistry.getSession(msg.remoteSessionId);
    windowHostAttachmentRegistry.detachRemoteSessionAttachments(msg.remoteSessionId);
    void windowRemoteConnectionRegistry
      .disposeSession(msg.remoteSessionId)
      .then(() => {
        if (disposedSession?.workspacePath && disposedSession.workspaceIdentity) {
          windowHostControllerRuntime.removeSource({
            kind: "remote",
            ...(disposedSession.sourceServerId
              ? { sourceServerId: disposedSession.sourceServerId }
              : {}),
            remoteSessionId: msg.remoteSessionId,
            workspacePath: disposedSession.workspacePath,
            workspaceIdentity: disposedSession.workspaceIdentity,
          });
        }
        parentPort.postMessage({
          type: HostResponseTypes.RemoteWorkspaceClosed,
          remoteSessionId: msg.remoteSessionId,
          reason: "disposed",
        });
        logWindowHostTopology("remote-session-disposed");
      })
      .catch((error) => {
        logger.warn(
          `failed to dispose remote logical session, remoteSessionId=${msg.remoteSessionId}`,
          error,
        );
      });
    return;
  }

  if (msg.type === HostMessageTypes.AttachServicePort) {
    if (!port) {
      logger.error("attach-service-port message missing MessagePort");
      return;
    }
    if (msg.scope.kind === "local" && databaseStartup?.coordinator.snapshot.phase !== "ready") {
      pendingStartupAttachments.set(msg.attachmentId, () => {
        windowHostAttachmentRegistry.attach({ ...msg, port });
      });
      port.once("close", () => pendingStartupAttachments.delete(msg.attachmentId));
      return;
    }
    try {
      if (msg.clientMode === "web-remote-replayable" && msg.scope.kind === "source-settings") {
        throw new Error("Source settings attachments are Desktop-only");
      }
      if (msg.scope.kind === "remote") {
        await windowRemoteConnectionRegistry.waitForScopedServices(msg.scope);
      }
      windowHostAttachmentRegistry.attach({
        requestId: msg.requestId,
        attachmentId: msg.attachmentId,
        clientMode: msg.clientMode,
        scope: msg.scope,
        port,
      });
      logger.info(
        `attached scoped service port, attachmentId=${msg.attachmentId}, scope=${msg.scope.kind}, clientMode=${msg.clientMode}`,
      );
      logWindowHostTopology("attachment-added");
    } catch (error) {
      rejectUnavailableAttachedServicePort(port, false);
      logger.warn(`failed to attach scoped service port, attachmentId=${msg.attachmentId}`, error);
    }
    return;
  }

  if (msg.type === HostMessageTypes.DetachServicePort) {
    pendingStartupAttachments.delete(msg.attachmentId);
    windowHostAttachmentRegistry.detach(msg.attachmentId);
    logger.info(`detached service port, attachmentId=${msg.attachmentId}`);
    logWindowHostTopology("attachment-removed");
    return;
  }

  if (!port) {
    return;
  }

  if (msg.type === HostMessageTypes.InitLocal) {
    if (!port) {
      logger.error("init-local message missing MessagePort");
      return;
    }
    if (databaseStartup) {
      port.close();
      databaseStartup.coordinator.publish();
      return;
    }
    let basePortClosed = false;
    port.once("close", () => {
      basePortClosed = true;
    });
    databaseStartup = createHostDatabaseStartup({
      startupId: msg.databaseStartupId,
      cwd: msg.agentSpawnFallbackCwd ?? process.cwd(),
      workingDirectories:
        msg.agentWarmupTargets?.map((target) => target.workspacePath) ??
        (msg.workspacePath ? [msg.workspacePath] : []),
      env: msg.runtimeProcessEnvPatch,
      publish: (state) => {
        parentPort?.postMessage({ type: HostResponseTypes.DatabaseStartupState, state });
        if (state.phase === "ready") {
          for (const attach of pendingStartupAttachments.values()) {
            try {
              attach();
            } catch (error) {
              logger.warn("startup attachment failed", error);
            }
          }
          pendingStartupAttachments.clear();
        }
      },
      onFailure: (error) =>
        logger.error(
          `local database startup failed attempt=${databaseStartup?.coordinator.snapshot.attemptId}`,
          error,
        ),
      initializeServices: async () => {
        logger.info("initializing local services");
        activeSessionRealtimePort = createTaskRealtimeBridgeForHostInit(msg, parentPort);
        const {
          service: settingService,
          prepareLegacyAccountConnections,
          setWorkspaceProjection,
        } = createSettingServiceWithMigrations();
        const hostApiNetworkTransport = createHostApiNetworkTransport(async () => {
          const settings = await settingService.get();
          return {
            httpProxy: settings.httpProxy,
            noProxy: settings.httpProxyNoProxy,
            caCertPath: settings.httpProxyCaCertPath,
          };
        });
        const services = await initializeHostApiNetworkTransportOwner({
          transport: hostApiNetworkTransport,
          log: (message, details) => logger.warn(message, details),
          establishOwner: () => {
            const initializedServices = createLocalServices({
              reportPluginTelemetryEvent: (event) => {
                parentPort?.postMessage({
                  type: HostResponseTypes.PluginTelemetry,
                  event: {
                    ...event,
                    context: {
                      ...event.context,
                      screenResolution: event.context.screenResolution || "unknown",
                    },
                  },
                });
              },
              resolveBotProjectConnection,
              resolveBotRemoteWorkspace: (workspace) =>
                sourceServerDirectory
                  ? resolveBotRemoteWorkspace(workspace, "lookup", {
                      directory: sourceServerDirectory,
                      listSessions: () => windowRemoteConnectionRegistry.listSessions(),
                    })
                  : Promise.resolve(null),
              setWorkspaceProjection,
              remoteProjectConnection: {
                connectHost: async (host) => {
                  if (host.target?.kind === "server") {
                    const connected = await windowRemoteConnectionRegistry.connectSource({
                      target: host.target,
                      remoteAssets: msg.remoteAssets ?? {},
                      membershipIntent: "retain",
                    });
                    return remoteProjectHostIdForTarget(host.target, connected.sourceServerId);
                  }
                  if (!sourceServerManagementService)
                    throw new Error("remote-project.connector-unavailable");
                  const management = sourceServerManagementService;
                  const snapshot = await management.getSnapshot();
                  const profiles = snapshot.profiles.filter(
                    (profile) =>
                      profile.lifecycleState !== "retired" &&
                      remoteProjectHostIdForProfile(profile) === host.id,
                  );
                  const preferred = new Set(
                    snapshot.servers.map((server) => server.preferredProfileId),
                  );
                  const profile =
                    profiles.find((item) => preferred.has(item.profileId)) ?? profiles[0];
                  if (!profile) throw new Error("remote-project.profile-not-found");
                  const connected = await management.connectProfile(profile.profileId, {
                    retainedOnly: true,
                  });
                  const resolved = connected.profiles.find(
                    (item) => item.profileId === profile.profileId,
                  );
                  if (
                    !resolved ||
                    !connected.states.some(
                      (state) => state.profileId === resolved.profileId && state.state === "online",
                    )
                  )
                    throw new Error("project.host-offline");
                  return remoteProjectHostIdForProfile(resolved);
                },
                readConnectionStates: async () => {
                  const result = new Map<
                    string,
                    Pick<
                      RemoteProjectHost,
                      | "connectionStatus"
                      | "lastConnectionError"
                      | "lastConnectionStatus"
                      | "upgradeTarget"
                    >
                  >();
                  for (const state of windowRemoteConnectionRegistry.listConnections()) {
                    if (state.target.kind !== "server") continue;
                    result.set(remoteProjectHostIdForTarget(state.target, state.sourceServerId), {
                      connectionStatus:
                        state.state === "online"
                          ? "online"
                          : state.state === "connecting"
                            ? "connecting"
                            : "offline",
                    });
                  }
                  if (!sourceServerDirectory || !sourceServerConnectionManager) return result;
                  const snapshot = await sourceServerDirectory.snapshot();
                  for (const state of sourceServerConnectionManager.listStates()) {
                    const profile = snapshot.profiles.find(
                      (item) => item.profileId === state.profileId,
                    );
                    if (!profile) continue;
                    const id = remoteProjectHostIdForProfile(profile);
                    const value =
                      state.state === "online"
                        ? "online"
                        : ["bootstrapping", "retrying", "updating"].includes(state.state)
                          ? "connecting"
                          : "offline";
                    if (
                      result.get(id)?.connectionStatus !== "online" &&
                      (result.get(id)?.connectionStatus !== "connecting" || value === "online")
                    )
                      result.set(id, {
                        connectionStatus: value,
                        lastConnectionError: state.error,
                        lastConnectionStatus: state.state,
                        upgradeTarget: state.upgradeTarget,
                      });
                  }
                  return result;
                },
              },
              resolveProjectHostService: async (hostId) => {
                const serverId = parseRemoteWorkspaceIdentity(
                  buildRemoteHostWorkspaceIdentity(hostId, "/"),
                )?.sourceServerId;
                const registered = serverId
                  ? windowRemoteConnectionRegistry.getOnlineSource(serverId)
                  : undefined;
                if (registered && serverId)
                  return bindRemoteProjectIdentities(
                    registered.services.get(IProjectService),
                    async (workspacePath) => {
                      const workspaceIdentity = buildServerRemoteWorkspaceIdentity({
                        serverId,
                        workspacePath,
                      });
                      await registered.capabilities?.bindWorkspaceIdentity?.({
                        workspacePath,
                        stableWorkspaceIdentity: workspaceIdentity,
                      });
                      return workspaceIdentity;
                    },
                  );
                const source = sourceServerConnectionManager?.listStates().find(
                  (state) =>
                    state.sourceServerId &&
                    remoteHostIdFromWorkspaceIdentity(
                      buildServerRemoteWorkspaceIdentity({
                        serverId: state.sourceServerId,
                        workspacePath: "/",
                      }),
                    ) === hostId,
                );
                const connection = source?.sourceServerId
                  ? sourceServerConnectionManager?.getOnlineConnection(source.sourceServerId)
                  : undefined;
                if (!connection || !source?.sourceServerId) throw new Error("project.host-offline");
                const sourceServerId = source.sourceServerId;
                return bindRemoteProjectIdentities(
                  resolveServerProjectService({
                    connectionServices: connection.services,
                    serverId: sourceServerId,
                    virtualProjects: connection.serverInfo.capabilities.virtualProjects,
                    sourceServices: activeServices ?? undefined,
                  }),
                  async (workspacePath) => {
                    await connection.services.sourceServerWorkspaceService.resolveWorkspace({
                      workspacePath,
                    });
                    return buildServerRemoteWorkspaceIdentity({
                      serverId: sourceServerId,
                      workspacePath,
                    });
                  },
                );
              },
              parentPort,
              settingService,
              prepareLegacyAccountConnections,
              hostApiNetworkTransport,
              resolveClientLanguage: () => applicationLocale,
              authorizeLocalMediaPreviewPath,
              forwardDynamicWorkflowUserMode: (mode) => {
                void pushDynamicWorkflowUserModeToRemoteHosts(
                  windowRemoteConnectionRegistry
                    .listReadyConnections()
                    .map(({ target, services: remoteServices }) => ({
                      target,
                      cfAgentService: remoteServices.get(ICfAgentService),
                    })),
                  mode,
                  (error) => logger.warn("remote dynamic workflow user mode forward failed", error),
                );
              },
              registerPluginSandbox: pluginSandboxRegistrationBridge.register,
              runtimeProcessEnvPatch: msg.runtimeProcessEnvPatch,
              agentTelemetry: {
                getDeviceMid: () => msg.deviceMid,
                runtimeSurface: "desktop_local_host",
              },
              serviceAuthorityMode: "desktop-local",
              cfAgentSpawnFallbackCwd: msg.agentSpawnFallbackCwd,
              cfBuiltinProviderConfigFilePath: msg.cfBuiltinProviderConfigFilePath,
              processLifecycleReporter: runtimeProcessLifecycleReporter,
              taskRuntimeReporter: runtimeTaskReporter,
              feedback: {
                getDeviceMid: () => msg.deviceMid,
                apiBaseUrl: msg.feedbackApiBase,
                createFullLogArchive: createFullFeedbackLogArchiveViaMain,
              },
              forwardSessionMessageSendRequested: (request) => {
                parentPort?.postMessage({
                  type: HostResponseTypes.SessionMessageSendRequested,
                  request,
                });
              },
              onAutomationManualRunRequested: dispatchManualAutomationRun,
              onOffPeakSchedulerWakeRequested: () => {
                parentPort?.postMessage({ type: HostResponseTypes.OffPeakSchedulerWakeRequest });
              },
              onProviderProvisioningSourceChanged: (trigger) => {
                parentPort?.postMessage({
                  type: HostResponseTypes.ProviderProvisioningSourceChanged,
                  trigger,
                });
              },
              browserControlExecutor: browserControlMainBridge,
              cuaOperationStateReporter:
                process.platform === "win32" ? cuaOperationStateReporter : undefined,
            });
            activeServices = initializedServices;
            activeHostApiNetworkTransport = hostApiNetworkTransport;
            return initializedServices;
          },
        });
        const cfTaskService = services.getOptional(ICfTaskService);
        if (cfTaskService) {
          const reportingCfTaskService = createReportingRemoteCfTaskService(
            cfTaskService,
            {
              reportRunningPromptCount: false,
            },
          );
          services.register(ICfTaskService, reportingCfTaskService);
        }
        sourceServerDirectory = new SourceServerDirectory({
          settingService: services.get(ISettingService),
          credentialService: services.get(ICredentialService),
          logDebug: (message) => {
            if (process.env.NODE_ENV !== "production") logger.info(message);
          },
        });
        sourceServerArtifactPolicy =
          msg.remoteAssets?.sourceServerArtifactPolicy ?? "release-versioned";
        const resolveSourceServerRelease = async (
          probe: Parameters<typeof resolveSourceServerReleaseAsset>[0],
          target: Parameters<typeof resolveSourceServerReleaseAsset>[2],
          options?: { metadataOnly?: boolean },
        ) =>
          await resolveSourceServerReleaseAsset(
            probe,
            msg.remoteAssets ?? {},
            target,
            {
              fetch: hostApiNetworkTransport.fetch,
            },
            options,
          );
        sourceServerConnectionManager = new SourceServerConnectionManager({
          directory: sourceServerDirectory,
          admitConnection: createRemoteProjectConnectionAdmission(
            services.get(IRemoteProjectService),
          ),
          onProjectChange: notifyProjectChange,
          logWarn: (message, error) => logger.warn(message, error),
          sourceServerArtifactPolicy,
          resolveRelease: resolveSourceServerRelease,
        });
        sourceServerManagementService = createSourceServerManagementService({
          directory: sourceServerDirectory,
          manager: sourceServerConnectionManager,
          resolveRelease: resolveSourceServerRelease,
          onDirectorySnapshot: (snapshot) => {
            sourceServerDisplayNameById.clear();
            for (const server of snapshot.servers) {
              sourceServerDisplayNameById.set(server.sourceServerId, server.displayName);
            }
          },
          onBeforeSourceServerRemoved: async (sourceServerId) => {
            const hostId = remoteHostIdFromWorkspaceIdentity(
              buildServerRemoteWorkspaceIdentity({ serverId: sourceServerId, workspacePath: "/" }),
            );
            if (!hostId) throw new Error("remote-project.invalid-host-identity");
            await services.get(IRemoteProjectService).removeHost(hostId);
            windowHostAttachmentRegistry.detachSourceSettingsAttachments(sourceServerId);
            sourceServerDisplayNameById.delete(sourceServerId);
          },
        });
        sourceSettingsStateSubscription = sourceServerConnectionManager.onDidChangeState(
          (state) => {
            notifyProjectChange();
            if (state.sourceServerId && shouldDetachSourceSettingsAttachment(state.state)) {
              windowHostAttachmentRegistry.detachSourceSettingsAttachments(state.sourceServerId);
            }
          },
        );
        services.register(ISourceServerManagementService, sourceServerManagementService);
        wireLocalResourceTelemetry(services);
        hasDisposedHostResources = false;
        disposeHostResourcesInFlight = null;
        const agentWarmupTargets =
          msg.agentWarmupTargets && msg.agentWarmupTargets.length > 0
            ? msg.agentWarmupTargets
            : msg.workspacePath
              ? [
                  {
                    workspacePath: msg.workspacePath,
                    ...(msg.workspaceIdentity ? { workspaceIdentity: msg.workspaceIdentity } : {}),
                  },
                ]
              : [];
        agentWarmupTargets.forEach((target, index) => {
          warmUpCfAgent(
            services,
            target,
            `local host init (${index + 1}/${agentWarmupTargets.length})`,
          );
        });
        logger.info("exposing services on ChannelServer...");
        if (!basePortClosed)
          windowHostAttachmentRegistry.attach({
            requestId: `init-local-${randomUUID()}`,
            attachmentId: `base-${randomUUID()}`,
            clientMode: "desktop-continuous",
            scope: { kind: "local" },
            port,
          });
        logWindowHostTopology("base-attachment-ready");
        logger.info("local services ready, all channels registered");
        void runStartupReconnectBatch({
          getSettings: () => services.get(ISettingService).get(),
          listCandidates: async () =>
            (await services.get(IRemoteProjectService).readDirectory()).hosts.filter(
              (host) => host.kind === "server",
            ),
          reconnect: (hosts) =>
            Promise.all(
              hosts.map(async (host) => {
                try {
                  await services.get(IRemoteProjectService).connectHost(host.id);
                } catch (error) {
                  logger.warn("URL Server startup reconnect failed", { hostId: host.id, error });
                }
              }),
            ),
        }).catch((error) => logger.warn("URL Server startup directory unavailable", error));

        void sourceServerDirectory
          .initialize()
          .then(async () =>
            runStartupReconnectBatch({
              getSettings: () => services.get(ISettingService).get(),
              listCandidates: async () => {
                const retained = new Set(
                  (await services.get(IRemoteProjectService).readDirectory()).hosts.map(
                    (host) => host.id,
                  ),
                );
                return (await sourceServerDirectory!.listStartupReconnectCandidates()).filter(
                  (candidate) => retained.has(remoteProjectHostIdForProfile(candidate.profile)),
                );
              },
              reconnect: (candidates) =>
                sourceServerConnectionManager!.reconnectOnStartup(candidates),
            }),
          )
          .then((results) => {
            const online = results.filter((result) => result.status === "online").length;
            for (const result of results) {
              if (result.status === "failed") {
                logger.warn("Source Server startup reconnect failed", {
                  profileId: result.profileId,
                  error: result.error,
                });
              }
            }
            logger.info(
              `Source Server startup reconnect finished, online=${online}, failed=${results.length - online}`,
            );
          })
          .catch((error) =>
            logger.warn(
              "Source Server directory initialization failed; local services remain available",
              error,
            ),
          );
      },
    });
    await databaseStartup.coordinator.start();
  }
});
