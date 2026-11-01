import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { ConversationTelemetryFact } from "@origin-ai/cf-shared/cf-protocol-v4";
import { resolveWorkspaceTelemetryDetail, type IPlatformService } from "@origin-ai/cf-shared";
import { createConversationTelemetryService, type IServiceAccessor } from "@origin-ai/cf-services";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { ConversationTelemetrySupervisor } from "@/v4/telemetry/conversationTelemetrySupervisor.js";

interface ConversationTelemetryAttachmentScope {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}

interface ConversationTelemetryAttachmentValue {
  scope: ConversationTelemetryAttachmentScope;
  supervisor: ConversationTelemetrySupervisor;
  foregroundEnabled: boolean;
}

interface SupervisorRegistryEntry {
  key: string;
  logicalScopeKey: string;
  supervisor: ConversationTelemetrySupervisor;
  refCount: number;
  subscription: { dispose(): void } | null;
  stale: boolean;
  workspaceDetached: boolean;
}

interface SupervisorLease {
  entry: SupervisorRegistryEntry;
  release(): void;
}

const serviceGenerationIds = new WeakMap<object, number>();
let nextServiceGenerationId = 1;
const supervisorRegistry = new Map<string, SupervisorRegistryEntry>();

function serviceGenerationId(service: object): number {
  const existing = serviceGenerationIds.get(service);
  if (existing !== undefined) return existing;
  const created = nextServiceGenerationId;
  nextServiceGenerationId += 1;
  serviceGenerationIds.set(service, created);
  return created;
}

function attachmentScopeKey(scope: ConversationTelemetryAttachmentScope, service: object): string {
  const workspaceKey = scope.workspaceIdentity?.trim() || scope.workspacePath;
  return [scope.remoteSessionId ?? "__base__", workspaceKey, serviceGenerationId(service)].join(
    "\u0000",
  );
}

function logicalAttachmentScopeKey(scope: ConversationTelemetryAttachmentScope): string {
  const workspaceKey = scope.workspaceIdentity?.trim() || scope.workspacePath;
  return [scope.remoteSessionId ?? "__base__", workspaceKey].join("\u0000");
}

function sameScope(
  left: ConversationTelemetryAttachmentScope,
  right: ConversationTelemetryAttachmentScope,
): boolean {
  return (
    (left.remoteSessionId ?? "__base__") === (right.remoteSessionId ?? "__base__") &&
    (left.workspaceIdentity?.trim() || left.workspacePath) ===
      (right.workspaceIdentity?.trim() || right.workspacePath)
  );
}

function acquireSupervisor(
  scope: ConversationTelemetryAttachmentScope,
  services: IServiceAccessor,
  platform: Pick<IPlatformService, "reportArmsCustomEvent" | "reportTelemetryEvent">,
): SupervisorLease {
  const logicalScopeKey = logicalAttachmentScopeKey(scope);
  const key = attachmentScopeKey(scope, services.cfAgentService);
  for (const [candidateKey, candidate] of supervisorRegistry) {
    if (candidate.logicalScopeKey !== logicalScopeKey || candidateKey === key) {
      continue;
    }
    supervisorRegistry.delete(candidateKey);
    candidate.stale = true;
    if (candidate.refCount === 0) disposeSupervisorEntry(candidate);
  }
  let entry = supervisorRegistry.get(key);
  if (entry) {
    entry.refCount += 1;
  } else {
    entry = {
      key,
      logicalScopeKey,
      supervisor: new ConversationTelemetrySupervisor({
        platform,
        workspaceScopeKey: key,
        workspaceTelemetryDetail: resolveWorkspaceTelemetryDetail(scope),
      }),
      refCount: 1,
      subscription: null,
      stale: false,
      workspaceDetached: false,
    };
    supervisorRegistry.set(key, entry);
  }
  let released = false;
  return {
    entry,
    release: () => {
      if (released) return;
      released = true;
      entry.refCount -= 1;
      if (entry.refCount > 0) return;
      if (entry.stale || entry.workspaceDetached) {
        disposeSupervisorEntry(entry);
      }
    },
  };
}

function disposeSupervisorEntry(entry: SupervisorRegistryEntry): void {
  if (supervisorRegistry.get(entry.key) === entry) {
    supervisorRegistry.delete(entry.key);
  }
  entry.subscription?.dispose();
  entry.subscription = null;
  entry.supervisor.dispose();
}

export function disposeConversationTelemetrySupervisors(): void {
  for (const entry of supervisorRegistry.values()) {
    disposeSupervisorEntry(entry);
  }
  supervisorRegistry.clear();
}

export function reconcileConversationTelemetryWorkspaceScopes(
  scopes: readonly ConversationTelemetryAttachmentScope[],
): void {
  const attachedKeys = new Set(scopes.map(logicalAttachmentScopeKey));
  for (const entry of supervisorRegistry.values()) {
    entry.workspaceDetached = !attachedKeys.has(entry.logicalScopeKey);
    if (entry.workspaceDetached && entry.refCount === 0) {
      disposeSupervisorEntry(entry);
    }
  }
}

function ensureSupervisorSubscription(
  entry: SupervisorRegistryEntry,
  scope: ConversationTelemetryAttachmentScope,
  services: IServiceAccessor,
): void {
  if (entry.subscription) return;
  const telemetryService = createConversationTelemetryService(services.cfAgentService);
  const factEvent = telemetryService.onFact({
    workspacePath: scope.workspacePath,
    ...(scope.workspaceIdentity ? { workspaceIdentity: scope.workspaceIdentity } : {}),
  });
  entry.subscription = factEvent((fact: ConversationTelemetryFact) =>
    entry.supervisor.handleFact(fact),
  );
}

const ConversationTelemetryAttachmentContext =
  createContext<ConversationTelemetryAttachmentValue | null>(null);

export function ConversationTelemetryWorkspaceAttachment({
  enabled,
  foregroundEnabled = true,
  services,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  children,
}: ConversationTelemetryAttachmentScope & {
  enabled: boolean;
  foregroundEnabled?: boolean;
  services: IServiceAccessor;
  children: ReactNode;
}) {
  const platform = useOptionalPlatform();
  const scope = useMemo<ConversationTelemetryAttachmentScope>(
    () => ({
      workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
      ...(remoteSessionId ? { remoteSessionId } : {}),
    }),
    [remoteSessionId, workspaceIdentity, workspacePath],
  );
  const lease = useMemo(() => {
    const agentService = services.cfAgentService as object | null | undefined;
    if (!enabled || !platform || !agentService) return null;
    return acquireSupervisor(scope, services, platform);
  }, [enabled, platform, scope, services]);
  const supervisor = lease?.entry.supervisor ?? null;

  useEffect(() => {
    if (!lease) return undefined;
    ensureSupervisorSubscription(lease.entry, scope, services);
    return () => {
      lease.release();
    };
  }, [lease, scope, services]);

  const value = useMemo<ConversationTelemetryAttachmentValue | null>(
    () => (supervisor ? { scope, supervisor, foregroundEnabled } : null),
    [foregroundEnabled, scope, supervisor],
  );
  return (
    <ConversationTelemetryAttachmentContext.Provider value={value}>
      {children}
    </ConversationTelemetryAttachmentContext.Provider>
  );
}

export function ConversationTelemetryPaneAttachment({
  services,
  scope,
  children,
}: {
  services: IServiceAccessor;
  scope: ConversationTelemetryAttachmentScope;
  children: ReactNode;
}) {
  const parentAttachment = useContext(ConversationTelemetryAttachmentContext);
  return (
    <ConversationTelemetryWorkspaceAttachment
      enabled={parentAttachment !== null}
      foregroundEnabled={parentAttachment?.foregroundEnabled ?? false}
      services={services}
      workspacePath={scope.workspacePath}
      workspaceIdentity={scope.workspaceIdentity}
      remoteSessionId={scope.remoteSessionId}
    >
      {children}
    </ConversationTelemetryWorkspaceAttachment>
  );
}

export function useScopedConversationTelemetrySupervisor(
  scope: ConversationTelemetryAttachmentScope,
): ConversationTelemetrySupervisor | null {
  const attachment = useContext(ConversationTelemetryAttachmentContext);
  return attachment && sameScope(attachment.scope, scope) ? attachment.supervisor : null;
}

export function useScopedConversationTelemetryForegroundEnabled(
  scope: ConversationTelemetryAttachmentScope,
): boolean {
  const attachment = useContext(ConversationTelemetryAttachmentContext);
  return Boolean(attachment && attachment.foregroundEnabled && sameScope(attachment.scope, scope));
}
