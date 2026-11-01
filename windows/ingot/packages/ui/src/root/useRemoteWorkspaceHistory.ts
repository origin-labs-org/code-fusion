import type {
  RemoteConnectionFeedbackOptions,
  RemoteConnectionOpenPreference,
} from "@/app-shell/types.js";
import { requestRemoteProjectConnection } from "@/remote-connection-flow/contract.js";
import { requestRetainedRemoteProjectConnection } from "@/project-sidebar/remote-project-connection.js";
import {
  formatRemoteConnectionDescription,
  getRemoteDevicePresentationInput,
  resolveRemoteConnectionPresentation,
} from "@/lib/remoteConnectionPresentation.js";
import { getWorkspaceSourceServerId } from "@/conversation-workspace-target/sourceIdentity.js";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  AppSettings,
  BindRemoteWorkspaceSessionContextResult,
  IPlatformService,
  RemoteTarget,
  RemoteSessionClosedEvent,
  RemoteSessionReconnectedEvent,
  SourceServerConnectionState,
  SourceServerManagementSnapshot,
  RemoteWorkspaceSessionEntry,
} from "@origin-ai/cf-shared";
import {
  buildSshRemoteHostKey,
  createUuid,
  parseRemoteWorkspaceIdentity,
  stripRemoteTargetSecrets,
} from "@origin-ai/cf-shared";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import {
  bindRemoteWorkspaceIdentity,
  bindRemoteWorkspacePath,
  clearRemoteWorkspaceConnectionState,
  getRemoteWorkspaceSession,
  setRemoteWorkspaceConnectionState,
  type RemoteWorkspaceSession,
  unregisterRemoteWorkspaceSession,
  useRemoteWorkspaceSessionStore,
} from "@/store/remoteWorkspaceSessionStore.js";
import { toast } from "@/components/ui/toast.js";
import {
  buildRemoteWorkspaceSessionMutation,
  buildWorkspaceSessionKey,
  createRemoteTargetFromSnapshot,
  getRemoteWorkspaceSessionEntries,
  projectRemoteWorkspaceSessionIdentityAliases,
  removeRemoteWorkspaceSessionEntries,
} from "@/lib/remoteWorkspaceHistory.js";
import { getErrorMessage } from "@/lib/errorMessage.js";
import { logger } from "@/logger.js";
import { formatRemoteConnectionError } from "@/lib/remoteConnectionPresentation.js";
import type { RemoteWorkspaceRecoveryStatus } from "@/app-shell/types.js";
import {
  isWorkspaceTab,
  type TabStoreState,
  type WindowTabState,
  type WorkspaceTabState,
} from "@/store/tabStore.js";
import {
  buildRemoteWorkspacePersistPatch,
  projectRemoteConversationWorkspacePurpose,
  restorePersistedRemoteWorkspaceSessions,
} from "@/root/remoteWorkspaceSessionPersistence.js";
import { useReconnectingRemoteWorkspaceLogs } from "@/root/useReconnectingRemoteWorkspaceLogs.js";
import {
  reconnectRemoteWorkspaceHistoryEntry,
  type ReconnectRemoteWorkspaceOptions,
  type SshReconnectCredentials,
} from "@/root/reconnectRemoteWorkspaceHistoryEntry.js";
import { useRemoteConnectionEntryVisibility } from "@/hooks/useRemoteConnectionEntryVisibility.js";
import { createRemoteWorkspaceController } from "@/remote/remoteWorkspaceController.js";
import type { RemoteWorkspaceController } from "@/remote/remoteWorkspaceController.js";
import { buildRemoteTargetFromProfile } from "@/lib/remoteConnectionWizard.js";
import { useCfSessionStore } from "@/store/cfSessionStore.js";
import { loadConnectionProfileCredentials } from "@/root/reconnectRemoteWorkspaceHistoryEntry.js";
import type { WorkspacePersistenceGate } from "@/hooks/useTabPersistence.js";

export { reconnectRemoteWorkspaceHistoryEntry };

export function updateRemoteWorkspaceRecoveringKeys(
  currentKeys: string[],
  tabs: WorkspaceTabState[],
  recovering: boolean,
): string[] {
  const workspaceKeys = new Set(tabs.map((tab) => buildWorkspaceSessionKey(tab)));
  if (recovering) return [...new Set([...currentKeys, ...workspaceKeys])];
  return currentKeys.filter((key) => !workspaceKeys.has(key));
}

export function shouldAttemptStartupReconnectForSourceState(
  state: SourceServerConnectionState,
): boolean {
  return state === "online";
}

export function shouldAttemptStartupReconnectForTabChange(
  tabs: readonly WindowTabState[],
  previousTabs: readonly WindowTabState[],
): boolean {
  const previousWorkspaceKeys = new Set(
    previousTabs.filter(isWorkspaceTab).map((tab) => buildWorkspaceSessionKey(tab)),
  );
  return tabs.some(
    (tab) =>
      isWorkspaceTab(tab) &&
      !tab.remoteSessionId &&
      parseRemoteWorkspaceIdentity(tab.workspaceIdentity ?? "")?.kind === "server" &&
      !previousWorkspaceKeys.has(buildWorkspaceSessionKey(tab)),
  );
}

export function isRemoteWorkspaceCloseFailure(
  event: Pick<
    RemoteSessionClosedEvent,
    "error" | "reasonCode" | "exitCode" | "signal" | "recoveryBudgetExhausted"
  >,
): boolean {
  return Boolean(
    event.error ||
    event.reasonCode ||
    event.recoveryBudgetExhausted ||
    (event.exitCode != null && event.exitCode !== 0) ||
    event.signal,
  );
}

export function resolveRemoteWorkspaceClosedFallback(params: {
  event: Pick<
    RemoteSessionClosedEvent,
    "error" | "recoveryAttempt" | "recoveryBudgetExhausted" | "recoveryLimit"
  >;
  formatMessage: (descriptor: { id: string }, values?: Record<string, number | string>) => string;
  defaultFallback?: string;
}): string {
  if (params.event.recoveryBudgetExhausted) {
    return params.formatMessage(
      { id: "remote.error.recoveryBudgetExhausted" },
      {
        attempt: params.event.recoveryAttempt ?? "?",
        limit: params.event.recoveryLimit ?? "?",
      },
    );
  }
  return (
    params.event.error?.trim() ||
    params.defaultFallback ||
    params.formatMessage({ id: "remote.error.connectionClosed" })
  );
}

export async function bindRemoteWorkspaceContextAndGetSession(params: {
  platform: Pick<IPlatformService, "bindRemoteWorkspaceSessionContext">;
  sessionId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  workspacePurpose?: "project" | "conversation";
}): Promise<RemoteWorkspaceSession> {
  if (!getRemoteWorkspaceSession(params.sessionId)) {
    throw new Error(`Remote workspace session 不存在: ${params.sessionId}`);
  }
  const binding = await params.platform.bindRemoteWorkspaceSessionContext?.({
    remoteSessionId: params.sessionId,
    workspacePath: params.workspacePath,
    workspaceIdentity: params.workspaceIdentity,
    workspacePurpose: params.workspacePurpose,
  });
  const currentSession = getRemoteWorkspaceSession(params.sessionId);
  if (!currentSession) {
    throw new Error(`Remote workspace session 不存在: ${params.sessionId}`);
  }
  const workspaceIdentity =
    binding?.workspaceIdentity?.trim() ||
    currentSession.workspaceIdentity?.trim() ||
    params.workspaceIdentity?.trim();
  if (!workspaceIdentity) {
    throw new Error(`Remote workspace bind 未Back权威 identity: ${params.sessionId}`);
  }
  return {
    ...currentSession,
    ...(binding?.sourceServerId ? { sourceServerId: binding.sourceServerId } : {}),
    workspacePath: binding?.workspacePath ?? currentSession.workspacePath ?? params.workspacePath,
    workspaceIdentity,
    ...(binding?.workspacePurpose
      ? { workspacePurpose: binding.workspacePurpose }
      : params.workspacePurpose
        ? { workspacePurpose: params.workspacePurpose }
        : {}),
    ...(binding?.previousWorkspaceIdentity
      ? { previousWorkspaceIdentity: binding.previousWorkspaceIdentity }
      : {}),
  };
}

type BoundRemoteWorkspaceScope = Pick<
  BindRemoteWorkspaceSessionContextResult,
  "workspacePath" | "workspaceIdentity" | "previousWorkspaceIdentity" | "workspacePurpose"
>;

export function shouldPersistRemoteWorkspaceFailure(params: {
  pendingReconnectRequestIds: ReadonlyMap<string, string>;
  sessionEntry: RemoteWorkspaceSessionEntry;
  workspaceKey: string;
}): boolean {
  if (params.sessionEntry.target.kind !== "wsl") {
    return true;
  }

  return !params.pendingReconnectRequestIds.has(params.workspaceKey);
}
interface RemoteWorkspaceTabStoreReader {
  getState(): {
    tabs: WindowTabState[];
  };
}

interface OpenRemoteWorkspaceFromHistoryParams {
  workspaceKey: string;
  tabStoreApi: RemoteWorkspaceTabStoreReader;
  getRemoteSessions: () => RemoteWorkspaceSessionEntry[];
  inflightReconnectWorkspaceKeys: Set<string>;
  activateTabByPath: (workspacePath: string, options?: { workspaceIdentity?: string }) => boolean;
  setReconnectingRemoteWorkspaceKeys: Dispatch<SetStateAction<string[]>>;
  loadCredential: IServiceAccessor["credentialService"]["load"];
  connectRemoteWorkspaceTarget: (
    target: Parameters<IPlatformService["connectRemote"]>[0],
    requestId?: string,
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
  ) => Promise<BoundRemoteWorkspaceScope>;
  disposeRemoteWorkspaceSession: (sessionId: string) => Promise<void>;
  addTab: (
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
  resetLogsForWorkspaceKey: (workspaceKey: string) => void;
  onWorkspaceActivated?: (target: {
    workspacePath: string;
    workspaceIdentity: string;
    restoreSelection?: boolean;
  }) => void;
  createReconnectRequestId?: () => string;
  pendingReconnectRequestIds?: Map<string, string>;
  reconnectImpl?: typeof reconnectRemoteWorkspaceHistoryEntry;
}

interface ReconnectRemoteWorkspaceByKeyParams {
  workspaceKey: string;
  canUseRemoteWorkspace: boolean;
  getRemoteSessions: () => RemoteWorkspaceSessionEntry[];
  runReconnectRemoteWorkspace: (
    sessionEntry: RemoteWorkspaceSessionEntry,
    options?: ReconnectRemoteWorkspaceOptions,
  ) => Promise<void>;
  options?: ReconnectRemoteWorkspaceOptions;
}

export async function reconnectRemoteWorkspaceByKey({
  workspaceKey,
  canUseRemoteWorkspace,
  getRemoteSessions,
  runReconnectRemoteWorkspace,
  options,
}: ReconnectRemoteWorkspaceByKeyParams): Promise<boolean> {
  if (!canUseRemoteWorkspace) {
    throw new Error("Remote workspace is disabled in this mode");
  }

  const sessionEntry = getRemoteSessions().find(
    (entry) => buildWorkspaceSessionKey(entry) === workspaceKey,
  );
  if (!sessionEntry) {
    throw new Error(`Remote workspace 不在CurrentWindowMedium，无法Reconnect: ${workspaceKey}`);
  }

  await runReconnectRemoteWorkspace(sessionEntry, options);
  return true;
}

export function collectSshReconnectGroup(params: {
  selected: RemoteWorkspaceSessionEntry;
  sessions: RemoteWorkspaceSessionEntry[];
  tabs: WindowTabState[];
}): RemoteWorkspaceSessionEntry[] {
  if (params.selected.target.kind !== "ssh") {
    return [params.selected];
  }
  const remoteHostKey = buildSshRemoteHostKey(params.selected.target);
  const disconnectedWorkspaceKeys = new Set(
    params.tabs.flatMap((tab) => {
      if (!isWorkspaceTab(tab) || tab.remoteSessionId) {
        return [];
      }
      return [buildWorkspaceSessionKey(tab)];
    }),
  );
  const reconnectGroup = params.sessions.filter(
    (entry) =>
      entry.target.kind === "ssh" &&
      buildSshRemoteHostKey(entry.target) === remoteHostKey &&
      disconnectedWorkspaceKeys.has(buildWorkspaceSessionKey(entry)),
  );
  const selectedWorkspaceKey = buildWorkspaceSessionKey(params.selected);
  if (!reconnectGroup.some((entry) => buildWorkspaceSessionKey(entry) === selectedWorkspaceKey)) {
    return [params.selected];
  }

  return [
    params.selected,
    ...reconnectGroup.filter((entry) => buildWorkspaceSessionKey(entry) !== selectedWorkspaceKey),
  ];
}

interface RemoteWorkspaceReconnectRendererState {
  attemptedWorkspaceKeys: Set<string>;
  currentRendererDisconnectedSourceServerIds: Set<string>;
  pendingTerminallyDisconnectedSourceServerIds: Set<string>;
  observedOnlineSourceServerIds: Set<string>;
}

export function collectStartupRemoteWorkspaceReconnectGroups(params: {
  sessions: RemoteWorkspaceSessionEntry[];
  manuallyOpeningWorkspaceTabId?: string;
  tabs: WindowTabState[];
  attemptedWorkspaceKeys: ReadonlySet<string>;
  onlineSourceServerIds: ReadonlySet<string>;
  currentRendererDisconnectedSourceServerIds?: ReadonlySet<string>;
  pendingTerminallyDisconnectedSourceServerIds?: ReadonlySet<string>;
}): Array<{ sourceServerId: string; entries: RemoteWorkspaceSessionEntry[] }> {
  const disconnectedWorkspaceKeys = new Set(
    params.tabs.flatMap((tab) => {
      if (tab.id === params.manuallyOpeningWorkspaceTabId) return [];
      if (!isWorkspaceTab(tab) || tab.remoteSessionId || tab.workspacePurpose === "conversation")
        return [];
      return [buildWorkspaceSessionKey(tab)];
    }),
  );
  const resolveEligibleSourceServerId = (session: RemoteWorkspaceSessionEntry): string | null => {
    if (session.workspacePurpose === "conversation") return null;
    const workspaceKey = buildWorkspaceSessionKey(session);
    const parsed = session.workspaceIdentity
      ? parseRemoteWorkspaceIdentity(session.workspaceIdentity)
      : null;
    const sourceServerId = parsed?.kind === "server" ? parsed.sourceServerId : undefined;
    const disconnectedInCurrentRenderer = Boolean(
      sourceServerId && params.currentRendererDisconnectedSourceServerIds?.has(sourceServerId),
    );
    if (
      (sourceServerId &&
        params.pendingTerminallyDisconnectedSourceServerIds?.has(sourceServerId)) ||
      !disconnectedWorkspaceKeys.has(workspaceKey) ||
      (params.attemptedWorkspaceKeys.has(workspaceKey) && !disconnectedInCurrentRenderer)
    ) {
      return null;
    }
    return sourceServerId && params.onlineSourceServerIds.has(sourceServerId)
      ? sourceServerId
      : null;
  };
  const groups = new Map<string, RemoteWorkspaceSessionEntry[]>();
  for (const session of params.sessions) {
    const sourceServerId = resolveEligibleSourceServerId(session);
    if (!sourceServerId) {
      continue;
    }
    const entries = groups.get(sourceServerId) ?? [];
    entries.push(session);
    groups.set(sourceServerId, entries);
  }
  return [...groups].map(([sourceServerId, entries]) => ({
    sourceServerId,
    entries,
  }));
}

export function updateStartupRemoteWorkspaceReconnectAttemptsForSourceState(params: {
  state: {
    state: SourceServerConnectionState;
    sourceServerId?: string;
  };
  onlineSourceServerIds: ReadonlySet<string>;
  sessions: readonly RemoteWorkspaceSessionEntry[];
  attemptedWorkspaceKeys: Set<string>;
}): void {
  const sourceServerId = params.state.sourceServerId;
  if (
    !sourceServerId ||
    params.state.state === "online" ||
    params.onlineSourceServerIds.has(sourceServerId)
  ) {
    return;
  }
  for (const session of params.sessions) {
    const parsed = session.workspaceIdentity
      ? parseRemoteWorkspaceIdentity(session.workspaceIdentity)
      : null;
    if (parsed?.kind === "server" && parsed.sourceServerId === sourceServerId) {
      params.attemptedWorkspaceKeys.delete(buildWorkspaceSessionKey(session));
    }
  }
}

export async function reconnectRemoteWorkspaceGroup(params: {
  selected: RemoteWorkspaceSessionEntry;
  reconnectGroup: RemoteWorkspaceSessionEntry[];
  reconnectEntry: (
    entry: RemoteWorkspaceSessionEntry,
    options?: ReconnectRemoteWorkspaceOptions,
  ) => Promise<boolean>;
  options?: ReconnectRemoteWorkspaceOptions;
}): Promise<void> {
  const selectedWorkspaceKey = buildWorkspaceSessionKey(params.selected);
  const siblings = params.reconnectGroup.filter(
    (entry) => buildWorkspaceSessionKey(entry) !== selectedWorkspaceKey,
  );

  if (params.selected.target.kind !== "ssh") {
    try {
      await params.reconnectEntry(params.selected, {
        ...params.options,
        throwOnFailure: true,
      });
    } catch (error) {
      if (params.options?.throwOnFailure) {
        throw error;
      }
    }
    return;
  }

  type InitiatorHostGate =
    | { status: "ready"; credentials: SshReconnectCredentials }
    | { status: "skipped" }
    | { status: "failed"; error: unknown };
  let hostReadyCredentials: SshReconnectCredentials | undefined;
  let resolveHostReady!: (result: InitiatorHostGate) => void;
  const hostReadyPromise = new Promise<InitiatorHostGate>((resolve) => {
    resolveHostReady = resolve;
  });

  const initiatorPromise = params.reconnectEntry(params.selected, {
    ...params.options,
    throwOnFailure: true,
    onSshHostReady: (credentials) => {
      if (hostReadyCredentials) {
        return;
      }
      hostReadyCredentials = credentials;
      resolveHostReady({ status: "ready", credentials });
    },
  });
  const initiatorFinishedBeforeReady = initiatorPromise.then<InitiatorHostGate, InitiatorHostGate>(
    (didReconnect) => {
      if (hostReadyCredentials) {
        return { status: "ready", credentials: hostReadyCredentials };
      }
      return didReconnect
        ? {
            status: "failed",
            error: new Error("SSH initiator completed without reporting Host ready"),
          }
        : { status: "skipped" };
    },
    (error: unknown) =>
      hostReadyCredentials
        ? { status: "ready", credentials: hostReadyCredentials }
        : { status: "failed", error },
  );
  const hostGate = await Promise.race([hostReadyPromise, initiatorFinishedBeforeReady]);
  if (hostGate.status !== "ready") {
    if (hostGate.status === "failed" && params.options?.throwOnFailure) {
      throw hostGate.error;
    }
    return;
  }

  const siblingPromise = Promise.allSettled(
    siblings.map((entry) =>
      params.reconnectEntry(entry, {
        ...params.options,
        activateWorkspaceAfterReconnect: false,
        sshCredentialsOverride: hostGate.credentials,
      }),
    ),
  );
  const [initiatorResult] = await Promise.all([
    initiatorPromise.then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    ),
    siblingPromise,
  ]);
  if (initiatorResult.status === "rejected" && params.options?.throwOnFailure) {
    throw initiatorResult.error;
  }
}

export async function restoreSourceRemoteWorkspaceGroup(params: {
  entries: RemoteWorkspaceSessionEntry[];
  reconnectEntry: (
    entry: RemoteWorkspaceSessionEntry,
    options?: ReconnectRemoteWorkspaceOptions,
  ) => Promise<boolean>;
  options?: ReconnectRemoteWorkspaceOptions;
}): Promise<void> {
  for (const entry of params.entries) {
    try {
      await params.reconnectEntry(entry, params.options);
    } catch (error) {
      if (params.options?.throwOnFailure) throw error;
    }
  }
}

function shouldKeepRemoteWorkspaceInTabs(params: {
  tabStoreApi: RemoteWorkspaceTabStoreReader;
  workspacePath: string;
  workspaceIdentity?: string;
}): boolean {
  const reconnectWorkspaceKey = params.workspaceIdentity?.trim() || params.workspacePath;
  return params.tabStoreApi
    .getState()
    .tabs.some(
      (tab): tab is import("@/store/tabStore.js").WorkspaceTabState =>
        isWorkspaceTab(tab) &&
        ((tab.workspaceIdentity?.trim() || tab.workspacePath) === reconnectWorkspaceKey ||
          tab.workspacePath === params.workspacePath),
    );
}

export async function cancelPendingRemoteReconnectsForWorkspaceKeys(params: {
  workspaceKeys: string[];
  pendingRequestIds: Map<string, string>;
  cancelPendingRemoteConnection?: (requestId?: string) => Promise<void>;
  logger: Pick<typeof logger, "warn">;
}): Promise<void> {
  const requestIds = params.workspaceKeys.flatMap((workspaceKey) => {
    const requestId = params.pendingRequestIds.get(workspaceKey);
    if (!requestId) {
      return [];
    }

    params.pendingRequestIds.delete(workspaceKey);
    return [requestId];
  });

  if (!params.cancelPendingRemoteConnection || requestIds.length === 0) {
    return;
  }

  await Promise.all(
    requestIds.map(async (requestId) => {
      try {
        await params.cancelPendingRemoteConnection?.(requestId);
      } catch (error) {
        params.logger.warn("[Root] 取消远程 workspace 重连失败", {
          requestId,
          error,
        });
      }
    }),
  );
}

export async function openRemoteWorkspaceFromHistoryEntry({
  workspaceKey,
  tabStoreApi,
  getRemoteSessions,
  inflightReconnectWorkspaceKeys,
  activateTabByPath,
  setReconnectingRemoteWorkspaceKeys,
  loadCredential,
  connectRemoteWorkspaceTarget,
  resolveRemoteWorkspaceCanonicalPath,
  bindRemoteWorkspaceScope,
  disposeRemoteWorkspaceSession,
  addTab,
  commitRemoteWorkspaceSessionMutation,
  resetLogsForWorkspaceKey,
  createReconnectRequestId,
  pendingReconnectRequestIds,
  reconnectImpl = reconnectRemoteWorkspaceHistoryEntry,
  onWorkspaceActivated,
}: OpenRemoteWorkspaceFromHistoryParams): Promise<void> {
  const sessionEntry = getRemoteSessions().find(
    (entry) => buildWorkspaceSessionKey(entry) === workspaceKey,
  );
  if (!sessionEntry) {
    return;
  }

  if (inflightReconnectWorkspaceKeys.has(workspaceKey)) {
    return;
  }

  const existingWorkspaceTab = tabStoreApi
    .getState()
    .tabs.find(
      (tab): tab is import("@/store/tabStore.js").WorkspaceTabState =>
        isWorkspaceTab(tab) && buildWorkspaceSessionKey(tab) === workspaceKey,
    );
  if (existingWorkspaceTab?.remoteSessionId) {
    activateTabByPath(existingWorkspaceTab.workspacePath, {
      workspaceIdentity: existingWorkspaceTab.workspaceIdentity,
    });
    return;
  }

  resetLogsForWorkspaceKey(workspaceKey);
  inflightReconnectWorkspaceKeys.add(workspaceKey);
  const requestId = createReconnectRequestId?.();
  if (requestId) {
    pendingReconnectRequestIds?.set(workspaceKey, requestId);
  }
  try {
    await reconnectImpl({
      sessionEntry,
      activateTabByPath,
      setReconnectingRemoteWorkspaceKeys,
      loadCredential,
      connectRemoteWorkspaceTarget,
      resolveRemoteWorkspaceCanonicalPath,
      bindRemoteWorkspaceScope,
      disposeRemoteWorkspaceSession,
      bindRemoteWorkspacePath,
      bindRemoteWorkspaceIdentity,
      upsertWorkspaceTab: addTab,
      commitRemoteWorkspaceSessionMutation,
      getRemoteSessions,
      logger,
      toast,
      shouldKeepReconnectedWorkspace: ({ workspacePath, workspaceIdentity }) =>
        shouldKeepRemoteWorkspaceInTabs({
          tabStoreApi,
          workspacePath,
          workspaceIdentity,
        }),
      onWorkspaceActivated: (target) => {
        logger.debug("[Root] Remote history workspace ready; submitting tab and draft activation", target);
        onWorkspaceActivated?.(target);
      },
      options: {
        activateWorkspaceAfterReconnect: true,
        showErrorToast: true,
        requestId,
      },
    });
  } finally {
    inflightReconnectWorkspaceKeys.delete(workspaceKey);
    if (requestId && pendingReconnectRequestIds?.get(workspaceKey) === requestId) {
      pendingReconnectRequestIds.delete(workspaceKey);
    }
  }
}

export async function selectRemoteWorkspaceProjectFromDialog({
  canUseRemoteWorkspace,
  sessionId,
  path,
  preparedWorkspaceIdentity,
  draftProjectId,
  localWorkspacePath,
  loadingMessage,
  getRemoteWorkspaceSession,
  connectionTarget,
  getWorkspaceTabs,
  restoringWorkspaceTabId,
  resolveRemoteWorkspaceCanonicalPath,
  activateTabByPath,
  handleCancelRemoteProject,
  bindRemoteWorkspaceScope,
  workspacePurpose,
  commitRemoteWorkspaceSessionMutation,
  getRemoteSessions,
  bindRemoteWorkspacePath,
  bindRemoteWorkspaceIdentity,
  addTab,
  onWorkspaceActivated,
  isCurrent,
}: {
  canUseRemoteWorkspace: boolean;
  isCurrent?: () => boolean | Promise<boolean>;
  sessionId: string;
  path: string;
  preparedWorkspaceIdentity?: string;
  draftProjectId?: string | null;
  workspacePurpose?: "project" | "conversation";
  localWorkspacePath?: string;
  loadingMessage: string;
  getRemoteWorkspaceSession: (sessionId: string) => RemoteWorkspaceSession | null;
  connectionTarget?: Parameters<IPlatformService["connectRemote"]>[0];
  getWorkspaceTabs: () => WindowTabState[];
  
  restoringWorkspaceTabId?: string;
  resolveRemoteWorkspaceCanonicalPath: (
    sessionId: string,
    workspacePath: string,
  ) => Promise<string>;
  activateTabByPath: (workspacePath: string, options?: { workspaceIdentity?: string }) => boolean;
  handleCancelRemoteProject: (sessionId: string) => Promise<void>;
  bindRemoteWorkspaceScope: (
    sessionId: string,
    workspacePath: string,
    workspaceIdentity?: string,
    workspacePurpose?: "project" | "conversation",
  ) => Promise<BoundRemoteWorkspaceScope>;
  commitRemoteWorkspaceSessionMutation: (
    mutation: ReturnType<typeof buildRemoteWorkspaceSessionMutation>,
  ) => Promise<RemoteWorkspaceSessionEntry>;
  getRemoteSessions: () => RemoteWorkspaceSessionEntry[];
  bindRemoteWorkspacePath: (workspacePath: string, sessionId: string) => void;
  bindRemoteWorkspaceIdentity: (workspaceIdentity: string, sessionId: string) => void;
  addTab: (
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
  onWorkspaceActivated?: (target: {
    workspacePath: string;
    workspaceIdentity: string;
    restoreSelection?: boolean;
    projectId?: string | null;
  }) => void;
}): Promise<void> {
  if (!canUseRemoteWorkspace) {
    throw new Error("Remote workspace is disabled in this mode");
  }

  const assertCurrent = async () => {
    if ((await isCurrent?.()) === false)
      throw Object.assign(new Error("project.navigation-cancelled"), {
        code: "remote-connection-canceled",
      });
  };
  await assertCurrent();
  const remoteSession = getRemoteWorkspaceSession(sessionId);
  if (!remoteSession) {
    throw new Error(loadingMessage);
  }
  const remoteTarget = connectionTarget ?? remoteSession.target;
  if (!remoteTarget) {
    throw new Error(`Remote workspace session MissingConnectTarget: ${sessionId}`);
  }

  const canonicalPath = preparedWorkspaceIdentity
    ? path
    : await resolveRemoteWorkspaceCanonicalPath(sessionId, path);
  await assertCurrent();
  const boundScope = await bindRemoteWorkspaceScope(
    sessionId,
    canonicalPath,
    preparedWorkspaceIdentity,
    workspacePurpose ?? "project",
  );
  await assertCurrent();
  const workspacePath = boundScope.workspacePath;
  const workspaceIdentity = boundScope.workspaceIdentity;
  const existingWorkspaceTab = getWorkspaceTabs().find(
    (tab): tab is import("@/store/tabStore.js").WorkspaceTabState =>
      isWorkspaceTab(tab) &&
      tab.workspacePath === workspacePath &&
      (tab.workspaceIdentity?.trim() || tab.workspacePath) === workspaceIdentity,
  );
  const restoringTab = restoringWorkspaceTabId
    ? getWorkspaceTabs().find((tab) => tab.id === restoringWorkspaceTabId)
    : undefined;
  const activation = {
    workspacePath,
    workspaceIdentity,
    ...(draftProjectId !== undefined ? { projectId: draftProjectId } : {}),
    ...(draftProjectId === undefined &&
    restoringTab &&
    isWorkspaceTab(restoringTab) &&
    buildWorkspaceSessionKey(restoringTab) ===
      buildWorkspaceSessionKey({ workspacePath, workspaceIdentity })
      ? { restoreSelection: true }
      : {}),
  };

  if (
    existingWorkspaceTab?.remoteSessionId &&
    activateTabByPath(workspacePath, { workspaceIdentity })
  ) {
    if (
      workspacePurpose === "conversation" &&
      existingWorkspaceTab.workspacePurpose !== "conversation"
    ) {
      addTab(workspacePath, {
        remoteSessionId: existingWorkspaceTab.remoteSessionId,
        remoteTarget: stripRemoteTargetSecrets(remoteTarget),
        workspaceIdentity,
        workspacePurpose: "conversation",
      });
    }
    clearRemoteWorkspaceConnectionState(workspaceIdentity);
    if (boundScope.previousWorkspaceIdentity) {
      clearRemoteWorkspaceConnectionState(boundScope.previousWorkspaceIdentity);
    }
    onWorkspaceActivated?.(activation);
    if (existingWorkspaceTab.remoteSessionId !== sessionId)
      await handleCancelRemoteProject(sessionId);
    return;
  }

  await commitRemoteWorkspaceSessionMutation(
    buildRemoteWorkspaceSessionMutation({
      remoteSessions: getRemoteSessions(),
      workspacePath,
      localWorkspacePath,
      workspaceIdentity,
      target: remoteTarget,
      workspacePurpose: workspacePurpose ?? "project",
      lastConnectionStatus: "connected",
      touchOpenedAt: true,
    }),
  );

  await assertCurrent();
  bindRemoteWorkspacePath(workspacePath, sessionId);
  bindRemoteWorkspaceIdentity(workspaceIdentity, sessionId);
  addTab(workspacePath, {
    remoteSessionId: sessionId,
    remoteTarget: stripRemoteTargetSecrets(remoteTarget),
    workspaceIdentity,
    ...(boundScope.previousWorkspaceIdentity
      ? { previousWorkspaceIdentity: boundScope.previousWorkspaceIdentity }
      : {}),
    localWorkspacePath,
    workspacePurpose: workspacePurpose ?? "project",
  });
  clearRemoteWorkspaceConnectionState(workspaceIdentity);
  if (boundScope.previousWorkspaceIdentity) {
    clearRemoteWorkspaceConnectionState(boundScope.previousWorkspaceIdentity);
  }
  onWorkspaceActivated?.(activation);
}

export async function openRemoteConversationWorkspace(params: {
  sessionId: string;
  sourceServerId?: string;
  getRemoteWorkspaceSession: (sessionId: string) => RemoteWorkspaceSession | null;
  getSettings: () => Promise<
    Pick<AppSettings, "sourceServerWorkspaceHistory" | "connectionProfiles">
  >;
  loadCredential: (key: string) => Promise<string | null>;
  connectRemoteWorkspaceTarget: (
    target: Parameters<IPlatformService["connectRemote"]>[0],
  ) => Promise<string>;
  waitForRemoteWorkspaceSessionReady: (sessionId: string) => Promise<void>;
  ensureConversationWorkspace: (sourceServerId: string) => Promise<{ path: string }>;
  selectRemoteWorkspace: (
    sessionId: string,
    workspacePath: string,
    workspacePurpose: "conversation",
  ) => Promise<void>;
  disposeRemoteWorkspaceSession: (sessionId: string) => Promise<void>;
}): Promise<void> {
  const initialSession = params.getRemoteWorkspaceSession(params.sessionId);
  let conversationSessionId = params.sessionId;
  let remoteSession = initialSession;
  let resolvedSourceServerId = params.sourceServerId ?? remoteSession?.sourceServerId;
  let ownedConversationSessionId: string | undefined;

  try {
    if (remoteSession?.workspacePath && remoteSession.workspacePurpose) {
      const settings = await params.getSettings();
      const history = (settings.sourceServerWorkspaceHistory ?? []).find(
        (entry) =>
          entry.workspacePath === remoteSession?.workspacePath &&
          entry.workspaceIdentity === remoteSession?.workspaceIdentity,
      );
      const profile = history?.profileId
        ? settings.connectionProfiles?.find(
            (candidate) => candidate.profileId === history.profileId,
          )
        : undefined;
      if (!profile) {
        throw new Error("Remote project connection profile is unavailable");
      }
      const target = buildRemoteTargetFromProfile(profile);
      const credentials = await loadConnectionProfileCredentials({
        profile,
        loadCredential: params.loadCredential,
      });
      const targetWithCredentials =
        target.kind === "ssh" && credentials
          ? {
              ...target,
              ...(credentials.password ? { password: credentials.password } : {}),
              ...(credentials.privateKeyPassphrase
                ? { privateKeyPassphrase: credentials.privateKeyPassphrase }
                : {}),
            }
          : target;
      conversationSessionId = await params.connectRemoteWorkspaceTarget(targetWithCredentials);
      ownedConversationSessionId = conversationSessionId;
      await params.waitForRemoteWorkspaceSessionReady(conversationSessionId);
      remoteSession = params.getRemoteWorkspaceSession(conversationSessionId);
      resolvedSourceServerId = resolvedSourceServerId ?? profile.sourceServerId;
    }
    if (!resolvedSourceServerId) {
      throw new Error("Remote conversation requires an identified Source Server");
    }
    const conversation = await params.ensureConversationWorkspace(resolvedSourceServerId);
    await params.selectRemoteWorkspace(conversationSessionId, conversation.path, "conversation");
    ownedConversationSessionId = undefined;
  } catch (error) {
    if (ownedConversationSessionId) {
      await params
        .disposeRemoteWorkspaceSession(ownedConversationSessionId)
        .catch((disposeError) => {
          logger.warn("[Root] 回收失败的远程 conversation session 失败", {
            sessionId: ownedConversationSessionId,
            error: disposeError,
          });
        });
    }
    throw error;
  }
}

export async function resolveSourceRemoteConversationWorkspaceProjection(params: {
  sourceServerId: string;
  remoteSessions: readonly RemoteWorkspaceSessionEntry[];
  conversationWorkspaceMap: AppSettings["remoteConversationWorkspaceBySourceServerId"];
  ensureConversationWorkspace: (sourceServerId: string) => Promise<{
    path: string;
    created: boolean;
    workspacePurpose: "conversation";
  }>;
}): Promise<{
  conversationWorkspaceMap: NonNullable<AppSettings["remoteConversationWorkspaceBySourceServerId"]>;
  remoteSessions: RemoteWorkspaceSessionEntry[];
  updatedEntries: Array<{
    workspacePath: string;
    workspaceIdentity?: string;
  }>;
}> {
  let conversationWorkspaceMap = params.conversationWorkspaceMap ?? {};
  if (!conversationWorkspaceMap[params.sourceServerId]) {
    const conversation = await params.ensureConversationWorkspace(params.sourceServerId);
    conversationWorkspaceMap = {
      ...conversationWorkspaceMap,
      [params.sourceServerId]: {
        workspacePath: conversation.path,
        lastResolvedAt: Date.now(),
      },
    };
  }
  return {
    conversationWorkspaceMap,
    ...projectRemoteConversationWorkspacePurpose(params.remoteSessions, conversationWorkspaceMap),
  };
}

export function useRemoteWorkspaceHistory({
  intl,
  services,
  platform,
  supportsSettings,
  isDesktop = false,
  allowRemoteWorkspace = true,
  ensureConversationWorkspaceOnRestore = false,
  deferInactiveWorkspaceRestore = false,
  unavailableWorkspacePath,
  tabStoreApi,
  activateTabByPath,
  addTab,
  persistenceGate,
  onWorkspaceActivated,
  onOpenRemoteConnection,
  manuallyOpeningWorkspaceTabId,
}: {
  intl: ReturnType<typeof import("@/i18n/IntlProvider.js").useCfIntl>["intl"];
  services: IServiceAccessor;
  platform: IPlatformService;
  supportsSettings: boolean;
  isDesktop?: boolean;
  allowRemoteWorkspace?: boolean;
  ensureConversationWorkspaceOnRestore?: boolean;
  
  deferInactiveWorkspaceRestore?: boolean;
  unavailableWorkspacePath?: string;
  tabStoreApi: ReturnType<typeof import("@/store/TabStoreProvider.js").useTabStoreApi>;
  activateTabByPath: (workspacePath: string, options?: { workspaceIdentity?: string }) => boolean;
  addTab: (
    workspacePath: string,
    options?: {
      remoteSessionId?: string;
      remoteTarget?: Parameters<IPlatformService["connectRemote"]>[0];
      workspaceIdentity?: string;
      localWorkspacePath?: string;
    },
  ) => void;
  persistenceGate?: WorkspacePersistenceGate;
  
  onOpenRemoteConnection?: (preference?: RemoteConnectionOpenPreference) => void;
  onWorkspaceActivated?: (target: {
    workspacePath: string;
    workspaceIdentity: string;
    restoreSelection?: boolean;
    projectId?: string | null;
  }) => void;
  manuallyOpeningWorkspaceTabId?: string;
}) {
  const showRemoteConnectionEntry = useRemoteConnectionEntryVisibility();
  const canUseRemoteWorkspace = allowRemoteWorkspace && showRemoteConnectionEntry;
  const allowRemoteWorkspaceRestore = canUseRemoteWorkspace;
  const [remoteWorkspaceSessions, setRemoteWorkspaceSessions] = useState<
    RemoteWorkspaceSessionEntry[]
  >([]);
  const remoteWorkspaceSessionsRef = useRef<RemoteWorkspaceSessionEntry[]>([]);
  const manuallyOpeningWorkspaceTabIdRef = useRef(manuallyOpeningWorkspaceTabId);
  manuallyOpeningWorkspaceTabIdRef.current = manuallyOpeningWorkspaceTabId;
  const pendingCredentialDeletesRef = useRef<Set<string>>(new Set());
  const flushPendingCredentialDeletes = useCallback(async () => {
    const credentialKeys = [...pendingCredentialDeletesRef.current];
    pendingCredentialDeletesRef.current.clear();
    await Promise.all(
      credentialKeys.map(async (credentialKey) => {
        try {
          await services.credentialService.delete(credentialKey);
        } catch (error) {
          logger.warn("[Root] Failed to defer deletion of remote workspace credentials", {
            credentialKey,
            error,
          });
        }
      }),
    );
  }, [services.credentialService]);
  if (persistenceGate) {
    persistenceGate.onCanPersist = flushPendingCredentialDeletes;
  }
  const [reconnectingRemoteWorkspaceKeys, setReconnectingRemoteWorkspaceKeys] = useState<string[]>(
    [],
  );
  const [remoteWorkspaceRecoveryByWorkspaceKey, setRemoteWorkspaceRecoveryByWorkspaceKey] =
    useState<Record<string, RemoteWorkspaceRecoveryStatus>>({});
  const inflightReconnectWorkspaceKeysRef = useRef<Set<string>>(new Set());
  const pendingReconnectRequestIdsRef = useRef<Map<string, string>>(new Map());
  const pendingConnectionTargetsBySessionIdRef = useRef<
    Map<string, Parameters<IPlatformService["connectRemote"]>[0]>
  >(new Map());
  const remoteStartupReconnectRefreshCompatibilityRef = useRef<
    Set<string> | RemoteWorkspaceReconnectRendererState
  >(new Set());
  const remoteWorkspaceReconnectRendererState =
    remoteStartupReconnectRefreshCompatibilityRef.current instanceof Set
      ? {
          attemptedWorkspaceKeys: remoteStartupReconnectRefreshCompatibilityRef.current,
          currentRendererDisconnectedSourceServerIds: new Set<string>(),
          pendingTerminallyDisconnectedSourceServerIds: new Set<string>(),
          observedOnlineSourceServerIds: new Set<string>(),
        }
      : remoteStartupReconnectRefreshCompatibilityRef.current;
  remoteStartupReconnectRefreshCompatibilityRef.current = remoteWorkspaceReconnectRendererState;
  const {
    logsByWorkspaceKey: reconnectingRemoteWorkspaceLogsByWorkspaceKey,
    resetLogsForWorkspaceKey,
  } = useReconnectingRemoteWorkspaceLogs({
    platform,
    reconnectingWorkspaceKeys: reconnectingRemoteWorkspaceKeys,
    resolveWorkspaceTargetByKey: (workspaceKey) =>
      remoteWorkspaceSessionsRef.current.find(
        (entry) => buildWorkspaceSessionKey(entry) === workspaceKey,
      )?.target ?? null,
    resolveWorkspaceRequestIdByKey: (workspaceKey) =>
      pendingReconnectRequestIdsRef.current.get(workspaceKey) ?? null,
  });

  const syncPersistedWorkspaceSession = useCallback(
    async (nextRemoteSessions: readonly RemoteWorkspaceSessionEntry[]) => {
      setRemoteWorkspaceSessions([...nextRemoteSessions]);
      remoteWorkspaceSessionsRef.current = [...nextRemoteSessions];

      if (!supportsSettings) {
        return;
      }
      if (persistenceGate && !persistenceGate.canPersist) {
        return;
      }

      await services.settingService.update(
        buildRemoteWorkspacePersistPatch(tabStoreApi.getState(), nextRemoteSessions),
      );
    },
    [persistenceGate, services.settingService, supportsSettings, tabStoreApi],
  );

  const commitRemoteWorkspaceSessionMutation = useCallback(
    async (mutation: ReturnType<typeof buildRemoteWorkspaceSessionMutation>) => {
      for (const credentialKey of mutation.credentialKeysToDelete) {
        if (persistenceGate && !persistenceGate.canPersist) {
          pendingCredentialDeletesRef.current.add(credentialKey);
          continue;
        }
        try {
          await services.credentialService.delete(credentialKey);
        } catch (error) {
          logger.warn("[Root] 删除远程 workspace 凭据失败", {
            credentialKey,
            error,
          });
        }
      }

      for (const credential of mutation.credentialsToSave) {
        await services.credentialService.save(credential.key, credential.value);
      }

      await syncPersistedWorkspaceSession(mutation.nextRemoteSessions);
      return mutation.entry;
    },
    [persistenceGate, services.credentialService, syncPersistedWorkspaceSession],
  );

  const waitForRemoteWorkspaceSessionReady = useCallback(async (sessionId: string) => {
    if (getRemoteWorkspaceSession(sessionId)) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const pollTimer = window.setInterval(() => {
        if (getRemoteWorkspaceSession(sessionId)) {
          window.clearInterval(pollTimer);
          resolve();
          return;
        }

        if (Date.now() - startedAt >= 3000) {
          window.clearInterval(pollTimer);
          reject(new Error(`WaitingRemote workspace session 就绪超时: ${sessionId}`));
        }
      }, 50);
    });
  }, []);

  const connectRemoteWorkspaceTarget = useCallback(
    async (
      target: Parameters<IPlatformService["connectRemote"]>[0],
      requestId?: string,
      context?: Parameters<IPlatformService["connectRemote"]>[2],
      feedback?: RemoteConnectionFeedbackOptions,
    ) => {
      const result = await platform.connectRemote(target, requestId, context);
      if (!result.success) {
        const error = new Error(getErrorMessage(result.error || "Connection failed")) as Error & {
          code?: string;
          retryable?: boolean;
          profileId?: string;
          resolvedWslTarget?: Required<Extract<RemoteTarget, { kind: "wsl" }>>;
        };
        if (result.reasonCode) error.code = result.reasonCode;
        if (result.retryable !== undefined) error.retryable = result.retryable;
        if (result.profileId) error.profileId = result.profileId;
        if (result.resolvedWslTarget) error.resolvedWslTarget = result.resolvedWslTarget;
        throw error;
      }

      if (!result.sessionId) {
        throw new Error("Remote session was not created");
      }

      await waitForRemoteWorkspaceSessionReady(result.sessionId);
      if (!context) {
        pendingConnectionTargetsBySessionIdRef.current.set(
          result.sessionId,
          result.reusedConnectionTarget ?? target,
        );
      }
      if (result.reusedConnectionTarget && feedback?.announceReusedConnection) {
        toast(
          intl.formatMessage(
            { id: "remote.reusedConnection" },
            { connection: formatRemoteConnectionDescription(result.reusedConnectionTarget) },
          ),
          { variant: "info", durationMs: 8000 },
        );
      }
      return result.sessionId;
    },
    [intl, platform, waitForRemoteWorkspaceSessionReady],
  );

  const resolveRemoteWorkspaceCanonicalPath = useCallback(
    async (sessionId: string, workspacePath: string): Promise<string> => {
      const remoteSession = getRemoteWorkspaceSession(sessionId);
      if (!remoteSession) {
        return workspacePath;
      }

      try {
        return await remoteSession.services.fileService.resolvePath({
          path: workspacePath,
        });
      } catch {
        return workspacePath;
      }
    },
    [],
  );

  const buildPersistedTabPatch = useCallback(
    (state: TabStoreState) =>
      buildRemoteWorkspacePersistPatch(state, remoteWorkspaceSessionsRef.current),
    [],
  );

  const handleCancelRemoteProject = useCallback(
    async (sessionId: string) => {
      try {
        await platform.disposeRemoteSession(sessionId);
      } finally {
        pendingConnectionTargetsBySessionIdRef.current.delete(sessionId);
        unregisterRemoteWorkspaceSession(sessionId);
      }
    },
    [platform],
  );

  const bindRemoteWorkspaceScope = useCallback(
    async (
      sessionId: string,
      workspacePath: string,
      workspaceIdentity?: string,
      workspacePurpose?: "project" | "conversation",
    ) => {
      try {
        const remoteSession = await bindRemoteWorkspaceContextAndGetSession({
          platform,
          sessionId,
          workspacePath,
          workspaceIdentity,
          workspacePurpose,
        });
        const boundWorkspacePath = remoteSession.workspacePath ?? workspacePath;
        const boundWorkspaceIdentity = remoteSession.workspaceIdentity;
        if (!boundWorkspaceIdentity) {
          throw new Error(`Remote workspace bind Missing stable identity: ${sessionId}`);
        }
        return {
          workspacePath: boundWorkspacePath,
          workspaceIdentity: boundWorkspaceIdentity,
          ...(remoteSession.workspacePurpose
            ? { workspacePurpose: remoteSession.workspacePurpose }
            : workspacePurpose
              ? { workspacePurpose }
              : {}),
          ...(isDesktop && remoteSession.previousWorkspaceIdentity
            ? {
                previousWorkspaceIdentity: remoteSession.previousWorkspaceIdentity,
              }
            : {}),
        };
      } catch (error) {
        await handleCancelRemoteProject(sessionId);
        throw error;
      }
    },
    [handleCancelRemoteProject, isDesktop, platform],
  );

  const runReconnectRemoteWorkspaceEntry = useCallback(
    async (
      sessionEntry: RemoteWorkspaceSessionEntry,
      options?: ReconnectRemoteWorkspaceOptions,
    ): Promise<boolean> => {
      const workspaceKey = buildWorkspaceSessionKey(sessionEntry);
      if (inflightReconnectWorkspaceKeysRef.current.has(workspaceKey)) {
        return false;
      }
      const workspaceTab = tabStoreApi
        .getState()
        .tabs.find(
          (tab): tab is import("@/store/tabStore.js").WorkspaceTabState =>
            isWorkspaceTab(tab) && buildWorkspaceSessionKey(tab) === workspaceKey,
        );
      if (!workspaceTab || workspaceTab.remoteSessionId) {
        return false;
      }

      resetLogsForWorkspaceKey(workspaceKey);
      inflightReconnectWorkspaceKeysRef.current.add(workspaceKey);
      const requestId = createUuid();
      const recoveryMode = options?.recoveryMode ?? "manual";
      pendingReconnectRequestIdsRef.current.set(workspaceKey, requestId);
      setRemoteWorkspaceRecoveryByWorkspaceKey((current) => ({
        ...current,
        [workspaceKey]: { mode: recoveryMode },
      }));
      setRemoteWorkspaceConnectionState(workspaceKey, "reconnecting");
      let reconnected = false;
      try {
        const upsertWorkspaceTab = tabStoreApi.getState().ensureWorkspaceTab;
        logger.debug("[Root] Remote workspace reconnecting; keeping current conversation", {
          workspaceKey,
        });
        await reconnectRemoteWorkspaceHistoryEntry({
          sessionEntry,
          activateTabByPath,
          setReconnectingRemoteWorkspaceKeys,
          loadCredential: services.credentialService.load,
          getSettings: services.settingService.get,
          connectRemoteWorkspaceTarget,
          resolveRemoteWorkspaceCanonicalPath,
          bindRemoteWorkspaceScope,
          disposeRemoteWorkspaceSession: handleCancelRemoteProject,
          bindRemoteWorkspacePath,
          bindRemoteWorkspaceIdentity,
          upsertWorkspaceTab,
          commitRemoteWorkspaceSessionMutation,
          getRemoteSessions: () => remoteWorkspaceSessionsRef.current,
          logger,
          toast,
          shouldKeepReconnectedWorkspace: ({ workspacePath, workspaceIdentity }) =>
            shouldKeepRemoteWorkspaceInTabs({
              tabStoreApi,
              workspacePath,
              workspaceIdentity,
            }),
          onWorkspaceActivated: (target) => {
            logger.debug("[Root] Remote workspace ready; submitting tab and draft activation", target);
            onWorkspaceActivated?.(target);
          },
          formatError: (error) => {
            const normalized = error as Error & {
              code?: string;
              retryable?: boolean;
              recoveryAttempt?: number;
              recoveryLimit?: number;
            };
            return formatRemoteConnectionError({
              fallback: getErrorMessage(error),
              reasonCode: normalized.code,
              retryable: normalized.retryable,
              recoveryAttempt: normalized.recoveryAttempt,
              recoveryLimit: normalized.recoveryLimit,
              formatMessage: intl.formatMessage,
            });
          },
          options: {
            ...options,
            requestId,
          },
        });
        reconnected = true;
        clearRemoteWorkspaceConnectionState(workspaceKey);
        return true;
      } finally {
        if (!reconnected) {
          setRemoteWorkspaceConnectionState(workspaceKey, "disconnected");
        }
        inflightReconnectWorkspaceKeysRef.current.delete(workspaceKey);
        if (pendingReconnectRequestIdsRef.current.get(workspaceKey) === requestId) {
          pendingReconnectRequestIdsRef.current.delete(workspaceKey);
        }
        setRemoteWorkspaceRecoveryByWorkspaceKey((current) => {
          if (current[workspaceKey]?.mode !== recoveryMode) return current;
          const next = { ...current };
          delete next[workspaceKey];
          return next;
        });
      }
    },
    [
      activateTabByPath,
      commitRemoteWorkspaceSessionMutation,
      connectRemoteWorkspaceTarget,
      handleCancelRemoteProject,
      onWorkspaceActivated,
      resolveRemoteWorkspaceCanonicalPath,
      resetLogsForWorkspaceKey,
      services.credentialService,
      services.settingService,
      bindRemoteWorkspaceScope,
      tabStoreApi,
      intl,
    ],
  );

  const runReconnectRemoteWorkspace = useCallback(
    async (
      sessionEntry: RemoteWorkspaceSessionEntry,
      options?: ReconnectRemoteWorkspaceOptions,
    ) => {
      const reconnectGroup = collectSshReconnectGroup({
        selected: sessionEntry,
        sessions: remoteWorkspaceSessionsRef.current,
        tabs: tabStoreApi.getState().tabs,
      });
      await reconnectRemoteWorkspaceGroup({
        selected: sessionEntry,
        reconnectGroup,
        reconnectEntry: runReconnectRemoteWorkspaceEntry,
        options,
      });
    },
    [runReconnectRemoteWorkspaceEntry, tabStoreApi],
  );

  useEffect(() => {
    const sourceManagement = services.sourceServerManagementService;
    if (!canUseRemoteWorkspace || remoteWorkspaceSessions.length === 0 || !sourceManagement) {
      return;
    }
    let disposed = false;
    let observedManagementGeneration = 0;
    const sourceStateByProfileId = new Map<
      string,
      Awaited<ReturnType<typeof sourceManagement.getSnapshot>>["states"][number]
    >();
    const collectOnlineSourceServerIds = () =>
      new Set(
        [...sourceStateByProfileId.values()].flatMap((state) =>
          state.state === "online" && state.sourceServerId ? [state.sourceServerId] : [],
        ),
      );
    const updateObservedSourceAvailability = () => {
      const onlineSourceServerIds = collectOnlineSourceServerIds();
      const reconnectState = remoteWorkspaceReconnectRendererState;
      reconnectState.observedOnlineSourceServerIds = onlineSourceServerIds;
      for (const sourceServerId of reconnectState.pendingTerminallyDisconnectedSourceServerIds) {
        if (onlineSourceServerIds.has(sourceServerId)) continue;
        reconnectState.pendingTerminallyDisconnectedSourceServerIds.delete(sourceServerId);
        reconnectState.currentRendererDisconnectedSourceServerIds.add(sourceServerId);
      }
    };
    const applyDirectoryWorkspaceIdentityProjection = (settings: {
      sourceServerWorkspaceHistory: SourceServerManagementSnapshot["workspaceHistory"];
      connectionProfiles: SourceServerManagementSnapshot["profiles"];
      remoteConversationWorkspaceBySourceServerId?: AppSettings["remoteConversationWorkspaceBySourceServerId"];
    }) => {
      const projection = projectRemoteWorkspaceSessionIdentityAliases(
        remoteWorkspaceSessionsRef.current,
        settings,
      );
      if (projection.identityRekeys.length === 0) return;

      remoteWorkspaceSessionsRef.current = projection.remoteSessions;
      setRemoteWorkspaceSessions(projection.remoteSessions);
      const ensureWorkspaceTab = tabStoreApi.getState().ensureWorkspaceTab;
      for (const rekey of projection.identityRekeys) {
        const matchingTab = tabStoreApi
          .getState()
          .tabs.find(
            (tab) =>
              isWorkspaceTab(tab) &&
              tab.workspacePath === rekey.workspacePath &&
              tab.workspaceIdentity === rekey.previousWorkspaceIdentity,
          );
        if (!matchingTab) continue;
        ensureWorkspaceTab(rekey.workspacePath, {
          previousWorkspaceIdentity: rekey.previousWorkspaceIdentity,
          workspaceIdentity: rekey.workspaceIdentity,
        });
      }
    };
    const attemptReconnect = () => {
      const attemptedWorkspaceKeys = remoteWorkspaceReconnectRendererState.attemptedWorkspaceKeys;
      const groups = collectStartupRemoteWorkspaceReconnectGroups({
        manuallyOpeningWorkspaceTabId: manuallyOpeningWorkspaceTabIdRef.current,
        sessions: remoteWorkspaceSessionsRef.current,
        tabs: tabStoreApi.getState().tabs,
        attemptedWorkspaceKeys,
        onlineSourceServerIds: collectOnlineSourceServerIds(),
        currentRendererDisconnectedSourceServerIds:
          remoteWorkspaceReconnectRendererState.currentRendererDisconnectedSourceServerIds,
        pendingTerminallyDisconnectedSourceServerIds:
          remoteWorkspaceReconnectRendererState.pendingTerminallyDisconnectedSourceServerIds,
      });
      if (groups.length === 0) return;
      for (const group of groups) {
        remoteWorkspaceReconnectRendererState.currentRendererDisconnectedSourceServerIds.delete(
          group.sourceServerId,
        );
        for (const entry of group.entries) {
          attemptedWorkspaceKeys.add(buildWorkspaceSessionKey(entry));
        }
      }

      void Promise.all(
        groups.map(async (group) => {
          const groupWorkspaceKeys = new Set(
            group.entries.map((entry) => buildWorkspaceSessionKey(entry)),
          );
          await restoreSourceRemoteWorkspaceGroup({
            entries: remoteWorkspaceSessionsRef.current.filter((entry) =>
              groupWorkspaceKeys.has(buildWorkspaceSessionKey(entry)),
            ),
            reconnectEntry: runReconnectRemoteWorkspaceEntry,
            options: {
              activateWorkspaceAfterReconnect: false,
              showErrorToast: false,
              recoveryMode: "automatic",
            },
          });
        }),
      );
    };

    let refreshInFlight: Promise<void> | null = null;
    let refreshQueued = false;
    let refreshQueuedReconnect = false;
    const refreshSnapshot = (shouldAttemptReconnect: boolean) => {
      if (refreshInFlight) {
        refreshQueued = true;
        refreshQueuedReconnect ||= shouldAttemptReconnect;
        return;
      }
      refreshInFlight = sourceManagement
        .getSnapshot()
        .then(async (snapshot) => {
          if (disposed || snapshot.generation < observedManagementGeneration) return;
          observedManagementGeneration = snapshot.generation;
          let settings: Pick<AppSettings, "remoteConversationWorkspaceBySourceServerId"> = {};
          try {
            settings = await services.settingService.get();
          } catch (error) {
            logger.warn("[Root] 读取 conversation workspace alias 失败", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
          if (disposed) return;
          applyDirectoryWorkspaceIdentityProjection({
            sourceServerWorkspaceHistory: snapshot.workspaceHistory,
            connectionProfiles: snapshot.profiles,
            remoteConversationWorkspaceBySourceServerId:
              settings.remoteConversationWorkspaceBySourceServerId,
          });
          sourceStateByProfileId.clear();
          for (const state of snapshot.states) sourceStateByProfileId.set(state.profileId, state);
          updateObservedSourceAvailability();
          if (shouldAttemptReconnect) attemptReconnect();
        })
        .catch((error) => {
          if (!disposed) {
            logger.warn("[Root] Failed to read Source startup restore status", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })
        .finally(() => {
          refreshInFlight = null;
          if (!disposed && refreshQueued) {
            const queuedReconnect = refreshQueuedReconnect;
            refreshQueued = false;
            refreshQueuedReconnect = false;
            refreshSnapshot(queuedReconnect);
          }
        });
    };

    const managementSubscription = sourceManagement.onDidChangeState((delta) => {
      if (disposed || delta.generation < observedManagementGeneration) return;
      observedManagementGeneration = delta.generation;
      sourceStateByProfileId.set(delta.state.profileId, delta.state);
      updateObservedSourceAvailability();
      if (shouldAttemptStartupReconnectForSourceState(delta.state.state)) {
        attemptReconnect();
      }
      updateStartupRemoteWorkspaceReconnectAttemptsForSourceState({
        state: delta.state,
        onlineSourceServerIds: collectOnlineSourceServerIds(),
        sessions: remoteWorkspaceSessionsRef.current,
        attemptedWorkspaceKeys: remoteWorkspaceReconnectRendererState.attemptedWorkspaceKeys,
      });
    });
    const directorySubscription = sourceManagement.onDidChangeDirectory?.(() => {
      refreshSnapshot(false);
    });
    refreshSnapshot(true);
    const tabSubscription = tabStoreApi.subscribe((state, previousState) => {
      if (shouldAttemptStartupReconnectForTabChange(state.tabs, previousState.tabs)) {
        attemptReconnect();
      }
    });
    return () => {
      disposed = true;
      managementSubscription.dispose();
      directorySubscription?.dispose();
      tabSubscription();
    };
  }, [
    canUseRemoteWorkspace,
    manuallyOpeningWorkspaceTabId,
    remoteWorkspaceSessions,
    runReconnectRemoteWorkspaceEntry,
    services.settingService,
    services.sourceServerManagementService,
    syncPersistedWorkspaceSession,
    tabStoreApi,
  ]);

  const restorePersistedSession = useCallback(
    async (settings: AppSettings) => {
      const persistedRemoteSessions = getRemoteWorkspaceSessionEntries(settings);
      setRemoteWorkspaceSessions(persistedRemoteSessions);
      remoteWorkspaceSessionsRef.current = persistedRemoteSessions;
      let conversationWorkspacePath: string | undefined;
      if (ensureConversationWorkspaceOnRestore) {
        try {
          conversationWorkspacePath = (await services.fileService.ensureConversationWorkspace())
            .path;
        } catch (error) {
          logger.warn("[Root] Failed to resolve conversation workspace during restoration", {
            error,
          });
        }
      }
      const workspaceRestore = restorePersistedRemoteWorkspaceSessions({
        settings,
        tabStoreApi,
        allowRemoteWorkspaceRestore,
        unavailableWorkspacePath,
        conversationWorkspacePath,
        remoteConversationWorkspaceBySourceServerId:
          settings.remoteConversationWorkspaceBySourceServerId,
        restoreMode: deferInactiveWorkspaceRestore ? "active-first" : "all",
      });
      return {
        ...(conversationWorkspacePath
          ? { excludedRecentProjectPaths: [conversationWorkspacePath] }
          : {}),
        ...(workspaceRestore?.deferredRestore
          ? { deferredRestore: workspaceRestore.deferredRestore }
          : {}),
      };
    },
    [
      allowRemoteWorkspaceRestore,
      deferInactiveWorkspaceRestore,
      ensureConversationWorkspaceOnRestore,
      services.fileService,
      tabStoreApi,
      unavailableWorkspacePath,
    ],
  );

  const selectRemoteProjectFromDialog = useCallback(
    async (
      sessionId: string,
      path: string,
      localWorkspacePath?: string,
      workspacePurpose: "project" | "conversation" = "project",
      draftProjectId?: string | null,
      preparedWorkspaceIdentity?: string,
      isCurrent?: () => boolean | Promise<boolean>,
    ) => {
      try {
        await selectRemoteWorkspaceProjectFromDialog({
          canUseRemoteWorkspace,
          isCurrent,
          sessionId,
          path,
          preparedWorkspaceIdentity,
          draftProjectId,
          localWorkspacePath,
          workspacePurpose,
          loadingMessage: intl.formatMessage({ id: "common.loading" }),
          getRemoteWorkspaceSession,
          connectionTarget: pendingConnectionTargetsBySessionIdRef.current.get(sessionId),
          getWorkspaceTabs: () => tabStoreApi.getState().tabs,
          restoringWorkspaceTabId: manuallyOpeningWorkspaceTabIdRef.current,
          resolveRemoteWorkspaceCanonicalPath,
          activateTabByPath,
          handleCancelRemoteProject,
          bindRemoteWorkspaceScope,
          commitRemoteWorkspaceSessionMutation,
          getRemoteSessions: () => remoteWorkspaceSessionsRef.current,
          bindRemoteWorkspacePath,
          bindRemoteWorkspaceIdentity,
          addTab,
          onWorkspaceActivated:
            onWorkspaceActivated ??
            (draftProjectId === undefined
              ? undefined
              : ({ workspacePath, workspaceIdentity }) => {
                  useCfSessionStore
                    .getState()
                    .startDraft(workspacePath, undefined, workspaceIdentity, {
                      projectId: draftProjectId,
                    });
                }),
        });
      } finally {
        pendingConnectionTargetsBySessionIdRef.current.delete(sessionId);
      }
    },
    [
      activateTabByPath,
      addTab,
      tabStoreApi,
      commitRemoteWorkspaceSessionMutation,
      handleCancelRemoteProject,
      intl,
      onWorkspaceActivated,
      resolveRemoteWorkspaceCanonicalPath,
      bindRemoteWorkspaceScope,
      canUseRemoteWorkspace,
    ],
  );

  const openRemoteConversation = useCallback(
    async (sessionId: string, sourceServerId?: string) =>
      await openRemoteConversationWorkspace({
        sessionId,
        sourceServerId,
        getRemoteWorkspaceSession,
        getSettings: services.settingService.get,
        loadCredential: services.credentialService.load,
        connectRemoteWorkspaceTarget,
        waitForRemoteWorkspaceSessionReady,
        ensureConversationWorkspace: async (resolvedSourceServerId) => {
          const management = services.sourceServerManagementService;
          if (!management) {
            throw new Error("Remote conversation requires an identified Source Server");
          }
          return management.ensureConversationWorkspace(resolvedSourceServerId);
        },
        selectRemoteWorkspace: async (conversationSessionId, conversationPath, workspacePurpose) =>
          await selectRemoteProjectFromDialog(
            conversationSessionId,
            conversationPath,
            undefined,
            workspacePurpose,
          ),
        disposeRemoteWorkspaceSession: handleCancelRemoteProject,
      }),
    [
      connectRemoteWorkspaceTarget,
      handleCancelRemoteProject,
      selectRemoteProjectFromDialog,
      services.credentialService,
      services.settingService,
      services.sourceServerManagementService,
      waitForRemoteWorkspaceSessionReady,
    ],
  );
  const handleConnectRemote = useCallback(
    async (
      options: Parameters<IPlatformService["connectRemote"]>[0],
      requestId?: string,
      context?: Parameters<IPlatformService["connectRemote"]>[2],
      feedback?: RemoteConnectionFeedbackOptions,
    ) => {
      if (!canUseRemoteWorkspace) {
        throw new Error("Remote workspace is disabled in this mode");
      }

      return connectRemoteWorkspaceTarget(options, requestId, context, feedback);
    },
    [canUseRemoteWorkspace, connectRemoteWorkspaceTarget],
  );

  const runReconnectRemoteWorkspaceByKey = useCallback(
    async (workspaceKey: string, options?: ReconnectRemoteWorkspaceOptions) => {
      const reconnect = async (nextOptions?: ReconnectRemoteWorkspaceOptions) => {
        await reconnectRemoteWorkspaceByKey({
          workspaceKey,
          canUseRemoteWorkspace,
          getRemoteSessions: () => remoteWorkspaceSessionsRef.current,
          runReconnectRemoteWorkspace,
          options: { ...options, ...nextOptions },
        });
      };
      if (
        options?.throwOnFailure ||
        options?.recoveryMode === "automatic" ||
        !onOpenRemoteConnection
      ) {
        await reconnect(options);
        return;
      }
      if (inflightReconnectWorkspaceKeysRef.current.has(workspaceKey)) return;
      const tab = tabStoreApi
        .getState()
        .tabs.find(
          (candidate) =>
            isWorkspaceTab(candidate) && buildWorkspaceSessionKey(candidate) === workspaceKey,
        );
      const entry = remoteWorkspaceSessionsRef.current.find(
        (candidate) => buildWorkspaceSessionKey(candidate) === workspaceKey,
      );
      if (!tab || !isWorkspaceTab(tab) || !entry) {
        if (!services.remoteProjectService) throw new Error("remote-project.service-unavailable");
        inflightReconnectWorkspaceKeysRef.current.add(workspaceKey);
        try {
          await requestRetainedRemoteProjectConnection({
            workspaceKey,
            service: services.remoteProjectService,
            getSnapshot: services.sourceServerManagementService
              ? () => services.sourceServerManagementService!.getSnapshot()
              : undefined,
            openWizard: onOpenRemoteConnection,
          });
        } finally {
          inflightReconnectWorkspaceKeysRef.current.delete(workspaceKey);
        }
        return;
      }
      const snapshot = await services.sourceServerManagementService
        ?.getSnapshot()
        .catch(() => undefined);
      const isCurrent = () =>
        tabStoreApi.getState().tabs.some((candidate) => candidate.id === tab.id);
      if (!isCurrent()) return;
      const sourceId = getWorkspaceSourceServerId(tab, {
        workspaceHistory: snapshot?.workspaceHistory,
      });
      const device = sourceId ? getRemoteDevicePresentationInput(snapshot, sourceId) : undefined;
      const profile = snapshot?.profiles.find(
        (candidate) => candidate.profileId === device?.profileId,
      );
      const presentation = resolveRemoteConnectionPresentation({
        ...device,
        attached: false,
        projectError: entry.lastConnectionError,
      });
      await requestRemoteProjectConnection({
        preference: {
          preferredWorkspaceTabId: tab.id,
          preferredDirectoryPath: entry.workspacePath,
          preferredProfileId: profile?.profileId,
          preferredTarget: profile ? buildRemoteTargetFromProfile(profile) : tab.remoteTarget,
        },
        presentation,
        failure: {
          code: device?.errorCode,
          message: device?.error ?? entry.lastConnectionError ?? "",
          logs: reconnectingRemoteWorkspaceLogsByWorkspaceKey[workspaceKey] ?? [],
        },
        reconnect,
        openWizard: onOpenRemoteConnection,
        isCurrent,
      });
    },
    [
      canUseRemoteWorkspace,
      runReconnectRemoteWorkspace,
      onOpenRemoteConnection,
      tabStoreApi,
      services.sourceServerManagementService,
      services.remoteProjectService,
      reconnectingRemoteWorkspaceLogsByWorkspaceKey,
    ],
  );

  const handleOpenRemoteWorkspaceFromHistory = useCallback(
    async (workspaceKey: string) => {
      if (!canUseRemoteWorkspace) {
        return;
      }

      await openRemoteWorkspaceFromHistoryEntry({
        workspaceKey,
        tabStoreApi,
        getRemoteSessions: () => remoteWorkspaceSessionsRef.current,
        inflightReconnectWorkspaceKeys: inflightReconnectWorkspaceKeysRef.current,
        activateTabByPath,
        setReconnectingRemoteWorkspaceKeys,
        loadCredential: services.credentialService.load,
        connectRemoteWorkspaceTarget,
        resolveRemoteWorkspaceCanonicalPath,
        bindRemoteWorkspaceScope,
        disposeRemoteWorkspaceSession: handleCancelRemoteProject,
        addTab,
        commitRemoteWorkspaceSessionMutation,
        createReconnectRequestId: createUuid,
        pendingReconnectRequestIds: pendingReconnectRequestIdsRef.current,
        resetLogsForWorkspaceKey,
        onWorkspaceActivated,
      });
    },
    [
      activateTabByPath,
      addTab,
      commitRemoteWorkspaceSessionMutation,
      connectRemoteWorkspaceTarget,
      handleCancelRemoteProject,
      resolveRemoteWorkspaceCanonicalPath,
      resetLogsForWorkspaceKey,
      onWorkspaceActivated,
      services.credentialService,
      bindRemoteWorkspaceScope,
      tabStoreApi,
      canUseRemoteWorkspace,
    ],
  );

  const handleRemoteWorkspaceSessionClosed = useCallback(
    async (event: RemoteSessionClosedEvent) => {
      const sessionId = event.sessionId.trim();
      if (!sessionId) {
        return;
      }

      const matchedTabs = tabStoreApi
        .getState()
        .tabs.filter(
          (tab): tab is import("@/store/tabStore.js").WorkspaceTabState =>
            isWorkspaceTab(tab) && tab.remoteSessionId === sessionId,
        );
      if (matchedTabs.length === 0) {
        unregisterRemoteWorkspaceSession(sessionId);
        return;
      }

      if (event.recoverable === true) {
        unregisterRemoteWorkspaceSession(sessionId);
        for (const tab of matchedTabs) {
          setRemoteWorkspaceConnectionState(buildWorkspaceSessionKey(tab), "reconnecting");
        }
        setReconnectingRemoteWorkspaceKeys((currentKeys) =>
          updateRemoteWorkspaceRecoveringKeys(currentKeys, matchedTabs, true),
        );
        setRemoteWorkspaceRecoveryByWorkspaceKey((current) => {
          const next = { ...current };
          for (const tab of matchedTabs) {
            next[buildWorkspaceSessionKey(tab)] = {
              mode: "automatic",
              ...(event.recoveryAttempt ? { attempt: event.recoveryAttempt } : {}),
              ...(event.recoveryLimit ? { limit: event.recoveryLimit } : {}),
            };
          }
          return next;
        });
        logger.info("[Root] 远程 workspace session 进入可恢复断连状态", {
          sessionId,
        });
        return;
      }

      setReconnectingRemoteWorkspaceKeys((currentKeys) =>
        updateRemoteWorkspaceRecoveringKeys(currentKeys, matchedTabs, false),
      );
      setRemoteWorkspaceRecoveryByWorkspaceKey((current) => {
        const next = { ...current };
        for (const tab of matchedTabs) delete next[buildWorkspaceSessionKey(tab)];
        return next;
      });

      for (const tab of matchedTabs) {
        const identity = tab.workspaceIdentity
          ? parseRemoteWorkspaceIdentity(tab.workspaceIdentity)
          : null;
        if (identity?.kind === "server" && identity.sourceServerId) {
          if (
            remoteWorkspaceReconnectRendererState.observedOnlineSourceServerIds.has(
              identity.sourceServerId,
            )
          ) {
            remoteWorkspaceReconnectRendererState.pendingTerminallyDisconnectedSourceServerIds.add(
              identity.sourceServerId,
            );
          } else {
            remoteWorkspaceReconnectRendererState.currentRendererDisconnectedSourceServerIds.add(
              identity.sourceServerId,
            );
          }
        }
      }

      tabStoreApi.setState((state) => ({
        tabs: state.tabs.map((tab) =>
          isWorkspaceTab(tab) && tab.remoteSessionId === sessionId
            ? { ...tab, remoteSessionId: undefined }
            : tab,
        ),
      }));
      unregisterRemoteWorkspaceSession(sessionId);

      const matchedWorkspaceKeys = [
        ...new Set(matchedTabs.map((tab) => buildWorkspaceSessionKey(tab))),
      ];
      const reason = formatRemoteConnectionError({
        fallback: resolveRemoteWorkspaceClosedFallback({
          event,
          formatMessage: intl.formatMessage,
          defaultFallback: [
            intl.formatMessage({ id: "remote.error.connectionClosed" }),
            event.exitCode != null ? `exitCode=${event.exitCode}` : null,
            event.signal ? `signal=${event.signal}` : null,
          ]
            .filter(Boolean)
            .join(" "),
        }),
        reasonCode: event.reasonCode,
        retryable: event.retryable,
        recoveryAttempt: event.recoveryAttempt,
        recoveryLimit: event.recoveryLimit,
        formatMessage: intl.formatMessage,
      });
      for (const workspaceKey of matchedWorkspaceKeys) {
        setRemoteWorkspaceConnectionState(workspaceKey, "disconnected");
      }

      logger.warn("[Root] 远程 workspace session 已关闭", {
        sessionId,
        reason: event.reason,
        exitCode: event.exitCode,
        signal: event.signal,
        matchedWorkspaceKeys,
      });

      for (const workspaceKey of matchedWorkspaceKeys) {
        const sessionEntry = remoteWorkspaceSessionsRef.current.find(
          (entry) => buildWorkspaceSessionKey(entry) === workspaceKey,
        );
        if (!sessionEntry) {
          continue;
        }

        const pendingReconnectRequestId = pendingReconnectRequestIdsRef.current.get(workspaceKey);
        if (
          !shouldPersistRemoteWorkspaceFailure({
            pendingReconnectRequestIds: pendingReconnectRequestIdsRef.current,
            sessionEntry,
            workspaceKey,
          })
        ) {
          logger.info("[Root] Skipped failure persist when closing WSL workspace session, awaiting reconnection result", {
            pendingReconnectRequestId,
            sessionId,
            workspaceIdentity: sessionEntry.workspaceIdentity ?? null,
            workspacePath: sessionEntry.workspacePath,
            workspaceKey,
          });
          continue;
        }

        await commitRemoteWorkspaceSessionMutation(
          buildRemoteWorkspaceSessionMutation({
            remoteSessions: remoteWorkspaceSessionsRef.current,
            workspacePath: sessionEntry.workspacePath,
            workspaceIdentity: sessionEntry.workspaceIdentity,
            target: createRemoteTargetFromSnapshot(sessionEntry.target, {
              password: null,
              privateKeyPassphrase: null,
            }),
            lastConnectionStatus: "failed",
            lastConnectionError: isRemoteWorkspaceCloseFailure(event) ? reason : "",
            touchOpenedAt: false,
          }),
        );
      }
    },
    [commitRemoteWorkspaceSessionMutation, intl, tabStoreApi],
  );

  const handleRemoteWorkspaceSessionReconnected = useCallback(
    (event: RemoteSessionReconnectedEvent) => {
      const matchedTabs = tabStoreApi
        .getState()
        .tabs.filter(
          (tab): tab is import("@/store/tabStore.js").WorkspaceTabState =>
            isWorkspaceTab(tab) &&
            tab.workspacePath === event.workspacePath &&
            tab.workspaceIdentity === event.workspaceIdentity &&
            (!tab.remoteSessionId || tab.remoteSessionId === event.previousSessionId),
        );
      if (matchedTabs.length === 0) return;
      setReconnectingRemoteWorkspaceKeys((currentKeys) =>
        updateRemoteWorkspaceRecoveringKeys(currentKeys, matchedTabs, false),
      );
      for (const tab of matchedTabs) {
        clearRemoteWorkspaceConnectionState(buildWorkspaceSessionKey(tab));
      }
      setRemoteWorkspaceRecoveryByWorkspaceKey((current) => {
        const next = { ...current };
        for (const tab of matchedTabs) delete next[buildWorkspaceSessionKey(tab)];
        return next;
      });
      unregisterRemoteWorkspaceSession(event.previousSessionId);
      bindRemoteWorkspacePath(event.workspacePath, event.sessionId);
      bindRemoteWorkspaceIdentity(event.workspaceIdentity, event.sessionId);
      tabStoreApi.setState((state) => ({
        tabs: state.tabs.map((tab) =>
          isWorkspaceTab(tab) &&
          tab.workspacePath === event.workspacePath &&
          tab.workspaceIdentity === event.workspaceIdentity &&
          (!tab.remoteSessionId || tab.remoteSessionId === event.previousSessionId)
            ? { ...tab, remoteSessionId: event.sessionId }
            : tab,
        ),
      }));
    },
    [tabStoreApi],
  );

  useEffect(() => {
    return platform.onRemoteSessionClosed((event) => {
      void handleRemoteWorkspaceSessionClosed(event);
    });
  }, [handleRemoteWorkspaceSessionClosed, platform]);

  useEffect(() => {
    return (
      platform.onRemoteSessionReconnected?.((event) => {
        handleRemoteWorkspaceSessionReconnected(event);
      }) ?? (() => {})
    );
  }, [handleRemoteWorkspaceSessionReconnected, platform]);

  const handleRemoteWorkspaceTabsClosed = useCallback(
    (workspaceKeys: string[]) => {
      if (workspaceKeys.length === 0) {
        return;
      }

      const workspaceKeySet = new Set(workspaceKeys);
      for (const workspaceKey of workspaceKeys) {
        clearRemoteWorkspaceConnectionState(workspaceKey);
      }

      void (async () => {
        await cancelPendingRemoteReconnectsForWorkspaceKeys({
          workspaceKeys,
          pendingRequestIds: pendingReconnectRequestIdsRef.current,
          cancelPendingRemoteConnection: platform.cancelPendingRemoteConnection
            ? (requestId) =>
                platform.cancelPendingRemoteConnection?.(requestId) ?? Promise.resolve()
            : undefined,
          logger,
        });
        setReconnectingRemoteWorkspaceKeys((currentKeys) =>
          currentKeys.filter((key) => !workspaceKeySet.has(key)),
        );

        const removal = removeRemoteWorkspaceSessionEntries(
          remoteWorkspaceSessionsRef.current,
          workspaceKeys,
        );
        if (
          removal.nextRemoteSessions.length === remoteWorkspaceSessionsRef.current.length &&
          removal.credentialKeysToDelete.length === 0
        ) {
          return;
        }

        await syncPersistedWorkspaceSession(removal.nextRemoteSessions);
        for (const credentialKey of removal.credentialKeysToDelete) {
          if (persistenceGate && !persistenceGate.canPersist) {
            pendingCredentialDeletesRef.current.add(credentialKey);
            continue;
          }
          try {
            await services.credentialService.delete(credentialKey);
          } catch (error) {
            logger.warn("[Root] 删除已移除远程 workspace 凭据失败", {
              credentialKey,
              error,
            });
          }
        }
      })();
    },
    [persistenceGate, platform, services.credentialService, syncPersistedWorkspaceSession],
  );

  const remoteWorkspaceController = useMemo<RemoteWorkspaceController>(
    () =>
      createRemoteWorkspaceController({
        connectDevice: async (profileId, effect) => {
          if (!onOpenRemoteConnection) {
            throw new Error("Remote connection dialog is unavailable");
          }
          onOpenRemoteConnection({
            preferredProfileId: profileId,
            ...(effect === "device-management" ? { completion: effect } : {}),
          });
        },
        disconnectDevice: async (sourceServerId) => {
          const management = services.sourceServerManagementService;
          if (!management) {
            throw new Error("Source Server management is unavailable");
          }
          await management.disconnectSource(sourceServerId);
        },
        openConversation: async ({ sourceServerId, remoteSessionId }) => {
          const resolvedSessionId =
            remoteSessionId ??
            Object.values(useRemoteWorkspaceSessionStore.getState().sessionsById).find(
              (session) => session.sourceServerId === sourceServerId,
            )?.sessionId;
          if (!resolvedSessionId) {
            throw new Error("Remote conversation intent requires an attached session");
          }
          await openRemoteConversation(resolvedSessionId, sourceServerId);
        },
        openProject: async ({
          sourceServerId,
          path,
          localWorkspacePath,
          remoteSessionId,
          draftProjectId,
          preparedWorkspaceIdentity,
          isCurrent,
        }) => {
          const sessions = Object.values(
            useRemoteWorkspaceSessionStore.getState().sessionsById,
          ).filter((session) =>
            remoteSessionId
              ? session.sessionId === remoteSessionId
              : sourceServerId
                ? session.sourceServerId === sourceServerId
                : !session.sourceServerId,
          );
          if (sessions.length !== 1) {
            throw new Error(
              `Remote project requires one attached session for Source Server: ${sourceServerId}`,
            );
          }
          await selectRemoteProjectFromDialog(
            sessions[0]!.sessionId,
            path,
            localWorkspacePath,
            "project",
            draftProjectId,
            preparedWorkspaceIdentity,
            isCurrent,
          );
        },
        reconnectWorkspace: async (workspaceKey, options) => {
          await runReconnectRemoteWorkspaceByKey(workspaceKey, options);
        },
        closeWorkspace: async (workspaceKey) => {
          handleRemoteWorkspaceTabsClosed([workspaceKey]);
        },
      }),
    [
      handleRemoteWorkspaceTabsClosed,
      onOpenRemoteConnection,
      openRemoteConversation,
      runReconnectRemoteWorkspaceByKey,
      selectRemoteProjectFromDialog,
      services.sourceServerManagementService,
    ],
  );

  const handleSelectRemoteProject = useCallback(
    async (
      sessionId: string,
      path: string,
      localWorkspacePath?: string,
      preparedWorkspaceIdentity?: string,
      isCurrent?: () => boolean | Promise<boolean>,
    ) => {
      const session = getRemoteWorkspaceSession(sessionId);
      await remoteWorkspaceController.dispatch({
        type: "open-project",
        isCurrent,
        sourceServerId: session?.sourceServerId ?? "",
        path,
        localWorkspacePath,
        remoteSessionId: sessionId,
        ...(preparedWorkspaceIdentity ? { preparedWorkspaceIdentity } : {}),
      });
    },
    [remoteWorkspaceController],
  );

  const handleOpenRemoteConversation = useCallback(
    async (sessionId: string, sourceServerId?: string) => {
      await remoteWorkspaceController.dispatch({
        type: "open-conversation",
        sourceServerId:
          sourceServerId ?? getRemoteWorkspaceSession(sessionId)?.sourceServerId ?? "",
        remoteSessionId: sessionId,
      });
    },
    [remoteWorkspaceController],
  );

  const handleReconnectRemoteWorkspace = useCallback(
    async (workspaceKey: string, options?: ReconnectRemoteWorkspaceOptions) => {
      await remoteWorkspaceController.dispatch({
        type: "reconnect-workspace",
        workspaceKey,
        options,
      });
    },
    [remoteWorkspaceController],
  );

  const remoteWorkspaceErrorByWorkspaceKey = useMemo(
    () =>
      Object.fromEntries(
        remoteWorkspaceSessions.flatMap((entry) =>
          entry.lastConnectionError?.trim()
            ? [[buildWorkspaceSessionKey(entry), entry.lastConnectionError] as const]
            : [],
        ),
      ),
    [remoteWorkspaceSessions],
  );

  return {
    remoteWorkspaceSessions,
    reconnectingRemoteWorkspaceKeys,
    remoteWorkspaceRecoveryByWorkspaceKey,
    remoteWorkspaceErrorByWorkspaceKey,
    buildPersistedTabPatch,
    restorePersistedSession,
    handleCancelRemoteProject,
    handleSelectRemoteProject,
    handleOpenRemoteConversation,
    handleConnectRemote,
    handleReconnectRemoteWorkspace,
    handleOpenRemoteWorkspaceFromHistory,
    handleRemoteWorkspaceTabsClosed,
    remoteWorkspaceController,
  };
}
