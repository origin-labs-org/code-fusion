import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  CommandAck,
  CommandEnvelope,
  V4AttachmentPutParams,
  V4AttachmentPutResult,
  V4ConversationFileChangesParams,
  V4ConversationFileChangesResult,
  V4ConversationFileRewindPreviewParams,
  V4ConversationFileRewindPreviewResult,
  V4ConversationWorkflowRunArtifactDataParams,
  V4ConversationWorkflowRunArtifactDataResult,
  V4ConversationWorkflowRunArtifactReadParams,
  V4ConversationWorkflowRunArtifactReadResult,
  V4ConversationWorkflowRunArtifactsParams,
  V4ConversationWorkflowRunArtifactsResult,
  V4ConversationWorkflowRunNodeResultParams,
  V4ConversationWorkflowRunNodeResultResult,
  V4ConversationWorkflowRunWorkspaceParams,
  V4ConversationWorkflowRunWorkspaceResult,
  V4ConversationWorkflowRunEventsParams,
  V4ConversationWorkflowRunsParams,
  V4ConversationWorkflowRunEventsResult,
  V4ConversationWorkflowRunsResult,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import { ServiceProvider } from "@/hooks/useServices.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import {
  useWorkspaceServicesResolution,
  type WorkspaceServicesResolution,
} from "@/hooks/useWorkspaceServices.js";
import { RemoteConversationAvailability } from "@/v4/RemoteConversationAvailability.js";
import { createAgentConversationTransport } from "@/v4/agentConversationTransport.js";
import type { ConversationAttachmentReadParams, ConversationTransport } from "@/v4/transport.js";
import type { PaneWorkspaceScope } from "@/v4/paneLayoutStore.js";
import { SessionDataLayer } from "@/v4/sessionDataLayer.js";
import { acquireWorkspaceConnection } from "@/v4/workspaceConnectionRegistry.js";
import type { AttachmentUploadOptions } from "@/v4/attachmentUploadTransaction.js";
import { ConversationTelemetryPaneAttachment } from "@/v4/telemetry/ConversationTelemetryAttachment.js";

export interface V4ConversationContextValue {
  layer: SessionDataLayer;
  sendCommand(
    envelope: CommandEnvelope,
    context?: { projectId?: string | null },
  ): Promise<CommandAck>;
  fileChanges(params: V4ConversationFileChangesParams): Promise<V4ConversationFileChangesResult>;
  fileRewindPreview(
    params: V4ConversationFileRewindPreviewParams,
  ): Promise<V4ConversationFileRewindPreviewResult>;
  
  workflowRunEvents(
    params: V4ConversationWorkflowRunEventsParams,
  ): Promise<V4ConversationWorkflowRunEventsResult>;
  
  workflowRuns(params: V4ConversationWorkflowRunsParams): Promise<V4ConversationWorkflowRunsResult>;
  
  workflowRunArtifacts(
    params: V4ConversationWorkflowRunArtifactsParams,
  ): Promise<V4ConversationWorkflowRunArtifactsResult>;
  
  workflowRunArtifactData(
    params: V4ConversationWorkflowRunArtifactDataParams,
  ): Promise<V4ConversationWorkflowRunArtifactDataResult>;
  
  workflowRunArtifactRead(
    params: V4ConversationWorkflowRunArtifactReadParams,
  ): Promise<V4ConversationWorkflowRunArtifactReadResult>;
  
  workflowRunWorkspace(
    params: V4ConversationWorkflowRunWorkspaceParams,
  ): Promise<V4ConversationWorkflowRunWorkspaceResult>;
  
  workflowRunNodeResult(
    params: V4ConversationWorkflowRunNodeResultParams,
  ): Promise<V4ConversationWorkflowRunNodeResultResult>;
  
  attachmentPut(
    params: V4AttachmentPutParams,
    options?: AttachmentUploadOptions,
  ): Promise<V4AttachmentPutResult>;
  attachmentRead(
    params: ConversationAttachmentReadParams,
  ): ReturnType<ConversationTransport["attachmentRead"]>;
  attachmentReadRange(
    params: Parameters<ConversationTransport["attachmentReadRange"]>[0],
  ): ReturnType<ConversationTransport["attachmentReadRange"]>;
  onRuntimeRestart(listener: () => void): () => void;
  
  onRuntimeLifecycle?(listener: (state: "available" | "unavailable") => void): () => void;
}

export const V4ConversationContext = createContext<V4ConversationContextValue | null>(null);

export interface V4ConversationProviderProps {
  workspacePath: string;
  workspaceIdentity?: string;
  children: ReactNode;
  
  sessionId?: string | null;
  unavailableFallback?: ReactNode;
  disconnectedBanner?: ReactNode;
}

function useRetainedReadyResolution(
  workspaceKey: string,
  resolution: WorkspaceServicesResolution,
  retain: boolean,
) {
  const [retained, setRetained] = useState<{
    key: string;
    resolution: WorkspaceServicesResolution;
  } | null>(null);
  if (
    retain &&
    resolution.rpcReady &&
    (retained?.key !== workspaceKey ||
      retained.resolution.services !== resolution.services ||
      retained.resolution.remoteSessionId !== resolution.remoteSessionId)
  ) {
    setRetained({ key: workspaceKey, resolution });
  } else if (retained && (!retain || (!resolution.rpcReady && retained.key !== workspaceKey))) {
    setRetained(null);
  }
  return resolution.rpcReady
    ? resolution
    : retain && retained?.key === workspaceKey
      ? retained.resolution
      : null;
}

function ReadyV4ConversationProvider({
  workspacePath,
  workspaceIdentity,
  children,
  services,
  remoteSessionId,
}: V4ConversationProviderProps & {
  services: IServiceAccessor;
  remoteSessionId: string | null;
}) {
  const { cfAgentService } = services;
  const platform = usePlatform();
  const bundle = useMemo(() => {
    const transport = createAgentConversationTransport(cfAgentService, {
      workspacePath,
      workspaceIdentity,
      ...(remoteSessionId === null && platform.createLocalMediaPreviewUrl
        ? { createLocalMediaPreviewUrl: platform.createLocalMediaPreviewUrl }
        : {}),
    });
    const layer = new SessionDataLayer({ transport });
    return {
      layer,
      sendCommand: (envelope: CommandEnvelope, context?: { projectId?: string | null }) =>
        transport.sendCommand(envelope, context),
      fileChanges: (params: V4ConversationFileChangesParams) => transport.fileChanges(params),
      fileRewindPreview: (params: V4ConversationFileRewindPreviewParams) =>
        transport.fileRewindPreview(params),
      workflowRunEvents: (params: V4ConversationWorkflowRunEventsParams) =>
        transport.workflowRunEvents(params),
      workflowRunArtifacts: (params: V4ConversationWorkflowRunArtifactsParams) =>
        transport.workflowRunArtifacts(params),
      workflowRunArtifactData: (params: V4ConversationWorkflowRunArtifactDataParams) =>
        transport.workflowRunArtifactData(params),
      workflowRunArtifactRead: (params: V4ConversationWorkflowRunArtifactReadParams) =>
        transport.workflowRunArtifactRead(params),
      workflowRunWorkspace: (params: V4ConversationWorkflowRunWorkspaceParams) =>
        transport.workflowRunWorkspace(params),
      workflowRunNodeResult: (params: V4ConversationWorkflowRunNodeResultParams) =>
        transport.workflowRunNodeResult(params),
      workflowRuns: (params: V4ConversationWorkflowRunsParams) => transport.workflowRuns(params),
      attachmentPut: (params: V4AttachmentPutParams, options?: AttachmentUploadOptions) =>
        transport.attachmentPut(params, options),
      attachmentRead: (params) => transport.attachmentRead(params),
      attachmentReadRange: (params) => transport.attachmentReadRange(params),
      onRuntimeRestart: (listener: () => void) => transport.onRuntimeRestart(listener),
      ...(transport.onRuntimeLifecycle
        ? {
            onRuntimeLifecycle: (listener: (state: "available" | "unavailable") => void) =>
              transport.onRuntimeLifecycle?.(listener) ?? (() => {}),
          }
        : {}),
    } satisfies V4ConversationContextValue;
  }, [
    platform.createLocalMediaPreviewUrl,
    remoteSessionId,
    workspacePath,
    workspaceIdentity,
    cfAgentService,
  ]);

  useEffect(() => {
    return () => {
      bundle.layer.dispose();
    };
  }, [bundle]);

  return (
    <ServiceProvider services={services}>
      <V4ConversationContext.Provider value={bundle}>{children}</V4ConversationContext.Provider>
    </ServiceProvider>
  );
}

export function V4ConversationProvider({
  workspacePath,
  workspaceIdentity,
  children,
  sessionId,
  unavailableFallback,
  disconnectedBanner,
}: V4ConversationProviderProps) {
  const resolution = useWorkspaceServicesResolution(workspacePath, undefined, workspaceIdentity);
  const ready = useRetainedReadyResolution(
    `${workspaceIdentity?.trim() || workspacePath}\0${sessionId ?? "__draft__"}`,
    resolution,
    sessionId !== undefined,
  );
  if (!ready) {
    return unavailableFallback ?? null;
  }

  return (
    <ReadyV4ConversationProvider
      workspacePath={workspacePath}
      workspaceIdentity={workspaceIdentity}
      services={ready.services}
      remoteSessionId={ready.remoteSessionId}
    >
      <RemoteConversationAvailability available={resolution.rpcReady} banner={disconnectedBanner}>
      {children}
      </RemoteConversationAvailability>
    </ReadyV4ConversationProvider>
  );
}

export function useV4Conversation(): V4ConversationContextValue {
  const ctx = useContext(V4ConversationContext);
  if (!ctx) {
    throw new Error("useV4Conversation 必须在 V4ConversationProvider 内使用");
  }
  return ctx;
}

export function useHasV4Conversation(): boolean {
  return useContext(V4ConversationContext) !== null;
}

export interface V4PaneConversationProviderProps {
  
  scope: PaneWorkspaceScope;
  children: ReactNode;
  
  sessionId?: string | null;
  unavailableFallback?: ReactNode;
  disconnectedBanner?: ReactNode;
}

export function V4PaneConversationProvider({
  scope,
  children,
  sessionId,
  unavailableFallback,
  disconnectedBanner,
}: V4PaneConversationProviderProps) {
  const targetResolution = useWorkspaceServicesResolution(
    scope.workspacePath,
    scope.remoteSessionId ?? null,
    scope.workspaceIdentity ?? null,
  );
  const ready = useRetainedReadyResolution(
    `${scope.workspaceIdentity?.trim() || scope.workspacePath}\0${sessionId ?? "__draft__"}`,
    targetResolution,
    sessionId !== undefined,
  );
  const resolvedScope = useMemo<PaneWorkspaceScope>(
    () => ({
      workspacePath: scope.workspacePath,
      ...(scope.workspaceIdentity ? { workspaceIdentity: scope.workspaceIdentity } : {}),
      ...(ready?.remoteSessionId ? { remoteSessionId: ready.remoteSessionId } : {}),
    }),
    [scope.workspaceIdentity, scope.workspacePath, ready?.remoteSessionId],
  );
  if (!ready) {
    return unavailableFallback ?? null;
  }

  return (
    <ReadyV4PaneConversationProvider scope={resolvedScope} services={ready.services}>
      <RemoteConversationAvailability
        available={targetResolution.rpcReady}
        banner={disconnectedBanner}
      >
      {children}
      </RemoteConversationAvailability>
    </ReadyV4PaneConversationProvider>
  );
}

function ReadyV4PaneConversationProvider({
  scope,
  services,
  children,
}: Pick<V4PaneConversationProviderProps, "scope" | "children"> & {
  services: IServiceAccessor;
}) {
  const agentService = services.cfAgentService;
  const platform = usePlatform();

  const bundle = useMemo(() => {
    const lease = acquireWorkspaceConnection(
      {
        workspacePath: scope.workspacePath,
        ...(scope.workspaceIdentity ? { workspaceIdentity: scope.workspaceIdentity } : {}),
        ...(scope.remoteSessionId ? { remoteSessionId: scope.remoteSessionId } : {}),
      },
      agentService,
      scope.remoteSessionId ? undefined : platform.createLocalMediaPreviewUrl,
    );
    return {
      lease,
      value: {
        layer: lease.layer,
        sendCommand: (envelope: CommandEnvelope, context?: { projectId?: string | null }) =>
          lease.transport.sendCommand(envelope, context),
        fileChanges: (params: V4ConversationFileChangesParams) =>
          lease.transport.fileChanges(params),
        fileRewindPreview: (params: V4ConversationFileRewindPreviewParams) =>
          lease.transport.fileRewindPreview(params),
        workflowRunEvents: (params: V4ConversationWorkflowRunEventsParams) =>
          lease.transport.workflowRunEvents(params),
        workflowRunArtifacts: (params: V4ConversationWorkflowRunArtifactsParams) =>
          lease.transport.workflowRunArtifacts(params),
        workflowRunArtifactData: (params: V4ConversationWorkflowRunArtifactDataParams) =>
          lease.transport.workflowRunArtifactData(params),
        workflowRunArtifactRead: (params: V4ConversationWorkflowRunArtifactReadParams) =>
          lease.transport.workflowRunArtifactRead(params),
        workflowRunWorkspace: (params: V4ConversationWorkflowRunWorkspaceParams) =>
          lease.transport.workflowRunWorkspace(params),
        workflowRunNodeResult: (params: V4ConversationWorkflowRunNodeResultParams) =>
          lease.transport.workflowRunNodeResult(params),
        workflowRuns: (params: V4ConversationWorkflowRunsParams) =>
          lease.transport.workflowRuns(params),
        attachmentPut: (params: V4AttachmentPutParams, options?: AttachmentUploadOptions) =>
          lease.transport.attachmentPut(params, options),
        attachmentRead: (params) => lease.transport.attachmentRead(params),
        attachmentReadRange: (params) => lease.transport.attachmentReadRange(params),
        onRuntimeRestart: (listener: () => void) => lease.transport.onRuntimeRestart(listener),
        ...(lease.transport.onRuntimeLifecycle
          ? {
              onRuntimeLifecycle: (listener: (state: "available" | "unavailable") => void) =>
                lease.transport.onRuntimeLifecycle?.(listener) ?? (() => {}),
            }
          : {}),
      } satisfies V4ConversationContextValue,
    };
  }, [
    agentService,
    platform.createLocalMediaPreviewUrl,
    scope.workspacePath,
    scope.workspaceIdentity,
    scope.remoteSessionId,
  ]);

  useLayoutEffect(() => {
    bundle.lease.activateRemoteService();
  }, [bundle]);

  useEffect(() => {
    return () => {
      bundle.lease.release();
    };
  }, [bundle]);

  return (
    <ServiceProvider services={services}>
      <ConversationTelemetryPaneAttachment services={services} scope={scope}>
        <V4ConversationContext.Provider value={bundle.value}>
          {children}
        </V4ConversationContext.Provider>
      </ConversationTelemetryPaneAttachment>
    </ServiceProvider>
  );
}
