import { toast } from "@/components/ui/toast.js";
import { RemoteConnectionSelection } from "@/remote-connection/RemoteConnectionSelection.js";
import type { RemoteConnectionOpenPreference } from "@/app-shell/types.js";
import { profileMatchesRemoteTarget } from "@/lib/remoteConnectionWizard.js";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import {
  createUuid,
  getSourceServerUpdateTarget,
  isSameSourceServerUpdateTarget,
  DEFAULT_REMOTE_ASSET_INSTALL_MODE,
  resolveWorkspaceKey,
  CF_VERSION,
  type ConnectionProfile,
  type SourceServerRunningTask,
  type RemoteTarget,
} from "@origin-ai/cf-shared";
import { useCancelPendingRemoteConnection } from "@/hooks/useCancelPendingRemoteConnection.js";
import { useConfirmDialogStore } from "@/store/confirmDialogStore.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useRemoteConnectionForm } from "@/hooks/useRemoteConnectionForm.js";
import { useRemoteConnectionLogs } from "@/hooks/useRemoteConnectionLogs.js";
import { useSourceServerManagementSnapshot } from "@/hooks/useSourceServerManagementSnapshot.js";
import { useSourceServerOperationLogs } from "@/hooks/useSourceServerOperationLogs.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { getErrorMessage } from "@/lib/errorMessage.js";
import { formatTaskRelativeTime } from "@/lib/taskListItemPresentation.js";
import {
  buildRemoteTarget,
  buildRemoteTargetFromProfile,
  findPreferredSourceConnectionProfile,
  findSourceServerUpgradeProfileId,
  getRemoteWizardStepCopy,
  collectRemoteFormFieldErrors,
  formatRemoteDraftPreview,
  withDefaultRemoteResourcePackages,
} from "@/lib/remoteConnectionWizard.js";
import {
  getRemoteConnectionCompletionDialogState,
  getRemoteConnectionDirectoryFailureState,
  isRemoteConnectionFlowActive,
} from "@/lib/remoteConnectionDialogState.js";
import { logger } from "@/logger.js";
import {
  classifyRemoteConnectionError,
  formatRemoteConnectionError,
} from "@/lib/remoteConnectionPresentation.js";
import { runSourceServerUpdate } from "@/lib/sourceServerUpdateAction.js";
import { startUserAction, type UserActionHandle } from "@/lib/userActionTelemetry.js";
import {
  useRemoteBoundaryAcknowledgement,
  RemoteConnectionConnectingStep,
  RemoteConnectionDirectoryStep,
  RemoteConnectionSettingsStep,
  formatDeviceCardMeta,
} from "@/RemoteConnectionDialogContent.js";
import { formatRemoteLinkRailTarget } from "@/remote-connection/RemoteLinkRail.js";
import {
  RemoteConnectionWizardHeader,
  type RemoteWizardStep,
} from "@/RemoteConnectionWizardChrome.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { loadConnectionProfileCredentials } from "@/root/reconnectRemoteWorkspaceHistoryEntry.js";

import {
  normalizeRemoteConnectionOptions,
  type RemoteConnectionFlowOptions,
} from "@/remote-connection-flow/contract.js";
export type { RemoteConnectionFlowOptions } from "@/remote-connection-flow/contract.js";

interface RemoteConnectionCompletionIntent {
  preferredDirectoryPath?: string;
  options?: {
    directToDirectory?: boolean;
    localWorkspacePath?: string;
    announceReusedConnection?: boolean;
  };
}

export function useRemoteConnectionFlow(options: RemoteConnectionFlowOptions) {
  const {
    openIntentId,
    completion,
    onDeviceConnected,
    onCancelled,
    onConnect,
    onConnectionReady,
    onSelectProject,
    onCancelSession,
    localWorkspacePath,
    controlledOpen,
    onOpenChange,
    isWindowsDesktop,
    remoteWorkspaceSessions,
    onFlowActiveChange,
    onFlowRequestIdChange,
    onFlowTargetChange,
    preferredKind,
    preferredWslDistro,
    preferredSourceServerId,
    preferredProfileId,
    preferredDirectoryPath,
    preferredTarget,
    onProjectIntentCleared,
    initialFailure,
  } = normalizeRemoteConnectionOptions(options);
  const addingDevice =
    completion === "device-management" &&
    !preferredSourceServerId &&
    !preferredProfileId &&
    !preferredTarget;
  const { intl, locale } = useCfIntl();
  const confirmDialog = useConfirmDialog();
  const acknowledgeBoundary = useRemoteBoundaryAcknowledgement();
  const cancelPendingRemoteConnection = useCancelPendingRemoteConnection();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const minimizedRef = useRef(false);
  const confirmationPending = useConfirmDialogStore((state) => Boolean(state.pendingRequest));
  const [discardPending, setDiscardPending] = useState(false);
  const [completionRunning, setCompletionRunning] = useState(false);
  const [blockedCompletion, setBlockedCompletion] = useState<(() => Promise<void>) | null>(null);
  useEffect(() => {
    if (confirmationPending || discardPending || !blockedCompletion) return;
    setBlockedCompletion(null);
    const epoch = entryEpochRef.current;
    setCompletionRunning(true);
    void blockedCompletion()
      .catch((cause) => {
        if (entryEpochRef.current !== epoch) return;
        setError(getErrorMessage(cause));
        setCurrentStep("connecting");
        applyOpenState(true);
      })
      .finally(() => {
        if (entryEpochRef.current === epoch) setCompletionRunning(false);
      });
  }, [confirmationPending, discardPending, blockedCompletion]);
  const pendingBackgroundCompletion = useRef<(() => Promise<void>) | null>(null);
  const [backgroundReady, setBackgroundReady] = useState(false);
  const [aliasCredentialsPending, setAliasCredentialsPending] = useState(false);
  const activeRequestIdRef = useRef<string | null>(null);
  const entryEpochRef = useRef(0);
  const refreshingIntentRef = useRef<number | null>(null);
  const [refreshingIntent, setRefreshingIntent] = useState(false);
  const consumedOpenIntentIdRef = useRef<number | undefined>(undefined);
  const activeTraceRef = useRef<{ requestId: string; trace: UserActionHandle } | null>(null);
  const cancelActiveTrace = useCallback(() => {
    const active = activeTraceRef.current;
    activeTraceRef.current = null;
    active?.trace.cancel();
  }, []);
  useEffect(() => cancelActiveTrace, [cancelActiveTrace]);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState<string>();
  const [rawError, setRawError] = useState<string>();
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [focusCredentials, setFocusCredentials] = useState(false);
  const [directoryPath, setDirectoryPath] = useState("");
  const consumedKindPreferenceRef = useRef<string | null>(null);
  const [step, setCurrentStep] = useState<RemoteWizardStep>("device");
  const currentStep = addingDevice && step === "device" ? "settings" : step;
  const ownsConnectedSessionRef = useRef(false);
  const [connectedSessionId, setConnectedSessionIdState] = useState<string | null>(null);
  const connectedSessionIdRef = useRef<string | null>(null);
  const setConnectedSessionId = useCallback((sessionId: string | null) => {
    connectedSessionIdRef.current = sessionId;
    setConnectedSessionIdState(sessionId);
  }, []);
  const [connectingRequestId, setConnectingRequestId] = useState<string | null>(null);
  const [pendingRemoteTarget, setPendingRemoteTarget] = useState<RemoteTarget | null>(null);
  const [pendingInstallConfirmation, setPendingInstallConfirmation] = useState<RemoteTarget | null>(
    null,
  );
  const [upgradeProfileId, setUpgradeProfileId] = useState<string | null>(null);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [pendingForceUpdate, setPendingForceUpdate] = useState<{
    tasks?: SourceServerRunningTask[];
  } | null>(null);
  const forceDecisionRef = useRef<((confirmed: boolean) => void) | null>(null);
  const settleForceUpdate = (confirmed: boolean) => {
    const resolve = forceDecisionRef.current;
    forceDecisionRef.current = null;
    setPendingForceUpdate(null);
    resolve?.(confirmed);
  };
  useEffect(
    () => () => {
      forceDecisionRef.current?.(false);
      forceDecisionRef.current = null;
    },
    [],
  );
  const [recognizedDeviceName, setRecognizedDeviceName] = useState<string | undefined>();
  const [recognizedSourceServerId, setRecognizedSourceServerId] = useState<string | undefined>();
  const [
    remoteConversationWorkspaceBySourceServerId,
    setRemoteConversationWorkspaceBySourceServerId,
  ] = useState<Record<string, { workspacePath: string; lastResolvedAt: number }>>({});
  
  const [activeProfileName, setActiveProfileName] = useState<string | undefined>();
  const consumedPreferredSourceServerIdRef = useRef<string | null>(null);
  const consumedPreferredProfileIdRef = useRef<string | null>(null);
  const consumedPreferredTargetRef = useRef<RemoteTarget | null>(null);
  const pendingCompletionIntentRef = useRef<RemoteConnectionCompletionIntent>({});
  const [selectingDirectory, setSelectingDirectory] = useState(false);
  const selectingDirectoryRef = useRef(false);
  const { connectionLogs, resetConnectionLogs } = useRemoteConnectionLogs(connectingRequestId);
  const open = controlledOpen ?? uncontrolledOpen;
  const {
    kind,
    host,
    port,
    username,
    sshAuthMethod,
    assetInstallMode,
    password,
    privateKeyPath,
    privateKeyPassphrase,
    wslDistro,
    wslUser,
    dockerContainer,
    manualDockerContainer,
    serverUrl,
    serverName,
    serverToken,
    serverWorkspacePath,
    sshConfigAliases,
    sshConfigAliasesLoading,
    sshConfigAliasesError,
    selectedSshConfigAlias,
    dockerAvailable,
    wslDistros,
    dockerContainers,
    availableKinds,
    setKind,
    setHost,
    setPort,
    setUsername,
    setSshAuthMethod,
    setAssetInstallMode,
    setPassword,
    setPrivateKeyPath,
    setPrivateKeyPassphrase,
    setWslDistro,
    setWslUser,
    setDockerContainer,
    setManualDockerContainer,
    setServerUrl,
    setServerName,
    setServerToken,
    setServerWorkspacePath,
    refreshDockerContainers,
    applySshConfigAlias,
    clearSelectedSshConfigAlias,
    currentRuntimeOptionsLoading,
    currentRuntimeOptionsError,
    resetDraft,
    discoveryLoading,
    discoveryError,
  } = useRemoteConnectionForm({
    open,
    isWindowsDesktop,
    preferredKind,
    preferredWslDistro,
    preserveDraftOnOpen: true,
    discoverAll: !addingDevice,
  });
  const directoryBrowserServices = useRemoteWorkspaceSessionStore((state) =>
    connectedSessionId ? (state.sessionsById[connectedSessionId]?.services ?? null) : null,
  );
  const baseServices = useBaseWorkspaceServices();
  const sourceManagement = baseServices.sourceServerManagementService;
  const { snapshot: sourceManagementSnapshot, applySnapshot: applySourceManagementSnapshot } =
    useSourceServerManagementSnapshot(sourceManagement, { enabled: open || minimizedRef.current });
  const { logsByProfileId: sourceOperationLogs } = useSourceServerOperationLogs(
    sourceManagement,
    upgradeProfileId ? [upgradeProfileId] : [],
  );
  useEffect(() => {
    if (
      !open &&
      currentStep === "device" &&
      !pendingRemoteTarget &&
      !connectedSessionId &&
      !loading
    ) {
      consumedKindPreferenceRef.current = null;
      consumedPreferredSourceServerIdRef.current = null;
      consumedPreferredProfileIdRef.current = null;
    }
  }, [open, currentStep, pendingRemoteTarget, connectedSessionId, loading]);
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    void baseServices.settingService
      .get()
      .then((settings) => {
        if (!disposed) {
          setRemoteConversationWorkspaceBySourceServerId(
            settings.remoteConversationWorkspaceBySourceServerId ?? {},
          );
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [baseServices.settingService, open]);
  const flowSnapshot = useMemo(
    () => ({
      currentStep,
      loading,
      connectedSessionId,
    }),
    [connectedSessionId, currentStep, loading],
  );
  const flowActive =
    isRemoteConnectionFlowActive(flowSnapshot) ||
    upgradeLoading ||
    Boolean(blockedCompletion) ||
    completionRunning;
  const recognizedServer = useMemo(
    () =>
      recognizedSourceServerId
        ? (sourceManagementSnapshot?.servers.find(
            (server) => server.sourceServerId === recognizedSourceServerId,
          ) ?? null)
        : null,
    [recognizedSourceServerId, sourceManagementSnapshot],
  );
  const visibleConnectionLogs = useMemo(() => {
    const updateLogs = upgradeProfileId ? (sourceOperationLogs[upgradeProfileId] ?? []) : [];
    return [
      ...(connectingRequestId
        ? connectionLogs
        : rawError === initialFailure?.message
          ? (initialFailure?.logs ?? [])
          : []),
      ...updateLogs.map((entry, index) => ({
        id: `source-update-${entry.timestamp}-${entry.phase}-${index}`,
        level: entry.level,
        message: `[source-server:${entry.phase}] ${entry.message}${
          entry.progress === undefined || entry.message.startsWith("upload progress:")
            ? ""
            : ` ${(entry.progress * 100).toFixed(1)}%`
        }`,
        timestamp: new Date(entry.timestamp).toLocaleTimeString(locale, {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      })),
    ];
  }, [
    connectionLogs,
    connectingRequestId,
    initialFailure,
    rawError,
    locale,
    sourceOperationLogs,
    upgradeProfileId,
  ]);
  const quickOpenDirectoryData = useMemo(() => {
    if (!recognizedSourceServerId || !sourceManagementSnapshot) {
      return {
        paths: [] as Array<{ path: string; label?: string }>,
        entries: [] as Array<{ path: string; label?: string }>,
      };
    }
    const localEntries = sourceManagementSnapshot.workspaceHistory
      .filter(
        (entry) =>
          entry.sourceServerId === recognizedSourceServerId &&
          remoteConversationWorkspaceBySourceServerId[recognizedSourceServerId]?.workspacePath !==
            entry.workspacePath,
      )
      .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
    const localKeys = new Set(localEntries.map((entry) => resolveWorkspaceKey(entry)));
    const server = sourceManagementSnapshot.servers.find(
      (candidate) => candidate.sourceServerId === recognizedSourceServerId,
    );
    return {
      paths: localEntries.slice(0, 3).map((entry) => ({
        path: entry.workspacePath,
        label: formatTaskRelativeTime(entry.lastOpenedAt, intl),
      })),
      entries: (server?.declaredWorkspaces ?? [])
        .filter((entry) => !localKeys.has(resolveWorkspaceKey(entry)))
        .map((entry) => ({
          path: entry.workspacePath,
          label: intl.formatMessage({ id: "remote.remoteRecord" }),
        })),
    };
  }, [
    intl,
    recognizedSourceServerId,
    remoteConversationWorkspaceBySourceServerId,
    sourceManagementSnapshot,
  ]);

  const backgroundActive = minimizedRef.current;
  useEffect(() => {
    onFlowActiveChange?.(flowActive || backgroundActive);
  }, [flowActive, backgroundActive, onFlowActiveChange]);

  const updateConnectingRequestId = useCallback(
    (requestId: string | null) => {
      activeRequestIdRef.current = requestId;
      setConnectingRequestId(requestId);
      onFlowRequestIdChange?.(requestId);
    },
    [onFlowRequestIdChange],
  );

  const updatePendingRemoteTarget = useCallback(
    (target: RemoteTarget | null) => {
      setPendingRemoteTarget(target);
      if (target?.kind === "wsl") {
        setWslDistro(target.distro ?? "");
        setWslUser(target.user ?? "");
      }
      onFlowTargetChange?.(target);
    },
    [onFlowTargetChange, setWslDistro, setWslUser],
  );
  useEffect(() => () => onFlowTargetChange?.(null), [onFlowTargetChange]);

  const applyOpenState = (nextOpen: boolean) => {
    onOpenChange?.(nextOpen);
    if (controlledOpen === undefined) {
      setUncontrolledOpen(nextOpen);
    }
  };

  const resetFeedback = () => {
    setCancelled(false);
    setError("");
    setErrorCode(undefined);
    setRawError(undefined);
    setValidationAttempt(0);
  };

  const resetDirectorySelectionState = useCallback(() => {
    selectingDirectoryRef.current = false;
    setSelectingDirectory(false);
  }, []);

  const handleCancelSession = useCallback(
    async (sessionId: string) => {
      try {
        await onCancelSession(sessionId);
      } catch (sessionError) {
        logger.warn("[SSHDialog] 释放未确认的远程 session 失败:", {
          sessionId,
          error: sessionError,
        });
      }
    },
    [onCancelSession],
  );

  const closeDialog = useCallback(
    (options?: { preserveSession?: boolean; keepOpen?: boolean }) => {
      settleForceUpdate(false);
      cancelActiveTrace();
      entryEpochRef.current += 1;
      setBlockedCompletion(null);
      setCompletionRunning(false);
      minimizedRef.current = false;
      pendingBackgroundCompletion.current = null;
      setBackgroundReady(false);
      refreshingIntentRef.current = null;
      setRefreshingIntent(false);
      resetDraft();
      setDirectoryPath("");
      consumedKindPreferenceRef.current = null;
      consumedPreferredSourceServerIdRef.current = null;
      consumedPreferredProfileIdRef.current = null;
      consumedPreferredTargetRef.current = null;
      setAliasCredentialsPending(false);
      setFocusCredentials(false);
      const sessionId = connectedSessionIdRef.current;
      if (!options?.preserveSession && sessionId && ownsConnectedSessionRef.current) {
        void handleCancelSession(sessionId);
      } else if (!options?.preserveSession && loading && currentStep === "connecting") {
        void cancelPendingRemoteConnection(connectingRequestId ?? undefined);
      }
      resetFeedback();
      setLoading(false);
      resetDirectorySelectionState();
      resetConnectionLogs();
      setCurrentStep(addingDevice ? "settings" : "device");
      setConnectedSessionId(null);
      ownsConnectedSessionRef.current = false;
      updatePendingRemoteTarget(null);
      setPendingInstallConfirmation(null);
      setUpgradeProfileId(null);
      setUpgradeLoading(false);
      setRecognizedDeviceName(undefined);
      setRecognizedSourceServerId(undefined);
      setActiveProfileName(undefined);
      pendingCompletionIntentRef.current = {};
      updateConnectingRequestId(null);
      if (!options?.keepOpen) applyOpenState(false);
    },
    [
      addingDevice,
      cancelActiveTrace,
      cancelPendingRemoteConnection,
      connectedSessionId,
      connectingRequestId,
      currentStep,
      handleCancelSession,
      loading,
      resetDirectorySelectionState,
      updateConnectingRequestId,
      updatePendingRemoteTarget,
    ],
  );

  const confirmRemoteFlowDiscard = useCallback(async () => {
    if (currentStep === "connecting" && loading) {
      return confirmDialog({
        title: intl.formatMessage({ id: "remote.connectingConfirmTitle" }),
        description: intl.formatMessage({
          id: "remote.connectingConfirmDescription",
        }),
        confirmLabel: intl.formatMessage({ id: "remote.stopConnecting" }),
        cancelLabel: intl.formatMessage({ id: "common.cancel" }),
      });
    }
    if (!connectedSessionId) {
      return true;
    }
    return confirmDialog({
      title: intl.formatMessage({ id: "remote.connectedConfirmTitle" }),
      description: intl.formatMessage({
        id: "remote.connectedConfirmDescription",
      }),
      confirmLabel: intl.formatMessage({ id: "remote.leaveConnectedSession" }),
      cancelLabel: intl.formatMessage({ id: "common.cancel" }),
    });
  }, [confirmDialog, connectedSessionId, currentStep, intl, loading]);

  const withConfirmedDiscard = async (discard: () => void | Promise<void>) => {
    const epoch = entryEpochRef.current;
    setDiscardPending(true);
    try {
      const confirmed = await confirmRemoteFlowDiscard();
      if (confirmed && entryEpochRef.current === epoch) await discard();
    } finally {
      setDiscardPending(false);
    }
  };
  const handleCloseRequest = () =>
    withConfirmedDiscard(() => {
      const background = minimizedRef.current;
      closeDialog();
      onCancelled?.(background);
    });

  const updateRequiredServer = useCallback(
    async (
      profileId: string,
      target: Exclude<RemoteTarget, { kind: "server" }>,
    ): Promise<boolean> => {
      if (!sourceManagement || upgradeLoading) return false;
      const epoch = entryEpochRef.current;
      const isCurrent = () => entryEpochRef.current === epoch;
      setUpgradeLoading(true);
      try {
        const next = await runSourceServerUpdate({
          management: sourceManagement,
          profileId,
          expectedTarget: getSourceServerUpdateTarget(target),
          confirmForce: async () => {
            if (!isCurrent()) return false;
            const snapshot = await sourceManagement.getSnapshot().catch(() => undefined);
            if (!isCurrent()) return false;
            if (snapshot) applySourceManagementSnapshot(snapshot);
            const tasks = snapshot?.states.find(
              (state) => state.profileId === profileId,
            )?.runningTasks;
            setPendingForceUpdate({ tasks });
            return await new Promise<boolean>((resolve) => {
              forceDecisionRef.current = resolve;
            });
          },
        });
        if (!isCurrent() || !next) return false;
        applySourceManagementSnapshot(next);
        setError("");
        setErrorCode(undefined);
        setRawError(undefined);
        return true;
      } catch (updateError) {
        if (!isCurrent()) return false;
        const failure = updateError as {
          code?: unknown;
          retryable?: unknown;
        };
        if (failure.code === "remote-target-changed") {
          setUpgradeProfileId(null);
          setErrorCode(undefined);
          setRawError(undefined);
          setError(intl.formatMessage({ id: "project.connectionUnavailable" }));
          return false;
        }
        setErrorCode(typeof failure.code === "string" ? failure.code : undefined);
        setRawError(getErrorMessage(updateError));
        setError(
          formatRemoteConnectionError({
            fallback: getErrorMessage(updateError),
            reasonCode: typeof failure.code === "string" ? failure.code : undefined,
            retryable: typeof failure.retryable === "boolean" ? failure.retryable : undefined,
            formatMessage: intl.formatMessage,
          }),
        );
        return false;
      } finally {
        if (isCurrent()) setUpgradeLoading(false);
      }
    },
    [applySourceManagementSnapshot, confirmDialog, intl, sourceManagement, upgradeLoading],
  );

  const startRemoteConnection = async (
    target: RemoteTarget,
    confirmSourceServerInstall = false,
    preferredDirectoryPath?: string,
    options?: RemoteConnectionCompletionIntent["options"],
    automaticServerUpdateAttempted = false,
  ) => {
    const nextTarget = withDefaultRemoteResourcePackages(target);

    if (activeRequestIdRef.current) {
      return;
    }

    const operationEpoch = ++entryEpochRef.current;
    setDirectoryPath("");
    pendingCompletionIntentRef.current = {
      preferredDirectoryPath,
      options,
    };

    updatePendingRemoteTarget(nextTarget);
    setLoading(true);
    const sessionsAtStart = new Set(
      Object.keys(useRemoteWorkspaceSessionStore.getState().sessionsById),
    );
    const requestId = createUuid();
    updateConnectingRequestId(requestId);
    resetFeedback();
    resetConnectionLogs();
    setUpgradeProfileId(null);
    setCurrentStep("connecting");
    const trace = startUserAction({
      featureId: "workspace.remote.lifecycle",
      action: "connect",
      trigger: "button",
      workspaceKind: "remote",
      remoteKind: nextTarget.kind,
    });
    activeTraceRef.current = { requestId, trace };
    const finishTrace = (finish: (action: UserActionHandle) => void) => {
      if (activeTraceRef.current?.requestId !== requestId) return;
      activeTraceRef.current = null;
      finish(trace);
    };
    try {
      let sessionId: string;
      try {
        const context = confirmSourceServerInstall
          ? { confirmSourceServerInstall: true }
          : undefined;
        sessionId = options?.announceReusedConnection
          ? await onConnect(nextTarget, requestId, context, { announceReusedConnection: true })
          : await onConnect(nextTarget, requestId, context);
      } catch (error) {
        if (activeRequestIdRef.current !== requestId) return;
        const reasonCode =
          error && typeof error === "object" && "code" in error ? String(error.code) : "";
        if (reasonCode !== "source-server-install-required") throw error;
        if (!confirmSourceServerInstall) {
          const snapshot = await sourceManagement?.getSnapshot().catch(() => undefined);
          if (activeRequestIdRef.current !== requestId) return;
          if (snapshot) applySourceManagementSnapshot(snapshot);
          const failure = error as {
            resolvedWslTarget?: Required<Extract<RemoteTarget, { kind: "wsl" }>>;
          };
          const installTarget =
            nextTarget.kind === "wsl" ? (failure.resolvedWslTarget ?? nextTarget) : nextTarget;
          updatePendingRemoteTarget(installTarget);
          setPendingInstallConfirmation(installTarget);
          finishTrace((action) => action.cancel());
          return;
        }
        throw error;
      }
      const discardStaleResult = () => {
        if (activeRequestIdRef.current === requestId) return false;
        if (!sessionsAtStart.has(sessionId)) void handleCancelSession(sessionId);
        return true;
      };
      if (discardStaleResult()) return;
      const connectedSourceServerId =
        useRemoteWorkspaceSessionStore.getState().sessionsById[sessionId]?.sourceServerId;
      if (connectedSourceServerId) {
        setRecognizedSourceServerId(connectedSourceServerId);
        try {
          const nextSnapshot = await sourceManagement?.getSnapshot();
          if (discardStaleResult()) return;
          if (nextSnapshot) {
            applySourceManagementSnapshot(nextSnapshot);
            setRecognizedDeviceName(
              nextSnapshot.servers.find(
                (server) => server.sourceServerId === connectedSourceServerId,
              )?.displayName,
            );
          }
        } catch {
        }
      }
      if (discardStaleResult()) return;
      ownsConnectedSessionRef.current =
        completion !== "device-management" && !sessionsAtStart.has(sessionId);
      if (completion === "device-management" && !sessionsAtStart.has(sessionId)) {
        await handleCancelSession(sessionId);
        if (discardStaleResult()) return;
      }
      setConnectedSessionId(completion === "device-management" ? null : sessionId);
      const finishConnection = async () => {
        const isCurrent = () => entryEpochRef.current === operationEpoch;
        if (!isCurrent()) return;
        if (minimizedRef.current) {
          deferCompletion();
          return;
        }
        const acknowledged =
          !connectedSourceServerId ||
          (await acknowledgeBoundary(
            () => isCurrent() && !minimizedRef.current,
            () => setBlockedCompletion(() => finishConnection),
          ));
        if (!isCurrent()) return;
        if (minimizedRef.current) {
          deferCompletion();
          return;
        }
        if (!acknowledged) return;
        if (completion === "device-management") {
          await onDeviceConnected?.(
            connectedSourceServerId,
            () => isCurrent() && !minimizedRef.current,
          );
          if (!isCurrent()) return;
          if (minimizedRef.current) {
            deferCompletion();
            return;
          }
          finishTrace((action) => action.complete({ resultSource: "platform_result" }));
          closeDialog({ preserveSession: true });
          return;
        }
        if (onConnectionReady) {
          await onConnectionReady(sessionId);
          if (entryEpochRef.current !== operationEpoch) return;
          finishTrace((action) => action.complete({ resultSource: "platform_result" }));
          return;
        }
        if (preferredDirectoryPath?.trim()) {
          setConnectedSessionId(null);
          try {
            await onSelectProject(
              sessionId,
              preferredDirectoryPath,
              options?.localWorkspacePath ?? localWorkspacePath,
            );
            if (entryEpochRef.current !== operationEpoch) return;
            pendingCompletionIntentRef.current = {};
            minimizedRef.current = false;
            setDirectoryPath("");
            resetConnectionLogs();
            setCurrentStep("device");
            setConnectedSessionId(null);
            updatePendingRemoteTarget(null);
            setRecognizedDeviceName(undefined);
            updateConnectingRequestId(null);
            applyOpenState(false);
            finishTrace((action) => action.complete({ resultSource: "platform_result" }));
            return;
          } catch (selectionError) {
            if (entryEpochRef.current !== operationEpoch) {
              if (!sessionsAtStart.has(sessionId)) void handleCancelSession(sessionId);
              return;
            }
            if (
              selectionError &&
              typeof selectionError === "object" &&
              "code" in selectionError &&
              selectionError.code === "remote-connection-canceled"
            ) {
              if (!sessionsAtStart.has(sessionId)) await handleCancelSession(sessionId);
              if (entryEpochRef.current !== operationEpoch) return;
              pendingCompletionIntentRef.current = {};
              onProjectIntentCleared?.();
              resetFeedback();
              setCancelled(true);
              finishTrace((action) => action.cancel());
              return;
            }
            setError(getErrorMessage(selectionError));
          }
        }
        const completionState = getRemoteConnectionCompletionDialogState("success", {
          directToDirectory: true,
        });
        setConnectedSessionId(sessionId);
        setCurrentStep(completionState.step);
        minimizedRef.current = false;
        applyOpenState(completionState.open);
        finishTrace((action) => action.complete({ resultSource: "platform_result" }));
      };
      const deferCompletion = () => {
        setConnectedSessionId(completion === "device-management" ? null : sessionId);
        const continueConnection = async () => {
          if (connectedSourceServerId && sourceManagement) {
            const latest = await sourceManagement.getSnapshot();
            if (entryEpochRef.current !== operationEpoch) return;
            applySourceManagementSnapshot(latest);
            if (
              !latest.servers.some((server) => server.sourceServerId === connectedSourceServerId) ||
              !latest.states.some(
                (state) =>
                  state.sourceServerId === connectedSourceServerId && state.state === "online",
              )
            ) {
              if (completion !== "device-management" && !sessionsAtStart.has(sessionId))
                await handleCancelSession(sessionId);
              if (entryEpochRef.current !== operationEpoch) return;
              setConnectedSessionId(null);
              minimizedRef.current = true;
              setError(intl.formatMessage({ id: "project.connectionUnavailable" }));
              return;
            }
          }
          await finishConnection();
        };
        pendingBackgroundCompletion.current = continueConnection;
        setBackgroundReady(true);
        toast(intl.formatMessage({ id: "remote.background.ready" }), {
          variant: "info",
          dismissible: true,
          dismissLabel: intl.formatMessage({ id: "common.close" }),
          dedupeKey: `remote-connection:${openIntentId ?? 0}:${operationEpoch}`,
          actionLabel: intl.formatMessage({ id: "remote.background.continue" }),
          onAction: () => {
            if (
              entryEpochRef.current !== operationEpoch ||
              pendingBackgroundCompletion.current !== continueConnection
            )
              return;
            resumeBackground();
          },
        });
        finishTrace((action) => action.complete({ resultSource: "platform_result" }));
      };
      await finishConnection();
    } catch (connectError) {
      if (activeRequestIdRef.current !== requestId) return;
      if (
        connectError &&
        typeof connectError === "object" &&
        "code" in connectError &&
        connectError.code === "remote-connection-canceled"
      ) {
        resetFeedback();
        setCancelled(true);
        finishTrace((action) => action.cancel());
        return;
      }
      const completionState = getRemoteConnectionCompletionDialogState("error");
      const failure = connectError as {
        code?: unknown;
        retryable?: unknown;
        profileId?: unknown;
        resolvedWslTarget?: Required<Extract<RemoteTarget, { kind: "wsl" }>>;
      };
      const reasonCode = typeof failure.code === "string" ? failure.code : undefined;
      const errorMessage = formatRemoteConnectionError({
        fallback: getErrorMessage(connectError),
        reasonCode,
        retryable: typeof failure.retryable === "boolean" ? failure.retryable : undefined,
        formatMessage: intl.formatMessage,
      });
      setErrorCode(reasonCode);
      setRawError(getErrorMessage(connectError));
      setError(errorMessage);
      setCurrentStep(completionState.step);
      if (!minimizedRef.current) applyOpenState(completionState.open);
      finishTrace((action) => action.fail({ failureStage: "remote_connect" }));
      if (reasonCode === "source-server-upgrade-required" && nextTarget.kind !== "server") {
        const failedTarget =
          nextTarget.kind === "wsl" ? (failure.resolvedWslTarget ?? nextTarget) : nextTarget;
        updatePendingRemoteTarget(failedTarget);
        await resumeRequiredServerUpdate(
          failedTarget,
          { preferredDirectoryPath, options },
          operationEpoch,
          automaticServerUpdateAttempted,
          typeof failure.profileId === "string" ? failure.profileId : undefined,
        );
      }
    } finally {
      finishTrace((action) => action.cancel());
      if (entryEpochRef.current === operationEpoch) {
        activeRequestIdRef.current = null;
        setLoading(false);
      }
    }
  };

  const resumeRequiredServerUpdate = async (
    target: Exclude<RemoteTarget, { kind: "server" }>,
    intent: RemoteConnectionCompletionIntent,
    epoch: number,
    automaticServerUpdateAttempted = false,
    failedProfileId?: string,
  ): Promise<void> => {
    if (!sourceManagement) return;
    const isCurrent = () => entryEpochRef.current === epoch;
    try {
      const snapshot = await sourceManagement.getSnapshot();
      if (!isCurrent()) return;
      applySourceManagementSnapshot(snapshot);
      if (target.kind === "wsl" && (!target.distro?.trim() || !target.user?.trim())) {
        throw new Error(intl.formatMessage({ id: "project.connectionUnavailable" }));
      }
      const failedProfile = failedProfileId
        ? snapshot.profiles.find(
            (profile) =>
              profile.profileId === failedProfileId && profile.lifecycleState !== "retired",
          )
        : undefined;
      if (
        failedProfileId &&
        (!failedProfile || !isSameSourceServerUpdateTarget(failedProfile.target, target))
      ) {
        throw new Error(intl.formatMessage({ id: "project.connectionUnavailable" }));
      }
      const profileId = findSourceServerUpgradeProfileId(snapshot, target, failedProfileId);
      setUpgradeProfileId(profileId);
      if (!profileId) {
        const controllerUpdate = snapshot.states.some(
          (state) =>
            state.state === "needs-upgrade" &&
            state.upgradeTarget === "controller" &&
            snapshot.profiles.some(
              (profile) =>
                profile.profileId === state.profileId &&
                (!failedProfileId || profile.profileId === failedProfileId) &&
                profileMatchesRemoteTarget(profile, target),
            ),
        );
        if (controllerUpdate) return;
        throw new Error(intl.formatMessage({ id: "project.connectionUnavailable" }));
      }
      if (automaticServerUpdateAttempted) return;
      if (!(await updateRequiredServer(profileId, target)) || !isCurrent()) return;
      updateConnectingRequestId(null);
      await startRemoteConnection(
        target,
        false,
        intent.preferredDirectoryPath,
        intent.options,
        true,
      );
    } catch (cause) {
      if (!isCurrent()) return;
      setUpgradeProfileId(null);
      setErrorCode(undefined);
      setRawError(getErrorMessage(cause));
      setError(getErrorMessage(cause));
      logger.warn("[SSHDialog] 读取或核验升级目标失败", cause);
    }
  };

  const formSnapshot = {
    kind,
    host,
    port,
    username,
    sshAuthMethod,
    assetInstallMode,
    password,
    privateKeyPath,
    privateKeyPassphrase,
    selectedSshConfigAlias,
    wslDistro,
    wslUser,
    dockerContainer,
    manualDockerContainer,
    serverUrl,
    serverName,
    serverToken,
    serverWorkspacePath,
  };

  const handleConnect = async () => {
    if (loading) {
      return;
    }

    const { target: nextTarget } = buildRemoteTarget(intl, formSnapshot);
    if (!nextTarget) {
      setValidationAttempt((attempt) => attempt + 1);
      return;
    }

    resetFeedback();
    setAliasCredentialsPending(false);
    updatePendingRemoteTarget(nextTarget);
    setActiveProfileName(selectedSshConfigAlias?.trim() || undefined);
    await startRemoteConnection(
      nextTarget,
      false,
      pendingCompletionIntentRef.current.preferredDirectoryPath,
      {
        ...pendingCompletionIntentRef.current.options,
        directToDirectory: true,
      },
    );
  };

  const handleConfirmInstall = useCallback(() => {
    logger.lifecycle.info("[remote-connection] 用户确认安装", {
      hasTarget: Boolean(pendingInstallConfirmation),
      activeRequestId: activeRequestIdRef.current,
      loading,
    });
    if (!pendingInstallConfirmation) return;
    const target = pendingInstallConfirmation;
    const intent = pendingCompletionIntentRef.current;
    setPendingInstallConfirmation(null);
    void startRemoteConnection(target, true, intent.preferredDirectoryPath, intent.options);
  }, [pendingInstallConfirmation, startRemoteConnection, loading]);

  const handleCancelInstall = useCallback(() => {
    if (completion === "device-management" && onCancelled) {
      const background = minimizedRef.current;
      closeDialog();
      onCancelled(background);
      return;
    }
    entryEpochRef.current += 1;
    setPendingInstallConfirmation(null);
    resetFeedback();
    setCancelled(true);
  }, [closeDialog, completion, onCancelled]);

  const handleCancelConnection = useCallback(() => {
    if (completion === "device-management" && onCancelled) {
      const background = minimizedRef.current;
      closeDialog();
      onCancelled(background);
      return;
    }
    settleForceUpdate(false);
    cancelActiveTrace();
    const requestId = activeRequestIdRef.current;
    entryEpochRef.current += 1;
    setBlockedCompletion(null);
    setCompletionRunning(false);
    const sessionId = connectedSessionIdRef.current;
    if (sessionId && ownsConnectedSessionRef.current) void handleCancelSession(sessionId);
    setConnectedSessionId(null);
    updateConnectingRequestId(null);
    setLoading(false);
    setUpgradeLoading(false);
    setPendingInstallConfirmation(null);
    setAliasCredentialsPending(false);
    resetFeedback();
    setCancelled(true);
    if (requestId) void cancelPendingRemoteConnection(requestId);
  }, [
    cancelActiveTrace,
    cancelPendingRemoteConnection,
    closeDialog,
    completion,
    onCancelled,
    updateConnectingRequestId,
  ]);

  const handleStartPendingRemoteConnection = useCallback(
    (automaticServerUpdateAttempted = false) => {
      if (!pendingRemoteTarget) {
        void handleConnect();
        return;
      }

      if (
        pendingRemoteTarget.kind === "ssh" &&
        !pendingRemoteTarget.password &&
        !pendingRemoteTarget.privateKeyPath
      ) {
        resetFeedback();
        setAliasCredentialsPending(true);
        return;
      }
      const intent = pendingCompletionIntentRef.current;
      void startRemoteConnection(
        pendingRemoteTarget,
        false,
        intent.preferredDirectoryPath,
        intent.options,
        automaticServerUpdateAttempted,
      );
    },
    [handleConnect, pendingRemoteTarget, startRemoteConnection],
  );

  const handleUpgradeRequiredServer = useCallback(async () => {
    if (!upgradeProfileId || !pendingRemoteTarget || pendingRemoteTarget.kind === "server") return;
    if (await updateRequiredServer(upgradeProfileId, pendingRemoteTarget)) {
      handleStartPendingRemoteConnection(true);
    }
  }, [
    handleStartPendingRemoteConnection,
    pendingRemoteTarget,
    upgradeProfileId,
    updateRequiredServer,
  ]);

  const handleBackToConnection = useCallback(async () => {
    if (!connectedSessionId) {
      return;
    }

    resetFeedback();
    try {
      await onCancelSession(connectedSessionId);
      setConnectedSessionId(null);
      updateConnectingRequestId(null);
      resetConnectionLogs();
      setCurrentStep("settings");
    } catch (sessionError) {
      setError(getErrorMessage(sessionError));
    }
  }, [connectedSessionId, onCancelSession, updateConnectingRequestId]);

  const handleSelectDirectory = useCallback(
    async (path: string) => {
      if (!connectedSessionId || selectingDirectoryRef.current) {
        return;
      }

      const epoch = entryEpochRef.current;
      selectingDirectoryRef.current = true;
      setSelectingDirectory(true);
      resetFeedback();
      try {
        await onSelectProject(connectedSessionId, path, localWorkspacePath);
        if (entryEpochRef.current !== epoch) return;
        pendingCompletionIntentRef.current = {};
        minimizedRef.current = false;
        setDirectoryPath("");
        resetConnectionLogs();
        setCurrentStep("device");
        setConnectedSessionId(null);
        updatePendingRemoteTarget(null);
        updateConnectingRequestId(null);
        applyOpenState(false);
      } catch (selectionError) {
        if (entryEpochRef.current !== epoch) return;
        const failureState = getRemoteConnectionDirectoryFailureState({
          connectedSessionId,
          sessionStillRegistered: Boolean(
            useRemoteWorkspaceSessionStore.getState().sessionsById[connectedSessionId],
          ),
        });
        if (!failureState.connectedSessionId) {
          setConnectedSessionId(null);
          setCurrentStep(failureState.step);
          updateConnectingRequestId(null);
        }
        setError(getErrorMessage(selectionError));
      } finally {
        if (entryEpochRef.current === epoch) resetDirectorySelectionState();
      }
    },
    [
      connectedSessionId,
      localWorkspacePath,
      onSelectProject,
      resetDirectorySelectionState,
      updateConnectingRequestId,
      updatePendingRemoteTarget,
    ],
  );

  const acceptInitialFailure = (
    target: RemoteTarget,
    initialFailure?: RemoteConnectionOpenPreference["initialFailure"],
  ) => {
    if (!initialFailure) return false;
    if (initialFailure.code === "source-server-upgrade-required" && initialFailure.failedTarget) {
      target = { ...target, ...initialFailure.failedTarget };
    }
    if (
      (initialFailure.code === "source-server-install-required" ||
        initialFailure.code === "source-server-upgrade-required") &&
      target.kind === "wsl"
    ) {
      target = initialFailure.resolvedWslTarget ?? target;
    }
    updatePendingRemoteTarget(target);
    setKind(target.kind);
    if (target.kind === "ssh") {
      setHost(target.host);
      setPort(String(target.port ?? 22));
      setUsername(target.username);
      setPassword(target.password ?? "");
      setPrivateKeyPath(target.privateKeyPath ?? "");
      setPrivateKeyPassphrase(target.privateKeyPassphrase ?? "");
      setSshAuthMethod(target.privateKeyPath ? "privateKey" : "password");
      setAssetInstallMode(target.assetInstallMode ?? DEFAULT_REMOTE_ASSET_INSTALL_MODE);
    } else if (target.kind === "wsl") {
      setWslDistro(target.distro ?? "");
      setWslUser(target.user ?? "");
    } else if (target.kind === "docker") {
      setDockerContainer(target.container);
      setManualDockerContainer(target.container);
    } else {
      setServerUrl(target.url);
      setServerName(target.name ?? "");
      setServerToken(target.token ?? "");
    }
    setCurrentStep("connecting");
    setErrorCode(initialFailure.code);
    setRawError(initialFailure.message);
    setError(
      formatRemoteConnectionError({
        fallback: initialFailure.message,
        reasonCode: initialFailure.code,
        formatMessage: intl.formatMessage,
      }),
    );
    if (initialFailure.code === "source-server-install-required")
      setPendingInstallConfirmation(target);
    if (initialFailure.code === "source-server-upgrade-required" && target.kind !== "server") {
      void resumeRequiredServerUpdate(
        target,
        pendingCompletionIntentRef.current,
        entryEpochRef.current,
        false,
        initialFailure.profileId,
      );
    }
    return true;
  };

  const handleSelectProfile = (
    profile: ConnectionProfile,
    preferredDirectoryPath?: string,
    selectOptions?: {
      initialFailure?: RemoteConnectionOpenPreference["initialFailure"];
      directToDirectory?: boolean;
      localWorkspacePath?: string;
    },
  ) => {
    const entryEpoch = ++entryEpochRef.current;
    resetFeedback();
    setPendingInstallConfirmation(null);
    setUpgradeProfileId(null);
    pendingCompletionIntentRef.current = { preferredDirectoryPath, options: selectOptions };
    setDirectoryPath("");
    setActiveProfileName(profile.displayName);
    setRecognizedSourceServerId(profile.sourceServerId);
    setRecognizedDeviceName(
      sourceManagementSnapshot?.servers.find(
        (server) => server.sourceServerId === profile.sourceServerId,
      )?.displayName,
    );
    setCurrentStep("connecting");
    void (async () => {
      try {
        const target = buildRemoteTargetFromProfile(profile);
        const failure = selectOptions?.initialFailure;
        if (
          failure?.code === "source-server-upgrade-required" &&
          failure.failedTarget &&
          !isSameSourceServerUpdateTarget(target, failure.failedTarget)
        ) {
          acceptInitialFailure(failure.failedTarget, failure);
          return;
        }
        setKind(target.kind);
        const credentials = await loadConnectionProfileCredentials({
          profile,
          loadCredential: baseServices.credentialService.load,
        });
        if (entryEpochRef.current !== entryEpoch) return;
        if (target.kind === "ssh") {
          const hasPasswordAuth = Boolean(credentials?.password);
          const expectsPrivateKeyPassphrase =
            profile.target.kind === "ssh" &&
            Boolean(profile.target.privateKeyPassphraseCredentialKey);
          const hasPrivateKeyAuth = Boolean(
            target.privateKeyPath &&
            (!expectsPrivateKeyPassphrase || credentials?.privateKeyPassphrase),
          );
          if (!hasPasswordAuth && !hasPrivateKeyAuth) {
            updatePendingRemoteTarget(target);
            setKind("ssh");
            setPassword("");
            setPrivateKeyPassphrase("");
            setServerToken("");
            setHost(target.host);
            setPort(String(target.port ?? 22));
            setUsername(target.username);
            setPrivateKeyPath(target.privateKeyPath ?? "");
            setSshAuthMethod(target.privateKeyPath ? "privateKey" : "password");
            setAssetInstallMode(target.assetInstallMode ?? DEFAULT_REMOTE_ASSET_INSTALL_MODE);
            setErrorCode("credentials-required");
            setError(intl.formatMessage({ id: "remote.error.credentialsRequired" }));
            return;
          }
        }
        const targetWithCredentials =
          target.kind === "ssh" && credentials
            ? {
                ...target,
                ...(credentials.password ? { password: credentials.password } : {}),
                ...(credentials.privateKeyPassphrase
                  ? {
                      privateKeyPassphrase: credentials.privateKeyPassphrase,
                    }
                  : {}),
              }
            : target;
        if (targetWithCredentials.kind === "ssh") {
          setHost(targetWithCredentials.host);
          setPort(String(targetWithCredentials.port ?? 22));
          setUsername(targetWithCredentials.username);
          setPrivateKeyPath(targetWithCredentials.privateKeyPath ?? "");
          setSshAuthMethod(targetWithCredentials.privateKeyPath ? "privateKey" : "password");
          setPassword(targetWithCredentials.password ?? "");
          setPrivateKeyPassphrase(targetWithCredentials.privateKeyPassphrase ?? "");
          setAssetInstallMode(
            targetWithCredentials.assetInstallMode ?? DEFAULT_REMOTE_ASSET_INSTALL_MODE,
          );
        }
        updatePendingRemoteTarget(targetWithCredentials);
        if (acceptInitialFailure(targetWithCredentials, selectOptions?.initialFailure)) return;
        await startRemoteConnection(
          targetWithCredentials,
          false,
          preferredDirectoryPath,
          selectOptions,
        );
      } catch (cause) {
        if (entryEpochRef.current !== entryEpoch) return;
        setError(getErrorMessage(cause));
        setCurrentStep("connecting");
      }
    })();
  };
  const acceptOpenIntent = useEffectEvent(() => {
    const wasBackground = minimizedRef.current;
    closeDialog({ keepOpen: true });
    if (wasBackground && sourceManagement) {
      const epoch = entryEpochRef.current;
      refreshingIntentRef.current = epoch;
      setRefreshingIntent(true);
      void sourceManagement
        .getSnapshot()
        .then((snapshot) => {
          if (entryEpochRef.current === epoch) applySourceManagementSnapshot(snapshot);
        })
        .catch((cause) => {
          if (entryEpochRef.current === epoch) setError(getErrorMessage(cause));
        })
        .finally(() => {
          if (refreshingIntentRef.current !== epoch) return;
          refreshingIntentRef.current = null;
          setRefreshingIntent(false);
        });
    }
  });
  useEffect(() => {
    if (!open || openIntentId === undefined || consumedOpenIntentIdRef.current === openIntentId)
      return;
    consumedOpenIntentIdRef.current = openIntentId;
    if (isRemoteConnectionFlowActive(flowSnapshot) || upgradeLoading) return;
    acceptOpenIntent();
  }, [open, openIntentId, flowActive]);

  const applyKindPreference = useEffectEvent(() => {
    if (!preferredKind || !availableKinds.includes(preferredKind)) return;
    resetDraft();
    setKind(preferredKind);
    if (preferredKind === "wsl") setWslDistro(preferredWslDistro ?? "");
    setCurrentStep("settings");
  });
  useEffect(() => {
    if (!open || !preferredKind || preferredTarget || preferredProfileId || preferredSourceServerId)
      return;
    const key = `${preferredKind}:${preferredWslDistro ?? ""}`;
    if (consumedKindPreferenceRef.current === key) return;
    consumedKindPreferenceRef.current = key;
    applyKindPreference();
  }, [
    open,
    preferredKind,
    preferredWslDistro,
    preferredTarget,
    preferredProfileId,
    preferredSourceServerId,
    openIntentId,
  ]);

  const applyPreferredTarget = useEffectEvent((target: RemoteTarget) => {
    entryEpochRef.current += 1;
    setFocusCredentials(false);
    setPassword("");
    setPrivateKeyPassphrase("");
    setServerToken("");
    setKind(target.kind);
    updatePendingRemoteTarget(target);
    pendingCompletionIntentRef.current = {
      preferredDirectoryPath,
      options: { directToDirectory: true },
    };
    if (target.kind === "ssh") {
      setHost(target.host);
      setPort(String(target.port ?? 22));
      setUsername(target.username);
      setPrivateKeyPath(target.privateKeyPath ?? "");
      setSshAuthMethod(target.privateKeyPath ? "privateKey" : "password");
      setAssetInstallMode(target.assetInstallMode ?? DEFAULT_REMOTE_ASSET_INSTALL_MODE);
    } else if (target.kind === "wsl") {
      setWslDistro(target.distro ?? "");
      setWslUser(target.user ?? "");
    } else if (target.kind === "docker") {
      setManualDockerContainer(target.container);
      setDockerContainer(target.container);
    } else {
      setServerUrl(target.url);
      setServerName(target.name ?? "");
    }
    if (!acceptInitialFailure(target, initialFailure)) setCurrentStep("settings");
  });
  useEffect(() => {
    if (
      !open &&
      currentStep === "device" &&
      !pendingRemoteTarget &&
      !connectedSessionId &&
      !loading
    )
      consumedPreferredTargetRef.current = null;
    if (
      !open ||
      !preferredTarget ||
      preferredProfileId ||
      loading ||
      connectedSessionId ||
      consumedPreferredTargetRef.current === preferredTarget
    )
      return;
    consumedPreferredTargetRef.current = preferredTarget;
    applyPreferredTarget(preferredTarget);
  }, [
    open,
    preferredTarget,
    preferredProfileId,
    loading,
    connectedSessionId,
    currentStep,
    pendingRemoteTarget,
    openIntentId,
  ]);

  const openPreferredSourceDirectory = useEffectEvent((profile: ConnectionProfile) => {
    handleSelectProfile(profile, undefined, { directToDirectory: true });
  });
  const openPreferredProfile = useEffectEvent((profile: ConnectionProfile) => {
    handleSelectProfile(profile, preferredDirectoryPath, {
      directToDirectory: true,
      initialFailure,
    });
  });

  useEffect(() => {
    if (
      !open ||
      !preferredProfileId ||
      refreshingIntentRef.current !== null ||
      loading ||
      connectedSessionId ||
      consumedPreferredProfileIdRef.current === preferredProfileId ||
      !sourceManagementSnapshot
    ) {
      return;
    }
    const profile = sourceManagementSnapshot.profiles.find(
      (candidate) =>
        candidate.profileId === preferredProfileId && candidate.lifecycleState !== "retired",
    );
    if (!profile) return;

    consumedPreferredProfileIdRef.current = preferredProfileId;
    openPreferredProfile(profile);
  }, [
    connectedSessionId,
    loading,
    open,
    openIntentId,
    preferredProfileId,
    refreshingIntent,
    sourceManagementSnapshot,
  ]);

  useEffect(() => {
    if (
      !open ||
      !preferredSourceServerId ||
      refreshingIntentRef.current !== null ||
      loading ||
      connectedSessionId ||
      consumedPreferredSourceServerIdRef.current === preferredSourceServerId ||
      !sourceManagementSnapshot
    ) {
      return;
    }
    const profile = findPreferredSourceConnectionProfile(
      sourceManagementSnapshot,
      preferredSourceServerId,
    );
    if (!profile) return;

    consumedPreferredSourceServerIdRef.current = preferredSourceServerId;
    openPreferredSourceDirectory(profile);
  }, [
    connectedSessionId,
    loading,
    open,
    openIntentId,
    preferredSourceServerId,
    refreshingIntent,
    sourceManagementSnapshot,
  ]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      minimizedRef.current = false;
      applyOpenState(true);
      return;
    }

    void handleCloseRequest();
  };

  const stepCopy = getRemoteWizardStepCopy(intl, currentStep, kind, {
    lineName:
      activeProfileName ??
      (pendingRemoteTarget ? formatRemoteLinkRailTarget(pendingRemoteTarget) : undefined),
    deviceName: recognizedDeviceName,
    connectionReady: Boolean(connectedSessionId) && !error,
    hasError: Boolean(error),
    updating: upgradeLoading,
    cancelled,
  });

  const credentialCategory = classifyRemoteConnectionError({
    errorCode,
    error: rawError ?? error,
  }).category;
  const needsCredentials =
    aliasCredentialsPending ||
    credentialCategory === "credentials" ||
    credentialCategory === "authentication";
  const passphraseRequired =
    pendingRemoteTarget?.kind === "ssh" && Boolean(pendingRemoteTarget.privateKeyPath);
  const currentConnectionState = sourceManagementSnapshot?.states.find(
    (state) =>
      state.profileId === upgradeProfileId ||
      sourceManagementSnapshot.profiles.some(
        (profile) =>
          profile.profileId === state.profileId &&
          pendingRemoteTarget &&
          pendingRemoteTarget.kind !== "server" &&
          profileMatchesRemoteTarget(profile, pendingRemoteTarget),
      ),
  );
  const resumeBackground = () => {
    const finish = pendingBackgroundCompletion.current;
    if (!finish) {
      handleOpenChange(true);
      return;
    }
    const operationEpoch = entryEpochRef.current;
    pendingBackgroundCompletion.current = null;
    minimizedRef.current = false;
    applyOpenState(true);
    setBackgroundReady(false);
    setCompletionRunning(true);
    void finish()
      .catch((cause) => {
        if (entryEpochRef.current !== operationEpoch) return;
        setError(getErrorMessage(cause));
        setCurrentStep("connecting");
        if (!minimizedRef.current) applyOpenState(true);
      })
      .finally(() => {
        if (entryEpochRef.current === operationEpoch) setCompletionRunning(false);
      });
  };
  const resumeOpenedBackground = useEffectEvent(() => {
    if (minimizedRef.current) resumeBackground();
  });
  useEffect(() => {
    if (open) resumeOpenedBackground();
  }, [open]);
  const displayTarget = useMemo(
    () =>
      pendingRemoteTarget?.kind === "ssh"
        ? {
            kind: "ssh" as const,
            host: pendingRemoteTarget.host,
            username: pendingRemoteTarget.username,
            port: pendingRemoteTarget.port,
          }
        : pendingRemoteTarget?.kind === "server"
          ? {
              kind: "server" as const,
              url: pendingRemoteTarget.url,
              name: pendingRemoteTarget.name,
            }
          : pendingRemoteTarget,
    [pendingRemoteTarget],
  );
  const directoryEpoch = entryEpochRef.current;
  return {
    open,
    currentStep,
    error,
    handleOpenChange,
    header: {
      currentStep,
      deviceManagement: completion === "device-management",
      hideHeading: currentStep === "connecting" && !cancelled,
      title: stepCopy.title,
      description: stepCopy.description,
      settingsPreview:
        currentStep === "settings"
          ? { kind, target: formatRemoteDraftPreview(formSnapshot) }
          : undefined,
      onMinimize: () => {
        minimizedRef.current = true;
        applyOpenState(false);
      },
      onClose: () => {
        void handleCloseRequest();
      },
    } satisfies ComponentProps<typeof RemoteConnectionWizardHeader>,
    minimizedProgress:
      !open && minimizedRef.current
        ? {
            operationId: `${openIntentId ?? 0}:${directoryEpoch}`,
            view: currentStep,
            cancelled,
            target: displayTarget,
            name: recognizedDeviceName ?? activeProfileName,
            logs: visibleConnectionLogs,
            error: errorCode === "credentials-required" ? "" : error,
            reason: error
              ? intl.formatMessage({
                  id: classifyRemoteConnectionError({
                    errorCode,
                    target: pendingRemoteTarget ?? undefined,
                  }).reasonId,
                })
              : "",
            waiting:
              aliasCredentialsPending ||
              Boolean(pendingInstallConfirmation) ||
              Boolean(pendingForceUpdate) ||
              errorCode === "credentials-required",
            ready: backgroundReady,
            sourceServerId: recognizedSourceServerId ?? preferredSourceServerId,
            profileId:
              preferredProfileId ??
              sourceManagementSnapshot?.profiles.find(
                (profile) =>
                  pendingRemoteTarget &&
                  pendingRemoteTarget.kind !== "server" &&
                  profileMatchesRemoteTarget(profile, pendingRemoteTarget),
              )?.profileId,
            onCancel: () => {
              if (entryEpochRef.current === directoryEpoch) void handleCloseRequest();
            },
            onResume: () => {
              if (
                entryEpochRef.current !== directoryEpoch ||
                (backgroundReady && !pendingBackgroundCompletion.current)
              )
                return;
              resumeBackground();
            },
          }
        : null,
    aliasCredentials: aliasCredentialsPending
      ? {
          password,
          onPasswordChange: setPassword,
          onSubmit: () => {
            void handleConnect();
          },
        }
      : null,
    selectionStep: {
      snapshot: sourceManagementSnapshot,
      aliases: sshConfigAliases,
      distros: wslDistros,
      containers: dockerContainers,
      availableKinds,
      dockerAvailable,
      loading: discoveryLoading,
      discoveryError,
      remoteConversationWorkspaceBySourceServerId,
      onSelectProfile: (profile, path) => {
        onProjectIntentCleared?.();
        handleSelectProfile(profile, path, { directToDirectory: true });
      },
      onNewConnection: (nextKind) => {
        entryEpochRef.current += 1;
        pendingCompletionIntentRef.current = { options: { announceReusedConnection: true } };
        updatePendingRemoteTarget(null);
        resetDraft();
        setDirectoryPath("");
        setRecognizedDeviceName(undefined);
        setRecognizedSourceServerId(undefined);
        setKind(nextKind);
        setActiveProfileName(undefined);
        setAliasCredentialsPending(false);
        setFocusCredentials(false);
        onProjectIntentCleared?.();
        resetFeedback();
        setCurrentStep("settings");
      },
      onSelectTarget: (target) => {
        resetDraft();
        setDirectoryPath("");
        setRecognizedDeviceName(undefined);
        setRecognizedSourceServerId(undefined);
        setKind(target.kind);
        if (target.kind === "wsl") setWslDistro(target.distro ?? "");
        if (target.kind === "docker") setDockerContainer(target.container);
        setActiveProfileName(undefined);
        onProjectIntentCleared?.();
        void startRemoteConnection(target);
      },
      onSelectAlias: (alias) => {
        resetDraft();
        setDirectoryPath("");
        setRecognizedDeviceName(undefined);
        setRecognizedSourceServerId(undefined);
        setKind("ssh");
        applySshConfigAlias(alias);
        setActiveProfileName(alias.alias);
        pendingCompletionIntentRef.current = {};
        onProjectIntentCleared?.();
        resetFeedback();
        const target: RemoteTarget = {
          kind: "ssh",
          host: alias.host?.trim() || alias.alias,
          username: alias.username?.trim() ?? "",
          port: alias.port,
          sshConfigAlias: alias.alias,
          privateKeyPath: alias.privateKeyPath,
          assetInstallMode: DEFAULT_REMOTE_ASSET_INSTALL_MODE,
        };
        updatePendingRemoteTarget(target);
        if (!target.username) {
          setCurrentStep("settings");
          return;
        }
        if (!target.privateKeyPath) {
          setAliasCredentialsPending(true);
          setCurrentStep("connecting");
          return;
        }
        void startRemoteConnection(target);
      },
    } satisfies ComponentProps<typeof RemoteConnectionSelection>,
    settingsStep: {
      availableKinds: addingDevice ? availableKinds : undefined,
      onKindChange: addingDevice
        ? (nextKind: RemoteTarget["kind"]) => {
            if (nextKind === kind) return;
            entryEpochRef.current += 1;
            resetDraft();
            setKind(nextKind);
            updatePendingRemoteTarget(null);
            setActiveProfileName(undefined);
            setRecognizedSourceServerId(undefined);
            setRecognizedDeviceName(undefined);
            resetFeedback();
          }
        : undefined,
      connectLabel:
        completion === "device-management"
          ? intl.formatMessage({ id: "remote.addAndConnect" })
          : undefined,
      kind: kind,
      host: host,
      port: port,
      username: username,
      sshAuthMethod: sshAuthMethod,
      assetInstallMode: assetInstallMode,
      password: password,
      privateKeyPath: privateKeyPath,
      privateKeyPassphrase: privateKeyPassphrase,
      wslDistro: wslDistro,
      wslUser: wslUser,
      wslDistros: wslDistros,
      dockerContainer: dockerContainer,
      manualDockerContainer: manualDockerContainer,
      serverUrl: serverUrl,
      serverName: serverName,
      serverToken: serverToken,
      serverWorkspacePath: serverWorkspacePath,
      dockerContainers: dockerContainers,
      dockerAvailable: dockerAvailable,
      sshConfigAliases: sshConfigAliases,
      sshConfigAliasesLoading: sshConfigAliasesLoading,
      sshConfigAliasesError: sshConfigAliasesError,
      selectedSshConfigAlias: selectedSshConfigAlias,
      currentRuntimeOptionsLoading: currentRuntimeOptionsLoading,
      currentRuntimeOptionsError: currentRuntimeOptionsError,
      remoteWorkspaceSessions: remoteWorkspaceSessions,
      fieldErrors: validationAttempt > 0 ? collectRemoteFormFieldErrors(intl, formSnapshot) : [],
      validationAttempt,
      focusCredentials: focusCredentials,
      loading: loading,
      onBack: () => {
        if (addingDevice) {
          void handleCloseRequest();
          return;
        }
        resetFeedback();
        setCurrentStep("device");
      },
      onHostChange: setHost,
      onPortChange: setPort,
      onUsernameChange: setUsername,
      onSshAuthMethodChange: setSshAuthMethod,
      onAssetInstallModeChange: setAssetInstallMode,
      onPasswordChange: setPassword,
      onPrivateKeyPathChange: setPrivateKeyPath,
      onPrivateKeyPassphraseChange: setPrivateKeyPassphrase,
      onWslDistroChange: setWslDistro,
      onWslUserChange: setWslUser,
      onDockerContainerChange: setDockerContainer,
      onManualDockerContainerChange: setManualDockerContainer,
      onServerUrlChange: setServerUrl,
      onServerNameChange: setServerName,
      onServerTokenChange: setServerToken,
      onServerWorkspacePathChange: setServerWorkspacePath,
      onDockerContainersRefresh: refreshDockerContainers,
      onApplySshConfigAlias: applySshConfigAlias,
      onClearSelectedSshConfigAlias: clearSelectedSshConfigAlias,
      onConnect: () => {
        void handleConnect();
      },
    } satisfies ComponentProps<typeof RemoteConnectionSettingsStep>,
    connectingStep: {
      backToDevicesLabel: addingDevice
        ? intl.formatMessage({ id: "settings.source.newConnection" })
        : undefined,
      onClose: () => {
        void handleCloseRequest();
      },
      onBackToDevices: () => {
        closeDialog({ keepOpen: true });
        consumedKindPreferenceRef.current = preferredKind
          ? `${preferredKind}:${preferredWslDistro ?? ""}`
          : null;
        consumedPreferredSourceServerIdRef.current = preferredSourceServerId ?? null;
        consumedPreferredProfileIdRef.current = preferredProfileId ?? null;
        consumedPreferredTargetRef.current = preferredTarget ?? null;
        onProjectIntentCleared?.();
      },
      forceUpdate: pendingForceUpdate
        ? {
            ...pendingForceUpdate,
            onConfirm: () => settleForceUpdate(true),
            onCancel: handleCancelConnection,
          }
        : undefined,
      credentials: needsCredentials
        ? {
            passphrase: passphraseRequired,
            value: passphraseRequired ? privateKeyPassphrase : password,
            onChange: passphraseRequired ? setPrivateKeyPassphrase : setPassword,
            onSubmit: () => {
              if (pendingRemoteTarget?.kind !== "ssh") return;
              const value = passphraseRequired ? privateKeyPassphrase : password;
              if (!value) return;
              const target = {
                ...pendingRemoteTarget,
                ...(passphraseRequired ? { privateKeyPassphrase: value } : { password: value }),
              };
              const intent = pendingCompletionIntentRef.current;
              setAliasCredentialsPending(false);
              void startRemoteConnection(
                target,
                false,
                intent.preferredDirectoryPath,
                intent.options,
              );
            },
          }
        : undefined,
      onMinimize: () => {
        minimizedRef.current = true;
        applyOpenState(false);
      },
      kind: kind,
      logs: visibleConnectionLogs,
      errorMessage: error,
      errorCode: errorCode,
      rawError: rawError,
      upgradeTarget: sourceManagementSnapshot?.states.find(
        (state) =>
          state.profileId === upgradeProfileId ||
          sourceManagementSnapshot.profiles.some(
            (profile) =>
              profile.profileId === state.profileId &&
              pendingRemoteTarget &&
              pendingRemoteTarget.kind !== "server" &&
              profileMatchesRemoteTarget(profile, pendingRemoteTarget),
          ),
      )?.upgradeTarget,
      cancelled: cancelled,
      onCancelConnection: handleCancelConnection,
      loading: loading || upgradeLoading,
      upgradeRequired: Boolean(upgradeProfileId),
      upgradeLoading: upgradeLoading && !pendingForceUpdate,
      onUpgrade: () => {
        void handleUpgradeRequiredServer();
      },
      connectionReady: Boolean(connectedSessionId) && !error,
      onContinueToDirectory: () => setCurrentStep("directory"),
      target: pendingRemoteTarget,
      recognizedDeviceName: recognizedDeviceName,
      profileName: activeProfileName,
      recognizedDeviceMeta: recognizedServer ? formatDeviceCardMeta(recognizedServer) : undefined,
      localVersion: CF_VERSION,
      onUseRemoteDownload:
        pendingRemoteTarget?.kind === "ssh"
          ? () => {
              const target = {
                ...pendingRemoteTarget,
                assetInstallMode: "remote-download" as const,
              };
              const intent = pendingCompletionIntentRef.current;
              updatePendingRemoteTarget(target);
              void startRemoteConnection(
                target,
                false,
                intent.preferredDirectoryPath,
                intent.options,
              );
            }
          : undefined,
      installConfirmation: pendingInstallConfirmation
        ? {
            target: pendingInstallConfirmation,
            preview: currentConnectionState?.installPreview,
            onConfirm: () => {
              if (entryEpochRef.current !== directoryEpoch) return;
              handleConfirmInstall();
            },
            onCancel: handleCancelInstall,
          }
        : undefined,
      onBack: () => {
        void withConfirmedDiscard(async () => {
          cancelActiveTrace();
          const epoch = ++entryEpochRef.current;
          setBlockedCompletion(null);
          setCompletionRunning(false);
          const sessionId = connectedSessionIdRef.current;
          if (sessionId && ownsConnectedSessionRef.current) void handleCancelSession(sessionId);
          setConnectedSessionId(null);
          activeRequestIdRef.current = null;
          if (loading) {
            await cancelPendingRemoteConnection(connectingRequestId ?? undefined);
            if (entryEpochRef.current !== epoch) return;
            setLoading(false);
          }
          setFocusCredentials(errorCode === "credentials-required");
          setPendingInstallConfirmation(null);
          resetFeedback();
          updateConnectingRequestId(null);
          setCurrentStep("settings");
        });
      },
      onRetry: () => {
        if (errorCode !== "source-server-identity-change-pending") {
          handleStartPendingRemoteConnection();
          return;
        }
        const profileId =
          preferredProfileId ??
          sourceManagementSnapshot?.profiles.find(
            (profile) =>
              pendingRemoteTarget &&
              pendingRemoteTarget.kind !== "server" &&
              profileMatchesRemoteTarget(profile, pendingRemoteTarget),
          )?.profileId;
        if (!profileId || !sourceManagement) return;
        const epoch = entryEpochRef.current;
        void (async () => {
          if (entryEpochRef.current !== epoch) return;
          setUpgradeLoading(true);
          try {
            const snapshot = await sourceManagement.confirmIdentityChange(profileId);
            if (entryEpochRef.current !== epoch) return;
            applySourceManagementSnapshot(snapshot);
            setUpgradeLoading(false);
            handleStartPendingRemoteConnection();
          } catch (cause) {
            if (entryEpochRef.current === epoch) setError(getErrorMessage(cause));
          } finally {
            if (entryEpochRef.current === epoch) setUpgradeLoading(false);
          }
        })();
      },
    } satisfies ComponentProps<typeof RemoteConnectionConnectingStep>,
    directoryStep: {
      directoryPath,
      onDirectoryPathChange: (path) => {
        if (entryEpochRef.current === directoryEpoch) setDirectoryPath(path);
      },
      services: directoryBrowserServices,
      remoteTarget: pendingRemoteTarget,
      localSkillSyncService: baseServices.skillSyncService,
      remoteSkillSyncService: directoryBrowserServices?.skillSyncService ?? null,
      localMcpSyncService: baseServices.mcpSyncService,
      remoteMcpSyncService: directoryBrowserServices?.mcpSyncService ?? null,
      localPluginSyncService: baseServices.pluginSyncService,
      remotePluginSyncService: directoryBrowserServices?.pluginSyncService ?? null,
      localCfAgentService: baseServices.cfAgentService,
      remoteCfAgentService: directoryBrowserServices?.cfAgentService ?? null,
      localWorkspacePath: localWorkspacePath,
      selecting: selectingDirectory,
      onSelect: (path) => {
        void handleSelectDirectory(path);
      },
      onBack: () => {
        void withConfirmedDiscard(handleBackToConnection);
      },
      onCancel: () => {
        void handleCloseRequest();
      },
      onChooseLater: () => {
        if (!selectingDirectoryRef.current) closeDialog();
      },
      onSkillsSynced: async () => undefined,
      onMcpSynced: async () => undefined,
      onPluginsSynced: async () => undefined,
      deviceName: recognizedDeviceName,
      profileName: activeProfileName,
      deviceVersion: recognizedServer?.lastSeenVersion,
      onRenameDevice:
        recognizedSourceServerId && sourceManagement
          ? async (name) => {
              const snapshot = await sourceManagement.renameSource(recognizedSourceServerId, name);
              if (entryEpochRef.current !== directoryEpoch) return;
              applySourceManagementSnapshot(snapshot);
              setRecognizedDeviceName(name);
            }
          : undefined,
      quickOpenPaths: quickOpenDirectoryData.paths,
      quickOpenEntries: quickOpenDirectoryData.entries,
    } satisfies ComponentProps<typeof RemoteConnectionDirectoryStep>,
  };
}
