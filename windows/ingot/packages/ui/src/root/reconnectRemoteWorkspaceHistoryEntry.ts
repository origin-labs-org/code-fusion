import type { Dispatch, SetStateAction } from "react";
import type {
  AppSettings,
  BindRemoteWorkspaceSessionContextResult,
  ConnectionProfile,
  IPlatformService,
  RemoteTargetSnapshot,
  RemoteWorkspaceSessionEntry,
} from "@origin-ai/cf-shared";
import {
  REMOTE_WORKSPACE_DIRECTORY_UNAVAILABLE_ERROR_CODE,
  stripRemoteTargetSecrets,
} from "@origin-ai/cf-shared";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import { toast } from "@/components/ui/toast.js";
import {
  buildRemoteWorkspaceSessionMutation,
  createRemoteTargetFromSnapshot,
  resolveRemoteWorkspaceSessionIdentity,
} from "@/lib/remoteWorkspaceHistory.js";
import { logger } from "@/logger.js";
import { shouldShowStandaloneRemoteErrorToast } from "@/lib/remoteConnectionPresentation.js";
import {
  bindRemoteWorkspaceIdentity,
  bindRemoteWorkspacePath,
} from "@/store/remoteWorkspaceSessionStore.js";

type ManualReconnectRemoteWorkspaceParams = {
  sessionEntry: RemoteWorkspaceSessionEntry;
  activateTabByPath: (workspacePath: string, options?: { workspaceIdentity?: string }) => boolean;
  setReconnectingRemoteWorkspaceKeys: Dispatch<SetStateAction<string[]>>;
  loadCredential: IServiceAccessor["credentialService"]["load"];
  getSettings?: IServiceAccessor["settingService"]["get"];
  connectRemoteWorkspaceTarget: (
    target: Parameters<IPlatformService["connectRemote"]>[0],
    requestId?: string,
    context?: Parameters<IPlatformService["connectRemote"]>[2],
  ) => Promise<string>;
  resolveRemoteWorkspaceCanonicalPath: (
    sessionId: string,
    workspacePath: string,
  ) => Promise<string>;
  bindRemoteWorkspaceScope: (
    sessionId: string,
    workspacePath: string,
    workspaceIdentity?: string,
    workspacePurpose?: "project" | "conversation",
  ) => Promise<
    Pick<BindRemoteWorkspaceSessionContextResult, "workspacePath" | "workspaceIdentity">
  >;
  disposeRemoteWorkspaceSession: (sessionId: string) => Promise<void>;
  bindRemoteWorkspacePath: typeof bindRemoteWorkspacePath;
  bindRemoteWorkspaceIdentity: typeof bindRemoteWorkspaceIdentity;
  upsertWorkspaceTab: (
    workspacePath: string,
    options?: {
      remoteSessionId?: string;
      remoteTarget?: Parameters<IPlatformService["connectRemote"]>[0];
      workspaceIdentity?: string;
      previousWorkspaceIdentity?: string;
      localWorkspacePath?: string;
      workspacePurpose?: "project" | "conversation";
    },
  ) => void;
  commitRemoteWorkspaceSessionMutation: (
    mutation: ReturnType<typeof buildRemoteWorkspaceSessionMutation>,
  ) => Promise<RemoteWorkspaceSessionEntry>;
  getRemoteSessions: () => RemoteWorkspaceSessionEntry[];
  logger: Pick<typeof logger, "warn">;
  toast: typeof toast;
  shouldKeepReconnectedWorkspace?: (
    context: Pick<RemoteWorkspaceSessionEntry, "workspacePath" | "workspaceIdentity">,
  ) => boolean;
  onWorkspaceActivated?: (target: {
    workspacePath: string;
    workspaceIdentity: string;
    restoreSelection?: boolean;
  }) => void;
  formatError?: (error: unknown) => string;
  options?: ReconnectRemoteWorkspaceOptions;
};

export interface SshReconnectCredentials {
  password: string | null;
  privateKeyPassphrase: string | null;
}

export interface ReconnectRemoteWorkspaceOptions {
  
  requireStoredCredentials?: boolean;
  activateWorkspaceAfterReconnect?: boolean;
  showErrorToast?: boolean;
  requestId?: string;
  throwOnFailure?: boolean;
  recoveryMode?: "automatic" | "manual";
  
  sshCredentialsOverride?: SshReconnectCredentials;
  
  onSshHostReady?: (credentials: SshReconnectCredentials) => void;
}

export async function loadConnectionProfileCredentials(params: {
  profile: ConnectionProfile;
  loadCredential: IServiceAccessor["credentialService"]["load"];
}): Promise<SshReconnectCredentials | null> {
  if (params.profile.target.kind !== "ssh") return null;
  const target = params.profile.target;
  if (!target.passwordCredentialKey && !target.privateKeyPassphraseCredentialKey) {
    return { password: null, privateKeyPassphrase: null };
  }
  return {
    password: target.passwordCredentialKey
      ? await params.loadCredential(target.passwordCredentialKey)
      : null,
    privateKeyPassphrase: target.privateKeyPassphraseCredentialKey
      ? await params.loadCredential(target.privateKeyPassphraseCredentialKey)
      : null,
  };
}

function resolveSshReconnectSnapshot(params: {
  sessionEntry: RemoteWorkspaceSessionEntry;
  settings?: Pick<AppSettings, "connectionProfiles" | "sourceServerWorkspaceHistory">;
}): RemoteTargetSnapshot {
  const previous = params.sessionEntry.target;
  if (previous.kind !== "ssh") return previous;
  const history = params.settings?.sourceServerWorkspaceHistory?.find(
    (entry) =>
      entry.workspacePath === params.sessionEntry.workspacePath &&
      entry.workspaceIdentity === params.sessionEntry.workspaceIdentity,
  );
  if (!history) return previous;
  const profile = params.settings?.connectionProfiles?.find(
    (candidate) => candidate.profileId === history.profileId && candidate.target.kind === "ssh",
  );
  if (!profile || profile.target.kind !== "ssh") return previous;
  const target = profile.target;
  if (
    !target.passwordCredentialKey &&
    !target.privateKeyPassphraseCredentialKey &&
    target.privateKeyPath === previous.privateKeyPath
  ) {
    return {
      ...target,
      passwordCredentialKey: previous.passwordCredentialKey,
      privateKeyPassphraseCredentialKey: previous.privateKeyPassphraseCredentialKey,
    };
  }
  return target;
}

export async function reconnectRemoteWorkspaceHistoryEntry({
  sessionEntry,
  activateTabByPath,
  setReconnectingRemoteWorkspaceKeys,
  loadCredential,
  getSettings,
  connectRemoteWorkspaceTarget,
  resolveRemoteWorkspaceCanonicalPath,
  bindRemoteWorkspaceScope,
  disposeRemoteWorkspaceSession,
  bindRemoteWorkspacePath,
  bindRemoteWorkspaceIdentity,
  upsertWorkspaceTab,
  commitRemoteWorkspaceSessionMutation,
  getRemoteSessions,
  logger,
  toast,
  shouldKeepReconnectedWorkspace,
  onWorkspaceActivated,
  formatError,
  options,
}: ManualReconnectRemoteWorkspaceParams): Promise<void> {
  const activateWorkspaceAfterReconnect = options?.activateWorkspaceAfterReconnect ?? true;
  const showErrorToast = options?.showErrorToast ?? true;
  const fallbackWorkspaceIdentity = resolveRemoteWorkspaceSessionIdentity(sessionEntry);
  const reconnectWorkspaceKey = fallbackWorkspaceIdentity?.trim() || sessionEntry.workspacePath;

  setReconnectingRemoteWorkspaceKeys((currentKeys) =>
    currentKeys.includes(reconnectWorkspaceKey)
      ? currentKeys
      : [...currentKeys, reconnectWorkspaceKey],
  );

  let reconnectTarget = createRemoteTargetFromSnapshot(sessionEntry.target, {
    password: null,
    privateKeyPassphrase: null,
    token: null,
  });
  let resolvedWorkspacePath = sessionEntry.workspacePath;
  let resolvedWorkspaceIdentity = fallbackWorkspaceIdentity;
  try {
    const settings = getSettings ? await getSettings() : undefined;
    const targetSnapshot = resolveSshReconnectSnapshot({ sessionEntry, settings });
    const sshCredentials = options?.sshCredentialsOverride ?? {
      password:
        targetSnapshot.kind === "ssh" && targetSnapshot.passwordCredentialKey
          ? await loadCredential(targetSnapshot.passwordCredentialKey)
          : null,
      privateKeyPassphrase:
        targetSnapshot.kind === "ssh" && targetSnapshot.privateKeyPassphraseCredentialKey
          ? await loadCredential(targetSnapshot.privateKeyPassphraseCredentialKey)
          : null,
    };
    const token =
      sessionEntry.target.kind === "server" && sessionEntry.target.tokenCredentialKey
        ? await loadCredential(sessionEntry.target.tokenCredentialKey)
        : null;
    reconnectTarget = createRemoteTargetFromSnapshot(targetSnapshot, {
      ...sshCredentials,
      token,
    });
    if (options?.requireStoredCredentials && reconnectTarget.kind === "ssh") {
      const expectsPassphrase =
        targetSnapshot.kind === "ssh" && targetSnapshot.privateKeyPassphraseCredentialKey;
      if (
        !sshCredentials.password &&
        (!reconnectTarget.privateKeyPath ||
          (expectsPassphrase && !sshCredentials.privateKeyPassphrase))
      ) {
        throw Object.assign(new Error("credentials-required"), { code: "credentials-required" });
      }
    }
    let sessionId: string;
    try {
      sessionId = await connectRemoteWorkspaceTarget(reconnectTarget, options?.requestId, {
      workspacePath: sessionEntry.workspacePath,
      workspaceIdentity: fallbackWorkspaceIdentity,
      connectTrigger: "reconnect",
    });
    } catch (error) {
      if (
        reconnectTarget.kind === "ssh" &&
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === REMOTE_WORKSPACE_DIRECTORY_UNAVAILABLE_ERROR_CODE
      ) {
        options?.onSshHostReady?.(sshCredentials);
      }
      throw error;
    }
    if (reconnectTarget.kind === "ssh") {
      options?.onSshHostReady?.(sshCredentials);
    }
    resolvedWorkspacePath = await resolveRemoteWorkspaceCanonicalPath(
      sessionId,
      sessionEntry.workspacePath,
    );
    const boundScope = await bindRemoteWorkspaceScope(
      sessionId,
      resolvedWorkspacePath,
      undefined,
      sessionEntry.workspacePurpose ?? "project",
    );
    resolvedWorkspacePath = boundScope.workspacePath;
    resolvedWorkspaceIdentity = boundScope.workspaceIdentity;
    if (
      shouldKeepReconnectedWorkspace &&
      !shouldKeepReconnectedWorkspace({
        workspacePath: resolvedWorkspacePath,
        workspaceIdentity: resolvedWorkspaceIdentity,
      })
    ) {
      logger.warn("[Root] Remote workspace was removed during reconnection; skipping restoration and reclaiming session", {
        workspacePath: resolvedWorkspacePath,
      });
      await disposeRemoteWorkspaceSession(sessionId);
      return;
    }
    bindRemoteWorkspacePath(resolvedWorkspacePath, sessionId);
    bindRemoteWorkspaceIdentity(resolvedWorkspaceIdentity, sessionId);
    upsertWorkspaceTab(resolvedWorkspacePath, {
      remoteSessionId: sessionId,
      remoteTarget: stripRemoteTargetSecrets(reconnectTarget),
      workspaceIdentity: resolvedWorkspaceIdentity,
      ...(fallbackWorkspaceIdentity !== resolvedWorkspaceIdentity
        ? { previousWorkspaceIdentity: fallbackWorkspaceIdentity }
        : {}),
      localWorkspacePath: sessionEntry.localWorkspacePath,
      workspacePurpose: sessionEntry.workspacePurpose,
    });
    if (activateWorkspaceAfterReconnect) {
      const activated = activateTabByPath(resolvedWorkspacePath, {
        workspaceIdentity: resolvedWorkspaceIdentity,
      });
      if (activated) {
        onWorkspaceActivated?.({
          workspacePath: resolvedWorkspacePath,
          workspaceIdentity: resolvedWorkspaceIdentity,
          restoreSelection: true,
        });
      }
    }
    await commitRemoteWorkspaceSessionMutation(
      buildRemoteWorkspaceSessionMutation({
        remoteSessions: getRemoteSessions(),
        workspacePath: resolvedWorkspacePath,
        localWorkspacePath: sessionEntry.localWorkspacePath,
        workspaceIdentity: resolvedWorkspaceIdentity,
        target: reconnectTarget,
        workspacePurpose: sessionEntry.workspacePurpose,
        lastConnectionStatus: "connected",
        touchOpenedAt: true,
      }),
    );
  } catch (error) {
    const message =
      formatError?.(error) ?? (error instanceof Error ? error.message : String(error));
    logger.warn("[Root] 手动重连远程 workspace 失败", {
      workspacePath: resolvedWorkspacePath,
      error: message,
    });
    await commitRemoteWorkspaceSessionMutation(
      buildRemoteWorkspaceSessionMutation({
        remoteSessions: getRemoteSessions(),
        workspacePath: resolvedWorkspacePath,
        workspaceIdentity: resolvedWorkspaceIdentity,
        target: reconnectTarget,
        lastConnectionStatus: "failed",
        lastConnectionError: message,
        touchOpenedAt: false,
      }),
    );
    const reasonCode =
      error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
    if (showErrorToast && shouldShowStandaloneRemoteErrorToast(reasonCode)) {
      toast(message);
    }
    if (options?.throwOnFailure) {
      throw error;
    }
  } finally {
    setReconnectingRemoteWorkspaceKeys((currentKeys) =>
      currentKeys.filter((key) => key !== reconnectWorkspaceKey),
    );
  }
}
