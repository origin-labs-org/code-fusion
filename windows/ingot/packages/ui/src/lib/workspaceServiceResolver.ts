import type { IServiceAccessor } from "@origin-ai/cf-services";
import { buildTaskWorkspaceKey } from "@/lib/taskQueryCache.js";

interface WorkspaceServiceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  remoteTarget?: unknown;
}

export interface WorkspaceServiceResolverState<TServices = IServiceAccessor> {
  sessionsById: Record<string, { services: TServices }>;
  sessionIdByWorkspaceIdentity: Record<string, string>;
  sessionIdByWorkspacePath: Record<string, string>;
}

interface ResolvedWorkspaceServices {
  services: IServiceAccessor;
  remoteSessionId?: string;
  isRemoteWorkspace: boolean;
}

export function resolveWorkspaceRemoteSessionId<TServices>(
  target: WorkspaceServiceTarget,
  state: WorkspaceServiceResolverState<TServices>,
): string | undefined {
  const workspaceIdentity = target.workspaceIdentity?.trim();
  const candidateSessionIds = [
    target.remoteSessionId,
    workspaceIdentity ? state.sessionIdByWorkspaceIdentity[workspaceIdentity] : undefined,
    !workspaceIdentity && target.remoteTarget
      ? state.sessionIdByWorkspacePath[target.workspacePath]
      : undefined,
  ];

  return candidateSessionIds.find((sessionId): sessionId is string =>
    Boolean(sessionId && state.sessionsById[sessionId]),
  );
}

export function isRemoteWorkspaceTarget(
  target: WorkspaceServiceTarget,
  resolvedRemoteSessionId?: string,
): boolean {
  return Boolean(target.workspaceIdentity || target.remoteTarget || resolvedRemoteSessionId);
}

export function resolveWorkspaceServices(
  target: WorkspaceServiceTarget,
  baseServices: IServiceAccessor,
  state: WorkspaceServiceResolverState,
): ResolvedWorkspaceServices | null {
  const remoteSessionId = resolveWorkspaceRemoteSessionId(target, state);
  const isRemoteWorkspace = isRemoteWorkspaceTarget(target, remoteSessionId);

  if (isRemoteWorkspace) {
    const services = remoteSessionId ? state.sessionsById[remoteSessionId]?.services : undefined;
    return services
      ? {
          services,
          remoteSessionId,
          isRemoteWorkspace,
        }
      : null;
  }

  return {
    services: baseServices,
    isRemoteWorkspace,
  };
}

export function buildWorkspaceServiceLookup(
  workspaceTabs: WorkspaceServiceTarget[],
  baseServices: IServiceAccessor,
  state: WorkspaceServiceResolverState,
): Map<string, ResolvedWorkspaceServices> {
  const lookup = new Map<string, ResolvedWorkspaceServices>();

  for (const tab of workspaceTabs) {
    const resolved = resolveWorkspaceServices(tab, baseServices, state);
    if (!resolved) {
      continue;
    }

    lookup.set(buildTaskWorkspaceKey(tab.workspacePath, tab.workspaceIdentity), resolved);
  }

  return lookup;
}
