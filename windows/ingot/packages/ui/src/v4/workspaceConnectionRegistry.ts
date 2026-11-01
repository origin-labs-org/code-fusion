import type { ICfAgentService } from "@origin-ai/cf-services";
import { createAgentConversationTransport } from "@/v4/agentConversationTransport.js";
import { remoteAgentServiceGeneration } from "@/lib/remoteAgentServiceGeneration.js";
import { ReplaceableConversationTransport } from "@/v4/replaceableConversationTransport.js";
import { SessionDataLayer } from "@/v4/sessionDataLayer.js";
import type { ConversationTransport } from "@/v4/transport.js";
import { logger } from "@/logger.js";

export type WorkspaceConnectionAgentService = Pick<
  ICfAgentService,
  | "helloConversationV4"
  | "initializeConversationV4"
  | "subscribeConversationV4"
  | "resyncConversationV4"
  | "unsubscribeConversationV4"
  | "sendConversationCommandV4"
  | "queryConversationCommandsV4"
  | "conversationRowsRangeV4"
  | "conversationPlansV4"
  | "conversationWorkflowRunEventsV4"
  | "conversationWorkflowRunsV4"
  | "conversationWorkflowRunArtifactsV4"
  | "conversationWorkflowRunArtifactDataV4"
  | "conversationWorkflowRunArtifactReadV4"
  | "conversationWorkflowRunWorkspaceV4"
  | "conversationWorkflowRunNodeResultV4"
  | "conversationFileChangesV4"
  | "conversationFileRewindPreviewV4"
  | "attachmentBeginV4"
  | "attachmentChunkV4"
  | "attachmentCommitV4"
  | "attachmentAbortV4"
  | "attachmentPreviewSourceV4"
  | "attachmentReadV4"
  | "onDynamicConversationFrame"
  | "onDynamicLocalTtftFacts"
  | "onAgentRuntimeRestarted"
>;

export interface WorkspaceConnectionScope {
  
  workspacePath: string;
  workspaceIdentity?: string;
  
  remoteSessionId?: string;
}

export interface WorkspaceConnectionLease {
  readonly layer: SessionDataLayer;
  readonly transport: ConversationTransport;
  
  activateRemoteService(): void;
  release(): void;
}

interface RegistryEntry {
  key: string;
  agentService: WorkspaceConnectionAgentService;
  agentServiceGeneration: number;
  transport: ConversationTransport;
  replaceableTransport: ReplaceableConversationTransport | null;
  layer: SessionDataLayer;
  refCount: number;
  keepWarmTimer: ReturnType<typeof setTimeout> | null;
  
  stale: boolean;
}

const registry = new Map<string, RegistryEntry>();

export const LOCAL_WORKSPACE_CONNECTION_ENDPOINT = "__base__";

export const WORKSPACE_CONNECTION_KEEP_WARM_MS = 30_000;

export function buildWorkspaceConnectionKey(scope: WorkspaceConnectionScope): string {
  const workspaceKey = scope.workspaceIdentity?.trim() || scope.workspacePath;
  return `${scope.remoteSessionId ?? LOCAL_WORKSPACE_CONNECTION_ENDPOINT} ${workspaceKey}`;
}

function disposeEntry(entry: RegistryEntry): void {
  if (entry.keepWarmTimer !== null) {
    clearTimeout(entry.keepWarmTimer);
    entry.keepWarmTimer = null;
  }
  entry.layer.dispose();
}

function releaseEntry(entry: RegistryEntry): void {
  entry.refCount -= 1;
  if (entry.refCount > 0) {
    logger.lifecycle.info("v4 workspace connection lease released", {
      event: "v4.workspace_connection.release",
      key: entry.key,
      module: "ui.v4.workspace_connection_registry",
      refCount: entry.refCount,
      status: "completed",
    });
    return;
  }
  if (entry.stale) {
    disposeEntry(entry);
    logger.lifecycle.info("v4 stale workspace connection disposed", {
      event: "v4.workspace_connection.stale_disposed",
      key: entry.key,
      module: "ui.v4.workspace_connection_registry",
      refCount: 0,
      status: "completed",
    });
    return;
  }
  entry.keepWarmTimer = setTimeout(() => {
    if (registry.get(entry.key) === entry) {
      registry.delete(entry.key);
    }
    entry.layer.dispose();
    logger.lifecycle.info("v4 workspace connection keep-warm expired", {
      event: "v4.workspace_connection.keep_warm_expired",
      key: entry.key,
      module: "ui.v4.workspace_connection_registry",
      refCount: 0,
      status: "completed",
    });
  }, WORKSPACE_CONNECTION_KEEP_WARM_MS);
  logger.lifecycle.info("v4 workspace connection lease released", {
    event: "v4.workspace_connection.release",
    keepWarmMs: WORKSPACE_CONNECTION_KEEP_WARM_MS,
    key: entry.key,
    module: "ui.v4.workspace_connection_registry",
    refCount: 0,
    status: "keep_warm",
  });
}

export function acquireWorkspaceConnection(
  scope: WorkspaceConnectionScope,
  agentService: WorkspaceConnectionAgentService,
  createLocalMediaPreviewUrl?: (path: string) => string,
): WorkspaceConnectionLease {
  const key = buildWorkspaceConnectionKey(scope);
  const existing = registry.get(key);
  const incomingServiceGeneration = remoteAgentServiceGeneration(agentService);
  const isRemote =
    (scope.remoteSessionId ?? LOCAL_WORKSPACE_CONNECTION_ENDPOINT) !==
    LOCAL_WORKSPACE_CONNECTION_ENDPOINT;
  let entry: RegistryEntry;
  if (existing && (existing.agentService === agentService || isRemote)) {
    existing.refCount += 1;
    if (existing.keepWarmTimer !== null) {
      clearTimeout(existing.keepWarmTimer);
      existing.keepWarmTimer = null;
    }
    entry = existing;
    logger.lifecycle.info("v4 workspace connection reused", {
      event: "v4.workspace_connection.reused",
      isRemote,
      key,
      module: "ui.v4.workspace_connection_registry",
      refCount: entry.refCount,
      serviceGeneration: incomingServiceGeneration,
      status: "completed",
    });
  } else {
    if (existing) {
      registry.delete(key);
      existing.stale = true;
      if (existing.refCount <= 0) {
        disposeEntry(existing);
      }
    }
    const initialTransport = createAgentConversationTransport(agentService, {
      workspacePath: scope.workspacePath,
      ...(scope.workspaceIdentity ? { workspaceIdentity: scope.workspaceIdentity } : {}),
      ...(createLocalMediaPreviewUrl ? { createLocalMediaPreviewUrl } : {}),
    });
    const replaceableTransport = isRemote
      ? new ReplaceableConversationTransport(initialTransport)
      : null;
    const transport = replaceableTransport ?? initialTransport;
    entry = {
      key,
      agentService,
      agentServiceGeneration: incomingServiceGeneration,
      transport,
      replaceableTransport,
      layer: new SessionDataLayer({ transport }),
      refCount: 1,
      keepWarmTimer: null,
      stale: false,
    };
    registry.set(key, entry);
    logger.lifecycle.info("v4 workspace connection created", {
      event: "v4.workspace_connection.created",
      isRemote,
      key,
      module: "ui.v4.workspace_connection_registry",
      refCount: 1,
      serviceGeneration: incomingServiceGeneration,
      status: "completed",
    });
  }

  let released = false;
  return {
    layer: entry.layer,
    transport: entry.transport,
    activateRemoteService: () => {
      if (
        released ||
        !isRemote ||
        entry.stale ||
        entry.agentService === agentService ||
        incomingServiceGeneration <= entry.agentServiceGeneration
      ) {
        return;
      }
      if (!entry.replaceableTransport) {
        throw new Error("远程 conversation registry 条目缺少可换代 transport");
      }
      entry.agentService = agentService;
      entry.agentServiceGeneration = incomingServiceGeneration;
      entry.replaceableTransport.replace(
        createAgentConversationTransport(agentService, {
          workspacePath: scope.workspacePath,
          ...(scope.workspaceIdentity ? { workspaceIdentity: scope.workspaceIdentity } : {}),
        }),
      );
    },
    release: () => {
      if (released) return;
      released = true;
      releaseEntry(entry);
    },
  };
}

export function workspaceConnectionRegistrySize(): number {
  return registry.size;
}
